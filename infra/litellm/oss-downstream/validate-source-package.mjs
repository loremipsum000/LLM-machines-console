#!/usr/bin/env node

import { createHash } from "node:crypto"
import { lstatSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const directory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(directory, "../../..")
const digestPattern = /^[a-f0-9]{64}$/
const ociDigestPattern = /^sha256:[a-f0-9]{64}$/
const commitPattern = /^[a-f0-9]{40}$/

const expectedRemovedPaths = [
  ".github/workflows/test-unit-enterprise-routing.yml",
  "docker/build_admin_ui.sh",
  "enterprise",
  "litellm/proxy/enterprise",
  "litellm/proxy/enterprise_billing",
  "litellm/proxy/example_config_yaml/enterprise_config.yaml",
  "tests/code_coverage_tests/check_unsafe_enterprise_import.py",
  "tests/enterprise",
  "tests/local_testing/test_blocked_user_list.py",
  "tests/local_testing/test_llm_guard.py",
  "tests/local_testing/test_openai_moderations_hook.py",
  "tests/local_testing/test_secret_detect_hook.py",
  "tests/logging_callback_tests/test_pagerduty_alerting.py",
  "tests/proxy_unit_tests/test_banned_keyword_list.py",
  "tests/proxy_unit_tests/test_check_batch_cost.py",
  "tests/proxy_unit_tests/test_check_responses_cost.py",
  "tests/proxy_unit_tests/test_proxy_reject_logging.py",
  "tests/test_litellm/enterprise",
  "tests/test_litellm/integrations/test_responses_background_cost.py",
  "tests/test_litellm/llms/test_file_search_responses.py",
  "tests/test_litellm/proxy/auth/test_route_checks.py",
  "tests/test_litellm/proxy/enterprise_billing",
  "tests/test_litellm/proxy/guardrails/test_guardrail_coverage.py",
  "tests/test_litellm/proxy/hooks/test_proxy_hooks_init.py",
  "tests/test_litellm/proxy/management_endpoints/test_key_management_endpoints.py",
  "tests/test_litellm/proxy/management_endpoints/test_project_org_authz.py",
  "tests/test_litellm/proxy/management_endpoints/test_ui_sso.py",
]

const expectedBuildInputs = [
  [
    "dockerfile-frontend",
    "sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e",
    "sha256:b5f3b260a9678e1d83d2fce86eeddf79420b79147eaba2a25986f47133d73720",
  ],
  [
    "wolfi-build-runtime-base",
    "sha256:42df77a9974d6ec8b17a5ee8bc23b532600a44d705acef2409e0933c1251b45f",
    "sha256:85ecaa3f494ee2339eaf6f74a23f19f934df3019a9a9dfc8c06f53c3aacc4e6b",
  ],
  [
    "uv-builder",
    "sha256:240fb85ab0f263ef12f492d8476aa3a2e4e1e333f7d67fbdd923d00a506a516a",
    "sha256:733b4042187702f832f7fdecb3aff14a61b288c4ca37af188bb5715c1caebaf8",
  ],
  [
    "node-ui-builder",
    "sha256:3488b10bf958af7125a176419d2d8a9937d895bf124012aae811651988d2ffe6",
    "sha256:d4b8042fdb02ab03737ac36b5ebf7f316a595a8350829ef79339ff5f0b33aaa7",
  ],
]

export function sha256File(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex")
}

function validateLocalFile(errors, root, entry, label) {
  if (!entry || typeof entry.path !== "string") {
    errors.push(`${label} path is missing`)
    return
  }
  if (!digestPattern.test(entry.sha256 ?? "")) {
    errors.push(`${label} SHA-256 is invalid`)
    return
  }
  const file = path.resolve(root, entry.path)
  if (!file.startsWith(`${root}${path.sep}`)) {
    errors.push(`${label} path escapes the repository`)
    return
  }
  try {
    if (!lstatSync(file).isFile()) {
      errors.push(`${label} must be a regular file`)
    } else if (sha256File(file) !== entry.sha256) {
      errors.push(`${label} differs from its locked SHA-256`)
    }
  } catch {
    errors.push(`${label} is missing`)
  }
}

export function validateSourcePackage(manifest, root = repositoryRoot) {
  const errors = []
  if (manifest?.schema !== "llm-machines.litellm-oss-downstream-source.v1") {
    errors.push("LiteLLM OSS downstream schema is not v1")
  }
  if (manifest?.status !== "SOURCE_READY_RUNTIME_UNQUALIFIED") {
    errors.push("LiteLLM OSS downstream must remain source-ready only")
  }
  if (manifest?.containsCredentials !== false) {
    errors.push("LiteLLM OSS downstream must be credential-free")
  }
  if (manifest?.runtimeQualified !== false) {
    errors.push("LiteLLM OSS downstream cannot claim runtime qualification")
  }

  const upstream = manifest?.upstream
  if (upstream?.version !== "v1.96.2") {
    errors.push("LiteLLM upstream version differs")
  }
  if (upstream?.revision !== "83d6d84bfb7abbbff70d456bc89028d426db8c33") {
    errors.push("LiteLLM upstream revision differs")
  }
  if (upstream?.tree !== "dfc8f21f0a23a6ec279b22921d82b61306a05bc1") {
    errors.push("LiteLLM upstream tree differs")
  }
  if (!commitPattern.test(upstream?.revision ?? "")) {
    errors.push("LiteLLM upstream revision must be an exact commit")
  }
  if (
    upstream?.archiveSha256 !==
    "fc864419108ace3251b0d1f7f9f27fa7841afb1b229377ce014aecf6ac16103c"
  ) {
    errors.push("LiteLLM upstream archive differs")
  }
  if (upstream?.license !== "MIT") {
    errors.push("LiteLLM OSS license must remain MIT")
  }
  if (upstream?.image?.platform !== "linux/amd64") {
    errors.push("LiteLLM upstream image must bind linux/amd64")
  }
  for (const [field, value] of [
    ["indexDigest", upstream?.image?.indexDigest],
    ["platformDigest", upstream?.image?.platformDigest],
    ["configDigest", upstream?.image?.configDigest],
  ]) {
    if (!ociDigestPattern.test(value ?? "")) {
      errors.push(`LiteLLM upstream ${field} is invalid`)
    }
  }

  validateLocalFile(
    errors,
    root,
    {
      path: upstream?.signature?.publicKeyPath,
      sha256: upstream?.signature?.publicKeySha256,
    },
    "LiteLLM upstream Cosign key",
  )
  if (
    upstream?.signature?.verifiedIndexDigest !== upstream?.image?.indexDigest
  ) {
    errors.push("LiteLLM Cosign evidence does not bind the upstream index")
  }

  const downstream = manifest?.downstream
  if (downstream?.version !== "v1.96.2-llmm.1") {
    errors.push("LiteLLM downstream version differs")
  }
  if (downstream?.platform !== "linux/amd64") {
    errors.push("LiteLLM downstream must bind linux/amd64")
  }
  if (downstream?.mirrorRepository !== "core/litellm-oss") {
    errors.push("LiteLLM downstream mirror path differs")
  }
  validateLocalFile(
    errors,
    root,
    downstream?.patch,
    "LiteLLM OSS removal patch",
  )
  validateLocalFile(
    errors,
    root,
    downstream?.enterpriseBridgeStrip,
    "LiteLLM Enterprise bridge strip",
  )
  if (
    JSON.stringify(downstream?.removedPaths) !==
    JSON.stringify(expectedRemovedPaths)
  ) {
    errors.push("LiteLLM OSS removal set differs")
  }
  if (
    downstream?.sourceInventory?.fileCount !== 9019 ||
    downstream?.sourceInventory?.sha256SumsSha256 !==
      "4d1afbdc042e71ed96cbef390e534d3a78fd767369c9c09853aca6ba6257e90c"
  ) {
    errors.push("LiteLLM sanitized source inventory differs")
  }
  const expectedApkInputs = {
    builder: [
      "bash=5.3-r12",
      "gcc=16.1.0-r4",
      "python3=3.13.15-r0",
      "python3-dev=3.13.15-r0",
      "rust=1.97.1-r0",
      "openssl=3.6.3-r4",
      "openssl-dev=3.6.3-r4",
      "nodejs=26.7.0-r0",
      "npm=12.0.2-r2",
      "libsndfile=1.2.2-r4",
    ],
    runtime: [
      "bash=5.3-r12",
      "openssl=3.6.3-r4",
      "tzdata=2026c-r0",
      "nodejs=26.7.0-r0",
      "python3=3.13.15-r0",
      "libsndfile=1.2.2-r4",
    ],
  }
  if (
    JSON.stringify(downstream?.apkInputs) !== JSON.stringify(expectedApkInputs)
  ) {
    errors.push("LiteLLM OSS APK inputs differ")
  }

  const actualBuildInputs = (downstream?.buildInputs ?? []).map((entry) => [
    entry.id,
    entry.indexDigest,
    entry.platformDigest,
  ])
  if (
    JSON.stringify(actualBuildInputs) !== JSON.stringify(expectedBuildInputs)
  ) {
    errors.push("LiteLLM OSS build inputs differ")
  }
  for (const input of downstream?.buildInputs ?? []) {
    if (input.platform !== "linux/amd64") {
      errors.push(`${input.id} must bind linux/amd64`)
    }
  }

  const sourceAssembly = downstream?.sourceAssembly
  if (
    sourceAssembly?.independentAssemblies !== 2 ||
    sourceAssembly?.sourcePacketSha256 !==
      "4f6983e5b27351e95a9b60757a0cb31caa2a76c8efa93cbe4f97c1a6536c4227" ||
    sourceAssembly?.inventoryDocumentSha256 !==
      "80913c36cd866e20def9a7314feb1f1cbf5a430e2feb0a37de83be7d3d1a575e" ||
    sourceAssembly?.byteIdentical !== true
  ) {
    errors.push("LiteLLM sanitized source assembly evidence differs")
  }

  const artifact = downstream?.artifactEvidence
  if (
    artifact?.ociArchiveSha256 !==
      "3b5f3d8005b3a7ba87e2ccbbd8002e61e5875d1c9ca8945f14f485f88f499509" ||
    artifact?.ociArchiveBytes !== 319129600 ||
    artifact?.manifestDigest !==
      "sha256:37be0e64e02f7cd2667f6aaa318a69bdde737c6c564ee0a03471bbfff2912244" ||
    artifact?.configDigest !==
      "sha256:d1396589f1fed1fa3e67142c5f93189e257db14ce92ce9d952fbf18a58350f6b" ||
    artifact?.independentBuilds !== 2 ||
    artifact?.byteIdentical !== true
  ) {
    errors.push("LiteLLM deterministic OCI evidence differs")
  }
  if (
    artifact?.sbom?.format !== "CycloneDX 1.7" ||
    artifact?.sbom?.tool !== "Syft 1.50.0" ||
    artifact?.sbom?.components !== 3867 ||
    artifact?.sbom?.dependencies !== 165 ||
    artifact?.sbom?.enterpriseMaterial !== false ||
    !digestPattern.test(artifact?.sbom?.sha256 ?? "")
  ) {
    errors.push("LiteLLM SBOM evidence differs")
  }
  if (
    artifact?.vulnerability?.scanner !== "Trivy 0.73.0" ||
    !digestPattern.test(artifact?.vulnerability?.reportSha256 ?? "") ||
    ["critical", "high", "medium", "low", "unknown"].some(
      (severity) => artifact?.vulnerability?.[severity] !== 0,
    )
  ) {
    errors.push("LiteLLM vulnerability evidence differs")
  }
  if (
    artifact?.license?.topLevel !== "MIT" ||
    artifact?.license?.enterpriseMaterial !== false ||
    artifact?.license?.transitiveCopyleftSourceRequired !== true ||
    artifact?.license?.sourcePacketId !== "litellm-oss-transitive-sources" ||
    !Array.isArray(artifact?.license?.copyleftComponents) ||
    artifact.license.copyleftComponents.length !== 17
  ) {
    errors.push("LiteLLM license evidence differs")
  }

  const authentication = manifest?.authentication
  if (
    authentication?.mechanism !== "Generic OIDC Authorization Code with PKCE"
  ) {
    errors.push("LiteLLM native login must use Generic OIDC with PKCE")
  }
  if (
    authentication?.nativeSessionRequired !== true ||
    authentication?.consoleSessionForwarding !== false ||
    authentication?.licenseMaterialAllowed !== false ||
    authentication?.billableUserLimit !== 5
  ) {
    errors.push("LiteLLM native authentication boundary differs")
  }
  if (
    JSON.stringify(authentication?.roles) !==
    JSON.stringify({ Admin: "proxy_admin", Operator: "internal_user" })
  ) {
    errors.push("LiteLLM native role mapping differs")
  }
  if (
    authentication?.serviceSession?.keycloakIdleSeconds !== 28_800 ||
    authentication?.serviceSession?.keycloakMaximumSeconds !== 86_400 ||
    authentication?.serviceSession?.liteLlmFixedMaximumSeconds !== 28_800 ||
    !authentication?.serviceSession?.limitation?.includes(
      "not a sliding native idle timeout",
    )
  ) {
    errors.push("LiteLLM native session limitation differs")
  }

  const qualification = manifest?.qualification
  for (const [field, prefix] of [
    ["databaseMigration", "PASS_"],
    ["nativeOidc", "PASS_"],
    ["roleBoundary", "PASS_"],
    ["routingAndAccounting", "PASS_"],
    ["zeroContentRetention", "PASS_"],
    ["restartAndOutage", "PASS"],
    ["noBypass", "PASS_"],
  ]) {
    if (!qualification?.[field]?.startsWith(prefix))
      errors.push(`LiteLLM ${field} qualification is incomplete`)
  }

  const patch = readFileSync(path.resolve(root, downstream.patch.path), "utf8")
  for (const forbidden of [
    "-COPY enterprise/pyproject.toml enterprise/",
    "-COPY --from=builder /app/enterprise /app/enterprise",
    '-    "litellm-enterprise==0.1.53",',
  ]) {
    if (!patch.includes(forbidden)) {
      errors.push(`LiteLLM removal patch does not remove ${forbidden}`)
    }
  }
  if (
    !patch.includes(
      "+# syntax=docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e",
    )
  ) {
    errors.push("LiteLLM Dockerfile frontend is not pinned by digest")
  }
  for (const apkInput of [
    ...expectedApkInputs.builder,
    ...expectedApkInputs.runtime,
  ]) {
    if (!patch.includes(`+    ${apkInput}`)) {
      errors.push(`LiteLLM Dockerfile does not pin ${apkInput}`)
    }
  }

  return errors
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const manifest = JSON.parse(
    readFileSync(path.resolve(directory, "source-package.json"), "utf8"),
  )
  const errors = validateSourcePackage(manifest)
  if (errors.length > 0) {
    console.error(errors.join("\n"))
    process.exit(1)
  }
  console.log("LiteLLM OSS downstream source package is valid")
}
