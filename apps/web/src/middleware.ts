import { auth } from "@/lib/auth/auth"
import { retainedConsoleRoles } from "@/lib/auth/role-claims"
import { buildContentSecurityPolicy } from "@/lib/security/content-security-policy"
import type { NextAuthRequest } from "next-auth"
import {
  type NextFetchEvent,
  type NextMiddleware,
  type NextRequest,
  NextResponse,
} from "next/server"

type AuthMiddlewareFactory = (
  middleware: (
    request: NextAuthRequest,
    event: NextFetchEvent,
  ) => ReturnType<NextMiddleware>,
) => NextMiddleware

const createAuthMiddleware = auth as AuthMiddlewareFactory
const PUBLIC_ASSET_PATHS = new Set([
  "/apple-touch-icon.png",
  "/favicon-16x16.png",
  "/favicon-32x32.png",
  "/favicon-48x48.png",
  "/favicon.ico",
  "/icon.svg",
])

export default function middleware(
  request: NextRequest,
  event: NextFetchEvent,
) {
  const contentSecurityPolicy = createContentSecurityPolicy(request)
  if (
    request.nextUrl.pathname.startsWith("/auth/") ||
    PUBLIC_ASSET_PATHS.has(request.nextUrl.pathname) ||
    !isProtectedConsolePath(request.nextUrl.pathname)
  ) {
    return contentSecurityPolicy.next()
  }

  const requireAuthenticatedSession = createAuthMiddleware((request) => {
    if (retainedConsoleRoles(request.auth?.user?.roles).length > 0) {
      return contentSecurityPolicy.next()
    }

    return contentSecurityPolicy.redirect(
      getSignInRedirectUrl(request.nextUrl.href),
    )
  }) as NextMiddleware

  return requireAuthenticatedSession(request, event)
}

function createContentSecurityPolicy(request: NextRequest): {
  next(): NextResponse
  redirect(url: URL): NextResponse
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
  }
}

function isProtectedConsolePath(pathname: string): boolean {
  return (
    pathname === "/" ||
    pathname === "/activity" ||
    pathname === "/hardware" ||
    pathname === "/inference" ||
    pathname === "/settings" ||
    isPathWithin(pathname, "/applications") ||
    isPathWithin(pathname, "/team")
  )
}

function getSignInRedirectUrl(requestUrl: string): URL {
  const signInUrl = new URL("/auth/signin", requestUrl)
  signInUrl.searchParams.set("callbackUrl", requestUrl)
  return signInUrl
}

function isPathWithin(pathname: string, root: string): boolean {
  return pathname === root || pathname.startsWith(`${root}/`)
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|apple-touch-icon.png|favicon.ico|favicon-16x16.png|favicon-32x32.png|favicon-48x48.png|icon.svg).*)",
  ],
}
