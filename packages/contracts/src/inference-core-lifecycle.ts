import { z } from "zod"

export const lifecycleComponents = [
  "console_database",
  "keycloak",
  "litellm",
  "grafana",
] as const

export const lifecycleComponentSchema = z.enum(lifecycleComponents)
export type LifecycleComponent = z.infer<typeof lifecycleComponentSchema>

export const lifecycleOperationKinds = ["snapshot", "restore"] as const

export const lifecycleOperationKindSchema = z.enum(lifecycleOperationKinds)
export type LifecycleOperationKind = z.infer<
  typeof lifecycleOperationKindSchema
>

export const lifecycleOperationStates = [
  "prepared",
  "quiescing",
  "capturing",
  "validating",
  "restoring",
  "verifying",
  "resuming",
  "rolling_back",
  "succeeded",
  "rolled_back",
  "failed",
  "recovery_required",
] as const

export const lifecycleOperationStateSchema = z.enum(lifecycleOperationStates)
export type LifecycleOperationState = z.infer<
  typeof lifecycleOperationStateSchema
>

export const lifecycleFailureCodes = [
  "adapter_unavailable",
  "quiesce_failed",
  "capture_failed",
  "manifest_invalid",
  "consistency_mismatch",
  "restore_failed",
  "verification_failed",
  "rollback_failed",
  "resume_failed",
  "journal_failed",
] as const

export const lifecycleFailureCodeSchema = z.enum(lifecycleFailureCodes)
export type LifecycleFailureCode = z.infer<typeof lifecycleFailureCodeSchema>

const lifecycleSnapshotRevisionSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/)

const lifecycleSnapshotSha256Schema = z.string().regex(/^[a-f0-9]{64}$/)

const consoleDatabaseSnapshotEntrySchema = z
  .object({
    artifactSha256: lifecycleSnapshotSha256Schema,
    component: z.literal("console_database"),
    ordinal: z.literal(0),
    revision: lifecycleSnapshotRevisionSchema,
  })
  .strict()

const keycloakSnapshotEntrySchema = z
  .object({
    artifactSha256: lifecycleSnapshotSha256Schema,
    component: z.literal("keycloak"),
    ordinal: z.literal(1),
    revision: lifecycleSnapshotRevisionSchema,
  })
  .strict()

const liteLlmSnapshotEntrySchema = z
  .object({
    artifactSha256: lifecycleSnapshotSha256Schema,
    component: z.literal("litellm"),
    ordinal: z.literal(2),
    revision: lifecycleSnapshotRevisionSchema,
  })
  .strict()

const grafanaSnapshotEntrySchema = z
  .object({
    artifactSha256: lifecycleSnapshotSha256Schema,
    component: z.literal("grafana"),
    ordinal: z.literal(3),
    revision: lifecycleSnapshotRevisionSchema,
  })
  .strict()

export const lifecycleSnapshotComponentSchema = z.discriminatedUnion(
  "component",
  [
    consoleDatabaseSnapshotEntrySchema,
    keycloakSnapshotEntrySchema,
    liteLlmSnapshotEntrySchema,
    grafanaSnapshotEntrySchema,
  ],
)
export type LifecycleSnapshotComponent = z.infer<
  typeof lifecycleSnapshotComponentSchema
>

export const lifecycleSnapshotComponentsSchema = z.tuple([
  consoleDatabaseSnapshotEntrySchema,
  keycloakSnapshotEntrySchema,
  liteLlmSnapshotEntrySchema,
  grafanaSnapshotEntrySchema,
])
export type LifecycleSnapshotComponents = z.infer<
  typeof lifecycleSnapshotComponentsSchema
>

export const lifecycleSnapshotManifestAuthoritySchema = z
  .object({
    capturedAt: z.string().datetime({ offset: true }),
    components: lifecycleSnapshotComponentsSchema,
    contentFree: z.literal(true),
    emergencySessionsIncluded: z.literal(false),
    operationId: z.string().uuid(),
    plaintextSecretsIncluded: z.literal(false),
    schemaVersion: z.literal(1),
    snapshotId: z.string().uuid(),
    workloadContentIncluded: z.literal(false),
  })
  .strict()
export type LifecycleSnapshotManifestAuthority = z.infer<
  typeof lifecycleSnapshotManifestAuthoritySchema
>

export const lifecycleSnapshotManifestSchema =
  lifecycleSnapshotManifestAuthoritySchema
    .extend({
      manifestSha256: lifecycleSnapshotSha256Schema,
    })
    .strict()
export type LifecycleSnapshotManifest = z.infer<
  typeof lifecycleSnapshotManifestSchema
>
