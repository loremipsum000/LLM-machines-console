import Fastify from "fastify"
import { describe, expect, it } from "vitest"
import type { Actor } from "../auth/authorization"
import { registerAdminRoutes } from "./admin"

const adminActor: Actor = {
  authMode: "keycloak",
  role: "admin",
  subject: "admin-team-boundary",
}

const deferredTeamRoutes = [
  { method: "GET", url: "/api/admin/team/csv-template" },
  { method: "POST", url: "/api/admin/team/import/preview" },
  { method: "POST", url: "/api/admin/team/import/commit" },
  { method: "GET", url: "/api/admin/team/groups/group-1" },
  { method: "POST", url: "/api/admin/team/groups" },
  { method: "POST", url: "/api/admin/team/groups/group-1/update" },
  { method: "POST", url: "/api/admin/team/groups/group-1/delete" },
  {
    method: "POST",
    url: "/api/admin/team/groups/group-1/members/bulk-assign",
  },
  {
    method: "POST",
    url: "/api/admin/team/groups/group-1/members/member-1/remove",
  },
  { method: "POST", url: "/api/admin/team/members/member-1/invite" },
  {
    method: "POST",
    url: "/api/admin/team/members/member-1/reset-password-email",
  },
] as const

describe("Admin Team deferred Product boundary", () => {
  it.each(deferredTeamRoutes)(
    "does not register $method $url",
    async ({ method, url }) => {
      const server = teamBoundaryServer()
      const response = await server.inject({ method, payload: {}, url })

      expect(response.statusCode).toBe(404)
      await server.close()
    },
  )

  it("rejects email delivery during member creation", async () => {
    const server = teamBoundaryServer()
    const response = await server.inject({
      method: "POST",
      payload: memberRequest({ sendInvite: true }),
      url: "/api/admin/team/members",
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({
      status: 400,
      title: "Unsupported Team member request",
    })
    await server.close()
  })

  it("rejects arbitrary group assignment during member creation", async () => {
    const server = teamBoundaryServer()
    const response = await server.inject({
      method: "POST",
      payload: memberRequest({ groups: ["Operators", "Custom"] }),
      url: "/api/admin/team/members",
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({
      status: 400,
      title: "Unsupported Team member request",
    })
    await server.close()
  })
})

function teamBoundaryServer() {
  const server = Fastify({ logger: false })
  server.addHook("preHandler", async (request) => {
    request.actor = adminActor
  })
  registerAdminRoutes(server, { emergencyRecoveryService: null })
  return server
}

function memberRequest(
  overrides: Partial<{
    groups: string[]
    sendInvite: boolean
  }> = {},
) {
  return {
    displayName: "Test Operator",
    email: "test.operator@example.test",
    enabled: true,
    generatePassword: true,
    groups: ["Operators"],
    role: "operator",
    sendInvite: false,
    username: "test.operator",
    ...overrides,
  }
}
