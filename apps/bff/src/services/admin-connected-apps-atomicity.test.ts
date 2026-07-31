import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Actor } from "../auth/authorization"

const dependencies = vi.hoisted(() => ({
  createClient: vi.fn(),
  deleteClient: vi.fn(),
  emitAudit: vi.fn(),
  getDatabase: vi.fn(),
  keycloakClientFromEnv: vi.fn(),
  rotateClientSecret: vi.fn(),
  upsertActor: vi.fn(),
}))

vi.mock("../db/inference-core-client", () => ({
  getInferenceCoreDb: dependencies.getDatabase,
}))

vi.mock("./audit", () => ({
  emitAudit: dependencies.emitAudit,
}))

vi.mock("./users", () => ({
  upsertActorUser: dependencies.upsertActor,
}))

vi.mock("./inference-core-keycloak-admin", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./inference-core-keycloak-admin")>()),
  keycloakAdminClientFromEnv: dependencies.keycloakClientFromEnv,
}))

import {
  createAdminConnectedApp,
  resetConnectedAppsForTest,
  resolveConnectedAppRuntimeIdentityByApiKey,
  rotateAdminConnectedAppCredentials,
} from "./admin-connected-apps"

const actor: Actor = {
  authMode: "service-forwarded",
  role: "admin",
  subject: "credential-atomicity-test",
}

describe("connected app credential mutation boundaries", () => {
  beforeEach(() => {
    dependencies.createClient.mockReset().mockResolvedValue({
      clientId: "llmm-test-client",
      clientSecret: "created-client-secret",
      id: "keycloak-client-uuid",
      tokenUrl:
        "https://keycloak.example.test/realms/appliance/protocol/openid-connect/token",
    })
    dependencies.deleteClient.mockReset().mockResolvedValue(undefined)
    dependencies.emitAudit.mockReset().mockResolvedValue(undefined)
    dependencies.getDatabase.mockReset().mockReturnValue(null)
    dependencies.rotateClientSecret.mockReset().mockResolvedValue({
      clientId: "llmm-test-client",
      clientSecret: "rotated-client-secret",
      id: "keycloak-client-uuid",
      tokenUrl:
        "https://keycloak.example.test/realms/appliance/protocol/openid-connect/token",
    })
    dependencies.upsertActor.mockReset().mockResolvedValue(actor)
    dependencies.keycloakClientFromEnv.mockReset().mockReturnValue({
      client: {
        createConfidentialClient: dependencies.createClient,
        deleteConfidentialClient: dependencies.deleteClient,
        rotateConfidentialClientSecret: dependencies.rotateClientSecret,
      },
      status: "ok",
    })
  })

  afterEach(async () => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
    await resetConnectedAppsForTest()
  })

  it("removes a newly created Keycloak client when Product DB persistence fails", async () => {
    dependencies.getDatabase.mockReturnValue({
      transaction: vi.fn(async () => {
        throw new Error("synthetic database failure")
      }),
    })

    const result = await createAdminConnectedApp(
      actor,
      connectedAppRequest("oauth_client_credentials"),
    )

    expect(result).toEqual({
      detail:
        "Connected app persistence failed. The temporary Keycloak client was removed; retry the request.",
      status: "blocked",
    })
    expect(dependencies.createClient).toHaveBeenCalledOnce()
    expect(dependencies.deleteClient).toHaveBeenCalledWith(
      "keycloak-client-uuid",
    )
    expect(dependencies.emitAudit).not.toHaveBeenCalled()
  })

  it("returns a bounded reconciliation instruction when Keycloak cleanup fails", async () => {
    dependencies.getDatabase.mockReturnValue({
      transaction: vi.fn(async () => {
        throw new Error("private-database-error-marker")
      }),
    })
    dependencies.deleteClient.mockRejectedValue(
      new Error("private-identity-error-marker"),
    )

    const result = await createAdminConnectedApp(
      actor,
      connectedAppRequest("oauth_client_credentials"),
    )

    expect(result.status).toBe("blocked")
    expect(result).toMatchObject({
      detail: expect.stringMatching(
        /^Connected app persistence failed and Keycloak cleanup did not complete\. Reconcile client llmm-app-[a-z0-9-]+-staging before retrying; do not use a new idempotency key until Keycloak is checked\.$/,
      ),
    })
    expect(JSON.stringify(result)).not.toMatch(/private-(?:database|identity)/)
    expect(dependencies.deleteClient).toHaveBeenCalledOnce()
  })

  it("keeps OAuth secret rotation disabled until durable reconciliation exists", async () => {
    vi.stubEnv("CONNECTED_APPS_KEYCLOAK_FIXTURE", "true")
    const created = await createAdminConnectedApp(
      actor,
      connectedAppRequest("oauth_client_credentials"),
    )
    expect(created.status).toBe("created")
    if (created.status !== "created") {
      throw new Error("Expected an OAuth Application fixture.")
    }

    const result = await rotateAdminConnectedAppCredentials(
      actor,
      created.app.id,
    )

    expect(result).toMatchObject({
      detail:
        "OAuth client-secret rotation remains disabled until durable identity reconciliation is available.",
      status: "blocked",
    })
    expect(dependencies.rotateClientSecret).not.toHaveBeenCalled()
  })

  it("revokes the oldest overlap key during a second rapid static rotation", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-07-31T12:00:00.000Z"))
    const created = await createAdminConnectedApp(
      actor,
      connectedAppRequest("api_key"),
    )
    expect(created.status).toBe("created")
    if (created.status !== "created" || !created.credential.apiKey) {
      throw new Error("Expected an initial static key.")
    }

    vi.setSystemTime(new Date("2026-07-31T13:00:00.000Z"))
    const firstRotation = await rotateAdminConnectedAppCredentials(
      actor,
      created.app.id,
    )
    vi.setSystemTime(new Date("2026-07-31T14:00:00.000Z"))
    const secondRotation = await rotateAdminConnectedAppCredentials(
      actor,
      created.app.id,
    )
    if (
      firstRotation.status !== "rotated" ||
      !firstRotation.credential.apiKey ||
      secondRotation.status !== "rotated" ||
      !secondRotation.credential.apiKey
    ) {
      throw new Error("Expected two rotated static keys.")
    }

    await expect(
      resolveConnectedAppRuntimeIdentityByApiKey(created.credential.apiKey),
    ).resolves.toBeNull()
    await expect(
      resolveConnectedAppRuntimeIdentityByApiKey(
        firstRotation.credential.apiKey,
      ),
    ).resolves.toMatchObject({ appId: created.app.id })
    await expect(
      resolveConnectedAppRuntimeIdentityByApiKey(
        secondRotation.credential.apiKey,
      ),
    ).resolves.toMatchObject({ appId: created.app.id })
  })
})

function connectedAppRequest(
  authMethod: "api_key" | "oauth_client_credentials",
) {
  return {
    allowedModels: ["local-a"],
    authMethod,
    description: "Credential mutation boundary test.",
    name: `Atomicity ${authMethod}`,
    ownerGroup: "Administrators",
    rateLimitRpm: null,
    tokenBudget7d: null,
  }
}
