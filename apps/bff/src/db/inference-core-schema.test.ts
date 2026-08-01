import { readFileSync, readdirSync } from "node:fs"
import { type SQL, getTableColumns, getTableName } from "drizzle-orm"
import { PgDialect, getTableConfig } from "drizzle-orm/pg-core"
import { describe, expect, it } from "vitest"
import {
  applicationCredentials,
  applicationFirecrawlAccess,
  applicationFirecrawlCredentials,
  applicationFirecrawlRateLimitWindows,
  applicationFirecrawlRequestLedger,
  applicationFirecrawlUsageDaily,
  applicationLimits,
  applicationModelAllowlists,
  applicationRateLimitWindows,
  applicationRequestLedger,
  applicationUsageDaily,
  applications,
  auditEvents,
  auditSourceCursors,
  backupState,
  consoleSettings,
  emergencyRecoveryFactor,
  emergencyRecoverySessions,
  humanIdentities,
  humanIdentityRoles,
  idempotencyLedger,
  identityMutationJournal,
  identityMutationJournalTargets,
  licenseState,
  lifecycleOperationEvents,
  lifecycleOperations,
  lifecycleSnapshotComponents,
  lifecycleSnapshotManifests,
  recoveryState,
  updateState,
} from "./inference-core-schema"

const tableDefinitions = [
  {
    schema: "common",
    table: humanIdentities,
    columns: ["subject_id", "first_seen_at", "last_seen_at"],
  },
  {
    schema: "common",
    table: humanIdentityRoles,
    columns: ["subject_id", "role", "observed_at"],
  },
  {
    schema: "common",
    table: auditEvents,
    columns: [
      "id",
      "occurred_at",
      "ingested_at",
      "action",
      "outcome",
      "source_system",
      "correlation_id",
      "keycloak_subject_id",
      "application_id",
      "credential_record_id",
      "credential_prefix",
      "recovery_reason_code",
    ],
  },
  {
    schema: "common",
    table: auditSourceCursors,
    columns: [
      "source_system",
      "cursor_version",
      "cursor_watermark",
      "cursor_tie_breaker",
      "last_attempt_at",
      "last_success_at",
      "last_event_occurred_at",
      "last_error_code",
      "updated_at",
    ],
  },
  {
    schema: "admin",
    table: applications,
    columns: [
      "id",
      "name",
      "description",
      "auth_mode",
      "status",
      "connection_status",
      "last_connected_at",
      "created_by",
      "updated_by",
      "created_at",
      "updated_at",
    ],
  },
  {
    schema: "admin",
    table: applicationCredentials,
    columns: [
      "id",
      "app_id",
      "kind",
      "client_identifier",
      "external_credential_id",
      "key_prefix",
      "verifier_hash",
      "status",
      "issued_at",
      "last_used_at",
      "rotated_at",
      "overlap_expires_at",
      "revoked_at",
    ],
  },
  {
    schema: "admin",
    table: applicationFirecrawlAccess,
    columns: [
      "app_id",
      "status",
      "disclaimer_version",
      "disclaimer_accepted_by",
      "disclaimer_accepted_at",
      "connection_status",
      "last_connected_at",
      "search_rate_limit_rps",
      "scrape_rate_limit_rps",
      "max_concurrent_scrapes",
      "updated_by",
      "updated_at",
    ],
  },
  {
    schema: "admin",
    table: applicationFirecrawlCredentials,
    columns: [
      "id",
      "app_id",
      "key_prefix",
      "verifier_hash",
      "status",
      "issued_at",
      "last_used_at",
      "rotated_at",
      "overlap_expires_at",
      "revoked_at",
    ],
  },
  {
    schema: "admin",
    table: applicationFirecrawlRateLimitWindows,
    columns: [
      "app_id",
      "route_kind",
      "window_started_at",
      "request_count",
      "expires_at",
    ],
  },
  {
    schema: "admin",
    table: applicationFirecrawlRequestLedger,
    columns: [
      "id",
      "app_id",
      "credential_id",
      "route_kind",
      "state",
      "status_code",
      "latency_ms",
      "started_at",
      "lease_expires_at",
      "settled_at",
    ],
  },
  {
    schema: "admin",
    table: applicationFirecrawlUsageDaily,
    columns: [
      "app_id",
      "credential_id",
      "bucket_date",
      "route_kind",
      "request_count",
      "failure_count",
      "latency_ms_sum",
      "latency_ms_max",
      "updated_at",
    ],
  },
  {
    schema: "admin",
    table: applicationModelAllowlists,
    columns: ["app_id", "model_alias", "created_at"],
  },
  {
    schema: "admin",
    table: applicationLimits,
    columns: [
      "app_id",
      "requests_per_second",
      "token_alert_threshold_7d",
      "max_concurrent_requests",
      "max_context_bytes",
      "updated_at",
    ],
  },
  {
    schema: "admin",
    table: applicationRateLimitWindows,
    columns: ["app_id", "window_started_at", "request_count", "expires_at"],
  },
  {
    schema: "admin",
    table: applicationRequestLedger,
    columns: [
      "id",
      "app_id",
      "credential_id",
      "route_kind",
      "model_alias",
      "context_bytes",
      "state",
      "status_code",
      "input_tokens",
      "output_tokens",
      "total_tokens",
      "latency_ms",
      "started_at",
      "lease_expires_at",
      "settled_at",
    ],
  },
  {
    schema: "admin",
    table: applicationUsageDaily,
    columns: [
      "app_id",
      "credential_id",
      "bucket_date",
      "route_kind",
      "model_alias",
      "request_count",
      "failure_count",
      "input_tokens",
      "output_tokens",
      "total_tokens",
      "latency_ms_sum",
      "latency_ms_max",
      "updated_at",
    ],
  },
  {
    schema: "admin",
    table: idempotencyLedger,
    columns: [
      "id",
      "keycloak_subject_id",
      "operation_code",
      "idempotency_key_digest",
      "request_fingerprint",
      "state",
      "outcome",
      "resource_id",
      "correlation_id",
      "status_code",
      "expires_at",
      "created_at",
      "updated_at",
    ],
  },
  {
    schema: "admin",
    table: identityMutationJournal,
    columns: [
      "id",
      "idempotency_ledger_id",
      "keycloak_subject_id",
      "operation_code",
      "request_fingerprint",
      "target_type",
      "target_identifier",
      "state",
      "resource_id",
      "reconciliation_reason",
      "keycloak_applied_at",
      "reconciliation_required_at",
      "completed_at",
      "created_at",
      "updated_at",
    ],
  },
  {
    schema: "admin",
    table: identityMutationJournalTargets,
    columns: [
      "id",
      "journal_id",
      "ordinal",
      "target_type",
      "target_identifier",
      "intent",
      "state",
      "resource_id",
      "started_at",
      "completed_at",
      "created_at",
      "updated_at",
    ],
  },
  {
    schema: "admin",
    table: consoleSettings,
    columns: [
      "id",
      "organization_name",
      "default_language",
      "full_logo",
      "icon_logo",
      "telemetry_enabled",
      "telemetry_payload_preview",
      "privacy_policy_href",
      "data_residency_statement",
      "alert_delivery_mode",
      "alert_delivery_transport",
      "alert_egress_warning_version",
      "alert_egress_revision",
      "alert_egress_acknowledged_at",
      "alert_egress_acknowledged_by",
      "alert_egress_updated_by",
      "alert_egress_updated_at",
      "updated_by",
      "updated_at",
    ],
  },
  {
    schema: "admin",
    table: licenseState,
    columns: [
      "id",
      "source_status",
      "subscription_state",
      "support_state",
      "appliance_id",
      "certificate_expires_at",
      "last_entitlement_check_at",
      "offline_mode",
      "telemetry_opt_in",
      "allowed_update_channels",
      "updated_at",
    ],
  },
  {
    schema: "admin",
    table: updateState,
    columns: [
      "id",
      "status",
      "current_version",
      "available_version",
      "bundle_id",
      "bundle_digest",
      "rollback_snapshot_id",
      "last_checked_at",
      "last_applied_at",
      "updated_by",
      "updated_at",
    ],
  },
  {
    schema: "admin",
    table: backupState,
    columns: [
      "id",
      "status",
      "last_backup_id",
      "last_backup_digest",
      "last_backup_started_at",
      "last_backup_completed_at",
      "last_backup_verified_at",
      "encrypted",
      "content_free",
      "updated_by",
      "updated_at",
    ],
  },
  {
    schema: "admin",
    table: emergencyRecoveryFactor,
    columns: [
      "id",
      "algorithm",
      "verifier_hash",
      "salt",
      "cost",
      "block_size",
      "parallelization",
      "key_length",
      "max_memory",
      "commissioned_by",
      "commissioned_at",
    ],
  },
  {
    schema: "admin",
    table: emergencyRecoverySessions,
    columns: [
      "id",
      "keycloak_subject_id",
      "reason_code",
      "status",
      "activated_at",
      "expires_at",
      "revoked_at",
      "revoked_by",
      "correlation_id",
    ],
  },
  {
    schema: "admin",
    table: recoveryState,
    columns: [
      "id",
      "status",
      "source_backup_id",
      "last_restore_id",
      "last_restore_started_at",
      "last_restore_completed_at",
      "last_recovery_check_at",
      "credential_rotation_required",
      "updated_by",
      "updated_at",
    ],
  },
  {
    schema: "admin",
    table: lifecycleOperations,
    columns: [
      "id",
      "kind",
      "state",
      "actor_subject_id",
      "correlation_id",
      "snapshot_id",
      "failure_code",
      "created_at",
      "updated_at",
      "completed_at",
    ],
  },
  {
    schema: "admin",
    table: lifecycleOperationEvents,
    columns: [
      "operation_id",
      "sequence",
      "operation_state",
      "phase",
      "component",
      "outcome",
      "occurred_at",
      "failure_code",
    ],
  },
  {
    schema: "admin",
    table: lifecycleSnapshotManifests,
    columns: [
      "snapshot_id",
      "operation_id",
      "schema_version",
      "manifest_sha256",
      "captured_at",
      "content_free",
      "workload_content_included",
      "plaintext_secrets_included",
      "emergency_sessions_included",
      "component_count",
    ],
  },
  {
    schema: "admin",
    table: lifecycleSnapshotComponents,
    columns: [
      "snapshot_id",
      "component",
      "ordinal",
      "revision",
      "artifact_sha256",
    ],
  },
] as const

const expectedIndexes = [
  "audit_events_occurred_at_idx",
  "audit_events_stable_order_idx",
  "audit_events_correlation_id_idx",
  "audit_events_application_occurred_idx",
  "audit_source_cursors_health_idx",
  "applications_id_auth_mode_idx",
  "applications_status_updated_idx",
  "application_credentials_id_app_idx",
  "application_credentials_verifier_hash_idx",
  "application_credentials_client_identifier_idx",
  "application_credentials_external_id_idx",
  "application_credentials_one_active_idx",
  "application_credentials_one_retiring_idx",
  "application_credentials_prefix_status_idx",
  "application_credentials_app_status_idx",
  "application_firecrawl_access_status_updated_idx",
  "application_firecrawl_credentials_id_app_idx",
  "application_firecrawl_credentials_verifier_hash_idx",
  "application_firecrawl_credentials_one_active_idx",
  "application_firecrawl_credentials_one_retiring_idx",
  "application_firecrawl_credentials_prefix_status_idx",
  "application_firecrawl_credentials_app_status_idx",
  "application_firecrawl_rate_limit_windows_expiry_idx",
  "application_firecrawl_request_ledger_active_idx",
  "application_firecrawl_request_ledger_settled_started_idx",
  "application_firecrawl_usage_daily_bucket_idx",
  "application_firecrawl_usage_daily_app_bucket_idx",
  "application_rate_limit_windows_expiry_idx",
  "application_request_ledger_active_idx",
  "application_request_ledger_settled_started_idx",
  "application_usage_daily_bucket_idx",
  "application_usage_daily_app_bucket_idx",
  "idempotency_ledger_identity_key_idx",
  "idempotency_ledger_expiry_idx",
  "identity_mutation_journal_state_updated_idx",
  "identity_mutation_journal_one_unresolved_idx",
  "identity_mutation_journal_targets_ordinal_idx",
  "identity_mutation_journal_targets_identifier_idx",
  "identity_mutation_journal_targets_state_idx",
  "emergency_recovery_sessions_one_active_idx",
  "emergency_recovery_sessions_expiry_idx",
  "lifecycle_operations_one_active_idx",
  "lifecycle_operations_id_snapshot_idx",
  "lifecycle_snapshot_components_snapshot_ordinal_idx",
]

const migrationDirectory = new URL(
  "../../../../infra/migrations/",
  import.meta.url,
)
const migration = readFileSync(
  new URL("0000_inference_core.sql", migrationDirectory),
  "utf8",
)
const schemaSource = source("inference-core-schema.ts")
const dialect = new PgDialect()

type RetainedTable = (typeof tableDefinitions)[number]["table"]

describe("inference-core persistence boundary", () => {
  it("exports exactly the retained PostgreSQL tables", () => {
    expect(tableDefinitions.map(({ table }) => getTableName(table))).toEqual([
      "human_identities",
      "human_identity_roles",
      "audit_events",
      "audit_source_cursors",
      "applications",
      "application_credentials",
      "application_firecrawl_access",
      "application_firecrawl_credentials",
      "application_firecrawl_rate_limit_windows",
      "application_firecrawl_request_ledger",
      "application_firecrawl_usage_daily",
      "application_model_allowlists",
      "application_limits",
      "application_rate_limit_windows",
      "application_request_ledger",
      "application_usage_daily",
      "idempotency_ledger",
      "identity_mutation_journal",
      "identity_mutation_journal_targets",
      "console_settings",
      "license_state",
      "update_state",
      "backup_state",
      "emergency_recovery_factor",
      "emergency_recovery_sessions",
      "recovery_state",
      "lifecycle_operations",
      "lifecycle_operation_events",
      "lifecycle_snapshot_manifests",
      "lifecycle_snapshot_components",
    ])

    expect(
      [
        ...schemaSource.matchAll(
          /export const (\w+) = (?:common|admin)\.table\(/g,
        ),
      ].map((match) => match[1]),
    ).toEqual([
      "humanIdentities",
      "humanIdentityRoles",
      "auditEvents",
      "auditSourceCursors",
      "applications",
      "applicationCredentials",
      "applicationFirecrawlAccess",
      "applicationFirecrawlCredentials",
      "applicationFirecrawlRateLimitWindows",
      "applicationFirecrawlRequestLedger",
      "applicationFirecrawlUsageDaily",
      "applicationModelAllowlists",
      "applicationLimits",
      "applicationRateLimitWindows",
      "applicationRequestLedger",
      "applicationUsageDaily",
      "idempotencyLedger",
      "identityMutationJournal",
      "identityMutationJournalTargets",
      "consoleSettings",
      "licenseState",
      "updateState",
      "backupState",
      "emergencyRecoveryFactor",
      "emergencyRecoverySessions",
      "recoveryState",
      "lifecycleOperations",
      "lifecycleOperationEvents",
      "lifecycleSnapshotManifests",
      "lifecycleSnapshotComponents",
    ])
  })

  it("has one transactional baseline with only common and admin schemas", () => {
    expect(
      readdirSync(migrationDirectory)
        .filter((fileName) => fileName.endsWith(".sql"))
        .sort(),
    ).toEqual(["0000_inference_core.sql"])
    expect(migration.trimStart().startsWith("BEGIN;")).toBe(true)
    expect(migration.trimEnd().endsWith("COMMIT;")).toBe(true)
    expect(
      [...migration.matchAll(/^CREATE SCHEMA ([a-z_]+);$/gm)].map(
        (match) => match[1],
      ),
    ).toEqual(["common", "admin"])
    const createTableStatements = [
      ...migration.matchAll(/^CREATE TABLE ([a-z_]+)\.([a-z_]+) \($/gm),
    ].map((match) => `${match[1]}.${match[2]}`)
    expect(createTableStatements).toEqual(
      tableDefinitions.map(
        ({ schema, table }) => `${schema}.${getTableName(table)}`,
      ),
    )
    expect(migration.match(/^CREATE TABLE\b/gm)).toHaveLength(
      tableDefinitions.length,
    )
  })

  it("keeps Drizzle and baseline columns, types, nullability, and defaults in parity", () => {
    for (const definition of tableDefinitions) {
      const drizzleColumns = Object.values(
        getTableColumns(definition.table),
      ).map((column) => column.name)
      const sqlColumns = migrationColumns(
        definition.schema,
        getTableName(definition.table),
      )

      expect(drizzleColumns).toEqual(definition.columns)
      expect(sqlColumns).toEqual(definition.columns)
      expect(new Set(sqlColumns).size).toBe(sqlColumns.length)
      expect(drizzleColumnDefinitions(definition.table)).toEqual(
        migrationColumnDefinitions(
          definition.schema,
          getTableName(definition.table),
        ),
      )
    }
  })

  it("keeps primary keys, foreign keys, checks, and indexes in parity", () => {
    for (const definition of tableDefinitions) {
      const tableName = getTableName(definition.table)
      const config = getTableConfig(definition.table)

      expect(
        config.primaryKeys.map((primaryKey) => ({
          columns: primaryKey.columns.map((column) => column.name),
          name: primaryKey.getName(),
        })),
      ).toEqual(migrationCompositePrimaryKeys(definition.schema, tableName))
      expect(drizzleForeignKeys(definition.table)).toEqual(
        migrationForeignKeys(definition.schema, tableName),
      )
      expect(config.checks.map((constraint) => constraint.name)).toEqual(
        migrationCheckNames(definition.schema, tableName),
      )

      const normalizedMigration = normalizeSql(migration)
      for (const constraint of config.checks) {
        expect(normalizedMigration).toContain(
          normalizeSql(dialect.sqlToQuery(constraint.value).sql),
        )
      }
    }

    expect(drizzleIndexes()).toEqual(migrationIndexes())
    expect(
      [...migration.matchAll(/^CREATE (?:UNIQUE )?INDEX ([a-z_]+)$/gm)].map(
        (match) => match[1],
      ),
    ).toEqual(expectedIndexes)

    for (const indexName of expectedIndexes) {
      expect(schemaSource).toContain(`"${indexName}"`)
    }
  })

  it("seeds only the retained singleton state rows", () => {
    expect(
      [
        ...migration.matchAll(
          /^INSERT INTO admin\.([a-z_]+) \(id\) VALUES \('singleton'\);$/gm,
        ),
      ].map((match) => match[1]),
    ).toEqual([
      "console_settings",
      "license_state",
      "update_state",
      "backup_state",
      "recovery_state",
    ])
  })

  it("enforces subject identity, restricted credentials, and metadata-only idempotency", () => {
    expect(migration).toContain("subject_id text PRIMARY KEY")
    expect(migration).toContain(
      "app_id text NOT NULL REFERENCES admin.applications(id) ON DELETE RESTRICT",
    )
    expect(migration).toContain("idempotency_key_digest text NOT NULL")
    expect(migration).toContain(
      "CHECK (char_length(idempotency_key_digest) = 64)",
    )
    expect(migration).toContain(
      "CHECK (num_nonnulls(credential_record_id, credential_prefix) <= 1)",
    )
    expect(migration).toContain(
      "CHECK (target_type IN ('user', 'group', 'oauth_client'))",
    )
    const credentialTable = migration.slice(
      migration.indexOf("CREATE TABLE admin.application_credentials"),
      migration.indexOf("CREATE TABLE admin.application_model_allowlists"),
    )
    expect(credentialTable).not.toMatch(
      /\b(?:api_key_plaintext|client_secret|raw_key|secret_value)\b/i,
    )
    const requestLedgerTable = migration.slice(
      migration.indexOf("CREATE TABLE admin.application_request_ledger"),
      migration.indexOf("CREATE TABLE admin.application_usage_daily"),
    )
    expect(requestLedgerTable).not.toMatch(
      /\b(?:correlation_id|prompt|request_body|response_body|tool_call|tool_result)\b/i,
    )
    const firecrawlTables = migration.slice(
      migration.indexOf("CREATE TABLE admin.application_firecrawl_access"),
      migration.indexOf("CREATE TABLE admin.application_model_allowlists"),
    )
    expect(firecrawlTables).not.toMatch(
      /\b(?:query|url|page|request_body|response_body|result_content|secret)\b/i,
    )
    const firecrawlCredentialTable = migration.slice(
      migration.indexOf("CREATE TABLE admin.application_firecrawl_credentials"),
      migration.indexOf(
        "CREATE TABLE admin.application_firecrawl_rate_limit_windows",
      ),
    )
    expect(firecrawlCredentialTable).not.toMatch(/^ {2}expires_at\b/m)
    expect(firecrawlCredentialTable).toContain(
      "overlap_expires_at = rotated_at + interval '86400 seconds'",
    )
    expect(
      getTableColumns(lifecycleSnapshotManifests).operationId.isUnique,
    ).toBe(true)
    expect(
      migrationDefinition("admin", "lifecycle_snapshot_manifests"),
    ).toContain("operation_id uuid NOT NULL UNIQUE")
    for (const phase of ["emergency_session_fence", "discard_preparation"]) {
      expect(schemaSource).toContain(`'${phase}'`)
      expect(migration).toContain(`'${phase}'`)
    }
    expect(schemaSource).toContain(
      '"lifecycle_operation_events_phase_state_check"',
    )
    expect(migration).toContain(
      "CONSTRAINT lifecycle_operation_events_phase_state_check",
    )
  })

  it("contains no extension or retired product storage", () => {
    const persistenceSource = `${schemaSource}\n${migration}`

    expect(persistenceSource).not.toMatch(/\bCREATE\s+EXTENSION\b/i)
    expect(persistenceSource).not.toMatch(
      /\b(?:builder|hub|knowledge|knowledge_archive|mcp|vector|pgvector|agentic|owner_group|environments|environment|usage_summary|request_body|response_body)\b/i,
    )
  })
})

function migrationColumns(schema: string, table: string): string[] {
  return migrationColumnDefinitions(schema, table).map(({ name }) => name)
}

function drizzleColumnDefinitions(table: RetainedTable) {
  return getTableConfig(table).columns.map((column) => ({
    hasDefault: column.hasDefault,
    name: column.name,
    notNull: column.notNull,
    primary: column.primary,
    type: normalizeColumnType(column.getSQLType()),
  }))
}

function migrationColumnDefinitions(schema: string, table: string) {
  return migrationDefinition(schema, table)
    .split("\n")
    .flatMap((line) => {
      const match = line.match(
        /^ {2}([a-z][a-z0-9_]*) (text|uuid|timestamptz|integer|bigint|date|jsonb|boolean)\b(.*)$/,
      )
      if (!match) {
        return []
      }

      const suffix = match[3]
      const primary = /\bPRIMARY KEY\b/.test(suffix)
      return [
        {
          hasDefault: /\bDEFAULT\b/.test(suffix),
          name: match[1],
          notNull: primary || /\bNOT NULL\b/.test(suffix),
          primary,
          type: match[2],
        },
      ]
    })
}

function migrationCompositePrimaryKeys(schema: string, table: string) {
  return [
    ...migrationDefinition(schema, table).matchAll(
      /CONSTRAINT ([a-z_]+)\s+PRIMARY KEY \(([^)]+)\)/g,
    ),
  ].map((match) => ({
    columns: match[2].split(",").map((column) => column.trim()),
    name: match[1],
  }))
}

function drizzleForeignKeys(table: RetainedTable) {
  return getTableConfig(table).foreignKeys.map((foreignKey) => {
    const reference = foreignKey.reference()
    const foreignTable = getTableConfig(reference.foreignTable)
    return {
      columns: reference.columns.map((column) => column.name),
      foreignColumns: reference.foreignColumns.map((column) => column.name),
      foreignSchema: foreignTable.schema,
      foreignTable: foreignTable.name,
      onDelete: foreignKey.onDelete,
    }
  })
}

function migrationForeignKeys(schema: string, table: string) {
  const inlineForeignKeys = [
    ...migrationDefinition(schema, table).matchAll(
      /^ {2}([a-z_]+) [^\n]* REFERENCES ([a-z_]+)\.([a-z_]+)\(([a-z_]+)\) ON DELETE (RESTRICT|CASCADE)/gm,
    ),
  ].map((match) => ({
    columns: [match[1]],
    foreignColumns: [match[4]],
    foreignSchema: match[2],
    foreignTable: match[3],
    onDelete: match[5].toLowerCase(),
  }))

  const compositeForeignKeys = [
    ...migrationDefinition(schema, table).matchAll(
      /CONSTRAINT [a-z_]+\s+FOREIGN KEY \(([^)]+)\)\s+REFERENCES ([a-z_]+)\.([a-z_]+)\(([^)]+)\)\s+ON DELETE (RESTRICT|CASCADE)/g,
    ),
  ].map((match) => ({
    columns: match[1].split(",").map((column) => column.trim()),
    foreignColumns: match[4].split(",").map((column) => column.trim()),
    foreignSchema: match[2],
    foreignTable: match[3],
    onDelete: match[5].toLowerCase(),
  }))

  return [...inlineForeignKeys, ...compositeForeignKeys]
}

function migrationCheckNames(schema: string, table: string): string[] {
  return [
    ...migrationDefinition(schema, table).matchAll(
      /CONSTRAINT ([a-z_]+)\s+CHECK \(/g,
    ),
  ].map((match) => match[1])
}

function drizzleIndexes() {
  return tableDefinitions.flatMap(({ schema, table }) =>
    getTableConfig(table).indexes.map((index) => ({
      columns: index.config.columns.map(drizzleIndexColumn),
      name: index.config.name,
      predicate: index.config.where
        ? normalizeSql(dialect.sqlToQuery(index.config.where).sql)
        : null,
      schema,
      table: getTableName(table),
      unique: index.config.unique,
    })),
  )
}

function migrationIndexes() {
  return [
    ...migration.matchAll(
      /^CREATE (UNIQUE )?INDEX ([a-z_]+)\n {2}ON ([a-z_]+)\.([a-z_]+) \(((?:\([^()]*\)|[^)])+)\)(?:\n {2}WHERE ([^;]+))?;/gm,
    ),
  ].map((match) => ({
    columns: match[5]
      .split(",")
      .map((column) => column.trim().replace(/\s+/g, " ")),
    name: match[2],
    predicate: match[6] ? normalizeSql(match[6]) : null,
    schema: match[3],
    table: match[4],
    unique: Boolean(match[1]),
  }))
}

function drizzleIndexColumn(column: unknown): string {
  const name = (column as { name?: unknown }).name
  return typeof name === "string"
    ? name
    : normalizeSql(dialect.sqlToQuery(column as SQL).sql)
}

function migrationDefinition(schema: string, table: string): string {
  const definition = migration.match(
    new RegExp(`CREATE TABLE ${schema}\\.${table} \\(\\n([\\s\\S]*?)\\n\\);`),
  )?.[1]

  expect(definition, `${schema}.${table} migration definition`).toBeDefined()
  return definition ?? ""
}

function normalizeColumnType(type: string): string {
  return type === "timestamp with time zone" ? "timestamptz" : type
}

function normalizeSql(value: string): string {
  return value
    .replace(/"[a-z0-9_]+"\."[a-z0-9_]+"\."([a-z0-9_]+)"/gi, "$1")
    .replace(/"/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*([(),])\s*/g, "$1")
    .trim()
    .toLowerCase()
}

function source(fileName: string): string {
  return readFileSync(new URL(fileName, import.meta.url), "utf8")
}
