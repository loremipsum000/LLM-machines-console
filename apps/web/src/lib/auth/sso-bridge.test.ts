import { afterEach, describe, expect, it, vi } from "vitest"
import {
  getEmbeddedSurface,
  getLibreChatConversationUrl,
  getLibreChatPublicUrl,
} from "./sso-bridge"

describe("SSO bridge embedded surface config", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("keeps expert surfaces unavailable until the capability gate exists", () => {
    for (const id of ["grafana", "keycloak", "litellm"] as const) {
      expect(getEmbeddedSurface(id)).toMatchObject({
        configured: false,
        fallbackUrl: null,
        id,
        url: null,
      })
    }
  })

  it("does not expose native or embedded URLs from environment alone", () => {
    vi.stubEnv("GRAFANA_PUBLIC_URL", "https://grafana.example")
    vi.stubEnv("GRAFANA_EMBED_URL", "https://grafana.example/embed")
    vi.stubEnv("KEYCLOAK_PUBLIC_URL", "https://keycloak.example/keycloak")
    vi.stubEnv(
      "KEYCLOAK_ADMIN_PUBLIC_URL",
      "https://keycloak.example/admin/realms/llm-machines",
    )
    vi.stubEnv("KEYCLOAK_ADMIN_EMBED_URL", "https://keycloak.example/embed")
    vi.stubEnv("LITELLM_PUBLIC_URL", "https://litellm.example")
    vi.stubEnv("LITELLM_EMBED_URL", "https://litellm.example/embed")

    for (const id of ["grafana", "keycloak", "litellm"] as const) {
      expect(getEmbeddedSurface(id)).toMatchObject({
        configured: false,
        fallbackUrl: null,
        id,
        url: null,
      })
    }
  })

  it("builds LibreChat conversation links from the public URL", () => {
    vi.stubEnv("LIBRECHAT_PUBLIC_URL", "https://librechat.example/")

    expect(getLibreChatConversationUrl("thread-1")).toBe(
      "https://librechat.example/c/thread-1",
    )
  })

  it("does not default LibreChat handoff to the lab host outside fixture mode", () => {
    vi.stubEnv("NODE_ENV", "production")

    expect(getLibreChatPublicUrl()).toBeNull()
    expect(getLibreChatConversationUrl("thread-1")).toBeNull()
  })
})
