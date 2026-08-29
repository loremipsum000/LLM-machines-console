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
  it("renders a 90-day token grid and four full-width operational cards", () => {
    render(<OverviewV2Experience overview={overviewFixture()} />)

    expect(screen.queryByText("Recent activity")).toBeNull()
    expect(
      screen.getByRole("group", {
        name: /Daily token usage for the last 90 days/,
      }),
    ).toBeTruthy()
    expect(screen.getByText("Last 90 days · UTC")).toBeTruthy()
    expect(
      screen.getByText(/No prompts or responses are retained/),
    ).toBeTruthy()

    const region = screen.getByRole("region", { name: "Operational overview" })
    const cards = within(region).getAllByRole("article")
    expect(cards).toHaveLength(4)
    expect(region.className).not.toContain("sm:grid-cols-2")
    expect(cards.every((card) => card.className.includes("w-full"))).toBe(true)
    expect(
      screen.getByRole("link", { name: "Open Keys" }).getAttribute("href"),
    ).toBe("/keys")
    expect(screen.getByText("1,250")).toBeTruthy()
    expect(screen.getByText("qwen-local")).toBeTruthy()
    expect(screen.getByText("7/8")).toBeTruthy()
    expect(
      within(screen.getByRole("article", { name: "System" })).getByText(
        "Unavailable",
      ),
    ).toBeTruthy()
  })

  it("shows unavailable sources without fabricated values or usage cells", () => {
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
    overview.tokenUsage = {
      points: [],
      range: "90d",
      sourceStatus: "unavailable",
    }

    render(<OverviewV2Experience overview={overview} />)

    expect(screen.getAllByText("Unavailable").length).toBeGreaterThan(4)
    expect(
      screen.getByText("Token usage is temporarily unavailable."),
    ).toBeTruthy()
    expect(
      screen.queryByRole("group", {
        name: /Daily token usage for the last 90 days/,
      }),
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
    generatedAt,
    tiles: [
      tileFixture("applications", "Keys", "/keys", [
        metricFixture("applications", "Keys", "2"),
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
      tileFixture("system", "System", "/settings", [
        metricFixture(
          "system-status",
          "System status",
          "Needs attention",
          "warning",
        ),
        metricFixture("update-status", "Update status", "Unavailable"),
      ]),
    ],
    tokenUsage: {
      points: [
        { date: "2026-07-31", tokens: 250 },
        { date: "2026-08-01", tokens: 12_500 },
      ],
      range: "90d",
      sourceStatus: "ok",
    },
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
