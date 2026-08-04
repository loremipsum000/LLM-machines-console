import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import test from "node:test"
import {
  generateCleanSeedEvidence,
  validateCleanDatabaseMigration,
} from "./generate-clean-seeds.mjs"

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

test("unapproved data-writing SQL fails regardless of case or layout", () => {
  const migration = readFileSync(
    resolve(root, "infra/migrations/0000_inference_core.sql"),
    "utf8",
  )
  for (const addition of [
    "\ninsert into admin.console_settings (id) values ('other');\n",
    "\nInSeRt\nInTo admin.console_settings (id) VALUES ('other');\n",
    "\ninsert into admin.console_settings (id) values ('other')\n",
    "\nupdate admin.console_settings set organization_name = 'customer-data';\n",
    "\nDeLeTe\nFrOm admin.console_settings where id = 'singleton';\n",
    "\nmerge into admin.console_settings using fixture on true when matched then delete;\n",
    "\ntruncate table admin.console_settings;\n",
    "\nselect * into admin.customer_copy from admin.console_settings;\n",
    "\ndo $$ begin raise notice 'fixture'; end $$;\n",
    "\ncall mutate_customer_state();\n",
    "\nwith changed as (select 1) update admin.console_settings set organization_name = 'x';\n",
    "\ncreate table admin.customer_copy as select * from admin.console_settings;\n",
    "\n-- reviewed default\nUPDATE admin.console_settings SET organization_name = 'x';\n",
    "\n/* reviewed default */ DELETE FROM admin.console_settings WHERE id = 'singleton';\n",
    "\n/* outer /* nested */ review */ TRUNCATE admin.console_settings;\n",
    "\n/* unterminated comment UPDATE admin.console_settings SET organization_name = 'x';\n",
  ]) {
    assert.throws(
      () => validateCleanDatabaseMigration(`${migration}${addition}`),
      /unapproved persisted row/,
    )
  }
})

test("Keycloak artifacts are loaded from the claimed source root", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "llmm-seed-root-binding-"))
  mkdirSync(join(fixtureRoot, "infra"), { recursive: true })
  cpSync(
    resolve(root, "infra/migrations"),
    join(fixtureRoot, "infra/migrations"),
    {
      recursive: true,
    },
  )
  cpSync(resolve(root, "infra/keycloak"), join(fixtureRoot, "infra/keycloak"), {
    recursive: true,
  })
  const seedPath = join(
    fixtureRoot,
    "infra/keycloak/inference-core-realm-seed.json",
  )
  const seed = JSON.parse(readFileSync(seedPath, "utf8"))
  seed.realm.accessTokenSeconds = 301
  writeFileSync(seedPath, `${JSON.stringify(seed, null, 2)}\n`)
  execFileSync("git", ["init", "--quiet", fixtureRoot])
  execFileSync("git", ["-C", fixtureRoot, "add", "."])
  execFileSync("git", [
    "-C",
    fixtureRoot,
    "-c",
    "user.name=Release Test",
    "-c",
    "user.email=release-test@example.invalid",
    "commit",
    "--quiet",
    "-m",
    "fixture",
  ])
  assert.throws(
    () =>
      generateCleanSeedEvidence(
        mkdtempSync(join(tmpdir(), "llmm-seed-root-output-")),
        { root: fixtureRoot },
      ),
    /Keycloak seed source is invalid/,
  )
})
