import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import test from "node:test"

const root = resolve(import.meta.dirname, "../..")

test("F0-SG1 binds the authorized smoke to exact engine and gateway identities", async () => {
  const [evidence, contract, inventory] = await Promise.all([
    readJson("docs/reduction/inference-core/f0-sg1-internal-sglang.json"),
    readJson("infra/inference/sglang-engine-contract.json"),
    readJson("infra/release/core-image-inventory.json"),
  ])
  const liteLlm = inventory.components.find(({ id }) => id === "litellm")

  assert.equal(evidence.workPackage, "F0-SG1")
  assert.equal(evidence.baseCommit, "3d0b590608a58153e3285aafcaf96b711ac684e4")
  assert.equal(evidence.engine.version, contract.engine.version)
  assert.equal(evidence.engine.sourceCommit, contract.engine.sourceCommit)
  assert.equal(
    evidence.engine.sourceArchiveSha256,
    contract.engine.sourceArchiveSha256,
  )
  assert.equal(evidence.engine.sourcePatched, false)
  assert.match(evidence.engine.image.indexDigest, /^sha256:[a-f0-9]{64}$/)
  assert.match(
    evidence.engine.image.platformManifestDigest,
    /^sha256:[a-f0-9]{64}$/,
  )
  assert.match(evidence.engine.image.configDigest, /^sha256:[a-f0-9]{64}$/)
  assert.equal(evidence.engine.image.platform, "linux/amd64")
  assert.equal(
    evidence.gateway.image,
    `${liteLlm.repository}:${liteLlm.version}@${liteLlm.indexDigest}`,
  )
})

test("F0-SG1 records the private functional and failure boundary", async () => {
  const evidence = await readJson(
    "docs/reduction/inference-core/f0-sg1-internal-sglang.json",
  )

  assert.deepEqual(
    Object.values(evidence.proved.directSglang),
    [200, 200, 200, 200, 200, 200],
  )
  assert.equal(
    evidence.proved.throughPrivateLiteLlm.nonStreamingChatCompletions,
    200,
  )
  assert.equal(
    evidence.proved.throughPrivateLiteLlm.streamingChatCompletions,
    200,
  )
  assert.equal(
    evidence.proved.throughPrivateLiteLlm.nonStreamingUsage.totalTokens,
    72,
  )
  assert.equal(
    evidence.proved.throughPrivateLiteLlm.streamingUsage.totalTokens,
    72,
  )
  assert.equal(evidence.proved.throughPrivateLiteLlm.unapprovedModelDenied, 400)
  assert.equal(evidence.proved.throughPrivateLiteLlm.overContextDenied, 400)
  assert.equal(evidence.proved.failureAndRecovery.upstreamUnavailable, 500)
  assert.equal(
    evidence.proved.failureAndRecovery.sameContainerAfterRestart,
    true,
  )
  assert.equal(evidence.proved.failureAndRecovery.sameImageAfterRestart, true)
  assert.equal(evidence.proved.failureAndRecovery.recoveredRequest, 200)
  assert.deepEqual(Object.values(evidence.proved.network), ["denied", "denied"])
  assert.deepEqual(
    {
      canaryInLiteLlmLogs: evidence.proved.retention.canaryInLiteLlmLogs,
      canaryInSglangLogs: evidence.proved.retention.canaryInSglangLogs,
      canaryInWritableTemporaryStorage:
        evidence.proved.retention.canaryInWritableTemporaryStorage,
      databaseConfigured: evidence.proved.retention.databaseConfigured,
      requestAndResponseLogging:
        evidence.proved.retention.requestAndResponseLogging,
    },
    {
      canaryInLiteLlmLogs: false,
      canaryInSglangLogs: false,
      canaryInWritableTemporaryStorage: false,
      databaseConfigured: false,
      requestAndResponseLogging: false,
    },
  )
})

test("F0-SG1 cannot become production or Product acceptance evidence", async () => {
  const source = await readSource(
    "docs/reduction/inference-core/f0-sg1-internal-sglang.json",
  )
  const evidence = JSON.parse(source)

  assert.equal(evidence.accepted, false)
  assert.equal(evidence.runtimeQualified, false)
  assert.equal(evidence.runtimeBoundary.deliveryProfile, false)
  assert.equal(evidence.runtimeBoundary.productionSupportClaim, false)
  assert.equal(evidence.runtimeBoundary.capacityState, "UNMEASURED")
  assert.equal(evidence.runtimeBoundary.publicListener, false)
  assert.equal(evidence.gateway.nativeCustomerAccess, false)
  assert.deepEqual(evidence.cleanup, {
    builtEngineImagePreserved: true,
    exactModelArtifactPreserved: true,
    preExistingWorkloadsRemainStopped: true,
    testContainersRemaining: 0,
    testNetworksRemaining: 0,
    throwawayCredentialFilesRemaining: 0,
  })
  assert.match(evidence.nextPackage, /^F0-V1/)
  assert.doesNotMatch(
    source,
    /(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})/,
  )
  assert.doesNotMatch(source, /(?:Harbor|Gitea|VM103|runtime qualified)/i)
})

async function readSource(path) {
  return readFile(resolve(root, path), "utf8")
}

async function readJson(path) {
  return JSON.parse(await readSource(path))
}
