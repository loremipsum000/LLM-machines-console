import { cleanup, render, screen, within } from "@testing-library/react"
import React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  type ActivityFilters,
  ActivityV2Experience,
  type ActivityViewModel,
} from "./activity-v2-experience"

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    prefetch,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { prefetch?: boolean }) =>
    React.createElement(
      "a",
      {
        "data-prefetch": String(prefetch),
        href: String(href),
        ...props,
      },
      children,
    ),
}))

afterEach(() => {
  cleanup()
})

describe("ActivityV2Experience", () => {
  it("gives Admins filtered signed exports, cursor navigation, and event detail", () => {
    render(
      <ActivityV2Experience
        accessRole="admin"
        activity={activity}
        filters={{
          ...emptyFilters,
          applicationId: "app-1",
          eventId: "event-1",
          outcome: "succeeded",
          query: "rotate",
          source: "console",
        }}
      />,
    )

    expect(screen.getByText("Key identifier: app-1")).toBeTruthy()
    expect(screen.getByRole("searchbox").getAttribute("value")).toBe("rotate")
    expect(screen.getByRole("searchbox").getAttribute("placeholder")).toBe(
      "Event, action, subject, application, credential, or reason",
    )
    expect(
      screen
        .getByRole("option", { name: "Console audit" })
        .hasAttribute("selected"),
    ).toBe(true)

    const exportRegion = screen.getByRole("region", {
      name: "Signed audit export",
    })
    expect(
      within(exportRegion).getByRole("button", { name: "Export JSON" }),
    ).toBeTruthy()
    expect(
      within(exportRegion).getByRole("button", { name: "Export CSV" }),
    ).toBeTruthy()
    const verificationKeys = within(exportRegion).getByRole("link", {
      name: "Verification keys",
    })
    expect(verificationKeys.getAttribute("href")).toBe(
      "/api/admin/audit/export/verification-keys",
    )
    expect(verificationKeys.getAttribute("data-prefetch")).toBe("false")
    expect(
      exportRegion.querySelector<HTMLInputElement>('input[name="from"]')?.value,
    ).toBe("2026-07-02T08:01")
    expect(
      exportRegion.querySelector<HTMLInputElement>('input[name="to"]')?.value,
    ).toBe("2026-08-01T08:01")
    expect(
      exportRegion.querySelector<HTMLInputElement>(
        'input[name="applicationId"]',
      )?.value,
    ).toBe("app-1")
    expect(
      exportRegion.querySelector<HTMLInputElement>('input[name="eventId"]')
        ?.value,
    ).toBe("event-1")

    const detail = screen.getByRole("region", { name: "Event detail" })
    expect(within(detail).getByText("credential-1")).toBeTruthy()
    expect(within(detail).getByText("applicationId")).toBeTruthy()
    expect(within(detail).getByText("app-1")).toBeTruthy()

    expect(
      screen
        .getByRole("link", { name: "Load older events" })
        .getAttribute("href"),
    ).toBe(
      "/activity?q=rotate&applicationId=app-1&source=console&outcome=succeeded&cursor=cursor-2",
    )
  })

  it("keeps Operator viewing and filtering while removing export controls", () => {
    render(
      <ActivityV2Experience
        accessRole="operator"
        activity={{ ...activity, nextCursor: null }}
        filters={emptyFilters}
      />,
    )

    expect(screen.getByRole("button", { name: "Apply filters" })).toBeTruthy()
    expect(
      screen.getByText("console.application.credential.rotate"),
    ).toBeTruthy()
    expect(screen.getByText(/Signed exports require Admin access/)).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Export JSON" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Export CSV" })).toBeNull()
    expect(screen.queryByRole("link", { name: "Verification keys" })).toBeNull()
  })

  it("renders explicit source health without inventing native audit availability", () => {
    render(
      <ActivityV2Experience
        accessRole="operator"
        activity={{
          ...activity,
          events: [],
          sourceStatus: "degraded",
          sources: [
            {
              cursorHealth: "not_applicable",
              id: "console",
              ingressReadiness: "not_applicable",
              label: "Console audit",
              lastAttemptAt: null,
              lastErrorCode: null,
              lastEventAt: "2026-08-01T08:00:00.000Z",
              lastSuccessAt: null,
              sourceStatus: "ok",
            },
            {
              cursorHealth: "never_run",
              id: "grafana",
              ingressReadiness: "implemented_pending_runtime_qualification",
              label: "Grafana audit",
              lastAttemptAt: null,
              lastErrorCode: null,
              lastEventAt: null,
              lastSuccessAt: null,
              sourceStatus: "not_configured",
            },
          ],
        }}
        filters={emptyFilters}
      />,
    )

    const health = screen.getByRole("region", { name: "Audit source health" })
    expect(within(health).getByText("Degraded")).toBeTruthy()
    expect(within(health).getByText("Grafana audit")).toBeTruthy()
    expect(within(health).getByText("Not configured")).toBeTruthy()
    expect(
      within(health).getByText(/runtime qualification pending/),
    ).toBeTruthy()
    expect(
      screen.getByText("No audit events match the current filters."),
    ).toBeTruthy()
  })
})

const emptyFilters: ActivityFilters = {
  applicationId: null,
  cursor: null,
  eventId: null,
  limit: null,
  outcome: null,
  query: null,
  severity: null,
  source: null,
}

const activity: ActivityViewModel = {
  events: [
    {
      action: "console.application.credential.rotate",
      actorId: "subject-admin-1",
      createdAt: "2026-08-01T08:00:00.000Z",
      href: "/activity?eventId=event-1",
      id: "event-1",
      metadata: [
        { label: "applicationId", value: "app-1" },
        { label: "credentialRecordId", value: "credential-1" },
      ],
      outcome: "succeeded",
      reason: null,
      severity: "info",
      sourceSystem: "console",
      targetId: "credential-1",
      targetType: "application_credential",
    },
  ],
  generatedAt: "2026-08-01T08:01:00.000Z",
  nextCursor: "cursor-2",
  sourceStatus: "degraded",
  sources: [
    {
      cursorHealth: "not_applicable",
      id: "console",
      ingressReadiness: "not_applicable",
      label: "Console audit",
      lastAttemptAt: null,
      lastErrorCode: null,
      lastEventAt: "2026-08-01T08:00:00.000Z",
      lastSuccessAt: null,
      sourceStatus: "ok",
    },
    {
      cursorHealth: "never_run",
      id: "keycloak",
      ingressReadiness: "implemented_pending_runtime_qualification",
      label: "Keycloak audit",
      lastAttemptAt: null,
      lastErrorCode: null,
      lastEventAt: null,
      lastSuccessAt: null,
      sourceStatus: "not_configured",
    },
  ],
}
