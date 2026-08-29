#!/usr/bin/env node

import { createHash } from "node:crypto"
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { renderInferenceFirewallContract } from "./manage-vm103-inference-route.mjs"
import {
  isSafeSglangWorkloadUnit,
  renderVm103LiteLlmRoute,
  vm103CoreCompatibilityFingerprint,
} from "./render-vm103-litellm-route.mjs"

const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)))

export async function renderVm103FounderCandidate(
  placement,
  outputRoot,
  inferenceDocuments,
) {
  validatePlacement(placement)
  if (
    !inferenceDocuments ||
    !inferenceDocuments.sourceProfile ||
    !inferenceDocuments.renderedProfile ||
    !(inferenceDocuments.now instanceof Date) ||
    !Number.isFinite(inferenceDocuments.now.getTime())
  ) {
    fail("inference documents")
  }
  await mkdir(outputRoot, { mode: 0o700, recursive: true })
  const template = await readFile(
    resolve(repositoryRoot, "infra/ingress/product-edge.nginx.conf.template"),
    "utf8",
  )
  const inferenceRouteManager = await readFile(
    resolve(
      repositoryRoot,
      "scripts/pre-genesis/manage-vm103-inference-route.mjs",
    ),
    "utf8",
  )
  const gatewayRouteManager = await readFile(
    resolve(
      repositoryRoot,
      "scripts/pre-genesis/manage-vm103-gateway-route.mjs",
    ),
    "utf8",
  )
  const gatewayRouteManagerDigest = sha256(gatewayRouteManager)
  const inferenceRouteManagerDigest = sha256(inferenceRouteManager)
  const edge = renderEdge(template, placement)
  const renderedConfiguration = {
    "bff.env": renderBffEnvironment(placement),
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
    "placement.env": renderPlacementEnvironment(placement),
    "web.env": renderWebEnvironment(placement),
  }
  const renderedConfigurationManifest = `${JSON.stringify(
    {
      artifacts: Object.entries(renderedConfiguration)
        .map(([name, content]) => ({ name, sha256: sha256(content) }))
        .sort((left, right) => left.name.localeCompare(right.name)),
      schema: "llm-machines.vm103-founder-rendered-config.v1",
      source: placement.source,
    },
    null,
    2,
  )}\n`
  const renderedConfigurationManifestDigest = sha256(
    renderedConfigurationManifest,
  )
  const liteLlmRoute = renderVm103LiteLlmRoute(
    inferenceDocuments.sourceProfile,
    inferenceDocuments.renderedProfile,
    renderedConfiguration["placement.env"],
    renderedConfigurationManifest,
    renderedConfigurationManifestDigest,
    `http://${placement.network.inference}:${placement.ports.sglang}/v1`,
    inferenceDocuments.now,
  )
  const liteLlmRouteReceipt = `${JSON.stringify(
    {
      apiBase: liteLlmRoute.apiBase,
      configDigest: liteLlmRoute.sha256,
      coreCompatibilityFingerprint: liteLlmRoute.coreCompatibilityFingerprint,
      engineImageDigest: liteLlmRoute.engineImageDigest,
      evidenceDigest: liteLlmRoute.evidenceDigest,
      modelAlias: liteLlmRoute.modelAlias,
      modelArtifactDigest: liteLlmRoute.modelArtifactDigest,
      modelManifestDigest: liteLlmRoute.modelManifestDigest,
      profileId: liteLlmRoute.profileId,
      profileRevision: liteLlmRoute.profileRevision,
      qualifiedProfileDigest: liteLlmRoute.qualifiedProfileDigest,
      renderedConfigurationManifestDigest:
        liteLlmRoute.renderedConfigurationManifestDigest,
      renderedPlacementDigest: liteLlmRoute.renderedPlacementDigest,
      renderedProfileDigest: liteLlmRoute.renderedProfileDigest,
      rollback: liteLlmRoute.rollback,
      runtimeBindingDigest: liteLlmRoute.runtimeBindingDigest,
      runtimeModelId: liteLlmRoute.runtimeModelId,
      schema: "llm-machines.vm103-litellm-route-receipt.v1",
    },
    null,
    2,
  )}\n`
  const runtimeBindingArtifacts = {
    "litellm-inference-route.yaml": liteLlmRoute.config,
    "litellm-route-receipt.json": liteLlmRouteReceipt,
  }
  const runtimeBindingManifest = `${JSON.stringify(
    {
      artifacts: Object.entries(runtimeBindingArtifacts)
        .map(([name, content]) => ({ name, sha256: sha256(content) }))
        .sort((left, right) => left.name.localeCompare(right.name)),
      renderedConfigurationManifestDigest,
      schema: "llm-machines.vm103-founder-runtime-bindings.v1",
      source: placement.source,
    },
    null,
    2,
  )}\n`
  const runtimeBindingManifestDigest = sha256(runtimeBindingManifest)
  const artifacts = {
    ...renderedConfiguration,
    "gateway-inference-route.service": renderGatewayUnit(
      placement,
      gatewayRouteManagerDigest,
    ),
    "inference-firewall.nft": renderInferenceFirewallContract(
      placement.network.vm103,
      placement.ports.sglang,
    ),
    "inference-private-route.service": renderInferenceUnit(
      placement,
      inferenceRouteManagerDigest,
    ),
    ...runtimeBindingArtifacts,
    "litellm-runtime-binding-manifest.json": runtimeBindingManifest,
    "manage-vm103-gateway-route.mjs": gatewayRouteManager,
    "manage-vm103-inference-route.mjs": inferenceRouteManager,
    "llmm-founder-candidate.service": renderVm103Unit(
      placement,
      renderedConfigurationManifestDigest,
      runtimeBindingManifestDigest,
    ),
    "llmm-founder-edge-firewall.service": renderVm103FirewallUnit(placement),
    "rendered-config-manifest.json": renderedConfigurationManifest,
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
    "inferenceProfile",
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
  exactKeys(value.inferenceProfile, [
    "coreCompatibilityFingerprint",
    "profileId",
    "qualifiedProfileDigest",
    "renderedProfileDigest",
    "revision",
    "workloadUnit",
  ])
  if (
    !digest(value.inferenceProfile.coreCompatibilityFingerprint) ||
    value.inferenceProfile.coreCompatibilityFingerprint !==
      vm103CoreCompatibilityFingerprint ||
    !/^[a-z0-9][a-z0-9.-]{2,62}$/.test(value.inferenceProfile.profileId) ||
    !digest(value.inferenceProfile.qualifiedProfileDigest) ||
    !digest(value.inferenceProfile.renderedProfileDigest) ||
    !Number.isSafeInteger(value.inferenceProfile.revision) ||
    value.inferenceProfile.revision < 1 ||
    !isSafeSglangWorkloadUnit(value.inferenceProfile.workloadUnit)
  ) {
    fail("inference profile binding")
  }
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
    "alertmanager",
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
    value.ports.alertmanager !== 19093 ||
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
  for (const path of Object.values(value.paths))
    if (!safeAbsolutePath(path)) fail("path")
  const paths = Object.values(value.paths)
  if (new Set(paths).size !== paths.length) fail("path collision")
  if (
    value.paths.compose !==
    resolve(
      value.paths.source,
      "infra/deployment/vm103-founder-candidate.compose.yaml",
    )
  ) {
    fail("Compose source binding")
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
    ADMIN_ALERTMANAGER_BASE_URL: `http://${p.network.prometheus}:${p.ports.alertmanager}`,
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

function renderPlacementEnvironment(p) {
  return lines({
    LLMM_BFF_IMAGE: p.images.bff,
    LLMM_CONFIGURATION_ROOT: p.paths.configuration,
    LLMM_EDGE_IMAGE: p.images.edge,
    LLMM_INFERENCE_CORE_COMPATIBILITY_FINGERPRINT:
      p.inferenceProfile.coreCompatibilityFingerprint,
    LLMM_INFERENCE_HOST: p.network.inference,
    LLMM_INFERENCE_MODEL_ADMISSION_DIR: p.paths.admission,
    LLMM_INFERENCE_PROFILE_FILE: `${p.inferenceProfile.profileId}.json`,
    LLMM_INFERENCE_PROFILE_ID: p.inferenceProfile.profileId,
    LLMM_INFERENCE_PROFILE_REVISION: String(p.inferenceProfile.revision),
    LLMM_INFERENCE_QUALIFIED_PROFILE_DIGEST:
      p.inferenceProfile.qualifiedProfileDigest,
    LLMM_INFERENCE_RENDERED_PROFILE_DIGEST:
      p.inferenceProfile.renderedProfileDigest,
    LLMM_INFERENCE_WORKLOAD_UNIT: p.inferenceProfile.workloadUnit,
    LLMM_SECRET_ROOT: p.paths.secret,
    LLMM_SOURCE_ROOT: p.paths.source,
    LLMM_WEB_IMAGE: p.images.web,
  })
}

function renderVm103Unit(
  p,
  renderedConfigurationManifestDigest,
  runtimeBindingManifestDigest,
) {
  const verifySource = renderExactBlobInvocation(
    p,
    "scripts/pre-genesis/verify-vm103-founder-source.mjs",
    [p.paths.source, p.source.commit, p.source.tree],
  )
  const verifyConfiguration = renderExactBlobInvocation(
    p,
    "scripts/pre-genesis/verify-vm103-founder-config.mjs",
    [
      p.paths.configuration,
      `${p.paths.configuration}/rendered-config-manifest.json`,
      renderedConfigurationManifestDigest,
      p.source.commit,
      p.source.tree,
    ],
  )
  const verifyRuntimeCustody = renderExactBlobInvocation(
    p,
    "scripts/pre-genesis/verify-vm103-founder-runtime-custody.mjs",
    [
      p.paths.configuration,
      p.paths.secret,
      p.paths.admission,
      p.paths.source,
      p.paths.compose,
      renderedConfigurationManifestDigest,
      runtimeBindingManifestDigest,
      p.source.commit,
      p.source.tree,
    ],
  )
  const verifyLiteLlmRoute = renderExactBlobInvocation(
    p,
    "scripts/pre-genesis/verify-vm103-litellm-route-runtime.mjs",
    [
      `http://127.0.0.1:${p.ports.litellm}`,
      `${p.paths.configuration}/litellm-route-receipt.json`,
      `${p.paths.secret}/litellm-key`,
    ],
  )
  const compose = `/usr/bin/env -i PATH=/usr/bin:/bin /usr/bin/docker compose --project-name llmm-founder-candidate --env-file ${p.paths.configuration}/placement.env --file ${p.paths.compose}`
  return `[Unit]\nDescription=LLM Machines pre-Genesis founder candidate\nAfter=docker.service llmm-founder-edge-firewall.service network-online.target\nRequires=docker.service llmm-founder-edge-firewall.service\n\n[Service]\nType=oneshot\nRemainAfterExit=yes\nExecStartPre=${verifySource}\nExecStartPre=${verifyConfiguration}\nExecStartPre=${verifyRuntimeCustody}\nExecStartPre=${verifyLiteLlmRoute}\nExecStartPre=/opt/node-v22.23.2/bin/node ${p.paths.source}/scripts/pre-genesis/verify-vm103-founder-images.mjs ${p.paths.configuration}/image-bindings.json\nExecStartPre=/opt/node-v22.23.2/bin/node ${p.paths.source}/scripts/pre-genesis/verify-vm103-application-identity.mjs http://127.0.0.1:${p.ports.keycloak} https://${p.authorities.identity}/realms/llm-machines-applications llm-machines-applications console-application-admin ${p.paths.secret}/keycloak-application-admin-client-secret\nExecStart=${compose} up --detach --wait\nExecStop=${compose} stop\nTimeoutStartSec=900\nTimeoutStopSec=180\n\n[Install]\nWantedBy=multi-user.target\n`
}

function renderExactBlobInvocation(p, script, arguments_) {
  return `/bin/bash -o pipefail -ec '/usr/bin/git --no-replace-objects -c safe.directory=${p.paths.source} -C ${p.paths.source} cat-file blob ${p.source.commit}:${script} | /opt/node-v22.23.2/bin/node --input-type=module - ${arguments_.join(" ")}'`
}

function renderVm103FirewallUnit(p) {
  const command = `/opt/node-v22.23.2/bin/node ${p.paths.source}/scripts/pre-genesis/manage-vm103-founder-firewall.mjs`
  return `[Unit]\nDescription=Allow only the system gateway to the founder candidate edge\nAfter=network-online.target nftables.service\nRequires=nftables.service\n\n[Service]\nType=oneshot\nRemainAfterExit=yes\nExecStart=${command} apply ${p.network.edgeGateway} ${p.ports.edge}\nExecStop=${command} remove ${p.network.edgeGateway} ${p.ports.edge}\n\n[Install]\nWantedBy=multi-user.target\n`
}

function renderGatewayUnit(p, managerDigest) {
  const command =
    "/opt/node-v22.23.2/bin/node /etc/llm-machines/manage-vm103-gateway-route.mjs"
  const arguments_ = `${managerDigest} ${p.network.vm103} ${p.network.inference} ${p.ports.sglang}`
  return `[Unit]\nDescription=Preserve VM103 source identity for private SGLang\nAfter=network-online.target\n\n[Service]\nType=oneshot\nRemainAfterExit=yes\nExecStart=${command} apply ${arguments_}\nExecStop=${command} remove ${arguments_}\n\n[Install]\nWantedBy=multi-user.target\n`
}

function renderInferenceUnit(p, managerDigest) {
  const command =
    "/opt/node-v22.23.2/bin/node /etc/llm-machines/manage-vm103-inference-route.mjs"
  const arguments_ = `${managerDigest} ${p.network.vm103} ${p.network.gateway} eno1 ${p.network.vm103} ${p.ports.sglang} /etc/llm-machines/inference-firewall.nft`
  const workloadUnit = p.inferenceProfile.workloadUnit
  return `[Unit]\nDescription=Source-restricted VM103 to SGLang route\nBefore=${workloadUnit}\nAfter=network-online.target\nWants=network-online.target\n\n[Service]\nType=oneshot\nRemainAfterExit=yes\nExecStart=${command} apply ${arguments_}\nExecStop=${command} remove ${arguments_}\n\n[Install]\nRequiredBy=${workloadUnit}\n`
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
function digest(value) {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value)
}
function safeAbsolutePath(value) {
  return (
    typeof value === "string" &&
    /^\/(?:[A-Za-z0-9._-]+\/?)+$/.test(value) &&
    !value.includes("..") &&
    resolve(value) === value
  )
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
  if (process.argv.length !== 6)
    throw new Error(
      "Usage: render-vm103-founder-candidate.mjs PLACEMENT SOURCE_PROFILE RENDERED_PROFILE OUTPUT",
    )
  const placement = JSON.parse(await readFile(resolve(process.argv[2]), "utf8"))
  const sourceProfile = JSON.parse(
    await readFile(resolve(process.argv[3]), "utf8"),
  )
  const renderedProfile = JSON.parse(
    await readFile(resolve(process.argv[4]), "utf8"),
  )
  const manifest = await renderVm103FounderCandidate(
    placement,
    resolve(process.argv[5]),
    { now: new Date(), renderedProfile, sourceProfile },
  )
  process.stdout.write(`${JSON.stringify(manifest)}\n`)
}
