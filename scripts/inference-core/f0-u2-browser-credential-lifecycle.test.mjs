import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { test } from "node:test"

const repositoryRoot = resolve(import.meta.dirname, "../..")

test("F0-U2 remains a bounded local browser credential lifecycle proof", async () => {
  const [decision, packageJson, harness, applicationsUi, authorization] =
    await Promise.all([
      readJson(
        "docs/reduction/inference-core/f0-u2-browser-credential-lifecycle.json",
      ),
      readJson("package.json"),
      readSource("scripts/pre-genesis/reduced-core-browser-session.mjs"),
      readSource(
        "apps/web/src/components/console-v2/applications-v2-experience.tsx",
      ),
      readSource("packages/contracts/src/inference-core-authorization.ts"),
    ])

  assert.equal(decision.workPackage, "F0-U2")
  assert.equal(decision.accepted, false)
  assert.equal(decision.runtimeQualified, false)
  assert.equal(
    decision.evidenceClass,
    "LOCAL_BROWSER_CREDENTIAL_LIFECYCLE_ONLY",
  )
  assert.equal(
    decision.command,
    "corepack pnpm run test:pre-genesis:browser-credential-lifecycle",
  )
  assert.match(
    packageJson.scripts["test:pre-genesis:browser-credential-lifecycle"],
    /reduced-core-browser-session\.mjs --credential-lifecycle/,
  )
  assert.match(harness, /LOCAL_BROWSER_CREDENTIAL_LIFECYCLE_ONLY/)
  assert.match(harness, /crossApplicationMutationDenial: "passed"/)
  assert.match(harness, /exactStaticOverlapSeconds: 86_400/)
  assert.match(harness, /secretDomAndHistoryRetention: "none"/)
  assert.match(harness, /navigator\.clipboard\.writeText\(""\)/)
  assert.match(harness, /F0-U2 secret-retention verification failed/)
  assert.match(
    applicationsUi,
    /window\.addEventListener\("pagehide", clearReveal\)/,
  )
  assert.match(
    applicationsUi,
    /window\.addEventListener\("popstate", clearReveal\)/,
  )
  assert.match(
    authorization,
    /"applications\.credentials\.test_rotate_revoke": \{\s*admin: true,\s*operator: false\s*[,}]/,
  )
  assert.match(
    authorization,
    /"applications\.disable": \{\s*admin: true,\s*operator: false\s*[,}]/,
  )
  assert.doesNotMatch(harness, /(?:ssh|kubectl|harbor|gitea|vmid\s*115)/i)
  assert.doesNotMatch(harness, /\.\.\.process\.env/)
  assert.equal(
    decision.nextPackage,
    "F0-P1 disposable PostgreSQL-backed persistence and restart behavior",
  )
  assert.ok(
    decision.notEvidenceFor.includes(
      "PostgreSQL Application, usage, audit, or Console-session persistence",
    ),
  )
})

async function readSource(path) {
  return readFile(resolve(repositoryRoot, path), "utf8")
}

async function readJson(path) {
  return JSON.parse(await readSource(path))
}
