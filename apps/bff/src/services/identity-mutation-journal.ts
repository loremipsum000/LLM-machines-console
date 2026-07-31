import { randomUUID } from "node:crypto"
import { and, eq, inArray, sql } from "drizzle-orm"
import { canUseBffFixtureData } from "../config/fixture-mode"
import {
  type InferenceCoreQueryExecutor,
  type InferenceCoreTransaction,
  getInferenceCoreDb,
} from "../db/inference-core-client"
import {
  identityMutationJournal,
  identityMutationJournalTargets,
} from "../db/inference-core-schema"
import { IdempotencyCompletionError } from "./idempotency"

export const IDENTITY_MUTATION_JOURNAL_STORAGE = {
  columns: {
    completedAt: "completed_at",
    createdAt: "created_at",
    id: "id",
    idempotencyLedgerId: "idempotency_ledger_id",
    keycloakAppliedAt: "keycloak_applied_at",
    keycloakSubjectId: "keycloak_subject_id",
    operationCode: "operation_code",
    reconciliationReason: "reconciliation_reason",
    reconciliationRequiredAt: "reconciliation_required_at",
    requestFingerprint: "request_fingerprint",
    resourceId: "resource_id",
    state: "state",
    targetIdentifier: "target_identifier",
    targetType: "target_type",
    updatedAt: "updated_at",
  },
  table: "admin.identity_mutation_journal",
  targets: {
    columns: {
      completedAt: "completed_at",
      createdAt: "created_at",
      id: "id",
      intent: "intent",
      journalId: "journal_id",
      ordinal: "ordinal",
      resourceId: "resource_id",
      startedAt: "started_at",
      state: "state",
      targetIdentifier: "target_identifier",
      targetType: "target_type",
      updatedAt: "updated_at",
    },
    table: "admin.identity_mutation_journal_targets",
  },
} as const

export const IDENTITY_MUTATION_DEADLINE_MS = 30_000
export const IDENTITY_MUTATION_QUEUE_ACQUIRE_TIMEOUT_MS = 2_000

export type IdentityMutationState =
  | "prepared"
  | "keycloak_applied"
  | "completed"
  | "failed"
  | "reconciliation_required"

export type IdentityMutationReconciliationReason =
  | "keycloak_outcome_unknown"
  | "keycloak_applied_persistence_failed"
  | "finalization_failed"
  | "completion_persistence_failed"

export type IdentityMutationTargetType = "group" | "oauth_client" | "user"

export type IdentityMutationChildTargetType = "group_membership" | "user"

export type IdentityMutationTargetState =
  | "unattempted"
  | "unknown"
  | "applied"
  | "failed"

export type IdentityMutationTargetIntent =
  | {
      displayName: string
      email: string
      enabled: boolean
      group: string
      kind: "csv_user"
      line: number
      role: "admin" | "operator"
      sendInvite: boolean
      username: string
    }
  | {
      groupId: string
      kind: "group_membership"
      memberId: string
    }

export interface IdentityMutationTargetInput {
  intent: IdentityMutationTargetIntent
  targetIdentifier: string
  targetType: IdentityMutationChildTargetType
}

export interface IdentityMutationTargetRecord
  extends IdentityMutationTargetInput {
  completedAt: Date | null
  createdAt: Date
  id: string
  journalId: string
  ordinal: number
  resourceId: string | null
  startedAt: Date | null
  state: IdentityMutationTargetState
  updatedAt: Date
}

export interface IdentityMutationIntentInput {
  idempotencyLedgerId: string
  keycloakSubjectId: string
  operationCode: string
  requestFingerprint: string
  targetIdentifier: string
  targetType: IdentityMutationTargetType
}

export interface IdentityMutationJournalRecord
  extends IdentityMutationIntentInput {
  completedAt: Date | null
  createdAt: Date
  id: string
  keycloakAppliedAt: Date | null
  reconciliationReason: IdentityMutationReconciliationReason | null
  reconciliationRequiredAt: Date | null
  resourceId: string | null
  state: IdentityMutationState
  updatedAt: Date
}

export interface IdentityMutationJournalStore {
  /**
   * Insert a prepared row using ON CONFLICT DO NOTHING. Return null when the
   * idempotency row exists or another unresolved identity intent is active.
   */
  insertPrepared(
    input: IdentityMutationIntentInput & { id: string; now: Date },
  ): Promise<IdentityMutationJournalRecord | null>

  findByIdempotencyLedgerId(
    idempotencyLedgerId: string,
  ): Promise<IdentityMutationJournalRecord | null>

  findActive(): Promise<IdentityMutationJournalRecord | null>

  insertTargets(
    inputs: Array<
      IdentityMutationTargetInput & {
        id: string
        journalId: string
        now: Date
        ordinal: number
      }
    >,
  ): Promise<IdentityMutationTargetRecord[]>

  transitionTarget(input: {
    completedAt?: Date | null
    expectedStates: IdentityMutationTargetState[]
    id: string
    nextState: IdentityMutationTargetState
    now: Date
    resourceId?: string | null
    startedAt?: Date | null
  }): Promise<IdentityMutationTargetRecord | null>

  /**
   * Compare and set in one UPDATE. The WHERE clause must match id and one of
   * expectedStates; returning null means no row made the transition.
   */
  transition(input: {
    completedAt?: Date | null
    expectedStates: IdentityMutationState[]
    id: string
    keycloakAppliedAt?: Date | null
    nextState: IdentityMutationState
    now: Date
    reconciliationReason?: IdentityMutationReconciliationReason | null
    reconciliationRequiredAt?: Date | null
    requiredAppliedTargetCount?: number
    resourceId?: string | null
  }): Promise<IdentityMutationJournalRecord | null>
}

export interface IdentityMutationExecutionRuntime {
  deadlineMs?: number
  queueAcquireTimeoutMs?: number
  store: IdentityMutationJournalStore
}

export interface IdentityMutationRouteContext {
  commitWithReceipt?<T>(input: {
    resourceId: string | null
    run(transaction: InferenceCoreTransaction | null): Promise<T>
  }): Promise<T>
  finalizeReceipt(input: { resourceId: string | null }): Promise<void>
  idempotencyLedgerId: string
  operationCode: string
  requestFingerprint: string
  runtime?: IdentityMutationExecutionRuntime
}

export interface KeycloakMutationPhase {
  firstWrite<T>(
    write: () => Promise<T>,
    resourceId: string | ((result: T) => string | null),
  ): Promise<T>
  readAfterWrite<T>(read: () => Promise<T>): Promise<T>
  writeAfterFirst<T>(write: () => Promise<T>): Promise<T>
}

export interface IdentityMutationTargetsPhase {
  readonly count: number
  applied(ordinal: number): Promise<void>
  recordResourceId(ordinal: number, resourceId: string): Promise<void>
  settleFailure(ordinal: number, error: unknown): Promise<void>
  start(ordinal: number): Promise<void>
}

export type BeginIdentityMutationResult =
  | { intent: IdentityMutationJournalRecord; status: "reserved" }
  | {
      intent: IdentityMutationJournalRecord
      status:
        | "already_finalized"
        | "blocked_by_active_reconciliation"
        | "conflict"
        | "reconciliation_required"
    }
  | { status: "unavailable" }

export class IdentityMutationReconciliationRequiredError extends Error {
  readonly status = "reconciliation_required"

  constructor(
    readonly journalId: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = "IdentityMutationReconciliationRequiredError"
  }
}

export class IdentityMutationExecutionError extends Error {
  constructor(
    readonly status:
      | "already_finalized"
      | "blocked_by_active_reconciliation"
      | "conflict"
      | "reconciliation_required"
      | "unavailable",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = "IdentityMutationExecutionError"
  }
}

class IdentityMutationDeadlineError extends Error {
  constructor() {
    super("Identity mutation exceeded its cooperative deadline.")
    this.name = "IdentityMutationDeadlineError"
  }
}

export function createDrizzleIdentityMutationJournalStore(
  database: InferenceCoreQueryExecutor | null = getInferenceCoreDb(),
): IdentityMutationJournalStore | null {
  return database ? new DrizzleIdentityMutationJournalStore(database) : null
}

class DrizzleIdentityMutationJournalStore
  implements IdentityMutationJournalStore
{
  constructor(private readonly database: InferenceCoreQueryExecutor) {}

  async insertPrepared(
    input: IdentityMutationIntentInput & { id: string; now: Date },
  ): Promise<IdentityMutationJournalRecord | null> {
    const rows = await this.database
      .insert(identityMutationJournal)
      .values({
        completedAt: null,
        createdAt: input.now,
        id: input.id,
        idempotencyLedgerId: input.idempotencyLedgerId,
        keycloakAppliedAt: null,
        keycloakSubjectId: input.keycloakSubjectId,
        operationCode: input.operationCode,
        reconciliationReason: null,
        reconciliationRequiredAt: null,
        requestFingerprint: input.requestFingerprint,
        resourceId: null,
        state: "prepared",
        targetIdentifier: input.targetIdentifier,
        targetType: input.targetType,
        updatedAt: input.now,
      })
      .onConflictDoNothing()
      .returning()
    return rows[0] ? recordFromDatabase(rows[0]) : null
  }

  async findByIdempotencyLedgerId(
    idempotencyLedgerId: string,
  ): Promise<IdentityMutationJournalRecord | null> {
    const rows = await this.database
      .select()
      .from(identityMutationJournal)
      .where(
        eq(identityMutationJournal.idempotencyLedgerId, idempotencyLedgerId),
      )
      .limit(1)
    return rows[0] ? recordFromDatabase(rows[0]) : null
  }

  async findActive(): Promise<IdentityMutationJournalRecord | null> {
    const rows = await this.database
      .select()
      .from(identityMutationJournal)
      .where(
        inArray(identityMutationJournal.state, [
          "prepared",
          "keycloak_applied",
          "reconciliation_required",
        ]),
      )
      .limit(1)
    return rows[0] ? recordFromDatabase(rows[0]) : null
  }

  async insertTargets(
    inputs: Parameters<IdentityMutationJournalStore["insertTargets"]>[0],
  ): Promise<IdentityMutationTargetRecord[]> {
    if (inputs.length === 0) {
      return []
    }
    const rows = await this.database
      .insert(identityMutationJournalTargets)
      .values(
        inputs.map((input) => ({
          completedAt: null,
          createdAt: input.now,
          id: input.id,
          intent: input.intent,
          journalId: input.journalId,
          ordinal: input.ordinal,
          resourceId: null,
          startedAt: null,
          state: "unattempted",
          targetIdentifier: input.targetIdentifier,
          targetType: input.targetType,
          updatedAt: input.now,
        })),
      )
      .returning()
    return rows
      .map(targetRecordFromDatabase)
      .sort((left, right) => left.ordinal - right.ordinal)
  }

  async transitionTarget(
    input: Parameters<IdentityMutationJournalStore["transitionTarget"]>[0],
  ): Promise<IdentityMutationTargetRecord | null> {
    if (input.expectedStates.length === 0) {
      return null
    }
    const values: Partial<typeof identityMutationJournalTargets.$inferInsert> =
      {
        state: input.nextState,
        updatedAt: input.now,
      }
    if (Object.hasOwn(input, "completedAt")) {
      values.completedAt = input.completedAt
    }
    if (Object.hasOwn(input, "resourceId")) {
      values.resourceId = input.resourceId
    }
    if (Object.hasOwn(input, "startedAt")) {
      values.startedAt = input.startedAt
    }
    const rows = await this.database
      .update(identityMutationJournalTargets)
      .set(values)
      .where(
        and(
          eq(identityMutationJournalTargets.id, input.id),
          inArray(identityMutationJournalTargets.state, input.expectedStates),
        ),
      )
      .returning()
    return rows[0] ? targetRecordFromDatabase(rows[0]) : null
  }

  async transition(
    input: Parameters<IdentityMutationJournalStore["transition"]>[0],
  ): Promise<IdentityMutationJournalRecord | null> {
    if (input.expectedStates.length === 0) {
      return null
    }
    const values: Partial<typeof identityMutationJournal.$inferInsert> = {
      state: input.nextState,
      updatedAt: input.now,
    }
    if (Object.hasOwn(input, "completedAt")) {
      values.completedAt = input.completedAt
    }
    if (Object.hasOwn(input, "keycloakAppliedAt")) {
      values.keycloakAppliedAt = input.keycloakAppliedAt
    }
    if (Object.hasOwn(input, "reconciliationReason")) {
      values.reconciliationReason = input.reconciliationReason
    }
    if (Object.hasOwn(input, "reconciliationRequiredAt")) {
      values.reconciliationRequiredAt = input.reconciliationRequiredAt
    }
    if (Object.hasOwn(input, "resourceId")) {
      values.resourceId = input.resourceId
    }

    const conditions = [
      eq(identityMutationJournal.id, input.id),
      inArray(identityMutationJournal.state, input.expectedStates),
    ]
    if (input.requiredAppliedTargetCount !== undefined) {
      conditions.push(
        sql`(
          SELECT count(*)::integer
          FROM ${identityMutationJournalTargets}
          WHERE ${identityMutationJournalTargets.journalId} = ${input.id}
        ) = ${input.requiredAppliedTargetCount}`,
        sql`(
          SELECT count(*)::integer
          FROM ${identityMutationJournalTargets}
          WHERE ${identityMutationJournalTargets.journalId} = ${input.id}
            AND ${identityMutationJournalTargets.state} = 'applied'
        ) = ${input.requiredAppliedTargetCount}`,
      )
    }
    const rows = await this.database
      .update(identityMutationJournal)
      .set(values)
      .where(and(...conditions))
      .returning()
    return rows[0] ? recordFromDatabase(rows[0]) : null
  }
}

export async function executeJournaledIdentityMutation<
  Preflight,
  Result,
>(input: {
  apply(
    preflight: Preflight,
    keycloak: KeycloakMutationPhase,
    targets: IdentityMutationTargetsPhase,
  ): Promise<Result>
  atomicFinalization?: boolean
  context: IdentityMutationRouteContext
  finalize(
    result: Result,
    transaction?: InferenceCoreTransaction | null,
  ): Promise<void>
  keycloakSubjectId: string
  preflight(signal: AbortSignal): Promise<Preflight>
  receiptResourceId?: string | ((result: Result) => string | null)
  targetIdentifier: string
  targets?(preflight: Preflight): IdentityMutationTargetInput[]
  targetType: IdentityMutationTargetType
}): Promise<Result> {
  const runtime = input.context.runtime ?? executionRuntimeFromEnvironment()
  if (!runtime) {
    throw new IdentityMutationExecutionError(
      "unavailable",
      "Identity mutation storage is unavailable.",
    )
  }
  if (input.atomicFinalization && !input.context.commitWithReceipt) {
    throw new IdentityMutationExecutionError(
      "unavailable",
      "Atomic identity mutation finalization is unavailable.",
    )
  }

  return enqueueIdentityMutation(
    async () => {
      const deadline = new IdentityMutationDeadline(
        positiveDuration(runtime.deadlineMs, IDENTITY_MUTATION_DEADLINE_MS),
      )
      try {
        deadline.assertActive()
        const reservation = await beginIdentityMutation(runtime.store, {
          idempotencyLedgerId: input.context.idempotencyLedgerId,
          keycloakSubjectId: input.keycloakSubjectId,
          operationCode: input.context.operationCode,
          requestFingerprint: input.context.requestFingerprint,
          targetIdentifier: input.targetIdentifier,
          targetType: input.targetType,
        })
        if (reservation.status !== "reserved") {
          throw executionErrorFromReservation(reservation)
        }

        let preflight: Preflight
        try {
          deadline.assertActive()
          preflight = await input.preflight(deadline.signal)
          deadline.assertActive()
        } catch (error) {
          await recordIdentityMutationRejected(
            runtime.store,
            reservation.intent,
          )
          if (error instanceof IdentityMutationDeadlineError) {
            throw new IdentityMutationExecutionError(
              "unavailable",
              error.message,
            )
          }
          throw error
        }

        let targets: JournaledIdentityMutationTargets
        try {
          targets = await prepareIdentityMutationTargets(
            runtime.store,
            reservation.intent,
            input.targets?.(preflight) ?? [],
            input.targets !== undefined,
          )
        } catch (error) {
          await recordIdentityMutationRejected(
            runtime.store,
            reservation.intent,
          )
          throw error
        }

        const phase = new JournaledKeycloakMutationPhase(
          runtime.store,
          reservation.intent,
          deadline,
        )
        let result!: Result
        try {
          result = await input.apply(preflight, phase, targets)
          targets.assertAllApplied()
          deadline.assertActive()
        } catch (error) {
          await phase.failClosedForUnhandledError(error)
        }
        if (!phase.hasConfirmedWrite()) {
          await phase.failClosedForUnhandledError(
            new Error("Identity mutation returned before a confirmed write."),
          )
        }

        const receiptResourceId = resolveIdentityReceiptResourceId(
          input.receiptResourceId,
          result,
          phase.resourceId(),
        )
        if (input.atomicFinalization) {
          await finalizeIdentityMutationAtomically({
            context: input.context,
            finalize: (transaction) => input.finalize(result, transaction),
            intent: phase.appliedIntent(),
            receiptResourceId,
            requiredAppliedTargetCount: targets.count,
            runtime,
            assertCanContinue: () => deadline.assertActive(),
          })
        } else {
          await finalizeIdentityMutation(
            runtime.store,
            phase.appliedIntent(),
            async () => {
              deadline.assertActive()
              await input.finalize(result)
              deadline.assertActive()
              await input.context.finalizeReceipt({
                resourceId: receiptResourceId,
              })
              deadline.assertActive()
            },
            {
              assertCanContinue: () => deadline.assertActive(),
              requiredAppliedTargetCount: targets.count,
            },
          )
        }
        return result
      } finally {
        deadline.dispose()
      }
    },
    positiveDuration(
      runtime.queueAcquireTimeoutMs,
      IDENTITY_MUTATION_QUEUE_ACQUIRE_TIMEOUT_MS,
    ),
  )
}

class AtomicIdentityJournalCompletionError extends Error {
  constructor(options?: ErrorOptions) {
    super(
      "Identity mutation journal completion could not be persisted.",
      options,
    )
    this.name = "AtomicIdentityJournalCompletionError"
  }
}

async function finalizeIdentityMutationAtomically(input: {
  assertCanContinue(): void
  context: IdentityMutationRouteContext
  finalize(transaction: InferenceCoreTransaction | null): Promise<void>
  intent: IdentityMutationJournalRecord
  receiptResourceId: string | null
  requiredAppliedTargetCount: number
  runtime: IdentityMutationExecutionRuntime
}): Promise<void> {
  const commitWithReceipt = input.context.commitWithReceipt
  if (!commitWithReceipt) {
    throw new IdentityMutationExecutionError(
      "unavailable",
      "Atomic identity mutation finalization is unavailable.",
    )
  }

  try {
    await commitWithReceipt({
      resourceId: input.receiptResourceId,
      run: async (transaction) => {
        input.assertCanContinue()
        await input.finalize(transaction)
        input.assertCanContinue()
        const store = transaction
          ? createDrizzleIdentityMutationJournalStore(transaction)
          : input.runtime.store
        if (!store) {
          throw new AtomicIdentityJournalCompletionError()
        }
        const completedAt = new Date()
        let transitioned: IdentityMutationJournalRecord | null
        try {
          transitioned = await store.transition({
            completedAt,
            expectedStates: ["keycloak_applied"],
            id: input.intent.id,
            nextState: "completed",
            now: completedAt,
            requiredAppliedTargetCount: input.requiredAppliedTargetCount,
          })
        } catch (error) {
          throw new AtomicIdentityJournalCompletionError({ cause: error })
        }
        if (!transitioned) {
          throw new AtomicIdentityJournalCompletionError()
        }
        input.assertCanContinue()
      },
    })
  } catch (error) {
    const now = new Date()
    const reason =
      error instanceof AtomicIdentityJournalCompletionError ||
      error instanceof IdempotencyCompletionError
        ? "completion_persistence_failed"
        : "finalization_failed"
    await markReconciliationBestEffort(
      input.runtime.store,
      input.intent.id,
      reason,
      now,
    )
    throw new IdentityMutationReconciliationRequiredError(
      input.intent.id,
      "The Keycloak mutation succeeded but atomic local finalization failed. Reconcile the target before retrying.",
      { cause: error },
    )
  }
}

function resolveIdentityReceiptResourceId<Result>(
  resourceId: string | ((result: Result) => string | null) | undefined,
  result: Result,
  fallback: string | null,
): string | null {
  return typeof resourceId === "function"
    ? resourceId(result)
    : (resourceId ?? fallback)
}

class IdentityMutationTargetPersistenceError extends Error {
  constructor(
    readonly beforeWrite: boolean,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = "IdentityMutationTargetPersistenceError"
  }
}

async function prepareIdentityMutationTargets(
  store: IdentityMutationJournalStore,
  intent: IdentityMutationJournalRecord,
  inputs: IdentityMutationTargetInput[],
  required: boolean,
): Promise<JournaledIdentityMutationTargets> {
  if (inputs.length === 0) {
    if (required) {
      throw new IdentityMutationExecutionError(
        "unavailable",
        "Identity mutation target manifest is empty.",
      )
    }
    return new JournaledIdentityMutationTargets(store, [])
  }
  if (inputs.length > 100) {
    throw new IdentityMutationExecutionError(
      "unavailable",
      "Identity mutation target manifest exceeds the batch limit.",
    )
  }
  const identifiers = new Set<string>()
  for (const input of inputs) {
    if (
      !input.targetIdentifier.trim() ||
      input.targetIdentifier.length > 511 ||
      identifiers.has(input.targetIdentifier) ||
      !isIdentityMutationTargetIntent(input.intent)
    ) {
      throw new IdentityMutationExecutionError(
        "unavailable",
        "Identity mutation target manifest is invalid.",
      )
    }
    identifiers.add(input.targetIdentifier)
  }

  const now = new Date()
  let records: IdentityMutationTargetRecord[]
  try {
    records = await store.insertTargets(
      inputs.map((input, ordinal) => ({
        ...input,
        id: randomUUID(),
        journalId: intent.id,
        now,
        ordinal,
      })),
    )
  } catch (error) {
    throw new IdentityMutationExecutionError(
      "unavailable",
      "Identity mutation target manifest could not be persisted.",
      { cause: error },
    )
  }
  if (
    records.length !== inputs.length ||
    records.some(
      (record, ordinal) =>
        record.journalId !== intent.id ||
        record.ordinal !== ordinal ||
        record.state !== "unattempted",
    )
  ) {
    throw new IdentityMutationExecutionError(
      "unavailable",
      "Identity mutation target manifest could not be verified.",
    )
  }
  return new JournaledIdentityMutationTargets(store, records)
}

class JournaledIdentityMutationTargets implements IdentityMutationTargetsPhase {
  constructor(
    private readonly store: IdentityMutationJournalStore,
    private readonly records: IdentityMutationTargetRecord[],
  ) {}

  get count(): number {
    return this.records.length
  }

  async start(ordinal: number): Promise<void> {
    const current = this.targetAt(ordinal)
    const now = new Date()
    const transitioned = await this.transition(
      {
        expectedStates: ["unattempted"],
        id: current.id,
        nextState: "unknown",
        now,
        startedAt: now,
      },
      true,
    )
    this.records[ordinal] = transitioned
  }

  async recordResourceId(ordinal: number, resourceId: string): Promise<void> {
    if (!resourceId.trim() || resourceId.length > 255) {
      throw new IdentityMutationTargetPersistenceError(
        false,
        "Identity mutation target resource identifier is invalid.",
      )
    }
    const current = this.targetAt(ordinal)
    const transitioned = await this.transition(
      {
        expectedStates: ["unknown"],
        id: current.id,
        nextState: "unknown",
        now: new Date(),
        resourceId,
      },
      false,
    )
    this.records[ordinal] = transitioned
  }

  async applied(ordinal: number): Promise<void> {
    const current = this.targetAt(ordinal)
    if (current.targetType === "user" && !current.resourceId) {
      throw new IdentityMutationTargetPersistenceError(
        false,
        "Identity mutation target is missing its created resource identifier.",
      )
    }
    const now = new Date()
    const transitioned = await this.transition(
      {
        completedAt: now,
        expectedStates: ["unknown"],
        id: current.id,
        nextState: "applied",
        now,
      },
      false,
    )
    this.records[ordinal] = transitioned
  }

  async settleFailure(ordinal: number, error: unknown): Promise<void> {
    const current = this.targetAt(ordinal)
    if (
      current.state !== "unknown" ||
      current.resourceId !== null ||
      !hasConfirmedKeycloakRejection(error)
    ) {
      return
    }
    const now = new Date()
    const transitioned = await this.transition(
      {
        completedAt: now,
        expectedStates: ["unknown"],
        id: current.id,
        nextState: "failed",
        now,
      },
      false,
    )
    this.records[ordinal] = transitioned
  }

  assertAllApplied(): void {
    if (this.records.some((record) => record.state !== "applied")) {
      throw new IdentityMutationTargetPersistenceError(
        false,
        "Identity mutation returned with unresolved target outcomes.",
      )
    }
  }

  private targetAt(ordinal: number): IdentityMutationTargetRecord {
    const record = this.records[ordinal]
    if (!record || record.ordinal !== ordinal) {
      throw new IdentityMutationTargetPersistenceError(
        false,
        "Identity mutation target ordinal is invalid.",
      )
    }
    return record
  }

  private async transition(
    input: Parameters<IdentityMutationJournalStore["transitionTarget"]>[0],
    beforeWrite: boolean,
  ): Promise<IdentityMutationTargetRecord> {
    try {
      const transitioned = await this.store.transitionTarget(input)
      if (transitioned) {
        return transitioned
      }
    } catch (error) {
      throw new IdentityMutationTargetPersistenceError(
        beforeWrite,
        "Identity mutation target outcome could not be persisted.",
        { cause: error },
      )
    }
    throw new IdentityMutationTargetPersistenceError(
      beforeWrite,
      "Identity mutation target outcome could not be persisted.",
    )
  }
}

class JournaledKeycloakMutationPhase implements KeycloakMutationPhase {
  private intent: IdentityMutationJournalRecord
  private phase: "applied" | "failed" | "prepared" = "prepared"

  constructor(
    private readonly store: IdentityMutationJournalStore,
    intent: IdentityMutationJournalRecord,
    private readonly deadline: IdentityMutationDeadline,
  ) {
    this.intent = intent
  }

  async firstWrite<T>(
    write: () => Promise<T>,
    resourceId: string | ((result: T) => string | null),
  ): Promise<T> {
    if (this.phase !== "prepared") {
      return this.failClosedForUnhandledError(
        new Error("The first Keycloak write was invoked more than once."),
      )
    }

    if (this.deadline.expired) {
      return this.failClosedForUnhandledError(
        new IdentityMutationDeadlineError(),
      )
    }

    let result: T
    try {
      result = await write()
    } catch (error) {
      if (isConfirmedKeycloakRejection(error)) {
        this.intent = await recordIdentityMutationRejected(
          this.store,
          this.intent,
        )
        this.phase = "failed"
        throw error
      }
      return this.markUnknown(error)
    }
    const resolvedResourceId =
      typeof resourceId === "function" ? resourceId(result) : resourceId
    this.intent = await recordIdentityMutationKeycloakApplied(
      this.store,
      this.intent,
      { resourceId: resolvedResourceId },
    )
    this.phase = "applied"
    if (this.deadline.expired) {
      return this.markUnknown(new IdentityMutationDeadlineError())
    }
    return result
  }

  async writeAfterFirst<T>(write: () => Promise<T>): Promise<T> {
    if (this.phase !== "applied") {
      return this.failClosedForUnhandledError(
        new Error("A follow-on Keycloak write ran before the first write."),
      )
    }
    if (this.deadline.expired) {
      return this.markUnknown()
    }
    try {
      return await write()
    } catch (error) {
      return this.markUnknown(error)
    }
  }

  async readAfterWrite<T>(read: () => Promise<T>): Promise<T> {
    if (this.phase !== "applied") {
      return this.failClosedForUnhandledError(
        new Error("A Keycloak postcondition read ran before the first write."),
      )
    }
    if (this.deadline.expired) {
      return this.markUnknown()
    }
    try {
      return await read()
    } catch (error) {
      return this.markUnknown(error)
    }
  }

  hasConfirmedWrite(): boolean {
    return this.phase === "applied"
  }

  appliedIntent(): IdentityMutationJournalRecord {
    if (this.phase !== "applied") {
      throw new IdentityMutationExecutionError(
        "reconciliation_required",
        "Identity mutation has no confirmed applied state.",
      )
    }
    return this.intent
  }

  resourceId(): string | null {
    return this.intent.resourceId
  }

  async failClosedForUnhandledError(error: unknown): Promise<never> {
    if (error instanceof IdentityMutationDeadlineError) {
      if (this.phase === "applied") {
        return this.markUnknown()
      }
      if (this.phase === "prepared") {
        this.intent = await recordIdentityMutationRejected(
          this.store,
          this.intent,
        )
        this.phase = "failed"
        throw new IdentityMutationExecutionError("unavailable", error.message)
      }
    }
    if (
      error instanceof IdentityMutationTargetPersistenceError &&
      error.beforeWrite &&
      this.phase === "prepared"
    ) {
      this.intent = await recordIdentityMutationRejected(
        this.store,
        this.intent,
      )
      this.phase = "failed"
      throw new IdentityMutationExecutionError("unavailable", error.message, {
        cause: error,
      })
    }
    if (
      error instanceof IdentityMutationReconciliationRequiredError ||
      error instanceof IdentityMutationExecutionError ||
      this.phase === "failed"
    ) {
      throw error
    }
    return this.markUnknown(error)
  }

  private async markUnknown(cause?: unknown): Promise<never> {
    return recordIdentityMutationOutcomeUnknown(this.store, this.intent, {
      cause,
    })
  }
}

function isConfirmedKeycloakRejection(
  error: unknown,
): error is { mutationOutcome: "rejected" } {
  return (
    typeof error === "object" &&
    error !== null &&
    "mutationOutcome" in error &&
    error.mutationOutcome === "rejected"
  )
}

function hasConfirmedKeycloakRejection(error: unknown): boolean {
  if (isConfirmedKeycloakRejection(error)) {
    return true
  }
  return (
    typeof error === "object" &&
    error !== null &&
    "cause" in error &&
    error.cause !== error &&
    hasConfirmedKeycloakRejection(error.cause)
  )
}

function executionErrorFromReservation(
  reservation: Exclude<BeginIdentityMutationResult, { status: "reserved" }>,
): IdentityMutationExecutionError {
  if (reservation.status === "unavailable") {
    return new IdentityMutationExecutionError(
      "unavailable",
      "Identity mutation storage is unavailable.",
    )
  }
  return new IdentityMutationExecutionError(
    reservation.status,
    reservation.status === "conflict"
      ? "Identity mutation request conflicts with its durable intent."
      : reservation.status === "already_finalized"
        ? "Identity mutation already has a durable final state."
        : reservation.status === "blocked_by_active_reconciliation"
          ? "Another unresolved identity or Application mutation blocks all identity and Application writes until reconciliation."
          : "Identity mutation requires reconciliation before retrying.",
  )
}

export async function beginIdentityMutation(
  store: IdentityMutationJournalStore,
  input: IdentityMutationIntentInput,
  options: { now?: Date; randomId?: () => string } = {},
): Promise<BeginIdentityMutationResult> {
  const now = options.now ?? new Date()
  try {
    const inserted = await store.insertPrepared({
      ...input,
      id: (options.randomId ?? randomUUID)(),
      now,
    })
    if (inserted) {
      return { intent: inserted, status: "reserved" }
    }
    const existing = await store.findByIdempotencyLedgerId(
      input.idempotencyLedgerId,
    )
    if (existing) {
      if (existing.requestFingerprint !== input.requestFingerprint) {
        return { intent: existing, status: "conflict" }
      }
      if (existing.state === "completed" || existing.state === "failed") {
        return { intent: existing, status: "already_finalized" }
      }
      return { intent: existing, status: "reconciliation_required" }
    }
    const active = await store.findActive()
    return active
      ? { intent: active, status: "blocked_by_active_reconciliation" }
      : { status: "unavailable" }
  } catch {
    return { status: "unavailable" }
  }
}

export async function recordIdentityMutationKeycloakApplied(
  store: IdentityMutationJournalStore,
  intent: IdentityMutationJournalRecord,
  options: { now?: Date; resourceId?: string | null } = {},
): Promise<IdentityMutationJournalRecord> {
  const now = options.now ?? new Date()
  try {
    const transitioned = await store.transition({
      expectedStates: ["prepared"],
      id: intent.id,
      keycloakAppliedAt: now,
      nextState: "keycloak_applied",
      now,
      resourceId: options.resourceId ?? null,
    })
    if (transitioned) {
      return transitioned
    }
  } catch {
    // The prepared row remains a durable ambiguous outcome marker.
  }

  await markReconciliationBestEffort(
    store,
    intent.id,
    "keycloak_applied_persistence_failed",
    now,
    {
      keycloakAppliedAt: now,
      resourceId: options.resourceId ?? null,
    },
  )
  throw new IdentityMutationReconciliationRequiredError(
    intent.id,
    "The Keycloak mutation succeeded but its durable applied state could not be recorded. Reconcile the target before retrying.",
  )
}

export async function finalizeIdentityMutation<T>(
  store: IdentityMutationJournalStore,
  intent: IdentityMutationJournalRecord,
  finalize: () => Promise<T>,
  options: {
    assertCanContinue?: () => void
    now?: () => Date
    requiredAppliedTargetCount?: number
  } = {},
): Promise<T> {
  const now = options.now ?? (() => new Date())
  let result: T
  try {
    options.assertCanContinue?.()
    result = await finalize()
    options.assertCanContinue?.()
  } catch (error) {
    await markReconciliationBestEffort(
      store,
      intent.id,
      "finalization_failed",
      now(),
    )
    throw new IdentityMutationReconciliationRequiredError(
      intent.id,
      "The Keycloak mutation succeeded but audit or receipt finalization failed. Reconcile the target before retrying.",
      { cause: error },
    )
  }

  const completedAt = now()
  try {
    const transitioned = await store.transition({
      completedAt,
      expectedStates: ["keycloak_applied"],
      id: intent.id,
      nextState: "completed",
      now: completedAt,
      requiredAppliedTargetCount: options.requiredAppliedTargetCount,
    })
    if (transitioned) {
      return result
    }
  } catch {
    // The keycloak_applied row remains a durable no-retry marker.
  }

  await markReconciliationBestEffort(
    store,
    intent.id,
    "completion_persistence_failed",
    completedAt,
  )
  throw new IdentityMutationReconciliationRequiredError(
    intent.id,
    "The Keycloak mutation succeeded but journal completion failed. Reconcile the target before retrying.",
  )
}

export async function recordIdentityMutationRejected(
  store: IdentityMutationJournalStore,
  intent: IdentityMutationJournalRecord,
  options: { now?: Date } = {},
): Promise<IdentityMutationJournalRecord> {
  const now = options.now ?? new Date()
  try {
    const transitioned = await store.transition({
      completedAt: now,
      expectedStates: ["prepared"],
      id: intent.id,
      nextState: "failed",
      now,
    })
    if (transitioned) {
      return transitioned
    }
  } catch {
    // Fall through to the reconciliation marker.
  }
  await markReconciliationBestEffort(
    store,
    intent.id,
    "keycloak_outcome_unknown",
    now,
  )
  throw new IdentityMutationReconciliationRequiredError(
    intent.id,
    "The rejected Keycloak mutation could not be finalized durably. Reconcile the target before retrying.",
  )
}

export async function recordIdentityMutationOutcomeUnknown(
  store: IdentityMutationJournalStore,
  intent: IdentityMutationJournalRecord,
  options: { cause?: unknown; now?: Date } = {},
): Promise<never> {
  await markReconciliationBestEffort(
    store,
    intent.id,
    "keycloak_outcome_unknown",
    options.now ?? new Date(),
  )
  throw new IdentityMutationReconciliationRequiredError(
    intent.id,
    "The Keycloak mutation outcome is unknown. Reconcile the target before retrying.",
    { cause: options.cause },
  )
}

function recordFromDatabase(
  row: typeof identityMutationJournal.$inferSelect,
): IdentityMutationJournalRecord {
  if (
    !isIdentityMutationState(row.state) ||
    !isIdentityMutationTargetType(row.targetType) ||
    !isReconciliationReason(row.reconciliationReason)
  ) {
    throw new Error("Identity mutation journal returned an invalid row.")
  }
  return {
    completedAt: row.completedAt,
    createdAt: row.createdAt,
    id: row.id,
    idempotencyLedgerId: row.idempotencyLedgerId,
    keycloakAppliedAt: row.keycloakAppliedAt,
    keycloakSubjectId: row.keycloakSubjectId,
    operationCode: row.operationCode,
    reconciliationReason: row.reconciliationReason,
    reconciliationRequiredAt: row.reconciliationRequiredAt,
    requestFingerprint: row.requestFingerprint,
    resourceId: row.resourceId,
    state: row.state,
    targetIdentifier: row.targetIdentifier,
    targetType: row.targetType,
    updatedAt: row.updatedAt,
  }
}

function targetRecordFromDatabase(
  row: typeof identityMutationJournalTargets.$inferSelect,
): IdentityMutationTargetRecord {
  if (
    !isIdentityMutationChildTargetType(row.targetType) ||
    !isIdentityMutationTargetState(row.state) ||
    !isIdentityMutationTargetIntent(row.intent)
  ) {
    throw new Error("Identity mutation target journal returned an invalid row.")
  }
  return {
    completedAt: row.completedAt,
    createdAt: row.createdAt,
    id: row.id,
    intent: row.intent,
    journalId: row.journalId,
    ordinal: row.ordinal,
    resourceId: row.resourceId,
    startedAt: row.startedAt,
    state: row.state,
    targetIdentifier: row.targetIdentifier,
    targetType: row.targetType,
    updatedAt: row.updatedAt,
  }
}

function isIdentityMutationState(
  value: string,
): value is IdentityMutationState {
  return (
    value === "prepared" ||
    value === "keycloak_applied" ||
    value === "completed" ||
    value === "failed" ||
    value === "reconciliation_required"
  )
}

function isActiveIdentityMutationState(state: IdentityMutationState): boolean {
  return (
    state === "prepared" ||
    state === "keycloak_applied" ||
    state === "reconciliation_required"
  )
}

function isIdentityMutationChildTargetType(
  value: string,
): value is IdentityMutationChildTargetType {
  return value === "user" || value === "group_membership"
}

function isIdentityMutationTargetState(
  value: string,
): value is IdentityMutationTargetState {
  return (
    value === "unattempted" ||
    value === "unknown" ||
    value === "applied" ||
    value === "failed"
  )
}

function isIdentityMutationTargetIntent(
  value: unknown,
): value is IdentityMutationTargetIntent {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false
  }
  const intent = value as Record<string, unknown>
  if (intent.kind === "group_membership") {
    return (
      hasExactKeys(intent, ["groupId", "kind", "memberId"]) &&
      typeof intent.groupId === "string" &&
      typeof intent.memberId === "string"
    )
  }
  return (
    intent.kind === "csv_user" &&
    hasExactKeys(intent, [
      "displayName",
      "email",
      "enabled",
      "group",
      "kind",
      "line",
      "role",
      "sendInvite",
      "username",
    ]) &&
    typeof intent.displayName === "string" &&
    typeof intent.email === "string" &&
    typeof intent.enabled === "boolean" &&
    typeof intent.group === "string" &&
    Number.isInteger(intent.line) &&
    (intent.role === "admin" || intent.role === "operator") &&
    typeof intent.sendInvite === "boolean" &&
    typeof intent.username === "string"
  )
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: string[],
): boolean {
  const keys = Object.keys(value).sort()
  return (
    keys.length === expected.length &&
    expected.every((key, index) => keys[index] === key)
  )
}

function isIdentityMutationTargetType(
  value: string,
): value is IdentityMutationTargetType {
  return value === "group" || value === "oauth_client" || value === "user"
}

function isReconciliationReason(
  value: string | null,
): value is IdentityMutationReconciliationReason | null {
  return (
    value === null ||
    value === "keycloak_outcome_unknown" ||
    value === "keycloak_applied_persistence_failed" ||
    value === "finalization_failed" ||
    value === "completion_persistence_failed"
  )
}

let fixtureJournalStore: FixtureIdentityMutationJournalStore | null = null

function executionRuntimeFromEnvironment(): IdentityMutationExecutionRuntime | null {
  const database = getInferenceCoreDb()
  if (database) {
    const store = createDrizzleIdentityMutationJournalStore(database)
    return store
      ? {
          store,
        }
      : null
  }
  if (!canUseBffFixtureData()) {
    return null
  }
  fixtureJournalStore ??= new FixtureIdentityMutationJournalStore()
  return {
    store: fixtureJournalStore,
  }
}

export async function hasUnresolvedOAuthClientMutation(
  runtime: IdentityMutationExecutionRuntime | null = executionRuntimeFromEnvironment(),
): Promise<boolean | "unavailable"> {
  if (!runtime) {
    return "unavailable"
  }
  try {
    const active = await runtime.store.findActive()
    return active?.targetType === "oauth_client"
  } catch {
    return "unavailable"
  }
}

async function enqueueIdentityMutation<T>(
  operation: () => Promise<T>,
  acquireTimeoutMs: number,
): Promise<T> {
  const release = await identityMutationQueue.acquire(acquireTimeoutMs)
  try {
    return await operation()
  } finally {
    release()
  }
}

class IdentityMutationQueue {
  private active = false
  private readonly waiters: Array<{
    reject(error: Error): void
    resolve(release: () => void): void
    timer: ReturnType<typeof setTimeout>
  }> = []

  async acquire(timeoutMs: number): Promise<() => void> {
    if (!this.active) {
      this.active = true
      return () => this.release()
    }
    return new Promise<() => void>((resolve, reject) => {
      const waiter = {
        reject,
        resolve,
        timer: setTimeout(() => {
          const index = this.waiters.indexOf(waiter)
          if (index >= 0) {
            this.waiters.splice(index, 1)
          }
          reject(
            new IdentityMutationExecutionError(
              "unavailable",
              "Identity mutation queue acquisition timed out.",
            ),
          )
        }, timeoutMs),
      }
      this.waiters.push(waiter)
    })
  }

  reset(): void {
    for (const waiter of this.waiters.splice(0)) {
      clearTimeout(waiter.timer)
      waiter.reject(
        new IdentityMutationExecutionError(
          "unavailable",
          "Identity mutation queue was reset.",
        ),
      )
    }
    this.active = false
  }

  private release(): void {
    const waiter = this.waiters.shift()
    if (!waiter) {
      this.active = false
      return
    }
    clearTimeout(waiter.timer)
    waiter.resolve(() => this.release())
  }
}

const identityMutationQueue = new IdentityMutationQueue()

class IdentityMutationDeadline {
  private readonly controller = new AbortController()
  private readonly timer: ReturnType<typeof setTimeout>

  constructor(durationMs: number) {
    this.timer = setTimeout(() => {
      this.controller.abort(new IdentityMutationDeadlineError())
    }, durationMs)
  }

  get expired(): boolean {
    return this.controller.signal.aborted
  }

  get signal(): AbortSignal {
    return this.controller.signal
  }

  assertActive(): void {
    if (this.expired) {
      throw new IdentityMutationDeadlineError()
    }
  }

  dispose(): void {
    clearTimeout(this.timer)
  }
}

function positiveDuration(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : fallback
}

class FixtureIdentityMutationJournalStore
  implements IdentityMutationJournalStore
{
  private readonly records = new Map<string, IdentityMutationJournalRecord>()
  private readonly targetRecords = new Map<
    string,
    IdentityMutationTargetRecord
  >()

  async insertPrepared(
    input: IdentityMutationIntentInput & { id: string; now: Date },
  ): Promise<IdentityMutationJournalRecord | null> {
    if (
      this.records.has(input.idempotencyLedgerId) ||
      (await this.findActive())
    ) {
      return null
    }
    const record: IdentityMutationJournalRecord = {
      ...input,
      completedAt: null,
      createdAt: input.now,
      keycloakAppliedAt: null,
      reconciliationReason: null,
      reconciliationRequiredAt: null,
      resourceId: null,
      state: "prepared",
      updatedAt: input.now,
    }
    this.records.set(input.idempotencyLedgerId, record)
    return record
  }

  async findByIdempotencyLedgerId(
    idempotencyLedgerId: string,
  ): Promise<IdentityMutationJournalRecord | null> {
    return this.records.get(idempotencyLedgerId) ?? null
  }

  async findActive(): Promise<IdentityMutationJournalRecord | null> {
    return (
      [...this.records.values()].find((record) =>
        isActiveIdentityMutationState(record.state),
      ) ?? null
    )
  }

  async insertTargets(
    inputs: Parameters<IdentityMutationJournalStore["insertTargets"]>[0],
  ): Promise<IdentityMutationTargetRecord[]> {
    const records = inputs.map((input) => targetRecordFromInput(input))
    const identifiers = new Set<string>()
    const ordinals = new Set<number>()
    for (const record of records) {
      if (
        ![...this.records.values()].some(
          (parent) => parent.id === record.journalId,
        ) ||
        this.targetRecords.has(record.id) ||
        identifiers.has(record.targetIdentifier) ||
        ordinals.has(record.ordinal)
      ) {
        throw new Error("fixture target manifest conflict")
      }
      identifiers.add(record.targetIdentifier)
      ordinals.add(record.ordinal)
    }
    for (const record of records) {
      this.targetRecords.set(record.id, record)
    }
    return records
  }

  async transitionTarget(
    input: Parameters<IdentityMutationJournalStore["transitionTarget"]>[0],
  ): Promise<IdentityMutationTargetRecord | null> {
    const current = this.targetRecords.get(input.id)
    if (!current || !input.expectedStates.includes(current.state)) {
      return null
    }
    const updated = applyTargetTransition(current, input)
    this.targetRecords.set(input.id, updated)
    return updated
  }

  async transition(
    input: Parameters<IdentityMutationJournalStore["transition"]>[0],
  ): Promise<IdentityMutationJournalRecord | null> {
    const entry = [...this.records.entries()].find(
      ([, record]) =>
        record.id === input.id && input.expectedStates.includes(record.state),
    )
    if (!entry) {
      return null
    }
    const [ledgerId, current] = entry
    if (
      input.requiredAppliedTargetCount !== undefined &&
      !hasExactlyAppliedTargets(
        [...this.targetRecords.values()],
        input.id,
        input.requiredAppliedTargetCount,
      )
    ) {
      return null
    }
    const updated: IdentityMutationJournalRecord = {
      ...current,
      state: input.nextState,
      updatedAt: input.now,
    }
    applyTransitionValues(updated, input)
    this.records.set(ledgerId, updated)
    return updated
  }

  clear(): void {
    this.records.clear()
    this.targetRecords.clear()
  }
}

function targetRecordFromInput(
  input: Parameters<IdentityMutationJournalStore["insertTargets"]>[0][number],
): IdentityMutationTargetRecord {
  return {
    completedAt: null,
    createdAt: input.now,
    id: input.id,
    intent: input.intent,
    journalId: input.journalId,
    ordinal: input.ordinal,
    resourceId: null,
    startedAt: null,
    state: "unattempted",
    targetIdentifier: input.targetIdentifier,
    targetType: input.targetType,
    updatedAt: input.now,
  }
}

function applyTargetTransition(
  current: IdentityMutationTargetRecord,
  input: Parameters<IdentityMutationJournalStore["transitionTarget"]>[0],
): IdentityMutationTargetRecord {
  const updated = {
    ...current,
    state: input.nextState,
    updatedAt: input.now,
  }
  if (Object.hasOwn(input, "completedAt")) {
    updated.completedAt = input.completedAt ?? null
  }
  if (Object.hasOwn(input, "resourceId")) {
    updated.resourceId = input.resourceId ?? null
  }
  if (Object.hasOwn(input, "startedAt")) {
    updated.startedAt = input.startedAt ?? null
  }
  return updated
}

function hasExactlyAppliedTargets(
  records: IdentityMutationTargetRecord[],
  journalId: string,
  requiredCount: number,
): boolean {
  const targets = records.filter((record) => record.journalId === journalId)
  return (
    targets.length === requiredCount &&
    targets.every((record) => record.state === "applied")
  )
}

function applyTransitionValues(
  target: IdentityMutationJournalRecord,
  input: Parameters<IdentityMutationJournalStore["transition"]>[0],
): void {
  if (Object.hasOwn(input, "completedAt")) {
    target.completedAt = input.completedAt ?? null
  }
  if (Object.hasOwn(input, "keycloakAppliedAt")) {
    target.keycloakAppliedAt = input.keycloakAppliedAt ?? null
  }
  if (Object.hasOwn(input, "reconciliationReason")) {
    target.reconciliationReason = input.reconciliationReason ?? null
  }
  if (Object.hasOwn(input, "reconciliationRequiredAt")) {
    target.reconciliationRequiredAt = input.reconciliationRequiredAt ?? null
  }
  if (Object.hasOwn(input, "resourceId")) {
    target.resourceId = input.resourceId ?? null
  }
}

export function resetIdentityMutationJournalForTest(): void {
  fixtureJournalStore?.clear()
  identityMutationQueue.reset()
}

async function markReconciliationBestEffort(
  store: IdentityMutationJournalStore,
  id: string,
  reason: IdentityMutationReconciliationReason,
  now: Date,
  applied: { keycloakAppliedAt: Date; resourceId: string | null } | null = null,
): Promise<void> {
  try {
    await store.transition({
      expectedStates: ["prepared", "keycloak_applied"],
      id,
      ...(applied
        ? {
            keycloakAppliedAt: applied.keycloakAppliedAt,
            resourceId: applied.resourceId,
          }
        : {}),
      nextState: "reconciliation_required",
      now,
      reconciliationReason: reason,
      reconciliationRequiredAt: now,
    })
  } catch {
    // prepared and keycloak_applied are both fail-closed on the next reserve.
  }
}
