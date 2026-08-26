import { randomUUID } from "node:crypto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Actor } from "../auth/authorization"
import {
  createAdminConnectedApp,
  getAdminConnectedAppDetail,
  recordConnectedAppGatewayAccountingDegraded,
  recordConnectedAppModelsConnection,
  resetConnectedAppsForTest,
  resolveConnectedAppRuntimeIdentity,
  resolveConnectedAppRuntimeIdentityByApiKey,
  revokeAdminConnectedAppCredential,
  testAdminConnectedApp,
} from "./admin-connected-apps"
import { getAuditEventsForTest, resetAuditEventsForTest } from "./audit"
import {
  IdentityMutationReconciliationRequiredError,
  executeJournaledIdentityMutation,
  resetIdentityMutationJournalForTest,
} from "./identity-mutation-journal"

const actor: Actor = {
  authMode: "service-forwarded",
  role: "admin",
  subject: "credential-atomicity-test",
}

describe("connected app credential mutation boundaries", () => {
  beforeEach(() => {
    vi.stubEnv("CONNECTED_APPS_KEYCLOAK_FIXTURE", "true")
  })

  afterEach(async () => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    resetIdentityMutationJournalForTest()
    resetAuditEventsForTest()
    await resetConnectedAppsForTest()
  })

  it("defaults an omitted auth method to a static key without retaining its secret", async () => {
    const request = connectedAppRequest("api_key")
    const created = await createAdminConnectedApp(actor, {
      ...request,
      authMethod: undefined,
    } as unknown as typeof request)
    expect(created.status).toBe("created")
    if (
      created.status !== "created" ||
      created.credential.authMethod !== "api_key"
    ) {
      throw new Error("Expected a static Application credential.")
    }

    const detail = await getAdminConnectedAppDetail(actor, created.app.id)
    expect(detail?.app.authMethod).toBe("api_key")
    expect(JSON.stringify(detail)).not.toContain(created.credential.apiKey)
    expect(JSON.stringify(getAuditEventsForTest())).not.toContain(
      created.credential.apiKey,
    )
  })

  it("fails OAuth runtime resolution closed while an OAuth journal outcome is unresolved", async () => {
    const created = await createAdminConnectedApp(
      actor,
      connectedAppRequest("oauth_client_credentials"),
      identityContext("application.oauth.create"),
    )
    if (
      created.status !== "created" ||
      created.credential.authMethod !== "oauth_client_credentials"
    ) {
      throw new Error("Expected an OAuth Application credential.")
    }
    await expect(
      resolveConnectedAppRuntimeIdentity(created.credential.clientId),
    ).resolves.toMatchObject({ appId: created.app.id })

    await expect(
      executeJournaledIdentityMutation({
        apply: async (_preflight, keycloak) =>
          keycloak.firstWrite(
            async () => ({ id: "ambiguous-oauth-client" }),
            "ambiguous-oauth-client",
          ),
        context: identityContext("application.oauth.revoke.ambiguous"),
        finalize: async () => {
          throw new Error("synthetic persistence failure")
        },
        keycloakSubjectId: actor.subject,
        preflight: async () => null,
        targetIdentifier: "ambiguous-oauth-client",
        targetType: "oauth_client",
      }),
    ).rejects.toBeInstanceOf(IdentityMutationReconciliationRequiredError)

    await expect(
      resolveConnectedAppRuntimeIdentity(created.credential.clientId),
    ).resolves.toBeNull()
  })

  it("keeps authentication resolution and passive connection checks side-effect-free", async () => {
    const created = await createAdminConnectedApp(
      actor,
      connectedAppRequest("api_key"),
    )
    if (
      created.status !== "created" ||
      created.credential.authMethod !== "api_key"
    ) {
      throw new Error("Expected a static Application credential.")
    }
    await resolveConnectedAppRuntimeIdentityByApiKey(created.credential.apiKey)
    const checked = await testAdminConnectedApp(actor, created.app.id)
    expect(checked).toMatchObject({
      connectionStatus: "not_connected",
      observedAt: null,
      status: "waiting",
    })
    const detail = await getAdminConnectedAppDetail(actor, created.app.id)
    expect(detail?.app).toMatchObject({
      connectionStatus: "not_connected",
      lastConnectedAt: null,
      usage: { lastUsedAt: null },
    })
    expect(detail?.app.credentials[0]?.lastUsedAt).toBeNull()
  })

  it("does not partially mark a fixture Application connected when its audit write fails", async () => {
    const created = await createAdminConnectedApp(
      actor,
      connectedAppRequest("api_key"),
    )
    if (
      created.status !== "created" ||
      created.credential.authMethod !== "api_key"
    ) {
      throw new Error("Expected a static Application credential.")
    }
    const identity = await resolveConnectedAppRuntimeIdentityByApiKey(
      created.credential.apiKey,
    )
    if (!identity) {
      throw new Error("Expected a runtime identity.")
    }

    const auditModule = await import("./audit")
    vi.spyOn(auditModule, "emitAudit").mockRejectedValueOnce(
      new Error("synthetic audit failure"),
    )
    await expect(
      recordConnectedAppModelsConnection(identity, "correlation-fixture"),
    ).rejects.toThrow("synthetic audit failure")

    const detail = await getAdminConnectedAppDetail(actor, created.app.id)
    expect(detail?.app).toMatchObject({
      connectionStatus: "not_connected",
      lastConnectedAt: null,
    })
    expect(detail?.app.credentials[0]?.lastUsedAt).toBeNull()
  })

  it("marks accounting degraded only for a current app and credential", async () => {
    const created = await createAdminConnectedApp(
      actor,
      connectedAppRequest("api_key"),
    )
    if (
      created.status !== "created" ||
      created.credential.authMethod !== "api_key"
    ) {
      throw new Error("Expected a static Application credential.")
    }
    const identity = await resolveConnectedAppRuntimeIdentityByApiKey(
      created.credential.apiKey,
    )
    if (!identity) {
      throw new Error("Expected a runtime identity.")
    }

    await expect(
      recordConnectedAppGatewayAccountingDegraded(identity),
    ).resolves.toBe(true)
    await expect(
      getAdminConnectedAppDetail(actor, created.app.id),
    ).resolves.toMatchObject({
      app: {
        connectionStatus: "degraded",
        lastConnectedAt: null,
      },
    })

    await revokeAdminConnectedAppCredential(
      actor,
      created.app.id,
      created.credential.credentialId,
    )
    await expect(
      recordConnectedAppGatewayAccountingDegraded(identity),
    ).resolves.toBe(false)
  })
})

function connectedAppRequest(
  authMethod: "api_key" | "oauth_client_credentials",
) {
  return {
    allowedModels: ["local-a"],
    authMethod,
    description: "Credential mutation boundary test.",
    maxConcurrentRequests: null,
    maxContextBytes: null,
    modelMode: "manual" as const,
    name: `Atomicity ${authMethod}`,
    rateLimitRps: null,
    tokenAlertThreshold7d: null,
  }
}

function identityContext(operationCode: string) {
  return {
    commitWithReceipt: async <T>(input: {
      resourceId: string | null
      run(transaction: null): Promise<T>
    }) => input.run(null),
    finalizeReceipt: async () => undefined,
    idempotencyLedgerId: randomUUID(),
    operationCode,
    requestFingerprint: randomUUID(),
  }
}
