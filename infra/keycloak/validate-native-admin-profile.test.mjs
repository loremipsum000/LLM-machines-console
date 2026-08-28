import assert from "node:assert/strict"
import test from "node:test"
import {
  readNativeAdminProfile,
  readNativeAdminRealmSeed,
  validateNativeAdminProfile,
  verifyCheckedInNativeAdminProfile,
} from "./validate-native-admin-profile.mjs"

test("checked-in F0-N3 profile is exact, layered, and inactive", () => {
  assert.deepEqual(verifyCheckedInNativeAdminProfile(), [])
})

test("realm, role, session, and activation drift fail closed", () => {
  const mutations = [
    (value) => {
      value.runtime.version = "26.7.1"
    },
    (value) => {
      value.activation = "ACTIVE"
    },
    (value) => {
      value.authentication.mandatoryTotp = true
    },
    (value) => {
      value.authentication.idleSeconds = 1800
    },
    (value) => {
      value.realmManagementRoles.Admin.push("realm-admin")
    },
    (value) => {
      value.customerRoles.Operator = "SCOPED_APPLIANCE_REALM_ADMIN"
    },
    (value) => {
      value.theme.inventorySha256 = "0".repeat(64)
    },
  ]
  for (const mutate of mutations) {
    const profile = readNativeAdminProfile()
    mutate(profile)
    assert.notDeepEqual(
      validateNativeAdminProfile(profile, readNativeAdminRealmSeed()),
      [],
    )
  }
})

test("user deletion and group mutation must remain outside effective authority", () => {
  const mutations = [
    (value) => {
      value.layeredDeleteControl.activationFailClosed = false
    },
    (value) => {
      value.layeredDeleteControl.requiredF0N5Denial.method = "POST"
    },
    (value) => {
      value.fineGrainedAdminPermissionsV2.permissions
        .find(({ resourceType }) => resourceType === "Groups")
        .scopes.push("manage-members")
    },
    (value) => {
      value.fineGrainedAdminPermissionsV2.permissions.find(
        ({ resourceType }) => resourceType === "Users",
      ).scopes = ["view"]
    },
  ]
  for (const mutate of mutations) {
    const profile = readNativeAdminProfile()
    mutate(profile)
    assert.notDeepEqual(
      validateNativeAdminProfile(profile, readNativeAdminRealmSeed()),
      [],
    )
  }
})
