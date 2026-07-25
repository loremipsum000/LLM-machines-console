import { afterEach, describe, expect, it, vi } from "vitest"
import { buildServer } from "../index"
import {
  resetGovernanceForTest,
  seedGovernanceForTest,
} from "../services/admin-governance"
import { resetAuditEventsForTest } from "../services/audit"
import { resetHubStateForTest } from "../services/hub"

const adminHeaders = {
  authorization: "Bearer test-service-key",
  "x-llm-machines-keycloak-token": "",
  "x-llm-machines-user-sub": "admin-1",
  "x-llm-machines-user-email": "admin@example.test",
  "x-llm-machines-user-roles": "admin",
}

describe("Admin overview governance federation", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    resetAuditEventsForTest()
    resetGovernanceForTest()
    resetHubStateForTest()
  })

  it("federates policy violations and Pure Mode state into Governance", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    seedGovernanceForTest({
      policyViolations: [
        {
          createdAt: new Date().toISOString(),
          severity: "critical",
        },
        {
          createdAt: new Date().toISOString(),
          severity: "warning",
        },
      ],
      pureMode: {
        active: true,
        affectedComponents: ["builder-worker", "client-agent"],
        updatedAt: new Date().toISOString(),
      },
    })
    const server = buildServer()

    const response = await server.inject({
      method: "GET",
      url: "/api/admin/overview",
      headers: adminHeaders,
    })

    expect(response.statusCode).toBe(200)
    expect(governanceTile(response.json())).toMatchObject({
      sourceStatus: "degraded",
      summary:
        "Governance DB reports 2 policy violations in 24h and Pure Mode active.",
      metrics: expect.arrayContaining([
        expect.objectContaining({
          id: "policy-violations",
          tone: "critical",
          value: "2",
        }),
        expect.objectContaining({
          id: "pure-mode",
          tone: "critical",
          value: "Active",
        }),
      ]),
    })
    await server.close()
  })

  it("marks Governance policy and Pure Mode federation pending when no DB is configured", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const response = await server.inject({
      method: "GET",
      url: "/api/admin/overview",
      headers: adminHeaders,
    })

    expect(response.statusCode).toBe(200)
    expect(governanceTile(response.json())).toMatchObject({
      summary:
        "Publishing and connector gates are enforced; policy and Pure Mode federation is not configured for this BFF.",
      metrics: expect.arrayContaining([
        expect.objectContaining({
          id: "policy-violations",
          value: "Pending",
        }),
        expect.objectContaining({
          id: "pure-mode",
          value: "Pending",
        }),
      ]),
    })
    await server.close()
  })
})

function governanceTile(response: { tiles: Array<{ id: string }> }) {
  return response.tiles.find((tile) => tile.id === "governance")
}
