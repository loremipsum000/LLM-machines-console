import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import {
  validateAllowlist,
  validateCompose,
  validateImageEnvironment,
  validateProfile,
  validateSanitizedSources,
  validateSearx,
  validateSourceLock,
  validateSquid,
} from "./validate-profile.mjs"

const root = path.dirname(fileURLToPath(import.meta.url))
const registryHost = "harbor.invalid"
const compose = readFileSync(path.join(root, "compose.yaml"), "utf8")
const squid = readFileSync(path.join(root, "egress/squid.conf"), "utf8")
const searx = readFileSync(path.join(root, "searxng/settings.yml"), "utf8")
const sourceLock = readFileSync(
  path.join(root, "provenance/source-lock.json"),
  "utf8",
)

test("checked-in source profile passes", () => {
  assert.deepEqual(validateProfile(), [])
})

test("host-published ports are rejected", () => {
  const changed = compose.replace(
    "    networks:\n      control: {}",
    '    ports:\n      - "3002:3002"\n    networks:\n      control: {}',
  )
  assert.ok(
    validateCompose(changed).some((error) => error.includes("forbidden")),
  )
})

test("a request-bearing service cannot join the egress network", () => {
  const changed = compose.replace(
    "      control: {}\n      search: {}",
    "      control: {}\n      egress: {}\n      search: {}",
  )
  assert.ok(
    validateCompose(changed).some((error) =>
      error.includes("firecrawl-api networks must be exactly"),
    ),
  )
})

test("a service cannot override the default-off runtime policy", () => {
  const changed = compose.replace(
    "    image: ${FIRECRAWL_API_IMAGE",
    "    restart: always\n    image: ${FIRECRAWL_API_IMAGE",
  )
  assert.ok(
    validateCompose(changed).some((error) => error.includes("forbidden")),
  )
})

test("an unreviewed persistent mount is rejected", () => {
  const changed = compose.replace(
    "    tmpfs:\n      - /tmp:rw,noexec,nosuid,size=512m",
    "    volumes:\n      - firecrawl-data:/data\n    tmpfs:\n      - /tmp:rw,noexec,nosuid,size=512m",
  )
  assert.ok(
    validateCompose(changed).some((error) =>
      error.includes("unreviewed persistent mount"),
    ),
  )
})

test("queue and database services are rejected", () => {
  const changed = compose.replace(
    "services:\n",
    "services:\n  firecrawl-postgres:\n    image: invalid\n",
  )
  const errors = validateCompose(changed)
  assert.ok(
    errors.some((error) => error.includes("service set must be exactly")),
  )
  assert.ok(errors.some((error) => error.includes("forbidden service present")))
})

test("proxy cannot allow clients without an exact hostname", () => {
  const changed = squid.replace(
    "http_access allow firecrawl_clients allowed_destinations",
    "http_access allow firecrawl_clients",
  )
  assert.ok(validateSquid(changed).length > 0)
})

test("proxy rejects any effective allow before the governed allowlist rule", () => {
  const changed = squid.replace(
    "http_access deny !firecrawl_clients",
    "http_access allow all\nhttp_access deny !firecrawl_clients",
  )
  assert.ok(
    validateSquid(changed).some((error) =>
      error.includes("exact governed order"),
    ),
  )
})

test("proxy rejects whitespace-obscured and included access rules", () => {
  const whitespaceRule = squid.replace(
    "http_access deny !firecrawl_clients",
    "http_access\tallow\tall\nhttp_access deny !firecrawl_clients",
  )
  assert.ok(
    validateSquid(whitespaceRule).some((error) =>
      error.includes("exact governed order"),
    ),
  )

  const includedRule = squid.replace(
    "http_access deny !firecrawl_clients",
    "include /tmp/unreviewed-squid.conf\nhttp_access deny !firecrawl_clients",
  )
  assert.ok(
    validateSquid(includedRule).some((error) =>
      error.includes("must not include unreviewed configuration"),
    ),
  )
})

test("search cannot add a shared cache", () => {
  assert.ok(
    validateSearx(`${searx}\nredis:\n  url: redis://cache\n`).length > 0,
  )
})

test("source provenance cannot claim release admission", () => {
  const changed = sourceLock.replace(
    '"source-candidate-not-release-admitted"',
    '"release-admitted"',
  )
  assert.ok(
    validateSourceLock(changed).some((error) =>
      error.includes("unexpected candidate status"),
    ),
  )
})

test("retired integration names fail sanitization", () => {
  assert.ok(
    validateSanitizedSources({ candidate: ["Her", "mes"].join("") }).length > 0,
  )
})

test("exact public hostnames pass allowlist syntax validation", () => {
  assert.deepEqual(
    validateAllowlist("example.org\nwww.wikidata.org\n", {
      requireHosts: true,
    }),
    [],
  )
})

test("wildcards, URLs, IP literals, private suffixes, and hosted fallback fail", () => {
  for (const value of [
    "*.example.org",
    "https://example.org",
    "203.0.113.9",
    "service.invalid",
    "api.firecrawl.dev",
  ]) {
    assert.ok(
      validateAllowlist(`${value}\n`, { requireHosts: true }).length > 0,
      `${value} should fail`,
    )
  }
})

test("deny-all sentinel cannot enable the profile", () => {
  assert.ok(
    validateAllowlist("deny-all.invalid\n", { requireHosts: true }).some(
      (error) => error.includes("at least one admitted hostname"),
    ),
  )
})

test("allowlist is bounded to 256 exact hostnames", () => {
  const hosts = Array.from(
    { length: 257 },
    (_, index) => `host-${index}.example.org`,
  ).join("\n")
  assert.ok(
    validateAllowlist(hosts, { requireHosts: true }).some((error) =>
      error.includes("must not exceed 256"),
    ),
  )
})

test("exact private-registry digests pass without exposing values", () => {
  const digest = "a".repeat(64)
  const source = [
    `FIRECRAWL_API_IMAGE=harbor.invalid/firecrawl/api@sha256:${digest}`,
    `FIRECRAWL_BROWSER_IMAGE=harbor.invalid/firecrawl/browser@sha256:${digest}`,
    `FIRECRAWL_SEARCH_IMAGE=harbor.invalid/firecrawl/search@sha256:${digest}`,
    `FIRECRAWL_EGRESS_IMAGE=harbor.invalid/firecrawl/egress@sha256:${digest}`,
  ].join("\n")
  assert.deepEqual(validateImageEnvironment(source, { registryHost }), [])
})

test("an exact trusted registry authority may include a numeric port", () => {
  const digest = "d".repeat(64)
  const trustedAuthority = "harbor.invalid:5443"
  const source = [
    `FIRECRAWL_API_IMAGE=${trustedAuthority}/firecrawl/api@sha256:${digest}`,
    `FIRECRAWL_BROWSER_IMAGE=${trustedAuthority}/firecrawl/browser@sha256:${digest}`,
    `FIRECRAWL_SEARCH_IMAGE=${trustedAuthority}/firecrawl/search@sha256:${digest}`,
    `FIRECRAWL_EGRESS_IMAGE=${trustedAuthority}/firecrawl/egress@sha256:${digest}`,
  ].join("\n")
  assert.deepEqual(
    validateImageEnvironment(source, { registryHost: trustedAuthority }),
    [],
  )
})

test("public registries and tag-only images fail", () => {
  const digest = "b".repeat(64)
  const source = [
    `FIRECRAWL_API_IMAGE=docker.io/firecrawl/api@sha256:${digest}`,
    "FIRECRAWL_BROWSER_IMAGE=harbor.invalid/firecrawl/browser:latest",
    `FIRECRAWL_SEARCH_IMAGE=harbor.invalid/firecrawl/search@sha256:${digest}`,
    `FIRECRAWL_EGRESS_IMAGE=harbor.invalid/firecrawl/egress@sha256:${digest}`,
  ].join("\n")
  const errors = validateImageEnvironment(source, { registryHost })
  assert.ok(errors.some((error) => error.includes("must use harbor.invalid")))
  assert.ok(
    errors.some((error) => error.includes("exact registry image digest")),
  )
})

test("untrusted registries and unreviewed repositories fail closed", () => {
  const digest = "e".repeat(64)
  const source = [
    `FIRECRAWL_API_IMAGE=attacker.example/firecrawl/api@sha256:${digest}`,
    `FIRECRAWL_BROWSER_IMAGE=${registryHost}/firecrawl/unreviewed@sha256:${digest}`,
    `FIRECRAWL_SEARCH_IMAGE=${registryHost}/firecrawl/search@sha256:${digest}`,
    `FIRECRAWL_EGRESS_IMAGE=${registryHost}/firecrawl/egress@sha256:${digest}`,
  ].join("\n")
  const errors = validateImageEnvironment(source, { registryHost })
  assert.ok(errors.some((error) => error.includes("FIRECRAWL_API_IMAGE")))
  assert.ok(errors.some((error) => error.includes("FIRECRAWL_BROWSER_IMAGE")))
})

test("registry authority rejects schemes, paths, credentials, IPs, and wildcards", () => {
  const digest = "f".repeat(64)
  const source = [
    `FIRECRAWL_API_IMAGE=${registryHost}/firecrawl/api@sha256:${digest}`,
    `FIRECRAWL_BROWSER_IMAGE=${registryHost}/firecrawl/browser@sha256:${digest}`,
    `FIRECRAWL_SEARCH_IMAGE=${registryHost}/firecrawl/search@sha256:${digest}`,
    `FIRECRAWL_EGRESS_IMAGE=${registryHost}/firecrawl/egress@sha256:${digest}`,
  ].join("\n")
  for (const invalid of [
    "https://harbor.invalid",
    "harbor.invalid/project",
    "user@harbor.invalid",
    "192.0.2.10",
    "*.harbor.invalid",
    "harbor.invalid/",
    "harbor.invalid:65536",
  ]) {
    assert.ok(
      validateImageEnvironment(source, { registryHost: invalid }).some(
        (error) =>
          error.includes("registry host must be an exact DNS hostname"),
      ),
      `${invalid} should fail`,
    )
  }
})

test("runtime allowlist directory cannot use persistent storage", () => {
  const digest = "c".repeat(64)
  const source = [
    `FIRECRAWL_API_IMAGE=harbor.invalid/firecrawl/api@sha256:${digest}`,
    `FIRECRAWL_BROWSER_IMAGE=harbor.invalid/firecrawl/browser@sha256:${digest}`,
    `FIRECRAWL_SEARCH_IMAGE=harbor.invalid/firecrawl/search@sha256:${digest}`,
    `FIRECRAWL_EGRESS_IMAGE=harbor.invalid/firecrawl/egress@sha256:${digest}`,
    "FIRECRAWL_EGRESS_ALLOWLIST_DIR=/var/lib/firecrawl/allowlist",
  ].join("\n")
  assert.ok(
    validateImageEnvironment(source, { registryHost }).some((error) =>
      error.includes("volatile Firecrawl runtime directory"),
    ),
  )
})

test("the CLI requires a trusted registry whenever an env file is reviewed", () => {
  const result = spawnSync(
    process.execPath,
    [path.join(root, "validate-profile.mjs"), "--env", "missing.env"],
    { encoding: "utf8" },
  )
  assert.equal(result.status, 2)
  assert.match(result.stderr, /--env requires --registry HOST/)
})
