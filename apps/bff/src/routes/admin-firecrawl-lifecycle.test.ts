import { afterEach, describe, expect, it, vi } from "vitest"
import { buildServer } from "../index"
import { resetConnectedAppsForTest } from "../services/admin-connected-apps"
import * as firecrawlService from "../services/admin-connected-apps-firecrawl"
import {
  getAuditEventsForTest,
  resetAuditEventsForTest,
} from "../services/audit"
import { resetIdempotencyForTest } from "../services/idempotency"
import { resetIdentityMutationJournalForTest } from "../services/identity-mutation-journal"

const adminHeaders = identityHeaders("admin", "admin-1")
const operatorHeaders = identityHeaders("operator", "operator-1")

describe("Application Firecrawl admin routes", () => {
  afterEach(async () => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    resetIdentityMutationJournalForTest()
    resetIdempotencyForTest()
    resetAuditEventsForTest()
    await resetConnectedAppsForTest()
  })

  it("keeps access default off and enforces the reviewed role boundary", async () => {
    configureFixtureRuntime()
    const server = buildServer()
    const created = await createApplication(server, "firecrawl-app-create")
    const applicationId = created.app.id as string

    expect(created.app.firecrawl).toMatchObject({
      credentials: [],
      status: "disabled",
    })

    const operatorEnable = await mutate(server, {
      headers: operatorHeaders,
      idempotencyKey: "operator-enable-denied",
      method: "POST",
      payload: { disclaimerAccepted: true },
      url: `${applicationUrl(applicationId)}/firecrawl/enable`,
    })
    expect(operatorEnable.statusCode).toBe(403)

    const enabled = await mutate(server, {
      headers: adminHeaders,
      idempotencyKey: "admin-enable-firecrawl",
      method: "POST",
      payload: { disclaimerAccepted: true },
      url: `${applicationUrl(applicationId)}/firecrawl/enable`,
    })
    expect(enabled.statusCode).toBe(200)
    expect(enabled.headers["cache-control"]).toBe("no-store")
    expect(enabled.json()).toMatchObject({
      app: { firecrawl: { status: "enabled" } },
      credential: {
        apiKey: expect.stringMatching(/^llmm_fc_/),
        credentialId: expect.stringMatching(/^fck-/),
      },
      status: "enabled",
    })
    const revealedKey = enabled.json().credential.apiKey as string

    const enableReplay = await mutate(server, {
      headers: adminHeaders,
      idempotencyKey: "admin-enable-firecrawl",
      method: "POST",
      payload: { disclaimerAccepted: true },
      url: `${applicationUrl(applicationId)}/firecrawl/enable`,
    })
    expect(enableReplay.statusCode).toBe(200)
    expect(enableReplay.json()).toMatchObject({ status: "already_completed" })
    expect(enableReplay.body).not.toContain(revealedKey)

    for (const [headers, expectedStatus] of [
      [operatorHeaders, 403],
      [adminHeaders, 404],
    ] as const) {
      const retiredPolicy = await mutate(server, {
        headers,
        idempotencyKey: `retired-firecrawl-policy-${headers["x-llm-machines-user-roles"]}`,
        method: "PATCH",
        payload: {
          maxConcurrentScrapes: 2,
          scrapeRateLimitRps: null,
          searchRateLimitRps: null,
        },
        url: `${applicationUrl(applicationId)}/firecrawl`,
      })
      expect(retiredPolicy.statusCode).toBe(expectedStatus)
    }

    const passiveTest = await mutate(server, {
      headers: operatorHeaders,
      idempotencyKey: "operator-passive-test",
      method: "POST",
      url: `${applicationUrl(applicationId)}/firecrawl/test`,
    })
    expect(passiveTest.statusCode).toBe(403)

    const adminPassiveTest = await mutate(server, {
      headers: adminHeaders,
      idempotencyKey: "admin-passive-test",
      method: "POST",
      url: `${applicationUrl(applicationId)}/firecrawl/test`,
    })
    expect(adminPassiveTest.statusCode).toBe(200)
    expect(adminPassiveTest.json()).toMatchObject({
      connectionStatus: "not_connected",
      observedAt: null,
      status: "waiting",
    })

    for (const [headers, expectedStatus] of [
      [operatorHeaders, 403],
      [adminHeaders, 404],
    ] as const) {
      const retiredRotation = await mutate(server, {
        headers,
        idempotencyKey: `retired-firecrawl-rotation-${headers["x-llm-machines-user-roles"]}`,
        method: "POST",
        url: `${applicationUrl(applicationId)}/firecrawl/rotate-credentials`,
      })
      expect(retiredRotation.statusCode).toBe(expectedStatus)
    }

    const detail = await server.inject({
      headers: adminHeaders,
      method: "GET",
      url: applicationUrl(applicationId),
    })
    expect(detail.statusCode).toBe(200)
    expect(detail.body).not.toContain(revealedKey)
    expect(JSON.stringify(getAuditEventsForTest())).not.toContain(revealedKey)

    const operatorDisabled = await mutate(server, {
      headers: operatorHeaders,
      idempotencyKey: "operator-disable-firecrawl",
      method: "POST",
      url: `${applicationUrl(applicationId)}/firecrawl/disable`,
    })
    expect(operatorDisabled.statusCode).toBe(403)

    const disabled = await mutate(server, {
      headers: adminHeaders,
      idempotencyKey: "admin-disable-firecrawl",
      method: "POST",
      url: `${applicationUrl(applicationId)}/firecrawl/disable`,
    })
    expect(disabled.statusCode).toBe(200)
    expect(disabled.json()).toMatchObject({
      app: { firecrawl: { status: "disabled" } },
      status: "disabled",
    })
    await server.close()
  })

  it("durably replays a first-enable credential race as a failed receipt", async () => {
    configureFixtureRuntime()
    const server = buildServer()
    const created = await createApplication(server, "firecrawl-race-app-create")
    const applicationId = created.app.id as string
    const enableSpy = vi.spyOn(
      firecrawlService,
      "enableAdminConnectedAppFirecrawl",
    )
    enableSpy.mockRejectedValueOnce(
      new firecrawlService.AdminConnectedAppFirecrawlCredentialCommitRaceError({
        status: "not_found",
      }),
    )
    const request = {
      headers: adminHeaders,
      idempotencyKey: "firecrawl-commit-race-not-found",
      method: "POST" as const,
      payload: { disclaimerAccepted: true },
      url: `${applicationUrl(applicationId)}/firecrawl/enable`,
    }

    const first = await mutate(server, request)
    expect(first.statusCode).toBe(404)
    expect(first.json()).toMatchObject({
      status: 404,
      title: "Key not found",
    })

    const replay = await mutate(server, request)
    expect(replay.statusCode).toBe(404)
    expect(replay.json()).toEqual({
      correlationId: expect.any(String),
      outcome: "failed",
      resourceId: null,
      status: "already_completed",
    })
    expect(replay.body).not.toContain("apiKey")
    expect(replay.body).not.toContain("llmm_fc_")
    expect(enableSpy).toHaveBeenCalledOnce()
    await server.close()
  })

  it("does not silently re-enable Firecrawl with its parent Application", async () => {
    configureFixtureRuntime()
    const server = buildServer()
    const created = await createApplication(server, "parent-lifecycle-create")
    const applicationId = created.app.id as string

    expect(
      (
        await mutate(server, {
          headers: adminHeaders,
          idempotencyKey: "parent-lifecycle-firecrawl-enable",
          method: "POST",
          payload: { disclaimerAccepted: true },
          url: `${applicationUrl(applicationId)}/firecrawl/enable`,
        })
      ).statusCode,
    ).toBe(200)
    expect(
      (
        await mutate(server, {
          headers: adminHeaders,
          idempotencyKey: "parent-lifecycle-disable",
          method: "POST",
          url: `${applicationUrl(applicationId)}/disable`,
        })
      ).statusCode,
    ).toBe(200)
    expect(
      (
        await mutate(server, {
          headers: adminHeaders,
          idempotencyKey: "parent-lifecycle-enable",
          method: "POST",
          url: `${applicationUrl(applicationId)}/enable`,
        })
      ).statusCode,
    ).toBe(200)

    const detail = await server.inject({
      headers: adminHeaders,
      method: "GET",
      url: applicationUrl(applicationId),
    })
    expect(detail.statusCode).toBe(200)
    expect(detail.json()).toMatchObject({
      app: {
        firecrawl: { status: "disabled" },
        status: "enabled",
      },
    })
    await server.close()
  })
})

function configureFixtureRuntime(): void {
  vi.stubEnv("BFF_FIXTURE_MODE", "true")
  vi.stubEnv("BFF_FALLBACK_MODELS", "local-a")
  vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
  vi.stubEnv("CONNECTED_APPS_KEYCLOAK_FIXTURE", "true")
  vi.stubEnv("FIRECRAWL_INSTALLED", "true")
  vi.stubEnv("FIRECRAWL_APPLIANCE_KILL_SWITCH", "false")
  vi.stubEnv("FIRECRAWL_RESOURCE_PROFILE_QUALIFIED", "true")
  vi.stubEnv("FIRECRAWL_EGRESS_POLICY_READY", "true")
  vi.stubEnv("FIRECRAWL_PUBLIC_BASE_URL", "https://bff.example.test")
  vi.stubEnv("FIRECRAWL_UPSTREAM_BASE_URL", "http://firecrawl-api:3002")
  vi.stubEnv("FIRECRAWL_EGRESS_ALLOWED_HOSTS", "public.example")
  vi.stubEnv(
    "FIRECRAWL_EGRESS_ALLOWLIST_DIR",
    "/run/llm-machines/firecrawl/egress-allowlist",
  )
}

async function createApplication(
  server: ReturnType<typeof buildServer>,
  idempotencyKey: string,
) {
  const response = await server.inject({
    headers: { ...adminHeaders, "idempotency-key": idempotencyKey },
    method: "POST",
    payload: {
      allowedModels: ["local-a"],
      description: "Firecrawl lifecycle test.",
      name: "Firecrawl test",
    },
    url: "/api/admin/applications/connected-apps",
  })
  expect(response.statusCode).toBe(201)
  return response.json()
}

function mutate(
  server: ReturnType<typeof buildServer>,
  request: {
    headers: Record<string, string>
    idempotencyKey: string
    method: "PATCH" | "POST"
    payload?: Record<string, unknown>
    url: string
  },
) {
  return server.inject({
    headers: {
      ...request.headers,
      "idempotency-key": request.idempotencyKey,
    },
    method: request.method,
    payload: request.payload,
    url: request.url,
  })
}

function applicationUrl(applicationId: string): string {
  return `/api/admin/applications/connected-apps/${applicationId}`
}

function identityHeaders(role: "admin" | "operator", subject: string) {
  return {
    authorization: "Bearer test-service-key",
    "x-llm-machines-keycloak-token": "",
    "x-llm-machines-user-email": `${subject}@example.test`,
    "x-llm-machines-user-roles": role,
    "x-llm-machines-user-sub": subject,
  }
}
