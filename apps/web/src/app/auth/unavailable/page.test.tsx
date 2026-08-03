import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import IdentityUnavailablePage from "./page"

afterEach(cleanup)

describe("identity-service unavailable page", () => {
  it("preserves one safe retry target without offering a new login", async () => {
    render(
      await IdentityUnavailablePage({
        searchParams: Promise.resolve({ returnTo: "/team?view=members" }),
      }),
    )

    expect(screen.getByRole("heading").textContent).toContain(
      "Identity service temporarily unavailable",
    )
    expect(
      screen.getByRole("link", { name: "Retry" }).getAttribute("href"),
    ).toBe("/team?view=members")
    expect(screen.queryByRole("link", { name: /sign in/i })).toBeNull()
  })

  it("rejects an external retry target", async () => {
    render(
      await IdentityUnavailablePage({
        searchParams: Promise.resolve({
          returnTo: "https://attacker.example.test/",
        }),
      }),
    )

    expect(
      screen.getByRole("link", { name: "Retry" }).getAttribute("href"),
    ).toBe("/")
  })
})
