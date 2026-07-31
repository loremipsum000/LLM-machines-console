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

  return {
    id,
    title: surface.title,
    configured: false,
    url: null,
    fallbackUrl: null,
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

  return canUseWebFixtureData() ? "https://librechat.example.test" : null
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
    sandbox: "allow-forms allow-same-origin allow-scripts allow-popups",
    title: "Grafana",
  },
  keycloak: {
    description: "Identity administration drilldown behind the shared realm.",
    sandbox: "allow-forms allow-same-origin allow-scripts allow-popups",
    title: "Keycloak Admin",
  },
  litellm: {
    description: "Model gateway operations and routing drilldown.",
    sandbox: "allow-forms allow-same-origin allow-scripts allow-popups",
    title: "LiteLLM",
  },
} as const
import { canUseWebFixtureData } from "../runtime/fixture-mode"
