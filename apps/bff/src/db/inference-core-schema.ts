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
    lastTestedAt: timestamp("last_tested_at", { withTimezone: true }),
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
          AND ${table.rotatedAt} IS NULL
          AND ${table.overlapExpiresAt} IS NULL
        )`,
    ),
    check(
      "application_credentials_lifecycle_check",
      sql`(
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
      )`,
    ),
    check(
      "application_credentials_timestamps_check",
      sql`(${table.lastUsedAt} IS NULL OR ${table.lastUsedAt} >= ${table.issuedAt})
        AND (${table.rotatedAt} IS NULL OR ${table.rotatedAt} >= ${table.issuedAt})
        AND (
          ${table.overlapExpiresAt} IS NULL
          OR ${table.overlapExpiresAt} > ${table.rotatedAt}
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
    requestsPerMinute: integer("requests_per_minute"),
    tokensPer7d: bigint("tokens_per_7d", { mode: "number" }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "application_limits_requests_check",
      sql`${table.requestsPerMinute} IS NULL OR ${table.requestsPerMinute} > 0`,
    ),
    check(
      "application_limits_tokens_check",
      sql`${table.tokensPer7d} IS NULL OR ${table.tokensPer7d} > 0`,
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

export const applicationUsageDaily = admin.table(
  "application_usage_daily",
  {
    appId: text("app_id")
      .notNull()
      .references(() => applications.id, { onDelete: "restrict" }),
    credentialId: text("credential_id").notNull(),
    bucketDate: date("bucket_date").notNull(),
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
      columns: [table.appId, table.credentialId, table.bucketDate],
      name: "application_usage_daily_pkey",
    }),
    check(
      "application_usage_daily_counts_check",
      sql`${table.requestCount} >= 0 AND ${table.failureCount} >= 0`,
    ),
    check(
      "application_usage_daily_tokens_check",
      sql`${table.inputTokens} >= 0
        AND ${table.outputTokens} >= 0
        AND ${table.totalTokens} >= 0`,
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
