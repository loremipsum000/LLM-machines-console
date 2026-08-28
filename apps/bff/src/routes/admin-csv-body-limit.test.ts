import Fastify from "fastify"
import { describe, expect, it, vi } from "vitest"
import type { Actor } from "../auth/authorization"
import { registerAdminRoutes } from "./admin"

const adminActor: Actor = {
  authMode: "keycloak",
  role: "admin",
  subject: "admin-1",
}

describe("Admin Team CSV route body limits", () => {
  it.each(["/api/admin/team/import/preview", "/api/admin/team/import/commit"])(
    "rejects an oversized body before the handler for %s",
    async (url) => {
      const preHandler = vi.fn()
      const server = Fastify({ logger: false })
      server.addHook("preHandler", async (request) => {
        preHandler()
        request.actor = adminActor
      })
      registerAdminRoutes(server, { emergencyRecoveryService: null })

      const response = await server.inject({
        headers: { "idempotency-key": "oversized-csv" },
        method: "POST",
        payload: { csv: "sensitive-row,".repeat(21_000) },
        url,
      })

      expect(response.statusCode).toBe(413)
      expect(preHandler).not.toHaveBeenCalled()
      expect(response.body).not.toContain("sensitive-row")
      await server.close()
    },
  )
})
