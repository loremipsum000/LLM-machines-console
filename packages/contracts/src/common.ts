import { z } from "zod"

export const personaSchema = z.enum(["consumer", "builder", "admin"])
export type Persona = z.infer<typeof personaSchema>

export const personaRank: Record<Persona, number> = {
  consumer: 0,
  builder: 1,
  admin: 2,
}

export function personaCanAccess(actual: Persona, required: Persona): boolean {
  return personaRank[actual] >= personaRank[required]
}

export const resourceTypeSchema = z.enum([
  "agent",
  "workflow",
  "connector",
  "custom_app",
  "rag_corpus",
])
export type ResourceType = z.infer<typeof resourceTypeSchema>

export const lifecycleStateSchema = z.enum([
  "draft",
  "submitted",
  "published",
  "deprecated",
])
export type LifecycleState = z.infer<typeof lifecycleStateSchema>

export const supportTierSchema = z.enum(["t1", "t2", "t3"])
export type SupportTier = z.infer<typeof supportTierSchema>

export const agentSandboxProfileSchema = z.enum([
  "openclaw-restricted",
  "openclaw-tools",
  "hermes-restricted",
  "hermes-tools",
])
export type AgentSandboxProfile = z.infer<typeof agentSandboxProfileSchema>

export const egressAccessModeSchema = z.enum(["read_only", "read_write"])
export type EgressAccessMode = z.infer<typeof egressAccessModeSchema>

export const egressApprovalStatusSchema = z.enum([
  "pending",
  "active",
  "dry_run",
  "failed",
  "revoked",
  "expired",
])
export type EgressApprovalStatus = z.infer<typeof egressApprovalStatusSchema>

export const egressApprovalSchema = z.object({
  id: z.string().uuid(),
  sandboxName: z.string().min(1),
  profile: agentSandboxProfileSchema,
  endpointHost: z.string().min(1),
  endpointPort: z.number().int().min(1).max(65535),
  accessMode: egressAccessModeSchema,
  reason: z.string().min(1),
  status: egressApprovalStatusSchema,
  approvedBy: z.string().min(1),
  expiresAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  revokedAt: z.string().datetime().nullable(),
})
export type EgressApproval = z.infer<typeof egressApprovalSchema>

export const createEgressApprovalSchema = z.object({
  sandboxName: z.string().min(1),
  profile: agentSandboxProfileSchema,
  endpointHost: z.string().min(1),
  endpointPort: z.number().int().min(1).max(65535),
  accessMode: egressAccessModeSchema,
  reason: z.string().min(1),
  expiresAt: z.string().datetime().nullable().optional(),
})
export type CreateEgressApproval = z.infer<typeof createEgressApprovalSchema>

export const agenticAdapterApplyEgressRequestSchema =
  createEgressApprovalSchema.extend({
    approvalId: z.string().uuid(),
    approvedBy: z.string().min(1),
  })
export type AgenticAdapterApplyEgressRequest = z.infer<
  typeof agenticAdapterApplyEgressRequestSchema
>

export const agenticAdapterEgressResponseSchema = z.object({
  approvalId: z.string().uuid(),
  sandboxName: z.string().min(1),
  endpoint: z.string().min(1),
  status: z.enum(["applied", "dry_run"]),
  command: z.array(z.string().min(1)),
  rollbackCommand: z.array(z.string().min(1)),
  stdout: z.string(),
  stderr: z.string(),
})
export type AgenticAdapterEgressResponse = z.infer<
  typeof agenticAdapterEgressResponseSchema
>

export const agenticAdapterRevokeEgressRequestSchema = z.object({
  approvalId: z.string().uuid(),
  revokedBy: z.string().min(1),
  sandboxName: z.string().min(1),
  profile: agentSandboxProfileSchema,
  endpointHost: z.string().min(1),
  endpointPort: z.number().int().min(1).max(65535),
  reason: z.string().min(1),
})
export type AgenticAdapterRevokeEgressRequest = z.infer<
  typeof agenticAdapterRevokeEgressRequestSchema
>

export const agenticAdapterRevokeEgressResponseSchema = z.object({
  approvalId: z.string().uuid(),
  sandboxName: z.string().min(1),
  endpoint: z.string().min(1),
  status: z.enum(["revoked", "dry_run"]),
  command: z.array(z.string().min(1)),
  stdout: z.string(),
  stderr: z.string(),
})
export type AgenticAdapterRevokeEgressResponse = z.infer<
  typeof agenticAdapterRevokeEgressResponseSchema
>

export const agenticApprovalEnvelopeSchema =
  agenticAdapterApplyEgressRequestSchema.extend({
    actorSubject: z.string().min(1),
    actorPersona: z.literal("admin"),
    issuedAt: z.string().datetime(),
    nonce: z.string().min(16),
  })
export type AgenticApprovalEnvelope = z.infer<
  typeof agenticApprovalEnvelopeSchema
>

export const agenticRevocationEnvelopeSchema =
  agenticAdapterRevokeEgressRequestSchema.extend({
    actorSubject: z.string().min(1),
    actorPersona: z.literal("admin"),
    issuedAt: z.string().datetime(),
    nonce: z.string().min(16),
  })
export type AgenticRevocationEnvelope = z.infer<
  typeof agenticRevocationEnvelopeSchema
>

export const agenticRuntimeSchema = z.enum(["openclaw", "hermes"])
export type AgenticRuntime = z.infer<typeof agenticRuntimeSchema>

export const agenticRuntimeStatusSchema = z.object({
  runtime: agenticRuntimeSchema,
  profile: agentSandboxProfileSchema,
  configured: z.boolean(),
  healthy: z.boolean(),
  baseUrl: z.string().url().nullable(),
  detail: z.string().optional(),
})
export type AgenticRuntimeStatus = z.infer<typeof agenticRuntimeStatusSchema>

export const agenticStatusResponseSchema = z.object({
  runtimes: z.array(agenticRuntimeStatusSchema),
})
export type AgenticStatusResponse = z.infer<typeof agenticStatusResponseSchema>

export const agenticRuntimeHistorySampleSchema =
  agenticRuntimeStatusSchema.extend({
    capturedAt: z.string().datetime(),
  })
export type AgenticRuntimeHistorySample = z.infer<
  typeof agenticRuntimeHistorySampleSchema
>

export const agenticRuntimeSloStatusSchema = z.enum([
  "healthy",
  "degraded",
  "not_configured",
  "insufficient_data",
])
export type AgenticRuntimeSloStatus = z.infer<
  typeof agenticRuntimeSloStatusSchema
>

export const agenticRuntimeSloSchema = z.object({
  runtime: agenticRuntimeSchema,
  profile: agentSandboxProfileSchema,
  windowHours: z.number().int().positive(),
  status: agenticRuntimeSloStatusSchema,
  sampleCount: z.number().int().min(0),
  configuredSamples: z.number().int().min(0),
  healthySamples: z.number().int().min(0),
  uptimePercent: z.number().min(0).max(100).nullable(),
  lastHealthyAt: z.string().datetime().nullable(),
  lastUnhealthyAt: z.string().datetime().nullable(),
})
export type AgenticRuntimeSlo = z.infer<typeof agenticRuntimeSloSchema>

export const agenticRuntimeHistoryResponseSchema = z.object({
  generatedAt: z.string().datetime(),
  windowHours: z.number().int().positive(),
  samples: z.array(agenticRuntimeHistorySampleSchema),
  slos: z.array(agenticRuntimeSloSchema),
})
export type AgenticRuntimeHistoryResponse = z.infer<
  typeof agenticRuntimeHistoryResponseSchema
>

export const openClawAccessResponseSchema = z.object({
  runtime: z.literal("openclaw"),
  profile: z.literal("openclaw-restricted"),
  configured: z.boolean(),
  dashboardUrl: z.string().url().nullable(),
  tokenRequired: z.literal(true),
})
export type OpenClawAccessResponse = z.infer<
  typeof openClawAccessResponseSchema
>

export const hermesAccessResponseSchema = z.object({
  runtime: z.literal("hermes"),
  profile: z.literal("hermes-restricted"),
  configured: z.boolean(),
  chatCompletionsProxyPath: z.string().min(1).nullable(),
  tokenRequired: z.literal(true),
})
export type HermesAccessResponse = z.infer<typeof hermesAccessResponseSchema>

export const agenticAdapterDiagnosticsResponseSchema = z.object({
  configured: z.boolean(),
  healthy: z.boolean(),
  service: z.string().min(1).nullable(),
  status: z.enum(["ok", "degraded", "not_configured", "unavailable"]),
  baseUrl: z.string().url().nullable(),
  applyEnabled: z.boolean().nullable(),
  detail: z.string(),
})
export type AgenticAdapterDiagnosticsResponse = z.infer<
  typeof agenticAdapterDiagnosticsResponseSchema
>

export const healthResponseSchema = z.object({
  service: z.string().min(1),
  status: z.enum(["ok", "degraded"]),
  version: z.string().min(1),
})
export type HealthResponse = z.infer<typeof healthResponseSchema>

export const problemDetailsSchema = z.object({
  type: z.string().default("about:blank"),
  title: z.string().min(1),
  status: z.number().int().min(400).max(599),
  detail: z.string().optional(),
  instance: z.string().optional(),
})
export type ProblemDetails = z.infer<typeof problemDetailsSchema>
