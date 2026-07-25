import { getBffRequest } from "@/lib/bff/server-request"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const bffRequest = await getBffRequest()
  const once = new URL(request.url).searchParams.get("once") === "true"

  if (bffRequest) {
    try {
      const upstream = await fetch(
        `${bffRequest.baseUrl}/api/hub/events${once ? "?once=true" : ""}`,
        {
          cache: "no-store",
          headers: bffRequest.headers,
        },
      )

      if (upstream.ok && upstream.body) {
        return new Response(upstream.body, {
          headers: sseHeaders(),
          status: 200,
        })
      }
      return upstreamFailure(upstream.status)
    } catch {
      return upstreamFailure(502)
    }
  }

  return upstreamFailure(503)
}

function upstreamFailure(status: number): Response {
  return Response.json(
    {
      type: "about:blank",
      title: "Hub event stream unavailable",
      status,
      detail:
        "The Hub event stream could not reach the configured BFF, and fixture mode is not active.",
    },
    { status },
  )
}

function sseHeaders(): HeadersInit {
  return {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    "Content-Encoding": "identity",
  }
}
