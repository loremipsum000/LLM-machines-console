import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Actor } from "../auth/authorization"
import type { IdentityMutationRouteContext } from "./identity-mutation-journal"

const { emitAuditMock, getInferenceCoreDbMock, upsertActorUserMock } =
  vi.hoisted(() => ({
    emitAuditMock: vi.fn(),
    getInferenceCoreDbMock: vi.fn(),
    upsertActorUserMock: vi.fn(),
  }))

vi.mock("../db/inference-core-client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../db/inference-core-client")>()
  return {
    ...actual,
    getInferenceCoreDb: getInferenceCoreDbMock,
  }
})

vi.mock("./audit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./audit")>()
  return {
    ...actual,
    emitAudit: emitAuditMock,
  }
})

vi.mock("./users", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./users")>()
  return {
    ...actual,
    upsertActorUser: upsertActorUserMock,
  }
})

import {
  getAdminSettings,
  resetAdminSettingsCoreForTest,
  updateAdminSettingsOrganization,
  updateAdminSettingsTelemetry,
} from "./admin-settings-core"

const adminActor: Actor = {
  authMode: "service-forwarded",
  role: "admin",
  subject: "admin-1",
}

const organizationRequest = {
  defaultLanguage: "hr" as const,
  organizationName: "Fixture organization",
}

const telemetryRequest = {
  confirmation: "ENABLE TELEMETRY",
  enabled: true,
}

describe("Settings persistence authority", () => {
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
    ]) {
      vi.stubEnv(name, "")
    }
    resetAdminSettingsCoreForTest()
    emitAuditMock.mockReset()
    getInferenceCoreDbMock.mockReset()
    getInferenceCoreDbMock.mockReturnValue(null)
    upsertActorUserMock.mockReset()
    upsertActorUserMock.mockResolvedValue({ subject: adminActor.subject })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    resetAdminSettingsCoreForTest()
  })

  it("permits process-memory settings only in explicit fixture mode", async () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("BFF_FIXTURE_MODE", "true")

    await expect(
      updateAdminSettingsOrganization(adminActor, organizationRequest),
    ).resolves.toMatchObject({ status: "ok" })
    await expect(
      updateAdminSettingsTelemetry(adminActor, telemetryRequest),
    ).resolves.toMatchObject({ status: "ok" })
    await expect(getAdminSettings(adminActor)).resolves.toMatchObject({
      license: { telemetryOptIn: true },
      organization: {
        defaultLanguage: "hr",
        organizationName: "Fixture organization",
      },
      privacy: { telemetryEnabled: true },
      sourceStatus: "not_configured",
    })
    expect(emitAuditMock).toHaveBeenCalledTimes(3)
  })

  it.each([
    { fixtureFlag: "false", runtime: "development" },
    { fixtureFlag: "true", runtime: "production" },
  ])(
    "does not expose fixture memory in $runtime runtime with BFF_FIXTURE_MODE=$fixtureFlag",
    async ({ fixtureFlag, runtime }) => {
      await seedFixtureState()
      emitAuditMock.mockClear()
      vi.stubEnv("NODE_ENV", runtime)
      vi.stubEnv("BFF_FIXTURE_MODE", fixtureFlag)

      await expect(getAdminSettings(adminActor)).resolves.toMatchObject({
        license: {
          sourceStatus: "not_configured",
          telemetryOptIn: false,
        },
        organization: {
          defaultLanguage: "en",
          organizationName: "LLM Machines",
          updatedAt: null,
          updatedBy: null,
        },
        privacy: {
          telemetryEnabled: false,
          updatedAt: null,
          updatedBy: null,
        },
        sourceStatus: "not_configured",
      })
      expect(emitAuditMock).not.toHaveBeenCalled()
    },
  )

  it.each([
    { fixtureFlag: "false", runtime: "development" },
    { fixtureFlag: "true", runtime: "production" },
  ])(
    "fails mutations closed without a success audit in $runtime runtime with BFF_FIXTURE_MODE=$fixtureFlag",
    async ({ fixtureFlag, runtime }) => {
      vi.stubEnv("NODE_ENV", runtime)
      vi.stubEnv("BFF_FIXTURE_MODE", fixtureFlag)

      const expected = {
        detail:
          "Settings persistence is not configured. Configure PostgreSQL before changing settings.",
        status: "unavailable",
      }
      await expect(
        updateAdminSettingsOrganization(adminActor, organizationRequest),
      ).resolves.toEqual(expected)
      await expect(
        updateAdminSettingsTelemetry(adminActor, telemetryRequest),
      ).resolves.toEqual(expected)
      expect(emitAuditMock).not.toHaveBeenCalled()
    },
  )

  it("keeps PostgreSQL Settings writes and success audits inside the receipt transaction", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("BFF_FIXTURE_MODE", "false")
    const persistedValues: Record<string, unknown>[] = []
    const conflictSets: Record<string, unknown>[] = []
    const onConflictDoUpdate = vi.fn(
      async ({ set }: { set: Record<string, unknown> }) => {
        conflictSets.push(set)
      },
    )
    const values = vi.fn((value: Record<string, unknown>) => {
      persistedValues.push(value)
      return { onConflictDoUpdate }
    })
    const insert = vi.fn(() => ({ values }))
    const transaction = { insert }
    const select = vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn().mockResolvedValue([]),
        })),
      })),
    }))
    getInferenceCoreDbMock.mockReturnValue({ select })
    const commitWithReceipt: NonNullable<
      IdentityMutationRouteContext["commitWithReceipt"]
    > = vi.fn(async ({ run }) => run(transaction as never))

    await expect(
      updateAdminSettingsOrganization(
        adminActor,
        organizationRequest,
        "settings-org-correlation",
        commitWithReceipt,
      ),
    ).resolves.toMatchObject({ status: "ok" })
    expect(commitWithReceipt).toHaveBeenLastCalledWith(
      expect.objectContaining({ resourceId: "singleton" }),
    )
    expect(upsertActorUserMock).toHaveBeenCalledTimes(1)
    expect(upsertActorUserMock).toHaveBeenLastCalledWith(
      adminActor,
      transaction,
    )
    expect(insert).toHaveBeenCalledTimes(1)
    expect(persistedValues[0]).not.toHaveProperty("fullLogo")
    expect(persistedValues[0]).not.toHaveProperty("iconLogo")
    expect(conflictSets[0]).not.toHaveProperty("fullLogo")
    expect(conflictSets[0]).not.toHaveProperty("iconLogo")
    expect(emitAuditMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        action: "admin.settings.organization.updated",
        correlationId: "settings-org-correlation",
      }),
      transaction,
    )

    insert.mockClear()
    emitAuditMock.mockClear()
    upsertActorUserMock.mockClear()
    persistedValues.length = 0
    conflictSets.length = 0
    await expect(
      updateAdminSettingsTelemetry(
        adminActor,
        telemetryRequest,
        "settings-telemetry-correlation",
        commitWithReceipt,
      ),
    ).resolves.toMatchObject({ status: "ok" })
    expect(upsertActorUserMock).toHaveBeenCalledTimes(1)
    expect(upsertActorUserMock).toHaveBeenLastCalledWith(
      adminActor,
      transaction,
    )
    expect(insert).toHaveBeenCalledTimes(2)
    expect(persistedValues[0]).not.toHaveProperty("fullLogo")
    expect(persistedValues[0]).not.toHaveProperty("iconLogo")
    expect(conflictSets[0]).not.toHaveProperty("fullLogo")
    expect(conflictSets[0]).not.toHaveProperty("iconLogo")
    expect(emitAuditMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        action: "admin.settings.telemetry.enabled",
        correlationId: "settings-telemetry-correlation",
      }),
      transaction,
    )
  })

  it("does not write PostgreSQL Settings outside the receipt callback", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("BFF_FIXTURE_MODE", "false")
    const insert = vi.fn()
    const select = vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn().mockResolvedValue([]),
        })),
      })),
    }))
    getInferenceCoreDbMock.mockReturnValue({ insert, select })
    const commitWithReceipt: NonNullable<
      IdentityMutationRouteContext["commitWithReceipt"]
    > = vi.fn().mockRejectedValue(new Error("receipt transaction unavailable"))

    await expect(
      updateAdminSettingsOrganization(
        adminActor,
        organizationRequest,
        "settings-org-correlation",
        commitWithReceipt,
      ),
    ).rejects.toThrow("receipt transaction unavailable")
    expect(insert).not.toHaveBeenCalled()
    expect(emitAuditMock).not.toHaveBeenCalled()
  })

  it("does not mutate fixture Settings when success audit persistence fails", async () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("BFF_FIXTURE_MODE", "true")

    emitAuditMock.mockRejectedValueOnce(
      new Error("organization audit unavailable"),
    )
    await expect(
      updateAdminSettingsOrganization(adminActor, organizationRequest),
    ).rejects.toThrow("organization audit unavailable")

    emitAuditMock.mockRejectedValueOnce(
      new Error("telemetry audit unavailable"),
    )
    await expect(
      updateAdminSettingsTelemetry(adminActor, telemetryRequest),
    ).rejects.toThrow("telemetry audit unavailable")

    await expect(getAdminSettings(adminActor)).resolves.toMatchObject({
      license: { telemetryOptIn: false },
      organization: {
        defaultLanguage: "en",
        organizationName: "LLM Machines",
        updatedAt: null,
        updatedBy: null,
      },
      privacy: {
        telemetryEnabled: false,
        updatedAt: null,
        updatedBy: null,
      },
    })
  })
})

async function seedFixtureState(): Promise<void> {
  vi.stubEnv("NODE_ENV", "development")
  vi.stubEnv("BFF_FIXTURE_MODE", "true")
  await updateAdminSettingsOrganization(adminActor, organizationRequest)
  await updateAdminSettingsTelemetry(adminActor, telemetryRequest)
}
