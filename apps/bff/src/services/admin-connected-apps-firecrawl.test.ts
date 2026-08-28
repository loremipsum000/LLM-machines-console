import { randomUUID } from "node:crypto"
import type { AdminConnectedAppFirecrawlEnableRequest } from "@llm-machines/contracts/inference-core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Actor } from "../auth/authorization"
import {
  AdminConnectedAppFirecrawlCredentialCommitRaceError,
  FIRECRAWL_DISCLAIMER_VERSION,
  admitAdminConnectedAppFirecrawlRequest,
  deleteAdminConnectedAppFirecrawlForParent,
  disableAdminConnectedAppFirecrawl,
  disableAdminConnectedAppFirecrawlForParent,
  enableAdminConnectedAppFirecrawl,
  getAdminConnectedAppFirecrawlProjection,
  initializeAdminConnectedAppFirecrawlForParent,
  markAdminConnectedAppFirecrawlParentEnabled,
  preflightAdminConnectedAppFirecrawlReadiness,
  recordAdminConnectedAppFirecrawlConnection,
  resetAdminConnectedAppFirecrawlForTest,
  resolveAdminConnectedAppFirecrawlCredential,
  revokeAdminConnectedAppFirecrawlCredential,
  settleAdminConnectedAppFirecrawlRequest,
  testAdminConnectedAppFirecrawl,
} from "./admin-connected-apps-firecrawl"
import { getAuditEventsForTest, resetAuditEventsForTest } from "./audit"
import type { IdentityMutationRouteContext } from "./identity-mutation-journal"

const actor: Actor = {
  authMode: "service-forwarded",
  role: "admin",
  subject: "keycloak-admin-1",
}

describe("per-Application Firecrawl lifecycle", () => {
  beforeEach(() => {
    vi.stubEnv("DATABASE_URL", "")
    vi.stubEnv("NODE_ENV", "test")
    configureReadyFirecrawl()
    resetAdminConnectedAppFirecrawlForTest()
    resetAuditEventsForTest()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    resetAdminConnectedAppFirecrawlForTest()
    resetAuditEventsForTest()
  })

  it("initializes every parent Application with Firecrawl default off", async () => {
    await initializeAdminConnectedAppFirecrawlForParent(actor, "app-1")

    await expect(
      getAdminConnectedAppFirecrawlProjection("app-1"),
    ).resolves.toEqual({
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

  it("requires a current disclaimer and an atomic receipt transaction for first enable", async () => {
    await initializeAdminConnectedAppFirecrawlForParent(actor, "app-1")

    await expect(
      enableAdminConnectedAppFirecrawl(actor, "app-1", enableRequest()),
    ).resolves.toMatchObject({
      detail: expect.stringMatching(/finalization/),
      status: "blocked",
    })

    const committedResourceIds: Array<string | null> = []
    const commitWithReceipt: NonNullable<
      IdentityMutationRouteContext["commitWithReceipt"]
    > = async ({ resourceId, run }) => {
      committedResourceIds.push(resourceId)
      return run(null)
    }
    const enabled = await enableAdminConnectedAppFirecrawl(
      actor,
      "app-1",
      enableRequest(),
      identityContext("firecrawl.enable", commitWithReceipt),
    )

    expect(committedResourceIds).toEqual(["app-1"])
    expect(enabled).toMatchObject({
      credential: {
        apiKey: expect.stringMatching(
          /^llmm_fc_[0-9a-f]{16}_[A-Za-z0-9_-]{43}$/,
        ),
        keyPrefix: expect.stringMatching(/^llmm_fc_[0-9a-f]{16}$/),
      },
      firecrawl: {
        disclaimerVersion: FIRECRAWL_DISCLAIMER_VERSION,
        maxConcurrentScrapes: null,
        scrapeRateLimitRps: null,
        searchRateLimitRps: null,
        status: "enabled",
      },
      status: "enabled",
    })
    if (enabled.status !== "enabled" || !enabled.credential) {
      throw new Error("Expected a one-time Firecrawl key reveal.")
    }
    const auditJson = JSON.stringify(getAuditEventsForTest())
    expect(auditJson).not.toContain(enabled.credential.apiKey)
    expect(getAuditEventsForTest()).toContainEqual(
      expect.objectContaining({
        applicationId: "app-1",
        credentialRecordId: enabled.credential.credentialId,
        keycloakSubjectId: actor.subject,
      }),
    )
  })

  it("builds each one-time credential response before its receipt commit completes", async () => {
    await initializeAdminConnectedAppFirecrawlForParent(actor, "app-1")
    const order: string[] = []
    const commitWithReceipt: NonNullable<
      IdentityMutationRouteContext["commitWithReceipt"]
    > = async ({ run }) => {
      order.push("commit:start")
      const result = await run(null)
      order.push("commit:complete")
      return result
    }
    const finalizeReveal = async <T extends { status: "enabled" }>(
      result: T,
    ): Promise<T> => {
      order.push(`${result.status}:response`)
      return result
    }

    await enableAdminConnectedAppFirecrawl(
      actor,
      "app-1",
      enableRequest(),
      identityContext("firecrawl.enable", commitWithReceipt),
      finalizeReveal,
    )
    expect(order).toEqual([
      "commit:start",
      "enabled:response",
      "commit:complete",
    ])
  })

  it("aborts one-time receipt commits when the Application disappears after preflight", async () => {
    await initializeAdminConnectedAppFirecrawlForParent(actor, "enable-race")
    let enableReceiptCompleted = false
    const enableCommit: NonNullable<
      IdentityMutationRouteContext["commitWithReceipt"]
    > = async ({ run }) => {
      await deleteAdminConnectedAppFirecrawlForParent(actor, "enable-race")
      const result = await run(null)
      enableReceiptCompleted = true
      return result
    }

    await expect(
      enableAdminConnectedAppFirecrawl(
        actor,
        "enable-race",
        enableRequest(),
        identityContext("firecrawl.enable", enableCommit),
      ),
    ).rejects.toMatchObject({
      failure: { status: "not_found" },
      name: AdminConnectedAppFirecrawlCredentialCommitRaceError.name,
    })
    expect(enableReceiptCompleted).toBe(false)
  })

  it("resolves only the dedicated Firecrawl key namespace and disables immediately", async () => {
    const enabled = await createEnabled("app-1")
    if (!enabled.credential) {
      throw new Error("Expected a Firecrawl key.")
    }

    await expect(
      resolveAdminConnectedAppFirecrawlCredential(enabled.credential.apiKey),
    ).resolves.toEqual({
      identity: {
        applicationId: "app-1",
        credentialRecordId: enabled.credential.credentialId,
        scopes: ["firecrawl.search", "firecrawl.scrape"],
      },
      ok: true,
    })
    await expect(
      resolveAdminConnectedAppFirecrawlCredential(
        "llmm_t4_0123456789abcdef01_0123456789012345678901234567890123456789012",
      ),
    ).resolves.toEqual({ ok: false, reason: "invalid" })

    await disableAdminConnectedAppFirecrawl(actor, "app-1")
    await expect(
      resolveAdminConnectedAppFirecrawlCredential(enabled.credential.apiKey),
    ).resolves.toEqual({ ok: false, reason: "disabled" })
  })

  it("re-enables with an existing key without revealing or rotating it", async () => {
    const enabled = await createEnabled(
      "app-1",
      enableRequest({
        maxConcurrentScrapes: 2,
        scrapeRateLimitRps: 3,
        searchRateLimitRps: 4,
      }),
    )
    if (!enabled.credential) {
      throw new Error("Expected a Firecrawl key.")
    }
    await disableAdminConnectedAppFirecrawl(actor, "app-1")

    const reenabled = await enableAdminConnectedAppFirecrawl(
      actor,
      "app-1",
      enableRequest({
        maxConcurrentScrapes: 20,
        scrapeRateLimitRps: 30,
        searchRateLimitRps: 40,
      }),
    )

    expect(reenabled).toMatchObject({
      credential: null,
      firecrawl: {
        credentials: [
          expect.objectContaining({ id: enabled.credential.credentialId }),
        ],
        maxConcurrentScrapes: 2,
        scrapeRateLimitRps: 3,
        searchRateLimitRps: 4,
        status: "enabled",
      },
      status: "enabled",
    })
  })

  it("uses passive authenticated gateway evidence without calling upstream", async () => {
    const enabled = await createEnabled("app-1")
    if (!enabled.credential) {
      throw new Error("Expected a Firecrawl key.")
    }
    const fetchSpy = vi.fn()
    vi.stubGlobal("fetch", fetchSpy)
    const connectedAt = new Date().toISOString()

    await expect(
      recordAdminConnectedAppFirecrawlConnection({
        applicationId: "app-1",
        connectedAt,
        correlationId: "correlation-1",
        credentialRecordId: enabled.credential.credentialId,
      }),
    ).resolves.toBe(true)
    await expect(
      testAdminConnectedAppFirecrawl(actor, "app-1"),
    ).resolves.toMatchObject({
      connectionStatus: "connected",
      observedAt: connectedAt,
      status: "passed",
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("enforces optional rate and scrape concurrency controls through metadata-only admissions", async () => {
    const enabled = await createEnabled(
      "app-1",
      enableRequest({
        maxConcurrentScrapes: 1,
        searchRateLimitRps: 1,
      }),
    )
    if (!enabled.credential) {
      throw new Error("Expected a Firecrawl key.")
    }
    const resolution = await resolveAdminConnectedAppFirecrawlCredential(
      enabled.credential.apiKey,
    )
    if (!resolution.ok) {
      throw new Error("Expected a Firecrawl runtime identity.")
    }

    await expect(
      admitAdminConnectedAppFirecrawlRequest({
        correlationId: "search-1",
        identity: resolution.identity,
        operation: "search",
      }),
    ).resolves.toMatchObject({ ok: true })
    await expect(
      admitAdminConnectedAppFirecrawlRequest({
        correlationId: "search-2",
        identity: resolution.identity,
        operation: "search",
      }),
    ).resolves.toEqual({
      ok: false,
      reason: "rate_limited",
      retryAfterSeconds: 1,
    })

    const scrape = await admitAdminConnectedAppFirecrawlRequest({
      correlationId: "scrape-1",
      identity: resolution.identity,
      operation: "scrape",
    })
    expect(scrape.ok).toBe(true)
    await expect(
      admitAdminConnectedAppFirecrawlRequest({
        correlationId: "scrape-2",
        identity: resolution.identity,
        operation: "scrape",
      }),
    ).resolves.toEqual({ ok: false, reason: "concurrency_limited" })
    if (!scrape.ok) {
      throw new Error("Expected a scrape admission.")
    }
    await expect(
      settleAdminConnectedAppFirecrawlRequest({
        admissionId: scrape.admissionId,
        applicationId: "app-1",
        correlationId: "scrape-1",
        credentialRecordId: resolution.identity.credentialRecordId,
        latencyMs: 25,
        operation: "scrape",
        outcome: "succeeded",
        requestBytes: 100,
        responseBytes: 200,
        resultCount: 1,
        status: 200,
      }),
    ).resolves.toBe(true)
    await expect(
      settleAdminConnectedAppFirecrawlRequest({
        admissionId: scrape.admissionId,
        applicationId: "app-1",
        correlationId: "scrape-1",
        credentialRecordId: resolution.identity.credentialRecordId,
        latencyMs: 25,
        operation: "scrape",
        outcome: "succeeded",
        requestBytes: 100,
        responseBytes: 200,
        resultCount: 1,
        status: 200,
      }),
    ).resolves.toBe(false)
    expect(getAuditEventsForTest()).toContainEqual(
      expect.objectContaining({
        action: "firecrawl.gateway.scrape",
        applicationId: "app-1",
        correlationId: "scrape-1",
        credentialRecordId: resolution.identity.credentialRecordId,
        outcome: "succeeded",
        sourceSystem: "firecrawl",
      }),
    )
  })

  it("expires an unrecoverable scrape concurrency lease after 60 seconds", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-08-01T00:00:00.000Z"))
    try {
      const enabled = await createEnabled(
        "app-lease",
        enableRequest({ maxConcurrentScrapes: 1 }),
      )
      if (!enabled.credential) {
        throw new Error("Expected a Firecrawl key.")
      }
      const resolution = await resolveAdminConnectedAppFirecrawlCredential(
        enabled.credential.apiKey,
      )
      if (!resolution.ok) {
        throw new Error("Expected a Firecrawl runtime identity.")
      }

      await expect(
        admitAdminConnectedAppFirecrawlRequest({
          correlationId: "scrape-lease-1",
          identity: resolution.identity,
          operation: "scrape",
        }),
      ).resolves.toMatchObject({ ok: true })

      vi.advanceTimersByTime(59_999)
      await expect(
        admitAdminConnectedAppFirecrawlRequest({
          correlationId: "scrape-lease-2",
          identity: resolution.identity,
          operation: "scrape",
        }),
      ).resolves.toEqual({ ok: false, reason: "concurrency_limited" })

      vi.advanceTimersByTime(1)
      await expect(
        admitAdminConnectedAppFirecrawlRequest({
          correlationId: "scrape-lease-3",
          identity: resolution.identity,
          operation: "scrape",
        }),
      ).resolves.toMatchObject({ ok: true })
    } finally {
      vi.useRealTimers()
    }
  })

  it("keeps parent re-enable default off and revokes all keys on parent delete", async () => {
    const enabled = await createEnabled("app-1")
    if (!enabled.credential) {
      throw new Error("Expected a Firecrawl key.")
    }
    await disableAdminConnectedAppFirecrawlForParent(actor, "app-1")
    await markAdminConnectedAppFirecrawlParentEnabled("app-1")

    await expect(
      getAdminConnectedAppFirecrawlProjection("app-1"),
    ).resolves.toMatchObject({ status: "disabled" })
    await deleteAdminConnectedAppFirecrawlForParent(actor, "app-1")
    await expect(
      getAdminConnectedAppFirecrawlProjection("app-1"),
    ).resolves.toBeNull()
    await expect(
      resolveAdminConnectedAppFirecrawlCredential(enabled.credential.apiKey),
    ).resolves.toEqual({ ok: false, reason: "invalid" })
  })

  it("audits the active credential revoked by parent deletion", async () => {
    const enabled = await createEnabled("app-1")
    if (!enabled.credential) {
      throw new Error("Expected a Firecrawl key.")
    }

    await deleteAdminConnectedAppFirecrawlForParent(actor, "app-1")

    expect(getAuditEventsForTest()).toContainEqual(
      expect.objectContaining({
        action: "lifecycle.application.firecrawl_revoked",
        applicationId: "app-1",
        credentialRecordId: enabled.credential.credentialId,
        keycloakSubjectId: actor.subject,
      }),
    )
  })

  it("revoking the active Firecrawl key disables access", async () => {
    const enabled = await createEnabled("app-1")
    if (!enabled.credential) {
      throw new Error("Expected a Firecrawl key.")
    }
    const result = await revokeAdminConnectedAppFirecrawlCredential(
      actor,
      "app-1",
      enabled.credential.credentialId,
    )
    expect(result).toMatchObject({
      firecrawl: { status: "disabled" },
      status: "revoked",
    })
    await expect(
      enableAdminConnectedAppFirecrawl(
        actor,
        "app-1",
        enableRequest(),
        identityContext("firecrawl.enable-again"),
      ),
    ).resolves.toEqual({
      detail:
        "This Key's Firecrawl credential is no longer active. Create a new Key to use Firecrawl again.",
      status: "blocked",
    })
    await expect(
      getAdminConnectedAppFirecrawlProjection("app-1"),
    ).resolves.toMatchObject({
      credentials: [
        expect.objectContaining({
          id: enabled.credential.credentialId,
          status: "revoked",
        }),
      ],
      status: "disabled",
    })
  })
})

describe("Firecrawl appliance readiness preflight", () => {
  beforeEach(() => {
    configureReadyFirecrawl()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("requires the reconciled volatile allowlist directory", () => {
    vi.stubEnv("FIRECRAWL_EGRESS_ALLOWLIST_DIR", "/var/lib/firecrawl/allowlist")
    expect(preflightAdminConnectedAppFirecrawlReadiness()).toEqual({
      detail: "The volatile Firecrawl egress allowlist directory is invalid.",
      status: "blocked",
    })
  })

  it("requires the private Firecrawl service origin for upstream traffic", () => {
    vi.stubEnv("FIRECRAWL_UPSTREAM_BASE_URL", "https://firecrawl.example.test")
    expect(preflightAdminConnectedAppFirecrawlReadiness()).toEqual({
      detail: "The Firecrawl internal upstream URL is missing or invalid.",
      status: "blocked",
    })
  })

  it("rejects public loopback and URL credentials in production", () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("PRODUCT_FIRECRAWL_HOST", "firecrawl.example.test")
    vi.stubEnv("FIRECRAWL_PUBLIC_BASE_URL", "http://127.0.0.1:4001")
    expect(preflightAdminConnectedAppFirecrawlReadiness()).toMatchObject({
      detail: expect.stringMatching(/public base URL/),
      status: "blocked",
    })
    vi.stubEnv(
      "FIRECRAWL_PUBLIC_BASE_URL",
      "https://operator:secret@bff.example.test",
    )
    expect(preflightAdminConnectedAppFirecrawlReadiness()).toMatchObject({
      status: "blocked",
    })
  })

  it("requires HTTPS for every non-loopback public Firecrawl URL", () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("FIRECRAWL_PUBLIC_BASE_URL", "http://bff.example.test")

    expect(preflightAdminConnectedAppFirecrawlReadiness()).toEqual({
      detail: "The Firecrawl public base URL is missing or invalid.",
      status: "blocked",
    })
  })

  it("rejects IPv4-mapped IPv6 loopback in production", () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("PRODUCT_FIRECRAWL_HOST", "firecrawl.example.test")
    vi.stubEnv("FIRECRAWL_PUBLIC_BASE_URL", "http://[::ffff:127.0.0.1]:4001")
    expect(preflightAdminConnectedAppFirecrawlReadiness()).toMatchObject({
      detail: expect.stringMatching(/public base URL/),
      status: "blocked",
    })
  })

  it("binds the public URL to the Product Firecrawl authority", () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("PRODUCT_FIRECRAWL_HOST", "firecrawl.example.test")
    vi.stubEnv("FIRECRAWL_PUBLIC_BASE_URL", "https://other.example.test")

    expect(preflightAdminConnectedAppFirecrawlReadiness()).toEqual({
      detail:
        "The Firecrawl public base URL does not match the Product Firecrawl authority.",
      status: "blocked",
    })
  })

  it("rejects a nondefault public Firecrawl port", () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("PRODUCT_FIRECRAWL_HOST", "firecrawl.example.test")
    vi.stubEnv(
      "FIRECRAWL_PUBLIC_BASE_URL",
      "https://firecrawl.example.test:8443",
    )

    expect(preflightAdminConnectedAppFirecrawlReadiness()).toMatchObject({
      detail: expect.stringMatching(/public base URL/),
      status: "blocked",
    })
  })

  it("requires the Product Firecrawl authority in production", () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("PRODUCT_FIRECRAWL_HOST", "")
    vi.stubEnv("FIRECRAWL_PUBLIC_BASE_URL", "https://firecrawl.example.test")

    expect(preflightAdminConnectedAppFirecrawlReadiness()).toMatchObject({
      detail: expect.stringMatching(/Product Firecrawl authority/),
      status: "blocked",
    })
  })
})

function configureReadyFirecrawl(): void {
  vi.stubEnv("FIRECRAWL_INSTALLED", "true")
  vi.stubEnv("FIRECRAWL_APPLIANCE_KILL_SWITCH", "false")
  vi.stubEnv("FIRECRAWL_RESOURCE_PROFILE_QUALIFIED", "true")
  vi.stubEnv("FIRECRAWL_EGRESS_POLICY_READY", "true")
  vi.stubEnv("FIRECRAWL_PUBLIC_BASE_URL", "https://bff.example.test")
  vi.stubEnv("FIRECRAWL_UPSTREAM_BASE_URL", "http://firecrawl-api:3002")
  vi.stubEnv("FIRECRAWL_EGRESS_ALLOWED_HOSTS", "example.test")
  vi.stubEnv(
    "FIRECRAWL_EGRESS_ALLOWLIST_DIR",
    "/run/llm-machines/firecrawl/egress-allowlist",
  )
}

function enableRequest(
  overrides: Partial<AdminConnectedAppFirecrawlEnableRequest> = {},
): AdminConnectedAppFirecrawlEnableRequest {
  return {
    disclaimerAccepted: true as const,
    maxConcurrentScrapes: null,
    scrapeRateLimitRps: null,
    searchRateLimitRps: null,
    ...overrides,
  }
}

function identityContext(
  operationCode: string,
  commitWithReceipt: NonNullable<
    IdentityMutationRouteContext["commitWithReceipt"]
  > = async <T>(input: {
    resourceId: string | null
    run(transaction: null): Promise<T>
  }) => input.run(null),
): IdentityMutationRouteContext {
  return {
    commitWithReceipt,
    finalizeReceipt: async () => undefined,
    idempotencyLedgerId: randomUUID(),
    operationCode,
    requestFingerprint: randomUUID(),
  }
}

async function createEnabled(
  applicationId: string,
  request: AdminConnectedAppFirecrawlEnableRequest = enableRequest(),
) {
  await initializeAdminConnectedAppFirecrawlForParent(actor, applicationId)
  const result = await enableAdminConnectedAppFirecrawl(
    actor,
    applicationId,
    request,
    identityContext("firecrawl.enable"),
  )
  if (result.status !== "enabled") {
    throw new Error("Firecrawl fixture could not be enabled.")
  }
  return result
}
