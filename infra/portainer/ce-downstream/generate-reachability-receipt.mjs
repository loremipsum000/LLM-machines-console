#!/usr/bin/env node

import { createHash } from "node:crypto"
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import {
  angularJsSecurityBoundary,
  validateReachability,
} from "./validate-reachability.mjs"

const directory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(directory, "../../..")
const sourcePackage = JSON.parse(
  readFileSync(path.join(directory, "source-package.json"), "utf8"),
)
const validatorRelative =
  "infra/portainer/ce-downstream/validate-reachability.mjs"
const guardNames = [
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

function fail(message) {
  throw new Error(message)
}

function sha256Bytes(value) {
  return createHash("sha256").update(value).digest("hex")
}

function sha256File(file) {
  return sha256Bytes(readFileSync(file))
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

function walkSourceFiles(root, current = "") {
  const files = []
  for (const entry of readdirSync(path.join(root, current), {
    withFileTypes: true,
  })) {
    if (current === "" && entry.name === ".llmm-build") continue
    const relative = path.posix.join(current, entry.name)
    const absolute = path.join(root, relative)
    const metadata = lstatSync(absolute)
    if (metadata.isSymbolicLink()) fail(`source contains symlink: ${relative}`)
    if (metadata.isDirectory()) files.push(...walkSourceFiles(root, relative))
    else if (metadata.isFile() && metadata.nlink === 1) files.push(relative)
    else fail(`source contains unsupported entry: ${relative}`)
  }
  return files.sort(compareText)
}

export function verifySourceInventory(sourceRoot, contract = sourcePackage) {
  const root = path.resolve(sourceRoot)
  if (!existsSync(root) || !lstatSync(root).isDirectory()) {
    fail("source root is not a directory")
  }
  const files = walkSourceFiles(root)
  const sums = `${files
    .map(
      (relative) => `${sha256File(path.join(root, relative))}  ./${relative}`,
    )
    .join("\n")}\n`
  const sourceInventorySha256 = sha256Bytes(sums)
  const lockedSums = path.join(root, ".llmm-build/SOURCE-SHA256SUMS")
  const lockedPnpm = path.join(
    root,
    `.llmm-build/pnpm-${contract.downstream.pnpm.version}.tgz`,
  )
  for (const [file, label] of [
    [lockedSums, "source inventory"],
    [lockedPnpm, "pnpm tarball"],
  ]) {
    if (!existsSync(file)) fail(`${label} is missing`)
    const metadata = lstatSync(file)
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      metadata.nlink !== 1
    ) {
      fail(`${label} is not a single-link regular file`)
    }
  }
  if (
    files.length !== contract.downstream.sourceInventory.fileCount ||
    sourceInventorySha256 !==
      contract.downstream.sourceInventory.sha256SumsSha256 ||
    !readFileSync(lockedSums).equals(Buffer.from(sums)) ||
    sha256File(lockedPnpm) !== contract.downstream.pnpm.tarballSha256
  ) {
    fail("source root does not match the exact admitted inventory")
  }
  return { fileCount: files.length, sourceInventorySha256 }
}

export function buildReachabilityReceipt({
  assembly,
  sourceRoot,
  evaluatedAt,
  inventory,
  validatorSha256,
  errors,
  contract = sourcePackage,
}) {
  if (!["A", "B"].includes(assembly)) fail("assembly must be A or B")
  const evaluated = Date.parse(evaluatedAt)
  const expiry = Date.parse(angularJsSecurityBoundary.reviewExpiresAt)
  if (!Number.isInteger(evaluated) || evaluated > expiry) {
    fail("reachability evaluation time is invalid or expired")
  }
  if (!Array.isArray(errors)) fail("reachability errors must be an array")
  const succeeded = errors.length === 0
  const stdout = succeeded
    ? "Portainer go-archive reachability boundary validated.\n"
    : ""
  const stderr = succeeded ? "" : `${errors.join("\n")}\n`
  return {
    schema: "llm-machines.portainer-ce-reachability-receipt.v1",
    assembly,
    source: {
      root: path.resolve(sourceRoot),
      revision: contract.upstream.revision,
      tree: contract.upstream.tree,
      fileCount: inventory.fileCount,
      sourceInventorySha256: inventory.sourceInventorySha256,
    },
    validator: {
      path: validatorRelative,
      sha256: validatorSha256,
      nodeVersion: process.versions.node,
    },
    evaluatedAt,
    angularJsVex: {
      expiresAt: angularJsSecurityBoundary.reviewExpiresAt,
      advisories: [...angularJsSecurityBoundary.findings],
    },
    command: ["node", validatorRelative, path.resolve(sourceRoot)],
    exitStatus: succeeded ? 0 : 1,
    stdoutSha256: sha256Bytes(stdout),
    stderrSha256: sha256Bytes(stderr),
    containsCredentials: false,
    guardStates: Object.fromEntries(
      guardNames.map((name) => [name, succeeded]),
    ),
    errors: [...errors],
  }
}

function parseArguments(argv) {
  const values = new Map()
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    if (!key?.startsWith("--") || !value || values.has(key)) {
      fail("invalid reachability receipt argument")
    }
    values.set(key, value)
  }
  for (const required of ["--assembly", "--source-root", "--output"]) {
    if (!values.has(required)) fail(`${required} is required`)
  }
  if (values.size !== 3) fail("unexpected reachability receipt argument")
  return {
    assembly: values.get("--assembly"),
    sourceRoot: path.resolve(values.get("--source-root")),
    output: path.resolve(values.get("--output")),
  }
}

export function generateReachabilityReceipt({ assembly, sourceRoot, output }) {
  if (existsSync(output)) fail("reachability receipt output already exists")
  if (
    process.versions.node !==
    sourcePackage.downstream.buildToolchain.nodeExecutor
  ) {
    fail("Node executor differs from the admitted toolchain")
  }
  const inventory = verifySourceInventory(sourceRoot)
  const evaluatedAt = new Date().toISOString()
  const errors = validateReachability(sourceRoot, {
    now: new Date(evaluatedAt),
  })
  const receipt = buildReachabilityReceipt({
    assembly,
    sourceRoot,
    evaluatedAt,
    inventory,
    validatorSha256: sha256File(path.join(repositoryRoot, validatorRelative)),
    errors,
  })
  mkdirSync(path.dirname(output), { recursive: true })
  writeFileSync(output, `${JSON.stringify(receipt, null, 2)}\n`, {
    mode: 0o600,
  })
  if (errors.length > 0)
    fail("reachability validation failed; receipt preserved")
  return receipt
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const receipt = generateReachabilityReceipt(
      parseArguments(process.argv.slice(2)),
    )
    console.log(JSON.stringify(receipt, null, 2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
