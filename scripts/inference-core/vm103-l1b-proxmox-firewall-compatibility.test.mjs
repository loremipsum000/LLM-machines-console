import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"
import { renderFirewall } from "../../infra/release/l1b/render-proxmox-firewall.mjs"

const root = resolve(import.meta.dirname, "../..")
const evidence = JSON.parse(
  readFileSync(
    resolve(
      root,
      "docs/reduction/inference-core/vm103-l1b-proxmox-firewall-compatibility.json",
    ),
    "utf8",
  ),
)

test("L1B firewall successor preserves inactive preboot governance", () => {
  assert.equal(evidence.workPackage, "VM103-L1B-P1")
  assert.equal(evidence.status, "SOURCE_SECURITY_SUCCESSOR_CANDIDATE")
  assert.equal(evidence.accepted, false)
  assert.equal(evidence.runtimeQualified, false)
  assert.equal(evidence.contractActivation, "INACTIVE")
  assert.equal(evidence.q0, "NOT_STARTED")
  assert.equal(evidence.runtimeObservation.vmState, "STOPPED_NOT_INSTALLED")
  assert.equal(evidence.runtimeObservation.guestBooted, false)
})

test("rendered VM firewall uses only supported default-deny policy options", () => {
  const policyBytes = readFileSync(
    resolve(root, "infra/release/l1b/egress-allowlist.json"),
  )
  const policy = JSON.parse(policyBytes)
  const profile = {
    network: { operatorSsh: { sourceCidr: "10.93.74.0/24" } },
  }
  const resolutions = Object.fromEntries(
    policy.hosts.map((host, index) => [host, [`203.0.113.${index + 1}`]]),
  )
  const rendered = renderFirewall(
    policy,
    {
      schema: "llm-machines.vm103-l1b-egress-resolution.v3",
      policySha256: `sha256:${createHash("sha256").update(policyBytes).digest("hex")}`,
      dnsResolver: policy.dnsResolver,
      addressOrder: policy.addressOrder,
      resolutions,
    },
    profile,
  )
  assert.match(rendered, /^policy_in: DROP$/m)
  assert.match(rendered, /^policy_out: DROP$/m)
  assert.doesNotMatch(rendered, /^policy_forward:/m)
  assert.equal(
    rendered.split("\n").filter((line) => /^(?:IN|OUT) ACCEPT /.test(line))
      .length,
    7,
  )
})
