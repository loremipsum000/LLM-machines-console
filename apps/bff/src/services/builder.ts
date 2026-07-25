import { randomUUID } from "node:crypto"
import type {
  AdminBuilderAgentStudioQuotaPolicy,
  BuilderAgentStudio,
  BuilderAgentStudioConfig,
  BuilderAgentStudioQuota,
  BuilderAgentTestStreamEvent,
  BuilderAgentTestResult,
  BuilderAgentTestRun,
  BuilderAgentTestSource,
  BuilderAgentTestToolCall,
  BuilderAgentTestTraceStep,
  BuilderResource,
  BuilderSubmission,
  BuilderTemplate,
  UpdateAdminBuilderAgentStudioQuotaPolicyRequest,
  UpdateBuilderAgentStudioRequest,
} from "@llm-machines/contracts"
import {
  builderAgentStudioConfigSchema,
  builderAgentTestToolCallSchema,
  builderAgentTestTraceStepSchema,
} from "@llm-machines/contracts"
import { and, desc, eq, gte, inArray } from "drizzle-orm"
import type { Actor } from "../auth/persona"
import { canUseBffFixtureData } from "../config/fixture-mode"
import { getDb } from "../db/client"
import {
  builderAgentConfigs,
  builderAgentStudioQuotaPolicies,
  builderAgentTestRuns,
  builderLifecycleEvents,
  builderResources,
  builderResourceVersions,
  users,
} from "../db/schema"
import { emitAudit } from "./audit"
import { publishHubEvent } from "./hub-events"
import { upsertActorUser } from "./users"

const builderTemplates: BuilderTemplate[] = [
  {
    id: "template-summary-agent",
    type: "agent",
    name: "Summary Agent",
    description: "A single-step agent for clean summaries over pasted context.",
    category: "Agent",
    version: "0.1.0",
    supportTier: "t1",
    tags: ["agent", "summary"],
    samplePrompts: [
      "Summarize this incident report for an executive.",
      "Turn these meeting notes into owners and next steps.",
    ],
    href: "/builder/templates/template-summary-agent",
    forkHref: "/builder/templates/template-summary-agent/fork",
  },
  {
    id: "template-pr-reviewer",
    type: "agent",
    name: "PR Reviewer",
    description: "Reviews diffs for risk, tests, and rollout notes.",
    category: "Agent",
    version: "0.1.0",
    supportTier: "t1",
    tags: ["agent", "code-review"],
    samplePrompts: [
      "Review this patch for auth regressions.",
      "Find missing tests in this diff.",
    ],
    href: "/builder/templates/template-pr-reviewer",
    forkHref: "/builder/templates/template-pr-reviewer/fork",
  },
  {
    id: "template-standup",
    type: "agent",
    name: "Standup Digest",
    description: "Starter template for team status summaries.",
    category: "Agent",
    version: "0.1.0",
    supportTier: "t1",
    tags: ["agent", "team", "digest"],
    samplePrompts: [
      "Summarize yesterday's standup updates into blockers and owners.",
      "Create a concise team digest from these status notes.",
    ],
    href: "/builder/templates/template-standup",
    forkHref: "/builder/templates/template-standup/fork",
  },
  {
    id: "template-internal-docs-corpus",
    type: "rag_corpus",
    name: "Internal Docs Corpus",
    description: "Starter corpus for governed internal documentation search.",
    category: "Knowledge",
    version: "0.1.0",
    supportTier: "t1",
    tags: ["knowledge", "rag"],
    samplePrompts: [
      "Answer using only the approved onboarding docs.",
      "Find the source paragraph for this policy answer.",
    ],
    href: "/builder/templates/template-internal-docs-corpus",
    forkHref: "/builder/templates/template-internal-docs-corpus/fork",
  },
  {
    id: "template-daily-report-workflow",
    type: "workflow",
    name: "Daily Report Workflow",
    description:
      "Placeholder workflow template for daily summaries once the runtime is selected.",
    category: "Workflow",
    version: "0.1.0",
    supportTier: "t2",
    tags: ["workflow", "reporting"],
    samplePrompts: [
      "Generate yesterday's operations digest.",
      "Prepare a daily release readiness note.",
    ],
    href: "/builder/templates/template-daily-report-workflow",
    forkHref: "/builder/templates/template-daily-report-workflow/fork",
  },
  {
    id: "template-react-app",
    type: "custom_app",
    name: "React App Minimal",
    description:
      "Minimal custom app scaffold for the future sandbox runtime path.",
    category: "Custom App",
    version: "0.1.0",
    supportTier: "t3",
    tags: ["app", "react"],
    samplePrompts: [
      "Create a compact dashboard over approved API data.",
      "Build a form-backed utility for a support team.",
    ],
    href: "/builder/templates/template-react-app",
    forkHref: "/builder/templates/template-react-app/fork",
  },
]

const initialBuilderResources: BuilderResource[] = [
  {
    id: "66666666-6666-4666-8666-666666666666",
    type: "agent",
    name: "Summary Agent",
    description: "Draft summary agent built from the starter template.",
    ownerId: "builder-1",
    ownerName: "Builder One",
    state: "draft",
    templateId: "template-summary-agent",
    currentVersion: {
      id: "77777777-7777-4777-8777-777777777777",
      semver: "v0.1",
      createdAt: "2026-05-21T08:00:00.000Z",
    },
    updatedAt: "2026-05-21T08:20:00.000Z",
    href: "/builder/resources/66666666-6666-4666-8666-666666666666",
    editorHref: "/builder/agents/66666666-6666-4666-8666-666666666666",
  },
  {
    id: "99999999-9999-4999-8999-999999999999",
    type: "rag_corpus",
    name: "Internal Docs Corpus",
    description: "Submitted internal documentation corpus awaiting review.",
    ownerId: "builder-1",
    ownerName: "Builder One",
    state: "submitted",
    templateId: "template-internal-docs-corpus",
    currentVersion: {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      semver: "v0.2",
      createdAt: "2026-05-21T08:10:00.000Z",
    },
    updatedAt: "2026-05-21T08:45:00.000Z",
    href: "/builder/resources/99999999-9999-4999-8999-999999999999",
    editorHref: "/builder/knowledge/99999999-9999-4999-8999-999999999999",
  },
  {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    type: "agent",
    name: "Customer Email Triage",
    description: "Published triage agent for support inbox classification.",
    ownerId: "builder-2",
    ownerName: "Builder Two",
    state: "published",
    templateId: null,
    currentVersion: {
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      semver: "v1.0",
      createdAt: "2026-05-20T17:00:00.000Z",
    },
    updatedAt: "2026-05-20T17:10:00.000Z",
    href: "/builder/resources/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    editorHref: "/builder/agents/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  },
]

const initialBuilderSubmissions: BuilderSubmission[] = [
  {
    id: "88888888-8888-4888-8888-888888888888",
    resourceId: "99999999-9999-4999-8999-999999999999",
    resourceName: "Internal Docs Corpus",
    resourceType: "rag_corpus",
    submittedVersion: "v0.2",
    state: "submitted",
    adminComment: null,
    submittedAt: "2026-05-21T08:45:00.000Z",
    decidedAt: null,
    href: "/builder/submissions/88888888-8888-4888-8888-888888888888",
  },
  {
    id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    resourceId: "66666666-6666-4666-8666-666666666666",
    resourceName: "Summary Agent",
    resourceType: "agent",
    submittedVersion: "v0.1",
    state: "rejected",
    adminComment: "Narrow the system prompt and add one test input.",
    submittedAt: "2026-05-20T12:00:00.000Z",
    decidedAt: "2026-05-20T13:15:00.000Z",
    href: "/builder/submissions/dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  },
]

let memoryBuilderResources = initialMemoryBuilderResources()
let memoryBuilderSubmissions = initialMemoryBuilderSubmissions()
let memoryBuilderAgentConfigs = initialMemoryBuilderConfigs()
let memoryBuilderAgentTestRuns: BuilderAgentTestRun[] = []
let memoryBuilderAgentTestRunOwners = new Map<string, string>()
let memoryBuilderAgentStudioQuotaPolicy: AdminBuilderAgentStudioQuotaPolicy | null =
  null

interface AgentStudioRuntimeAccounting {
  model: string
  finishReason: string | null
  promptTokens: number | null
  completionTokens: number | null
  totalTokens: number | null
  toolCalls: BuilderAgentTestToolCall[]
}

type AgentStudioTestExecution =
  | ({
      ok: true
      output: string
      source: BuilderAgentTestSource
    } & AgentStudioRuntimeAccounting)
  | ({
      ok: false
      status: 503
      title: string
      detail: string
      source: BuilderAgentTestSource
    } & AgentStudioRuntimeAccounting)

interface AgentStudioTestExecutionOptions {
  onDelta?: (content: string) => Promise<void>
  onToolCall?: (toolCall: BuilderAgentTestToolCall) => Promise<void>
  signal?: AbortSignal
  stream?: boolean
}

export function getBuilderTemplates(): BuilderTemplate[] {
  return builderTemplates
}

export function getBuilderTemplate(id: string): BuilderTemplate | undefined {
  return builderTemplates.find((template) => template.id === id)
}

export async function getBuilderResources(
  actor: Actor,
): Promise<BuilderResource[]> {
  const db = getDb()
  if (db) {
    const storageActor = await upsertActorUser(actor)
    const rows =
      storageActor.persona === "admin"
        ? await db
            .select()
            .from(builderResources)
            .orderBy(desc(builderResources.updatedAt))
        : await db
            .select()
            .from(builderResources)
            .where(eq(builderResources.ownerId, storageActor.subject))
            .orderBy(desc(builderResources.updatedAt))

    return mapDbBuilderResources(storageActor, rows)
  }

  if (actor.persona === "admin") {
    return memoryBuilderResources
  }
  return memoryBuilderResources.filter(
    (resource) => resource.ownerId === actor.subject,
  )
}

export async function getBuilderResource(
  actor: Actor,
  id: string,
): Promise<BuilderResource | undefined> {
  const db = getDb()
  if (db) {
    const storageActor = await upsertActorUser(actor)
    const rows = await db
      .select()
      .from(builderResources)
      .where(
        storageActor.persona === "admin"
          ? eq(builderResources.id, id)
          : and(
              eq(builderResources.id, id),
              eq(builderResources.ownerId, storageActor.subject),
            ),
      )
      .limit(1)

    const resources = await mapDbBuilderResources(storageActor, rows)
    return resources[0]
  }

  return (await getBuilderResources(actor)).find(
    (resource) => resource.id === id,
  )
}

export async function getBuilderSubmissions(
  actor: Actor,
): Promise<BuilderSubmission[]> {
  const db = getDb()
  if (db) {
    const resources = await getBuilderResources(actor)
    const resourceIds = resources.map((resource) => resource.id)
    if (resourceIds.length === 0) {
      return []
    }

    const events = await db
      .select()
      .from(builderLifecycleEvents)
      .where(inArray(builderLifecycleEvents.resourceId, resourceIds))
      .orderBy(desc(builderLifecycleEvents.createdAt))

    const versionIds = events
      .map((event) => event.resourceVersionId)
      .filter((id): id is string => Boolean(id))
    const versionRows =
      versionIds.length > 0
        ? await db
            .select()
            .from(builderResourceVersions)
            .where(inArray(builderResourceVersions.id, versionIds))
        : []

    return buildSubmissionsFromLifecycleEvents(resources, events, versionRows)
  }

  const resourceIds = new Set(
    (await getBuilderResources(actor)).map((resource) => resource.id),
  )
  return memoryBuilderSubmissions.filter((submission) =>
    resourceIds.has(submission.resourceId),
  )
}

export async function getBuilderAgentStudio(
  actor: Actor,
  resourceId: string,
): Promise<BuilderAgentStudio | undefined> {
  const storageActor = getDb() ? await upsertActorUser(actor) : actor
  const resource = await getBuilderResource(storageActor, resourceId)
  if (!resource || resource.type !== "agent") {
    return undefined
  }

  const config = await getAgentConfig(resource)
  const recentTestRuns = await getRecentAgentTestRuns(resource.id)
  const quota = await getAgentStudioQuota(resource.ownerId)
  return {
    resource,
    config,
    editable: canEditAgentStudio(storageActor, resource),
    testable: canEditAgentStudio(storageActor, resource),
    quota,
    recentTestRuns,
  }
}

export async function getBuilderAgentStudioQuotaPolicy(
  _actor: Actor,
): Promise<AdminBuilderAgentStudioQuotaPolicy> {
  return readBuilderAgentStudioQuotaPolicy()
}

export async function updateBuilderAgentStudioQuotaPolicy(
  actor: Actor,
  input: UpdateAdminBuilderAgentStudioQuotaPolicyRequest,
): Promise<AdminBuilderAgentStudioQuotaPolicy> {
  const now = new Date()
  const db = getDb()
  if (db) {
    const storageActor = await upsertActorUser(actor)
    await db
      .insert(builderAgentStudioQuotaPolicies)
      .values({
        id: builderAgentStudioQuotaPolicyId,
        runLimit: input.runLimit,
        tokenLimit: input.tokenLimit,
        updatedBy: storageActor.subject,
        note: input.note,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: builderAgentStudioQuotaPolicies.id,
        set: {
          runLimit: input.runLimit,
          tokenLimit: input.tokenLimit,
          updatedBy: storageActor.subject,
          note: input.note,
          updatedAt: now,
        },
      })
  } else {
    memoryBuilderAgentStudioQuotaPolicy = buildQuotaPolicy({
      runLimit: input.runLimit,
      tokenLimit: input.tokenLimit,
      source: "admin_override",
      sourceStatus: "ok",
      updatedAt: now.toISOString(),
      updatedBy: actor.subject,
    })
  }

  await emitAudit({
    actorId: actor.subject,
    action: "admin.builder_agent_studio_quota.update",
    targetType: "admin.builder_agent_studio_quota_policies",
    targetId: builderAgentStudioQuotaPolicyId,
    reason: input.note,
    metadata: {
      runLimit: input.runLimit,
      tokenLimit: input.tokenLimit,
      enforced: input.runLimit !== null || input.tokenLimit !== null,
    },
  })

  return readBuilderAgentStudioQuotaPolicy()
}

export async function updateBuilderAgentStudio(
  actor: Actor,
  resourceId: string,
  input: UpdateBuilderAgentStudioRequest,
): Promise<BuilderAgentStudio | undefined> {
  const db = getDb()
  if (db) {
    const storageActor = await upsertActorUser(actor)
    const resource = await getDbOwnedBuilderResource(storageActor, resourceId)
    if (!resource || resource.type !== "agent" || resource.state !== "draft") {
      return undefined
    }

    const now = new Date()
    const config = agentConfigFromInput(resourceId, input, now.toISOString())
    await db
      .update(builderResources)
      .set({
        name: input.name,
        description: input.description,
        updatedAt: now,
      })
      .where(
        and(
          eq(builderResources.id, resourceId),
          eq(builderResources.ownerId, storageActor.subject),
        ),
      )
    await db
      .insert(builderAgentConfigs)
      .values({
        resourceId,
        config,
        updatedBy: storageActor.subject,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: builderAgentConfigs.resourceId,
        set: {
          config,
          updatedBy: storageActor.subject,
          updatedAt: now,
        },
      })

    await emitAudit({
      actorId: actor.subject,
      action: "builder.agent_studio.update",
      targetType: "builder.agent_configs",
      targetId: resourceId,
      metadata: {
        model: config.model,
        sandboxProfile: config.sandboxProfile,
        toolCount: config.tools.length,
      },
    })

    return getBuilderAgentStudio(storageActor, resourceId)
  }

  const resource = getMutableOwnedBuilderResource(actor, resourceId)
  if (!resource || resource.type !== "agent" || resource.state !== "draft") {
    return undefined
  }

  const now = new Date().toISOString()
  resource.name = input.name
  resource.description = input.description
  resource.updatedAt = now
  const config = agentConfigFromInput(resourceId, input, now)
  memoryBuilderAgentConfigs.set(resourceId, config)

  await emitAudit({
    actorId: actor.subject,
    action: "builder.agent_studio.update",
    targetType: "builder.agent_configs",
    targetId: resourceId,
    metadata: {
      model: config.model,
      sandboxProfile: config.sandboxProfile,
      toolCount: config.tools.length,
    },
  })

  return getBuilderAgentStudio(actor, resourceId)
}

export async function clearBuilderAgentStudioTestRuns(
  actor: Actor,
  resourceId: string,
): Promise<BuilderAgentStudio | undefined> {
  const storageActor = getDb() ? await upsertActorUser(actor) : actor
  const resource = await getBuilderResource(storageActor, resourceId)
  if (
    !resource ||
    resource.type !== "agent" ||
    !canEditAgentStudio(storageActor, resource)
  ) {
    return undefined
  }

  const db = getDb()
  let clearedCount = 0
  if (db) {
    const deleted = await db
      .delete(builderAgentTestRuns)
      .where(
        and(
          eq(builderAgentTestRuns.resourceId, resourceId),
          eq(builderAgentTestRuns.actorId, storageActor.subject),
        ),
      )
      .returning({ id: builderAgentTestRuns.id })
    clearedCount = deleted.length
  } else {
    const before = memoryBuilderAgentTestRuns.length
    memoryBuilderAgentTestRuns = memoryBuilderAgentTestRuns.filter(
      (run) =>
        !(
          run.resourceId === resourceId &&
          memoryBuilderAgentTestRunOwners.get(run.id) === actor.subject
        ),
    )
    clearedCount = before - memoryBuilderAgentTestRuns.length
  }

  await emitAudit({
    actorId: actor.subject,
    action: "builder.agent_studio.test_runs.clear",
    targetType: "builder.agent_test_runs",
    targetId: resourceId,
    metadata: {
      clearedCount,
    },
  })

  return getBuilderAgentStudio(storageActor, resourceId)
}

export async function resetBuilderAgentStudioDraft(
  actor: Actor,
  resourceId: string,
): Promise<BuilderAgentStudio | undefined> {
  const storageActor = getDb() ? await upsertActorUser(actor) : actor
  const resource = await getBuilderResource(storageActor, resourceId)
  if (
    !resource ||
    resource.type !== "agent" ||
    !canEditAgentStudio(storageActor, resource)
  ) {
    return undefined
  }

  const now = new Date()
  const config = defaultAgentConfig({
    ...resource,
    updatedAt: now.toISOString(),
  })
  const db = getDb()
  if (db) {
    await db
      .insert(builderAgentConfigs)
      .values({
        resourceId,
        config,
        updatedBy: storageActor.subject,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: builderAgentConfigs.resourceId,
        set: {
          config,
          updatedBy: storageActor.subject,
          updatedAt: now,
        },
      })
    await db
      .update(builderResources)
      .set({ updatedAt: now })
      .where(eq(builderResources.id, resourceId))
  } else {
    memoryBuilderAgentConfigs.set(resourceId, config)
    const mutable = getMutableOwnedBuilderResource(actor, resourceId)
    if (mutable) {
      mutable.updatedAt = now.toISOString()
    }
  }

  await emitAudit({
    actorId: actor.subject,
    action: "builder.agent_studio.draft.reset",
    targetType: "builder.agent_configs",
    targetId: resourceId,
    metadata: {
      model: config.model,
      sandboxProfile: config.sandboxProfile,
      toolCount: config.tools.length,
    },
  })

  return getBuilderAgentStudio(storageActor, resourceId)
}

export async function testBuilderAgentStudio(
  actor: Actor,
  resourceId: string,
  input: string,
): Promise<
  | { ok: true; result: BuilderAgentTestResult }
  | {
      ok: false
      status: 429 | 503
      title: string
      detail: string
      testRunId?: string
      runtimeTraceId?: string
      quota?: BuilderAgentStudioQuota
    }
  | undefined
> {
  const storageActor = getDb() ? await upsertActorUser(actor) : actor
  const resource = await getBuilderResource(storageActor, resourceId)
  if (
    !resource ||
    resource.type !== "agent" ||
    !canEditAgentStudio(storageActor, resource)
  ) {
    return undefined
  }

  const config = await getAgentConfig(resource)
  const preflightQuota = await getAgentStudioQuota(storageActor.subject)
  const quotaBlockDetail = getAgentStudioQuotaBlockDetail(preflightQuota)
  if (quotaBlockDetail) {
    await emitAudit({
      actorId: actor.subject,
      action: "builder.agent_studio.test_blocked",
      targetType: "builder.resources",
      targetId: resourceId,
      reason: quotaBlockDetail,
      metadata: {
        source: "quota",
        quotaStatus: preflightQuota.status,
        usedRuns: preflightQuota.usedRuns,
        runLimit: preflightQuota.runLimit,
        usedTokens: preflightQuota.usedTokens,
        tokenLimit: preflightQuota.tokenLimit,
        resetsAt: preflightQuota.resetsAt,
      },
    })
    return {
      ok: false,
      status: 429,
      title: "Agent Studio quota reached",
      detail: quotaBlockDetail,
      quota: preflightQuota,
    }
  }

  const testRunId = randomUUID()
  const runtimeTraceId = randomUUID()
  const startedAt = Date.now()
  const trace = [
    agentTestTraceStep(
      "Quota preflight",
      "succeeded",
      describeQuotaTrace(preflightQuota),
    ),
  ]
  const execution = await executeAgentStudioTest(
    actor,
    config,
    input,
    runtimeTraceId,
  )
  const durationMs = Math.max(0, Date.now() - startedAt)
  if (!execution.ok) {
    trace.push(
      agentTestTraceStep("Runtime dispatch", "failed", execution.detail),
      agentTestTraceStep("Runtime accounting", "skipped", null),
      agentTestTraceStep(
        "Tool-call capture",
        execution.toolCalls.length === 0 ? "skipped" : "succeeded",
        describeToolCallTrace(execution.toolCalls),
      ),
      agentTestTraceStep("Run persistence", "succeeded", "Saved failure."),
    )
    await recordAgentTestRun(storageActor, config, {
      id: testRunId,
      resourceId,
      input,
      output: null,
      source: execution.source,
      status: "failed",
      model: execution.model,
      sandboxProfile: config.sandboxProfile,
      durationMs,
      runtimeTraceId,
      finishReason: execution.finishReason,
      promptTokens: execution.promptTokens,
      completionTokens: execution.completionTokens,
      totalTokens: execution.totalTokens,
      errorDetail: execution.detail,
      trace,
      toolCalls: execution.toolCalls,
      createdAt: new Date().toISOString(),
    })
    await emitAudit({
      actorId: actor.subject,
      action: "builder.agent_studio.test_failed",
      targetType: "builder.resources",
      targetId: resourceId,
      reason: execution.detail,
      metadata: {
        testRunId,
        runtimeTraceId,
        model: config.model,
        runtimeModel: execution.model,
        sandboxProfile: config.sandboxProfile,
        durationMs,
        source: execution.source,
        finishReason: execution.finishReason,
        promptTokens: execution.promptTokens,
        completionTokens: execution.completionTokens,
        totalTokens: execution.totalTokens,
        toolCallCount: execution.toolCalls.length,
        toolCalls: describeAuditToolCalls(execution.toolCalls),
        trace,
      },
    })
    return {
      ...execution,
      testRunId,
      runtimeTraceId,
      quota: await getAgentStudioQuota(storageActor.subject),
    }
  }

  trace.push(
    agentTestTraceStep(
      "Runtime dispatch",
      "succeeded",
      describeRuntimeTrace(execution.source),
    ),
    agentTestTraceStep(
      "Runtime accounting",
      execution.totalTokens === null ? "skipped" : "succeeded",
      describeAccountingTrace(execution),
    ),
    agentTestTraceStep(
      "Tool-call capture",
      execution.toolCalls.length === 0 ? "skipped" : "succeeded",
      describeToolCallTrace(execution.toolCalls),
    ),
    agentTestTraceStep("Run persistence", "succeeded", "Saved result."),
  )
  const run: BuilderAgentTestRun = {
    id: testRunId,
    resourceId,
    input,
    output: execution.output,
    source: execution.source,
    status: "succeeded",
    model: execution.model,
    sandboxProfile: config.sandboxProfile,
    durationMs,
    runtimeTraceId,
    finishReason: execution.finishReason,
    promptTokens: execution.promptTokens,
    completionTokens: execution.completionTokens,
    totalTokens: execution.totalTokens,
    errorDetail: null,
    trace,
    toolCalls: execution.toolCalls,
    createdAt: new Date().toISOString(),
  }
  await recordAgentTestRun(storageActor, config, run)
  const quota = await getAgentStudioQuota(storageActor.subject)
  const result: BuilderAgentTestResult = {
    ...run,
    output: execution.output,
    status: "succeeded",
    errorDetail: null,
    quota,
  }

  await emitAudit({
    actorId: actor.subject,
    action: "builder.agent_studio.test",
    targetType: "builder.resources",
    targetId: resourceId,
    metadata: {
      testRunId,
      runtimeTraceId: result.runtimeTraceId,
      inputLength: input.length,
      model: config.model,
      runtimeModel: result.model,
      sandboxProfile: config.sandboxProfile,
      source: result.source,
      durationMs,
      finishReason: result.finishReason,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      totalTokens: result.totalTokens,
      toolCallCount: result.toolCalls.length,
      toolCalls: describeAuditToolCalls(result.toolCalls),
      trace: result.trace,
      quotaStatus: quota.status,
      usedRuns: quota.usedRuns,
      runLimit: quota.runLimit,
      usedTokens: quota.usedTokens,
      tokenLimit: quota.tokenLimit,
    },
  })

  return { ok: true, result }
}

export async function streamBuilderAgentStudioTest(
  actor: Actor,
  resourceId: string,
  input: string,
  emit: (event: BuilderAgentTestStreamEvent) => Promise<void>,
  signal?: AbortSignal,
): Promise<boolean> {
  const storageActor = getDb() ? await upsertActorUser(actor) : actor
  const resource = await getBuilderResource(storageActor, resourceId)
  if (
    !resource ||
    resource.type !== "agent" ||
    !canEditAgentStudio(storageActor, resource)
  ) {
    return false
  }

  const config = await getAgentConfig(resource)
  const preflightQuota = await getAgentStudioQuota(storageActor.subject)
  const quotaBlockDetail = getAgentStudioQuotaBlockDetail(preflightQuota)
  if (quotaBlockDetail) {
    await emitAudit({
      actorId: actor.subject,
      action: "builder.agent_studio.test_blocked",
      targetType: "builder.resources",
      targetId: resourceId,
      reason: quotaBlockDetail,
      metadata: {
        source: "quota",
        quotaStatus: preflightQuota.status,
        usedRuns: preflightQuota.usedRuns,
        runLimit: preflightQuota.runLimit,
        usedTokens: preflightQuota.usedTokens,
        tokenLimit: preflightQuota.tokenLimit,
        resetsAt: preflightQuota.resetsAt,
      },
    })
    await emit({
      type: "builder.agent_test.failed",
      status: 429,
      title: "Agent Studio quota reached",
      detail: quotaBlockDetail,
      quota: preflightQuota,
    })
    return true
  }

  const testRunId = randomUUID()
  const runtimeTraceId = randomUUID()
  const startedAt = Date.now()
  const trace = [
    agentTestTraceStep(
      "Quota preflight",
      "succeeded",
      describeQuotaTrace(preflightQuota),
    ),
  ]
  await emit({
    type: "builder.agent_test.started",
    testRunId,
    runtimeTraceId,
  })

  const execution = await executeAgentStudioTest(
    actor,
    config,
    input,
    runtimeTraceId,
    {
      signal,
      stream: true,
      onToolCall: async (toolCall) => {
        await emit({
          type: "builder.agent_test.tool_call",
          testRunId,
          runtimeTraceId,
          toolCall,
        })
      },
      onDelta: async (delta) => {
        await emit({
          type: "builder.agent_test.delta",
          testRunId,
          runtimeTraceId,
          delta,
        })
      },
    },
  )
  const durationMs = Math.max(0, Date.now() - startedAt)
  if (!execution.ok) {
    trace.push(
      agentTestTraceStep("Runtime dispatch", "failed", execution.detail),
      agentTestTraceStep("Runtime accounting", "skipped", null),
      agentTestTraceStep(
        "Tool-call capture",
        execution.toolCalls.length === 0 ? "skipped" : "succeeded",
        describeToolCallTrace(execution.toolCalls),
      ),
      agentTestTraceStep("Run persistence", "succeeded", "Saved failure."),
    )
    await recordAgentTestRun(storageActor, config, {
      id: testRunId,
      resourceId,
      input,
      output: null,
      source: execution.source,
      status: "failed",
      model: execution.model,
      sandboxProfile: config.sandboxProfile,
      durationMs,
      runtimeTraceId,
      finishReason: execution.finishReason,
      promptTokens: execution.promptTokens,
      completionTokens: execution.completionTokens,
      totalTokens: execution.totalTokens,
      errorDetail: execution.detail,
      trace,
      toolCalls: execution.toolCalls,
      createdAt: new Date().toISOString(),
    })
    await emitAudit({
      actorId: actor.subject,
      action: "builder.agent_studio.test_failed",
      targetType: "builder.resources",
      targetId: resourceId,
      reason: execution.detail,
      metadata: {
        testRunId,
        runtimeTraceId,
        model: config.model,
        runtimeModel: execution.model,
        sandboxProfile: config.sandboxProfile,
        durationMs,
        source: execution.source,
        finishReason: execution.finishReason,
        promptTokens: execution.promptTokens,
        completionTokens: execution.completionTokens,
        totalTokens: execution.totalTokens,
        toolCallCount: execution.toolCalls.length,
        toolCalls: describeAuditToolCalls(execution.toolCalls),
        trace,
      },
    })
    await emit({
      type: "builder.agent_test.failed",
      status: execution.status,
      title: execution.title,
      detail: execution.detail,
      testRunId,
      runtimeTraceId,
      quota: await getAgentStudioQuota(storageActor.subject),
    })
    return true
  }

  trace.push(
    agentTestTraceStep(
      "Runtime dispatch",
      "succeeded",
      describeRuntimeTrace(execution.source),
    ),
    agentTestTraceStep(
      "Runtime accounting",
      execution.totalTokens === null ? "skipped" : "succeeded",
      describeAccountingTrace(execution),
    ),
    agentTestTraceStep(
      "Tool-call capture",
      execution.toolCalls.length === 0 ? "skipped" : "succeeded",
      describeToolCallTrace(execution.toolCalls),
    ),
    agentTestTraceStep("Run persistence", "succeeded", "Saved result."),
  )
  const run: BuilderAgentTestRun = {
    id: testRunId,
    resourceId,
    input,
    output: execution.output,
    source: execution.source,
    status: "succeeded",
    model: execution.model,
    sandboxProfile: config.sandboxProfile,
    durationMs,
    runtimeTraceId,
    finishReason: execution.finishReason,
    promptTokens: execution.promptTokens,
    completionTokens: execution.completionTokens,
    totalTokens: execution.totalTokens,
    errorDetail: null,
    trace,
    toolCalls: execution.toolCalls,
    createdAt: new Date().toISOString(),
  }
  await recordAgentTestRun(storageActor, config, run)
  const quota = await getAgentStudioQuota(storageActor.subject)
  const result: BuilderAgentTestResult = {
    ...run,
    output: execution.output,
    status: "succeeded",
    errorDetail: null,
    quota,
  }

  await emitAudit({
    actorId: actor.subject,
    action: "builder.agent_studio.test",
    targetType: "builder.resources",
    targetId: resourceId,
    metadata: {
      testRunId,
      runtimeTraceId: result.runtimeTraceId,
      inputLength: input.length,
      model: config.model,
      runtimeModel: result.model,
      sandboxProfile: config.sandboxProfile,
      source: result.source,
      durationMs,
      finishReason: result.finishReason,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      totalTokens: result.totalTokens,
      toolCallCount: result.toolCalls.length,
      toolCalls: describeAuditToolCalls(result.toolCalls),
      trace: result.trace,
      quotaStatus: quota.status,
      usedRuns: quota.usedRuns,
      runLimit: quota.runLimit,
      usedTokens: quota.usedTokens,
      tokenLimit: quota.tokenLimit,
    },
  })

  await emit({
    type: "builder.agent_test.completed",
    result,
  })
  return true
}

export async function forkBuilderTemplate(
  actor: Actor,
  templateId: string,
  input: { name?: string },
): Promise<BuilderResource | undefined> {
  const template = getBuilderTemplate(templateId)
  if (!template) {
    return undefined
  }

  const db = getDb()
  const storageActor = db ? await upsertActorUser(actor) : actor
  const now = new Date().toISOString()
  const resource = withResourceLinks({
    id: randomUUID(),
    type: template.type,
    name: input.name ?? template.name,
    description: template.description,
    ownerId: storageActor.subject,
    ownerName: storageActor.email ?? storageActor.subject,
    state: "draft",
    templateId: template.id,
    currentVersion: null,
    updatedAt: now,
    href: "",
    editorHref: "",
  })
  if (db) {
    await db.insert(builderResources).values({
      id: resource.id,
      type: resource.type,
      name: resource.name,
      description: resource.description,
      ownerId: resource.ownerId,
      state: resource.state,
      templateId: resource.templateId,
      currentVersionId: null,
      createdAt: new Date(now),
      updatedAt: new Date(now),
    })
    await db.insert(builderLifecycleEvents).values({
      id: randomUUID(),
      resourceId: resource.id,
      resourceVersionId: null,
      actorId: storageActor.subject,
      fromState: null,
      toState: "draft",
      comment: null,
      createdAt: new Date(now),
    })
    if (resource.type === "agent") {
      await db.insert(builderAgentConfigs).values({
        resourceId: resource.id,
        config: defaultAgentConfig(resource),
        updatedBy: storageActor.subject,
        updatedAt: new Date(now),
      })
    }
  } else {
    memoryBuilderResources = [resource, ...memoryBuilderResources]
    if (resource.type === "agent") {
      memoryBuilderAgentConfigs.set(resource.id, defaultAgentConfig(resource))
    }
  }

  await emitAudit({
    actorId: actor.subject,
    action: "builder.template.fork",
    targetType: "builder.resources",
    targetId: resource.id,
    metadata: {
      templateId,
      type: resource.type,
    },
  })
  await publishBuilderLifecycleEvent(actor, resource, {
    transition: "forked",
    createdAt: now,
  })

  return resource
}

export async function createBuilderResourceVersion(
  actor: Actor,
  resourceId: string,
  semver: string,
): Promise<BuilderResource | undefined> {
  const db = getDb()
  if (db) {
    const storageActor = await upsertActorUser(actor)
    const resource = await getDbMutableBuilderResource(storageActor, resourceId)
    if (!resource || resource.state !== "draft") {
      return undefined
    }

    const now = new Date()
    const versionId = randomUUID()
    await db.insert(builderResourceVersions).values({
      id: versionId,
      resourceId,
      semver,
      createdBy: storageActor.subject,
      createdAt: now,
    })
    await db
      .update(builderResources)
      .set({
        currentVersionId: versionId,
        updatedAt: now,
      })
      .where(eq(builderResources.id, resourceId))
    await db.insert(builderLifecycleEvents).values({
      id: randomUUID(),
      resourceId,
      resourceVersionId: versionId,
      actorId: storageActor.subject,
      fromState: resource.state,
      toState: resource.state,
      comment: null,
      createdAt: now,
    })

    await emitAudit({
      actorId: actor.subject,
      action: "builder.resource.version_cut",
      targetType: "builder.resources",
      targetId: resourceId,
      metadata: {
        versionId,
        semver,
      },
    })

    const updatedResource = await getBuilderResource(storageActor, resourceId)
    if (updatedResource) {
      await publishBuilderLifecycleEvent(actor, updatedResource, {
        transition: "version_cut",
        createdAt: now.toISOString(),
        version: semver,
      })
    }

    return updatedResource
  }

  const resource = getMutableBuilderResource(actor, resourceId)
  if (!resource || resource.state !== "draft") {
    return undefined
  }

  const now = new Date().toISOString()
  resource.currentVersion = {
    id: randomUUID(),
    semver,
    createdAt: now,
  }
  resource.updatedAt = now

  await emitAudit({
    actorId: actor.subject,
    action: "builder.resource.version_cut",
    targetType: "builder.resources",
    targetId: resource.id,
    metadata: {
      versionId: resource.currentVersion.id,
      semver,
    },
  })
  await publishBuilderLifecycleEvent(actor, resource, {
    transition: "version_cut",
    createdAt: now,
    version: semver,
  })

  return { ...resource }
}

export async function submitBuilderResource(
  actor: Actor,
  resourceId: string,
): Promise<BuilderSubmission | undefined> {
  const db = getDb()
  if (db) {
    const storageActor = await upsertActorUser(actor)
    const resource = await getDbMutableBuilderResource(storageActor, resourceId)
    if (!resource || resource.state !== "draft" || !resource.currentVersion) {
      return undefined
    }

    const now = new Date()
    const submissionId = randomUUID()
    await db
      .update(builderResources)
      .set({
        state: "submitted",
        updatedAt: now,
      })
      .where(eq(builderResources.id, resourceId))
    await db.insert(builderLifecycleEvents).values({
      id: submissionId,
      resourceId,
      resourceVersionId: resource.currentVersion.id,
      actorId: storageActor.subject,
      fromState: "draft",
      toState: "submitted",
      comment: null,
      createdAt: now,
    })

    const submission = withSubmissionLink({
      id: submissionId,
      resourceId: resource.id,
      resourceName: resource.name,
      resourceType: resource.type,
      submittedVersion: resource.currentVersion.semver,
      state: "submitted",
      adminComment: null,
      submittedAt: now.toISOString(),
      decidedAt: null,
      href: "",
    })

    await emitAudit({
      actorId: actor.subject,
      action: "builder.resource.submit",
      targetType: "builder.resources",
      targetId: resource.id,
      metadata: {
        submissionId: submission.id,
        submittedVersion: submission.submittedVersion,
      },
    })
    await publishBuilderLifecycleEvent(
      actor,
      {
        ...resource,
        state: "submitted",
        updatedAt: now.toISOString(),
      },
      {
        transition: "submitted",
        createdAt: now.toISOString(),
        submission,
      },
    )

    return submission
  }

  const resource = getMutableBuilderResource(actor, resourceId)
  if (!resource || resource.state !== "draft" || !resource.currentVersion) {
    return undefined
  }

  const now = new Date().toISOString()
  resource.state = "submitted"
  resource.updatedAt = now

  const submission = withSubmissionLink({
    id: randomUUID(),
    resourceId: resource.id,
    resourceName: resource.name,
    resourceType: resource.type,
    submittedVersion: resource.currentVersion.semver,
    state: "submitted",
    adminComment: null,
    submittedAt: now,
    decidedAt: null,
    href: "",
  })
  memoryBuilderSubmissions = [submission, ...memoryBuilderSubmissions]

  await emitAudit({
    actorId: actor.subject,
    action: "builder.resource.submit",
    targetType: "builder.resources",
    targetId: resource.id,
    metadata: {
      submissionId: submission.id,
      submittedVersion: submission.submittedVersion,
    },
  })
  await publishBuilderLifecycleEvent(actor, resource, {
    transition: "submitted",
    createdAt: now,
    submission,
  })

  return submission
}

export async function approveBuilderResource(
  actor: Actor,
  resourceId: string,
): Promise<BuilderSubmission | undefined> {
  const db = getDb()
  if (db) {
    const storageActor = await upsertActorUser(actor)
    const resource = await getDbAdminResource(resourceId)
    if (!resource || resource.state !== "submitted") {
      return undefined
    }

    const submission = await getDbOpenSubmission(resource)
    if (!submission) {
      return undefined
    }

    const now = new Date()
    await db
      .update(builderResources)
      .set({
        state: "published",
        updatedAt: now,
      })
      .where(eq(builderResources.id, resourceId))
    await db.insert(builderLifecycleEvents).values({
      id: randomUUID(),
      resourceId,
      resourceVersionId: resource.currentVersion?.id ?? null,
      actorId: storageActor.subject,
      fromState: "submitted",
      toState: "published",
      comment: null,
      createdAt: now,
    })

    const decidedSubmission = {
      ...submission,
      state: "published" as const,
      decidedAt: now.toISOString(),
    }

    await emitAudit({
      actorId: actor.subject,
      action: "admin.builder_resource.approve",
      targetType: "builder.resources",
      targetId: resource.id,
      metadata: {
        submissionId: submission.id,
        submittedVersion: submission.submittedVersion,
      },
    })
    const publishedResource: BuilderResource = {
      ...resource,
      state: "published",
      updatedAt: now.toISOString(),
    }
    await publishBuilderLifecycleEvent(actor, publishedResource, {
      transition: "published",
      createdAt: now.toISOString(),
      submission: decidedSubmission,
    })
    await publishBuilderLifecycleEvent(
      ownerActorForResource(resource),
      publishedResource,
      {
        transition: "published",
        createdAt: now.toISOString(),
        submission: decidedSubmission,
      },
    )

    return decidedSubmission
  }

  const resource = getMutableAdminResource(resourceId)
  const submission = getMutableOpenSubmission(resourceId)
  if (!resource || !submission || resource.state !== "submitted") {
    return undefined
  }

  const now = new Date().toISOString()
  resource.state = "published"
  resource.updatedAt = now
  submission.state = "published"
  submission.decidedAt = now

  await emitAudit({
    actorId: actor.subject,
    action: "admin.builder_resource.approve",
    targetType: "builder.resources",
    targetId: resource.id,
    metadata: {
      submissionId: submission.id,
      submittedVersion: submission.submittedVersion,
    },
  })
  await publishBuilderLifecycleEvent(actor, resource, {
    transition: "published",
    createdAt: now,
    submission,
  })
  await publishBuilderLifecycleEvent(
    ownerActorForResource(resource),
    resource,
    {
      transition: "published",
      createdAt: now,
      submission,
    },
  )

  return { ...submission }
}

export async function rejectBuilderResource(
  actor: Actor,
  resourceId: string,
  comment: string,
): Promise<BuilderSubmission | undefined> {
  const db = getDb()
  if (db) {
    const storageActor = await upsertActorUser(actor)
    const resource = await getDbAdminResource(resourceId)
    if (!resource || resource.state !== "submitted") {
      return undefined
    }

    const submission = await getDbOpenSubmission(resource)
    if (!submission) {
      return undefined
    }

    const now = new Date()
    await db
      .update(builderResources)
      .set({
        state: "draft",
        updatedAt: now,
      })
      .where(eq(builderResources.id, resourceId))
    await db.insert(builderLifecycleEvents).values({
      id: randomUUID(),
      resourceId,
      resourceVersionId: resource.currentVersion?.id ?? null,
      actorId: storageActor.subject,
      fromState: "submitted",
      toState: "rejected",
      comment,
      createdAt: now,
    })

    const decidedSubmission = {
      ...submission,
      state: "rejected" as const,
      adminComment: comment,
      decidedAt: now.toISOString(),
    }

    await emitAudit({
      actorId: actor.subject,
      action: "admin.builder_resource.reject",
      targetType: "builder.resources",
      targetId: resource.id,
      reason: comment,
      metadata: {
        submissionId: submission.id,
        submittedVersion: submission.submittedVersion,
      },
    })
    const rejectedResource: BuilderResource = {
      ...resource,
      state: "draft",
      updatedAt: now.toISOString(),
    }
    await publishBuilderLifecycleEvent(actor, rejectedResource, {
      transition: "rejected",
      createdAt: now.toISOString(),
      submission: decidedSubmission,
      comment,
    })
    await publishBuilderLifecycleEvent(
      ownerActorForResource(resource),
      rejectedResource,
      {
        transition: "rejected",
        createdAt: now.toISOString(),
        submission: decidedSubmission,
        comment,
      },
    )

    return decidedSubmission
  }

  const resource = getMutableAdminResource(resourceId)
  const submission = getMutableOpenSubmission(resourceId)
  if (!resource || !submission || resource.state !== "submitted") {
    return undefined
  }

  const now = new Date().toISOString()
  resource.state = "draft"
  resource.updatedAt = now
  submission.state = "rejected"
  submission.adminComment = comment
  submission.decidedAt = now

  await emitAudit({
    actorId: actor.subject,
    action: "admin.builder_resource.reject",
    targetType: "builder.resources",
    targetId: resource.id,
    reason: comment,
    metadata: {
      submissionId: submission.id,
      submittedVersion: submission.submittedVersion,
    },
  })
  await publishBuilderLifecycleEvent(actor, resource, {
    transition: "rejected",
    createdAt: now,
    submission,
    comment,
  })
  await publishBuilderLifecycleEvent(
    ownerActorForResource(resource),
    resource,
    {
      transition: "rejected",
      createdAt: now,
      submission,
      comment,
    },
  )

  return { ...submission }
}

export async function withdrawBuilderResource(
  actor: Actor,
  resourceId: string,
): Promise<BuilderSubmission | undefined> {
  const db = getDb()
  if (db) {
    const storageActor = await upsertActorUser(actor)
    const resource = await getDbOwnedBuilderResource(storageActor, resourceId)
    if (!resource || resource.state !== "submitted") {
      return undefined
    }

    const submission = await getDbOpenSubmission(resource)
    if (!submission) {
      return undefined
    }

    const now = new Date()
    await db
      .update(builderResources)
      .set({
        state: "draft",
        updatedAt: now,
      })
      .where(eq(builderResources.id, resourceId))
    await db.insert(builderLifecycleEvents).values({
      id: randomUUID(),
      resourceId,
      resourceVersionId: resource.currentVersion?.id ?? null,
      actorId: storageActor.subject,
      fromState: "submitted",
      toState: "withdrawn",
      comment: null,
      createdAt: now,
    })

    const withdrawnSubmission = {
      ...submission,
      state: "withdrawn" as const,
      decidedAt: now.toISOString(),
    }

    await emitAudit({
      actorId: actor.subject,
      action: "builder.resource.withdraw_submission",
      targetType: "builder.resources",
      targetId: resource.id,
      metadata: {
        submissionId: submission.id,
        submittedVersion: submission.submittedVersion,
      },
    })

    await publishBuilderLifecycleEvent(
      actor,
      {
        ...resource,
        state: "draft",
        updatedAt: now.toISOString(),
      },
      {
        transition: "withdrawn",
        createdAt: now.toISOString(),
        submission: withdrawnSubmission,
      },
    )

    return withdrawnSubmission
  }

  const resource = getMutableOwnedBuilderResource(actor, resourceId)
  const submission = getMutableOpenSubmission(resourceId)
  if (!resource || !submission || resource.state !== "submitted") {
    return undefined
  }

  const now = new Date().toISOString()
  resource.state = "draft"
  resource.updatedAt = now
  submission.state = "withdrawn"
  submission.decidedAt = now

  await emitAudit({
    actorId: actor.subject,
    action: "builder.resource.withdraw_submission",
    targetType: "builder.resources",
    targetId: resource.id,
    metadata: {
      submissionId: submission.id,
      submittedVersion: submission.submittedVersion,
    },
  })
  await publishBuilderLifecycleEvent(actor, resource, {
    transition: "withdrawn",
    createdAt: now,
    submission,
  })

  return { ...submission }
}

export function resetBuilderStateForTest(): void {
  memoryBuilderResources = initialMemoryBuilderResources()
  memoryBuilderSubmissions = initialMemoryBuilderSubmissions()
  memoryBuilderAgentConfigs = initialMemoryBuilderConfigs()
  memoryBuilderAgentTestRuns = []
  memoryBuilderAgentTestRunOwners = new Map()
  memoryBuilderAgentStudioQuotaPolicy = null
}

function initialMemoryBuilderResources(): BuilderResource[] {
  return canUseBffFixtureData() ? structuredClone(initialBuilderResources) : []
}

function initialMemoryBuilderSubmissions(): BuilderSubmission[] {
  return canUseBffFixtureData()
    ? structuredClone(initialBuilderSubmissions)
    : []
}

function initialMemoryBuilderConfigs(): Map<string, BuilderAgentStudioConfig> {
  if (!canUseBffFixtureData()) {
    return new Map()
  }
  return initialBuilderResources.reduce((configs, resource) => {
    if (resource.type === "agent") {
      configs.set(resource.id, defaultAgentConfig(resource))
    }
    return configs
  }, new Map<string, BuilderAgentStudioConfig>())
}

function getMutableBuilderResource(
  actor: Actor,
  id: string,
): BuilderResource | undefined {
  return memoryBuilderResources.find(
    (resource) =>
      resource.id === id &&
      (actor.persona === "admin" || resource.ownerId === actor.subject),
  )
}

function getMutableOwnedBuilderResource(
  actor: Actor,
  id: string,
): BuilderResource | undefined {
  return memoryBuilderResources.find(
    (resource) => resource.id === id && resource.ownerId === actor.subject,
  )
}

function getMutableAdminResource(id: string): BuilderResource | undefined {
  return memoryBuilderResources.find((resource) => resource.id === id)
}

function getMutableOpenSubmission(
  resourceId: string,
): BuilderSubmission | undefined {
  return memoryBuilderSubmissions.find(
    (submission) =>
      submission.resourceId === resourceId && submission.state === "submitted",
  )
}

async function getAgentConfig(
  resource: BuilderResource,
): Promise<BuilderAgentStudioConfig> {
  const db = getDb()
  if (db) {
    const rows = await db
      .select()
      .from(builderAgentConfigs)
      .where(eq(builderAgentConfigs.resourceId, resource.id))
      .limit(1)
    const parsed = builderAgentStudioConfigSchema.safeParse(rows[0]?.config)
    if (parsed.success) {
      return {
        ...parsed.data,
        resourceId: resource.id,
      }
    }
  }

  return (
    memoryBuilderAgentConfigs.get(resource.id) ?? defaultAgentConfig(resource)
  )
}

async function getRecentAgentTestRuns(
  resourceId: string,
): Promise<BuilderAgentTestRun[]> {
  const db = getDb()
  if (db) {
    const rows = await db
      .select()
      .from(builderAgentTestRuns)
      .where(eq(builderAgentTestRuns.resourceId, resourceId))
      .orderBy(desc(builderAgentTestRuns.createdAt))
      .limit(5)

    return rows.map(mapDbAgentTestRun)
  }

  return memoryBuilderAgentTestRuns
    .filter((run) => run.resourceId === resourceId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, 5)
}

async function getAgentStudioQuota(
  actorId: string,
  now = new Date(),
): Promise<BuilderAgentStudioQuota> {
  const config = await getAgentStudioQuotaConfig()
  const window = getAgentStudioQuotaWindow(now)
  const db = getDb()
  const runs = db
    ? await db
        .select({
          totalTokens: builderAgentTestRuns.totalTokens,
        })
        .from(builderAgentTestRuns)
        .where(
          and(
            eq(builderAgentTestRuns.actorId, actorId),
            gte(builderAgentTestRuns.createdAt, window.startsAt),
          ),
        )
    : memoryBuilderAgentTestRuns
        .filter(
          (run) =>
            memoryBuilderAgentTestRunOwners.get(run.id) === actorId &&
            new Date(run.createdAt) >= window.startsAt,
        )
        .map((run) => ({ totalTokens: run.totalTokens }))

  const usedRuns = runs.length
  const usedTokens = runs.reduce(
    (total, run) => total + (run.totalTokens ?? 0),
    0,
  )
  const remainingRuns = remainingQuota(config.runLimit, usedRuns)
  const remainingTokens = remainingQuota(config.tokenLimit, usedTokens)
  const enforced = config.runLimit !== null || config.tokenLimit !== null

  return {
    period: "daily",
    timezone: "UTC",
    status: quotaStatus({
      enforced,
      runLimit: config.runLimit,
      remainingRuns,
      tokenLimit: config.tokenLimit,
      remainingTokens,
    }),
    enforced,
    usedRuns,
    runLimit: config.runLimit,
    remainingRuns,
    usedTokens,
    tokenLimit: config.tokenLimit,
    remainingTokens,
    resetsAt: window.resetsAt.toISOString(),
  }
}

function getAgentStudioQuotaBlockDetail(
  quota: BuilderAgentStudioQuota,
): string | null {
  if (quota.remainingRuns === 0) {
    return `Daily Agent Studio test-run quota reached. Try again after ${quota.resetsAt}.`
  }
  if (quota.remainingTokens === 0) {
    return `Daily Agent Studio token quota reached. Try again after ${quota.resetsAt}.`
  }
  return null
}

function agentTestTraceStep(
  label: string,
  status: BuilderAgentTestTraceStep["status"],
  detail: string | null,
): BuilderAgentTestTraceStep {
  return {
    at: new Date().toISOString(),
    label,
    status,
    detail,
  }
}

function describeQuotaTrace(quota: BuilderAgentStudioQuota): string {
  if (!quota.enforced) {
    return "Daily quota is not enforced."
  }
  const runText =
    quota.runLimit === null
      ? "runs unlimited"
      : `${quota.remainingRuns ?? 0} runs remaining`
  const tokenText =
    quota.tokenLimit === null
      ? "tokens unlimited"
      : `${quota.remainingTokens ?? 0} tokens remaining`
  return `${runText}; ${tokenText}.`
}

function describeRuntimeTrace(source: BuilderAgentTestSource): string {
  return source === "agentic_runtime"
    ? "OpenClaw-compatible runtime completed."
    : "Local preview completed."
}

function describeAccountingTrace(input: {
  totalTokens: number | null
}): string | null {
  return input.totalTokens === null
    ? "Runtime did not return token usage."
    : `${input.totalTokens.toLocaleString()} total tokens recorded.`
}

function describeToolCallTrace(
  toolCalls: BuilderAgentTestToolCall[],
): string | null {
  if (toolCalls.length === 0) {
    return "Runtime did not request tools."
  }
  const names = toolCalls.map((toolCall) => toolCall.name).join(", ")
  return `${toolCalls.length.toLocaleString()} tool call event${
    toolCalls.length === 1 ? "" : "s"
  } captured: ${names}.`
}

function describeAuditToolCalls(toolCalls: BuilderAgentTestToolCall[]) {
  return toolCalls.map((toolCall) => ({
    id: toolCall.id,
    index: toolCall.index,
    name: toolCall.name,
    status: toolCall.status,
  }))
}

const builderAgentStudioQuotaPolicyId = "builder_agent_studio"

async function readBuilderAgentStudioQuotaPolicy(): Promise<AdminBuilderAgentStudioQuotaPolicy> {
  const db = getDb()
  if (db) {
    const rows = await db
      .select()
      .from(builderAgentStudioQuotaPolicies)
      .where(
        eq(builderAgentStudioQuotaPolicies.id, builderAgentStudioQuotaPolicyId),
      )
      .limit(1)
    const row = rows[0]
    if (row) {
      return buildQuotaPolicy({
        runLimit: normalizeQuotaLimit(row.runLimit),
        tokenLimit: normalizeQuotaLimit(row.tokenLimit),
        source: "admin_override",
        sourceStatus: "ok",
        updatedAt: row.updatedAt.toISOString(),
        updatedBy: row.updatedBy,
      })
    }
  } else if (memoryBuilderAgentStudioQuotaPolicy) {
    return {
      ...memoryBuilderAgentStudioQuotaPolicy,
      generatedAt: new Date().toISOString(),
    }
  }

  return buildQuotaPolicy({
    runLimit: readOptionalQuotaLimit("BUILDER_AGENT_STUDIO_DAILY_RUN_LIMIT"),
    tokenLimit: readOptionalQuotaLimit(
      "BUILDER_AGENT_STUDIO_DAILY_TOKEN_LIMIT",
    ),
    source: "environment",
    sourceStatus: db ? "ok" : "not_configured",
    updatedAt: null,
    updatedBy: null,
  })
}

function buildQuotaPolicy(input: {
  runLimit: number | null
  source: AdminBuilderAgentStudioQuotaPolicy["source"]
  sourceStatus: AdminBuilderAgentStudioQuotaPolicy["sourceStatus"]
  tokenLimit: number | null
  updatedAt: string | null
  updatedBy: string | null
}): AdminBuilderAgentStudioQuotaPolicy {
  return {
    generatedAt: new Date().toISOString(),
    sourceStatus: input.sourceStatus,
    period: "daily",
    timezone: "UTC",
    source: input.source,
    enforced: input.runLimit !== null || input.tokenLimit !== null,
    runLimit: input.runLimit,
    tokenLimit: input.tokenLimit,
    updatedAt: input.updatedAt,
    updatedBy: input.updatedBy,
  }
}

async function getAgentStudioQuotaConfig(): Promise<{
  runLimit: number | null
  tokenLimit: number | null
}> {
  const policy = await readBuilderAgentStudioQuotaPolicy()
  return {
    runLimit: policy.runLimit,
    tokenLimit: policy.tokenLimit,
  }
}

function readOptionalQuotaLimit(name: string): number | null {
  const raw = process.env[name]?.trim()
  if (!raw) {
    return null
  }
  const value = Number(raw)
  return Number.isInteger(value) && value >= 0 ? value : null
}

function normalizeQuotaLimit(value: number | null): number | null {
  return value !== null && Number.isInteger(value) && value >= 0 ? value : null
}

function getAgentStudioQuotaWindow(now: Date): {
  startsAt: Date
  resetsAt: Date
} {
  const startsAt = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  )
  const resetsAt = new Date(startsAt)
  resetsAt.setUTCDate(resetsAt.getUTCDate() + 1)
  return { startsAt, resetsAt }
}

function remainingQuota(limit: number | null, used: number): number | null {
  return limit === null ? null : Math.max(0, limit - used)
}

function quotaStatus(input: {
  enforced: boolean
  runLimit: number | null
  remainingRuns: number | null
  tokenLimit: number | null
  remainingTokens: number | null
}): BuilderAgentStudioQuota["status"] {
  if (!input.enforced) {
    return "unlimited"
  }
  if (input.remainingRuns === 0 || input.remainingTokens === 0) {
    return "exhausted"
  }
  if (
    isNearQuotaLimit(input.runLimit, input.remainingRuns) ||
    isNearQuotaLimit(input.tokenLimit, input.remainingTokens)
  ) {
    return "near_limit"
  }
  return "ok"
}

function isNearQuotaLimit(
  limit: number | null,
  remaining: number | null,
): boolean {
  if (limit === null || remaining === null || limit <= 0) {
    return false
  }
  return remaining / limit <= 0.1
}

async function recordAgentTestRun(
  actor: Actor,
  config: BuilderAgentStudioConfig,
  run: BuilderAgentTestRun,
): Promise<void> {
  const db = getDb()
  if (db) {
    const storageActor = await upsertActorUser(actor)
    await db.insert(builderAgentTestRuns).values({
      id: run.id,
      resourceId: run.resourceId,
      actorId: storageActor.subject,
      input: run.input,
      output: run.output,
      source: run.source,
      status: run.status,
      model: run.model,
      sandboxProfile: run.sandboxProfile,
      durationMs: run.durationMs,
      runtimeTraceId: run.runtimeTraceId,
      finishReason: run.finishReason,
      promptTokens: run.promptTokens,
      completionTokens: run.completionTokens,
      totalTokens: run.totalTokens,
      errorDetail: run.errorDetail,
      trace: run.trace,
      toolCalls: run.toolCalls,
      createdAt: new Date(run.createdAt),
    })
    return
  }

  memoryBuilderAgentTestRuns = [
    {
      ...run,
      model: run.model ?? config.model,
      sandboxProfile: run.sandboxProfile ?? config.sandboxProfile,
    },
    ...memoryBuilderAgentTestRuns,
  ].slice(0, 50)
  memoryBuilderAgentTestRunOwners.set(run.id, actor.subject)
}

function defaultAgentConfig(
  resource: BuilderResource,
): BuilderAgentStudioConfig {
  const isReviewAgent = resource.templateId === "template-pr-reviewer"
  return {
    resourceId: resource.id,
    model: "qwen3-35b-local",
    sandboxProfile: "openclaw-restricted",
    systemPrompt: isReviewAgent
      ? "You are a careful code-review agent for appliance-local repositories."
      : "You are a concise summarization agent for appliance-local work context.",
    instructions: isReviewAgent
      ? "Review the provided change for regressions, missing tests, risky assumptions, and rollout notes. Keep the response structured and specific."
      : "Summarize the provided context into the most important facts, decisions, risks, and next actions. Keep the response concise.",
    temperature: 0.2,
    maxOutputTokens: 1024,
    tools: [],
    sampleInput: isReviewAgent
      ? "Review this patch for auth regressions and missing tests."
      : "Summarize this incident report for an executive.",
    updatedAt: resource.updatedAt,
  }
}

function agentConfigFromInput(
  resourceId: string,
  input: UpdateBuilderAgentStudioRequest,
  updatedAt: string,
): BuilderAgentStudioConfig {
  return {
    resourceId,
    model: input.model,
    sandboxProfile: input.sandboxProfile,
    systemPrompt: input.systemPrompt,
    instructions: input.instructions,
    temperature: input.temperature,
    maxOutputTokens: input.maxOutputTokens,
    tools: input.tools,
    sampleInput: input.sampleInput,
    updatedAt,
  }
}

function canEditAgentStudio(actor: Actor, resource: BuilderResource): boolean {
  return resource.ownerId === actor.subject && resource.state === "draft"
}

async function executeAgentStudioTest(
  actor: Actor,
  config: BuilderAgentStudioConfig,
  input: string,
  runtimeTraceId: string,
  options: AgentStudioTestExecutionOptions = {},
): Promise<AgentStudioTestExecution> {
  const requestedModel = process.env.AGENTIC_OPENCLAW_MODEL ?? config.model
  const localAccounting = emptyRuntimeAccounting(requestedModel)
  const baseUrl = process.env.AGENTIC_OPENCLAW_BASE_URL?.replace(/\/+$/, "")
  if (!baseUrl) {
    if (!canUseBffFixtureData()) {
      return agentStudioRuntimeFailure(
        "OpenClaw runtime is not configured.",
        localAccounting,
      )
    }
    const output = renderLocalAgentStudioPreview(config, input)
    await options.onDelta?.(output)
    return {
      ok: true,
      output,
      source: "local_preview",
      ...localAccounting,
    }
  }

  try {
    const response = await fetch(getOpenClawChatCompletionsUrl(baseUrl), {
      method: "POST",
      headers: getOpenClawHeaders(actor, runtimeTraceId),
      body: JSON.stringify({
        model: requestedModel,
        messages: [
          {
            role: "system",
            content: [config.systemPrompt, config.instructions].join("\n\n"),
          },
          {
            role: "user",
            content: input,
          },
        ],
        temperature: config.temperature,
        max_tokens: config.maxOutputTokens,
        stream: options.stream === true,
      }),
      signal: agentStudioTimeoutSignal(options.signal),
    })

    if (!response.ok) {
      return agentStudioRuntimeFailure(
        `OpenClaw returned HTTP ${response.status}: ${await readRuntimeError(
          response,
        )}`,
        localAccounting,
      )
    }

    const contentType = response.headers.get("content-type") ?? ""
    if (options.stream && contentType.includes("text/event-stream")) {
      if (!response.body) {
        return agentStudioRuntimeFailure(
          "OpenClaw returned an empty streaming body.",
          localAccounting,
        )
      }
      const streamed = await relayAgentStudioOpenAIStream(
        response.body,
        options.onDelta ?? (async () => undefined),
        options.onToolCall ?? (async () => undefined),
        requestedModel,
      )
      if (!streamed.ok) {
        return agentStudioRuntimeFailure(streamed.detail, localAccounting)
      }
      if (!streamed.output.trim() && streamed.accounting.toolCalls.length > 0) {
        streamed.output = renderToolCallOutput(streamed.accounting.toolCalls)
      }
      if (!streamed.output.trim()) {
        return agentStudioRuntimeFailure(
          "OpenClaw returned a streaming response without assistant content.",
          streamed.accounting,
        )
      }

      return {
        ok: true,
        output: streamed.output,
        source: "agentic_runtime",
        ...streamed.accounting,
      }
    }

    const body = (await response.json()) as unknown
    const accounting = extractRuntimeAccounting(body, requestedModel)
    const content =
      extractRuntimeContent(body) ??
      (accounting.toolCalls.length > 0
        ? renderToolCallOutput(accounting.toolCalls)
        : null)
    if (!content) {
      return agentStudioRuntimeFailure(
        describeMissingRuntimeContent(body),
        accounting,
      )
    }

    return {
      ok: true,
      output: content,
      source: "agentic_runtime",
      ...accounting,
    }
  } catch (error) {
    return agentStudioRuntimeFailure(
      error instanceof Error
        ? `OpenClaw request failed: ${error.message}`
        : "OpenClaw request failed.",
      localAccounting,
    )
  }
}

function renderLocalAgentStudioPreview(
  config: BuilderAgentStudioConfig,
  input: string,
): string {
  const compactInput = input.replace(/\s+/g, " ").trim()
  const excerpt =
    compactInput.length > 220
      ? `${compactInput.slice(0, 217).trimEnd()}...`
      : compactInput

  return [
    "Local Agent Studio preview.",
    "",
    `Model: ${config.model}`,
    `Sandbox: ${config.sandboxProfile}`,
    "",
    `System intent: ${config.systemPrompt}`,
    "",
    `Test response: ${excerpt}`,
    "",
    "Runtime-backed Studio tests use the configured OpenClaw profile when available.",
  ].join("\n")
}

function getOpenClawHeaders(
  actor: Actor,
  runtimeTraceId: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-LLM-Machines-Trace-Id": runtimeTraceId,
    "X-LLM-Machines-Actor": actor.subject,
    "X-Request-Id": runtimeTraceId,
  }
  if (process.env.AGENTIC_OPENCLAW_TOKEN) {
    headers.Authorization = `Bearer ${process.env.AGENTIC_OPENCLAW_TOKEN}`
  }
  return headers
}

function getOpenClawChatCompletionsUrl(baseUrl: string): URL {
  const path =
    process.env.AGENTIC_OPENCLAW_CHAT_COMPLETIONS_PATH ?? "/v1/chat/completions"
  return new URL(path.startsWith("/") ? path : `/${path}`, baseUrl)
}

function getAgentStudioTimeoutMs(): number {
  const parsed = Number(process.env.AGENTIC_RUNTIME_TIMEOUT_MS)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30000
}

function agentStudioTimeoutSignal(parent?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(getAgentStudioTimeoutMs())
  return parent ? AbortSignal.any([parent, timeout]) : timeout
}

async function relayAgentStudioOpenAIStream(
  body: ReadableStream<Uint8Array>,
  onDelta: (content: string) => Promise<void>,
  onToolCall: (toolCall: BuilderAgentTestToolCall) => Promise<void>,
  fallbackModel: string,
): Promise<
  | {
      ok: true
      output: string
      accounting: AgentStudioRuntimeAccounting
    }
  | {
      ok: false
      detail: string
    }
> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  const content: string[] = []
  let accounting = emptyRuntimeAccounting(fallbackModel)
  let buffer = ""

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }

      buffer += decoder.decode(value, { stream: true })
      const result = await drainAgentStudioSseFrames(
        buffer,
        fallbackModel,
        accounting,
        onToolCall,
        async (delta) => {
          content.push(delta)
          await onDelta(delta)
        },
      )
      if (!result.ok) {
        return result
      }
      buffer = result.remainder
      accounting = result.accounting
    }

    buffer += decoder.decode()
    if (buffer.trim()) {
      const result = await drainAgentStudioSseFrames(
        `${buffer}\n\n`,
        fallbackModel,
        accounting,
        onToolCall,
        async (delta) => {
          content.push(delta)
          await onDelta(delta)
        },
      )
      if (!result.ok) {
        return result
      }
      accounting = result.accounting
    }
  } finally {
    reader.releaseLock()
  }

  return {
    ok: true,
    output: content.join(""),
    accounting,
  }
}

async function drainAgentStudioSseFrames(
  input: string,
  fallbackModel: string,
  initialAccounting: AgentStudioRuntimeAccounting,
  onToolCall: (toolCall: BuilderAgentTestToolCall) => Promise<void>,
  onDelta: (content: string) => Promise<void>,
): Promise<
  | {
      ok: true
      remainder: string
      accounting: AgentStudioRuntimeAccounting
    }
  | {
      ok: false
      detail: string
    }
> {
  const frames = input.split(/\r?\n\r?\n/)
  const remainder = frames.pop() ?? ""
  let accounting = initialAccounting

  for (const frame of frames) {
    const data = frame
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trimStart())
      .join("\n")
      .trim()
    if (!data || data === "[DONE]") {
      continue
    }

    try {
      const payload = JSON.parse(data) as unknown
      const frameAccounting = extractRuntimeAccounting(payload, fallbackModel)
      accounting = mergeRuntimeAccounting(accounting, frameAccounting)
      for (const toolCall of frameAccounting.toolCalls) {
        await onToolCall(toolCall)
      }
      const content = extractStreamingDeltaContent(payload)
      if (content) {
        await onDelta(content)
      }
    } catch {
      return {
        ok: false,
        detail: "OpenClaw returned a malformed streaming frame.",
      }
    }
  }

  return { ok: true, remainder, accounting }
}

function mergeRuntimeAccounting(
  current: AgentStudioRuntimeAccounting,
  next: AgentStudioRuntimeAccounting,
): AgentStudioRuntimeAccounting {
  return {
    model: next.model || current.model,
    finishReason: next.finishReason ?? current.finishReason,
    promptTokens: next.promptTokens ?? current.promptTokens,
    completionTokens: next.completionTokens ?? current.completionTokens,
    totalTokens: next.totalTokens ?? current.totalTokens,
    toolCalls: mergeToolCallEvents(current.toolCalls, next.toolCalls),
  }
}

function extractStreamingDeltaContent(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || !("choices" in payload)) {
    return null
  }

  const choices = (payload as { choices?: unknown }).choices
  if (!Array.isArray(choices) || choices.length === 0) {
    return null
  }

  const delta = (choices[0] as { delta?: unknown }).delta
  if (!delta || typeof delta !== "object" || !("content" in delta)) {
    return null
  }

  const content = (delta as { content?: unknown }).content
  return typeof content === "string" ? content : null
}

function extractRuntimeToolCalls(payload: unknown): BuilderAgentTestToolCall[] {
  if (!payload || typeof payload !== "object" || !("choices" in payload)) {
    return []
  }

  const choices = (payload as { choices?: unknown }).choices
  const firstChoice =
    Array.isArray(choices) && choices.length > 0 ? choices[0] : null
  if (!firstChoice || typeof firstChoice !== "object") {
    return []
  }

  const message = (firstChoice as { message?: unknown }).message
  const delta = (firstChoice as { delta?: unknown }).delta
  const messageToolCalls =
    message && typeof message === "object"
      ? ((message as { tool_calls?: unknown; toolCalls?: unknown })
          .tool_calls ??
        (message as { tool_calls?: unknown; toolCalls?: unknown }).toolCalls)
      : null
  const deltaToolCalls =
    delta && typeof delta === "object"
      ? ((delta as { tool_calls?: unknown; toolCalls?: unknown }).tool_calls ??
        (delta as { tool_calls?: unknown; toolCalls?: unknown }).toolCalls)
      : null
  const rawToolCalls =
    Array.isArray(messageToolCalls) && messageToolCalls.length > 0
      ? messageToolCalls
      : Array.isArray(deltaToolCalls)
        ? deltaToolCalls
        : []

  return rawToolCalls
    .map((toolCall, index) => normalizeRuntimeToolCall(toolCall, index))
    .filter((toolCall): toolCall is BuilderAgentTestToolCall => !!toolCall)
}

function normalizeRuntimeToolCall(
  value: unknown,
  fallbackIndex: number,
): BuilderAgentTestToolCall | null {
  if (!value || typeof value !== "object") {
    return null
  }

  const record = value as Record<string, unknown>
  const fn = record.function
  const fnRecord =
    fn && typeof fn === "object" ? (fn as Record<string, unknown>) : {}
  const argumentsPreview = sanitizeRuntimePreview(
    fnRecord.arguments ?? record.arguments,
  )
  const id = sanitizeRuntimeString(record.id, 120)
  const name =
    sanitizeRuntimeString(fnRecord.name, 120) ??
    sanitizeRuntimeString(record.name, 120) ??
    (id || argumentsPreview ? "pending_tool" : null)

  if (!name) {
    return null
  }

  return {
    at: new Date().toISOString(),
    id,
    index: readToolCallIndex(record.index, fallbackIndex),
    name,
    status: readToolCallStatus(record.status),
    argumentsPreview,
  }
}

function mergeToolCallEvents(
  current: BuilderAgentTestToolCall[],
  next: BuilderAgentTestToolCall[],
): BuilderAgentTestToolCall[] {
  if (next.length === 0) {
    return current
  }

  const merged = [...current]
  for (const toolCall of next) {
    const existingIndex = merged.findIndex((candidate) =>
      isSameToolCall(candidate, toolCall),
    )
    if (existingIndex === -1) {
      merged.push(toolCall)
      continue
    }

    const existing = merged[existingIndex]
    merged[existingIndex] = {
      ...existing,
      id: existing.id ?? toolCall.id,
      index: existing.index ?? toolCall.index,
      name: toolCall.name === "pending_tool" ? existing.name : toolCall.name,
      status: toolCall.status,
      argumentsPreview: mergeToolCallPreview(
        existing.argumentsPreview,
        toolCall.argumentsPreview,
      ),
    }
  }

  return merged
}

function isSameToolCall(
  left: BuilderAgentTestToolCall,
  right: BuilderAgentTestToolCall,
): boolean {
  if (left.id && right.id) {
    return left.id === right.id
  }
  if (left.index !== null && right.index !== null) {
    return left.index === right.index
  }
  return left.name === right.name
}

function mergeToolCallPreview(
  current: string | null,
  next: string | null,
): string | null {
  if (!current) {
    return next
  }
  if (!next) {
    return current
  }
  return `${current}${next}`.slice(0, 1000)
}

function sanitizeRuntimePreview(value: unknown): string | null {
  if (typeof value !== "string") {
    return null
  }

  const compact = value.replace(/\s+/g, " ").trim()
  if (!compact) {
    return null
  }

  return compact.slice(0, 1000)
}

function readToolCallIndex(
  value: unknown,
  fallbackIndex: number,
): number | null {
  if (Number.isInteger(value) && Number(value) >= 0) {
    return Number(value)
  }
  return Number.isInteger(fallbackIndex) && fallbackIndex >= 0
    ? fallbackIndex
    : null
}

function readToolCallStatus(
  value: unknown,
): BuilderAgentTestToolCall["status"] {
  return value === "completed" || value === "failed" ? value : "requested"
}

function renderToolCallOutput(toolCalls: BuilderAgentTestToolCall[]): string {
  return [
    "Runtime requested tool calls.",
    "",
    ...toolCalls.map((toolCall, index) => {
      const args = toolCall.argumentsPreview
        ? `: ${toolCall.argumentsPreview}`
        : ""
      return `${index + 1}. ${toolCall.name}${args}`
    }),
  ].join("\n")
}

function agentStudioRuntimeFailure(
  detail: string,
  accounting: AgentStudioRuntimeAccounting,
): {
  ok: false
  status: 503
  title: string
  detail: string
  source: "agentic_runtime"
} & AgentStudioRuntimeAccounting {
  return {
    ok: false,
    status: 503,
    title: "Agent Studio test failed",
    detail,
    source: "agentic_runtime",
    ...accounting,
  }
}

function emptyRuntimeAccounting(model: string): AgentStudioRuntimeAccounting {
  return {
    model,
    finishReason: null,
    promptTokens: null,
    completionTokens: null,
    totalTokens: null,
    toolCalls: [],
  }
}

function extractRuntimeAccounting(
  body: unknown,
  fallbackModel: string,
): AgentStudioRuntimeAccounting {
  if (!body || typeof body !== "object") {
    return emptyRuntimeAccounting(fallbackModel)
  }

  const model = sanitizeRuntimeString((body as { model?: unknown }).model, 120)
  const choices = (body as { choices?: unknown }).choices
  const firstChoice =
    Array.isArray(choices) && choices.length > 0 ? choices[0] : null
  const finishReason =
    firstChoice && typeof firstChoice === "object"
      ? sanitizeRuntimeString(
          (firstChoice as { finish_reason?: unknown }).finish_reason,
          80,
        )
      : null
  const usage = (body as { usage?: unknown }).usage

  return {
    model: model ?? fallbackModel,
    finishReason,
    promptTokens: readUsageToken(usage, "prompt_tokens", "promptTokens"),
    completionTokens: readUsageToken(
      usage,
      "completion_tokens",
      "completionTokens",
    ),
    totalTokens: readUsageToken(usage, "total_tokens", "totalTokens"),
    toolCalls: extractRuntimeToolCalls(body),
  }
}

function sanitizeRuntimeString(
  value: unknown,
  maxLength: number,
): string | null {
  if (typeof value !== "string") {
    return null
  }

  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }

  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed
}

function readUsageToken(
  usage: unknown,
  snakeKey: string,
  camelKey: string,
): number | null {
  if (!usage || typeof usage !== "object") {
    return null
  }

  const value = (usage as Record<string, unknown>)[snakeKey]
  const fallbackValue = (usage as Record<string, unknown>)[camelKey]
  const numberValue =
    typeof value === "number"
      ? value
      : typeof fallbackValue === "number"
        ? fallbackValue
        : null

  if (numberValue === null) {
    return null
  }

  return Number.isInteger(numberValue) && numberValue >= 0 ? numberValue : null
}

function extractRuntimeContent(body: unknown): string | null {
  if (!body || typeof body !== "object" || !("choices" in body)) {
    return null
  }

  const choices = (body as { choices?: unknown }).choices
  if (!Array.isArray(choices) || choices.length === 0) {
    return null
  }

  const message = (choices[0] as { message?: unknown }).message
  if (!message || typeof message !== "object" || !("content" in message)) {
    return null
  }

  const content = (message as { content?: unknown }).content
  return typeof content === "string" && content.trim() ? content.trim() : null
}

function describeMissingRuntimeContent(body: unknown): string {
  if (!body || typeof body !== "object" || !("choices" in body)) {
    return "OpenClaw returned a response without assistant content."
  }

  const choices = (body as { choices?: unknown }).choices
  if (!Array.isArray(choices) || choices.length === 0) {
    return "OpenClaw returned a response without assistant content."
  }

  const first = choices[0]
  if (!first || typeof first !== "object") {
    return "OpenClaw returned a response without assistant content."
  }

  const finishReason = (first as { finish_reason?: unknown }).finish_reason
  const message = (first as { message?: unknown }).message
  const hasReasoningContent =
    message &&
    typeof message === "object" &&
    typeof (message as { reasoning_content?: unknown }).reasoning_content ===
      "string" &&
    Boolean(
      (message as { reasoning_content?: string }).reasoning_content?.trim(),
    )

  if (finishReason === "length") {
    return [
      "OpenClaw returned no assistant content because the response reached max_tokens before visible output.",
      "Increase max output tokens or use a less reasoning-heavy model.",
    ].join(" ")
  }

  if (hasReasoningContent) {
    return "OpenClaw returned reasoning content but no assistant content."
  }

  return "OpenClaw returned a response without assistant content."
}

async function readRuntimeError(response: Response): Promise<string> {
  const contentType = response.headers.get("content-type") ?? ""
  if (contentType.includes("application/json")) {
    try {
      const body = (await response.json()) as unknown
      if (body && typeof body === "object" && "detail" in body) {
        const detail = (body as { detail?: unknown }).detail
        if (typeof detail === "string") {
          return detail
        }
      }
    } catch {
      return "malformed JSON error response"
    }
  }

  return (await response.text()) || "empty error response"
}

type BuilderResourceRow = typeof builderResources.$inferSelect
type BuilderResourceVersionRow = typeof builderResourceVersions.$inferSelect
type BuilderLifecycleEventRow = typeof builderLifecycleEvents.$inferSelect
type BuilderAgentTestRunRow = typeof builderAgentTestRuns.$inferSelect
type UserRow = typeof users.$inferSelect

function mapDbAgentTestRun(row: BuilderAgentTestRunRow): BuilderAgentTestRun {
  return {
    id: row.id,
    resourceId: row.resourceId,
    input: row.input,
    output: row.output,
    source: row.source as BuilderAgentTestRun["source"],
    status: row.status as BuilderAgentTestRun["status"],
    model: row.model,
    sandboxProfile: row.sandboxProfile as BuilderAgentTestRun["sandboxProfile"],
    durationMs: row.durationMs,
    runtimeTraceId: row.runtimeTraceId,
    finishReason: row.finishReason,
    promptTokens: row.promptTokens,
    completionTokens: row.completionTokens,
    totalTokens: row.totalTokens,
    errorDetail: row.errorDetail,
    trace: parseAgentTestTrace(row.trace),
    toolCalls: parseAgentTestToolCalls(row.toolCalls),
    createdAt: row.createdAt.toISOString(),
  }
}

function parseAgentTestTrace(value: unknown): BuilderAgentTestTraceStep[] {
  const parsed = builderAgentTestTraceStepSchema.array().safeParse(value)
  return parsed.success ? parsed.data : []
}

function parseAgentTestToolCalls(value: unknown): BuilderAgentTestToolCall[] {
  const parsed = builderAgentTestToolCallSchema.array().safeParse(value)
  return parsed.success ? parsed.data : []
}

async function mapDbBuilderResources(
  actor: Actor,
  rows: BuilderResourceRow[],
): Promise<BuilderResource[]> {
  const db = getDb()
  if (!db || rows.length === 0) {
    return []
  }

  const versionIds = rows
    .map((row) => row.currentVersionId)
    .filter((id): id is string => Boolean(id))
  const ownerIds = rows.map((row) => row.ownerId)

  const [versionRows, ownerRows] = await Promise.all([
    versionIds.length > 0
      ? db
          .select()
          .from(builderResourceVersions)
          .where(inArray(builderResourceVersions.id, versionIds))
      : Promise.resolve([]),
    ownerIds.length > 0
      ? db.select().from(users).where(inArray(users.id, ownerIds))
      : Promise.resolve([]),
  ])

  const versionsById = new Map(
    versionRows.map((version) => [version.id, version]),
  )
  const ownersById = new Map(ownerRows.map((owner) => [owner.id, owner]))

  return rows.map((row) => {
    const version = row.currentVersionId
      ? versionsById.get(row.currentVersionId)
      : undefined
    const owner = ownersById.get(row.ownerId)
    const ownerName =
      owner?.displayName ??
      (row.ownerId === actor.subject ? (actor.email ?? actor.subject) : null) ??
      row.ownerId

    return withResourceLinks({
      id: row.id,
      type: row.type as BuilderResource["type"],
      name: row.name,
      description: row.description,
      ownerId: row.ownerId,
      ownerName,
      state: row.state as BuilderResource["state"],
      templateId: row.templateId,
      currentVersion: version
        ? {
            id: version.id,
            semver: version.semver,
            createdAt: version.createdAt.toISOString(),
          }
        : null,
      updatedAt: row.updatedAt.toISOString(),
      href: "",
      editorHref: "",
    })
  })
}

function buildSubmissionsFromLifecycleEvents(
  resources: BuilderResource[],
  events: BuilderLifecycleEventRow[],
  versions: BuilderResourceVersionRow[],
): BuilderSubmission[] {
  const resourcesById = new Map(
    resources.map((resource) => [resource.id, resource]),
  )
  const versionsById = new Map(versions.map((version) => [version.id, version]))
  const decisionStates = new Set([
    "published",
    "rejected",
    "deprecated",
    "withdrawn",
  ])

  return events
    .filter((event) => event.toState === "submitted")
    .map((event) => {
      const resource = resourcesById.get(event.resourceId)
      if (!resource) {
        return null
      }

      const laterResourceEvents = events
        .filter(
          (candidate) =>
            candidate.resourceId === event.resourceId &&
            candidate.createdAt > event.createdAt,
        )
        .sort(
          (left, right) => left.createdAt.getTime() - right.createdAt.getTime(),
        )
      const nextSubmission = laterResourceEvents.find(
        (candidate) => candidate.toState === "submitted",
      )
      const decision = laterResourceEvents.find((candidate) => {
        return (
          decisionStates.has(candidate.toState) &&
          (!nextSubmission || candidate.createdAt < nextSubmission.createdAt)
        )
      })
      const version = event.resourceVersionId
        ? versionsById.get(event.resourceVersionId)
        : undefined

      return withSubmissionLink({
        id: event.id,
        resourceId: resource.id,
        resourceName: resource.name,
        resourceType: resource.type,
        submittedVersion:
          version?.semver ?? resource.currentVersion?.semver ?? "unknown",
        state: decision
          ? (decision.toState as BuilderSubmission["state"])
          : "submitted",
        adminComment: decision?.comment ?? null,
        submittedAt: event.createdAt.toISOString(),
        decidedAt: decision ? decision.createdAt.toISOString() : null,
        href: "",
      })
    })
    .filter((submission): submission is BuilderSubmission =>
      Boolean(submission),
    )
}

async function getDbMutableBuilderResource(
  actor: Actor,
  id: string,
): Promise<BuilderResource | undefined> {
  return getBuilderResource(actor, id)
}

async function getDbOwnedBuilderResource(
  actor: Actor,
  id: string,
): Promise<BuilderResource | undefined> {
  const resource = await getBuilderResource(actor, id)
  if (!resource || resource.ownerId !== actor.subject) {
    return undefined
  }
  return resource
}

async function getDbAdminResource(
  id: string,
): Promise<BuilderResource | undefined> {
  return getBuilderResource(
    {
      subject: "admin-system",
      email: undefined,
      persona: "admin",
      roles: ["admin"],
      authMode: "service-forwarded",
    },
    id,
  )
}

async function getDbOpenSubmission(
  resource: BuilderResource,
): Promise<BuilderSubmission | undefined> {
  const db = getDb()
  if (!db || resource.state !== "submitted") {
    return undefined
  }

  const rows = await db
    .select()
    .from(builderLifecycleEvents)
    .where(
      and(
        eq(builderLifecycleEvents.resourceId, resource.id),
        eq(builderLifecycleEvents.toState, "submitted"),
      ),
    )
    .orderBy(desc(builderLifecycleEvents.createdAt))
    .limit(1)

  const event = rows[0]
  if (!event) {
    return undefined
  }

  return withSubmissionLink({
    id: event.id,
    resourceId: resource.id,
    resourceName: resource.name,
    resourceType: resource.type,
    submittedVersion: resource.currentVersion?.semver ?? "unknown",
    state: "submitted",
    adminComment: null,
    submittedAt: event.createdAt.toISOString(),
    decidedAt: null,
    href: "",
  })
}

async function publishBuilderLifecycleEvent(
  actor: Actor,
  resource: BuilderResource,
  opts: {
    transition:
      | "forked"
      | "version_cut"
      | "submitted"
      | "published"
      | "rejected"
      | "withdrawn"
    createdAt: string
    version?: string
    submission?: BuilderSubmission
    comment?: string
  },
): Promise<void> {
  await publishHubEvent(actor, {
    id: randomUUID(),
    type: "resource.lifecycle",
    createdAt: opts.createdAt,
    resourceId: resource.id,
    payload: {
      id: resource.id,
      name: resource.name,
      resourceType: resource.type,
      state: resource.state,
      ownerId: resource.ownerId,
      ownerName: resource.ownerName,
      templateId: resource.templateId,
      currentVersion: resource.currentVersion,
      transition: opts.transition,
      version: opts.version,
      submission: opts.submission,
      comment: opts.comment,
    },
  })
}

function ownerActorForResource(resource: BuilderResource): Actor {
  return {
    subject: resource.ownerId,
    email: undefined,
    persona: "builder",
    roles: ["builder"],
    authMode: "service-forwarded",
  }
}

function withResourceLinks(resource: BuilderResource): BuilderResource {
  return {
    ...resource,
    href: `/builder/resources/${resource.id}`,
    editorHref: `/builder/${editorSegment(resource.type)}/${resource.id}`,
  }
}

function withSubmissionLink(submission: BuilderSubmission): BuilderSubmission {
  return {
    ...submission,
    href: `/builder/submissions/${submission.id}`,
  }
}

function editorSegment(type: BuilderResource["type"]): string {
  switch (type) {
    case "agent":
      return "agents"
    case "connector":
      return "connectors"
    case "custom_app":
      return "apps"
    case "rag_corpus":
      return "knowledge"
    case "workflow":
      return "workflows"
  }
}
