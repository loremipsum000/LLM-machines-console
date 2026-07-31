import { z } from "zod"
import { inferenceCoreHumanRoleSchema } from "./inference-core-authorization.js"

export * from "./inference-core-authorization.js"
export * from "./inference-core-recovery.js"

export const healthResponseSchema = z
  .object({
    service: z.string().min(1),
    status: z.enum(["ok", "degraded"]),
    version: z.string().min(1),
  })
  .strict()
export type HealthResponse = z.infer<typeof healthResponseSchema>

export const inferenceCoreSourceStatusSchema = z.enum([
  "ok",
  "degraded",
  "unavailable",
  "not_configured",
])
export type InferenceCoreSourceStatus = z.infer<
  typeof inferenceCoreSourceStatusSchema
>

export const inferenceCoreSeveritySchema = z.enum([
  "info",
  "warning",
  "critical",
])
export type InferenceCoreSeverity = z.infer<typeof inferenceCoreSeveritySchema>

export const adminOverviewTileIdSchema = z.enum([
  "applications",
  "inference",
  "hardware",
  "system",
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

export const adminOverviewMetricSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    value: z.string().min(1),
    detail: z.string().min(1).nullable(),
    tone: adminOverviewMetricToneSchema,
  })
  .strict()
export type AdminOverviewMetric = z.infer<typeof adminOverviewMetricSchema>

export const adminOverviewTileSchema = z
  .object({
    id: adminOverviewTileIdSchema,
    title: z.string().min(1),
    summary: z.string().min(1),
    href: z.string().min(1),
    sourceStatus: inferenceCoreSourceStatusSchema,
    metrics: z.array(adminOverviewMetricSchema).min(1),
    updatedAt: z.string().datetime(),
  })
  .strict()
export type AdminOverviewTile = z.infer<typeof adminOverviewTileSchema>

export const adminActivityEventSchema = z
  .object({
    id: z.string().min(1),
    actorId: z.string().min(1),
    action: z.string().min(1),
    targetType: z.string().min(1),
    targetId: z.string().min(1),
    severity: inferenceCoreSeveritySchema,
    href: z.string().min(1),
    createdAt: z.string().datetime(),
  })
  .strict()
export type AdminActivityEvent = z.infer<typeof adminActivityEventSchema>

export const adminAuditMetadataEntrySchema = z
  .object({
    label: z.string().min(1),
    value: z.string().min(1),
  })
  .strict()
export type AdminAuditMetadataEntry = z.infer<
  typeof adminAuditMetadataEntrySchema
>

export const adminAuditEventSchema = z
  .object({
    id: z.string().min(1),
    actorId: z.string().min(1),
    action: z.string().min(1),
    targetType: z.string().min(1),
    targetId: z.string().min(1),
    reason: z.string().min(1).nullable(),
    severity: inferenceCoreSeveritySchema,
    metadata: z.array(adminAuditMetadataEntrySchema),
    href: z.string().min(1),
    createdAt: z.string().datetime(),
  })
  .strict()
export type AdminAuditEvent = z.infer<typeof adminAuditEventSchema>

export const adminAuditSourceSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    sourceStatus: inferenceCoreSourceStatusSchema,
  })
  .strict()
export type AdminAuditSource = z.infer<typeof adminAuditSourceSchema>

export const adminAuditResponseSchema = z
  .object({
    generatedAt: z.string().datetime(),
    query: z.string().min(1).nullable(),
    selectedEventId: z.string().min(1).nullable(),
    sourceStatus: inferenceCoreSourceStatusSchema,
    sources: z.array(adminAuditSourceSchema).min(1),
    events: z.array(adminAuditEventSchema),
  })
  .strict()
export type AdminAuditResponse = z.infer<typeof adminAuditResponseSchema>

export const inferenceCoreExpertAuditSourceSchema = z.enum([
  "litellm",
  "grafana",
  "keycloak",
  "alertmanager",
])
export type InferenceCoreExpertAuditSource = z.infer<
  typeof inferenceCoreExpertAuditSourceSchema
>

export const inferenceCoreExpertAuditIngestionStateSchema = z.enum([
  "disabled",
  "unproven",
])
export type InferenceCoreExpertAuditIngestionState = z.infer<
  typeof inferenceCoreExpertAuditIngestionStateSchema
>

export const inferenceCoreExpertAuditCapabilitySchema = z
  .object({
    source: inferenceCoreExpertAuditSourceSchema,
    nativeIngestionState: inferenceCoreExpertAuditIngestionStateSchema,
    ingestionEnabled: z.literal(false),
    mechanism: z.null(),
    detail: z.string().min(1),
  })
  .strict()
export type InferenceCoreExpertAuditCapability = z.infer<
  typeof inferenceCoreExpertAuditCapabilitySchema
>

export const adminOverviewResponseSchema = z
  .object({
    generatedAt: z.string().datetime(),
    tiles: z.array(adminOverviewTileSchema).length(4),
    activityEvents: z.array(adminActivityEventSchema),
  })
  .strict()
export type AdminOverviewResponse = z.infer<typeof adminOverviewResponseSchema>

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

export const adminTeamMemberSchema = z
  .object({
    createdAt: z.string().datetime().nullable(),
    displayName: z.string().min(1),
    email: z.string().email(),
    enabled: z.boolean(),
    groups: z.array(z.string().min(1)),
    id: z.string().min(1),
    keycloakHref: z.string().min(1).nullable(),
    lastActiveAt: z.string().datetime().nullable(),
    role: inferenceCoreHumanRoleSchema,
    status: adminTeamMemberStatusSchema,
    username: z.string().min(1),
  })
  .strict()
export type AdminTeamMember = z.infer<typeof adminTeamMemberSchema>

export const adminTeamUsageSummarySchema = z
  .object({
    mostUsedModel: z.string().min(1).nullable(),
    prompts: z.number().int().min(0),
    sourceStatus: inferenceCoreSourceStatusSchema,
    tokens: z.number().int().min(0),
    window: z.string().min(1),
  })
  .strict()
export type AdminTeamUsageSummary = z.infer<typeof adminTeamUsageSummarySchema>

export const adminTeamActivityRowSchema = z
  .object({
    action: z.string().min(1),
    createdAt: z.string().datetime(),
    href: z.string().min(1),
    id: z.string().min(1),
    targetId: z.string().min(1),
    targetType: z.string().min(1),
  })
  .strict()
export type AdminTeamActivityRow = z.infer<typeof adminTeamActivityRowSchema>

export const adminTeamMemberDetailSchema = z
  .object({
    activity: z.array(adminTeamActivityRowSchema),
    member: adminTeamMemberSchema,
    usage: adminTeamUsageSummarySchema,
  })
  .strict()
export type AdminTeamMemberDetail = z.infer<typeof adminTeamMemberDetailSchema>

export const adminTeamGroupSchema = z
  .object({
    id: z.string().min(1),
    keycloakHref: z.string().min(1).nullable(),
    memberCount: z.number().int().min(0),
    name: z.string().min(1),
    virtual: z.boolean(),
  })
  .strict()
export type AdminTeamGroup = z.infer<typeof adminTeamGroupSchema>

export const adminTeamGroupDetailSchema = z
  .object({
    group: adminTeamGroupSchema,
    members: z.array(adminTeamMemberSchema),
  })
  .strict()
export type AdminTeamGroupDetail = z.infer<typeof adminTeamGroupDetailSchema>

export const adminTeamScimStatusSchema = z
  .object({
    detail: z.string().min(1),
    keycloakHref: z.string().min(1).nullable(),
    lastSyncAt: z.string().datetime().nullable(),
    provider: z.string().min(1).nullable(),
    sourceStatus: inferenceCoreSourceStatusSchema,
    status: z.enum(["configured", "not_configured", "unknown"]),
  })
  .strict()
export type AdminTeamScimStatus = z.infer<typeof adminTeamScimStatusSchema>

export const adminTeamOverviewResponseSchema = z
  .object({
    generatedAt: z.string().datetime(),
    groups: z.array(adminTeamGroupSchema),
    members: z.array(adminTeamMemberSchema),
    scim: adminTeamScimStatusSchema,
    serviceStatus: adminTeamServiceStatusSchema,
    sourceStatus: inferenceCoreSourceStatusSchema,
  })
  .strict()
export type AdminTeamOverviewResponse = z.infer<
  typeof adminTeamOverviewResponseSchema
>

export const createAdminTeamMemberRequestSchema = z
  .object({
    displayName: z.string().trim().min(1).max(160),
    email: z.string().trim().email(),
    enabled: z.boolean().default(true),
    generatePassword: z.boolean().default(true),
    groups: z.array(z.string().trim().min(1)).default([]),
    role: inferenceCoreHumanRoleSchema,
    sendInvite: z.boolean().default(false),
    username: z.string().trim().min(1).max(80).optional(),
  })
  .strict()
export type CreateAdminTeamMemberRequest = z.infer<
  typeof createAdminTeamMemberRequestSchema
>

export const adminTeamMemberMutationResponseSchema = z
  .object({
    generatedPassword: z.string().min(12).nullable(),
    member: adminTeamMemberSchema,
  })
  .strict()
export type AdminTeamMemberMutationResponse = z.infer<
  typeof adminTeamMemberMutationResponseSchema
>

export const adminTeamActionResponseSchema = z
  .object({
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
  .strict()
export type AdminTeamActionResponse = z.infer<
  typeof adminTeamActionResponseSchema
>

export const adminTeamGroupMutationResponseSchema = z
  .object({
    group: adminTeamGroupSchema.nullable(),
    status: z.enum(["created", "updated", "deleted", "assigned", "removed"]),
  })
  .strict()
export type AdminTeamGroupMutationResponse = z.infer<
  typeof adminTeamGroupMutationResponseSchema
>

export const updateAdminTeamMemberGroupsRequestSchema = z
  .object({
    groups: z.array(z.string().trim().min(1)).default([]),
  })
  .strict()
export type UpdateAdminTeamMemberGroupsRequest = z.infer<
  typeof updateAdminTeamMemberGroupsRequestSchema
>

export const sendAdminTeamEmailRequestSchema = z
  .object({
    email: z.string().trim().email(),
  })
  .strict()
export type SendAdminTeamEmailRequest = z.infer<
  typeof sendAdminTeamEmailRequestSchema
>

export const createAdminTeamGroupRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
  })
  .strict()
export type CreateAdminTeamGroupRequest = z.infer<
  typeof createAdminTeamGroupRequestSchema
>

export const updateAdminTeamGroupRequestSchema =
  createAdminTeamGroupRequestSchema
export type UpdateAdminTeamGroupRequest = z.infer<
  typeof updateAdminTeamGroupRequestSchema
>

export const adminTeamBatchLimit = 100
export const adminTeamCsvBodyLimitBytes = 256 * 1024
export const adminTeamCsvMaxBytes = 240 * 1024

export const adminTeamBulkGroupAssignmentRequestSchema = z
  .object({
    memberIds: z.array(z.string().min(1)).min(1).max(adminTeamBatchLimit),
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.memberIds).size !== value.memberIds.length) {
      context.addIssue({
        code: "custom",
        message: "Team group assignment cannot contain duplicate members.",
        path: ["memberIds"],
      })
    }
  })
export type AdminTeamBulkGroupAssignmentRequest = z.infer<
  typeof adminTeamBulkGroupAssignmentRequestSchema
>

export const deleteAdminTeamMemberRequestSchema = z
  .object({
    confirmation: z.literal("DELETE"),
  })
  .strict()
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

export const adminTeamCsvImportRowSchema = z
  .object({
    actions: z.array(z.enum(["create_user", "assign_group", "send_invite"])),
    errors: z.array(z.string().min(1)),
    line: z.number().int().min(2),
    name: z.string(),
    email: z.string(),
    enabled: z.boolean(),
    group: z.string(),
    role: inferenceCoreHumanRoleSchema,
    sendInvite: z.boolean(),
    status: adminTeamCsvImportRowStatusSchema,
    username: z.string(),
  })
  .strict()
export type AdminTeamCsvImportRow = z.infer<typeof adminTeamCsvImportRowSchema>

export const adminTeamCsvImportPreviewRequestSchema = z
  .object({
    csv: z
      .string()
      .min(1)
      .max(adminTeamCsvMaxBytes)
      .refine(
        (value) =>
          new TextEncoder().encode(value).byteLength <= adminTeamCsvMaxBytes,
        `CSV import must not exceed ${adminTeamCsvMaxBytes} UTF-8 bytes.`,
      ),
  })
  .strict()
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

export const adminTeamCsvImportPreviewResponseSchema = z
  .object({
    generatedAt: z.string().datetime(),
    rows: z.array(adminTeamCsvImportRowSchema),
    valid: z.boolean(),
  })
  .strict()
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

export const adminSettingsOrganizationSchema = z
  .object({
    defaultLanguage: adminSettingsLanguageSchema,
    fullLogo: adminSettingsLogoAssetSchema.nullable(),
    iconLogo: adminSettingsLogoAssetSchema.nullable(),
    organizationName: z.string().trim().min(1).max(120),
    updatedAt: z.string().datetime().nullable(),
    updatedBy: z.string().min(1).nullable(),
  })
  .strict()
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
  .strict()
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

export const adminSettingsServiceIdSchema = z.enum([
  "web",
  "bff",
  "postgres",
  "keycloak",
  "litellm",
  "grafana",
  "prometheus",
  "alertmanager",
  "firecrawl",
  "lifecycle",
])
export type AdminSettingsServiceId = z.infer<
  typeof adminSettingsServiceIdSchema
>

export const adminSettingsReachabilityServiceSchema = z
  .object({
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
    status: inferenceCoreSourceStatusSchema,
  })
  .strict()
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

export const adminSettingsLicenseStateSchema = z
  .object({
    allowedUpdateChannels: z.array(z.string().min(1)),
    applianceId: z.string().min(1).nullable(),
    certificateExpiresAt: z.string().datetime().nullable(),
    lastEntitlementCheckAt: z.string().datetime().nullable(),
    offlineMode: z.boolean(),
    sourceStatus: inferenceCoreSourceStatusSchema,
    subscriptionState: adminSettingsLicenseSubscriptionStateSchema,
    supportState: z.string().min(1),
    telemetryOptIn: z.boolean(),
  })
  .strict()
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

export const adminSettingsSystemUpdateSchema = z
  .object({
    affectedComponents: z.array(z.string().min(1)),
    availableVersion: z.string().min(1).nullable(),
    detail: z.string().min(1),
    expectedDowntime: z.string().min(1).nullable(),
    sourceStatus: inferenceCoreSourceStatusSchema,
    status: adminSettingsSystemUpdateStatusSchema,
    updateActionEnabled: z.boolean(),
  })
  .strict()
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

export const adminSettingsPrivacySchema = z
  .object({
    dataResidencyStatement: z.string().min(1),
    privacyPolicyHref: z.string().min(1),
    telemetryDescription: z.string().min(1),
    telemetryEnabled: z.boolean(),
    telemetryPayloadPreview: adminSettingsTelemetryPayloadPreviewSchema,
    updatedAt: z.string().datetime().nullable(),
    updatedBy: z.string().min(1).nullable(),
  })
  .strict()
export type AdminSettingsPrivacy = z.infer<typeof adminSettingsPrivacySchema>

export const updateAdminSettingsTelemetryRequestSchema = z
  .object({
    confirmation: z.string().trim().optional(),
    enabled: z.boolean(),
  })
  .strict()
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

export const adminSettingsResponseSchema = z
  .object({
    generatedAt: z.string().datetime(),
    license: adminSettingsLicenseStateSchema,
    organization: adminSettingsOrganizationSchema,
    privacy: adminSettingsPrivacySchema,
    reachability: z.array(adminSettingsReachabilityServiceSchema),
    sourceStatus: inferenceCoreSourceStatusSchema,
    systemUpdate: adminSettingsSystemUpdateSchema,
  })
  .strict()
export type AdminSettingsResponse = z.infer<typeof adminSettingsResponseSchema>

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

export const adminConnectedAppConnectionStatusSchema = z.enum([
  "not_connected",
  "connected",
  "degraded",
])
export type AdminConnectedAppConnectionStatus = z.infer<
  typeof adminConnectedAppConnectionStatusSchema
>

export const adminConnectedAppCredentialStatusSchema = z.enum([
  "active",
  "retiring",
  "revoked",
])
export type AdminConnectedAppCredentialStatus = z.infer<
  typeof adminConnectedAppCredentialStatusSchema
>

export const adminConnectedAppModelAliasSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)

export const adminConnectedAppAllowedModelsSchema = z
  .array(adminConnectedAppModelAliasSchema)
  .min(1)
  .superRefine((models, ctx) => {
    if (new Set(models).size !== models.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Application model aliases must be unique.",
      })
    }
  })

export const adminConnectedAppUsageSummarySchema = z
  .object({
    failures7d: z.number().int().min(0),
    lastUsedAt: z.string().datetime().nullable(),
    requests7d: z.number().int().min(0),
    tokens7d: z.number().int().min(0),
  })
  .strict()
export type AdminConnectedAppUsageSummary = z.infer<
  typeof adminConnectedAppUsageSummarySchema
>

export const adminConnectedAppCredentialMetadataSchema = z
  .object({
    authMethod: adminConnectedAppAuthMethodSchema,
    clientId: z.string().min(1).nullable(),
    id: z.string().min(1),
    issuedAt: z.string().datetime(),
    keyPrefix: z.string().min(1).nullable(),
    lastUsedAt: z.string().datetime().nullable(),
    overlapExpiresAt: z.string().datetime().nullable(),
    revokedAt: z.string().datetime().nullable(),
    rotatedAt: z.string().datetime().nullable(),
    status: adminConnectedAppCredentialStatusSchema,
  })
  .strict()
  .superRefine((credential, ctx) => {
    const isStatic = credential.authMethod === "api_key"
    if (
      isStatic &&
      (credential.clientId !== null || credential.keyPrefix === null)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Static credentials require a key prefix and no client id.",
      })
    }
    if (
      !isStatic &&
      (credential.clientId === null || credential.keyPrefix !== null)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "OAuth credentials require a client id and no key prefix.",
      })
    }
    if (
      credential.authMethod === "oauth_client_credentials" &&
      (credential.status === "retiring" || credential.overlapExpiresAt !== null)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "OAuth credentials cannot retire or overlap.",
      })
    }
    const activeStateIsValid =
      credential.status !== "active" ||
      (credential.revokedAt === null &&
        credential.overlapExpiresAt === null &&
        (!isStatic || credential.rotatedAt === null))
    const retiringStateIsValid =
      credential.status !== "retiring" ||
      (isStatic &&
        credential.rotatedAt !== null &&
        credential.overlapExpiresAt !== null &&
        credential.revokedAt === null)
    const revokedStateIsValid =
      credential.status !== "revoked" ||
      (credential.revokedAt !== null &&
        (!isStatic ||
          (credential.rotatedAt === null) ===
            (credential.overlapExpiresAt === null)))
    if (!activeStateIsValid || !retiringStateIsValid || !revokedStateIsValid) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Credential lifecycle timestamps do not match its state.",
      })
    }

    const issuedAt = Date.parse(credential.issuedAt)
    const lastUsedAt = credential.lastUsedAt
      ? Date.parse(credential.lastUsedAt)
      : null
    const rotatedAt = credential.rotatedAt
      ? Date.parse(credential.rotatedAt)
      : null
    const overlapExpiresAt = credential.overlapExpiresAt
      ? Date.parse(credential.overlapExpiresAt)
      : null
    const revokedAt = credential.revokedAt
      ? Date.parse(credential.revokedAt)
      : null
    if (
      (lastUsedAt !== null && lastUsedAt < issuedAt) ||
      (rotatedAt !== null && rotatedAt < issuedAt) ||
      (overlapExpiresAt !== null &&
        (rotatedAt === null || overlapExpiresAt <= rotatedAt)) ||
      (revokedAt !== null &&
        (revokedAt < issuedAt || (rotatedAt !== null && revokedAt < rotatedAt)))
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Credential timestamps are out of order.",
      })
    }
  })
export type AdminConnectedAppCredentialMetadata = z.infer<
  typeof adminConnectedAppCredentialMetadataSchema
>

const adminConnectedAppEndpointUrlSchema = z
  .string()
  .url()
  .refine((value) => {
    try {
      const endpoint = new URL(value)
      return (
        (endpoint.protocol === "http:" || endpoint.protocol === "https:") &&
        endpoint.username === "" &&
        endpoint.password === "" &&
        endpoint.search === "" &&
        endpoint.hash === "" &&
        !value.includes("?") &&
        !value.includes("#")
      )
    } catch {
      return false
    }
  }, "Application endpoint URLs must use HTTP or HTTPS without userinfo, query, or fragment.")

const adminConnectedAppCredentialRevealBaseSchema = z.object({
  bffBaseUrl: adminConnectedAppEndpointUrlSchema,
  credentialId: z.string().min(1),
  exampleCurl: z.string().min(1),
  issuedAt: z.string().datetime(),
  model: z.string().min(1).nullable(),
  openAiBaseUrl: adminConnectedAppEndpointUrlSchema,
})

export const adminConnectedAppCredentialSchema = z.discriminatedUnion(
  "authMethod",
  [
    adminConnectedAppCredentialRevealBaseSchema
      .extend({
        apiKey: z.string().min(1),
        authMethod: z.literal("api_key"),
        keyPrefix: z.string().min(1),
      })
      .strict(),
    adminConnectedAppCredentialRevealBaseSchema
      .extend({
        authMethod: z.literal("oauth_client_credentials"),
        clientId: z.string().min(1),
        clientSecret: z.string().min(1),
        keyPrefix: z.null(),
        tokenUrl: adminConnectedAppEndpointUrlSchema,
      })
      .strict(),
  ],
)
export type AdminConnectedAppCredential = z.infer<
  typeof adminConnectedAppCredentialSchema
>

export const adminConnectedAppSchema = z
  .object({
    allowedModels: adminConnectedAppAllowedModelsSchema,
    auditHref: z.string().min(1),
    authMethod: adminConnectedAppAuthMethodSchema,
    connectionStatus: adminConnectedAppConnectionStatusSchema,
    createdAt: z.string().datetime(),
    credentials: z.array(adminConnectedAppCredentialMetadataSchema).min(1),
    description: z.string().min(1),
    detailHref: z.string().min(1),
    id: z.string().min(1),
    lastConnectedAt: z.string().datetime().nullable(),
    name: z.string().min(1),
    rateLimitRpm: z.number().int().min(1).nullable(),
    status: adminConnectedAppStatusSchema,
    tokenBudget7d: z.number().int().min(1).nullable(),
    updatedAt: z.string().datetime(),
    usage: adminConnectedAppUsageSummarySchema,
  })
  .strict()
  .superRefine((application, ctx) => {
    if (
      application.credentials.some(
        (credential) => credential.authMethod !== application.authMethod,
      )
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Application credentials must use the immutable auth method.",
        path: ["credentials"],
      })
    }
    const credentialIds = application.credentials.map(
      (credential) => credential.id,
    )
    if (new Set(credentialIds).size !== credentialIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Application credential ids must be unique.",
        path: ["credentials"],
      })
    }
    const activeCredentialCount = application.credentials.filter(
      (credential) => credential.status === "active",
    ).length
    if (
      (application.status === "enabled" && activeCredentialCount !== 1) ||
      (application.status === "disabled" && activeCredentialCount > 1)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Enabled Applications require exactly one active credential; disabled Applications allow at most one.",
        path: ["credentials"],
      })
    }
  })
export type AdminConnectedApp = z.infer<typeof adminConnectedAppSchema>

export const adminConnectedAppsResponseSchema = z
  .object({
    apps: z.array(adminConnectedAppSchema),
    generatedAt: z.string().datetime(),
    sourceStatus: inferenceCoreSourceStatusSchema,
  })
  .strict()
export type AdminConnectedAppsResponse = z.infer<
  typeof adminConnectedAppsResponseSchema
>

export const adminConnectedAppDetailSchema = z
  .object({
    app: adminConnectedAppSchema,
  })
  .strict()
export type AdminConnectedAppDetail = z.infer<
  typeof adminConnectedAppDetailSchema
>

export const adminConnectedAppCreateRequestSchema = z
  .object({
    allowedModels: adminConnectedAppAllowedModelsSchema,
    authMethod: adminConnectedAppAuthMethodSchema.default("api_key"),
    description: z.string().trim().min(1).max(500),
    name: z.string().trim().min(1).max(80),
    rateLimitRpm: z.number().int().min(1).max(10_000).nullable().default(null),
    tokenBudget7d: z
      .number()
      .int()
      .min(1)
      .max(100_000_000)
      .nullable()
      .default(null),
  })
  .strict()
export type AdminConnectedAppCreateRequest = z.infer<
  typeof adminConnectedAppCreateRequestSchema
>

export const adminConnectedAppUpdateRequestSchema = z
  .object({
    allowedModels: adminConnectedAppAllowedModelsSchema,
    description: z.string().trim().min(1).max(500),
    name: z.string().trim().min(1).max(80),
    rateLimitRpm: z.number().int().min(1).max(10_000).nullable(),
    tokenBudget7d: z.number().int().min(1).max(100_000_000).nullable(),
  })
  .strict()
export type AdminConnectedAppUpdateRequest = z.infer<
  typeof adminConnectedAppUpdateRequestSchema
>

export const adminConnectedAppDeleteRequestSchema = z
  .object({
    confirmation: z.literal("DELETE APPLICATION"),
  })
  .strict()
export type AdminConnectedAppDeleteRequest = z.infer<
  typeof adminConnectedAppDeleteRequestSchema
>

export const adminConnectedAppCreateResponseSchema = z
  .object({
    app: adminConnectedAppSchema,
    credential: adminConnectedAppCredentialSchema,
    status: z.literal("created"),
  })
  .strict()
export type AdminConnectedAppCreateResponse = z.infer<
  typeof adminConnectedAppCreateResponseSchema
>

export const adminConnectedAppTestResultSchema = z
  .object({
    app: adminConnectedAppSchema,
    connectionStatus: adminConnectedAppConnectionStatusSchema,
    detail: z.string().min(1),
    observedAt: z.string().datetime().nullable(),
    status: z.enum(["passed", "waiting", "degraded"]),
  })
  .strict()
  .superRefine((result, ctx) => {
    const expectedConnectionStatus = {
      degraded: "degraded",
      passed: "connected",
      waiting: "not_connected",
    }[result.status]
    if (
      result.connectionStatus !== expectedConnectionStatus ||
      result.app.connectionStatus !== expectedConnectionStatus
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Connection evidence status must match the Application connection state.",
        path: ["connectionStatus"],
      })
    }
    if (
      result.observedAt !== result.app.lastConnectedAt ||
      (result.status === "passed" && result.observedAt === null) ||
      (result.status === "waiting" && result.observedAt !== null)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Connection evidence time must match the Application connection evidence.",
        path: ["observedAt"],
      })
    }
  })
export type AdminConnectedAppTestResult = z.infer<
  typeof adminConnectedAppTestResultSchema
>

export const adminConnectedAppLifecycleStatusSchema = z.enum([
  "disabled",
  "reenabled",
  "deleted",
])
export type AdminConnectedAppLifecycleStatus = z.infer<
  typeof adminConnectedAppLifecycleStatusSchema
>

export const adminConnectedAppLifecycleResultSchema = z
  .object({
    app: adminConnectedAppSchema.nullable(),
    applicationId: z.string().min(1),
    detail: z.string().min(1),
    status: adminConnectedAppLifecycleStatusSchema,
  })
  .strict()
  .superRefine((result, ctx) => {
    const appStatusMatches =
      (result.status === "deleted" && result.app === null) ||
      (result.status === "disabled" && result.app?.status === "disabled") ||
      (result.status === "reenabled" && result.app?.status === "enabled")
    if (!appStatusMatches) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Application lifecycle results must match the returned Application state.",
        path: ["app"],
      })
    }
  })
export type AdminConnectedAppLifecycleResult = z.infer<
  typeof adminConnectedAppLifecycleResultSchema
>

export const adminConnectedAppRotateCredentialResultSchema = z
  .object({
    app: adminConnectedAppSchema,
    credential: adminConnectedAppCredentialSchema,
    detail: z.string().min(1),
    status: z.literal("rotated"),
  })
  .strict()
export type AdminConnectedAppRotateCredentialResult = z.infer<
  typeof adminConnectedAppRotateCredentialResultSchema
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

export const adminHardwarePointSchema = z
  .object({
    timestamp: z.string().datetime(),
    value: z.number().finite().nullable(),
  })
  .strict()
export type AdminHardwarePoint = z.infer<typeof adminHardwarePointSchema>

export const adminHardwareSeriesSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    host: z.string().min(1).nullable(),
    device: z.string().min(1).nullable(),
    direction: z.string().min(1).nullable(),
    metricSource: z.string().min(1).nullable(),
    points: z.array(adminHardwarePointSchema),
  })
  .strict()
export type AdminHardwareSeries = z.infer<typeof adminHardwareSeriesSchema>

export const adminHardwareThresholdSchema = z
  .object({
    label: z.string().min(1),
    severity: inferenceCoreSeveritySchema,
    value: z.number().finite(),
    unit: adminHardwareUnitSchema,
  })
  .strict()
export type AdminHardwareThreshold = z.infer<
  typeof adminHardwareThresholdSchema
>

export const adminHardwareChartSchema = z
  .object({
    id: adminHardwareChartIdSchema,
    title: z.string().min(1),
    description: z.string().min(1),
    chartType: adminHardwareChartTypeSchema,
    unit: adminHardwareUnitSchema,
    promql: z.string().min(1),
    sourceStatus: inferenceCoreSourceStatusSchema,
    emptyMessage: z.string().min(1),
    grafanaUrl: z.string().min(1).nullable(),
    thresholds: z.array(adminHardwareThresholdSchema),
    series: z.array(adminHardwareSeriesSchema),
  })
  .strict()
export type AdminHardwareChart = z.infer<typeof adminHardwareChartSchema>

export const adminHardwareAlertSchema = z
  .object({
    id: z.string().min(1),
    alertName: z.string().min(1),
    severity: inferenceCoreSeveritySchema,
    host: z.string().min(1).nullable(),
    device: z.string().min(1).nullable(),
    summary: z.string().min(1),
    description: z.string().min(1).nullable(),
    startedAt: z.string().datetime().nullable(),
    grafanaUrl: z.string().min(1).nullable(),
    alertmanagerUrl: z.string().min(1).nullable(),
    labels: z.record(z.string(), z.string()),
  })
  .strict()
export type AdminHardwareAlert = z.infer<typeof adminHardwareAlertSchema>

export const adminHardwareResponseSchema = z
  .object({
    generatedAt: z.string().datetime(),
    range: adminHardwareRangeSchema,
    step: z.string().min(1),
    selectedHost: z.string().min(1),
    availableHosts: z.array(z.string().min(1)),
    sourceStatus: inferenceCoreSourceStatusSchema,
    summary: z.string().min(1),
    grafanaUrl: z.string().min(1).nullable(),
    alertmanagerUrl: z.string().min(1).nullable(),
    charts: z.array(adminHardwareChartSchema).length(7),
    activeAlerts: z.array(adminHardwareAlertSchema),
  })
  .strict()
export type AdminHardwareResponse = z.infer<typeof adminHardwareResponseSchema>

export const adminInferenceRangeSchema = z.enum(["7d", "30d", "90d"])
export type AdminInferenceRange = z.infer<typeof adminInferenceRangeSchema>

export const adminInferenceUnitSchema = z.enum(["requests", "tokens", "usd"])
export type AdminInferenceUnit = z.infer<typeof adminInferenceUnitSchema>

export const adminInferenceUsagePointSchema = z
  .object({
    requests: z.number().int().min(0),
    timestamp: z.string().datetime(),
    tokens: z.number().int().min(0),
  })
  .strict()
export type AdminInferenceUsagePoint = z.infer<
  typeof adminInferenceUsagePointSchema
>

export const adminInferenceTotalsSchema = z
  .object({
    requests: z.number().int().min(0),
    tokens: z.number().int().min(0),
  })
  .strict()
export type AdminInferenceTotals = z.infer<typeof adminInferenceTotalsSchema>

export const adminInferenceModelUsageSchema = z
  .object({
    lastUsedAt: z.string().datetime().nullable(),
    model: z.string().min(1),
    requests: z.number().int().min(0),
    spendUsd: z.number().finite().min(0).nullable(),
    tokens: z.number().int().min(0),
  })
  .strict()
export type AdminInferenceModelUsage = z.infer<
  typeof adminInferenceModelUsageSchema
>

export const adminInferenceModelSchema = z
  .object({
    contextWindow: z.number().int().min(0).nullable(),
    id: z.string().min(1),
    mode: z.string().min(1).nullable(),
    name: z.string().min(1),
    outputCostPerMillionTokens: z.number().finite().min(0).nullable(),
    provider: z.string().min(1).nullable(),
    sourceStatus: inferenceCoreSourceStatusSchema,
  })
  .strict()
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

export const adminInferenceVirtualKeySchema = z
  .object({
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
  .strict()
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

export const adminInferenceModelUpdateSchema = z
  .object({
    affectedModels: z.array(z.string().min(1)),
    availableVersion: z.string().min(1),
    currentVersion: z.string().min(1),
    detail: z.string().min(1),
    estimatedDowntime: z.string().min(1).nullable(),
    releaseNotes: z.string().min(1).nullable(),
    status: adminInferenceModelUpdateStatusSchema,
    updateActionEnabled: z.boolean(),
  })
  .strict()
export type AdminInferenceModelUpdate = z.infer<
  typeof adminInferenceModelUpdateSchema
>

export const adminInferenceDashboardSchema = z
  .object({
    generatedAt: z.string().datetime(),
    liteLlmUrl: z.string().min(1).nullable(),
    modelUpdate: adminInferenceModelUpdateSchema.nullable(),
    modelUsage: z.array(adminInferenceModelUsageSchema),
    models: z.array(adminInferenceModelSchema),
    range: adminInferenceRangeSchema,
    sourceStatus: inferenceCoreSourceStatusSchema,
    summary: z.string().min(1),
    totals: adminInferenceTotalsSchema,
    usagePoints: z.array(adminInferenceUsagePointSchema),
    virtualKeys: z.array(adminInferenceVirtualKeySchema),
  })
  .strict()
export type AdminInferenceDashboard = z.infer<
  typeof adminInferenceDashboardSchema
>

export const applyAdminInferenceModelUpdateRequestSchema = z
  .object({
    confirmation: z.literal("UPDATE MODEL"),
  })
  .strict()
export type ApplyAdminInferenceModelUpdateRequest = z.infer<
  typeof applyAdminInferenceModelUpdateRequestSchema
>

export const adminInferenceModelUpdateActionResponseSchema = z
  .object({
    detail: z.string().min(1),
    generatedAt: z.string().datetime(),
    modelUpdate: adminInferenceModelUpdateSchema.nullable(),
    status: z.enum(["started", "completed", "failed", "blocked"]),
  })
  .strict()
export type AdminInferenceModelUpdateActionResponse = z.infer<
  typeof adminInferenceModelUpdateActionResponseSchema
>
