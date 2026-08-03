const unsafeEncodedPathPattern =
  /%(?:2e|2f|3f|23|5c|25|0[0-9a-f]|1[0-9a-f]|7f)|(?!%[0-9a-f]{2})%/i
const nativeConsolePathPattern =
  /^\/(?:api\/(?:app-gateway|internal|expert-ingress|live)|realms|admin|ui|public|key|model|router|metrics|graph|-|v0|v2\/(?:crawl|map|batch|extract))(?:\/|$)/i
const nativeIdentityPathPattern =
  /^\/(?:admin|realms\/(?:master|[^/]+)\/admin|metrics|health)(?:\/|$)/i
const appDetailPattern = /^\/applications\/apps\/[A-Za-z0-9._-]{1,128}$/
const teamActionPattern =
  /^\/team\/(?:import|groups\/new|groups\/[A-Za-z0-9._-]{1,128}|members|members\/new|members\/[A-Za-z0-9._-]{1,128})$/
const authPagePattern = /^\/auth\/(?:signin|elevate|unavailable)$/
const iconPattern =
  /^\/(?:apple-touch-icon\.png|favicon(?:-16x16|-32x32|-48x48)?\.png|favicon\.ico|icon\.svg)$/

const consoleReadOnlyPages = new Set([
  "/",
  "/activity",
  "/applications",
  "/hardware",
  "/inference",
  "/team",
])
const consoleActionPages = new Set(["/applications/apps/new", "/settings"])
const querylessPaths = new Set([
  "/v1/models",
  "/v1/chat/completions",
  "/v2/search",
  "/v2/scrape",
  "/api/console/session/logout",
  "/api/console/session/elevate",
  "/api/internal/console-session/backchannel-logout",
  "/api/admin/audit/export/verification-keys",
  "/team/import/template",
  "/realms/llm-machines/protocol/openid-connect/token",
  "/realms/llm-machines/protocol/openid-connect/revoke",
  "/realms/llm-machines/protocol/openid-connect/certs",
])

const headerProfiles = Object.freeze({
  "console-browser": new Set([
    "accept",
    "accept-language",
    "content-length",
    "content-type",
    "cookie",
    "origin",
    "next-action",
    "next-router-prefetch",
    "next-router-state-tree",
    "next-url",
    "purpose",
    "rsc",
    "x-nextjs-data",
  ]),
  "customer-api": new Set([
    "accept",
    "authorization",
    "content-length",
    "content-type",
  ]),
  "identity-backchannel": new Set(["accept", "content-length", "content-type"]),
  "identity-browser": new Set([
    "accept",
    "accept-language",
    "content-length",
    "content-type",
    "cookie",
    "origin",
  ]),
  "identity-server-form": new Set(["accept", "content-length", "content-type"]),
  "identity-server-jwks": new Set(["accept"]),
})

export function evaluateSourceBoundary(input) {
  const hosts = input.hosts ?? {
    console: "console.appliance.test",
    identity: "identity.appliance.test",
  }
  if (input.customerPort !== 443) {
    return denied("customer-port-denied")
  }
  if (
    !hosts.console ||
    !hosts.identity ||
    hosts.console === hosts.identity ||
    !validDnsHost(hosts.console) ||
    !validDnsHost(hosts.identity)
  ) {
    return denied("invalid-edge-host-policy")
  }
  if (!Array.isArray(input.hostHeaders) || input.hostHeaders.length !== 1) {
    return denied("host-header-cardinality")
  }
  const host = input.hostHeaders[0]
  if (host !== input.sni) {
    return denied("host-sni-mismatch")
  }
  const hostId =
    host === hosts.console
      ? "console"
      : host === hosts.identity
        ? "identity"
        : null
  if (!hostId) {
    return denied("unknown-host")
  }
  const target = safeRequestTarget(input.rawTarget)
  if (!target.ok) {
    return denied(target.reason)
  }
  if (hostId === "identity" && hasConsoleCookie(input.headers)) {
    return denied("console-cookie-on-identity-host")
  }
  const route =
    hostId === "console"
      ? consoleRoute(input.method, target.path, input.headers)
      : identityRoute(input.method, target.path)
  if (!route) {
    const native =
      hostId === "console"
        ? nativeConsolePathPattern.test(target.path)
        : nativeIdentityPathPattern.test(target.path)
    return denied(native ? "native-path-denied" : "route-denied")
  }
  if (querylessPaths.has(target.path) && target.query.length > 0) {
    return denied("query-denied")
  }
  const forwardedHeaders = forwardHeaders(
    input.headers,
    route.headerProfile,
    host,
  )
  return {
    allowed: true,
    forwardedHeaders,
    headerProfile: route.headerProfile,
    hostId,
    queryForwarded: target.query.length > 0,
    runtimeQualified: false,
    surface: route.surface,
    upstreamId: route.upstreamId,
    upstreamPath:
      route.upstreamPath === "preserve" ? target.path : route.upstreamPath,
  }
}

function consoleRoute(method, path, headers) {
  if (path === "/v1/models" && ["GET", "HEAD"].includes(method)) {
    return route(
      "inference",
      "customer-api",
      "console-bff",
      "/api/app-gateway/v1/models",
    )
  }
  if (path === "/v1/chat/completions" && method === "POST") {
    return route(
      "inference",
      "customer-api",
      "console-bff",
      "/api/app-gateway/v1/chat/completions",
    )
  }
  if (["/v2/search", "/v2/scrape"].includes(path) && method === "POST") {
    return route("firecrawl", "customer-api", "console-bff", path)
  }
  if (
    ["/api/console/session/login", "/api/console/session/callback"].includes(
      path,
    ) &&
    ["GET", "HEAD"].includes(method)
  ) {
    return route("console", "console-browser", "console-bff", path)
  }
  if (
    ["/api/console/session/logout", "/api/console/session/elevate"].includes(
      path,
    ) &&
    method === "POST"
  ) {
    return route("console", "console-browser", "console-bff", path)
  }
  if (
    path === "/api/internal/console-session/backchannel-logout" &&
    method === "POST"
  ) {
    return route("identity", "identity-backchannel", "console-bff", path)
  }
  if (
    [
      "/api/admin/audit/export",
      "/api/admin/audit/export/verification-keys",
      "/team/import/template",
    ].includes(path) &&
    ["GET", "HEAD"].includes(method)
  ) {
    return route("console", "console-browser", "console-web", path)
  }
  if (
    (consoleReadOnlyPages.has(path) ||
      authPagePattern.test(path) ||
      iconPattern.test(path) ||
      path.startsWith("/_next/") ||
      path.startsWith("/console-v2/") ||
      path.startsWith("/fonts/")) &&
    ["GET", "HEAD"].includes(method)
  ) {
    return route("console", "console-browser", "console-web", "preserve")
  }
  if (
    (consoleActionPages.has(path) ||
      appDetailPattern.test(path) ||
      teamActionPattern.test(path)) &&
    ["GET", "HEAD", "POST"].includes(method)
  ) {
    if (
      method === "POST" &&
      !singleHeader(inputHeader(headers, "next-action"))
    ) {
      return null
    }
    return route("console", "console-browser", "console-web", "preserve")
  }
  return null
}

function identityRoute(method, path) {
  if (
    path === "/realms/llm-machines/protocol/openid-connect/auth" &&
    ["GET", "HEAD"].includes(method)
  ) {
    return route("identity", "identity-browser", "keycloak-identity", path)
  }
  if (
    path === "/realms/llm-machines/protocol/openid-connect/logout" &&
    ["GET", "HEAD", "POST"].includes(method)
  ) {
    return route("identity", "identity-browser", "keycloak-identity", path)
  }
  if (
    [
      "/realms/llm-machines/protocol/openid-connect/token",
      "/realms/llm-machines/protocol/openid-connect/revoke",
    ].includes(path) &&
    method === "POST"
  ) {
    return route("identity", "identity-server-form", "keycloak-identity", path)
  }
  if (
    path === "/realms/llm-machines/protocol/openid-connect/certs" &&
    ["GET", "HEAD"].includes(method)
  ) {
    return route("identity", "identity-server-jwks", "keycloak-identity", path)
  }
  if (
    path.startsWith("/realms/llm-machines/login-actions/") &&
    ["GET", "HEAD", "POST"].includes(method)
  ) {
    return route(
      "identity",
      "identity-browser",
      "keycloak-identity",
      "preserve",
    )
  }
  if (path.startsWith("/resources/") && ["GET", "HEAD"].includes(method)) {
    return route(
      "identity",
      "identity-browser",
      "keycloak-identity",
      "preserve",
    )
  }
  return null
}

function safeRequestTarget(rawTarget) {
  if (
    typeof rawTarget !== "string" ||
    rawTarget.length < 1 ||
    rawTarget.length > 16_384 ||
    !rawTarget.startsWith("/") ||
    rawTarget.startsWith("//") ||
    /^https?:\/\//i.test(rawTarget) ||
    rawTarget.includes("#") ||
    rawTarget.includes("\\") ||
    !rawTarget.isWellFormed()
  ) {
    return { ok: false, reason: "unsafe-request-target" }
  }
  const delimiter = rawTarget.indexOf("?")
  const path = delimiter < 0 ? rawTarget : rawTarget.slice(0, delimiter)
  const query = delimiter < 0 ? "" : rawTarget.slice(delimiter + 1)
  if (
    path.includes("//") ||
    path.includes(";") ||
    unsafeEncodedPathPattern.test(path) ||
    hasControl(path) ||
    /(?:^|\/)\.\.?(?:\/|$)/.test(path)
  ) {
    return { ok: false, reason: "unsafe-path" }
  }
  let decoded
  try {
    decoded = decodeURIComponent(path)
  } catch {
    return { ok: false, reason: "unsafe-path-encoding" }
  }
  if (
    decoded.includes("\\") ||
    decoded.includes("//") ||
    decoded.includes(";") ||
    hasControl(decoded) ||
    /(?:^|\/)\.\.?(?:\/|$)/.test(decoded)
  ) {
    return { ok: false, reason: "unsafe-decoded-path" }
  }
  return { ok: true, path: decoded, query }
}

function forwardHeaders(headers, profile, host) {
  const allowlist = headerProfiles[profile]
  const forwarded = {
    host,
    "x-forwarded-for": "edge-derived-client-address",
    "x-forwarded-host": host,
    "x-forwarded-port": "443",
    "x-forwarded-proto": "https",
    "x-request-id": "edge-derived-request-id",
  }
  for (const [name, value] of Object.entries(headers ?? {})) {
    const normalized = name.toLowerCase()
    if (allowlist.has(normalized) && singleHeader(value)) {
      forwarded[normalized] = value
    }
  }
  return forwarded
}

function hasConsoleCookie(headers) {
  const cookie = inputHeader(headers, "cookie")
  return (
    singleHeader(cookie) &&
    /(?:^|;\s*)__Host-llm-machines-(?:session|login)=/.test(cookie)
  )
}

function inputHeader(headers, name) {
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (key.toLowerCase() === name) {
      return value
    }
  }
  return undefined
}

function singleHeader(value) {
  return typeof value === "string" && value.length > 0 && !/[\r\n]/.test(value)
}

function route(surface, headerProfile, upstreamId, upstreamPath) {
  return { headerProfile, surface, upstreamId, upstreamPath }
}

function denied(reason) {
  return { allowed: false, reason, runtimeQualified: false }
}

function validDnsHost(value) {
  return (
    typeof value === "string" &&
    value.length <= 253 &&
    value === value.toLowerCase() &&
    !value.includes(":") &&
    !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value) &&
    value
      .split(".")
      .every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
  )
}

function hasControl(value) {
  return Array.from(value).some((character) => {
    const code = character.codePointAt(0) ?? 0
    return code < 32 || code === 127
  })
}
