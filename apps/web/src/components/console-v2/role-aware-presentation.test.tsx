import type {
  AdminConnectedApp,
  AdminInferenceDashboard,
  AdminTeamMember,
  AdminTeamOverviewResponse,
} from "@llm-machines/contracts/inference-core"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ApplicationsV2Experience } from "./applications-v2-experience"
import { InferenceV2Experience } from "./inference-v2-experience"
import { TeamV2Experience } from "./team-v2-experience"

vi.mock("@/lib/admin/actions-core", () => ({
  applyAdminInferenceModelUpdateAction: vi.fn(),
  bulkAssignAdminTeamGroupMembersAction: vi.fn(),
  checkAdminConnectedAppConnectionAction: vi.fn(async (state) => state),
  commitAdminTeamCsvImportAction: vi.fn(),
  createAdminConnectedAppAction: vi.fn(async (state) => state),
  createAdminTeamGroupAction: vi.fn(),
  createAdminTeamMemberAction: vi.fn(async (state) => state),
  deleteAdminTeamGroupAction: vi.fn(),
  deleteAdminTeamMemberAction: vi.fn(),
  disableAdminConnectedAppAction: vi.fn(),
  disableAdminTeamMemberAction: vi.fn(),
  enableAdminConnectedAppAction: vi.fn(),
  generateAdminTeamPasswordAction: vi.fn(async (state) => state),
  previewAdminTeamCsvImportAction: vi.fn(async (state) => state),
  reactivateAdminTeamMemberAction: vi.fn(),
  removeAdminTeamGroupMemberAction: vi.fn(),
  revokeAdminConnectedAppCredentialAction: vi.fn(async (state) => state),
  rotateAdminConnectedAppCredentialsAction: vi.fn(async (state) => state),
  sendAdminTeamInviteAction: vi.fn(),
  sendAdminTeamPasswordResetAction: vi.fn(),
  softDeleteAdminConnectedAppAction: vi.fn(),
  updateAdminConnectedAppPolicyAction: vi.fn(),
  updateAdminSettingsOrganizationAction: vi.fn(),
  updateAdminSettingsTelemetryAction: vi.fn(),
  updateAdminTeamGroupAction: vi.fn(),
}))

afterEach(() => {
  cleanup()
})

describe("role-aware Console presentation", () => {
  it("keeps Operator Application reads and credential lifecycle actions without create", () => {
    const { rerender } = render(
      <ApplicationsV2Experience
        accessRole="operator"
        connectedApps={[connectedApp]}
        view="overview"
      />,
    )

    expect(screen.getByText("Desktop client")).toBeTruthy()
    expect(screen.queryByRole("link", { name: "Add app" })).toBeNull()

    rerender(
      <ApplicationsV2Experience
        accessRole="operator"
        connectedAppDetail={connectedApp}
        view="app-detail"
      />,
    )

    expect(
      screen.getByRole("button", { name: "Check connection" }),
    ).toBeTruthy()
    expect(
      screen.getByRole("button", { name: "Rotate credentials" }),
    ).toBeTruthy()
    expect(screen.getByRole("button", { name: "Disable app" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Revoke now" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Edit policy" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Delete app" })).toBeNull()

    rerender(
      <ApplicationsV2Experience
        accessRole="operator"
        connectedAppDetail={{ ...connectedApp, status: "disabled" }}
        view="app-detail"
      />,
    )
    expect(screen.queryByRole("button", { name: "Re-enable app" })).toBeNull()
  })

  it("keeps Operator inference reads while blocking updates and native LiteLLM access", () => {
    const { rerender } = render(
      <InferenceV2Experience
        accessRole="operator"
        dashboard={inferenceDashboard}
        view="overview"
      />,
    )

    expect(screen.getByText("LiteLLM signal")).toBeTruthy()
    expect(
      screen.getByText(/separate from Console Application credentials/),
    ).toBeTruthy()
    expect(screen.queryByRole("link", { name: /Open LiteLLM/ })).toBeNull()

    rerender(
      <InferenceV2Experience
        accessRole="operator"
        dashboard={inferenceDashboard}
        view="model-update"
      />,
    )

    const updateButton = screen.getByRole("button", {
      name: "Admin approval required",
    })
    expect(updateButton.hasAttribute("disabled")).toBe(true)
  })

  it("keeps Operator Team visibility without identity mutations or Keycloak links", () => {
    const { rerender } = render(
      <TeamV2Experience
        accessRole="operator"
        overview={teamOverview}
        view="overview"
      />,
    )

    expect(screen.getByText("Ada Lovelace")).toBeTruthy()
    expect(screen.getByRole("link", { name: "Manage users" })).toBeTruthy()
    expect(screen.queryByRole("link", { name: "Create user" })).toBeNull()
    expect(screen.queryByRole("link", { name: "Import CSV" })).toBeNull()
    expect(screen.queryByText(/managed in Keycloak/)).toBeNull()

    rerender(
      <TeamV2Experience
        accessRole="operator"
        detail={{
          activity: [],
          member: teamMember,
          usage: {
            mostUsedModel: null,
            prompts: 0,
            sourceStatus: "ok",
            tokens: 0,
            window: "7d",
          },
        }}
        overview={teamOverview}
        view="member-detail"
      />,
    )

    expect(screen.getByText("Profile basics")).toBeTruthy()
    expect(screen.queryByText("Account actions")).toBeNull()
    expect(screen.queryByRole("link", { name: /Open in Keycloak/ })).toBeNull()
  })
})

const connectedApp: AdminConnectedApp = {
  allowedModels: ["qwen"],
  auditHref: "/audit?app=app-1",
  authMethod: "api_key",
  connectionStatus: "not_connected",
  createdAt: "2026-07-31T08:00:00.000Z",
  credentials: [
    {
      authMethod: "api_key",
      clientId: null,
      id: "credential-1",
      issuedAt: "2026-07-31T08:00:00.000Z",
      keyPrefix: "llm_app_",
      lastUsedAt: null,
      overlapExpiresAt: null,
      revokedAt: null,
      rotatedAt: null,
      status: "active",
    },
  ],
  description: "Third-party desktop harness",
  detailHref: "/applications/apps/app-1",
  firecrawl: {
    connectionStatus: "not_connected",
    credentials: [],
    disclaimerAcceptedAt: null,
    disclaimerVersion: null,
    lastConnectedAt: null,
    maxConcurrentScrapes: null,
    scrapeRateLimitRps: null,
    searchRateLimitRps: null,
    status: "disabled",
  },
  id: "app-1",
  lastConnectedAt: null,
  maxConcurrentRequests: null,
  maxContextBytes: null,
  name: "Desktop client",
  rateLimitRps: null,
  status: "enabled",
  tokenAlertState: null,
  tokenAlertThreshold7d: null,
  updatedAt: "2026-07-31T08:00:00.000Z",
  usage: {
    failures7d: 0,
    lastUsedAt: null,
    requests7d: 0,
    tokens7d: 0,
  },
}

const inferenceDashboard: AdminInferenceDashboard = {
  generatedAt: "2026-07-31T08:00:00.000Z",
  liteLlmUrl: "https://litellm.example.test",
  modelUpdate: {
    affectedModels: ["qwen"],
    availableVersion: "2.0.0",
    currentVersion: "1.0.0",
    detail: "A signed model bundle is available.",
    estimatedDowntime: "Two minutes",
    releaseNotes: "Updated serving configuration.",
    status: "available",
    updateActionEnabled: true,
  },
  modelUsage: [],
  models: [],
  range: "7d",
  sourceStatus: "ok",
  summary: "Inference is available.",
  totals: { requests: 0, tokens: 0 },
  usagePoints: [],
  virtualKeys: [],
}

const teamMember: AdminTeamMember = {
  createdAt: "2026-07-31T08:00:00.000Z",
  displayName: "Ada Lovelace",
  email: "ada@example.test",
  enabled: true,
  groups: ["Operations"],
  id: "operator-1",
  keycloakHref: "https://keycloak.example.test/users/operator-1",
  lastActiveAt: null,
  role: "operator",
  status: "active",
  username: "ada.operations",
}

const teamOverview: AdminTeamOverviewResponse = {
  generatedAt: "2026-07-31T08:00:00.000Z",
  groups: [
    {
      id: "operations",
      keycloakHref: "https://keycloak.example.test/groups/operations",
      memberCount: 1,
      name: "Operations",
      virtual: false,
    },
  ],
  members: [teamMember],
  scim: {
    detail: "Keycloak identity is available.",
    keycloakHref: "https://keycloak.example.test",
    lastSyncAt: null,
    provider: "Keycloak",
    sourceStatus: "ok",
    status: "configured",
  },
  serviceStatus: "ok",
  sourceStatus: "ok",
}
