import { randomBytes } from "node:crypto"
import { readFileSync } from "node:fs"
import { request as httpsRequest } from "node:https"
import { createConsoleSessionCipher } from "../../apps/bff/src/auth/console-session-crypto"
import { createConsoleTokenValidator } from "../../apps/bff/src/auth/console-session-token-validator"
import { buildServer } from "../../apps/bff/src/index"
import { createConsoleOidcClient } from "../../apps/bff/src/services/console-session-oidc"
import { ConsoleSessionService } from "../../apps/bff/src/services/console-session-service"
import { TestOnlyInMemoryConsoleSessionRepository } from "../../apps/bff/src/services/console-session-store"

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
const oidcBase = `${issuer}/protocol/openid-connect`
const localIdentityFetch = createLoopbackIdentityFetch(
  issuer,
  required("F0_S1_CA_FILE"),
)
const cipher = createConsoleSessionCipher({
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
  new TestOnlyInMemoryConsoleSessionRepository(),
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

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`The browser-session BFF fixture requires ${name}.`)
  }
  return value
}

function fixtureEvent(
  event: string,
  result: { reason?: string; state: string },
): void {
  process.stderr.write(
    `${JSON.stringify({ event, reason: result.reason, state: result.state })}\n`,
  )
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
