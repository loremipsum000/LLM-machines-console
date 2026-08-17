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
  source.toolchain.hostTools.find(({ id }) => id === "pnpm").sha256 = "missing"
  const errors = validateL1bSource(source).join("\n")
  assert.match(errors, /buildkit is not immutable/)
  assert.match(errors, /docker-ce is not immutable/)
  assert.match(errors, /pnpm host tool is not content-addressed/)
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

test("the shared IPv4 canonicalization rule cannot drift", () => {
  const source = clone(readL1bSource())
  source.egress.addressOrder = "LEXICAL"
  assert.match(
    validateL1bSource(source).join("\n"),
    /egress allowlist is not exact/,
  )
})

test("installation requires the exact verified read-only media attachment", () => {
  const source = clone(readL1bSource())
  source.profile.installationMedia.attachment.bus = "sata0"
  source.profile.installationMedia.attachment.removeAfterInstallation = false
  assert.match(
    validateL1bSource(source).join("\n"),
    /installation media and toolchain lock disagree/,
  )
})

test("installation requires a single attached system disk", () => {
  const source = clone(readL1bSource())
  source.profile.installationDiskBoundary.assemblyVolumesDetachedDuringInstallation = false
  assert.match(
    validateL1bSource(source).join("\n"),
    /installer disk boundary differs/,
  )
})
