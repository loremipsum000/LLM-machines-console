import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import test from "node:test"

const root = resolve(import.meta.dirname)
const policyBytes = readFileSync(resolve(root, "egress-allowlist.json"))
const policy = JSON.parse(policyBytes)

function resolution() {
  return {
    schema: "llm-machines.vm103-l1b-egress-resolution.v2",
    policySha256: `sha256:${createHash("sha256").update(policyBytes).digest("hex")}`,
    dnsResolver: policy.dnsResolver,
    resolutions: Object.fromEntries(
      policy.hosts.map((host, index) => [host, [`192.0.2.${index + 1}`]]),
    ),
  }
}

function render(format, value = resolution(), extra = []) {
  const directory = mkdtempSync(join(tmpdir(), "llmm-l1b-bindings-"))
  const input = join(directory, "resolution.json")
  const output = join(directory, `${format}.conf`)
  writeFileSync(input, `${JSON.stringify(value)}\n`)
  const result = spawnSync(
    "python3",
    [
      resolve(root, "render-egress-bindings.py"),
      "--resolution",
      input,
      "--format",
      format,
      "--output",
      output,
      ...extra,
    ],
    { encoding: "utf8" },
  )
  return {
    result,
    output: result.status === 0 ? readFileSync(output, "utf8") : "",
  }
}

test("hosts binding pins every exact approved hostname", () => {
  const rendered = render("hosts")
  assert.equal(rendered.result.status, 0, rendered.result.stderr)
  assert.match(
    rendered.output,
    /^# BEGIN LLM MACHINES VM103-L1B EGRESS BINDING$/m,
  )
  assert.match(rendered.output, /^192\.0\.2\.1 apk\.cgr\.dev$/m)
  assert.match(
    rendered.output,
    /^# END LLM MACHINES VM103-L1B EGRESS BINDING$/m,
  )
})

test("dnsmasq binding is exact, non-forwarding, and assembly-local", () => {
  const rendered = render("dnsmasq", resolution(), [
    "--interface",
    "llmml1ba0",
    "--listen-address",
    "172.30.118.1",
  ])
  assert.equal(rendered.result.status, 0, rendered.result.stderr)
  assert.match(rendered.output, /^no-resolv$/m)
  assert.match(rendered.output, /^no-hosts$/m)
  assert.match(rendered.output, /^interface=llmml1ba0$/m)
  assert.match(rendered.output, /^listen-address=172\.30\.118\.1$/m)
  assert.match(rendered.output, /^host-record=apk\.cgr\.dev,192\.0\.2\.1$/m)
  assert.doesNotMatch(rendered.output, /server=/)
  assert.doesNotMatch(rendered.output, /address=\//)
})

test("missing, extra, malformed, and non-canonical resolutions fail closed", () => {
  for (const mutate of [
    (value) => delete value.resolutions[policy.hosts[0]],
    (value) => {
      value.resolutions["extra.example"] = ["192.0.2.200"]
    },
    (value) => {
      value.resolutions[policy.hosts[0]] = ["999.1.1.1"]
    },
    (value) => {
      value.resolutions[policy.hosts[0]] = ["192.0.2.2", "192.0.2.1"]
    },
  ]) {
    const value = resolution()
    mutate(value)
    assert.notEqual(render("hosts", value).result.status, 0)
  }
})
