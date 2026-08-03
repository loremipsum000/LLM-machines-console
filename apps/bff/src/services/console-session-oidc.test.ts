import { describe, expect, it, vi } from "vitest"
import { createConsoleOidcClient } from "./console-session-oidc"

const config = {
  authorizationEndpoint:
    "https://console.example.test/identity/realms/appliance/protocol/openid-connect/auth",
  clientId: "console-web",
  clientSecret: "server-only-client-secret",
  elevationAcrValues: "urn:llm-machines:mfa",
  redirectUri: "https://console.example.test/api/console/session/callback",
  revocationEndpoint:
    "https://keycloak.internal/realms/appliance/protocol/openid-connect/revoke",
  tokenEndpoint:
    "https://keycloak.internal/realms/appliance/protocol/openid-connect/token",
}

describe("Console OIDC code and refresh client", () => {
  it("uses a fixed authorization endpoint, PKCE S256, no offline scope, and forced elevation", () => {
    const client = createConsoleOidcClient(config, vi.fn())
    const normal = new URL(
      client.authorizationUrl({
        codeChallenge: "challenge",
        elevation: false,
        nonce: "nonce",
        state: "state",
      }),
    )
    expect(normal.searchParams.get("code_challenge_method")).toBe("S256")
    expect(normal.searchParams.get("scope")).toBe("openid profile email")
    expect(normal.searchParams.has("max_age")).toBe(false)
    expect(normal.searchParams.get("scope")).not.toContain("offline_access")

    const elevation = new URL(
      client.authorizationUrl({
        codeChallenge: "challenge",
        elevation: true,
        nonce: "nonce",
        state: "state",
      }),
    )
    expect(elevation.searchParams.get("max_age")).toBe("0")
    expect(elevation.searchParams.get("prompt")).toBe("login")
    expect(elevation.searchParams.get("acr_values")).toBe(
      "urn:llm-machines:mfa",
    )
  })

  it("classifies identity restart separately and bounds token response bytes", async () => {
    const restart = createConsoleOidcClient(
      config,
      vi.fn(async () => new Response(null, { status: 503 })),
    )
    await expect(restart.refresh("server-only-refresh")).resolves.toEqual({
      reason: "identity_restart",
      state: "unavailable",
    })

    const oversized = createConsoleOidcClient(
      config,
      vi.fn(
        async () =>
          new Response(JSON.stringify({ access_token: "A".repeat(70_000) }), {
            status: 200,
          }),
      ),
    )
    await expect(oversized.refresh("server-only-refresh")).resolves.toEqual({
      reason: "malformed_response",
      state: "terminal",
    })
  })

  it("does not let remote revocation availability block local logout", async () => {
    vi.useFakeTimers()
    try {
      const request = vi.fn(
        async (_input: string | URL | Request, init?: RequestInit) =>
          await new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              const error = new Error("aborted")
              error.name = "AbortError"
              reject(error)
            })
          }),
      )
      const client = createConsoleOidcClient(
        { ...config, timeoutMs: 25 },
        request as typeof fetch,
      )
      const revoked = client.revoke("server-only-refresh")
      await vi.advanceTimersByTimeAsync(25)
      await expect(revoked).resolves.toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })
})
