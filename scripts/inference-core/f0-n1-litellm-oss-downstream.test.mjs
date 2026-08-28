import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import test from "node:test"
import { validateSourcePackage } from "../../infra/litellm/oss-downstream/validate-source-package.mjs"
import {
  buildForbiddenAllowlist,
  f0N1ReviewedNegativeFindings,
} from "./guardrails.mjs"

const root = resolve(import.meta.dirname, "../..")
const base = "1419006baff63c9861218872a41f64c096b8f9a8"

test("F0-N1 binds the exact OSS-only downstream without activating it", async () => {
  const [evidence, sourcePackage, routeEvidence] = await Promise.all([
    readJson("docs/reduction/inference-core/f0-n1-litellm-oss-downstream.json"),
    readJson("infra/litellm/oss-downstream/source-package.json"),
    readJson(
      "docs/reduction/inference-core/f0-n1-litellm-native-route-characterization.json",
    ),
  ])

  assert.equal(evidence.workPackage, "F0-N1")
  assert.equal(evidence.status, "SOURCE_CHARACTERIZED_NOT_ACTIVATED")
  assert.equal(evidence.accepted, false)
  assert.equal(evidence.runtimeQualified, false)
  assert.equal(evidence.contractActivation, "INACTIVE")
  assert.equal(evidence.q0, "NOT_STARTED")
  assert.equal(evidence.genesisPublished, false)
  assert.equal(evidence.protectedInput.commit, base)
  assert.equal(git("rev-parse", `${base}^{tree}`), evidence.protectedInput.tree)
  assert.equal(sourcePackage.runtimeQualified, false)
  assert.equal(routeEvidence.status, "CHARACTERIZED_NOT_ACTIVATED")
  assert.match(
    routeEvidence.f0N5ReviewRequired.activation,
    /^INACTIVE_PENDING_/,
  )
})

test("F0-N1 proves deterministic source and image identities", async () => {
  const [evidence, sourcePackage, inventory] = await Promise.all([
    readJson("docs/reduction/inference-core/f0-n1-litellm-oss-downstream.json"),
    readJson("infra/litellm/oss-downstream/source-package.json"),
    readJson("infra/release/core-image-inventory.json"),
  ])
  const litellm = inventory.components.find(({ id }) => id === "litellm")

  assert.equal(evidence.upstream.version, "v1.96.2")
  assert.equal(
    evidence.upstream.commit,
    "83d6d84bfb7abbbff70d456bc89028d426db8c33",
  )
  assert.equal(evidence.upstream.cosign.result, "PASS")
  assert.equal(evidence.upstream.disposition, "NOT_DISTRIBUTED_UNCHANGED")
  assert.equal(evidence.downstream.version, "v1.96.2-llmm.1")
  assert.equal(evidence.downstream.deterministicBuilds, 2)
  assert.equal(evidence.downstream.byteIdentical, true)
  assert.equal(
    evidence.downstream.ociArchiveSha256,
    sourcePackage.downstream.artifactEvidence.ociArchiveSha256,
  )
  assert.equal(
    evidence.downstream.manifest,
    sourcePackage.downstream.artifactEvidence.manifestDigest,
  )
  assert.equal(
    evidence.downstream.config,
    sourcePackage.downstream.artifactEvidence.configDigest,
  )
  assert.equal(litellm.kind, "litellm-oss-build-output")
  assert.equal(litellm.version, evidence.downstream.version)
  assert.equal(litellm.transitiveCopyleftSourceRequired, true)
})

test("F0-N1 removes Enterprise material and binds license obligations", async () => {
  const [patch, strip, sourcePackage, licensePolicy, evidence] =
    await Promise.all([
      readText("infra/litellm/oss-downstream/patches/remove-enterprise.patch"),
      readText("infra/litellm/oss-downstream/strip-enterprise-bridges.mjs"),
      readJson("infra/litellm/oss-downstream/source-package.json"),
      readJson("infra/release/license-disposition.json"),
      readJson(
        "docs/reduction/inference-core/f0-n1-litellm-oss-downstream.json",
      ),
    ])

  for (const removal of [
    '"litellm-enterprise==0.1.53"',
    "COPY enterprise/pyproject.toml enterprise/",
    "COPY --from=builder /app/enterprise /app/enterprise",
  ])
    assert.match(
      patch,
      new RegExp(removal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    )
  assert.match(strip, /Enterprise import bridges survived sanitization/)
  assert.equal(
    sourcePackage.downstream.artifactEvidence.sbom.enterpriseMaterial,
    false,
  )
  assert.equal(evidence.securityEvidence.vulnerability.critical, 0)
  assert.equal(evidence.securityEvidence.vulnerability.high, 0)
  assert.deepEqual(
    licensePolicy.sourcePackets.find(
      ({ id }) => id === "litellm-oss-transitive-sources",
    )?.components,
    ["litellm"],
  )
  assert.equal(
    evidence.securityEvidence.transitiveCopyleft.releaseArtifactConstructed,
    false,
  )
})

test("F0-N1 proves free native SSO and the exact role boundary", async () => {
  const [evidence, routeEvidence, runtime, browser] = await Promise.all([
    readJson("docs/reduction/inference-core/f0-n1-litellm-oss-downstream.json"),
    readJson(
      "docs/reduction/inference-core/f0-n1-litellm-native-route-characterization.json",
    ),
    readText("scripts/pre-genesis/litellm-oss-characterization.mjs"),
    readText("scripts/pre-genesis/litellm-oss-browser-characterization.mjs"),
  ])

  assert.equal(evidence.authenticationAndRoles.paidLicense, false)
  assert.equal(evidence.authenticationAndRoles.trialLicense, false)
  assert.equal(evidence.authenticationAndRoles.billableUsersTested, 2)
  assert.equal(evidence.authenticationAndRoles.billableUserLimit, 5)
  assert.equal(evidence.authenticationAndRoles.Admin, "proxy_admin")
  assert.equal(evidence.authenticationAndRoles.Operator, "internal_user")
  assert.equal(
    routeEvidence.authentication.flow,
    "Authorization Code with PKCE S256",
  )
  assert.equal(routeEvidence.authentication.consoleSessionForwarded, false)
  assert.equal(routeEvidence.authentication.sharedCookie, false)
  assert.equal(routeEvidence.nativeUi.webSocketRequired, false)
  assert.equal(routeEvidence.nativeUi.sseRequiredForAdministration, false)
  for (const path of [
    "/model/new",
    "/team/new",
    "/organization/new",
    "/user/new",
    "/config/update",
    "/v1/mcp/server",
  ])
    assert.ok(
      routeEvidence.qualifiedRoleBoundary.operatorDenied.some((denial) =>
        denial.includes(path),
      ),
    )
  assert.match(runtime, /LITELLM_UI_SESSION_DURATION=8h/)
  assert.match(runtime, /ssoSessionIdleTimeout: 28_800/)
  assert.match(runtime, /ssoSessionMaxLifespan: 86_400/)
  assert.match(runtime, /127\.0\.0\.1:\$\{state\.ports\.litellm\}:4000/)
  assert.match(browser, /assertOperatorNavigation/)
  assert.match(browser, /native session exceeds the fixed 8-hour limit/)
  assert.doesNotMatch(runtime, /LITELLM_LICENSE=/)
})

test("F0-N1 preserves Product and future edge boundaries", async () => {
  const [
    evidence,
    routeEvidence,
    decisionRegister,
    validationRegister,
    readme,
  ] = await Promise.all([
    readJson("docs/reduction/inference-core/f0-n1-litellm-oss-downstream.json"),
    readJson(
      "docs/reduction/inference-core/f0-n1-litellm-native-route-characterization.json",
    ),
    readText("docs/reduction/inference-core/decision-register.md"),
    readText("docs/reduction/inference-core/validation-register.md"),
    readText("docs/reduction/inference-core/README.md"),
  ])

  assert.ok(
    evidence.preservedBoundaries.includes(
      "Console Application credentials remain the recommended integration path",
    ),
  )
  assert.ok(
    routeEvidence.f0N5ReviewRequired.mustRemainDenied.includes(
      "MCP management and execution routes",
    ),
  )
  assert.ok(
    routeEvidence.f0N5ReviewRequired.mustRemainDenied.includes(
      "direct native port access",
    ),
  )
  assert.match(decisionRegister, /\| F0-N1 \|/)
  assert.match(validationRegister, /\| F0-N1 \|/)
  assert.match(readme, /LiteLLM OSS-only downstream characterization/)

  for (const document of [evidence, routeEvidence]) {
    const serialized = JSON.stringify(document)
    assert.doesNotMatch(
      serialized,
      /(?:PRIVATE KEY|BEGIN OPENSSH|password=|token=|10\.\d{1,3}\.\d{1,3}\.\d{1,3})/i,
    )
  }
})

test("F0-N1 source metadata fails closed", async () => {
  const sourcePackage = await readJson(
    "infra/litellm/oss-downstream/source-package.json",
  )
  for (const mutate of [
    (candidate) => {
      candidate.downstream.buildInputs[0].indexDigest = "mutable"
    },
    (candidate) => {
      candidate.authentication.licenseMaterialAllowed = true
    },
    (candidate) => {
      candidate.authentication.roles.Operator = "proxy_admin"
    },
    (candidate) => {
      candidate.downstream.artifactEvidence.license.transitiveCopyleftSourceRequired = false
    },
    (candidate) => {
      candidate.downstream.artifactEvidence.vulnerability.high = 1
    },
  ]) {
    const candidate = structuredClone(sourcePackage)
    mutate(candidate)
    assert.notDeepEqual(validateSourcePackage(candidate, root), [])
  }
})

test("F0-N1 binds exact reviewed negative scan evidence", () => {
  const expectedKeys = new Set(
    f0N1ReviewedNegativeFindings.map(
      ({ ruleId, path }) => `${ruleId}\0${path}`,
    ),
  )
  const actual = buildForbiddenAllowlist({ root }).entries.filter(
    ({ ruleId, path }) => expectedKeys.has(`${ruleId}\0${path}`),
  )
  assert.deepEqual(actual, f0N1ReviewedNegativeFindings)
})

function git(...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim()
}

async function readJson(path) {
  return JSON.parse(await readText(path))
}

async function readText(path) {
  return readFile(resolve(root, path), "utf8")
}
