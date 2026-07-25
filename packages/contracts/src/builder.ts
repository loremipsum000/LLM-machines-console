import { z } from "zod"
import {
  agentSandboxProfileSchema,
  lifecycleStateSchema,
  resourceTypeSchema,
  supportTierSchema,
} from "./common"

export const builderTemplateSchema = z.object({
  id: z.string().min(1),
  type: resourceTypeSchema,
  name: z.string().min(1),
  description: z.string().min(1),
  category: z.string().min(1),
  version: z.string().min(1),
  supportTier: supportTierSchema,
  tags: z.array(z.string().min(1)),
  samplePrompts: z.array(z.string().min(1)),
  href: z.string().min(1),
  forkHref: z.string().min(1),
})
export type BuilderTemplate = z.infer<typeof builderTemplateSchema>

export const builderResourceVersionSchema = z.object({
  id: z.string().uuid(),
  semver: z.string().min(1),
  createdAt: z.string().datetime(),
})
export type BuilderResourceVersion = z.infer<
  typeof builderResourceVersionSchema
>

export const builderResourceSchema = z.object({
  id: z.string().uuid(),
  type: resourceTypeSchema,
  name: z.string().min(1),
  description: z.string().min(1),
  ownerId: z.string().min(1),
  ownerName: z.string().min(1),
  state: lifecycleStateSchema,
  templateId: z.string().min(1).nullable(),
  currentVersion: builderResourceVersionSchema.nullable(),
  updatedAt: z.string().datetime(),
  href: z.string().min(1),
  editorHref: z.string().min(1),
})
export type BuilderResource = z.infer<typeof builderResourceSchema>

export const builderSubmissionStateSchema = z.enum([
  "submitted",
  "published",
  "rejected",
  "deprecated",
  "withdrawn",
])
export type BuilderSubmissionState = z.infer<
  typeof builderSubmissionStateSchema
>

export const builderSubmissionSchema = z.object({
  id: z.string().uuid(),
  resourceId: z.string().uuid(),
  resourceName: z.string().min(1),
  resourceType: resourceTypeSchema,
  submittedVersion: z.string().min(1),
  state: builderSubmissionStateSchema,
  adminComment: z.string().min(1).nullable(),
  submittedAt: z.string().datetime(),
  decidedAt: z.string().datetime().nullable(),
  href: z.string().min(1),
})
export type BuilderSubmission = z.infer<typeof builderSubmissionSchema>

export const builderAgentStudioConfigSchema = z.object({
  resourceId: z.string().uuid(),
  model: z.string().min(1).max(120),
  sandboxProfile: agentSandboxProfileSchema,
  systemPrompt: z.string().min(1).max(4000),
  instructions: z.string().min(1).max(4000),
  temperature: z.number().min(0).max(2),
  maxOutputTokens: z.number().int().min(64).max(8192),
  tools: z.array(z.string().min(1).max(80)).max(20),
  sampleInput: z.string().min(1).max(4000),
  updatedAt: z.string().datetime(),
})
export type BuilderAgentStudioConfig = z.infer<
  typeof builderAgentStudioConfigSchema
>

export const updateBuilderAgentStudioRequestSchema = z.object({
  name: z.string().min(1).max(96),
  description: z.string().min(1).max(500),
  model: z.string().min(1).max(120),
  sandboxProfile: agentSandboxProfileSchema,
  systemPrompt: z.string().min(1).max(4000),
  instructions: z.string().min(1).max(4000),
  temperature: z.number().min(0).max(2),
  maxOutputTokens: z.number().int().min(64).max(8192),
  tools: z.array(z.string().min(1).max(80)).max(20),
  sampleInput: z.string().min(1).max(4000),
})
export type UpdateBuilderAgentStudioRequest = z.infer<
  typeof updateBuilderAgentStudioRequestSchema
>

export const testBuilderAgentRequestSchema = z.object({
  input: z.string().min(1).max(8000),
})
export type TestBuilderAgentRequest = z.infer<
  typeof testBuilderAgentRequestSchema
>

export const clearBuilderAgentTestRunsRequestSchema = z.object({
  confirmation: z.literal("CLEAR"),
})
export type ClearBuilderAgentTestRunsRequest = z.infer<
  typeof clearBuilderAgentTestRunsRequestSchema
>

export const resetBuilderAgentStudioDraftRequestSchema = z.object({
  confirmation: z.literal("RESET"),
})
export type ResetBuilderAgentStudioDraftRequest = z.infer<
  typeof resetBuilderAgentStudioDraftRequestSchema
>

export const builderAgentTestSourceSchema = z.enum([
  "local_preview",
  "agentic_runtime",
])
export type BuilderAgentTestSource = z.infer<
  typeof builderAgentTestSourceSchema
>

export const builderAgentTestTraceStepSchema = z.object({
  at: z.string().datetime(),
  label: z.string().min(1).max(80),
  status: z.enum(["succeeded", "failed", "skipped"]),
  detail: z.string().min(1).max(240).nullable(),
})
export type BuilderAgentTestTraceStep = z.infer<
  typeof builderAgentTestTraceStepSchema
>

export const builderAgentTestToolCallSchema = z.object({
  at: z.string().datetime(),
  id: z.string().min(1).max(120).nullable(),
  index: z.number().int().min(0).nullable(),
  name: z.string().min(1).max(120),
  status: z.enum(["requested", "completed", "failed"]),
  argumentsPreview: z.string().max(1000).nullable(),
})
export type BuilderAgentTestToolCall = z.infer<
  typeof builderAgentTestToolCallSchema
>

export const builderAgentTestRunSchema = z.object({
  id: z.string().uuid(),
  resourceId: z.string().uuid(),
  input: z.string(),
  output: z.string().nullable(),
  source: builderAgentTestSourceSchema,
  status: z.enum(["succeeded", "failed"]),
  model: z.string().min(1),
  sandboxProfile: agentSandboxProfileSchema,
  durationMs: z.number().int().min(0),
  runtimeTraceId: z.string().min(1).max(120),
  finishReason: z.string().min(1).max(80).nullable(),
  promptTokens: z.number().int().min(0).nullable(),
  completionTokens: z.number().int().min(0).nullable(),
  totalTokens: z.number().int().min(0).nullable(),
  errorDetail: z.string().nullable(),
  trace: z.array(builderAgentTestTraceStepSchema),
  toolCalls: z.array(builderAgentTestToolCallSchema).default([]),
  createdAt: z.string().datetime(),
})
export type BuilderAgentTestRun = z.infer<typeof builderAgentTestRunSchema>

export const builderAgentStudioQuotaSchema = z.object({
  period: z.literal("daily"),
  timezone: z.literal("UTC"),
  status: z.enum(["unlimited", "ok", "near_limit", "exhausted"]),
  enforced: z.boolean(),
  usedRuns: z.number().int().min(0),
  runLimit: z.number().int().min(0).nullable(),
  remainingRuns: z.number().int().min(0).nullable(),
  usedTokens: z.number().int().min(0),
  tokenLimit: z.number().int().min(0).nullable(),
  remainingTokens: z.number().int().min(0).nullable(),
  resetsAt: z.string().datetime(),
})
export type BuilderAgentStudioQuota = z.infer<
  typeof builderAgentStudioQuotaSchema
>

export const builderAgentTestResultSchema = builderAgentTestRunSchema.extend({
  output: z.string(),
  status: z.literal("succeeded"),
  errorDetail: z.null(),
  quota: builderAgentStudioQuotaSchema,
})
export type BuilderAgentTestResult = z.infer<
  typeof builderAgentTestResultSchema
>

export const builderAgentTestStreamEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("builder.agent_test.started"),
    testRunId: z.string().uuid(),
    runtimeTraceId: z.string().min(1).max(120),
  }),
  z.object({
    type: z.literal("builder.agent_test.delta"),
    testRunId: z.string().uuid(),
    runtimeTraceId: z.string().min(1).max(120),
    delta: z.string(),
  }),
  z.object({
    type: z.literal("builder.agent_test.tool_call"),
    testRunId: z.string().uuid(),
    runtimeTraceId: z.string().min(1).max(120),
    toolCall: builderAgentTestToolCallSchema,
  }),
  z.object({
    type: z.literal("builder.agent_test.completed"),
    result: builderAgentTestResultSchema,
  }),
  z.object({
    type: z.literal("builder.agent_test.failed"),
    status: z.union([z.literal(429), z.literal(503)]),
    title: z.string().min(1),
    detail: z.string().min(1),
    testRunId: z.string().uuid().optional(),
    runtimeTraceId: z.string().min(1).max(120).optional(),
    quota: builderAgentStudioQuotaSchema.optional(),
  }),
])
export type BuilderAgentTestStreamEvent = z.infer<
  typeof builderAgentTestStreamEventSchema
>

export const builderAgentStudioSchema = z.object({
  resource: builderResourceSchema,
  config: builderAgentStudioConfigSchema,
  editable: z.boolean(),
  testable: z.boolean(),
  quota: builderAgentStudioQuotaSchema,
  recentTestRuns: z.array(builderAgentTestRunSchema),
})
export type BuilderAgentStudio = z.infer<typeof builderAgentStudioSchema>

export const forkBuilderTemplateRequestSchema = z.object({
  name: z.string().min(1).optional(),
})
export type ForkBuilderTemplateRequest = z.infer<
  typeof forkBuilderTemplateRequestSchema
>

export const createBuilderResourceVersionRequestSchema = z.object({
  semver: z.string().min(1),
})
export type CreateBuilderResourceVersionRequest = z.infer<
  typeof createBuilderResourceVersionRequestSchema
>

export const rejectBuilderResourceRequestSchema = z.object({
  comment: z.string().min(1),
})
export type RejectBuilderResourceRequest = z.infer<
  typeof rejectBuilderResourceRequestSchema
>
