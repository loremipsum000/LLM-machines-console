import {
  type NextFetchEvent,
  type NextMiddleware,
  type NextRequest,
  NextResponse,
} from "next/server"
import type { NextAuthRequest } from "next-auth"
import { auth } from "@/lib/auth/auth"

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
  if (
    request.nextUrl.pathname.startsWith("/auth/") ||
    PUBLIC_ASSET_PATHS.has(request.nextUrl.pathname) ||
    !isProtectedConsolePath(request.nextUrl.pathname)
  ) {
    return NextResponse.next()
  }

  const requireAuthenticatedSession = createAuthMiddleware((request) => {
    if (request.auth) {
      return NextResponse.next()
    }

    return NextResponse.redirect(getSignInRedirectUrl(request.nextUrl.href))
  }) as NextMiddleware

  return requireAuthenticatedSession(request, event)
}

function isProtectedConsolePath(pathname: string): boolean {
  return (
    pathname === "/" ||
    pathname === "/hardware" ||
    pathname === "/settings" ||
    isPathWithin(pathname, "/applications") ||
    isPathWithin(pathname, "/inference") ||
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
