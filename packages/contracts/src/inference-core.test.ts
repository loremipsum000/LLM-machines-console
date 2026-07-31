import { describe, expect, it } from "vitest"
import * as inferenceCoreContracts from "./inference-core"
import {
  adminConnectedAppCreateRequestSchema,
  adminConnectedAppEnvironmentStateSchema,
  adminHardwareResponseSchema,
  adminInferenceDashboardSchema,
  adminOverviewResponseSchema,
  adminOverviewTileSchema,
  adminSettingsResponseSchema,
  adminSettingsServiceIdSchema,
  adminTeamGroupDetailSchema,
  adminTeamMemberSchema,
  adminTeamOverviewResponseSchema,
  adminTeamUsageSummarySchema,
  inferenceCoreExpertAuditCapabilitySchema,
  inferenceCoreSeveritySchema,
  inferenceCoreSourceStatusSchema,
} from "./inference-core"

const timestamp = "2026-07-31T08:00:00.000Z"

const member = {
  createdAt: timestamp,
  displayName: "Appliance Operator",
  email: "operator@example.test",
  enabled: true,
  groups: ["Operators"],
  id: "operator-1",
  keycloakHref: null,
  lastActiveAt: timestamp,
  role: "operator",
  status: "active",
  username: "operator",
} as const

const group = {
  id: "operators",
  keycloakHref: null,
  memberCount: 1,
  name: "Operators",
  virtual: false,
} as const

describe("Inference Core contract boundary", () => {
  it("exports neutral status and severity without retired domain contracts", () => {
    expect(inferenceCoreSourceStatusSchema.options).toEqual([
      "ok",
      "degraded",
      "unavailable",
      "not_configured",
    ])
    expect(inferenceCoreSeveritySchema.options).toEqual([
      "info",
      "warning",
      "critical",
    ])

    const retiredExport = Object.keys(inferenceCoreContracts).find((name) =>
      /(BreakGlass|Builder|Hub|Knowledge|Mcp|Promotion|UrlPolicy)/.test(name),
    )
    expect(retiredExport).toBeUndefined()
  })

  it("accepts only retained Overview tiles", () => {
    const tile = (id: "applications" | "inference" | "hardware" | "system") =>
      ({
        href: `/${id}`,
        id,
        metrics: [
          {
            detail: null,
            id: `${id}-status`,
            label: "Status",
            tone: "good",
            value: "Ready",
          },
        ],
        sourceStatus: "ok",
        summary: `${id} summary`,
        title: id,
        updatedAt: timestamp,
      }) as const

    expect(
      adminOverviewResponseSchema.safeParse({
        activityEvents: [],
        generatedAt: timestamp,
        tiles: [
          tile("applications"),
          tile("inference"),
          tile("hardware"),
          tile("system"),
        ],
      }).success,
    ).toBe(true)
    expect(
      adminOverviewTileSchema.safeParse({
        ...tile("system"),
        id: "governance",
      }).success,
    ).toBe(false)
  })

  it("limits Team to Admin and Operator without retired unlock or break-glass fields", () => {
    expect(adminTeamMemberSchema.safeParse(member).success).toBe(true)
    expect(
      adminTeamMemberSchema.safeParse({ ...member, role: "builder" }).success,
    ).toBe(false)
    expect(
      adminTeamUsageSummarySchema.safeParse({
        mcpCalls: 2,
        mostUsedModel: "local-model",
        prompts: 12,
        sourceStatus: "ok",
        tokens: 200,
        window: "7d",
      }).success,
    ).toBe(false)
    expect(
      adminTeamGroupDetailSchema.safeParse({
        group,
        members: [member],
        unlocks: [],
      }).success,
    ).toBe(false)
    expect(
      adminTeamOverviewResponseSchema.safeParse({
        breakGlass: {
          eligibleAdmins: [],
          selectedAdminId: null,
          updatedAt: null,
          updatedBy: null,
        },
        generatedAt: timestamp,
        groups: [group],
        members: [member],
        scim: {
          detail: "SCIM is not configured.",
          keycloakHref: null,
          lastSyncAt: null,
          provider: null,
          sourceStatus: "not_configured",
          status: "not_configured",
        },
        serviceStatus: "ok",
        sourceStatus: "ok",
      }).success,
    ).toBe(false)
  })

  it("bounds Team bulk membership and CSV request payloads", () => {
    const memberIds = Array.from(
      { length: inferenceCoreContracts.adminTeamBatchLimit },
      (_, index) => `member-${index}`,
    )
    expect(
      inferenceCoreContracts.adminTeamBulkGroupAssignmentRequestSchema.safeParse(
        { memberIds },
      ).success,
    ).toBe(true)
    expect(
      inferenceCoreContracts.adminTeamBulkGroupAssignmentRequestSchema.safeParse(
        { memberIds: [...memberIds, "member-over-limit"] },
      ).success,
    ).toBe(false)
    expect(
      inferenceCoreContracts.adminTeamBulkGroupAssignmentRequestSchema.safeParse(
        { memberIds: ["member-1", "member-1"] },
      ).success,
    ).toBe(false)

    const maximumAsciiCsv = "a".repeat(
      inferenceCoreContracts.adminTeamCsvMaxBytes,
    )
    expect(
      inferenceCoreContracts.adminTeamCsvImportPreviewRequestSchema.safeParse({
        csv: maximumAsciiCsv,
      }).success,
    ).toBe(true)
    expect(
      inferenceCoreContracts.adminTeamCsvImportPreviewRequestSchema.safeParse({
        csv: `${maximumAsciiCsv}a`,
      }).success,
    ).toBe(false)
    expect(
      inferenceCoreContracts.adminTeamCsvImportPreviewRequestSchema.safeParse({
        csv: "é".repeat(
          Math.floor(inferenceCoreContracts.adminTeamCsvMaxBytes / 2) + 1,
        ),
      }).success,
    ).toBe(false)
  })

  it("keeps only retained Settings reachability and rejects URL governance", () => {
    expect(adminSettingsServiceIdSchema.options).toEqual([
      "web",
      "bff",
      "postgres",
      "keycloak",
      "litellm",
      "grafana",
      "prometheus",
      "alertmanager",
      "firecrawl",
      "lifecycle",
    ])
    expect(adminSettingsServiceIdSchema.safeParse("redis").success).toBe(false)
    expect(adminSettingsServiceIdSchema.safeParse("minio").success).toBe(false)
    expect(adminSettingsServiceIdSchema.safeParse("librechat").success).toBe(
      false,
    )
    expect(
      adminSettingsServiceIdSchema.safeParse("agentic_adapter").success,
    ).toBe(false)

    const settings = {
      generatedAt: timestamp,
      license: {
        allowedUpdateChannels: [],
        applianceId: null,
        certificateExpiresAt: null,
        lastEntitlementCheckAt: null,
        offlineMode: true,
        sourceStatus: "not_configured",
        subscriptionState: "not_configured",
        supportState: "Entitlement is not configured.",
        telemetryOptIn: false,
      },
      organization: {
        defaultLanguage: "en",
        fullLogo: null,
        iconLogo: null,
        organizationName: "LLM Machines",
        updatedAt: null,
        updatedBy: null,
      },
      privacy: {
        dataResidencyStatement: "Workload content is not retained.",
        privacyPolicyHref: "/privacy",
        telemetryDescription: "Telemetry is disabled.",
        telemetryEnabled: false,
        telemetryPayloadPreview: {
          applianceId: null,
          installedVersion: null,
          lastAppliedUpdate: null,
          lastUpdateCheck: null,
          subscriptionStateSeenByAppliance: "not_configured",
          updateAgentVersion: null,
        },
        updatedAt: null,
        updatedBy: null,
      },
      reachability: [
        {
          detail: "Console is available.",
          id: "web",
          label: "Console",
          lastCheckedAt: timestamp,
          owningSection: "settings",
          status: "ok",
        },
      ],
      sourceStatus: "ok",
      systemUpdate: {
        affectedComponents: [],
        availableVersion: null,
        detail: "No update service is configured.",
        expectedDowntime: null,
        sourceStatus: "not_configured",
        status: "not_configured",
        updateActionEnabled: false,
      },
    } as const

    expect(adminSettingsResponseSchema.safeParse(settings).success).toBe(true)
    expect(
      adminSettingsResponseSchema.safeParse({
        ...settings,
        urlPolicyRules: [],
      }).success,
    ).toBe(false)
  })

  it("keeps the temporary Application environment shape without promotion contracts", () => {
    expect(
      adminConnectedAppEnvironmentStateSchema.safeParse({
        authMethods: ["api_key", "oauth_client_credentials"],
        clientId: "client-1",
        credentialIssuedAt: timestamp,
        environment: "production",
        keyPrefix: "llmm_live",
        lastUsedAt: null,
        lastTestedAt: timestamp,
        primaryAuthMethod: "api_key",
        productionReady: true,
        testStatus: "passed",
      }).success,
    ).toBe(true)
    expect(
      adminConnectedAppCreateRequestSchema.parse({
        allowedModels: ["local-chat"],
        description: "Desktop chat application",
        name: "Desktop",
      }),
    ).toMatchObject({
      authMethod: "api_key",
      ownerGroup: "Everyone",
      rateLimitRpm: null,
      tokenBudget7d: null,
    })
    expect(
      "adminConnectedAppPromotionResultSchema" in inferenceCoreContracts,
    ).toBe(false)
  })

  it("parses retained Hardware and Inference projections", () => {
    const chartIds = [
      "cpu_utilization",
      "gpu_temperature",
      "gpu_utilization",
      "ram_usage",
      "filesystem_usage",
      "power_draw",
      "network_throughput",
    ] as const
    const charts = chartIds.map((id) => ({
      chartType:
        id === "filesystem_usage" ? ("bar" as const) : ("area" as const),
      description: "Current hardware signal.",
      emptyMessage: "No samples.",
      grafanaUrl: null,
      id,
      promql: "up",
      series: [],
      sourceStatus: "ok" as const,
      thresholds: [],
      title: id,
      unit:
        id === "gpu_temperature"
          ? ("celsius" as const)
          : id === "network_throughput"
            ? ("bytes_per_second" as const)
            : id === "power_draw"
              ? ("watt" as const)
              : ("percent" as const),
    }))

    expect(
      adminHardwareResponseSchema.safeParse({
        activeAlerts: [],
        alertmanagerUrl: null,
        availableHosts: ["appliance"],
        charts,
        generatedAt: timestamp,
        grafanaUrl: null,
        range: "6h",
        selectedHost: "all",
        sourceStatus: "ok",
        step: "180s",
        summary: "All retained signals are available.",
      }).success,
    ).toBe(true)
    expect(
      adminInferenceDashboardSchema.safeParse({
        generatedAt: timestamp,
        liteLlmUrl: "/litellm",
        modelUpdate: null,
        modelUsage: [],
        models: [
          {
            contextWindow: 32768,
            id: "local-chat",
            mode: "chat",
            name: "local-chat",
            outputCostPerMillionTokens: 0,
            provider: "local",
            sourceStatus: "ok",
          },
        ],
        range: "30d",
        sourceStatus: "ok",
        summary: "One model is served.",
        totals: { requests: 0, tokens: 0 },
        usagePoints: [],
        virtualKeys: [],
      }).success,
    ).toBe(true)
  })

  it("fails closed on unproven expert-system audit ingestion", () => {
    expect(
      inferenceCoreExpertAuditCapabilitySchema.shape.source.options,
    ).toEqual(["litellm", "grafana", "keycloak", "alertmanager"])
    expect(
      inferenceCoreExpertAuditCapabilitySchema.parse({
        detail: "Native LiteLLM audit ingestion is not proven.",
        ingestionEnabled: false,
        mechanism: null,
        nativeIngestionState: "unproven",
        source: "litellm",
      }),
    ).toMatchObject({
      ingestionEnabled: false,
      nativeIngestionState: "unproven",
    })
    expect(
      inferenceCoreExpertAuditCapabilitySchema.safeParse({
        detail: "Assumed ingestion",
        ingestionEnabled: true,
        mechanism: "polling",
        nativeIngestionState: "enabled",
        source: "grafana",
      }).success,
    ).toBe(false)
  })
})
