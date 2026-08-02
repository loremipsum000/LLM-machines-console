import Fastify from "fastify"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { FirecrawlDnsLookup } from "../services/firecrawl-url-safety"
import { IsolationTrafficGate } from "../services/isolation-traffic-gate"
import {
  type FirecrawlBearerResolver,
  type FirecrawlConnectionEvidenceRecorder,
  type FirecrawlGatewayAdmissionController,
  type FirecrawlGatewayDependencies,
  type FirecrawlGatewayMetadataEvent,
  type FirecrawlGatewayMetadataRecorder,
  type FirecrawlGatewayRouteOptions,
  type FirecrawlGatewaySettlement,
  registerFirecrawlGatewayRoutes,
} from "./firecrawl-gateway"

const firecrawlEngagementContext = {
  correlationId: "firecrawl-finalization-race",
  transitionId: "30000000-0000-4000-8000-000000000001",
}

describe("Firecrawl v2 gateway", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it("resolves the dedicated bearer, shapes search, and never forwards credentials or content to hooks", async () => {
    const privateQuery = "private search canary"
    const privateToken = "llmm-fc-private-token"
    const privateResult = "private result canary"
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Response.json({
        ignoredTopLevel: "not forwarded",
        success: true,
        data: {
          ignored: ["not forwarded"],
          web: [
            {
              description: "bounded description",
              ignored: privateResult,
              title: privateResult,
              url: "https://result.example/page#fragment",
            },
          ],
        },
      }),
    )
    const harness = createHarness({ fetchImpl })
    const server = Fastify({ logger: false })
    registerFirecrawlGatewayRoutes(server, harness.dependencies)

    const response = await server.inject({
      headers: {
        authorization: `Bearer ${privateToken}`,
        cookie: "session=must-not-forward",
        "x-private-header": "must-not-forward",
      },
      method: "POST",
      payload: { limit: 3, origin: "python-sdk@4.17.0", query: privateQuery },
      url: "/v2/search",
    })

    expect(response.statusCode).toBe(200)
    expect(response.headers["cache-control"]).toBe("no-store")
    expect(response.headers["x-llm-machines-request-id"]).toBeTruthy()
    expect(response.json()).toEqual({
      data: {
        web: [
          {
            description: "bounded description",
            title: privateResult,
            url: "https://result.example/page",
          },
        ],
      },
      success: true,
    })

    expect(harness.resolve).toHaveBeenCalledTimes(1)
    expect(harness.resolve.mock.calls[0]?.[0]).toMatchObject({
      bearerToken: privateToken,
      operation: "search",
    })
    const [upstreamUrl, upstreamInit] = fetchImpl.mock.calls[0] as unknown as [
      URL,
      RequestInit,
    ]
    expect(upstreamUrl.toString()).toBe("http://firecrawl-api:3002/v2/search")
    expect(JSON.parse(String(upstreamInit.body))).toEqual({
      limit: 3,
      query: privateQuery,
      timeout: 25_000,
    })
    const upstreamHeaders = new Headers(upstreamInit.headers)
    expect(upstreamHeaders.get("authorization")).toBeNull()
    expect(upstreamHeaders.get("cookie")).toBeNull()
    expect(upstreamHeaders.get("x-private-header")).toBeNull()

    expect(harness.metadataEvents.map(({ outcome }) => outcome)).toEqual([
      "attempted",
    ])
    expect(harness.settlements).toHaveLength(1)
    expect(harness.settlements[0]?.outcome).toBe("succeeded")
    expect(harness.connectionEvidence).toHaveLength(1)
    const hookText = JSON.stringify({
      connectionEvidence: harness.connectionEvidence,
      metadata: harness.metadataEvents,
      settlements: harness.settlements,
    })
    expect(hookText).not.toContain(privateQuery)
    expect(hookText).not.toContain(privateToken)
    expect(hookText).not.toContain(privateResult)
    expect(hookText).not.toContain("result.example")
    await server.close()
  })

  it("normalizes the reviewed SDK scrape payload and validates redirects and final URLs", async () => {
    const privateContent = "# private scraped content"
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Response.json({
        success: true,
        data: {
          arbitrary: "not forwarded",
          html: "<h1>private scraped content</h1>",
          markdown: privateContent,
          metadata: {
            arbitrary: "not forwarded",
            redirectChain: ["https://www.example.com/redirect"],
            sourceURL: "https://www.example.com/final#fragment",
            statusCode: 200,
            title: "Safe title",
          },
        },
      }),
    )
    const harness = createHarness({
      egressAllowedHosts: ["example.com", "www.example.com"],
      fetchImpl,
    })
    const server = Fastify({ logger: false })
    registerFirecrawlGatewayRoutes(server, harness.dependencies)

    const response = await server.inject({
      headers: { authorization: "Bearer firecrawl-scrape-token" },
      method: "POST",
      payload: {
        blockAds: true,
        fastMode: false,
        formats: ["markdown", "html"],
        maxAge: 14_400_000,
        mobile: false,
        onlyMainContent: true,
        origin: "python-sdk@4.17.0",
        removeBase64Images: false,
        skipTlsVerification: true,
        storeInCache: true,
        url: "https://example.com/start",
      },
      url: "/v2/scrape",
    })

    expect(response.statusCode).toBe(200)
    expect(response.headers["cache-control"]).toBe("no-store")
    expect(response.json()).toEqual({
      data: {
        html: "<h1>private scraped content</h1>",
        markdown: privateContent,
        metadata: {
          sourceURL: "https://www.example.com/final",
          statusCode: 200,
          title: "Safe title",
        },
      },
      success: true,
    })

    const [, upstreamInit] = fetchImpl.mock.calls[0] as unknown as [
      URL,
      RequestInit,
    ]
    expect(JSON.parse(String(upstreamInit.body))).toEqual({
      blockAds: true,
      fastMode: false,
      formats: ["markdown", "html"],
      maxAge: 0,
      mobile: false,
      onlyMainContent: true,
      removeBase64Images: true,
      skipTlsVerification: false,
      storeInCache: false,
      timeout: 45_000,
      url: "https://example.com/start",
      zeroDataRetention: true,
    })
    expect(new Headers(upstreamInit.headers).get("authorization")).toBeNull()
    expect(harness.lookup).toHaveBeenCalledTimes(3)
    const hookText = JSON.stringify({
      connectionEvidence: harness.connectionEvidence,
      metadata: harness.metadataEvents,
      settlements: harness.settlements,
    })
    expect(hookText).not.toContain("example.com")
    expect(hookText).not.toContain(privateContent)
    expect(hookText).not.toContain("firecrawl-scrape-token")
    await server.close()
  })

  it("fails closed for missing, invalid, disabled, unavailable, and wrong-scope credentials", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
    const resolver: FirecrawlBearerResolver = {
      resolve: vi.fn(async ({ bearerToken }) => {
        if (bearerToken === "invalid") {
          return { ok: false as const, reason: "invalid" as const }
        }
        if (bearerToken === "disabled") {
          return { ok: false as const, reason: "disabled" as const }
        }
        if (bearerToken === "unavailable") {
          return { ok: false as const, reason: "unavailable" as const }
        }
        return {
          identity: {
            applicationId: "app-search-only",
            credentialRecordId: "fck-search-only",
            scopes: ["firecrawl.search" as const],
          },
          ok: true as const,
        }
      }),
    }
    const harness = createHarness({ bearerResolver: resolver, fetchImpl })
    const server = Fastify({ logger: false })
    registerFirecrawlGatewayRoutes(server, harness.dependencies)
    const baseRequest = {
      method: "POST" as const,
      payload: { url: "https://example.com" },
      url: "/v2/scrape",
    }

    const missing = await server.inject(baseRequest)
    const invalid = await server.inject({
      ...baseRequest,
      headers: { authorization: "Bearer invalid" },
    })
    const disabled = await server.inject({
      ...baseRequest,
      headers: { authorization: "Bearer disabled" },
    })
    const unavailable = await server.inject({
      ...baseRequest,
      headers: { authorization: "Bearer unavailable" },
    })
    const wrongScope = await server.inject({
      ...baseRequest,
      headers: { authorization: "Bearer search-only" },
    })

    expect(missing.statusCode).toBe(401)
    expect(invalid.statusCode).toBe(401)
    expect(disabled.statusCode).toBe(403)
    expect(unavailable.statusCode).toBe(503)
    expect(wrongScope.statusCode).toBe(403)
    expect(fetchImpl).not.toHaveBeenCalled()
    for (const response of [
      missing,
      invalid,
      disabled,
      unavailable,
      wrongScope,
    ]) {
      expect(response.headers["cache-control"]).toBe("no-store")
      expect(response.body).not.toContain("search-only")
    }
    await server.close()
  })

  it("defaults every injected production dependency to unavailable", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
    const server = Fastify({ logger: false })
    registerFirecrawlGatewayRoutes(server, { fetchImpl })

    const response = await server.inject({
      headers: { authorization: "Bearer otherwise-valid" },
      method: "POST",
      payload: { query: "query must not dispatch" },
      url: "/v2/search",
    })

    expect(response.statusCode).toBe(503)
    expect(response.json()).toEqual({
      error: "Service unavailable.",
      success: false,
    })
    expect(fetchImpl).not.toHaveBeenCalled()
    await server.close()
  })

  it.each(["denied", "rejected"] as const)(
    "fails closed when isolation admission is %s",
    async (mode) => {
      const fetchImpl = vi.fn<typeof fetch>()
      const admit = vi.fn(async () => {
        if (mode === "rejected") {
          throw new Error("private isolation store failure")
        }
        return { ok: false as const }
      })
      const harness = createHarness({
        fetchImpl,
        isolationGate: { admit },
      })
      const server = Fastify({ logger: false })
      registerFirecrawlGatewayRoutes(server, harness.dependencies)

      const response = await server.inject({
        headers: { authorization: "Bearer firecrawl-token" },
        method: "POST",
        payload: { query: "private isolation query" },
        url: "/v2/search",
      })

      expect(response.statusCode).toBe(503)
      expect(response.json()).toEqual({
        error: "Service unavailable.",
        success: false,
      })
      expect(response.body).not.toContain("private isolation")
      expect(fetchImpl).not.toHaveBeenCalled()
      expect(admit).toHaveBeenCalledWith({
        appId: "app-1",
        correlationId: expect.any(String),
        credentialRecordId: "fck-1",
        route: "firecrawl_search",
        signal: expect.any(AbortSignal),
      })
      expect(harness.metadataEvents).toEqual([
        expect.objectContaining({ outcome: "blocked", status: 503 }),
      ])
      await server.close()
    },
  )

  it("aborts and settles an admitted Firecrawl request when isolation engages", async () => {
    const controller = new AbortController()
    const release = vi.fn(() => {
      throw new Error("private isolation lease release failure")
    })
    let markStarted: (() => void) | undefined
    const started = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    let upstreamSignal: AbortSignal | undefined
    const fetchImpl = vi.fn<typeof fetch>(
      async (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          upstreamSignal = init?.signal as AbortSignal
          markStarted?.()
          upstreamSignal.addEventListener(
            "abort",
            () => reject(upstreamSignal?.reason),
            { once: true },
          )
        }),
    )
    const harness = createHarness({
      fetchImpl,
      isolationGate: {
        async admit() {
          return {
            lease: {
              async finalize(operation) {
                return controller.signal.aborted
                  ? { ok: false }
                  : { ok: true, value: await operation() }
              },
              release,
              signal: controller.signal,
            },
            ok: true,
          }
        },
      },
    })
    const server = Fastify({ logger: false })
    registerFirecrawlGatewayRoutes(server, harness.dependencies)

    const responsePromise = server.inject({
      headers: { authorization: "Bearer firecrawl-token" },
      method: "POST",
      payload: { query: "abort this private query" },
      url: "/v2/search",
    })
    await started
    controller.abort(new Error("isolation engaged"))
    const response = await responsePromise

    expect(response.statusCode).toBe(503)
    expect(response.body).not.toContain("abort this private query")
    expect(response.body).not.toContain(
      "private isolation lease release failure",
    )
    expect(upstreamSignal?.aborted).toBe(true)
    expect(harness.settlements).toEqual([
      expect.objectContaining({ outcome: "failed", status: 503 }),
    ])
    expect(release).toHaveBeenCalledOnce()
    await server.close()
  })

  it("settles Firecrawl as failed when isolation wins terminal finalization", async () => {
    const finalize = vi.fn(async () => ({ ok: false as const }))
    const release = vi.fn()
    const harness = createHarness({
      fetchImpl: vi.fn<typeof fetch>(async () =>
        Response.json({
          data: {
            web: [
              {
                title: "private-isolation-winner-canary",
                url: "https://example.com/private-isolation-winner-canary",
              },
            ],
          },
          success: true,
        }),
      ),
      isolationGate: {
        async admit() {
          return {
            lease: {
              finalize,
              release,
              signal: new AbortController().signal,
            },
            ok: true,
          }
        },
      },
    })
    const server = Fastify({ logger: false })
    registerFirecrawlGatewayRoutes(server, harness.dependencies)

    const response = await server.inject({
      headers: { authorization: "Bearer firecrawl-token" },
      method: "POST",
      payload: { query: "private query" },
      url: "/v2/search",
    })

    expect(response.statusCode).toBe(503)
    expect(response.body).not.toContain("private-isolation-winner-canary")
    expect(finalize).toHaveBeenCalledOnce()
    expect(harness.settlements).toEqual([
      expect.objectContaining({ outcome: "failed", status: 503 }),
    ])
    expect(release).toHaveBeenCalledOnce()
    await server.close()
  })

  it("commits Firecrawl success before engagement when terminal finalization wins", async () => {
    const isolationGate = await openFirecrawlIsolationGate()
    let markSettlementStarted: (() => void) | undefined
    const settlementStarted = new Promise<void>((resolve) => {
      markSettlementStarted = resolve
    })
    let finishSettlement: (() => void) | undefined
    const settlementBlocked = new Promise<void>((resolve) => {
      finishSettlement = resolve
    })
    const terminalSettlements: FirecrawlGatewaySettlement[] = []
    const settle = vi.fn(async (settlement: FirecrawlGatewaySettlement) => {
      markSettlementStarted?.()
      await settlementBlocked
      terminalSettlements.push(settlement)
    })
    const harness = createHarness({
      admission: {
        async admit() {
          return { admissionId: "lease-final-send", ok: true }
        },
        settle,
      },
      fetchImpl: vi.fn<typeof fetch>(async () =>
        Response.json({
          data: {
            web: [
              {
                description: "private-final-send-canary",
                title: "private-final-send-canary",
                url: "https://example.com/private-final-send-canary",
              },
            ],
          },
          success: true,
        }),
      ),
      isolationGate,
    })
    const server = Fastify({ logger: false })
    registerFirecrawlGatewayRoutes(server, harness.dependencies)

    const responsePromise = server.inject({
      headers: { authorization: "Bearer firecrawl-token" },
      method: "POST",
      payload: { query: "private query" },
      url: "/v2/search",
    })
    await settlementStarted
    const engagement = isolationGate.engage(firecrawlEngagementContext)
    finishSettlement?.()
    const response = await responsePromise

    expect(response.statusCode).toBe(200)
    expect(response.body).toContain("private-final-send-canary")
    expect(settle).toHaveBeenCalledOnce()
    expect(terminalSettlements).toEqual([
      expect.objectContaining({ outcome: "succeeded", status: 200 }),
    ])
    await expect(engagement).resolves.toEqual({ status: "engaged" })
    expect(isolationGate.stateForTest().activeLeases).toBe(0)
    await server.close()
  })

  it("holds a finalized Firecrawl lease until a delayed response finishes", async () => {
    const isolationGate = await openFirecrawlIsolationGate()
    const harness = createHarness({
      fetchImpl: vi.fn<typeof fetch>(async () =>
        Response.json({
          data: {
            web: [
              {
                description: "private-delayed-finish-canary",
                title: "private-delayed-finish-canary",
                url: "https://example.com/private-delayed-finish-canary",
              },
            ],
          },
          success: true,
        }),
      ),
      isolationGate,
    })
    let markResponsePending: (() => void) | undefined
    const responsePending = new Promise<void>((resolve) => {
      markResponsePending = resolve
    })
    let finishResponse: (() => void) | undefined
    const responseBlocked = new Promise<void>((resolve) => {
      finishResponse = resolve
    })
    const server = Fastify({ logger: false })
    server.addHook("onSend", async (request, _reply, payload) => {
      if (request.raw.url?.split("?", 1)[0] === "/v2/search") {
        markResponsePending?.()
        await responseBlocked
      }
      return payload
    })
    registerFirecrawlGatewayRoutes(server, harness.dependencies)

    const responsePromise = server.inject({
      headers: { authorization: "Bearer firecrawl-token" },
      method: "POST",
      payload: { query: "private query" },
      url: "/v2/search",
    })
    await responsePending
    await new Promise<void>((resolve) => setImmediate(resolve))

    expect(isolationGate.stateForTest().activeLeases).toBe(1)
    let engagementSettled = false
    const engagement = isolationGate
      .engage(firecrawlEngagementContext)
      .then((result) => {
        engagementSettled = true
        return result
      })
    await Promise.resolve()

    expect(engagementSettled).toBe(false)
    expect(isolationGate.stateForTest().activeLeases).toBe(1)

    finishResponse?.()
    const response = await responsePromise
    expect(response.statusCode).toBe(200)
    expect(response.body).toContain("private-delayed-finish-canary")
    await expect(engagement).resolves.toEqual({ status: "engaged" })
    expect(isolationGate.stateForTest().activeLeases).toBe(0)
    await server.close()
  })

  it("exposes only the two exact POST routes and rejects unsupported capability bodies", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
    const harness = createHarness({ fetchImpl })
    const server = Fastify({ logger: false })
    registerFirecrawlGatewayRoutes(server, harness.dependencies)
    const headers = { authorization: "Bearer firecrawl-token" }

    const wrongMethod = await server.inject({
      method: "GET",
      url: "/v2/search",
    })
    const unknownRoute = await server.inject({
      headers,
      method: "POST",
      payload: { url: "https://example.com" },
      url: "/v2/crawl?url=private-canary",
    })
    const searchCapability = await server.inject({
      headers,
      method: "POST",
      payload: { query: "query", sources: ["web"] },
      url: "/v2/search",
    })
    const scrapeCapability = await server.inject({
      headers,
      method: "POST",
      payload: {
        actions: [{ type: "click" }],
        url: "https://example.com",
      },
      url: "/v2/scrape",
    })
    const queryString = await server.inject({
      headers,
      method: "POST",
      payload: { query: "query" },
      url: "/v2/search?url=private-canary",
    })

    expect(wrongMethod.statusCode).toBe(404)
    expect(wrongMethod.headers["cache-control"]).toBe("no-store")
    expect(unknownRoute.statusCode).toBe(404)
    expect(searchCapability.statusCode).toBe(400)
    expect(scrapeCapability.statusCode).toBe(400)
    expect(queryString.statusCode).toBe(400)
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(server.hasRoute({ method: "POST", url: "/v2/search" })).toBe(true)
    expect(server.hasRoute({ method: "POST", url: "/v2/scrape" })).toBe(true)
    expect(server.hasRoute({ method: "GET", url: "/v2/search" })).toBe(false)
    expect(server.hasRoute({ method: "POST", url: "/v2/crawl" })).toBe(false)
    await server.close()
  })

  it("enforces the 16 KiB body limit and generic parser failures", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
    const harness = createHarness({ fetchImpl })
    const server = Fastify({ logger: false })
    registerFirecrawlGatewayRoutes(server, harness.dependencies)

    const oversized = await server.inject({
      headers: { authorization: "Bearer firecrawl-token" },
      method: "POST",
      payload: { query: "x".repeat(17 * 1024) },
      url: "/v2/search",
    })
    const malformed = await server.inject({
      headers: {
        authorization: "Bearer firecrawl-token",
        "content-type": "application/json",
      },
      method: "POST",
      payload: '{"query":',
      url: "/v2/search",
    })

    expect(oversized.statusCode).toBe(413)
    expect(malformed.statusCode).toBe(400)
    expect(oversized.json()).toEqual({
      error: "Invalid request.",
      success: false,
    })
    expect(malformed.json()).toEqual({
      error: "Invalid request.",
      success: false,
    })
    expect(fetchImpl).not.toHaveBeenCalled()
    await server.close()
  })

  it("blocks non-allowlisted, private, port-bearing, hosted-cloud, and unsafe redirect targets", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Response.json({
        success: true,
        data: {
          markdown: "unsafe response",
          metadata: {
            redirectChain: ["http://169.254.169.254/latest/meta-data"],
            sourceURL: "https://example.com/final",
          },
        },
      }),
    )
    const lookup = vi.fn<FirecrawlDnsLookup>(async (hostname) =>
      hostname === "private.example"
        ? [{ address: "127.0.0.1", family: 4 }]
        : [{ address: "93.184.216.34", family: 4 }],
    )
    const harness = createHarness({
      dnsLookup: lookup,
      egressAllowedHosts: ["example.com", "private.example"],
      fetchImpl,
    })
    const server = Fastify({ logger: false })
    registerFirecrawlGatewayRoutes(server, harness.dependencies)
    const request = async (url: string) =>
      server.inject({
        headers: { authorization: "Bearer firecrawl-token" },
        method: "POST",
        payload: { url },
        url: "/v2/scrape",
      })

    const wrongHost = await request("https://other.example/page")
    const privateDns = await request("https://private.example/page")
    const explicitPort = await request("https://example.com:443/page")
    const hostedCloud = await request("https://api.firecrawl.dev/v2/scrape")
    const unsafeRedirect = await request("https://example.com/start")

    expect(wrongHost.statusCode).toBe(400)
    expect(privateDns.statusCode).toBe(400)
    expect(explicitPort.statusCode).toBe(400)
    expect(hostedCloud.statusCode).toBe(400)
    expect(unsafeRedirect.statusCode).toBe(502)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(unsafeRedirect.body).not.toContain("169.254.169.254")
    expect(unsafeRedirect.body).not.toContain("unsafe response")
    await server.close()
  })

  it("rejects redirect metadata whose cumulative entries exceed the bound", async () => {
    const redirect = "https://example.com/redirect"
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Response.json({
        success: true,
        data: {
          markdown: "must not be returned",
          metadata: {
            redirectChain: [redirect],
            sourceURL: "https://example.com/final",
          },
          redirectChain: Array.from({ length: 10 }, () => redirect),
          redirects: Array.from({ length: 10 }, () => redirect),
        },
      }),
    )
    const harness = createHarness({ fetchImpl })
    const server = Fastify({ logger: false })
    registerFirecrawlGatewayRoutes(server, harness.dependencies)

    const response = await server.inject({
      headers: { authorization: "Bearer firecrawl-token" },
      method: "POST",
      payload: { url: "https://example.com/start" },
      url: "/v2/scrape",
    })

    expect(response.statusCode).toBe(502)
    expect(response.body).not.toContain("must not be returned")
    expect(harness.connectionEvidence).toHaveLength(0)
    expect(harness.settlements).toHaveLength(1)
    await server.close()
  })

  it("rejects malformed recognized final URL fields instead of ignoring them", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Response.json({
        success: true,
        data: {
          markdown: "must not be returned",
          metadata: { sourceURL: "https://example.com/final" },
          sourceURL: { unexpected: "shape" },
        },
      }),
    )
    const harness = createHarness({ fetchImpl })
    const server = Fastify({ logger: false })
    registerFirecrawlGatewayRoutes(server, harness.dependencies)

    const response = await server.inject({
      headers: { authorization: "Bearer firecrawl-token" },
      method: "POST",
      payload: { url: "https://example.com/start" },
      url: "/v2/scrape",
    })

    expect(response.statusCode).toBe(502)
    expect(response.body).not.toContain("must not be returned")
    expect(harness.connectionEvidence).toHaveLength(0)
    await server.close()
  })

  it("maps rate and concurrency admission denials without upstream dispatch", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
    const admission: FirecrawlGatewayAdmissionController = {
      admit: vi
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          reason: "rate_limited",
          retryAfterSeconds: 7,
        })
        .mockResolvedValueOnce({
          ok: false,
          reason: "concurrency_limited",
        }),
      settle: vi.fn(async () => undefined),
    }
    const harness = createHarness({ admission, fetchImpl })
    const server = Fastify({ logger: false })
    registerFirecrawlGatewayRoutes(server, harness.dependencies)
    const request = {
      headers: { authorization: "Bearer firecrawl-token" },
      method: "POST" as const,
      payload: { query: "bounded" },
      url: "/v2/search",
    }

    const rate = await server.inject(request)
    const concurrency = await server.inject(request)

    expect(rate.statusCode).toBe(429)
    expect(rate.headers["retry-after"]).toBe("7")
    expect(concurrency.statusCode).toBe(429)
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(harness.metadataEvents.map(({ outcome }) => outcome)).toEqual([
      "blocked",
      "blocked",
    ])
    await server.close()
  })

  it("aborts an upstream request at the bounded route deadline", async () => {
    const observed: { signal?: AbortSignal } = {}
    const fetchImpl = vi.fn<typeof fetch>(
      async (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal as AbortSignal
          observed.signal = signal
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          })
        }),
    )
    const harness = createHarness({
      fetchImpl,
      limits: { searchRouteDeadlineMs: 20 },
    })
    const server = Fastify({ logger: false })
    registerFirecrawlGatewayRoutes(server, harness.dependencies)

    const response = await server.inject({
      headers: { authorization: "Bearer firecrawl-token" },
      method: "POST",
      payload: { query: "deadline canary" },
      url: "/v2/search",
    })

    expect(response.statusCode).toBe(504)
    expect(observed.signal?.aborted).toBe(true)
    expect(harness.settlements[0]).toMatchObject({
      outcome: "failed",
      status: 504,
    })
    await server.close()
  })

  it("preserves the route deadline while validating upstream response URLs", async () => {
    let lookupCount = 0
    const lookup = vi.fn<FirecrawlDnsLookup>(() => {
      lookupCount += 1
      return lookupCount === 1
        ? Promise.resolve([{ address: "93.184.216.34", family: 4 }])
        : new Promise(() => undefined)
    })
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Response.json({
        success: true,
        data: {
          markdown: "deadline content",
          metadata: { sourceURL: "https://example.com/final" },
        },
      }),
    )
    const harness = createHarness({
      dnsLookup: lookup,
      fetchImpl,
      limits: { scrapeRouteDeadlineMs: 20 },
    })
    const server = Fastify({ logger: false })
    registerFirecrawlGatewayRoutes(server, harness.dependencies)

    const response = await server.inject({
      headers: { authorization: "Bearer firecrawl-token" },
      method: "POST",
      payload: { url: "https://example.com/start" },
      url: "/v2/scrape",
    })

    expect(response.statusCode).toBe(504)
    expect(response.body).not.toContain("deadline content")
    expect(harness.settlements).toHaveLength(1)
    expect(harness.settlements[0]).toMatchObject({
      outcome: "failed",
      status: 504,
    })
    await server.close()
  })

  it("preserves the route deadline while recording connection evidence", async () => {
    const connectionEvidence: FirecrawlConnectionEvidenceRecorder = {
      async record() {
        await new Promise(() => undefined)
      },
    }
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Response.json({ success: true, data: { web: [] } }),
    )
    const harness = createHarness({
      connectionEvidence,
      fetchImpl,
      limits: { searchRouteDeadlineMs: 20 },
    })
    const server = Fastify({ logger: false })
    registerFirecrawlGatewayRoutes(server, harness.dependencies)

    const response = await server.inject({
      headers: { authorization: "Bearer firecrawl-token" },
      method: "POST",
      payload: { query: "deadline connection canary" },
      url: "/v2/search",
    })

    expect(response.statusCode).toBe(504)
    expect(harness.settlements).toHaveLength(1)
    expect(harness.settlements[0]).toMatchObject({
      outcome: "failed",
      status: 504,
    })
    await server.close()
  })

  it("cancels an upstream response declared over the response cap", async () => {
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true
      },
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"success":true}'))
      },
    })
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Promise.resolve(
        new Response(body, {
          headers: { "content-length": "100" },
          status: 200,
        }),
      ),
    )
    const harness = createHarness({
      fetchImpl,
      limits: { searchResponseBytes: 32 },
    })
    const server = Fastify({ logger: false })
    registerFirecrawlGatewayRoutes(server, harness.dependencies)

    const response = await server.inject({
      headers: { authorization: "Bearer firecrawl-token" },
      method: "POST",
      payload: { query: "bounded" },
      url: "/v2/search",
    })

    expect(response.statusCode).toBe(502)
    expect(cancelled).toBe(true)
    expect(response.json()).toEqual({
      error: "Service unavailable.",
      success: false,
    })
    await server.close()
  })

  it("fails closed when lifecycle evidence or settlement cannot be recorded", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Response.json({ success: true, data: { web: [] } }),
    )
    const connectionFailure = createHarness({
      connectionEvidence: {
        async record() {
          throw new Error("connection store unavailable")
        },
      },
      fetchImpl,
    })
    const connectionServer = Fastify({ logger: false })
    registerFirecrawlGatewayRoutes(
      connectionServer,
      connectionFailure.dependencies,
    )
    const request = {
      headers: { authorization: "Bearer firecrawl-token" },
      method: "POST" as const,
      payload: { query: "private lifecycle canary" },
      url: "/v2/search",
    }

    const connectionResponse = await connectionServer.inject(request)
    expect(connectionResponse.statusCode).toBe(503)
    expect(connectionFailure.settlements).toHaveLength(1)
    await connectionServer.close()

    const failedSettlement = vi.fn(() => {
      throw new Error("settlement unavailable")
    })
    const settlementFailure = createHarness({
      admission: {
        async admit() {
          return { admissionId: "lease-fail", ok: true }
        },
        settle: failedSettlement,
      },
      fetchImpl,
    })
    const settlementServer = Fastify({ logger: false })
    registerFirecrawlGatewayRoutes(
      settlementServer,
      settlementFailure.dependencies,
    )

    const settlementResponse = await settlementServer.inject(request)
    expect(settlementResponse.statusCode).toBe(503)
    expect(settlementResponse.body).not.toContain("lifecycle canary")
    expect(failedSettlement).toHaveBeenCalledTimes(1)
    await settlementServer.close()
  })

  it("settles admission exactly once when attempted metadata persistence fails", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Response.json({ success: true, data: { web: [] } }),
    )

    const attemptSettle = vi.fn(async () => undefined)
    const attemptMetadata = vi.fn(async () => {
      throw new Error("attempt metadata unavailable")
    })
    const attemptFailure = createHarness({
      admission: {
        async admit() {
          return { admissionId: "lease-attempt", ok: true }
        },
        settle: attemptSettle,
      },
      fetchImpl,
      metadata: { record: attemptMetadata },
    })
    const attemptServer = Fastify({ logger: false })
    registerFirecrawlGatewayRoutes(attemptServer, attemptFailure.dependencies)
    const request = {
      headers: { authorization: "Bearer firecrawl-token" },
      method: "POST" as const,
      payload: { query: "metadata canary" },
      url: "/v2/search",
    }

    const attemptResponse = await attemptServer.inject(request)
    expect(attemptResponse.statusCode).toBe(503)
    expect(attemptMetadata).toHaveBeenCalledTimes(1)
    expect(attemptSettle).toHaveBeenCalledTimes(1)
    await attemptServer.close()
  })

  it("commits terminal metadata through settlement only", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Response.json({ success: true, data: { web: [] } }),
    )
    const terminalSettle = vi.fn(async () => undefined)
    const terminalMetadata = vi.fn(async () => undefined)
    const terminalCommit = createHarness({
      admission: {
        async admit() {
          return { admissionId: "lease-terminal", ok: true }
        },
        settle: terminalSettle,
      },
      fetchImpl,
      metadata: { record: terminalMetadata },
    })
    const terminalServer = Fastify({ logger: false })
    registerFirecrawlGatewayRoutes(terminalServer, terminalCommit.dependencies)

    const terminalResponse = await terminalServer.inject({
      headers: { authorization: "Bearer firecrawl-token" },
      method: "POST",
      payload: { query: "metadata canary" },
      url: "/v2/search",
    })
    expect(terminalResponse.statusCode).toBe(200)
    expect(terminalMetadata).toHaveBeenCalledOnce()
    expect(terminalMetadata).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "attempted" }),
    )
    expect(terminalSettle).toHaveBeenCalledTimes(1)
    expect(terminalSettle).toHaveBeenCalledWith(
      expect.objectContaining({
        admissionId: "lease-terminal",
        outcome: "succeeded",
        status: 200,
      }),
    )
    await terminalServer.close()
  })

  it.each([
    "https://api.firecrawl.dev",
    "http://localhost:3002",
    "https://firecrawl-api:3002",
    "http://firecrawl-api:3003",
    "http://example.com:3002",
    "http://firecrawl-api:3002/base",
  ])(
    "rejects non-private Firecrawl upstream configuration %s",
    async (upstreamBaseUrl) => {
      const fetchImpl = vi.fn<typeof fetch>()
      const harness = createHarness({
        fetchImpl,
        upstreamBaseUrl,
      })
      const server = Fastify({ logger: false })
      registerFirecrawlGatewayRoutes(server, harness.dependencies)

      const response = await server.inject({
        headers: { authorization: "Bearer firecrawl-token" },
        method: "POST",
        payload: { query: "must stay local" },
        url: "/v2/search",
      })

      expect(response.statusCode).toBe(503)
      expect(fetchImpl).not.toHaveBeenCalled()
      await server.close()
    },
  )
})

function createHarness(overrides: FirecrawlGatewayRouteOptions = {}) {
  const metadataEvents: FirecrawlGatewayMetadataEvent[] = []
  const settlements: FirecrawlGatewaySettlement[] = []
  const connectionEvidence: unknown[] = []
  const resolve = vi.fn<FirecrawlBearerResolver["resolve"]>(async () => ({
    identity: {
      applicationId: "app-1",
      credentialRecordId: "fck-1",
      scopes: ["firecrawl.search", "firecrawl.scrape"],
    },
    ok: true,
  }))
  const bearerResolver: FirecrawlBearerResolver = { resolve }
  const admission: FirecrawlGatewayAdmissionController = {
    async admit() {
      return { admissionId: "lease-1", ok: true }
    },
    async settle(settlement) {
      settlements.push(settlement)
    },
  }
  const metadata: FirecrawlGatewayMetadataRecorder = {
    async record(event) {
      metadataEvents.push(event)
    },
  }
  const connectionRecorder: FirecrawlConnectionEvidenceRecorder = {
    async record(event) {
      connectionEvidence.push(event)
    },
  }
  const lookup = vi.fn<FirecrawlDnsLookup>(async () => [
    { address: "93.184.216.34", family: 4 },
  ])
  const defaults = {
    admission,
    bearerResolver,
    connectionEvidence: connectionRecorder,
    dnsLookup: lookup,
    egressAllowedHosts: ["example.com"],
    fetchImpl: vi.fn<typeof fetch>(async () =>
      Response.json({ success: true, data: { web: [] } }),
    ),
    isolationGate: {
      async admit() {
        return {
          lease: {
            async finalize(operation) {
              return { ok: true, value: await operation() }
            },
            release() {},
            signal: new AbortController().signal,
          },
          ok: true as const,
        }
      },
    },
    limits: {},
    metadata,
    now: Date.now,
    upstreamBaseUrl: "http://firecrawl-api:3002",
  } satisfies FirecrawlGatewayDependencies

  return {
    connectionEvidence,
    dependencies: { ...defaults, ...overrides },
    lookup:
      overrides.dnsLookup && "mock" in overrides.dnsLookup
        ? (overrides.dnsLookup as typeof lookup)
        : lookup,
    metadataEvents,
    resolve:
      overrides.bearerResolver && "mock" in overrides.bearerResolver.resolve
        ? (overrides.bearerResolver.resolve as typeof resolve)
        : resolve,
    settlements,
  }
}

async function openFirecrawlIsolationGate(): Promise<IsolationTrafficGate> {
  const gate = new IsolationTrafficGate(
    {
      async read() {
        return {
          activatedAt: null,
          activatedBySubjectId: null,
          effectiveTrafficState: "open",
          failureCode: null,
          revision: 0,
          runtimeQualified: false,
          state: "inactive",
          updatedAt: "2026-08-02T12:00:00.000Z",
          updatedBySubjectId: null,
        }
      },
    },
    { drainTimeoutMs: 1_000 },
  )
  const prepared = await gate.prepareDisengage(firecrawlEngagementContext)
  if (
    prepared.status !== "prepared" ||
    !prepared.deactivationCommitReservation.enterCommitting()
  ) {
    throw new Error("Expected an open isolation gate fixture.")
  }
  prepared.deactivationCommitReservation.commit()
  return gate
}
