import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import {
  prepareKeycloakImportRoot,
  writeKeycloakRealmImport,
} from "../pre-genesis/keycloak-import-root.mjs"
import {
  humanAdminPermissions,
  integratedHumanAdminPermissions,
} from "../pre-genesis/keycloak-team-permissions.mjs"

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
  assert.match(wrapper, /integratedHumanAdminPermissions/)
  assert.match(wrapper, /verifyCommissionedUser/)
  assert.match(wrapper, /expectedUser\.subject = user\.id/)
  assert.match(wrapper, /AUTHORIZATION_CODE_PKCE_PENDING/)
  const browserConfigStart = wrapper.indexOf(
    "  await writeFile(\n    browserConfigFile,",
  )
  const browserConfigEnd = wrapper.indexOf(
    "  if (serviceControl)",
    browserConfigStart,
  )
  assert.ok(browserConfigStart >= 0)
  assert.ok(browserConfigEnd > browserConfigStart)
  const browserConfigBlock = wrapper.slice(browserConfigStart, browserConfigEnd)
  assert.match(browserConfigBlock, /container: containerName,/)
  assert.match(browserConfigBlock, /commissioning/)
  assert.match(browserConfigBlock, /dockerContext,/)
  assert.match(browserConfigBlock, /edgePort,/)
  assert.match(browserConfigBlock, /upstreamPort,/)
  assert.match(
    wrapper,
    /expectAdminStatus\(root, serviceToken, realmPath, 403\)/,
  )
  assert.match(wrapper, /clients\?max=1`, 403/)
  assert.match(wrapper, /role-mappings\/realm`[\s\S]*403/)
  assert.match(wrapper, /impersonation`[\s\S]*403/)
  assert.match(wrapper, /"pg_isready",[\s\S]*"--host",\s*"127\.0\.0\.1"/)
  assert.match(wrapper, /if \(!postgresReady\)/)
  assert.ok(
    wrapper.indexOf("await configureTeamAuthority(upstreamPort)") <
      wrapper.indexOf("serviceControl.controlFile"),
  )
  assert.doesNotMatch(wrapper, /["']realm-admin["']/)
  assert.doesNotMatch(wrapper, /["']manage-users["']/)

  assert.match(browser, /--keycloak-team/)
  assert.match(browser, /LOCAL_KEYCLOAK_TEAM_MUTATION_ONLY/)
  assert.match(browser, /Team > New member/)
  assert.match(browser, /operatorMutationDenial: "passed"/)
  assert.match(browser, /assert\.ok\(rotatedPassword\.length >= 20\)/)
  assert.match(browser, /async function assertKeycloakPasswordOutcome/)
  assert.match(
    browser,
    /proveKeycloakTeamConsoleFlow\(\{[\s\S]*synchronizeClock: synchronizeFixtureClock/,
  )
  assert.match(browser, /await probe\.waitForURL/)
  assert.doesNotMatch(
    browser,
    /await probe\.locator\("#kc-totp-settings-form"\)\.waitFor/,
  )
  assert.match(browser, /accepted: false,[\s\S]*password: firstPassword/)
  assert.match(browser, /accepted: true,[\s\S]*password: rotatedPassword/)
  assert.match(
    browser,
    /assert\.equal\(summary\.completedIdentityMutations, 4\)/,
  )
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
  assert.match(wrapper, /integratedHumanAdminPermissions\(\{/)
  assert.match(wrapper, /name: "appliance-user-administration-callers"/)
  assert.match(wrapper, /decisionStrategy: "AFFIRMATIVE"/)
  assert.match(
    wrapper,
    /policies: \[serviceAccountPolicy\.id, customerAdminPolicy\.id\]/,
  )
  assert.doesNotMatch(wrapper, /function customerAdminPermissions/)
  assert.equal(
    wrapper.match(/name: "customer-admin-manage-all-users"/g)?.length ?? 0,
    0,
  )
  assert.match(wrapper, /name: "default-roles-llm-machines"/)
  assert.match(wrapper, /name: "offline_access"/)
  assert.match(wrapper, /optionalClientScopes: \["profile", "email"\]/)
  assert.match(wrapper, /"claim\.name": "email"/)
  assert.match(wrapper, /"claim\.name": "email_verified"/)
  assert.match(wrapper, /"claim\.name": "preferred_username"/)
  assert.match(wrapper, /"userinfo\.token\.claim": "true"/)
  assert.match(wrapper, /@fixture\.example\.com/)
  assert.doesNotMatch(wrapper, /@fixture\.invalid/)
  assert.doesNotMatch(
    wrapper,
    /function simpleScope\(name\) \{[\s\S]*protocolMappers: \[\]/,
  )
  assert.doesNotMatch(wrapper, /optionalClientScopes: \[[^\]]*offline_access/)
})

test("F0-I2 preserves blocked incremental commissioning state", async () => {
  const wrapper = await readFile(
    resolve(root, "scripts/pre-genesis/reduced-core-keycloak-identity.mjs"),
    "utf8",
  )
  assert.match(wrapper, /F0_C1_PRESERVE_FAILURE_STATE/)
  assert.match(wrapper, /status: "BLOCKED"/)
  assert.match(wrapper, /diagnosticState:/)
  assert.match(wrapper, /const preserve = preserveFailureState && failure/)
  assert.doesNotMatch(
    wrapper,
    /password:.*diagnosticState|secret:.*diagnosticState/,
  )
})

test("F0-I2 composes non-overlapping native and Console FGAP scopes", () => {
  const permissions = integratedHumanAdminPermissions({
    adminsGroupId: "fixture-admins-id",
    operatorsGroupId: "fixture-operators-id",
  })
  const users = permissions.filter(
    (permission) => permission.resourceType === "Users",
  )
  assert.deepEqual(
    users.map(({ name, policies, scopes }) => ({ name, policies, scopes })),
    [
      {
        name: "appliance-user-administration-manage-all-users",
        policies: ["appliance-user-administration-callers"],
        scopes: ["view", "manage"],
      },
      {
        name: "console-human-admin-manage-all-user-membership",
        policies: ["console-human-admin-service-account"],
        scopes: ["manage-group-membership"],
      },
    ],
  )
  for (const group of ["Admins", "Operators"]) {
    const shared = permissions.find(
      ({ name }) =>
        name === `appliance-user-administration-view-${group}-group`,
    )
    const service = permissions.find(
      ({ name }) => name === `console-human-admin-manage-${group}-group`,
    )
    assert.deepEqual(shared?.policies, [
      "appliance-user-administration-callers",
    ])
    assert.deepEqual(shared?.scopes, ["view", "view-members"])
    assert.deepEqual(service?.policies, ["console-human-admin-service-account"])
    assert.deepEqual(service?.scopes, [
      "manage-members",
      "manage-membership",
      "manage-membership-of-members",
    ])
  }
})

test("F0-I2 renders a Keycloak-readable import root under a restrictive umask", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "llmm-f0-i2-import-root-"))
  const importRoot = join(stateRoot, "import")
  const realmFile = join(importRoot, "llm-machines-realm.json")
  const previousUmask = process.umask(0o077)
  try {
    await prepareKeycloakImportRoot(importRoot)
    await writeKeycloakRealmImport(realmFile, "{}\n")
    assert.equal((await stat(importRoot)).mode & 0o777, 0o755)
    assert.equal((await stat(realmFile)).mode & 0o777, 0o644)
  } finally {
    process.umask(previousUmask)
    await rm(stateRoot, { force: true, recursive: true })
  }
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
