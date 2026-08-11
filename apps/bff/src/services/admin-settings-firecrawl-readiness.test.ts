import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Actor } from "../auth/authorization"
import {
  getAdminSettings,
  resetAdminSettingsCoreForTest,
} from "./admin-settings-core"
import { resetAuditEventsForTest } from "./audit"

const adminActor: Actor = {
  authMode: "service-forwarded",
  role: "admin",
  subject: "admin-1",
}

describe("Settings Firecrawl appliance readiness", () => {
  beforeEach(() => {
    for (const name of [
      "DATABASE_URL",
      "KEYCLOAK_ADMIN_BASE_URL",
      "KEYCLOAK_ADMIN_REALM",
      "KEYCLOAK_ADMIN_CLIENT_ID",
      "KEYCLOAK_ADMIN_CLIENT_SECRET",
      "ADMIN_LITELLM_BASE_URL",
      "ADMIN_LITELLM_API_KEY",
      "ADMIN_GRAFANA_BASE_URL",
      "ADMIN_PROMETHEUS_BASE_URL",
      "ADMIN_ALERTMANAGER_BASE_URL",
      "LIFECYCLE_SERVICE_BASE_URL",
      "FIRECRAWL_INSTALLED",
      "FIRECRAWL_APPLIANCE_KILL_SWITCH",
      "FIRECRAWL_RESOURCE_PROFILE_QUALIFIED",
      "FIRECRAWL_EGRESS_POLICY_READY",
      "FIRECRAWL_PUBLIC_BASE_URL",
      "FIRECRAWL_UPSTREAM_BASE_URL",
      "FIRECRAWL_EGRESS_ALLOWED_HOSTS",
      "FIRECRAWL_EGRESS_ALLOWLIST_DIR",
      "FIRECRAWL_ENABLED",
      "FIRECRAWL_API_URL",
      "PRE_GENESIS_FIRECRAWL_ACTUAL",
      "PRE_GENESIS_FIRECRAWL_UPSTREAM_BASE_URL",
    ]) {
      vi.stubEnv(name, "")
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    resetAdminSettingsCoreForTest()
    resetAuditEventsForTest()
  })

  it("does not treat the legacy global flag as installation or customer policy", async () => {
    vi.stubEnv("FIRECRAWL_ENABLED", "true")
    vi.stubEnv("FIRECRAWL_API_URL", "https://legacy-firecrawl.example.test")
    const fetchSpy = vi.fn()
    vi.stubGlobal("fetch", fetchSpy)

    await expect(firecrawlReachability()).resolves.toMatchObject({
      detail: "Firecrawl is not installed on this appliance.",
      lastCheckedAt: null,
      status: "not_configured",
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it.each([
    {
      envName: "FIRECRAWL_APPLIANCE_KILL_SWITCH",
      label: "active kill switch",
      value: "true",
      detail: /kill switch is active/,
    },
    {
      envName: "FIRECRAWL_RESOURCE_PROFILE_QUALIFIED",
      label: "unqualified resource profile",
      value: "false",
      detail: /resource profile is not qualified/,
    },
    {
      envName: "FIRECRAWL_EGRESS_POLICY_READY",
      label: "unready egress policy",
      value: "false",
      detail: /egress policy is not ready/,
    },
    {
      envName: "FIRECRAWL_EGRESS_ALLOWED_HOSTS",
      label: "invalid exact-host allowlist",
      value: "*.example.test",
      detail: /exact-host egress allowlist is missing or invalid/,
    },
    {
      envName: "FIRECRAWL_EGRESS_ALLOWLIST_DIR",
      label: "non-volatile allowlist directory",
      value: "/var/lib/firecrawl/allowlist",
      detail: /volatile egress allowlist directory is missing or invalid/,
    },
  ])("fails closed for an $label", async ({ envName, value, detail }) => {
    configureReadyFirecrawl()
    vi.stubEnv(envName, value)
    const fetchSpy = vi.fn()
    vi.stubGlobal("fetch", fetchSpy)

    const firecrawl = await firecrawlReachability()

    expect(firecrawl).toMatchObject({ status: "unavailable" })
    expect(firecrawl.detail).toMatch(detail)
    expect(firecrawl.lastCheckedAt).not.toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("reports availability only after private liveness and readiness GETs pass", async () => {
    configureReadyFirecrawl()
    const fetchSpy = vi.fn(
      async (..._args: Parameters<typeof fetch>): Promise<Response> =>
        new Response("health detail that must not be retained"),
    )
    vi.stubGlobal("fetch", fetchSpy)

    await expect(firecrawlReachability()).resolves.toMatchObject({
      detail:
        "Firecrawl is installed and available; internal liveness and readiness checks passed.",
      status: "ok",
    })
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(
      fetchSpy.mock.calls.map(([input]) => input.toString()).sort(),
    ).toEqual([
      "http://firecrawl-api:3002/v0/health/liveness",
      "http://firecrawl-api:3002/v0/health/readiness",
    ])
    for (const [, init] of fetchSpy.mock.calls) {
      expect(init).toMatchObject({ method: "GET", redirect: "error" })
      expect(init?.body).toBeUndefined()
    }
  })

  it("probes the actual loopback Firecrawl bridge only in the pre-Genesis test lane", async () => {
    configureReadyFirecrawl()
    vi.stubEnv("PRE_GENESIS_FIRECRAWL_ACTUAL", "true")
    vi.stubEnv(
      "PRE_GENESIS_FIRECRAWL_UPSTREAM_BASE_URL",
      "http://127.0.0.1:43123",
    )
    const fetchSpy = vi.fn(
      async (..._args: Parameters<typeof fetch>): Promise<Response> =>
        new Response(null, { status: 200 }),
    )
    vi.stubGlobal("fetch", fetchSpy)

    await expect(firecrawlReachability()).resolves.toMatchObject({
      status: "ok",
    })
    expect(
      fetchSpy.mock.calls.map(([input]) => input.toString()).sort(),
    ).toEqual([
      "http://127.0.0.1:43123/v0/health/liveness",
      "http://127.0.0.1:43123/v0/health/readiness",
    ])
  })

  it("ignores the pre-Genesis loopback override outside test mode", async () => {
    configureReadyFirecrawl()
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("PRE_GENESIS_FIRECRAWL_ACTUAL", "true")
    vi.stubEnv(
      "PRE_GENESIS_FIRECRAWL_UPSTREAM_BASE_URL",
      "http://127.0.0.1:43123",
    )
    const fetchSpy = vi.fn(
      async (..._args: Parameters<typeof fetch>): Promise<Response> =>
        new Response(null, { status: 200 }),
    )
    vi.stubGlobal("fetch", fetchSpy)

    await expect(firecrawlReachability()).resolves.toMatchObject({
      status: "ok",
    })
    expect(
      fetchSpy.mock.calls.map(([input]) => input.toString()).sort(),
    ).toEqual([
      "http://firecrawl-api:3002/v0/health/liveness",
      "http://firecrawl-api:3002/v0/health/readiness",
    ])
  })

  it.each([
    "http://localhost:43123",
    "http://127.0.0.1:80",
    "http://127.0.0.1:43123/internal",
    "http://127.0.0.1:43123?health=1",
    "https://127.0.0.1:43123",
  ])("rejects unsafe pre-Genesis Firecrawl probe URL %s", async (value) => {
    configureReadyFirecrawl()
    vi.stubEnv("PRE_GENESIS_FIRECRAWL_ACTUAL", "true")
    vi.stubEnv("PRE_GENESIS_FIRECRAWL_UPSTREAM_BASE_URL", value)
    const fetchSpy = vi.fn()
    vi.stubGlobal("fetch", fetchSpy)

    await expect(firecrawlReachability()).resolves.toMatchObject({
      status: "unavailable",
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it.each([
    {
      label: "embedded credentials",
      value: "https://operator:secret@firecrawl.example.test",
    },
    {
      label: "a non-HTTP scheme",
      value: "file:///tmp/firecrawl",
    },
    {
      label: "a query",
      value: "https://firecrawl.example.test?health=1",
    },
    {
      label: "a fragment",
      value: "https://firecrawl.example.test#health",
    },
    {
      label: "a non-root path",
      value: "https://firecrawl.example.test/internal",
    },
    {
      label: "the hosted Firecrawl API",
      value: "https://api.firecrawl.dev",
    },
    {
      label: "an ungoverned internal host",
      value: "http://firecrawl.invalid:3002",
    },
    {
      label: "the wrong private service port",
      value: "http://firecrawl-api:3003",
    },
  ])(
    "rejects an upstream base URL with $label before fetch",
    async ({ value }) => {
      configureReadyFirecrawl()
      vi.stubEnv("FIRECRAWL_UPSTREAM_BASE_URL", value)
      const fetchSpy = vi.fn()
      vi.stubGlobal("fetch", fetchSpy)

      await expect(firecrawlReachability()).resolves.toMatchObject({
        detail:
          "Firecrawl is installed but its internal upstream URL is missing or invalid.",
        status: "unavailable",
      })
      expect(fetchSpy).not.toHaveBeenCalled()
    },
  )

  it("reports an installed upstream as unavailable when either health check fails", async () => {
    configureReadyFirecrawl()
    const fetchSpy = vi
      .fn<(...args: Parameters<typeof fetch>) => Promise<Response>>()
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
    vi.stubGlobal("fetch", fetchSpy)

    await expect(firecrawlReachability()).resolves.toMatchObject({
      detail:
        "Firecrawl is installed but its internal liveness or readiness check did not pass.",
      status: "unavailable",
    })
    expect(fetchSpy).toHaveBeenCalledTimes(2)
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

async function firecrawlReachability() {
  const settings = await getAdminSettings(adminActor)
  const firecrawl = settings.reachability.find(
    (service) => service.id === "firecrawl",
  )
  if (!firecrawl) {
    throw new Error("Firecrawl reachability is missing from Settings.")
  }
  return firecrawl
}
