import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"

const root = resolve(import.meta.dirname, "../..")
const evidence = JSON.parse(
  readFileSync(
    resolve(
      root,
      "docs/reduction/inference-core/vm103-l1b-docker-bridge-lifecycle.json",
    ),
    "utf8",
  ),
)

test("P12 preserves the failed runtime state without overstating L1B success", () => {
  assert.equal(evidence.workPackage, "VM103-L1B-P12")
  assert.equal(evidence.accepted, false)
  assert.equal(evidence.runtimeQualified, false)
  assert.equal(evidence.contractActivation, "INACTIVE")
  assert.equal(evidence.q0, "NOT_STARTED")
  assert.equal(evidence.runtimeObservation.producedImageCount, 0)
  assert.equal(evidence.boundaries.assemblyAComplete, false)
  assert.equal(evidence.boundaries.l1bSuccessful, false)
})

test("P12 binds exact independent A and B bridge profiles and tool versions", () => {
  assert.deepEqual(evidence.correction.bridgeProfiles, [
    {
      assembly: "A",
      bridge: "llmml1ba0",
      networkCidr: "172.30.118.0/24",
      gatewayAddress: "172.30.118.1",
    },
    {
      assembly: "B",
      bridge: "llmml1bb0",
      networkCidr: "172.31.118.0/24",
      gatewayAddress: "172.31.118.1",
    },
  ])
  assert.equal(evidence.correction.dockerVersion, "29.5.3")
  assert.equal(evidence.correction.iproute2.version, "6.15.0-1")
  assert.equal(
    evidence.correction.iproute2.sha256,
    "7b2dcade4a83ded723fcab21c5a53c47f29352c9c5e1661a089a1e481b3fb48a",
  )
  assert.equal(evidence.correction.dockerArguments.bridgeOnly, true)
  assert.equal(evidence.correction.dockerArguments.bipDenied, true)
})

test("P12 binds the complete readiness, failure, and exact-owned cleanup contract", () => {
  assert.deepEqual(evidence.correction.preExistingStateDenied, [
    "bridge",
    "cidr",
    "route",
    "socket",
    "pidFile",
    "process",
    "dockerDataRoot",
    "dockerExecRoot",
    "networkNamespace",
    "runnerFirewallState",
  ])
  assert.equal(evidence.correction.daemonExitFailsImmediately, true)
  assert.equal(evidence.correction.cleanup.originalFailureStatusPreserved, true)
  assert.equal(
    evidence.correction.cleanup.partiallyCreatedOwnedBridgeRemoved,
    true,
  )
  assert.equal(
    evidence.correction.cleanup.foreignBridgeIdentityPreservedAndFails,
    true,
  )
  assert.equal(evidence.correction.nativeGate.requiredBeforeAssemblyA, true)
})

test("P12 permits exactly one post-admission retry sequence", () => {
  assert.deepEqual(evidence.postAdmissionRuntimeSequence, [
    "PRESERVE_CURRENT_FAILURE_EVIDENCE",
    "RESTORE_SYSTEM_DISK_TO_pre-protected-bootstrap-retry-20260817T192504Z",
    "BLKDISCARD_ASSEMBLY_A_AND_B",
    "PROVE_NO_ASSEMBLY_DISK_SIGNATURES",
    "REPLAY_BOOTSTRAP_ONCE_FROM_PROTECTED_P12_COMMIT",
    "RUN_NATIVE_DOCKER_LIFECYCLE_GATE",
    "RUN_ASSEMBLY_A_ONCE_IF_GATE_PASSES",
  ])
  assert.equal(evidence.boundaries.runtimeRetryStarted, false)
  assert.equal(evidence.boundaries.vm118ChangedBySourcePackage, false)
})

test("P12 binds exact implementation validation and material review", () => {
  assert.equal(
    evidence.correction.implementationCommit,
    "a1f2068e5161dee7b86b8df00e2a7104c51b8d80",
  )
  assert.equal(
    evidence.correction.implementationTree,
    "1c86f38e8c340864ea353a9e9d0053b15e5d7e3a",
  )
  assert.equal(evidence.validation.testCounts.focused, 90)
  assert.equal(evidence.validation.testCounts.guardrails, 664)
  assert.equal(evidence.validation.testCounts.release, 212)
  assert.equal(evidence.validation.materialReview.verdict, "PASS")
  assert.equal(evidence.validation.materialReview.materialFindingsRemaining, 0)
  assert.deepEqual(evidence.validation.securityScan, {
    secretFindings: 0,
    credentialFindings: 0,
    unapprovedInternalAddressFindings: 0,
    mutableImageFindings: 0,
    unsafeConfigurationFindings: 0,
    approvedAssemblyCidrs: ["172.30.118.0/24", "172.31.118.0/24"],
  })
})
