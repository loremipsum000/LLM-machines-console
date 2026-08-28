import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import { validateReachability } from "../../infra/portainer/ce-downstream/validate-reachability.mjs"
import {
  buildForbiddenAllowlist,
  f0N4R1ReviewedNegativeFindings,
} from "./guardrails.mjs"

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const protectedInput = "7bed599067323429c30ee1d073b9ca22d4c9f867"
const protectedTree = "3881b27d3425f5cc6bd0f97e2e1b2022c0d0f9e2"
const admittedCandidate = "66de912ce7265690fc1084f83b22ab76687ca449"
const historicalDeferralPath =
  "docs/reduction/inference-core/f0-n4-portainer-upstream-security-deferral.json"
const historicalDeferralBlob = "7826a8a3c4044706a3899103fe9d18fc5d002db7"
const historicalDeferralSha256 =
  "5d8f60a80fc63b984ecc285e9cbb093bbad9c12538213279c1bc41ec85f30cbd"
const packageRoot = "infra/portainer/ce-downstream"

const unchangedProductSurfaces = [
  ".env.example",
  "README.md",
  "apps/web/src/components/technical-tools-panel.tsx",
  "apps/web/src/lib/admin/technical-tools.ts",
  "infra/deployment/validate-vm103-deployment-contract.mjs",
  "infra/deployment/vm103-deployment-contract.json",
  "infra/ingress/native-admin-edge-profile.json",
  "infra/ingress/product-edge.nginx.conf.template",
  "infra/ingress/validate-ingress.mjs",
  "infra/release/core-image-build-contract.json",
  "infra/release/core-image-inventory.json",
  "infra/release/release-plan.json",
  "infra/release/validate-image-lock.mjs",
  "infra/storage/profile.json",
  "scripts/pre-genesis/founder-uat-placement.mjs",
  "scripts/pre-genesis/reduced-core-integrated.mjs",
  "scripts/pre-genesis/reduced-core-uat.mjs",
]

test("F0-N4R1 preserves the historical Portainer deferral byte-for-byte", () => {
  assert.equal(git("rev-parse", `${protectedInput}^{tree}`), protectedTree)

  const current = read(historicalDeferralPath)
  const protectedBytes = gitBuffer(
    "show",
    `${protectedInput}:${historicalDeferralPath}`,
  )
  assert.deepEqual(current, protectedBytes)
  assert.equal(sha256(current), historicalDeferralSha256)
  assert.equal(
    git("hash-object", historicalDeferralPath),
    historicalDeferralBlob,
  )
  assert.equal(
    git("rev-parse", `${protectedInput}:${historicalDeferralPath}`),
    historicalDeferralBlob,
  )
})

test("F0-N4R1 remains security characterization without Product admission", () => {
  const manifest = readJson(`${packageRoot}/source-package.json`)
  const governance = readJson(
    "docs/reduction/inference-core/f0-n4r1-portainer-security-admission.json",
  )

  assert.deepEqual(governance.protectedInput, {
    branch: "codex/inference-core-stack-reduction",
    commit: protectedInput,
    tree: protectedTree,
  })
  assert.equal(
    sha256(read(`${packageRoot}/source-package.json`)),
    "517d91c68259f29e6fa75df35e9a6f5869c452aea8fbd70e78a8da0cfd674429",
  )
  assert.equal(
    governance.selectedIdentity.sourcePackageSha256,
    "517d91c68259f29e6fa75df35e9a6f5869c452aea8fbd70e78a8da0cfd674429",
  )
  assert.equal(governance.status, manifest.status)
  assert.equal(governance.accepted, false)
  assert.equal(governance.runtimeQualified, false)
  assert.equal(governance.contractActivation, "INACTIVE")
  assert.equal(governance.securityDisposition.activationAllowed, false)
  assert.deepEqual(
    governance.freshEvidence.vulnerability.dockerfileMisconfiguration.counts,
    { critical: 0, high: 1, medium: 0, low: 1, unknown: 0 },
  )
  assert.deepEqual(
    governance.freshEvidence.vulnerability.dockerfileMisconfiguration
      .dispositions,
    {
      "DS-0002": "R2_LEAST_PRIVILEGE_STARTUP_ACTIVATION_PRECONDITION",
      "DS-0026": "R2_HEALTH_CONTRACT_ACTIVATION_PRECONDITION",
    },
  )
  assert.equal(
    governance.freshEvidence.vulnerability.dockerfileMisconfiguration
      .aggregateEvidenceRelationship,
    "POST_BUILD_STATIC_SOURCE_REVIEW_BOUND_BY_SOURCE_PACKAGE_MATRIX_AND_GOVERNANCE_NOT_A_FINAL5_AGGREGATE_INPUT_OR_BYPRODUCT",
  )
  assert.equal(
    governance.freshEvidence.vulnerability.dockerfileMisconfiguration
      .reportSha256,
    manifest.downstream.artifactEvidence.misconfigurationReportSha256,
  )
  assert.equal(governance.currentProductBoundary.portainerCoreAdmitted, false)
  assert.equal(governance.currentProductBoundary.portainerDeployed, false)
  assert.equal(
    governance.currentProductBoundary.portainerInCurrentCoreBom,
    false,
  )
  assert.equal(
    governance.currentProductBoundary.portainerInCurrentImmutableImageLock,
    false,
  )

  assert.equal(
    manifest.schema,
    "llm-machines.portainer-ce-downstream-source.v1",
  )
  assert.equal(
    manifest.status,
    "SOURCE_SECURITY_CHARACTERIZED_NOT_CORE_ADMITTED",
  )
  assert.equal(manifest.accepted, false)
  assert.equal(manifest.runtimeQualified, false)
  assert.equal(manifest.contractActivation, "INACTIVE")
  assert.equal(manifest.containsCredentials, false)
  assert.equal(manifest.productIntegrated, false)
  assert.deepEqual(manifest.admissionBoundary, {
    advertised: false,
    consoleChanged: false,
    coreBomChanged: false,
    deployed: false,
    imageLockChanged: false,
    ingressChanged: false,
    packaged: false,
    startupChanged: false,
  })
  assert.equal(manifest.upstream.version, "2.39.6")
  assert.equal(
    manifest.upstream.revision,
    "723d1a2268f0fefe70d57f5981ce15d5d1ffc679",
  )
  assert.equal(manifest.upstream.license, "Zlib")
  assert.match(
    manifest.upstream.officialImage.provenanceDisposition,
    /^NOT_ADMITTED_/,
  )
  assert.equal(manifest.downstream.version, "2.39.6-llmm.1")
  assert.equal(manifest.downstream.platform, "linux/amd64")
  assert.equal(manifest.downstream.alteredSourceMarked, true)
  assert.deepEqual(manifest.downstream.artifactEvidence, {
    artifactLicenseEvidenceSha256:
      "472a593f26b064f80b582a6079238a0019b2765c8e7392d165637e2f1c6c059c",
    binaryGovulncheckSha256:
      "aee6ee58edfeab2a5625a7532dcb870d43b3feb13fd2d018b39eeab89aec2765",
    byteIdentical: true,
    configDigest:
      "sha256:45f3a24c1cdf26f9e372d458afd7309f3b270a2aeaeae6ac0eb3d809e742bf7a",
    evidenceInputIndexSha256:
      "a0fbe1e3c34a760257ff5599e5aa0ccaf37249b0686221904c3fff193272d6b5",
    frontendRuntimeBindingSha256:
      "e14674235baa8c730be9546b06c7e557d361c8d900c406cb9c0a5543076f9afe",
    frontendSbomSha256:
      "87b092fd51b9281fcb3b65bdb7cc8fda1051fc8df52ed808a2366c664066dfe0",
    frontendVulnerabilityReportSha256:
      "bf685aff659d04bf40ea79f619ebd55660dd97db40a80eb11e918f414056a535",
    independentBuilds: 2,
    indexDigest:
      "sha256:e25feb8fd95e9a0ce7cadb3b1d141317b82eefc7a9f91b8deba26ef6508b53b0",
    layerDigests: [
      "sha256:08e9494a6bc8d17b4ba4a1b57ffa658cb8f341c76f448b146b2139758469d74c",
    ],
    manifestDigest:
      "sha256:f945186dd7943b83b1f39fed23898161b66ccb0d9943e50b272a03edf1797e20",
    misconfigurationReportSha256:
      "90e4e44296b14e4ca651e931c3c687a318042f0120511e4b20fb43a9ba83e073",
    ociArchiveBytes: 41355218,
    ociArchiveSha256:
      "0dd846c806f74032244edc3e2eaed781717bb9feb590eea247c6ae05d00013eb",
    provenanceSha256:
      "87fa6449c57e7e7e89f8c3bd8748249032137eaca66c5694504aab9e4d3abbd9",
    reproducibilitySha256:
      "4ff901c8290961e57cae1100ec0ae78ebfdcd2fd94a8f6f2f9ddfba0249fad91",
    runtimeInventorySha256:
      "4b391363453d675d743cafe7993adc266c28bdcc6f1fe888f08ed0151ac01181",
    sbomSha256:
      "b2ee2af94d2a668267ebef0dadcb205f0490ff2038687b26c950afad1fc88a9a",
    securityFindingMatrixSha256:
      "6e6d149c11e5bd0b2b3ecf47709f70d5a6adeec30f176caffe5025df07709b2e",
    sourceGovulncheckSha256:
      "6cbe5f6770920396335845af1be1190231b51ed8817e2820067153e7e0da9922",
    vulnerabilityReportSha256:
      "99e9ac6cad91e584f7c136a131914ab49911ea9215b0838198e877471fe45399",
  })
  assert.deepEqual(governance.selectedIdentity.downstreamArtifact, {
    admittedToCoreImageLock: false,
    byteIdentical: manifest.downstream.artifactEvidence.byteIdentical,
    configDigest: manifest.downstream.artifactEvidence.configDigest,
    independentBuilds: manifest.downstream.artifactEvidence.independentBuilds,
    indexDigest: manifest.downstream.artifactEvidence.indexDigest,
    layerDigests: manifest.downstream.artifactEvidence.layerDigests,
    linuxAmd64ManifestDigest:
      manifest.downstream.artifactEvidence.manifestDigest,
    ociArchiveBytes: manifest.downstream.artifactEvidence.ociArchiveBytes,
    ociArchiveSha256: manifest.downstream.artifactEvidence.ociArchiveSha256,
    runtimeInventorySha256:
      manifest.downstream.artifactEvidence.runtimeInventorySha256,
  })

  const matrix = readJson(`${packageRoot}/security-finding-matrix.json`)
  const artifactLicenseEvidence = readJson(
    `${packageRoot}/evidence/artifact-license-evidence.json`,
  )
  assert.equal(matrix.findings.length, 38)
  assert.equal(matrix.misconfigurationFindings.length, 2)
  assert.equal(matrix.historicalRemediations.length, 9)
  assert.deepEqual(matrix.admissionGate, {
    activationAllowed: false,
    activationBlockers:
      governance.securityDisposition.activationPreconditions.slice(0, 8),
    externalRuntimeHighActivationPreconditions: 5,
    runtimeConfigurationHighActivationPreconditions: 1,
    runtimeConfigurationLowActivationPreconditions: 1,
    matrixResult:
      "PASS_SOURCE_SECURITY_BOUNDARY_WITH_EXTERNAL_ACTIVATION_PRECONDITIONS",
    reachableUnresolvedCritical: 0,
    reachableUnresolvedHigh: 0,
  })
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(
        Object.groupBy(
          matrix.findings,
          ({ disposition }) => disposition.status,
        ),
      ).map(([status, findings]) => [status, findings.length]),
    ),
    governance.freshEvidence.vulnerability.dispositionCounts,
  )
  assert.deepEqual(
    governance.freshEvidence.vulnerability.runtimeTrivy.rawCounts,
    {
      critical: 0,
      high: 7,
      low: 1,
      medium: 4,
      unknown: 1,
    },
  )
  assert.deepEqual(
    governance.freshEvidence.vulnerability.frontendTrivy.rawCounts,
    {
      critical: 0,
      high: 9,
      low: 6,
      medium: 23,
      unknown: 1,
    },
  )
  assert.deepEqual(
    governance.freshEvidence.vulnerability.frontendTrivy.shippedRuntimeCounts,
    {
      critical: 0,
      high: 2,
      low: 4,
      medium: 16,
      unknown: 0,
    },
  )
  assert.equal(artifactLicenseEvidence.coverage.expectedComponentCount, 581)
  assert.equal(artifactLicenseEvidence.coverage.reviewedComponentCount, 581)
  assert.deepEqual(artifactLicenseEvidence.coverage.missingRefs, [])
  assert.deepEqual(artifactLicenseEvidence.coverage.unknownExpressions, [])
  assert.deepEqual(artifactLicenseEvidence.coverage.prohibitedRefs, [])

  for (const input of manifest.downstream.buildInputs) {
    assert.equal(input.platform, "linux/amd64")
    assert.match(input.indexDigest, /^sha256:[a-f0-9]{64}$/)
    assert.match(input.platformDigest, /^sha256:[a-f0-9]{64}$/)
    assert.doesNotMatch(
      `${input.repository}:${input.version}`,
      /(?:^|[/:._-])latest(?:$|[/:._-])/i,
    )
  }
})

test("F0-N4R1 binds every checked-in downstream input by exact SHA-256", () => {
  const manifest = readJson(`${packageRoot}/source-package.json`)
  const governance = readJson(
    "docs/reduction/inference-core/f0-n4r1-portainer-security-admission.json",
  )
  for (const [path, expected] of [
    [manifest.downstream.patch.path, manifest.downstream.patch.sha256],
    [
      manifest.downstream.dockerfile.path,
      manifest.downstream.dockerfile.sha256,
    ],
    [
      manifest.downstream.licenseCopy.path,
      manifest.downstream.licenseCopy.sha256,
    ],
    [
      manifest.downstream.attributionsCopy.path,
      manifest.downstream.attributionsCopy.sha256,
    ],
    [
      manifest.downstream.dockerignore.path,
      manifest.downstream.dockerignore.sha256,
    ],
    [manifest.downstream.notice.path, manifest.downstream.notice.sha256],
    [
      manifest.downstream.licenseReview.path,
      manifest.downstream.licenseReview.sha256,
    ],
    ...Object.values(manifest.downstream.evidenceTooling).map(
      ({ path, sha256: expected }) => [path, expected],
    ),
    [
      governance.freshEvidence.sbom.evidencePath,
      governance.freshEvidence.sbom.sha256,
    ],
    [
      governance.freshEvidence.sbom.frontendEvidencePath,
      governance.freshEvidence.sbom.frontendSha256,
    ],
    [
      governance.freshEvidence.sbom.frontendRuntimeBindingPath,
      governance.freshEvidence.sbom.frontendRuntimeBindingSha256,
    ],
    [
      governance.freshEvidence.provenance.evidencePath,
      governance.freshEvidence.provenance.sha256,
    ],
    [
      governance.freshEvidence.vulnerability.runtimeTrivy.normalizedReportPath,
      governance.freshEvidence.vulnerability.runtimeTrivy
        .normalizedReportSha256,
    ],
    [
      governance.freshEvidence.vulnerability.frontendTrivy.normalizedReportPath,
      governance.freshEvidence.vulnerability.frontendTrivy
        .normalizedReportSha256,
    ],
    [
      governance.freshEvidence.vulnerability.govulncheck
        .normalizedSourceReportPath,
      governance.freshEvidence.vulnerability.govulncheck
        .normalizedSourceReportSha256,
    ],
    [
      governance.freshEvidence.vulnerability.govulncheck
        .normalizedBinaryReportPath,
      governance.freshEvidence.vulnerability.govulncheck
        .normalizedBinaryReportSha256,
    ],
    [
      governance.freshEvidence.vulnerability.findingMatrixPath,
      governance.freshEvidence.vulnerability.findingMatrixSha256,
    ],
    [
      governance.freshEvidence.licenseAndNotice.artifactEvidencePath,
      governance.freshEvidence.licenseAndNotice.artifactEvidenceSha256,
    ],
    [
      governance.freshEvidence.licenseAndNotice.custody.frontendInputPath,
      governance.freshEvidence.licenseAndNotice.custody.frontendInputSha256,
    ],
    [
      governance.freshEvidence.licenseAndNotice.custody.frontendManifestPath,
      governance.freshEvidence.licenseAndNotice.custody.frontendManifestSha256,
    ],
    [
      governance.freshEvidence.licenseAndNotice.custody.runtimeInputPath,
      governance.freshEvidence.licenseAndNotice.custody.runtimeInputSha256,
    ],
    [
      governance.freshEvidence.licenseAndNotice.custody.runtimeManifestPath,
      governance.freshEvidence.licenseAndNotice.custody.runtimeManifestSha256,
    ],
    [
      governance.freshEvidence.evidenceIndex.path,
      governance.freshEvidence.evidenceIndex.sha256,
    ],
    ...governance.freshEvidence.reproducibility.assemblies.flatMap((assembly) =>
      [
        assembly.buildEnvironmentReceipt,
        assembly.buildLogReceipt,
        assembly.reachabilityReceipt,
        assembly.sealedRecord,
      ].map(({ path, sha256: expected }) => [path, expected]),
    ),
  ]) {
    assert.equal(sha256(read(path)), expected, path)
  }

  const dockerfile = readText(`${packageRoot}/Dockerfile`)
  assert.doesNotMatch(dockerfile, /(?:FROM|syntax=)[^\n]*:latest(?:@|\s|$)/i)
  assert.match(
    dockerfile,
    /^# syntax=docker\.io\/docker\/dockerfile:1\.7@sha256:[a-f0-9]{64}$/m,
  )
  for (const input of manifest.downstream.buildInputs.filter(
    ({ id }) => id !== "dockerfile-frontend",
  )) {
    assert.match(
      dockerfile,
      new RegExp(
        `FROM --platform=linux/amd64 ${escapeRegExp(input.repository)}@${escapeRegExp(input.platformDigest)}`,
      ),
    )
  }

  const biome = readJson("biome.json")
  const portainerFileIgnores = biome.files.ignore.filter((path) =>
    path.includes("infra/portainer/ce-downstream"),
  )
  assert.deepEqual(portainerFileIgnores, [])
  const portainerFormatterIgnores = biome.formatter.ignore.filter((path) =>
    path.includes("infra/portainer/ce-downstream"),
  )
  assert.deepEqual(portainerFormatterIgnores, [
    "infra/portainer/ce-downstream/evidence/assemblies/a/reachability-receipt.json",
    "infra/portainer/ce-downstream/evidence/assemblies/b/reachability-receipt.json",
    "infra/portainer/ce-downstream/evidence/evidence-input-index.json",
    "infra/portainer/ce-downstream/evidence/frontend-license-input.json",
    "infra/portainer/ce-downstream/evidence/frontend-runtime-binding.json",
    "infra/portainer/ce-downstream/evidence/frontend-sbom.cdx.json",
    "infra/portainer/ce-downstream/evidence/frontend-trivy.json",
    "infra/portainer/ce-downstream/evidence/reproducibility.json",
    "infra/portainer/ce-downstream/evidence/sbom.cdx.json",
    "infra/portainer/ce-downstream/evidence/trivy-misconfiguration.json",
    "infra/portainer/ce-downstream/evidence/trivy.json",
  ])
  assert.equal(
    git(
      "check-attr",
      "whitespace",
      "--",
      "infra/portainer/ce-downstream/patches/security-toolchain.patch",
    ).trim(),
    "infra/portainer/ce-downstream/patches/security-toolchain.patch: whitespace: unset",
  )
  assert.equal(
    git(
      "check-attr",
      "whitespace",
      "--",
      "infra/portainer/ce-downstream/THIRD_PARTY_NOTICES.md",
    ).trim(),
    "infra/portainer/ce-downstream/THIRD_PARTY_NOTICES.md: whitespace: -blank-at-eof",
  )
})

test("F0-N4R1 leaves BOM, startup, ingress, Console, deployment, and advertising unchanged", () => {
  for (const path of unchangedProductSurfaces) {
    assert.deepEqual(
      gitBuffer("show", `${admittedCandidate}:${path}`),
      gitBuffer("show", `${protectedInput}:${path}`),
      path,
    )
  }

  const inventory = readJson("infra/release/core-image-inventory.json")
  const edge = readJson("infra/ingress/native-admin-edge-profile.json")
  const deployment = readJson("infra/deployment/vm103-deployment-contract.json")
  const tools = readText("apps/web/src/lib/admin/technical-tools.ts")
  const startup = readText("scripts/pre-genesis/reduced-core-integrated.mjs")
  const productReadme = readText("README.md")

  assert.deepEqual(inventory.excluded, ["portainer"])
  assert.equal(
    inventory.components.some(({ id }) => /portainer/i.test(id)),
    false,
  )
  assert.deepEqual(edge.globalDenials, {
    ...edge.globalDenials,
    portainerAuthority: "ABSENT",
    portainerRoute: "ABSENT",
    portainerUpstream: "ABSENT",
  })
  assert.equal(
    deployment.retiredSurfaces.deferredAdministration,
    "PORTAINER_DEFERRED_UPSTREAM_SECURITY",
  )
  assert.equal(
    deployment.services.some(({ id }) => /portainer/i.test(id)),
    false,
  )
  assert.doesNotMatch(tools, /portainer/i)
  assert.doesNotMatch(startup, /portainer/i)
  assert.match(
    productReadme,
    /Portainer remains\s+deferred for upstream security work/,
  )
})

test("F0-N4R1 binds the exact reviewed negative supply-chain scan evidence", () => {
  const actual = buildForbiddenAllowlist({
    root: repositoryRoot,
  }).entries.filter(
    ({ path }) =>
      path ===
        "docs/reduction/inference-core/f0-n4r1-portainer-security-admission.json" ||
      path.startsWith(`${packageRoot}/`),
  )
  assert.deepEqual(actual, f0N4R1ReviewedNegativeFindings)
  assert.equal(actual.length, 40)
  assert.equal(new Set(actual.map(({ path }) => path)).size, 30)
  assert.equal(
    actual.reduce((total, finding) => total + finding.count, 0),
    309,
  )
  const byRule = {}
  for (const finding of actual) {
    byRule[finding.ruleId] ??= {
      findingEntryCount: 0,
      matchCount: 0,
    }
    byRule[finding.ruleId].findingEntryCount += 1
    byRule[finding.ruleId].matchCount += finding.count
  }

  const governance = readJson(
    "docs/reduction/inference-core/f0-n4r1-portainer-security-admission.json",
  )
  assert.deepEqual(governance.freshEvidence.reviewedNegativeSurfaceScan, {
    byRule,
    disposition: "REVIEWED_NEGATIVE_SUPPLY_CHAIN_EVIDENCE_ONLY",
    exactPaths: [
      "docs/reduction/inference-core/f0-n4r1-portainer-security-admission.json",
    ],
    findingEntryCount: 40,
    matchCount: 309,
    pathPrefixes: ["infra/portainer/ce-downstream/"],
    uniquePathCount: 30,
    semanticBoundary:
      "Exact governance, build-tool, scanner, SBOM, license-custody, and vulnerability-evidence terminology does not introduce a retired customer-authoring route, authority, runtime, or surface. Rule/path entries, unique paths, counts, and fingerprints remain fail-closed in the repository guardrail.",
  })
  assert.equal(
    governance.sourceChangeBoundary.releaseTestCommandsOrSuitesChanged,
    false,
  )
  assert.equal(
    governance.sourceChangeBoundary.releaseTestGuardrailFingerprintRefreshed,
    true,
  )

  const releaseGate = readJson(
    "docs/reduction/inference-core/pr-12-release-test-gate-binding.json",
  )
  assert.equal(
    releaseGate.protectedFiles.find(
      ({ path }) => path === "scripts/inference-core/guardrails.mjs",
    )?.sha256,
    sha256(read("scripts/inference-core/guardrails.mjs")),
  )
})

test("F0-N4R1 binds the exact source-only changed-path inventory", () => {
  const governance = readJson(
    "docs/reduction/inference-core/f0-n4r1-portainer-security-admission.json",
  )
  const paths = governance.sourceChangeBoundary.exactChangedPaths
  assert.equal(paths.length, 706)
  assert.equal(new Set(paths).size, 706)
  assert.deepEqual(paths, [...paths].sort())
  assert.deepEqual(governance.sourceChangeBoundary.changedPathCounts, {
    added: 699,
    deleted: 0,
    modified: 7,
    total: 706,
  })
  for (const required of [
    "docs/reduction/inference-core/f0-n4r1-portainer-security-admission.json",
    "infra/portainer/ce-downstream/evidence/artifact-license-evidence.json",
    "infra/portainer/ce-downstream/evidence/frontend-runtime-binding.json",
    "infra/portainer/ce-downstream/evidence/frontend-sbom.cdx.json",
    "infra/portainer/ce-downstream/evidence/frontend-trivy.json",
    "infra/portainer/ce-downstream/evidence/trivy-misconfiguration.json",
    "infra/portainer/ce-downstream/security-finding-matrix.json",
    "infra/portainer/ce-downstream/source-package.json",
    "scripts/inference-core/f0-n4r1-portainer-security-admission.test.mjs",
    "scripts/inference-core/guardrails.mjs",
  ]) {
    assert.ok(paths.includes(required), required)
  }
})

test("F0-N4R1 reachability validator fails closed around the admitted call boundary", () => {
  const temporary = mkdtempSync(join(tmpdir(), "llmm-portainer-reachability-"))
  try {
    const api = join(temporary, "api")
    mkdirSync(api)
    writeFileSync(
      join(temporary, "go.mod"),
      [
        "module example.invalid/portainer-boundary",
        "github.com/moby/go-archive v0.1.0 // indirect",
        "github.com/docker/compose/v2 v2.40.3",
        "github.com/docker/cli v28.5.1+incompatible",
        "",
      ].join("\n"),
    )
    writeFileSync(
      join(temporary, "package.json"),
      JSON.stringify({
        dependencies: {
          angular: "1.8.2",
          "angular-messages": "1.8.2",
          "angular-mocks": "1.8.2",
          "angular-resource": "1.8.2",
          "angular-sanitize": "1.8.2",
        },
        name: "@portainer/ce",
        version: "2.39.6",
      }),
    )
    const webpack = join(temporary, "webpack")
    mkdirSync(webpack)
    writeFileSync(
      join(webpack, "webpack.common.js"),
      "module.exports = { plugins: [] };\n",
    )
    const schemaRoot = join(temporary, "app/react/hooks/useDockerComposeSchema")
    mkdirSync(schemaRoot, { recursive: true })
    writeFileSync(
      join(schemaRoot, "docker-compose-schema.ts"),
      "export const dockerComposeSchema = { type: 'object' }\n",
    )
    writeFileSync(
      join(schemaRoot, "useDockerComposeSchema.ts"),
      [
        "import { JSONSchema7 } from 'json-schema';",
        "import { dockerComposeSchema } from './docker-compose-schema';",
        "",
        "export function getDockerComposeSchema(): Promise<JSONSchema7> {",
        "  return Promise.resolve(dockerComposeSchema as JSONSchema7);",
        "}",
        "",
      ].join("\n"),
    )
    const allowedCalls = [
      "Build",
      "Create",
      "Down",
      "List",
      "MaxConcurrency",
      "Ps",
      "Pull",
      "RunOneOffContainer",
      "Up",
    ]
      .map((method) => `composeService.${method}()`)
      .join("\n")
    writeFileSync(join(api, "boundary.go"), allowedCalls)
    assert.deepEqual(validateReachability(temporary), [])

    writeFileSync(
      join(api, "boundary.go"),
      `${allowedCalls}\ncomposeService.Copy()\nimport _ \"github.com/moby/go-archive\"\n`,
    )
    const errors = validateReachability(temporary)
    assert.ok(
      errors.some((error) => error.includes("unapproved Compose method Copy")),
    )
    assert.ok(
      errors.some((error) => error.includes("direct moby/go-archive import")),
    )
  } finally {
    rmSync(temporary, { force: true, recursive: true })
  }
})

function read(path) {
  return readFileSync(resolve(repositoryRoot, path))
}

function readText(path) {
  return read(path).toString("utf8")
}

function readJson(path) {
  return JSON.parse(readText(path))
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}

function git(...args) {
  return gitBuffer(...args)
    .toString("utf8")
    .trim()
}

function gitBuffer(...args) {
  return execFileSync("git", args, { cwd: repositoryRoot })
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
