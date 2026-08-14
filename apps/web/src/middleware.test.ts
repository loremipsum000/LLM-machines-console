import middleware from "@/middleware"
import { NextRequest } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const sessionHandle = "A".repeat(43)
const mocks = vi.hoisted(() => ({
  opaqueConsoleSessionHandle: vi.fn(),
  resolveConsoleSession: vi.fn(),
}))

vi.mock("@/lib/auth/session-client", () => ({
  CONSOLE_SESSION_COOKIE: "__Host-llm-machines-session",
  CONSOLE_SESSION_MAX_AGE_SECONDS: 28800,
  opaqueConsoleSessionHandle: mocks.opaqueConsoleSessionHandle,
  resolveConsoleSession: mocks.resolveConsoleSession,
}))

describe("Console middleware", () => {
  beforeEach(() => {
    mocks.opaqueConsoleSessionHandle.mockImplementation((cookie?: string) => {
      const values = (cookie?.split(";") ?? [])
        .map((entry) => entry.trim())
        .filter((entry) => entry.startsWith("__Host-llm-machines-session="))
        .map((entry) => entry.slice(entry.indexOf("=") + 1))
      return values.length === 1 && /^[A-Za-z0-9_-]{43}$/.test(values[0] ?? "")
        ? values[0]
        : null
    })
    mocks.resolveConsoleSession.mockResolvedValue({
      session: {
        groups: [],
        mfaVerifiedAt: null,
        role: "operator",
        subject: "operator-1",
      },
      state: "active",
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it("protects every retained Console route with a path-only return target", async () => {
    const protectedPaths = [
      "/",
      "/activity",
      "/applications",
      "/applications/add",
      "/api/admin/audit/export",
      "/api/admin/audit/export/verification-keys",
      "/hardware",
      "/inference",
      "/settings",
      "/team",
      "/team/import/template",
    ]
    for (const pathname of protectedPaths) {
      const response = await runMiddleware(pathname)
      expect(response.status, pathname).toBe(307)
      expect(response.headers.get("location"), pathname).toContain(
        "/auth/signin?returnTo=",
      )
    }
    expect(mocks.resolveConsoleSession).not.toHaveBeenCalled()
  })

  it("never places an origin in the sign-in return target", async () => {
    const response = await runMiddleware(
      "/applications/apps/app-1?tab=credentials",
    )

    expect(response.headers.get("location")).toBe(
      "https://console.example.test/auth/signin?returnTo=%2Fapplications%2Fapps%2Fapp-1%3Ftab%3Dcredentials",
    )
    expect(response.headers.get("location")).not.toContain("returnTo=https%3A")
  })

  it("clears malformed and duplicate host cookies with explicit expiry", async () => {
    const cases = [
      {
        cookie: "__Host-llm-machines-session=not-opaque",
        expectedLocation:
          "https://console.example.test/auth/signin?session=expired&returnTo=%2Fapi%2Fadmin%2Faudit%2Fexport%3Fformat%3Djson",
        pathname: "/api/admin/audit/export?format=json",
      },
      {
        cookie: `__Host-llm-machines-session=${sessionHandle}; __Host-llm-machines-session=${"B".repeat(43)}`,
        expectedLocation:
          "https://console.example.test/auth/signin?session=expired&returnTo=%2Fapplications",
        pathname: "/applications",
      },
    ]

    for (const testCase of cases) {
      const response = await runMiddleware(testCase.pathname, testCase.cookie)
      const setCookie = response.headers.get("set-cookie") ?? ""

      expect(response.status, testCase.pathname).toBe(307)
      expect(response.headers.get("location"), testCase.pathname).toBe(
        testCase.expectedLocation,
      )
      expect(setCookie, testCase.pathname).toContain(
        "__Host-llm-machines-session=",
      )
      expect(setCookie, testCase.pathname).toContain("Max-Age=0")
      expect(setCookie, testCase.pathname).not.toContain("Domain=")
    }
    expect(mocks.resolveConsoleSession).not.toHaveBeenCalled()
  })

  it("slides an active host-only opaque cookie for exactly eight hours", async () => {
    const response = await runMiddleware("/applications", true)
    const setCookie = response.headers.get("set-cookie") ?? ""

    expect(response.headers.get("x-middleware-next")).toBe("1")
    expect(mocks.resolveConsoleSession).toHaveBeenCalledWith(
      `__Host-llm-machines-session=${sessionHandle}`,
    )
    expect(setCookie).toContain(`__Host-llm-machines-session=${sessionHandle}`)
    expect(setCookie).toContain("Path=/")
    expect(setCookie).toContain("Max-Age=28800")
    expect(setCookie).toContain("HttpOnly")
    expect(setCookie).toContain("Secure")
    expect(setCookie).toContain("SameSite=lax")
    expect(setCookie).not.toContain("Domain=")
  })

  it("clears a terminal cookie and redirects once with explicit expiry", async () => {
    mocks.resolveConsoleSession.mockResolvedValue({
      reason: "expired",
      state: "terminal",
    })

    const response = await runMiddleware("/settings?tab=updates", true)
    const setCookie = response.headers.get("set-cookie") ?? ""

    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toBe(
      "https://console.example.test/auth/signin?session=expired&returnTo=%2Fsettings%3Ftab%3Dupdates",
    )
    expect(setCookie).toContain("__Host-llm-machines-session=")
    expect(setCookie).toContain("Max-Age=0")
    expect(setCookie).toContain("Path=/")
    expect(setCookie).toContain("HttpOnly")
    expect(setCookie).toContain("Secure")
    expect(setCookie).toContain("SameSite=lax")
    expect(setCookie).not.toContain("Domain=")
  })

  it("clears a later terminal transition on the one-time sign-in landing", async () => {
    mocks.resolveConsoleSession.mockResolvedValue({
      reason: "revoked",
      state: "terminal",
    })

    const response = await runMiddleware(
      "/auth/signin?session=expired&returnTo=%2Fapplications",
      true,
    )
    const setCookie = response.headers.get("set-cookie") ?? ""

    expect(response.headers.get("x-middleware-next")).toBe("1")
    expect(response.headers.get("location")).toBeNull()
    expect(mocks.resolveConsoleSession).toHaveBeenCalledOnce()
    expect(setCookie).toContain("__Host-llm-machines-session=")
    expect(setCookie).toContain("Max-Age=0")
    expect(setCookie).not.toContain("Domain=")
  })

  it("does not let an expired query clear a still-active session", async () => {
    const response = await runMiddleware(
      "/auth/signin?session=expired&returnTo=%2Fapplications",
      true,
    )

    expect(response.headers.get("x-middleware-next")).toBe("1")
    expect(response.headers.get("set-cookie")).toBeNull()
    expect(response.headers.get("location")).toBeNull()
    expect(mocks.resolveConsoleSession).toHaveBeenCalledOnce()
  })

  it("preserves the cookie when the one-time sign-in check is unavailable", async () => {
    mocks.resolveConsoleSession.mockResolvedValue({
      reason: "identity_unavailable",
      retryable: true,
      state: "unavailable",
    })

    const response = await runMiddleware(
      "/auth/signin?session=expired&returnTo=%2Fsettings%3Ftab%3Dupdates",
      true,
    )

    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toBe(
      "https://console.example.test/auth/unavailable?returnTo=%2Fsettings%3Ftab%3Dupdates",
    )
    expect(response.headers.get("set-cookie")).toBeNull()
    expect(response.headers.get("x-middleware-rewrite")).toBeNull()
  })

  it("clears an expired audit-download session and preserves one safe return path", async () => {
    mocks.resolveConsoleSession.mockResolvedValue({
      reason: "expired",
      state: "terminal",
    })

    const response = await runMiddleware(
      "/api/admin/audit/export?format=json",
      true,
    )
    const setCookie = response.headers.get("set-cookie") ?? ""

    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toBe(
      "https://console.example.test/auth/signin?session=expired&returnTo=%2Fapi%2Fadmin%2Faudit%2Fexport%3Fformat%3Djson",
    )
    expect(response.headers.get("location")).not.toContain("returnTo=https%3A")
    expect(setCookie).toContain("__Host-llm-machines-session=")
    expect(setCookie).toContain("Max-Age=0")
  })

  it("redirects to controlled recovery without clearing an eligible cookie", async () => {
    mocks.resolveConsoleSession.mockResolvedValue({
      reason: "identity_unavailable",
      retryable: true,
      state: "unavailable",
    })

    const response = await runMiddleware("/team?view=members", true)

    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toBe(
      "https://console.example.test/auth/unavailable?returnTo=%2Fteam%3Fview%3Dmembers",
    )
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0")
    expect(response.headers.get("set-cookie")).toBeNull()
    expect(response.headers.get("x-middleware-rewrite")).toBeNull()
  })

  it("keeps an audit-download session during an outage without a redirect loop", async () => {
    mocks.resolveConsoleSession.mockResolvedValue({
      reason: "identity_unavailable",
      retryable: true,
      state: "unavailable",
    })

    const response = await runMiddleware(
      "/api/admin/audit/export/verification-keys",
      true,
    )

    expect(response.status).toBe(503)
    expect(response.headers.get("x-middleware-rewrite")).toBeNull()
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0")
    expect(response.headers.get("set-cookie")).toBeNull()
    expect(response.headers.get("location")).toBeNull()
  })

  it("bypasses auth pages, session endpoints, assets, and retired paths", async () => {
    for (const pathname of [
      "/auth/signin",
      "/auth/unavailable",
      "/api/console/session/login",
      "/api/console/session/callback",
      "/api/console/session/logout",
      "/api/console/session/elevate",
      "/api/internal/console-session/resolve",
      "/api/admin/audit/export/extra",
      "/api/admin/audit/exported",
      "/favicon-32x32.png",
      "/icon.svg",
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
      const response = await runMiddleware(pathname, true)
      expect(response.headers.get("x-middleware-next"), pathname).toBe("1")
    }
    expect(mocks.resolveConsoleSession).not.toHaveBeenCalled()
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
})

async function runMiddleware(
  pathname: string,
  withSession: boolean | string = false,
): Promise<Response> {
  const request = new NextRequest(`https://console.example.test${pathname}`, {
    headers: withSession
      ? {
          cookie:
            typeof withSession === "string"
              ? withSession
              : `__Host-llm-machines-session=${sessionHandle}`,
        }
      : undefined,
  })
  const response = await middleware(request)
  if (!(response instanceof Response)) {
    throw new Error("Expected middleware to return a Response.")
  }
  return response
}
