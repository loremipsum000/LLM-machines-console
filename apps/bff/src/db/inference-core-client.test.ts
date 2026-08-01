import { readFileSync } from "node:fs"
import { describe, expect, it, vi } from "vitest"
import {
  INFERENCE_CORE_POSTGRES_OPTIONS,
  type InferenceCoreDatabase,
  type InferenceCoreTransaction,
  runInferenceCoreReadSnapshot,
} from "./inference-core-client"

describe("Inference Core PostgreSQL client bounds", () => {
  it("uses one small pool with fixed connection and statement timeouts", () => {
    expect(INFERENCE_CORE_POSTGRES_OPTIONS).toEqual({
      connect_timeout: 3,
      connection: {
        idle_in_transaction_session_timeout: 60_000,
        lock_timeout: 2_000,
        statement_timeout: 10_000,
      },
      max: 5,
    })
  })

  it("uses a read-only repeatable-read transaction for multi-query projections", async () => {
    const snapshot = { kind: "snapshot" } as unknown as InferenceCoreTransaction
    const read = vi.fn(
      async (transaction: InferenceCoreTransaction) => transaction,
    )
    const transaction = vi.fn(
      async (
        run: (
          transaction: InferenceCoreTransaction,
        ) => Promise<InferenceCoreTransaction>,
        _config: unknown,
      ) => run(snapshot),
    )
    const database = { transaction } as unknown as InferenceCoreDatabase

    await expect(runInferenceCoreReadSnapshot(database, read)).resolves.toBe(
      snapshot,
    )
    expect(read).toHaveBeenCalledWith(snapshot)
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      accessMode: "read only",
      isolationLevel: "repeatable read",
    })
  })

  it("requires the batch, inference, and Firecrawl relations for readiness", () => {
    const source = readFileSync(
      new URL("inference-core-client.ts", import.meta.url),
      "utf8",
    )
    expect(source).toContain("admin.identity_mutation_journal_targets")
    expect(source).toContain("admin.application_request_ledger")
    expect(source).toContain("('common.audit_source_cursors')")
    for (const relation of [
      "admin.application_firecrawl_access",
      "admin.application_firecrawl_credentials",
      "admin.application_firecrawl_rate_limit_windows",
      "admin.application_firecrawl_request_ledger",
      "admin.application_firecrawl_usage_daily",
    ]) {
      expect(source).toContain(`('${relation}')`)
    }
  })
})
