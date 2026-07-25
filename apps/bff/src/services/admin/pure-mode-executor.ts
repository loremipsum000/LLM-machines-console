import { createDockerPureModeExecutor } from "./pure-mode-docker-executor"
import { createKubernetesPureModeExecutor } from "./pure-mode-kubernetes-executor"
import type {
  PureModeExecutionResult,
  PureModeExecutor,
} from "./pure-mode-executor-common"

export type { PureModeExecutionResult, PureModeExecutor }

const stateOnlyAffectedComponents = [
  "t2-builder-extensions",
  "t3-client-agents",
  "t3-custom-apps",
  "external-workflow-runtimes",
]

let testExecutor: PureModeExecutor | null = null

export function getPureModeExecutor(): PureModeExecutor {
  if (testExecutor) {
    return testExecutor
  }
  if (process.env.PURE_MODE_EXECUTOR === "docker") {
    return createDockerPureModeExecutor()
  }
  if (
    process.env.PURE_MODE_EXECUTOR === "kubernetes" ||
    process.env.PURE_MODE_EXECUTOR === "k8s"
  ) {
    return createKubernetesPureModeExecutor()
  }
  return stateOnlyExecutor
}

export function setPureModeExecutorForTest(
  executor: PureModeExecutor | null,
): void {
  testExecutor = executor
}

const stateOnlyExecutor: PureModeExecutor = {
  async activate() {
    return {
      affectedComponents: stateOnlyAffectedComponents,
      executorStatus: "state_only",
      metadata: {
        stateOnlyReason:
          "PURE_MODE_EXECUTOR is not set to docker or kubernetes.",
      },
    }
  },
  async restore() {
    return {
      affectedComponents: [],
      executorStatus: "state_only",
      metadata: {
        stateOnlyReason:
          "PURE_MODE_EXECUTOR is not set to docker or kubernetes.",
      },
    }
  },
}
