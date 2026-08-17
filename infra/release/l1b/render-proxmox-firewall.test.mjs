import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"
import { renderFirewall } from "./render-proxmox-firewall.mjs"

const root = resolve(import.meta.dirname)
const policyBytes = readFileSync(resolve(root, "egress-allowlist.json"))
const policy = JSON.parse(policyBytes)
const profile = JSON.parse(readFileSync(resolve(root, "builder-profile.json")))

function resolution() {
  return {
    schema: "llm-machines.vm103-l1b-egress-resolution.v1",
    policySha256: `sha256:${createHash("sha256").update(policyBytes).digest("hex")}`,
    resolutions: Object.fromEntries(
      policy.hosts.map((host, index) => [host, [`192.0.2.${index + 1}`]]),
    ),
  }
}

test("rendered VM118 firewall is default-deny and VPN-key-SSH only", () => {
  const rendered = renderFirewall(policy, resolution(), profile)
  assert.match(rendered, /policy_in: DROP/)
  assert.match(rendered, /policy_out: DROP/)
  assert.doesNotMatch(rendered, /^policy_forward:/m)
  assert.match(rendered, /IN ACCEPT -source 10\.93\.74\.0\/24 -p tcp -dport 22/)
  assert.match(rendered, /OUT ACCEPT -dest \+llmm-l1b-egress -p tcp -dport 443/)
  assert.doesNotMatch(rendered, /policy_(?:in|out): ACCEPT/)
})

test("missing hostname resolution fails closed", () => {
  const value = resolution()
  delete value.resolutions[policy.hosts[0]]
  assert.throws(() => renderFirewall(policy, value, profile), /exact allowlist/)
})
