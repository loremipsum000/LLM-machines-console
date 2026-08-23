import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { deflateRawSync, gzipSync } from "node:zlib"

import { assembleDeterministicArchive } from "../../release/deterministic-archive.mjs"
import { inspectOciArchive } from "../../release/inspect-oci-archive.mjs"
import {
  canonicalJson,
  generatePortainerEvidence,
  isCommercialPortainerIdentifier,
  sourcePackageContractProjection,
} from "./generate-evidence.mjs"

const directory = dirname(fileURLToPath(import.meta.url))
const sourcePackagePath = join(directory, "source-package.json")
const sourcePackage = JSON.parse(readFileSync(sourcePackagePath, "utf8"))

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}

function digest(value) {
  return `sha256:${sha256(value)}`
}

function sriSha512(value) {
  return `sha512-${createHash("sha512").update(value).digest("base64")}`
}

function writeCanonical(file, value) {
  writeFileSync(file, `${canonicalJson(value)}\n`)
}

function writeTarOctal(header, start, length, value) {
  const octal = value.toString(8).padStart(length - 1, "0")
  header.write(`${octal}\0`, start, length, "ascii")
}

function createTar(files, symlinks = {}) {
  const parts = []
  for (const [path, contentsValue] of Object.entries({
    ...files,
    ...Object.fromEntries(
      Object.entries(symlinks).map(([path, target]) => [
        path,
        { symlinkTarget: target },
      ]),
    ),
  }).sort(([left], [right]) => left.localeCompare(right))) {
    const symlink =
      !Buffer.isBuffer(contentsValue) &&
      typeof contentsValue === "object" &&
      typeof contentsValue?.symlinkTarget === "string"
    const contents = symlink ? Buffer.alloc(0) : Buffer.from(contentsValue)
    const directory = path.endsWith("/")
    if (directory && contents.length !== 0) {
      throw new Error(`test TAR directory is not empty: ${path}`)
    }
    const header = Buffer.alloc(512)
    header.write(path, 0, 100, "utf8")
    writeTarOctal(header, 100, 8, 0o644)
    writeTarOctal(header, 108, 8, 0)
    writeTarOctal(header, 116, 8, 0)
    writeTarOctal(header, 124, 12, contents.length)
    writeTarOctal(header, 136, 12, 1_786_575_764)
    header.fill(0x20, 148, 156)
    header[156] = (directory ? "5" : symlink ? "2" : "0").charCodeAt(0)
    if (symlink) header.write(contentsValue.symlinkTarget, 157, 100, "utf8")
    header.write("ustar\0", 257, 6, "ascii")
    header.write("00", 263, 2, "ascii")
    const checksum = header.reduce((total, byte) => total + byte, 0)
    writeTarOctal(header, 148, 8, checksum)
    parts.push(header, contents)
    const padding = (512 - (contents.length % 512)) % 512
    if (padding > 0) parts.push(Buffer.alloc(padding))
  }
  parts.push(Buffer.alloc(1024))
  return Buffer.concat(parts)
}

function createZip(files, deflatedNames = new Set()) {
  const localParts = []
  const centralParts = []
  let localOffset = 0
  for (const [name, contentsValue] of Object.entries(files).sort(
    ([left], [right]) => left.localeCompare(right),
  )) {
    const nameBytes = Buffer.from(name)
    const contents = Buffer.from(contentsValue)
    const method = deflatedNames.has(name) ? 8 : 0
    const stored = method === 8 ? deflateRawSync(contents) : contents
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(stored.length, 18)
    local.writeUInt32LE(contents.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt32LE(stored.length, 20)
    central.writeUInt32LE(contents.length, 24)
    central.writeUInt16LE(nameBytes.length, 28)
    central.writeUInt32LE(localOffset, 42)
    localParts.push(local, nameBytes, stored)
    centralParts.push(central, nameBytes)
    localOffset += local.length + nameBytes.length + stored.length
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

function testGoDirHash(entries) {
  const summary = Object.entries(entries)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([name, contents]) => `${sha256(contents)}  ${name}\n`)
    .join("")
  return `h1:${createHash("sha256").update(summary).digest("base64")}`
}

const fixtureModuleLicense = "Example BSD license\n"
const fixtureModuleArchiveEntry = "example.org/module@v1.0.0/LICENSE"
const fixtureModuleContents = {
  [fixtureModuleArchiveEntry]: fixtureModuleLicense,
  "example.org/module@v1.0.0/go.sum": "",
}
const fixtureZeroByteArchiveEntry = "example.org/module@v1.0.0/go.sum"
const fixtureModuleGoMod = "module example.org/module\n"
const fixtureModuleH1 = testGoDirHash(fixtureModuleContents)
const fixtureModuleGoModH1 = testGoDirHash({
  "go.mod": fixtureModuleGoMod,
})

const gitRevision = "d424cd29f5b629af9ffc5c3d6db8d92d11d82f0f"
const gitTarballUrl =
  "https://codeload.github.com/portainer/progress-bar-4-axios/tar.gz/d424cd29f5b629af9ffc5c3d6db8d92d11d82f0f"
const gitStoreKey =
  "axios-progress-bar@https+++codeload.github.com+portainer+progress-bar-4-axios+tar.gz+d424cd29f5b629af9ffc5c3d6db8d92d11d82f0f_axios@1.18.1"
const cssStoreKey = "spinkit@2.0.1"
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

function sourceMapContents(extraSource = null) {
  return `${canonicalJson({
    version: 3,
    file: "main.js",
    sources: [
      "webpack://@portainer/ce/./node_modules/.pnpm/example-frontend@1.0.0/node_modules/example-frontend/index.js",
      `webpack://@portainer/ce/./node_modules/.pnpm/${gitStoreKey}/node_modules/axios-progress-bar/index.js`,
      ...(extraSource ? [extraSource] : []),
    ],
    names: [],
    mappings: "",
  })}\n`
}

function cssSourceMapContents() {
  return `${canonicalJson({
    version: 3,
    file: "main.css",
    sources: [
      `webpack://@portainer/ce/./node_modules/.pnpm/${cssStoreKey}/node_modules/spinkit/spinkit.css`,
    ],
    names: [],
    mappings: "",
  })}\n`
}

function frontendLayer(extraSource = null) {
  return createTar({
    portainer: "test-portainer-binary\n",
    "public/index.html": "<main>Portainer</main>\n",
    "public/main.js": "console.log('frontend')\n",
    "public/main.js.map": sourceMapContents(extraSource),
    "public/main.css.map": cssSourceMapContents(),
  })
}

function reviewedLicense(
  expression = "MIT",
  {
    path = `licenses/${expression}.txt`,
    contents = `license:${expression}`,
    origin = "reviewed-upstream",
    archivePath,
    archiveEntry,
    sourceArchiveUrl,
    sourceRevision,
    sourceArchivePath,
    sourceArchiveBytes,
    sourceArchiveSha256,
    spdxVersion,
    spdxRevision,
  } = {},
) {
  const file = {
    path,
    bytes: Buffer.byteLength(contents),
    sha256: sha256(contents),
    origin,
    ...(archivePath ? { archivePath } : {}),
    ...(sourceArchiveUrl ? { sourceArchiveUrl } : {}),
    ...(sourceRevision ? { sourceRevision } : {}),
    ...(sourceArchivePath ? { sourceArchivePath } : {}),
    ...(sourceArchiveBytes ? { sourceArchiveBytes } : {}),
    ...(sourceArchiveSha256 ? { sourceArchiveSha256 } : {}),
    ...(spdxVersion ? { spdxVersion } : {}),
    ...(spdxRevision ? { spdxRevision } : {}),
    ...(archiveEntry ? { archiveEntry } : {}),
  }
  return {
    declaredExpression: expression,
    concludedExpression: expression,
    files: [file],
    noticeFiles: [],
    disposition: "REVIEWED_FOR_DOWNSTREAM_DISTRIBUTION",
    reviewer: "LLM Machines release review",
    reviewedAt: "2026-08-22T10:00:00.000Z",
  }
}

function completeCoverage(components) {
  const refs = components.map(({ bomRef }) => bomRef).sort()
  return {
    expectedComponentCount: refs.length,
    reviewedComponentCount: refs.length,
    expectedRefsSha256: sha256(`${canonicalJson(refs)}\n`),
    missingRefs: [],
    unknownExpressions: [],
    missingRequiredTexts: [],
    copyleftRefs: [],
    prohibitedRefs: [],
    complete: true,
  }
}

function govulnDocuments(mode) {
  return [
    {
      config: {
        protocol_version: "v1.0.0",
        scanner_name: "govulncheck",
        scanner_version: "v1.7.0",
        db: "https://vuln.go.dev",
        db_last_modified: "2026-08-22T09:00:00Z",
        ...(mode === "source" ? { go_version: "go1.25.13" } : {}),
        scan_level: "symbol",
        scan_mode: mode,
      },
    },
    {
      SBOM: {
        go_version: "go1.25.13",
        modules: [{ path: "github.com/portainer/portainer" }],
      },
    },
    {
      osv: {
        schema_version: "1.3.1",
        id: "GO-2026-9999",
        details:
          "Portainer be rebuilt after the fixed version before deployment.",
        affected: [],
      },
    },
    {
      finding: {
        osv: "GO-2026-9999",
        trace: [
          {
            module: "github.com/portainer/portainer",
            package: "github.com/portainer/portainer/api",
            function: "Run",
          },
        ],
      },
    },
    {
      osv: {
        schema_version: "1.3.1",
        id: "GO-2026-9999",
        details:
          "Portainer be rebuilt after the fixed version before deployment.",
        affected: [],
      },
    },
  ]
}

function writeGovulnStream(file, documents) {
  writeFileSync(
    file,
    `${documents.map((document) => JSON.stringify(document, null, 2)).join("\n")}\n`,
  )
}

function createOciArchive(
  root,
  name,
  fixtureSourcePackage,
  layerContents = frontendLayer(),
) {
  const layout = join(root, `${name}-layout`)
  const blobs = join(layout, "blobs", "sha256")
  mkdirSync(blobs, { recursive: true })
  const layer = Buffer.from(layerContents)
  const layerDigest = digest(layer)
  writeFileSync(join(blobs, layerDigest.slice(7)), layer)
  const config = Buffer.from(
    `${canonicalJson({
      architecture: "amd64",
      os: "linux",
      config: {
        Cmd: ["--http-enabled=false"],
        Entrypoint: ["/portainer"],
        Env: ["PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin"],
        ExposedPorts: { "9443/tcp": {} },
        Labels: {
          "io.portainer.server": "true",
          "org.opencontainers.image.version": "2.39.6-llmm.1",
        },
        StopSignal: "SIGTERM",
        User: "",
        Volumes: { "/data": {} },
        WorkingDir: "/",
      },
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
    sourceDateEpoch: fixtureSourcePackage.upstream.sourceDateEpoch,
  })
  return { archive, configDigest, layerDigest }
}

function makeAssemblyRecord(root, assembly, fixtureSourcePackage) {
  const evidenceRoot = join(root, `assembly-${assembly.toLowerCase()}`)
  mkdirSync(evidenceRoot)
  const sourceRoot = `/var/tmp/llmm-portainer-n4r1-${assembly.toLowerCase()}/source`
  writeFileSync(
    join(evidenceRoot, "build-log-receipt.json"),
    `${assembly} build log\n`,
  )
  writeCanonical(join(evidenceRoot, "build-environment-receipt.json"), {
    schema: "llm-machines.portainer-ce-build-environment-receipt.v1",
    assembly,
    platform: "linux/amd64",
    independence: { sourceRoot },
  })
  const overlay = fixtureSourcePackage.downstream.frontendSecurityOverlay
  writeCanonical(join(evidenceRoot, "reachability-receipt.json"), {
    schema: "llm-machines.portainer-ce-reachability-receipt.v1",
    assembly,
    source: {
      root: sourceRoot,
      revision: fixtureSourcePackage.upstream.revision,
      tree: fixtureSourcePackage.upstream.tree,
      fileCount: fixtureSourcePackage.downstream.sourceInventory.fileCount,
      sourceInventorySha256:
        fixtureSourcePackage.downstream.sourceInventory.sha256SumsSha256,
    },
    validator: {
      path: "infra/portainer/ce-downstream/validate-reachability.mjs",
      sha256: sha256(
        readFileSync(join(directory, "validate-reachability.mjs")),
      ),
      nodeVersion: fixtureSourcePackage.downstream.buildToolchain.nodeExecutor,
    },
    evaluatedAt: `2026-08-22T${assembly === "A" ? "08" : "09"}:15:00.000Z`,
    angularJsVex: {
      expiresAt: overlay.angularJsVex.expiry,
      advisories: overlay.angularJsVex.advisories,
    },
    command: [
      "node",
      "infra/portainer/ce-downstream/validate-reachability.mjs",
      sourceRoot,
    ],
    exitStatus: 0,
    stdoutSha256: sha256(
      "Portainer go-archive reachability boundary validated.\n",
    ),
    stderrSha256: sha256(""),
    containsCredentials: false,
    guardStates: Object.fromEntries(
      reachabilityGuardNames.map((name) => [name, true]),
    ),
    errors: [],
  })
  const record = {
    schema: "llm-machines.portainer-ce-sealed-assembly.v1",
    assembly,
    source: {
      revision: fixtureSourcePackage.upstream.revision,
      tree: fixtureSourcePackage.upstream.tree,
      archiveSha256: fixtureSourcePackage.upstream.archiveSha256,
      sourceInventorySha256:
        fixtureSourcePackage.downstream.sourceInventory.sha256SumsSha256,
      dockerfileSha256: fixtureSourcePackage.downstream.dockerfile.sha256,
      dockerignoreSha256: fixtureSourcePackage.downstream.dockerignore.sha256,
      patchSha256: fixtureSourcePackage.downstream.patch.sha256,
    },
    build: {
      platform: "linux/amd64",
      buildkitPlatformDigest:
        fixtureSourcePackage.downstream.buildToolchain.buildkit.platformDigest,
      startedOn: `2026-08-22T0${assembly === "A" ? "8" : "9"}:00:00.000Z`,
      finishedOn: `2026-08-22T${assembly === "A" ? "08" : "09"}:30:00.000Z`,
    },
    evidence: [
      {
        id: "build-log",
        path: "build-log-receipt.json",
        sha256: sha256(
          readFileSync(join(evidenceRoot, "build-log-receipt.json")),
        ),
      },
      {
        id: "build-environment",
        path: "build-environment-receipt.json",
        sha256: sha256(
          readFileSync(join(evidenceRoot, "build-environment-receipt.json")),
        ),
      },
      {
        id: "source-reachability",
        path: "reachability-receipt.json",
        sha256: sha256(
          readFileSync(join(evidenceRoot, "reachability-receipt.json")),
        ),
      },
    ],
  }
  const recordPath = join(evidenceRoot, "sealed-record.json")
  writeCanonical(recordPath, record)
  return { evidenceRoot, recordPath }
}

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), "llmm-portainer-evidence-"))
  const repositoryRoot = join(root, "repository")
  const fixtureSourcePackage = JSON.parse(JSON.stringify(sourcePackage))
  fixtureSourcePackage.downstream.evidenceTooling = Object.fromEntries(
    [
      [
        "assemblySealer",
        "infra/portainer/ce-downstream/seal-assembly-evidence.mjs",
      ],
      [
        "reachabilityReceiptGenerator",
        "infra/portainer/ce-downstream/generate-reachability-receipt.mjs",
      ],
    ].map(([id, path]) => {
      const source = join(directory, "../../..", path)
      const destination = join(repositoryRoot, path)
      mkdirSync(dirname(destination), { recursive: true })
      copyFileSync(source, destination)
      return [id, { path, sha256: sha256(readFileSync(source)) }]
    }),
  )
  for (const entry of [
    fixtureSourcePackage.downstream.patch,
    fixtureSourcePackage.downstream.dockerfile,
    fixtureSourcePackage.downstream.dockerignore,
  ]) {
    const destination = join(repositoryRoot, entry.path)
    mkdirSync(dirname(destination), { recursive: true })
    copyFileSync(join(directory, "../../..", entry.path), destination)
  }
  const frontendSourceRoot = join(root, "frontend-source")
  mkdirSync(join(frontendSourceRoot, ".llmm-build"), { recursive: true })
  mkdirSync(join(frontendSourceRoot, "api", "git", "testdata"), {
    recursive: true,
  })
  mkdirSync(join(frontendSourceRoot, "webpack"), { recursive: true })
  writeCanonical(join(frontendSourceRoot, "package.json"), {
    name: "@portainer/ce",
    version: fixtureSourcePackage.upstream.version,
    packageManager: `pnpm@${fixtureSourcePackage.downstream.pnpm.version}`,
  })
  writeFileSync(join(frontendSourceRoot, "go.mod"), "module example.org/main\n")
  writeFileSync(
    join(frontendSourceRoot, "go.sum"),
    `example.org/module v1.0.0 ${fixtureModuleH1}\nexample.org/module v1.0.0/go.mod ${fixtureModuleGoModH1}\n`,
  )
  writeFileSync(join(frontendSourceRoot, "LICENSE"), "Portainer Zlib license\n")
  writeFileSync(
    join(frontendSourceRoot, "ATTRIBUTIONS.md"),
    "Portainer attributions\n",
  )
  writeFileSync(
    join(frontendSourceRoot, "api", "git", "testdata", "azure-repo copy.zip"),
    "fixture archive\n",
  )
  writeFileSync(
    join(frontendSourceRoot, "pnpm-lock.yaml"),
    "lockfileVersion: '9.0'\n",
  )
  writeFileSync(
    join(frontendSourceRoot, "webpack", "webpack.common.js"),
    "export const common = {}\n",
  )
  writeFileSync(
    join(frontendSourceRoot, "webpack", "webpack.production.js"),
    "export default {}\n",
  )
  const frontendSourceFiles = [
    "ATTRIBUTIONS.md",
    "LICENSE",
    "api/git/testdata/azure-repo copy.zip",
    "go.mod",
    "go.sum",
    "package.json",
    "pnpm-lock.yaml",
    "webpack/webpack.common.js",
    "webpack/webpack.production.js",
  ]
  const frontendSourceInventory = join(
    frontendSourceRoot,
    ".llmm-build",
    "SOURCE-SHA256SUMS",
  )
  writeFileSync(
    frontendSourceInventory,
    `${frontendSourceFiles
      .map(
        (path) =>
          `${sha256(readFileSync(join(frontendSourceRoot, path)))}  ./${path}`,
      )
      .join("\n")}\n`,
  )
  fixtureSourcePackage.downstream.sourceInventory = {
    ...fixtureSourcePackage.downstream.sourceInventory,
    fileCount: frontendSourceFiles.length,
    sha256SumsSha256: sha256(readFileSync(frontendSourceInventory)),
    goModSha256: sha256(readFileSync(join(frontendSourceRoot, "go.mod"))),
    goSumSha256: sha256(readFileSync(join(frontendSourceRoot, "go.sum"))),
    packageJsonSha256: sha256(
      readFileSync(join(frontendSourceRoot, "package.json")),
    ),
    pnpmLockSha256: sha256(
      readFileSync(join(frontendSourceRoot, "pnpm-lock.yaml")),
    ),
    webpackCommonSha256: sha256(
      readFileSync(join(frontendSourceRoot, "webpack", "webpack.common.js")),
    ),
    webpackProductionSha256: sha256(
      readFileSync(
        join(frontendSourceRoot, "webpack", "webpack.production.js"),
      ),
    ),
  }
  const fixtureSourcePackagePath = join(
    repositoryRoot,
    "infra/portainer/ce-downstream/source-package.json",
  )
  writeCanonical(fixtureSourcePackagePath, fixtureSourcePackage)

  const layer = frontendLayer()
  const builtAssemblyA = createOciArchive(
    root,
    "assembly-a",
    fixtureSourcePackage,
    layer,
  )
  const assemblyA = builtAssemblyA.archive
  const assemblyB = join(root, "assembly-b.oci.tar")
  copyFileSync(assemblyA, assemblyB)
  const mismatchedAssembly = createOciArchive(
    root,
    "assembly-mismatch",
    fixtureSourcePackage,
    frontendLayer(
      "webpack://@portainer/ce/./node_modules/.pnpm/extra@1.0.0/node_modules/extra/index.js",
    ),
  ).archive
  const a = makeAssemblyRecord(root, "A", fixtureSourcePackage)
  const b = makeAssemblyRecord(root, "B", fixtureSourcePackage)
  const inspection = inspectOciArchive(assemblyA)
  const sbomInput = join(root, "syft.cdx.json")
  writeCanonical(sbomInput, {
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    serialNumber: "urn:uuid:volatile",
    version: 1,
    metadata: {
      timestamp: "2026-08-22T10:00:00Z",
      tools: {
        components: [{ type: "application", name: "syft", version: "1.50.0" }],
      },
    },
    components: [
      {
        type: "library",
        "bom-ref": "pkg:golang/example.org/main@v2.39.6?package-id=main",
        name: "example.org/main",
        version: "v2.39.6",
        purl: "pkg:golang/example.org/main@v2.39.6",
      },
      {
        type: "library",
        "bom-ref": "pkg:golang/example.org/module@v1.0.0?package-id=module",
        name: "example.org/module",
        version: "v1.0.0",
        purl: "pkg:golang/example.org/module@v1.0.0",
        description:
          "Portainer be rebuilt after the fixed version before deployment.",
      },
      {
        type: "file",
        "bom-ref": "runtime-portainer-file",
        name: "/portainer",
        hashes: [
          { alg: "SHA-256", content: sha256("test-portainer-binary\n") },
        ],
      },
    ],
    dependencies: [
      {
        ref: "pkg:golang/example.org/main@v2.39.6?package-id=main",
        dependsOn: ["pkg:golang/example.org/module@v1.0.0?package-id=module"],
      },
      {
        ref: "pkg:golang/example.org/module@v1.0.0?package-id=module",
        dependsOn: [],
      },
      { ref: "runtime-portainer-file", dependsOn: [] },
    ],
  })
  const trivyInput = join(root, "trivy.raw.json")
  writeCanonical(trivyInput, {
    SchemaVersion: 2,
    Trivy: { Version: "0.73.0" },
    CreatedAt: "2026-08-22T10:00:00Z",
    ArtifactName: "/temporary/assembly-a.oci.tar",
    ArtifactType: "container_image",
    Metadata: {
      ImageID: builtAssemblyA.configDigest,
      DiffIDs: [builtAssemblyA.layerDigest],
      OS: { Family: "debian", Name: "13" },
      ImageConfig: { architecture: "amd64", os: "linux" },
    },
    Results: [
      {
        Target: "portainer",
        Class: "lang-pkgs",
        Type: "gobinary",
        Vulnerabilities: [
          {
            VulnerabilityID: "GO-TEST-0001",
            PkgName: "example.org/module",
            InstalledVersion: "1.0.0",
            Severity: "MEDIUM",
            Title:
              "Portainer be rebuilt after the fixed version before deployment.",
          },
        ],
      },
    ],
  })
  const frontendSbomInput = join(root, "frontend-syft.cdx.json")
  writeCanonical(frontendSbomInput, {
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    version: 1,
    metadata: {
      timestamp: "2026-08-22T10:00:00Z",
      tools: {
        components: [{ type: "application", name: "syft", version: "1.50.0" }],
      },
    },
    components: [
      {
        type: "library",
        "bom-ref": "raw:axios-progress-bar",
        name: "axios-progress-bar",
        version: gitTarballUrl,
      },
      {
        type: "library",
        "bom-ref": "raw:example-frontend",
        name: "example-frontend",
        version: "1.0.0",
      },
      {
        type: "library",
        "bom-ref": "raw:spinkit",
        name: "spinkit",
        version: "2.0.1",
      },
    ],
    dependencies: [
      { ref: "raw:axios-progress-bar", dependsOn: [] },
      { ref: "raw:example-frontend", dependsOn: [] },
      { ref: "raw:spinkit", dependsOn: [] },
    ],
  })
  const frontendTrivyInput = join(root, "frontend-trivy.raw.json")
  writeCanonical(frontendTrivyInput, {
    SchemaVersion: 2,
    Trivy: { Version: "0.73.0" },
    CreatedAt: "2026-08-22T10:00:00Z",
    ArtifactName: frontendSourceRoot,
    ArtifactType: "filesystem",
    Results: [
      {
        Target: "pnpm-lock.yaml",
        Class: "lang-pkgs",
        Type: "pnpm",
        Packages: [
          {
            ID: "axios-progress-bar@1.2.0",
            Name: "axios-progress-bar",
            Version: "1.2.0",
          },
          {
            ID: "example-frontend@1.0.0",
            Name: "example-frontend",
            Version: "1.0.0",
          },
          {
            ID: "spinkit@2.0.1",
            Name: "spinkit",
            Version: "2.0.1",
          },
        ],
        Vulnerabilities: [
          {
            VulnerabilityID: "CVE-TEST-0001",
            PkgName: "example-frontend",
            InstalledVersion: "1.0.0",
            Severity: "MEDIUM",
          },
        ],
      },
    ],
  })
  const publicFiles = [
    { path: "index.html", contents: Buffer.from("<main>Portainer</main>\n") },
    { path: "main.css.map", contents: Buffer.from(cssSourceMapContents()) },
    { path: "main.js", contents: Buffer.from("console.log('frontend')\n") },
    { path: "main.js.map", contents: Buffer.from(sourceMapContents()) },
  ].map(({ path, contents }) => ({
    path,
    bytes: contents.length,
    sha256: sha256(contents),
  }))
  const sourceMaps = [
    {
      path: "main.css.map",
      sha256: sha256(cssSourceMapContents()),
      sourceCount: 1,
    },
    {
      path: "main.js.map",
      sha256: sha256(sourceMapContents()),
      sourceCount: 2,
    },
  ]
  const publicInventorySha256 = sha256(`${canonicalJson(publicFiles)}\n`)
  const sourceMapInventorySha256 = sha256(`${canonicalJson(sourceMaps)}\n`)
  const makeFrontendArchive = (name, version) => {
    const packageManifest = `${canonicalJson({ name, version, license: "MIT" })}\n`
    const archive = gzipSync(
      createTar({
        "package/LICENSE": "license:MIT",
        "package/package.json": packageManifest,
      }),
    )
    return { archive, packageManifest }
  }
  const frontendArchives = {
    axios: makeFrontendArchive("axios-progress-bar", "1.2.0"),
    example: makeFrontendArchive("example-frontend", "1.0.0"),
    spinkit: makeFrontendArchive("spinkit", "2.0.1"),
  }
  const exampleSourceArchiveUrl = `https://codeload.github.com/example/example-frontend/tar.gz/${gitRevision}`
  const exampleSourceArchiveEntry = `example-frontend-${gitRevision}/LICENSE`
  const exampleSourceArchive = gzipSync(
    createTar(
      {
        [`example-frontend-${gitRevision}/`]: "",
        [exampleSourceArchiveEntry]: "license:MIT",
      },
      {
        [`example-frontend-${gitRevision}/README.md`]: "./LICENSE",
      },
    ),
  )
  const spdxSourceRevision = "c4a7237ec8f4654e867546f9f409749300f1bf4c"
  const spdxSourceArchiveUrl = `https://codeload.github.com/spdx/license-list-data/tar.gz/${spdxSourceRevision}`
  const spdxSourceArchiveEntry = `license-list-data-${spdxSourceRevision}/text/MIT.txt`
  const spdxSourceArchive = gzipSync(
    createTar({ [spdxSourceArchiveEntry]: "license:MIT" }),
  )
  const frontendComponents = [
    {
      bomRef: "pkg:npm/axios-progress-bar@1.2.0",
      purl: "pkg:npm/axios-progress-bar@1.2.0",
      name: "axios-progress-bar",
      version: "1.2.0",
      source: {
        kind: "git-tarball",
        lockKey: gitStoreKey,
        tarballUrl: gitTarballUrl,
        revision: gitRevision,
        archivePath: "archives/axios-progress-bar.tgz",
        archiveBytes: frontendArchives.axios.archive.length,
        archiveSha256: sha256(frontendArchives.axios.archive),
        packageManifestEntry: "package/package.json",
        packageManifestSha256: sha256(frontendArchives.axios.packageManifest),
      },
      bundle: { sourceMapPaths: ["main.js.map"], sourcePathCount: 1 },
      license: reviewedLicense("MIT", {
        origin: "package-archive",
        archivePath: "archives/axios-progress-bar.tgz",
        archiveEntry: "package/LICENSE",
      }),
    },
    {
      bomRef: "pkg:npm/example-frontend@1.0.0",
      purl: "pkg:npm/example-frontend@1.0.0",
      name: "example-frontend",
      version: "1.0.0",
      source: {
        kind: "registry",
        lockKey: "example-frontend@1.0.0",
        integrity: sriSha512(frontendArchives.example.archive),
        archivePath: "archives/example-frontend.tgz",
        archiveBytes: frontendArchives.example.archive.length,
        archiveSha256: sha256(frontendArchives.example.archive),
        packageManifestEntry: "package/package.json",
        packageManifestSha256: sha256(frontendArchives.example.packageManifest),
      },
      bundle: { sourceMapPaths: ["main.js.map"], sourcePathCount: 1 },
      license: reviewedLicense("MIT", {
        origin: "reviewed-source-archive",
        sourceArchiveUrl: exampleSourceArchiveUrl,
        sourceRevision: gitRevision,
        sourceArchivePath: "archives/example-frontend-source.tgz",
        sourceArchiveBytes: exampleSourceArchive.length,
        sourceArchiveSha256: sha256(exampleSourceArchive),
        archiveEntry: exampleSourceArchiveEntry,
      }),
    },
    {
      bomRef: "pkg:npm/spinkit@2.0.1",
      purl: "pkg:npm/spinkit@2.0.1",
      name: "spinkit",
      version: "2.0.1",
      source: {
        kind: "registry",
        lockKey: cssStoreKey,
        integrity: sriSha512(frontendArchives.spinkit.archive),
        archivePath: "archives/spinkit.tgz",
        archiveBytes: frontendArchives.spinkit.archive.length,
        archiveSha256: sha256(frontendArchives.spinkit.archive),
        packageManifestEntry: "package/package.json",
        packageManifestSha256: sha256(frontendArchives.spinkit.packageManifest),
      },
      bundle: { sourceMapPaths: ["main.css.map"], sourcePathCount: 1 },
      license: reviewedLicense("MIT", {
        origin: "reviewed-spdx",
        spdxVersion: "3.28",
        spdxRevision: "v3.28",
        sourceArchiveUrl: spdxSourceArchiveUrl,
        sourceRevision: spdxSourceRevision,
        sourceArchivePath: "archives/spdx-license-list-data.tgz",
        sourceArchiveBytes: spdxSourceArchive.length,
        sourceArchiveSha256: sha256(spdxSourceArchive),
        archiveEntry: spdxSourceArchiveEntry,
      }),
    },
  ]
  const frontendCustodyRoot = join(root, "frontend-license-custody")
  mkdirSync(join(frontendCustodyRoot, "archives"), { recursive: true })
  mkdirSync(join(frontendCustodyRoot, "licenses"), { recursive: true })
  writeFileSync(
    join(frontendCustodyRoot, "archives", "axios-progress-bar.tgz"),
    frontendArchives.axios.archive,
  )
  writeFileSync(
    join(frontendCustodyRoot, "archives", "example-frontend.tgz"),
    frontendArchives.example.archive,
  )
  writeFileSync(
    join(frontendCustodyRoot, "archives", "example-frontend-source.tgz"),
    exampleSourceArchive,
  )
  writeFileSync(
    join(frontendCustodyRoot, "archives", "spinkit.tgz"),
    frontendArchives.spinkit.archive,
  )
  writeFileSync(
    join(frontendCustodyRoot, "archives", "spdx-license-list-data.tgz"),
    spdxSourceArchive,
  )
  writeFileSync(join(frontendCustodyRoot, "licenses", "MIT.txt"), "license:MIT")
  const frontendCustodyFiles = [
    "archives/axios-progress-bar.tgz",
    "archives/example-frontend.tgz",
    "archives/example-frontend-source.tgz",
    "archives/spinkit.tgz",
    "archives/spdx-license-list-data.tgz",
    "licenses/MIT.txt",
  ]
  writeFileSync(
    join(frontendCustodyRoot, "SHA256SUMS"),
    `${frontendCustodyFiles
      .map(
        (path) =>
          `${sha256(readFileSync(join(frontendCustodyRoot, path)))}  ./${path}`,
      )
      .join("\n")}\n`,
  )
  const frontendLicenseInput = join(root, "frontend-license-input.json")
  writeCanonical(frontendLicenseInput, {
    schema: "llm-machines.portainer-ce-frontend-license-input.v3",
    generatedAt: "2026-08-22T10:00:00.000Z",
    packageManager: {
      name: "pnpm",
      version: fixtureSourcePackage.downstream.pnpm.version,
      packageJson: {
        path: "package.json",
        sha256: sha256(readFileSync(join(frontendSourceRoot, "package.json"))),
      },
      lockfile: {
        path: "pnpm-lock.yaml",
        sha256: sha256(
          readFileSync(join(frontendSourceRoot, "pnpm-lock.yaml")),
        ),
      },
      install: { frozen: true, ignorePnpmfile: true, scripts: false },
    },
    artifact: {
      ociArchiveSha256: sha256(readFileSync(assemblyA)),
      manifestDigest: inspection.platformDigest,
      layerDigests: [builtAssemblyA.layerDigest],
      publicInventorySha256,
      sourceMapInventorySha256,
    },
    custody: {
      root: "frontend-license-custody",
      manifestPath: "SHA256SUMS",
      manifestSha256: sha256(
        readFileSync(join(frontendCustodyRoot, "SHA256SUMS")),
      ),
    },
    components: frontendComponents,
    coverage: completeCoverage(frontendComponents),
  })
  const custodyRoot = join(root, "runtime-license-custody")
  mkdirSync(join(custodyRoot, "source"), { recursive: true })
  mkdirSync(join(custodyRoot, "modules"), { recursive: true })
  mkdirSync(join(custodyRoot, "licenses"), { recursive: true })
  copyFileSync(
    frontendSourceInventory,
    join(custodyRoot, "source", "SOURCE-SHA256SUMS"),
  )
  writeFileSync(
    join(custodyRoot, "modules", "example.zip"),
    createZip(fixtureModuleContents, new Set([fixtureZeroByteArchiveEntry])),
  )
  writeFileSync(join(custodyRoot, "modules", "example.mod"), fixtureModuleGoMod)
  writeCanonical(join(custodyRoot, "modules", "example.info"), {
    Version: "v1.0.0",
  })
  writeFileSync(
    join(custodyRoot, "licenses", "example-module-LICENSE"),
    fixtureModuleLicense,
  )
  const custodyManifestPath = "SHA256SUMS"
  const custodyFiles = [
    "licenses/example-module-LICENSE",
    "modules/example.info",
    "modules/example.mod",
    "modules/example.zip",
    "source/SOURCE-SHA256SUMS",
  ]
  writeFileSync(
    join(custodyRoot, custodyManifestPath),
    `${custodyFiles
      .map(
        (path) => `${sha256(readFileSync(join(custodyRoot, path)))}  ./${path}`,
      )
      .join("\n")}\n`,
  )
  const mainLicense = {
    declaredExpression: "Zlib",
    concludedExpression: "Zlib",
    files: [
      {
        path: "LICENSE",
        bytes: Buffer.byteLength("Portainer Zlib license\n"),
        sha256: sha256("Portainer Zlib license\n"),
        origin: "source-inventory",
      },
    ],
    noticeFiles: [
      {
        path: "ATTRIBUTIONS.md",
        bytes: Buffer.byteLength("Portainer attributions\n"),
        sha256: sha256("Portainer attributions\n"),
        origin: "source-inventory",
      },
    ],
    disposition: "PERMITTED_WITH_ATTRIBUTION",
    reviewer: "LLM Machines release review",
    reviewedAt: "2026-08-22T10:00:00.000Z",
  }
  const runtimeComponents = [
    {
      sbomBomRef: "pkg:golang/example.org/main@v2.39.6?package-id=main",
      purl: "pkg:golang/example.org/main@v2.39.6",
      name: "example.org/main",
      version: "v2.39.6",
      source: {
        kind: "main-module-source",
        revision: fixtureSourcePackage.upstream.revision,
        tree: fixtureSourcePackage.upstream.tree,
        overlaySha256: fixtureSourcePackage.downstream.patch.sha256,
        sourceManifestPath: "source/SOURCE-SHA256SUMS",
        sourceManifestBytes: readFileSync(frontendSourceInventory).length,
        sourceManifestSha256: sha256(readFileSync(frontendSourceInventory)),
        sourceFileCount: frontendSourceFiles.length,
        goModSha256:
          fixtureSourcePackage.downstream.sourceInventory.goModSha256,
        goSumSha256:
          fixtureSourcePackage.downstream.sourceInventory.goSumSha256,
      },
      license: mainLicense,
    },
    {
      sbomBomRef: "pkg:golang/example.org/module@v1.0.0?package-id=module",
      purl: "pkg:golang/example.org/module@v1.0.0",
      name: "example.org/module",
      version: "v1.0.0",
      source: {
        kind: "go-module-zip",
        archivePath: "modules/example.zip",
        archiveBytes: readFileSync(join(custodyRoot, "modules", "example.zip"))
          .length,
        archiveSha256: sha256(
          readFileSync(join(custodyRoot, "modules", "example.zip")),
        ),
        goSumH1: fixtureModuleH1,
        goModPath: "modules/example.mod",
        goModBytes: readFileSync(join(custodyRoot, "modules", "example.mod"))
          .length,
        goModSha256: sha256(
          readFileSync(join(custodyRoot, "modules", "example.mod")),
        ),
        goModSumH1: fixtureModuleGoModH1,
        infoPath: "modules/example.info",
        infoBytes: readFileSync(join(custodyRoot, "modules", "example.info"))
          .length,
        infoSha256: sha256(
          readFileSync(join(custodyRoot, "modules", "example.info")),
        ),
      },
      license: reviewedLicense("BSD-3-Clause", {
        path: "licenses/example-module-LICENSE",
        contents: fixtureModuleLicense,
        origin: "module-archive",
        archiveEntry: fixtureModuleArchiveEntry,
      }),
    },
    {
      sbomBomRef: "runtime-portainer-file",
      purl: null,
      name: "/portainer",
      version: null,
      source: {
        kind: "runtime-artifact-file",
        artifactPath: "/portainer",
        sha256: sha256("test-portainer-binary\n"),
      },
      license: mainLicense,
    },
  ]
  const runtimeLicenseInput = join(root, "runtime-license-input.json")
  writeCanonical(runtimeLicenseInput, {
    schema: "llm-machines.portainer-ce-runtime-license-input.v2",
    generatedAt: "2026-08-22T10:00:00.000Z",
    artifact: {
      ociArchiveSha256: sha256(readFileSync(assemblyA)),
      manifestDigest: inspection.platformDigest,
      configDigest: builtAssemblyA.configDigest,
      rawSbomSha256: sha256(readFileSync(sbomInput)),
    },
    custody: {
      root: "runtime-license-custody",
      manifestPath: custodyManifestPath,
      manifestSha256: sha256(
        readFileSync(join(custodyRoot, custodyManifestPath)),
      ),
    },
    components: runtimeComponents,
    coverage: completeCoverage(
      runtimeComponents.map(({ sbomBomRef }) => ({ bomRef: sbomBomRef })),
    ),
  })
  const sourceGovulncheckInput = join(root, "govuln-source.jsonl")
  const binaryGovulncheckInput = join(root, "govuln-binary.jsonl")
  writeGovulnStream(sourceGovulncheckInput, govulnDocuments("source"))
  writeGovulnStream(binaryGovulncheckInput, govulnDocuments("binary"))
  const scanMetadata = join(root, "scan-metadata.json")
  writeCanonical(scanMetadata, {
    schema: "llm-machines.portainer-ce-scan-input.v1",
    scannedAt: "2026-08-22T10:00:00.000Z",
    syft: {
      name: "syft",
      version: "1.50.0",
      toolImageDigest: `sha256:${"1".repeat(64)}`,
      targetImageDigest: inspection.platformDigest,
    },
    trivy: {
      name: "trivy",
      version: "0.73.0",
      toolImageDigest: `sha256:${"2".repeat(64)}`,
      targetImageDigest: inspection.platformDigest,
      databaseUpdatedAt: "2026-08-22T09:00:00.000Z",
      databaseSha256: "3".repeat(64),
    },
    govulncheck: {
      name: "govulncheck",
      version: "1.7.0",
      binarySha256: "4".repeat(64),
    },
    frontend: {
      sourceInventorySha256:
        fixtureSourcePackage.downstream.sourceInventory.sha256SumsSha256,
      syft: {
        name: "syft",
        version: "1.50.0",
        toolImageDigest: `sha256:${"1".repeat(64)}`,
      },
      trivy: {
        name: "trivy",
        version: "0.73.0",
        toolImageDigest: `sha256:${"2".repeat(64)}`,
        databaseUpdatedAt: "2026-08-22T09:00:00.000Z",
        databaseSha256: "3".repeat(64),
      },
    },
  })
  return {
    root,
    fixtureSourcePackage,
    fixtureSourcePackagePath,
    frontendSourceInventory,
    custodyRoot,
    assemblyA,
    assemblyB,
    mismatchedAssembly,
    assemblyARecord: a.recordPath,
    assemblyBRecord: b.recordPath,
    assemblyAEvidenceRoot: a.evidenceRoot,
    sbomInput,
    trivyInput,
    frontendSbomInput,
    frontendTrivyInput,
    frontendLicenseInput,
    runtimeLicenseInput,
    sourceGovulncheckInput,
    binaryGovulncheckInput,
    scanMetadata,
  }
}

function generationInput(fixture, outputRoot) {
  return {
    assemblyA: fixture.assemblyA,
    assemblyB: fixture.assemblyB,
    assemblyARecord: fixture.assemblyARecord,
    assemblyBRecord: fixture.assemblyBRecord,
    frontendSourceInventory: fixture.frontendSourceInventory,
    frontendSbomInput: fixture.frontendSbomInput,
    frontendTrivyInput: fixture.frontendTrivyInput,
    frontendLicenseInput: fixture.frontendLicenseInput,
    runtimeLicenseInput: fixture.runtimeLicenseInput,
    sbomInput: fixture.sbomInput,
    trivyInput: fixture.trivyInput,
    sourceGovulncheckInput: fixture.sourceGovulncheckInput,
    binaryGovulncheckInput: fixture.binaryGovulncheckInput,
    scanMetadata: fixture.scanMetadata,
    outputRoot,
    sourcePackagePath: fixture.fixtureSourcePackagePath,
  }
}

function resealRuntimeCustody(fixture, document) {
  const manifest = join(fixture.custodyRoot, document.custody.manifestPath)
  const paths = readFileSync(manifest, "utf8")
    .trimEnd()
    .split("\n")
    .map((line) => line.slice(68))
  writeFileSync(
    manifest,
    `${paths
      .map(
        (path) =>
          `${sha256(readFileSync(join(fixture.custodyRoot, path)))}  ./${path}`,
      )
      .join("\n")}\n`,
  )
  document.custody.manifestSha256 = sha256(readFileSync(manifest))
  writeCanonical(fixture.runtimeLicenseInput, document)
}

test("two sealed OCI assemblies generate deterministic bound evidence", () => {
  const fixture = createFixture()
  try {
    const firstRoot = join(fixture.root, "evidence-first")
    const secondRoot = join(fixture.root, "evidence-second")
    const first = generatePortainerEvidence(generationInput(fixture, firstRoot))
    const second = generatePortainerEvidence(
      generationInput(fixture, secondRoot),
    )
    assert.equal(
      first.artifact.ociArchiveSha256,
      second.artifact.ociArchiveSha256,
    )
    assert.equal(first.artifact.manifestDigest, second.artifact.manifestDigest)
    assert.deepEqual(
      first.outputs.map(({ path, sha256: value }) => [path, value]),
      second.outputs.map(({ path, sha256: value }) => [path, value]),
    )
    const reproducibility = JSON.parse(
      readFileSync(join(firstRoot, "reproducibility.json"), "utf8"),
    )
    assert.equal(reproducibility.byteIdentical, true)
    assert.equal(reproducibility.assemblies.length, 2)
    assert.equal(reproducibility.reachability.assemblies.length, 2)
    assert.equal(
      reproducibility.assemblies.every(({ evidence }) => evidence.length === 3),
      true,
    )
    assert.equal(
      new Set(
        reproducibility.assemblies.map(
          ({ runtimeInventorySha256 }) => runtimeInventorySha256,
        ),
      ).size,
      1,
    )
    const sbom = JSON.parse(
      readFileSync(join(firstRoot, "sbom.cdx.json"), "utf8"),
    )
    assert.equal(sbom.serialNumber, undefined)
    assert.equal(sbom.metadata.timestamp, undefined)
    assert.equal(
      sbom.metadata.component.hashes[0].content,
      first.artifact.manifestDigest.slice(7),
    )
    const trivy = JSON.parse(
      readFileSync(join(firstRoot, "trivy.json"), "utf8"),
    )
    assert.equal(trivy.CreatedAt, undefined)
    assert.equal(trivy.ArtifactName, "core/portainer-ce-downstream")
    assert.equal(
      trivy.Metadata.ImageConfig.digest,
      first.artifact.manifestDigest,
    )
    const frontendSbom = JSON.parse(
      readFileSync(join(firstRoot, "frontend-sbom.cdx.json"), "utf8"),
    )
    assert.deepEqual(
      frontendSbom.components.map(({ name }) => name),
      ["axios-progress-bar", "example-frontend", "spinkit"],
    )
    const frontendTrivy = JSON.parse(
      readFileSync(join(firstRoot, "frontend-trivy.json"), "utf8"),
    )
    assert.equal(frontendTrivy.LLMMEvidence.runtimeProjection.packageCount, 3)
    assert.equal(
      frontendTrivy.LLMMEvidence.runtimeProjection.severityCounts.MEDIUM,
      1,
    )
    const runtimeBinding = JSON.parse(
      readFileSync(join(firstRoot, "frontend-runtime-binding.json"), "utf8"),
    )
    assert.equal(runtimeBinding.assemblies.length, 2)
    assert.equal(runtimeBinding.runtime.componentCount, 3)
    assert.equal(runtimeBinding.runtime.packageStoreIdentityCount, 3)
    assert.equal(
      runtimeBinding.runtime.sourceMaps.every((sourceMap) =>
        runtimeBinding.runtime.files.some(
          (file) =>
            file.path === sourceMap.path && file.sha256 === sourceMap.sha256,
        ),
      ),
      true,
    )
    const provenance = JSON.parse(
      readFileSync(join(firstRoot, "provenance.intoto.json"), "utf8"),
    )
    const frontendArchives =
      provenance.predicate.buildDefinition.resolvedDependencies.filter(
        ({ uri }) => uri.startsWith("npm:") || uri === gitTarballUrl,
      )
    assert.deepEqual(
      frontendArchives.map(({ uri }) => uri),
      [
        gitTarballUrl,
        "npm:example-frontend@1.0.0",
        `npm:${cssStoreKey}`,
      ].sort(),
    )
    assert.equal(
      frontendArchives.every(({ digest }) =>
        /^[a-f0-9]{64}$/.test(digest.sha256),
      ),
      true,
    )
    assert.deepEqual(
      provenance.predicate.buildDefinition.resolvedDependencies.find(
        ({ uri }) =>
          uri === fixture.fixtureSourcePackage.downstream.pnpm.tarballUrl,
      ),
      {
        uri: fixture.fixtureSourcePackage.downstream.pnpm.tarballUrl,
        digest: {
          sha256: fixture.fixtureSourcePackage.downstream.pnpm.tarballSha256,
        },
      },
    )
    assert.deepEqual(
      provenance.predicate.buildDefinition.resolvedDependencies.filter(
        ({ uri }) =>
          Object.values(
            fixture.fixtureSourcePackage.downstream.evidenceTooling,
          ).some(({ path }) => uri === `file:${path}`),
      ),
      Object.values(fixture.fixtureSourcePackage.downstream.evidenceTooling)
        .map(({ path, sha256: value }) => ({
          uri: `file:${path}`,
          digest: { sha256: value },
        }))
        .sort((left, right) => left.uri.localeCompare(right.uri)),
    )
    assert.deepEqual(
      provenance.predicate.runDetails.byproducts.map(({ name }) => name),
      [
        "assembly-a-build-environment",
        "assembly-a-build-log",
        "assembly-a-source-reachability",
        "assembly-b-build-environment",
        "assembly-b-build-log",
        "assembly-b-source-reachability",
      ],
    )
    const licenseEvidence = JSON.parse(
      readFileSync(join(firstRoot, "artifact-license-evidence.json"), "utf8"),
    )
    const frontendLicenseInput = JSON.parse(
      readFileSync(fixture.frontendLicenseInput, "utf8"),
    )
    const runtimeLicenseInput = JSON.parse(
      readFileSync(fixture.runtimeLicenseInput, "utf8"),
    )
    assert.equal(licenseEvidence.artifactLicenseEvidenceComplete, true)
    assert.equal(licenseEvidence.coverage.expectedComponentCount, 7)
    assert.deepEqual(
      licenseEvidence.components.find(
        ({ scope }) => scope === "frontend-application",
      ).license,
      licenseEvidence.components.find(
        ({ source }) => source.kind === "main-module-source",
      ).license,
    )
    assert.deepEqual(licenseEvidence.custody, {
      archiveCustodyMode: "EXTERNAL_SEALED_DIGEST_BOUND",
      frontend: frontendLicenseInput.custody,
      runtime: runtimeLicenseInput.custody,
    })
    assert.equal(
      sbom.components.every(
        (component) =>
          Array.isArray(component.licenses) && component.licenses.length > 0,
      ),
      true,
    )
    const sourceGovuln = readFileSync(
      join(firstRoot, "govulncheck-source.jsonl"),
      "utf8",
    )
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
    const repeatedOsv = sourceGovuln.filter(
      ({ osv }) => osv?.id === "GO-2026-9999",
    )
    assert.equal(repeatedOsv.length, 2)
    assert.deepEqual(repeatedOsv[0], repeatedOsv[1])
    const index = JSON.parse(
      readFileSync(join(firstRoot, "evidence-input-index.json"), "utf8"),
    )
    assert.equal(index.accepted, false)
    assert.equal(index.runtimeQualified, false)
    assert.equal(index.contractActivation, "INACTIVE")
    assert.equal(index.outputs.length, 10)
    assert.deepEqual(
      index.evidenceTooling,
      fixture.fixtureSourcePackage.downstream.evidenceTooling,
    )
    assert.deepEqual(
      index.outputs.map(({ path }) => path),
      [
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
      ],
    )
    assert.equal(index.frontend.runtime.componentCount, 3)
    assert.deepEqual(index.reachability, reproducibility.reachability)
    assert.equal(index.frontend.license.artifactLicenseEvidenceComplete, true)
    assert.deepEqual(index.frontend.license.custody, {
      archiveCustodyMode: "EXTERNAL_SEALED_DIGEST_BOUND",
      frontend: frontendLicenseInput.custody,
      runtime: runtimeLicenseInput.custody,
    })
    assert.equal(index.inputs.sourcePackageSha256, undefined)
    assert.equal(
      index.inputs.sourcePackageContractSha256,
      sha256(
        `${canonicalJson(
          sourcePackageContractProjection(fixture.fixtureSourcePackage),
        )}\n`,
      ),
    )
  } finally {
    rmSync(fixture.root, { force: true, recursive: true })
  }
})

test("the source-package contract projection excludes artifact evidence", () => {
  const changed = JSON.parse(JSON.stringify(sourcePackage))
  changed.downstream.artifactEvidence = {
    ociArchiveSha256: "f".repeat(64),
    independentBuilds: 999,
  }
  const originalProjection = sourcePackageContractProjection(sourcePackage)
  const changedProjection = sourcePackageContractProjection(changed)
  assert.equal(originalProjection.downstream.artifactEvidence, undefined)
  assert.deepEqual(changedProjection, originalProjection)
})

test("commercial detection distinguishes identifiers from advisory prose", () => {
  for (const prose of [
    "Portainer be rebuilt before deployment.",
    "The Portainer behavior is fixed in a later release.",
    "Portainer improperly uses this dependency before version 2.20.2.",
  ]) {
    assert.equal(isCommercialPortainerIdentifier(prose), false)
  }
  for (const identifier of [
    "github.com/portainer/portainer-ee/api",
    "pkg:golang/github.com/portainer/portainer-enterprise@2.39.6",
    "/opt/portainer/enterprise/plugin",
    "LicenseRef-Proprietary",
    "PORTAINER_LICENSE_KEY",
    "portainer-trial-license.key",
  ]) {
    assert.equal(isCommercialPortainerIdentifier(identifier), true)
  }
})

test("a different independent OCI assembly fails before evidence is written", () => {
  const fixture = createFixture()
  try {
    const outputRoot = join(fixture.root, "mismatch-evidence")
    assert.throws(
      () =>
        generatePortainerEvidence({
          ...generationInput(fixture, outputRoot),
          assemblyB: fixture.mismatchedAssembly,
        }),
      /assemblies are not byte-identical/,
    )
    assert.equal(existsSync(outputRoot), false)
  } finally {
    rmSync(fixture.root, { force: true, recursive: true })
  }
})

test("sealed-record drift fails before evidence is written", () => {
  const fixture = createFixture()
  try {
    writeFileSync(
      join(fixture.assemblyAEvidenceRoot, "build-log-receipt.json"),
      "changed after sealing\n",
    )
    const outputRoot = join(fixture.root, "record-drift-evidence")
    assert.throws(
      () => generatePortainerEvidence(generationInput(fixture, outputRoot)),
      /evidence 1 SHA-256 differs/,
    )
    assert.equal(existsSync(outputRoot), false)
  } finally {
    rmSync(fixture.root, { force: true, recursive: true })
  }
})

test("source evidence tooling must match the exact producer files", () => {
  const fixture = createFixture()
  try {
    const contract = JSON.parse(
      readFileSync(fixture.fixtureSourcePackagePath, "utf8"),
    )
    contract.downstream.evidenceTooling.assemblySealer.sha256 = "f".repeat(64)
    writeCanonical(fixture.fixtureSourcePackagePath, contract)
    const outputRoot = join(fixture.root, "wrong-evidence-tooling")
    assert.throws(
      () => generatePortainerEvidence(generationInput(fixture, outputRoot)),
      /assemblySealer differs from its exact producer identity/,
    )
    assert.equal(existsSync(outputRoot), false)
  } finally {
    rmSync(fixture.root, { force: true, recursive: true })
  }
})

test("reachability receipts fail closed on a false guard state", () => {
  const fixture = createFixture()
  try {
    const receiptPath = join(
      fixture.assemblyAEvidenceRoot,
      "reachability-receipt.json",
    )
    const receipt = JSON.parse(readFileSync(receiptPath, "utf8"))
    receipt.guardStates.NG_SRCSET_ABSENT = false
    writeCanonical(receiptPath, receipt)
    const record = JSON.parse(readFileSync(fixture.assemblyARecord, "utf8"))
    record.evidence.find(({ id }) => id === "source-reachability").sha256 =
      sha256(readFileSync(receiptPath))
    writeCanonical(fixture.assemblyARecord, record)
    const outputRoot = join(fixture.root, "invalid-reachability-evidence")
    assert.throws(
      () => generatePortainerEvidence(generationInput(fixture, outputRoot)),
      /reachability receipt is inadmissible/,
    )
    assert.equal(existsSync(outputRoot), false)
  } finally {
    rmSync(fixture.root, { force: true, recursive: true })
  }
})

test("assembly reachability receipts require distinct source roots", () => {
  const fixture = createFixture()
  try {
    const assemblyARoot = JSON.parse(
      readFileSync(
        join(fixture.assemblyAEvidenceRoot, "build-environment-receipt.json"),
        "utf8",
      ),
    ).independence.sourceRoot
    const assemblyBRoot = dirname(fixture.assemblyBRecord)
    const environmentPath = join(
      assemblyBRoot,
      "build-environment-receipt.json",
    )
    const environment = JSON.parse(readFileSync(environmentPath, "utf8"))
    environment.independence.sourceRoot = assemblyARoot
    writeCanonical(environmentPath, environment)

    const reachabilityPath = join(assemblyBRoot, "reachability-receipt.json")
    const reachability = JSON.parse(readFileSync(reachabilityPath, "utf8"))
    reachability.source.root = assemblyARoot
    reachability.command[reachability.command.length - 1] = assemblyARoot
    writeCanonical(reachabilityPath, reachability)

    const record = JSON.parse(readFileSync(fixture.assemblyBRecord, "utf8"))
    record.evidence.find(({ id }) => id === "build-environment").sha256 =
      sha256(readFileSync(environmentPath))
    record.evidence.find(({ id }) => id === "source-reachability").sha256 =
      sha256(readFileSync(reachabilityPath))
    writeCanonical(fixture.assemblyBRecord, record)

    const outputRoot = join(fixture.root, "shared-source-root-evidence")
    assert.throws(
      () => generatePortainerEvidence(generationInput(fixture, outputRoot)),
      /independent reachability receipt contracts differ/,
    )
    assert.equal(existsSync(outputRoot), false)
  } finally {
    rmSync(fixture.root, { force: true, recursive: true })
  }
})

test("scan metadata for another image fails closed", () => {
  const fixture = createFixture()
  try {
    const metadata = JSON.parse(readFileSync(fixture.scanMetadata, "utf8"))
    metadata.trivy.targetImageDigest = `sha256:${"f".repeat(64)}`
    writeCanonical(fixture.scanMetadata, metadata)
    const outputRoot = join(fixture.root, "wrong-target-evidence")
    assert.throws(
      () => generatePortainerEvidence(generationInput(fixture, outputRoot)),
      /targets another image/,
    )
    assert.equal(existsSync(outputRoot), false)
  } finally {
    rmSync(fixture.root, { force: true, recursive: true })
  }
})

test("stale Trivy database evidence fails closed", () => {
  const fixture = createFixture()
  try {
    const metadata = JSON.parse(readFileSync(fixture.scanMetadata, "utf8"))
    metadata.trivy.databaseUpdatedAt = "2026-08-18T09:00:00.000Z"
    writeCanonical(fixture.scanMetadata, metadata)
    const outputRoot = join(fixture.root, "stale-database-evidence")
    assert.throws(
      () => generatePortainerEvidence(generationInput(fixture, outputRoot)),
      /scan metadata is incomplete, stale/,
    )
    assert.equal(existsSync(outputRoot), false)
  } finally {
    rmSync(fixture.root, { force: true, recursive: true })
  }
})

test("frontend evidence fails closed on missing scans, license coverage, and source binding", () => {
  const cases = [
    [
      "sbom-component",
      (fixture) => {
        const document = JSON.parse(
          readFileSync(fixture.frontendSbomInput, "utf8"),
        )
        document.components.pop()
        writeCanonical(fixture.frontendSbomInput, document)
      },
      /does not cover/,
    ],
    [
      "trivy-component",
      (fixture) => {
        const document = JSON.parse(
          readFileSync(fixture.frontendTrivyInput, "utf8"),
        )
        document.Results[0].Packages.pop()
        writeCanonical(fixture.frontendTrivyInput, document)
      },
      /does not cover/,
    ],
    [
      "license-component",
      (fixture) => {
        const document = JSON.parse(
          readFileSync(fixture.frontendLicenseInput, "utf8"),
        )
        document.components.pop()
        document.coverage = completeCoverage(document.components)
        writeCanonical(fixture.frontendLicenseInput, document)
      },
      /components are incomplete/,
    ],
    [
      "license-text",
      (fixture) => {
        const document = JSON.parse(
          readFileSync(fixture.frontendLicenseInput, "utf8"),
        )
        document.components[0].license.files = []
        writeCanonical(fixture.frontendLicenseInput, document)
      },
      /review is incomplete/,
    ],
    [
      "git-revision",
      (fixture) => {
        const document = JSON.parse(
          readFileSync(fixture.frontendLicenseInput, "utf8"),
        )
        document.components[0].source.revision = "a".repeat(40)
        writeCanonical(fixture.frontendLicenseInput, document)
      },
      /does not bind \/public/,
    ],
    [
      "registry-integrity",
      (fixture) => {
        const document = JSON.parse(
          readFileSync(fixture.frontendLicenseInput, "utf8"),
        )
        document.components[1].source.integrity = `sha512-${Buffer.alloc(64).toString("base64")}`
        writeCanonical(fixture.frontendLicenseInput, document)
      },
      /integrity differs from the sealed archive/,
    ],
    [
      "reviewed-source-archive",
      (fixture) => {
        const document = JSON.parse(
          readFileSync(fixture.frontendLicenseInput, "utf8"),
        )
        document.components[1].license.files[0].sourceArchiveSha256 =
          "a".repeat(64)
        writeCanonical(fixture.frontendLicenseInput, document)
      },
      /reviewed source archive is not sealed/,
    ],
    [
      "reviewed-spdx",
      (fixture) => {
        const document = JSON.parse(
          readFileSync(fixture.frontendLicenseInput, "utf8"),
        )
        document.components[2].license.files[0].spdxRevision = "v3.27"
        writeCanonical(fixture.frontendLicenseInput, document)
      },
      /SPDX custody identity is invalid/,
    ],
    [
      "source-inventory",
      (fixture) => {
        writeFileSync(fixture.frontendSourceInventory, "changed\n")
      },
      /differs from the admitted source/,
    ],
  ]
  for (const [name, mutate, pattern] of cases) {
    const fixture = createFixture()
    try {
      mutate(fixture)
      const outputRoot = join(fixture.root, `frontend-${name}-evidence`)
      assert.throws(
        () => generatePortainerEvidence(generationInput(fixture, outputRoot)),
        pattern,
      )
      assert.equal(existsSync(outputRoot), false)
    } finally {
      rmSync(fixture.root, { force: true, recursive: true })
    }
  }
})

test("runtime license evidence must cover every exact SBOM component", () => {
  const fixture = createFixture()
  try {
    const document = JSON.parse(
      readFileSync(fixture.runtimeLicenseInput, "utf8"),
    )
    document.components = []
    document.coverage = completeCoverage([])
    writeCanonical(fixture.runtimeLicenseInput, document)
    const outputRoot = join(fixture.root, "runtime-license-missing-evidence")
    assert.throws(
      () => generatePortainerEvidence(generationInput(fixture, outputRoot)),
      /runtime license components are incomplete/,
    )
    assert.equal(existsSync(outputRoot), false)
  } finally {
    rmSync(fixture.root, { force: true, recursive: true })
  }
})

test("runtime license custody recomputes module zip and go.mod hashes", () => {
  for (const kind of ["module-zip", "go-mod"]) {
    const fixture = createFixture()
    try {
      const document = JSON.parse(
        readFileSync(fixture.runtimeLicenseInput, "utf8"),
      )
      const component = document.components.find(
        ({ source }) => source.kind === "go-module-zip",
      )
      if (kind === "module-zip") {
        const archive = createZip({
          ...fixtureModuleContents,
          "example.org/module@v1.0.0/EXTRA": "unexpected\n",
        })
        const path = join(fixture.custodyRoot, component.source.archivePath)
        writeFileSync(path, archive)
        component.source.archiveBytes = archive.length
        component.source.archiveSha256 = sha256(archive)
      } else {
        const contents = "module example.org/changed\n"
        const path = join(fixture.custodyRoot, component.source.goModPath)
        writeFileSync(path, contents)
        component.source.goModBytes = Buffer.byteLength(contents)
        component.source.goModSha256 = sha256(contents)
      }
      resealRuntimeCustody(fixture, document)
      const outputRoot = join(fixture.root, `runtime-${kind}-hash-evidence`)
      assert.throws(
        () => generatePortainerEvidence(generationInput(fixture, outputRoot)),
        /differs from go\.sum|module zip hash differs/,
      )
      assert.equal(existsSync(outputRoot), false)
    } finally {
      rmSync(fixture.root, { force: true, recursive: true })
    }
  }
})

test("runtime legal text must be sealed and byte-identical to the module archive", () => {
  const fixture = createFixture()
  try {
    const document = JSON.parse(
      readFileSync(fixture.runtimeLicenseInput, "utf8"),
    )
    const component = document.components.find(
      ({ source }) => source.kind === "go-module-zip",
    )
    const legal = component.license.files[0]
    writeFileSync(join(fixture.custodyRoot, legal.path), "different\n")
    legal.bytes = Buffer.byteLength("different\n")
    legal.sha256 = sha256("different\n")
    resealRuntimeCustody(fixture, document)
    const outputRoot = join(fixture.root, "runtime-legal-text-evidence")
    assert.throws(
      () => generatePortainerEvidence(generationInput(fixture, outputRoot)),
      /legal archive entry differs/,
    )
    assert.equal(existsSync(outputRoot), false)
  } finally {
    rmSync(fixture.root, { force: true, recursive: true })
  }
})

test("Trivy must bind the exact config, diff IDs, scanner, and linux/amd64 platform", () => {
  const fixture = createFixture()
  try {
    const original = JSON.parse(readFileSync(fixture.trivyInput, "utf8"))
    const cases = [
      [
        "config",
        (report) => {
          report.Metadata.ImageID = `sha256:${"a".repeat(64)}`
        },
      ],
      [
        "diff-ids",
        (report) => {
          report.Metadata.DiffIDs = [`sha256:${"b".repeat(64)}`]
        },
      ],
      [
        "architecture",
        (report) => {
          report.Metadata.ImageConfig.architecture = "arm64"
        },
      ],
      [
        "operating-system",
        (report) => {
          report.Metadata.ImageConfig.os = "windows"
        },
      ],
      [
        "scanner",
        (report) => {
          report.Trivy.Version = "0.72.0"
        },
      ],
    ]
    for (const [name, mutate] of cases) {
      const report = JSON.parse(JSON.stringify(original))
      mutate(report)
      writeCanonical(fixture.trivyInput, report)
      const outputRoot = join(fixture.root, `trivy-${name}-evidence`)
      assert.throws(
        () => generatePortainerEvidence(generationInput(fixture, outputRoot)),
        /targets another image\/platform/,
      )
      assert.equal(existsSync(outputRoot), false)
    }
  } finally {
    rmSync(fixture.root, { force: true, recursive: true })
  }
})

test("govulncheck streams require exact configuration and structured findings", () => {
  const fixture = createFixture()
  try {
    const cases = [
      ["duplicate-config", (documents) => documents.push(documents[0])],
      [
        "wrong-scanner",
        (documents) => {
          documents[0].config.scanner_name = "other"
        },
      ],
      [
        "wrong-version",
        (documents) => {
          documents[0].config.scanner_version = "v1.6.0"
        },
      ],
      [
        "wrong-level",
        (documents) => {
          documents[0].config.scan_level = "package"
        },
      ],
      [
        "wrong-mode",
        (documents) => {
          documents[0].config.scan_mode = "binary"
        },
      ],
      [
        "wrong-go",
        (documents) => {
          documents[0].config.go_version = "go1.24.0"
        },
      ],
      [
        "invalid-database-time",
        (documents) => {
          documents[0].config.db_last_modified = "invalid"
        },
      ],
      ["error-record", (documents) => documents.push({ error: "scan failed" })],
      [
        "missing-osv",
        (documents) => {
          documents.splice(4, 1)
          documents.splice(2, 1)
        },
      ],
      ["missing-finding", (documents) => documents.splice(3, 1)],
      [
        "unknown-osv",
        (documents) => {
          documents[3].finding.osv = "GO-2026-1111"
        },
      ],
      [
        "empty-trace",
        (documents) => {
          documents[3].finding.trace = []
        },
      ],
      [
        "conflicting-duplicate-osv",
        (documents) => {
          documents[4].osv.summary = "conflicting duplicate"
        },
      ],
    ]
    for (const [name, mutate] of cases) {
      const documents = govulnDocuments("source")
      mutate(documents)
      writeGovulnStream(fixture.sourceGovulncheckInput, documents)
      const outputRoot = join(fixture.root, `govuln-${name}-evidence`)
      assert.throws(
        () => generatePortainerEvidence(generationInput(fixture, outputRoot)),
        /not complete symbol-level govulncheck v1\.7\.0 evidence|database timestamp/,
      )
      assert.equal(existsSync(outputRoot), false)
    }
  } finally {
    rmSync(fixture.root, { force: true, recursive: true })
  }
})

test("actual commercial package, path, module, and license identifiers fail closed", () => {
  const fixture = createFixture()
  try {
    const originalSbom = JSON.parse(readFileSync(fixture.sbomInput, "utf8"))
    const originalTrivy = JSON.parse(readFileSync(fixture.trivyInput, "utf8"))
    const cases = [
      [
        "sbom-package",
        () => {
          const sbom = JSON.parse(JSON.stringify(originalSbom))
          sbom.components[0].purl =
            "pkg:golang/github.com/portainer/portainer-ee@2.39.6"
          writeCanonical(fixture.sbomInput, sbom)
        },
      ],
      [
        "sbom-license",
        () => {
          const sbom = JSON.parse(JSON.stringify(originalSbom))
          sbom.components[0].licenses = [
            { license: { id: "LicenseRef-Proprietary" } },
          ]
          writeCanonical(fixture.sbomInput, sbom)
        },
      ],
      [
        "trivy-path",
        () => {
          const trivy = JSON.parse(JSON.stringify(originalTrivy))
          trivy.Results[0].Vulnerabilities[0].PkgPath =
            "/opt/portainer/enterprise/plugin"
          writeCanonical(fixture.trivyInput, trivy)
        },
      ],
      [
        "govuln-module",
        () => {
          const documents = govulnDocuments("source")
          documents[1].SBOM.modules[0].path =
            "github.com/portainer/portainer-ee"
          writeGovulnStream(fixture.sourceGovulncheckInput, documents)
        },
      ],
    ]
    for (const [name, mutate] of cases) {
      writeCanonical(fixture.sbomInput, originalSbom)
      writeCanonical(fixture.trivyInput, originalTrivy)
      writeGovulnStream(
        fixture.sourceGovulncheckInput,
        govulnDocuments("source"),
      )
      mutate()
      const outputRoot = join(fixture.root, `commercial-${name}-evidence`)
      assert.throws(
        () => generatePortainerEvidence(generationInput(fixture, outputRoot)),
        /commercial Portainer identifier/,
      )
      assert.equal(existsSync(outputRoot), false)
    }
  } finally {
    rmSync(fixture.root, { force: true, recursive: true })
  }
})
