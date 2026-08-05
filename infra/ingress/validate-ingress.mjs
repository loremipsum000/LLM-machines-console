import { createHash } from "node:crypto"
import { readFileSync, readdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const moduleDirectory = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(moduleDirectory, "../..")
const expectedFiles = [
  "README.md",
  "edge-policy.json",
  "no-bypass-policy.json",
  "product-edge.nginx.conf.template",
  "proxy-common.inc",
  "request-headers-console-browser.inc",
  "request-headers-customer-api.inc",
  "request-headers-identity-browser.inc",
  "request-safety.inc",
  "source-no-bypass.mjs",
  "source-no-bypass.test.mjs",
  "validate-ingress.mjs",
  "validate-ingress.test.mjs",
]
const expectedUpstreams = [
  { id: "console-web", authority: "console-web:3000" },
  { id: "console-bff", authority: "console-bff:4001" },
  { id: "keycloak-identity", authority: "keycloak:8080" },
]
const expectedPrivateSystems = [
  "alertmanager",
  "firecrawl-native",
  "grafana",
  "keycloak-admin",
  "litellm",
  "portainer",
  "postgresql",
  "prometheus",
  "sglang",
]
const expectedNegativeCases = [
  "direct-native-ports",
  "alternate-hostnames",
  "native-paths",
  "forwarded-header-spoofing",
  "path-traversal",
  "direct-network-access",
]
const expectedRouteIds = [
  "inference-models",
  "inference-chat-completions",
  "firecrawl-search",
  "firecrawl-scrape",
  "console-session-login",
  "console-session-callback",
  "console-session-logout",
  "console-session-elevate",
  "identity-backchannel-logout",
  "console-audit-export",
  "console-audit-verification-keys",
  "console-root",
  "console-read-only-pages",
  "console-next-action-pages",
  "console-team-import-template",
  "console-auth-pages",
  "console-next-assets",
  "console-product-assets",
  "identity-authorization",
  "identity-logout",
  "identity-logout-confirm",
  "identity-token",
  "identity-revocation",
  "identity-jwks",
  "identity-application-token",
  "identity-application-jwks",
  "identity-login-actions",
  "identity-resources",
]
const expectedCoreApiRoutes = [
  ["inference-models", "api", "GET,HEAD", "/v1/models", "console-bff"],
  [
    "inference-chat-completions",
    "api",
    "POST",
    "/v1/chat/completions",
    "console-bff",
  ],
  ["firecrawl-search", "firecrawl", "POST", "/v2/search", "console-bff"],
  ["firecrawl-scrape", "firecrawl", "POST", "/v2/scrape", "console-bff"],
]
const expectedNginxLocations = {
  api: ["= /v1/models", "= /v1/chat/completions", "/"],
  console: [
    "= /api/console/session/login",
    "= /api/console/session/callback",
    "= /api/console/session/logout",
    "= /api/console/session/elevate",
    "= /__llmm_identity_unavailable",
    "= /api/internal/console-session/backchannel-logout",
    "= /api/admin/audit/export",
    "= /api/admin/audit/export/verification-keys",
    "= /",
    '~ "^/(?:activity|hardware|inference|applications|team)$"',
    '~ "^/(?:applications/apps/(?:new|[A-Za-z0-9._-]{1,128})|settings|team/(?:import|groups/new|groups/[A-Za-z0-9._-]{1,128}|members|members/new|members/[A-Za-z0-9._-]{1,128}))$"',
    "= /team/import/template",
    "~ ^/auth/(?:signin|elevate|unavailable)$",
    "^~ /_next/",
    "^~ /console-v2/",
    "^~ /fonts/",
    "~ ^/(?:apple-touch-icon\\.png|favicon(?:-16x16|-32x32|-48x48)?\\.png|favicon\\.ico|icon\\.svg)$",
    "~* ^/(?:api/(?:app-gateway|internal|expert-ingress|live)|realms|admin|ui|public|key|model|router|metrics|graph|-|v0|v2/(?:crawl|map|batch|extract))(?:/|$)",
    "/",
  ],
  firecrawl: ["= /v2/search", "= /v2/scrape", "/"],
  identity: [
    "= /realms/llm-machines/protocol/openid-connect/auth",
    "= /realms/llm-machines/protocol/openid-connect/logout",
    "= /realms/llm-machines/protocol/openid-connect/logout/logout-confirm",
    "= /realms/llm-machines/protocol/openid-connect/token",
    "= /realms/llm-machines/protocol/openid-connect/revoke",
    "= /realms/llm-machines/protocol/openid-connect/certs",
    "= /realms/llm-machines-applications/protocol/openid-connect/token",
    "= /realms/llm-machines-applications/protocol/openid-connect/certs",
    "^~ /realms/llm-machines/login-actions/",
    "^~ /resources/",
    "= /__llmm_identity_unavailable",
    "~* ^/(?:admin|realms/(?:master|[^/]+)/admin|metrics|health)(?:/|$)",
    "/",
  ],
}
const expectedRuntimeSourceHashes = {
  "product-edge.nginx.conf.template":
    "65ccb749ee4a814d2507dbb09265dcb54f459a7adab0de20e754eb8e9c3187bd",
  "proxy-common.inc":
    "cf8199a159a6ff4e5842d26b00277d7b7ddab8ab5169258c8b4d14f1cce7d3f2",
  "request-headers-console-browser.inc":
    "437d4dba7b95277260d7c0f8aa13db35d1f0747fcfbf49fc60f31182c3bc037e",
  "request-headers-customer-api.inc":
    "b7702c4b933206105278c1ee8f7f03ae863a2d1b0896046351514e5d279a8428",
  "request-headers-identity-browser.inc":
    "8dc46e0f6d875e042814d06613a520928153fe585fe45ed65ba4065c9be79dc2",
  "request-safety.inc":
    "148baeded4c09367b0745a80e275ac684435a5c4e18a6ceaad5b25702e284756",
}

export function validateIngressSources(sources) {
  const errors = []
  const policy = parseJson(
    sources["edge-policy.json"],
    "edge-policy.json",
    errors,
  )
  const noBypass = parseJson(
    sources["no-bypass-policy.json"],
    "no-bypass-policy.json",
    errors,
  )
  if (!policy || !noBypass) {
    return errors
  }
  validatePolicy(policy, errors)
  validateNoBypass(noBypass, errors)
  validateRuntimeSourceFingerprints(sources, errors)
  validateNginx(sources, errors)
  validateHeaders(sources, errors)
  validateCredentialSafety(sources, errors)
  return errors
}

function validateRuntimeSourceFingerprints(sources, errors) {
  for (const [path, expected] of Object.entries(expectedRuntimeSourceHashes)) {
    const source = sources[path]
    add(
      errors,
      typeof source === "string" && sha256(source) === expected,
      `runtime source fingerprint changed for ${path}`,
    )
  }
}

function validatePolicy(policy, errors) {
  add(errors, policy.schemaVersion === 1, "edge policy schema version changed")
  add(errors, policy.workPackage === "F0-E0", "edge policy package changed")
  add(
    errors,
    policy.status === "source-only-not-runtime-qualified",
    "edge policy overstates runtime qualification",
  )
  add(
    errors,
    sameJson(policy.edge?.customerFacingTcpPorts, [443]),
    "customer listener ports changed",
  )
  add(
    errors,
    sameJson(policy.edge?.hostTemplates, {
      api: "@@PRODUCT_API_HOST@@",
      console: "@@PRODUCT_CONSOLE_HOST@@",
      firecrawl: "@@PRODUCT_FIRECRAWL_HOST@@",
      identity: "@@PRODUCT_IDENTITY_HOST@@",
    }),
    "public host templates changed",
  )
  for (const field of [
    "clientSniMustEqualSelectedHost",
    "hostHeaderMustExactlyEqualClientSni",
    "rejectingDefaultTlsServer",
  ]) {
    add(errors, policy.edge?.[field] === true, `edge ${field} must remain true`)
  }
  add(
    errors,
    sameJson(policy.upstreams, expectedUpstreams),
    "fixed edge upstreams changed",
  )
  add(
    errors,
    sameJson(
      policy.routes?.map((route) => route.id),
      expectedRouteIds,
    ),
    "edge route IDs or order changed",
  )
  const uniqueRoutes = new Set(
    policy.routes?.map(
      (route) =>
        `${route.hostId}:${route.methods.join(",")}:${route.path.kind}:${route.path.value}`,
    ),
  )
  add(
    errors,
    uniqueRoutes.size === expectedRouteIds.length,
    "edge routes are missing or duplicated",
  )
  const coreRoutes = policy.routes
    ?.filter((route) => ["inference", "firecrawl"].includes(route.surface))
    .map((route) => [
      route.id,
      route.hostId,
      route.methods.join(","),
      route.path.value,
      route.upstreamId,
    ])
  add(
    errors,
    sameJson(coreRoutes, expectedCoreApiRoutes),
    "public inference or Firecrawl route changed",
  )
  for (const route of policy.routes ?? []) {
    add(
      errors,
      ["api", "console", "firecrawl", "identity"].includes(route.hostId),
      `route ${route.id} uses an unknown public host`,
    )
    add(
      errors,
      ["console-web", "console-bff", "keycloak-identity"].includes(
        route.upstreamId,
      ),
      `route ${route.id} uses an unapproved upstream`,
    )
    add(
      errors,
      !/grafana|litellm|portainer|prometheus|alertmanager|keycloak-admin/i.test(
        JSON.stringify(route),
      ),
      `route ${route.id} introduces native administration`,
    )
  }
  const applicationTokenRoute = policy.routes?.find(
    (route) => route.id === "identity-application-token",
  )
  add(
    errors,
    applicationTokenRoute?.headerProfile === "identity-application-token",
    "Application token header profile changed",
  )
  add(
    errors,
    sameJson(policy.privateNativeSystems, expectedPrivateSystems),
    "private native-system list changed",
  )
  add(
    errors,
    policy.headerPolicy?.requestHeaderForwarding === "drop-all-then-explicit",
    "request headers are no longer default-drop",
  )
  for (const field of [
    "browserBearerForwarding",
    "consoleSessionForwardedToIdentity",
    "clientForwardedOrIdentityHeadersTrusted",
    "websocketUpgradeForwarded",
  ]) {
    add(
      errors,
      policy.headerPolicy?.[field] === false,
      `header policy ${field} must remain false`,
    )
  }
  add(
    errors,
    policy.headerPolicy?.applicationTokenClientSecretBasicForwarding === true &&
      policy.headerPolicy?.applicationTokenClientSecretPostAllowed === false,
    "Application token Basic authentication forwarding changed",
  )
  add(
    errors,
    sameJson(policy.headerPolicy?.allowlists?.["identity-application-token"], [
      "Accept",
      "Authorization",
      "Content-Length",
      "Content-Type",
    ]),
    "Application token header allowlist changed",
  )
  add(
    errors,
    policy.responsePolicy?.consoleAndIdentitySetCookieAllowed === true &&
      policy.responsePolicy?.consoleAndIdentityLocationAllowed === true,
    "retained browser cookies or redirects were suppressed",
  )
  add(
    errors,
    policy.responsePolicy?.internalAuthorityDisclosureAllowed === false &&
      policy.responsePolicy?.nativeAdministrationRedirectAllowed === false,
    "native or internal response disclosure was enabled",
  )
  for (const field of [
    "requestBuffering",
    "responseBuffering",
    "cache",
    "requestOrResponseBodiesLogged",
    "requestTargetOrQueryLogged",
    "arbitraryHeadersLogged",
  ]) {
    add(
      errors,
      policy.contentHandling?.[field] === false,
      `content policy ${field} must remain false`,
    )
  }
  add(
    errors,
    Object.values(policy.runtimeQualification ?? {}).length === 4 &&
      Object.values(policy.runtimeQualification).every(
        (value) => value === "NOT_EVALUATED_RUNTIME",
      ),
    "source policy overstates runtime qualification",
  )
}

function validateNoBypass(policy, errors) {
  add(errors, policy.schemaVersion === 1, "no-bypass schema version changed")
  add(errors, policy.workPackage === "F0-E0", "no-bypass package changed")
  add(
    errors,
    policy.status === "source-policy-only",
    "no-bypass policy overstates runtime evidence",
  )
  add(
    errors,
    sameJson(policy.customerNetwork?.allowedTcpPorts, [443]),
    "no-bypass allowed ports changed",
  )
  add(
    errors,
    sameJson(
      policy.customerNetwork?.deniedNativeTcpPorts,
      [3000, 3002, 3128, 4000, 4001, 5432, 8080, 9090, 9093, 9443],
    ),
    "native-port denial set changed",
  )
  add(
    errors,
    policy.customerNetwork?.deniedInferenceProfileTcpPorts ===
      "every-instantiated-private-listener",
    "inference-profile listener denial changed",
  )
  add(
    errors,
    sameJson(
      policy.negativeCases?.map((entry) => entry.id),
      expectedNegativeCases,
    ),
    "no-bypass negative cases changed",
  )
  for (const entry of policy.negativeCases ?? []) {
    add(
      errors,
      entry.runtimeState === "NOT_EVALUATED_RUNTIME",
      `no-bypass case ${entry.id} overstates runtime proof`,
    )
  }
}

function validateNginx(sources, errors) {
  const nginx = sources["product-edge.nginx.conf.template"] ?? ""
  const proxyCommon = sources["proxy-common.inc"] ?? ""
  const safety = sources["request-safety.inc"] ?? ""
  add(
    errors,
    sameJson(
      [...nginx.matchAll(/\bupstream\s+([a-z0-9_]+)\s*\{/g)].map(
        (match) => match[1],
      ),
      ["console_web", "console_bff", "keycloak_identity"],
    ),
    "Nginx upstream declarations changed",
  )
  add(
    errors,
    !/upstream\s+(?:grafana|litellm|prometheus|alertmanager|portainer)/i.test(
      nginx,
    ),
    "Nginx declares a native administration upstream",
  )
  const listens = [...nginx.matchAll(/^\s*listen\s+([^;]+);/gm)].map(
    (match) => match[1],
  )
  add(
    errors,
    listens.length === 5 &&
      listens.every((value) => value.startsWith("443 ssl")),
    "Nginx customer listeners changed",
  )
  add(
    errors,
    nginx.includes("listen 443 ssl default_server;") &&
      nginx.includes("ssl_reject_handshake on;"),
    "rejecting default TLS server is missing",
  )
  add(
    errors,
    count(nginx, "server_name @@PRODUCT_API_HOST@@;") === 1 &&
      count(nginx, "server_name @@PRODUCT_CONSOLE_HOST@@;") === 1 &&
      count(nginx, "server_name @@PRODUCT_FIRECRAWL_HOST@@;") === 1 &&
      count(nginx, "server_name @@PRODUCT_IDENTITY_HOST@@;") === 1,
    "public Nginx hosts changed",
  )
  const consoleServer = hostServerSection(
    nginx,
    "@@PRODUCT_CONSOLE_HOST@@",
    "@@PRODUCT_API_HOST@@",
  )
  const apiServer = hostServerSection(
    nginx,
    "@@PRODUCT_API_HOST@@",
    "@@PRODUCT_FIRECRAWL_HOST@@",
  )
  const firecrawlServer = hostServerSection(
    nginx,
    "@@PRODUCT_FIRECRAWL_HOST@@",
    "@@PRODUCT_IDENTITY_HOST@@",
  )
  const identityServer = hostServerSection(nginx, "@@PRODUCT_IDENTITY_HOST@@")
  for (const [hostId, server] of Object.entries({
    api: apiServer,
    console: consoleServer,
    firecrawl: firecrawlServer,
    identity: identityServer,
  })) {
    add(
      errors,
      sameJson(locationDeclarations(server), expectedNginxLocations[hostId]),
      `Nginx ${hostId} location inventory changed`,
    )
  }
  add(
    errors,
    !/location = \/v[12]\//.test(consoleServer),
    "Console host contains a customer API route",
  )
  add(
    errors,
    apiServer.includes("location = /v1/models") &&
      apiServer.includes("location = /v1/chat/completions") &&
      !apiServer.includes("location = /v2/") &&
      !apiServer.includes("/realms/"),
    "API host route boundary changed",
  )
  add(
    errors,
    firecrawlServer.includes("location = /v2/search") &&
      firecrawlServer.includes("location = /v2/scrape") &&
      !firecrawlServer.includes("location = /v1/") &&
      !firecrawlServer.includes("/realms/"),
    "Firecrawl host route boundary changed",
  )
  add(
    errors,
    identityServer.includes(
      "location = /realms/llm-machines/protocol/openid-connect/auth",
    ) &&
      identityServer.includes(
        "location = /realms/llm-machines-applications/protocol/openid-connect/token",
      ) &&
      identityServer.includes(
        "location = /realms/llm-machines-applications/protocol/openid-connect/certs",
      ) &&
      !/location = \/v[12]\//.test(identityServer),
    "identity host route boundary changed",
  )
  add(
    errors,
    nginx.includes(
      '"~^[Bb][Aa][Ss][Ii][Cc][ ]+bGxtbS1hcHAt[A-Za-z0-9+/]{48}(?:O[g-v][AEIMQUYcgkosw048]=|O[g-v][A-Za-z0-9+/]{2}(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/][AQgw]==|[A-Za-z0-9+/]{2}[AEIMQUYcgkosw048]=)?)$" $http_authorization;',
    ) &&
      count(
        nginx,
        "proxy_set_header Authorization $llmm_application_client_authorization;",
      ) === 1 &&
      exactLocationSection(
        identityServer,
        "= /realms/llm-machines-applications/protocol/openid-connect/token",
      ).includes(
        "proxy_set_header Authorization $llmm_application_client_authorization;",
      ) &&
      exactLocationSection(
        identityServer,
        "= /realms/llm-machines-applications/protocol/openid-connect/token",
      ).includes(
        'if ($llmm_application_client_authorization = "") { return 401; }',
      ),
    "Application token Basic authentication forwarding changed",
  )
  for (const declaration of [
    "= /realms/llm-machines/protocol/openid-connect/token",
    "= /realms/llm-machines/protocol/openid-connect/revoke",
    "= /realms/llm-machines/protocol/openid-connect/certs",
    "= /realms/llm-machines-applications/protocol/openid-connect/certs",
  ]) {
    add(
      errors,
      exactLocationSection(identityServer, declaration).includes(
        'proxy_set_header Authorization "";',
      ),
      `unexpected Authorization forwarding on ${declaration}`,
    )
  }
  add(
    errors,
    count(nginx, 'if ($ssl_server_name = "") { return 421; }') === 4 &&
      count(nginx, "if ($http_host != $ssl_server_name) { return 421; }") === 4,
    "Host and SNI equality checks changed",
  )
  add(
    errors,
    count(nginx, "include /etc/nginx/llm-machines/request-safety.inc;") === 4,
    "raw-path safety is not applied to every public host",
  )
  for (const fixedProxy of [
    "http://console_bff/api/app-gateway/v1/models",
    "http://console_bff/api/app-gateway/v1/chat/completions",
    "http://console_bff/v2/search",
    "http://console_bff/v2/scrape",
    "http://keycloak_identity/realms/llm-machines/protocol/openid-connect/auth",
    "http://keycloak_identity/realms/llm-machines-applications/protocol/openid-connect/token",
    "http://keycloak_identity/realms/llm-machines-applications/protocol/openid-connect/certs",
  ]) {
    add(
      errors,
      nginx.includes(`proxy_pass ${fixedProxy};`),
      `missing ${fixedProxy}`,
    )
  }
  for (const proxyPass of nginx.matchAll(/proxy_pass\s+([^;]+);/g)) {
    add(
      errors,
      /^http:\/\/(?:console_web|console_bff|keycloak_identity)(?:\/[^$\s]*)?$/.test(
        proxyPass[1],
      ),
      `variable or unapproved proxy target ${proxyPass[1]}`,
    )
  }
  add(
    errors,
    !/server_name[^;]*(?:grafana|litellm|portainer|prometheus|alertmanager)/i.test(
      nginx,
    ),
    "native administration public hostname added",
  )
  add(
    errors,
    !/auth_request\s|proxy_set_header\s+Upgrade\s+\$|proxy_set_header\s+Connection\s+\$http_connection/i.test(
      nginx,
    ),
    "native impersonation or WebSocket forwarding added",
  )
  add(
    errors,
    nginx.includes(
      'if ($http_cookie ~* "(?:^|;\\\\s*)__Host-llm-machines-(?:session|login)=") { return 400; }',
    ),
    "identity host no longer rejects Console session cookies",
  )
  add(
    errors,
    proxyCommon.includes("proxy_pass_request_headers off;") &&
      proxyCommon.includes("proxy_request_buffering off;") &&
      proxyCommon.includes("proxy_buffering off;") &&
      proxyCommon.includes("proxy_cache off;") &&
      proxyCommon.includes("proxy_max_temp_file_size 0;") &&
      proxyCommon.includes("proxy_redirect off;"),
    "proxy content or redirect controls changed",
  )
  add(
    errors,
    !/proxy_hide_header\s+(?:Set-Cookie|Location)/i.test(
      `${nginx}\n${proxyCommon}`,
    ),
    "retained native cookie or redirect responses are suppressed",
  )
  const logFormat = nginx.match(
    /log_format\s+llmm_ingress_metadata[\s\S]*?;\n\s*access_log/,
  )?.[0]
  add(errors, Boolean(logFormat), "metadata log format is missing")
  add(
    errors,
    !/\$(?:request_uri|uri|args|query_string|request_body|http_|upstream_http_)/.test(
      logFormat ?? "",
    ),
    "ingress log contains target query body or arbitrary headers",
  )
  add(
    errors,
    nginx.includes("error_log /dev/null emerg;"),
    "request-context error logging was enabled",
  )
  add(
    errors,
    safety.includes('if ($request ~ "^[A-Z]+[ ]+https?://")') &&
      safety.includes("%2e|%2f|%3f|%23|%5c|%25") &&
      safety.includes("\\.\\.?") &&
      safety.includes("//|;"),
    "raw-path rejection set changed",
  )
}

function validateHeaders(sources, errors) {
  const common = sources["proxy-common.inc"] ?? ""
  const customer = sources["request-headers-customer-api.inc"] ?? ""
  const consoleBrowser = sources["request-headers-console-browser.inc"] ?? ""
  const identityBrowser = sources["request-headers-identity-browser.inc"] ?? ""
  for (const name of [
    "Forwarded",
    "X-Forwarded-Host",
    "X-Original-URL",
    "X-Rewrite-URL",
    "X-HTTP-Method-Override",
    "X-LLM-Machines-User-Sub",
    "X-LLM-Machines-Console-Session",
    "Upgrade",
  ]) {
    add(
      errors,
      common.includes(`proxy_set_header ${name} `),
      `missing ${name} reset`,
    )
  }
  add(
    errors,
    common.includes('proxy_set_header Upgrade "";') &&
      common.includes('proxy_set_header Connection "";'),
    "WebSocket Upgrade reset changed",
  )
  add(
    errors,
    customer.includes("proxy_set_header Authorization $http_authorization;") &&
      customer.includes('proxy_set_header Cookie "";') &&
      customer.includes('proxy_set_header Origin "";'),
    "customer API header profile changed",
  )
  add(
    errors,
    consoleBrowser.includes("proxy_set_header Cookie $http_cookie;") &&
      consoleBrowser.includes('proxy_set_header Authorization "";'),
    "Console browser header profile changed",
  )
  add(
    errors,
    identityBrowser.includes("proxy_set_header Cookie $http_cookie;") &&
      identityBrowser.includes('proxy_set_header Authorization "";') &&
      identityBrowser.includes(
        'proxy_set_header X-LLM-Machines-Console-Session "";',
      ),
    "identity browser header profile changed",
  )
}

function validateCredentialSafety(sources, errors) {
  const combined = Object.entries(sources)
    .map(([name, value]) => `FILE ${name}\n${value}`)
    .join("\n")
  for (const [pattern, label] of [
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "private key"],
    [/\bAKIA[0-9A-Z]{16}\b/, "AWS access key"],
    [/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/, "GitHub credential"],
    [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/, "GitHub credential"],
    [
      /\b(?:password|secret|token)\s*[:=]\s*["'][^@\n"']{12,}["']/i,
      "inline credential",
    ],
  ]) {
    add(errors, !pattern.test(combined), `ingress package contains ${label}`)
  }
}

export function validateIngressPackage(root = repositoryRoot) {
  const ingressDirectory = resolve(root, "infra/ingress")
  const actualFiles = readdirSync(ingressDirectory)
    .filter((name) => !name.startsWith("."))
    .sort()
  const errors = []
  add(
    errors,
    sameJson(actualFiles, [...expectedFiles].sort()),
    "ingress package file set changed",
  )
  const sources = Object.fromEntries(
    expectedFiles.map((name) => [
      name,
      readFileSync(resolve(ingressDirectory, name), "utf8"),
    ]),
  )
  errors.push(...validateIngressSources(sources))
  const firecrawlCompose = readFileSync(
    resolve(root, "infra/firecrawl/compose.yaml"),
    "utf8",
  )
  add(
    errors,
    !/^ {4}(?:ports|network_mode):/m.test(firecrawlCompose),
    "Firecrawl exposes a host port or host network",
  )
  return errors
}

function parseJson(source, label, errors) {
  try {
    return JSON.parse(source)
  } catch {
    errors.push(`${label} is not valid JSON`)
    return null
  }
}

function add(errors, condition, message) {
  if (!condition) {
    errors.push(message)
  }
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function count(source, value) {
  return source.split(value).length - 1
}

function sha256(source) {
  return createHash("sha256").update(source).digest("hex")
}

function hostServerSection(source, host, nextHost) {
  const start = source.indexOf(`server_name ${host};`)
  if (start < 0) {
    return ""
  }
  const end = nextHost
    ? source.indexOf(`server_name ${nextHost};`, start + host.length)
    : source.length
  return source.slice(start, end < 0 ? source.length : end)
}

function locationDeclarations(server) {
  return [...server.matchAll(/^\s*location\s+(.+)\s+\{/gm)].map(
    (match) => match[1],
  )
}

function exactLocationSection(server, declaration) {
  const start = server.indexOf(`location ${declaration} {`)
  if (start < 0) {
    return ""
  }
  const next = server.indexOf("\n    location ", start + declaration.length)
  return server.slice(start, next < 0 ? server.length : next)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const errors = validateIngressPackage()
  if (errors.length > 0) {
    for (const error of errors) {
      process.stderr.write(`${error}\n`)
    }
    process.exitCode = 1
  } else {
    process.stdout.write("Product edge source policy passed\n")
  }
}
