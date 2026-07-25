import "server-only"

import { randomUUID } from "node:crypto"
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import type {
  CreateKnowledgeCorpusRequest,
  KnowledgeActionResponse,
  KnowledgeArchiveSourceListResponse,
  KnowledgeArchivedSource,
  KnowledgeCorpus,
  KnowledgeCorpusDetailResponse,
  KnowledgeCorpusListResponse,
} from "@llm-machines/contracts"
import {
  knowledgeArchivedSources,
  knowledgeCorpusDetails,
  knowledgeCorpora,
} from "./mock-data"

type FixtureKnowledgeState = {
  archivedSources: KnowledgeArchivedSource[]
  corpora: KnowledgeCorpus[]
  details: KnowledgeCorpusDetailResponse[]
}

let fixtureState = loadFixtureKnowledgeState()

export function getFixtureKnowledgeCorpusList(): KnowledgeCorpusListResponse {
  const state = readFixtureKnowledgeState()
  return {
    generatedAt: new Date().toISOString(),
    corpora: state.corpora.map(cloneCorpus),
  }
}

export function getFixtureKnowledgeCorpusDetail(
  corpusId: string,
): KnowledgeCorpusDetailResponse | undefined {
  const detail = readFixtureKnowledgeState().details.find(
    (item) => item.corpus.id === corpusId,
  )
  return detail ? cloneDetail(detail) : undefined
}

export function getFixtureKnowledgeArchiveSourceList(): KnowledgeArchiveSourceListResponse {
  const state = readFixtureKnowledgeState()
  return {
    generatedAt: new Date().toISOString(),
    sources: state.archivedSources.map(cloneArchivedSource),
  }
}

export function createFixtureKnowledgeCorpus(
  input: CreateKnowledgeCorpusRequest,
): KnowledgeActionResponse {
  const state = readFixtureKnowledgeState()
  const timestamp = new Date().toISOString()
  const corpus: KnowledgeCorpus = {
    id: randomUUID(),
    name: input.name,
    description: input.description,
    status: "draft",
    languageHints: [...input.languageHints],
    publishedSnapshotId: null,
    sourceCount: 0,
    chunkCount: 0,
    accessGroups: [...input.accessGroups],
    createdBy: "fixture-admin",
    updatedBy: "fixture-admin",
    createdAt: timestamp,
    updatedAt: timestamp,
  }

  writeFixtureKnowledgeState({
    ...state,
    corpora: [corpus, ...state.corpora],
    details: [
      {
        corpus,
        jobs: [],
        snapshots: [],
        sources: [],
      },
      ...state.details,
    ],
  })

  return { corpus: cloneCorpus(corpus) }
}

export function resetFixtureKnowledgeStoreForTest(): void {
  writeFixtureKnowledgeState(createInitialFixtureKnowledgeState())
}

function readFixtureKnowledgeState(): FixtureKnowledgeState {
  if (shouldPersistFixtureKnowledgeState()) {
    const diskState = loadFixtureKnowledgeStateFromDisk()
    if (diskState) {
      fixtureState = diskState
    }
  }
  return cloneFixtureKnowledgeState(fixtureState)
}

function writeFixtureKnowledgeState(state: FixtureKnowledgeState): void {
  fixtureState = cloneFixtureKnowledgeState(state)
  if (!shouldPersistFixtureKnowledgeState()) {
    return
  }

  const path = fixtureKnowledgeStatePath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(fixtureState, null, 2))
}

function loadFixtureKnowledgeState(): FixtureKnowledgeState {
  return (
    (shouldPersistFixtureKnowledgeState() &&
      loadFixtureKnowledgeStateFromDisk()) ||
    createInitialFixtureKnowledgeState()
  )
}

function loadFixtureKnowledgeStateFromDisk():
  | FixtureKnowledgeState
  | undefined {
  const path = fixtureKnowledgeStatePath()
  if (!existsSync(path)) {
    return undefined
  }

  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as Partial<
      FixtureKnowledgeState
    >
    if (
      !Array.isArray(value.corpora) ||
      !Array.isArray(value.details) ||
      !Array.isArray(value.archivedSources)
    ) {
      return undefined
    }
    return cloneFixtureKnowledgeState({
      archivedSources: value.archivedSources as KnowledgeArchivedSource[],
      corpora: value.corpora as KnowledgeCorpus[],
      details: value.details as KnowledgeCorpusDetailResponse[],
    })
  } catch {
    return undefined
  }
}

function createInitialFixtureKnowledgeState(): FixtureKnowledgeState {
  return {
    archivedSources: knowledgeArchivedSources.map(cloneArchivedSource),
    corpora: knowledgeCorpora.map(cloneCorpus),
    details: knowledgeCorpusDetails.map(cloneDetail),
  }
}

function cloneFixtureKnowledgeState(
  state: FixtureKnowledgeState,
): FixtureKnowledgeState {
  return {
    archivedSources: state.archivedSources.map(cloneArchivedSource),
    corpora: state.corpora.map(cloneCorpus),
    details: state.details.map(cloneDetail),
  }
}

function shouldPersistFixtureKnowledgeState(): boolean {
  return (
    process.env.NODE_ENV !== "test" &&
    process.env.CONSOLE_WEB_FIXTURE_MODE === "true"
  )
}

function fixtureKnowledgeStatePath(): string {
  return (
    process.env.CONSOLE_WEB_FIXTURE_STORE_PATH?.trim() ||
    join(tmpdir(), "llm-machines-console-web-knowledge-fixtures.json")
  )
}

function cloneCorpus(corpus: KnowledgeCorpus): KnowledgeCorpus {
  return {
    ...corpus,
    accessGroups: [...corpus.accessGroups],
    languageHints: [...corpus.languageHints],
  }
}

function cloneDetail(
  detail: KnowledgeCorpusDetailResponse,
): KnowledgeCorpusDetailResponse {
  return {
    corpus: cloneCorpus(detail.corpus),
    jobs: detail.jobs.map((job) => ({
      ...job,
      metrics: { ...job.metrics },
    })),
    snapshots: detail.snapshots.map((snapshot) => ({
      ...snapshot,
      metadata: { ...snapshot.metadata },
    })),
    sources: detail.sources.map((source) => ({
      ...source,
      metadata: { ...source.metadata },
    })),
  }
}

function cloneArchivedSource(
  source: KnowledgeArchivedSource,
): KnowledgeArchivedSource {
  return {
    ...source,
    metadata: { ...source.metadata },
  }
}
