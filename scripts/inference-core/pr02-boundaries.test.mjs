import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { dirname, extname, resolve } from "node:path"
import { test } from "node:test"
import ts from "typescript"
import { readPr09SourceBoundaryText, repositoryRoot } from "./guardrails.mjs"

const retainedBffEntries = [
  "apps/bff/src/index.ts",
  "apps/bff/src/routes/admin.ts",
  "apps/bff/src/routes/app-gateway.ts",
]

const forbiddenBffImports = [
  "/routes/agentic-runtime",
  "/routes/builder",
  "/routes/hub",
  "/routes/knowledge",
  "/routes/mcp-gateway",
  "/routes/openai-compatible",
  "/services/admin-approvals",
  "/services/admin-connector-registry",
  "/services/admin-governance-detail",
  "/services/builder",
  "/services/hub",
  "/services/internal-docs-mcp-posture",
  "/services/knowledge/",
  "/services/librechat-native-agents",
]

const requiredCoordinationDecisions = [
  "product-postgresql",
  "redis",
  "temporal",
  "minio",
  "pgvector",
  "queues",
  "workers",
  "scheduling",
  "idempotency",
  "rate-limiting",
  "usage-accounting",
]

const requiredExpertSystems = ["alertmanager", "grafana", "keycloak", "litellm"]
const approvedDecisionDigest =
  "fc9d1d9f7ec83a4f6ed0f29af18590cd5c9dbde5f2e5585cf05704fe5d63f687"

test("retained BFF entrypoints have no direct retired imports", () => {
  for (const path of retainedBffEntries) {
    const imports = staticImports(path)
    for (const specifier of imports) {
      const normalized = normalizeImport(path, specifier)
      assert.ok(
        !forbiddenBffImports.some((fragment) => normalized.includes(fragment)),
        `${path} imports retired module ${specifier}`,
      )
    }
  }
})

test("retained Admin and Web seams use the isolated Contracts subpath", () => {
  const paths = [
    "apps/bff/src/routes/admin.ts",
    "apps/bff/src/services/admin-settings-core.ts",
    "apps/bff/src/services/admin-team.ts",
    "apps/web/src/lib/admin/server-data-core.ts",
    "apps/web/src/lib/admin/actions-core.ts",
  ]
  for (const path of paths) {
    const imports = staticImports(path)
    assert.ok(
      !imports.includes("@llm-machines/contracts"),
      `${path} imports the mixed Contracts root`,
    )
  }
})

test("shared dependency and expert-system decisions are complete", () => {
  const source = readFileSync(
    resolve(
      repositoryRoot,
      "docs/reduction/inference-core/pr-02-boundary-decisions.json",
    ),
    "utf8",
  )
  const register = JSON.parse(source)
  assert.equal(
    createHash("sha256").update(JSON.stringify(register)).digest("hex"),
    approvedDecisionDigest,
  )
  assert.equal(register.schemaVersion, 1)
  assert.equal(register.workPackage, "PR-02")
  assert.deepEqual(
    register.coordination.map(({ id }) => id).sort(),
    [...requiredCoordinationDecisions].sort(),
  )
  assert.deepEqual(
    register.expertSystems.map(({ id }) => id).sort(),
    [...requiredExpertSystems].sort(),
  )
  for (const system of register.expertSystems) {
    assert.equal(system.consoleProjection, "read-only")
    assert.equal(system.nativeMutationAccess, "disabled")
    assert.equal(system.nativeAuditIngestion, "not-proven")
    assert.deepEqual(system.enableAfterAll, ["PR-05", "PR-09"])
    assert.equal("enableAfter" in system, false)
  }
})

test("native expert access remains fail-closed in the PR-09 successor seam", () => {
  const source = readPr09SourceBoundaryText(
    "apps/bff/src/services/expert-capabilities.ts",
  )
  assert.notEqual(source, null)
  assert.doesNotMatch(source, /directAccess:\s*"enabled"/)
  assert.doesNotMatch(source, /nativeMutation:\s*"enabled"/)
  assert.match(
    source,
    /auditIngestion:\s*"implemented_pending_runtime_qualification"/,
  )
})

function staticImports(path) {
  const absolutePath = resolve(repositoryRoot, path)
  const source = readFileSync(absolutePath, "utf8")
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(path),
  )
  return sourceFile.statements
    .filter(ts.isImportDeclaration)
    .map((statement) =>
      ts.isStringLiteral(statement.moduleSpecifier)
        ? statement.moduleSpecifier.text
        : "",
    )
    .filter(Boolean)
}

function normalizeImport(sourcePath, specifier) {
  if (!specifier.startsWith(".")) {
    return specifier
  }
  return resolve(dirname(`/${sourcePath}`), specifier)
}

function scriptKind(path) {
  switch (extname(path)) {
    case ".tsx":
      return ts.ScriptKind.TSX
    case ".jsx":
      return ts.ScriptKind.JSX
    case ".js":
    case ".mjs":
    case ".cjs":
      return ts.ScriptKind.JS
    default:
      return ts.ScriptKind.TS
  }
}
