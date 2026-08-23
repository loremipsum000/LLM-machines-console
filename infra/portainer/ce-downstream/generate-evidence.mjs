#!/usr/bin/env node

import { createHash } from "node:crypto"
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path"
import { fileURLToPath } from "node:url"
import { gunzipSync, inflateRawSync } from "node:zlib"

import {
  readArchiveEntry,
  withDeterministicArchive,
} from "../../release/deterministic-archive.mjs"
import { inspectOciArchive } from "../../release/inspect-oci-archive.mjs"

const directory = dirname(fileURLToPath(import.meta.url))
const defaultSourcePackagePath = join(directory, "source-package.json")
const digestPattern = /^[a-f0-9]{64}$/
const ociDigestPattern = /^sha256:[a-f0-9]{64}$/
const safeRelativePathPattern = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/
const maximumFrontendLayerBytes = 512 * 1024 * 1024
const packagePurlPattern = /^pkg:(?:golang|npm)\/[^\s]+$/
const spdxExpressionPattern = /^[A-Za-z0-9.+() -]+$/
const reachabilityValidatorPath =
  "infra/portainer/ce-downstream/validate-reachability.mjs"
const evidenceToolingPaths = {
  assemblySealer: "infra/portainer/ce-downstream/seal-assembly-evidence.mjs",
  reachabilityReceiptGenerator:
    "infra/portainer/ce-downstream/generate-reachability-receipt.mjs",
}
const reachabilityGuardNames = [
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
]
const commercialIdentifierPatterns = [
  /(?:^|[/:@._-])portainer[-_](?:be|ee|business|enterprise)(?:$|[/:@._-])/i,
  /(?:^|[/:@._-])portainer[-_](?:commercial|trial)[-_]license(?:$|[/:@._-])/i,
  /(?:^|[/:@._-])(?:business|enterprise)[-_]edition(?:$|[/:@._-])/i,
  /^LicenseRef-(?:Proprietary|Commercial|Portainer[-_](?:BE|EE|Business|Enterprise))$/i,
  /^PORTAINER_(?:BE|EE|BUSINESS|ENTERPRISE|LICENSE)(?:_|$)/i,
  /(?:^|[/:@._-])portainer\.lic(?:$|[/:@._-])/i,
  /github\.com\/portainer\/portainer\/(?:ee|be|business|enterprise)(?:\/|$)/i,
  /(?:^|\/)portainer\/(?:ee|be|business|enterprise)(?:\/|$)/i,
]

function fail(message) {
  throw new Error(message)
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
}

function sha256Bytes(value) {
  return createHash("sha256").update(value).digest("hex")
}

function sha256File(file) {
  return sha256Bytes(readFileSync(file))
}

function verifySubresourceIntegrity(file, integrity, field) {
  if (typeof integrity !== "string" || integrity.length === 0) {
    fail(`${field} integrity is missing`)
  }
  const archive = readFileSync(file)
  const entries = integrity.split(/\s+/)
  if (entries.length !== 1) {
    fail(`${field} integrity must contain one exact digest`)
  }
  const match = entries[0].match(
    /^(sha256|sha384|sha512)-([A-Za-z0-9+/]+={0,2})$/,
  )
  if (
    !match ||
    createHash(match[1]).update(archive).digest("base64") !== match[2]
  ) {
    fail(`${field} integrity differs from the sealed archive`)
  }
}

function requireRegularFile(file, field) {
  let metadata
  try {
    metadata = lstatSync(file)
  } catch {
    fail(`${field} is missing`)
  }
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1) {
    fail(`${field} must be a single-link regular file`)
  }
  return metadata
}

function readJson(file, field) {
  requireRegularFile(file, field)
  try {
    return JSON.parse(readFileSync(file, "utf8"))
  } catch {
    fail(`${field} is not valid JSON`)
  }
}

function exactKeys(value, keys, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${field} must be an object`)
  }
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`${field} keys must be exactly ${expected.join(", ")}`)
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

export function isCommercialPortainerIdentifier(value) {
  if (typeof value !== "string" || value.length === 0) return false
  let decoded = value
  try {
    decoded = decodeURIComponent(value)
  } catch {
    // A malformed encoded identifier remains searchable in its original form.
  }
  return commercialIdentifierPatterns.some((pattern) => pattern.test(decoded))
}

function requireNoCommercialIdentifiers(values, field) {
  if (
    values.flat(Number.POSITIVE_INFINITY).some(isCommercialPortainerIdentifier)
  ) {
    fail(`${field} contains a commercial Portainer identifier`)
  }
}

function componentIdentifiers(component) {
  const licenses = Array.isArray(component?.licenses) ? component.licenses : []
  const properties = Array.isArray(component?.properties)
    ? component.properties
    : []
  return [
    component?.["bom-ref"],
    component?.name,
    component?.group,
    component?.purl,
    component?.cpe,
    ...licenses.flatMap((entry) => [
      entry?.license?.id,
      entry?.license?.name,
      entry?.expression,
    ]),
    ...properties.flatMap((property) => [
      property?.name,
      /(?:edition|license|package|module|component|artifact|path)/i.test(
        property?.name ?? "",
      )
        ? property?.value
        : null,
    ]),
  ]
}

function runtimeConfigIdentifiers(config) {
  const labels = Object.entries(config?.Labels ?? {})
  return [
    config?.Cmd ?? [],
    config?.Entrypoint ?? [],
    config?.Env ?? [],
    Object.keys(config?.ExposedPorts ?? {}),
    Object.keys(config?.Volumes ?? {}),
    config?.User,
    config?.WorkingDir,
    ...labels.flatMap(([key, value]) => [
      key,
      /(?:edition|license|package|module|component|artifact|image\.(?:title|ref\.name))/i.test(
        key,
      )
        ? value
        : null,
    ]),
  ]
}

function sourcePackageIdentifiers(sourcePackage) {
  const upstream = sourcePackage?.upstream
  const downstream = sourcePackage?.downstream
  return [
    upstream?.repository,
    upstream?.archiveFile,
    upstream?.archiveRoot,
    upstream?.archiveUrl,
    upstream?.license,
    upstream?.officialImage?.repository,
    upstream?.officialImage?.version,
    downstream?.version,
    downstream?.mirrorRepository,
    downstream?.patch?.path,
    downstream?.dockerfile?.path,
    downstream?.dockerignore?.path,
    downstream?.licenseCopy?.path,
    downstream?.attributionsCopy?.path,
    downstream?.notice?.path,
    downstream?.licenseReview?.path,
    ...(downstream?.buildInputs ?? []).flatMap((input) => [
      input?.id,
      input?.repository,
      input?.version,
    ]),
  ]
}

export function sourcePackageContractProjection(sourcePackage) {
  const downstream = Object.fromEntries(
    Object.entries(clone(sourcePackage?.downstream ?? {})).filter(
      ([key]) => key !== "artifactEvidence",
    ),
  )
  return {
    schema: sourcePackage?.schema,
    status: sourcePackage?.status,
    accepted: sourcePackage?.accepted,
    runtimeQualified: sourcePackage?.runtimeQualified,
    contractActivation: sourcePackage?.contractActivation,
    containsCredentials: sourcePackage?.containsCredentials,
    productIntegrated: sourcePackage?.productIntegrated,
    upstream: clone(sourcePackage?.upstream),
    downstream,
    admissionBoundary: clone(sourcePackage?.admissionBoundary),
    activationPreconditions: clone(sourcePackage?.activationPreconditions),
  }
}

function validateGenerationSourcePackage(sourcePackage, sourcePackagePath) {
  const repositoryRoot = resolve(dirname(sourcePackagePath), "../../..")
  const upstream = sourcePackage?.upstream
  const downstream = sourcePackage?.downstream
  if (
    sourcePackage?.schema !==
      "llm-machines.portainer-ce-downstream-source.v1" ||
    sourcePackage?.status !==
      "SOURCE_SECURITY_CHARACTERIZED_NOT_CORE_ADMITTED" ||
    sourcePackage?.accepted !== false ||
    sourcePackage?.runtimeQualified !== false ||
    sourcePackage?.contractActivation !== "INACTIVE" ||
    sourcePackage?.containsCredentials !== false ||
    sourcePackage?.productIntegrated !== false ||
    !/^[a-f0-9]{40}$/.test(upstream?.revision ?? "") ||
    !/^[a-f0-9]{40}$/.test(upstream?.tree ?? "") ||
    !digestPattern.test(upstream?.archiveSha256 ?? "") ||
    downstream?.version !== "2.39.6-llmm.1" ||
    downstream?.platform !== "linux/amd64" ||
    downstream?.mirrorRepository !== "core/portainer-ce-downstream" ||
    !Array.isArray(downstream?.buildInputs) ||
    downstream.buildInputs.length === 0 ||
    downstream.buildInputs.some(
      (input) =>
        input?.platform !== "linux/amd64" ||
        !ociDigestPattern.test(input?.indexDigest ?? "") ||
        !ociDigestPattern.test(input?.platformDigest ?? "") ||
        /(?:^|[/:._-])(?:latest|main|master|stable|edge)(?:$|[/:._-])/i.test(
          `${input?.repository}:${input?.version}`,
        ),
    ) ||
    !ociDigestPattern.test(
      downstream?.buildToolchain?.buildkit?.platformDigest ?? "",
    )
  ) {
    fail("source package identity is incomplete, mutable, or not R1-scoped")
  }
  for (const [entry, field] of [
    [downstream.patch, "security patch"],
    [downstream.dockerfile, "Dockerfile"],
    [downstream.dockerignore, "Dockerignore"],
  ]) {
    if (
      typeof entry?.path !== "string" ||
      !digestPattern.test(entry?.sha256 ?? "")
    ) {
      fail(`source package ${field} identity is invalid`)
    }
    const file = resolve(repositoryRoot, entry.path)
    const fileRelative = relative(repositoryRoot, file)
    if (
      fileRelative.startsWith(`..${sep}`) ||
      fileRelative === ".." ||
      sha256File(file) !== entry.sha256
    ) {
      fail(`source package ${field} differs from its SHA-256`)
    }
  }
  exactKeys(
    downstream.evidenceTooling,
    Object.keys(evidenceToolingPaths),
    "source package evidence tooling",
  )
  for (const [id, expectedPath] of Object.entries(evidenceToolingPaths)) {
    const entry = downstream.evidenceTooling[id]
    exactKeys(entry, ["path", "sha256"], `source package ${id}`)
    const file = resolve(repositoryRoot, entry.path)
    const fileRelative = relative(repositoryRoot, file)
    if (
      entry.path !== expectedPath ||
      !digestPattern.test(entry.sha256 ?? "") ||
      fileRelative !== expectedPath ||
      sha256File(file) !== entry.sha256
    ) {
      fail(`source package ${id} differs from its exact producer identity`)
    }
  }
  requireNoCommercialIdentifiers(
    sourcePackageIdentifiers(sourcePackage),
    "source package",
  )
}

function normalizeIsoTimestamp(value, field) {
  const milliseconds = Date.parse(value)
  if (!Number.isInteger(milliseconds)) fail(`${field} is not an ISO timestamp`)
  return new Date(milliseconds).toISOString()
}

function requireSafeRelativePath(value, field) {
  if (
    typeof value !== "string" ||
    !safeRelativePathPattern.test(value) ||
    value.startsWith("/") ||
    value
      .split("/")
      .some((part) => part === "" || part === "." || part === "..")
  ) {
    fail(`${field} is not a safe relative path`)
  }
}

function requireSafeSourceRelativePath(value, field) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.startsWith("/") ||
    value.includes("\\") ||
    /[\0\r\n]/.test(value) ||
    value
      .split("/")
      .some((part) => part === "" || part === "." || part === "..")
  ) {
    fail(`${field} is not a safe relative source path`)
  }
}

function resolveRecordFile(recordPath, entry, field) {
  exactKeys(entry, ["id", "path", "sha256"], field)
  if (
    typeof entry.id !== "string" ||
    entry.id.length === 0 ||
    !digestPattern.test(entry.sha256 ?? "")
  ) {
    fail(`${field} identity is invalid`)
  }
  requireSafeRelativePath(entry.path, `${field} path`)
  const recordRoot = dirname(resolve(recordPath))
  const file = resolve(recordRoot, entry.path)
  const fileRelative = relative(recordRoot, file)
  if (fileRelative.startsWith(`..${sep}`) || fileRelative === "..") {
    fail(`${field} path escapes its sealed assembly root`)
  }
  requireRegularFile(file, field)
  if (sha256File(file) !== entry.sha256) fail(`${field} SHA-256 differs`)
  return { id: entry.id, path: entry.path, sha256: entry.sha256, file }
}

function validateReachabilityReceipt({
  receipt,
  assembly,
  sourceRoot,
  sourcePackage,
  startedOn,
  receiptSha256,
}) {
  exactKeys(
    receipt,
    [
      "schema",
      "assembly",
      "source",
      "validator",
      "evaluatedAt",
      "angularJsVex",
      "command",
      "exitStatus",
      "stdoutSha256",
      "stderrSha256",
      "containsCredentials",
      "guardStates",
      "errors",
    ],
    `Assembly ${assembly} reachability receipt`,
  )
  exactKeys(
    receipt.source,
    ["root", "revision", "tree", "fileCount", "sourceInventorySha256"],
    `Assembly ${assembly} reachability source`,
  )
  exactKeys(
    receipt.validator,
    ["path", "sha256", "nodeVersion"],
    `Assembly ${assembly} reachability validator`,
  )
  exactKeys(
    receipt.angularJsVex,
    ["expiresAt", "advisories"],
    `Assembly ${assembly} AngularJS VEX`,
  )
  exactKeys(
    receipt.guardStates,
    reachabilityGuardNames,
    `Assembly ${assembly} reachability guard states`,
  )
  const evaluatedAt = normalizeIsoTimestamp(
    receipt.evaluatedAt,
    `Assembly ${assembly} reachability evaluatedAt`,
  )
  const overlay = sourcePackage.downstream.frontendSecurityOverlay.angularJsVex
  const validatorSha256 = sha256File(
    join(directory, basename(reachabilityValidatorPath)),
  )
  if (
    receipt.schema !== "llm-machines.portainer-ce-reachability-receipt.v1" ||
    receipt.assembly !== assembly ||
    receipt.source.root !== sourceRoot ||
    receipt.source.revision !== sourcePackage.upstream.revision ||
    receipt.source.tree !== sourcePackage.upstream.tree ||
    receipt.source.fileCount !==
      sourcePackage.downstream.sourceInventory.fileCount ||
    receipt.source.sourceInventorySha256 !==
      sourcePackage.downstream.sourceInventory.sha256SumsSha256 ||
    receipt.validator.path !== reachabilityValidatorPath ||
    receipt.validator.sha256 !== validatorSha256 ||
    receipt.validator.nodeVersion !==
      sourcePackage.downstream.buildToolchain.nodeExecutor ||
    receipt.angularJsVex.expiresAt !== overlay.expiry ||
    canonicalJson(receipt.angularJsVex.advisories) !==
      canonicalJson(overlay.advisories) ||
    Date.parse(evaluatedAt) < Date.parse(startedOn) ||
    Date.parse(evaluatedAt) > Date.parse(receipt.angularJsVex.expiresAt) ||
    canonicalJson(receipt.command) !==
      canonicalJson(["node", reachabilityValidatorPath, sourceRoot]) ||
    receipt.exitStatus !== 0 ||
    receipt.stdoutSha256 !==
      sha256Bytes("Portainer go-archive reachability boundary validated.\n") ||
    receipt.stderrSha256 !== sha256Bytes("") ||
    receipt.containsCredentials !== false ||
    Object.values(receipt.guardStates).some((value) => value !== true) ||
    !Array.isArray(receipt.errors) ||
    receipt.errors.length !== 0
  ) {
    fail(`Assembly ${assembly} reachability receipt is inadmissible`)
  }
  return {
    receiptSha256,
    evaluatedAt,
    sourceRoot,
    validator: clone(receipt.validator),
    angularJsVex: clone(receipt.angularJsVex),
    guardStates: clone(receipt.guardStates),
  }
}

function validateAssemblyRecord(record, recordPath, assembly, sourcePackage) {
  exactKeys(
    record,
    ["schema", "assembly", "source", "build", "evidence"],
    `Assembly ${assembly} record`,
  )
  exactKeys(
    record.source,
    [
      "revision",
      "tree",
      "archiveSha256",
      "sourceInventorySha256",
      "dockerfileSha256",
      "dockerignoreSha256",
      "patchSha256",
    ],
    `Assembly ${assembly} source`,
  )
  exactKeys(
    record.build,
    ["platform", "buildkitPlatformDigest", "startedOn", "finishedOn"],
    `Assembly ${assembly} build`,
  )
  const inventory = sourcePackage.downstream.sourceInventory
  const expectedSource = {
    revision: sourcePackage.upstream.revision,
    tree: sourcePackage.upstream.tree,
    archiveSha256: sourcePackage.upstream.archiveSha256,
    sourceInventorySha256: inventory.sha256SumsSha256,
    dockerfileSha256: sourcePackage.downstream.dockerfile.sha256,
    dockerignoreSha256: sourcePackage.downstream.dockerignore.sha256,
    patchSha256: sourcePackage.downstream.patch.sha256,
  }
  const startedOn = normalizeIsoTimestamp(
    record.build.startedOn,
    `Assembly ${assembly} startedOn`,
  )
  const finishedOn = normalizeIsoTimestamp(
    record.build.finishedOn,
    `Assembly ${assembly} finishedOn`,
  )
  if (
    record.schema !== "llm-machines.portainer-ce-sealed-assembly.v1" ||
    record.assembly !== assembly ||
    canonicalJson(record.source) !== canonicalJson(expectedSource) ||
    record.build.platform !== sourcePackage.downstream.platform ||
    record.build.buildkitPlatformDigest !==
      sourcePackage.downstream.buildToolchain.buildkit.platformDigest ||
    Date.parse(startedOn) > Date.parse(finishedOn) ||
    !Array.isArray(record.evidence) ||
    record.evidence.length !== 3
  ) {
    fail(`Assembly ${assembly} record does not bind the admitted build`)
  }
  const resolvedEvidence = record.evidence.map((entry, index) =>
    resolveRecordFile(
      recordPath,
      entry,
      `Assembly ${assembly} evidence ${index + 1}`,
    ),
  )
  const byId = new Map(resolvedEvidence.map((entry) => [entry.id, entry]))
  const expectedEvidence = new Map([
    ["build-log", "build-log-receipt.json"],
    ["build-environment", "build-environment-receipt.json"],
    ["source-reachability", "reachability-receipt.json"],
  ])
  if (
    byId.size !== resolvedEvidence.length ||
    byId.size !== expectedEvidence.size ||
    [...expectedEvidence].some(
      ([id, path]) => !byId.has(id) || byId.get(id).path !== path,
    )
  ) {
    fail(`Assembly ${assembly} evidence is incomplete or duplicated`)
  }
  const environment = readJson(
    byId.get("build-environment").file,
    `Assembly ${assembly} build environment`,
  )
  const sourceRoot = environment?.independence?.sourceRoot
  if (
    typeof sourceRoot !== "string" ||
    sourceRoot.length === 0 ||
    !isAbsolute(sourceRoot) ||
    /[\0\r\n]/.test(sourceRoot)
  ) {
    fail(`Assembly ${assembly} build environment source root is invalid`)
  }
  const reachabilityLink = byId.get("source-reachability")
  const reachability = validateReachabilityReceipt({
    receipt: readJson(
      reachabilityLink.file,
      `Assembly ${assembly} reachability receipt`,
    ),
    assembly,
    sourceRoot,
    sourcePackage,
    startedOn,
    receiptSha256: reachabilityLink.sha256,
  })
  const evidence = resolvedEvidence
    .map(({ file: _file, ...entry }) => entry)
    .sort((left, right) => compareText(left.id, right.id))
  return {
    schema: record.schema,
    assembly,
    source: expectedSource,
    build: {
      platform: record.build.platform,
      buildkitPlatformDigest: record.build.buildkitPlatformDigest,
      startedOn,
      finishedOn,
    },
    evidence,
    reachability,
  }
}

function readOciMetadata(archivePath) {
  const inspection = inspectOciArchive(archivePath)
  const entries = new Map()
  withDeterministicArchive(archivePath, (entry) => {
    if (
      entry.type === "file" &&
      (entry.path === "index.json" || entry.path.startsWith("blobs/sha256/")) &&
      entry.size <= 8 * 1024 * 1024
    ) {
      entries.set(entry.path, readArchiveEntry(entry))
    }
  })
  const readDocument = (entry, field) => {
    try {
      return JSON.parse(entry.toString("utf8"))
    } catch {
      fail(`${field} is not valid JSON`)
    }
  }
  const index = readDocument(entries.get("index.json"), "OCI index")
  const descriptor = index.manifests[0]
  const manifest = readDocument(
    entries.get(`blobs/sha256/${descriptor.digest.slice(7)}`),
    "OCI manifest",
  )
  const configDigest = manifest.config.digest
  const config = readDocument(
    entries.get(`blobs/sha256/${configDigest.slice(7)}`),
    "OCI config",
  )
  const runtimeInventory = {
    architecture: config.architecture,
    os: config.os,
    config: {
      Cmd: config.config?.Cmd ?? null,
      Entrypoint: config.config?.Entrypoint ?? null,
      Env: [...(config.config?.Env ?? [])].sort(),
      ExposedPorts: Object.keys(config.config?.ExposedPorts ?? {}).sort(),
      Labels: Object.fromEntries(
        Object.entries(config.config?.Labels ?? {}).sort(([left], [right]) =>
          compareText(left, right),
        ),
      ),
      StopSignal: config.config?.StopSignal ?? null,
      User: config.config?.User ?? "",
      Volumes: Object.keys(config.config?.Volumes ?? {}).sort(),
      WorkingDir: config.config?.WorkingDir ?? "",
    },
    rootfs: {
      type: config.rootfs.type,
      diffIds: config.rootfs.diff_ids,
    },
    layers: manifest.layers.map(({ digest, mediaType, size }) => ({
      digest,
      mediaType,
      size,
    })),
  }
  requireNoCommercialIdentifiers(
    runtimeConfigIdentifiers(runtimeInventory.config),
    "OCI runtime inventory",
  )
  return {
    ociArchiveSha256: inspection.ociArchiveSha256.slice(7),
    ociArchiveBytes: requireRegularFile(archivePath, "OCI assembly archive")
      .size,
    indexDigest: inspection.indexDigest,
    manifestDigest: inspection.platformDigest,
    configDigest,
    platform: inspection.platform,
    layers: runtimeInventory.layers,
    runtimeInventory,
    runtimeInventorySha256: sha256Bytes(`${canonicalJson(runtimeInventory)}\n`),
  }
}

function readTarField(header, start, length) {
  const value = header.subarray(start, start + length)
  const end = value.indexOf(0)
  return value
    .subarray(0, end === -1 ? value.length : end)
    .toString("utf8")
    .trim()
}

function readTarOctal(header, start, length, field) {
  const value = readTarField(header, start, length)
  if (!/^[0-7]+$/.test(value)) fail(`frontend layer ${field} is invalid`)
  return Number.parseInt(value, 8)
}

function readTarEntries(layer) {
  const entries = []
  const seen = new Set()
  let offset = 0
  let zeroBlocks = 0
  while (offset + 512 <= layer.length) {
    const header = layer.subarray(offset, offset + 512)
    offset += 512
    if (header.every((byte) => byte === 0)) {
      zeroBlocks += 1
      if (zeroBlocks >= 2) {
        if (!layer.subarray(offset).every((byte) => byte === 0)) {
          fail("frontend layer contains data after its terminal blocks")
        }
        offset = layer.length
        break
      }
      continue
    }
    if (zeroBlocks !== 0) fail("frontend layer has an interior zero block")
    const expectedChecksum = readTarOctal(header, 148, 8, "checksum")
    const checksumHeader = Buffer.from(header)
    checksumHeader.fill(0x20, 148, 156)
    if (
      checksumHeader.reduce((total, byte) => total + byte, 0) !==
      expectedChecksum
    ) {
      fail("frontend layer checksum differs")
    }
    const magic = header.subarray(257, 263).toString("utf8")
    if (magic !== "ustar\0" && magic !== "ustar ") {
      fail("frontend layer is not USTAR")
    }
    const name = readTarField(header, 0, 100)
    const prefix = readTarField(header, 345, 155)
    const path = prefix ? `${prefix}/${name}` : name
    const normalizedPath = path.endsWith("/") ? path.slice(0, -1) : path
    requireSafeRelativePath(normalizedPath, "frontend layer path")
    if (seen.has(normalizedPath)) {
      fail(`frontend layer contains duplicate path: ${normalizedPath}`)
    }
    seen.add(normalizedPath)
    const size = readTarOctal(header, 124, 12, "entry size")
    const typeFlag = String.fromCharCode(header[156])
    const type = typeFlag === "\0" || typeFlag === "0" ? "file" : typeFlag
    if (type !== "file" && type !== "5") {
      fail(`frontend layer contains unsupported entry: ${normalizedPath}`)
    }
    if (type === "5" && size !== 0) {
      fail(`frontend layer directory has contents: ${normalizedPath}`)
    }
    if (offset + size > layer.length) fail("frontend layer is truncated")
    entries.push({
      path: normalizedPath,
      type: type === "file" ? "file" : "directory",
      contents: type === "file" ? layer.subarray(offset, offset + size) : null,
    })
    offset += size + ((512 - (size % 512)) % 512)
  }
  if (zeroBlocks < 2 || offset !== layer.length) {
    fail("frontend layer is missing its terminal blocks")
  }
  return entries
}

function readFrontendLayer(archivePath, artifact) {
  if (artifact.layers.length !== 1) {
    fail("Portainer frontend evidence requires one exact runtime layer")
  }
  const descriptor = artifact.layers[0]
  const layerPath = `blobs/sha256/${descriptor.digest.slice(7)}`
  let compressed
  withDeterministicArchive(archivePath, (entry) => {
    if (entry.path === layerPath) compressed = readArchiveEntry(entry)
  })
  if (!compressed) fail("Portainer frontend runtime layer is missing")
  let layer
  if (descriptor.mediaType === "application/vnd.oci.image.layer.v1.tar+gzip") {
    try {
      layer = gunzipSync(compressed, {
        maxOutputLength: maximumFrontendLayerBytes,
      })
    } catch {
      fail("Portainer frontend runtime layer is not valid bounded gzip")
    }
  } else if (
    descriptor.mediaType === "application/vnd.oci.image.layer.v1.tar"
  ) {
    layer = compressed
  } else {
    fail("Portainer frontend runtime layer compression is unsupported")
  }
  if (layer.length > maximumFrontendLayerBytes) {
    fail("Portainer frontend runtime layer exceeds its evidence limit")
  }
  if (
    `sha256:${sha256Bytes(layer)}` !==
    artifact.runtimeInventory.rootfs.diffIds[0]
  ) {
    fail("Portainer frontend runtime layer differs from its DiffID")
  }
  return readTarEntries(layer)
}

function frontendPackageObservation(source, sourceMapPath) {
  const match = source.match(
    /\/node_modules\/\.pnpm\/([^/]+)\/node_modules\/((?:@[^/]+\/)?[^/]+)/,
  )
  if (!match) return null
  const storeKey = match[1]
  const name = match[2]
  const encodedName = name.replace("/", "+")
  if (!storeKey.startsWith(`${encodedName}@`)) {
    fail(`frontend source map package identity differs: ${sourceMapPath}`)
  }
  requireNoCommercialIdentifiers(
    [name, storeKey, source],
    "frontend source-map package",
  )
  return { name, storeKey }
}

function frontendRuntimeInventory(archivePath, artifact) {
  const layerEntries = readFrontendLayer(archivePath, artifact)
  const portainer = layerEntries.find(
    ({ path, type }) => path === "portainer" && type === "file",
  )
  if (!portainer) fail("runtime image lacks the /portainer executable")
  const publicEntries = layerEntries
    .filter(({ path, type }) => type === "file" && path.startsWith("public/"))
    .map(({ path, contents }) => ({
      path: path.slice("public/".length),
      bytes: contents.length,
      sha256: sha256Bytes(contents),
      contents,
    }))
    .sort((left, right) => compareText(left.path, right.path))
  if (publicEntries.length === 0) fail("runtime image has no /public files")
  const javascript = publicEntries.filter(({ path }) => path.endsWith(".js"))
  const sourceMapFiles = publicEntries.filter(({ path }) =>
    path.endsWith(".map"),
  )
  if (
    javascript.length === 0 ||
    sourceMapFiles.length === 0 ||
    javascript.some(
      ({ path }) =>
        !publicEntries.some((entry) => entry.path === `${path}.map`),
    )
  ) {
    fail("runtime /public JavaScript lacks complete source-map evidence")
  }
  const observations = new Map()
  const sourceMaps = sourceMapFiles.map((entry) => {
    let document
    try {
      document = JSON.parse(entry.contents.toString("utf8"))
    } catch {
      fail(`runtime source map is not valid JSON: ${entry.path}`)
    }
    if (!Array.isArray(document.sources) || document.sources.length === 0) {
      fail(`runtime source map has no sources: ${entry.path}`)
    }
    for (const source of document.sources) {
      if (typeof source !== "string" || source.length === 0) {
        fail(`runtime source map has an invalid source: ${entry.path}`)
      }
      const observed = frontendPackageObservation(source, entry.path)
      if (!observed) continue
      const key = `${observed.name}\u0000${observed.storeKey}`
      const current = observations.get(key) ?? {
        ...observed,
        sourceMapPaths: new Set(),
        sourcePathCount: 0,
      }
      current.sourceMapPaths.add(entry.path)
      current.sourcePathCount += 1
      observations.set(key, current)
    }
    return {
      path: entry.path,
      sha256: entry.sha256,
      sourceCount: document.sources.length,
    }
  })
  if (observations.size === 0) {
    fail("runtime source maps contain no pnpm package identities")
  }
  const files = publicEntries.map(({ contents: _contents, ...entry }) => entry)
  const sourceMapInventory = sourceMaps.sort((left, right) =>
    compareText(left.path, right.path),
  )
  const publicByPath = new Map(files.map((entry) => [entry.path, entry]))
  if (
    sourceMapInventory.some(
      (entry) => publicByPath.get(entry.path)?.sha256 !== entry.sha256,
    )
  ) {
    fail("runtime source-map identity differs from /public")
  }
  const packages = [...observations.values()]
    .map(({ sourceMapPaths, ...entry }) => ({
      ...entry,
      sourceMapPaths: [...sourceMapPaths].sort(compareText),
    }))
    .sort((left, right) =>
      compareText(
        `${left.name}\u0000${left.storeKey}`,
        `${right.name}\u0000${right.storeKey}`,
      ),
    )
  return {
    portainer: {
      path: "/portainer",
      bytes: portainer.contents.length,
      sha256: sha256Bytes(portainer.contents),
    },
    path: "/public",
    files,
    fileCount: files.length,
    bytes: files.reduce((total, entry) => total + entry.bytes, 0),
    inventorySha256: sha256Bytes(`${canonicalJson(files)}\n`),
    sourceMaps: sourceMapInventory,
    sourceMapInventorySha256: sha256Bytes(
      `${canonicalJson(sourceMapInventory)}\n`,
    ),
    sourcePathCount: sourceMapInventory.reduce(
      (total, entry) => total + entry.sourceCount,
      0,
    ),
    packageStoreIdentityCount: packages.length,
    packages,
  }
}

function readFrontendSourceInventory(inventoryPath, sourcePackage) {
  requireRegularFile(inventoryPath, "frontend source inventory")
  if (
    basename(inventoryPath) !== "SOURCE-SHA256SUMS" ||
    basename(dirname(inventoryPath)) !== ".llmm-build" ||
    sha256File(inventoryPath) !==
      sourcePackage.downstream.sourceInventory.sha256SumsSha256
  ) {
    fail("frontend source inventory differs from the admitted source")
  }
  const lines = readFileSync(inventoryPath, "utf8").trimEnd().split("\n")
  const entries = new Map()
  for (const line of lines) {
    const match = line.match(/^([a-f0-9]{64}) {2}\.\/(.+)$/)
    if (!match) fail("frontend source inventory has an invalid entry")
    requireSafeSourceRelativePath(match[2], "frontend source inventory path")
    if (entries.has(match[2])) fail("frontend source inventory is duplicated")
    entries.set(match[2], match[1])
  }
  if (
    entries.size !== sourcePackage.downstream.sourceInventory.fileCount ||
    canonicalJson([...entries.keys()].sort(compareText)) !==
      canonicalJson([...entries.keys()])
  ) {
    fail("frontend source inventory count or ordering differs")
  }
  const sourceRoot = resolve(dirname(inventoryPath), "..")
  const required = {
    goMod: "go.mod",
    goSum: "go.sum",
    packageJson: "package.json",
    pnpmLock: "pnpm-lock.yaml",
    webpackCommon: "webpack/webpack.common.js",
    webpackProduction: "webpack/webpack.production.js",
  }
  const identities = {}
  for (const [field, path] of Object.entries(required)) {
    const file = resolve(sourceRoot, path)
    requireRegularFile(file, `frontend ${path}`)
    const fileRelative = relative(sourceRoot, file)
    if (fileRelative !== path || sha256File(file) !== entries.get(path)) {
      fail(`frontend ${path} differs from the source inventory`)
    }
    identities[`${field}Sha256`] = entries.get(path)
  }
  const packageJson = readJson(
    resolve(sourceRoot, required.packageJson),
    "frontend package.json",
  )
  if (
    packageJson.name !== "@portainer/ce" ||
    packageJson.version !== sourcePackage.upstream.version ||
    packageJson.packageManager !==
      `pnpm@${sourcePackage.downstream.pnpm.version}`
  ) {
    fail("frontend package.json identity differs from Portainer CE")
  }
  if (
    Object.keys(required).some(
      (field) =>
        identities[`${field}Sha256`] !==
        sourcePackage.downstream.sourceInventory[`${field}Sha256`],
    )
  ) {
    fail("frontend source identities differ from the admitted source")
  }
  return {
    sourceRoot,
    sourceFiles: [...entries.entries()].map(([path, sha256]) => ({
      path,
      sha256,
    })),
    revision: sourcePackage.upstream.revision,
    tree: sourcePackage.upstream.tree,
    sourceInventorySha256:
      sourcePackage.downstream.sourceInventory.sha256SumsSha256,
    fileCount: entries.size,
    ...identities,
  }
}

function frontendSourceProjection({
  sourceRoot: _root,
  sourceFiles: _files,
  ...source
}) {
  return source
}

function validateScanMetadata(metadata, artifact, frontendSource) {
  exactKeys(
    metadata,
    ["schema", "scannedAt", "syft", "trivy", "govulncheck", "frontend"],
    "scan metadata",
  )
  exactKeys(
    metadata.syft,
    ["name", "version", "toolImageDigest", "targetImageDigest"],
    "Syft metadata",
  )
  exactKeys(
    metadata.trivy,
    [
      "name",
      "version",
      "toolImageDigest",
      "targetImageDigest",
      "databaseUpdatedAt",
      "databaseSha256",
    ],
    "Trivy metadata",
  )
  exactKeys(
    metadata.govulncheck,
    ["name", "version", "binarySha256"],
    "govulncheck metadata",
  )
  exactKeys(
    metadata.frontend,
    ["sourceInventorySha256", "syft", "trivy"],
    "frontend scan metadata",
  )
  exactKeys(
    metadata.frontend.syft,
    ["name", "version", "toolImageDigest"],
    "frontend Syft metadata",
  )
  exactKeys(
    metadata.frontend.trivy,
    [
      "name",
      "version",
      "toolImageDigest",
      "databaseUpdatedAt",
      "databaseSha256",
    ],
    "frontend Trivy metadata",
  )
  const scannedAt = normalizeIsoTimestamp(metadata.scannedAt, "scannedAt")
  const databaseUpdatedAt = normalizeIsoTimestamp(
    metadata.trivy.databaseUpdatedAt,
    "Trivy databaseUpdatedAt",
  )
  const frontendDatabaseUpdatedAt = normalizeIsoTimestamp(
    metadata.frontend.trivy.databaseUpdatedAt,
    "frontend Trivy databaseUpdatedAt",
  )
  const age = Date.parse(scannedAt) - Date.parse(databaseUpdatedAt)
  const frontendAge =
    Date.parse(scannedAt) - Date.parse(frontendDatabaseUpdatedAt)
  if (
    metadata.schema !== "llm-machines.portainer-ce-scan-input.v1" ||
    metadata.syft.name !== "syft" ||
    !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(
      metadata.syft.version ?? "",
    ) ||
    metadata.syft.targetImageDigest !== artifact.manifestDigest ||
    metadata.trivy.name !== "trivy" ||
    !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(
      metadata.trivy.version ?? "",
    ) ||
    metadata.trivy.targetImageDigest !== artifact.manifestDigest ||
    metadata.govulncheck.name !== "govulncheck" ||
    !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(
      metadata.govulncheck.version ?? "",
    ) ||
    !ociDigestPattern.test(metadata.syft.toolImageDigest ?? "") ||
    !ociDigestPattern.test(metadata.trivy.toolImageDigest ?? "") ||
    !digestPattern.test(metadata.trivy.databaseSha256 ?? "") ||
    !digestPattern.test(metadata.govulncheck.binarySha256 ?? "") ||
    metadata.frontend.sourceInventorySha256 !==
      frontendSource.sourceInventorySha256 ||
    metadata.frontend.syft.name !== "syft" ||
    metadata.frontend.syft.version !== metadata.syft.version ||
    metadata.frontend.syft.toolImageDigest !== metadata.syft.toolImageDigest ||
    metadata.frontend.trivy.name !== "trivy" ||
    metadata.frontend.trivy.version !== metadata.trivy.version ||
    metadata.frontend.trivy.toolImageDigest !==
      metadata.trivy.toolImageDigest ||
    !digestPattern.test(metadata.frontend.trivy.databaseSha256 ?? "") ||
    age < 0 ||
    age > 72 * 60 * 60 * 1000 ||
    frontendAge < 0 ||
    frontendAge > 72 * 60 * 60 * 1000
  ) {
    fail(
      "scan metadata is incomplete, stale, mutable, or targets another image",
    )
  }
  return {
    schema: metadata.schema,
    scannedAt,
    syft: clone(metadata.syft),
    trivy: { ...clone(metadata.trivy), databaseUpdatedAt },
    govulncheck: clone(metadata.govulncheck),
    frontend: {
      sourceInventorySha256: metadata.frontend.sourceInventorySha256,
      syft: clone(metadata.frontend.syft),
      trivy: {
        ...clone(metadata.frontend.trivy),
        databaseUpdatedAt: frontendDatabaseUpdatedAt,
      },
    },
  }
}

function normalizeSbom(raw, metadata, sourcePackage, artifact, rawSha256) {
  const tools = raw?.metadata?.tools?.components
  if (
    raw?.bomFormat !== "CycloneDX" ||
    !["1.6", "1.7"].includes(raw?.specVersion) ||
    !Array.isArray(tools) ||
    !tools.some(
      (tool) =>
        String(tool?.name).toLowerCase() === "syft" &&
        tool?.version === metadata.syft.version,
    ) ||
    !Array.isArray(raw?.components) ||
    raw.components.length === 0
  ) {
    fail("raw Syft SBOM is incomplete or differs from the scanner identity")
  }
  const components = raw.components.map((component) => clone(component))
  const componentRefs = components.map((component) => component?.["bom-ref"])
  if (
    componentRefs.some(
      (reference) => typeof reference !== "string" || reference.length === 0,
    ) ||
    new Set(componentRefs).size !== componentRefs.length
  ) {
    fail("raw Syft SBOM component references are missing or duplicated")
  }
  const componentRefSet = new Set(componentRefs)
  const rawDependencies = new Map()
  for (const dependency of raw.dependencies ?? []) {
    if (
      componentRefSet.has(dependency?.ref) &&
      Array.isArray(dependency?.dependsOn) &&
      dependency.dependsOn.every((reference) => componentRefSet.has(reference))
    ) {
      rawDependencies.set(
        dependency.ref,
        [...new Set(dependency.dependsOn)].sort(),
      )
    }
  }
  const rootRef = `container:${sourcePackage.downstream.mirrorRepository}@${sourcePackage.downstream.version}`
  const sbom = {
    bomFormat: "CycloneDX",
    specVersion: raw.specVersion,
    version: 1,
    metadata: {
      tools: {
        components: [
          {
            type: "application",
            name: "syft",
            version: metadata.syft.version,
          },
        ],
      },
      component: {
        type: "container",
        "bom-ref": rootRef,
        name: "portainer-ce-downstream",
        version: sourcePackage.downstream.version,
        hashes: [{ alg: "SHA-256", content: artifact.manifestDigest.slice(7) }],
        properties: [
          {
            name: "llm-machines:oci-archive-sha256",
            value: artifact.ociArchiveSha256,
          },
          {
            name: "llm-machines:oci-index-digest",
            value: artifact.indexDigest,
          },
          {
            name: "llm-machines:platform-manifest-digest",
            value: artifact.manifestDigest,
          },
          {
            name: "llm-machines:config-digest",
            value: artifact.configDigest,
          },
          { name: "llm-machines:raw-syft-sha256", value: rawSha256 },
        ],
      },
    },
    components: components.sort((left, right) =>
      compareText(left["bom-ref"], right["bom-ref"]),
    ),
    dependencies: [
      { ref: rootRef, dependsOn: [...componentRefs].sort() },
      ...[...componentRefs]
        .sort()
        .map((ref) => ({ ref, dependsOn: rawDependencies.get(ref) ?? [] })),
    ],
  }
  requireNoCommercialIdentifiers(
    [
      ...componentIdentifiers(sbom.metadata.component),
      ...sbom.components.flatMap(componentIdentifiers),
    ],
    "CycloneDX SBOM",
  )
  return sbom
}

function trivySortKey(result) {
  return [result?.Target, result?.Class, result?.Type]
    .map((value) => String(value ?? ""))
    .join("\u0000")
}

function trivyIdentifiers(report) {
  const imageConfig = report?.Metadata?.ImageConfig?.config ?? {}
  return [
    report?.ArtifactName,
    report?.Metadata?.Reference,
    report?.Metadata?.RepoTags ?? [],
    report?.Metadata?.RepoDigests ?? [],
    runtimeConfigIdentifiers(imageConfig),
    ...(report?.Results ?? []).flatMap((result) => [
      result?.Target,
      ...(result?.Packages ?? []).flatMap((pkg) => [
        pkg?.Name,
        pkg?.Path,
        pkg?.Identifier?.PURL,
        pkg?.Licenses ?? [],
      ]),
      ...(result?.Vulnerabilities ?? []).flatMap((finding) => [
        finding?.PkgName,
        finding?.PkgPath,
        finding?.PkgIdentifier?.PURL,
      ]),
      ...(result?.Misconfigurations ?? []).flatMap((finding) => [
        finding?.ID,
        finding?.Type,
        finding?.CauseMetadata?.Resource,
        finding?.CauseMetadata?.Provider,
      ]),
      ...(result?.Secrets ?? []).flatMap((finding) => [
        finding?.RuleID,
        finding?.Category,
      ]),
    ]),
  ]
}

function normalizeTrivy(raw, metadata, sourcePackage, artifact, rawSha256) {
  if (
    raw?.SchemaVersion !== 2 ||
    raw?.Trivy?.Version !== metadata.trivy.version ||
    raw?.ArtifactType !== "container_image" ||
    raw?.Metadata?.ImageID !== artifact.configDigest ||
    raw?.Metadata?.ImageConfig?.architecture !== "amd64" ||
    raw?.Metadata?.ImageConfig?.os !== "linux" ||
    canonicalJson(raw?.Metadata?.DiffIDs) !==
      canonicalJson(artifact.runtimeInventory.rootfs.diffIds) ||
    !Array.isArray(raw?.Results) ||
    raw.Results.length === 0 ||
    (Array.isArray(raw?.Errors) && raw.Errors.length > 0)
  ) {
    fail(
      "raw Trivy report is incomplete, targets another image/platform, or reports scan errors",
    )
  }
  requireNoCommercialIdentifiers(trivyIdentifiers(raw), "raw Trivy report")
  const results = raw.Results.map((result) => {
    const normalized = clone(result)
    for (const field of ["Vulnerabilities", "Misconfigurations", "Secrets"]) {
      if (Array.isArray(normalized[field])) {
        normalized[field].sort((left, right) =>
          compareText(canonicalJson(left), canonicalJson(right)),
        )
      }
    }
    return normalized
  }).sort((left, right) => compareText(trivySortKey(left), trivySortKey(right)))
  const report = {
    SchemaVersion: 2,
    ArtifactName: sourcePackage.downstream.mirrorRepository,
    ArtifactType: "container_image",
    Metadata: {
      ...clone(raw.Metadata ?? {}),
      ImageID: artifact.configDigest,
      RepoTags: [],
      RepoDigests: [
        `${sourcePackage.downstream.mirrorRepository}@${artifact.manifestDigest}`,
      ],
      ImageConfig: {
        ...clone(raw.Metadata?.ImageConfig ?? {}),
        digest: artifact.manifestDigest,
      },
      LLMMEvidence: {
        rawReportSha256: rawSha256,
        scanner: {
          name: "trivy",
          version: metadata.trivy.version,
          toolImageDigest: metadata.trivy.toolImageDigest,
        },
        database: {
          updatedAt: metadata.trivy.databaseUpdatedAt,
          sha256: metadata.trivy.databaseSha256,
        },
        scannedAt: metadata.scannedAt,
      },
    },
    Results: results,
  }
  requireNoCommercialIdentifiers(trivyIdentifiers(report), "Trivy report")
  return report
}

function validateLicenseRecord(
  record,
  field,
  {
    allowedOrigins = ["package-tarball", "reviewed-upstream"],
    allowArchiveEntry = false,
    archiveEntryOptional = false,
    frontendArchiveSources = false,
  } = {},
) {
  exactKeys(
    record,
    [
      "declaredExpression",
      "concludedExpression",
      "files",
      "noticeFiles",
      "disposition",
      "reviewer",
      "reviewedAt",
    ],
    field,
  )
  for (const [value, name] of [
    [record.declaredExpression, "declaredExpression"],
    [record.concludedExpression, "concludedExpression"],
  ]) {
    if (
      typeof value !== "string" ||
      !spdxExpressionPattern.test(value) ||
      isCommercialPortainerIdentifier(value)
    ) {
      fail(`${field} ${name} is not an admitted license expression`)
    }
  }
  const validateFiles = (files, name) => {
    if (!Array.isArray(files)) fail(`${field} ${name} must be an array`)
    return files.map((entry, index) => {
      const keys = ["path", "bytes", "sha256", "origin"]
      const hasArchiveEntry = Object.hasOwn(entry ?? {}, "archiveEntry")
      if (frontendArchiveSources && entry?.origin === "package-archive") {
        keys.push("archivePath", "archiveEntry")
      } else if (
        frontendArchiveSources &&
        entry?.origin === "reviewed-source-archive"
      ) {
        keys.push(
          "sourceArchiveUrl",
          "sourceRevision",
          "sourceArchivePath",
          "sourceArchiveBytes",
          "sourceArchiveSha256",
          "archiveEntry",
        )
      } else if (frontendArchiveSources && entry?.origin === "reviewed-spdx") {
        keys.push(
          "spdxVersion",
          "spdxRevision",
          "sourceArchiveUrl",
          "sourceRevision",
          "sourceArchivePath",
          "sourceArchiveBytes",
          "sourceArchiveSha256",
          "archiveEntry",
        )
      } else if (
        allowArchiveEntry &&
        (!archiveEntryOptional || hasArchiveEntry)
      ) {
        keys.push("archiveEntry")
      }
      exactKeys(entry, keys, `${field} ${name} ${index + 1}`)
      requireSafeRelativePath(entry.path, `${field} ${name} path`)
      if (
        !Number.isInteger(entry.bytes) ||
        entry.bytes < 1 ||
        !digestPattern.test(entry.sha256 ?? "") ||
        !allowedOrigins.includes(entry.origin) ||
        (allowArchiveEntry &&
          !archiveEntryOptional &&
          (typeof entry.archiveEntry !== "string" ||
            entry.archiveEntry.length === 0))
      ) {
        fail(`${field} ${name} identity is invalid`)
      }
      if (
        hasArchiveEntry &&
        (typeof entry.archiveEntry !== "string" ||
          entry.archiveEntry.length === 0)
      ) {
        fail(`${field} ${name} archive entry is invalid`)
      }
      if (frontendArchiveSources) {
        if (entry.origin === "package-archive") {
          requireSafeRelativePath(
            entry.archivePath,
            `${field} ${name} archive path`,
          )
          safeArchiveEntry(entry.archiveEntry, `${field} ${name} archive entry`)
        } else if (entry.origin === "reviewed-source-archive") {
          requireSafeRelativePath(
            entry.sourceArchivePath,
            `${field} ${name} source archive path`,
          )
          safeArchiveEntry(
            entry.archiveEntry,
            `${field} ${name} source archive entry`,
          )
          if (
            !/^https:\/\/[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]+$/.test(
              entry.sourceArchiveUrl ?? "",
            ) ||
            !/^[a-f0-9]{40}$/.test(entry.sourceRevision ?? "") ||
            !Number.isInteger(entry.sourceArchiveBytes) ||
            entry.sourceArchiveBytes < 1 ||
            !digestPattern.test(entry.sourceArchiveSha256 ?? "")
          ) {
            fail(`${field} ${name} source archive identity is invalid`)
          }
        } else if (entry.origin === "reviewed-spdx") {
          requireSafeRelativePath(
            entry.sourceArchivePath,
            `${field} ${name} SPDX source archive path`,
          )
          safeArchiveEntry(
            entry.archiveEntry,
            `${field} ${name} SPDX source archive entry`,
          )
          if (
            entry.spdxVersion !== "3.28" ||
            entry.spdxRevision !== "v3.28" ||
            !/^https:\/\/[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]+$/.test(
              entry.sourceArchiveUrl ?? "",
            ) ||
            !/^[a-f0-9]{40}$/.test(entry.sourceRevision ?? "") ||
            !Number.isInteger(entry.sourceArchiveBytes) ||
            entry.sourceArchiveBytes < 1 ||
            !digestPattern.test(entry.sourceArchiveSha256 ?? "")
          ) {
            fail(`${field} ${name} SPDX custody identity is invalid`)
          }
        }
      }
      return clone(entry)
    })
  }
  const files = validateFiles(record.files, "license files")
  const noticeFiles = validateFiles(record.noticeFiles, "notice files")
  if (
    files.length === 0 ||
    typeof record.disposition !== "string" ||
    record.disposition.length === 0 ||
    typeof record.reviewer !== "string" ||
    record.reviewer.length === 0
  ) {
    fail(`${field} review is incomplete`)
  }
  return {
    declaredExpression: record.declaredExpression,
    concludedExpression: record.concludedExpression,
    files: files.sort((left, right) => compareText(left.path, right.path)),
    noticeFiles: noticeFiles.sort((left, right) =>
      compareText(left.path, right.path),
    ),
    disposition: record.disposition,
    reviewer: record.reviewer,
    reviewedAt: normalizeIsoTimestamp(record.reviewedAt, `${field} reviewedAt`),
  }
}

function validateLicenseCoverage(coverage, refs, field) {
  exactKeys(
    coverage,
    [
      "expectedComponentCount",
      "reviewedComponentCount",
      "expectedRefsSha256",
      "missingRefs",
      "unknownExpressions",
      "missingRequiredTexts",
      "copyleftRefs",
      "prohibitedRefs",
      "complete",
    ],
    field,
  )
  const sortedRefs = [...refs].sort(compareText)
  if (
    coverage.expectedComponentCount !== sortedRefs.length ||
    coverage.reviewedComponentCount !== sortedRefs.length ||
    coverage.expectedRefsSha256 !==
      sha256Bytes(`${canonicalJson(sortedRefs)}\n`) ||
    !Array.isArray(coverage.missingRefs) ||
    coverage.missingRefs.length !== 0 ||
    !Array.isArray(coverage.unknownExpressions) ||
    coverage.unknownExpressions.length !== 0 ||
    !Array.isArray(coverage.missingRequiredTexts) ||
    coverage.missingRequiredTexts.length !== 0 ||
    !Array.isArray(coverage.copyleftRefs) ||
    !Array.isArray(coverage.prohibitedRefs) ||
    coverage.prohibitedRefs.length !== 0 ||
    coverage.complete !== true
  ) {
    fail(`${field} is incomplete or differs from the reviewed components`)
  }
  for (const reference of coverage.copyleftRefs) {
    if (!refs.has(reference)) fail(`${field} has an unknown copyleft reference`)
  }
  return {
    ...clone(coverage),
    copyleftRefs: [...coverage.copyleftRefs].sort(compareText),
  }
}

function normalizeFrontendLicenseInput(
  raw,
  rawSha256,
  inputPath,
  sourcePackage,
  artifact,
  frontendSource,
  frontendRuntime,
) {
  exactKeys(
    raw,
    [
      "schema",
      "generatedAt",
      "packageManager",
      "artifact",
      "custody",
      "components",
      "coverage",
    ],
    "frontend license input",
  )
  exactKeys(
    raw.packageManager,
    ["name", "version", "packageJson", "lockfile", "install"],
    "frontend license package manager",
  )
  for (const [entry, expectedPath, expectedSha256, field] of [
    [
      raw.packageManager.packageJson,
      "package.json",
      frontendSource.packageJsonSha256,
      "package.json",
    ],
    [
      raw.packageManager.lockfile,
      "pnpm-lock.yaml",
      frontendSource.pnpmLockSha256,
      "lockfile",
    ],
  ]) {
    exactKeys(entry, ["path", "sha256"], `frontend license ${field}`)
    if (entry.path !== expectedPath || entry.sha256 !== expectedSha256) {
      fail(`frontend license ${field} differs from the admitted source`)
    }
  }
  exactKeys(
    raw.packageManager.install,
    ["frozen", "ignorePnpmfile", "scripts"],
    "frontend license install",
  )
  exactKeys(
    raw.artifact,
    [
      "ociArchiveSha256",
      "manifestDigest",
      "layerDigests",
      "publicInventorySha256",
      "sourceMapInventorySha256",
    ],
    "frontend license artifact",
  )
  if (
    raw.schema !== "llm-machines.portainer-ce-frontend-license-input.v3" ||
    raw.packageManager.name !== "pnpm" ||
    raw.packageManager.version !== sourcePackage.downstream.pnpm.version ||
    raw.packageManager.install.frozen !== true ||
    raw.packageManager.install.ignorePnpmfile !== true ||
    raw.packageManager.install.scripts !== false ||
    raw.artifact.ociArchiveSha256 !== artifact.ociArchiveSha256 ||
    raw.artifact.manifestDigest !== artifact.manifestDigest ||
    canonicalJson(raw.artifact.layerDigests) !==
      canonicalJson(artifact.layers.map(({ digest }) => digest)) ||
    raw.artifact.publicInventorySha256 !== frontendRuntime.inventorySha256 ||
    raw.artifact.sourceMapInventorySha256 !==
      frontendRuntime.sourceMapInventorySha256 ||
    !Array.isArray(raw.components) ||
    raw.components.length === 0
  ) {
    fail("frontend license input does not bind the admitted artifact")
  }
  const custody = validateLicenseCustody(raw.custody, inputPath)
  const observedByStoreKey = new Map(
    frontendRuntime.packages.map((entry) => [entry.storeKey, entry]),
  )
  const components = raw.components.map((component, index) => {
    exactKeys(
      component,
      ["bomRef", "purl", "name", "version", "source", "bundle", "license"],
      `frontend license component ${index + 1}`,
    )
    exactKeys(
      component.bundle,
      ["sourceMapPaths", "sourcePathCount"],
      `frontend license component ${index + 1} bundle`,
    )
    if (
      typeof component.name !== "string" ||
      component.name.length === 0 ||
      typeof component.version !== "string" ||
      component.version.length === 0 ||
      !packagePurlPattern.test(component.purl ?? "") ||
      component.bomRef !== component.purl ||
      !Array.isArray(component.bundle.sourceMapPaths) ||
      component.bundle.sourceMapPaths.length === 0 ||
      component.bundle.sourceMapPaths.some(
        (path) =>
          typeof path !== "string" ||
          !frontendRuntime.sourceMaps.some((entry) => entry.path === path),
      ) ||
      !Number.isInteger(component.bundle.sourcePathCount) ||
      component.bundle.sourcePathCount < 1
    ) {
      fail(`frontend license component ${index + 1} identity is invalid`)
    }
    const kind = component.source?.kind
    const sourceKeys =
      kind === "registry"
        ? [
            "kind",
            "lockKey",
            "integrity",
            "archivePath",
            "archiveBytes",
            "archiveSha256",
            "packageManifestEntry",
            "packageManifestSha256",
          ]
        : kind === "git-tarball"
          ? [
              "kind",
              "lockKey",
              "tarballUrl",
              "revision",
              "archivePath",
              "archiveBytes",
              "archiveSha256",
              "packageManifestEntry",
              "packageManifestSha256",
            ]
          : []
    if (sourceKeys.length === 0) {
      fail(`frontend license component ${index + 1} source kind is invalid`)
    }
    exactKeys(
      component.source,
      sourceKeys,
      `frontend license component ${index + 1} source`,
    )
    const observed = observedByStoreKey.get(component.source.lockKey)
    if (
      !observed ||
      observed.name !== component.name ||
      canonicalJson([...component.bundle.sourceMapPaths].sort(compareText)) !==
        canonicalJson(observed.sourceMapPaths) ||
      component.bundle.sourcePathCount !== observed.sourcePathCount ||
      !Number.isInteger(component.source.archiveBytes) ||
      component.source.archiveBytes < 1 ||
      !digestPattern.test(component.source.archiveSha256 ?? "") ||
      !digestPattern.test(component.source.packageManifestSha256 ?? "") ||
      (kind === "registry" &&
        (typeof component.source.integrity !== "string" ||
          component.source.integrity.length === 0)) ||
      (kind === "git-tarball" &&
        (!/^https:\/\/codeload\.github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/tar\.gz\/[a-f0-9]{40}$/.test(
          component.source.tarballUrl ?? "",
        ) ||
          !/^[a-f0-9]{40}$/.test(component.source.revision ?? "") ||
          !component.source.tarballUrl.endsWith(component.source.revision) ||
          !digestPattern.test(component.source.archiveSha256 ?? "")))
    ) {
      fail(`frontend license component ${index + 1} does not bind /public`)
    }
    const license = validateLicenseRecord(
      component.license,
      `frontend license component ${index + 1}`,
      {
        allowedOrigins: [
          "package-archive",
          "reviewed-source-archive",
          "reviewed-spdx",
        ],
        frontendArchiveSources: true,
      },
    )
    for (const file of [...license.files, ...license.noticeFiles]) {
      custodyFile(
        custody,
        file.path,
        file.bytes,
        file.sha256,
        `frontend license component ${index + 1} legal file`,
      )
    }
    validateFrontendComponentArchives(
      component,
      license,
      custody,
      `frontend license component ${index + 1}`,
    )
    return {
      bomRef: component.bomRef,
      purl: component.purl,
      name: component.name,
      version: component.version,
      source: clone(component.source),
      bundle: {
        sourceMapPaths: [...component.bundle.sourceMapPaths].sort(compareText),
        sourcePathCount: component.bundle.sourcePathCount,
      },
      license,
    }
  })
  const refs = new Set(components.map(({ bomRef }) => bomRef))
  const stores = new Set(components.map(({ source: { lockKey } }) => lockKey))
  if (
    refs.size !== components.length ||
    stores.size !== components.length ||
    stores.size !== observedByStoreKey.size ||
    [...observedByStoreKey.keys()].some((key) => !stores.has(key)) ||
    canonicalJson(components.map(({ bomRef }) => bomRef)) !==
      canonicalJson([...refs].sort(compareText))
  ) {
    fail("frontend license components are incomplete, duplicated, or unsorted")
  }
  requireNoCommercialIdentifiers(
    components.flatMap((component) => [
      component.bomRef,
      component.purl,
      component.name,
      component.source.lockKey,
      component.source.tarballUrl,
      component.source.archivePath,
      component.source.packageManifestEntry,
      component.license.declaredExpression,
      component.license.concludedExpression,
      ...[...component.license.files, ...component.license.noticeFiles].flatMap(
        (file) => Object.values(file),
      ),
    ]),
    "frontend license input",
  )
  return {
    schema: raw.schema,
    generatedAt: normalizeIsoTimestamp(
      raw.generatedAt,
      "frontend license generatedAt",
    ),
    packageManager: clone(raw.packageManager),
    artifact: clone(raw.artifact),
    custody: {
      root: raw.custody.root,
      manifestPath: custody.manifestPath,
      manifestSha256: custody.manifestSha256,
    },
    components,
    coverage: validateLicenseCoverage(
      raw.coverage,
      refs,
      "frontend license coverage",
    ),
    rawSha256,
  }
}

function safeArchiveEntry(value, field) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.startsWith("/") ||
    value.includes("\0") ||
    value.includes("\\") ||
    /[\r\n]/.test(value) ||
    value
      .split("/")
      .some((part) => part === "" || part === "." || part === "..")
  ) {
    fail(`${field} is unsafe`)
  }
}

function safeArchiveSymlinkTarget(value, path, field) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.startsWith("/") ||
    value.includes("\0") ||
    value.includes("\\") ||
    /[\r\n]/.test(value)
  ) {
    fail(`${field} is unsafe`)
  }
  const resolved = path.split("/").slice(0, -1)
  for (const part of value.split("/")) {
    if (part === "") fail(`${field} is unsafe`)
    if (part === ".") continue
    if (part === "..") {
      if (resolved.length === 0) fail(`${field} escapes the archive root`)
      resolved.pop()
    } else {
      resolved.push(part)
    }
  }
  if (resolved.length === 0) fail(`${field} is unsafe`)
}

function listRegularFiles(root, prefix = "") {
  const files = []
  for (const entry of readdirSync(join(root, prefix), {
    withFileTypes: true,
  })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name
    const metadata = lstatSync(join(root, path))
    if (metadata.isSymbolicLink()) fail("license custody contains a symlink")
    if (metadata.isDirectory()) files.push(...listRegularFiles(root, path))
    else if (metadata.isFile() && metadata.nlink === 1) files.push(path)
    else fail("license custody contains an unsupported filesystem entry")
  }
  return files.sort(compareText)
}

function validateLicenseCustody(custody, inputPath) {
  exactKeys(
    custody,
    ["root", "manifestPath", "manifestSha256"],
    "license custody",
  )
  requireSafeRelativePath(custody.root, "license custody root")
  requireSafeRelativePath(custody.manifestPath, "license custody manifest path")
  if (!digestPattern.test(custody.manifestSha256 ?? "")) {
    fail("license custody manifest identity is invalid")
  }
  const inputRoot = dirname(inputPath)
  const root = resolve(inputRoot, custody.root)
  const rootRelative = relative(inputRoot, root)
  if (rootRelative.startsWith(`..${sep}`) || rootRelative === "..") {
    fail("license custody root escapes its input root")
  }
  const rootMetadata = lstatSync(root)
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
    fail("license custody root is not a directory")
  }
  const manifest = resolve(root, custody.manifestPath)
  requireRegularFile(manifest, "license custody manifest")
  if (sha256File(manifest) !== custody.manifestSha256) {
    fail("license custody manifest SHA-256 differs")
  }
  const entries = new Map()
  for (const line of readFileSync(manifest, "utf8").trimEnd().split("\n")) {
    const match = line.match(/^([a-f0-9]{64}) {2}\.\/(.+)$/)
    if (!match) fail("license custody manifest has an invalid entry")
    requireSafeRelativePath(match[2], "license custody file path")
    if (match[2] === custody.manifestPath || entries.has(match[2])) {
      fail("license custody manifest is recursive or duplicated")
    }
    entries.set(match[2], match[1])
  }
  const files = listRegularFiles(root).filter(
    (path) => path !== custody.manifestPath,
  )
  if (
    canonicalJson(files) !==
    canonicalJson([...entries.keys()].sort(compareText))
  ) {
    fail("license custody contains missing or untracked files")
  }
  for (const [path, expected] of entries) {
    if (sha256File(join(root, path)) !== expected) {
      fail(`license custody file differs: ${path}`)
    }
  }
  return {
    root,
    entries,
    manifestPath: custody.manifestPath,
    manifestSha256: custody.manifestSha256,
  }
}

function custodyFile(custody, path, bytes, sha256, field) {
  requireSafeRelativePath(path, `${field} path`)
  const file = resolve(custody.root, path)
  const fileRelative = relative(custody.root, file)
  if (fileRelative !== path || custody.entries.get(path) !== sha256) {
    fail(`${field} is not sealed by the custody manifest`)
  }
  const metadata = requireRegularFile(file, field)
  if (metadata.size !== bytes || sha256File(file) !== sha256) {
    fail(`${field} bytes or SHA-256 differ`)
  }
  return file
}

function readZipEntries(file, requiredEntries, field) {
  const archive = readFileSync(file)
  if (archive.length > 512 * 1024 * 1024)
    fail(`${field} exceeds its evidence limit`)
  const minimum = Math.max(0, archive.length - 65_557)
  let eocd = -1
  for (let offset = archive.length - 22; offset >= minimum; offset -= 1) {
    if (archive.readUInt32LE(offset) === 0x06054b50) {
      eocd = offset
      break
    }
  }
  if (eocd === -1) fail(`${field} has no ZIP directory`)
  const entryCount = archive.readUInt16LE(eocd + 10)
  const directorySize = archive.readUInt32LE(eocd + 12)
  const directoryOffset = archive.readUInt32LE(eocd + 16)
  if (entryCount === 0xffff || directoryOffset + directorySize > eocd) {
    fail(`${field} uses unsupported ZIP64 or an invalid directory`)
  }
  const entries = new Map()
  let offset = directoryOffset
  for (let index = 0; index < entryCount; index += 1) {
    if (archive.readUInt32LE(offset) !== 0x02014b50)
      fail(`${field} ZIP directory differs`)
    const flags = archive.readUInt16LE(offset + 8)
    const method = archive.readUInt16LE(offset + 10)
    const compressedBytes = archive.readUInt32LE(offset + 20)
    const bytes = archive.readUInt32LE(offset + 24)
    const nameBytes = archive.readUInt16LE(offset + 28)
    const extraBytes = archive.readUInt16LE(offset + 30)
    const commentBytes = archive.readUInt16LE(offset + 32)
    const localOffset = archive.readUInt32LE(offset + 42)
    const name = archive
      .subarray(offset + 46, offset + 46 + nameBytes)
      .toString("utf8")
    safeArchiveEntry(name, `${field} ZIP entry`)
    if ((flags & 1) !== 0 || ![0, 8].includes(method) || entries.has(name)) {
      fail(`${field} ZIP entry is encrypted, unsupported, or duplicated`)
    }
    entries.set(name, { method, compressedBytes, bytes, localOffset })
    offset += 46 + nameBytes + extraBytes + commentBytes
  }
  if (offset !== directoryOffset + directorySize)
    fail(`${field} ZIP directory size differs`)
  const output = new Map()
  for (const [name, entry] of entries) {
    if (archive.readUInt32LE(entry.localOffset) !== 0x04034b50) {
      fail(`${field} has an invalid local entry: ${name}`)
    }
    const localNameBytes = archive.readUInt16LE(entry.localOffset + 26)
    const localExtraBytes = archive.readUInt16LE(entry.localOffset + 28)
    const localName = archive
      .subarray(entry.localOffset + 30, entry.localOffset + 30 + localNameBytes)
      .toString("utf8")
    if (localName !== name) fail(`${field} local and central names differ`)
    const start = entry.localOffset + 30 + localNameBytes + localExtraBytes
    const compressed = archive.subarray(start, start + entry.compressedBytes)
    let contents
    try {
      contents =
        entry.method === 0
          ? compressed
          : inflateRawSync(compressed, {
              maxOutputLength: Math.max(1, entry.bytes),
            })
    } catch {
      fail(`${field} archive entry cannot be decompressed: ${name}`)
    }
    if (contents.length !== entry.bytes)
      fail(`${field} archive entry size differs: ${name}`)
    output.set(name, contents)
  }
  for (const name of requiredEntries) {
    if (!output.has(name)) fail(`${field} is missing archive entry: ${name}`)
  }
  return {
    entries: new Map(requiredEntries.map((name) => [name, output.get(name)])),
    dirHash: goDirHash(output),
  }
}

function goDirHash(entries) {
  const summary = [...entries.entries()]
    .sort(([left], [right]) => compareText(left, right))
    .map(([name, contents]) => `${sha256Bytes(contents)}  ${name}\n`)
    .join("")
  return `h1:${createHash("sha256").update(summary).digest("base64")}`
}

function goModHash(contents) {
  return goDirHash(new Map([["go.mod", contents]]))
}

function readGzipTarEntries(file, requiredEntries, field) {
  let archive
  try {
    archive = gunzipSync(readFileSync(file), {
      maxOutputLength: 512 * 1024 * 1024,
    })
  } catch {
    fail(`${field} is not valid bounded gzip`)
  }
  const byPath = new Map(
    readCustodyTarEntries(archive, field).map((entry) => [
      entry.path,
      entry.contents,
    ]),
  )
  const output = new Map()
  for (const path of requiredEntries) {
    if (!byPath.has(path)) fail(`${field} is missing archive entry: ${path}`)
    output.set(path, byPath.get(path))
  }
  return output
}

function parsePaxRecords(contents, field) {
  const records = new Map()
  let offset = 0
  while (offset < contents.length) {
    const space = contents.indexOf(0x20, offset)
    if (space === -1) fail(`${field} PAX record has no length`)
    const lengthText = contents.subarray(offset, space).toString("ascii")
    if (!/^[1-9][0-9]*$/.test(lengthText)) {
      fail(`${field} PAX record length is invalid`)
    }
    const length = Number.parseInt(lengthText, 10)
    const end = offset + length
    if (end > contents.length || contents[end - 1] !== 0x0a) {
      fail(`${field} PAX record is truncated`)
    }
    const record = contents.subarray(space + 1, end - 1).toString("utf8")
    const equals = record.indexOf("=")
    if (equals <= 0) fail(`${field} PAX record is malformed`)
    const key = record.slice(0, equals)
    if (records.has(key)) fail(`${field} PAX record is duplicated`)
    records.set(key, record.slice(equals + 1))
    offset = end
  }
  return records
}

function readCustodyTarEntries(archive, field) {
  const entries = []
  const seen = new Set()
  let offset = 0
  let zeroBlocks = 0
  let pendingPath = null
  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512)
    offset += 512
    if (header.every((byte) => byte === 0)) {
      zeroBlocks += 1
      if (zeroBlocks >= 2) {
        if (!archive.subarray(offset).every((byte) => byte === 0)) {
          fail(`${field} has data after its terminal blocks`)
        }
        offset = archive.length
        break
      }
      continue
    }
    if (zeroBlocks !== 0) fail(`${field} has an interior zero block`)
    const expectedChecksum = readTarOctal(header, 148, 8, `${field} checksum`)
    const checksumHeader = Buffer.from(header)
    checksumHeader.fill(0x20, 148, 156)
    if (
      checksumHeader.reduce((total, byte) => total + byte, 0) !==
      expectedChecksum
    ) {
      fail(`${field} checksum differs`)
    }
    const magic = header.subarray(257, 263).toString("utf8")
    if (magic !== "ustar\0" && magic !== "ustar ") {
      fail(`${field} is not USTAR`)
    }
    const size = readTarOctal(header, 124, 12, `${field} entry size`)
    if (offset + size > archive.length) fail(`${field} is truncated`)
    const contents = archive.subarray(offset, offset + size)
    offset += size + ((512 - (size % 512)) % 512)
    const type = String.fromCharCode(header[156])
    if (type === "g") {
      parsePaxRecords(contents, `${field} global`)
      continue
    }
    if (type === "x") {
      const records = parsePaxRecords(contents, `${field} entry`)
      pendingPath = records.get("path") ?? null
      continue
    }
    if (type === "L") {
      pendingPath = contents.toString("utf8").replace(/\0+$/, "")
      continue
    }
    const name = readTarField(header, 0, 100)
    const prefix = readTarField(header, 345, 155)
    const headerPath = prefix ? `${prefix}/${name}` : name
    const archivedPath = pendingPath ?? headerPath
    pendingPath = null
    const path =
      type === "5" && archivedPath.endsWith("/")
        ? archivedPath.slice(0, -1)
        : archivedPath
    safeArchiveEntry(path, `${field} archive entry`)
    if (seen.has(path)) fail(`${field} contains duplicate path: ${path}`)
    seen.add(path)
    if (type === "5") {
      if (size !== 0) fail(`${field} contains a nonempty directory: ${path}`)
      continue
    }
    if (type === "2") {
      if (size !== 0) fail(`${field} contains a nonempty symlink: ${path}`)
      safeArchiveSymlinkTarget(
        readTarField(header, 157, 100),
        path,
        `${field} symlink target`,
      )
      continue
    }
    if (type !== "0" && type !== "\0") {
      fail(`${field} contains unsupported archive entry: ${path}`)
    }
    entries.push({ path, contents })
  }
  if (pendingPath !== null || zeroBlocks < 2 || offset !== archive.length) {
    fail(`${field} is missing its terminal blocks`)
  }
  return entries
}

function packageLicenseDeclarations(packageDocument, field) {
  const candidates = [
    ...(packageDocument.license === undefined ? [] : [packageDocument.license]),
    ...(Array.isArray(packageDocument.licenses)
      ? packageDocument.licenses
      : []),
  ]
  const declarations = [
    ...new Set(
      candidates.map((entry) =>
        typeof entry === "string" ? entry : entry?.type,
      ),
    ),
  ]
    .map((entry) =>
      typeof entry === "string" ? entry.trim().replace(/\s+/g, " ") : "",
    )
    .filter((entry) => entry.length > 0)
    .sort(compareText)
  if (declarations.length > 1) {
    fail(`${field} package manifest license declaration is ambiguous`)
  }
  return declarations[0] ?? null
}

function validateFrontendComponentArchives(component, license, custody, field) {
  const source = component.source
  requireSafeRelativePath(source.archivePath, `${field} archive path`)
  safeArchiveEntry(
    source.packageManifestEntry,
    `${field} package manifest entry`,
  )
  const archive = custodyFile(
    custody,
    source.archivePath,
    source.archiveBytes,
    source.archiveSha256,
    `${field} package archive`,
  )
  if (source.kind === "registry") {
    verifySubresourceIntegrity(archive, source.integrity, `${field} package`)
  }
  const legalFiles = [...license.files, ...license.noticeFiles]
  const packageArchiveFiles = legalFiles.filter(
    ({ origin }) => origin === "package-archive",
  )
  if (
    packageArchiveFiles.some(
      ({ archivePath }) => archivePath !== source.archivePath,
    )
  ) {
    fail(`${field} legal text names another package archive`)
  }
  const packageEntries = readGzipTarEntries(
    archive,
    [
      source.packageManifestEntry,
      ...packageArchiveFiles.map(({ archiveEntry }) => archiveEntry),
    ],
    `${field} package archive`,
  )
  const packageManifest = packageEntries.get(source.packageManifestEntry)
  if (sha256Bytes(packageManifest) !== source.packageManifestSha256) {
    fail(`${field} package manifest SHA-256 differs`)
  }
  let packageDocument
  try {
    packageDocument = JSON.parse(packageManifest.toString("utf8"))
  } catch {
    fail(`${field} package manifest is not valid JSON`)
  }
  if (
    packageDocument.name !== component.name ||
    packageDocument.version !== component.version
  ) {
    fail(`${field} package manifest identity differs`)
  }
  const packageDeclaration = packageLicenseDeclarations(packageDocument, field)
  if (
    (packageDeclaration === null && packageArchiveFiles.length === 0) ||
    (packageDeclaration !== null &&
      packageDeclaration !== license.declaredExpression)
  ) {
    fail(`${field} package manifest license declaration differs`)
  }
  for (const legal of packageArchiveFiles) {
    const extracted = readFileSync(
      custodyFile(
        custody,
        legal.path,
        legal.bytes,
        legal.sha256,
        `${field} extracted package legal text`,
      ),
    )
    if (!packageEntries.get(legal.archiveEntry).equals(extracted)) {
      fail(`${field} package legal text differs from its archive member`)
    }
  }
  const reviewedArchives = new Map()
  for (const legal of legalFiles.filter(
    ({ origin }) =>
      origin === "reviewed-source-archive" || origin === "reviewed-spdx",
  )) {
    if (!legal.sourceArchiveUrl.endsWith(legal.sourceRevision)) {
      fail(`${field} reviewed source URL differs from its revision`)
    }
    const identity = canonicalJson({
      url: legal.sourceArchiveUrl,
      revision: legal.sourceRevision,
      path: legal.sourceArchivePath,
      bytes: legal.sourceArchiveBytes,
      sha256: legal.sourceArchiveSha256,
    })
    const current = reviewedArchives.get(legal.sourceArchivePath)
    if (current && current.identity !== identity) {
      fail(`${field} reviewed source archive identity is inconsistent`)
    }
    const record = current ?? { identity, legal: [] }
    record.legal.push(legal)
    reviewedArchives.set(legal.sourceArchivePath, record)
  }
  for (const [path, record] of reviewedArchives) {
    const first = record.legal[0]
    const reviewedArchive = custodyFile(
      custody,
      path,
      first.sourceArchiveBytes,
      first.sourceArchiveSha256,
      `${field} reviewed source archive`,
    )
    const archiveEntries = readGzipTarEntries(
      reviewedArchive,
      record.legal.map(({ archiveEntry }) => archiveEntry),
      `${field} reviewed source archive`,
    )
    for (const legal of record.legal) {
      const extracted = readFileSync(
        custodyFile(
          custody,
          legal.path,
          legal.bytes,
          legal.sha256,
          `${field} extracted reviewed legal text`,
        ),
      )
      if (!archiveEntries.get(legal.archiveEntry).equals(extracted)) {
        fail(`${field} reviewed legal text differs from its source archive`)
      }
    }
  }
}

function goSumMap(frontendSource) {
  const sums = new Map()
  for (const line of readFileSync(
    join(frontendSource.sourceRoot, "go.sum"),
    "utf8",
  )
    .trimEnd()
    .split("\n")) {
    const [module, version, sum, extra] = line.split(" ")
    if (
      !module ||
      !version ||
      !/^h1:[A-Za-z0-9+/=]+$/.test(sum ?? "") ||
      extra
    ) {
      fail("admitted go.sum contains an invalid line")
    }
    sums.set(`${module} ${version}`, sum)
  }
  return sums
}

function normalizeRuntimeLicenseInput(
  raw,
  rawSha256,
  rawSbomSha256,
  inputPath,
  sourcePackage,
  artifact,
  runtimeComponents,
  frontendSource,
  frontendRuntime,
) {
  exactKeys(
    raw,
    ["schema", "generatedAt", "artifact", "custody", "components", "coverage"],
    "runtime license input",
  )
  exactKeys(
    raw.artifact,
    ["ociArchiveSha256", "manifestDigest", "configDigest", "rawSbomSha256"],
    "runtime license artifact",
  )
  if (
    raw.schema !== "llm-machines.portainer-ce-runtime-license-input.v2" ||
    raw.artifact.ociArchiveSha256 !== artifact.ociArchiveSha256 ||
    raw.artifact.manifestDigest !== artifact.manifestDigest ||
    raw.artifact.configDigest !== artifact.configDigest ||
    raw.artifact.rawSbomSha256 !== rawSbomSha256 ||
    !Array.isArray(raw.components)
  )
    fail("runtime license input does not bind the admitted artifact")
  const custody = validateLicenseCustody(raw.custody, inputPath)
  const expectedByRef = new Map(
    runtimeComponents.map((component) => [component["bom-ref"], component]),
  )
  const sourceFiles = new Map(
    frontendSource.sourceFiles.map(({ path, sha256 }) => [path, sha256]),
  )
  const sums = goSumMap(frontendSource)
  const goBuilder = sourcePackage.downstream.buildInputs.find(
    ({ id }) => id === "go-builder",
  )
  const components = raw.components.map((component, index) => {
    exactKeys(
      component,
      ["sbomBomRef", "purl", "name", "version", "source", "license"],
      `runtime license component ${index + 1}`,
    )
    const expected = expectedByRef.get(component.sbomBomRef)
    if (
      !expected ||
      (component.purl ?? null) !== (expected.purl ?? null) ||
      component.name !== expected.name ||
      (component.version ?? null) !== (expected.version ?? null)
    ) {
      fail(`runtime license component ${index + 1} identity differs`)
    }
    const kind = component.source?.kind
    let license
    if (kind === "main-module-source") {
      exactKeys(
        component.source,
        [
          "kind",
          "revision",
          "tree",
          "overlaySha256",
          "sourceManifestPath",
          "sourceManifestBytes",
          "sourceManifestSha256",
          "sourceFileCount",
          "goModSha256",
          "goSumSha256",
        ],
        `runtime license component ${index + 1} source`,
      )
      custodyFile(
        custody,
        component.source.sourceManifestPath,
        component.source.sourceManifestBytes,
        component.source.sourceManifestSha256,
        `runtime license component ${index + 1} source manifest`,
      )
      if (
        component.source.revision !== sourcePackage.upstream.revision ||
        component.source.tree !== sourcePackage.upstream.tree ||
        component.source.overlaySha256 !==
          sourcePackage.downstream.patch.sha256 ||
        component.source.sourceManifestSha256 !==
          frontendSource.sourceInventorySha256 ||
        component.source.sourceFileCount !== frontendSource.fileCount ||
        component.source.goModSha256 !== frontendSource.goModSha256 ||
        component.source.goSumSha256 !== frontendSource.goSumSha256
      )
        fail(`runtime license component ${index + 1} main source differs`)
      license = validateLicenseRecord(
        component.license,
        `runtime license component ${index + 1}`,
        { allowedOrigins: ["source-inventory"] },
      )
      for (const file of [...license.files, ...license.noticeFiles]) {
        const sourceFile = resolve(frontendSource.sourceRoot, file.path)
        if (
          sourceFiles.get(file.path) !== file.sha256 ||
          relative(frontendSource.sourceRoot, sourceFile) !== file.path ||
          requireRegularFile(
            sourceFile,
            `runtime license component ${index + 1} source legal file`,
          ).size !== file.bytes ||
          sha256File(sourceFile) !== file.sha256
        )
          fail(
            `runtime license component ${index + 1} legal file differs from source inventory`,
          )
      }
    } else if (kind === "runtime-artifact-file") {
      exactKeys(
        component.source,
        ["kind", "artifactPath", "sha256"],
        `runtime license component ${index + 1} source`,
      )
      if (
        expected.type !== "file" ||
        component.source.artifactPath !== frontendRuntime.portainer.path ||
        component.source.sha256 !== frontendRuntime.portainer.sha256
      )
        fail(
          `runtime license component ${index + 1} binary differs from the OCI artifact`,
        )
      license = validateLicenseRecord(
        component.license,
        `runtime license component ${index + 1}`,
        { allowedOrigins: ["source-inventory"] },
      )
      for (const file of [...license.files, ...license.noticeFiles]) {
        const sourceFile = resolve(frontendSource.sourceRoot, file.path)
        if (
          sourceFiles.get(file.path) !== file.sha256 ||
          relative(frontendSource.sourceRoot, sourceFile) !== file.path ||
          requireRegularFile(
            sourceFile,
            `runtime license component ${index + 1} source legal file`,
          ).size !== file.bytes ||
          sha256File(sourceFile) !== file.sha256
        )
          fail(
            `runtime license component ${index + 1} legal file differs from source inventory`,
          )
      }
    } else if (kind === "go-module-zip") {
      exactKeys(
        component.source,
        [
          "kind",
          "archivePath",
          "archiveBytes",
          "archiveSha256",
          "goSumH1",
          "goModPath",
          "goModBytes",
          "goModSha256",
          "goModSumH1",
          "infoPath",
          "infoBytes",
          "infoSha256",
        ],
        `runtime license component ${index + 1} source`,
      )
      const archive = custodyFile(
        custody,
        component.source.archivePath,
        component.source.archiveBytes,
        component.source.archiveSha256,
        `runtime license component ${index + 1} module zip`,
      )
      const goMod = custodyFile(
        custody,
        component.source.goModPath,
        component.source.goModBytes,
        component.source.goModSha256,
        `runtime license component ${index + 1} go.mod`,
      )
      custodyFile(
        custody,
        component.source.infoPath,
        component.source.infoBytes,
        component.source.infoSha256,
        `runtime license component ${index + 1} module info`,
      )
      if (
        sums.get(`${component.name} ${component.version}`) !==
          component.source.goSumH1 ||
        sums.get(`${component.name} ${component.version}/go.mod`) !==
          component.source.goModSumH1 ||
        goModHash(readFileSync(goMod)) !== component.source.goModSumH1
      )
        fail(`runtime license component ${index + 1} differs from go.sum`)
      license = validateLicenseRecord(
        component.license,
        `runtime license component ${index + 1}`,
        { allowedOrigins: ["module-archive"], allowArchiveEntry: true },
      )
      const archiveEvidence = readZipEntries(
        archive,
        [...license.files, ...license.noticeFiles].map(
          ({ archiveEntry }) => archiveEntry,
        ),
        `runtime license component ${index + 1} module zip`,
      )
      if (archiveEvidence.dirHash !== component.source.goSumH1)
        fail(
          `runtime license component ${index + 1} module zip hash differs from go.sum`,
        )
      for (const file of [...license.files, ...license.noticeFiles]) {
        const contents = archiveEvidence.entries.get(file.archiveEntry)
        const extracted = custodyFile(
          custody,
          file.path,
          file.bytes,
          file.sha256,
          `runtime license component ${index + 1} extracted legal file`,
        )
        if (
          contents.length !== file.bytes ||
          sha256Bytes(contents) !== file.sha256 ||
          !contents.equals(readFileSync(extracted))
        )
          fail(
            `runtime license component ${index + 1} legal archive entry differs`,
          )
      }
    } else if (kind === "go-toolchain-source") {
      exactKeys(
        component.source,
        [
          "kind",
          "goVersion",
          "builderPlatformDigest",
          "sourceArchiveUrl",
          "sourceArchivePath",
          "sourceArchiveBytes",
          "sourceArchiveSha256",
          "licenseArchiveEntry",
        ],
        `runtime license component ${index + 1} source`,
      )
      const archive = custodyFile(
        custody,
        component.source.sourceArchivePath,
        component.source.sourceArchiveBytes,
        component.source.sourceArchiveSha256,
        `runtime license component ${index + 1} toolchain source`,
      )
      if (
        component.source.goVersion !== "go1.25.13" ||
        component.source.builderPlatformDigest !== goBuilder?.platformDigest ||
        component.source.sourceArchiveUrl !==
          "https://go.dev/dl/go1.25.13.src.tar.gz" ||
        component.source.sourceArchiveSha256 !==
          "1d7e2f70b1ee9b93c7df8efcca71f5adcc6a59797a4336c2d10171bd4c174614"
      )
        fail(`runtime license component ${index + 1} toolchain source differs`)
      license = validateLicenseRecord(
        component.license,
        `runtime license component ${index + 1}`,
        {
          allowedOrigins: ["toolchain-source-archive"],
          allowArchiveEntry: true,
        },
      )
      if (
        !license.files.some(
          ({ archiveEntry }) =>
            archiveEntry === component.source.licenseArchiveEntry,
        )
      )
        fail(
          `runtime license component ${index + 1} toolchain LICENSE entry differs`,
        )
      const archiveEntries = readGzipTarEntries(
        archive,
        [...license.files, ...license.noticeFiles].map(
          ({ archiveEntry }) => archiveEntry,
        ),
        `runtime license component ${index + 1} toolchain source`,
      )
      for (const file of [...license.files, ...license.noticeFiles]) {
        const contents = archiveEntries.get(file.archiveEntry)
        const extracted = custodyFile(
          custody,
          file.path,
          file.bytes,
          file.sha256,
          `runtime license component ${index + 1} extracted legal file`,
        )
        if (
          contents.length !== file.bytes ||
          sha256Bytes(contents) !== file.sha256 ||
          !contents.equals(readFileSync(extracted))
        )
          fail(
            `runtime license component ${index + 1} legal archive entry differs`,
          )
      }
    } else fail(`runtime license component ${index + 1} source kind is invalid`)
    return {
      sbomBomRef: component.sbomBomRef,
      purl: component.purl,
      name: component.name,
      version: component.version,
      source: clone(component.source),
      license,
    }
  })
  const refs = new Set(components.map(({ sbomBomRef }) => sbomBomRef))
  if (
    refs.size !== components.length ||
    refs.size !== expectedByRef.size ||
    [...expectedByRef.keys()].some((ref) => !refs.has(ref)) ||
    canonicalJson(components.map(({ sbomBomRef }) => sbomBomRef)) !==
      canonicalJson([...refs].sort(compareText))
  )
    fail("runtime license components are incomplete, duplicated, or unsorted")
  const mainComponents = components.filter(
    ({ source }) => source.kind === "main-module-source",
  )
  const artifactFiles = components.filter(
    ({ source }) => source.kind === "runtime-artifact-file",
  )
  if (
    mainComponents.length !== 1 ||
    artifactFiles.length !== 1 ||
    canonicalJson(artifactFiles[0].license) !==
      canonicalJson(mainComponents[0].license)
  )
    fail(
      "runtime artifact file license does not bind the main Portainer source",
    )
  requireNoCommercialIdentifiers(
    components.flatMap((component) => [
      component.sbomBomRef,
      component.purl,
      component.name,
      ...component.license.files.map(({ path, archiveEntry }) => [
        path,
        archiveEntry,
      ]),
    ]),
    "runtime license input",
  )
  return {
    schema: raw.schema,
    generatedAt: normalizeIsoTimestamp(
      raw.generatedAt,
      "runtime license generatedAt",
    ),
    artifact: clone(raw.artifact),
    custody: {
      root: raw.custody.root,
      manifestPath: custody.manifestPath,
      manifestSha256: custody.manifestSha256,
    },
    components,
    coverage: validateLicenseCoverage(
      raw.coverage,
      refs,
      "runtime license coverage",
    ),
    rawSha256,
  }
}

function cyclonedxLicense(record) {
  return [{ expression: record.concludedExpression }]
}

function normalizedDependencyMap(raw, componentRefs) {
  const references = new Set(componentRefs)
  const dependencies = new Map()
  for (const dependency of raw?.dependencies ?? []) {
    if (
      references.has(dependency?.ref) &&
      Array.isArray(dependency.dependsOn)
    ) {
      dependencies.set(
        dependency.ref,
        [
          ...new Set(dependency.dependsOn.filter((ref) => references.has(ref))),
        ].sort(compareText),
      )
    }
  }
  return dependencies
}

function normalizeFrontendSbom(
  raw,
  metadata,
  sourcePackage,
  artifact,
  frontendSource,
  frontendRuntime,
  frontendLicense,
  rawSha256,
) {
  const tools = raw?.metadata?.tools?.components
  if (
    raw?.bomFormat !== "CycloneDX" ||
    !["1.6", "1.7"].includes(raw?.specVersion) ||
    !Array.isArray(tools) ||
    !tools.some(
      (tool) =>
        String(tool?.name).toLowerCase() === "syft" &&
        tool?.version === metadata.frontend.syft.version,
    ) ||
    !Array.isArray(raw?.components) ||
    raw.components.length === 0
  ) {
    fail(
      "raw frontend Syft SBOM is incomplete or differs from the scanner identity",
    )
  }
  requireNoCommercialIdentifiers(
    raw.components.flatMap(componentIdentifiers),
    "raw frontend CycloneDX SBOM",
  )
  const rawByNameVersion = new Map()
  for (const component of raw.components) {
    if (
      typeof component?.name !== "string" ||
      component.name.length === 0 ||
      typeof component?.version !== "string" ||
      component.version.length === 0 ||
      typeof component?.["bom-ref"] !== "string" ||
      component["bom-ref"].length === 0
    ) {
      continue
    }
    const key = `${component.name}\u0000${component.version}`
    const values = rawByNameVersion.get(key) ?? []
    values.push(component)
    rawByNameVersion.set(key, values)
  }
  const rawToNormalizedRef = new Map()
  const components = frontendLicense.components.map((component) => {
    const acceptedVersions = new Set([
      component.version,
      ...(component.source.kind === "git-tarball"
        ? [component.source.tarballUrl]
        : []),
    ])
    const matches = [...acceptedVersions].flatMap(
      (version) =>
        rawByNameVersion.get(`${component.name}\u0000${version}`) ?? [],
    )
    const uniqueMatches = [
      ...new Map(matches.map((entry) => [entry["bom-ref"], entry])).values(),
    ]
    if (uniqueMatches.length === 0) {
      fail(`raw frontend Syft SBOM does not cover ${component.bomRef}`)
    }
    for (const match of uniqueMatches) {
      rawToNormalizedRef.set(match["bom-ref"], component.bomRef)
    }
    const sourceProperties = [
      {
        name: "llm-machines:pnpm-lock-key",
        value: component.source.lockKey,
      },
      {
        name: "llm-machines:source-kind",
        value: component.source.kind,
      },
      {
        name: "llm-machines:package-manifest-sha256",
        value: component.source.packageManifestSha256,
      },
      ...(component.source.kind === "git-tarball"
        ? [
            {
              name: "llm-machines:source-revision",
              value: component.source.revision,
            },
            {
              name: "llm-machines:source-archive-sha256",
              value: component.source.archiveSha256,
            },
          ]
        : [
            {
              name: "llm-machines:source-integrity",
              value: component.source.integrity,
            },
          ]),
      {
        name: "llm-machines:source-map-paths",
        value: component.bundle.sourceMapPaths.join(","),
      },
      {
        name: "llm-machines:source-map-source-count",
        value: String(component.bundle.sourcePathCount),
      },
    ]
    return {
      type: "library",
      "bom-ref": component.bomRef,
      name: component.name,
      version: component.version,
      purl: component.purl,
      hashes: [
        {
          alg: "SHA-256",
          content: component.source.packageManifestSha256,
        },
      ],
      licenses: cyclonedxLicense(component.license),
      properties: sourceProperties.sort((left, right) =>
        compareText(left.name, right.name),
      ),
    }
  })
  const frontendRef = `frontend:${sourcePackage.downstream.mirrorRepository}@${sourcePackage.downstream.version}`
  const frontendComponent = {
    type: "application",
    "bom-ref": frontendRef,
    name: "portainer-ce-frontend",
    version: sourcePackage.downstream.version,
    hashes: [{ alg: "SHA-256", content: frontendRuntime.inventorySha256 }],
    licenses: [{ expression: sourcePackage.upstream.license }],
    properties: [
      {
        name: "llm-machines:oci-platform-manifest-digest",
        value: artifact.manifestDigest,
      },
      {
        name: "llm-machines:public-inventory-sha256",
        value: frontendRuntime.inventorySha256,
      },
      {
        name: "llm-machines:source-inventory-sha256",
        value: frontendSource.sourceInventorySha256,
      },
      {
        name: "llm-machines:source-map-inventory-sha256",
        value: frontendRuntime.sourceMapInventorySha256,
      },
    ],
  }
  const rawDependencies = normalizedDependencyMap(
    raw,
    rawToNormalizedRef.keys(),
  )
  const dependencies = components.map((component) => {
    const rawReferences = [...rawToNormalizedRef.entries()]
      .filter(([, normalized]) => normalized === component["bom-ref"])
      .map(([reference]) => reference)
    return {
      ref: component["bom-ref"],
      dependsOn: [
        ...new Set(
          rawReferences
            .flatMap((reference) => rawDependencies.get(reference) ?? [])
            .map((reference) => rawToNormalizedRef.get(reference))
            .filter(Boolean),
        ),
      ].sort(compareText),
    }
  })
  const sbom = {
    bomFormat: "CycloneDX",
    specVersion: raw.specVersion,
    version: 1,
    metadata: {
      tools: {
        components: [
          {
            type: "application",
            name: "syft",
            version: metadata.frontend.syft.version,
          },
        ],
      },
      component: frontendComponent,
      properties: [{ name: "llm-machines:raw-syft-sha256", value: rawSha256 }],
    },
    components: components.sort((left, right) =>
      compareText(left["bom-ref"], right["bom-ref"]),
    ),
    dependencies: [
      {
        ref: frontendRef,
        dependsOn: components
          .map(({ "bom-ref": ref }) => ref)
          .sort(compareText),
      },
      ...dependencies.sort((left, right) => compareText(left.ref, right.ref)),
    ],
  }
  requireNoCommercialIdentifiers(
    [
      ...componentIdentifiers(sbom.metadata.component),
      ...sbom.components.flatMap(componentIdentifiers),
    ],
    "frontend CycloneDX SBOM",
  )
  return sbom
}

function normalizeFrontendTrivy(
  raw,
  metadata,
  sourcePackage,
  artifact,
  frontendSource,
  frontendRuntime,
  frontendLicense,
  rawSha256,
) {
  if (
    raw?.SchemaVersion !== 2 ||
    raw?.Trivy?.Version !== metadata.frontend.trivy.version ||
    raw?.ArtifactType !== "filesystem" ||
    !Array.isArray(raw?.Results) ||
    raw.Results.length === 0 ||
    (Array.isArray(raw?.Errors) && raw.Errors.length > 0)
  ) {
    fail("raw frontend Trivy report is incomplete or reports scan errors")
  }
  requireNoCommercialIdentifiers(
    trivyIdentifiers(raw),
    "raw frontend Trivy report",
  )
  const pnpmResults = raw.Results.filter(
    (result) => result?.Class === "lang-pkgs" && result?.Type === "pnpm",
  )
  if (pnpmResults.length !== 1 || !Array.isArray(pnpmResults[0].Packages)) {
    fail("raw frontend Trivy report lacks one exact pnpm inventory")
  }
  const pnpm = pnpmResults[0]
  const packagesByNameVersion = new Map()
  for (const entry of pnpm.Packages) {
    const key = `${entry?.Name}\u0000${entry?.Version}`
    const values = packagesByNameVersion.get(key) ?? []
    values.push(entry)
    packagesByNameVersion.set(key, values)
  }
  const runtimePackages = frontendLicense.components.map((component) => {
    const matches =
      packagesByNameVersion.get(
        `${component.name}\u0000${component.version}`,
      ) ?? []
    if (matches.length === 0) {
      fail(`raw frontend Trivy report does not cover ${component.bomRef}`)
    }
    return {
      bomRef: component.bomRef,
      name: component.name,
      version: component.version,
      purl: component.purl,
      lockKey: component.source.lockKey,
      rawPackages: matches
        .map(clone)
        .sort((left, right) =>
          compareText(canonicalJson(left), canonicalJson(right)),
        ),
    }
  })
  const runtimeKeys = new Set(
    runtimePackages.map(({ name, version }) => `${name}\u0000${version}`),
  )
  const vulnerabilities = (pnpm.Vulnerabilities ?? [])
    .filter((finding) =>
      runtimeKeys.has(`${finding?.PkgName}\u0000${finding?.InstalledVersion}`),
    )
    .map(clone)
    .sort((left, right) =>
      compareText(canonicalJson(left), canonicalJson(right)),
    )
  const severityCounts = Object.fromEntries(
    ["UNKNOWN", "LOW", "MEDIUM", "HIGH", "CRITICAL"].map((severity) => [
      severity,
      vulnerabilities.filter((finding) => finding?.Severity === severity)
        .length,
    ]),
  )
  const results = raw.Results.map((result) => {
    const normalized = clone(result)
    for (const field of [
      "Packages",
      "Vulnerabilities",
      "Misconfigurations",
      "Secrets",
      "Licenses",
    ]) {
      if (Array.isArray(normalized[field])) {
        normalized[field].sort((left, right) =>
          compareText(canonicalJson(left), canonicalJson(right)),
        )
      }
    }
    return normalized
  }).sort((left, right) => compareText(trivySortKey(left), trivySortKey(right)))
  return {
    SchemaVersion: 2,
    ArtifactName: `${sourcePackage.upstream.repository}@${sourcePackage.upstream.revision}`,
    ArtifactType: "filesystem",
    Results: results,
    LLMMEvidence: {
      sourceRevision: sourcePackage.upstream.revision,
      sourceTree: sourcePackage.upstream.tree,
      sourceInventorySha256: frontendSource.sourceInventorySha256,
      artifactManifestDigest: artifact.manifestDigest,
      publicInventorySha256: frontendRuntime.inventorySha256,
      sourceMapInventorySha256: frontendRuntime.sourceMapInventorySha256,
      rawReportSha256: rawSha256,
      scanner: {
        name: "trivy",
        version: metadata.frontend.trivy.version,
        toolImageDigest: metadata.frontend.trivy.toolImageDigest,
      },
      database: {
        updatedAt: metadata.frontend.trivy.databaseUpdatedAt,
        sha256: metadata.frontend.trivy.databaseSha256,
      },
      scannedAt: metadata.scannedAt,
      runtimeProjection: {
        packageCount: runtimePackages.length,
        packages: runtimePackages,
        vulnerabilityCount: vulnerabilities.length,
        severityCounts,
        vulnerabilities,
      },
    },
  }
}

function frontendRuntimeBindingFor({
  sourcePackage,
  artifact,
  frontendSource,
  runtimeA,
  runtimeB,
  frontendLicense,
}) {
  return {
    schema: "llm-machines.portainer-ce-frontend-runtime-binding.v1",
    status: "SOURCE_SECURITY_CHARACTERIZED_NOT_CORE_ADMITTED",
    accepted: false,
    runtimeQualified: false,
    source: frontendSourceProjection(frontendSource),
    artifact: {
      ociArchiveSha256: artifact.ociArchiveSha256,
      manifestDigest: artifact.manifestDigest,
      configDigest: artifact.configDigest,
      layerDigests: artifact.layers.map(({ digest }) => digest),
    },
    assemblies: [
      {
        id: "A",
        publicInventorySha256: runtimeA.inventorySha256,
        publicFileCount: runtimeA.fileCount,
        publicBytes: runtimeA.bytes,
        sourceMapInventorySha256: runtimeA.sourceMapInventorySha256,
        sourceMapCount: runtimeA.sourceMaps.length,
        sourcePathCount: runtimeA.sourcePathCount,
        packageStoreIdentityCount: runtimeA.packageStoreIdentityCount,
      },
      {
        id: "B",
        publicInventorySha256: runtimeB.inventorySha256,
        publicFileCount: runtimeB.fileCount,
        publicBytes: runtimeB.bytes,
        sourceMapInventorySha256: runtimeB.sourceMapInventorySha256,
        sourceMapCount: runtimeB.sourceMaps.length,
        sourcePathCount: runtimeB.sourcePathCount,
        packageStoreIdentityCount: runtimeB.packageStoreIdentityCount,
      },
    ],
    runtime: {
      path: runtimeA.path,
      fileCount: runtimeA.fileCount,
      bytes: runtimeA.bytes,
      inventorySha256: runtimeA.inventorySha256,
      files: runtimeA.files,
      sourceMapCount: runtimeA.sourceMaps.length,
      sourceMapInventorySha256: runtimeA.sourceMapInventorySha256,
      sourceMaps: runtimeA.sourceMaps,
      sourcePathCount: runtimeA.sourcePathCount,
      packageStoreIdentityCount: runtimeA.packageStoreIdentityCount,
      componentCount: frontendLicense.components.length,
      components: frontendLicense.components.map((component) => ({
        bomRef: component.bomRef,
        name: component.name,
        version: component.version,
        lockKey: component.source.lockKey,
        sourceMapPaths: component.bundle.sourceMapPaths,
        sourcePathCount: component.bundle.sourcePathCount,
      })),
    },
  }
}

function applyRuntimeLicenses(sbom, runtimeLicense) {
  const licenses = new Map(
    runtimeLicense.components.map((component) => [
      component.sbomBomRef,
      component.license,
    ]),
  )
  const components = sbom.components.map((component) => {
    const license = licenses.get(component["bom-ref"])
    if (!license) {
      fail(
        `runtime SBOM component lacks reviewed license: ${component["bom-ref"]}`,
      )
    }
    return { ...clone(component), licenses: cyclonedxLicense(license) }
  })
  return {
    ...clone(sbom),
    metadata: {
      ...clone(sbom.metadata),
      component: {
        ...clone(sbom.metadata.component),
        licenses: [{ expression: "Zlib" }],
      },
    },
    components,
  }
}

function combineSboms(runtimeSbom, frontendSbom) {
  const runtimeRoot = runtimeSbom.metadata.component["bom-ref"]
  const frontendRoot = frontendSbom.metadata.component["bom-ref"]
  const components = [
    ...runtimeSbom.components,
    frontendSbom.metadata.component,
    ...frontendSbom.components,
  ].sort((left, right) => compareText(left["bom-ref"], right["bom-ref"]))
  const refs = components.map((component) => component["bom-ref"])
  if (
    new Set(refs).size !== refs.length ||
    components.some(
      (component) =>
        !Array.isArray(component.licenses) || component.licenses.length === 0,
    )
  ) {
    fail("combined SBOM components are duplicated or lack license evidence")
  }
  const dependencyMap = new Map(
    [...runtimeSbom.dependencies, ...frontendSbom.dependencies].map((entry) => [
      entry.ref,
      [...entry.dependsOn],
    ]),
  )
  dependencyMap.set(
    runtimeRoot,
    [
      ...new Set([...(dependencyMap.get(runtimeRoot) ?? []), frontendRoot]),
    ].sort(compareText),
  )
  return {
    ...clone(runtimeSbom),
    components,
    dependencies: [...dependencyMap.entries()]
      .map(([ref, dependsOn]) => ({
        ref,
        dependsOn: [...dependsOn].sort(compareText),
      }))
      .sort((left, right) => compareText(left.ref, right.ref)),
  }
}

function artifactLicenseEvidenceFor({
  sourcePackage,
  artifact,
  combinedSbom,
  frontendLicense,
  runtimeLicense,
}) {
  const rootRef = combinedSbom.metadata.component["bom-ref"]
  const componentRefs = combinedSbom.components
    .map((component) => component["bom-ref"])
    .sort(compareText)
  const mainSource = runtimeLicense.components.find(
    ({ source }) => source.kind === "main-module-source",
  )
  if (!mainSource) fail("artifact license evidence lacks main Portainer source")
  if (
    mainSource.license.declaredExpression !== sourcePackage.upstream.license ||
    mainSource.license.concludedExpression !== sourcePackage.upstream.license
  ) {
    fail("frontend application license differs from main Portainer source")
  }
  const componentEvidence = [
    ...runtimeLicense.components.map((component) => ({
      scope:
        component.source.kind === "runtime-artifact-file"
          ? "runtime-artifact-file"
          : "runtime-go",
      bomRef: component.sbomBomRef,
      source: component.source,
      license: component.license,
    })),
    ...frontendLicense.components.map((component) => ({
      scope: "frontend-npm",
      bomRef: component.bomRef,
      source: component.source,
      license: component.license,
    })),
    {
      scope: "frontend-application",
      bomRef: `frontend:${sourcePackage.downstream.mirrorRepository}@${sourcePackage.downstream.version}`,
      source: {
        kind: "main-module-frontend",
        packageJsonSha256: frontendLicense.packageManager.packageJson.sha256,
        licenseSourceBomRef: mainSource.sbomBomRef,
      },
      license: mainSource.license,
    },
  ].sort((left, right) => compareText(left.bomRef, right.bomRef))
  const evidenceRefs = componentEvidence.map(({ bomRef }) => bomRef)
  if (
    canonicalJson(evidenceRefs) !== canonicalJson(componentRefs) ||
    combinedSbom.components.some(
      (component) =>
        !Array.isArray(component.licenses) || component.licenses.length === 0,
    )
  ) {
    fail("artifact license evidence does not cover the combined SBOM")
  }
  return {
    schema: "llm-machines.portainer-ce-artifact-license-evidence.v1",
    status: "SOURCE_SECURITY_CHARACTERIZED_NOT_CORE_ADMITTED",
    accepted: false,
    runtimeQualified: false,
    artifact: {
      manifestDigest: artifact.manifestDigest,
      ociArchiveSha256: artifact.ociArchiveSha256,
      combinedSbomSha256: sha256Bytes(`${canonicalJson(combinedSbom)}\n`),
    },
    root: {
      bomRef: rootRef,
      declaredExpression: sourcePackage.upstream.license,
      concludedExpression: sourcePackage.upstream.license,
    },
    inputs: {
      frontendLicenseInputSha256: frontendLicense.rawSha256,
      runtimeLicenseInputSha256: runtimeLicense.rawSha256,
    },
    custody: {
      archiveCustodyMode: "EXTERNAL_SEALED_DIGEST_BOUND",
      frontend: clone(frontendLicense.custody),
      runtime: clone(runtimeLicense.custody),
    },
    coverage: {
      expectedComponentCount: componentRefs.length,
      reviewedComponentCount: componentEvidence.length,
      expectedRefsSha256: sha256Bytes(`${canonicalJson(componentRefs)}\n`),
      missingRefs: [],
      unknownExpressions: [],
      missingRequiredTexts: [],
      copyleftRefs: [
        ...new Set([
          ...frontendLicense.coverage.copyleftRefs,
          ...runtimeLicense.coverage.copyleftRefs,
        ]),
      ].sort(compareText),
      prohibitedRefs: [],
      complete: true,
    },
    components: componentEvidence,
    artifactLicenseEvidenceComplete: true,
  }
}

function parseJsonStream(input, field) {
  const documents = []
  let start = -1
  let depth = 0
  let string = false
  let escaped = false
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]
    if (start === -1) {
      if (/\s/.test(character)) continue
      if (character !== "{") fail(`${field} contains a non-object value`)
      start = index
      depth = 1
      continue
    }
    if (string) {
      if (escaped) escaped = false
      else if (character === "\\") escaped = true
      else if (character === '"') string = false
      continue
    }
    if (character === '"') string = true
    else if (character === "{") depth += 1
    else if (character === "}") {
      depth -= 1
      if (depth === 0) {
        try {
          documents.push(JSON.parse(input.slice(start, index + 1)))
        } catch {
          fail(`${field} contains invalid JSON`)
        }
        start = -1
      }
    }
  }
  if (start !== -1 || string || depth !== 0) fail(`${field} is truncated`)
  return documents
}

function canonicalizeGovulncheck(file, field, mode, scanMetadata) {
  requireRegularFile(file, field)
  const input = readFileSync(file, "utf8")
  const documents = parseJsonStream(input, field)
  const configs = documents.filter((document) => document?.config)
  const errors = documents.filter((document) =>
    Object.hasOwn(document ?? {}, "error"),
  )
  const ambiguousSboms = documents.filter(
    (document) => document?.sbom !== undefined && document?.SBOM !== undefined,
  )
  const sboms = documents
    .filter(
      (document) =>
        (document?.sbom !== undefined) !== (document?.SBOM !== undefined),
    )
    .map((document) => document.sbom ?? document.SBOM)
  const findings = documents
    .filter((document) => document?.finding)
    .map(({ finding }) => finding)
  const osvDocuments = documents
    .filter((document) => document?.osv)
    .map(({ osv }) => osv)
  const config = configs[0]?.config
  const databaseUpdatedAt = normalizeIsoTimestamp(
    config?.db_last_modified,
    `${field} database timestamp`,
  )
  const databaseAge =
    Date.parse(scanMetadata.scannedAt) - Date.parse(databaseUpdatedAt)
  const osvById = new Map()
  let conflictingOsvDocument = false
  for (const osv of osvDocuments) {
    const canonical = canonicalJson(osv)
    if (osvById.has(osv?.id) && osvById.get(osv.id) !== canonical) {
      conflictingOsvDocument = true
    } else {
      osvById.set(osv?.id, canonical)
    }
  }
  const osvIds = new Set(osvById.keys())
  if (
    documents.length === 0 ||
    configs.length !== 1 ||
    errors.length > 0 ||
    ambiguousSboms.length > 0 ||
    config?.protocol_version !== "v1.0.0" ||
    config?.scanner_name !== "govulncheck" ||
    config?.scanner_version !== "v1.7.0" ||
    config?.scan_level !== "symbol" ||
    config?.scan_mode !== mode ||
    config?.db !== "https://vuln.go.dev" ||
    (mode === "source" && config?.go_version !== "go1.25.13") ||
    sboms.length === 0 ||
    sboms.some(
      (sbom) =>
        sbom?.go_version !== "go1.25.13" ||
        !Array.isArray(sbom?.modules) ||
        sbom.modules.length === 0,
    ) ||
    findings.length === 0 ||
    osvDocuments.length === 0 ||
    conflictingOsvDocument ||
    [...osvIds].some((id) => !/^GO-\d{4}-\d+$/.test(id ?? "")) ||
    findings.some(
      (finding) =>
        !osvIds.has(finding?.osv) ||
        !Array.isArray(finding?.trace) ||
        finding.trace.length === 0 ||
        finding.trace.some(
          (frame) =>
            typeof frame?.module !== "string" || frame.module.length === 0,
        ),
    ) ||
    databaseAge < 0 ||
    databaseAge > 72 * 60 * 60 * 1000
  ) {
    fail(`${field} is not complete symbol-level govulncheck v1.7.0 evidence`)
  }
  requireNoCommercialIdentifiers(
    [
      ...sboms.flatMap((sbom) =>
        sbom.modules.flatMap((module) => [module?.path, module?.version]),
      ),
      ...osvDocuments.flatMap((osv) =>
        (osv?.affected ?? []).flatMap((affected) => [
          affected?.package?.name,
          affected?.package?.ecosystem,
        ]),
      ),
      ...findings.flatMap((finding) =>
        finding.trace.flatMap((frame) => [
          frame?.module,
          frame?.package,
          frame?.function,
          frame?.receiver,
        ]),
      ),
    ],
    field,
  )
  const output = `${documents.map(canonicalJson).join("\n")}\n`
  return output
}

function provenanceFor({
  sourcePackage,
  artifact,
  assemblyRecords,
  inputDigests,
  frontendSource,
  frontendRuntime,
  frontendLicense,
}) {
  const startedOn = assemblyRecords
    .map(({ build }) => build.startedOn)
    .sort()[0]
  const finishedOn = assemblyRecords
    .map(({ build }) => build.finishedOn)
    .sort()
    .at(-1)
  const resolvedDependencies = [
    {
      uri: sourcePackage.upstream.archiveUrl,
      digest: { sha256: sourcePackage.upstream.archiveSha256 },
    },
    ...[
      sourcePackage.downstream.patch,
      sourcePackage.downstream.dockerfile,
      sourcePackage.downstream.dockerignore,
    ].map(({ path, sha256 }) => ({ uri: `file:${path}`, digest: { sha256 } })),
    ...Object.values(sourcePackage.downstream.evidenceTooling).map(
      ({ path, sha256 }) => ({ uri: `file:${path}`, digest: { sha256 } }),
    ),
    ...sourcePackage.downstream.buildInputs.map((input) => ({
      uri: `oci:${input.repository}@${input.platformDigest}`,
      digest: { sha256: input.platformDigest.slice(7) },
    })),
    {
      uri: sourcePackage.downstream.pnpm.tarballUrl,
      digest: { sha256: sourcePackage.downstream.pnpm.tarballSha256 },
    },
    {
      uri: `oci:${sourcePackage.downstream.buildToolchain.buildkit.repository}@${sourcePackage.downstream.buildToolchain.buildkit.platformDigest}`,
      digest: {
        sha256:
          sourcePackage.downstream.buildToolchain.buildkit.platformDigest.slice(
            7,
          ),
      },
    },
    ...frontendLicense.components.map(({ source }) => ({
      uri:
        source.kind === "git-tarball"
          ? source.tarballUrl
          : `npm:${source.lockKey}`,
      digest: { sha256: source.archiveSha256 },
    })),
  ].sort((left, right) => compareText(left.uri, right.uri))
  return {
    _type: "https://in-toto.io/Statement/v1",
    subject: [
      {
        name: sourcePackage.downstream.mirrorRepository,
        digest: { sha256: artifact.manifestDigest.slice(7) },
      },
    ],
    predicateType: "https://slsa.dev/provenance/v1",
    predicate: {
      buildDefinition: {
        buildType:
          "https://llm-machines.invalid/build-types/portainer-ce-downstream/v1",
        externalParameters: {
          sourceRevision: sourcePackage.upstream.revision,
          sourceTree: sourcePackage.upstream.tree,
          sourceArchiveSha256: sourcePackage.upstream.archiveSha256,
          sourceInventorySha256:
            sourcePackage.downstream.sourceInventory.sha256SumsSha256,
          dockerfileSha256: sourcePackage.downstream.dockerfile.sha256,
          dockerignoreSha256: sourcePackage.downstream.dockerignore.sha256,
          patchSha256: sourcePackage.downstream.patch.sha256,
          platform: sourcePackage.downstream.platform,
          frontendPackageJsonSha256: frontendSource.packageJsonSha256,
          frontendPnpmLockSha256: frontendSource.pnpmLockSha256,
          frontendWebpackProductionSha256:
            frontendSource.webpackProductionSha256,
          frontendWebpackCommonSha256: frontendSource.webpackCommonSha256,
          frontendPublicInventorySha256: frontendRuntime.inventorySha256,
          frontendSourceMapInventorySha256:
            frontendRuntime.sourceMapInventorySha256,
        },
        internalParameters: {
          sourceDateEpoch: sourcePackage.upstream.sourceDateEpoch,
          noCache: true,
          provenanceExporter: false,
          sbomExporter: false,
          rewriteTimestamp: true,
        },
        resolvedDependencies,
      },
      runDetails: {
        builder: {
          id: "https://llm-machines.invalid/build-actors/portainer-ce-admission",
        },
        metadata: {
          invocationId: `sha256:${sha256Bytes(canonicalJson(inputDigests))}`,
          startedOn,
          finishedOn,
          completeness: {
            parameters: true,
            environment: true,
            materials: true,
          },
          reproducible: true,
        },
        byproducts: assemblyRecords
          .flatMap((record) =>
            record.evidence.map(({ id, sha256 }) => ({
              name: `assembly-${record.assembly.toLowerCase()}-${id}`,
              digest: { sha256 },
            })),
          )
          .sort((left, right) => compareText(left.name, right.name)),
      },
    },
  }
}

function reachabilityProjection(records) {
  const [first, ...remaining] = records
  if (
    !first?.reachability ||
    new Set(records.map(({ reachability }) => reachability?.sourceRoot))
      .size !== records.length ||
    remaining.some(
      ({ reachability }) =>
        canonicalJson(reachability?.validator) !==
          canonicalJson(first.reachability.validator) ||
        canonicalJson(reachability?.angularJsVex) !==
          canonicalJson(first.reachability.angularJsVex),
    )
  ) {
    fail("independent reachability receipt contracts differ")
  }
  return {
    validator: clone(first.reachability.validator),
    angularJsVex: clone(first.reachability.angularJsVex),
    assemblies: records
      .map((record) => ({
        id: record.assembly,
        evaluatedAt: record.reachability.evaluatedAt,
        receiptSha256: record.reachability.receiptSha256,
      }))
      .sort((left, right) => compareText(left.id, right.id)),
  }
}

function exactArtifactProjection(artifact) {
  return {
    ociArchiveSha256: artifact.ociArchiveSha256,
    ociArchiveBytes: artifact.ociArchiveBytes,
    indexDigest: artifact.indexDigest,
    manifestDigest: artifact.manifestDigest,
    configDigest: artifact.configDigest,
    platform: artifact.platform,
    layers: artifact.layers,
    runtimeInventorySha256: artifact.runtimeInventorySha256,
  }
}

function writeCanonical(file, value) {
  const ordered = JSON.parse(canonicalJson(value))
  writeFileSync(file, `${JSON.stringify(ordered, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  })
}

export function generatePortainerEvidence({
  assemblyA,
  assemblyB,
  assemblyARecord,
  assemblyBRecord,
  frontendSourceInventory,
  frontendSbomInput,
  frontendTrivyInput,
  frontendLicenseInput,
  runtimeLicenseInput,
  sbomInput,
  trivyInput,
  sourceGovulncheckInput,
  binaryGovulncheckInput,
  scanMetadata,
  outputRoot,
  sourcePackagePath = defaultSourcePackagePath,
}) {
  const paths = Object.fromEntries(
    Object.entries({
      assemblyA,
      assemblyB,
      assemblyARecord,
      assemblyBRecord,
      frontendSourceInventory,
      frontendSbomInput,
      frontendTrivyInput,
      frontendLicenseInput,
      runtimeLicenseInput,
      sbomInput,
      trivyInput,
      sourceGovulncheckInput,
      binaryGovulncheckInput,
      scanMetadata,
      outputRoot,
      sourcePackagePath,
    }).map(([key, value]) => {
      if (typeof value !== "string" || value.length === 0) {
        fail(`${key} is required`)
      }
      return [key, resolve(value)]
    }),
  )
  if (existsSync(paths.outputRoot)) fail("evidence output root already exists")
  requireRegularFile(paths.assemblyA, "Assembly A OCI archive")
  requireRegularFile(paths.assemblyB, "Assembly B OCI archive")

  const sourcePackage = readJson(paths.sourcePackagePath, "source package")
  validateGenerationSourcePackage(sourcePackage, paths.sourcePackagePath)
  const frontendSource = readFrontendSourceInventory(
    paths.frontendSourceInventory,
    sourcePackage,
  )
  const artifactA = readOciMetadata(paths.assemblyA)
  const artifactB = readOciMetadata(paths.assemblyB)
  if (
    canonicalJson(exactArtifactProjection(artifactA)) !==
    canonicalJson(exactArtifactProjection(artifactB))
  ) {
    fail("independent Portainer OCI assemblies are not byte-identical")
  }
  const frontendRuntimeA = frontendRuntimeInventory(paths.assemblyA, artifactA)
  const frontendRuntimeB = frontendRuntimeInventory(paths.assemblyB, artifactB)
  if (canonicalJson(frontendRuntimeA) !== canonicalJson(frontendRuntimeB)) {
    fail("independent Portainer frontend assemblies are not byte-identical")
  }
  const recordA = validateAssemblyRecord(
    readJson(paths.assemblyARecord, "Assembly A record"),
    paths.assemblyARecord,
    "A",
    sourcePackage,
  )
  const recordB = validateAssemblyRecord(
    readJson(paths.assemblyBRecord, "Assembly B record"),
    paths.assemblyBRecord,
    "B",
    sourcePackage,
  )
  const reachability = reachabilityProjection([recordA, recordB])
  const scan = validateScanMetadata(
    readJson(paths.scanMetadata, "scan metadata"),
    artifactA,
    frontendSource,
  )
  const rawSbom = readJson(paths.sbomInput, "raw Syft SBOM")
  const rawTrivy = readJson(paths.trivyInput, "raw Trivy report")
  const rawFrontendSbom = readJson(
    paths.frontendSbomInput,
    "raw frontend Syft SBOM",
  )
  const rawFrontendTrivy = readJson(
    paths.frontendTrivyInput,
    "raw frontend Trivy report",
  )
  const sourceGovulncheck = canonicalizeGovulncheck(
    paths.sourceGovulncheckInput,
    "source govulncheck evidence",
    "source",
    scan,
  )
  const binaryGovulncheck = canonicalizeGovulncheck(
    paths.binaryGovulncheckInput,
    "binary govulncheck evidence",
    "binary",
    scan,
  )
  const sourcePackageContract = sourcePackageContractProjection(sourcePackage)
  const inputDigests = {
    sourcePackageContractSha256: sha256Bytes(
      `${canonicalJson(sourcePackageContract)}\n`,
    ),
    assemblyARecordSha256: sha256File(paths.assemblyARecord),
    assemblyBRecordSha256: sha256File(paths.assemblyBRecord),
    assemblyAReachabilityReceiptSha256: recordA.reachability.receiptSha256,
    assemblyBReachabilityReceiptSha256: recordB.reachability.receiptSha256,
    rawSbomSha256: sha256File(paths.sbomInput),
    rawTrivySha256: sha256File(paths.trivyInput),
    rawSourceGovulncheckSha256: sha256File(paths.sourceGovulncheckInput),
    rawBinaryGovulncheckSha256: sha256File(paths.binaryGovulncheckInput),
    rawFrontendSbomSha256: sha256File(paths.frontendSbomInput),
    rawFrontendTrivySha256: sha256File(paths.frontendTrivyInput),
    rawFrontendLicenseInputSha256: sha256File(paths.frontendLicenseInput),
    rawRuntimeLicenseInputSha256: sha256File(paths.runtimeLicenseInput),
    frontendSourceInventorySha256: sha256File(paths.frontendSourceInventory),
    scanMetadataSha256: sha256File(paths.scanMetadata),
  }
  const runtimeSbomWithoutLicenses = normalizeSbom(
    rawSbom,
    scan,
    sourcePackage,
    artifactA,
    inputDigests.rawSbomSha256,
  )
  const trivy = normalizeTrivy(
    rawTrivy,
    scan,
    sourcePackage,
    artifactA,
    inputDigests.rawTrivySha256,
  )
  const frontendLicense = normalizeFrontendLicenseInput(
    readJson(paths.frontendLicenseInput, "frontend license input"),
    inputDigests.rawFrontendLicenseInputSha256,
    paths.frontendLicenseInput,
    sourcePackage,
    artifactA,
    frontendSource,
    frontendRuntimeA,
  )
  const runtimeLicense = normalizeRuntimeLicenseInput(
    readJson(paths.runtimeLicenseInput, "runtime license input"),
    inputDigests.rawRuntimeLicenseInputSha256,
    inputDigests.rawSbomSha256,
    paths.runtimeLicenseInput,
    sourcePackage,
    artifactA,
    runtimeSbomWithoutLicenses.components,
    frontendSource,
    frontendRuntimeA,
  )
  const frontendSbom = normalizeFrontendSbom(
    rawFrontendSbom,
    scan,
    sourcePackage,
    artifactA,
    frontendSource,
    frontendRuntimeA,
    frontendLicense,
    inputDigests.rawFrontendSbomSha256,
  )
  const frontendTrivy = normalizeFrontendTrivy(
    rawFrontendTrivy,
    scan,
    sourcePackage,
    artifactA,
    frontendSource,
    frontendRuntimeA,
    frontendLicense,
    inputDigests.rawFrontendTrivySha256,
  )
  const frontendRuntimeBinding = frontendRuntimeBindingFor({
    sourcePackage,
    artifact: artifactA,
    frontendSource,
    runtimeA: frontendRuntimeA,
    runtimeB: frontendRuntimeB,
    frontendLicense,
  })
  const runtimeSbom = applyRuntimeLicenses(
    runtimeSbomWithoutLicenses,
    runtimeLicense,
  )
  const sbom = combineSboms(runtimeSbom, frontendSbom)
  const artifactLicenseEvidence = artifactLicenseEvidenceFor({
    sourcePackage,
    artifact: artifactA,
    combinedSbom: sbom,
    frontendLicense,
    runtimeLicense,
  })
  const reproducibility = {
    schema: "llm-machines.portainer-ce-reproducibility.v1",
    status: "BYTE_IDENTICAL_TWO_ASSEMBLY_PROOF",
    byteIdentical: true,
    artifact: exactArtifactProjection(artifactA),
    frontend: {
      source: frontendSourceProjection(frontendSource),
      publicInventorySha256: frontendRuntimeA.inventorySha256,
      publicFileCount: frontendRuntimeA.fileCount,
      publicBytes: frontendRuntimeA.bytes,
      sourceMapInventorySha256: frontendRuntimeA.sourceMapInventorySha256,
      sourceMapCount: frontendRuntimeA.sourceMaps.length,
      sourcePathCount: frontendRuntimeA.sourcePathCount,
      componentCount: frontendLicense.components.length,
    },
    reachability,
    assemblies: [
      {
        id: "A",
        ...exactArtifactProjection(artifactA),
        frontendPublicInventorySha256: frontendRuntimeA.inventorySha256,
        frontendSourceMapInventorySha256:
          frontendRuntimeA.sourceMapInventorySha256,
        sealedRecordSha256: inputDigests.assemblyARecordSha256,
        evidence: clone(recordA.evidence),
      },
      {
        id: "B",
        ...exactArtifactProjection(artifactB),
        frontendPublicInventorySha256: frontendRuntimeB.inventorySha256,
        frontendSourceMapInventorySha256:
          frontendRuntimeB.sourceMapInventorySha256,
        sealedRecordSha256: inputDigests.assemblyBRecordSha256,
        evidence: clone(recordB.evidence),
      },
    ],
  }
  const provenance = provenanceFor({
    sourcePackage,
    artifact: artifactA,
    assemblyRecords: [recordA, recordB],
    inputDigests,
    frontendSource,
    frontendRuntime: frontendRuntimeA,
    frontendLicense,
  })

  const parent = dirname(paths.outputRoot)
  requireRegularFile(paths.sourcePackagePath, "source package")
  if (!existsSync(parent) || !lstatSync(parent).isDirectory()) {
    fail("evidence output parent is missing")
  }
  const temporary = mkdtempSync(
    join(parent, `.${basename(paths.outputRoot)}.tmp-`),
  )
  try {
    writeCanonical(
      join(temporary, "artifact-license-evidence.json"),
      artifactLicenseEvidence,
    )
    writeCanonical(
      join(temporary, "frontend-runtime-binding.json"),
      frontendRuntimeBinding,
    )
    writeCanonical(join(temporary, "frontend-sbom.cdx.json"), frontendSbom)
    writeCanonical(join(temporary, "frontend-trivy.json"), frontendTrivy)
    writeCanonical(join(temporary, "sbom.cdx.json"), sbom)
    writeCanonical(join(temporary, "trivy.json"), trivy)
    writeFileSync(
      join(temporary, "govulncheck-source.jsonl"),
      sourceGovulncheck,
      { flag: "wx", mode: 0o600 },
    )
    writeFileSync(
      join(temporary, "govulncheck-binary.jsonl"),
      binaryGovulncheck,
      { flag: "wx", mode: 0o600 },
    )
    writeCanonical(join(temporary, "reproducibility.json"), reproducibility)
    writeCanonical(join(temporary, "provenance.intoto.json"), provenance)
    const outputs = [
      "artifact-license-evidence.json",
      "frontend-runtime-binding.json",
      "frontend-sbom.cdx.json",
      "frontend-trivy.json",
      "govulncheck-binary.jsonl",
      "govulncheck-source.jsonl",
      "provenance.intoto.json",
      "reproducibility.json",
      "sbom.cdx.json",
      "trivy.json",
    ].map((path) => ({ path, sha256: sha256File(join(temporary, path)) }))
    const evidenceIndex = {
      schema: "llm-machines.portainer-ce-evidence-input-index.v1",
      status: "SOURCE_SECURITY_CHARACTERIZED_NOT_CORE_ADMITTED",
      accepted: false,
      runtimeQualified: false,
      contractActivation: "INACTIVE",
      containsCredentials: false,
      component: {
        id: "portainer-ce-downstream",
        version: sourcePackage.downstream.version,
        sourceRevision: sourcePackage.upstream.revision,
        sourceTree: sourcePackage.upstream.tree,
        platform: sourcePackage.downstream.platform,
      },
      artifact: exactArtifactProjection(artifactA),
      scan,
      reachability,
      frontend: {
        source: frontendSourceProjection(frontendSource),
        runtime: {
          path: frontendRuntimeA.path,
          fileCount: frontendRuntimeA.fileCount,
          bytes: frontendRuntimeA.bytes,
          inventorySha256: frontendRuntimeA.inventorySha256,
          sourceMapCount: frontendRuntimeA.sourceMaps.length,
          sourceMapInventorySha256: frontendRuntimeA.sourceMapInventorySha256,
          sourcePathCount: frontendRuntimeA.sourcePathCount,
          packageStoreIdentityCount: frontendRuntimeA.packageStoreIdentityCount,
          componentCount: frontendLicense.components.length,
        },
        scan: {
          scannedAt: scan.scannedAt,
          syft: {
            ...clone(scan.frontend.syft),
            rawReportSha256: inputDigests.rawFrontendSbomSha256,
          },
          trivy: {
            ...clone(scan.frontend.trivy),
            rawReportSha256: inputDigests.rawFrontendTrivySha256,
          },
        },
        license: {
          frontendInputSha256: frontendLicense.rawSha256,
          runtimeInputSha256: runtimeLicense.rawSha256,
          custody: {
            archiveCustodyMode: "EXTERNAL_SEALED_DIGEST_BOUND",
            frontend: clone(frontendLicense.custody),
            runtime: clone(runtimeLicense.custody),
          },
          artifactLicenseEvidenceComplete:
            artifactLicenseEvidence.artifactLicenseEvidenceComplete,
        },
      },
      inputs: inputDigests,
      evidenceTooling: clone(sourcePackage.downstream.evidenceTooling),
      generatorSha256: sha256File(fileURLToPath(import.meta.url)),
      outputs,
    }
    writeCanonical(join(temporary, "evidence-input-index.json"), evidenceIndex)
    renameSync(temporary, paths.outputRoot)
    return {
      artifact: exactArtifactProjection(artifactA),
      outputRoot: paths.outputRoot,
      outputs: [
        ...outputs,
        {
          path: "evidence-input-index.json",
          sha256: sha256File(
            join(paths.outputRoot, "evidence-input-index.json"),
          ),
        },
      ],
    }
  } catch (error) {
    rmSync(temporary, { force: true, recursive: true })
    throw error
  }
}

function parseArguments(argv) {
  if (argv.length % 2 !== 0) fail("evidence arguments must be key/value pairs")
  const values = new Map()
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    if (!key?.startsWith("--") || !value || values.has(key)) {
      fail("evidence arguments are invalid or duplicated")
    }
    values.set(key, value)
  }
  const mappings = {
    "--assembly-a": "assemblyA",
    "--assembly-b": "assemblyB",
    "--assembly-a-record": "assemblyARecord",
    "--assembly-b-record": "assemblyBRecord",
    "--frontend-source-inventory": "frontendSourceInventory",
    "--frontend-sbom-input": "frontendSbomInput",
    "--frontend-trivy-input": "frontendTrivyInput",
    "--frontend-license-input": "frontendLicenseInput",
    "--runtime-license-input": "runtimeLicenseInput",
    "--sbom-input": "sbomInput",
    "--trivy-input": "trivyInput",
    "--source-govulncheck-input": "sourceGovulncheckInput",
    "--binary-govulncheck-input": "binaryGovulncheckInput",
    "--scan-metadata": "scanMetadata",
    "--output-root": "outputRoot",
    "--source-package": "sourcePackagePath",
  }
  const required = Object.keys(mappings).filter(
    (key) => key !== "--source-package",
  )
  if (
    [...values.keys()].some((key) => !(key in mappings)) ||
    required.some((key) => !values.has(key))
  ) {
    fail(`expected ${required.join(" ")}`)
  }
  return Object.fromEntries(
    [...values.entries()].map(([key, value]) => [mappings[key], value]),
  )
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const result = generatePortainerEvidence(
      parseArguments(process.argv.slice(2)),
    )
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
