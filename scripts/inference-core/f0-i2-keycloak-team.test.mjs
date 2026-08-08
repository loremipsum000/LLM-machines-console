import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { humanAdminPermissions } from "../pre-genesis/keycloak-team-permissions.mjs"

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)))

test("F0-I2 binds the existing scoped Console identity authority", async () => {
  const [wrapper, browser, authorization, teamService, evidenceText] =
    await Promise.all(
      [
        "scripts/pre-genesis/reduced-core-keycloak-identity.mjs",
        "scripts/pre-genesis/reduced-core-browser-session.mjs",
        "packages/contracts/src/inference-core-authorization.ts",
        "apps/bff/src/services/admin-team.ts",
        "docs/reduction/inference-core/f0-i2-keycloak-team.json",
      ].map((path) => readFile(resolve(root, path), "utf8")),
    )

  assert.match(
    wrapper,
    /quay\.io\/keycloak\/keycloak:26\.7\.0@sha256:[0-9a-f]{64}/,
  )
  assert.match(wrapper, /humanAdminPermissions/)
  assert.match(
    wrapper,
    /expectAdminStatus\(root, serviceToken, realmPath, 403\)/,
  )
  assert.match(wrapper, /clients\?max=1`, 403/)
  assert.match(wrapper, /role-mappings\/realm`[\s\S]*403/)
  assert.match(wrapper, /impersonation`[\s\S]*403/)
  assert.match(wrapper, /"pg_isready",[\s\S]*"--host",\s*"127\.0\.0\.1"/)
  assert.match(wrapper, /if \(!postgresReady\)/)
  assert.doesNotMatch(wrapper, /["']realm-admin["']/)
  assert.doesNotMatch(wrapper, /["']manage-users["']/)

  assert.match(browser, /--keycloak-team/)
  assert.match(browser, /LOCAL_KEYCLOAK_TEAM_MUTATION_ONLY/)
  assert.match(browser, /Team > New member/)
  assert.match(browser, /operatorMutationDenial: "passed"/)
  assert.match(browser, /assert\.ok\(rotatedPassword\.length >= 20\)/)
  assert.match(
    browser,
    /const mutationCountBefore = identityMutationJournalRowCount\(\)/,
  )
  assert.match(browser, /"final DOM"/)
  assert.doesNotMatch(browser, /completedIdentityMutationCount/)
  assert.match(
    authorization,
    /"team\.users_roles\.manage": \{ admin: true, operator: false \}/,
  )
  assert.match(
    authorization,
    /"team\.local_password\.manage": \{ admin: true, operator: false \}/,
  )
  assert.match(teamService, /executeJournaledIdentityMutation/)
  assert.match(teamService, /assertCanMutateMember/)

  const evidence = JSON.parse(evidenceText)
  assert.equal(
    evidence.schema,
    "llm-machines.pre-genesis-functional-evidence.v1",
  )
  assert.equal(evidence.workPackage, "F0-I2")
  assert.equal(evidence.status, "source-candidate-not-runtime-qualified")
  assert.equal(evidence.accepted, false)
  assert.equal(evidence.runtimeQualified, false)
  assert.equal(evidence.evidenceClass, "LOCAL_KEYCLOAK_TEAM_MUTATION_ONLY")
  assert.equal(evidence.baseCommit, "03997c40fec20a2b7303ebc14c62abdb1a5c40ca")
  assert.match(evidence.command, /reduced-core-keycloak-identity\.mjs --team$/)
  assert.match(
    evidence.exactRuntime.keycloak,
    /^quay\.io\/keycloak\/keycloak:26\.7\.0@sha256:[0-9a-f]{64}$/,
  )
  assert.match(
    evidence.exactRuntime.postgres,
    /^docker\.io\/library\/postgres:17\.6-bookworm@sha256:[0-9a-f]{64}$/,
  )
})

test("F0-I2 permission translation matches the current logical seed", async () => {
  const [seedText, wrapper] = await Promise.all([
    readFile(
      resolve(root, "infra/keycloak/inference-core-realm-seed.json"),
      "utf8",
    ),
    readFile(
      resolve(root, "scripts/pre-genesis/reduced-core-keycloak-identity.mjs"),
      "utf8",
    ),
  ])
  const seed = JSON.parse(seedText)
  const groupIds = {
    "group:Admins": "fixture-admins-id",
    "group:Operators": "fixture-operators-id",
  }
  const expected = seed.adminFineGrainedAuthorization.permissions
    .filter((permission) =>
      permission.policies.includes("console-human-admin-service-account"),
    )
    .map((permission) => ({
      ...permission,
      ...(permission.resources
        ? { resources: permission.resources.map((value) => groupIds[value]) }
        : {}),
    }))
  const actual = humanAdminPermissions({
    adminsGroupId: groupIds["group:Admins"],
    operatorsGroupId: groupIds["group:Operators"],
  })
  assert.deepEqual(normalizePermissions(actual), normalizePermissions(expected))
  assert.match(wrapper, /humanAdminPermissions\(\{/)
})

function normalizePermissions(permissions) {
  return permissions
    .map((permission) => ({
      ...permission,
      policies: [...permission.policies].sort(),
      ...(permission.resources
        ? { resources: [...permission.resources].sort() }
        : {}),
      scopes: [...permission.scopes].sort(),
    }))
    .sort((left, right) => left.name.localeCompare(right.name))
}
