import { describe, expect, it } from "vitest"
import {
  adminConnectedAppFirecrawlCredentialMetadataSchema,
  adminConnectedAppFirecrawlEnableRequestSchema,
  adminConnectedAppFirecrawlSchema,
  adminConnectedAppSchema,
  firecrawlScrapeRequestSchema,
  firecrawlSearchRequestSchema,
} from "./inference-core"

const issuedAt = "2026-07-31T20:00:00.000Z"

describe("PR-08 Firecrawl request contracts", () => {
  it("accepts the reviewed search client shape and strips transport provenance", () => {
    expect(
      firecrawlSearchRequestSchema.parse({
        limit: 5,
        origin: "python-sdk@4.17.0",
        query: "  appliance search  ",
      }),
    ).toEqual({ limit: 5, query: "appliance search" })
  })

  it.each([
    { query: "x", scrapeOptions: { formats: ["markdown"] } },
    { query: "x", sources: ["web"] },
    { query: "" },
    { limit: 6, query: "x" },
  ])("rejects unsupported search capability fields %#", (body) => {
    expect(firecrawlSearchRequestSchema.safeParse(body).success).toBe(false)
  })

  it("accepts the reviewed SDK scrape shape but forces safe stateless values", () => {
    expect(
      firecrawlScrapeRequestSchema.parse({
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
        url: "https://public.example/page",
      }),
    ).toEqual({
      blockAds: true,
      fastMode: false,
      formats: ["markdown", "html"],
      maxAge: 0,
      mobile: false,
      onlyMainContent: true,
      removeBase64Images: true,
      skipTlsVerification: false,
      storeInCache: false,
      url: "https://public.example/page",
    })
  })

  it.each([
    { url: "https://public.example", headers: { authorization: "secret" } },
    { url: "https://public.example", cookies: [{ name: "session" }] },
    { url: "https://public.example", actions: [{ type: "click" }] },
    { url: "https://public.example", extract: { schema: {} } },
    { url: "https://public.example", screenshot: true },
    { url: "https://public.example", formats: ["markdown", "markdown"] },
  ])("rejects non-static scrape capabilities %#", (body) => {
    expect(firecrawlScrapeRequestSchema.safeParse(body).success).toBe(false)
  })
})

describe("PR-08 Application Firecrawl contracts", () => {
  it("defaults existing Applications to installed but disabled Firecrawl", () => {
    const parsed = adminConnectedAppSchema.parse({
      allowedModels: ["model-a"],
      auditHref: "/admin/activity?application=app-1",
      authMethod: "api_key",
      connectionStatus: "not_connected",
      createdAt: issuedAt,
      credentials: [inferenceCredential()],
      description: "Third-party client",
      detailHref: "/admin/applications/app-1",
      id: "app-1",
      lastConnectedAt: null,
      maxConcurrentRequests: null,
      maxContextBytes: null,
      name: "Client",
      rateLimitRps: null,
      status: "enabled",
      tokenAlertState: null,
      tokenAlertThreshold7d: null,
      updatedAt: issuedAt,
      usage: {
        failures7d: 0,
        lastUsedAt: null,
        requests7d: 0,
        tokens7d: 0,
      },
    })

    expect(parsed.firecrawl).toEqual({
      connectionStatus: "not_connected",
      credentials: [],
      disclaimerAcceptedAt: null,
      disclaimerVersion: null,
      lastConnectedAt: null,
      maxConcurrentScrapes: null,
      scrapeRateLimitRps: null,
      searchRateLimitRps: null,
      status: "disabled",
    })
  })

  it("requires current disclaimer evidence and one active key when enabled", () => {
    expect(
      adminConnectedAppFirecrawlSchema.safeParse({
        connectionStatus: "not_connected",
        credentials: [],
        disclaimerAcceptedAt: null,
        disclaimerVersion: null,
        lastConnectedAt: null,
        maxConcurrentScrapes: null,
        scrapeRateLimitRps: null,
        searchRateLimitRps: null,
        status: "enabled",
      }).success,
    ).toBe(false)

    expect(
      adminConnectedAppFirecrawlSchema.safeParse({
        connectionStatus: "not_connected",
        credentials: [firecrawlCredential()],
        disclaimerAcceptedAt: issuedAt,
        disclaimerVersion: "firecrawl-outbound-v1",
        lastConnectedAt: null,
        maxConcurrentScrapes: null,
        scrapeRateLimitRps: null,
        searchRateLimitRps: null,
        status: "enabled",
      }).success,
    ).toBe(true)
  })

  it("uses no expiry and preserves exact static-key lifecycle metadata", () => {
    const parsed = adminConnectedAppFirecrawlCredentialMetadataSchema.parse(
      firecrawlCredential(),
    )
    expect(parsed).not.toHaveProperty("expiresAt")
    expect(parsed.status).toBe("active")
  })

  it("requires affirmative disclaimer acceptance and defaults limits off", () => {
    expect(
      adminConnectedAppFirecrawlEnableRequestSchema.safeParse({}).success,
    ).toBe(false)
    expect(
      adminConnectedAppFirecrawlEnableRequestSchema.parse({
        disclaimerAccepted: true,
      }),
    ).toEqual({
      disclaimerAccepted: true,
      maxConcurrentScrapes: null,
      scrapeRateLimitRps: null,
      searchRateLimitRps: null,
    })
  })
})

function inferenceCredential() {
  return {
    authMethod: "api_key" as const,
    clientId: null,
    id: "cak-1",
    issuedAt,
    keyPrefix: "llmm_t4_0123456789abcdef01",
    lastUsedAt: null,
    overlapExpiresAt: null,
    revokedAt: null,
    rotatedAt: null,
    status: "active" as const,
  }
}

function firecrawlCredential() {
  return {
    id: "fck-1",
    issuedAt,
    keyPrefix: "llmm_fc_0123456789abcdef",
    lastUsedAt: null,
    overlapExpiresAt: null,
    revokedAt: null,
    rotatedAt: null,
    status: "active" as const,
  }
}
