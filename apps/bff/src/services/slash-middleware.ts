import type { HubResource } from "@llm-machines/contracts"
import type { Actor } from "../auth/persona"
import type { SlashCommand } from "../openai/types"
import {
  executeAgentResource,
  streamAgentResource,
} from "./agentic-runtime-client"
import { emitAudit } from "./audit"
import { createAgentInvocationOutput, getHubResources } from "./hub"
import { recordPolicyViolation } from "./policy-violations"

export type SlashInvocationResult =
  | {
      ok: true
      resource: HubResource
      response: string
    }
  | {
      ok: false
      status: 404 | 409 | 501 | 503
      title: string
      detail: string
    }

export async function invokeSlashCommand(
  actor: Actor,
  slash: SlashCommand,
  opts: { model: string; signal?: AbortSignal },
): Promise<SlashInvocationResult> {
  const prepared = await prepareAgentInvocation(actor, slash)
  if (!prepared.ok) {
    return prepared
  }

  const execution = await executeAgentResource({
    actor,
    input: slash.input,
    model: opts.model,
    resource: prepared.resource,
    signal: opts.signal,
  })
  if (!execution.ok) {
    await emitAgentInvocationFailure(actor, prepared.resource, execution)
    return {
      ok: false,
      status: execution.status,
      title: execution.title,
      detail: execution.detail,
    }
  }

  const response = execution.response
  const { artifact, task } = await createAgentInvocationOutput({
    actor,
    input: slash.input,
    resource: prepared.resource,
    response,
  })

  return {
    ok: true,
    resource: prepared.resource,
    response: [
      response,
      "",
      `Task: ${task.href}`,
      `Artifact: ${artifact.href}`,
    ].join("\n"),
  }
}

export async function streamSlashCommand(
  actor: Actor,
  slash: SlashCommand,
  opts: {
    model: string
    signal?: AbortSignal
    onContent: (content: string) => Promise<void>
  },
): Promise<SlashInvocationResult> {
  const prepared = await prepareAgentInvocation(actor, slash)
  if (!prepared.ok) {
    return prepared
  }

  const execution = await streamAgentResource(
    {
      actor,
      input: slash.input,
      model: opts.model,
      resource: prepared.resource,
      signal: opts.signal,
    },
    opts.onContent,
  )
  if (!execution.ok) {
    await emitAgentInvocationFailure(actor, prepared.resource, execution)
    return {
      ok: false,
      status: execution.status,
      title: execution.title,
      detail: execution.detail,
    }
  }

  const { artifact, task } = await createAgentInvocationOutput({
    actor,
    input: slash.input,
    resource: prepared.resource,
    response: execution.response,
  })

  const links = ["", `Task: ${task.href}`, `Artifact: ${artifact.href}`].join(
    "\n",
  )
  await opts.onContent(links)

  return {
    ok: true,
    resource: prepared.resource,
    response: [execution.response, links].join("\n"),
  }
}

async function prepareAgentInvocation(
  actor: Actor,
  slash: SlashCommand,
): Promise<
  | { ok: true; resource: HubResource }
  | {
      ok: false
      status: 404 | 409 | 501
      title: string
      detail: string
    }
> {
  if (slash.kind === "workflow") {
    await emitAudit({
      actorId: actor.subject,
      action: "hub.workflow.invoke_blocked",
      targetType: "hub.workflow",
      targetId: slash.name,
      reason: "workflow_runtime_unavailable",
      metadata: {
        authMode: actor.authMode,
      },
    })
    await recordPolicyViolation({
      actor,
      policyType: "access_control",
      severity: "warning",
      actionTaken: "block",
      targetType: "hub.workflow",
      targetId: slash.name,
      message:
        "Workflow slash command blocked because the workflow runtime is unavailable.",
      metadata: {
        authMode: actor.authMode,
        slashKind: slash.kind,
        slashName: slash.name,
      },
    })
    return {
      ok: false,
      status: 501,
      title: "Workflow runtime is not available",
      detail:
        "Workflow slash commands are reserved, but the workflow runtime is not selected for the Hub MVP.",
    }
  }

  const resource = await resolveAgentResource(actor, slash.name)
  if (!resource) {
    await emitAudit({
      actorId: actor.subject,
      action: "hub.agent.invoke_denied",
      targetType: "hub.resources",
      targetId: slash.name,
      reason: "agent_not_found_or_not_visible",
      metadata: {
        authMode: actor.authMode,
      },
    })
    return {
      ok: false,
      status: 404,
      title: "Agent not found",
      detail: "No runnable agent with that name is visible to this user.",
    }
  }

  const runAction = resource.actions.find((action) => action.id === "run")
  if (
    resource.state !== "available" ||
    resource.sourceStatus !== "ok" ||
    !runAction?.enabled
  ) {
    await emitAudit({
      actorId: actor.subject,
      action: "hub.agent.invoke_blocked",
      targetType: "hub.resources",
      targetId: resource.id,
      reason: "agent_not_runnable",
      metadata: {
        authMode: actor.authMode,
        sourceStatus: resource.sourceStatus,
        state: resource.state,
      },
    })
    await recordPolicyViolation({
      actor,
      policyType: "access_control",
      severity: "warning",
      actionTaken: "block",
      targetType: "hub.resources",
      targetId: resource.id,
      message: "Agent invocation blocked because the resource is not runnable.",
      metadata: {
        authMode: actor.authMode,
        sourceStatus: resource.sourceStatus,
        state: resource.state,
        supportTier: resource.supportTier,
      },
    })
    return {
      ok: false,
      status: 409,
      title: "Agent is not runnable",
      detail:
        runAction?.reason ??
        "This agent is visible, but it is not currently runnable from the Hub.",
    }
  }

  await emitAudit({
    actorId: actor.subject,
    action: "hub.agent.invoke",
    targetType: "hub.resources",
    targetId: resource.id,
    metadata: {
      authMode: actor.authMode,
      inputLength: slash.input.length,
      slashName: slash.name,
      supportTier: resource.supportTier,
    },
  })

  return { ok: true, resource }
}

async function emitAgentInvocationFailure(
  actor: Actor,
  resource: HubResource,
  execution: Extract<AgentRuntimeExecutionLike, { ok: false }>,
): Promise<void> {
  await emitAudit({
    actorId: actor.subject,
    action: "hub.agent.invoke_failed",
    targetType: "hub.resources",
    targetId: resource.id,
    reason: execution.detail,
    metadata: {
      authMode: actor.authMode,
      runtime: execution.runtime,
    },
  })
}

type AgentRuntimeExecutionLike = Awaited<
  ReturnType<typeof executeAgentResource>
>

async function resolveAgentResource(
  actor: Actor,
  slashName: string,
): Promise<HubResource | undefined> {
  const normalized = normalizeSlug(slashName)
  return (await getHubResources(actor)).find(
    (resource) =>
      resource.type === "agent" &&
      (normalizeSlug(resource.id) === normalized ||
        normalizeSlug(resource.name) === normalized),
  )
}

function normalizeSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}
