import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"
import { firecrawlNetworkPlan } from "../pre-genesis/firecrawl-network-plan.mjs"

const root = resolve(import.meta.dirname, "../..")

test("VM103 candidate Core and LiteLLM networks do not use Docker default pools", () => {
  const runId = "751db1b2906649d5"
  const plan = firecrawlNetworkPlan(runId)
  assert.notEqual(plan.proxy.subnet, plan["bridge-access"].subnet)

  for (const [path, variable] of [
    ["scripts/pre-genesis/reduced-core-integrated.mjs", "coreNetwork"],
    [
      "scripts/pre-genesis/reduced-core-litellm-integration.mjs",
      "liteLlmNetwork",
    ],
  ]) {
    const source = readFileSync(resolve(root, path), "utf8")
    assert.match(source, new RegExp(`"--gateway",\\s+${variable}\\.gateway`))
    assert.match(source, new RegExp(`"--subnet",\\s+${variable}\\.subnet`))
  }
})
