import { randomUUID } from "node:crypto"
import type { Actor } from "../auth/persona"
import { getDb } from "../db/client"
import { policyViolations } from "../db/schema"
import {
  appendPolicyViolationForRuntime,
  type PolicyType,
  type PolicyViolationAction,
  type PolicyViolationRecord,
  type PolicyViolationSeverity,
} from "./admin-governance-state"
import { emitAudit } from "./audit"
import { upsertActorUser } from "./users"

export interface RecordPolicyViolationInput {
  actionTaken: PolicyViolationAction
  actor: Actor
  message: string
  metadata?: Record<string, unknown>
  policyId?: string | null
  policyType: PolicyType
  severity: PolicyViolationSeverity
  targetId: string
  targetType: string
}

export async function recordPolicyViolation(
  input: RecordPolicyViolationInput,
): Promise<PolicyViolationRecord> {
  const db = getDb()
  const storageActor = db ? await upsertActorUser(input.actor) : input.actor
  const record: PolicyViolationRecord = {
    id: randomUUID(),
    policyId: input.policyId ?? null,
    policyType: input.policyType,
    severity: input.severity,
    actionTaken: input.actionTaken,
    remediationActorId: null,
    remediationAt: null,
    remediationNote: null,
    remediationStatus: "open",
    actorId: storageActor.subject,
    targetType: input.targetType,
    targetId: input.targetId,
    message: input.message,
    metadata: input.metadata ?? {},
    createdAt: new Date().toISOString(),
  }

  if (db) {
    await db.insert(policyViolations).values({
      id: record.id,
      policyId: record.policyId,
      policyType: record.policyType,
      severity: record.severity,
      actionTaken: record.actionTaken,
      actorId: record.actorId,
      targetType: record.targetType,
      targetId: record.targetId,
      message: record.message,
      metadata: record.metadata,
      createdAt: new Date(record.createdAt),
    })
  } else {
    appendPolicyViolationForRuntime(record)
  }

  await emitAudit({
    actorId: input.actor.subject,
    action: "admin.policy_violation.recorded",
    targetType: "admin.policy_violations",
    targetId: record.id,
    reason: record.message,
    metadata: {
      ...record.metadata,
      actionTaken: record.actionTaken,
      policyType: record.policyType,
      severity: record.severity,
      violatedTargetId: record.targetId,
      violatedTargetType: record.targetType,
    },
  })

  return record
}
