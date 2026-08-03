import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const directory = dirname(fileURLToPath(import.meta.url))

const exactHighRiskActions = [
  "activity_audit.export",
  "applications.create_delete",
  "applications.credentials.test_rotate_revoke",
  "applications.policy.change",
  "applications.reenable",
  "firecrawl.enable_reenable",
  "isolation.activate",
  "team.local_password.manage",
  "team.users_roles.manage",
  "updates.apply",
]

const exactPolicy = {
  apiVersion: "inference-core.llm-machines/v1",
  kind: "LogicalKeycloakConsoleSessionPolicy",
  metadata: {
    changePackage: "R1-S1",
    containsCredentials: false,
    parentPackage: "PR-11A",
    runtimeQualification: "NOT_EVALUATED_RUNTIME",
    runtimeQualificationOwner: "Q0",
    sourceStatus: "SOURCE_ONLY",
  },
  keycloakRuntime: {
    exactVersion: "26.7.0",
    q0Image: "quay.io/keycloak/keycloak:26.7.0",
  },
  realm: {
    accessTokenSeconds: 300,
    name: "llm-machines",
    offlineBrowserTokens: false,
    refreshTokenMaxReuse: 0,
    revokeRefreshToken: true,
    ssoSessionIdleSeconds: 1800,
    ssoSessionMaxSeconds: 28800,
  },
  consoleClient: {
    authorizationCodeFlow: true,
    browserTokenEndpointAccess: false,
    clientAuthentication: "confidential-generated-outside-source",
    clientId: "console-web",
    directAccessGrants: false,
    implicitFlow: false,
    optionalClientScopes: [],
    pkceCodeChallengeMethod: "S256",
    runtimeBindings: {
      validRedirectUris: [
        "product-ingress-origin-plus-/api/console/session/callback",
      ],
      webOrigins: [],
    },
    serviceAccounts: false,
    backchannelLogout: {
      enabled: true,
      path: "/api/internal/console-session/backchannel-logout",
      runtimeOriginBinding: "product-ingress-origin",
      sessionRequired: true,
    },
  },
  mfa: {
    acceptedAmrMethods: ["hwk", "otp", "webauthn", "webauthn-passwordless"],
    adminRequired: true,
    exactHighRiskActions,
    freshAuthTimeRequired: true,
    freshnessSeconds: 300,
    highRiskElevationRequired: true,
    operatorSignInMfa: true,
  },
  sourceBoundary: {
    browserReceivesAccessToken: false,
    browserReceivesRefreshToken: false,
    credentialsInSource: false,
    liveKeycloakMutation: false,
    nativeCustomerKeycloakAdminConsole: false,
    sourceBehaviorRequired: [
      "concurrent-refresh-serialization",
      "expired-and-revoked-session-classification",
      "identity-outage-without-logout-loop",
      "multiple-browser-tabs",
      "one-refresh-one-replay",
      "return-path-normalization",
      "token-and-cookie-non-retention",
    ],
    q0Required: [
      "backchannel-logout",
      "clock-skew",
      "expired-and-revoked-token-observation",
      "keycloak-restart",
      "keycloak-service-outage",
      "live-client-policy",
      "live-offline-token-rejection",
      "live-refresh-reuse-detection",
      "mfa-enforcement",
    ],
  },
}

const expectedConsoleClient = {
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
  protocolMappers: [
    {
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
    },
  ],
  runtimeBindings: {
    validRedirectUris: [
      "product-ingress-origin-plus-/api/console/session/callback",
    ],
    webOrigins: [],
  },
  standardFlowEnabled: true,
  serviceAccountsEnabled: false,
}

export function readPr11aSessionPolicy(root = directory) {
  return JSON.parse(
    readFileSync(resolve(root, "pr11a-console-session-policy.json"), "utf8"),
  )
}

export function readHumanRealmSeed(root = directory) {
  return JSON.parse(
    readFileSync(resolve(root, "inference-core-realm-seed.json"), "utf8"),
  )
}

export function validatePr11aSessionPolicy(policy, seed) {
  const errors = []
  if (!sameJson(policy, exactPolicy)) {
    errors.push(
      "R1-S1 Console session policy differs from the exact source contract",
    )
  }

  const consoleClient = seed?.clients?.find?.(
    ({ clientId }) => clientId === "console-web",
  )
  if (!sameJson(consoleClient, expectedConsoleClient)) {
    errors.push("console-web differs from the exact R1-S1 client boundary")
  }

  for (const key of [
    "accessTokenSeconds",
    "ssoSessionIdleSeconds",
    "ssoSessionMaxSeconds",
    "revokeRefreshToken",
    "refreshTokenMaxReuse",
  ]) {
    if (seed?.realm?.[key] !== exactPolicy.realm[key]) {
      errors.push(`human realm differs from R1-S1 ${key}`)
    }
  }

  const humanMfa = seed?.authentication?.humanMfa
  if (
    !sameJson(
      humanMfa?.acceptedAmrMethods,
      exactPolicy.mfa.acceptedAmrMethods,
    ) ||
    !sameJson(humanMfa?.requiredForRealmRoles, ["admin", "operator"]) ||
    !sameJson(humanMfa?.accessTokenEvidence?.requiredClaims, [
      "amr",
      "auth_time",
    ]) ||
    humanMfa?.accessTokenEvidence?.acrOnlySufficient !== false
  ) {
    errors.push("human MFA evidence differs from the R1-S1 source contract")
  }

  const optionalScopes = seed?.offlineAccessPolicy?.retainedClientOptionalScopes
  if (
    seed?.offlineAccessPolicy?.realmRoleName !== "offline_access" ||
    seed?.offlineAccessPolicy?.realmDefaultRole?.realmRoleComposites?.includes?.(
      "offline_access",
    ) ||
    !optionalScopes ||
    Object.values(optionalScopes).some(
      (scopes) => !Array.isArray(scopes) || scopes.includes("offline_access"),
    ) ||
    consoleClient?.defaultClientScopes?.includes?.("offline_access") ||
    consoleClient?.optionalClientScopes?.includes?.("offline_access")
  ) {
    errors.push("offline browser token boundary differs from R1-S1")
  }

  if (
    policy?.mfa?.exactHighRiskActions?.some?.((action) =>
      /^(expert_access|grafana|litellm|vendor_maintenance)\./.test(action),
    )
  ) {
    errors.push("retired expert or vendor authority is present in R1-S1")
  }

  return errors.sort()
}

export function verifyCheckedInPr11aSessionPolicy(root = directory) {
  return validatePr11aSessionPolicy(
    readPr11aSessionPolicy(root),
    readHumanRealmSeed(root),
  )
}

function sameJson(left, right) {
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right))
}

function normalize(value) {
  if (Array.isArray(value)) {
    return value.map(normalize)
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
        .map(([key, nested]) => [key, normalize(nested)]),
    )
  }
  return value
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const errors = verifyCheckedInPr11aSessionPolicy()
  if (errors.length > 0) {
    process.stderr.write(`${errors.join("\n")}\n`)
    process.exitCode = 1
  } else {
    process.stdout.write(
      "R1-S1 Keycloak source policy valid; Q0 runtime not evaluated.\n",
    )
  }
}
