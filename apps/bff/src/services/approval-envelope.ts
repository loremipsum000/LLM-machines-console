import { createHmac, randomUUID } from "node:crypto"
import {
  agenticApprovalEnvelopeSchema,
  agenticRevocationEnvelopeSchema,
  type AgenticAdapterApplyEgressRequest,
  type AgenticAdapterRevokeEgressRequest,
} from "@llm-machines/contracts"
import type { Actor } from "../auth/persona"

export function signApprovalEnvelope(input: {
  request: AgenticAdapterApplyEgressRequest
  actor: Actor
  now?: Date
}): string {
  const secret = process.env.AGENTIC_APPROVAL_SIGNING_SECRET
  if (!secret) {
    throw new Error("AGENTIC_APPROVAL_SIGNING_SECRET is required")
  }

  const envelope = agenticApprovalEnvelopeSchema.parse({
    ...input.request,
    actorSubject: input.actor.subject,
    actorPersona: input.actor.persona,
    issuedAt: (input.now ?? new Date()).toISOString(),
    nonce: randomUUID(),
  })
  const payload = Buffer.from(JSON.stringify(envelope)).toString("base64url")
  const signature = createHmac("sha256", secret)
    .update(payload)
    .digest("base64url")
  return `${payload}.${signature}`
}

export function signRevocationEnvelope(input: {
  request: AgenticAdapterRevokeEgressRequest
  actor: Actor
  now?: Date
}): string {
  const secret = process.env.AGENTIC_APPROVAL_SIGNING_SECRET
  if (!secret) {
    throw new Error("AGENTIC_APPROVAL_SIGNING_SECRET is required")
  }

  const envelope = agenticRevocationEnvelopeSchema.parse({
    ...input.request,
    actorSubject: input.actor.subject,
    actorPersona: input.actor.persona,
    issuedAt: (input.now ?? new Date()).toISOString(),
    nonce: randomUUID(),
  })
  const payload = Buffer.from(JSON.stringify(envelope)).toString("base64url")
  const signature = createHmac("sha256", secret)
    .update(payload)
    .digest("base64url")
  return `${payload}.${signature}`
}
