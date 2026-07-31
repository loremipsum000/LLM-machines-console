import { sql } from "drizzle-orm"
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"

export const common = pgSchema("common")
export const admin = pgSchema("admin")

export const humanIdentities = common.table(
  "human_identities",
  {
    subjectId: text("subject_id").primaryKey(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "human_identities_subject_id_check",
      sql`char_length(${table.subjectId}) BETWEEN 1 AND 255`,
    ),
  ],
)

export const humanIdentityRoles = common.table(
  "human_identity_roles",
  {
    subjectId: text("subject_id")
      .notNull()
      .references(() => humanIdentities.subjectId, { onDelete: "cascade" }),
    role: text("role").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.subjectId, table.role],
      name: "human_identity_roles_pkey",
    }),
    check(
      "human_identity_roles_role_check",
      sql`${table.role} IN ('admin', 'operator')`,
    ),
  ],
)

export const auditEvents = common.table(
  "audit_events",
  {
    id: uuid("id").primaryKey(),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    action: text("action").notNull(),
    outcome: text("outcome").notNull(),
    sourceSystem: text("source_system").notNull(),
    correlationId: text("correlation_id").notNull(),
    keycloakSubjectId: text("keycloak_subject_id"),
    applicationId: text("application_id"),
    credentialRecordId: text("credential_record_id"),
    credentialPrefix: text("credential_prefix"),
    recoveryReasonCode: text("recovery_reason_code"),
  },
  (table) => [
    check(
      "audit_events_action_check",
      sql`char_length(${table.action}) BETWEEN 1 AND 128`,
    ),
    check(
      "audit_events_outcome_check",
      sql`${table.outcome} IN ('succeeded', 'failed', 'denied')`,
    ),
    check(
      "audit_events_source_system_check",
      sql`${table.sourceSystem} IN ('console', 'keycloak', 'litellm', 'grafana', 'alertmanager', 'firecrawl', 'lifecycle')`,
    ),
    check(
      "audit_events_correlation_id_check",
      sql`char_length(${table.correlationId}) BETWEEN 1 AND 128`,
    ),
    check(
      "audit_events_subject_id_check",
      sql`${table.keycloakSubjectId} IS NULL OR char_length(${table.keycloakSubjectId}) BETWEEN 1 AND 255`,
    ),
    check(
      "audit_events_application_id_check",
      sql`${table.applicationId} IS NULL OR char_length(${table.applicationId}) BETWEEN 1 AND 128`,
    ),
    check(
      "audit_events_credential_record_id_check",
      sql`${table.credentialRecordId} IS NULL OR char_length(${table.credentialRecordId}) BETWEEN 1 AND 128`,
    ),
    check(
      "audit_events_credential_prefix_check",
      sql`${table.credentialPrefix} IS NULL OR char_length(${table.credentialPrefix}) BETWEEN 1 AND 32`,
    ),
    check(
      "audit_events_credential_identifier_check",
      sql`num_nonnulls(${table.credentialRecordId}, ${table.credentialPrefix}) <= 1`,
    ),
    check(
      "audit_events_recovery_reason_code_check",
      sql`${table.recoveryReasonCode} IS NULL OR char_length(${table.recoveryReasonCode}) BETWEEN 1 AND 64`,
    ),
    index("audit_events_occurred_at_idx").on(table.occurredAt),
    index("audit_events_correlation_id_idx").on(table.correlationId),
    index("audit_events_application_occurred_idx").on(
      table.applicationId,
      table.occurredAt,
    ),
  ],
)

export const applications = admin.table(
  "applications",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description").default("").notNull(),
    authMode: text("auth_mode").notNull(),
    status: text("status").default("enabled").notNull(),
    connectionStatus: text("connection_status")
      .default("not_connected")
      .notNull(),
    lastConnectedAt: timestamp("last_connected_at", { withTimezone: true }),
    createdBy: text("created_by")
      .notNull()
      .references(() => humanIdentities.subjectId, { onDelete: "restrict" }),
    updatedBy: text("updated_by")
      .notNull()
      .references(() => humanIdentities.subjectId, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "applications_id_check",
      sql`char_length(${table.id}) BETWEEN 1 AND 128`,
    ),
    check(
      "applications_name_check",
      sql`char_length(${table.name}) BETWEEN 1 AND 160`,
    ),
    check(
      "applications_auth_mode_check",
      sql`${table.authMode} IN ('api_key', 'oauth_client_credentials')`,
    ),
    check(
      "applications_status_check",
      sql`${table.status} IN ('enabled', 'disabled', 'deleted')`,
    ),
    check(
      "applications_connection_status_check",
      sql`${table.connectionStatus} IN ('not_connected', 'connected', 'degraded')`,
    ),
    uniqueIndex("applications_id_auth_mode_idx").on(table.id, table.authMode),
    index("applications_status_updated_idx").on(table.status, table.updatedAt),
  ],
)

export const applicationCredentials = admin.table(
  "application_credentials",
  {
    id: text("id").primaryKey(),
    appId: text("app_id").notNull(),
    kind: text("kind").notNull(),
    clientIdentifier: text("client_identifier"),
    externalCredentialId: text("external_credential_id"),
    keyPrefix: text("key_prefix"),
    verifierHash: text("verifier_hash"),
    status: text("status").default("active").notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    rotatedAt: timestamp("rotated_at", { withTimezone: true }),
    overlapExpiresAt: timestamp("overlap_expires_at", {
      withTimezone: true,
    }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    foreignKey({
      columns: [table.appId, table.kind],
      foreignColumns: [applications.id, applications.authMode],
      name: "application_credentials_app_auth_mode_fk",
    }).onDelete("restrict"),
    check(
      "application_credentials_id_check",
      sql`char_length(${table.id}) BETWEEN 1 AND 128`,
    ),
    check(
      "application_credentials_kind_check",
      sql`${table.kind} IN ('api_key', 'oauth_client_credentials')`,
    ),
    check(
      "application_credentials_status_check",
      sql`${table.status} IN ('active', 'retiring', 'revoked')`,
    ),
    check(
      "application_credentials_material_check",
      sql`(
        ${table.kind} = 'api_key'
        AND ${table.clientIdentifier} IS NULL
        AND ${table.externalCredentialId} IS NULL
        AND ${table.keyPrefix} IS NOT NULL
        AND char_length(${table.keyPrefix}) BETWEEN 1 AND 32
        AND ${table.verifierHash} IS NOT NULL
        AND char_length(${table.verifierHash}) = 64
      ) OR (
        ${table.kind} = 'oauth_client_credentials'
        AND ${table.clientIdentifier} IS NOT NULL
        AND char_length(${table.clientIdentifier}) BETWEEN 1 AND 255
        AND ${table.externalCredentialId} IS NOT NULL
        AND char_length(${table.externalCredentialId}) BETWEEN 1 AND 255
        AND ${table.keyPrefix} IS NULL
        AND ${table.verifierHash} IS NULL
      )`,
    ),
    check(
      "application_credentials_kind_lifecycle_check",
      sql`${table.kind} = 'api_key'
        OR (
          ${table.status} <> 'retiring'
          AND ${table.overlapExpiresAt} IS NULL
        )`,
    ),
    check(
      "application_credentials_lifecycle_check",
      sql`(
        ${table.kind} = 'api_key'
        AND (
          (
            ${table.status} = 'active'
            AND ${table.rotatedAt} IS NULL
            AND ${table.overlapExpiresAt} IS NULL
            AND ${table.revokedAt} IS NULL
          ) OR (
            ${table.status} = 'retiring'
            AND ${table.rotatedAt} IS NOT NULL
            AND ${table.overlapExpiresAt} IS NOT NULL
            AND ${table.revokedAt} IS NULL
          ) OR (
            ${table.status} = 'revoked'
            AND ${table.revokedAt} IS NOT NULL
            AND (
              (
                ${table.rotatedAt} IS NULL
                AND ${table.overlapExpiresAt} IS NULL
              ) OR (
                ${table.rotatedAt} IS NOT NULL
                AND ${table.overlapExpiresAt} IS NOT NULL
              )
            )
          )
        )
      ) OR (
        ${table.kind} = 'oauth_client_credentials'
        AND ${table.overlapExpiresAt} IS NULL
        AND (
          (
            ${table.status} = 'active'
            AND ${table.revokedAt} IS NULL
          ) OR (
            ${table.status} = 'revoked'
            AND ${table.revokedAt} IS NOT NULL
          )
        )
      )`,
    ),
    check(
      "application_credentials_timestamps_check",
      sql`(${table.lastUsedAt} IS NULL OR ${table.lastUsedAt} >= ${table.issuedAt})
        AND (${table.rotatedAt} IS NULL OR ${table.rotatedAt} >= ${table.issuedAt})
        AND (
          ${table.overlapExpiresAt} IS NULL
          OR (
            ${table.rotatedAt} IS NOT NULL
            AND ${table.overlapExpiresAt} = ${table.rotatedAt} + interval '86400 seconds'
          )
        )
        AND (
          ${table.revokedAt} IS NULL
          OR (
            ${table.revokedAt} >= ${table.issuedAt}
            AND (
              ${table.rotatedAt} IS NULL
              OR ${table.revokedAt} >= ${table.rotatedAt}
            )
          )
        )`,
    ),
    uniqueIndex("application_credentials_id_app_idx").on(table.id, table.appId),
    uniqueIndex("application_credentials_verifier_hash_idx")
      .on(table.verifierHash)
      .where(sql`${table.verifierHash} IS NOT NULL`),
    uniqueIndex("application_credentials_client_identifier_idx")
      .on(table.clientIdentifier)
      .where(sql`${table.clientIdentifier} IS NOT NULL`),
    uniqueIndex("application_credentials_external_id_idx")
      .on(table.externalCredentialId)
      .where(sql`${table.externalCredentialId} IS NOT NULL`),
    uniqueIndex("application_credentials_one_active_idx")
      .on(table.appId)
      .where(sql`${table.status} = 'active'`),
    uniqueIndex("application_credentials_one_retiring_idx")
      .on(table.appId)
      .where(sql`${table.kind} = 'api_key' AND ${table.status} = 'retiring'`),
    index("application_credentials_prefix_status_idx").on(
      table.keyPrefix,
      table.status,
    ),
    index("application_credentials_app_status_idx").on(
      table.appId,
      table.status,
    ),
  ],
)

export const applicationModelAllowlists = admin.table(
  "application_model_allowlists",
  {
    appId: text("app_id")
      .notNull()
      .references(() => applications.id, { onDelete: "restrict" }),
    modelAlias: text("model_alias").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.appId, table.modelAlias],
      name: "application_model_allowlists_pkey",
    }),
    check(
      "application_model_allowlists_alias_check",
      sql`char_length(${table.modelAlias}) BETWEEN 1 AND 160`,
    ),
  ],
)

export const applicationLimits = admin.table(
  "application_limits",
  {
    appId: text("app_id")
      .primaryKey()
      .references(() => applications.id, { onDelete: "restrict" }),
    requestsPerSecond: integer("requests_per_second"),
    tokenAlertThreshold7d: bigint("token_alert_threshold_7d", {
      mode: "number",
    }),
    maxConcurrentRequests: integer("max_concurrent_requests"),
    maxContextBytes: bigint("max_context_bytes", { mode: "number" }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "application_limits_requests_check",
      sql`${table.requestsPerSecond} IS NULL
        OR ${table.requestsPerSecond} BETWEEN 1 AND 10000`,
    ),
    check(
      "application_limits_token_alert_check",
      sql`${table.tokenAlertThreshold7d} IS NULL
        OR ${table.tokenAlertThreshold7d} BETWEEN 1 AND 100000000`,
    ),
    check(
      "application_limits_concurrency_check",
      sql`${table.maxConcurrentRequests} IS NULL
        OR ${table.maxConcurrentRequests} BETWEEN 1 AND 10000`,
    ),
    check(
      "application_limits_context_bytes_check",
      sql`${table.maxContextBytes} IS NULL
        OR ${table.maxContextBytes} BETWEEN 1 AND 9007199254740991`,
    ),
  ],
)

export const applicationRateLimitWindows = admin.table(
  "application_rate_limit_windows",
  {
    appId: text("app_id")
      .notNull()
      .references(() => applications.id, { onDelete: "restrict" }),
    windowStartedAt: timestamp("window_started_at", {
      withTimezone: true,
    }).notNull(),
    requestCount: integer("request_count").default(0).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.appId, table.windowStartedAt],
      name: "application_rate_limit_windows_pkey",
    }),
    check(
      "application_rate_limit_windows_count_check",
      sql`${table.requestCount} >= 0`,
    ),
    check(
      "application_rate_limit_windows_expiry_check",
      sql`${table.expiresAt} > ${table.windowStartedAt}`,
    ),
    index("application_rate_limit_windows_expiry_idx").on(table.expiresAt),
  ],
)

export const applicationRequestLedger = admin.table(
  "application_request_ledger",
  {
    id: uuid("id").primaryKey(),
    appId: text("app_id").notNull(),
    credentialId: text("credential_id").notNull(),
    routeKind: text("route_kind").notNull(),
    modelAlias: text("model_alias"),
    contextBytes: bigint("context_bytes", { mode: "number" })
      .default(0)
      .notNull(),
    state: text("state").default("active").notNull(),
    statusCode: integer("status_code"),
    inputTokens: bigint("input_tokens", { mode: "number" })
      .default(0)
      .notNull(),
    outputTokens: bigint("output_tokens", { mode: "number" })
      .default(0)
      .notNull(),
    totalTokens: bigint("total_tokens", { mode: "number" })
      .default(0)
      .notNull(),
    latencyMs: integer("latency_ms"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    leaseExpiresAt: timestamp("lease_expires_at", {
      withTimezone: true,
    }).notNull(),
    settledAt: timestamp("settled_at", { withTimezone: true }),
  },
  (table) => [
    foreignKey({
      columns: [table.credentialId, table.appId],
      foreignColumns: [applicationCredentials.id, applicationCredentials.appId],
      name: "application_request_ledger_credential_app_fk",
    }).onDelete("restrict"),
    check(
      "application_request_ledger_route_check",
      sql`${table.routeKind} IN ('models', 'chat_completions')`,
    ),
    check(
      "application_request_ledger_model_check",
      sql`(
        ${table.routeKind} = 'models'
        AND ${table.modelAlias} IS NULL
      ) OR (
        ${table.routeKind} = 'chat_completions'
        AND (
          char_length(${table.modelAlias}) BETWEEN 1 AND 160
          OR (
            ${table.state} = 'settled'
            AND ${table.modelAlias} IS NULL
            AND ${table.statusCode} >= 400
          )
        )
      )`,
    ),
    check(
      "application_request_ledger_context_bytes_check",
      sql`${table.contextBytes} >= 0`,
    ),
    check(
      "application_request_ledger_state_check",
      sql`${table.state} IN ('active', 'settled')`,
    ),
    check(
      "application_request_ledger_status_code_check",
      sql`${table.statusCode} IS NULL OR ${table.statusCode} BETWEEN 100 AND 599`,
    ),
    check(
      "application_request_ledger_tokens_check",
      sql`${table.inputTokens} >= 0
        AND ${table.outputTokens} >= 0
        AND ${table.totalTokens} >= ${table.inputTokens} + ${table.outputTokens}`,
    ),
    check(
      "application_request_ledger_latency_check",
      sql`${table.latencyMs} IS NULL OR ${table.latencyMs} >= 0`,
    ),
    check(
      "application_request_ledger_lifecycle_check",
      sql`(
        ${table.state} = 'active'
        AND ${table.statusCode} IS NULL
        AND ${table.inputTokens} = 0
        AND ${table.outputTokens} = 0
        AND ${table.totalTokens} = 0
        AND ${table.latencyMs} IS NULL
        AND ${table.settledAt} IS NULL
      ) OR (
        ${table.state} = 'settled'
        AND ${table.statusCode} IS NOT NULL
        AND ${table.latencyMs} IS NOT NULL
        AND ${table.settledAt} IS NOT NULL
      )`,
    ),
    check(
      "application_request_ledger_timestamps_check",
      sql`${table.leaseExpiresAt} > ${table.startedAt}
        AND (${table.settledAt} IS NULL OR ${table.settledAt} >= ${table.startedAt})`,
    ),
    index("application_request_ledger_active_idx")
      .on(table.appId, table.leaseExpiresAt)
      .where(sql`${table.state} = 'active'`),
    index("application_request_ledger_settled_started_idx")
      .on(table.startedAt)
      .where(sql`${table.state} = 'settled'`),
  ],
)

export const applicationUsageDaily = admin.table(
  "application_usage_daily",
  {
    appId: text("app_id")
      .notNull()
      .references(() => applications.id, { onDelete: "restrict" }),
    credentialId: text("credential_id").notNull(),
    bucketDate: date("bucket_date").notNull(),
    routeKind: text("route_kind").notNull(),
    modelAlias: text("model_alias").default("").notNull(),
    requestCount: integer("request_count").default(0).notNull(),
    failureCount: integer("failure_count").default(0).notNull(),
    inputTokens: bigint("input_tokens", { mode: "number" })
      .default(0)
      .notNull(),
    outputTokens: bigint("output_tokens", { mode: "number" })
      .default(0)
      .notNull(),
    totalTokens: bigint("total_tokens", { mode: "number" })
      .default(0)
      .notNull(),
    latencyMsSum: bigint("latency_ms_sum", { mode: "number" })
      .default(0)
      .notNull(),
    latencyMsMax: integer("latency_ms_max").default(0).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.credentialId, table.appId],
      foreignColumns: [applicationCredentials.id, applicationCredentials.appId],
      name: "application_usage_daily_credential_app_fk",
    }).onDelete("restrict"),
    primaryKey({
      columns: [
        table.appId,
        table.credentialId,
        table.bucketDate,
        table.routeKind,
        table.modelAlias,
      ],
      name: "application_usage_daily_pkey",
    }),
    check(
      "application_usage_daily_route_check",
      sql`${table.routeKind} IN ('models', 'chat_completions')`,
    ),
    check(
      "application_usage_daily_model_check",
      sql`(
        ${table.routeKind} = 'models'
        AND ${table.modelAlias} = ''
      ) OR (
        ${table.routeKind} = 'chat_completions'
        AND (
          char_length(${table.modelAlias}) BETWEEN 1 AND 160
          OR (
            ${table.modelAlias} = ''
            AND ${table.failureCount} = ${table.requestCount}
          )
        )
      )`,
    ),
    check(
      "application_usage_daily_counts_check",
      sql`${table.requestCount} >= 0
        AND ${table.failureCount} >= 0
        AND ${table.failureCount} <= ${table.requestCount}`,
    ),
    check(
      "application_usage_daily_tokens_check",
      sql`${table.inputTokens} >= 0
        AND ${table.outputTokens} >= 0
        AND ${table.totalTokens} >= ${table.inputTokens} + ${table.outputTokens}`,
    ),
    check(
      "application_usage_daily_latency_check",
      sql`${table.latencyMsSum} >= 0
        AND ${table.latencyMsMax} >= 0
        AND ${table.latencyMsMax} <= ${table.latencyMsSum}`,
    ),
    index("application_usage_daily_bucket_idx").on(table.bucketDate),
    index("application_usage_daily_app_bucket_idx").on(
      table.appId,
      table.bucketDate,
    ),
  ],
)

export const idempotencyLedger = admin.table(
  "idempotency_ledger",
  {
    id: uuid("id").primaryKey(),
    keycloakSubjectId: text("keycloak_subject_id").notNull(),
    operationCode: text("operation_code").notNull(),
    idempotencyKeyDigest: text("idempotency_key_digest").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    state: text("state").default("pending").notNull(),
    outcome: text("outcome"),
    resourceId: text("resource_id"),
    correlationId: text("correlation_id").notNull(),
    statusCode: integer("status_code"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("idempotency_ledger_identity_key_idx").on(
      table.keycloakSubjectId,
      table.operationCode,
      table.idempotencyKeyDigest,
    ),
    check(
      "idempotency_ledger_subject_id_check",
      sql`char_length(${table.keycloakSubjectId}) BETWEEN 1 AND 255`,
    ),
    check(
      "idempotency_ledger_operation_check",
      sql`char_length(${table.operationCode}) BETWEEN 1 AND 128`,
    ),
    check(
      "idempotency_ledger_key_check",
      sql`char_length(${table.idempotencyKeyDigest}) = 64`,
    ),
    check(
      "idempotency_ledger_fingerprint_check",
      sql`char_length(${table.requestFingerprint}) = 64`,
    ),
    check(
      "idempotency_ledger_correlation_id_check",
      sql`char_length(${table.correlationId}) BETWEEN 1 AND 128`,
    ),
    check(
      "idempotency_ledger_resource_id_check",
      sql`${table.resourceId} IS NULL OR char_length(${table.resourceId}) BETWEEN 1 AND 128`,
    ),
    check(
      "idempotency_ledger_state_check",
      sql`${table.state} IN ('pending', 'completed', 'failed')`,
    ),
    check(
      "idempotency_ledger_outcome_check",
      sql`${table.outcome} IS NULL OR ${table.outcome} IN ('succeeded', 'failed', 'denied')`,
    ),
    check(
      "idempotency_ledger_status_code_check",
      sql`${table.statusCode} IS NULL OR ${table.statusCode} BETWEEN 100 AND 599`,
    ),
    check(
      "idempotency_ledger_receipt_state_check",
      sql`(
        ${table.state} = 'pending'
        AND ${table.outcome} IS NULL
        AND ${table.resourceId} IS NULL
        AND ${table.statusCode} IS NULL
      ) OR (
        ${table.state} = 'completed'
        AND ${table.outcome} = 'succeeded'
        AND ${table.statusCode} BETWEEN 200 AND 399
      ) OR (
        ${table.state} = 'failed'
        AND ${table.outcome} IN ('failed', 'denied')
        AND ${table.statusCode} IS NOT NULL
      )`,
    ),
    check(
      "idempotency_ledger_expiry_check",
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
    index("idempotency_ledger_expiry_idx").on(table.expiresAt),
  ],
)

export const identityMutationJournal = admin.table(
  "identity_mutation_journal",
  {
    id: uuid("id").primaryKey(),
    idempotencyLedgerId: uuid("idempotency_ledger_id")
      .notNull()
      .unique()
      .references(() => idempotencyLedger.id, { onDelete: "cascade" }),
    keycloakSubjectId: text("keycloak_subject_id").notNull(),
    operationCode: text("operation_code").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    targetType: text("target_type").notNull(),
    targetIdentifier: text("target_identifier").notNull(),
    state: text("state").default("prepared").notNull(),
    resourceId: text("resource_id"),
    reconciliationReason: text("reconciliation_reason"),
    keycloakAppliedAt: timestamp("keycloak_applied_at", {
      withTimezone: true,
    }),
    reconciliationRequiredAt: timestamp("reconciliation_required_at", {
      withTimezone: true,
    }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "identity_mutation_journal_subject_check",
      sql`char_length(${table.keycloakSubjectId}) BETWEEN 1 AND 255`,
    ),
    check(
      "identity_mutation_journal_operation_check",
      sql`char_length(${table.operationCode}) BETWEEN 1 AND 128`,
    ),
    check(
      "identity_mutation_journal_fingerprint_check",
      sql`char_length(${table.requestFingerprint}) = 64`,
    ),
    check(
      "identity_mutation_journal_target_type_check",
      sql`${table.targetType} IN ('user', 'group', 'oauth_client')`,
    ),
    check(
      "identity_mutation_journal_target_identifier_check",
      sql`char_length(${table.targetIdentifier}) BETWEEN 1 AND 255`,
    ),
    check(
      "identity_mutation_journal_state_check",
      sql`${table.state} IN ('prepared', 'keycloak_applied', 'completed', 'failed', 'reconciliation_required')`,
    ),
    check(
      "identity_mutation_journal_resource_id_check",
      sql`${table.resourceId} IS NULL OR char_length(${table.resourceId}) BETWEEN 1 AND 255`,
    ),
    check(
      "identity_mutation_journal_reconciliation_reason_check",
      sql`${table.reconciliationReason} IS NULL
        OR ${table.reconciliationReason} IN (
          'keycloak_outcome_unknown',
          'keycloak_applied_persistence_failed',
          'finalization_failed',
          'completion_persistence_failed'
        )`,
    ),
    check(
      "identity_mutation_journal_lifecycle_check",
      sql`(
        ${table.state} = 'prepared'
        AND ${table.keycloakAppliedAt} IS NULL
        AND ${table.reconciliationRequiredAt} IS NULL
        AND ${table.completedAt} IS NULL
        AND ${table.resourceId} IS NULL
        AND ${table.reconciliationReason} IS NULL
      ) OR (
        ${table.state} = 'keycloak_applied'
        AND ${table.keycloakAppliedAt} IS NOT NULL
        AND ${table.reconciliationRequiredAt} IS NULL
        AND ${table.completedAt} IS NULL
        AND ${table.reconciliationReason} IS NULL
      ) OR (
        ${table.state} = 'completed'
        AND ${table.keycloakAppliedAt} IS NOT NULL
        AND ${table.reconciliationRequiredAt} IS NULL
        AND ${table.completedAt} IS NOT NULL
        AND ${table.reconciliationReason} IS NULL
      ) OR (
        ${table.state} = 'failed'
        AND ${table.keycloakAppliedAt} IS NULL
        AND ${table.reconciliationRequiredAt} IS NULL
        AND ${table.completedAt} IS NOT NULL
        AND ${table.resourceId} IS NULL
        AND ${table.reconciliationReason} IS NULL
      ) OR (
        ${table.state} = 'reconciliation_required'
        AND ${table.reconciliationRequiredAt} IS NOT NULL
        AND ${table.completedAt} IS NULL
        AND ${table.reconciliationReason} IS NOT NULL
      )`,
    ),
    check(
      "identity_mutation_journal_timestamps_check",
      sql`${table.updatedAt} >= ${table.createdAt}
        AND (
          ${table.keycloakAppliedAt} IS NULL
          OR ${table.keycloakAppliedAt} >= ${table.createdAt}
        )
        AND (
          ${table.reconciliationRequiredAt} IS NULL
          OR ${table.reconciliationRequiredAt} >= COALESCE(${table.keycloakAppliedAt}, ${table.createdAt})
        )
        AND (
          ${table.completedAt} IS NULL
          OR ${table.completedAt} >= COALESCE(${table.keycloakAppliedAt}, ${table.createdAt})
        )`,
    ),
    index("identity_mutation_journal_state_updated_idx").on(
      table.state,
      table.updatedAt,
    ),
    uniqueIndex("identity_mutation_journal_one_unresolved_idx")
      .on(sql`(true)`)
      .where(
        sql`${table.state} IN ('prepared', 'keycloak_applied', 'reconciliation_required')`,
      ),
  ],
)

export const identityMutationJournalTargets = admin.table(
  "identity_mutation_journal_targets",
  {
    id: uuid("id").primaryKey(),
    journalId: uuid("journal_id")
      .notNull()
      .references(() => identityMutationJournal.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    targetType: text("target_type").notNull(),
    targetIdentifier: text("target_identifier").notNull(),
    intent: jsonb("intent").notNull(),
    state: text("state").default("unattempted").notNull(),
    resourceId: text("resource_id"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "identity_mutation_journal_targets_ordinal_check",
      sql`${table.ordinal} BETWEEN 0 AND 99`,
    ),
    check(
      "identity_mutation_journal_targets_type_check",
      sql`${table.targetType} IN ('user', 'group_membership')`,
    ),
    check(
      "identity_mutation_journal_targets_identifier_check",
      sql`char_length(${table.targetIdentifier}) BETWEEN 1 AND 511`,
    ),
    check(
      "identity_mutation_journal_targets_intent_check",
      sql`(
        ${table.intent} ->> 'kind' = 'csv_user'
        AND ${table.intent} ?& ARRAY[
          'displayName', 'email', 'enabled', 'group', 'kind', 'line',
          'role', 'sendInvite', 'username'
        ]
        AND ${table.intent} - ARRAY[
          'displayName', 'email', 'enabled', 'group', 'kind', 'line',
          'role', 'sendInvite', 'username'
        ] = '{}'::jsonb
        AND jsonb_typeof(${table.intent} -> 'displayName') = 'string'
        AND jsonb_typeof(${table.intent} -> 'email') = 'string'
        AND jsonb_typeof(${table.intent} -> 'enabled') = 'boolean'
        AND jsonb_typeof(${table.intent} -> 'group') = 'string'
        AND jsonb_typeof(${table.intent} -> 'line') = 'number'
        AND ${table.intent} ->> 'role' IN ('admin', 'operator')
        AND jsonb_typeof(${table.intent} -> 'sendInvite') = 'boolean'
        AND jsonb_typeof(${table.intent} -> 'username') = 'string'
      ) OR (
        ${table.intent} ->> 'kind' = 'group_membership'
        AND ${table.intent} ?& ARRAY['groupId', 'kind', 'memberId']
        AND ${table.intent} - ARRAY['groupId', 'kind', 'memberId'] = '{}'::jsonb
        AND jsonb_typeof(${table.intent} -> 'groupId') = 'string'
        AND jsonb_typeof(${table.intent} -> 'memberId') = 'string'
      )`,
    ),
    check(
      "identity_mutation_journal_targets_state_check",
      sql`${table.state} IN ('unattempted', 'unknown', 'applied', 'failed')`,
    ),
    check(
      "identity_mutation_journal_targets_resource_id_check",
      sql`${table.resourceId} IS NULL OR char_length(${table.resourceId}) BETWEEN 1 AND 255`,
    ),
    check(
      "identity_mutation_journal_targets_lifecycle_check",
      sql`(
        ${table.state} = 'unattempted'
        AND ${table.resourceId} IS NULL
        AND ${table.startedAt} IS NULL
        AND ${table.completedAt} IS NULL
      ) OR (
        ${table.state} = 'unknown'
        AND ${table.startedAt} IS NOT NULL
        AND ${table.completedAt} IS NULL
      ) OR (
        ${table.state} = 'applied'
        AND ${table.startedAt} IS NOT NULL
        AND ${table.completedAt} IS NOT NULL
        AND (
          ${table.targetType} <> 'user'
          OR ${table.resourceId} IS NOT NULL
        )
      ) OR (
        ${table.state} = 'failed'
        AND ${table.resourceId} IS NULL
        AND ${table.startedAt} IS NOT NULL
        AND ${table.completedAt} IS NOT NULL
      )`,
    ),
    check(
      "identity_mutation_journal_targets_timestamps_check",
      sql`${table.updatedAt} >= ${table.createdAt}
        AND (
          ${table.startedAt} IS NULL
          OR ${table.startedAt} >= ${table.createdAt}
        )
        AND (
          ${table.completedAt} IS NULL
          OR ${table.completedAt} >= ${table.startedAt}
        )`,
    ),
    uniqueIndex("identity_mutation_journal_targets_ordinal_idx").on(
      table.journalId,
      table.ordinal,
    ),
    uniqueIndex("identity_mutation_journal_targets_identifier_idx").on(
      table.journalId,
      table.targetIdentifier,
    ),
    index("identity_mutation_journal_targets_state_idx").on(
      table.journalId,
      table.state,
    ),
  ],
)

export const consoleSettings = admin.table(
  "console_settings",
  {
    id: text("id").primaryKey(),
    organizationName: text("organization_name")
      .default("LLM Machines")
      .notNull(),
    defaultLanguage: text("default_language").default("en").notNull(),
    fullLogo: jsonb("full_logo"),
    iconLogo: jsonb("icon_logo"),
    telemetryEnabled: boolean("telemetry_enabled").default(false).notNull(),
    telemetryPayloadPreview: jsonb("telemetry_payload_preview")
      .default({})
      .notNull(),
    privacyPolicyHref: text("privacy_policy_href")
      .default("/privacy")
      .notNull(),
    dataResidencyStatement: text("data_residency_statement")
      .default(
        "LLM Machines managed components do not retain inference request or response content.",
      )
      .notNull(),
    updatedBy: text("updated_by").references(() => humanIdentities.subjectId, {
      onDelete: "restrict",
    }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check("console_settings_id_check", sql`${table.id} = 'singleton'`),
    check(
      "console_settings_language_check",
      sql`${table.defaultLanguage} IN ('en', 'hr')`,
    ),
  ],
)

export const licenseState = admin.table(
  "license_state",
  {
    id: text("id").primaryKey(),
    sourceStatus: text("source_status").default("not_configured").notNull(),
    subscriptionState: text("subscription_state")
      .default("not_configured")
      .notNull(),
    supportState: text("support_state")
      .default("License service is not connected.")
      .notNull(),
    applianceId: text("appliance_id"),
    certificateExpiresAt: timestamp("certificate_expires_at", {
      withTimezone: true,
    }),
    lastEntitlementCheckAt: timestamp("last_entitlement_check_at", {
      withTimezone: true,
    }),
    offlineMode: boolean("offline_mode").default(true).notNull(),
    telemetryOptIn: boolean("telemetry_opt_in").default(false).notNull(),
    allowedUpdateChannels: jsonb("allowed_update_channels")
      .default([])
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check("license_state_id_check", sql`${table.id} = 'singleton'`),
    check(
      "license_state_source_status_check",
      sql`${table.sourceStatus} IN ('ok', 'degraded', 'unavailable', 'not_configured')`,
    ),
    check(
      "license_state_subscription_check",
      sql`${table.subscriptionState} IN ('active', 'soft_grace', 'restricted', 'terminated', 'unknown', 'not_configured')`,
    ),
  ],
)

export const updateState = admin.table(
  "update_state",
  {
    id: text("id").primaryKey(),
    status: text("status").default("not_configured").notNull(),
    currentVersion: text("current_version"),
    availableVersion: text("available_version"),
    bundleId: text("bundle_id"),
    bundleDigest: text("bundle_digest"),
    rollbackSnapshotId: text("rollback_snapshot_id"),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    lastAppliedAt: timestamp("last_applied_at", { withTimezone: true }),
    updatedBy: text("updated_by").references(() => humanIdentities.subjectId, {
      onDelete: "restrict",
    }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check("update_state_id_check", sql`${table.id} = 'singleton'`),
    check(
      "update_state_status_check",
      sql`${table.status} IN ('not_configured', 'idle', 'available', 'preflighting', 'applying', 'succeeded', 'failed', 'rolling_back', 'rolled_back')`,
    ),
  ],
)

export const backupState = admin.table(
  "backup_state",
  {
    id: text("id").primaryKey(),
    status: text("status").default("not_configured").notNull(),
    lastBackupId: text("last_backup_id"),
    lastBackupDigest: text("last_backup_digest"),
    lastBackupStartedAt: timestamp("last_backup_started_at", {
      withTimezone: true,
    }),
    lastBackupCompletedAt: timestamp("last_backup_completed_at", {
      withTimezone: true,
    }),
    lastBackupVerifiedAt: timestamp("last_backup_verified_at", {
      withTimezone: true,
    }),
    encrypted: boolean("encrypted").default(false).notNull(),
    contentFree: boolean("content_free").default(true).notNull(),
    updatedBy: text("updated_by").references(() => humanIdentities.subjectId, {
      onDelete: "restrict",
    }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check("backup_state_id_check", sql`${table.id} = 'singleton'`),
    check(
      "backup_state_status_check",
      sql`${table.status} IN ('not_configured', 'idle', 'running', 'succeeded', 'failed')`,
    ),
  ],
)

export const emergencyRecoveryFactor = admin.table(
  "emergency_recovery_factor",
  {
    id: text("id").primaryKey(),
    algorithm: text("algorithm").notNull(),
    verifierHash: text("verifier_hash").notNull(),
    salt: text("salt").notNull(),
    cost: integer("cost").notNull(),
    blockSize: integer("block_size").notNull(),
    parallelization: integer("parallelization").notNull(),
    keyLength: integer("key_length").notNull(),
    maxMemory: integer("max_memory").notNull(),
    commissionedBy: text("commissioned_by").notNull(),
    commissionedAt: timestamp("commissioned_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check("emergency_recovery_factor_id_check", sql`${table.id} = 'appliance'`),
    check(
      "emergency_recovery_factor_algorithm_check",
      sql`${table.algorithm} = 'scrypt'`,
    ),
    check(
      "emergency_recovery_factor_verifier_check",
      sql`${table.verifierHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "emergency_recovery_factor_salt_check",
      sql`${table.salt} ~ '^[0-9a-f]{32}$'`,
    ),
    check(
      "emergency_recovery_factor_parameters_check",
      sql`${table.cost} = 16384
        AND ${table.blockSize} = 8
        AND ${table.parallelization} = 1
        AND ${table.keyLength} = 32
        AND ${table.maxMemory} = 67108864`,
    ),
    check(
      "emergency_recovery_factor_subject_check",
      sql`char_length(${table.commissionedBy}) BETWEEN 1 AND 255`,
    ),
  ],
)

export const emergencyRecoverySessions = admin.table(
  "emergency_recovery_sessions",
  {
    id: uuid("id").primaryKey(),
    keycloakSubjectId: text("keycloak_subject_id").notNull(),
    reasonCode: text("reason_code").notNull(),
    status: text("status").default("active").notNull(),
    activatedAt: timestamp("activated_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedBy: text("revoked_by"),
    correlationId: text("correlation_id").notNull(),
  },
  (table) => [
    check(
      "emergency_recovery_sessions_subject_check",
      sql`char_length(${table.keycloakSubjectId}) BETWEEN 1 AND 255`,
    ),
    check(
      "emergency_recovery_sessions_reason_check",
      sql`${table.reasonCode} IN ('admin_lockout', 'admin_role_repair', 'admin_mfa_repair')`,
    ),
    check(
      "emergency_recovery_sessions_status_check",
      sql`${table.status} IN ('active', 'revoked', 'expired')`,
    ),
    check(
      "emergency_recovery_sessions_correlation_check",
      sql`char_length(${table.correlationId}) BETWEEN 1 AND 128`,
    ),
    check(
      "emergency_recovery_sessions_revoked_by_check",
      sql`${table.revokedBy} IS NULL OR char_length(${table.revokedBy}) BETWEEN 1 AND 255`,
    ),
    check(
      "emergency_recovery_sessions_ttl_check",
      sql`${table.expiresAt} = ${table.activatedAt} + interval '15 minutes'`,
    ),
    check(
      "emergency_recovery_sessions_lifecycle_check",
      sql`(
        ${table.status} = 'active'
        AND ${table.revokedAt} IS NULL
        AND ${table.revokedBy} IS NULL
      ) OR (
        ${table.status} = 'revoked'
        AND ${table.revokedAt} IS NOT NULL
        AND ${table.revokedBy} IS NOT NULL
        AND ${table.revokedAt} >= ${table.activatedAt}
        AND ${table.revokedAt} < ${table.expiresAt}
      ) OR (
        ${table.status} = 'expired'
        AND ${table.revokedAt} IS NULL
        AND ${table.revokedBy} IS NULL
      )`,
    ),
    uniqueIndex("emergency_recovery_sessions_one_active_idx")
      .on(table.status)
      .where(sql`${table.status} = 'active'`),
    index("emergency_recovery_sessions_expiry_idx").on(table.expiresAt),
  ],
)

export const recoveryState = admin.table(
  "recovery_state",
  {
    id: text("id").primaryKey(),
    status: text("status").default("not_configured").notNull(),
    sourceBackupId: text("source_backup_id"),
    lastRestoreId: text("last_restore_id"),
    lastRestoreStartedAt: timestamp("last_restore_started_at", {
      withTimezone: true,
    }),
    lastRestoreCompletedAt: timestamp("last_restore_completed_at", {
      withTimezone: true,
    }),
    lastRecoveryCheckAt: timestamp("last_recovery_check_at", {
      withTimezone: true,
    }),
    credentialRotationRequired: boolean("credential_rotation_required")
      .default(false)
      .notNull(),
    updatedBy: text("updated_by").references(() => humanIdentities.subjectId, {
      onDelete: "restrict",
    }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check("recovery_state_id_check", sql`${table.id} = 'singleton'`),
    check(
      "recovery_state_status_check",
      sql`${table.status} IN ('not_configured', 'ready', 'restoring', 'succeeded', 'failed', 'rotation_required')`,
    ),
  ],
)
