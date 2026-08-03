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
    ingestedAt: timestamp("ingested_at", { withTimezone: true })
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
      "audit_events_native_metadata_check",
      sql`${table.sourceSystem} NOT IN ('keycloak', 'litellm', 'grafana', 'alertmanager') OR (
        ${table.id}::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND
        ${table.correlationId} ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND (
          (
            ${table.sourceSystem} = 'keycloak'
            AND ${table.action} IN (
              'keycloak.authentication.failed',
              'keycloak.authentication.succeeded',
              'keycloak.credential.updated',
              'keycloak.role.assigned',
              'keycloak.role.revoked',
              'keycloak.user.created',
              'keycloak.user.deleted',
              'keycloak.user.updated'
            )
            AND (
              ${table.recoveryReasonCode} IS NULL
              OR ${table.recoveryReasonCode} IN (
                'account_disabled',
                'authentication_failed',
                'authorization_denied',
                'invalid_credentials',
                'policy_rejected'
              )
            )
          ) OR (
            ${table.sourceSystem} = 'litellm'
            AND ${table.action} IN (
              'litellm.request.denied',
              'litellm.request.failed',
              'litellm.request.succeeded',
              'litellm.route.created',
              'litellm.route.deleted',
              'litellm.route.updated',
              'litellm.virtual_key.created',
              'litellm.virtual_key.revoked',
              'litellm.virtual_key.rotated',
              'litellm.virtual_key.updated'
            )
            AND (
              ${table.recoveryReasonCode} IS NULL
              OR ${table.recoveryReasonCode} IN (
                'model_denied',
                'rate_limited',
                'request_failed',
                'route_unavailable'
              )
            )
          ) OR (
            ${table.sourceSystem} = 'grafana'
            AND ${table.action} IN (
              'grafana.alert_rule.created',
              'grafana.alert_rule.deleted',
              'grafana.alert_rule.updated',
              'grafana.dashboard.created',
              'grafana.dashboard.deleted',
              'grafana.dashboard.updated',
              'grafana.datasource.updated',
              'grafana.folder.created',
              'grafana.folder.deleted',
              'grafana.folder.updated'
            )
            AND (
              ${table.recoveryReasonCode} IS NULL
              OR ${table.recoveryReasonCode} IN (
                'operation_failed',
                'permission_denied',
                'validation_failed'
              )
            )
          ) OR (
            ${table.sourceSystem} = 'alertmanager'
            AND ${table.action} IN (
              'alertmanager.configuration.reloaded',
              'alertmanager.notification.failed',
              'alertmanager.notification.succeeded',
              'alertmanager.silence.created',
              'alertmanager.silence.deleted',
              'alertmanager.silence.expired'
            )
            AND (
              ${table.recoveryReasonCode} IS NULL
              OR ${table.recoveryReasonCode} IN (
                'delivery_failed',
                'receiver_unavailable',
                'silence_rejected'
              )
            )
          )
        )
        AND (
          ${table.keycloakSubjectId} IS NULL OR (
            ${table.keycloakSubjectId} ~ '^[A-Za-z0-9][A-Za-z0-9_:-]{0,254}$'
            AND ${table.keycloakSubjectId} !~* '^(llmm_|bearer[:_-]|token[:_-]|secret[:_-]|password[:_-]|api[_-]?key[:_-])'
            AND ${table.keycloakSubjectId} !~* '^[0-9a-f]{64,}$'
            AND ${table.keycloakSubjectId} !~ '^(sk[-_](live|test|proj)[-_][A-Za-z0-9_-]{1,120}|github_pat_[A-Za-z0-9_]{1,120}|gh[pousr]_[A-Za-z0-9]{1,120}|xox[baprs]-[A-Za-z0-9-]{1,120}|eyJ[A-Za-z0-9_-]{5,120}[.][A-Za-z0-9_-]{4,120}[.][A-Za-z0-9_-]{4,120}|(AKIA|ASIA)[A-Z0-9]{16}|AIza[A-Za-z0-9_-]{20,120})$'
          )
        )
        AND (
          ${table.applicationId} IS NULL OR (
            ${table.applicationId} ~ '^[A-Za-z0-9][A-Za-z0-9_:-]{0,127}$'
            AND ${table.applicationId} !~* '^(llmm_|bearer[:_-]|token[:_-]|secret[:_-]|password[:_-]|api[_-]?key[:_-])'
            AND ${table.applicationId} !~* '^[0-9a-f]{64,}$'
            AND ${table.applicationId} !~ '^(sk[-_](live|test|proj)[-_][A-Za-z0-9_-]{1,120}|github_pat_[A-Za-z0-9_]{1,120}|gh[pousr]_[A-Za-z0-9]{1,120}|xox[baprs]-[A-Za-z0-9-]{1,120}|eyJ[A-Za-z0-9_-]{5,120}[.][A-Za-z0-9_-]{4,120}[.][A-Za-z0-9_-]{4,120}|(AKIA|ASIA)[A-Z0-9]{16}|AIza[A-Za-z0-9_-]{20,120})$'
          )
        )
        AND (
          ${table.credentialRecordId} IS NULL OR (
            ${table.credentialRecordId} ~ '^[A-Za-z0-9][A-Za-z0-9_:-]{0,127}$'
            AND ${table.credentialRecordId} !~* '^(llmm_|bearer[:_-]|token[:_-]|secret[:_-]|password[:_-]|api[_-]?key[:_-])'
            AND ${table.credentialRecordId} !~* '^[0-9a-f]{64,}$'
            AND ${table.credentialRecordId} !~ '^(sk[-_](live|test|proj)[-_][A-Za-z0-9_-]{1,120}|github_pat_[A-Za-z0-9_]{1,120}|gh[pousr]_[A-Za-z0-9]{1,120}|xox[baprs]-[A-Za-z0-9-]{1,120}|eyJ[A-Za-z0-9_-]{5,120}[.][A-Za-z0-9_-]{4,120}[.][A-Za-z0-9_-]{4,120}|(AKIA|ASIA)[A-Z0-9]{16}|AIza[A-Za-z0-9_-]{20,120})$'
          )
        )
        AND (
          ${table.credentialPrefix} IS NULL
          OR ${table.credentialPrefix} ~ '^(llmm_t4_[0-9a-f]{18}|llmm_fc_[0-9a-f]{16})$'
        )
      )`,
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
    index("audit_events_stable_order_idx").on(table.occurredAt, table.id),
    index("audit_events_correlation_id_idx").on(table.correlationId),
    index("audit_events_application_occurred_idx").on(
      table.applicationId,
      table.occurredAt,
    ),
  ],
)

export const auditSourceCursors = common.table(
  "audit_source_cursors",
  {
    sourceSystem: text("source_system").primaryKey(),
    cursorVersion: integer("cursor_version"),
    cursorWatermark: timestamp("cursor_watermark", { withTimezone: true }),
    cursorTieBreaker: uuid("cursor_tie_breaker"),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    lastEventOccurredAt: timestamp("last_event_occurred_at", {
      withTimezone: true,
    }),
    lastErrorCode: text("last_error_code"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "audit_source_cursors_source_check",
      sql`${table.sourceSystem} IN ('keycloak', 'litellm', 'grafana', 'alertmanager')`,
    ),
    check(
      "audit_source_cursors_cursor_check",
      sql`num_nonnulls(
        ${table.cursorVersion},
        ${table.cursorWatermark},
        ${table.cursorTieBreaker}
      ) IN (0, 3) AND (
        ${table.cursorVersion} IS NULL OR ${table.cursorVersion} = 1
      ) AND (
        ${table.cursorTieBreaker} IS NULL OR
        ${table.cursorTieBreaker}::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      )`,
    ),
    check(
      "audit_source_cursors_error_code_check",
      sql`${table.lastErrorCode} IS NULL OR (
        char_length(${table.lastErrorCode}) BETWEEN 1 AND 64
        AND ${table.lastErrorCode} ~ '^[a-z][a-z0-9._:-]*$'
      )`,
    ),
    index("audit_source_cursors_health_idx").on(
      table.lastSuccessAt,
      table.lastAttemptAt,
    ),
  ],
)

export const consoleLoginTransactions = common.table(
  "console_login_transactions",
  {
    handleDigest: text("handle_digest").primaryKey(),
    stateDigest: text("state_digest").notNull().unique(),
    subjectDigest: text("subject_digest"),
    encryptedPayload: jsonb("encrypted_payload").notNull(),
    encryptionKid: text("encryption_kid").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    check(
      "console_login_transactions_handle_digest_check",
      sql`${table.handleDigest} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "console_login_transactions_state_digest_check",
      sql`${table.stateDigest} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "console_login_transactions_subject_digest_check",
      sql`${table.subjectDigest} IS NULL OR ${table.subjectDigest} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "console_login_transactions_encryption_kid_check",
      sql`${table.encryptionKid} ~ '^[A-Za-z0-9._-]{1,64}$'`,
    ),
    check(
      "console_login_transactions_encrypted_payload_check",
      sql`jsonb_typeof(${table.encryptedPayload}) = 'object'
        AND ${table.encryptedPayload} ?& ARRAY[
          'version',
          'kid',
          'iv',
          'tag',
          'ciphertext'
        ]
        AND (
          ${table.encryptedPayload}
            - 'version'
            - 'kid'
            - 'iv'
            - 'tag'
            - 'ciphertext'
        ) = '{}'::jsonb
        AND ${table.encryptedPayload} -> 'version' = '1'::jsonb
        AND jsonb_typeof(${table.encryptedPayload} -> 'kid') = 'string'
        AND jsonb_typeof(${table.encryptedPayload} -> 'iv') = 'string'
        AND jsonb_typeof(${table.encryptedPayload} -> 'tag') = 'string'
        AND jsonb_typeof(${table.encryptedPayload} -> 'ciphertext') = 'string'
        AND ${table.encryptedPayload} ->> 'kid' = ${table.encryptionKid}
        AND ${table.encryptedPayload} ->> 'iv' ~ '^[A-Za-z0-9_-]{16}$'
        AND ${table.encryptedPayload} ->> 'tag' ~ '^[A-Za-z0-9_-]{22}$'
        AND ${table.encryptedPayload} ->> 'ciphertext' ~ '^[A-Za-z0-9_-]+$'
        AND octet_length(${table.encryptedPayload}::text) BETWEEN 80 AND 131072`,
    ),
    check(
      "console_login_transactions_lifetime_check",
      sql`${table.expiresAt} = ${table.createdAt} + interval '2 minutes'`,
    ),
    index("console_login_transactions_expiry_idx").on(table.expiresAt),
  ],
)

export const consoleSessions = common.table(
  "console_sessions",
  {
    handleDigest: text("handle_digest").primaryKey(),
    subjectDigest: text("subject_digest").notNull(),
    keycloakSessionDigest: text("keycloak_session_digest"),
    encryptedPayload: jsonb("encrypted_payload").notNull(),
    encryptionKid: text("encryption_kid").notNull(),
    refreshGeneration: bigint("refresh_generation", { mode: "number" })
      .default(0)
      .notNull(),
    refreshBlockedUntil: timestamp("refresh_blocked_until", {
      withTimezone: true,
    }),
    refreshFailureReason: text("refresh_failure_reason"),
    accessExpiresAt: timestamp("access_expires_at", {
      withTimezone: true,
    }).notNull(),
    idleExpiresAt: timestamp("idle_expires_at", {
      withTimezone: true,
    }).notNull(),
    absoluteExpiresAt: timestamp("absolute_expires_at", {
      withTimezone: true,
    }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    check(
      "console_sessions_handle_digest_check",
      sql`${table.handleDigest} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "console_sessions_subject_digest_check",
      sql`${table.subjectDigest} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "console_sessions_keycloak_session_digest_check",
      sql`${table.keycloakSessionDigest} IS NULL OR ${table.keycloakSessionDigest} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "console_sessions_encryption_kid_check",
      sql`${table.encryptionKid} ~ '^[A-Za-z0-9._-]{1,64}$'`,
    ),
    check(
      "console_sessions_encrypted_payload_check",
      sql`jsonb_typeof(${table.encryptedPayload}) = 'object'
        AND ${table.encryptedPayload} ?& ARRAY[
          'version',
          'kid',
          'iv',
          'tag',
          'ciphertext'
        ]
        AND (
          ${table.encryptedPayload}
            - 'version'
            - 'kid'
            - 'iv'
            - 'tag'
            - 'ciphertext'
        ) = '{}'::jsonb
        AND ${table.encryptedPayload} -> 'version' = '1'::jsonb
        AND jsonb_typeof(${table.encryptedPayload} -> 'kid') = 'string'
        AND jsonb_typeof(${table.encryptedPayload} -> 'iv') = 'string'
        AND jsonb_typeof(${table.encryptedPayload} -> 'tag') = 'string'
        AND jsonb_typeof(${table.encryptedPayload} -> 'ciphertext') = 'string'
        AND ${table.encryptedPayload} ->> 'kid' = ${table.encryptionKid}
        AND ${table.encryptedPayload} ->> 'iv' ~ '^[A-Za-z0-9_-]{16}$'
        AND ${table.encryptedPayload} ->> 'tag' ~ '^[A-Za-z0-9_-]{22}$'
        AND ${table.encryptedPayload} ->> 'ciphertext' ~ '^[A-Za-z0-9_-]+$'
        AND octet_length(${table.encryptedPayload}::text) BETWEEN 80 AND 131072`,
    ),
    check(
      "console_sessions_refresh_generation_check",
      sql`${table.refreshGeneration} BETWEEN 0 AND 9007199254740991`,
    ),
    check(
      "console_sessions_refresh_block_check",
      sql`(${table.refreshBlockedUntil} IS NULL AND ${table.refreshFailureReason} IS NULL)
        OR (
          ${table.refreshBlockedUntil} IS NOT NULL
          AND ${table.refreshFailureReason} IN (
            'identity_restart',
            'identity_timeout',
            'identity_unavailable'
          )
        )`,
    ),
    check(
      "console_sessions_lifetime_check",
      sql`${table.absoluteExpiresAt} = ${table.createdAt} + interval '8 hours'
        AND ${table.createdAt} <= ${table.lastSeenAt}
        AND ${table.lastSeenAt} <= ${table.updatedAt}
        AND ${table.updatedAt} < ${table.absoluteExpiresAt}
        AND ${table.idleExpiresAt} = LEAST(
          ${table.lastSeenAt} + interval '30 minutes',
          ${table.absoluteExpiresAt}
        )
        AND ${table.accessExpiresAt} >= ${table.updatedAt} - interval '1 minute'
        AND ${table.accessExpiresAt} <= ${table.updatedAt} + interval '6 minutes'`,
    ),
    index("console_sessions_idle_expiry_idx").on(table.idleExpiresAt),
    index("console_sessions_subject_digest_idx").on(table.subjectDigest),
    index("console_sessions_keycloak_session_digest_idx")
      .on(table.keycloakSessionDigest)
      .where(sql`${table.keycloakSessionDigest} IS NOT NULL`),
    index("console_sessions_encryption_kid_idx").on(table.encryptionKid),
  ],
)

export const consoleLogoutTokenReplays = common.table(
  "console_logout_token_replays",
  {
    jtiDigest: text("jti_digest").primaryKey(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }).notNull(),
    retainUntil: timestamp("retain_until", { withTimezone: true }).notNull(),
  },
  (table) => [
    check(
      "console_logout_token_replays_jti_digest_check",
      sql`${table.jtiDigest} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "console_logout_token_replays_lifetime_check",
      sql`${table.retainUntil} > ${table.consumedAt}
        AND ${table.retainUntil} <= ${table.consumedAt} + interval '7 minutes'`,
    ),
    index("console_logout_token_replays_retention_idx").on(table.retainUntil),
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

export const applicationFirecrawlAccess = admin.table(
  "application_firecrawl_access",
  {
    appId: text("app_id")
      .primaryKey()
      .references(() => applications.id, { onDelete: "restrict" }),
    status: text("status").default("disabled").notNull(),
    disclaimerVersion: text("disclaimer_version"),
    disclaimerAcceptedBy: text("disclaimer_accepted_by").references(
      () => humanIdentities.subjectId,
      { onDelete: "restrict" },
    ),
    disclaimerAcceptedAt: timestamp("disclaimer_accepted_at", {
      withTimezone: true,
    }),
    connectionStatus: text("connection_status")
      .default("not_connected")
      .notNull(),
    lastConnectedAt: timestamp("last_connected_at", { withTimezone: true }),
    searchRateLimitRps: integer("search_rate_limit_rps"),
    scrapeRateLimitRps: integer("scrape_rate_limit_rps"),
    maxConcurrentScrapes: integer("max_concurrent_scrapes"),
    updatedBy: text("updated_by")
      .notNull()
      .references(() => humanIdentities.subjectId, { onDelete: "restrict" }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "application_firecrawl_access_status_check",
      sql`${table.status} IN ('disabled', 'enabled')`,
    ),
    check(
      "application_firecrawl_access_disclaimer_version_check",
      sql`${table.disclaimerVersion} IS NULL
        OR char_length(${table.disclaimerVersion}) BETWEEN 1 AND 64`,
    ),
    check(
      "application_firecrawl_access_disclaimer_pair_check",
      sql`num_nonnulls(
          ${table.disclaimerVersion},
          ${table.disclaimerAcceptedBy},
          ${table.disclaimerAcceptedAt}
        ) IN (0, 3)`,
    ),
    check(
      "application_firecrawl_access_enabled_disclaimer_check",
      sql`${table.status} = 'disabled'
        OR ${table.disclaimerAcceptedAt} IS NOT NULL`,
    ),
    check(
      "application_firecrawl_access_connection_check",
      sql`(
          ${table.connectionStatus} = 'not_connected'
          AND ${table.lastConnectedAt} IS NULL
        ) OR (
          ${table.connectionStatus} IN ('connected', 'degraded')
          AND ${table.lastConnectedAt} IS NOT NULL
        )`,
    ),
    check(
      "application_firecrawl_access_search_rate_check",
      sql`${table.searchRateLimitRps} IS NULL
        OR ${table.searchRateLimitRps} BETWEEN 1 AND 1000`,
    ),
    check(
      "application_firecrawl_access_scrape_rate_check",
      sql`${table.scrapeRateLimitRps} IS NULL
        OR ${table.scrapeRateLimitRps} BETWEEN 1 AND 1000`,
    ),
    check(
      "application_firecrawl_access_concurrency_check",
      sql`${table.maxConcurrentScrapes} IS NULL
        OR ${table.maxConcurrentScrapes} BETWEEN 1 AND 100`,
    ),
    index("application_firecrawl_access_status_updated_idx").on(
      table.status,
      table.updatedAt,
    ),
  ],
)

export const applicationFirecrawlCredentials = admin.table(
  "application_firecrawl_credentials",
  {
    id: text("id").primaryKey(),
    appId: text("app_id")
      .notNull()
      .references(() => applicationFirecrawlAccess.appId, {
        onDelete: "restrict",
      }),
    keyPrefix: text("key_prefix").notNull(),
    verifierHash: text("verifier_hash").notNull(),
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
    check(
      "application_firecrawl_credentials_id_check",
      sql`char_length(${table.id}) BETWEEN 1 AND 128`,
    ),
    check(
      "application_firecrawl_credentials_prefix_check",
      sql`${table.keyPrefix} ~ '^llmm_fc_[0-9a-f]{16}$'`,
    ),
    check(
      "application_firecrawl_credentials_hash_check",
      sql`${table.verifierHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "application_firecrawl_credentials_status_check",
      sql`${table.status} IN ('active', 'retiring', 'revoked')`,
    ),
    check(
      "application_firecrawl_credentials_lifecycle_check",
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
      "application_firecrawl_credentials_timestamps_check",
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
    uniqueIndex("application_firecrawl_credentials_id_app_idx").on(
      table.id,
      table.appId,
    ),
    uniqueIndex("application_firecrawl_credentials_verifier_hash_idx").on(
      table.verifierHash,
    ),
    uniqueIndex("application_firecrawl_credentials_one_active_idx")
      .on(table.appId)
      .where(sql`${table.status} = 'active'`),
    uniqueIndex("application_firecrawl_credentials_one_retiring_idx")
      .on(table.appId)
      .where(sql`${table.status} = 'retiring'`),
    index("application_firecrawl_credentials_prefix_status_idx").on(
      table.keyPrefix,
      table.status,
    ),
    index("application_firecrawl_credentials_app_status_idx").on(
      table.appId,
      table.status,
    ),
  ],
)

export const applicationFirecrawlRateLimitWindows = admin.table(
  "application_firecrawl_rate_limit_windows",
  {
    appId: text("app_id")
      .notNull()
      .references(() => applicationFirecrawlAccess.appId, {
        onDelete: "restrict",
      }),
    routeKind: text("route_kind").notNull(),
    windowStartedAt: timestamp("window_started_at", {
      withTimezone: true,
    }).notNull(),
    requestCount: integer("request_count").default(0).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.appId, table.routeKind, table.windowStartedAt],
      name: "application_firecrawl_rate_limit_windows_pkey",
    }),
    check(
      "application_firecrawl_rate_limit_windows_route_check",
      sql`${table.routeKind} IN ('search', 'scrape')`,
    ),
    check(
      "application_firecrawl_rate_limit_windows_count_check",
      sql`${table.requestCount} >= 0`,
    ),
    check(
      "application_firecrawl_rate_limit_windows_expiry_check",
      sql`${table.expiresAt} > ${table.windowStartedAt}`,
    ),
    index("application_firecrawl_rate_limit_windows_expiry_idx").on(
      table.expiresAt,
    ),
  ],
)

export const applicationFirecrawlRequestLedger = admin.table(
  "application_firecrawl_request_ledger",
  {
    id: uuid("id").primaryKey(),
    appId: text("app_id").notNull(),
    credentialId: text("credential_id").notNull(),
    routeKind: text("route_kind").notNull(),
    state: text("state").default("active").notNull(),
    statusCode: integer("status_code"),
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
      foreignColumns: [
        applicationFirecrawlCredentials.id,
        applicationFirecrawlCredentials.appId,
      ],
      name: "application_firecrawl_request_ledger_credential_app_fk",
    }).onDelete("restrict"),
    check(
      "application_firecrawl_request_ledger_route_check",
      sql`${table.routeKind} IN ('search', 'scrape')`,
    ),
    check(
      "application_firecrawl_request_ledger_state_check",
      sql`${table.state} IN ('active', 'settled')`,
    ),
    check(
      "application_firecrawl_request_ledger_status_code_check",
      sql`${table.statusCode} IS NULL OR ${table.statusCode} BETWEEN 100 AND 599`,
    ),
    check(
      "application_firecrawl_request_ledger_latency_check",
      sql`${table.latencyMs} IS NULL OR ${table.latencyMs} >= 0`,
    ),
    check(
      "application_firecrawl_request_ledger_lifecycle_check",
      sql`(
          ${table.state} = 'active'
          AND ${table.statusCode} IS NULL
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
      "application_firecrawl_request_ledger_timestamps_check",
      sql`${table.leaseExpiresAt} > ${table.startedAt}
        AND (${table.settledAt} IS NULL OR ${table.settledAt} >= ${table.startedAt})`,
    ),
    index("application_firecrawl_request_ledger_active_idx")
      .on(table.appId, table.routeKind, table.leaseExpiresAt)
      .where(sql`${table.state} = 'active'`),
    index("application_firecrawl_request_ledger_settled_started_idx")
      .on(table.startedAt)
      .where(sql`${table.state} = 'settled'`),
  ],
)

export const applicationFirecrawlUsageDaily = admin.table(
  "application_firecrawl_usage_daily",
  {
    appId: text("app_id").notNull(),
    credentialId: text("credential_id").notNull(),
    bucketDate: date("bucket_date").notNull(),
    routeKind: text("route_kind").notNull(),
    requestCount: integer("request_count").default(0).notNull(),
    failureCount: integer("failure_count").default(0).notNull(),
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
      foreignColumns: [
        applicationFirecrawlCredentials.id,
        applicationFirecrawlCredentials.appId,
      ],
      name: "application_firecrawl_usage_daily_credential_app_fk",
    }).onDelete("restrict"),
    primaryKey({
      columns: [
        table.appId,
        table.credentialId,
        table.bucketDate,
        table.routeKind,
      ],
      name: "application_firecrawl_usage_daily_pkey",
    }),
    check(
      "application_firecrawl_usage_daily_route_check",
      sql`${table.routeKind} IN ('search', 'scrape')`,
    ),
    check(
      "application_firecrawl_usage_daily_counts_check",
      sql`${table.requestCount} >= 0
        AND ${table.failureCount} >= 0
        AND ${table.failureCount} <= ${table.requestCount}`,
    ),
    check(
      "application_firecrawl_usage_daily_latency_check",
      sql`${table.latencyMsSum} >= 0
        AND ${table.latencyMsMax} >= 0
        AND ${table.latencyMsMax} <= ${table.latencyMsSum}`,
    ),
    index("application_firecrawl_usage_daily_bucket_idx").on(table.bucketDate),
    index("application_firecrawl_usage_daily_app_bucket_idx").on(
      table.appId,
      table.bucketDate,
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
      .default({
        applianceId: null,
        installedVersion: null,
        updateAgentVersion: null,
        lastUpdateCheck: null,
        lastAppliedUpdate: null,
        subscriptionStateSeenByAppliance: "not_configured",
      })
      .notNull(),
    privacyPolicyHref: text("privacy_policy_href")
      .default("/privacy")
      .notNull(),
    dataResidencyStatement: text("data_residency_statement")
      .default(
        "LLM Machines managed components do not retain inference request or response content.",
      )
      .notNull(),
    alertDeliveryMode: text("alert_delivery_mode")
      .default("local_only")
      .notNull(),
    alertDeliveryTransport: text("alert_delivery_transport"),
    alertEgressWarningVersion: text("alert_egress_warning_version"),
    alertEgressRevision: bigint("alert_egress_revision", { mode: "number" })
      .default(0)
      .notNull(),
    alertEgressAcknowledgedAt: timestamp("alert_egress_acknowledged_at", {
      withTimezone: true,
    }),
    alertEgressAcknowledgedBy: text("alert_egress_acknowledged_by").references(
      () => humanIdentities.subjectId,
      { onDelete: "restrict" },
    ),
    alertEgressUpdatedBy: text("alert_egress_updated_by").references(
      () => humanIdentities.subjectId,
      { onDelete: "restrict" },
    ),
    alertEgressUpdatedAt: timestamp("alert_egress_updated_at", {
      withTimezone: true,
    }),
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
    check(
      "console_settings_alert_delivery_mode_check",
      sql`${table.alertDeliveryMode} IN ('local_only', 'customer_owned')`,
    ),
    check(
      "console_settings_alert_transport_check",
      sql`${table.alertDeliveryTransport} IS NULL OR ${table.alertDeliveryTransport} IN ('smtp', 'webhook')`,
    ),
    check(
      "console_settings_alert_warning_check",
      sql`${table.alertEgressWarningVersion} IS NULL OR char_length(${table.alertEgressWarningVersion}) BETWEEN 1 AND 64`,
    ),
    check(
      "console_settings_alert_revision_check",
      sql`${table.alertEgressRevision} >= 0`,
    ),
    check(
      "console_settings_alert_updater_check",
      sql`(
        ${table.alertEgressRevision} = 0
        AND num_nonnulls(
          ${table.alertEgressUpdatedAt},
          ${table.alertEgressUpdatedBy}
        ) = 0
      ) OR (
        ${table.alertEgressRevision} > 0
        AND num_nonnulls(
          ${table.alertEgressUpdatedAt},
          ${table.alertEgressUpdatedBy}
        ) = 2
      )`,
    ),
    check(
      "console_settings_alert_delivery_lifecycle_check",
      sql`(
        ${table.alertDeliveryMode} = 'local_only'
        AND num_nonnulls(
          ${table.alertDeliveryTransport},
          ${table.alertEgressWarningVersion},
          ${table.alertEgressAcknowledgedAt},
          ${table.alertEgressAcknowledgedBy}
        ) = 0
      ) OR (
        ${table.alertDeliveryMode} = 'customer_owned'
        AND num_nonnulls(
          ${table.alertDeliveryTransport},
          ${table.alertEgressWarningVersion},
          ${table.alertEgressAcknowledgedAt},
          ${table.alertEgressAcknowledgedBy}
        ) = 4
      )`,
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

export const emergencyIsolationState = admin.table(
  "emergency_isolation_state",
  {
    id: text("id").primaryKey(),
    status: text("status").default("inactive").notNull(),
    revision: bigint("revision", { mode: "number" }).default(0).notNull(),
    transitionId: uuid("transition_id"),
    correlationId: text("correlation_id"),
    changedBySubjectId: text("changed_by_subject_id"),
    failureCode: text("failure_code"),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    activatedBySubjectId: text("activated_by_subject_id"),
    transitionStartedAt: timestamp("transition_started_at", {
      withTimezone: true,
    }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check("emergency_isolation_state_id_check", sql`${table.id} = 'appliance'`),
    check(
      "emergency_isolation_state_status_check",
      sql`${table.status} IN ('inactive', 'engaging', 'active', 'disengaging', 'recovery_required')`,
    ),
    check(
      "emergency_isolation_state_revision_check",
      sql`${table.revision} BETWEEN 0 AND 9007199254740991`,
    ),
    check(
      "emergency_isolation_state_correlation_check",
      sql`${table.correlationId} IS NULL OR char_length(${table.correlationId}) BETWEEN 1 AND 128`,
    ),
    check(
      "emergency_isolation_state_subject_check",
      sql`(
        ${table.changedBySubjectId} IS NULL
        OR char_length(${table.changedBySubjectId}) BETWEEN 1 AND 255
      ) AND (
        ${table.activatedBySubjectId} IS NULL
        OR char_length(${table.activatedBySubjectId}) BETWEEN 1 AND 255
      )`,
    ),
    check(
      "emergency_isolation_state_failure_check",
      sql`${table.failureCode} IS NULL OR ${table.failureCode} IN ('state_invalid', 'admission_fence_failed', 'inflight_abort_failed', 'enforcement_failed', 'verification_failed', 'restore_reassertion_failed', 'journal_failed')`,
    ),
    check(
      "emergency_isolation_state_timestamps_check",
      sql`(
        ${table.transitionStartedAt} IS NULL
        OR ${table.updatedAt} >= ${table.transitionStartedAt}
      ) AND (
        ${table.activatedAt} IS NULL
        OR ${table.updatedAt} >= ${table.activatedAt}
      )`,
    ),
    check(
      "emergency_isolation_state_metadata_check",
      sql`(
        ${table.revision} = 0
        AND ${table.status} = 'inactive'
        AND ${table.transitionId} IS NULL
        AND ${table.correlationId} IS NULL
        AND ${table.changedBySubjectId} IS NULL
        AND ${table.failureCode} IS NULL
        AND ${table.activatedAt} IS NULL
        AND ${table.activatedBySubjectId} IS NULL
        AND ${table.transitionStartedAt} IS NULL
      ) OR (
        ${table.revision} > 0
        AND (
          (
            ${table.status} = 'recovery_required'
            AND ${table.failureCode} IS NOT NULL
          ) OR (
            ${table.status} <> 'recovery_required'
            AND ${table.failureCode} IS NULL
            AND ${table.changedBySubjectId} IS NOT NULL
          )
        )
        AND (
          (
            ${table.status} IN ('engaging', 'disengaging')
            AND ${table.transitionId} IS NOT NULL
            AND ${table.correlationId} IS NOT NULL
            AND ${table.transitionStartedAt} IS NOT NULL
          ) OR (
            ${table.status} IN ('inactive', 'active', 'recovery_required')
            AND ${table.transitionId} IS NULL
            AND ${table.correlationId} IS NULL
            AND ${table.transitionStartedAt} IS NULL
          )
        )
        AND (
          (
            ${table.status} IN ('inactive', 'engaging')
            AND ${table.activatedAt} IS NULL
            AND ${table.activatedBySubjectId} IS NULL
          ) OR (
            ${table.status} IN ('active', 'disengaging')
            AND ${table.activatedAt} IS NOT NULL
            AND ${table.activatedBySubjectId} IS NOT NULL
          ) OR (
            ${table.status} = 'recovery_required'
            AND (
              (
                ${table.activatedAt} IS NULL
                AND ${table.activatedBySubjectId} IS NULL
              ) OR (
                ${table.activatedAt} IS NOT NULL
                AND ${table.activatedBySubjectId} IS NOT NULL
              )
            )
          )
        )
      )`,
    ),
  ],
)

export const lifecycleOperations = admin.table(
  "lifecycle_operations",
  {
    id: uuid("id").primaryKey(),
    kind: text("kind").notNull(),
    state: text("state").default("prepared").notNull(),
    actorSubjectId: text("actor_subject_id")
      .notNull()
      .references(() => humanIdentities.subjectId, { onDelete: "restrict" }),
    correlationId: text("correlation_id").notNull(),
    snapshotId: uuid("snapshot_id").notNull(),
    failureCode: text("failure_code"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    check(
      "lifecycle_operations_kind_check",
      sql`${table.kind} IN ('snapshot', 'restore')`,
    ),
    check(
      "lifecycle_operations_state_check",
      sql`${table.state} IN (
        'prepared',
        'quiescing',
        'capturing',
        'validating',
        'restoring',
        'verifying',
        'resuming',
        'rolling_back',
        'succeeded',
        'rolled_back',
        'failed',
        'recovery_required'
      )`,
    ),
    check(
      "lifecycle_operations_failure_code_check",
      sql`${table.failureCode} IS NULL OR ${table.failureCode} IN (
        'adapter_unavailable',
        'quiesce_failed',
        'capture_failed',
        'manifest_invalid',
        'consistency_mismatch',
        'restore_failed',
        'verification_failed',
        'rollback_failed',
        'resume_failed',
        'journal_failed'
      )`,
    ),
    check(
      "lifecycle_operations_kind_state_check",
      sql`(
        ${table.kind} = 'snapshot'
        AND ${table.state} IN (
          'prepared',
          'quiescing',
          'capturing',
          'validating',
          'resuming',
          'succeeded',
          'failed',
          'recovery_required'
        )
      ) OR (
        ${table.kind} = 'restore'
        AND ${table.state} IN (
          'prepared',
          'quiescing',
          'validating',
          'restoring',
          'verifying',
          'resuming',
          'rolling_back',
          'succeeded',
          'rolled_back',
          'failed',
          'recovery_required'
        )
      )`,
    ),
    check(
      "lifecycle_operations_terminal_check",
      sql`(
        ${table.state} IN (
          'prepared',
          'quiescing',
          'capturing',
          'validating',
          'restoring',
          'verifying',
          'resuming'
        )
        AND ${table.completedAt} IS NULL
        AND ${table.failureCode} IS NULL
      ) OR (
        ${table.state} = 'rolling_back'
        AND ${table.completedAt} IS NULL
        AND ${table.failureCode} IS NOT NULL
      ) OR (
        ${table.state} = 'succeeded'
        AND ${table.completedAt} IS NOT NULL
        AND ${table.failureCode} IS NULL
      ) OR (
        ${table.state} IN ('rolled_back', 'failed', 'recovery_required')
        AND ${table.completedAt} IS NOT NULL
        AND ${table.failureCode} IS NOT NULL
      )`,
    ),
    check(
      "lifecycle_operations_correlation_id_check",
      sql`char_length(${table.correlationId}) BETWEEN 1 AND 128`,
    ),
    check(
      "lifecycle_operations_timestamps_check",
      sql`${table.updatedAt} >= ${table.createdAt}
        AND (
          ${table.completedAt} IS NULL
          OR (
            ${table.completedAt} >= ${table.createdAt}
            AND ${table.completedAt} <= ${table.updatedAt}
          )
        )`,
    ),
    uniqueIndex("lifecycle_operations_one_active_idx")
      .on(sql`(true)`)
      .where(
        sql`${table.state} IN (
          'prepared',
          'quiescing',
          'capturing',
          'validating',
          'restoring',
          'verifying',
          'resuming',
          'rolling_back',
          'recovery_required'
        )`,
      ),
    uniqueIndex("lifecycle_operations_id_snapshot_idx").on(
      table.id,
      table.snapshotId,
    ),
  ],
)

export const lifecycleOperationEvents = admin.table(
  "lifecycle_operation_events",
  {
    operationId: uuid("operation_id")
      .notNull()
      .references(() => lifecycleOperations.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    operationState: text("operation_state").notNull(),
    phase: text("phase").notNull(),
    component: text("component"),
    outcome: text("outcome").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    failureCode: text("failure_code"),
  },
  (table) => [
    primaryKey({
      columns: [table.operationId, table.sequence],
      name: "lifecycle_operation_events_pkey",
    }),
    check(
      "lifecycle_operation_events_sequence_check",
      sql`${table.sequence} >= 0`,
    ),
    check(
      "lifecycle_operation_events_state_check",
      sql`${table.operationState} IN (
        'prepared',
        'quiescing',
        'capturing',
        'validating',
        'restoring',
        'verifying',
        'resuming',
        'rolling_back',
        'succeeded',
        'rolled_back',
        'failed',
        'recovery_required'
      )`,
    ),
    check(
      "lifecycle_operation_events_phase_check",
      sql`${table.phase} IN (
        'operation',
        'quiesce',
        'capture',
        'validate',
        'restore',
        'verify',
        'resume',
        'rollback',
        'emergency_isolation_fence',
        'emergency_isolation_reassertion',
        'emergency_session_fence',
        'emergency_session_reset',
        'credential_consistency',
        'discard_preparation'
      )`,
    ),
    check(
      "lifecycle_operation_events_component_check",
      sql`${table.component} IS NULL OR ${table.component} IN (
        'console_database',
        'keycloak',
        'litellm',
        'grafana'
      )`,
    ),
    check(
      "lifecycle_operation_events_phase_component_check",
      sql`(
        ${table.phase} IN (
          'operation',
          'emergency_isolation_fence',
          'emergency_isolation_reassertion',
          'emergency_session_fence',
          'emergency_session_reset',
          'credential_consistency'
        )
        AND ${table.component} IS NULL
      ) OR (
        ${table.phase} IN (
          'quiesce',
          'capture',
          'validate',
          'restore',
          'verify',
          'resume',
          'rollback',
          'discard_preparation'
        )
        AND ${table.component} IS NOT NULL
      )`,
    ),
    check(
      "lifecycle_operation_events_phase_state_check",
      sql`(
        ${table.phase} = 'operation'
      ) OR (
        ${table.phase} = 'quiesce'
        AND ${table.operationState} IN ('quiescing', 'rolling_back')
      ) OR (
        ${table.phase} = 'capture'
        AND ${table.operationState} = 'capturing'
      ) OR (
        ${table.phase} = 'validate'
        AND ${table.operationState} = 'validating'
      ) OR (
        ${table.phase} = 'restore'
        AND ${table.operationState} = 'restoring'
      ) OR (
        ${table.phase} = 'verify'
        AND ${table.operationState} = 'verifying'
      ) OR (
        ${table.phase} = 'resume'
        AND ${table.operationState} = 'resuming'
      ) OR (
        ${table.phase} = 'rollback'
        AND ${table.operationState} = 'rolling_back'
      ) OR (
        ${table.phase} = 'emergency_isolation_fence'
        AND ${table.operationState} IN (
          'prepared',
          'quiescing',
          'resuming'
        )
      ) OR (
        ${table.phase} = 'emergency_isolation_reassertion'
        AND ${table.operationState} IN (
          'prepared',
          'validating',
          'quiescing',
          'restoring',
          'verifying',
          'rolling_back',
          'resuming',
          'recovery_required'
        )
      ) OR (
        ${table.phase} = 'emergency_session_fence'
        AND ${table.operationState} IN (
          'quiescing',
          'resuming',
          'rolling_back'
        )
      ) OR (
        ${table.phase} = 'emergency_session_reset'
        AND ${table.operationState} IN (
          'quiescing',
          'restoring',
          'resuming',
          'rolling_back'
        )
      ) OR (
        ${table.phase} = 'credential_consistency'
        AND ${table.operationState} = 'verifying'
      ) OR (
        ${table.phase} = 'discard_preparation'
        AND ${table.operationState} IN (
          'validating',
          'verifying',
          'rolling_back'
        )
      )`,
    ),
    check(
      "lifecycle_operation_events_outcome_check",
      sql`${table.outcome} IN ('started', 'succeeded', 'failed')`,
    ),
    check(
      "lifecycle_operation_events_failure_code_check",
      sql`${table.failureCode} IS NULL OR ${table.failureCode} IN (
        'adapter_unavailable',
        'quiesce_failed',
        'capture_failed',
        'manifest_invalid',
        'consistency_mismatch',
        'restore_failed',
        'verification_failed',
        'rollback_failed',
        'resume_failed',
        'journal_failed'
      )`,
    ),
    check(
      "lifecycle_operation_events_outcome_failure_check",
      sql`(
        ${table.outcome} = 'failed'
        AND ${table.failureCode} IS NOT NULL
      ) OR (
        ${table.outcome} IN ('started', 'succeeded')
        AND ${table.failureCode} IS NULL
      )`,
    ),
  ],
)

export const lifecycleSnapshotManifests = admin.table(
  "lifecycle_snapshot_manifests",
  {
    snapshotId: uuid("snapshot_id").primaryKey(),
    operationId: uuid("operation_id").notNull().unique(),
    schemaVersion: integer("schema_version").default(1).notNull(),
    manifestSha256: text("manifest_sha256").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    contentFree: boolean("content_free").default(true).notNull(),
    workloadContentIncluded: boolean("workload_content_included")
      .default(false)
      .notNull(),
    plaintextSecretsIncluded: boolean("plaintext_secrets_included")
      .default(false)
      .notNull(),
    emergencySessionsIncluded: boolean("emergency_sessions_included")
      .default(false)
      .notNull(),
    componentCount: integer("component_count").default(4).notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.operationId, table.snapshotId],
      foreignColumns: [lifecycleOperations.id, lifecycleOperations.snapshotId],
      name: "lifecycle_snapshot_manifests_operation_snapshot_fkey",
    }).onDelete("restrict"),
    check(
      "lifecycle_snapshot_manifests_schema_version_check",
      sql`${table.schemaVersion} = 1`,
    ),
    check(
      "lifecycle_snapshot_manifests_hash_check",
      sql`${table.manifestSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "lifecycle_snapshot_manifests_content_boundary_check",
      sql`${table.contentFree} = true
        AND ${table.workloadContentIncluded} = false
        AND ${table.plaintextSecretsIncluded} = false
        AND ${table.emergencySessionsIncluded} = false`,
    ),
    check(
      "lifecycle_snapshot_manifests_component_count_check",
      sql`${table.componentCount} = 4`,
    ),
  ],
)

export const lifecycleSnapshotComponents = admin.table(
  "lifecycle_snapshot_components",
  {
    snapshotId: uuid("snapshot_id")
      .notNull()
      .references(() => lifecycleSnapshotManifests.snapshotId, {
        onDelete: "cascade",
      }),
    component: text("component").notNull(),
    ordinal: integer("ordinal").notNull(),
    revision: text("revision").notNull(),
    artifactSha256: text("artifact_sha256").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.snapshotId, table.component],
      name: "lifecycle_snapshot_components_pkey",
    }),
    check(
      "lifecycle_snapshot_components_mapping_check",
      sql`(
        ${table.component} = 'console_database'
        AND ${table.ordinal} = 0
      ) OR (
        ${table.component} = 'keycloak'
        AND ${table.ordinal} = 1
      ) OR (
        ${table.component} = 'litellm'
        AND ${table.ordinal} = 2
      ) OR (
        ${table.component} = 'grafana'
        AND ${table.ordinal} = 3
      )`,
    ),
    check(
      "lifecycle_snapshot_components_revision_check",
      sql`${table.revision} ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$'`,
    ),
    check(
      "lifecycle_snapshot_components_hash_check",
      sql`${table.artifactSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    uniqueIndex("lifecycle_snapshot_components_snapshot_ordinal_idx").on(
      table.snapshotId,
      table.ordinal,
    ),
  ],
)
