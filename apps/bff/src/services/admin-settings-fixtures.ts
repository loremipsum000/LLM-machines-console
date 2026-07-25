import type { AdminSettingsResponse } from "@llm-machines/contracts"

export function defaultAdminSettingsResponse(
  generatedAt = new Date().toISOString(),
): AdminSettingsResponse {
  return {
    generatedAt,
    sourceStatus: "not_configured",
    organization: {
      organizationName: "LLM Machines",
      defaultLanguage: "en",
      fullLogo: null,
      iconLogo: null,
      updatedAt: null,
      updatedBy: null,
    },
    urlPolicyRules: [],
    reachability: [
      service("web", "Web/Console", "ok", "Console web surface is available."),
      service(
        "bff",
        "BFF/API",
        "ok",
        "BFF process is responding to authenticated Settings requests.",
      ),
      service(
        "postgres",
        "Postgres",
        "not_configured",
        "Database persistence is not configured.",
      ),
      service(
        "redis",
        "Redis",
        "not_configured",
        "Redis coordination backend is not configured.",
      ),
      service(
        "minio",
        "MinIO",
        "not_configured",
        "Knowledge object storage is not configured.",
      ),
      service(
        "keycloak",
        "Keycloak",
        "not_configured",
        "Keycloak Admin API is not configured.",
        "team",
      ),
      service(
        "litellm",
        "LiteLLM",
        "not_configured",
        "LiteLLM Admin API is not configured.",
        "inference",
      ),
      service(
        "librechat",
        "LibreChat",
        "not_configured",
        "LibreChat public route is not configured.",
        "applications",
      ),
      service(
        "grafana",
        "Grafana",
        "not_configured",
        "Hardware telemetry backend is not configured.",
        "hardware",
      ),
      service(
        "agentic_adapter",
        "Agentic adapter",
        "not_configured",
        "Agentic adapter diagnostics are not configured.",
        "applications",
      ),
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
      detail:
        "System update backend for Proxmox, OS, drivers, and firmware is not implemented yet.",
      availableVersion: null,
      expectedDowntime: null,
      affectedComponents: [],
    },
    privacy: {
      telemetryEnabled: false,
      privacyPolicyHref: "/privacy",
      dataResidencyStatement:
        "Customer prompts, documents, outputs, and logs stay on the deployed appliance by default.",
      telemetryDescription:
        "Telemetry is off by default and can be enabled only after reviewing the exact payload preview.",
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
  }
}

function service(
  id: AdminSettingsResponse["reachability"][number]["id"],
  label: string,
  status: AdminSettingsResponse["reachability"][number]["status"],
  detail: string,
  owningSection: AdminSettingsResponse["reachability"][number]["owningSection"] = "settings",
): AdminSettingsResponse["reachability"][number] {
  return {
    id,
    label,
    status,
    detail,
    owningSection,
    lastCheckedAt: null,
  }
}
