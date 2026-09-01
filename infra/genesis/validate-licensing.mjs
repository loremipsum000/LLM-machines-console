import { createHash } from "node:crypto"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)))
const firstPartyLicense = "LicenseRef-PolyForm-Internal-Use-1.0.0"
const packagePaths = [
  "package.json",
  "apps/bff/package.json",
  "apps/web/package.json",
  "infra/genesis/snapshot-root-package.json",
  "packages/contracts/package.json",
  "packages/copy/package.json",
  "test-support/f0-e2e2-openai-client/package.json",
  "test-support/inference-core-db-tests/package.json",
]
const expectedLicenseSha256 =
  "3a4a1539d3e265d98a43af998a13e28d4f04fcc35c283bec1e9bf7a86b266ef7"
const expectedUrbanistLicenseSha256 =
  "ee1221b1c2d08920e5f9ca764eb228dafa5c8090df9cf665373c2287b9cb8f49"
const expectedSourceMapComponents = [
  {
    id: "node-runtime-base",
    inventorySection: "buildInputs",
    license: "MIT",
    obligation: "license-and-notices",
    correspondingSource: null,
  },
  {
    id: "product-edge",
    inventorySection: "components",
    license: "BSD-2-Clause",
    obligation: "license-and-notices",
    correspondingSource: null,
  },
  {
    id: "keycloak",
    inventorySection: "components",
    license: "Apache-2.0",
    obligation: "license-and-notices",
    correspondingSource: null,
  },
  {
    id: "litellm",
    inventorySection: "components",
    license: "MIT",
    obligation: "license-notices-and-transitive-source",
    correspondingSource: {
      status: "SOURCE_PACKAGE_CONTRACT",
      packetId: "litellm-oss-transitive-sources",
      contractPath: "infra/litellm/oss-downstream/source-package.json",
    },
  },
  {
    id: "product-postgresql",
    inventorySection: "components",
    license: "PostgreSQL",
    obligation: "license-and-notices",
    correspondingSource: null,
  },
  {
    id: "prometheus",
    inventorySection: "components",
    license: "Apache-2.0",
    obligation: "license-and-notices",
    correspondingSource: null,
  },
  {
    id: "alertmanager",
    inventorySection: "components",
    license: "Apache-2.0",
    obligation: "license-and-notices",
    correspondingSource: null,
  },
  {
    id: "grafana-private",
    inventorySection: "components",
    license: "AGPL-3.0-only",
    obligation: "corresponding-source-required",
    correspondingSource: {
      status: "GENERATED_AT_RELEASE",
      packetId: "grafana-corresponding-source",
      contractPath: "infra/release/release-evidence-policy.json",
    },
  },
  ...[
    ["firecrawl-api", "AGPL-3.0-only"],
    ["firecrawl-browser", "AGPL-3.0-only"],
    ["firecrawl-search", "AGPL-3.0-or-later"],
    ["firecrawl-egress", "GPL-2.0-or-later"],
  ].map(([id, license]) => ({
    id,
    inventorySection: "components",
    license,
    obligation: "corresponding-source-required",
    correspondingSource: {
      status: "SOURCE_PACKAGE_CONTRACT",
      packetId: "firecrawl-corresponding-source",
      contractPath: "infra/firecrawl/release/source-package.json",
    },
  })),
]
const expectedTrackedUpstreamMaterial = [
  {
    id: "urbanist-font",
    version: "1.303",
    sourceRevision: "f9ba63761ae4298607b133e7f42acd8c6b765f85",
    license: "OFL-1.1",
    licensePath: "THIRD_PARTY_LICENSES/Urbanist-OFL-1.1.txt",
    licenseSha256: expectedUrbanistLicenseSha256,
    pathPrefixes: [
      "apps/web/public/fonts/urbanist/",
      "infra/keycloak/themes/llm-machines/login/resources/fonts/urbanist/",
    ],
  },
  {
    id: "firecrawl-reduced-source",
    license: "upstream-component-specific",
    contractPath: "infra/firecrawl/release/source-package.json",
    pathPrefixes: ["infra/firecrawl/provenance/", "infra/firecrawl/release/"],
  },
  {
    id: "litellm-oss-downstream",
    license: "MIT-with-transitive-obligations",
    contractPath: "infra/litellm/oss-downstream/source-package.json",
    pathPrefixes: ["infra/litellm/oss-downstream/"],
  },
]

function fail(message) {
  throw new Error(`Genesis licensing validation failed: ${message}`)
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex")
}

function readJson(root, path) {
  try {
    return JSON.parse(readFileSync(resolve(root, path), "utf8"))
  } catch {
    fail(`${path} is missing or invalid JSON`)
  }
}

function assertExactSet(actual, expected, field) {
  const actualSorted = [...actual].sort()
  const expectedSorted = [...expected].sort()
  if (JSON.stringify(actualSorted) !== JSON.stringify(expectedSorted)) {
    fail(`${field} does not exactly match the immutable Core inventory`)
  }
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

function validateSnapshotRootPackage(root) {
  const sourcePackage = readJson(root, "package.json")
  const snapshotPackage = readJson(
    root,
    "infra/genesis/snapshot-root-package.json",
  )
  const transforms = readJson(root, "infra/genesis/source-transforms.json")
  const withoutScripts = (manifest) =>
    Object.fromEntries(
      Object.entries(manifest).filter(([key]) => key !== "scripts"),
    )
  const sourceWithoutScripts = withoutScripts(sourcePackage)
  const snapshotWithoutScripts = withoutScripts(snapshotPackage)
  if (
    canonicalJson(sourceWithoutScripts) !==
    canonicalJson(snapshotWithoutScripts)
  ) {
    fail("the snapshot root package changes fields outside scripts")
  }
  const expectedSnapshotScripts = [
    "build",
    "check:genesis",
    "check:inference-core",
    "dev",
    "format",
    "lint",
    "retention:inference-core",
    "test",
    "test:genesis-guardrails",
    "test:inference-core-authorization",
    "test:inference-core-characterization",
    "test:inference-core-db",
    "test:release",
    "typecheck",
    "typecheck:inference-core-db",
  ]
  assertExactSet(
    Object.keys(snapshotPackage.scripts ?? {}),
    expectedSnapshotScripts,
    "snapshot root scripts",
  )
  const snapshotCommands = Object.values(snapshotPackage.scripts ?? {}).join(
    "\n",
  )
  const expectedSnapshotGuardrailCommand =
    "node --test infra/firecrawl/validate-profile.test.mjs infra/ingress/source-no-bypass.test.mjs infra/litellm/oss-downstream/validate-source-package.test.mjs infra/observability/validate-profile.test.mjs infra/storage/validate-profile.test.mjs"
  if (
    snapshotCommands.includes("--base-ref") ||
    snapshotCommands.includes("scripts/inference-core/guardrails.mjs") ||
    snapshotCommands.includes("scripts/inference-core/pr12-") ||
    snapshotCommands.includes("scripts/pre-genesis/") ||
    snapshotCommands.includes("infra/ingress/validate-ingress.mjs") ||
    !snapshotPackage.scripts?.test?.includes("check:genesis") ||
    !snapshotPackage.scripts?.test?.includes("test:genesis-guardrails") ||
    snapshotPackage.scripts?.["test:genesis-guardrails"] !==
      expectedSnapshotGuardrailCommand ||
    !snapshotPackage.scripts?.["test:release"]?.includes(
      "infra/genesis/*.test.mjs",
    )
  ) {
    fail(
      "the snapshot root package does not have the reviewed standalone gates",
    )
  }
  const sourceIsSnapshot =
    canonicalJson(sourcePackage) === canonicalJson(snapshotPackage)
  if (!sourceIsSnapshot) {
    if (
      !sourcePackage.scripts?.["check:inference-core"]?.includes(
        "scripts/inference-core/guardrails.mjs",
      ) ||
      !sourcePackage.scripts?.["check:inference-core"]?.includes(
        "infra/ingress/validate-ingress.mjs",
      ) ||
      !sourcePackage.scripts?.["check:inference-core:base"]?.includes(
        "--base-ref 6efab17a6f5f6a474a1dfe1444dcdd63e4973dd7",
      ) ||
      !sourcePackage.scripts?.test?.includes("check:inference-core:base") ||
      !sourcePackage.scripts?.test?.includes(
        "test:inference-core-guardrails",
      ) ||
      !sourcePackage.scripts?.["test:inference-core-guardrails"]?.includes(
        "scripts/inference-core/*.test.mjs",
      ) ||
      !sourcePackage.scripts?.["test:release"]?.includes(
        "scripts/inference-core/pr12-*.test.mjs",
      ) ||
      !sourcePackage.scripts?.["test:release"]?.includes(
        "infra/genesis/*.test.mjs",
      )
    ) {
      fail("the authoritative source package weakened the protected test chain")
    }
  }
  if (
    transforms?.schema !== "llm-machines.genesis-source-transforms.v1" ||
    transforms?.status !== "REVIEWED_DETERMINISTIC_TRANSFORMS" ||
    transforms?.transforms?.length !== 1 ||
    transforms.transforms[0]?.id !== "standalone-root-package" ||
    transforms.transforms[0]?.sourcePath !==
      "infra/genesis/snapshot-root-package.json" ||
    transforms.transforms[0]?.targetPath !== "package.json"
  ) {
    fail("the root-package source transform is not the reviewed exact mapping")
  }
}

export function validateLicensing(root = repositoryRoot) {
  const license = readFileSync(resolve(root, "LICENSE"))
  if (license.length !== 3314 || sha256(license) !== expectedLicenseSha256) {
    fail("LICENSE is not the byte-exact PolyForm Internal Use License 1.0.0")
  }
  if (
    readFileSync(resolve(root, "COPYRIGHT"), "utf8") !==
    "Copyright © 2026 LLM Machines\n"
  ) {
    fail("COPYRIGHT is not the approved separate notice")
  }

  for (const path of packagePaths) {
    const manifest = readJson(root, path)
    if (manifest.private !== true) fail(`${path} must remain private`)
    if (manifest.license !== "SEE LICENSE IN LICENSE") {
      fail(`${path} must refer to the root LICENSE`)
    }
  }
  validateSnapshotRootPackage(root)

  const inventory = readJson(root, "infra/release/core-image-inventory.json")
  const disposition = readJson(root, "infra/release/license-disposition.json")
  const sourceMap = readJson(root, "infra/release/third-party-source-map.json")
  if (
    canonicalJson(Object.keys(sourceMap).sort()) !==
      canonicalJson(
        [
          "components",
          "containsCredentials",
          "inventoryPath",
          "noticePath",
          "schema",
          "status",
          "trackedUpstreamMaterial",
        ].sort(),
      ) ||
    sourceMap.schema !== "llm-machines.third-party-source-map.v1" ||
    sourceMap.status !== "SOURCE_INDEX" ||
    sourceMap.containsCredentials !== false ||
    sourceMap.inventoryPath !== "infra/release/core-image-inventory.json" ||
    sourceMap.noticePath !== "THIRD_PARTY_NOTICES.md"
  ) {
    fail("the third-party source-map envelope drifted")
  }
  const components = inventory.components ?? []
  const productComponents = components.filter(
    (component) => component.kind === "product-build-output",
  )
  if (
    productComponents.length !== 2 ||
    productComponents.some(
      (component) => component.license !== firstPartyLicense,
    )
  ) {
    fail("first-party image outputs must use the PolyForm licence reference")
  }
  if (
    [...(inventory.buildInputs ?? []), ...components].some(
      (component) => component.license === "Proprietary",
    )
  ) {
    fail("the immutable Core inventory contains an obsolete Proprietary label")
  }

  const thirdPartyInventory = [
    ...(inventory.buildInputs ?? []).map((component) => ({
      ...component,
      inventorySection: "buildInputs",
    })),
    ...components
      .filter((component) => component.kind !== "product-build-output")
      .map((component) => ({ ...component, inventorySection: "components" })),
  ]
  const mapped = sourceMap.components ?? []
  if (canonicalJson(mapped) !== canonicalJson(expectedSourceMapComponents)) {
    fail("the third-party source-map obligations drifted")
  }
  assertExactSet(
    mapped.map((component) => component.id),
    thirdPartyInventory.map((component) => component.id),
    "third-party source-map coverage",
  )
  for (const component of thirdPartyInventory) {
    const entry = mapped.find((candidate) => candidate.id === component.id)
    if (
      !entry ||
      entry.inventorySection !== component.inventorySection ||
      entry.license !== component.license
    ) {
      fail(`third-party source mapping drifted for ${component.id}`)
    }
    const sourceRequired =
      /^(?:A?GPL)-/.test(component.license) ||
      component.transitiveCopyleftSourceRequired === true
    if (sourceRequired) {
      const contractPath = entry.correspondingSource?.contractPath
      if (
        typeof contractPath !== "string" ||
        contractPath.startsWith("infra/portainer/") ||
        !existsSync(resolve(root, contractPath))
      ) {
        fail(`corresponding-source contract is missing for ${component.id}`)
      }
    }
  }

  const inventoryLicenses = new Set(
    [...(inventory.buildInputs ?? []), ...components].map(
      (component) => component.license,
    ),
  )
  const dispositionLicenses = disposition.licenses ?? []
  assertExactSet(
    dispositionLicenses.map((entry) => entry.id),
    inventoryLicenses,
    "licence-disposition coverage",
  )
  const firstPartyDisposition = dispositionLicenses.find(
    (entry) => entry.id === firstPartyLicense,
  )
  if (
    firstPartyDisposition?.redistribution !==
      "internal-use-only-no-distribution" ||
    firstPartyDisposition?.sourceRequired !== false
  ) {
    fail("the first-party licence disposition is not fail closed")
  }

  if (
    canonicalJson(sourceMap.trackedUpstreamMaterial) !==
    canonicalJson(expectedTrackedUpstreamMaterial)
  ) {
    fail("the tracked upstream-material index drifted")
  }
  const urbanist = sourceMap.trackedUpstreamMaterial.find(
    (entry) => entry.id === "urbanist-font",
  )
  if (
    urbanist?.version !== "1.303" ||
    urbanist?.sourceRevision !== "f9ba63761ae4298607b133e7f42acd8c6b765f85" ||
    urbanist?.license !== "OFL-1.1" ||
    urbanist?.licenseSha256 !== expectedUrbanistLicenseSha256 ||
    sha256(readFileSync(resolve(root, urbanist.licensePath ?? ""))) !==
      expectedUrbanistLicenseSha256 ||
    !Array.isArray(urbanist.pathPrefixes) ||
    urbanist.pathPrefixes.some((prefix) => {
      const directory = resolve(root, prefix)
      return (
        !existsSync(directory) ||
        !readdirSync(directory).some((path) => path.endsWith(".ttf"))
      )
    })
  ) {
    fail("the tracked Urbanist source and licence identity drifted")
  }
  for (const entry of sourceMap.trackedUpstreamMaterial) {
    if (
      typeof entry.contractPath === "string" &&
      !existsSync(resolve(root, entry.contractPath))
    ) {
      fail(`tracked upstream contract is missing for ${entry.id}`)
    }
  }

  const notices = readFileSync(resolve(root, "THIRD_PARTY_NOTICES.md"), "utf8")
  for (const value of [
    "Third-party notices and source index",
    "PolyForm Internal Use License 1.0.0",
    "Urbanist 1.303",
    "Grafana OSS",
    "LiteLLM OSS downstream",
    "Firecrawl reduced API and browser",
  ]) {
    if (!notices.includes(value)) fail(`THIRD_PARTY_NOTICES.md omits ${value}`)
  }

  return {
    componentCount: components.length,
    packageCount: packagePaths.length,
    thirdPartyComponentCount: thirdPartyInventory.length,
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = validateLicensing()
  process.stdout.write(
    `GENESIS_LICENSING=PASS packages=${result.packageCount} components=${result.componentCount} third_party=${result.thirdPartyComponentCount}\n`,
  )
}
