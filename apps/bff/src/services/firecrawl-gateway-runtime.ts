import type { FirecrawlGatewayRouteOptions } from "../routes/firecrawl-gateway"
import {
  type AdminConnectedAppFirecrawlReadinessPreflight,
  type ConnectedAppFirecrawlAdmissionResult,
  type ConnectedAppFirecrawlCredentialResolution,
  type ConnectedAppFirecrawlOperation,
  type ConnectedAppFirecrawlRuntimeIdentity,
  type ConnectedAppFirecrawlSettlementInput,
  admitAdminConnectedAppFirecrawlRequest,
  preflightAdminConnectedAppFirecrawlReadiness,
  recordAdminConnectedAppFirecrawlConnection,
  recordAdminConnectedAppFirecrawlGatewayMetadata,
  resolveAdminConnectedAppFirecrawlCredential,
  settleAdminConnectedAppFirecrawlRequest,
} from "./admin-connected-apps-firecrawl"

const CANCELLED_ADMISSION_SETTLEMENT_MAX_ATTEMPTS = 3
const CANCELLED_ADMISSION_SETTLEMENT_ATTEMPT_DEADLINE_MS = 250
const CANCELLED_ADMISSION_SETTLEMENT_RETRY_DELAY_MS = 25

export interface FirecrawlGatewayRuntimeServices {
  admit(input: {
    correlationId: string
    identity: ConnectedAppFirecrawlRuntimeIdentity
    operation: ConnectedAppFirecrawlOperation
  }): Promise<ConnectedAppFirecrawlAdmissionResult>
  preflight(): AdminConnectedAppFirecrawlReadinessPreflight
  recordConnection(input: {
    applicationId: string
    connectedAt: string
    correlationId: string
    credentialRecordId: string
  }): Promise<boolean>
  recordMetadata(input: ConnectedAppFirecrawlSettlementInput): Promise<void>
  resolve(apiKey: string): Promise<ConnectedAppFirecrawlCredentialResolution>
  settle(input: ConnectedAppFirecrawlSettlementInput): Promise<boolean>
}

const runtimeServices: FirecrawlGatewayRuntimeServices = {
  admit: admitAdminConnectedAppFirecrawlRequest,
  preflight: preflightAdminConnectedAppFirecrawlReadiness,
  recordConnection: recordAdminConnectedAppFirecrawlConnection,
  recordMetadata: recordAdminConnectedAppFirecrawlGatewayMetadata,
  resolve: resolveAdminConnectedAppFirecrawlCredential,
  settle: settleAdminConnectedAppFirecrawlRequest,
}

export function firecrawlGatewayOptionsFromRuntime(
  services: FirecrawlGatewayRuntimeServices = runtimeServices,
): FirecrawlGatewayRouteOptions {
  const readiness = services.preflight()
  return {
    admission: {
      admit: async (input) => {
        if (input.signal.aborted) {
          return { ok: false, reason: "unavailable" }
        }
        const result = await services.admit({
          correlationId: input.correlationId,
          identity: input.identity,
          operation: input.operation,
        })
        if (!input.signal.aborted) {
          return result
        }
        if (result.ok) {
          await settleCancelledAdmissionWithRetry(services, {
            admissionId: result.admissionId,
            applicationId: input.identity.applicationId,
            correlationId: input.correlationId,
            credentialRecordId: input.identity.credentialRecordId,
            latencyMs: 0,
            operation: input.operation,
            outcome: "cancelled",
            requestBytes: 0,
            responseBytes: 0,
            resultCount: 0,
            status: 499,
          })
        }
        return { ok: false, reason: "unavailable" }
      },
      settle: async (input) => {
        if (!(await services.settle(input))) {
          throw new Error("Firecrawl request settlement was not persisted.")
        }
      },
    },
    bearerResolver: {
      resolve: async ({ bearerToken, signal }) => {
        if (signal.aborted) {
          return { ok: false, reason: "unavailable" }
        }
        const result = await services.resolve(bearerToken)
        return signal.aborted ? { ok: false, reason: "unavailable" } : result
      },
    },
    connectionEvidence: {
      record: async ({ connectedAt, correlationId, identity, signal }) => {
        if (signal.aborted) {
          throw signal.reason
        }
        const recorded = await services.recordConnection({
          applicationId: identity.applicationId,
          connectedAt,
          correlationId,
          credentialRecordId: identity.credentialRecordId,
        })
        if (signal.aborted) {
          throw signal.reason
        }
        if (!recorded) {
          throw new Error("Firecrawl connection evidence was not persisted.")
        }
      },
    },
    egressAllowedHosts:
      readiness.status === "ready" ? readiness.egressAllowedHosts : null,
    metadata: {
      record: async (event) => {
        await services.recordMetadata({ ...event, admissionId: null })
      },
    },
    upstreamBaseUrl:
      readiness.status === "ready" ? readiness.upstreamBaseUrl : null,
  }
}

async function settleCancelledAdmissionWithRetry(
  services: FirecrawlGatewayRuntimeServices,
  settlement: ConnectedAppFirecrawlSettlementInput,
): Promise<void> {
  for (
    let attempt = 1;
    attempt <= CANCELLED_ADMISSION_SETTLEMENT_MAX_ATTEMPTS;
    attempt += 1
  ) {
    if (await settleCancelledAdmissionAttempt(services, settlement)) {
      return
    }
    if (attempt < CANCELLED_ADMISSION_SETTLEMENT_MAX_ATTEMPTS) {
      await new Promise<void>((resolve) => {
        setTimeout(
          resolve,
          CANCELLED_ADMISSION_SETTLEMENT_RETRY_DELAY_MS * attempt,
        )
      })
    }
  }
}

async function settleCancelledAdmissionAttempt(
  services: FirecrawlGatewayRuntimeServices,
  settlement: ConnectedAppFirecrawlSettlementInput,
): Promise<boolean> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      services.settle(settlement).catch(() => false),
      new Promise<false>((resolve) => {
        timeout = setTimeout(
          () => resolve(false),
          CANCELLED_ADMISSION_SETTLEMENT_ATTEMPT_DEADLINE_MS,
        )
      }),
    ])
  } finally {
    if (timeout) {
      clearTimeout(timeout)
    }
  }
}
