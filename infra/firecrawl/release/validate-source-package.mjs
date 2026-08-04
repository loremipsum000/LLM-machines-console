#!/usr/bin/env node

import { createHash } from "node:crypto"
import { lstatSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const releaseRoot = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(releaseRoot, "../../..")
const digestPattern = /^[a-f0-9]{64}$/
const ociDigestPattern = /^sha256:[a-f0-9]{64}$/
const commitPattern = /^[a-f0-9]{40}$/
const forbiddenIdentity =
  /(?:intel[-_ ]arc[-_ ]b50|sglang-xpu|demo[-_.]?(?:host|alias)|\blatest\b)/i

const expectedComponentIds = ["firecrawl", "searxng", "squid", "playwright"]
const expectedComponents = new Map([
  [
    "firecrawl",
    [
      "ef12eb36b2f3382838dfe0a0c1a5add3d5df7fe5",
      "b7c6df0b8b692397c8a19e84f94b85ce0a2d961b36fc1d5ff78088db88819f59",
      "9b4649365c4f29d8f41301f4cda1e5bd9da51cf1bbb19ab9d568ff57d56e3b33",
    ],
  ],
  [
    "searxng",
    [
      "c01178d03129d861582adf84a692e699f2f7ec05",
      "81f025e643e5c1e7829ac58306fd7e4b4e3a1970483adb20993efdf0ac440f60",
      "57c8ff29ed27c831053060885640b4651378f999a621b83dcd062cb7dcd185f0",
    ],
  ],
  [
    "squid",
    [
      "a8c54a8f23f0dc41025097caab73ec445f49b78f",
      "23bf67bd489142bfc06f2a085a376f81d1bffc0277ab9612af6f63d569c685d7",
      "8177f9162714c5d3c6c9401559ac8fe7a6c3d88c094654d10d3bb86ac0e2f304",
    ],
  ],
  [
    "playwright",
    [
      "e3950d9c140d007bd52853b45813c6274b24e36f",
      "33616cb05537331c5038e387e70c8a62fd1604162f338b62e0c4132c47647e2d",
      "45873d72ae638b24e44b0088f6034b689a9e94775a1b23635255b0fa6fbc9867",
    ],
  ],
])
const expectedPatchPaths = [
  "infra/firecrawl/release/patches/build-hardening.patch",
  "infra/firecrawl/release/patches/reduced-runtime.patch",
]
const expectedLockPaths = [
  "infra/firecrawl/release/locks/Cargo.lock",
  "infra/firecrawl/release/locks/api-wolfi.sha256",
  "infra/firecrawl/release/locks/playwright-wolfi.sha256",
]
const expectedPatchDigests = [
  "3848cd686c80759f307f6975e5dcdfe8745ed91c50375c6a2bc89d4a769df4a5",
  "0ae6844072e0e9d9f3874838bab438434980e460d4e6f4fc95d6c5c59c4b06b9",
]
const expectedLockDigests = [
  "dd723e1829fb911aa8c3ccc4e1d06690ffd91a5fbc8d67cfa3b0a63e377ab2ef",
  "348b5e00d070803abcc0c91ac3c9e27ddbfccf1a149fee072d00aee985655f28",
  "eb1f2fe73044351c5b51d87f60a4e14c13a9da78a8fadb992ebe717f49be02c9",
]

export function sha256File(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex")
}

function validateLocalFile(errors, entry, root) {
  if (!digestPattern.test(entry?.sha256 ?? "")) {
    errors.push(`${entry?.path ?? "unknown file"} must declare a SHA-256`)
    return
  }
  const file = path.resolve(root, entry.path)
  if (!file.startsWith(`${root}${path.sep}`)) {
    errors.push(`${entry.path} escapes the repository`)
    return
  }
  try {
    if (!lstatSync(file).isFile()) {
      errors.push(`${entry.path} must be a regular file`)
    } else if (sha256File(file) !== entry.sha256) {
      errors.push(`${entry.path} differs from its locked SHA-256`)
    }
  } catch {
    errors.push(`${entry.path} is missing`)
  }
}

export function validateSourcePackage(manifest, root = repositoryRoot) {
  const errors = []
  if (manifest?.schema !== "llm-machines.firecrawl-release-source.v1") {
    errors.push("Firecrawl release source schema is not v1")
  }
  if (manifest?.status !== "SOURCE_READY_RUNTIME_UNQUALIFIED") {
    errors.push("Firecrawl source package must remain runtime-unqualified")
  }
  if (manifest?.containsCredentials !== false) {
    errors.push("Firecrawl source package must be credential-free")
  }
  if (manifest?.runtimeQualified !== false) {
    errors.push("Firecrawl source package cannot claim runtime qualification")
  }
  if (
    JSON.stringify(manifest?.productBoundary) !==
    JSON.stringify({
      installed: true,
      defaultEnabled: false,
      customerExposure: "product-edge-only",
      nativeUi: false,
      routes: ["POST /v2/search", "POST /v2/scrape"],
      persistentWorkloadContent: false,
    })
  ) {
    errors.push("Firecrawl product boundary differs from the approved profile")
  }

  const components = Array.isArray(manifest?.upstreamComponents)
    ? manifest.upstreamComponents
    : []
  if (
    JSON.stringify(components.map(({ id }) => id)) !==
    JSON.stringify(expectedComponentIds)
  ) {
    errors.push("Firecrawl source package has an incomplete component set")
  }
  for (const component of components) {
    if (!commitPattern.test(component.revision ?? "")) {
      errors.push(`${component.id} must bind an exact source commit`)
    }
    if (!digestPattern.test(component.archiveSha256 ?? "")) {
      errors.push(`${component.id} must bind an exact source archive SHA-256`)
    }
    if (!digestPattern.test(component.licenseSha256 ?? "")) {
      errors.push(`${component.id} must bind an exact license SHA-256`)
    }
    if (
      !/^https:\/\/(?:codeload\.)?github\.com\//.test(
        component.archiveUrl ?? "",
      )
    ) {
      errors.push(`${component.id} source archive must use the approved host`)
    }
    if (forbiddenIdentity.test(JSON.stringify(component))) {
      errors.push(`${component.id} contains a mutable or demo identity`)
    }
    const expected = expectedComponents.get(component.id)
    if (
      !expected ||
      JSON.stringify([
        component.revision,
        component.archiveSha256,
        component.licenseSha256,
      ]) !== JSON.stringify(expected)
    ) {
      errors.push(`${component.id} differs from its admitted source identity`)
    }
  }

  const patches = Array.isArray(manifest?.patches) ? manifest.patches : []
  if (
    JSON.stringify(patches.map(({ path: file }) => file)) !==
    JSON.stringify(expectedPatchPaths)
  ) {
    errors.push("Firecrawl patches must match the exact reviewed order")
  }
  patches.forEach((entry, index) => {
    if (entry.order !== index + 1) {
      errors.push(`${entry.path} has an invalid patch order`)
    }
    if (entry.sha256 !== expectedPatchDigests[index]) {
      errors.push(`${entry.path} differs from its reviewed patch identity`)
    }
    validateLocalFile(errors, entry, root)
  })

  const lockedFiles = Array.isArray(manifest?.lockedFiles)
    ? manifest.lockedFiles
    : []
  if (
    JSON.stringify(lockedFiles.map(({ path: file }) => file)) !==
    JSON.stringify(expectedLockPaths)
  ) {
    errors.push("Firecrawl build lock set differs")
  }
  for (const [index, entry] of lockedFiles.entries()) {
    if (typeof entry.target !== "string" || !entry.target.startsWith("apps/")) {
      errors.push(`${entry.path} has an invalid target`)
    }
    if (entry.sha256 !== expectedLockDigests[index]) {
      errors.push(`${entry.path} differs from its reviewed lock identity`)
    }
    validateLocalFile(errors, entry, root)
  }

  const buildInputs = Array.isArray(manifest?.buildInputs)
    ? manifest.buildInputs
    : []
  for (const input of buildInputs) {
    if (!input.id || !input.repository || !input.version || !input.platform) {
      errors.push("Every Firecrawl build input needs identity and platform")
    }
    if (forbiddenIdentity.test(JSON.stringify(input))) {
      errors.push(`${input.id ?? "unknown input"} contains a mutable identity`)
    }
    const digests = [
      input.digest,
      input.indexDigest,
      input.platformDigest,
    ].filter(Boolean)
    if (
      digests.length === 0 ||
      digests.some((value) => !ociDigestPattern.test(value))
    ) {
      errors.push(`${input.id ?? "unknown input"} needs exact OCI digests`)
    }
    if (input.platform === "linux/amd64" && !input.platformDigest) {
      errors.push(`${input.id} must bind its linux/amd64 manifest`)
    }
  }

  for (const input of manifest?.externalByteInputs ?? []) {
    if (!input.id || !input.version || !/^https:\/\//.test(input.url ?? "")) {
      errors.push("Every external byte input needs an exact public identity")
    }
    if (!digestPattern.test(input.sha256 ?? "")) {
      errors.push(`${input.id ?? "unknown input"} needs an exact SHA-256`)
    }
  }

  const serialized = JSON.stringify(manifest)
  if (forbiddenIdentity.test(serialized)) {
    errors.push(
      "Firecrawl source package contains a forbidden release identity",
    )
  }
  if (
    /-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:AKIA|gh[pousr]_)/.test(serialized)
  ) {
    errors.push("Firecrawl source package contains credential material")
  }

  const reducedPatch = readFileSync(
    path.resolve(root, expectedPatchPaths[1]),
    "utf8",
  )
  for (const required of [
    "dist/src/llm-machines-server.js",
    'app.post(\n+  "/v2/search"',
    'app.post(\n+  "/v2/scrape"',
    "isSelfHosted() ||",
    'response.status(404).json({ success: false, error: "Not found" })',
  ]) {
    if (!reducedPatch.includes(required)) {
      errors.push(`reduced runtime patch is missing ${required}`)
    }
  }
  for (const forbidden of [
    '+CMD ["/usr/bin/node", "dist/src/harness.js"',
    '+        "scrape.url": req.body.url',
    "+      query: req.body.query",
    '+import "./services/sentry"',
    '+import cors from "cors"',
  ]) {
    if (reducedPatch.includes(forbidden)) {
      errors.push(
        `reduced runtime patch preserves forbidden content: ${forbidden}`,
      )
    }
  }

  return errors
}

export function readSourcePackage(root = repositoryRoot) {
  return JSON.parse(
    readFileSync(
      path.resolve(root, "infra/firecrawl/release/source-package.json"),
      "utf8",
    ),
  )
}

export function verifyCheckedInSourcePackage(root = repositoryRoot) {
  return validateSourcePackage(readSourcePackage(root), root)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const errors = verifyCheckedInSourcePackage()
  if (errors.length > 0) {
    console.error(errors.join("\n"))
    process.exitCode = 1
  } else {
    console.log("Firecrawl release source package is internally consistent.")
  }
}
