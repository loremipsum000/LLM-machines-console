import { adminOverviewResponseSchema } from "@llm-machines/contracts/inference-core"
import { cleanup, render, screen, within } from "@testing-library/react"
import { axe } from "jest-axe"
import React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { OverviewV2Experience } from "./overview-v2-experience"

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
    React.createElement("a", { href: String(href), ...props }, children),
}))

afterEach(() => {
  cleanup()
})

describe("OverviewV2Experience", () => {
  it("renders the four source-backed previews and metadata-only activity", () => {
    render(<OverviewV2Experience overview={overviewFixture()} />)

    const region = screen.getByRole("region", { name: "Operational overview" })
    expect(within(region).getAllByRole("article")).toHaveLength(4)
    expect(
      screen
        .getByRole("link", { name: "Open Applications" })
        .getAttribute("href"),
    ).toBe("/applications")
    expect(screen.getByText("1,250")).toBeTruthy()
    expect(screen.getByText("qwen-local")).toBeTruthy()
    expect(screen.getByText("7/8")).toBeTruthy()
    expect(
      within(screen.getByRole("article", { name: "System" })).getByText(
        "Unavailable",
      ),
    ).toBeTruthy()

    const activity = screen.getByRole("region", { name: "Recent activity" })
    expect(
      within(activity).getByText("console.application.credential.rotated"),
    ).toBeTruthy()
    expect(within(activity).getByText("Subject admin-1")).toBeTruthy()
    expect(
      within(activity)
        .getByRole("link", { name: "View Activity & Audit" })
        .getAttribute("href"),
    ).toBe("/activity")
  })

  it("shows unavailable source and audit states without fabricated values", () => {
    const overview = overviewFixture()
    overview.tiles = overview.tiles.map((tile) => ({
      ...tile,
      metrics: tile.metrics.map((item) => ({
        ...item,
        tone: "warning",
        value: "Unavailable",
      })),
      sourceStatus: tile.id === "system" ? "degraded" : "unavailable",
      summary: `${tile.title} source is unavailable.`,
    }))
    overview.activityEvents = []
    overview.activitySourceStatus = "unavailable"

    render(<OverviewV2Experience overview={overview} />)

    expect(screen.getAllByText("Unavailable").length).toBeGreaterThan(4)
    expect(
      screen.getByText("Recent audit activity is unavailable."),
    ).toBeTruthy()
    expect(
      screen.queryByText("No recent audit activity has been recorded."),
    ).toBeNull()
  })

  it("has no automated accessibility violations", async () => {
    const { container } = render(
      <OverviewV2Experience overview={overviewFixture()} />,
    )

    expect((await axe(container)).violations).toEqual([])
  })
})

function overviewFixture() {
  const generatedAt = "2026-08-02T09:30:00.000Z"
  return adminOverviewResponseSchema.parse({
    activityEvents: [
      {
        action: "console.application.credential.rotated",
        actorId: "admin-1",
        createdAt: "2026-08-02T09:20:00.000Z",
        href: "/activity?eventId=event-1",
        id: "event-1",
        severity: "info",
        targetId: "credential-1",
        targetType: "application_credential",
      },
    ],
    activitySourceStatus: "ok",
    generatedAt,
    tiles: [
      tileFixture("applications", "Applications", "/applications", [
        metricFixture("applications", "Applications", "2"),
        metricFixture("connected", "Connected", "1"),
      ]),
      tileFixture("inference", "Inference", "/inference", [
        metricFixture("requests", "Requests", "1,250"),
        metricFixture("top-model", "Top model", "qwen-local"),
      ]),
      tileFixture("hardware", "Hardware", "/hardware", [
        metricFixture("targets", "Targets up", "7/8"),
        metricFixture("alerts", "Alerts", "1", "warning"),
      ]),
      tileFixture("system", "System", "/activity", [
        metricFixture(
          "system-status",
          "System status",
          "Needs attention",
          "warning",
        ),
        metricFixture("update-status", "Update status", "Unavailable"),
      ]),
    ],
  })
}

function tileFixture(
  id: "applications" | "hardware" | "inference" | "system",
  title: string,
  href: string,
  metrics: ReturnType<typeof metricFixture>[],
) {
  return {
    href,
    id,
    metrics,
    sourceStatus: id === "hardware" || id === "system" ? "degraded" : "ok",
    summary: `${title} source preview.`,
    title,
    updatedAt: "2026-08-02T09:30:00.000Z",
  }
}

function metricFixture(
  id: string,
  label: string,
  value: string,
  tone: "neutral" | "warning" = "neutral",
) {
  return {
    detail: "Authentic BFF source",
    id,
    label,
    tone,
    value,
  }
}
