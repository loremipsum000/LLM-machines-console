#!/usr/bin/env node

import {
  chmod,
  chown,
  copyFile,
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

const secretMappings = {
  BFF_SERVICE_API_KEY: "bff-service-api-key",
  CONSOLE_OIDC_CLIENT_SECRET: "console-oidc-client-secret",
  DATABASE_URL: "database-url",
  KEYCLOAK_ADMIN_CLIENT_SECRET: "keycloak-admin-client-secret",
}

const keycloakControlSecretMappings = {
  applicationAdmin: "keycloak-application-admin-client-secret",
}

const nonSecretNames = [
  "ADMIN_ALERTMANAGER_BASE_URL",
  "ADMIN_ALERTMANAGER_TIMEOUT_MS",
  "ADMIN_GRAFANA_BASE_URL",
  "ADMIN_GRAFANA_TIMEOUT_MS",
  "ADMIN_LITELLM_BASE_URL",
  "ADMIN_LITELLM_TIMEOUT_MS",
  "ADMIN_PROMETHEUS_BASE_URL",
  "ADMIN_PROMETHEUS_TIMEOUT_MS",
  "FIRECRAWL_APPLIANCE_KILL_SWITCH",
  "FIRECRAWL_EGRESS_ALLOWED_HOSTS",
  "FIRECRAWL_EGRESS_ALLOWLIST_DIR",
  "FIRECRAWL_EGRESS_POLICY_READY",
  "FIRECRAWL_INSTALLED",
  "FIRECRAWL_PUBLIC_BASE_URL",
  "FIRECRAWL_RESOURCE_PROFILE_QUALIFIED",
  "FIRECRAWL_UPSTREAM_BASE_URL",
  "KEYCLOAK_ADMIN_BASE_URL",
  "KEYCLOAK_ADMIN_CLIENT_ID",
  "KEYCLOAK_ADMIN_REALM",
  "KEYCLOAK_APPLICATION_ADMIN_CLIENT_ID",
  "KEYCLOAK_APPLICATION_ADMIN_REALM",
  "PRE_GENESIS_FIRECRAWL_ACTUAL",
  "PRE_GENESIS_FIRECRAWL_ALLOWED_HOSTS",
  "PRE_GENESIS_FIRECRAWL_UPSTREAM_BASE_URL",
  "TEAM_ALLOWED_EMAIL_DOMAINS",
]

export function parseRuntimeSecretMaterial(buffer) {
  const environment = Object.fromEntries(
    buffer
      .toString("utf8")
      .split("\0")
      .filter(Boolean)
      .map((entry) => {
        const separator = entry.indexOf("=")
        return [entry.slice(0, separator), entry.slice(separator + 1)]
      }),
  )
  const secrets = {}
  for (const [name, file] of Object.entries(secretMappings)) {
    const value = environment[name]?.trim()
    if (!value)
      throw new Error(`The founder custody source is missing ${name}.`)
    secrets[file] = value
  }
  const sessionKeyring = environment.CONSOLE_SESSION_KEYRING_FILE?.trim()
  const edgeCa = environment.NODE_EXTRA_CA_CERTS?.trim()
  if (!sessionKeyring?.startsWith("/") || !edgeCa?.startsWith("/")) {
    throw new Error("The founder custody source is missing exact file paths.")
  }
  const nonSecrets = Object.fromEntries(
    nonSecretNames
      .filter((name) => environment[name]?.trim())
      .map((name) => {
        const value = environment[name].trim()
        if (
          value.length > 2048 ||
          /[\r\n\0]/.test(value) ||
          /^https?:\/\/[^/@:]+:[^/@]+@/.test(value)
        ) {
          throw new Error(`The founder custody source has unsafe ${name}.`)
        }
        return [name, value]
      }),
  )
  return { edgeCa, nonSecrets, secrets, sessionKeyring }
}

export function parseLiteLlmSecretMaterial(buffer) {
  const environment = Object.fromEntries(
    buffer
      .toString("utf8")
      .split("\0")
      .filter(Boolean)
      .map((entry) => {
        const separator = entry.indexOf("=")
        return [entry.slice(0, separator), entry.slice(separator + 1)]
      }),
  )
  const masterKey = environment.LITELLM_MASTER_KEY?.trim()
  if (!masterKey) {
    throw new Error(
      "The founder LiteLLM custody source is missing LITELLM_MASTER_KEY.",
    )
  }
  return { "litellm-key": masterKey }
}

export function parseKeycloakControlSecretMaterial(buffer) {
  let control
  try {
    control = JSON.parse(buffer.toString("utf8"))
  } catch {
    throw new Error("The founder Keycloak control file is invalid.")
  }
  const secrets = {}
  for (const [name, file] of Object.entries(keycloakControlSecretMappings)) {
    const value = control?.credentials?.[name]?.trim()
    if (!value) {
      throw new Error(
        `The founder Keycloak control file is missing credentials.${name}.`,
      )
    }
    secrets[file] = value
  }
  return secrets
}

export function processNamespacePath(pid, path) {
  if (!Number.isSafeInteger(pid) || pid < 1 || !path.startsWith("/")) {
    throw new Error("The founder custody process path is invalid.")
  }
  return `/proc/${pid}/root${path}`
}

export async function captureVm103FounderCustody(options) {
  if (process.getuid?.() !== 0)
    throw new Error("Founder custody capture requires root.")
  const source = parseRuntimeSecretMaterial(
    await readFile(`/proc/${options.sourcePid}/environ`),
  )
  const liteLlmSecrets = parseLiteLlmSecretMaterial(
    await readFile(`/proc/${options.liteLlmSourcePid}/environ`),
  )
  const keycloakSecrets = parseKeycloakControlSecretMaterial(
    await readFile(options.keycloakControlFile),
  )
  await mkdir(options.configurationRoot, { mode: 0o700, recursive: true })
  await mkdir(options.secretRoot, { mode: 0o700, recursive: true })
  await chmod(options.configurationRoot, 0o700)
  await chmod(options.secretRoot, 0o700)
  for (const [name, value] of Object.entries({
    ...source.secrets,
    ...liteLlmSecrets,
    ...keycloakSecrets,
  })) {
    const target = resolve(options.secretRoot, name)
    await writeFile(target, `${value}\n`, { flag: "wx", mode: 0o600 })
    await chmod(target, 0o600)
  }
  await writeFile(
    resolve(options.configurationRoot, "runtime-import.env"),
    `${Object.entries(source.nonSecrets)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, value]) => `${name}=${value}`)
      .join("\n")}\n`,
    { flag: "wx", mode: 0o600 },
  )
  await copyRestricted(
    processNamespacePath(options.sourcePid, source.sessionKeyring),
    resolve(options.configurationRoot, "session-keyring.json"),
  )
  await copyRestricted(
    processNamespacePath(options.sourcePid, source.edgeCa),
    resolve(options.configurationRoot, "edge-ca.crt"),
  )
  await copyRestricted(
    options.edgeCertificate,
    resolve(options.configurationRoot, "edge.crt"),
  )
  await copyRestricted(
    options.edgePrivateKey,
    resolve(options.configurationRoot, "edge.key"),
  )
  return {
    credentialValuesPrinted: false,
    generatedFiles: [
      ...Object.values(secretMappings),
      ...Object.keys(liteLlmSecrets),
      ...Object.keys(keycloakSecrets),
      "edge-ca.crt",
      "edge.crt",
      "edge.key",
      "session-keyring.json",
      "runtime-import.env",
    ].sort(),
  }
}

async function copyRestricted(source, target) {
  await copyFile(source, target, 0)
  await chown(target, 0, 0)
  await chmod(target, 0o600)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [
    sourcePid,
    liteLlmSourcePid,
    keycloakControlFile,
    configurationRoot,
    secretRoot,
    edgeCertificate,
    edgePrivateKey,
  ] = process.argv.slice(2)
  if (
    !/^\d+$/.test(sourcePid ?? "") ||
    !/^\d+$/.test(liteLlmSourcePid ?? "") ||
    !keycloakControlFile ||
    !configurationRoot ||
    !secretRoot ||
    !edgeCertificate ||
    !edgePrivateKey
  ) {
    throw new Error(
      "Usage: capture-vm103-founder-custody.mjs BFF_PID LITELLM_PID KEYCLOAK_CONTROL_FILE CONFIG_ROOT SECRET_ROOT EDGE_CERT EDGE_KEY",
    )
  }
  const result = await captureVm103FounderCustody({
    sourcePid: Number(sourcePid),
    liteLlmSourcePid: Number(liteLlmSourcePid),
    keycloakControlFile: resolve(keycloakControlFile),
    configurationRoot: resolve(configurationRoot),
    secretRoot: resolve(secretRoot),
    edgeCertificate: resolve(edgeCertificate),
    edgePrivateKey: resolve(edgePrivateKey),
  })
  process.stdout.write(`${JSON.stringify(result)}\n`)
}
