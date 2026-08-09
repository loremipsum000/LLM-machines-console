import {
  type FirecrawlScope,
  firecrawlScrapeRequestSchema,
  firecrawlSearchRequestSchema,
} from "@llm-machines/contracts/inference-core"
import type {
  FastifyError,
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify"
import {
  type FirecrawlDnsLookup,
  isPublicFirecrawlIpAddress,
  normalizeFirecrawlEgressAllowedHosts,
  validateFirecrawlPublicUrl,
} from "../services/firecrawl-url-safety"
import type {
  IsolationTrafficFinalizationResult,
  IsolationTrafficLease,
} from "../services/isolation-traffic-gate"

export const FIRECRAWL_REQUEST_BODY_LIMIT_BYTES = 16 * 1024
export const FIRECRAWL_SEARCH_RESPONSE_LIMIT_BYTES = 2 * 1024 * 1024
export const FIRECRAWL_SCRAPE_RESPONSE_LIMIT_BYTES = 5 * 1024 * 1024

const SEARCH_PATH = "/v2/search"
const SCRAPE_PATH = "/v2/scrape"
const SEARCH_ROUTE_DEADLINE_MS = 30_000
const SCRAPE_ROUTE_DEADLINE_MS = 50_000
const SEARCH_UPSTREAM_TIMEOUT_MS = 25_000
const SCRAPE_UPSTREAM_TIMEOUT_MS = 45_000
const COMPLETION_HOOK_DEADLINE_MS = 1_000
const MAX_REDIRECTS = 20

export type FirecrawlGatewayOperation = "scrape" | "search"

export type FirecrawlIsolationLease = IsolationTrafficLease

export interface FirecrawlIsolationTrafficGate {
  admit(input: {
    appId: string
    correlationId: string
    credentialRecordId: string
    route: "firecrawl_scrape" | "firecrawl_search"
    signal: AbortSignal
  }): Promise<
    | { lease: FirecrawlIsolationLease; ok: true }
    | { ok: false; reason?: string }
  >
}

export interface FirecrawlGatewayIdentity {
  applicationId: string
  credentialRecordId: string
  scopes: readonly FirecrawlScope[]
}

export type FirecrawlBearerResolution =
  | { identity: FirecrawlGatewayIdentity; ok: true }
  | { ok: false; reason: "disabled" | "invalid" | "unavailable" }

export interface FirecrawlBearerResolver {
  resolve(input: {
    bearerToken: string
    operation: FirecrawlGatewayOperation
    signal: AbortSignal
  }): Promise<FirecrawlBearerResolution>
}

export type FirecrawlGatewayAdmissionResult =
  | { admissionId: string | null; ok: true }
  | {
      ok: false
      reason: "concurrency_limited" | "rate_limited" | "unavailable"
      retryAfterSeconds?: number
    }

export interface FirecrawlGatewayAdmissionController {
  admit(input: {
    correlationId: string
    identity: FirecrawlGatewayIdentity
    operation: FirecrawlGatewayOperation
    signal: AbortSignal
  }): Promise<FirecrawlGatewayAdmissionResult>
  settle(settlement: FirecrawlGatewaySettlement): Promise<void>
}

export type FirecrawlGatewayOutcome =
  | "attempted"
  | "blocked"
  | "cancelled"
  | "failed"
  | "succeeded"

export interface FirecrawlGatewayMetadataEvent {
  applicationId: string
  correlationId: string
  credentialRecordId: string
  latencyMs: number
  operation: FirecrawlGatewayOperation
  outcome: FirecrawlGatewayOutcome
  requestBytes: number
  responseBytes: number
  resultCount: number
  status: number
}

export interface FirecrawlGatewaySettlement
  extends FirecrawlGatewayMetadataEvent {
  admissionId: string | null
}

export interface FirecrawlGatewayMetadataRecorder {
  record(event: FirecrawlGatewayMetadataEvent): Promise<void>
}

export interface FirecrawlConnectionEvidenceRecorder {
  record(input: {
    connectedAt: string
    correlationId: string
    identity: FirecrawlGatewayIdentity
    operation: FirecrawlGatewayOperation
    signal: AbortSignal
  }): Promise<void>
}

export interface FirecrawlGatewayLimits {
  scrapeResponseBytes: number
  scrapeRouteDeadlineMs: number
  searchResponseBytes: number
  searchRouteDeadlineMs: number
}

export interface FirecrawlGatewayDependencies {
  admission: FirecrawlGatewayAdmissionController
  bearerResolver: FirecrawlBearerResolver
  connectionEvidence: FirecrawlConnectionEvidenceRecorder
  dnsLookup: FirecrawlDnsLookup
  egressAllowedHosts: Iterable<string> | null
  fetchImpl: typeof fetch
  isolationGate: FirecrawlIsolationTrafficGate
  limits: Partial<FirecrawlGatewayLimits>
  metadata: FirecrawlGatewayMetadataRecorder
  now: () => number
  upstreamBaseUrl: string | URL | null
}

export type FirecrawlGatewayRouteOptions = Partial<FirecrawlGatewayDependencies>

interface RegisteredDependencies {
  admission: FirecrawlGatewayAdmissionController
  allowedHosts: ReadonlySet<string> | null
  bearerResolver: FirecrawlBearerResolver
  connectionEvidence: FirecrawlConnectionEvidenceRecorder
  dnsLookup?: FirecrawlDnsLookup
  fetchImpl: typeof fetch
  isolationGate: FirecrawlIsolationTrafficGate
  limits: FirecrawlGatewayLimits
  metadata: FirecrawlGatewayMetadataRecorder
  now: () => number
  upstreamBaseUrl: URL | null
}

interface RequestContext {
  boundary: RequestBoundary
  correlationId: string
  operation: FirecrawlGatewayOperation
  startedAt: number
}

interface AdmittedContext extends RequestContext {
  admissionId: string | null
  identity: FirecrawlGatewayIdentity
  requestBytes: number
  settlementAttempted: boolean
}

interface GatewayResponse {
  body: Record<string, unknown>
  resultCount: number
}

type UpstreamResult =
  | {
      body: unknown
      ok: true
      responseBytes: number
    }
  | {
      ok: false
      reason:
        | "cancelled"
        | "deadline_exceeded"
        | "invalid_response"
        | "isolated"
        | "response_too_large"
        | "unavailable"
      responseBytes: number
      status: number
    }

class FirecrawlGatewayAbortError extends Error {
  constructor(readonly reason: "cancelled" | "deadline_exceeded" | "isolated") {
    super(reason)
    this.name = "FirecrawlGatewayAbortError"
  }
}

class FirecrawlResponseTooLargeError extends Error {}

interface RequestBoundary {
  bindIsolation(signal: AbortSignal): void
  dispose(): void
  failureReason(): "cancelled" | "deadline_exceeded" | "isolated" | null
  signal: AbortSignal
}

export function registerFirecrawlGatewayRoutes(
  server: FastifyInstance,
  options: FirecrawlGatewayRouteOptions = {},
): void {
  const dependencies = registeredDependencies(options)
  const routeOptions = {
    bodyLimit: FIRECRAWL_REQUEST_BODY_LIMIT_BYTES,
    errorHandler: firecrawlRouteErrorHandler,
    logLevel: "silent" as const,
  }

  server.addHook("onSend", applyFirecrawlNoStoreHeader)

  server.post(SEARCH_PATH, routeOptions, async (request, reply) =>
    handleGatewayRequest(request, reply, "search", dependencies),
  )
  server.post(SCRAPE_PATH, routeOptions, async (request, reply) =>
    handleGatewayRequest(request, reply, "scrape", dependencies),
  )
}

async function applyFirecrawlNoStoreHeader(
  request: FastifyRequest,
  reply: FastifyReply,
  payload: unknown,
): Promise<unknown> {
  const pathname = request.raw.url?.split("?", 1)[0]
  if (pathname === SEARCH_PATH || pathname === SCRAPE_PATH) {
    reply.header("cache-control", "no-store")
  }
  return payload
}

async function handleGatewayRequest(
  request: FastifyRequest,
  reply: FastifyReply,
  operation: FirecrawlGatewayOperation,
  dependencies: RegisteredDependencies,
): Promise<FastifyReply> {
  const startedAt = dependencies.now()
  const correlationId = request.id
  setRequestIdHeader(request, reply)
  const boundary = createRequestBoundary(
    request,
    reply,
    operation === "search"
      ? dependencies.limits.searchRouteDeadlineMs
      : dependencies.limits.scrapeRouteDeadlineMs,
  )
  const context: RequestContext = {
    boundary,
    correlationId,
    operation,
    startedAt,
  }
  let admitted: AdmittedContext | null = null
  let completed = false
  let isolationLease: FirecrawlIsolationLease | null = null

  try {
    if (request.raw.url?.includes("?")) {
      return sendGatewayError(reply, 400, "Invalid request.")
    }

    const bearerToken = extractBearerToken(request.headers.authorization)
    if (!bearerToken) {
      return sendGatewayError(reply, 401, "Unauthorized.")
    }

    const resolution = await withinBoundary(
      dependencies.bearerResolver.resolve({
        bearerToken,
        operation,
        signal: boundary.signal,
      }),
      boundary,
    )
    if (!resolution.ok) {
      return sendGatewayError(
        reply,
        resolution.reason === "invalid"
          ? 401
          : resolution.reason === "disabled"
            ? 403
            : 503,
        resolution.reason === "invalid"
          ? "Unauthorized."
          : resolution.reason === "disabled"
            ? "Request denied."
            : "Service unavailable.",
      )
    }

    const identity = resolution.identity
    if (!identity.scopes.includes(requiredScope(operation))) {
      const recorded = await recordNonAdmittedEvent(
        context,
        identity,
        403,
        "blocked",
        0,
        dependencies,
      )
      return recorded
        ? sendGatewayError(reply, 403, "Request denied.")
        : sendGatewayError(reply, 503, "Service unavailable.")
    }

    const isolation = await withinBoundary(
      admitFirecrawlIsolationTraffic(
        dependencies.isolationGate,
        identity,
        correlationId,
        operation,
        boundary.signal,
      ).then((result) => {
        if (boundary.signal.aborted && result.ok) {
          safelyReleaseIsolationLease(result.lease)
        }
        return result
      }),
      boundary,
    )
    if (!isolation.ok || isolation.lease.signal.aborted) {
      if (isolation.ok) {
        safelyReleaseIsolationLease(isolation.lease)
      }
      await recordNonAdmittedEvent(
        context,
        identity,
        503,
        "blocked",
        0,
        dependencies,
      )
      return sendGatewayError(reply, 503, "Service unavailable.")
    }
    isolationLease = isolation.lease
    bindFirecrawlIsolationLeaseRelease(reply, isolationLease)
    boundary.bindIsolation(isolationLease.signal)

    const parsedRequest =
      operation === "search"
        ? {
            kind: "search" as const,
            result: firecrawlSearchRequestSchema.safeParse(request.body ?? {}),
          }
        : {
            kind: "scrape" as const,
            result: firecrawlScrapeRequestSchema.safeParse(request.body ?? {}),
          }
    if (!parsedRequest.result.success) {
      const recorded = await recordNonAdmittedEvent(
        context,
        identity,
        400,
        "blocked",
        0,
        dependencies,
      )
      return recorded
        ? sendGatewayError(reply, 400, "Invalid request.")
        : sendGatewayError(reply, 503, "Service unavailable.")
    }

    const requestData = parsedRequest.result.data
    const requestBytes = Buffer.byteLength(JSON.stringify(requestData))
    const admission = await withinBoundary(
      dependencies.admission.admit({
        correlationId,
        identity,
        operation,
        signal: boundary.signal,
      }),
      boundary,
    )
    if (!admission.ok) {
      const status = admission.reason === "unavailable" ? 503 : 429
      const recorded = await recordNonAdmittedEvent(
        context,
        identity,
        status,
        "blocked",
        requestBytes,
        dependencies,
      )
      if (
        recorded &&
        status === 429 &&
        validRetryAfter(admission.retryAfterSeconds)
      ) {
        reply.header("retry-after", String(admission.retryAfterSeconds))
      }
      return recorded
        ? sendGatewayError(
            reply,
            status,
            status === 429 ? "Request limit reached." : "Service unavailable.",
          )
        : sendGatewayError(reply, 503, "Service unavailable.")
    }

    admitted = {
      ...context,
      admissionId: admission.admissionId,
      identity,
      requestBytes,
      settlementAttempted: false,
    }

    let upstreamBody: Record<string, unknown>
    if (parsedRequest.kind === "scrape") {
      const target = await validateFirecrawlPublicUrl(
        parsedRequest.result.data.url,
        {
          allowedHosts: dependencies.allowedHosts,
          lookup: dependencies.dnsLookup,
          signal: boundary.signal,
        },
      )
      if (!target.ok) {
        const status = statusForUrlFailure(target.reason, boundary)
        completed = await completeAdmittedRequest(
          admitted,
          terminalEvent(admitted, dependencies, {
            outcome: status === 499 ? "cancelled" : "blocked",
            status,
          }),
          dependencies,
        )
        return completed
          ? sendGatewayError(
              reply,
              status,
              status >= 500 ? "Service unavailable." : "Invalid request.",
            )
          : sendGatewayError(reply, 503, "Service unavailable.")
      }
      upstreamBody = {
        ...parsedRequest.result.data,
        maxAge: 0,
        proxy: "basic",
        removeBase64Images: true,
        skipTlsVerification: false,
        storeInCache: false,
        timeout: SCRAPE_UPSTREAM_TIMEOUT_MS,
        url: target.normalizedUrl,
        zeroDataRetention: true,
      }
    } else {
      upstreamBody = {
        ...parsedRequest.result.data,
        timeout: SEARCH_UPSTREAM_TIMEOUT_MS,
      }
    }

    const attemptRecorded = await recordMetadata(
      metadataEvent(admitted, dependencies, {
        outcome: "attempted",
        status: 202,
      }),
      dependencies,
      boundary,
    )
    if (!attemptRecorded) {
      const status = statusForBoundary(boundary, 503)
      completed = await completeAdmittedRequest(
        admitted,
        terminalEvent(admitted, dependencies, {
          outcome: status === 499 ? "cancelled" : "failed",
          status,
        }),
        dependencies,
      )
      return sendGatewayError(
        reply,
        completed ? status : 503,
        status === 504
          ? "Request timed out."
          : status === 499
            ? "Request cancelled."
            : "Service unavailable.",
      )
    }

    const upstream = await callFirecrawlUpstream(
      operation,
      upstreamBody,
      correlationId,
      dependencies,
      boundary,
    )
    if (!upstream.ok) {
      completed = await completeAdmittedRequest(
        admitted,
        terminalEvent(admitted, dependencies, {
          outcome: upstream.reason === "cancelled" ? "cancelled" : "failed",
          responseBytes: upstream.responseBytes,
          status: upstream.status,
        }),
        dependencies,
      )
      return completed
        ? sendGatewayError(
            reply,
            upstream.status,
            upstream.status === 504
              ? "Request timed out."
              : upstream.status === 499
                ? "Request cancelled."
                : "Service unavailable.",
          )
        : sendGatewayError(reply, 503, "Service unavailable.")
    }

    const shaped =
      parsedRequest.kind === "search"
        ? shapeSearchResponse(upstream.body, parsedRequest.result.data.limit)
        : await shapeScrapeResponse(
            upstream.body,
            parsedRequest.result.data.formats,
            dependencies,
            boundary,
          )
    if (!shaped) {
      const status = statusForBoundary(boundary, 502)
      completed = await completeAdmittedRequest(
        admitted,
        terminalEvent(admitted, dependencies, {
          outcome: status === 499 ? "cancelled" : "failed",
          responseBytes: upstream.responseBytes,
          status,
        }),
        dependencies,
      )
      return completed
        ? sendGatewayError(
            reply,
            status,
            status === 504
              ? "Request timed out."
              : status === 499
                ? "Request cancelled."
                : "Service unavailable.",
          )
        : sendGatewayError(reply, 503, "Service unavailable.")
    }

    try {
      await withinBoundary(
        dependencies.connectionEvidence.record({
          connectedAt: new Date(dependencies.now()).toISOString(),
          correlationId,
          identity,
          operation,
          signal: boundary.signal,
        }),
        boundary,
      )
    } catch {
      const status = statusForBoundary(boundary, 503)
      completed = await completeAdmittedRequest(
        admitted,
        terminalEvent(admitted, dependencies, {
          outcome: status === 499 ? "cancelled" : "failed",
          responseBytes: upstream.responseBytes,
          status,
        }),
        dependencies,
      )
      return sendGatewayError(
        reply,
        completed ? status : 503,
        status === 504
          ? "Request timed out."
          : status === 499
            ? "Request cancelled."
            : "Service unavailable.",
      )
    }

    const preSettlementStatus = statusForBoundary(boundary, 0)
    if (preSettlementStatus !== 0) {
      completed = await completeAdmittedRequest(
        admitted,
        terminalEvent(admitted, dependencies, {
          outcome: preSettlementStatus === 499 ? "cancelled" : "failed",
          responseBytes: upstream.responseBytes,
          status: preSettlementStatus,
        }),
        dependencies,
      )
      return sendGatewayError(
        reply,
        completed ? preSettlementStatus : 503,
        preSettlementStatus === 504
          ? "Request timed out."
          : preSettlementStatus === 499
            ? "Request cancelled."
            : "Service unavailable.",
      )
    }

    if (!isolationLease) {
      completed = await completeAdmittedRequest(
        admitted,
        terminalEvent(admitted, dependencies, {
          outcome: "failed",
          responseBytes: upstream.responseBytes,
          status: 503,
        }),
        dependencies,
      )
      return sendGatewayError(reply, 503, "Service unavailable.")
    }
    const terminalContext = admitted
    const finalized = await finalizeFirecrawlIsolationTraffic(
      isolationLease,
      async () => {
        const settled = await completeAdmittedRequest(
          terminalContext,
          terminalEvent(terminalContext, dependencies, {
            outcome: "succeeded",
            responseBytes: upstream.responseBytes,
            resultCount: shaped.resultCount,
            status: 200,
          }),
          dependencies,
        )
        return settled
          ? {
              ok: true as const,
              response: reply
                .code(200)
                .type("application/json")
                .send(shaped.body),
            }
          : { ok: false as const }
      },
    )
    if (finalized.ok && finalized.value.ok) {
      completed = true
      return finalized.value.response
    }
    if (!terminalContext.settlementAttempted) {
      completed = await completeAdmittedRequest(
        terminalContext,
        terminalEvent(terminalContext, dependencies, {
          outcome: "failed",
          responseBytes: upstream.responseBytes,
          status: 503,
        }),
        dependencies,
      )
    }
    return sendGatewayError(reply, 503, "Service unavailable.")
  } catch (error) {
    const status =
      error instanceof FirecrawlGatewayAbortError
        ? error.reason === "deadline_exceeded"
          ? 504
          : error.reason === "isolated"
            ? 503
            : 499
        : statusForBoundary(boundary, 503)
    if (admitted && !admitted.settlementAttempted) {
      completed = await completeAdmittedRequest(
        admitted,
        terminalEvent(admitted, dependencies, {
          outcome: status === 499 ? "cancelled" : "failed",
          status,
        }),
        dependencies,
      )
    }
    return sendGatewayError(
      reply,
      completed || !admitted ? status : 503,
      status === 504
        ? "Request timed out."
        : status === 499
          ? "Request cancelled."
          : "Service unavailable.",
    )
  } finally {
    if (admitted && !admitted.settlementAttempted) {
      const fallbackSettlement = terminalEvent(admitted, dependencies, {
        outcome: "failed",
        status: 503,
      })
      admitted.settlementAttempted = true
      await settleWithDeadline(() =>
        dependencies.admission.settle(fallbackSettlement),
      )
    }
    boundary.dispose()
  }
}

async function callFirecrawlUpstream(
  operation: FirecrawlGatewayOperation,
  body: Record<string, unknown>,
  correlationId: string,
  dependencies: RegisteredDependencies,
  boundary: RequestBoundary,
): Promise<UpstreamResult> {
  if (!dependencies.upstreamBaseUrl) {
    return {
      ok: false,
      reason: "unavailable",
      responseBytes: 0,
      status: 503,
    }
  }

  try {
    const response = await withinBoundary(
      dependencies.fetchImpl(
        new URL(`/v2/${operation}`, dependencies.upstreamBaseUrl),
        {
          body: JSON.stringify(body),
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "X-Request-Id": correlationId,
          },
          method: "POST",
          redirect: "error",
          signal: boundary.signal,
        },
      ),
      boundary,
    )
    const maxBytes =
      operation === "search"
        ? dependencies.limits.searchResponseBytes
        : dependencies.limits.scrapeResponseBytes
    const responseText = await withinBoundary(
      readBoundedResponse(response, maxBytes, boundary.signal),
      boundary,
    )
    const responseBytes = Buffer.byteLength(responseText)
    if (!response.ok || response.status >= 300) {
      return {
        ok: false,
        reason: "unavailable",
        responseBytes,
        status: response.status === 408 || response.status === 504 ? 504 : 502,
      }
    }

    try {
      return {
        body: JSON.parse(responseText) as unknown,
        ok: true,
        responseBytes,
      }
    } catch {
      return {
        ok: false,
        reason: "invalid_response",
        responseBytes,
        status: 502,
      }
    }
  } catch (error) {
    if (error instanceof FirecrawlResponseTooLargeError) {
      return {
        ok: false,
        reason: "response_too_large",
        responseBytes: 0,
        status: 502,
      }
    }
    const reason = boundary.failureReason()
    return {
      ok: false,
      reason: reason ?? "unavailable",
      responseBytes: 0,
      status:
        reason === "deadline_exceeded"
          ? 504
          : reason === "isolated"
            ? 503
            : reason === "cancelled"
              ? 499
              : 502,
    }
  }
}

function shapeSearchResponse(
  body: unknown,
  limit: number,
): GatewayResponse | null {
  if (!isRecord(body) || body.success !== true) {
    return null
  }
  const source = Array.isArray(body.data)
    ? body.data
    : isRecord(body.data)
      ? Array.isArray(body.data.web)
        ? body.data.web
        : Object.keys(body.data).length === 0
          ? []
          : null
      : null
  if (!source) {
    return null
  }

  const web: Record<string, unknown>[] = []
  for (const candidate of source) {
    if (web.length >= Math.min(limit, 5)) {
      break
    }
    if (!isRecord(candidate)) {
      continue
    }
    const url = safeSearchResultUrl(candidate.url)
    if (!url) {
      continue
    }
    const result: Record<string, unknown> = { url }
    const title = boundedString(candidate.title, 1_024)
    const description = boundedString(candidate.description, 4_096)
    if (title !== null) {
      result.title = title
    }
    if (description !== null) {
      result.description = description
    }
    web.push(result)
  }

  return {
    body: { data: { web }, success: true },
    resultCount: web.length,
  }
}

async function shapeScrapeResponse(
  body: unknown,
  formats: readonly ("html" | "markdown")[],
  dependencies: RegisteredDependencies,
  boundary: RequestBoundary,
): Promise<GatewayResponse | null> {
  if (!isRecord(body) || body.success !== true || !isRecord(body.data)) {
    return null
  }

  const data = body.data
  const metadata = isRecord(data.metadata) ? data.metadata : {}
  const redirectUrls = redirectChainFrom(data, metadata)
  if (redirectUrls === null) {
    return null
  }
  const finalUrlCandidates = finalUrlCandidatesFrom([
    data.sourceURL,
    data.url,
    metadata.sourceURL,
    metadata.url,
  ])
  if (finalUrlCandidates === null || finalUrlCandidates.length === 0) {
    return null
  }

  const validatedFinalUrls: string[] = []
  for (const candidate of [...redirectUrls, ...finalUrlCandidates]) {
    const validation = await validateFirecrawlPublicUrl(candidate, {
      allowedHosts: dependencies.allowedHosts,
      lookup: dependencies.dnsLookup,
      signal: boundary.signal,
    })
    if (!validation.ok) {
      return null
    }
    if (finalUrlCandidates.includes(candidate)) {
      validatedFinalUrls.push(validation.normalizedUrl)
    }
  }
  if (validatedFinalUrls.length === 0) {
    return null
  }

  const responseData: Record<string, unknown> = {}
  for (const format of formats) {
    const content = data[format]
    if (typeof content !== "string") {
      return null
    }
    responseData[format] = content
  }

  const responseMetadata: Record<string, unknown> = {
    sourceURL: validatedFinalUrls[0],
  }
  const title = boundedString(metadata.title, 1_024)
  if (title !== null) {
    responseMetadata.title = title
  }
  if (
    Number.isInteger(metadata.statusCode) &&
    Number(metadata.statusCode) >= 100 &&
    Number(metadata.statusCode) <= 599
  ) {
    responseMetadata.statusCode = metadata.statusCode
  }
  responseData.metadata = responseMetadata

  return {
    body: { data: responseData, success: true },
    resultCount: 1,
  }
}

function redirectChainFrom(
  data: Record<string, unknown>,
  metadata: Record<string, unknown>,
): string[] | null {
  const values = [
    data.redirectChain,
    data.redirects,
    metadata.redirectChain,
    metadata.redirects,
  ].filter((value) => value !== undefined)
  const redirects: string[] = []
  for (const value of values) {
    if (!Array.isArray(value) || value.length > MAX_REDIRECTS) {
      return null
    }
    for (const candidate of value) {
      if (
        redirects.length >= MAX_REDIRECTS ||
        typeof candidate !== "string" ||
        candidate.length > 4_096
      ) {
        return null
      }
      redirects.push(candidate)
    }
  }
  return [...new Set(redirects)]
}

function finalUrlCandidatesFrom(values: unknown[]): string[] | null {
  const candidates: string[] = []
  for (const value of values) {
    if (value === undefined) {
      continue
    }
    if (
      typeof value !== "string" ||
      value.length === 0 ||
      value.length > 4_096
    ) {
      return null
    }
    candidates.push(value)
  }
  return [...new Set(candidates)]
}

function safeSearchResultUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 4_096) {
    return null
  }
  try {
    const url = new URL(value)
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username ||
      url.password ||
      url.port
    ) {
      return null
    }
    if (
      isIPLiteral(url.hostname) &&
      !isPublicFirecrawlIpAddress(url.hostname)
    ) {
      return null
    }
    url.hash = ""
    return url.toString()
  } catch {
    return null
  }
}

function isIPLiteral(hostname: string): boolean {
  return (
    /^\d{1,3}(?:\.\d{1,3}){3}$/u.test(hostname) ||
    (hostname.startsWith("[") && hostname.endsWith("]"))
  )
}

async function recordNonAdmittedEvent(
  context: RequestContext,
  identity: FirecrawlGatewayIdentity,
  status: number,
  outcome: FirecrawlGatewayOutcome,
  requestBytes: number,
  dependencies: RegisteredDependencies,
): Promise<boolean> {
  return recordMetadata(
    {
      applicationId: identity.applicationId,
      correlationId: context.correlationId,
      credentialRecordId: identity.credentialRecordId,
      latencyMs: elapsed(context.startedAt, dependencies.now()),
      operation: context.operation,
      outcome,
      requestBytes,
      responseBytes: 0,
      resultCount: 0,
      status,
    },
    dependencies,
    context.boundary,
  )
}

function metadataEvent(
  context: AdmittedContext,
  dependencies: RegisteredDependencies,
  values: {
    outcome: FirecrawlGatewayOutcome
    responseBytes?: number
    resultCount?: number
    status: number
  },
): FirecrawlGatewayMetadataEvent {
  return {
    applicationId: context.identity.applicationId,
    correlationId: context.correlationId,
    credentialRecordId: context.identity.credentialRecordId,
    latencyMs: elapsed(context.startedAt, dependencies.now()),
    operation: context.operation,
    outcome: values.outcome,
    requestBytes: context.requestBytes,
    responseBytes: values.responseBytes ?? 0,
    resultCount: values.resultCount ?? 0,
    status: values.status,
  }
}

function terminalEvent(
  context: AdmittedContext,
  dependencies: RegisteredDependencies,
  values: {
    outcome: Exclude<FirecrawlGatewayOutcome, "attempted">
    responseBytes?: number
    resultCount?: number
    status: number
  },
): FirecrawlGatewaySettlement {
  return {
    ...metadataEvent(context, dependencies, values),
    admissionId: context.admissionId,
  }
}

async function completeAdmittedRequest(
  context: AdmittedContext,
  settlement: FirecrawlGatewaySettlement,
  dependencies: RegisteredDependencies,
): Promise<boolean> {
  context.settlementAttempted = true
  return settleWithDeadline(() => dependencies.admission.settle(settlement))
}

async function recordMetadata(
  event: FirecrawlGatewayMetadataEvent,
  dependencies: RegisteredDependencies,
  boundary: RequestBoundary,
): Promise<boolean> {
  try {
    await withinBoundary(dependencies.metadata.record(event), boundary)
    return true
  } catch {
    return false
  }
}

async function settleWithDeadline(
  operation: () => Promise<void>,
): Promise<boolean> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      Promise.resolve().then(operation),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Firecrawl completion hook timed out.")),
          COMPLETION_HOOK_DEADLINE_MS,
        )
        timeout.unref()
      }),
    ])
    return true
  } catch {
    return false
  } finally {
    if (timeout) {
      clearTimeout(timeout)
    }
  }
}

function createRequestBoundary(
  request: FastifyRequest,
  reply: FastifyReply,
  deadlineMs: number,
): RequestBoundary {
  const controller = new AbortController()
  let reason: "cancelled" | "deadline_exceeded" | "isolated" | null = null
  let disposed = false
  let isolationSignal: AbortSignal | null = null
  const abort = (
    nextReason: "cancelled" | "deadline_exceeded" | "isolated",
  ): void => {
    if (reason !== null) {
      return
    }
    reason = nextReason
    controller.abort(new FirecrawlGatewayAbortError(nextReason))
  }
  const onDisconnect = (): void => abort("cancelled")
  const onIsolation = (): void => abort("isolated")
  request.raw.once("aborted", onDisconnect)
  request.raw.socket.once("close", onDisconnect)
  reply.raw.once("close", onDisconnect)
  const deadline = setTimeout(() => abort("deadline_exceeded"), deadlineMs)
  deadline.unref()

  return {
    bindIsolation(signal) {
      if (isolationSignal) {
        throw new Error("Firecrawl isolation signal is already bound.")
      }
      isolationSignal = signal
      isolationSignal.addEventListener("abort", onIsolation, { once: true })
      if (isolationSignal.aborted) {
        onIsolation()
      }
    },
    dispose() {
      if (disposed) {
        return
      }
      disposed = true
      clearTimeout(deadline)
      request.raw.off("aborted", onDisconnect)
      request.raw.socket.off("close", onDisconnect)
      reply.raw.off("close", onDisconnect)
      isolationSignal?.removeEventListener("abort", onIsolation)
    },
    failureReason: () => reason,
    signal: controller.signal,
  }
}

async function withinBoundary<T>(
  promise: Promise<T>,
  boundary: RequestBoundary,
): Promise<T> {
  if (boundary.signal.aborted) {
    throw boundary.signal.reason
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(boundary.signal.reason)
    boundary.signal.addEventListener("abort", onAbort, { once: true })
    promise.then(resolve, reject).finally(() => {
      boundary.signal.removeEventListener("abort", onAbort)
    })
  })
}

async function readBoundedResponse(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
): Promise<string> {
  const contentLength = response.headers.get("content-length")
  if (contentLength !== null) {
    const declaredBytes = Number(contentLength)
    if (
      !Number.isSafeInteger(declaredBytes) ||
      declaredBytes < 0 ||
      declaredBytes > maxBytes
    ) {
      await cancelResponse(response)
      throw new FirecrawlResponseTooLargeError()
    }
  }

  const reader = response.body?.getReader()
  if (!reader) {
    throw new Error("Firecrawl response had no body.")
  }
  const decoder = new TextDecoder()
  const chunks: string[] = []
  let bytesRead = 0
  const onAbort = (): void => {
    void reader.cancel(signal.reason).catch(() => undefined)
  }
  signal.addEventListener("abort", onAbort, { once: true })
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        chunks.push(decoder.decode())
        return chunks.join("")
      }
      bytesRead += value.byteLength
      if (bytesRead > maxBytes) {
        await reader.cancel()
        throw new FirecrawlResponseTooLargeError()
      }
      chunks.push(decoder.decode(value, { stream: true }))
    }
  } finally {
    signal.removeEventListener("abort", onAbort)
  }
}

async function cancelResponse(response: Response): Promise<void> {
  try {
    await response.body?.cancel()
  } catch {
    return
  }
}

function registeredDependencies(
  supplied: Partial<FirecrawlGatewayDependencies>,
): RegisteredDependencies {
  return {
    admission: supplied.admission ?? unavailableAdmission,
    allowedHosts: normalizeFirecrawlEgressAllowedHosts(
      supplied.egressAllowedHosts,
    ),
    bearerResolver: supplied.bearerResolver ?? unavailableBearerResolver,
    connectionEvidence:
      supplied.connectionEvidence ?? unavailableConnectionEvidence,
    dnsLookup: supplied.dnsLookup,
    fetchImpl: supplied.fetchImpl ?? globalThis.fetch,
    isolationGate: supplied.isolationGate ?? unavailableIsolationTrafficGate,
    limits: {
      scrapeResponseBytes: boundedOverride(
        supplied.limits?.scrapeResponseBytes,
        FIRECRAWL_SCRAPE_RESPONSE_LIMIT_BYTES,
      ),
      scrapeRouteDeadlineMs: boundedOverride(
        supplied.limits?.scrapeRouteDeadlineMs,
        SCRAPE_ROUTE_DEADLINE_MS,
      ),
      searchResponseBytes: boundedOverride(
        supplied.limits?.searchResponseBytes,
        FIRECRAWL_SEARCH_RESPONSE_LIMIT_BYTES,
      ),
      searchRouteDeadlineMs: boundedOverride(
        supplied.limits?.searchRouteDeadlineMs,
        SEARCH_ROUTE_DEADLINE_MS,
      ),
    },
    metadata: supplied.metadata ?? unavailableMetadata,
    now: supplied.now ?? Date.now,
    upstreamBaseUrl: normalizeUpstreamBaseUrl(supplied.upstreamBaseUrl),
  }
}

function normalizeUpstreamBaseUrl(
  value: string | URL | null | undefined,
): URL | null {
  if (!value) {
    return null
  }
  try {
    const url = new URL(value.toString())
    if (
      url.protocol !== "http:" ||
      url.username ||
      url.password ||
      url.hostname.toLowerCase() !== "firecrawl-api" ||
      url.port !== "3002" ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      return null
    }
    return url
  } catch {
    return null
  }
}

function boundedOverride(value: number | undefined, maximum: number): number {
  return Number.isSafeInteger(value) && Number(value) > 0
    ? Math.min(Number(value), maximum)
    : maximum
}

function requiredScope(operation: FirecrawlGatewayOperation): FirecrawlScope {
  return operation === "search" ? "firecrawl.search" : "firecrawl.scrape"
}

function extractBearerToken(
  value: string | string[] | undefined,
): string | null {
  if (typeof value !== "string" || value.length > 4_096) {
    return null
  }
  const match = /^Bearer ([^\s,]+)$/iu.exec(value)
  return match?.[1] ?? null
}

function statusForUrlFailure(
  reason: string,
  boundary: RequestBoundary,
): number {
  const boundaryStatus = statusForBoundary(boundary, 0)
  if (boundaryStatus !== 0) {
    return boundaryStatus
  }
  if (reason === "cancelled") {
    return 499
  }
  return reason === "dns_unavailable" ? 503 : 400
}

function statusForBoundary(
  boundary: RequestBoundary,
  fallback: number,
): number {
  const reason = boundary.failureReason()
  return reason === "deadline_exceeded"
    ? 504
    : reason === "isolated"
      ? 503
      : reason === "cancelled"
        ? 499
        : fallback
}

function validRetryAfter(value: number | undefined): value is number {
  return (
    Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= 3_600
  )
}

function elapsed(startedAt: number, now: number): number {
  return Math.max(0, Math.min(Math.floor(now - startedAt), 86_400_000))
}

async function admitFirecrawlIsolationTraffic(
  gate: FirecrawlIsolationTrafficGate,
  identity: FirecrawlGatewayIdentity,
  correlationId: string,
  operation: FirecrawlGatewayOperation,
  signal: AbortSignal,
): Promise<Awaited<ReturnType<FirecrawlIsolationTrafficGate["admit"]>>> {
  try {
    return await gate.admit({
      appId: identity.applicationId,
      correlationId,
      credentialRecordId: identity.credentialRecordId,
      route: operation === "search" ? "firecrawl_search" : "firecrawl_scrape",
      signal,
    })
  } catch {
    return { ok: false }
  }
}

function safelyReleaseIsolationLease(lease: FirecrawlIsolationLease): void {
  try {
    lease.release()
  } catch {
    return
  }
}

function bindFirecrawlIsolationLeaseRelease(
  reply: FastifyReply,
  lease: FirecrawlIsolationLease,
): void {
  let released = false
  const release = (): void => {
    if (released) {
      return
    }
    released = true
    safelyReleaseIsolationLease(lease)
  }
  reply.raw.once("finish", release)
  reply.raw.once("close", release)
  if (reply.raw.destroyed) {
    release()
  }
}

async function finalizeFirecrawlIsolationTraffic<T>(
  lease: FirecrawlIsolationLease,
  operation: () => Promise<T>,
): Promise<IsolationTrafficFinalizationResult<T>> {
  try {
    return await lease.finalize(operation)
  } catch {
    return { ok: false }
  }
}

function boundedString(value: unknown, maxLength: number): string | null {
  return typeof value === "string" && value.length <= maxLength ? value : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function setRequestIdHeader(
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  reply.header("cache-control", "no-store")
  reply.header("x-llm-machines-request-id", request.id)
}

function sendGatewayError(
  reply: FastifyReply,
  status: number,
  error: string,
): FastifyReply {
  return reply
    .code(status)
    .type("application/json")
    .send({ error, success: false })
}

function firecrawlRouteErrorHandler(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply,
): FastifyReply {
  setRequestIdHeader(request, reply)
  return sendGatewayError(
    reply,
    error.code === "FST_ERR_CTP_BODY_TOO_LARGE" ? 413 : 400,
    "Invalid request.",
  )
}

const unavailableBearerResolver: FirecrawlBearerResolver = {
  async resolve() {
    return { ok: false, reason: "unavailable" }
  },
}

const unavailableIsolationTrafficGate: FirecrawlIsolationTrafficGate = {
  async admit() {
    return { ok: false }
  },
}

const unavailableAdmission: FirecrawlGatewayAdmissionController = {
  async admit() {
    return { ok: false, reason: "unavailable" }
  },
  async settle() {
    throw new Error("Firecrawl admission settlement is unavailable.")
  },
}

const unavailableConnectionEvidence: FirecrawlConnectionEvidenceRecorder = {
  async record() {
    throw new Error("Firecrawl connection evidence is unavailable.")
  },
}

const unavailableMetadata: FirecrawlGatewayMetadataRecorder = {
  async record() {
    throw new Error("Firecrawl metadata recorder is unavailable.")
  },
}
