import { readFileSync } from "node:fs"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  KeycloakAdminClient,
  classifyRetainedRealmRoles,
  keycloakAdminConfigFromEnv,
  resolveLiveHumanAuthority,
  roleFromRealmRoles,
} from "./inference-core-keycloak-admin"

describe("inference-core Keycloak Admin boundary", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("has no mixed service imports or master-realm defaults", () => {
    const moduleSource = readFileSync(
      new URL("inference-core-keycloak-admin.ts", import.meta.url),
      "utf8",
    )

    expect(moduleSource).not.toMatch(/^import\s/m)
    expect(moduleSource).not.toMatch(/realm:\s*"master"/)
    expect(moduleSource).not.toMatch(
      /\b(?:assignRealmRole|getRealmRole|getUserRealmRoles)\b/,
    )
  })

  it("reports every missing appliance-realm service account field", () => {
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

  it("does not fall back to an ambient realm", () => {
    expect(
      keycloakAdminConfigFromEnv({
        KEYCLOAK_ADMIN_BASE_URL: "https://keycloak.example/keycloak",
        KEYCLOAK_ADMIN_CLIENT_ID: "console-team",
        KEYCLOAK_ADMIN_CLIENT_SECRET: "unit-test-credential",
        KEYCLOAK_REALM: "master",
      }),
    ).toEqual({
      config: null,
      missing: ["KEYCLOAK_ADMIN_REALM"],
      status: "not_configured",
    })
  })

  it("rejects the master realm as a customer administration target", () => {
    expect(
      keycloakAdminConfigFromEnv({
        KEYCLOAK_ADMIN_BASE_URL: "https://keycloak.example/keycloak",
        KEYCLOAK_ADMIN_CLIENT_ID: "console-team",
        KEYCLOAK_ADMIN_CLIENT_SECRET: "unit-test-credential",
        KEYCLOAK_ADMIN_REALM: "master",
      }),
    ).toEqual({
      config: null,
      missing: [],
      status: "invalid",
    })
  })

  it("normalizes the explicit appliance-realm configuration", () => {
    expect(
      keycloakAdminConfigFromEnv({
        KEYCLOAK_ADMIN_BASE_URL: "https://keycloak.example/keycloak/",
        KEYCLOAK_ADMIN_CLIENT_ID: "console-team",
        KEYCLOAK_ADMIN_CLIENT_SECRET: "unit-test-credential",
        KEYCLOAK_ADMIN_REALM: "llm-machines",
        KEYCLOAK_AUDIENCE: "console-bff",
        TEAM_ALLOWED_EMAIL_DOMAINS: "Example.com, llm-machines.com ",
      }),
    ).toEqual({
      config: {
        allowedEmailDomains: ["example.com", "llm-machines.com"],
        audience: "console-bff",
        baseUrl: "https://keycloak.example/keycloak",
        clientId: "console-team",
        clientSecret: "unit-test-credential",
        realm: "llm-machines",
      },
      missing: [],
      status: "ok",
    })
  })

  it("maps only the retained Admin and Operator realm roles", () => {
    expect(roleFromRealmRoles(["operator"])).toBe("operator")
    expect(roleFromRealmRoles(["ADMIN", "operator"])).toBeNull()
    expect(roleFromRealmRoles(["Admin"])).toBeNull()
    expect(roleFromRealmRoles(["OPERATOR"])).toBeNull()
    expect(roleFromRealmRoles([])).toBeNull()
    expect(roleFromRealmRoles(["auditor"])).toBeNull()
    expect(classifyRetainedRealmRoles(["ADMIN", "operator"])).toEqual({
      role: null,
      status: "invalid_case",
    })
  })

  it("resolves current enabled state and one retained role without an authority cache", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ access_token: "unit-test-token-1", expires_in: 60 }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          enabled: false,
          id: "operator-1",
          username: "operator.one",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse([{ id: "role-operator", name: "operator" }]),
      )
      .mockResolvedValueOnce(
        jsonResponse({ access_token: "unit-test-token-2", expires_in: 60 }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          enabled: true,
          id: "operator-1",
          username: "operator.one",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse([{ id: "role-admin", name: "admin" }]),
      )

    await expect(
      resolveLiveHumanAuthority("operator-1", {
        env: configEnv(),
        fetchImpl: fetchMock,
      }),
    ).resolves.toEqual({
      authority: {
        enabled: false,
        role: "operator",
        subject: "operator-1",
      },
      status: "ok",
    })
    await expect(
      resolveLiveHumanAuthority("operator-1", {
        env: configEnv(),
        fetchImpl: fetchMock,
      }),
    ).resolves.toEqual({
      authority: {
        enabled: true,
        role: "admin",
        subject: "operator-1",
      },
      status: "ok",
    })

    expect(fetchMock).toHaveBeenCalledTimes(6)
    expect(fetchMock.mock.calls[2]?.[0]).toBe(
      "https://keycloak.example/keycloak/admin/realms/llm-machines/users/operator-1/role-mappings/realm/composite",
    )
    expect(fetchMock.mock.calls[5]?.[0]).toBe(
      "https://keycloak.example/keycloak/admin/realms/llm-machines/users/operator-1/role-mappings/realm/composite",
    )
  })

  it("fails closed for ambiguous, missing, malformed, and unavailable live authority", async () => {
    const ambiguousFetch = liveAuthorityFetch({
      roles: ["admin", "operator"],
    })
    const unclassifiedFetch = liveAuthorityFetch({ roles: ["auditor"] })
    const invalidCaseFetch = liveAuthorityFetch({ roles: ["Admin"] })
    const malformedFetch = liveAuthorityFetch({ enabled: undefined })
    const unavailableFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ access_token: "unit-test-token", expires_in: 60 }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 503 }))

    await expect(
      resolveLiveHumanAuthority("user-1", {
        env: configEnv(),
        fetchImpl: ambiguousFetch,
      }),
    ).resolves.toEqual({
      authority: null,
      reason: "ambiguous_role",
      status: "denied",
    })
    await expect(
      resolveLiveHumanAuthority("user-1", {
        env: configEnv(),
        fetchImpl: unclassifiedFetch,
      }),
    ).resolves.toEqual({
      authority: null,
      reason: "unclassified_role",
      status: "denied",
    })
    await expect(
      resolveLiveHumanAuthority("user-1", {
        env: configEnv(),
        fetchImpl: invalidCaseFetch,
      }),
    ).resolves.toEqual({
      authority: null,
      reason: "invalid_role_case",
      status: "denied",
    })
    await expect(
      resolveLiveHumanAuthority("user-1", {
        env: configEnv(),
        fetchImpl: malformedFetch,
      }),
    ).resolves.toEqual({
      authority: null,
      reason: "authority_unavailable",
      status: "invalid",
    })
    await expect(
      resolveLiveHumanAuthority("user-1", {
        env: configEnv(),
        fetchImpl: unavailableFetch,
      }),
    ).resolves.toEqual({
      authority: null,
      reason: "authority_unavailable",
      status: "unavailable",
    })
    await expect(
      resolveLiveHumanAuthority("user-1", { env: {} }),
    ).resolves.toEqual({
      authority: null,
      reason: "authority_unavailable",
      status: "not_configured",
    })
    await expect(resolveLiveHumanAuthority(" ", { env: {} })).resolves.toEqual({
      authority: null,
      reason: "invalid_subject",
      status: "denied",
    })
  })

  it("requires MFA enrollment on every newly created human identity", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ access_token: "unit-test-token", expires_in: 60 }),
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
    const client = new KeycloakAdminClient(config(), fetchMock)

    await expect(
      client.createUser({
        displayName: "Operator One",
        email: "operator.one@example.com",
        enabled: false,
        username: "operator.one",
      }),
    ).resolves.toBe("user-1")
    expect(requestBody(fetchMock, 1)).toMatchObject({
      enabled: false,
      requiredActions: ["CONFIGURE_TOTP"],
    })
  })

  it("classifies confirmed and ambiguous Keycloak mutation failures", async () => {
    const rejectedFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ access_token: "unit-test-token", expires_in: 60 }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 400 }))
    const unknownFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ access_token: "unit-test-token", expires_in: 60 }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 503 }))

    await expect(
      new KeycloakAdminClient(config(), rejectedFetch).updateUserEnabled(
        "user-1",
        false,
      ),
    ).rejects.toMatchObject({ mutationOutcome: "rejected" })
    await expect(
      new KeycloakAdminClient(config(), unknownFetch).updateUserEnabled(
        "user-1",
        false,
      ),
    ).rejects.toMatchObject({ mutationOutcome: "unknown" })
  })

  it("normalizes token and JSON failures on preflight reads", async () => {
    const tokenFailure = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new SyntaxError("bounded-token-failure"))
    await expect(
      new KeycloakAdminClient(config(), tokenFailure).listUsers(),
    ).rejects.toMatchObject({
      message: "Keycloak Admin API authentication is unavailable.",
      name: "KeycloakAdminError",
      status: "unavailable",
    })

    const malformedJson = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ access_token: "unit-test-token", expires_in: 60 }),
      )
      .mockResolvedValueOnce(new Response("not-json", { status: 200 }))
    await expect(
      new KeycloakAdminClient(config(), malformedJson).listUsers(),
    ).rejects.toMatchObject({
      message: "Keycloak Admin API returned an invalid JSON response.",
      name: "KeycloakAdminError",
      status: "invalid",
    })
  })

  it("exhausts user-group pages before reporting membership", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (request) => {
      const url = new URL(request.toString())
      if (url.pathname.endsWith("/protocol/openid-connect/token")) {
        return jsonResponse({ access_token: "unit-test-token", expires_in: 60 })
      }
      if (url.pathname.endsWith("/users/user-1/groups")) {
        const first = Number(url.searchParams.get("first"))
        if (first === 0) {
          return jsonResponse(
            Array.from({ length: 100 }, (_, index) => ({
              id: `group-${index}`,
              name: `Group ${index}`,
              path: `/Group ${index}`,
            })),
          )
        }
        if (first === 100) {
          return jsonResponse([
            { id: "target-group", name: "Target", path: "/Target" },
          ])
        }
      }
      return new Response(null, { status: 404 })
    })

    await expect(
      new KeycloakAdminClient(config(), fetchMock).getUserGroups("user-1"),
    ).resolves.toHaveLength(101)
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe(
      "https://keycloak.example/keycloak/admin/realms/llm-machines/users/user-1/groups?first=100&max=100",
    )
  })

  it("fails closed when user-group pagination exceeds its verification bound", async () => {
    const page = Array.from({ length: 100 }, (_, index) => ({
      id: `group-${index}`,
      name: `Group ${index}`,
      path: `/Group ${index}`,
    }))
    const fetchMock = vi.fn<typeof fetch>(async (request) => {
      const url = new URL(request.toString())
      if (url.pathname.endsWith("/protocol/openid-connect/token")) {
        return jsonResponse({ access_token: "unit-test-token", expires_in: 60 })
      }
      if (url.pathname.endsWith("/users/user-1/groups")) {
        return url.searchParams.get("first") === "1000"
          ? jsonResponse([page[0]])
          : jsonResponse(page)
      }
      return new Response(null, { status: 404 })
    })

    await expect(
      new KeycloakAdminClient(config(), fetchMock).getUserGroups("user-1"),
    ).rejects.toMatchObject({ status: "unavailable" })
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe(
      "https://keycloak.example/keycloak/admin/realms/llm-machines/users/user-1/groups?first=1000&max=1",
    )
  })

  it("propagates the operation abort signal through service-token acquisition", async () => {
    const controller = new AbortController()
    controller.abort(new Error("identity-deadline"))
    const fetchMock = vi.fn<typeof fetch>(async (_request, init) => {
      expect(init?.signal?.aborted).toBe(true)
      throw init?.signal?.reason
    })

    await expect(
      new KeycloakAdminClient(
        config(),
        fetchMock,
        undefined,
        controller.signal,
      ).listUsers(),
    ).rejects.toMatchObject({
      name: "KeycloakAdminError",
      status: "unavailable",
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("rejects malformed realm roles instead of treating them as Operator", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ access_token: "unit-test-token", expires_in: 60 }),
      )
      .mockResolvedValueOnce(jsonResponse([{}]))

    const client = new KeycloakAdminClient(config(), fetchMock)

    await expect(
      client.getUserEffectiveRealmRoles("user-1"),
    ).rejects.toMatchObject({
      message: "Keycloak Admin API returned a malformed realm role.",
      name: "KeycloakAdminError",
      status: "invalid",
    })
  })

  it("creates and rotates an application client in the configured realm", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ access_token: "unit-test-token", expires_in: 60 }),
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
      .mockResolvedValueOnce(
        jsonResponse({ value: "unit-test-created-credential" }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ value: "unit-test-rotated-credential" }),
      )

    const client = new KeycloakAdminClient(config(), fetchMock)
    const created = await client.createConfidentialClient({
      clientId: "llmm-app-finance",
      description: "Finance integration.",
      name: "Finance Portal",
    })
    const rotated = await client.rotateConfidentialClientSecret(
      created.id,
      created.clientId,
    )

    expect(created).toEqual({
      clientId: "llmm-app-finance",
      clientSecret: "unit-test-created-credential",
      id: "client-uuid",
      tokenUrl:
        "https://keycloak.example/keycloak/realms/llm-machines/protocol/openid-connect/token",
    })
    expect(rotated).toMatchObject({
      clientId: "llmm-app-finance",
      clientSecret: "unit-test-rotated-credential",
      id: "client-uuid",
    })
    expect(fetchMock.mock.calls[2]?.[0]).toBe(
      "https://keycloak.example/keycloak/admin/realms/llm-machines/clients/client-uuid/protocol-mappers/models",
    )
    expect(fetchMock.mock.calls[4]?.[0]).toBe(
      "https://keycloak.example/keycloak/admin/realms/llm-machines/clients/client-uuid/client-secret",
    )
    expect(fetchMock.mock.calls[4]?.[1]?.method).toBe("POST")
  })

  it("deletes an application client through the configured realm", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ access_token: "unit-test-token", expires_in: 60 }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))

    const client = new KeycloakAdminClient(config(), fetchMock)
    await expect(
      client.deleteConfidentialClient("client/uuid"),
    ).resolves.toBeUndefined()

    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "https://keycloak.example/keycloak/admin/realms/llm-machines/clients/client%2Fuuid",
    )
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe("DELETE")
  })

  it("removes a partially provisioned client when finishing setup fails", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ access_token: "unit-test-token", expires_in: 60 }),
      )
      .mockResolvedValueOnce(
        new Response(null, {
          headers: {
            location:
              "https://keycloak.example/admin/realms/llm-machines/clients/partial-client-uuid",
          },
          status: 201,
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))

    const client = new KeycloakAdminClient(config(), fetchMock)
    await expect(
      client.createConfidentialClient({
        clientId: "llmm-app-partial",
        description: "Partial client test.",
        name: "Partial Client",
      }),
    ).rejects.toMatchObject({
      message: "Keycloak Admin API is unavailable.",
      status: "unavailable",
    })

    expect(fetchMock.mock.calls[3]?.[0]).toBe(
      "https://keycloak.example/keycloak/admin/realms/llm-machines/clients/partial-client-uuid",
    )
    expect(fetchMock.mock.calls[3]?.[1]?.method).toBe("DELETE")
  })

  it("returns a bounded reconciliation instruction when partial-client cleanup fails", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ access_token: "unit-test-token", expires_in: 60 }),
      )
      .mockResolvedValueOnce(
        new Response(null, {
          headers: {
            location:
              "https://keycloak.example/admin/realms/llm-machines/clients/partial-client-uuid",
          },
          status: 201,
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }))

    const client = new KeycloakAdminClient(config(), fetchMock)
    await expect(
      client.createConfidentialClient({
        clientId: "llmm-app-partial",
        description: "Partial client test.",
        name: "Partial Client",
      }),
    ).rejects.toMatchObject({
      message:
        "Keycloak client provisioning did not complete. Reconcile client llmm-app-partial before retrying; do not use a new idempotency key until Keycloak is checked.",
      status: "unavailable",
    })
  })

  it("returns a bounded reconciliation instruction when client creation is ambiguous", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ access_token: "unit-test-token", expires_in: 60 }),
      )
      .mockRejectedValueOnce(new Error("private-network-error-marker"))

    const client = new KeycloakAdminClient(config(), fetchMock)
    await expect(
      client.createConfidentialClient({
        clientId: "llmm-app-ambiguous",
        description: "Ambiguous client test.",
        name: "Ambiguous Client",
      }),
    ).rejects.toMatchObject({
      message:
        "Keycloak client creation could not be confirmed. Reconcile client llmm-app-ambiguous before retrying; do not use a new idempotency key until Keycloak is checked.",
      status: "unavailable",
    })
  })
})

function config() {
  return {
    allowedEmailDomains: ["example.com"],
    audience: "console-bff",
    baseUrl: "https://keycloak.example/keycloak",
    clientId: "console-team",
    clientSecret: "unit-test-credential",
    realm: "llm-machines",
  }
}

function configEnv(): NodeJS.ProcessEnv {
  return {
    KEYCLOAK_ADMIN_BASE_URL: "https://keycloak.example/keycloak",
    KEYCLOAK_ADMIN_CLIENT_ID: "console-team",
    KEYCLOAK_ADMIN_CLIENT_SECRET: "unit-test-credential",
    KEYCLOAK_ADMIN_REALM: "llm-machines",
  }
}

function liveAuthorityFetch(input: {
  enabled?: boolean
  roles?: string[]
}) {
  const user: Record<string, unknown> = {
    id: "user-1",
    username: "user.one",
  }
  if (input.enabled !== undefined) {
    user.enabled = input.enabled
  } else if (!("enabled" in input)) {
    user.enabled = true
  }
  return vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      jsonResponse({ access_token: "unit-test-token", expires_in: 60 }),
    )
    .mockResolvedValueOnce(jsonResponse(user))
    .mockResolvedValueOnce(
      jsonResponse(
        (input.roles ?? ["operator"]).map((role) => ({
          id: `role-${role}`,
          name: role,
        })),
      ),
    )
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
