import "server-only"

import type { RetainedConsoleRole } from "@/lib/auth/role-claims"

export type TechnicalToolId = "grafana" | "keycloak" | "litellm"

export interface TechnicalToolLink {
  access: string
  description: string
  href: string | null
  id: TechnicalToolId
  label: string
}

interface TechnicalToolsEnvironment {
  PRODUCT_GRAFANA_HOST?: string
  PRODUCT_KEYCLOAK_ADMIN_HOST?: string
  PRODUCT_LITELLM_HOST?: string
}

const technicalToolDefinitions = [
  {
    access: "Administrator access as Grafana Editor",
    description:
      "Explore and edit appliance observability dashboards. Grafana server administration is not available.",
    environmentKey: "PRODUCT_GRAFANA_HOST",
    id: "grafana",
    label: "Grafana",
    path: "/d/llmm-infra-overview/llm-machines-infrastructure-overview",
    roles: ["admin"],
  },
  {
    access:
      "Administrator access as proxy_admin; Operator access as internal_user",
    description:
      "Use native virtual keys for advanced technical workflows. Operator access is limited to personal virtual keys and personal spend.",
    environmentKey: "PRODUCT_LITELLM_HOST",
    id: "litellm",
    label: "LiteLLM",
    path: "/ui/",
    roles: ["admin", "operator"],
  },
  {
    access: "Administrator access to the llm-machines appliance realm",
    description:
      "Manage approved users, passwords, and sessions. Master-realm and server-wide administration are not available.",
    environmentKey: "PRODUCT_KEYCLOAK_ADMIN_HOST",
    id: "keycloak",
    label: "Keycloak",
    path: "/keycloak/admin/llm-machines/console/",
    roles: ["admin"],
  },
] as const satisfies ReadonlyArray<{
  access: string
  description: string
  environmentKey: keyof TechnicalToolsEnvironment
  id: TechnicalToolId
  label: string
  path: `/${string}`
  roles: readonly RetainedConsoleRole[]
}>

export function technicalToolsForRole(
  role: RetainedConsoleRole,
  environment: TechnicalToolsEnvironment = {
    PRODUCT_GRAFANA_HOST: process.env.PRODUCT_GRAFANA_HOST,
    PRODUCT_KEYCLOAK_ADMIN_HOST: process.env.PRODUCT_KEYCLOAK_ADMIN_HOST,
    PRODUCT_LITELLM_HOST: process.env.PRODUCT_LITELLM_HOST,
  },
): TechnicalToolLink[] {
  return technicalToolDefinitions
    .filter((tool) => tool.roles.some((allowedRole) => allowedRole === role))
    .map(({ environmentKey, path, roles: _roles, ...tool }) => ({
      ...tool,
      href: credentialFreeHttpsUrl(environment[environmentKey], path),
    }))
}

function credentialFreeHttpsUrl(
  configuredHost: string | undefined,
  path: `/${string}`,
): string | null {
  const host = configuredHost?.trim().toLowerCase()
  if (!host || !isDnsHostname(host)) {
    return null
  }

  const url = new URL(`https://${host}${path}`)
  if (
    url.hostname !== host ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    return null
  }
  return url.href
}

function isDnsHostname(value: string): boolean {
  if (value.length > 253 || value.includes("..")) {
    return false
  }
  const labels = value.split(".")
  return (
    labels.length >= 2 &&
    /^[a-z](?:[a-z0-9-]*[a-z0-9])?$/.test(labels.at(-1) ?? "") &&
    labels.every(
      (label) =>
        label.length > 0 &&
        label.length <= 63 &&
        /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
    )
  )
}
