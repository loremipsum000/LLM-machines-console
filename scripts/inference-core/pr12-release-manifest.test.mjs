import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { verifyCheckedInReleasePlan } from "../../infra/release/validate-release-plan.mjs"

const root = new URL("../../", import.meta.url)

test("PR-12 release manifest package remains source-only", () => {
  assert.deepEqual(verifyCheckedInReleasePlan(), [])
  const source = [
    "infra/release/release-plan.json",
    "infra/release/release-evidence-policy.json",
    "infra/release/release-manifest.schema.json",
    "infra/release/generate-release-manifest.mjs",
  ]
    .map((path) => readFileSync(new URL(path, root), "utf8"))
    .join("\n")
  assert.doesNotMatch(source, /(?:intel[-_ ]arc[-_ ]b50|sglang-xpu)/i)
  assert.doesNotMatch(
    source,
    /(?:BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|ghp_)/,
  )
  assert.match(source, /PACKAGED_UNQUALIFIED/)
  assert.match(source, /NOT_STARTED/)
  assert.match(source, /INACTIVE/)
})
