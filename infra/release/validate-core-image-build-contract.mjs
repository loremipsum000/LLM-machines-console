import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
  readCoreImageInventory,
  requiredCoreImageIds,
} from "./validate-image-lock.mjs"

const directory = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(directory, "../..")
const digestPattern = /^sha256:[a-f0-9]{64}$/
const forbiddenIdentityPattern =
  /(?:^|[/_.:@-])(?:latest|sglang-xpu|intel-arc-b50)(?:$|[/_.:@-])/i

const modes = new Map([
  ["product-edge", "SOURCE_PLATFORM_IMPORT"],
  ["console-web", "PRODUCT_BUILD"],
  ["console-bff", "PRODUCT_BUILD"],
  ["keycloak", "SOURCE_PLATFORM_IMPORT"],
  ["litellm", "REVIEWED_DOWNSTREAM_BUILD"],
  ["product-postgresql", "SOURCE_PLATFORM_IMPORT"],
  ["prometheus", "SOURCE_PLATFORM_IMPORT"],
  ["alertmanager", "SOURCE_PLATFORM_IMPORT"],
  ["grafana-private", "SOURCE_PLATFORM_IMPORT"],
  ["firecrawl-api", "REVIEWED_DOWNSTREAM_BUILD"],
  ["firecrawl-browser", "REVIEWED_DOWNSTREAM_BUILD"],
  ["firecrawl-search", "LOCKED_SOURCE_PLATFORM_IMPORT"],
  ["firecrawl-egress", "LOCKED_SOURCE_PLATFORM_IMPORT"],
])

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"))
}

function same(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected)
}

function existingFile(errors, root, path, field) {
  if (
    typeof path !== "string" ||
    path.startsWith("/") ||
    path.split("/").includes("..")
  ) {
    errors.push(`${field} path is unsafe`)
    return
  }
  try {
    readFileSync(resolve(root, path))
  } catch {
    errors.push(`${field} file is missing`)
  }
}

function validateSourceImport(errors, component, inventoryComponent) {
  if (component.source !== "CORE_INVENTORY_COMPONENT") {
    errors.push(`${component.id} must bind the Core inventory component`)
  }
  for (const field of ["indexDigest", "platformDigest"]) {
    if (!digestPattern.test(inventoryComponent?.[field] ?? "")) {
      errors.push(`${component.id} inventory ${field} is not immutable`)
    }
  }
  if (inventoryComponent?.platform !== "linux/amd64") {
    errors.push(`${component.id} inventory platform is not linux/amd64`)
  }
}

function validateProductBuild(errors, component) {
  const dockerfile =
    component.id === "console-web"
      ? "apps/web/Dockerfile"
      : "apps/bff/Dockerfile"
  if (
    component.context !== "." ||
    component.dockerfile !== dockerfile ||
    component.sourceRevision !== "CHECKED_OUT_PROTECTED_INTEGRATION_COMMIT"
  ) {
    errors.push(`${component.id} Product build binding differs`)
  }
}

function validateDownstreamBuild(errors, component) {
  const expected =
    component.id === "litellm"
      ? {
          sourcePackage: "infra/litellm/oss-downstream/source-package.json",
          sourceAssembler: "infra/litellm/oss-downstream/assemble-source.mjs",
          context: "ASSEMBLED_LITELLM_OSS_SOURCE_ROOT",
        }
      : {
          sourcePackage: "infra/firecrawl/release/source-package.json",
          sourceAssembler: "infra/firecrawl/release/assemble-source-packet.mjs",
          context:
            component.id === "firecrawl-api"
              ? "ASSEMBLED_FIRECRAWL_SOURCE_ROOT/apps/api"
              : "ASSEMBLED_FIRECRAWL_SOURCE_ROOT/apps/playwright-service-ts",
        }
  if (
    component.sourcePackage !== expected.sourcePackage ||
    component.sourceAssembler !== expected.sourceAssembler ||
    component.context !== expected.context ||
    component.dockerfile !== "Dockerfile"
  ) {
    errors.push(`${component.id} reviewed downstream build binding differs`)
  }
}

function validateLockedSourceImport(errors, component, firecrawlSource) {
  const inputId =
    component.id === "firecrawl-search"
      ? "searxng-runtime-source"
      : "squid-runtime-source"
  const input = firecrawlSource.buildInputs?.find(({ id }) => id === inputId)
  if (
    component.sourcePackage !== "infra/firecrawl/release/source-package.json" ||
    component.sourcePackageInputId !== inputId ||
    !input ||
    input.platform !== "linux/amd64" ||
    !digestPattern.test(input.platformDigest ?? "")
  ) {
    errors.push(`${component.id} locked source-platform import differs`)
  }
}

export function validateCoreImageBuildContract(
  contract,
  root = repositoryRoot,
) {
  const errors = []
  if (contract?.schema !== "llm-machines.core-image-build-contract.v1") {
    errors.push("Core image build contract schema is not v1")
  }
  if (contract?.status !== "SOURCE_CONTRACT_NOT_EXECUTED") {
    errors.push("Core image build contract cannot claim execution")
  }
  if (contract?.containsCredentials !== false) {
    errors.push("Core image build contract must be credential-free")
  }
  if (
    !same(contract?.releaseSource, {
      commit: "CHECKED_OUT_PROTECTED_INTEGRATION_COMMIT",
      tree: "CHECKED_OUT_PROTECTED_INTEGRATION_TREE",
      version: "SEMANTIC_RELEASE_INPUT",
      sourceDateEpoch: "CHECKED_OUT_COMMIT_EPOCH",
      cleanWorktreeRequired: true,
      protectedIntegrationRequired: true,
    })
  ) {
    errors.push("release source must bind the checked-out protected input")
  }
  if (
    !same(contract?.buildEnvironment, {
      operatingSystem: "linux",
      architecture: "amd64",
      nativeArchitectureRequired: true,
      emulationQualifiesForOutputAdmission: false,
      isolatedWorkspaceRequired: true,
      twoIndependentAssembliesRequired: true,
      workspaceCapacityProofRequired: true,
      freshTrivyDatabaseMaximumAgeHours: 72,
      sourceControlledToolchainLockRequired: true,
      registryMutationAllowed: false,
      credentialsAllowed: false,
      privateSigningMaterialAllowed: false,
    })
  ) {
    errors.push("build environment admission boundary differs")
  }

  const inventory = readCoreImageInventory(root)
  const inventoryById = new Map(
    inventory.components.map((component) => [component.id, component]),
  )
  const firecrawlSource = readJson(
    resolve(root, "infra/firecrawl/release/source-package.json"),
  )
  const components = Array.isArray(contract?.components)
    ? contract.components
    : []
  if (
    !same(
      components.map(({ id }) => id),
      requiredCoreImageIds,
    )
  ) {
    errors.push(
      "build contract component order differs from the Core inventory",
    )
  }
  if (new Set(components.map(({ id }) => id)).size !== components.length) {
    errors.push("build contract contains duplicate components")
  }
  for (const component of components) {
    const expectedMode = modes.get(component.id)
    if (component.mode !== expectedMode) {
      errors.push(`${component.id} build mode differs`)
      continue
    }
    if (component.output !== `images/${component.id}.oci.tar.zst`) {
      errors.push(`${component.id} output path differs`)
    }
    const serialized = JSON.stringify(component)
    if (forbiddenIdentityPattern.test(serialized)) {
      errors.push(`${component.id} contains a mutable or demo identity`)
    }
    if (expectedMode === "SOURCE_PLATFORM_IMPORT") {
      validateSourceImport(errors, component, inventoryById.get(component.id))
    } else if (expectedMode === "PRODUCT_BUILD") {
      validateProductBuild(errors, component)
    } else if (expectedMode === "REVIEWED_DOWNSTREAM_BUILD") {
      validateDownstreamBuild(errors, component)
      existingFile(
        errors,
        root,
        component.sourcePackage,
        `${component.id} source`,
      )
      existingFile(
        errors,
        root,
        component.sourceAssembler,
        `${component.id} assembler`,
      )
    } else if (expectedMode === "LOCKED_SOURCE_PLATFORM_IMPORT") {
      validateLockedSourceImport(errors, component, firecrawlSource)
    }
  }
  if (
    !same(contract?.outputs, {
      coreLock: "locks/core-image-lock.json",
      coreLockStatus: "GENERATE_ONLY_AFTER_TWO_IDENTICAL_ASSEMBLIES",
      ociArchiveFormat: "NORMALIZED_SINGLE_PLATFORM_OCI_ZSTD",
      platform: "linux/amd64",
      fallbackSubstitutionAllowed: false,
      tagOnlyReferenceAllowed: false,
      registryPushAllowed: false,
      deploymentAllowed: false,
    })
  ) {
    errors.push("build output admission boundary differs")
  }
  return errors
}

export function validateBuildCapability(capability, now = new Date()) {
  const errors = []
  if (capability?.operatingSystem !== "linux") {
    errors.push("build environment operating system is not Linux")
  }
  if (capability?.architecture !== "amd64") {
    errors.push("build environment architecture is not amd64")
  }
  if (capability?.nativeArchitecture !== true) {
    errors.push("build environment is not native amd64")
  }
  if (capability?.isolatedWorkspace !== true) {
    errors.push("build workspace is not isolated")
  }
  if (capability?.twoIndependentWorkRoots !== true) {
    errors.push("build environment cannot hold two independent assemblies")
  }
  if (capability?.workspaceCapacityProven !== true) {
    errors.push("build workspace capacity is unproven")
  }
  if (capability?.toolchainLockVerified !== true) {
    errors.push("build toolchain lock is unverified")
  }
  const updatedAt = Date.parse(capability?.trivyDatabaseUpdatedAt ?? "")
  const ageHours = (now.getTime() - updatedAt) / 3_600_000
  if (!Number.isFinite(ageHours) || ageHours < 0 || ageHours > 72) {
    errors.push("Trivy database is not within the 72-hour policy")
  }
  return errors
}

export function verifyCheckedInCoreImageBuildContract(root = repositoryRoot) {
  return validateCoreImageBuildContract(
    readJson(resolve(root, "infra/release/core-image-build-contract.json")),
    root,
  )
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const errors = verifyCheckedInCoreImageBuildContract()
  if (errors.length > 0) {
    for (const error of errors) console.error(error)
    process.exitCode = 1
  } else {
    console.log("Core image build source contract passed")
  }
}
