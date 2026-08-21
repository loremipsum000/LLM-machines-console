const retryableStatuses = new Set([502, 503, 504])

export function classifyConsoleNavigationAttempt({
  actualUrl,
  consoleOrigin,
  expectedPath,
  headingVisible,
  responseStatus,
}) {
  if (
    Number.isInteger(responseStatus) &&
    responseStatus >= 500 &&
    !retryableStatuses.has(responseStatus)
  ) {
    return { reason: `HTTP ${responseStatus}`, status: "FAIL" }
  }

  const current = new URL(actualUrl)
  if (current.origin !== consoleOrigin) {
    return { reason: "cross-origin redirect", status: "FAIL" }
  }
  if (current.pathname === "/auth/signin") {
    return { reason: "session was cleared", status: "FAIL" }
  }
  if (
    retryableStatuses.has(responseStatus) ||
    current.pathname === "/auth/unavailable"
  ) {
    return { reason: "identity recovery pending", status: "RETRY" }
  }
  if (current.pathname !== expectedPath) {
    return { reason: `stale path ${current.pathname}`, status: "RETRY" }
  }
  if (!headingVisible) {
    return { reason: "target heading pending", status: "RETRY" }
  }
  return { reason: "target rendered", status: "READY" }
}
