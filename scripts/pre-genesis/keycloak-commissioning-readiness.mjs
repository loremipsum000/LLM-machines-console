import { createHash } from "node:crypto"

const expectedRoles = {
  admin: { group: "Admins", role: "admin" },
  operator: { group: "Operators", role: "operator" },
}

export function validateKeycloakCommissioning(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    value.status !== "COMMISSIONED" ||
    value.browserProof !== "AUTHORIZATION_CODE_PKCE_PENDING" ||
    !value.users ||
    typeof value.users !== "object" ||
    Array.isArray(value.users)
  ) {
    throw new Error("Keycloak commissioning metadata is invalid.")
  }

  for (const [name, expected] of Object.entries(expectedRoles)) {
    const user = value.users[name]
    if (
      !user ||
      typeof user !== "object" ||
      Array.isArray(user) ||
      user.enabled !== true ||
      user.emailVerified !== true ||
      user.group !== expected.group ||
      user.realmRole !== expected.role ||
      user.passwordCredentialPresent !== true ||
      user.requiredActions !== 0
    ) {
      throw new Error(`Keycloak ${name} commissioning metadata is invalid.`)
    }
  }

  return value
}

export function identityJwksFingerprint(document) {
  if (
    !document ||
    typeof document !== "object" ||
    !Array.isArray(document.keys) ||
    document.keys.length === 0
  ) {
    throw new Error("Keycloak JWKS metadata is invalid.")
  }

  const keys = document.keys
    .map((key) => {
      if (
        !key ||
        typeof key !== "object" ||
        typeof key.kid !== "string" ||
        !key.kid
      ) {
        throw new Error("Keycloak JWKS key metadata is invalid.")
      }
      return Object.fromEntries(
        ["alg", "crv", "e", "kid", "kty", "n", "use", "x", "y"]
          .filter((name) => typeof key[name] === "string")
          .map((name) => [name, key[name]]),
      )
    })
    .sort((left, right) => left.kid.localeCompare(right.kid))

  return createHash("sha256").update(JSON.stringify({ keys })).digest("hex")
}

export function assertIdentityAuthorityBinding({ candidateJwks, publicJwks }) {
  const candidateFingerprint = identityJwksFingerprint(candidateJwks)
  const publicFingerprint = identityJwksFingerprint(publicJwks)
  if (candidateFingerprint !== publicFingerprint) {
    throw new Error(
      "The public identity authority is not routed to the commissioned candidate Keycloak.",
    )
  }
  return {
    candidateFingerprint,
    publicFingerprint,
    status: "MATCHED_BEFORE_BROWSER_CREDENTIALS",
  }
}

export function sanitizedIdentityUrl(value) {
  const url = new URL(value)
  for (const name of [...url.searchParams.keys()]) {
    url.searchParams.set(name, "[redacted]")
  }
  return url.toString()
}
