import {
  type HealthResponse,
  healthResponseSchema,
} from "@llm-machines/contracts/inference-core"
import Fastify, { type FastifyInstance } from "fastify"
import {
  type AuthorizationOptions,
  registerAuthorization,
} from "./auth/authorization"
import {
  createRuntimeAuthorizationOptions,
  createTestFixtureAuthorizationOptions,
} from "./auth/runtime-live-authority"
import { isProductionRuntime } from "./config/fixture-mode"
import {
  checkInferenceCoreDbReadiness,
  closeInferenceCoreDb,
} from "./db/inference-core-client"
import {
  type AdminEmergencyRecoveryService,
  registerAdminRoutes,
} from "./routes/admin"
import { registerAppGatewayRoutes } from "./routes/app-gateway"
import { emergencyRecoveryServiceFromRuntime } from "./services/emergency-recovery"

export interface BuildServerOptions {
  testAuthorization?: AuthorizationOptions
  testEmergencyRecoveryService?: AdminEmergencyRecoveryService | null
}

export function buildServer(options: BuildServerOptions = {}): FastifyInstance {
  if (isProductionRuntime() && !process.env.DATABASE_URL?.trim()) {
    throw new Error("DATABASE_URL is required for the Console BFF.")
  }

  const server = Fastify({
    bodyLimit: bffBodyLimitBytes(),
    logger: true,
  })
  server.addHook("onClose", closeInferenceCoreDb)

  const testRuntime = process.env.NODE_ENV === "test"
  const emergencyRecoveryService =
    testRuntime && options.testEmergencyRecoveryService !== undefined
      ? options.testEmergencyRecoveryService
      : emergencyRecoveryServiceFromRuntime()
  const authorizationOptions = testRuntime
    ? (options.testAuthorization ??
      createTestFixtureAuthorizationOptions(emergencyRecoveryService))
    : createRuntimeAuthorizationOptions(emergencyRecoveryService)

  registerAuthorization(server, authorizationOptions)

  const liveness = async (): Promise<HealthResponse> =>
    healthResponseSchema.parse({
      service: "console-bff",
      status: "ok",
      version: "0.0.0",
    })

  server.get("/livez", liveness)
  server.get("/healthz", liveness)
  server.get("/readyz", async (_request, reply): Promise<HealthResponse> => {
    const ready =
      !isProductionRuntime() || (await checkInferenceCoreDbReadiness())
    const response = healthResponseSchema.parse({
      service: "console-bff",
      status: ready ? "ok" : "degraded",
      version: "0.0.0",
    })
    return ready ? response : reply.code(503).send(response)
  })

  registerAppGatewayRoutes(server)
  registerAdminRoutes(server, { emergencyRecoveryService })

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
