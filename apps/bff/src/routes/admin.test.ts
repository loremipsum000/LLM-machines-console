import { afterEach, describe, expect, it, vi } from "vitest"
import { buildServer } from "../index"
import {
  adminMcpServerUnlocksForAccessGroup,
  createAdminMcpServer,
  resetConnectorVettingDecisionsForTest,
} from "../services/admin-connector-registry"
import { resetConnectedAppsForTest } from "../services/admin-connected-apps"
import { resetAdminSettingsForTest } from "../services/admin-settings"
import {
  emitAudit,
  getAuditEventsForTest,
  resetAuditEventsForTest,
} from "../services/audit"
import {
  resetAdminTeamStateForTest,
  setBreakGlassAdminForTest,
} from "../services/admin-team"
import { resetBuilderStateForTest } from "../services/builder"
import { resetHubStateForTest } from "../services/hub"
import { resetIdempotencyForTest } from "../services/idempotency"
import {
  createKnowledgeCorpus,
  knowledgeUnlocksForAccessGroup,
  resetKnowledgeStateForTest,
} from "../services/knowledge/admin"

const adminHeaders = {
  authorization: "Bearer test-service-key",
  "x-llm-machines-keycloak-token": "",
  "x-llm-machines-user-sub": "admin-1",
  "x-llm-machines-user-email": "admin@example.test",
  "x-llm-machines-user-roles": "admin",
}

const builderHeaders = {
  ...adminHeaders,
  "x-llm-machines-user-sub": "builder-1",
  "x-llm-machines-user-email": "builder@example.test",
  "x-llm-machines-user-roles": "builder",
}

const adminActor = {
  authMode: "service-forwarded" as const,
  email: "admin@example.test",
  keycloakToken: "",
  persona: "admin" as const,
  roles: ["admin"],
  subject: "admin-1",
}

const completeConnectorReviewChecklist = {
  auditEventsReviewed: true,
  dataClassesReviewed: true,
  endpointsReviewed: true,
  licenseReviewed: true,
  runtimeSetupAcknowledged: true,
  scopesReviewed: true,
  secretsPlanReviewed: true,
  sourceIntegrityReviewed: true,
}

function settingsLogo(fileName: string, width: number, height: number) {
  const bytes = minimalPng(width, height)
  return {
    checksum: `sha256:${fileName}`,
    dataUrl: `data:image/png;base64,${bytes.toString("base64")}`,
    fileName,
    height,
    mimeType: "image/png",
    sizeBytes: bytes.length,
    updatedAt: "2026-05-29T12:00:00.000Z",
    width,
  }
}

function minimalPng(width: number, height: number): Buffer {
  const signature = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ])
  const ihdr = Buffer.alloc(25)
  ihdr.writeUInt32BE(13, 0)
  ihdr.write("IHDR", 4, "ascii")
  ihdr.writeUInt32BE(width, 8)
  ihdr.writeUInt32BE(height, 12)
  ihdr[16] = 8
  ihdr[17] = 2
  const iend = Buffer.from([
    0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0x00, 0x00, 0x00, 0x00,
  ])
  return Buffer.concat([signature, ihdr, iend])
}

function stubKeycloakAdminEnv() {
  vi.stubEnv("KEYCLOAK_ADMIN_BASE_URL", "https://keycloak.example/keycloak")
  vi.stubEnv("KEYCLOAK_ADMIN_CLIENT_ID", "console-team")
  vi.stubEnv("KEYCLOAK_ADMIN_CLIENT_SECRET", "admin-client-secret")
  vi.stubEnv("KEYCLOAK_ADMIN_REALM", "llm-machines")
  vi.stubEnv("TEAM_ALLOWED_EMAIL_DOMAINS", "example.com")
}

function keycloakToken() {
  return jsonResponse({ access_token: "admin-token", expires_in: 60 })
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  })
}

function requestBody(
  fetchMock: ReturnType<typeof vi.fn<typeof fetch>>,
  index: number,
) {
  const body = fetchMock.mock.calls[index]?.[1]?.body
  return JSON.parse(String(body))
}

describe("Admin routes", () => {
  afterEach(async () => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    resetAuditEventsForTest()
    resetConnectorVettingDecisionsForTest()
    resetBuilderStateForTest()
    resetHubStateForTest()
    resetIdempotencyForTest()
    await resetConnectedAppsForTest()
    resetAdminSettingsForTest()
    resetAdminTeamStateForTest()
    resetKnowledgeStateForTest()
  })

  it("requires authentication for Admin overview", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const response = await server.inject({
      method: "GET",
      url: "/api/admin/overview",
    })

    expect(response.statusCode).toBe(401)
    expect(getAuditEventsForTest()).toEqual([
      expect.objectContaining({
        action: "auth.denied",
        reason: "missing_token",
      }),
    ])
    await server.close()
  })

  it("blocks non-admin personas from Admin overview", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const response = await server.inject({
      method: "GET",
      url: "/api/admin/overview",
      headers: builderHeaders,
    })

    expect(response.statusCode).toBe(403)
    expect(getAuditEventsForTest()).toEqual([
      expect.objectContaining({
        action: "auth.denied",
        actorId: "builder-1",
        reason: "insufficient_persona",
      }),
    ])
    await server.close()
  })

  it("lets admins read Settings without exposing stack URLs or secrets", async () => {
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
      urlPolicyRules: [],
    })
    const serialized = response.body.toLowerCase()
    expect(serialized).not.toContain("test-service-key")
    expect(serialized).not.toContain("secret")
    expect(serialized).not.toContain("database_url")
    expect(serialized).not.toContain("http://")
    expect(serialized).not.toContain("https://")
    expect(getAuditEventsForTest()).toEqual([
      expect.objectContaining({
        action: "admin.settings.read",
        targetType: "admin.settings",
      }),
    ])
    await server.close()
  })

  it("reports configured Settings service reachability without exposing upstream addresses", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("KEYCLOAK_ADMIN_BASE_URL", "https://keycloak.example/keycloak")
    vi.stubEnv("KEYCLOAK_ADMIN_REALM", "llm-machines")
    vi.stubEnv("KEYCLOAK_ADMIN_CLIENT_ID", "console-team")
    vi.stubEnv("KEYCLOAK_ADMIN_CLIENT_SECRET", "keycloak-client-token")
    vi.stubEnv("ADMIN_LITELLM_BASE_URL", "https://litellm.example")
    vi.stubEnv("ADMIN_LITELLM_API_KEY", "litellm-admin-token")
    vi.stubEnv("LIBRECHAT_PUBLIC_URL", "https://librechat.example")
    vi.stubEnv("ADMIN_PROMETHEUS_BASE_URL", "https://prometheus.example")
    vi.stubEnv("AGENTIC_ADAPTER_BASE_URL", "https://agentic.example")
    vi.stubEnv("AGENTIC_ADAPTER_TOKEN", "agentic-token")
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.includes("/api/v1/query")) {
        return jsonResponse({
          status: "success",
          data: {
            resultType: "vector",
            result: [
              {
                metric: { job: "node" },
                value: [Date.now() / 1000, "1"],
              },
            ],
          },
        })
      }
      if (url.includes("/v1/diagnostics")) {
        return jsonResponse({
          service: "agentic-adapter",
          status: "ok",
          applyEnabled: true,
        })
      }
      if (url.includes("/v1/models")) {
        return jsonResponse({ data: [] })
      }
      return jsonResponse({})
    })
    vi.stubGlobal("fetch", fetchMock)
    const server = buildServer()

    const response = await server.inject({
      method: "GET",
      url: "/api/admin/settings",
      headers: adminHeaders,
    })

    expect(response.statusCode).toBe(200)
    const body = response.json()
    const services = new Map(
      body.reachability.map(
        (service: (typeof body.reachability)[number]) =>
          [service.id, service] as const,
      ),
    )
    for (const id of [
      "web",
      "bff",
      "keycloak",
      "litellm",
      "librechat",
      "grafana",
      "agentic_adapter",
    ]) {
      expect(services.get(id)).toMatchObject({
        status: "ok",
        lastCheckedAt: expect.any(String),
      })
    }
    expect(services.get("redis")).toMatchObject({
      status: "not_configured",
      lastCheckedAt: null,
    })
    expect(services.get("minio")).toMatchObject({
      status: "not_configured",
      lastCheckedAt: null,
    })
    const serialized = response.body.toLowerCase()
    expect(serialized).not.toContain("https://")
    expect(serialized).not.toContain("keycloak-client-token")
    expect(serialized).not.toContain("litellm-admin-token")
    expect(serialized).not.toContain("agentic-token")
    expect(fetchMock).toHaveBeenCalled()
    await server.close()
  })

  it("lets admins read Team configuration status without Keycloak credentials", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const response = await server.inject({
      method: "GET",
      url: "/api/admin/team",
      headers: adminHeaders,
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      serviceStatus: "not_configured",
      groups: [expect.objectContaining({ name: "Everyone", virtual: true })],
      members: [],
    })
    expect(JSON.stringify(response.json())).not.toContain("secret")
    expect(getAuditEventsForTest().map((event) => event.action)).toContain(
      "team.members.read",
    )
    await server.close()
  })

  it("lets admins list Team members from Keycloak", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    stubKeycloakAdminEnv()
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(keycloakToken())
        .mockResolvedValueOnce(
          jsonResponse([
            {
              id: "user-1",
              username: "ana",
              email: "ana@example.com",
              firstName: "Ana",
              lastName: "Admin",
              enabled: true,
            },
          ]),
        )
        .mockResolvedValueOnce(
          jsonResponse([{ id: "group-1", name: "Support", path: "/Support" }]),
        )
        .mockResolvedValueOnce(
          jsonResponse([{ id: "role-1", name: "admin" }]),
        )
        .mockResolvedValueOnce(
          jsonResponse([{ id: "group-1", name: "Support", path: "/Support" }]),
        ),
    )
    const server = buildServer()

    const response = await server.inject({
      method: "GET",
      url: "/api/admin/team",
      headers: adminHeaders,
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      serviceStatus: "ok",
      members: [
        expect.objectContaining({
          displayName: "Ana Admin",
          email: "ana@example.com",
          groups: ["Support"],
          keycloakHref:
            "https://keycloak.example/keycloak/admin/llm-machines/console/#/llm-machines/users/user-1",
          role: "admin",
          username: "ana",
        }),
      ],
      groups: [
        expect.objectContaining({ name: "Everyone", virtual: true }),
        expect.objectContaining({
          keycloakHref:
            "https://keycloak.example/keycloak/admin/llm-machines/console/#/llm-machines/groups/group-1",
          memberCount: 1,
          name: "Support",
        }),
      ],
    })
    await server.close()
  })

  it("renders SCIM configured and not-configured states with Keycloak deep links", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const notConfiguredResponse = await server.inject({
      method: "GET",
      url: "/api/admin/team/scim",
      headers: adminHeaders,
    })

    expect(notConfiguredResponse.statusCode).toBe(200)
    expect(notConfiguredResponse.json()).toMatchObject({
      keycloakHref: null,
      provider: null,
      status: "not_configured",
    })

    stubKeycloakAdminEnv()
    vi.stubEnv("TEAM_SCIM_PROVIDER", "Microsoft Entra ID")
    vi.stubEnv("TEAM_SCIM_LAST_SYNC_AT", "2026-05-29T13:00:00.000Z")
    const configuredResponse = await server.inject({
      method: "GET",
      url: "/api/admin/team/scim",
      headers: adminHeaders,
    })

    expect(configuredResponse.statusCode).toBe(200)
    expect(configuredResponse.json()).toMatchObject({
      detail:
        "SCIM status is read-only in Console. Manage provisioning details in Keycloak.",
      keycloakHref:
        "https://keycloak.example/keycloak/admin/llm-machines/console/#/llm-machines",
      lastSyncAt: "2026-05-29T13:00:00.000Z",
      provider: "Microsoft Entra ID",
      sourceStatus: "ok",
      status: "configured",
    })
    expect(getAuditEventsForTest().map((event) => event.action)).toEqual(
      expect.arrayContaining(["team.scim.read"]),
    )
    await server.close()
  })

  it("updates break-glass Admin only for enabled Admin users", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    stubKeycloakAdminEnv()
    const users = [
      {
        email: "ana@example.com",
        enabled: true,
        firstName: "Ana",
        id: "user-admin",
        lastName: "Admin",
        username: "ana",
      },
      {
        email: "disabled@example.com",
        enabled: false,
        firstName: "Disabled",
        id: "user-disabled-admin",
        lastName: "Admin",
        username: "disabled",
      },
      {
        email: "bo@example.com",
        enabled: true,
        firstName: "Bo",
        id: "user-builder",
        lastName: "Builder",
        username: "bo",
      },
    ]
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(keycloakToken())
      .mockResolvedValueOnce(jsonResponse(users))
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse([{ id: "role-admin", name: "admin" }]))
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse([{ id: "role-admin", name: "admin" }]))
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(
        jsonResponse([{ id: "role-builder", name: "builder" }]),
      )
      .mockResolvedValueOnce(keycloakToken())
      .mockResolvedValueOnce(jsonResponse(users))
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse([{ id: "role-admin", name: "admin" }]))
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse([{ id: "role-admin", name: "admin" }]))
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(
        jsonResponse([{ id: "role-builder", name: "builder" }]),
      )
    vi.stubGlobal("fetch", fetchMock)
    const server = buildServer()

    const builderDenied = await server.inject({
      method: "POST",
      url: "/api/admin/team/break-glass",
      headers: {
        ...builderHeaders,
        "idempotency-key": "team-break-glass-builder",
      },
      payload: { selectedAdminId: "user-admin" },
    })
    const selected = await server.inject({
      method: "POST",
      url: "/api/admin/team/break-glass",
      headers: {
        ...adminHeaders,
        "idempotency-key": "team-break-glass-select",
      },
      payload: { selectedAdminId: "user-admin" },
    })
    const disableSelected = await server.inject({
      method: "POST",
      url: "/api/admin/team/members/user-admin/disable",
      headers: {
        ...adminHeaders,
        "idempotency-key": "team-break-glass-selected-disable",
      },
    })
    const invalidDisabled = await server.inject({
      method: "POST",
      url: "/api/admin/team/break-glass",
      headers: {
        ...adminHeaders,
        "idempotency-key": "team-break-glass-disabled",
      },
      payload: { selectedAdminId: "user-disabled-admin" },
    })

    expect(builderDenied.statusCode).toBe(403)
    expect(selected.statusCode).toBe(200)
    expect(selected.json()).toMatchObject({
      eligibleAdmins: [
        expect.objectContaining({ id: "user-admin", role: "admin" }),
      ],
      selectedAdminId: "user-admin",
      updatedBy: "admin-1",
    })
    expect(disableSelected.statusCode).toBe(409)
    expect(disableSelected.json().detail).toMatch(/break-glass Admin/i)
    expect(invalidDisabled.statusCode).toBe(400)
    expect(invalidDisabled.json().detail).toMatch(/enabled Admin/i)
    expect(getAuditEventsForTest().map((event) => event.action)).toEqual(
      expect.arrayContaining(["team.break_glass.updated"]),
    )
    await server.close()
  })

  it("lets admins create, update, and delete unused Team groups through Keycloak", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    stubKeycloakAdminEnv()
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(keycloakToken())
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(
        new Response(null, {
          headers: {
            location:
              "https://keycloak.example/admin/realms/llm-machines/groups/group-support",
          },
          status: 201,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ id: "group-support", name: "Support", path: "/Support" }),
      )
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(keycloakToken())
      .mockResolvedValueOnce(
        jsonResponse({ id: "group-support", name: "Support", path: "/Support" }),
      )
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        jsonResponse({
          id: "group-support",
          name: "Operations",
          path: "/Operations",
        }),
      )
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(keycloakToken())
      .mockResolvedValueOnce(
        jsonResponse({
          id: "group-support",
          name: "Operations",
          path: "/Operations",
        }),
      )
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    vi.stubGlobal("fetch", fetchMock)
    const server = buildServer()

    const createResponse = await server.inject({
      method: "POST",
      url: "/api/admin/team/groups",
      headers: { ...adminHeaders, "idempotency-key": "group-create" },
      payload: { name: "Support" },
    })
    const updateResponse = await server.inject({
      method: "POST",
      url: "/api/admin/team/groups/group-support/update",
      headers: { ...adminHeaders, "idempotency-key": "group-update" },
      payload: { name: "Operations" },
    })
    const deleteResponse = await server.inject({
      method: "POST",
      url: "/api/admin/team/groups/group-support/delete",
      headers: { ...adminHeaders, "idempotency-key": "group-delete" },
    })

    expect(createResponse.statusCode).toBe(201)
    expect(createResponse.json()).toMatchObject({
      group: expect.objectContaining({ name: "Support", virtual: false }),
      status: "created",
    })
    expect(requestBody(fetchMock, 2)).toEqual({ name: "Support" })
    expect(updateResponse.statusCode).toBe(200)
    expect(updateResponse.json()).toMatchObject({
      group: expect.objectContaining({ name: "Operations" }),
      status: "updated",
    })
    expect(requestBody(fetchMock, 9)).toEqual({ name: "Operations" })
    expect(deleteResponse.statusCode).toBe(200)
    expect(deleteResponse.json()).toMatchObject({
      group: null,
      status: "deleted",
    })
    expect(fetchMock.mock.calls.at(-1)?.[0]).toContain("/groups/group-support")
    expect(getAuditEventsForTest().map((event) => event.action)).toEqual(
      expect.arrayContaining([
        "team.group.created",
        "team.group.updated",
        "team.group.deleted",
      ]),
    )
    await server.close()
  })

  it("blocks virtual Everyone group mutations and lower-role group mutations", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    stubKeycloakAdminEnv()
    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal("fetch", fetchMock)
    const server = buildServer()

    const everyoneDelete = await server.inject({
      method: "POST",
      url: "/api/admin/team/groups/everyone/delete",
      headers: { ...adminHeaders, "idempotency-key": "group-everyone-delete" },
    })
    const builderCreate = await server.inject({
      method: "POST",
      url: "/api/admin/team/groups",
      headers: { ...builderHeaders, "idempotency-key": "group-builder-create" },
      payload: { name: "Support" },
    })

    expect(everyoneDelete.statusCode).toBe(409)
    expect(everyoneDelete.json().detail).toContain("Everyone is virtual")
    expect(builderCreate.statusCode).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
    await server.close()
  })

  it("bulk assigns and removes Team group members through Keycloak", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    stubKeycloakAdminEnv()
    const supportGroup = {
      id: "group-support",
      name: "Support",
      path: "/Support",
    }
    const anaUser = {
      email: "ana@example.com",
      enabled: true,
      firstName: "Ana",
      id: "user-1",
      lastName: "Admin",
      username: "ana",
    }
    const boUser = {
      email: "bo@example.com",
      enabled: true,
      firstName: "Bo",
      id: "user-2",
      lastName: "Builder",
      username: "bo",
    }
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(keycloakToken())
      .mockResolvedValueOnce(jsonResponse(supportGroup))
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(jsonResponse(supportGroup))
      .mockResolvedValueOnce(jsonResponse([anaUser, boUser]))
      .mockResolvedValueOnce(keycloakToken())
      .mockResolvedValueOnce(jsonResponse(supportGroup))
      .mockResolvedValueOnce(jsonResponse([anaUser, boUser]))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(jsonResponse(supportGroup))
      .mockResolvedValueOnce(jsonResponse([boUser]))
    vi.stubGlobal("fetch", fetchMock)
    const server = buildServer()

    const assignResponse = await server.inject({
      method: "POST",
      url: "/api/admin/team/groups/group-support/members/bulk-assign",
      headers: { ...adminHeaders, "idempotency-key": "group-bulk-assign" },
      payload: { memberIds: ["user-1", "user-2"] },
    })
    const removeResponse = await server.inject({
      method: "POST",
      url: "/api/admin/team/groups/group-support/members/user-1/remove",
      headers: { ...adminHeaders, "idempotency-key": "group-member-remove" },
    })

    expect(assignResponse.statusCode).toBe(200)
    expect(assignResponse.json()).toMatchObject({
      group: expect.objectContaining({ memberCount: 2, name: "Support" }),
      status: "assigned",
    })
    expect(removeResponse.statusCode).toBe(200)
    expect(removeResponse.json()).toMatchObject({
      group: expect.objectContaining({ memberCount: 1, name: "Support" }),
      status: "removed",
    })
    expect(fetchMock.mock.calls).toEqual(
      expect.arrayContaining([
        expect.arrayContaining([
          expect.stringContaining("/users/user-1/groups/group-support"),
          expect.objectContaining({ method: "PUT" }),
        ]),
        expect.arrayContaining([
          expect.stringContaining("/users/user-2/groups/group-support"),
          expect.objectContaining({ method: "PUT" }),
        ]),
        expect.arrayContaining([
          expect.stringContaining("/users/user-1/groups/group-support"),
          expect.objectContaining({ method: "DELETE" }),
        ]),
      ]),
    )
    expect(getAuditEventsForTest().map((event) => event.action)).toEqual(
      expect.arrayContaining([
        "team.group.member_assigned",
        "team.group.member_removed",
      ]),
    )
    await server.close()
  })

  it("previews Team CSV imports with row-level validation", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    stubKeycloakAdminEnv()
    const csv = [
      "name,username,email,group,role,send_invite,enabled",
      "Vera Viewer,vera,vera@example.com,Support,admin,true,true",
      "Ana Duplicate,ana,ana.duplicate@example.com,Support,consumer,false,true",
      "Ana Duplicate,ana,ana.second@example.com,Support,consumer,false,true",
      "Existing User,existing,existing@example.com,Support,consumer,false,true",
      "External User,external,external@example.org,Support,consumer,false,true",
      "Unknown Group,unknown,unknown@example.com,Unknown,consumer,false,true",
      "Bad Role,badrole,badrole@example.com,Support,owner,false,true",
      "Broken Row,broken",
    ].join("\n")
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(keycloakToken())
      .mockResolvedValueOnce(
        jsonResponse([{ id: "group-support", name: "Support", path: "/Support" }]),
      )
      .mockResolvedValueOnce(
        jsonResponse([
          {
            email: "existing@example.com",
            enabled: true,
            firstName: "Existing",
            id: "user-existing",
            lastName: "User",
            username: "existing",
          },
        ]),
      )
    vi.stubGlobal("fetch", fetchMock)
    const server = buildServer()

    const templateResponse = await server.inject({
      method: "GET",
      url: "/api/admin/team/csv-template",
      headers: adminHeaders,
    })
    const previewResponse = await server.inject({
      method: "POST",
      url: "/api/admin/team/import/preview",
      headers: adminHeaders,
      payload: { csv },
    })

    expect(templateResponse.statusCode).toBe(200)
    expect(templateResponse.body).toBe(
      "name,username,email,group,role,send_invite,enabled\n",
    )
    expect(previewResponse.statusCode).toBe(200)
    expect(previewResponse.json()).toMatchObject({
      valid: false,
      rows: expect.arrayContaining([
        expect.objectContaining({
          actions: expect.arrayContaining([
            "create_user",
            "assign_group",
            "send_invite",
          ]),
          status: "valid",
          username: "vera",
        }),
        expect.objectContaining({
          errors: expect.arrayContaining(["Username is duplicated in the CSV."]),
          status: "invalid",
          username: "ana",
        }),
        expect.objectContaining({
          errors: expect.arrayContaining([
            "Username already exists in Keycloak.",
          ]),
          status: "invalid",
          username: "existing",
        }),
        expect.objectContaining({
          errors: expect.arrayContaining([
            "A corporate email address is required.",
          ]),
          username: "external",
        }),
        expect.objectContaining({
          errors: expect.arrayContaining(["Unknown group: Unknown."]),
          username: "unknown",
        }),
        expect.objectContaining({
          errors: expect.arrayContaining([
            "Role must be consumer, builder, or admin.",
          ]),
          username: "badrole",
        }),
        expect.objectContaining({
          errors: expect.arrayContaining([
            "Malformed row: expected 7 columns, received 2.",
          ]),
          username: "broken",
        }),
      ]),
    })
    await server.close()
  })

  it("commits valid Team CSV imports through Keycloak without password leakage", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    stubKeycloakAdminEnv()
    const csv = [
      "name,username,email,group,role,send_invite,enabled",
      "Bo Builder,bo,bo@example.com,Support,builder,true,true",
    ].join("\n")
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(keycloakToken())
      .mockResolvedValueOnce(
        jsonResponse([{ id: "group-support", name: "Support", path: "/Support" }]),
      )
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(
        new Response(null, {
          headers: {
            location:
              "https://keycloak.example/admin/realms/llm-machines/users/user-bo",
          },
          status: 201,
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ id: "role-builder", name: "builder" }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        jsonResponse([{ id: "group-support", name: "Support", path: "/Support" }]),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    vi.stubGlobal("fetch", fetchMock)
    const server = buildServer()

    const response = await server.inject({
      method: "POST",
      url: "/api/admin/team/import/commit",
      headers: { ...adminHeaders, "idempotency-key": "csv-import-commit" },
      payload: { csv },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      createdCount: 1,
      failedCount: 0,
      rows: [
        expect.objectContaining({
          actions: ["create_user", "assign_group", "send_invite"],
          status: "created",
          username: "bo",
        }),
      ],
      skippedCount: 0,
      valid: true,
    })
    expect(requestBody(fetchMock, 3)).toMatchObject({
      email: "bo@example.com",
      enabled: true,
      firstName: "Bo",
      lastName: "Builder",
      requiredActions: [],
      username: "bo",
    })
    expect(
      fetchMock.mock.calls.some((call) =>
        String(call[0]).includes("reset-password"),
      ),
    ).toBe(false)
    expect(JSON.stringify(response.json()).toLowerCase()).not.toContain(
      "password",
    )
    expect(getAuditEventsForTest()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "team.csv_import.committed",
          metadata: expect.not.objectContaining({
            generatedPassword: expect.anything(),
          }),
        }),
      ]),
    )
    await server.close()
  })

  it("shows group unlocks and blocks deleting groups referenced by corpora or MCP servers", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    stubKeycloakAdminEnv()
    await createKnowledgeCorpus(adminActor, {
      accessGroups: ["Support"],
      description: "Support corpus.",
      languageHints: ["en"],
      name: "Support corpus",
    })
    await createAdminMcpServer(adminActor, {
      accessGroups: ["Support"],
      accessLevel: "read_only",
      authMode: "none",
      chatCommand: "@support-mcp",
      description: "Support MCP.",
      endpointUrl: "https://mcp.example.test/rpc",
      name: "Support MCP",
      saveMode: "enabled",
      transport: "url",
    })
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(keycloakToken())
      .mockResolvedValueOnce(
        jsonResponse({ id: "group-support", name: "Support", path: "/Support" }),
      )
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(keycloakToken())
      .mockResolvedValueOnce(
        jsonResponse({ id: "group-support", name: "Support", path: "/Support" }),
      )
      .mockResolvedValueOnce(jsonResponse([]))
    vi.stubGlobal("fetch", fetchMock)
    const server = buildServer()

    const detailResponse = await server.inject({
      method: "GET",
      url: "/api/admin/team/groups/group-support",
      headers: adminHeaders,
    })
    const deleteResponse = await server.inject({
      method: "POST",
      url: "/api/admin/team/groups/group-support/delete",
      headers: { ...adminHeaders, "idempotency-key": "group-delete-blocked" },
    })

    expect(detailResponse.statusCode).toBe(200)
    expect(detailResponse.json()).toMatchObject({
      group: expect.objectContaining({
        name: "Support",
        unlockCount: 2,
      }),
      unlocks: expect.arrayContaining([
        expect.objectContaining({ name: "Support corpus", type: "corpus" }),
        expect.objectContaining({ name: "Support MCP", type: "mcp_server" }),
      ]),
    })
    expect(deleteResponse.statusCode).toBe(409)
    expect(deleteResponse.json().detail).toContain("Support corpus")
    expect(deleteResponse.json().detail).toContain("Support MCP")
    expect(fetchMock.mock.calls.some((call) => call[1]?.method === "DELETE")).toBe(
      false,
    )
    await server.close()
  })

  it("renames Console resource access references when a Keycloak group is renamed", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    stubKeycloakAdminEnv()
    await createKnowledgeCorpus(adminActor, {
      accessGroups: ["Support"],
      description: "Support corpus.",
      languageHints: ["en"],
      name: "Support corpus",
    })
    await createAdminMcpServer(adminActor, {
      accessGroups: ["Support"],
      accessLevel: "read_only",
      authMode: "none",
      chatCommand: "@support-mcp",
      description: "Support MCP.",
      endpointUrl: "https://mcp.example.test/rpc",
      name: "Support MCP",
      saveMode: "enabled",
      transport: "url",
    })
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(keycloakToken())
      .mockResolvedValueOnce(
        jsonResponse({ id: "group-support", name: "Support", path: "/Support" }),
      )
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        jsonResponse({
          id: "group-support",
          name: "Operations",
          path: "/Operations",
        }),
      )
      .mockResolvedValueOnce(jsonResponse([]))
    vi.stubGlobal("fetch", fetchMock)
    const server = buildServer()

    const response = await server.inject({
      method: "POST",
      url: "/api/admin/team/groups/group-support/update",
      headers: { ...adminHeaders, "idempotency-key": "group-rename" },
      payload: { name: "Operations" },
    })

    expect(response.statusCode).toBe(200)
    await expect(knowledgeUnlocksForAccessGroup("Support")).resolves.toEqual([])
    await expect(adminMcpServerUnlocksForAccessGroup("Support")).resolves.toEqual(
      [],
    )
    await expect(knowledgeUnlocksForAccessGroup("Operations")).resolves.toEqual(
      [expect.objectContaining({ name: "Support corpus" })],
    )
    await expect(
      adminMcpServerUnlocksForAccessGroup("Operations"),
    ).resolves.toEqual([expect.objectContaining({ name: "Support MCP" })])
    await server.close()
  })

  it("shows Team member detail with activity and usage rows", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    stubKeycloakAdminEnv()
    await emitAudit({
      actorId: "user-1",
      action: "connector.mcp.forwarded",
      metadata: { model: "llama-3.1" },
      targetId: "docs-mcp",
      targetType: "mcp_server",
    })
    await emitAudit({
      actorId: "user-1",
      action: "chat.prompt.completed",
      metadata: { model: "llama-3.1", promptTokens: 42, tokens: 1200 },
      targetId: "chat-1",
      targetType: "chat",
    })
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(keycloakToken())
        .mockResolvedValueOnce(
          jsonResponse({
            id: "user-1",
            username: "ana",
            email: "ana@example.com",
            firstName: "Ana",
            lastName: "Admin",
            enabled: true,
          }),
        )
        .mockResolvedValueOnce(
          jsonResponse([{ id: "group-1", name: "Support", path: "/Support" }]),
        )
        .mockResolvedValueOnce(
          jsonResponse([{ id: "role-1", name: "admin" }]),
        ),
    )
    const server = buildServer()

    const response = await server.inject({
      method: "GET",
      url: "/api/admin/team/members/user-1",
      headers: adminHeaders,
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      member: expect.objectContaining({
        displayName: "Ana Admin",
        groups: ["Support"],
      }),
      usage: expect.objectContaining({
        mcpCalls: 1,
        mostUsedModel: "llama-3.1",
        prompts: 1,
        tokens: 1200,
      }),
      activity: expect.arrayContaining([
        expect.objectContaining({ action: "chat.prompt.completed" }),
      ]),
    })
    await server.close()
  })

  it("creates Team members with generated non-temporary passwords and no password leakage in audit", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    stubKeycloakAdminEnv()
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(keycloakToken())
      .mockResolvedValueOnce(
        jsonResponse([{ id: "group-1", name: "Support", path: "/Support" }]),
      )
      .mockResolvedValueOnce(
        new Response(null, {
          headers: {
            location:
              "https://keycloak.example/admin/realms/llm-machines/users/user-1",
          },
          status: 201,
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(jsonResponse({ id: "role-1", name: "builder" }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        jsonResponse([{ id: "group-1", name: "Support", path: "/Support" }]),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        jsonResponse({
          id: "user-1",
          username: "ana.admin.support",
          email: "ana@example.com",
          firstName: "Ana",
          lastName: "Admin",
          enabled: true,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse([{ id: "group-1", name: "Support", path: "/Support" }]),
      )
      .mockResolvedValueOnce(
        jsonResponse([{ id: "role-1", name: "builder" }]),
      )
    vi.stubGlobal("fetch", fetchMock)
    const server = buildServer()

    const response = await server.inject({
      method: "POST",
      url: "/api/admin/team/members",
      headers: {
        ...adminHeaders,
        "idempotency-key": "team-create-1",
      },
      payload: {
        displayName: "Ana Admin",
        email: "ana@example.com",
        enabled: true,
        generatePassword: true,
        groups: ["Support"],
        role: "builder",
      },
    })

    expect(response.statusCode).toBe(201)
    expect(response.json()).toMatchObject({
      generatedPassword: expect.stringMatching(/^Llm-/),
      member: expect.objectContaining({
        groups: ["Support"],
        role: "builder",
      }),
    })
    expect(requestBody(fetchMock, 2)).toMatchObject({
      username: "ana.admin.support",
    })
    expect(requestBody(fetchMock, 3)).toMatchObject({
      temporary: false,
      type: "password",
    })
    expect(JSON.stringify(getAuditEventsForTest())).not.toContain(
      response.json().generatedPassword,
    )
    const fetchCallCount = fetchMock.mock.calls.length
    const replay = await server.inject({
      method: "POST",
      url: "/api/admin/team/members",
      headers: {
        ...adminHeaders,
        "idempotency-key": "team-create-1",
      },
      payload: {
        displayName: "Ana Admin",
        email: "ana@example.com",
        enabled: true,
        generatePassword: true,
        groups: ["Support"],
        role: "builder",
      },
    })
    expect(replay.statusCode).toBe(201)
    expect(replay.json()).toMatchObject({
      generatedPassword: null,
      member: expect.objectContaining({ username: "ana.admin.support" }),
    })
    expect(fetchMock).toHaveBeenCalledTimes(fetchCallCount)
    await server.close()
  })

  it("rejects Team member creation without a real Keycloak group", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    stubKeycloakAdminEnv()
    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal("fetch", fetchMock)
    const server = buildServer()

    const response = await server.inject({
      method: "POST",
      url: "/api/admin/team/members",
      headers: {
        ...adminHeaders,
        "idempotency-key": "team-create-everyone",
      },
      payload: {
        displayName: "Ana Admin",
        email: "ana@example.com",
        enabled: true,
        generatePassword: true,
        groups: ["Everyone"],
        role: "builder",
      },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json().detail).toContain("Select one Team group")
    expect(fetchMock).not.toHaveBeenCalled()
    await server.close()
  })

  it("redacts generated Team passwords from idempotency replay storage", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    stubKeycloakAdminEnv()
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(keycloakToken())
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        jsonResponse({
          id: "user-1",
          username: "ana",
          email: "ana@example.com",
          firstName: "Ana",
          lastName: "Admin",
          enabled: true,
        }),
      )
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse([{ id: "role-1", name: "consumer" }]))
    vi.stubGlobal("fetch", fetchMock)
    const server = buildServer()

    const response = await server.inject({
      method: "POST",
      url: "/api/admin/team/members/user-1/generate-password",
      headers: {
        ...adminHeaders,
        "idempotency-key": "team-generate-password-1",
      },
    })
    const fetchCallCount = fetchMock.mock.calls.length
    const replay = await server.inject({
      method: "POST",
      url: "/api/admin/team/members/user-1/generate-password",
      headers: {
        ...adminHeaders,
        "idempotency-key": "team-generate-password-1",
      },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().generatedPassword).toMatch(/^Llm-/)
    expect(requestBody(fetchMock, 1)).toMatchObject({
      temporary: false,
      type: "password",
    })
    expect(replay.statusCode).toBe(200)
    expect(replay.json()).toMatchObject({
      generatedPassword: null,
      member: expect.objectContaining({ username: "ana" }),
    })
    expect(fetchMock).toHaveBeenCalledTimes(fetchCallCount)
    await server.close()
  })

  it("rejects non-corporate Team invite and password reset domains", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    stubKeycloakAdminEnv()
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(keycloakToken())
      .mockResolvedValueOnce(
        jsonResponse({
          id: "user-1",
          username: "ana",
          email: "ana@external.test",
          firstName: "Ana",
          lastName: "External",
          enabled: true,
        }),
      )
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse([{ id: "role-1", name: "consumer" }]))
      .mockResolvedValueOnce(keycloakToken())
      .mockResolvedValueOnce(
        jsonResponse({
          id: "user-1",
          username: "ana",
          email: "ana@external.test",
          firstName: "Ana",
          lastName: "External",
          enabled: true,
        }),
      )
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse([{ id: "role-1", name: "consumer" }]))
    vi.stubGlobal("fetch", fetchMock)
    const server = buildServer()

    const invite = await server.inject({
      method: "POST",
      url: "/api/admin/team/members/user-1/invite",
      headers: {
        ...adminHeaders,
        "idempotency-key": "team-invite-external",
      },
    })
    const reset = await server.inject({
      method: "POST",
      url: "/api/admin/team/members/user-1/reset-password-email",
      headers: {
        ...adminHeaders,
        "idempotency-key": "team-reset-external",
      },
    })

    expect(invite.statusCode).toBe(400)
    expect(reset.statusCode).toBe(400)
    expect(invite.json().detail).toMatch(/corporate email/i)
    expect(reset.json().detail).toMatch(/corporate email/i)
    await server.close()
  })

  it("disables, reactivates, deletes, and blocks lower-role Team mutations", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    stubKeycloakAdminEnv()
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(keycloakToken())
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        jsonResponse({
          id: "user-1",
          username: "ana",
          email: "ana@example.com",
          firstName: "Ana",
          lastName: "Admin",
          enabled: false,
        }),
      )
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse([{ id: "role-1", name: "consumer" }]))
      .mockResolvedValueOnce(keycloakToken())
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        jsonResponse({
          id: "user-1",
          username: "ana",
          email: "ana@example.com",
          firstName: "Ana",
          lastName: "Admin",
          enabled: true,
        }),
      )
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse([{ id: "role-1", name: "consumer" }]))
      .mockResolvedValueOnce(keycloakToken())
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    vi.stubGlobal("fetch", fetchMock)
    const server = buildServer()

    const denied = await server.inject({
      method: "POST",
      url: "/api/admin/team/members/user-1/disable",
      headers: {
        ...builderHeaders,
        "idempotency-key": "team-denied",
      },
    })
    const disabled = await server.inject({
      method: "POST",
      url: "/api/admin/team/members/user-1/disable",
      headers: {
        ...adminHeaders,
        "idempotency-key": "team-disable-1",
      },
    })
    const reactivated = await server.inject({
      method: "POST",
      url: "/api/admin/team/members/user-1/reactivate",
      headers: {
        ...adminHeaders,
        "idempotency-key": "team-reactivate-1",
      },
    })
    const deleted = await server.inject({
      method: "POST",
      url: "/api/admin/team/members/user-1/delete",
      headers: {
        ...adminHeaders,
        "idempotency-key": "team-delete-1",
      },
      payload: { confirmation: "DELETE" },
    })
    const missingDeleteConfirmation = await server.inject({
      method: "POST",
      url: "/api/admin/team/members/user-1/delete",
      headers: {
        ...adminHeaders,
        "idempotency-key": "team-delete-missing-confirmation",
      },
    })

    expect(denied.statusCode).toBe(403)
    expect(disabled.statusCode).toBe(200)
    expect(disabled.json()).toMatchObject({ status: "disabled" })
    expect(reactivated.statusCode).toBe(200)
    expect(reactivated.json()).toMatchObject({ status: "reactivated" })
    expect(deleted.statusCode).toBe(200)
    expect(deleted.json()).toMatchObject({ member: null, status: "deleted" })
    expect(missingDeleteConfirmation.statusCode).toBe(400)
    expect(missingDeleteConfirmation.json().detail).toMatch(/DELETE/)
    expect(getAuditEventsForTest().map((event) => event.action)).toEqual(
      expect.arrayContaining([
        "auth.denied",
        "team.member.disabled",
        "team.member.reactivated",
        "team.member.deleted",
      ]),
    )
    await server.close()
  })

  it("blocks Team self-disable and self-delete before calling Keycloak", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    stubKeycloakAdminEnv()
    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal("fetch", fetchMock)
    const server = buildServer()

    const selfDisable = await server.inject({
      method: "POST",
      url: "/api/admin/team/members/admin-1/disable",
      headers: {
        ...adminHeaders,
        "idempotency-key": "team-self-disable",
      },
    })
    const selfDelete = await server.inject({
      method: "POST",
      url: "/api/admin/team/members/admin-1/delete",
      headers: {
        ...adminHeaders,
        "idempotency-key": "team-self-delete",
      },
      payload: { confirmation: "DELETE" },
    })

    expect(selfDisable.statusCode).toBe(409)
    expect(selfDelete.statusCode).toBe(409)
    expect(selfDisable.json().detail).toMatch(/cannot disable or delete/i)
    expect(selfDelete.json().detail).toMatch(/cannot disable or delete/i)
    expect(fetchMock).not.toHaveBeenCalled()
    await server.close()
  })

  it("blocks selected break-glass Admin disable and delete before calling Keycloak", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    stubKeycloakAdminEnv()
    setBreakGlassAdminForTest("user-1")
    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal("fetch", fetchMock)
    const server = buildServer()

    const disableBreakGlass = await server.inject({
      method: "POST",
      url: "/api/admin/team/members/user-1/disable",
      headers: {
        ...adminHeaders,
        "idempotency-key": "team-break-glass-disable",
      },
    })
    const deleteBreakGlass = await server.inject({
      method: "POST",
      url: "/api/admin/team/members/user-1/delete",
      headers: {
        ...adminHeaders,
        "idempotency-key": "team-break-glass-delete",
      },
      payload: { confirmation: "DELETE" },
    })

    expect(disableBreakGlass.statusCode).toBe(409)
    expect(deleteBreakGlass.statusCode).toBe(409)
    expect(disableBreakGlass.json().detail).toMatch(/break-glass Admin/i)
    expect(deleteBreakGlass.json().detail).toMatch(/break-glass Admin/i)
    expect(fetchMock).not.toHaveBeenCalled()
    await server.close()
  })

  it("blocks non-admin and unauthenticated access to every Settings route", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()
    const urlRuleId = "11111111-1111-4111-8111-111111111111"
    const settingsRoutes = [
      { method: "GET", url: "/api/admin/settings" },
      {
        method: "POST",
        url: "/api/admin/settings/organization",
        payload: {
          organizationName: "Denied",
          defaultLanguage: "en",
        },
      },
      {
        method: "POST",
        url: "/api/admin/settings/url-policy/rules",
        payload: {
          type: "trusted",
          pattern: "example.test",
          scope: "knowledge_ingestion",
          reason: "Denied mutation.",
        },
      },
      {
        method: "POST",
        url: `/api/admin/settings/url-policy/rules/${urlRuleId}/update`,
        payload: {
          type: "trusted",
          pattern: "example.test",
          scope: "knowledge_ingestion",
          status: "active",
          reason: "Denied mutation.",
        },
      },
      {
        method: "POST",
        url: `/api/admin/settings/url-policy/rules/${urlRuleId}/disable`,
      },
      {
        method: "POST",
        url: `/api/admin/settings/url-policy/rules/${urlRuleId}/delete`,
      },
      {
        method: "POST",
        url: "/api/admin/settings/telemetry",
        payload: { enabled: false },
      },
    ] as const

    for (const [index, route] of settingsRoutes.entries()) {
      const unauthenticatedResponse = await server.inject({
        method: route.method,
        url: route.url,
        payload: "payload" in route ? route.payload : undefined,
      })
      const builderResponse = await server.inject({
        method: route.method,
        url: route.url,
        headers: {
          ...builderHeaders,
          "idempotency-key": `settings-denied-${index}`,
        },
        payload: "payload" in route ? route.payload : undefined,
      })

      expect(unauthenticatedResponse.statusCode).toBe(401)
      expect(builderResponse.statusCode).toBe(403)
    }
    await server.close()
  })

  it("lets admins update organization settings and validates logo assets", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()
    const logo = settingsLogo("console-logo.png", 400, 120)
    const icon = settingsLogo("console-icon.png", 96, 96)

    const updateResponse = await server.inject({
      method: "POST",
      url: "/api/admin/settings/organization",
      headers: {
        ...adminHeaders,
        "idempotency-key": "settings-org-update",
      },
      payload: {
        organizationName: "Sovereign AI Lab",
        defaultLanguage: "hr",
        fullLogo: logo,
        iconLogo: icon,
      },
    })
    const persistedResponse = await server.inject({
      method: "GET",
      url: "/api/admin/settings",
      headers: adminHeaders,
    })
    const invalidIconResponse = await server.inject({
      method: "POST",
      url: "/api/admin/settings/organization",
      headers: {
        ...adminHeaders,
        "idempotency-key": "settings-org-invalid-icon",
      },
      payload: {
        organizationName: "Sovereign AI Lab",
        defaultLanguage: "hr",
        iconLogo: settingsLogo("wide-icon.png", 128, 64),
      },
    })
    const spoofedLogoResponse = await server.inject({
      method: "POST",
      url: "/api/admin/settings/organization",
      headers: {
        ...adminHeaders,
        "idempotency-key": "settings-org-spoofed-logo",
      },
      payload: {
        organizationName: "Sovereign AI Lab",
        defaultLanguage: "hr",
        fullLogo: {
          ...settingsLogo("spoofed.png", 1, 1),
          dataUrl: "data:image/png;base64,aGVsbG8=",
          sizeBytes: 5,
        },
      },
    })
    const hugeLogoResponse = await server.inject({
      method: "POST",
      url: "/api/admin/settings/organization",
      headers: {
        ...adminHeaders,
        "idempotency-key": "settings-org-huge-logo",
      },
      payload: {
        organizationName: "Sovereign AI Lab",
        defaultLanguage: "hr",
        fullLogo: settingsLogo("huge.png", 5000, 1000),
      },
    })

    expect(updateResponse.statusCode).toBe(200)
    expect(updateResponse.json().organization).toMatchObject({
      organizationName: "Sovereign AI Lab",
      defaultLanguage: "hr",
      fullLogo: expect.objectContaining({
        checksum: expect.not.stringContaining("console-logo.png"),
        fileName: "console-logo.png",
        height: 120,
        sizeBytes: minimalPng(400, 120).length,
        width: 400,
      }),
      iconLogo: expect.objectContaining({
        checksum: expect.not.stringContaining("console-icon.png"),
        fileName: "console-icon.png",
        height: 96,
        sizeBytes: minimalPng(96, 96).length,
        width: 96,
      }),
      updatedBy: "admin-1",
    })
    expect(persistedResponse.json().organization.organizationName).toBe(
      "Sovereign AI Lab",
    )
    expect(invalidIconResponse.statusCode).toBe(400)
    expect(spoofedLogoResponse.statusCode).toBe(400)
    expect(hugeLogoResponse.statusCode).toBe(400)
    expect(getAuditEventsForTest()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "admin.settings.organization.updated",
          targetId: "singleton",
        }),
      ]),
    )
    await server.close()
  })

  it("lets admins manage URL policy rules with duplicate and local-target protection", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const createResponse = await server.inject({
      method: "POST",
      url: "/api/admin/settings/url-policy/rules",
      headers: {
        ...adminHeaders,
        "idempotency-key": "settings-url-policy-create",
      },
      payload: {
        type: "trusted",
        pattern: "https://docs.example.test/kb",
        scope: "knowledge_ingestion",
        reason: "Approved documentation source.",
      },
    })
    const createdRule = createResponse.json().urlPolicyRules[0]
    const duplicateResponse = await server.inject({
      method: "POST",
      url: "/api/admin/settings/url-policy/rules",
      headers: {
        ...adminHeaders,
        "idempotency-key": "settings-url-policy-duplicate",
      },
      payload: {
        type: "trusted",
        pattern: "https://docs.example.test/kb",
        scope: "knowledge_ingestion",
        reason: "Same source again.",
      },
    })
    const privateResponse = await server.inject({
      method: "POST",
      url: "/api/admin/settings/url-policy/rules",
      headers: {
        ...adminHeaders,
        "idempotency-key": "settings-url-policy-private",
      },
      payload: {
        type: "forbidden",
        pattern: "http://127.0.0.1/admin",
        scope: "knowledge_ingestion",
        reason: "Local targets remain blocked.",
      },
    })
    const privateRangeResponse = await server.inject({
      method: "POST",
      url: "/api/admin/settings/url-policy/rules",
      headers: {
        ...adminHeaders,
        "idempotency-key": "settings-url-policy-private-range",
      },
      payload: {
        type: "forbidden",
        pattern: "http://10.0.0.10/internal",
        scope: "knowledge_ingestion",
        reason: "Private ranges remain blocked.",
      },
    })
    const invalidSchemeResponse = await server.inject({
      method: "POST",
      url: "/api/admin/settings/url-policy/rules",
      headers: {
        ...adminHeaders,
        "idempotency-key": "settings-url-policy-invalid-scheme",
      },
      payload: {
        type: "trusted",
        pattern: "ftp://docs.example.test/kb",
        scope: "knowledge_ingestion",
        reason: "Only HTTP(S) rules are accepted.",
      },
    })
    const missingReasonResponse = await server.inject({
      method: "POST",
      url: "/api/admin/settings/url-policy/rules",
      headers: {
        ...adminHeaders,
        "idempotency-key": "settings-url-policy-missing-reason",
      },
      payload: {
        type: "forbidden",
        pattern: "example.test",
        scope: "knowledge_ingestion",
      },
    })
    const updateResponse = await server.inject({
      method: "POST",
      url: `/api/admin/settings/url-policy/rules/${createdRule.id}/update`,
      headers: {
        ...adminHeaders,
        "idempotency-key": "settings-url-policy-update",
      },
      payload: {
        type: "forbidden",
        pattern: "*.blocked.example.test",
        scope: "all",
        status: "active",
        reason: "Block this entire external source family.",
      },
    })
    const disableResponse = await server.inject({
      method: "POST",
      url: `/api/admin/settings/url-policy/rules/${createdRule.id}/disable`,
      headers: {
        ...adminHeaders,
        "idempotency-key": "settings-url-policy-disable",
      },
    })
    const deleteResponse = await server.inject({
      method: "POST",
      url: `/api/admin/settings/url-policy/rules/${createdRule.id}/delete`,
      headers: {
        ...adminHeaders,
        "idempotency-key": "settings-url-policy-delete",
      },
    })

    expect(createResponse.statusCode).toBe(200)
    expect(createdRule).toMatchObject({
      type: "trusted",
      normalizedPattern: "https://docs.example.test/kb",
      status: "active",
      createdBy: "admin-1",
    })
    expect(duplicateResponse.statusCode).toBe(409)
    expect(privateResponse.statusCode).toBe(400)
    expect(privateRangeResponse.statusCode).toBe(400)
    expect(invalidSchemeResponse.statusCode).toBe(400)
    expect(missingReasonResponse.statusCode).toBe(400)
    expect(updateResponse.statusCode).toBe(200)
    expect(updateResponse.json().urlPolicyRules[0]).toMatchObject({
      id: createdRule.id,
      type: "forbidden",
      normalizedPattern: "*.blocked.example.test",
      scope: "all",
      status: "active",
    })
    expect(disableResponse.statusCode).toBe(200)
    expect(disableResponse.json().urlPolicyRules[0]).toMatchObject({
      id: createdRule.id,
      status: "disabled",
    })
    expect(deleteResponse.statusCode).toBe(200)
    expect(deleteResponse.json().urlPolicyRules).toEqual([])
    expect(getAuditEventsForTest()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "admin.url_policy.trusted.created",
          targetId: createdRule.id,
        }),
        expect.objectContaining({
          action: "admin.url_policy.updated",
          targetId: createdRule.id,
        }),
        expect.objectContaining({
          action: "admin.url_policy.disabled",
          targetId: createdRule.id,
        }),
        expect.objectContaining({
          action: "admin.url_policy.deleted",
          targetId: createdRule.id,
        }),
      ]),
    )
    await server.close()
  })

  it("lets admins toggle telemetry only with enable confirmation", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const initialResponse = await server.inject({
      method: "GET",
      url: "/api/admin/settings",
      headers: adminHeaders,
    })
    const rejectedEnableResponse = await server.inject({
      method: "POST",
      url: "/api/admin/settings/telemetry",
      headers: {
        ...adminHeaders,
        "idempotency-key": "settings-telemetry-rejected",
      },
      payload: { enabled: true, confirmation: "yes" },
    })
    const enableResponse = await server.inject({
      method: "POST",
      url: "/api/admin/settings/telemetry",
      headers: {
        ...adminHeaders,
        "idempotency-key": "settings-telemetry-enable",
      },
      payload: { enabled: true, confirmation: "ENABLE TELEMETRY" },
    })
    const disableResponse = await server.inject({
      method: "POST",
      url: "/api/admin/settings/telemetry",
      headers: {
        ...adminHeaders,
        "idempotency-key": "settings-telemetry-disable",
      },
      payload: { enabled: false },
    })

    expect(initialResponse.json().privacy.telemetryEnabled).toBe(false)
    expect(rejectedEnableResponse.statusCode).toBe(400)
    expect(enableResponse.statusCode).toBe(200)
    expect(enableResponse.json()).toMatchObject({
      license: { telemetryOptIn: true },
      privacy: { telemetryEnabled: true },
    })
    expect(disableResponse.statusCode).toBe(200)
    expect(disableResponse.json()).toMatchObject({
      license: { telemetryOptIn: false },
      privacy: { telemetryEnabled: false },
    })
    expect(getAuditEventsForTest()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "admin.settings.telemetry.enabled",
        }),
        expect.objectContaining({
          action: "admin.settings.telemetry.disabled",
        }),
      ]),
    )
    await server.close()
  })

  it("lets admins manage the Builder Agent Studio quota policy", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const initialResponse = await server.inject({
      method: "GET",
      url: "/api/admin/builder/agent-studio/quota-policy",
      headers: adminHeaders,
    })
    const updateResponse = await server.inject({
      method: "POST",
      url: "/api/admin/builder/agent-studio/quota-policy",
      headers: {
        ...adminHeaders,
        "idempotency-key": "admin-agent-studio-quota-1",
      },
      payload: {
        runLimit: 1,
        tokenLimit: 1000,
        note: "Limit demo Builder Studio test runs.",
      },
    })
    const studioResponse = await server.inject({
      method: "GET",
      url: "/api/builder/agents/66666666-6666-4666-8666-666666666666/studio",
      headers: builderHeaders,
    })

    expect(initialResponse.statusCode).toBe(200)
    expect(initialResponse.json()).toMatchObject({
      source: "environment",
      enforced: false,
      runLimit: null,
      tokenLimit: null,
    })
    expect(updateResponse.statusCode).toBe(200)
    expect(updateResponse.json()).toMatchObject({
      source: "admin_override",
      enforced: true,
      runLimit: 1,
      tokenLimit: 1000,
      updatedBy: "admin-1",
    })
    expect(studioResponse.json().quota).toMatchObject({
      enforced: true,
      runLimit: 1,
      tokenLimit: 1000,
      remainingRuns: 1,
      remainingTokens: 1000,
    })
    expect(getAuditEventsForTest()).toEqual([
      expect.objectContaining({
        action: "admin.builder_agent_studio_quota.update",
        reason: "Limit demo Builder Studio test runs.",
      }),
    ])
    await server.close()
  })

  it("blocks non-admins from Builder Agent Studio quota policy updates", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const response = await server.inject({
      method: "POST",
      url: "/api/admin/builder/agent-studio/quota-policy",
      headers: {
        ...builderHeaders,
        "idempotency-key": "admin-agent-studio-quota-denied",
      },
      payload: {
        runLimit: 1,
        tokenLimit: null,
        note: "Should not be accepted.",
      },
    })

    expect(response.statusCode).toBe(403)
    await server.close()
  })

  it("requires authentication for Admin approval queue", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const response = await server.inject({
      method: "GET",
      url: "/api/admin/approvals",
    })

    expect(response.statusCode).toBe(401)
    expect(getAuditEventsForTest()).toEqual([
      expect.objectContaining({
        action: "auth.denied",
        reason: "missing_token",
      }),
    ])
    await server.close()
  })

  it("blocks non-admin personas from Admin approval queue", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const response = await server.inject({
      method: "GET",
      url: "/api/admin/approvals",
      headers: builderHeaders,
    })

    expect(response.statusCode).toBe(403)
    expect(getAuditEventsForTest()).toEqual([
      expect.objectContaining({
        action: "auth.denied",
        actorId: "builder-1",
        reason: "insufficient_persona",
      }),
    ])
    await server.close()
  })

  it("returns the Admin approval queue and audits the read", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const response = await server.inject({
      method: "GET",
      url: "/api/admin/approvals?q=internal",
      headers: adminHeaders,
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      query: "internal",
      sourceStatus: "ok",
      pendingCount: 1,
      items: [
        expect.objectContaining({
          resourceId: "99999999-9999-4999-8999-999999999999",
          resourceName: "Internal Docs Corpus",
          resourceType: "rag_corpus",
          ownerId: "builder-1",
          submittedVersion: "v0.2",
          reviewHref: "/builder/resources/99999999-9999-4999-8999-999999999999",
          auditHref: "#audit-log-deferred",
        }),
      ],
    })
    expect(getAuditEventsForTest()).toEqual([
      expect.objectContaining({
        action: "admin.approvals.read",
        actorId: "admin-1",
        targetType: "builder.submissions",
        targetId: "queue",
        metadata: expect.objectContaining({
          query: "internal",
          pendingCount: 1,
        }),
      }),
    ])
    await server.close()
  })

  it("requires authentication for Admin connector registry", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const response = await server.inject({
      method: "GET",
      url: "/api/admin/agents/registry",
    })

    expect(response.statusCode).toBe(401)
    expect(getAuditEventsForTest()).toEqual([
      expect.objectContaining({
        action: "auth.denied",
        reason: "missing_token",
      }),
    ])
    await server.close()
  })

  it("blocks non-admin personas from Admin connector registry", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const response = await server.inject({
      method: "GET",
      url: "/api/admin/agents/registry",
      headers: builderHeaders,
    })

    expect(response.statusCode).toBe(403)
    expect(getAuditEventsForTest()).toEqual([
      expect.objectContaining({
        action: "auth.denied",
        actorId: "builder-1",
        reason: "insufficient_persona",
      }),
    ])
    await server.close()
  })

  it("returns the Admin connector registry and audits the read", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const response = await server.inject({
      method: "GET",
      url: "/api/admin/agents/registry?q=internal-docs",
      headers: adminHeaders,
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      query: "internal-docs",
      sourceStatus: "ok",
      summary: {
        totalCount: 1,
        approvedCount: 1,
        pendingCount: 0,
        blockedCount: 0,
        secretsRequiredCount: 0,
        t2T3Count: 1,
      },
      items: [
        expect.objectContaining({
          id: "internal-docs",
          displayName: "Internal Docs",
          supportTier: "t2",
          vettingStatus: "approved_read_only",
          posture: "approved",
          sourceStatus: "ok",
          runtimeSetup: expect.objectContaining({
            runnable: true,
            status: "ready",
          }),
          reviewHref: "/resources/mcp_connector/internal-docs",
          auditHref: "#audit-log-deferred",
        }),
      ],
    })
    expect(getAuditEventsForTest()).toEqual([
      expect.objectContaining({
        action: "admin.connector_registry.read",
        actorId: "admin-1",
        targetType: "mcp.catalog",
        targetId: "registry",
        metadata: expect.objectContaining({
          query: "internal-docs",
          sourceStatus: "ok",
          totalCount: 1,
          visibleCount: 1,
        }),
      }),
    ])
    await server.close()
  })

  it("lets admins create URL-backed MCP servers and exposes them in the registry", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const createResponse = await server.inject({
      method: "POST",
      url: "/api/admin/mcp-servers",
      headers: {
        ...adminHeaders,
        "idempotency-key": "mcp-server-create-docs",
      },
      payload: {
        accessGroups: ["Everyone"],
        accessLevel: "read_only",
        authMode: "none",
        chatCommand: "@docs-mcp",
        description: "Documentation MCP server.",
        endpointUrl: "https://mcp.example.test/rpc",
        name: "Docs MCP",
        transport: "url",
      },
    })
    const registryResponse = await server.inject({
      method: "GET",
      url: "/api/admin/agents/registry?q=docs-mcp",
      headers: adminHeaders,
    })

    expect(createResponse.statusCode).toBe(200)
    expect(createResponse.json()).toMatchObject({
      id: "docs-mcp",
      displayName: "Docs MCP",
      effectiveVettingStatus: "approved_read_only",
      runtimeProfile: "admin-url-mcp",
      supportTier: "t3",
      runtimeSetup: expect.objectContaining({
        runnable: true,
        status: "ready",
      }),
    })
    expect(JSON.stringify(createResponse.json())).not.toContain(
      "bearerToken",
    )
    expect(registryResponse.json()).toMatchObject({
      summary: {
        totalCount: 2,
      },
      items: [
        expect.objectContaining({
          id: "docs-mcp",
          displayName: "Docs MCP",
        }),
      ],
    })
    expect(getAuditEventsForTest()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "admin.mcp_server.created",
          actorId: "admin-1",
          targetId: "docs-mcp",
          targetType: "mcp.connector",
        }),
      ]),
    )
    await server.close()
  })

  it("lets admins read and update Admin-created MCP server settings", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    await server.inject({
      method: "POST",
      url: "/api/admin/mcp-servers",
      headers: {
        ...adminHeaders,
        "idempotency-key": "mcp-server-settings-create",
      },
      payload: {
        accessGroups: ["Security"],
        accessLevel: "read_only",
        authMode: "none",
        chatCommand: "@docs-mcp",
        description: "Documentation MCP server.",
        endpointUrl: "https://mcp.example.test/rpc",
        name: "Docs MCP",
        transport: "url",
      },
    })
    const detailResponse = await server.inject({
      method: "GET",
      url: "/api/admin/mcp-servers/docs-mcp",
      headers: adminHeaders,
    })
    const updateResponse = await server.inject({
      method: "POST",
      url: "/api/admin/mcp-servers/docs-mcp/update",
      headers: {
        ...adminHeaders,
        "idempotency-key": "mcp-server-settings-update",
      },
      payload: {
        accessGroups: ["Finance"],
        accessLevel: "read_write",
        authMode: "none",
        description: "Updated documentation MCP server.",
        endpointUrl: "https://mcp.example.test/updated-rpc",
        name: "Docs MCP Updated",
        status: "disabled",
        transport: "url",
      },
    })
    const updatedDetailResponse = await server.inject({
      method: "GET",
      url: "/api/admin/mcp-servers/docs-mcp",
      headers: adminHeaders,
    })

    expect(detailResponse.statusCode).toBe(200)
    expect(detailResponse.json()).toMatchObject({
      accessGroups: ["Security"],
      endpointUrl: "https://mcp.example.test/rpc",
      id: "docs-mcp",
      supportTier: "t3",
    })
    expect(updateResponse.statusCode).toBe(200)
    expect(updateResponse.json()).toMatchObject({
      displayName: "Docs MCP Updated",
      effectiveVettingStatus: "disabled",
      supportTier: "t3",
    })
    expect(updatedDetailResponse.json()).toMatchObject({
      accessGroups: ["Finance"],
      accessLevel: "read_write",
      endpointUrl: "https://mcp.example.test/updated-rpc",
      name: "Docs MCP Updated",
      status: "disabled",
    })
    expect(getAuditEventsForTest()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "admin.mcp_server.read",
          targetId: "docs-mcp",
        }),
        expect.objectContaining({
          action: "admin.mcp_server.updated",
          targetId: "docs-mcp",
        }),
      ]),
    )
    await server.close()
  })

  it("blocks managed T2 MCP server edits from the Admin-created MCP settings API", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const detailResponse = await server.inject({
      method: "GET",
      url: "/api/admin/mcp-servers/internal-docs",
      headers: adminHeaders,
    })
    const updateResponse = await server.inject({
      method: "POST",
      url: "/api/admin/mcp-servers/internal-docs/update",
      headers: {
        ...adminHeaders,
        "idempotency-key": "mcp-server-managed-update",
      },
      payload: {
        accessGroups: [],
        accessLevel: "read_only",
        authMode: "none",
        description: "Attempted managed update.",
        endpointUrl: "https://mcp.example.test/rpc",
        name: "Internal Docs",
        status: "enabled",
        transport: "url",
      },
    })

    expect(detailResponse.statusCode).toBe(403)
    expect(updateResponse.statusCode).toBe(403)
    expect(updateResponse.json()).toMatchObject({
      title: "Managed MCP server",
    })
    await server.close()
  })

  it("rejects duplicate Admin MCP server chat commands", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()
    const payload = {
      accessGroups: [],
      accessLevel: "read_only",
      authMode: "none",
      chatCommand: "@docs-mcp",
      description: "Documentation MCP server.",
      endpointUrl: "https://mcp.example.test/rpc",
      name: "Docs MCP",
      transport: "url",
    }

    await server.inject({
      method: "POST",
      url: "/api/admin/mcp-servers",
      headers: {
        ...adminHeaders,
        "idempotency-key": "mcp-server-create-duplicate-1",
      },
      payload,
    })
    const duplicateResponse = await server.inject({
      method: "POST",
      url: "/api/admin/mcp-servers",
      headers: {
        ...adminHeaders,
        "idempotency-key": "mcp-server-create-duplicate-2",
      },
      payload,
    })

    expect(duplicateResponse.statusCode).toBe(409)
    expect(duplicateResponse.json()).toMatchObject({
      title: "Duplicate MCP server",
    })
    await server.close()
  })

  it("rejects Admin MCP server chat commands reserved for BFF aggregate gateways", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const response = await server.inject({
      method: "POST",
      url: "/api/admin/mcp-servers",
      headers: {
        ...adminHeaders,
        "idempotency-key": "mcp-server-create-reserved",
      },
      payload: {
        accessGroups: [],
        accessLevel: "read_only",
        authMode: "none",
        chatCommand: "@admin-servers",
        description: "Reserved aggregate gateway.",
        endpointUrl: "https://mcp.example.test/rpc",
        name: "Reserved Gateway",
        transport: "url",
      },
    })

    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({
      title: "Duplicate MCP server",
    })
    await server.close()
  })

  it("blocks non-admins from creating MCP servers", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const response = await server.inject({
      method: "POST",
      url: "/api/admin/mcp-servers",
      headers: {
        ...builderHeaders,
        "idempotency-key": "mcp-server-create-denied",
      },
      payload: {
        accessGroups: [],
        accessLevel: "read_only",
        authMode: "none",
        chatCommand: "@docs-mcp",
        description: "Documentation MCP server.",
        endpointUrl: "https://mcp.example.test/rpc",
        name: "Docs MCP",
        transport: "url",
      },
    })

    expect(response.statusCode).toBe(403)
    await server.close()
  })

  it("rejects SSRF-prone Admin MCP endpoint URLs before saving", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()
    const blockedUrls = [
      "http://localhost/rpc",
      "http://127.0.0.1/rpc",
      "http://10.0.0.1/rpc",
      "http://169.254.169.254/latest/meta-data",
      "http://metadata.google.internal/computeMetadata/v1",
      "http://[::1]/rpc",
      "http://[fd00::1]/rpc",
      "http://[fe80::1]/rpc",
      "file:///tmp/mcp.sock",
      "ftp://mcp.example.test/rpc",
    ]

    for (const [index, endpointUrl] of blockedUrls.entries()) {
      const response = await server.inject({
        method: "POST",
        url: "/api/admin/mcp-servers",
        headers: {
          ...adminHeaders,
          "idempotency-key": `mcp-server-blocked-url-${index}`,
        },
        payload: {
          accessGroups: [],
          accessLevel: "read_only",
          authMode: "none",
          chatCommand: `@blocked-${index}`,
          description: "Blocked MCP endpoint.",
          endpointUrl,
          name: `Blocked ${index}`,
          transport: "url",
        },
      })

      expect(response.statusCode).toBe(400)
      expect(response.json()).toMatchObject({
        title: "Invalid MCP server",
      })
    }

    await server.close()
  })

  it("rejects SSRF-prone Admin MCP endpoint URLs before update", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    await server.inject({
      method: "POST",
      url: "/api/admin/mcp-servers",
      headers: {
        ...adminHeaders,
        "idempotency-key": "mcp-server-update-safe-create",
      },
      payload: {
        accessGroups: [],
        accessLevel: "read_only",
        authMode: "none",
        chatCommand: "@update-blocked",
        description: "Safe MCP endpoint.",
        endpointUrl: "https://mcp.example.test/rpc",
        name: "Update Blocked",
        transport: "url",
      },
    })

    const response = await server.inject({
      method: "POST",
      url: "/api/admin/mcp-servers/update-blocked/update",
      headers: {
        ...adminHeaders,
        "idempotency-key": "mcp-server-update-blocked",
      },
      payload: {
        accessGroups: [],
        accessLevel: "read_only",
        authMode: "none",
        description: "Blocked update.",
        endpointUrl: "http://[::1]/rpc",
        name: "Update Blocked",
        status: "enabled",
        transport: "url",
      },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({
      title: "Invalid MCP server update",
    })
    await server.close()
  })

  it("does not send bearer secrets while testing unsafe MCP endpoints", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("REMOTE_MCP_TOKEN", "super-secret-token")
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    const server = buildServer()

    const response = await server.inject({
      method: "POST",
      url: "/api/admin/mcp-servers/test-connection",
      headers: adminHeaders,
      payload: {
        accessLevel: "read_only",
        authMode: "bearer",
        bearerTokenSecretRef: "REMOTE_MCP_TOKEN",
        chatCommand: "@unsafe-mcp",
        description: "Unsafe MCP endpoint.",
        endpointUrl: "http://[::1]:9000/rpc",
        name: "Unsafe MCP",
        transport: "url",
      },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      status: "failed",
    })
    expect(response.body).not.toContain("super-secret-token")
    expect(fetchMock).not.toHaveBeenCalled()
    await server.close()
  })

  it("lets admins create, test, promote, rotate, and disable connected apps without leaking stored secrets", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("CONNECTED_APPS_KEYCLOAK_FIXTURE", "true")
    vi.stubEnv("CONNECTED_APPS_BFF_BASE_URL", "https://bff.example.test")
    vi.stubEnv(
      "CONNECTED_APPS_TOKEN_URL",
      "https://keycloak.example.test/realms/llm-machines/protocol/openid-connect/token",
    )
    const server = buildServer()
    const payload = {
      allowedModels: ["llama-3.1-8b", "qwen2.5-coder"],
      description: "Finance team's staging integration.",
      name: "Finance Portal",
      ownerGroup: "Finance",
    }

    const createResponse = await server.inject({
      method: "POST",
      url: "/api/admin/applications/connected-apps",
      headers: {
        ...adminHeaders,
        "idempotency-key": "connected-app-create-finance",
      },
      payload,
    })
    const created = createResponse.json()
    const appId = created.app.id as string
    const listResponse = await server.inject({
      method: "GET",
      url: "/api/admin/applications/connected-apps",
      headers: adminHeaders,
    })
    const detailResponse = await server.inject({
      method: "GET",
      url: `/api/admin/applications/connected-apps/${appId}`,
      headers: adminHeaders,
    })
    const blockedPromotionResponse = await server.inject({
      method: "POST",
      url: `/api/admin/applications/connected-apps/${appId}/promote-production`,
      headers: {
        ...adminHeaders,
        "idempotency-key": "connected-app-promote-blocked",
      },
    })
    const testResponse = await server.inject({
      method: "POST",
      url: `/api/admin/applications/connected-apps/${appId}/test`,
      headers: {
        ...adminHeaders,
        "idempotency-key": "connected-app-test-finance",
      },
    })
    const promoteResponse = await server.inject({
      method: "POST",
      url: `/api/admin/applications/connected-apps/${appId}/promote-production`,
      headers: {
        ...adminHeaders,
        "idempotency-key": "connected-app-promote-finance",
      },
    })
    const rotateResponse = await server.inject({
      method: "POST",
      url: `/api/admin/applications/connected-apps/${appId}/rotate-credentials`,
      headers: {
        ...adminHeaders,
        "idempotency-key": "connected-app-rotate-finance",
      },
    })
    const disableResponse = await server.inject({
      method: "POST",
      url: `/api/admin/applications/connected-apps/${appId}/disable`,
      headers: {
        ...adminHeaders,
        "idempotency-key": "connected-app-disable-finance",
      },
    })

    expect(createResponse.statusCode).toBe(201)
    expect(created).toMatchObject({
      status: "created",
      app: expect.objectContaining({
        allowedModels: ["llama-3.1-8b", "qwen2.5-coder"],
        name: "Finance Portal",
        ownerGroup: "Finance",
        rateLimitRpm: null,
        status: "enabled",
        tokenBudget7d: null,
      }),
      credential: expect.objectContaining({
        apiKey: expect.stringContaining("llmm_t4_"),
        authMethod: "api_key",
        bffBaseUrl: "https://bff.example.test",
        environment: "staging",
      }),
    })
    expect(listResponse.statusCode).toBe(200)
    expect(detailResponse.statusCode).toBe(200)
    expect(JSON.stringify(listResponse.json())).not.toContain("clientSecret")
    expect(JSON.stringify(detailResponse.json())).not.toContain("clientSecret")
    expect(JSON.stringify(listResponse.json())).not.toContain("client_secret")
    expect(JSON.stringify(detailResponse.json())).not.toContain("client_secret")
    expect(JSON.stringify(listResponse.json())).not.toContain(created.credential.apiKey)
    expect(JSON.stringify(detailResponse.json())).not.toContain(created.credential.apiKey)
    expect(JSON.stringify(listResponse.json())).not.toContain("keyHash")
    expect(JSON.stringify(detailResponse.json())).not.toContain("keyHash")
    expect(blockedPromotionResponse.statusCode).toBe(409)
    expect(blockedPromotionResponse.json()).toMatchObject({
      status: "blocked",
      app: expect.objectContaining({ id: appId }),
    })
    expect(testResponse.statusCode).toBe(200)
    expect(testResponse.json()).toMatchObject({
      environment: "staging",
      status: "passed",
      app: expect.objectContaining({
        environments: [
          expect.objectContaining({
            environment: "staging",
            productionReady: true,
            testStatus: "passed",
          }),
        ],
      }),
    })
    expect(promoteResponse.statusCode).toBe(200)
    expect(promoteResponse.json()).toMatchObject({
      status: "promoted",
      credential: expect.objectContaining({ environment: "production" }),
    })
    expect(rotateResponse.statusCode).toBe(200)
    expect(rotateResponse.json()).toMatchObject({
      status: "rotated",
      credential: expect.objectContaining({
        apiKey: expect.stringContaining("llmm_t4_"),
        authMethod: "api_key",
        environment: "staging",
      }),
    })
    expect(disableResponse.statusCode).toBe(200)
    expect(disableResponse.json()).toMatchObject({
      id: appId,
      status: "disabled",
    })
    expect(getAuditEventsForTest().map((event) => event.action)).toEqual(
      expect.arrayContaining([
        "admin.connected_app.created",
        "admin.connected_app.read",
        "admin.connected_app.tested",
        "admin.connected_app.promoted",
        "admin.connected_app.credentials_rotated",
        "admin.connected_app.disabled",
      ]),
    )
    await server.close()
  })

  it("blocks lower-role connected app mutations and returns controlled Keycloak setup failures", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()
    const payload = {
      allowedModels: ["llama-3.1-8b"],
      description: "Customer workflow integration.",
      name: "Customer Workflow",
      ownerGroup: "Everyone",
      authMethod: "oauth_client_credentials",
      rateLimitRpm: 60,
      tokenBudget7d: 250_000,
    }

    const builderResponse = await server.inject({
      method: "POST",
      url: "/api/admin/applications/connected-apps",
      headers: {
        ...builderHeaders,
        "idempotency-key": "connected-app-builder-denied",
      },
      payload,
    })
    const adminResponse = await server.inject({
      method: "POST",
      url: "/api/admin/applications/connected-apps",
      headers: {
        ...adminHeaders,
        "idempotency-key": "connected-app-keycloak-missing",
      },
      payload,
    })

    expect(builderResponse.statusCode).toBe(403)
    expect(adminResponse.statusCode).toBe(503)
    expect(adminResponse.json()).toMatchObject({
      detail: "Keycloak Admin API is not configured for connected app credentials.",
      status: 503,
      title: "Connected app identity unavailable",
    })
    expect(JSON.stringify(adminResponse.json()).toLowerCase()).not.toContain(
      "secret",
    )
    await server.close()
  })

  it("tests URL-backed MCP server connections through the BFF", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("REMOTE_MCP_TOKEN", "super-secret-token")
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              id: "console-test",
              jsonrpc: "2.0",
              result: {
                tools: [
                  { name: "search_docs" },
                  { name: "Bearer super-secret-token" },
                ],
              },
            }),
            {
              headers: { "Content-Type": "application/json" },
              status: 200,
            },
          ),
      ),
    )
    const server = buildServer()

    const response = await server.inject({
      method: "POST",
      url: "/api/admin/mcp-servers/test-connection",
      headers: adminHeaders,
      payload: {
        accessLevel: "read_only",
        authMode: "bearer",
        bearerTokenSecretRef: "REMOTE_MCP_TOKEN",
        chatCommand: "@docs-mcp",
        description: "Documentation MCP server.",
        endpointUrl: "https://mcp.example.test/rpc",
        name: "Docs MCP",
        transport: "url",
      },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      discoveredTools: ["search_docs", "[redacted]"],
      status: "passed",
    })
    expect(response.body).not.toContain("super-secret-token")
    expect(fetch).toHaveBeenCalledWith(
      "https://mcp.example.test/rpc",
      expect.objectContaining({
        headers: expect.objectContaining({
          get: expect.any(Function),
        }),
        method: "POST",
      }),
    )
    const requestInit = vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit
    expect((requestInit.headers as Headers).get("Authorization")).toBe(
      "Bearer super-secret-token",
    )
    await server.close()
  })

  it("returns native LibreChat agent posture for Admin governance", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const response = await server.inject({
      method: "GET",
      url: "/api/admin/librechat/agents/posture",
      headers: adminHeaders,
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      enabled: true,
      memoryEnabled: false,
      creatorPolicy: "builders_admins",
      modelEndpoint: "bff_litellm",
      mcpMode: "catalog_only",
      mcpGateway: {
        sourceStatus: "ok",
        runnableCount: 1,
        blockedCount: 0,
        exposedConnectorIds: ["internal-docs"],
      },
      mirroredAgents: [],
      recentAuditHref: "#audit-log-deferred",
    })
    expect(getAuditEventsForTest()).toEqual([
      expect.objectContaining({
        action: "admin.librechat_agents.posture.read",
        actorId: "admin-1",
        targetType: "librechat.native_agents",
      }),
    ])
    await server.close()
  })

  it("returns Internal Docs MCP posture for Admin diagnostics", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const response = await server.inject({
      method: "GET",
      url: "/api/admin/internal-docs/mcp/posture",
      headers: adminHeaders,
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      auth: {
        routeScopedServiceAuthEnabled: true,
        unresolvedPlaceholderProtection: true,
      },
      tools: [
        "list_governed_corpora",
        "resolve_corpus",
        "get_corpus_manifest",
        "query_governed_corpus",
        "search_internal_docs",
      ],
      embedding: expect.objectContaining({
        dimensions: 1024,
        model: "knowledge-embedding-local",
      }),
      corpora: {
        publishedAccessibleCount: 0,
        totalChunkCount: 0,
      },
    })
    expect(getAuditEventsForTest()).toEqual([
      expect.objectContaining({
        action: "admin.internal_docs_mcp.posture.read",
        actorId: "admin-1",
        targetType: "mcp.connector",
        targetId: "internal-docs",
      }),
    ])
    await server.close()
  })

  it("returns not found for removed MCP connector vetting decisions", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const decisionResponse = await server.inject({
      method: "POST",
      url: "/api/admin/connectors/mcp-slack/vetting",
      headers: {
        ...adminHeaders,
        "idempotency-key": "connector-vetting-slack-1",
      },
      payload: {
        checklist: completeConnectorReviewChecklist,
        decision: "approved_read_only",
        note: "Scopes and endpoint allowlist reviewed for demo channel reads.",
      },
    })
    expect(decisionResponse.statusCode).toBe(404)
    await server.close()
  })

  it("blocks non-admins from MCP connector vetting decisions", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const response = await server.inject({
      method: "POST",
      url: "/api/admin/connectors/internal-docs/vetting",
      headers: {
        ...builderHeaders,
        "idempotency-key": "connector-vetting-denied",
      },
      payload: {
        decision: "blocked",
        note: "Should not be accepted.",
      },
    })

    expect(response.statusCode).toBe(403)
    await server.close()
  })

  it("rejects read/write approvals for read-only MCP connectors", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const response = await server.inject({
      method: "POST",
      url: "/api/admin/connectors/internal-docs/vetting",
      headers: {
        ...adminHeaders,
        "idempotency-key": "connector-vetting-slack-rw",
      },
      payload: {
        checklist: completeConnectorReviewChecklist,
        decision: "approved_read_write",
        note: "Attempt to approve a read-only catalog entry as read-write.",
      },
    })

    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({
      title: "Connector decision rejected",
      detail:
        "This connector is cataloged as read-only, so it cannot receive a read/write approval.",
    })
    await server.close()
  })

  it("rejects connector approvals without a completed review checklist", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const response = await server.inject({
      method: "POST",
      url: "/api/admin/connectors/internal-docs/vetting",
      headers: {
        ...adminHeaders,
        "idempotency-key": "connector-vetting-slack-incomplete",
      },
      payload: {
        checklist: {
          ...completeConnectorReviewChecklist,
          endpointsReviewed: false,
        },
        decision: "approved_read_only",
        note: "Trying to approve without endpoint review.",
      },
    })

    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({
      title: "Connector decision rejected",
      detail:
        "Connector approvals require every review checklist assertion to be completed.",
    })
    await server.close()
  })

  it("requires authentication for Admin audit", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const response = await server.inject({
      method: "GET",
      url: "/api/admin/audit",
    })

    expect(response.statusCode).toBe(401)
    expect(getAuditEventsForTest()).toEqual([
      expect.objectContaining({
        action: "auth.denied",
        reason: "missing_token",
      }),
    ])
    await server.close()
  })

  it("blocks non-admin personas from Admin audit", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const server = buildServer()

    const response = await server.inject({
      method: "GET",
      url: "/api/admin/audit",
      headers: builderHeaders,
    })

    expect(response.statusCode).toBe(403)
    expect(getAuditEventsForTest()).toEqual([
      expect.objectContaining({
        action: "auth.denied",
        actorId: "builder-1",
        reason: "insufficient_persona",
      }),
    ])
    await server.close()
  })

  it("returns a searchable Admin audit timeline and audits the read", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    await emitAudit({
      actorId: "admin-1",
      action: "admin.builder_resource.approve",
      targetType: "builder.resources",
      targetId: "99999999-9999-4999-8999-999999999999",
      metadata: {
        authMode: "service-forwarded",
      },
    })
    await emitAudit({
      actorId: "builder-1",
      action: "builder.resource.submit",
      targetType: "builder.resources",
      targetId: "88888888-8888-4888-8888-888888888888",
    })
    const server = buildServer()

    const response = await server.inject({
      method: "GET",
      url: "/api/admin/audit?q=approve&limit=10",
      headers: adminHeaders,
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      query: "approve",
      selectedEventId: null,
      sourceStatus: "degraded",
      sources: [
        expect.objectContaining({
          id: "console",
          sourceStatus: "ok",
        }),
        expect.objectContaining({
          id: "external-audit",
          sourceStatus: "not_configured",
        }),
      ],
      events: [
        expect.objectContaining({
          action: "admin.builder_resource.approve",
          metadata: [
            expect.objectContaining({
              label: "authMode",
              value: "service-forwarded",
            }),
          ],
        }),
      ],
    })
    expect(response.json().events).toHaveLength(1)
    expect(getAuditEventsForTest()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "admin.audit.read",
          actorId: "admin-1",
          targetType: "common.audit_events",
          targetId: "timeline",
        }),
      ]),
    )
    await server.close()
  })

  it("filters Admin audit by selected event id", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    const selected = await emitAudit({
      actorId: "admin-1",
      action: "admin.builder_resource.reject",
      targetType: "builder.resources",
      targetId: "99999999-9999-4999-8999-999999999999",
      reason: "Needs changes",
    })
    await emitAudit({
      actorId: "builder-1",
      action: "builder.resource.submit",
      targetType: "builder.resources",
      targetId: "88888888-8888-4888-8888-888888888888",
    })
    const server = buildServer()

    const response = await server.inject({
      method: "GET",
      url: `/api/admin/audit?event=${encodeURIComponent(selected.id)}`,
      headers: adminHeaders,
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      selectedEventId: selected.id,
      events: [
        expect.objectContaining({
          id: selected.id,
          action: "admin.builder_resource.reject",
          reason: "Needs changes",
          severity: "warning",
        }),
      ],
    })
    expect(response.json().events).toHaveLength(1)
    await server.close()
  })

  it("returns the four Admin overview federation tiles", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    await emitAudit({
      actorId: "admin-1",
      action: "admin.builder_resource.approve",
      targetType: "builder.resources",
      targetId: "99999999-9999-4999-8999-999999999999",
    })
    const server = buildServer()

    const response = await server.inject({
      method: "GET",
      url: "/api/admin/overview",
      headers: adminHeaders,
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      tiles: [
        expect.objectContaining({ id: "ops" }),
        expect.objectContaining({ id: "health" }),
        expect.objectContaining({ id: "governance" }),
        expect.objectContaining({ id: "activity" }),
      ],
      activityEvents: [
        expect.objectContaining({
          action: "admin.builder_resource.approve",
          href: "#audit-log-deferred",
        }),
      ],
    })
    expect(
      response
        .json()
        .tiles.find((tile: { id: string }) => tile.id === "governance"),
    ).toMatchObject({
      metrics: expect.arrayContaining([
        expect.objectContaining({
          id: "pending-submissions",
          value: "1",
        }),
        expect.objectContaining({
          id: "blocked-connectors",
          value: "0",
        }),
      ]),
    })
    await server.close()
  })
})
