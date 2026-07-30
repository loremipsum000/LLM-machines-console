import assert from "node:assert/strict"
import { test } from "node:test"
import {
  buildCoreEnvironment,
  isAgenticEnvironmentName,
} from "./run-core-command.mjs"

test("Core commands inherit only harmless process context", () => {
  const environment = buildCoreEnvironment({
    PATH: "/usr/bin",
    HOME: "/tmp/example-home",
    LANG: "C",
    GITHUB_TOKEN: "not-forwarded",
    AWS_SECRET_ACCESS_KEY: "not-forwarded",
    DATABASE_URL: "not-forwarded",
    CUSTOM_API_KEY: "not-forwarded",
    CUSTOM_SECRET: "not-forwarded",
    AGENTIC_ADAPTER_TOKEN: "not-forwarded",
  })

  assert.deepEqual(environment, {
    CI: "1",
    NEXT_TELEMETRY_DISABLED: "1",
    NO_COLOR: "1",
    HOME: "/tmp/example-home",
    LANG: "C",
    PATH: "/usr/bin",
  })
})

test("Agentic environment-name matching covers embedded boundaries", () => {
  for (const name of [
    "AGENTIC_TOKEN",
    "PREFIX_OPENCLAW_URL",
    "HERMES",
    "NEMOCLAW_GATEWAY",
    "LOCAL_OPENSHELL_MODE",
  ]) {
    assert.equal(isAgenticEnvironmentName(name), true)
  }
  assert.equal(isAgenticEnvironmentName("SOME_HERMESISH_VALUE"), false)
})
