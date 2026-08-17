import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"

const directory = import.meta.dirname
const script = readFileSync(resolve(directory, "bootstrap-builder.sh"), "utf8")
const toolchain = JSON.parse(
  readFileSync(resolve(directory, "toolchain-lock.json"), "utf8"),
)

test("bootstrap enumerates every locked host and Docker input before installation", () => {
  const expected = [
    ...toolchain.hostTools.filter(({ url }) => url).map(({ id }) => id),
    ...toolchain.dockerPackages.map(({ id }) => id),
  ]
  assert.deepEqual(expected, [
    "node",
    "pnpm",
    "dnsmasq",
    "docker-ce",
    "docker-ce-cli",
    "containerd.io",
    "docker-buildx-plugin",
  ])
  assert.match(
    script,
    /jq -ce '\[\(\.hostTools\[\] \| select\(\.url != null\)\), \.dockerPackages\[\]\] \| \.\[\]'/,
  )
  assert.match(script, /done < "\$locked_inputs"/)
})

test("bootstrap binds host resolution to the exact reviewed firewall observation", () => {
  assert.match(script, /--egress-transaction/)
  assert.match(script, /--firewall-receipt/)
  assert.doesNotMatch(script, /--egress-resolution/)
  assert.match(script, /render-egress-bindings\.py/)
  assert.match(script, /# BEGIN LLM MACHINES VM103-L1B EGRESS BINDING/)
  assert.match(script, /--format verify-transaction/)
  assert.match(script, /--format verify-system/)
  assert.match(script, /\.llmm-l1b-egress-transaction/)
  assert.match(script, /vm118\.firewall/)
  assert.match(script, /transaction\.json/)
  assert.match(script, /firewall-receipt\.json/)
  assert.match(
    script,
    /--transaction-directory "\$bound_transaction"[\s\S]*--firewall-receipt "\$bound_receipt"/,
  )
})

test("bootstrap installs the content-addressed dnsmasq package", () => {
  const dnsmasq = toolchain.hostTools.find(({ id }) => id === "dnsmasq")
  assert.equal(dnsmasq.version, "2.91-1+deb13u1")
  assert.equal(
    dnsmasq.sha256,
    "32fe2686b0adbe31dbedfadeea7eee8e47785e0ab39ffa9f655ca1bd7ba25d55",
  )
  assert.match(
    script,
    /apt-get install -y --no-install-recommends \$docker_debs "\$dnsmasq_deb"/,
  )
})

test("bootstrap keeps Debian package retrieval inside the HTTPS-only IPv4 policy", () => {
  assert.match(
    script,
    /s\|http:\/\/security\.debian\.org\/\|https:\/\/security\.debian\.org\/\|g/,
  )
  assert.match(script, /Acquire::ForceIPv4 "true";/)
  assert.match(script, /APT::Update::Error-Mode "any";/)
  assert.match(script, /prohibited tcp\/80 egress/)
})

test("bootstrap accepts the preseed-owned authorized key without self-copy", () => {
  assert.match(script, /if \[ "\$ssh_public_key" -ef "\$authorized_keys" \]/)
  assert.match(script, /chmod 0600 "\$authorized_keys"/)
  assert.match(script, /install -m 0600 "\$ssh_public_key" "\$authorized_keys"/)
  assert.match(script, /chown -R dberisha:dberisha \/home\/dberisha\/\.ssh/)
})
