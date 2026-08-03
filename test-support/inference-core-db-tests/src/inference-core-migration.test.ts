import { readFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { describe, expect, it } from "vitest"
import { checkInferenceCoreDbReadiness } from "../../../apps/bff/src/db/inference-core-client"
import * as schema from "../../../apps/bff/src/db/inference-core-schema"

const migrationDirectory = fileURLToPath(
  new URL("../../../infra/migrations/", import.meta.url),
)
const migrationPath = `${migrationDirectory}/0000_inference_core.sql`

describe("Inference Core empty-install migration", () => {
  it("applies the only active migration to an empty PostgreSQL database", async () => {
    expect(readdirSync(migrationDirectory).sort()).toEqual([
      "0000_inference_core.sql",
    ])

    const migration = readFileSync(migrationPath, "utf8")
    const database = await PGlite.create()

    try {
      await database.exec(migration)

      const tables = await database.query<{
        table_name: string
        table_schema: string
      }>(`
        SELECT table_schema, table_name
        FROM information_schema.tables
        WHERE table_schema IN ('admin', 'common')
          AND table_type = 'BASE TABLE'
        ORDER BY table_schema, table_name
      `)

      expect(
        tables.rows.map(
          ({ table_schema, table_name }) => `${table_schema}.${table_name}`,
        ),
      ).toEqual([
        "admin.application_credentials",
        "admin.application_firecrawl_access",
        "admin.application_firecrawl_credentials",
        "admin.application_firecrawl_rate_limit_windows",
        "admin.application_firecrawl_request_ledger",
        "admin.application_firecrawl_usage_daily",
        "admin.application_limits",
        "admin.application_model_allowlists",
        "admin.application_rate_limit_windows",
        "admin.application_request_ledger",
        "admin.application_usage_daily",
        "admin.applications",
        "admin.backup_state",
        "admin.console_settings",
        "admin.emergency_isolation_state",
        "admin.emergency_recovery_factor",
        "admin.emergency_recovery_sessions",
        "admin.idempotency_ledger",
        "admin.identity_mutation_journal",
        "admin.identity_mutation_journal_targets",
        "admin.license_state",
        "admin.lifecycle_operation_events",
        "admin.lifecycle_operations",
        "admin.lifecycle_snapshot_components",
        "admin.lifecycle_snapshot_manifests",
        "admin.recovery_state",
        "admin.update_state",
        "common.audit_events",
        "common.audit_source_cursors",
        "common.console_login_transactions",
        "common.console_logout_token_replays",
        "common.console_sessions",
        "common.human_identities",
        "common.human_identity_roles",
      ])

      const extensions = await database.query<{ extname: string }>(`
        SELECT extname
        FROM pg_extension
        WHERE extname IN ('vector', 'pg_trgm')
      `)
      expect(extensions.rows).toEqual([])

      const auditColumns = await tableColumns(
        database,
        "common",
        "audit_events",
      )
      expect(auditColumns).toEqual([
        "action",
        "application_id",
        "correlation_id",
        "credential_prefix",
        "credential_record_id",
        "id",
        "ingested_at",
        "keycloak_subject_id",
        "occurred_at",
        "outcome",
        "recovery_reason_code",
        "source_system",
      ])
      expect(auditColumns).not.toEqual(
        expect.arrayContaining([
          "actor_id",
          "metadata",
          "reason",
          "source_event_id",
          "target_id",
          "target_type",
        ]),
      )

      expect(
        await tableColumns(database, "common", "audit_source_cursors"),
      ).toEqual([
        "cursor_tie_breaker",
        "cursor_version",
        "cursor_watermark",
        "last_attempt_at",
        "last_error_code",
        "last_event_occurred_at",
        "last_success_at",
        "source_system",
        "updated_at",
      ])

      expect(
        await tableColumns(database, "common", "console_login_transactions"),
      ).toEqual([
        "created_at",
        "encrypted_payload",
        "encryption_kid",
        "expires_at",
        "handle_digest",
        "state_digest",
        "subject_digest",
      ])
      expect(
        await tableColumns(database, "common", "console_sessions"),
      ).toEqual([
        "absolute_expires_at",
        "access_expires_at",
        "created_at",
        "encrypted_payload",
        "encryption_kid",
        "handle_digest",
        "idle_expires_at",
        "keycloak_session_digest",
        "last_seen_at",
        "refresh_blocked_until",
        "refresh_failure_reason",
        "refresh_generation",
        "subject_digest",
        "updated_at",
      ])
      expect(
        await tableColumns(database, "common", "console_logout_token_replays"),
      ).toEqual(["consumed_at", "jti_digest", "retain_until"])

      expect(await tableColumns(database, "admin", "applications")).toEqual([
        "auth_mode",
        "connection_status",
        "created_at",
        "created_by",
        "description",
        "id",
        "last_connected_at",
        "name",
        "status",
        "updated_at",
        "updated_by",
      ])
      expect(
        await tableColumns(database, "admin", "application_credentials"),
      ).toEqual([
        "app_id",
        "client_identifier",
        "external_credential_id",
        "id",
        "issued_at",
        "key_prefix",
        "kind",
        "last_used_at",
        "overlap_expires_at",
        "revoked_at",
        "rotated_at",
        "status",
        "verifier_hash",
      ])
      expect(await tableColumns(database, "admin", "console_settings")).toEqual(
        [
          "alert_delivery_mode",
          "alert_delivery_transport",
          "alert_egress_acknowledged_at",
          "alert_egress_acknowledged_by",
          "alert_egress_revision",
          "alert_egress_updated_at",
          "alert_egress_updated_by",
          "alert_egress_warning_version",
          "data_residency_statement",
          "default_language",
          "full_logo",
          "icon_logo",
          "id",
          "organization_name",
          "privacy_policy_href",
          "telemetry_enabled",
          "telemetry_payload_preview",
          "updated_at",
          "updated_by",
        ],
      )
      expect(
        await tableColumns(database, "admin", "application_firecrawl_access"),
      ).toEqual([
        "app_id",
        "connection_status",
        "disclaimer_accepted_at",
        "disclaimer_accepted_by",
        "disclaimer_version",
        "last_connected_at",
        "max_concurrent_scrapes",
        "scrape_rate_limit_rps",
        "search_rate_limit_rps",
        "status",
        "updated_at",
        "updated_by",
      ])
      expect(
        await tableColumns(
          database,
          "admin",
          "application_firecrawl_credentials",
        ),
      ).toEqual([
        "app_id",
        "id",
        "issued_at",
        "key_prefix",
        "last_used_at",
        "overlap_expires_at",
        "revoked_at",
        "rotated_at",
        "status",
        "verifier_hash",
      ])

      const firecrawlTables = [
        "application_firecrawl_access",
        "application_firecrawl_credentials",
        "application_firecrawl_rate_limit_windows",
        "application_firecrawl_request_ledger",
        "application_firecrawl_usage_daily",
      ]
      const forbiddenFirecrawlColumns = new Set([
        "body",
        "page",
        "query",
        "request_body",
        "response_body",
        "result_content",
        "secret",
        "url",
      ])
      for (const table of firecrawlTables) {
        expect(
          (await tableColumns(database, "admin", table)).filter((column) =>
            forbiddenFirecrawlColumns.has(column),
          ),
        ).toEqual([])
      }

      const idempotencyColumns = await tableColumns(
        database,
        "admin",
        "idempotency_ledger",
      )
      expect(idempotencyColumns).toEqual([
        "correlation_id",
        "created_at",
        "expires_at",
        "id",
        "idempotency_key_digest",
        "keycloak_subject_id",
        "operation_code",
        "outcome",
        "request_fingerprint",
        "resource_id",
        "state",
        "status_code",
        "updated_at",
      ])
      expect(idempotencyColumns).not.toEqual(
        expect.arrayContaining([
          "idempotency_key",
          "request_body",
          "response_body",
          "response_payload",
        ]),
      )

      expect(
        await tableColumns(database, "admin", "lifecycle_operations"),
      ).toEqual([
        "actor_subject_id",
        "completed_at",
        "correlation_id",
        "created_at",
        "failure_code",
        "id",
        "kind",
        "snapshot_id",
        "state",
        "updated_at",
      ])
      expect(
        await tableColumns(database, "admin", "lifecycle_operation_events"),
      ).toEqual([
        "component",
        "failure_code",
        "occurred_at",
        "operation_id",
        "operation_state",
        "outcome",
        "phase",
        "sequence",
      ])
      expect(
        await tableColumns(database, "admin", "lifecycle_snapshot_manifests"),
      ).toEqual([
        "captured_at",
        "component_count",
        "content_free",
        "emergency_sessions_included",
        "manifest_sha256",
        "operation_id",
        "plaintext_secrets_included",
        "schema_version",
        "snapshot_id",
        "workload_content_included",
      ])
      expect(
        await tableColumns(database, "admin", "lifecycle_snapshot_components"),
      ).toEqual([
        "artifact_sha256",
        "component",
        "ordinal",
        "revision",
        "snapshot_id",
      ])

      const singletonRows = await database.query<{
        relation: string
        row_count: number
      }>(`
        SELECT 'backup_state' AS relation, count(*)::int AS row_count
          FROM admin.backup_state
        UNION ALL
        SELECT 'console_settings', count(*)::int
          FROM admin.console_settings
        UNION ALL
        SELECT 'emergency_isolation_state', count(*)::int
          FROM admin.emergency_isolation_state
        UNION ALL
        SELECT 'license_state', count(*)::int
          FROM admin.license_state
        UNION ALL
        SELECT 'recovery_state', count(*)::int
          FROM admin.recovery_state
        UNION ALL
        SELECT 'update_state', count(*)::int
          FROM admin.update_state
        ORDER BY relation
      `)
      expect(singletonRows.rows).toEqual([
        { relation: "backup_state", row_count: 1 },
        { relation: "console_settings", row_count: 1 },
        { relation: "emergency_isolation_state", row_count: 1 },
        { relation: "license_state", row_count: 1 },
        { relation: "recovery_state", row_count: 1 },
        { relation: "update_state", row_count: 1 },
      ])

      const isolationSeed = await database.query<{
        id: string
        revision: number
        status: string
      }>(`
        SELECT id, status, revision
        FROM admin.emergency_isolation_state
      `)
      expect(isolationSeed.rows).toEqual([
        { id: "appliance", revision: 0, status: "inactive" },
      ])

      await database.exec(`
        INSERT INTO common.human_identities (subject_id)
        VALUES ('subject-1')
      `)
      const alertDeliveryDefault = await database.query<{
        alert_delivery_mode: string
        alert_egress_revision: number
      }>(`
        SELECT alert_delivery_mode, alert_egress_revision
        FROM admin.console_settings
        WHERE id = 'singleton'
      `)
      expect(alertDeliveryDefault.rows).toEqual([
        { alert_delivery_mode: "local_only", alert_egress_revision: 0 },
      ])
      await expect(
        database.exec(`
          UPDATE admin.console_settings
          SET alert_delivery_mode = 'customer_owned'
          WHERE id = 'singleton'
        `),
      ).rejects.toThrow()
      await expect(
        database.exec(`
          UPDATE admin.console_settings
          SET alert_egress_revision = -1
          WHERE id = 'singleton'
        `),
      ).rejects.toThrow()
      await database.exec(`
        UPDATE admin.console_settings
        SET
          alert_delivery_mode = 'customer_owned',
          alert_delivery_transport = 'webhook',
          alert_egress_warning_version = 'alert-egress-v1',
          alert_egress_acknowledged_at = TIMESTAMPTZ '2026-08-01T10:00:00Z',
          alert_egress_acknowledged_by = 'subject-1',
          alert_egress_revision = 1,
          alert_egress_updated_at = TIMESTAMPTZ '2026-08-01T10:00:00Z',
          alert_egress_updated_by = 'subject-1'
        WHERE id = 'singleton'
      `)
      await expect(
        database.exec(`
          INSERT INTO common.human_identities (subject_id)
          VALUES ('')
        `),
      ).rejects.toThrow()
      await expect(
        database.exec(`
          INSERT INTO common.human_identity_roles (subject_id, role)
          VALUES ('subject-1', 'viewer')
        `),
      ).rejects.toThrow()
      await database.exec(`
        INSERT INTO admin.applications (
          id,
          name,
          auth_mode,
          created_by,
          updated_by
        )
        VALUES
          ('app-api', 'API key app', 'api_key', 'subject-1', 'subject-1'),
          (
            'app-oauth',
            'OAuth app',
            'oauth_client_credentials',
            'subject-1',
            'subject-1'
          )
      `)
      await expect(
        database.exec(`
          INSERT INTO admin.application_credentials (
            id,
            app_id,
            kind,
            client_identifier,
            external_credential_id
          )
          VALUES (
            'credential-wrong-kind',
            'app-api',
            'oauth_client_credentials',
            'oauth-client',
            'external-client'
          )
        `),
      ).rejects.toThrow()
      await expect(
        database.exec(`
          INSERT INTO admin.application_credentials (
            id,
            app_id,
            kind,
            key_prefix,
            verifier_hash
          )
          VALUES (
            '',
            'app-api',
            'api_key',
            'llmm_t4_safe',
            '${"a".repeat(64)}'
          )
        `),
      ).rejects.toThrow()
      await expect(
        database.exec(`
          INSERT INTO admin.application_credentials (
            id,
            app_id,
            kind,
            client_identifier,
            external_credential_id,
            status,
            rotated_at,
            overlap_expires_at
          )
          VALUES (
            'credential-oauth-retiring',
            'app-oauth',
            'oauth_client_credentials',
            'oauth-client',
            'external-client',
            'retiring',
            '2026-07-31T12:00:00Z',
            '2026-08-01T12:00:00Z'
          )
        `),
      ).rejects.toThrow()
      await database.exec(`
        INSERT INTO admin.application_credentials (
          id,
          app_id,
          kind,
          key_prefix,
          verifier_hash,
          issued_at,
          status,
          rotated_at,
          overlap_expires_at
        )
        VALUES (
          'credential-static-retiring',
          'app-api',
          'api_key',
          'llmm_t4_safe',
          '${"b".repeat(64)}',
          '2026-07-31T11:00:00Z',
          'retiring',
          '2026-07-31T12:00:00Z',
          '2026-08-01T12:00:00Z'
        )
      `)
      await expect(
        database.exec(`
          UPDATE admin.application_credentials
          SET
            status = 'revoked',
            revoked_at = '2026-07-31T11:30:00Z'
          WHERE id = 'credential-static-retiring'
        `),
      ).rejects.toThrow()
      await expect(
        database.exec(`
          INSERT INTO admin.idempotency_ledger (
            id,
            keycloak_subject_id,
            operation_code,
            idempotency_key_digest,
            request_fingerprint,
            state,
            outcome,
            correlation_id,
            status_code,
            expires_at
          )
          VALUES (
            '00000000-0000-4000-8000-000000000002',
            'subject-1',
            'admin.test',
            '${"c".repeat(64)}',
            '${"d".repeat(64)}',
            'pending',
            'succeeded',
            'correlation-2',
            201,
            clock_timestamp() + interval '1 hour'
          )
        `),
      ).rejects.toThrow()
      await expect(
        database.exec(`
          INSERT INTO common.audit_events (
            id,
            action,
            outcome,
            source_system,
            correlation_id,
            credential_record_id,
            credential_prefix
          )
          VALUES (
            '00000000-0000-4000-8000-000000000001',
            'application.credential.rotated',
            'succeeded',
            'console',
            'correlation-1',
            'credential-1',
            'llmm_t4_safe'
          )
        `),
      ).rejects.toThrow()
    } finally {
      await database.close()
    }
  })

  it("distinguishes the complete baseline from an unmigrated or incomplete database", async () => {
    const client = await PGlite.create()
    const database = drizzle(client, { schema })
    try {
      await expect(
        checkInferenceCoreDbReadiness(
          database as unknown as NonNullable<
            Parameters<typeof checkInferenceCoreDbReadiness>[0]
          >,
        ),
      ).resolves.toBe(false)

      await client.exec(readFileSync(migrationPath, "utf8"))
      await expect(
        checkInferenceCoreDbReadiness(
          database as unknown as NonNullable<
            Parameters<typeof checkInferenceCoreDbReadiness>[0]
          >,
        ),
      ).resolves.toBe(true)

      await client.exec("DROP TABLE common.console_sessions")
      await expect(
        checkInferenceCoreDbReadiness(
          database as unknown as NonNullable<
            Parameters<typeof checkInferenceCoreDbReadiness>[0]
          >,
        ),
      ).resolves.toBe(false)
    } finally {
      await client.close()
    }
  })
})

async function tableColumns(
  database: PGlite,
  schema: string,
  table: string,
): Promise<string[]> {
  const result = await database.query<{ column_name: string }>(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = $1
        AND table_name = $2
      ORDER BY column_name
    `,
    [schema, table],
  )
  return result.rows.map(({ column_name }) => column_name)
}
