import { randomBytes } from "node:crypto"
import { lookup } from "node:dns/promises"
import { readFileSync } from "node:fs"
import { request as httpsRequest } from "node:https"
import { createConsoleSessionCipher } from "../../apps/bff/src/auth/console-session-crypto"
import { cipherFromSerializedKeyring } from "../../apps/bff/src/auth/console-session-keyring"
import { createConsoleTokenValidator } from "../../apps/bff/src/auth/console-session-token-validator"
import { getInferenceCoreDb } from "../../apps/bff/src/db/inference-core-client"
import { buildServer } from "../../apps/bff/src/index"
import { createConsoleOidcClient } from "../../apps/bff/src/services/console-session-oidc"
import { ConsoleSessionService } from "../../apps/bff/src/services/console-session-service"
import { TestOnlyInMemoryConsoleSessionRepository } from "../../apps/bff/src/services/console-session-store"
import { DrizzleConsoleSessionRepository } from "../../apps/bff/src/services/console-session-store-drizzle"

if (
  process.env.NODE_ENV !== "test" ||
  process.env.BFF_FIXTURE_MODE !== "true"
) {
  throw new Error("The browser-session BFF fixture requires test fixture mode.")
}

const consoleOrigin = required("F0_S1_CONSOLE_ORIGIN")
const issuer = required("F0_S1_IDENTITY_ISSUER")
const clockFile = required("F0_S1_CLOCK_FILE")
const clientId = required("F0_S1_OIDC_CLIENT_ID")
const clientSecret = required("F0_S1_OIDC_CLIENT_SECRET")
const audience = required("F0_S1_OIDC_AUDIENCE")
const internalServiceCredential = required("BFF_SERVICE_API_KEY")
const postgresPersistence = process.env.F0_P1_POSTGRES_PERSISTENCE === "true"
if (
  process.env.F0_P1_POSTGRES_PERSISTENCE !== undefined &&
  !postgresPersistence
) {
  throw new Error("F0-P1 PostgreSQL persistence must be explicitly true.")
}
const firecrawlFixtureUpstream = optionalLoopbackUrl(
  process.env.PRE_GENESIS_FIRECRAWL_UPSTREAM_BASE_URL,
)
const actualFirecrawl = process.env.PRE_GENESIS_FIRECRAWL_ACTUAL === "true"
const firecrawlHosts = parseFirecrawlHosts(
  process.env.PRE_GENESIS_FIRECRAWL_ALLOWED_HOSTS ?? "allowed.example.test",
)
const oidcBase = `${issuer}/protocol/openid-connect`
const localIdentityFetch = createLoopbackIdentityFetch(
  issuer,
  required("F0_S1_CA_FILE"),
)
const cipher = postgresPersistence
  ? cipherFromSerializedKeyring(
      readFileSync(required("F0_P1_SESSION_KEYRING_FILE")),
    )
  : createConsoleSessionCipher({
      activeKid: "f0-s1-throwaway",
      keys: { "f0-s1-throwaway": randomBytes(32) },
    })
const now = () => new Date(readFileSync(clockFile, "utf8").trim())
const rawOidc = createConsoleOidcClient(
  {
    authorizationEndpoint: `${oidcBase}/auth`,
    clientId,
    clientSecret,
    redirectUri: `${consoleOrigin}/api/console/session/callback`,
    revocationEndpoint: `${oidcBase}/revoke`,
    tokenEndpoint: `${oidcBase}/token`,
  },
  localIdentityFetch,
)
const rawValidator = createConsoleTokenValidator(
  {
    accessAudience: audience,
    clientId,
    issuer,
    jwksUrl: `${oidcBase}/certs`,
  },
  localIdentityFetch,
  now,
)
const oidc = {
  authorizationUrl: rawOidc.authorizationUrl,
  async exchangeCode(code: string, verifier: string) {
    const result = await rawOidc.exchangeCode(code, verifier)
    fixtureEvent("oidc_exchange", result)
    return result
  },
  async refresh(refreshToken: string) {
    const result = await rawOidc.refresh(refreshToken)
    fixtureEvent("oidc_refresh", result)
    return result
  },
  revoke: rawOidc.revoke,
}
const validator = {
  async readiness() {
    const result = await rawValidator.readiness()
    fixtureEvent("validator_readiness", result)
    return result
  },
  async validate(...input: Parameters<typeof rawValidator.validate>) {
    const result = await rawValidator.validate(...input)
    fixtureEvent("validator_validate", result)
    return result
  },
  verify: rawValidator.verify,
}
const service = new ConsoleSessionService(
  postgresPersistence
    ? new DrizzleConsoleSessionRepository(requiredInferenceCoreDb())
    : new TestOnlyInMemoryConsoleSessionRepository(),
  cipher,
  oidc,
  validator,
  {
    record(event) {
      process.stderr.write(
        `${JSON.stringify({
          event: event.event,
          reason: event.reason,
          sessionReference: event.sessionReference,
        })}\n`,
      )
    },
  },
  { clientId, issuer },
  now,
)
const rawBeginLogin = service.beginLogin.bind(service)
service.beginLogin = async (returnTo) => {
  try {
    return await rawBeginLogin(returnTo)
  } catch (error) {
    const metadata = postgresErrorMetadata(error)
    process.stderr.write(
      `${JSON.stringify({ event: "login_storage_failure", ...metadata })}\n`,
    )
    throw error
  }
}
const rawBeginElevation = service.beginElevation.bind(service)
service.beginElevation = async (input) => {
  process.stderr.write(`${JSON.stringify({ event: "elevation_begin" })}\n`)
  const result = await rawBeginElevation(input)
  process.stderr.write(
    `${JSON.stringify({ event: "elevation_result", state: result.state })}\n`,
  )
  return result
}
const server = buildServer({
  ...(firecrawlFixtureUpstream
    ? {
        testFirecrawlGateway: {
          dnsLookup: async (hostname: string) => {
            if (!firecrawlHosts.has(hostname)) {
              throw new Error("The Firecrawl fixture denied an unknown host.")
            }
            return actualFirecrawl
              ? await lookup(hostname, { all: true, verbatim: true })
              : [{ address: "93.184.216.34", family: 4 as const }]
          },
          fetchImpl: async (
            input: string | URL | Request,
            init?: RequestInit,
          ) => {
            const requested = new URL(input.toString())
            if (
              requested.origin !== "http://firecrawl-api:3002" ||
              (requested.pathname !== "/v2/search" &&
                requested.pathname !== "/v2/scrape") ||
              requested.search
            ) {
              throw new Error("The Firecrawl fixture denied an upstream route.")
            }
            return fetch(
              new URL(requested.pathname, firecrawlFixtureUpstream),
              init,
            )
          },
          upstreamBaseUrl: "http://firecrawl-api:3002",
        },
      }
    : {}),
  testConsoleSessionRouteOptions: {
    backchannelVerifier: validator,
    consoleOrigin,
    identityIssuer: issuer,
    internalServiceCredential,
    service,
  },
})
server.addHook("onClose", async () => cipher.destroy())

await server.listen({
  host: process.env.HOST ?? "127.0.0.1",
  port: Number.parseInt(process.env.PORT ?? "4001", 10),
})

function requiredInferenceCoreDb() {
  const database = getInferenceCoreDb()
  if (!database) {
    throw new Error("F0-P1 requires a disposable PostgreSQL database.")
  }
  return database
}

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`The browser-session BFF fixture requires ${name}.`)
  }
  return value
}

function optionalLoopbackUrl(value: string | undefined): URL | null {
  if (!value) {
    return null
  }
  const url = new URL(value)
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    !url.port ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  ) {
    throw new Error(
      "The Firecrawl fixture upstream must be local and temporary.",
    )
  }
  return url
}

function parseFirecrawlHosts(value: string): Set<string> {
  const hosts = value.split(",")
  if (
    hosts.length === 0 ||
    hosts.length > 8 ||
    new Set(hosts).size !== hosts.length ||
    hosts.some(
      (entry) =>
        entry !== entry.trim().toLowerCase() ||
        !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(entry),
    )
  ) {
    throw new Error("The Firecrawl fixture requires exact DNS hostnames.")
  }
  return new Set(hosts)
}

function fixtureEvent(
  event: string,
  result: { reason?: string; state: string },
): void {
  process.stderr.write(
    `${JSON.stringify({ event, reason: result.reason, state: result.state })}\n`,
  )
}

function postgresErrorMetadata(error: unknown): {
  code: string
  constraint: string
  name: string
} {
  const value = nestedErrorWithPostgresMetadata(error)
  if (!value) {
    return {
      code: "unknown",
      constraint: "unknown",
      name: "unknown",
    }
  }
  return {
    code: typeof value.code === "string" ? value.code : "unknown",
    constraint:
      typeof value.constraint === "string" ? value.constraint : "unknown",
    name: typeof value.name === "string" ? value.name : "unknown",
  }
}

function nestedErrorWithPostgresMetadata(error: unknown): {
  cause?: unknown
  code?: unknown
  constraint?: unknown
  name?: unknown
} | null {
  let current = error
  for (let depth = 0; depth < 4; depth += 1) {
    if (!current || typeof current !== "object") {
      return null
    }
    const value = current as {
      cause?: unknown
      code?: unknown
      constraint?: unknown
      name?: unknown
    }
    if (
      typeof value.code === "string" ||
      typeof value.constraint === "string"
    ) {
      return value
    }
    current = value.cause
  }
  return error && typeof error === "object"
    ? (error as { cause?: unknown; name?: unknown })
    : null
}

function createLoopbackIdentityFetch(
  issuerValue: string,
  caFile: string,
): typeof fetch {
  const issuerUrl = new URL(issuerValue)
  const ca = readFileSync(caFile)
  return async (input, init = {}) => {
    const url = new URL(input.toString())
    if (
      url.origin !== issuerUrl.origin ||
      url.username ||
      url.password ||
      url.protocol !== "https:"
    ) {
      throw new Error("The F0-S1 identity adapter denied a non-fixture URL.")
    }
    const body = requestBody(init.body)
    return new Promise<Response>((resolveResponse, rejectResponse) => {
      const headers = new Headers(init.headers)
      headers.set("host", url.host)
      if (body && !headers.has("content-length")) {
        headers.set("content-length", String(body.byteLength))
      }
      const request = httpsRequest(
        {
          ca,
          headers: Object.fromEntries(headers),
          host: "127.0.0.1",
          method: init.method ?? "GET",
          path: `${url.pathname}${url.search}`,
          port: Number.parseInt(url.port, 10),
          servername: url.hostname,
        },
        (response) => {
          const chunks: Buffer[] = []
          response.on("data", (chunk: Buffer) => chunks.push(chunk))
          response.once("end", () => {
            const status = response.statusCode ?? 502
            resolveResponse(
              new Response(
                [204, 205, 304].includes(status) ? null : Buffer.concat(chunks),
                {
                  headers: response.headers as HeadersInit,
                  status,
                },
              ),
            )
          })
        },
      )
      request.once("error", rejectResponse)
      const abort = () =>
        request.destroy(
          new DOMException("The operation was aborted.", "AbortError"),
        )
      init.signal?.addEventListener("abort", abort, { once: true })
      request.once("close", () =>
        init.signal?.removeEventListener("abort", abort),
      )
      request.end(body)
    })
  }
}

function requestBody(body: BodyInit | null | undefined): Buffer | undefined {
  if (!body) {
    return undefined
  }
  if (body instanceof URLSearchParams || typeof body === "string") {
    return Buffer.from(body.toString(), "utf8")
  }
  if (body instanceof Uint8Array) {
    return Buffer.from(body)
  }
  throw new Error("The F0-S1 identity adapter denied an unsupported body.")
}
