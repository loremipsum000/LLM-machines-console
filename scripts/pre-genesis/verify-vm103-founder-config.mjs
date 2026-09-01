#!/usr/bin/env node

import { createHash } from "node:crypto"
import { lstatSync, readFileSync, realpathSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

const digest = /^sha256:[0-9a-f]{64}$/
const gitId = /^[0-9a-f]{40}$/
const expectedArtifacts = [
  "bff.env",
  "image-bindings.json",
  "placement.env",
  "product-edge.nginx.conf",
  "web.env",
]

export function verifyFounderRenderedConfiguration(
  configurationRoot,
  manifestPath,
  expectedManifestDigest,
  expectedCommit,
  expectedTree,
) {
  if (
    !digest.test(expectedManifestDigest) ||
    !gitId.test(expectedCommit) ||
    !gitId.test(expectedTree)
  ) {
    fail()
  }

  let canonicalRoot
  try {
    canonicalRoot = realpathSync(configurationRoot)
  } catch {
    fail()
  }
  if (resolve(configurationRoot) !== canonicalRoot) fail()

  const canonicalManifest = resolve(
    canonicalRoot,
    "rendered-config-manifest.json",
  )
  if (resolve(manifestPath) !== canonicalManifest) fail()
  const manifestBytes = readBoundedRegularFile(canonicalManifest)
  if (sha256(manifestBytes) !== expectedManifestDigest) fail()

  let manifest
  try {
    manifest = JSON.parse(manifestBytes.toString("utf8"))
  } catch {
    fail()
  }
  if (
    !manifest ||
    Array.isArray(manifest) ||
    JSON.stringify(Object.keys(manifest).sort()) !==
      JSON.stringify(["artifacts", "schema", "source"]) ||
    manifest.schema !== "llm-machines.vm103-founder-rendered-config.v1" ||
    !manifest.source ||
    Array.isArray(manifest.source) ||
    JSON.stringify(Object.keys(manifest.source).sort()) !==
      JSON.stringify(["commit", "tree"]) ||
    manifest.source.commit !== expectedCommit ||
    manifest.source.tree !== expectedTree ||
    !Array.isArray(manifest.artifacts) ||
    manifest.artifacts.length !== expectedArtifacts.length
  ) {
    fail()
  }

  const names = []
  for (const artifact of manifest.artifacts) {
    if (
      !artifact ||
      Array.isArray(artifact) ||
      JSON.stringify(Object.keys(artifact).sort()) !==
        JSON.stringify(["name", "sha256"]) ||
      typeof artifact.name !== "string" ||
      !digest.test(artifact.sha256)
    ) {
      fail()
    }
    names.push(artifact.name)
    const artifactPath = resolve(canonicalRoot, artifact.name)
    if (artifactPath !== `${canonicalRoot}/${artifact.name}`) fail()
    if (sha256(readBoundedRegularFile(artifactPath)) !== artifact.sha256) fail()
  }
  if (JSON.stringify(names) !== JSON.stringify(expectedArtifacts)) fail()

  return {
    manifestDigest: expectedManifestDigest,
    source: { commit: expectedCommit, tree: expectedTree },
    state: "exact-rendered-configuration",
  }
}

function readBoundedRegularFile(path) {
  let stat
  try {
    stat = lstatSync(path)
  } catch {
    fail()
  }
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.size < 1 ||
    stat.size > 16 * 1024 * 1024 ||
    (stat.mode & 0o022) !== 0
  ) {
    fail()
  }
  try {
    return readFileSync(path)
  } catch {
    fail()
  }
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`
}

function fail() {
  throw new Error("VM103 founder rendered configuration binding is invalid.")
}

if (
  process.argv[1] === fileURLToPath(import.meta.url) ||
  process.argv[1] === "-"
) {
  if (process.argv.length !== 7) {
    throw new Error(
      "Usage: verify-vm103-founder-config.mjs CONFIGURATION_ROOT MANIFEST MANIFEST_SHA256 COMMIT TREE",
    )
  }
  process.stdout.write(
    `${JSON.stringify(
      verifyFounderRenderedConfiguration(
        process.argv[2],
        process.argv[3],
        process.argv[4],
        process.argv[5],
        process.argv[6],
      ),
    )}\n`,
  )
}
