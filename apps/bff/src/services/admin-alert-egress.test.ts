import { afterEach, describe, expect, it } from "vitest"
import type { Actor } from "../auth/authorization"
import {
  AdminAlertEgressConflictError,
  getAdminAlertEgress,
  resetAdminAlertEgressForTest,
  updateAdminAlertEgress,
} from "./admin-alert-egress"
import { getAuditEventsForTest, resetAuditEventsForTest } from "./audit"

const admin: Actor = {
  authMode: "service-forwarded",
  role: "admin",
  subject: "admin-alert-egress",
}

describe("redacted alert egress intent", () => {
  afterEach(() => {
    resetAdminAlertEgressForTest()
    resetAuditEventsForTest()
  })

  it("starts disabled without a destination or secret", async () => {
    await expect(getAdminAlertEgress()).resolves.toEqual({
      deliveryState: "disabled",
      destinationState: "not_stored",
      outboundDeliveryEnabled: false,
      revision: 0,
      runtimeQualified: false,
      secretState: "not_stored",
      transport: "disabled",
      updatedAt: null,
      updatedBySubjectId: null,
      warningAcknowledgedAt: null,
      warningAcknowledgedBySubjectId: null,
      warningVersion: null,
    })
  })

  it("records only prepared transport intent and warning acknowledgement", async () => {
    const result = await updateAdminAlertEgress(admin, "request-alert-egress", {
      expectedRevision: 0,
      transport: "webhook",
      warningAcknowledgement: {
        accepted: true,
        version: "alert-egress-v1",
      },
    })

    expect(result).toMatchObject({
      deliveryState: "prepared_pending_runtime_qualification",
      destinationState: "not_stored",
      outboundDeliveryEnabled: false,
      revision: 1,
      runtimeQualified: false,
      secretState: "not_stored",
      transport: "webhook",
      warningAcknowledgedBySubjectId: admin.subject,
      warningVersion: "alert-egress-v1",
    })
    for (const forbiddenField of [
      "destinationUrl",
      "email",
      "host",
      "password",
      "recipient",
      "token",
    ]) {
      expect(result).not.toHaveProperty(forbiddenField)
    }
    expect(getAuditEventsForTest()).toEqual([
      expect.objectContaining({
        action: "admin.observability.alert_egress.updated",
        correlationId: "request-alert-egress",
        keycloakSubjectId: admin.subject,
        outcome: "succeeded",
      }),
    ])
  })

  it("rejects a stale revision without writing another audit record", async () => {
    const request = {
      expectedRevision: 0,
      transport: "smtp" as const,
      warningAcknowledgement: {
        accepted: true as const,
        version: "alert-egress-v1" as const,
      },
    }
    await updateAdminAlertEgress(admin, "first-request", request)

    await expect(
      updateAdminAlertEgress(admin, "stale-request", request),
    ).rejects.toBeInstanceOf(AdminAlertEgressConflictError)
    expect(getAuditEventsForTest()).toHaveLength(1)
  })

  it("returns to local-only state without retaining acknowledgement metadata", async () => {
    const prepared = await updateAdminAlertEgress(admin, "prepare-request", {
      expectedRevision: 0,
      transport: "smtp",
      warningAcknowledgement: {
        accepted: true,
        version: "alert-egress-v1",
      },
    })
    const disabled = await updateAdminAlertEgress(admin, "disable-request", {
      expectedRevision: prepared.revision,
      transport: "disabled",
      warningAcknowledgement: null,
    })

    expect(disabled).toMatchObject({
      deliveryState: "disabled",
      revision: 2,
      transport: "disabled",
      warningAcknowledgedAt: null,
      warningAcknowledgedBySubjectId: null,
      warningVersion: null,
    })
  })
})
