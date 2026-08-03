#!/usr/bin/env node

import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.dirname(fileURLToPath(import.meta.url))

const expectedFiles = [
  "README.md",
  "profile.json",
  "profile.schema.json",
  "validate-profile.mjs",
  "validate-profile.test.mjs",
]

export const expectedDatasetNames = [
  "product_state",
  "databases",
  "models",
  "logs",
  "staging",
]

const expectedDatasets = [
  {
    backupDisposition: "allowlisted-subset",
    dataset: "llm-machines/product_state",
    mountpoint: "/srv/llm-machines/product_state",
    name: "product_state",
    purpose: "product-safe-state",
    workloadContentAllowed: false,
  },
  {
    backupDisposition: "allowlisted-subset",
    dataset: "llm-machines/databases",
    mountpoint: "/srv/llm-machines/databases",
    name: "databases",
    purpose: "product-databases-without-workload-content",
    workloadContentAllowed: false,
  },
  {
    backupDisposition: "exclude-pending-model-recovery-decision",
    dataset: "llm-machines/models",
    mountpoint: "/srv/llm-machines/models",
    name: "models",
    purpose: "model-artifacts",
    workloadContentAllowed: false,
  },
  {
    backupDisposition: "exclude",
    dataset: "llm-machines/logs",
    mountpoint: "/srv/llm-machines/logs",
    name: "logs",
    purpose: "operational-metadata-only",
    workloadContentAllowed: false,
  },
  {
    backupDisposition: "exclude",
    dataset: "llm-machines/staging",
    mountpoint: "/srv/llm-machines/staging",
    name: "staging",
    purpose: "ephemeral-release-material-only",
    workloadContentAllowed: false,
  },
]

export const expectedBackupAllowlist = [
  "product-configuration",
  "identity-mappings",
  "credential-verifier-state-and-safe-metadata",
  "keycloak-configuration-export",
  "litellm-configuration-export",
  "grafana-configuration-export",
  "audit-records",
  "entitlement-state",
  "update-state",
]

export const expectedBackupExclusions = [
  "models-pending-model-recovery-decision",
  "logs",
  "staging",
  "caches",
  "temporary-files",
  "crash-artifacts",
  "one-time-plaintext-credentials",
  "all-private-signing-keys",
  "audit-recovery-envelope",
]

export const zeroContentCanarySurfaces = [
  "restic-input-manifest",
  "cache",
  "temporary-files",
  "staging",
  "backup-logs",
  "restored-tree",
]

export const zeroContentCanaryMarkers = [
  "llmm-r1-d1-prompt-canary",
  "llmm-r1-d1-response-canary",
  "llmm-r1-d1-upload-canary",
]

function add(errors, message) {
  errors.push(message)
}

function sameJson(left, right) {
  const normalize = (value) => {
    if (Array.isArray(value)) return value.map(normalize)
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value)
          .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
          .map(([key, nestedValue]) => [key, normalize(nestedValue)]),
      )
    }
    return value
  }

  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right))
}

function parseJson(source, label, errors) {
  try {
    return JSON.parse(source)
  } catch (error) {
    add(errors, `${label} is not valid JSON: ${error.message}`)
    return null
  }
}

export function validateSourceSafety(sources) {
  const errors = []
  const joined = Object.entries(sources)
    .map(([name, source]) => `\n${name}\n${source}`)
    .join("\n")
    .replaceAll("https://json-schema.org/draft/2020-12/schema", "")

  for (const [pattern, message] of [
    [
      /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
      "private key material is forbidden",
    ],
    [
      /\b(?:gh[pousr]_[A-Za-z0-9_-]{16,}|github_pat_[A-Za-z0-9_]{16,}|sk-(?:proj-)?[A-Za-z0-9_-]{16,})\b/i,
      "credential-like token is forbidden",
    ],
    [
      /(?:^|[\s"'])(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|127\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(?:$|[\s"'])/m,
      "internal IP literal is forbidden",
    ],
    [
      /\b(?:localhost|proxmox|pve|vm\d{2,})\b|\.(?:home|internal|lan|local)\b/i,
      "internal hostname is forbidden",
    ],
    [
      /(?:\/Users\/|\/Volumes\/|\/home\/[^\s]+\/|docs\/lab\/|\.ovpn\b)/i,
      "lab or workstation path is forbidden",
    ],
    [/https?:\/\/[^\s"']+/i, "literal network endpoint is forbidden"],
    [
      /\b(?:RESTIC_REPOSITORY|RESTIC_PASSWORD|repositoryLocator|repositoryPassword)\b/,
      "inline or environment repository values are forbidden",
    ],
  ]) {
    if (pattern.test(joined)) add(errors, message)
  }

  return errors
}

export function validateZeroContentCanaryEvidence(evidence) {
  const errors = []
  if (
    !evidence ||
    typeof evidence !== "object" ||
    Array.isArray(evidence) ||
    !sameJson(
      Object.keys(evidence).sort(),
      [...zeroContentCanarySurfaces].sort(),
    )
  ) {
    return ["canary evidence must contain exactly the reviewed surfaces"]
  }

  for (const surface of zeroContentCanarySurfaces) {
    const entries = evidence[surface]
    if (
      !Array.isArray(entries) ||
      entries.some((entry) => typeof entry !== "string")
    ) {
      add(errors, `${surface} canary evidence must be an array of strings`)
      continue
    }
    for (const marker of zeroContentCanaryMarkers) {
      if (entries.some((entry) => entry.includes(marker))) {
        add(errors, `${surface} contains forbidden workload-content canary`)
      }
    }
  }
  return errors
}

export function validateStorageContract(source) {
  const errors = []
  const contract = parseJson(source, "storage profile", errors)
  if (!contract) return errors

  if (
    contract.apiVersion !== "inference-core.llm-machines/v1" ||
    contract.kind !== "SourceOnlyStorageAndBackupContract" ||
    !sameJson(contract.metadata, {
      changePackage: "PR-11A-R1-D1",
      containsCredentials: false,
      runtimeQualificationStatus: "NOT_EVALUATED_RUNTIME",
      sourceOnly: true,
    })
  ) {
    add(errors, "metadata must remain source-only and NOT_EVALUATED_RUNTIME")
  }

  if (
    contract.localStorage?.backend !== "zfs" ||
    contract.localStorage?.productRequirement !== "required" ||
    !sameJson(contract.localStorage?.datasets, expectedDatasets)
  ) {
    add(errors, "the exact five reviewed ZFS dataset roles are required")
  }

  const datasets = Array.isArray(contract.localStorage?.datasets)
    ? contract.localStorage.datasets
    : []
  if (
    new Set(datasets.map(({ dataset }) => dataset)).size !== 5 ||
    new Set(datasets.map(({ mountpoint }) => mountpoint)).size !== 5
  ) {
    add(errors, "dataset identifiers and mountpoints must remain distinct")
  }

  if (
    !sameJson(contract.localStorage?.localSnapshots, {
      allowed: true,
      countsAsBackup: false,
    }) ||
    contract.backup?.localSnapshotsCountAsBackup !== false
  ) {
    add(errors, "local snapshots must never count as backups")
  }

  if (
    contract.backup?.engine !== "restic" ||
    !sameJson(contract.backup?.repository, {
      credentialValuesIncluded: false,
      encryptedAtRest: true,
      encryptionMode: "restic-repository-encryption",
      environmentVariablesAllowed: false,
      inlineValuesAllowed: false,
      locatorProvisioning: "root-only-mounted-file",
      passwordProvisioning: "root-only-mounted-file",
      targetKind: "separate-customer-owned-mounted-filesystem",
      versioning: "restic-snapshots",
    })
  ) {
    add(
      errors,
      "restic repository custody must remain separate and file-mounted",
    )
  }

  if (
    !sameJson(contract.backup?.retention, {
      cadence: "daily",
      policyState: "accepted-default",
      retentionDays: 30,
    })
  ) {
    add(errors, "the accepted default must remain daily with 30-day retention")
  }

  if (
    !sameJson(contract.backup?.includedDatasets, [
      "product_state",
      "databases",
    ]) ||
    !sameJson(contract.backup?.excludedDatasets, [
      "models",
      "logs",
      "staging",
    ]) ||
    !sameJson(contract.backup?.inputAllowlist, expectedBackupAllowlist) ||
    !sameJson(contract.backup?.inputExclusions, expectedBackupExclusions)
  ) {
    add(errors, "backup inputs must remain the exact allowlist and exclusions")
  }

  if (
    !sameJson(contract.backup?.cleanRestoreQualification, {
      evidence: "metadata-only",
      releaseGate: true,
      required: true,
      restoreTarget: "clean-appliance-environment",
    }) ||
    !sameJson(contract.recovery, {
      recoveryMaterialCustody: "customer-held",
      restoreEvidence: "metadata-only",
      workloadContentInEvidence: false,
    })
  ) {
    add(
      errors,
      "clean restore and customer recovery custody must remain release gates",
    )
  }

  if (
    !sameJson(contract.zeroContentRetention, {
      activeStorage: "forbidden",
      backups: "forbidden",
      caches: "forbidden",
      canarySurfaces: zeroContentCanarySurfaces,
      logs: "forbidden",
      metrics: "forbidden",
    }) ||
    datasets.some(
      ({ workloadContentAllowed }) => workloadContentAllowed !== false,
    )
  ) {
    add(
      errors,
      "zero workload-content retention must cover every reviewed surface",
    )
  }

  if (
    !sameJson(contract.objectStore, {
      currentRetainedCallers: [],
      futureCompatibility: {
        activationGate: "proven-retained-component-caller",
        interface: "s3-compatible",
        seaweedFsDisposition: "first-benchmark-candidate-after-gate",
      },
      genericS3ServiceInBom: false,
      minioInBom: false,
      seaweedFsInBom: false,
      unusedAdapterAllowed: false,
    })
  ) {
    add(errors, "object storage must remain absent until a caller is proven")
  }

  return errors
}

export function validateStorageSchema(source) {
  const errors = []
  const schema = parseJson(source, "storage schema", errors)
  if (!schema) return errors

  const expectedRootRequired = [
    "apiVersion",
    "kind",
    "metadata",
    "localStorage",
    "backup",
    "recovery",
    "zeroContentRetention",
    "objectStore",
  ]
  if (
    schema.type !== "object" ||
    schema.additionalProperties !== false ||
    !sameJson(schema.required, expectedRootRequired)
  ) {
    add(errors, "schema root must remain strict and require every boundary")
  }

  if (
    schema.properties?.metadata?.properties?.runtimeQualificationStatus
      ?.const !== "NOT_EVALUATED_RUNTIME" ||
    schema.properties?.metadata?.properties?.containsCredentials?.const !==
      false
  ) {
    add(errors, "schema must freeze source-only runtime and credential status")
  }

  const datasetSchema = schema.properties?.localStorage?.properties?.datasets
  if (
    datasetSchema?.minItems !== 5 ||
    datasetSchema?.maxItems !== 5 ||
    datasetSchema?.prefixItems?.length !== 5
  ) {
    add(errors, "schema must freeze the exact ordered five-dataset tuple")
  }

  if (
    schema.properties?.backup?.properties?.engine?.const !== "restic" ||
    schema.properties?.backup?.properties?.retention?.properties?.retentionDays
      ?.const !== 30 ||
    schema.properties?.backup?.properties?.repository?.properties
      ?.environmentVariablesAllowed?.const !== false ||
    !sameJson(
      schema.properties?.backup?.properties?.inputAllowlist?.const,
      expectedBackupAllowlist,
    ) ||
    !sameJson(
      schema.properties?.backup?.properties?.inputExclusions?.const,
      expectedBackupExclusions,
    )
  ) {
    add(errors, "schema must freeze restic custody and input boundaries")
  }

  if (
    !sameJson(
      schema.properties?.zeroContentRetention?.properties?.canarySurfaces
        ?.const,
      zeroContentCanarySurfaces,
    ) ||
    schema.properties?.objectStore?.properties?.currentRetainedCallers?.const
      ?.length !== 0 ||
    schema.properties?.objectStore?.properties?.unusedAdapterAllowed?.const !==
      false
  ) {
    add(errors, "schema must freeze canaries and object-store absence")
  }

  return errors
}

export function validateProfile() {
  const errors = []
  const actualFiles = readdirSync(root)
    .filter((name) => !name.startsWith("."))
    .sort()
  if (!sameJson(actualFiles, expectedFiles)) {
    add(
      errors,
      `storage source file set must be exactly ${expectedFiles.join(", ")}`,
    )
  }

  const profileSource = readFileSync(path.join(root, "profile.json"), "utf8")
  const schemaSource = readFileSync(
    path.join(root, "profile.schema.json"),
    "utf8",
  )
  const readmeSource = readFileSync(path.join(root, "README.md"), "utf8")

  errors.push(...validateStorageContract(profileSource))
  errors.push(...validateStorageSchema(schemaSource))
  errors.push(
    ...validateSourceSafety({
      profile: profileSource,
      readme: readmeSource,
      schema: schemaSource,
    }),
  )
  return errors
}

function main() {
  const errors = validateProfile()
  if (errors.length > 0) {
    console.error(errors.map((error) => `- ${error}`).join("\n"))
    process.exitCode = 1
    return
  }
  console.log("Storage source profile validation passed")
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main()
}
