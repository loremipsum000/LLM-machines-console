import { render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { ConsoleActionToasts } from "./action-toasts"

describe("ConsoleActionToasts", () => {
  it("renders stacked action notifications with the 5 second lifecycle animation", () => {
    render(
      <ConsoleActionToasts
        notifications={[
          {
            description: "Corpus deleted.",
            id: "knowledge-action-hardDeleted",
            title: "Knowledge",
            tone: "danger",
          },
          {
            description: "0 added, 1 failed.",
            id: "knowledge-upload-uploaded-0-failed-1",
            title: "Document upload",
            tone: "danger",
          },
        ]}
      />,
    )

    expect(screen.getByLabelText("Action notifications")).toBeTruthy()
    expect(screen.getByText("Knowledge")).toBeTruthy()
    expect(screen.getByText("Corpus deleted.")).toBeTruthy()
    expect(screen.getByText("Document upload")).toBeTruthy()
    expect(screen.getByText("0 added, 1 failed.")).toBeTruthy()
    expect(screen.getAllByRole("alert")).toHaveLength(2)
    const style = screen.getAllByRole("alert")[0]?.getAttribute("style")
    expect(style).toContain("animation-duration: 5320ms")
    expect(style).toContain("animation-name: console-action-toast-lifecycle")
  })

  it("uses polite status announcements for non-danger notifications", () => {
    render(
      <ConsoleActionToasts
        notifications={[
          {
            description: "Permissions updated.",
            id: "knowledge-action-permissionsUpdated",
            title: "Knowledge",
            tone: "success",
          },
        ]}
      />,
    )

    expect(screen.getByRole("status")).toBeTruthy()
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("clears one-time action query params without losing page state", async () => {
    window.history.pushState(
      {},
      "",
      "/admin/knowledge?corpus=corpus-1&view=edit-sources&knowledgeAction=failed&knowledgeUpload=uploaded-0-failed-1&q=sonic",
    )

    render(
      <ConsoleActionToasts
        notifications={[
          {
            description: "Action failed.",
            id: "knowledge-action-failed",
            title: "Knowledge",
            tone: "danger",
          },
        ]}
      />,
    )

    await waitFor(() => {
      expect(window.location.search).toBe(
        "?corpus=corpus-1&view=edit-sources&q=sonic",
      )
    })
  })
})
