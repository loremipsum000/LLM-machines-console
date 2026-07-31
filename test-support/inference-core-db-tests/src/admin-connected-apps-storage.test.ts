import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Actor } from "../../../apps/bff/src/auth/authorization"
import { getInferenceCoreDb } from "../../../apps/bff/src/db/inference-core-client"
import * as schema from "../../../apps/bff/src/db/inference-core-schema"
import {
  createAdminConnectedApp,
  resolveConnectedAppRuntimeIdentityByApiKey,
  rotateAdminConnectedAppCredentials,
} from "../../../apps/bff/src/services/admin-connected-apps"

vi.mock("../../../apps/bff/src/db/inference-core-client", () => ({
  getInferenceCoreDb: vi.fn(),
}))

const migration = readFileSync(
  fileURLToPath(
    new URL(
      "../../../infra/migrations/0000_inference_core.sql",
      import.meta.url,
    ),
  ),
  "utf8",
)
const actor: Actor = {
  authMode: "service-forwarded",
  role: "admin",
  subject: "admin-storage-test",
}

let database: PGlite

describe("connected app credential lifecycle in PostgreSQL", () => {
  beforeEach(async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-07-31T12:00:00.000Z"))
    vi.stubEnv("CONNECTED_APPS_KEYCLOAK_FIXTURE", "true")
    database = await PGlite.create()
    await database.exec(migration)
    vi.mocked(getInferenceCoreDb).mockReturnValue(
      drizzle(database, { schema }) as unknown as ReturnType<
        typeof getInferenceCoreDb
      >,
    )
  })

  afterEach(async () => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    await database.close()
  })

  it("retires a static key for 24 hours and then records revocation", async () => {
    const created = await createAdminConnectedApp(
      actor,
      connectedAppRequest("api_key"),
    )
    expect(created.status).toBe("created")
    if (created.status !== "created" || !created.credential.apiKey) {
      throw new Error("Expected a static connected-app credential.")
    }
    const oldKey = created.credential.apiKey

    const rotated = await rotateAdminConnectedAppCredentials(
      actor,
      created.app.id,
    )
    expect(rotated.status).toBe("rotated")
    if (rotated.status !== "rotated" || !rotated.credential.apiKey) {
      throw new Error("Expected a rotated static credential.")
    }

    const lifecycle = await credentialLifecycle(created.app.id)
    expect(lifecycle).toEqual([
      {
        overlap_expires_at: null,
        revoked_at: null,
        rotated_at: null,
        status: "active",
      },
      {
        overlap_expires_at: new Date("2026-08-01T12:00:00.000Z"),
        revoked_at: null,
        rotated_at: new Date("2026-07-31T12:00:00.000Z"),
        status: "retiring",
      },
    ])
    await expect(
      resolveConnectedAppRuntimeIdentityByApiKey(oldKey),
    ).resolves.toMatchObject({ appId: created.app.id })
    await expect(
      resolveConnectedAppRuntimeIdentityByApiKey(rotated.credential.apiKey),
    ).resolves.toMatchObject({ appId: created.app.id })

    vi.setSystemTime(new Date("2026-08-01T12:00:00.001Z"))
    await expect(
      resolveConnectedAppRuntimeIdentityByApiKey(oldKey),
    ).resolves.toBeNull()
    const expired = await credentialLifecycle(created.app.id)
    expect(expired.find((row) => row.status === "revoked")).toMatchObject({
      overlap_expires_at: new Date("2026-08-01T12:00:00.000Z"),
      revoked_at: new Date("2026-08-01T12:00:00.001Z"),
      rotated_at: new Date("2026-07-31T12:00:00.000Z"),
    })
  })

  it("keeps at most one retiring key across rapid static rotations", async () => {
    const created = await createAdminConnectedApp(
      actor,
      connectedAppRequest("api_key"),
    )
    expect(created.status).toBe("created")
    if (created.status !== "created" || !created.credential.apiKey) {
      throw new Error("Expected the initial static credential.")
    }
    const firstKey = created.credential.apiKey

    vi.setSystemTime(new Date("2026-07-31T12:10:00.000Z"))
    const firstRotation = await rotateAdminConnectedAppCredentials(
      actor,
      created.app.id,
    )
    expect(firstRotation.status).toBe("rotated")
    if (
      firstRotation.status !== "rotated" ||
      !firstRotation.credential.apiKey
    ) {
      throw new Error("Expected the first rotated static credential.")
    }

    vi.setSystemTime(new Date("2026-07-31T12:20:00.000Z"))
    const secondRotation = await rotateAdminConnectedAppCredentials(
      actor,
      created.app.id,
    )
    expect(secondRotation.status).toBe("rotated")
    if (
      secondRotation.status !== "rotated" ||
      !secondRotation.credential.apiKey
    ) {
      throw new Error("Expected the second rotated static credential.")
    }

    await expect(
      resolveConnectedAppRuntimeIdentityByApiKey(firstKey),
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

    expect(await credentialLifecycleByIssueTime(created.app.id)).toEqual([
      {
        overlap_expires_at: new Date("2026-08-01T12:10:00.000Z"),
        revoked_at: new Date("2026-07-31T12:20:00.000Z"),
        rotated_at: new Date("2026-07-31T12:10:00.000Z"),
        status: "revoked",
      },
      {
        overlap_expires_at: new Date("2026-08-01T12:20:00.000Z"),
        revoked_at: null,
        rotated_at: new Date("2026-07-31T12:20:00.000Z"),
        status: "retiring",
      },
      {
        overlap_expires_at: null,
        revoked_at: null,
        rotated_at: null,
        status: "active",
      },
    ])
  })

  it("keeps the OAuth credential unchanged while rotation is deferred", async () => {
    const created = await createAdminConnectedApp(
      actor,
      connectedAppRequest("oauth_client_credentials"),
    )
    expect(created.status).toBe("created")
    if (created.status !== "created") {
      throw new Error("Expected an OAuth connected-app credential.")
    }

    const before = await credentialRows(created.app.id)
    vi.setSystemTime(new Date("2026-07-31T13:00:00.000Z"))
    const rotated = await rotateAdminConnectedAppCredentials(
      actor,
      created.app.id,
    )
    expect(rotated.status).toBe("blocked")
    expect(await credentialRows(created.app.id)).toEqual(before)
    expect(before).toHaveLength(1)
    expect(before[0]).toMatchObject({ status: "active" })
  })
})

function connectedAppRequest(
  authMethod: "api_key" | "oauth_client_credentials",
) {
  return {
    allowedModels: ["local-a"],
    authMethod,
    description: "PostgreSQL lifecycle test.",
    name: `Lifecycle ${authMethod}`,
    ownerGroup: "Administrators",
    rateLimitRpm: null,
    tokenBudget7d: null,
  }
}

async function credentialLifecycle(appId: string) {
  const result = await database.query<{
    overlap_expires_at: Date | null
    revoked_at: Date | null
    rotated_at: Date | null
    status: string
  }>(
    `SELECT overlap_expires_at, revoked_at, rotated_at, status
     FROM admin.application_credentials
     WHERE app_id = $1
     ORDER BY status`,
    [appId],
  )
  return result.rows
}

async function credentialLifecycleByIssueTime(appId: string) {
  const result = await database.query<{
    overlap_expires_at: Date | null
    revoked_at: Date | null
    rotated_at: Date | null
    status: string
  }>(
    `SELECT overlap_expires_at, revoked_at, rotated_at, status
     FROM admin.application_credentials
     WHERE app_id = $1
     ORDER BY issued_at`,
    [appId],
  )
  return result.rows
}

async function credentialRows(appId: string) {
  const result = await database.query(
    `SELECT *
     FROM admin.application_credentials
     WHERE app_id = $1
     ORDER BY id`,
    [appId],
  )
  return result.rows
}
