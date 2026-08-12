import { describe, expect, it, vi } from "vitest"
import {
  pendingSessionRecoveryHref,
  probePendingConsoleSession,
} from "./pending-session-recovery"

describe("pending Console session recovery", () => {
  it.each([
    ["https://console.example.test/applications", 200, "active"],
    [
      "https://console.example.test/auth/signin?session=expired&returnTo=%2Fapplications",
      200,
      "terminal",
    ],
    [
      "https://console.example.test/auth/unavailable?returnTo=%2Fapplications",
      200,
      "unavailable",
    ],
    ["https://console.example.test/applications", 500, "unknown"],
    ["https://attacker.invalid/applications", 200, "unknown"],
  ] as const)(
    "maps %s with status %s to %s",
    async (url, responseStatus, expected) => {
      const fetcher = vi.fn(async () => responseAt(url, responseStatus))

      await expect(
        probePendingConsoleSession(
          "/applications",
          fetcher,
          "https://console.example.test",
        ),
      ).resolves.toBe(expected)
      expect(fetcher).toHaveBeenCalledWith(
        "/applications",
        expect.objectContaining({
          cache: "no-store",
          credentials: "same-origin",
          method: "HEAD",
          redirect: "follow",
        }),
      )
    },
  )

  it("uses one safe expired-session redirect for terminal custody", () => {
    expect(
      pendingSessionRecoveryHref(
        "terminal",
        "/applications/apps/app-1?tab=credentials",
        1_000,
      ),
    ).toBe(
      "/auth/signin?session=expired&returnTo=%2Fapplications%2Fapps%2Fapp-1%3Ftab%3Dcredentials",
    )
  })

  it("keeps identity unavailability recoverable without logout", () => {
    expect(
      pendingSessionRecoveryHref("unavailable", "/applications", 1_000),
    ).toBe("/auth/unavailable?returnTo=%2Fapplications")
  })

  it("fails a long-running action closed through a same-page reload", () => {
    expect(
      pendingSessionRecoveryHref("active", "/applications", 14_999),
    ).toBeNull()
    expect(pendingSessionRecoveryHref("unknown", "/applications", 15_000)).toBe(
      "/applications",
    )
    expect(
      pendingSessionRecoveryHref(
        "active",
        "https://attacker.invalid/steal",
        15_000,
      ),
    ).toBe("/")
  })
})

function responseAt(url: string, status: number): Response {
  return {
    body: null,
    ok: status >= 200 && status < 300,
    status,
    url,
  } as Response
}
