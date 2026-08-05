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
      jwksUrl:
        "https://identity.example.test/realms/appliance/protocol/openid-connect/certs",
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
    PRODUCT_CONSOLE_HOST: "console.example.test",
    PRODUCT_IDENTITY_HOST: "identity.example.test",
  }
}
