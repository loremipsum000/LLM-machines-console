import { afterEach, describe, expect, it, vi } from "vitest"
import { fetchLiteLlmModels } from "./litellm-chat-transport"

describe("LiteLLM production fixture exclusion", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("does not return synthetic models in production when fixture mode is enabled", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("BFF_FIXTURE_MODE", "true")
    vi.stubEnv("BFF_FALLBACK_MODELS", "synthetic-production-model")
    vi.stubEnv("LITELLM_URL", "")
    vi.stubEnv("LITELLM_KEY", "")

    await expect(
      fetchLiteLlmModels(["synthetic-production-model"]),
    ).resolves.toEqual({
      detail: "Set LITELLM_URL and LITELLM_KEY before listing models.",
      ok: false,
      status: 503,
      title: "LiteLLM is not configured",
    })
  })
})
