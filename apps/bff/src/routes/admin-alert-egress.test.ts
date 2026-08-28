import { afterEach, describe, expect, it, vi } from "vitest"
import { buildServer } from "../index"
import { resetAdminAlertEgressForTest } from "../services/admin-alert-egress"
import { resetAuditEventsForTest } from "../services/audit"
import { resetIdempotencyForTest } from "../services/idempotency"

const adminHeaders = humanHeaders("admin", "admin-egress")
const operatorHeaders = humanHeaders("operator", "operator-egress")

describe("Admin alert egress contract", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    resetAdminAlertEgressForTest()
    resetAuditEventsForTest()
    resetIdempotencyForTest()
  })

  it("allows both roles to view the same redacted disabled state", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    for (const headers of [adminHeaders, operatorHeaders]) {
      const response = await server.inject({
        headers,
        method: "GET",
        url: "/api/admin/observability/alert-egress",
      })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toMatchObject({
        deliveryState: "disabled",
        destinationState: "not_stored",
        outboundDeliveryEnabled: false,
        revision: 0,
        runtimeQualified: false,
        secretState: "not_stored",
        transport: "disabled",
      })
    }
    await server.close()
  })

  it("denies Operator mutation even when the request has valid intent", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()
    const response = await server.inject({
      headers: {
        ...operatorHeaders,
        "idempotency-key": "operator-alert-egress-1",
      },
      method: "POST",
      payload: preparedRequest(0, "webhook"),
      url: "/api/admin/observability/alert-egress",
    })

    expect(response.statusCode).toBe(403)
    const current = await server.inject({
      headers: adminHeaders,
      method: "GET",
      url: "/api/admin/observability/alert-egress",
    })
    expect(current.json().revision).toBe(0)
    await server.close()
  })

  it("allows Admin to prepare intent while rejecting destinations and stale revisions", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()
    const prepared = await server.inject({
      headers: {
        ...adminHeaders,
        "idempotency-key": "admin-alert-egress-1",
      },
      method: "POST",
      payload: preparedRequest(0, "smtp"),
      url: "/api/admin/observability/alert-egress",
    })
    const destinationRejected = await server.inject({
      headers: {
        ...adminHeaders,
        "idempotency-key": "admin-alert-egress-destination",
      },
      method: "POST",
      payload: {
        ...preparedRequest(1, "webhook"),
        url: "https://destination.example.test/hook",
      },
      url: "/api/admin/observability/alert-egress",
    })
    const stale = await server.inject({
      headers: {
        ...adminHeaders,
        "idempotency-key": "admin-alert-egress-stale",
      },
      method: "POST",
      payload: preparedRequest(0, "webhook"),
      url: "/api/admin/observability/alert-egress",
    })

    expect(prepared.statusCode).toBe(200)
    expect(prepared.json()).toMatchObject({
      deliveryState: "prepared_pending_runtime_qualification",
      destinationState: "not_stored",
      outboundDeliveryEnabled: false,
      revision: 1,
      runtimeQualified: false,
      secretState: "not_stored",
      transport: "smtp",
    })
    expect(destinationRejected.statusCode).toBe(400)
    expect(stale.statusCode).toBe(409)
    await server.close()
  })
})

function humanHeaders(role: "admin" | "operator", subject: string) {
  return {
    authorization: "Bearer test-service-key",
    "x-llm-machines-keycloak-token": "",
    "x-llm-machines-user-email": `${subject}@example.test`,
    "x-llm-machines-user-roles": role,
    "x-llm-machines-user-sub": subject,
  }
}

function preparedRequest(
  expectedRevision: number,
  transport: "smtp" | "webhook",
) {
  return {
    expectedRevision,
    transport,
    warningAcknowledgement: {
      accepted: true,
      version: "alert-egress-v1",
    },
  }
}
