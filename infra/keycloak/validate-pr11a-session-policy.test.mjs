import assert from "node:assert/strict"
import { test } from "node:test"
import {
  readHumanRealmSeed,
  readPr11aSessionPolicy,
  validatePr11aSessionPolicy,
  verifyCheckedInPr11aSessionPolicy,
} from "./validate-pr11a-session-policy.mjs"

test("checked-in R1-S1 Keycloak policy is exact and source-only", () => {
  assert.deepEqual(verifyCheckedInPr11aSessionPolicy(), [])
})

test("version, lifecycle, PKCE, and offline-token drift fail closed", () => {
  const seed = readHumanRealmSeed()
  const mutations = [
    (value) => {
      value.keycloakRuntime.exactVersion = "26.7.1"
    },
    (value) => {
      value.realm.accessTokenSeconds = 301
    },
    (value) => {
      value.realm.ssoSessionIdleSeconds = 28801
    },
    (value) => {
      value.realm.ssoSessionMaxSeconds = 86401
    },
    (value) => {
      value.realm.refreshTokenMaxReuse = 1
    },
    (value) => {
      value.realm.offlineBrowserTokens = true
    },
    (value) => {
      value.consoleClient.pkceCodeChallengeMethod = "plain"
    },
    (value) => {
      value.consoleClient.directAccessGrants = true
    },
    (value) => {
      value.consoleClient.optionalClientScopes = ["offline_access"]
    },
  ]

  for (const mutate of mutations) {
    const policy = readPr11aSessionPolicy()
    mutate(policy)
    assert.notDeepEqual(validatePr11aSessionPolicy(policy, seed), [])
  }
})

test("native administration, retired authority, and false runtime status fail closed", () => {
  const seed = readHumanRealmSeed()
  const mutations = [
    (value) => {
      value.sourceBoundary.nativeCustomerKeycloakAdminConsole = true
    },
    (value) => {
      value.sourceBoundary.liveKeycloakMutation = true
    },
    (value) => {
      value.sourceBoundary.browserReceivesRefreshToken = true
    },
    (value) => {
      value.metadata.runtimeQualification = "PASSED"
    },
    (value) => {
      value.preGenesisAuthentication.roleProtectedActions.push(
        "litellm.routes_keys.edit",
      )
    },
    (value) => {
      value.preGenesisAuthentication.mandatoryTotp = true
    },
  ]

  for (const mutate of mutations) {
    const policy = readPr11aSessionPolicy()
    mutate(policy)
    assert.notDeepEqual(validatePr11aSessionPolicy(policy, seed), [])
  }
})

test("the human realm client rejects callback, CORS, and backchannel broadening", () => {
  const policy = readPr11aSessionPolicy()
  const mutations = [
    (seed) => {
      seed.clients.find(
        ({ clientId }) => clientId === "console-web",
      ).runtimeBindings.validRedirectUris = ["*"]
    },
    (seed) => {
      seed.clients.find(
        ({ clientId }) => clientId === "console-web",
      ).runtimeBindings.webOrigins = ["+"]
    },
    (seed) => {
      seed.clients.find(
        ({ clientId }) => clientId === "console-web",
      ).keycloakClientAttributes["backchannel.logout.session.required"] =
        "false"
    },
    (seed) => {
      seed.clients.find(
        ({ clientId }) => clientId === "console-web",
      ).keycloakClientAttributes["pkce.code.challenge.method"] = "plain"
    },
    (seed) => {
      seed.offlineAccessPolicy.retainedClientOptionalScopes["console-web"] = [
        "offline_access",
      ]
    },
  ]

  for (const mutate of mutations) {
    const seed = readHumanRealmSeed()
    mutate(seed)
    assert.notDeepEqual(validatePr11aSessionPolicy(policy, seed), [])
  }
})
