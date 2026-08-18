import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"

const script = readFileSync(
  resolve(import.meta.dirname, "run-native-docker-lifecycle-gate.sh"),
  "utf8",
)

test("native gate uses the same privileged lifecycle as Assembly A and B", () => {
  assert.match(script, /\. "\$script_dir\/docker-lifecycle\.sh"/)
  assert.match(script, /llmm_l1b_require_root/)
  assert.match(script, /llmm_l1b_load_bridge_profile "\$assembly_id"/)
  assert.match(script, /llmm_l1b_preflight/)
  assert.match(script, /llmm_l1b_create_bridge/)
  assert.match(script, /llmm_l1b_start_docker/)
  assert.match(script, /llmm_l1b_wait_for_docker/)
  assert.match(script, /llmm_l1b_verify_docker/)
  assert.match(script, /llmm_l1b_cleanup/)
})

test("native gate preserves complete Docker evidence and proves clean removal", () => {
  assert.match(script, /docker-lifecycle-\$assembly_id\.log/)
  assert.match(script, /docker-lifecycle-\$assembly_id\.json/)
  assert.match(script, /runtimeRootResidue: false/)
  assert.match(script, /rm -rf -- "\$docker_root" "\$docker_exec"/)
  assert.match(script, /rmdir "\$gate_root"/)
})
