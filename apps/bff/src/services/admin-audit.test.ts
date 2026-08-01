import { afterEach, describe, expect, it, vi } from "vitest"
import type { Actor } from "../auth/authorization"
import { getAdminAuditTimeline } from "./admin-audit"
import { emitAudit, resetAuditEventsForTest } from "./audit"

const operator: Actor = {
  authMode: "service-forwarded",
  role: "operator",
  subject: "operator-audit",
}

describe("Admin audit timeline", () => {
  afterEach(() => {
    vi.useRealTimers()
    resetAuditEventsForTest()
  })

  it("uses stable cursor pages and reports pending native ingestion honestly", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-08-01T10:00:00.000Z"))
    await emitAudit({
      action: "application.created",
      applicationId: "app-1",
      correlationId: "event-1",
      outcome: "succeeded",
      sourceSystem: "console",
    })
    vi.setSystemTime(new Date("2026-08-01T10:01:00.000Z"))
    await emitAudit({
      action: "application.disabled",
      applicationId: "app-1",
      correlationId: "event-2",
      outcome: "denied",
      sourceSystem: "console",
    })
    vi.setSystemTime(new Date("2026-08-01T10:02:00.000Z"))

    const first = await getAdminAuditTimeline(operator, {
      applicationId: "app-1",
      limit: 1,
    })
    const second = await getAdminAuditTimeline(operator, {
      applicationId: "app-1",
      cursor: first.nextCursor ?? undefined,
      limit: 1,
    })

    expect(first.sourceStatus).toBe("not_configured")
    expect(first.sources).toHaveLength(7)
    expect(
      first.sources
        .filter(
          (source) =>
            source.ingressReadiness ===
            "implemented_pending_runtime_qualification",
        )
        .every((source) => source.sourceStatus === "not_configured"),
    ).toBe(true)
    expect(first.events).toHaveLength(1)
    expect(second.events).toHaveLength(1)
    expect(second.events[0]?.id).not.toBe(first.events[0]?.id)
    expect(second.nextCursor).toBeNull()
  })

  it("applies explicit source, outcome, severity, and Application filters", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-08-01T10:00:00.000Z"))
    await emitAudit({
      action: "application.created",
      applicationId: "app-1",
      correlationId: "event-1",
      outcome: "succeeded",
      sourceSystem: "console",
    })
    await emitAudit({
      action: "application.denied",
      applicationId: "app-2",
      correlationId: "event-2",
      outcome: "denied",
      sourceSystem: "console",
    })

    const response = await getAdminAuditTimeline(operator, {
      applicationId: "app-2",
      outcome: "denied",
      severity: "warning",
      sourceSystem: "console",
    })

    expect(response).toMatchObject({
      selectedApplicationId: "app-2",
      selectedOutcome: "denied",
      selectedSeverity: "warning",
      selectedSource: "console",
    })
    expect(response.events).toEqual([
      expect.objectContaining({
        outcome: "denied",
        severity: "warning",
        sourceSystem: "console",
      }),
    ])
  })
})
