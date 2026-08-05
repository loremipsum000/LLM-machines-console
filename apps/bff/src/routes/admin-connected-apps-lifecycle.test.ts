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

  it("replays only Console Application metadata for every OAuth credential mutation", async () => {
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

    const rotated = await rotateApplication(
      server,
      applicationId,
      "oauth-receipt-rotate",
    )
    expect(rotated.statusCode).toBe(200)
    const rotatedSecret = rotated.json().credential.clientSecret as string
    const rotateReplay = await rotateApplication(
      server,
      applicationId,
      "oauth-receipt-rotate",
    )
    expectSafeReplay(rotateReplay, applicationId, [
      createdSecret,
      rotatedSecret,
    ])

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
    expectSafeReplay(revokeReplay, applicationId, [
      createdSecret,
      rotatedSecret,
    ])

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
      payload: { confirmation: "DELETE APPLICATION" },
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
      title: "Connected app endpoint configuration unavailable",
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

  it.each(["CONNECTED_APPS_BFF_BASE_URL", "CONNECTED_APPS_TOKEN_URL"] as const)(
    "rejects invalid OAuth %s before Keycloak, journal, storage, or audit",
    async (variable) => {
      configureFixtureRuntime()
      vi.stubEnv(variable, "ftp://invalid.example.test")
      const server = buildServer()
      const idempotencyKey = `invalid-oauth-create-${variable}`

      const rejected = await createApplication(
        server,
        idempotencyKey,
        "oauth_client_credentials",
      )
      const list = await server.inject({
        method: "GET",
        url: "/api/admin/applications/connected-apps",
        headers: adminHeaders,
      })

      expect(rejected.response.statusCode).toBe(503)
      expect(list.json().apps).toEqual([])
      expect(
        getAuditEventsForTest().filter(
          (event) => event.action === "admin.connected_app.created",
        ),
      ).toHaveLength(0)

      vi.stubEnv(
        variable,
        variable === "CONNECTED_APPS_BFF_BASE_URL"
          ? "https://api.example.test"
          : "https://keycloak.example.test/realms/apps/protocol/openid-connect/token",
      )
      const failedReplay = await createApplication(
        server,
        idempotencyKey,
        "oauth_client_credentials",
      )
      expectFailedReplay(failedReplay.response, 503)
      const retried = await createApplication(
        server,
        `${idempotencyKey}-retry`,
        "oauth_client_credentials",
      )
      expect(retried.response.statusCode).toBe(201)
      expect(retried.body).toMatchObject({
        credential: { authMethod: "oauth_client_credentials" },
        status: "created",
      })
      await server.close()
    },
  )

  it("rejects invalid static rotation configuration without changing the active key", async () => {
    configureFixtureRuntime()
    const server = buildServer()
    const created = await createApplication(server, "static-rotation-preflight")
    const id = created.body.app.id as string
    const originalCredential = created.body.app.credentials[0] as {
      id: string
      issuedAt: string
      status: string
    }
    vi.stubEnv("CONNECTED_APPS_BFF_BASE_URL", "not a URL")

    const rejected = await rotateApplication(
      server,
      id,
      "static-rotation-invalid-endpoint",
    )
    const unchanged = await connectedAppDetail(server, id)

    expect(rejected.statusCode).toBe(503)
    expect(unchanged.app.credentials).toEqual([
      expect.objectContaining(originalCredential),
    ])
    expect(
      getAuditEventsForTest().filter(
        (event) => event.action === "admin.connected_app.credentials_rotated",
      ),
    ).toHaveLength(0)

    vi.stubEnv("CONNECTED_APPS_BFF_BASE_URL", "https://api.example.test")
    const failedReplay = await rotateApplication(
      server,
      id,
      "static-rotation-invalid-endpoint",
    )
    expectFailedReplay(failedReplay, 503)
    const retried = await rotateApplication(
      server,
      id,
      "static-rotation-invalid-endpoint-retry",
    )
    expect(retried.statusCode).toBe(200)
    expect(retried.json().status).toBe("rotated")
    await server.close()
  })

  it.each(["CONNECTED_APPS_BFF_BASE_URL", "CONNECTED_APPS_TOKEN_URL"] as const)(
    "rejects invalid OAuth rotation %s without changing the old credential",
    async (variable) => {
      configureFixtureRuntime()
      const server = buildServer()
      const created = await createApplication(
        server,
        `oauth-rotation-preflight-${variable}`,
        "oauth_client_credentials",
      )
      const id = created.body.app.id as string
      const originalCredential = created.body.app.credentials[0] as {
        id: string
        issuedAt: string
        status: string
      }
      vi.stubEnv(variable, "ftp://invalid.example.test")
      const idempotencyKey = `oauth-rotation-invalid-${variable}`

      const rejected = await rotateApplication(server, id, idempotencyKey)
      const unchanged = await connectedAppDetail(server, id)

      expect(rejected.statusCode).toBe(503)
      expect(unchanged.app.credentials).toEqual([
        expect.objectContaining(originalCredential),
      ])
      expect(
        getAuditEventsForTest().filter(
          (event) => event.action === "admin.connected_app.credentials_rotated",
        ),
      ).toHaveLength(0)

      vi.stubEnv(
        variable,
        variable === "CONNECTED_APPS_BFF_BASE_URL"
          ? "https://api.example.test"
          : "https://keycloak.example.test/realms/apps/protocol/openid-connect/token",
      )
      const failedReplay = await rotateApplication(server, id, idempotencyKey)
      expectFailedReplay(failedReplay, 503)
      const retried = await rotateApplication(
        server,
        id,
        `${idempotencyKey}-retry`,
      )
      expect(retried.statusCode).toBe(200)
      expect(retried.json()).toMatchObject({
        credential: {
          authMethod: "oauth_client_credentials",
          credentialId: originalCredential.id,
        },
        status: "rotated",
      })
      await server.close()
    },
  )

  it("replays a completed rotation after endpoint drift and Application deletion", async () => {
    configureFixtureRuntime()
    const server = buildServer()
    const created = await createApplication(server, "rotation-replay-create")
    const applicationId = created.body.app.id as string
    const rotated = await rotateApplication(
      server,
      applicationId,
      "rotation-replay-after-delete",
    )
    expect(rotated.statusCode).toBe(200)
    const rotatedSecret = rotated.json().credential.apiKey as string
    const deleted = await server.inject({
      method: "DELETE",
      url: `/api/admin/applications/connected-apps/${applicationId}`,
      headers: {
        ...adminHeaders,
        "idempotency-key": "rotation-replay-delete",
      },
      payload: { confirmation: "DELETE APPLICATION" },
    })
    expect(deleted.statusCode).toBe(200)
    vi.stubEnv("CONNECTED_APPS_BFF_BASE_URL", "ftp://invalid.example.test")

    const replay = await rotateApplication(
      server,
      applicationId,
      "rotation-replay-after-delete",
    )
    expectSafeReplay(replay, applicationId, [rotatedSecret])
    await server.close()
  })

  it("keeps policy PATCH strict and makes the connection test a passive evidence read", async () => {
    configureFixtureRuntime()
    const server = buildServer()
    const created = await createApplication(server, "strict-policy")
    const id = created.body.app.id as string

    const invalidPolicy = await server.inject({
      method: "PATCH",
      url: `/api/admin/applications/connected-apps/${id}`,
      headers: {
        ...adminHeaders,
        "idempotency-key": "invalid-policy",
      },
      payload: {
        ...applicationPayload(),
        authMethod: "oauth_client_credentials",
        status: "disabled",
      },
    })
    expect(invalidPolicy.statusCode).toBe(400)

    const checked = await server.inject({
      method: "POST",
      url: `/api/admin/applications/connected-apps/${id}/test`,
      headers: {
        ...operatorHeaders,
        "idempotency-key": "passive-check",
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
      keycloakSubjectId: "operator-1",
    })
    await server.close()
  })

  it("enforces Operator disable and Admin-only re-enable while preserving idempotency", async () => {
    configureFixtureRuntime()
    const server = buildServer()
    const created = await createApplication(server, "role-lifecycle")
    const id = created.body.app.id as string

    const disabled = await server.inject({
      method: "POST",
      url: `/api/admin/applications/connected-apps/${id}/disable`,
      headers: {
        ...operatorHeaders,
        "idempotency-key": "disable-role-lifecycle",
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

  it("lets Operator rotate and revoke exact credentials, disabling the app when the active key is revoked", async () => {
    configureFixtureRuntime()
    const server = buildServer()
    const created = await createApplication(server, "credential-lifecycle")
    const id = created.body.app.id as string
    const initialCredentialId = created.body.credential.credentialId as string

    const rotated = await server.inject({
      method: "POST",
      url: `/api/admin/applications/connected-apps/${id}/rotate-credentials`,
      headers: {
        ...operatorHeaders,
        "idempotency-key": "rotate-credential",
      },
    })
    expect(rotated.statusCode).toBe(200)
    expect(rotated.headers["cache-control"]).toBe("no-store")
    expect(rotated.json()).toMatchObject({
      app: {
        credentials: expect.arrayContaining([
          expect.objectContaining({
            id: initialCredentialId,
            status: "retiring",
          }),
        ]),
      },
      status: "rotated",
    })
    const retiring = rotated
      .json()
      .app.credentials.find(
        (credential: { id: string }) => credential.id === initialCredentialId,
      ) as { overlapExpiresAt: string; rotatedAt: string }
    expect(
      Date.parse(retiring.overlapExpiresAt) - Date.parse(retiring.rotatedAt),
    ).toBe(86_400_000)
    const activeCredentialId = rotated.json().credential.credentialId as string

    const revokedRetiring = await server.inject({
      method: "POST",
      url: `/api/admin/applications/connected-apps/${id}/credentials/${initialCredentialId}/revoke`,
      headers: {
        ...operatorHeaders,
        "idempotency-key": "revoke-retiring",
      },
    })
    expect(revokedRetiring.statusCode).toBe(200)
    expect(revokedRetiring.json()).toMatchObject({ status: "enabled" })

    const revokedActive = await server.inject({
      method: "POST",
      url: `/api/admin/applications/connected-apps/${id}/credentials/${activeCredentialId}/revoke`,
      headers: {
        ...operatorHeaders,
        "idempotency-key": "revoke-active",
      },
    })
    expect(revokedActive.statusCode).toBe(200)
    expect(revokedActive.json()).toMatchObject({
      id,
      status: "disabled",
    })
    expect(
      getAuditEventsForTest().filter(
        (event) =>
          event.action === "admin.connected_app.credential.revoked" &&
          event.applicationId === id &&
          event.keycloakSubjectId === "operator-1",
      ),
    ).toHaveLength(2)
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
      payload: { confirmation: "DELETE APPLICATION" },
    })
    expect(deleted.statusCode).toBe(200)
    expect(deleted.json()).toEqual({
      app: null,
      applicationId: id,
      detail: "Application deleted. Its identifiers and audit history remain.",
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
      payload: { confirmation: "DELETE APPLICATION" },
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

async function rotateApplication(
  server: ReturnType<typeof buildServer>,
  id: string,
  idempotencyKey: string,
) {
  return server.inject({
    method: "POST",
    url: `/api/admin/applications/connected-apps/${id}/rotate-credentials`,
    headers: { ...adminHeaders, "idempotency-key": idempotencyKey },
  })
}

async function connectedAppDetail(
  server: ReturnType<typeof buildServer>,
  id: string,
) {
  const response = await server.inject({
    method: "GET",
    url: `/api/admin/applications/connected-apps/${id}`,
    headers: adminHeaders,
  })
  expect(response.statusCode).toBe(200)
  return response.json() as { app: { credentials: unknown[] } }
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
    allowedModels: ["local-a"],
    description: "Lifecycle route test.",
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
