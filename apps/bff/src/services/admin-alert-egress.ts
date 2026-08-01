import { randomUUID } from "node:crypto"
import {
  type AdminAlertEgressResponse,
  type UpdateAdminAlertEgressRequest,
  adminAlertEgressResponseSchema,
} from "@llm-machines/contracts/inference-core"
import { and, eq } from "drizzle-orm"
import type { Actor } from "../auth/authorization"
import { canUseBffFixtureData } from "../config/fixture-mode"
import {
  type InferenceCoreDatabase,
  getInferenceCoreDb,
} from "../db/inference-core-client"
import { auditEvents, consoleSettings } from "../db/inference-core-schema"
import { emitAudit } from "./audit"
import type { IdentityMutationRouteContext } from "./identity-mutation-journal"
import { upsertActorUser } from "./users"

const singletonSettingsId = "singleton"
const warningVersion = "alert-egress-v1" as const

type AlertEgressRow = Pick<
  typeof consoleSettings.$inferSelect,
  | "alertDeliveryMode"
  | "alertDeliveryTransport"
  | "alertEgressAcknowledgedAt"
  | "alertEgressAcknowledgedBy"
  | "alertEgressRevision"
  | "alertEgressUpdatedAt"
  | "alertEgressUpdatedBy"
  | "alertEgressWarningVersion"
>

type CommitWithReceipt = NonNullable<
  IdentityMutationRouteContext["commitWithReceipt"]
>

const responseConstants = {
  destinationState: "not_stored",
  outboundDeliveryEnabled: false,
  runtimeQualified: false,
  secretState: "not_stored",
} as const

let memoryState = defaultAlertEgressState()

export class AdminAlertEgressConflictError extends Error {
  constructor() {
    super("Alert egress state changed before this update was applied.")
    this.name = "AdminAlertEgressConflictError"
  }
}

export class AdminAlertEgressUnavailableError extends Error {
  constructor() {
    super("Alert egress state is unavailable.")
    this.name = "AdminAlertEgressUnavailableError"
  }
}

export async function getAdminAlertEgress(
  database: InferenceCoreDatabase | null = getInferenceCoreDb(),
): Promise<AdminAlertEgressResponse> {
  if (!database) {
    assertFixtureStorage()
    return cloneResponse(memoryState)
  }

  const [row] = await database
    .select()
    .from(consoleSettings)
    .where(eq(consoleSettings.id, singletonSettingsId))
    .limit(1)
  if (!row) {
    throw new AdminAlertEgressUnavailableError()
  }
  return projectAlertEgress(row)
}

export async function updateAdminAlertEgress(
  actor: Actor,
  correlationId: string,
  request: UpdateAdminAlertEgressRequest,
  commitWithReceipt?: CommitWithReceipt,
  database: InferenceCoreDatabase | null = getInferenceCoreDb(),
): Promise<AdminAlertEgressResponse> {
  const nextRevision = request.expectedRevision + 1
  if (!Number.isSafeInteger(nextRevision)) {
    throw new AdminAlertEgressConflictError()
  }
  const now = new Date()
  const values = mutationValues(actor, request, nextRevision, now)
  if (!database) {
    assertFixtureStorage()
    if (memoryState.revision !== request.expectedRevision) {
      throw new AdminAlertEgressConflictError()
    }
    memoryState = adminAlertEgressResponseSchema.parse({
      ...responseConstants,
      deliveryState:
        request.transport === "disabled"
          ? "disabled"
          : "prepared_pending_runtime_qualification",
      revision: nextRevision,
      transport: request.transport,
      updatedAt: now.toISOString(),
      updatedBySubjectId: actor.subject,
      warningAcknowledgedAt:
        request.transport === "disabled" ? null : now.toISOString(),
      warningAcknowledgedBySubjectId:
        request.transport === "disabled" ? null : actor.subject,
      warningVersion: request.transport === "disabled" ? null : warningVersion,
    })
    await emitAudit({
      action: "admin.observability.alert_egress.updated",
      correlationId,
      keycloakSubjectId: actor.subject,
      outcome: "succeeded",
      sourceSystem: "console",
    })
    return cloneResponse(memoryState)
  }

  if (!commitWithReceipt) {
    throw new AdminAlertEgressUnavailableError()
  }

  return commitWithReceipt({
    resourceId: singletonSettingsId,
    run: async (transaction) => {
      if (!transaction) {
        throw new AdminAlertEgressUnavailableError()
      }
      await upsertActorUser(actor, transaction)
      const [updated] = await transaction
        .update(consoleSettings)
        .set(values)
        .where(
          and(
            eq(consoleSettings.id, singletonSettingsId),
            eq(consoleSettings.alertEgressRevision, request.expectedRevision),
          ),
        )
        .returning()
      if (!updated) {
        throw new AdminAlertEgressConflictError()
      }
      await transaction.insert(auditEvents).values({
        id: randomUUID(),
        action: "admin.observability.alert_egress.updated",
        correlationId,
        ingestedAt: now,
        keycloakSubjectId: actor.subject,
        occurredAt: now,
        outcome: "succeeded",
        sourceSystem: "console",
      })
      return projectAlertEgress(updated)
    },
  })
}

export function resetAdminAlertEgressForTest(): void {
  memoryState = defaultAlertEgressState()
}

function mutationValues(
  actor: Actor,
  request: UpdateAdminAlertEgressRequest,
  nextRevision: number,
  now: Date,
) {
  const enabled = request.transport !== "disabled"
  return {
    alertDeliveryMode: enabled ? "customer_owned" : "local_only",
    alertDeliveryTransport: enabled ? request.transport : null,
    alertEgressAcknowledgedAt: enabled ? now : null,
    alertEgressAcknowledgedBy: enabled ? actor.subject : null,
    alertEgressRevision: nextRevision,
    alertEgressUpdatedAt: now,
    alertEgressUpdatedBy: actor.subject,
    alertEgressWarningVersion: enabled ? warningVersion : null,
  }
}

function projectAlertEgress(row: AlertEgressRow): AdminAlertEgressResponse {
  const disabled = row.alertDeliveryMode === "local_only"
  const transport = disabled ? "disabled" : row.alertDeliveryTransport
  const candidate = {
    ...responseConstants,
    deliveryState: disabled
      ? "disabled"
      : "prepared_pending_runtime_qualification",
    revision: row.alertEgressRevision,
    transport,
    updatedAt: row.alertEgressUpdatedAt?.toISOString() ?? null,
    updatedBySubjectId: row.alertEgressUpdatedBy,
    warningAcknowledgedAt: row.alertEgressAcknowledgedAt?.toISOString() ?? null,
    warningAcknowledgedBySubjectId: row.alertEgressAcknowledgedBy,
    warningVersion: row.alertEgressWarningVersion,
  }
  const parsed = adminAlertEgressResponseSchema.safeParse(candidate)
  if (!parsed.success) {
    throw new AdminAlertEgressUnavailableError()
  }
  return parsed.data
}

function defaultAlertEgressState(): AdminAlertEgressResponse {
  return adminAlertEgressResponseSchema.parse({
    ...responseConstants,
    deliveryState: "disabled",
    revision: 0,
    transport: "disabled",
    updatedAt: null,
    updatedBySubjectId: null,
    warningAcknowledgedAt: null,
    warningAcknowledgedBySubjectId: null,
    warningVersion: null,
  })
}

function assertFixtureStorage(): void {
  if (!canUseBffFixtureData()) {
    throw new AdminAlertEgressUnavailableError()
  }
}

function cloneResponse(
  value: AdminAlertEgressResponse,
): AdminAlertEgressResponse {
  return adminAlertEgressResponseSchema.parse(structuredClone(value))
}
