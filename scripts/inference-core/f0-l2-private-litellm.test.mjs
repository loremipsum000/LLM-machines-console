import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import test from "node:test"

const root = resolve(import.meta.dirname, "../..")

test("F0-L2 binds actual LiteLLM to the private Product flow", async () => {
  const [wrapper, browser, evidence, inventory, adminRoute] = await Promise.all(
    [
      readSource("scripts/pre-genesis/reduced-core-litellm-integration.mjs"),
      readSource("scripts/pre-genesis/reduced-core-browser-session.mjs"),
      readJson("docs/reduction/inference-core/f0-l2-private-litellm.json"),
      readJson("infra/release/core-image-inventory.json"),
      readSource("apps/bff/src/routes/admin.ts"),
    ],
  )

  const locked = inventory.components.find(({ id }) => id === "litellm")
  assert.ok(locked)
  const historicalIdentity = evidence.exactRuntime.litellm
  assert.doesNotMatch(
    wrapper,
    new RegExp(historicalIdentity.replaceAll(".", "\\.")),
  )
  assert.match(wrapper, /loadLiteLlmOssRuntimeContract/)
  assert.match(wrapper, /validateLiteLlmOssRuntimeInspection/)
  assert.match(wrapper, /turn_off_message_logging: true/)
  assert.match(wrapper, /store_prompts_in_spend_logs: false/)
  assert.match(wrapper, /log_raw_request_response: false/)
  assert.match(wrapper, /workloadContentCanaries: 0/)
  assert.match(wrapper, /"fixture-stream-response"/)
  assert.match(wrapper, /assertNoSensitiveValues/)
  assert.match(browser, /--litellm/)
  assert.match(browser, /LOCAL_PRIVATE_LITELLM_INTEGRATION_ONLY/)
  assert.match(browser, /applicationCredentialDirectLiteLlmAccess: "denied"/)
  assert.match(browser, /assert\.match\(stream\.body, \/data:/)
  assert.match(browser, /LiteLLM remains private/)
  assert.match(browser, /Create virtual key/)
  assert.match(adminRoute, /server\.get\(\s*"\/api\/admin\/inference"/)
  assert.doesNotMatch(
    adminRoute,
    /server\.(?:post|put|patch|delete)\(\s*"\/api\/admin\/inference/,
  )
  assert.match(evidence.command, /reduced-core-litellm-integration\.mjs/)
  assert.equal(evidence.workPackage, "F0-L2")
  assert.equal(evidence.baseCommit, "6fb13ba3674a69fec7a9496b81bf2feeef09599b")
  assert.equal(evidence.accepted, false)
  assert.equal(evidence.runtimeQualified, false)
  assert.equal(locked.kind, "litellm-oss-build-output")
  assert.equal(locked.version, "v1.96.2-llmm.1")
  assert.equal(
    locked.sourcePackage,
    "infra/litellm/oss-downstream/source-package.json",
  )
})

test("F0-L2 remains historical while F0-N1 prospectively restores native administration", async () => {
  const [evidence, inventory, ingress] = await Promise.all([
    readSource("docs/reduction/inference-core/f0-l2-private-litellm.json"),
    readJson("infra/release/core-image-inventory.json"),
    readSource("infra/ingress/source-no-bypass.mjs"),
  ])
  const parsed = JSON.parse(evidence)
  const locked = inventory.components.find(({ id }) => id === "litellm")
  assert.equal(
    locked.customerExposure,
    "product-edge-native-sso-and-console-projection",
  )
  assert.ok(!inventory.excluded.includes("native-litellm-ui"))
  assert.match(ingress, /nativeConsolePathPattern/)
  assert.match(ingress, /ui\|public\|key\|model\|router/)
  assert.ok(
    parsed.notEvidenceFor.includes(
      "real SGLang behavior or production inference capacity",
    ),
  )
  assert.doesNotMatch(
    evidence,
    /(?:Harbor|Gitea|capacity passed|runtime qualified)/i,
  )
})

async function readSource(path) {
  return readFile(resolve(root, path), "utf8")
}

async function readJson(path) {
  return JSON.parse(await readSource(path))
}
