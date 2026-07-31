import assert from "node:assert/strict"
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { after, test } from "node:test"
import {
  assertNoUnexpectedEnvironmentFiles,
  compareExactFindings,
  compareForbiddenBaselineMetadata,
  extractBffRoutes,
  extractFastifyRegistrarManifest,
  extractWebInferenceConsumers,
  extractWebRoutes,
  repositoryRoot,
  scanForbiddenSurfaces,
  verifyCorePackageClosure,
  verifyLegacyRouteShrink,
  verifyPolicyStability,
  verifyProtectedGuardrailStability,
  verifyRepository,
  verifyRetentionCharacterization,
  verifyShrinkOnly,
} from "./guardrails.mjs"

const temporaryRoots = []

after(() => {
  for (const root of temporaryRoots) {
    rmSync(root, { recursive: true, force: true })
  }
})

test("forbidden findings are exact path and fingerprint multisets", () => {
  const root = temporaryRoot()
  const path = "apps/bff/src/routes/example.ts"
  writeFixture(
    root,
    path,
    'const first = "agentic"\nconst second = "agentic"\n',
  )
  const accepted = scanForbiddenSurfaces({ root, paths: [path] })

  assert.equal(accepted.length, 1)
  assert.equal(accepted[0].ruleId, "FS101_AGENTIC_RUNTIME")
  assert.equal(accepted[0].count, 2)
  assert.equal(Object.keys(accepted[0].fingerprints).length, 2)
  assert.deepEqual(compareExactFindings(accepted, accepted), [])

  writeFixture(
    root,
    path,
    'const first = "agentic"\nconst second = "agentic"\nconst third = "hermes"\n',
  )
  const expanded = scanForbiddenSurfaces({ root, paths: [path] })
  assert.match(compareExactFindings(accepted, expanded)[0], /changed finding/)
})

test("a stale allowlist entry fails until the allowlist shrinks", () => {
  const root = temporaryRoot()
  const path = "apps/bff/src/routes/example.ts"
  writeFixture(root, path, 'const value = "mcp"\n')
  const accepted = scanForbiddenSurfaces({ root, paths: [path] })

  writeFixture(root, path, "const value = true\n")
  const reduced = scanForbiddenSurfaces({ root, paths: [path] })

  assert.deepEqual(compareExactFindings(accepted, reduced), [
    `stale allowlist entry FS102_MCP\0${path}`,
  ])
  assert.deepEqual(verifyShrinkOnly(accepted, reduced), [])
})

test("base comparison accepts only a multiset reduction", () => {
  const base = [
    {
      ruleId: "FS101_AGENTIC_RUNTIME",
      path: "example.ts",
      count: 2,
      fingerprints: { a: 1, b: 1 },
      removeBy: "PR-04",
    },
  ]
  const reduced = [
    {
      ...base[0],
      count: 1,
      fingerprints: { a: 1 },
    },
  ]
  const replaced = [
    {
      ...base[0],
      count: 1,
      fingerprints: { c: 1 },
    },
  ]

  assert.deepEqual(verifyShrinkOnly(base, reduced), [])
  assert.deepEqual(verifyShrinkOnly(base, replaced), [
    "legacy finding changed or grew FS101_AGENTIC_RUNTIME\u0000example.ts",
  ])
  assert.deepEqual(
    verifyShrinkOnly(base, [{ ...reduced[0], removeBy: "PR-12" }]),
    ["legacy disposition changed FS101_AGENTIC_RUNTIME\u0000example.ts"],
  )
})

test("guard policy changes require a reviewed contract revision", () => {
  assert.deepEqual(
    verifyPolicyStability(
      { policyDigest: "reviewed" },
      { policyDigest: "reviewed" },
      "route",
    ),
    [],
  )
  assert.deepEqual(
    verifyPolicyStability(
      { policyDigest: "reviewed" },
      { policyDigest: "changed" },
      "route",
    ),
    ["route policy changed; reviewed contract revision required"],
  )
  assert.deepEqual(
    verifyProtectedGuardrailStability(
      { protectedFiles: [{ path: "guard.mjs", sha256: "reviewed" }] },
      { protectedFiles: [{ path: "guard.mjs", sha256: "changed" }] },
    ),
    ["protected guardrail files changed; reviewed contract revision required"],
  )
})

test("baseline metadata rejects unknown fields and altered bootstrap identity", () => {
  const reviewed = {
    schemaVersion: 1,
    baseCommit: "0faf8a7da0a77ffb6bf45cb6c01dbc17c51f855a",
    policyDigest: "reviewed",
    protectedFiles: [],
    entries: [],
  }

  assert.deepEqual(compareForbiddenBaselineMetadata(reviewed, reviewed), [])
  assert.deepEqual(
    compareForbiddenBaselineMetadata(
      { ...reviewed, unreviewedClaim: true },
      reviewed,
    ),
    ["forbidden-surface baseline metadata changed"],
  )
  assert.deepEqual(
    compareForbiddenBaselineMetadata(
      { ...reviewed, baseCommit: "0".repeat(40) },
      reviewed,
    ),
    ["forbidden-surface baseline metadata changed"],
  )
})

test("self-describing exclusions are exact and text scanning is extension independent", () => {
  const root = temporaryRoot()
  const paths = [
    "scripts/inference-core/unreviewed.ts",
    "docs/reduction/inference-core/unreviewed.md",
    "tools/unreviewed.py",
    "tools/unreviewed.sh",
    "web/unreviewed.html",
  ]
  writeFixture(root, paths[0], 'export const mode = "agentic"\n')
  writeFixture(root, paths[1], "knowledge corpus\n")
  writeFixture(root, paths[2], 'mode = "mcp"\n')
  writeFixture(root, paths[3], 'mode="ragflow"\n')
  writeFixture(root, paths[4], "<p>librechat</p>\n")

  const findings = scanForbiddenSurfaces({ root, paths })
  assert.deepEqual(
    findings.map(({ ruleId, path }) => ({ ruleId, path })),
    [
      {
        ruleId: "FS101_AGENTIC_RUNTIME",
        path: "scripts/inference-core/unreviewed.ts",
      },
      { ruleId: "FS102_MCP", path: "tools/unreviewed.py" },
      {
        ruleId: "FS103_KNOWLEDGE_RAG",
        path: "docs/reduction/inference-core/unreviewed.md",
      },
      { ruleId: "FS103_KNOWLEDGE_RAG", path: "tools/unreviewed.sh" },
      { ruleId: "FS104_LIBRECHAT", path: "web/unreviewed.html" },
    ],
  )
})

test("content scanning rejects invalid source bytes and scans NUL-containing UTF-8", () => {
  const root = temporaryRoot()
  const nulPath = "apps/bff/src/routes/nul.ts"
  const invalidPath = "apps/bff/src/routes/invalid.ts"
  writeFixture(root, nulPath, '//\0\nexport const transport = "mcp"\n')
  writeFixture(
    root,
    invalidPath,
    Buffer.concat([
      Buffer.from("//"),
      Buffer.from([0xff]),
      Buffer.from('\nexport const transport = "mcp"\n'),
    ]),
  )

  assert.equal(
    scanForbiddenSurfaces({ root, paths: [nulPath] })[0]?.ruleId,
    "FS102_MCP",
  )
  assert.throws(
    () => scanForbiddenSurfaces({ root, paths: [invalidPath] }),
    /Invalid UTF-8/,
  )
})

test("legacy identifiers are matched without case-sensitive gaps", () => {
  const root = temporaryRoot()
  const path = "apps/bff/src/services/legacy.ts"
  writeFixture(
    root,
    path,
    [
      'const oldRole = "Consumer"',
      'const oldPolicy = "URL_POLICY"',
      'const oldRegistry = "CONNECTOR_REGISTRY"',
      'const oldStatus = "PENDING_VETTING"',
      'const ordinaryWords = "chubby rebuilder"',
      "",
    ].join("\n"),
  )

  assert.deepEqual(
    scanForbiddenSurfaces({ root, paths: [path] }).map(({ ruleId, count }) => ({
      ruleId,
      count,
    })),
    [
      { ruleId: "FS108_RETIRED_GOVERNANCE", count: 1 },
      { ruleId: "FS109_LEGACY_PERSONA", count: 1 },
      { ruleId: "FS111_CONNECTOR_GOVERNANCE", count: 2 },
    ],
  )
})

test("retired module paths cover every supported JavaScript and TypeScript extension", () => {
  const root = temporaryRoot()
  const paths = [
    "apps/bff/src/routes/knowledge.js",
    "packages/contracts/src/knowledge.mts",
  ]
  for (const path of paths) {
    writeFixture(root, path, "export const retained = false\n")
  }

  assert.deepEqual(
    scanForbiddenSurfaces({ root, paths }).map(({ ruleId, path }) => ({
      ruleId,
      path,
    })),
    [
      {
        ruleId: "FS001_RETIRED_BFF_MODULE",
        path: "apps/bff/src/routes/knowledge.js",
      },
      {
        ruleId: "FS003_RETIRED_CONTRACT_MODULE",
        path: "packages/contracts/src/knowledge.mts",
      },
    ],
  )
})

test("the workspace lockfile participates in legacy dependency shrinkage", () => {
  const root = temporaryRoot()
  const path = "pnpm-lock.yaml"
  writeFixture(
    root,
    path,
    "importers:\n  apps/agentic-adapter:\n    dependencies:\n      ioredis: 5.0.0\n",
  )

  assert.deepEqual(
    scanForbiddenSurfaces({ root, paths: [path] }).map(({ ruleId, count }) => ({
      ruleId,
      count,
    })),
    [
      { ruleId: "FS101_AGENTIC_RUNTIME", count: 1 },
      { ruleId: "FS107_RETIRED_DATA_DEPENDENCY", count: 1 },
    ],
  )
})

test("retired binary Knowledge fixtures are frozen by path and hash", () => {
  const root = temporaryRoot()
  const path = "test-fixtures/knowledge/example.pdf"
  writeFixture(root, path, Buffer.from([0, 1, 2, 3]))

  const findings = scanForbiddenSurfaces({ root, paths: [path] })
  assert.equal(findings.length, 1)
  assert.equal(findings[0].ruleId, "FS005_RETIRED_KNOWLEDGE_FIXTURE")
  assert.equal(findings[0].count, 1)
  assert.equal(Object.keys(findings[0].fingerprints).length, 1)
})

test("base route comparison rejects additions and reclassification", () => {
  const legacyRoute = {
    surface: "bff",
    method: "POST",
    path: "/v1/chat/completions",
    source: "apps/bff/src/routes/openai-compatible.ts",
    classification: "legacy-retired",
  }
  const base = { routes: [legacyRoute] }

  assert.deepEqual(verifyLegacyRouteShrink(base, { routes: [] }), [])
  assert.deepEqual(
    verifyLegacyRouteShrink(base, {
      routes: [legacyRoute, legacyRoute],
    }),
    [
      "route multiplicity increased POST /v1/chat/completions apps/bff/src/routes/openai-compatible.ts",
    ],
  )
  const escapeHatch = {
    path: "apps/bff/src/auth/persona.ts",
    sha256: "a".repeat(64),
    removeBy: "PR-05",
  }
  assert.deepEqual(
    verifyLegacyRouteShrink(
      { routes: [], escapeHatches: [escapeHatch] },
      { routes: [], escapeHatches: [] },
    ),
    [],
  )
  assert.deepEqual(
    verifyLegacyRouteShrink(
      { routes: [], escapeHatches: [escapeHatch] },
      {
        routes: [],
        escapeHatches: [
          {
            ...escapeHatch,
            sha256: "b".repeat(64),
          },
        ],
      },
    ),
    ["legacy route escape hatch changed apps/bff/src/auth/persona.ts"],
  )
  const middlewareEscapeHatch = {
    path: "apps/web/src/middleware.ts",
    sha256: "a".repeat(64),
    removeBy: "PR-03",
  }
  const middlewareBoundary = {
    path: middlewareEscapeHatch.path,
    sha256: middlewareEscapeHatch.sha256,
  }
  assert.deepEqual(
    verifyLegacyRouteShrink(
      {
        routes: [],
        escapeHatches: [middlewareEscapeHatch],
        sourceClosure: [middlewareBoundary],
      },
      {
        routes: [],
        escapeHatches: [
          {
            ...middlewareEscapeHatch,
            sha256: "b".repeat(64),
          },
        ],
        sourceClosure: [middlewareBoundary],
      },
    ),
    ["legacy route escape hatch changed apps/web/src/middleware.ts"],
  )
  assert.deepEqual(
    verifyLegacyRouteShrink(
      {
        routes: [],
        escapeHatches: [middlewareEscapeHatch],
        sourceClosure: [middlewareBoundary],
      },
      { routes: [], escapeHatches: [] },
    ),
    [
      "reviewed Web authentication boundary changed or disappeared apps/web/src/middleware.ts",
    ],
  )
  const retainedSource = {
    path: "apps/web/postcss.config.mjs",
    sha256: "c".repeat(64),
  }
  assert.deepEqual(
    verifyLegacyRouteShrink(
      { routes: [], sourceClosure: [retainedSource] },
      {
        routes: [],
        sourceClosure: [
          { ...retainedSource, sha256: "d".repeat(64) },
          {
            path: "apps/web/babel.config.cjs",
            sha256: "e".repeat(64),
          },
        ],
      },
    ),
    [
      "production source closure changed apps/web/babel.config.cjs",
      "production source closure changed apps/web/postcss.config.mjs",
    ],
  )
  assert.deepEqual(
    verifyLegacyRouteShrink(
      { routes: [], sourceClosure: [retainedSource] },
      { routes: [], sourceClosure: [] },
    ),
    [],
  )
  assert.deepEqual(
    verifyLegacyRouteShrink(base, {
      routes: [{ ...legacyRoute, classification: "required-now" }],
    }),
    [
      "route reclassified POST /v1/chat/completions apps/bff/src/routes/openai-compatible.ts",
    ],
  )
  assert.deepEqual(
    verifyLegacyRouteShrink({ routes: [] }, { routes: [legacyRoute] }),
    [
      "new route requires a reviewed contract revision POST /v1/chat/completions apps/bff/src/routes/openai-compatible.ts",
    ],
  )
  assert.deepEqual(
    verifyLegacyRouteShrink(
      { routes: [] },
      {
        routes: [
          {
            ...legacyRoute,
            path: "/api/admin/chat",
            source: "apps/bff/src/routes/admin.ts",
            classification: "current-console-seam",
          },
        ],
      },
    ),
    [
      "new route requires a reviewed contract revision POST /api/admin/chat apps/bff/src/routes/admin.ts",
    ],
  )
  assert.deepEqual(
    verifyLegacyRouteShrink(
      {
        target: {
          requiredPublicInference: [
            {
              method: "POST",
              path: "/api/app-gateway/v1/chat/completions",
            },
          ],
        },
        routes: [
          {
            surface: "bff",
            method: "POST",
            path: "/api/app-gateway/v1/chat/completions",
            source: "apps/bff/src/routes/app-gateway.ts",
            classification: "required-now",
          },
        ],
      },
      {
        target: {
          requiredPublicInference: [
            {
              method: "POST",
              path: "/api/app-gateway/v1/chat/completions",
            },
          ],
        },
        routes: [],
      },
    ),
    [
      "required route missing or ambiguous POST /api/app-gateway/v1/chat/completions",
    ],
  )
})

test("route parsing distinguishes retained Application routes from legacy compatibility routes", () => {
  const root = temporaryRoot()
  const paths = [
    "apps/bff/src/index.ts",
    "apps/bff/src/routes/app-gateway.ts",
    "apps/bff/src/routes/openai-compatible.ts",
  ]
  writeFixture(
    root,
    paths[0],
    [
      'import Fastify, { type FastifyInstance } from "fastify"',
      "export function buildServer(): FastifyInstance {",
      "  const server = Fastify({ bodyLimit: bffBodyLimitBytes(), logger: true })",
      '  server.get("/livez", handler)',
      '  server.get("/healthz", handler)',
      '  server.get("/readyz", handler)',
      "  return server",
      "}",
      "",
    ].join("\n"),
  )
  writeFixture(
    root,
    paths[1],
    [
      'import type { FastifyInstance } from "fastify"',
      "export function registerAppGatewayRoutes(server: FastifyInstance) {",
      '  server.get("/api/app-gateway/v1/models", handler)',
      '  server.post("/api/app-gateway/v1/chat/completions", handler)',
      "}",
      "",
    ].join("\n"),
  )
  writeFixture(
    root,
    paths[2],
    [
      'import type { FastifyInstance } from "fastify"',
      "export function registerOpenAICompatibleRoutes(server: FastifyInstance) {",
      '  server.get("/v1/models", handler)',
      '  server.post("/v1/chat/completions", handler)',
      "}",
      "",
    ].join("\n"),
  )

  const routes = extractBffRoutes({ root, paths })
  assert.equal(
    routes.filter((route) => route.classification === "required-now").length,
    2,
  )
  assert.equal(
    routes.filter((route) => route.classification === "private-operational")
      .length,
    3,
  )
  assert.equal(
    routes.filter((route) => route.classification === "legacy-retired").length,
    2,
  )
})

test("route parsing covers aliases, route options, nested paths, and TSX", () => {
  const root = temporaryRoot()
  const paths = [
    "apps/bff/src/routes/v2/example.ts",
    "apps/bff/src/plugins/example.tsx",
  ]
  writeFixture(
    root,
    paths[0],
    [
      "interface RouteHost {",
      "  route(options: unknown): void",
      "}",
      "export function register(server: RouteHost) {",
      "  const api = server",
      '  api.route({ method: ["GET", "POST"], url: "/nested" })',
      "}",
      "",
    ].join("\n"),
  )
  writeFixture(
    root,
    paths[1],
    [
      "interface RouteHost {",
      "  get(path: string, handler: unknown): void",
      "}",
      "export function register(api: RouteHost) {",
      '  api.get("/outside-routes", async () => null)',
      "}",
      "",
    ].join("\n"),
  )

  assert.deepEqual(
    extractBffRoutes({ root, paths }).map(({ method, path }) => ({
      method,
      path,
    })),
    [
      { method: "GET", path: "/nested" },
      { method: "POST", path: "/nested" },
      { method: "GET", path: "/outside-routes" },
    ],
  )
})

test("BFF route discovery covers JavaScript modules and custom route hosts", () => {
  const root = temporaryRoot()
  const javascriptPaths = [
    "apps/bff/src/routes/v2/javascript.js",
    "apps/bff/src/routes/v2/module.mjs",
    "apps/bff/src/routes/v2/common.cjs",
  ]
  for (const path of javascriptPaths) {
    writeFixture(root, path, 'server.post("/api/admin/chat", handler)\n')
  }
  assert.deepEqual(
    extractBffRoutes({ root, paths: javascriptPaths }).map(
      ({ method, path }) => ({ method, path }),
    ),
    [
      { method: "POST", path: "/api/admin/chat" },
      { method: "POST", path: "/api/admin/chat" },
      { method: "POST", path: "/api/admin/chat" },
    ],
  )

  const dynamicPath = "apps/bff/src/services/custom-host.ts"
  writeFixture(
    root,
    dynamicPath,
    [
      "interface EndpointHost { post(path: string, handler: unknown): void }",
      "declare const routePath: string",
      "declare const handler: unknown",
      "export function register(x: EndpointHost) {",
      "  x.post(routePath, handler)",
      "}",
      "",
    ].join("\n"),
  )
  assert.throws(
    () => extractBffRoutes({ root, paths: [dynamicPath] }),
    /Fastify shorthand route path must be a static absolute literal/,
  )

  const foldedPath = "apps/bff/src/services/folded-host.ts"
  writeFixture(
    root,
    foldedPath,
    [
      'const routePath = "/api/admin/" + "chat"',
      "export function attach(target: any) {",
      "  target.post(routePath, handler)",
      "}",
      "",
    ].join("\n"),
  )
  assert.deepEqual(
    extractBffRoutes({ root, paths: [foldedPath] }).map(({ method, path }) => ({
      method,
      path,
    })),
    [{ method: "POST", path: "/api/admin/chat" }],
  )

  const shadowedPath = "apps/bff/src/routes/v2/shadowed.ts"
  writeFixture(
    root,
    shadowedPath,
    [
      'const routePath = "/api/admin/reviewed"',
      "interface RouteHost { post(path: string, handler: unknown): void }",
      "declare const handler: unknown",
      "declare function runtimePath(): string",
      "export function register(server: RouteHost) {",
      "  const routePath = runtimePath()",
      "  server.post(routePath, handler)",
      "}",
      "",
    ].join("\n"),
  )
  assert.throws(
    () => extractBffRoutes({ root, paths: [shadowedPath] }),
    /Fastify shorthand route path must be a static absolute literal/,
  )
})

test("unsupported or dynamic Fastify route registration fails closed", () => {
  const fixtures = [
    "server.get(routePath, handler)",
    "server.route(routeOptions)",
    'server.route({ ...routeOptions, method: "GET", url: "/spread" })',
    'server[method]("/dynamic", handler)',
    "const post = server.post.bind(server)",
    'server.post.call(server, "/call", handler)',
    'server.post.apply(server, ["/apply", handler])',
    'Reflect.apply(server.post, server, ["/reflect", handler])',
    'server.post("/constrained", { constraints: { version: "1.0.0" } }, handler)',
    'server.post("/variable-options", routeOptions, handler)',
    'server.post("/spread-options", { ...routeOptions }, handler)',
    'server.route({ method: "POST", url: "/versioned", version: "1.0.0", handler })',
    'server.all("/all", handler)',
    "server.register(plugin)",
    'server.addHttpMethod("PURGE", handler)',
    "server.setNotFoundHandler(handler)",
    'server.addHook("preHandler", authHook)',
    'server.server.prependListener("request", handler)',
    'server["ser" + "ver"].prependListener("request", handler)',
  ]

  for (const [index, statement] of fixtures.entries()) {
    const root = temporaryRoot()
    const path = `apps/bff/src/routes/v2/rejected-${index}.ts`
    writeFixture(
      root,
      path,
      [
        'import type { FastifyInstance } from "fastify"',
        "declare const routePath: string",
        "declare const routeOptions: unknown",
        "declare const method: string",
        "declare const handler: unknown",
        "declare const authHook: unknown",
        "declare const plugin: unknown",
        "export function register(server: FastifyInstance) {",
        `  ${statement}`,
        "}",
        "",
      ].join("\n"),
    )
    assert.throws(
      () => extractBffRoutes({ root, paths: [path] }),
      /Fastify (?:route|shorthand|raw server)|Unsupported Fastify|Dynamic Fastify|Unreviewed Fastify/,
    )
  }
})

test("Fastify instances cannot escape to production-only or misbound registrars", () => {
  const fixtures = [
    {
      importLine: 'import { attach } from "./services/stealth"',
      invocation: "attach(server)",
    },
    {
      importLine: 'import { registerAdminRoutes } from "./services/stealth"',
      invocation: "registerAdminRoutes(server)",
    },
    {
      importLine: 'import { attach } from "./services/stealth"',
      invocation: "attach(() => server)",
    },
    {
      importLine: 'import { attach } from "./services/stealth"',
      invocation: "Reflect.apply(attach, null, [server])",
    },
  ]

  for (const fixture of fixtures) {
    const root = temporaryRoot()
    const indexPath = "apps/bff/src/index.ts"
    writeFixture(
      root,
      indexPath,
      [
        'import Fastify, { type FastifyInstance } from "fastify"',
        fixture.importLine,
        "export function buildServer(): FastifyInstance {",
        "  const server = Fastify({ bodyLimit: bffBodyLimitBytes(), logger: true })",
        '  if (process.env.NODE_ENV === "production") {',
        `    ${fixture.invocation}`,
        "  }",
        "  return server",
        "}",
        "",
      ].join("\n"),
    )
    assert.throws(
      () => extractBffRoutes({ root, paths: [indexPath] }),
      /Fastify instance may not escape|Reviewed Fastify registrar/,
    )
  }
})

test("Fastify instances cannot be captured, assigned, or exported", () => {
  const statements = [
    "const leaked = { server }",
    "globalThis.leaked = server",
    "const leaked = [server]",
    "const leaked = () => server",
  ]

  for (const statement of statements) {
    const root = temporaryRoot()
    const indexPath = "apps/bff/src/index.ts"
    writeFixture(
      root,
      indexPath,
      [
        'import Fastify, { type FastifyInstance } from "fastify"',
        "export function buildServer(): FastifyInstance {",
        "  const server = Fastify({ bodyLimit: bffBodyLimitBytes(), logger: true })",
        `  ${statement}`,
        "  return server",
        "}",
        "",
      ].join("\n"),
    )
    assert.throws(
      () => extractBffRoutes({ root, paths: [indexPath] }),
      /Fastify instance may not be captured|Fastify instance may not be assigned|Fastify instance may not be exported/,
    )
  }
})

test("Fastify factory, receiver, and registrar capabilities are default deny", () => {
  const rejectedBodies = [
    ["  const make = Fastify", "  const server = make()", "  return server"],
    [
      "  const server = Fastify({ bodyLimit: bffBodyLimitBytes(), logger: true })",
      "  const hidden = server as any",
      '  hidden.server.prependListener("request", () => undefined)',
      "  return server",
    ],
    [
      "  const server = Fastify({ bodyLimit: bffBodyLimitBytes(), logger: true })",
      "  let hidden: any",
      "  hidden ||= server",
      "  return server",
    ],
    [
      "  const server = Fastify({ bodyLimit: bffBodyLimitBytes(), logger: true })",
      "  new AttachRoutes(server)",
      "  return server",
    ],
    [
      "  const server = Fastify({ bodyLimit: bffBodyLimitBytes(), logger: true, rewriteUrl })",
      "  return server",
    ],
  ]
  for (const [index, body] of rejectedBodies.entries()) {
    const root = temporaryRoot()
    const path = "apps/bff/src/index.ts"
    writeFixture(
      root,
      path,
      [
        'import Fastify, { type FastifyInstance } from "fastify"',
        "declare const AttachRoutes: new (server: unknown) => unknown",
        "declare const rewriteUrl: (request: unknown) => string",
        "export function buildServer(): FastifyInstance {",
        ...body,
        "}",
        "",
      ].join("\n"),
    )
    assert.throws(
      () => extractBffRoutes({ root, paths: [path] }),
      /Fastify factory|Fastify instance|Unreviewed Fastify/,
      `rejected body ${index}`,
    )
  }

  const shadowRoot = temporaryRoot()
  const shadowPath = "apps/bff/src/index.ts"
  writeFixture(
    shadowRoot,
    shadowPath,
    [
      'import Fastify, { type FastifyInstance } from "fastify"',
      'import { registerAdminRoutes } from "./routes/admin"',
      "declare const attach: (server: FastifyInstance) => void",
      "export function buildServer(registerAdminRoutes = attach): FastifyInstance {",
      "  const server = Fastify({ bodyLimit: bffBodyLimitBytes(), logger: true })",
      "  registerAdminRoutes(server)",
      "  return server",
      "}",
      "",
    ].join("\n"),
  )
  assert.throws(
    () => extractBffRoutes({ root: shadowRoot, paths: [shadowPath] }),
    /Reviewed buildServer definition changed|registrar binding may not be shadowed/,
  )
})

test("workspace package route-control APIs are part of the BFF closure", () => {
  for (const [index, statement] of [
    "target.setNotFoundHandler(handler)",
    "target.setErrorHandler(handler)",
    'target.addHook("onRequest", handler)',
    "target.register(plugin)",
  ].entries()) {
    const root = temporaryRoot()
    const path = `packages/contracts/src/stealth-${index}.ts`
    writeFixture(
      root,
      path,
      [
        "declare const handler: unknown",
        "declare const plugin: unknown",
        "export function attach(target: any) {",
        `  ${statement}`,
        "}",
        "",
      ].join("\n"),
    )
    assert.throws(
      () => extractBffRoutes({ root, paths: [path] }),
      /Unsupported Fastify|Unreviewed Fastify/,
    )
  }
})

test("reviewed Fastify registrar wiring is exact and shrink-only", () => {
  const root = temporaryRoot()
  const indexPath = "apps/bff/src/index.ts"
  const adminPath = "apps/bff/src/routes/admin.ts"
  const paths = [indexPath, adminPath]
  writeFixture(
    root,
    indexPath,
    [
      'import Fastify, { type FastifyInstance } from "fastify"',
      'import { registerAdminRoutes } from "./routes/admin"',
      "export function buildServer(): FastifyInstance {",
      "  const server = Fastify({ bodyLimit: bffBodyLimitBytes(), logger: true })",
      "  registerAdminRoutes(server)",
      "  return server",
      "}",
      "",
    ].join("\n"),
  )
  writeFixture(
    root,
    adminPath,
    [
      'import type { FastifyInstance } from "fastify"',
      "export function registerAdminRoutes(server: FastifyInstance): void {",
      '  server.get("/api/admin/overview", async () => null)',
      "}",
      "",
    ].join("\n"),
  )

  assert.deepEqual(
    extractBffRoutes({ root, paths }).map(({ method, path }) => ({
      method,
      path,
    })),
    [{ method: "GET", path: "/api/admin/overview" }],
  )
  assert.deepEqual(extractFastifyRegistrarManifest({ root, paths }), [
    {
      exportName: "registerAdminRoutes",
      importSource: "./routes/admin",
      sourcePath: adminPath,
    },
  ])
})

test("unreviewed Fastify imports and dynamic code loading fail closed", () => {
  const root = temporaryRoot()
  const importPath = "packages/contracts/src/fastify.ts"
  writeFixture(
    root,
    importPath,
    'import Fastify from "fastify"\nexport const server = Fastify()\n',
  )
  assert.throws(
    () => extractBffRoutes({ root, paths: [importPath] }),
    /Unreviewed Fastify import/,
  )

  const dynamicPath = "packages/contracts/src/dynamic.ts"
  writeFixture(root, dynamicPath, 'export const plugin = require("./plugin")\n')
  assert.throws(
    () => extractBffRoutes({ root, paths: [dynamicPath] }),
    /Dynamic code loading is not allowed/,
  )

  const deepImportPath = "packages/contracts/src/deep-fastify.ts"
  writeFixture(
    root,
    deepImportPath,
    'import createServer from "fastify/fastify"\nexport const server = createServer()\n',
  )
  assert.throws(
    () => extractBffRoutes({ root, paths: [deepImportPath] }),
    /Unreviewed Fastify subpath import/,
  )

  const createRequirePath = "packages/contracts/src/create-require.ts"
  writeFixture(
    root,
    createRequirePath,
    [
      'import { createRequire } from "node:module"',
      "const load = createRequire(import.meta.url)",
      'export const createServer = load("fastify")',
      "",
    ].join("\n"),
  )
  assert.throws(
    () => extractBffRoutes({ root, paths: [createRequirePath] }),
    /Dynamic CommonJS loader creation|Dynamic Fastify loading/,
  )
})

test("non-route Map and Headers method calls remain ignored", () => {
  const root = temporaryRoot()
  const path = "apps/bff/src/services/example.ts"
  writeFixture(
    root,
    path,
    [
      'const values = new Map([["key", "value"]])',
      'values.get("key")',
      'new Headers().get("content-type")',
      "",
    ].join("\n"),
  )

  assert.deepEqual(extractBffRoutes({ root, paths: [path] }), [])
})

test("Web inference endpoint-string invocation sites are frozen shrink-only", () => {
  const root = temporaryRoot()
  const legacyPath = "apps/web/src/app/api/hub/chat/route.ts"
  const applicationPath =
    "apps/web/src/components/console-v2/applications-v2-experience.tsx"
  const referenceOnlyPath = "apps/web/src/lib/admin/mock-data.ts"
  const shadowedPath = "apps/web/src/components/shadowed.ts"
  writeFixture(
    root,
    legacyPath,
    [
      "declare const baseUrl: string",
      "export async function POST() {",
      "  return fetch(`${baseUrl}/v1/chat/completions`)",
      "}",
      "",
    ].join("\n"),
  )
  writeFixture(
    root,
    applicationPath,
    [
      'const endpoint = "/api/app-gateway/v1/" + "chat/completions"',
      "declare const baseUrl: string",
      "export async function sendPrompt() {",
      "  await fetch(endpoint)",
      '  await fetch("/api/app-gateway/v1/chat/" + "completions")',
      "  await fetch(`${baseUrl}/v1/chat/completions`)",
      "}",
      "",
    ].join("\n"),
  )
  writeFixture(
    root,
    referenceOnlyPath,
    'export const example = { baseUrl: "/v1/chat/completions" }\n',
  )
  writeFixture(
    root,
    shadowedPath,
    [
      'const endpoint = "/safe"',
      "export function invoke() {",
      '  const endpoint = "/v1/chat/completions"',
      "  return fetch(endpoint)",
      "}",
      "",
    ].join("\n"),
  )

  const legacy = extractWebInferenceConsumers({
    root,
    paths: [legacyPath, referenceOnlyPath],
  })
  const expanded = extractWebInferenceConsumers({
    root,
    paths: [legacyPath, applicationPath, referenceOnlyPath, shadowedPath],
  })

  assert.deepEqual(
    legacy.map(({ path, invocationCount }) => ({ path, invocationCount })),
    [{ path: legacyPath, invocationCount: 1 }],
  )
  assert.deepEqual(
    expanded.map(({ path, invocationCount }) => ({ path, invocationCount })),
    [
      { path: legacyPath, invocationCount: 1 },
      { path: applicationPath, invocationCount: 3 },
      { path: shadowedPath, invocationCount: 1 },
    ],
  )
  assert.deepEqual(
    verifyLegacyRouteShrink(
      { routes: [], webInferenceConsumers: legacy },
      { routes: [], webInferenceConsumers: expanded },
    ),
    [
      `Web inference consumer changed ${applicationPath}`,
      `Web inference consumer changed ${shadowedPath}`,
    ],
  )
  assert.deepEqual(
    verifyLegacyRouteShrink(
      { routes: [], webInferenceConsumers: legacy },
      { routes: [], webInferenceConsumers: [] },
    ),
    [],
  )
})

test("Web route discovery covers every supported JavaScript and TypeScript extension", () => {
  const root = temporaryRoot()
  const paths = [
    "apps/web/src/app/from-js/page.js",
    "apps/web/src/app/from-jsx/page.jsx",
    "apps/web/src/app/from-ts/page.ts",
    "apps/web/src/app/from-tsx/page.tsx",
    "apps/web/app/from-root/page.tsx",
    "apps/web/src/app/api/from-js/route.js",
    "apps/web/src/app/api/from-jsx/route.jsx",
    "apps/web/src/app/api/from-ts/route.ts",
    "apps/web/src/app/api/from-tsx/route.tsx",
    "apps/web/app/api/from-root/route.ts",
  ]
  for (const path of paths) {
    writeFixture(
      root,
      path,
      path.includes("/api/")
        ? path.includes("from-root")
          ? "export const GET = () => null\n"
          : "export async function POST() {}\n"
        : "export default function Page() { return null }\n",
    )
  }

  const routes = extractWebRoutes({ root, paths })
  assert.deepEqual(
    routes.map(({ method, path }) => ({ method, path })),
    [
      { method: "PAGE", path: "/from-js" },
      { method: "PAGE", path: "/from-jsx" },
      { method: "PAGE", path: "/from-ts" },
      { method: "PAGE", path: "/from-tsx" },
      { method: "PAGE", path: "/from-root" },
      { method: "POST", path: "/api/from-js" },
      { method: "POST", path: "/api/from-jsx" },
      { method: "POST", path: "/api/from-ts" },
      { method: "POST", path: "/api/from-tsx" },
      { method: "GET", path: "/api/from-root" },
    ],
  )
})

test("alternate Next routing entrypoints fail closed", () => {
  const root = temporaryRoot()
  const paths = [
    "apps/web/src/pages/hidden-chat.tsx",
    "apps/web/middleware.mjs",
    "apps/web/next.config.mjs",
    "apps/web/src/proxy.ts",
    "apps/web/src/app/not-found.tsx",
  ]
  for (const path of paths) {
    writeFixture(root, path, "export default function hidden() {}\n")
    assert.throws(
      () => extractWebRoutes({ root, paths: [path] }),
      /Next Pages Router|Unreviewed Next/,
    )
  }
})

test("Next static assets and metadata routes are inventoried", () => {
  const root = temporaryRoot()
  const paths = [
    "apps/web/public/chat.html",
    "apps/web/src/app/icon.svg",
    "apps/web/app/robots.ts",
    "apps/web/app/opengraph-image.tsx",
  ]
  for (const path of paths) {
    writeFixture(root, path, "fixture\n")
  }

  assert.deepEqual(
    extractWebRoutes({ root, paths }).map(({ surface, method, path }) => ({
      surface,
      method,
      path,
    })),
    [
      {
        surface: "web-static",
        method: "STATIC",
        path: "/chat.html",
      },
      {
        surface: "web-metadata",
        method: "METADATA",
        path: "/icon.svg",
      },
      {
        surface: "web-metadata",
        method: "METADATA",
        path: "/robots.txt",
      },
      {
        surface: "web-metadata",
        method: "METADATA",
        path: "/opengraph-image",
      },
    ],
  )
})

test("Next middleware rewrites cannot hide route surfaces", () => {
  const root = temporaryRoot()
  const paths = ["apps/web/src/middleware.ts", "apps/web/src/lib/proxy.ts"]
  writeFixture(
    root,
    paths[0],
    'export default () => NextResponse.rewrite(new URL("/chat", "https://example.invalid"))\n',
  )
  writeFixture(root, paths[1], 'export const proxy = NextResponse["rewrite"]\n')

  for (const path of paths) {
    assert.throws(
      () => extractWebRoutes({ root, paths: [path] }),
      /Next middleware rewrite registration is not allowed/,
    )
  }
})

test("Next middleware cannot create direct response surfaces", () => {
  const root = temporaryRoot()
  const path = "apps/web/src/middleware.ts"
  writeFixture(
    root,
    path,
    [
      'import { NextResponse } from "next/server"',
      'import { auth } from "@/lib/auth/auth"',
      "const createAuthMiddleware = auth",
      "const requireAuthenticatedSession = createAuthMiddleware(() => NextResponse.next())",
      "export default function middleware() {",
      '  return new Response("<html>chat</html>")',
      "}",
      "",
    ].join("\n"),
  )

  assert.throws(
    () => extractWebRoutes({ root, paths: [path] }),
    /Next middleware may not construct response bodies|Unreviewed Next middleware return form/,
  )
})

test("Next middleware helpers must have reviewed provenance", () => {
  const root = temporaryRoot()
  const path = "apps/web/src/middleware.ts"
  writeFixture(
    root,
    path,
    [
      'import { NextResponse } from "next/server"',
      'import { auth, maliciousCallback } from "./evil"',
      "const createAuthMiddleware = auth",
      "const requireAuthenticatedSession = createAuthMiddleware(maliciousCallback)",
      "export default function middleware(request, event) {",
      "  return requireAuthenticatedSession(request, event)",
      "}",
      "",
    ].join("\n"),
  )

  assert.throws(
    () => extractWebRoutes({ root, paths: [path] }),
    /Missing reviewed Next middleware import|authenticated-session wrapper changed/,
  )
})

test("sanitized Core commands reject environment files in any package", () => {
  const root = temporaryRoot()
  writeFixture(root, "packages/contracts/.env.local", "TOKEN=example\n")

  assert.throws(
    () => assertNoUnexpectedEnvironmentFiles(root),
    /packages\/contracts\/\.env\.local/,
  )

  const symlinkRoot = temporaryRoot()
  writeFixture(symlinkRoot, "outside.env", "TOKEN=example\n")
  mkdirSync(join(symlinkRoot, "packages"), { recursive: true })
  symlinkSync("../outside.env", join(symlinkRoot, "packages/.env.local"))
  assert.throws(
    () => assertNoUnexpectedEnvironmentFiles(symlinkRoot),
    /packages\/\.env\.local/,
  )
})

test("Core package scripts cannot be replaced with no-op commands", () => {
  const root = temporaryRoot()
  const manifests = [
    ["apps/bff/package.json", "@llm-machines/bff"],
    ["apps/web/package.json", "@llm-machines/web"],
    ["packages/contracts/package.json", "@llm-machines/contracts"],
    ["packages/copy/package.json", "@llm-machines/copy"],
  ]
  for (const [path, name] of manifests) {
    writeFixture(
      root,
      path,
      `${JSON.stringify({
        name,
        dependencies:
          name === "@llm-machines/bff"
            ? { "@llm-machines/contracts": "workspace:*" }
            : name === "@llm-machines/web"
              ? {
                  "@llm-machines/contracts": "workspace:*",
                  "@llm-machines/copy": "workspace:*",
                }
              : {},
        scripts: { build: "true", test: "true", typecheck: "true" },
      })}\n`,
    )
  }
  writeFixture(root, "package.json", '{"scripts":{}}\n')
  writeFixture(
    root,
    "pnpm-workspace.yaml",
    "packages:\n  - apps/*\n  - packages/*\n",
  )

  const errors = verifyCorePackageClosure(
    root,
    manifests.map(([path]) => path),
  )
  assert.equal(
    errors.filter((error) => error.startsWith("invalid @llm-machines/")).length,
    12,
  )
})

test("Core lifecycle companion scripts cannot bypass locked commands", () => {
  const root = temporaryRoot()
  const manifestPaths = [
    "apps/bff/package.json",
    "apps/web/package.json",
    "packages/contracts/package.json",
    "packages/copy/package.json",
  ]
  const lifecycleNames = ["prebuild", "posttypecheck", "pretest", "posttest"]
  for (const [index, path] of manifestPaths.entries()) {
    const manifest = JSON.parse(
      readFileSync(join(repositoryRoot, path), "utf8"),
    )
    manifest.scripts[lifecycleNames[index]] = "node unreviewed.mjs"
    writeFixture(root, path, `${JSON.stringify(manifest)}\n`)
  }
  const rootManifest = JSON.parse(
    readFileSync(join(repositoryRoot, "package.json"), "utf8"),
  )
  rootManifest.scripts.pretest = "node unreviewed.mjs"
  rootManifest.scripts["postbuild:inference-core"] = "node unreviewed.mjs"
  writeFixture(root, "package.json", `${JSON.stringify(rootManifest)}\n`)
  writeFixture(
    root,
    "pnpm-workspace.yaml",
    "packages:\n  - apps/*\n  - packages/*\n",
  )
  const configPaths = ["apps/bff/vitest.config.ts", "apps/web/vitest.config.ts"]
  for (const path of configPaths) {
    writeFixture(root, path, "export default {}\n")
  }

  const errors = verifyCorePackageClosure(root, [
    ...manifestPaths,
    ...configPaths,
  ])
  assert.equal(
    errors.filter((error) => error.includes("lifecycle script")).length,
    6,
  )
})

test("retention register rejects unreviewed top-level claims", () => {
  const root = temporaryRoot()
  const path = "docs/reduction/inference-core/retention-characterization.json"
  const register = JSON.parse(readFileSync(join(repositoryRoot, path), "utf8"))
  register.productionZeroRetention = "PASS"
  writeFixture(root, path, `${JSON.stringify(register)}\n`)

  assert.match(
    verifyRetentionCharacterization(root).join("\n"),
    /overstates PR-01 evidence/,
  )
})

test("the live repository matches its reviewed PR-01 baselines", () => {
  const result = verifyRepository({
    baseRef:
      process.env.INFERENCE_CORE_BASE_REF ??
      "origin/codex/inference-core-stack-reduction",
  })
  assert.deepEqual(result.errors, [])
  assert.equal(result.ok, true)
  assert.equal(result.routeCount > 0, true)
  assert.equal(result.findingCount > 0, true)
})

test("the production closure contains every package and container entrypoint", () => {
  const baseline = JSON.parse(
    readFileSync(
      join(repositoryRoot, "docs/reduction/inference-core/route-baseline.json"),
      "utf8",
    ),
  )
  const paths = new Set(baseline.sourceClosure.map((entry) => entry.path))
  for (const path of [
    ".dockerignore",
    "apps/bff/Dockerfile",
    "apps/bff/package.json",
    "apps/web/Dockerfile",
    "apps/web/package.json",
    "apps/web/postcss.config.mjs",
    "package.json",
    "packages/contracts/package.json",
    "packages/copy/package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
  ]) {
    assert.equal(paths.has(path), true, `missing production boundary ${path}`)
  }
})

test("leading-dash base refs fail closed", () => {
  const result = verifyRepository({ baseRef: "--help" })
  assert.equal(result.baseStatus, "unavailable")
  assert.match(result.errors.join("\n"), /base ref is unavailable --help/)
})

function temporaryRoot() {
  const root = mkdtempSync(join(tmpdir(), "llmm-pr01-"))
  temporaryRoots.push(root)
  return root
}

function writeFixture(root, path, content) {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), content)
}
