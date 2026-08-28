import { existsSync, readFileSync, statSync } from "node:fs"
import { dirname, extname, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"
import { describe, expect, it } from "vitest"

const webSourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const retainedEntryPaths = [
  "app/api/admin/audit/export/route.ts",
  "app/api/admin/audit/export/verification-keys/route.ts",
  "app/applications/[[...section]]/page.tsx",
  "app/hardware/page.tsx",
  "app/inference/[[...section]]/page.tsx",
  "app/page.tsx",
  "app/settings/page.tsx",
  "app/team/[[...section]]/page.tsx",
]
const retiredRoutePaths = [
  "app/activity/page.tsx",
  "app/api/builder/agents/[id]/test/stream/route.ts",
  "app/api/hub/chat/route.ts",
  "app/api/hub/events/route.ts",
  "app/api/hub/notifications/[id]/read/route.ts",
  "app/api/hub/search/route.ts",
  "app/artifacts/[id]/page.tsx",
  "app/artifacts/page.tsx",
  "app/builder/agents/[id]/page.tsx",
  "app/builder/page.tsx",
  "app/builder/resources/[id]/page.tsx",
  "app/builder/submissions/page.tsx",
  "app/builder/templates/[id]/page.tsx",
  "app/builder/templates/page.tsx",
  "app/chat/page.tsx",
  "app/knowledge/page.tsx",
  "app/profile/page.tsx",
  "app/resources/[type]/[id]/page.tsx",
  "app/resources/page.tsx",
  "app/tasks/[id]/page.tsx",
  "app/tasks/page.tsx",
  "app/usage/page.tsx",
]
const retiredBoundaryPatterns = [
  /agentic/i,
  /builder/i,
  /connector/i,
  /corpora/i,
  /corpus/i,
  /knowledge/i,
  /librechat/i,
  /mcp/i,
  /promotion/i,
  /(?:^|[^A-Za-z])(?:hub|Hub)(?=$|[^a-z])/m,
  /(?:^|[^A-Za-z])(?:rag|Rag|RAG)(?=$|[^a-z])/m,
  /break-glass/i,
  /url[-_ ]?(?:governance|policy|rule)/i,
]

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8")
}

describe("retained Web inference-core boundaries", () => {
  it("keeps every retired page and route handler absent", () => {
    for (const path of retiredRoutePaths) {
      expect(existsSync(resolve(webSourceRoot, path)), path).toBe(false)
    }
  })

  it("keeps the complete retained local import closure free of retired domains", () => {
    for (const path of retainedLocalImportClosure(retainedEntryPaths)) {
      const moduleSource = readFileSync(resolve(webSourceRoot, path), "utf8")
      for (const pattern of retiredBoundaryPatterns) {
        expect(moduleSource, `${path} matched ${String(pattern)}`).not.toMatch(
          pattern,
        )
      }
    }
  })

  it("routes retained Next pages through the core route owner", () => {
    for (const path of [
      "../../app/applications/[[...section]]/page.tsx",
      "../../app/hardware/page.tsx",
      "../../app/inference/[[...section]]/page.tsx",
      "../../app/settings/page.tsx",
      "../../app/team/[[...section]]/page.tsx",
    ]) {
      const pageSource = source(path)
      expect(pageSource, path).toContain("@/lib/admin/console-v2-routes-core")
      expect(pageSource, path).not.toContain(
        'from "@/lib/admin/console-v2-routes"',
      )
    }
  })

  it("uses only core actions for retained components that mutate", () => {
    for (const path of [
      "../../components/console-v2/applications-v2-experience.tsx",
      "../../components/console-v2/settings-v2-experience.tsx",
      "../../components/console-v2/team-v2-experience.tsx",
    ]) {
      const componentSource = source(path)
      expect(componentSource, path).toContain("@/lib/admin/actions-core")
      expect(componentSource, path).not.toContain('from "@/lib/admin/actions"')
    }
  })

  it("keeps retained read-only components free of legacy actions", () => {
    for (const path of [
      "../../components/console-v2/inference-v2-experience.tsx",
      "../../components/console-v2/overview-v2-experience.tsx",
      "../../components/console-v2/hardware-v2-experience.tsx",
    ]) {
      const componentSource = source(path)
      expect(componentSource, path).not.toContain('from "@/lib/admin/actions"')
    }
  })
})

function retainedLocalImportClosure(entryPaths: string[]): string[] {
  const visited = new Set<string>()
  const pending = [...entryPaths]

  while (pending.length > 0) {
    const path = pending.pop()
    if (!path || visited.has(path)) {
      continue
    }
    const absolutePath = resolve(webSourceRoot, path)
    expect(existsSync(absolutePath), `missing retained module ${path}`).toBe(
      true,
    )
    visited.add(path)

    const sourceFile = ts.createSourceFile(
      path,
      readFileSync(absolutePath, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      scriptKind(path),
    )
    for (const statement of sourceFile.statements) {
      if (
        (ts.isImportDeclaration(statement) ||
          ts.isExportDeclaration(statement)) &&
        statement.moduleSpecifier &&
        ts.isStringLiteral(statement.moduleSpecifier)
      ) {
        const importedPath = resolveLocalModule(
          absolutePath,
          statement.moduleSpecifier.text,
        )
        if (importedPath && !visited.has(importedPath)) {
          pending.push(importedPath)
        }
      }
    }
  }

  return [...visited].sort()
}

function resolveLocalModule(
  importer: string,
  specifier: string,
): string | null {
  const basePath = specifier.startsWith("@/")
    ? resolve(webSourceRoot, specifier.slice(2))
    : specifier.startsWith(".")
      ? resolve(dirname(importer), specifier)
      : null
  if (!basePath) {
    return null
  }

  for (const candidate of [
    basePath,
    ...[".ts", ".tsx", ".js", ".jsx"].map(
      (extension) => `${basePath}${extension}`,
    ),
    ...[".ts", ".tsx", ".js", ".jsx"].map((extension) =>
      resolve(basePath, `index${extension}`),
    ),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return relative(webSourceRoot, candidate)
    }
  }

  throw new Error(
    `Could not resolve retained local import ${specifier} from ${relative(
      webSourceRoot,
      importer,
    )}`,
  )
}

function scriptKind(path: string): ts.ScriptKind {
  switch (extname(path)) {
    case ".tsx":
      return ts.ScriptKind.TSX
    case ".jsx":
      return ts.ScriptKind.JSX
    case ".js":
      return ts.ScriptKind.JS
    default:
      return ts.ScriptKind.TS
  }
}
