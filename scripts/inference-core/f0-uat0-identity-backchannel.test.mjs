import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { resolveIdentityBackchannelTarget } from "../pre-genesis/identity-backchannel-target.mjs"

const read = (path) => readFileSync(path, "utf8")

test("F0-UAT0 keeps local identity fixtures on their issuer port", () => {
  assert.deepEqual(
    resolveIdentityBackchannelTarget({
      issuer: "https://identity.llmm.test:18443/realms/llm-machines",
    }),
    { host: "127.0.0.1", port: 18443 },
  )
})

test("F0-UAT0 routes only the placed identity backchannel to the private edge", () => {
  assert.deepEqual(
    resolveIdentityBackchannelTarget({
      issuer: "https://identity.lab.llm-machines.com/realms/llm-machines",
      targetHost: "10.123.45.67",
      targetPort: "18443",
    }),
    { host: "10.123.45.67", port: 18443 },
  )

  for (const target of [
    { targetHost: "10.123.45.67" },
    { targetPort: "18443" },
    { targetHost: "127.0.0.1", targetPort: "18443" },
    { targetHost: "203.0.113.10", targetPort: "18443" },
    { targetHost: "edge.example.test", targetPort: "18443" },
    { targetHost: "10.123.45.67", targetPort: "0" },
    { targetHost: "10.123.45.67", targetPort: "65536" },
  ]) {
    assert.throws(() =>
      resolveIdentityBackchannelTarget({
        issuer: "https://identity.lab.llm-machines.com/realms/llm-machines",
        ...target,
      }),
    )
  }
})

test("F0-UAT0 preserves the public issuer and SNI across the private backchannel", () => {
  const browser = read("scripts/pre-genesis/reduced-core-browser-session.mjs")
  const fixture = read(
    "scripts/pre-genesis/reduced-core-session-bff-fixture.mts",
  )

  assert.match(
    browser,
    /F0_S1_IDENTITY_TARGET_HOST:\s+founderUatPlacement\.edgeBindAddress/,
  )
  assert.match(
    browser,
    /F0_S1_IDENTITY_TARGET_PORT: String\(founderUatPlacement\.edgePort\)/,
  )
  assert.match(fixture, /host: target\.host/)
  assert.match(fixture, /port: target\.port/)
  assert.match(fixture, /servername: url\.hostname/)
  assert.match(fixture, /url\.origin !== issuerUrl\.origin/)
})
