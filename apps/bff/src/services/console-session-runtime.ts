import { loadRootConsoleSessionCipher } from "../auth/console-session-keyring"
import { createConsoleTokenValidator } from "../auth/console-session-token-validator"
import type { InferenceCoreDatabase } from "../db/inference-core-client"
import type { ConsoleSessionRouteOptions } from "../routes/console-session"
import { createConsoleOidcClient } from "./console-session-oidc"
import {
  ConsoleSessionService,
  type RefreshFailureTelemetry,
} from "./console-session-service"
import { DrizzleConsoleSessionRepository } from "./console-session-store-drizzle"

export interface ConsoleSessionRuntimeConfig {
  accessAudience: string
  authorizationEndpoint: string
  clientId: string
  clientSecret: string
  consoleOrigin: string
  elevationAcrValues?: string
  internalServiceCredential: string
  issuer: string
  jwksUrl: string
  keyringFile: string
  redirectUri: string
  revocationEndpoint: string
  tokenEndpoint: string
}

export interface ConsoleSessionRuntime {
  close(): void
  routeOptions: ConsoleSessionRouteOptions
  service: ConsoleSessionService
}

export function readConsoleSessionRuntimeConfig(
  environment: NodeJS.ProcessEnv = process.env,
): ConsoleSessionRuntimeConfig {
  const consoleHost = publicProductHost(environment, "PRODUCT_CONSOLE_HOST")
  const identityHost = publicProductHost(environment, "PRODUCT_IDENTITY_HOST")
  const consoleOrigin = secureOrigin(
    "CONSOLE_ORIGIN",
    required(environment, "CONSOLE_ORIGIN"),
  )
  const issuer = secureIssuer(
    "KEYCLOAK_ISSUER_URL",
    required(environment, "KEYCLOAK_ISSUER_URL"),
  )
  assertProductAuthority("CONSOLE_ORIGIN", consoleOrigin, consoleHost)
  assertProductAuthority("KEYCLOAK_ISSUER_URL", issuer, identityHost)
  const oidcBase = `${issuer}/protocol/openid-connect`
  return {
    accessAudience: required(environment, "KEYCLOAK_AUDIENCE"),
    authorizationEndpoint: `${oidcBase}/auth`,
    clientId: required(environment, "CONSOLE_OIDC_CLIENT_ID"),
    clientSecret: required(environment, "CONSOLE_OIDC_CLIENT_SECRET"),
    consoleOrigin,
    elevationAcrValues: optional(
      environment,
      "CONSOLE_OIDC_ELEVATION_ACR_VALUES",
    ),
    internalServiceCredential: required(environment, "BFF_SERVICE_API_KEY"),
    issuer,
    jwksUrl: `${oidcBase}/certs`,
    keyringFile: required(environment, "CONSOLE_SESSION_KEYRING_FILE"),
    redirectUri: `${consoleOrigin}/api/console/session/callback`,
    revocationEndpoint: `${oidcBase}/revoke`,
    tokenEndpoint: `${oidcBase}/token`,
  }
}

export function createConsoleSessionRuntimeFromEnv(input: {
  database: InferenceCoreDatabase | null
  environment?: NodeJS.ProcessEnv
  telemetry?: RefreshFailureTelemetry
}): ConsoleSessionRuntime {
  if (!input.database) {
    throw new Error("PostgreSQL is required for durable Console sessions.")
  }
  const config = readConsoleSessionRuntimeConfig(input.environment)
  const cipher = loadRootConsoleSessionCipher(config.keyringFile)
  try {
    const oidc = createConsoleOidcClient({
      authorizationEndpoint: config.authorizationEndpoint,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      elevationAcrValues: config.elevationAcrValues,
      redirectUri: config.redirectUri,
      revocationEndpoint: config.revocationEndpoint,
      tokenEndpoint: config.tokenEndpoint,
    })
    const validator = createConsoleTokenValidator({
      accessAudience: config.accessAudience,
      clientId: config.clientId,
      issuer: config.issuer,
      jwksUrl: config.jwksUrl,
    })
    const service = new ConsoleSessionService(
      new DrizzleConsoleSessionRepository(input.database),
      cipher,
      oidc,
      validator,
      input.telemetry ?? stderrRefreshFailureTelemetry,
      { clientId: config.clientId, issuer: config.issuer },
    )
    return {
      close: () => cipher.destroy(),
      routeOptions: {
        backchannelVerifier: validator,
        consoleOrigin: config.consoleOrigin,
        identityIssuer: config.issuer,
        internalServiceCredential: config.internalServiceCredential,
        service,
      },
      service,
    }
  } catch (error) {
    cipher.destroy()
    throw error
  }
}

const stderrRefreshFailureTelemetry: RefreshFailureTelemetry = {
  record(event) {
    process.stderr.write(
      `${JSON.stringify({
        event: event.event,
        level: "warn",
        message: "Console session refresh failed",
        reason: event.reason,
        sessionReference: event.sessionReference,
      })}\n`,
    )
  },
}

function required(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim()
  if (!value) {
    throw new Error(`Console session configuration is missing ${name}.`)
  }
  return value
}

function optional(
  environment: NodeJS.ProcessEnv,
  name: string,
): string | undefined {
  return environment[name]?.trim() || undefined
}

function publicProductHost(
  environment: NodeJS.ProcessEnv,
  name: "PRODUCT_CONSOLE_HOST" | "PRODUCT_IDENTITY_HOST",
): string {
  const value = required(environment, name)
  if (
    value.length > 253 ||
    value !== value.toLowerCase() ||
    value.includes(":") ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(value) ||
    !value
      .split(".")
      .every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
  ) {
    throw new Error(`${name} must be a valid Product hostname.`)
  }
  return value
}

function assertProductAuthority(
  name: "CONSOLE_ORIGIN" | "KEYCLOAK_ISSUER_URL",
  value: string,
  expectedHost: string,
): void {
  const url = new URL(value)
  if (url.hostname !== expectedHost || url.port !== "") {
    throw new Error(`${name} must use its declared Product authority.`)
  }
}

function secureOrigin(name: string, value: string): string {
  const url = secureUrl(name, value)
  if (url.pathname !== "/") {
    throw new Error(`${name} must contain only an HTTPS origin.`)
  }
  return url.origin
}

function secureIssuer(name: string, value: string): string {
  const url = secureUrl(name, value)
  const pathname = url.pathname.replace(/\/+$/, "")
  return `${url.origin}${pathname}`
}

function secureUrl(name: string, value: string): URL {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${name} must be an absolute HTTPS URL.`)
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    hasUnsafeUrlCharacter(value) ||
    /%(?:2f|5c)/i.test(value)
  ) {
    throw new Error(`${name} must be an absolute HTTPS URL.`)
  }
  return url
}

function hasUnsafeUrlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return character === "\\" || codePoint < 32 || codePoint === 127
  })
}
