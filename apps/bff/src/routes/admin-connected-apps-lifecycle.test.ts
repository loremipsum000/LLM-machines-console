import { afterEach, describe, expect, it, vi } from "vitest"
import { buildServer } from "../index"
import { resetConnectedAppsForTest } from "../services/admin-connected-apps"
import {
  getAuditEventsForTest,
  resetAuditEventsForTest,
} from "../services/audit"
import { resetIdempotencyForTest } from "../services/idempotency"
import { resetIdentityMutationJournalForTest } from "../services/identity-mutation-journal"

const adminHeaders = identityHeaders("admin", "admin-1")
const operatorHeaders = identityHeaders("operator", "operator-1")

describe("Application admin lifecycle routes", () => {
  afterEach(async () => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.useRealTimers()
    resetIdentityMutationJournalForTest()
    resetIdempotencyForTest()
    resetAuditEventsForTest()
    await resetConnectedAppsForTest()
  })

  it("defaults create to a static credential and reveals its secret only in a no-store response", async () => {
    configureFixtureRuntime()
    const server = buildServer()
    const created = await createApplication(server, "create-default-static")

    expect(created.response.statusCode).toBe(201)
    expect(created.response.headers["cache-control"]).toBe("no-store")
    expect(created.body).toMatchObject({
      app: {
        authMethod: "api_key",
        connectionStatus: "not_connected",
        status: "enabled",
      },
      credential: {
        apiKey: expect.stringMatching(/^llmm_t4_/),
        authMethod: "api_key",
        credentialId: expect.stringMatching(/^cak-/),
      },
      status: "created",
    })
    const secret = created.body.credential.apiKey as string

    const detail = await server.inject({
      method: "GET",
      url: `/api/admin/applications/connected-apps/${created.body.app.id}`,
      headers: adminHeaders,
    })
    expect(detail.statusCode).toBe(200)
    expect(detail.body).not.toContain(secret)
    expect(JSON.stringify(getAuditEventsForTest())).not.toContain(secret)

    vi.stubEnv("CONNECTED_APPS_BFF_BASE_URL", "ftp://invalid.example.test")
    const replay = await server.inject({
      method: "POST",
      url: "/api/admin/applications/connected-apps",
      headers: {
        ...adminHeaders,
        "idempotency-key": "create-default-static",
      },
      payload: applicationPayload(),
    })
    expect(replay.statusCode).toBe(201)
    expect(replay.headers["cache-control"]).toBe("no-store")
    expectSafeReplay(replay, created.body.app.id as string, [secret])
    expect(replay.body).not.toContain(secret)
    await server.close()
  })

  it("admits Manual aliases only from an available approved inventory", async () => {
    configureFixtureRuntime()
    vi.stubEnv("ADMIN_LITELLM_BASE_URL", "http://litellm.test")
    vi.stubEnv("ADMIN_LITELLM_API_KEY", "admin-read-key")
    const modelInventory = vi.fn(() =>
      Response.json({ data: [{ model_name: "local-a" }] }),
    )
    vi.stubGlobal(
      "fetch",
      vi.fn((input) => {
        const path = new URL(input.toString()).pathname
        if (path === "/model/info") return Promise.resolve(modelInventory())
        if (path === "/user/daily/activity/aggregated") {
          return Promise.resolve(
            Response.json({
              metadata: { total_api_requests: 0, total_tokens: 0 },
              results: [],
            }),
          )
        }
        if (path === "/key/list") {
          return Promise.resolve(
            Response.json({
              current_page: 1,
              keys: [],
              total_count: 0,
              total_pages: 0,
            }),
          )
        }
        return Promise.resolve(Response.json({ data: [] }))
      }),
    )
    const server = buildServer()

    const valid = await server.inject({
      method: "POST",
      url: "/api/admin/applications/connected-apps",
      headers: { ...adminHeaders, "idempotency-key": "manual-valid" },
      payload: {
        ...applicationPayload(),
        allowedModels: ["local-a"],
        modelMode: "manual",
        name: "Manual Valid",
      },
    })
    expect(valid.statusCode).toBe(201)

    const invalid = await server.inject({
      method: "POST",
      url: "/api/admin/applications/connected-apps",
      headers: { ...adminHeaders, "idempotency-key": "manual-invalid" },
      payload: {
        ...applicationPayload(),
        allowedModels: ["not-approved"],
        modelMode: "manual",
        name: "Manual Invalid",
      },
    })
    expect(invalid.statusCode).toBe(400)
    expect(invalid.json()).toMatchObject({ title: "Invalid Key model access" })

    await server.close()
  })

  it("fails Manual creation closed when approved model inventory is unavailable", async () => {
    configureFixtureRuntime()
    vi.stubEnv("ADMIN_LITELLM_BASE_URL", "http://litellm.test")
    vi.stubEnv("ADMIN_LITELLM_API_KEY", "admin-read-key")
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("stale projection")),
    )
    const server = buildServer()
    const unavailable = await server.inject({
      method: "POST",
      url: "/api/admin/applications/connected-apps",
      headers: { ...adminHeaders, "idempotency-key": "manual-unavailable" },
      payload: {
        ...applicationPayload(),
        allowedModels: ["local-a"],
        modelMode: "manual",
        name: "Manual Unavailable",
      },
    })
    expect(unavailable.json()).toMatchObject({
      title: "Key model inventory unavailable",
    })
    expect(unavailable.statusCode).toBe(503)
    await server.close()
  })

  it("replays only Console Application metadata for OAuth create, revoke, and delete", async () => {
    configureFixtureRuntime()
    const server = buildServer()
    const created = await createApplication(
      server,
      "oauth-receipt-create",
      "oauth_client_credentials",
    )
    expect(created.response.statusCode).toBe(201)
    const applicationId = created.body.app.id as string
    const credentialId = created.body.credential.credentialId as string
    const createdSecret = created.body.credential.clientSecret as string

    const createReplay = await createApplication(
      server,
      "oauth-receipt-create",
      "oauth_client_credentials",
    )
    expectSafeReplay(createReplay.response, applicationId, [createdSecret])

    const revokeRequest = {
      method: "POST" as const,
      url: `/api/admin/applications/connected-apps/${applicationId}/credentials/${credentialId}/revoke`,
      headers: {
        ...adminHeaders,
        "idempotency-key": "oauth-receipt-revoke",
      },
    }
    const revoked = await server.inject(revokeRequest)
    expect(revoked.statusCode).toBe(200)
    const revokeReplay = await server.inject(revokeRequest)
    expectSafeReplay(revokeReplay, applicationId, [createdSecret])

    const deleteCandidate = await createApplication(
      server,
      "oauth-receipt-delete-candidate",
      "oauth_client_credentials",
    )
    expect(deleteCandidate.response.statusCode).toBe(201)
    const deleteApplicationId = deleteCandidate.body.app.id as string
    const deletedSecret = deleteCandidate.body.credential.clientSecret as string
    const deleteRequest = {
      method: "DELETE" as const,
      url: `/api/admin/applications/connected-apps/${deleteApplicationId}`,
      headers: {
        ...adminHeaders,
        "idempotency-key": "oauth-receipt-delete",
      },
      payload: { confirmation: "DELETE KEY" },
    }
    const deleted = await server.inject(deleteRequest)
    expect(deleted.statusCode).toBe(200)
    const deleteReplay = await server.inject(deleteRequest)
    expectSafeReplay(deleteReplay, deleteApplicationId, [deletedSecret])

    await server.close()
  })

  it("rejects an invalid static reveal endpoint before credential generation or product mutation", async () => {
    configureFixtureRuntime()
    vi.stubEnv("CONNECTED_APPS_BFF_BASE_URL", "ftp://invalid.example.test")
    const server = buildServer()

    const rejected = await createApplication(server, "invalid-static-create")
    const list = await server.inject({
      method: "GET",
      url: "/api/admin/applications/connected-apps",
      headers: adminHeaders,
    })

    expect(rejected.response.statusCode).toBe(503)
    expect(rejected.body).toMatchObject({
      title: "Key endpoint configuration unavailable",
    })
    expect(list.json().apps).toEqual([])
    expect(
      getAuditEventsForTest().filter(
        (event) => event.action === "admin.connected_app.created",
      ),
    ).toHaveLength(0)

    vi.stubEnv("CONNECTED_APPS_BFF_BASE_URL", "https://api.example.test/")
    const failedReplay = await createApplication(
      server,
      "invalid-static-create",
    )
    expectFailedReplay(failedReplay.response, 503)
    const retried = await createApplication(
      server,
      "invalid-static-create-retry",
    )
    expect(retried.response.statusCode).toBe(201)
    expect(retried.body.status).toBe("created")
    expect(retried.body.credential).toMatchObject({
      bffBaseUrl: "https://api.example.test",
      openAiBaseUrl: "https://api.example.test/v1",
    })
    await server.close()
  })

  it("keeps immutable mutation routes absent and makes the connection test a passive evidence read", async () => {
    configureFixtureRuntime()
    const server = buildServer()
    const created = await createApplication(server, "strict-policy")
    const id = created.body.app.id as string

    const retiredPolicy = await server.inject({
      method: "PATCH",
      url: `/api/admin/applications/connected-apps/${id}`,
      headers: {
        ...adminHeaders,
        "idempotency-key": "invalid-policy",
      },
      payload: applicationPayload(),
    })
    expect(retiredPolicy.statusCode).toBe(404)

    const retiredRotation = await server.inject({
      method: "POST",
      url: `/api/admin/applications/connected-apps/${id}/rotate-credentials`,
      headers: {
        ...adminHeaders,
        "idempotency-key": "retired-rotation",
      },
    })
    expect(retiredRotation.statusCode).toBe(404)

    const operatorChecked = await server.inject({
      method: "POST",
      url: `/api/admin/applications/connected-apps/${id}/test`,
      headers: {
        ...operatorHeaders,
        "idempotency-key": "operator-passive-check-denied",
      },
    })
    expect(operatorChecked.statusCode).toBe(403)

    const checked = await server.inject({
      method: "POST",
      url: `/api/admin/applications/connected-apps/${id}/test`,
      headers: {
        ...adminHeaders,
        "idempotency-key": "admin-passive-check",
      },
    })
    expect(checked.statusCode).toBe(200)
    expect(checked.json()).toMatchObject({
      connectionStatus: "not_connected",
      observedAt: null,
      status: "waiting",
    })
    expect(
      getAuditEventsForTest().find(
        (event) =>
          event.action === "admin.connected_app.connection_evidence_read",
      ),
    ).toMatchObject({
      applicationId: id,
      keycloakSubjectId: "admin-1",
    })
    await server.close()
  })

  it("keeps disablement and re-enablement Admin-only", async () => {
    configureFixtureRuntime()
    const server = buildServer()
    const created = await createApplication(server, "role-lifecycle")
    const id = created.body.app.id as string

    const operatorDisabled = await server.inject({
      method: "POST",
      url: `/api/admin/applications/connected-apps/${id}/disable`,
      headers: {
        ...operatorHeaders,
        "idempotency-key": "disable-role-lifecycle",
      },
    })
    expect(operatorDisabled.statusCode).toBe(403)

    const disabled = await server.inject({
      method: "POST",
      url: `/api/admin/applications/connected-apps/${id}/disable`,
      headers: {
        ...adminHeaders,
        "idempotency-key": "admin-disable-role-lifecycle",
      },
    })
    expect(disabled.statusCode).toBe(200)
    expect(disabled.json()).toMatchObject({
      app: { id, status: "disabled" },
      applicationId: id,
      status: "disabled",
    })

    const operatorEnable = await server.inject({
      method: "POST",
      url: `/api/admin/applications/connected-apps/${id}/enable`,
      headers: {
        ...operatorHeaders,
        "idempotency-key": "operator-enable-denied",
      },
    })
    expect(operatorEnable.statusCode).toBe(403)

    const enabled = await server.inject({
      method: "POST",
      url: `/api/admin/applications/connected-apps/${id}/enable`,
      headers: {
        ...adminHeaders,
        "idempotency-key": "admin-enable",
      },
    })
    expect(enabled.statusCode).toBe(200)
    expect(enabled.json()).toMatchObject({
      app: { id, status: "enabled" },
      applicationId: id,
      status: "reenabled",
    })
    await server.close()
  })

  it("keeps exact credential revocation Admin-only and rotation absent", async () => {
    configureFixtureRuntime()
    const server = buildServer()
    const created = await createApplication(server, "credential-lifecycle")
    const id = created.body.app.id as string
    const credentialId = created.body.credential.credentialId as string

    for (const [headers, expectedStatus] of [
      [operatorHeaders, 403],
      [adminHeaders, 404],
    ] as const) {
      const retiredRotation = await server.inject({
        method: "POST",
        url: `/api/admin/applications/connected-apps/${id}/rotate-credentials`,
        headers: {
          ...headers,
          "idempotency-key": `retired-rotation-${headers["x-llm-machines-user-roles"]}`,
        },
      })
      expect(retiredRotation.statusCode).toBe(expectedStatus)
    }

    const operatorRevoked = await server.inject({
      method: "POST",
      url: `/api/admin/applications/connected-apps/${id}/credentials/${credentialId}/revoke`,
      headers: {
        ...operatorHeaders,
        "idempotency-key": "operator-revoke-denied",
      },
    })
    expect(operatorRevoked.statusCode).toBe(403)

    const revoked = await server.inject({
      method: "POST",
      url: `/api/admin/applications/connected-apps/${id}/credentials/${credentialId}/revoke`,
      headers: {
        ...adminHeaders,
        "idempotency-key": "admin-revoke-active",
      },
    })
    expect(revoked.statusCode).toBe(200)
    expect(revoked.json()).toMatchObject({
      id,
      status: "disabled",
    })
    expect(
      getAuditEventsForTest().filter(
        (event) =>
          event.action === "admin.connected_app.credential.revoked" &&
          event.applicationId === id &&
          event.keycloakSubjectId === "admin-1",
      ),
    ).toHaveLength(1)
    await server.close()
  })

  it("requires exact delete confirmation, soft-deletes retained identifiers, and omits the app from reads", async () => {
    configureFixtureRuntime()
    const server = buildServer()
    const created = await createApplication(server, "soft-delete")
    const id = created.body.app.id as string
    const credentialId = created.body.credential.credentialId as string

    const rejected = await server.inject({
      method: "DELETE",
      url: `/api/admin/applications/connected-apps/${id}`,
      headers: {
        ...adminHeaders,
        "idempotency-key": "delete-rejected",
      },
      payload: { confirmation: "DELETE" },
    })
    expect(rejected.statusCode).toBe(400)

    const deleted = await server.inject({
      method: "DELETE",
      url: `/api/admin/applications/connected-apps/${id}`,
      headers: {
        ...adminHeaders,
        "idempotency-key": "delete-confirmed",
      },
      payload: { confirmation: "DELETE KEY" },
    })
    expect(deleted.statusCode).toBe(200)
    expect(deleted.json()).toEqual({
      app: null,
      applicationId: id,
      detail: "Key deleted. Its identifiers and audit history remain.",
      status: "deleted",
    })

    const [detail, list] = await Promise.all([
      server.inject({
        method: "GET",
        url: `/api/admin/applications/connected-apps/${id}`,
        headers: adminHeaders,
      }),
      server.inject({
        method: "GET",
        url: "/api/admin/applications/connected-apps",
        headers: adminHeaders,
      }),
    ])
    expect(detail.statusCode).toBe(404)
    expect(list.json().apps).toEqual([])
    expect(
      getAuditEventsForTest().find(
        (event) => event.action === "admin.connected_app.deleted",
      ),
    ).toMatchObject({
      applicationId: id,
      credentialRecordId: credentialId,
      keycloakSubjectId: "admin-1",
    })

    const replay = await server.inject({
      method: "DELETE",
      url: `/api/admin/applications/connected-apps/${id}`,
      headers: {
        ...adminHeaders,
        "idempotency-key": "delete-confirmed",
      },
      payload: { confirmation: "DELETE KEY" },
    })
    expect(replay.statusCode).toBe(200)
    expect(replay.json()).toMatchObject({
      resourceId: id,
      status: "already_completed",
    })
    await server.close()
  })
})

function configureFixtureRuntime(): void {
  vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
  vi.stubEnv("BFF_FALLBACK_MODELS", "local-a")
  vi.stubEnv("CONNECTED_APPS_KEYCLOAK_FIXTURE", "true")
}

async function createApplication(
  server: ReturnType<typeof buildServer>,
  idempotencyKey: string,
  authMethod?: "api_key" | "oauth_client_credentials",
) {
  const response = await server.inject({
    method: "POST",
    url: "/api/admin/applications/connected-apps",
    headers: {
      ...adminHeaders,
      "idempotency-key": idempotencyKey,
    },
    payload: {
      ...applicationPayload(),
      ...(authMethod ? { authMethod } : {}),
    },
  })
  return { body: response.json(), response }
}

function expectSafeReplay(
  response: {
    body: string
    json(): Record<string, unknown>
    statusCode: number
  },
  applicationId: string,
  secrets: string[],
): void {
  expect(response.statusCode).toBeGreaterThanOrEqual(200)
  expect(response.statusCode).toBeLessThan(300)
  expect(response.json()).toEqual({
    correlationId: expect.any(String),
    outcome: "succeeded",
    resourceId: applicationId,
    status: "already_completed",
  })
  expect(Object.keys(response.json()).sort()).toEqual([
    "correlationId",
    "outcome",
    "resourceId",
    "status",
  ])
  expect(response.body).not.toContain("fixture-")
  expect(response.body).not.toContain("llmm-")
  for (const secret of secrets) {
    expect(response.body).not.toContain(secret)
  }
}

function expectFailedReplay(
  response: {
    body: string
    json(): Record<string, unknown>
    statusCode: number
  },
  statusCode: number,
): void {
  expect(response.statusCode).toBe(statusCode)
  expect(response.json()).toEqual({
    correlationId: expect.any(String),
    outcome: "failed",
    resourceId: null,
    status: "already_completed",
  })
  expect(Object.keys(response.json()).sort()).toEqual([
    "correlationId",
    "outcome",
    "resourceId",
    "status",
  ])
  expect(response.body).not.toContain("apiKey")
  expect(response.body).not.toContain("clientSecret")
  expect(response.body).not.toContain("credential")
  expect(response.body).not.toContain("fixture-")
}

function applicationPayload() {
  return {
    allowedModels: [],
    description: "Lifecycle route test.",
    modelMode: "auto",
    name: "Lifecycle test",
  }
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
