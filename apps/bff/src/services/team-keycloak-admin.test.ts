import { afterEach, describe, expect, it, vi } from "vitest"
import {
  KeycloakAdminClient,
  KeycloakAdminError,
  keycloakAdminConfigFromEnv,
} from "./team-keycloak-admin"

describe("Keycloak Admin client", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it("reports missing service account configuration", () => {
    expect(keycloakAdminConfigFromEnv({})).toEqual({
      config: null,
      missing: [
        "KEYCLOAK_ADMIN_BASE_URL",
        "KEYCLOAK_ADMIN_CLIENT_ID",
        "KEYCLOAK_ADMIN_CLIENT_SECRET",
        "KEYCLOAK_ADMIN_REALM",
      ],
      status: "not_configured",
    })
  })

  it("parses service account configuration and corporate email domains", () => {
    const result = keycloakAdminConfigFromEnv({
      KEYCLOAK_ADMIN_BASE_URL: "https://keycloak.example/keycloak/",
      KEYCLOAK_ADMIN_CLIENT_ID: "console-team",
      KEYCLOAK_ADMIN_CLIENT_SECRET: "secret",
      KEYCLOAK_ADMIN_REALM: "llm-machines",
      KEYCLOAK_AUDIENCE: "console-bff",
      TEAM_ALLOWED_EMAIL_DOMAINS: "example.com, llm-machines.com",
    })

    expect(result).toMatchObject({
      status: "ok",
      config: {
        allowedEmailDomains: ["example.com", "llm-machines.com"],
        audience: "console-bff",
        baseUrl: "https://keycloak.example/keycloak",
        clientId: "console-team",
        realm: "llm-machines",
      },
    })
  })

  it("obtains and caches an admin token before reading users", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ access_token: "admin-token", expires_in: 60 }),
      )
      .mockResolvedValueOnce(
        jsonResponse([
          {
            id: "user-1",
            username: "ana",
            email: "ana@example.com",
            firstName: "Ana",
            lastName: "Admin",
            enabled: true,
            createdTimestamp: 1780000000000,
          },
        ]),
      )
      .mockResolvedValueOnce(jsonResponse([]))

    const client = new KeycloakAdminClient(config(), fetchMock)
    const users = await client.listUsers()
    const secondRead = await client.listUsers()

    expect(users[0]).toMatchObject({
      id: "user-1",
      username: "ana",
      email: "ana@example.com",
      displayName: "Ana Admin",
      enabled: true,
    })
    expect(secondRead).toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://keycloak.example/keycloak/realms/llm-machines/protocol/openid-connect/token",
    )
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "https://keycloak.example/keycloak/admin/realms/llm-machines/users?max=500",
    )
    expect(
      (fetchMock.mock.calls[1]?.[1]?.headers as Record<string, string>)
        .authorization,
    ).toBe("Bearer admin-token")
  })

  it("creates users, sets non-temporary passwords, and sends email actions without returning secrets", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ access_token: "admin-token", expires_in: 60 }),
      )
      .mockResolvedValueOnce(
        new Response(null, {
          status: 201,
          headers: {
            location:
              "https://keycloak.example/admin/realms/llm-machines/users/user-1",
          },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))

    const client = new KeycloakAdminClient(config(), fetchMock)
    const id = await client.createUser({
      displayName: "Ana Admin",
      email: "ana@example.com",
      enabled: true,
      username: "ana",
    })
    await client.setPassword(id, "generated-password")
    await client.executeEmailActions(id, ["UPDATE_PASSWORD"])

    expect(id).toBe("user-1")
    expect(requestBody(fetchMock, 2)).toEqual({
      temporary: false,
      type: "password",
      value: "generated-password",
    })
    expect(requestBody(fetchMock, 3)).toEqual(["UPDATE_PASSWORD"])
  })

  it("manages groups and group memberships through Keycloak Admin APIs", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ access_token: "admin-token", expires_in: 60 }),
      )
      .mockResolvedValueOnce(
        new Response(null, {
          status: 201,
          headers: {
            location:
              "https://keycloak.example/admin/realms/llm-machines/groups/group-1",
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ id: "group-1", name: "Support" }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
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
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))

    const client = new KeycloakAdminClient(config(), fetchMock)
    const id = await client.createGroup("Support")
    const group = await client.getGroup(id)
    await client.updateGroup(id, "Operators")
    const members = await client.getGroupMembers(id)
    await client.joinGroup("user-1", id)
    await client.leaveGroup("user-1", id)
    await client.deleteGroup(id)

    expect(id).toBe("group-1")
    expect(group.name).toBe("Support")
    expect(members[0]?.displayName).toBe("Ana Admin")
    expect(requestBody(fetchMock, 1)).toEqual({ name: "Support" })
    expect(requestBody(fetchMock, 3)).toEqual({ name: "Operators" })
    expect(fetchMock.mock.calls[6]?.[0]).toBe(
      "https://keycloak.example/keycloak/admin/realms/llm-machines/users/user-1/groups/group-1",
    )
    expect(fetchMock.mock.calls[7]?.[0]).toBe(
      "https://keycloak.example/keycloak/admin/realms/llm-machines/groups/group-1",
    )
  })

  it("creates and rotates confidential service-account clients without persisting secrets", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ access_token: "admin-token", expires_in: 60 }),
      )
      .mockResolvedValueOnce(
        new Response(null, {
          headers: {
            location:
              "https://keycloak.example/admin/realms/llm-machines/clients/client-uuid",
          },
          status: 201,
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 201 }))
      .mockResolvedValueOnce(jsonResponse({ value: "created-client-secret" }))
      .mockResolvedValueOnce(jsonResponse({ value: "rotated-client-secret" }))

    const client = new KeycloakAdminClient(config(), fetchMock)
    const created = await client.createConfidentialClient({
      clientId: "llmm-app-finance-staging",
      description: "Finance staging integration.",
      name: "Finance Portal (staging)",
    })
    const rotated = await client.rotateConfidentialClientSecret(
      created.id,
      created.clientId,
    )

    expect(created).toEqual({
      clientId: "llmm-app-finance-staging",
      clientSecret: "created-client-secret",
      id: "client-uuid",
      tokenUrl:
        "https://keycloak.example/keycloak/realms/llm-machines/protocol/openid-connect/token",
    })
    expect(rotated).toEqual({
      clientId: "llmm-app-finance-staging",
      clientSecret: "rotated-client-secret",
      id: "client-uuid",
      tokenUrl:
        "https://keycloak.example/keycloak/realms/llm-machines/protocol/openid-connect/token",
    })
    expect(requestBody(fetchMock, 1)).toMatchObject({
      clientId: "llmm-app-finance-staging",
      directAccessGrantsEnabled: false,
      publicClient: false,
      serviceAccountsEnabled: true,
      standardFlowEnabled: false,
    })
    expect(fetchMock.mock.calls[2]?.[0]).toBe(
      "https://keycloak.example/keycloak/admin/realms/llm-machines/clients/client-uuid/protocol-mappers/models",
    )
    expect(requestBody(fetchMock, 2)).toMatchObject({
      config: {
        "access.token.claim": "true",
        "id.token.claim": "false",
        "included.client.audience": "console-bff",
      },
      name: "console-bff-audience",
      protocolMapper: "oidc-audience-mapper",
    })
    expect(fetchMock.mock.calls[2]?.[0]).toBe(
      "https://keycloak.example/keycloak/admin/realms/llm-machines/clients/client-uuid/protocol-mappers/models",
    )
    expect(fetchMock.mock.calls[3]?.[0]).toBe(
      "https://keycloak.example/keycloak/admin/realms/llm-machines/clients/client-uuid/client-secret",
    )
    expect(fetchMock.mock.calls[4]?.[0]).toBe(
      "https://keycloak.example/keycloak/admin/realms/llm-machines/clients/client-uuid/client-secret",
    )
    expect(fetchMock.mock.calls[4]?.[1]?.method).toBe("POST")
  })

  it("maps Keycloak failures to controlled service states without leaking credentials", async () => {
    const unauthorized = new KeycloakAdminClient(
      config(),
      vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 401 })),
    )
    await expect(unauthorized.listUsers()).rejects.toMatchObject({
      status: "unauthorized",
    })

    const unavailable = new KeycloakAdminClient(
      config(),
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          jsonResponse({ access_token: "admin-token", expires_in: 60 }),
        )
        .mockResolvedValueOnce(new Response(null, { status: 503 })),
    )
    await expect(unavailable.listGroups()).rejects.toMatchObject({
      status: "unavailable",
    })

    const invalid = new KeycloakAdminClient(
      config(),
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(jsonResponse({ unexpected: true })),
    )
    const invalidResult = invalid.listUsers()
    await expect(invalidResult).rejects.toBeInstanceOf(KeycloakAdminError)
    await expect(invalidResult).rejects.toMatchObject({
      message: "Invalid Keycloak token response.",
      status: "invalid",
    })
  })
})

function config() {
  return {
    allowedEmailDomains: ["example.com"],
    audience: "console-bff",
    baseUrl: "https://keycloak.example/keycloak",
    clientId: "console-team",
    clientSecret: "admin-client-secret",
    realm: "llm-machines",
  }
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
