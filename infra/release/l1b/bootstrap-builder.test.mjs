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

test("bootstrap keeps Debian package retrieval inside the HTTPS-only IPv4 policy", () => {
  assert.match(
    script,
    /s\|http:\/\/security\.debian\.org\/\|https:\/\/security\.debian\.org\/\|g/,
  )
  assert.match(script, /Acquire::ForceIPv4 "true";/)
  assert.match(script, /APT::Update::Error-Mode "any";/)
  assert.match(script, /prohibited tcp\/80 egress/)
})
