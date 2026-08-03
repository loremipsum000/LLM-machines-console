import "server-only"

import { getCurrentConsoleSession } from "@/lib/auth/session"
import { CONSOLE_SESSION_HEADER } from "@/lib/auth/session-client"

export async function getBffRequest(): Promise<{
  baseUrl: string
  headers: HeadersInit
} | null> {
  const baseUrl = cleanValue(process.env.CONSOLE_BFF_URL)?.replace(/\/+$/, "")
  const serviceKey = cleanValue(process.env.CONSOLE_BFF_SERVICE_API_KEY)

  if (!baseUrl || !serviceKey) {
    return null
  }

  const session = await getCurrentConsoleSession()
  if (session.state !== "active") {
    return null
  }

  return {
    baseUrl,
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      [CONSOLE_SESSION_HEADER]: session.sessionHandle,
    },
  }
}

function cleanValue(value: string | undefined): string | undefined {
  const cleaned = value?.trim()
  return cleaned && !["null", "undefined"].includes(cleaned.toLowerCase())
    ? cleaned
    : undefined
}
