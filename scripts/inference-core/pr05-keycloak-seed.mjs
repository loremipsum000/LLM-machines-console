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
export const applicationRealmSeedPath = fileURLToPath(
  new URL(
    "../../infra/keycloak/inference-core-application-realm-seed.json",
    import.meta.url,
  ),
)
export const applicationCommissioningPlanPath = fileURLToPath(
  new URL(
    "../../infra/keycloak/inference-core-application-realm-commissioning.json",
    import.meta.url,
  ),
)

const expectedQueryRoles = ["query-groups", "query-users"]
const requiredAuthenticationClaims = ["amr", "auth_time"]
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
const forbiddenNormalizedValueKeys = new Set(
  [
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
  ].map(normalizeObjectKey),
)

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
    grafana: [],
  },
}

const expectedBrowserFlow = {
  alias: "llm-machines-browser-password",
  binding: "browser",
  builtIn: false,
  executions: [
    {
      amrReference: null,
      authenticator: "auth-cookie",
      path: "llm-machines-browser-password/Cookie",
      requirement: "ALTERNATIVE",
    },
    {
      flowAlias: "llm-machines-browser-password-forms",
      path: "llm-machines-browser-password/Forms",
      requirement: "ALTERNATIVE",
    },
    {
      amrReference: "pwd",
      authenticator: "auth-username-password-form",
      path: "llm-machines-browser-password/Forms/Username Password Form",
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
    directAccessGrantsEnabled: false,
    flows: ["authorization-code-pkce"],
    frontchannelLogoutEnabled: false,
    fullScopeAllowed: false,
    idTokenClaims: [
      "aud",
      "auth_time",
      "exp",
      "iat",
      "iss",
      "nonce",
      "realm_access.roles",
      "sid",
      "sub",
    ],
    implicitFlowEnabled: false,
    keycloakClientAttributes: {
      "backchannel.logout.session.required": "true",
      "backchannel.logout.url":
        "product-ingress-origin-plus-/api/internal/console-session/backchannel-logout",
      "pkce.code.challenge.method": "S256",
    },
    optionalClientScopes: [],
    pkceCodeChallengeMethod: "S256",
    protocol: "openid-connect",
    protocolMappers: [expectedAudienceMapper],
    runtimeBindings: {
      validRedirectUris: [
        "product-ingress-origin-plus-/api/console/session/callback",
      ],
      webOrigins: [],
    },
    standardFlowEnabled: true,
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
  {
    accessTokenClaims: ["amr", "auth_time", "realm_access.roles", "sub"],
    clientAuthentication: "client-secret-generated-outside-seed",
    clientId: "grafana",
    credentialIncluded: false,
    defaultClientScopes: ["basic", "email", "llm-machines-amr", "profile"],
    flows: ["authorization-code-pkce"],
    fullScopeAllowed: false,
    idTokenClaims: ["email", "email_verified", "realm_access.roles", "sub"],
    optionalClientScopes: [],
    pkceCodeChallengeMethod: "S256",
    protocol: "openid-connect",
    protocolMappers: [
      {
        config: {
          "access.token.claim": "true",
          "claim.name": "realm_access.roles",
          "id.token.claim": "true",
          "jsonType.label": "String",
          multivalued: "true",
          "userinfo.token.claim": "true",
        },
        consentRequired: false,
        name: "grafana-realm-roles",
        protocol: "openid-connect",
        protocolMapper: "oidc-usermodel-realm-role-mapper",
      },
    ],
    runtimeBindings: {
      redirectUri: "grafana-root-plus-login-generic-oauth",
      webOrigin: "grafana-root-origin",
    },
    scopeMappings: {
      realmRoles: ["admin", "operator"],
    },
    serviceAccountsEnabled: false,
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
    "customer-admin-manage-all-users",
    "Users",
    ["manage", "view"],
    ["customer-admin-role"],
  ),
  fgapPermission(
    "customer-admin-view-Admins-members",
    "Groups",
    ["view", "view-members"],
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
    appliesToPermission: "customer-admin-manage-all-users",
    compensatingControls: [
      "native-ingress-inactive-until-F0-N5",
      "product-edge-denies-user-delete-by-exact-method-and-path",
      "direct-Keycloak-port-denied-to-customer-networks",
      "no-bypass-proof-required-before-activation",
    ],
    id: "customer-admin-users-manage-delete-residual",
    inseparableOperations: ["create", "delete", "update"],
    reason:
      "Keycloak 26.7.0 FGAP v2 Users/manage does not isolate create and update from delete",
  },
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
  evaluation("customer-admin-role", "Users", "user:any", "manage", "PERMIT"),
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
    "DENY",
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
    "user:any",
    "reset-password",
    "PERMIT",
  ),
  evaluation(
    "customer-admin-role",
    "Users",
    "user:any",
    "reset-password",
    "PERMIT",
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
    requestingClients: ["console-human-admin", "console-web", "grafana"],
  },
]

const expectedApplicationRealm = {
  accessTokenSeconds: 300,
  adminPermissionsEnabled: true,
  bruteForceProtected: true,
  duplicateEmailsAllowed: false,
  editUsernameAllowed: false,
  enabled: true,
  loginWithEmailAllowed: false,
  masterRealm: false,
  name: "llm-machines-applications",
  refreshTokenMaxReuse: 0,
  registrationAllowed: false,
  rememberMe: false,
  resetPasswordAllowed: false,
  revokeRefreshToken: true,
  sslRequired: "external",
}

const expectedApplicationOfflineAccessPolicy = {
  managedClientDefaultScopes: [],
  managedClientOptionalScopes: [],
  realmDefaultRole: {
    name: "default-roles-llm-machines-applications",
    realmRoleComposites: [],
  },
  realmRoleName: "offline_access",
  retainedClientOptionalScopes: {
    "console-application-admin": [],
  },
}

const expectedManagedClientContract = {
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
}

const expectedApplicationClients = [
  {
    accessTokenSeconds: 60,
    authorizationServicesEnabled: false,
    clientAuthentication: "client-secret-generated-outside-seed",
    clientCredentialsUseRefreshToken: false,
    clientId: "console-application-admin",
    credentialIncluded: false,
    defaultClientScopes: ["roles"],
    directAccessGrantsEnabled: false,
    fullScopeAllowed: false,
    implicitFlowEnabled: false,
    optionalClientScopes: [],
    permissionClass: "application-oauth-client-admin",
    protocol: "openid-connect",
    serviceAccountClientRoleMappings: {
      "realm-management": ["query-clients"],
    },
    serviceAccountsEnabled: true,
    standardFlowEnabled: false,
  },
]

const expectedApplicationPermissionClasses = [
  {
    allowedFgapResourceTypes: ["Clients"],
    assignedClientId: "console-application-admin",
    fgapPolicy: "console-application-admin-service-account",
    id: "application-oauth-client-admin",
    status: "active-console-only",
  },
]

const expectedApplicationNegativeAuthorityConstraints = {
  "console-application-admin": {
    forbiddenFgapResourceTypes: ["Groups", "Organizations", "Roles", "Users"],
    forbiddenFgapScopes: [
      "map-role",
      "map-roles",
      "map-roles-client-scope",
      "map-roles-composite",
    ],
    forbiddenRealmManagementRoles: [
      "create-client",
      "manage-clients",
      "manage-realm",
      "realm-admin",
    ],
    requiredRealmManagementRoles: ["query-clients"],
  },
}

const expectedApplicationFgap = {
  enabled: true,
  feature: "admin-fine-grained-authz:v2",
  permissions: [
    fgapPermission(
      "console-application-admin-manage-application-realm-clients",
      "Clients",
      ["manage", "view"],
      ["console-application-admin-service-account"],
    ),
  ],
  policies: [
    {
      logic: "POSITIVE",
      name: "console-application-admin-service-account",
      type: "user",
      users: ["service-account:console-application-admin"],
    },
  ],
  resourceServerClientId: "admin-permissions",
  selectorResolution: {
    "service-account:console-application-admin":
      "resolve-service-account-user-uuid",
  },
  version: "v2",
}

const expectedApplicationResiduals = [
  {
    accepted: true,
    appliesToPermission:
      "console-application-admin-manage-application-realm-clients",
    compensatingControls: [
      "dedicated-application-realm-contains-no-human-authority",
      "managed-client-id-namespace-is-enforced-by-console",
      "console-identity-mutation-journal-required",
      "no-coarse-client-or-realm-management-role",
    ],
    id: "fgap-clients-manage-application-realm-breadth",
    reason:
      "Keycloak FGAP v2 grants Clients manage across the isolated Application realm",
  },
]

const expectedApplicationFgapEvaluationMatrix = [
  evaluation(
    "console-application-admin-service-account",
    "Clients",
    "client:any-in-application-realm",
    "view",
    "PERMIT",
  ),
  evaluation(
    "console-application-admin-service-account",
    "Clients",
    "client:any-in-application-realm",
    "manage",
    "PERMIT",
  ),
  evaluation(
    "console-application-admin-service-account",
    "Clients",
    "client:any-in-application-realm",
    "map-roles",
    "DENY",
  ),
  evaluation(
    "console-application-admin-service-account",
    "Users",
    "user:any",
    "manage",
    "DENY",
  ),
  evaluation(
    "console-application-admin-service-account",
    "Groups",
    "group:any",
    "manage",
    "DENY",
  ),
  evaluation(
    "console-application-admin-service-account",
    "Roles",
    "role:any",
    "map-role",
    "DENY",
  ),
  evaluation(
    "console-application-admin-service-account",
    "Organizations",
    "organization:any",
    "manage",
    "DENY",
  ),
]

const expectedApplicationTokenLifetimeTests = [
  {
    client: "managed-client:llmm-app-UUID",
    expectedAccessTokenSeconds: 300,
  },
  {
    client: "console-application-admin",
    expectedAccessTokenSeconds: 60,
  },
]

const expectedApplicationTokenNegativeTests = [
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
]

const expectedApplicationMetadata = {
  changePackage: "PR-06",
  containsCredentials: false,
  packagingTarget: "PR-12",
}

const expectedApplicationKeycloakRuntime = {
  customProviderPlugins: [],
  minimumVersion: "26.6.0",
  requiredFeatures: ["admin-fine-grained-authz:v2"],
}

const expectedApplicationCommissioningPhases = [
  {
    completionAssertions: [
      "keycloak-version-is-at-least-26.6.0",
      "admin-fine-grained-authz-v2-is-enabled",
      "application-realm-admin-permissions-are-enabled",
      "application-realm-is-not-master",
      "application-realm-default-access-token-lifetime-is-300-seconds",
      "application-admin-access-token-lifetime-is-60-seconds",
      "application-admin-uses-client-credentials-only",
      "application-admin-has-query-clients-only",
      "application-admin-fgap-is-Clients-manage-and-view-only",
      "application-admin-has-no-Users-Groups-Roles-or-Organizations-authority",
      "human-realm-clients-are-absent",
      "no-human-user-group-role-or-browser-flow-is-seeded",
      "no-client-credential-is-in-seed",
      "offline_access-is-absent-from-retained-client-optional-scopes",
      "offline_access-is-absent-from-the-realm-default-role-composite",
    ],
    id: "validate-application-realm-seed",
    mutationOwner: "packaging-pr12",
  },
  {
    completionAssertions: [
      "application-admin-service-client-is-enabled",
      "application-admin-service-token-expires-after-60-seconds",
      "application-admin-live-negative-controls-passed",
      "all-application-fgap-v2-evaluations-match-the-verification-matrix",
      "service-client-value-stored-outside-git",
    ],
    id: "commission-application-admin",
    mutationOwner: "commissioning-control-plane",
  },
  {
    completionAssertions: [
      "managed-client-id-matches-llmm-app-UUID",
      "managed-client-uses-client-credentials-only",
      "managed-client-has-empty-default-and-optional-scopes",
      "managed-client-token-audience-is-console-bff",
      "managed-client-token-expires-after-300-seconds",
      "managed-client-token-issuer-is-application-realm",
      "managed-client-does-not-receive-refresh-or-offline-token",
      "human-realm-remains-outside-application-admin-authority",
    ],
    id: "qualify-managed-application-client-contract",
    mutationOwner: "packaging-pr12",
  },
]

export function loadKeycloakArtifacts() {
  const seedBytes = readFileSync(realmSeedPath)
  const commissioningBytes = readFileSync(commissioningPlanPath)
  const applicationSeedBytes = readFileSync(applicationRealmSeedPath)
  const applicationCommissioningBytes = readFileSync(
    applicationCommissioningPlanPath,
  )
  return {
    applicationCommissioning: JSON.parse(
      applicationCommissioningBytes.toString("utf8"),
    ),
    applicationCommissioningBytes,
    applicationSeed: JSON.parse(applicationSeedBytes.toString("utf8")),
    applicationSeedBytes,
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
    seed?.metadata?.changePackage,
    "PR-09",
    "seed change package",
  )
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
  validateHumanAuthentication(errors, seed?.authentication)
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
    "denied",
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
    plan?.metadata?.changePackage,
    "PR-09",
    "commissioning change package",
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
    "application-admin-is-absent-from-human-realm",
    "human-admin-has-no-Clients-authority",
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
    "llm-machines-browser-password-is-the-browser-binding",
    "username-password-execution-reference-is-pwd",
    "mandatory-totp-is-disabled-for-pre-genesis",
    "oidc-amr-mapper-adds-amr-to-access-token",
    "basic-client-scope-adds-auth_time-to-access-token",
    "console-web-audience-mapper-hardcodes-console-bff",
    "scope-offline_access-does-not-yield-an-offline-token",
    "grafana-admin-token-maps-to-Editor",
    "grafana-operator-native-login-is-denied",
    "grafana-unrecognized-role-is-denied",
    "grafana-dual-retained-role-token-is-denied",
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
    ["UPDATE_PASSWORD"],
    "bootstrap Admin required actions",
  )
  requireExactStrings(
    errors,
    firstOperator?.requiredActions,
    ["UPDATE_PASSWORD"],
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
    "customer-admin-user-delete-is-denied-by-F0-N5-product-edge-before-activation",
    "commissioning closure",
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

  const evidence = plan?.preGenesisAuthenticationEvidence ?? {}
  requireExactStrings(
    errors,
    evidence.requiredAccessTokenClaims,
    requiredAuthenticationClaims,
    "pre-Genesis authentication claims",
  )
  requireEqual(
    errors,
    evidence.passwordReference,
    "pwd",
    "pre-Genesis password AMR reference",
  )
  requireEqual(
    errors,
    evidence.mandatoryTotp,
    false,
    "pre-Genesis mandatory TOTP state",
  )
  requireEqual(
    errors,
    evidence.roleAuthorizationRequired,
    true,
    "pre-Genesis role authorization boundary",
  )

  for (const path of findForbiddenCredentialKeys(plan)) {
    errors.push(`credential-bearing field is forbidden at ${path}`)
  }
  for (const path of findCredentialLikeValues(plan)) {
    errors.push(`credential-like value is forbidden at ${path}`)
  }

  return errors
}

export function validateApplicationKeycloakSeed(seed) {
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
      "managedClientContract",
      "metadata",
      "offlineAccessPolicy",
      "realm",
      "roles",
      "serviceNegativeAuthorityConstraints",
      "servicePermissionClasses",
      "users",
    ],
    "Application seed top-level fields",
  )
  requireEqual(
    errors,
    seed?.apiVersion,
    "inference-core.llm-machines/v1",
    "Application seed apiVersion",
  )
  requireEqual(
    errors,
    seed?.kind,
    "LogicalKeycloakApplicationRealmSeed",
    "Application seed kind",
  )
  requireJsonEqual(
    errors,
    seed?.metadata,
    expectedApplicationMetadata,
    "Application seed metadata",
  )
  requireJsonEqual(
    errors,
    seed?.keycloakRuntime,
    expectedApplicationKeycloakRuntime,
    "Application Keycloak runtime",
  )
  requireJsonEqual(
    errors,
    seed?.realm,
    expectedApplicationRealm,
    "Application realm",
  )
  require(errors, seed?.realm?.name !== "master" &&
    seed?.realm?.masterRealm ===
      false, "Application realm must never be master")
  requireEqual(
    errors,
    seed?.realm?.accessTokenSeconds,
    300,
    "Application access-token lifetime",
  )
  requireJsonEqual(
    errors,
    seed?.authentication,
    null,
    "Application human authentication boundary",
  )
  requireJsonEqual(errors, seed?.clientScopes, [], "Application client scopes")
  requireJsonEqual(errors, seed?.roles, [], "Application realm roles")
  requireJsonEqual(errors, seed?.groups, [], "Application groups")
  requireJsonEqual(errors, seed?.users, [], "Application users")
  requireJsonEqual(
    errors,
    seed?.offlineAccessPolicy,
    expectedApplicationOfflineAccessPolicy,
    "Application offline-access policy",
  )
  requireJsonEqual(
    errors,
    seed?.managedClientContract,
    expectedManagedClientContract,
    "managed Application client contract",
  )
  requireJsonEqual(
    errors,
    seed?.clients,
    expectedApplicationClients,
    "Application seed clients",
  )
  requireEqual(
    errors,
    seed?.clients?.[0]?.accessTokenSeconds,
    60,
    "Application admin access-token lifetime",
  )
  requireJsonEqual(
    errors,
    seed?.servicePermissionClasses,
    expectedApplicationPermissionClasses,
    "Application service permission classes",
  )
  requireJsonEqual(
    errors,
    seed?.serviceNegativeAuthorityConstraints,
    expectedApplicationNegativeAuthorityConstraints,
    "Application negative authority constraints",
  )
  requireJsonEqual(
    errors,
    seed?.adminFineGrainedAuthorization,
    expectedApplicationFgap,
    "Application FGAP v2 contract",
  )
  requireJsonEqual(
    errors,
    seed?.knownResiduals,
    expectedApplicationResiduals,
    "Application accepted FGAP residuals",
  )
  rejectCoarseRoleMappings(errors, seed?.roles, seed?.clients)
  for (const permission of seed?.adminFineGrainedAuthorization?.permissions ??
    []) {
    require(errors, permission.resourceType ===
      "Clients", `Application FGAP resource type ${permission.resourceType} is forbidden`)
    for (const scope of permission.scopes ?? []) {
      require(errors, scope === "manage" ||
        scope === "view", `Application FGAP scope ${scope} is forbidden`)
    }
  }
  for (const path of findForbiddenCredentialKeys(seed)) {
    errors.push(`credential-bearing field is forbidden at ${path}`)
  }
  for (const path of findCredentialLikeValues(seed)) {
    errors.push(`credential-like value is forbidden at ${path}`)
  }
  return errors
}

export function validateApplicationCommissioningPlan(plan) {
  const errors = []
  requireExactStrings(
    errors,
    Object.keys(plan ?? {}),
    [
      "apiVersion",
      "fgapV2EvaluationMatrix",
      "kind",
      "metadata",
      "phases",
      "preconditions",
      "realm",
      "tokenLifetimeTests",
      "tokenNegativeTests",
    ],
    "Application commissioning top-level fields",
  )
  requireEqual(
    errors,
    plan?.apiVersion,
    "inference-core.llm-machines/v1",
    "Application commissioning apiVersion",
  )
  requireEqual(
    errors,
    plan?.kind,
    "LogicalKeycloakApplicationRealmCommissioningPlan",
    "Application commissioning kind",
  )
  requireJsonEqual(
    errors,
    plan?.metadata,
    expectedApplicationMetadata,
    "Application commissioning metadata",
  )
  requireEqual(
    errors,
    plan?.realm,
    "llm-machines-applications",
    "Application commissioning realm",
  )
  requireExactStrings(
    errors,
    plan?.preconditions,
    [
      "empty-application-realm",
      "offline-application-seed-validation-passed",
      "human-realm-commissioning-remains-independent",
    ],
    "Application commissioning preconditions",
  )
  requireJsonEqual(
    errors,
    plan?.phases,
    expectedApplicationCommissioningPhases,
    "Application commissioning phases",
  )
  requireJsonEqual(
    errors,
    plan?.fgapV2EvaluationMatrix,
    expectedApplicationFgapEvaluationMatrix,
    "Application FGAP v2 evaluation matrix",
  )
  requireJsonEqual(
    errors,
    plan?.tokenLifetimeTests,
    expectedApplicationTokenLifetimeTests,
    "Application token lifetime tests",
  )
  requireJsonEqual(
    errors,
    plan?.tokenNegativeTests,
    expectedApplicationTokenNegativeTests,
    "Application token negative tests",
  )
  for (const path of findForbiddenCredentialKeys(plan)) {
    errors.push(`credential-bearing field is forbidden at ${path}`)
  }
  for (const path of findCredentialLikeValues(plan)) {
    errors.push(`credential-like value is forbidden at ${path}`)
  }
  return errors
}

export function validateRealmIsolation(humanSeed, applicationSeed) {
  const errors = []
  require(errors, humanSeed?.realm?.name === "llm-machines" &&
    applicationSeed?.realm?.name === "llm-machines-applications" &&
    humanSeed?.realm?.name !==
      applicationSeed?.realm
        ?.name, "human and Application realms must remain distinct")
  const humanClientIds = new Set(
    (humanSeed?.clients ?? []).map(({ clientId }) => clientId),
  )
  const applicationClientIds = new Set(
    (applicationSeed?.clients ?? []).map(({ clientId }) => clientId),
  )
  require(errors, !humanClientIds.has(
    "console-application-admin",
  ), "Application admin client leaked into human realm")
  for (const clientId of [
    "console-web",
    "console-bff",
    "console-human-admin",
  ]) {
    require(errors, !applicationClientIds.has(
      clientId,
    ), `human client ${clientId} leaked into Application realm`)
  }
  require(errors, !(
    humanSeed?.adminFineGrainedAuthorization?.policies ?? []
  ).some(
    ({ name }) => name === "console-application-admin-service-account",
  ), "Application admin FGAP policy leaked into human realm")
  require(errors, !(
    applicationSeed?.adminFineGrainedAuthorization?.policies ?? []
  ).some(
    ({ name }) =>
      name === "console-human-admin-service-account" ||
      name === "customer-admin-role",
  ), "human FGAP policy leaked into Application realm")
  requireJsonEqual(
    errors,
    applicationSeed?.roles,
    [],
    "Application realm human roles",
  )
  requireJsonEqual(
    errors,
    applicationSeed?.groups,
    [],
    "Application realm human groups",
  )
  requireJsonEqual(
    errors,
    applicationSeed?.users,
    [],
    "Application realm human users",
  )
  return errors
}

export function verificationReport(artifacts = loadKeycloakArtifacts()) {
  const seedErrors = validateKeycloakSeed(artifacts.seed)
  const commissioningErrors = validateCommissioningPlan(artifacts.commissioning)
  const applicationSeedErrors = validateApplicationKeycloakSeed(
    artifacts.applicationSeed,
  )
  const applicationCommissioningErrors = validateApplicationCommissioningPlan(
    artifacts.applicationCommissioning,
  )
  const crossRealmErrors = validateRealmIsolation(
    artifacts.seed,
    artifacts.applicationSeed,
  )
  return {
    applicationCommissioning: {
      errors: applicationCommissioningErrors,
      sha256: sha256(artifacts.applicationCommissioningBytes),
    },
    applicationSeed: {
      errors: applicationSeedErrors,
      sha256: sha256(artifacts.applicationSeedBytes),
    },
    commissioning: {
      errors: commissioningErrors,
      sha256: sha256(artifacts.commissioningBytes),
    },
    crossRealm: { errors: crossRealmErrors },
    result:
      seedErrors.length === 0 &&
      commissioningErrors.length === 0 &&
      applicationSeedErrors.length === 0 &&
      applicationCommissioningErrors.length === 0 &&
      crossRealmErrors.length === 0
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
  requireEqual(errors, realm?.loginTheme, "llm-machines", "login theme")
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
  requireEqual(errors, realm?.ssoSessionIdleSeconds, 28800, "SSO idle lifetime")
  requireEqual(
    errors,
    realm?.ssoSessionMaxSeconds,
    86400,
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

function validateHumanAuthentication(errors, authentication) {
  requireJsonEqual(
    errors,
    authentication?.browserFlow,
    expectedBrowserFlow,
    "password-only browser flow",
  )
  const human = authentication?.humanAuthentication ?? {}
  requireEqual(
    errors,
    human.passwordOnlyPreGenesis,
    true,
    "password-only pre-Genesis profile",
  )
  requireEqual(errors, human.mandatoryTotp, false, "mandatory TOTP state")
  requireEqual(
    errors,
    human.roleAuthorizationRequired,
    true,
    "role authorization boundary",
  )
  requireExactStrings(
    errors,
    human.accessTokenEvidence?.requiredClaims,
    requiredAuthenticationClaims,
    "human authentication access-token claims",
  )
  requireEqual(
    errors,
    human.accessTokenEvidence?.requiredPasswordReference,
    "pwd",
    "password AMR reference",
  )
  const totpAction = authentication?.requiredActions?.find(
    ({ alias }) => alias === "CONFIGURE_TOTP",
  )
  requireEqual(
    errors,
    totpAction?.enabled,
    false,
    "TOTP required action disabled",
  )
  requireEqual(errors, totpAction?.defaultAction, false, "TOTP default action")
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
  const roleMappings = (roles ?? []).flatMap((role) =>
    Object.values(role.clientRoleMappings ?? {}).flat(),
  )
  for (const role of roleMappings) {
    if (forbiddenCoarseAdminRoles.has(role)) {
      errors.push(`coarse realm-management role ${role} is forbidden`)
    }
  }
  for (const client of clients ?? []) {
    const clientMappings = Object.values(
      client.serviceAccountClientRoleMappings ?? {},
    ).flat()
    for (const role of clientMappings) {
      const isApplicationQueryRole =
        client.clientId === "console-application-admin" &&
        role === "query-clients"
      if (forbiddenCoarseAdminRoles.has(role) && !isApplicationQueryRole) {
        errors.push(`coarse realm-management role ${role} is forbidden`)
      }
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
    ...(forbiddenNormalizedValueKeys.has(normalizeObjectKey(key))
      ? [`${path}.${key}`]
      : []),
    ...findForbiddenCredentialKeys(item, `${path}.${key}`),
  ])
}

function normalizeObjectKey(key) {
  return key.replace(/[^a-zA-Z0-9]/g, "").toLowerCase()
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
