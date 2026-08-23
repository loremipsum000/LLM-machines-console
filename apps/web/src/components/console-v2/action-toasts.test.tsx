import { render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { ConsoleActionToasts } from "./action-toasts"

describe("ConsoleActionToasts", () => {
  it("renders stacked action notifications with the 5 second lifecycle animation", () => {
    render(
      <ConsoleActionToasts
        notifications={[
          {
            description: "Key disabled.",
            id: "application-action-disabled",
            title: "Keys",
            tone: "danger",
          },
          {
            description: "Connection test failed.",
            id: "application-test-failed",
            title: "Connection test",
            tone: "danger",
          },
        ]}
      />,
    )

    expect(screen.getByLabelText("Action notifications")).toBeTruthy()
    expect(screen.getByText("Keys")).toBeTruthy()
    expect(screen.getByText("Key disabled.")).toBeTruthy()
    expect(screen.getByText("Connection test")).toBeTruthy()
    expect(screen.getByText("Connection test failed.")).toBeTruthy()
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
            description: "Organization updated.",
            id: "settings-action-organization-updated",
            title: "Settings",
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
      "/keys?view=overview&appAction=failed&settingsAction=saved&q=status",
    )

    render(
      <ConsoleActionToasts
        notifications={[
          {
            description: "Action failed.",
            id: "application-action-failed",
            title: "Keys",
            tone: "danger",
          },
        ]}
      />,
    )

    await waitFor(() => {
      expect(window.location.search).toBe("?view=overview&q=status")
    })
  })
})
