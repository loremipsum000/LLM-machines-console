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
  "prometheus",
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
  "identity-token",
  "identity-revocation",
  "identity-jwks",
  "identity-login-actions",
  "identity-resources",
]
const expectedCoreApiRoutes = [
  ["inference-models", "GET,HEAD", "/v1/models", "console-bff"],
  [
    "inference-chat-completions",
    "POST",
    "/v1/chat/completions",
    "console-bff",
  ],
  ["firecrawl-search", "POST", "/v2/search", "console-bff"],
  ["firecrawl-scrape", "POST", "/v2/scrape", "console-bff"],
]

export function validateIngressSources(sources) {
  const errors = []
  const policy = parseJson(sources["edge-policy.json"], "edge-policy.json", errors)
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
  validateNginx(sources, errors)
  validateHeaders(sources, errors)
  validateCredentialSafety(sources, errors)
  return errors
}

function validatePolicy(policy, errors) {
  add(errors, policy.schemaVersion === 1, "edge policy schema version changed")
  add(errors, policy.workPackage === "PR-11A-R1-E1", "edge policy package changed")
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
      console: "@@PRODUCT_CONSOLE_HOST@@",
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
      ["console", "identity"].includes(route.hostId),
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
    sameJson(policy.customerNetwork?.deniedNativeTcpPorts, [
      3000, 3002, 4000, 4001, 8080, 9090, 9093, 9443,
    ]),
    "native-port denial set changed",
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
    listens.length === 3 && listens.every((value) => value.startsWith("443 ssl")),
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
    count(nginx, "server_name @@PRODUCT_CONSOLE_HOST@@;") === 1 &&
      count(nginx, "server_name @@PRODUCT_IDENTITY_HOST@@;") === 1,
    "public Nginx hosts changed",
  )
  add(
    errors,
    count(nginx, 'if ($ssl_server_name = "") { return 421; }') === 2 &&
      count(nginx, "if ($http_host != $ssl_server_name) { return 421; }") === 2,
    "Host and SNI equality checks changed",
  )
  add(
    errors,
    count(nginx, "include /etc/nginx/llm-machines/request-safety.inc;") === 2,
    "raw-path safety is not applied to every public host",
  )
  for (const fixedProxy of [
    "http://console_bff/api/app-gateway/v1/models",
    "http://console_bff/api/app-gateway/v1/chat/completions",
    "http://console_bff/v2/search",
    "http://console_bff/v2/scrape",
    "http://keycloak_identity/realms/llm-machines/protocol/openid-connect/auth",
  ]) {
    add(errors, nginx.includes(`proxy_pass ${fixedProxy};`), `missing ${fixedProxy}`)
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
    add(errors, common.includes(`proxy_set_header ${name} `), `missing ${name} reset`)
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
    [/\b(?:password|secret|token)\s*[:=]\s*["'][^@\n"']{12,}["']/i, "inline credential"],
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
