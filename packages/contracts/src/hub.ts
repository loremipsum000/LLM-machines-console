import { z } from "zod"
import { personaSchema, supportTierSchema } from "./common"

export const hubCapabilitySchema = z.enum([
  "developer_workbench",
  "task_sessions",
  "artifact_preview",
  "builder_status",
  "admin_summary",
  "org_usage",
  "connector_setup",
])
export type HubCapability = z.infer<typeof hubCapabilitySchema>

export const hubSourceStatusSchema = z.enum([
  "ok",
  "degraded",
  "unavailable",
  "not_configured",
])
export type HubSourceStatus = z.infer<typeof hubSourceStatusSchema>

export const hubSeveritySchema = z.enum(["info", "warning", "critical"])
export type HubSeverity = z.infer<typeof hubSeveritySchema>

export const hubResourceTypeSchema = z.enum([
  "agent",
  "mcp_connector",
  "workflow",
  "knowledge",
  "app",
  "template",
])
export type HubResourceType = z.infer<typeof hubResourceTypeSchema>

export const hubResourceStateSchema = z.enum([
  "available",
  "admin_setup_required",
  "pending_vetting",
  "disabled",
  "deprecated",
  "blocked",
])
export type HubResourceState = z.infer<typeof hubResourceStateSchema>

export const connectorVettingStatusSchema = z.enum([
  "draft",
  "pending_security_review",
  "pending_license_review",
  "pending_runtime_validation",
  "approved_read_only",
  "approved_read_write",
  "disabled",
  "deprecated",
  "blocked",
])
export type ConnectorVettingStatus = z.infer<
  typeof connectorVettingStatusSchema
>

export const hubResourceActionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  href: z.string().min(1),
  enabled: z.boolean(),
  requiresConfirmation: z.boolean(),
  reason: z.string().optional(),
})
export type HubResourceAction = z.infer<typeof hubResourceActionSchema>

export const mcpCatalogEntrySchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  description: z.string().min(1),
  version: z.string().min(1),
  sourceRef: z.string().min(1),
  checksum: z.string().min(1),
  license: z.string().min(1),
  supportTier: supportTierSchema,
  maintainer: z.string().min(1),
  vettingStatus: connectorVettingStatusSchema,
  requiredScopes: z.array(z.string().min(1)),
  allowedEndpoints: z.array(z.string().min(1)),
  readWrite: z.enum(["read_only", "read_write"]),
  dataClasses: z.array(z.string().min(1)),
  auditEvents: z.array(z.string().min(1)),
  runtimeProfile: z.string().min(1),
  secretsRequired: z.array(z.string().min(1)),
  lastReviewedAt: z.string().datetime().nullable(),
})
export type McpCatalogEntry = z.infer<typeof mcpCatalogEntrySchema>

export const mcpCatalogBundlePayloadSchema = z.object({
  version: z.string().min(1),
  generatedAt: z.string().datetime(),
  entries: z.array(mcpCatalogEntrySchema),
})
export type McpCatalogBundlePayload = z.infer<
  typeof mcpCatalogBundlePayloadSchema
>

export const mcpCatalogBundleSchema = z.object({
  payload: mcpCatalogBundlePayloadSchema,
  signature: z.object({
    alg: z.literal("ed25519"),
    keyId: z.string().min(1),
    value: z.string().min(1),
  }),
})
export type McpCatalogBundle = z.infer<typeof mcpCatalogBundleSchema>

export const hubResourceSchema = z.object({
  id: z.string().min(1),
  type: hubResourceTypeSchema,
  name: z.string().min(1),
  description: z.string().min(1),
  state: hubResourceStateSchema,
  version: z.string().nullable(),
  owner: z.string().nullable(),
  supportTier: supportTierSchema,
  sourceStatus: hubSourceStatusSchema,
  tags: z.array(z.string().min(1)),
  actions: z.array(hubResourceActionSchema),
  connector: mcpCatalogEntrySchema.optional(),
})
export type HubResource = z.infer<typeof hubResourceSchema>

export const hubNotificationSchema = z.object({
  id: z.string().uuid(),
  severity: hubSeveritySchema,
  title: z.string().min(1),
  body: z.string().min(1),
  source: z.string().min(1),
  href: z.string().nullable(),
  readAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
})
export type HubNotification = z.infer<typeof hubNotificationSchema>

export const hubChatThreadSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  preview: z.string().min(1),
  updatedAt: z.string().datetime(),
  href: z.string().min(1),
  model: z.string().min(1).nullable(),
  resourceName: z.string().min(1).nullable(),
})
export type HubChatThread = z.infer<typeof hubChatThreadSchema>

export const hubUsageScopeSchema = z.enum(["personal", "builder", "admin"])
export type HubUsageScope = z.infer<typeof hubUsageScopeSchema>

export const hubUsageSummarySchema = z.object({
  scope: hubUsageScopeSchema,
  window: z.enum(["24h", "7d", "30d", "90d"]),
  prompts: z.number().int().nonnegative(),
  tokens: z.number().int().nonnegative(),
  topModels: z.array(z.string().min(1)),
  topResources: z.array(z.string().min(1)),
  sourceStatus: hubSourceStatusSchema,
})
export type HubUsageSummary = z.infer<typeof hubUsageSummarySchema>

export const hubAdminAttentionItemSchema = z.object({
  id: z.string().min(1),
  severity: hubSeveritySchema,
  title: z.string().min(1),
  body: z.string().min(1),
  source: z.string().min(1),
  href: z.string().min(1),
  count: z.number().int().nonnegative(),
})
export type HubAdminAttentionItem = z.infer<typeof hubAdminAttentionItemSchema>

export const taskContextItemSchema = z.object({
  label: z.string().min(1),
  value: z.string().min(1),
  href: z.string().min(1).nullable(),
  sourceStatus: hubSourceStatusSchema,
})
export type TaskContextItem = z.infer<typeof taskContextItemSchema>

export const taskLogEntrySchema = z.object({
  timestamp: z.string().datetime(),
  level: z.enum(["info", "warning", "error"]),
  message: z.string().min(1),
})
export type TaskLogEntry = z.infer<typeof taskLogEntrySchema>

export const taskDiffFileSchema = z.object({
  path: z.string().min(1),
  status: z.enum(["added", "modified", "deleted"]),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  preview: z.array(z.string().min(1)),
})
export type TaskDiffFile = z.infer<typeof taskDiffFileSchema>

export const taskRunOutputSchema = z.object({
  command: z.string().min(1),
  status: z.enum(["not_run", "running", "passed", "failed"]),
  summary: z.string().min(1),
  logs: z.array(taskLogEntrySchema),
})
export type TaskRunOutput = z.infer<typeof taskRunOutputSchema>

export const taskSessionSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1),
  status: z.enum(["queued", "running", "waiting", "completed", "failed"]),
  owner: z.string().min(1),
  updatedAt: z.string().datetime(),
  href: z.string().min(1),
  context: z.array(taskContextItemSchema),
  diffs: z.array(taskDiffFileSchema),
  testOutput: taskRunOutputSchema.nullable(),
})
export type TaskSession = z.infer<typeof taskSessionSchema>

export const artifactSchema = z.object({
  id: z.string().uuid(),
  taskId: z.string().uuid().nullable(),
  title: z.string().min(1),
  kind: z.enum(["markdown", "json", "sql", "diff", "log", "file"]),
  href: z.string().min(1),
  createdAt: z.string().datetime(),
  preview: z.string().min(1),
})
export type Artifact = z.infer<typeof artifactSchema>

export const hubModuleBaseSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  sourceStatus: hubSourceStatusSchema,
})

export const hubModuleSchema = z.discriminatedUnion("type", [
  hubModuleBaseSchema.extend({
    type: z.literal("chat"),
    unavailableReason: z.string().nullable(),
  }),
  hubModuleBaseSchema.extend({
    type: z.literal("recent_chats"),
    threads: z.array(hubChatThreadSchema),
  }),
  hubModuleBaseSchema.extend({
    type: z.literal("resources"),
    resources: z.array(hubResourceSchema),
  }),
  hubModuleBaseSchema.extend({
    type: z.literal("notifications"),
    notifications: z.array(hubNotificationSchema),
  }),
  hubModuleBaseSchema.extend({
    type: z.literal("usage"),
    summary: hubUsageSummarySchema,
  }),
  hubModuleBaseSchema.extend({
    type: z.literal("builder_status"),
    draftCount: z.number().int().nonnegative(),
    submittedCount: z.number().int().nonnegative(),
    rejectedCount: z.number().int().nonnegative(),
  }),
  hubModuleBaseSchema.extend({
    type: z.literal("admin_attention"),
    criticalCount: z.number().int().nonnegative(),
    warningCount: z.number().int().nonnegative(),
    href: z.string().min(1),
    items: z.array(hubAdminAttentionItemSchema),
  }),
  hubModuleBaseSchema.extend({
    type: z.literal("developer_workbench"),
    tasks: z.array(taskSessionSchema),
    artifacts: z.array(artifactSchema),
  }),
])
export type HubModule = z.infer<typeof hubModuleSchema>

export const hubHomeResponseSchema = z.object({
  persona: personaSchema,
  capabilities: z.array(hubCapabilitySchema),
  modules: z.array(hubModuleSchema),
  generatedAt: z.string().datetime(),
})
export type HubHomeResponse = z.infer<typeof hubHomeResponseSchema>

export const hubSearchResultSchema = z.object({
  id: z.string().min(1),
  type: z.enum([
    "thread",
    "resource",
    "task",
    "artifact",
    "admin",
    "builder",
    "doc",
  ]),
  title: z.string().min(1),
  description: z.string().nullable(),
  href: z.string().min(1),
  rank: z.number().nonnegative(),
})
export type HubSearchResult = z.infer<typeof hubSearchResultSchema>

export const hubEventTypeSchema = z.enum([
  "notification.created",
  "notification.read",
  "task.updated",
  "artifact.created",
  "resource.lifecycle",
])
export type HubEventType = z.infer<typeof hubEventTypeSchema>

export const hubEventSchema = z.object({
  id: z.string().uuid(),
  type: hubEventTypeSchema,
  createdAt: z.string().datetime(),
  resourceId: z.string().min(1).nullable(),
  payload: z.record(z.unknown()),
})
export type HubEvent = z.infer<typeof hubEventSchema>
