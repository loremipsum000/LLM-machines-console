import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"
import {
  validateBuildCapability,
  validateCoreImageBuildContract,
  verifyCheckedInCoreImageBuildContract,
} from "./validate-core-image-build-contract.mjs"

const root = resolve(import.meta.dirname, "../..")
const contract = JSON.parse(
  readFileSync(
    resolve(root, "infra/release/core-image-build-contract.json"),
    "utf8",
  ),
)

function changed(mutate) {
  const value = structuredClone(contract)
  mutate(value)
  return validateCoreImageBuildContract(value, root).join("\n")
}

test("checked-in Core image build contract passes", () => {
  assert.deepEqual(verifyCheckedInCoreImageBuildContract(root), [])
})

test("release source and native amd64 build requirements fail closed", () => {
  assert.match(
    changed((value) => {
      value.releaseSource.commit = "f10ebff28840979b716d3966f55702aee22b3070"
    }),
    /checked-out protected input/,
  )
  assert.match(
    changed((value) => {
      value.buildEnvironment.nativeArchitectureRequired = false
    }),
    /build environment admission/,
  )
  assert.match(
    changed((value) => {
      value.buildEnvironment.emulationQualifiesForOutputAdmission = true
    }),
    /build environment admission/,
  )
  assert.match(
    changed((value) => {
      value.buildEnvironment.freshTrivyDatabaseMaximumAgeHours = 96
    }),
    /build environment admission/,
  )
})

test("component omissions, substitutions, and unsafe outputs fail closed", () => {
  assert.match(
    changed((value) => {
      value.components.pop()
    }),
    /component order/,
  )
  assert.match(
    changed((value) => {
      value.components.find(({ id }) => id === "console-web").dockerfile =
        "Dockerfile"
    }),
    /Product build binding/,
  )
  assert.match(
    changed((value) => {
      value.components.find(({ id }) => id === "litellm").sourcePackage =
        "upstream/latest.json"
    }),
    /mutable|downstream/,
  )
  assert.match(
    changed((value) => {
      value.components.find(
        ({ id }) => id === "firecrawl-search",
      ).sourcePackageInputId = "firecrawl-api"
    }),
    /locked source-platform import/,
  )
  assert.match(
    changed((value) => {
      value.outputs.registryPushAllowed = true
    }),
    /output admission/,
  )
})

test("build capability admits only a fresh isolated native amd64 lane", () => {
  const now = new Date("2026-08-17T12:00:00Z")
  const capability = {
    operatingSystem: "linux",
    architecture: "amd64",
    nativeArchitecture: true,
    isolatedWorkspace: true,
    twoIndependentWorkRoots: true,
    workspaceCapacityProven: true,
    toolchainLockVerified: true,
    trivyDatabaseUpdatedAt: "2026-08-16T12:00:00Z",
  }
  assert.deepEqual(validateBuildCapability(capability, now), [])

  const workstation = {
    ...capability,
    operatingSystem: "darwin",
    architecture: "arm64",
    nativeArchitecture: false,
    twoIndependentWorkRoots: false,
    workspaceCapacityProven: false,
    toolchainLockVerified: false,
    trivyDatabaseUpdatedAt: "2026-08-13T13:03:34.300Z",
  }
  assert.match(
    validateBuildCapability(workstation, now).join("\n"),
    /not Linux|not amd64|not native|two independent|unproven|unverified|72-hour/,
  )
})
