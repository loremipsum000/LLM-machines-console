import { afterEach, describe, expect, it, vi } from "vitest"
import type { Actor } from "../auth/authorization"
import { getAdminTeamOverview, resetAdminTeamStateForTest } from "./admin-team"
import { expertCapabilities, expertSystemIds } from "./expert-capabilities"

describe("expert capability boundary", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    resetAdminTeamStateForTest()
  })

  it("keeps native access disabled while ingress awaits runtime qualification", () => {
    expect(Object.isFrozen(expertCapabilities)).toBe(true)
    expect(Object.keys(expertCapabilities).sort()).toEqual(
      [...expertSystemIds].sort(),
    )
    for (const capability of Object.values(expertCapabilities)) {
      expect(Object.isFrozen(capability)).toBe(true)
      expect(capability).toEqual({
        auditIngestion: "implemented_pending_runtime_qualification",
        consoleProjection: "read_only",
        directAccess: "disabled",
        mechanism: "product_owned_audited_ingress",
        nativeMutation: "disabled",
      })
    }
  })

  it("keeps configured Keycloak and SCIM expert links out of the retained Team projection", async () => {
    vi.stubEnv("KEYCLOAK_ADMIN_BASE_URL", "https://keycloak.example/keycloak")
    vi.stubEnv("KEYCLOAK_ADMIN_CLIENT_ID", "console-human-admin")
    vi.stubEnv("KEYCLOAK_ADMIN_CLIENT_SECRET", "unit-test-credential")
    vi.stubEnv("KEYCLOAK_ADMIN_REALM", "llm-machines")
    vi.stubEnv("TEAM_SCIM_PROVIDER", "customer-directory")
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(keycloakTeamResponse))

    const overview = await getAdminTeamOverview(adminActor)

    expect(overview.sourceStatus).toBe("ok")
    expect(overview.members).toEqual([
      expect.objectContaining({
        id: "operator-1",
        keycloakHref: null,
        role: "operator",
      }),
    ])
    expect(overview.groups.every((group) => group.keycloakHref === null)).toBe(
      true,
    )
    expect(overview.scim).toMatchObject({
      keycloakHref: null,
      provider: "customer-directory",
      status: "configured",
    })
  })
})

const adminActor: Actor = {
  authMode: "keycloak",
  groups: ["Everyone"],
  role: "admin",
  subject: "admin-1",
}

async function keycloakTeamResponse(
  input: string | URL | Request,
): Promise<Response> {
  const url = new URL(input.toString())
  if (url.pathname.endsWith("/protocol/openid-connect/token")) {
    return Response.json({ access_token: "unit-test-token", expires_in: 60 })
  }
  if (url.pathname.endsWith("/users")) {
    return Response.json([
      {
        createdTimestamp: Date.parse("2026-07-01T00:00:00.000Z"),
        email: "operator@example.test",
        enabled: true,
        firstName: "Op",
        id: "operator-1",
        lastName: "Erator",
        username: "operator.one",
      },
    ])
  }
  if (url.pathname.endsWith("/users/operator-1/groups")) {
    return Response.json([
      { id: "group-1", name: "Operations", path: "/Operations" },
    ])
  }
  if (
    url.pathname.endsWith("/users/operator-1/role-mappings/realm/composite")
  ) {
    return Response.json([{ id: "role-operator", name: "operator" }])
  }
  if (url.pathname.endsWith("/groups")) {
    return Response.json([
      { id: "group-1", name: "Operations", path: "/Operations" },
    ])
  }
  return new Response("not found", { status: 404 })
}
