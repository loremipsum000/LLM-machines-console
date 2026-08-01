import {
  type HealthResponse,
  healthResponseSchema,
} from "@llm-machines/contracts/inference-core"
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
  type HookHandlerDoneFunction,
} from "fastify"
import {
  type AuthorizationOptions,
  registerAuthorization,
} from "./auth/authorization"
import {
  createRuntimeAuthorizationOptions,
  createTestFixtureAuthorizationOptions,
} from "./auth/runtime-live-authority"
import {
  assertProductionFixturesDisabled,
  isProductionRuntime,
} from "./config/fixture-mode"
import {
  checkInferenceCoreDbReadiness,
  closeInferenceCoreDb,
} from "./db/inference-core-client"
import {
  type AdminEmergencyRecoveryService,
  registerAdminRoutes,
} from "./routes/admin"
import { registerAppGatewayRoutes } from "./routes/app-gateway"
import {
  type FirecrawlGatewayRouteOptions,
  registerFirecrawlGatewayRoutes,
} from "./routes/firecrawl-gateway"
import {
  observabilityMetricsRouteOptionsFromRuntime,
  registerObservabilityMetricsRoutes,
} from "./routes/observability-metrics"
import { assertProductionConnectedAppRevealEndpoints } from "./services/admin-connected-apps"
import { emergencyRecoveryServiceFromRuntime } from "./services/emergency-recovery"
import { firecrawlGatewayOptionsFromRuntime } from "./services/firecrawl-gateway-runtime"

export interface BuildServerOptions {
  testAuthorization?: AuthorizationOptions
  testEmergencyRecoveryService?: AdminEmergencyRecoveryService | null
  testFirecrawlGateway?: FirecrawlGatewayRouteOptions
  testLoggerStream?: { write(message: string): void }
}

export function buildServer(options: BuildServerOptions = {}): FastifyInstance {
  assertProductionFixturesDisabled()
  assertProductionConnectedAppRevealEndpoints()

  if (isProductionRuntime() && !process.env.DATABASE_URL?.trim()) {
    throw new Error("DATABASE_URL is required for the Console BFF.")
  }

  const testRuntime = process.env.NODE_ENV === "test"
  const server = Fastify({
    bodyLimit: bffBodyLimitBytes(),
    disableRequestLogging: true,
    logger: {
      serializers: { req: queryFreeRequestLogSerializer },
      ...(testRuntime && options.testLoggerStream
        ? { stream: options.testLoggerStream }
        : {}),
    },
  })
  server.addHook("onRequest", logQueryFreeIncomingRequest)
  server.addHook("onResponse", logQueryFreeCompletedRequest)
  server.addHook("onClose", closeInferenceCoreDb)

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
  const firecrawlGateway = firecrawlGatewayOptionsFromRuntime()
  registerFirecrawlGatewayRoutes(
    server,
    testRuntime && options.testFirecrawlGateway
      ? { ...firecrawlGateway, ...options.testFirecrawlGateway }
      : firecrawlGateway,
  )
  registerObservabilityMetricsRoutes(
    server,
    observabilityMetricsRouteOptionsFromRuntime(),
  )
  registerAdminRoutes(server, { emergencyRecoveryService })

  return server
}

function logQueryFreeIncomingRequest(
  request: FastifyRequest,
  _reply: FastifyReply,
  done: HookHandlerDoneFunction,
): void {
  request.log.info({ req: request }, "incoming request")
  done()
}

function logQueryFreeCompletedRequest(
  request: FastifyRequest,
  reply: FastifyReply,
  done: HookHandlerDoneFunction,
): void {
  request.log.info(
    { responseTime: reply.elapsedTime, statusCode: reply.statusCode },
    "request completed",
  )
  done()
}

export function queryFreeRequestLogSerializer(request: FastifyRequest): {
  method: string
  remoteAddress: string
  url: string
} {
  return {
    method: request.method,
    remoteAddress: request.ip,
    url: requestPathname(request.raw.url),
  }
}

function requestPathname(rawUrl: string | undefined): string {
  if (!rawUrl) {
    return "[missing-request-target]"
  }
  try {
    const pathname = new URL(rawUrl, "http://request.invalid").pathname
    if (
      pathname !== "/v2/search" &&
      pathname !== "/v2/scrape" &&
      (pathname === "/v2" || pathname.startsWith("/v2/"))
    ) {
      return "/v2/[unsupported]"
    }
    return pathname
  } catch {
    return "[invalid-request-target]"
  }
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
