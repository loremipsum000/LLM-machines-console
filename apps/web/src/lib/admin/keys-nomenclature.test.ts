import { readFile, readdir } from "node:fs/promises"
import { join, resolve } from "node:path"
import { describe, expect, it } from "vitest"

const webSourceRoot = resolve(process.cwd(), "src")
const sharedCopyPath = resolve(
  process.cwd(),
  "../../packages/copy/src/index.ts",
)
const forbiddenCustomerTerm =
  /\b(?:Applications?|Connected app|connected app)\b|(?:^|[ "'`>])applications?(?=$|[\s.,:;!?<"'`])/g

describe("Keys customer nomenclature", () => {
  it("does not expose retired Application terminology in rendered Web source or shared copy", async () => {
    const findings: string[] = []
    const customerSurfaces = [
      ...(await productionSourceFiles(webSourceRoot)),
      sharedCopyPath,
    ]
    for (const path of customerSurfaces) {
      const source = await readFile(path, "utf8")
      for (const match of source.matchAll(forbiddenCustomerTerm)) {
        const line = sourceLine(source, match.index ?? 0)
        if (isInternalApplicationIdentifier(path, line, match[0].trim())) {
          continue
        }
        findings.push(
          `${path.slice(webSourceRoot.length + 1)}:${lineNumber(source, match.index ?? 0)}:${match[0].trim()}`,
        )
      }
    }
    expect(findings).toEqual([])
  })
})

async function productionSourceFiles(directory: string): Promise<string[]> {
  const files: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await productionSourceFiles(path)))
    } else if (
      /\.(?:ts|tsx)$/.test(entry.name) &&
      !/\.(?:test|spec)\.(?:ts|tsx)$/.test(entry.name)
    ) {
      files.push(path)
    }
  }
  return files.sort()
}

function lineNumber(source: string, index: number): number {
  return source.slice(0, index).split("\n").length
}

function sourceLine(source: string, index: number): string {
  const start = source.lastIndexOf("\n", index) + 1
  const end = source.indexOf("\n", index)
  return source.slice(start, end < 0 ? source.length : end)
}

function isInternalApplicationIdentifier(
  path: string,
  line: string,
  term: string,
): boolean {
  return (
    term === '"applications' &&
    (/"applications"/.test(line) || /"applications\.[a-z_.]*"/.test(line))
  )
}
