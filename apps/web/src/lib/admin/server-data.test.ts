import { afterEach, describe, expect, it, vi } from "vitest"
import { getBffForwardedIdentity } from "@/lib/auth/session"
import {
  adminConnectedApps,
  adminConnectorRegistry,
  adminHardware,
  adminInference,
  adminSettings,
  adminTeamOverview,
} from "@/lib/admin/mock-data"
import {
  getAdminConnectorRegistry,
  getAdminConnectedApps,
  getAdminConnectedAppDetail,
  getAdminMcpServerDetail,
  getAdminHardware,
  getAdminKnowledgeRetrievalTest,
  getAdminInference,
  getAdminSettings,
  getAdminTeamGroupDetail,
  getAdminTeamMemberDetail,
  getAdminTeamOverview,
  ConsoleBffAuthExpiredError,
} from "@/lib/admin/server-data"
import { knowledgeRetrievalTestResult } from "@/lib/knowledge/mock-data"

vi.mock("@/lib/auth/session", () => ({
  getBffForwardedIdentity: vi.fn(),
}))

describe("Admin server data loader", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it("fails closed when the BFF is not configured", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
    vi.stubEnv("CONSOLE_WEB_FIXTURE_MODE", "true")

    await expect(getAdminHardware()).rejects.toThrow(
      "Console BFF is not available for /api/admin/hardware",
    )
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("fetches Admin hardware with range filters", async () => {
    vi.stubEnv("CONSOLE_BFF_URL", "http://bff.test")
    vi.stubEnv("CONSOLE_BFF_SERVICE_API_KEY", "service-key")
    vi.mocked(getBffForwardedIdentity).mockResolvedValue({
      accessToken: "keycloak-access-token",
      email: "admin@example.test",
      roles: ["admin"],
      subject: "admin-1",
    })
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify(adminHardware), { status: 200 }),
      )

    await expect(getAdminHardware({ range: "24h" })).resolves.toMatchObject({
      charts: expect.arrayContaining([
        expect.objectContaining({ id: "gpu_temperature" }),
      ]),
    })
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://bff.test/api/admin/hardware?range=24h",
      expect.objectContaining({
        cache: "no-store",
        headers: expect.objectContaining({
          Authorization: "Bearer service-key",
          "x-llm-machines-user-sub": "admin-1",
        }),
      }),
    )
  })

  it("classifies BFF 401 responses as expired Console authentication", async () => {
    vi.stubEnv("CONSOLE_BFF_URL", "http://bff.test")
    vi.stubEnv("CONSOLE_BFF_SERVICE_API_KEY", "service-key")
    vi.mocked(getBffForwardedIdentity).mockResolvedValue({
      accessToken: "stale-keycloak-access-token",
      email: "admin@example.test",
      roles: ["admin"],
      subject: "admin-1",
    })
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ title: "Unauthorized" }), {
        status: 401,
      }),
    )

    await expect(getAdminHardware()).rejects.toBeInstanceOf(
      ConsoleBffAuthExpiredError,
    )
  })

  it("fetches Admin inference with range filters", async () => {
    vi.stubEnv("CONSOLE_BFF_URL", "http://bff.test")
    vi.stubEnv("CONSOLE_BFF_SERVICE_API_KEY", "service-key")
    vi.mocked(getBffForwardedIdentity).mockResolvedValue({
      accessToken: "keycloak-access-token",
      email: "admin@example.test",
      roles: ["admin"],
      subject: "admin-1",
    })
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify(adminInference), { status: 200 }),
      )

    await expect(getAdminInference({ range: "90d" })).resolves.toMatchObject({
      modelUsage: expect.arrayContaining([
        expect.objectContaining({ model: "qwen3:32b" }),
      ]),
    })
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://bff.test/api/admin/inference?range=90d",
      expect.objectContaining({
        cache: "no-store",
        headers: expect.objectContaining({
          Authorization: "Bearer service-key",
          "x-llm-machines-user-sub": "admin-1",
        }),
      }),
    )
  })

  it("fetches Admin connector registry with forwarded identity and search", async () => {
    vi.stubEnv("CONSOLE_BFF_URL", "http://bff.test")
    vi.stubEnv("CONSOLE_BFF_SERVICE_API_KEY", "service-key")
    vi.mocked(getBffForwardedIdentity).mockResolvedValue({
      accessToken: "keycloak-access-token",
      email: "admin@example.test",
      roles: ["admin"],
      subject: "admin-1",
    })
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify(adminConnectorRegistry), { status: 200 }),
      )

    await expect(
      getAdminConnectorRegistry({ query: "internal" }),
    ).resolves.toMatchObject({
      summary: expect.objectContaining({
        pendingCount: 0,
      }),
    })
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://bff.test/api/admin/agents/registry?q=internal",
      expect.objectContaining({
        cache: "no-store",
        headers: expect.objectContaining({
          Authorization: "Bearer service-key",
          "x-llm-machines-user-sub": "admin-1",
        }),
      }),
    )
  })

  it("fetches Admin connected apps without exposing credentials", async () => {
    vi.stubEnv("CONSOLE_BFF_URL", "http://bff.test")
    vi.stubEnv("CONSOLE_BFF_SERVICE_API_KEY", "service-key")
    vi.mocked(getBffForwardedIdentity).mockResolvedValue({
      accessToken: "keycloak-access-token",
      email: "admin@example.test",
      roles: ["admin"],
      subject: "admin-1",
    })
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify(adminConnectedApps), { status: 200 }),
      )

    const response = await getAdminConnectedApps()

    expect(response.apps).toHaveLength(2)
    expect(response.apps[0]).toMatchObject({
      id: "connected-app-claims-portal",
      ownerGroup: "Everyone",
      usage: expect.objectContaining({
        requests7d: 842,
        tokens7d: 284_000,
      }),
    })
    expect(JSON.stringify(response)).not.toContain("clientSecret")
    expect(JSON.stringify(response)).not.toContain("client_secret")
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://bff.test/api/admin/applications/connected-apps",
      expect.objectContaining({
        cache: "no-store",
      }),
    )
  })

  it("fetches connected app detail without returning a secret", async () => {
    vi.stubEnv("CONSOLE_BFF_URL", "http://bff.test")
    vi.stubEnv("CONSOLE_BFF_SERVICE_API_KEY", "service-key")
    vi.mocked(getBffForwardedIdentity).mockResolvedValue({
      accessToken: "keycloak-access-token",
      email: "admin@example.test",
      roles: ["admin"],
      subject: "admin-1",
    })
    const app = adminConnectedApps.apps[0]
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ app }), { status: 200 }),
      )

    const response = await getAdminConnectedAppDetail(app.id)

    expect(response?.app.id).toBe(app.id)
    expect(JSON.stringify(response)).not.toContain("clientSecret")
    expect(JSON.stringify(response)).not.toContain("shown-once-secret")
    expect(fetchSpy).toHaveBeenCalledWith(
      `http://bff.test/api/admin/applications/connected-apps/${app.id}`,
      expect.objectContaining({
        cache: "no-store",
      }),
    )
  })

  it("fetches Admin-created MCP server detail and treats managed connectors as non-editable", async () => {
    vi.stubEnv("CONSOLE_BFF_URL", "http://bff.test")
    vi.stubEnv("CONSOLE_BFF_SERVICE_API_KEY", "service-key")
    vi.mocked(getBffForwardedIdentity).mockResolvedValue({
      accessToken: "keycloak-access-token",
      email: "admin@example.test",
      roles: ["admin"],
      subject: "admin-1",
    })
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            accessGroups: ["Finance"],
            accessLevel: "read_only",
            auditHref: "#audit-log-deferred",
            authMode: "none",
            bearerTokenSecretRef: null,
            chatCommand: "@docs-mcp",
            createdAt: "2026-05-29T12:00:00.000Z",
            description: "Documentation MCP server.",
            endpointUrl: "https://mcp.example.test/rpc",
            id: "docs-mcp",
            name: "Docs MCP",
            status: "enabled",
            stdioCommand: null,
            supportTier: "t3",
            transport: "url",
            updatedAt: "2026-05-29T12:00:00.000Z",
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ title: "Managed MCP server" }), {
          status: 403,
        }),
      )

    await expect(getAdminMcpServerDetail("docs-mcp")).resolves.toMatchObject({
      id: "docs-mcp",
      supportTier: "t3",
    })
    await expect(getAdminMcpServerDetail("internal-docs")).resolves.toBeNull()
    expect(fetchSpy).toHaveBeenNthCalledWith(
      1,
      "http://bff.test/api/admin/mcp-servers/docs-mcp",
      expect.objectContaining({
        cache: "no-store",
      }),
    )
  })

  it("fetches Admin Settings with forwarded identity", async () => {
    vi.stubEnv("CONSOLE_BFF_URL", "http://bff.test")
    vi.stubEnv("CONSOLE_BFF_SERVICE_API_KEY", "service-key")
    vi.mocked(getBffForwardedIdentity).mockResolvedValue({
      accessToken: "keycloak-access-token",
      email: "admin@example.test",
      roles: ["admin"],
      subject: "admin-1",
    })
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify(adminSettings), { status: 200 }),
      )

    await expect(getAdminSettings()).resolves.toMatchObject({
      organization: {
        organizationName: "LLM Machines",
      },
      systemUpdate: {
        status: "not_configured",
        updateActionEnabled: false,
      },
    })
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://bff.test/api/admin/settings",
      expect.objectContaining({
        cache: "no-store",
        headers: expect.objectContaining({
          Authorization: "Bearer service-key",
          "x-llm-machines-user-sub": "admin-1",
        }),
      }),
    )
  })

  it("fetches Team overview with forwarded identity", async () => {
    vi.stubEnv("CONSOLE_BFF_URL", "http://bff.test")
    vi.stubEnv("CONSOLE_BFF_SERVICE_API_KEY", "service-key")
    vi.mocked(getBffForwardedIdentity).mockResolvedValue({
      accessToken: "keycloak-access-token",
      email: "admin@example.test",
      roles: ["admin"],
      subject: "admin-1",
    })
    const overview = {
      ...adminTeamOverview,
      members: [
        {
          createdAt: "2026-05-29T12:00:00.000Z",
          displayName: "Ada Lovelace",
          email: "ada@example.test",
          enabled: true,
          groups: ["Engineering"],
          id: "kc-user-1",
          keycloakHref:
            "https://keycloak.example.test/admin/master/users/kc-user-1",
          lastActiveAt: "2026-05-29T12:15:00.000Z",
          role: "builder",
          status: "active",
          username: "ada.lovelace",
        },
      ],
      serviceStatus: "ok",
      sourceStatus: "ok",
    }
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify(overview), { status: 200 }))

    await expect(getAdminTeamOverview()).resolves.toMatchObject({
      members: [expect.objectContaining({ username: "ada.lovelace" })],
      serviceStatus: "ok",
    })
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://bff.test/api/admin/team",
      expect.objectContaining({
        cache: "no-store",
        headers: expect.objectContaining({
          Authorization: "Bearer service-key",
          "x-llm-machines-user-sub": "admin-1",
        }),
      }),
    )
  })

  it("fetches Team member detail and returns null for missing members", async () => {
    vi.stubEnv("CONSOLE_BFF_URL", "http://bff.test")
    vi.stubEnv("CONSOLE_BFF_SERVICE_API_KEY", "service-key")
    vi.mocked(getBffForwardedIdentity).mockResolvedValue({
      accessToken: "keycloak-access-token",
      email: "admin@example.test",
      roles: ["admin"],
      subject: "admin-1",
    })
    const detail = {
      activity: [
        {
          action: "knowledge.publish",
          createdAt: "2026-05-29T12:15:00.000Z",
          href: "#audit-log-deferred",
          id: "audit-1",
          targetId: "corpus-1",
          targetType: "corpus",
        },
      ],
      member: {
        createdAt: "2026-05-29T12:00:00.000Z",
        displayName: "Ada Lovelace",
        email: "ada@example.test",
        enabled: true,
        groups: ["Engineering"],
        id: "kc-user-1",
        keycloakHref:
          "https://keycloak.example.test/admin/master/users/kc-user-1",
        lastActiveAt: "2026-05-29T12:15:00.000Z",
        role: "builder",
        status: "active",
        username: "ada.lovelace",
      },
      usage: {
        mcpCalls: 3,
        mostUsedModel: "llama-3.1",
        prompts: 12,
        sourceStatus: "ok",
        tokens: 4200,
        window: "30d",
      },
    }
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify(detail), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response("{}", { status: 404 }))

    await expect(getAdminTeamMemberDetail("kc-user-1")).resolves.toMatchObject({
      member: expect.objectContaining({ username: "ada.lovelace" }),
      usage: expect.objectContaining({ mcpCalls: 3 }),
    })
    await expect(getAdminTeamMemberDetail("missing")).resolves.toBeNull()
    expect(fetchSpy).toHaveBeenNthCalledWith(
      1,
      "http://bff.test/api/admin/team/members/kc-user-1",
      expect.objectContaining({ cache: "no-store" }),
    )
  })

  it("fetches Team group detail and returns null for missing groups", async () => {
    vi.stubEnv("CONSOLE_BFF_URL", "http://bff.test")
    vi.stubEnv("CONSOLE_BFF_SERVICE_API_KEY", "service-key")
    vi.mocked(getBffForwardedIdentity).mockResolvedValue({
      accessToken: "keycloak-access-token",
      email: "admin@example.test",
      roles: ["admin"],
      subject: "admin-1",
    })
    const detail = {
      group: {
        id: "group-engineering",
        keycloakHref:
          "https://keycloak.example.test/admin/master/groups/group-engineering",
        memberCount: 1,
        name: "Engineering",
        unlockCount: 1,
        virtual: false,
      },
      members: [],
      unlocks: [
        {
          href: "/knowledge?corpus=corpus-1",
          id: "corpus-1",
          name: "Engineering corpus",
          type: "corpus",
        },
      ],
    }
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify(detail), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response("{}", { status: 404 }))

    await expect(getAdminTeamGroupDetail("group-engineering")).resolves.toMatchObject({
      group: expect.objectContaining({ name: "Engineering" }),
      unlocks: [expect.objectContaining({ type: "corpus" })],
    })
    await expect(getAdminTeamGroupDetail("missing")).resolves.toBeNull()
    expect(fetchSpy).toHaveBeenNthCalledWith(
      1,
      "http://bff.test/api/admin/team/groups/group-engineering",
      expect.objectContaining({ cache: "no-store" }),
    )
  })

  it("fetches Admin knowledge retrieval-test with POST body and forwarded identity", async () => {
    vi.stubEnv("CONSOLE_BFF_URL", "http://bff.test")
    vi.stubEnv("CONSOLE_BFF_SERVICE_API_KEY", "service-key")
    vi.mocked(getBffForwardedIdentity).mockResolvedValue({
      accessToken: "keycloak-access-token",
      email: "admin@example.test",
      roles: ["admin"],
      subject: "admin-1",
    })
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(knowledgeRetrievalTestResult), {
        status: 200,
      }),
    )

    await expect(
      getAdminKnowledgeRetrievalTest(
        "11111111-1111-4111-8111-111111111111",
        "korpuse znanja",
      ),
    ).resolves.toMatchObject({
      citations: expect.arrayContaining([
        expect.objectContaining({ checksum: "sha256:hr-policy" }),
      ]),
    })
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://bff.test/api/admin/knowledge/corpora/11111111-1111-4111-8111-111111111111/retrieval-test",
      expect.objectContaining({
        body: JSON.stringify({
          corpusIds: ["11111111-1111-4111-8111-111111111111"],
          query: "korpuse znanja",
          topK: 5,
        }),
        cache: "no-store",
        headers: expect.objectContaining({
          Authorization: "Bearer service-key",
          "Content-Type": "application/json",
          "x-llm-machines-user-sub": "admin-1",
        }),
        method: "POST",
      }),
    )
  })
})
