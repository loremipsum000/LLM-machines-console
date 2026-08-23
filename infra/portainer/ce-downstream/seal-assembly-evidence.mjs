#!/usr/bin/env node

import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  statfsSync,
  writeFileSync,
} from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const directory = path.dirname(fileURLToPath(import.meta.url))
const defaultSourcePackage = path.join(directory, "source-package.json")
const digestPattern = /^[a-f0-9]{64}$/
const generatedNames = new Set([
  "build-environment-receipt.json",
  "build-log-receipt.json",
  "reachability-receipt.json",
  "reachability-run.exit",
  "reachability-run.stderr",
  "reachability-run.stdout",
  "reachability-run.times",
  "sealed-record.json",
])
const commonEvidencePaths = {
  evidenceInventory: "EVIDENCE-SHA256SUMS",
  buildLog: "build.log",
  builderInspectPreBuild: "builder-inspect.log",
  builderInspectPostBuild: "builder-inspect-final.log",
  builderDiskUsage: "builder-du.log",
  builderContainerSummary: "builder-container-summary.log",
  builderCleanup: "builder-cleanup.log",
  buildxAfterCleanup: "buildx-after-cleanup.log",
  filesystemAfterBuild: "filesystem-after-build.log",
  filesystemAfterCleanup: "filesystem-after-cleanup.log",
  memoryAfterBuild: "memory-after-build.log",
  memoryAfterCleanup: "memory-after-cleanup.log",
  sourceKeySha256Sums: "source-key-SHA256SUMS",
  outputSha256Sums: "output-SHA256SUMS",
  rawOciSha256Sums: "raw-oci-SHA256SUMS",
  rawOciFileInventory: "raw-oci-file-inventory.tsv",
  ociConfig: "oci-config.json",
  ociIndex: "oci-index.json",
  ociManifest: "oci-manifest.json",
  ociIdentities: "oci-identities.txt",
  reachabilityRunExit: "reachability-run.exit",
  reachabilityRunStderr: "reachability-run.stderr",
  reachabilityRunStdout: "reachability-run.stdout",
  reachabilityRunTimes: "reachability-run.times",
}
const equalEvidenceFields = [
  "sourceKeySha256Sums",
  "rawOciSha256Sums",
  "rawOciFileInventory",
  "ociConfig",
  "ociIndex",
  "ociManifest",
  "ociIdentities",
  "buildxAfterCleanup",
]

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

function canonicalBytes(value) {
  return `${JSON.stringify(JSON.parse(canonicalJson(value)), null, 2)}\n`
}

function sha256Bytes(value) {
  return createHash("sha256").update(value).digest("hex")
}

function sha256File(file) {
  return sha256Bytes(readFileSync(file))
}

function regularFile(file, label) {
  let metadata
  try {
    metadata = lstatSync(file)
  } catch {
    fail(`${label} is missing`)
  }
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1) {
    fail(`${label} must be a single-link regular file`)
  }
  return metadata
}

function evidenceFile(root, relative, { allowEmpty = false } = {}) {
  const file = path.join(root, relative)
  const metadata = regularFile(file, relative)
  if (!allowEmpty && metadata.size < 1) fail(`${relative} is empty`)
  return { path: relative, bytes: metadata.size, sha256: sha256File(file) }
}

function readJson(file, label) {
  regularFile(file, label)
  try {
    return JSON.parse(readFileSync(file, "utf8"))
  } catch {
    fail(`${label} is not valid JSON`)
  }
}

function verifyRawEvidenceInventory(root) {
  const inventoryFile = path.join(root, "EVIDENCE-SHA256SUMS")
  const inventory = readFileSync(
    regularFile(inventoryFile, "raw evidence inventory") && inventoryFile,
    "utf8",
  )
  if (!inventory.endsWith("\n")) fail("raw evidence inventory is not canonical")
  const entries = new Map()
  for (const line of inventory.trimEnd().split("\n")) {
    const match = line.match(/^([a-f0-9]{64}) {2}\.\/([^/]+)$/)
    if (!match || entries.has(match[2])) {
      fail("raw evidence inventory contains an invalid entry")
    }
    entries.set(match[2], match[1])
  }
  const listed = [...entries.keys()]
  if (canonicalJson(listed) !== canonicalJson([...listed].sort())) {
    fail("raw evidence inventory is not sorted")
  }
  const actual = readdirSync(root, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.name !== "EVIDENCE-SHA256SUMS" && !generatedNames.has(entry.name),
    )
    .map((entry) => {
      if (!entry.isFile() || entry.isSymbolicLink()) {
        fail(`unsupported raw evidence entry: ${entry.name}`)
      }
      return entry.name
    })
    .sort()
  if (canonicalJson(actual) !== canonicalJson([...entries.keys()].sort())) {
    fail("raw evidence inventory does not cover the exact evidence root")
  }
  for (const [relative, digest] of entries) {
    if (sha256File(path.join(root, relative)) !== digest) {
      fail(`raw evidence differs from its inventory: ${relative}`)
    }
  }
}

function parseBuildCommand(root) {
  const buildLog = readFileSync(path.join(root, "build.log"), "utf8")
  const line = buildLog.slice(0, buildLog.indexOf("\n"))
  let command
  try {
    command = JSON.parse(line)
  } catch {
    fail("build.log does not start with the exact command JSON")
  }
  if (
    !Array.isArray(command) ||
    command.length < 3 ||
    command[0] !== "docker" ||
    command[1] !== "buildx" ||
    command[2] !== "build" ||
    /(?:password|credential|secret|token)/i.test(command.join("\u0000")) ||
    !/#\d+ DONE [^\n]+\n$/.test(buildLog)
  ) {
    fail("build.log does not prove a successful credential-free build")
  }
  return command
}

function commandValue(command, flag) {
  const index = command.indexOf(flag)
  if (
    index < 0 ||
    index === command.length - 1 ||
    command.indexOf(flag, index + 1) >= 0
  ) {
    fail(`build command lacks one exact ${flag}`)
  }
  return command[index + 1]
}

function parseBuilderInspect(contents, builder, version) {
  const required = [
    `Name:          ${builder}`,
    "Driver:        docker-container",
    "Status:                running",
    `BuildKit version:      v${version}`,
    "Platforms:             linux/amd64",
  ]
  if (required.some((value) => !contents.includes(value))) {
    fail("builder inspection does not bind the expected BuildKit instance")
  }
}

function parseContainerStartedAt(contents, indexDigest) {
  if (!contents.includes(`moby/buildkit@${indexDigest}`)) {
    fail("builder container summary does not bind the locked BuildKit image")
  }
  const match = contents.match(
    /"(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z)"\s*$/,
  )
  if (!match || !Number.isInteger(Date.parse(match[1]))) {
    fail("builder container summary lacks a valid StartedAt")
  }
  return match[1]
}

function parseFilesystemAvailable(contents) {
  const rows = contents.trim().split("\n")
  const values = rows.at(-1)?.trim().split(/\s+/)
  const total = Number(values?.[1])
  const available = Number(values?.at(-3))
  if (
    !Number.isSafeInteger(total) ||
    total < 1 ||
    !Number.isSafeInteger(available) ||
    available < 1 ||
    available > total
  ) {
    fail("filesystem evidence lacks available bytes")
  }
  return { total, available }
}

function parseMemory(contents) {
  const rows = contents.trim().split("\n")
  const memory = rows
    .find((row) => row.startsWith("Mem:"))
    ?.trim()
    .split(/\s+/)
  const swap = rows
    .find((row) => row.startsWith("Swap:"))
    ?.trim()
    .split(/\s+/)
  const available = Number(memory?.at(-1))
  const total = Number(memory?.[1])
  const swapTotal = Number(swap?.[1])
  const swapUsed = Number(swap?.[2])
  if (
    !Number.isSafeInteger(total) ||
    total < 1 ||
    !Number.isSafeInteger(available) ||
    available < 1 ||
    available > total ||
    !Number.isSafeInteger(swapTotal) ||
    swapTotal < 0 ||
    !Number.isSafeInteger(swapUsed) ||
    swapUsed < 0 ||
    swapUsed > swapTotal
  ) {
    fail("memory evidence is invalid")
  }
  return { total, available, swapTotal, swapUsed }
}

function sourceKeyIsValid(contents, sourcePackage) {
  const inventory = sourcePackage.downstream.sourceInventory
  const expected = new Map([
    [".llmm-build/SOURCE-SHA256SUMS", inventory.sha256SumsSha256],
    ["package.json", inventory.packageJsonSha256],
    ["pnpm-lock.yaml", inventory.pnpmLockSha256],
    ["go.mod", inventory.goModSha256],
    ["go.sum", inventory.goSumSha256],
    ["webpack/webpack.common.js", inventory.webpackCommonSha256],
  ])
  const observed = new Map()
  for (const line of contents.trimEnd().split("\n")) {
    const match = line.match(/^([a-f0-9]{64}) {2}(.+)$/)
    if (!match || observed.has(match[2])) fail("source-key evidence is invalid")
    observed.set(match[2], match[1])
  }
  if (
    observed.size !== expected.size ||
    [...expected].some(([file, digest]) => observed.get(file) !== digest)
  ) {
    fail("source-key evidence differs from the source package")
  }
}

function parseReachabilityRunTimes(contents, assembly) {
  const match = contents.match(
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z) (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)\n$/,
  )
  const started = Date.parse(match?.[1])
  const finished = Date.parse(match?.[2])
  if (
    !Number.isInteger(started) ||
    !Number.isInteger(finished) ||
    started > finished
  ) {
    fail(`Assembly ${assembly} reachability run times are invalid`)
  }
  return { started, finished }
}

function currentRuntimeIdentity(sourcePackage) {
  const dockerVersion = execFileSync("docker", ["--version"], {
    encoding: "utf8",
  }).trim()
  const buildxVersion = execFileSync("docker", ["buildx", "version"], {
    encoding: "utf8",
  }).trim()
  const osRelease = Object.fromEntries(
    readFileSync("/etc/os-release", "utf8")
      .trim()
      .split("\n")
      .map((line) => {
        const [key, ...rest] = line.split("=")
        return [key, rest.join("=").replace(/^"|"$/g, "")]
      }),
  )
  const toolchain = sourcePackage.downstream.buildToolchain
  const rootFilesystem = statfsSync("/")
  const rootFilesystemBytes = rootFilesystem.blocks * rootFilesystem.bsize
  if (
    process.versions.node !== toolchain.nodeExecutor ||
    dockerVersion !==
      `Docker version ${toolchain.dockerEngine}, build a72d7cd` ||
    buildxVersion !==
      `github.com/docker/buildx ${toolchain.dockerBuildx} ${toolchain.dockerBuildx}-3` ||
    process.arch !== "x64"
  ) {
    fail("live sealing toolchain differs from the locked build toolchain")
  }
  return {
    host: {
      architecture: "amd64",
      hostname: os.hostname(),
      kernel: os.release(),
      operatingSystem: osRelease.PRETTY_NAME,
      memoryBytes: os.totalmem(),
      rootFilesystemBytes,
    },
    docker: {
      engine: toolchain.dockerEngine,
      buildx: toolchain.dockerBuildx,
    },
    buildkit: {
      version: toolchain.buildkit.version,
      platformDigest: toolchain.buildkit.platformDigest,
      configDigest: toolchain.buildkit.configDigest,
    },
  }
}

function assemblyEvidence({ assembly, root, sourcePackage, runtimeIdentity }) {
  const lower = assembly.toLowerCase()
  verifyRawEvidenceInventory(root)
  const command = parseBuildCommand(root)
  const builder = commandValue(command, "--builder")
  const output = commandValue(command, "--output")
  const dockerfile = commandValue(command, "--file")
  const sourceRoot = command.at(-1)
  const outputRoot = `/var/tmp/llmm-portainer-n4r1r2/${lower}/output`
  if (
    builder !== `llmm-portainer-n4r1r2-${lower}` ||
    sourceRoot !== `/var/tmp/llmm-portainer-n4r1r2/${lower}/source` ||
    output !==
      `type=oci,dest=${outputRoot}/raw-oci,tar=false,rewrite-timestamp=true` ||
    !dockerfile.endsWith("/infra/portainer/ce-downstream/Dockerfile") ||
    sha256File(dockerfile) !== sourcePackage.downstream.dockerfile.sha256 ||
    !command.includes("linux/amd64") ||
    !command.includes("--no-cache") ||
    !command.includes("--provenance=false") ||
    !command.includes("--sbom=false") ||
    !command.includes(
      `SOURCE_DATE_EPOCH=${sourcePackage.upstream.sourceDateEpoch}`,
    )
  ) {
    fail(`Assembly ${assembly} build command differs from the admitted recipe`)
  }
  const inspectBefore = readFileSync(
    path.join(root, "builder-inspect.log"),
    "utf8",
  )
  const inspectAfter = readFileSync(
    path.join(root, "builder-inspect-final.log"),
    "utf8",
  )
  parseBuilderInspect(
    inspectBefore,
    builder,
    sourcePackage.downstream.buildToolchain.buildkit.version,
  )
  parseBuilderInspect(
    inspectAfter,
    builder,
    sourcePackage.downstream.buildToolchain.buildkit.version,
  )
  const startedOn = parseContainerStartedAt(
    readFileSync(path.join(root, "builder-container-summary.log"), "utf8"),
    sourcePackage.downstream.buildToolchain.buildkit.indexDigest,
  )
  const finishedOn = new Date(
    Math.max(
      statSync(path.join(root, "build.log")).mtimeMs,
      statSync(path.join(root, "output-SHA256SUMS")).mtimeMs,
    ),
  ).toISOString()
  if (Date.parse(startedOn) > Date.parse(finishedOn)) {
    fail(`Assembly ${assembly} build timestamps are invalid`)
  }
  sourceKeyIsValid(
    readFileSync(path.join(root, "source-key-SHA256SUMS"), "utf8"),
    sourcePackage,
  )
  const evidencePaths = {
    ...commonEvidencePaths,
    founderInventoryBefore:
      assembly === "A"
        ? "founder-container-inventory-before-cleanup.tsv"
        : "founder-container-inventory-before.tsv",
    founderInventoryAfter:
      assembly === "A"
        ? "founder-container-inventory-after-cleanup.tsv"
        : "founder-container-inventory-after.tsv",
  }
  const evidence = Object.fromEntries(
    Object.entries(evidencePaths).map(([id, relative]) => [
      id,
      evidenceFile(root, relative, {
        allowEmpty: id === "reachabilityRunStderr",
      }),
    ]),
  )
  evidence.bootstrapLog =
    assembly === "A" ? null : evidenceFile(root, "builder-bootstrap.log")
  if (
    assembly === "A" &&
    existsSync(path.join(root, "builder-bootstrap.log"))
  ) {
    fail("Assembly A unexpectedly contains bootstrap evidence")
  }
  const filesystem = [
    "filesystem-after-build.log",
    "filesystem-after-cleanup.log",
  ].map((relative) =>
    parseFilesystemAvailable(readFileSync(path.join(root, relative), "utf8")),
  )
  const memory = ["memory-after-build.log", "memory-after-cleanup.log"].map(
    (relative) => parseMemory(readFileSync(path.join(root, relative), "utf8")),
  )
  if (
    filesystem.some(({ total }) => total !== filesystem[0].total) ||
    memory.some(
      ({ total, swapTotal }) =>
        total !== memory[0].total || swapTotal !== memory[0].swapTotal,
    ) ||
    runtimeIdentity.host.memoryBytes !== memory[0].total ||
    runtimeIdentity.host.rootFilesystemBytes !== filesystem[0].total
  ) {
    fail(`Assembly ${assembly} resource evidence differs from the sealing host`)
  }
  const environment = {
    schema: "llm-machines.portainer-ce-build-environment-receipt.v2",
    assembly,
    containsCredentials: false,
    evidenceRoot: root,
    host: {
      ...runtimeIdentity.host,
      memoryBytes: memory[0].total,
      rootFilesystemBytes: filesystem[0].total,
      swapBytes: memory[0].swapTotal,
    },
    docker: runtimeIdentity.docker,
    buildkit: runtimeIdentity.buildkit,
    independence: { builder, sourceRoot, outputRoot, cacheShared: false },
    observedResources: {
      minimumAvailableMemoryBytes: Math.min(
        ...memory.map(({ available }) => available),
      ),
      minimumAvailableRootFilesystemBytes: Math.min(
        ...filesystem.map(({ available }) => available),
      ),
      maximumSwapUsedBytes: Math.max(...memory.map(({ swapUsed }) => swapUsed)),
    },
    evidence,
  }
  const buildLog = {
    schema: "llm-machines.portainer-ce-build-log-receipt.v1",
    assembly,
    bytes: evidence.buildLog.bytes,
    command,
    containsCredentials: false,
    exitStatus: 0,
    preservedAt: `VM117:${root}/build.log`,
    sha256: evidence.buildLog.sha256,
  }
  const reachabilityFile = path.join(root, "reachability-receipt.json")
  const reachability = readJson(
    reachabilityFile,
    `Assembly ${assembly} reachability receipt`,
  )
  if (
    reachability?.schema !==
      "llm-machines.portainer-ce-reachability-receipt.v1" ||
    reachability?.assembly !== assembly ||
    reachability?.source?.root !== sourceRoot ||
    reachability?.source?.revision !== sourcePackage.upstream.revision ||
    reachability?.source?.tree !== sourcePackage.upstream.tree ||
    reachability?.source?.fileCount !==
      sourcePackage.downstream.sourceInventory.fileCount ||
    reachability?.source?.sourceInventorySha256 !==
      sourcePackage.downstream.sourceInventory.sha256SumsSha256 ||
    canonicalJson(reachability?.validator) !==
      canonicalJson({
        path: "infra/portainer/ce-downstream/validate-reachability.mjs",
        sha256: sha256File(path.join(directory, "validate-reachability.mjs")),
        nodeVersion: sourcePackage.downstream.buildToolchain.nodeExecutor,
      }) ||
    canonicalJson(reachability?.angularJsVex) !==
      canonicalJson({
        expiresAt:
          sourcePackage.downstream.frontendSecurityOverlay.angularJsVex.expiry,
        advisories:
          sourcePackage.downstream.frontendSecurityOverlay.angularJsVex
            .advisories,
      }) ||
    canonicalJson(reachability?.command) !==
      canonicalJson([
        "node",
        "infra/portainer/ce-downstream/validate-reachability.mjs",
        sourceRoot,
      ]) ||
    reachability?.exitStatus !== 0 ||
    reachability?.stdoutSha256 !==
      sha256Bytes("Portainer go-archive reachability boundary validated.\n") ||
    reachability?.stderrSha256 !== sha256Bytes("") ||
    reachability?.containsCredentials !== false ||
    canonicalJson(reachability?.guardStates) !==
      canonicalJson(
        Object.fromEntries(
          [
            "GO_ARCHIVE_DIRECT_IMPORT_ABSENT",
            "COMPOSE_COPY_ABSENT",
            "VULNERABLE_ARCHIVE_CALLS_ABSENT",
            "EXPECTED_COMPOSE_METHOD_SET_EXACT",
            "NG_SRCSET_ABSENT",
            "SCE_DELEGATE_CUSTOMIZATION_ABSENT",
            "RESOURCE_URL_LIST_CUSTOMIZATION_ABSENT",
            "TRUST_AS_RESOURCE_URL_ABSENT",
            "DYNAMIC_RESOURCE_URL_SINKS_ABSENT",
            "LODASH_MODULE_REPLACEMENT_PLUGIN_ABSENT",
            "DOCKER_COMPOSE_SCHEMA_SOURCE_CONTROLLED_NO_RUNTIME_FETCH",
          ].map((guard) => [guard, true]),
        ),
      ) ||
    !Array.isArray(reachability?.errors) ||
    reachability.errors.length !== 0
  ) {
    fail(`Assembly ${assembly} reachability receipt is inadmissible`)
  }
  const reachabilityRunTimes = parseReachabilityRunTimes(
    readFileSync(path.join(root, "reachability-run.times"), "utf8"),
    assembly,
  )
  const evaluatedAt = Date.parse(reachability.evaluatedAt)
  if (
    readFileSync(path.join(root, "reachability-run.exit"), "utf8") !== "0\n" ||
    evidence.reachabilityRunStderr.bytes !== 0 ||
    evidence.reachabilityRunStderr.sha256 !== reachability.stderrSha256 ||
    evidence.reachabilityRunStdout.sha256 !== sha256File(reachabilityFile) ||
    !readFileSync(path.join(root, "reachability-run.stdout")).equals(
      readFileSync(reachabilityFile),
    ) ||
    !Number.isInteger(evaluatedAt) ||
    evaluatedAt < reachabilityRunTimes.started ||
    evaluatedAt > reachabilityRunTimes.finished
  ) {
    fail(`Assembly ${assembly} reachability run evidence is inadmissible`)
  }
  return {
    assembly,
    root,
    startedOn,
    finishedOn,
    environment,
    buildLog,
    reachabilityFile,
  }
}

function writeNoReplace(file, value) {
  writeFileSync(file, canonicalBytes(value), { flag: "wx", mode: 0o600 })
}

function sealedDocuments(assembly, sourcePackage) {
  const buildLogBytes = canonicalBytes(assembly.buildLog)
  const environmentBytes = canonicalBytes(assembly.environment)
  const links = [
    {
      id: "build-log",
      path: "build-log-receipt.json",
      sha256: sha256Bytes(buildLogBytes),
    },
    {
      id: "build-environment",
      path: "build-environment-receipt.json",
      sha256: sha256Bytes(environmentBytes),
    },
    {
      id: "source-reachability",
      path: "reachability-receipt.json",
      sha256: sha256File(assembly.reachabilityFile),
    },
  ]
  const record = {
    schema: "llm-machines.portainer-ce-sealed-assembly.v1",
    assembly: assembly.assembly,
    source: {
      revision: sourcePackage.upstream.revision,
      tree: sourcePackage.upstream.tree,
      archiveSha256: sourcePackage.upstream.archiveSha256,
      sourceInventorySha256:
        sourcePackage.downstream.sourceInventory.sha256SumsSha256,
      patchSha256: sourcePackage.downstream.patch.sha256,
      dockerfileSha256: sourcePackage.downstream.dockerfile.sha256,
      dockerignoreSha256: sourcePackage.downstream.dockerignore.sha256,
    },
    build: {
      startedOn: assembly.startedOn,
      finishedOn: assembly.finishedOn,
      platform: "linux/amd64",
      buildkitPlatformDigest:
        sourcePackage.downstream.buildToolchain.buildkit.platformDigest,
    },
    evidence: links,
  }
  return {
    record,
    files: [
      ["build-log-receipt.json", assembly.buildLog],
      ["build-environment-receipt.json", assembly.environment],
      ["sealed-record.json", record],
    ],
  }
}

function writeSealedPair(plans) {
  const destinations = plans.flatMap(({ root, files }) =>
    files.map(([relative, value]) => ({
      destination: path.join(root, relative),
      value,
    })),
  )
  for (const { destination } of destinations) {
    if (existsSync(destination)) fail(`${destination} already exists`)
  }
  const temporary = []
  try {
    for (const { destination, value } of destinations) {
      const temp = `${destination}.tmp-${process.pid}`
      writeNoReplace(temp, value)
      temporary.push([temp, destination])
    }
    for (const [temp, destination] of temporary) renameSync(temp, destination)
  } catch (error) {
    for (const [temp] of temporary) rmSync(temp, { force: true })
    throw error
  }
}

export function sealAssemblyEvidencePair({
  assemblyARoot,
  assemblyBRoot,
  sourcePackagePath = defaultSourcePackage,
  runtimeIdentity,
}) {
  const sourcePackage = readJson(sourcePackagePath, "source package")
  const identity = runtimeIdentity ?? currentRuntimeIdentity(sourcePackage)
  const assemblyA = assemblyEvidence({
    assembly: "A",
    root: path.resolve(assemblyARoot),
    sourcePackage,
    runtimeIdentity: identity,
  })
  const assemblyB = assemblyEvidence({
    assembly: "B",
    root: path.resolve(assemblyBRoot),
    sourcePackage,
    runtimeIdentity: identity,
  })
  if (
    assemblyA.root === assemblyB.root ||
    assemblyA.environment.independence.sourceRoot ===
      assemblyB.environment.independence.sourceRoot ||
    assemblyA.environment.independence.outputRoot ===
      assemblyB.environment.independence.outputRoot ||
    assemblyA.environment.independence.builder ===
      assemblyB.environment.independence.builder ||
    Date.parse(assemblyA.finishedOn) > Date.parse(assemblyB.startedOn) ||
    equalEvidenceFields.some(
      (field) =>
        canonicalJson(assemblyA.environment.evidence[field]) !==
        canonicalJson(assemblyB.environment.evidence[field]),
    ) ||
    [assemblyA, assemblyB].some(
      (assembly) =>
        assembly.environment.evidence.founderInventoryBefore.sha256 !==
        assembly.environment.evidence.founderInventoryAfter.sha256,
    ) ||
    assemblyA.environment.evidence.founderInventoryBefore.sha256 !==
      assemblyB.environment.evidence.founderInventoryBefore.sha256
  ) {
    fail("Assembly A and B raw evidence does not prove independent equality")
  }
  const sealedA = sealedDocuments(assemblyA, sourcePackage)
  const sealedB = sealedDocuments(assemblyB, sourcePackage)
  writeSealedPair([
    { root: assemblyA.root, files: sealedA.files },
    { root: assemblyB.root, files: sealedB.files },
  ])
  return { A: sealedA.record, B: sealedB.record }
}

function parseArguments(argv) {
  if (argv.length % 2 !== 0) fail("arguments must be key/value pairs")
  const values = new Map()
  for (let index = 0; index < argv.length; index += 2) {
    if (!argv[index]?.startsWith("--") || values.has(argv[index])) {
      fail("arguments are invalid or duplicated")
    }
    values.set(argv[index], argv[index + 1])
  }
  const allowed = new Set([
    "--assembly-a-root",
    "--assembly-b-root",
    "--source-package",
  ])
  if ([...values.keys()].some((key) => !allowed.has(key))) {
    fail("unknown argument")
  }
  for (const required of ["--assembly-a-root", "--assembly-b-root"]) {
    if (!values.get(required)) fail(`${required} is required`)
  }
  return {
    assemblyARoot: values.get("--assembly-a-root"),
    assemblyBRoot: values.get("--assembly-b-root"),
    sourcePackagePath: values.get("--source-package") ?? defaultSourcePackage,
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    sealAssemblyEvidencePair(parseArguments(process.argv.slice(2)))
    process.stdout.write("Portainer Assembly A/B evidence sealed.\n")
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  }
}
