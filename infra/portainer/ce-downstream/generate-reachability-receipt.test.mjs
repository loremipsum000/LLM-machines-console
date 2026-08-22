import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"

import {
  buildReachabilityReceipt,
  verifySourceInventory,
} from "./generate-reachability-receipt.mjs"

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "llmm-portainer-reachability-"))
  const files = new Map([
    ["app/example.ts", "export const example = true\n"],
    ["go.mod", "module example.invalid/portainer\n"],
  ])
  for (const [relative, contents] of files) {
    const file = path.join(root, relative)
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, contents)
  }
  const sums = `${[...files]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([relative, contents]) => `${sha256(contents)}  ./${relative}`)
    .join("\n")}\n`
  const pnpm = Buffer.from("locked pnpm archive\n")
  mkdirSync(path.join(root, ".llmm-build"))
  writeFileSync(path.join(root, ".llmm-build/SOURCE-SHA256SUMS"), sums)
  writeFileSync(path.join(root, ".llmm-build/pnpm-10.26.2.tgz"), pnpm)
  const contract = {
    upstream: {
      revision: "723d1a2268f0fefe70d57f5981ce15d5d1ffc679",
      tree: "9a2418f78d3f2cf4047e86b0878227b5e61d55fa",
    },
    downstream: {
      sourceInventory: {
        fileCount: files.size,
        sha256SumsSha256: sha256(sums),
      },
      pnpm: { version: "10.26.2", tarballSha256: sha256(pnpm) },
    },
  }
  return { root, contract }
}

test("exact source inventory produces an admissible reachability receipt", () => {
  const { root, contract } = fixture()
  try {
    const inventory = verifySourceInventory(root, contract)
    const receipt = buildReachabilityReceipt({
      assembly: "A",
      sourceRoot: root,
      evaluatedAt: "2026-08-23T10:00:00.000Z",
      inventory,
      validatorSha256: "a".repeat(64),
      errors: [],
      contract,
    })
    assert.equal(receipt.exitStatus, 0)
    assert.equal(receipt.containsCredentials, false)
    assert.deepEqual(receipt.errors, [])
    assert.ok(Object.values(receipt.guardStates).every(Boolean))
    assert.equal(
      receipt.source.sourceInventorySha256,
      sha256(readFileSync(path.join(root, ".llmm-build/SOURCE-SHA256SUMS"))),
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("source, assembly, expiry, and failure results fail closed", () => {
  const { root, contract } = fixture()
  try {
    writeFileSync(path.join(root, "go.mod"), "module tampered.invalid\n")
    assert.throws(
      () => verifySourceInventory(root, contract),
      /exact admitted inventory/,
    )
    const inventory = {
      fileCount: contract.downstream.sourceInventory.fileCount,
      sourceInventorySha256:
        contract.downstream.sourceInventory.sha256SumsSha256,
    }
    assert.throws(
      () =>
        buildReachabilityReceipt({
          assembly: "C",
          sourceRoot: root,
          evaluatedAt: "2026-08-23T10:00:00.000Z",
          inventory,
          validatorSha256: "a".repeat(64),
          errors: [],
          contract,
        }),
      /assembly must be A or B/,
    )
    assert.throws(
      () =>
        buildReachabilityReceipt({
          assembly: "A",
          sourceRoot: root,
          evaluatedAt: "2026-09-23T00:00:00.000Z",
          inventory,
          validatorSha256: "a".repeat(64),
          errors: [],
          contract,
        }),
      /invalid or expired/,
    )
    const failed = buildReachabilityReceipt({
      assembly: "B",
      sourceRoot: root,
      evaluatedAt: "2026-08-23T10:00:00.000Z",
      inventory,
      validatorSha256: "a".repeat(64),
      errors: ["guard failed"],
      contract,
    })
    assert.equal(failed.exitStatus, 1)
    assert.ok(Object.values(failed.guardStates).every((value) => !value))
    assert.deepEqual(failed.errors, ["guard failed"])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
