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
  canUseBffFixtureData,
  isProductionRuntime,
} from "./config/fixture-mode"
import {
  checkInferenceCoreDbReadiness,
  closeInferenceCoreDb,
} from "./db/inference-core-client"
import {
  type AdminEmergencyIsolationService,
  type AdminEmergencyRecoveryService,
  registerAdminRoutes,
} from "./routes/admin"
import {
  type AppGatewayIsolationTrafficGate,
  registerAppGatewayRoutes,
} from "./routes/app-gateway"
import {
  type FirecrawlGatewayRouteOptions,
  type FirecrawlIsolationTrafficGate,
  registerFirecrawlGatewayRoutes,
} from "./routes/firecrawl-gateway"
import {
  observabilityMetricsRouteOptionsFromRuntime,
  registerObservabilityMetricsRoutes,
} from "./routes/observability-metrics"
import { assertProductionConnectedAppRevealEndpoints } from "./services/admin-connected-apps"
import {
  type EmergencyIsolationService,
  InMemoryEmergencyIsolationNonRestorableAuthority,
  InMemoryEmergencyIsolationStore,
  EmergencyIsolationService as RuntimeEmergencyIsolationService,
  emergencyIsolationServiceFromRuntime,
} from "./services/emergency-isolation"
import { emergencyRecoveryServiceFromRuntime } from "./services/emergency-recovery"
import { firecrawlGatewayOptionsFromRuntime } from "./services/firecrawl-gateway-runtime"
import { IsolationTrafficGate } from "./services/isolation-traffic-gate"
import {
  type LifecycleRestoreIsolationRecoveryAuthority,
  createDrizzleLifecycleRestoreIsolationRecoveryAuthority,
} from "./services/lifecycle-operation-journal"

type SharedIsolationTrafficGate = AppGatewayIsolationTrafficGate &
  FirecrawlIsolationTrafficGate

export interface BuildServerOptions {
  testAuthorization?: AuthorizationOptions
  testEmergencyIsolationService?: AdminEmergencyIsolationService | null
  testEmergencyRecoveryService?: AdminEmergencyRecoveryService | null
  testFirecrawlGateway?: FirecrawlGatewayRouteOptions
  testIsolationTrafficGate?: SharedIsolationTrafficGate
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
  const runtimeIsolation = createRuntimeIsolation(
    testRuntime && canUseBffFixtureData(),
  )
  const emergencyIsolationService =
    testRuntime && options.testEmergencyIsolationService !== undefined
      ? options.testEmergencyIsolationService
      : runtimeIsolation.service
  const isolationTrafficGate =
    testRuntime && options.testIsolationTrafficGate
      ? options.testIsolationTrafficGate
      : runtimeIsolation.gate
  const authorizationOptions = testRuntime
    ? (options.testAuthorization ??
      createTestFixtureAuthorizationOptions(emergencyRecoveryService))
    : createRuntimeAuthorizationOptions(emergencyRecoveryService)

  registerAuthorization(server, authorizationOptions)
  if (
    runtimeIsolation.service &&
    emergencyIsolationService === runtimeIsolation.service
  ) {
    server.addHook("onReady", async () => {
      try {
        await runtimeIsolation.service?.bootstrap()
      } catch {
        server.log.warn(
          { failureClass: "emergency_isolation_bootstrap_failed" },
          "Emergency isolation remains sealed",
        )
      }
    })
  }

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

  registerAppGatewayRoutes(server, { isolationGate: isolationTrafficGate })
  const firecrawlGateway = firecrawlGatewayOptionsFromRuntime()
  registerFirecrawlGatewayRoutes(
    server,
    testRuntime && options.testFirecrawlGateway
      ? {
          ...firecrawlGateway,
          ...options.testFirecrawlGateway,
          isolationGate: isolationTrafficGate,
        }
      : { ...firecrawlGateway, isolationGate: isolationTrafficGate },
  )
  registerObservabilityMetricsRoutes(
    server,
    observabilityMetricsRouteOptionsFromRuntime(),
  )
  registerAdminRoutes(server, {
    emergencyIsolationService,
    emergencyRecoveryService,
  })

  return server
}

function createRuntimeIsolation(useFixtureStore: boolean): {
  gate: IsolationTrafficGate
  service: EmergencyIsolationService | null
} {
  let service: EmergencyIsolationService | null = null
  const nonRestorableAuthority = useFixtureStore
    ? new InMemoryEmergencyIsolationNonRestorableAuthority()
    : null
  const lifecycleRestoreIsolationRecoveryAuthority = useFixtureStore
    ? emptyLifecycleRestoreIsolationRecoveryAuthority()
    : createDrizzleLifecycleRestoreIsolationRecoveryAuthority()
  const gate = new IsolationTrafficGate({
    read: async () => (service ? await service.durableAdmissionStatus() : null),
  })
  service = emergencyIsolationServiceFromRuntime(gate, {
    lifecycleRestoreIsolationRecoveryAuthority,
    nonRestorableAuthority,
  })
  if (!service && useFixtureStore) {
    service = new RuntimeEmergencyIsolationService(
      new InMemoryEmergencyIsolationStore(),
      gate,
      {
        lifecycleRestoreIsolationRecoveryAuthority,
        nonRestorableAuthority,
      },
    )
  }
  return { gate, service }
}

function emptyLifecycleRestoreIsolationRecoveryAuthority(): LifecycleRestoreIsolationRecoveryAuthority {
  return {
    async readRestoreOperation() {
      return null
    },
    async readUnfencedRestore() {
      return null
    },
    async recordIsolationReconciled() {
      return false
    },
    async terminalizeUnfencedRestore() {
      return false
    },
  }
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
