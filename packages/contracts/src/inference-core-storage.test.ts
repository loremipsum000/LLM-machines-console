import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import {
  inferenceCoreBackupAllowlist,
  inferenceCoreBackupExclusions,
  inferenceCoreStorageDatasetNames,
  inferenceCoreStorageSourceContractSchema,
  inferenceCoreZeroContentCanarySurfaces,
} from "./inference-core-storage"

const validContract = JSON.parse(
  readFileSync(
    path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../../infra/storage/profile.json",
    ),
    "utf8",
  ),
)

describe("Inference Core storage and backup contract", () => {
  it("accepts only the five ordered and distinct ZFS datasets", () => {
    const parsed = inferenceCoreStorageSourceContractSchema.parse(validContract)

    expect(parsed.localStorage.backend).toBe("zfs")
    expect(parsed.localStorage.datasets.map(({ name }) => name)).toEqual(
      inferenceCoreStorageDatasetNames,
    )
    expect(
      new Set(parsed.localStorage.datasets.map(({ dataset }) => dataset)).size,
    ).toBe(5)
    expect(
      new Set(parsed.localStorage.datasets.map(({ mountpoint }) => mountpoint))
        .size,
    ).toBe(5)
  })

  it("locks restic to file-mounted custody and the separate target", () => {
    const parsed = inferenceCoreStorageSourceContractSchema.parse(validContract)

    expect(parsed.backup.repository).toMatchObject({
      credentialValuesIncluded: false,
      encryptedAtRest: true,
      environmentVariablesAllowed: false,
      inlineValuesAllowed: false,
      locatorProvisioning: "root-only-mounted-file",
      passwordProvisioning: "root-only-mounted-file",
      targetKind: "separate-customer-owned-mounted-filesystem",
      versioning: "restic-snapshots",
    })
    expect(parsed.backup.retention).toEqual({
      cadence: "daily",
      policyState: "accepted-default",
      retentionDays: 30,
    })
  })

  it("binds the exact allowlist, exclusions, and clean restore gate", () => {
    const parsed = inferenceCoreStorageSourceContractSchema.parse(validContract)

    expect(parsed.backup.inputAllowlist).toEqual(inferenceCoreBackupAllowlist)
    expect(parsed.backup.inputExclusions).toEqual(inferenceCoreBackupExclusions)
    expect(parsed.backup.cleanRestoreQualification).toEqual({
      evidence: "metadata-only",
      releaseGate: true,
      required: true,
      restoreTarget: "clean-appliance-environment",
    })
    expect(parsed.recovery.recoveryMaterialCustody).toBe("customer-held")
  })

  it("binds every zero-content canary surface", () => {
    const parsed = inferenceCoreStorageSourceContractSchema.parse(validContract)

    expect(parsed.zeroContentRetention.canarySurfaces).toEqual(
      inferenceCoreZeroContentCanarySurfaces,
    )
    expect(parsed.zeroContentRetention).toMatchObject({
      activeStorage: "forbidden",
      backups: "forbidden",
      caches: "forbidden",
      logs: "forbidden",
      metrics: "forbidden",
    })
  })

  it("keeps object storage and unused adapters absent", () => {
    const parsed = inferenceCoreStorageSourceContractSchema.parse(validContract)

    expect(parsed.objectStore).toMatchObject({
      currentRetainedCallers: [],
      genericS3ServiceInBom: false,
      minioInBom: false,
      seaweedFsInBom: false,
      unusedAdapterAllowed: false,
    })
  })

  it("rejects runtime claims, inline secrets, and unreviewed fields", () => {
    expect(
      inferenceCoreStorageSourceContractSchema.safeParse({
        ...validContract,
        metadata: {
          ...validContract.metadata,
          runtimeQualificationStatus: "QUALIFIED",
        },
      }).success,
    ).toBe(false)
    expect(
      inferenceCoreStorageSourceContractSchema.safeParse({
        ...validContract,
        backup: {
          ...validContract.backup,
          repository: {
            ...validContract.backup.repository,
            repositoryPassword: "forbidden",
          },
        },
      }).success,
    ).toBe(false)
  })
})
