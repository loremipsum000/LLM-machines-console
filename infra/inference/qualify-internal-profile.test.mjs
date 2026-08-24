import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import { qualifyInternalProfile } from "./qualify-internal-profile.mjs"

const root = path.dirname(fileURLToPath(import.meta.url))
const profile = JSON.parse(
  readFileSync(path.join(root, "fixtures/synthetic-single-node.json"), "utf8"),
)
profile.metadata.admissionScope = "INTERNAL_TEST_ONLY"
profile.metadata.lifecycleState = "CANDIDATE_UNQUALIFIED"
profile.accelerator.productionSupportClaim = false
profile.network.port = 30005

test("qualifies an exact internal test without a production claim", async () => {
  const fetchImpl = fixtureFetch()
  const result = await qualifyInternalProfile({
    concurrency: 2,
    endpoint: "http://127.0.0.1:30005",
    fetchImpl,
    maxOutputTokens: 32,
    now: () => Date.parse("2026-08-24T12:00:00.000Z"),
    profile,
    runtimeInspector: async () => ({
      containerLogs: "scanned",
      containerWritableState: "scanned",
      hostTemporaryState: "scanned",
      requestLoggingDisabled: true,
      workloadCanaryMatches: 0,
    }),
    samples: 3,
    timeoutMilliseconds: 1000,
    validDays: 30,
  })
  assert.equal(result.profile.activation.state, "ACTIVE_INTERNAL_TEST")
  assert.equal(result.rendered.qualification.scope, "INTERNAL_TEST_ONLY")
  assert.equal(result.rendered.qualification.productionCapacityClaim, false)
  assert.equal(result.rendered.capabilityAdvertisement.state, "ACTIVE_MEASURED")
})

test("rejects non-loopback measurement and missing retention evidence", async () => {
  await assert.rejects(
    qualifyInternalProfile({
      concurrency: 2,
      endpoint: "http://10.0.0.2:30005",
      fetchImpl: fixtureFetch(),
      maxOutputTokens: 32,
      profile,
      runtimeInspector: async () => ({
        containerLogs: "scanned",
        containerWritableState: "scanned",
        hostTemporaryState: "scanned",
        requestLoggingDisabled: true,
        workloadCanaryMatches: 0,
      }),
      samples: 3,
      validDays: 30,
    }),
    /exact loopback/,
  )
})

function fixtureFetch() {
  return async (url, init = {}) => {
    const pathname = new URL(url).pathname
    if (pathname === "/v1/models")
      return Response.json({ data: [{ id: profile.model.alias }] })
    if (pathname === "/metrics")
      return new Response(
        'sglang:num_queue_reqs{model_name="synthetic-model-a"} 0\n',
      )
    if (pathname === "/v1/chat/completions") {
      const body = JSON.parse(init.body)
      if (
        body.model === "unadmitted-model" ||
        body.messages[0].content.length > 9000
      )
        return new Response("denied", { status: 400 })
      if (body.stream)
        return new Response(
          'data: {"choices":[{"delta":{"content":"READY"}}]}\n\ndata: {"usage":{"completion_tokens":2}}\n\ndata: [DONE]\n\n',
        )
      return Response.json({
        choices: [{ message: { content: "READY" } }],
        usage: { completion_tokens: 2 },
      })
    }
    return new Response(null, { status: 200 })
  }
}
