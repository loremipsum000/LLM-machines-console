import { readFileSync } from "node:fs"
import { afterEach, describe, expect, it, vi } from "vitest"
import { buildServer } from "../index"
import { resetConnectedAppsForTest } from "../services/admin-connected-apps"
import { resetAdminSettingsCoreForTest } from "../services/admin-settings-core"
import { resetAdminTeamStateForTest } from "../services/admin-team"
import {
  emitAudit,
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

const unclassifiedHeaders = {
  ...adminHeaders,
  "x-llm-machines-user-sub": "unclassified-1",
  "x-llm-machines-user-roles": "unclassified",
}

describe("Inference Core Admin routes", () => {
  afterEach(async () => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    resetAuditEventsForTest()
    resetAdminSettingsCoreForTest()
    resetAdminTeamStateForTest()
    resetIdempotencyForTest()
    await resetConnectedAppsForTest()
  })

  it("requires Admin authentication for the retained Admin surface", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()
    const unauthenticated = await server.inject({
      method: "GET",
      url: "/api/admin/overview",
    })
    const wrongRole = await server.inject({
      method: "GET",
      url: "/api/admin/overview",
      headers: unclassifiedHeaders,
    })

    expect(unauthenticated.statusCode).toBe(401)
    expect(wrongRole.statusCode).toBe(401)
    expect(getAuditEventsForTest()).toHaveLength(2)
    expect(getAuditEventsForTest()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "auth.denied",
          outcome: "denied",
          sourceSystem: "console",
        }),
      ]),
    )
    await server.close()
  })

  it("returns the retained Settings projection", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()
    const response = await server.inject({
      method: "GET",
      url: "/api/admin/settings",
      headers: adminHeaders,
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      organization: {
        organizationName: "LLM Machines",
        defaultLanguage: "en",
      },
      privacy: {
        telemetryEnabled: false,
      },
      systemUpdate: {
        status: "not_configured",
        updateActionEnabled: false,
      },
    })
    expect(response.json()).not.toHaveProperty("urlPolicyRules")
    expect(
      response.json().reachability.map((service: { id: string }) => service.id),
    ).toEqual([
      "web",
      "bff",
      "postgres",
      "keycloak",
      "litellm",
      "grafana",
      "prometheus",
      "alertmanager",
      "firecrawl",
      "lifecycle",
    ])
    await server.close()
  })

  it("preserves organization and privacy mutations with idempotency", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()
    const organization = await server.inject({
      method: "POST",
      url: "/api/admin/settings/organization",
      headers: {
        ...adminHeaders,
        "idempotency-key": "settings-organization-1",
      },
      payload: {
        organizationName: "Example Appliance",
        defaultLanguage: "hr",
      },
    })
    const rejectedTelemetry = await server.inject({
      method: "POST",
      url: "/api/admin/settings/telemetry",
      headers: {
        ...adminHeaders,
        "idempotency-key": "settings-telemetry-rejected",
      },
      payload: { enabled: true },
    })
    const telemetry = await server.inject({
      method: "POST",
      url: "/api/admin/settings/telemetry",
      headers: {
        ...adminHeaders,
        "idempotency-key": "settings-telemetry-1",
      },
      payload: {
        enabled: true,
        confirmation: "ENABLE TELEMETRY",
      },
    })

    expect(organization.statusCode).toBe(200)
    expect(organization.json().organization).toMatchObject({
      organizationName: "Example Appliance",
      defaultLanguage: "hr",
    })
    expect(rejectedTelemetry.statusCode).toBe(400)
    expect(telemetry.statusCode).toBe(200)
    expect(telemetry.json().privacy.telemetryEnabled).toBe(true)
    await server.close()
  })

  it("filters unclassified Keycloak users and protects the last Operator", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    stubKeycloakAdminEnv()
    const mutations: string[] = []
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input, init) => {
        const url = new URL(input.toString())
        const method = init?.method ?? "GET"
        if (method === "PUT" || method === "DELETE") {
          mutations.push(`${method} ${url.pathname}`)
        }
        if (url.pathname.endsWith("/protocol/openid-connect/token")) {
          return jsonResponse({ access_token: "admin-token", expires_in: 60 })
        }
        if (url.pathname.endsWith("/users") && url.searchParams.has("max")) {
          return jsonResponse([
            keycloakUser("operator-1", "operator"),
            keycloakUser("unclassified-1", "unclassified"),
          ])
        }
        if (url.pathname.endsWith("/groups") && url.searchParams.has("max")) {
          return jsonResponse([])
        }
        if (url.pathname.endsWith("/users/operator-1")) {
          return jsonResponse(keycloakUser("operator-1", "operator"))
        }
        if (url.pathname.endsWith("/users/unclassified-1")) {
          return jsonResponse(keycloakUser("unclassified-1", "unclassified"))
        }
        if (url.pathname.includes("/groups")) {
          return jsonResponse([])
        }
        if (url.pathname.endsWith("/role-mappings/realm")) {
          return jsonResponse(
            url.pathname.includes("operator-1")
              ? [{ id: "role-operator", name: "operator" }]
              : [],
          )
        }
        return jsonResponse({})
      }),
    )
    const server = buildServer()
    const overview = await server.inject({
      method: "GET",
      url: "/api/admin/team",
      headers: adminHeaders,
    })
    const operator = await server.inject({
      method: "GET",
      url: "/api/admin/team/members/operator-1",
      headers: adminHeaders,
    })
    const unclassified = await server.inject({
      method: "GET",
      url: "/api/admin/team/members/unclassified-1",
      headers: adminHeaders,
    })
    const disable = await server.inject({
      method: "POST",
      url: "/api/admin/team/members/operator-1/disable",
      headers: {
        ...adminHeaders,
        "idempotency-key": "last-operator-disable",
      },
    })
    const disableReplay = await server.inject({
      method: "POST",
      url: "/api/admin/team/members/operator-1/disable",
      headers: {
        ...adminHeaders,
        "idempotency-key": "last-operator-disable",
      },
    })

    expect(overview.statusCode).toBe(200)
    expect(overview.json()).not.toHaveProperty("breakGlass")
    expect(overview.json().members).toEqual([
      expect.objectContaining({ id: "operator-1", role: "operator" }),
    ])
    expect(operator.statusCode).toBe(200)
    expect(operator.json().usage).toEqual({
      mostUsedModel: null,
      prompts: 0,
      sourceStatus: "not_configured",
      tokens: 0,
      window: "30d",
    })
    expect(JSON.stringify(getAuditEventsForTest())).not.toMatch(
      /model|promptTokens|totalTokens/,
    )
    expect(unclassified.statusCode).toBe(409)
    expect(unclassified.json().detail).toMatch(/explicit Admin or Operator/)
    expect(disable.statusCode).toBe(409)
    expect(disable.json().detail).toMatch(/last enabled Operator/)
    expect(disableReplay.statusCode).toBe(409)
    expect(disableReplay.json()).toMatchObject({
      outcome: "failed",
      status: "already_completed",
    })
    expect(mutations).toEqual([])
    await server.close()
  })

  it("requires reconciliation when a failed Team mutation cannot finalize its receipt", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    stubKeycloakAdminEnv()
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input) => {
        const url = new URL(input.toString())
        if (url.pathname.endsWith("/protocol/openid-connect/token")) {
          return jsonResponse({ access_token: "admin-token", expires_in: 60 })
        }
        if (url.pathname.endsWith("/users") && url.searchParams.has("max")) {
          resetIdempotencyForTest()
          return jsonResponse([keycloakUser("operator-1", "operator")])
        }
        if (url.pathname.includes("/groups")) {
          return jsonResponse([])
        }
        if (url.pathname.endsWith("/role-mappings/realm")) {
          return jsonResponse([{ id: "role-operator", name: "operator" }])
        }
        return jsonResponse({})
      }),
    )
    const server = buildServer()

    const response = await server.inject({
      method: "POST",
      url: "/api/admin/team/members/operator-1/disable",
      headers: {
        ...adminHeaders,
        "idempotency-key": "lost-team-failure-receipt",
      },
    })

    expect(response.statusCode).toBe(503)
    expect(response.json()).toMatchObject({
      status: 503,
      title: "Idempotency completion unavailable",
    })
    expect(response.json().detail).toMatch(/Reconcile the resource/)
    await server.close()
  })

  it("rejects disallowed audit fields and never retains audit search terms", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const disallowedEvent = {
      action: "gateway.request.completed",
      correlationId: "correlation-rejected",
      outcome: "succeeded",
      prompt: "private prompt",
      sourceSystem: "console",
    } as const
    await expect(emitAudit(disallowedEvent)).rejects.toThrow(
      /unsupported field prompt/,
    )

    await emitAudit({
      action: "gateway.request.completed",
      applicationId: "app-1",
      correlationId: "correlation-1",
      credentialRecordId: "credential-1",
      keycloakSubjectId: "subject-1",
      outcome: "succeeded",
      sourceSystem: "console",
    })

    expect(getAuditEventsForTest()[0]).toMatchObject({
      action: "gateway.request.completed",
      applicationId: "app-1",
      correlationId: "correlation-1",
      credentialRecordId: "credential-1",
      keycloakSubjectId: "subject-1",
      metadata: {
        applicationId: "app-1",
        correlationId: "correlation-1",
        credentialRecordId: "credential-1",
        keycloakSubjectId: "subject-1",
        outcome: "succeeded",
        sourceSystem: "console",
      },
      outcome: "succeeded",
      sourceSystem: "console",
    })

    const server = buildServer()
    const response = await server.inject({
      method: "GET",
      url: "/api/admin/audit?q=private%20search%20terms",
      headers: adminHeaders,
    })
    expect(response.statusCode).toBe(200)
    expect(response.json().query).toBe("private search terms")
    expect(JSON.stringify(getAuditEventsForTest())).not.toMatch(
      /private prompt|private search terms/,
    )
    await server.close()
  })

  it("returns the retained overview, applications, hardware, and inference projections", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()
    const [overview, applications, hardware, inference] = await Promise.all([
      server.inject({
        method: "GET",
        url: "/api/admin/overview",
        headers: adminHeaders,
      }),
      server.inject({
        method: "GET",
        url: "/api/admin/applications/connected-apps",
        headers: adminHeaders,
      }),
      server.inject({
        method: "GET",
        url: "/api/admin/hardware",
        headers: adminHeaders,
      }),
      server.inject({
        method: "GET",
        url: "/api/admin/inference",
        headers: adminHeaders,
      }),
    ])

    expect(overview.statusCode).toBe(200)
    expect(
      overview.json().tiles.map((tile: { id: string }) => tile.id),
    ).toEqual(["applications", "inference", "hardware", "system"])
    expect(
      overview
        .json()
        .tiles.every((tile: { href: string }) => tile.href.startsWith("/")),
    ).toBe(true)
    expect(applications.statusCode).toBe(200)
    expect(applications.json()).toHaveProperty("apps")
    expect(hardware.statusCode).toBe(200)
    expect(inference.statusCode).toBe(200)
    await server.close()
  })

  it("keeps retained modules on direct inference-core dependencies", () => {
    const files = [
      "../index.ts",
      "./admin.ts",
      "../services/admin-overview.ts",
      "../services/admin-ops.ts",
      "../services/admin-settings-core.ts",
      "../services/admin-team.ts",
    ]
    const source = files
      .map((file) => readFileSync(new URL(file, import.meta.url), "utf8"))
      .join("\n")

    expect(source).toContain("@llm-machines/contracts/inference-core")
    expect(source).not.toContain('from "@llm-machines/contracts"')
  })
})

function stubKeycloakAdminEnv(): void {
  vi.stubEnv("KEYCLOAK_ADMIN_BASE_URL", "https://keycloak.example/keycloak")
  vi.stubEnv("KEYCLOAK_ADMIN_CLIENT_ID", "console-team")
  vi.stubEnv("KEYCLOAK_ADMIN_CLIENT_SECRET", "admin-client-secret")
  vi.stubEnv("KEYCLOAK_ADMIN_REALM", "llm-machines")
  vi.stubEnv("TEAM_ALLOWED_EMAIL_DOMAINS", "example.test")
}

function keycloakUser(id: string, username: string) {
  return {
    id,
    username,
    email: `${username}@example.test`,
    enabled: true,
    firstName: username,
    lastName: "User",
    createdTimestamp: Date.now(),
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  })
}
