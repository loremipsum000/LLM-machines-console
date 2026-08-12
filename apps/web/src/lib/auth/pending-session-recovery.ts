"use client"

import { useEffect } from "react"
import { normalizeConsoleReturnPath } from "./safe-return"

const FIRST_PROBE_DELAY_MS = 750
const REPEATED_PROBE_DELAY_MS = 1_500
const MAXIMUM_PENDING_ACTION_MS = 15_000

type PendingConsoleSessionState =
  | "active"
  | "terminal"
  | "unavailable"
  | "unknown"

export function usePendingConsoleSessionRecovery(pending: boolean): void {
  useEffect(() => {
    if (!pending) {
      return
    }

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const startedAt = Date.now()
    const probe = async () => {
      const returnTo = normalizeConsoleReturnPath(
        `${window.location.pathname}${window.location.search}`,
      )
      const state = await probePendingConsoleSession(
        returnTo,
        fetch,
        window.location.origin,
      )
      if (cancelled) {
        return
      }
      const destination = pendingSessionRecoveryHref(
        state,
        returnTo,
        Date.now() - startedAt,
      )
      if (destination) {
        cancelled = true
        window.location.replace(destination)
        return
      }
      timer = setTimeout(probe, REPEATED_PROBE_DELAY_MS)
    }

    timer = setTimeout(probe, FIRST_PROBE_DELAY_MS)
    return () => {
      cancelled = true
      if (timer) {
        clearTimeout(timer)
      }
    }
  }, [pending])
}

export async function probePendingConsoleSession(
  returnTo: string,
  fetcher: typeof fetch = fetch,
  consoleOrigin: string = window.location.origin,
): Promise<PendingConsoleSessionState> {
  try {
    const safeReturnTo = normalizeConsoleReturnPath(returnTo)
    const response = await fetcher(safeReturnTo, {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "text/html" },
      method: "HEAD",
      redirect: "follow",
    })
    await response.body?.cancel().catch(() => undefined)
    const finalUrl = new URL(response.url, consoleOrigin)
    if (finalUrl.origin !== consoleOrigin) {
      return "unknown"
    }
    if (finalUrl.pathname === "/auth/signin") {
      return "terminal"
    }
    if (finalUrl.pathname === "/auth/unavailable") {
      return "unavailable"
    }
    return response.ok ? "active" : "unknown"
  } catch {
    return "unknown"
  }
}

export function pendingSessionRecoveryHref(
  state: PendingConsoleSessionState,
  returnTo: string,
  elapsedMilliseconds: number,
): string | null {
  const safeReturnTo = normalizeConsoleReturnPath(returnTo)
  if (state === "terminal") {
    return `/auth/signin?${new URLSearchParams({
      session: "expired",
      returnTo: safeReturnTo,
    }).toString()}`
  }
  if (state === "unavailable") {
    return `/auth/unavailable?${new URLSearchParams({
      returnTo: safeReturnTo,
    }).toString()}`
  }
  return elapsedMilliseconds >= MAXIMUM_PENDING_ACTION_MS ? safeReturnTo : null
}
