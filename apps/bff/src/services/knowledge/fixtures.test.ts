import { existsSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const fixtureRoot = join(process.cwd(), "../../test-fixtures/knowledge")

describe("knowledge corpus fixtures", () => {
  it("keeps tangible fixtures for every governed corpus source type", () => {
    const requiredFixtures = [
      "hr-pravilnik.txt",
      "hr-pravilnik.docx",
      "en-safety.txt",
      "en-safety.pdf",
      "table-policy.csv",
      "table-policy.xlsx",
      "image-ocr.png",
      "image-ocr.jpg",
      "url-policy.html",
      "pdf-parser/digital-english-policy.pdf",
      "pdf-parser/digital-croatian-policy.pdf",
      "pdf-parser/table-heavy-policy.pdf",
      "pdf-parser/multi-page-operations.pdf",
      "pdf-parser/corrupt.pdf",
      "pdf-parser/scanned-croatian-placeholder.pdf",
    ]

    expect(
      requiredFixtures.filter((fixture) =>
        existsSync(join(fixtureRoot, fixture)),
      ),
    ).toEqual(requiredFixtures)
  })
})
