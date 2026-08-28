import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto"

interface EncryptedEnvelope {
  ciphertext: string
  iv: string
  kid: string
  tag: string
  version: 1
}

export interface ConsoleEncryptionContext {
  clientId: string
  issuer: string
  recordId: string
  recordType: "login" | "session"
  recordVersion: 1
  subject?: string
}

export interface ConsoleSessionCipher {
  activeKid: string
  destroy(): void
  open<T>(context: ConsoleEncryptionContext, envelope: string): T
  seal(context: ConsoleEncryptionContext, value: object): string
}

export function createConsoleSessionCipher(input: {
  activeKid: string
  keys: Readonly<Record<string, Uint8Array>>
}): ConsoleSessionCipher {
  const keys = Object.fromEntries(
    Object.entries(input.keys).map(([kid, key]) => [
      kid,
      keyFor(input.keys, kid),
    ]),
  )
  const activeKey = keys[input.activeKid]
  if (!activeKey) {
    throw new Error("Invalid active Console session encryption key.")
  }
  let destroyed = false
  return {
    activeKid: input.activeKid,
    destroy() {
      for (const key of Object.values(keys)) {
        key.fill(0)
      }
      destroyed = true
    },
    open<T>(context: ConsoleEncryptionContext, serialized: string): T {
      assertUsable(destroyed)
      const envelope = parseEnvelope(serialized)
      const key = keys[envelope.kid]
      if (!key) {
        throw new Error("Unknown Console session encryption key.")
      }
      const decipher = createDecipheriv(
        "aes-256-gcm",
        key,
        Buffer.from(envelope.iv, "base64url"),
      )
      decipher.setAAD(aad(context))
      decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"))
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(envelope.ciphertext, "base64url")),
        decipher.final(),
      ])
      try {
        return JSON.parse(plaintext.toString("utf8")) as T
      } finally {
        plaintext.fill(0)
      }
    },
    seal(context: ConsoleEncryptionContext, value: object): string {
      assertUsable(destroyed)
      const iv = randomBytes(12)
      const cipher = createCipheriv("aes-256-gcm", activeKey, iv)
      cipher.setAAD(aad(context))
      const plaintext = Buffer.from(JSON.stringify(value), "utf8")
      try {
        const ciphertext = Buffer.concat([
          cipher.update(plaintext),
          cipher.final(),
        ])
        return JSON.stringify({
          ciphertext: ciphertext.toString("base64url"),
          iv: iv.toString("base64url"),
          kid: input.activeKid,
          tag: cipher.getAuthTag().toString("base64url"),
          version: 1,
        } satisfies EncryptedEnvelope)
      } finally {
        plaintext.fill(0)
      }
    },
  }
}

export function newOpaqueHandle(): string {
  return randomBytes(32).toString("base64url")
}

export function opaqueHandleDigest(handle: string): string {
  return createHash("sha256").update(handle, "utf8").digest("hex")
}

function aad(context: ConsoleEncryptionContext): Buffer {
  if (
    !/^[a-f0-9]{64}$/.test(context.recordId) ||
    context.recordVersion !== 1 ||
    !context.clientId ||
    !context.issuer ||
    (context.recordType === "session" && !context.subject)
  ) {
    throw new Error("Invalid encrypted Console record identifier.")
  }
  return Buffer.from(
    JSON.stringify({
      clientId: context.clientId,
      issuer: context.issuer,
      recordId: context.recordId,
      recordType: context.recordType,
      recordVersion: context.recordVersion,
      subject: context.subject ?? null,
    }),
    "utf8",
  )
}

function keyFor(
  keys: Readonly<Record<string, Uint8Array>>,
  kid: string,
): Buffer {
  const key = keys[kid]
  if (!key || key.byteLength !== 32 || !/^[A-Za-z0-9._-]{1,64}$/.test(kid)) {
    throw new Error("Invalid Console session encryption keyring.")
  }
  return Buffer.from(key)
}

function parseEnvelope(serialized: string): EncryptedEnvelope {
  const value = JSON.parse(serialized) as Partial<EncryptedEnvelope>
  const keys =
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.keys(value).sort()
      : []
  if (
    keys.join(",") !== "ciphertext,iv,kid,tag,version" ||
    value.version !== 1 ||
    typeof value.kid !== "string" ||
    !/^[A-Za-z0-9._-]{1,64}$/.test(value.kid) ||
    typeof value.iv !== "string" ||
    typeof value.tag !== "string" ||
    typeof value.ciphertext !== "string" ||
    !canonicalBase64Url(value.iv, 12, 12) ||
    !canonicalBase64Url(value.tag, 16, 16) ||
    !canonicalBase64Url(value.ciphertext, 1, 131_072)
  ) {
    throw new Error("Invalid encrypted Console session envelope.")
  }
  return value as EncryptedEnvelope
}

function canonicalBase64Url(
  value: string,
  minimumBytes: number,
  maximumBytes: number,
): boolean {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    return false
  }
  const decoded = Buffer.from(value, "base64url")
  return (
    decoded.byteLength >= minimumBytes &&
    decoded.byteLength <= maximumBytes &&
    decoded.toString("base64url") === value
  )
}

function assertUsable(destroyed: boolean): void {
  if (destroyed) {
    throw new Error("Console session encryption keyring has been destroyed.")
  }
}
