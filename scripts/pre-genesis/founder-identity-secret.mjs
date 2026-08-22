import { lstat, readFile, realpath } from "node:fs/promises"
import { isAbsolute } from "node:path"

const expectedRoles = ["admin", "operator"]

export async function loadFounderIdentitySecret(path) {
  if (!path || !isAbsolute(path)) {
    throw new Error("Founder identity secret path must be absolute.")
  }

  const metadata = await lstat(path)
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error("Founder identity secret must be a regular file.")
  }
  if ((metadata.mode & 0o777) !== 0o600) {
    throw new Error("Founder identity secret must use mode 0600.")
  }
  if (
    typeof process.getuid === "function" &&
    metadata.uid !== process.getuid()
  ) {
    throw new Error("Founder identity secret must be owned by the runner.")
  }
  if (metadata.size < 1 || metadata.size > 16 * 1024) {
    throw new Error("Founder identity secret size is invalid.")
  }

  const canonicalPath = await realpath(path)
  if (canonicalPath !== path) {
    throw new Error("Founder identity secret path must be canonical.")
  }

  let document
  try {
    document = JSON.parse(await readFile(path, "utf8"))
  } catch {
    throw new Error("Founder identity secret is not valid JSON.")
  }

  assertExactKeys(document, [
    "identities",
    "rotationRequiredBeforeBroaderAccess",
    "schemaVersion",
  ])
  if (
    document.schemaVersion !== 1 ||
    document.rotationRequiredBeforeBroaderAccess !== true
  ) {
    throw new Error("Founder identity secret contract is invalid.")
  }
  assertExactKeys(document.identities, expectedRoles)

  const identities = {}
  for (const role of expectedRoles) {
    const identity = document.identities[role]
    assertExactKeys(identity, ["password", "role", "username"])
    if (
      identity.role !== role ||
      identity.username !== role ||
      typeof identity.password !== "string" ||
      identity.password.length < 8 ||
      identity.password.length > 256
    ) {
      throw new Error(`Founder ${role} identity contract is invalid.`)
    }
    identities[role] = {
      password: identity.password,
      role,
      username: role,
    }
  }

  return {
    identities,
    rotationRequiredBeforeBroaderAccess: true,
    schemaVersion: 1,
  }
}

function assertExactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Founder identity secret contract is invalid.")
  }
  const actual = Object.keys(value).sort()
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new Error("Founder identity secret contains unexpected fields.")
  }
}
