import type { FastifyInstance } from "fastify"
import { withPersona } from "../auth/persona"
import {
  handleAdminMcpServersAggregateRequest,
  handleAdminMcpServerRequest,
  handleInternalDocsMcpRequest,
  type McpGatewayRequest,
} from "../services/mcp-gateway"

export function registerMcpGatewayRoutes(server: FastifyInstance): void {
  server.post(
    "/api/mcp/internal-docs",
    withPersona("consumer", { allowMcpServiceForwardedAuth: true }),
    async (request, reply) => {
      if (!request.actor) {
        return reply.code(401).send({
          type: "about:blank",
          title: "Unauthenticated",
          status: 401,
          detail: "A valid actor is required for MCP gateway calls.",
        })
      }

      const response = await handleInternalDocsMcpRequest(
        request.actor,
        request.body as McpGatewayRequest,
      )

      if (!response) {
        return reply.code(202).send()
      }

      return reply.send(response)
    },
  )

  server.post(
    "/api/mcp/admin-servers",
    withPersona("builder", { allowMcpServiceForwardedAuth: true }),
    async (request, reply) => {
      if (!request.actor) {
        return reply.code(401).send({
          type: "about:blank",
          title: "Unauthenticated",
          status: 401,
          detail: "A valid actor is required for MCP gateway calls.",
        })
      }

      const response = await handleAdminMcpServersAggregateRequest(
        request.actor,
        request.body as McpGatewayRequest,
      )

      if (!response) {
        return reply.code(202).send()
      }

      return reply.send(response)
    },
  )

  server.post(
    "/api/mcp/:connectorId",
    withPersona("builder", { allowMcpServiceForwardedAuth: true }),
    async (request, reply) => {
      if (!request.actor) {
        return reply.code(401).send({
          type: "about:blank",
          title: "Unauthenticated",
          status: 401,
          detail: "A valid actor is required for MCP gateway calls.",
        })
      }

      const connectorId = (request.params as { connectorId?: string })
        .connectorId
      if (!connectorId) {
        return reply.code(400).send({
          type: "about:blank",
          title: "Connector id is required",
          status: 400,
        })
      }

      const response = await handleAdminMcpServerRequest(
        request.actor,
        connectorId,
        request.body as McpGatewayRequest,
      )

      if (!response) {
        return reply.code(202).send()
      }

      return reply.send(response)
    },
  )
}
