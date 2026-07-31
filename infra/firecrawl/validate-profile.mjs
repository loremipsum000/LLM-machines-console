#!/usr/bin/env node

import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const profileRoot = path.dirname(fileURLToPath(import.meta.url))
const maxAllowedHosts = 256

const expectedNetworks = new Map([
  ["firecrawl-api", ["browser", "control", "proxy", "search"]],
  ["firecrawl-browser", ["browser", "proxy"]],
  ["firecrawl-search", ["proxy", "search"]],
  ["firecrawl-egress", ["egress", "proxy"]],
])

const expectedImages = new Map([
  ["firecrawl-api", "FIRECRAWL_API_IMAGE"],
  ["firecrawl-browser", "FIRECRAWL_BROWSER_IMAGE"],
  ["firecrawl-search", "FIRECRAWL_SEARCH_IMAGE"],
  ["firecrawl-egress", "FIRECRAWL_EGRESS_IMAGE"],
])

const expectedUsers = new Map([
  ["firecrawl-api", "65532:65532"],
  ["firecrawl-browser", "65532:65532"],
  ["firecrawl-search", "65532:65532"],
  ["firecrawl-egress", "13:13"],
])

const expectedResourcePrefixes = new Map([
  ["firecrawl-api", "API"],
  ["firecrawl-browser", "BROWSER"],
  ["firecrawl-search", "SEARCH"],
  ["firecrawl-egress", "EGRESS"],
])

const expectedVolumes = new Map([
  ["firecrawl-api", []],
  ["firecrawl-browser", []],
  ["firecrawl-search", ["./searxng/settings.yml:/etc/searxng/settings.yml:ro"]],
  [
    "firecrawl-egress",
    [
      "./egress/squid.conf:/etc/squid/squid.conf:ro",
      "${FIRECRAWL_EGRESS_ALLOWLIST_DIR:-./egress/allowlists/default}:/etc/squid/allowlists:ro",
    ],
  ],
])

const requiredImageRepositories = new Map([
  ["FIRECRAWL_API_IMAGE", "firecrawl/api"],
  ["FIRECRAWL_BROWSER_IMAGE", "firecrawl/browser"],
  ["FIRECRAWL_SEARCH_IMAGE", "firecrawl/search"],
  ["FIRECRAWL_EGRESS_IMAGE", "firecrawl/egress"],
])

const expectedHttpAccessRules = [
  "http_access deny !firecrawl_clients",
  "http_access deny !Safe_ports",
  "http_access deny CONNECT !Connect_ports",
  "http_access deny !Allowed_methods",
  "http_access deny blocked_hosted_service",
  "http_access deny blocked_v4",
  "http_access deny blocked_v6",
  "http_access allow firecrawl_clients allowed_destinations",
  "http_access deny all",
]

const reservedSuffixes = [
  ".example",
  ".home",
  ".internal",
  ".invalid",
  ".lan",
  ".local",
  ".localhost",
  ".onion",
  ".test",
]

function fail(errors, message) {
  errors.push(message)
}

function extractServiceBlocks(source) {
  const lines = source.split(/\r?\n/)
  const servicesIndex = lines.findIndex((line) => line === "services:")
  if (servicesIndex < 0) return new Map()

  const blocks = new Map()
  let current = null
  for (let index = servicesIndex + 1; index < lines.length; index++) {
    const line = lines[index]
    if (/^[^\s#]/.test(line)) break
    const service = line.match(/^ {2}([a-z0-9-]+):\s*$/)
    if (service) {
      current = service[1]
      blocks.set(current, [])
    } else if (current) {
      blocks.get(current).push(line)
    }
  }
  return new Map(
    [...blocks].map(([service, linesForService]) => [
      service,
      linesForService.join("\n"),
    ]),
  )
}

function extractServiceNetworks(block) {
  const lines = block.split(/\r?\n/)
  const networksIndex = lines.findIndex((line) => line === "    networks:")
  if (networksIndex < 0) return []
  const networks = []
  for (let index = networksIndex + 1; index < lines.length; index++) {
    const line = lines[index]
    if (/^ {4}\S/.test(line)) break
    const network = line.match(/^ {6}([a-z0-9-]+):(?:\s*\{\})?\s*$/)
    if (network) networks.push(network[1])
  }
  return networks.sort()
}

function extractList(block, property) {
  const lines = block.split(/\r?\n/)
  const propertyIndex = lines.findIndex((line) => line === `    ${property}:`)
  if (propertyIndex < 0) return []
  const values = []
  for (let index = propertyIndex + 1; index < lines.length; index++) {
    const line = lines[index]
    if (/^ {4}\S/.test(line)) break
    const item = line.match(/^ {6}- (.+)$/)
    if (item) values.push(item[1])
  }
  return values
}

export function validateCompose(source) {
  const errors = []
  const services = extractServiceBlocks(source)
  const actualNames = [...services.keys()].sort()
  const expectedNames = [...expectedNetworks.keys()].sort()

  if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
    fail(errors, `service set must be exactly ${expectedNames.join(", ")}`)
  }

  for (const [service, requiredNetworks] of expectedNetworks) {
    const block = services.get(service)
    if (!block) continue

    const checks = [
      [/^ {4}<<: \*runtime-policy$/m, "must inherit runtime-policy"],
      [
        new RegExp(`^ {4}image: \\$\\{${expectedImages.get(service)}:\\?`, "m"),
        `must use ${expectedImages.get(service)}`,
      ],
      [
        new RegExp(`^ {4}user: "${expectedUsers.get(service)}"$`, "m"),
        "must use the reviewed non-root UID and GID",
      ],
      [
        /^ {4}logging: \*no-request-logs$/m,
        "must disable container request logs",
      ],
      [/^ {4}pids_limit: [1-9][0-9]*$/m, "must set a PID limit"],
      [
        new RegExp(
          `^ {4}cpus: "\\$\\{FIRECRAWL_${expectedResourcePrefixes.get(service)}_CPUS:-[0-9.]+\\}"$`,
          "m",
        ),
        "must use a tunable CPU safety default",
      ],
      [
        new RegExp(
          `^ {4}mem_limit: "\\$\\{FIRECRAWL_${expectedResourcePrefixes.get(service)}_MEMORY:-[0-9]+[mg]\\}"$`,
          "m",
        ),
        "must use a tunable memory safety default",
      ],
      [
        new RegExp(
          `^ {4}memswap_limit: "\\$\\{FIRECRAWL_${expectedResourcePrefixes.get(service)}_MEMORY:-[0-9]+[mg]\\}"$`,
          "m",
        ),
        "must keep swap growth equal to the memory safety limit",
      ],
      [/^ {4}tmpfs:$/m, "must keep writable state on tmpfs"],
    ]
    for (const [pattern, message] of checks) {
      if (!pattern.test(block)) fail(errors, `${service} ${message}`)
    }

    const actualNetworks = extractServiceNetworks(block)
    const expected = [...requiredNetworks].sort()
    if (JSON.stringify(actualNetworks) !== JSON.stringify(expected)) {
      fail(errors, `${service} networks must be exactly ${expected.join(", ")}`)
    }

    const actualVolumes = extractList(block, "volumes")
    const expectedServiceVolumes = expectedVolumes.get(service)
    if (
      JSON.stringify(actualVolumes) !== JSON.stringify(expectedServiceVolumes)
    ) {
      fail(errors, `${service} contains an unreviewed persistent mount`)
    }

    const tmpfs = extractList(block, "tmpfs")
    if (
      tmpfs.length === 0 ||
      tmpfs.some(
        (mount) =>
          !mount.includes(":rw,noexec,nosuid,") || !mount.includes("size="),
      )
    ) {
      fail(errors, `${service} tmpfs mounts must be bounded and hardened`)
    }

    for (const forbidden of [
      /^ {4}ports:/m,
      /^ {4}network_mode:/m,
      /^ {4}privileged:/m,
      /^ {4}cap_add:/m,
      /^ {4}devices:/m,
      /^ {4}device_cgroup_rules:/m,
      /^ {4}dns:/m,
      /^ {4}dns_search:/m,
      /^ {4}extra_hosts:/m,
      /^ {4}external_links:/m,
      /^ {4}ipc:/m,
      /^ {4}links:/m,
      /^ {4}pid:/m,
      /^ {4}profiles:/m,
      /^ {4}pull_policy:/m,
      /^ {4}read_only:/m,
      /^ {4}restart:/m,
      /^ {4}sysctls:/m,
      /^ {4}userns:/m,
      /^ {4}uts:/m,
      /\/var\/run\/docker\.sock/,
    ]) {
      if (forbidden.test(block)) {
        fail(errors, `${service} contains a forbidden runtime capability`)
      }
    }
  }

  for (const requirement of [
    [
      /^x-runtime-policy:[\s\S]*?^ {2}profiles:\n {4}- firecrawl$/m,
      "runtime policy must be default-off under the firecrawl profile",
    ],
    [/^ {2}pull_policy: never$/m, "runtime policy must prohibit image pulls"],
    [
      /^ {2}read_only: true$/m,
      "runtime policy must use a read-only root filesystem",
    ],
    [
      /^ {2}cap_drop:\n {4}- ALL$/m,
      "runtime policy must drop all Linux capabilities",
    ],
    [
      /^ {2}security_opt:\n {4}- no-new-privileges:true$/m,
      "runtime policy must prevent privilege escalation",
    ],
    [/^ {2}init: true$/m, "runtime policy must use an init process"],
    [/^ {2}restart: "no"$/m, "runtime policy must not auto-start services"],
    [
      /^ {6}MAX_CONCURRENT_JOBS: "\$\{FIRECRAWL_MAX_CONCURRENT_JOBS:-[1-9][0-9]*\}"$/m,
      "API concurrency must use the tunable safety default",
    ],
    [
      /^ {6}MAX_CONCURRENT_PAGES: "\$\{FIRECRAWL_MAX_CONCURRENT_JOBS:-[1-9][0-9]*\}"$/m,
      "browser concurrency must use the tunable safety default",
    ],
    [
      /^ {2}control:\n {4}name: [^\n]+\n {4}internal: true\n {4}enable_ipv6: false$/m,
      "control network must be internal and IPv4-only",
    ],
    [
      /^ {2}search:\n {4}name: [^\n]+\n {4}internal: true\n {4}enable_ipv6: false$/m,
      "search network must be internal and IPv4-only",
    ],
    [
      /^ {2}browser:\n {4}name: [^\n]+\n {4}internal: true\n {4}enable_ipv6: false$/m,
      "browser network must be internal and IPv4-only",
    ],
    [
      /^ {2}proxy:\n {4}name: [^\n]+\n {4}internal: true\n {4}enable_ipv6: false$/m,
      "proxy network must be internal and IPv4-only",
    ],
    [
      /^ {2}egress:\n {4}name: [^\n]+\n {4}enable_ipv6: false$/m,
      "egress network must be IPv4-only",
    ],
  ]) {
    if (!requirement[0].test(source)) fail(errors, requirement[1])
  }

  for (const forbiddenEnvironment of [
    /^ {6}(?:REDIS|POSTGRES|NUQ|RABBITMQ|RERANK)[A-Z0-9_]*:/m,
    /^ {6}(?:OPENAI|SEARCHAPI|FIRE_ENGINE|POSTHOG|SENTRY|SLACK)[A-Z0-9_]*:/m,
    /^ {6}(?:FIRECRAWL_DASHBOARD_URL|[A-Z_]*AUTH_RESOURCE_METADATA_URL):/m,
  ]) {
    if (forbiddenEnvironment.test(source)) {
      fail(errors, "compose contains an excluded dependency or hosted fallback")
    }
  }
  if (/^volumes:/m.test(source)) {
    fail(errors, "compose must not declare persistent named volumes")
  }

  for (const forbiddenName of [
    "postgres",
    "nuq",
    "rabbitmq",
    "reranker",
    "coordination-redis",
  ]) {
    if (actualNames.some((name) => name.includes(forbiddenName))) {
      fail(errors, `forbidden service present: ${forbiddenName}`)
    }
  }

  return errors
}

export function validateSquid(source) {
  const errors = []
  const required = [
    'acl allowed_destinations dstdomain "/etc/squid/allowlists/allowed-hosts.txt"',
    "acl blocked_hosted_service dstdomain api.firecrawl.dev",
    "acl blocked_v4 dst 10.0.0.0/8",
    "acl blocked_v4 dst 100.64.0.0/10",
    "acl blocked_v4 dst 127.0.0.0/8",
    "acl blocked_v4 dst 169.254.0.0/16",
    "acl blocked_v4 dst 172.16.0.0/12",
    "acl blocked_v4 dst 192.168.0.0/16",
    "acl blocked_v6 dst ::/0",
    "http_access deny blocked_hosted_service",
    "http_access deny blocked_v4",
    "http_access deny blocked_v6",
    "http_access allow firecrawl_clients allowed_destinations",
    "http_access deny all",
    "cache deny all",
    "access_log none",
    "cache_log /dev/null",
  ]
  for (const value of required) {
    if (!source.includes(value)) fail(errors, `squid policy missing: ${value}`)
  }
  const actualHttpAccessRules = source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^http_access(?:\s|$)/.test(line))
    .map((line) => line.split(/\s+/).join(" "))
  if (
    JSON.stringify(actualHttpAccessRules) !==
    JSON.stringify(expectedHttpAccessRules)
  ) {
    fail(errors, "squid http_access rules must match the exact governed order")
  }
  if (source.split(/\r?\n/).some((line) => /^\s*include(?:\s|$)/i.test(line))) {
    fail(errors, "squid policy must not include unreviewed configuration")
  }
  return errors
}

export function validateSearx(source) {
  const errors = []
  const required = [
    "use_default_settings:",
    "    keep_only:",
    '  secret_key: "%(ENV_SEARXNG_SECRET)s"',
    "  limiter: false",
    "    all://:",
    "      - http://firecrawl-egress:3128",
  ]
  for (const value of required) {
    if (!source.includes(value)) fail(errors, `search policy missing: ${value}`)
  }

  const engineNames = [...source.matchAll(/^ {2}- name: ([a-z0-9]+)$/gm)]
    .map((match) => match[1])
    .sort()
  const expectedEngines = ["duckduckgo", "wikidata", "wikipedia"]
  if (JSON.stringify(engineNames) !== JSON.stringify(expectedEngines)) {
    fail(
      errors,
      "search engine set must be exactly duckduckgo, wikidata, wikipedia",
    )
  }
  if (/^redis:/m.test(source) || /valkey/i.test(source)) {
    fail(errors, "search policy must not configure persistent or shared cache")
  }
  return errors
}

export function validateSourceLock(source) {
  const errors = []
  let lock
  try {
    lock = JSON.parse(source)
  } catch {
    return ["source lock must be valid JSON"]
  }

  const exact = [
    [lock.schema, "llm-machines.firecrawl-source-lock.v1", "schema"],
    [lock.status, "source-candidate-not-release-admitted", "candidate status"],
    [
      lock.checkpoint?.commit,
      "ff74f3c94c563627929af31c46d48dda8e7d6192",
      "checkpoint commit",
    ],
    [
      lock.checkpoint?.tree,
      "8a978eb0f6d0ef04a896ec29f138a84a7cf14d79",
      "checkpoint tree",
    ],
    [lock.upstream?.tag, "v2.11.0", "upstream tag"],
    [
      lock.upstream?.commit,
      "ef12eb36b2f3382838dfe0a0c1a5add3d5df7fe5",
      "upstream commit",
    ],
    [
      lock.upstream?.sourceArchiveSha256,
      "b7c6df0b8b692397c8a19e84f94b85ce0a2d961b36fc1d5ff78088db88819f59",
      "upstream archive digest",
    ],
    [lock.upstream?.declaredLicense, "AGPL-3.0-only", "declared license"],
    [
      lock.upstream?.licenseSha256,
      "9b4649365c4f29d8f41301f4cda1e5bd9da51cf1bbb19ab9d568ff57d56e3b33",
      "license digest",
    ],
    [
      lock.historicalPatchEvidence?.admittedToThisProfile,
      false,
      "historical patch admission",
    ],
    [
      lock.historicalPatchEvidence?.sha256?.runtimePolicy,
      "eb110989c841107d1c55ba50ef4ae3e3710bb27b27fde3dc8881f34b7e3dabdd",
      "historical runtime patch digest",
    ],
    [
      lock.historicalPatchEvidence?.sha256?.digestBuildInputs,
      "70e4fa4f5448cfa76011e84089ba63c02a0fe04f4060533b30a6afeb13f14ab8",
      "historical build-input patch digest",
    ],
    [
      lock.historicalPatchEvidence?.sha256?.securityHardening,
      "079b5ab71d0f3a7a7d7afca0a2deb3008f7c7e77baf00ac597a40a804a603fac",
      "historical hardening patch digest",
    ],
    [
      lock.historicalPatchEvidence?.sha256?.cargoLock,
      "dd723e1829fb911aa8c3ccc4e1d06690ffd91a5fbc8d67cfa3b0a63e377ab2ef",
      "historical Cargo lock digest",
    ],
    [lock.releaseAdmissionOwner, "PR-12", "release admission owner"],
  ]
  for (const [actual, expected, label] of exact) {
    if (actual !== expected) fail(errors, `source lock has unexpected ${label}`)
  }

  const omitted = new Set(lock.reducedRuntime?.omitted ?? [])
  for (const component of [
    "PostgreSQL",
    "NuQ",
    "RabbitMQ",
    "reranker",
    "asynchronous jobs",
    "persistent cache",
    "BFF coordination Redis",
  ]) {
    if (!omitted.has(component))
      fail(errors, `source lock must omit ${component}`)
  }
  return errors
}

export function validateSanitizedSources(sources) {
  const errors = []
  const forbidden = [
    [/\b\x68\x65\x72\x6d\x65\x73\b/i, "retired integration name"],
    [/\b\x61\x67\x65\x6e\x74\x69\x63\b/i, "retired runtime name"],
    [/\b\x6c\x69\x62\x72\x65\x63\x68\x61\x74\b/i, "retired product name"],
    [/\x2e\x6c\x61\x62\b/i, "lab hostname"],
    [/\b\x31\x30\x2e\x33\x33\x2e\x37\x34\x2e[0-9]{1,3}\b/, "lab address"],
    [
      /\b\x31\x37\x32\x2e\x32\x39\x2e[0-9]{1,3}\.[0-9]{1,3}\b/,
      "checkpoint subnet",
    ],
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "private key"],
    [/\bAKIA[0-9A-Z]{16}\b/, "AWS access key"],
    [/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/, "GitHub credential"],
    [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/, "GitHub credential"],
  ]
  for (const [name, source] of Object.entries(sources)) {
    for (const [pattern, label] of forbidden) {
      if (pattern.test(source)) fail(errors, `${name} contains ${label}`)
    }
  }
  return errors
}

function isIpv4(value) {
  const pieces = value.split(".")
  return (
    pieces.length === 4 &&
    pieces.every((piece) => /^\d{1,3}$/.test(piece) && Number(piece) <= 255)
  )
}

function isValidHostname(value) {
  if (value.length > 253 || !value.includes(".")) return false
  return value
    .split(".")
    .every(
      (label) =>
        label.length > 0 &&
        label.length <= 63 &&
        /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
    )
}

function isValidRegistryAuthority(value) {
  if (typeof value !== "string") return false
  const match = value.match(/^([^:]+)(?::([1-9][0-9]{0,4}))?$/)
  if (!match || isIpv4(match[1]) || !isValidHostname(match[1])) return false
  return !match[2] || Number(match[2]) <= 65535
}

export function validateAllowlist(source, { requireHosts = false } = {}) {
  const errors = []
  const hosts = []
  const seen = new Set()

  for (const [zeroIndex, raw] of source.split(/\r?\n/).entries()) {
    const lineNumber = zeroIndex + 1
    const value = raw.trim()
    if (!value || value.startsWith("#")) continue
    if (value !== raw || value.includes("#")) {
      fail(
        errors,
        `allowlist line ${lineNumber} must contain only one hostname`,
      )
      continue
    }
    if (
      value.includes("://") ||
      value.includes("/") ||
      value.includes(":") ||
      value.includes("*") ||
      value.startsWith(".") ||
      value.endsWith(".") ||
      value !== value.toLowerCase() ||
      isIpv4(value) ||
      !isValidHostname(value)
    ) {
      fail(errors, `allowlist line ${lineNumber} is not an exact hostname`)
      continue
    }
    if (value === "api.firecrawl.dev") {
      fail(
        errors,
        `allowlist line ${lineNumber} names the blocked hosted service`,
      )
      continue
    }
    const reserved = reservedSuffixes.some(
      (suffix) => value === suffix.slice(1) || value.endsWith(suffix),
    )
    if (reserved && value !== "deny-all.invalid") {
      fail(
        errors,
        `allowlist line ${lineNumber} uses a reserved private suffix`,
      )
      continue
    }
    if (seen.has(value)) {
      fail(errors, `allowlist line ${lineNumber} duplicates ${value}`)
      continue
    }
    seen.add(value)
    hosts.push(value)
  }

  const admittedHosts = hosts.filter((host) => host !== "deny-all.invalid")
  if (admittedHosts.length > maxAllowedHosts) {
    fail(errors, `allowlist must not exceed ${maxAllowedHosts} exact hostnames`)
  }
  if (requireHosts && admittedHosts.length === 0) {
    fail(
      errors,
      "enabled allowlist must contain at least one admitted hostname",
    )
  }
  if (hosts.includes("deny-all.invalid") && admittedHosts.length > 0) {
    fail(errors, "deny-all sentinel must not be mixed with admitted hostnames")
  }
  return errors
}

function parseEnv(source) {
  const values = new Map()
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith("#")) continue
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/)
    if (match) values.set(match[1], match[2].replace(/^['"]|['"]$/g, ""))
  }
  return values
}

export function validateImageEnvironment(source, { registryHost } = {}) {
  const errors = []
  const values = parseEnv(source)
  if (!isValidRegistryAuthority(registryHost)) {
    fail(
      errors,
      "registry host must be an exact DNS hostname with at most one numeric port and without scheme, path, or credentials",
    )
  }
  const exactImage =
    /^([a-z0-9.-]+(?::[1-9][0-9]{0,4})?)\/([a-z0-9][a-z0-9._/-]*)@sha256:[a-f0-9]{64}$/

  for (const [key, expectedRepository] of requiredImageRepositories) {
    const value = values.get(key)
    if (!value) {
      fail(errors, `${key} is missing`)
      continue
    }
    const match = value.match(exactImage)
    if (!match) {
      fail(errors, `${key} must be an exact registry image digest`)
      continue
    }
    if (match[1] !== registryHost || match[2] !== expectedRepository) {
      fail(
        errors,
        `${key} must use ${registryHost}/${expectedRepository} with an exact digest`,
      )
    }
  }

  const allowlistDirectory = values.get("FIRECRAWL_EGRESS_ALLOWLIST_DIR")
  if (
    allowlistDirectory &&
    !/^\/run\/llm-machines\/firecrawl\/[a-z0-9][a-z0-9-]*$/.test(
      allowlistDirectory,
    )
  ) {
    fail(
      errors,
      "FIRECRAWL_EGRESS_ALLOWLIST_DIR must be a volatile Firecrawl runtime directory",
    )
  }
  return errors
}

function read(relativePath) {
  return readFileSync(path.join(profileRoot, relativePath), "utf8")
}

export function validateProfile() {
  const sources = {
    "README.md": read("README.md"),
    "THIRD_PARTY_NOTICES.md": read("THIRD_PARTY_NOTICES.md"),
    "compose.yaml": read("compose.yaml"),
    "egress/squid.conf": read("egress/squid.conf"),
    "egress/allowlists/default/allowed-hosts.txt": read(
      "egress/allowlists/default/allowed-hosts.txt",
    ),
    "searxng/settings.yml": read("searxng/settings.yml"),
    "provenance/source-lock.json": read("provenance/source-lock.json"),
  }
  return [
    ...validateCompose(sources["compose.yaml"]),
    ...validateSquid(sources["egress/squid.conf"]),
    ...validateAllowlist(
      sources["egress/allowlists/default/allowed-hosts.txt"],
    ),
    ...validateSearx(sources["searxng/settings.yml"]),
    ...validateSourceLock(sources["provenance/source-lock.json"]),
    ...validateSanitizedSources(sources),
  ]
}

function parseArguments(argv) {
  const options = {
    allowlist: null,
    requireHosts: false,
    env: null,
    registryHost: null,
  }
  for (let index = 0; index < argv.length; index++) {
    const value = argv[index]
    if (value === "--require-hosts") options.requireHosts = true
    else if (value === "--allowlist") options.allowlist = argv[++index]
    else if (value === "--env") options.env = argv[++index]
    else if (value === "--registry") options.registryHost = argv[++index]
    else throw new Error(`unknown argument: ${value}`)
  }
  if (options.requireHosts && !options.allowlist) {
    throw new Error("--require-hosts requires --allowlist PATH")
  }
  if (options.env && !options.registryHost) {
    throw new Error("--env requires --registry HOST")
  }
  if (options.registryHost && !options.env) {
    throw new Error("--registry requires --env PATH")
  }
  return options
}

function main() {
  let options
  try {
    options = parseArguments(process.argv.slice(2))
  } catch (error) {
    console.error(error.message)
    process.exitCode = 2
    return
  }

  const errors = validateProfile()
  if (options.allowlist) {
    errors.push(
      ...validateAllowlist(readFileSync(options.allowlist, "utf8"), {
        requireHosts: options.requireHosts,
      }),
    )
  }
  if (options.env) {
    errors.push(
      ...validateImageEnvironment(readFileSync(options.env, "utf8"), {
        registryHost: options.registryHost,
      }),
    )
  }

  if (errors.length > 0) {
    for (const error of errors) console.error(`ERROR: ${error}`)
    process.exitCode = 1
    return
  }
  console.log("Firecrawl source profile policy: PASS")
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main()
}
