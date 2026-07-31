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

describe("PR-08 Firecrawl persistence boundary", () => {
  beforeEach(async () => {
    database = await PGlite.create()
    await database.exec(migration)
    await database.exec(`
      INSERT INTO common.human_identities (subject_id)
      VALUES ('pr08-admin'), ('pr08-operator');

      INSERT INTO admin.applications (
        id,
        name,
        auth_mode,
        created_by,
        updated_by
      )
      VALUES
        ('pr08-app-a', 'PR-08 app A', 'api_key', 'pr08-admin', 'pr08-admin'),
        ('pr08-app-b', 'PR-08 app B', 'api_key', 'pr08-admin', 'pr08-admin');
    `)
  })

  afterEach(async () => {
    await database.close()
  })

  it("defaults each Application to disabled, disconnected, and unlimited Firecrawl access", async () => {
    await database.exec(`
      INSERT INTO admin.application_firecrawl_access (app_id, updated_by)
      VALUES ('pr08-app-a', 'pr08-admin')
    `)

    const result = await database.query<{
      connection_status: string
      disclaimer_accepted_at: Date | null
      disclaimer_accepted_by: string | null
      disclaimer_version: string | null
      last_connected_at: Date | null
      max_concurrent_scrapes: number | null
      scrape_rate_limit_rps: number | null
      search_rate_limit_rps: number | null
      status: string
      updated_by: string
    }>(`
      SELECT
        status,
        disclaimer_version,
        disclaimer_accepted_by,
        disclaimer_accepted_at,
        connection_status,
        last_connected_at,
        search_rate_limit_rps,
        scrape_rate_limit_rps,
        max_concurrent_scrapes,
        updated_by
      FROM admin.application_firecrawl_access
      WHERE app_id = 'pr08-app-a'
    `)

    expect(result.rows).toEqual([
      {
        connection_status: "not_connected",
        disclaimer_accepted_at: null,
        disclaimer_accepted_by: null,
        disclaimer_version: null,
        last_connected_at: null,
        max_concurrent_scrapes: null,
        scrape_rate_limit_rps: null,
        search_rate_limit_rps: null,
        status: "disabled",
        updated_by: "pr08-admin",
      },
    ])
  })

  it("requires complete disclaimer and connection evidence and validates optional controls", async () => {
    await expect(
      database.exec(`
        INSERT INTO admin.application_firecrawl_access (
          app_id,
          status,
          updated_by
        )
        VALUES ('pr08-app-a', 'enabled', 'pr08-admin')
      `),
    ).rejects.toThrow()

    await expect(
      database.exec(`
        INSERT INTO admin.application_firecrawl_access (
          app_id,
          disclaimer_version,
          disclaimer_accepted_at,
          updated_by
        )
        VALUES (
          'pr08-app-a',
          'firecrawl-outbound-v1',
          '2026-07-31T12:00:00Z',
          'pr08-admin'
        )
      `),
    ).rejects.toThrow()

    await expect(
      database.exec(`
        INSERT INTO admin.application_firecrawl_access (
          app_id,
          connection_status,
          updated_by
        )
        VALUES ('pr08-app-a', 'connected', 'pr08-admin')
      `),
    ).rejects.toThrow()

    await expect(
      database.exec(`
        INSERT INTO admin.application_firecrawl_access (
          app_id,
          search_rate_limit_rps,
          updated_by
        )
        VALUES ('pr08-app-a', 0, 'pr08-admin')
      `),
    ).rejects.toThrow()

    await database.exec(`
      INSERT INTO admin.application_firecrawl_access (
        app_id,
        status,
        disclaimer_version,
        disclaimer_accepted_by,
        disclaimer_accepted_at,
        connection_status,
        last_connected_at,
        search_rate_limit_rps,
        scrape_rate_limit_rps,
        max_concurrent_scrapes,
        updated_by
      )
      VALUES (
        'pr08-app-a',
        'enabled',
        'firecrawl-outbound-v1',
        'pr08-admin',
        '2026-07-31T12:00:00Z',
        'degraded',
        '2026-07-31T12:01:00Z',
        10,
        4,
        2,
        'pr08-operator'
      )
    `)
  })

  it("keeps Firecrawl credentials separate, non-expiring, and within one exact rotation overlap", async () => {
    await insertAccess("pr08-app-a")
    await insertActiveCredential("pr08-app-a", "credential-active", "a")

    await expect(
      insertActiveCredential("pr08-app-a", "credential-active-two", "b"),
    ).rejects.toThrow()

    await database.exec(`
      UPDATE admin.application_firecrawl_credentials
      SET
        status = 'retiring',
        rotated_at = '2026-07-31T12:00:00Z',
        overlap_expires_at = '2026-08-01T12:00:00Z'
      WHERE id = 'credential-active'
    `)
    await insertActiveCredential("pr08-app-a", "credential-active-two", "b")

    await expect(
      database.exec(`
        INSERT INTO admin.application_firecrawl_credentials (
          id,
          app_id,
          key_prefix,
          verifier_hash,
          issued_at,
          status,
          rotated_at,
          overlap_expires_at
        )
        VALUES (
          'credential-wrong-overlap',
          'pr08-app-a',
          'llmm_fc_0000000000000003',
          repeat('c', 64),
          '2026-07-31T11:00:00Z',
          'retiring',
          '2026-07-31T12:00:00Z',
          '2026-08-01T11:59:59Z'
        )
      `),
    ).rejects.toThrow()

    await expect(
      database.exec(`
        INSERT INTO admin.application_firecrawl_credentials (
          id,
          app_id,
          key_prefix,
          verifier_hash,
          issued_at,
          status,
          rotated_at,
          overlap_expires_at
        )
        VALUES (
          'credential-retiring-two',
          'pr08-app-a',
          'llmm_fc_0000000000000004',
          repeat('d', 64),
          '2026-07-31T11:00:00Z',
          'retiring',
          '2026-07-31T13:00:00Z',
          '2026-08-01T13:00:00Z'
        )
      `),
    ).rejects.toThrow()

    const columns = await database.query<{ column_name: string }>(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'admin'
        AND table_name = 'application_firecrawl_credentials'
      ORDER BY column_name
    `)
    expect(columns.rows.map(({ column_name }) => column_name)).not.toContain(
      "expires_at",
    )

    const credentials = await database.query<{
      overlap_seconds: number | null
      status: string
    }>(`
      SELECT
        status,
        extract(epoch FROM overlap_expires_at - rotated_at)::int
          AS overlap_seconds
      FROM admin.application_firecrawl_credentials
      WHERE app_id = 'pr08-app-a'
      ORDER BY status
    `)
    expect(credentials.rows).toEqual([
      { overlap_seconds: null, status: "active" },
      { overlap_seconds: 86400, status: "retiring" },
    ])
  })

  it("supports route-scoped rate windows, request leases, and metadata-only accounting", async () => {
    await insertAccess("pr08-app-a")
    await insertAccess("pr08-app-b")
    await insertActiveCredential("pr08-app-a", "credential-a", "a")

    await database.exec(`
      INSERT INTO admin.application_firecrawl_rate_limit_windows (
        app_id,
        route_kind,
        window_started_at,
        request_count,
        expires_at
      )
      VALUES (
        'pr08-app-a',
        'search',
        '2026-07-31T12:00:00Z',
        1,
        '2026-07-31T12:00:01Z'
      )
    `)
    await expect(
      database.exec(`
        INSERT INTO admin.application_firecrawl_rate_limit_windows (
          app_id,
          route_kind,
          window_started_at,
          expires_at
        )
        VALUES (
          'pr08-app-a',
          'crawl',
          '2026-07-31T12:00:00Z',
          '2026-07-31T12:00:01Z'
        )
      `),
    ).rejects.toThrow()

    await database.exec(`
      INSERT INTO admin.application_firecrawl_request_ledger (
        id,
        app_id,
        credential_id,
        route_kind,
        started_at,
        lease_expires_at
      )
      VALUES (
        '00000000-0000-4000-8000-000000000008',
        'pr08-app-a',
        'credential-a',
        'scrape',
        '2026-07-31T12:00:00Z',
        '2026-07-31T12:01:00Z'
      )
    `)
    await expect(
      database.exec(`
        INSERT INTO admin.application_firecrawl_request_ledger (
          id,
          app_id,
          credential_id,
          route_kind,
          started_at,
          lease_expires_at
        )
        VALUES (
          '00000000-0000-4000-8000-000000000009',
          'pr08-app-b',
          'credential-a',
          'scrape',
          '2026-07-31T12:00:00Z',
          '2026-07-31T12:01:00Z'
        )
      `),
    ).rejects.toThrow()

    await database.exec(`
      UPDATE admin.application_firecrawl_request_ledger
      SET
        state = 'settled',
        status_code = 200,
        latency_ms = 25,
        settled_at = '2026-07-31T12:00:25Z'
      WHERE id = '00000000-0000-4000-8000-000000000008';

      INSERT INTO admin.application_firecrawl_usage_daily (
        app_id,
        credential_id,
        bucket_date,
        route_kind,
        request_count,
        failure_count,
        latency_ms_sum,
        latency_ms_max
      )
      VALUES (
        'pr08-app-a',
        'credential-a',
        '2026-07-31',
        'scrape',
        1,
        0,
        25,
        25
      )
    `)

    await expect(
      database.exec(`
        INSERT INTO admin.application_firecrawl_usage_daily (
          app_id,
          credential_id,
          bucket_date,
          route_kind,
          request_count,
          failure_count
        )
        VALUES (
          'pr08-app-a',
          'credential-a',
          '2026-08-01',
          'search',
          0,
          1
        )
      `),
    ).rejects.toThrow()
  })
})

async function insertAccess(appId: string): Promise<void> {
  await database.exec(`
    INSERT INTO admin.application_firecrawl_access (app_id, updated_by)
    VALUES ('${appId}', 'pr08-admin')
  `)
}

async function insertActiveCredential(
  appId: string,
  credentialId: string,
  hashCharacter: string,
): Promise<void> {
  const prefixSequence = {
    a: "0000000000000001",
    b: "0000000000000002",
  }[hashCharacter]
  if (!prefixSequence) {
    throw new Error("Unknown Firecrawl credential test fixture.")
  }
  await database.exec(`
    INSERT INTO admin.application_firecrawl_credentials (
      id,
      app_id,
      key_prefix,
      verifier_hash,
      issued_at
    )
    VALUES (
      '${credentialId}',
      '${appId}',
      'llmm_fc_${prefixSequence}',
      repeat('${hashCharacter}', 64),
      '2026-07-31T11:00:00Z'
    )
  `)
}
