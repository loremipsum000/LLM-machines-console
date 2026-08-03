import assert from "node:assert/strict"
import { test } from "node:test"
import { evaluateSourceBoundary } from "./source-no-bypass.mjs"

const hosts = {
  console: "console.appliance.test",
  identity: "identity.appliance.test",
}

function request(overrides = {}) {
  return evaluateSourceBoundary({
    customerPort: 443,
    headers: {},
    hostHeaders: [hosts.console],
    hosts,
    method: "GET",
    rawTarget: "/",
    sni: hosts.console,
    ...overrides,
  })
}

test("only retained inference and Firecrawl routes reach the BFF", () => {
  for (const [method, rawTarget, upstreamPath] of [
    ["GET", "/v1/models", "/api/app-gateway/v1/models"],
    ["HEAD", "/v1/models", "/api/app-gateway/v1/models"],
    ["POST", "/v1/chat/completions", "/api/app-gateway/v1/chat/completions"],
    ["POST", "/v2/search", "/v2/search"],
    ["POST", "/v2/scrape", "/v2/scrape"],
  ]) {
    const result = request({ method, rawTarget })
    assert.equal(result.allowed, true, `${method} ${rawTarget}`)
    assert.equal(result.upstreamId, "console-bff")
    assert.equal(result.upstreamPath, upstreamPath)
  }
  for (const [method, rawTarget] of [
    ["POST", "/v1/models"],
    ["GET", "/v1/chat/completions"],
    ["GET", "/v2/search"],
    ["POST", "/v2/crawl"],
    ["POST", "/v2/map"],
    ["POST", "/v2/batch/scrape"],
    ["POST", "/v2/extract"],
  ]) {
    assert.equal(request({ method, rawTarget }).allowed, false)
  }
})

test("direct native ports and alternate authorities fail", () => {
  for (const customerPort of [
    80, 3000, 3002, 4000, 4001, 8080, 9090, 9093, 9443,
  ]) {
    assert.equal(request({ customerPort }).allowed, false)
  }
  for (const overrides of [
    { hostHeaders: [] },
    { hostHeaders: [hosts.console, hosts.identity] },
    { hostHeaders: [`${hosts.console}:443`] },
    { hostHeaders: ["litellm.appliance.test"], sni: "litellm.appliance.test" },
    { hostHeaders: [hosts.console], sni: hosts.identity },
    { hostHeaders: ["127.0.0.1"], sni: "127.0.0.1" },
  ]) {
    assert.equal(request(overrides).allowed, false)
  }
})

test("native administration paths remain denied on both hosts", () => {
  const consolePaths = [
    "/api/app-gateway/v1/models",
    "/api/internal/console-session/resolve",
    "/api/expert-ingress/session/exchange",
    "/api/live/ws",
    "/admin",
    "/api/admin/team",
    "/ui/",
    "/model/info",
    "/router/settings",
    "/metrics",
    "/graph",
    "/v0/health/liveness",
  ]
  for (const rawTarget of consolePaths) {
    assert.equal(request({ rawTarget }).allowed, false, rawTarget)
  }
  for (const rawTarget of [
    "/admin/master/console/",
    "/admin/llm-machines/console/",
    "/realms/master/admin/users",
    "/realms/llm-machines/admin/users",
    "/metrics",
    "/health/ready",
  ]) {
    assert.equal(
      request({
        hostHeaders: [hosts.identity],
        rawTarget,
        sni: hosts.identity,
      }).allowed,
      false,
      rawTarget,
    )
  }
})

test("Console pages support only read or exact Next-action mutation paths", () => {
  for (const rawTarget of [
    "/",
    "/activity?eventId=event-1",
    "/applications",
    "/hardware?range=24h",
    "/inference?range=24h",
    "/team",
    "/auth/signin?session=expired&returnTo=%2Finference%3Frange%3D24h",
    "/_next/static/chunk.js?v=1",
    "/console-v2/llm-mark.svg",
    "/fonts/urbanist/Urbanist-Regular.ttf",
    "/favicon.ico",
  ]) {
    assert.equal(request({ rawTarget }).allowed, true, rawTarget)
  }
  for (const rawTarget of [
    "/applications/apps/new",
    "/applications/apps/app-1",
    "/settings",
    "/team/import",
    "/team/groups/new",
    "/team/groups/group-1",
    "/team/members",
    "/team/members/new",
    "/team/members/member-1",
  ]) {
    assert.equal(
      request({
        headers: { "next-action": "action-id" },
        method: "POST",
        rawTarget,
      }).allowed,
      true,
      rawTarget,
    )
    assert.equal(request({ method: "POST", rawTarget }).allowed, false)
  }
  assert.equal(
    request({ method: "POST", rawTarget: "/activity" }).allowed,
    false,
  )
})

test("Console session and OIDC query shapes cannot select another route", () => {
  assert.equal(
    request({ rawTarget: "/api/console/session/login?returnTo=%2Fteam" })
      .allowed,
    true,
  )
  assert.equal(
    request({
      rawTarget:
        "/api/console/session/callback?code=opaque&state=opaque&iss=https%3A%2F%2Fidentity.appliance.test%2Frealms%2Fllm-machines",
    }).allowed,
    true,
  )
  for (const rawTarget of [
    "/v1/models?path=/admin",
    "/v1/chat/completions?route=/ui/",
    "/v2/search?url=/v2/crawl",
    "/api/console/session/logout?returnTo=/",
    "/api/internal/console-session/backchannel-logout?target=/admin",
  ]) {
    assert.equal(
      request({
        method: rawTarget.includes("models") ? "GET" : "POST",
        rawTarget,
      }).allowed,
      false,
    )
  }
})

test("normal Keycloak identity flow is exact and separate", () => {
  const identityRequest = (overrides) =>
    request({
      hostHeaders: [hosts.identity],
      sni: hosts.identity,
      ...overrides,
    })
  for (const [method, rawTarget] of [
    [
      "GET",
      "/realms/llm-machines/protocol/openid-connect/auth?client_id=console-web&response_type=code",
    ],
    [
      "GET",
      "/realms/llm-machines/protocol/openid-connect/logout?client_id=console-web",
    ],
    ["POST", "/realms/llm-machines/protocol/openid-connect/logout"],
    ["POST", "/realms/llm-machines/protocol/openid-connect/token"],
    ["POST", "/realms/llm-machines/protocol/openid-connect/revoke"],
    ["GET", "/realms/llm-machines/protocol/openid-connect/certs"],
    [
      "POST",
      "/realms/llm-machines/login-actions/authenticate?session_code=opaque&execution=opaque",
    ],
    ["GET", "/resources/hash/login/theme.css"],
  ]) {
    const result = identityRequest({ method, rawTarget })
    assert.equal(result.allowed, true, `${method} ${rawTarget}`)
    assert.equal(result.upstreamId, "keycloak-identity")
    assert.equal(result.surface, "identity")
  }
  assert.equal(
    identityRequest({
      headers: { cookie: "__Host-llm-machines-session=opaque" },
      rawTarget: "/realms/llm-machines/protocol/openid-connect/auth",
    }).allowed,
    false,
  )
})

test("unsafe and ambiguous raw paths fail before route selection", () => {
  for (const rawTarget of [
    "https://console.appliance.test/v1/models",
    "//console.appliance.test/v1/models",
    "/v1//models",
    "/v1/./models",
    "/v1/../admin",
    "/v1/%2e%2e/admin",
    "/v1%2fmodels",
    "/v1%252fmodels",
    "/v1\\models",
    "/v1/models;admin",
    "/v1/models%00",
    "/v1/models%7f",
    "/v1/models%zz",
    "/v1/models#fragment",
  ]) {
    assert.equal(request({ rawTarget }).allowed, false, rawTarget)
  }
})

test("spoofed forwarding and identity headers are stripped", () => {
  const result = request({
    headers: {
      authorization: "Bearer application-credential",
      forwarded: "host=litellm.appliance.test",
      "x-forwarded-host": "keycloak.appliance.test",
      "x-original-url": "/admin",
      "x-rewrite-url": "/ui/",
      "x-http-method-override": "DELETE",
      "x-llm-machines-user-sub": "attacker",
      "x-llm-machines-console-session": "opaque-session",
      upgrade: "websocket",
      connection: "upgrade",
    },
    method: "POST",
    rawTarget: "/v1/chat/completions",
  })
  assert.equal(result.allowed, true)
  assert.equal(
    result.forwardedHeaders.authorization,
    "Bearer application-credential",
  )
  for (const name of [
    "forwarded",
    "x-original-url",
    "x-rewrite-url",
    "x-http-method-override",
    "x-llm-machines-user-sub",
    "x-llm-machines-console-session",
    "upgrade",
    "connection",
  ]) {
    assert.equal(result.forwardedHeaders[name], undefined, name)
  }
  assert.equal(result.forwardedHeaders["x-forwarded-host"], hosts.console)
  assert.equal(result.runtimeQualified, false)
})
