import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"
import {
  requiredSourceArtifactClasses,
  requiredSourceScenarios,
  requiredTerminalStates,
} from "./retention-canary.mjs"

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
export const repositoryRoot = resolve(scriptDirectory, "../..")

export const allowlistPath =
  "docs/reduction/inference-core/forbidden-surface-allowlist.yaml"
export const routeBaselinePath =
  "docs/reduction/inference-core/route-baseline.json"
export const retentionCharacterizationPath =
  "docs/reduction/inference-core/retention-characterization.json"
const pr01BootstrapBase = "0faf8a7da0a77ffb6bf45cb6c01dbc17c51f855a"

const guardrailExclusions = new Set([
  "apps/bff/src/routes/inference-core-characterization.test.ts",
  "packages/contracts/src/inference-core-authorization.test.ts",
  "docs/reduction/inference-core/README.md",
  "docs/reduction/inference-core/forbidden-surface-allowlist.yaml",
  "docs/reduction/inference-core/retention-characterization.json",
  "docs/reduction/inference-core/route-baseline.json",
  "scripts/inference-core/guardrails.mjs",
  "scripts/inference-core/guardrails.test.mjs",
  "scripts/inference-core/retention-canary.mjs",
  "scripts/inference-core/retention-canary.test.mjs",
  "scripts/inference-core/run-core-command.mjs",
  "scripts/inference-core/run-core-command.test.mjs",
])
const protectedGuardrailPaths = [
  "apps/bff/tsconfig.json",
  "apps/bff/vitest.config.ts",
  "apps/bff/src/routes/inference-core-characterization.test.ts",
  "apps/web/tsconfig.json",
  "apps/web/vitest.config.ts",
  "packages/contracts/src/inference-core-authorization.test.ts",
  "packages/contracts/src/inference-core-authorization.ts",
  "packages/contracts/tsconfig.build.json",
  "packages/contracts/tsconfig.json",
  "packages/copy/tsconfig.build.json",
  "packages/copy/tsconfig.json",
  "pnpm-workspace.yaml",
  "scripts/inference-core/guardrails.mjs",
  "scripts/inference-core/guardrails.test.mjs",
  "scripts/inference-core/retention-canary.mjs",
  "scripts/inference-core/retention-canary.test.mjs",
  "scripts/inference-core/run-core-command.mjs",
  "scripts/inference-core/run-core-command.test.mjs",
  "tsconfig.base.json",
]

const pathRules = [
  {
    id: "FS001_RETIRED_BFF_MODULE",
    pattern:
      /^apps\/bff\/src\/(?:routes\/(?:agentic-runtime|builder|hub|knowledge|mcp-gateway|openai-compatible)(?:\.(?:test|spec))?\.(?:cjs|cts|js|jsx|mjs|mts|ts|tsx)|routes\/knowledge-pdf-parser\.e2e\.(?:test|spec)\.(?:cjs|cts|js|jsx|mjs|mts|ts|tsx)|catalog\/(?:mcp-catalog|signed-catalog(?:\.(?:test|spec))?)\.(?:cjs|cts|js|jsx|mjs|mts|ts|tsx)|services\/(?:admin-approvals|admin-connector-registry|approval-envelope|builder|egress-approvals|hub|hub-events(?:\.(?:test|spec))?|internal-docs-mcp-posture|librechat-backfill(?:\.(?:test|spec))?|librechat-native-agents|mcp-gateway|slash-middleware|agentic-runtime-client|agentic-runtime-history)\.(?:cjs|cts|js|jsx|mjs|mts|ts|tsx)|services\/knowledge\/|scripts\/backfill-knowledge-embeddings\.(?:cjs|cts|js|jsx|mjs|mts|ts|tsx)|workers\/knowledge-url-acquisition\.(?:cjs|cts|js|jsx|mjs|mts|ts|tsx))/,
    removeBy: "PR-03",
  },
  {
    id: "FS002_RETIRED_WEB_MODULE",
    pattern:
      /^apps\/web\/src\/(?:app\/api\/(?:builder|hub)\/|app\/(?:artifacts|builder|chat|knowledge|profile|resources|tasks|usage)(?:\/|$)|components\/(?:builder|hub)(?:\/|$)|components\/console-v2\/knowledge-v2-experience\.tsx$|lib\/(?:builder|hub|knowledge)(?:\/|$))/,
    removeBy: "PR-03",
  },
  {
    id: "FS003_RETIRED_CONTRACT_MODULE",
    pattern:
      /^packages\/contracts\/src\/(?:builder|hub|knowledge)(?:\.(?:test|spec))?\.(?:cjs|cts|js|jsx|mjs|mts|ts|tsx)$/,
    removeBy: "PR-03",
  },
  {
    id: "FS004_RETIRED_PACKAGE",
    pattern: /^apps\/(?:agentic-adapter|pdf-parser|reranker-api|sidecar)\//,
    removeBy: "PR-03",
  },
  {
    id: "FS005_RETIRED_KNOWLEDGE_FIXTURE",
    pattern: /^test-fixtures\/knowledge\//,
    removeBy: "PR-03",
  },
  {
    id: "FS006_RETIRED_MIGRATION",
    pattern:
      /^infra\/migrations\/(?:0001_agentic_|0002_align_egress_|0009_builder_|0011_agentic_|0015_admin_builder_|0016_admin_connector_vetting_|0017_connector_vetting_)/,
    removeBy: "PR-04",
  },
]

const contentRules = [
  {
    id: "FS101_AGENTIC_RUNTIME",
    pattern: "agentic|openclaw|hermes|nemoclaw|openshell",
    flags: "giu",
    removeBy: "PR-04",
  },
  {
    id: "FS102_MCP",
    pattern: "mcp",
    flags: "giu",
    removeBy: "PR-03",
  },
  {
    id: "FS103_KNOWLEDGE_RAG",
    pattern: "knowledge|corpus|corpora|ragflow|\\brag\\b|embedding",
    flags: "giu",
    removeBy: "PR-04",
  },
  {
    id: "FS104_LIBRECHAT",
    pattern: "librechat",
    flags: "giu",
    removeBy: "PR-03",
  },
  {
    id: "FS105_BUILDER_HUB",
    pattern:
      "\\b[Bb][Uu][Ii][Ll][Dd][Ee][Rr](?=\\b|[A-Z_])|Builder(?=$|[^a-z]|[A-Z])|\\bbuilder(?=[A-Z_])|\\b[Hh][Uu][Bb](?=\\b|[A-Z_])|(?<![Gg]it)Hub(?=$|[^a-z]|[A-Z])|\\bhub(?=[A-Z_])",
    flags: "gu",
    removeBy: "PR-03",
  },
  {
    id: "FS106_RETIRED_PROCESSING",
    pattern: "pdf[-_ ]parser|rerank|\\bocr\\b|\\bsidecar\\b",
    flags: "giu",
    removeBy: "PR-03",
  },
  {
    id: "FS107_RETIRED_DATA_DEPENDENCY",
    pattern: "\\b(?:mongodb|minio|ioredis|redis|temporal|pgvector)\\b",
    flags: "giu",
    removeBy: "PR-04",
  },
  {
    id: "FS108_RETIRED_GOVERNANCE",
    pattern:
      "url[-_ ]?policy|urlPolicy|pure[-_ ]?mode|pureMode|promote[-_ ]production|break[-_ ]glass|breakGlass",
    flags: "giu",
    removeBy: "PR-06",
  },
  {
    id: "FS109_LEGACY_PERSONA",
    pattern:
      "\\bconsumer\\b|withPersona|personaCanAccess|personaSchema|personaRank",
    flags: "giu",
    removeBy: "PR-05",
  },
  {
    id: "FS110_COMFYUI",
    pattern: "comfyui",
    flags: "giu",
    removeBy: "PR-03",
  },
  {
    id: "FS111_CONNECTOR_GOVERNANCE",
    pattern:
      "connector[-_ ]?registry|connectorRegistry|ConnectorRegistry|connector[-_ ]?vetting|connectorVetting|ConnectorVetting|vettingStatus|VettingStatus|pending_vetting",
    flags: "giu",
    removeBy: "PR-03",
  },
]

const routeMethods = [
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "options",
  "head",
]
const unsupportedFastifyMethods = new Set([
  "addHttpMethod",
  "all",
  "register",
  "setErrorHandler",
  "setNotFoundHandler",
])
const controlledFastifyMethods = new Set(["addHook"])
const routeReceiverNamePattern = /^(?:api|app|fastify|router|server)$/i
const bffProductionSourcePattern =
  /^(?:apps\/bff|packages\/(?:contracts|copy)\/src)\/.*\.(?:cjs|cts|js|jsx|mjs|mts|ts|tsx)$/
const productionSurfaceTestPathPattern =
  /(?:^|\/)(?:__tests__|test-fixtures)(?:\/|$)|\.(?:e2e\.)?(?:test|spec)\.[^/]+$|\.d\.(?:cts|mts|ts)$/
const reviewedFastifyRegistrarSpecs = [
  {
    exportName: "registerPersonaAuth",
    importSource: "./auth/persona",
    sourcePath: "apps/bff/src/auth/persona.ts",
  },
  {
    exportName: "registerOpenAICompatibleRoutes",
    importSource: "./routes/openai-compatible",
    sourcePath: "apps/bff/src/routes/openai-compatible.ts",
  },
  {
    exportName: "registerAppGatewayRoutes",
    importSource: "./routes/app-gateway",
    sourcePath: "apps/bff/src/routes/app-gateway.ts",
  },
  {
    exportName: "registerAdminRoutes",
    importSource: "./routes/admin",
    sourcePath: "apps/bff/src/routes/admin.ts",
  },
  {
    exportName: "registerKnowledgeRoutes",
    importSource: "./routes/knowledge",
    sourcePath: "apps/bff/src/routes/knowledge.ts",
  },
  {
    exportName: "registerAgenticRuntimeRoutes",
    importSource: "./routes/agentic-runtime",
    sourcePath: "apps/bff/src/routes/agentic-runtime.ts",
  },
  {
    exportName: "registerMcpGatewayRoutes",
    importSource: "./routes/mcp-gateway",
    sourcePath: "apps/bff/src/routes/mcp-gateway.ts",
  },
  {
    exportName: "registerHubRoutes",
    importSource: "./routes/hub",
    sourcePath: "apps/bff/src/routes/hub.ts",
  },
  {
    exportName: "registerBuilderRoutes",
    importSource: "./routes/builder",
    sourcePath: "apps/bff/src/routes/builder.ts",
  },
]
const reviewedFastifySourcePaths = new Set([
  "apps/bff/src/index.ts",
  ...reviewedFastifyRegistrarSpecs.map(({ sourcePath }) => sourcePath),
])
const webInferenceEndpointPattern =
  /\/(?:v1\/)?(?:chat\/completions|responses)(?:$|[/?#])/i
const ambiguousStaticStringCandidates = Symbol(
  "ambiguousStaticStringCandidates",
)
const strictUtf8Decoder = new TextDecoder("utf-8", { fatal: true })
const binaryPathPattern =
  /\.(?:avif|bmp|eot|gif|gz|ico|jpe?g|otf|pdf|png|tar|tgz|ttf|webp|woff2?|zip)$/i

export const targetRouteContract = {
  requiredPublicInference: [
    {
      method: "GET",
      path: "/api/app-gateway/v1/models",
    },
    {
      method: "POST",
      path: "/api/app-gateway/v1/chat/completions",
    },
  ],
  requiredPrivateOperational: [
    { method: "GET", path: "/livez" },
    { method: "GET", path: "/healthz" },
    { method: "GET", path: "/readyz" },
  ],
  futureFirecrawl: [
    {
      method: "POST",
      path: "/v2/search",
    },
    {
      method: "POST",
      path: "/v2/scrape",
    },
  ],
  consoleLogicalSurfaces: [
    "overview",
    "applications",
    "inference",
    "hardware",
    "team",
    "activity-audit",
    "settings",
  ],
  activityAuditPath: null,
}

const resolverFingerprintSpecs = [
  {
    path: "apps/web/next.config.ts",
    symbol: "<file>",
  },
  {
    path: "apps/web/src/lib/auth/auth.ts",
    symbol: "<file>",
  },
]

const legacyEscapeHatchSpecs = [
  {
    path: "apps/bff/src/auth/persona.ts",
    removeBy: "PR-05",
  },
  {
    path: "apps/web/src/lib/auth/middleware-policy.ts",
    removeBy: "PR-03",
  },
  {
    path: "apps/web/src/middleware.ts",
    removeBy: "PR-03",
  },
]

export function listCandidatePaths(root = repositoryRoot) {
  const output = execFileSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    {
      cwd: root,
      encoding: "buffer",
    },
  )

  return output.toString("utf8").split("\0").filter(Boolean).sort()
}

export function scanForbiddenSurfaces({
  root = repositoryRoot,
  paths = listCandidatePaths(root),
} = {}) {
  const findings = []
  const frozenPaths = new Set()

  for (const rule of pathRules) {
    for (const path of paths) {
      if (isGuardrailPath(path) || !rule.pattern.test(path)) {
        continue
      }
      const absolutePath = resolve(root, path)
      if (!isRegularFile(absolutePath)) {
        continue
      }
      frozenPaths.add(path)
      findings.push({
        ruleId: rule.id,
        path,
        count: 1,
        fingerprints: { [sha256(readFileSync(absolutePath))]: 1 },
        removeBy: rule.removeBy,
      })
    }
  }

  for (const rule of contentRules) {
    for (const path of paths) {
      if (frozenPaths.has(path) || !isContentScanPath(path)) {
        continue
      }
      const absolutePath = resolve(root, path)
      if (!isRegularFile(absolutePath)) {
        continue
      }
      const bytes = readFileSync(absolutePath)
      let source
      try {
        source = strictUtf8Decoder.decode(bytes)
      } catch {
        if (binaryPathPattern.test(path)) {
          continue
        }
        throw new Error(`Invalid UTF-8 in tracked content candidate ${path}`)
      }
      const fingerprints = matchFingerprints(rule, source)
      if (Object.keys(fingerprints).length === 0) {
        continue
      }
      findings.push({
        ruleId: rule.id,
        path,
        count: Object.values(fingerprints).reduce(
          (total, count) => total + count,
          0,
        ),
        fingerprints,
        removeBy: rule.removeBy,
      })
    }
  }

  return findings.sort(compareFindingKeys)
}

export function buildForbiddenAllowlist({
  root = repositoryRoot,
  paths = listCandidatePaths(root),
  baseCommit = currentHead(root),
} = {}) {
  return {
    schemaVersion: 1,
    baseCommit,
    policyDigest: forbiddenPolicyDigest(),
    protectedFiles: buildProtectedGuardrailFingerprints(root),
    entries: scanForbiddenSurfaces({ root, paths }),
  }
}

export function buildRouteBaseline({
  root = repositoryRoot,
  paths = listCandidatePaths(root),
  baseCommit = currentHead(root),
} = {}) {
  return {
    schemaVersion: 1,
    baseCommit,
    policyDigest: routePolicyDigest(),
    target: targetRouteContract,
    routes: [
      ...extractBffRoutes({ root, paths }),
      ...extractWebRoutes({ root, paths }),
    ].sort(compareRoutes),
    fastifyRegistrars: extractFastifyRegistrarManifest({ root, paths }),
    webInferenceConsumers: extractWebInferenceConsumers({ root, paths }),
    sourceClosure: buildProductionSourceClosure({ root, paths }),
    fingerprints: buildResolverFingerprints(root),
    escapeHatches: buildLegacyEscapeHatches(root, paths),
  }
}

function buildProductionSourceClosure({ root, paths }) {
  return paths
    .filter(
      (path) =>
        isProductionSurfacePath(path) &&
        !productionSurfaceTestPathPattern.test(path) &&
        isRegularFile(resolve(root, path)),
    )
    .map((path) => ({
      path,
      sha256: sha256(readFileSync(resolve(root, path))),
    }))
    .sort((left, right) => left.path.localeCompare(right.path))
}

function isProductionSurfacePath(path) {
  return (
    /^(?:apps\/(?:bff|web)\/src|apps\/web\/app|apps\/web\/public|packages\/(?:contracts|copy)\/src)\//.test(
      path,
    ) ||
    /^(?:apps\/(?:bff|web)|packages\/(?:contracts|copy))\/[^/]+$/.test(path) ||
    [
      ".dockerignore",
      "package.json",
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
    ].includes(path)
  )
}

export function compareExactFindings(expected, actual) {
  const errors = []
  const expectedByKey = new Map(
    expected.map((entry) => [findingKey(entry), entry]),
  )
  const actualByKey = new Map(actual.map((entry) => [findingKey(entry), entry]))

  for (const [key, entry] of actualByKey) {
    const accepted = expectedByKey.get(key)
    if (!accepted) {
      errors.push(`new finding ${key} count=${entry.count}`)
      continue
    }
    if (JSON.stringify(accepted) !== JSON.stringify(entry)) {
      errors.push(
        `changed finding ${key} expected=${accepted.count} actual=${entry.count}`,
      )
    }
  }

  for (const [key] of expectedByKey) {
    if (!actualByKey.has(key)) {
      errors.push(`stale allowlist entry ${key}`)
    }
  }

  return errors.sort()
}

export function compareForbiddenBaselineMetadata(expected, actual) {
  const errors = []
  const expectedKeys = [
    "baseCommit",
    "entries",
    "policyDigest",
    "protectedFiles",
    "schemaVersion",
  ]
  if (
    JSON.stringify(Object.keys(expected).sort()) !==
      JSON.stringify(expectedKeys) ||
    expected.schemaVersion !== 1 ||
    expected.baseCommit !== pr01BootstrapBase
  ) {
    errors.push("forbidden-surface baseline metadata changed")
  }
  if (expected.policyDigest !== actual.policyDigest) {
    errors.push("forbidden-surface policy digest changed")
  }
  if (
    JSON.stringify(expected.protectedFiles) !==
    JSON.stringify(actual.protectedFiles)
  ) {
    errors.push("protected guardrail files changed")
  }
  return errors
}

export function compareExactRouteBaseline(expected, actual) {
  return JSON.stringify(expected) === JSON.stringify(actual)
    ? []
    : ["route baseline changed"]
}

export function verifyShrinkOnly(baseEntries, currentEntries) {
  const errors = []
  const baseByKey = new Map(
    baseEntries.map((entry) => [findingKey(entry), entry]),
  )

  for (const entry of currentEntries) {
    const baseEntry = baseByKey.get(findingKey(entry))
    if (!baseEntry) {
      errors.push(`new legacy finding ${findingKey(entry)}`)
      continue
    }
    if (entry.removeBy !== baseEntry.removeBy) {
      errors.push(`legacy disposition changed ${findingKey(entry)}`)
    }
    if (!isFingerprintSubset(entry.fingerprints, baseEntry.fingerprints)) {
      errors.push(`legacy finding changed or grew ${findingKey(entry)}`)
    }
  }

  return errors.sort()
}

export function verifyRepository({ root = repositoryRoot, baseRef } = {}) {
  const paths = listCandidatePaths(root)
  const expectedAllowlist = readJson(resolve(root, allowlistPath))
  const expectedRoutes = readJson(resolve(root, routeBaselinePath))
  const actualAllowlist = buildForbiddenAllowlist({
    root,
    paths,
    baseCommit: expectedAllowlist.baseCommit,
  })
  const actualRoutes = buildRouteBaseline({
    root,
    paths,
    baseCommit: expectedRoutes.baseCommit,
  })

  const errors = [
    ...compareForbiddenBaselineMetadata(expectedAllowlist, actualAllowlist),
    ...compareExactFindings(expectedAllowlist.entries, actualAllowlist.entries),
    ...compareExactRouteBaseline(expectedRoutes, actualRoutes),
    ...verifyRouteBaselineMetadata(expectedRoutes),
    ...verifyRequiredRoutes(actualRoutes),
    ...verifyCorePackageClosure(root, paths),
    ...verifyRetentionCharacterization(root),
  ]

  let baseStatus = "not-requested"
  if (baseRef) {
    const baseCommit = resolveCommit(root, baseRef)
    const baseAllowlist = baseCommit
      ? readJsonFromCommit(root, baseCommit, allowlistPath)
      : null
    const baseRoutes = baseCommit
      ? readJsonFromCommit(root, baseCommit, routeBaselinePath)
      : null
    if (!baseCommit) {
      baseStatus = "unavailable"
      errors.push(`base ref is unavailable ${baseRef}`)
    } else if (!baseAllowlist || !baseRoutes) {
      baseStatus = "bootstrap"
      if (baseCommit !== pr01BootstrapBase) {
        errors.push(
          `base guardrail files missing after bootstrap ${baseCommit}`,
        )
      }
    } else {
      baseStatus = "checked"
      errors.push(
        ...verifyPolicyStability(
          baseAllowlist,
          expectedAllowlist,
          "forbidden-surface",
        ),
      )
      errors.push(
        ...verifyProtectedGuardrailStability(baseAllowlist, expectedAllowlist),
      )
      errors.push(
        ...verifyShrinkOnly(baseAllowlist.entries, expectedAllowlist.entries),
      )
      errors.push(...verifyLegacyRouteShrink(baseRoutes, expectedRoutes))
    }
  }

  return {
    ok: errors.length === 0,
    errors: errors.sort(),
    baseStatus,
    findingCount: expectedAllowlist.entries.reduce(
      (total, entry) => total + entry.count,
      0,
    ),
    findingPathCount: expectedAllowlist.entries.length,
    routeCount: expectedRoutes.routes.length,
    legacyRouteCount: expectedRoutes.routes.filter(
      (route) => route.classification === "legacy-retired",
    ).length,
  }
}

export function verifyCorePackageClosure(
  root = repositoryRoot,
  paths = listCandidatePaths(root),
) {
  const errors = []
  const packagePaths = paths.filter(
    (path) =>
      /^(?:apps|packages)\/[^/]+\/package\.json$/.test(path) &&
      isRegularFile(resolve(root, path)),
  )
  const packages = new Map(
    packagePaths.map((path) => {
      const manifest = readJson(resolve(root, path))
      return [manifest.name, { manifest, path }]
    }),
  )
  const queue = ["@llm-machines/bff", "@llm-machines/web"]
  const closure = new Set()

  while (queue.length > 0) {
    const name = queue.shift()
    if (!name || closure.has(name)) {
      continue
    }
    const pkg = packages.get(name)
    if (!pkg) {
      errors.push(`missing Core package ${name}`)
      continue
    }
    closure.add(name)
    const dependencies = {
      ...pkg.manifest.dependencies,
      ...pkg.manifest.devDependencies,
      ...pkg.manifest.optionalDependencies,
      ...pkg.manifest.peerDependencies,
    }
    for (const dependency of Object.keys(dependencies)) {
      if (packages.has(dependency)) {
        queue.push(dependency)
      }
    }
  }

  const expected = [
    "@llm-machines/bff",
    "@llm-machines/contracts",
    "@llm-machines/copy",
    "@llm-machines/web",
  ]
  const actual = [...closure].sort()
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    errors.push(
      `Core package closure changed expected=${expected.join(",")} actual=${actual.join(",")}`,
    )
  }
  if (closure.has("@llm-machines/agentic-adapter")) {
    errors.push("Core package closure includes the Agentic adapter")
  }

  const rootManifest = readJson(resolve(root, "package.json"))
  const exactCoreScripts = {
    "build:inference-core":
      "node scripts/inference-core/run-core-command.mjs build",
    "check:inference-core": "node scripts/inference-core/guardrails.mjs",
    "check:inference-core:base":
      "node scripts/inference-core/guardrails.mjs --base-ref origin/codex/inference-core-stack-reduction",
    "test:inference-core-authorization":
      "corepack pnpm --filter @llm-machines/contracts --fail-if-no-match exec vitest run src/inference-core-authorization.test.ts",
    "test:inference-core-characterization":
      "corepack pnpm --filter @llm-machines/bff --fail-if-no-match exec vitest run src/routes/inference-core-characterization.test.ts",
    "test:inference-core-guardrails":
      "node --test scripts/inference-core/*.test.mjs",
    test: "corepack pnpm run check:inference-core:base && corepack pnpm run test:inference-core-guardrails && corepack pnpm --filter @llm-machines/contracts --fail-if-no-match build && corepack pnpm --filter @llm-machines/copy --fail-if-no-match build && corepack pnpm run test:inference-core-authorization && corepack pnpm run test:inference-core-characterization && corepack pnpm -r --fail-if-no-match test",
    "typecheck:inference-core":
      "node scripts/inference-core/run-core-command.mjs typecheck",
  }
  for (const [scriptName, expected] of Object.entries(exactCoreScripts)) {
    if (rootManifest.scripts?.[scriptName] !== expected) {
      errors.push(`invalid Core-only script ${scriptName}`)
    }
    for (const prefix of ["pre", "post"]) {
      const lifecycleName = `${prefix}${scriptName}`
      if (rootManifest.scripts?.[lifecycleName] !== undefined) {
        errors.push(`forbidden root lifecycle script ${lifecycleName}`)
      }
    }
  }

  const exactPackageScripts = {
    "@llm-machines/bff": {
      build:
        "corepack pnpm --filter @llm-machines/contracts build && tsc --project tsconfig.json",
      test: "corepack pnpm --filter @llm-machines/contracts build && vitest run",
      typecheck: "tsc --project tsconfig.json",
    },
    "@llm-machines/web": {
      build:
        "corepack pnpm --filter @llm-machines/contracts build && corepack pnpm --filter @llm-machines/copy build && next build",
      test: "corepack pnpm --filter @llm-machines/contracts build && corepack pnpm --filter @llm-machines/copy build && vitest run",
      typecheck: "tsc --noEmit --project tsconfig.json",
    },
    "@llm-machines/contracts": {
      build: "tsc --project tsconfig.build.json",
      test: "vitest run && tsc --project tsconfig.json",
      typecheck: "tsc --project tsconfig.json",
    },
    "@llm-machines/copy": {
      build: "tsc --project tsconfig.build.json",
      test: "tsc --project tsconfig.json",
      typecheck: "tsc --project tsconfig.json",
    },
  }
  for (const [packageName, scripts] of Object.entries(exactPackageScripts)) {
    const manifest = packages.get(packageName)?.manifest
    for (const [scriptName, expected] of Object.entries(scripts)) {
      if (manifest?.scripts?.[scriptName] !== expected) {
        errors.push(`invalid ${packageName} script ${scriptName}`)
      }
      for (const prefix of ["pre", "post"]) {
        const lifecycleName = `${prefix}${scriptName}`
        if (manifest?.scripts?.[lifecycleName] !== undefined) {
          errors.push(
            `forbidden ${packageName} lifecycle script ${lifecycleName}`,
          )
        }
      }
    }
  }

  const workspaceManifest = readFileSync(
    resolve(root, "pnpm-workspace.yaml"),
    "utf8",
  ).replaceAll("\r\n", "\n")
  if (workspaceManifest !== "packages:\n  - apps/*\n  - packages/*\n") {
    errors.push("Core workspace membership changed")
  }
  const expectedTestConfigs = [
    "apps/bff/vitest.config.ts",
    "apps/web/vitest.config.ts",
  ]
  const actualTestConfigs = paths
    .filter((path) =>
      /^(?:(?:apps\/(?:bff|web)|packages\/(?:contracts|copy))\/)?(?:vite|vitest)\.config\.(?:cjs|cts|js|mjs|mts|ts)$/.test(
        path,
      ),
    )
    .sort()
  if (
    JSON.stringify(actualTestConfigs) !== JSON.stringify(expectedTestConfigs)
  ) {
    errors.push("Core test configuration surface changed")
  }

  return errors.sort()
}

export function verifyRetentionCharacterization(root = repositoryRoot) {
  const register = readJson(resolve(root, retentionCharacterizationPath))
  const errors = []
  const expectedRegisterKeys = [
    "d2aRcRetentionEvidence",
    "legacyGaps",
    "overallVerdict",
    "requiredArtifactClasses",
    "requiredSourceScenarios",
    "requiredTerminalStates",
    "runtimeZeroRetentionCompliance",
    "schemaVersion",
    "scope",
    "sourceCoverage",
  ]
  const expectedSourceCoverage = [
    {
      scenario: "non-stream-success",
      status: "EXISTING_AUDIT_AND_USAGE_ASSERTIONS",
    },
    {
      scenario: "stream-success",
      status: "EXISTING_AUDIT_AND_USAGE_ASSERTIONS",
    },
    { scenario: "rejection", status: "PARTIAL_SOURCE_CHARACTERIZATION" },
    { scenario: "cancellation", status: "NOT_EVALUATED_RUNTIME" },
    { scenario: "timeout", status: "SOURCE_CONTROL_ABSENT" },
    {
      scenario: "upstream-failure",
      status: "PARTIAL_SOURCE_CHARACTERIZATION",
    },
    { scenario: "crash", status: "NOT_EVALUATED_RUNTIME" },
    { scenario: "restart", status: "NOT_EVALUATED_RUNTIME" },
    { scenario: "backup", status: "NOT_EVALUATED_RUNTIME" },
    { scenario: "restore", status: "NOT_EVALUATED_RUNTIME" },
  ]
  const expectedLegacyGaps = [
    {
      id: "ZR-LEGACY-001",
      summary: "Gateway accounting failures log raw Error message and stack.",
      retireBy: "PR-07",
    },
    {
      id: "ZR-LEGACY-002",
      summary: "Audit reason and metadata accept unrestricted content.",
      retireBy: "PR-04",
    },
    {
      id: "ZR-LEGACY-003",
      summary: "Retired schemas and stores contain workload content.",
      retireBy: "PR-04",
    },
    {
      id: "ZR-LEGACY-004",
      summary:
        "Generic idempotency storage can retain arbitrary mutation responses.",
      retireBy: "PR-04",
    },
    {
      id: "ZR-COVERAGE-001",
      summary:
        "PostgreSQL and Redis persistence are not exercised by the source harness.",
      retireBy: "PR-12",
    },
    {
      id: "ZR-COVERAGE-002",
      summary:
        "Cancellation, timeout, crash, restart, backup, and restore are not fully exercised.",
      retireBy: "PR-12",
    },
    {
      id: "ZR-COVERAGE-003",
      summary:
        "LiteLLM, inference, Firecrawl, proxy, observability, and appliance stores require candidate-runtime evidence.",
      retireBy: "PR-12",
    },
  ]

  if (
    JSON.stringify(Object.keys(register).sort()) !==
      JSON.stringify(expectedRegisterKeys) ||
    register.schemaVersion !== 1 ||
    register.scope !== "pr01-source-characterization" ||
    register.overallVerdict !== "PR01_SOURCE_CHARACTERIZATION_INCOMPLETE" ||
    register.runtimeZeroRetentionCompliance !== "NOT_EVALUATED" ||
    register.d2aRcRetentionEvidence !== "NOT_DUE"
  ) {
    errors.push("retention characterization overstates PR-01 evidence")
  }
  if (
    JSON.stringify(register.requiredTerminalStates) !==
      JSON.stringify(requiredTerminalStates) ||
    JSON.stringify(register.requiredSourceScenarios) !==
      JSON.stringify(requiredSourceScenarios) ||
    JSON.stringify(register.requiredArtifactClasses) !==
      JSON.stringify(requiredSourceArtifactClasses)
  ) {
    errors.push("retention scenario or artifact contract changed")
  }
  if (
    JSON.stringify(register.sourceCoverage) !==
    JSON.stringify(expectedSourceCoverage)
  ) {
    errors.push("retention source-coverage register changed")
  }
  if (
    JSON.stringify(register.legacyGaps) !== JSON.stringify(expectedLegacyGaps)
  ) {
    errors.push("retention legacy-gap register changed")
  }
  const serialized = JSON.stringify(register).toLocaleUpperCase("en-US")
  for (const prohibitedClaim of [
    "ZERO_RETENTION_PASS",
    "CERTIFIED",
    '"COMPLIANT"',
  ]) {
    if (serialized.includes(prohibitedClaim)) {
      errors.push(`prohibited retention claim ${prohibitedClaim}`)
    }
  }

  return errors.sort()
}

export function extractBffRoutes({ root, paths }) {
  const routeFiles = paths.filter(
    (path) =>
      bffProductionSourcePattern.test(path) &&
      !/\.(?:test|spec)\.(?:cjs|cts|js|jsx|mjs|mts|ts|tsx)$/.test(path) &&
      !/\.d\.(?:cts|mts|ts)$/.test(path) &&
      isRegularFile(resolve(root, path)),
  )
  const routes = []

  for (const path of routeFiles) {
    const source = readFileSync(resolve(root, path), "utf8")
    const sourceFile = ts.createSourceFile(
      path,
      source,
      ts.ScriptTarget.Latest,
      true,
      scriptKindForPath(path),
    )
    if (sourceFile.parseDiagnostics.length > 0) {
      throw routeAnalysisError(
        path,
        sourceFile,
        sourceFile.parseDiagnostics[0]?.start ?? 0,
        "TypeScript syntax error",
      )
    }

    assertNoDynamicCodeLoading(path, sourceFile)
    assertReviewedFastifyImports(path, sourceFile)
    assertReviewedFastifyFactoryUse(path, sourceFile)
    assertReviewedBuildServerDefinition(path, sourceFile)
    assertReviewedFastifyRegistrarDefinition(path, sourceFile)
    const receiverNames = collectFastifyReceiverNames(sourceFile)
    const importedBindings = collectNamedImportBindings(sourceFile)
    const staticStrings = collectStaticStringConstants(sourceFile)
    assertNoRouteMethodAliases(
      path,
      sourceFile,
      receiverNames,
      importedBindings,
    )

    const visit = (node) => {
      if (ts.isCallExpression(node)) {
        const registrations = parseRouteCall({
          path,
          sourceFile,
          call: node,
          receiverNames,
          staticStrings,
        })
        for (const registration of registrations) {
          routes.push({
            surface: "bff",
            method: registration.method,
            path: registration.path,
            source: path,
            classification: classifyBffRoute(path, registration.path),
          })
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sourceFile)
  }

  return routes
}

function assertNoDynamicCodeLoading(path, sourceFile) {
  const visit = (node) => {
    const callTarget = ts.isCallExpression(node)
      ? unwrapExpression(node.expression)
      : null
    const constructorTarget = ts.isNewExpression(node)
      ? unwrapExpression(node.expression)
      : null
    if (
      (callTarget &&
        ((ts.isIdentifier(callTarget) &&
          ["eval", "require"].includes(callTarget.text)) ||
          callTarget.kind === ts.SyntaxKind.ImportKeyword)) ||
      (constructorTarget &&
        ts.isIdentifier(constructorTarget) &&
        constructorTarget.text === "Function")
    ) {
      throw routeAnalysisError(
        path,
        sourceFile,
        node,
        "Dynamic code loading is not allowed in the BFF production closure",
      )
    }
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      ["module", "node:module"].includes(node.moduleSpecifier.text) &&
      node.importClause?.namedBindings &&
      ts.isNamedImports(node.importClause.namedBindings) &&
      node.importClause.namedBindings.elements.some(
        (specifier) =>
          (specifier.propertyName?.text ?? specifier.name.text) ===
          "createRequire",
      )
    ) {
      throw routeAnalysisError(
        path,
        sourceFile,
        node,
        "Dynamic CommonJS loader creation is not allowed in the BFF production closure",
      )
    }
    if (
      ts.isCallExpression(node) &&
      (node.arguments ?? []).some((argument) => {
        const value = staticString(argument)
        return value === "fastify" || value?.startsWith("fastify/")
      })
    ) {
      throw routeAnalysisError(
        path,
        sourceFile,
        node,
        "Dynamic Fastify loading is not allowed in the BFF production closure",
      )
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
}

function assertReviewedFastifyImports(path, sourceFile) {
  for (const statement of sourceFile.statements) {
    if (
      (ts.isExportDeclaration(statement) &&
        statement.moduleSpecifier &&
        ts.isStringLiteral(statement.moduleSpecifier) &&
        (statement.moduleSpecifier.text === "fastify" ||
          statement.moduleSpecifier.text.startsWith("fastify/"))) ||
      (ts.isImportEqualsDeclaration(statement) &&
        ts.isExternalModuleReference(statement.moduleReference) &&
        statement.moduleReference.expression &&
        ts.isStringLiteral(statement.moduleReference.expression) &&
        (statement.moduleReference.expression.text === "fastify" ||
          statement.moduleReference.expression.text.startsWith("fastify/")))
    ) {
      throw routeAnalysisError(
        path,
        sourceFile,
        statement,
        "Unreviewed Fastify re-export or import-equals",
      )
    }
  }
  const fastifyImports = sourceFile.statements.filter(
    (statement) =>
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      (statement.moduleSpecifier.text === "fastify" ||
        statement.moduleSpecifier.text.startsWith("fastify/")),
  )
  if (fastifyImports.length === 0) {
    return
  }
  const deepImport = fastifyImports.find(
    (statement) => statement.moduleSpecifier.text !== "fastify",
  )
  if (deepImport) {
    throw routeAnalysisError(
      path,
      sourceFile,
      deepImport,
      "Unreviewed Fastify subpath import",
    )
  }
  if (!reviewedFastifySourcePaths.has(path) || fastifyImports.length !== 1) {
    throw routeAnalysisError(
      path,
      sourceFile,
      fastifyImports[0],
      "Unreviewed Fastify import",
    )
  }

  const importDeclaration = fastifyImports[0]
  const importClause = importDeclaration.importClause
  if (!importClause) {
    throw routeAnalysisError(
      path,
      sourceFile,
      importDeclaration,
      "Unreviewed Fastify side-effect import",
    )
  }
  if (path === "apps/bff/src/index.ts") {
    const namedBindings = importClause.namedBindings
    const namedImports =
      namedBindings && ts.isNamedImports(namedBindings)
        ? namedBindings.elements
        : []
    if (
      importClause.isTypeOnly ||
      importClause.name?.text !== "Fastify" ||
      namedImports.length !== 1 ||
      !namedImports[0]?.isTypeOnly ||
      namedImports[0]?.name.text !== "FastifyInstance" ||
      namedImports[0]?.propertyName
    ) {
      throw routeAnalysisError(
        path,
        sourceFile,
        importDeclaration,
        "Fastify runtime import changed",
      )
    }
    return
  }
  const namedBindings = importClause.namedBindings
  const specifierTypeOnly =
    namedBindings &&
    ts.isNamedImports(namedBindings) &&
    namedBindings.elements.length > 0 &&
    namedBindings.elements.every((specifier) => specifier.isTypeOnly)
  if (importClause.name || (!importClause.isTypeOnly && !specifierTypeOnly)) {
    throw routeAnalysisError(
      path,
      sourceFile,
      importDeclaration,
      "Fastify may only be type-imported outside the BFF entrypoint",
    )
  }
}

function assertReviewedFastifyFactoryUse(path, sourceFile) {
  if (path !== "apps/bff/src/index.ts") {
    return
  }
  let reviewedCalls = 0
  const visit = (node) => {
    if (
      ts.isIdentifier(node) &&
      node.text === "Fastify" &&
      isValueIdentifier(node)
    ) {
      const call = node.parent
      const declaration = call?.parent
      const declarationList = declaration?.parent
      const statement = declarationList?.parent
      const block = statement?.parent
      const buildServer = block?.parent
      const reviewed =
        call &&
        ts.isCallExpression(call) &&
        unwrapExpression(call.expression) === node &&
        call.arguments.length === 1 &&
        declaration &&
        ts.isVariableDeclaration(declaration) &&
        declaration.initializer === call &&
        ts.isIdentifier(declaration.name) &&
        declaration.name.text === "server" &&
        isConstVariableDeclaration(declaration) &&
        statement &&
        ts.isVariableStatement(statement) &&
        block &&
        ts.isBlock(block) &&
        buildServer &&
        ts.isFunctionDeclaration(buildServer) &&
        buildServer.name?.text === "buildServer" &&
        isReviewedFastifyFactoryOptions(call.arguments[0])
      if (!reviewed) {
        throw routeAnalysisError(
          path,
          sourceFile,
          node,
          "Fastify factory may only create the reviewed buildServer instance",
        )
      }
      reviewedCalls += 1
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  if (reviewedCalls !== 1) {
    throw new Error("Reviewed Fastify factory must be called exactly once")
  }
}

function isReviewedFastifyFactoryOptions(node) {
  const options = unwrapExpression(node)
  if (
    !options ||
    !ts.isObjectLiteralExpression(options) ||
    options.properties.some((property) => ts.isSpreadAssignment(property))
  ) {
    return false
  }
  const properties = new Map()
  for (const property of options.properties) {
    if (!ts.isPropertyAssignment(property)) {
      return false
    }
    const name = staticPropertyName(property.name)
    if (!name || properties.has(name)) {
      return false
    }
    properties.set(name, unwrapExpression(property.initializer))
  }
  const bodyLimit = properties.get("bodyLimit")
  const logger = properties.get("logger")
  return Boolean(
    properties.size === 2 &&
      bodyLimit &&
      ts.isCallExpression(bodyLimit) &&
      ts.isIdentifier(unwrapExpression(bodyLimit.expression)) &&
      unwrapExpression(bodyLimit.expression).text === "bffBodyLimitBytes" &&
      bodyLimit.arguments.length === 0 &&
      logger?.kind === ts.SyntaxKind.TrueKeyword,
  )
}

function assertReviewedBuildServerDefinition(path, sourceFile) {
  if (path !== "apps/bff/src/index.ts") {
    return
  }
  const definitions = sourceFile.statements.filter(
    (statement) =>
      ts.isFunctionDeclaration(statement) &&
      statement.name?.text === "buildServer" &&
      statement.modifiers?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
      ),
  )
  if (
    definitions.length !== 1 ||
    !definitions[0]?.body ||
    definitions[0].parameters.length !== 0
  ) {
    throw routeAnalysisError(
      path,
      sourceFile,
      definitions[0] ?? sourceFile,
      "Reviewed buildServer definition changed",
    )
  }
  const importedNames = new Set(
    reviewedFastifyRegistrarSpecs.map(({ exportName }) => exportName),
  )
  const visit = (node) => {
    if (
      ts.isIdentifier(node) &&
      importedNames.has(node.text) &&
      isShadowingBindingIdentifier(node)
    ) {
      throw routeAnalysisError(
        path,
        sourceFile,
        node,
        `Reviewed Fastify registrar binding may not be shadowed ${node.text}`,
      )
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
}

function assertReviewedFastifyRegistrarDefinition(path, sourceFile) {
  const spec = reviewedFastifyRegistrarSpecs.find(
    ({ sourcePath }) => sourcePath === path,
  )
  if (!spec) {
    return
  }
  const definitions = sourceFile.statements.filter(
    (statement) =>
      ts.isFunctionDeclaration(statement) &&
      statement.name?.text === spec.exportName &&
      statement.modifiers?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
      ),
  )
  const definition = definitions[0]
  const parameter = definition?.parameters[0]
  const routeHostTypes = collectRouteHostTypeNames(sourceFile)
  if (
    definitions.length !== 1 ||
    !definition?.body ||
    definition.parameters.length !== 1 ||
    !parameter ||
    !ts.isIdentifier(parameter.name) ||
    !isRouteHostType(parameter.type, sourceFile, routeHostTypes)
  ) {
    throw routeAnalysisError(
      path,
      sourceFile,
      definition ?? sourceFile,
      `Reviewed Fastify registrar definition changed for ${spec.exportName}`,
    )
  }
}

function collectNamedImportBindings(sourceFile) {
  const bindings = new Map()
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !statement.importClause?.namedBindings ||
      !ts.isNamedImports(statement.importClause.namedBindings)
    ) {
      continue
    }
    for (const specifier of statement.importClause.namedBindings.elements) {
      bindings.set(specifier.name.text, {
        importSource: statement.moduleSpecifier.text,
        importedName: specifier.propertyName?.text ?? specifier.name.text,
      })
    }
  }
  return bindings
}

export function extractFastifyRegistrarManifest({ root, paths }) {
  const indexPath = "apps/bff/src/index.ts"
  if (!paths.includes(indexPath) || !isRegularFile(resolve(root, indexPath))) {
    throw new Error(`Missing reviewed BFF entrypoint ${indexPath}`)
  }
  const sourceFile = ts.createSourceFile(
    indexPath,
    readFileSync(resolve(root, indexPath), "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )
  if (sourceFile.parseDiagnostics.length > 0) {
    throw routeAnalysisError(
      indexPath,
      sourceFile,
      sourceFile.parseDiagnostics[0]?.start ?? 0,
      "TypeScript syntax error",
    )
  }
  assertNoDynamicCodeLoading(indexPath, sourceFile)
  assertReviewedFastifyImports(indexPath, sourceFile)
  assertReviewedFastifyFactoryUse(indexPath, sourceFile)
  assertReviewedBuildServerDefinition(indexPath, sourceFile)
  const receiverNames = collectFastifyReceiverNames(sourceFile)
  const importedBindings = collectNamedImportBindings(sourceFile)
  const candidates = new Set(paths)
  const entries = []
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const callee = unwrapExpression(node.expression)
      const localName = ts.isIdentifier(callee) ? callee.text : null
      const binding = localName ? importedBindings.get(localName) : null
      const spec = reviewedFastifyRegistrarSpecs.find(
        ({ exportName, importSource }) =>
          exportName === binding?.importedName &&
          importSource === binding?.importSource &&
          localName === exportName,
      )
      if (
        spec &&
        isReviewedFastifyRegistrarCall({
          path: indexPath,
          sourceFile,
          call: node,
          receiverNames,
          importedBindings,
        })
      ) {
        if (!candidates.has(spec.sourcePath)) {
          throw routeAnalysisError(
            indexPath,
            sourceFile,
            node,
            `Reviewed Fastify registrar source is missing ${spec.sourcePath}`,
          )
        }
        entries.push({
          exportName: spec.exportName,
          importSource: spec.importSource,
          sourcePath: spec.sourcePath,
        })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)

  const counts = new Map()
  for (const entry of entries) {
    counts.set(entry.exportName, (counts.get(entry.exportName) ?? 0) + 1)
  }
  for (const [exportName, count] of counts) {
    if (count !== 1) {
      throw new Error(
        `Reviewed Fastify registrar must be called exactly once ${exportName}`,
      )
    }
  }
  return entries.sort((left, right) =>
    left.exportName.localeCompare(right.exportName),
  )
}

function collectFastifyReceiverNames(sourceFile) {
  const names = new Set()
  const aliases = []
  const locallyDeclaredRouteHostTypes = collectRouteHostTypeNames(sourceFile)

  const visit = (node) => {
    if (
      ts.isParameter(node) &&
      ts.isIdentifier(node.name) &&
      isRouteHostType(node.type, sourceFile, locallyDeclaredRouteHostTypes)
    ) {
      names.add(node.name.text)
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      if (isFastifyFactoryCall(node.initializer)) {
        names.add(node.name.text)
      } else if (node.initializer && ts.isIdentifier(node.initializer)) {
        aliases.push([node.name.text, node.initializer.text])
      }
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(node.left) &&
      ts.isIdentifier(node.right)
    ) {
      aliases.push([node.left.text, node.right.text])
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)

  let changed = true
  while (changed) {
    changed = false
    for (const [alias, subject] of aliases) {
      if (names.has(subject) && !names.has(alias)) {
        names.add(alias)
        changed = true
      }
    }
  }
  return names
}

function collectRouteHostTypeNames(sourceFile) {
  const names = new Set()
  const visit = (node) => {
    if (
      (ts.isInterfaceDeclaration(node) ||
        ts.isClassDeclaration(node) ||
        ts.isTypeAliasDeclaration(node)) &&
      node.name &&
      containsRouteHostMember(node)
    ) {
      names.add(node.name.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return names
}

function containsRouteHostMember(node) {
  const members = ts.isTypeAliasDeclaration(node)
    ? ts.isTypeLiteralNode(node.type)
      ? node.type.members
      : []
    : node.members
  return members.some((member) => {
    const name = member.name ? staticPropertyName(member.name) : null
    return Boolean(
      name &&
        isCallableRouteHostMember(member) &&
        (routeMethods.includes(name) ||
          name === "route" ||
          unsupportedFastifyMethods.has(name) ||
          controlledFastifyMethods.has(name)),
    )
  })
}

function isCallableRouteHostMember(member) {
  return (
    ts.isMethodSignature(member) ||
    ts.isMethodDeclaration(member) ||
    ((ts.isPropertySignature(member) || ts.isPropertyDeclaration(member)) &&
      Boolean(member.type && ts.isFunctionTypeNode(member.type)))
  )
}

function isRouteHostType(node, sourceFile, locallyDeclaredRouteHostTypes) {
  const text = node?.getText(sourceFile) ?? ""
  return (
    /(?:FastifyInstance|RouteHost|Router|(?:Endpoint|Http|Route)\w*(?:Host|Router|Server))/.test(
      text,
    ) ||
    [...locallyDeclaredRouteHostTypes].some((name) =>
      new RegExp(`\\b${name}\\b`).test(text),
    ) ||
    (node && ts.isTypeLiteralNode(node) && containsRouteHostMember(node))
  )
}

function assertNoRouteMethodAliases(
  path,
  sourceFile,
  receiverNames,
  importedBindings,
) {
  const visit = (node) => {
    if (
      ts.isIdentifier(node) &&
      receiverNames.has(node.text) &&
      isValueIdentifier(node) &&
      !isReviewedFastifyReceiverUse({
        path,
        sourceFile,
        node,
        receiverNames,
        importedBindings,
      })
    ) {
      throw routeAnalysisError(
        path,
        sourceFile,
        node,
        "Unreviewed Fastify instance value use",
      )
    }
    if (ts.isCallExpression(node)) {
      const receiverArguments = node.arguments.filter((argument) =>
        containsKnownFastifyReceiver(argument, receiverNames),
      )
      if (
        receiverArguments.length > 0 &&
        !isReviewedFastifyRegistrarCall({
          path,
          sourceFile,
          call: node,
          receiverNames,
          importedBindings,
        })
      ) {
        throw routeAnalysisError(
          path,
          sourceFile,
          receiverArguments[0],
          "Fastify instance may not escape to an unreviewed call",
        )
      }

      const member = staticMemberCall(unwrapExpression(node.expression))
      if (
        member &&
        isTrackedFastifyReceiver(member.receiver, receiverNames) &&
        !routeMethods.includes(member.name) &&
        member.name !== "route" &&
        !unsupportedFastifyMethods.has(member.name) &&
        !controlledFastifyMethods.has(member.name) &&
        !isReviewedFastifyListenCall(path, node, member)
      ) {
        throw routeAnalysisError(
          path,
          sourceFile,
          node,
          `Unreviewed Fastify instance method ${member.name}`,
        )
      }
    }
    if (
      ts.isNewExpression(node) &&
      (node.arguments ?? []).some((argument) =>
        containsKnownFastifyReceiver(argument, receiverNames),
      )
    ) {
      throw routeAnalysisError(
        path,
        sourceFile,
        node,
        "Fastify instance may not escape to a constructor",
      )
    }
    if (
      ts.isTaggedTemplateExpression(node) &&
      containsKnownFastifyReceiver(node.template, receiverNames)
    ) {
      throw routeAnalysisError(
        path,
        sourceFile,
        node,
        "Fastify instance may not escape through a tagged template",
      )
    }
    if (
      ts.isReturnStatement(node) &&
      node.expression &&
      containsKnownFastifyReceiver(node.expression, receiverNames) &&
      !isReviewedBuildServerReturn(path, node, receiverNames)
    ) {
      throw routeAnalysisError(
        path,
        sourceFile,
        node,
        "Fastify instance may only be returned from buildServer",
      )
    }
    if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      containsKnownFastifyReceiver(node.initializer, receiverNames) &&
      !isReviewedFastifyAlias(path, node, receiverNames)
    ) {
      throw routeAnalysisError(
        path,
        sourceFile,
        node,
        "Fastify instance may not be captured",
      )
    }
    if (
      ts.isBinaryExpression(node) &&
      ts.isAssignmentOperator(node.operatorToken.kind) &&
      containsKnownFastifyReceiver(node.right, receiverNames)
    ) {
      throw routeAnalysisError(
        path,
        sourceFile,
        node,
        "Fastify instance may not be assigned to an external target",
      )
    }
    if (
      ((ts.isExportAssignment(node) &&
        containsKnownFastifyReceiver(node.expression, receiverNames)) ||
        (ts.isYieldExpression(node) &&
          node.expression &&
          containsKnownFastifyReceiver(node.expression, receiverNames)) ||
        (ts.isExportSpecifier(node) &&
          receiverNames.has((node.propertyName ?? node.name).text))) &&
      !ts.isReturnStatement(node)
    ) {
      throw routeAnalysisError(
        path,
        sourceFile,
        node,
        "Fastify instance may not be exported or yielded",
      )
    }
    if (
      ts.isElementAccessExpression(node) &&
      isKnownFastifyReceiver(node.expression, receiverNames) &&
      staticString(node.argumentExpression) === null
    ) {
      throw routeAnalysisError(
        path,
        sourceFile,
        node,
        "Dynamic Fastify property access is not allowed",
      )
    }
    const rawServer = staticMemberCall(node)
    if (
      rawServer?.name === "server" &&
      isKnownFastifyReceiver(rawServer.receiver, receiverNames)
    ) {
      throw routeAnalysisError(
        path,
        sourceFile,
        node,
        "Fastify raw server access is not allowed",
      )
    }
    if (
      isRouteMethodReference(node, receiverNames) &&
      !(
        ts.isCallExpression(node.parent) &&
        unwrapExpression(node.parent.expression) === node
      )
    ) {
      throw routeAnalysisError(
        path,
        sourceFile,
        node,
        "Fastify route methods may only be used as direct registration callees",
      )
    }
    if (
      ts.isCallExpression(node) &&
      isIndirectRouteMethodInvocation(node.expression, receiverNames)
    ) {
      throw routeAnalysisError(
        path,
        sourceFile,
        node,
        "Fastify route methods may not use call, apply, or bind",
      )
    }
    if (ts.isVariableDeclaration(node) && node.initializer) {
      if (
        ts.isIdentifier(node.name) &&
        isRouteMethodReference(node.initializer, receiverNames)
      ) {
        throw routeAnalysisError(
          path,
          sourceFile,
          node,
          "Fastify route methods may not be extracted or bound",
        )
      }
      if (
        ts.isObjectBindingPattern(node.name) &&
        isKnownFastifyReceiver(node.initializer, receiverNames)
      ) {
        for (const element of node.name.elements) {
          const propertyName = element.propertyName ?? element.name
          const method = staticPropertyName(propertyName)
          if (
            method &&
            (routeMethods.includes(method) ||
              method === "route" ||
              method === "server" ||
              unsupportedFastifyMethods.has(method) ||
              controlledFastifyMethods.has(method))
          ) {
            throw routeAnalysisError(
              path,
              sourceFile,
              element,
              "Fastify route methods may not be destructured",
            )
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
}

function isReviewedFastifyReceiverUse({
  path,
  sourceFile,
  node,
  receiverNames,
  importedBindings,
}) {
  const parent = node.parent
  if (
    ts.isVariableDeclaration(parent) &&
    parent.initializer === node &&
    isReviewedFastifyAlias(path, parent, receiverNames)
  ) {
    return true
  }
  if (
    ts.isReturnStatement(parent) &&
    parent.expression === node &&
    isReviewedBuildServerReturn(path, parent, receiverNames)
  ) {
    return true
  }
  if (
    ts.isCallExpression(parent) &&
    parent.arguments.some((argument) => argument === node) &&
    isReviewedFastifyRegistrarCall({
      path,
      sourceFile,
      call: parent,
      receiverNames,
      importedBindings,
    })
  ) {
    return true
  }

  let expression = node
  while (
    expression.parent &&
    isExpressionWrapper(expression.parent) &&
    expression.parent.expression === expression
  ) {
    expression = expression.parent
  }
  const member = expression.parent
  if (
    member &&
    (ts.isPropertyAccessExpression(member) ||
      ts.isElementAccessExpression(member)) &&
    member.expression === expression &&
    ts.isCallExpression(member.parent) &&
    unwrapExpression(member.parent.expression) === member
  ) {
    return true
  }
  return false
}

function isExpressionWrapper(node) {
  return (
    ts.isAsExpression(node) ||
    ts.isParenthesizedExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isTypeAssertionExpression(node)
  )
}

function containsKnownFastifyReceiver(node, receiverNames) {
  let found = false
  const visit = (candidate) => {
    if (found) {
      return
    }
    const subject = unwrapExpression(candidate)
    if (
      ts.isIdentifier(subject) &&
      isValueIdentifier(subject) &&
      isTrackedFastifyReceiver(subject, receiverNames)
    ) {
      found = true
      return
    }
    ts.forEachChild(candidate, visit)
  }
  visit(node)
  return found
}

function isValueIdentifier(node) {
  const parent = node.parent
  if (
    (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
    ((ts.isPropertyAssignment(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isMethodSignature(parent) ||
      ts.isPropertyDeclaration(parent) ||
      ts.isPropertySignature(parent)) &&
      parent.name === node) ||
    (ts.isVariableDeclaration(parent) && parent.name === node) ||
    (ts.isParameter(parent) && parent.name === node) ||
    ts.isImportSpecifier(parent) ||
    ts.isImportClause(parent) ||
    ts.isTypeReferenceNode(parent)
  ) {
    return false
  }
  return true
}

function isReviewedFastifyRegistrarCall({
  path,
  sourceFile,
  call,
  receiverNames,
  importedBindings,
}) {
  const callee = unwrapExpression(call.expression)
  const receiver = unwrapExpression(call.arguments[0])
  if (
    path !== "apps/bff/src/index.ts" ||
    !ts.isIdentifier(callee) ||
    call.arguments.length !== 1 ||
    !receiver ||
    !ts.isIdentifier(receiver) ||
    !isTrackedFastifyReceiver(receiver, receiverNames)
  ) {
    return false
  }
  const binding = importedBindings.get(callee.text)
  const spec = reviewedFastifyRegistrarSpecs.find(
    ({ exportName, importSource }) =>
      exportName === binding?.importedName &&
      importSource === binding?.importSource &&
      callee.text === exportName,
  )
  if (!spec) {
    return false
  }
  if (!isDirectBuildServerStatement(call)) {
    throw routeAnalysisError(
      path,
      sourceFile,
      call,
      `Reviewed Fastify registrar ${spec.exportName} must be unconditional`,
    )
  }
  return true
}

function isDirectBuildServerStatement(call) {
  const statement = call.parent
  const body = statement?.parent
  const declaration = body?.parent
  return Boolean(
    statement &&
      ts.isExpressionStatement(statement) &&
      body &&
      ts.isBlock(body) &&
      declaration &&
      ts.isFunctionDeclaration(declaration) &&
      declaration.name?.text === "buildServer",
  )
}

function isReviewedFastifyAlias(path, node, receiverNames) {
  const initializer = node.initializer
  if (
    path === "apps/bff/src/index.ts" &&
    ts.isIdentifier(node.name) &&
    node.name.text === "server" &&
    isFastifyFactoryCall(initializer)
  ) {
    return true
  }
  if (
    !ts.isIdentifier(node.name) ||
    !initializer ||
    !ts.isIdentifier(initializer) ||
    !isTrackedFastifyReceiver(initializer, receiverNames) ||
    !isConstVariableDeclaration(node)
  ) {
    return false
  }
  const variableStatement = node.parent?.parent
  return !(
    variableStatement &&
    ts.isVariableStatement(variableStatement) &&
    variableStatement.modifiers?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
    )
  )
}

function isReviewedBuildServerReturn(path, node, receiverNames) {
  const expression = node.expression
  const body = node.parent
  const declaration = body?.parent
  return Boolean(
    path === "apps/bff/src/index.ts" &&
      expression &&
      ts.isIdentifier(expression) &&
      isTrackedFastifyReceiver(expression, receiverNames) &&
      body &&
      ts.isBlock(body) &&
      declaration &&
      ts.isFunctionDeclaration(declaration) &&
      declaration.name?.text === "buildServer",
  )
}

function isReviewedFastifyListenCall(path, call, member) {
  if (
    path !== "apps/bff/src/index.ts" ||
    member.name !== "listen" ||
    call.arguments.length !== 1
  ) {
    return false
  }
  const options = unwrapExpression(call.arguments[0])
  if (!options || !ts.isObjectLiteralExpression(options)) {
    return false
  }
  const keys = options.properties
    .map((property) =>
      property.name ? staticPropertyName(property.name) : null,
    )
    .filter(Boolean)
    .sort()
  return JSON.stringify(keys) === JSON.stringify(["host", "port"])
}

function isIndirectRouteMethodInvocation(node, receiverNames) {
  const member = staticMemberCall(unwrapExpression(node))
  return Boolean(
    member &&
      ["apply", "bind", "call"].includes(member.name) &&
      isRouteMethodReference(member.receiver, receiverNames),
  )
}

function parseRouteCall({
  path,
  sourceFile,
  call,
  receiverNames,
  staticStrings,
}) {
  const member = staticMemberCall(call.expression)
  if (!member) {
    if (
      ts.isElementAccessExpression(call.expression) &&
      isKnownFastifyReceiver(call.expression.expression, receiverNames)
    ) {
      throw routeAnalysisError(
        path,
        sourceFile,
        call.expression,
        "Dynamic Fastify route method is not allowed",
      )
    }
    return []
  }

  const firstArgument = call.arguments[0]
  const literalRoutePath = staticStringWithConstants(
    firstArgument,
    staticStrings,
  )
  const routeOptionsPath =
    member.name === "route"
      ? staticRouteOptionsUrl(firstArgument, staticStrings)
      : null
  const knownReceiver = isKnownFastifyReceiver(member.receiver, receiverNames)
  const unconditionalRouteControl =
    controlledFastifyMethods.has(member.name) ||
    [
      "addHttpMethod",
      "register",
      "setErrorHandler",
      "setNotFoundHandler",
    ].includes(member.name)
  const conservativeRouteModule =
    path === "apps/bff/src/index.ts" || path.startsWith("apps/bff/src/routes/")
  const routeShaped =
    literalRoutePath?.startsWith("/") || routeOptionsPath?.startsWith("/")

  if (
    !knownReceiver &&
    !routeShaped &&
    !unconditionalRouteControl &&
    !(
      conservativeRouteModule &&
      (routeMethods.includes(member.name) || member.name === "route") &&
      firstArgument &&
      staticStringWithConstants(firstArgument, staticStrings) === null
    )
  ) {
    return []
  }
  if (unsupportedFastifyMethods.has(member.name)) {
    throw routeAnalysisError(
      path,
      sourceFile,
      call,
      `Unsupported Fastify route API ${member.name}`,
    )
  }
  if (controlledFastifyMethods.has(member.name)) {
    assertReviewedFastifyControlCall(path, sourceFile, call, member.name)
    return []
  }
  if (routeMethods.includes(member.name)) {
    return [
      parseShorthandRoute(
        path,
        sourceFile,
        call,
        member.name.toUpperCase(),
        staticStrings,
      ),
    ]
  }
  if (member.name === "route") {
    return parseRouteOptions(path, sourceFile, call, staticStrings)
  }
  return []
}

function parseShorthandRoute(path, sourceFile, call, method, staticStrings) {
  const routePath = staticStringWithConstants(call.arguments[0], staticStrings)
  if (!routePath?.startsWith("/")) {
    throw routeAnalysisError(
      path,
      sourceFile,
      call,
      "Fastify shorthand route path must be a static absolute literal",
    )
  }
  assertReviewedShorthandRouteOptions(path, sourceFile, call)
  return { method, path: routePath }
}

function assertReviewedShorthandRouteOptions(path, sourceFile, call) {
  if (call.arguments.length === 2) {
    return
  }
  if (call.arguments.length !== 3) {
    throw routeAnalysisError(
      path,
      sourceFile,
      call,
      "Fastify shorthand route overload changed",
    )
  }
  const options = unwrapExpression(call.arguments[1])
  if (
    options &&
    ts.isCallExpression(options) &&
    ts.isIdentifier(unwrapExpression(options.expression)) &&
    unwrapExpression(options.expression).text === "withPersona"
  ) {
    return
  }
  if (
    !options ||
    !ts.isObjectLiteralExpression(options) ||
    options.properties.some((property) => ts.isSpreadAssignment(property))
  ) {
    throw routeAnalysisError(
      path,
      sourceFile,
      call.arguments[1],
      "Fastify shorthand route options must be reviewed inline options",
    )
  }
  assertNoFastifyRouteConstraints(path, sourceFile, options)
}

function parseRouteOptions(path, sourceFile, call, staticStrings) {
  const options = call.arguments[0]
  if (!options || !ts.isObjectLiteralExpression(options)) {
    throw routeAnalysisError(
      path,
      sourceFile,
      call,
      "Fastify route options must be an inline object literal",
    )
  }
  if (options.properties.some((property) => ts.isSpreadAssignment(property))) {
    throw routeAnalysisError(
      path,
      sourceFile,
      options,
      "Fastify route options may not contain spreads",
    )
  }
  assertNoFastifyRouteConstraints(path, sourceFile, options)

  const methodProperties = namedProperties(options, "method")
  const urlProperties = namedProperties(options, "url")
  if (methodProperties.length !== 1 || urlProperties.length !== 1) {
    throw routeAnalysisError(
      path,
      sourceFile,
      options,
      "Fastify route options require one static method and one static url",
    )
  }
  const methods = staticHttpMethods(
    methodProperties[0]?.initializer,
    staticStrings,
  )
  const routePath = staticStringWithConstants(
    urlProperties[0]?.initializer,
    staticStrings,
  )
  if (methods.length === 0 || !routePath?.startsWith("/")) {
    throw routeAnalysisError(
      path,
      sourceFile,
      options,
      "Fastify route method and url must be static literals",
    )
  }
  return methods.map((method) => ({ method, path: routePath }))
}

function assertReviewedFastifyControlCall(path, sourceFile, call, method) {
  const hook = staticString(call.arguments[0])
  const handler = unwrapExpression(call.arguments[1])
  if (
    method === "addHook" &&
    path === "apps/bff/src/auth/persona.ts" &&
    hook === "preHandler" &&
    call.arguments.length === 2 &&
    handler &&
    ts.isIdentifier(handler) &&
    handler.text === "authHook"
  ) {
    return
  }
  throw routeAnalysisError(
    path,
    sourceFile,
    call,
    `Unreviewed Fastify route-control API ${method}`,
  )
}

function assertNoFastifyRouteConstraints(path, sourceFile, options) {
  if (!options || !ts.isObjectLiteralExpression(options)) {
    return
  }
  if (options.properties.some((property) => ts.isSpreadAssignment(property))) {
    throw routeAnalysisError(
      path,
      sourceFile,
      options,
      "Fastify route options may not contain spreads",
    )
  }
  const constrained = options.properties.some((property) => {
    const name = property.name ? staticPropertyName(property.name) : null
    return name === "constraints" || name === "version"
  })
  if (constrained) {
    throw routeAnalysisError(
      path,
      sourceFile,
      options,
      "Fastify route constraints and versions are not allowed",
    )
  }
}

function namedProperties(objectLiteral, name) {
  return objectLiteral.properties.filter(
    (property) =>
      ts.isPropertyAssignment(property) &&
      staticPropertyName(property.name) === name,
  )
}

function staticHttpMethods(node, staticStrings) {
  const nodes =
    node && ts.isArrayLiteralExpression(node) ? node.elements : [node]
  const methods = []
  for (const candidate of nodes) {
    const method = staticStringWithConstants(
      candidate,
      staticStrings,
    )?.toUpperCase()
    if (!method || !routeMethods.includes(method.toLowerCase())) {
      return []
    }
    methods.push(method)
  }
  return [...new Set(methods)].sort()
}

function staticRouteOptionsUrl(node, staticStrings) {
  if (!node || !ts.isObjectLiteralExpression(node)) {
    return null
  }
  const urlProperties = namedProperties(node, "url")
  return urlProperties.length === 1
    ? staticStringWithConstants(urlProperties[0]?.initializer, staticStrings)
    : null
}

function staticMemberCall(expression) {
  if (ts.isPropertyAccessExpression(expression)) {
    return { receiver: expression.expression, name: expression.name.text }
  }
  if (ts.isElementAccessExpression(expression)) {
    const name = staticString(expression.argumentExpression)
    return name ? { receiver: expression.expression, name } : null
  }
  return null
}

function staticPropertyName(node) {
  if (ts.isIdentifier(node)) {
    return node.text
  }
  return staticString(node)
}

function staticString(node) {
  const subject = unwrapExpression(node)
  if (
    subject &&
    (ts.isStringLiteral(subject) || ts.isNoSubstitutionTemplateLiteral(subject))
  ) {
    return subject.text
  }
  if (
    subject &&
    ts.isBinaryExpression(subject) &&
    subject.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    const left = staticString(subject.left)
    const right = staticString(subject.right)
    return left !== null && right !== null ? `${left}${right}` : null
  }
  if (subject && ts.isTemplateExpression(subject)) {
    let value = subject.head.text
    for (const span of subject.templateSpans) {
      const expression = staticString(span.expression)
      if (expression === null) {
        return null
      }
      value += expression
      value += span.literal.text
    }
    return value
  }
  return null
}

function scriptKindForPath(path) {
  if (path.endsWith(".tsx")) {
    return ts.ScriptKind.TSX
  }
  if (path.endsWith(".jsx")) {
    return ts.ScriptKind.JSX
  }
  if (path.endsWith(".js") || path.endsWith(".mjs") || path.endsWith(".cjs")) {
    return ts.ScriptKind.JS
  }
  return ts.ScriptKind.TS
}

function isKnownFastifyReceiver(node, receiverNames) {
  const subject = unwrapExpression(node)
  return (
    (ts.isIdentifier(subject) &&
      (receiverNames.has(subject.text) ||
        routeReceiverNamePattern.test(subject.text))) ||
    isFastifyFactoryCall(subject)
  )
}

function isTrackedFastifyReceiver(node, receiverNames) {
  const subject = unwrapExpression(node)
  return (
    (ts.isIdentifier(subject) && receiverNames.has(subject.text)) ||
    isFastifyFactoryCall(subject)
  )
}

function isFastifyFactoryCall(node) {
  if (!node || !ts.isCallExpression(node)) {
    return false
  }
  const expression = unwrapExpression(node.expression)
  return (
    ts.isIdentifier(expression) && /^(?:fastify|Fastify)$/.test(expression.text)
  )
}

function isRouteMethodReference(node, receiverNames) {
  const subject = unwrapExpression(node)
  if (
    ts.isCallExpression(subject) &&
    staticMemberCall(subject.expression)?.name === "bind"
  ) {
    return isRouteMethodReference(
      staticMemberCall(subject.expression)?.receiver,
      receiverNames,
    )
  }
  const member = staticMemberCall(subject)
  return Boolean(
    member &&
      isKnownFastifyReceiver(member.receiver, receiverNames) &&
      (routeMethods.includes(member.name) ||
        member.name === "route" ||
        unsupportedFastifyMethods.has(member.name) ||
        controlledFastifyMethods.has(member.name)),
  )
}

function unwrapExpression(node) {
  let subject = node
  while (
    subject &&
    (ts.isAsExpression(subject) ||
      ts.isParenthesizedExpression(subject) ||
      ts.isNonNullExpression(subject) ||
      ts.isSatisfiesExpression(subject) ||
      ts.isTypeAssertionExpression(subject))
  ) {
    subject = subject.expression
  }
  return subject
}

function routeAnalysisError(path, sourceFile, location, reason) {
  const start = typeof location === "number" ? location : location.getStart()
  const line =
    sourceFile.getLineAndCharacterOfPosition(Math.max(0, start)).line + 1
  return new Error(`${reason} in ${path}:${line}`)
}

export function extractWebInferenceConsumers({ root, paths }) {
  const consumers = []
  for (const path of paths) {
    if (
      !/^apps\/web\/.*\.(?:cjs|cts|js|jsx|mjs|mts|ts|tsx)$/.test(path) ||
      /\.(?:test|spec)\.(?:cjs|cts|js|jsx|mjs|mts|ts|tsx)$/.test(path) ||
      /\.d\.(?:cts|mts|ts)$/.test(path) ||
      !isRegularFile(resolve(root, path))
    ) {
      continue
    }
    const source = readFileSync(resolve(root, path), "utf8")
    const sourceFile = ts.createSourceFile(
      path,
      source,
      ts.ScriptTarget.Latest,
      true,
      scriptKindForPath(path),
    )
    if (sourceFile.parseDiagnostics.length > 0) {
      throw routeAnalysisError(
        path,
        sourceFile,
        sourceFile.parseDiagnostics[0]?.start ?? 0,
        "TypeScript syntax error",
      )
    }
    const constants = collectStaticStringConstants(sourceFile)
    let invocationCount = 0
    const visit = (node) => {
      if (
        (ts.isCallExpression(node) || ts.isNewExpression(node)) &&
        (node.arguments ?? []).some((argument) =>
          expressionIncludesWebInferenceEndpoint(argument, constants),
        )
      ) {
        invocationCount += 1
      }
      ts.forEachChild(node, visit)
    }
    visit(sourceFile)
    if (invocationCount > 0) {
      consumers.push({
        path,
        invocationCount,
        sha256: sha256(readFileSync(resolve(root, path))),
        removeBy: "PR-03",
      })
    }
  }
  return consumers.sort((left, right) => left.path.localeCompare(right.path))
}

function collectStaticStringConstants(sourceFile) {
  const declarationsByName = new Map()
  const constants = new Map()
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      isConstVariableDeclaration(node)
    ) {
      const declarations = declarationsByName.get(node.name.text) ?? []
      declarations.push(node)
      declarationsByName.set(node.name.text, declarations)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)

  let changed = true
  while (changed) {
    changed = false
    for (const declarations of declarationsByName.values()) {
      if (declarations.length !== 1) {
        continue
      }
      const declaration = declarations[0]
      if (constants.has(declaration.name.text)) {
        continue
      }
      const value = staticStringWithConstants(
        declaration.initializer,
        constants,
      )
      if (value !== null) {
        constants.set(declaration.name.text, value)
        changed = true
      }
    }
  }
  const ambiguous = new Map()
  for (const [name, declarations] of declarationsByName) {
    if (declarations.length < 2) {
      continue
    }
    const candidates = declarations
      .map((declaration) =>
        staticStringWithConstants(declaration.initializer, constants),
      )
      .filter((value) => value !== null)
    if (candidates.length > 0) {
      ambiguous.set(name, candidates)
    }
  }
  Object.defineProperty(constants, ambiguousStaticStringCandidates, {
    value: ambiguous,
  })
  return constants
}

function staticStringWithConstants(node, constants) {
  const subject = unwrapExpression(node)
  if (subject && ts.isIdentifier(subject)) {
    return constants.get(subject.text) ?? null
  }
  if (
    subject &&
    (ts.isStringLiteral(subject) || ts.isNoSubstitutionTemplateLiteral(subject))
  ) {
    return subject.text
  }
  if (
    subject &&
    ts.isBinaryExpression(subject) &&
    subject.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    const left = staticStringWithConstants(subject.left, constants)
    const right = staticStringWithConstants(subject.right, constants)
    return left !== null && right !== null ? `${left}${right}` : null
  }
  if (subject && ts.isTemplateExpression(subject)) {
    let value = subject.head.text
    for (const span of subject.templateSpans) {
      const expression = staticStringWithConstants(span.expression, constants)
      if (expression === null) {
        return null
      }
      value += expression
      value += span.literal.text
    }
    return value
  }
  return null
}

function expressionIncludesWebInferenceEndpoint(node, constants) {
  const value = staticStringWithConstants(node, constants)
  if (value !== null && webInferenceEndpointPattern.test(value)) {
    return true
  }
  const ambiguous = constants[ambiguousStaticStringCandidates] ?? new Map()
  const subject = unwrapExpression(node)
  if (
    subject &&
    ts.isIdentifier(subject) &&
    (ambiguous.get(subject.text) ?? []).some((candidate) =>
      webInferenceEndpointPattern.test(candidate),
    )
  ) {
    return true
  }
  const fragments = []
  const visit = (candidate) => {
    const subject = unwrapExpression(candidate)
    if (
      subject &&
      (ts.isStringLiteral(subject) ||
        ts.isNoSubstitutionTemplateLiteral(subject))
    ) {
      fragments.push(subject.text)
      return
    }
    if (subject && ts.isTemplateExpression(subject)) {
      fragments.push(subject.head.text)
      for (const span of subject.templateSpans) {
        visit(span.expression)
        fragments.push(span.literal.text)
      }
      return
    }
    ts.forEachChild(candidate, visit)
  }
  visit(node)
  return (
    fragments.some((fragment) => webInferenceEndpointPattern.test(fragment)) ||
    webInferenceEndpointPattern.test(fragments.join(""))
  )
}

export function extractWebRoutes({ root, paths }) {
  const routes = []
  for (const path of paths) {
    const publicAsset = path.match(/^apps\/web\/public\/(.+)$/)
    if (publicAsset && isRegularFile(resolve(root, path))) {
      routes.push({
        surface: "web-static",
        method: "STATIC",
        path: `/${publicAsset[1]}`,
        source: path,
        classification: "current-console-seam",
      })
      continue
    }
    if (
      /^apps\/web\/.*\.(?:cjs|cts|js|jsx|mjs|mts|ts|tsx)$/.test(path) &&
      !/\.(?:test|spec)\.(?:cjs|cts|js|jsx|mjs|mts|ts|tsx)$/.test(path) &&
      isRegularFile(resolve(root, path))
    ) {
      assertNoNextRewriteRegistration(root, path)
      if (path === "apps/web/src/middleware.ts") {
        assertReviewedNextMiddleware(root, path)
      }
    }
    if (
      /^apps\/web\/(?:src\/)?pages(?:\/|$)/.test(path) &&
      !/\.(?:test|spec)\.(?:js|jsx|ts|tsx)$/.test(path)
    ) {
      throw new Error(`Next Pages Router is not allowed in ${path}`)
    }
    if (
      /^apps\/web\/(?:src\/)?middleware\.(?:cjs|cts|js|jsx|mjs|mts|ts|tsx)$/.test(
        path,
      ) &&
      path !== "apps/web/src/middleware.ts"
    ) {
      throw new Error(`Unreviewed Next middleware entrypoint ${path}`)
    }
    if (
      /^apps\/web\/(?:src\/)?proxy\.(?:cjs|cts|js|jsx|mjs|mts|ts|tsx)$/.test(
        path,
      )
    ) {
      throw new Error(`Unreviewed Next proxy entrypoint ${path}`)
    }
    if (
      /^apps\/web\/(?:src\/)?app\/(?:.*\/)?(?:global-)?not-found\.(?:js|jsx|ts|tsx)$/.test(
        path,
      )
    ) {
      throw new Error(`Unreviewed Next fallback surface ${path}`)
    }
    if (
      /^apps\/web\/next\.config\.(?:cjs|cts|js|mjs|mts|ts)$/.test(path) &&
      path !== "apps/web/next.config.ts"
    ) {
      throw new Error(`Unreviewed Next configuration entrypoint ${path}`)
    }
    const pageMatch = path.match(
      /^apps\/web\/(?:src\/)?app\/(.*\/)?page\.(?:js|jsx|ts|tsx)$/,
    )
    if (pageMatch) {
      const routePath = nextRoutePath(pageMatch[1] ?? "")
      routes.push({
        surface: "web-page",
        method: "PAGE",
        path: routePath,
        source: path,
        classification: classifyWebRoute(routePath),
      })
      continue
    }

    const metadataRoute = nextMetadataRoute(path)
    if (metadataRoute) {
      routes.push({
        surface: "web-metadata",
        method: "METADATA",
        path: metadataRoute,
        source: path,
        classification: "current-console-seam",
      })
      continue
    }

    const handlerMatch = path.match(
      /^apps\/web\/(?:src\/)?app\/(.*\/)?route\.(?:js|jsx|ts|tsx)$/,
    )
    if (!handlerMatch) {
      continue
    }
    const routePath = nextRoutePath(handlerMatch[1] ?? "")
    const source = readFileSync(resolve(root, path), "utf8")
    const methods = extractNextHandlerMethods(source)
    if (methods.length === 0) {
      throw new Error(`No exported HTTP method found in ${path}`)
    }
    for (const method of methods) {
      routes.push({
        surface: "web-handler",
        method,
        path: routePath,
        source: path,
        classification: classifyWebRoute(routePath),
      })
    }
  }
  return routes
}

function nextMetadataRoute(path) {
  const match = path.match(
    /^apps\/web\/(?:src\/)?app\/(.*\/)?((?:favicon|icon\d*|apple-icon\d*|opengraph-image\d*|twitter-image\d*)\.(?:gif|ico|jpe?g|js|jsx|png|svg|ts|tsx)|robots\.(?:txt|js|ts)|sitemap\.(?:xml|js|ts)|manifest\.(?:json|webmanifest|js|ts))$/,
  )
  if (!match) {
    return null
  }
  const directory = nextRoutePath(match[1] ?? "")
  const filename = match[2]
    .replace(
      /^((?:favicon|icon\d*|apple-icon\d*|opengraph-image\d*|twitter-image\d*))\.(?:js|jsx|ts|tsx)$/,
      "$1",
    )
    .replace(/^robots\.(?:js|ts)$/, "robots.txt")
    .replace(/^sitemap\.(?:js|ts)$/, "sitemap.xml")
    .replace(/^manifest\.(?:js|ts|json)$/, "manifest.webmanifest")
  return directory === "/" ? `/${filename}` : `${directory}/${filename}`
}

function assertNoNextRewriteRegistration(root, path) {
  const source = readFileSync(resolve(root, path), "utf8")
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindForPath(path),
  )
  if (sourceFile.parseDiagnostics.length > 0) {
    throw routeAnalysisError(
      path,
      sourceFile,
      sourceFile.parseDiagnostics[0]?.start ?? 0,
      "TypeScript syntax error",
    )
  }
  const visit = (node) => {
    const member = staticMemberCall(node)
    if (
      (ts.isIdentifier(node) && node.text === "rewrite") ||
      member?.name === "rewrite"
    ) {
      throw routeAnalysisError(
        path,
        sourceFile,
        node,
        "Next middleware rewrite registration is not allowed",
      )
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
}

function assertReviewedNextMiddleware(root, path) {
  const source = readFileSync(resolve(root, path), "utf8")
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindForPath(path),
  )
  const reviewedImports = new Set()
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !statement.importClause?.namedBindings ||
      !ts.isNamedImports(statement.importClause.namedBindings)
    ) {
      continue
    }
    for (const specifier of statement.importClause.namedBindings.elements) {
      const imported = specifier.propertyName?.text ?? specifier.name.text
      reviewedImports.add(
        `${statement.moduleSpecifier.text}\0${imported}\0${specifier.name.text}`,
      )
    }
  }
  for (const requiredImport of [
    "next/server\0NextResponse\0NextResponse",
    "@/lib/auth/auth\0auth\0auth",
  ]) {
    if (!reviewedImports.has(requiredImport)) {
      throw new Error(`Missing reviewed Next middleware import in ${path}`)
    }
  }
  const allowedReturnCall = (expression) => {
    const call = unwrapExpression(expression)
    if (!call || !ts.isCallExpression(call)) {
      return false
    }
    const callee = unwrapExpression(call.expression)
    if (
      ts.isIdentifier(callee) &&
      callee.text === "requireAuthenticatedSession" &&
      call.arguments.length === 2
    ) {
      return true
    }
    const member = staticMemberCall(callee)
    if (
      !member ||
      !ts.isIdentifier(unwrapExpression(member.receiver)) ||
      unwrapExpression(member.receiver).text !== "NextResponse"
    ) {
      return false
    }
    if (member.name === "next") {
      return call.arguments.length === 0
    }
    if (member.name !== "redirect" || call.arguments.length !== 1) {
      return false
    }
    const redirect = unwrapExpression(call.arguments[0])
    return Boolean(
      redirect &&
        ts.isCallExpression(redirect) &&
        ts.isIdentifier(unwrapExpression(redirect.expression)) &&
        unwrapExpression(redirect.expression).text === "getSignInRedirectUrl",
    )
  }
  let authFactoryDeclarations = 0
  let sessionWrapperDeclarations = 0
  const visit = (node) => {
    if (
      ts.isIdentifier(node) &&
      ["NextResponse", "auth"].includes(node.text) &&
      isShadowingBindingIdentifier(node)
    ) {
      throw routeAnalysisError(
        path,
        sourceFile,
        node,
        `Next middleware binding ${node.text} may not be shadowed`,
      )
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "createAuthMiddleware"
    ) {
      authFactoryDeclarations += 1
      const initializer = unwrapExpression(node.initializer)
      if (
        !isConstVariableDeclaration(node) ||
        !initializer ||
        !ts.isIdentifier(initializer) ||
        initializer.text !== "auth"
      ) {
        throw routeAnalysisError(
          path,
          sourceFile,
          node,
          "Next middleware auth factory changed",
        )
      }
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "requireAuthenticatedSession"
    ) {
      sessionWrapperDeclarations += 1
      const initializer = unwrapExpression(node.initializer)
      const callback =
        initializer && ts.isCallExpression(initializer)
          ? initializer.arguments[0]
          : undefined
      if (
        !isConstVariableDeclaration(node) ||
        !initializer ||
        !ts.isCallExpression(initializer) ||
        !ts.isIdentifier(unwrapExpression(initializer.expression)) ||
        unwrapExpression(initializer.expression).text !==
          "createAuthMiddleware" ||
        initializer.arguments.length !== 1 ||
        !callback ||
        !(ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))
      ) {
        throw routeAnalysisError(
          path,
          sourceFile,
          node,
          "Next middleware authenticated-session wrapper changed",
        )
      }
    }
    if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(unwrapExpression(node.expression)) &&
      ["NextResponse", "Response"].includes(
        unwrapExpression(node.expression).text,
      )
    ) {
      throw routeAnalysisError(
        path,
        sourceFile,
        node,
        "Next middleware may not construct response bodies",
      )
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(unwrapExpression(node.expression)) &&
      unwrapExpression(node.expression).text === "fetch"
    ) {
      throw routeAnalysisError(
        path,
        sourceFile,
        node,
        "Next middleware may not fetch response bodies",
      )
    }
    if (
      ts.isReturnStatement(node) &&
      node.expression &&
      !allowedReturnCall(node.expression)
    ) {
      throw routeAnalysisError(
        path,
        sourceFile,
        node,
        "Unreviewed Next middleware return form",
      )
    }
    if (
      ts.isArrowFunction(node) &&
      !ts.isBlock(node.body) &&
      !allowedReturnCall(node.body)
    ) {
      throw routeAnalysisError(
        path,
        sourceFile,
        node,
        "Unreviewed Next middleware expression return",
      )
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  if (authFactoryDeclarations !== 1 || sessionWrapperDeclarations !== 1) {
    throw new Error(`Next middleware wrapper declarations changed in ${path}`)
  }
}

function isConstVariableDeclaration(node) {
  return Boolean(
    ts.isVariableDeclarationList(node.parent) &&
      (node.parent.flags & ts.NodeFlags.Const) !== 0,
  )
}

function isShadowingBindingIdentifier(node) {
  const parent = node.parent
  return Boolean(
    (ts.isParameter(parent) ||
      ts.isVariableDeclaration(parent) ||
      ts.isFunctionDeclaration(parent) ||
      ts.isFunctionExpression(parent) ||
      ts.isClassDeclaration(parent) ||
      ts.isClassExpression(parent) ||
      ts.isBindingElement(parent)) &&
      parent.name === node,
  )
}

function extractNextHandlerMethods(source) {
  const methods = new Set()
  for (const match of source.matchAll(
    /export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b/g,
  )) {
    methods.add(match[1])
  }
  for (const match of source.matchAll(
    /export\s+(?:const|let|var)\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b/g,
  )) {
    methods.add(match[1])
  }
  for (const match of source.matchAll(
    /\bas\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b/g,
  )) {
    methods.add(match[1])
  }
  for (const match of source.matchAll(/export\s+const\s*\{([^}]+)\}\s*=/g)) {
    for (const candidate of match[1].split(",")) {
      const method = candidate.trim()
      if (/^(?:GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)$/.test(method)) {
        methods.add(method)
      }
    }
  }
  return [...methods].sort()
}

function buildResolverFingerprints(root) {
  return resolverFingerprintSpecs
    .map(({ path, symbol }) => {
      const source = readFileSync(resolve(root, path), "utf8").replaceAll(
        "\r\n",
        "\n",
      )
      const subject =
        symbol === "<file>"
          ? source.trim()
          : extractFunctionBlock(source, symbol)
      return {
        path,
        symbol,
        sha256: sha256(subject),
      }
    })
    .sort((left, right) =>
      `${left.path}\0${left.symbol}`.localeCompare(
        `${right.path}\0${right.symbol}`,
      ),
    )
}

function buildLegacyEscapeHatches(root, paths) {
  const candidates = new Set(paths)
  return legacyEscapeHatchSpecs
    .filter(
      ({ path }) => candidates.has(path) && isRegularFile(resolve(root, path)),
    )
    .map(({ path, removeBy }) => ({
      path,
      sha256: sha256(readFileSync(resolve(root, path))),
      removeBy,
    }))
    .sort((left, right) => left.path.localeCompare(right.path))
}

function extractFunctionBlock(source, symbol) {
  const marker = `function ${symbol}`
  const start = source.indexOf(marker)
  if (start < 0) {
    throw new Error(`Missing route resolver ${symbol}`)
  }
  const next = source.indexOf("\nfunction ", start + marker.length)
  return source.slice(start, next < 0 ? source.length : next).trim()
}

function classifyBffRoute(source, path) {
  if (
    source === "apps/bff/src/index.ts" &&
    ["/livez", "/healthz", "/readyz"].includes(path)
  ) {
    return "private-operational"
  }
  if (
    source === "apps/bff/src/routes/app-gateway.ts" &&
    [
      "/api/app-gateway/v1/models",
      "/api/app-gateway/v1/chat/completions",
    ].includes(path)
  ) {
    return "required-now"
  }
  if (source === "apps/bff/src/routes/admin.ts") {
    if (
      /^\/api\/admin\/(?:approvals|agents\/registry|connectors\/registry|librechat\/|internal-docs\/mcp\/|mcp-servers(?:\/|$)|builder(?:\/|$)|resources(?:\/|$)|settings\/url-policy(?:\/|$)|team\/break-glass$)/.test(
        path,
      ) ||
      path.includes("/promote-production") ||
      path.includes("/vetting")
    ) {
      return "legacy-retired"
    }
    if (
      path.startsWith("/api/admin/policies/violations") ||
      path.startsWith("/api/admin/sandbox/pure-mode")
    ) {
      return "rewrite-required"
    }
    return "current-console-seam"
  }
  return "legacy-retired"
}

function classifyWebRoute(path) {
  if (
    path.startsWith("/api/auth/") ||
    path === "/auth/keycloak" ||
    path === "/auth/signin"
  ) {
    return "operational-auth"
  }
  if (
    path === "/" ||
    path.startsWith("/applications") ||
    path.startsWith("/hardware") ||
    path.startsWith("/inference") ||
    path.startsWith("/settings") ||
    path.startsWith("/team")
  ) {
    return "current-console-seam"
  }
  return "legacy-retired"
}

export function verifyLegacyRouteShrink(base, current) {
  const errors = []
  const baseByKey = new Map(
    base.routes.map((route) => [routeKey(route), route]),
  )
  const baseCounts = routeCounts(base.routes)
  const currentCounts = routeCounts(current.routes)

  for (const route of current.routes) {
    const baseRoute = baseByKey.get(routeKey(route))
    if (!baseRoute) {
      errors.push(
        `new route requires a reviewed contract revision ${route.method} ${route.path} ${route.source}`,
      )
    } else if (baseRoute.classification !== route.classification) {
      errors.push(
        `route reclassified ${route.method} ${route.path} ${route.source}`,
      )
    }
  }
  for (const [key, count] of currentCounts) {
    if (count > (baseCounts.get(key) ?? 0)) {
      const route = current.routes.find(
        (candidate) => routeKey(candidate) === key,
      )
      if (route && baseByKey.has(key)) {
        errors.push(
          `route multiplicity increased ${route.method} ${route.path} ${route.source}`,
        )
      }
    }
  }

  errors.push(...verifyPolicyStability(base, current, "route"))
  errors.push(...verifyRequiredRoutes(current))
  if (JSON.stringify(base.target) !== JSON.stringify(current.target)) {
    errors.push("route target contract changed")
  }
  if (
    JSON.stringify(base.fingerprints) !== JSON.stringify(current.fingerprints)
  ) {
    errors.push("route resolver fingerprints changed")
  }
  errors.push(
    ...verifyLegacyEscapeHatchShrink(
      base.escapeHatches ?? [],
      current.escapeHatches ?? [],
    ),
  )
  errors.push(
    ...verifyExactEntryShrink(
      base.fastifyRegistrars ?? [],
      current.fastifyRegistrars ?? [],
      (entry) => entry.exportName,
      "Fastify registrar changed",
    ),
  )
  errors.push(
    ...verifyExactEntryShrink(
      base.webInferenceConsumers ?? [],
      current.webInferenceConsumers ?? [],
      (entry) => entry.path,
      "Web inference consumer changed",
    ),
  )
  errors.push(
    ...verifyExactEntryShrink(
      base.sourceClosure ?? [],
      current.sourceClosure ?? [],
      (entry) => entry.path,
      "production source closure changed",
    ),
  )
  errors.push(...verifyRequiredWebAuthBoundary(base, current))

  return errors.sort()
}

function routeCounts(routes) {
  const counts = new Map()
  for (const route of routes) {
    const key = routeKey(route)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

function verifyLegacyEscapeHatchShrink(base, current) {
  return verifyExactEntryShrink(
    base,
    current,
    (entry) => entry.path,
    "legacy route escape hatch changed",
  )
}

function verifyRequiredWebAuthBoundary(base, current) {
  const middlewarePath = "apps/web/src/middleware.ts"
  const baseBoundary = (base.sourceClosure ?? []).find(
    (entry) => entry.path === middlewarePath,
  )
  if (!baseBoundary) {
    return []
  }
  const currentBoundary = (current.sourceClosure ?? []).find(
    (entry) => entry.path === middlewarePath,
  )
  return JSON.stringify(currentBoundary) === JSON.stringify(baseBoundary)
    ? []
    : [
        `reviewed Web authentication boundary changed or disappeared ${middlewarePath}`,
      ]
}

function verifyExactEntryShrink(base, current, keyFor, errorPrefix) {
  const baseByKey = new Map(base.map((entry) => [keyFor(entry), entry]))
  const errors = []
  for (const entry of current) {
    const key = keyFor(entry)
    if (JSON.stringify(baseByKey.get(key)) !== JSON.stringify(entry)) {
      errors.push(`${errorPrefix} ${key}`)
    }
  }
  return errors.sort()
}

function verifyRouteBaselineMetadata(baseline) {
  const expectedKeys = [
    "baseCommit",
    "escapeHatches",
    "fastifyRegistrars",
    "fingerprints",
    "policyDigest",
    "routes",
    "schemaVersion",
    "sourceClosure",
    "target",
    "webInferenceConsumers",
  ]
  return JSON.stringify(Object.keys(baseline).sort()) ===
    JSON.stringify(expectedKeys) &&
    baseline.schemaVersion === 1 &&
    baseline.baseCommit === pr01BootstrapBase
    ? []
    : ["route baseline metadata changed"]
}

function verifyRequiredRoutes(baseline) {
  const errors = []
  const requiredSets = [
    {
      routes: baseline.target?.requiredPublicInference ?? [],
      classification: "required-now",
    },
    {
      routes: baseline.target?.requiredPrivateOperational ?? [],
      classification: "private-operational",
    },
  ]
  for (const requiredSet of requiredSets) {
    for (const required of requiredSet.routes) {
      const matches = baseline.routes.filter(
        (route) =>
          route.surface === "bff" &&
          route.method === required.method &&
          route.path === required.path &&
          route.classification === requiredSet.classification,
      )
      if (matches.length !== 1) {
        errors.push(
          `required route missing or ambiguous ${required.method} ${required.path}`,
        )
      }
    }
  }
  return errors
}

export function verifyPolicyStability(base, current, subject) {
  return base.policyDigest === current.policyDigest
    ? []
    : [`${subject} policy changed; reviewed contract revision required`]
}

export function verifyProtectedGuardrailStability(base, current) {
  return JSON.stringify(base.protectedFiles) ===
    JSON.stringify(current.protectedFiles)
    ? []
    : ["protected guardrail files changed; reviewed contract revision required"]
}

function buildProtectedGuardrailFingerprints(root) {
  return protectedGuardrailPaths.map((path) => {
    const absolutePath = resolve(root, path)
    if (!isRegularFile(absolutePath)) {
      throw new Error(`Missing protected guardrail file ${path}`)
    }
    return { path, sha256: sha256(readFileSync(absolutePath)) }
  })
}

function forbiddenPolicyDigest() {
  return sha256(
    JSON.stringify({
      revision: "PR01_FORBIDDEN_SURFACE_POLICY_V1",
      exclusions: [...guardrailExclusions].sort(),
      binaryPathPattern: {
        pattern: binaryPathPattern.source,
        flags: binaryPathPattern.flags,
      },
      protectedGuardrailPaths,
      pathRules: pathRules.map((rule) => ({
        id: rule.id,
        pattern: rule.pattern.source,
        flags: rule.pattern.flags,
        removeBy: rule.removeBy,
      })),
      contentRules,
      implementation: [
        scanForbiddenSurfaces,
        matchFingerprints,
        isContentScanPath,
        isGuardrailPath,
        verifyCorePackageClosure,
        assertNoUnexpectedEnvironmentFiles,
      ].map(normalizedFunctionSource),
    }),
  )
}

function routePolicyDigest() {
  return sha256(
    JSON.stringify({
      revision: "PR01_ROUTE_POLICY_V1",
      methods: routeMethods,
      unsupportedFastifyMethods: [...unsupportedFastifyMethods].sort(),
      controlledFastifyMethods: [...controlledFastifyMethods].sort(),
      receiverNamePattern: routeReceiverNamePattern.source,
      bffProductionSourcePattern: bffProductionSourcePattern.source,
      productionSurfaceTestPathPattern: productionSurfaceTestPathPattern.source,
      reviewedFastifyRegistrarSpecs,
      reviewedFastifySourcePaths: [...reviewedFastifySourcePaths].sort(),
      webInferenceEndpointPattern: webInferenceEndpointPattern.source,
      target: targetRouteContract,
      resolverFingerprintSpecs,
      legacyEscapeHatchSpecs,
      implementation: [
        extractBffRoutes,
        assertNoDynamicCodeLoading,
        assertReviewedFastifyImports,
        assertReviewedFastifyFactoryUse,
        isReviewedFastifyFactoryOptions,
        assertReviewedBuildServerDefinition,
        assertReviewedFastifyRegistrarDefinition,
        collectNamedImportBindings,
        extractFastifyRegistrarManifest,
        collectFastifyReceiverNames,
        collectRouteHostTypeNames,
        containsRouteHostMember,
        isCallableRouteHostMember,
        isRouteHostType,
        assertNoRouteMethodAliases,
        isReviewedFastifyReceiverUse,
        isExpressionWrapper,
        containsKnownFastifyReceiver,
        isValueIdentifier,
        isReviewedFastifyRegistrarCall,
        isDirectBuildServerStatement,
        isReviewedFastifyAlias,
        isReviewedBuildServerReturn,
        isReviewedFastifyListenCall,
        isIndirectRouteMethodInvocation,
        parseRouteCall,
        parseShorthandRoute,
        assertReviewedShorthandRouteOptions,
        parseRouteOptions,
        assertReviewedFastifyControlCall,
        assertNoFastifyRouteConstraints,
        staticHttpMethods,
        staticString,
        isTrackedFastifyReceiver,
        extractWebInferenceConsumers,
        buildProductionSourceClosure,
        isProductionSurfacePath,
        collectStaticStringConstants,
        staticStringWithConstants,
        expressionIncludesWebInferenceEndpoint,
        extractWebRoutes,
        nextMetadataRoute,
        assertNoNextRewriteRegistration,
        assertReviewedNextMiddleware,
        isConstVariableDeclaration,
        isShadowingBindingIdentifier,
        extractNextHandlerMethods,
        classifyBffRoute,
        classifyWebRoute,
        buildLegacyEscapeHatches,
        verifyLegacyEscapeHatchShrink,
        verifyRequiredWebAuthBoundary,
        verifyExactEntryShrink,
        routeCounts,
      ].map(normalizedFunctionSource),
    }),
  )
}

function normalizedFunctionSource(subject) {
  return subject.toString().replaceAll("\r\n", "\n")
}

function matchFingerprints(rule, source) {
  const fingerprintCounts = new Map()
  for (const rawLine of source.replaceAll("\r\n", "\n").split("\n")) {
    const line = rawLine.trim().replace(/\s+/g, " ")
    const expression = new RegExp(rule.pattern, rule.flags)
    for (const match of line.matchAll(expression)) {
      const fingerprint = sha256(
        `${rule.id}\0${line}\0${String(match[0]).toLocaleLowerCase("en-US")}`,
      )
      fingerprintCounts.set(
        fingerprint,
        (fingerprintCounts.get(fingerprint) ?? 0) + 1,
      )
    }
  }
  return Object.fromEntries(
    [...fingerprintCounts].sort(([left], [right]) => left.localeCompare(right)),
  )
}

function isContentScanPath(path) {
  if (isGuardrailPath(path)) {
    return false
  }
  return true
}

function isGuardrailPath(path) {
  return guardrailExclusions.has(path)
}

function nextRoutePath(prefix) {
  const trimmed = prefix.replace(/\/$/, "")
  return trimmed ? `/${trimmed}` : "/"
}

function isRegularFile(path) {
  return existsSync(path) && statSync(path).isFile()
}

function currentHead(root) {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim()
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"))
}

function readJsonFromCommit(root, commit, path) {
  if (!/^[0-9a-f]{40,64}$/.test(commit)) {
    return null
  }
  try {
    return JSON.parse(
      execFileSync(
        "git",
        [
          "show",
          "--no-ext-diff",
          "--no-textconv",
          "--end-of-options",
          `${commit}:${path}`,
        ],
        {
          cwd: root,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        },
      ),
    )
  } catch {
    return null
  }
}

function resolveCommit(root, ref) {
  if (typeof ref !== "string" || ref.length === 0) {
    return null
  }
  try {
    const commit = execFileSync(
      "git",
      ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`],
      {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    ).trim()
    return /^[0-9a-f]{40,64}$/.test(commit) ? commit : null
  } catch {
    return null
  }
}

function isFingerprintSubset(subject, superset) {
  for (const [fingerprint, count] of Object.entries(subject)) {
    if ((superset[fingerprint] ?? 0) < count) {
      return false
    }
  }
  return true
}

function findingKey(entry) {
  return `${entry.ruleId}\0${entry.path}`
}

function routeKey(route) {
  return `${route.surface}\0${route.method}\0${route.path}\0${route.source}`
}

function compareFindingKeys(left, right) {
  return findingKey(left).localeCompare(findingKey(right))
}

function compareRoutes(left, right) {
  return routeKey(left).localeCompare(routeKey(right))
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

function assertNoUnexpectedEnvironmentFiles(root) {
  const excludedDirectories = new Set([
    ".git",
    ".next",
    ".pnpm-store",
    ".turbo",
    ".venv",
    "coverage",
    "dist",
    "node_modules",
    "playwright-report",
    "test-results",
  ])
  const unexpected = []
  const pending = [root]
  while (pending.length > 0) {
    const directory = pending.pop()
    if (!directory) {
      continue
    }
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = join(directory, entry.name)
      if (entry.isSymbolicLink()) {
        unexpected.push(relative(root, absolutePath))
        continue
      }
      if (entry.isDirectory()) {
        if (!excludedDirectories.has(entry.name)) {
          pending.push(absolutePath)
        }
        continue
      }
      if (entry.name.startsWith(".env") && entry.name !== ".env.example") {
        unexpected.push(relative(root, absolutePath))
      }
    }
  }
  unexpected.sort()
  if (unexpected.length > 0) {
    throw new Error(
      `Unexpected environment file blocks the sanitized Core lane: ${unexpected.join(", ")}`,
    )
  }
}

export { assertNoUnexpectedEnvironmentFiles }

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : ""
if (invokedPath === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  assertNoUnexpectedEnvironmentFiles(repositoryRoot)
  if (args.includes("--print-forbidden-allowlist")) {
    printJson(buildForbiddenAllowlist())
  } else if (args.includes("--print-route-baseline")) {
    printJson(buildRouteBaseline())
  } else {
    const baseIndex = args.indexOf("--base-ref")
    const baseRef = baseIndex >= 0 ? args[baseIndex + 1] : undefined
    if (baseIndex >= 0 && !baseRef) {
      throw new Error("--base-ref requires a ref")
    }
    const result = verifyRepository({ baseRef })
    if (!result.ok) {
      for (const error of result.errors) {
        process.stderr.write(`inference-core guardrail: ${error}\n`)
      }
      process.exitCode = 1
    } else {
      process.stdout.write(
        `INFERENCE_CORE_GUARDRAILS=PASS findings=${result.findingCount} entries=${result.findingPathCount} routes=${result.routeCount} legacy_routes=${result.legacyRouteCount} base=${result.baseStatus}\n`,
      )
    }
  }
}
