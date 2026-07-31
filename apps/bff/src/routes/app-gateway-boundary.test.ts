import { readFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"
import { verifyKeycloakJwt } from "../auth/keycloak-jwt"
import { isChatCompletionsBody } from "../inference/chat-completions"
import { evaluateApplicationGatewayPolicy } from "../services/application-gateway-policy"
import { createLiteLlmChatTransport } from "../services/litellm-chat-transport"

describe("retained application gateway import boundary", () => {
  it("uses neutral auth, inference, policy, and transport modules directly", async () => {
    const source = await readFile(
      new URL("./app-gateway.ts", import.meta.url),
      "utf8",
    )

    expect(source).toContain('from "../auth/keycloak-jwt"')
    expect(source).toContain('from "../inference/chat-completions"')
    expect(source).toContain('from "../services/application-gateway-policy"')
    expect(source).toContain('from "../services/litellm-chat-transport"')
    expect(source).not.toContain('from "../auth/persona"')
    expect(source).not.toContain('from "../openai/types"')
    expect(source).not.toContain("agentic")
    expect(source).not.toContain("slash")

    expect(typeof verifyKeycloakJwt).toBe("function")
    expect(typeof isChatCompletionsBody).toBe("function")
    expect(typeof evaluateApplicationGatewayPolicy).toBe("function")
    expect(typeof createLiteLlmChatTransport).toBe("function")
  })
})
