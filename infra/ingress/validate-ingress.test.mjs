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

test("native administration hosts and upstreams are rejected", () => {
  for (const mutation of [
    "\nupstream litellm { server litellm:4000; }\n",
    "\nserver { listen 443 ssl; server_name litellm.appliance.test; }\n",
    "\nupstream grafana { server grafana:3000; }\n",
  ]) {
    const result = validateIngressSources(
      changed(
        "product-edge.nginx.conf.template",
        (source) => source + mutation,
      ),
    )
    assert.ok(result.some((error) => /upstream|hostname|listener/i.test(error)))
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
