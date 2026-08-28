import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import {
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import test from "node:test"
import { deflateRawSync, gzipSync } from "node:zlib"

import { assembleDeterministicArchive } from "../../release/deterministic-archive.mjs"
import { canonicalJson } from "./generate-evidence.mjs"
import {
  generateGoLicenseInput,
  parseArguments,
} from "./generate-go-license-input.mjs"

const sourceDateEpoch = 1_786_575_764
const mainPurl = "pkg:golang/example.org/main"
const modulePurl = "pkg:golang/example.org/module@v1.0.0"
const uppercaseModulePurl =
  "pkg:golang/github.com/Azure/go-test@v2.0.0%2Bincompatible"
const stdlibPurl = "pkg:golang/stdlib@1.25.13"
const moduleArchiveRoot = "example.org/module@v1.0.0/"
const moduleLicenseEntry = `${moduleArchiveRoot}LICENSE`
const moduleNoticeEntry = `${moduleArchiveRoot}NOTICE`
const uppercaseModuleRoot = "github.com/Azure/go-test@v2.0.0+incompatible/"
const uppercaseModuleLicenseEntry = `${uppercaseModuleRoot}LICENSE.docs`

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}

function digest(value) {
  return `sha256:${sha256(value)}`
}

function writeCanonical(file, value) {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${canonicalJson(value)}\n`)
}

function goDirHash(entries) {
  const summary = Object.entries(entries)
    .sort(([left], [right]) => Buffer.from(left).compare(Buffer.from(right)))
    .map(([name, contents]) => `${sha256(contents)}  ${name}\n`)
    .join("")
  return `h1:${createHash("sha256").update(summary).digest("base64")}`
}

function createZip(files) {
  const localParts = []
  const centralParts = []
  let localOffset = 0
  for (const [name, contentsValue] of Object.entries(files).sort(
    ([left], [right]) => left.localeCompare(right),
  )) {
    const nameBytes = Buffer.from(name)
    const contents = Buffer.from(contentsValue)
    const compressed = deflateRawSync(contents)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6)
    local.writeUInt16LE(8, 8)
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(contents.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(8, 10)
    central.writeUInt32LE(compressed.length, 20)
    central.writeUInt32LE(contents.length, 24)
    central.writeUInt16LE(nameBytes.length, 28)
    central.writeUInt32LE(localOffset, 42)
    localParts.push(local, nameBytes, compressed)
    centralParts.push(central, nameBytes)
    localOffset += local.length + nameBytes.length + compressed.length
  }
  const central = Buffer.concat(centralParts)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(Object.keys(files).length, 8)
  end.writeUInt16LE(Object.keys(files).length, 10)
  end.writeUInt32LE(central.length, 12)
  end.writeUInt32LE(localOffset, 16)
  return Buffer.concat([...localParts, central, end])
}

function writeTarOctal(header, start, length, value) {
  header.write(
    `${value.toString(8).padStart(length - 1, "0")}\0`,
    start,
    length,
  )
}

function createTar(files) {
  const parts = []
  for (const [path, contentsValue] of Object.entries(files).sort(
    ([left], [right]) => left.localeCompare(right),
  )) {
    const contents = Buffer.from(contentsValue)
    const header = Buffer.alloc(512)
    header.write(path, 0, 100)
    writeTarOctal(header, 100, 8, 0o644)
    writeTarOctal(header, 108, 8, 0)
    writeTarOctal(header, 116, 8, 0)
    writeTarOctal(header, 124, 12, contents.length)
    writeTarOctal(header, 136, 12, sourceDateEpoch)
    header.fill(0x20, 148, 156)
    header[156] = "0".charCodeAt(0)
    header.write("ustar\0", 257, 6)
    header.write("00", 263, 2)
    writeTarOctal(
      header,
      148,
      8,
      header.reduce((total, byte) => total + byte, 0),
    )
    parts.push(header, contents)
    const padding = (512 - (contents.length % 512)) % 512
    if (padding > 0) parts.push(Buffer.alloc(padding))
  }
  parts.push(Buffer.alloc(1024))
  return Buffer.concat(parts)
}

function createOciArchive(root, name, layerText = "runtime layer\n") {
  const layout = join(root, `${name}-layout`)
  const blobs = join(layout, "blobs", "sha256")
  mkdirSync(blobs, { recursive: true })
  const layer = Buffer.from(layerText)
  const layerDigest = digest(layer)
  writeFileSync(join(blobs, layerDigest.slice(7)), layer)
  const config = Buffer.from(
    `${canonicalJson({
      architecture: "amd64",
      os: "linux",
      config: { Entrypoint: ["/portainer"] },
      rootfs: { type: "layers", diff_ids: [layerDigest] },
    })}\n`,
  )
  const configDigest = digest(config)
  writeFileSync(join(blobs, configDigest.slice(7)), config)
  const manifest = Buffer.from(
    `${canonicalJson({
      schemaVersion: 2,
      mediaType: "application/vnd.oci.image.manifest.v1+json",
      config: {
        mediaType: "application/vnd.oci.image.config.v1+json",
        digest: configDigest,
        size: config.length,
      },
      layers: [
        {
          mediaType: "application/vnd.oci.image.layer.v1.tar",
          digest: layerDigest,
          size: layer.length,
        },
      ],
    })}\n`,
  )
  const manifestDigest = digest(manifest)
  writeFileSync(join(blobs, manifestDigest.slice(7)), manifest)
  writeCanonical(join(layout, "oci-layout"), { imageLayoutVersion: "1.0.0" })
  writeCanonical(join(layout, "index.json"), {
    schemaVersion: 2,
    mediaType: "application/vnd.oci.image.index.v1+json",
    manifests: [
      {
        mediaType: "application/vnd.oci.image.manifest.v1+json",
        digest: manifestDigest,
        size: manifest.length,
        platform: { architecture: "amd64", os: "linux" },
      },
    ],
  })
  const archive = join(root, `${name}.oci.tar`)
  assembleDeterministicArchive({
    inputRoot: layout,
    outputPath: archive,
    sourceDateEpoch,
  })
  return archive
}

function writeSource(root, files) {
  for (const [path, contents] of Object.entries(files)) {
    const file = join(root, path)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, contents)
  }
  const entries = Object.keys(files)
    .sort()
    .map((path) => `${sha256(files[path])}  ./${path}`)
  const manifest = `${entries.join("\n")}\n`
  mkdirSync(join(root, ".llmm-build"), { recursive: true })
  writeFileSync(join(root, ".llmm-build", "SOURCE-SHA256SUMS"), manifest)
  return {
    fileCount: entries.length,
    sha256SumsSha256: sha256(manifest),
    goModSha256: sha256(files["go.mod"]),
    goSumSha256: sha256(files["go.sum"]),
  }
}

function reviewedComponent(
  purl,
  expression,
  licenseFiles,
  noticeFiles = [],
  copyleft = false,
) {
  return {
    purl,
    declaredExpression: expression,
    concludedExpression: expression,
    licenseFiles,
    noticeFiles,
    disposition: "REVIEWED_FOR_DOWNSTREAM_DISTRIBUTION",
    reviewer: "LLM Machines release review",
    reviewedAt: "2026-08-22T10:00:00.000Z",
    copyleft,
    prohibited: false,
  }
}

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), "llmm-go-license-input-"))
  const repositoryRoot = join(root, "repository")
  const downstream = join(repositoryRoot, "infra", "portainer", "ce-downstream")
  const patchRelative =
    "infra/portainer/ce-downstream/patches/security-toolchain.patch"
  const patch = join(repositoryRoot, patchRelative)
  mkdirSync(dirname(patch), { recursive: true })
  writeFileSync(patch, "fixture patch\n")

  const moduleContents = {
    [moduleLicenseEntry]: "Example BSD license\n",
    [moduleNoticeEntry]: "Example notice\n",
    [`${moduleArchiveRoot}go.sum`]: "",
    [`${moduleArchiveRoot}module.go`]: "package module\n",
  }
  const moduleZip = createZip(moduleContents)
  const moduleH1 = goDirHash(moduleContents)
  const moduleGoMod = "module example.org/module\n"
  const moduleGoModH1 = goDirHash({ "go.mod": moduleGoMod })
  const uppercaseModuleContents = {
    [uppercaseModuleLicenseEntry]: "Example documentation license\n",
    [`${uppercaseModuleRoot}module.go`]: "package gotest\n",
  }
  const uppercaseModuleZip = createZip(uppercaseModuleContents)
  const uppercaseModuleH1 = goDirHash(uppercaseModuleContents)
  const uppercaseModuleGoMod = "module github.com/Azure/go-test\n"
  const uppercaseModuleGoModH1 = goDirHash({
    "go.mod": uppercaseModuleGoMod,
  })
  const goSum = [
    `example.org/module v1.0.0 ${moduleH1}`,
    `example.org/module v1.0.0/go.mod ${moduleGoModH1}`,
    `github.com/Azure/go-test v2.0.0+incompatible ${uppercaseModuleH1}`,
    `github.com/Azure/go-test v2.0.0+incompatible/go.mod ${uppercaseModuleGoModH1}`,
  ].join("\n")
  const sourceFiles = {
    "ATTRIBUTIONS.md": "Portainer attributions\n",
    LICENSE: "Portainer Zlib license\n",
    "api/testdata/file with space.txt": "source fixture\n",
    "go.mod": "module example.org/main\n",
    "go.sum": `${goSum}\n`,
  }
  const sourceA = join(root, "source-a")
  const sourceB = join(root, "source-b")
  const sourceInventory = writeSource(sourceA, sourceFiles)
  cpSync(sourceA, sourceB, { recursive: true })
  for (const source of [sourceA, sourceB]) {
    const ignoredBuildFile = join(
      source,
      "node_modules",
      ".pnpm-config",
      "state.json",
    )
    mkdirSync(dirname(ignoredBuildFile), { recursive: true })
    writeFileSync(ignoredBuildFile, "ignored post-assembly build state\n")
  }

  const sourcePackage = {
    upstream: {
      revision: "7".repeat(40),
      tree: "8".repeat(40),
      sourceDateEpoch,
      license: "Zlib",
    },
    downstream: {
      patch: { path: patchRelative, sha256: sha256("fixture patch\n") },
      sourceInventory,
      securityOverlay: { go: "1.25.13" },
      buildInputs: [
        { id: "go-builder", platformDigest: `sha256:${"4".repeat(64)}` },
      ],
    },
  }
  const sourcePackagePath = join(downstream, "source-package.json")
  writeCanonical(sourcePackagePath, sourcePackage)

  const moduleCache = join(root, "gomodcache")
  const cacheBase = join(
    moduleCache,
    "cache",
    "download",
    "example.org",
    "module",
    "@v",
    "v1.0.0",
  )
  mkdirSync(dirname(cacheBase), { recursive: true })
  writeFileSync(`${cacheBase}.zip`, moduleZip)
  writeFileSync(`${cacheBase}.ziphash`, moduleH1)
  writeFileSync(`${cacheBase}.mod`, moduleGoMod)
  writeCanonical(`${cacheBase}.info`, { Version: "v1.0.0" })
  const uppercaseCacheBase = join(
    moduleCache,
    "cache",
    "download",
    "github.com",
    "!azure",
    "go-test",
    "@v",
    "v2.0.0+incompatible",
  )
  mkdirSync(dirname(uppercaseCacheBase), { recursive: true })
  writeFileSync(`${uppercaseCacheBase}.zip`, uppercaseModuleZip)
  writeFileSync(`${uppercaseCacheBase}.ziphash`, uppercaseModuleH1)
  writeFileSync(`${uppercaseCacheBase}.mod`, uppercaseModuleGoMod)
  writeCanonical(`${uppercaseCacheBase}.info`, {
    Version: "v2.0.0+incompatible",
  })

  const toolchainLicense = "Fixture Go BSD license\n"
  const toolchainArchive = gzipSync(
    createTar({
      "go/LICENSE": toolchainLicense,
      "go/src/runtime.go": "package go\n",
    }),
    { mtime: 0 },
  )
  const goSourceArchive = join(root, "go1.25.13.src.tar.gz")
  writeFileSync(goSourceArchive, toolchainArchive)
  const expectedToolchain = {
    goVersion: "go1.25.13",
    sourceArchiveUrl: "https://go.dev/dl/go1.25.13.src.tar.gz",
    sourceArchiveBytes: toolchainArchive.length,
    sourceArchiveSha256: sha256(toolchainArchive),
    licenseArchiveEntry: "go/LICENSE",
    licenseBytes: Buffer.byteLength(toolchainLicense),
    licenseSha256: sha256(toolchainLicense),
  }

  const sbom = {
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    components: [
      {
        type: "file",
        "bom-ref": "runtime-portainer-file",
        name: "/portainer",
        hashes: [
          { alg: "SHA-1", content: "1".repeat(40) },
          { alg: "SHA-256", content: "2".repeat(64) },
        ],
      },
      {
        type: "library",
        "bom-ref": `${mainPurl}?package-id=main`,
        name: "example.org/main",
        version: "UNKNOWN",
        purl: mainPurl,
      },
      {
        type: "library",
        "bom-ref": `${modulePurl}?package-id=module`,
        name: "example.org/module",
        version: "v1.0.0",
        purl: modulePurl,
      },
      {
        type: "library",
        "bom-ref": `${stdlibPurl}?package-id=stdlib`,
        name: "stdlib",
        version: "go1.25.13",
        purl: stdlibPurl,
      },
      {
        type: "library",
        "bom-ref": `${uppercaseModulePurl}?package-id=uppercase`,
        name: "github.com/Azure/go-test",
        version: "v2.0.0+incompatible",
        purl: uppercaseModulePurl,
      },
    ],
  }
  const sbomInput = join(root, "runtime-sbom.cdx.json")
  writeCanonical(sbomInput, sbom)

  const review = {
    schema: "llm-machines.portainer-ce-go-license-review.v1",
    components: [
      reviewedComponent(mainPurl, "Zlib", ["LICENSE"], ["ATTRIBUTIONS.md"]),
      reviewedComponent(
        modulePurl,
        "BSD-3-Clause",
        [moduleLicenseEntry],
        [moduleNoticeEntry],
      ),
      reviewedComponent(uppercaseModulePurl, "CC-BY-SA-4.0", [
        uppercaseModuleLicenseEntry,
      ]),
      reviewedComponent(stdlibPurl, "BSD-3-Clause", ["go/LICENSE"]),
    ],
  }
  const reviewInput = join(root, "go-license-review.json")
  writeCanonical(reviewInput, review)

  const assemblyA = createOciArchive(root, "assembly-a")
  const assemblyB = join(root, "assembly-b.oci.tar")
  copyFileSync(assemblyA, assemblyB)
  const evidenceRoot = join(root, "evidence")
  mkdirSync(evidenceRoot)
  const custodyRoot = join(evidenceRoot, "license-sources")
  const output = join(evidenceRoot, "runtime-license-input-a.json")
  return {
    root,
    moduleCache,
    cacheBase,
    sourceA,
    sourceB,
    sourcePackagePath,
    sbomInput,
    reviewInput,
    review,
    assemblyA,
    assemblyB,
    goSourceArchive,
    expectedToolchain,
    custodyRoot,
    output,
    options: {
      assemblyA,
      assemblyB,
      sourceA,
      sourceB,
      sbomInput,
      moduleCache,
      goSourceArchive,
      reviewInput,
      custodyRoot,
      output,
      sourcePackagePath,
      expectedToolchain,
    },
  }
}

function withFixture(callback) {
  const fixture = createFixture()
  try {
    callback(fixture)
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
}

test("generates canonical complete v2 input and identical A/B projections", () => {
  withFixture((fixture) => {
    const first = generateGoLicenseInput(fixture.options)
    const secondOutput = join(
      dirname(fixture.output),
      "runtime-license-input-b.json",
    )
    const second = generateGoLicenseInput({
      ...fixture.options,
      assemblyA: fixture.assemblyB,
      assemblyB: fixture.assemblyA,
      sourceA: fixture.sourceB,
      sourceB: fixture.sourceA,
      output: secondOutput,
    })
    assert.equal(first.componentCount, 5)
    assert.equal(first.outputSha256, second.outputSha256)
    assert.ok(readFileSync(fixture.output).equals(readFileSync(secondOutput)))
    const document = JSON.parse(readFileSync(fixture.output, "utf8"))
    assert.equal(
      document.schema,
      "llm-machines.portainer-ce-runtime-license-input.v2",
    )
    assert.equal(document.custody.root, "license-sources")
    assert.equal(document.coverage.complete, true)
    assert.deepEqual(document.coverage.missingRefs, [])
    assert.equal(document.components.length, 5)
    const module = document.components.find(({ purl }) => purl === modulePurl)
    assert.equal(module.source.kind, "go-module-zip")
    assert.match(module.source.goSumH1, /^h1:/)
    assert.match(module.source.goModSumH1, /^h1:/)
    assert.equal(module.license.noticeFiles.length, 1)
    const uppercaseModule = document.components.find(
      ({ purl }) => purl === uppercaseModulePurl,
    )
    assert.equal(uppercaseModule.version, "v2.0.0+incompatible")
    assert.equal(uppercaseModule.source.kind, "go-module-zip")
    const extracted = join(fixture.custodyRoot, module.license.files[0].path)
    assert.equal(readFileSync(extracted, "utf8"), "Example BSD license\n")
    const toolchain = document.components.find(
      ({ purl }) => purl === stdlibPurl,
    )
    assert.equal(toolchain.source.kind, "go-toolchain-source")
    assert.equal(toolchain.source.licenseArchiveEntry, "go/LICENSE")
    const manifest = readFileSync(
      join(fixture.custodyRoot, document.custody.manifestPath),
      "utf8",
    )
    assert.equal(sha256(manifest), document.custody.manifestSha256)
    const lines = manifest.trimEnd().split("\n")
    assert.deepEqual(
      lines,
      [...lines].sort((left, right) =>
        left.slice(68).localeCompare(right.slice(68)),
      ),
    )
  })
})

test("rejects omitted legal entries, unknown conclusions, and prohibited reviews", () => {
  for (const mutate of [
    (review) => {
      review.components.find(({ purl }) => purl === modulePurl).noticeFiles = []
    },
    (review) => {
      review.components.find(
        ({ purl }) => purl === modulePurl,
      ).concludedExpression = "NOASSERTION"
    },
    (review) => {
      review.components.find(({ purl }) => purl === modulePurl).prohibited =
        true
    },
  ]) {
    withFixture((fixture) => {
      mutate(fixture.review)
      writeCanonical(fixture.reviewInput, fixture.review)
      assert.throws(() => generateGoLicenseInput(fixture.options))
    })
  }
})

test("rejects module zip and go.mod content that do not match go.sum", () => {
  withFixture((fixture) => {
    const changed = createZip({
      [moduleLicenseEntry]: "Changed BSD license\n",
      [moduleNoticeEntry]: "Example notice\n",
      [`${moduleArchiveRoot}module.go`]: "package module\n",
    })
    writeFileSync(`${fixture.cacheBase}.zip`, changed)
    assert.throws(
      () => generateGoLicenseInput(fixture.options),
      /module zip differs from go.sum/,
    )
  })
  withFixture((fixture) => {
    writeFileSync(`${fixture.cacheBase}.mod`, "module example.org/changed\n")
    assert.throws(
      () => generateGoLicenseInput(fixture.options),
      /module go.mod differs from go.sum/,
    )
  })
})

test("rejects source and OCI differences between independent assemblies", () => {
  withFixture((fixture) => {
    writeFileSync(join(fixture.sourceB, "LICENSE"), "source drift\n")
    assert.throws(
      () => generateGoLicenseInput(fixture.options),
      /source B inventory file differs/,
    )
  })
  withFixture((fixture) => {
    rmSync(fixture.assemblyB)
    createOciArchive(fixture.root, "assembly-b", "different runtime layer\n")
    assert.throws(
      () => generateGoLicenseInput(fixture.options),
      /OCI archives are not byte-identical/,
    )
  })
})

test("rejects raw-SBOM/review drift and tampered extracted custody", () => {
  withFixture((fixture) => {
    const sbom = JSON.parse(readFileSync(fixture.sbomInput, "utf8"))
    sbom.components = sbom.components.filter(({ purl }) => purl !== modulePurl)
    writeCanonical(fixture.sbomInput, sbom)
    assert.throws(
      () => generateGoLicenseInput(fixture.options),
      /review contains missing or extra components/,
    )
  })
  withFixture((fixture) => {
    generateGoLicenseInput(fixture.options)
    const document = JSON.parse(readFileSync(fixture.output, "utf8"))
    const module = document.components.find(({ purl }) => purl === modulePurl)
    writeFileSync(
      join(fixture.custodyRoot, module.license.files[0].path),
      "tampered text\n",
    )
    assert.throws(
      () =>
        generateGoLicenseInput({
          ...fixture.options,
          output: join(dirname(fixture.output), "runtime-license-input-b.json"),
        }),
      /differs from existing custody/,
    )
  })
})

test("CLI parsing is exact and fail-closed", () => {
  const argv = [
    "--assembly-a",
    "a",
    "--assembly-b",
    "b",
    "--source-a",
    "sa",
    "--source-b",
    "sb",
    "--sbom-input",
    "sbom",
    "--module-cache",
    "cache",
    "--go-source-archive",
    "go",
    "--review-input",
    "review",
    "--custody-root",
    "custody",
    "--output",
    "output",
  ]
  assert.equal(parseArguments(argv).sourceA, "sa")
  assert.throws(() => parseArguments([...argv, "--unknown", "value"]))
  assert.throws(() => parseArguments(argv.slice(0, -2)))
  assert.throws(() => parseArguments([...argv, "--output", "again"]))
})
