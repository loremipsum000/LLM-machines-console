import type {
  AdminConnectedApp,
  AdminInferenceDashboard,
  AdminSettingsResponse,
  AdminTeamMember,
  AdminTeamOverviewResponse,
} from "@llm-machines/contracts/inference-core"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ApplicationsV2Experience } from "./applications-v2-experience"
import { InferenceV2Experience } from "./inference-v2-experience"
import { SettingsV2Experience } from "./settings-v2-experience"
import { TeamV2Experience } from "./team-v2-experience"

vi.mock("@/lib/admin/actions-core", () => ({
  bulkAssignAdminTeamGroupMembersAction: vi.fn(),
  checkAdminConnectedAppConnectionAction: vi.fn(async (state) => state),
  checkAdminConnectedAppFirecrawlConnectionAction: vi.fn(
    async (state) => state,
  ),
  commitAdminTeamCsvImportAction: vi.fn(),
  createAdminConnectedAppAction: vi.fn(async (state) => state),
  createAdminTeamGroupAction: vi.fn(),
  createAdminTeamMemberAction: vi.fn(async (state) => state),
  deleteAdminTeamGroupAction: vi.fn(),
  deleteAdminTeamMemberAction: vi.fn(),
  disableAdminConnectedAppAction: vi.fn(),
  disableAdminConnectedAppFirecrawlAction: vi.fn(async (state) => state),
  disableAdminTeamMemberAction: vi.fn(),
  enableAdminConnectedAppAction: vi.fn(),
  enableAdminConnectedAppFirecrawlAction: vi.fn(async (state) => state),
  generateAdminTeamPasswordAction: vi.fn(async (state) => state),
  previewAdminTeamCsvImportAction: vi.fn(async (state) => state),
  reactivateAdminTeamMemberAction: vi.fn(),
  removeAdminTeamGroupMemberAction: vi.fn(),
  revokeAdminConnectedAppCredentialAction: vi.fn(async (state) => state),
  revokeAdminConnectedAppFirecrawlCredentialAction: vi.fn(
    async (state) => state,
  ),
  rotateAdminConnectedAppFirecrawlCredentialAction: vi.fn(
    async (state) => state,
  ),
  rotateAdminConnectedAppCredentialsAction: vi.fn(async (state) => state),
  sendAdminTeamInviteAction: vi.fn(),
  sendAdminTeamPasswordResetAction: vi.fn(),
  softDeleteAdminConnectedAppAction: vi.fn(),
  updateAdminConnectedAppPolicyAction: vi.fn(),
  updateAdminConnectedAppFirecrawlPolicyAction: vi.fn(),
  updateAdminSettingsOrganizationAction: vi.fn(),
  updateAdminSettingsTelemetryAction: vi.fn(),
  updateAdminTeamGroupAction: vi.fn(),
}))

afterEach(() => {
  cleanup()
})

describe("role-aware Console presentation", () => {
  it("keeps Operator Application access read-only", () => {
    const { rerender } = render(
      <ApplicationsV2Experience
        accessRole="operator"
        appAction="deleted"
        connectedApps={[connectedApp]}
        view="overview"
      />,
    )

    expect(screen.getByText("Desktop client")).toBeTruthy()
    expect(screen.queryByRole("link", { name: "Add app" })).toBeNull()
    expect(screen.queryByText("Application deleted.")).toBeNull()

    rerender(
      <ApplicationsV2Experience
        accessRole="operator"
        connectedAppDetail={connectedApp}
        view="app-detail"
      />,
    )

    expect(
      screen.queryByRole("button", { name: "Check connection" }),
    ).toBeNull()
    expect(
      screen.queryByRole("button", { name: "Rotate credentials" }),
    ).toBeNull()
    expect(screen.queryByRole("button", { name: "Disable app" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Revoke now" })).toBeNull()
    expect(
      screen.getByText("Operator access is read-only.", { exact: false }),
    ).toBeTruthy()
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

  it("keeps Operator inference reads without native LiteLLM access", () => {
    const { rerender } = render(
      <InferenceV2Experience
        accessRole="operator"
        dashboard={inferenceDashboard}
      />,
    )

    expect(screen.getByText("LiteLLM signal")).toBeTruthy()
    expect(screen.getByText("Requests")).toBeTruthy()
    expect(screen.queryByText("Prompts")).toBeNull()
    expect(screen.getAllByText("7D total")).toHaveLength(2)
    expect(screen.queryByText(/average/i)).toBeNull()
    expect(screen.getByText(/managed per Application in Console/)).toBeTruthy()
    expect(screen.queryByRole("link", { name: /Open LiteLLM/ })).toBeNull()
    expect(screen.queryByText(/model update/i)).toBeNull()

    rerender(
      <InferenceV2Experience
        accessRole="admin"
        dashboard={inferenceDashboard}
      />,
    )
    expect(screen.queryByRole("link", { name: /Open LiteLLM/ })).toBeNull()
    expect(screen.getByText("LiteLLM remains private")).toBeTruthy()
    expect(screen.queryByText(/managed in LiteLLM/)).toBeNull()
    expect(screen.getByText(/mutations are not available in v1/)).toBeTruthy()
  })

  it("distinguishes unavailable inference sources from authentic empty results", () => {
    const { rerender } = render(
      <InferenceV2Experience
        accessRole="operator"
        dashboard={{
          ...inferenceDashboard,
          aggregateUsageSourceStatus: "unavailable",
          modelInventorySourceStatus: "unavailable",
          sourceStatus: "unavailable",
          summary: "LiteLLM inference sources are unavailable.",
          totals: null,
          virtualKeysSourceStatus: "unavailable",
        }}
      />,
    )

    expect(screen.getAllByText("Unavailable")).toHaveLength(2)
    expect(
      screen.getByText("Aggregate model usage is unavailable from LiteLLM."),
    ).toBeTruthy()
    expect(
      screen.getByText("Model inventory is unavailable from LiteLLM."),
    ).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: /Credential metadata/ }))
    expect(
      screen.getByText("Credential metadata is unavailable from LiteLLM."),
    ).toBeTruthy()

    rerender(
      <InferenceV2Experience
        accessRole="operator"
        dashboard={inferenceDashboard}
      />,
    )

    expect(
      screen.getByText("No model usage was reported for this range."),
    ).toBeTruthy()
    expect(
      screen.getByText("No models are currently served by LiteLLM."),
    ).toBeTruthy()
    expect(
      screen.getByText("No safe LiteLLM credential metadata is available."),
    ).toBeTruthy()
  })

  it("keeps Operator Team visibility without identity mutations or Keycloak links", () => {
    const { rerender } = render(
      <TeamV2Experience
        accessRole="operator"
        overview={teamOverview}
        teamAction="groupCreated"
        view="overview"
      />,
    )

    expect(screen.getByText("Ada Lovelace")).toBeTruthy()
    expect(screen.getByRole("link", { name: "Manage users" })).toBeTruthy()
    expect(screen.queryByRole("link", { name: "Create user" })).toBeNull()
    expect(screen.queryByRole("link", { name: "Import CSV" })).toBeNull()
    expect(screen.queryByText(/managed in Keycloak/)).toBeNull()
    expect(screen.queryByText("Team group created.")).toBeNull()

    rerender(
      <TeamV2Experience
        accessRole="operator"
        detail={{
          activity: [
            {
              action: "keycloak.authentication.succeeded",
              createdAt: "2026-07-31T08:30:00.000Z",
              id: "event-1",
              targetId: "operator-1",
              targetType: "keycloak_subject",
            },
          ],
          member: teamMember,
        }}
        overview={teamOverview}
        view="member-detail"
      />,
    )

    expect(screen.getByText("Profile basics")).toBeTruthy()
    expect(screen.getByText("Recent activity")).toBeTruthy()
    expect(screen.getByText("keycloak.authentication.succeeded")).toBeTruthy()
    expect(screen.queryByText("Usage summary")).toBeNull()
    expect(screen.queryByText("Prompts")).toBeNull()
    expect(screen.queryByText("Tokens")).toBeNull()
    expect(screen.queryByText("Account actions")).toBeNull()
    expect(screen.queryByRole("link", { name: /Open in Keycloak/ })).toBeNull()

    rerender(
      <TeamV2Experience
        accessRole="admin"
        overview={teamOverview}
        view="overview"
      />,
    )
    expect(screen.queryByRole("link", { name: /Open in Keycloak/ })).toBeNull()
    expect(screen.getByText(/Keycloak remains private/)).toBeTruthy()
    expect(screen.getByRole("link", { name: "Create user" })).toBeTruthy()
    expect(screen.queryByRole("link", { name: "Import CSV" })).toBeNull()
    expect(screen.queryByRole("link", { name: "Create group" })).toBeNull()
  })

  it.each([
    {
      detail: /Configure the Keycloak service account/,
      serviceStatus: "not_configured" as const,
      title: "Keycloak admin API not configured",
    },
    {
      detail: /credentials and realm-management permissions/,
      serviceStatus: "unauthorized" as const,
      title: "Keycloak admin API authorization failed",
    },
    {
      detail: /Keycloak health and network reachability/,
      serviceStatus: "unavailable" as const,
      title: "Keycloak admin API unavailable",
    },
    {
      detail: /realm, endpoint, and Keycloak admin API compatibility/,
      serviceStatus: "invalid" as const,
      title: "Keycloak admin API response invalid",
    },
  ])(
    "presents $serviceStatus Keycloak source status accurately",
    ({ detail, serviceStatus, title }) => {
      render(
        <TeamV2Experience
          accessRole="operator"
          overview={{
            ...teamOverview,
            serviceStatus,
            sourceStatus:
              serviceStatus === "not_configured"
                ? "not_configured"
                : "unavailable",
          }}
          view="overview"
        />,
      )

      expect(screen.getByRole("heading", { name: title })).toBeTruthy()
      expect(screen.getByText(detail)).toBeTruthy()
      if (serviceStatus !== "not_configured") {
        expect(
          screen.queryByRole("heading", {
            name: "Keycloak admin API not configured",
          }),
        ).toBeNull()
      }
    },
  )

  it("keeps Operator Settings visible and read-only while Admin retains mutations", () => {
    const { rerender } = render(
      <SettingsV2Experience
        accessRole="operator"
        settings={settingsResponse}
      />,
    )

    expect(
      screen.getByText("Operator access is read-only.", { exact: false }),
    ).toBeTruthy()
    expect(screen.getByText("Example Organization")).toBeTruthy()
    expect(screen.getByText("Telemetry payload preview")).toBeTruthy()
    expect(
      screen.queryByRole("textbox", { name: "Organization name" }),
    ).toBeNull()
    expect(
      screen.queryByRole("combobox", { name: "Default language" }),
    ).toBeNull()
    expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull()
    expect(
      screen.queryByRole("button", { name: "Enable telemetry" }),
    ).toBeNull()
    expect(screen.queryByRole("link", { name: "Privacy policy" })).toBeNull()

    expect(screen.queryByRole("button", { name: /System update/ })).toBeNull()

    rerender(
      <SettingsV2Experience accessRole="admin" settings={settingsResponse} />,
    )

    expect(
      screen.getByRole("textbox", { name: "Organization name" }),
    ).toBeTruthy()
    expect(
      screen.getByRole("combobox", { name: "Default language" }),
    ).toBeTruthy()
    expect(screen.getByRole("button", { name: "Save changes" })).toBeTruthy()
    expect(
      screen.getByRole("button", { name: "Enable telemetry" }),
    ).toBeTruthy()
    expect(screen.queryByRole("button", { name: /System update/ })).toBeNull()
    expect(screen.queryByRole("link", { name: "Privacy policy" })).toBeNull()

    rerender(
      <SettingsV2Experience
        accessRole="admin"
        settings={{ ...settingsResponse, sourceStatus: "not_configured" }}
        settingsAction="organizationSaved"
      />,
    )
    expect(
      screen.getByText("Settings storage is not configured.", { exact: false }),
    ).toBeTruthy()
    expect(
      screen.queryByRole("textbox", { name: "Organization name" }),
    ).toBeNull()
    expect(
      screen.queryByRole("button", { name: "Enable telemetry" }),
    ).toBeNull()
    expect(screen.queryByText("Organization settings saved.")).toBeNull()
  })
})

const connectedApp: AdminConnectedApp = {
  allowedModels: ["qwen"],
  auditHref: "/activity?applicationId=app-1",
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
  aggregateUsageSourceStatus: "ok",
  generatedAt: "2026-07-31T08:00:00.000Z",
  liteLlmUrl: null,
  modelInventorySourceStatus: "ok",
  modelUsage: [],
  models: [],
  range: "7d",
  sourceStatus: "ok",
  summary: "Inference is available.",
  totals: { requests: 0, tokens: 0 },
  usagePoints: [],
  virtualKeys: [],
  virtualKeysSourceStatus: "ok",
}

const settingsResponse: AdminSettingsResponse = {
  generatedAt: "2026-07-31T08:00:00.000Z",
  license: {
    allowedUpdateChannels: ["stable"],
    applianceId: "appliance-1",
    certificateExpiresAt: null,
    lastEntitlementCheckAt: "2026-07-31T07:30:00.000Z",
    offlineMode: true,
    sourceStatus: "ok",
    subscriptionState: "active",
    supportState: "Supported",
    telemetryOptIn: false,
  },
  organization: {
    defaultLanguage: "en",
    fullLogo: null,
    iconLogo: null,
    organizationName: "Example Organization",
    updatedAt: null,
    updatedBy: null,
  },
  privacy: {
    dataResidencyStatement: "Application content stays on the appliance.",
    telemetryDescription:
      "Only the reviewed appliance and entitlement metadata shown above can be sent.",
    telemetryEnabled: false,
    telemetryPayloadPreview: {
      applianceId: "appliance-1",
      installedVersion: "1.0.0",
      lastAppliedUpdate: null,
      lastUpdateCheck: "2026-07-31T07:30:00.000Z",
      subscriptionStateSeenByAppliance: "active",
      updateAgentVersion: "1.0.0",
    },
    updatedAt: null,
    updatedBy: null,
  },
  reachability: [],
  sourceStatus: "ok",
  systemUpdate: {
    affectedComponents: ["Console"],
    availableVersion: "1.1.0",
    detail: "A signed Console update is available.",
    expectedDowntime: "Two minutes",
    sourceStatus: "ok",
    status: "available",
    updateActionEnabled: true,
  },
}

const teamMember: AdminTeamMember = {
  createdAt: "2026-07-31T08:00:00.000Z",
  displayName: "Ada Lovelace",
  email: "ada@example.test",
  enabled: true,
  groups: ["Operations"],
  id: "operator-1",
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
      memberCount: 1,
      name: "Operations",
      virtual: false,
    },
  ],
  members: [teamMember],
  scim: {
    detail: "Keycloak identity is available.",
    lastSyncAt: null,
    provider: "Keycloak",
    sourceStatus: "ok",
    status: "configured",
  },
  serviceStatus: "ok",
  sourceStatus: "ok",
}
