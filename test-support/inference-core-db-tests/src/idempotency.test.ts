import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { afterEach, describe, expect, it, vi } from "vitest"
import { getInferenceCoreDb } from "../../../apps/bff/src/db/inference-core-client"
import * as schema from "../../../apps/bff/src/db/inference-core-schema"
import {
  completeIdempotency,
  reserveIdempotency,
  resetIdempotencyForTest,
} from "../../../apps/bff/src/services/idempotency"

vi.mock("../../../apps/bff/src/db/inference-core-client", () => ({
  getInferenceCoreDb: vi.fn(),
}))

const request = {
  actorId: "admin-1",
  correlationId: "request-1",
  idempotencyKey: "raw-idempotency-key",
  requestHash: "a".repeat(64),
  route: "POST /api/admin/applications/connected-apps",
}
const migration = readFileSync(
  fileURLToPath(
    new URL(
      "../../../infra/migrations/0000_inference_core.sql",
      import.meta.url,
    ),
  ),
  "utf8",
)

describe("PostgreSQL idempotency receipts", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    resetIdempotencyForTest()
  })

  it("fails closed without PostgreSQL outside fixture mode", async () => {
    vi.stubEnv("BFF_FIXTURE_MODE", "false")
    vi.stubEnv("NODE_ENV", "production")
    vi.mocked(getInferenceCoreDb).mockReturnValue(null)

    await expect(reserveIdempotency(request)).resolves.toEqual({
      status: "unavailable",
    })
  })

  it("replays only safe completion metadata in fixture memory", async () => {
    vi.mocked(getInferenceCoreDb).mockReturnValue(null)

    const reserved = await reserveIdempotency(request)
    expect(reserved).toMatchObject({ status: "reserved" })
    if (reserved.status !== "reserved") {
      throw new Error("Expected fixture reservation.")
    }

    await expect(reserveIdempotency(request)).resolves.toEqual({
      status: "pending",
    })
    await expect(
      reserveIdempotency({ ...request, requestHash: "b".repeat(64) }),
    ).resolves.toEqual({ status: "conflict" })
    await expect(
      completeIdempotency({
        outcome: "succeeded",
        requestHash: request.requestHash,
        resourceId: "app-safe-receipt",
        statusCode: 201,
        storeKey: reserved.storeKey,
      }),
    ).resolves.toBe(true)
    await expect(
      completeIdempotency({
        outcome: "failed",
        requestHash: request.requestHash,
        statusCode: 500,
        storeKey: reserved.storeKey,
      }),
    ).resolves.toBe(false)

    const replay = await reserveIdempotency(request)
    expect(replay).toEqual({
      receipt: {
        correlationId: request.correlationId,
        outcome: "succeeded",
        resourceId: "app-safe-receipt",
        statusCode: 201,
      },
      status: "replay",
    })
    expect(JSON.stringify(replay)).not.toContain("requestPayload")
    expect(JSON.stringify(replay)).not.toContain("response")
  })

  it("stores a SHA-256 key digest and request fingerprint, never the raw key", async () => {
    let insertedValues: Record<string, unknown> | undefined
    const database = {
      insert: vi.fn(() => ({
        values: vi.fn((values: Record<string, unknown>) => {
          insertedValues = values
          return {
            onConflictDoNothing: vi.fn(() => ({
              returning: vi.fn(async () => [{ id: "ledger-1" }]),
            })),
          }
        }),
      })),
    }
    vi.mocked(getInferenceCoreDb).mockReturnValue(
      database as unknown as ReturnType<typeof getInferenceCoreDb>,
    )

    const result = await reserveIdempotency(request)
    expect(result).toMatchObject({
      status: "reserved",
      storeKey: expect.any(String),
    })
    if (result.status !== "reserved") {
      throw new Error("Expected PostgreSQL reservation.")
    }
    expect(insertedValues?.id).toBe(result.storeKey)

    expect(insertedValues).toMatchObject({
      correlationId: request.correlationId,
      idempotencyKeyDigest: createHash("sha256")
        .update(request.idempotencyKey)
        .digest("hex"),
      operationCode: request.route,
      requestFingerprint: request.requestHash,
      state: "pending",
    })
    expect(insertedValues?.idempotencyKeyDigest).not.toBe(
      request.idempotencyKey,
    )
    expect(insertedValues).not.toHaveProperty("requestPayload")
    expect(insertedValues).not.toHaveProperty("response")
  })

  it("completes the ledger with metadata only", async () => {
    let completedValues: Record<string, unknown> | undefined
    const database = {
      update: vi.fn(() => ({
        set: vi.fn((values: Record<string, unknown>) => {
          completedValues = values
          return {
            where: vi.fn(() => ({
              returning: vi.fn(async () => [{ id: "ledger-1" }]),
            })),
          }
        }),
      })),
    }
    vi.mocked(getInferenceCoreDb).mockReturnValue(
      database as unknown as ReturnType<typeof getInferenceCoreDb>,
    )

    await expect(
      completeIdempotency({
        outcome: "succeeded",
        requestHash: request.requestHash,
        resourceId: "app-safe-receipt",
        statusCode: 201,
        storeKey: "ledger-1",
      }),
    ).resolves.toBe(true)

    expect(completedValues).toMatchObject({
      outcome: "succeeded",
      resourceId: "app-safe-receipt",
      state: "completed",
      statusCode: 201,
    })
    expect(completedValues).not.toHaveProperty("requestPayload")
    expect(completedValues).not.toHaveProperty("response")
  })

  it("rotates the lease id before reusing an expired terminal record", async () => {
    const database = await PGlite.create()
    try {
      await database.exec(migration)
      vi.mocked(getInferenceCoreDb).mockReturnValue(
        drizzle(database, { schema }) as unknown as ReturnType<
          typeof getInferenceCoreDb
        >,
      )

      const first = await reserveIdempotency(request)
      expect(first.status).toBe("reserved")
      if (first.status !== "reserved") {
        throw new Error("Expected an initial PostgreSQL reservation.")
      }
      await expect(
        completeIdempotency({
          outcome: "succeeded",
          requestHash: request.requestHash,
          resourceId: "first-resource",
          statusCode: 201,
          storeKey: first.storeKey,
        }),
      ).resolves.toBe(true)
      await expireLedgerRecord(database, first.storeKey)

      const second = await reserveIdempotency({
        ...request,
        correlationId: "request-2",
      })
      expect(second).toMatchObject({ status: "reserved" })
      if (second.status !== "reserved") {
        throw new Error("Expected a fresh PostgreSQL reservation.")
      }
      expect(second.storeKey).not.toBe(first.storeKey)
      await expect(
        completeIdempotency({
          outcome: "succeeded",
          requestHash: request.requestHash,
          resourceId: "stale-worker-resource",
          statusCode: 201,
          storeKey: first.storeKey,
        }),
      ).resolves.toBe(false)
      await expect(
        completeIdempotency({
          outcome: "succeeded",
          requestHash: request.requestHash,
          resourceId: "second-resource",
          statusCode: 201,
          storeKey: second.storeKey,
        }),
      ).resolves.toBe(true)
    } finally {
      await database.close()
    }
  })

  it("requires reconciliation instead of re-executing an expired pending mutation", async () => {
    const database = await PGlite.create()
    try {
      await database.exec(migration)
      vi.mocked(getInferenceCoreDb).mockReturnValue(
        drizzle(database, { schema }) as unknown as ReturnType<
          typeof getInferenceCoreDb
        >,
      )

      const first = await reserveIdempotency(request)
      expect(first.status).toBe("reserved")
      if (first.status !== "reserved") {
        throw new Error("Expected an initial PostgreSQL reservation.")
      }
      await expireLedgerRecord(database, first.storeKey)

      await expect(reserveIdempotency(request)).resolves.toEqual({
        status: "reconciliation_required",
      })
      const rows = await database.query<{ id: string; state: string }>(
        `SELECT id, state
         FROM admin.idempotency_ledger`,
      )
      expect(rows.rows).toEqual([{ id: first.storeKey, state: "pending" }])
    } finally {
      await database.close()
    }
  })
})

async function expireLedgerRecord(database: PGlite, id: string): Promise<void> {
  await database.query(
    `UPDATE admin.idempotency_ledger
     SET created_at = now() - interval '2 days',
         expires_at = now() - interval '1 day'
     WHERE id = $1`,
    [id],
  )
}
