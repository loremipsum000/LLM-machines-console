export interface EmbeddedSurface {
  id: "grafana" | "keycloak" | "litellm"
  title: string
  configured: boolean
  url: string | null
  fallbackUrl: string | null
  description: string
  sandbox: string
}

export function getEmbeddedSurface(id: EmbeddedSurface["id"]): EmbeddedSurface {
  const surface = embeddedSurfaceConfig[id]
  const url = process.env[surface.envUrl] ?? null
  const fallbackUrl =
    surface.getFallbackUrl() ?? process.env[surface.envFallbackUrl] ?? url

  return {
    id,
    title: surface.title,
    configured: Boolean(url),
    url,
    fallbackUrl,
    description: surface.description,
    sandbox: surface.sandbox,
  }
}

export function getLibreChatPublicUrl(): string | null {
  const configuredUrl =
    process.env.LIBRECHAT_PUBLIC_URL ?? process.env.LIBRECHAT_PUBLIC_ORIGIN
  if (configuredUrl?.trim()) {
    return normalizePublicUrl(configuredUrl)
  }

  return canUseWebFixtureData()
    ? "https://librechat.example.test"
    : null
}

export function getLibreChatConversationUrl(threadId: string): string | null {
  const publicUrl = getLibreChatPublicUrl()
  if (!publicUrl) {
    return null
  }

  return new URL(`/c/${encodeURIComponent(threadId)}`, publicUrl).toString()
}

function normalizePublicUrl(url: string): string {
  return url.replace(/\/+$/, "")
}

const embeddedSurfaceConfig = {
  grafana: {
    description: "Infrastructure observability drilldown for admin operators.",
    envFallbackUrl: "GRAFANA_PUBLIC_URL",
    envUrl: "GRAFANA_EMBED_URL",
    getFallbackUrl: () =>
      dashboardUrl(
        process.env.GRAFANA_PUBLIC_URL ?? process.env.GRAFANA_PUBLIC_ORIGIN,
        "/d/llmm-infra-overview/llm-machines-infrastructure-overview",
      ),
    sandbox: "allow-forms allow-same-origin allow-scripts allow-popups",
    title: "Grafana",
  },
  keycloak: {
    description: "Identity administration drilldown behind the shared realm.",
    envFallbackUrl: "KEYCLOAK_PUBLIC_URL",
    envUrl: "KEYCLOAK_ADMIN_EMBED_URL",
    getFallbackUrl: () =>
      process.env.KEYCLOAK_ADMIN_PUBLIC_URL ??
      appendRelativePath(
        process.env.KEYCLOAK_PUBLIC_URL ?? process.env.KEYCLOAK_PUBLIC_ORIGIN,
        "admin/master/console/#/llm-machines",
      ),
    sandbox: "allow-forms allow-same-origin allow-scripts allow-popups",
    title: "Keycloak Admin",
  },
  litellm: {
    description: "Model gateway operations and routing drilldown.",
    envFallbackUrl: "LITELLM_PUBLIC_URL",
    envUrl: "LITELLM_EMBED_URL",
    getFallbackUrl: () =>
      dashboardUrl(
        process.env.LITELLM_PUBLIC_URL ?? process.env.LITELLM_PUBLIC_ORIGIN,
        "/ui/",
      ),
    sandbox: "allow-forms allow-same-origin allow-scripts allow-popups",
    title: "LiteLLM",
  },
} as const

function dashboardUrl(
  value: string | undefined,
  defaultPath: string,
): string | null {
  return appendPathIfBase(value, defaultPath)
}

function appendPathIfBase(
  value: string | undefined,
  defaultPath: string,
): string | null {
  if (!value) {
    return null
  }

  try {
    const url = new URL(value)
    if (url.pathname === "" || url.pathname === "/") {
      url.pathname = defaultPath
    }
    return url.toString()
  } catch {
    return value
  }
}

function appendRelativePath(
  value: string | undefined,
  relativePath: string,
): string | null {
  if (!value) {
    return null
  }

  try {
    return new URL(relativePath, `${normalizePublicUrl(value)}/`).toString()
  } catch {
    return value
  }
}
import { canUseWebFixtureData } from "../runtime/fixture-mode"
