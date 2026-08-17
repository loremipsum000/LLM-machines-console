import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"

const root = resolve(import.meta.dirname)
const runner = readFileSync(
  resolve(root, "run-independent-assembly.sh"),
  "utf8",
)
const assembly = readFileSync(resolve(root, "run-core-assembly.mjs"), "utf8")

test("each assembly binds Docker to its own exact non-forwarding DNS service", () => {
  assert.match(runner, /--dns "\$bridge_ip"/)
  assert.match(runner, /render-egress-bindings\.py/)
  assert.match(runner, /dnsmasq --keep-in-foreground/)
  assert.match(runner, /--egress-resolution "\$egress_resolution"/)
})

test("build and import containers never use host networking", () => {
  assert.match(assembly, /"network=bridge"/)
  assert.match(assembly, /"--network=default"/)
  assert.doesNotMatch(assembly, /network=host/)
  assert.doesNotMatch(assembly, /"--network",\s*"host"/)
})
