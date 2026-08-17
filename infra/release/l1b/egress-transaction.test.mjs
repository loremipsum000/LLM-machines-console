import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import test from "node:test"
import {
  createEgressTransaction,
  createFirewallReceipt,
  validateEgressTransaction,
  validateFirewallReceipt,
} from "./egress-transaction.mjs"

const root = resolve(import.meta.dirname)
const policyBytes = readFileSync(resolve(root, "egress-allowlist.json"))
const policy = JSON.parse(policyBytes)
const bindingRenderer = readFileSync(
  resolve(root, "render-egress-bindings.py"),
  "utf8",
)

function resolution(offset = 0) {
  return {
    schema: "llm-machines.vm103-l1b-egress-resolution.v2",
    policySha256: `sha256:${createHash("sha256").update(policyBytes).digest("hex")}`,
    dnsResolver: policy.dnsResolver,
    resolutions: Object.fromEntries(
      policy.hosts.map((host, index) => [
        host,
        [`192.0.2.${index + offset + 1}`],
      ]),
    ),
  }
}

function writeResolution(directory, name, value) {
  const path = join(directory, name)
  writeFileSync(path, `${JSON.stringify(value)}\n`, { mode: 0o600 })
  return path
}

test("one transaction binds the exact resolution and rendered firewall", () => {
  const temporary = mkdtempSync(join(tmpdir(), "llmm-l1b-transaction-"))
  const transaction = join(temporary, "transaction")
  const receipt = join(temporary, "receipt.json")
  const input = writeResolution(temporary, "resolution.json", resolution())
  const created = createEgressTransaction(input, transaction)
  createFirewallReceipt(
    transaction,
    join(transaction, "vm118.firewall"),
    receipt,
  )
  const validated = validateEgressTransaction(
    transaction,
    join(transaction, "vm118.firewall"),
  )
  validateFirewallReceipt(transaction, receipt)
  assert.equal(validated.manifest.resolutionSha256, created.resolutionSha256)
  assert.equal(validated.manifest.firewallSha256, created.firewallSha256)
  const bootstrapValidation = spawnSync(
    "python3",
    [
      resolve(root, "render-egress-bindings.py"),
      "--format",
      "verify-transaction",
      "--transaction-directory",
      transaction,
      "--firewall-receipt",
      receipt,
    ],
    { encoding: "utf8" },
  )
  assert.equal(bootstrapValidation.status, 0, bootstrapValidation.stderr)
})

test("the production receipt command is hard-bound to VM118 active firewall", () => {
  assert.match(
    bindingRenderer,
    /ACTIVE_VM118_FIREWALL = pathlib\.Path\("\/etc\/pve\/firewall\/118\.fw"\)/,
  )
  assert.match(bindingRenderer, /format == "create-firewall-receipt"/)
  assert.doesNotMatch(bindingRenderer, /--installed-firewall/)
})

test("a second complete valid transaction cannot use the installed-firewall receipt from the first", () => {
  const temporary = mkdtempSync(join(tmpdir(), "llmm-l1b-transaction-"))
  const transactionA = join(temporary, "transaction-a")
  const transactionB = join(temporary, "transaction-b")
  const receiptA = join(temporary, "receipt-a.json")
  const first = writeResolution(temporary, "first.json", resolution())
  const second = writeResolution(temporary, "second.json", resolution(20))
  createEgressTransaction(first, transactionA)
  createEgressTransaction(second, transactionB)
  createFirewallReceipt(
    transactionA,
    join(transactionA, "vm118.firewall"),
    receiptA,
  )
  assert.throws(
    () => validateFirewallReceipt(transactionB, receiptA),
    /receipt differs/,
  )
  const bootstrapValidation = spawnSync(
    "python3",
    [
      resolve(root, "render-egress-bindings.py"),
      "--format",
      "verify-transaction",
      "--transaction-directory",
      transactionB,
      "--firewall-receipt",
      receiptA,
    ],
    { encoding: "utf8" },
  )
  assert.notEqual(bootstrapValidation.status, 0)
})

test("a resolution cannot be replaced inside an existing transaction", () => {
  const temporary = mkdtempSync(join(tmpdir(), "llmm-l1b-transaction-"))
  const transaction = join(temporary, "transaction")
  const first = writeResolution(temporary, "first.json", resolution())
  const second = writeResolution(temporary, "second.json", resolution(20))
  createEgressTransaction(first, transaction)
  cpSync(second, join(transaction, "egress-resolution.json"))
  assert.throws(
    () => validateEgressTransaction(transaction),
    /hash binding failed/,
  )
})

test("firewall substitution and untracked transaction files fail closed", () => {
  const temporary = mkdtempSync(join(tmpdir(), "llmm-l1b-transaction-"))
  const transaction = join(temporary, "transaction")
  const input = writeResolution(temporary, "resolution.json", resolution())
  createEgressTransaction(input, transaction)
  writeFileSync(join(transaction, "extra"), "unexpected\n")
  assert.throws(
    () => validateEgressTransaction(transaction),
    /inventory is not exact/,
  )
})
