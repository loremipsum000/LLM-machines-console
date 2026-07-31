import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

export const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url))
export const realmSeedPath = fileURLToPath(
  new URL(
    "../../infra/keycloak/inference-core-realm-seed.json",
    import.meta.url,
  ),
)
export const commissioningPlanPath = fileURLToPath(
  new URL(
    "../../infra/keycloak/inference-core-commissioning.json",
    import.meta.url,
  ),
)

const expectedQueryRoles = ["query-groups", "query-users"]
const acceptedMfaMethods = ["hwk", "otp", "webauthn", "webauthn-passwordless"]
const requiredMfaClaims = ["amr", "auth_time"]
const forbiddenCoarseAdminRoles = new Set([
  "create-client",
  "impersonation",
  "manage-authorization",
  "manage-clients",
  "manage-realm",
  "manage-users",
  "query-clients",
  "realm-admin",
  "view-clients",
  "view-realm",
  "view-users",
])
const forbiddenValueKeys = new Set([
  "accessToken",
  "apiKey",
  "bootstrapToken",
  "clientCredentials",
  "clientSecret",
  "credential",
  "credentials",
  "password",
  "privateKey",
  "recoveryFactor",
  "refreshToken",
  "secret",
  "signingKey",
])

const expectedRoles = [
  {
    clientRoleMappings: { "realm-management": expectedQueryRoles },
    description: "Customer appliance administrator",
    name: "admin",
  },
  {
    clientRoleMappings: {},
    description: "Customer appliance operator",
    name: "operator",
  },
]

const expectedGroups = [
  {
    customerNativeMutation: "member-accounts-only",
    name: "Admins",
    realmRoleMappings: ["admin"],
  },
  {
    customerNativeMutation: "read-only",
    name: "Operators",
    realmRoleMappings: ["operator"],
  },
]

const expectedOfflineAccessPolicy = {
  realmDefaultRole: {
    name: "default-roles-llm-machines",
    realmRoleComposites: [],
  },
  realmRoleName: "offline_access",
  retainedClientOptionalScopes: {
    "console-bff": [],
    "console-human-admin": [],
    "console-web": [],
  },
}

const expectedBrowserFlow = {
  alias: "llm-machines-browser-mfa",
  binding: "browser",
  builtIn: false,
  executions: [
    {
      amrReference: null,
      authenticator: "auth-cookie",
      path: "llm-machines-browser-mfa/Cookie",
      requirement: "ALTERNATIVE",
    },
    {
      flowAlias: "llm-machines-browser-mfa-forms",
      path: "llm-machines-browser-mfa/Forms",
      requirement: "ALTERNATIVE",
    },
    {
      amrReference: "pwd",
      authenticator: "auth-username-password-form",
      path: "llm-machines-browser-mfa/Forms/Username Password Form",
      requirement: "REQUIRED",
    },
    {
      amrReference: "otp",
      authenticator: "auth-otp-form",
      path: "llm-machines-browser-mfa/Forms/OTP Form",
      requirement: "REQUIRED",
    },
  ],
  providerId: "basic-flow",
}

const expectedAuthTimeMapper = {
  config: {
    "access.token.claim": "true",
    "claim.name": "auth_time",
    "id.token.claim": "true",
    "introspection.token.claim": "true",
    "jsonType.label": "long",
    "user.session.note": "AUTH_TIME",
  },
  consentRequired: false,
  name: "auth_time",
  protocol: "openid-connect",
  protocolMapper: "oidc-usersessionmodel-note-mapper",
}

const expectedAmrMapper = {
  config: {
    "access.token.claim": "true",
    "id.token.claim": "false",
    "lightweight.claim": "false",
  },
  consentRequired: false,
  name: "amr",
  protocol: "openid-connect",
  protocolMapper: "oidc-amr-mapper",
}

const expectedAudienceMapper = {
  config: {
    "access.token.claim": "true",
    "id.token.claim": "false",
    "included.client.audience": "console-bff",
    "included.custom.audience": "",
    "introspection.token.claim": "true",
    "lightweight.claim": "false",
  },
  consentRequired: false,
  name: "console-bff-audience",
  protocol: "openid-connect",
  protocolMapper: "oidc-audience-mapper",
}

const expectedClientScopes = [
  {
    name: "basic",
    origin: "keycloak-built-in",
    protocol: "openid-connect",
    requiredProtocolMappers: [expectedAuthTimeMapper],
  },
  {
    attributes: {
      "display.on.consent.screen": "false",
      "include.in.token.scope": "false",
    },
    name: "llm-machines-amr",
    origin: "realm-seed",
    protocol: "openid-connect",
    protocolMappers: [expectedAmrMapper],
  },
]

const expectedClients = [
  {
    accessTokenClaims: ["amr", "aud", "auth_time", "realm_access.roles", "sub"],
    clientAuthentication: "client-secret-generated-outside-seed",
    clientId: "console-web",
    credentialIncluded: false,
    defaultClientScopes: ["basic", "llm-machines-amr", "roles"],
    flows: ["authorization-code-pkce"],
    optionalClientScopes: [],
    protocol: "openid-connect",
    protocolMappers: [expectedAudienceMapper],
    serviceAccountsEnabled: false,
  },
  {
    bearerOnly: true,
    clientId: "console-bff",
    credentialIncluded: false,
    optionalClientScopes: [],
    protocol: "openid-connect",
    requiredBearerClaims: [
      "amr",
      "aud",
      "auth_time",
      "realm_access.roles",
      "sub",
    ],
    serviceAccountsEnabled: false,
  },
  {
    accessTokenSeconds: 60,
    clientAuthentication: "client-secret-generated-outside-seed",
    clientId: "console-human-admin",
    credentialIncluded: false,
    optionalClientScopes: [],
    permissionClass: "human-identity-admin",
    protocol: "openid-connect",
    serviceAccountClientRoleMappings: {
      "realm-management": expectedQueryRoles,
    },
    serviceAccountsEnabled: true,
  },
]

const expectedServicePermissionClasses = [
  {
    allowedFgapResourceTypes: ["Groups", "Users"],
    assignedClientId: "console-human-admin",
    fgapPolicy: "console-human-admin-service-account",
    id: "human-identity-admin",
    status: "active-console-only",
  },
  {
    allowedFgapResourceTypes: ["Clients"],
    assignedClientId: null,
    fgapPolicy: null,
    id: "application-oauth-client-admin",
    status: "reserved-unassigned-until-pr06",
  },
]

const expectedFgapPolicies = [
  {
    logic: "POSITIVE",
    name: "customer-admin-role",
    roles: ["realm-role:admin"],
    type: "role",
  },
  {
    logic: "POSITIVE",
    name: "console-human-admin-service-account",
    type: "user",
    users: ["service-account:console-human-admin"],
  },
]

const expectedFgapPermissions = [
  fgapPermission(
    "customer-admin-view-all-users",
    "Users",
    ["view"],
    ["customer-admin-role"],
  ),
  fgapPermission(
    "customer-admin-manage-Admins-members",
    "Groups",
    ["manage-members", "view", "view-members"],
    ["customer-admin-role"],
    ["group:Admins"],
  ),
  fgapPermission(
    "customer-admin-view-Operators-members",
    "Groups",
    ["view", "view-members"],
    ["customer-admin-role"],
    ["group:Operators"],
  ),
  fgapPermission(
    "console-human-admin-manage-all-users",
    "Users",
    ["manage", "manage-group-membership", "view"],
    ["console-human-admin-service-account"],
  ),
  fgapPermission(
    "console-human-admin-manage-all-groups",
    "Groups",
    ["manage", "manage-membership", "view", "view-members"],
    ["console-human-admin-service-account"],
  ),
  fgapPermission(
    "console-human-admin-manage-Admins-group",
    "Groups",
    [
      "manage-members",
      "manage-membership",
      "manage-membership-of-members",
      "view",
      "view-members",
    ],
    ["console-human-admin-service-account"],
    ["group:Admins"],
  ),
  fgapPermission(
    "console-human-admin-manage-Operators-group",
    "Groups",
    [
      "manage-members",
      "manage-membership",
      "manage-membership-of-members",
      "view",
      "view-members",
    ],
    ["console-human-admin-service-account"],
    ["group:Operators"],
  ),
]

const expectedSelectorResolution = {
  "group:Admins": "resolve-appliance-realm-group-uuid",
  "group:Operators": "resolve-appliance-realm-group-uuid",
  "realm-role:admin": "resolve-appliance-realm-role-uuid",
  "service-account:console-human-admin": "resolve-service-account-user-uuid",
}

const expectedIntentionallyUninstalledScopes = [
  {
    reason:
      "Keycloak 26.6 falls back to effective Users/manage when no reset-password permission exists",
    resourceType: "Users",
    scope: "reset-password",
  },
]

const expectedResiduals = [
  {
    accepted: true,
    appliesToPermission: "console-human-admin-manage-all-users",
    compensatingControls: [
      "service-credential-isolated-from-customer-humans",
      "console-identity-mutation-journal-required",
      "console-is-the-single-human-identity-writer",
      "last-enabled-operator-checked-before-every-operator-mutation",
    ],
    id: "fgap-users-manage-operation-breadth",
    inseparableOperations: ["create", "delete", "update"],
    reason:
      "Keycloak FGAP v2 Users/manage does not isolate create from update or delete",
  },
  {
    accepted: true,
    appliesToPermission: "console-human-admin-manage-all-groups",
    compensatingControls: [
      "service-credential-isolated-from-customer-humans",
      "console-identity-mutation-journal-required",
      "console-is-the-single-human-identity-writer",
    ],
    id: "fgap-groups-manage-operation-breadth",
    inseparableOperations: ["create", "delete", "update"],
    reason:
      "Keycloak FGAP v2 Groups/manage is resource-type-wide for Console group CRUD",
  },
]

const expectedFgapEvaluationMatrix = [
  evaluation("customer-admin-role", "Users", "user:any", "view", "PERMIT"),
  evaluation("customer-admin-role", "Groups", "group:Admins", "view", "PERMIT"),
  evaluation(
    "customer-admin-role",
    "Groups",
    "group:Operators",
    "view",
    "PERMIT",
  ),
  evaluation(
    "customer-admin-role",
    "Groups",
    "group:Admins",
    "view-members",
    "PERMIT",
  ),
  evaluation(
    "customer-admin-role",
    "Groups",
    "group:Admins",
    "manage-members",
    "PERMIT",
  ),
  evaluation("customer-admin-role", "Groups", "group:Admins", "manage", "DENY"),
  evaluation(
    "customer-admin-role",
    "Groups",
    "group:Operators",
    "manage",
    "DENY",
  ),
  evaluation(
    "customer-admin-role",
    "Groups",
    "group:Admins",
    "manage-membership",
    "DENY",
  ),
  evaluation(
    "customer-admin-role",
    "Groups",
    "group:Operators",
    "view-members",
    "PERMIT",
  ),
  evaluation(
    "customer-admin-role",
    "Groups",
    "group:Operators",
    "manage-membership",
    "DENY",
  ),
  evaluation(
    "customer-admin-role",
    "Groups",
    "group:Operators",
    "manage-members",
    "DENY",
  ),
  evaluation(
    "customer-admin-role",
    "Users",
    "user:member-of:Admins",
    "reset-password",
    "PERMIT",
  ),
  evaluation(
    "customer-admin-role",
    "Users",
    "user:member-of:Operators",
    "reset-password",
    "DENY",
  ),
  evaluation(
    "customer-admin-role",
    "Users",
    "user:member-of:Operators",
    "manage-group-membership",
    "DENY",
  ),
  evaluation("customer-admin-role", "Roles", "role:admin", "map-role", "DENY"),
  evaluation(
    "console-human-admin-service-account",
    "Users",
    "user:any",
    "manage",
    "PERMIT",
  ),
  evaluation(
    "console-human-admin-service-account",
    "Users",
    "user:any",
    "manage-group-membership",
    "PERMIT",
  ),
  evaluation(
    "console-human-admin-service-account",
    "Users",
    "user:any",
    "map-roles",
    "DENY",
  ),
  evaluation(
    "console-human-admin-service-account",
    "Users",
    "user:any",
    "reset-password",
    "PERMIT",
  ),
  evaluation(
    "console-human-admin-service-account",
    "Groups",
    "group:non-system",
    "view",
    "PERMIT",
  ),
  evaluation(
    "console-human-admin-service-account",
    "Groups",
    "group:non-system",
    "view-members",
    "PERMIT",
  ),
  evaluation(
    "console-human-admin-service-account",
    "Groups",
    "group:non-system",
    "manage",
    "PERMIT",
  ),
  evaluation(
    "console-human-admin-service-account",
    "Groups",
    "group:non-system",
    "manage-membership",
    "PERMIT",
  ),
  evaluation(
    "console-human-admin-service-account",
    "Groups",
    "group:Admins",
    "manage",
    "DENY",
  ),
  evaluation(
    "console-human-admin-service-account",
    "Groups",
    "group:Operators",
    "manage",
    "DENY",
  ),
  evaluation(
    "console-human-admin-service-account",
    "Groups",
    "group:Operators",
    "manage-membership",
    "PERMIT",
  ),
  evaluation(
    "console-human-admin-service-account",
    "Groups",
    "group:Operators",
    "manage-membership-of-members",
    "PERMIT",
  ),
  evaluation(
    "console-human-admin-service-account",
    "Roles",
    "role:admin",
    "map-role",
    "DENY",
  ),
  evaluation(
    "console-human-admin-service-account",
    "Roles",
    "role:operator",
    "map-role",
    "DENY",
  ),
  evaluation(
    "console-human-admin-service-account",
    "Clients",
    "client:any",
    "manage",
    "DENY",
  ),
]

const expectedTokenNegativeTests = [
  {
    expectedGrantedScopeContainsOfflineAccess: false,
    expectedOfflineToken: false,
    id: "offline-access-not-issued",
    requestedScope: "offline_access",
    requestingClients: ["console-human-admin", "console-web"],
  },
]

export function loadKeycloakArtifacts() {
  const seedBytes = readFileSync(realmSeedPath)
  const commissioningBytes = readFileSync(commissioningPlanPath)
  return {
    commissioning: JSON.parse(commissioningBytes.toString("utf8")),
    commissioningBytes,
    seed: JSON.parse(seedBytes.toString("utf8")),
    seedBytes,
  }
}

export function validateKeycloakSeed(seed) {
  const errors = []

  requireExactStrings(
    errors,
    Object.keys(seed ?? {}),
    [
      "adminFineGrainedAuthorization",
      "apiVersion",
      "authentication",
      "clientScopes",
      "clients",
      "groups",
      "keycloakRuntime",
      "kind",
      "knownResiduals",
      "metadata",
      "offlineAccessPolicy",
      "operatorProtection",
      "realm",
      "roles",
      "servicePermissionClasses",
      "users",
    ],
    "seed top-level fields",
  )
  requireEqual(
    errors,
    seed?.apiVersion,
    "inference-core.llm-machines/v1",
    "seed apiVersion",
  )
  requireEqual(errors, seed?.kind, "LogicalKeycloakRealmSeed", "seed kind")
  requireEqual(
    errors,
    seed?.metadata?.containsCredentials,
    false,
    "seed credential marker",
  )
  requireEqual(
    errors,
    seed?.metadata?.packagingTarget,
    "PR-12",
    "packaging target",
  )

  validateRuntime(errors, seed?.keycloakRuntime)
  validateRealm(errors, seed?.realm)
  validateOfflineAccess(errors, seed?.offlineAccessPolicy, seed?.clients)
  requireJsonEqual(errors, seed?.roles, expectedRoles, "realm roles")
  requireJsonEqual(errors, seed?.groups, expectedGroups, "identity groups")
  rejectCoarseRoleMappings(errors, seed?.roles, seed?.clients)
  validateMfa(errors, seed?.authentication)
  requireJsonEqual(
    errors,
    seed?.clientScopes,
    expectedClientScopes,
    "OIDC client scopes",
  )
  requireJsonEqual(errors, seed?.clients, expectedClients, "seed clients")
  requireJsonEqual(
    errors,
    seed?.servicePermissionClasses,
    expectedServicePermissionClasses,
    "service permission classes",
  )
  validateFgap(errors, seed?.adminFineGrainedAuthorization)
  requireJsonEqual(
    errors,
    seed?.knownResiduals,
    expectedResiduals,
    "accepted FGAP residuals",
  )

  requireEqual(
    errors,
    seed?.operatorProtection?.customerNativeKeycloak,
    "read-only",
    "Operator native mutation protection",
  )
  requireEqual(
    errors,
    seed?.operatorProtection?.nativeMutationPath,
    "none",
    "Operator native mutation path",
  )
  requireEqual(
    errors,
    seed?.operatorProtection?.lastEnabledOperatorInvariant,
    "console-bff",
    "last-Operator invariant owner",
  )
  requireEqual(
    errors,
    seed?.operatorProtection?.serviceMutationPath,
    "console-human-admin",
    "Operator service mutation path",
  )
  requireJsonEqual(errors, seed?.users, [], "seed users")

  for (const path of findForbiddenCredentialKeys(seed)) {
    errors.push(`credential-bearing field is forbidden at ${path}`)
  }
  for (const path of findCredentialLikeValues(seed)) {
    errors.push(`credential-like value is forbidden at ${path}`)
  }

  return errors
}

export function validateCommissioningPlan(plan) {
  const errors = []

  requireEqual(
    errors,
    plan?.apiVersion,
    "inference-core.llm-machines/v1",
    "commissioning apiVersion",
  )
  requireEqual(
    errors,
    plan?.kind,
    "LogicalKeycloakCommissioningPlan",
    "commissioning kind",
  )
  requireEqual(
    errors,
    plan?.metadata?.containsCredentials,
    false,
    "commissioning credential marker",
  )
  requireEqual(errors, plan?.realm, "llm-machines", "commissioning realm")
  requireExactStrings(
    errors,
    plan?.preconditions,
    [
      "empty-appliance-realm",
      "offline-seed-validation-passed",
      "customer-present-for-one-time-values",
    ],
    "commissioning preconditions",
  )
  requireJsonEqual(
    errors,
    plan?.phases?.map(({ id }) => id),
    [
      "validate-logical-seed",
      "commission-bootstrap-admin",
      "commission-first-operator",
      "close-commissioning",
    ],
    "commissioning phase order",
  )

  const seedValidation = findPhase(plan, "validate-logical-seed")
  const bootstrap = findPhase(plan, "commission-bootstrap-admin")
  const firstOperator = findPhase(plan, "commission-first-operator")
  const close = findPhase(plan, "close-commissioning")
  for (const assertion of [
    "keycloak-version-is-at-least-26.6.0",
    "admin-fine-grained-authz-v2-is-enabled",
    "realm-admin-permissions-are-enabled",
    "fgap-logical-selectors-were-resolved-to-appliance-realm-uuids",
    "no-active-Roles-permission-is-installed",
    "no-Users-map-roles-scope-is-installed",
    "no-Users-reset-password-permission-is-installed",
    "offline_access-is-absent-from-retained-client-optional-scopes",
    "offline_access-is-absent-from-the-realm-default-role-composite",
  ]) {
    requireIncludes(
      errors,
      seedValidation?.completionAssertions,
      assertion,
      "seed validation",
    )
  }
  for (const assertion of [
    "llm-machines-browser-mfa-is-the-browser-binding",
    "username-password-execution-reference-is-pwd",
    "required-otp-execution-reference-is-otp",
    "oidc-amr-mapper-adds-amr-to-access-token",
    "basic-client-scope-adds-auth_time-to-access-token",
    "console-web-audience-mapper-hardcodes-console-bff",
    "scope-offline_access-does-not-yield-an-offline-token",
  ]) {
    requireIncludes(
      errors,
      bootstrap?.completionAssertions,
      assertion,
      "bootstrap Admin commissioning",
    )
  }
  requireExactStrings(
    errors,
    bootstrap?.requiredActions,
    ["UPDATE_PASSWORD", "CONFIGURE_TOTP"],
    "bootstrap Admin required actions",
  )
  requireExactStrings(
    errors,
    firstOperator?.requiredActions,
    ["UPDATE_PASSWORD", "CONFIGURE_TOTP"],
    "first Operator required actions",
  )
  requireIncludes(
    errors,
    firstOperator?.completionAssertions,
    "last-enabled-operator-protection-passed",
    "first Operator commissioning",
  )
  requireIncludes(
    errors,
    firstOperator?.completionAssertions,
    "only-hardened-recovery-verifier-was-persisted",
    "first Operator commissioning",
  )
  requireIncludes(
    errors,
    close?.completionAssertions,
    "all-fgap-v2-evaluations-match-the-verification-matrix",
    "commissioning closure",
  )
  requireIncludes(
    errors,
    close?.completionAssertions,
    "fgap-groups-manage-residual-controls-are-active",
    "commissioning closure",
  )
  requireIncludes(
    errors,
    close?.completionAssertions,
    "fgap-users-manage-residual-controls-are-active",
    "commissioning closure",
  )
  requireIncludes(
    errors,
    close?.completionAssertions,
    "delegated-service-non-system-group-scopes-are-active",
    "commissioning closure",
  )
  requireIncludes(
    errors,
    close?.completionAssertions,
    "canonical-groups-are-the-only-role-assignment-path",
    "commissioning closure",
  )
  requireJsonEqual(
    errors,
    plan?.fgapV2EvaluationMatrix,
    expectedFgapEvaluationMatrix,
    "FGAP v2 evaluation matrix",
  )
  requireJsonEqual(
    errors,
    plan?.tokenNegativeTests,
    expectedTokenNegativeTests,
    "offline-access token negative tests",
  )

  const evidence = plan?.recoveryMfaEvidence ?? {}
  requireExactStrings(
    errors,
    evidence.acceptedAmrMethods,
    acceptedMfaMethods,
    "recovery AMR methods",
  )
  requireExactStrings(
    errors,
    evidence.requiredAccessTokenClaims,
    requiredMfaClaims,
    "recovery access-token claims",
  )
  requireEqual(
    errors,
    evidence.acrAloneAccepted,
    false,
    "recovery ACR boundary",
  )

  for (const path of findForbiddenCredentialKeys(plan)) {
    errors.push(`credential-bearing field is forbidden at ${path}`)
  }
  for (const path of findCredentialLikeValues(plan)) {
    errors.push(`credential-like value is forbidden at ${path}`)
  }

  return errors
}

export function verificationReport(artifacts = loadKeycloakArtifacts()) {
  const seedErrors = validateKeycloakSeed(artifacts.seed)
  const commissioningErrors = validateCommissioningPlan(artifacts.commissioning)
  return {
    commissioning: {
      errors: commissioningErrors,
      sha256: sha256(artifacts.commissioningBytes),
    },
    result:
      seedErrors.length === 0 && commissioningErrors.length === 0
        ? "pass"
        : "fail",
    seed: {
      errors: seedErrors,
      sha256: sha256(artifacts.seedBytes),
    },
  }
}

function validateRuntime(errors, runtime) {
  requireEqual(
    errors,
    runtime?.minimumVersion,
    "26.6.0",
    "minimum Keycloak version",
  )
  requireExactStrings(
    errors,
    runtime?.requiredFeatures,
    ["admin-fine-grained-authz:v2"],
    "required Keycloak features",
  )
  requireJsonEqual(
    errors,
    runtime?.customProviderPlugins,
    [],
    "custom Keycloak plugins",
  )
}

function validateRealm(errors, realm) {
  requireEqual(errors, realm?.name, "llm-machines", "appliance realm name")
  requireEqual(errors, realm?.masterRealm, false, "master-realm boundary")
  require(errors, realm?.name !==
    "master", "customer realm must never be master")
  requireEqual(errors, realm?.enabled, true, "realm enabled state")
  requireEqual(
    errors,
    realm?.adminPermissionsEnabled,
    true,
    "realm admin permissions",
  )
  requireEqual(errors, realm?.sslRequired, "external", "realm TLS posture")
  requireEqual(
    errors,
    realm?.registrationAllowed,
    false,
    "self-registration boundary",
  )
  requireEqual(
    errors,
    realm?.revokeRefreshToken,
    true,
    "refresh-token revocation",
  )
  requireEqual(errors, realm?.refreshTokenMaxReuse, 0, "refresh-token reuse")
  requireAtMost(errors, realm?.accessTokenSeconds, 300, "access-token lifetime")
  requireAtMost(
    errors,
    realm?.authorizationCodeSeconds,
    60,
    "authorization-code lifetime",
  )
  requireAtMost(errors, realm?.ssoSessionIdleSeconds, 1800, "SSO idle lifetime")
  requireAtMost(
    errors,
    realm?.ssoSessionMaxSeconds,
    28800,
    "SSO maximum lifetime",
  )
}

function validateOfflineAccess(errors, policy, clients) {
  requireJsonEqual(
    errors,
    policy,
    expectedOfflineAccessPolicy,
    "offline-access policy",
  )
  for (const client of clients ?? []) {
    requireJsonEqual(
      errors,
      client.optionalClientScopes,
      [],
      `${client.clientId ?? "unknown"} optional client scopes`,
    )
    require(errors, !client.optionalClientScopes?.includes(
      "offline_access",
    ), `${client.clientId ?? "unknown"} must not receive offline_access`)
  }
  require(errors, !policy?.realmDefaultRole?.realmRoleComposites?.includes(
    "offline_access",
  ), "realm default role must not include offline_access")
}

function validateMfa(errors, authentication) {
  requireJsonEqual(
    errors,
    authentication?.browserFlow,
    expectedBrowserFlow,
    "browser MFA flow",
  )
  const mfa = authentication?.humanMfa ?? {}
  requireExactStrings(
    errors,
    mfa.requiredForRealmRoles,
    ["admin", "operator"],
    "human MFA roles",
  )
  requireEqual(errors, mfa.requiredAction, "CONFIGURE_TOTP", "human MFA action")
  requireEqual(
    errors,
    mfa.currentBrowserSecondFactorReference,
    "otp",
    "browser second-factor AMR reference",
  )
  requireExactStrings(
    errors,
    mfa.acceptedAmrMethods,
    acceptedMfaMethods,
    "human AMR methods",
  )
  requireExactStrings(
    errors,
    mfa.accessTokenEvidence?.requiredClaims,
    requiredMfaClaims,
    "human MFA access-token claims",
  )
  requireEqual(
    errors,
    mfa.accessTokenEvidence?.acrOnlySufficient,
    false,
    "human MFA ACR boundary",
  )
  const totpAction = authentication?.requiredActions?.find(
    ({ alias }) => alias === "CONFIGURE_TOTP",
  )
  requireEqual(
    errors,
    totpAction?.enabled,
    true,
    "TOTP required action enabled",
  )
  requireEqual(errors, totpAction?.defaultAction, true, "TOTP default action")
}

function validateFgap(errors, fgap) {
  requireEqual(errors, fgap?.enabled, true, "FGAP enabled state")
  requireEqual(errors, fgap?.version, "v2", "FGAP version")
  requireEqual(
    errors,
    fgap?.feature,
    "admin-fine-grained-authz:v2",
    "FGAP feature",
  )
  requireEqual(
    errors,
    fgap?.resourceServerClientId,
    "admin-permissions",
    "FGAP resource server",
  )
  requireJsonEqual(
    errors,
    fgap?.policies,
    expectedFgapPolicies,
    "FGAP v2 policies",
  )
  requireJsonEqual(
    errors,
    fgap?.permissions,
    expectedFgapPermissions,
    "FGAP v2 permissions",
  )
  requireJsonEqual(
    errors,
    fgap?.selectorResolution,
    expectedSelectorResolution,
    "FGAP selector resolution",
  )
  requireJsonEqual(
    errors,
    fgap?.intentionallyUninstalledScopes,
    expectedIntentionallyUninstalledScopes,
    "intentionally uninstalled FGAP scopes",
  )

  const delegated = (fgap?.permissions ?? []).filter((permission) =>
    permission.policies?.includes("customer-admin-role"),
  )
  const prohibitedDelegatedScopes = new Set([
    "manage-group-membership",
    "manage-membership",
    "manage-membership-of-members",
    "map-role",
    "map-roles",
  ])
  for (const permission of delegated) {
    for (const scope of permission.scopes ?? []) {
      require(errors, !prohibitedDelegatedScopes.has(
        scope,
      ), `delegated Admin scope ${scope} is forbidden`)
    }
    require(errors, permission.resourceType !== "Clients" &&
      permission.resourceType !==
        "Organizations", `delegated Admin resource type ${permission.resourceType} is forbidden`)
  }
  for (const permission of fgap?.permissions ?? []) {
    require(errors, !permission.scopes?.includes(
      "reset-password",
    ), "Users reset-password permission must remain uninstalled for manage fallback")
    require(errors, permission.resourceType !==
      "Roles", "active FGAP Roles permissions are forbidden")
    for (const scope of permission.scopes ?? []) {
      require(errors, scope !== "map-role" &&
        scope !==
          "map-roles", `active FGAP role-mapping scope ${scope} is forbidden`)
    }
    require(errors, permission.resourceType !== "Clients" &&
      permission.resourceType !==
        "Organizations", `active FGAP resource type ${permission.resourceType} is forbidden`)
    require(errors, !permission.resources?.includes("*") &&
      !permission.scopes?.includes(
        "*",
      ), "FGAP wildcard permission is forbidden")
  }
}

function rejectCoarseRoleMappings(errors, roles, clients) {
  const mappings = [
    ...(roles ?? []).flatMap((role) =>
      Object.values(role.clientRoleMappings ?? {}).flat(),
    ),
    ...(clients ?? []).flatMap((client) =>
      Object.values(client.serviceAccountClientRoleMappings ?? {}).flat(),
    ),
  ]
  for (const role of mappings) {
    if (forbiddenCoarseAdminRoles.has(role)) {
      errors.push(`coarse realm-management role ${role} is forbidden`)
    }
  }
}

function findForbiddenCredentialKeys(value, path = "$") {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      findForbiddenCredentialKeys(item, `${path}[${index}]`),
    )
  }
  if (!isRecord(value)) return []
  return Object.entries(value).flatMap(([key, item]) => [
    ...(forbiddenValueKeys.has(key) ? [`${path}.${key}`] : []),
    ...findForbiddenCredentialKeys(item, `${path}.${key}`),
  ])
}

function findCredentialLikeValues(value, path = "$") {
  if (typeof value === "string") {
    return /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----|\bAKIA[0-9A-Z]{16}\b|\bgh[opsu]_[A-Za-z0-9]{20,}\b/.test(
      value,
    )
      ? [path]
      : []
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      findCredentialLikeValues(item, `${path}[${index}]`),
    )
  }
  if (!isRecord(value)) return []
  return Object.entries(value).flatMap(([key, item]) =>
    findCredentialLikeValues(item, `${path}.${key}`),
  )
}

function fgapPermission(name, resourceType, scopes, policies, resources) {
  return {
    name,
    policies,
    ...(resources ? { resources } : {}),
    resourceType,
    scopes,
  }
}

function evaluation(principal, resourceType, resource, scope, expected) {
  return { expected, principal, resource, resourceType, scope }
}

function findPhase(plan, id) {
  return plan?.phases?.find((phase) => phase.id === id)
}

function require(errors, condition, message) {
  if (!condition) errors.push(message)
}

function requireEqual(errors, actual, expected, label) {
  require(errors, actual ===
    expected, `${label} must be ${JSON.stringify(expected)}`)
}

function requireAtMost(errors, actual, maximum, label) {
  require(errors, Number.isInteger(actual) &&
    actual > 0 &&
    actual <=
      maximum, `${label} must be a positive integer no greater than ${maximum}`)
}

function requireIncludes(errors, values, expected, label) {
  require(errors, Array.isArray(values) &&
    values.includes(expected), `${label} must include ${expected}`)
}

function requireExactStrings(errors, actual, expected, label) {
  const normalizedActual = Array.isArray(actual) ? [...actual].sort() : actual
  const normalizedExpected = [...expected].sort()
  requireJsonEqual(errors, normalizedActual, normalizedExpected, label)
}

function requireJsonEqual(errors, actual, expected, label) {
  require(errors, canonicalJson(actual) ===
    canonicalJson(expected), `${label} does not match the reviewed boundary`)
}

function canonicalJson(value) {
  if (Array.isArray(value)) return JSON.stringify(value.map(canonicalValue))
  return JSON.stringify(canonicalValue(value))
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue)
  if (!isRecord(value)) return value
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalValue(item)]),
  )
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex")
}

function isMain() {
  return process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
}

if (isMain()) {
  const report = verificationReport()
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  if (report.result !== "pass") process.exitCode = 1
}
