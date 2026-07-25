export type PureModeExecutorStatus = "docker" | "kubernetes" | "state_only"

export interface PureModeExecutionResult {
  affectedComponents: string[]
  executorStatus: PureModeExecutorStatus
  metadata: Record<string, unknown>
}

export interface PureModeExecutor {
  activate(): Promise<PureModeExecutionResult>
  restore(affectedComponents: string[]): Promise<PureModeExecutionResult>
}

const tierLabelKeys = [
  "llm-machines.tier",
  "llm-machines.support-tier",
  "com.llm-machines.tier",
  "com.llm-machines.support-tier",
]

const targetLabelKeys = [
  "llm-machines.pure-mode-target",
  "com.llm-machines.pure-mode-target",
]

export function isExplicitNonT1PureModeTarget(
  labels: Record<string, string | undefined>,
): boolean {
  return isTargetEnabled(labels) && isNonT1Tier(labels)
}

function isTargetEnabled(labels: Record<string, string | undefined>): boolean {
  return targetLabelKeys.some((key) => labels[key] === "true")
}

function isNonT1Tier(labels: Record<string, string | undefined>): boolean {
  const tier = tierLabelKeys
    .map((key) => labels[key]?.toLowerCase())
    .find((value) => value)
  return tier === "t2" || tier === "t3"
}
