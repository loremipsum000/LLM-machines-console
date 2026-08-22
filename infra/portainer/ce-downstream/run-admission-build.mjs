#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmdirSync,
  writeFileSync,
} from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { normalizeOciLayout } from "../../release/l1b/normalize-oci-layout.mjs"
import { validateReachability } from "./validate-reachability.mjs"

const directory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(directory, "../../..")
const manifest = JSON.parse(
  readFileSync(path.join(directory, "source-package.json"), "utf8"),
)

function fail(message) {
  throw new Error(message)
}

function run(command, args, options = {}) {
  const { evidencePath, ...spawnOptions } = options
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    ...spawnOptions,
  })
  if (evidencePath) {
    writeFileSync(
      evidencePath,
      `${JSON.stringify([command, ...args])}\n${result.stdout}${result.stderr}`,
      { mode: 0o600 },
    )
  }
  if (result.status !== 0) {
    fail(
      `${command} failed: ${result.stderr || result.stdout || result.status}`,
    )
  }
  return result.stdout
}

export function removeEmptyBuildkitIngest(rawLayout) {
  const ingest = path.join(rawLayout, "ingest")
  if (!existsSync(ingest)) return false
  if (!lstatSync(ingest).isDirectory() || readdirSync(ingest).length !== 0) {
    fail("BuildKit OCI ingest state is not an empty directory")
  }
  rmdirSync(ingest)
  return true
}

function parseArguments(argv) {
  const values = new Map()
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    if (!key?.startsWith("--") || !value) fail("invalid build argument")
    values.set(key, value)
  }
  for (const required of ["--source-root", "--output-root", "--builder"]) {
    if (!values.get(required)) fail(`${required} is required`)
  }
  if (values.size !== 3) fail("unexpected build argument")
  return {
    sourceRoot: path.resolve(values.get("--source-root")),
    outputRoot: path.resolve(values.get("--output-root")),
    builder: values.get("--builder"),
  }
}

export function runAdmissionBuild({ sourceRoot, outputRoot, builder }) {
  if (!lstatSync(sourceRoot).isDirectory())
    fail("source root is not a directory")
  if (existsSync(outputRoot)) fail("output root already exists")
  const reachabilityErrors = validateReachability(sourceRoot)
  if (reachabilityErrors.length > 0) fail(reachabilityErrors.join("\n"))

  mkdirSync(outputRoot, { recursive: false })
  const builderInspect = run("docker", ["buildx", "inspect", builder], {
    evidencePath: path.join(outputRoot, "builder-inspect.log"),
  })
  if (
    !/Platforms:.*linux\/amd64/.test(builderInspect) ||
    !/BuildKit version:\s+v0\.30\.0/.test(builderInspect)
  ) {
    fail("BuildKit builder identity or linux/amd64 platform differs")
  }
  const rawLayout = path.join(outputRoot, "raw-oci")
  const normalizedArchive = path.join(
    outputRoot,
    "portainer-ce-2.39.6-llmm.1.oci.tar",
  )
  const output = `type=oci,dest=${rawLayout},tar=false,rewrite-timestamp=true`
  run(
    "docker",
    [
      "buildx",
      "build",
      "--builder",
      builder,
      "--platform",
      "linux/amd64",
      "--no-cache",
      "--provenance=false",
      "--sbom=false",
      "--build-arg",
      `SOURCE_DATE_EPOCH=${manifest.upstream.sourceDateEpoch}`,
      "--output",
      output,
      "--file",
      path.join(directory, "Dockerfile"),
      sourceRoot,
    ],
    { evidencePath: path.join(outputRoot, "build.log") },
  )
  removeEmptyBuildkitIngest(rawLayout)
  return normalizeOciLayout({
    inputRoot: rawLayout,
    outputPath: normalizedArchive,
    sourceDateEpoch: manifest.upstream.sourceDateEpoch,
  })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    console.log(
      JSON.stringify(
        runAdmissionBuild(parseArguments(process.argv.slice(2))),
        null,
        2,
      ),
    )
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
