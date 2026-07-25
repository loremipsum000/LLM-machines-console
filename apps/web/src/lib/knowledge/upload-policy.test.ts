import { describe, expect, it } from "vitest"
import {
  MAX_KNOWLEDGE_UPLOAD_FILE_BYTES,
  validateKnowledgeUploadCandidates,
} from "./upload-policy"

describe("knowledge upload policy", () => {
  it("rejects empty upload selections", () => {
    const result = validateKnowledgeUploadCandidates([])

    expect(result.valid).toBe(false)
    expect(result.errors).toContain("Select at least one document.")
  })

  it("rejects unsupported and oversized selections", () => {
    const result = validateKnowledgeUploadCandidates([
      { name: "one.txt", size: 1 },
      { name: "two.txt", size: 1 },
      { name: "three.txt", size: 1 },
      { name: "four.txt", size: 1 },
      { name: "five.txt", size: 1 },
      { name: "six.exe", size: 1 },
      { name: "large.pdf", size: MAX_KNOWLEDGE_UPLOAD_FILE_BYTES + 1 },
    ])

    expect(result.valid).toBe(false)
    expect(result.errors).toContain("Select at most 5 documents.")
    expect(result.errors).toContain("six.exe: Unsupported file type.")
    expect(result.errors).toContain("large.pdf: File exceeds 50.0 MB.")
  })

  it("accepts the governed corpus document formats", () => {
    const result = validateKnowledgeUploadCandidates([
      { name: "policy.pdf", size: 1 },
      { name: "handbook.docx", size: 1 },
      { name: "deck.pptx", size: 1 },
      { name: "notes.md", size: 1 },
      { name: "table.xlsx", size: 1 },
    ])

    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
  })

  it("accepts router milestone formats but rejects archives and old Office binaries", () => {
    const accepted = validateKnowledgeUploadCandidates([
      { name: "manual.odt", size: 1 },
      { name: "sheet.ods", size: 1 },
      { name: "slides.odp", size: 1 },
      { name: "email.eml", size: 1 },
      { name: "email.msg", size: 1 },
    ])
    const blocked = validateKnowledgeUploadCandidates([
      { name: "bundle.zip", size: 1 },
      { name: "legacy.doc", size: 1 },
      { name: "legacy.ppt", size: 1 },
      { name: "legacy.xls", size: 1 },
    ])

    expect(accepted.valid).toBe(true)
    expect(blocked.valid).toBe(false)
    expect(blocked.errors).toEqual([
      "bundle.zip: Unsupported file type.",
      "legacy.doc: Unsupported file type.",
      "legacy.ppt: Unsupported file type.",
      "legacy.xls: Unsupported file type.",
    ])
  })

  it("rejects more than five supported documents", () => {
    const result = validateKnowledgeUploadCandidates([
      { name: "one.md", size: 1 },
      { name: "two.txt", size: 1 },
      { name: "three.pdf", size: 1 },
      { name: "four.docx", size: 1 },
      { name: "five.csv", size: 1 },
      { name: "six.html", size: 1 },
      { name: "seven.png", size: 1 },
    ])

    expect(result.valid).toBe(false)
    expect(result.errors).toContain("Select at most 5 documents.")
  })
})
