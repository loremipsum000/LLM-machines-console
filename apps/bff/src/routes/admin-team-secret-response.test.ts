import Fastify from "fastify"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { Actor } from "../auth/authorization"
import { resetIdempotencyForTest } from "../services/idempotency"
import { registerAdminRoutes } from "./admin"

const serviceMocks = vi.hoisted(() => ({
  createMember: vi.fn(),
  generatePassword: vi.fn(),
}))

vi.mock("../services/admin-team", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/admin-team")>()
  return {
    ...actual,
    createAdminTeamMember: serviceMocks.createMember,
    generateAdminTeamPassword: serviceMocks.generatePassword,
  }
})

const adminActor: Actor = {
  authMode: "keycloak",
  role: "admin",
  subject: "admin-team-secret-response",
}

const generatedSecret = "K9v_7Nm!f4Wq2Lx8Zp6R"
const member = {
  createdAt: "2026-08-29T08:00:00.000Z",
  displayName: "Ada Lovelace",
  email: "ada@example.test",
  enabled: true,
  groups: ["Operators"],
  id: "operator-1",
  lastActiveAt: null,
  role: "operator" as const,
  status: "active" as const,
  username: "ada.operations",
}

afterEach(() => {
  serviceMocks.createMember.mockReset()
  serviceMocks.generatePassword.mockReset()
  resetIdempotencyForTest()
})

describe("Admin Team generated-secret response custody", () => {
  it("marks a successful create-user reveal response no-store", async () => {
    serviceMocks.createMember.mockResolvedValue({
      generatedPassword: generatedSecret,
      member,
    })
    const server = teamServer()

    const response = await server.inject({
      headers: { "idempotency-key": "create-user-secret" },
      method: "POST",
      payload: createMemberPayload(),
      url: "/api/admin/team/members",
    })

    expect(response.statusCode).toBe(201)
    expect(response.headers["cache-control"]).toBe("no-store")
    expect(response.json()).toMatchObject({
      generatedPassword: generatedSecret,
    })
    await server.close()
  })

  it("marks a rejected create-user request no-store", async () => {
    const server = teamServer()

    const response = await server.inject({
      method: "POST",
      payload: { ...createMemberPayload(), groups: ["Custom"] },
      url: "/api/admin/team/members",
    })

    expect(response.statusCode).toBe(400)
    expect(response.headers["cache-control"]).toBe("no-store")
    expect(response.body).not.toContain(generatedSecret)
    await server.close()
  })

  it("marks a successful generated-password reveal response no-store", async () => {
    serviceMocks.generatePassword.mockResolvedValue({
      generatedPassword: generatedSecret,
      member,
    })
    const server = teamServer()

    const response = await server.inject({
      headers: { "idempotency-key": "generate-user-secret" },
      method: "POST",
      url: "/api/admin/team/members/operator-1/generate-password",
    })

    expect(response.statusCode).toBe(200)
    expect(response.headers["cache-control"]).toBe("no-store")
    expect(response.json()).toMatchObject({
      generatedPassword: generatedSecret,
    })
    await server.close()
  })

  it("marks a rejected generated-password request no-store", async () => {
    const server = teamServer()

    const response = await server.inject({
      method: "POST",
      url: "/api/admin/team/members/operator-1/generate-password",
    })

    expect(response.statusCode).toBe(400)
    expect(response.headers["cache-control"]).toBe("no-store")
    expect(response.body).not.toContain(generatedSecret)
    await server.close()
  })
})

function teamServer() {
  const server = Fastify({ logger: false })
  server.addHook("preHandler", async (request) => {
    request.actor = adminActor
  })
  registerAdminRoutes(server, { emergencyRecoveryService: null })
  return server
}

function createMemberPayload() {
  return {
    displayName: member.displayName,
    email: member.email,
    enabled: true,
    generatePassword: true,
    groups: ["Operators"],
    role: "operator",
    sendInvite: false,
    username: member.username,
  }
}
