import {
  type HealthResponse,
  healthResponseSchema,
} from "@llm-machines/contracts"
import Fastify, { type FastifyInstance } from "fastify"
import { registerPersonaAuth } from "./auth/persona"
import { registerAdminRoutes } from "./routes/admin"
import { registerAgenticRuntimeRoutes } from "./routes/agentic-runtime"
import { registerAppGatewayRoutes } from "./routes/app-gateway"
import { registerBuilderRoutes } from "./routes/builder"
import { registerHubRoutes } from "./routes/hub"
import { registerKnowledgeRoutes } from "./routes/knowledge"
import { registerMcpGatewayRoutes } from "./routes/mcp-gateway"
import { registerOpenAICompatibleRoutes } from "./routes/openai-compatible"

export function buildServer(): FastifyInstance {
  const server = Fastify({
    bodyLimit: bffBodyLimitBytes(),
    logger: true,
  })

  registerPersonaAuth(server)

  const liveness = async (): Promise<HealthResponse> =>
    healthResponseSchema.parse({
      service: "console-bff",
      status: "ok",
      version: "0.0.0",
    })

  server.get("/livez", liveness)
  server.get("/healthz", liveness)
  server.get("/readyz", async (): Promise<HealthResponse> => {
    return healthResponseSchema.parse({
      service: "console-bff",
      status: "ok",
      version: "0.0.0",
    })
  })

  registerOpenAICompatibleRoutes(server)
  registerAppGatewayRoutes(server)
  registerAdminRoutes(server)
  registerKnowledgeRoutes(server)
  registerAgenticRuntimeRoutes(server)
  registerMcpGatewayRoutes(server)
  registerHubRoutes(server)
  registerBuilderRoutes(server)

  return server
}

function bffBodyLimitBytes(): number {
  const fallback = 72 * 1024 * 1024
  const configured = Number.parseInt(
    process.env.BFF_BODY_LIMIT_BYTES ?? String(fallback),
    10,
  )
  return Number.isInteger(configured) && configured > 0 ? configured : fallback
}

const isEntrypoint = process.argv[1] === new URL(import.meta.url).pathname

if (isEntrypoint) {
  const server = buildServer()
  const port = Number.parseInt(process.env.PORT ?? "4001", 10)
  const host = process.env.HOST ?? "0.0.0.0"

  await server.listen({ host, port })
}
