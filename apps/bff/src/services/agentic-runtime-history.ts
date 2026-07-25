import { randomUUID } from "node:crypto"
import { desc, gte } from "drizzle-orm"
import type {
  AgenticRuntime,
  AgenticRuntimeHistoryResponse,
  AgenticRuntimeHistorySample,
  AgenticRuntimeSlo,
  AgenticRuntimeStatus,
  AgenticStatusResponse,
} from "@llm-machines/contracts"
import { getDb } from "../db/client"
import { agenticRuntimeSnapshots } from "../db/schema"

const runtimeProfiles = {
  openclaw: "openclaw-restricted",
  hermes: "hermes-restricted",
} as const

const memorySnapshots: AgenticRuntimeHistorySample[] = []
const maxMemorySnapshots = 200

export async function recordAgenticRuntimeSnapshots(
  status: AgenticStatusResponse,
): Promise<void> {
  const capturedAt = new Date()
  const samples = status.runtimes.map((runtime) =>
    toHistorySample(runtime, capturedAt),
  )
  const db = getDb()

  if (db) {
    await db.insert(agenticRuntimeSnapshots).values(
      samples.map((sample) => ({
        id: randomUUID(),
        runtime: sample.runtime,
        profile: sample.profile,
        configured: sample.configured,
        healthy: sample.healthy,
        baseUrl: sample.baseUrl,
        detail: sample.detail ?? null,
        capturedAt,
      })),
    )
    return
  }

  memorySnapshots.unshift(...samples)
  memorySnapshots.splice(maxMemorySnapshots)
}

export async function getAgenticRuntimeHistory(
  windowHours = 24,
): Promise<AgenticRuntimeHistoryResponse> {
  const normalizedWindowHours =
    Number.isInteger(windowHours) && windowHours > 0 ? windowHours : 24
  const since = new Date(Date.now() - normalizedWindowHours * 60 * 60 * 1000)
  const samples = await readHistorySamples(since)

  return {
    generatedAt: new Date().toISOString(),
    windowHours: normalizedWindowHours,
    samples,
    slos: (["openclaw", "hermes"] as const).map((runtime) =>
      runtimeSlo(runtime, normalizedWindowHours, samples),
    ),
  }
}

export function resetAgenticRuntimeHistoryForTest(): void {
  memorySnapshots.length = 0
}

async function readHistorySamples(
  since: Date,
): Promise<AgenticRuntimeHistorySample[]> {
  const db = getDb()
  if (db) {
    const rows = await db
      .select()
      .from(agenticRuntimeSnapshots)
      .where(gte(agenticRuntimeSnapshots.capturedAt, since))
      .orderBy(desc(agenticRuntimeSnapshots.capturedAt))
      .limit(100)

    return rows.map((row) => ({
      runtime: parseRuntime(row.runtime),
      profile:
        row.profile === "hermes-restricted"
          ? "hermes-restricted"
          : "openclaw-restricted",
      configured: row.configured,
      healthy: row.healthy,
      baseUrl: row.baseUrl,
      detail: row.detail ?? undefined,
      capturedAt: row.capturedAt.toISOString(),
    }))
  }

  return memorySnapshots
    .filter((sample) => new Date(sample.capturedAt) >= since)
    .slice(0, 100)
}

function toHistorySample(
  runtime: AgenticRuntimeStatus,
  capturedAt: Date,
): AgenticRuntimeHistorySample {
  return {
    runtime: runtime.runtime,
    profile: runtime.profile,
    configured: runtime.configured,
    healthy: runtime.healthy,
    baseUrl: runtime.baseUrl,
    detail: runtime.detail,
    capturedAt: capturedAt.toISOString(),
  }
}

function runtimeSlo(
  runtime: AgenticRuntime,
  windowHours: number,
  samples: AgenticRuntimeHistorySample[],
): AgenticRuntimeSlo {
  const runtimeSamples = samples.filter((sample) => sample.runtime === runtime)
  const sampleCount = runtimeSamples.length
  const configuredSamples = runtimeSamples.filter(
    (sample) => sample.configured,
  ).length
  const healthySamples = runtimeSamples.filter(
    (sample) => sample.healthy,
  ).length
  const lastHealthyAt =
    runtimeSamples.find((sample) => sample.healthy)?.capturedAt ?? null
  const lastUnhealthyAt =
    runtimeSamples.find((sample) => !sample.healthy)?.capturedAt ?? null

  return {
    runtime,
    profile: runtimeSamples[0]?.profile ?? runtimeProfiles[runtime],
    windowHours,
    status: runtimeSloStatus(sampleCount, configuredSamples, healthySamples),
    sampleCount,
    configuredSamples,
    healthySamples,
    uptimePercent:
      sampleCount > 0
        ? roundPercent((healthySamples / sampleCount) * 100)
        : null,
    lastHealthyAt,
    lastUnhealthyAt,
  }
}

function runtimeSloStatus(
  sampleCount: number,
  configuredSamples: number,
  healthySamples: number,
): AgenticRuntimeSlo["status"] {
  if (sampleCount === 0) {
    return "insufficient_data"
  }
  if (configuredSamples === 0) {
    return "not_configured"
  }
  return healthySamples === sampleCount ? "healthy" : "degraded"
}

function roundPercent(value: number): number {
  return Math.round(value * 10) / 10
}

function parseRuntime(value: string): AgenticRuntime {
  return value === "hermes" ? "hermes" : "openclaw"
}
