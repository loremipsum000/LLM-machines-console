import { render, screen } from "@testing-library/react"
import React from "react"
import { describe, expect, it, vi } from "vitest"
import { AuditEvidencePanel } from "./audit-evidence-panel"

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    prefetch: _prefetch,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { prefetch?: boolean }) =>
    React.createElement("a", { href: String(href), ...props }, children),
}))

describe("AuditEvidencePanel", () => {
  it("keeps signed audit evidence available to Admin from Settings", () => {
    const { container } = render(
      <AuditEvidencePanel
        accessRole="admin"
        generatedAt="2026-08-28T12:30:00.000Z"
      />,
    )

    expect(
      screen
        .getByRole("link", { name: "Verification keys" })
        .getAttribute("href"),
    ).toBe("/api/admin/audit/export/verification-keys")
    expect(screen.getByRole("button", { name: "Export JSON" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Export CSV" })).toBeTruthy()
    const form = container.querySelector("form")
    expect(form?.getAttribute("action")).toBe("/api/admin/audit/export")
    expect(
      (screen.getByLabelText("From (UTC)") as HTMLInputElement).defaultValue,
    ).toBe("2026-07-29T12:30")
    expect(
      (screen.getByLabelText("To (UTC)") as HTMLInputElement).defaultValue,
    ).toBe("2026-08-28T12:30")
  })

  it("keeps Operator informed without exposing export controls", () => {
    render(
      <AuditEvidencePanel
        accessRole="operator"
        generatedAt="2026-08-28T12:30:00.000Z"
      />,
    )

    expect(screen.getByRole("heading", { name: "Audit evidence" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: /Export/ })).toBeNull()
    expect(screen.queryByRole("link", { name: "Verification keys" })).toBeNull()
    expect(screen.getByText(/require Admin access/)).toBeTruthy()
  })
})
