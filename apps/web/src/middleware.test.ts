import { type NextFetchEvent, NextRequest } from "next/server"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  getSignInRedirectUrl,
  isHubAuthRequired,
} from "@/lib/auth/middleware-policy"
import middleware from "@/middleware"

const authSpies = vi.hoisted(() => {
  const authenticatedMiddleware = vi.fn(
    () => new Response(null, { status: 204 }),
  )
  return {
    auth: vi.fn(() => authenticatedMiddleware),
    authenticatedMiddleware,
  }
})

vi.mock("@/lib/auth/auth", () => ({
  auth: authSpies.auth,
}))

describe("Hub middleware helpers", () => {
  afterEach(() => {
    authSpies.auth.mockClear()
    authSpies.authenticatedMiddleware.mockClear()
    vi.unstubAllEnvs()
  })

  it("keeps local fixture mode open by default", () => {
    expect(isHubAuthRequired({ NODE_ENV: "development" })).toBe(false)
  })

  it("requires auth for production BFF-backed runtimes", () => {
    expect(
      isHubAuthRequired({
        CONSOLE_BFF_URL: "https://bff.example.test",
        NODE_ENV: "production",
      }),
    ).toBe(true)
  })

  it("allows explicit auth requirement override", () => {
    expect(
      isHubAuthRequired({
        CONSOLE_REQUIRE_AUTH: "true",
        NODE_ENV: "development",
      }),
    ).toBe(true)
    expect(
      isHubAuthRequired({
        CONSOLE_BFF_URL: "https://bff.example.test",
        CONSOLE_REQUIRE_AUTH: "false",
        NODE_ENV: "production",
      }),
    ).toBe(false)
  })

  it("builds Auth.js sign-in redirects with the original callback URL", () => {
    const redirectUrl = getSignInRedirectUrl(
      "https://console.example.test/resources",
    )

    expect(redirectUrl.toString()).toBe(
      "https://console.example.test/auth/signin?callbackUrl=https%3A%2F%2Fconsole.example.test%2Fresources",
    )
  })

  it("bypasses Auth.js middleware for local fixture-mode routes", () => {
    vi.stubEnv("NODE_ENV", "development")

    middleware(
      new NextRequest("http://localhost:3001/builder"),
      {} as NextFetchEvent,
    )

    expect(authSpies.authenticatedMiddleware).not.toHaveBeenCalled()
    expect(authSpies.auth).not.toHaveBeenCalled()
  })

  it("bypasses Auth.js middleware for favicon assets", () => {
    vi.stubEnv("CONSOLE_BFF_URL", "https://bff.example.test")
    vi.stubEnv("NODE_ENV", "production")

    middleware(
      new NextRequest("https://console.example.test/favicon-32x32.png"),
      {} as NextFetchEvent,
    )
    middleware(
      new NextRequest("https://console.example.test/icon.svg"),
      {} as NextFetchEvent,
    )

    expect(authSpies.authenticatedMiddleware).not.toHaveBeenCalled()
    expect(authSpies.auth).not.toHaveBeenCalled()
  })

  it("runs Auth.js middleware for BFF-backed production routes", () => {
    vi.stubEnv("CONSOLE_BFF_URL", "https://bff.example.test")
    vi.stubEnv("NODE_ENV", "production")

    middleware(
      new NextRequest("https://console.example.test/knowledge"),
      {} as NextFetchEvent,
    )

    expect(authSpies.auth).toHaveBeenCalledTimes(1)
    expect(authSpies.authenticatedMiddleware).toHaveBeenCalledTimes(1)
  })
})
