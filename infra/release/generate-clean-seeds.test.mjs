import assert from "node:assert/strict"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import test from "node:test"
import { generateCleanSeedEvidence } from "./generate-clean-seeds.mjs"

const root = resolve(import.meta.dirname, "../..")

test("clean database and Keycloak seed evidence is deterministic", () => {
  const first = mkdtempSync(join(tmpdir(), "llmm-clean-seed-first-"))
  const second = mkdtempSync(join(tmpdir(), "llmm-clean-seed-second-"))
  const firstResult = generateCleanSeedEvidence(first, { root })
  const secondResult = generateCleanSeedEvidence(second, { root })
  assert.deepEqual(firstResult, secondResult)
  for (const path of [
    "seeds/clean-database-seed.json",
    "seeds/clean-keycloak-seed.json",
  ]) {
    assert.deepEqual(
      readFileSync(join(first, path)),
      readFileSync(join(second, path)),
    )
  }
})

test("clean seeds contain no users, credentials, customer data, or runtime claims", () => {
  const output = mkdtempSync(join(tmpdir(), "llmm-clean-seed-policy-"))
  generateCleanSeedEvidence(output, { root })
  const database = JSON.parse(
    readFileSync(join(output, "seeds/clean-database-seed.json"), "utf8"),
  )
  const keycloak = JSON.parse(
    readFileSync(join(output, "seeds/clean-keycloak-seed.json"), "utf8"),
  )
  assert.equal(database.status, "PACKAGED_UNQUALIFIED")
  assert.equal(database.containsCredentials, false)
  assert.equal(database.containsCustomerData, false)
  assert.equal(database.initialStateRows.length, 6)
  assert.doesNotMatch(database.migration.sql, /\bcopy\s+\S+\s+from\b/i)
  assert.equal(keycloak.status, "PACKAGED_UNQUALIFIED")
  assert.equal(keycloak.containsCredentials, false)
  assert.equal(keycloak.containsUsers, false)
  assert.equal(keycloak.commissioning.oneTimeValuesGeneratedAtRuntime, true)
  assert.equal(keycloak.commissioning.nativeAdminConsoleCustomerAccess, false)
  assert.equal(keycloak.commissioning.grafanaCustomerAccess, "DEFERRED_V1")
  assert.deepEqual(keycloak.documents.humanRealm.document.users, [])
  assert.deepEqual(keycloak.documents.applicationRealm.document.users, [])
})

test("clean seed output is create-only", () => {
  const output = mkdtempSync(join(tmpdir(), "llmm-clean-seed-exclusive-"))
  generateCleanSeedEvidence(output, { root })
  assert.throws(() => generateCleanSeedEvidence(output, { root }), /EEXIST/)
})
