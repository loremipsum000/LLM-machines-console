import assert from "node:assert/strict"
import test from "node:test"
import { readL1bSource, validateL1bSource } from "./validate-source.mjs"

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

test("checked-in VM103-L1B source profile is exact and credential-free", () => {
  assert.deepEqual(validateL1bSource(readL1bSource()), [])
})

test("mutable or incomplete tool identities fail closed", () => {
  const source = clone(readL1bSource())
  source.toolchain.containerTools[0].indexDigest = "latest"
  source.toolchain.dockerPackages[0].sha256 = "missing"
  assert.match(
    validateL1bSource(source).join("\n"),
    /buildkit is not immutable|docker-ce is not immutable/,
  )
})

test("broadened egress and shared assembly state fail closed", () => {
  const source = clone(readL1bSource())
  source.egress.defaultPolicy = "ACCEPT"
  source.egress.hosts.push("*.example.com")
  source.profile.assembly.sharedCache = true
  const errors = validateL1bSource(source).join("\n")
  assert.match(errors, /egress allowlist/)
  assert.match(errors, /independent assembly/)
})
