#!/usr/bin/env node

import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { requiredCoreImageIds } from "../validate-image-lock.mjs"

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

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}

function readInventory(path) {
  const document = JSON.parse(readFileSync(path, "utf8"))
  if (
    document?.schema !== "llm-machines.vm103-l1b-assembly-inventory.v1" ||
    document?.status !== "UNSIGNED_UNQUALIFIED" ||
    !Array.isArray(document?.images) ||
    JSON.stringify(document.images.map(({ id }) => id)) !==
      JSON.stringify(requiredCoreImageIds)
  ) {
    fail("assembly inventory is invalid")
  }
  for (const image of document.images) {
    if (
      typeof image?.id !== "string" ||
      !/^sha256:[a-f0-9]{64}$/.test(image?.ociArchiveSha256 ?? "") ||
      !/^sha256:[a-f0-9]{64}$/.test(image?.indexDigest ?? "") ||
      !/^sha256:[a-f0-9]{64}$/.test(image?.platformDigest ?? "")
    ) {
      fail("assembly inventory image digests are invalid")
    }
  }
  return document
}

export function compareAssemblies(first, second) {
  const firstInventory = readInventory(first)
  const secondInventory = readInventory(second)
  const firstCanonical = canonicalJson(firstInventory)
  const secondCanonical = canonicalJson(secondInventory)
  const artifactProjection = (inventory) => ({
    release: inventory.release,
    platform: inventory.platform,
    toolchainLockSha256: inventory.toolchainLockSha256,
    images: inventory.images.map(
      ({
        id,
        ociArchivePath,
        ociArchiveSha256,
        bytes,
        indexDigest,
        platform,
        platformDigest,
      }) => ({
        id,
        ociArchivePath,
        ociArchiveSha256,
        bytes,
        indexDigest,
        platform,
        platformDigest,
      }),
    ),
  })
  const firstArtifacts = artifactProjection(firstInventory)
  const secondArtifacts = artifactProjection(secondInventory)
  const firstArtifactCanonical = canonicalJson(firstArtifacts)
  const secondArtifactCanonical = canonicalJson(secondArtifacts)
  if (firstArtifactCanonical !== secondArtifactCanonical) {
    const firstById = new Map(
      firstArtifacts.images.map((entry) => [entry.id, entry]),
    )
    const secondById = new Map(
      secondArtifacts.images.map((entry) => [entry.id, entry]),
    )
    const differences = [
      ...new Set([...firstById.keys(), ...secondById.keys()]),
    ]
      .sort()
      .filter(
        (id) =>
          canonicalJson(firstById.get(id)) !==
          canonicalJson(secondById.get(id)),
      )
    fail(`independent assembly inventories differ: ${differences.join(", ")}`)
  }
  return {
    schema: "llm-machines.vm103-l1b-assembly-comparison.v1",
    status: "BYTE_IDENTICAL_IMAGE_SET",
    firstInventorySha256: sha256(`${firstCanonical}\n`),
    secondInventorySha256: sha256(`${secondCanonical}\n`),
    canonicalInventorySha256: sha256(`${firstArtifactCanonical}\n`),
    imageCount: firstInventory.images.length,
    images: firstInventory.images.map(
      ({ id, ociArchiveSha256, indexDigest, platformDigest }) => ({
        id,
        ociArchiveSha256,
        indexDigest,
        platformDigest,
      }),
    ),
  }
}

function parseArguments(argv) {
  const values = new Map()
  for (let index = 0; index < argv.length; index += 2)
    values.set(argv[index], argv[index + 1])
  if (
    values.size !== 3 ||
    !values.get("--first") ||
    !values.get("--second") ||
    !values.get("--output")
  ) {
    fail("expected --first FILE --second FILE --output FILE")
  }
  return Object.fromEntries(values)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = parseArguments(process.argv.slice(2))
  const result = compareAssemblies(
    resolve(args["--first"]),
    resolve(args["--second"]),
  )
  writeFileSync(resolve(args["--output"]), `${canonicalJson(result)}\n`, {
    flag: "wx",
    mode: 0o600,
  })
}
