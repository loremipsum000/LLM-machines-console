import { randomUUID } from "node:crypto"
import { getBffRequest } from "@/lib/bff/server-request"

export const dynamic = "force-dynamic"

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const bffRequest = await getBffRequest()
  if (!bffRequest) {
    return Response.json(
      {
        type: "about:blank",
        title: "Builder BFF is not configured",
        status: 503,
      },
      { status: 503 },
    )
  }

  const body = await request.text()
  const headers = new Headers(bffRequest.headers)
  headers.set("Content-Type", "application/json")
  headers.set("Idempotency-Key", randomUUID())

  const upstream = await fetch(
    `${bffRequest.baseUrl}/api/builder/agents/${encodeURIComponent(
      id,
    )}/test/stream`,
    {
      method: "POST",
      cache: "no-store",
      headers,
      body,
    },
  )
  const contentType = upstream.headers.get("content-type") ?? ""
  if (
    upstream.ok &&
    upstream.body &&
    contentType.includes("text/event-stream")
  ) {
    return new Response(upstream.body, {
      headers: sseHeaders(),
      status: 200,
    })
  }

  return new Response(await upstream.text(), {
    headers: {
      "Content-Type": contentType || "application/json",
    },
    status: upstream.status,
  })
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
