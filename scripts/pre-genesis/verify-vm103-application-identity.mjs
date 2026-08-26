import assert from "node:assert/strict"
import { readFile, stat } from "node:fs/promises"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

export function validateApplicationDiscovery(discovery, issuer) {
  assert.equal(discovery?.issuer, issuer)
  assert.equal(
    discovery?.token_endpoint,
    `${issuer}/protocol/openid-connect/token`,
  )
  assert.equal(discovery?.jwks_uri, `${issuer}/protocol/openid-connect/certs`)
  return discovery.token_endpoint
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
  clientId,
  issuer,
  secretFile,
}) {
  if (
    issuer !==
      "https://identity.lab.llm-machines.com/realms/llm-machines-applications" ||
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

  const discoveryResponse = await fetch(`${issuer}/.well-known/openid-configuration`)
  if (!discoveryResponse.ok)
    throw new Error("The founder Application realm is unavailable.")
  const tokenEndpoint = validateApplicationDiscovery(
    await discoveryResponse.json(),
    issuer,
  )
  const tokenResponse = await fetch(tokenEndpoint, {
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: secret,
      grant_type: "client_credentials",
    }),
    headers: { "content-type": "application/x-www-form-urlencoded" },
    method: "POST",
  })
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
  return { clientId, credentialValuesPrinted: false, issuer, status: "READY" }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [issuer, clientId, secretFile] = process.argv.slice(2)
  if (!issuer || !clientId || !secretFile)
    throw new Error(
      "Usage: verify-vm103-application-identity.mjs ISSUER CLIENT_ID SECRET_FILE",
    )
  const result = await verifyVm103ApplicationIdentity({
    clientId,
    issuer,
    secretFile: resolve(secretFile),
  })
  process.stdout.write(`${JSON.stringify(result)}\n`)
}
