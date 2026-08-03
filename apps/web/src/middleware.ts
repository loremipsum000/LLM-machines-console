import { normalizeConsoleReturnPath } from "@/lib/auth/safe-return"
import {
  CONSOLE_SESSION_COOKIE,
  CONSOLE_SESSION_MAX_AGE_SECONDS,
  opaqueConsoleSessionHandle,
  resolveConsoleSession,
} from "@/lib/auth/session-client"
import { buildContentSecurityPolicy } from "@/lib/security/content-security-policy"
import { type NextRequest, NextResponse } from "next/server"

const PUBLIC_ASSET_PATHS = new Set([
  "/apple-touch-icon.png",
  "/favicon-16x16.png",
  "/favicon-32x32.png",
  "/favicon-48x48.png",
  "/favicon.ico",
  "/icon.svg",
])

const PROTECTED_AUDIT_DOWNLOAD_PATHS = new Set([
  "/api/admin/audit/export",
  "/api/admin/audit/export/verification-keys",
])

export default async function middleware(request: NextRequest) {
  const contentSecurityPolicy = createContentSecurityPolicy(request)
  if (
    request.nextUrl.pathname.startsWith("/auth/") ||
    isConsoleSessionEndpoint(request.nextUrl.pathname) ||
    PUBLIC_ASSET_PATHS.has(request.nextUrl.pathname) ||
    !isProtectedConsolePath(request.nextUrl.pathname)
  ) {
    return contentSecurityPolicy.next()
  }

  const returnTo = normalizeConsoleReturnPath(
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
  )
  const cookieHeader = request.headers.get("cookie")
  const sessionHandle = opaqueConsoleSessionHandle(cookieHeader)
  if (!sessionHandle) {
    const invalidCookie = hasConsoleSessionCookie(cookieHeader)
    const response = contentSecurityPolicy.redirect(
      getSignInRedirectUrl(request.nextUrl, returnTo, invalidCookie),
    )
    if (invalidCookie) {
      clearSessionCookie(response)
      response.headers.set("Cache-Control", "no-store, max-age=0")
    }
    return response
  }

  const resolution = await resolveConsoleSession(cookieHeader)
  if (resolution.state === "active") {
    const response = contentSecurityPolicy.next()
    setSlidingSessionCookie(response, sessionHandle)
    return response
  }
  if (resolution.state === "unavailable") {
    const response = contentSecurityPolicy.rewrite(
      getUnavailableUrl(request.nextUrl, returnTo),
      503,
    )
    response.headers.set("Cache-Control", "no-store, max-age=0")
    return response
  }

  const response = contentSecurityPolicy.redirect(
    getSignInRedirectUrl(request.nextUrl, returnTo, true),
  )
  clearSessionCookie(response)
  response.headers.set("Cache-Control", "no-store, max-age=0")
  return response
}

function createContentSecurityPolicy(request: NextRequest): {
  next(): NextResponse
  redirect(url: URL): NextResponse
  rewrite(url: URL, status: number): NextResponse
} {
  const nonce = btoa(crypto.randomUUID())
  const value = buildContentSecurityPolicy(nonce)
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set("content-security-policy", value)

  const setResponseHeader = (response: NextResponse): NextResponse => {
    response.headers.set("Content-Security-Policy", value)
    return response
  }

  return {
    next: () =>
      setResponseHeader(
        NextResponse.next({
          request: { headers: requestHeaders },
        }),
      ),
    redirect: (url) => setResponseHeader(NextResponse.redirect(url)),
    rewrite: (url, status) =>
      setResponseHeader(NextResponse.rewrite(url, { status })),
  }
}

function isProtectedConsolePath(pathname: string): boolean {
  return (
    pathname === "/" ||
    pathname === "/activity" ||
    pathname === "/hardware" ||
    pathname === "/inference" ||
    pathname === "/settings" ||
    PROTECTED_AUDIT_DOWNLOAD_PATHS.has(pathname) ||
    isPathWithin(pathname, "/applications") ||
    isPathWithin(pathname, "/team")
  )
}

function getSignInRedirectUrl(
  requestUrl: URL,
  returnTo: string,
  expired: boolean,
): URL {
  const signInUrl = new URL("/auth/signin", requestUrl.origin)
  if (expired) {
    signInUrl.searchParams.set("session", "expired")
  }
  signInUrl.searchParams.set("returnTo", returnTo)
  return signInUrl
}

function getUnavailableUrl(requestUrl: URL, returnTo: string): URL {
  const unavailableUrl = new URL("/auth/unavailable", requestUrl.origin)
  unavailableUrl.searchParams.set("returnTo", returnTo)
  return unavailableUrl
}

function setSlidingSessionCookie(
  response: NextResponse,
  sessionHandle: string,
): void {
  response.cookies.set({
    httpOnly: true,
    maxAge: CONSOLE_SESSION_MAX_AGE_SECONDS,
    name: CONSOLE_SESSION_COOKIE,
    path: "/",
    sameSite: "lax",
    secure: true,
    value: sessionHandle,
  })
}

function clearSessionCookie(response: NextResponse): void {
  response.cookies.set({
    expires: new Date(0),
    httpOnly: true,
    maxAge: 0,
    name: CONSOLE_SESSION_COOKIE,
    path: "/",
    sameSite: "lax",
    secure: true,
    value: "",
  })
}

function isConsoleSessionEndpoint(pathname: string): boolean {
  return (
    pathname.startsWith("/api/console/session/") ||
    pathname.startsWith("/api/internal/console-session/")
  )
}

function hasConsoleSessionCookie(cookieHeader: string | null): boolean {
  return (cookieHeader?.split(";") ?? []).some((entry) => {
    const separator = entry.indexOf("=")
    const name = (separator < 0 ? entry : entry.slice(0, separator)).trim()
    return name === CONSOLE_SESSION_COOKIE
  })
}

function isPathWithin(pathname: string, root: string): boolean {
  return pathname === root || pathname.startsWith(`${root}/`)
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|apple-touch-icon.png|favicon.ico|favicon-16x16.png|favicon-32x32.png|favicon-48x48.png|icon.svg).*)",
  ],
}
