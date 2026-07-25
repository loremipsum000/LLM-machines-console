import { getDb } from "../db/client"
import { egressApprovals } from "../db/schema"
import { eq } from "drizzle-orm"
import type {
  AgenticAdapterEgressResponse,
  AgenticAdapterRevokeEgressResponse,
  CreateEgressApproval,
  EgressApprovalStatus,
} from "@llm-machines/contracts"
import { createEgressApprovalSchema } from "@llm-machines/contracts"

export interface EgressApprovalRecord {
  id: string
  input: CreateEgressApproval
  approvedBy: string
  status: EgressApprovalStatus
  idempotencyKey: string
  requestHash: string
  adapterStatus?: string
  command?: string[]
  rollbackCommand?: string[]
  stdout?: string
  stderr?: string
  failureDetail?: string
  createdAt: string
  appliedAt?: string
  revokedAt?: string
}

const memoryApprovals = new Map<string, EgressApprovalRecord>()

export async function createEgressApprovalRecord(input: {
  approvalId: string
  approval: CreateEgressApproval
  approvedBy: string
  idempotencyKey: string
  requestHash: string
}): Promise<void> {
  const now = new Date()
  const record: EgressApprovalRecord = {
    id: input.approvalId,
    input: input.approval,
    approvedBy: input.approvedBy,
    status: "pending",
    idempotencyKey: input.idempotencyKey,
    requestHash: input.requestHash,
    createdAt: now.toISOString(),
  }

  const db = getDb()
  if (db) {
    await db.insert(egressApprovals).values({
      id: input.approvalId,
      sandboxName: input.approval.sandboxName,
      profile: input.approval.profile,
      endpointHost: input.approval.endpointHost,
      endpointPort: input.approval.endpointPort,
      accessMode: input.approval.accessMode,
      reason: input.approval.reason,
      status: "pending",
      approvedBy: input.approvedBy,
      expiresAt: input.approval.expiresAt
        ? new Date(input.approval.expiresAt)
        : null,
      idempotencyKey: input.idempotencyKey,
      requestHash: input.requestHash,
      executedCommand: [],
      rollbackCommand: [],
      stdout: "",
      stderr: "",
      rollbackMetadata: {},
      createdAt: now,
      updatedAt: now,
    })
  } else {
    memoryApprovals.set(input.approvalId, record)
  }
}

export async function getEgressApprovalRecord(
  approvalId: string,
): Promise<EgressApprovalRecord | null> {
  const db = getDb()
  if (db) {
    const rows = await db
      .select()
      .from(egressApprovals)
      .where(eq(egressApprovals.id, approvalId))
      .limit(1)
    const row = rows[0]
    if (!row) {
      return null
    }
    return {
      id: row.id,
      input: createEgressApprovalSchema.parse({
        sandboxName: row.sandboxName,
        profile: row.profile,
        endpointHost: row.endpointHost,
        endpointPort: row.endpointPort,
        accessMode: row.accessMode,
        reason: row.reason,
        expiresAt: row.expiresAt?.toISOString() ?? null,
      }),
      approvedBy: row.approvedBy,
      status: row.status as EgressApprovalStatus,
      idempotencyKey: row.idempotencyKey ?? "",
      requestHash: row.requestHash ?? "",
      adapterStatus: row.adapterStatus ?? undefined,
      command: arrayFromJson(row.executedCommand),
      rollbackCommand: arrayFromJson(row.rollbackCommand),
      stdout: row.stdout,
      stderr: row.stderr,
      failureDetail: row.failureDetail ?? undefined,
      createdAt: row.createdAt.toISOString(),
      appliedAt: row.appliedAt?.toISOString(),
      revokedAt: row.revokedAt?.toISOString(),
    }
  }

  return memoryApprovals.get(approvalId) ?? null
}

export async function markEgressApprovalResult(input: {
  approvalId: string
  response?: AgenticAdapterEgressResponse
  failureDetail?: string
}): Promise<EgressApprovalStatus> {
  const now = new Date()
  const status: EgressApprovalStatus = input.response
    ? input.response.status === "applied"
      ? "active"
      : "dry_run"
    : "failed"

  const db = getDb()
  if (db) {
    await db
      .update(egressApprovals)
      .set({
        status,
        adapterStatus: input.response?.status,
        executedCommand: input.response?.command ?? [],
        rollbackCommand: input.response?.rollbackCommand ?? [],
        stdout: input.response?.stdout ?? "",
        stderr: input.response?.stderr ?? "",
        failureDetail: input.failureDetail,
        appliedAt: input.response ? now : null,
        updatedAt: now,
      })
      .where(eq(egressApprovals.id, input.approvalId))
  } else {
    const record = memoryApprovals.get(input.approvalId)
    if (record) {
      record.status = status
      record.adapterStatus = input.response?.status
      record.command = input.response?.command
      record.rollbackCommand = input.response?.rollbackCommand
      record.stdout = input.response?.stdout
      record.stderr = input.response?.stderr
      record.failureDetail = input.failureDetail
      record.appliedAt = input.response ? now.toISOString() : undefined
    }
  }

  return status
}

export async function markEgressApprovalRevoked(input: {
  approvalId: string
  response: AgenticAdapterRevokeEgressResponse
}): Promise<void> {
  const now = new Date()
  const db = getDb()
  if (db) {
    await db
      .update(egressApprovals)
      .set({
        status: "revoked",
        adapterStatus: input.response.status,
        stdout: input.response.stdout,
        stderr: input.response.stderr,
        rollbackMetadata: input.response,
        revokedAt: now,
        updatedAt: now,
      })
      .where(eq(egressApprovals.id, input.approvalId))
  } else {
    const record = memoryApprovals.get(input.approvalId)
    if (record) {
      record.status = "revoked"
      record.adapterStatus = input.response.status
      record.stdout = input.response.stdout
      record.stderr = input.response.stderr
      record.revokedAt = now.toISOString()
    }
  }
}

export function resetEgressApprovalsForTest(): void {
  memoryApprovals.clear()
}

function arrayFromJson(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter((item): item is string => typeof item === "string")
}
