import assert from "node:assert/strict"
import test from "node:test"

import { renderVm103LiteLlmRoute } from "./render-vm103-litellm-route.mjs"

function profile() {
  return {
    apiVersion: "inference-core.llm-machines/v1",
    kind: "RenderedInferenceDeliveryProfile",
    source: { profileId: "internal-profile-r1", revision: 1 },
    engine: {
      command: [
        "python3",
        "-m",
        "sglang.launch_server",
        "--served-model-name",
        "internal-model",
        "--port",
        "30005",
      ],
    },
    network: {
      allowedCallers: ["litellm-private"],
      visibility: "private-inference-plane",
    },
    capabilityAdvertisement: {
      state: "ACTIVE_MEASURED",
      freshness: {
        measuredAt: "2026-08-24T17:08:51.086Z",
        validUntil: "2026-09-23T17:08:51.086Z",
      },
      models: [{ alias: "internal-model" }],
    },
    qualification: {
      productionCapacityClaim: false,
      scope: "INTERNAL_TEST_ONLY",
    },
  }
}

const now = new Date("2026-08-25T12:00:00.000Z")

test("renders one credential-free measured LiteLLM route", () => {
  const result = renderVm103LiteLlmRoute(
    profile(),
    "http://10.33.74.166:30005/v1",
    now,
  )
  assert.equal(result.modelAlias, "internal-model")
  assert.match(result.config, /model_name: internal-model/)
  assert.match(result.config, /api_base: http:\/\/10\.33\.74\.166:30005\/v1/)
  assert.match(result.config, /api_key: os\.environ\/UPSTREAM_API_KEY/)
  assert.match(result.config, /store_prompts_in_spend_logs: false/)
  assert.match(result.config, /turn_off_message_logging: true/)
  assert.doesNotMatch(result.config, /fixture-model|password|secret/i)
  assert.match(result.sha256, /^[0-9a-f]{64}$/)
})

test("rejects stale, unmeasured, public, and mismatched routes", () => {
  const stale = profile()
  stale.capabilityAdvertisement.freshness.validUntil =
    "2026-08-25T11:59:59.000Z"
  assert.throws(
    () => renderVm103LiteLlmRoute(stale, "http://10.33.74.166:30005/v1", now),
    /current measured/,
  )

  const unmeasured = profile()
  unmeasured.capabilityAdvertisement.state = "UNAVAILABLE_UNMEASURED"
  assert.throws(
    () =>
      renderVm103LiteLlmRoute(unmeasured, "http://10.33.74.166:30005/v1", now),
    /current measured/,
  )

  assert.throws(
    () =>
      renderVm103LiteLlmRoute(profile(), "http://203.0.113.10:30005/v1", now),
    /private SGLang endpoint/,
  )

  const mismatch = profile()
  mismatch.engine.command[mismatch.engine.command.indexOf("30005")] = "30006"
  assert.throws(
    () =>
      renderVm103LiteLlmRoute(mismatch, "http://10.33.74.166:30005/v1", now),
    /engine command/,
  )
})
