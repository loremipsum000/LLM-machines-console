import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { test } from "node:test"

const read = (path) =>
  readFile(new URL(`../../${path}`, import.meta.url), "utf8")

test("Keys vocabulary is canonical without view-layer remapping", async () => {
  const [contracts, copy, sections, rootPage, decision, boundary] =
    await Promise.all([
      read("packages/contracts/src/inference-core.ts"),
      read("packages/copy/src/index.ts"),
      read("apps/web/src/components/console-v2/console-v2-sections.ts"),
      read("apps/web/src/app/page.tsx"),
      read("docs/reduction/inference-core/decision-register.md"),
      read(
        "docs/reduction/inference-core/business-architecture-current-boundary.json",
      ),
    ])

  assert.match(contracts, /href: "\/keys"/)
  assert.match(contracts, /legacyHref: "\/applications"/)
  assert.match(copy, /import { inferenceCoreCustomerVocabulary }/)
  assert.match(
    copy,
    /primaryIntegration: inferenceCoreCustomerVocabulary\.primaryIntegration/,
  )
  assert.match(sections, /productCopy\.vocabulary\.primaryIntegration\.href/)
  assert.doesNotMatch(sections, /INTERNAL_PR11_APPLICATION_NAV_COMPATIBILITY/)
  assert.doesNotMatch(sections, /id:\s*"overview"/)
  assert.match(rootPage, /redirect\("\/keys"\)/)
  await assert.rejects(
    read("apps/web/src/components/console-v2/overview-v2-experience.tsx"),
    /ENOENT/,
  )
  assert.match(decision, /Console Operators remain read-only/)
  assert.match(decision, /internal database, route, capability, and audit/i)

  const currentBoundary = JSON.parse(boundary)
  assert.equal(currentBoundary.schemaVersion, 1)
  assert.equal(currentBoundary.status, "CURRENT_PROTECTED_BOUNDARY")
  assert.deepEqual(currentBoundary.customerVocabulary, {
    canonicalHref: "/keys",
    canonicalPlural: "Keys",
    canonicalSingular: "Key",
    legacyRedirect: "/applications",
  })
  assert.deepEqual(currentBoundary.consoleOperatorAuthority, {
    createKey: false,
    revokeCredential: false,
    rotateCredential: false,
    testConnection: false,
    updateKey: false,
  })
  assert.equal(
    currentBoundary.nativeLiteLlmOperatorAuthority,
    "OWN_VIRTUAL_KEYS_AND_SPEND_ONLY",
  )
  assert.equal(currentBoundary.productAccepted, false)
  assert.equal(currentBoundary.runtimeQualified, false)
  assert.equal(currentBoundary.contractActivation, "INACTIVE")
  assert.equal(currentBoundary.genesis, "UNPUBLISHED")
})
