import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { hubArtifacts, hubResources, hubTasks } from "@/lib/hub/mock-data"
import { CommandPalette } from "./command-palette"

describe("CommandPalette", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("loads permitted results from the same-origin Hub search route", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      Response.json([
        {
          id: "internal-docs",
          type: "resource",
          title: "Internal Docs",
          description: "Server-filtered connector result",
          href: "/resources/mcp_connector/internal-docs",
          rank: 1,
        },
      ]),
    )

    renderWithQuery(
      <CommandPalette
        artifacts={hubArtifacts}
        resources={hubResources}
        tasks={hubTasks}
      />,
    )

    const input = screen.getByLabelText("Command palette search")
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: "internal" } })

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/hub/search?q=internal",
        expect.objectContaining({
          cache: "no-store",
        }),
      )
    })
    expect(await screen.findByText("Internal Docs")).toBeTruthy()
    expect(screen.getByText("Server-filtered connector result")).toBeTruthy()
  })

  it("focuses and selects the search input on Command+K", () => {
    renderWithQuery(
      <CommandPalette
        artifacts={hubArtifacts}
        resources={hubResources}
        tasks={hubTasks}
      />,
    )

    const input = screen.getByLabelText(
      "Command palette search",
    ) as HTMLInputElement
    fireEvent.change(input, { target: { value: "agent" } })
    input.blur()

    fireEvent.keyDown(window, { key: "k", metaKey: true })

    expect(document.activeElement).toBe(input)
    expect(input.selectionStart).toBe(0)
    expect(input.selectionEnd).toBe("agent".length)
  })
})

function renderWithQuery(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  )
}
