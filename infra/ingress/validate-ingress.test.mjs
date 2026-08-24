import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import {
  validateIngressPackage,
  validateIngressSources,
} from "./validate-ingress.mjs"

const directory = dirname(fileURLToPath(import.meta.url))
const sourceNames = [
  "README.md",
  "edge-policy.json",
  "native-admin-edge-profile.json",
  "no-bypass-policy.json",
  "product-edge.nginx.conf.template",
  "proxy-common.inc",
  "request-headers-console-browser.inc",
  "request-headers-customer-api.inc",
  "request-headers-identity-browser.inc",
  "request-headers-grafana-browser.inc",
  "request-headers-keycloak-admin-browser.inc",
  "request-headers-litellm-browser.inc",
  "request-safety.inc",
  "source-no-bypass.mjs",
  "source-no-bypass.test.mjs",
  "validate-ingress.mjs",
  "validate-ingress.test.mjs",
]
const sources = Object.fromEntries(
  sourceNames.map((name) => [
    name,
    readFileSync(resolve(directory, name), "utf8"),
  ]),
)

function changed(name, transform) {
  return { ...sources, [name]: transform(sources[name]) }
}

test("checked-in Product edge package passes", () => {
  assert.deepEqual(validateIngressPackage(), [])
})

test("only the three admitted native hosts and upstreams are present", () => {
  assert.match(
    sources["product-edge.nginx.conf.template"],
    /server_name @@PRODUCT_GRAFANA_HOST@@;/,
  )
  assert.match(
    sources["product-edge.nginx.conf.template"],
    /server_name @@PRODUCT_LITELLM_HOST@@;/,
  )
  assert.match(
    sources["product-edge.nginx.conf.template"],
    /server_name @@PRODUCT_KEYCLOAK_ADMIN_HOST@@;/,
  )
  for (const mutation of [
    "\nupstream portainer { server portainer:9443; }\n",
    "\nserver { listen 443 ssl; server_name portainer.appliance.test; }\n",
    "\nupstream prometheus { server prometheus:9090; }\n",
  ]) {
    const result = validateIngressSources(
      changed(
        "product-edge.nginx.conf.template",
        (source) => source + mutation,
      ),
    )
    assert.ok(
      result.some((error) =>
        /upstream|hostname|listener|fingerprint/i.test(error),
      ),
    )
  }
})

test("variable targets and extra listeners fail", () => {
  const variable = validateIngressSources(
    changed("product-edge.nginx.conf.template", (source) =>
      source.replace(
        "proxy_pass http://console_bff/v2/search;",
        "proxy_pass $http_x_upstream;",
      ),
    ),
  )
  assert.ok(variable.some((error) => /proxy target/i.test(error)))
  const listener = validateIngressSources(
    changed("product-edge.nginx.conf.template", (source) =>
      source.replace(
        "listen 443 ssl default_server;",
        "listen 80;\n    listen 443 ssl default_server;",
      ),
    ),
  )
  assert.ok(listener.some((error) => /listener/i.test(error)))
})

test("Host SNI and raw-path controls cannot be removed", () => {
  for (const fragment of [
    'if ($ssl_server_name = "") { return 421; }',
    "if ($http_host != $ssl_server_name) { return 421; }",
    "include /etc/nginx/llm-machines/request-safety.inc;",
  ]) {
    const result = validateIngressSources(
      changed("product-edge.nginx.conf.template", (source) =>
        source.replace(fragment, ""),
      ),
    )
    assert.ok(result.some((error) => /Host|SNI|path/i.test(error)))
  }
  const safety = validateIngressSources(
    changed("request-safety.inc", (source) => source.replace("%25|", "")),
  )
  assert.ok(safety.some((error) => /path/i.test(error)))
})

test("buffering caching and content-bearing logs fail", () => {
  for (const [name, before, after] of [
    [
      "proxy-common.inc",
      "proxy_request_buffering off;",
      "proxy_request_buffering on;",
    ],
    ["proxy-common.inc", "proxy_buffering off;", "proxy_buffering on;"],
    ["proxy-common.inc", "proxy_cache off;", "proxy_cache product_cache;"],
    [
      "product-edge.nginx.conf.template",
      '"surface":"$llmm_surface"',
      '"surface":"$llmm_surface","target":"$request_uri"',
    ],
  ]) {
    const result = validateIngressSources(
      changed(name, (source) => source.replace(before, after)),
    )
    assert.ok(
      result.some((error) => /content|proxy|log|buffer|cache/i.test(error)),
    )
  }
})

test("retained cookies and redirects cannot be suppressed", () => {
  for (const header of ["Set-Cookie", "Location"]) {
    const result = validateIngressSources(
      changed(
        "proxy-common.inc",
        (source) => `${source}\nproxy_hide_header ${header};\n`,
      ),
    )
    assert.ok(result.some((error) => /cookie|redirect/i.test(error)))
  }
})

test("identity outage recovery is fixed to the Console sign-in surface", () => {
  for (const replacement of [
    'return 503 \'{"error":"identity_unavailable"}\';',
    "return 303 https://@@PRODUCT_CONSOLE_HOST@@$request_uri;",
    "return 303 https://attacker.invalid/;",
  ]) {
    const result = validateIngressSources(
      changed("product-edge.nginx.conf.template", (source) =>
        source.replace(
          "return 303 https://@@PRODUCT_CONSOLE_HOST@@/auth/unavailable?returnTo=%2Fauth%2Fsignin;",
          replacement,
        ),
      ),
    )
    assert.ok(
      result.some((error) => /identity browser outage recovery/i.test(error)),
    )
  }
})

test("coordinated logout stays bounded and independent of native availability", () => {
  for (const [before, after] of [
    ["proxy_connect_timeout 2s;", "proxy_connect_timeout 30s;"],
    ["proxy_read_timeout 2s;", "proxy_read_timeout 30s;"],
    ["proxy_send_timeout 2s;", "proxy_send_timeout 30s;"],
    [
      "error_page 502 503 504 = @grafana_global_logout_fallback;",
      "error_page 502 503 504 =503 /__llmm_native_unavailable?;",
    ],
  ]) {
    const result = validateIngressSources(
      changed("product-edge.nginx.conf.template", (source) =>
        source.replace(before, after),
      ),
    )
    assert.ok(result.some((error) => /global-logout|logout/i.test(error)))
  }

  const upstreamDependent = validateIngressSources(
    changed("product-edge.nginx.conf.template", (source) =>
      source.replace(
        'location = /__llmm/global-logout {\n      limit_except GET HEAD { deny all; }\n      if ($llmm_query_none = 0) { return 400; }\n      add_header Cache-Control "no-store" always;\n      add_header Referrer-Policy "no-referrer" always;\n      add_header Set-Cookie "token=;',
        'location = /__llmm/global-logout {\n      proxy_pass http://litellm_native;\n      limit_except GET HEAD { deny all; }\n      if ($llmm_query_none = 0) { return 400; }\n      add_header Cache-Control "no-store" always;\n      add_header Referrer-Policy "no-referrer" always;\n      add_header Set-Cookie "token=;',
      ),
    ),
  )
  assert.ok(
    upstreamDependent.some((error) => /LiteLLM global logout/i.test(error)),
  )

  for (const mutate of [
    (profile) => {
      profile.edge.globalLogout.keycloakEndSession.timeoutMs = 30_000
    },
    (profile) => {
      profile.edge.globalLogout.keycloakEndSession.order =
        "AFTER_NATIVE_BROWSER_CHAIN"
    },
    (profile) => {
      profile.edge.globalLogout.keycloakEndSession.failureSkipsNativeChain = true
    },
    (profile) => {
      profile.edge.globalLogout.recoveredServiceMayReusePreLogoutBrowserSession = true
    },
  ]) {
    const profile = JSON.parse(sources["native-admin-edge-profile.json"])
    mutate(profile)
    const result = validateIngressSources({
      ...sources,
      "native-admin-edge-profile.json": JSON.stringify(profile),
    })
    assert.ok(result.some((error) => /edge boundary/i.test(error)))
  }
})

test("Console cookies, bearer tokens, and WebSockets stay separated", () => {
  const identityCookie = validateIngressSources(
    changed("product-edge.nginx.conf.template", (source) =>
      source.replace(
        'if ($http_cookie ~* "(?:^|;\\\\s*)__Host-llm-machines-(?:session|login)=") { return 400; }',
        "",
      ),
    ),
  )
  assert.ok(
    identityCookie.some((error) => /Console session cookies/i.test(error)),
  )
  const browserBearer = validateIngressSources(
    changed("request-headers-identity-browser.inc", (source) =>
      source.replace(
        'proxy_set_header Authorization "";',
        "proxy_set_header Authorization $http_authorization;",
      ),
    ),
  )
  assert.ok(browserBearer.some((error) => /identity browser/i.test(error)))
  const websocket = validateIngressSources(
    changed("proxy-common.inc", (source) =>
      source.replace(
        'proxy_set_header Upgrade "";',
        "proxy_set_header Upgrade $http_upgrade;",
      ),
    ),
  )
  assert.ok(websocket.some((error) => /Upgrade reset/i.test(error)))
})

test("policy cannot add a route or claim runtime proof", () => {
  const policy = JSON.parse(sources["edge-policy.json"])
  policy.routes.push({ ...policy.routes[0], id: "native-extra" })
  let result = validateIngressSources({
    ...sources,
    "edge-policy.json": JSON.stringify(policy),
  })
  assert.ok(result.some((error) => /route/i.test(error)))

  const runtimePolicy = JSON.parse(sources["edge-policy.json"])
  runtimePolicy.runtimeQualification.directNetworkNoBypass = "PASSED"
  result = validateIngressSources({
    ...sources,
    "edge-policy.json": JSON.stringify(runtimePolicy),
  })
  assert.ok(result.some((error) => /runtime/i.test(error)))
})

test("public routes cannot drift across the four authorities", () => {
  const policy = JSON.parse(sources["edge-policy.json"])
  policy.routes.find((route) => route.id === "inference-models").hostId =
    "console"
  let result = validateIngressSources({
    ...sources,
    "edge-policy.json": JSON.stringify(policy),
  })
  assert.ok(result.some((error) => /inference|Firecrawl/i.test(error)))

  const hosts = JSON.parse(sources["edge-policy.json"])
  hosts.edge.hostTemplates.firecrawl = undefined
  result = validateIngressSources({
    ...sources,
    "edge-policy.json": JSON.stringify(hosts),
  })
  assert.ok(result.some((error) => /public host/i.test(error)))
})

test("every public Nginx location is exact-allowlisted", () => {
  for (const [host, before, extra] of [
    [
      "Console",
      "    location = /api/console/session/login {",
      "    location = /api/admin/hidden { return 204; }\n\n",
    ],
    [
      "API",
      "    location = /v1/models {",
      "    location = /v1/hidden { proxy_pass http://console_bff/healthz; }\n\n",
    ],
    [
      "Firecrawl",
      "    location = /v2/search {",
      "    location = /v2/crawl { proxy_pass http://console_bff/v2/crawl; }\n\n",
    ],
    [
      "identity",
      "    location = /realms/llm-machines/protocol/openid-connect/auth {",
      "    location = /admin/master/console/ { proxy_pass http://keycloak_identity/admin/master/console/; }\n\n",
    ],
    [
      "grafana",
      "    location = /login/generic_oauth {",
      "    location = /api/admin/users { proxy_pass http://grafana_native; }\n\n",
    ],
    [
      "litellm",
      "    location = /key/generate {",
      "    location = /router/settings { proxy_pass http://litellm_native; }\n\n",
    ],
    [
      "keycloakAdmin",
      "    location = /keycloak/admin/realms/llm-machines/users {",
      "    location = /keycloak/admin/master/console/ { proxy_pass http://keycloak_identity; }\n\n",
    ],
  ]) {
    const result = validateIngressSources(
      changed("product-edge.nginx.conf.template", (source) =>
        source.replace(before, `${extra}${before}`),
      ),
    )
    assert.ok(
      result.some((error) =>
        new RegExp(`Nginx ${host} location inventory`, "i").test(error),
      ),
      host,
    )
  }
})

test("native profiles remain source-only and preserve admitted roles", () => {
  const profile = JSON.parse(sources["native-admin-edge-profile.json"])
  profile.activation = "ACTIVE"
  profile.runtimeQualified = true
  let result = validateIngressSources({
    ...sources,
    "native-admin-edge-profile.json": JSON.stringify(profile),
  })
  assert.ok(
    result.some((error) => /activation|qualification|runtime/i.test(error)),
  )

  const roles = JSON.parse(sources["native-admin-edge-profile.json"])
  roles.services.grafana.roles.Operator = "Editor"
  roles.services.litellm.roles.Operator = "proxy_admin"
  result = validateIngressSources({
    ...sources,
    "native-admin-edge-profile.json": JSON.stringify(roles),
  })
  assert.ok(result.some((error) => /Grafana|LiteLLM/i.test(error)))
})

test("native hosts reject Console sessions and Product credentials", () => {
  for (const before of [
    '    if ($http_cookie ~* "(?:^|;\\\\s*)__Host-llm-machines-(?:session|login)=") { return 400; }\n',
    "    if ($llmm_native_product_credential = 1) { return 400; }\n",
  ]) {
    const result = validateIngressSources(
      changed("product-edge.nginx.conf.template", (source) =>
        source.replace(before, ""),
      ),
    )
    assert.ok(
      result.some((error) => /Console|credential|fingerprint/i.test(error)),
    )
  }
})

test("native query-key allowlists cannot be broadened or removed", () => {
  for (const [before, after] of [
    [
      "if ($llmm_query_grafana_oauth = 0) { return 400; }",
      "if ($args = blocked) { return 400; }",
    ],
    [
      "if ($llmm_query_grafana_login = 0) { return 400; }",
      "if ($args = blocked) { return 400; }",
    ],
    [
      "if ($llmm_query_litellm_key_list = 0) { return 400; }",
      "if ($args = blocked) { return 400; }",
    ],
    [
      "if ($llmm_query_keycloak_authorization = 0) { return 400; }",
      "if ($args = blocked) { return 400; }",
    ],
  ]) {
    const result = validateIngressSources(
      changed("product-edge.nginx.conf.template", (source) =>
        source.replace(before, after),
      ),
    )
    assert.ok(result.some((error) => /fingerprint|route|query/i.test(error)))
  }
})

test("Grafana OAuth admits only empty initiation or exact callback keys", () => {
  const nginx = sources["product-edge.nginx.conf.template"]
  const map = nginx.match(
    /map \$args \$llmm_query_grafana_oauth \{[\s\S]*?\n {2}\}/,
  )?.[0]
  assert.equal(
    map,
    [
      "map $args $llmm_query_grafana_oauth {",
      "    default 0;",
      '    "" 1;',
      '    "redirectTo=" 1;',
      '    "~^redirectTo=%2F(?!%2F)(?!.*%(?:25|5[Cc]))(?:[A-Za-z0-9._~-]|%[0-9A-Fa-f]{2})*$" 1;',
      "    ~^(?:code|iss|session_state|state)=[^&]*(?:&(?:code|iss|session_state|state)=[^&]*)*$ 1;",
      "  }",
    ].join("\n"),
  )
  assert.match(
    nginx,
    /location = \/login\/generic_oauth \{[\s\S]{0,200}if \(\$llmm_query_grafana_oauth = 0\) \{ return 400; \}/,
  )

  for (const changedMap of [
    map.replace('    "" 1;', '    "" 0;'),
    map.replace('    "redirectTo=" 1;', "    ~^redirectTo=.*$ 1;"),
    map.replace(
      '    "~^redirectTo=%2F(?!%2F)(?!.*%(?:25|5[Cc]))(?:[A-Za-z0-9._~-]|%[0-9A-Fa-f]{2})*$" 1;',
      '    "~^redirectTo=.*$" 1;',
    ),
    map.replace(
      "    ~^(?:code|iss|session_state|state)=[^&]*(?:&(?:code|iss|session_state|state)=[^&]*)*$ 1;",
      "    ~^.*$ 1;",
    ),
    map.replaceAll(
      "code|iss|session_state|state",
      "code|iss|redirect_uri|session_state|state",
    ),
  ]) {
    const result = validateIngressSources(
      changed("product-edge.nginx.conf.template", (source) =>
        source.replace(map, changedMap),
      ),
    )
    assert.ok(result.some((error) => /fingerprint|query|Grafana/i.test(error)))
  }
})

test("Keycloak native user deletion remains denied before upstream", () => {
  const result = validateIngressSources(
    changed("product-edge.nginx.conf.template", (source) =>
      source.replace(
        "if ($request_method = DELETE) { return 403; }",
        "if ($request_method = TRACE) { return 403; }",
      ),
    ),
  )
  assert.ok(result.some((error) => /user deletion/i.test(error)))
})

test("Keycloak session invalidation accepts only exact 26.7.0 session IDs", () => {
  const nginx = sources["product-edge.nginx.conf.template"]
  const declaration =
    'location ~ "^/keycloak/admin/realms/llm-machines/sessions/[A-Za-z0-9_-]{24}$"'
  assert.match(
    nginx,
    new RegExp(declaration.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  )

  for (const [before, after] of [
    ["[A-Za-z0-9_-]{24}", "[A-Za-z0-9_-]{20,128}"],
    ["[A-Za-z0-9_-]{24}", "[0-9a-f-]{36}"],
    [
      "limit_except DELETE { deny all; }",
      "limit_except GET DELETE { deny all; }",
    ],
  ]) {
    const result = validateIngressSources(
      changed("product-edge.nginx.conf.template", (source) =>
        source.replace(before, after),
      ),
    )
    assert.ok(
      result.some((error) =>
        /fingerprint|location inventory|session invalidation/i.test(error),
      ),
    )
  }

  const profile = JSON.parse(sources["native-admin-edge-profile.json"])
  profile.services.keycloakAdmin.sessionIdentifierContract.entropyBytes = 16
  const result = validateIngressSources({
    ...sources,
    "native-admin-edge-profile.json": JSON.stringify(profile),
  })
  assert.ok(result.some((error) => /Keycloak native role|session/i.test(error)))
})

test("Keycloak Admin browser token exchange preserves only the exact origin", () => {
  const nginx = sources["product-edge.nginx.conf.template"]
  assert.match(
    nginx,
    /map \$http_origin \$llmm_identity_token_origin_allowed \{[\s\S]{0,180}"" 1;[\s\S]{0,180}"https:\/\/@@PRODUCT_KEYCLOAK_ADMIN_HOST@@" 1;/,
  )
  assert.match(
    nginx,
    /location = \/realms\/llm-machines\/protocol\/openid-connect\/token \{[\s\S]{0,260}if \(\$llmm_identity_token_origin_allowed = 0\) \{ return 403; \}[\s\S]{0,520}proxy_set_header Origin \$llmm_identity_token_origin;/,
  )

  for (const [before, after] of [
    ['    "https://@@PRODUCT_KEYCLOAK_ADMIN_HOST@@" 1;', "    ~^https:// 1;"],
    [
      "if ($llmm_identity_token_origin_allowed = 0) { return 403; }",
      "if ($llmm_identity_token_origin_allowed = 2) { return 403; }",
    ],
    [
      "proxy_set_header Origin $llmm_identity_token_origin;",
      "proxy_set_header Origin $http_origin;",
    ],
  ]) {
    const result = validateIngressSources(
      changed("product-edge.nginx.conf.template", (source) =>
        source.replace(before, after),
      ),
    )
    assert.ok(result.some((error) => /Origin|fingerprint/i.test(error)))
  }
})

test("Keycloak admin prefix normalization cannot escape its exact allowlist", () => {
  for (const [name, before, after] of [
    [
      "product-edge.nginx.conf.template",
      "rewrite ^/keycloak/(.*)$ /$1 break;",
      "rewrite ^/(.*)$ /$1 break;",
    ],
    [
      "request-headers-keycloak-admin-browser.inc",
      "proxy_set_header X-Forwarded-Prefix /keycloak;",
      'proxy_set_header X-Forwarded-Prefix "";',
    ],
    [
      "product-edge.nginx.conf.template",
      "    location = /realms/llm-machines/protocol/openid-connect/auth {",
      "    location = /keycloak/realms/llm-machines/protocol/openid-connect/auth {",
    ],
  ]) {
    const result = validateIngressSources(
      changed(name, (source) => source.replace(before, after)),
    )
    assert.ok(
      result.some((error) =>
        /fingerprint|prefix|identity|Keycloak|location inventory/i.test(error),
      ),
      name,
    )
  }
})

test("native sessions stay service-owned without proxy impersonation", () => {
  const forwardedConsole = validateIngressSources(
    changed("request-headers-litellm-browser.inc", (source) =>
      source.replace(
        'proxy_set_header X-LLM-Machines-Console-Session "";',
        "proxy_set_header X-LLM-Machines-Console-Session $http_cookie;",
      ),
    ),
  )
  assert.ok(forwardedConsole.some((error) => /LiteLLM browser/i.test(error)))

  const impersonation = validateIngressSources(
    changed(
      "product-edge.nginx.conf.template",
      (source) => `${source}\nauth_request /console-session;\n`,
    ),
  )
  assert.ok(impersonation.some((error) => /impersonation/i.test(error)))
})

test("LiteLLM native cookies retain exact transport and UI-readability flags", () => {
  for (const [before, after] of [
    [
      "proxy_cookie_flags ~^(?:litellm_cp_return_to|litellm_oauth_state|sso_state)$ secure httponly samesite=lax;",
      "proxy_cookie_flags ~^(?:litellm_cp_return_to|litellm_oauth_state|sso_state)$ secure samesite=lax;",
    ],
    [
      "proxy_cookie_flags token secure samesite=lax;",
      "proxy_cookie_flags token samesite=lax;",
    ],
    [
      "proxy_cookie_flags token secure samesite=lax;",
      "proxy_cookie_flags token secure httponly samesite=lax;",
    ],
    [
      "proxy_cookie_flags token secure samesite=lax;",
      "proxy_cookie_flags token secure samesite=none;",
    ],
  ]) {
    const result = validateIngressSources(
      changed("product-edge.nginx.conf.template", (source) =>
        source.replace(before, after),
      ),
    )
    assert.ok(result.some((error) => /LiteLLM native cookie/i.test(error)))
  }

  const profile = JSON.parse(sources["native-admin-edge-profile.json"])
  profile.services.litellm.cookieSecurity.nativeUiToken.httpOnly = true
  const result = validateIngressSources({
    ...sources,
    "native-admin-edge-profile.json": JSON.stringify(profile),
  })
  assert.ok(result.some((error) => /LiteLLM native cookie/i.test(error)))
})

test("reviewed public route implementations cannot change in place", () => {
  for (const [label, name, before, after] of [
    [
      "API catch-all",
      "product-edge.nginx.conf.template",
      "    location / {\n      return 404;\n    }\n  }\n\n  server {\n    listen 443 ssl;\n    server_name @@PRODUCT_FIRECRAWL_HOST@@;",
      "    location / {\n      include /etc/nginx/llm-machines/proxy-common.inc;\n      proxy_pass http://console_bff;\n    }\n  }\n\n  server {\n    listen 443 ssl;\n    server_name @@PRODUCT_FIRECRAWL_HOST@@;",
    ],
    [
      "Identity catch-all",
      "product-edge.nginx.conf.template",
      "    location / {\n      return 404;\n    }\n  }\n}",
      "    location / {\n      include /etc/nginx/llm-machines/proxy-common.inc;\n      proxy_pass http://keycloak_identity;\n    }\n  }\n}",
    ],
    [
      "API method guard",
      "product-edge.nginx.conf.template",
      '      limit_except GET { deny all; }\n      if ($args != "") { return 400; }\n      proxy_pass_request_body off;',
      '      if ($args != "") { return 400; }\n      proxy_pass_request_body off;',
    ],
    [
      "Identity browser Authorization",
      "product-edge.nginx.conf.template",
      "      include /etc/nginx/llm-machines/request-headers-identity-browser.inc;\n      proxy_set_header Host $llmm_public_host;",
      "      include /etc/nginx/llm-machines/request-headers-identity-browser.inc;\n      proxy_set_header Authorization $http_authorization;\n      proxy_set_header Host $llmm_public_host;",
    ],
    [
      "Console spoofed header",
      "request-headers-console-browser.inc",
      'proxy_set_header Authorization "";',
      'proxy_set_header Authorization "";\nproxy_set_header X-Original-URI $http_x_original_uri;',
    ],
  ]) {
    const result = validateIngressSources(
      changed(name, (source) => source.replace(before, after)),
    )
    assert.ok(
      result.some((error) => /runtime source fingerprint/i.test(error)),
      label,
    )
  }
})

test("Application client Basic auth is isolated to its exact token route", () => {
  const mapPattern = /"~([^"\n]+)" \$http_authorization;/.exec(
    sources["product-edge.nginx.conf.template"],
  )?.[1]
  assert.ok(mapPattern)
  const clientAuthorization = new RegExp(mapPattern)
  const clientId = "llmm-app-11111111-1111-4111-8111-111111111111"
  for (const scheme of ["Basic", "basic", "bAsIc"]) {
    for (const secret of ["s", "ss", "sss", "secret", "s".repeat(64)]) {
      assert.equal(
        clientAuthorization.test(
          `${scheme} ${Buffer.from(`${clientId}:${secret}`).toString("base64")}`,
        ),
        true,
      )
    }
  }
  assert.equal(
    clientAuthorization.test(
      `Basic ${Buffer.from(`llmm-app-${"z".repeat(36)}:secret`).toString("base64")}`,
    ),
    true,
    "Keycloak, not the edge envelope, validates the exact client ID",
  )
  for (const authorization of [
    "Basic a",
    "Basic abcde",
    `Basic ${Buffer.from(":secret").toString("base64")}`,
    `Basic ${Buffer.from(`${clientId}:`).toString("base64")}`,
    `Basic ${Buffer.from("other-client:secret").toString("base64")}`,
    `Basic ${Buffer.from(`${clientId}x:secret`).toString("base64")}`,
    `Basic ${Buffer.from(`${clientId}:secret`).toString("base64").replace("bGxt", "bGxT")}`,
  ]) {
    assert.equal(clientAuthorization.test(authorization), false, authorization)
  }

  const removedMap = validateIngressSources(
    changed("product-edge.nginx.conf.template", (source) =>
      source.replace(
        '"~^[Bb][Aa][Ss][Ii][Cc][ ]+bGxtbS1hcHAt[A-Za-z0-9+/]{48}(?:O[g-v][AEIMQUYcgkosw048]=|O[g-v][A-Za-z0-9+/]{2}(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/][AQgw]==|[A-Za-z0-9+/]{2}[AEIMQUYcgkosw048]=)?)$" $http_authorization;',
        '"~^Bearer .+$" $http_authorization;',
      ),
    ),
  )
  assert.ok(removedMap.some((error) => /Basic authentication/i.test(error)))

  const humanTokenForwarding = validateIngressSources(
    changed("product-edge.nginx.conf.template", (source) =>
      source.replace(
        "location = /realms/llm-machines/protocol/openid-connect/token {",
        "location = /realms/llm-machines/protocol/openid-connect/token {\n      proxy_set_header Authorization $llmm_application_client_authorization;",
      ),
    ),
  )
  assert.ok(
    humanTokenForwarding.some((error) =>
      /Authorization forwarding|Basic authentication/i.test(error),
    ),
  )

  const clientSecretPostFallback = validateIngressSources(
    changed("product-edge.nginx.conf.template", (source) =>
      source.replace(
        '      if ($llmm_application_client_authorization = "") { return 401; }\n',
        "",
      ),
    ),
  )
  assert.ok(
    clientSecretPostFallback.some((error) =>
      /Basic authentication/i.test(error),
    ),
  )
})

test("only the exact Keycloak logout confirmation route is retained", () => {
  const removed = validateIngressSources(
    changed("product-edge.nginx.conf.template", (source) =>
      source.replace(
        "location = /realms/llm-machines/protocol/openid-connect/logout/logout-confirm {",
        "location = /realms/llm-machines/protocol/openid-connect/logout/confirm {",
      ),
    ),
  )
  assert.ok(
    removed.some((error) => /location inventory|fingerprint/i.test(error)),
  )
})

test("LiteLLM UI shells are explicit and retired surfaces remain absent", () => {
  const profile = JSON.parse(sources["native-admin-edge-profile.json"])
  const uiPages = profile.services.litellm.routes.find(
    ({ id }) => id === "ui-pages",
  )
  const canonicalization = profile.services.litellm.routes.find(
    ({ id }) => id === "ui-page-canonicalization",
  )
  assert.ok(uiPages)
  assert.ok(canonicalization)
  const route = new RegExp(uiPages.path.value)
  const canonicalRoute = new RegExp(canonicalization.path.value)

  for (const path of [
    "/ui/api-keys/",
    "/ui/models-and-endpoints/",
    "/ui/usage/",
    "/ui/users/",
    "/ui/router-settings/",
  ])
    assert.equal(route.test(path), true, path)

  for (const path of ["/ui/api-keys", "/ui/usage"])
    assert.equal(canonicalRoute.test(path), true, path)

  for (const path of [
    "/ui/mcp-servers",
    "/ui/agents",
    "/ui/memory",
    "/ui/skills",
    "/ui/vector-stores",
    "/ui/unreviewed",
    "/ui/api-keys/extra",
  ])
    assert.equal(route.test(path), false, path)

  assert.equal(uiPages.queryPolicy, "litellm-ui")
  assert.deepEqual(uiPages.methods, ["GET", "HEAD"])
  assert.equal(canonicalization.behavior, "EDGE_308_TO_HTTPS_TRAILING_SLASH")
  assert.doesNotMatch(
    sources["product-edge.nginx.conf.template"],
    /location\s+~\s+\^\/ui\/\.\*/,
  )
})

test("LiteLLM Admin-page reads stay exact, metadata-only, and non-mutating", () => {
  const profile = JSON.parse(sources["native-admin-edge-profile.json"])
  const routes = profile.services.litellm.routes
  for (const [id, path] of [
    ["model-group-info", "/model_group/info"],
    ["model-info-v2", "/v2/model/info"],
    ["spend-logs-ui", "/spend/logs/ui"],
  ]) {
    const route = routes.find((candidate) => candidate.id === id)
    assert.equal(route.path.kind, "exact")
    assert.equal(route.path.value, path)
    assert.deepEqual(route.methods, ["GET", "HEAD"])
  }

  const nginx = sources["product-edge.nginx.conf.template"]
  assert.doesNotMatch(nginx, /location\s*=\s*\/config\/list/)
  assert.doesNotMatch(nginx, /location[^\n]*\/spend\/logs\/ui\//)
  assert.doesNotMatch(nginx, /audit-logs-preview\.png/)

  const broadened = changed("product-edge.nginx.conf.template", (source) =>
    source.replace(
      "location = /spend/logs/ui {",
      "location ^~ /spend/logs/ui {",
    ),
  )
  assert.ok(validateIngressSources(broadened).length > 0)
})

test("native listener inventory cannot omit Core or delivery-profile ports", () => {
  const policy = JSON.parse(sources["no-bypass-policy.json"])
  policy.customerNetwork.deniedNativeTcpPorts =
    policy.customerNetwork.deniedNativeTcpPorts.filter((port) => port !== 5432)
  policy.customerNetwork.deniedInferenceProfileTcpPorts = undefined
  const result = validateIngressSources({
    ...sources,
    "no-bypass-policy.json": JSON.stringify(policy),
  })
  assert.ok(result.some((error) => /native-port/i.test(error)))
  assert.ok(result.some((error) => /inference-profile/i.test(error)))
})

test("credential-like material fails without exposing a value", () => {
  const result = validateIngressSources(
    changed(
      "README.md",
      (source) => `${source}\nsecret = "not-a-real-secret-value"\n`,
    ),
  )
  assert.ok(result.some((error) => /credential/i.test(error)))
})
