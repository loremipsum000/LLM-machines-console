import { render, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { TechnicalToolsPanel } from "./technical-tools-panel"

const adminTools = [
  {
    access: "Administrator access as Grafana Editor",
    description: "Explore appliance observability dashboards.",
    href: "https://grafana.example.test/",
    id: "grafana" as const,
    label: "Grafana",
  },
  {
    access: "Administrator access as proxy_admin",
    description: "Use native virtual keys.",
    href: "https://litellm.example.test/ui/",
    id: "litellm" as const,
    label: "LiteLLM",
  },
  {
    access: "Administrator access to the appliance realm",
    description: "Manage approved identity operations.",
    href: "https://keycloak.example.test/keycloak/admin/llm-machines/console/",
    id: "keycloak" as const,
    label: "Keycloak",
  },
]

describe("TechnicalToolsPanel", () => {
  it("renders only the server-filtered tools as credential-free external links", () => {
    render(<TechnicalToolsPanel tools={adminTools} />)

    const navigation = screen.getByRole("navigation", {
      name: "Advanced technical tools",
    })
    expect(within(navigation).getAllByRole("link")).toHaveLength(3)
    for (const tool of adminTools) {
      const link = within(navigation).getByRole("link", {
        name: `Open ${tool.label}`,
      })
      expect(link.getAttribute("href")).toBe(tool.href)
      expect(link.getAttribute("target")).toBe("_blank")
      expect(link.getAttribute("rel")).toBe("noopener noreferrer")
      expect(link.getAttribute("href")).not.toMatch(/[?#]|@/)
    }
    expect(screen.queryByText(/Portainer/i)).toBeNull()
  })

  it("keeps the Console and LiteLLM credential boundaries explicit", () => {
    render(<TechnicalToolsPanel tools={[adminTools[1]]} />)

    expect(
      screen.getByText(/Console Application credentials are the customer/),
    ).toBeTruthy()
    expect(screen.getByText(/separate advanced native capability/)).toBeTruthy()
    expect(screen.queryByText("Grafana")).toBeNull()
    expect(screen.queryByText("Keycloak")).toBeNull()
  })

  it("shows a non-link state when an authority is not safely configured", () => {
    render(<TechnicalToolsPanel tools={[{ ...adminTools[0], href: null }]} />)

    expect(screen.getByText("Not configured")).toBeTruthy()
    expect(screen.queryByRole("link")).toBeNull()
  })
})
