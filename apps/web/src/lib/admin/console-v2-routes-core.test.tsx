import { cleanup, render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  renderInferenceConsoleRoute,
  renderOverviewConsoleRoute,
  renderSettingsConsoleRoute,
} from "./console-v2-routes-core"

const mocks = vi.hoisted(() => ({
  getAdminOverview: vi.fn(),
  getAdminInference: vi.fn(),
  getAdminSettings: vi.fn(),
  getCurrentConsoleRole: vi.fn(),
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
  getCurrentConsoleRole: mocks.getCurrentConsoleRole,
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
  isConsoleBffAuthExpiredError: vi.fn(() => false),
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
    mocks.getCurrentConsoleRole.mockResolvedValue("operator")
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
    mocks.getCurrentConsoleRole.mockResolvedValue(null)

    await expect(renderOverviewConsoleRoute()).rejects.toThrow(
      "redirect:/auth/keycloak?redirectTo=%2F",
    )
    expect(mocks.redirect).toHaveBeenCalledWith("/auth/keycloak?redirectTo=%2F")
    expect(mocks.getAdminOverview).not.toHaveBeenCalled()
  })
})

describe("retained route boundaries", () => {
  it("rejects the retired nested Inference update route", async () => {
    mocks.getCurrentConsoleRole.mockResolvedValue(null)

    await expect(
      renderInferenceConsoleRoute({ section: ["model-update"] }),
    ).rejects.toThrow("not-found")
    expect(mocks.notFound).toHaveBeenCalledOnce()
    expect(mocks.getCurrentConsoleRole).not.toHaveBeenCalled()
    expect(mocks.redirect).not.toHaveBeenCalled()
    expect(mocks.getAdminInference).not.toHaveBeenCalled()
  })

  it("passes Operator authority into the read-only Settings surface", async () => {
    mocks.getCurrentConsoleRole.mockResolvedValue("operator")
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
    mocks.getCurrentConsoleRole.mockResolvedValue("admin")
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
