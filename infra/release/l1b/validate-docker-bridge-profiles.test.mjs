import assert from "node:assert/strict"
import test from "node:test"
import {
  readDockerBridgeProfiles,
  validateDockerBridgeProfiles,
} from "./validate-docker-bridge-profiles.mjs"

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

test("Assembly A and B use exact non-overlapping bridge profiles", () => {
  const document = readDockerBridgeProfiles()
  assert.deepEqual(validateDockerBridgeProfiles(document), [])
  assert.deepEqual(document.profiles, [
    {
      assembly: "A",
      bridge: "llmml1ba0",
      networkCidr: "172.30.118.0/24",
      gatewayAddress: "172.30.118.1",
      gatewayCidr: "172.30.118.1/24",
      addressPrefix: "172.30.118.",
    },
    {
      assembly: "B",
      bridge: "llmml1bb0",
      networkCidr: "172.31.118.0/24",
      gatewayAddress: "172.31.118.1",
      gatewayCidr: "172.31.118.1/24",
      addressPrefix: "172.31.118.",
    },
  ])
})

test("duplicate bridge names and overlapping networks fail closed", () => {
  const document = clone(readDockerBridgeProfiles())
  document.profiles[1].bridge = document.profiles[0].bridge
  document.profiles[1].networkCidr = document.profiles[0].networkCidr
  document.profiles[1].gatewayAddress = document.profiles[0].gatewayAddress
  document.profiles[1].gatewayCidr = document.profiles[0].gatewayCidr
  document.profiles[1].addressPrefix = document.profiles[0].addressPrefix
  const errors = validateDockerBridgeProfiles(document).join("\n")
  assert.match(errors, /Assembly B bridge profile differs/)
  assert.match(errors, /Docker bridge networks overlap/)
})

test("gateway drift and additional assemblies fail closed", () => {
  const document = clone(readDockerBridgeProfiles())
  document.profiles[0].gatewayAddress = "172.30.118.2"
  document.profiles.push(clone(document.profiles[0]))
  const errors = validateDockerBridgeProfiles(document).join("\n")
  assert.match(errors, /exactly Assembly A and B/)
})
