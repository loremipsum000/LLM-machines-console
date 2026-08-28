import { generateKeyPairSync } from "node:crypto"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { Actor } from "../auth/authorization"
import {
  emitAudit,
  getAuditEventsForTest,
  resetAuditEventsForTest,
} from "./audit"
import {
  createSignedAuditExport,
  serializeAuditExportPayload,
} from "./audit-export"

const actor: Actor = {
  authMode: "service-forwarded",
  role: "admin",
  subject: "admin-export",
}

describe("bounded audit export", () => {
  afterEach(() => {
    vi.useRealTimers()
    resetAuditEventsForTest()
  })

  it("serializes deterministic canonical JSON and CSV bytes", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-08-01T12:00:00.000Z"))
    await emitAudit({
      action: "admin.audit.tested",
      applicationId: "app-1",
      correlationId: "request-1",
      keycloakSubjectId: "subject-1",
      outcome: "succeeded",
      sourceSystem: "console",
    })
    const events = getAuditEventsForTest()

    const authority = exportAuthority(events.length)
    const json = serializeAuditExportPayload("json", events, authority)
    const csv = serializeAuditExportPayload("csv", events, authority)

    expect(serializeAuditExportPayload("json", events, authority)).toEqual(json)
    expect(JSON.parse(json.toString("utf8"))).toMatchObject({
      authority: {
        exportedAt: "2026-08-01T12:00:00.000Z",
        rowCount: 1,
      },
      retentionDays: 365,
      schemaVersion: 1,
    })
    expect(csv.toString("utf8").split("\r\n")[0]).toBe(
      '"id","occurred_at","ingested_at","source_system","action","outcome","correlation_id","keycloak_subject_id","application_id","credential_record_id","credential_prefix","recovery_reason_code"',
    )
    expect(csv.toString("utf8").endsWith("\r\n")).toBe(true)
    expect(json.toString("utf8")).not.toMatch(
      /prompt|response|username|email|sourceIp|requestBody|responseBody|sourceEventId|targetType|targetId/,
    )
  })

  it("signs the embedded payload and audits only bounded export metadata", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-08-01T12:00:00.000Z"))
    await emitAudit({
      action: "admin.audit.tested",
      correlationId: "request-1",
      outcome: "succeeded",
      sourceSystem: "console",
    })
    const keys = generateKeyPairSync("ed25519")
    const publicJwk = keys.publicKey.export({ format: "jwk" })
    const applianceId = "01234567-89ab-4def-8123-456789abcdef"

    const result = await createSignedAuditExport(
      actor,
      "json",
      {},
      {
        from: new Date("2026-07-01T12:00:00.000Z"),
        to: new Date("2026-08-01T12:00:00.000Z"),
      },
      {
        material: {
          activeKid: "audit-test",
          applianceId,
          issuerId: `urn:llm-machines:customer-appliance:${applianceId}`,
          privateKey: keys.privateKey,
          purpose: "audit-export",
          verificationKeys: {
            activeKid: "audit-test",
            keys: [
              {
                alg: "EdDSA",
                crv: "Ed25519",
                kid: "audit-test",
                kty: "OKP",
                use: "sig",
                x: publicJwk.x ?? "",
              },
            ],
          },
        },
        now: new Date("2026-08-01T12:00:00.000Z"),
      },
    )

    expect(result).toMatchObject({
      contentType: "application/json",
      eventCount: 1,
      filename: "llm-machines-audit-20260801T120000Z.json.jws",
      format: "json",
    })
    expect(result.compactJws.split(".")).toHaveLength(3)
    expect(getAuditEventsForTest().at(-1)).toMatchObject({
      action: "admin.audit.export",
      keycloakSubjectId: "admin-export",
      outcome: "succeeded",
    })
  })

  it("neutralizes spreadsheet formula cells in deterministic RFC4180 CSV", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-08-01T12:00:00.000Z"))
    const event = await emitAudit({
      action: "admin.audit.tested",
      correlationId: "request-1",
      outcome: "succeeded",
      sourceSystem: "console",
    })
    for (const dangerous of [
      " =FORMULA()",
      "=FORMULA()",
      "+FORMULA()",
      "-FORMULA()",
      "@FORMULA()",
      "\tFORMULA()",
      "\rFORMULA()",
      "\nFORMULA()",
    ]) {
      const csv = serializeAuditExportPayload(
        "csv",
        [{ ...event, applicationId: dangerous }],
        exportAuthority(1),
      ).toString("utf8")
      expect(csv).toContain(`"'${dangerous.replace(/"/g, '""')}"`)
      expect(csv.endsWith("\r\n")).toBe(true)
    }
  })
})

function exportAuthority(rowCount: number) {
  return {
    exportedAt: "2026-08-01T12:00:00.000Z",
    filters: {
      applicationId: null,
      eventId: null,
      outcome: null,
      querySha256: null,
      severity: null,
      sourceSystem: null,
    },
    nextCursor: null,
    order: "occurred_at_asc,id_asc",
    range: {
      from: "2026-07-01T12:00:00.000Z",
      to: "2026-08-01T12:00:00.000Z",
    },
    requestedCursor: null,
    rowCount,
    schemaVersion: 1,
  } as const
}
