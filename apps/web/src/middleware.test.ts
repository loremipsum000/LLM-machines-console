import middleware from "@/middleware"
import { type NextFetchEvent, NextRequest } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

type TestAuthRequest = NextRequest & { auth: object | null }
type AuthCallback = (
  request: TestAuthRequest,
  event: NextFetchEvent,
) => Response | Promise<Response> | undefined
type AuthFactory = (
  callback: AuthCallback,
) => (request: NextRequest, event: NextFetchEvent) => ReturnType<AuthCallback>

const authSpies = vi.hoisted(() => ({
  auth: vi.fn<AuthFactory>(),
  session: { current: null as object | null },
}))

vi.mock("@/lib/auth/auth", () => ({
  auth: authSpies.auth,
}))

describe("Console middleware", () => {
  beforeEach(() => {
    authSpies.session.current = null
    authSpies.auth.mockImplementation(
      (callback) => (request, event) =>
        callback(
          Object.assign(request, { auth: authSpies.session.current }),
          event,
        ),
    )
  })

  afterEach(() => {
    authSpies.auth.mockReset()
  })

  it("always protects every retained Console route", async () => {
    const protectedPaths = [
      "/",
      "/activity",
      "/applications",
      "/applications/add",
      "/hardware",
      "/inference",
      "/settings",
      "/team",
      "/team/import/template",
    ]
    for (const pathname of protectedPaths) {
      const response = await runMiddleware(pathname)
      expect(response.status, pathname).toBe(307)
    }
    expect(authSpies.auth).toHaveBeenCalledTimes(protectedPaths.length)
  })

  it("redirects unauthenticated requests with the original callback URL", async () => {
    const response = await runMiddleware(
      "/applications/apps/app-1?tab=credentials",
    )

    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toBe(
      "https://console.example.test/auth/signin?callbackUrl=https%3A%2F%2Fconsole.example.test%2Fapplications%2Fapps%2Fapp-1%3Ftab%3Dcredentials",
    )
  })

  it("lets unknown and retired paths reach the Next 404 boundary", async () => {
    for (const pathname of [
      "/unknown",
      "/chat",
      "/builder",
      "/artifacts/example",
      "/resources",
      "/tasks",
      "/profile",
      "/usage",
      "/inference/model-update",
    ]) {
      const response = await runMiddleware(pathname)
      expect(response.headers.get("x-middleware-next"), pathname).toBe("1")
    }
    expect(authSpies.auth).not.toHaveBeenCalled()
  })

  it("bypasses authentication for public authentication and icon paths", async () => {
    for (const pathname of [
      "/auth/signin",
      "/favicon-32x32.png",
      "/icon.svg",
    ]) {
      const response = await runMiddleware(pathname)
      expect(response.headers.get("x-middleware-next"), pathname).toBe("1")
    }

    expect(authSpies.auth).not.toHaveBeenCalled()
  })

  it("allows retained Admin and Operator sessions through protected routes", async () => {
    for (const role of ["admin", "operator"]) {
      authSpies.session.current = { user: { id: `${role}-1`, roles: [role] } }

      const response = await runMiddleware("/applications")

      expect(response.headers.get("x-middleware-next"), role).toBe("1")
    }
    expect(authSpies.auth).toHaveBeenCalledTimes(2)
  })

  it("forwards a fresh script nonce and returns the same production CSP", async () => {
    const first = await runMiddleware("/auth/signin")
    const second = await runMiddleware("/auth/signin")
    const firstCsp = first.headers.get("content-security-policy")
    const secondCsp = second.headers.get("content-security-policy")
    const scriptPolicy = firstCsp
      ?.split(";")
      .map((directive) => directive.trim())
      .find((directive) => directive.startsWith("script-src "))

    expect(scriptPolicy).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+'$/)
    expect(scriptPolicy).not.toContain("'unsafe-inline'")
    expect(scriptPolicy).not.toContain("'unsafe-eval'")
    expect(
      first.headers.get("x-middleware-request-content-security-policy"),
    ).toBe(firstCsp)
    expect(secondCsp).not.toBe(firstCsp)
  })

  it("redirects authenticated sessions that have only retired or unknown roles", async () => {
    for (const roles of [["auditor"], ["support"], ["realm-admin"], []]) {
      authSpies.session.current = { user: { id: "user-1", roles } }

      const response = await runMiddleware("/team")

      expect(response.status, roles.join(",")).toBe(307)
      expect(response.headers.get("location"), roles.join(",")).toContain(
        "/auth/signin?callbackUrl=",
      )
    }
  })
})

async function runMiddleware(pathname: string): Promise<Response> {
  const response = await middleware(
    new NextRequest(`https://console.example.test${pathname}`),
    {} as NextFetchEvent,
  )
  if (!(response instanceof Response)) {
    throw new Error("Expected middleware to return a Response.")
  }
  return response
}
