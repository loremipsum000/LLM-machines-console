import type { InferenceCoreSourceStatus } from "@llm-machines/contracts/inference-core"

const sourceStatusLabels = {
  degraded: "Degraded",
  not_configured: "Not configured",
  ok: "Available",
  unavailable: "Unavailable",
} as const satisfies Record<InferenceCoreSourceStatus, string>

export function sourceStatusLabel(status: InferenceCoreSourceStatus): string {
  return sourceStatusLabels[status]
}
