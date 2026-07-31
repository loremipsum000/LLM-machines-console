import { readFileSync } from "node:fs"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  KeycloakAdminClient,
  keycloakAdminConfigFromEnv,
  roleFromRealmRoles,
} from "./inference-core-keycloak-admin"

describe("inference-core Keycloak Admin boundary", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("has no mixed service, legacy identity, or retired-domain imports", () => {
    const moduleSource = readFileSync(
      new URL("inference-core-keycloak-admin.ts", import.meta.url),
      "utf8",
    )

    expect(moduleSource).not.toMatch(/^import\s/m)
    expect(moduleSource).not.toMatch(
      /\b(?:persona|consumer|builder|hub|knowledge|mcp|agentic|librechat|corpora)\b/i,
    )
    expect(moduleSource).not.toMatch(/realm:\s*"master"/)
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
    expect(roleFromRealmRoles(["ADMIN", "operator"])).toBe("admin")
    expect(roleFromRealmRoles([])).toBeNull()
    expect(roleFromRealmRoles(["builder"])).toBeNull()
  })

  it("uses the configured realm for retained role operations", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ access_token: "unit-test-token", expires_in: 60 }),
      )
      .mockResolvedValueOnce(
        jsonResponse([{ id: "role-operator", name: "operator" }]),
      )
      .mockResolvedValueOnce(jsonResponse({ id: "role-admin", name: "admin" }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))

    const client = new KeycloakAdminClient(config(), fetchMock)
    await expect(client.getUserRealmRoles("user-1")).resolves.toEqual([
      { id: "role-operator", name: "operator" },
    ])
    const adminRole = await client.getRealmRole("admin")
    await client.assignRealmRole("user-1", adminRole)

    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "https://keycloak.example/keycloak/admin/realms/llm-machines/users/user-1/role-mappings/realm",
    )
    expect(fetchMock.mock.calls[2]?.[0]).toBe(
      "https://keycloak.example/keycloak/admin/realms/llm-machines/roles/admin",
    )
    expect(fetchMock.mock.calls[3]?.[0]).toBe(
      "https://keycloak.example/keycloak/admin/realms/llm-machines/users/user-1/role-mappings/realm",
    )
    expect(requestBody(fetchMock, 3)).toEqual([
      { id: "role-admin", name: "admin" },
    ])
  })

  it("rejects malformed realm roles instead of treating them as Operator", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ access_token: "unit-test-token", expires_in: 60 }),
      )
      .mockResolvedValueOnce(jsonResponse([{}]))

    const client = new KeycloakAdminClient(config(), fetchMock)

    await expect(client.getUserRealmRoles("user-1")).rejects.toMatchObject({
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
