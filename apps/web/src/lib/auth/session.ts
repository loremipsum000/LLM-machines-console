import "server-only"

import { headers } from "next/headers"
import {
  type WebConsoleSessionResolution,
  opaqueConsoleSessionHandle,
  resolveConsoleSession,
} from "./session-client"

export type CurrentConsoleSessionResolution =
  | Extract<WebConsoleSessionResolution, { state: "terminal" | "unavailable" }>
  | {
      session: Extract<
        WebConsoleSessionResolution,
        { state: "active" }
      >["session"]
      sessionHandle: string
      state: "active"
    }

export async function getCurrentConsoleSession(): Promise<CurrentConsoleSessionResolution> {
  const requestHeaders = await headers()
  const cookieHeader = requestHeaders.get("cookie")
  const sessionHandle = opaqueConsoleSessionHandle(cookieHeader)
  if (!sessionHandle) {
    return { reason: "absent", state: "terminal" }
  }
  const resolution = await resolveConsoleSession(cookieHeader)
  if (resolution.state !== "active") {
    return resolution
  }
  return {
    session: resolution.session,
    sessionHandle,
    state: "active",
  }
}
