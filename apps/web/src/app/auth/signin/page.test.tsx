import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import SignInPage from "./page"

afterEach(cleanup)

describe("Console sign-in page", () => {
  it("starts the BFF login flow with only a path-relative return target", async () => {
    render(
      await SignInPage({
        searchParams: Promise.resolve({
          returnTo: "/applications/apps/app-1?tab=credentials",
        }),
      }),
    )

    expect(
      screen.getByRole("link", { name: /keycloak/i }).getAttribute("href"),
    ).toBe(
      "/api/console/session/login?returnTo=%2Fapplications%2Fapps%2Fapp-1%3Ftab%3Dcredentials",
    )
    expect(screen.queryByText(/session expired/i)).toBeNull()
  })

  it("shows explicit expiry and rejects an external return target", async () => {
    render(
      await SignInPage({
        searchParams: Promise.resolve({
          returnTo: "https://attacker.example.test/",
          session: "expired",
        }),
      }),
    )

    expect(screen.getByRole("status").textContent).toContain("session expired")
    expect(
      screen.getByRole("link", { name: /keycloak/i }).getAttribute("href"),
    ).toBe("/api/console/session/login?returnTo=%2F")
  })
})
