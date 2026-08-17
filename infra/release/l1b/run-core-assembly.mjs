#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  createReadStream,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  statfsSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, join, relative, resolve } from "node:path"
import { pipeline } from "node:stream/promises"
import { fileURLToPath } from "node:url"
import { fetchLockedInputs } from "./fetch-locked-inputs.mjs"
import { normalizeOciLayout } from "./normalize-oci-layout.mjs"
import { verifyHostToolchain } from "./verify-toolchain.mjs"

const directory = dirname(fileURLToPath(import.meta.url))
const defaultRepositoryRoot = resolve(directory, "../../..")
const gib = 1024 ** 3

function fail(message) {
  throw new Error(message)
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
}

function command(command_, args, options = {}) {
  const result = spawnSync(command_, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    encoding: options.encoding ?? "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: options.stdio ?? ["ignore", "inherit", "inherit"],
  })
  if (result.status !== 0)
    fail(`${command_} failed with status ${result.status}`)
  return result.stdout?.trim() ?? ""
}

function capture(command_, args, options = {}) {
  return command(command_, args, {
    ...options,
    stdio: ["ignore", "pipe", "pipe"],
  })
}

async function sha256File(path) {
  const hash = createHash("sha256")
  await pipeline(createReadStream(path), hash)
  return hash.digest("hex")
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"))
}

function within(root, path, field) {
  const value = relative(resolve(root), resolve(path))
  if (value === "" || value === ".." || value.startsWith("../")) {
    fail(`${field} must be a child of the assembly root`)
  }
  return value
}

function assertAssemblyVolume(root, assemblyId) {
  const metadata = readJson(join(root, ".llmm-l1b-volume.json"))
  const filesystem = statfsSync(root)
  const capacity = filesystem.blocks * filesystem.bsize
  if (
    metadata?.schema !== "llm-machines.vm103-l1b-volume.v1" ||
    metadata?.assembly !== assemblyId ||
    metadata?.capacityGiB !== 80 ||
    capacity > 80.5 * gib ||
    capacity < 70 * gib
  ) {
    fail("assembly root is not the dedicated 80 GiB volume")
  }
  return { ...metadata, filesystemBytes: capacity, device: statSync(root).dev }
}

function assertSameDevice(volume, paths) {
  for (const [field, path] of paths) {
    if (statSync(path).dev !== volume.device)
      fail(`${field} is not on the assembly volume`)
  }
}

function assertReleaseSource(root, expectedCommit, expectedTree) {
  const commit = capture("git", ["rev-parse", "HEAD"], { cwd: root })
  const tree = capture("git", ["rev-parse", "HEAD^{tree}"], { cwd: root })
  const status = capture(
    "git",
    ["status", "--porcelain=v1", "--untracked-files=all"],
    { cwd: root },
  )
  if (commit !== expectedCommit || tree !== expectedTree || status !== "") {
    fail("release source is not the exact clean protected input")
  }
  return {
    commit,
    tree,
    sourceDateEpoch: Number.parseInt(
      capture("git", ["show", "-s", "--format=%ct", "HEAD"], { cwd: root }),
      10,
    ),
  }
}

function extractOciTar(input, output) {
  if (existsSync(output)) fail("OCI extraction root already exists")
  mkdirSync(output, { mode: 0o700 })
  const entries = capture("tar", ["-tf", input]).split(/\r?\n/).filter(Boolean)
  if (
    entries.length === 0 ||
    entries.some(
      (entry) =>
        entry.startsWith("/") ||
        entry.split("/").some((part) => part === ".." || part === ""),
    )
  ) {
    fail("build output contains an unsafe archive path")
  }
  command("tar", [
    "--extract",
    "--file",
    input,
    "--directory",
    output,
    "--no-same-owner",
    "--no-same-permissions",
  ])
}

function toolReference(toolchain, id) {
  const tool = toolchain.containerTools.find((entry) => entry.id === id)
  if (!tool) fail(`toolchain is missing ${id}`)
  return `${tool.repository}@${tool.indexDigest}`
}

function dockerEnvironment() {
  if (!process.env.DOCKER_HOST?.startsWith("unix://")) {
    fail("DOCKER_HOST must bind the assembly-owned Docker socket")
  }
  return process.env
}

function prepareBuildkit({ toolchain, builderName, assemblyRoot }) {
  const dockerRoot = capture(
    "docker",
    ["info", "--format", "{{.DockerRootDir}}"],
    {
      env: dockerEnvironment(),
    },
  )
  within(assemblyRoot, dockerRoot, "Docker data root")
  const reference = toolReference(toolchain, "buildkit")
  command("docker", ["pull", "--platform", "linux/amd64", reference], {
    env: dockerEnvironment(),
  })
  command(
    "docker",
    [
      "buildx",
      "create",
      "--name",
      builderName,
      "--driver",
      "docker-container",
      "--driver-opt",
      `image=${reference}`,
      "--driver-opt",
      "network=host",
      "--platform",
      "linux/amd64",
      "--bootstrap",
    ],
    { env: dockerEnvironment() },
  )
  const inspection = capture("docker", ["buildx", "inspect", builderName], {
    env: dockerEnvironment(),
  })
  if (!inspection.includes("linux/amd64") || !inspection.includes("v0.30.0")) {
    fail("BuildKit instance does not match the locked native profile")
  }
  return { dockerRoot, reference }
}

function importImage({
  assemblyRoot,
  layoutRoot,
  reference,
  id,
  skopeoReference,
}) {
  const relativeLayout = within(assemblyRoot, layoutRoot, `${id} OCI layout`)
  mkdirSync(dirname(layoutRoot), { recursive: true })
  command(
    "docker",
    [
      "run",
      "--rm",
      "--platform",
      "linux/amd64",
      "--network",
      "host",
      "--volume",
      `${assemblyRoot}:/assembly`,
      skopeoReference,
      "copy",
      "--format",
      "oci",
      "--override-os",
      "linux",
      "--override-arch",
      "amd64",
      `docker://${reference}`,
      `oci:/assembly/${relativeLayout}:${id}`,
    ],
    { env: dockerEnvironment() },
  )
}

function buildImage({
  sourceRoot,
  context,
  dockerfile,
  rawOutput,
  builderName,
  sourceDateEpoch,
}) {
  command(
    "docker",
    [
      "buildx",
      "build",
      "--builder",
      builderName,
      "--platform",
      "linux/amd64",
      "--provenance=false",
      "--sbom=false",
      "--network=host",
      "--build-arg",
      `SOURCE_DATE_EPOCH=${sourceDateEpoch}`,
      "--file",
      resolve(context, dockerfile),
      "--output",
      `type=oci,dest=${rawOutput},rewrite-timestamp=true`,
      resolve(context),
    ],
    { cwd: sourceRoot, env: dockerEnvironment() },
  )
}

function prepareReviewedSources({ sourceRoot, inputsRoot, workRoot }) {
  const firecrawlRoot = join(workRoot, "firecrawl-source")
  const litellmRoot = join(workRoot, "litellm-source")
  command("node", [
    resolve(sourceRoot, "infra/firecrawl/release/assemble-source-packet.mjs"),
    "--source-dir",
    inputsRoot,
    "--output-dir",
    firecrawlRoot,
  ])
  const litellmManifest = readJson(
    resolve(sourceRoot, "infra/litellm/oss-downstream/source-package.json"),
  )
  command("node", [
    resolve(sourceRoot, "infra/litellm/oss-downstream/assemble-source.mjs"),
    "--archive",
    resolve(inputsRoot, litellmManifest.upstream.archiveFile),
    "--output",
    litellmRoot,
  ])
  return {
    firecrawl: join(firecrawlRoot, "patched-firecrawl"),
    firecrawlPacket: firecrawlRoot,
    litellm: join(litellmRoot, "litellm-oss-1.96.2"),
  }
}

function sourceReference(component, inventory, firecrawl) {
  if (component.mode === "SOURCE_PLATFORM_IMPORT") {
    const entry = inventory.components.find(({ id }) => id === component.id)
    return `${entry.repository}@${entry.platformDigest}`
  }
  const inputId = component.sourcePackageInputId
  const input = firecrawl.buildInputs.find(({ id }) => id === inputId)
  return `${input.repository}@${input.platformDigest}`
}

function buildContext(component, sourceRoot, reviewed) {
  if (component.mode === "PRODUCT_BUILD")
    return { context: sourceRoot, dockerfile: component.dockerfile }
  if (component.id === "litellm")
    return { context: reviewed.litellm, dockerfile: component.dockerfile }
  if (component.id === "firecrawl-api")
    return {
      context: join(reviewed.firecrawl, "apps/api"),
      dockerfile: component.dockerfile,
    }
  if (component.id === "firecrawl-browser") {
    return {
      context: join(reviewed.firecrawl, "apps/playwright-service-ts"),
      dockerfile: component.dockerfile,
    }
  }
  fail(`no build context for ${component.id}`)
}

function imageVersion(id, inventory, releaseVersion) {
  const component = inventory.components.find((entry) => entry.id === id)
  return component.version === "release-version"
    ? releaseVersion
    : component.version
}

async function scanImage({
  assemblyRoot,
  archive,
  id,
  version,
  toolchain,
  evidenceRoot,
  scansRoot,
  trivyCache,
}) {
  const scanTar = join(scansRoot, `${id}.oci.tar`)
  command("zstd", [
    "--decompress",
    "--no-progress",
    "--output",
    scanTar,
    archive,
  ])
  const syftOutput = join(evidenceRoot, `${id}.sbom.cdx.json`)
  const trivyOutput = join(evidenceRoot, `${id}.trivy.json`)
  const archiveInContainer = `/assembly/${within(assemblyRoot, scanTar, "scan archive")}`
  const syftOutputInContainer = `/assembly/${within(assemblyRoot, syftOutput, "SBOM output")}`
  const trivyOutputInContainer = `/assembly/${within(assemblyRoot, trivyOutput, "Trivy output")}`
  const trivyCacheInContainer = `/assembly/${within(assemblyRoot, trivyCache, "Trivy cache")}`
  command(
    "docker",
    [
      "run",
      "--rm",
      "--platform",
      "linux/amd64",
      "--volume",
      `${assemblyRoot}:/assembly`,
      toolReference(toolchain, "syft"),
      "scan",
      `oci-archive:${archiveInContainer}`,
      "--source-name",
      id,
      "--source-version",
      version,
      "--output",
      `cyclonedx-json=${syftOutputInContainer}`,
    ],
    { env: dockerEnvironment() },
  )
  command(
    "docker",
    [
      "run",
      "--rm",
      "--platform",
      "linux/amd64",
      "--volume",
      `${assemblyRoot}:/assembly`,
      toolReference(toolchain, "trivy"),
      "image",
      "--cache-dir",
      trivyCacheInContainer,
      "--skip-db-update",
      "--format",
      "json",
      "--output",
      trivyOutputInContainer,
      "--input",
      archiveInContainer,
    ],
    { env: dockerEnvironment() },
  )
  rmSync(scanTar)
  return {
    rawSbomSha256: await sha256File(syftOutput),
    rawVulnerabilityReportSha256: await sha256File(trivyOutput),
  }
}

function walkDigest(root, current = "") {
  const lines = []
  for (const entry of readdirSync(join(root, current), {
    withFileTypes: true,
  }).sort((a, b) => a.name.localeCompare(b.name))) {
    const relativePath = join(current, entry.name)
    const absolute = join(root, relativePath)
    if (entry.isDirectory()) lines.push(...walkDigest(root, relativePath))
    else if (entry.isFile())
      lines.push(
        `${createHash("sha256").update(readFileSync(absolute)).digest("hex")}  ${relativePath}`,
      )
    else fail(`unsupported Trivy cache entry: ${relativePath}`)
  }
  return createHash("sha256")
    .update(`${lines.join("\n")}\n`)
    .digest("hex")
}

function trivyDatabaseObservation(cacheRoot) {
  const metadataPath = join(cacheRoot, "db", "metadata.json")
  const metadata = readJson(metadataPath)
  const updatedAt = metadata.UpdatedAt ?? metadata.updatedAt
  const updated = Date.parse(updatedAt)
  if (
    !Number.isInteger(updated) ||
    Date.now() - updated > 72 * 3_600_000 ||
    updated > Date.now()
  ) {
    fail("Trivy database is not within the 72-hour policy")
  }
  return { updatedAt, digest: walkDigest(join(cacheRoot, "db")) }
}

export async function runCoreAssembly(options) {
  const assemblyRoot = resolve(options.assemblyRoot)
  const sourceRoot = resolve(options.sourceRoot)
  const volume = assertAssemblyVolume(assemblyRoot, options.assemblyId)
  const release = assertReleaseSource(
    sourceRoot,
    options.expectedCommit,
    options.expectedTree,
  )
  const toolchainObservation = verifyHostToolchain()
  const toolchain = readJson(
    resolve(sourceRoot, "infra/release/l1b/toolchain-lock.json"),
  )
  const buildContract = readJson(
    resolve(sourceRoot, "infra/release/core-image-build-contract.json"),
  )
  const inventory = readJson(
    resolve(sourceRoot, "infra/release/core-image-inventory.json"),
  )
  const firecrawl = readJson(
    resolve(sourceRoot, "infra/firecrawl/release/source-package.json"),
  )
  const runRoot = resolve(assemblyRoot, "run")
  if (existsSync(runRoot)) fail("assembly run root already exists")
  const inputsRoot = join(runRoot, "inputs")
  const workRoot = join(runRoot, "work")
  const imagesRoot = join(runRoot, "images")
  const rawRoot = join(runRoot, "raw")
  const layoutsRoot = join(runRoot, "layouts")
  const evidenceRoot = join(runRoot, "evidence")
  const scansRoot = join(runRoot, "scans")
  const trivyCache = join(runRoot, "trivy-cache")
  for (const path of [
    workRoot,
    imagesRoot,
    rawRoot,
    layoutsRoot,
    evidenceRoot,
    scansRoot,
    trivyCache,
  ]) {
    mkdirSync(path, { recursive: true, mode: 0o700 })
  }
  assertSameDevice(volume, [
    ["release checkout", sourceRoot],
    ["run root", runRoot],
    ["temporary root", process.env.TMPDIR ?? tmpdir()],
  ])
  const fetched = await fetchLockedInputs({
    root: sourceRoot,
    outputRoot: inputsRoot,
  })
  const reviewed = prepareReviewedSources({ sourceRoot, inputsRoot, workRoot })
  const builder = prepareBuildkit({
    toolchain,
    builderName: options.builderName,
    assemblyRoot,
  })
  for (const id of ["skopeo", "syft", "trivy"]) {
    command(
      "docker",
      ["pull", "--platform", "linux/amd64", toolReference(toolchain, id)],
      { env: dockerEnvironment() },
    )
  }
  const trivyCacheInContainer = `/assembly/${within(assemblyRoot, trivyCache, "Trivy cache")}`
  command(
    "docker",
    [
      "run",
      "--rm",
      "--platform",
      "linux/amd64",
      "--volume",
      `${assemblyRoot}:/assembly`,
      toolReference(toolchain, "trivy"),
      "image",
      "--cache-dir",
      trivyCacheInContainer,
      "--download-db-only",
    ],
    { env: dockerEnvironment() },
  )
  const trivyDatabase = trivyDatabaseObservation(trivyCache)

  const images = []
  for (const component of buildContract.components) {
    const id = component.id
    const rawOutput = join(rawRoot, `${id}.oci.tar`)
    const layoutRoot = join(layoutsRoot, id)
    if (component.mode.endsWith("IMPORT")) {
      importImage({
        assemblyRoot,
        layoutRoot,
        reference: sourceReference(component, inventory, firecrawl),
        id,
        skopeoReference: toolReference(toolchain, "skopeo"),
      })
    } else {
      const context = buildContext(component, sourceRoot, reviewed)
      buildImage({
        sourceRoot,
        context: context.context,
        dockerfile: context.dockerfile,
        rawOutput,
        builderName: options.builderName,
        sourceDateEpoch: release.sourceDateEpoch,
      })
      extractOciTar(rawOutput, layoutRoot)
      rmSync(rawOutput)
    }
    const archive = join(imagesRoot, `${id}.oci.tar.zst`)
    const normalized = normalizeOciLayout({
      inputRoot: layoutRoot,
      outputPath: archive,
      sourceDateEpoch: release.sourceDateEpoch,
    })
    const version = imageVersion(id, inventory, options.releaseVersion)
    const scan = await scanImage({
      assemblyRoot,
      archive,
      id,
      version,
      toolchain,
      evidenceRoot,
      scansRoot,
      trivyCache,
    })
    images.push({
      id,
      ociArchivePath: `images/${basename(archive)}`,
      ociArchiveSha256: normalized.ociArchiveSha256,
      bytes: normalized.size,
      indexDigest: normalized.indexDigest,
      platform: normalized.platform,
      platformDigest: normalized.platformDigest,
      ...scan,
    })
    rmSync(layoutRoot, { recursive: true })
  }
  const inventoryDocument = {
    schema: "llm-machines.vm103-l1b-assembly-inventory.v1",
    status: "UNSIGNED_UNQUALIFIED",
    release: {
      sourceCommit: release.commit,
      sourceTree: release.tree,
      version: options.releaseVersion,
    },
    platform: "linux/amd64",
    toolchainLockSha256: await sha256File(
      resolve(sourceRoot, "infra/release/l1b/toolchain-lock.json"),
    ),
    trivyDatabase,
    images,
  }
  writeFileSync(
    join(runRoot, "assembly-inventory.json"),
    `${canonicalJson(inventoryDocument)}\n`,
    {
      mode: 0o600,
      flag: "wx",
    },
  )
  writeFileSync(
    join(runRoot, "assembly-observation.json"),
    `${JSON.stringify(
      {
        schema: "llm-machines.vm103-l1b-assembly-observation.v1",
        assembly: options.assemblyId,
        volume,
        toolchain: toolchainObservation,
        dockerRoot: builder.dockerRoot,
        buildkit: builder.reference,
        fetchedInputs: fetched.map(({ id, sha256, finalUrl }) => ({
          id,
          sha256,
          finalUrl,
        })),
      },
      null,
      2,
    )}\n`,
    { mode: 0o600, flag: "wx" },
  )
  return inventoryDocument
}

function parseArguments(argv) {
  const values = new Map()
  for (let index = 0; index < argv.length; index += 2)
    values.set(argv[index], argv[index + 1])
  const required = [
    "--assembly-root",
    "--assembly-id",
    "--source-root",
    "--expected-commit",
    "--expected-tree",
    "--release-version",
    "--builder-name",
  ]
  if (
    values.size !== required.length ||
    required.some((key) => !values.get(key))
  ) {
    fail(`expected ${required.join(" VALUE ")} VALUE`)
  }
  return {
    assemblyRoot: values.get("--assembly-root"),
    assemblyId: values.get("--assembly-id"),
    sourceRoot: values.get("--source-root"),
    expectedCommit: values.get("--expected-commit"),
    expectedTree: values.get("--expected-tree"),
    releaseVersion: values.get("--release-version"),
    builderName: values.get("--builder-name"),
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCoreAssembly(parseArguments(process.argv.slice(2)))
    .then((result) =>
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`),
    )
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error))
      process.exitCode = 1
    })
}
