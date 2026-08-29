import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { axe } from "jest-axe"
import { afterEach, describe, expect, it } from "vitest"
import { TokenUsageGrid, buildUsageCalendar } from "./token-usage-grid"

afterEach(() => {
  cleanup()
})

describe("TokenUsageGrid", () => {
  it("renders exactly 90 UTC days with relative blue intensity", () => {
    const { container } = render(
      <TokenUsageGrid
        generatedAt="2026-08-02T09:30:00.000Z"
        usage={{
          points: [
            { date: "2026-07-31", tokens: 250 },
            { date: "2026-08-01", tokens: 12_500 },
          ],
          range: "90d",
          sourceStatus: "ok",
        }}
      />,
    )

    expect(container.querySelectorAll("[data-date]")).toHaveLength(90)
    expect(
      container
        .querySelector('[data-date="2026-08-01"]')
        ?.getAttribute("data-level"),
    ).toBe("4")
    expect(
      container
        .querySelector('[data-date="2026-07-30"]')
        ?.getAttribute("title"),
    ).toBe("No token usage reported on Jul 30, 2026 UTC")
    expect(
      container
        .querySelector('[data-date="2026-08-01"]')
        ?.getAttribute("title"),
    ).toBe("12,500 tokens on Aug 1, 2026 UTC")
  })

  it("updates the exact-day detail on hover and keyboard navigation", () => {
    const { container } = render(
      <TokenUsageGrid
        generatedAt="2026-08-02T09:30:00.000Z"
        usage={{
          points: [{ date: "2026-07-31", tokens: 250 }],
          range: "90d",
          sourceStatus: "ok",
        }}
      />,
    )

    fireEvent.mouseEnter(
      container.querySelector('[data-date="2026-07-31"]') as Element,
    )
    expect(screen.getByText("250 tokens on Jul 31, 2026 UTC")).toBeTruthy()

    const group = screen.getByRole("group", {
      name: /Daily token usage for the last 90 days/,
    })
    const selectedDay = screen.getByRole("button", {
      name: "250 tokens on Jul 31, 2026 UTC",
    })
    expect(selectedDay.getAttribute("aria-pressed")).toBe("true")
    expect(group.querySelectorAll('button[tabindex="0"]')).toHaveLength(1)
    fireEvent.keyDown(selectedDay, { key: "End" })
    fireEvent.keyDown(
      screen.getByRole("button", {
        name: "No token usage reported on Aug 2, 2026 UTC",
      }),
      { key: "ArrowUp" },
    )
    expect(
      screen
        .getByRole("button", {
          name: "No token usage reported on Aug 1, 2026 UTC",
        })
        .getAttribute("aria-pressed"),
    ).toBe("true")
    expect(
      screen.getByText("No token usage reported on Aug 1, 2026 UTC"),
    ).toBeTruthy()
  })

  it("fails visibly closed when the usage source is unavailable", () => {
    render(
      <TokenUsageGrid
        generatedAt="2026-08-02T09:30:00.000Z"
        usage={{ points: [], range: "90d", sourceStatus: "unavailable" }}
      />,
    )

    expect(
      screen.getByText("Token usage is temporarily unavailable."),
    ).toBeTruthy()
    expect(
      screen.queryByRole("group", {
        name: /Daily token usage for the last 90 days/,
      }),
    ).toBeNull()
  })

  it("ignores points outside the displayed period when scaling intensity", () => {
    const calendar = buildUsageCalendar("2026-08-02T09:30:00.000Z", [
      { date: "2025-01-01", tokens: 1_000_000 },
      { date: "2026-08-01", tokens: 100 },
    ])

    expect(
      calendar.rangeDays.find(({ date }) => date === "2026-08-01")?.level,
    ).toBe(4)
  })

  it("has no automated accessibility violations", async () => {
    const { container } = render(
      <TokenUsageGrid
        generatedAt="2026-08-02T09:30:00.000Z"
        usage={{
          points: [{ date: "2026-08-01", tokens: 100 }],
          range: "90d",
          sourceStatus: "ok",
        }}
      />,
    )

    expect((await axe(container)).violations).toEqual([])
  })
})
