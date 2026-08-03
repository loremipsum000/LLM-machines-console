import "server-only"

import {
  type CurrentConsoleSessionResolution,
  getCurrentConsoleSession,
} from "@/lib/auth/session"
import { CONSOLE_SESSION_HEADER } from "@/lib/auth/session-client"

export type BffRequestResolution =
  | Extract<
      CurrentConsoleSessionResolution,
      { state: "terminal" | "unavailable" }
    >
  | {
      baseUrl: string
      headers: HeadersInit
      state: "active"
    }

export async function getBffRequest(): Promise<BffRequestResolution> {
  const session = await getCurrentConsoleSession()
  if (session.state !== "active") {
    return session
  }

  const baseUrl = cleanValue(process.env.CONSOLE_BFF_URL)?.replace(/\/+$/, "")
  const serviceKey = cleanValue(process.env.CONSOLE_BFF_SERVICE_API_KEY)

  if (!baseUrl || !serviceKey) {
    return {
      reason: "identity_unavailable",
      retryable: true,
      state: "unavailable",
    }
  }

  return {
    baseUrl,
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      [CONSOLE_SESSION_HEADER]: session.sessionHandle,
    },
    state: "active",
  }
}

function cleanValue(value: string | undefined): string | undefined {
  const cleaned = value?.trim()
  return cleaned && !["null", "undefined"].includes(cleaned.toLowerCase())
    ? cleaned
    : undefined
}
