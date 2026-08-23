import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { test } from "node:test"

import { buildReachabilityReceipt } from "./generate-reachability-receipt.mjs"
import { sealAssemblyEvidencePair } from "./seal-assembly-evidence.mjs"

const root = path.resolve(import.meta.dirname, "../../..")
const sourcePackagePath = path.join(
  root,
  "infra/portainer/ce-downstream/source-package.json",
)
const sourcePackage = JSON.parse(readFileSync(sourcePackagePath, "utf8"))
const rawFiles = [
  "build.log",
  "builder-cleanup.log",
  "builder-container-summary.log",
  "builder-du.log",
  "builder-inspect-final.log",
  "builder-inspect.log",
  "buildx-after-cleanup.log",
  "filesystem-after-build.log",
  "filesystem-after-cleanup.log",
  "memory-after-build.log",
  "memory-after-cleanup.log",
  "oci-config.json",
  "oci-identities.txt",
  "oci-index.json",
  "oci-manifest.json",
  "output-SHA256SUMS",
  "raw-oci-SHA256SUMS",
  "raw-oci-file-inventory.tsv",
  "source-key-SHA256SUMS",
]

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}

function write(file, value) {
  writeFileSync(file, value, { mode: 0o600 })
}

function evidenceManifest(evidenceRoot) {
  const ignored = new Set([
    "EVIDENCE-SHA256SUMS",
    "build-environment-receipt.json",
    "build-log-receipt.json",
    "reachability-receipt.json",
    "reachability-run.exit",
    "reachability-run.stderr",
    "reachability-run.stdout",
    "reachability-run.times",
    "sealed-record.json",
  ])
  const lines = readdirSync(evidenceRoot)
    .filter((relative) => !ignored.has(relative))
    .sort()
    .map((relative) => {
      const bytes = readFileSync(path.join(evidenceRoot, relative))
      return `${sha256(bytes)}  ./${relative}`
    })
  write(path.join(evidenceRoot, "EVIDENCE-SHA256SUMS"), `${lines.join("\n")}\n`)
}

function fixtureAssembly(fixtureRoot, assembly) {
  const lower = assembly.toLowerCase()
  const evidenceRoot = path.join(fixtureRoot, `assembly-${lower}`)
  mkdirSync(evidenceRoot)
  const builder = `llmm-portainer-n4r1r2-${lower}`
  const sourceRoot = `/var/tmp/llmm-portainer-n4r1r2/${lower}/source`
  const outputRoot = `/var/tmp/llmm-portainer-n4r1r2/${lower}/output`
  const dockerfile = path.join(root, sourcePackage.downstream.dockerfile.path)
  const command = [
    "docker",
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
    `SOURCE_DATE_EPOCH=${sourcePackage.upstream.sourceDateEpoch}`,
    "--output",
    `type=oci,dest=${outputRoot}/raw-oci,tar=false,rewrite-timestamp=true`,
    "--file",
    dockerfile,
    sourceRoot,
  ]
  write(
    path.join(evidenceRoot, "build.log"),
    `${JSON.stringify(command)}\n#1 building\n#1 DONE 1.0s\n`,
  )
  const inspect = [
    `Name:          ${builder}`,
    "Driver:        docker-container",
    "Name:                  node0",
    "Status:                running",
    `BuildKit version:      v${sourcePackage.downstream.buildToolchain.buildkit.version}`,
    "Platforms:             linux/amd64, linux/386",
    "",
  ].join("\n")
  write(path.join(evidenceRoot, "builder-inspect.log"), inspect)
  write(path.join(evidenceRoot, "builder-inspect-final.log"), inspect)
  const started =
    assembly === "A"
      ? "2026-08-22T22:00:00.123456789Z"
      : "2026-08-22T22:10:00.123456789Z"
  write(
    path.join(evidenceRoot, "builder-container-summary.log"),
    `"moby/buildkit@${sourcePackage.downstream.buildToolchain.buildkit.indexDigest}" [] "bridge" "running" "${started}"\n`,
  )
  for (const relative of rawFiles) {
    const file = path.join(evidenceRoot, relative)
    if (relative === "build.log" || relative.includes("builder-inspect"))
      continue
    if (relative === "builder-container-summary.log") continue
    if (relative.startsWith("filesystem-")) {
      write(
        file,
        "Filesystem 1B-blocks Used Available Use% Mounted on\n/dev/root 1000000 500000 500000 50% /\n",
      )
    } else if (relative.startsWith("memory-")) {
      write(
        file,
        " total used free shared buff/cache available\nMem: 2000000 500000 500000 0 1000000 1500000\nSwap: 100000 1000 99000\n",
      )
    } else if (relative === "source-key-SHA256SUMS") {
      const inventory = sourcePackage.downstream.sourceInventory
      write(
        file,
        [
          `${inventory.sha256SumsSha256}  .llmm-build/SOURCE-SHA256SUMS`,
          `${inventory.packageJsonSha256}  package.json`,
          `${inventory.pnpmLockSha256}  pnpm-lock.yaml`,
          `${inventory.goModSha256}  go.mod`,
          `${inventory.goSumSha256}  go.sum`,
          `${inventory.webpackCommonSha256}  webpack/webpack.common.js`,
          "",
        ].join("\n"),
      )
    } else {
      write(file, `${relative}:stable\n`)
    }
  }
  const founderBefore =
    assembly === "A"
      ? "founder-container-inventory-before-cleanup.tsv"
      : "founder-container-inventory-before.tsv"
  const founderAfter =
    assembly === "A"
      ? "founder-container-inventory-after-cleanup.tsv"
      : "founder-container-inventory-after.tsv"
  write(path.join(evidenceRoot, founderBefore), "founder-stable\n")
  write(path.join(evidenceRoot, founderAfter), "founder-stable\n")
  if (assembly === "B") {
    write(path.join(evidenceRoot, "builder-bootstrap.log"), "bootstrap\n")
  }
  const finished = new Date(
    assembly === "A" ? "2026-08-22T22:05:00Z" : "2026-08-22T22:15:00Z",
  )
  utimesSync(path.join(evidenceRoot, "build.log"), finished, finished)
  utimesSync(path.join(evidenceRoot, "output-SHA256SUMS"), finished, finished)
  const evaluatedAt =
    assembly === "A" ? "2026-08-22T22:20:10.000Z" : "2026-08-22T22:25:10.000Z"
  const reachability = buildReachabilityReceipt({
    assembly,
    sourceRoot,
    evaluatedAt,
    inventory: {
      fileCount: sourcePackage.downstream.sourceInventory.fileCount,
      sourceInventorySha256:
        sourcePackage.downstream.sourceInventory.sha256SumsSha256,
    },
    validatorSha256: sha256(
      readFileSync(
        path.join(
          root,
          "infra/portainer/ce-downstream/validate-reachability.mjs",
        ),
      ),
    ),
    errors: [],
    contract: sourcePackage,
  })
  const reachabilityBytes = `${JSON.stringify(reachability, null, 2)}\n`
  write(path.join(evidenceRoot, "reachability-receipt.json"), reachabilityBytes)
  write(path.join(evidenceRoot, "reachability-run.stdout"), reachabilityBytes)
  write(path.join(evidenceRoot, "reachability-run.stderr"), "")
  write(path.join(evidenceRoot, "reachability-run.exit"), "0\n")
  write(
    path.join(evidenceRoot, "reachability-run.times"),
    assembly === "A"
      ? "2026-08-22T22:20:00Z 2026-08-22T22:20:20Z\n"
      : "2026-08-22T22:25:00Z 2026-08-22T22:25:20Z\n",
  )
  evidenceManifest(evidenceRoot)
  return evidenceRoot
}

function createFixture() {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), "portainer-sealer-"))
  return {
    fixtureRoot,
    assemblyARoot: fixtureAssembly(fixtureRoot, "A"),
    assemblyBRoot: fixtureAssembly(fixtureRoot, "B"),
  }
}

const runtimeIdentity = {
  host: {
    architecture: "amd64",
    hostname: "llmm-uat-core-f0",
    kernel: "test-kernel",
    operatingSystem: "test-os",
    memoryBytes: 2000000,
    rootFilesystemBytes: 1000000,
  },
  docker: {
    engine: sourcePackage.downstream.buildToolchain.dockerEngine,
    buildx: sourcePackage.downstream.buildToolchain.dockerBuildx,
  },
  buildkit: {
    version: sourcePackage.downstream.buildToolchain.buildkit.version,
    platformDigest:
      sourcePackage.downstream.buildToolchain.buildkit.platformDigest,
    configDigest: sourcePackage.downstream.buildToolchain.buildkit.configDigest,
  },
}

test("exact independent raw evidence produces truthful A/B sealed receipts", () => {
  const fixture = createFixture()
  try {
    const result = sealAssemblyEvidencePair({
      assemblyARoot: fixture.assemblyARoot,
      assemblyBRoot: fixture.assemblyBRoot,
      sourcePackagePath,
      runtimeIdentity,
    })
    assert.equal(result.A.evidence.length, 3)
    assert.equal(result.B.evidence.length, 3)
    const environmentA = JSON.parse(
      readFileSync(
        path.join(fixture.assemblyARoot, "build-environment-receipt.json"),
      ),
    )
    const environmentB = JSON.parse(
      readFileSync(
        path.join(fixture.assemblyBRoot, "build-environment-receipt.json"),
      ),
    )
    assert.equal(environmentA.schema.endsWith(".v2"), true)
    assert.equal(environmentA.evidence.bootstrapLog, null)
    assert.equal(environmentA.evidence.reachabilityRunStderr.bytes, 0)
    assert.equal(
      environmentA.evidence.reachabilityRunStdout.sha256,
      sha256(
        readFileSync(
          path.join(fixture.assemblyARoot, "reachability-receipt.json"),
        ),
      ),
    )
    assert.equal(
      environmentB.evidence.bootstrapLog.path,
      "builder-bootstrap.log",
    )
    assert.throws(
      () =>
        sealAssemblyEvidencePair({
          assemblyARoot: fixture.assemblyARoot,
          assemblyBRoot: fixture.assemblyBRoot,
          sourcePackagePath,
          runtimeIdentity,
        }),
      /already exists/,
    )
  } finally {
    rmSync(fixture.fixtureRoot, { recursive: true, force: true })
  }
})

test("OCI drift and fabricated Assembly A bootstrap evidence fail before sealing", () => {
  for (const mutate of [
    ({ assemblyBRoot }) => {
      write(path.join(assemblyBRoot, "oci-identities.txt"), "drift\n")
      evidenceManifest(assemblyBRoot)
    },
    ({ assemblyARoot }) => {
      write(path.join(assemblyARoot, "builder-bootstrap.log"), "fabricated\n")
      evidenceManifest(assemblyARoot)
    },
    ({ assemblyBRoot }) => {
      write(path.join(assemblyBRoot, "reachability-run.exit"), "1\n")
    },
  ]) {
    const fixture = createFixture()
    try {
      mutate(fixture)
      assert.throws(
        () =>
          sealAssemblyEvidencePair({
            assemblyARoot: fixture.assemblyARoot,
            assemblyBRoot: fixture.assemblyBRoot,
            sourcePackagePath,
            runtimeIdentity,
          }),
        /independent equality|unexpectedly contains bootstrap|reachability run evidence/,
      )
      assert.equal(
        readdirSync(fixture.assemblyARoot).includes("sealed-record.json"),
        false,
      )
      assert.equal(
        readdirSync(fixture.assemblyBRoot).includes("sealed-record.json"),
        false,
      )
    } finally {
      rmSync(fixture.fixtureRoot, { recursive: true, force: true })
    }
  }
})
