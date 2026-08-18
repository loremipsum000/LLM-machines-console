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
  assert.match(runner, /docker-lifecycle\.sh/)
  assert.match(runner, /llmm_l1b_load_bridge_profile "\$assembly_id"/)
  assert.match(runner, /llmm_l1b_start_docker/)
  assert.match(runner, /llmm_l1b_verify_docker/)
  assert.match(runner, /render-egress-bindings\.py/)
  assert.match(runner, /dnsmasq --keep-in-foreground/)
  assert.match(runner, /--interface "\$LLMM_L1B_BRIDGE"/)
  assert.match(runner, /--listen-address "\$LLMM_L1B_GATEWAY_ADDRESS"/)
  assert.match(runner, /--egress-transaction "\$egress_transaction"/)
  assert.match(runner, /--firewall-receipt "\$firewall_receipt"/)
  assert.doesNotMatch(runner, /--egress-resolution/)
})

test("the runner is privileged and rejects all prior lifecycle state", () => {
  assert.match(runner, /llmm_l1b_require_root/)
  assert.match(runner, /llmm_l1b_preflight/)
  assert.match(runner, /llmm_l1b_path_absent "\$temporary_root"/)
  assert.match(runner, /\[ ! -e "\$assembly_root\/run" \]/)
})

test("the runner monitors Docker through workload completion", () => {
  assert.match(runner, /llmm_l1b_wait_for_docker/)
  assert.match(runner, /llmm_l1b_run_with_docker_watch/)
  assert.match(runner, /original_status=\$\?/)
  assert.match(runner, /llmm_l1b_cleanup/)
})

test("build and import containers never use host networking", () => {
  assert.match(assembly, /"network=bridge"/)
  assert.match(assembly, /"--network=default"/)
  assert.doesNotMatch(assembly, /network=host/)
  assert.doesNotMatch(assembly, /"--network",\s*"host"/)
})
