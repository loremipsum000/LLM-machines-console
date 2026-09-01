import { cleanup, render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  renderApplicationsConsoleRoute,
  renderHardwareConsoleRoute,
  renderInferenceConsoleRoute,
  renderSettingsConsoleRoute,
} from "./console-v2-routes-core"
import type { TechnicalToolLink } from "./technical-tools"

function activeConsoleSession(
  role: "admin" | "operator",
  mfaVerifiedAt: string | null = null,
) {
  return {
    session: {
      groups: [],
      mfaVerifiedAt,
      role,
      subject: `${role}-1`,
    },
    sessionHandle: "A".repeat(43),
    state: "active",
  } as const
}

function technicalToolLink(id: TechnicalToolLink["id"]): TechnicalToolLink {
  return {
    access: `${id} access`,
    description: `${id} description`,
    href: `https://${id}.example.test/`,
    id,
    label: id,
  }
}

const mocks = vi.hoisted(() => ({
  applicationsV2Experience: vi.fn(() => null),
  hardwareV2Experience: vi.fn(() => null),
  getAdminHardware: vi.fn(),
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
  technicalToolsForRole: vi.fn(
    (_role: "admin" | "operator"): TechnicalToolLink[] => [],
  ),
}))

vi.mock("next/navigation", () => ({
  notFound: mocks.notFound,
  redirect: mocks.redirect,
}))

vi.mock("@/lib/auth/session", () => ({
  getCurrentConsoleSession: mocks.getCurrentConsoleSession,
}))

vi.mock("@/lib/admin/server-data-core", () => ({
  getAdminConnectedAppDetail: vi.fn(),
  getAdminConnectedApps: vi.fn(),
  getAdminHardware: mocks.getAdminHardware,
  getAdminInference: mocks.getAdminInference,
  getAdminSettings: mocks.getAdminSettings,
  getAdminTeamGroupDetail: vi.fn(),
  getAdminTeamMemberDetail: vi.fn(),
  getAdminTeamOverview: vi.fn(),
  isConsoleBffAuthExpiredError: mocks.isConsoleBffAuthExpiredError,
  isConsoleBffUnavailableError: mocks.isConsoleBffUnavailableError,
}))

vi.mock("@/lib/admin/technical-tools", () => ({
  technicalToolsForRole: mocks.technicalToolsForRole,
}))

vi.mock("@/components/console-v2/applications-v2-experience", () => ({
  ApplicationsV2Experience: mocks.applicationsV2Experience,
}))

vi.mock("@/components/console-v2/console-unavailable-panel", () => ({
  ConsoleUnavailablePanel: vi.fn(),
}))

vi.mock("@/components/console-v2/console-v2-sections", () => ({
  roleCanAccessConsoleSection: vi.fn(() => true),
}))

vi.mock("@/components/console-v2/hardware-v2-experience", () => ({
  HardwareV2Experience: mocks.hardwareV2Experience,
}))

vi.mock("@/components/console-v2/inference-v2-experience", () => ({
  InferenceV2Experience: vi.fn(),
}))

vi.mock("@/components/console-v2/settings-v2-experience", () => ({
  SettingsV2Experience: ({
    accessRole,
    settingsAction,
    technicalTools,
  }: {
    accessRole: string
    settingsAction?: string
    technicalTools?: Array<{ id: string }>
  }) => (
    <div>
      Settings role {accessRole}
      {settingsAction ? ` action ${settingsAction}` : ""}
      {technicalTools?.map(({ id }) => (
        <span key={id}> tool {id}</span>
      ))}
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

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("retained route boundaries", () => {
  it("passes the role-qualified Grafana destination into Hardware", async () => {
    mocks.getCurrentConsoleSession.mockResolvedValue(
      activeConsoleSession("admin"),
    )
    const hardware = { generatedAt: "2026-08-02T09:30:00.000Z" }
    mocks.getAdminHardware.mockResolvedValue(hardware)
    mocks.technicalToolsForRole.mockReturnValue([technicalToolLink("grafana")])

    render(
      await renderHardwareConsoleRoute(
        Promise.resolve({ range: "6h", step: "60s" }),
      ),
    )

    expect(mocks.getAdminHardware).toHaveBeenCalledWith({
      range: "6h",
      step: "60s",
    })
    expect(mocks.technicalToolsForRole).toHaveBeenCalledWith("admin")
    expect(mocks.hardwareV2Experience).toHaveBeenCalledWith(
      expect.objectContaining({
        basePath: "/hardware",
        grafanaHref: "https://grafana.example.test/",
        hardware,
      }),
      undefined,
    )
  })

  it("never passes a Grafana destination into Operator Hardware", async () => {
    mocks.getCurrentConsoleSession.mockResolvedValue(
      activeConsoleSession("operator"),
    )
    const hardware = { generatedAt: "2026-08-02T09:30:00.000Z" }
    mocks.getAdminHardware.mockResolvedValue(hardware)
    mocks.technicalToolsForRole.mockReturnValue([technicalToolLink("litellm")])

    render(await renderHardwareConsoleRoute())

    expect(mocks.technicalToolsForRole).toHaveBeenCalledWith("operator")
    expect(mocks.hardwareV2Experience).toHaveBeenCalledWith(
      expect.objectContaining({
        grafanaHref: null,
        hardware,
      }),
      undefined,
    )
  })

  it("renders the Application creation form for an Admin without MFA", async () => {
    mocks.getCurrentConsoleSession.mockResolvedValue(
      activeConsoleSession("admin"),
    )
    mocks.getAdminInference.mockResolvedValue({ models: [] })

    render(await renderApplicationsConsoleRoute({ section: ["apps", "new"] }))

    expect(mocks.redirect).not.toHaveBeenCalled()
    expect(mocks.getAdminInference).toHaveBeenCalledWith({ range: "7d" })
    expect(mocks.applicationsV2Experience).toHaveBeenCalledWith(
      expect.objectContaining({
        accessRole: "admin",
        modelOptions: [],
        view: "new-app",
      }),
      undefined,
    )
  })

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
    mocks.technicalToolsForRole.mockReturnValue([technicalToolLink("litellm")])

    render(
      await renderSettingsConsoleRoute(
        Promise.resolve({ settingsAction: "organizationSaved" }),
      ),
    )

    expect(screen.getByText("Settings role operator")).toBeTruthy()
    expect(screen.getByText("tool litellm")).toBeTruthy()
    expect(screen.queryByText(/organizationSaved/)).toBeNull()
    expect(mocks.getAdminSettings).toHaveBeenCalledOnce()
    expect(mocks.technicalToolsForRole).toHaveBeenCalledWith("operator")
  })

  it("keeps the Admin post-redirect Settings notice", async () => {
    mocks.getCurrentConsoleSession.mockResolvedValue(
      activeConsoleSession("admin"),
    )
    mocks.getAdminSettings.mockResolvedValue({ generatedAt: "test" })
    mocks.technicalToolsForRole.mockReturnValue([
      technicalToolLink("grafana"),
      technicalToolLink("litellm"),
      technicalToolLink("keycloak"),
    ])

    render(
      await renderSettingsConsoleRoute(
        Promise.resolve({ settingsAction: "organizationSaved" }),
      ),
    )

    expect(
      screen.getByText("Settings role admin action organizationSaved"),
    ).toBeTruthy()
    expect(screen.getByText("tool grafana")).toBeTruthy()
    expect(screen.getByText("tool litellm")).toBeTruthy()
    expect(screen.getByText("tool keycloak")).toBeTruthy()
    expect(mocks.technicalToolsForRole).toHaveBeenCalledWith("admin")
  })
})
