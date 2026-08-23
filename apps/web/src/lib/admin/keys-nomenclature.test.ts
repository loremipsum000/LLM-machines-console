import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const customerSurfaces = [
  "../../components/console-v2/applications-v2-experience.tsx",
  "../../components/console-v2/console-v2-sections.ts",
  "../../components/console-v2/overview-v2-experience.tsx",
  "../../components/console-v2/settings-v2-experience.tsx",
  "../../components/technical-tools-panel.tsx",
  "../../../../../packages/copy/src/index.ts",
]

describe("Keys customer nomenclature", () => {
  it("does not expose retired Applications labels on customer surfaces", async () => {
    const forbidden =
      /["'`>](Applications|Application credentials|App settings|Add app|Create app|Creating app\.\.\.|Open Applications)["'`<]/
    const findings: string[] = []
    for (const relativePath of customerSurfaces) {
      const path = fileURLToPath(new URL(relativePath, import.meta.url))
      const source = await readFile(path, "utf8")
      if (forbidden.test(source)) findings.push(relativePath)
    }
    expect(findings).toEqual([])
  })
})
