import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { AuditEvidencePanel } from "./audit-evidence-panel"

describe("AuditEvidencePanel", () => {
  it("offers Admin one signed metadata-only JSON export for 30 days", () => {
    const { container } = render(
      <AuditEvidencePanel
        accessRole="admin"
        generatedAt="2026-08-28T12:30:00.000Z"
      />,
    )

    expect(
      screen.getByRole("button", { name: "Export last 30 days" }),
    ).toBeTruthy()
    expect(screen.getAllByRole("button")).toHaveLength(1)
    expect(screen.queryByRole("link")).toBeNull()

    const form = container.querySelector("form")
    expect(form?.getAttribute("action")).toBe("/api/admin/audit/export")
    expect(form?.getAttribute("method")).toBe("get")
    expect(hiddenValue(form, "format")).toBe("json")
    expect(hiddenValue(form, "from")).toBe("2026-07-29T12:30:00.000Z")
    expect(hiddenValue(form, "to")).toBe("2026-08-28T12:30:00.000Z")
  })

  it("renders no audit export surface for Operator", () => {
    const { container } = render(
      <AuditEvidencePanel
        accessRole="operator"
        generatedAt="2026-08-28T12:30:00.000Z"
      />,
    )

    expect(container.childElementCount).toBe(0)
    expect(screen.queryByRole("button", { name: /Export/ })).toBeNull()
  })
})

function hiddenValue(
  form: HTMLFormElement | null,
  name: string,
): string | null {
  return (
    form
      ?.querySelector<HTMLInputElement>(`input[name="${name}"]`)
      ?.getAttribute("value") ?? null
  )
}
