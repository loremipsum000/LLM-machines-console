#!/usr/bin/env node

import { createHash } from "node:crypto"
import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

const digestPattern = /^sha256:[0-9a-f]{64}$/
const gitIdPattern = /^[0-9a-f]{40}$/
const profileIdPattern = /^[a-z0-9][a-z0-9.-]{2,62}$/
const placementKeys = [
  "LLMM_BFF_IMAGE",
  "LLMM_CONFIGURATION_ROOT",
  "LLMM_EDGE_IMAGE",
  "LLMM_INFERENCE_CORE_COMPATIBILITY_FINGERPRINT",
  "LLMM_INFERENCE_HOST",
  "LLMM_INFERENCE_MODEL_ADMISSION_DIR",
  "LLMM_INFERENCE_PROFILE_FILE",
  "LLMM_INFERENCE_PROFILE_ID",
  "LLMM_INFERENCE_PROFILE_REVISION",
  "LLMM_INFERENCE_QUALIFIED_PROFILE_DIGEST",
  "LLMM_INFERENCE_RENDERED_PROFILE_DIGEST",
  "LLMM_INFERENCE_WORKLOAD_UNIT",
  "LLMM_SECRET_ROOT",
  "LLMM_SOURCE_ROOT",
  "LLMM_WEB_IMAGE",
]
export const founderRuntimeImportAllowedNames = [
  "ADMIN_ALERTMANAGER_BASE_URL",
  "ADMIN_ALERTMANAGER_TIMEOUT_MS",
  "ADMIN_GRAFANA_BASE_URL",
  "ADMIN_GRAFANA_TIMEOUT_MS",
  "ADMIN_LITELLM_BASE_URL",
  "ADMIN_LITELLM_TIMEOUT_MS",
  "ADMIN_PROMETHEUS_BASE_URL",
  "ADMIN_PROMETHEUS_TIMEOUT_MS",
  "FIRECRAWL_APPLIANCE_KILL_SWITCH",
  "FIRECRAWL_EGRESS_ALLOWED_HOSTS",
  "FIRECRAWL_EGRESS_ALLOWLIST_DIR",
  "FIRECRAWL_EGRESS_POLICY_READY",
  "FIRECRAWL_INSTALLED",
  "FIRECRAWL_PUBLIC_BASE_URL",
  "FIRECRAWL_RESOURCE_PROFILE_QUALIFIED",
  "FIRECRAWL_UPSTREAM_BASE_URL",
  "KEYCLOAK_ADMIN_BASE_URL",
  "KEYCLOAK_ADMIN_CLIENT_ID",
  "KEYCLOAK_ADMIN_REALM",
  "KEYCLOAK_APPLICATION_ADMIN_CLIENT_ID",
  "KEYCLOAK_APPLICATION_ADMIN_REALM",
  "PRE_GENESIS_FIRECRAWL_ACTUAL",
  "PRE_GENESIS_FIRECRAWL_ALLOWED_HOSTS",
  "PRE_GENESIS_FIRECRAWL_UPSTREAM_BASE_URL",
  "TEAM_ALLOWED_EMAIL_DOMAINS",
]
const secretFiles = [
  "bff-service-api-key",
  "console-oidc-client-secret",
  "database-url",
  "keycloak-admin-client-secret",
  "keycloak-application-admin-client-secret",
  "litellm-key",
]
const privateConfigurationFiles = [
  "edge-ca.crt",
  "edge.crt",
  "edge.key",
  "session-keyring.json",
]
const sourceMountFiles = [
  "infra/ingress/proxy-common.inc",
  "infra/ingress/request-headers-console-browser.inc",
  "infra/ingress/request-headers-customer-api.inc",
  "infra/ingress/request-headers-grafana-browser.inc",
  "infra/ingress/request-headers-identity-browser.inc",
  "infra/ingress/request-headers-keycloak-admin-browser.inc",
  "infra/ingress/request-headers-litellm-browser.inc",
  "infra/ingress/request-safety.inc",
]
const composeVariableInputs = [
  "- ${LLMM_CONFIGURATION_ROOT:?configuration root required}/web.env",
  "- ${LLMM_SECRET_ROOT:?secret root required}/bff-service-api-key:/run/secrets/llmm_bff_service_api_key:ro",
  "- ${LLMM_CONFIGURATION_ROOT}/runtime-import.env",
  "- ${LLMM_CONFIGURATION_ROOT:?configuration root required}/bff.env",
  "- ${LLMM_SECRET_ROOT}/bff-service-api-key:/run/secrets/llmm_bff_service_api_key:ro",
  "- ${LLMM_SECRET_ROOT}/console-oidc-client-secret:/run/secrets/llmm_console_oidc_client_secret:ro",
  "- ${LLMM_SECRET_ROOT}/database-url:/run/secrets/llmm_database_url:ro",
  "- ${LLMM_SECRET_ROOT}/litellm-key:/run/secrets/llmm_litellm_key:ro",
  "- ${LLMM_SECRET_ROOT}/keycloak-admin-client-secret:/run/secrets/llmm_keycloak_admin_client_secret:ro",
  "- ${LLMM_SECRET_ROOT}/keycloak-application-admin-client-secret:/run/secrets/llmm_keycloak_application_admin_client_secret:ro",
  "- ${LLMM_CONFIGURATION_ROOT}/session-keyring.json:/run/llm-machines/session-keyring.json:ro",
  "- ${LLMM_CONFIGURATION_ROOT}/edge-ca.crt:/run/llm-machines/edge-ca.crt:ro",
  "- ${LLMM_CONFIGURATION_ROOT}/non-restorable-isolation:/run/llm-machines/non-restorable-isolation",
  "- ${LLMM_INFERENCE_MODEL_ADMISSION_DIR:?admission directory required}:/run/llm-machines/inference-admission:ro",
  "- ${LLMM_CONFIGURATION_ROOT}/product-edge.nginx.conf:/etc/nginx/nginx.conf:ro",
  "- ${LLMM_SOURCE_ROOT:?source root required}/infra/ingress/proxy-common.inc:/etc/nginx/llm-machines/proxy-common.inc:ro",
  "- ${LLMM_SOURCE_ROOT}/infra/ingress/request-safety.inc:/etc/nginx/llm-machines/request-safety.inc:ro",
  "- ${LLMM_SOURCE_ROOT}/infra/ingress/request-headers-console-browser.inc:/etc/nginx/llm-machines/request-headers-console-browser.inc:ro",
  "- ${LLMM_SOURCE_ROOT}/infra/ingress/request-headers-customer-api.inc:/etc/nginx/llm-machines/request-headers-customer-api.inc:ro",
  "- ${LLMM_SOURCE_ROOT}/infra/ingress/request-headers-identity-browser.inc:/etc/nginx/llm-machines/request-headers-identity-browser.inc:ro",
  "- ${LLMM_SOURCE_ROOT}/infra/ingress/request-headers-grafana-browser.inc:/etc/nginx/llm-machines/request-headers-grafana-browser.inc:ro",
  "- ${LLMM_SOURCE_ROOT}/infra/ingress/request-headers-litellm-browser.inc:/etc/nginx/llm-machines/request-headers-litellm-browser.inc:ro",
  "- ${LLMM_SOURCE_ROOT}/infra/ingress/request-headers-keycloak-admin-browser.inc:/etc/nginx/llm-machines/request-headers-keycloak-admin-browser.inc:ro",
  "- ${LLMM_CONFIGURATION_ROOT}/edge.crt:/run/secrets/llmm_edge_tls_certificate:ro",
  "- ${LLMM_CONFIGURATION_ROOT}/edge.key:/run/secrets/llmm_edge_tls_private_key:ro",
]
const composeSecretMappings = [
  "LLMM_RUNTIME_SECRET_FILES: CONSOLE_BFF_SERVICE_API_KEY=/run/secrets/llmm_bff_service_api_key",
  "LLMM_RUNTIME_SECRET_FILES: BFF_SERVICE_API_KEY=/run/secrets/llmm_bff_service_api_key,CONSOLE_OIDC_CLIENT_SECRET=/run/secrets/llmm_console_oidc_client_secret,DATABASE_URL=/run/secrets/llmm_database_url,LITELLM_KEY=/run/secrets/llmm_litellm_key,ADMIN_LITELLM_API_KEY=/run/secrets/llmm_litellm_key,KEYCLOAK_ADMIN_CLIENT_SECRET=/run/secrets/llmm_keycloak_admin_client_secret,KEYCLOAK_APPLICATION_ADMIN_CLIENT_SECRET=/run/secrets/llmm_keycloak_application_admin_client_secret",
]
const composeVariableNames = [
  "LLMM_BFF_IMAGE",
  "LLMM_CONFIGURATION_ROOT",
  "LLMM_EDGE_IMAGE",
  "LLMM_INFERENCE_MODEL_ADMISSION_DIR",
  "LLMM_SECRET_ROOT",
  "LLMM_SOURCE_ROOT",
  "LLMM_WEB_IMAGE",
]

export function verifyFounderRuntimeCustody({
  admissionRoot,
  composePath,
  configurationRoot,
  expectedCommit,
  expectedManifestDigest,
  expectedRuntimeBindingManifestDigest,
  expectedTree,
  expectedUid = 0,
  now = new Date(),
  secretRoot,
  sourceRoot,
}) {
  if (
    !gitIdPattern.test(expectedCommit) ||
    !gitIdPattern.test(expectedTree) ||
    !digestPattern.test(expectedManifestDigest) ||
    !digestPattern.test(expectedRuntimeBindingManifestDigest) ||
    !Number.isSafeInteger(expectedUid) ||
    expectedUid < 0 ||
    !(now instanceof Date) ||
    !Number.isFinite(now.getTime())
  ) {
    fail()
  }

  const canonicalConfigurationRoot = inspectDirectory(
    configurationRoot,
    0o700,
    expectedUid,
  )
  const canonicalSecretRoot = inspectDirectory(secretRoot, 0o700, expectedUid)
  const canonicalAdmissionRoot = inspectDirectory(
    admissionRoot,
    0o700,
    expectedUid,
  )
  const canonicalSourceRoot = inspectDirectory(
    sourceRoot,
    undefined,
    expectedUid,
  )
  const canonicalComposePath = resolve(
    canonicalSourceRoot,
    "infra/deployment/vm103-founder-candidate.compose.yaml",
  )
  if (resolve(composePath) !== canonicalComposePath) fail()

  const manifestBytes = readCredentialFreeFile(
    resolve(canonicalConfigurationRoot, "rendered-config-manifest.json"),
    0o600,
    expectedUid,
  )
  if (sha256(manifestBytes) !== expectedManifestDigest) fail()
  const manifest = parseJson(manifestBytes)
  if (
    !exactKeys(manifest, ["artifacts", "schema", "source"]) ||
    manifest.schema !== "llm-machines.vm103-founder-rendered-config.v1" ||
    !exactKeys(manifest.source, ["commit", "tree"]) ||
    manifest.source.commit !== expectedCommit ||
    manifest.source.tree !== expectedTree ||
    !Array.isArray(manifest.artifacts)
  ) {
    fail()
  }

  const placementBytes = readCredentialFreeFile(
    resolve(canonicalConfigurationRoot, "placement.env"),
    0o600,
    expectedUid,
  )
  const placementArtifacts = manifest.artifacts.filter(
    (artifact) => artifact?.name === "placement.env",
  )
  if (
    placementArtifacts.length !== 1 ||
    placementArtifacts[0]?.sha256 !== sha256(placementBytes)
  ) {
    fail()
  }
  const placement = parseEnvironment(placementBytes.toString("utf8"))
  validatePlacement(
    placement,
    canonicalConfigurationRoot,
    canonicalSecretRoot,
    canonicalAdmissionRoot,
    canonicalSourceRoot,
  )

  const runtimeImportBytes = readCredentialFreeFile(
    resolve(canonicalConfigurationRoot, "runtime-import.env"),
    0o600,
    expectedUid,
  )
  const runtimeImportNames = validateRuntimeImport(
    runtimeImportBytes.toString("utf8"),
  )

  for (const name of secretFiles) {
    inspectPrivateFile(resolve(canonicalSecretRoot, name), 0o600, expectedUid)
  }
  for (const name of privateConfigurationFiles) {
    inspectPrivateFile(
      resolve(canonicalConfigurationRoot, name),
      0o600,
      expectedUid,
    )
  }
  inspectDirectory(
    resolve(canonicalConfigurationRoot, "non-restorable-isolation"),
    0o700,
    expectedUid,
  )

  const profile = validateAdmissionProfile(
    canonicalAdmissionRoot,
    placement,
    expectedUid,
    now,
  )
  const route = validateLiteLlmRuntimeBinding(
    canonicalConfigurationRoot,
    expectedRuntimeBindingManifestDigest,
    expectedManifestDigest,
    expectedCommit,
    expectedTree,
    placementBytes,
    placement,
    profile,
    expectedUid,
  )
  const composeBytes = readCredentialFreeFile(
    canonicalComposePath,
    undefined,
    expectedUid,
  )
  validateCompose(
    composeBytes.toString("utf8"),
    canonicalSourceRoot,
    expectedUid,
  )

  return {
    admission: profile,
    composeDigest: sha256(composeBytes),
    externalPrivateFiles: [...secretFiles, ...privateConfigurationFiles]
      .sort()
      .map((name) => ({ mode: "0600", name })),
    renderedConfigurationManifestDigest: expectedManifestDigest,
    runtimeBindingManifestDigest: expectedRuntimeBindingManifestDigest,
    liteLlmRoute: route,
    renderedPlacementDigest: sha256(placementBytes),
    runtimeImport: {
      names: runtimeImportNames,
      sha256: sha256(runtimeImportBytes),
    },
    state: "exact-runtime-custody",
  }
}

function validateLiteLlmRuntimeBinding(
  configurationRoot,
  expectedRuntimeBindingManifestDigest,
  expectedRenderedConfigurationManifestDigest,
  expectedCommit,
  expectedTree,
  placementBytes,
  placement,
  profile,
  expectedUid,
) {
  const manifestBytes = readCredentialFreeFile(
    resolve(configurationRoot, "litellm-runtime-binding-manifest.json"),
    0o600,
    expectedUid,
  )
  if (sha256(manifestBytes) !== expectedRuntimeBindingManifestDigest) fail()
  const manifest = parseJson(manifestBytes)
  if (
    !exactKeys(manifest, [
      "artifacts",
      "renderedConfigurationManifestDigest",
      "schema",
      "source",
    ]) ||
    manifest.schema !== "llm-machines.vm103-founder-runtime-bindings.v1" ||
    manifest.renderedConfigurationManifestDigest !==
      expectedRenderedConfigurationManifestDigest ||
    !exactKeys(manifest.source, ["commit", "tree"]) ||
    manifest.source.commit !== expectedCommit ||
    manifest.source.tree !== expectedTree ||
    !Array.isArray(manifest.artifacts) ||
    JSON.stringify(manifest.artifacts.map((artifact) => artifact?.name)) !==
      JSON.stringify([
        "litellm-inference-route.yaml",
        "litellm-route-receipt.json",
      ])
  ) {
    fail()
  }
  const artifactBytes = {}
  for (const artifact of manifest.artifacts) {
    if (
      !exactKeys(artifact, ["name", "sha256"]) ||
      !digestPattern.test(artifact.sha256)
    ) {
      fail()
    }
    const bytes = readCredentialFreeFile(
      resolve(configurationRoot, artifact.name),
      0o600,
      expectedUid,
    )
    if (sha256(bytes) !== artifact.sha256) fail()
    artifactBytes[artifact.name] = bytes
  }
  const config = artifactBytes["litellm-inference-route.yaml"].toString("utf8")
  const receipt = parseJson(artifactBytes["litellm-route-receipt.json"])
  const expectedReceiptKeys = [
    "apiBase",
    "configDigest",
    "coreCompatibilityFingerprint",
    "engineImageDigest",
    "evidenceDigest",
    "modelAlias",
    "modelArtifactDigest",
    "modelManifestDigest",
    "profileId",
    "profileRevision",
    "qualifiedProfileDigest",
    "renderedConfigurationManifestDigest",
    "renderedPlacementDigest",
    "renderedProfileDigest",
    "rollback",
    "runtimeBindingDigest",
    "runtimeModelId",
    "schema",
  ]
  const port = commandArgument(profile.engine?.command, "--port")
  const expectedApiBase = `http://${placement.LLMM_INFERENCE_HOST}:${port}/v1`
  const imageDigest = profile.engine?.image?.match(/sha256:[0-9a-f]{64}$/)?.[0]
  const binding = {
    apiBase: expectedApiBase,
    evidenceDigest: profile.evidenceDigest,
    profileId: profile.profileId,
    profileRevision: profile.revision,
    qualifiedProfileDigest: profile.qualifiedProfileDigest,
    renderedConfigurationManifestDigest:
      expectedRenderedConfigurationManifestDigest,
    renderedPlacementDigest: sha256(placementBytes),
    renderedProfileDigest: profile.renderedProfileDigest,
  }
  const runtimeBindingDigest = sha256(canonicalJson(binding))
  const runtimeModelId = `llmm-route-${runtimeBindingDigest.slice(7)}`
  if (
    !exactKeys(receipt, expectedReceiptKeys) ||
    receipt.schema !== "llm-machines.vm103-litellm-route-receipt.v1" ||
    receipt.apiBase !== expectedApiBase ||
    receipt.configDigest !== sha256(config) ||
    receipt.coreCompatibilityFingerprint !==
      placement.LLMM_INFERENCE_CORE_COMPATIBILITY_FINGERPRINT ||
    receipt.engineImageDigest !== imageDigest ||
    receipt.evidenceDigest !== profile.evidenceDigest ||
    receipt.modelAlias !== profile.modelAlias ||
    receipt.modelArtifactDigest !== profile.modelArtifactDigest ||
    receipt.modelManifestDigest !== profile.modelManifestDigest ||
    receipt.profileId !== profile.profileId ||
    receipt.profileRevision !== profile.revision ||
    receipt.qualifiedProfileDigest !== profile.qualifiedProfileDigest ||
    receipt.renderedConfigurationManifestDigest !==
      expectedRenderedConfigurationManifestDigest ||
    receipt.renderedPlacementDigest !== sha256(placementBytes) ||
    receipt.renderedProfileDigest !== profile.renderedProfileDigest ||
    canonicalJson(receipt.rollback) !== canonicalJson(profile.rollback) ||
    receipt.runtimeBindingDigest !== runtimeBindingDigest ||
    receipt.runtimeModelId !== runtimeModelId ||
    config !==
      expectedLiteLlmRouteConfig(
        profile.modelAlias,
        expectedApiBase,
        runtimeModelId,
      )
  ) {
    fail()
  }
  return {
    configDigest: receipt.configDigest,
    modelAlias: receipt.modelAlias,
    runtimeBindingDigest,
    runtimeModelId,
  }
}

function validatePlacement(
  placement,
  configurationRoot,
  secretRoot,
  admissionRoot,
  sourceRoot,
) {
  if (
    JSON.stringify(Object.keys(placement).sort()) !==
      JSON.stringify(placementKeys) ||
    placement.LLMM_CONFIGURATION_ROOT !== configurationRoot ||
    placement.LLMM_SECRET_ROOT !== secretRoot ||
    placement.LLMM_INFERENCE_MODEL_ADMISSION_DIR !== admissionRoot ||
    placement.LLMM_SOURCE_ROOT !== sourceRoot ||
    !privateIpv4(placement.LLMM_INFERENCE_HOST) ||
    !profileIdPattern.test(placement.LLMM_INFERENCE_PROFILE_ID) ||
    placement.LLMM_INFERENCE_PROFILE_FILE !==
      `${placement.LLMM_INFERENCE_PROFILE_ID}.json` ||
    !/^[1-9][0-9]*$/.test(placement.LLMM_INFERENCE_PROFILE_REVISION) ||
    !digestPattern.test(
      placement.LLMM_INFERENCE_CORE_COMPATIBILITY_FINGERPRINT,
    ) ||
    !digestPattern.test(placement.LLMM_INFERENCE_QUALIFIED_PROFILE_DIGEST) ||
    !digestPattern.test(placement.LLMM_INFERENCE_RENDERED_PROFILE_DIGEST) ||
    !/^(?=.{1,128}$)(?:[a-z0-9][a-z0-9_.-]*-)?sglang(?:-[a-z0-9][a-z0-9_.-]*)?\.service$/.test(
      placement.LLMM_INFERENCE_WORKLOAD_UNIT,
    )
  ) {
    fail()
  }
}

function validateRuntimeImport(source) {
  const parsed = parseEnvironment(source, { allowEmpty: true })
  const names = Object.keys(parsed)
  if (
    JSON.stringify(names) !== JSON.stringify([...names].sort()) ||
    names.some(
      (name) =>
        !founderRuntimeImportAllowedNames.includes(name) ||
        /(?:PASSWORD|SECRET|TOKEN|CREDENTIAL|PRIVATE_KEY|API_KEY)/.test(name),
    )
  ) {
    fail()
  }
  for (const [name, value] of Object.entries(parsed)) {
    if (!runtimeImportValue(name, value)) fail()
  }
  return names
}

function runtimeImportValue(name, value) {
  if (!value || value.length > 2048 || /[\r\n\0$'"\\`]/.test(value)) {
    return false
  }
  if (name.endsWith("_TIMEOUT_MS")) {
    return /^[1-9][0-9]{1,4}$/.test(value) && Number(value) <= 60_000
  }
  if (
    name === "FIRECRAWL_APPLIANCE_KILL_SWITCH" ||
    name === "FIRECRAWL_EGRESS_POLICY_READY" ||
    name === "FIRECRAWL_INSTALLED" ||
    name === "FIRECRAWL_RESOURCE_PROFILE_QUALIFIED" ||
    name === "PRE_GENESIS_FIRECRAWL_ACTUAL"
  ) {
    return value === "true" || value === "false"
  }
  if (name.endsWith("_BASE_URL")) {
    try {
      const url = new URL(value)
      return (
        ["http:", "https:"].includes(url.protocol) &&
        (name !== "FIRECRAWL_PUBLIC_BASE_URL" || url.protocol === "https:") &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash
      )
    } catch {
      return false
    }
  }
  if (name === "FIRECRAWL_EGRESS_ALLOWLIST_DIR") {
    return safeAbsolutePath(value)
  }
  if (
    name.endsWith("_ALLOWED_HOSTS") ||
    name === "TEAM_ALLOWED_EMAIL_DOMAINS"
  ) {
    const hosts = value.split(",").map((host) => host.trim().toLowerCase())
    return hosts.length > 0 && hosts.every(hostname)
  }
  return /^[A-Za-z0-9][A-Za-z0-9._-]{1,127}$/.test(value)
}

function validateAdmissionProfile(admissionRoot, placement, expectedUid, now) {
  let entries
  try {
    entries = readdirSync(admissionRoot, { withFileTypes: true })
  } catch {
    fail()
  }
  if (
    entries.length !== 1 ||
    entries[0].name !== placement.LLMM_INFERENCE_PROFILE_FILE ||
    !entries[0].isFile()
  ) {
    fail()
  }
  const profileBytes = readCredentialFreeFile(
    resolve(admissionRoot, entries[0].name),
    0o600,
    expectedUid,
    1024 * 1024,
  )
  const profile = parseJson(profileBytes)
  const canonicalProfile = canonicalJson(profile)
  if (`${canonicalProfile}\n` !== profileBytes.toString("utf8")) fail()
  const source = profile?.source
  const qualification = profile?.qualification
  const advertisement = profile?.capabilityAdvertisement
  const freshness = advertisement?.freshness
  if (
    !exactKeys(profile, [
      "apiVersion",
      "capabilityAdvertisement",
      "coreCompatibilityFingerprint",
      "engine",
      "kind",
      "model",
      "network",
      "probes",
      "qualification",
      "rollback",
      "source",
    ]) ||
    profile.apiVersion !== "inference-core.llm-machines/v1" ||
    profile.kind !== "RenderedInferenceDeliveryProfile" ||
    profile.coreCompatibilityFingerprint !==
      placement.LLMM_INFERENCE_CORE_COMPATIBILITY_FINGERPRINT ||
    sha256(canonicalProfile) !==
      placement.LLMM_INFERENCE_RENDERED_PROFILE_DIGEST ||
    !exactKeys(source, ["profileId", "revision"]) ||
    source.profileId !== placement.LLMM_INFERENCE_PROFILE_ID ||
    source.revision !== Number(placement.LLMM_INFERENCE_PROFILE_REVISION) ||
    !exactKeys(qualification, [
      "evidenceDigest",
      "productionCapacityClaim",
      "qualifiedProfileDigest",
      "scope",
    ]) ||
    qualification.scope !== "INTERNAL_TEST_ONLY" ||
    qualification.productionCapacityClaim !== false ||
    qualification.qualifiedProfileDigest !==
      placement.LLMM_INFERENCE_QUALIFIED_PROFILE_DIGEST ||
    !digestPattern.test(qualification.evidenceDigest) ||
    !exactKeys(advertisement, ["freshness", "models", "state"]) ||
    advertisement.state !== "ACTIVE_MEASURED" ||
    !exactKeys(freshness, ["measuredAt", "validUntil"]) ||
    !Array.isArray(advertisement.models) ||
    advertisement.models.length !== 1 ||
    !currentWindow(freshness.measuredAt, freshness.validUntil, now) ||
    containsCredentialField(profile)
  ) {
    fail()
  }
  return {
    evidenceDigest: qualification.evidenceDigest,
    file: entries[0].name,
    profileId: source.profileId,
    qualifiedProfileDigest: qualification.qualifiedProfileDigest,
    renderedProfileDigest: placement.LLMM_INFERENCE_RENDERED_PROFILE_DIGEST,
    revision: source.revision,
    engine: profile.engine,
    modelAlias: advertisement.models[0].alias,
    modelArtifactDigest: profile.model.artifactDigest,
    modelManifestDigest: profile.model.manifestDigest,
    rollback: profile.rollback,
  }
}

function validateCompose(source, sourceRoot, expectedUid) {
  const variableInputs = source
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- ${LLMM_"))
  const secretMappings = source
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("LLMM_RUNTIME_SECRET_FILES:"))
  const variableNames = [
    ...new Set(
      [
        ...source.matchAll(
          /(^|[^$])\$(?:\{([A-Z_][A-Z0-9_]*)(?::[^}]*)?\}|([A-Z_][A-Z0-9_]*))/gm,
        ),
      ].map((match) => match[2] ?? match[3]),
    ),
  ].sort()
  if (
    JSON.stringify(variableInputs) !== JSON.stringify(composeVariableInputs) ||
    JSON.stringify(secretMappings) !== JSON.stringify(composeSecretMappings) ||
    JSON.stringify(variableNames) !== JSON.stringify(composeVariableNames)
  ) {
    fail()
  }
  for (const relative of ["infra", "infra/deployment", "infra/ingress"]) {
    inspectDirectory(resolve(sourceRoot, relative), undefined, expectedUid)
  }
  for (const relative of sourceMountFiles) {
    readCredentialFreeFile(
      resolve(sourceRoot, relative),
      undefined,
      expectedUid,
    )
  }
}

function inspectDirectory(path, expectedMode, expectedUid) {
  let stat
  let canonical
  try {
    stat = lstatSync(path)
    canonical = realpathSync(path)
  } catch {
    fail()
  }
  if (
    resolve(path) !== canonical ||
    stat.isSymbolicLink() ||
    !stat.isDirectory() ||
    (expectedMode !== undefined && (stat.mode & 0o7777) !== expectedMode) ||
    (expectedUid !== undefined && stat.uid !== expectedUid) ||
    (expectedUid !== undefined && (stat.mode & 0o022) !== 0)
  ) {
    fail()
  }
  return canonical
}

function commandArgument(command, name) {
  if (!Array.isArray(command)) fail()
  const indexes = command
    .map((value, index) => (value === name ? index : -1))
    .filter((index) => index >= 0)
  if (indexes.length !== 1) fail()
  const value = command[indexes[0] + 1]
  if (!/^[1-9][0-9]{3,4}$/.test(value ?? "")) fail()
  return value
}

function expectedLiteLlmRouteConfig(modelAlias, apiBase, runtimeModelId) {
  return [
    "model_list:",
    `  - model_name: ${modelAlias}`,
    "    litellm_params:",
    `      model: openai/${modelAlias}`,
    `      api_base: ${apiBase}`,
    "      api_key: os.environ/UPSTREAM_API_KEY",
    "    model_info:",
    `      id: ${runtimeModelId}`,
    "general_settings:",
    "  allow_requests_on_db_unavailable: false",
    "  master_key: os.environ/LITELLM_MASTER_KEY",
    "  store_model_in_db: true",
    "  store_prompts_in_spend_logs: false",
    "litellm_settings:",
    "  disable_error_logs: true",
    "  disable_spend_logs: false",
    "  drop_params: true",
    "  log_raw_request_response: false",
    "  telemetry: false",
    "  turn_off_message_logging: true",
    "",
  ].join("\n")
}

function inspectPrivateFile(path, expectedMode, expectedUid) {
  const stat = inspectRegularFile(path)
  if (
    (stat.mode & 0o7777) !== expectedMode ||
    stat.uid !== expectedUid ||
    stat.size < 1 ||
    stat.size > 16 * 1024 * 1024
  ) {
    fail()
  }
}

function readCredentialFreeFile(
  path,
  expectedMode,
  expectedUid,
  maxBytes = 16 * 1024 * 1024,
) {
  const stat = inspectRegularFile(path)
  if (
    stat.size < 1 ||
    stat.size > maxBytes ||
    (expectedMode !== undefined && (stat.mode & 0o7777) !== expectedMode) ||
    (expectedUid !== undefined && stat.uid !== expectedUid) ||
    (stat.mode & 0o022) !== 0
  ) {
    fail()
  }
  try {
    return readFileSync(path)
  } catch {
    fail()
  }
}

function inspectRegularFile(path) {
  let stat
  let canonical
  try {
    stat = lstatSync(path)
    canonical = realpathSync(path)
  } catch {
    fail()
  }
  if (resolve(path) !== canonical || stat.isSymbolicLink() || !stat.isFile()) {
    fail()
  }
  return stat
}

function parseEnvironment(source, { allowEmpty = false } = {}) {
  const lines = source.split("\n")
  if (lines.at(-1) !== "") fail()
  const entries = lines.slice(0, -1)
  if (allowEmpty && entries.length === 1 && entries[0] === "") return {}
  if (!allowEmpty && entries.length === 0) fail()
  const result = {}
  for (const entry of entries) {
    const separator = entry.indexOf("=")
    const name = entry.slice(0, separator)
    const value = entry.slice(separator + 1)
    if (
      separator < 1 ||
      !/^[A-Z][A-Z0-9_]*$/.test(name) ||
      !value ||
      Object.hasOwn(result, name) ||
      /[\r\0]/.test(value)
    ) {
      fail()
    }
    result[name] = value
  }
  return result
}

function parseJson(buffer) {
  try {
    return JSON.parse(buffer.toString("utf8"))
  } catch {
    fail()
  }
}

function exactKeys(value, expected) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) ===
      JSON.stringify([...expected].sort())
  )
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    )
  }
  return value
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value))
}

function containsCredentialField(value) {
  if (Array.isArray(value)) return value.some(containsCredentialField)
  if (!value || typeof value !== "object") return false
  return Object.entries(value).some(
    ([name, nested]) =>
      /^(?:password|secret|credential|privateKey|apiKey|accessToken|refreshToken)$/i.test(
        name,
      ) || containsCredentialField(nested),
  )
}

function currentWindow(measuredAt, validUntil, now) {
  const measured = Date.parse(measuredAt)
  const valid = Date.parse(validUntil)
  return (
    Number.isFinite(measured) &&
    Number.isFinite(valid) &&
    measured <= now.getTime() &&
    valid > now.getTime() &&
    valid > measured
  )
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`
}

function privateIpv4(value) {
  if (typeof value !== "string") return false
  const parts = value.split(".")
  if (
    parts.length !== 4 ||
    parts.some(
      (part) =>
        !/^\d{1,3}$/.test(part) ||
        String(Number(part)) !== part ||
        Number(part) > 255,
    )
  ) {
    return false
  }
  const [first, second] = parts.map(Number)
  return (
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  )
}

function hostname(value) {
  return (
    typeof value === "string" &&
    value.length <= 253 &&
    value
      .split(".")
      .every((part) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(part))
  )
}

function safeAbsolutePath(value) {
  return (
    typeof value === "string" &&
    /^\/(?:[A-Za-z0-9._-]+\/?)+$/.test(value) &&
    !value.includes("..") &&
    resolve(value) === value
  )
}

function fail() {
  throw new Error("VM103 founder runtime custody is invalid.")
}

if (
  process.argv[1] === fileURLToPath(import.meta.url) ||
  process.argv[1] === "-"
) {
  if (process.argv.length !== 11) {
    throw new Error(
      "Usage: verify-vm103-founder-runtime-custody.mjs CONFIG_ROOT SECRET_ROOT ADMISSION_ROOT SOURCE_ROOT COMPOSE MANIFEST_SHA256 RUNTIME_BINDING_MANIFEST_SHA256 COMMIT TREE",
    )
  }
  process.stdout.write(
    `${JSON.stringify(
      verifyFounderRuntimeCustody({
        admissionRoot: process.argv[4],
        composePath: process.argv[6],
        configurationRoot: process.argv[2],
        expectedCommit: process.argv[9],
        expectedManifestDigest: process.argv[7],
        expectedRuntimeBindingManifestDigest: process.argv[8],
        expectedTree: process.argv[10],
        secretRoot: process.argv[3],
        sourceRoot: process.argv[5],
      }),
    )}\n`,
  )
}
