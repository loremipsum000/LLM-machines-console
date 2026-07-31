import { describe, expect, it } from "vitest"
import * as inferenceCoreContracts from "./inference-core"
import {
  adminConnectedAppCreateRequestSchema,
  adminConnectedAppCredentialMetadataSchema,
  adminConnectedAppCredentialSchema,
  adminConnectedAppDeleteRequestSchema,
  adminConnectedAppLifecycleResultSchema,
  adminConnectedAppSchema,
  adminConnectedAppTestResultSchema,
  adminConnectedAppUpdateRequestSchema,
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
      /(BreakGlass|Builder|Hub|Knowledge|Mcp|UrlPolicy)/.test(name),
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

  it("parses the flat Application and credential lifecycle contract", () => {
    const staticCredential = {
      authMethod: "api_key",
      clientId: null,
      id: "credential-1",
      issuedAt: timestamp,
      keyPrefix: "llmm_t4_1234",
      lastUsedAt: null,
      overlapExpiresAt: null,
      revokedAt: null,
      rotatedAt: null,
      status: "active",
    } as const
    const application = {
      allowedModels: ["local-chat"],
      auditHref: "/activity?applicationId=app-1",
      authMethod: "api_key",
      connectionStatus: "not_connected",
      createdAt: timestamp,
      credentials: [staticCredential],
      description: "Desktop chat application",
      detailHref: "/applications/apps/app-1",
      id: "app-1",
      lastConnectedAt: null,
      name: "Desktop",
      rateLimitRpm: null,
      status: "enabled",
      tokenBudget7d: null,
      updatedAt: timestamp,
      usage: {
        failures7d: 0,
        lastUsedAt: null,
        requests7d: 0,
        tokens7d: 0,
      },
    } as const

    expect(
      adminConnectedAppCredentialMetadataSchema.safeParse(staticCredential)
        .success,
    ).toBe(true)
    expect(adminConnectedAppSchema.safeParse(application).success).toBe(true)
    expect(
      adminConnectedAppSchema.safeParse({
        ...application,
        allowedModels: ["local-chat", "local-chat"],
      }).success,
    ).toBe(false)
    expect(
      adminConnectedAppSchema.safeParse({
        ...application,
        allowedModels: ["x".repeat(161)],
      }).success,
    ).toBe(false)
    expect(
      adminConnectedAppSchema.safeParse({
        ...application,
        credentials: [staticCredential, staticCredential],
      }).success,
    ).toBe(false)
    expect(
      adminConnectedAppSchema.safeParse({
        ...application,
        credentials: [
          {
            ...staticCredential,
            revokedAt: timestamp,
            status: "revoked",
          },
        ],
        status: "disabled",
      }).success,
    ).toBe(true)
    expect(
      adminConnectedAppSchema.safeParse({
        ...application,
        legacyOwner: "Everyone",
      }).success,
    ).toBe(false)
    expect(
      adminConnectedAppSchema.safeParse({
        ...application,
        credentials: [
          {
            ...staticCredential,
            authMethod: "oauth_client_credentials",
            clientId: "client-1",
            keyPrefix: null,
          },
        ],
      }).success,
    ).toBe(false)
    expect(
      adminConnectedAppCredentialMetadataSchema.safeParse({
        ...staticCredential,
        authMethod: "oauth_client_credentials",
        clientId: "client-1",
        keyPrefix: null,
        overlapExpiresAt: timestamp,
        status: "retiring",
      }).success,
    ).toBe(false)
    expect(
      adminConnectedAppCredentialMetadataSchema.safeParse({
        ...staticCredential,
        overlapExpiresAt: timestamp,
        status: "active",
      }).success,
    ).toBe(false)

    expect(
      adminConnectedAppCreateRequestSchema.parse({
        allowedModels: ["local-chat"],
        description: "Desktop chat application",
        name: "Desktop",
      }),
    ).toMatchObject({
      authMethod: "api_key",
      rateLimitRpm: null,
      tokenBudget7d: null,
    })
    expect(
      adminConnectedAppUpdateRequestSchema.safeParse({
        allowedModels: ["local-chat"],
        authMethod: "oauth_client_credentials",
        description: "Changed",
        name: "Desktop",
        rateLimitRpm: null,
        tokenBudget7d: null,
      }).success,
    ).toBe(false)
    expect(
      adminConnectedAppUpdateRequestSchema.safeParse({
        allowedModels: ["local-chat"],
        description: "Changed",
        name: "Desktop",
        rateLimitRpm: null,
        status: "disabled",
        tokenBudget7d: null,
      }).success,
    ).toBe(false)

    expect(
      adminConnectedAppCredentialSchema.safeParse({
        apiKey: "llmm_t4_once_only",
        authMethod: "api_key",
        bffBaseUrl: "https://bff.example.test",
        credentialId: "credential-1",
        exampleCurl: "curl example",
        issuedAt: timestamp,
        keyPrefix: "llmm_t4_once",
        model: "local-chat",
        openAiBaseUrl: "https://bff.example.test/api/app-gateway/v1",
      }).success,
    ).toBe(true)
    const oauthCredential = {
      authMethod: "oauth_client_credentials",
      bffBaseUrl: "https://bff.example.test",
      clientId: "client-1",
      clientSecret: "one-time-secret",
      credentialId: "credential-2",
      exampleCurl: "curl example",
      issuedAt: timestamp,
      keyPrefix: null,
      model: "local-chat",
      openAiBaseUrl: "https://bff.example.test/api/app-gateway/v1",
      tokenUrl: "https://identity.example.test/token",
    } as const
    for (const endpoint of [
      "javascript:alert(1)",
      "data:text/plain,credential",
      "ftp://identity.example.test/token",
      "https://user:password@identity.example.test/token",
      "https://identity.example.test/token?audience=inference",
      "https://identity.example.test/token?",
      "https://identity.example.test/token#fragment",
      "https://identity.example.test/token#",
    ]) {
      for (const field of [
        "bffBaseUrl",
        "openAiBaseUrl",
        "tokenUrl",
      ] as const) {
        expect(
          adminConnectedAppCredentialSchema.safeParse({
            ...oauthCredential,
            [field]: endpoint,
          }).success,
        ).toBe(false)
      }
    }
    expect(
      adminConnectedAppCredentialSchema.safeParse(oauthCredential).success,
    ).toBe(true)
    expect(
      adminConnectedAppDeleteRequestSchema.safeParse({
        confirmation: "DELETE APPLICATION",
      }).success,
    ).toBe(true)
    expect(
      adminConnectedAppDeleteRequestSchema.safeParse({ confirmation: "DELETE" })
        .success,
    ).toBe(false)
    expect(
      adminConnectedAppTestResultSchema.safeParse({
        app: application,
        connectionStatus: "not_connected",
        detail: "Waiting for a client models request.",
        observedAt: null,
        status: "waiting",
      }).success,
    ).toBe(true)
    const connectedApplication = {
      ...application,
      connectionStatus: "connected",
      lastConnectedAt: timestamp,
    } as const
    expect(
      adminConnectedAppTestResultSchema.safeParse({
        app: connectedApplication,
        connectionStatus: "connected",
        detail: "A real client reached the models endpoint.",
        observedAt: timestamp,
        status: "passed",
      }).success,
    ).toBe(true)
    expect(
      adminConnectedAppTestResultSchema.safeParse({
        app: application,
        connectionStatus: "not_connected",
        detail: "No real client connection exists.",
        observedAt: null,
        status: "passed",
      }).success,
    ).toBe(false)
    expect(
      adminConnectedAppTestResultSchema.safeParse({
        app: connectedApplication,
        connectionStatus: "connected",
        detail: "Evidence timestamp does not match.",
        observedAt: null,
        status: "passed",
      }).success,
    ).toBe(false)
    expect(
      adminConnectedAppLifecycleResultSchema.safeParse({
        app: null,
        applicationId: application.id,
        detail: "Application deleted.",
        status: "deleted",
      }).success,
    ).toBe(true)
    expect(
      adminConnectedAppLifecycleResultSchema.safeParse({
        app: { ...application, status: "disabled" },
        applicationId: application.id,
        detail: "Application disabled.",
        status: "disabled",
      }).success,
    ).toBe(true)
    expect(
      adminConnectedAppLifecycleResultSchema.safeParse({
        app: application,
        applicationId: application.id,
        detail: "Application re-enabled.",
        status: "reenabled",
      }).success,
    ).toBe(true)
    expect(
      adminConnectedAppLifecycleResultSchema.safeParse({
        app: application,
        applicationId: application.id,
        detail: "Application disabled.",
        status: "disabled",
      }).success,
    ).toBe(false)
    expect(
      adminConnectedAppLifecycleResultSchema.safeParse({
        app: { ...application, status: "disabled" },
        applicationId: application.id,
        detail: "Application re-enabled.",
        status: "reenabled",
      }).success,
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
