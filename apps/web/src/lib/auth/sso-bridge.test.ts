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

  it("keeps surfaces unconfigured until an embed URL is provided", () => {
    expect(getEmbeddedSurface("grafana")).toMatchObject({
      configured: false,
      fallbackUrl: null,
      id: "grafana",
      title: "Grafana",
      url: null,
    })
  })

  it("derives external operational routes when embeds are absent", () => {
    vi.stubEnv("GRAFANA_PUBLIC_URL", "https://grafana.example")
    vi.stubEnv("KEYCLOAK_PUBLIC_URL", "https://keycloak.example/keycloak")
    vi.stubEnv("LITELLM_PUBLIC_URL", "https://litellm.example")

    expect(getEmbeddedSurface("grafana")).toMatchObject({
      configured: false,
      fallbackUrl:
        "https://grafana.example/d/llmm-infra-overview/llm-machines-infrastructure-overview",
      url: null,
    })
    expect(getEmbeddedSurface("keycloak")).toMatchObject({
      configured: false,
      fallbackUrl:
        "https://keycloak.example/keycloak/admin/master/console/#/llm-machines",
      url: null,
    })
    expect(getEmbeddedSurface("litellm")).toMatchObject({
      configured: false,
      fallbackUrl: "https://litellm.example/ui/",
      url: null,
    })
  })

  it("uses the embed URL as the iframe source and public URL as fallback", () => {
    vi.stubEnv("GRAFANA_EMBED_URL", "https://grafana.example/embed")
    vi.stubEnv("GRAFANA_PUBLIC_URL", "https://grafana.example")

    expect(getEmbeddedSurface("grafana")).toMatchObject({
      configured: true,
      fallbackUrl:
        "https://grafana.example/d/llmm-infra-overview/llm-machines-infrastructure-overview",
      id: "grafana",
      title: "Grafana",
      url: "https://grafana.example/embed",
    })
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
