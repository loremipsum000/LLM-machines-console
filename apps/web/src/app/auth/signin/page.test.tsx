import { beforeEach, describe, expect, it, vi } from "vitest"
import SignInPage from "./page"

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((href: string) => {
    throw new Error(`redirect:${href}`)
  }),
}))

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }))

beforeEach(() => {
  mocks.redirect.mockClear()
})

describe("Console sign-in page", () => {
  it("redirects directly to the BFF login flow with a safe return target", async () => {
    await expect(
      SignInPage({
        searchParams: Promise.resolve({
          returnTo: "/applications/apps/app-1?tab=credentials",
        }),
      }),
    ).rejects.toThrow(
      "redirect:/api/console/session/login?returnTo=%2Fapplications%2Fapps%2Fapp-1%3Ftab%3Dcredentials",
    )
    expect(mocks.redirect).toHaveBeenCalledOnce()
  })

  it("rejects an external return target while skipping the interstitial", async () => {
    await expect(
      SignInPage({
        searchParams: Promise.resolve({
          returnTo: "https://attacker.example.test/",
          session: "expired",
        }),
      }),
    ).rejects.toThrow("redirect:/api/console/session/login?returnTo=%2F")
    expect(mocks.redirect).toHaveBeenCalledOnce()
  })
})
