import { getCurrentConsoleRole } from "@/lib/auth/session"
import { getBffRequest } from "@/lib/bff/server-request"

export const dynamic = "force-dynamic"

const exportFilterNames = [
  "q",
  "applicationId",
  "eventId",
  "source",
  "outcome",
  "severity",
  "cursor",
  "limit",
] as const

export async function GET(request: Request) {
  const role = await getCurrentConsoleRole()
  if (!role) {
    return problemResponse(401, "Authentication required")
  }
  if (role !== "admin") {
    return problemResponse(403, "Admin access required")
  }

  const requestUrl = new URL(request.url)
  const format = requestUrl.searchParams.get("format")
  if (format !== "json" && format !== "csv") {
    return problemResponse(400, "Invalid audit export format")
  }
  const from = canonicalUtcTimestamp(requestUrl.searchParams.get("from"))
  const to = canonicalUtcTimestamp(requestUrl.searchParams.get("to"))
  if (!from || !to) {
    return problemResponse(400, "Invalid audit export time range")
  }

  const bffRequest = await getBffRequest()
  if (!bffRequest) {
    return problemResponse(503, "Console BFF is not configured")
  }

  const params = new URLSearchParams({ format, from, to })
  for (const name of exportFilterNames) {
    const value = requestUrl.searchParams.get(name)?.trim()
    if (value) {
      params.set(name, value)
    }
  }

  const response = await fetch(
    `${bffRequest.baseUrl}/api/admin/audit/export?${params.toString()}`,
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
  copyResponseHeader(response, headers, "content-disposition")
  copyResponseHeader(response, headers, "x-llm-machines-audit-content-type")
  copyResponseHeader(response, headers, "x-llm-machines-audit-event-count")
  copyResponseHeader(response, headers, "x-llm-machines-audit-format")
  copyResponseHeader(response, headers, "x-llm-machines-audit-next-cursor")
  copyResponseHeader(response, headers, "x-llm-machines-audit-payload-bytes")

  return new Response(response.body, {
    headers,
    status: response.status,
  })
}

function canonicalUtcTimestamp(value: string | null): string | null {
  const normalized = value?.trim()
  if (!normalized || normalized.length > 64) {
    return null
  }
  const utcInput = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(normalized)
    ? `${normalized}:00.000Z`
    : normalized
  const parsed = new Date(utcInput)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

function copyResponseHeader(
  response: Response,
  headers: Headers,
  name: string,
) {
  const value = response.headers.get(name)
  if (value) {
    headers.set(name, value)
  }
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
