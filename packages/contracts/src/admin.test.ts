import { describe, expect, it } from "vitest"
import {
  adminApprovalQueueResponseSchema,
  adminAuditResponseSchema,
  adminBuilderAgentStudioQuotaPolicySchema,
  adminConnectorVettingDecisionRequestSchema,
  adminConnectorRegistryResponseSchema,
  adminConnectedAppCreateRequestSchema,
  adminConnectedAppCreateResponseSchema,
  adminConnectedAppDetailSchema,
  adminConnectedAppPromotionResultSchema,
  adminConnectedAppRotateCredentialResultSchema,
  adminConnectedAppsResponseSchema,
  adminConnectedAppTestResultSchema,
  adminConnectedAppUpdateRequestSchema,
  adminConnectedAppAuthMethodSchema,
  adminConnectedAppEnvironmentSchema,
  adminMcpServerDetailSchema,
  adminMcpServerConnectionTestRequestSchema,
  adminHardwareResponseSchema,
  adminInferenceDashboardSchema,
  adminInferenceModelUpdateActionResponseSchema,
  adminOverviewResponseSchema,
  adminPolicyViolationsResponseSchema,
  adminPureModeResponseSchema,
  adminSettingsResponseSchema,
  adminTeamCsvImportCommitResponseSchema,
  adminTeamCsvImportPreviewResponseSchema,
  adminTeamGroupDetailSchema,
  adminTeamGroupMutationResponseSchema,
  adminTeamMemberDetailSchema,
  adminTeamOverviewResponseSchema,
  createAdminUrlPolicyRuleRequestSchema,
  createAdminMcpServerRequestSchema,
  createAdminTeamMemberRequestSchema,
  adminPureModeTransitionRequestSchema,
  sendAdminTeamEmailRequestSchema,
  deleteAdminTeamMemberRequestSchema,
  updateAdminTeamBreakGlassRequestSchema,
  updateAdminSettingsOrganizationRequestSchema,
  updateAdminSettingsTelemetryRequestSchema,
  updateAdminMcpServerRequestSchema,
  updateAdminTeamMemberGroupsRequestSchema,
  updateAdminBuilderAgentStudioQuotaPolicyRequestSchema,
  applyAdminInferenceModelUpdateRequestSchema,
} from "./admin"

describe("Admin contracts", () => {
  it("parses the read-only Admin overview federation shape", () => {
    const overview = adminOverviewResponseSchema.parse({
      generatedAt: "2026-05-21T11:00:00.000Z",
      tiles: [
        {
          id: "ops",
          title: "LLM operations",
          summary: "Usage and latency from the model gateway.",
          href: "/inference",
          sourceStatus: "degraded",
          updatedAt: "2026-05-21T11:00:00.000Z",
          metrics: [
            {
              id: "prompts",
              label: "Prompts",
              value: "1,280",
              detail: "30d window",
              tone: "neutral",
            },
          ],
        },
        {
          id: "health",
          title: "Health",
          summary: "Infrastructure health summary.",
          href: "/hardware",
          sourceStatus: "not_configured",
          updatedAt: "2026-05-21T11:00:00.000Z",
          metrics: [
            {
              id: "alerts",
              label: "Alerts",
              value: "0",
              detail: null,
              tone: "good",
            },
          ],
        },
        {
          id: "governance",
          title: "Governance",
          summary: "Review queue and blocked connectors.",
          href: "/applications",
          sourceStatus: "degraded",
          updatedAt: "2026-05-21T11:00:00.000Z",
          metrics: [
            {
              id: "pending-submissions",
              label: "Submissions",
              value: "1",
              detail: "Awaiting review",
              tone: "warning",
            },
          ],
        },
        {
          id: "activity",
          title: "Activity",
          summary: "Recent audit activity.",
          href: "#audit-log-deferred",
          sourceStatus: "ok",
          updatedAt: "2026-05-21T11:00:00.000Z",
          metrics: [
            {
              id: "events",
              label: "Events",
              value: "1",
              detail: "Latest audit records",
              tone: "neutral",
            },
          ],
        },
      ],
      activityEvents: [
        {
          id: "audit-1",
          actorId: "admin-1",
          action: "admin.builder_resource.approve",
          targetType: "builder.resources",
          targetId: "resource-1",
          severity: "info",
          href: "#audit-log-deferred",
          createdAt: "2026-05-21T10:59:00.000Z",
        },
      ],
    })

    expect(overview.tiles.map((tile) => tile.id)).toEqual([
      "ops",
      "health",
      "governance",
      "activity",
    ])
  })

  it("parses the Admin hardware federation shape", () => {
    const response = adminHardwareResponseSchema.parse({
      generatedAt: "2026-05-21T12:00:00.000Z",
      range: "6h",
      step: "180s",
      selectedHost: "all",
      availableHosts: ["core-appliance"],
      sourceStatus: "ok",
      summary: "Prometheus is returning all 7 curated hardware signals.",
      grafanaUrl:
        "https://grafana.example.test/d/llmm-infra-overview/llm-machines-infrastructure-overview",
      alertmanagerUrl: null,
      charts: [
        "cpu_utilization",
        "gpu_temperature",
        "gpu_utilization",
        "ram_usage",
        "filesystem_usage",
        "power_draw",
        "network_throughput",
      ].map((id) => ({
        id,
        title: id,
        description: "Hardware signal.",
        chartType: id === "filesystem_usage" ? "bar" : "area",
        unit:
          id === "gpu_temperature"
            ? "celsius"
            : id === "network_throughput"
              ? "bytes_per_second"
              : id === "power_draw"
                ? "watt"
                : "percent",
        promql: "up",
        sourceStatus: "ok",
        emptyMessage: "No data.",
        grafanaUrl: null,
        thresholds: [
          { label: "High", severity: "warning", value: 85, unit: "percent" },
        ],
        series: [
          {
            id: `${id}-1`,
            label: "core-appliance",
            host: "core-appliance",
            device: null,
            direction: null,
            metricSource: "node_exporter",
            points: [
              {
                timestamp: "2026-05-21T12:00:00.000Z",
                value: 42,
              },
            ],
          },
        ],
      })),
      activeAlerts: [],
    })

    expect(response.charts).toHaveLength(7)
    expect(response.charts[0]?.series[0]?.points[0]?.value).toBe(42)
  })

  it("parses the Admin Inference dashboard shape", () => {
    const response = adminInferenceDashboardSchema.parse({
      generatedAt: "2026-05-30T12:00:00.000Z",
      liteLlmUrl: "https://litellm.example.test/ui/",
      modelUpdate: {
        affectedModels: ["qwen3-35b-local"],
        availableVersion: "2026.05.30",
        currentVersion: "2026.05.01",
        detail: "New local model bundle is ready.",
        estimatedDowntime: "2 minutes",
        releaseNotes: "Improves Croatian retrieval answers.",
        status: "available",
        updateActionEnabled: true,
      },
      modelUsage: [
        {
          lastUsedAt: "2026-05-30T11:59:00.000Z",
          model: "qwen3-35b-local",
          requests: 12,
          spendUsd: 0,
          tokens: 1800,
        },
      ],
      models: [
        {
          contextWindow: 32768,
          id: "model-qwen",
          mode: "chat",
          name: "qwen3-35b-local",
          outputCostPerMillionTokens: 0,
          provider: "llama.cpp",
          sourceStatus: "ok",
        },
      ],
      range: "30d",
      sourceStatus: "ok",
      summary: "LiteLLM reports 12 requests and 1,800 tokens.",
      totals: {
        requests: 12,
        tokens: 1800,
      },
      usagePoints: [
        {
          requests: 12,
          timestamp: "2026-05-30T00:00:00.000Z",
          tokens: 1800,
        },
      ],
      virtualKeys: [
        {
          alias: "agentic-openclaw",
          budgetUsd: 100,
          expiresAt: null,
          id: "key-hash-1",
          lastUsedAt: "2026-05-30T11:50:00.000Z",
          models: ["qwen3-35b-local"],
          owner: "admin@example.test",
          spendUsd: 4.25,
          status: "active",
          team: "Engineering",
        },
      ],
    })

    expect(response.modelUpdate?.status).toBe("available")
    expect(response.virtualKeys[0]?.alias).toBe("agentic-openclaw")
  })

  it("validates the Admin Inference model update confirmation", () => {
    expect(
      applyAdminInferenceModelUpdateRequestSchema.safeParse({
        confirmation: "UPDATE MODEL",
      }).success,
    ).toBe(true)
    expect(
      applyAdminInferenceModelUpdateRequestSchema.safeParse({
        confirmation: "DELETE",
      }).success,
    ).toBe(false)

    const response = adminInferenceModelUpdateActionResponseSchema.parse({
      detail: "Model update started.",
      generatedAt: "2026-05-30T12:00:00.000Z",
      modelUpdate: null,
      status: "started",
    })
    expect(response.status).toBe("started")
  })

  it("parses the Admin approval queue shape", () => {
    const queue = adminApprovalQueueResponseSchema.parse({
      generatedAt: "2026-05-21T11:05:00.000Z",
      query: null,
      sourceStatus: "ok",
      pendingCount: 1,
      items: [
        {
          id: "88888888-8888-4888-8888-888888888888",
          resourceId: "99999999-9999-4999-8999-999999999999",
          resourceName: "Internal Docs Corpus",
          resourceType: "rag_corpus",
          description: "Internal docs corpus awaiting review.",
          ownerId: "builder-1",
          ownerName: "Builder One",
          submittedVersion: "v0.2",
          submittedAt: "2026-05-21T08:45:00.000Z",
          updatedAt: "2026-05-21T08:45:00.000Z",
          reviewHref: "/builder/resources/99999999-9999-4999-8999-999999999999",
          auditHref: "#audit-log-deferred",
        },
      ],
    })

    expect(queue.items[0]?.resourceName).toBe("Internal Docs Corpus")
  })

  it("parses the Admin connector registry shape", () => {
    const registry = adminConnectorRegistryResponseSchema.parse({
      generatedAt: "2026-05-21T11:08:00.000Z",
      query: null,
      sourceStatus: "ok",
      summary: {
        totalCount: 1,
        approvedCount: 1,
        pendingCount: 0,
        blockedCount: 0,
        secretsRequiredCount: 0,
        t2T3Count: 1,
      },
      items: [
        {
          id: "internal-docs",
          displayName: "Internal Docs",
          description:
            "Read-only connector for appliance-local documentation search.",
          version: "0.1.0",
          sourceRef: "llm-machines/catalog/internal-docs@0.1.0",
          checksum: "sha256:internal-docs-placeholder",
          license: "LLM Machines",
          supportTier: "t2",
          maintainer: "LLM Machines",
          vettingStatus: "approved_read_only",
          requiredScopes: ["docs:read"],
          allowedEndpoints: ["docs.example.test:443"],
          readWrite: "read_only",
          dataClasses: ["documentation"],
          auditEvents: ["connector.docs.search", "connector.docs.read"],
          runtimeProfile: "managed-tool-proxy",
          secretsRequired: [],
          lastReviewedAt: "2026-05-20T00:00:00.000Z",
          sourceStatus: "ok",
          posture: "approved",
          effectiveVettingStatus: "approved_read_only",
          localDecision: null,
          runtimeSetup: {
            activeEgress: [],
            detail: "Managed local connector is approved and ready.",
            missingEgress: [],
            missingSecrets: [],
            runnable: true,
            setupHref: "/applications",
            status: "ready",
          },
          reviewHref: "/resources/mcp_connector/internal-docs",
          auditHref: "#audit-log-deferred",
        },
      ],
    })

    expect(registry.summary.pendingCount).toBe(0)
  })

  it("defaults omitted connector vetting checklist assertions to false", () => {
    const request = adminConnectorVettingDecisionRequestSchema.parse({
      decision: "blocked",
      note: "Source provenance failed review.",
    })

    expect(request.checklist).toMatchObject({
      endpointsReviewed: false,
      runtimeSetupAcknowledged: false,
      sourceIntegrityReviewed: false,
    })
  })

  it("parses URL-backed Admin MCP server creation requests", () => {
    const request = createAdminMcpServerRequestSchema.parse({
      accessGroups: ["Everyone"],
      accessLevel: "read_only",
      authMode: "bearer",
      bearerTokenSecretRef: "MCP_DOCS_TOKEN",
      chatCommand: "@docs",
      description: "Internal documentation MCP endpoint.",
      endpointUrl: "https://mcp.example.test/rpc",
      name: "Docs MCP",
      transport: "url",
    })

    expect(request).toMatchObject({
      accessLevel: "read_only",
      saveMode: "enabled",
      transport: "url",
    })
  })

  it("rejects incomplete or invalid Admin MCP server requests", () => {
    expect(() =>
      createAdminMcpServerRequestSchema.parse({
        accessLevel: "read_only",
        authMode: "bearer",
        chatCommand: "docs",
        description: "Missing command prefix and secret.",
        endpointUrl: "https://mcp.example.test/rpc",
        name: "Docs MCP",
        transport: "url",
      }),
    ).toThrow()
    expect(() =>
      createAdminMcpServerRequestSchema.parse({
        accessLevel: "read_only",
        authMode: "none",
        chatCommand: "@docs",
        description: "Missing URL endpoint.",
        name: "Docs MCP",
        transport: "url",
      }),
    ).toThrow()
  })

  it("parses Admin MCP connection test requests without save-only fields", () => {
    const request = adminMcpServerConnectionTestRequestSchema.parse({
      accessLevel: "read_write",
      authMode: "none",
      chatCommand: "@ops",
      description: "Ops MCP endpoint.",
      endpointUrl: "https://ops.example.test/mcp",
      name: "Ops MCP",
      transport: "url",
    })

    expect(request.chatCommand).toBe("@ops")
  })

  it("parses editable Admin MCP server detail and update requests", () => {
    const detail = adminMcpServerDetailSchema.parse({
      accessGroups: ["Security"],
      accessLevel: "read_only",
      auditHref: "#audit-log-deferred",
      authMode: "none",
      bearerTokenSecretRef: null,
      chatCommand: "@docs-mcp",
      createdAt: "2026-05-29T12:00:00.000Z",
      description: "Documentation MCP server.",
      endpointUrl: "https://mcp.example.test/rpc",
      id: "docs-mcp",
      name: "Docs MCP",
      status: "enabled",
      stdioCommand: null,
      supportTier: "t3",
      transport: "url",
      updatedAt: "2026-05-29T12:00:00.000Z",
    })
    const update = updateAdminMcpServerRequestSchema.parse({
      accessGroups: ["Security"],
      accessLevel: "read_write",
      authMode: "bearer",
      bearerTokenSecretRef: "MCP_DOCS_TOKEN",
      description: "Updated documentation MCP server.",
      endpointUrl: "https://mcp.example.test/rpc",
      name: "Docs MCP",
      status: "enabled",
      transport: "url",
    })

    expect(detail.supportTier).toBe("t3")
    expect(update.accessLevel).toBe("read_write")
  })

  it("parses Connected Apps contracts without leaking secrets in public shapes", () => {
    const app = {
      allowedModels: ["qwen3:32b"],
      auditHref: "#audit-log-deferred",
      createdAt: "2026-05-31T08:00:00.000Z",
      description: "HR portal staging integration.",
      detailHref: "/applications/apps/app-hr-portal",
      environments: [
        {
          authMethods: ["api_key"],
          clientId: "llmm-app-hr-portal-staging",
          credentialIssuedAt: "2026-05-31T08:00:00.000Z",
          environment: "staging",
          keyPrefix: "llmm_t4_hr",
          lastUsedAt: null,
          lastTestedAt: null,
          primaryAuthMethod: "api_key",
          productionReady: false,
          testStatus: "not_tested",
        },
      ],
      id: "app-hr-portal",
      name: "HR Portal",
      ownerGroup: "Everyone",
      rateLimitRpm: 60,
      status: "enabled",
      tokenBudget7d: 1_000_000,
      updatedAt: "2026-05-31T08:00:00.000Z",
      usage: {
        failures7d: 0,
        lastUsedAt: null,
        requests7d: 0,
        tokens7d: 0,
      },
    }
    const credential = {
      apiKey: "fixture",
      authMethod: "api_key" as const,
      bffBaseUrl: "https://console.example.test",
      environment: "staging",
      exampleCurl:
        "curl -H 'Authorization: Bearer fixture' https://console.example.test/api/app-gateway/v1/models",
      keyPrefix: "llmm_t4_hr",
      model: "qwen3:32b",
      openAiBaseUrl: "https://console.example.test/api/app-gateway/v1",
    }
    const oauthCredential = {
      authMethod: "oauth_client_credentials" as const,
      bffBaseUrl: "https://console.example.test",
      clientId: "llmm-app-hr-portal-staging",
      clientSecret: "shown-once-secret",
      environment: "staging" as const,
      exampleCurl:
        "curl -H 'Authorization: Bearer <token>' https://console.example.test/api/app-gateway/v1/models",
      keyPrefix: null,
      model: "qwen3:32b",
      openAiBaseUrl: "https://console.example.test/api/app-gateway/v1",
      tokenUrl:
        "https://keycloak.example.test/realms/llm-machines/protocol/openid-connect/token",
    }

    const list = adminConnectedAppsResponseSchema.parse({
      apps: [app],
      generatedAt: "2026-05-31T08:00:00.000Z",
      sourceStatus: "ok",
    })
    const detail = adminConnectedAppDetailSchema.parse({ app })
    const created = adminConnectedAppCreateResponseSchema.parse({
      app,
      credential,
      status: "created",
    })
    const tested = adminConnectedAppTestResultSchema.parse({
      app: {
        ...app,
        environments: [
          {
            ...app.environments[0],
            lastTestedAt: "2026-05-31T08:05:00.000Z",
            productionReady: true,
            testStatus: "passed",
          },
        ],
      },
      detail: "Staging credentials can reach the app gateway.",
      environment: "staging",
      status: "passed",
      testedAt: "2026-05-31T08:05:00.000Z",
    })
    const promoted = adminConnectedAppPromotionResultSchema.parse({
      app,
      credential: { ...credential, environment: "production" },
      detail: "Production credentials created.",
      status: "promoted",
    })
    const rotated = adminConnectedAppRotateCredentialResultSchema.parse({
      app,
      credential,
      detail: "Credentials rotated.",
      status: "rotated",
    })

    expect(adminConnectedAppCreateRequestSchema.parse({
      allowedModels: ["qwen3:32b"],
      description: "HR portal staging integration.",
      name: "HR Portal",
    })).toMatchObject({
      authMethod: "api_key",
      ownerGroup: "Everyone",
      rateLimitRpm: null,
      tokenBudget7d: null,
    })
    expect(adminConnectedAppUpdateRequestSchema.parse({
      allowedModels: ["qwen3:32b"],
      description: "Updated HR portal integration.",
      name: "HR Portal",
      ownerGroup: "Everyone",
      rateLimitRpm: 120,
      tokenBudget7d: 2_000_000,
    })).toMatchObject({ status: "enabled" })
    expect(adminConnectedAppAuthMethodSchema.parse("oauth_client_credentials")).toBe(
      "oauth_client_credentials",
    )
    expect(() => adminConnectedAppEnvironmentSchema.parse("qa")).toThrow()
    expect(JSON.stringify(list)).not.toContain("shown-once-secret")
    expect(JSON.stringify(list)).not.toContain("one-time-key")
    expect(JSON.stringify(detail)).not.toContain("shown-once-secret")
    expect(JSON.stringify(detail)).not.toContain("one-time-key")
    expect(created.credential.apiKey).toBe("fixture")
    expect(adminConnectedAppCreateResponseSchema.parse({
      app: {
        ...app,
        environments: [
          {
            ...app.environments[0],
            authMethods: ["oauth_client_credentials"],
            keyPrefix: null,
            primaryAuthMethod: "oauth_client_credentials",
          },
        ],
      },
      credential: oauthCredential,
      status: "created",
    }).credential.clientSecret).toBe("shown-once-secret")
    expect(tested.status).toBe("passed")
    expect(promoted.credential?.environment).toBe("production")
    expect(rotated.status).toBe("rotated")
  })

  it("parses the basic Admin audit timeline shape", () => {
    const audit = adminAuditResponseSchema.parse({
      generatedAt: "2026-05-21T11:10:00.000Z",
      query: "approve",
      selectedEventId: null,
      sourceStatus: "degraded",
      sources: [
        {
          id: "console",
          label: "Console audit",
          sourceStatus: "ok",
        },
        {
          id: "external",
          label: "External audit sources",
          sourceStatus: "not_configured",
        },
      ],
      events: [
        {
          id: "audit-1",
          actorId: "admin-1",
          action: "admin.builder_resource.approve",
          targetType: "builder.resources",
          targetId: "resource-1",
          reason: null,
          severity: "info",
          metadata: [
            {
              label: "authMode",
              value: "service-forwarded",
            },
          ],
          href: "#audit-log-deferred",
          createdAt: "2026-05-21T10:59:00.000Z",
        },
      ],
    })

    expect(audit.events[0]?.action).toBe("admin.builder_resource.approve")
  })

  it("parses the Admin policy violations drilldown shape", () => {
    const violations = adminPolicyViolationsResponseSchema.parse({
      generatedAt: "2026-05-21T11:20:00.000Z",
      query: "pii",
      sourceStatus: "degraded",
      window: "24h",
      totalCount: 1,
      criticalCount: 1,
      warningCount: 0,
      violations: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          policyId: null,
          policyType: "content_safety",
          severity: "critical",
          actionTaken: "block",
          remediationStatus: "acknowledged",
          remediationActorId: "admin-1",
          remediationAt: "2026-05-21T11:19:30.000Z",
          remediationNote: "Owner notified.",
          actorId: "consumer-1",
          targetType: "chat.thread",
          targetId: "thread-1",
          message: "PII egress blocked.",
          metadata: [{ label: "entity", value: "email" }],
          auditHref: "#audit-log-deferred",
          createdAt: "2026-05-21T11:19:00.000Z",
        },
      ],
    })

    expect(violations.violations[0]?.actionTaken).toBe("block")
    expect(violations.violations[0]?.remediationStatus).toBe("acknowledged")
  })

  it("parses the Admin Pure Mode drilldown shape", () => {
    const pureMode = adminPureModeResponseSchema.parse({
      generatedAt: "2026-05-21T11:25:00.000Z",
      sourceStatus: "ok",
      active: false,
      reason: null,
      activatedBy: null,
      activatedAt: null,
      deactivatedAt: null,
      affectedComponents: [],
      updatedAt: "2026-05-21T11:20:00.000Z",
      control: {
        enabled: false,
        reason:
          "Pure Mode changes require the dedicated audited toggle implementation.",
      },
      recentEvents: [],
    })

    expect(pureMode.control.enabled).toBe(false)
  })

  it("requires typed confirmation for Admin Pure Mode transitions", () => {
    const transition = adminPureModeTransitionRequestSchema.parse({
      action: "activate",
      confirmation: "PURE",
      reason: "Isolate non-core workloads during incident review.",
    })

    expect(transition.action).toBe("activate")
    expect(() =>
      adminPureModeTransitionRequestSchema.parse({
        action: "activate",
        confirmation: "pure",
        reason: "Wrong confirmation casing.",
      }),
    ).toThrow()
  })

  it("parses Admin-managed Builder Agent Studio quota policy", () => {
    const policy = adminBuilderAgentStudioQuotaPolicySchema.parse({
      generatedAt: "2026-05-21T11:30:00.000Z",
      sourceStatus: "ok",
      period: "daily",
      timezone: "UTC",
      source: "admin_override",
      enforced: true,
      runLimit: 20,
      tokenLimit: 120000,
      updatedAt: "2026-05-21T11:29:00.000Z",
      updatedBy: "admin-1",
    })
    const request = updateAdminBuilderAgentStudioQuotaPolicyRequestSchema.parse(
      {
        runLimit: null,
        tokenLimit: 120000,
        note: "Lift run cap during Builder validation.",
      },
    )

    expect(policy.enforced).toBe(true)
    expect(request.runLimit).toBeNull()
  })

  it("parses the Console v2 Settings response shape", () => {
    const settings = adminSettingsResponseSchema.parse({
      generatedAt: "2026-05-29T12:00:00.000Z",
      sourceStatus: "degraded",
      organization: {
        organizationName: "ACME Croatia",
        defaultLanguage: "en",
        fullLogo: settingsLogo("full-logo.png", 480, 120),
        iconLogo: settingsLogo("icon-logo.png", 128, 128),
        updatedAt: "2026-05-29T11:00:00.000Z",
        updatedBy: "admin-1",
      },
      urlPolicyRules: [
        {
          id: "77777777-7777-4777-8777-777777777777",
          type: "trusted",
          pattern: "https://docs.example.test",
          normalizedPattern: "https://docs.example.test/",
          scope: "knowledge_ingestion",
          reason: "Company documentation source.",
          status: "active",
          createdBy: "admin-1",
          updatedBy: "admin-1",
          createdAt: "2026-05-29T11:00:00.000Z",
          updatedAt: "2026-05-29T11:00:00.000Z",
        },
      ],
      reachability: [
        {
          id: "bff",
          label: "BFF/API",
          status: "ok",
          detail: "API process is reachable.",
          owningSection: "settings",
          lastCheckedAt: "2026-05-29T11:59:00.000Z",
        },
      ],
      license: {
        sourceStatus: "not_configured",
        subscriptionState: "not_configured",
        supportState: "License daemon not connected.",
        applianceId: null,
        certificateExpiresAt: null,
        lastEntitlementCheckAt: null,
        offlineMode: true,
        telemetryOptIn: false,
        allowedUpdateChannels: [],
      },
      systemUpdate: {
        sourceStatus: "not_configured",
        status: "not_configured",
        updateActionEnabled: false,
        detail: "System update backend is not configured.",
        availableVersion: null,
        expectedDowntime: null,
        affectedComponents: [],
      },
      privacy: {
        telemetryEnabled: false,
        privacyPolicyHref: "/privacy",
        dataResidencyStatement:
          "Customer data stays on the deployed appliance by default.",
        telemetryDescription:
          "Telemetry is off unless a Console Admin enables it.",
        telemetryPayloadPreview: {
          applianceId: null,
          installedVersion: null,
          updateAgentVersion: null,
          lastUpdateCheck: null,
          lastAppliedUpdate: null,
          subscriptionStateSeenByAppliance: "not_configured",
        },
        updatedAt: null,
        updatedBy: null,
      },
    })

    expect(settings.organization.iconLogo?.width).toBe(128)
    expect(settings.systemUpdate.updateActionEnabled).toBe(false)
  })

  it("rejects invalid Console v2 Settings logo and language values", () => {
    expect(() =>
      updateAdminSettingsOrganizationRequestSchema.parse({
        organizationName: "ACME Croatia",
        defaultLanguage: "de",
      }),
    ).toThrow()
    expect(() =>
      updateAdminSettingsOrganizationRequestSchema.parse({
        organizationName: "ACME Croatia",
        defaultLanguage: "en",
        fullLogo: {
          ...settingsLogo("logo.gif", 100, 100),
          mimeType: "image/gif",
        },
      }),
    ).toThrow()
    expect(() =>
      updateAdminSettingsOrganizationRequestSchema.parse({
        organizationName: "ACME Croatia",
        defaultLanguage: "en",
        fullLogo: {
          ...settingsLogo("big-logo.png", 100, 100),
          sizeBytes: 1024 * 1024 + 1,
        },
      }),
    ).toThrow()
    expect(() =>
      updateAdminSettingsOrganizationRequestSchema.parse({
        organizationName: "ACME Croatia",
        defaultLanguage: "hr",
        iconLogo: settingsLogo("wide-icon.png", 200, 100),
      }),
    ).toThrow()
  })

  it("validates Console v2 Settings URL policy and telemetry requests", () => {
    const policy = createAdminUrlPolicyRuleRequestSchema.parse({
      type: "forbidden",
      pattern: "https://blocked.example.test",
      scope: "all",
      reason: "Contractually forbidden source.",
    })
    const disabledTelemetry = updateAdminSettingsTelemetryRequestSchema.parse({
      enabled: false,
    })
    const enabledTelemetry = updateAdminSettingsTelemetryRequestSchema.parse({
      enabled: true,
      confirmation: "ENABLE TELEMETRY",
    })

    expect(policy.scope).toBe("all")
    expect(disabledTelemetry.enabled).toBe(false)
    expect(enabledTelemetry.enabled).toBe(true)
    expect(() =>
      updateAdminSettingsTelemetryRequestSchema.parse({
        enabled: true,
        confirmation: "enable",
      }),
    ).toThrow()
    expect(() =>
      createAdminUrlPolicyRuleRequestSchema.parse({
        type: "trusted",
        pattern: "not a url",
        reason: "Malformed pattern.",
      }),
    ).toThrow()
    expect(() =>
      createAdminUrlPolicyRuleRequestSchema.parse({
        type: "trusted",
        pattern: "ftp://docs.example.test",
        reason: "",
      }),
    ).toThrow()
  })

  it("parses Console v2 Team member, group, import, SCIM, and break-glass contracts", () => {
    const member = {
      id: "keycloak-user-1",
      username: "ana",
      email: "ana@example.test",
      displayName: "Ana Admin",
      role: "admin",
      groups: ["Support"],
      enabled: true,
      status: "active",
      lastActiveAt: "2026-05-29T12:00:00.000Z",
      createdAt: "2026-05-29T10:00:00.000Z",
      keycloakHref: "/keycloak/users/keycloak-user-1",
    }
    const overview = adminTeamOverviewResponseSchema.parse({
      generatedAt: "2026-05-29T12:00:00.000Z",
      serviceStatus: "ok",
      sourceStatus: "ok",
      members: [member],
      groups: [
        {
          id: "everyone",
          name: "Everyone",
          memberCount: 1,
          unlockCount: 0,
          virtual: true,
          keycloakHref: null,
        },
      ],
      scim: {
        status: "not_configured",
        sourceStatus: "not_configured",
        provider: null,
        lastSyncAt: null,
        detail: "SCIM is configured in Keycloak when available.",
        keycloakHref: "/keycloak/scim",
      },
      breakGlass: {
        selectedAdminId: "keycloak-user-1",
        eligibleAdmins: [member],
        updatedAt: null,
        updatedBy: null,
      },
    })
    const detail = adminTeamMemberDetailSchema.parse({
      member,
      usage: {
        window: "30d",
        prompts: 12,
        tokens: 4200,
        mostUsedModel: "qwen3-35b-local",
        mcpCalls: 3,
        sourceStatus: "ok",
      },
      activity: [
        {
          id: "audit-1",
          action: "connector.mcp.forwarded",
          targetType: "mcp_server",
          targetId: "docs",
          href: "#audit-log-deferred",
          createdAt: "2026-05-29T11:00:00.000Z",
        },
      ],
    })
    const group = adminTeamGroupDetailSchema.parse({
      group: overview.groups[0],
      members: [member],
      unlocks: [
        {
          id: "corpus-1",
          name: "Policies",
          type: "corpus",
          href: "/knowledge?corpus=corpus-1",
        },
      ],
    })
    const groupMutation = adminTeamGroupMutationResponseSchema.parse({
      group: overview.groups[0],
      status: "updated",
    })
    const createMember = createAdminTeamMemberRequestSchema.parse({
      displayName: "Ana Admin",
      email: "ana@example.test",
      groups: ["Support"],
      role: "admin",
    })
    const breakGlassUpdate = updateAdminTeamBreakGlassRequestSchema.parse({
      selectedAdminId: "keycloak-user-1",
    })
    const deleteMember = deleteAdminTeamMemberRequestSchema.parse({
      confirmation: "DELETE",
    })
    const csv = adminTeamCsvImportPreviewResponseSchema.parse({
      generatedAt: "2026-05-29T12:00:00.000Z",
      valid: true,
      rows: [
        {
          line: 2,
          name: "Ana Admin",
          username: "ana",
          email: "ana@example.test",
          group: "Support",
          role: "admin",
          sendInvite: true,
          enabled: true,
          status: "valid",
          actions: ["create_user", "assign_group", "send_invite"],
          errors: [],
        },
      ],
    })
    const committedCsv = adminTeamCsvImportCommitResponseSchema.parse({
      ...csv,
      createdCount: 1,
      failedCount: 0,
      skippedCount: 0,
      rows: [{ ...csv.rows[0], status: "created" }],
    })

    expect(overview.breakGlass.selectedAdminId).toBe("keycloak-user-1")
    expect(detail.usage.mcpCalls).toBe(3)
    expect(group.unlocks[0]?.type).toBe("corpus")
    expect(groupMutation.status).toBe("updated")
    expect(createMember.username).toBeUndefined()
    expect(breakGlassUpdate.selectedAdminId).toBe("keycloak-user-1")
    expect(deleteMember.confirmation).toBe("DELETE")
    expect(csv.rows[0]?.actions).toContain("send_invite")
    expect(committedCsv.createdCount).toBe(1)
  })

  it("rejects invalid Console v2 Team request contracts", () => {
    expect(() =>
      createAdminTeamMemberRequestSchema.parse({
        username: "",
        email: "not-email",
        displayName: "No",
        role: "owner",
      }),
    ).toThrow()
    expect(() =>
      sendAdminTeamEmailRequestSchema.parse({ email: "not-email" }),
    ).toThrow()
    expect(() =>
      updateAdminTeamMemberGroupsRequestSchema.parse({ groups: [""] }),
    ).toThrow()
    expect(() =>
      updateAdminTeamBreakGlassRequestSchema.parse({ selectedAdminId: "" }),
    ).toThrow()
    expect(() =>
      deleteAdminTeamMemberRequestSchema.parse({ confirmation: "delete" }),
    ).toThrow()
    expect(() =>
      adminTeamCsvImportPreviewResponseSchema.parse({
        generatedAt: "2026-05-29T12:00:00.000Z",
        valid: true,
        rows: [
          {
            line: 1,
            name: "Ana Admin",
            username: "ana",
            email: "ana@example.test",
            group: "Support",
            role: "admin",
            sendInvite: true,
            enabled: true,
            status: "valid",
            actions: ["send_password"],
            errors: [],
          },
        ],
      }),
    ).toThrow()
  })
})

function settingsLogo(fileName: string, width: number, height: number) {
  return {
    checksum: `sha256:${fileName}`,
    dataUrl: "data:image/png;base64,iVBORw0KGgo=",
    fileName,
    height,
    mimeType: "image/png",
    sizeBytes: 128,
    updatedAt: "2026-05-29T11:00:00.000Z",
    width,
  }
}
