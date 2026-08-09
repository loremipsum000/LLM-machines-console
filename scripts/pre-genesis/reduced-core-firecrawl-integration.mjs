import { spawn, spawnSync } from "node:child_process"
import { createHash, randomBytes } from "node:crypto"
import { createReadStream, createWriteStream } from "node:fs"
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises"
import { createServer } from "node:net"
import { isAbsolute, join, resolve } from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { fileURLToPath } from "node:url"

const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)))
const serviceControl = serviceControlFromEnvironment()
const sourcePackage = await readJson(
  resolve(repositoryRoot, "infra/firecrawl/release/source-package.json"),
)
const runId = randomBytes(8).toString("hex")
const project = `llmmf0f2${runId}`
const managedProfile = `llmm-f0-f2-${runId}`
const dockerContext = `colima-${managedProfile}`
const apiImage = `llmm-f0-f2/firecrawl-api:${runId}`
const browserImage = `llmm-f0-f2/firecrawl-browser:${runId}`
const bridgeContainer = `llmm-f0-f2-bridge-${runId}`
const bridgeNetwork = `${project}-bridge-access`
const packageById = new Map(
  sourcePackage.buildInputs.map((input) => [input.id, input]),
)
const searchImage = exactPlatformImage("searxng-runtime-source")
const egressImage = exactPlatformImage("squid-runtime-source")
const cacheRoot = resolve(repositoryRoot, "node_modules/.cache")
await mkdir(cacheRoot, { mode: 0o700, recursive: true })
const stateRoot = await mkdtemp(
  join(await realpath(cacheRoot), "llmm-f0-f2-firecrawl-"),
)
const sourceInputs = join(stateRoot, "source-inputs")
const sourcePacket = join(stateRoot, "source-packet")
const composeOverride = join(stateRoot, "compose.override.json")
const environmentFile = join(stateRoot, "firecrawl.env")
const allowlistDirectory = join(stateRoot, "allowlist")
const allowlistFile = join(allowlistDirectory, "allowed-hosts.txt")
const composeFile = resolve(repositoryRoot, "infra/firecrawl/compose.yaml")
const queryCanary = `f0f2-query-${randomBytes(18).toString("hex")}`
const urlCanary = `f0f2-url-${randomBytes(18).toString("hex")}`
const searxngSecret = randomBytes(32).toString("base64url")
const allowedHosts = ["en.wikipedia.org", "example.com"]
const created = {
  bridge: false,
  bridgeNetwork: false,
  compose: false,
  outputImages: false,
  profile: false,
}
const pulledForRun = new Set()
let evidence
let failure

try {
  await chmod(stateRoot, 0o700)
  created.profile = true
  startManagedProfile()
  docker(["info", "--format", "{{.ServerVersion}}"])
  await mkdir(sourceInputs, { mode: 0o700 })
  await mkdir(allowlistDirectory, { mode: 0o755 })
  await downloadLockedSources()
  runNode([
    "infra/firecrawl/release/assemble-source-packet.mjs",
    "--source-dir",
    sourceInputs,
    "--output-dir",
    sourcePacket,
  ])
  await verifyAssembledSource()

  await ensureRuntimeImage(searchImage)
  await ensureRuntimeImage(egressImage)
  created.outputImages = true
  buildReducedImages()

  const apiPort = await reservePort()
  await writeRuntimeFiles()
  created.compose = true
  assertDefaultOff()
  compose(["--profile", "firecrawl", "up", "--detach"])
  const containers = await waitForHealthyServices()
  assertPrivateRuntime(containers)
  startApiBridge(apiPort)

  const actualBaseUrl = `http://127.0.0.1:${apiPort}`
  await verifyNativeBoundary(actualBaseUrl)
  const directSearch = await verifyDirectSearch(actualBaseUrl, containers)
  const directScrape = await verifyDirectScrape(actualBaseUrl, containers)
  const productFlow = serviceControl
    ? await serveIntegratedCore(actualBaseUrl, containers)
    : await runProductFlow(actualBaseUrl)
  await verifyEgressDenial(containers.api)
  const retention = await verifyRetention(
    containers,
    actualBaseUrl,
    directSearch,
    directScrape,
  )

  evidence = {
    architecture: process.arch,
    applicationFlow: productFlow.flow,
    cleanupVerified: true,
    credentialMaterialPrinted: false,
    defaultOff: true,
    egress: {
      allowedHosts,
      deniedUnapprovedHost: true,
    },
    evidenceClass: serviceControl
      ? "LOCAL_INTEGRATED_CORE_COMPONENT_ONLY"
      : "LOCAL_ACTUAL_REDUCED_FIRECRAWL_INTEGRATION_ONLY",
    exactSource: {
      firecrawlRevision: sourcePackage.upstreamComponents.find(
        ({ id }) => id === "firecrawl",
      ).revision,
      sourcePackageSha256: await sha256(
        resolve(repositoryRoot, "infra/firecrawl/release/source-package.json"),
      ),
    },
    images: {
      api: inspectImage(apiImage),
      browser: inspectImage(browserImage),
      egress: egressImage,
      search: searchImage,
    },
    nativeCustomerAccess: false,
    productRoutes: ["POST /v2/search", "POST /v2/scrape"],
    retention,
    runtimeQualified: false,
    status: "passed",
  }
} catch (error) {
  failure = safeError(error)
} finally {
  const cleanupFailures = []
  if (created.bridge) {
    collectCleanup(cleanupFailures, () =>
      docker(["rm", "--force", bridgeContainer]),
    )
  }
  if (created.bridgeNetwork) {
    collectCleanup(cleanupFailures, () =>
      docker(["network", "rm", bridgeNetwork]),
    )
  }
  if (created.compose) {
    collectCleanup(cleanupFailures, () =>
      compose(["--profile", "firecrawl", "down", "--remove-orphans"]),
    )
  }
  if (created.outputImages) {
    removeImageIfPresent(cleanupFailures, apiImage)
    removeImageIfPresent(cleanupFailures, browserImage)
  }
  for (const image of pulledForRun) {
    collectCleanup(cleanupFailures, () =>
      docker(["image", "rm", "--force", image]),
    )
  }
  await rm(stateRoot, { force: true, recursive: true })
  if (created.profile) {
    collectCleanup(cleanupFailures, () => deleteManagedProfile())
  }
  verifyCleanup(cleanupFailures)
  if (cleanupFailures.length > 0) {
    failure = new AggregateError(
      failure ? [failure, ...cleanupFailures] : cleanupFailures,
      "F0-F2 cleanup failed.",
    )
  }
}

if (failure) throw failure
process.stdout.write(`${JSON.stringify(evidence)}\n`)

async function downloadLockedSources() {
  for (const component of sourcePackage.upstreamComponents) {
    const url = new URL(component.archiveUrl)
    if (
      url.protocol !== "https:" ||
      !url.pathname.endsWith(component.revision)
    ) {
      throw new Error(`F0-F2 rejected the ${component.id} source URL.`)
    }
    const destination = join(sourceInputs, component.archiveFile)
    const response = await fetch(url, {
      redirect: "error",
      signal: AbortSignal.timeout(120_000),
    })
    if (!response.ok || !response.body) {
      throw new Error(`F0-F2 could not retrieve ${component.id} source.`)
    }
    await pipeline(
      Readable.fromWeb(response.body),
      createWriteStream(destination, { mode: 0o600 }),
    )
    if ((await sha256(destination)) !== component.archiveSha256) {
      throw new Error(`F0-F2 ${component.id} source digest changed.`)
    }
  }
}

async function verifyAssembledSource() {
  const sums = await readFile(join(sourcePacket, "SHA256SUMS"), "utf8")
  if (!sums.includes("patched-firecrawl/apps/api/Dockerfile")) {
    throw new Error("F0-F2 corresponding source is incomplete.")
  }
  const expectedPatches = new Map(
    sourcePackage.patches.map(({ path, sha256: digest }) => [path, digest]),
  )
  for (const [path, digest] of expectedPatches) {
    if ((await sha256(resolve(repositoryRoot, path))) !== digest) {
      throw new Error(`F0-F2 patch ${path} changed before assembly.`)
    }
  }
}

function buildReducedImages() {
  const apiRoot = join(sourcePacket, "patched-firecrawl")
  const apiBuildContext = join(apiRoot, "apps/api")
  const external = new Map(
    sourcePackage.externalByteInputs.map((input) => [input.id, input]),
  )
  const fdb = external.get("foundationdb-client-amd64")
  const rustup = external.get("rustup-init-amd64")
  buildx([
    "--tag",
    apiImage,
    "--file",
    join(apiBuildContext, "Dockerfile"),
    "--build-arg",
    `NODE22_BUILD_IMAGE=${exactPlatformImageByVersion("22.23.2-bookworm")}`,
    "--build-arg",
    `GOLANG125_BASE_IMAGE=${exactPlatformImageByVersion("1.25.12-bookworm")}`,
    "--build-arg",
    `WOLFI_RUNTIME_IMAGE=${exactPlatformImage("wolfi-runtime")}`,
    "--build-arg",
    `FDB_CLIENT_DEB_SHA256=${fdb.sha256}`,
    "--build-arg",
    `RUSTUP_INIT_SHA256=${rustup.sha256}`,
    "--build-arg",
    `RUSTUP_INIT_URL=${rustup.url}`,
    "--build-arg",
    `RUST_TOOLCHAIN=${rustup.toolchain}`,
    apiBuildContext,
  ])
  buildx([
    "--tag",
    browserImage,
    "--file",
    join(apiRoot, "apps/playwright-service-ts/Dockerfile"),
    "--build-arg",
    `NODE22_BASE_IMAGE=${exactPlatformImageByVersion("22.23.2-bookworm-slim")}`,
    "--build-arg",
    `PLAYWRIGHT_BROWSER_SOURCE_IMAGE=${exactPlatformImage("playwright-browser-source")}`,
    "--build-arg",
    `WOLFI_RUNTIME_IMAGE=${exactPlatformImage("wolfi-runtime")}`,
    join(apiRoot, "apps/playwright-service-ts"),
  ])
  for (const image of [apiImage, browserImage]) {
    const [os, architecture] = docker([
      "image",
      "inspect",
      "--format",
      "{{.Os}} {{.Architecture}}",
      image,
    ])
      .trim()
      .split(" ")
    if (os !== "linux" || architecture !== "amd64") {
      throw new Error(`F0-F2 built ${image} for an unexpected platform.`)
    }
  }
}

function buildx(arguments_) {
  docker(["build", "--platform", "linux/amd64", ...arguments_])
}

async function ensureRuntimeImage(image) {
  if (dockerResult(["image", "inspect", image]).status === 0) return
  docker(["pull", "--platform", "linux/amd64", image])
  pulledForRun.add(image)
}

async function writeRuntimeFiles() {
  await writeFile(allowlistFile, `${allowedHosts.join("\n")}\n`, {
    mode: 0o644,
  })
  const networkName = (name) => `${project}-${name}`
  await writeFile(
    composeOverride,
    `${JSON.stringify(
      {
        services: {
          "firecrawl-api": {
            environment: {
              SEARXNG_CATEGORIES: "general",
              SEARXNG_ENGINES: "wikipedia",
            },
          },
        },
        networks: Object.fromEntries(
          ["browser", "control", "egress", "proxy", "search"].map((name) => [
            name,
            { name: networkName(name) },
          ]),
        ),
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  )
  await writeFile(
    environmentFile,
    [
      `FIRECRAWL_API_IMAGE=${apiImage}`,
      `FIRECRAWL_BROWSER_IMAGE=${browserImage}`,
      `FIRECRAWL_EGRESS_ALLOWLIST_DIR=${allowlistDirectory}`,
      `FIRECRAWL_EGRESS_IMAGE=${egressImage}`,
      "FIRECRAWL_MAX_CONCURRENT_JOBS=1",
      `FIRECRAWL_SEARCH_IMAGE=${searchImage}`,
      `FIRECRAWL_SEARXNG_SECRET=${searxngSecret}`,
      "",
    ].join("\n"),
    { mode: 0o600 },
  )
}

function compose(arguments_) {
  return docker([
    "compose",
    "--project-name",
    project,
    "--env-file",
    environmentFile,
    "--file",
    composeFile,
    "--file",
    composeOverride,
    ...arguments_,
  ])
}

function assertDefaultOff() {
  if (compose(["config", "--services"]).trim() !== "") {
    throw new Error("F0-F2 exposes a service without the Firecrawl profile.")
  }
  if (compose(["ps", "--all", "--quiet"]).trim() !== "") {
    throw new Error("F0-F2 started Firecrawl without the profile.")
  }
}

async function waitForHealthyServices() {
  const services = {
    api: "firecrawl-api",
    browser: "firecrawl-browser",
    egress: "firecrawl-egress",
    search: "firecrawl-search",
  }
  const deadline = Date.now() + 8 * 60_000
  while (Date.now() < deadline) {
    const containers = Object.fromEntries(
      Object.entries(services).map(([key, service]) => [
        key,
        compose(["--profile", "firecrawl", "ps", "--quiet", service]).trim(),
      ]),
    )
    if (
      Object.values(containers).every(Boolean) &&
      Object.values(containers).every(
        (container) =>
          docker([
            "inspect",
            "--format",
            "{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}",
            container,
          ]).trim() === "healthy",
      )
    ) {
      return containers
    }
    await delay(1_000)
  }
  throw new Error(
    `F0-F2 services did not become healthy: ${compose(["--profile", "firecrawl", "ps"])}`,
  )
}

function assertPrivateRuntime(containers) {
  for (const [service, container] of Object.entries(containers)) {
    const ports = JSON.parse(
      docker([
        "inspect",
        "--format",
        "{{json .NetworkSettings.Ports}}",
        container,
      ]),
    )
    const published = Object.values(ports ?? {}).flatMap((bindings) =>
      Array.isArray(bindings) ? bindings : [],
    )
    if (published.length !== 0) {
      throw new Error(`F0-F2 exposed the private ${service} service.`)
    }
    const logDriver = docker([
      "inspect",
      "--format",
      "{{.HostConfig.LogConfig.Type}}",
      container,
    ]).trim()
    if (logDriver !== "none") {
      throw new Error(`F0-F2 ${service} retained a container log sink.`)
    }
  }
}

function startApiBridge(apiPort) {
  docker([
    "network",
    "create",
    "--label",
    "com.llm-machines.test-package=F0-F2",
    "--opt",
    "com.docker.network.bridge.enable_ip_masquerade=false",
    bridgeNetwork,
  ])
  created.bridgeNetwork = true
  docker([
    "run",
    "--detach",
    "--name",
    bridgeContainer,
    "--label",
    "com.llm-machines.test-package=F0-F2",
    "--network",
    bridgeNetwork,
    "--publish",
    `127.0.0.1:${apiPort}:3002`,
    "--read-only",
    "--tmpfs",
    "/tmp:rw,noexec,nosuid,nodev,size=8m",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges=true",
    "--user",
    "65532:65532",
    "--log-driver",
    "none",
    "--entrypoint",
    "/usr/bin/node",
    apiImage,
    "-e",
    'const net=require("node:net");net.createServer(client=>{const upstream=net.connect(3002,"firecrawl-api");client.pipe(upstream);upstream.pipe(client);const close=()=>{client.destroy();upstream.destroy()};client.on("error",close);upstream.on("error",close)}).listen(3002,"0.0.0.0")',
  ])
  created.bridge = true
  docker(["network", "connect", `${project}-control`, bridgeContainer])
  const ports = JSON.parse(
    docker([
      "inspect",
      "--format",
      "{{json .NetworkSettings.Ports}}",
      bridgeContainer,
    ]),
  )
  const bindings = ports?.["3002/tcp"]
  if (
    !Array.isArray(bindings) ||
    bindings.length !== 1 ||
    bindings[0].HostIp !== "127.0.0.1" ||
    bindings[0].HostPort !== String(apiPort)
  ) {
    throw new Error(
      `F0-F2 test bridge was not loopback-only: ${JSON.stringify(ports)}; expected 127.0.0.1:${apiPort}.`,
    )
  }
  const networks = Object.keys(
    JSON.parse(
      docker([
        "inspect",
        "--format",
        "{{json .NetworkSettings.Networks}}",
        bridgeContainer,
      ]),
    ),
  ).sort()
  if (
    JSON.stringify(networks) !==
    JSON.stringify([bridgeNetwork, `${project}-control`].sort())
  ) {
    throw new Error("F0-F2 test bridge joined an unexpected network.")
  }
}

async function verifyNativeBoundary(baseUrl) {
  await waitForHttp(`${baseUrl}/v0/health/liveness`)
  const nativeUi = await fetch(baseUrl, { signal: AbortSignal.timeout(5_000) })
  if (nativeUi.status !== 404) throw new Error("F0-F2 exposed a native UI.")
  const unsupported = await fetch(`${baseUrl}/v2/crawl`, {
    body: JSON.stringify({ url: "https://example.com" }),
    headers: { "content-type": "application/json" },
    method: "POST",
    signal: AbortSignal.timeout(10_000),
  })
  if (unsupported.status !== 404) {
    throw new Error("F0-F2 native API exposed an unsupported route.")
  }
}

async function verifyDirectSearch(baseUrl, containers) {
  const response = await fetch(`${baseUrl}/v2/search`, {
    body: JSON.stringify({ limit: 1, query: "OpenAI", timeout: 25_000 }),
    headers: { "content-type": "application/json" },
    method: "POST",
    signal: AbortSignal.timeout(60_000),
  })
  const body = await response.json()
  const results = Array.isArray(body.data)
    ? body.data
    : Array.isArray(body.data?.web)
      ? body.data.web
      : null
  if (!response.ok || body.success !== true || !results || results.length < 1) {
    const backend = inspectSearchBackend(containers.api)
    const wikipediaProxyStatus = proxyConnectStatus(
      containers.api,
      "en.wikipedia.org",
    )
    const egressPolicy = inspectEgressPolicy(containers.egress)
    const dataShape = `bodyKeys=${Object.keys(body).sort().join(",")} dataType=${Array.isArray(body.data) ? "array" : typeof body.data} dataKeys=${body.data && typeof body.data === "object" && !Array.isArray(body.data) ? Object.keys(body.data).sort().join(",") : "none"}`
    throw new Error(
      `F0-F2 actual self-hosted search did not return a result: status=${response.status} success=${String(body.success)} code=${String(body.code ?? "none")} error=${String(body.error ?? "none").slice(0, 240)} results=${results?.length ?? "invalid"} ${dataShape} backendResults=${backend.resultCount} backendErrors=${backend.errors.join("|")} wikipediaProxyStatus=${wikipediaProxyStatus} egressPolicy=${egressPolicy}.`,
    )
  }
  return {
    description: String(results[0].description ?? ""),
    title: String(results[0].title ?? ""),
    url: String(results[0].url ?? ""),
  }
}

async function verifyDirectScrape(baseUrl, containers) {
  const response = await fetch(`${baseUrl}/v2/scrape`, {
    body: JSON.stringify({
      formats: ["markdown", "html"],
      maxAge: 0,
      proxy: "basic",
      removeBase64Images: true,
      skipTlsVerification: false,
      storeInCache: false,
      timeout: 45_000,
      url: `https://example.com/?trace=${urlCanary}`,
      zeroDataRetention: true,
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
    signal: AbortSignal.timeout(75_000),
  })
  const body = await response.json()
  if (
    !response.ok ||
    body.success !== true ||
    typeof body.data?.markdown !== "string" ||
    body.data.markdown.length === 0
  ) {
    const exampleProxyStatus = proxyConnectStatus(containers.api, "example.com")
    const markdownShape = `${typeof body.data?.markdown}:${typeof body.data?.markdown === "string" ? body.data.markdown.length : -1}`
    const htmlShape = `${typeof body.data?.html}:${typeof body.data?.html === "string" ? body.data.html.length : -1}`
    const documentStatus = String(body.data?.metadata?.statusCode ?? "none")
    throw new Error(
      `F0-F2 actual static scrape failed: status=${response.status} success=${String(body.success)} bodyKeys=${Object.keys(body).sort().join(",")} dataKeys=${body.data && typeof body.data === "object" ? Object.keys(body.data).sort().join(",") : "none"} markdown=${markdownShape} html=${htmlShape} documentStatus=${documentStatus} exampleProxyStatus=${exampleProxyStatus}.`,
    )
  }
  return {
    htmlPresent:
      typeof body.data.html === "string" && body.data.html.length > 0,
    markdownPresent: true,
  }
}

function inspectEgressPolicy(egressContainer) {
  const result = dockerResult([
    "exec",
    egressContainer,
    "sh",
    "-c",
    'printf "uid=%s gid=%s " "$(id -u)" "$(id -g)"; stat -c "dir=%a:%u:%g file=%a:%u:%g " /etc/squid/allowlists /etc/squid/allowlists/allowed-hosts.txt 2>/dev/null; printf "hosts="; tr "\\n" "," </etc/squid/allowlists/allowed-hosts.txt; squid -k parse -f /etc/squid/squid.conf >/dev/null 2>&1; printf " parse=%s" "$?"',
  ])
  return result.status === 0
    ? sanitize(result.stdout).replaceAll(/\s+/g, "_")
    : `exit-${result.status}-${sanitize(result.stderr || result.stdout).replaceAll(/\s+/g, "_")}`
}

function inspectSearchBackend(apiContainer) {
  const output = docker([
    "exec",
    apiContainer,
    "/usr/bin/node",
    "-e",
    'fetch("http://firecrawl-search:8080/search?q=OpenAI&format=json&engines=wikipedia&categories=general",{signal:AbortSignal.timeout(30000)}).then(async response=>{if(!response.ok)throw new Error(String(response.status));process.stdout.write(await response.text())}).catch(error=>{process.stderr.write(error.name);process.exit(1)})',
  ])
  const body = JSON.parse(output)
  return {
    errors: Array.isArray(body.unresponsive_engines)
      ? body.unresponsive_engines.map((entry) =>
          Array.isArray(entry) ? entry.map(String).join(":") : String(entry),
        )
      : [],
    resultCount: Array.isArray(body.results) ? body.results.length : -1,
  }
}

async function runProductFlow(baseUrl) {
  const result = await runChild(
    [
      resolve(repositoryRoot, "scripts/pre-genesis/reduced-core-dev.mjs"),
      "--firecrawl-actual-slice",
    ],
    {
      PRE_GENESIS_FIRECRAWL_ALLOWED_HOSTS: allowedHosts.join(","),
      PRE_GENESIS_FIRECRAWL_QUERY_CANARY: queryCanary,
      PRE_GENESIS_FIRECRAWL_UPSTREAM_BASE_URL: baseUrl,
      PRE_GENESIS_FIRECRAWL_URL_CANARY: urlCanary,
    },
    15 * 60_000,
  )
  const parsed = JSON.parse(result.trim().split("\n").at(-1))
  if (
    parsed.status !== "passed" ||
    parsed.evidenceClass !== "LOCAL_ACTUAL_REDUCED_FIRECRAWL_INTEGRATION_ONLY"
  ) {
    throw new Error("F0-F2 Product flow did not pass.")
  }
  return parsed
}

async function serveIntegratedCore(baseUrl, containers) {
  await writeFile(
    serviceControl.controlFile,
    `${JSON.stringify({
      allowedHosts,
      baseUrl,
      canaries: { query: queryCanary, url: urlCanary },
      containers,
      dockerContext,
      project,
    })}\n`,
    { mode: 0o600 },
  )
  await waitForStop(serviceControl.stopFile)
  return {
    flow: {
      authority: "F0-C1 integrated Product flow",
      source: "external-disposable-orchestrator",
    },
  }
}

async function verifyEgressDenial(apiContainer) {
  if (proxyConnectStatus(apiContainer, "iana.org") !== "403") {
    throw new Error("F0-F2 egress proxy did not deny an unapproved host.")
  }
}

function proxyConnectStatus(apiContainer, hostname) {
  const result = dockerResult([
    "exec",
    apiContainer,
    "/usr/bin/node",
    "-e",
    'const net=require("node:net");const host=process.argv[1];const crlf=String.fromCharCode(13,10);const socket=net.connect(3128,"firecrawl-egress",()=>socket.write(`CONNECT ${host}:443 HTTP/1.1${crlf}Host: ${host}:443${crlf}${crlf}`));let data="";const timer=setTimeout(()=>{socket.destroy();process.exit(2)},15000);socket.on("data",chunk=>{data+=chunk;if(data.includes(crlf)){clearTimeout(timer);const status=data.split(crlf)[0].split(" ")[1]||"";if(/^[0-9]{3}$/.test(status))process.stdout.write(status);socket.destroy();process.exit(/^[0-9]{3}$/.test(status)?0:3)}});socket.on("error",error=>{process.stderr.write(error.code||error.name);process.exit(4)})',
    hostname,
  ])
  if (result.status !== 0 || !/^[0-9]{3}$/.test(result.stdout.trim())) {
    return `exit-${result.status}-${sanitize(result.stderr).replaceAll(/\s+/g, "_")}`
  }
  return result.stdout.trim()
}

async function verifyRetention(
  containers,
  baseUrl,
  directSearch,
  directScrape,
) {
  const metrics = await (await fetch(`${baseUrl}/metrics`)).text()
  const sensitive = [
    queryCanary,
    urlCanary,
    directSearch.title,
    directSearch.url,
  ].filter((value) => value.length >= 8)
  if (!directScrape.htmlPresent || !directScrape.markdownPresent) {
    throw new Error("F0-F2 direct scrape evidence was incomplete.")
  }
  assertNoSensitive([metrics], sensitive)
  for (const container of Object.values(containers)) {
    const diff = docker(["diff", container])
    assertNoSensitive([diff], sensitive)
  }
  const writable = {
    api: ["/tmp"],
    browser: ["/tmp", "/home/nonroot/.cache"],
    egress: ["/run/squid", "/var/log/squid", "/var/spool/squid", "/tmp"],
    search: ["/tmp", "/var/cache/searxng"],
  }
  for (const [service, paths] of Object.entries(writable)) {
    for (const value of sensitive) {
      const result = dockerResult([
        "exec",
        "--env",
        `SCAN_VALUE=${value}`,
        containers[service],
        "sh",
        "-c",
        'for candidate in "$@"; do [ ! -e "$candidate" ] || grep -R -F -q -- "$SCAN_VALUE" "$candidate"; status=$?; [ "$status" -eq 1 ] || exit "$status"; done',
        "f0-f2-retention-scan",
        ...paths,
      ])
      if (result.status !== 0) {
        throw new Error(`F0-F2 retained workload content in ${service}.`)
      }
    }
  }
  const files = await collectFiles(stateRoot)
  for (const file of files) {
    assertNoSensitive(
      [await readFile(file, "utf8").catch(() => "")],
      [queryCanary, urlCanary],
    )
  }
  return {
    activeWritableFiles: "canaries-absent",
    containerLogs: "disabled",
    metrics: "canaries-absent",
    persistentVolumes: 0,
    temporaryState: "removed-on-exit",
    workloadContentCanaries: 0,
  }
}

async function collectFiles(root) {
  const files = []
  const entries = await import("node:fs/promises")
  async function visit(directory) {
    for (const entry of await entries.readdir(directory, {
      withFileTypes: true,
    })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await visit(path)
      else if (entry.isFile() && (await stat(path)).size <= 8 * 1024 * 1024)
        files.push(path)
    }
  }
  await visit(root)
  return files
}

function exactPlatformImage(id) {
  const input = packageById.get(id)
  if (
    !input?.repository ||
    !/^sha256:[a-f0-9]{64}$/.test(input.platformDigest)
  ) {
    throw new Error(`F0-F2 lacks an immutable ${id} platform identity.`)
  }
  return `${input.repository}@${input.platformDigest}`
}

function exactPlatformImageByVersion(version) {
  const matching = sourcePackage.buildInputs.filter(
    (input) => input.version === version,
  )
  if (matching.length !== 1) {
    throw new Error(`F0-F2 lacks one immutable ${version} image identity.`)
  }
  return exactPlatformImage(matching[0].id)
}

function inspectImage(image) {
  const [id, os, architecture] = docker([
    "image",
    "inspect",
    "--format",
    "{{.Id}} {{.Os}} {{.Architecture}}",
    image,
  ])
    .trim()
    .split(" ")
  return { architecture, id, os }
}

function verifyCleanup(cleanupFailures) {
  for (const image of [apiImage, browserImage]) {
    if (dockerResult(["image", "inspect", image]).status === 0) {
      cleanupFailures.push(new Error(`F0-F2 output image remains: ${image}`))
    }
  }
  const remaining = dockerResult([
    "ps",
    "--all",
    "--quiet",
    "--filter",
    `label=com.docker.compose.project=${project}`,
  ])
  if (remaining.status === 0 && remaining.stdout.trim() !== "") {
    cleanupFailures.push(new Error("F0-F2 containers remain."))
  }
  if (dockerResult(["network", "inspect", `${project}-control`]).status === 0) {
    cleanupFailures.push(new Error("F0-F2 network remains."))
  }
  if (dockerResult(["network", "inspect", bridgeNetwork]).status === 0) {
    cleanupFailures.push(new Error("F0-F2 bridge network remains."))
  }
  if (
    managedProfile &&
    colimaResult(["status", "--profile", managedProfile]).status === 0
  ) {
    cleanupFailures.push(new Error("F0-F2 disposable Colima profile remains."))
  }
}

function startManagedProfile() {
  const result = colimaResult([
    "start",
    "--profile",
    managedProfile,
    "--activate=false",
    "--arch",
    "aarch64",
    "--cpus",
    "6",
    "--memory",
    "12",
    "--disk",
    "80",
    "--runtime",
    "docker",
    "--vm-type",
    "vz",
    "--vz-rosetta",
    "--ssh-config=false",
    "--save-config=false",
    "--template=false",
  ])
  if (result.status !== 0) {
    throw new Error(
      `F0-F2 could not start its disposable build environment: ${sanitize(result.stderr || result.stdout)}`,
    )
  }
}

function deleteManagedProfile() {
  const result = colimaResult([
    "delete",
    "--profile",
    managedProfile,
    "--data",
    "--force",
  ])
  if (result.status !== 0) {
    throw new Error(
      `F0-F2 could not remove its disposable build environment: ${sanitize(result.stderr || result.stdout)}`,
    )
  }
}

function colimaResult(arguments_) {
  return spawnSync("colima", arguments_, {
    encoding: "utf8",
    env: commandEnvironment(),
    maxBuffer: 64 * 1024 * 1024,
  })
}

function docker(arguments_, extraEnvironment = {}) {
  const result = dockerResult(arguments_, extraEnvironment)
  if (result.status !== 0) {
    throw new Error(
      `F0-F2 Docker command failed: ${sanitize(result.stderr || result.stdout)}`,
    )
  }
  return result.stdout
}

function dockerResult(arguments_, extraEnvironment = {}) {
  return spawnSync("docker", ["--context", dockerContext, ...arguments_], {
    encoding: "utf8",
    env: commandEnvironment(extraEnvironment),
    maxBuffer: 256 * 1024 * 1024,
  })
}

function runNode(arguments_) {
  const result = spawnSync(process.execPath, arguments_, {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: commandEnvironment(),
    maxBuffer: 64 * 1024 * 1024,
  })
  if (result.status !== 0) {
    throw new Error(
      `F0-F2 source assembly failed: ${sanitize(result.stderr || result.stdout)}`,
    )
  }
}

function runChild(arguments_, extraEnvironment, timeout) {
  return new Promise((resolveChild, rejectChild) => {
    const child = spawn(process.execPath, arguments_, {
      cwd: repositoryRoot,
      env: commandEnvironment(extraEnvironment),
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk) => {
      stdout += chunk
      if (stdout.length > 64 * 1024 * 1024) child.kill("SIGTERM")
    })
    child.stderr.on("data", (chunk) => {
      stderr += chunk
      if (stderr.length > 64 * 1024 * 1024) child.kill("SIGTERM")
    })
    const timer = setTimeout(() => child.kill("SIGTERM"), timeout)
    child.once("error", rejectChild)
    child.once("exit", (status) => {
      clearTimeout(timer)
      if (status === 0) resolveChild(stdout)
      else
        rejectChild(
          new Error(`F0-F2 Product flow failed: ${sanitize(stderr || stdout)}`),
        )
    })
  })
}

function commandEnvironment(extra = {}) {
  return {
    HOME: process.env.HOME ?? "",
    LANG: "C",
    LC_ALL: "C",
    PATH: process.env.PATH ?? "",
    ...extra,
  }
}

function serviceControlFromEnvironment() {
  const controlFile = process.env.F0_C1_SERVICE_CONTROL_FILE?.trim()
  const stopFile = process.env.F0_C1_SERVICE_STOP_FILE?.trim()
  if (!controlFile && !stopFile) return null
  if (
    !controlFile ||
    !stopFile ||
    !isAbsolute(controlFile) ||
    !isAbsolute(stopFile)
  ) {
    throw new Error("F0-C1 Firecrawl service control is invalid.")
  }
  return { controlFile, stopFile }
}

async function waitForStop(path) {
  for (;;) {
    try {
      await access(path)
      return
    } catch {}
    await delay(100)
  }
}

async function reservePort() {
  const server = createServer()
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen)
    server.listen(0, "127.0.0.1", resolveListen)
  })
  const address = server.address()
  const port = typeof address === "object" && address ? address.port : null
  await new Promise((resolveClose, rejectClose) =>
    server.close((error) => (error ? rejectClose(error) : resolveClose())),
  )
  if (!Number.isSafeInteger(port))
    throw new Error("F0-F2 could not reserve a port.")
  return port
}

async function waitForHttp(url) {
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) })
      if (response.ok) return
    } catch {}
    await delay(500)
  }
  throw new Error("F0-F2 API did not become reachable.")
}

async function sha256(path) {
  const hash = createHash("sha256")
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest("hex")
}

function assertNoSensitive(values, sensitive) {
  for (const value of values) {
    for (const secret of sensitive) {
      if (String(value).includes(secret)) {
        throw new Error("F0-F2 retained workload content.")
      }
    }
  }
}

function collectCleanup(failures, operation) {
  try {
    operation()
  } catch (error) {
    failures.push(safeError(error))
  }
}

function removeImageIfPresent(failures, image) {
  if (dockerResult(["image", "inspect", image]).status !== 0) return
  collectCleanup(failures, () => docker(["image", "rm", "--force", image]))
}

function sanitize(value) {
  let output = String(value)
  for (const sensitive of [queryCanary, urlCanary, searxngSecret]) {
    output = output.replaceAll(sensitive, "[redacted]")
  }
  return output
    .replaceAll(/Bearer\s+[^\s"']+/gi, "Bearer [redacted]")
    .replaceAll(/[A-Za-z0-9_-]{43,}/g, "[opaque]")
    .slice(-12_000)
}

function safeError(error) {
  const value =
    error instanceof Error ? (error.stack ?? error.message) : String(error)
  return new Error(sanitize(value))
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"))
}
