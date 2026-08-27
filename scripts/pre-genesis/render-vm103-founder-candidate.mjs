#!/usr/bin/env node

import { createHash } from "node:crypto"
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)))

export async function renderVm103FounderCandidate(placement, outputRoot) {
  validatePlacement(placement)
  await mkdir(outputRoot, { mode: 0o700, recursive: true })
  const template = await readFile(
    resolve(repositoryRoot, "infra/ingress/product-edge.nginx.conf.template"),
    "utf8",
  )
  const edge = renderEdge(template, placement)
  const artifacts = {
    "bff.env": renderBffEnvironment(placement),
    "gateway-inference-route.service": renderGatewayUnit(placement),
    "inference-firewall.nft": renderInferenceFirewall(placement),
    "inference-private-route.service": renderInferenceUnit(placement),
    "image-bindings.json": `${JSON.stringify(
      {
        images: { bff: placement.images.bff, web: placement.images.web },
        schema: "llm-machines.vm103-founder-images.v1",
        source: placement.source,
      },
      null,
      2,
    )}\n`,
    "product-edge.nginx.conf": edge,
    "llmm-founder-candidate.service": renderVm103Unit(placement),
    "llmm-founder-edge-firewall.service": renderVm103FirewallUnit(placement),
    "web.env": renderWebEnvironment(placement),
  }
  const inventory = []
  for (const [name, content] of Object.entries(artifacts)) {
    const target = resolve(outputRoot, name)
    await writeFile(target, content, { mode: 0o600 })
    await chmod(target, 0o600)
    inventory.push({ name, sha256: sha256(content) })
  }
  const manifest = {
    schema: "llm-machines.vm103-founder-candidate.v1",
    source: placement.source,
    internalTestOnly: true,
    productionAcceptance: false,
    runtimeQualification: false,
    portainerAdmitted: false,
    artifacts: inventory.sort((left, right) =>
      left.name.localeCompare(right.name),
    ),
  }
  await writeFile(
    resolve(outputRoot, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { mode: 0o600 },
  )
  return manifest
}

function validatePlacement(value) {
  exactKeys(value, [
    "authorities",
    "images",
    "network",
    "paths",
    "ports",
    "source",
  ])
  exactKeys(value.source, ["commit", "tree"])
  if (!gitId(value.source.commit) || !gitId(value.source.tree))
    fail("source identity")
  exactKeys(value.authorities, [
    "api",
    "console",
    "firecrawl",
    "grafana",
    "identity",
    "keycloak",
    "litellm",
  ])
  if (Object.values(value.authorities).some((host) => !hostname(host)))
    fail("authority")
  if (new Set(Object.values(value.authorities)).size !== 7)
    fail("authority uniqueness")
  exactKeys(value.images, ["bff", "edge", "web"])
  if (
    !localImageId(value.images.bff) ||
    !exactImage(value.images.edge) ||
    !localImageId(value.images.web)
  )
    fail("image")
  exactKeys(value.network, [
    "edgeGateway",
    "gateway",
    "inference",
    "prometheus",
    "vm103",
  ])
  if (Object.values(value.network).some((address) => !privateIpv4(address)))
    fail("network")
  exactKeys(value.ports, [
    "bff",
    "edge",
    "grafana",
    "keycloak",
    "litellm",
    "prometheus",
    "sglang",
    "web",
  ])
  const ports = Object.values(value.ports)
  if (
    ports.some((port) => !Number.isInteger(port) || port < 1024 || port > 65535)
  )
    fail("port")
  if (new Set(ports).size !== ports.length) fail("port collision")
  if (
    value.ports.bff !== 44294 ||
    value.ports.edge !== 22443 ||
    value.ports.prometheus !== 19090 ||
    value.ports.web !== 34954
  )
    fail("founder candidate port contract")
  exactKeys(value.paths, [
    "admission",
    "compose",
    "configuration",
    "secret",
    "source",
  ])
  for (const path of Object.values(value.paths)) {
    if (!path.startsWith("/") || path.includes("..") || path.includes("\n"))
      fail("path")
  }
}

function renderEdge(template, placement) {
  const tokens = {
    "@@PRODUCT_API_HOST@@": placement.authorities.api,
    "@@PRODUCT_CONSOLE_HOST@@": placement.authorities.console,
    "@@PRODUCT_FIRECRAWL_HOST@@": placement.authorities.firecrawl,
    "@@PRODUCT_GRAFANA_HOST@@": placement.authorities.grafana,
    "@@PRODUCT_IDENTITY_HOST@@": placement.authorities.identity,
    "@@PRODUCT_KEYCLOAK_ADMIN_HOST@@": placement.authorities.keycloak,
    "@@PRODUCT_LITELLM_HOST@@": placement.authorities.litellm,
  }
  let rendered = template
  for (const [token, value] of Object.entries(tokens))
    rendered = rendered.replaceAll(token, value)
  const upstreams = [
    ["console-web:3000", `127.0.0.1:${placement.ports.web}`],
    ["console-bff:4001", `127.0.0.1:${placement.ports.bff}`],
    ["keycloak:8080", `127.0.0.1:${placement.ports.keycloak}`],
    ["grafana:3000", `127.0.0.1:${placement.ports.grafana}`],
    ["litellm:4000", `127.0.0.1:${placement.ports.litellm}`],
  ]
  for (const [from, to] of upstreams)
    rendered = rendered.replace(`server ${from};`, `server ${to};`)
  rendered = rendered.replaceAll(
    "listen 443 ssl",
    `listen ${placement.ports.edge} ssl`,
  )
  if (
    rendered.includes("@@") ||
    upstreams.some(([from]) => rendered.includes(`server ${from};`))
  ) {
    fail("edge rendering")
  }
  return rendered
}

function renderWebEnvironment(p) {
  return lines({
    CONSOLE_BFF_URL: `http://127.0.0.1:${p.ports.bff}`,
    NEXT_TELEMETRY_DISABLED: "1",
    NODE_ENV: "production",
    PRODUCT_GRAFANA_HOST: p.authorities.grafana,
    PRODUCT_KEYCLOAK_ADMIN_HOST: p.authorities.keycloak,
    PRODUCT_LITELLM_HOST: p.authorities.litellm,
    WEB_CONSOLE_ORIGIN: `https://${p.authorities.console}`,
    WEB_IDENTITY_ORIGIN: `https://${p.authorities.identity}`,
  })
}

function renderBffEnvironment(p) {
  return lines({
    ADMIN_LITELLM_BASE_URL: `http://127.0.0.1:${p.ports.litellm}`,
    ADMIN_PROMETHEUS_BASE_URL: `http://${p.network.prometheus}:${p.ports.prometheus}`,
    CONSOLE_OIDC_CLIENT_ID: "console-web",
    CONSOLE_ORIGIN: `https://${p.authorities.console}`,
    CONSOLE_SESSION_KEYRING_FILE: "/run/llm-machines/session-keyring.json",
    CONNECTED_APPS_BFF_BASE_URL: `https://${p.authorities.api}`,
    HOST: "127.0.0.1",
    INFERENCE_ALLOW_INTERNAL_TEST_PROFILES: "true",
    INFERENCE_MODEL_ADMISSION_DIR: "/run/llm-machines/inference-admission",
    KEYCLOAK_APPLICATION_ISSUER_URL: `https://${p.authorities.identity}/realms/llm-machines-applications`,
    KEYCLOAK_APPLICATION_ADMIN_CLIENT_ID: "console-application-admin",
    KEYCLOAK_APPLICATION_ADMIN_REALM: "llm-machines-applications",
    KEYCLOAK_ADMIN_BASE_URL: `http://127.0.0.1:${p.ports.keycloak}`,
    KEYCLOAK_AUDIENCE: "console-bff",
    KEYCLOAK_ISSUER_URL: `https://${p.authorities.identity}/realms/llm-machines`,
    LITELLM_URL: `http://127.0.0.1:${p.ports.litellm}`,
    NODE_ENV: "production",
    NODE_EXTRA_CA_CERTS: "/run/llm-machines/edge-ca.crt",
    PORT: String(p.ports.bff),
    PRODUCT_API_HOST: p.authorities.api,
    PRODUCT_CONSOLE_HOST: p.authorities.console,
    PRODUCT_FIRECRAWL_HOST: p.authorities.firecrawl,
    PRODUCT_GRAFANA_HOST: p.authorities.grafana,
    PRODUCT_IDENTITY_HOST: p.authorities.identity,
    PRODUCT_KEYCLOAK_ADMIN_HOST: p.authorities.keycloak,
    PRODUCT_LITELLM_HOST: p.authorities.litellm,
    PUBLIC_BFF_BASE_URL: `https://${p.authorities.api}`,
  })
}

function renderVm103Unit(p) {
  return `[Unit]\nDescription=LLM Machines pre-Genesis founder candidate\nAfter=docker.service llmm-founder-edge-firewall.service network-online.target\nRequires=docker.service llmm-founder-edge-firewall.service\n\n[Service]\nType=oneshot\nRemainAfterExit=yes\nExecStartPre=/opt/node-v22.23.2/bin/node ${p.paths.source}/scripts/pre-genesis/verify-vm103-founder-images.mjs ${p.paths.configuration}/image-bindings.json\nExecStartPre=/opt/node-v22.23.2/bin/node ${p.paths.source}/scripts/pre-genesis/verify-vm103-application-identity.mjs http://127.0.0.1:${p.ports.keycloak} https://${p.authorities.identity}/realms/llm-machines-applications llm-machines-applications console-application-admin ${p.paths.secret}/keycloak-application-admin-client-secret\nExecStart=/usr/bin/docker compose --project-name llmm-founder-candidate --env-file ${p.paths.configuration}/placement.env --file ${p.paths.compose} up --detach --wait\nExecReload=/usr/bin/docker compose --project-name llmm-founder-candidate --env-file ${p.paths.configuration}/placement.env --file ${p.paths.compose} restart\nExecStop=/usr/bin/docker compose --project-name llmm-founder-candidate --env-file ${p.paths.configuration}/placement.env --file ${p.paths.compose} stop\nTimeoutStartSec=900\nTimeoutStopSec=180\n\n[Install]\nWantedBy=multi-user.target\n`
}

function renderVm103FirewallUnit(p) {
  const command = `/opt/node-v22.23.2/bin/node ${p.paths.source}/scripts/pre-genesis/manage-vm103-founder-firewall.mjs`
  return `[Unit]\nDescription=Allow only the system gateway to the founder candidate edge\nAfter=network-online.target nftables.service\nRequires=nftables.service\n\n[Service]\nType=oneshot\nRemainAfterExit=yes\nExecStart=${command} apply ${p.network.edgeGateway} ${p.ports.edge}\nExecStop=${command} remove ${p.network.edgeGateway} ${p.ports.edge}\n\n[Install]\nWantedBy=multi-user.target\n`
}

function renderGatewayUnit(p) {
  const rule = `-s ${p.network.vm103}/32 -d ${p.network.inference}/32 -m comment --comment llmm-vm103-sglang -j ACCEPT`
  return `[Unit]\nDescription=Preserve VM103 source identity for private SGLang\nAfter=network-online.target\n\n[Service]\nType=oneshot\nRemainAfterExit=yes\nExecStart=/bin/sh -ec '/usr/sbin/iptables -t nat -C POSTROUTING ${rule} || /usr/sbin/iptables -t nat -I POSTROUTING 1 ${rule}'\nExecStop=/bin/sh -ec '/usr/sbin/iptables -t nat -C POSTROUTING ${rule} && /usr/sbin/iptables -t nat -D POSTROUTING ${rule} || true'\n\n[Install]\nWantedBy=multi-user.target\n`
}

function renderInferenceFirewall(p) {
  return `table inet llmm_sglang {\n  chain input {\n    type filter hook input priority -5; policy accept;\n    iifname "lo" tcp dport ${p.ports.sglang} accept\n    ip saddr ${p.network.vm103} tcp dport ${p.ports.sglang} accept\n    tcp dport ${p.ports.sglang} drop\n  }\n}\n`
}

function renderInferenceUnit(p) {
  return `[Unit]\nDescription=Source-restricted VM103 to SGLang route\nBefore=docker.service\nAfter=network-online.target\n\n[Service]\nType=oneshot\nRemainAfterExit=yes\nExecStart=/usr/sbin/ip route replace ${p.network.vm103}/32 via ${p.network.gateway} dev eno1\nExecStart=/bin/sh -ec '/usr/sbin/nft list table inet llmm_sglang >/dev/null 2>&1 && exit 1 || /usr/sbin/nft -f /etc/llm-machines/inference-firewall.nft'\nExecStop=/usr/sbin/nft delete table inet llmm_sglang\nExecStop=/usr/sbin/ip route del ${p.network.vm103}/32 via ${p.network.gateway} dev eno1\n\n[Install]\nWantedBy=multi-user.target\n`
}

function lines(values) {
  return `${Object.entries(values)
    .map(([name, value]) => `${name}=${value}`)
    .join("\n")}\n`
}

function exactKeys(value, expected) {
  if (
    !value ||
    Array.isArray(value) ||
    JSON.stringify(Object.keys(value).sort()) !==
      JSON.stringify([...expected].sort())
  )
    fail("shape")
}
function gitId(value) {
  return typeof value === "string" && /^[0-9a-f]{40}$/.test(value)
}
function hostname(value) {
  return (
    typeof value === "string" &&
    value === value.toLowerCase() &&
    value
      .split(".")
      .every((part) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(part))
  )
}
function exactImage(value) {
  return (
    typeof value === "string" &&
    /^[a-z0-9][a-z0-9./_-]*@sha256:[0-9a-f]{64}$/.test(value)
  )
}
function localImageId(value) {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value)
}
function privateIpv4(value) {
  if (typeof value !== "string") return false
  const parts = value.split(".")
  if (
    parts.length !== 4 ||
    parts.some(
      (part) =>
        !/^\d{1,3}$/.test(part) ||
        String(Number(part)) !== part ||
        Number(part) > 255,
    )
  ) {
    return false
  }
  const [first, second] = parts.map(Number)
  return (
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  )
}
function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`
}
function fail(name) {
  throw new Error(`VM103 founder placement has invalid ${name}.`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 4)
    throw new Error(
      "Usage: render-vm103-founder-candidate.mjs PLACEMENT OUTPUT",
    )
  const placement = JSON.parse(await readFile(resolve(process.argv[2]), "utf8"))
  const manifest = await renderVm103FounderCandidate(
    placement,
    resolve(process.argv[3]),
  )
  process.stdout.write(`${JSON.stringify(manifest)}\n`)
}
