import {
  type LifecycleComponent,
  type LifecycleFailureCode,
  type LifecycleOperationKind,
  type LifecycleOperationState,
  type LifecycleSnapshotManifest,
  lifecycleComponentSchema,
  lifecycleFailureCodeSchema,
  lifecycleOperationKindSchema,
  lifecycleOperationStateSchema,
  lifecycleSnapshotManifestSchema,
} from "@llm-machines/contracts"
import { and, eq, sql } from "drizzle-orm"
import {
  type InferenceCoreDatabase,
  getInferenceCoreDb,
} from "../db/inference-core-client"
import {
  humanIdentities,
  lifecycleOperationEvents,
  lifecycleOperations,
  lifecycleSnapshotComponents,
  lifecycleSnapshotManifests,
} from "../db/inference-core-schema"
import { verifyLifecycleSnapshotManifestDigest } from "./lifecycle-snapshot-manifest"

export const lifecycleOperationPhases = [
  "operation",
  "quiesce",
  "capture",
  "validate",
  "restore",
  "verify",
  "resume",
  "rollback",
  "emergency_isolation_fence",
  "emergency_isolation_reassertion",
  "emergency_session_fence",
  "emergency_session_reset",
  "credential_consistency",
  "discard_preparation",
] as const
export type LifecycleOperationPhase = (typeof lifecycleOperationPhases)[number]

export const lifecyclePhaseOutcomes = [
  "started",
  "succeeded",
  "failed",
] as const
export type LifecyclePhaseOutcome = (typeof lifecyclePhaseOutcomes)[number]

export interface BeginLifecycleOperationInput {
  actorSubjectId: string
  at: Date
  correlationId: string
  kind: LifecycleOperationKind
  operationId: string
  snapshotId: string
}

export interface TransitionLifecycleOperationInput {
  at: Date
  expectedState: LifecycleOperationState
  failureCode?: LifecycleFailureCode
  nextState: LifecycleOperationState
  operationId: string
}

export interface RecordLifecyclePhaseInput {
  at: Date
  component?: LifecycleComponent
  failureCode?: LifecycleFailureCode
  operationId: string
  operationState: LifecycleOperationState
  outcome: LifecyclePhaseOutcome
  phase: LifecycleOperationPhase
}

export interface LifecycleOperationRecord {
  actorSubjectId: string
  completedAt: Date | null
  correlationId: string
  createdAt: Date
  failureCode: LifecycleFailureCode | null
  id: string
  kind: LifecycleOperationKind
  snapshotId: string
  state: LifecycleOperationState
  updatedAt: Date
}

export interface LifecycleOperationEventRecord {
  component: LifecycleComponent | null
  failureCode: LifecycleFailureCode | null
  occurredAt: Date
  operationId: string
  operationState: LifecycleOperationState
  outcome: LifecyclePhaseOutcome
  phase: LifecycleOperationPhase
  sequence: number
}

export interface LifecycleOperationJournal {
  begin(input: BeginLifecycleOperationInput): Promise<"busy" | "created">
  recordPhase(input: RecordLifecyclePhaseInput): Promise<boolean>
  saveManifest(manifest: LifecycleSnapshotManifest): Promise<boolean>
  transition(input: TransitionLifecycleOperationInput): Promise<boolean>
}

export interface LifecycleRestoreOperationStatus {
  kind: "restore"
  operationId: string
  state: LifecycleOperationState
}

export interface LifecycleUnfencedRestoreOperation
  extends LifecycleRestoreOperationStatus {
  state: "prepared" | "recovery_required"
}

export interface LifecycleRestoreIsolationRecoveryAuthority {
  readRestoreOperation(
    operationId: string,
  ): Promise<LifecycleRestoreOperationStatus | null>
  readUnfencedRestore(): Promise<LifecycleUnfencedRestoreOperation | null>
  recordIsolationReconciled(operationId: string, at: Date): Promise<boolean>
  terminalizeUnfencedRestore(operationId: string, at: Date): Promise<boolean>
}

const terminalStates = new Set<LifecycleOperationState>([
  "succeeded",
  "rolled_back",
  "failed",
  "recovery_required",
])

const failureStates = new Set<LifecycleOperationState>([
  "rolling_back",
  "rolled_back",
  "failed",
  "recovery_required",
])

const unresolvedStates = new Set<LifecycleOperationState>([
  "prepared",
  "quiescing",
  "capturing",
  "validating",
  "restoring",
  "verifying",
  "resuming",
  "rolling_back",
  "recovery_required",
])

export function createDrizzleLifecycleOperationJournal(
  database: InferenceCoreDatabase | null = getInferenceCoreDb(),
): LifecycleOperationJournal | null {
  return database ? new DrizzleLifecycleOperationJournal(database) : null
}

export function createDrizzleLifecycleRestoreIsolationRecoveryAuthority(
  database: InferenceCoreDatabase | null = getInferenceCoreDb(),
): LifecycleRestoreIsolationRecoveryAuthority | null {
  return database
    ? new DrizzleLifecycleRestoreIsolationRecoveryAuthority(database)
    : null
}

class DrizzleLifecycleRestoreIsolationRecoveryAuthority
  implements LifecycleRestoreIsolationRecoveryAuthority
{
  constructor(private readonly database: InferenceCoreDatabase) {}

  async readRestoreOperation(
    operationId: string,
  ): Promise<LifecycleRestoreOperationStatus | null> {
    assertRecoveryAuthorityOperationId(operationId)
    const result = await this.database.execute(sql<RecoveryOperationRow>`
      SELECT
        operation.id AS operation_id,
        operation.kind,
        operation.state
      FROM ${lifecycleOperations} AS operation
      WHERE operation.id = ${operationId}
      LIMIT 1
    `)
    const rows = recoveryResultRows(result)
    if (rows.length === 0) {
      return null
    }
    if (rows.length !== 1) {
      throw new LifecycleRestoreIsolationRecoveryStorageError()
    }
    return asRestoreOperationStatus(parseRecoveryOperationRow(rows[0]))
  }

  async readUnfencedRestore(): Promise<LifecycleUnfencedRestoreOperation | null> {
    const result = await this.database.execute(sql<RecoveryOperationRow>`
      SELECT
        operation.id AS operation_id,
        operation.kind,
        operation.state
      FROM ${lifecycleOperations} AS operation
      WHERE operation.kind = 'restore'
        AND operation.state IN ('prepared', 'recovery_required')
        AND NOT EXISTS (
          SELECT 1
          FROM ${lifecycleOperationEvents} AS isolation_event
          WHERE isolation_event.operation_id = operation.id
            AND isolation_event.outcome = 'succeeded'
            AND isolation_event.phase IN (
              'emergency_isolation_fence',
              'emergency_isolation_reassertion'
            )
      )
      ORDER BY operation.created_at ASC, operation.id ASC
      LIMIT 2
    `)
    const rows = recoveryResultRows(result)
    if (rows.length === 0) {
      return null
    }
    if (rows.length !== 1) {
      throw new LifecycleRestoreIsolationRecoveryStorageError()
    }
    const status = parseRecoveryOperationRow(rows[0])
    if (status.kind !== "restore" || !isUnfencedRestoreState(status.state)) {
      throw new LifecycleRestoreIsolationRecoveryStorageError()
    }
    return { ...status, kind: "restore", state: status.state }
  }

  async terminalizeUnfencedRestore(
    operationId: string,
    at: Date,
  ): Promise<boolean> {
    assertRecoveryAuthorityMutationInput(operationId, at)
    return this.database.transaction(async (transaction) => {
      const current = await lockedOperation(transaction, operationId)
      const status = parseStoredRestoreOperationStatus(current)
      if (!status || !isUnfencedRestoreState(status.state)) {
        return false
      }
      const counts = await isolationSuccessCounts(transaction, operationId)
      if (!counts || counts.fence !== 0 || counts.reassertion !== 0) {
        return false
      }
      if (status.state === "recovery_required") {
        return true
      }
      if (!current || at < current.updatedAt) {
        return false
      }

      const updated = await transaction
        .update(lifecycleOperations)
        .set({
          completedAt: at,
          failureCode: "restore_failed",
          state: "recovery_required",
          updatedAt: at,
        })
        .where(
          and(
            eq(lifecycleOperations.id, operationId),
            eq(lifecycleOperations.kind, "restore"),
            eq(lifecycleOperations.state, "prepared"),
          ),
        )
        .returning({ id: lifecycleOperations.id })
      if (updated.length !== 1) {
        return false
      }
      await transaction.insert(lifecycleOperationEvents).values({
        component: null,
        failureCode: "restore_failed",
        occurredAt: at,
        operationId,
        operationState: "recovery_required",
        outcome: "failed",
        phase: "operation",
        sequence: await nextEventSequence(transaction, operationId),
      })
      return true
    })
  }

  async recordIsolationReconciled(
    operationId: string,
    at: Date,
  ): Promise<boolean> {
    assertRecoveryAuthorityMutationInput(operationId, at)
    return this.database.transaction(async (transaction) => {
      const current = await lockedOperation(transaction, operationId)
      const status = parseStoredRestoreOperationStatus(current)
      if (!current || !status || status.state !== "recovery_required") {
        return false
      }
      const before = await isolationSuccessCounts(transaction, operationId)
      if (!before || before.fence !== 0 || before.reassertion > 1) {
        return false
      }
      if (before.reassertion === 1) {
        return true
      }
      if (at < current.updatedAt) {
        return false
      }

      await transaction.insert(lifecycleOperationEvents).values({
        component: null,
        failureCode: null,
        occurredAt: at,
        operationId,
        operationState: "recovery_required",
        outcome: "succeeded",
        phase: "emergency_isolation_reassertion",
        sequence: await nextEventSequence(transaction, operationId),
      })
      const after = await isolationSuccessCounts(transaction, operationId)
      return after?.fence === 0 && after.reassertion === 1
    })
  }
}

class DrizzleLifecycleOperationJournal implements LifecycleOperationJournal {
  constructor(private readonly database: InferenceCoreDatabase) {}

  async begin(
    input: BeginLifecycleOperationInput,
  ): Promise<"busy" | "created"> {
    assertBeginInput(input)
    return this.database.transaction(async (transaction) => {
      await transaction
        .insert(humanIdentities)
        .values({
          firstSeenAt: input.at,
          lastSeenAt: input.at,
          subjectId: input.actorSubjectId,
        })
        .onConflictDoUpdate({
          target: humanIdentities.subjectId,
          set: {
            lastSeenAt: sql`greatest(${humanIdentities.lastSeenAt}, ${input.at})`,
          },
        })

      const rows = await transaction
        .insert(lifecycleOperations)
        .values({
          actorSubjectId: input.actorSubjectId,
          completedAt: null,
          correlationId: input.correlationId,
          createdAt: input.at,
          failureCode: null,
          id: input.operationId,
          kind: input.kind,
          snapshotId: input.snapshotId,
          state: "prepared",
          updatedAt: input.at,
        })
        .onConflictDoNothing()
        .returning({ id: lifecycleOperations.id })
      if (rows.length !== 1) {
        return "busy"
      }

      await transaction.insert(lifecycleOperationEvents).values({
        component: null,
        failureCode: null,
        occurredAt: input.at,
        operationId: input.operationId,
        operationState: "prepared",
        outcome: "started",
        phase: "operation",
        sequence: 0,
      })
      return "created"
    })
  }

  async transition(input: TransitionLifecycleOperationInput): Promise<boolean> {
    assertTransitionInput(input)
    return this.database.transaction(async (transaction) => {
      const current = await lockedOperation(transaction, input.operationId)
      if (!current || current.state !== input.expectedState) {
        return false
      }
      const kind = lifecycleOperationKindSchema.safeParse(current.kind)
      if (
        !kind.success ||
        input.at < current.updatedAt ||
        !operationTransitionAllowed(kind.data, current.state, input.nextState)
      ) {
        return false
      }

      const failureCode = nextFailureCode(current.failureCode, input)
      if (
        (failureStates.has(input.nextState) && failureCode === null) ||
        (!failureStates.has(input.nextState) && failureCode !== null)
      ) {
        return false
      }

      const completedAt = terminalStates.has(input.nextState) ? input.at : null
      const rows = await transaction
        .update(lifecycleOperations)
        .set({
          completedAt,
          failureCode,
          state: input.nextState,
          updatedAt: input.at,
        })
        .where(
          and(
            eq(lifecycleOperations.id, input.operationId),
            eq(lifecycleOperations.state, input.expectedState),
          ),
        )
        .returning({ id: lifecycleOperations.id })
      if (rows.length !== 1) {
        return false
      }

      await transaction.insert(lifecycleOperationEvents).values({
        component: null,
        failureCode,
        occurredAt: input.at,
        operationId: input.operationId,
        operationState: input.nextState,
        outcome: operationTransitionOutcome(input.nextState),
        phase: "operation",
        sequence: await nextEventSequence(transaction, input.operationId),
      })
      return true
    })
  }

  async recordPhase(input: RecordLifecyclePhaseInput): Promise<boolean> {
    assertPhaseInput(input)
    return this.database.transaction(async (transaction) => {
      const current = await lockedOperation(transaction, input.operationId)
      if (
        !current ||
        current.state !== input.operationState ||
        input.at < current.updatedAt
      ) {
        return false
      }

      await transaction.insert(lifecycleOperationEvents).values({
        component: input.component ?? null,
        failureCode: input.failureCode ?? null,
        occurredAt: input.at,
        operationId: input.operationId,
        operationState: input.operationState,
        outcome: input.outcome,
        phase: input.phase,
        sequence: await nextEventSequence(transaction, input.operationId),
      })
      return true
    })
  }

  async saveManifest(manifest: LifecycleSnapshotManifest): Promise<boolean> {
    const parsed = lifecycleSnapshotManifestSchema.safeParse(manifest)
    if (
      !parsed.success ||
      !verifyLifecycleSnapshotManifestDigest(parsed.data)
    ) {
      return false
    }

    return this.database.transaction(async (transaction) => {
      const current = await lockedOperation(
        transaction,
        parsed.data.operationId,
      )
      if (
        !current ||
        current.kind !== "snapshot" ||
        current.state !== "validating" ||
        current.snapshotId !== parsed.data.snapshotId ||
        new Date(parsed.data.capturedAt) < current.createdAt
      ) {
        return false
      }

      const inserted = await transaction
        .insert(lifecycleSnapshotManifests)
        .values({
          capturedAt: new Date(parsed.data.capturedAt),
          componentCount: parsed.data.components.length,
          contentFree: parsed.data.contentFree,
          emergencySessionsIncluded: parsed.data.emergencySessionsIncluded,
          manifestSha256: parsed.data.manifestSha256,
          operationId: parsed.data.operationId,
          plaintextSecretsIncluded: parsed.data.plaintextSecretsIncluded,
          schemaVersion: parsed.data.schemaVersion,
          snapshotId: parsed.data.snapshotId,
          workloadContentIncluded: parsed.data.workloadContentIncluded,
        })
        .onConflictDoNothing()
        .returning({ snapshotId: lifecycleSnapshotManifests.snapshotId })
      if (inserted.length !== 1) {
        return false
      }

      await transaction.insert(lifecycleSnapshotComponents).values(
        parsed.data.components.map((component) => ({
          artifactSha256: component.artifactSha256,
          component: component.component,
          ordinal: component.ordinal,
          revision: component.revision,
          snapshotId: parsed.data.snapshotId,
        })),
      )
      return true
    })
  }
}

type LifecycleTransaction = Parameters<
  Parameters<InferenceCoreDatabase["transaction"]>[0]
>[0]

interface RecoveryOperationRow {
  kind: string
  operation_id: string
  state: string
}

interface ValidatedRecoveryOperationRow {
  kind: LifecycleOperationKind
  operationId: string
  state: LifecycleOperationState
}

class LifecycleRestoreIsolationRecoveryStorageError extends Error {
  constructor() {
    super("Lifecycle restore isolation recovery storage returned invalid data.")
    this.name = "LifecycleRestoreIsolationRecoveryStorageError"
  }
}

function parseRecoveryOperationRow(
  value: unknown,
): ValidatedRecoveryOperationRow {
  if (!value || typeof value !== "object") {
    throw new LifecycleRestoreIsolationRecoveryStorageError()
  }
  const row = value as Partial<RecoveryOperationRow>
  const kind = lifecycleOperationKindSchema.safeParse(row.kind)
  const state = lifecycleOperationStateSchema.safeParse(row.state)
  if (
    typeof row.operation_id !== "string" ||
    !uuid(row.operation_id) ||
    !kind.success ||
    !state.success
  ) {
    throw new LifecycleRestoreIsolationRecoveryStorageError()
  }
  return {
    kind: kind.data,
    operationId: row.operation_id,
    state: state.data,
  }
}

function asRestoreOperationStatus(
  value: ValidatedRecoveryOperationRow,
): LifecycleRestoreOperationStatus | null {
  return value.kind === "restore"
    ? {
        kind: "restore",
        operationId: value.operationId,
        state: value.state,
      }
    : null
}

function parseStoredRestoreOperationStatus(
  value: typeof lifecycleOperations.$inferSelect | null,
): LifecycleRestoreOperationStatus | null {
  return value
    ? asRestoreOperationStatus(
        parseRecoveryOperationRow({
          kind: value.kind,
          operation_id: value.id,
          state: value.state,
        }),
      )
    : null
}

function isUnfencedRestoreState(
  state: LifecycleOperationState,
): state is "prepared" | "recovery_required" {
  return state === "prepared" || state === "recovery_required"
}

async function isolationSuccessCounts(
  transaction: LifecycleTransaction,
  operationId: string,
): Promise<{ fence: number; reassertion: number } | null> {
  const result = await transaction.execute(sql<{
    fence_count: number | string
    reassertion_count: number | string
  }>`
    SELECT
      count(*) FILTER (
        WHERE phase = 'emergency_isolation_fence'
          AND outcome = 'succeeded'
      )::integer AS fence_count,
      count(*) FILTER (
        WHERE phase = 'emergency_isolation_reassertion'
          AND outcome = 'succeeded'
      )::integer AS reassertion_count
    FROM ${lifecycleOperationEvents}
    WHERE operation_id = ${operationId}
  `)
  const rows = recoveryResultRows(result)
  if (rows.length !== 1) {
    throw new LifecycleRestoreIsolationRecoveryStorageError()
  }
  const row = rows[0]
  if (!row || typeof row !== "object") {
    throw new LifecycleRestoreIsolationRecoveryStorageError()
  }
  const candidate = row as {
    fence_count?: unknown
    reassertion_count?: unknown
  }
  const fence = recoveryCount(candidate.fence_count)
  const reassertion = recoveryCount(candidate.reassertion_count)
  if (fence === null || reassertion === null) {
    throw new LifecycleRestoreIsolationRecoveryStorageError()
  }
  return { fence, reassertion }
}

function assertRecoveryAuthorityOperationId(operationId: string): void {
  if (!uuid(operationId)) {
    throw new Error("Invalid lifecycle restore isolation recovery input.")
  }
}

function assertRecoveryAuthorityMutationInput(
  operationId: string,
  at: Date,
): void {
  if (!uuid(operationId) || !validDate(at)) {
    throw new Error("Invalid lifecycle restore isolation recovery input.")
  }
}

function recoveryResultRows(result: unknown): unknown[] {
  if (Array.isArray(result)) {
    return result
  }
  if (
    result &&
    typeof result === "object" &&
    "rows" in result &&
    Array.isArray(result.rows)
  ) {
    return result.rows
  }
  throw new LifecycleRestoreIsolationRecoveryStorageError()
}

function recoveryCount(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isInteger(value) && value >= 0 ? value : null
  }
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(value)) {
    return null
  }
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

async function lockedOperation(
  transaction: LifecycleTransaction,
  operationId: string,
): Promise<typeof lifecycleOperations.$inferSelect | null> {
  await transaction.execute(sql`
    SELECT id
    FROM ${lifecycleOperations}
    WHERE ${lifecycleOperations.id} = ${operationId}
    FOR UPDATE
  `)
  const rows = await transaction
    .select()
    .from(lifecycleOperations)
    .where(eq(lifecycleOperations.id, operationId))
    .limit(1)
  return rows[0] ?? null
}

async function nextEventSequence(
  transaction: LifecycleTransaction,
  operationId: string,
): Promise<number> {
  const rows = await transaction
    .select({
      maximum: sql<number>`coalesce(max(${lifecycleOperationEvents.sequence}), -1)`,
    })
    .from(lifecycleOperationEvents)
    .where(eq(lifecycleOperationEvents.operationId, operationId))
  return Number(rows[0]?.maximum ?? -1) + 1
}

function nextFailureCode(
  current: string | null,
  input: TransitionLifecycleOperationInput,
): LifecycleFailureCode | null {
  if (!failureStates.has(input.nextState)) {
    return null
  }
  const candidate = input.failureCode ?? current
  const parsed = lifecycleFailureCodeSchema.safeParse(candidate)
  return parsed.success ? parsed.data : null
}

function operationTransitionOutcome(
  state: LifecycleOperationState,
): LifecyclePhaseOutcome {
  if (failureStates.has(state)) {
    return "failed"
  }
  return state === "succeeded" ? "succeeded" : "started"
}

const snapshotOperationEdges: Readonly<
  Partial<Record<LifecycleOperationState, readonly LifecycleOperationState[]>>
> = {
  capturing: ["validating", "resuming", "failed", "recovery_required"],
  prepared: ["quiescing", "failed", "recovery_required"],
  quiescing: ["capturing", "resuming", "failed", "recovery_required"],
  resuming: ["succeeded", "failed", "recovery_required"],
  validating: ["resuming", "failed", "recovery_required"],
}

const restoreOperationEdges: Readonly<
  Partial<Record<LifecycleOperationState, readonly LifecycleOperationState[]>>
> = {
  prepared: ["validating", "failed", "recovery_required"],
  quiescing: ["restoring", "resuming", "failed", "recovery_required"],
  restoring: ["verifying", "rolling_back", "recovery_required"],
  resuming: [
    "succeeded",
    "rolling_back",
    "rolled_back",
    "failed",
    "recovery_required",
  ],
  rolling_back: ["resuming", "recovery_required"],
  validating: ["quiescing", "failed", "recovery_required"],
  verifying: ["resuming", "rolling_back", "recovery_required"],
}

function operationTransitionAllowed(
  kind: LifecycleOperationKind,
  currentState: LifecycleOperationState,
  nextState: LifecycleOperationState,
): boolean {
  const edges =
    kind === "snapshot" ? snapshotOperationEdges : restoreOperationEdges
  return edges[currentState]?.includes(nextState) ?? false
}

function assertBeginInput(input: BeginLifecycleOperationInput): void {
  if (
    !lifecycleOperationKindSchema.safeParse(input.kind).success ||
    !uuid(input.operationId) ||
    !uuid(input.snapshotId) ||
    !boundedText(input.actorSubjectId, 255) ||
    !boundedText(input.correlationId, 128) ||
    !validDate(input.at)
  ) {
    throw new Error("Invalid lifecycle operation journal input.")
  }
}

function assertTransitionInput(input: TransitionLifecycleOperationInput): void {
  if (
    !uuid(input.operationId) ||
    !lifecycleOperationStateSchema.safeParse(input.expectedState).success ||
    !lifecycleOperationStateSchema.safeParse(input.nextState).success ||
    (input.failureCode !== undefined &&
      !lifecycleFailureCodeSchema.safeParse(input.failureCode).success) ||
    !validDate(input.at)
  ) {
    throw new Error("Invalid lifecycle operation transition.")
  }
}

function assertPhaseInput(input: RecordLifecyclePhaseInput): void {
  const componentPhase = [
    "quiesce",
    "capture",
    "validate",
    "restore",
    "verify",
    "resume",
    "rollback",
    "discard_preparation",
  ].includes(input.phase)
  const componentValid =
    input.component !== undefined &&
    lifecycleComponentSchema.safeParse(input.component).success
  const failureValid =
    input.outcome === "failed"
      ? lifecycleFailureCodeSchema.safeParse(input.failureCode).success
      : input.failureCode === undefined
  if (
    !uuid(input.operationId) ||
    !lifecycleOperationStateSchema.safeParse(input.operationState).success ||
    !lifecycleOperationPhases.includes(input.phase) ||
    input.phase === "operation" ||
    !phaseStateAllowed(input.phase, input.operationState) ||
    !lifecyclePhaseOutcomes.includes(input.outcome) ||
    (componentPhase ? !componentValid : input.component !== undefined) ||
    !failureValid ||
    !validDate(input.at)
  ) {
    throw new Error("Invalid lifecycle operation phase event.")
  }
}

function phaseStateAllowed(
  phase: LifecycleOperationPhase,
  state: LifecycleOperationState,
): boolean {
  switch (phase) {
    case "operation":
      return false
    case "quiesce":
      return state === "quiescing" || state === "rolling_back"
    case "capture":
      return state === "capturing"
    case "validate":
      return state === "validating"
    case "restore":
      return state === "restoring"
    case "verify":
      return state === "verifying"
    case "resume":
      return state === "resuming"
    case "rollback":
      return state === "rolling_back"
    case "emergency_isolation_fence":
      return ["prepared", "quiescing", "resuming"].includes(state)
    case "emergency_isolation_reassertion":
      return [
        "prepared",
        "validating",
        "quiescing",
        "restoring",
        "verifying",
        "rolling_back",
        "resuming",
        "recovery_required",
      ].includes(state)
    case "emergency_session_fence":
      return ["quiescing", "resuming", "rolling_back"].includes(state)
    case "emergency_session_reset":
      return ["quiescing", "restoring", "resuming", "rolling_back"].includes(
        state,
      )
    case "credential_consistency":
      return state === "verifying"
    case "discard_preparation":
      return ["validating", "verifying", "rolling_back"].includes(state)
  }
}

function validDate(value: Date): boolean {
  return value instanceof Date && Number.isFinite(value.getTime())
}

function boundedText(value: string, maximum: number): boolean {
  return value.length >= 1 && value.length <= maximum
}

function uuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  )
}

export class InMemoryLifecycleOperationJournal
  implements LifecycleOperationJournal
{
  readonly events = new Map<string, LifecycleOperationEventRecord[]>()
  readonly humanIdentities = new Map<
    string,
    { firstSeenAt: Date; lastSeenAt: Date; subjectId: string }
  >()
  readonly manifests = new Map<string, LifecycleSnapshotManifest>()
  readonly operations = new Map<string, LifecycleOperationRecord>()

  async begin(
    input: BeginLifecycleOperationInput,
  ): Promise<"busy" | "created"> {
    assertBeginInput(input)
    const identity = this.humanIdentities.get(input.actorSubjectId)
    if (identity) {
      if (input.at > identity.lastSeenAt) {
        identity.lastSeenAt = input.at
      }
    } else {
      this.humanIdentities.set(input.actorSubjectId, {
        firstSeenAt: input.at,
        lastSeenAt: input.at,
        subjectId: input.actorSubjectId,
      })
    }
    if (
      this.operations.has(input.operationId) ||
      [...this.operations.values()].some((operation) =>
        unresolvedStates.has(operation.state),
      )
    ) {
      return "busy"
    }
    this.operations.set(input.operationId, {
      actorSubjectId: input.actorSubjectId,
      completedAt: null,
      correlationId: input.correlationId,
      createdAt: input.at,
      failureCode: null,
      id: input.operationId,
      kind: input.kind,
      snapshotId: input.snapshotId,
      state: "prepared",
      updatedAt: input.at,
    })
    this.events.set(input.operationId, [
      {
        component: null,
        failureCode: null,
        occurredAt: input.at,
        operationId: input.operationId,
        operationState: "prepared",
        outcome: "started",
        phase: "operation",
        sequence: 0,
      },
    ])
    return "created"
  }

  async transition(input: TransitionLifecycleOperationInput): Promise<boolean> {
    assertTransitionInput(input)
    const current = this.operations.get(input.operationId)
    if (!current || current.state !== input.expectedState) {
      return false
    }
    if (
      input.at < current.updatedAt ||
      !operationTransitionAllowed(current.kind, current.state, input.nextState)
    ) {
      return false
    }
    const failureCode = nextFailureCode(current.failureCode, input)
    if (
      (failureStates.has(input.nextState) && failureCode === null) ||
      (!failureStates.has(input.nextState) && failureCode !== null)
    ) {
      return false
    }
    const next: LifecycleOperationRecord = {
      ...current,
      completedAt: terminalStates.has(input.nextState) ? input.at : null,
      failureCode,
      state: input.nextState,
      updatedAt: input.at,
    }
    this.operations.set(input.operationId, next)
    this.appendEvent({
      component: null,
      failureCode,
      occurredAt: input.at,
      operationId: input.operationId,
      operationState: input.nextState,
      outcome: operationTransitionOutcome(input.nextState),
      phase: "operation",
    })
    return true
  }

  async recordPhase(input: RecordLifecyclePhaseInput): Promise<boolean> {
    assertPhaseInput(input)
    const current = this.operations.get(input.operationId)
    if (
      !current ||
      current.state !== input.operationState ||
      input.at < current.updatedAt
    ) {
      return false
    }
    this.appendEvent({
      component: input.component ?? null,
      failureCode: input.failureCode ?? null,
      occurredAt: input.at,
      operationId: input.operationId,
      operationState: input.operationState,
      outcome: input.outcome,
      phase: input.phase,
    })
    return true
  }

  async saveManifest(manifest: LifecycleSnapshotManifest): Promise<boolean> {
    const parsed = lifecycleSnapshotManifestSchema.safeParse(manifest)
    if (
      !parsed.success ||
      !verifyLifecycleSnapshotManifestDigest(parsed.data)
    ) {
      return false
    }
    const operation = this.operations.get(parsed.data.operationId)
    if (
      !operation ||
      operation.kind !== "snapshot" ||
      operation.state !== "validating" ||
      operation.snapshotId !== parsed.data.snapshotId ||
      new Date(parsed.data.capturedAt) < operation.createdAt ||
      this.manifests.has(parsed.data.snapshotId)
    ) {
      return false
    }
    this.manifests.set(parsed.data.snapshotId, parsed.data)
    return true
  }

  private appendEvent(
    event: Omit<LifecycleOperationEventRecord, "sequence">,
  ): void {
    const events = this.events.get(event.operationId) ?? []
    events.push({ ...event, sequence: events.length })
    this.events.set(event.operationId, events)
  }
}
