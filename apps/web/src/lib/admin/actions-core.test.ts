import type {
  AdminConnectedApp,
  AdminConnectedAppFirecrawlCredential,
} from "@llm-machines/contracts/inference-core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  checkAdminConnectedAppConnectionAction,
  checkAdminConnectedAppFirecrawlConnectionAction,
  createAdminConnectedAppAction,
  disableAdminConnectedAppFirecrawlAction,
  enableAdminConnectedAppFirecrawlAction,
  revokeAdminConnectedAppCredentialAction,
  revokeAdminConnectedAppFirecrawlCredentialAction,
  rotateAdminConnectedAppFirecrawlCredentialAction,
  softDeleteAdminConnectedAppAction,
  updateAdminConnectedAppFirecrawlPolicyAction,
  updateAdminConnectedAppPolicyAction,
} from "./actions-core"

const connectedApp: AdminConnectedApp = {
  allowedModels: ["local-model"],
  auditHref: "/activity?app=app-1",
  authMethod: "api_key",
  connectionStatus: "not_connected",
  createdAt: "2026-07-31T08:00:00.000Z",
  credentials: [
    {
      authMethod: "api_key",
      clientId: null,
      id: "credential-1",
      issuedAt: "2026-07-31T08:00:00.000Z",
      keyPrefix: "llmm_t4_test",
      lastUsedAt: null,
      overlapExpiresAt: null,
      revokedAt: null,
      rotatedAt: null,
      status: "active",
    },
  ],
  description: "Retained connected application test fixture.",
  detailHref: "/applications/apps/app-1",
  firecrawl: {
    connectionStatus: "not_connected",
    credentials: [],
    disclaimerAcceptedAt: null,
    disclaimerVersion: null,
    lastConnectedAt: null,
    maxConcurrentScrapes: null,
    scrapeRateLimitRps: null,
    searchRateLimitRps: null,
    status: "disabled",
  },
  id: "app-1",
  lastConnectedAt: null,
  maxConcurrentRequests: null,
  maxContextBytes: null,
  name: "Retained App",
  rateLimitRps: null,
  status: "enabled",
  tokenAlertState: null,
  tokenAlertThreshold7d: null,
  updatedAt: "2026-07-31T08:00:00.000Z",
  usage: {
    failures7d: 0,
    lastUsedAt: null,
    requests7d: 0,
    tokens7d: 0,
  },
}

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  getBffRequest: vi.fn(),
  redirect: vi.fn((href: string) => {
    throw new Error(`redirect:${href}`)
  }),
  revalidatePath: vi.fn(),
}))

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}))

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}))

vi.mock("@/lib/auth/auth", () => ({
  auth: mocks.auth,
}))

vi.mock("@/lib/bff/server-request", () => ({
  getBffRequest: mocks.getBffRequest,
}))

describe("inference-core Admin actions", () => {
  beforeEach(() => {
    mocks.auth.mockResolvedValue({
      user: {
        email: "operator@example.test",
        groups: ["Operators"],
        id: "operator-1",
        roles: ["operator"],
      },
    })
    mocks.getBffRequest.mockResolvedValue({
      baseUrl: "http://bff.test",
      headers: new Headers({ authorization: "Bearer operator" }),
    })
    mocks.redirect.mockClear()
    mocks.revalidatePath.mockClear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("allows an operator to refresh passive connection evidence", async () => {
    const app = connectedApp
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              app,
              connectionStatus: "not_connected",
              detail: "Waiting for a real client GET /models request.",
              observedAt: null,
              status: "waiting",
            }),
            {
              headers: { "Content-Type": "application/json" },
              status: 200,
            },
          ),
      ) as unknown as typeof fetch,
    )
    const formData = new FormData()
    formData.set("appId", app.id)

    await expect(
      checkAdminConnectedAppConnectionAction(
        {
          app: null,
          detail: null,
          error: null,
          observedAt: null,
          status: "idle",
        },
        formData,
      ),
    ).resolves.toMatchObject({
      app: { id: app.id },
      status: "waiting",
    })
    expect(fetch).toHaveBeenCalledWith(
      `http://bff.test/api/admin/applications/connected-apps/${app.id}/test`,
      expect.objectContaining({ method: "POST" }),
    )
  })

  it("lets an Admin enable Firecrawl with explicit consent and optional protections", async () => {
    mocks.auth.mockResolvedValue({
      user: { id: "admin-1", roles: ["admin"] },
    })
    const fetchSpy = vi.fn(async () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            app: firecrawlEnabledApp,
            credential: firecrawlReveal,
            detail: "Firecrawl enabled with a separate credential.",
            status: "enabled",
          }),
          { headers: { "Content-Type": "application/json" }, status: 200 },
        ),
      ),
    )
    vi.stubGlobal("fetch", fetchSpy as unknown as typeof fetch)
    const formData = new FormData()
    formData.set("appId", connectedApp.id)
    formData.set("disclaimerAccepted", "on")
    formData.set("firecrawlSearchRateLimitRpsEnabled", "on")
    formData.set("firecrawlSearchRateLimitRps", "12")
    formData.set("firecrawlScrapeRateLimitRps", "99")
    formData.set("firecrawlMaxConcurrentScrapesEnabled", "on")
    formData.set("firecrawlMaxConcurrentScrapes", "4")

    await expect(
      enableAdminConnectedAppFirecrawlAction(
        {
          app: null,
          credential: null,
          detail: null,
          error: null,
          status: "idle",
        },
        formData,
      ),
    ).resolves.toMatchObject({
      app: { firecrawl: { status: "enabled" } },
      credential: { apiKey: firecrawlReveal.apiKey },
      status: "enabled",
    })
    expect(fetchSpy).toHaveBeenCalledWith(
      `http://bff.test/api/admin/applications/connected-apps/${connectedApp.id}/firecrawl/enable`,
      expect.objectContaining({
        body: JSON.stringify({
          disclaimerAccepted: true,
          maxConcurrentScrapes: 4,
          scrapeRateLimitRps: null,
          searchRateLimitRps: 12,
        }),
        method: "POST",
      }),
    )
  })

  it("denies Firecrawl enablement to an Operator before any BFF call", async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal("fetch", fetchSpy as unknown as typeof fetch)
    const formData = new FormData()
    formData.set("appId", connectedApp.id)
    formData.set("disclaimerAccepted", "on")

    await expect(
      enableAdminConnectedAppFirecrawlAction(
        {
          app: null,
          credential: null,
          detail: null,
          error: null,
          status: "idle",
        },
        formData,
      ),
    ).rejects.toThrow("Authorized Console session required.")
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("lets an Operator refresh passive Firecrawl connection evidence", async () => {
    const observedAt = "2026-07-31T09:00:00.000Z"
    const firecrawlConnectedApp = {
      ...firecrawlEnabledApp,
      firecrawl: {
        ...firecrawlEnabledApp.firecrawl,
        connectionStatus: "connected",
        lastConnectedAt: observedAt,
      },
    } satisfies AdminConnectedApp
    const fetchSpy = vi.fn(async () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            app: firecrawlConnectedApp,
            connectionStatus: "connected",
            detail: "Observed a third-party /v2/search or /v2/scrape request.",
            observedAt,
            status: "passed",
          }),
          { headers: { "Content-Type": "application/json" }, status: 200 },
        ),
      ),
    )
    vi.stubGlobal("fetch", fetchSpy as unknown as typeof fetch)
    const formData = new FormData()
    formData.set("appId", connectedApp.id)

    await expect(
      checkAdminConnectedAppFirecrawlConnectionAction(
        {
          app: null,
          detail: null,
          error: null,
          observedAt: null,
          status: "idle",
        },
        formData,
      ),
    ).resolves.toMatchObject({ observedAt, status: "passed" })
    expect(fetchSpy).toHaveBeenCalledWith(
      `http://bff.test/api/admin/applications/connected-apps/${connectedApp.id}/firecrawl/test`,
      expect.objectContaining({ method: "POST" }),
    )
  })

  it("lets an Operator rotate, revoke, and disable Firecrawl without changing policy", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            app: firecrawlEnabledApp,
            credential: firecrawlReveal,
            detail: "Firecrawl credential rotated.",
            status: "rotated",
          }),
          { headers: { "Content-Type": "application/json" }, status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            app: firecrawlEnabledApp,
            detail: "Firecrawl credential revoked.",
            status: "revoked",
          }),
          { headers: { "Content-Type": "application/json" }, status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            app: connectedApp,
            detail: "Firecrawl disabled.",
            status: "disabled",
          }),
          { headers: { "Content-Type": "application/json" }, status: 200 },
        ),
      )
    vi.stubGlobal("fetch", fetchSpy as unknown as typeof fetch)
    const appFormData = new FormData()
    appFormData.set("appId", connectedApp.id)

    await expect(
      rotateAdminConnectedAppFirecrawlCredentialAction(
        {
          app: null,
          credential: null,
          detail: null,
          error: null,
          status: "idle",
        },
        appFormData,
      ),
    ).resolves.toMatchObject({ status: "rotated" })

    const revokeFormData = new FormData()
    revokeFormData.set("appId", connectedApp.id)
    revokeFormData.set("credentialId", "firecrawl/credential")
    await expect(
      revokeAdminConnectedAppFirecrawlCredentialAction(
        {
          app: null,
          detail: null,
          error: null,
          status: "idle",
        },
        revokeFormData,
      ),
    ).resolves.toMatchObject({ status: "revoked" })
    await expect(
      disableAdminConnectedAppFirecrawlAction(
        {
          app: null,
          detail: null,
          error: null,
          status: "idle",
        },
        appFormData,
      ),
    ).resolves.toMatchObject({ status: "disabled" })

    expect(fetchSpy).toHaveBeenNthCalledWith(
      1,
      `http://bff.test/api/admin/applications/connected-apps/${connectedApp.id}/firecrawl/rotate-credentials`,
      expect.objectContaining({ method: "POST" }),
    )
    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      `http://bff.test/api/admin/applications/connected-apps/${connectedApp.id}/firecrawl/credentials/firecrawl%2Fcredential/revoke`,
      expect.objectContaining({ method: "POST" }),
    )
    expect(fetchSpy).toHaveBeenNthCalledWith(
      3,
      `http://bff.test/api/admin/applications/connected-apps/${connectedApp.id}/firecrawl/disable`,
      expect.objectContaining({ method: "POST" }),
    )
  })

  it("submits Firecrawl policy limits only from an Admin surface", async () => {
    mocks.auth.mockResolvedValue({
      user: { id: "admin-1", roles: ["admin"] },
    })
    const fetchSpy = vi.fn(async () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            app: firecrawlEnabledApp,
            detail: "Firecrawl policy updated.",
            status: "updated",
          }),
          { headers: { "Content-Type": "application/json" }, status: 200 },
        ),
      ),
    )
    vi.stubGlobal("fetch", fetchSpy as unknown as typeof fetch)
    const formData = new FormData()
    formData.set("appId", connectedApp.id)
    formData.set("firecrawlSearchRateLimitRpsEnabled", "on")
    formData.set("firecrawlSearchRateLimitRps", "20")
    formData.set("firecrawlScrapeRateLimitRpsEnabled", "on")
    formData.set("firecrawlScrapeRateLimitRps", "7")

    await expect(
      updateAdminConnectedAppFirecrawlPolicyAction(formData),
    ).rejects.toThrow(
      `redirect:/applications/apps/${connectedApp.id}?appAction=firecrawlUpdated`,
    )
    expect(fetchSpy).toHaveBeenCalledWith(
      `http://bff.test/api/admin/applications/connected-apps/${connectedApp.id}/firecrawl`,
      expect.objectContaining({
        body: JSON.stringify({
          maxConcurrentScrapes: null,
          scrapeRateLimitRps: 7,
          searchRateLimitRps: 20,
        }),
        method: "PATCH",
      }),
    )
  })

  it("denies application creation to an operator before any BFF call", async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal("fetch", fetchSpy as unknown as typeof fetch)
    const formData = new FormData()
    formData.set("name", "Operator-created app")
    formData.set("description", "Must remain blocked.")
    formData.append("allowedModels", "model-1")

    await expect(
      createAdminConnectedAppAction(
        {
          app: null,
          credential: null,
          error: null,
          status: "idle",
        },
        formData,
      ),
    ).rejects.toThrow("Authorized Console session required.")
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("allows an operator to revoke an exact credential", async () => {
    const fetchSpy = vi.fn(async () =>
      Promise.resolve(
        new Response(JSON.stringify(connectedApp), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        }),
      ),
    )
    vi.stubGlobal("fetch", fetchSpy as unknown as typeof fetch)
    const formData = new FormData()
    formData.set("appId", connectedApp.id)
    formData.set("credentialId", "credential/one")

    await expect(
      revokeAdminConnectedAppCredentialAction(
        {
          app: null,
          credential: null,
          detail: null,
          error: null,
          status: "idle",
        },
        formData,
      ),
    ).resolves.toMatchObject({ status: "revoked" })
    expect(fetchSpy).toHaveBeenCalledWith(
      `http://bff.test/api/admin/applications/connected-apps/${connectedApp.id}/credentials/credential%2Fone/revoke`,
      expect.objectContaining({ method: "POST" }),
    )
  })

  it("submits stable aliases and null disabled limits in an Admin policy update", async () => {
    mocks.auth.mockResolvedValue({
      user: { id: "admin-1", roles: ["admin"] },
    })
    const fetchSpy = vi.fn(async () =>
      Promise.resolve(
        new Response(JSON.stringify(connectedApp), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        }),
      ),
    )
    vi.stubGlobal("fetch", fetchSpy as unknown as typeof fetch)
    const formData = new FormData()
    formData.set("appId", connectedApp.id)
    formData.set("name", "Updated Application")
    formData.set("description", "Updated policy")
    formData.append("allowedModels", "stable-alias")

    await expect(updateAdminConnectedAppPolicyAction(formData)).rejects.toThrow(
      `redirect:/applications/apps/${connectedApp.id}?appAction=updated`,
    )
    expect(fetchSpy).toHaveBeenCalledWith(
      `http://bff.test/api/admin/applications/connected-apps/${connectedApp.id}`,
      expect.objectContaining({
        body: JSON.stringify({
          allowedModels: ["stable-alias"],
          description: "Updated policy",
          maxConcurrentRequests: null,
          maxContextBytes: null,
          name: "Updated Application",
          rateLimitRps: null,
          tokenAlertThreshold7d: null,
        }),
        method: "PATCH",
      }),
    )
  })

  it("submits enabled service protections and the non-blocking token threshold", async () => {
    mocks.auth.mockResolvedValue({
      user: { id: "admin-1", roles: ["admin"] },
    })
    const fetchSpy = vi.fn(async () =>
      Promise.resolve(
        new Response(JSON.stringify(connectedApp), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        }),
      ),
    )
    vi.stubGlobal("fetch", fetchSpy as unknown as typeof fetch)
    const formData = new FormData()
    formData.set("appId", connectedApp.id)
    formData.set("name", "Protected Application")
    formData.set("description", "Explicit service protections")
    formData.append("allowedModels", "stable-alias")
    formData.set("rateLimitRpsEnabled", "on")
    formData.set("rateLimitRps", "25")
    formData.set("maxConcurrentRequestsEnabled", "on")
    formData.set("maxConcurrentRequests", "8")
    formData.set("maxContextBytesEnabled", "on")
    formData.set("maxContextBytes", "65536")
    formData.set("tokenAlertThreshold7dEnabled", "on")
    formData.set("tokenAlertThreshold7d", "1000000")

    await expect(updateAdminConnectedAppPolicyAction(formData)).rejects.toThrow(
      `redirect:/applications/apps/${connectedApp.id}?appAction=updated`,
    )
    expect(fetchSpy).toHaveBeenCalledWith(
      `http://bff.test/api/admin/applications/connected-apps/${connectedApp.id}`,
      expect.objectContaining({
        body: JSON.stringify({
          allowedModels: ["stable-alias"],
          description: "Explicit service protections",
          maxConcurrentRequests: 8,
          maxContextBytes: 65_536,
          name: "Protected Application",
          rateLimitRps: 25,
          tokenAlertThreshold7d: 1_000_000,
        }),
        method: "PATCH",
      }),
    )
  })

  it("rejects a context byte maximum outside JavaScript's safe integer range", async () => {
    mocks.auth.mockResolvedValue({
      user: { id: "admin-1", roles: ["admin"] },
    })
    const fetchSpy = vi.fn()
    vi.stubGlobal("fetch", fetchSpy as unknown as typeof fetch)
    const formData = new FormData()
    formData.set("appId", connectedApp.id)
    formData.set("name", "Unsafe context application")
    formData.set("description", "Must fail before the BFF call")
    formData.append("allowedModels", "stable-alias")
    formData.set("maxContextBytesEnabled", "on")
    formData.set("maxContextBytes", "9007199254740992")

    await expect(updateAdminConnectedAppPolicyAction(formData)).rejects.toThrow(
      `redirect:/applications/apps/${connectedApp.id}?appAction=invalid`,
    )
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("requires Admin authority and exact confirmation for soft deletion", async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal("fetch", fetchSpy as unknown as typeof fetch)
    const formData = new FormData()
    formData.set("appId", connectedApp.id)
    formData.set("confirmation", "DELETE APPLICATION")

    await expect(softDeleteAdminConnectedAppAction(formData)).rejects.toThrow(
      "Authorized Console session required.",
    )
    expect(fetchSpy).not.toHaveBeenCalled()

    mocks.auth.mockResolvedValue({
      user: { id: "admin-1", roles: ["admin"] },
    })
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({
          app: null,
          applicationId: connectedApp.id,
          detail: "Application deleted.",
          status: "deleted",
        }),
        { headers: { "Content-Type": "application/json" }, status: 200 },
      ),
    )

    await expect(softDeleteAdminConnectedAppAction(formData)).rejects.toThrow(
      "redirect:/applications?appAction=deleted",
    )
    expect(fetchSpy).toHaveBeenLastCalledWith(
      `http://bff.test/api/admin/applications/connected-apps/${connectedApp.id}`,
      expect.objectContaining({
        body: JSON.stringify({ confirmation: "DELETE APPLICATION" }),
        method: "DELETE",
      }),
    )
  })
})

const firecrawlEnabledApp = {
  ...connectedApp,
  firecrawl: {
    connectionStatus: "not_connected",
    credentials: [
      {
        id: "firecrawl-credential-active",
        issuedAt: "2026-07-31T08:00:00.000Z",
        keyPrefix: "llmm_fc_0123456789abcdef",
        lastUsedAt: null,
        overlapExpiresAt: null,
        revokedAt: null,
        rotatedAt: null,
        status: "active",
      },
    ],
    disclaimerAcceptedAt: "2026-07-31T08:00:00.000Z",
    disclaimerVersion: "2026-07-31",
    lastConnectedAt: null,
    maxConcurrentScrapes: 4,
    scrapeRateLimitRps: null,
    searchRateLimitRps: 12,
    status: "enabled",
  },
} satisfies AdminConnectedApp

const firecrawlReveal = {
  apiKey:
    "llmm_fc_0123456789abcdef_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ",
  credentialId: "firecrawl-credential-active",
  exampleCurl:
    'curl -H "Authorization: Bearer llmm_fc_0123456789abcdef_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ" https://bff.example.test/api/app-gateway/firecrawl/v2/search',
  firecrawlBaseUrl: "https://bff.example.test/api/app-gateway/firecrawl/v2",
  issuedAt: "2026-07-31T08:00:00.000Z",
  keyPrefix: "llmm_fc_0123456789abcdef",
} satisfies AdminConnectedAppFirecrawlCredential
