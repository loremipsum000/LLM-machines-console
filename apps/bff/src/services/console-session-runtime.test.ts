import { describe, expect, it } from "vitest"
import { readConsoleSessionRuntimeConfig } from "./console-session-runtime"

describe("Console session runtime configuration", () => {
  it("derives every OIDC endpoint and the callback from trusted origins", () => {
    const config = readConsoleSessionRuntimeConfig(runtimeEnvironment())

    expect(config).toMatchObject({
      authorizationEndpoint:
        "https://identity.example.test/realms/appliance/protocol/openid-connect/auth",
      consoleOrigin: "https://console.example.test",
      issuer: "https://identity.example.test/realms/appliance",
      identityRequestTimeoutMs: 3000,
      jwksUrl:
        "https://identity.example.test/realms/appliance/protocol/openid-connect/certs",
      logoutEndpoint:
        "https://identity.example.test/realms/appliance/protocol/openid-connect/logout",
      nativeLogoutStartUrl: "https://grafana.example.test/logout",
      redirectUri: "https://console.example.test/api/console/session/callback",
      revocationEndpoint:
        "https://identity.example.test/realms/appliance/protocol/openid-connect/revoke",
      tokenEndpoint:
        "https://identity.example.test/realms/appliance/protocol/openid-connect/token",
    })
  })

  it.each([
    "CONSOLE_ORIGIN",
    "PRODUCT_CONSOLE_HOST",
    "PRODUCT_API_HOST",
    "PRODUCT_FIRECRAWL_HOST",
    "PRODUCT_GRAFANA_HOST",
    "PRODUCT_IDENTITY_HOST",
    "KEYCLOAK_ISSUER_URL",
    "KEYCLOAK_AUDIENCE",
    "CONSOLE_OIDC_CLIENT_ID",
    "CONSOLE_OIDC_CLIENT_SECRET",
    "CONSOLE_SESSION_KEYRING_FILE",
    "BFF_SERVICE_API_KEY",
  ])("fails startup when %s is missing", (name) => {
    const environment = runtimeEnvironment()
    environment[name] = ""

    expect(() => readConsoleSessionRuntimeConfig(environment)).toThrow(name)
  })

  it.each([
    ["CONSOLE_ORIGIN", "http://console.example.test"],
    ["CONSOLE_ORIGIN", "https://console.example.test/native"],
    ["KEYCLOAK_ISSUER_URL", "http://identity.example.test/realms/appliance"],
    ["KEYCLOAK_ISSUER_URL", "https://identity.example.test/realms%2fappliance"],
  ])("rejects unsafe %s value", (name, value) => {
    const environment = runtimeEnvironment()
    environment[name] = value

    expect(() => readConsoleSessionRuntimeConfig(environment)).toThrow(name)
  })

  it.each([
    ["CONSOLE_ORIGIN", "https://other-console.example.test"],
    [
      "KEYCLOAK_ISSUER_URL",
      "https://other-identity.example.test/realms/appliance",
    ],
  ])("rejects %s outside its Product authority", (name, value) => {
    const environment = runtimeEnvironment()
    environment[name] = value

    expect(() => readConsoleSessionRuntimeConfig(environment)).toThrow(name)
  })

  it("rejects every duplicate Product authority pair", () => {
    const names = [
      "PRODUCT_CONSOLE_HOST",
      "PRODUCT_API_HOST",
      "PRODUCT_IDENTITY_HOST",
      "PRODUCT_FIRECRAWL_HOST",
      "PRODUCT_GRAFANA_HOST",
    ] as const
    for (let left = 0; left < names.length; left += 1) {
      for (let right = left + 1; right < names.length; right += 1) {
        const environment = runtimeEnvironment()
        environment[names[right]] = environment[names[left]]
        expect(() => readConsoleSessionRuntimeConfig(environment)).toThrow(
          /distinct hosts/,
        )
      }
    }
  })
})

function runtimeEnvironment(): NodeJS.ProcessEnv {
  return {
    BFF_SERVICE_API_KEY: "internal-service-credential",
    CONSOLE_OIDC_CLIENT_ID: "console-web",
    CONSOLE_OIDC_CLIENT_SECRET: "oidc-client-secret",
    CONSOLE_OIDC_ELEVATION_ACR_VALUES: "urn:llm-machines:mfa",
    CONSOLE_ORIGIN: "https://console.example.test/",
    CONSOLE_SESSION_KEYRING_FILE: "/run/secrets/llmm_console_session_keyring",
    KEYCLOAK_AUDIENCE: "console-bff",
    KEYCLOAK_ISSUER_URL: "https://identity.example.test/realms/appliance/",
    NODE_ENV: "production",
    PRODUCT_API_HOST: "api.example.test",
    PRODUCT_CONSOLE_HOST: "console.example.test",
    PRODUCT_FIRECRAWL_HOST: "firecrawl.example.test",
    PRODUCT_GRAFANA_HOST: "grafana.example.test",
    PRODUCT_IDENTITY_HOST: "identity.example.test",
  }
}
