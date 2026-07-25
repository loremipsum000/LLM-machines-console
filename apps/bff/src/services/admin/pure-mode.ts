import type {
  AdminPureModeTransitionRequest,
  HubSourceStatus,
} from "@llm-machines/contracts"
import { personaCanAccess } from "@llm-machines/contracts"
import type { Actor } from "../../auth/persona"
import { emitAudit } from "../audit"
import type { PureModeRecord } from "../admin-governance-state"
import {
  readGovernanceState,
  writePureModeStateForRuntime,
} from "../admin-governance-state"
import {
  getPureModeExecutor,
  type PureModeExecutionResult,
} from "./pure-mode-executor"

export type PureModeTransitionResult =
  | {
      pureMode: PureModeRecord
      status: "updated"
    }
  | {
      detail: string
      sourceStatus?: HubSourceStatus
      status: "conflict" | "unavailable"
      title: string
    }

export async function transitionAdminPureMode(
  actor: Actor,
  input: AdminPureModeTransitionRequest,
): Promise<PureModeTransitionResult> {
  if (!personaCanAccess(actor.persona, "admin")) {
    throw new Error("Admin Pure Mode transitions require admin persona.")
  }

  const source = await readGovernanceState()
  if (source.sourceStatus === "unavailable") {
    return {
      status: "unavailable",
      sourceStatus: source.sourceStatus,
      title: "Pure Mode state unavailable",
      detail: "The governance store could not be read; no transition was made.",
    }
  }

  const current =
    source.sourceStatus === "ok" ? source.pureMode : inactivePureMode()
  const conflict = transitionConflict(input, current)
  if (conflict) {
    return conflict
  }

  const execution = await executeTransition(input.action, current)
  if (execution.status === "unavailable") {
    return execution
  }

  const next = nextPureModeState(actor, input, current, execution.result)
  await writePureModeStateForRuntime(next, actor)
  await emitAudit({
    actorId: actor.subject,
    action: `admin.pure_mode.${input.action}`,
    targetType: "admin.pure_mode_state",
    targetId: "singleton",
    reason: input.reason,
    metadata: {
      affectedComponents: next.affectedComponents,
      confirmation: input.confirmation,
      executorStatus: execution.result.executorStatus,
      executorAffectedComponents: execution.result.affectedComponents,
      ...execution.result.metadata,
      nextActive: next.active,
      previousActive: current.active,
    },
  })

  return {
    status: "updated",
    pureMode: next,
  }
}

function transitionConflict(
  input: AdminPureModeTransitionRequest,
  current: PureModeRecord,
): PureModeTransitionResult | null {
  if (input.action === "activate" && current.active) {
    return {
      status: "conflict",
      title: "Pure Mode is already active",
      detail: "Restore services before submitting another activation request.",
    }
  }
  if (input.action === "restore" && !current.active) {
    return {
      status: "conflict",
      title: "Pure Mode is not active",
      detail: "There is no active Pure Mode state to restore.",
    }
  }
  return null
}

async function executeTransition(
  action: AdminPureModeTransitionRequest["action"],
  current: PureModeRecord,
): Promise<
  | { result: PureModeExecutionResult; status: "updated" }
  | {
      detail: string
      status: "unavailable"
      title: string
    }
> {
  const executor = getPureModeExecutor()
  try {
    return {
      status: "updated",
      result:
        action === "activate"
          ? await executor.activate()
          : await executor.restore(current.affectedComponents),
    }
  } catch (error) {
    return {
      status: "unavailable",
      title: "Pure Mode executor failed",
      detail:
        error instanceof Error
          ? error.message
          : "The Pure Mode executor returned an unknown error.",
    }
  }
}

function nextPureModeState(
  actor: Actor,
  input: AdminPureModeTransitionRequest,
  current: PureModeRecord,
  execution: PureModeExecutionResult,
): PureModeRecord {
  const now = new Date().toISOString()

  if (input.action === "activate") {
    return {
      active: true,
      reason: input.reason,
      activatedBy: actor.subject,
      activatedAt: now,
      deactivatedAt: null,
      affectedComponents: execution.affectedComponents,
      updatedAt: now,
    }
  }

  return {
    active: false,
    reason: input.reason,
    activatedBy: current.activatedBy,
    activatedAt: current.activatedAt,
    deactivatedAt: now,
    affectedComponents: [],
    updatedAt: now,
  }
}

function inactivePureMode(): PureModeRecord {
  const now = new Date().toISOString()
  return {
    active: false,
    reason: null,
    activatedBy: null,
    activatedAt: null,
    deactivatedAt: null,
    affectedComponents: [],
    updatedAt: now,
  }
}
