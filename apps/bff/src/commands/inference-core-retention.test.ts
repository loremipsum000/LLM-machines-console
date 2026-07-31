import { afterEach, describe, expect, it, vi } from "vitest"
import {
  closeInferenceCoreDb,
  getInferenceCoreDb,
} from "../db/inference-core-client"
import {
  formatRetentionCommandFailure,
  runRetentionCommand,
} from "./inference-core-retention"

vi.mock("../db/inference-core-client", () => ({
  closeInferenceCoreDb: vi.fn(),
  getInferenceCoreDb: vi.fn(),
}))

describe("Inference Core retention command", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it.each(["", "   "])(
    "fails before database access when DATABASE_URL is %j",
    async (databaseUrl) => {
      vi.stubEnv("DATABASE_URL", databaseUrl)

      await expect(runRetentionCommand(vi.fn())).rejects.toThrow(
        "DATABASE_URL is required for the Inference Core retention command.",
      )
      expect(getInferenceCoreDb).not.toHaveBeenCalled()
      expect(closeInferenceCoreDb).not.toHaveBeenCalled()
    },
  )

  it("formats execution failures without exposing arbitrary database details", () => {
    const internalDetail =
      "connect ECONNREFUSED postgres://db.internal:5432 schema admin.application_usage_daily"

    const message = formatRetentionCommandFailure(new Error(internalDetail))

    expect(JSON.parse(message)).toEqual({
      event: "inference_core_retention_failed",
      failureClass: "retention_execution_failed",
    })
    expect(message).not.toContain("db.internal")
    expect(message).not.toContain("application_usage_daily")
    expect(message).not.toContain("ECONNREFUSED")
  })

  it("uses bounded classifications for known startup failures", () => {
    expect(
      JSON.parse(
        formatRetentionCommandFailure(
          new Error(
            "DATABASE_URL is required for the Inference Core retention command.",
          ),
        ),
      ),
    ).toMatchObject({ failureClass: "configuration_missing" })
    expect(
      JSON.parse(
        formatRetentionCommandFailure(
          new Error("The Inference Core retention database is unavailable."),
        ),
      ),
    ).toMatchObject({ failureClass: "database_unavailable" })
  })
})
