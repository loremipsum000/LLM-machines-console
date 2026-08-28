import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { test } from "node:test"

const repositoryRoot = resolve(import.meta.dirname, "../..")

test("F0-U1 remains a bounded local browser Application proof", async () => {
  const [decision, packageJson, harness, contentSecurityPolicy, elevationPage] =
    await Promise.all([
      readJson("docs/reduction/inference-core/f0-u1-browser-applications.json"),
      readJson("package.json"),
      readSource("scripts/pre-genesis/reduced-core-browser-session.mjs"),
      readSource("apps/web/src/lib/security/content-security-policy.ts"),
      readSource("apps/web/src/app/auth/elevate/page.tsx"),
    ])

  assert.equal(decision.workPackage, "F0-U1")
  assert.equal(decision.accepted, false)
  assert.equal(decision.runtimeQualified, false)
  assert.equal(decision.evidenceClass, "LOCAL_BROWSER_APPLICATION_FLOW_ONLY")
  assert.equal(
    decision.command,
    "corepack pnpm run test:pre-genesis:browser-applications",
  )
  assert.match(
    packageJson.scripts["test:pre-genesis:browser-applications"],
    /reduced-core-browser-session\.mjs --applications/,
  )
  assert.match(harness, /LOCAL_BROWSER_APPLICATION_FLOW_ONLY/)
  assert.match(harness, /standard OpenAI-compatible client/)
  assert.match(harness, /disclaimerRequired: true/)
  assert.match(harness, /separateCredential: true/)
  assert.match(harness, /"cookie", "x-llm-machines-console-session"/)
  assert.match(contentSecurityPolicy, /WEB_IDENTITY_ORIGIN/)
  assert.match(contentSecurityPolicy, /form-action 'self'/)
  assert.match(elevationPage, /referrer: "same-origin"/)
  assert.doesNotMatch(
    harness,
    /(?:\b(?:ssh|kubectl|harbor|gitea)\b|\bvmid\s*115\b)/i,
  )
  assert.doesNotMatch(harness, /\.\.\.process\.env/)
  assert.ok(
    decision.preservedBoundaries.includes(
      "Console never probes inference or Firecrawl with an Application credential",
    ),
  )
  assert.ok(
    decision.notEvidenceFor.includes(
      "real LiteLLM, Firecrawl, or SGLang runtime behavior",
    ),
  )
})

async function readSource(path) {
  return readFile(resolve(repositoryRoot, path), "utf8")
}

async function readJson(path) {
  return JSON.parse(await readSource(path))
}
