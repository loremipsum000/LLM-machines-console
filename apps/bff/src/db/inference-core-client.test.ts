import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { INFERENCE_CORE_POSTGRES_OPTIONS } from "./inference-core-client"

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

  it("requires the batch target and request-ledger relations for readiness", () => {
    const source = readFileSync(
      new URL("inference-core-client.ts", import.meta.url),
      "utf8",
    )
    expect(source).toContain("admin.identity_mutation_journal_targets")
    expect(source).toContain("admin.application_request_ledger")
  })
})
