import { type NextFetchEvent, NextRequest } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import middleware from "@/middleware"

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
      "/applications",
      "/applications/add",
      "/hardware",
      "/inference",
      "/inference/model-update",
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
      "/knowledge",
      "/builder",
      "/artifacts/example",
      "/resources",
      "/tasks",
      "/profile",
      "/usage",
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

  it("allows authenticated sessions through retained protected routes", async () => {
    authSpies.session.current = { user: { id: "admin-1" } }

    const response = await runMiddleware("/applications")

    expect(response.headers.get("x-middleware-next")).toBe("1")
    expect(authSpies.auth).toHaveBeenCalledTimes(1)
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
