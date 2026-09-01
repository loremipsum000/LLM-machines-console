import { execFileSync } from "node:child_process"
import { writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)))
const manifestPath = resolve(root, "infra/genesis/source-classification.json")

export const classes = {
  BUILD_INPUT: { genesisDisposition: "include" },
  DEFERRED_NOT_ADMITTED: { genesisDisposition: "exclude" },
  GENERIC_DEPLOYMENT: { genesisDisposition: "include" },
  HISTORICAL_EVIDENCE: { genesisDisposition: "exclude" },
  LAB_ONLY: { genesisDisposition: "exclude" },
  PRODUCT_SOURCE: { genesisDisposition: "include" },
  PRODUCT_TEST: { genesisDisposition: "include" },
  RELEASE_CONTRACT: { genesisDisposition: "include" },
  THIRD_PARTY_COMPLIANCE: { genesisDisposition: "include" },
}

const rootBuildInputs = new Set([
  ".dockerignore",
  ".env.example",
  ".gitattributes",
  ".gitignore",
  "biome.json",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.base.json",
])

const retainedInferenceCoreScripts = new Set([
  "scripts/inference-core/pr05-keycloak-seed.mjs",
  "scripts/inference-core/pr05-keycloak-seed.test.mjs",
])

const labOnlyProductTests = new Set([
  "apps/bff/src/pre-genesis-f0-b1.test.ts",
  "apps/bff/src/pre-genesis-f0-l1.test.ts",
  "apps/bff/src/pre-genesis-f0-w1.test.ts",
  "apps/bff/src/pre-genesis-process-group.test.ts",
  "infra/release/l1b-executable-toolchain.test.mjs",
])

function isTest(path) {
  return (
    path.startsWith("test-support/") ||
    /(?:^|\/)(?:__tests__|test|tests)(?:\/|$)/.test(path) ||
    /\.(?:spec|test)\.(?:js|jsx|mjs|mts|ts|tsx)$/.test(path)
  )
}

function isPackageBuildInput(path) {
  return (
    /^(?:apps|packages)\/[^/]+\/(?:Dockerfile|package\.json|tsconfig(?:\.build)?\.json|vitest\.config\.ts)$/.test(
      path,
    ) ||
    path === "apps/web/next-env.d.ts" ||
    path === "apps/web/next.config.ts" ||
    path === "apps/web/postcss.config.mjs"
  )
}

export function classifyPath(path) {
  if (path.startsWith("infra/portainer/")) return "DEFERRED_NOT_ADMITTED"
  if (labOnlyProductTests.has(path)) return "LAB_ONLY"
  if (retainedInferenceCoreScripts.has(path)) {
    return path.endsWith(".test.mjs") ? "PRODUCT_TEST" : "RELEASE_CONTRACT"
  }
  if (
    path.startsWith("infra/deployment/") ||
    path.startsWith("infra/release/l1b/") ||
    path.startsWith("scripts/pre-genesis/")
  ) {
    return "LAB_ONLY"
  }
  if (
    path.startsWith("docs/reduction/") ||
    path.startsWith("scripts/inference-core/")
  ) {
    return "HISTORICAL_EVIDENCE"
  }
  if (
    path === "THIRD_PARTY_NOTICES.md" ||
    path.startsWith("THIRD_PARTY_LICENSES/") ||
    path === "infra/release/third-party-source-map.json" ||
    path === "infra/firecrawl/THIRD_PARTY_NOTICES.md" ||
    path.startsWith("infra/firecrawl/provenance/") ||
    path.startsWith("infra/firecrawl/release/") ||
    path.startsWith("infra/litellm/oss-downstream/") ||
    path.startsWith("apps/web/public/fonts/urbanist/") ||
    path.startsWith(
      "infra/keycloak/themes/llm-machines/login/resources/fonts/urbanist/",
    )
  ) {
    return "THIRD_PARTY_COMPLIANCE"
  }
  if (isTest(path)) return "PRODUCT_TEST"
  if (rootBuildInputs.has(path) || isPackageBuildInput(path)) {
    return "BUILD_INPUT"
  }
  if (
    path === "LICENSE" ||
    path === "COPYRIGHT" ||
    path.startsWith("infra/genesis/") ||
    path.startsWith("infra/release/")
  ) {
    return "RELEASE_CONTRACT"
  }
  if (path.startsWith("infra/")) return "GENERIC_DEPLOYMENT"
  if (
    path === "README.md" ||
    path.startsWith("apps/") ||
    path.startsWith("packages/")
  ) {
    return "PRODUCT_SOURCE"
  }
  throw new Error(`unclassified tracked path: ${path}`)
}

export function buildClassification(paths) {
  const entries = [...paths]
    .sort((left, right) => Buffer.from(left).compare(Buffer.from(right)))
    .map((path) => ({ path, class: classifyPath(path) }))
  return {
    schema: "llm-machines.genesis-source-classification.v1",
    status: "REVIEWED_SOURCE_POLICY",
    classes,
    entries,
  }
}

function trackedPaths() {
  return execFileSync("git", ["ls-files", "-z"], {
    cwd: root,
    encoding: "utf8",
  })
    .split("\0")
    .filter(Boolean)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3 || process.argv[2] !== "--write") {
    throw new Error("usage: update-source-classification.mjs --write")
  }
  const manifest = buildClassification(trackedPaths())
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    flag: "w",
    mode: 0o644,
  })
  process.stdout.write(`${manifest.entries.length} tracked paths classified\n`)
}
