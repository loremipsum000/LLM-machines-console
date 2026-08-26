import assert from "node:assert/strict"
import { readFile, stat } from "node:fs/promises"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

export function validateApplicationJwks(jwks) {
  assert.ok(Array.isArray(jwks?.keys))
  assert.ok(jwks.keys.length > 0)
  for (const key of jwks.keys) {
    assert.match(key?.kid ?? "", /^[A-Za-z0-9_-]{8,}$/)
    assert.match(key?.kty ?? "", /^[A-Za-z0-9_-]{2,}$/)
  }
}

export function validateApplicationTokenClaims(claims, issuer, clientId) {
  assert.equal(claims?.iss, issuer)
  assert.ok(claims?.azp === clientId || claims?.client_id === clientId)
  assert.ok(Number.isInteger(claims?.iat))
  assert.ok(Number.isInteger(claims?.exp))
  assert.ok(claims.exp > claims.iat)
  assert.ok(claims.exp - claims.iat <= 60)
}

export async function verifyVm103ApplicationIdentity({
  baseUrl,
  clientId,
  issuer,
  realm,
  secretFile,
}) {
  if (
    !/^http:\/\/127\.0\.0\.1:\d{4,5}$/.test(baseUrl) ||
    issuer !==
      "https://identity.lab.llm-machines.com/realms/llm-machines-applications" ||
    realm !== "llm-machines-applications" ||
    clientId !== "console-application-admin"
  ) {
    throw new Error("The founder Application identity contract is invalid.")
  }
  const secretMetadata = await stat(secretFile)
  if (!secretMetadata.isFile() || (secretMetadata.mode & 0o077) !== 0) {
    throw new Error("The founder Application identity secret is not private.")
  }
  const secret = (await readFile(secretFile, "utf8")).trim()
  if (!secret) throw new Error("The founder Application identity secret is empty.")

  const privateRealm = `${baseUrl}/realms/${realm}`
  const jwksResponse = await fetch(
    `${privateRealm}/protocol/openid-connect/certs`,
  )
  if (!jwksResponse.ok)
    throw new Error("The founder Application realm keys are unavailable.")
  validateApplicationJwks(await jwksResponse.json())
  const tokenResponse = await fetch(
    `${privateRealm}/protocol/openid-connect/token`,
    {
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: secret,
      grant_type: "client_credentials",
    }),
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    method: "POST",
    },
  )
  if (!tokenResponse.ok)
    throw new Error("The founder Application identity client is unavailable.")
  const payload = await tokenResponse.json()
  const segments = payload?.access_token?.split(".") ?? []
  if (segments.length !== 3)
    throw new Error("The founder Application identity token is invalid.")
  validateApplicationTokenClaims(
    JSON.parse(Buffer.from(segments[1], "base64url").toString("utf8")),
    issuer,
    clientId,
  )
  return {
    clientId,
    credentialValuesPrinted: false,
    realm,
    status: "READY",
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [baseUrl, issuer, realm, clientId, secretFile] = process.argv.slice(2)
  if (!baseUrl || !issuer || !realm || !clientId || !secretFile)
    throw new Error(
      "Usage: verify-vm103-application-identity.mjs PRIVATE_BASE_URL PUBLIC_ISSUER REALM CLIENT_ID SECRET_FILE",
    )
  const result = await verifyVm103ApplicationIdentity({
    baseUrl,
    clientId,
    issuer,
    realm,
    secretFile: resolve(secretFile),
  })
  process.stdout.write(`${JSON.stringify(result)}\n`)
}
