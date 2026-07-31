import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import {
  loadKeycloakArtifacts,
  validateApplicationCommissioningPlan,
  validateApplicationKeycloakSeed,
  validateCommissioningPlan,
  validateKeycloakSeed,
  validateRealmIsolation,
  verificationReport,
} from "./pr05-keycloak-seed.mjs"

const artifacts = loadKeycloakArtifacts()

test("the reviewed logical Keycloak seed and commissioning plan pass", () => {
  assert.deepEqual(validateKeycloakSeed(artifacts.seed), [])
  assert.deepEqual(validateCommissioningPlan(artifacts.commissioning), [])
  assert.deepEqual(
    validateApplicationKeycloakSeed(artifacts.applicationSeed),
    [],
  )
  assert.deepEqual(
    validateApplicationCommissioningPlan(artifacts.applicationCommissioning),
    [],
  )
  assert.deepEqual(
    validateRealmIsolation(artifacts.seed, artifacts.applicationSeed),
    [],
  )
  assert.match(verificationReport(artifacts).seed.sha256, /^[a-f0-9]{64}$/)
  assert.match(
    verificationReport(artifacts).applicationSeed.sha256,
    /^[a-f0-9]{64}$/,
  )
  assert.equal(verificationReport(artifacts).result, "pass")
})

test("Keycloak 26.6.0 and FGAP v2 are mandatory without a custom plugin", () => {
  assert.deepEqual(artifacts.seed.keycloakRuntime, {
    customProviderPlugins: [],
    minimumVersion: "26.6.0",
    requiredFeatures: ["admin-fine-grained-authz:v2"],
  })
  assert.equal(artifacts.seed.realm.adminPermissionsEnabled, true)

  const seed = clone(artifacts.seed)
  seed.keycloakRuntime.minimumVersion = "26.5.5"
  seed.keycloakRuntime.requiredFeatures = ["admin-fine-grained-authz:v1"]
  seed.keycloakRuntime.customProviderPlugins = ["operator-protection.jar"]
  assert.match(
    validateKeycloakSeed(seed).join("\n"),
    /minimum Keycloak version|required Keycloak features|custom Keycloak plugins/,
  )
})

test("the seed is secret-free and has no bootstrap users", () => {
  assert.equal(artifacts.seed.metadata.containsCredentials, false)
  assert.deepEqual(artifacts.seed.users, [])
  for (const client of artifacts.seed.clients) {
    assert.equal(client.credentialIncluded, false)
  }
})

test("customer identity administration can never target master", () => {
  const seed = clone(artifacts.seed)
  seed.realm.name = "master"
  seed.realm.masterRealm = true
  assert.match(validateKeycloakSeed(seed).join("\n"), /master/)
})

for (const broadRole of ["realm-admin", "manage-users", "manage-realm"]) {
  test(`customer Admin cannot receive ${broadRole}`, () => {
    const seed = clone(artifacts.seed)
    seed.roles[0].clientRoleMappings["realm-management"].push(broadRole)
    assert.match(validateKeycloakSeed(seed).join("\n"), new RegExp(broadRole))
  })

  test(`Console human-admin service cannot receive ${broadRole}`, () => {
    const seed = clone(artifacts.seed)
    seed.clients
      .find(({ clientId }) => clientId === "console-human-admin")
      .serviceAccountClientRoleMappings["realm-management"].push(broadRole)
    assert.match(validateKeycloakSeed(seed).join("\n"), new RegExp(broadRole))
  })
}

test("each realm uses only its reviewed FGAP resource types", () => {
  const humanPermissions =
    artifacts.seed.adminFineGrainedAuthorization.permissions
  const applicationPermissions =
    artifacts.applicationSeed.adminFineGrainedAuthorization.permissions
  assert.deepEqual(
    [
      ...new Set(humanPermissions.map(({ resourceType }) => resourceType)),
    ].sort(),
    ["Groups", "Users"],
  )
  assert.deepEqual(
    [
      ...new Set(
        applicationPermissions.map(({ resourceType }) => resourceType),
      ),
    ].sort(),
    ["Clients"],
  )
  const permissions = [...humanPermissions, ...applicationPermissions]
  assert.equal(
    permissions.some((permission) => "actions" in permission),
    false,
  )
  assert.equal(
    permissions.some((permission) => "resource" in permission),
    false,
  )
})

test("delegated customer Admin cannot gain membership or role-mapping scopes", () => {
  for (const scope of [
    "manage-group-membership",
    "manage-membership",
    "manage-membership-of-members",
    "map-role",
    "map-roles",
  ]) {
    const seed = clone(artifacts.seed)
    const permission = seed.adminFineGrainedAuthorization.permissions.find(
      ({ name }) => name === "customer-admin-view-all-users",
    )
    permission.scopes.push(scope)
    assert.match(
      validateKeycloakSeed(seed).join("\n"),
      new RegExp(`delegated Admin scope ${scope}|FGAP v2 permissions`),
    )
  }
})

test("delegated customer Admin can manage Admin members but only view Operator members", () => {
  const permissions = artifacts.seed.adminFineGrainedAuthorization.permissions
  const admins = permissions.find(
    ({ name }) => name === "customer-admin-manage-Admins-members",
  )
  const operators = permissions.find(
    ({ name }) => name === "customer-admin-view-Operators-members",
  )
  assert.deepEqual(admins.scopes, ["manage-members", "view", "view-members"])
  assert.deepEqual(operators.scopes, ["view", "view-members"])

  const seed = clone(artifacts.seed)
  seed.adminFineGrainedAuthorization.permissions
    .find(({ name }) => name === "customer-admin-view-Operators-members")
    .scopes.push("manage-members")
  assert.match(validateKeycloakSeed(seed).join("\n"), /FGAP v2 permissions/)
})

test("the Console service has exact user and group scopes without role mapping", () => {
  const permissions =
    artifacts.seed.adminFineGrainedAuthorization.permissions.filter(
      ({ policies }) =>
        policies.includes("console-human-admin-service-account"),
    )
  assert.equal(permissions.length, 4)
  assert.deepEqual(
    permissions.find(({ resourceType }) => resourceType === "Users").scopes,
    ["manage", "manage-group-membership", "view"],
  )
  assert.deepEqual(
    permissions.find(
      ({ name }) => name === "console-human-admin-manage-all-groups",
    ).scopes,
    ["manage", "manage-membership", "view", "view-members"],
  )
  assert.equal(
    permissions.some(({ resourceType }) =>
      ["Clients", "Roles"].includes(resourceType),
    ),
    false,
  )
  assert.equal(
    permissions.some(({ scopes }) =>
      scopes.some((scope) => scope === "map-role" || scope === "map-roles"),
    ),
    false,
  )
  assert.deepEqual(
    artifacts.seed.servicePermissionClasses.find(
      ({ id }) => id === "human-identity-admin",
    ).allowedFgapResourceTypes,
    ["Groups", "Users"],
  )
})

test("active FGAP rejects Roles permissions and every role-mapping scope", () => {
  const withRolesPermission = clone(artifacts.seed)
  withRolesPermission.adminFineGrainedAuthorization.permissions.push({
    name: "unreviewed-role-mapping",
    policies: ["console-human-admin-service-account"],
    resources: ["role:admin"],
    resourceType: "Roles",
    scopes: ["map-role"],
  })
  assert.match(
    validateKeycloakSeed(withRolesPermission).join("\n"),
    /active FGAP Roles permissions|active FGAP role-mapping scope map-role/,
  )

  const withUserRoleMapping = clone(artifacts.seed)
  withUserRoleMapping.adminFineGrainedAuthorization.permissions
    .find(({ name }) => name === "console-human-admin-manage-all-users")
    .scopes.push("map-roles")
  assert.match(
    validateKeycloakSeed(withUserRoleMapping).join("\n"),
    /active FGAP role-mapping scope map-roles/,
  )
})

test("the human service cannot acquire client management or a wildcard", () => {
  const seed = clone(artifacts.seed)
  seed.adminFineGrainedAuthorization.permissions.push({
    name: "unreviewed-client-admin",
    policies: ["console-human-admin-service-account"],
    resourceType: "Clients",
    scopes: ["*"],
  })
  assert.match(
    validateKeycloakSeed(seed).join("\n"),
    /FGAP v2 permissions|active FGAP resource type Clients|wildcard/,
  )
})

test("human and Application service permission classes stay separate", () => {
  assert.deepEqual(
    artifacts.seed.servicePermissionClasses.map(({ id }) => id),
    ["human-identity-admin"],
  )
  assert.deepEqual(
    artifacts.applicationSeed.servicePermissionClasses.map(({ id }) => id),
    ["application-oauth-client-admin"],
  )

  const seed = clone(artifacts.applicationSeed)
  const applicationClass = seed.servicePermissionClasses.find(
    ({ id }) => id === "application-oauth-client-admin",
  )
  applicationClass.assignedClientId = "console-human-admin"
  applicationClass.fgapPolicy = "console-human-admin-service-account"
  assert.match(
    validateApplicationKeycloakSeed(seed).join("\n"),
    /service permission classes/,
  )

  const leakedHumanSeed = clone(artifacts.seed)
  leakedHumanSeed.clients.push(clone(artifacts.applicationSeed.clients[0]))
  assert.match(
    validateRealmIsolation(leakedHumanSeed, artifacts.applicationSeed).join(
      "\n",
    ),
    /Application admin client leaked into human realm/,
  )
})

test("the Application service has only query-clients plus Clients manage and view", () => {
  const client = artifacts.applicationSeed.clients.find(
    ({ clientId }) => clientId === "console-application-admin",
  )
  assert.deepEqual(client.serviceAccountClientRoleMappings, {
    "realm-management": ["query-clients"],
  })
  assert.equal(client.serviceAccountsEnabled, true)
  assert.equal(client.standardFlowEnabled, false)
  assert.equal(client.implicitFlowEnabled, false)
  assert.equal(client.directAccessGrantsEnabled, false)
  assert.equal(client.authorizationServicesEnabled, false)
  assert.equal(client.clientCredentialsUseRefreshToken, false)
  const permission =
    artifacts.applicationSeed.adminFineGrainedAuthorization.permissions.find(
      ({ name }) =>
        name === "console-application-admin-manage-application-realm-clients",
    )
  assert.deepEqual(permission, {
    name: "console-application-admin-manage-application-realm-clients",
    policies: ["console-application-admin-service-account"],
    resourceType: "Clients",
    scopes: ["manage", "view"],
  })

  for (const broadRole of [
    "create-client",
    "manage-clients",
    "manage-realm",
    "realm-admin",
  ]) {
    const seed = clone(artifacts.applicationSeed)
    seed.clients
      .find(({ clientId }) => clientId === "console-application-admin")
      .serviceAccountClientRoleMappings["realm-management"].push(broadRole)
    assert.match(
      validateApplicationKeycloakSeed(seed).join("\n"),
      new RegExp(broadRole),
    )
  }
})

test("the Application FGAP policy cannot escape Clients or grant role mapping", () => {
  const resourceSeed = clone(artifacts.applicationSeed)
  resourceSeed.adminFineGrainedAuthorization.permissions.find(
    ({ name }) =>
      name === "console-application-admin-manage-application-realm-clients",
  ).resourceType = "Users"
  assert.match(
    validateApplicationKeycloakSeed(resourceSeed).join("\n"),
    /Application FGAP v2 contract|Application FGAP resource type Users/,
  )

  const scopeSeed = clone(artifacts.applicationSeed)
  scopeSeed.adminFineGrainedAuthorization.permissions
    .find(
      ({ name }) =>
        name === "console-application-admin-manage-application-realm-clients",
    )
    .scopes.push("map-roles")
  assert.match(
    validateApplicationKeycloakSeed(scopeSeed).join("\n"),
    /Application FGAP v2 contract|Application FGAP scope map-roles/,
  )

  const humanPolicySeed = clone(artifacts.applicationSeed)
  humanPolicySeed.adminFineGrainedAuthorization.permissions
    .find(
      ({ name }) =>
        name === "console-application-admin-manage-application-realm-clients",
    )
    .policies.push("console-human-admin-service-account")
  assert.match(
    validateApplicationKeycloakSeed(humanPolicySeed).join("\n"),
    /Application FGAP v2 contract/,
  )
})

test("the broad Users and Groups manage residuals are immutable", () => {
  const [users, groups] = artifacts.seed.knownResiduals
  assert.equal(users.accepted, true)
  assert.deepEqual(users.inseparableOperations, ["create", "delete", "update"])
  assert.deepEqual(users.compensatingControls, [
    "service-credential-isolated-from-customer-humans",
    "console-identity-mutation-journal-required",
    "console-is-the-single-human-identity-writer",
    "last-enabled-operator-checked-before-every-operator-mutation",
  ])
  assert.equal(groups.accepted, true)
  assert.equal(
    groups.appliesToPermission,
    "console-human-admin-manage-all-groups",
  )
  assert.deepEqual(groups.inseparableOperations, ["create", "delete", "update"])

  const seed = clone(artifacts.seed)
  seed.knownResiduals[0].compensatingControls.pop()
  assert.match(validateKeycloakSeed(seed).join("\n"), /accepted FGAP residuals/)
})

test("reset-password remains uninstalled so Keycloak can use Users manage fallback", () => {
  const fgap = artifacts.seed.adminFineGrainedAuthorization
  assert.deepEqual(fgap.intentionallyUninstalledScopes, [
    {
      reason:
        "Keycloak 26.6 falls back to effective Users/manage when no reset-password permission exists",
      resourceType: "Users",
      scope: "reset-password",
    },
  ])
  assert.equal(
    fgap.permissions.some(({ scopes }) => scopes.includes("reset-password")),
    false,
  )

  const seed = clone(artifacts.seed)
  seed.adminFineGrainedAuthorization.permissions
    .find(({ name }) => name === "console-human-admin-manage-all-users")
    .scopes.push("reset-password")
  assert.match(
    validateKeycloakSeed(seed).join("\n"),
    /reset-password permission must remain uninstalled|FGAP v2 permissions/,
  )
})

test("offline access is removed through real client-scope and default-role controls", () => {
  assert.equal("offlineSessionsEnabled" in artifacts.seed.realm, false)
  assert.deepEqual(
    artifacts.seed.offlineAccessPolicy.realmDefaultRole.realmRoleComposites,
    [],
  )
  for (const client of artifacts.seed.clients) {
    assert.deepEqual(client.optionalClientScopes, [])
  }
  assert.deepEqual(artifacts.commissioning.tokenNegativeTests, [
    {
      expectedGrantedScopeContainsOfflineAccess: false,
      expectedOfflineToken: false,
      id: "offline-access-not-issued",
      requestedScope: "offline_access",
      requestingClients: ["console-human-admin", "console-web"],
    },
  ])
  assert.deepEqual(artifacts.applicationCommissioning.tokenNegativeTests, [
    {
      expectedGrantedScopeContainsOfflineAccess: false,
      expectedOfflineToken: false,
      expectedRefreshToken: false,
      id: "application-offline-and-refresh-access-not-issued",
      requestedScope: "offline_access",
      requestingClients: [
        "console-application-admin",
        "managed-client:llmm-app-UUID",
      ],
    },
  ])

  const seed = clone(artifacts.applicationSeed)
  seed.clients
    .find(({ clientId }) => clientId === "console-application-admin")
    .optionalClientScopes.push("offline_access")
  seed.offlineAccessPolicy.realmDefaultRole.realmRoleComposites.push(
    "offline_access",
  )
  assert.match(
    validateApplicationKeycloakSeed(seed).join("\n"),
    /Application offline-access policy|Application seed clients/,
  )
})

test("the Application realm and token lifetimes are exact", () => {
  assert.equal(
    artifacts.applicationSeed.realm.name,
    "llm-machines-applications",
  )
  assert.equal(artifacts.applicationSeed.realm.accessTokenSeconds, 300)
  assert.equal(artifacts.applicationSeed.clients.length, 1)
  assert.equal(artifacts.applicationSeed.clients[0].accessTokenSeconds, 60)
  assert.deepEqual(artifacts.applicationCommissioning.tokenLifetimeTests, [
    {
      client: "managed-client:llmm-app-UUID",
      expectedAccessTokenSeconds: 300,
    },
    {
      client: "console-application-admin",
      expectedAccessTokenSeconds: 60,
    },
  ])

  const seed = clone(artifacts.applicationSeed)
  seed.realm.accessTokenSeconds = 301
  seed.clients[0].accessTokenSeconds = 61
  assert.match(
    validateApplicationKeycloakSeed(seed).join("\n"),
    /Application realm|Application access-token lifetime|Application admin access-token lifetime/,
  )
})

test("managed Application clients have the exact service-account-only contract", () => {
  assert.deepEqual(artifacts.applicationSeed.managedClientContract, {
    accessTokenPolicy: "inherit-realm-default",
    audience: "console-bff",
    audienceMapperField: "included.custom.audience",
    authorizationServicesEnabled: false,
    clientAuthentication: "client-secret-generated-by-keycloak",
    clientCredentialsUseRefreshToken: false,
    clientIdPattern:
      "^llmm-app-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    credentialIncluded: false,
    defaultClientScopes: [],
    directAccessGrantsEnabled: false,
    fullScopeAllowed: false,
    implicitFlowEnabled: false,
    optionalClientScopes: [],
    protocol: "openid-connect",
    serviceAccountsEnabled: true,
    standardFlowEnabled: false,
  })

  const seed = clone(artifacts.applicationSeed)
  seed.managedClientContract.fullScopeAllowed = true
  seed.managedClientContract.defaultClientScopes = ["roles"]
  seed.managedClientContract.audience = "realm-management"
  assert.match(
    validateApplicationKeycloakSeed(seed).join("\n"),
    /managed Application client contract/,
  )
})

test("the Application realm contains no human identity surface", () => {
  assert.equal(artifacts.applicationSeed.authentication, null)
  assert.deepEqual(artifacts.applicationSeed.clientScopes, [])
  assert.deepEqual(artifacts.applicationSeed.roles, [])
  assert.deepEqual(artifacts.applicationSeed.groups, [])
  assert.deepEqual(artifacts.applicationSeed.users, [])

  const seed = clone(artifacts.applicationSeed)
  seed.roles.push({ name: "admin" })
  seed.groups.push({ name: "Admins" })
  assert.match(
    validateApplicationKeycloakSeed(seed).join("\n"),
    /Application realm roles|Application groups/,
  )
  assert.match(
    validateRealmIsolation(artifacts.seed, seed).join("\n"),
    /Application realm human roles|Application realm human groups/,
  )
})

test("the browser flow exact-binds password and required OTP AMR references", () => {
  const executions = artifacts.seed.authentication.browserFlow.executions
  assert.deepEqual(
    executions
      .filter(({ amrReference }) => amrReference)
      .map(({ amrReference, authenticator, requirement }) => ({
        amrReference,
        authenticator,
        requirement,
      })),
    [
      {
        amrReference: "pwd",
        authenticator: "auth-username-password-form",
        requirement: "REQUIRED",
      },
      {
        amrReference: "otp",
        authenticator: "auth-otp-form",
        requirement: "REQUIRED",
      },
    ],
  )

  const seed = clone(artifacts.seed)
  seed.authentication.browserFlow.executions.at(-1).amrReference = "mfa"
  assert.match(validateKeycloakSeed(seed).join("\n"), /browser MFA flow/)
})

test("the built-in AMR mapper and basic auth_time mapper are exact", () => {
  const amr = artifacts.seed.clientScopes.find(
    ({ name }) => name === "llm-machines-amr",
  ).protocolMappers[0]
  const authTime = artifacts.seed.clientScopes.find(
    ({ name }) => name === "basic",
  ).requiredProtocolMappers[0]
  assert.equal(amr.protocolMapper, "oidc-amr-mapper")
  assert.equal(amr.config["access.token.claim"], "true")
  assert.equal(authTime.protocolMapper, "oidc-usersessionmodel-note-mapper")
  assert.equal(authTime.config["user.session.note"], "AUTH_TIME")
  assert.equal(authTime.config["claim.name"], "auth_time")

  const seed = clone(artifacts.seed)
  seed.clientScopes[0].requiredProtocolMappers[0].config["access.token.claim"] =
    "false"
  seed.clientScopes[1].protocolMappers[0].protocolMapper = "oidc-acr-mapper"
  assert.match(validateKeycloakSeed(seed).join("\n"), /OIDC client scopes/)
})

test("console-web hardcodes the console-bff audience", () => {
  const web = artifacts.seed.clients.find(
    ({ clientId }) => clientId === "console-web",
  )
  assert.deepEqual(web.defaultClientScopes, [
    "basic",
    "llm-machines-amr",
    "roles",
  ])
  assert.equal(web.protocolMappers[0].protocolMapper, "oidc-audience-mapper")
  assert.equal(
    web.protocolMappers[0].config["included.client.audience"],
    "console-bff",
  )

  const seed = clone(artifacts.seed)
  seed.clients[0].protocolMappers[0].config["included.client.audience"] =
    "realm-management"
  assert.match(validateKeycloakSeed(seed).join("\n"), /seed clients/)
})

test("embedded credential fields are rejected without printing their values", () => {
  const seed = clone(artifacts.applicationSeed)
  seed.clients.find(
    ({ clientId }) => clientId === "console-application-admin",
  ).clientSecret = "unit-test-value"
  const errors = validateApplicationKeycloakSeed(seed)
  assert.match(errors.join("\n"), /credential-bearing field/)
  assert.doesNotMatch(errors.join("\n"), /unit-test-value/)
})

test("normalized secret-bearing keys are rejected at nested locations", () => {
  const seed = clone(artifacts.applicationSeed)
  seed.metadata.client_secret = "unit-test-snake-value"
  const seedErrors = validateApplicationKeycloakSeed(seed).join("\n")
  assert.match(seedErrors, /Application seed metadata/)
  assert.match(
    seedErrors,
    /credential-bearing field.*\.metadata\.client_secret/,
  )
  assert.doesNotMatch(seedErrors, /unit-test-snake-value/)

  const plan = clone(artifacts.applicationCommissioning)
  plan.metadata.clientSecret = "unit-test-camel-value"
  const planErrors = validateApplicationCommissioningPlan(plan).join("\n")
  assert.match(planErrors, /Application commissioning metadata/)
  assert.match(planErrors, /credential-bearing field.*\.clientSecret/)
  assert.doesNotMatch(planErrors, /unit-test-camel-value/)
})

test("Application metadata and runtime objects are exact", () => {
  const seed = clone(artifacts.applicationSeed)
  seed.metadata.packagingTarget = "PR-13"
  seed.keycloakRuntime.runtimeEnabled = true
  assert.match(
    validateApplicationKeycloakSeed(seed).join("\n"),
    /Application seed metadata|Application Keycloak runtime/,
  )

  const plan = clone(artifacts.applicationCommissioning)
  plan.metadata.changePackage = "PR-07"
  assert.match(
    validateApplicationCommissioningPlan(plan).join("\n"),
    /Application commissioning metadata/,
  )
})

test("human recovery requires auth_time and AMR evidence, not ACR alone", () => {
  const seed = clone(artifacts.seed)
  seed.authentication.humanMfa.accessTokenEvidence = {
    acrOnlySufficient: true,
    requiredClaims: ["acr"],
  }
  assert.match(
    validateKeycloakSeed(seed).join("\n"),
    /MFA access-token claims|ACR/,
  )

  const plan = clone(artifacts.commissioning)
  plan.recoveryMfaEvidence.acrAloneAccepted = true
  plan.recoveryMfaEvidence.requiredAccessTokenClaims = ["acr"]
  assert.match(
    validateCommissioningPlan(plan).join("\n"),
    /access-token claims|ACR/,
  )
})

test("Operator MFA and last-Operator commissioning assertions are mandatory", () => {
  const seed = clone(artifacts.seed)
  seed.authentication.humanMfa.requiredForRealmRoles = ["admin"]
  assert.match(validateKeycloakSeed(seed).join("\n"), /human MFA roles/)

  const plan = clone(artifacts.commissioning)
  const operatorPhase = plan.phases.find(
    ({ id }) => id === "commission-first-operator",
  )
  operatorPhase.requiredActions = ["UPDATE_PASSWORD"]
  operatorPhase.completionAssertions =
    operatorPhase.completionAssertions.filter(
      (item) => item !== "last-enabled-operator-protection-passed",
    )
  assert.match(
    validateCommissioningPlan(plan).join("\n"),
    /first Operator required actions|last-enabled-operator-protection/,
  )
})

test("the FGAP live-evaluation matrix is exact and includes negative controls", () => {
  const matrix = artifacts.commissioning.fgapV2EvaluationMatrix
  assert.equal(matrix.length, 30)
  assert.equal(matrix.filter(({ expected }) => expected === "DENY").length, 14)
  assert.deepEqual(
    matrix
      .filter(
        ({ principal, resource }) =>
          principal === "console-human-admin-service-account" &&
          resource === "group:non-system",
      )
      .map(({ scope }) => scope),
    ["view", "view-members", "manage", "manage-membership"],
  )
  assert.equal(
    matrix.find(
      ({ principal, resourceType, scope }) =>
        principal === "console-human-admin-service-account" &&
        resourceType === "Users" &&
        scope === "map-roles",
    ).expected,
    "DENY",
  )
  assert.equal(
    matrix.find(
      ({ principal, resource, scope }) =>
        principal === "console-human-admin-service-account" &&
        resource === "role:admin" &&
        scope === "map-role",
    ).expected,
    "DENY",
  )
  assert.equal(
    matrix.some(
      ({ principal }) =>
        principal === "console-application-admin-service-account",
    ),
    false,
  )

  const applicationMatrix =
    artifacts.applicationCommissioning.fgapV2EvaluationMatrix
  assert.equal(applicationMatrix.length, 7)
  assert.equal(
    applicationMatrix.filter(({ expected }) => expected === "DENY").length,
    5,
  )
  assert.deepEqual(
    applicationMatrix.map(({ expected, resourceType, scope }) => ({
      expected,
      resourceType,
      scope,
    })),
    [
      { expected: "PERMIT", resourceType: "Clients", scope: "view" },
      { expected: "PERMIT", resourceType: "Clients", scope: "manage" },
      { expected: "DENY", resourceType: "Clients", scope: "map-roles" },
      { expected: "DENY", resourceType: "Users", scope: "manage" },
      { expected: "DENY", resourceType: "Groups", scope: "manage" },
      { expected: "DENY", resourceType: "Roles", scope: "map-role" },
      { expected: "DENY", resourceType: "Organizations", scope: "manage" },
    ],
  )

  const plan = clone(artifacts.commissioning)
  plan.fgapV2EvaluationMatrix.find(
    ({ resource, scope }) =>
      resource === "group:Operators" && scope === "manage-members",
  ).expected = "PERMIT"
  assert.match(
    validateCommissioningPlan(plan).join("\n"),
    /FGAP v2 evaluation matrix/,
  )

  const applicationPlan = clone(artifacts.applicationCommissioning)
  applicationPlan.fgapV2EvaluationMatrix.find(
    ({ resourceType }) => resourceType === "Organizations",
  ).expected = "PERMIT"
  assert.match(
    validateApplicationCommissioningPlan(applicationPlan).join("\n"),
    /Application FGAP v2 evaluation matrix/,
  )
})

test("commissioning order and runtime verification assertions are fixed", () => {
  const plan = clone(artifacts.commissioning)
  plan.phases.reverse()
  plan.phases.find(
    ({ id }) => id === "validate-logical-seed",
  ).completionAssertions = []
  assert.match(
    validateCommissioningPlan(plan).join("\n"),
    /commissioning phase order|seed validation/,
  )
})

test("Application commissioning phases exact-bind owners and fields", () => {
  for (const index of [0, 1, 2]) {
    const plan = clone(artifacts.applicationCommissioning)
    plan.phases[index].mutationOwner = "runtime-bff"
    assert.match(
      validateApplicationCommissioningPlan(plan).join("\n"),
      /Application commissioning phases/,
    )
  }

  const plan = clone(artifacts.applicationCommissioning)
  plan.phases[0].runtimeEnabled = true
  assert.match(
    validateApplicationCommissioningPlan(plan).join("\n"),
    /Application commissioning phases/,
  )
})

test("the verifier has no network or process execution path", () => {
  const source = readFileSync(
    new URL("./pr05-keycloak-seed.mjs", import.meta.url),
    "utf8",
  )
  assert.doesNotMatch(source, /node:(?:child_process|http|https|net|tls)/)
  assert.doesNotMatch(source, /\bfetch\s*\(/)
})

function clone(value) {
  return structuredClone(value)
}
