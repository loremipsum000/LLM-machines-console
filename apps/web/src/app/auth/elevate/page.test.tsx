import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import ElevationPage, { metadata } from "./page"

const mocks = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error("not-found")
  }),
}))

vi.mock("next/navigation", () => ({ notFound: mocks.notFound }))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("Console high-risk elevation page", () => {
  it("allows the native same-origin POST to carry the exact Console Origin", () => {
    expect(metadata).toEqual({ referrer: "same-origin" })
  })

  it("requires a deliberate POST with a bound action and path-only return", async () => {
    render(
      await ElevationPage({
        searchParams: Promise.resolve({
          action: "applications.credentials.test_rotate_revoke",
          returnTo: "/applications/apps/app-1?tab=credentials",
        }),
      }),
    )

    const form = screen
      .getByRole("button", {
        name: "Continue to verification",
      })
      .closest("form")
    expect(form?.getAttribute("action")).toBe("/api/console/session/elevate")
    expect(form?.getAttribute("method")).toBe("post")
    expect(
      form?.querySelector<HTMLInputElement>('input[name="action"]')?.value,
    ).toBe("applications.credentials.test_rotate_revoke")
    expect(
      form?.querySelector<HTMLInputElement>('input[name="returnTo"]')?.value,
    ).toBe("/applications/apps/app-1?tab=credentials")
  })

  it("rejects an unbound action instead of reflecting it into the form", async () => {
    await expect(
      ElevationPage({
        searchParams: Promise.resolve({
          action: "custom.unbound.action",
          returnTo: "https://attacker.example.test/",
        }),
      }),
    ).rejects.toThrow("not-found")
    expect(mocks.notFound).toHaveBeenCalledOnce()
  })
})
