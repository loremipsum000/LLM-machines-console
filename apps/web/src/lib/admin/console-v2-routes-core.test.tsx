import { cleanup, render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  renderInferenceConsoleRoute,
  renderOverviewConsoleRoute,
  renderSettingsConsoleRoute,
} from "./console-v2-routes-core"

function activeConsoleSession(role: "admin" | "operator") {
  return {
    session: {
      groups: [],
      mfaVerifiedAt: null,
      role,
      subject: `${role}-1`,
    },
    sessionHandle: "A".repeat(43),
    state: "active",
  } as const
}

const mocks = vi.hoisted(() => ({
  getAdminOverview: vi.fn(),
  getAdminInference: vi.fn(),
  getAdminSettings: vi.fn(),
  getCurrentConsoleSession: vi.fn(),
  isConsoleBffAuthExpiredError: vi.fn((_error: unknown) => false),
  isConsoleBffUnavailableError: vi.fn((_error: unknown) => false),
  notFound: vi.fn(() => {
    throw new Error("not-found")
  }),
  redirect: vi.fn((href: string) => {
    throw new Error(`redirect:${href}`)
  }),
}))

vi.mock("next/navigation", () => ({
  notFound: mocks.notFound,
  redirect: mocks.redirect,
}))

vi.mock("@/lib/auth/session", () => ({
  getCurrentConsoleSession: mocks.getCurrentConsoleSession,
}))

vi.mock("@/lib/admin/server-data-core", () => ({
  getAdminAudit: vi.fn(),
  getAdminConnectedAppDetail: vi.fn(),
  getAdminConnectedApps: vi.fn(),
  getAdminHardware: vi.fn(),
  getAdminInference: mocks.getAdminInference,
  getAdminOverview: mocks.getAdminOverview,
  getAdminSettings: mocks.getAdminSettings,
  getAdminTeamGroupDetail: vi.fn(),
  getAdminTeamMemberDetail: vi.fn(),
  getAdminTeamOverview: vi.fn(),
  isConsoleBffAuthExpiredError: mocks.isConsoleBffAuthExpiredError,
  isConsoleBffUnavailableError: mocks.isConsoleBffUnavailableError,
}))

vi.mock("@/components/console-v2/activity-v2-experience", () => ({
  ActivityV2Experience: vi.fn(),
}))

vi.mock("@/components/console-v2/applications-v2-experience", () => ({
  ApplicationsV2Experience: vi.fn(),
}))

vi.mock("@/components/console-v2/console-unavailable-panel", () => ({
  ConsoleUnavailablePanel: vi.fn(),
}))

vi.mock("@/components/console-v2/console-v2-sections", () => ({
  roleCanAccessConsoleSection: vi.fn(() => true),
}))

vi.mock("@/components/console-v2/hardware-v2-experience", () => ({
  HardwareV2Experience: vi.fn(),
}))

vi.mock("@/components/console-v2/inference-v2-experience", () => ({
  InferenceV2Experience: vi.fn(),
}))

vi.mock("@/components/console-v2/settings-v2-experience", () => ({
  SettingsV2Experience: ({
    accessRole,
    settingsAction,
  }: {
    accessRole: string
    settingsAction?: string
  }) => (
    <div>
      Settings role {accessRole}
      {settingsAction ? ` action ${settingsAction}` : ""}
    </div>
  ),
}))

vi.mock("@/components/console-v2/team-v2-experience", () => ({
  TeamV2Experience: vi.fn(),
}))

vi.mock("@/components/console-v2/console-v2-shell", () => ({
  ConsoleV2Shell: ({
    accessRole,
    activeSection,
    children,
  }: {
    accessRole: string
    activeSection: string
    children: ReactNode
  }) => (
    <div data-active-section={activeSection} data-access-role={accessRole}>
      {children}
    </div>
  ),
}))

vi.mock("@/components/console-v2/overview-v2-experience", () => ({
  OverviewV2Experience: ({
    overview,
  }: {
    overview: { generatedAt: string }
  }) => <div>Overview generated {overview.generatedAt}</div>,
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("Overview Console route", () => {
  it("renders the source-backed Overview inside the retained shell", async () => {
    mocks.getCurrentConsoleSession.mockResolvedValue(
      activeConsoleSession("operator"),
    )
    mocks.getAdminOverview.mockResolvedValue({
      activityEvents: [],
      activitySourceStatus: "ok",
      generatedAt: "2026-08-02T09:30:00.000Z",
      tiles: [],
    })

    render(await renderOverviewConsoleRoute())

    expect(mocks.getAdminOverview).toHaveBeenCalledOnce()
    expect(
      screen.getByText("Overview generated 2026-08-02T09:30:00.000Z"),
    ).toBeTruthy()
    expect(
      screen.getByText(/Overview generated/).parentElement?.dataset,
    ).toMatchObject({
      accessRole: "operator",
      activeSection: "overview",
    })
  })

  it("uses the root route as the Overview reauthentication target", async () => {
    mocks.getCurrentConsoleSession.mockResolvedValue({
      reason: "expired",
      state: "terminal",
    })

    await expect(renderOverviewConsoleRoute()).rejects.toThrow(
      "redirect:/auth/signin?session=expired&returnTo=%2F",
    )
    expect(mocks.redirect).toHaveBeenCalledWith(
      "/auth/signin?session=expired&returnTo=%2F",
    )
    expect(mocks.getAdminOverview).not.toHaveBeenCalled()
  })

  it("routes a retryable identity outage to the controlled unavailable page", async () => {
    mocks.getCurrentConsoleSession.mockResolvedValue({
      reason: "identity_unavailable",
      retryable: true,
      state: "unavailable",
    })

    await expect(renderOverviewConsoleRoute()).rejects.toThrow(
      "redirect:/auth/unavailable?returnTo=%2F",
    )
    expect(mocks.redirect).toHaveBeenCalledWith(
      "/auth/unavailable?returnTo=%2F",
    )
    expect(mocks.getAdminOverview).not.toHaveBeenCalled()
  })

  it("redirects a later terminal BFF transition once to expired sign-in", async () => {
    const terminalError = new Error("terminal session transition")
    mocks.getCurrentConsoleSession.mockResolvedValue(
      activeConsoleSession("operator"),
    )
    mocks.getAdminOverview.mockRejectedValue(terminalError)
    mocks.isConsoleBffAuthExpiredError.mockImplementation(
      (error) => error === terminalError,
    )

    await expect(renderOverviewConsoleRoute()).rejects.toThrow(
      "redirect:/auth/signin?session=expired&returnTo=%2F",
    )
    expect(mocks.redirect).toHaveBeenCalledOnce()
    expect(mocks.redirect).toHaveBeenCalledWith(
      "/auth/signin?session=expired&returnTo=%2F",
    )
  })

  it("routes a later retryable BFF transition without logging out", async () => {
    const unavailableError = new Error("retryable session transition")
    mocks.getCurrentConsoleSession.mockResolvedValue(
      activeConsoleSession("operator"),
    )
    mocks.getAdminOverview.mockRejectedValue(unavailableError)
    mocks.isConsoleBffUnavailableError.mockImplementation(
      (error) => error === unavailableError,
    )

    await expect(renderOverviewConsoleRoute()).rejects.toThrow(
      "redirect:/auth/unavailable?returnTo=%2F",
    )
    expect(mocks.redirect).toHaveBeenCalledOnce()
    expect(mocks.redirect).toHaveBeenCalledWith(
      "/auth/unavailable?returnTo=%2F",
    )
  })
})

describe("retained route boundaries", () => {
  it("rejects the retired nested Inference update route", async () => {
    mocks.getCurrentConsoleSession.mockResolvedValue({
      reason: "absent",
      state: "terminal",
    })

    await expect(
      renderInferenceConsoleRoute({ section: ["model-update"] }),
    ).rejects.toThrow("not-found")
    expect(mocks.notFound).toHaveBeenCalledOnce()
    expect(mocks.getCurrentConsoleSession).not.toHaveBeenCalled()
    expect(mocks.redirect).not.toHaveBeenCalled()
    expect(mocks.getAdminInference).not.toHaveBeenCalled()
  })

  it("passes Operator authority into the read-only Settings surface", async () => {
    mocks.getCurrentConsoleSession.mockResolvedValue(
      activeConsoleSession("operator"),
    )
    mocks.getAdminSettings.mockResolvedValue({ generatedAt: "test" })

    render(
      await renderSettingsConsoleRoute(
        Promise.resolve({ settingsAction: "organizationSaved" }),
      ),
    )

    expect(screen.getByText("Settings role operator")).toBeTruthy()
    expect(screen.queryByText(/organizationSaved/)).toBeNull()
    expect(mocks.getAdminSettings).toHaveBeenCalledOnce()
  })

  it("keeps the Admin post-redirect Settings notice", async () => {
    mocks.getCurrentConsoleSession.mockResolvedValue(
      activeConsoleSession("admin"),
    )
    mocks.getAdminSettings.mockResolvedValue({ generatedAt: "test" })

    render(
      await renderSettingsConsoleRoute(
        Promise.resolve({ settingsAction: "organizationSaved" }),
      ),
    )

    expect(
      screen.getByText("Settings role admin action organizationSaved"),
    ).toBeTruthy()
  })
})
