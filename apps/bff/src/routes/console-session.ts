import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import {
  CONSOLE_LOGIN_COOKIE,
  CONSOLE_SESSION_COOKIE,
  clearConsoleCookie,
  readConsoleCookie,
  serializeConsoleCookie,
  validOpaqueConsoleHandle,
  validServiceCredential,
} from "../auth/console-session-cookie"
import type {
  ConsoleBackchannelVerifier,
  ConsoleSessionService,
} from "../services/console-session-service"
import { normalizeConsoleReturnPath } from "../services/console-session-service"

const SESSION_MAX_AGE_SECONDS = 30 * 60
const LOGIN_MAX_AGE_SECONDS = 2 * 60

export interface ConsoleSessionRouteOptions {
  backchannelVerifier: ConsoleBackchannelVerifier
  consoleOrigin: string
  identityIssuer: string
  internalServiceCredential: string
  service: ConsoleSessionService
}

export function registerConsoleSessionRoutes(
  server: FastifyInstance,
  options: ConsoleSessionRouteOptions,
): void {
  const consoleOrigin = normalizedOrigin(options.consoleOrigin)
  const identityIssuer = normalizedIssuer(options.identityIssuer)
  if (!server.hasContentTypeParser("application/x-www-form-urlencoded")) {
    server.addContentTypeParser(
      "application/x-www-form-urlencoded",
      { parseAs: "string" },
      (_request, body, done) => done(null, body),
    )
  }

  server.get("/api/console/session/login", async (request, reply) => {
    noStore(reply)
    const query = queryRecord(request.query)
    if (!hasOnlyKeys(query, ["returnTo"])) {
      return reply.redirect(expiredLoginUrl(consoleOrigin, "/"), 303)
    }
    let login: Awaited<ReturnType<ConsoleSessionService["beginLogin"]>>
    try {
      login = await options.service.beginLogin(
        normalizeConsoleReturnPath(stringValue(query.returnTo)),
      )
    } catch {
      return reply.redirect(unavailableUrl(consoleOrigin, "/"), 303)
    }
    reply.header(
      "set-cookie",
      serializeConsoleCookie(
        CONSOLE_LOGIN_COOKIE,
        login.loginHandle,
        LOGIN_MAX_AGE_SECONDS,
      ),
    )
    return reply.redirect(login.authorizationUrl, 303)
  })

  server.get("/api/console/session/callback", async (request, reply) => {
    noStore(reply)
    const query = queryRecord(request.query)
    const code = boundedValue(query.code, 8192)
    const state = boundedValue(query.state, 128)
    const responseIssuer = boundedValue(query.iss, 2048)
    const loginHandle = readConsoleCookie(
      request.headers.cookie,
      CONSOLE_LOGIN_COOKIE,
    )
    reply.header("set-cookie", clearConsoleCookie(CONSOLE_LOGIN_COOKIE))
    if (
      !hasOnlyKeys(query, [
        "code",
        "error",
        "error_description",
        "error_uri",
        "iss",
        "session_state",
        "state",
      ]) ||
      !code ||
      !state ||
      !loginHandle ||
      query.error ||
      responseIssuer !== identityIssuer
    ) {
      return reply.redirect(expiredLoginUrl(consoleOrigin, "/"), 303)
    }
    let result: Awaited<ReturnType<ConsoleSessionService["completeLogin"]>>
    try {
      result = await options.service.completeLogin({
        code,
        loginHandle,
        state,
      })
    } catch {
      return reply.redirect(unavailableUrl(consoleOrigin, "/"), 303)
    }
    if (result.state === "unavailable") {
      return reply.redirect(
        unavailableUrl(consoleOrigin, result.returnPath ?? "/"),
        303,
      )
    }
    if (result.state === "terminal") {
      return reply.redirect(
        expiredLoginUrl(consoleOrigin, result.returnPath ?? "/"),
        303,
      )
    }
    reply.header("set-cookie", [
      clearConsoleCookie(CONSOLE_LOGIN_COOKIE),
      serializeConsoleCookie(
        CONSOLE_SESSION_COOKIE,
        result.sessionHandle,
        SESSION_MAX_AGE_SECONDS,
      ),
    ])
    return reply.redirect(`${consoleOrigin}${result.returnPath}`, 303)
  })

  server.get(
    "/api/internal/console-session/resolve",
    async (request, reply) => {
      noStore(reply)
      if (
        !internalRequestAuthorized(request, options.internalServiceCredential)
      ) {
        return reply
          .code(401)
          .send({ reason: "unauthorized", state: "terminal" })
      }
      const sessionHandle = internalSessionHandle(request)
      if (!sessionHandle) {
        return reply.code(401).send({ reason: "absent", state: "terminal" })
      }
      let result: Awaited<ReturnType<ConsoleSessionService["resolve"]>>
      try {
        result = await options.service.resolve(sessionHandle)
      } catch {
        return reply.code(503).send({
          reason: "storage_unavailable",
          retryable: true,
          state: "unavailable",
        })
      }
      if (result.state === "unavailable") {
        return reply.code(503).send(result)
      }
      if (result.state === "terminal") {
        return reply.code(401).send(result)
      }
      return reply.send({
        session: {
          email: result.session.email,
          groups: result.session.groups,
          mfaVerifiedAt: result.session.mfaVerifiedAt?.toISOString() ?? null,
          role: result.session.role,
          subject: result.session.subject,
        },
        state: "active",
      })
    },
  )

  server.post("/api/console/session/logout", async (request, reply) => {
    noStore(reply)
    if (request.headers.origin !== consoleOrigin) {
      return reply.code(403).send({ error: "origin_denied" })
    }
    const sessionHandle = readConsoleCookie(
      request.headers.cookie,
      CONSOLE_SESSION_COOKIE,
    )
    if (sessionHandle) {
      await options.service.logout(sessionHandle)
    }
    reply.header("set-cookie", clearConsoleCookie(CONSOLE_SESSION_COOKIE))
    return reply.code(204).send()
  })

  server.post("/api/console/session/elevate", async (request, reply) => {
    noStore(reply)
    if (request.headers.origin !== consoleOrigin) {
      return reply.code(403).send({ error: "origin_denied" })
    }
    const sessionHandle = readConsoleCookie(
      request.headers.cookie,
      CONSOLE_SESSION_COOKIE,
    )
    const body = bodyRecord(request.body)
    const action = boundedValue(body.action, 128)
    const returnTo = normalizeConsoleReturnPath(stringValue(body.returnTo))
    if (!sessionHandle || !action) {
      reply.header("set-cookie", clearConsoleCookie(CONSOLE_SESSION_COOKIE))
      return reply.redirect(expiredLoginUrl(consoleOrigin, returnTo), 303)
    }
    const result = await options.service.beginElevation({
      action,
      returnTo,
      sessionHandle,
    })
    if (result.state === "unavailable") {
      return reply.code(503).send(result)
    }
    if (result.state === "terminal") {
      reply.header("set-cookie", clearConsoleCookie(CONSOLE_SESSION_COOKIE))
      return reply.redirect(expiredLoginUrl(consoleOrigin, returnTo), 303)
    }
    reply.header(
      "set-cookie",
      serializeConsoleCookie(
        CONSOLE_LOGIN_COOKIE,
        result.loginHandle,
        LOGIN_MAX_AGE_SECONDS,
      ),
    )
    return reply.redirect(result.authorizationUrl, 303)
  })

  server.post(
    "/api/internal/console-session/backchannel-logout",
    { bodyLimit: 24 * 1024 },
    async (request, reply) => {
      noStore(reply)
      const token = boundedValue(
        bodyRecord(request.body).logout_token,
        20 * 1024,
      )
      if (!token) {
        return reply.code(400).send({ error: "invalid_logout_token" })
      }
      const verification = await options.backchannelVerifier.verify(token)
      if (verification && "state" in verification) {
        reply.header("retry-after", "1")
        return reply.code(503).send(verification)
      }
      if (!verification) {
        return reply.code(400).send({ error: "invalid_logout_token" })
      }
      await options.service.backchannelLogout(verification)
      return reply.code(204).send()
    },
  )
}

function internalRequestAuthorized(
  request: FastifyRequest,
  credential: string,
): boolean {
  return Boolean(
    credential &&
      validServiceCredential(request.headers.authorization, credential),
  )
}

function internalSessionHandle(request: FastifyRequest): string | null {
  const value = request.headers["x-llm-machines-console-session"]
  const handle = Array.isArray(value) ? null : value
  return handle && validOpaqueConsoleHandle(handle) ? handle : null
}

function normalizedOrigin(value: string): string {
  const url = new URL(value)
  if (
    url.protocol !== "https:" ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("Console session origin must be an HTTPS origin.")
  }
  return url.origin
}

function normalizedIssuer(value: string): string {
  const url = new URL(value)
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error("Console identity issuer must be an HTTPS URL.")
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`
}

function queryRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  const allowlist = new Set(allowed)
  return Object.keys(value).every((key) => allowlist.has(key))
}

function bodyRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    return Object.fromEntries(new URLSearchParams(value))
  }
  return queryRecord(value)
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function boundedValue(value: unknown, maximum: number): string | null {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum
    ? value
    : null
}

function noStore(reply: FastifyReply): void {
  reply.header("cache-control", "no-store, max-age=0")
  reply.header("pragma", "no-cache")
}

function expiredLoginUrl(origin: string, returnPath: string): string {
  const url = new URL("/auth/signin", origin)
  url.searchParams.set("session", "expired")
  url.searchParams.set("returnTo", normalizeConsoleReturnPath(returnPath))
  return url.toString()
}

function unavailableUrl(origin: string, returnPath: string): string {
  const url = new URL("/auth/unavailable", origin)
  url.searchParams.set("returnTo", normalizeConsoleReturnPath(returnPath))
  return url.toString()
}
