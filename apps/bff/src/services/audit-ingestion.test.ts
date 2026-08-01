import { describe, expect, it } from "vitest"
import type { InferenceCoreDatabase } from "../db/inference-core-client"
import {
  encodeNativeAuditCursor,
  getAuditSourceHealth,
  validateNativeAuditSourceBatch,
} from "./audit-ingestion"
import type { NativeAuditEvent } from "./expert-capabilities"

const now = new Date("2026-08-01T12:00:00.000Z")

describe("native audit source allowlist", () => {
  it("accepts only exact metadata fields and sorts stable source events", () => {
    const validated = validateNativeAuditSourceBatch(
      "grafana",
      {
        cursor: sourceCursor(
          "2026-08-01T11:00:01.000Z",
          "00000000-0000-5000-8000-000000000002",
        ),
        events: [
          nativeEvent(
            "00000000-0000-5000-8000-000000000002",
            "2026-08-01T11:00:01.000Z",
          ),
          nativeEvent(
            "00000000-0000-5000-8000-000000000001",
            "2026-08-01T11:00:00.000Z",
          ),
        ],
      },
      now,
    )

    expect(validated.cursor).toBe(
      sourceCursor(
        "2026-08-01T11:00:01.000Z",
        "00000000-0000-5000-8000-000000000002",
      ),
    )
    expect(validated.events.map(({ eventId }) => eventId)).toEqual([
      "00000000-0000-5000-8000-000000000001",
      "00000000-0000-5000-8000-000000000002",
    ])
    expect(
      validated.events.every(
        ({ event }) =>
          event.correlationId === "10000000-0000-4000-8000-000000000001",
      ),
    ).toBe(true)
  })

  it.each(["prompt", "response", "metadata"])(
    "rejects an unallowlisted %s field instead of silently dropping it",
    (field) => {
      const event = {
        ...nativeEvent(
          "00000000-0000-5000-8000-000000000001",
          "2026-08-01T11:00:00.000Z",
        ),
        [field]: "private-content",
      }

      expect(() =>
        validateNativeAuditSourceBatch(
          "grafana",
          {
            cursor: sourceCursor(
              "2026-08-01T11:00:00.000Z",
              "00000000-0000-5000-8000-000000000001",
            ),
            events: [event as NativeAuditEvent],
          },
          now,
        ),
      ).toThrow(/source does not match collector/)
    },
  )

  it("rejects missing cursors and duplicate deterministic event IDs", () => {
    expect(() =>
      validateNativeAuditSourceBatch(
        "grafana",
        {
          cursor: null,
          events: [
            nativeEvent(
              "00000000-0000-5000-8000-000000000001",
              "2026-08-01T11:00:00.000Z",
            ),
          ],
        },
        now,
      ),
    ).toThrow(/require a cursor/)
    expect(() =>
      validateNativeAuditSourceBatch(
        "grafana",
        {
          cursor: sourceCursor(
            "2026-08-01T11:00:01.000Z",
            "00000000-0000-5000-8000-000000000001",
          ),
          events: [
            nativeEvent(
              "00000000-0000-5000-8000-000000000001",
              "2026-08-01T11:00:00.000Z",
            ),
            nativeEvent(
              "00000000-0000-5000-8000-000000000001",
              "2026-08-01T11:00:01.000Z",
            ),
          ],
        },
        now,
      ),
    ).toThrow(/must be unique/)
  })

  it.each([
    "host.internal",
    "llmm_private-token",
    "eyJhbGciOiJIUzI1NiJ9.payload.signature",
  ])("rejects unsafe native cursor content %s", (cursor) => {
    expect(() =>
      validateNativeAuditSourceBatch("grafana", { cursor, events: [] }, now),
    ).toThrow()
  })

  it.each([
    ["action", "grafana.dashboard.host.internal"],
    ["recoveryReasonCode", "token_secret-value"],
    ["credentialPrefix", "sk-live-secret123"],
  ])("rejects noncanonical native %s", (field, value) => {
    const event = {
      ...nativeEvent(
        "00000000-0000-5000-8000-000000000001",
        "2026-08-01T11:00:00.000Z",
      ),
      [field]: value,
    }
    expect(() =>
      validateNativeAuditSourceBatch(
        "grafana",
        {
          cursor: sourceCursor(
            event.occurredAt,
            "00000000-0000-5000-8000-000000000001",
          ),
          events: [event as NativeAuditEvent],
        },
        now,
      ),
    ).toThrow()
  })

  it("retains a null subject for a legitimate system-originated event", () => {
    const event = {
      ...nativeEvent(
        "00000000-0000-5000-8000-000000000001",
        "2026-08-01T11:00:00.000Z",
      ),
      keycloakSubjectId: null,
    }
    const validated = validateNativeAuditSourceBatch(
      "grafana",
      {
        cursor: sourceCursor(event.occurredAt, event.eventId),
        events: [event],
      },
      now,
    )

    expect(validated.events[0]?.event.keycloakSubjectId).toBeNull()
  })

  it("distinguishes an unavailable cursor store from unconfigured sources", async () => {
    const database = {
      select: () => {
        throw new Error("database unavailable")
      },
    } as unknown as InferenceCoreDatabase

    const health = await getAuditSourceHealth(database)

    expect(health).toHaveLength(4)
    expect(
      health.every(
        (source) =>
          source.sourceStatus === "unavailable" &&
          source.cursorHealth === "degraded" &&
          source.lastErrorCode === "cursor_store_unavailable",
      ),
    ).toBe(true)
  })
})

function nativeEvent(eventId: string, occurredAt: string): NativeAuditEvent {
  return {
    action: "grafana.dashboard.updated",
    applicationId: null,
    correlationId: "10000000-0000-4000-8000-000000000001",
    credentialPrefix: null,
    credentialRecordId: null,
    eventId,
    keycloakSubjectId: "admin-1",
    occurredAt,
    outcome: "succeeded",
    recoveryReasonCode: null,
    sourceSystem: "grafana",
  }
}

function sourceCursor(watermark: string, tieBreaker: string): string {
  return encodeNativeAuditCursor(watermark, tieBreaker)
}
