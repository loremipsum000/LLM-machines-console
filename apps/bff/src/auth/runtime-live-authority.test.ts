import { afterEach, describe, expect, it, vi } from "vitest"
import { resolveLiveHumanAuthority } from "../services/inference-core-keycloak-admin"
import {
  createTestFixtureAuthorizationOptions,
  resolveRuntimeLiveHumanAuthority,
} from "./runtime-live-authority"

vi.mock("../services/inference-core-keycloak-admin", () => ({
  resolveLiveHumanAuthority: vi.fn(),
}))

const actor = {
  authMode: "keycloak" as const,
  role: "admin" as const,
  subject: "subject-1",
}

describe("runtime live human authority", () => {
  afterEach(() => {
    vi.mocked(resolveLiveHumanAuthority).mockReset()
    vi.unstubAllEnvs()
  })

  it("returns only a subject-bound current authority", async () => {
    vi.mocked(resolveLiveHumanAuthority).mockResolvedValueOnce({
      authority: { enabled: true, role: "operator", subject: "subject-1" },
      status: "ok",
    })

    await expect(
      resolveRuntimeLiveHumanAuthority(actor, {} as never),
    ).resolves.toEqual({
      enabled: true,
      role: "operator",
      subject: "subject-1",
    })
    expect(resolveLiveHumanAuthority).toHaveBeenCalledWith("subject-1")

    vi.mocked(resolveLiveHumanAuthority).mockResolvedValueOnce({
      authority: { enabled: true, role: "admin", subject: "subject-2" },
      status: "ok",
    })
    await expect(
      resolveRuntimeLiveHumanAuthority(actor, {} as never),
    ).resolves.toBeNull()
  })

  it("fails closed for classification denial and every authority service failure", async () => {
    vi.mocked(resolveLiveHumanAuthority).mockResolvedValueOnce({
      authority: null,
      reason: "ambiguous_role",
      status: "denied",
    })
    await expect(
      resolveRuntimeLiveHumanAuthority(actor, {} as never),
    ).resolves.toBeNull()

    for (const status of [
      "not_configured",
      "invalid",
      "unauthorized",
      "unavailable",
    ] as const) {
      vi.mocked(resolveLiveHumanAuthority).mockResolvedValueOnce({
        authority: null,
        reason: "authority_unavailable",
        status,
      })
      await expect(
        resolveRuntimeLiveHumanAuthority(actor, {} as never),
      ).rejects.toThrow("Live human authority is unavailable.")
    }
  })

  it("keeps the structural fixture authority test-only", () => {
    vi.stubEnv("NODE_ENV", "production")

    expect(() => createTestFixtureAuthorizationOptions(null)).toThrow(
      "Test fixture authority is available only in tests.",
    )
  })
})
