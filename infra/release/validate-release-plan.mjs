import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const directory = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(directory, "../..")
export const expectedReleaseEvidencePolicy = {
  schema: "llm-machines.release-evidence-policy.v1",
  status: "SOURCE_POLICY",
  containsCredentials: false,
  runtimeQualified: false,
  sbom: {
    format: "CycloneDX",
    specVersion: "1.6",
    componentType: "container",
    minimumInventoryComponents: 1,
    toolMetadataRequired: true,
    dependencyGraphRequired: true,
  },
  provenance: {
    predicateType: "https://slsa.dev/provenance/v1",
    approvedBuildActorIds: [
      "https://llm-machines.invalid/build-actors/offline-release/v1",
    ],
    buildTypes: {
      "third-party-mirror":
        "https://llm-machines.invalid/build-types/oci-mirror/v1",
      "product-build-output":
        "https://llm-machines.invalid/build-types/product-container/v1",
      "firecrawl-build-output":
        "https://llm-machines.invalid/build-types/firecrawl-reduced-container/v1",
    },
    orderedTimestampsRequired: true,
    resolvedSourceAndRecipeRequired: true,
  },
  vulnerability: {
    reportSchema: "llm-machines.vulnerability-report.v1",
    dispositionSchema: "llm-machines.vulnerability-disposition.v1",
    scanner: "trivy",
    maximumDatabaseAgeHours: 72,
    severityThresholds: { critical: 0, high: 0 },
    maximumExceptionAgeDays: 30,
    allCoreImagesRequired: true,
  },
  license: {
    reviewSchema: "llm-machines.license-review.v1",
    reviewStatus: "REVIEWED",
    licenseTextRequired: true,
    noticeRequired: true,
    exactComponentAndSourceRevisionRequired: true,
  },
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"))
}

export function validateReleasePlan(plan, root = repositoryRoot) {
  const errors = []
  if (plan?.schema !== "llm-machines.release-plan.v1") {
    errors.push("release plan schema is not v1")
  }
  if (plan?.status !== "SOURCE_PLAN" || plan?.runtimeQualified !== false) {
    errors.push("release plan must remain source-only and unqualified")
  }
  if (plan?.containsCredentials !== false) {
    errors.push("release plan must be credential-free")
  }
  if (
    JSON.stringify(plan?.core) !==
    JSON.stringify({
      profile: "core-v1-linux-amd64",
      platform: "linux/amd64",
      vcpus: 8,
      memoryGiB: 32,
      localDiskGiB: 100,
      backupRepository: "separate-customer-owned-target",
      bulkModelWeights: "excluded",
      imageInventory: "infra/release/core-image-inventory.json",
      imageLockSchema: "infra/release/core-image-lock.schema.json",
    })
  ) {
    errors.push("release plan changed the fixed Core boundary")
  }
  if (
    plan?.inference?.bundledWithCore !== false ||
    plan?.inference?.engine !== "sglang" ||
    plan?.inference?.engineVersion !== "0.5.13" ||
    plan?.inference?.exactProfileRequiredForActivation !== true ||
    plan?.inference?.hardwareAcceptanceOwnedByQ0AndDelivery !== true
  ) {
    errors.push("release plan changed the variable inference boundary")
  }
  if (
    plan?.evidenceFormats?.sbom?.format !== "CycloneDX" ||
    plan?.evidenceFormats?.sbom?.specVersion !== "1.6" ||
    plan?.evidenceFormats?.provenance?.predicateType !==
      "https://slsa.dev/provenance/v1"
  ) {
    errors.push("release evidence formats differ from the PR-12 contract")
  }
  if (
    plan?.evidencePolicy !== "infra/release/release-evidence-policy.json" ||
    JSON.stringify(
      readJson(resolve(root, "infra/release/release-evidence-policy.json")),
    ) !== JSON.stringify(expectedReleaseEvidencePolicy)
  ) {
    errors.push("release evidence policy differs from the reviewed contract")
  }
  if (
    plan?.archive?.format !== "tar" ||
    plan?.archive?.compression !== "zstd" ||
    plan?.archive?.zstdVersion !== "1.5.7" ||
    JSON.stringify(plan?.archive?.zstdArguments) !==
      JSON.stringify(["-19", "--threads=1", "--no-progress", "--no-check"]) ||
    plan?.archive?.mtimeSource !== "SOURCE_DATE_EPOCH" ||
    plan?.archive?.allowSymlinks !== false ||
    plan?.archive?.allowDeviceFiles !== false ||
    plan?.archive?.allowHardlinks !== false ||
    plan?.archive?.allowExtendedAttributes !== false
  ) {
    errors.push("release archive is not deterministic and regular-file-only")
  }
  if (
    plan?.signing?.purpose !== "release-artifact" ||
    plan?.signing?.algorithm !== "Ed25519" ||
    plan?.signing?.custody !== "offline-hardware-backed" ||
    plan?.signing?.privateMaterialInPackage !== false ||
    plan?.signing?.privateMaterialInGit !== false ||
    plan?.signing?.privateMaterialInCiEnvironment !== false ||
    plan?.signing?.ceremony !== "external-offline"
  ) {
    errors.push("release signing custody differs from the approved boundary")
  }
  const expectedRequiredEvidence = [
    "core-image-lock",
    "product-bom",
    "image-sboms",
    "image-provenance",
    "third-party-notices",
    "license-texts",
    "license-disposition",
    "license-reviews",
    "firecrawl-corresponding-source",
    "grafana-corresponding-source",
    "image-vulnerability-evidence",
    "clean-database-seed",
    "clean-keycloak-seed",
    "installer",
    "rollback",
    "public-release-trust",
    "secret-scan",
    "forbidden-surface-scan",
    "reproducibility-comparison",
  ]
  const requiredEvidence = new Set(plan?.requiredEvidence ?? [])
  for (const evidence of expectedRequiredEvidence) {
    if (!requiredEvidence.has(evidence))
      errors.push(`release plan omits required evidence: ${evidence}`)
  }
  if (
    JSON.stringify(plan?.requiredEvidence) !==
    JSON.stringify(expectedRequiredEvidence)
  ) {
    errors.push("release plan evidence set or order differs")
  }
  if (
    JSON.stringify(plan?.qualification) !==
    JSON.stringify({
      manifestStatus: "PACKAGED_UNQUALIFIED",
      q0: "NOT_STARTED",
      contractActivation: "INACTIVE",
      grafanaCustomerAccess: "DEFERRED_V1",
      nativeLiteLlmAccess: "ABSENT",
      nativeKeycloakAdminAccess: "ABSENT",
    })
  ) {
    errors.push("release plan overstates qualification or native access")
  }

  for (const path of [
    plan?.core?.imageInventory,
    plan?.core?.imageLockSchema,
    plan?.inference?.profileSchema,
    plan?.inference?.artifactLockSchema,
    plan?.evidencePolicy,
    "infra/release/release-manifest.schema.json",
  ]) {
    try {
      readFileSync(resolve(root, path))
    } catch {
      errors.push(`release plan references a missing contract: ${path}`)
    }
  }
  const serialized = JSON.stringify(plan)
  if (/(?:intel[-_ ]arc[-_ ]b50|sglang-xpu|\blatest\b)/i.test(serialized)) {
    errors.push("release plan contains a mutable or demo identity")
  }
  return errors
}

export function verifyCheckedInReleasePlan(root = repositoryRoot) {
  return validateReleasePlan(
    readJson(resolve(root, "infra/release/release-plan.json")),
    root,
  )
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const errors = verifyCheckedInReleasePlan()
  if (errors.length > 0) {
    for (const error of errors) {
      console.error(error)
    }
    process.exitCode = 1
  } else {
    console.log("Deterministic release source plan passed")
  }
}
