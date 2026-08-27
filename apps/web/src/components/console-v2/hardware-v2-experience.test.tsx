import { adminHardwareResponseSchema } from "@llm-machines/contracts/inference-core"
import { cleanup, render, screen, within } from "@testing-library/react"
import React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { HardwareV2Experience } from "./hardware-v2-experience"

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
    React.createElement("a", { href: String(href), ...props }, children),
}))

vi.mock("./hardware-chart-primitives", () => ({
  HardwareChartPrimitive: ({ chart }: { chart: { title: string } }) =>
    React.createElement("div", null, `${chart.title} chart`),
}))

afterEach(() => {
  cleanup()
})

describe("HardwareV2Experience alerts", () => {
  it("shows an explicit not-configured state without deep links", () => {
    render(<HardwareV2Experience hardware={hardwareFixture()} />)

    expect(
      screen.getByRole("heading", { level: 1, name: "Hardware" }),
    ).toBeTruthy()
    expect(screen.queryByRole("navigation", { name: "Breadcrumb" })).toBeNull()
    expect(screen.getByText(/hardware signals that matter most/i)).toBeTruthy()
    const alerts = screen.getByRole("region", { name: "Active alerts" })
    expect(within(alerts).getByText("Not configured")).toBeTruthy()
    expect(
      within(alerts).getByText(
        "Alertmanager federation is not configured for this appliance.",
      ),
    ).toBeTruthy()
    expect(screen.queryByRole("link", { name: /Grafana/ })).toBeNull()
    expect(screen.queryByRole("link", { name: /Alertmanager/ })).toBeNull()
  })

  it("renders normalized firing alerts without inventing unavailable links", () => {
    render(
      <HardwareV2Experience
        hardware={hardwareFixture({
          activeAlerts: [
            {
              alertName: "GpuSaturation",
              alertmanagerUrl: null,
              description: null,
              device: null,
              grafanaUrl: null,
              host: null,
              id: "alert-1",
              labels: {
                alertname: "GpuSaturation",
                severity: "warning",
              },
              severity: "warning",
              startedAt: "2026-08-01T08:00:00.000Z",
              summary: "GPU saturation is high.",
            },
          ],
          alertSourceStatus: "degraded",
          sourceStatus: "degraded",
          summary: "Prometheus signals are partial and one alert is firing.",
        })}
      />,
    )

    const alerts = screen.getByRole("region", { name: "Active alerts" })
    expect(within(alerts).getByText("Degraded")).toBeTruthy()
    expect(
      within(alerts).getByRole("heading", { name: "GpuSaturation" }),
    ).toBeTruthy()
    expect(within(alerts).getByText("GPU saturation is high.")).toBeTruthy()
    expect(within(alerts).queryByRole("link")).toBeNull()
  })

  it("does not render unqualified native links", () => {
    render(
      <HardwareV2Experience
        hardware={hardwareFixture({
          activeAlerts: [
            {
              alertName: "InferenceFailures",
              alertmanagerUrl: null,
              description: null,
              device: null,
              grafanaUrl: null,
              host: null,
              id: "alert-1",
              labels: {},
              severity: "critical",
              startedAt: null,
              summary: "Inference failures are elevated.",
            },
          ],
          alertSourceStatus: "ok",
          alertmanagerUrl: null,
          grafanaUrl: null,
          sourceStatus: "degraded",
        })}
      />,
    )

    expect(
      screen.queryByRole("link", { name: /Grafana|Alertmanager/ }),
    ).toBeNull()
    expect(
      screen
        .getAllByRole("link")
        .every((link) => link.getAttribute("href")?.startsWith("/hardware")),
    ).toBe(true)
    expect(screen.queryByText(/Hardware metrics remain/)).toBeNull()
    expect(screen.queryByRole("link", { name: "Go to Grafana" })).toBeNull()
  })

  it("offers the validated Grafana destination as a visible tertiary action", () => {
    render(
      <HardwareV2Experience
        grafanaHref="https://grafana.example.test/"
        hardware={hardwareFixture()}
      />,
    )

    const link = screen.getByRole("link", { name: "Go to Grafana" })
    expect(link.getAttribute("href")).toBe("https://grafana.example.test/")
    expect(link.getAttribute("target")).toBe("_blank")
    expect(link.getAttribute("rel")).toBe("noopener noreferrer")
    expect(link.className).toContain("text-[#73cfff]")
  })
})

function hardwareFixture(overrides: Record<string, unknown> = {}) {
  return adminHardwareResponseSchema.parse({
    activeAlerts: [],
    alertSourceStatus: "not_configured",
    alertmanagerUrl: null,
    availableHosts: [],
    charts: chartFixtures(),
    generatedAt: "2026-08-01T08:00:00.000Z",
    grafanaUrl: null,
    range: "6h",
    selectedHost: "all",
    sourceStatus: "not_configured",
    step: "60s",
    summary: "Prometheus federation is not configured.",
    ...overrides,
  })
}

function chartFixtures() {
  return [
    ["cpu_utilization", "CPU utilization", "area", "percent"],
    ["gpu_temperature", "GPU temperature", "line", "celsius"],
    ["gpu_utilization", "GPU utilization", "area", "percent"],
    ["ram_usage", "RAM usage", "area", "percent"],
    ["filesystem_usage", "Filesystem usage", "bar", "percent"],
    ["power_draw", "Power draw", "area", "watt"],
    ["network_throughput", "Network throughput", "line", "bytes_per_second"],
  ].map(([id, title, chartType, unit]) => ({
    chartType,
    description: `${title} description`,
    emptyMessage: `${title} unavailable`,
    grafanaUrl: null,
    id,
    promql: `test_${id}`,
    series: [],
    sourceStatus: "not_configured",
    thresholds: [],
    title,
    unit,
  }))
}
