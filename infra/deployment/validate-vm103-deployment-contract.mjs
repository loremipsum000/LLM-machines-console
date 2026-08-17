import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { isAbsolute, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const expectedTopLevelKeys = [
  "schema",
  "status",
  "containsCredentials",
  "protectedInput",
  "qualification",
  "hostProfile",
  "releaseBinding",
  "placement",
  "persistence",
  "secretCustody",
  "services",
  "gateway",
  "retiredSurfaces",
  "lifecycle",
  "separateGates",
]

const expectedComponents = [
  "product-edge",
  "console-web",
  "console-bff",
  "keycloak",
  "litellm",
  "product-postgresql",
  "prometheus",
  "alertmanager",
  "grafana-private",
  "firecrawl-api",
  "firecrawl-browser",
  "firecrawl-search",
  "firecrawl-egress",
]

const exactSourceDigestComponents = [
  "product-edge",
  "keycloak",
  "product-postgresql",
  "prometheus",
  "alertmanager",
  "grafana-private",
]

const releaseLockRequiredComponents = [
  "console-web",
  "console-bff",
  "litellm",
  "firecrawl-api",
  "firecrawl-browser",
  "firecrawl-search",
  "firecrawl-egress",
]

const expectedAuthorities = [
  "console",
  "api",
  "identity",
  "firecrawl",
  "grafana",
  "litellm",
  "keycloak-admin",
]

const sha256Pattern = /^sha256:[a-f0-9]{64}$/
const credentialValueKeyPattern =
  /^(?:password|secret|token|credential|privateKey)(?:Value)?$/i

function sorted(values) {
  return [...values].sort()
}

function sameValues(actual, expected) {
  return JSON.stringify(sorted(actual)) === JSON.stringify(sorted(expected))
}

function exactKeys(errors, value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push(`${label} must be an object`)
    return
  }
  if (!sameValues(Object.keys(value), expected)) {
    errors.push(`${label} keys differ from the contract`)
  }
}

function sha256File(path) {
  return `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`
}

function validateSourceBinding(
  errors,
  root,
  binding,
  label,
  { parseJson = true } = {},
) {
  if (
    !binding ||
    typeof binding.path !== "string" ||
    isAbsolute(binding.path) ||
    binding.path.includes("..") ||
    !sha256Pattern.test(binding.sha256 ?? "")
  ) {
    errors.push(`${label} binding is malformed`)
    return null
  }
  const path = resolve(root, binding.path)
  try {
    if (sha256File(path) !== binding.sha256) {
      errors.push(`${label} fingerprint does not match its source file`)
    }
    return parseJson ? JSON.parse(readFileSync(path, "utf8")) : path
  } catch {
    errors.push(`${label} source file is missing or invalid`)
    return null
  }
}

function findCredentialValue(value, path = "contract") {
  if (!value || typeof value !== "object") return null
  for (const [key, nested] of Object.entries(value)) {
    const field = `${path}.${key}`
    if (
      key !== "containsCredentials" &&
      key !== "registryCredentialsInContract" &&
      key !== "credential-free" &&
      credentialValueKeyPattern.test(key) &&
      typeof nested === "string" &&
      ![
        "COMMISSIONING_ONLY_CSPRNG",
        "READ_ONLY",
        "root",
        "restic_recovery_material",
      ].includes(nested)
    ) {
      return field
    }
    const found = findCredentialValue(nested, field)
    if (found) return found
  }
  return null
}

function validateReleaseBinding(errors, contract, root) {
  const binding = contract.releaseBinding
  const inventory = validateSourceBinding(
    errors,
    root,
    binding?.sourceInventory,
    "Core image inventory",
  )
  if (!inventory) return
  const ids = inventory.components?.map(({ id }) => id) ?? []
  if (!sameValues(ids, expectedComponents)) {
    errors.push(
      "Core image inventory does not contain the exact VM103 services",
    )
  }
  if (!sameValues(binding.requiredComponentIds ?? [], expectedComponents)) {
    errors.push(
      "required component IDs differ from the admitted Core inventory",
    )
  }
  if (
    !sameValues(
      binding.exactSourceDigestComponents ?? [],
      exactSourceDigestComponents,
    )
  ) {
    errors.push("exact source-digest component set differs")
  }
  if (
    !sameValues(
      binding.releaseLockRequiredComponents ?? [],
      releaseLockRequiredComponents,
    )
  ) {
    errors.push("release-lock-required component set differs")
  }
  for (const component of inventory.components ?? []) {
    if (
      /(?:^|[/:._-])latest(?:$|[/:._-])/i.test(component.version ?? "") ||
      /(?:^|[/:._-])latest(?:$|[/:._-])/i.test(component.repository ?? "")
    ) {
      errors.push(`mutable image identity is forbidden: ${component.id}`)
    }
    if (exactSourceDigestComponents.includes(component.id)) {
      if (
        !sha256Pattern.test(component.indexDigest ?? "") ||
        !sha256Pattern.test(component.platformDigest ?? "") ||
        component.platform !== "linux/amd64"
      ) {
        errors.push(`exact source identity is incomplete: ${component.id}`)
      }
    }
    if (releaseLockRequiredComponents.includes(component.id)) {
      if (
        typeof component.sourceRevision !== "string" ||
        component.sourceRevision.length < 7
      ) {
        errors.push(
          `build output source identity is incomplete: ${component.id}`,
        )
      }
    }
  }
  for (const requiredTrue of [
    "finalCoreLockRequired",
    "deploymentPlacementRequired",
  ]) {
    if (binding?.[requiredTrue] !== true) {
      errors.push(`${requiredTrue} must remain required`)
    }
  }
  for (const requiredFalse of [
    "tagOnlyReferencesAllowed",
    "fallbackSubstitutionAllowed",
    "registryCredentialsInContract",
    "deploymentAllowedBeforeEveryDigestIsVerified",
  ]) {
    if (binding?.[requiredFalse] !== false) {
      errors.push(`${requiredFalse} must remain false`)
    }
  }
}

function validatePlacement(errors, placement) {
  if (
    placement?.composeProjectName !== "llmm-core" ||
    placement?.releaseRoot !== "/opt/llm-machines/core/releases" ||
    placement?.activeReleaseLink !== "/opt/llm-machines/core/current" ||
    placement?.configurationRoot !== "/etc/llm-machines/core" ||
    placement?.secretRoot !== "/etc/llm-machines/core/secrets" ||
    placement?.runtimeRoot !== "/run/llm-machines/core" ||
    placement?.stateRoot !== "/srv/llm-machines"
  ) {
    errors.push("VM103 project or path placement differs")
  }
  if (
    placement?.edge?.publishedPort !== 18443 ||
    placement?.edge?.containerPort !== 443 ||
    placement?.edge?.protocol !== "https" ||
    placement?.edge?.onlyPublishedProductPort !== true
  ) {
    errors.push("VM103 edge placement differs")
  }
  const networks = placement?.networks ?? []
  const networkNames = networks.map(({ name }) => name)
  if (
    networks.length !== 5 ||
    new Set(networkNames).size !== networks.length ||
    networks.some(({ cidr }) => cidr !== "COMMISSIONING_INPUT_NO_OVERLAP")
  ) {
    errors.push("network placement must remain unique and collision-checked")
  }
  if (networks.filter(({ internal }) => !internal).length !== 1) {
    errors.push("only the edge network may be non-internal")
  }
  if (
    !placement?.collisionPolicy ||
    Object.entries(placement.collisionPolicy).some(
      ([, value]) => typeof value !== "boolean",
    ) ||
    Object.entries(placement.collisionPolicy).some(([key, value]) =>
      key === "preflightEvidenceRequired" ? value !== true : value !== false,
    )
  ) {
    errors.push("collision policy must fail closed pending preflight evidence")
  }
}

function validatePersistence(errors, persistence, root) {
  const storage = validateSourceBinding(
    errors,
    root,
    persistence?.sourceContract,
    "storage and backup",
  )
  if (!storage) return
  const expectedDatasets = storage.localStorage.datasets.map(
    ({ name, mountpoint }) => `${name}:${mountpoint}`,
  )
  const actualDatasets = (persistence.datasets ?? []).map(
    ({ name, mountpoint }) => `${name}:${mountpoint}`,
  )
  if (!sameValues(actualDatasets, expectedDatasets)) {
    errors.push("VM103 dataset placement differs from the storage contract")
  }
  if (
    persistence?.backup?.engine !== "restic" ||
    persistence?.backup?.target !== "SEPARATE_CUSTOMER_OWNED_TARGET" ||
    persistence?.backup?.localSnapshotsCountAsBackup !== false ||
    persistence?.backup?.cleanRestoreRequiredBeforeCutover !== true ||
    persistence?.backup?.workloadContentAllowed !== false
  ) {
    errors.push("VM103 backup boundary differs from the storage contract")
  }
  const hostPaths = (persistence.serviceState ?? []).map(
    ({ hostPath }) => hostPath,
  )
  if (
    new Set(hostPaths).size !== hostPaths.length ||
    hostPaths.some(
      (path) => !isAbsolute(path) || !path.startsWith("/srv/llm-machines/"),
    )
  ) {
    errors.push("service state paths must be unique and dataset-bound")
  }
}

function validateSecrets(errors, custody) {
  if (
    custody?.generation !== "COMMISSIONING_ONLY_CSPRNG" ||
    custody?.directoryMode !== "0700" ||
    custody?.fileMode !== "0600" ||
    custody?.owner !== "root" ||
    custody?.group !== "root" ||
    custody?.containerMountMode !== "READ_ONLY"
  ) {
    errors.push("secret custody permissions differ")
  }
  for (const denied of [
    "inlineValuesAllowed",
    "commandLineValuesAllowed",
    "gitValuesAllowed",
    "normalLogValuesAllowed",
    "environmentFileValuesAllowed",
  ]) {
    if (custody?.[denied] !== false) {
      errors.push(`${denied} must remain false`)
    }
  }
  const files = custody?.files ?? []
  if (
    files.length < 15 ||
    files.length !== new Set(files).size ||
    files.some((name) => !/^[a-z0-9_]+$/.test(name))
  ) {
    errors.push("secret-file inventory is incomplete or malformed")
  }
}

function validateServices(errors, services) {
  const ids = (services ?? []).map(({ id }) => id)
  if (!sameValues(ids, expectedComponents)) {
    errors.push(
      "runtime service inventory differs from the Core image inventory",
    )
  }
  for (const service of services ?? []) {
    if (service.restart !== "unless-stopped") {
      errors.push(`restart policy differs: ${service.id}`)
    }
    if (typeof service.health !== "string" || service.health.length < 8) {
      errors.push(`health contract is missing: ${service.id}`)
    }
    if (service.published !== (service.id === "product-edge")) {
      errors.push(`native publication boundary differs: ${service.id}`)
    }
  }
}

function validateGateway(errors, gateway, root) {
  validateSourceBinding(
    errors,
    root,
    gateway?.sourceProfile,
    "native ingress profile",
  )
  validateSourceBinding(
    errors,
    root,
    gateway?.edgeTemplate,
    "Product edge template",
    { parseJson: false },
  )
  const authorities = gateway?.authorities ?? []
  if (
    !sameValues(
      authorities.map(({ id }) => id),
      expectedAuthorities,
    )
  ) {
    errors.push("gateway authority inventory differs")
  }
  const hosts = authorities.map(({ labHost }) => labHost)
  if (
    hosts.length !== new Set(hosts).size ||
    hosts.some(
      (host) =>
        typeof host !== "string" ||
        !/^[a-z0-9-]+\.lab\.llm-machines\.com$/.test(host),
    )
  ) {
    errors.push("lab authority inventory is malformed or not distinct")
  }
  if (
    gateway?.gatewayUpstream !== "VM103_PRIVATE_ADDRESS:18443" ||
    gateway?.gatewayForwardsHost !== true ||
    gateway?.gatewaySetsUpstreamSniToHost !== true ||
    gateway?.gatewayAcceptsOnlyTrustedTlsAuthorities !== true ||
    gateway?.nativeSessionsRemainServiceOwned !== true ||
    gateway?.consoleSessionForwarded !== false ||
    gateway?.directNativePortsAllowed !== false ||
    gateway?.nodeExporterVpnClosure !==
      "SEPARATE_LIVE_GATEWAY_SECURITY_CHANGE_REQUIRED"
  ) {
    errors.push("gateway security boundary differs")
  }
}

function validateRetiredSurfaces(errors, retired) {
  exactKeys(
    errors,
    retired,
    [
      "enforcement",
      "deferredAdministration",
      "firecrawlNativeUiAllowed",
      "prometheusCustomerAuthorityAllowed",
      "alertmanagerCustomerAuthorityAllowed",
      "postgresqlCustomerAuthorityAllowed",
      "sglangCustomerAuthorityAllowed",
    ],
    "retired-surface boundary",
  )
  if (
    retired?.enforcement?.policy !== "ADMITTED_INFERENCE_CORE_GUARDRAIL" ||
    retired?.enforcement?.path !== "scripts/inference-core/guardrails.mjs" ||
    retired?.enforcement?.sourceClosureEvidence !==
      "docs/reduction/inference-core/pr11a-r1-v1-source-closure.json" ||
    retired?.enforcement?.nativeAccessClosureEvidence !==
      "docs/reduction/inference-core/f0-n8-native-access-closure.json"
  ) {
    errors.push("retired-surface enforcement differs from protected closure")
  }
  if (
    retired?.deferredAdministration !== "PORTAINER_DEFERRED_UPSTREAM_SECURITY"
  ) {
    errors.push("deferred administration boundary differs")
  }
  for (const [key, value] of Object.entries(retired ?? {})) {
    if (
      key !== "enforcement" &&
      key !== "deferredAdministration" &&
      value !== false
    ) {
      errors.push(`${key} must remain false`)
    }
  }
}

function validateLifecycle(errors, lifecycle) {
  const allCommands = [
    ...(lifecycle?.installationCommands ?? []),
    lifecycle?.statusCommand,
    lifecycle?.stopCommand,
    ...(lifecycle?.rollbackCommands ?? []),
  ]
  if (
    allCommands.some(
      (command) =>
        typeof command !== "string" ||
        /(?:--password|--secret|--token|\bdown\s+--volumes\b|\brm\s+-rf\b)/i.test(
          command,
        ),
    )
  ) {
    errors.push(
      "lifecycle commands contain a credential or destructive pattern",
    )
  }
  if (
    !lifecycle?.installationCommands?.some((command) =>
      command.includes("clean-room-install.mjs"),
    ) ||
    !lifecycle?.installationCommands?.some((command) =>
      command.includes("validate-deployment-placement.mjs"),
    ) ||
    !lifecycle?.installationCommands?.some((command) =>
      command.includes("docker compose --project-name llmm-core"),
    )
  ) {
    errors.push("installation command sequence is incomplete")
  }
  const preconditions = lifecycle?.mutationPreconditions ?? []
  for (const required of [
    "EXACT_FINAL_CORE_LOCK_VERIFIED",
    "VM102_ROLLBACK_POINT_RECORDED",
    "VM103_ROLLBACK_POINT_RECORDED",
    "FRESH_PBS_BACKUPS_VERIFIED",
    "ISOLATED_CLEAN_RESTORE_PASSED",
    "GATEWAY_NODE_EXPORTER_VPN_CLOSURE_PASSED",
    "EXACT_INTERNAL_TEST_INFERENCE_PROFILE_ADMITTED",
  ]) {
    if (!preconditions.includes(required)) {
      errors.push(`missing deployment precondition: ${required}`)
    }
  }
}

function validateSeparateGates(errors, gates) {
  if (
    gates?.gatewaySecurity?.scope !== "CLOSE_VPN_SIDE_NODE_EXPORTER_9100" ||
    gates?.gatewaySecurity?.preimageRequired !== true ||
    gates?.gatewaySecurity?.bundledWithDeployment !== false ||
    gates?.gatewaySecurity?.status !== "NOT_STARTED"
  ) {
    errors.push("gateway security must remain a separate not-started change")
  }
  if (
    !sameValues(gates?.rollbackEstablishment?.vmids ?? [], [102, 103]) ||
    gates?.rollbackEstablishment?.pbsBackupRequired !== true ||
    gates?.rollbackEstablishment?.isolatedRestoreRequired !== true ||
    gates?.rollbackEstablishment?.status !== "NOT_STARTED"
  ) {
    errors.push("rollback establishment gate differs")
  }
  if (
    gates?.inferencePreparation?.engine !== "sglang" ||
    gates?.inferencePreparation?.version !== "0.5.13" ||
    gates?.inferencePreparation?.profileClass !== "INTERNAL_TEST_ONLY" ||
    gates?.inferencePreparation?.productionCapacityClaimAllowed !== false ||
    gates?.inferencePreparation?.existingImagesOrModelsMayBeDeleted !== false ||
    gates?.inferencePreparation?.storageChangeRequiresSeparateApproval !==
      true ||
    gates?.inferencePreparation?.status !== "NOT_STARTED"
  ) {
    errors.push("inference preparation gate differs")
  }
}

export function validateVm103DeploymentContract(contract, root) {
  const errors = []
  exactKeys(errors, contract, expectedTopLevelKeys, "VM103 deployment contract")
  if (
    contract?.schema !== "llm-machines.vm103-deployment-contract.v1" ||
    contract?.status !== "SOURCE_CONTRACT_NOT_DEPLOYED" ||
    contract?.containsCredentials !== false
  ) {
    errors.push(
      "VM103 deployment contract overstates status or contains credentials",
    )
  }
  if (
    contract?.protectedInput?.commit !==
      "e994a738aff6f1d85afc82a2dc5566c62dca9fd8" ||
    contract?.protectedInput?.tree !==
      "71208853d15a26b28e028ec8a3c88a54c6d00807"
  ) {
    errors.push("protected Product input differs")
  }
  if (
    contract?.qualification?.productAccepted !== false ||
    contract?.qualification?.runtimeQualified !== false ||
    contract?.qualification?.contractActivation !== "INACTIVE" ||
    contract?.qualification?.q0 !== "NOT_STARTED" ||
    contract?.qualification?.genesis !== "UNPUBLISHED"
  ) {
    errors.push("qualification or activation is overstated")
  }
  if (
    contract?.hostProfile?.vmid !== 103 ||
    contract?.hostProfile?.vcpus !== 8 ||
    contract?.hostProfile?.memoryGiB !== 32 ||
    contract?.hostProfile?.localDiskGiB !== 100 ||
    contract?.hostProfile?.platform !== "linux/amd64" ||
    contract?.hostProfile?.bulkModelWeightsAllowed !== false ||
    contract?.hostProfile?.backupRepositoryAllowed !== false
  ) {
    errors.push("VM103 host profile differs from the Core baseline")
  }
  const credentialValue = findCredentialValue(contract)
  if (credentialValue) {
    errors.push(
      `contract contains a credential-like value at ${credentialValue}`,
    )
  }
  validateReleaseBinding(errors, contract, root)
  validatePlacement(errors, contract?.placement)
  validatePersistence(errors, contract?.persistence, root)
  validateSecrets(errors, contract?.secretCustody)
  validateServices(errors, contract?.services)
  validateGateway(errors, contract?.gateway, root)
  validateRetiredSurfaces(errors, contract?.retiredSurfaces)
  validateLifecycle(errors, contract?.lifecycle)
  validateSeparateGates(errors, contract?.separateGates)
  return errors
}

export function validateCheckedInVm103DeploymentContract(root) {
  const path = resolve(root, "infra/deployment/vm103-deployment-contract.json")
  const contract = JSON.parse(readFileSync(path, "utf8"))
  return validateVm103DeploymentContract(contract, root)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = resolve(import.meta.dirname, "../..")
  const errors = validateCheckedInVm103DeploymentContract(root)
  if (errors.length > 0) {
    process.stderr.write(`${errors.join("\n")}\n`)
    process.exitCode = 1
  } else {
    process.stdout.write("VM103 source-only deployment contract valid\n")
  }
}
