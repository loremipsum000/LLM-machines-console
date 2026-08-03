import { z } from "zod"

export const inferenceCoreStorageDatasetNames = [
  "product_state",
  "databases",
  "models",
  "logs",
  "staging",
] as const

export const inferenceCoreStorageDatasetNameSchema = z.enum(
  inferenceCoreStorageDatasetNames,
)
export type InferenceCoreStorageDatasetName = z.infer<
  typeof inferenceCoreStorageDatasetNameSchema
>

export const inferenceCoreBackupAllowlist = [
  "product-configuration",
  "identity-mappings",
  "credential-verifier-state-and-safe-metadata",
  "keycloak-configuration-export",
  "litellm-configuration-export",
  "grafana-configuration-export",
  "audit-records",
  "entitlement-state",
  "update-state",
] as const

export const inferenceCoreBackupExclusions = [
  "models-pending-model-recovery-decision",
  "logs",
  "staging",
  "caches",
  "temporary-files",
  "crash-artifacts",
  "one-time-plaintext-credentials",
  "all-private-signing-keys",
  "audit-recovery-envelope",
] as const

export const inferenceCoreZeroContentCanarySurfaces = [
  "restic-input-manifest",
  "cache",
  "temporary-files",
  "staging",
  "backup-logs",
  "restored-tree",
] as const

const datasetSchema = <
  const Name extends InferenceCoreStorageDatasetName,
  const Dataset extends string,
  const Mountpoint extends string,
  const Purpose extends string,
  const BackupDisposition extends string,
>(
  name: Name,
  dataset: Dataset,
  mountpoint: Mountpoint,
  purpose: Purpose,
  backupDisposition: BackupDisposition,
) =>
  z
    .object({
      backupDisposition: z.literal(backupDisposition),
      dataset: z.literal(dataset),
      mountpoint: z.literal(mountpoint),
      name: z.literal(name),
      purpose: z.literal(purpose),
      workloadContentAllowed: z.literal(false),
    })
    .strict()

export const inferenceCoreStorageDatasetsSchema = z.tuple([
  datasetSchema(
    "product_state",
    "llm-machines/product_state",
    "/srv/llm-machines/product_state",
    "product-safe-state",
    "allowlisted-subset",
  ),
  datasetSchema(
    "databases",
    "llm-machines/databases",
    "/srv/llm-machines/databases",
    "product-databases-without-workload-content",
    "allowlisted-subset",
  ),
  datasetSchema(
    "models",
    "llm-machines/models",
    "/srv/llm-machines/models",
    "model-artifacts",
    "exclude-pending-model-recovery-decision",
  ),
  datasetSchema(
    "logs",
    "llm-machines/logs",
    "/srv/llm-machines/logs",
    "operational-metadata-only",
    "exclude",
  ),
  datasetSchema(
    "staging",
    "llm-machines/staging",
    "/srv/llm-machines/staging",
    "ephemeral-release-material-only",
    "exclude",
  ),
])

const backupAllowlistSchema = z.tuple([
  z.literal("product-configuration"),
  z.literal("identity-mappings"),
  z.literal("credential-verifier-state-and-safe-metadata"),
  z.literal("keycloak-configuration-export"),
  z.literal("litellm-configuration-export"),
  z.literal("grafana-configuration-export"),
  z.literal("audit-records"),
  z.literal("entitlement-state"),
  z.literal("update-state"),
])

const backupExclusionsSchema = z.tuple([
  z.literal("models-pending-model-recovery-decision"),
  z.literal("logs"),
  z.literal("staging"),
  z.literal("caches"),
  z.literal("temporary-files"),
  z.literal("crash-artifacts"),
  z.literal("one-time-plaintext-credentials"),
  z.literal("all-private-signing-keys"),
  z.literal("audit-recovery-envelope"),
])

const canarySurfacesSchema = z.tuple([
  z.literal("restic-input-manifest"),
  z.literal("cache"),
  z.literal("temporary-files"),
  z.literal("staging"),
  z.literal("backup-logs"),
  z.literal("restored-tree"),
])

export const inferenceCoreStorageSourceContractSchema = z
  .object({
    apiVersion: z.literal("inference-core.llm-machines/v1"),
    backup: z
      .object({
        cleanRestoreQualification: z
          .object({
            evidence: z.literal("metadata-only"),
            releaseGate: z.literal(true),
            required: z.literal(true),
            restoreTarget: z.literal("clean-appliance-environment"),
          })
          .strict(),
        engine: z.literal("restic"),
        excludedDatasets: z.tuple([
          z.literal("models"),
          z.literal("logs"),
          z.literal("staging"),
        ]),
        includedDatasets: z.tuple([
          z.literal("product_state"),
          z.literal("databases"),
        ]),
        inputAllowlist: backupAllowlistSchema,
        inputExclusions: backupExclusionsSchema,
        localSnapshotsCountAsBackup: z.literal(false),
        repository: z
          .object({
            credentialValuesIncluded: z.literal(false),
            encryptedAtRest: z.literal(true),
            encryptionMode: z.literal("restic-repository-encryption"),
            environmentVariablesAllowed: z.literal(false),
            inlineValuesAllowed: z.literal(false),
            locatorProvisioning: z.literal("root-only-mounted-file"),
            passwordProvisioning: z.literal("root-only-mounted-file"),
            targetKind: z.literal("separate-customer-owned-mounted-filesystem"),
            versioning: z.literal("restic-snapshots"),
          })
          .strict(),
        retention: z
          .object({
            cadence: z.literal("daily"),
            policyState: z.literal("accepted-default"),
            retentionDays: z.literal(30),
          })
          .strict(),
      })
      .strict(),
    kind: z.literal("SourceOnlyStorageAndBackupContract"),
    localStorage: z
      .object({
        backend: z.literal("zfs"),
        datasets: inferenceCoreStorageDatasetsSchema,
        localSnapshots: z
          .object({
            allowed: z.literal(true),
            countsAsBackup: z.literal(false),
          })
          .strict(),
        productRequirement: z.literal("required"),
      })
      .strict(),
    metadata: z
      .object({
        changePackage: z.literal("PR-11A-R1-D1"),
        containsCredentials: z.literal(false),
        runtimeQualificationStatus: z.literal("NOT_EVALUATED_RUNTIME"),
        sourceOnly: z.literal(true),
      })
      .strict(),
    objectStore: z
      .object({
        currentRetainedCallers: z.tuple([]),
        futureCompatibility: z
          .object({
            activationGate: z.literal("proven-retained-component-caller"),
            interface: z.literal("s3-compatible"),
            seaweedFsDisposition: z.literal(
              "first-benchmark-candidate-after-gate",
            ),
          })
          .strict(),
        genericS3ServiceInBom: z.literal(false),
        minioInBom: z.literal(false),
        seaweedFsInBom: z.literal(false),
        unusedAdapterAllowed: z.literal(false),
      })
      .strict(),
    recovery: z
      .object({
        recoveryMaterialCustody: z.literal("customer-held"),
        restoreEvidence: z.literal("metadata-only"),
        workloadContentInEvidence: z.literal(false),
      })
      .strict(),
    zeroContentRetention: z
      .object({
        activeStorage: z.literal("forbidden"),
        backups: z.literal("forbidden"),
        caches: z.literal("forbidden"),
        canarySurfaces: canarySurfacesSchema,
        logs: z.literal("forbidden"),
        metrics: z.literal("forbidden"),
      })
      .strict(),
  })
  .strict()

export type InferenceCoreStorageSourceContract = z.infer<
  typeof inferenceCoreStorageSourceContractSchema
>
