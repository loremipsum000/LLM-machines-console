import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"
import { validateBuilderCapability } from "../../infra/release/validate-core-image-build-contract.mjs"

const root = resolve(import.meta.dirname, "../..")
const evidence = readJson(
  "docs/reduction/inference-core/vm103-l1a-core-image-build-contract.json",
)

test("VM103-L1A binds the exact protected source-only input", () => {
  assert.equal(evidence.workPackage, "VM103-L1A")
  assert.equal(evidence.status, "SOURCE_CONTRACT_CANDIDATE")
  assert.equal(evidence.accepted, false)
  assert.equal(evidence.runtimeQualified, false)
  assert.equal(evidence.contractActivation, "INACTIVE")
  assert.equal(evidence.q0, "NOT_STARTED")
  assert.equal(evidence.genesisPublished, false)
  assert.equal(evidence.protectedInput.commit.length, 40)
  assert.equal(evidence.protectedInput.tree.length, 40)
})

test("VM103-L1A binds the credential-free build contract", () => {
  const contract = readFileSync(resolve(root, evidence.sourceContract.path))
  assert.equal(sha256(contract), evidence.sourceContract.sha256)
  assert.equal(evidence.sourceContract.componentCount, 13)
  assert.equal(evidence.sourceContract.platform, "linux/amd64")
  assert.equal(evidence.sourceContract.requiresTwoIndependentAssemblies, true)
  assert.equal(evidence.sourceContract.allowsRegistryMutation, false)
  assert.equal(evidence.sourceContract.allowsCredentials, false)
  assert.equal(evidence.sourceContract.allowsDeployment, false)
})

test("VM103-L1A records the current workstation as a fail-closed blocker", () => {
  const preflight = evidence.currentWorkstationPreflight
  const errors = validateBuilderCapability(
    {
      operatingSystem: preflight.operatingSystem,
      architecture: preflight.architecture,
      nativeArchitecture: preflight.nativeArchitecture,
      isolatedWorkspace: true,
      twoIndependentWorkRoots: preflight.twoIndependentWorkRoots,
      workspaceCapacityProven: preflight.workspaceCapacityProven,
      toolchainLockVerified: preflight.toolchainLockVerified,
      trivyDatabaseUpdatedAt: preflight.trivyDatabaseUpdatedAt,
    },
    new Date(preflight.observedAt),
  )
  assert.match(
    errors.join("\n"),
    /not Linux|not amd64|not native|two independent|unproven|unverified|72-hour/,
  )
  assert.equal(preflight.result, "BLOCKED_NO_ADMITTED_NATIVE_AMD64_BUILDER")
})

test("VM103-L1A creates no image, registry, credential, or deployment output", () => {
  assert.deepEqual(evidence.outputs, {
    ociArchivesCreated: false,
    coreImageLockCreated: false,
    registryArtifactsCreated: false,
    credentialsCreated: false,
    deploymentChanged: false,
  })
  assert.equal(evidence.nextPackage.requiresApprovedBuilder, true)
})

function readJson(path) {
  return JSON.parse(readFileSync(resolve(root, path), "utf8"))
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}
