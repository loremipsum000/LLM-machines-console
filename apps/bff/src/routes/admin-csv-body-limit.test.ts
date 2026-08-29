import Fastify from "fastify"
import { describe, expect, it } from "vitest"
import { registerAdminRoutes } from "./admin"

describe("retired Admin Team CSV routes", () => {
  it.each(["/api/admin/team/import/preview", "/api/admin/team/import/commit"])(
    "fails closed without reflecting request content for %s",
    async (url) => {
      const server = Fastify({ logger: false })
      registerAdminRoutes(server, { emergencyRecoveryService: null })

      const response = await server.inject({
        method: "POST",
        payload: { csv: "sensitive-row,".repeat(10) },
        url,
      })

      expect(response.statusCode).toBe(404)
      expect(response.body).not.toContain("sensitive-row")
      await server.close()
    },
  )
})
