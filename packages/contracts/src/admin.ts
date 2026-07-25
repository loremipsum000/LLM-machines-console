import { z } from "zod"
import { personaSchema, resourceTypeSchema } from "./common"
import {
  connectorVettingStatusSchema,
  hubSeveritySchema,
  hubSourceStatusSchema,
  mcpCatalogEntrySchema,
} from "./hub"

export const adminOverviewTileIdSchema = z.enum([
  "ops",
  "health",
  "governance",
  "activity",
])
export type AdminOverviewTileId = z.infer<typeof adminOverviewTileIdSchema>

export const adminOverviewMetricToneSchema = z.enum([
  "neutral",
  "good",
  "warning",
  "critical",
])
export type AdminOverviewMetricTone = z.infer<
  typeof adminOverviewMetricToneSchema
>

export const adminOverviewMetricSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  value: z.string().min(1),
  detail: z.string().min(1).nullable(),
  tone: adminOverviewMetricToneSchema,
})
export type AdminOverviewMetric = z.infer<typeof adminOverviewMetricSchema>

export const adminOverviewTileSchema = z.object({
  id: adminOverviewTileIdSchema,
  title: z.string().min(1),
  summary: z.string().min(1),
  href: z.string().min(1),
  sourceStatus: hubSourceStatusSchema,
  metrics: z.array(adminOverviewMetricSchema).min(1),
  updatedAt: z.string().datetime(),
})
export type AdminOverviewTile = z.infer<typeof adminOverviewTileSchema>

export const adminActivityEventSchema = z.object({
  id: z.string().min(1),
  actorId: z.string().min(1),
  action: z.string().min(1),
  targetType: z.string().min(1),
  targetId: z.string().min(1),
  severity: hubSeveritySchema,
  href: z.string().min(1),
  createdAt: z.string().datetime(),
})
export type AdminActivityEvent = z.infer<typeof adminActivityEventSchema>

export const adminAuditMetadataEntrySchema = z.object({
  label: z.string().min(1),
  value: z.string().min(1),
})
export type AdminAuditMetadataEntry = z.infer<
  typeof adminAuditMetadataEntrySchema
>

export const adminAuditEventSchema = z.object({
  id: z.string().min(1),
  actorId: z.string().min(1),
  action: z.string().min(1),
  targetType: z.string().min(1),
  targetId: z.string().min(1),
  reason: z.string().min(1).nullable(),
  severity: hubSeveritySchema,
  metadata: z.array(adminAuditMetadataEntrySchema),
  href: z.string().min(1),
  createdAt: z.string().datetime(),
})
export type AdminAuditEvent = z.infer<typeof adminAuditEventSchema>

export const adminAuditSourceSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  sourceStatus: hubSourceStatusSchema,
})
export type AdminAuditSource = z.infer<typeof adminAuditSourceSchema>

export const adminAuditResponseSchema = z.object({
  generatedAt: z.string().datetime(),
  query: z.string().min(1).nullable(),
  selectedEventId: z.string().min(1).nullable(),
  sourceStatus: hubSourceStatusSchema,
  sources: z.array(adminAuditSourceSchema).min(1),
  events: z.array(adminAuditEventSchema),
})
export type AdminAuditResponse = z.infer<typeof adminAuditResponseSchema>

export const adminTeamServiceStatusSchema = z.enum([
  "ok",
  "not_configured",
  "unauthorized",
  "unavailable",
  "invalid",
])
export type AdminTeamServiceStatus = z.infer<
  typeof adminTeamServiceStatusSchema
>

export const adminTeamMemberStatusSchema = z.enum([
  "active",
  "disabled",
  "deleted",
])
export type AdminTeamMemberStatus = z.infer<typeof adminTeamMemberStatusSchema>

export const adminTeamMemberSchema = z.object({
  createdAt: z.string().datetime().nullable(),
  displayName: z.string().min(1),
  email: z.string().email(),
  enabled: z.boolean(),
  groups: z.array(z.string().min(1)),
  id: z.string().min(1),
  keycloakHref: z.string().min(1).nullable(),
  lastActiveAt: z.string().datetime().nullable(),
  role: personaSchema,
  status: adminTeamMemberStatusSchema,
  username: z.string().min(1),
})
export type AdminTeamMember = z.infer<typeof adminTeamMemberSchema>

export const adminTeamUsageSummarySchema = z.object({
  mcpCalls: z.number().int().min(0),
  mostUsedModel: z.string().min(1).nullable(),
  prompts: z.number().int().min(0),
  sourceStatus: hubSourceStatusSchema,
  tokens: z.number().int().min(0),
  window: z.string().min(1),
})
export type AdminTeamUsageSummary = z.infer<
  typeof adminTeamUsageSummarySchema
>

export const adminTeamActivityRowSchema = z.object({
  action: z.string().min(1),
  createdAt: z.string().datetime(),
  href: z.string().min(1),
  id: z.string().min(1),
  targetId: z.string().min(1),
  targetType: z.string().min(1),
})
export type AdminTeamActivityRow = z.infer<typeof adminTeamActivityRowSchema>

export const adminTeamMemberDetailSchema = z.object({
  activity: z.array(adminTeamActivityRowSchema),
  member: adminTeamMemberSchema,
  usage: adminTeamUsageSummarySchema,
})
export type AdminTeamMemberDetail = z.infer<
  typeof adminTeamMemberDetailSchema
>

export const adminTeamGroupUnlockSchema = z.object({
  href: z.string().min(1),
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(["corpus", "mcp_server"]),
})
export type AdminTeamGroupUnlock = z.infer<typeof adminTeamGroupUnlockSchema>

export const adminTeamGroupSchema = z.object({
  id: z.string().min(1),
  keycloakHref: z.string().min(1).nullable(),
  memberCount: z.number().int().min(0),
  name: z.string().min(1),
  unlockCount: z.number().int().min(0),
  virtual: z.boolean(),
})
export type AdminTeamGroup = z.infer<typeof adminTeamGroupSchema>

export const adminTeamGroupDetailSchema = z.object({
  group: adminTeamGroupSchema,
  members: z.array(adminTeamMemberSchema),
  unlocks: z.array(adminTeamGroupUnlockSchema),
})
export type AdminTeamGroupDetail = z.infer<typeof adminTeamGroupDetailSchema>

export const adminTeamBreakGlassSchema = z.object({
  eligibleAdmins: z.array(adminTeamMemberSchema),
  selectedAdminId: z.string().min(1).nullable(),
  updatedAt: z.string().datetime().nullable(),
  updatedBy: z.string().min(1).nullable(),
})
export type AdminTeamBreakGlass = z.infer<typeof adminTeamBreakGlassSchema>

export const updateAdminTeamBreakGlassRequestSchema = z.object({
  selectedAdminId: z.string().trim().min(1),
})
export type UpdateAdminTeamBreakGlassRequest = z.infer<
  typeof updateAdminTeamBreakGlassRequestSchema
>

export const adminTeamScimStatusSchema = z.object({
  detail: z.string().min(1),
  keycloakHref: z.string().min(1).nullable(),
  lastSyncAt: z.string().datetime().nullable(),
  provider: z.string().min(1).nullable(),
  sourceStatus: hubSourceStatusSchema,
  status: z.enum(["configured", "not_configured", "unknown"]),
})
export type AdminTeamScimStatus = z.infer<typeof adminTeamScimStatusSchema>

export const adminTeamOverviewResponseSchema = z.object({
  breakGlass: adminTeamBreakGlassSchema,
  generatedAt: z.string().datetime(),
  groups: z.array(adminTeamGroupSchema),
  members: z.array(adminTeamMemberSchema),
  scim: adminTeamScimStatusSchema,
  serviceStatus: adminTeamServiceStatusSchema,
  sourceStatus: hubSourceStatusSchema,
})
export type AdminTeamOverviewResponse = z.infer<
  typeof adminTeamOverviewResponseSchema
>

export const createAdminTeamMemberRequestSchema = z.object({
  displayName: z.string().trim().min(1).max(160),
  email: z.string().trim().email(),
  enabled: z.boolean().default(true),
  generatePassword: z.boolean().default(true),
  groups: z.array(z.string().trim().min(1)).default([]),
  role: personaSchema,
  sendInvite: z.boolean().default(false),
  username: z.string().trim().min(1).max(80).optional(),
})
export type CreateAdminTeamMemberRequest = z.infer<
  typeof createAdminTeamMemberRequestSchema
>

export const adminTeamMemberMutationResponseSchema = z.object({
  generatedPassword: z.string().min(12).nullable(),
  member: adminTeamMemberSchema,
})
export type AdminTeamMemberMutationResponse = z.infer<
  typeof adminTeamMemberMutationResponseSchema
>

export const adminTeamActionResponseSchema = z.object({
  member: adminTeamMemberSchema.nullable(),
  status: z.enum([
    "ok",
    "created",
    "sent",
    "disabled",
    "reactivated",
    "deleted",
    "blocked",
  ]),
})
export type AdminTeamActionResponse = z.infer<
  typeof adminTeamActionResponseSchema
>

export const adminTeamGroupMutationResponseSchema = z.object({
  group: adminTeamGroupSchema.nullable(),
  status: z.enum(["created", "updated", "deleted", "assigned", "removed"]),
})
export type AdminTeamGroupMutationResponse = z.infer<
  typeof adminTeamGroupMutationResponseSchema
>

export const updateAdminTeamMemberGroupsRequestSchema = z.object({
  groups: z.array(z.string().trim().min(1)).default([]),
})
export type UpdateAdminTeamMemberGroupsRequest = z.infer<
  typeof updateAdminTeamMemberGroupsRequestSchema
>

export const sendAdminTeamEmailRequestSchema = z.object({
  email: z.string().trim().email(),
})
export type SendAdminTeamEmailRequest = z.infer<
  typeof sendAdminTeamEmailRequestSchema
>

export const createAdminTeamGroupRequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
})
export type CreateAdminTeamGroupRequest = z.infer<
  typeof createAdminTeamGroupRequestSchema
>

export const updateAdminTeamGroupRequestSchema =
  createAdminTeamGroupRequestSchema
export type UpdateAdminTeamGroupRequest = z.infer<
  typeof updateAdminTeamGroupRequestSchema
>

export const adminTeamBulkGroupAssignmentRequestSchema = z.object({
  memberIds: z.array(z.string().min(1)).min(1),
})
export type AdminTeamBulkGroupAssignmentRequest = z.infer<
  typeof adminTeamBulkGroupAssignmentRequestSchema
>

export const deleteAdminTeamMemberRequestSchema = z.object({
  confirmation: z.literal("DELETE"),
})
export type DeleteAdminTeamMemberRequest = z.infer<
  typeof deleteAdminTeamMemberRequestSchema
>

export const adminTeamCsvImportRowStatusSchema = z.enum([
  "valid",
  "invalid",
  "created",
  "skipped",
  "failed",
])
export type AdminTeamCsvImportRowStatus = z.infer<
  typeof adminTeamCsvImportRowStatusSchema
>

export const adminTeamCsvImportRowSchema = z.object({
  actions: z.array(z.enum(["create_user", "assign_group", "send_invite"])),
  errors: z.array(z.string().min(1)),
  line: z.number().int().min(2),
  name: z.string(),
  email: z.string(),
  enabled: z.boolean(),
  group: z.string(),
  role: personaSchema,
  sendInvite: z.boolean(),
  status: adminTeamCsvImportRowStatusSchema,
  username: z.string(),
})
export type AdminTeamCsvImportRow = z.infer<
  typeof adminTeamCsvImportRowSchema
>

export const adminTeamCsvImportPreviewRequestSchema = z.object({
  csv: z.string().min(1),
})
export type AdminTeamCsvImportPreviewRequest = z.infer<
  typeof adminTeamCsvImportPreviewRequestSchema
>

export const adminTeamCsvImportCommitRequestSchema =
  adminTeamCsvImportPreviewRequestSchema.extend({
    allowPartial: z.boolean().default(false),
  })
export type AdminTeamCsvImportCommitRequest = z.infer<
  typeof adminTeamCsvImportCommitRequestSchema
>

export const adminTeamCsvImportPreviewResponseSchema = z.object({
  generatedAt: z.string().datetime(),
  rows: z.array(adminTeamCsvImportRowSchema),
  valid: z.boolean(),
})
export type AdminTeamCsvImportPreviewResponse = z.infer<
  typeof adminTeamCsvImportPreviewResponseSchema
>

export const adminTeamCsvImportCommitResponseSchema =
  adminTeamCsvImportPreviewResponseSchema.extend({
    createdCount: z.number().int().min(0),
    failedCount: z.number().int().min(0),
    skippedCount: z.number().int().min(0),
  })
export type AdminTeamCsvImportCommitResponse = z.infer<
  typeof adminTeamCsvImportCommitResponseSchema
>

export const adminApprovalQueueItemSchema = z.object({
  id: z.string().uuid(),
  resourceId: z.string().uuid(),
  resourceName: z.string().min(1),
  resourceType: resourceTypeSchema,
  description: z.string().min(1),
  ownerId: z.string().min(1),
  ownerName: z.string().min(1),
  submittedVersion: z.string().min(1),
  submittedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  reviewHref: z.string().min(1),
  auditHref: z.string().min(1),
})
export type AdminApprovalQueueItem = z.infer<
  typeof adminApprovalQueueItemSchema
>

export const adminApprovalQueueResponseSchema = z.object({
  generatedAt: z.string().datetime(),
  query: z.string().min(1).nullable(),
  sourceStatus: hubSourceStatusSchema,
  pendingCount: z.number().int().nonnegative(),
  items: z.array(adminApprovalQueueItemSchema),
})
export type AdminApprovalQueueResponse = z.infer<
  typeof adminApprovalQueueResponseSchema
>

export const adminConnectorRegistryPostureSchema = z.enum([
  "approved",
  "review_required",
  "blocked",
  "disabled",
  "deprecated",
])
export type AdminConnectorRegistryPosture = z.infer<
  typeof adminConnectorRegistryPostureSchema
>

export const adminConnectorRegistrySummarySchema = z.object({
  totalCount: z.number().int().nonnegative(),
  approvedCount: z.number().int().nonnegative(),
  pendingCount: z.number().int().nonnegative(),
  blockedCount: z.number().int().nonnegative(),
  secretsRequiredCount: z.number().int().nonnegative(),
  t2T3Count: z.number().int().nonnegative(),
})
export type AdminConnectorRegistrySummary = z.infer<
  typeof adminConnectorRegistrySummarySchema
>

export const adminConnectorVettingDecisionSchema = z.enum([
  "approved_read_only",
  "approved_read_write",
  "blocked",
  "disabled",
])
export type AdminConnectorVettingDecision = z.infer<
  typeof adminConnectorVettingDecisionSchema
>

export const adminConnectorVettingChecklistDefaults = {
  auditEventsReviewed: false,
  dataClassesReviewed: false,
  endpointsReviewed: false,
  licenseReviewed: false,
  runtimeSetupAcknowledged: false,
  scopesReviewed: false,
  secretsPlanReviewed: false,
  sourceIntegrityReviewed: false,
}

export const adminConnectorVettingChecklistSchema = z
  .object({
    auditEventsReviewed: z.boolean().default(false),
    dataClassesReviewed: z.boolean().default(false),
    endpointsReviewed: z.boolean().default(false),
    licenseReviewed: z.boolean().default(false),
    runtimeSetupAcknowledged: z.boolean().default(false),
    scopesReviewed: z.boolean().default(false),
    secretsPlanReviewed: z.boolean().default(false),
    sourceIntegrityReviewed: z.boolean().default(false),
  })
  .default(adminConnectorVettingChecklistDefaults)
export type AdminConnectorVettingChecklist = z.infer<
  typeof adminConnectorVettingChecklistSchema
>

export const adminConnectorVettingDecisionRecordSchema = z.object({
  id: z.string().uuid(),
  connectorId: z.string().min(1),
  decision: adminConnectorVettingDecisionSchema,
  checklist: adminConnectorVettingChecklistSchema,
  note: z.string().min(1),
  decidedBy: z.string().min(1),
  decidedAt: z.string().datetime(),
  sourceRef: z.string().min(1),
  checksum: z.string().min(1),
  requiredScopes: z.array(z.string().min(1)),
  allowedEndpoints: z.array(z.string().min(1)),
})
export type AdminConnectorVettingDecisionRecord = z.infer<
  typeof adminConnectorVettingDecisionRecordSchema
>

export const adminConnectorRuntimeSetupStatusSchema = z.enum([
  "ready",
  "needs_vetting",
  "blocked_by_policy",
  "missing_secrets",
  "missing_egress",
  "unsupported_runtime",
])
export type AdminConnectorRuntimeSetupStatus = z.infer<
  typeof adminConnectorRuntimeSetupStatusSchema
>

export const adminConnectorRuntimeSetupSchema = z.object({
  runnable: z.boolean(),
  status: adminConnectorRuntimeSetupStatusSchema,
  detail: z.string().min(1),
  missingSecrets: z.array(z.string().min(1)),
  missingEgress: z.array(z.string().min(1)),
  activeEgress: z.array(z.string().min(1)),
  setupHref: z.string().min(1),
})
export type AdminConnectorRuntimeSetup = z.infer<
  typeof adminConnectorRuntimeSetupSchema
>

export const adminConnectorRegistryItemSchema = mcpCatalogEntrySchema.extend({
  sourceStatus: hubSourceStatusSchema,
  posture: adminConnectorRegistryPostureSchema,
  effectiveVettingStatus: connectorVettingStatusSchema,
  localDecision: adminConnectorVettingDecisionRecordSchema.nullable(),
  runtimeSetup: adminConnectorRuntimeSetupSchema,
  reviewHref: z.string().min(1),
  auditHref: z.string().min(1),
})
export type AdminConnectorRegistryItem = z.infer<
  typeof adminConnectorRegistryItemSchema
>

export const adminConnectorRegistryResponseSchema = z.object({
  generatedAt: z.string().datetime(),
  query: z.string().min(1).nullable(),
  sourceStatus: hubSourceStatusSchema,
  summary: adminConnectorRegistrySummarySchema,
  items: z.array(adminConnectorRegistryItemSchema),
})
export type AdminConnectorRegistryResponse = z.infer<
  typeof adminConnectorRegistryResponseSchema
>

export const adminLibreChatNativeAgentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  authorId: z.string().min(1).nullable(),
  visibility: z.enum(["private", "shared", "public", "unknown"]),
  updatedAt: z.string().datetime().nullable(),
})
export type AdminLibreChatNativeAgent = z.infer<
  typeof adminLibreChatNativeAgentSchema
>

export const adminLibreChatAgentPostureSchema = z.object({
  generatedAt: z.string().datetime(),
  sourceStatus: hubSourceStatusSchema,
  enabled: z.boolean(),
  memoryEnabled: z.boolean(),
  creatorPolicy: z.literal("builders_admins"),
  modelEndpoint: z.literal("bff_litellm"),
  mcpMode: z.literal("catalog_only"),
  mcpGateway: z.object({
    sourceStatus: hubSourceStatusSchema,
    runnableCount: z.number().int().nonnegative(),
    blockedCount: z.number().int().nonnegative(),
    exposedConnectorIds: z.array(z.string().min(1)),
  }),
  mirroredAgents: z.array(adminLibreChatNativeAgentSchema),
  recentAuditHref: z.string().min(1),
})
export type AdminLibreChatAgentPosture = z.infer<
  typeof adminLibreChatAgentPostureSchema
>

export const adminInternalDocsMcpPostureSchema = z.object({
  generatedAt: z.string().datetime(),
  sourceStatus: hubSourceStatusSchema,
  auth: z.object({
    routeScopedServiceAuthEnabled: z.boolean(),
    unresolvedPlaceholderProtection: z.boolean(),
  }),
  tools: z.array(z.string().min(1)),
  embedding: z.object({
    enabled: z.boolean(),
    model: z.string().min(1),
    dimensions: z.number().int().positive(),
    searchMode: z.enum(["hybrid", "lexical"]),
    sourceStatus: hubSourceStatusSchema,
    coverage: z.object({
      totalCount: z.number().int().nonnegative(),
      readyCount: z.number().int().nonnegative(),
      failedCount: z.number().int().nonnegative(),
    }),
  }),
  corpora: z.object({
    publishedAccessibleCount: z.number().int().nonnegative(),
    totalChunkCount: z.number().int().nonnegative(),
  }),
  recentFailures: z.array(
    z.object({
      action: z.string().min(1),
      reason: z.string().min(1),
      createdAt: z.string().datetime(),
    }),
  ),
})
export type AdminInternalDocsMcpPosture = z.infer<
  typeof adminInternalDocsMcpPostureSchema
>

export const adminSettingsLanguageSchema = z.enum(["en", "hr"])
export type AdminSettingsLanguage = z.infer<typeof adminSettingsLanguageSchema>

export const adminSettingsLogoMimeTypeSchema = z.enum([
  "image/png",
  "image/jpeg",
])
export type AdminSettingsLogoMimeType = z.infer<
  typeof adminSettingsLogoMimeTypeSchema
>

const maxLogoBytes = 1024 * 1024

export const adminSettingsLogoAssetSchema = z
  .object({
    checksum: z.string().min(1),
    dataUrl: z.string().min(1).max(1_500_000),
    fileName: z.string().trim().min(1).max(120),
    height: z.number().int().positive(),
    mimeType: adminSettingsLogoMimeTypeSchema,
    sizeBytes: z.number().int().positive().max(maxLogoBytes),
    updatedAt: z.string().datetime(),
    width: z.number().int().positive(),
  })
  .strict()
export type AdminSettingsLogoAsset = z.infer<
  typeof adminSettingsLogoAssetSchema
>

export const adminSettingsOrganizationSchema = z.object({
  defaultLanguage: adminSettingsLanguageSchema,
  fullLogo: adminSettingsLogoAssetSchema.nullable(),
  iconLogo: adminSettingsLogoAssetSchema.nullable(),
  organizationName: z.string().trim().min(1).max(120),
  updatedAt: z.string().datetime().nullable(),
  updatedBy: z.string().min(1).nullable(),
})
export type AdminSettingsOrganization = z.infer<
  typeof adminSettingsOrganizationSchema
>

export const updateAdminSettingsOrganizationRequestSchema = z
  .object({
    defaultLanguage: adminSettingsLanguageSchema,
    fullLogo: adminSettingsLogoAssetSchema.nullable().optional(),
    iconLogo: adminSettingsLogoAssetSchema.nullable().optional(),
    organizationName: z.string().trim().min(1).max(120),
  })
  .superRefine((value, ctx) => {
    if (value.iconLogo && value.iconLogo.width !== value.iconLogo.height) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Icon logo must use a 1:1 aspect ratio.",
        path: ["iconLogo"],
      })
    }
  })
export type UpdateAdminSettingsOrganizationRequest = z.infer<
  typeof updateAdminSettingsOrganizationRequestSchema
>

export const adminUrlPolicyRuleTypeSchema = z.enum(["trusted", "forbidden"])
export type AdminUrlPolicyRuleType = z.infer<
  typeof adminUrlPolicyRuleTypeSchema
>

export const adminUrlPolicyRuleScopeSchema = z.enum([
  "knowledge_ingestion",
  "web_fetch",
  "mcp_egress",
  "all",
])
export type AdminUrlPolicyRuleScope = z.infer<
  typeof adminUrlPolicyRuleScopeSchema
>

export const adminUrlPolicyRuleStatusSchema = z.enum(["active", "disabled"])
export type AdminUrlPolicyRuleStatus = z.infer<
  typeof adminUrlPolicyRuleStatusSchema
>

const adminUrlPolicyPatternSchema = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine(isValidAdminUrlPolicyPattern, {
    message: "URL policy pattern must be an HTTP(S) URL or domain.",
  })

export const adminUrlPolicyRuleSchema = z.object({
  createdAt: z.string().datetime(),
  createdBy: z.string().min(1),
  id: z.string().uuid(),
  normalizedPattern: z.string().min(1),
  pattern: adminUrlPolicyPatternSchema,
  reason: z.string().trim().min(3).max(500),
  scope: adminUrlPolicyRuleScopeSchema,
  status: adminUrlPolicyRuleStatusSchema,
  type: adminUrlPolicyRuleTypeSchema,
  updatedAt: z.string().datetime(),
  updatedBy: z.string().min(1),
})
export type AdminUrlPolicyRule = z.infer<typeof adminUrlPolicyRuleSchema>

export const createAdminUrlPolicyRuleRequestSchema = z.object({
  pattern: adminUrlPolicyPatternSchema,
  reason: z.string().trim().min(3).max(500),
  scope: adminUrlPolicyRuleScopeSchema.default("all"),
  type: adminUrlPolicyRuleTypeSchema,
})
export type CreateAdminUrlPolicyRuleRequest = z.infer<
  typeof createAdminUrlPolicyRuleRequestSchema
>

export const updateAdminUrlPolicyRuleRequestSchema =
  createAdminUrlPolicyRuleRequestSchema.extend({
    status: adminUrlPolicyRuleStatusSchema.default("active"),
  })
export type UpdateAdminUrlPolicyRuleRequest = z.infer<
  typeof updateAdminUrlPolicyRuleRequestSchema
>

export const adminSettingsServiceIdSchema = z.enum([
  "web",
  "bff",
  "postgres",
  "redis",
  "minio",
  "keycloak",
  "litellm",
  "librechat",
  "grafana",
  "agentic_adapter",
])
export type AdminSettingsServiceId = z.infer<
  typeof adminSettingsServiceIdSchema
>

export const adminSettingsReachabilityServiceSchema = z.object({
  detail: z.string().min(1),
  id: adminSettingsServiceIdSchema,
  label: z.string().min(1),
  lastCheckedAt: z.string().datetime().nullable(),
  owningSection: z.enum([
    "settings",
    "applications",
    "inference",
    "hardware",
    "team",
  ]),
  status: hubSourceStatusSchema,
})
export type AdminSettingsReachabilityService = z.infer<
  typeof adminSettingsReachabilityServiceSchema
>

export const adminSettingsLicenseSubscriptionStateSchema = z.enum([
  "active",
  "soft_grace",
  "restricted",
  "terminated",
  "unknown",
  "not_configured",
])
export type AdminSettingsLicenseSubscriptionState = z.infer<
  typeof adminSettingsLicenseSubscriptionStateSchema
>

export const adminSettingsLicenseStateSchema = z.object({
  allowedUpdateChannels: z.array(z.string().min(1)),
  applianceId: z.string().min(1).nullable(),
  certificateExpiresAt: z.string().datetime().nullable(),
  lastEntitlementCheckAt: z.string().datetime().nullable(),
  offlineMode: z.boolean(),
  sourceStatus: hubSourceStatusSchema,
  subscriptionState: adminSettingsLicenseSubscriptionStateSchema,
  supportState: z.string().min(1),
  telemetryOptIn: z.boolean(),
})
export type AdminSettingsLicenseState = z.infer<
  typeof adminSettingsLicenseStateSchema
>

export const adminSettingsSystemUpdateStatusSchema = z.enum([
  "not_configured",
  "no_updates",
  "available",
  "blocked",
  "running",
  "failed",
])
export type AdminSettingsSystemUpdateStatus = z.infer<
  typeof adminSettingsSystemUpdateStatusSchema
>

export const adminSettingsSystemUpdateSchema = z.object({
  affectedComponents: z.array(z.string().min(1)),
  availableVersion: z.string().min(1).nullable(),
  detail: z.string().min(1),
  expectedDowntime: z.string().min(1).nullable(),
  sourceStatus: hubSourceStatusSchema,
  status: adminSettingsSystemUpdateStatusSchema,
  updateActionEnabled: z.boolean(),
})
export type AdminSettingsSystemUpdate = z.infer<
  typeof adminSettingsSystemUpdateSchema
>

export const adminSettingsTelemetryPayloadPreviewSchema = z
  .object({
    applianceId: z.string().min(1).nullable(),
    installedVersion: z.string().min(1).nullable(),
    lastAppliedUpdate: z.string().min(1).nullable(),
    lastUpdateCheck: z.string().datetime().nullable(),
    subscriptionStateSeenByAppliance:
      adminSettingsLicenseSubscriptionStateSchema,
    updateAgentVersion: z.string().min(1).nullable(),
  })
  .strict()
export type AdminSettingsTelemetryPayloadPreview = z.infer<
  typeof adminSettingsTelemetryPayloadPreviewSchema
>

export const adminSettingsPrivacySchema = z.object({
  dataResidencyStatement: z.string().min(1),
  privacyPolicyHref: z.string().min(1),
  telemetryDescription: z.string().min(1),
  telemetryEnabled: z.boolean(),
  telemetryPayloadPreview: adminSettingsTelemetryPayloadPreviewSchema,
  updatedAt: z.string().datetime().nullable(),
  updatedBy: z.string().min(1).nullable(),
})
export type AdminSettingsPrivacy = z.infer<typeof adminSettingsPrivacySchema>

export const updateAdminSettingsTelemetryRequestSchema = z
  .object({
    confirmation: z.string().trim().optional(),
    enabled: z.boolean(),
  })
  .superRefine((value, ctx) => {
    if (value.enabled && value.confirmation !== "ENABLE TELEMETRY") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Enabling telemetry requires exact confirmation.",
        path: ["confirmation"],
      })
    }
  })
export type UpdateAdminSettingsTelemetryRequest = z.infer<
  typeof updateAdminSettingsTelemetryRequestSchema
>

export const adminSettingsResponseSchema = z.object({
  generatedAt: z.string().datetime(),
  license: adminSettingsLicenseStateSchema,
  organization: adminSettingsOrganizationSchema,
  privacy: adminSettingsPrivacySchema,
  reachability: z.array(adminSettingsReachabilityServiceSchema),
  sourceStatus: hubSourceStatusSchema,
  systemUpdate: adminSettingsSystemUpdateSchema,
  urlPolicyRules: z.array(adminUrlPolicyRuleSchema),
})
export type AdminSettingsResponse = z.infer<typeof adminSettingsResponseSchema>

function isValidAdminUrlPolicyPattern(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) {
    return false
  }
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed)
      return (
        (parsed.protocol === "http:" || parsed.protocol === "https:") &&
        isValidDomainPattern(parsed.hostname)
      )
    } catch {
      return false
    }
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    return false
  }
  return isValidDomainPattern(trimmed)
}

function isValidDomainPattern(value: string): boolean {
  const domain = value.startsWith("*.") ? value.slice(2) : value
  if (domain.length > 253 || domain.includes("/") || domain.includes(":")) {
    return false
  }
  const labels = domain.split(".")
  if (labels.length < 2) {
    return false
  }
  return labels.every((label) =>
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label),
  )
}

export const adminConnectorVettingDecisionRequestSchema = z.object({
  checklist: adminConnectorVettingChecklistSchema,
  decision: adminConnectorVettingDecisionSchema,
  note: z.string().trim().min(3).max(1000),
})
export type AdminConnectorVettingDecisionRequest = z.infer<
  typeof adminConnectorVettingDecisionRequestSchema
>

export const adminMcpServerTransportSchema = z.enum(["url", "stdio"])
export type AdminMcpServerTransport = z.infer<
  typeof adminMcpServerTransportSchema
>

export const adminMcpServerAuthModeSchema = z.enum(["bearer", "none"])
export type AdminMcpServerAuthMode = z.infer<
  typeof adminMcpServerAuthModeSchema
>

export const adminMcpServerStatusSchema = z.enum([
  "draft",
  "enabled",
  "disabled",
])
export type AdminMcpServerStatus = z.infer<typeof adminMcpServerStatusSchema>

const createAdminMcpServerRequestBaseSchema = z.object({
  accessGroups: z.array(z.string().trim().min(1)).default([]),
  accessLevel: z.enum(["read_only", "read_write"]),
  authMode: adminMcpServerAuthModeSchema,
  bearerTokenSecretRef: z.string().trim().min(1).optional(),
  chatCommand: z
    .string()
    .trim()
    .regex(
      /^@[a-z0-9][a-z0-9_-]{1,31}$/,
      "Chat command must look like @docs-server.",
    ),
  description: z.string().trim().min(1).max(500),
  endpointUrl: z.string().trim().url().optional(),
  name: z.string().trim().min(1).max(80),
  saveMode: z.enum(["draft", "enabled"]).default("enabled"),
  stdioCommand: z.string().trim().min(1).optional(),
  transport: adminMcpServerTransportSchema,
})

export const createAdminMcpServerRequestSchema =
  createAdminMcpServerRequestBaseSchema.superRefine((value, ctx) => {
    if (value.transport === "url" && !value.endpointUrl) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "URL transport requires an MCP endpoint URL.",
        path: ["endpointUrl"],
      })
    }
    if (value.transport === "stdio" && !value.stdioCommand) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "STDIO transport requires a package or command reference.",
        path: ["stdioCommand"],
      })
    }
    if (value.authMode === "bearer" && !value.bearerTokenSecretRef) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Bearer auth requires a secret reference.",
        path: ["bearerTokenSecretRef"],
      })
    }
    if (value.transport === "stdio" && value.authMode !== "none") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "STDIO connector drafts cannot use URL bearer auth.",
        path: ["authMode"],
      })
    }
  })
export type CreateAdminMcpServerRequest = z.infer<
  typeof createAdminMcpServerRequestSchema
>

const updateAdminMcpServerRequestBaseSchema =
  createAdminMcpServerRequestBaseSchema
    .omit({
      chatCommand: true,
      saveMode: true,
    })
    .extend({
      status: adminMcpServerStatusSchema,
    })

export const updateAdminMcpServerRequestSchema =
  updateAdminMcpServerRequestBaseSchema.superRefine((value, ctx) => {
    if (value.transport === "url" && !value.endpointUrl) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "URL transport requires an MCP endpoint URL.",
        path: ["endpointUrl"],
      })
    }
    if (value.transport === "stdio" && !value.stdioCommand) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "STDIO transport requires a package or command reference.",
        path: ["stdioCommand"],
      })
    }
    if (value.authMode === "bearer" && !value.bearerTokenSecretRef) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Bearer auth requires a secret reference.",
        path: ["bearerTokenSecretRef"],
      })
    }
    if (value.transport === "stdio" && value.authMode !== "none") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "STDIO connector drafts cannot use URL bearer auth.",
        path: ["authMode"],
      })
    }
  })
export type UpdateAdminMcpServerRequest = z.infer<
  typeof updateAdminMcpServerRequestSchema
>

export const adminMcpServerDetailSchema = z.object({
  accessGroups: z.array(z.string().min(1)),
  accessLevel: z.enum(["read_only", "read_write"]),
  auditHref: z.string().min(1),
  authMode: adminMcpServerAuthModeSchema,
  bearerTokenSecretRef: z.string().min(1).nullable(),
  chatCommand: z.string().min(1),
  createdAt: z.string().datetime(),
  description: z.string().min(1),
  endpointUrl: z.string().min(1).nullable(),
  id: z.string().min(1),
  name: z.string().min(1),
  status: adminMcpServerStatusSchema,
  stdioCommand: z.string().min(1).nullable(),
  supportTier: z.literal("t3"),
  transport: adminMcpServerTransportSchema,
  updatedAt: z.string().datetime(),
})
export type AdminMcpServerDetail = z.infer<typeof adminMcpServerDetailSchema>

export const adminMcpServerConnectionTestRequestSchema =
  createAdminMcpServerRequestBaseSchema
    .omit({
      accessGroups: true,
      saveMode: true,
    })
    .superRefine((value, ctx) => {
      if (value.transport === "url" && !value.endpointUrl) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "URL transport requires an MCP endpoint URL.",
          path: ["endpointUrl"],
        })
      }
      if (value.transport === "stdio" && !value.stdioCommand) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "STDIO transport requires a package or command reference.",
          path: ["stdioCommand"],
        })
      }
      if (value.authMode === "bearer" && !value.bearerTokenSecretRef) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Bearer auth requires a secret reference.",
          path: ["bearerTokenSecretRef"],
        })
      }
      if (value.transport === "stdio" && value.authMode !== "none") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "STDIO connector drafts cannot use URL bearer auth.",
          path: ["authMode"],
        })
      }
    })
export type AdminMcpServerConnectionTestRequest = z.infer<
  typeof adminMcpServerConnectionTestRequestSchema
>

export const adminMcpServerConnectionTestResponseSchema = z.object({
  detail: z.string().min(1),
  discoveredTools: z.array(z.string().min(1)),
  status: z.enum(["passed", "failed", "unsupported"]),
})
export type AdminMcpServerConnectionTestResponse = z.infer<
  typeof adminMcpServerConnectionTestResponseSchema
>

export const adminConnectedAppEnvironmentSchema = z.enum([
  "staging",
  "production",
])
export type AdminConnectedAppEnvironment = z.infer<
  typeof adminConnectedAppEnvironmentSchema
>

export const adminConnectedAppAuthMethodSchema = z.enum([
  "api_key",
  "oauth_client_credentials",
])
export type AdminConnectedAppAuthMethod = z.infer<
  typeof adminConnectedAppAuthMethodSchema
>

export const adminConnectedAppStatusSchema = z.enum(["enabled", "disabled"])
export type AdminConnectedAppStatus = z.infer<
  typeof adminConnectedAppStatusSchema
>

export const adminConnectedAppTestStatusSchema = z.enum([
  "not_tested",
  "passed",
  "failed",
  "stale",
])
export type AdminConnectedAppTestStatus = z.infer<
  typeof adminConnectedAppTestStatusSchema
>

export const adminConnectedAppUsageSummarySchema = z.object({
  failures7d: z.number().int().min(0),
  lastUsedAt: z.string().datetime().nullable(),
  requests7d: z.number().int().min(0),
  tokens7d: z.number().int().min(0),
})
export type AdminConnectedAppUsageSummary = z.infer<
  typeof adminConnectedAppUsageSummarySchema
>

export const adminConnectedAppEnvironmentStateSchema = z.object({
  authMethods: z
    .array(adminConnectedAppAuthMethodSchema)
    .default(["oauth_client_credentials"]),
  clientId: z.string().min(1).nullable(),
  credentialIssuedAt: z.string().datetime().nullable(),
  environment: adminConnectedAppEnvironmentSchema,
  keyPrefix: z.string().min(1).nullable().default(null),
  lastUsedAt: z.string().datetime().nullable().default(null),
  lastTestedAt: z.string().datetime().nullable(),
  primaryAuthMethod: adminConnectedAppAuthMethodSchema.default(
    "oauth_client_credentials",
  ),
  productionReady: z.boolean(),
  testStatus: adminConnectedAppTestStatusSchema,
})
export type AdminConnectedAppEnvironmentState = z.infer<
  typeof adminConnectedAppEnvironmentStateSchema
>

export const adminConnectedAppCredentialSchema = z.object({
  apiKey: z.string().min(1).optional(),
  authMethod: adminConnectedAppAuthMethodSchema,
  bffBaseUrl: z.string().url(),
  clientId: z.string().min(1).optional(),
  clientSecret: z.string().min(1).optional(),
  environment: adminConnectedAppEnvironmentSchema,
  exampleCurl: z.string().min(1),
  keyPrefix: z.string().min(1).nullable(),
  model: z.string().min(1).nullable(),
  openAiBaseUrl: z.string().url(),
  tokenUrl: z.string().url().optional(),
})
export type AdminConnectedAppCredential = z.infer<
  typeof adminConnectedAppCredentialSchema
>

export const adminConnectedAppSchema = z.object({
  allowedModels: z.array(z.string().min(1)).min(1),
  auditHref: z.string().min(1),
  createdAt: z.string().datetime(),
  description: z.string().min(1),
  detailHref: z.string().min(1),
  environments: z.array(adminConnectedAppEnvironmentStateSchema).min(1),
  id: z.string().min(1),
  name: z.string().min(1),
  ownerGroup: z.string().min(1),
  rateLimitRpm: z.number().int().min(1).nullable(),
  status: adminConnectedAppStatusSchema,
  tokenBudget7d: z.number().int().min(1).nullable(),
  updatedAt: z.string().datetime(),
  usage: adminConnectedAppUsageSummarySchema,
})
export type AdminConnectedApp = z.infer<typeof adminConnectedAppSchema>

export const adminConnectedAppsResponseSchema = z.object({
  apps: z.array(adminConnectedAppSchema),
  generatedAt: z.string().datetime(),
  sourceStatus: hubSourceStatusSchema,
})
export type AdminConnectedAppsResponse = z.infer<
  typeof adminConnectedAppsResponseSchema
>

export const adminConnectedAppDetailSchema = z.object({
  app: adminConnectedAppSchema,
})
export type AdminConnectedAppDetail = z.infer<
  typeof adminConnectedAppDetailSchema
>

export const adminConnectedAppCreateRequestSchema = z.object({
  allowedModels: z.array(z.string().trim().min(1)).min(1),
  authMethod: adminConnectedAppAuthMethodSchema.default("api_key"),
  description: z.string().trim().min(1).max(500),
  name: z.string().trim().min(1).max(80),
  ownerGroup: z.string().trim().min(1).default("Everyone"),
  rateLimitRpm: z.number().int().min(1).max(10_000).nullable().default(null),
  tokenBudget7d: z
    .number()
    .int()
    .min(1)
    .max(100_000_000)
    .nullable()
    .default(null),
})
export type AdminConnectedAppCreateRequest = z.infer<
  typeof adminConnectedAppCreateRequestSchema
>

export const adminConnectedAppUpdateRequestSchema =
  adminConnectedAppCreateRequestSchema.extend({
    status: adminConnectedAppStatusSchema.default("enabled"),
  })
export type AdminConnectedAppUpdateRequest = z.infer<
  typeof adminConnectedAppUpdateRequestSchema
>

export const adminConnectedAppCreateResponseSchema = z.object({
  app: adminConnectedAppSchema,
  credential: adminConnectedAppCredentialSchema,
  status: z.literal("created"),
})
export type AdminConnectedAppCreateResponse = z.infer<
  typeof adminConnectedAppCreateResponseSchema
>

export const adminConnectedAppTestResultSchema = z.object({
  app: adminConnectedAppSchema,
  detail: z.string().min(1),
  environment: adminConnectedAppEnvironmentSchema,
  status: z.enum(["passed", "failed", "blocked"]),
  testedAt: z.string().datetime(),
})
export type AdminConnectedAppTestResult = z.infer<
  typeof adminConnectedAppTestResultSchema
>

export const adminConnectedAppPromotionResultSchema = z.object({
  app: adminConnectedAppSchema,
  credential: adminConnectedAppCredentialSchema.optional(),
  detail: z.string().min(1),
  status: z.enum(["promoted", "blocked"]),
})
export type AdminConnectedAppPromotionResult = z.infer<
  typeof adminConnectedAppPromotionResultSchema
>

export const adminConnectedAppRotateCredentialResultSchema = z.object({
  app: adminConnectedAppSchema,
  credential: adminConnectedAppCredentialSchema,
  detail: z.string().min(1),
  status: z.literal("rotated"),
})
export type AdminConnectedAppRotateCredentialResult = z.infer<
  typeof adminConnectedAppRotateCredentialResultSchema
>

export const adminPolicyTypeSchema = z.enum([
  "content_safety",
  "access_control",
  "data_governance",
])
export type AdminPolicyType = z.infer<typeof adminPolicyTypeSchema>

export const adminPolicyViolationActionSchema = z.enum([
  "audit",
  "warn",
  "block",
])
export type AdminPolicyViolationAction = z.infer<
  typeof adminPolicyViolationActionSchema
>

export const adminPolicyViolationRemediationStatusSchema = z.enum([
  "open",
  "acknowledged",
  "resolved",
])
export type AdminPolicyViolationRemediationStatus = z.infer<
  typeof adminPolicyViolationRemediationStatusSchema
>

export const adminPolicyViolationSchema = z.object({
  id: z.string().uuid(),
  policyId: z.string().uuid().nullable(),
  policyType: adminPolicyTypeSchema,
  severity: hubSeveritySchema,
  actionTaken: adminPolicyViolationActionSchema,
  remediationStatus: adminPolicyViolationRemediationStatusSchema,
  remediationActorId: z.string().min(1).nullable(),
  remediationAt: z.string().datetime().nullable(),
  remediationNote: z.string().min(1).nullable(),
  actorId: z.string().min(1).nullable(),
  targetType: z.string().min(1),
  targetId: z.string().min(1),
  message: z.string().min(1),
  metadata: z.array(adminAuditMetadataEntrySchema),
  auditHref: z.string().min(1),
  createdAt: z.string().datetime(),
})
export type AdminPolicyViolation = z.infer<typeof adminPolicyViolationSchema>

export const adminPolicyViolationsResponseSchema = z.object({
  generatedAt: z.string().datetime(),
  query: z.string().min(1).nullable(),
  sourceStatus: hubSourceStatusSchema,
  window: z.literal("24h"),
  totalCount: z.number().int().nonnegative(),
  criticalCount: z.number().int().nonnegative(),
  warningCount: z.number().int().nonnegative(),
  violations: z.array(adminPolicyViolationSchema),
})
export type AdminPolicyViolationsResponse = z.infer<
  typeof adminPolicyViolationsResponseSchema
>

export const adminPolicyViolationRemediationRequestSchema = z.object({
  status: z.enum(["acknowledged", "resolved"]),
  note: z.string().trim().min(3).max(500),
})
export type AdminPolicyViolationRemediationRequest = z.infer<
  typeof adminPolicyViolationRemediationRequestSchema
>

export const adminPureModeControlSchema = z.object({
  enabled: z.boolean(),
  reason: z.string().min(1),
})
export type AdminPureModeControl = z.infer<typeof adminPureModeControlSchema>

export const adminPureModeActionSchema = z.enum(["activate", "restore"])
export type AdminPureModeAction = z.infer<typeof adminPureModeActionSchema>

export const adminPureModeTransitionRequestSchema = z.object({
  action: adminPureModeActionSchema,
  confirmation: z.literal("PURE"),
  reason: z.string().trim().min(3).max(500),
})
export type AdminPureModeTransitionRequest = z.infer<
  typeof adminPureModeTransitionRequestSchema
>

export const adminPureModeResponseSchema = z.object({
  generatedAt: z.string().datetime(),
  sourceStatus: hubSourceStatusSchema,
  active: z.boolean(),
  reason: z.string().min(1).nullable(),
  activatedBy: z.string().min(1).nullable(),
  activatedAt: z.string().datetime().nullable(),
  deactivatedAt: z.string().datetime().nullable(),
  affectedComponents: z.array(z.string().min(1)),
  updatedAt: z.string().datetime().nullable(),
  control: adminPureModeControlSchema,
  recentEvents: z.array(adminAuditEventSchema),
})
export type AdminPureModeResponse = z.infer<typeof adminPureModeResponseSchema>

export const adminBuilderAgentStudioQuotaPolicySourceSchema = z.enum([
  "environment",
  "admin_override",
])
export type AdminBuilderAgentStudioQuotaPolicySource = z.infer<
  typeof adminBuilderAgentStudioQuotaPolicySourceSchema
>

export const adminBuilderAgentStudioQuotaPolicySchema = z.object({
  generatedAt: z.string().datetime(),
  sourceStatus: hubSourceStatusSchema,
  period: z.literal("daily"),
  timezone: z.literal("UTC"),
  source: adminBuilderAgentStudioQuotaPolicySourceSchema,
  enforced: z.boolean(),
  runLimit: z.number().int().min(0).nullable(),
  tokenLimit: z.number().int().min(0).nullable(),
  updatedAt: z.string().datetime().nullable(),
  updatedBy: z.string().min(1).nullable(),
})
export type AdminBuilderAgentStudioQuotaPolicy = z.infer<
  typeof adminBuilderAgentStudioQuotaPolicySchema
>

export const updateAdminBuilderAgentStudioQuotaPolicyRequestSchema = z.object({
  runLimit: z.number().int().min(0).nullable(),
  tokenLimit: z.number().int().min(0).nullable(),
  note: z.string().trim().min(3).max(500),
})
export type UpdateAdminBuilderAgentStudioQuotaPolicyRequest = z.infer<
  typeof updateAdminBuilderAgentStudioQuotaPolicyRequestSchema
>

export const adminHardwareRangeSchema = z.enum(["1h", "6h", "24h", "7d"])
export type AdminHardwareRange = z.infer<typeof adminHardwareRangeSchema>

export const adminHardwareChartIdSchema = z.enum([
  "cpu_utilization",
  "gpu_temperature",
  "gpu_utilization",
  "ram_usage",
  "filesystem_usage",
  "power_draw",
  "network_throughput",
])
export type AdminHardwareChartId = z.infer<typeof adminHardwareChartIdSchema>

export const adminHardwareChartTypeSchema = z.enum(["area", "line", "bar"])
export type AdminHardwareChartType = z.infer<
  typeof adminHardwareChartTypeSchema
>

export const adminHardwareUnitSchema = z.enum([
  "percent",
  "celsius",
  "bytes_per_second",
  "watt",
])
export type AdminHardwareUnit = z.infer<typeof adminHardwareUnitSchema>

export const adminHardwarePointSchema = z.object({
  timestamp: z.string().datetime(),
  value: z.number().finite().nullable(),
})
export type AdminHardwarePoint = z.infer<typeof adminHardwarePointSchema>

export const adminHardwareSeriesSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  host: z.string().min(1).nullable(),
  device: z.string().min(1).nullable(),
  direction: z.string().min(1).nullable(),
  metricSource: z.string().min(1).nullable(),
  points: z.array(adminHardwarePointSchema),
})
export type AdminHardwareSeries = z.infer<typeof adminHardwareSeriesSchema>

export const adminHardwareThresholdSchema = z.object({
  label: z.string().min(1),
  severity: hubSeveritySchema,
  value: z.number().finite(),
  unit: adminHardwareUnitSchema,
})
export type AdminHardwareThreshold = z.infer<
  typeof adminHardwareThresholdSchema
>

export const adminHardwareChartSchema = z.object({
  id: adminHardwareChartIdSchema,
  title: z.string().min(1),
  description: z.string().min(1),
  chartType: adminHardwareChartTypeSchema,
  unit: adminHardwareUnitSchema,
  promql: z.string().min(1),
  sourceStatus: hubSourceStatusSchema,
  emptyMessage: z.string().min(1),
  grafanaUrl: z.string().min(1).nullable(),
  thresholds: z.array(adminHardwareThresholdSchema),
  series: z.array(adminHardwareSeriesSchema),
})
export type AdminHardwareChart = z.infer<typeof adminHardwareChartSchema>

export const adminHardwareAlertSchema = z.object({
  id: z.string().min(1),
  alertName: z.string().min(1),
  severity: hubSeveritySchema,
  host: z.string().min(1).nullable(),
  device: z.string().min(1).nullable(),
  summary: z.string().min(1),
  description: z.string().min(1).nullable(),
  startedAt: z.string().datetime().nullable(),
  grafanaUrl: z.string().min(1).nullable(),
  alertmanagerUrl: z.string().min(1).nullable(),
  labels: z.record(z.string(), z.string()),
})
export type AdminHardwareAlert = z.infer<typeof adminHardwareAlertSchema>

export const adminHardwareResponseSchema = z.object({
  generatedAt: z.string().datetime(),
  range: adminHardwareRangeSchema,
  step: z.string().min(1),
  selectedHost: z.string().min(1),
  availableHosts: z.array(z.string().min(1)),
  sourceStatus: hubSourceStatusSchema,
  summary: z.string().min(1),
  grafanaUrl: z.string().min(1).nullable(),
  alertmanagerUrl: z.string().min(1).nullable(),
  charts: z.array(adminHardwareChartSchema).length(7),
  activeAlerts: z.array(adminHardwareAlertSchema),
})
export type AdminHardwareResponse = z.infer<typeof adminHardwareResponseSchema>

export const adminInferenceRangeSchema = z.enum(["7d", "30d", "90d"])
export type AdminInferenceRange = z.infer<typeof adminInferenceRangeSchema>

export const adminInferenceUnitSchema = z.enum(["requests", "tokens", "usd"])
export type AdminInferenceUnit = z.infer<typeof adminInferenceUnitSchema>

export const adminInferenceUsagePointSchema = z.object({
  requests: z.number().int().min(0),
  timestamp: z.string().datetime(),
  tokens: z.number().int().min(0),
})
export type AdminInferenceUsagePoint = z.infer<
  typeof adminInferenceUsagePointSchema
>

export const adminInferenceTotalsSchema = z.object({
  requests: z.number().int().min(0),
  tokens: z.number().int().min(0),
})
export type AdminInferenceTotals = z.infer<typeof adminInferenceTotalsSchema>

export const adminInferenceModelUsageSchema = z.object({
  lastUsedAt: z.string().datetime().nullable(),
  model: z.string().min(1),
  requests: z.number().int().min(0),
  spendUsd: z.number().finite().min(0).nullable(),
  tokens: z.number().int().min(0),
})
export type AdminInferenceModelUsage = z.infer<
  typeof adminInferenceModelUsageSchema
>

export const adminInferenceModelSchema = z.object({
  contextWindow: z.number().int().min(0).nullable(),
  id: z.string().min(1),
  mode: z.string().min(1).nullable(),
  name: z.string().min(1),
  outputCostPerMillionTokens: z.number().finite().min(0).nullable(),
  provider: z.string().min(1).nullable(),
  sourceStatus: hubSourceStatusSchema,
})
export type AdminInferenceModel = z.infer<typeof adminInferenceModelSchema>

export const adminInferenceVirtualKeyStatusSchema = z.enum([
  "active",
  "blocked",
  "expired",
  "unknown",
])
export type AdminInferenceVirtualKeyStatus = z.infer<
  typeof adminInferenceVirtualKeyStatusSchema
>

export const adminInferenceVirtualKeySchema = z.object({
  alias: z.string().min(1),
  budgetUsd: z.number().finite().min(0).nullable(),
  expiresAt: z.string().datetime().nullable(),
  id: z.string().min(1),
  lastUsedAt: z.string().datetime().nullable(),
  models: z.array(z.string().min(1)),
  owner: z.string().min(1).nullable(),
  spendUsd: z.number().finite().min(0).nullable(),
  status: adminInferenceVirtualKeyStatusSchema,
  team: z.string().min(1).nullable(),
})
export type AdminInferenceVirtualKey = z.infer<
  typeof adminInferenceVirtualKeySchema
>

export const adminInferenceModelUpdateStatusSchema = z.enum([
  "available",
  "running",
  "failed",
  "blocked",
])
export type AdminInferenceModelUpdateStatus = z.infer<
  typeof adminInferenceModelUpdateStatusSchema
>

export const adminInferenceModelUpdateSchema = z.object({
  affectedModels: z.array(z.string().min(1)),
  availableVersion: z.string().min(1),
  currentVersion: z.string().min(1),
  detail: z.string().min(1),
  estimatedDowntime: z.string().min(1).nullable(),
  releaseNotes: z.string().min(1).nullable(),
  status: adminInferenceModelUpdateStatusSchema,
  updateActionEnabled: z.boolean(),
})
export type AdminInferenceModelUpdate = z.infer<
  typeof adminInferenceModelUpdateSchema
>

export const adminInferenceDashboardSchema = z.object({
  generatedAt: z.string().datetime(),
  liteLlmUrl: z.string().min(1).nullable(),
  modelUpdate: adminInferenceModelUpdateSchema.nullable(),
  modelUsage: z.array(adminInferenceModelUsageSchema),
  models: z.array(adminInferenceModelSchema),
  range: adminInferenceRangeSchema,
  sourceStatus: hubSourceStatusSchema,
  summary: z.string().min(1),
  totals: adminInferenceTotalsSchema,
  usagePoints: z.array(adminInferenceUsagePointSchema),
  virtualKeys: z.array(adminInferenceVirtualKeySchema),
})
export type AdminInferenceDashboard = z.infer<
  typeof adminInferenceDashboardSchema
>

export const applyAdminInferenceModelUpdateRequestSchema = z.object({
  confirmation: z.literal("UPDATE MODEL"),
})
export type ApplyAdminInferenceModelUpdateRequest = z.infer<
  typeof applyAdminInferenceModelUpdateRequestSchema
>

export const adminInferenceModelUpdateActionResponseSchema = z.object({
  detail: z.string().min(1),
  generatedAt: z.string().datetime(),
  modelUpdate: adminInferenceModelUpdateSchema.nullable(),
  status: z.enum(["started", "completed", "failed", "blocked"]),
})
export type AdminInferenceModelUpdateActionResponse = z.infer<
  typeof adminInferenceModelUpdateActionResponseSchema
>

export const adminOverviewResponseSchema = z.object({
  generatedAt: z.string().datetime(),
  tiles: z.array(adminOverviewTileSchema).length(4),
  activityEvents: z.array(adminActivityEventSchema),
})
export type AdminOverviewResponse = z.infer<typeof adminOverviewResponseSchema>
