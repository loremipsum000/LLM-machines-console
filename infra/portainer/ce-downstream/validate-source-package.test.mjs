import assert from "node:assert/strict"
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { test } from "node:test"

import {
  readSourcePackage,
  sha256File,
  validateSourcePackage,
} from "./validate-source-package.mjs"

const repositoryRoot = path.resolve(import.meta.dirname, "../../..")
const evaluatedAt = new Date("2026-08-22T20:00:00Z")
const downstreamRoot = "infra/portainer/ce-downstream"

function clone(value) {
  return structuredClone(value)
}

function createFixture() {
  const root = mkdtempSync(path.join(tmpdir(), "llmm-portainer-validator-"))
  cpSync(
    path.join(repositoryRoot, downstreamRoot),
    path.join(root, downstreamRoot),
    {
      recursive: true,
    },
  )
  return { root, manifest: clone(readSourcePackage()) }
}

function withFixture(callback) {
  const fixture = createFixture()
  try {
    callback(fixture)
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
}

function evidencePath(root, relative) {
  return path.join(root, downstreamRoot, relative)
}

function rewriteJson(root, manifest, field, relative, mutate) {
  const file = evidencePath(root, relative)
  const document = JSON.parse(readFileSync(file, "utf8"))
  mutate(document)
  writeFileSync(file, `${JSON.stringify(document, null, 2)}\n`)
  if (field) manifest.downstream.artifactEvidence[field] = sha256File(file)
}

function rewriteText(root, manifest, field, relative, transform) {
  const file = evidencePath(root, relative)
  writeFileSync(file, transform(readFileSync(file, "utf8")))
  manifest.downstream.artifactEvidence[field] = sha256File(file)
}

function errorsFor(root, manifest, now = evaluatedAt) {
  return validateSourcePackage(manifest, root, { now })
}

test("the exact generator-shaped Portainer evidence package passes", () => {
  withFixture(({ root, manifest }) => {
    assert.deepEqual(errorsFor(root, manifest), [])
  })
})

test("mutable, missing, and mismatched source or build identities fail", () => {
  const mutations = [
    (manifest) => {
      manifest.upstream.revision = ""
    },
    (manifest) => {
      manifest.upstream.officialImage.indexDigest = "2.39.6"
    },
    (manifest) => {
      manifest.downstream.buildInputs[0].version = "latest"
    },
    (manifest) => {
      manifest.downstream.buildInputs[1].sourceRevision = undefined
    },
    (manifest) => {
      manifest.downstream.buildToolchain.buildkit.platformDigest = `sha256:${"0".repeat(64)}`
    },
  ]
  for (const mutate of mutations) {
    withFixture(({ root, manifest }) => {
      mutate(manifest)
      assert.notDeepEqual(errorsFor(root, manifest), [])
    })
  }
})

test("patch, Dockerfile, license, notice, and license review drift fail", () => {
  for (const field of [
    "patch",
    "dockerfile",
    "dockerignore",
    "licenseCopy",
    "attributionsCopy",
    "notice",
    "licenseReview",
  ]) {
    withFixture(({ root, manifest }) => {
      writeFileSync(path.join(root, manifest.downstream[field].path), "drift\n")
      assert.ok(
        errorsFor(root, manifest).some((error) =>
          error.includes("locked SHA-256"),
        ),
        field,
      )
    })
  }
})

test("source inventory, module lock, and reachability disposition drift fail", () => {
  const mutations = [
    (manifest) => {
      manifest.downstream.sourceInventory.fileCount += 1
    },
    (manifest) => {
      manifest.downstream.sourceInventory.goModSha256 = "0".repeat(64)
    },
    (manifest) => {
      manifest.downstream.securityOverlay["moby/go-archive"] = "0.3.0"
    },
  ]
  for (const mutate of mutations) {
    withFixture(({ root, manifest }) => {
      mutate(manifest)
      assert.notDeepEqual(errorsFor(root, manifest), [])
    })
  }
})

test("PENDING, missing, and malformed artifact bindings fail closed", () => {
  withFixture(({ root, manifest }) => {
    manifest.downstream.artifactEvidence.indexDigest = "PENDING"
    manifest.downstream.artifactEvidence.evidenceInputIndexSha256 = "PENDING"
    assert.ok(
      errorsFor(root, manifest).some((error) => error.includes("PENDING")),
    )
  })
  withFixture(({ root, manifest }) => {
    rmSync(evidencePath(root, "evidence/govulncheck-source.jsonl"))
    assert.ok(
      errorsFor(root, manifest).some((error) =>
        error.includes("source govulncheck evidence is missing"),
      ),
    )
  })
  for (const mutate of [
    (evidence) => {
      evidence.layerDigests = []
    },
    (evidence) => {
      evidence.layerDigests.push(evidence.layerDigests[0])
    },
    (evidence) => {
      evidence.runtimeInventorySha256 = "bad"
    },
    (evidence) => {
      evidence.independentBuilds = 1
    },
  ]) {
    withFixture(({ root, manifest }) => {
      mutate(manifest.downstream.artifactEvidence)
      assert.notDeepEqual(errorsFor(root, manifest), [])
    })
  }
})

test("the evidence index rejects input, output, generator, and scan drift", () => {
  const mutations = [
    (index) => {
      index.inputs.rawTrivySha256 = "0".repeat(64)
    },
    (index) => {
      index.outputs.reverse()
    },
    (index) => {
      index.outputs.push({ path: "../unsafe", sha256: "0".repeat(64) })
    },
    (index) => {
      index.generatorSha256 = "0".repeat(64)
    },
    (index) => {
      index.scan.trivy.databaseUpdatedAt = "2026-08-01T00:00:00Z"
    },
  ]
  for (const mutate of mutations) {
    withFixture(({ root, manifest }) => {
      rewriteJson(
        root,
        manifest,
        "evidenceInputIndexSha256",
        "evidence/evidence-input-index.json",
        mutate,
      )
      assert.ok(
        errorsFor(root, manifest).some((error) =>
          /evidence input index|scan metadata/.test(error),
        ),
      )
    })
  }
})

test("SBOM and exact provenance dependency-set drift fail", () => {
  withFixture(({ root, manifest }) => {
    rewriteJson(
      root,
      manifest,
      "sbomSha256",
      "evidence/sbom.cdx.json",
      (sbom) => {
        sbom.metadata.component.properties.pop()
      },
    )
    assert.ok(
      errorsFor(root, manifest).some((error) =>
        error.includes("CycloneDX SBOM"),
      ),
    )
  })
  for (const mutate of [
    (dependencies) => dependencies.pop(),
    (dependencies) => dependencies.push(clone(dependencies[0])),
    (dependencies) => {
      dependencies[0].uri = "file:wrong"
    },
  ]) {
    withFixture(({ root, manifest }) => {
      rewriteJson(
        root,
        manifest,
        "provenanceSha256",
        "evidence/provenance.intoto.json",
        (provenance) =>
          mutate(provenance.predicate.buildDefinition.resolvedDependencies),
      )
      assert.ok(
        errorsFor(root, manifest).some((error) =>
          error.includes("SLSA provenance"),
        ),
      )
    })
  }
})

test("Trivy image, platform, raw report, database, and ordering drift fail", () => {
  for (const mutate of [
    (trivy) => {
      trivy.Metadata.ImageID = `sha256:${"0".repeat(64)}`
    },
    (trivy) => {
      trivy.Metadata.ImageConfig.architecture = "arm64"
    },
    (trivy) => {
      trivy.Metadata.RepoTags = ["portainer:latest"]
    },
    (trivy) => {
      trivy.Metadata.LLMMEvidence.rawReportSha256 = "0".repeat(64)
    },
    (trivy) => {
      trivy.Metadata.LLMMEvidence.database.sha256 = "0".repeat(64)
    },
    (trivy) => {
      trivy.Results[0].Vulnerabilities.reverse()
    },
  ]) {
    withFixture(({ root, manifest }) => {
      rewriteJson(
        root,
        manifest,
        "vulnerabilityReportSha256",
        "evidence/trivy.json",
        mutate,
      )
      assert.ok(
        errorsFor(root, manifest).some((error) =>
          error.includes("Trivy report"),
        ),
      )
    })
  }
})

test("reproducibility binds full A/B artifacts and distinct sealed receipts", () => {
  for (const mutate of [
    (document) => {
      document.assemblies[1].manifestDigest = `sha256:${"0".repeat(64)}`
    },
    (document) => {
      document.assemblies[1].sealedRecordSha256 =
        document.assemblies[0].sealedRecordSha256
    },
    (document) => {
      document.artifact.layers.push(clone(document.artifact.layers[0]))
    },
  ]) {
    withFixture(({ root, manifest }) => {
      rewriteJson(
        root,
        manifest,
        "reproducibilitySha256",
        "evidence/reproducibility.json",
        mutate,
      )
      assert.ok(
        errorsFor(root, manifest).some((error) =>
          error.includes("Assembly A and B"),
        ),
      )
    })
  }
})

test("govulncheck permits identical duplicate OSVs but rejects conflicts and mode drift", () => {
  withFixture(({ root, manifest }) => {
    const errors = errorsFor(root, manifest)
    assert.deepEqual(errors, [])
  })
  withFixture(({ root, manifest }) => {
    rewriteText(
      root,
      manifest,
      "sourceGovulncheckSha256",
      "evidence/govulncheck-source.jsonl",
      (input) => {
        const records = input.trimEnd().split("\n").map(JSON.parse)
        const duplicateId = records
          .filter((record) => record.osv)
          .map((record) => record.osv.id)
          .find((id, index, ids) => ids.indexOf(id) !== index)
        const duplicate = records.find(
          (record, index) =>
            record.osv?.id === duplicateId &&
            records.findIndex((entry) => entry.osv?.id === duplicateId) !==
              index,
        )
        duplicate.osv.summary = "conflicting duplicate"
        return `${records.map((record) => canonicalJson(record)).join("\n")}\n`
      },
    )
    assert.ok(
      errorsFor(root, manifest).some((error) =>
        error.includes("source govulncheck is not admissible"),
      ),
    )
  })
  withFixture(({ root, manifest }) => {
    rewriteText(
      root,
      manifest,
      "binaryGovulncheckSha256",
      "evidence/govulncheck-binary.jsonl",
      (input) => input.replace('"scan_mode":"binary"', '"scan_mode":"source"'),
    )
    assert.ok(
      errorsFor(root, manifest).some((error) =>
        error.includes("binary govulncheck is not admissible"),
      ),
    )
  })
})

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

function partitionHistoricalRemediations(matrix) {
  const currentRemediations = matrix.findings.filter(
    (finding) => finding.disposition.status === "REMEDIATED_DOWNSTREAM",
  )
  matrix.historicalRemediations =
    matrix.historicalRemediations ?? currentRemediations
  matrix.findings = matrix.findings.filter(
    (finding) => finding.disposition.status !== "REMEDIATED_DOWNSTREAM",
  )
}

test("current findings and historical downstream remediations remain distinct", () => {
  withFixture(({ root, manifest }) => {
    rewriteJson(
      root,
      manifest,
      "securityFindingMatrixSha256",
      "security-finding-matrix.json",
      partitionHistoricalRemediations,
    )
    const errors = errorsFor(root, manifest)
    assert.ok(!errors.some((error) => error.includes("historical remediation")))
  })
  withFixture(({ root, manifest }) => {
    rewriteJson(
      root,
      manifest,
      "securityFindingMatrixSha256",
      "security-finding-matrix.json",
      (matrix) => {
        partitionHistoricalRemediations(matrix)
        matrix.historicalRemediations.pop()
      },
    )
    assert.ok(
      errorsFor(root, manifest).includes(
        "historical downstream remediation set differs",
      ),
    )
  })
  withFixture(({ root, manifest }) => {
    rewriteJson(
      root,
      manifest,
      "securityFindingMatrixSha256",
      "security-finding-matrix.json",
      (matrix) => {
        partitionHistoricalRemediations(matrix)
        matrix.findings.push(clone(matrix.historicalRemediations[0]))
      },
    )
    const errors = errorsFor(root, manifest)
    assert.ok(
      errors.some((error) =>
        error.includes("security finding has an inadmissible disposition"),
      ),
    )
    assert.ok(
      errors.some((error) =>
        error.includes("historical remediation identity is duplicated"),
      ),
    )
  })
  withFixture(({ root, manifest }) => {
    rewriteJson(
      root,
      manifest,
      "securityFindingMatrixSha256",
      "security-finding-matrix.json",
      (matrix) => {
        partitionHistoricalRemediations(matrix)
        matrix.historicalRemediations[0].advisory.aliases = ["GO-2099-9999"]
      },
    )
    const errors = errorsFor(root, manifest)
    assert.ok(
      errors.some((error) =>
        error.includes("historical remediation lacks exact evidence"),
      ),
    )
    assert.ok(errors.includes("historical downstream remediation set differs"))
  })
  withFixture(({ root, manifest }) => {
    rewriteJson(
      root,
      manifest,
      "securityFindingMatrixSha256",
      "security-finding-matrix.json",
      (matrix) => {
        partitionHistoricalRemediations(matrix)
        matrix.historicalRemediations[0].evidence.callPath =
          "Unreviewed replacement claim."
      },
    )
    assert.ok(
      errorsFor(root, manifest).includes(
        "historical downstream remediation evidence differs",
      ),
    )
  })
})

test("one advisory may bind multiple exact scanner observations", () => {
  withFixture(({ root, manifest }) => {
    rewriteJson(
      root,
      manifest,
      "securityFindingMatrixSha256",
      "security-finding-matrix.json",
      (matrix) => {
        const yamlObservations = matrix.findings.filter(
          (finding) =>
            finding.advisory.id === "CVE-2026-33532" &&
            finding.component.name === "yaml",
        )
        assert.deepEqual(
          yamlObservations.map((finding) => finding.component.installed).sort(),
          ["1.10.2", "2.7.0"],
        )
        matrix.findings = matrix.findings.filter(
          (finding) =>
            finding.advisory.id !== "CVE-2026-33532" ||
            finding.component.installed !== "1.10.2",
        )
      },
    )
    assert.ok(
      errorsFor(root, manifest).some((error) =>
        error.includes(
          "Frontend Trivy finding is missing or mismatched in matrix: CVE-2026-33532",
        ),
      ),
    )
  })
})

test("matrix OSV coverage, disposition, and time-bound expiry fail closed", () => {
  withFixture(({ root, manifest }) => {
    const sourceFindingId = readFileSync(
      evidencePath(root, "evidence/govulncheck-source.jsonl"),
      "utf8",
    )
      .trimEnd()
      .split("\n")
      .map(JSON.parse)
      .find((record) => record.finding)?.finding?.osv
    rewriteJson(
      root,
      manifest,
      "securityFindingMatrixSha256",
      "security-finding-matrix.json",
      (matrix) => {
        matrix.findings = matrix.findings.filter(
          (finding) =>
            finding.advisory.id !== sourceFindingId &&
            !finding.advisory.aliases.includes(sourceFindingId),
        )
      },
    )
    assert.ok(
      errorsFor(root, manifest).some((error) => error.includes("govulncheck")),
    )
  })
  withFixture(({ root, manifest }) => {
    assert.deepEqual(
      errorsFor(root, manifest, new Date("2026-09-01T00:00:00Z")),
      [],
    )
    assert.ok(
      errorsFor(root, manifest, new Date("2026-09-23T00:00:00Z")).some(
        (error) => error.includes("time-bound security finding is expired"),
      ),
    )
  })
})

test("evidence producers, activation conditions, and matrix dispositions fail closed", () => {
  withFixture(({ root, manifest }) => {
    manifest.downstream.evidenceTooling.assemblySealer.sha256 = "0".repeat(64)
    assert.ok(
      errorsFor(root, manifest).some((error) =>
        error.includes(
          "assembly evidence sealer differs from its locked SHA-256",
        ),
      ),
    )
  })
  withFixture(({ root, manifest }) => {
    manifest.activationPreconditions.dockerEngine = ">=29.6.0"
    assert.ok(
      errorsFor(root, manifest).some((error) =>
        error.includes("activation preconditions differ"),
      ),
    )
  })
  withFixture(({ root, manifest }) => {
    rewriteJson(
      root,
      manifest,
      "securityFindingMatrixSha256",
      "security-finding-matrix.json",
      (matrix) => {
        matrix.admissionGate.activationBlockers = ["arbitrary blocker"]
      },
    )
    assert.ok(
      errorsFor(root, manifest).some((error) =>
        error.includes("security finding matrix is not evidence-bound"),
      ),
    )
  })
  withFixture(({ root, manifest }) => {
    rewriteJson(
      root,
      manifest,
      "securityFindingMatrixSha256",
      "security-finding-matrix.json",
      (matrix) => {
        const finding = matrix.findings.find(
          (entry) =>
            entry.disposition.status ===
            "EXTERNAL_RUNTIME_ACTIVATION_PRECONDITION",
        )
        finding.evidence.class = "NOT_REACHABLE_SERVER_PATH"
      },
    )
    assert.ok(
      errorsFor(root, manifest).some((error) =>
        error.includes("disposition lacks exact evidence"),
      ),
    )
  })
})

test("Dockerfile misconfiguration evidence and R2 activation dispositions fail closed", () => {
  withFixture(({ root, manifest }) => {
    rmSync(evidencePath(root, "evidence/trivy-misconfiguration.json"))
    assert.ok(
      errorsFor(root, manifest).some((error) =>
        error.includes(
          "Dockerfile misconfiguration report evidence is missing",
        ),
      ),
    )
  })
  withFixture(({ root, manifest }) => {
    const {
      misconfigurationReportSha256: _omitted,
      ...artifactEvidenceWithoutMisconfiguration
    } = manifest.downstream.artifactEvidence
    manifest.downstream.artifactEvidence =
      artifactEvidenceWithoutMisconfiguration
    assert.ok(
      errorsFor(root, manifest).some((error) =>
        error.includes("artifact evidence is PENDING, incomplete"),
      ),
    )
  })
  for (const mutate of [
    (report) => {
      report.Results[0].Misconfigurations[0].Title = "weakened"
    },
    (report) => {
      report.Results[0].Misconfigurations.pop()
      report.Results[0].MisconfSummary.Failures = 1
    },
    (report) => {
      report.Results[0].Misconfigurations.reverse()
    },
  ]) {
    withFixture(({ root, manifest }) => {
      rewriteJson(
        root,
        manifest,
        "misconfigurationReportSha256",
        "evidence/trivy-misconfiguration.json",
        mutate,
      )
      assert.ok(
        errorsFor(root, manifest).some((error) =>
          error.includes("Dockerfile misconfiguration evidence"),
        ),
      )
    })
  }
  for (const mutate of [
    (matrix) => {
      matrix.evidence.misconfiguration.target.sha256 = "0".repeat(64)
    },
    (matrix) => {
      matrix.evidence.misconfiguration.artifact.configuredUser = "65532"
      matrix.evidence.misconfiguration.artifact.effectiveUser = "65532"
    },
    (matrix) => {
      matrix.evidence.misconfiguration.artifact.healthcheckPresent = true
    },
    (matrix) => {
      matrix.misconfigurationFindings.pop()
    },
    (matrix) => {
      matrix.misconfigurationFindings[0].disposition.status = "RESOLVED"
    },
    (matrix) => {
      matrix.admissionGate.runtimeConfigurationHighActivationPreconditions = 0
    },
    (matrix) => {
      matrix.admissionGate.activationBlockers.pop()
    },
    (matrix) => {
      matrix.findings.push({
        advisory: { id: "DS-0002", aliases: [] },
      })
    },
  ]) {
    withFixture(({ root, manifest }) => {
      rewriteJson(
        root,
        manifest,
        "securityFindingMatrixSha256",
        "security-finding-matrix.json",
        mutate,
      )
      assert.ok(
        errorsFor(root, manifest).some((error) =>
          /misconfiguration|security finding matrix|Dockerfile/.test(error),
        ),
      )
    })
  }
})

test("frontend runtime and artifact license completeness fail closed", () => {
  withFixture(({ root, manifest }) => {
    rewriteJson(
      root,
      manifest,
      "frontendRuntimeBindingSha256",
      "evidence/frontend-runtime-binding.json",
      (binding) => {
        binding.runtime.sourceMaps[0].sha256 = "0".repeat(64)
      },
    )
    assert.ok(
      errorsFor(root, manifest).some((error) =>
        error.includes("frontend runtime evidence"),
      ),
    )
  })
  withFixture(({ root, manifest }) => {
    rewriteJson(
      root,
      manifest,
      "artifactLicenseEvidenceSha256",
      "evidence/artifact-license-evidence.json",
      (evidence) => {
        evidence.artifactLicenseEvidenceComplete = false
        evidence.coverage.complete = false
      },
    )
    assert.ok(
      errorsFor(root, manifest).some((error) =>
        error.includes("artifact license evidence does not completely cover"),
      ),
    )
  })
})

test("reachability wrapper evidence is bound by the sealed environment receipt", () => {
  withFixture(({ root, manifest }) => {
    rewriteJson(
      root,
      manifest,
      null,
      "evidence/assemblies/a/build-environment-receipt.json",
      (receipt) => {
        receipt.evidence.reachabilityRunStdout.sha256 = "0".repeat(64)
      },
    )
    assert.ok(
      errorsFor(root, manifest).some((error) =>
        /receipt hash differs|reachability receipt is inadmissible/.test(error),
      ),
    )
  })
})

test("sealed records and build receipts bind identity, success, and A/B isolation", () => {
  withFixture(({ root, manifest }) => {
    rewriteJson(
      root,
      manifest,
      null,
      "evidence/assemblies/a/build-log-receipt.json",
      (receipt) => {
        receipt.exitStatus = 1
      },
    )
    assert.ok(
      errorsFor(root, manifest).some((error) =>
        /receipt hash differs|build-log receipt is inadmissible/.test(error),
      ),
    )
  })
  withFixture(({ root, manifest }) => {
    rewriteJson(
      root,
      manifest,
      null,
      "evidence/assemblies/b/build-environment-receipt.json",
      (receipt) => {
        receipt.independence.sourceRoot =
          "/var/tmp/llmm-portainer-n4r1-a/source"
      },
    )
    assert.ok(
      errorsFor(root, manifest).some((error) =>
        /receipt hash differs|build-environment receipt is inadmissible/.test(
          error,
        ),
      ),
    )
  })
  withFixture(({ root, manifest }) => {
    const file = evidencePath(root, "evidence/assemblies/a/sealed-record.json")
    writeFileSync(file, `${readFileSync(file, "utf8")}\n`)
    assert.ok(
      errorsFor(root, manifest).some((error) =>
        error.includes("sealed record is not evidence-bound"),
      ),
    )
  })
})

test("Enterprise, trial, and commercial-license material fail", () => {
  withFixture(({ root, manifest }) => {
    rewriteJson(
      root,
      manifest,
      "sbomSha256",
      "evidence/sbom.cdx.json",
      (sbom) => {
        sbom.components[0].name = "portainer-ee"
      },
    )
    assert.ok(
      errorsFor(root, manifest).some((error) =>
        /Enterprise|commercial/.test(error),
      ),
    )
  })
  withFixture(({ root, manifest }) => {
    const file = path.join(root, manifest.downstream.licenseReview.path)
    const review = JSON.parse(readFileSync(file, "utf8"))
    review.commercialMaterialReview.trialMaterialPresent = true
    writeFileSync(file, `${JSON.stringify(review, null, 2)}\n`)
    manifest.downstream.licenseReview.sha256 = sha256File(file)
    assert.ok(
      errorsFor(root, manifest).some((error) =>
        error.includes("commercial-material"),
      ),
    )
  })
})
