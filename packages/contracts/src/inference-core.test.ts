import { describe, expect, it } from "vitest"
import * as inferenceCoreContracts from "./inference-core"
import {
  adminAlertEgressResponseSchema,
  adminAuditResponseSchema,
  adminAuditVerificationKeysResponseSchema,
  adminConnectedAppCreateRequestSchema,
  adminConnectedAppCredentialMetadataSchema,
  adminConnectedAppCredentialSchema,
  adminConnectedAppDeleteRequestSchema,
  adminConnectedAppLifecycleResultSchema,
  adminConnectedAppSchema,
  adminConnectedAppTestResultSchema,
  adminHardwareResponseSchema,
  adminInferenceDashboardSchema,
  adminOverviewResponseSchema,
  adminOverviewTileSchema,
  adminSettingsResponseSchema,
  adminSettingsServiceIdSchema,
  adminTeamGroupDetailSchema,
  adminTeamMemberDetailSchema,
  adminTeamMemberSchema,
  adminTeamOverviewResponseSchema,
  aggregateInferenceCoreSourceStatus,
  inferenceCoreCompatibilityFingerprint,
  inferenceCoreNativeAuditCapabilitySchema,
  inferenceCoreSeverityOrder,
  inferenceCoreSeverityRank,
  inferenceCoreSeveritySchema,
  inferenceCoreSourceStatusSchema,
  updateAdminAlertEgressRequestSchema,
} from "./inference-core"

const timestamp = "2026-07-31T08:00:00.000Z"

describe("inference-core status ownership", () => {
  it.each([
    [[], "not_configured"],
    [["not_configured", "not_configured"], "not_configured"],
    [["ok", "ok"], "ok"],
    [["ok", "degraded"], "degraded"],
    [["ok", "unavailable"], "degraded"],
    [["unavailable", "unavailable"], "unavailable"],
  ] as const)("aggregates %j as %s", (statuses, expected) => {
    expect(aggregateInferenceCoreSourceStatus(statuses)).toBe(expected)
  })

  it("supports explicit required-source and audit availability semantics", () => {
    expect(
      aggregateInferenceCoreSourceStatus([
        { required: true, status: "unavailable" },
        { required: false, status: "ok" },
      ]),
    ).toBe("unavailable")
    expect(
      aggregateInferenceCoreSourceStatus(["unavailable", "unavailable"], {
        allUnavailable: "degraded",
      }),
    ).toBe("degraded")
  })

  it("owns the exact severity order and rank", () => {
    expect(inferenceCoreSeverityOrder).toEqual(["critical", "warning", "info"])
    expect(inferenceCoreSeverityRank).toEqual({
      critical: 0,
      warning: 1,
      info: 2,
    })
  })
})

it("pins the rendered inference profile compatibility fingerprint", () => {
  expect(inferenceCoreCompatibilityFingerprint).toBe(
    "sha256:8ef12de33f7d900f2c6b9a1f8117f8635088d655b52bd7fa5c481c32117b293e",
  )
})

const member = {
  createdAt: timestamp,
  displayName: "Appliance Operator",
  email: "operator@example.test",
  enabled: true,
  groups: ["Operators"],
  id: "operator-1",
  lastActiveAt: timestamp,
  role: "operator",
  status: "active",
  username: "operator",
} as const

const group = {
  id: "operators",
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
    expect(inferenceCoreContracts).not.toHaveProperty(
      "adminConnectedAppUpdateRequestSchema",
    )
    expect(inferenceCoreContracts).not.toHaveProperty(
      "adminConnectedAppRotateCredentialResultSchema",
    )
    expect(inferenceCoreContracts).not.toHaveProperty(
      "adminConnectedAppFirecrawlPolicyRequestSchema",
    )
  })

  it("accepts only retained Overview tiles", () => {
    const hrefById = {
      applications: "/keys",
      hardware: "/hardware",
      inference: "/inference",
      system: "/settings",
    } as const
    const tile = (id: "applications" | "inference" | "hardware" | "system") =>
      ({
        href: hrefById[id],
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
        generatedAt: timestamp,
        tiles: [
          tile("applications"),
          tile("inference"),
          tile("hardware"),
          tile("system"),
        ],
        tokenUsage: {
          points: [
            { date: "2026-07-30", tokens: 100 },
            { date: "2026-07-31", tokens: 250 },
          ],
          range: "90d",
          sourceStatus: "ok",
        },
      }).success,
    ).toBe(true)
    expect(
      adminOverviewTileSchema.safeParse({
        ...tile("system"),
        id: "governance",
      }).success,
    ).toBe(false)
    expect(
      adminOverviewTileSchema.safeParse({
        ...tile("inference"),
        href: "https://litellm.example.test",
      }).success,
    ).toBe(false)
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
        tokenUsage: { points: [], range: "90d", sourceStatus: "ok" },
      }).success,
    ).toBe(false)
  })

  it("requires authoritative, unique, ordered Overview token usage", () => {
    const base = {
      points: [
        { date: "2026-07-30", tokens: 100 },
        { date: "2026-07-31", tokens: 250 },
      ],
      range: "90d",
      sourceStatus: "ok",
    } as const

    expect(
      adminOverviewResponseSchema.shape.tokenUsage.safeParse(base).success,
    ).toBe(true)
    expect(
      adminOverviewResponseSchema.shape.tokenUsage.safeParse({
        ...base,
        points: [...base.points].reverse(),
      }).success,
    ).toBe(false)
    expect(
      adminOverviewResponseSchema.shape.tokenUsage.safeParse({
        ...base,
        points: [base.points[0], base.points[0]],
      }).success,
    ).toBe(false)
    expect(
      adminOverviewResponseSchema.shape.tokenUsage.safeParse({
        ...base,
        sourceStatus: "unavailable",
      }).success,
    ).toBe(false)
  })

  it("models alert egress as redacted intent pending runtime qualification", () => {
    expect(
      updateAdminAlertEgressRequestSchema.parse({
        expectedRevision: 0,
        transport: "webhook",
        warningAcknowledgement: {
          accepted: true,
          version: "alert-egress-v1",
        },
      }),
    ).toMatchObject({ transport: "webhook" })
    expect(
      updateAdminAlertEgressRequestSchema.safeParse({
        expectedRevision: 0,
        transport: "webhook",
        url: "https://destination.example.test/hook",
        warningAcknowledgement: {
          accepted: true,
          version: "alert-egress-v1",
        },
      }).success,
    ).toBe(false)
    expect(
      updateAdminAlertEgressRequestSchema.safeParse({
        expectedRevision: 0,
        transport: "disabled",
        warningAcknowledgement: {
          accepted: true,
          version: "alert-egress-v1",
        },
      }).success,
    ).toBe(false)
    expect(
      adminAlertEgressResponseSchema.parse({
        deliveryState: "prepared_pending_runtime_qualification",
        destinationState: "not_stored",
        outboundDeliveryEnabled: false,
        revision: 1,
        runtimeQualified: false,
        secretState: "not_stored",
        transport: "smtp",
        updatedAt: timestamp,
        updatedBySubjectId: "admin-1",
        warningAcknowledgedAt: timestamp,
        warningAcknowledgedBySubjectId: "admin-1",
        warningVersion: "alert-egress-v1",
      }),
    ).toMatchObject({
      outboundDeliveryEnabled: false,
      runtimeQualified: false,
    })
  })

  it("limits Team to Admin and Operator without retired unlock or break-glass fields", () => {
    expect(adminTeamMemberSchema.safeParse(member).success).toBe(true)
    expect(
      adminTeamMemberSchema.safeParse({ ...member, keycloakHref: null })
        .success,
    ).toBe(false)
    expect(
      adminTeamMemberSchema.safeParse({ ...member, role: "builder" }).success,
    ).toBe(false)
    const memberDetail = {
      activity: [
        {
          action: "keycloak.authentication.succeeded",
          createdAt: timestamp,
          id: "event-1",
          targetId: "operator-1",
          targetType: "keycloak_subject",
        },
      ],
      member,
    }
    expect(adminTeamMemberDetailSchema.safeParse(memberDetail).success).toBe(
      true,
    )
    expect(
      adminTeamMemberDetailSchema.safeParse({
        ...memberDetail,
        usage: {},
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
      adminTeamGroupDetailSchema.safeParse({
        group: { ...group, keycloakHref: null },
        members: [member],
      }).success,
    ).toBe(false)
    expect(
      adminTeamOverviewResponseSchema.safeParse({
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
      authMethod: "api_key",
      connectionStatus: "not_connected",
      createdAt: timestamp,
      credentials: [staticCredential],
      description: "Desktop chat application",
      detailHref: "/keys/apps/app-1",
      id: "app-1",
      lastConnectedAt: null,
      maxConcurrentRequests: null,
      maxContextBytes: null,
      modelMode: "manual",
      name: "Desktop",
      rateLimitRps: null,
      status: "enabled",
      tokenAlertState: null,
      tokenAlertThreshold7d: null,
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
        modelMode: "manual",
        name: "Desktop",
      }),
    ).toMatchObject({
      authMethod: "api_key",
      maxConcurrentRequests: null,
      maxContextBytes: null,
      modelMode: "manual",
      rateLimitRps: null,
      tokenAlertThreshold7d: null,
    })
    expect(
      adminConnectedAppCreateRequestSchema.parse({ name: "Default Key" }),
    ).toMatchObject({
      allowedModels: [],
      authMethod: "api_key",
      description: "",
      modelMode: "auto",
    })
    expect(
      adminConnectedAppCreateRequestSchema.safeParse({ name: "" }).success,
    ).toBe(false)
    expect(
      adminConnectedAppCreateRequestSchema.safeParse({
        allowedModels: ["local-chat"],
        modelMode: "auto",
        name: "Invalid Auto Key",
      }).success,
    ).toBe(false)
    expect(
      adminConnectedAppCreateRequestSchema.safeParse({
        allowedModels: [],
        modelMode: "manual",
        name: "Invalid Manual Key",
      }).success,
    ).toBe(false)
    expect(
      adminConnectedAppCredentialSchema.safeParse({
        apiKey: "llmm_t4_once_only",
        authMethod: "api_key",
        bffBaseUrl: "https://api.example.test",
        credentialId: "credential-1",
        exampleCurl: "curl example",
        issuedAt: timestamp,
        keyPrefix: "llmm_t4_once",
        model: "local-chat",
        openAiBaseUrl: "https://api.example.test/v1",
      }).success,
    ).toBe(true)
    const oauthCredential = {
      authMethod: "oauth_client_credentials",
      bffBaseUrl: "https://api.example.test",
      clientId: "client-1",
      clientSecret: "one-time-secret",
      credentialId: "credential-2",
      exampleCurl: "curl example",
      issuedAt: timestamp,
      keyPrefix: null,
      model: "local-chat",
      openAiBaseUrl: "https://api.example.test/v1",
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
        confirmation: "DELETE KEY",
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
      "xpu_temperature",
      "xpu_utilization",
      "xpu_memory_utilization",
      "xpu_device_health",
      "xpu_frequency_status",
      "ram_usage",
      "filesystem_usage",
      "bmc_sensor_health",
      "chassis_power_state",
      "chassis_temperature",
      "fan_speed",
      "power_draw",
      "monthly_energy_projection",
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
      unit: (
        {
          bmc_sensor_health: "state",
          chassis_power_state: "state",
          chassis_temperature: "celsius",
          cpu_utilization: "percent",
          fan_speed: "rpm",
          filesystem_usage: "percent",
          monthly_energy_projection: "kilowatt_hour",
          network_throughput: "bytes_per_second",
          power_draw: "watt",
          ram_usage: "percent",
          xpu_device_health: "state",
          xpu_frequency_status: "state",
          xpu_memory_utilization: "percent",
          xpu_temperature: "celsius",
          xpu_utilization: "percent",
        } as const
      )[id],
    }))

    expect(
      adminHardwareResponseSchema.safeParse({
        activeAlerts: [],
        alertSourceStatus: "ok",
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
    const inferenceDashboard = {
      aggregateUsageSourceStatus: "ok",
      generatedAt: timestamp,
      liteLlmUrl: null,
      modelInventorySourceStatus: "ok",
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
      virtualKeysSourceStatus: "ok",
    }
    expect(
      adminInferenceDashboardSchema.safeParse(inferenceDashboard).success,
    ).toBe(true)
    expect(
      adminInferenceDashboardSchema.safeParse({
        ...inferenceDashboard,
        liteLlmUrl: "https://litellm.example.test",
      }).success,
    ).toBe(false)
    expect(
      inferenceCoreContracts.adminHardwareChartSchema.safeParse({
        ...charts[0],
        grafanaUrl: "https://grafana.example.test",
      }).success,
    ).toBe(false)
    expect(
      adminInferenceDashboardSchema.safeParse({
        ...inferenceDashboard,
        modelUpdate: null,
      }).success,
    ).toBe(false)
    expect(
      adminInferenceDashboardSchema.safeParse({
        ...inferenceDashboard,
        aggregateUsageSourceStatus: "unavailable",
        totals: null,
      }).success,
    ).toBe(true)
    expect(
      adminInferenceDashboardSchema.safeParse({
        ...inferenceDashboard,
        aggregateUsageSourceStatus: "unavailable",
      }).success,
    ).toBe(false)
    expect(
      adminInferenceDashboardSchema.safeParse({
        ...inferenceDashboard,
        aggregateUsageSourceStatus: "unavailable",
        modelUsage: [
          {
            lastUsedAt: null,
            model: "historical-model",
            requests: 1,
            spendUsd: null,
            tokens: 10,
          },
        ],
        totals: null,
      }).success,
    ).toBe(false)
    expect(
      adminInferenceDashboardSchema.safeParse({
        ...inferenceDashboard,
        modelInventorySourceStatus: "unavailable",
      }).success,
    ).toBe(false)
    expect(
      adminInferenceDashboardSchema.safeParse({
        ...inferenceDashboard,
        modelInventorySourceStatus: "unavailable",
        models: [],
      }).success,
    ).toBe(true)
  })

  it("fails closed on unproven private-service audit ingestion", () => {
    expect(
      inferenceCoreNativeAuditCapabilitySchema.shape.source.options,
    ).toEqual(["litellm", "grafana", "keycloak", "alertmanager"])
    expect(
      inferenceCoreNativeAuditCapabilitySchema.parse({
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
      inferenceCoreNativeAuditCapabilitySchema.safeParse({
        detail: "Assumed ingestion",
        ingestionEnabled: true,
        mechanism: "polling",
        nativeIngestionState: "enabled",
        source: "grafana",
      }).success,
    ).toBe(false)
  })

  it("models the metadata-only paginated audit and signed-export verification contract", () => {
    expect(
      inferenceCoreNativeAuditCapabilitySchema.parse({
        detail: "Ingress source exists but runtime no-bypass proof is pending.",
        ingestionEnabled: false,
        mechanism: "product_owned_audited_ingress",
        nativeIngestionState: "implemented_pending_runtime_qualification",
        source: "grafana",
      }),
    ).toMatchObject({
      ingestionEnabled: false,
      mechanism: "product_owned_audited_ingress",
      nativeIngestionState: "implemented_pending_runtime_qualification",
    })
    expect(
      adminAuditResponseSchema.parse({
        events: [
          {
            action: "admin.audit.read",
            actorId: "subject-1",
            createdAt: timestamp,
            id: "00000000-0000-4000-8000-000000000001",
            metadata: [],
            outcome: "succeeded",
            reason: null,
            severity: "info",
            sourceSystem: "console",
            targetId: "subject-1",
            targetType: "keycloak_subject",
          },
        ],
        generatedAt: timestamp,
        nextCursor: "cursor_1",
        query: null,
        selectedApplicationId: "app-1",
        selectedEventId: null,
        selectedOutcome: "succeeded",
        selectedSeverity: "info",
        selectedSource: "console",
        sourceStatus: "ok",
        sources: [
          {
            cursorHealth: "not_applicable",
            id: "console",
            ingressReadiness: "not_applicable",
            label: "Console",
            lastAttemptAt: null,
            lastErrorCode: null,
            lastEventAt: null,
            lastSuccessAt: null,
            sourceStatus: "ok",
          },
        ],
      }),
    ).toMatchObject({ selectedApplicationId: "app-1" })
    expect(
      adminAuditVerificationKeysResponseSchema.safeParse({
        activeKid: "audit-2026-08",
        keys: [
          {
            alg: "EdDSA",
            crv: "Ed25519",
            d: "private-material",
            kid: "audit-2026-08",
            kty: "OKP",
            use: "sig",
            x: "A".repeat(43),
          },
        ],
      }).success,
    ).toBe(false)
  })
})
