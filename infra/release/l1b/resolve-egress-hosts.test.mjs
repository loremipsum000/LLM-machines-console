import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import test from "node:test"

const root = resolve(import.meta.dirname)
const policy = JSON.parse(
  readFileSync(resolve(root, "egress-allowlist.json"), "utf8"),
)

function fixtureDig(directory) {
  const path = join(directory, "dig")
  writeFileSync(
    path,
    '#!/bin/sh\nprintf "%s\\n" "$@" >> "$FAKE_DIG_LOG"\nprintf "example.invalid.\\n192.0.2.109\\n192.0.2.2\\n192.0.2.34\\n192.0.2.109\\n"\n',
    { mode: 0o700 },
  )
  chmodSync(path, 0o700)
  return path
}

test("egress hosts resolve only through the declared deployment resolver", () => {
  const directory = mkdtempSync(join(tmpdir(), "llmm-l1b-resolver-"))
  const output = join(directory, "resolution.json")
  const log = join(directory, "dig.log")
  const result = spawnSync(
    "python3",
    [
      resolve(root, "resolve-egress-hosts.py"),
      "--dig",
      fixtureDig(directory),
      "--output",
      output,
    ],
    { encoding: "utf8", env: { ...process.env, FAKE_DIG_LOG: log } },
  )
  assert.equal(result.status, 0, result.stderr)

  const resolution = JSON.parse(readFileSync(output, "utf8"))
  assert.equal(resolution.schema, "llm-machines.vm103-l1b-egress-resolution.v3")
  assert.equal(resolution.dnsResolver, policy.dnsResolver)
  assert.equal(resolution.addressOrder, "IPV4_NUMERIC_ASCENDING")
  for (const host of policy.hosts) {
    assert.deepEqual(resolution.resolutions[host], [
      "192.0.2.2",
      "192.0.2.34",
      "192.0.2.109",
    ])
  }

  const invocations = readFileSync(log, "utf8").split("\n")
  assert.equal(
    invocations.filter((line) => line === `@${policy.dnsResolver}`).length,
    policy.hosts.length,
  )
  assert.equal(
    invocations.filter((line) => line === "A").length,
    policy.hosts.length,
  )
})
