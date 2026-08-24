import { readFile, readdir } from "node:fs/promises"
import { join, resolve } from "node:path"
import { describe, expect, it } from "vitest"

const bffSourceRoot = resolve(process.cwd(), "src")
const contractsPath = resolve(
  process.cwd(),
  "../../packages/contracts/src/inference-core.ts",
)
const forbiddenCustomerTerm =
  /\b(?:Applications?|Connected app|connected app)\b/g
const internalKeycloakApplicationExceptions = new Set([
  "Keycloak Application administration configuration",
  "Keycloak Application client",
  "Keycloak Application administration client",
])

describe("Keys API nomenclature", () => {
  it("keeps retired terminology out of customer-returned BFF and contract text", async () => {
    const findings: string[] = []
    for (const path of [
      ...(await productionSourceFiles(bffSourceRoot)),
      contractsPath,
    ]) {
      const source = await readFile(path, "utf8")
      for (const match of source.matchAll(forbiddenCustomerTerm)) {
        const line = sourceLine(source, match.index ?? 0)
        if (
          [...internalKeycloakApplicationExceptions].some((exception) =>
            line.includes(exception),
          )
        ) {
          continue
        }
        findings.push(
          `${path.slice(bffSourceRoot.length + 1)}:${lineNumber(source, match.index ?? 0)}:${line.trim()}`,
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
      entry.name.endsWith(".ts") &&
      !/\.(?:test|spec)\.ts$/.test(entry.name)
    ) {
      files.push(path)
    }
  }
  return files.sort()
}

function sourceLine(source: string, index: number): string {
  const start = source.lastIndexOf("\n", index) + 1
  const end = source.indexOf("\n", index)
  return source.slice(start, end < 0 ? source.length : end)
}

function lineNumber(source: string, index: number): number {
  return source.slice(0, index).split("\n").length
}
