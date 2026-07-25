import { describe, expect, it } from "vitest"
import {
  agenticAdapterRevokeEgressRequestSchema,
  agenticAdapterRevokeEgressResponseSchema,
  agenticRuntimeHistoryResponseSchema,
} from "./common"

describe("Common contracts", () => {
  it("parses agentic runtime history and SLO summaries", () => {
    const response = agenticRuntimeHistoryResponseSchema.parse({
      generatedAt: "2026-05-21T12:00:00.000Z",
      windowHours: 24,
      samples: [
        {
          runtime: "openclaw",
          profile: "openclaw-restricted",
          configured: true,
          healthy: true,
          baseUrl: "https://litellm.example.test",
          detail: "HTTP 200",
          capturedAt: "2026-05-21T11:59:00.000Z",
        },
      ],
      slos: [
        {
          runtime: "openclaw",
          profile: "openclaw-restricted",
          windowHours: 24,
          status: "healthy",
          sampleCount: 1,
          configuredSamples: 1,
          healthySamples: 1,
          uptimePercent: 100,
          lastHealthyAt: "2026-05-21T11:59:00.000Z",
          lastUnhealthyAt: null,
        },
      ],
    })

    expect(response.slos[0]?.uptimePercent).toBe(100)
  })

  it("parses agentic egress revocation requests and responses", () => {
    const request = agenticAdapterRevokeEgressRequestSchema.parse({
      approvalId: "00000000-0000-4000-8000-000000000001",
      revokedBy: "admin-1",
      sandboxName: "openclaw-restricted",
      profile: "openclaw-restricted",
      endpointHost: "api.github.com",
      endpointPort: 443,
      reason: "Rollback test approval",
    })
    const response = agenticAdapterRevokeEgressResponseSchema.parse({
      approvalId: request.approvalId,
      sandboxName: request.sandboxName,
      endpoint: "api.github.com:443",
      status: "revoked",
      command: ["openshell", "policy", "update"],
      stdout: "",
      stderr: "",
    })

    expect(response.status).toBe("revoked")
  })
})
