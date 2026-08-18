import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"
import {
  assertCleanupWithinActiveDelta,
  assertNoFirewallCollision,
  normalizeNft,
  parseIptablesSave,
  planFirewallCleanup,
  statesEquivalent,
} from "./firewall-lifecycle.mjs"

const empty = {
  schema: "llm-machines.vm103-l1b-firewall-state.v1",
  iptablesV4: {},
  iptablesV6: {},
  nft: "",
  sysctls: {
    "net.ipv4.ip_forward": "0",
    "net.ipv6.conf.all.forwarding": "0",
    "net.bridge.bridge-nf-call-iptables": "1",
    "net.bridge.bridge-nf-call-ip6tables": "1",
    "net.bridge.bridge-nf-call-arptables": "1",
  },
}
const profile = {
  bridge: "llmml1ba0",
  cidr: "172.30.118.0/24",
  gateway: "172.30.118.1",
}

test("parses iptables state and normalizes volatile nft counters", () => {
  const parsed = parseIptablesSave(`
# Generated at a volatile time
*filter
:INPUT ACCEPT [1:2]
:FORWARD DROP [3:4]
-A FORWARD -j DOCKER-USER
COMMIT
`)
  assert.equal(parsed.filter.chains.INPUT.policy, "ACCEPT")
  assert.deepEqual(parsed.filter.chains.FORWARD.rules, [
    "-A FORWARD -j DOCKER-USER",
  ])
  assert.equal(
    normalizeNft("counter packets 99 bytes 800\n"),
    "counter packets 0 bytes 0",
  )
})

test("plans deletion of only the exact Docker-created tables and sysctl delta", () => {
  const active = structuredClone(empty)
  active.iptablesV4 = parseIptablesSave(`
*filter
:INPUT ACCEPT [0:0]
:FORWARD DROP [0:0]
:OUTPUT ACCEPT [0:0]
:DOCKER - [0:0]
:DOCKER-USER - [0:0]
-A FORWARD -j DOCKER-USER
-A DOCKER ! -i llmml1ba0 -o llmml1ba0 -j DROP
COMMIT
*nat
:PREROUTING ACCEPT [0:0]
:INPUT ACCEPT [0:0]
:OUTPUT ACCEPT [0:0]
:POSTROUTING ACCEPT [0:0]
:DOCKER - [0:0]
-A POSTROUTING -s 172.30.118.0/24 ! -o llmml1ba0 -j MASQUERADE
COMMIT
`)
  active.nft = "table ip filter {\n}\ntable ip nat {\n}"
  active.sysctls["net.ipv4.ip_forward"] = "1"
  const plan = planFirewallCleanup(empty, active, profile)
  assert.deepEqual(
    plan.operations.filter(({ action }) => action === "delete-nft-table"),
    [
      { action: "delete-nft-table", family: "ip", table: "filter" },
      { action: "delete-nft-table", family: "ip", table: "nat" },
    ],
  )
  assert.ok(
    plan.operations.some(
      ({ action, key, value }) =>
        action === "restore-sysctl" &&
        key === "net.ipv4.ip_forward" &&
        value === "0",
    ),
  )
})

test("preserves unrelated state and rejects collisions or foreign drift", () => {
  const baseline = structuredClone(empty)
  baseline.iptablesV4 = parseIptablesSave(`
*filter
:INPUT ACCEPT [0:0]
:FORWARD ACCEPT [0:0]
:OUTPUT ACCEPT [0:0]
-A INPUT -s 192.0.2.5/32 -j ACCEPT
COMMIT
`)
  baseline.nft = "table ip filter {\n\tchain INPUT {\n\t}\n}"
  assert.doesNotThrow(() => assertNoFirewallCollision(baseline, profile))

  const collision = structuredClone(baseline)
  collision.iptablesV4.filter.chains.DOCKER = { policy: "-", rules: [] }
  assert.throws(
    () => assertNoFirewallCollision(collision, profile),
    /Docker chain/,
  )

  const drift = structuredClone(baseline)
  drift.iptablesV4.filter.chains.INPUT.rules = []
  assert.throws(
    () => planFirewallCleanup(baseline, drift, profile),
    /removed or reordered/,
  )

  const nativeNftDrift = structuredClone(empty)
  nativeNftDrift.iptablesV4 = parseIptablesSave(`*filter
:INPUT ACCEPT [0:0]
:FORWARD ACCEPT [0:0]
:OUTPUT ACCEPT [0:0]
:DOCKER - [0:0]
COMMIT
`)
  nativeNftDrift.nft = `table ip filter {
\tchain DOCKER {
\t\tip saddr 192.0.2.5 counter packets 0 bytes 0 accept
\t}
}`
  assert.throws(
    () => planFirewallCleanup(empty, nativeNftDrift, profile),
    /unrelated rule/,
  )

  const misleadingNft = structuredClone(empty)
  misleadingNft.iptablesV4 = parseIptablesSave(`*filter
:INPUT ACCEPT [0:0]
:FORWARD ACCEPT [0:0]
:OUTPUT ACCEPT [0:0]
:DOCKER - [0:0]
COMMIT
`)
  misleadingNft.nft = `table ip filter {
\tchain DOCKER {
\t\tmeta mark 7 comment "llmml1ba0" counter packets 0 bytes 0 accept
\t}
}`
  assert.throws(
    () => planFirewallCleanup(empty, misleadingNft, profile),
    /unrelated rule/,
  )

  const misleadingComment = structuredClone(empty)
  misleadingComment.iptablesV4 = parseIptablesSave(`*filter
:INPUT ACCEPT [0:0]
:FORWARD ACCEPT [0:0]
:OUTPUT ACCEPT [0:0]
-A INPUT -m comment --comment llmml1ba0 -j ACCEPT
COMMIT
`)
  assert.throws(
    () => planFirewallCleanup(empty, misleadingComment, profile),
    /unrelated rule/,
  )
})

test("cleanup is bounded by the exact captured active delta", () => {
  const active = structuredClone(empty)
  active.iptablesV4 = parseIptablesSave(`*filter
:INPUT ACCEPT [0:0]
:FORWARD DROP [0:0]
:OUTPUT ACCEPT [0:0]
:DOCKER - [0:0]
:DOCKER-USER - [0:0]
-A FORWARD -j DOCKER-USER
-A DOCKER ! -i llmml1ba0 -o llmml1ba0 -j DROP
COMMIT
`)
  const withinCeiling = structuredClone(active)
  withinCeiling.iptablesV4.filter.chains.DOCKER.rules = []
  assert.doesNotThrow(() =>
    assertCleanupWithinActiveDelta(empty, active, withinCeiling, profile),
  )

  const exceedsCeiling = structuredClone(active)
  exceedsCeiling.iptablesV4.filter.chains["DOCKER-BRIDGE"] = {
    policy: "-",
    rules: ["-A DOCKER-BRIDGE -o llmml1ba0 -j DOCKER"],
  }
  assert.throws(
    () =>
      assertCleanupWithinActiveDelta(empty, active, exceedsCeiling, profile),
    /exceeds the captured active delta/,
  )

  const nftActive = structuredClone(empty)
  nftActive.iptablesV4 = parseIptablesSave(`*filter
:INPUT ACCEPT [0:0]
:FORWARD DROP [0:0]
:OUTPUT ACCEPT [0:0]
:DOCKER - [0:0]
:DOCKER-USER - [0:0]
-A FORWARD -j DOCKER-USER
COMMIT
`)
  nftActive.nft = `table ip filter {
\tchain DOCKER {
\t}
\n\tchain FORWARD {
\t\ttype filter hook forward priority filter; policy drop;
\t\tcounter packets 0 bytes 0 jump DOCKER-USER
\t}
\n\tchain DOCKER-USER {
\t}
}`
  const nftExceeds = structuredClone(nftActive)
  nftExceeds.iptablesV4.filter.chains["DOCKER-BRIDGE"] = {
    policy: "-",
    rules: [],
  }
  nftExceeds.nft = nftExceeds.nft.replace(
    "\tchain DOCKER {\n\t}",
    `\tchain DOCKER {
\t}\n\n\tchain DOCKER-BRIDGE {
\t}`,
  )
  assert.throws(
    () => assertCleanupWithinActiveDelta(empty, nftActive, nftExceeds, profile),
    /exceeds the captured active delta/,
  )
})

test("canonical equivalence ignores already-normalized counters but not policy", () => {
  assert.equal(statesEquivalent(empty, structuredClone(empty)), true)
  const changed = structuredClone(empty)
  changed.sysctls["net.ipv4.ip_forward"] = "1"
  assert.equal(statesEquivalent(empty, changed), false)
})

test("the exact P12 residue is bounded to four Docker-owned nftables tables", () => {
  const evidence = resolve(
    import.meta.dirname,
    "../../../docs/reduction/inference-core/evidence/vm103-l1b-p12-runtime-20260818/srv/llmm-l1b/assembly-a/evidence/p12-native-gate",
  )
  const iptablesV4 = parseIptablesSave(
    readFileSync(resolve(evidence, "iptables-save.txt"), "utf8"),
  )
  const iptablesV6 = parseIptablesSave(`*filter
:INPUT ACCEPT [0:0]
:FORWARD ACCEPT [0:0]
:OUTPUT ACCEPT [0:0]
:DOCKER - [0:0]
:DOCKER-BRIDGE - [0:0]
:DOCKER-CT - [0:0]
:DOCKER-FORWARD - [0:0]
:DOCKER-INTERNAL - [0:0]
:DOCKER-USER - [0:0]
-A FORWARD -j DOCKER-USER
-A FORWARD -j DOCKER-FORWARD
-A DOCKER-FORWARD -j DOCKER-CT
-A DOCKER-FORWARD -j DOCKER-INTERNAL
-A DOCKER-FORWARD -j DOCKER-BRIDGE
COMMIT
*nat
:PREROUTING ACCEPT [0:0]
:INPUT ACCEPT [0:0]
:OUTPUT ACCEPT [0:0]
:POSTROUTING ACCEPT [0:0]
:DOCKER - [0:0]
-A PREROUTING -m addrtype --dst-type LOCAL -j DOCKER
-A OUTPUT ! -d ::1/128 -m addrtype --dst-type LOCAL -j DOCKER
COMMIT
`)
  const active = {
    ...structuredClone(empty),
    iptablesV4,
    iptablesV6,
    nft: normalizeNft(
      readFileSync(resolve(evidence, "nft-ruleset.txt"), "utf8"),
    ),
  }
  const plan = planFirewallCleanup(empty, active, profile)
  assert.deepEqual(
    plan.operations.map(({ action, family, table }) => ({
      action,
      family,
      table,
    })),
    [
      { action: "delete-nft-table", family: "ip", table: "filter" },
      { action: "delete-nft-table", family: "ip", table: "nat" },
      { action: "delete-nft-table", family: "ip6", table: "filter" },
      { action: "delete-nft-table", family: "ip6", table: "nat" },
    ],
  )
})
