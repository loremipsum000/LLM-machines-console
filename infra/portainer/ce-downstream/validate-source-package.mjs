#!/usr/bin/env node

import { createHash } from "node:crypto"
import { lstatSync, readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const directory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(directory, "../../..")
const digestPattern = /^[a-f0-9]{64}$/
const ociDigestPattern = /^sha256:[a-f0-9]{64}$/
const commitPattern = /^[a-f0-9]{40}$/
const mutablePattern =
  /(?:^|[/:._-])(?:latest|main|master|stable|edge)(?:$|[/:._-])/i

const expectedBuildInputs = [
  {
    id: "dockerfile-frontend",
    repository: "docker.io/docker/dockerfile",
    version: "1.7",
    indexDigest:
      "sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e",
    platform: "linux/amd64",
    platformDigest:
      "sha256:b5f3b260a9678e1d83d2fce86eeddf79420b79147eaba2a25986f47133d73720",
  },
  {
    id: "node-builder",
    repository: "docker.io/library/node",
    version: "22.23.2-bookworm",
    indexDigest:
      "sha256:0557ac14e0d45d02ed563067b82856ca5e7aa3437fa28d98d4350ea9c3d9494a",
    platform: "linux/amd64",
    platformDigest:
      "sha256:673fce836d5a9185da33352682bfedb17c174d016370d08616748dff76fda862",
    sourceRevision: "bc0a422bce0f729dd85790639d9f1918143f1235",
  },
  {
    id: "go-builder",
    repository: "docker.io/library/golang",
    version: "1.25.13-bookworm",
    indexDigest:
      "sha256:e401dae1bf814e29204a8cb7915682e1780951e609ca0dd8865ee1937f510c48",
    platform: "linux/amd64",
    platformDigest:
      "sha256:40dfc169bd5ad8a8617e49c8ead7fe16c6873e79d6937539e9c2e5947b7984ef",
    sourceRevision: "9c4b43a608d38ad80e176140485165f52eb8b8b5",
  },
]

const evidencePaths = {
  artifactLicenseEvidenceSha256:
    "infra/portainer/ce-downstream/evidence/artifact-license-evidence.json",
  binaryGovulncheckSha256:
    "infra/portainer/ce-downstream/evidence/govulncheck-binary.jsonl",
  evidenceInputIndexSha256:
    "infra/portainer/ce-downstream/evidence/evidence-input-index.json",
  sourceGovulncheckSha256:
    "infra/portainer/ce-downstream/evidence/govulncheck-source.jsonl",
  frontendRuntimeBindingSha256:
    "infra/portainer/ce-downstream/evidence/frontend-runtime-binding.json",
  frontendSbomSha256:
    "infra/portainer/ce-downstream/evidence/frontend-sbom.cdx.json",
  frontendVulnerabilityReportSha256:
    "infra/portainer/ce-downstream/evidence/frontend-trivy.json",
  misconfigurationReportSha256:
    "infra/portainer/ce-downstream/evidence/trivy-misconfiguration.json",
  sbomSha256: "infra/portainer/ce-downstream/evidence/sbom.cdx.json",
  provenanceSha256:
    "infra/portainer/ce-downstream/evidence/provenance.intoto.json",
  vulnerabilityReportSha256:
    "infra/portainer/ce-downstream/evidence/trivy.json",
  reproducibilitySha256:
    "infra/portainer/ce-downstream/evidence/reproducibility.json",
  securityFindingMatrixSha256:
    "infra/portainer/ce-downstream/security-finding-matrix.json",
}

const generatedOutputFields = [
  ["artifact-license-evidence.json", "artifactLicenseEvidenceSha256"],
  ["frontend-runtime-binding.json", "frontendRuntimeBindingSha256"],
  ["frontend-sbom.cdx.json", "frontendSbomSha256"],
  ["frontend-trivy.json", "frontendVulnerabilityReportSha256"],
  ["govulncheck-binary.jsonl", "binaryGovulncheckSha256"],
  ["govulncheck-source.jsonl", "sourceGovulncheckSha256"],
  ["provenance.intoto.json", "provenanceSha256"],
  ["reproducibility.json", "reproducibilitySha256"],
  ["sbom.cdx.json", "sbomSha256"],
  ["trivy.json", "vulnerabilityReportSha256"],
]

const expectedLicenseCustody = {
  frontendInputPath:
    "infra/portainer/ce-downstream/evidence/frontend-license-input.json",
  runtimeInputPath:
    "infra/portainer/ce-downstream/evidence/runtime-license-input.json",
  frontendRootPath:
    "infra/portainer/ce-downstream/evidence/frontend-license-custody",
  runtimeRootPath:
    "infra/portainer/ce-downstream/evidence/license-custody/runtime",
  manifestPath: "SHA256SUMS",
  externalArchiveCustody:
    "VM117_EVIDENCE_ROOT_BOUND_AT_GENERATION_NOT_REOPENED_BY_SOURCE_VALIDATOR",
}

const expectedFrontendSecurityOverlay = {
  directDependencies: {
    axios: "1.18.1",
    "js-yaml": "3.15.1",
    lodash: "4.18.1",
    "lodash-es": "npm:lodash@4.18.1",
    postcss: "8.5.25",
  },
  overrides: {
    lodash: "4.18.1",
    "lodash-es": "4.18.1",
    "js-yaml": "3.15.1",
    "linkify-it": "5.0.2",
    nanoid: "3.3.18",
    postcss: "8.5.25",
    "brace-expansion@>=1 <2": "1.1.18",
    "form-data@>=4 <5": "4.0.6",
    "immutable@>=4 <5": "4.3.9",
    "minimatch@>=3 <4": "3.1.4",
    "picomatch@>=2 <3": "2.3.2",
    "ws@>=7 <8": "7.5.11",
    "ws@>=8 <9": "8.21.0",
    "@open-amt-cloud-toolkit/ui-toolkit>ws": "7.5.11",
  },
  webpack: {
    lodashModuleReplacementPlugin: "ABSENT",
    dockerComposeSchema: "SOURCE_CONTROLLED_NO_RUNTIME_FETCH",
  },
  angularJsVex: {
    package: "angular",
    version: "1.8.2",
    lifecycle: "EOL_NO_UPSTREAM_FIX",
    advisories: ["CVE-2024-21490", "CVE-2026-11998"],
    disposition: "NOT_REACHABLE_TIME_BOUND_GUARD",
    guards: [
      "NG_SRCSET_ABSENT",
      "SCE_DELEGATE_CUSTOMIZATION_ABSENT",
      "RESOURCE_URL_LIST_CUSTOMIZATION_ABSENT",
      "TRUST_AS_RESOURCE_URL_ABSENT",
      "DYNAMIC_RESOURCE_URL_SINKS_ABSENT",
    ],
    owner: "PORTAINER_DOWNSTREAM_MAINTAINER",
    expiry: "2026-09-22T23:59:59Z",
    reviewTriggers: [
      "Portainer upstream version changes",
      "AngularJS dependency changes",
      "Any guarded AngularJS source pattern appears",
      "AngularJS advisory guidance changes",
      "Time-bound review expires",
    ],
  },
}

const reachabilityValidatorPath =
  "infra/portainer/ce-downstream/validate-reachability.mjs"
const expectedReachabilityGuardStates = Object.fromEntries(
  [
    "GO_ARCHIVE_DIRECT_IMPORT_ABSENT",
    "COMPOSE_COPY_ABSENT",
    "VULNERABLE_ARCHIVE_CALLS_ABSENT",
    "EXPECTED_COMPOSE_METHOD_SET_EXACT",
    "NG_SRCSET_ABSENT",
    "SCE_DELEGATE_CUSTOMIZATION_ABSENT",
    "RESOURCE_URL_LIST_CUSTOMIZATION_ABSENT",
    "TRUST_AS_RESOURCE_URL_ABSENT",
    "DYNAMIC_RESOURCE_URL_SINKS_ABSENT",
    "LODASH_MODULE_REPLACEMENT_PLUGIN_ABSENT",
    "DOCKER_COMPOSE_SCHEMA_SOURCE_CONTROLLED_NO_RUNTIME_FETCH",
  ].map((name) => [name, true]),
)

const buildEnvironmentEvidencePaths = {
  evidenceInventory: "EVIDENCE-SHA256SUMS",
  buildLog: "build.log",
  builderInspectPreBuild: "builder-inspect.log",
  builderInspectPostBuild: "builder-inspect-final.log",
  builderDiskUsage: "builder-du.log",
  builderContainerSummary: "builder-container-summary.log",
  builderCleanup: "builder-cleanup.log",
  buildxAfterCleanup: "buildx-after-cleanup.log",
  filesystemAfterBuild: "filesystem-after-build.log",
  filesystemAfterCleanup: "filesystem-after-cleanup.log",
  memoryAfterBuild: "memory-after-build.log",
  memoryAfterCleanup: "memory-after-cleanup.log",
  sourceKeySha256Sums: "source-key-SHA256SUMS",
  outputSha256Sums: "output-SHA256SUMS",
  rawOciSha256Sums: "raw-oci-SHA256SUMS",
  rawOciFileInventory: "raw-oci-file-inventory.tsv",
  ociConfig: "oci-config.json",
  ociIndex: "oci-index.json",
  ociManifest: "oci-manifest.json",
  ociIdentities: "oci-identities.txt",
  reachabilityRunExit: "reachability-run.exit",
  reachabilityRunStderr: "reachability-run.stderr",
  reachabilityRunStdout: "reachability-run.stdout",
  reachabilityRunTimes: "reachability-run.times",
}

const expectedActivationPreconditions = {
  dockerEngine: ">=29.7.0 or exact security backport",
  buildkit: ">=0.31.1",
  dockerAuthorizationPlugins: "ABSENT",
  dockerEnginePlugins: "ABSENT",
  untrustedBuildkitFrontends: "DENIED",
  kubernetesAndHelmEnvironments: "NOT_ADMITTED",
}

const expectedActivationBlockers = [
  "Exact managed Docker Engine must be 29.7.0 or an exact admitted security backport.",
  "Exact managed BuildKit must be 0.31.1 or later.",
  "Docker authorization plugins and Docker Engine plugins must be absent.",
  "Untrusted BuildKit frontends and untrusted Git subdirectory build contexts must be denied.",
  "Kubernetes and Helm environments are outside the admitted Docker-only Core profile.",
  "Every shipped Portainer frontend finding must be remediated or receive exact route and sink non-reachability qualification before activation.",
  "F0-N4R2 must qualify Portainer's exact effective UID/GID, Docker authority, mounts, capabilities, security options, and root-equivalent appliance boundary before activation.",
  "F0-N4R2 must bind and prove an exact credential-free Portainer health, restart, unhealthy-state, and recovery contract before activation.",
]

const expectedMisconfigurationEvidence = {
  version: "0.73.0",
  binarySha256:
    "4fdfaf8259c06c1fd7e17d897146326e536737589e3f28ca55bbb4cf735199ad",
  binaryBytes: 200663954,
  reportSha256:
    "90e4e44296b14e4ca651e931c3c687a318042f0120511e4b20fb43a9ba83e073",
  checkBundle: {
    digest:
      "sha256:1583562f8b90ed2a071b99f0e5ffff6b57e4ceb6ca3e4796577b4e6a339eb74c",
    downloadedAt: "2026-08-22T20:49:04.636302Z",
    metadataSha256:
      "f7f7ad5ce48aebfe99846d15c7f0d60a228244d45ef8dbe2bfe958baee7eb416",
    contentInventorySha256:
      "a8e1445dec25c7f2b7e2f2361576a3297ace2bd25a33220d8c4902d3315594d1",
    fileCount: 641,
    bytes: 1054940,
    rootUserPolicySha256:
      "b68fe54fa48d251c59a15e2d76f69bf8e43c237cef6a0078605252333df2eb2e",
    noHealthcheckPolicySha256:
      "a04661ae9c0345a9ded57c8843ac7726eeef10848b78629f9e352ac5e8a4e595",
  },
  scannedAt: "2026-08-23T02:10:16.760586+02:00",
  command:
    "trivy config --skip-check-update --skip-version-check --quiet --format json --output <temporary-output> infra/portainer/ce-downstream/Dockerfile",
  counts: {
    critical: 0,
    high: 1,
    medium: 0,
    low: 1,
    unknown: 0,
  },
}

const expectedMisconfigurationFindings = [
  {
    id: "DS-0002",
    severity: "HIGH",
    target: "Dockerfile",
    evidence: {
      class: "EFFECTIVE_ROOT_RUNTIME_CONFIGURATION",
      configuredUser: "",
      effectiveUser: "root",
      sourceInference: false,
    },
    exposure: {
      anonymous: "NONE_WHILE_CONTRACT_ACTIVATION_IS_INACTIVE",
      operator: "NONE_WHILE_CONTRACT_ACTIVATION_IS_INACTIVE",
      admin: "ROOT_EQUIVALENT_DOCKER_AUTHORITY_IF_ACTIVATED",
      exploitPreconditions:
        "Portainer is activated with Docker authority while its effective container user remains root.",
    },
    impact:
      "A Portainer process compromise would execute as container root next to root-equivalent Docker authority.",
    disposition: {
      status: "R2_LEAST_PRIVILEGE_STARTUP_ACTIVATION_PRECONDITION",
      controls: [
        "Keep Portainer activation and ingress inactive.",
        "F0-N4R2 must bind the exact runtime UID/GID and required Docker authority.",
        "Deny privileged mode, host PID and network namespaces, excess capabilities, and unrelated mounts.",
        "Bind exact writable paths, security options, socket custody, and private networking.",
        "If effective root remains required, document and qualify that root-equivalent appliance boundary explicitly.",
      ],
      owner: "CORE_RUNTIME_SECURITY",
      expiry: null,
      reviewTriggers: [
        "F0-N4R2 startup contract is proposed",
        "Portainer image or runtime UID/GID changes",
        "Docker socket custody or runtime privileges change",
      ],
    },
  },
  {
    id: "DS-0026",
    severity: "LOW",
    target: "Dockerfile",
    evidence: {
      class: "IMAGE_HEALTHCHECK_ABSENT",
      healthcheckPresent: false,
      sourceInference: false,
    },
    exposure: {
      anonymous: "NONE_WHILE_CONTRACT_ACTIVATION_IS_INACTIVE",
      operator: "NONE_WHILE_CONTRACT_ACTIVATION_IS_INACTIVE",
      admin: "CONTROLLED_FAILURE_DETECTION_GAP_IF_ACTIVATED",
      exploitPreconditions:
        "Portainer is activated without an exact external or image-native health contract.",
    },
    impact:
      "Startup failure or runtime degradation could remain undetected or receive incorrect restart handling.",
    disposition: {
      status: "R2_HEALTH_CONTRACT_ACTIVATION_PRECONDITION",
      controls: [
        "Keep Portainer activation and ingress inactive.",
        "F0-N4R2 must define an exact credential-free readiness probe.",
        "Bind interval, timeout, retries, start period, restart behavior, and outage semantics.",
        "Prove startup, restart, unhealthy-state detection, and recovery before activation.",
      ],
      owner: "CORE_RUNTIME_SECURITY",
      expiry: null,
      reviewTriggers: [
        "F0-N4R2 health contract is proposed",
        "Portainer image entrypoint or health endpoint changes",
        "Restart or outage semantics change",
      ],
    },
  },
]

const expectedHistoricalRemediationIdentities = {
  "CVE-2026-33818": ["GO-2026-5972"],
  "CVE-2026-39821": ["GO-2026-5026"],
  "CVE-2026-56853": ["GO-2026-6089"],
  "CVE-2026-56858": ["GO-2026-6091"],
  "CVE-2026-56859": ["GO-2026-6088"],
  "CVE-2026-56860": ["GO-2026-6218"],
  "CVE-2026-56862": ["GO-2026-6090"],
  "CVE-2026-56864": ["GO-2026-6179"],
  "CVE-2026-56865": ["GO-2026-6180"],
}
const expectedHistoricalRemediationsSha256 =
  "681e5e2c529cc40b9782d2cfbd6b654921e4403d612c4219c38024ccb706aefb"

const expectedGoArchiveVex = {
  controls: [
    "Validate that production source has no direct moby/go-archive import.",
    "Allow only the exact observed Compose methods and reject Compose.Copy.",
    "Reject calls to ApplyLayer, CopyTo, Unpack, UnpackLayer, Untar, or UntarUncompressed.",
    "Fail if the locked Compose, Docker CLI, or go-archive identity changes.",
  ],
  owner: "PORTAINER_DOWNSTREAM_MAINTAINER",
  expiry: "2026-09-22",
  reviewTriggers: [
    "Any Portainer source change under api or pkg",
    "Docker Compose dependency changes",
    "Docker CLI dependency changes",
    "moby/go-archive dependency changes",
    "Any container copy or archive feature is added",
  ],
}

const expectedFrontendCompensatingControl = {
  evidenceClass: "SHIPPED_FRONTEND_RUNTIME_REACHABILITY_UNQUALIFIED",
  exposure: {
    anonymous: "UNQUALIFIED_UNTIL_EXACT_ROUTE_CHARACTERIZATION",
    operator: "DENIED_BY_PORTAINER_ADMIN_ONLY_PRODUCT_BOUNDARY",
    admin: "POTENTIAL_IN_AUTHENTICATED_ADMIN_UI",
  },
  controls: [
    "Keep Portainer native ingress inactive until F0-N4R3 route and role qualification.",
    "Expose Portainer to customer Admin only through the Product edge after activation.",
    "Remediate fixed-version packages or prove exact route and sink non-reachability before the time-bound review expires.",
    "Repeat the exact frontend bundle scan and browser security characterization when the overlay changes.",
  ],
  owner: "PRODUCT_SECURITY",
  expiry: "2026-09-22T23:59:59Z",
  reviewTriggers: [
    "Portainer frontend dependency changes",
    "Portainer frontend bundle changes",
    "Portainer ingress or role boundary changes",
    "Frontend advisory guidance changes",
    "Time-bound review expires",
  ],
}

function externalEvidenceFileIsValid(
  entry,
  expectedPath,
  { allowEmpty = false } = {},
) {
  return (
    exactKeys(entry, ["path", "bytes", "sha256"]) &&
    entry.path === expectedPath &&
    Number.isSafeInteger(entry.bytes) &&
    entry.bytes >= (allowEmpty ? 0 : 1) &&
    digestPattern.test(entry.sha256 ?? "")
  )
}

function cloneWithoutVolatile(value) {
  return JSON.parse(JSON.stringify(value))
}

export function sha256File(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex")
}

function sha256Bytes(value) {
  return createHash("sha256").update(value).digest("hex")
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
}

function exactKeys(value, expected) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    canonicalJson(Object.keys(value).sort()) ===
      canonicalJson([...expected].sort())
  )
}

function sourcePackageContractProjection(sourcePackage) {
  const downstream = Object.fromEntries(
    Object.entries(
      cloneWithoutVolatile(sourcePackage?.downstream ?? {}),
    ).filter(([key]) => key !== "artifactEvidence"),
  )
  return {
    schema: sourcePackage?.schema,
    status: sourcePackage?.status,
    accepted: sourcePackage?.accepted,
    runtimeQualified: sourcePackage?.runtimeQualified,
    contractActivation: sourcePackage?.contractActivation,
    containsCredentials: sourcePackage?.containsCredentials,
    productIntegrated: sourcePackage?.productIntegrated,
    upstream: cloneWithoutVolatile(sourcePackage?.upstream),
    downstream,
    admissionBoundary: cloneWithoutVolatile(sourcePackage?.admissionBoundary),
    activationPreconditions: cloneWithoutVolatile(
      sourcePackage?.activationPreconditions,
    ),
  }
}

function readJson(errors, file, label) {
  try {
    return JSON.parse(readFileSync(file, "utf8"))
  } catch {
    errors.push(`${label} is missing or invalid JSON`)
    return null
  }
}

function validateLocalFile(errors, root, entry, label) {
  if (
    !entry ||
    typeof entry.path !== "string" ||
    !digestPattern.test(entry.sha256 ?? "")
  ) {
    errors.push(`${label} identity is missing or invalid`)
    return null
  }
  const file = path.resolve(root, entry.path)
  if (!file.startsWith(`${root}${path.sep}`)) {
    errors.push(`${label} path escapes the repository`)
    return null
  }
  try {
    const metadata = lstatSync(file)
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      errors.push(`${label} must be a regular file`)
    } else if (sha256File(file) !== entry.sha256) {
      errors.push(`${label} differs from its locked SHA-256`)
    } else {
      return file
    }
  } catch {
    errors.push(`${label} is missing`)
  }
  return null
}

function validateEvidenceFile(
  errors,
  root,
  evidence,
  field,
  label,
  format = "json",
) {
  const expected = evidence?.[field]
  if (expected === "PENDING" || !digestPattern.test(expected ?? "")) {
    errors.push(`${label} evidence is PENDING, missing, or invalid`)
    return null
  }
  const file = path.resolve(root, evidencePaths[field])
  try {
    const metadata = lstatSync(file)
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      metadata.nlink !== 1
    ) {
      errors.push(`${label} evidence must be a single-link regular file`)
      return null
    }
    if (sha256File(file) !== expected) {
      errors.push(`${label} evidence differs from its locked SHA-256`)
      return null
    }
  } catch {
    errors.push(`${label} evidence is missing`)
    return null
  }
  if (format === "text") return readFileSync(file, "utf8")
  return readJson(errors, file, `${label} evidence`)
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

function safeEvidencePath(value) {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value) &&
    !value.startsWith("/") &&
    value
      .split("/")
      .every((part) => part !== "" && part !== "." && part !== "..")
  )
}

function safeArchiveEntryIsValid(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !value.startsWith("/") &&
    !value.includes("\\") &&
    !/[\0\r\n]/.test(value) &&
    value
      .split("/")
      .every((part) => part !== "" && part !== "." && part !== "..")
  )
}

function frontendSourceProjectionIsValid(source, manifest) {
  return (
    exactKeys(source, [
      "revision",
      "tree",
      "sourceInventorySha256",
      "fileCount",
      "goModSha256",
      "goSumSha256",
      "packageJsonSha256",
      "pnpmLockSha256",
      "webpackProductionSha256",
      "webpackCommonSha256",
    ]) &&
    source.revision === manifest.upstream.revision &&
    source.tree === manifest.upstream.tree &&
    source.sourceInventorySha256 ===
      manifest.downstream.sourceInventory.sha256SumsSha256 &&
    source.fileCount === manifest.downstream.sourceInventory.fileCount &&
    source.goModSha256 === manifest.downstream.sourceInventory.goModSha256 &&
    source.goSumSha256 === manifest.downstream.sourceInventory.goSumSha256 &&
    source.packageJsonSha256 ===
      manifest.downstream.sourceInventory.packageJsonSha256 &&
    source.pnpmLockSha256 ===
      manifest.downstream.sourceInventory.pnpmLockSha256 &&
    source.webpackProductionSha256 ===
      manifest.downstream.sourceInventory.webpackProductionSha256 &&
    source.webpackCommonSha256 ===
      manifest.downstream.sourceInventory.webpackCommonSha256
  )
}

function licenseCustodyIsValid(custody) {
  return (
    exactKeys(custody, ["root", "manifestPath", "manifestSha256"]) &&
    safeEvidencePath(custody.root) &&
    safeEvidencePath(custody.manifestPath) &&
    digestPattern.test(custody.manifestSha256 ?? "")
  )
}

function listCheckedInCustodyFiles(errors, root, prefix = "") {
  const files = []
  let entries
  try {
    entries = readdirSync(path.join(root, prefix), { withFileTypes: true })
  } catch {
    errors.push(`Portainer license custody root is missing: ${root}`)
    return files
  }
  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name
    const file = path.join(root, relative)
    let metadata
    try {
      metadata = lstatSync(file)
    } catch {
      errors.push(`Portainer license custody entry is unreadable: ${relative}`)
      continue
    }
    if (metadata.isSymbolicLink()) {
      errors.push(`Portainer license custody contains a symlink: ${relative}`)
    } else if (metadata.isDirectory()) {
      files.push(...listCheckedInCustodyFiles(errors, root, relative))
    } else if (metadata.isFile() && metadata.nlink === 1) {
      files.push(relative)
    } else {
      errors.push(
        `Portainer license custody contains an unsupported entry: ${relative}`,
      )
    }
  }
  return files.sort(compareText)
}

function readCustodyManifest(errors, custodyRoot, custody, label) {
  const manifest = path.resolve(custodyRoot, custody?.manifestPath ?? "")
  if (!manifest.startsWith(`${custodyRoot}${path.sep}`)) {
    errors.push(`${label} manifest escapes its custody root`)
    return null
  }
  let metadata
  let contents
  try {
    metadata = lstatSync(manifest)
    contents = readFileSync(manifest, "utf8")
  } catch {
    errors.push(`${label} manifest is missing`)
    return null
  }
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.nlink !== 1 ||
    sha256Bytes(contents) !== custody.manifestSha256
  ) {
    errors.push(`${label} manifest identity differs`)
    return null
  }
  const entries = new Map()
  const paths = []
  for (const line of contents.trimEnd().split("\n")) {
    const match = line.match(/^([a-f0-9]{64}) {2}\.\/(.+)$/)
    if (
      !match ||
      !safeEvidencePath(match[2]) ||
      match[2] === custody.manifestPath ||
      entries.has(match[2])
    ) {
      errors.push(`${label} manifest contains an invalid entry`)
      return null
    }
    entries.set(match[2], match[1])
    paths.push(match[2])
  }
  if (
    entries.size === 0 ||
    canonicalJson(paths) !== canonicalJson([...paths].sort(compareText))
  ) {
    errors.push(`${label} manifest is empty or not canonically sorted`)
    return null
  }
  for (const relative of listCheckedInCustodyFiles(errors, custodyRoot)) {
    if (relative === custody.manifestPath) continue
    const expected = entries.get(relative)
    if (
      !expected ||
      sha256File(path.join(custodyRoot, relative)) !== expected
    ) {
      errors.push(
        `${label} checked-in file is unsealed or differs: ${relative}`,
      )
    }
  }
  return entries
}

function validateCheckedInLegalFile(errors, custodyRoot, entries, file, label) {
  if (
    !file ||
    !safeEvidencePath(file.path) ||
    !Number.isSafeInteger(file.bytes) ||
    file.bytes < 1 ||
    !digestPattern.test(file.sha256 ?? "") ||
    entries?.get(file.path) !== file.sha256
  ) {
    errors.push(`${label} is not bound by the custody manifest`)
    return
  }
  const checkedIn = path.resolve(custodyRoot, file.path)
  if (!checkedIn.startsWith(`${custodyRoot}${path.sep}`)) {
    errors.push(`${label} escapes the custody root`)
    return
  }
  try {
    const metadata = lstatSync(checkedIn)
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      metadata.nlink !== 1 ||
      metadata.size !== file.bytes ||
      sha256File(checkedIn) !== file.sha256
    ) {
      errors.push(`${label} checked-in bytes differ`)
    }
  } catch {
    errors.push(`${label} checked-in text is missing`)
  }
}

function validateExternalCustodyIdentity(errors, entries, source, label) {
  const required = []
  if (source?.kind === "main-module-source") {
    required.push([source.sourceManifestPath, source.sourceManifestSha256])
  } else if (source?.kind === "go-module-zip") {
    required.push(
      [source.archivePath, source.archiveSha256],
      [source.goModPath, source.goModSha256],
      [source.infoPath, source.infoSha256],
    )
  } else if (source?.kind === "go-toolchain-source") {
    required.push([source.sourceArchivePath, source.sourceArchiveSha256])
  } else if (["registry", "git-tarball"].includes(source?.kind)) {
    required.push([source.archivePath, source.archiveSha256])
  }
  for (const [relative, digest] of required) {
    if (
      !safeEvidencePath(relative) ||
      !digestPattern.test(digest ?? "") ||
      entries?.get(relative) !== digest
    ) {
      errors.push(`${label} external source identity is absent from custody`)
    }
  }
}

function validateLicenseInputCoverage(errors, coverage, references, label) {
  const sorted = [...references].sort(compareText)
  if (
    !exactKeys(coverage, [
      "expectedComponentCount",
      "reviewedComponentCount",
      "expectedRefsSha256",
      "missingRefs",
      "unknownExpressions",
      "missingRequiredTexts",
      "copyleftRefs",
      "prohibitedRefs",
      "complete",
    ]) ||
    coverage.expectedComponentCount !== sorted.length ||
    coverage.reviewedComponentCount !== sorted.length ||
    coverage.expectedRefsSha256 !== sha256Bytes(`${canonicalJson(sorted)}\n`) ||
    !Array.isArray(coverage.missingRefs) ||
    coverage.missingRefs.length !== 0 ||
    !Array.isArray(coverage.unknownExpressions) ||
    coverage.unknownExpressions.length !== 0 ||
    !Array.isArray(coverage.missingRequiredTexts) ||
    coverage.missingRequiredTexts.length !== 0 ||
    !Array.isArray(coverage.copyleftRefs) ||
    coverage.copyleftRefs.some((reference) => !references.has(reference)) ||
    !Array.isArray(coverage.prohibitedRefs) ||
    coverage.prohibitedRefs.length !== 0 ||
    coverage.complete !== true
  ) {
    errors.push(`${label} component coverage is incomplete`)
  }
}

function readCheckedInLicenseInput(
  errors,
  root,
  relative,
  expectedSha256,
  label,
) {
  const file = path.resolve(root, relative)
  if (!file.startsWith(`${root}${path.sep}`)) {
    errors.push(`${label} path escapes the repository`)
    return null
  }
  try {
    const metadata = lstatSync(file)
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      metadata.nlink !== 1 ||
      sha256File(file) !== expectedSha256
    ) {
      errors.push(`${label} identity differs`)
      return null
    }
  } catch {
    errors.push(`${label} is missing`)
    return null
  }
  return { file, document: readJson(errors, file, label) }
}

function validateCheckedInCustody(
  errors,
  root,
  inputFile,
  custody,
  expectedRootPath,
  label,
) {
  const custodyRoot = path.resolve(root, expectedRootPath)
  const expectedRelative = path.relative(path.dirname(inputFile), custodyRoot)
  if (
    !licenseCustodyIsValid(custody) ||
    custody.root !== expectedRelative ||
    custody.manifestPath !== expectedLicenseCustody.manifestPath ||
    !custodyRoot.startsWith(`${root}${path.sep}`)
  ) {
    errors.push(`${label} custody path contract differs`)
    return null
  }
  const entries = readCustodyManifest(errors, custodyRoot, custody, label)
  return entries ? { root: custodyRoot, entries } : null
}

function validateCheckedInLicenseFiles(
  errors,
  component,
  custody,
  manifest,
  label,
) {
  for (const file of [
    ...(component?.license?.files ?? []),
    ...(component?.license?.noticeFiles ?? []),
  ]) {
    if (!artifactLegalFileIsValid(file, component.source)) {
      errors.push(`${label} legal-file identity is invalid`)
      continue
    }
    if (file.origin === "source-inventory") {
      const expected = new Map([
        ["LICENSE", manifest.upstream.licenseSourceSha256],
        ["ATTRIBUTIONS.md", manifest.upstream.attributionsSourceSha256],
      ]).get(file.path)
      if (file.sha256 !== expected) {
        errors.push(`${label} source legal file differs`)
      }
      continue
    }
    validateCheckedInLegalFile(
      errors,
      custody.root,
      custody.entries,
      file,
      `${label} legal file`,
    )
    if (
      ["reviewed-source-archive", "reviewed-spdx"].includes(file.origin) &&
      custody.entries.get(file.sourceArchivePath) !== file.sourceArchiveSha256
    ) {
      errors.push(`${label} reviewed source archive is absent from custody`)
    }
  }
}

function validateSourceControlledLicenseEvidence(
  errors,
  root,
  manifest,
  index,
  runtimeBinding,
  artifactLicenseEvidence,
) {
  if (!index || !runtimeBinding || !artifactLicenseEvidence) return
  const contract = manifest.downstream.licenseCustody
  if (canonicalJson(contract) !== canonicalJson(expectedLicenseCustody)) return
  const frontendInput = readCheckedInLicenseInput(
    errors,
    root,
    contract.frontendInputPath,
    index.inputs.rawFrontendLicenseInputSha256,
    "Portainer frontend license input",
  )
  const runtimeInput = readCheckedInLicenseInput(
    errors,
    root,
    contract.runtimeInputPath,
    index.inputs.rawRuntimeLicenseInputSha256,
    "Portainer runtime license input",
  )
  if (!frontendInput?.document || !runtimeInput?.document) return
  const frontend = frontendInput.document
  const runtime = runtimeInput.document
  const frontendCustody = validateCheckedInCustody(
    errors,
    root,
    frontendInput.file,
    frontend.custody,
    contract.frontendRootPath,
    "Portainer frontend license",
  )
  const runtimeCustody = validateCheckedInCustody(
    errors,
    root,
    runtimeInput.file,
    runtime.custody,
    contract.runtimeRootPath,
    "Portainer runtime license",
  )
  if (!frontendCustody || !runtimeCustody) return
  const artifactComponents = new Map(
    (artifactLicenseEvidence.components ?? []).map((component) => [
      component?.bomRef,
      component,
    ]),
  )
  const runtimeComponents = new Map(
    (runtimeBinding.runtime?.components ?? []).map((component) => [
      component.bomRef,
      component,
    ]),
  )
  const frontendRefs = new Set(
    (frontend.components ?? []).map((component) => component?.bomRef),
  )
  if (
    !exactKeys(frontend, [
      "schema",
      "generatedAt",
      "packageManager",
      "artifact",
      "custody",
      "components",
      "coverage",
    ]) ||
    frontend.schema !== "llm-machines.portainer-ce-frontend-license-input.v3" ||
    !Number.isInteger(Date.parse(frontend.generatedAt)) ||
    canonicalJson(frontend.packageManager) !==
      canonicalJson({
        name: "pnpm",
        version: manifest.downstream.pnpm.version,
        packageJson: {
          path: "package.json",
          sha256: runtimeBinding.source.packageJsonSha256,
        },
        lockfile: {
          path: "pnpm-lock.yaml",
          sha256: runtimeBinding.source.pnpmLockSha256,
        },
        install: { frozen: true, ignorePnpmfile: true, scripts: false },
      }) ||
    canonicalJson(frontend.artifact) !==
      canonicalJson({
        ociArchiveSha256: manifest.downstream.artifactEvidence.ociArchiveSha256,
        manifestDigest: manifest.downstream.artifactEvidence.manifestDigest,
        layerDigests: manifest.downstream.artifactEvidence.layerDigests,
        publicInventorySha256: runtimeBinding.runtime.inventorySha256,
        sourceMapInventorySha256:
          runtimeBinding.runtime.sourceMapInventorySha256,
      }) ||
    canonicalJson(frontend.custody) !==
      canonicalJson(artifactLicenseEvidence.custody?.frontend) ||
    !Array.isArray(frontend.components) ||
    frontend.components.length !== runtimeComponents.size ||
    new Set(frontendRefs).size !== frontendRefs.size ||
    canonicalJson([...frontendRefs]) !==
      canonicalJson([...frontendRefs].sort(compareText))
  ) {
    errors.push("Portainer checked-in frontend license input differs")
  }
  validateLicenseInputCoverage(
    errors,
    frontend.coverage,
    frontendRefs,
    "Portainer frontend license",
  )
  for (const component of frontend.components ?? []) {
    const observed = runtimeComponents.get(component?.bomRef)
    const admitted = artifactComponents.get(component?.bomRef)
    if (
      !exactKeys(component, [
        "bomRef",
        "purl",
        "name",
        "version",
        "source",
        "bundle",
        "license",
      ]) ||
      component.purl !== component.bomRef ||
      !observed ||
      component.name !== observed.name ||
      component.version !== observed.version ||
      component.source?.lockKey !== observed.lockKey ||
      canonicalJson(component.bundle) !==
        canonicalJson({
          sourceMapPaths: observed.sourceMapPaths,
          sourcePathCount: observed.sourcePathCount,
        }) ||
      admitted?.scope !== "frontend-npm" ||
      canonicalJson(admitted.source) !== canonicalJson(component.source) ||
      canonicalJson(admitted.license) !== canonicalJson(component.license)
    ) {
      errors.push(
        `Portainer checked-in frontend license component differs: ${component?.bomRef ?? "unknown"}`,
      )
    }
    validateExternalCustodyIdentity(
      errors,
      frontendCustody.entries,
      component.source,
      `Portainer frontend license component ${component?.bomRef ?? "unknown"}`,
    )
    validateCheckedInLicenseFiles(
      errors,
      component,
      frontendCustody,
      manifest,
      `Portainer frontend license component ${component?.bomRef ?? "unknown"}`,
    )
  }

  const runtimeRefs = new Set(
    (runtime.components ?? []).map((component) => component?.sbomBomRef),
  )
  if (
    !exactKeys(runtime, [
      "schema",
      "generatedAt",
      "artifact",
      "custody",
      "components",
      "coverage",
    ]) ||
    runtime.schema !== "llm-machines.portainer-ce-runtime-license-input.v2" ||
    !Number.isInteger(Date.parse(runtime.generatedAt)) ||
    canonicalJson(runtime.artifact) !==
      canonicalJson({
        ociArchiveSha256: manifest.downstream.artifactEvidence.ociArchiveSha256,
        manifestDigest: manifest.downstream.artifactEvidence.manifestDigest,
        configDigest: manifest.downstream.artifactEvidence.configDigest,
        rawSbomSha256: index.inputs.rawSbomSha256,
      }) ||
    canonicalJson(runtime.custody) !==
      canonicalJson(artifactLicenseEvidence.custody?.runtime) ||
    !Array.isArray(runtime.components) ||
    new Set(runtimeRefs).size !== runtimeRefs.size ||
    canonicalJson([...runtimeRefs]) !==
      canonicalJson([...runtimeRefs].sort(compareText))
  ) {
    errors.push("Portainer checked-in runtime license input differs")
  }
  validateLicenseInputCoverage(
    errors,
    runtime.coverage,
    runtimeRefs,
    "Portainer runtime license",
  )
  for (const component of runtime.components ?? []) {
    const admitted = artifactComponents.get(component?.sbomBomRef)
    if (
      !exactKeys(component, [
        "sbomBomRef",
        "purl",
        "name",
        "version",
        "source",
        "license",
      ]) ||
      !admitted ||
      !["runtime-go", "runtime-artifact-file"].includes(admitted.scope) ||
      canonicalJson(admitted.source) !== canonicalJson(component.source) ||
      canonicalJson(admitted.license) !== canonicalJson(component.license)
    ) {
      errors.push(
        `Portainer checked-in runtime license component differs: ${component?.sbomBomRef ?? "unknown"}`,
      )
    }
    validateExternalCustodyIdentity(
      errors,
      runtimeCustody.entries,
      component.source,
      `Portainer runtime license component ${component?.sbomBomRef ?? "unknown"}`,
    )
    validateCheckedInLicenseFiles(
      errors,
      component,
      runtimeCustody,
      manifest,
      `Portainer runtime license component ${component?.sbomBomRef ?? "unknown"}`,
    )
  }
}

function validateArtifactProjection(errors, artifact, evidence, label) {
  const layers = artifact?.layers
  const layerDigests = Array.isArray(layers)
    ? layers.map(({ digest }) => digest)
    : []
  if (
    artifact?.ociArchiveSha256 !== evidence?.ociArchiveSha256 ||
    artifact?.ociArchiveBytes !== evidence?.ociArchiveBytes ||
    artifact?.indexDigest !== evidence?.indexDigest ||
    artifact?.manifestDigest !== evidence?.manifestDigest ||
    artifact?.configDigest !== evidence?.configDigest ||
    artifact?.platform !== "linux/amd64" ||
    artifact?.runtimeInventorySha256 !== evidence?.runtimeInventorySha256 ||
    !Array.isArray(layers) ||
    layers.length === 0 ||
    layers.some(
      (layer) =>
        !exactKeys(layer, ["digest", "mediaType", "size"]) ||
        !ociDigestPattern.test(layer?.digest ?? "") ||
        ![
          "application/vnd.oci.image.layer.v1.tar",
          "application/vnd.oci.image.layer.v1.tar+gzip",
          "application/vnd.oci.image.layer.v1.tar+zstd",
        ].includes(layer?.mediaType) ||
        !Number.isSafeInteger(layer?.size) ||
        layer.size < 1,
    ) ||
    new Set(layerDigests).size !== layerDigests.length ||
    canonicalJson(layerDigests) !== canonicalJson(evidence?.layerDigests)
  ) {
    errors.push(`${label} does not bind the exact OCI artifact projection`)
    return false
  }
  return true
}

function validateScan(errors, scan, evidence) {
  const scannedAt = Date.parse(scan?.scannedAt)
  const databaseUpdatedAt = Date.parse(scan?.trivy?.databaseUpdatedAt)
  const frontendDatabaseUpdatedAt = Date.parse(
    scan?.frontend?.trivy?.databaseUpdatedAt,
  )
  if (
    !exactKeys(scan, [
      "schema",
      "scannedAt",
      "syft",
      "trivy",
      "govulncheck",
      "frontend",
    ]) ||
    !exactKeys(scan?.syft, [
      "name",
      "version",
      "toolImageDigest",
      "targetImageDigest",
    ]) ||
    !exactKeys(scan?.trivy, [
      "name",
      "version",
      "toolImageDigest",
      "targetImageDigest",
      "databaseUpdatedAt",
      "databaseSha256",
    ]) ||
    !exactKeys(scan?.govulncheck, ["name", "version", "binarySha256"]) ||
    !exactKeys(scan?.frontend, ["sourceInventorySha256", "syft", "trivy"]) ||
    !exactKeys(scan?.frontend?.syft, ["name", "version", "toolImageDigest"]) ||
    !exactKeys(scan?.frontend?.trivy, [
      "name",
      "version",
      "toolImageDigest",
      "databaseUpdatedAt",
      "databaseSha256",
    ]) ||
    scan?.schema !== "llm-machines.portainer-ce-scan-input.v1" ||
    scan?.syft?.name !== "syft" ||
    !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(scan?.syft?.version ?? "") ||
    !ociDigestPattern.test(scan?.syft?.toolImageDigest ?? "") ||
    scan?.syft?.targetImageDigest !== evidence?.manifestDigest ||
    scan?.trivy?.name !== "trivy" ||
    !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(
      scan?.trivy?.version ?? "",
    ) ||
    !ociDigestPattern.test(scan?.trivy?.toolImageDigest ?? "") ||
    scan?.trivy?.targetImageDigest !== evidence?.manifestDigest ||
    !digestPattern.test(scan?.trivy?.databaseSha256 ?? "") ||
    scan?.govulncheck?.name !== "govulncheck" ||
    scan?.govulncheck?.version !== "1.7.0" ||
    !digestPattern.test(scan?.govulncheck?.binarySha256 ?? "") ||
    !Number.isInteger(scannedAt) ||
    !Number.isInteger(databaseUpdatedAt) ||
    scannedAt < databaseUpdatedAt ||
    scannedAt - databaseUpdatedAt > 72 * 60 * 60 * 1000 ||
    !digestPattern.test(scan?.frontend?.sourceInventorySha256 ?? "") ||
    scan?.frontend?.syft?.name !== "syft" ||
    scan?.frontend?.syft?.version !== scan?.syft?.version ||
    scan?.frontend?.syft?.toolImageDigest !== scan?.syft?.toolImageDigest ||
    scan?.frontend?.trivy?.name !== "trivy" ||
    scan?.frontend?.trivy?.version !== scan?.trivy?.version ||
    scan?.frontend?.trivy?.toolImageDigest !== scan?.trivy?.toolImageDigest ||
    !digestPattern.test(scan?.frontend?.trivy?.databaseSha256 ?? "") ||
    !Number.isInteger(frontendDatabaseUpdatedAt) ||
    scannedAt < frontendDatabaseUpdatedAt ||
    scannedAt - frontendDatabaseUpdatedAt > 72 * 60 * 60 * 1000
  ) {
    errors.push("Portainer evidence scan metadata is incomplete or stale")
    return false
  }
  return true
}

function validateFrontendRuntimeBinding(errors, binding, manifest, index) {
  if (!binding || !index) return null
  const artifactEvidence = manifest.downstream.artifactEvidence
  const assemblies = binding?.assemblies
  const runtime = binding?.runtime
  const files = runtime?.files
  const sourceMaps = runtime?.sourceMaps
  const components = runtime?.components
  const filePaths = Array.isArray(files) ? files.map(({ path }) => path) : []
  const filesByPath = new Map(
    Array.isArray(files) ? files.map((entry) => [entry?.path, entry]) : [],
  )
  const sourceMapPaths = Array.isArray(sourceMaps)
    ? sourceMaps.map(({ path }) => path)
    : []
  const componentRefs = Array.isArray(components)
    ? components.map(({ bomRef }) => bomRef)
    : []
  const inventorySha256 = Array.isArray(files)
    ? sha256Bytes(`${canonicalJson(files)}\n`)
    : null
  const sourceMapInventorySha256 = Array.isArray(sourceMaps)
    ? sha256Bytes(`${canonicalJson(sourceMaps)}\n`)
    : null
  const expectedArtifact = {
    ociArchiveSha256: artifactEvidence.ociArchiveSha256,
    manifestDigest: artifactEvidence.manifestDigest,
    configDigest: artifactEvidence.configDigest,
    layerDigests: artifactEvidence.layerDigests,
  }
  const runtimeSummary = {
    path: runtime?.path,
    fileCount: runtime?.fileCount,
    bytes: runtime?.bytes,
    inventorySha256: runtime?.inventorySha256,
    sourceMapCount: runtime?.sourceMapCount,
    sourceMapInventorySha256: runtime?.sourceMapInventorySha256,
    sourcePathCount: runtime?.sourcePathCount,
    packageStoreIdentityCount: runtime?.packageStoreIdentityCount,
    componentCount: runtime?.componentCount,
  }
  const assemblyProjection = (assembly) => ({
    publicInventorySha256: assembly?.publicInventorySha256,
    publicFileCount: assembly?.publicFileCount,
    publicBytes: assembly?.publicBytes,
    sourceMapInventorySha256: assembly?.sourceMapInventorySha256,
    sourceMapCount: assembly?.sourceMapCount,
    sourcePathCount: assembly?.sourcePathCount,
    packageStoreIdentityCount: assembly?.packageStoreIdentityCount,
  })
  const expectedAssembly = {
    publicInventorySha256: runtime?.inventorySha256,
    publicFileCount: runtime?.fileCount,
    publicBytes: runtime?.bytes,
    sourceMapInventorySha256: runtime?.sourceMapInventorySha256,
    sourceMapCount: runtime?.sourceMapCount,
    sourcePathCount: runtime?.sourcePathCount,
    packageStoreIdentityCount: runtime?.packageStoreIdentityCount,
  }
  const indexFrontend = index?.frontend
  const expectedFrontendSyft = {
    ...index?.scan?.frontend?.syft,
    rawReportSha256: index?.inputs?.rawFrontendSbomSha256,
  }
  const expectedFrontendTrivy = {
    ...index?.scan?.frontend?.trivy,
    rawReportSha256: index?.inputs?.rawFrontendTrivySha256,
  }
  if (
    !exactKeys(binding, [
      "schema",
      "status",
      "accepted",
      "runtimeQualified",
      "source",
      "artifact",
      "assemblies",
      "runtime",
    ]) ||
    binding.schema !==
      "llm-machines.portainer-ce-frontend-runtime-binding.v1" ||
    binding.status !== "SOURCE_SECURITY_CHARACTERIZED_NOT_CORE_ADMITTED" ||
    binding.accepted !== false ||
    binding.runtimeQualified !== false ||
    !frontendSourceProjectionIsValid(binding.source, manifest) ||
    canonicalJson(binding.artifact) !== canonicalJson(expectedArtifact) ||
    !Array.isArray(assemblies) ||
    assemblies.length !== 2 ||
    assemblies[0]?.id !== "A" ||
    assemblies[1]?.id !== "B" ||
    assemblies.some(
      (assembly) =>
        !exactKeys(assembly, [
          "id",
          "publicInventorySha256",
          "publicFileCount",
          "publicBytes",
          "sourceMapInventorySha256",
          "sourceMapCount",
          "sourcePathCount",
          "packageStoreIdentityCount",
        ]) ||
        canonicalJson(assemblyProjection(assembly)) !==
          canonicalJson(expectedAssembly),
    ) ||
    !exactKeys(runtime, [
      "path",
      "fileCount",
      "bytes",
      "inventorySha256",
      "files",
      "sourceMapCount",
      "sourceMapInventorySha256",
      "sourceMaps",
      "sourcePathCount",
      "packageStoreIdentityCount",
      "componentCount",
      "components",
    ]) ||
    runtime.path !== "/public" ||
    !Array.isArray(files) ||
    files.length === 0 ||
    files.some(
      (entry) =>
        !exactKeys(entry, ["path", "bytes", "sha256"]) ||
        !safeEvidencePath(entry.path) ||
        !Number.isSafeInteger(entry.bytes) ||
        entry.bytes < 1 ||
        !digestPattern.test(entry.sha256 ?? ""),
    ) ||
    new Set(filePaths).size !== filePaths.length ||
    canonicalJson(filePaths) !==
      canonicalJson([...filePaths].sort(compareText)) ||
    runtime.fileCount !== files.length ||
    runtime.bytes !== files.reduce((total, entry) => total + entry.bytes, 0) ||
    runtime.inventorySha256 !== inventorySha256 ||
    !Array.isArray(sourceMaps) ||
    sourceMaps.length === 0 ||
    sourceMaps.some(
      (entry) =>
        !exactKeys(entry, ["path", "sha256", "sourceCount"]) ||
        !safeEvidencePath(entry.path) ||
        !entry.path.endsWith(".map") ||
        !filePaths.includes(entry.path) ||
        filesByPath.get(entry.path)?.sha256 !== entry.sha256 ||
        !digestPattern.test(entry.sha256 ?? "") ||
        !Number.isSafeInteger(entry.sourceCount) ||
        entry.sourceCount < 1,
    ) ||
    files.some(
      (entry) =>
        entry.path.endsWith(".js") &&
        !sourceMapPaths.includes(`${entry.path}.map`),
    ) ||
    new Set(sourceMapPaths).size !== sourceMapPaths.length ||
    canonicalJson(sourceMapPaths) !==
      canonicalJson([...sourceMapPaths].sort(compareText)) ||
    runtime.sourceMapCount !== sourceMaps.length ||
    runtime.sourceMapInventorySha256 !== sourceMapInventorySha256 ||
    runtime.sourcePathCount !==
      sourceMaps.reduce((total, entry) => total + entry.sourceCount, 0) ||
    !Array.isArray(components) ||
    components.length === 0 ||
    components.some(
      (component) =>
        !exactKeys(component, [
          "bomRef",
          "name",
          "version",
          "lockKey",
          "sourceMapPaths",
          "sourcePathCount",
        ]) ||
        !/^pkg:npm\//.test(component.bomRef ?? "") ||
        typeof component.name !== "string" ||
        component.name.length === 0 ||
        typeof component.version !== "string" ||
        component.version.length === 0 ||
        typeof component.lockKey !== "string" ||
        component.lockKey.length === 0 ||
        !Array.isArray(component.sourceMapPaths) ||
        component.sourceMapPaths.length === 0 ||
        component.sourceMapPaths.some(
          (entry) => !sourceMapPaths.includes(entry),
        ) ||
        canonicalJson(component.sourceMapPaths) !==
          canonicalJson([...component.sourceMapPaths].sort(compareText)) ||
        !Number.isSafeInteger(component.sourcePathCount) ||
        component.sourcePathCount < component.sourceMapPaths.length,
    ) ||
    new Set(componentRefs).size !== componentRefs.length ||
    canonicalJson(componentRefs) !==
      canonicalJson([...componentRefs].sort(compareText)) ||
    runtime.componentCount !== components.length ||
    runtime.packageStoreIdentityCount !== components.length ||
    !exactKeys(indexFrontend, ["source", "runtime", "scan", "license"]) ||
    !frontendSourceProjectionIsValid(index?.frontend?.source, manifest) ||
    canonicalJson(index.frontend.source) !== canonicalJson(binding.source) ||
    canonicalJson(index.frontend.runtime) !== canonicalJson(runtimeSummary) ||
    !exactKeys(indexFrontend?.scan, ["scannedAt", "syft", "trivy"]) ||
    indexFrontend.scan.scannedAt !== index.scan.scannedAt ||
    canonicalJson(indexFrontend.scan.syft) !==
      canonicalJson(expectedFrontendSyft) ||
    canonicalJson(indexFrontend.scan.trivy) !==
      canonicalJson(expectedFrontendTrivy) ||
    index.scan.frontend.sourceInventorySha256 !==
      binding.source.sourceInventorySha256 ||
    !exactKeys(indexFrontend?.license, [
      "frontendInputSha256",
      "runtimeInputSha256",
      "custody",
      "artifactLicenseEvidenceComplete",
    ]) ||
    indexFrontend.license.frontendInputSha256 !==
      index.inputs.rawFrontendLicenseInputSha256 ||
    indexFrontend.license.runtimeInputSha256 !==
      index.inputs.rawRuntimeLicenseInputSha256 ||
    !exactKeys(indexFrontend.license.custody, [
      "archiveCustodyMode",
      "frontend",
      "runtime",
    ]) ||
    indexFrontend.license.custody.archiveCustodyMode !==
      "EXTERNAL_SEALED_DIGEST_BOUND" ||
    !licenseCustodyIsValid(indexFrontend.license.custody.frontend) ||
    !licenseCustodyIsValid(indexFrontend.license.custody.runtime) ||
    indexFrontend.license.artifactLicenseEvidenceComplete !== true
  ) {
    errors.push(
      "Portainer frontend runtime evidence does not bind exact A/B /public output",
    )
  }
  return binding
}

function reachabilityProjectionIsValid(projection, manifest, index, root) {
  const assemblies = projection?.assemblies
  return (
    exactKeys(projection, ["validator", "angularJsVex", "assemblies"]) &&
    canonicalJson(projection.validator) ===
      canonicalJson({
        path: reachabilityValidatorPath,
        sha256: sha256File(path.join(root, reachabilityValidatorPath)),
        nodeVersion: manifest.downstream.buildToolchain.nodeExecutor,
      }) &&
    canonicalJson(projection.angularJsVex) ===
      canonicalJson({
        expiresAt: expectedFrontendSecurityOverlay.angularJsVex.expiry,
        advisories: expectedFrontendSecurityOverlay.angularJsVex.advisories,
      }) &&
    Array.isArray(assemblies) &&
    assemblies.length === 2 &&
    assemblies.every((assembly, offset) => {
      const id = offset === 0 ? "A" : "B"
      const evaluatedAt = Date.parse(assembly?.evaluatedAt)
      return (
        exactKeys(assembly, ["id", "evaluatedAt", "receiptSha256"]) &&
        assembly.id === id &&
        Number.isInteger(evaluatedAt) &&
        evaluatedAt <=
          Date.parse(expectedFrontendSecurityOverlay.angularJsVex.expiry) &&
        assembly.receiptSha256 ===
          index.inputs[`assembly${id}ReachabilityReceiptSha256`]
      )
    })
  )
}

function validateEvidenceIndex(errors, index, manifest, root) {
  if (!index) return null
  const evidence = manifest.downstream.artifactEvidence
  const expectedInputs = [
    "sourcePackageContractSha256",
    "assemblyARecordSha256",
    "assemblyBRecordSha256",
    "assemblyAReachabilityReceiptSha256",
    "assemblyBReachabilityReceiptSha256",
    "rawSbomSha256",
    "rawTrivySha256",
    "rawSourceGovulncheckSha256",
    "rawBinaryGovulncheckSha256",
    "rawFrontendSbomSha256",
    "rawFrontendTrivySha256",
    "rawFrontendLicenseInputSha256",
    "rawRuntimeLicenseInputSha256",
    "frontendSourceInventorySha256",
    "scanMetadataSha256",
  ]
  const expectedOutputs = generatedOutputFields.map(([output, field]) => ({
    path: output,
    sha256: evidence?.[field],
  }))
  const sourceContractSha256 = sha256Bytes(
    `${canonicalJson(sourcePackageContractProjection(manifest))}\n`,
  )
  const generator = path.join(
    root,
    "infra/portainer/ce-downstream/generate-evidence.mjs",
  )
  if (
    !exactKeys(index, [
      "schema",
      "status",
      "accepted",
      "runtimeQualified",
      "contractActivation",
      "containsCredentials",
      "component",
      "artifact",
      "scan",
      "frontend",
      "reachability",
      "evidenceTooling",
      "inputs",
      "generatorSha256",
      "outputs",
    ]) ||
    index.schema !== "llm-machines.portainer-ce-evidence-input-index.v1" ||
    index.status !== "SOURCE_SECURITY_CHARACTERIZED_NOT_CORE_ADMITTED" ||
    index.accepted !== false ||
    index.runtimeQualified !== false ||
    index.contractActivation !== "INACTIVE" ||
    index.containsCredentials !== false ||
    canonicalJson(index.component) !==
      canonicalJson({
        id: "portainer-ce-downstream",
        version: manifest.downstream.version,
        sourceRevision: manifest.upstream.revision,
        sourceTree: manifest.upstream.tree,
        platform: "linux/amd64",
      }) ||
    canonicalJson(index.evidenceTooling) !==
      canonicalJson(manifest.downstream.evidenceTooling) ||
    !exactKeys(index.inputs, expectedInputs) ||
    expectedInputs.some(
      (field) => !digestPattern.test(index?.inputs?.[field] ?? ""),
    ) ||
    index?.inputs?.sourcePackageContractSha256 !== sourceContractSha256 ||
    index?.inputs?.frontendSourceInventorySha256 !==
      manifest.downstream.sourceInventory.sha256SumsSha256 ||
    index?.inputs?.assemblyARecordSha256 ===
      index?.inputs?.assemblyBRecordSha256 ||
    index?.inputs?.assemblyAReachabilityReceiptSha256 ===
      index?.inputs?.assemblyBReachabilityReceiptSha256 ||
    !reachabilityProjectionIsValid(index.reachability, manifest, index, root) ||
    !digestPattern.test(index?.generatorSha256 ?? "") ||
    sha256File(generator) !== index?.generatorSha256 ||
    canonicalJson(index.outputs) !== canonicalJson(expectedOutputs)
  ) {
    errors.push(
      "Portainer evidence input index differs from the exact contract",
    )
  }
  validateArtifactProjection(
    errors,
    index.artifact,
    evidence,
    "Portainer evidence index artifact",
  )
  validateScan(errors, index.scan, evidence)
  return index
}

function readSingleLinkJson(errors, file, label) {
  try {
    const metadata = lstatSync(file)
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      metadata.nlink !== 1
    ) {
      errors.push(`${label} must be a single-link regular file`)
      return null
    }
  } catch {
    errors.push(`${label} is missing`)
    return null
  }
  return readJson(errors, file, label)
}

function validateAssemblyReceipts(errors, root, manifest, index) {
  if (!index) return null
  const records = []
  const environments = []
  const reachability = []
  const byproducts = new Map()
  const validatorSha256 = sha256File(path.join(root, reachabilityValidatorPath))
  for (const assembly of ["A", "B"]) {
    const lower = assembly.toLowerCase()
    const receiptRoot = path.join(
      root,
      "infra/portainer/ce-downstream/evidence/assemblies",
      lower,
    )
    const recordFile = path.join(receiptRoot, "sealed-record.json")
    const record = readSingleLinkJson(
      errors,
      recordFile,
      `Portainer Assembly ${assembly} sealed record`,
    )
    const expectedRecordSha256 = index.inputs[`assembly${assembly}RecordSha256`]
    const expectedSource = {
      revision: manifest.upstream.revision,
      tree: manifest.upstream.tree,
      archiveSha256: manifest.upstream.archiveSha256,
      sourceInventorySha256:
        manifest.downstream.sourceInventory.sha256SumsSha256,
      patchSha256: manifest.downstream.patch.sha256,
      dockerfileSha256: manifest.downstream.dockerfile.sha256,
      dockerignoreSha256: manifest.downstream.dockerignore.sha256,
    }
    const started = Date.parse(record?.build?.startedOn)
    const finished = Date.parse(record?.build?.finishedOn)
    if (
      !record ||
      sha256File(recordFile) !== expectedRecordSha256 ||
      record.schema !== "llm-machines.portainer-ce-sealed-assembly.v1" ||
      record.assembly !== assembly ||
      canonicalJson(record.source) !== canonicalJson(expectedSource) ||
      canonicalJson(record.build) !==
        canonicalJson({
          startedOn: record?.build?.startedOn,
          finishedOn: record?.build?.finishedOn,
          platform: "linux/amd64",
          buildkitPlatformDigest:
            manifest.downstream.buildToolchain.buildkit.platformDigest,
        }) ||
      !Number.isInteger(started) ||
      !Number.isInteger(finished) ||
      started > finished ||
      !Array.isArray(record.evidence) ||
      record.evidence.length !== 3
    ) {
      errors.push(
        `Portainer Assembly ${assembly} sealed record is not evidence-bound`,
      )
    }
    const links = new Map(
      Array.isArray(record?.evidence)
        ? record.evidence.map((entry) => [entry?.id, entry])
        : [],
    )
    const expectedRecordOrder = [
      "build-log",
      "build-environment",
      "source-reachability",
    ]
    const expectedLinks = new Map([
      ["build-environment", "build-environment-receipt.json"],
      ["build-log", "build-log-receipt.json"],
      ["source-reachability", "reachability-receipt.json"],
    ])
    if (
      canonicalJson((record?.evidence ?? []).map(({ id }) => id)) !==
      canonicalJson(expectedRecordOrder)
    ) {
      errors.push(
        `Portainer Assembly ${assembly} sealed evidence order differs`,
      )
    }
    let environment = null
    for (const [id, relative] of expectedLinks) {
      const link = links.get(id)
      const receiptFile = path.join(receiptRoot, relative)
      const receipt = readSingleLinkJson(
        errors,
        receiptFile,
        `Portainer Assembly ${assembly} ${id} receipt`,
      )
      if (
        !link ||
        link.path !== relative ||
        !digestPattern.test(link.sha256 ?? "") ||
        (receipt && sha256File(receiptFile) !== link.sha256)
      ) {
        errors.push(`Portainer Assembly ${assembly} ${id} receipt hash differs`)
      }
      if (link?.sha256) {
        byproducts.set(`assembly-${lower}-${id}`, link.sha256)
      }
      if (id === "build-environment") {
        const independence = receipt?.independence
        const evidenceRoot = `/var/tmp/llmm-portainer-n4r1r2/evidence/assembly-${lower}`
        const sourceRoot = `/var/tmp/llmm-portainer-n4r1r2/${lower}/source`
        const outputRoot = `/var/tmp/llmm-portainer-n4r1r2/${lower}/output`
        const expectedEvidencePaths = {
          ...buildEnvironmentEvidencePaths,
          founderInventoryBefore:
            assembly === "A"
              ? "founder-container-inventory-before-cleanup.tsv"
              : "founder-container-inventory-before.tsv",
          founderInventoryAfter:
            assembly === "A"
              ? "founder-container-inventory-after-cleanup.tsv"
              : "founder-container-inventory-after.tsv",
        }
        const environmentEvidence = receipt?.evidence
        if (
          !exactKeys(receipt, [
            "schema",
            "assembly",
            "containsCredentials",
            "evidenceRoot",
            "host",
            "docker",
            "buildkit",
            "independence",
            "observedResources",
            "evidence",
          ]) ||
          receipt?.schema !==
            "llm-machines.portainer-ce-build-environment-receipt.v2" ||
          receipt?.assembly !== assembly ||
          receipt?.containsCredentials !== false ||
          receipt?.evidenceRoot !== evidenceRoot ||
          !exactKeys(receipt?.host, [
            "architecture",
            "hostname",
            "kernel",
            "operatingSystem",
            "memoryBytes",
            "rootFilesystemBytes",
            "swapBytes",
          ]) ||
          receipt?.host?.architecture !== "amd64" ||
          receipt?.host?.hostname !== "llmm-uat-core-f0" ||
          [receipt?.host?.kernel, receipt?.host?.operatingSystem].some(
            (value) => typeof value !== "string" || value.length === 0,
          ) ||
          !exactKeys(receipt?.docker, ["engine", "buildx"]) ||
          receipt?.docker?.engine !==
            manifest.downstream.buildToolchain.dockerEngine ||
          receipt?.docker?.buildx !==
            manifest.downstream.buildToolchain.dockerBuildx ||
          !exactKeys(receipt?.buildkit, [
            "version",
            "platformDigest",
            "configDigest",
          ]) ||
          receipt?.buildkit?.version !==
            manifest.downstream.buildToolchain.buildkit.version ||
          receipt?.buildkit?.platformDigest !==
            manifest.downstream.buildToolchain.buildkit.platformDigest ||
          receipt?.buildkit?.configDigest !==
            manifest.downstream.buildToolchain.buildkit.configDigest ||
          !exactKeys(independence, [
            "builder",
            "sourceRoot",
            "outputRoot",
            "cacheShared",
          ]) ||
          independence?.builder !== `llmm-portainer-n4r1r2-${lower}` ||
          independence?.sourceRoot !== sourceRoot ||
          independence?.outputRoot !== outputRoot ||
          independence?.cacheShared !== false ||
          !exactKeys(receipt?.observedResources, [
            "minimumAvailableMemoryBytes",
            "minimumAvailableRootFilesystemBytes",
            "maximumSwapUsedBytes",
          ]) ||
          Object.values(receipt?.observedResources ?? {}).some(
            (value) => !Number.isSafeInteger(value) || value < 0,
          ) ||
          receipt?.observedResources?.minimumAvailableMemoryBytes < 1 ||
          receipt?.observedResources?.minimumAvailableRootFilesystemBytes < 1 ||
          receipt?.observedResources?.maximumSwapUsedBytes < 0 ||
          receipt?.observedResources?.minimumAvailableMemoryBytes >
            receipt?.host?.memoryBytes ||
          receipt?.observedResources?.minimumAvailableRootFilesystemBytes >
            receipt?.host?.rootFilesystemBytes ||
          !Number.isSafeInteger(receipt?.host?.memoryBytes) ||
          receipt?.host?.memoryBytes < 1 ||
          !Number.isSafeInteger(receipt?.host?.rootFilesystemBytes) ||
          receipt?.host?.rootFilesystemBytes < 1 ||
          !Number.isSafeInteger(receipt?.host?.swapBytes) ||
          receipt?.host?.swapBytes < 0 ||
          receipt?.observedResources?.maximumSwapUsedBytes >
            receipt?.host?.swapBytes ||
          [
            receipt?.host?.memoryBytes,
            receipt?.host?.rootFilesystemBytes,
            receipt?.host?.swapBytes,
          ].some((value) => !Number.isSafeInteger(value)) ||
          !exactKeys(environmentEvidence, [
            ...Object.keys(expectedEvidencePaths),
            "bootstrapLog",
          ]) ||
          Object.entries(expectedEvidencePaths).some(
            ([field, evidencePath]) =>
              !externalEvidenceFileIsValid(
                environmentEvidence?.[field],
                evidencePath,
                { allowEmpty: field === "reachabilityRunStderr" },
              ),
          ) ||
          (assembly === "A"
            ? environmentEvidence?.bootstrapLog !== null
            : !externalEvidenceFileIsValid(
                environmentEvidence?.bootstrapLog,
                "builder-bootstrap.log",
              ))
        ) {
          errors.push(
            `Portainer Assembly ${assembly} build-environment receipt is inadmissible`,
          )
        }
        environment = receipt
        environments.push(receipt)
      } else if (id === "build-log") {
        const command = receipt?.command
        const commandText = Array.isArray(command) ? command.join("\u0000") : ""
        if (
          !exactKeys(receipt, [
            "schema",
            "assembly",
            "bytes",
            "command",
            "containsCredentials",
            "exitStatus",
            "preservedAt",
            "sha256",
          ]) ||
          receipt?.schema !==
            "llm-machines.portainer-ce-build-log-receipt.v1" ||
          receipt?.assembly !== assembly ||
          receipt?.containsCredentials !== false ||
          receipt?.exitStatus !== 0 ||
          !Number.isSafeInteger(receipt?.bytes) ||
          receipt.bytes < 1 ||
          !digestPattern.test(receipt?.sha256 ?? "") ||
          !Array.isArray(command) ||
          command[0] !== "docker" ||
          !command.includes("buildx") ||
          !command.includes("build") ||
          !command.includes(environment?.independence?.builder) ||
          !command.includes("linux/amd64") ||
          !command.includes("--no-cache") ||
          !command.includes("--provenance=false") ||
          !command.includes("--sbom=false") ||
          !command.includes(
            `SOURCE_DATE_EPOCH=${manifest.upstream.sourceDateEpoch}`,
          ) ||
          !command.includes(
            `type=oci,dest=${environment?.independence?.outputRoot}/raw-oci,tar=false,rewrite-timestamp=true`,
          ) ||
          !command.includes(environment?.independence?.sourceRoot) ||
          receipt?.preservedAt !==
            `VM117:${environment?.evidenceRoot}/build.log` ||
          receipt?.bytes !== environment?.evidence?.buildLog?.bytes ||
          receipt?.sha256 !== environment?.evidence?.buildLog?.sha256 ||
          /(?:password|credential|secret|token)/i.test(commandText)
        ) {
          errors.push(
            `Portainer Assembly ${assembly} build-log receipt is inadmissible`,
          )
        }
      } else {
        const evaluatedAt = Date.parse(receipt?.evaluatedAt)
        const buildFinishedAt = Date.parse(record?.build?.finishedOn)
        const projected = index.reachability?.assemblies?.find(
          (entry) => entry?.id === assembly,
        )
        if (
          receipt?.schema !==
            "llm-machines.portainer-ce-reachability-receipt.v1" ||
          receipt?.assembly !== assembly ||
          !exactKeys(receipt, [
            "schema",
            "assembly",
            "source",
            "validator",
            "evaluatedAt",
            "angularJsVex",
            "command",
            "exitStatus",
            "stdoutSha256",
            "stderrSha256",
            "containsCredentials",
            "guardStates",
            "errors",
          ]) ||
          canonicalJson(receipt?.source) !==
            canonicalJson({
              root: environment?.independence?.sourceRoot,
              revision: manifest.upstream.revision,
              tree: manifest.upstream.tree,
              fileCount: manifest.downstream.sourceInventory.fileCount,
              sourceInventorySha256:
                manifest.downstream.sourceInventory.sha256SumsSha256,
            }) ||
          canonicalJson(receipt?.validator) !==
            canonicalJson({
              path: reachabilityValidatorPath,
              sha256: validatorSha256,
              nodeVersion: manifest.downstream.buildToolchain.nodeExecutor,
            }) ||
          !Number.isInteger(evaluatedAt) ||
          !Number.isInteger(buildFinishedAt) ||
          evaluatedAt < buildFinishedAt ||
          evaluatedAt >
            Date.parse(expectedFrontendSecurityOverlay.angularJsVex.expiry) ||
          receipt?.evaluatedAt !== projected?.evaluatedAt ||
          link?.sha256 !== projected?.receiptSha256 ||
          canonicalJson(receipt?.validator) !==
            canonicalJson(index.reachability?.validator) ||
          canonicalJson(receipt?.angularJsVex) !==
            canonicalJson(index.reachability?.angularJsVex) ||
          canonicalJson(receipt?.angularJsVex) !==
            canonicalJson({
              expiresAt: expectedFrontendSecurityOverlay.angularJsVex.expiry,
              advisories:
                expectedFrontendSecurityOverlay.angularJsVex.advisories,
            }) ||
          canonicalJson(receipt?.command) !==
            canonicalJson([
              "node",
              reachabilityValidatorPath,
              environment?.independence?.sourceRoot,
            ]) ||
          receipt?.exitStatus !== 0 ||
          receipt?.stdoutSha256 !==
            sha256Bytes(
              "Portainer go-archive reachability boundary validated.\n",
            ) ||
          receipt?.stderrSha256 !== sha256Bytes("") ||
          environment?.evidence?.reachabilityRunExit?.sha256 !==
            sha256Bytes("0\n") ||
          environment?.evidence?.reachabilityRunStderr?.bytes !== 0 ||
          environment?.evidence?.reachabilityRunStderr?.sha256 !==
            receipt?.stderrSha256 ||
          environment?.evidence?.reachabilityRunStdout?.sha256 !==
            link?.sha256 ||
          receipt?.containsCredentials !== false ||
          canonicalJson(receipt?.guardStates) !==
            canonicalJson(expectedReachabilityGuardStates) ||
          !Array.isArray(receipt?.errors) ||
          receipt.errors.length !== 0 ||
          link?.sha256 !==
            index.inputs[`assembly${assembly}ReachabilityReceiptSha256`]
        ) {
          errors.push(
            `Portainer Assembly ${assembly} reachability receipt is inadmissible`,
          )
        }
        reachability.push(receipt)
      }
    }
    if (links.size !== expectedLinks.size) {
      errors.push(`Portainer Assembly ${assembly} sealed evidence links differ`)
    }
    records.push(record)
  }
  if (
    environments.length !== 2 ||
    environments[0]?.independence?.builder ===
      environments[1]?.independence?.builder ||
    environments[0]?.independence?.sourceRoot ===
      environments[1]?.independence?.sourceRoot ||
    environments[0]?.independence?.outputRoot ===
      environments[1]?.independence?.outputRoot ||
    canonicalJson(
      [
        "sourceKeySha256Sums",
        "rawOciSha256Sums",
        "rawOciFileInventory",
        "ociConfig",
        "ociIndex",
        "ociManifest",
        "ociIdentities",
        "buildxAfterCleanup",
      ].map((field) => environments[0]?.evidence?.[field]?.sha256),
    ) !==
      canonicalJson(
        [
          "sourceKeySha256Sums",
          "rawOciSha256Sums",
          "rawOciFileInventory",
          "ociConfig",
          "ociIndex",
          "ociManifest",
          "ociIdentities",
          "buildxAfterCleanup",
        ].map((field) => environments[1]?.evidence?.[field]?.sha256),
      ) ||
    environments.some(
      (environment) =>
        environment?.evidence?.founderInventoryBefore?.sha256 !==
        environment?.evidence?.founderInventoryAfter?.sha256,
    ) ||
    environments[0]?.evidence?.founderInventoryBefore?.sha256 !==
      environments[1]?.evidence?.founderInventoryBefore?.sha256 ||
    Date.parse(records[0]?.build?.finishedOn) >
      Date.parse(records[1]?.build?.startedOn)
  ) {
    errors.push(
      "Portainer Assembly A and B execution receipts are not isolated",
    )
  }
  return { records, environments, reachability, byproducts, validatorSha256 }
}

function validateSbom(errors, sbom, manifest, index) {
  if (!sbom || !index) return
  const component = sbom?.metadata?.component
  const components = sbom?.components
  const dependencies = sbom?.dependencies
  const componentRefs = Array.isArray(components)
    ? components.map((entry) => entry?.["bom-ref"])
    : []
  const rootRef =
    `container:${manifest.downstream.mirrorRepository}` +
    `@${manifest.downstream.version}`
  const expectedProperties = [
    {
      name: "llm-machines:oci-archive-sha256",
      value: manifest.downstream.artifactEvidence.ociArchiveSha256,
    },
    {
      name: "llm-machines:oci-index-digest",
      value: manifest.downstream.artifactEvidence.indexDigest,
    },
    {
      name: "llm-machines:platform-manifest-digest",
      value: manifest.downstream.artifactEvidence.manifestDigest,
    },
    {
      name: "llm-machines:config-digest",
      value: manifest.downstream.artifactEvidence.configDigest,
    },
    {
      name: "llm-machines:raw-syft-sha256",
      value: index.inputs.rawSbomSha256,
    },
  ]
  const dependencyMap = new Map(
    Array.isArray(dependencies)
      ? dependencies.map((entry) => [entry?.ref, entry])
      : [],
  )
  const reachableRefs = new Set()
  const pendingRefs = [rootRef]
  while (pendingRefs.length > 0) {
    const reference = pendingRefs.pop()
    if (reachableRefs.has(reference)) continue
    reachableRefs.add(reference)
    for (const dependency of dependencyMap.get(reference)?.dependsOn ?? []) {
      pendingRefs.push(dependency)
    }
  }
  if (
    !exactKeys(sbom, [
      "bomFormat",
      "specVersion",
      "version",
      "metadata",
      "components",
      "dependencies",
    ]) ||
    sbom.bomFormat !== "CycloneDX" ||
    !["1.6", "1.7"].includes(sbom.specVersion) ||
    sbom.version !== 1 ||
    !exactKeys(sbom.metadata, ["tools", "component"]) ||
    canonicalJson(sbom?.metadata?.tools?.components) !==
      canonicalJson([
        {
          type: "application",
          name: "syft",
          version: index.scan.syft.version,
        },
      ]) ||
    !exactKeys(component, [
      "type",
      "bom-ref",
      "name",
      "version",
      "hashes",
      "licenses",
      "properties",
    ]) ||
    component?.type !== "container" ||
    component?.["bom-ref"] !== rootRef ||
    component?.name !== "portainer-ce-downstream" ||
    component?.version !== manifest.downstream.version ||
    canonicalJson(component?.licenses) !==
      canonicalJson([{ expression: manifest.upstream.license }]) ||
    canonicalJson(component?.hashes) !==
      canonicalJson([
        {
          alg: "SHA-256",
          content: manifest.downstream.artifactEvidence.manifestDigest.slice(7),
        },
      ]) ||
    canonicalJson(component?.properties) !==
      canonicalJson(expectedProperties) ||
    !Array.isArray(components) ||
    components.length === 0 ||
    components.some(
      (entry) => !Array.isArray(entry?.licenses) || entry.licenses.length === 0,
    ) ||
    componentRefs.some(
      (reference) => typeof reference !== "string" || reference.length === 0,
    ) ||
    new Set(componentRefs).size !== componentRefs.length ||
    canonicalJson(componentRefs) !==
      canonicalJson([...componentRefs].sort(compareText)) ||
    !Array.isArray(dependencies) ||
    dependencies.length !== components.length + 1 ||
    dependencyMap.size !== dependencies.length ||
    !Array.isArray(dependencyMap.get(rootRef)?.dependsOn) ||
    canonicalJson(
      [...reachableRefs].filter((ref) => ref !== rootRef).sort(compareText),
    ) !== canonicalJson([...componentRefs].sort(compareText)) ||
    componentRefs.some((reference) => {
      const dependency = dependencyMap.get(reference)
      return (
        !dependency ||
        !Array.isArray(dependency.dependsOn) ||
        canonicalJson(dependency.dependsOn) !==
          canonicalJson([...dependency.dependsOn].sort(compareText)) ||
        dependency.dependsOn.some(
          (target) => !componentRefs.includes(target),
        ) ||
        new Set(dependency.dependsOn).size !== dependency.dependsOn.length
      )
    })
  ) {
    errors.push("CycloneDX SBOM does not bind the complete Portainer image")
  }
  if (
    /(?:portainer-(?:be|ee)|litellm-enterprise|LicenseRef-Proprietary|commercial-license|trial-license)/i.test(
      canonicalJson({ component, components }),
    )
  ) {
    errors.push("CycloneDX SBOM contains Enterprise or commercial material")
  }
}

function validateFrontendSbom(
  errors,
  sbom,
  manifest,
  index,
  runtimeBinding,
  artifactLicenseEvidence,
) {
  if (!sbom || !index || !runtimeBinding) return null
  const root = sbom?.metadata?.component
  const components = sbom?.components
  const dependencies = sbom?.dependencies
  const runtimeComponents = runtimeBinding?.runtime?.components ?? []
  const expectedRefs = runtimeComponents.map(({ bomRef }) => bomRef)
  const observedRefs = Array.isArray(components)
    ? components.map((component) => component?.["bom-ref"])
    : []
  const rootRef =
    `frontend:${manifest.downstream.mirrorRepository}` +
    `@${manifest.downstream.version}`
  const properties = new Map(
    Array.isArray(root?.properties)
      ? root.properties.map((entry) => [entry?.name, entry?.value])
      : [],
  )
  const dependenciesByRef = new Map(
    Array.isArray(dependencies)
      ? dependencies.map((entry) => [entry?.ref, entry?.dependsOn])
      : [],
  )
  const runtimeByRef = new Map(
    runtimeComponents.map((component) => [component.bomRef, component]),
  )
  const licenseByRef = new Map(
    (artifactLicenseEvidence?.components ?? [])
      .filter((component) => component?.scope === "frontend-npm")
      .map((component) => [component.bomRef, component]),
  )
  if (
    !exactKeys(sbom, [
      "bomFormat",
      "specVersion",
      "version",
      "metadata",
      "components",
      "dependencies",
    ]) ||
    sbom.bomFormat !== "CycloneDX" ||
    !["1.6", "1.7"].includes(sbom.specVersion) ||
    sbom.version !== 1 ||
    !exactKeys(sbom.metadata, ["tools", "component", "properties"]) ||
    canonicalJson(sbom?.metadata?.tools?.components) !==
      canonicalJson([
        {
          type: "application",
          name: "syft",
          version: index.frontend.scan.syft.version,
        },
      ]) ||
    canonicalJson(sbom.metadata.properties) !==
      canonicalJson([
        {
          name: "llm-machines:raw-syft-sha256",
          value: index.inputs.rawFrontendSbomSha256,
        },
      ]) ||
    !exactKeys(root, [
      "type",
      "bom-ref",
      "name",
      "version",
      "hashes",
      "licenses",
      "properties",
    ]) ||
    root.type !== "application" ||
    root["bom-ref"] !== rootRef ||
    root.name !== "portainer-ce-frontend" ||
    root.version !== manifest.downstream.version ||
    canonicalJson(root.hashes) !==
      canonicalJson([
        {
          alg: "SHA-256",
          content: runtimeBinding.runtime.inventorySha256,
        },
      ]) ||
    canonicalJson(root.licenses) !==
      canonicalJson([{ expression: manifest.upstream.license }]) ||
    properties.size !== 4 ||
    properties.get("llm-machines:oci-platform-manifest-digest") !==
      manifest.downstream.artifactEvidence.manifestDigest ||
    properties.get("llm-machines:public-inventory-sha256") !==
      runtimeBinding.runtime.inventorySha256 ||
    properties.get("llm-machines:source-inventory-sha256") !==
      manifest.downstream.sourceInventory.sha256SumsSha256 ||
    properties.get("llm-machines:source-map-inventory-sha256") !==
      runtimeBinding.runtime.sourceMapInventorySha256 ||
    !Array.isArray(components) ||
    components.length === 0 ||
    canonicalJson(observedRefs) !== canonicalJson(expectedRefs) ||
    components.some((component) => {
      const expected = runtimeByRef.get(component?.["bom-ref"])
      const licensed = licenseByRef.get(component?.["bom-ref"])
      const source = licensed?.source
      const expectedProperties = source
        ? [
            {
              name: "llm-machines:pnpm-lock-key",
              value: source.lockKey,
            },
            { name: "llm-machines:source-kind", value: source.kind },
            {
              name: "llm-machines:package-manifest-sha256",
              value: source.packageManifestSha256,
            },
            ...(source.kind === "git-tarball"
              ? [
                  {
                    name: "llm-machines:source-revision",
                    value: source.revision,
                  },
                  {
                    name: "llm-machines:source-archive-sha256",
                    value: source.archiveSha256,
                  },
                ]
              : [
                  {
                    name: "llm-machines:source-integrity",
                    value: source.integrity,
                  },
                ]),
            {
              name: "llm-machines:source-map-paths",
              value: expected?.sourceMapPaths.join(","),
            },
            {
              name: "llm-machines:source-map-source-count",
              value: String(expected?.sourcePathCount),
            },
          ].sort((left, right) => compareText(left.name, right.name))
        : null
      return (
        !expected ||
        !licensed ||
        component?.type !== "library" ||
        component?.name !== expected.name ||
        component?.version !== expected.version ||
        component?.purl !== expected.bomRef ||
        canonicalJson(component?.hashes) !==
          canonicalJson([
            { alg: "SHA-256", content: source?.packageManifestSha256 },
          ]) ||
        canonicalJson(component?.licenses) !==
          canonicalJson([
            { expression: licensed.license?.concludedExpression },
          ]) ||
        canonicalJson(component?.properties) !==
          canonicalJson(expectedProperties)
      )
    }) ||
    !Array.isArray(dependencies) ||
    dependenciesByRef.size !== expectedRefs.length + 1 ||
    canonicalJson(dependenciesByRef.get(rootRef)) !==
      canonicalJson(expectedRefs) ||
    expectedRefs.some(
      (reference) =>
        !Array.isArray(dependenciesByRef.get(reference)) ||
        dependenciesByRef
          .get(reference)
          .some((dependency) => !runtimeByRef.has(dependency)),
    )
  ) {
    errors.push(
      "Portainer frontend CycloneDX SBOM does not bind the shipped npm inventory",
    )
  }
  return { rootRef, componentRefs: new Set(observedRefs) }
}

function validateCombinedFrontendSbom(errors, sbom, frontendSbom) {
  if (!sbom || !frontendSbom) return
  const combined = new Map(
    (sbom.components ?? []).map((component) => [
      component?.["bom-ref"],
      component,
    ]),
  )
  const frontendComponents = [
    frontendSbom.metadata.component,
    ...frontendSbom.components,
  ]
  const rootRef = sbom?.metadata?.component?.["bom-ref"]
  const rootDependency = (sbom.dependencies ?? []).find(
    (entry) => entry?.ref === rootRef,
  )
  if (
    frontendComponents.some(
      (component) =>
        canonicalJson(combined.get(component["bom-ref"])) !==
          canonicalJson(component) ||
        !Array.isArray(component.licenses) ||
        component.licenses.length === 0,
    ) ||
    !rootDependency?.dependsOn?.includes(
      frontendSbom.metadata.component["bom-ref"],
    )
  ) {
    errors.push(
      "Combined Portainer SBOM omits or alters the shipped frontend inventory",
    )
  }
}

function expectedResolvedDependencies(manifest, artifactLicenseEvidence) {
  const frontendSources = (artifactLicenseEvidence?.components ?? [])
    .filter((component) => component?.scope === "frontend-npm")
    .map(({ source }) => ({
      uri:
        source.kind === "git-tarball"
          ? source.tarballUrl
          : `npm:${source.lockKey}`,
      digest: { sha256: source.archiveSha256 },
    }))
  return [
    {
      uri: manifest.upstream.archiveUrl,
      digest: { sha256: manifest.upstream.archiveSha256 },
    },
    ...[
      manifest.downstream.patch,
      manifest.downstream.dockerfile,
      manifest.downstream.dockerignore,
      manifest.downstream.evidenceTooling.assemblySealer,
      manifest.downstream.evidenceTooling.reachabilityReceiptGenerator,
    ].map(({ path: file, sha256 }) => ({
      uri: `file:${file}`,
      digest: { sha256 },
    })),
    ...manifest.downstream.buildInputs.map((input) => ({
      uri: `oci:${input.repository}@${input.platformDigest}`,
      digest: { sha256: input.platformDigest.slice(7) },
    })),
    {
      uri: manifest.downstream.pnpm.tarballUrl,
      digest: { sha256: manifest.downstream.pnpm.tarballSha256 },
    },
    {
      uri:
        `oci:${manifest.downstream.buildToolchain.buildkit.repository}` +
        `@${manifest.downstream.buildToolchain.buildkit.platformDigest}`,
      digest: {
        sha256:
          manifest.downstream.buildToolchain.buildkit.platformDigest.slice(7),
      },
    },
    ...frontendSources,
  ].sort((left, right) => compareText(left.uri, right.uri))
}

function validateProvenance(
  errors,
  provenance,
  manifest,
  index,
  runtimeBinding,
  artifactLicenseEvidence,
  assemblyReceipts,
) {
  if (!provenance || !index) return
  const definition = provenance?.predicate?.buildDefinition
  const details = provenance?.predicate?.runDetails
  const started = Date.parse(details?.metadata?.startedOn)
  const finished = Date.parse(details?.metadata?.finishedOn)
  const byproducts = details?.byproducts
  const byproductNames = Array.isArray(byproducts)
    ? byproducts.map(({ name }) => name)
    : []
  const expectedByproducts = assemblyReceipts
    ? [...assemblyReceipts.byproducts]
        .map(([name, sha256]) => ({ name, digest: { sha256 } }))
        .sort((left, right) => compareText(left.name, right.name))
    : []
  if (
    !exactKeys(provenance, [
      "_type",
      "subject",
      "predicateType",
      "predicate",
    ]) ||
    provenance._type !== "https://in-toto.io/Statement/v1" ||
    provenance.predicateType !== "https://slsa.dev/provenance/v1" ||
    canonicalJson(provenance.subject) !==
      canonicalJson([
        {
          name: manifest.downstream.mirrorRepository,
          digest: {
            sha256:
              manifest.downstream.artifactEvidence.manifestDigest.slice(7),
          },
        },
      ]) ||
    !exactKeys(provenance.predicate, ["buildDefinition", "runDetails"]) ||
    !exactKeys(definition, [
      "buildType",
      "externalParameters",
      "internalParameters",
      "resolvedDependencies",
    ]) ||
    definition?.buildType !==
      "https://llm-machines.invalid/build-types/portainer-ce-downstream/v1" ||
    canonicalJson(definition?.externalParameters) !==
      canonicalJson({
        sourceRevision: manifest.upstream.revision,
        sourceTree: manifest.upstream.tree,
        sourceArchiveSha256: manifest.upstream.archiveSha256,
        sourceInventorySha256:
          manifest.downstream.sourceInventory.sha256SumsSha256,
        dockerfileSha256: manifest.downstream.dockerfile.sha256,
        dockerignoreSha256: manifest.downstream.dockerignore.sha256,
        patchSha256: manifest.downstream.patch.sha256,
        platform: "linux/amd64",
        frontendPackageJsonSha256: runtimeBinding?.source?.packageJsonSha256,
        frontendPnpmLockSha256: runtimeBinding?.source?.pnpmLockSha256,
        frontendWebpackProductionSha256:
          runtimeBinding?.source?.webpackProductionSha256,
        frontendWebpackCommonSha256:
          runtimeBinding?.source?.webpackCommonSha256,
        frontendPublicInventorySha256: runtimeBinding?.runtime?.inventorySha256,
        frontendSourceMapInventorySha256:
          runtimeBinding?.runtime?.sourceMapInventorySha256,
      }) ||
    canonicalJson(definition?.internalParameters) !==
      canonicalJson({
        sourceDateEpoch: manifest.upstream.sourceDateEpoch,
        noCache: true,
        provenanceExporter: false,
        sbomExporter: false,
        rewriteTimestamp: true,
      }) ||
    canonicalJson(definition?.resolvedDependencies) !==
      canonicalJson(
        expectedResolvedDependencies(manifest, artifactLicenseEvidence),
      ) ||
    !exactKeys(details, ["builder", "metadata", "byproducts"]) ||
    canonicalJson(details?.builder) !==
      canonicalJson({
        id: "https://llm-machines.invalid/build-actors/portainer-ce-admission",
      }) ||
    !exactKeys(details?.metadata, [
      "invocationId",
      "startedOn",
      "finishedOn",
      "completeness",
      "reproducible",
    ]) ||
    details?.metadata?.invocationId !==
      `sha256:${sha256Bytes(canonicalJson(index.inputs))}` ||
    canonicalJson(details?.metadata?.completeness) !==
      canonicalJson({ parameters: true, environment: true, materials: true }) ||
    details?.metadata?.reproducible !== true ||
    !Number.isInteger(started) ||
    !Number.isInteger(finished) ||
    started > finished ||
    !Array.isArray(byproducts) ||
    expectedByproducts.length !== 6 ||
    canonicalJson(byproducts) !== canonicalJson(expectedByproducts) ||
    new Set(byproductNames).size !== byproductNames.length
  ) {
    errors.push(
      "SLSA provenance does not bind exact source, recipe, dependencies, and output",
    )
  }
}

function trivySortKey(result) {
  return [result?.Target, result?.Class, result?.Type]
    .map((value) => String(value ?? ""))
    .join("\u0000")
}

function validateFrontendTrivy(errors, trivy, manifest, index, runtimeBinding) {
  if (!trivy || !index || !runtimeBinding) return null
  const llmm = trivy?.LLMMEvidence
  const projection = llmm?.runtimeProjection
  const packages = projection?.packages
  const vulnerabilities = projection?.vulnerabilities
  const expectedComponents = runtimeBinding.runtime.components
  const expectedByRef = new Map(
    expectedComponents.map((component) => [component.bomRef, component]),
  )
  const pnpmResults = (trivy?.Results ?? []).filter(
    (result) => result?.Class === "lang-pkgs" && result?.Type === "pnpm",
  )
  const rawPnpm = pnpmResults[0]
  const runtimeKeys = new Set(
    expectedComponents.map(
      (component) => `${component.name}\u0000${component.version}`,
    ),
  )
  const expectedVulnerabilities = (rawPnpm?.Vulnerabilities ?? [])
    .filter((finding) =>
      runtimeKeys.has(`${finding?.PkgName}\u0000${finding?.InstalledVersion}`),
    )
    .sort((left, right) =>
      compareText(canonicalJson(left), canonicalJson(right)),
    )
  const expectedCounts = Object.fromEntries(
    ["UNKNOWN", "LOW", "MEDIUM", "HIGH", "CRITICAL"].map((severity) => [
      severity,
      Array.isArray(vulnerabilities)
        ? vulnerabilities.filter((finding) => finding?.Severity === severity)
            .length
        : 0,
    ]),
  )
  const resultKeys = Array.isArray(trivy?.Results)
    ? trivy.Results.map(trivySortKey)
    : []
  if (
    !exactKeys(trivy, [
      "SchemaVersion",
      "ArtifactName",
      "ArtifactType",
      "Results",
      "LLMMEvidence",
    ]) ||
    trivy.SchemaVersion !== 2 ||
    trivy.ArtifactName !==
      `${manifest.upstream.repository}@${manifest.upstream.revision}` ||
    trivy.ArtifactType !== "filesystem" ||
    !Array.isArray(trivy.Results) ||
    trivy.Results.length === 0 ||
    pnpmResults.length !== 1 ||
    !Array.isArray(rawPnpm?.Packages) ||
    canonicalJson(resultKeys) !==
      canonicalJson([...resultKeys].sort(compareText)) ||
    !exactKeys(llmm, [
      "sourceRevision",
      "sourceTree",
      "sourceInventorySha256",
      "artifactManifestDigest",
      "publicInventorySha256",
      "sourceMapInventorySha256",
      "rawReportSha256",
      "scanner",
      "database",
      "scannedAt",
      "runtimeProjection",
    ]) ||
    llmm.sourceRevision !== manifest.upstream.revision ||
    llmm.sourceTree !== manifest.upstream.tree ||
    llmm.sourceInventorySha256 !==
      manifest.downstream.sourceInventory.sha256SumsSha256 ||
    llmm.artifactManifestDigest !==
      manifest.downstream.artifactEvidence.manifestDigest ||
    llmm.publicInventorySha256 !== runtimeBinding.runtime.inventorySha256 ||
    llmm.sourceMapInventorySha256 !==
      runtimeBinding.runtime.sourceMapInventorySha256 ||
    llmm.rawReportSha256 !== index.inputs.rawFrontendTrivySha256 ||
    canonicalJson(llmm.scanner) !==
      canonicalJson({
        name: "trivy",
        version: index.frontend.scan.trivy.version,
        toolImageDigest: index.frontend.scan.trivy.toolImageDigest,
      }) ||
    canonicalJson(llmm.database) !==
      canonicalJson({
        updatedAt: index.frontend.scan.trivy.databaseUpdatedAt,
        sha256: index.frontend.scan.trivy.databaseSha256,
      }) ||
    llmm.scannedAt !== index.frontend.scan.scannedAt ||
    !exactKeys(projection, [
      "packageCount",
      "packages",
      "vulnerabilityCount",
      "severityCounts",
      "vulnerabilities",
    ]) ||
    !Array.isArray(packages) ||
    packages.length !== expectedComponents.length ||
    packages.some((entry) => {
      const expected = expectedByRef.get(entry?.bomRef)
      return (
        !exactKeys(entry, [
          "bomRef",
          "name",
          "version",
          "purl",
          "lockKey",
          "rawPackages",
        ]) ||
        !expected ||
        entry.name !== expected.name ||
        entry.version !== expected.version ||
        entry.purl !== expected.bomRef ||
        entry.lockKey !== expected.lockKey ||
        !Array.isArray(entry.rawPackages) ||
        entry.rawPackages.length === 0 ||
        entry.rawPackages.some(
          (rawPackage) =>
            rawPackage?.Name !== expected.name ||
            rawPackage?.Version !== expected.version,
        ) ||
        canonicalJson(entry.rawPackages) !==
          canonicalJson(
            (rawPnpm.Packages ?? [])
              .filter(
                (rawPackage) =>
                  rawPackage?.Name === expected.name &&
                  rawPackage?.Version === expected.version,
              )
              .sort((left, right) =>
                compareText(canonicalJson(left), canonicalJson(right)),
              ),
          )
      )
    }) ||
    canonicalJson(packages.map(({ bomRef }) => bomRef)) !==
      canonicalJson(expectedComponents.map(({ bomRef }) => bomRef)) ||
    projection.packageCount !== packages.length ||
    !Array.isArray(vulnerabilities) ||
    canonicalJson(vulnerabilities) !== canonicalJson(expectedVulnerabilities) ||
    projection.vulnerabilityCount !== vulnerabilities.length ||
    canonicalJson(projection.severityCounts) !== canonicalJson(expectedCounts)
  ) {
    errors.push(
      "Portainer frontend Trivy evidence does not bind the shipped npm inventory",
    )
  }
  return {
    vulnerabilities: Array.isArray(vulnerabilities) ? vulnerabilities : [],
    severityCounts: expectedCounts,
  }
}

function validateTrivy(errors, trivy, manifest, index) {
  if (!trivy || !index) return
  const metadata = trivy?.Metadata
  const diffIds = metadata?.DiffIDs
  const expectedLlmm = {
    rawReportSha256: index.inputs.rawTrivySha256,
    scanner: {
      name: "trivy",
      version: index.scan.trivy.version,
      toolImageDigest: index.scan.trivy.toolImageDigest,
    },
    database: {
      updatedAt: index.scan.trivy.databaseUpdatedAt,
      sha256: index.scan.trivy.databaseSha256,
    },
    scannedAt: index.scan.scannedAt,
  }
  const resultKeys = Array.isArray(trivy?.Results)
    ? trivy.Results.map(trivySortKey)
    : []
  const nestedEvidenceSorted = (trivy?.Results ?? []).every((result) =>
    ["Vulnerabilities", "Misconfigurations", "Secrets"].every((field) => {
      const entries = result?.[field]
      return (
        !Array.isArray(entries) ||
        canonicalJson(entries) ===
          canonicalJson(
            [...entries].sort((left, right) =>
              compareText(canonicalJson(left), canonicalJson(right)),
            ),
          )
      )
    }),
  )
  if (
    !exactKeys(trivy, [
      "SchemaVersion",
      "ArtifactName",
      "ArtifactType",
      "Metadata",
      "Results",
    ]) ||
    trivy.SchemaVersion !== 2 ||
    trivy.ArtifactName !== manifest.downstream.mirrorRepository ||
    trivy.ArtifactType !== "container_image" ||
    metadata?.ImageID !== manifest.downstream.artifactEvidence.configDigest ||
    canonicalJson(metadata?.RepoTags) !== "[]" ||
    canonicalJson(metadata?.RepoDigests) !==
      canonicalJson([
        `${manifest.downstream.mirrorRepository}@${manifest.downstream.artifactEvidence.manifestDigest}`,
      ]) ||
    metadata?.ImageConfig?.architecture !== "amd64" ||
    metadata?.ImageConfig?.os !== "linux" ||
    metadata?.ImageConfig?.digest !==
      manifest.downstream.artifactEvidence.manifestDigest ||
    !Array.isArray(diffIds) ||
    diffIds.length !==
      (manifest.downstream.artifactEvidence.layerDigests ?? []).length ||
    diffIds.some((digest) => !ociDigestPattern.test(digest)) ||
    canonicalJson(metadata?.LLMMEvidence) !== canonicalJson(expectedLlmm) ||
    !Array.isArray(trivy.Results) ||
    trivy.Results.length === 0 ||
    canonicalJson(resultKeys) !==
      canonicalJson([...resultKeys].sort(compareText)) ||
    !nestedEvidenceSorted
  ) {
    errors.push("Trivy report does not bind the exact image and scan metadata")
  }
}

function parseCanonicalJsonl(errors, input, label) {
  if (typeof input !== "string" || !input.endsWith("\n")) {
    errors.push(`${label} is not canonical newline-terminated JSONL`)
    return []
  }
  const documents = []
  for (const [index, line] of input.slice(0, -1).split("\n").entries()) {
    if (line.length === 0) {
      errors.push(`${label} contains an empty JSONL record`)
      continue
    }
    try {
      const document = JSON.parse(line)
      if (
        !document ||
        typeof document !== "object" ||
        Array.isArray(document) ||
        canonicalJson(document) !== line
      ) {
        errors.push(`${label} record ${index + 1} is not canonical JSON`)
      }
      documents.push(document)
    } catch {
      errors.push(`${label} record ${index + 1} is invalid JSON`)
    }
  }
  return documents
}

function validateGovulncheck(
  errors,
  input,
  label,
  mode,
  index,
  matrixIdentities,
) {
  if (!input || !index) return null
  const documents = parseCanonicalJsonl(errors, input, label)
  const allowedRecords = new Set([
    "config",
    "sbom",
    "SBOM",
    "progress",
    "osv",
    "finding",
    "error",
  ])
  const configs = documents.filter((document) => document?.config)
  const sboms = documents
    .filter(
      (document) =>
        (document?.sbom !== undefined) !== (document?.SBOM !== undefined),
    )
    .map((document) => document.sbom ?? document.SBOM)
  const osvs = documents
    .filter((document) => document?.osv)
    .map(({ osv }) => osv)
  const findings = documents
    .filter((document) => document?.finding)
    .map(({ finding }) => finding)
  const config = configs[0]?.config
  const databaseUpdatedAt = Date.parse(config?.db_last_modified)
  const scannedAt = Date.parse(index.scan.scannedAt)
  const osvById = new Map()
  let conflictingOsv = false
  for (const osv of osvs) {
    const canonical = canonicalJson(osv)
    if (osvById.has(osv?.id) && osvById.get(osv.id) !== canonical) {
      conflictingOsv = true
    } else {
      osvById.set(osv?.id, canonical)
    }
  }
  const osvIds = [...osvById.keys()]
  const reachable = new Set(
    findings
      .filter((finding) =>
        (finding?.trace ?? []).some(
          (frame) =>
            typeof frame?.function === "string" && frame.function.length > 0,
        ),
      )
      .map(({ osv }) => osv),
  )
  const reachableModules = new Set(
    findings
      .filter((finding) => reachable.has(finding.osv))
      .map((finding) => finding?.trace?.[0]?.module)
      .filter(Boolean),
  )
  if (
    documents.length === 0 ||
    documents.some((document) => {
      const keys = Object.keys(document)
      return keys.length !== 1 || !allowedRecords.has(keys[0])
    }) ||
    configs.length !== 1 ||
    documents.some((document) => Object.hasOwn(document, "error")) ||
    config?.protocol_version !== "v1.0.0" ||
    config?.scanner_name !== "govulncheck" ||
    config?.scanner_version !== `v${index.scan.govulncheck.version}` ||
    config?.scan_level !== "symbol" ||
    config?.scan_mode !== mode ||
    config?.db !== "https://vuln.go.dev" ||
    (mode === "source" && config?.go_version !== "go1.25.13") ||
    !Number.isInteger(databaseUpdatedAt) ||
    scannedAt < databaseUpdatedAt ||
    scannedAt - databaseUpdatedAt > 72 * 60 * 60 * 1000 ||
    sboms.length === 0 ||
    sboms.some(
      (sbom) =>
        sbom?.go_version !== "go1.25.13" ||
        !Array.isArray(sbom?.modules) ||
        sbom.modules.length === 0,
    ) ||
    osvs.length === 0 ||
    conflictingOsv ||
    osvIds.some((id) => !/^GO-\d{4}-\d+$/.test(id ?? "")) ||
    findings.length === 0 ||
    findings.some(
      (finding) =>
        !osvIds.includes(finding?.osv) ||
        !matrixIdentities.has(finding?.osv) ||
        !Array.isArray(finding?.trace) ||
        finding.trace.length === 0 ||
        finding.trace.some(
          (frame) =>
            typeof frame?.module !== "string" || frame.module.length === 0,
        ),
    )
  ) {
    errors.push(`${label} is not admissible symbol-level govulncheck evidence`)
  }
  return {
    databaseUpdatedAt: config?.db_last_modified,
    osvIds: new Set(osvIds),
    findingIds: new Set(findings.map(({ osv }) => osv)),
    reachableCount: reachable.size,
    reachableModuleCount: reachableModules.size,
  }
}

function vulnerabilityCounts(trivy) {
  const counts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, UNKNOWN: 0 }
  for (const result of trivy?.Results ?? []) {
    for (const finding of result?.Vulnerabilities ?? []) {
      const severity = String(finding?.Severity ?? "UNKNOWN").toUpperCase()
      counts[severity] = (counts[severity] ?? 0) + 1
    }
  }
  return counts
}

function matrixIdentityMap(errors, matrix) {
  const identities = new Map()
  for (const finding of matrix?.findings ?? []) {
    const id = finding?.advisory?.id ?? "unknown"
    for (const identity of [id, ...(finding?.advisory?.aliases ?? [])]) {
      const observations = identities.get(identity) ?? []
      if (
        observations.some(
          (entry) =>
            entry?.advisory?.id === id &&
            entry?.component?.name === finding?.component?.name &&
            entry?.component?.installed === finding?.component?.installed,
        )
      ) {
        errors.push(`security finding identity is duplicated: ${identity}`)
      } else {
        observations.push(finding)
        identities.set(identity, observations)
      }
    }
  }
  return identities
}

function matrixFindingForScannerObservation(identities, vulnerability) {
  return (identities.get(vulnerability?.VulnerabilityID) ?? []).find(
    (finding) => scannerFindingMatchesMatrix(finding, vulnerability),
  )
}

function securityFindingShapeIsValid(finding) {
  const aliases = finding?.advisory?.aliases
  const controls = finding?.disposition?.controls
  const reviewTriggers = finding?.disposition?.reviewTriggers
  return (
    exactKeys(finding, [
      "advisory",
      "severity",
      "component",
      "evidence",
      "exposure",
      "impact",
      "disposition",
    ]) &&
    exactKeys(finding.advisory, ["id", "aliases"]) &&
    typeof finding.advisory.id === "string" &&
    finding.advisory.id.length > 0 &&
    Array.isArray(aliases) &&
    aliases.every((alias) => typeof alias === "string" && alias.length > 0) &&
    new Set(aliases).size === aliases.length &&
    canonicalJson(aliases) === canonicalJson([...aliases].sort(compareText)) &&
    ["CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN"].includes(
      finding.severity,
    ) &&
    exactKeys(finding.component, ["name", "installed", "fixed"]) &&
    typeof finding.component.name === "string" &&
    finding.component.name.length > 0 &&
    typeof finding.component.installed === "string" &&
    finding.component.installed.length > 0 &&
    (finding.component.fixed === null ||
      (typeof finding.component.fixed === "string" &&
        finding.component.fixed.length > 0)) &&
    exactKeys(finding.evidence, ["class", "callPath", "sourceInference"]) &&
    typeof finding.evidence.class === "string" &&
    finding.evidence.class.length > 0 &&
    typeof finding.evidence.callPath === "string" &&
    finding.evidence.callPath.length > 0 &&
    typeof finding.evidence.sourceInference === "boolean" &&
    exactKeys(finding.exposure, [
      "anonymous",
      "operator",
      "admin",
      "exploitPreconditions",
    ]) &&
    [
      finding.exposure.anonymous,
      finding.exposure.operator,
      finding.exposure.admin,
      finding.exposure.exploitPreconditions,
      finding.impact,
    ].every((value) => typeof value === "string" && value.length > 0) &&
    exactKeys(finding.disposition, [
      "status",
      "controls",
      "owner",
      "expiry",
      "reviewTriggers",
    ]) &&
    typeof finding.disposition.status === "string" &&
    Array.isArray(controls) &&
    controls.length > 0 &&
    controls.every((value) => typeof value === "string" && value.length > 0) &&
    new Set(controls).size === controls.length &&
    typeof finding.disposition.owner === "string" &&
    finding.disposition.owner.length > 0 &&
    (finding.disposition.expiry === null ||
      Number.isInteger(Date.parse(finding.disposition.expiry))) &&
    Array.isArray(reviewTriggers) &&
    reviewTriggers.length > 0 &&
    reviewTriggers.every(
      (value) => typeof value === "string" && value.length > 0,
    ) &&
    new Set(reviewTriggers).size === reviewTriggers.length
  )
}

function scannerFindingMatchesMatrix(finding, vulnerability) {
  const fixedVersion = vulnerability?.FixedVersion || null
  return (
    finding?.severity ===
      String(vulnerability?.Severity ?? "UNKNOWN").toUpperCase() &&
    finding?.component?.name === vulnerability?.PkgName &&
    finding?.component?.installed === vulnerability?.InstalledVersion &&
    finding?.component?.fixed === fixedVersion
  )
}

function findingIdentities(finding) {
  return [finding?.advisory?.id, ...(finding?.advisory?.aliases ?? [])].filter(
    (identity) => typeof identity === "string" && identity.length > 0,
  )
}

function versionAtLeast(chosen, fixed) {
  const parse = (value) => {
    const match = String(value ?? "").match(/^v?(?:go)?(\d+)\.(\d+)\.(\d+)$/)
    return match ? match.slice(1).map(Number) : null
  }
  const left = parse(chosen)
  const right = parse(fixed)
  if (!left || !right) return false
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] > right[index]
  }
  return true
}

function admittedDownstreamVersion(manifest, componentName) {
  return {
    stdlib: `go${manifest.downstream.securityOverlay.go}`,
    "golang.org/x/mod": `v${manifest.downstream.securityOverlay["golang.org/x/mod"]}`,
    axios: manifest.downstream.frontendSecurityOverlay.directDependencies.axios,
    "js-yaml":
      manifest.downstream.frontendSecurityOverlay.directDependencies["js-yaml"],
    "linkify-it":
      manifest.downstream.frontendSecurityOverlay.overrides["linkify-it"],
    lodash:
      manifest.downstream.frontendSecurityOverlay.directDependencies.lodash,
    "lodash-es": "4.18.1",
    nanoid: manifest.downstream.frontendSecurityOverlay.overrides.nanoid,
    postcss:
      manifest.downstream.frontendSecurityOverlay.directDependencies.postcss,
  }[componentName]
}

function historicalRemediationIsAdmissible(
  finding,
  { manifest, reportedFindingIds },
) {
  const id = finding?.advisory?.id
  const admittedVersion = admittedDownstreamVersion(
    manifest,
    finding?.component?.name,
  )
  return (
    securityFindingShapeIsValid(finding) &&
    Object.hasOwn(expectedHistoricalRemediationIdentities, id) &&
    canonicalJson(finding?.advisory?.aliases) ===
      canonicalJson(expectedHistoricalRemediationIdentities[id]) &&
    finding?.disposition?.status === "REMEDIATED_DOWNSTREAM" &&
    !findingIdentities(finding).some((identity) =>
      reportedFindingIds.has(identity),
    ) &&
    admittedVersion !== undefined &&
    versionAtLeast(admittedVersion, finding?.component?.fixed) &&
    finding?.component?.installed !== admittedVersion
  )
}

function securityDispositionIsAdmissible(
  finding,
  {
    now,
    assemblyReceipts,
    reportedFindingIds,
    runtimeScanIds,
    frontendScanIds,
  },
) {
  const id = finding?.advisory?.id
  const status = finding?.disposition?.status
  const component = finding?.component
  const evidence = finding?.evidence
  const exposure = finding?.exposure
  const isReported = findingIdentities(finding).some((identity) =>
    reportedFindingIds.has(identity),
  )
  const expiresInFuture =
    Number.isInteger(Date.parse(finding?.disposition?.expiry)) &&
    Date.parse(finding.disposition.expiry) > now.getTime()
  const reachabilityGuards = assemblyReceipts?.reachability ?? []
  const guardsHold = (guards) =>
    reachabilityGuards.length === 2 &&
    reachabilityGuards.every((receipt) =>
      guards.every((guard) => receipt?.guardStates?.[guard] === true),
    )
  if (status === "NOT_APPLICABLE_LINUX_AMD64") {
    return (
      isReported &&
      id === "CVE-2025-15558" &&
      evidence?.class === "NOT_APPLICABLE_PLATFORM" &&
      exposure?.anonymous === "NONE" &&
      exposure?.operator === "NONE" &&
      exposure?.admin === "NONE_ON_LINUX_AMD64"
    )
  }
  if (status === "NOT_REACHABLE_TIME_BOUND_GUARD") {
    if (!expiresInFuture || !isReported) return false
    if (id === "CVE-2026-17106") {
      return (
        component?.name === "github.com/moby/go-archive" &&
        component?.installed === "v0.1.0" &&
        component?.fixed === "0.3.0" &&
        evidence?.class === "NOT_REACHABLE_GUARDED" &&
        canonicalJson(finding?.disposition?.controls) ===
          canonicalJson(expectedGoArchiveVex.controls) &&
        finding?.disposition?.owner === expectedGoArchiveVex.owner &&
        finding?.disposition?.expiry === expectedGoArchiveVex.expiry &&
        canonicalJson(finding?.disposition?.reviewTriggers) ===
          canonicalJson(expectedGoArchiveVex.reviewTriggers) &&
        findingIdentities(finding).some((identity) =>
          runtimeScanIds.has(identity),
        ) &&
        guardsHold([
          "GO_ARCHIVE_DIRECT_IMPORT_ABSENT",
          "COMPOSE_COPY_ABSENT",
          "VULNERABLE_ARCHIVE_CALLS_ABSENT",
          "EXPECTED_COMPOSE_METHOD_SET_EXACT",
        ])
      )
    }
    return (
      ["CVE-2024-21490", "CVE-2026-11998"].includes(id) &&
      component?.name === "angular" &&
      component?.installed === "1.8.2" &&
      component?.fixed === null &&
      evidence?.class === "NOT_REACHABLE_GUARDED" &&
      findingIdentities(finding).some((identity) =>
        frontendScanIds.has(identity),
      ) &&
      findingIdentities(finding).every(
        (identity) => !runtimeScanIds.has(identity),
      ) &&
      guardsHold(expectedFrontendSecurityOverlay.angularJsVex.guards)
    )
  }
  if (status === "EXTERNAL_RUNTIME_ACTIVATION_PRECONDITION") {
    return (
      isReported &&
      ["github.com/moby/buildkit", "github.com/docker/docker"].includes(
        component?.name,
      ) &&
      evidence?.class === "EXTERNAL_RUNTIME" &&
      exposure?.anonymous === "DENIED" &&
      exposure?.operator === "DENIED" &&
      typeof exposure?.admin === "string" &&
      exposure.admin.startsWith("CAN_")
    )
  }
  if (status === "NOT_REACHABLE_IN_PORTAINER_PROCESS") {
    return (
      isReported &&
      component?.name === "github.com/containerd/containerd" &&
      evidence?.class === "NOT_REACHABLE_SERVER_PATH" &&
      exposure?.anonymous === "NONE" &&
      exposure?.operator === "NONE" &&
      exposure?.admin === "NONE_IN_DOCKER_ONLY_PROFILE"
    )
  }
  if (status === "TIME_BOUND_COMPENSATING_CONTROL") {
    return (
      isReported &&
      expiresInFuture &&
      id === "CVE-2025-47909" &&
      finding?.severity === "MEDIUM" &&
      component?.name === "github.com/gorilla/csrf" &&
      evidence?.class === "PROVEN_SOURCE_CALL_PATH"
    )
  }
  if (status === "TIME_BOUND_FRONTEND_COMPENSATING_CONTROL") {
    return (
      isReported &&
      expiresInFuture &&
      ["LOW", "MEDIUM"].includes(finding?.severity) &&
      findingIdentities(finding).some((identity) =>
        frontendScanIds.has(identity),
      ) &&
      findingIdentities(finding).every(
        (identity) => !runtimeScanIds.has(identity),
      ) &&
      evidence?.class === expectedFrontendCompensatingControl.evidenceClass &&
      evidence?.sourceInference === false &&
      exposure?.anonymous ===
        expectedFrontendCompensatingControl.exposure.anonymous &&
      exposure?.operator ===
        expectedFrontendCompensatingControl.exposure.operator &&
      exposure?.admin === expectedFrontendCompensatingControl.exposure.admin &&
      canonicalJson(finding?.disposition?.controls) ===
        canonicalJson(expectedFrontendCompensatingControl.controls) &&
      finding?.disposition?.owner ===
        expectedFrontendCompensatingControl.owner &&
      finding?.disposition?.expiry ===
        expectedFrontendCompensatingControl.expiry &&
      canonicalJson(finding?.disposition?.reviewTriggers) ===
        canonicalJson(expectedFrontendCompensatingControl.reviewTriggers)
    )
  }
  if (status === "TIME_BOUND_OUTSIDE_SUPPORTED_PROFILE") {
    return (
      isReported &&
      expiresInFuture &&
      id === "GO-2026-5932" &&
      finding?.severity === "UNKNOWN" &&
      component?.name === "golang.org/x/crypto" &&
      evidence?.class === "PROVEN_SOURCE_CALL_PATH_OUTSIDE_ADMITTED_PROFILE"
    )
  }
  return false
}

function validateMisconfigurationEvidence(
  errors,
  report,
  matrix,
  manifest,
  trivy,
) {
  if (!report || !matrix || !manifest || !trivy) return
  const result = report?.Results?.[0]
  const observations = result?.Misconfigurations ?? []
  const expectedObservations = [
    {
      Type: "Dockerfile Security Check",
      ID: "DS-0002",
      Title: "Image user should not be 'root'",
      Description:
        "Running containers with 'root' user can lead to a container escape situation. It is a best practice to run containers as non-root users, which can be done by adding a 'USER' statement to the Dockerfile.",
      Message:
        "Specify at least 1 USER command in Dockerfile with non-root user as argument",
      Namespace: "builtin.dockerfile.DS002",
      Query: "data.builtin.dockerfile.DS002.deny",
      Resolution: "Add 'USER <non root user name>' line to the Dockerfile",
      Severity: "HIGH",
      PrimaryURL: "https://avd.aquasec.com/misconfig/ds-0002",
      References: [
        "https://docs.docker.com/develop/develop-images/dockerfile_best-practices/",
        "https://avd.aquasec.com/misconfig/ds-0002",
      ],
      Status: "FAIL",
      CauseMetadata: { Provider: "Dockerfile", Service: "general" },
    },
    {
      Type: "Dockerfile Security Check",
      ID: "DS-0026",
      Title: "No HEALTHCHECK defined",
      Description:
        "You should add HEALTHCHECK instruction in your docker container images to perform the health check on running containers.",
      Message: "Add HEALTHCHECK instruction in your Dockerfile",
      Namespace: "builtin.dockerfile.DS026",
      Query: "data.builtin.dockerfile.DS026.deny",
      Resolution: "Add HEALTHCHECK instruction in Dockerfile",
      Severity: "LOW",
      PrimaryURL: "https://avd.aquasec.com/misconfig/ds-0026",
      References: [
        "https://blog.aquasec.com/docker-security-best-practices",
        "https://avd.aquasec.com/misconfig/ds-0026",
      ],
      Status: "FAIL",
      CauseMetadata: { Provider: "Dockerfile", Service: "general" },
    },
  ]
  const imageConfig = trivy?.Metadata?.ImageConfig?.config ?? {}
  const configuredUser =
    typeof imageConfig.User === "string" ? imageConfig.User : ""
  const effectiveUser = ["", "0", "root"].includes(configuredUser)
    ? "root"
    : configuredUser
  const healthcheck = imageConfig.Healthcheck
  const healthcheckPresent = Boolean(
    healthcheck &&
      Array.isArray(healthcheck.Test) &&
      healthcheck.Test.length > 0 &&
      healthcheck.Test[0] !== "NONE",
  )
  const evidence = matrix?.evidence?.misconfiguration
  const expectedMatrixEvidence = {
    ...expectedMisconfigurationEvidence,
    target: {
      path: manifest.downstream.dockerfile.path,
      sha256: manifest.downstream.dockerfile.sha256,
    },
    artifact: {
      manifestDigest: manifest.downstream.artifactEvidence.manifestDigest,
      configDigest: manifest.downstream.artifactEvidence.configDigest,
      configuredUser,
      effectiveUser,
      healthcheckPresent,
    },
  }
  const severityCounts = observations.reduce(
    (counts, observation) => {
      const severity = String(observation?.Severity ?? "UNKNOWN").toLowerCase()
      counts[severity] = (counts[severity] ?? 0) + 1
      return counts
    },
    { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 },
  )
  if (
    !exactKeys(report, [
      "SchemaVersion",
      "Trivy",
      "ReportID",
      "CreatedAt",
      "ArtifactName",
      "ArtifactType",
      "Results",
    ]) ||
    report.SchemaVersion !== 2 ||
    !exactKeys(report.Trivy, ["Version"]) ||
    report.Trivy.Version !== expectedMisconfigurationEvidence.version ||
    !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(
      report.ReportID ?? "",
    ) ||
    report.CreatedAt !== expectedMisconfigurationEvidence.scannedAt ||
    report.ArtifactName !== manifest.downstream.dockerfile.path ||
    report.ArtifactType !== "filesystem" ||
    !Array.isArray(report.Results) ||
    report.Results.length !== 1 ||
    !exactKeys(result, [
      "Target",
      "Class",
      "Type",
      "MisconfSummary",
      "Misconfigurations",
    ]) ||
    result.Target !== "Dockerfile" ||
    result.Class !== "config" ||
    result.Type !== "dockerfile" ||
    !exactKeys(result.MisconfSummary, ["Successes", "Failures"]) ||
    result.MisconfSummary.Successes !== 25 ||
    result.MisconfSummary.Failures !== 2 ||
    canonicalJson(observations) !== canonicalJson(expectedObservations) ||
    canonicalJson(severityCounts) !==
      canonicalJson(expectedMisconfigurationEvidence.counts) ||
    canonicalJson(evidence) !== canonicalJson(expectedMatrixEvidence) ||
    trivy?.Metadata?.ImageID !==
      manifest.downstream.artifactEvidence.configDigest ||
    trivy?.Metadata?.ImageConfig?.digest !==
      manifest.downstream.artifactEvidence.manifestDigest ||
    configuredUser !== "" ||
    effectiveUser !== "root" ||
    healthcheckPresent !== false ||
    canonicalJson(matrix?.misconfigurationFindings) !==
      canonicalJson(expectedMisconfigurationFindings)
  ) {
    errors.push(
      "Portainer Dockerfile misconfiguration evidence or R2 disposition differs",
    )
  }
}

function validateSecurityMatrix(
  errors,
  matrix,
  trivy,
  frontendTrivy,
  frontendScan,
  manifest,
  index,
  sourceGovuln,
  binaryGovuln,
  now,
  identities,
  assemblyReceipts,
) {
  if (!matrix || !trivy || !index) return
  const scanner = matrix?.evidence?.trivy
  const frontendScanner = matrix?.evidence?.frontendTrivy
  const govuln = matrix?.evidence?.govulncheck
  const gate = matrix?.admissionGate
  const counts = vulnerabilityCounts(trivy)
  const frontendRawCounts = vulnerabilityCounts(frontendTrivy)
  const frontendRuntimeCounts = frontendScan?.severityCounts ?? {}
  const govulnOsvIds = new Set([
    ...(sourceGovuln?.osvIds ?? []),
    ...(binaryGovuln?.osvIds ?? []),
  ])
  const govulnFindingIds = new Set([
    ...(sourceGovuln?.findingIds ?? []),
    ...(binaryGovuln?.findingIds ?? []),
  ])
  const scannedVulnerabilities = [
    ...(trivy.Results ?? []).flatMap((result) => result?.Vulnerabilities ?? []),
    ...(frontendScan?.vulnerabilities ?? []),
  ]
  const runtimeScanIds = new Set(
    (trivy.Results ?? [])
      .flatMap((result) => result?.Vulnerabilities ?? [])
      .map(({ VulnerabilityID }) => VulnerabilityID),
  )
  const frontendScanIds = new Set(
    (frontendScan?.vulnerabilities ?? []).map(
      ({ VulnerabilityID }) => VulnerabilityID,
    ),
  )
  const reportedFindingIds = new Set([
    ...scannedVulnerabilities.map(({ VulnerabilityID }) => VulnerabilityID),
    ...govulnFindingIds,
  ])
  const dispositionContext = {
    now,
    manifest,
    assemblyReceipts,
    reportedFindingIds,
    runtimeScanIds,
    frontendScanIds,
  }
  const unresolvedScanned = scannedVulnerabilities.filter((vulnerability) => {
    const finding = matrixFindingForScannerObservation(
      identities,
      vulnerability,
    )
    return (
      !finding ||
      !scannerFindingMatchesMatrix(finding, vulnerability) ||
      !securityDispositionIsAdmissible(finding, dispositionContext)
    )
  })
  const unresolvedCritical = unresolvedScanned.filter(
    (finding) => String(finding?.Severity).toUpperCase() === "CRITICAL",
  ).length
  const unresolvedHigh = unresolvedScanned.filter(
    (finding) => String(finding?.Severity).toUpperCase() === "HIGH",
  ).length
  const externalRuntimeHigh = (matrix?.findings ?? []).filter(
    (finding) =>
      finding?.severity === "HIGH" &&
      finding?.disposition?.status ===
        "EXTERNAL_RUNTIME_ACTIVATION_PRECONDITION",
  ).length
  if (
    matrix.schema !== "llm-machines.portainer-ce-security-finding-matrix.v1" ||
    matrix.status !== "SOURCE_SECURITY_CHARACTERIZED_NOT_CORE_ADMITTED" ||
    matrix.accepted !== false ||
    matrix.runtimeQualified !== false ||
    matrix.contractActivation !== "INACTIVE" ||
    matrix?.target?.component !== "portainer-ce-downstream" ||
    matrix?.target?.version !== manifest.downstream.version ||
    matrix?.target?.platform !== "linux/amd64" ||
    matrix?.target?.upstreamRevision !== manifest.upstream.revision ||
    !exactKeys(matrix, [
      "schema",
      "status",
      "accepted",
      "runtimeQualified",
      "contractActivation",
      "target",
      "evidence",
      "admissionGate",
      "findings",
      "misconfigurationFindings",
      "historicalRemediations",
    ]) ||
    !exactKeys(matrix?.target, [
      "component",
      "version",
      "platform",
      "upstreamRevision",
    ]) ||
    !exactKeys(matrix?.evidence, [
      "trivy",
      "frontendTrivy",
      "misconfiguration",
      "govulncheck",
      "reachability",
    ]) ||
    canonicalJson(matrix?.evidence?.reachability) !==
      canonicalJson(index.reachability) ||
    canonicalJson(matrix?.evidence?.reachability) !==
      canonicalJson({
        validator: {
          path: reachabilityValidatorPath,
          sha256: assemblyReceipts?.validatorSha256,
          nodeVersion: manifest.downstream.buildToolchain.nodeExecutor,
        },
        angularJsVex: {
          expiresAt: expectedFrontendSecurityOverlay.angularJsVex.expiry,
          advisories: expectedFrontendSecurityOverlay.angularJsVex.advisories,
        },
        assemblies: (assemblyReceipts?.reachability ?? []).map((receipt) => ({
          id: receipt.assembly,
          evaluatedAt: receipt.evaluatedAt,
          receiptSha256:
            index.inputs[
              `assembly${receipt.assembly}ReachabilityReceiptSha256`
            ],
        })),
      }) ||
    !exactKeys(scanner, [
      "version",
      "reportSha256",
      "databaseUpdatedAt",
      "databaseSha256",
      "rawCounts",
    ]) ||
    !exactKeys(scanner?.rawCounts, [
      "critical",
      "high",
      "medium",
      "low",
      "unknown",
    ]) ||
    scanner?.version !== index.scan.trivy.version ||
    scanner?.databaseUpdatedAt !== index.scan.trivy.databaseUpdatedAt ||
    scanner?.databaseSha256 !== index.scan.trivy.databaseSha256 ||
    scanner?.reportSha256 !== index.inputs.rawTrivySha256 ||
    scanner?.rawCounts?.critical !== counts.CRITICAL ||
    scanner?.rawCounts?.high !== counts.HIGH ||
    scanner?.rawCounts?.medium !== counts.MEDIUM ||
    scanner?.rawCounts?.low !== counts.LOW ||
    scanner?.rawCounts?.unknown !== counts.UNKNOWN ||
    !exactKeys(frontendScanner, [
      "version",
      "reportSha256",
      "databaseUpdatedAt",
      "databaseSha256",
      "rawCounts",
      "runtimeCounts",
      "runtimeFindingCount",
    ]) ||
    !exactKeys(frontendScanner?.rawCounts, [
      "critical",
      "high",
      "medium",
      "low",
      "unknown",
    ]) ||
    !exactKeys(frontendScanner?.runtimeCounts, [
      "critical",
      "high",
      "medium",
      "low",
      "unknown",
    ]) ||
    frontendScanner?.version !== index.frontend.scan.trivy.version ||
    frontendScanner?.databaseUpdatedAt !==
      index.frontend.scan.trivy.databaseUpdatedAt ||
    frontendScanner?.databaseSha256 !==
      index.frontend.scan.trivy.databaseSha256 ||
    frontendScanner?.reportSha256 !== index.inputs.rawFrontendTrivySha256 ||
    frontendScanner?.rawCounts?.critical !== frontendRawCounts.CRITICAL ||
    frontendScanner?.rawCounts?.high !== frontendRawCounts.HIGH ||
    frontendScanner?.rawCounts?.medium !== frontendRawCounts.MEDIUM ||
    frontendScanner?.rawCounts?.low !== frontendRawCounts.LOW ||
    frontendScanner?.rawCounts?.unknown !== frontendRawCounts.UNKNOWN ||
    frontendScanner?.runtimeCounts?.critical !==
      frontendRuntimeCounts.CRITICAL ||
    frontendScanner?.runtimeCounts?.high !== frontendRuntimeCounts.HIGH ||
    frontendScanner?.runtimeCounts?.medium !== frontendRuntimeCounts.MEDIUM ||
    frontendScanner?.runtimeCounts?.low !== frontendRuntimeCounts.LOW ||
    frontendScanner?.runtimeCounts?.unknown !== frontendRuntimeCounts.UNKNOWN ||
    frontendScanner?.runtimeFindingCount !==
      (frontendScan?.vulnerabilities?.length ?? -1) ||
    !exactKeys(govuln, [
      "version",
      "databaseLastModified",
      "sourceReportSha256",
      "downstreamBinaryReportSha256",
      "sourceAffectedCount",
      "sourceAffectedModuleCount",
    ]) ||
    govuln?.version !== index.scan.govulncheck.version ||
    govuln?.sourceReportSha256 !== index.inputs.rawSourceGovulncheckSha256 ||
    govuln?.downstreamBinaryReportSha256 !==
      index.inputs.rawBinaryGovulncheckSha256 ||
    sourceGovuln?.databaseUpdatedAt !== govuln?.databaseLastModified ||
    binaryGovuln?.databaseUpdatedAt !== govuln?.databaseLastModified ||
    sourceGovuln?.reachableCount !== govuln?.sourceAffectedCount ||
    sourceGovuln?.reachableModuleCount !== govuln?.sourceAffectedModuleCount ||
    gate?.reachableUnresolvedCritical !== unresolvedCritical ||
    gate?.reachableUnresolvedHigh !== unresolvedHigh ||
    unresolvedCritical !== 0 ||
    unresolvedHigh !== 0 ||
    gate?.externalRuntimeHighActivationPreconditions !== externalRuntimeHigh ||
    gate?.runtimeConfigurationHighActivationPreconditions !== 1 ||
    gate?.runtimeConfigurationLowActivationPreconditions !== 1 ||
    !exactKeys(gate, [
      "reachableUnresolvedCritical",
      "reachableUnresolvedHigh",
      "externalRuntimeHighActivationPreconditions",
      "runtimeConfigurationHighActivationPreconditions",
      "runtimeConfigurationLowActivationPreconditions",
      "matrixResult",
      "activationAllowed",
      "activationBlockers",
    ]) ||
    gate?.matrixResult !==
      "PASS_SOURCE_SECURITY_BOUNDARY_WITH_EXTERNAL_ACTIVATION_PRECONDITIONS" ||
    gate?.activationAllowed !== false ||
    !Array.isArray(gate?.activationBlockers) ||
    canonicalJson(gate?.activationBlockers) !==
      canonicalJson(expectedActivationBlockers) ||
    !Array.isArray(matrix?.findings) ||
    matrix.findings.length === 0 ||
    !Array.isArray(matrix?.misconfigurationFindings) ||
    matrix.misconfigurationFindings.length !== 2 ||
    !Array.isArray(matrix?.historicalRemediations)
  ) {
    errors.push("Portainer security finding matrix is not evidence-bound")
  }
  for (const identity of identities.keys()) {
    if (/^GO-\d{4}-\d+$/.test(identity) && !govulnOsvIds.has(identity)) {
      errors.push(`matrix GO advisory is absent from govulncheck: ${identity}`)
    }
  }
  const allowedDispositions = new Set([
    "EXTERNAL_RUNTIME_ACTIVATION_PRECONDITION",
    "NOT_APPLICABLE_LINUX_AMD64",
    "NOT_REACHABLE_IN_PORTAINER_PROCESS",
    "NOT_REACHABLE_TIME_BOUND_GUARD",
    "TIME_BOUND_COMPENSATING_CONTROL",
    "TIME_BOUND_FRONTEND_COMPENSATING_CONTROL",
    "TIME_BOUND_OUTSIDE_SUPPORTED_PROFILE",
  ])
  if (
    (matrix.findings ?? []).some((finding) =>
      findingIdentities(finding).some((identity) => identity.startsWith("DS-")),
    )
  ) {
    errors.push(
      "Dockerfile misconfiguration identities must remain separate from vulnerability findings",
    )
  }
  for (const finding of matrix.findings ?? []) {
    const severity = String(finding?.severity ?? "UNKNOWN").toUpperCase()
    const disposition = String(
      finding?.disposition?.status ?? "UNRESOLVED",
    ).toUpperCase()
    const id = finding?.advisory?.id ?? "unknown"
    if (!securityFindingShapeIsValid(finding)) {
      errors.push(`security finding schema is invalid: ${id}`)
    }
    if (!allowedDispositions.has(disposition)) {
      errors.push(`security finding has an inadmissible disposition: ${id}`)
    }
    if (!securityDispositionIsAdmissible(finding, dispositionContext)) {
      errors.push(`security finding disposition lacks exact evidence: ${id}`)
    }
    const scannerIdentityIsPresent = scannedVulnerabilities.some(
      (vulnerability) =>
        findingIdentities(finding).includes(vulnerability?.VulnerabilityID),
    )
    const scannerObservationIsPresent = scannedVulnerabilities.some(
      (vulnerability) =>
        findingIdentities(finding).includes(vulnerability?.VulnerabilityID) &&
        scannerFindingMatchesMatrix(finding, vulnerability),
    )
    const govulnIdentityIsPresent = findingIdentities(finding).some(
      (identity) => govulnFindingIds.has(identity),
    )
    if (
      (!scannerIdentityIsPresent && !govulnIdentityIsPresent) ||
      (scannerIdentityIsPresent && !scannerObservationIsPresent)
    ) {
      errors.push(`current security finding is absent from evidence: ${id}`)
    }
    if (
      id === "unknown" ||
      typeof finding?.evidence?.class !== "string" ||
      finding.evidence.class.length === 0 ||
      typeof finding?.evidence?.callPath !== "string" ||
      finding.evidence.callPath.length === 0 ||
      typeof finding?.disposition?.owner !== "string" ||
      finding.disposition.owner.length === 0 ||
      !Array.isArray(finding?.disposition?.controls) ||
      finding.disposition.controls.length === 0 ||
      !Array.isArray(finding?.disposition?.reviewTriggers) ||
      finding.disposition.reviewTriggers.length === 0
    ) {
      errors.push(`security finding evidence or ownership is incomplete: ${id}`)
    }
    if (disposition.includes("TIME_BOUND")) {
      const expiry = Date.parse(finding?.disposition?.expiry)
      if (!Number.isInteger(expiry) || expiry <= now.getTime()) {
        errors.push(`time-bound security finding is expired: ${id}`)
      }
    }
    if (
      ["CRITICAL", "HIGH"].includes(severity) &&
      disposition === "UNRESOLVED"
    ) {
      errors.push(`reachable ${severity} finding is unresolved: ${id}`)
    }
  }
  for (const identity of reportedFindingIds) {
    if (!identities.has(identity)) {
      errors.push(`current evidence finding is absent from matrix: ${identity}`)
    }
  }
  const historicalIdentities = new Set()
  for (const finding of matrix.historicalRemediations ?? []) {
    const id = finding?.advisory?.id ?? "unknown"
    for (const identity of findingIdentities(finding)) {
      if (historicalIdentities.has(identity) || identities.has(identity)) {
        errors.push(
          `historical remediation identity is duplicated: ${identity}`,
        )
      }
      historicalIdentities.add(identity)
    }
    if (!historicalRemediationIsAdmissible(finding, dispositionContext)) {
      errors.push(`historical remediation lacks exact evidence: ${id}`)
    }
  }
  const expectedHistoricalIdentities = new Set(
    Object.entries(expectedHistoricalRemediationIdentities).flatMap(
      ([id, aliases]) => [id, ...aliases],
    ),
  )
  if (
    historicalIdentities.size !== expectedHistoricalIdentities.size ||
    [...historicalIdentities].some(
      (identity) => !expectedHistoricalIdentities.has(identity),
    )
  ) {
    errors.push("historical downstream remediation set differs")
  }
  if (
    sha256Bytes(canonicalJson(matrix.historicalRemediations ?? [])) !==
    expectedHistoricalRemediationsSha256
  ) {
    errors.push("historical downstream remediation evidence differs")
  }
  for (const result of trivy.Results ?? []) {
    for (const vulnerability of result?.Vulnerabilities ?? []) {
      const finding = matrixFindingForScannerObservation(
        identities,
        vulnerability,
      )
      if (
        !scannerFindingMatchesMatrix(finding, vulnerability) ||
        !securityDispositionIsAdmissible(finding, dispositionContext)
      ) {
        errors.push(
          `Trivy finding is missing or mismatched in matrix: ${vulnerability?.VulnerabilityID}`,
        )
      }
    }
  }
  for (const vulnerability of frontendScan?.vulnerabilities ?? []) {
    const finding = matrixFindingForScannerObservation(
      identities,
      vulnerability,
    )
    if (
      !scannerFindingMatchesMatrix(finding, vulnerability) ||
      !securityDispositionIsAdmissible(finding, dispositionContext)
    ) {
      errors.push(
        `Frontend Trivy finding is missing or mismatched in matrix: ${vulnerability?.VulnerabilityID}`,
      )
    }
  }
  for (const id of ["CVE-2024-21490", "CVE-2026-11998"]) {
    const finding = (identities.get(id) ?? []).find(
      (entry) =>
        entry?.component?.name === "angular" &&
        entry?.component?.installed === "1.8.2",
    )
    if (
      finding?.severity !== "HIGH" ||
      finding?.component?.name !== "angular" ||
      finding?.component?.installed !== "1.8.2" ||
      finding?.disposition?.status !== "NOT_REACHABLE_TIME_BOUND_GUARD" ||
      canonicalJson(finding?.disposition?.controls) !==
        canonicalJson(expectedFrontendSecurityOverlay.angularJsVex.guards) ||
      finding?.disposition?.owner !== "PORTAINER_DOWNSTREAM_MAINTAINER" ||
      finding?.disposition?.expiry !==
        expectedFrontendSecurityOverlay.angularJsVex.expiry ||
      canonicalJson(finding?.disposition?.reviewTriggers) !==
        canonicalJson(
          expectedFrontendSecurityOverlay.angularJsVex.reviewTriggers,
        )
    ) {
      errors.push(`AngularJS frontend VEX disposition differs: ${id}`)
    }
  }
}

function validateReproducibility(
  errors,
  evidence,
  manifest,
  index,
  runtimeBinding,
  assemblyReceipts,
) {
  if (!evidence || !index) return
  const artifactEvidence = manifest.downstream.artifactEvidence
  const assemblies = evidence?.assemblies
  const expectedArtifact = index.artifact
  const expectedKeys = [
    "id",
    "ociArchiveSha256",
    "ociArchiveBytes",
    "indexDigest",
    "manifestDigest",
    "configDigest",
    "platform",
    "layers",
    "runtimeInventorySha256",
    "frontendPublicInventorySha256",
    "frontendSourceMapInventorySha256",
    "sealedRecordSha256",
    "evidence",
  ]
  if (
    !exactKeys(evidence, [
      "schema",
      "status",
      "byteIdentical",
      "artifact",
      "frontend",
      "reachability",
      "assemblies",
    ]) ||
    evidence.schema !== "llm-machines.portainer-ce-reproducibility.v1" ||
    evidence.status !== "BYTE_IDENTICAL_TWO_ASSEMBLY_PROOF" ||
    evidence.byteIdentical !== true ||
    canonicalJson(evidence.artifact) !== canonicalJson(expectedArtifact) ||
    canonicalJson(evidence.frontend) !==
      canonicalJson({
        source: runtimeBinding?.source,
        publicInventorySha256: runtimeBinding?.runtime?.inventorySha256,
        publicFileCount: runtimeBinding?.runtime?.fileCount,
        publicBytes: runtimeBinding?.runtime?.bytes,
        sourceMapInventorySha256:
          runtimeBinding?.runtime?.sourceMapInventorySha256,
        sourceMapCount: runtimeBinding?.runtime?.sourceMapCount,
        sourcePathCount: runtimeBinding?.runtime?.sourcePathCount,
        componentCount: runtimeBinding?.runtime?.componentCount,
      }) ||
    canonicalJson(evidence.reachability) !==
      canonicalJson(index.reachability) ||
    !Array.isArray(assemblies) ||
    assemblies.length !== 2 ||
    assemblies[0]?.id !== "A" ||
    assemblies[1]?.id !== "B" ||
    assemblies.some(
      (assembly) =>
        !exactKeys(assembly, expectedKeys) ||
        canonicalJson(
          Object.fromEntries(
            Object.entries(assembly).filter(
              ([key]) =>
                ![
                  "id",
                  "frontendPublicInventorySha256",
                  "frontendSourceMapInventorySha256",
                  "sealedRecordSha256",
                  "evidence",
                ].includes(key),
            ),
          ),
        ) !== canonicalJson(expectedArtifact) ||
        assembly.frontendPublicInventorySha256 !==
          runtimeBinding?.runtime?.inventorySha256 ||
        assembly.frontendSourceMapInventorySha256 !==
          runtimeBinding?.runtime?.sourceMapInventorySha256 ||
        canonicalJson(assembly.evidence) !==
          canonicalJson(
            [
              ...(assemblyReceipts?.records?.[assembly.id === "A" ? 0 : 1]
                ?.evidence ?? []),
            ].sort((left, right) => compareText(left.id, right.id)),
          ),
    ) ||
    assemblies[0]?.sealedRecordSha256 !== index.inputs.assemblyARecordSha256 ||
    assemblies[1]?.sealedRecordSha256 !== index.inputs.assemblyBRecordSha256 ||
    assemblies[0]?.sealedRecordSha256 === assemblies[1]?.sealedRecordSha256
  ) {
    errors.push("Assembly A and B evidence is incomplete or differs")
  }
  validateArtifactProjection(
    errors,
    evidence.artifact,
    artifactEvidence,
    "Portainer reproducibility artifact",
  )
}

function artifactLicenseSourceIsValid(component, manifest, sbomComponent) {
  const source = component?.source
  const kind = source?.kind
  if (kind === "main-module-source") {
    return (
      exactKeys(source, [
        "kind",
        "revision",
        "tree",
        "overlaySha256",
        "sourceManifestPath",
        "sourceManifestBytes",
        "sourceManifestSha256",
        "sourceFileCount",
        "goModSha256",
        "goSumSha256",
      ]) &&
      source.revision === manifest.upstream.revision &&
      source.tree === manifest.upstream.tree &&
      source.overlaySha256 === manifest.downstream.patch.sha256 &&
      safeEvidencePath(source.sourceManifestPath) &&
      Number.isSafeInteger(source.sourceManifestBytes) &&
      source.sourceManifestBytes > 0 &&
      source.sourceManifestSha256 ===
        manifest.downstream.sourceInventory.sha256SumsSha256 &&
      source.sourceFileCount ===
        manifest.downstream.sourceInventory.fileCount &&
      source.goModSha256 === manifest.downstream.sourceInventory.goModSha256 &&
      source.goSumSha256 === manifest.downstream.sourceInventory.goSumSha256
    )
  }
  if (kind === "runtime-artifact-file") {
    return (
      exactKeys(source, ["kind", "artifactPath", "sha256"]) &&
      source.artifactPath === "/portainer" &&
      digestPattern.test(source.sha256 ?? "") &&
      sbomComponent?.type === "file" &&
      sbomComponent?.name === "/portainer" &&
      sbomComponent?.hashes?.some(
        (hash) => hash?.alg === "SHA-256" && hash?.content === source.sha256,
      )
    )
  }
  if (kind === "go-module-zip") {
    return (
      exactKeys(source, [
        "kind",
        "archivePath",
        "archiveBytes",
        "archiveSha256",
        "goSumH1",
        "goModPath",
        "goModBytes",
        "goModSha256",
        "goModSumH1",
        "infoPath",
        "infoBytes",
        "infoSha256",
      ]) &&
      [source.archivePath, source.goModPath, source.infoPath].every(
        safeEvidencePath,
      ) &&
      [source.archiveBytes, source.goModBytes, source.infoBytes].every(
        (bytes) => Number.isSafeInteger(bytes) && bytes > 0,
      ) &&
      [source.archiveSha256, source.goModSha256, source.infoSha256].every(
        (digest) => digestPattern.test(digest ?? ""),
      ) &&
      /^h1:[A-Za-z0-9+/]+={0,2}$/.test(source.goSumH1 ?? "") &&
      /^h1:[A-Za-z0-9+/]+={0,2}$/.test(source.goModSumH1 ?? "")
    )
  }
  if (kind === "go-toolchain-source") {
    const goBuilder = manifest.downstream.buildInputs.find(
      ({ id }) => id === "go-builder",
    )
    return (
      exactKeys(source, [
        "kind",
        "goVersion",
        "builderPlatformDigest",
        "sourceArchiveUrl",
        "sourceArchivePath",
        "sourceArchiveBytes",
        "sourceArchiveSha256",
        "licenseArchiveEntry",
      ]) &&
      source.goVersion === "go1.25.13" &&
      source.builderPlatformDigest === goBuilder?.platformDigest &&
      source.sourceArchiveUrl === "https://go.dev/dl/go1.25.13.src.tar.gz" &&
      safeEvidencePath(source.sourceArchivePath) &&
      source.sourceArchiveBytes === 32023100 &&
      source.sourceArchiveSha256 ===
        "1d7e2f70b1ee9b93c7df8efcca71f5adcc6a59797a4336c2d10171bd4c174614" &&
      source.licenseArchiveEntry === "go/LICENSE"
    )
  }
  if (kind === "registry") {
    return (
      exactKeys(source, [
        "kind",
        "lockKey",
        "integrity",
        "archivePath",
        "archiveBytes",
        "archiveSha256",
        "packageManifestEntry",
        "packageManifestSha256",
      ]) &&
      typeof source.lockKey === "string" &&
      source.lockKey.length > 0 &&
      typeof source.integrity === "string" &&
      source.integrity.length > 0 &&
      safeEvidencePath(source.archivePath) &&
      Number.isSafeInteger(source.archiveBytes) &&
      source.archiveBytes > 0 &&
      digestPattern.test(source.archiveSha256 ?? "") &&
      safeEvidencePath(source.packageManifestEntry) &&
      digestPattern.test(source.packageManifestSha256 ?? "")
    )
  }
  if (kind === "git-tarball") {
    return (
      exactKeys(source, [
        "kind",
        "lockKey",
        "tarballUrl",
        "revision",
        "archivePath",
        "archiveBytes",
        "archiveSha256",
        "packageManifestEntry",
        "packageManifestSha256",
      ]) &&
      /^https:\/\/codeload\.github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/tar\.gz\/[a-f0-9]{40}$/.test(
        source.tarballUrl ?? "",
      ) &&
      commitPattern.test(source.revision ?? "") &&
      source.tarballUrl.endsWith(source.revision) &&
      safeEvidencePath(source.archivePath) &&
      Number.isSafeInteger(source.archiveBytes) &&
      source.archiveBytes > 0 &&
      digestPattern.test(source.archiveSha256 ?? "") &&
      safeEvidencePath(source.packageManifestEntry) &&
      digestPattern.test(source.packageManifestSha256 ?? "")
    )
  }
  if (kind === "main-module-frontend") {
    return (
      exactKeys(source, ["kind", "packageJsonSha256", "licenseSourceBomRef"]) &&
      digestPattern.test(source.packageJsonSha256 ?? "") &&
      typeof source.licenseSourceBomRef === "string" &&
      source.licenseSourceBomRef.length > 0
    )
  }
  return false
}

function artifactLegalFileIsValid(file, source) {
  if (
    !file ||
    !safeEvidencePath(file.path) ||
    !Number.isSafeInteger(file.bytes) ||
    file.bytes < 1 ||
    !digestPattern.test(file.sha256 ?? "") ||
    typeof file.origin !== "string"
  ) {
    return false
  }
  const common = ["path", "bytes", "sha256", "origin"]
  if (file.origin === "source-inventory") {
    return exactKeys(file, common)
  }
  if (["module-archive", "toolchain-source-archive"].includes(file.origin)) {
    return (
      exactKeys(file, [...common, "archiveEntry"]) &&
      safeArchiveEntryIsValid(file.archiveEntry)
    )
  }
  if (file.origin === "package-archive") {
    return (
      exactKeys(file, [...common, "archivePath", "archiveEntry"]) &&
      safeEvidencePath(file.archivePath) &&
      file.archivePath === source?.archivePath &&
      safeArchiveEntryIsValid(file.archiveEntry)
    )
  }
  if (file.origin === "reviewed-source-archive") {
    return (
      exactKeys(file, [
        ...common,
        "sourceArchiveUrl",
        "sourceRevision",
        "sourceArchivePath",
        "sourceArchiveBytes",
        "sourceArchiveSha256",
        "archiveEntry",
      ]) &&
      /^https:\/\/[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]+$/.test(
        file.sourceArchiveUrl ?? "",
      ) &&
      commitPattern.test(file.sourceRevision ?? "") &&
      file.sourceArchiveUrl.endsWith(file.sourceRevision) &&
      safeEvidencePath(file.sourceArchivePath) &&
      Number.isSafeInteger(file.sourceArchiveBytes) &&
      file.sourceArchiveBytes > 0 &&
      digestPattern.test(file.sourceArchiveSha256 ?? "") &&
      safeArchiveEntryIsValid(file.archiveEntry)
    )
  }
  if (file.origin === "reviewed-spdx") {
    return (
      exactKeys(file, [
        ...common,
        "spdxVersion",
        "spdxRevision",
        "sourceArchiveUrl",
        "sourceRevision",
        "sourceArchivePath",
        "sourceArchiveBytes",
        "sourceArchiveSha256",
        "archiveEntry",
      ]) &&
      file.spdxVersion === "3.28" &&
      file.spdxRevision === "v3.28" &&
      /^https:\/\/[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]+$/.test(
        file.sourceArchiveUrl ?? "",
      ) &&
      commitPattern.test(file.sourceRevision ?? "") &&
      file.sourceArchiveUrl.endsWith(file.sourceRevision) &&
      safeEvidencePath(file.sourceArchivePath) &&
      Number.isSafeInteger(file.sourceArchiveBytes) &&
      file.sourceArchiveBytes > 0 &&
      digestPattern.test(file.sourceArchiveSha256 ?? "") &&
      safeArchiveEntryIsValid(file.archiveEntry)
    )
  }
  return false
}

function validateArtifactLicenseEvidence(
  errors,
  evidence,
  sbom,
  manifest,
  index,
  runtimeBinding,
) {
  if (!evidence || !sbom || !index) return
  const components = evidence?.components
  const evidenceRefs = Array.isArray(components)
    ? components.map(({ bomRef }) => bomRef)
    : []
  const sbomComponents = new Map(
    (sbom.components ?? []).map((component) => [
      component?.["bom-ref"],
      component,
    ]),
  )
  const sbomRefs = [...sbomComponents.keys()].sort(compareText)
  const combinedSbomSha256 = sha256Bytes(`${canonicalJson(sbom)}\n`)
  const coverage = evidence?.coverage
  const scopes = Array.isArray(components)
    ? components.reduce((counts, component) => {
        counts[component.scope] = (counts[component.scope] ?? 0) + 1
        return counts
      }, {})
    : {}
  const mainSource = components?.find(
    (component) => component?.source?.kind === "main-module-source",
  )
  const mainSourceRef = mainSource?.bomRef
  const frontendApplication = components?.find(
    (component) => component?.scope === "frontend-application",
  )
  const mplRefs = (components ?? [])
    .filter((component) =>
      String(component?.license?.concludedExpression ?? "").includes("MPL-2.0"),
    )
    .map((component) => component.bomRef)
    .sort(compareText)
  if (
    !exactKeys(evidence, [
      "schema",
      "status",
      "accepted",
      "runtimeQualified",
      "artifact",
      "root",
      "inputs",
      "custody",
      "coverage",
      "components",
      "artifactLicenseEvidenceComplete",
    ]) ||
    evidence.schema !==
      "llm-machines.portainer-ce-artifact-license-evidence.v1" ||
    evidence.status !== "SOURCE_SECURITY_CHARACTERIZED_NOT_CORE_ADMITTED" ||
    evidence.accepted !== false ||
    evidence.runtimeQualified !== false ||
    canonicalJson(evidence.artifact) !==
      canonicalJson({
        manifestDigest: manifest.downstream.artifactEvidence.manifestDigest,
        ociArchiveSha256: manifest.downstream.artifactEvidence.ociArchiveSha256,
        combinedSbomSha256,
      }) ||
    canonicalJson(evidence.root) !==
      canonicalJson({
        bomRef: sbom.metadata.component["bom-ref"],
        declaredExpression: manifest.upstream.license,
        concludedExpression: manifest.upstream.license,
      }) ||
    canonicalJson(evidence.inputs) !==
      canonicalJson({
        frontendLicenseInputSha256: index.inputs.rawFrontendLicenseInputSha256,
        runtimeLicenseInputSha256: index.inputs.rawRuntimeLicenseInputSha256,
      }) ||
    !exactKeys(evidence.custody, [
      "archiveCustodyMode",
      "frontend",
      "runtime",
    ]) ||
    evidence.custody.archiveCustodyMode !== "EXTERNAL_SEALED_DIGEST_BOUND" ||
    !licenseCustodyIsValid(evidence.custody.frontend) ||
    !licenseCustodyIsValid(evidence.custody.runtime) ||
    canonicalJson(evidence.custody) !==
      canonicalJson(index.frontend.license.custody) ||
    !exactKeys(coverage, [
      "expectedComponentCount",
      "reviewedComponentCount",
      "expectedRefsSha256",
      "missingRefs",
      "unknownExpressions",
      "missingRequiredTexts",
      "copyleftRefs",
      "prohibitedRefs",
      "complete",
    ]) ||
    coverage.expectedComponentCount !== sbomRefs.length ||
    coverage.reviewedComponentCount !== sbomRefs.length ||
    coverage.expectedRefsSha256 !==
      sha256Bytes(`${canonicalJson(sbomRefs)}\n`) ||
    !Array.isArray(coverage.missingRefs) ||
    coverage.missingRefs.length !== 0 ||
    !Array.isArray(coverage.unknownExpressions) ||
    coverage.unknownExpressions.length !== 0 ||
    !Array.isArray(coverage.missingRequiredTexts) ||
    coverage.missingRequiredTexts.length !== 0 ||
    !Array.isArray(coverage.copyleftRefs) ||
    coverage.copyleftRefs.some((reference) => !sbomComponents.has(reference)) ||
    new Set(coverage.copyleftRefs).size !== coverage.copyleftRefs.length ||
    canonicalJson(coverage.copyleftRefs) !==
      canonicalJson([...coverage.copyleftRefs].sort(compareText)) ||
    mplRefs.some((reference) => !coverage.copyleftRefs.includes(reference)) ||
    !Array.isArray(coverage.prohibitedRefs) ||
    coverage.prohibitedRefs.length !== 0 ||
    coverage.complete !== true ||
    evidence.artifactLicenseEvidenceComplete !== true ||
    !Array.isArray(components) ||
    components.length !== sbomRefs.length ||
    canonicalJson(evidenceRefs) !== canonicalJson(sbomRefs) ||
    new Set(evidenceRefs).size !== evidenceRefs.length ||
    scopes["runtime-artifact-file"] !== 1 ||
    scopes["frontend-application"] !== 1 ||
    scopes["frontend-npm"] !== runtimeBinding?.runtime?.componentCount ||
    (scopes["runtime-go"] ?? 0) + (scopes["runtime-artifact-file"] ?? 0) !==
      sbomRefs.length - 1 - (runtimeBinding?.runtime?.componentCount ?? -1) ||
    frontendApplication?.source?.packageJsonSha256 !==
      runtimeBinding?.source?.packageJsonSha256 ||
    frontendApplication?.source?.licenseSourceBomRef !== mainSourceRef ||
    mainSource?.license?.declaredExpression !== manifest.upstream.license ||
    mainSource?.license?.concludedExpression !== manifest.upstream.license ||
    canonicalJson(frontendApplication?.license) !==
      canonicalJson(mainSource?.license) ||
    components.some((component) => {
      const sbomComponent = sbomComponents.get(component?.bomRef)
      const license = component?.license
      const legalFiles = [
        ...(license?.files ?? []),
        ...(license?.noticeFiles ?? []),
      ]
      return (
        !exactKeys(component, ["scope", "bomRef", "source", "license"]) ||
        ![
          "runtime-go",
          "runtime-artifact-file",
          "frontend-npm",
          "frontend-application",
        ].includes(component.scope) ||
        !sbomComponent ||
        !exactKeys(license, [
          "declaredExpression",
          "concludedExpression",
          "files",
          "noticeFiles",
          "disposition",
          "reviewer",
          "reviewedAt",
        ]) ||
        typeof license.declaredExpression !== "string" ||
        license.declaredExpression.length === 0 ||
        typeof license.concludedExpression !== "string" ||
        license.concludedExpression.length === 0 ||
        !Array.isArray(license.files) ||
        license.files.length === 0 ||
        !Array.isArray(license.noticeFiles) ||
        legalFiles.some(
          (file) => !artifactLegalFileIsValid(file, component.source),
        ) ||
        typeof license.disposition !== "string" ||
        license.disposition.length === 0 ||
        typeof license.reviewer !== "string" ||
        license.reviewer.length === 0 ||
        !Number.isInteger(Date.parse(license.reviewedAt)) ||
        canonicalJson(sbomComponent.licenses) !==
          canonicalJson([{ expression: license.concludedExpression }]) ||
        !artifactLicenseSourceIsValid(component, manifest, sbomComponent)
      )
    })
  ) {
    errors.push(
      "Portainer artifact license evidence does not completely cover the combined artifact",
    )
  }
}

function validateLicenseReview(errors, review, manifest) {
  if (!review) return
  const commercial = review?.commercialMaterialReview
  if (
    review.schema !== "llm-machines.portainer-ce-license-review.v1" ||
    review.status !== "PASS_SOURCE_ONLY_NOT_CORE_ADMITTED" ||
    review.accepted !== false ||
    review.runtimeQualified !== false ||
    review.contractActivation !== "INACTIVE" ||
    review?.component?.id !== "portainer-ce-downstream" ||
    review?.component?.downstreamVersion !== manifest.downstream.version ||
    review?.component?.declaredLicense !== "Zlib" ||
    review?.upstream?.revision !== manifest.upstream.revision ||
    review?.upstream?.tree !== manifest.upstream.tree ||
    review?.licenseEvidence?.license?.copySha256 !==
      manifest.downstream.licenseCopy.sha256 ||
    review?.licenseEvidence?.attributions?.copySha256 !==
      manifest.downstream.attributionsCopy.sha256 ||
    review?.licenseEvidence?.noticePath !== manifest.downstream.notice.path ||
    review?.downstreamBoundary?.securityOverlaySha256 !==
      manifest.downstream.patch.sha256 ||
    review?.admissionBoundary?.licenseReviewPassed !== true ||
    review?.admissionBoundary?.artifactLicenseEvidenceComplete !== true ||
    commercial?.result !== "PASS" ||
    commercial?.businessEditionSourcePresent !== false ||
    commercial?.businessEditionArtifactPresent !== false ||
    commercial?.trialMaterialPresent !== false ||
    commercial?.commercialLicenseMaterialPresent !== false ||
    commercial?.licenseKeyPresent !== false ||
    commercial?.paidFeatureDependency !== false ||
    commercial?.futurePurchaseObligation !== false
  ) {
    errors.push(
      "Portainer license review or commercial-material boundary differs",
    )
  }
}

function validateCommercialBoundary(errors, manifest, documents) {
  const material = canonicalJson({
    manifest: cloneWithoutVolatile(manifest),
    documents,
  })
  if (
    /(?:portainer-(?:be|ee)|LicenseRef-Proprietary|commercial-license-material|trial-license-material)/i.test(
      material,
    )
  ) {
    errors.push(
      "Portainer downstream contains Enterprise or commercial material",
    )
  }
}

export function validateSourcePackage(
  manifest,
  root = repositoryRoot,
  { now = new Date() } = {},
) {
  const errors = []
  const normalizedRoot = path.resolve(root)
  if (
    manifest?.schema !== "llm-machines.portainer-ce-downstream-source.v1" ||
    manifest?.status !== "SOURCE_SECURITY_CHARACTERIZED_NOT_CORE_ADMITTED" ||
    manifest?.accepted !== false ||
    manifest?.runtimeQualified !== false ||
    manifest?.contractActivation !== "INACTIVE" ||
    manifest?.containsCredentials !== false ||
    manifest?.productIntegrated !== false
  ) {
    errors.push("Portainer source package boundary is invalid")
  }

  const upstream = manifest?.upstream
  if (
    upstream?.repository !== "https://github.com/portainer/portainer" ||
    upstream?.version !== "2.39.6" ||
    upstream?.revision !== "723d1a2268f0fefe70d57f5981ce15d5d1ffc679" ||
    upstream?.tree !== "9a2418f78d3f2cf4047e86b0878227b5e61d55fa" ||
    upstream?.sourceDateEpoch !== 1786575764 ||
    upstream?.archiveFile !== "portainer-2.39.6.tar.gz" ||
    upstream?.archiveRoot !== "portainer-2.39.6" ||
    upstream?.archiveUrl !==
      "https://codeload.github.com/portainer/portainer/tar.gz/refs/tags/2.39.6" ||
    upstream?.archiveSha256 !==
      "3b69237c2fdbb5e51ba1019afbd09d528820a82619c0387d2f9040f07d626f96" ||
    upstream?.license !== "Zlib" ||
    upstream?.licenseSourceSha256 !==
      "c83f08165206f8a2831009fa4a469d41e452f6e086945246fe928a94a5420722" ||
    upstream?.attributionsSourceSha256 !==
      "e3f8444f7222a7f8ebdfc237b2edb29e01443e159267c0cb87e7cb71ae4b41e3" ||
    !commitPattern.test(upstream?.revision ?? "") ||
    mutablePattern.test(upstream?.archiveUrl ?? "")
  ) {
    errors.push(
      "Portainer upstream source identity is missing, mutable, or differs",
    )
  }
  const official = upstream?.officialImage
  if (
    official?.repository !== "docker.io/portainer/portainer-ce" ||
    official?.version !== "2.39.6" ||
    official?.indexDigest !==
      "sha256:3fa8750ac2b98ce56784ca292df1adc3ec38f0062fd572811ea4b2221beee310" ||
    official?.platform !== "linux/amd64" ||
    official?.platformDigest !==
      "sha256:663641360fb1cab6ace4fe0f0855e97506c222ae52f129676673d52108d8b59e" ||
    official?.configDigest !==
      "sha256:eea0d46628f9b7b223a43d0ccf2266649dd1211dfc0075749ae9c709808720a6" ||
    official?.provenanceDisposition !==
      "NOT_ADMITTED_SOURCE_LABEL_REVISION_C57526D_UNBOUND_TO_PUBLIC_TAG" ||
    !ociDigestPattern.test(official?.indexDigest ?? "") ||
    !ociDigestPattern.test(official?.platformDigest ?? "") ||
    !ociDigestPattern.test(official?.configDigest ?? "") ||
    mutablePattern.test(official?.version ?? "")
  ) {
    errors.push("Portainer official image identity is missing or mutable")
  }

  const downstream = manifest?.downstream
  if (
    downstream?.version !== "2.39.6-llmm.1" ||
    downstream?.platform !== "linux/amd64" ||
    downstream?.mirrorRepository !== "core/portainer-ce-downstream" ||
    downstream?.alteredSourceMarked !== true
  ) {
    errors.push("Portainer downstream identity differs")
  }
  validateLocalFile(
    errors,
    normalizedRoot,
    downstream?.patch,
    "Portainer patch",
  )
  validateLocalFile(
    errors,
    normalizedRoot,
    downstream?.dockerfile,
    "Portainer Dockerfile",
  )
  validateLocalFile(
    errors,
    normalizedRoot,
    downstream?.dockerignore,
    "Portainer Dockerignore",
  )
  validateLocalFile(
    errors,
    normalizedRoot,
    downstream?.licenseCopy,
    "Portainer license",
  )
  validateLocalFile(
    errors,
    normalizedRoot,
    downstream?.attributionsCopy,
    "Portainer notices",
  )
  validateLocalFile(
    errors,
    normalizedRoot,
    downstream?.notice,
    "Portainer third-party notice",
  )
  const licenseReviewPath = validateLocalFile(
    errors,
    normalizedRoot,
    downstream?.licenseReview,
    "Portainer license review",
  )
  const licenseReview = licenseReviewPath
    ? readJson(errors, licenseReviewPath, "Portainer license review")
    : null
  if (
    canonicalJson(downstream?.licenseCustody) !==
    canonicalJson(expectedLicenseCustody)
  ) {
    errors.push("Portainer source-controlled license custody contract differs")
  }

  const inventory = downstream?.sourceInventory
  if (
    inventory?.fileCount !== 4832 ||
    inventory?.sha256SumsSha256 !==
      "cf12b690711cc07fba9bf25098a5418e3cabd658e698b97cd0ba52a5666194ed" ||
    inventory?.goModSha256 !==
      "70ed650f74a77f7106d91d49e57b5cae46a716321843a6498fb962cc743f07a1" ||
    inventory?.goSumSha256 !==
      "7aca1421455d57bb1f2a4041d7487af1f908d7c26a881b0c9c2fe89df4ed0398" ||
    inventory?.packageJsonSha256 !==
      "3936e9c5529e92fbf110b60964b7ed56a25b8b39a885713c5fa30499499ebb82" ||
    inventory?.pnpmLockSha256 !==
      "99971755c3784ab0930a87018d7ba5fd90db9e5c41c14e198ca81a1152dc6d9a" ||
    inventory?.webpackProductionSha256 !==
      "e27e426749d2cb5fa4e042ba178090f6d2e8d74762b1338e3815cd14192c5925" ||
    inventory?.webpackCommonSha256 !==
      "159bd6f9147aa46c16a80c0aa13fbe7105be4b0a95aab6fb98b6a3e4544ef5d3"
  ) {
    errors.push("Portainer source inventory or module fingerprints differ")
  }
  if (
    downstream?.securityOverlay?.go !== "1.25.13" ||
    downstream?.securityOverlay?.["golang.org/x/mod"] !== "0.40.0" ||
    downstream?.securityOverlay?.["moby/go-archive"] !== "0.1.0" ||
    downstream?.securityOverlay?.goArchiveDisposition !==
      "NOT_EXECUTABLE_NO_PORTAINER_DIRECT_IMPORT_OR_COMPOSE_COPY_CALL"
  ) {
    errors.push("Portainer module security overlay differs")
  }
  if (
    canonicalJson(downstream?.frontendSecurityOverlay) !==
    canonicalJson(expectedFrontendSecurityOverlay)
  ) {
    errors.push("Portainer frontend security overlay differs")
  }
  if (
    canonicalJson(downstream?.buildInputs) !==
      canonicalJson(expectedBuildInputs) ||
    downstream?.buildInputs?.some(
      ({ repository, version, indexDigest, platformDigest }) =>
        mutablePattern.test(`${repository}:${version}`) ||
        !ociDigestPattern.test(indexDigest ?? "") ||
        !ociDigestPattern.test(platformDigest ?? ""),
    )
  ) {
    errors.push("Portainer build inputs are incomplete, mutable, or differ")
  }
  const toolchain = downstream?.buildToolchain
  if (
    toolchain?.dockerEngine !== "26.1.5+dfsg1" ||
    toolchain?.dockerBuildx !== "0.13.1+ds1" ||
    toolchain?.nodeExecutor !== "22.23.2" ||
    toolchain?.zstd !== "1.5.7" ||
    toolchain?.buildkit?.repository !== "docker.io/moby/buildkit" ||
    toolchain?.buildkit?.version !== "0.30.0" ||
    toolchain?.buildkit?.indexDigest !==
      "sha256:0168606be2315b7c807a03b3d8aa79beefdb31c98740cebdffdfeebf31190c9f" ||
    toolchain?.buildkit?.platform !== "linux/amd64" ||
    toolchain?.buildkit?.platformDigest !==
      "sha256:57269d1784e49b46228c45a1a1b870fbe40e0a639ab60b37b032d83af5bccdfc" ||
    toolchain?.buildkit?.configDigest !==
      "sha256:6db049f808b3e0c0694b3522d85b5a9bee4a0248a1dc67559e05f57cc0f68bdd"
  ) {
    errors.push("Portainer admission build toolchain differs")
  }
  const evidenceTooling = downstream?.evidenceTooling
  if (
    !exactKeys(evidenceTooling, [
      "assemblySealer",
      "reachabilityReceiptGenerator",
    ]) ||
    !exactKeys(evidenceTooling?.assemblySealer, ["path", "sha256"]) ||
    !exactKeys(evidenceTooling?.reachabilityReceiptGenerator, [
      "path",
      "sha256",
    ])
  ) {
    errors.push("Portainer evidence producer contract differs")
  } else {
    validateLocalFile(
      errors,
      normalizedRoot,
      evidenceTooling.assemblySealer,
      "Portainer assembly evidence sealer",
    )
    validateLocalFile(
      errors,
      normalizedRoot,
      evidenceTooling.reachabilityReceiptGenerator,
      "Portainer reachability receipt generator",
    )
  }
  if (
    downstream?.pnpm?.version !== "10.26.2" ||
    downstream?.pnpm?.tarballUrl !==
      "https://registry.npmjs.org/pnpm/-/pnpm-10.26.2.tgz" ||
    downstream?.pnpm?.tarballSha256 !==
      "63b50a4ba15cde20006ddba5d9e21fd623e23f094c9f63bb15f686b0e496aed6" ||
    mutablePattern.test(downstream?.pnpm?.tarballUrl ?? "")
  ) {
    errors.push("Portainer pnpm build input is missing or mutable")
  }
  if (
    canonicalJson(manifest?.activationPreconditions) !==
    canonicalJson(expectedActivationPreconditions)
  ) {
    errors.push("Portainer activation preconditions differ")
  }

  const evidence = downstream?.artifactEvidence
  if (
    !exactKeys(evidence, [
      "ociArchiveSha256",
      "ociArchiveBytes",
      "indexDigest",
      "manifestDigest",
      "configDigest",
      "layerDigests",
      "runtimeInventorySha256",
      "independentBuilds",
      "byteIdentical",
      "sbomSha256",
      "provenanceSha256",
      "vulnerabilityReportSha256",
      "misconfigurationReportSha256",
      "reproducibilitySha256",
      "evidenceInputIndexSha256",
      "sourceGovulncheckSha256",
      "binaryGovulncheckSha256",
      "securityFindingMatrixSha256",
      "frontendSbomSha256",
      "frontendVulnerabilityReportSha256",
      "frontendRuntimeBindingSha256",
      "artifactLicenseEvidenceSha256",
    ]) ||
    evidence?.ociArchiveSha256 === "PENDING" ||
    !digestPattern.test(evidence?.ociArchiveSha256 ?? "") ||
    !Number.isSafeInteger(evidence?.ociArchiveBytes) ||
    evidence.ociArchiveBytes <= 0 ||
    evidence?.indexDigest === "PENDING" ||
    !ociDigestPattern.test(evidence?.indexDigest ?? "") ||
    evidence?.manifestDigest === "PENDING" ||
    !ociDigestPattern.test(evidence?.manifestDigest ?? "") ||
    evidence?.configDigest === "PENDING" ||
    !ociDigestPattern.test(evidence?.configDigest ?? "") ||
    !Array.isArray(evidence?.layerDigests) ||
    evidence.layerDigests.length === 0 ||
    evidence.layerDigests.some(
      (digest) => !ociDigestPattern.test(digest ?? ""),
    ) ||
    new Set(evidence.layerDigests).size !== evidence.layerDigests.length ||
    !digestPattern.test(evidence?.runtimeInventorySha256 ?? "") ||
    evidence?.independentBuilds !== 2 ||
    evidence?.byteIdentical !== true
  ) {
    errors.push(
      "Portainer artifact evidence is PENDING, incomplete, or not reproducible",
    )
  }

  const sbom = validateEvidenceFile(
    errors,
    normalizedRoot,
    evidence,
    "sbomSha256",
    "Portainer SBOM",
  )
  const provenance = validateEvidenceFile(
    errors,
    normalizedRoot,
    evidence,
    "provenanceSha256",
    "Portainer provenance",
  )
  const trivy = validateEvidenceFile(
    errors,
    normalizedRoot,
    evidence,
    "vulnerabilityReportSha256",
    "Portainer Trivy report",
  )
  const misconfigurationReport = validateEvidenceFile(
    errors,
    normalizedRoot,
    evidence,
    "misconfigurationReportSha256",
    "Portainer Dockerfile misconfiguration report",
  )
  const reproducibility = validateEvidenceFile(
    errors,
    normalizedRoot,
    evidence,
    "reproducibilitySha256",
    "Portainer reproducibility",
  )
  const matrix = validateEvidenceFile(
    errors,
    normalizedRoot,
    evidence,
    "securityFindingMatrixSha256",
    "Portainer security matrix",
  )
  const sourceGovulncheck = validateEvidenceFile(
    errors,
    normalizedRoot,
    evidence,
    "sourceGovulncheckSha256",
    "Portainer source govulncheck",
    "text",
  )
  const binaryGovulncheck = validateEvidenceFile(
    errors,
    normalizedRoot,
    evidence,
    "binaryGovulncheckSha256",
    "Portainer binary govulncheck",
    "text",
  )
  const evidenceIndex = validateEvidenceFile(
    errors,
    normalizedRoot,
    evidence,
    "evidenceInputIndexSha256",
    "Portainer evidence input index",
  )
  const frontendRuntimeBinding = validateEvidenceFile(
    errors,
    normalizedRoot,
    evidence,
    "frontendRuntimeBindingSha256",
    "Portainer frontend runtime binding",
  )
  const frontendSbom = validateEvidenceFile(
    errors,
    normalizedRoot,
    evidence,
    "frontendSbomSha256",
    "Portainer frontend SBOM",
  )
  const frontendTrivy = validateEvidenceFile(
    errors,
    normalizedRoot,
    evidence,
    "frontendVulnerabilityReportSha256",
    "Portainer frontend Trivy report",
  )
  const artifactLicenseEvidence = validateEvidenceFile(
    errors,
    normalizedRoot,
    evidence,
    "artifactLicenseEvidenceSha256",
    "Portainer artifact license evidence",
  )
  const validatedIndex = validateEvidenceIndex(
    errors,
    evidenceIndex,
    manifest,
    normalizedRoot,
  )
  const validatedRuntimeBinding = validateFrontendRuntimeBinding(
    errors,
    frontendRuntimeBinding,
    manifest,
    validatedIndex,
  )
  const assemblyReceipts = validateAssemblyReceipts(
    errors,
    normalizedRoot,
    manifest,
    validatedIndex,
  )
  const matrixIdentities = matrixIdentityMap(errors, matrix)
  const sourceGovuln = validateGovulncheck(
    errors,
    sourceGovulncheck,
    "Portainer source govulncheck",
    "source",
    validatedIndex,
    matrixIdentities,
  )
  const binaryGovuln = validateGovulncheck(
    errors,
    binaryGovulncheck,
    "Portainer binary govulncheck",
    "binary",
    validatedIndex,
    matrixIdentities,
  )
  validateSbom(errors, sbom, manifest, validatedIndex)
  validateFrontendSbom(
    errors,
    frontendSbom,
    manifest,
    validatedIndex,
    validatedRuntimeBinding,
    artifactLicenseEvidence,
  )
  validateCombinedFrontendSbom(errors, sbom, frontendSbom)
  validateProvenance(
    errors,
    provenance,
    manifest,
    validatedIndex,
    validatedRuntimeBinding,
    artifactLicenseEvidence,
    assemblyReceipts,
  )
  validateTrivy(errors, trivy, manifest, validatedIndex)
  const validatedFrontendScan = validateFrontendTrivy(
    errors,
    frontendTrivy,
    manifest,
    validatedIndex,
    validatedRuntimeBinding,
  )
  validateReproducibility(
    errors,
    reproducibility,
    manifest,
    validatedIndex,
    validatedRuntimeBinding,
    assemblyReceipts,
  )
  validateSourceControlledLicenseEvidence(
    errors,
    normalizedRoot,
    manifest,
    validatedIndex,
    validatedRuntimeBinding,
    artifactLicenseEvidence,
  )
  validateArtifactLicenseEvidence(
    errors,
    artifactLicenseEvidence,
    sbom,
    manifest,
    validatedIndex,
    validatedRuntimeBinding,
  )
  validateMisconfigurationEvidence(
    errors,
    misconfigurationReport,
    matrix,
    manifest,
    trivy,
  )
  validateSecurityMatrix(
    errors,
    matrix,
    trivy,
    frontendTrivy,
    validatedFrontendScan,
    manifest,
    validatedIndex,
    sourceGovuln,
    binaryGovuln,
    now,
    matrixIdentities,
    assemblyReceipts,
  )
  validateLicenseReview(errors, licenseReview, manifest)
  validateCommercialBoundary(errors, manifest, {
    sbom,
    provenance,
    trivy,
    misconfigurationReport,
    reproducibility,
    evidenceIndex,
    sourceGovulncheck,
    binaryGovulncheck,
    matrix,
    licenseReview,
    frontendRuntimeBinding,
    frontendSbom,
    frontendTrivy,
    artifactLicenseEvidence,
  })

  const boundary = manifest?.admissionBoundary
  if (!boundary || Object.values(boundary).some((value) => value !== false)) {
    errors.push(
      "Portainer R1 must remain outside Product integration and activation",
    )
  }
  return [...new Set(errors)].sort()
}

export function readSourcePackage() {
  return JSON.parse(
    readFileSync(path.join(directory, "source-package.json"), "utf8"),
  )
}

export function verifyCheckedInSourcePackage(options = {}) {
  return validateSourcePackage(readSourcePackage(), repositoryRoot, options)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const errors = verifyCheckedInSourcePackage()
  if (errors.length > 0) {
    console.error(errors.join("\n"))
    process.exitCode = 1
  } else {
    console.log("Portainer CE downstream source package validated.")
  }
}
