import assert from "node:assert/strict"
import test from "node:test"
import { firecrawlNetworkPlan } from "../pre-genesis/firecrawl-network-plan.mjs"

test("F0-F2 allocates six deterministic isolated networks without Docker defaults", () => {
  const plan = firecrawlNetworkPlan("751db1b2906649d5")
  assert.deepEqual(Object.keys(plan), [
    "browser",
    "control",
    "egress",
    "proxy",
    "search",
    "bridge-access",
  ])
  assert.equal(new Set(Object.values(plan).map(({ subnet }) => subnet)).size, 6)
  for (const { gateway, subnet } of Object.values(plan)) {
    assert.match(
      subnet,
      /^100\.(?:6[4-9]|[789]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d+\/28$/,
    )
    assert.equal(
      Number(gateway.split(".").at(-1)),
      Number(subnet.match(/\.(\d+)\/28$/)[1]) + 1,
    )
  }
  assert.deepEqual(plan, firecrawlNetworkPlan("751db1b2906649d5"))
  assert.notDeepEqual(plan, firecrawlNetworkPlan("751db1b2906649d6"))
})

test("F0-F2 rejects caller-controlled malformed run IDs", () => {
  assert.throws(() => firecrawlNetworkPlan("../shared"), /16-character run ID/)
  assert.throws(
    () => firecrawlNetworkPlan("A".repeat(16)),
    /16-character run ID/,
  )
})
