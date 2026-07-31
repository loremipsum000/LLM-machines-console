import { readFileSync } from "node:fs"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  KeycloakAdminClient,
  KeycloakApplicationAdminClient,
  classifyRetainedRealmRoles,
  keycloakAdminClientFromEnv,
  keycloakAdminConfigFromEnv,
  keycloakApplicationAdminClientFromEnv,
  keycloakApplicationAdminConfigFromEnv,
  resolveLiveHumanAuthority,
  roleFromRealmRoles,
} from "./inference-core-keycloak-admin"

const APPLICATION_CLIENT_ID = "llmm-app-11111111-1111-4111-8111-111111111111"
const AMBIGUOUS_APPLICATION_CLIENT_ID =
  "llmm-app-22222222-2222-4222-8222-222222222222"
const EXISTING_APPLICATION_CLIENT_ID =
  "llmm-app-33333333-3333-4333-8333-333333333333"
const PARTIAL_APPLICATION_CLIENT_ID =
  "llmm-app-44444444-4444-4444-8444-444444444444"
const REJECTED_APPLICATION_CLIENT_ID =
  "llmm-app-55555555-5555-4555-8555-555555555555"
const INVALID_KEYCLOAK_ADMIN_BASE_URLS = [
  "ftp://keycloak.example/keycloak",
  "file:///keycloak",
  "https://user:password@keycloak.example/keycloak",
  "https://@keycloak.example/keycloak",
  "https://keycloak.example/keycloak?mode=admin",
  "https://keycloak.example/keycloak#admin",
  "https://keycloak.example/keycloak?",
  "https://keycloak.example/keycloak#",
] as const

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
        KEYCLOAK_ADMIN_CLIENT_ID: "console-human-admin",
        KEYCLOAK_ADMIN_CLIENT_SECRET: "unit-test-credential",
        KEYCLOAK_REALM: "master",
      }),
    ).toEqual({
      config: null,
      missing: ["KEYCLOAK_ADMIN_REALM"],
      status: "not_configured",
    })
  })

  it.each(["master", "llm-machines-applications", "customer-realm"])(
    "rejects human-admin realm %s before a token request",
    async (realm) => {
      const env = {
        KEYCLOAK_ADMIN_BASE_URL: "https://keycloak.example/keycloak",
        KEYCLOAK_ADMIN_CLIENT_ID: "console-human-admin",
        KEYCLOAK_ADMIN_CLIENT_SECRET: "unit-test-credential",
        KEYCLOAK_ADMIN_REALM: realm,
      }
      const fetchMock = vi.fn<typeof fetch>()

      expect(keycloakAdminConfigFromEnv(env)).toEqual({
        config: null,
        missing: [],
        status: "invalid",
      })
      await expect(
        resolveLiveHumanAuthority("user-1", { env, fetchImpl: fetchMock }),
      ).resolves.toMatchObject({
        authority: null,
        status: "invalid",
      })
      expect(fetchMock).not.toHaveBeenCalled()
    },
  )

  it("normalizes the explicit appliance-realm configuration", () => {
    expect(
      keycloakAdminConfigFromEnv({
        KEYCLOAK_ADMIN_BASE_URL: "https://keycloak.example/keycloak/",
        KEYCLOAK_ADMIN_CLIENT_ID: "console-human-admin",
        KEYCLOAK_ADMIN_CLIENT_SECRET: " unit-test-credential ",
        KEYCLOAK_ADMIN_REALM: "llm-machines",
        KEYCLOAK_AUDIENCE: "console-bff",
        TEAM_ALLOWED_EMAIL_DOMAINS: "Example.com, llm-machines.com ",
      }),
    ).toEqual({
      config: {
        allowedEmailDomains: ["example.com", "llm-machines.com"],
        audience: "console-bff",
        baseUrl: "https://keycloak.example/keycloak",
        clientId: "console-human-admin",
        clientSecret: "unit-test-credential",
        realm: "llm-machines",
      },
      missing: [],
      status: "ok",
    })
  })

  it.each(INVALID_KEYCLOAK_ADMIN_BASE_URLS)(
    "rejects invalid human-admin base URL %s before a token request",
    async (baseUrl) => {
      const env = { ...configEnv(), KEYCLOAK_ADMIN_BASE_URL: baseUrl }
      const fetchMock = vi.fn<typeof fetch>()

      expect(keycloakAdminConfigFromEnv(env)).toEqual({
        config: null,
        missing: [],
        status: "invalid",
      })
      expect(keycloakAdminClientFromEnv(env)).toEqual({
        client: null,
        status: "invalid",
      })
      await expect(
        resolveLiveHumanAuthority("user-1", { env, fetchImpl: fetchMock }),
      ).resolves.toEqual({
        authority: null,
        reason: "authority_unavailable",
        status: "invalid",
      })
      expect(fetchMock).not.toHaveBeenCalled()
    },
  )

  it.each([
    ["https://keycloak.example/", "https://keycloak.example"],
    [
      "http://10.254.254.254:8080/keycloak///",
      "http://10.254.254.254:8080/keycloak",
    ],
  ] as const)(
    "accepts and normalizes human-admin base URL %s",
    (baseUrl, expected) => {
      expect(
        keycloakAdminConfigFromEnv({
          ...configEnv(),
          KEYCLOAK_ADMIN_BASE_URL: baseUrl,
        }),
      ).toMatchObject({ config: { baseUrl: expected }, status: "ok" })
    },
  )

  it("requires a separate exact Application OAuth service account", () => {
    expect(
      keycloakApplicationAdminConfigFromEnv({
        KEYCLOAK_ADMIN_BASE_URL: "https://keycloak.example/keycloak",
        KEYCLOAK_ADMIN_CLIENT_ID: "console-human-admin",
        KEYCLOAK_ADMIN_CLIENT_SECRET: "human-unit-test-credential",
        KEYCLOAK_ADMIN_REALM: "llm-machines",
      }),
    ).toEqual({
      config: null,
      missing: [
        "KEYCLOAK_APPLICATION_ADMIN_REALM",
        "KEYCLOAK_APPLICATION_ADMIN_CLIENT_ID",
        "KEYCLOAK_APPLICATION_ADMIN_CLIENT_SECRET",
        "KEYCLOAK_AUDIENCE",
      ],
      status: "not_configured",
    })

    expect(
      keycloakApplicationAdminConfigFromEnv({
        KEYCLOAK_ADMIN_BASE_URL: "https://keycloak.example/keycloak",
        KEYCLOAK_APPLICATION_ADMIN_REALM: "llm-machines-applications",
        KEYCLOAK_APPLICATION_ADMIN_CLIENT_ID: "console-human-admin",
        KEYCLOAK_APPLICATION_ADMIN_CLIENT_SECRET:
          "application-unit-test-credential",
        KEYCLOAK_AUDIENCE: "console-bff",
      }),
    ).toEqual({ config: null, missing: [], status: "invalid" })

    expect(
      keycloakAdminConfigFromEnv({
        KEYCLOAK_ADMIN_BASE_URL: "https://keycloak.example/keycloak",
        KEYCLOAK_ADMIN_CLIENT_ID: "console-application-admin",
        KEYCLOAK_ADMIN_CLIENT_SECRET: "application-unit-test-credential",
        KEYCLOAK_ADMIN_REALM: "llm-machines",
      }),
    ).toEqual({ config: null, missing: [], status: "invalid" })
  })

  it.each(["master", "llm-machines", "customer-applications"])(
    "rejects Application-admin realm %s without falling back to the human realm",
    (realm) => {
      const env = {
        ...applicationConfigEnv(),
        KEYCLOAK_ADMIN_REALM: "llm-machines",
        KEYCLOAK_APPLICATION_ADMIN_REALM: realm,
      }

      expect(keycloakApplicationAdminConfigFromEnv(env)).toEqual({
        config: null,
        missing: [],
        status: "invalid",
      })
      expect(keycloakApplicationAdminClientFromEnv(env)).toEqual({
        client: null,
        status: "invalid",
      })
    },
  )

  it("requires the dedicated Application realm without a human-realm fallback", () => {
    const env = {
      KEYCLOAK_ADMIN_BASE_URL: "https://keycloak.example/keycloak",
      KEYCLOAK_ADMIN_REALM: "llm-machines",
      KEYCLOAK_APPLICATION_ADMIN_CLIENT_ID: "console-application-admin",
      KEYCLOAK_APPLICATION_ADMIN_CLIENT_SECRET:
        "application-unit-test-credential",
      KEYCLOAK_AUDIENCE: "console-bff",
    }

    expect(keycloakApplicationAdminConfigFromEnv(env)).toEqual({
      config: null,
      missing: ["KEYCLOAK_APPLICATION_ADMIN_REALM"],
      status: "not_configured",
    })
    expect(keycloakApplicationAdminClientFromEnv(env)).toEqual({
      client: null,
      status: "not_configured",
    })
  })

  it.each([undefined, "console-web", " CONSOLE-BFF "])(
    "rejects required Application audience %s before client creation",
    (audience) => {
      const env = {
        ...applicationConfigEnv(),
        KEYCLOAK_AUDIENCE: audience,
      }
      const expectedStatus =
        audience === undefined ? "not_configured" : "invalid"

      expect(keycloakApplicationAdminConfigFromEnv(env)).toMatchObject({
        config: null,
        status: expectedStatus,
      })
      expect(keycloakApplicationAdminClientFromEnv(env)).toEqual({
        client: null,
        status: expectedStatus,
      })
    },
  )

  it("normalizes the isolated Application OAuth configuration", () => {
    const env = {
      KEYCLOAK_ADMIN_BASE_URL: "https://keycloak.example/keycloak/",
      KEYCLOAK_APPLICATION_ADMIN_REALM: "llm-machines-applications",
      KEYCLOAK_APPLICATION_ADMIN_CLIENT_ID: "console-application-admin",
      KEYCLOAK_APPLICATION_ADMIN_CLIENT_SECRET:
        " application-unit-test-credential ",
      KEYCLOAK_AUDIENCE: "console-bff",
    }
    expect(keycloakApplicationAdminConfigFromEnv(env)).toEqual({
      config: {
        allowedEmailDomains: [],
        audience: "console-bff",
        baseUrl: "https://keycloak.example/keycloak",
        clientId: "console-application-admin",
        clientSecret: "application-unit-test-credential",
        realm: "llm-machines-applications",
      },
      missing: [],
      status: "ok",
    })
    expect(keycloakApplicationAdminClientFromEnv(env)).toMatchObject({
      client: expect.any(KeycloakApplicationAdminClient),
      status: "ok",
    })
  })

  it.each(INVALID_KEYCLOAK_ADMIN_BASE_URLS)(
    "rejects invalid Application-admin base URL %s before a token request",
    (baseUrl) => {
      const env = {
        ...applicationConfigEnv(),
        KEYCLOAK_ADMIN_BASE_URL: baseUrl,
      }

      expect(keycloakApplicationAdminConfigFromEnv(env)).toEqual({
        config: null,
        missing: [],
        status: "invalid",
      })
      expect(keycloakApplicationAdminClientFromEnv(env)).toEqual({
        client: null,
        status: "invalid",
      })
    },
  )

  it.each([
    ["https://keycloak.example/", "https://keycloak.example"],
    [
      "http://10.254.254.254:8080/keycloak///",
      "http://10.254.254.254:8080/keycloak",
    ],
  ] as const)(
    "accepts and normalizes Application-admin base URL %s",
    (baseUrl, expected) => {
      expect(
        keycloakApplicationAdminConfigFromEnv({
          ...applicationConfigEnv(),
          KEYCLOAK_ADMIN_BASE_URL: baseUrl,
        }),
      ).toMatchObject({ config: { baseUrl: expected }, status: "ok" })
    },
  )

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

  it("keeps the operation abort active while reading a response body", async () => {
    const controller = new AbortController()
    const stalledBody = new ReadableStream<Uint8Array>({})
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ access_token: "unit-test-token", expires_in: 60 }),
      )
      .mockResolvedValueOnce(
        new Response(stalledBody, {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
      )
    const pending = new KeycloakAdminClient(
      config(),
      fetchMock,
      undefined,
      controller.signal,
    ).listUsers()

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    controller.abort(new Error("identity-deadline"))

    await expect(pending).rejects.toMatchObject({
      name: "KeycloakAdminError",
      status: "unavailable",
    })
    expect(fetchMock.mock.calls[1]?.[1]?.signal?.aborted).toBe(true)
  })

  it("rejects an oversized Keycloak JSON response", async () => {
    const oversizedBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(2 * 1024 * 1024))
        controller.enqueue(new Uint8Array([0]))
        controller.close()
      },
    })
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ access_token: "unit-test-token", expires_in: 60 }),
      )
      .mockResolvedValueOnce(
        new Response(oversizedBody, {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
      )

    await expect(
      new KeycloakAdminClient(config(), fetchMock).listUsers(),
    ).rejects.toMatchObject({
      message: "Keycloak Admin API returned an invalid JSON response.",
      name: "KeycloakAdminError",
      status: "invalid",
    })
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
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(
        new Response(null, {
          headers: {
            location:
              "https://keycloak.example/admin/realms/llm-machines-applications/clients/client-uuid",
          },
          status: 201,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse([{ clientId: APPLICATION_CLIENT_ID, id: "client-uuid" }]),
      )
      .mockResolvedValueOnce(new Response(null, { status: 201 }))
      .mockResolvedValueOnce(
        jsonResponse({ value: "unit-test-created-credential" }),
      )
      .mockResolvedValueOnce(
        jsonResponse([{ clientId: APPLICATION_CLIENT_ID, id: "client-uuid" }]),
      )
      .mockResolvedValueOnce(
        jsonResponse({ value: "unit-test-rotated-credential" }),
      )

    const client = new KeycloakApplicationAdminClient(
      applicationConfig(),
      fetchMock,
    )
    const created = await client.createConfidentialClient({
      clientId: APPLICATION_CLIENT_ID,
      description: "Finance integration.",
      name: "Finance Portal",
    })
    const rotated = await client.rotateConfidentialClientSecret(
      created.id,
      created.clientId,
    )

    expect(created).toEqual({
      clientId: APPLICATION_CLIENT_ID,
      clientSecret: "unit-test-created-credential",
      id: "client-uuid",
      tokenUrl:
        "https://keycloak.example/keycloak/realms/llm-machines-applications/protocol/openid-connect/token",
    })
    expect(rotated).toMatchObject({
      clientId: APPLICATION_CLIENT_ID,
      clientSecret: "unit-test-rotated-credential",
      id: "client-uuid",
    })
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://keycloak.example/keycloak/realms/llm-machines-applications/protocol/openid-connect/token",
    )
    expect(fetchMock.mock.calls[4]?.[0]).toBe(
      "https://keycloak.example/keycloak/admin/realms/llm-machines-applications/clients/client-uuid/protocol-mappers/models",
    )
    const audienceMapper = requestBody(fetchMock, 4)
    expect(audienceMapper).toMatchObject({
      config: { "included.custom.audience": "console-bff" },
      name: "console-bff-audience",
      protocolMapper: "oidc-audience-mapper",
    })
    expect(audienceMapper.config).not.toHaveProperty("included.client.audience")
    expect(fetchMock.mock.calls[7]?.[0]).toBe(
      "https://keycloak.example/keycloak/admin/realms/llm-machines-applications/clients/client-uuid/client-secret",
    )
    expect(fetchMock.mock.calls[7]?.[1]?.method).toBe("POST")
    expect(fetchMock.mock.calls[1]?.[0]).toContain(
      `/clients?clientId=${APPLICATION_CLIENT_ID}&exact=true&max=2`,
    )
    expect(
      fetchMock.mock.calls.every(([, init]) => init?.redirect === "error"),
    ).toBe(true)
  })

  it("rejects application client IDs outside the exact managed namespace", async () => {
    const fetchMock = vi.fn<typeof fetch>()
    const client = new KeycloakApplicationAdminClient(
      applicationConfig(),
      fetchMock,
    )

    await expect(
      client.findConfidentialClient("console-bff"),
    ).rejects.toMatchObject({
      message:
        "Keycloak Application client ID is outside the llmm-app-UUID namespace.",
      status: "invalid",
    })
    await expect(
      client.createConfidentialClient({
        clientId: "llmm-app-not-a-uuid",
        description: "Out-of-scope client.",
        name: "Out of scope",
      }),
    ).rejects.toMatchObject({
      mutationOutcome: "rejected",
      status: "invalid",
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("requires exact post-create lookup to match the Location resource", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ access_token: "unit-test-token", expires_in: 60 }),
      )
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(
        new Response(null, {
          headers: {
            location:
              "https://keycloak.example/admin/realms/llm-machines-applications/clients/location-client-uuid",
          },
          status: 201,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse([
          { clientId: APPLICATION_CLIENT_ID, id: "different-client-uuid" },
        ]),
      )
    const client = new KeycloakApplicationAdminClient(
      applicationConfig(),
      fetchMock,
    )

    await expect(
      client.createConfidentialClient({
        clientId: APPLICATION_CLIENT_ID,
        description: "Mismatched resource test.",
        name: "Mismatched resource",
      }),
    ).rejects.toMatchObject({
      mutationOutcome: "unknown",
      status: "unavailable",
    })
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it("deletes an application client through the configured realm", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ access_token: "unit-test-token", expires_in: 60 }),
      )
      .mockResolvedValueOnce(
        jsonResponse([{ clientId: APPLICATION_CLIENT_ID, id: "client/uuid" }]),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))

    const client = new KeycloakApplicationAdminClient(
      applicationConfig(),
      fetchMock,
    )
    await expect(
      client.deleteConfidentialClient("client/uuid", APPLICATION_CLIENT_ID),
    ).resolves.toBeUndefined()

    expect(fetchMock.mock.calls[2]?.[0]).toBe(
      "https://keycloak.example/keycloak/admin/realms/llm-machines-applications/clients/client%2Fuuid",
    )
    expect(fetchMock.mock.calls[2]?.[1]?.method).toBe("DELETE")
  })

  it("removes a partially provisioned client when finishing setup fails", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ access_token: "unit-test-token", expires_in: 60 }),
      )
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(
        new Response(null, {
          headers: {
            location:
              "https://keycloak.example/admin/realms/llm-machines-applications/clients/partial-client-uuid",
          },
          status: 201,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse([
          {
            clientId: PARTIAL_APPLICATION_CLIENT_ID,
            id: "partial-client-uuid",
          },
        ]),
      )
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))

    const client = new KeycloakApplicationAdminClient(
      applicationConfig(),
      fetchMock,
    )
    await expect(
      client.createConfidentialClient({
        clientId: PARTIAL_APPLICATION_CLIENT_ID,
        description: "Partial client test.",
        name: "Partial Client",
      }),
    ).rejects.toMatchObject({
      message: `Keycloak client ${PARTIAL_APPLICATION_CLIENT_ID} provisioning was rolled back before completion.`,
      mutationOutcome: "rejected",
      status: "unavailable",
    })

    expect(fetchMock.mock.calls[5]?.[0]).toBe(
      "https://keycloak.example/keycloak/admin/realms/llm-machines-applications/clients/partial-client-uuid",
    )
    expect(fetchMock.mock.calls[5]?.[1]?.method).toBe("DELETE")
  })

  it("returns a bounded reconciliation instruction when partial-client cleanup fails", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ access_token: "unit-test-token", expires_in: 60 }),
      )
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(
        new Response(null, {
          headers: {
            location:
              "https://keycloak.example/admin/realms/llm-machines-applications/clients/partial-client-uuid",
          },
          status: 201,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse([
          {
            clientId: PARTIAL_APPLICATION_CLIENT_ID,
            id: "partial-client-uuid",
          },
        ]),
      )
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }))

    const client = new KeycloakApplicationAdminClient(
      applicationConfig(),
      fetchMock,
    )
    await expect(
      client.createConfidentialClient({
        clientId: PARTIAL_APPLICATION_CLIENT_ID,
        description: "Partial client test.",
        name: "Partial Client",
      }),
    ).rejects.toMatchObject({
      message: `Keycloak client provisioning could not be confirmed. Reconcile client ${PARTIAL_APPLICATION_CLIENT_ID} before retrying with the same idempotency key.`,
      mutationOutcome: "unknown",
      status: "unavailable",
    })
  })

  it("returns a bounded reconciliation instruction when client creation is ambiguous", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ access_token: "unit-test-token", expires_in: 60 }),
      )
      .mockResolvedValueOnce(jsonResponse([]))
      .mockRejectedValueOnce(new Error("private-network-error-marker"))

    const client = new KeycloakApplicationAdminClient(
      applicationConfig(),
      fetchMock,
    )
    await expect(
      client.createConfidentialClient({
        clientId: AMBIGUOUS_APPLICATION_CLIENT_ID,
        description: "Ambiguous client test.",
        name: "Ambiguous Client",
      }),
    ).rejects.toMatchObject({
      message: `Keycloak client creation could not be confirmed. Reconcile client ${AMBIGUOUS_APPLICATION_CLIENT_ID} before retrying with the same idempotency key.`,
      mutationOutcome: "unknown",
      status: "unavailable",
    })
  })

  it("rejects creation before POST when the exact client already exists", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ access_token: "unit-test-token", expires_in: 60 }),
      )
      .mockResolvedValueOnce(
        jsonResponse([
          {
            clientId: EXISTING_APPLICATION_CLIENT_ID,
            id: "existing-client-uuid",
          },
        ]),
      )
    const client = new KeycloakApplicationAdminClient(
      applicationConfig(),
      fetchMock,
    )

    await expect(
      client.createConfidentialClient({
        clientId: EXISTING_APPLICATION_CLIENT_ID,
        description: "Existing client test.",
        name: "Existing Client",
      }),
    ).rejects.toMatchObject({
      mutationOutcome: "rejected",
      status: "invalid",
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("rejects rotation before POST when exact client and internal IDs differ", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ access_token: "unit-test-token", expires_in: 60 }),
      )
      .mockResolvedValueOnce(
        jsonResponse([
          { clientId: APPLICATION_CLIENT_ID, id: "different-client-uuid" },
        ]),
      )
    const client = new KeycloakApplicationAdminClient(
      applicationConfig(),
      fetchMock,
    )

    await expect(
      client.rotateConfidentialClientSecret(
        "expected-client-uuid",
        APPLICATION_CLIENT_ID,
      ),
    ).rejects.toMatchObject({
      mutationOutcome: "rejected",
      status: "invalid",
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("preserves confirmed rejection for a rejected create POST", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ access_token: "unit-test-token", expires_in: 60 }),
      )
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(new Response(null, { status: 403 }))
    const client = new KeycloakApplicationAdminClient(
      applicationConfig(),
      fetchMock,
    )

    await expect(
      client.createConfidentialClient({
        clientId: REJECTED_APPLICATION_CLIENT_ID,
        description: "Rejected client test.",
        name: "Rejected Client",
      }),
    ).rejects.toMatchObject({
      mutationOutcome: "rejected",
      status: "unauthorized",
    })
  })

  it("classifies a malformed rotation response as an unknown outcome", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ access_token: "unit-test-token", expires_in: 60 }),
      )
      .mockResolvedValueOnce(
        jsonResponse([{ clientId: APPLICATION_CLIENT_ID, id: "client-uuid" }]),
      )
      .mockResolvedValueOnce(jsonResponse({}))
    const client = new KeycloakApplicationAdminClient(
      applicationConfig(),
      fetchMock,
    )

    await expect(
      client.rotateConfidentialClientSecret(
        "client-uuid",
        APPLICATION_CLIENT_ID,
      ),
    ).rejects.toMatchObject({
      mutationOutcome: "unknown",
      status: "unavailable",
    })
  })
})

function config() {
  return {
    allowedEmailDomains: ["example.com"],
    audience: "console-bff",
    baseUrl: "https://keycloak.example/keycloak",
    clientId: "console-human-admin",
    clientSecret: "unit-test-credential",
    realm: "llm-machines",
  }
}

function applicationConfig() {
  return {
    allowedEmailDomains: [],
    audience: "console-bff",
    baseUrl: "https://keycloak.example/keycloak",
    clientId: "console-application-admin",
    clientSecret: "application-unit-test-credential",
    realm: "llm-machines-applications",
  }
}

function configEnv(): NodeJS.ProcessEnv {
  return {
    KEYCLOAK_ADMIN_BASE_URL: "https://keycloak.example/keycloak",
    KEYCLOAK_ADMIN_CLIENT_ID: "console-human-admin",
    KEYCLOAK_ADMIN_CLIENT_SECRET: "unit-test-credential",
    KEYCLOAK_ADMIN_REALM: "llm-machines",
  }
}

function applicationConfigEnv(): NodeJS.ProcessEnv {
  return {
    KEYCLOAK_ADMIN_BASE_URL: "https://keycloak.example/keycloak",
    KEYCLOAK_APPLICATION_ADMIN_REALM: "llm-machines-applications",
    KEYCLOAK_APPLICATION_ADMIN_CLIENT_ID: "console-application-admin",
    KEYCLOAK_APPLICATION_ADMIN_CLIENT_SECRET:
      "application-unit-test-credential",
    KEYCLOAK_AUDIENCE: "console-bff",
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
