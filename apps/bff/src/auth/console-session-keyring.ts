import { constants, closeSync, fstatSync, openSync, readSync } from "node:fs"
import {
  type ConsoleSessionCipher,
  createConsoleSessionCipher,
} from "./console-session-crypto"

const MAX_KEYRING_BYTES = 64 * 1024

interface SerializedKeyring {
  activeKid?: unknown
  keys?: unknown
  version?: unknown
}

interface SerializedKey {
  kid?: unknown
  material?: unknown
  status?: unknown
}

export function loadRootConsoleSessionCipher(
  path: string,
): ConsoleSessionCipher {
  if (!path.startsWith("/") || path.includes("\0")) {
    throw new Error("Console session keyring path must be absolute.")
  }
  const noFollow = constants.O_NOFOLLOW ?? 0
  const descriptor = openSync(path, constants.O_RDONLY | noFollow)
  let serialized: Buffer | null = null
  try {
    const stat = fstatSync(descriptor)
    if (
      !stat.isFile() ||
      stat.uid !== 0 ||
      (stat.mode & 0o077) !== 0 ||
      stat.size < 1 ||
      stat.size > MAX_KEYRING_BYTES
    ) {
      throw new Error("Console session keyring custody is unsafe.")
    }
    serialized = Buffer.alloc(stat.size)
    let offset = 0
    while (offset < serialized.length) {
      const read = readSync(
        descriptor,
        serialized,
        offset,
        serialized.length - offset,
        offset,
      )
      if (read === 0) {
        throw new Error("Console session keyring read was incomplete.")
      }
      offset += read
    }
    return cipherFromSerializedKeyring(serialized)
  } finally {
    serialized?.fill(0)
    closeSync(descriptor)
  }
}

export function cipherFromSerializedKeyring(
  serialized: Uint8Array,
): ConsoleSessionCipher {
  if (serialized.byteLength < 1 || serialized.byteLength > MAX_KEYRING_BYTES) {
    throw new Error("Console session keyring has invalid size.")
  }
  let parsed: SerializedKeyring
  try {
    parsed = JSON.parse(
      Buffer.from(serialized).toString("utf8"),
    ) as SerializedKeyring
  } catch {
    throw new Error("Console session keyring is not valid JSON.")
  }
  if (
    parsed.version !== 1 ||
    typeof parsed.activeKid !== "string" ||
    !Array.isArray(parsed.keys) ||
    parsed.keys.length < 1 ||
    parsed.keys.length > 8
  ) {
    throw new Error("Console session keyring is invalid.")
  }
  const keyBuffers: Buffer[] = []
  try {
    const entries = parsed.keys.map((value) => parseKey(value, keyBuffers))
    if (
      new Set(entries.map((entry) => entry.kid)).size !== entries.length ||
      entries.filter((entry) => entry.status === "active").length !== 1 ||
      entries.find((entry) => entry.status === "active")?.kid !==
        parsed.activeKid
    ) {
      throw new Error("Console session keyring rotation state is invalid.")
    }
    return createConsoleSessionCipher({
      activeKid: parsed.activeKid,
      keys: Object.fromEntries(entries.map((entry) => [entry.kid, entry.key])),
    })
  } finally {
    for (const key of keyBuffers) {
      key.fill(0)
    }
  }
}

function parseKey(
  value: unknown,
  keyBuffers: Buffer[],
): { key: Buffer; kid: string; status: "active" | "decrypt-only" } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Console session keyring entry is invalid.")
  }
  const candidate = value as SerializedKey
  if (
    typeof candidate.kid !== "string" ||
    !/^[A-Za-z0-9._-]{1,64}$/.test(candidate.kid) ||
    typeof candidate.material !== "string" ||
    (candidate.status !== "active" && candidate.status !== "decrypt-only")
  ) {
    throw new Error("Console session keyring entry is invalid.")
  }
  const key = Buffer.from(candidate.material, "base64")
  keyBuffers.push(key)
  if (key.byteLength !== 32 || key.toString("base64") !== candidate.material) {
    throw new Error("Console session keyring key must be canonical base64.")
  }
  return { key, kid: candidate.kid, status: candidate.status }
}
