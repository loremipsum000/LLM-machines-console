import type { Actor } from "../../auth/persona"
import { emitAudit } from "../audit"
import {
  type GovernedCorpusSummary,
  type GovernedKnowledgeRuntimeResult,
  listAccessibleGovernedCorpora,
  queryGovernedKnowledgeRuntime,
} from "./admin"

export interface CorpusKnowledgePreflightResult {
  auditAction:
    | "knowledge_intent.unfulfilled"
    | "knowledge_preflight.ambiguous"
    | "knowledge_preflight.retrieved"
  citations: GovernedKnowledgeRuntimeResult["citations"]
  contextMessage: string | null
  matchedCorpora: GovernedCorpusSummary[]
  passages: GovernedKnowledgeRuntimeResult["results"]
  queries: string[]
  retrievalMode: GovernedKnowledgeRuntimeResult["retrievalMode"] | null
  warnings: string[]
}

const MAX_CONTEXT_PASSAGES = 8
const MAX_CONTEXT_CHARS = 6000
const QUANTITATIVE_TERMS = [
  "amount",
  "attendance",
  "date",
  "number",
  "percentage",
  "rate",
  "ratio",
  "total",
]

export async function preflightCorpusKnowledgeForPrompt(
  actor: Actor,
  prompt: string,
): Promise<CorpusKnowledgePreflightResult | null> {
  const normalizedPrompt = normalizeForMatch(prompt)
  if (!normalizedPrompt) {
    return null
  }

  const { corpora } = await listAccessibleGovernedCorpora(actor, {
    limit: 100,
  })
  const matchedCorpora = matchPromptCorpora(prompt, corpora)
  if (matchedCorpora.length === 0) {
    const requestedCorpusRef = likelyRequestedCorpusReference(prompt)
    if (requestedCorpusRef) {
      await emitAudit({
        actorId: actor.subject,
        action: "knowledge_intent.unfulfilled",
        targetType: "knowledge.corpus",
        targetId: "unknown",
        reason: "no_accessible_corpus_match",
        metadata: {
          requestedCorpusRef,
          source: "librechat_chat_preflight",
        },
      })
      return {
        auditAction: "knowledge_intent.unfulfilled",
        citations: [],
        contextMessage: inaccessibleCorpusMessage(requestedCorpusRef),
        matchedCorpora: [],
        passages: [],
        queries: [],
        retrievalMode: null,
        warnings: [],
      }
    }
    return null
  }

  await emitAudit({
    actorId: actor.subject,
    action: "knowledge_intent.detected",
    targetType: "knowledge.corpus",
    targetId: matchedCorpora.map((corpus) => corpus.id).join(","),
    metadata: {
      corpusNames: matchedCorpora.map((corpus) => corpus.name),
      promptPreview: prompt.slice(0, 240),
      source: "librechat_chat_preflight",
    },
  })

  if (matchedCorpora.length > 1) {
    await emitAudit({
      actorId: actor.subject,
      action: "knowledge_preflight.ambiguous",
      targetType: "knowledge.corpus",
      targetId: matchedCorpora.map((corpus) => corpus.id).join(","),
      metadata: {
        corpusNames: matchedCorpora.map((corpus) => corpus.name),
        source: "librechat_chat_preflight",
      },
    })
    return {
      auditAction: "knowledge_preflight.ambiguous",
      citations: [],
      contextMessage: ambiguityMessage(matchedCorpora),
      matchedCorpora,
      passages: [],
      queries: [],
      retrievalMode: null,
      warnings: [],
    }
  }

  const corpus = matchedCorpora[0]
  const queries = expandedCorpusQueries(prompt, corpus.name)
  const retrievals: GovernedKnowledgeRuntimeResult[] = []
  for (const query of queries) {
    retrievals.push(
      await queryGovernedKnowledgeRuntime(actor, {
        corpusRefs: [corpus.name],
        query,
        topK: MAX_CONTEXT_PASSAGES,
      }),
    )
  }

  const merged = mergeRetrievals(retrievals, prompt)
  const warnings = answerQualityWarnings(prompt, merged)

  if (merged.passages.length === 0) {
    await emitAudit({
      actorId: actor.subject,
      action: "knowledge_intent.unfulfilled",
      targetType: "knowledge.corpus",
      targetId: corpus.id,
      reason: "no_matching_passages",
      metadata: {
        corpusName: corpus.name,
        queries,
        source: "librechat_chat_preflight",
        warnings,
      },
    })
    return {
      auditAction: "knowledge_intent.unfulfilled",
      citations: [],
      contextMessage: noResultsMessage(corpus.name),
      matchedCorpora,
      passages: [],
      queries,
      retrievalMode: merged.retrievalMode,
      warnings,
    }
  }

  await emitAudit({
    actorId: actor.subject,
    action: "knowledge_preflight.retrieved",
    targetType: "knowledge.corpus",
    targetId: corpus.id,
    metadata: {
      citationCount: merged.citations.length,
      corpusName: corpus.name,
      passageCount: merged.passages.length,
      queries,
      retrievalMode: merged.retrievalMode,
      source: "librechat_chat_preflight",
      warnings,
    },
  })

  return {
    auditAction: "knowledge_preflight.retrieved",
    citations: merged.citations,
    contextMessage: corpusContextMessage(corpus.name, merged.passages),
    matchedCorpora,
    passages: merged.passages,
    queries,
    retrievalMode: merged.retrievalMode,
    warnings,
  }
}

export async function queryGovernedCorpusForQuestion(
  actor: Actor,
  input: {
    corpusRef: string
    language?: string
    question: string
    topK?: number
  },
): Promise<GovernedKnowledgeRuntimeResult & { expandedQueries: string[] }> {
  const queries = expandedCorpusQueries(input.question, input.corpusRef)
  const retrievals: GovernedKnowledgeRuntimeResult[] = []
  for (const query of queries) {
    retrievals.push(
      await queryGovernedKnowledgeRuntime(actor, {
        corpusRefs: [input.corpusRef],
        language: input.language,
        query,
        topK: input.topK ?? MAX_CONTEXT_PASSAGES,
      }),
    )
  }
  const merged = mergeRetrievals(retrievals, input.question)
  const warnings = answerQualityWarnings(input.question, merged)
  return {
    citations: merged.citations,
    expandedQueries: queries,
    generatedAt: new Date().toISOString(),
    noResultReason:
      merged.passages.length > 0
        ? null
        : (retrievals[0]?.noResultReason ??
          "Selected corpus exists but no matching passages were found."),
    query: input.question,
    results: merged.passages,
    retrievalMode: merged.retrievalMode,
    selectedCorpora: retrievals[0]?.selectedCorpora ?? [],
    unresolvedCorpora: retrievals[0]?.unresolvedCorpora ?? [],
    warnings,
  }
}

function matchPromptCorpora(
  prompt: string,
  corpora: GovernedCorpusSummary[],
): GovernedCorpusSummary[] {
  const normalizedPrompt = normalizeForMatch(prompt)
  return corpora
    .filter((corpus) => {
      const normalizedName = normalizeForMatch(corpus.name)
      if (!normalizedName) {
        return false
      }
      if (hasWordSequence(normalizedPrompt, normalizedName)) {
        return true
      }
      const slug = normalizeForMatch(slugify(corpus.name))
      if (slug && hasWordSequence(normalizedPrompt, slug)) {
        return true
      }
      if (matchesCorpusRoot(normalizedPrompt, normalizedName)) {
        return true
      }
      if (normalizedName.length <= 16) {
        return nearTokenMatch(normalizedPrompt, normalizedName)
      }
      return false
    })
    .sort((a, b) => b.name.length - a.name.length)
}

function expandedCorpusQueries(prompt: string, corpusName: string): string[] {
  const withoutCorpusName = stripCorpusBoilerplate(prompt, corpusName)
  const queries = [
    withoutCorpusName,
    prompt,
    ...quantitativeExpansion(withoutCorpusName),
  ]
  return uniqueStrings(
    queries
      .map((query) => query.trim())
      .filter((query) => query.length > 2)
      .slice(0, 8),
  )
}

function quantitativeExpansion(prompt: string): string[] {
  const normalized = normalizeForMatch(prompt)
  const queries: string[] = []
  if (normalized.includes("supervisory board")) {
    queries.push("Supervisory Board meeting attendance")
    queries.push("Supervisory Board attendance")
    queries.push("Supervisory Board meeting attendance overview")
  }
  if (normalized.includes("attendance")) {
    queries.push("attendance rate")
    queries.push("meeting attendance")
    queries.push("attendance overview")
  }
  if (isQuantitativePrompt(prompt)) {
    queries.push(`${prompt} percentage`)
    queries.push(`${prompt} total`)
  }
  return queries
}

function stripCorpusBoilerplate(prompt: string, corpusName: string): string {
  const corpusNamePattern = escapeRegex(corpusName)
  return prompt
    .replace(new RegExp(corpusNamePattern, "gi"), " ")
    .replace(/\b(corpus|corpora|docs?|documents?|reports?)\b/gi, " ")
    .replace(/\b(check|search|query|retrieve|from|in|the)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function mergeRetrievals(
  retrievals: GovernedKnowledgeRuntimeResult[],
  question: string,
): {
  citations: GovernedKnowledgeRuntimeResult["citations"]
  passages: GovernedKnowledgeRuntimeResult["results"]
  retrievalMode: GovernedKnowledgeRuntimeResult["retrievalMode"]
  warnings: string[]
} {
  const byCitation = new Map<
    string,
    GovernedKnowledgeRuntimeResult["results"][number]
  >()
  const warnings = new Set<string>()
  let retrievalMode: GovernedKnowledgeRuntimeResult["retrievalMode"] = "lexical"

  for (const retrieval of retrievals) {
    retrievalMode = retrieval.retrievalMode
    for (const warning of retrieval.warnings) {
      warnings.add(warning)
    }
    for (const passage of retrieval.results) {
      const key =
        passage.citation.checksum ??
        passage.citation.citation_id ??
        `${passage.citation.source_id}:${passage.citation.page_number}:${passage.excerpt}`
      const existing = byCitation.get(key)
      const scoredPassage = {
        ...passage,
        score: passage.score + answerEvidenceBonus(passage.excerpt, question),
      }
      if (!existing || scoredPassage.score > existing.score) {
        byCitation.set(key, scoredPassage)
      }
    }
  }

  const passages = [...byCitation.values()]
    .sort((left, right) => right.score - left.score)
    .slice(0, MAX_CONTEXT_PASSAGES)
  return {
    citations: passages.map((passage) => passage.citation),
    passages,
    retrievalMode,
    warnings: [...warnings],
  }
}

function answerEvidenceBonus(excerpt: string, question: string): number {
  const text = excerpt.toLowerCase()
  const normalizedQuestion = normalizeForMatch(question)
  let bonus = 0
  if (
    normalizedQuestion.includes("attendance") &&
    text.includes("attendance")
  ) {
    bonus += 4
  }
  if (
    normalizedQuestion.includes("supervisory board") &&
    text.includes("supervisory board")
  ) {
    bonus += 2
  }
  if (
    normalizedQuestion.includes("attendance") &&
    text.includes("attendance overview")
  ) {
    bonus += 6
  }
  if (
    normalizedQuestion.includes("attendance") &&
    text.includes("attendance data")
  ) {
    bonus += 5
  }
  if (isQuantitativePrompt(question) && hasQuantitativeEvidenceText(text)) {
    bonus += 3
  }
  return bonus
}

function answerQualityWarnings(
  question: string,
  merged: {
    passages: GovernedKnowledgeRuntimeResult["results"]
    warnings: string[]
  },
): string[] {
  const warnings = new Set(merged.warnings)
  if (isQuantitativePrompt(question) && !hasQuantitativeEvidence(merged.passages)) {
    warnings.add("quantitative_evidence_not_found")
  }
  if (
    isAttendanceRatePrompt(question) &&
    hasHeadingOnlyAttendanceHit(merged.passages) &&
    !hasAttendanceRateEvidence(merged.passages)
  ) {
    warnings.add("answer_table_body_may_be_missing")
  }
  return [...warnings]
}

function corpusContextMessage(
  corpusName: string,
  passages: GovernedKnowledgeRuntimeResult["results"],
): string {
  let message = [
    `Governed corpus context for "${corpusName}".`,
    "Use only this context for claims about the named corpus. Cite source title and page/row when available. If the context is insufficient, say what is missing.",
    "",
  ].join("\n")

  for (const [index, passage] of passages.entries()) {
    const citation = passage.citation
    const location = [
      citation.page_number ? `page ${citation.page_number}` : null,
      citation.row_range ? `row ${citation.row_range}` : null,
      citation.section_path ?? null,
    ]
      .filter(Boolean)
      .join(", ")
    message += `${index + 1}. ${citation.title}${location ? ` (${location})` : ""}\n${passage.excerpt}\n\n`
    if (message.length >= MAX_CONTEXT_CHARS) {
      return `${message.slice(0, MAX_CONTEXT_CHARS)}\n[context truncated]`
    }
  }
  return message.trim()
}

function ambiguityMessage(corpora: GovernedCorpusSummary[]): string {
  const names = corpora.map((corpus) => corpus.name).join(", ")
  return `Multiple accessible corpora match that request: ${names}. Please specify which corpus to use.`
}

function noResultsMessage(corpusName: string): string {
  return `I found the accessible corpus "${corpusName}", but no matching passages were retrieved. Try a more specific section, source title, or keyword.`
}

function inaccessibleCorpusMessage(corpusRef: string): string {
  return `I could not find an accessible published corpus matching "${corpusRef}". Check the corpus name, publication state, or your access.`
}

function likelyRequestedCorpusReference(prompt: string): string | null {
  const corpusPhrase = prompt.match(
    /\b([A-Z][A-Za-z0-9_-]*(?:\s+[A-Z][A-Za-z0-9_-]*){0,2})\s+(?:corpus|corpora|docs?|documents?|reports?)\b/,
  )
  if (corpusPhrase?.[1]) {
    return corpusPhrase[1].trim()
  }
  const allCaps = prompt.match(/\b([A-Z][A-Z0-9_-]{2,})\b/)
  return allCaps?.[1] ?? null
}

function isQuantitativePrompt(prompt: string): boolean {
  const normalized = normalizeForMatch(prompt)
  return QUANTITATIVE_TERMS.some((term) => normalized.includes(term))
}

function isAttendanceRatePrompt(prompt: string): boolean {
  const normalized = normalizeForMatch(prompt)
  return (
    normalized.includes("attendance") &&
    (normalized.includes("rate") ||
      normalized.includes("percentage") ||
      normalized.includes("percent") ||
      normalized.includes("overview"))
  )
}

function hasQuantitativeEvidence(
  passages: GovernedKnowledgeRuntimeResult["results"],
): boolean {
  return passages.some((passage) =>
    hasQuantitativeEvidenceText(passage.excerpt.toLowerCase()),
  )
}

function hasQuantitativeEvidenceText(text: string): boolean {
  return /\d/.test(text) || /%|percent|percentage|rate/.test(text)
}

function hasHeadingOnlyAttendanceHit(
  passages: GovernedKnowledgeRuntimeResult["results"],
): boolean {
  return passages.some((passage) => {
    const text = passage.excerpt.toLowerCase().trim()
    return (
      text.length < 180 &&
      text.includes("attendance") &&
      (text.includes("overview") || text.includes("supervisory board"))
    )
  })
}

function hasAttendanceRateEvidence(
  passages: GovernedKnowledgeRuntimeResult["results"],
): boolean {
  return passages.some((passage) => {
    const text = passage.excerpt.toLowerCase()
    return (
      /\b\d{1,3}\s*%/.test(text) ||
      /\b\d+\s*\/\s*\d+\b/.test(text) ||
      /\b\d+\s+(?:of|out of)\s+\d+\b/.test(text) ||
      /\b(?:percent|percentage|rate)\b[^.]{0,80}\b\d/.test(text) ||
      /\b\d[^.]{0,80}\b(?:percent|percentage|rate)\b/.test(text)
    )
  })
}

function hasWordSequence(haystack: string, needle: string): boolean {
  return ` ${haystack} `.includes(` ${needle} `)
}

function nearTokenMatch(haystack: string, needle: string): boolean {
  const needleParts = needle.split(" ").filter(Boolean)
  if (needleParts.length !== 1) {
    return false
  }
  const target = needleParts[0]
  return haystack
    .split(" ")
    .some((token) => levenshteinDistance(token, target) <= 1)
}

function matchesCorpusRoot(haystack: string, corpusName: string): boolean {
  const firstNameToken = corpusName.split(" ")[0]
  return (
    firstNameToken.length >= 3 &&
    corpusName.startsWith(`${firstNameToken} `) &&
    hasWordSequence(haystack, firstNameToken)
  )
}

function levenshteinDistance(left: string, right: string): number {
  if (left === right) {
    return 0
  }
  if (Math.abs(left.length - right.length) > 1) {
    return 2
  }
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
    let last = leftIndex
    previous[0] = leftIndex + 1
    for (let rightIndex = 0; rightIndex < right.length; rightIndex += 1) {
      const current = previous[rightIndex + 1]
      previous[rightIndex + 1] =
        left[leftIndex] === right[rightIndex]
          ? last
          : Math.min(last + 1, previous[rightIndex] + 1, current + 1)
      last = current
    }
  }
  return previous[right.length] ?? 2
}

function normalizeForMatch(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9čćđšž]+/gi, "-")
    .replace(/^-+|-+$/g, "")
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)]
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
