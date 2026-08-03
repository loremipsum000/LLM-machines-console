import { expiredConsoleSessionRedirectResponse } from "@/lib/auth/session-client"
import { getBffRequest } from "@/lib/bff/server-request"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const bffRequest = await getBffRequest()
  if (bffRequest.state === "terminal") {
    return expiredConsoleSessionRedirectResponse(request.url)
  }
  if (bffRequest.state === "unavailable") {
    return new Response("Console session is temporarily unavailable.", {
      headers: { "Cache-Control": "no-store" },
      status: 503,
    })
  }

  const response = await fetch(
    `${bffRequest.baseUrl}/api/admin/team/csv-template`,
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
    return new Response("Console session is temporarily unavailable.", {
      headers: { "Cache-Control": "no-store" },
      status: 503,
    })
  }

  return new Response(response.body, {
    headers: {
      "Content-Disposition": 'attachment; filename="team-import-template.csv"',
      "Content-Type": "text/csv; charset=utf-8",
    },
    status: response.status,
  })
}
