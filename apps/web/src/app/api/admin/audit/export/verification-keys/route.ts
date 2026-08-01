import { getCurrentConsoleRole } from "@/lib/auth/session"
import { getBffRequest } from "@/lib/bff/server-request"

export const dynamic = "force-dynamic"

export async function GET() {
  const role = await getCurrentConsoleRole()
  if (!role) {
    return problemResponse(401, "Authentication required")
  }
  if (role !== "admin") {
    return problemResponse(403, "Admin access required")
  }

  const bffRequest = await getBffRequest()
  if (!bffRequest) {
    return problemResponse(503, "Console BFF is not configured")
  }

  const response = await fetch(
    `${bffRequest.baseUrl}/api/admin/audit/export/verification-keys`,
    {
      cache: "no-store",
      headers: bffRequest.headers,
    },
  )
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
