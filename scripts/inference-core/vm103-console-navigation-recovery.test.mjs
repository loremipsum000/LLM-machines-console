import assert from "node:assert/strict"
import { test } from "node:test"
import { classifyConsoleNavigationAttempt } from "../pre-genesis/console-navigation-recovery.mjs"

const baseline = {
  actualUrl: "https://console.lab.llm-machines.com/settings",
  consoleOrigin: "https://console.lab.llm-machines.com",
  expectedPath: "/settings",
  headingVisible: true,
  responseStatus: 200,
}

test("accepts only the exact recovered Console path and heading", () => {
  assert.deepEqual(classifyConsoleNavigationAttempt(baseline), {
    reason: "target rendered",
    status: "READY",
  })
})

test("retries bounded identity recovery and stale client navigation", () => {
  for (const attempt of [
    { ...baseline, responseStatus: 503 },
    {
      ...baseline,
      actualUrl: "https://console.lab.llm-machines.com/auth/unavailable",
    },
    {
      ...baseline,
      actualUrl: "https://console.lab.llm-machines.com/team",
    },
    { ...baseline, headingVisible: false },
  ]) {
    assert.equal(classifyConsoleNavigationAttempt(attempt).status, "RETRY")
  }
})

test("fails closed on session loss, cross-origin redirects, and other server errors", () => {
  for (const attempt of [
    { ...baseline, responseStatus: 500 },
    {
      ...baseline,
      actualUrl: "https://console.lab.llm-machines.com/auth/signin",
    },
    { ...baseline, actualUrl: "https://attacker.invalid/settings" },
  ]) {
    assert.equal(classifyConsoleNavigationAttempt(attempt).status, "FAIL")
  }
})
