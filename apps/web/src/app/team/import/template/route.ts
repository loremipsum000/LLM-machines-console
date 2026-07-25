import { getBffRequest } from "@/lib/bff/server-request"

export const dynamic = "force-dynamic"

export async function GET() {
  const bffRequest = await getBffRequest()
  if (!bffRequest) {
    return new Response("Console BFF is not configured.", { status: 503 })
  }

  const response = await fetch(
    `${bffRequest.baseUrl}/api/admin/team/csv-template`,
    {
      cache: "no-store",
      headers: bffRequest.headers,
    },
  )

  return new Response(response.body, {
    headers: {
      "Content-Disposition": 'attachment; filename="team-import-template.csv"',
      "Content-Type": "text/csv; charset=utf-8",
    },
    status: response.status,
  })
}
