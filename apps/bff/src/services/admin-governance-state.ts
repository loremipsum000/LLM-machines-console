import { randomUUID } from "node:crypto"
import { desc, eq, gte, inArray } from "drizzle-orm"
import type { Actor } from "../auth/persona"
import { getDb } from "../db/client"
import {
  policyViolationRemediations,
  policyViolations,
  pureModeState,
} from "../db/schema"
import { upsertActorUser } from "./users"

export type PolicyViolationSeverity = "critical" | "info" | "warning"
export type PolicyType = "access_control" | "content_safety" | "data_governance"
export type PolicyViolationAction = "audit" | "block" | "warn"
export type PolicyViolationRemediationStatus =
  | "acknowledged"
  | "open"
  | "resolved"

export interface PolicyViolationRemediationRecord {
  actorId: string
  createdAt: string
  note: string
  status: Exclude<PolicyViolationRemediationStatus, "open">
  violationId: string
}

export interface PolicyViolationRecord {
  id: string
  policyId: string | null
  policyType: PolicyType
  severity: PolicyViolationSeverity
  actionTaken: PolicyViolationAction
  remediationActorId: string | null
  remediationAt: string | null
  remediationNote: string | null
  remediationStatus: PolicyViolationRemediationStatus
  actorId: string | null
  targetType: string
  targetId: string
  message: string
  metadata: Record<string, unknown>
  createdAt: string
}

export interface PureModeRecord {
  active: boolean
  reason: string | null
  activatedBy: string | null
  activatedAt: string | null
  deactivatedAt: string | null
  affectedComponents: string[]
  updatedAt: string
}

export type GovernanceReadState =
  | {
      policyViolations: {
        critical: number
        records: PolicyViolationRecord[]
        total: number
        warning: number
      }
      pureMode: PureModeRecord
      sourceStatus: "ok"
    }
  | { sourceStatus: "not_configured" }
  | { sourceStatus: "unavailable" }

type PolicyViolationSeed = Pick<
  PolicyViolationRecord,
  "createdAt" | "severity"
> &
  Partial<Omit<PolicyViolationRecord, "createdAt" | "severity">>

type PureModeSeed = Pick<
  PureModeRecord,
  "active" | "affectedComponents" | "updatedAt"
> &
  Partial<Omit<PureModeRecord, "active" | "affectedComponents" | "updatedAt">>

const memoryPolicyViolations: PolicyViolationRecord[] = []
const memoryPolicyViolationRemediations: PolicyViolationRemediationRecord[] = []
let memoryPureMode: PureModeRecord | null = null

export async function readGovernanceState(
  since = new Date(Date.now() - 24 * 60 * 60 * 1000),
): Promise<GovernanceReadState> {
  const db = getDb()
  if (!db) {
    if (memoryPolicyViolations.length === 0 && memoryPureMode === null) {
      return { sourceStatus: "not_configured" }
    }
    return {
      sourceStatus: "ok",
      policyViolations: summarizeViolations(
        memoryPolicyViolations.filter(
          (violation) => new Date(violation.createdAt) >= since,
        ),
      ),
      pureMode: memoryPureMode ?? inactivePureMode(),
    }
  }

  try {
    const [violations, pureModeRows] = await Promise.all([
      db
        .select()
        .from(policyViolations)
        .where(gte(policyViolations.createdAt, since))
        .orderBy(desc(policyViolations.createdAt)),
      db.select().from(pureModeState).limit(1),
    ])
    const remediationByViolation = await readLatestRemediations(
      violations.map((violation) => violation.id),
    )

    return {
      sourceStatus: "ok",
      policyViolations: summarizeViolations(
        violations.map((row) => ({
          id: row.id,
          policyId: row.policyId,
          policyType: parsePolicyType(row.policyType),
          severity: parseSeverity(row.severity),
          actionTaken: parseAction(row.actionTaken),
          actorId: row.actorId,
          ...remediationFields(remediationByViolation.get(row.id)),
          targetType: row.targetType,
          targetId: row.targetId,
          message: row.message,
          metadata: parseRecord(row.metadata),
          createdAt: row.createdAt.toISOString(),
        })),
      ),
      pureMode: pureModeRows[0]
        ? {
            active: pureModeRows[0].active,
            reason: pureModeRows[0].reason,
            activatedBy: pureModeRows[0].activatedBy,
            activatedAt: pureModeRows[0].activatedAt?.toISOString() ?? null,
            deactivatedAt: pureModeRows[0].deactivatedAt?.toISOString() ?? null,
            affectedComponents: parseComponents(
              pureModeRows[0].affectedComponents,
            ),
            updatedAt: pureModeRows[0].updatedAt.toISOString(),
          }
        : inactivePureMode(),
    }
  } catch {
    return { sourceStatus: "unavailable" }
  }
}

export function seedGovernanceForTest(input: {
  policyViolations?: PolicyViolationSeed[]
  pureMode?: PureModeSeed
}): void {
  memoryPolicyViolations.splice(
    0,
    memoryPolicyViolations.length,
    ...(input.policyViolations ?? []).map(toPolicyViolationRecord),
  )
  memoryPureMode = input.pureMode ? toPureModeRecord(input.pureMode) : null
}

export function resetGovernanceForTest(): void {
  memoryPolicyViolations.length = 0
  memoryPolicyViolationRemediations.length = 0
  memoryPureMode = null
}

export function appendPolicyViolationForRuntime(
  violation: PolicyViolationRecord,
): void {
  memoryPolicyViolations.unshift(withOpenRemediation(violation))
}

export async function writePureModeStateForRuntime(
  pureMode: PureModeRecord,
  actor: Actor,
): Promise<void> {
  const db = getDb()
  if (db) {
    const storageActor = await upsertActorUser(actor)
    const activatedBy =
      pureMode.activatedBy === actor.subject
        ? storageActor.subject
        : pureMode.activatedBy
    await db
      .insert(pureModeState)
      .values({
        id: "singleton",
        active: pureMode.active,
        reason: pureMode.reason,
        activatedBy,
        activatedAt: pureMode.activatedAt
          ? new Date(pureMode.activatedAt)
          : null,
        deactivatedAt: pureMode.deactivatedAt
          ? new Date(pureMode.deactivatedAt)
          : null,
        affectedComponents: pureMode.affectedComponents,
        updatedAt: new Date(pureMode.updatedAt),
      })
      .onConflictDoUpdate({
        target: pureModeState.id,
        set: {
          active: pureMode.active,
          reason: pureMode.reason,
          activatedBy,
          activatedAt: pureMode.activatedAt
            ? new Date(pureMode.activatedAt)
            : null,
          deactivatedAt: pureMode.deactivatedAt
            ? new Date(pureMode.deactivatedAt)
            : null,
          affectedComponents: pureMode.affectedComponents,
          updatedAt: new Date(pureMode.updatedAt),
        },
      })
    return
  }

  memoryPureMode = pureMode
}

export async function recordPolicyViolationRemediation(input: {
  actor: Actor
  note: string
  status: Exclude<PolicyViolationRemediationStatus, "open">
  violationId: string
}): Promise<PolicyViolationRecord | null> {
  const db = getDb()
  const storageActor = db ? await upsertActorUser(input.actor) : input.actor
  const remediation: PolicyViolationRemediationRecord = {
    actorId: storageActor.subject,
    createdAt: new Date().toISOString(),
    note: input.note,
    status: input.status,
    violationId: input.violationId,
  }

  if (db) {
    const [violation] = await db
      .select()
      .from(policyViolations)
      .where(eq(policyViolations.id, input.violationId))
      .limit(1)
    if (!violation) {
      return null
    }

    await db.insert(policyViolationRemediations).values({
      id: randomUUID(),
      violationId: remediation.violationId,
      status: remediation.status,
      note: remediation.note,
      actorId: remediation.actorId,
      createdAt: new Date(remediation.createdAt),
    })

    return {
      id: violation.id,
      policyId: violation.policyId,
      policyType: parsePolicyType(violation.policyType),
      severity: parseSeverity(violation.severity),
      actionTaken: parseAction(violation.actionTaken),
      actorId: violation.actorId,
      ...remediationFields(remediation),
      targetType: violation.targetType,
      targetId: violation.targetId,
      message: violation.message,
      metadata: parseRecord(violation.metadata),
      createdAt: violation.createdAt.toISOString(),
    }
  }

  const index = memoryPolicyViolations.findIndex(
    (violation) => violation.id === input.violationId,
  )
  if (index < 0) {
    return null
  }

  memoryPolicyViolationRemediations.unshift(remediation)
  memoryPolicyViolations[index] = {
    ...memoryPolicyViolations[index],
    ...remediationFields(remediation),
  }
  return memoryPolicyViolations[index]
}

function summarizeViolations(violations: PolicyViolationRecord[]): {
  critical: number
  records: PolicyViolationRecord[]
  total: number
  warning: number
} {
  return {
    critical: violations.filter(
      (violation) => violation.severity === "critical",
    ).length,
    records: violations,
    total: violations.length,
    warning: violations.filter((violation) => violation.severity === "warning")
      .length,
  }
}

function toPolicyViolationRecord(
  violation: PolicyViolationSeed,
  index: number,
): PolicyViolationRecord {
  return {
    id:
      violation.id ??
      `11111111-1111-4111-8111-${String(index + 1).padStart(12, "0")}`,
    policyId: violation.policyId ?? null,
    policyType: violation.policyType ?? "content_safety",
    severity: violation.severity,
    actionTaken: violation.actionTaken ?? "block",
    remediationActorId: violation.remediationActorId ?? null,
    remediationAt: violation.remediationAt ?? null,
    remediationNote: violation.remediationNote ?? null,
    remediationStatus: violation.remediationStatus ?? "open",
    actorId: violation.actorId ?? "consumer-1",
    targetType: violation.targetType ?? "chat.thread",
    targetId: violation.targetId ?? "thread-1",
    message: violation.message ?? "Policy violation recorded.",
    metadata: violation.metadata ?? {},
    createdAt: violation.createdAt,
  }
}

function toPureModeRecord(pureMode: PureModeSeed): PureModeRecord {
  return {
    active: pureMode.active,
    reason: pureMode.reason ?? null,
    activatedBy: pureMode.activatedBy ?? null,
    activatedAt: pureMode.activatedAt ?? null,
    deactivatedAt: pureMode.deactivatedAt ?? null,
    affectedComponents: pureMode.affectedComponents,
    updatedAt: pureMode.updatedAt,
  }
}

function parsePolicyType(value: string): PolicyType {
  if (value === "access_control" || value === "data_governance") {
    return value
  }
  return "content_safety"
}

function parseSeverity(value: string): PolicyViolationSeverity {
  if (value === "critical" || value === "warning") {
    return value
  }
  return "info"
}

function parseAction(value: string): PolicyViolationAction {
  if (value === "audit" || value === "warn") {
    return value
  }
  return "block"
}

async function readLatestRemediations(
  violationIds: string[],
): Promise<Map<string, PolicyViolationRemediationRecord>> {
  if (violationIds.length === 0) {
    return new Map()
  }

  const db = getDb()
  if (!db) {
    return new Map()
  }

  const rows = await db
    .select()
    .from(policyViolationRemediations)
    .where(inArray(policyViolationRemediations.violationId, violationIds))
    .orderBy(desc(policyViolationRemediations.createdAt))

  const latest = new Map<string, PolicyViolationRemediationRecord>()
  for (const row of rows) {
    if (latest.has(row.violationId)) {
      continue
    }
    latest.set(row.violationId, {
      actorId: row.actorId,
      createdAt: row.createdAt.toISOString(),
      note: row.note,
      status: parseRemediationStatus(row.status),
      violationId: row.violationId,
    })
  }
  return latest
}

function parseRemediationStatus(
  value: string,
): Exclude<PolicyViolationRemediationStatus, "open"> {
  return value === "resolved" ? "resolved" : "acknowledged"
}

function remediationFields(
  remediation: PolicyViolationRemediationRecord | undefined,
): Pick<
  PolicyViolationRecord,
  | "remediationActorId"
  | "remediationAt"
  | "remediationNote"
  | "remediationStatus"
> {
  if (!remediation) {
    return {
      remediationActorId: null,
      remediationAt: null,
      remediationNote: null,
      remediationStatus: "open",
    }
  }

  return {
    remediationActorId: remediation.actorId,
    remediationAt: remediation.createdAt,
    remediationNote: remediation.note,
    remediationStatus: remediation.status,
  }
}

function withOpenRemediation(
  violation: PolicyViolationRecord,
): PolicyViolationRecord {
  return {
    ...violation,
    ...remediationFields(undefined),
  }
}

function parseComponents(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter(
    (component): component is string => typeof component === "string",
  )
}

function parseRecord(value: unknown): Record<string, unknown> {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    return {}
  }
  return value as Record<string, unknown>
}

function inactivePureMode(): PureModeRecord {
  return {
    active: false,
    reason: null,
    activatedBy: null,
    activatedAt: null,
    deactivatedAt: null,
    affectedComponents: [],
    updatedAt: new Date().toISOString(),
  }
}
