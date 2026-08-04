import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import test from "node:test"
import {
  canonicalJson,
  generateReleaseEvidence,
} from "./generate-release-evidence.mjs"
import {
  coreInventorySha256,
  readCoreImageInventory,
} from "./validate-image-lock.mjs"

const root = resolve(import.meta.dirname, "../..")
const sha256 = (value) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`
const git = (...arguments_) =>
  execFileSync("git", ["-C", root, ...arguments_], { encoding: "utf8" }).trim()

function write(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, value)
}

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "llmm-release-evidence-"))
  const evidenceRoot = join(directory, "inputs")
  const outputRoot = join(directory, "outputs")
  const correspondingSourceRoot = join(directory, "corresponding-source")
  const firecrawlSourcePacket = join(
    correspondingSourceRoot,
    "firecrawl-corresponding-source.tar.zst",
  )
  const grafanaSourcePacket = join(
    correspondingSourceRoot,
    "grafana-corresponding-source.tar.zst",
  )
  write(firecrawlSourcePacket, "exact firecrawl corresponding source\n")
  write(grafanaSourcePacket, "exact grafana corresponding source\n")
  const inventory = readCoreImageInventory(root)
  const sourceCommit = git("rev-parse", "HEAD^{commit}")
  const sourceTree = git("rev-parse", "HEAD^{tree}")
  const images = inventory.components.map((component, index) => {
    const platformDigest =
      component.kind === "third-party-mirror"
        ? component.platformDigest
        : `sha256:${((index + 2) % 16).toString(16).repeat(64)}`
    const repository = `registry.release.invalid/${component.mirrorRepository}`
    const version =
      component.kind === "third-party-mirror"
        ? component.version
        : `1.0.0-build.${index + 1}`
    const sbom = {
      bomFormat: "CycloneDX",
      specVersion: "1.6",
      version: 1,
      metadata: {
        component: {
          name: component.id,
          version,
          properties: [
            {
              name: "llm-machines:image-platform-digest",
              value: platformDigest,
            },
          ],
        },
      },
    }
    const provenance = {
      _type: "https://in-toto.io/Statement/v1",
      predicateType: "https://slsa.dev/provenance/v1",
      subject: [
        {
          name: repository,
          digest: { sha256: platformDigest.slice(7) },
        },
      ],
      predicate: {
        buildDefinition: {
          buildType: "https://llm-machines.invalid/builds/container/v1",
          externalParameters: { component: component.id },
          internalParameters: {},
          resolvedDependencies: [
            {
              uri: `git+https://source.invalid/${component.id}`,
              digest: { gitCommit: component.sourceRevision },
            },
          ],
        },
        runDetails: {
          builder: { id: "https://llm-machines.invalid/builders/release/v1" },
          metadata: {
            invocationId: `fixture-${component.id}`,
            startedOn: "2026-08-04T00:00:00.000Z",
            finishedOn: "2026-08-04T00:00:01.000Z",
          },
          byproducts: [],
        },
      },
    }
    const sbomBytes = `${canonicalJson(sbom)}\n`
    const provenanceBytes = `${canonicalJson(provenance)}\n`
    write(join(evidenceRoot, "sbom", `${component.id}.cdx.json`), sbomBytes)
    write(
      join(evidenceRoot, "provenance", `${component.id}.intoto.json`),
      provenanceBytes,
    )
    write(
      join(evidenceRoot, "licenses", `${component.id}.txt`),
      `Reviewed license text for ${component.id} under ${component.license}.\n`,
    )
    return {
      id: component.id,
      repository,
      version,
      indexDigest:
        component.kind === "third-party-mirror"
          ? component.indexDigest
          : `sha256:${((index + 1) % 16).toString(16).repeat(64)}`,
      platform: "linux/amd64",
      platformDigest,
      sourceRevision:
        component.sourceRevision === "release-source-commit"
          ? sourceCommit
          : component.sourceRevision === "release-source-lock"
            ? "resolved-source-lock"
            : component.sourceRevision,
      license: component.license,
      sbomSha256: sha256(sbomBytes),
      provenanceSha256: sha256(provenanceBytes),
      ...(/(?:AGPL|GPL)/.test(component.license)
        ? {
            correspondingSourceSha256: sha256(
              readFileSync(
                component.id === "grafana-private"
                  ? grafanaSourcePacket
                  : firecrawlSourcePacket,
              ),
            ),
          }
        : {}),
    }
  })
  const coreLock = {
    schema: "llm-machines.core-image-lock.v1",
    status: "LOCKED",
    release: { version: "1.0.0-rc.1", sourceCommit, sourceTree },
    inventorySha256: coreInventorySha256(root),
    platform: "linux/amd64",
    privateRegistry: "registry.release.invalid",
    images,
  }
  const coreLockPath = join(directory, "core-image-lock.json")
  write(coreLockPath, `${canonicalJson(coreLock)}\n`)
  const vulnerabilityPath = join(directory, "firecrawl-vulnerability.json")
  write(
    vulnerabilityPath,
    `${canonicalJson({
      schema: "llm-machines.firecrawl-vulnerability-disposition.v1",
      status: "REVIEWED",
      containsCredentials: false,
      runtimeQualified: false,
      scanner: "fixture-scanner-1.0",
      databaseUpdatedAt: "2026-08-04T00:00:00.000Z",
      blockingFindings: [],
      images: images
        .filter(({ id }) => id.startsWith("firecrawl-"))
        .map(({ id, platformDigest }) => ({
          id,
          imageDigest: platformDigest,
          decision: "ACCEPTED",
        })),
    })}\n`,
  )
  return {
    coreLockPath,
    correspondingSourceRoot,
    directory,
    evidenceRoot,
    firecrawlVulnerabilityPath: vulnerabilityPath,
    outputRoot,
  }
}

test("release evidence is deterministic and covers every locked image", () => {
  const first = fixture()
  const second = fixture()
  const firstResult = generateReleaseEvidence(first, { root })
  const secondResult = generateReleaseEvidence(second, { root })
  assert.deepEqual(firstResult, secondResult)
  assert.equal(firstResult.outputs.length, 9)
  for (const path of firstResult.outputs) {
    assert.deepEqual(
      readFileSync(join(first.outputRoot, path)),
      readFileSync(join(second.outputRoot, path)),
      path,
    )
  }
  const bom = JSON.parse(
    readFileSync(join(first.outputRoot, "bom/product-bom.cdx.json"), "utf8"),
  )
  assert.equal(
    bom.components.length,
    readCoreImageInventory(root).components.length,
  )
  assert.equal(bom.metadata.component.properties[2].value, "false")
})

test("mismatched SBOM, vulnerability result, or corresponding source fails", () => {
  const sbomFixture = fixture()
  write(join(sbomFixture.evidenceRoot, "sbom/product-edge.cdx.json"), "{}\n")
  assert.throws(
    () => generateReleaseEvidence(sbomFixture, { root }),
    /SBOM digest differs/,
  )

  const vulnerabilityFixture = fixture()
  const disposition = JSON.parse(
    readFileSync(vulnerabilityFixture.firecrawlVulnerabilityPath, "utf8"),
  )
  disposition.blockingFindings.push("CVE-fixture")
  write(
    vulnerabilityFixture.firecrawlVulnerabilityPath,
    `${canonicalJson(disposition)}\n`,
  )
  assert.throws(
    () => generateReleaseEvidence(vulnerabilityFixture, { root }),
    /not release-admissible/,
  )

  const sourceFixture = fixture()
  write(
    join(
      sourceFixture.correspondingSourceRoot,
      "grafana-corresponding-source.tar.zst",
    ),
    "different source packet\n",
  )
  assert.throws(
    () => generateReleaseEvidence(sourceFixture, { root }),
    /grafana-corresponding-source packet differs/,
  )
})

test("incomplete SLSA provenance fails", () => {
  const value = fixture()
  const path = join(value.evidenceRoot, "provenance/product-edge.intoto.json")
  const provenance = JSON.parse(readFileSync(path, "utf8"))
  provenance.predicate = {}
  write(path, `${canonicalJson(provenance)}\n`)
  const lock = JSON.parse(readFileSync(value.coreLockPath, "utf8"))
  lock.images.find(({ id }) => id === "product-edge").provenanceSha256 = sha256(
    readFileSync(path),
  )
  write(value.coreLockPath, `${canonicalJson(lock)}\n`)
  assert.throws(
    () => generateReleaseEvidence(value, { root }),
    /provenance for product-edge does not bind/,
  )
})

test("output files are create-only", () => {
  const value = fixture()
  generateReleaseEvidence(value, { root })
  assert.throws(() => generateReleaseEvidence(value, { root }), /EEXIST/)
})
