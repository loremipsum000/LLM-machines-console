import type { NextRequest } from "next/server"
import { signIn } from "@/lib/auth/auth"
import { ensureAuthUrlEnv } from "@/lib/auth/env"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  ensureAuthUrlEnv(request.nextUrl.origin)

  await signIn("keycloak", {
    redirectTo: normalizeRedirectTo(
      request.nextUrl.searchParams.get("redirectTo"),
      request.nextUrl.origin,
    ),
  })

  return new Response(null, { status: 204 })
}

function normalizeRedirectTo(
  redirectTo: string | null,
  currentOrigin: string,
): string {
  if (!redirectTo) {
    return "/"
  }

  if (redirectTo.startsWith("/") && !redirectTo.startsWith("//")) {
    return redirectTo
  }

  try {
    const url = new URL(redirectTo)
    return url.origin === currentOrigin ? `${url.pathname}${url.search}` : "/"
  } catch {
    return "/"
  }
}
