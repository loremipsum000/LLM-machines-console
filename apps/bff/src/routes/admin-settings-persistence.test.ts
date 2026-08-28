import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("../config/fixture-mode", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config/fixture-mode")>()
  return {
    ...actual,
    canUseBffFixtureData: () => false,
  }
})

import { buildServer } from "../index"
import { resetAdminSettingsCoreForTest } from "../services/admin-settings-core"
import {
  getAuditEventsForTest,
  resetAuditEventsForTest,
} from "../services/audit"
import { resetIdempotencyForTest } from "../services/idempotency"

const adminHeaders = {
  authorization: "Bearer test-service-key",
  "x-llm-machines-keycloak-token": "",
  "x-llm-machines-user-sub": "admin-1",
  "x-llm-machines-user-email": "admin@example.test",
  "x-llm-machines-user-roles": "admin",
}

describe("Settings persistence route boundary", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    resetAdminSettingsCoreForTest()
    resetAuditEventsForTest()
    resetIdempotencyForTest()
  })

  it("returns 503 without PostgreSQL and emits no success audit", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("DATABASE_URL", "")
    const server = buildServer()

    const organization = await server.inject({
      method: "POST",
      url: "/api/admin/settings/organization",
      headers: {
        ...adminHeaders,
        "idempotency-key": "settings-persistence-organization",
      },
      payload: {
        defaultLanguage: "en",
        organizationName: "Unavailable persistence",
      },
    })
    const telemetry = await server.inject({
      method: "POST",
      url: "/api/admin/settings/telemetry",
      headers: {
        ...adminHeaders,
        "idempotency-key": "settings-persistence-telemetry",
      },
      payload: {
        confirmation: "ENABLE TELEMETRY",
        enabled: true,
      },
    })

    expect(organization.statusCode).toBe(503)
    expect(organization.json()).toMatchObject({ status: 503 })
    expect(telemetry.statusCode).toBe(503)
    expect(telemetry.json()).toMatchObject({ status: 503 })
    expect(
      getAuditEventsForTest().filter((event) =>
        event.action.startsWith("admin.settings."),
      ),
    ).toEqual([])
    await server.close()
  })
})
