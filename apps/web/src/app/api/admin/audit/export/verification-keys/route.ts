import { getCurrentConsoleSession } from "@/lib/auth/session"
import { expiredConsoleSessionRedirectResponse } from "@/lib/auth/session-client"
import { getBffRequest } from "@/lib/bff/server-request"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const session = await getCurrentConsoleSession()
  if (session.state === "unavailable") {
    return problemResponse(503, "Identity service temporarily unavailable")
  }
  if (session.state !== "active") {
    return problemResponse(401, "Authentication required")
  }
  if (session.session.role !== "admin") {
    return problemResponse(403, "Admin access required")
  }

  const bffRequest = await getBffRequest()
  if (bffRequest.state === "terminal") {
    return expiredConsoleSessionRedirectResponse(request.url)
  }
  if (bffRequest.state === "unavailable") {
    return problemResponse(503, "Identity service temporarily unavailable")
  }

  const response = await fetch(
    `${bffRequest.baseUrl}/api/admin/audit/export/verification-keys`,
    {
      cache: "no-store",
      headers: bffRequest.headers,
    },
  )
  if (response.status === 401) {
    await response.body?.cancel().catch(() => undefined)
    return expiredConsoleSessionRedirectResponse(request.url)
  }
  if (response.status === 503) {
    await response.body?.cancel().catch(() => undefined)
    return problemResponse(503, "Identity service temporarily unavailable")
  }
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Content-Type":
      response.headers.get("content-type") ?? "application/problem+json",
    "X-Content-Type-Options": "nosniff",
  })
  if (response.ok) {
    headers.set(
      "Content-Disposition",
      'attachment; filename="audit-export-verification-keys.jwks.json"',
    )
  }

  return new Response(response.body, {
    headers,
    status: response.status,
  })
}

function problemResponse(status: number, title: string): Response {
  return Response.json(
    {
      status,
      title,
      type: "about:blank",
    },
    {
      headers: { "Cache-Control": "no-store" },
      status,
    },
  )
}
