import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { PGlite } from "@electric-sql/pglite"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

const migration = readFileSync(
  fileURLToPath(
    new URL(
      "../../../infra/migrations/0000_inference_core.sql",
      import.meta.url,
    ),
  ),
  "utf8",
)

let database: PGlite

describe("PR-06 Application credential reconciliation boundary", () => {
  beforeEach(async () => {
    database = await PGlite.create()
    await database.exec(migration)
    await database.exec(`
      INSERT INTO common.human_identities (subject_id)
      VALUES ('pr06-admin')
    `)
    await database.exec(`
      INSERT INTO admin.applications (
        id,
        name,
        auth_mode,
        created_by,
        updated_by
      )
      VALUES
        ('app-static', 'Static app', 'api_key', 'pr06-admin', 'pr06-admin'),
        (
          'app-oauth',
          'OAuth app',
          'oauth_client_credentials',
          'pr06-admin',
          'pr06-admin'
        )
    `)
  })

  afterEach(async () => {
    await database.close()
  })

  it("allows an active OAuth credential to record rotation and immediate revocation without overlap", async () => {
    await database.exec(`
      INSERT INTO admin.application_credentials (
        id,
        app_id,
        kind,
        client_identifier,
        external_credential_id,
        issued_at,
        rotated_at
      )
      VALUES (
        'credential-oauth',
        'app-oauth',
        'oauth_client_credentials',
        'client-oauth',
        'keycloak-client-uuid',
        '2026-07-31T10:00:00Z',
        '2026-07-31T11:00:00Z'
      )
    `)

    await database.exec(`
      UPDATE admin.application_credentials
      SET
        status = 'revoked',
        revoked_at = '2026-07-31T12:00:00Z'
      WHERE id = 'credential-oauth'
    `)

    const result = await database.query<{
      overlap_expires_at: Date | null
      revoked_at: Date | null
      rotated_at: Date | null
      status: string
    }>(`
      SELECT overlap_expires_at, revoked_at, rotated_at, status
      FROM admin.application_credentials
      WHERE id = 'credential-oauth'
    `)
    expect(result.rows).toEqual([
      {
        overlap_expires_at: null,
        revoked_at: new Date("2026-07-31T12:00:00.000Z"),
        rotated_at: new Date("2026-07-31T11:00:00.000Z"),
        status: "revoked",
      },
    ])
  })

  it("rejects cross-kind lifecycle states", async () => {
    await expect(
      database.exec(`
        INSERT INTO admin.application_credentials (
          id,
          app_id,
          kind,
          client_identifier,
          external_credential_id,
          issued_at,
          status,
          rotated_at,
          overlap_expires_at
        )
        VALUES (
          'oauth-retiring',
          'app-oauth',
          'oauth_client_credentials',
          'client-retiring',
          'external-retiring',
          '2026-07-31T10:00:00Z',
          'retiring',
          '2026-07-31T11:00:00Z',
          '2026-08-01T11:00:00Z'
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
          verifier_hash,
          issued_at,
          rotated_at
        )
        VALUES (
          'static-active-rotated',
          'app-static',
          'api_key',
          'llmm_t4_static',
          '${"a".repeat(64)}',
          '2026-07-31T10:00:00Z',
          '2026-07-31T11:00:00Z'
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
          verifier_hash,
          issued_at,
          status,
          rotated_at
        )
        VALUES (
          'static-retiring-without-overlap',
          'app-static',
          'api_key',
          'llmm_t4_retiring',
          '${"b".repeat(64)}',
          '2026-07-31T10:00:00Z',
          'retiring',
          '2026-07-31T11:00:00Z'
        )
      `),
    ).rejects.toThrow()
  })

  it("enforces one fixed 86400-second static-key overlap", async () => {
    await expect(
      database.exec(`
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
          'static-wrong-overlap',
          'app-static',
          'api_key',
          'llmm_t4_wrong',
          '${"c".repeat(64)}',
          '2026-07-31T10:00:00Z',
          'retiring',
          '2026-07-31T11:00:00Z',
          '2026-08-01T10:59:59Z'
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
        'static-retiring-one',
        'app-static',
        'api_key',
        'llmm_t4_retiring_one',
        '${"d".repeat(64)}',
        '2026-07-31T10:00:00Z',
        'retiring',
        '2026-07-31T11:00:00Z',
        '2026-08-01T11:00:00Z'
      )
    `)

    await expect(
      database.exec(`
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
          'static-retiring-two',
          'app-static',
          'api_key',
          'llmm_t4_retiring_two',
          '${"e".repeat(64)}',
          '2026-07-31T11:00:00Z',
          'retiring',
          '2026-07-31T12:00:00Z',
          '2026-08-01T12:00:00Z'
        )
      `),
    ).rejects.toThrow()
  })

  it("retains a deleted Application and its revoked credential identifiers", async () => {
    await database.exec(`
      INSERT INTO admin.application_credentials (
        id,
        app_id,
        kind,
        key_prefix,
        verifier_hash,
        issued_at
      )
      VALUES (
        'credential-static',
        'app-static',
        'api_key',
        'llmm_t4_deleted',
        '${"c".repeat(64)}',
        '2026-07-31T10:00:00Z'
      )
    `)
    await database.exec(`
      BEGIN;
      UPDATE admin.application_credentials
      SET status = 'revoked', revoked_at = '2026-07-31T12:00:00Z'
      WHERE id = 'credential-static';
      UPDATE admin.applications
      SET status = 'deleted', updated_at = '2026-07-31T12:00:00Z'
      WHERE id = 'app-static';
      COMMIT;
    `)

    const result = await database.query<{
      app_id: string
      app_status: string
      credential_id: string
      credential_status: string
    }>(`
      SELECT
        application.id AS app_id,
        application.status AS app_status,
        credential.id AS credential_id,
        credential.status AS credential_status
      FROM admin.applications AS application
      JOIN admin.application_credentials AS credential
        ON credential.app_id = application.id
      WHERE application.id = 'app-static'
    `)
    expect(result.rows).toEqual([
      {
        app_id: "app-static",
        app_status: "deleted",
        credential_id: "credential-static",
        credential_status: "revoked",
      },
    ])
  })

  it("rolls back connected state and credential use when the metadata-only models audit insert fails", async () => {
    await insertStaticCredential()

    await expect(
      database.exec(`
        BEGIN;
        UPDATE admin.application_credentials
        SET last_used_at = '2026-07-31T12:00:00Z'
        WHERE
          id = 'credential-static'
          AND app_id = 'app-static'
          AND status = 'active';
        UPDATE admin.applications
        SET
          connection_status = 'connected',
          last_connected_at = '2026-07-31T12:00:00Z'
        WHERE id = 'app-static' AND status = 'enabled';
        INSERT INTO common.audit_events (
          id,
          occurred_at,
          action,
          outcome,
          source_system,
          correlation_id,
          application_id,
          credential_record_id
        )
        VALUES (
          '00000000-0000-4000-8000-000000000206',
          '2026-07-31T12:00:00Z',
          'connected_app.gateway.models',
          'succeeded',
          'invalid-source',
          'pr06-models-audit-failure',
          'app-static',
          'credential-static'
        );
        COMMIT;
      `),
    ).rejects.toThrow()
    await database.exec("ROLLBACK")

    const result = await modelsConnectionState()
    expect(result).toEqual({
      application: {
        connection_status: "not_connected",
        last_connected_at: null,
      },
      auditCount: 0,
      credential: { last_used_at: null },
    })
  })

  it("does not commit credential use or a success event when the Application update fails", async () => {
    await insertStaticCredential()

    await expect(
      database.exec(`
        BEGIN;
        UPDATE admin.application_credentials
        SET last_used_at = '2026-07-31T12:00:00Z'
        WHERE
          id = 'credential-static'
          AND app_id = 'app-static'
          AND status = 'active';
        UPDATE admin.applications
        SET
          connection_status = 'invalid-connected-state',
          last_connected_at = '2026-07-31T12:00:00Z'
        WHERE id = 'app-static' AND status = 'enabled';
        INSERT INTO common.audit_events (
          id,
          occurred_at,
          action,
          outcome,
          source_system,
          correlation_id,
          application_id,
          credential_record_id
        )
        VALUES (
          '00000000-0000-4000-8000-000000000207',
          '2026-07-31T12:00:00Z',
          'connected_app.gateway.models',
          'succeeded',
          'console',
          'pr06-models-app-failure',
          'app-static',
          'credential-static'
        );
        COMMIT;
      `),
    ).rejects.toThrow()
    await database.exec("ROLLBACK")

    const result = await modelsConnectionState()
    expect(result).toEqual({
      application: {
        connection_status: "not_connected",
        last_connected_at: null,
      },
      auditCount: 0,
      credential: { last_used_at: null },
    })
  })

  it("admits OAuth clients to the durable identity reconciliation journal", async () => {
    await database.exec(`
      INSERT INTO admin.idempotency_ledger (
        id,
        keycloak_subject_id,
        operation_code,
        idempotency_key_digest,
        request_fingerprint,
        correlation_id,
        expires_at
      )
      VALUES (
        '00000000-0000-4000-8000-000000000006',
        'pr06-admin',
        'application.oauth.rotate',
        '${"d".repeat(64)}',
        '${"e".repeat(64)}',
        'pr06-correlation',
        now() + interval '1 day'
      )
    `)
    await database.exec(`
      INSERT INTO admin.identity_mutation_journal (
        id,
        idempotency_ledger_id,
        keycloak_subject_id,
        operation_code,
        request_fingerprint,
        target_type,
        target_identifier
      )
      VALUES (
        '00000000-0000-4000-8000-000000000106',
        '00000000-0000-4000-8000-000000000006',
        'pr06-admin',
        'application.oauth.rotate',
        '${"e".repeat(64)}',
        'oauth_client',
        'client-oauth'
      )
    `)

    const result = await database.query<{
      state: string
      target_identifier: string
      target_type: string
    }>(`
      SELECT state, target_identifier, target_type
      FROM admin.identity_mutation_journal
    `)
    expect(result.rows).toEqual([
      {
        state: "prepared",
        target_identifier: "client-oauth",
        target_type: "oauth_client",
      },
    ])
  })
})

async function insertStaticCredential(): Promise<void> {
  await database.exec(`
    INSERT INTO admin.application_credentials (
      id,
      app_id,
      kind,
      key_prefix,
      verifier_hash,
      issued_at
    )
    VALUES (
      'credential-static',
      'app-static',
      'api_key',
      'llmm_t4_atomic',
      '${"f".repeat(64)}',
      '2026-07-31T10:00:00Z'
    )
  `)
}

async function modelsConnectionState() {
  const [application, credential, audit] = await Promise.all([
    database.query<{
      connection_status: string
      last_connected_at: Date | null
    }>(`
      SELECT connection_status, last_connected_at
      FROM admin.applications
      WHERE id = 'app-static'
    `),
    database.query<{ last_used_at: Date | null }>(`
      SELECT last_used_at
      FROM admin.application_credentials
      WHERE id = 'credential-static'
    `),
    database.query<{ count: number }>(`
      SELECT count(*)::integer AS count
      FROM common.audit_events
      WHERE action = 'connected_app.gateway.models'
    `),
  ])
  return {
    application: application.rows[0],
    auditCount: audit.rows[0]?.count ?? -1,
    credential: credential.rows[0],
  }
}
