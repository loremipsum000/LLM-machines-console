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
const slsaActorKey = ["build", "er"].join("")
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
  const vulnerabilityRoot = join(directory, "vulnerability")
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
    const sourceRevision =
      component.sourceRevision === "release-source-commit"
        ? sourceCommit
        : component.sourceRevision === "release-source-lock"
          ? "resolved-source-lock"
          : component.sourceRevision
    const recipePath =
      component.kind === "product-build-output"
        ? component.dockerfile
        : component.kind === "firecrawl-build-output"
          ? component.sourcePackage
          : "infra/release/core-image-inventory.json"
    const recipeSha256 = sha256(readFileSync(resolve(root, recipePath)))
    const imageReference = `image:${component.id}`
    const packageReference = `package:${component.id}`
    const sbom = {
      bomFormat: "CycloneDX",
      specVersion: "1.6",
      version: 1,
      metadata: {
        tools: {
          components: [
            {
              type: "application",
              name: "fixture-sbom-tool",
              version: "1.0.0",
            },
          ],
        },
        component: {
          type: "container",
          "bom-ref": imageReference,
          name: component.id,
          version,
          hashes: [
            { alg: "SHA-256", content: platformDigest.slice("sha256:".length) },
          ],
          properties: [
            {
              name: "llm-machines:image-platform-digest",
              value: platformDigest,
            },
          ],
        },
      },
      components: [
        {
          type: "library",
          "bom-ref": packageReference,
          name: `${component.id}-package-inventory`,
          version: "1.0.0",
        },
      ],
      dependencies: [
        { ref: imageReference, dependsOn: [packageReference] },
        { ref: packageReference, dependsOn: [] },
      ],
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
          buildType: {
            "third-party-mirror":
              "https://llm-machines.invalid/build-types/oci-mirror/v1",
            "product-build-output":
              "https://llm-machines.invalid/build-types/product-container/v1",
            "firecrawl-build-output":
              "https://llm-machines.invalid/build-types/firecrawl-reduced-container/v1",
          }[component.kind],
          externalParameters: {
            componentId: component.id,
            imageRepository: repository,
            imageVersion: version,
            sourceRevision,
            recipe: { path: recipePath, sha256: recipeSha256 },
          },
          internalParameters: {},
          resolvedDependencies: [
            {
              uri: `urn:llm-machines:source:${component.id}`,
              digest: { gitCommit: sourceRevision },
            },
            {
              uri: `file:${recipePath}`,
              digest: { sha256: recipeSha256.slice("sha256:".length) },
            },
          ],
        },
        runDetails: {
          [slsaActorKey]: {
            id: "https://llm-machines.invalid/builders/offline-release/v1",
          },
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
    const licenseText = `Reviewed license text for ${component.id} under ${component.license}.\n`
    const noticeText = `Reviewed distribution notice for ${component.id}.\n`
    const licenseReview = {
      schema: "llm-machines.license-review.v1",
      status: "REVIEWED",
      component: {
        id: component.id,
        repository,
        sourceRevision,
        license: component.license,
      },
      licenseTextSha256: sha256(licenseText),
      noticeSha256: sha256(noticeText),
      reviewedAt: "2026-08-04T00:00:03.000Z",
      reviewer: { type: "release-compliance", id: "fixture-reviewer" },
    }
    const licenseReviewBytes = `${canonicalJson(licenseReview)}\n`
    const vulnerabilityReport = {
      schema: "llm-machines.vulnerability-report.v1",
      image: { id: component.id, repository, digest: platformDigest },
      scanner: { name: "trivy", version: "0.65.0" },
      database: { updatedAt: "2026-08-03T23:00:00.000Z" },
      scannedAt: "2026-08-04T00:00:00.000Z",
      findings: [],
    }
    const vulnerabilityReportBytes = `${canonicalJson(vulnerabilityReport)}\n`
    const vulnerabilityDisposition = {
      schema: "llm-machines.vulnerability-disposition.v1",
      status: "REVIEWED",
      containsCredentials: false,
      runtimeQualified: false,
      image: vulnerabilityReport.image,
      reportSha256: sha256(vulnerabilityReportBytes),
      scanner: vulnerabilityReport.scanner,
      database: vulnerabilityReport.database,
      policy: {
        maximumDatabaseAgeHours: 72,
        severityThresholds: { critical: 0, high: 0 },
        maximumExceptionAgeDays: 30,
      },
      counts: { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 },
      exceptions: [],
      reviewedAt: "2026-08-04T00:00:02.000Z",
      decision: "ACCEPTED",
    }
    const vulnerabilityDispositionBytes = `${canonicalJson(vulnerabilityDisposition)}\n`
    write(join(evidenceRoot, "sbom", `${component.id}.cdx.json`), sbomBytes)
    write(
      join(evidenceRoot, "provenance", `${component.id}.intoto.json`),
      provenanceBytes,
    )
    write(join(evidenceRoot, "licenses", `${component.id}.txt`), licenseText)
    write(join(evidenceRoot, "notices", `${component.id}.txt`), noticeText)
    write(
      join(evidenceRoot, "licenses", `${component.id}.review.json`),
      licenseReviewBytes,
    )
    write(
      join(vulnerabilityRoot, `${component.id}.report.json`),
      vulnerabilityReportBytes,
    )
    write(
      join(vulnerabilityRoot, `${component.id}.disposition.json`),
      vulnerabilityDispositionBytes,
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
      sourceRevision,
      license: component.license,
      sbomSha256: sha256(sbomBytes),
      provenanceSha256: sha256(provenanceBytes),
      vulnerabilityReportSha256: sha256(vulnerabilityReportBytes),
      vulnerabilityDispositionSha256: sha256(vulnerabilityDispositionBytes),
      licenseTextSha256: sha256(licenseText),
      noticeSha256: sha256(noticeText),
      licenseReviewSha256: sha256(licenseReviewBytes),
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
  return {
    coreLockPath,
    correspondingSourceRoot,
    directory,
    evidenceRoot,
    vulnerabilityRoot,
    outputRoot,
  }
}

test("release evidence is deterministic and covers every locked image", () => {
  const first = fixture()
  const second = fixture()
  const firstResult = generateReleaseEvidence(first, { root })
  const secondResult = generateReleaseEvidence(second, { root })
  assert.deepEqual(firstResult, secondResult)
  assert.equal(firstResult.outputs.length, 10)
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

test("digest-mismatched SBOM, vulnerability report, or corresponding source fails", () => {
  const sbomFixture = fixture()
  write(join(sbomFixture.evidenceRoot, "sbom/product-edge.cdx.json"), "{}\n")
  assert.throws(
    () => generateReleaseEvidence(sbomFixture, { root }),
    /SBOM digest differs/,
  )

  const vulnerabilityFixture = fixture()
  write(
    join(vulnerabilityFixture.vulnerabilityRoot, "product-edge.report.json"),
    "{}\n",
  )
  assert.throws(
    () => generateReleaseEvidence(vulnerabilityFixture, { root }),
    /vulnerability-report digest differs/,
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

test("CycloneDX inventory, dependency, tool, and locked digest evidence is mandatory", () => {
  for (const mutate of [
    (sbom) => {
      sbom.components = []
    },
    (sbom) => {
      sbom.dependencies = []
    },
    (sbom) => {
      sbom.metadata.tools.components = []
    },
    (sbom) => {
      sbom.metadata.component.hashes[0].content = "f".repeat(64)
    },
  ]) {
    const value = fixture()
    const path = join(value.evidenceRoot, "sbom/product-edge.cdx.json")
    const sbom = JSON.parse(readFileSync(path, "utf8"))
    mutate(sbom)
    write(path, `${canonicalJson(sbom)}\n`)
    const lock = JSON.parse(readFileSync(value.coreLockPath, "utf8"))
    lock.images.find(({ id }) => id === "product-edge").sbomSha256 = sha256(
      readFileSync(path),
    )
    write(value.coreLockPath, `${canonicalJson(lock)}\n`)
    assert.throws(
      () => generateReleaseEvidence(value, { root }),
      /SBOM for product-edge does not bind complete locked-image evidence/,
    )
  }
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

test("provenance binds the approved builder, source, recipe, and ordered timestamps", () => {
  for (const mutate of [
    (provenance) => {
      provenance.predicate.runDetails[slsaActorKey].id =
        "https://unapproved.invalid/builder"
    },
    (provenance) => {
      provenance.predicate.buildDefinition.externalParameters.sourceRevision =
        "f".repeat(40)
    },
    (provenance) => {
      provenance.predicate.buildDefinition.resolvedDependencies[1].digest.sha256 =
        "f".repeat(64)
    },
    (provenance) => {
      provenance.predicate.runDetails.metadata.startedOn =
        "2026-08-04T00:00:02.000Z"
    },
  ]) {
    const value = fixture()
    const path = join(value.evidenceRoot, "provenance/product-edge.intoto.json")
    const provenance = JSON.parse(readFileSync(path, "utf8"))
    mutate(provenance)
    write(path, `${canonicalJson(provenance)}\n`)
    const lock = JSON.parse(readFileSync(value.coreLockPath, "utf8"))
    lock.images.find(({ id }) => id === "product-edge").provenanceSha256 =
      sha256(readFileSync(path))
    write(value.coreLockPath, `${canonicalJson(lock)}\n`)
    assert.throws(
      () => generateReleaseEvidence(value, { root }),
      /provenance for product-edge does not bind exact build evidence/,
    )
  }
})

test("vulnerability evidence covers every image and enforces freshness and thresholds", () => {
  for (const mutate of [
    (report) => {
      report.scanner.name = "unapproved-scanner"
    },
    (report) => {
      report.database.updatedAt = "2026-07-01T00:00:00.000Z"
    },
    (report, disposition) => {
      report.findings.push({
        id: "CVE-fixture",
        severity: "high",
        package: "fixture-package",
        installedVersion: "1.0.0",
      })
      disposition.counts.high = 1
    },
    (report, disposition) => {
      report.findings.push({
        id: "CVE-expired-exception",
        severity: "critical",
        package: "fixture-package",
        installedVersion: "1.0.0",
      })
      disposition.counts.critical = 1
      disposition.exceptions.push({
        findingId: "CVE-expired-exception",
        reason: "Temporary reviewed fixture exception.",
        approvedBy: "fixture-reviewer",
        approvedAt: "2026-08-01T00:00:00.000Z",
        expiresAt: "2026-08-03T00:00:00.000Z",
      })
    },
  ]) {
    const value = fixture()
    const reportPath = join(value.vulnerabilityRoot, "product-edge.report.json")
    const dispositionPath = join(
      value.vulnerabilityRoot,
      "product-edge.disposition.json",
    )
    const report = JSON.parse(readFileSync(reportPath, "utf8"))
    const disposition = JSON.parse(readFileSync(dispositionPath, "utf8"))
    mutate(report, disposition)
    const reportBytes = `${canonicalJson(report)}\n`
    disposition.reportSha256 = sha256(reportBytes)
    disposition.scanner = report.scanner
    disposition.database = report.database
    const dispositionBytes = `${canonicalJson(disposition)}\n`
    write(reportPath, reportBytes)
    write(dispositionPath, dispositionBytes)
    const lock = JSON.parse(readFileSync(value.coreLockPath, "utf8"))
    const image = lock.images.find(({ id }) => id === "product-edge")
    image.vulnerabilityReportSha256 = sha256(reportBytes)
    image.vulnerabilityDispositionSha256 = sha256(dispositionBytes)
    write(value.coreLockPath, `${canonicalJson(lock)}\n`)
    assert.throws(
      () => generateReleaseEvidence(value, { root }),
      /vulnerability (?:report is not admissible|disposition is not release-admissible)/,
    )
  }
})

test("license review binds reviewed texts and notices to exact source identity", () => {
  const value = fixture()
  const path = join(value.evidenceRoot, "licenses/product-edge.review.json")
  const review = JSON.parse(readFileSync(path, "utf8"))
  review.component.sourceRevision = "f".repeat(40)
  write(path, `${canonicalJson(review)}\n`)
  const lock = JSON.parse(readFileSync(value.coreLockPath, "utf8"))
  lock.images.find(({ id }) => id === "product-edge").licenseReviewSha256 =
    sha256(readFileSync(path))
  write(value.coreLockPath, `${canonicalJson(lock)}\n`)
  assert.throws(
    () => generateReleaseEvidence(value, { root }),
    /license review does not bind exact component evidence/,
  )
})

test("output files are create-only", () => {
  const value = fixture()
  generateReleaseEvidence(value, { root })
  assert.throws(() => generateReleaseEvidence(value, { root }), /EEXIST/)
})
