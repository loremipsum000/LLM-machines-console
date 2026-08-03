import type { ConsoleHighRiskAction } from "@llm-machines/contracts/inference-core"
import { normalizeConsoleReturnPath } from "./safe-return"

const MFA_FRESHNESS_SECONDS = 5 * 60
const CLOCK_SKEW_SECONDS = 60

export function hasFreshConsoleMfa(
  value: string | null,
  now: () => number = Date.now,
): boolean {
  if (!value) {
    return false
  }
  const verifiedAt = Date.parse(value)
  const currentTime = now()
  return (
    Number.isFinite(verifiedAt) &&
    verifiedAt >= currentTime - MFA_FRESHNESS_SECONDS * 1000 &&
    verifiedAt <= currentTime + CLOCK_SKEW_SECONDS * 1000
  )
}

export function consoleMfaElevationHref(
  action: ConsoleHighRiskAction,
  returnTo: string,
): string {
  const query = new URLSearchParams({
    action,
    returnTo: normalizeConsoleReturnPath(returnTo),
  })
  return `/auth/elevate?${query.toString()}`
}
