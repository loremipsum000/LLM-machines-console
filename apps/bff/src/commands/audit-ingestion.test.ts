import { afterEach, describe, expect, it, vi } from "vitest"
import {
  closeInferenceCoreDb,
  getInferenceCoreDb,
} from "../db/inference-core-client"
import {
  formatAuditIngestionCommandFailure,
  runAuditIngestionCommand,
} from "./audit-ingestion"

vi.mock("../db/inference-core-client", () => ({
  closeInferenceCoreDb: vi.fn(),
  getInferenceCoreDb: vi.fn(),
}))

describe("one-shot native audit ingestion command", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it("fails before database access without configured qualified sources", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://configured.test/appliance")

    await expect(runAuditIngestionCommand([], vi.fn())).rejects.toThrow(
      "At least one qualified native audit source is required.",
    )
    expect(getInferenceCoreDb).not.toHaveBeenCalled()
    expect(closeInferenceCoreDb).not.toHaveBeenCalled()
  })

  it("formats arbitrary failures without leaking native or database detail", () => {
    const message = formatAuditIngestionCommandFailure(
      new Error(
        "fetch https://grafana.internal/api failed with bearer secret-value",
      ),
    )

    expect(JSON.parse(message)).toEqual({
      event: "audit_ingestion_failed",
      failureClass: "ingestion_execution_failed",
    })
    expect(message).not.toMatch(/grafana\.internal|secret-value|bearer/i)
  })
})
