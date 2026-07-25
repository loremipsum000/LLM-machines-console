import { hubSearchResultSchema } from "@llm-machines/contracts"
import { getBffRequest } from "@/lib/bff/server-request"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q") ?? ""
  const bffRequest = await getBffRequest()

  if (bffRequest) {
    try {
      const upstream = await fetch(
        `${bffRequest.baseUrl}/api/hub/search?q=${encodeURIComponent(query)}`,
        {
          cache: "no-store",
          headers: bffRequest.headers,
        },
      )

      if (upstream.ok) {
        return Response.json(
          hubSearchResultSchema.array().parse(await upstream.json()),
        )
      }
      return searchUnavailable(upstream.status)
    } catch {
      return searchUnavailable(502)
    }
  }

  return searchUnavailable(503)
}

function searchUnavailable(status: number): Response {
  return Response.json(
    {
      type: "about:blank",
      title: "Hub search unavailable",
      status,
      detail:
        "Hub search could not reach the configured BFF, and fixture mode is not active.",
    },
    { status },
  )
}
