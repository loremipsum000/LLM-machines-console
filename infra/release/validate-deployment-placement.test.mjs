import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"
import { validateRegistryAuthority } from "./validate-deployment-placement.mjs"

const authority = "registry.customer.example:5443"

test("commissioning registry authority requires exact external approval", () => {
  assert.deepEqual(validateRegistryAuthority(authority, [authority]), [])
  assert.match(
    validateRegistryAuthority(authority, ["other.customer.example"]).join("\n"),
    /not approved/,
  )
  assert.doesNotThrow(() =>
    JSON.parse(
      readFileSync(
        resolve(import.meta.dirname, "deployment-placement.schema.json"),
        "utf8",
      ),
    ),
  )
})

test("public and malformed registry authorities fail closed", () => {
  for (const malformed of [
    "https://registry.customer.example",
    "registry..customer.example",
    "-registry.customer.example",
    "registry-.customer.example",
    "registry.customer.example:65536",
    "user@registry.customer.example",
    "999.999.999.999",
    "256.1.1.1",
  ]) {
    assert.match(
      validateRegistryAuthority(malformed, [malformed]).join("\n"),
      /malformed/,
    )
  }
  assert.match(
    validateRegistryAuthority("docker.io", ["docker.io"]).join("\n"),
    /public registry authorities are forbidden/,
  )
})

test("private cloud authorities are policy decisions, not suffix guesses", () => {
  for (const approved of [
    "customer.azurecr.io",
    "123456789012.dkr.ecr.eu-central-1.amazonaws.com",
    "customer.pkg.dev",
  ]) {
    assert.deepEqual(validateRegistryAuthority(approved, [approved]), [])
  }
  assert.deepEqual(
    validateRegistryAuthority("10.20.30.40:5443", ["10.20.30.40:5443"]),
    [],
  )
})
