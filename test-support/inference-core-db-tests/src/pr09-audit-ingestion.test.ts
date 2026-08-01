import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { InferenceCoreDatabase } from "../../../apps/bff/src/db/inference-core-client"
import * as schema from "../../../apps/bff/src/db/inference-core-schema"
import {
  getAuditEventPage,
  getAuditEventsForExport,
} from "../../../apps/bff/src/services/audit"
import {
  AuditIngestionConcurrencyError,
  AuditIngestionEventCollisionError,
  encodeNativeAuditCursor,
  getAuditSourceHealth,
  runAuditIngestion,
} from "../../../apps/bff/src/services/audit-ingestion"
import type {
  NativeAuditEvent,
  NativeAuditSource,
} from "../../../apps/bff/src/services/expert-capabilities"

const migration = readFileSync(
  fileURLToPath(
    new URL(
      "../../../infra/migrations/0000_inference_core.sql",
      import.meta.url,
    ),
  ),
  "utf8",
)

const eventId1 = "00000000-0000-5000-8000-000000000001"
const eventId2 = "00000000-0000-5000-8000-000000000002"
const eventId3 = "00000000-0000-5000-8000-000000000003"
const correlationId = "10000000-0000-4000-8000-000000000001"

describe("PR-09 native audit ingestion ledger", () => {
  let client: PGlite
  let database: InferenceCoreDatabase

  beforeEach(async () => {
    client = await PGlite.create()
    await client.exec(migration)
    database = drizzle(client, { schema }) as unknown as InferenceCoreDatabase
  })

  afterEach(async () => {
    await client.close()
  })

  it("deduplicates deterministic event IDs while preserving repeated correlations", async () => {
    const source = replayingSource()
    const now = new Date("2026-08-01T12:00:00.000Z")

    await expect(
      runAuditIngestion(database, [source], { now }),
    ).resolves.toMatchObject({
      status: "completed",
      sources: [
        {
          cursorAdvanced: true,
          eventsDeduplicated: 0,
          eventsInserted: 2,
          eventsReceived: 2,
          sourceSystem: "keycloak",
        },
      ],
    })
    await expect(
      runAuditIngestion(database, [source], { now }),
    ).resolves.toMatchObject({
      status: "completed",
      sources: [
        {
          cursorAdvanced: false,
          eventsDeduplicated: 2,
          eventsInserted: 0,
          eventsReceived: 2,
        },
      ],
    })

    const rows = await client.query<{
      correlation_id: string
      id: string
      source_system: string
    }>(`
      SELECT id, source_system, correlation_id
      FROM common.audit_events
      ORDER BY occurred_at, id
    `)
    expect(rows.rows).toEqual([
      {
        correlation_id: correlationId,
        id: eventId1,
        source_system: "keycloak",
      },
      {
        correlation_id: correlationId,
        id: eventId2,
        source_system: "keycloak",
      },
    ])
    expect(
      (await getAuditSourceHealth(database)).find(
        (sourceHealth) => sourceHealth.sourceSystem === "keycloak",
      ),
    ).toMatchObject({
      cursorHealth: "healthy",
      lastErrorCode: null,
      sourceStatus: "ok",
    })

    const exported = await getAuditEventsForExport(
      { sourceSystem: "keycloak" },
      {
        database,
        from: new Date("2026-08-01T00:00:00.000Z"),
        limit: 1,
        to: now,
      },
    )
    expect(exported.events.map((event) => event.id)).toEqual([eventId1])
    expect(exported.nextCursor).toMatch(/^[A-Za-z0-9_-]+$/)
    const next = await getAuditEventsForExport(
      { sourceSystem: "keycloak" },
      {
        cursor: exported.nextCursor,
        database,
        from: new Date("2026-08-01T00:00:00.000Z"),
        limit: 1,
        to: now,
      },
    )
    expect(next.events.map((event) => event.id)).toEqual([eventId2])
    expect(next.nextCursor).toBeNull()
  })

  it("rejects a cursor race instead of overwriting another ingestion run", async () => {
    const concurrentCursor = sourceCursor("2026-08-01T11:30:00.000Z", eventId3)
    const source: NativeAuditSource = {
      system: "grafana",
      collect: async () => {
        await client.exec(`
          UPDATE common.audit_source_cursors
          SET
            cursor_version = 1,
            cursor_watermark = '2026-08-01T11:30:00.000Z',
            cursor_tie_breaker = '${eventId3}'
          WHERE source_system = 'grafana'
        `)
        return { cursor: null, events: [] }
      },
    }

    await expect(
      runAuditIngestion(database, [source], {
        now: new Date("2026-08-01T12:00:00.000Z"),
      }),
    ).rejects.toBeInstanceOf(AuditIngestionConcurrencyError)
    expect(await storedSourceCursor(client, "grafana")).toBe(concurrentCursor)
  })

  it("never clears or moves an established native cursor backward", async () => {
    const firstSource = oneEventSource(
      "grafana",
      nativeEvent("grafana", eventId2, "2026-08-01T11:00:01.000Z"),
    )
    await runAuditIngestion(database, [firstSource], {
      now: new Date("2026-08-01T12:00:00.000Z"),
    })
    const established = sourceCursor("2026-08-01T11:00:01.000Z", eventId2)

    const clearing: NativeAuditSource = {
      system: "grafana",
      collect: async () => ({ cursor: null, events: [] }),
    }
    await expect(
      runAuditIngestion(database, [clearing], {
        now: new Date("2026-08-01T12:01:00.000Z"),
      }),
    ).resolves.toMatchObject({ status: "degraded" })
    expect(await storedSourceCursor(client, "grafana")).toBe(established)

    const backward = oneEventSource(
      "grafana",
      nativeEvent("grafana", eventId1, "2026-08-01T11:00:00.000Z"),
    )
    await expect(
      runAuditIngestion(database, [backward], {
        now: new Date("2026-08-01T12:02:00.000Z"),
      }),
    ).resolves.toMatchObject({ status: "degraded" })
    expect(await storedSourceCursor(client, "grafana")).toBe(established)
    expect(
      await client.query<{ count: number }>(
        "SELECT count(*)::integer AS count FROM common.audit_events",
      ),
    ).toMatchObject({ rows: [{ count: 1 }] })
  })

  it("rejects a deterministic event ID collision with different metadata", async () => {
    await runAuditIngestion(
      database,
      [
        oneEventSource(
          "keycloak",
          nativeEvent("keycloak", eventId1, "2026-08-01T11:00:00.000Z"),
        ),
      ],
      { now: new Date("2026-08-01T12:00:00.000Z") },
    )
    const collision = {
      ...nativeEvent("keycloak", eventId1, "2026-08-01T11:00:01.000Z"),
      action: "keycloak.user.deleted",
    } satisfies NativeAuditEvent

    await expect(
      runAuditIngestion(database, [oneEventSource("keycloak", collision)], {
        now: new Date("2026-08-01T12:01:00.000Z"),
      }),
    ).rejects.toBeInstanceOf(AuditIngestionEventCollisionError)
    expect(await storedSourceCursor(client, "keycloak")).toBe(
      sourceCursor("2026-08-01T11:00:00.000Z", eventId1),
    )
  })

  it("rejects unsafe native metadata and non-v5 cursor state at the database", async () => {
    await expect(
      client.exec(`
        INSERT INTO common.audit_events (
          id, action, outcome, source_system, correlation_id, keycloak_subject_id
        ) VALUES (
          '${eventId1}',
          'keycloak.user.updated',
          'succeeded',
          'keycloak',
          '${correlationId}',
          'admin.internal'
        )
      `),
    ).rejects.toThrow()
    await expect(
      client.exec(`
        INSERT INTO common.audit_source_cursors (
          source_system, cursor_version, cursor_watermark, cursor_tie_breaker
        ) VALUES (
          'keycloak',
          1,
          '2026-08-01T11:00:00.000Z',
          '00000000-0000-4000-8000-000000000001'
        )
      `),
    ).rejects.toThrow()
  })

  it("rejects provider-token-shaped native opaque identifiers at the database", async () => {
    const tokenShapes = [
      {
        column: "credential_record_id",
        eventId: eventId1,
        value: ["sk", "live", "syntheticvalue"].join("-"),
      },
      {
        column: "application_id",
        eventId: eventId2,
        value: ["github", "pat", "syntheticvalue0000"].join("_"),
      },
    ] as const

    for (const { column, eventId, value } of tokenShapes) {
      await expect(
        client.exec(`
          INSERT INTO common.audit_events (
            id,
            action,
            outcome,
            source_system,
            correlation_id,
            ${column}
          ) VALUES (
            '${eventId}',
            'grafana.dashboard.updated',
            'succeeded',
            'grafana',
            '${correlationId}',
            '${value}'
          )
        `),
      ).rejects.toThrow()
    }
  })

  it("persists a system-originated native event without fabricating a subject", async () => {
    const event = {
      ...nativeEvent("alertmanager", eventId3, "2026-08-01T11:00:00.000Z"),
      applicationId: "app-customer-1",
      credentialRecordId: "cak-1",
      keycloakSubjectId: null,
    }
    await expect(
      runAuditIngestion(database, [oneEventSource("alertmanager", event)], {
        now: new Date("2026-08-01T12:00:00.000Z"),
      }),
    ).resolves.toMatchObject({ status: "completed" })

    const row = await client.query<{
      application_id: string | null
      credential_record_id: string | null
      keycloak_subject_id: string | null
    }>(`
      SELECT application_id, credential_record_id, keycloak_subject_id
      FROM common.audit_events
      WHERE id = '${eventId3}'
    `)
    expect(row.rows).toEqual([
      {
        application_id: "app-customer-1",
        credential_record_id: "cak-1",
        keycloak_subject_id: null,
      },
    ])
  })

  it("keeps database search in parity with the canonical fixture field set", async () => {
    const id = "20000000-0000-4000-8000-000000000001"
    await client.exec(`
      INSERT INTO common.audit_events (
        id,
        action,
        outcome,
        source_system,
        correlation_id,
        keycloak_subject_id,
        application_id,
        credential_record_id,
        recovery_reason_code
      ) VALUES (
        '${id}',
        'admin.audit.tested',
        'succeeded',
        'console',
        'request-search',
        'subject-search',
        'app-search',
        'credential-search',
        'policy_checked'
      )
    `)

    for (const query of [
      id,
      "audit.tested",
      "request-search",
      "subject-search",
      "app-search",
      "credential-search",
      "policy_checked",
    ]) {
      await expect(
        getAuditEventPage({ query }, { database }),
      ).resolves.toMatchObject({
        events: [expect.objectContaining({ id })],
      })
    }
    for (const query of ["console", "succeeded"] as const) {
      await expect(
        getAuditEventPage({ query }, { database }),
      ).resolves.toMatchObject({ events: [] })
    }
  })

  it("records only a bounded failure code when collection fails", async () => {
    const source: NativeAuditSource = {
      system: "alertmanager",
      collect: async () => {
        throw new Error(
          "webhook https://internal.example with bearer secret-value failed",
        )
      },
    }

    await expect(
      runAuditIngestion(database, [source], {
        now: new Date("2026-08-01T12:00:00.000Z"),
      }),
    ).resolves.toMatchObject({
      status: "degraded",
      sources: [
        {
          errorCode: "collection_failed",
          sourceSystem: "alertmanager",
          status: "degraded",
        },
      ],
    })
    const serialized = JSON.stringify(await getAuditSourceHealth(database))
    expect(serialized).toContain("collection_failed")
    expect(serialized).not.toMatch(/internal\.example|secret-value|bearer/i)
  })

  it("does not let an older failed attempt overwrite a newer success", async () => {
    const source: NativeAuditSource = {
      system: "grafana",
      collect: async () => {
        await client.exec(`
          UPDATE common.audit_source_cursors
          SET
            last_attempt_at = '2026-08-01T12:10:00.000Z',
            last_success_at = '2026-08-01T12:10:00.000Z',
            last_error_code = NULL,
            updated_at = '2026-08-01T12:10:00.000Z'
          WHERE source_system = 'grafana'
        `)
        throw new Error("the older collection attempt failed")
      },
    }

    await expect(
      runAuditIngestion(database, [source], {
        now: new Date("2026-08-01T12:00:00.000Z"),
      }),
    ).resolves.toMatchObject({ status: "degraded" })
    expect(
      (await getAuditSourceHealth(database)).find(
        (sourceHealth) => sourceHealth.sourceSystem === "grafana",
      ),
    ).toMatchObject({
      cursorHealth: "healthy",
      lastAttemptAt: "2026-08-01T12:10:00.000Z",
      lastErrorCode: null,
      lastSuccessAt: "2026-08-01T12:10:00.000Z",
      sourceStatus: "ok",
    })
  })

  it("does not let an older success overwrite a newer failed attempt", async () => {
    const source: NativeAuditSource = {
      system: "grafana",
      collect: async () => {
        await client.exec(`
          UPDATE common.audit_source_cursors
          SET
            last_attempt_at = '2026-08-01T12:10:00.000Z',
            last_success_at = NULL,
            last_error_code = 'collection_failed',
            updated_at = '2026-08-01T12:10:00.000Z'
          WHERE source_system = 'grafana'
        `)
        return { cursor: null, events: [] }
      },
    }

    await expect(
      runAuditIngestion(database, [source], {
        now: new Date("2026-08-01T12:00:00.000Z"),
      }),
    ).rejects.toBeInstanceOf(AuditIngestionConcurrencyError)
    expect(
      (await getAuditSourceHealth(database)).find(
        (sourceHealth) => sourceHealth.sourceSystem === "grafana",
      ),
    ).toMatchObject({
      cursorHealth: "degraded",
      lastAttemptAt: "2026-08-01T12:10:00.000Z",
      lastErrorCode: "collection_failed",
      lastSuccessAt: null,
      sourceStatus: "degraded",
    })
  })
})

function replayingSource(): NativeAuditSource {
  return {
    system: "keycloak",
    collect: async () => ({
      cursor: sourceCursor("2026-08-01T11:00:01.000Z", eventId2),
      events: [
        nativeEvent("keycloak", eventId2, "2026-08-01T11:00:01.000Z"),
        nativeEvent("keycloak", eventId1, "2026-08-01T11:00:00.000Z"),
      ],
    }),
  }
}

function oneEventSource(
  system: NativeAuditSource["system"],
  event: NativeAuditEvent,
): NativeAuditSource {
  return {
    system,
    collect: async () => ({
      cursor: sourceCursor(event.occurredAt, event.eventId),
      events: [event],
    }),
  }
}

function nativeEvent(
  sourceSystem: NativeAuditSource["system"],
  eventId: string,
  occurredAt: string,
): NativeAuditEvent {
  const action =
    sourceSystem === "keycloak"
      ? "keycloak.user.updated"
      : sourceSystem === "grafana"
        ? "grafana.dashboard.updated"
        : sourceSystem === "litellm"
          ? "litellm.request.succeeded"
          : "alertmanager.notification.succeeded"
  return {
    action,
    applicationId: null,
    correlationId,
    credentialPrefix: null,
    credentialRecordId: null,
    eventId,
    keycloakSubjectId: "admin-1",
    occurredAt,
    outcome: "succeeded",
    recoveryReasonCode: null,
    sourceSystem,
  }
}

function sourceCursor(watermark: string, tieBreaker: string): string {
  return encodeNativeAuditCursor(watermark, tieBreaker)
}

async function storedSourceCursor(
  client: PGlite,
  sourceSystem: string,
): Promise<string | null> {
  const result = await client.query<{
    cursor_tie_breaker: string | null
    cursor_version: number | null
    cursor_watermark: string | null
  }>(`
    SELECT cursor_version, cursor_watermark, cursor_tie_breaker
    FROM common.audit_source_cursors
    WHERE source_system = '${sourceSystem}'
  `)
  const row = result.rows[0]
  if (
    !row ||
    row.cursor_version === null ||
    row.cursor_watermark === null ||
    row.cursor_tie_breaker === null
  ) {
    return null
  }
  return sourceCursor(
    new Date(row.cursor_watermark).toISOString(),
    row.cursor_tie_breaker,
  )
}
