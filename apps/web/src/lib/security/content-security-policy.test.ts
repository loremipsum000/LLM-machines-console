import { describe, expect, it } from "vitest"
import { buildContentSecurityPolicy } from "./content-security-policy"

describe("Console content security policy", () => {
  it("allows only one validated Identity origin for elevation forms", () => {
    expect(
      buildContentSecurityPolicy("fixture-nonce", {
        NODE_ENV: "production",
        WEB_IDENTITY_ORIGIN: "https://identity.example.test",
      }),
    ).toContain("form-action 'self' https://identity.example.test")
  })

  it.each([
    "http://identity.example.test",
    "https://identity.example.test/path",
    "https://identity.example.test/?query=unsafe",
    "https://identity.example.test/",
    "https://identity.example.test 'unsafe-inline'",
  ])("fails closed for an invalid Identity origin: %s", (identityOrigin) => {
    expect(
      buildContentSecurityPolicy("fixture-nonce", {
        NODE_ENV: "production",
        WEB_IDENTITY_ORIGIN: identityOrigin,
      }),
    ).toContain("form-action 'self';")
  })

  it("permits HTTP only for an explicit development fixture", () => {
    expect(
      buildContentSecurityPolicy("fixture-nonce", {
        NODE_ENV: "development",
        WEB_IDENTITY_ORIGIN: "http://identity.localhost:18443",
      }),
    ).toContain("form-action 'self' http://identity.localhost:18443")
  })
})
