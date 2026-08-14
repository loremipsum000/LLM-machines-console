import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const evidencePath =
  "docs/reduction/inference-core/f0-n3-keycloak-native-access.json"

async function readEvidence() {
  return JSON.parse(await readFile(evidencePath, "utf8"))
}

test("F0-N3 binds exact Keycloak 26.7.0 and keeps native ingress inactive", async () => {
  const evidence = await readEvidence()
  assert.equal(evidence.status, "PASS")
  assert.equal(evidence.version, "26.7.0")
  assert.equal(
    evidence.image.index,
    "sha256:0f198be292568439d700cdbfb893e69a6009bb43a94a06a945b1d3d506c76b13",
  )
  assert.equal(
    evidence.image.platformManifest,
    "sha256:26939e1318d6f008fc2ee6e10cec1cf8f1ba8a21846c1bc81b91ed0506bc2a7a",
  )
  assert.equal(evidence.authority.nativeIngress, "INACTIVE_PENDING_F0_N5")
  assert.equal(
    evidence.authority.directListener,
    "LOOPBACK_ONLY_CHARACTERIZATION",
  )
  assert.equal(evidence.runtimeQualified, false)
  assert.deepEqual(evidence.theme, {
    fileCount: 25,
    inventorySha256:
      "ec32ce8b4f5f6d1de830ba2285bf51f90721d9cce386f5ebbd351108beb4ae45",
    name: "llm-machines",
  })
})

test("F0-N3 proves branded password login and exact Admin and Operator boundaries", async () => {
  const evidence = await readEvidence()
  assert.deepEqual(
    {
      authorizationCode: evidence.authentication.authorizationCode,
      brandedTheme: evidence.authentication.brandedTheme,
      consoleSessionForwarded: evidence.authentication.consoleSessionForwarded,
      idleSeconds: evidence.authentication.idleSeconds,
      mandatoryTotp: evidence.authentication.mandatoryTotp,
      maximumSeconds: evidence.authentication.maximumSeconds,
      passwordOnly: evidence.authentication.passwordOnly,
      pkceS256: evidence.authentication.pkceS256,
    },
    {
      authorizationCode: true,
      brandedTheme: "llm-machines",
      consoleSessionForwarded: false,
      idleSeconds: 28_800,
      mandatoryTotp: false,
      maximumSeconds: 86_400,
      passwordOnly: true,
      pkceS256: true,
    },
  )
  assert.deepEqual(evidence.authentication.subjectBound, {
    adminEventDetailsRetained: false,
    authenticatedUserIdMatched: true,
    createAndUpdateEventsBound: true,
    mechanism: "KEYCLOAK_ADMIN_EVENT_AUTH_DETAILS_USER_ID",
  })
  assert.deepEqual(evidence.authorization.Admin.approvedOperations, {
    passwordReset: 204,
    sessionInvalidateUnknown: 404,
    sessionsList: 200,
    upstreamUserDelete: 204,
    userCreate: 201,
    userUpdate: 204,
    usersList: 200,
  })
  assert.deepEqual(evidence.authorization.Admin.deniedOperations, {
    clients: 403,
    groupMutation: 403,
    identityProviders: 403,
    impersonation: 403,
    masterRealm: 403,
    realmCreation: 403,
    realmMutation: 403,
    roleMapping: 403,
    roles: 403,
    unrelatedRealm: 404,
  })
  assert.equal(evidence.authorization.Operator.adminConsole, "DENY")
  assert.equal(evidence.authorization.Operator.browserDenialPage, true)
  assert.equal(evidence.authorization.Operator.usersListStatus, 403)
  assert.equal(evidence.authorization.serverAdministrator, false)
})

test("F0-N3 binds the accepted layered user-delete denial", async () => {
  const evidence = await readEvidence()
  assert.deepEqual(evidence.layeredDeleteControl, {
    activationBlockedUntilEdgeProof: true,
    requiredEdgeStatus: 403,
    requiredMethod: "DELETE",
    requiredPath: "/keycloak/admin/realms/llm-machines/users/{uuid}",
    upstreamStatus: 204,
  })
})

test("F0-N3 records native browser dependencies without credential values", async () => {
  const evidenceText = await readFile(evidencePath, "utf8")
  const evidence = JSON.parse(evidenceText)
  const route = (method, path) =>
    evidence.routeInventory.find(
      (candidate) => candidate.method === method && candidate.path === path,
    )
  assert.deepEqual(
    route("GET", "/keycloak/realms/llm-machines/protocol/openid-connect/auth")
      .queryKeys,
    [
      "client_id",
      "code_challenge",
      "code_challenge_method",
      "nonce",
      "redirect_uri",
      "response_mode",
      "response_type",
      "scope",
      "state",
    ],
  )
  assert.deepEqual(
    route("POST", "/keycloak/realms/llm-machines/login-actions/authenticate")
      .requestHeaders,
    ["accept", "content-type", "cookie", "origin"],
  )
  assert.ok(
    route(
      "POST",
      "/keycloak/realms/llm-machines/protocol/openid-connect/token",
    ),
  )
  assert.ok(
    route(
      "GET",
      "/keycloak/realms/llm-machines/protocol/openid-connect/logout",
    ),
  )
  assert.ok(route("GET", "/keycloak/admin/llm-machines/console/"))
  assert.deepEqual(
    route("GET", "/keycloak/admin/serverinfo").responseStatuses,
    [200, 403],
  )
  assert.ok(
    evidence.routeInventory.some((candidate) =>
      candidate.path.startsWith("/keycloak/resources/"),
    ),
  )
  const cookieNames = evidence.cookies.map(({ name }) => name).sort()
  assert.deepEqual(cookieNames, [
    "AUTH_SESSION_ID",
    "KC_AUTH_SESSION_HASH",
    "KEYCLOAK_IDENTITY",
    "KEYCLOAK_SESSION",
  ])
  assert.equal(evidence.consoleSessionForwarded, false)
  assert.equal(evidence.credentialMaterialPrinted, false)
  assert.equal(evidence.credentialsRetained, false)
  assert.equal(
    evidence.routeInventory.every(
      (candidate) => candidate.responseStatuses.length > 0,
    ),
    true,
  )
  assert.doesNotMatch(
    evidenceText,
    /(?:access_token|refresh_token|client_secret|Bearer\s+|eyJ[A-Za-z0-9_-]{20})/i,
  )
  assert.doesNotMatch(evidenceText, /127\.0\.0\.1:\d+/)
  for (const cookie of evidence.cookies) {
    assert.deepEqual(Object.keys(cookie).sort(), [
      "domain",
      "httpOnly",
      "name",
      "path",
      "sameSite",
      "secure",
    ])
  }
})

test("F0-N3 proves native logout, restart, outage, and cross-origin denial", async () => {
  const evidence = await readEvidence()
  assert.equal(evidence.logout, "NATIVE_SESSION_CLEARED")
  assert.equal(
    evidence.restart,
    "SERVER_RESTARTED_PERSISTENT_REALM_READY_NATIVE_SESSION_MUST_REVALIDATE",
  )
  assert.equal(
    evidence.outage,
    "IDENTITY_UNAVAILABLE_WITHOUT_FALLBACK_OR_ALTERNATE_AUTHORITY",
  )
  assert.equal(
    evidence.csrfAndCors.crossOriginBearerMutationObservedStatus,
    403,
  )
})
