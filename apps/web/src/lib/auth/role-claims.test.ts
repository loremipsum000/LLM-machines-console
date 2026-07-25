import { describe, expect, it } from "vitest"
import {
  extractGroups,
  extractGroupsFromAccessToken,
  extractRealmRoles,
  extractRealmRolesFromAccessToken,
  mergeGroups,
  mergeRoles,
} from "./role-claims"

describe("auth role claim helpers", () => {
  it("extracts realm roles from the profile payload", () => {
    expect(
      extractRealmRoles({
        realm_access: { roles: ["admin", "builder", 42, null] },
      }),
    ).toEqual(["admin", "builder"])
  })

  it("extracts realm roles from a Keycloak access token payload", () => {
    const token = makeUnsignedJwt({
      realm_access: { roles: ["admin", "consumer"] },
    })

    expect(extractRealmRolesFromAccessToken(token)).toEqual([
      "admin",
      "consumer",
    ])
  })

  it("deduplicates roles from multiple sources", () => {
    expect(mergeRoles(["admin", "consumer"], ["admin", "builder"])).toEqual([
      "admin",
      "consumer",
      "builder",
    ])
  })

  it("extracts normalized Keycloak groups separately from realm roles", () => {
    const token = makeUnsignedJwt({
      groups: ["/Security", "/Parent/Engineering", 42, null],
      realm_access: { roles: ["consumer"] },
    })

    expect(extractGroups({ groups: ["/Security", "Engineering"] })).toEqual([
      "Security",
      "Engineering",
    ])
    expect(extractGroupsFromAccessToken(token)).toEqual([
      "Security",
      "Engineering",
    ])
    expect(mergeGroups(["Security"], ["/Security", "/Parent/Finance"])).toEqual(
      ["Security", "Finance"],
    )
  })
})

function makeUnsignedJwt(payload: object): string {
  return [
    encodeBase64Url({ alg: "none", typ: "JWT" }),
    encodeBase64Url(payload),
    "",
  ].join(".")
}

function encodeBase64Url(value: object): string {
  return Buffer.from(JSON.stringify(value))
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
}
