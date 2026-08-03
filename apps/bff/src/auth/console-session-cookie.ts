import { timingSafeEqual } from "node:crypto"

export const CONSOLE_SESSION_COOKIE = "__Host-llm-machines-session"
export const CONSOLE_LOGIN_COOKIE = "__Host-llm-machines-login"
const opaqueHandlePattern = /^[A-Za-z0-9_-]{43}$/

export function readConsoleCookie(
  cookieHeader: string | string[] | undefined,
  name: string,
): string | null {
  const header = Array.isArray(cookieHeader)
    ? cookieHeader.join(";")
    : cookieHeader
  if (!header) {
    return null
  }
  for (const entry of header.split(";")) {
    const separator = entry.indexOf("=")
    if (separator < 1 || entry.slice(0, separator).trim() !== name) {
      continue
    }
    const value = entry.slice(separator + 1).trim()
    return validOpaqueConsoleHandle(value) ? value : null
  }
  return null
}

export function validOpaqueConsoleHandle(value: string): boolean {
  return opaqueHandlePattern.test(value)
}

export function serializeConsoleCookie(
  name: string,
  value: string,
  maxAgeSeconds: number,
): string {
  if (!opaqueHandlePattern.test(value) || maxAgeSeconds <= 0) {
    throw new Error("Invalid opaque Console cookie input.")
  }
  return [
    `${name}=${value}`,
    "Path=/",
    `Max-Age=${Math.floor(maxAgeSeconds)}`,
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
  ].join("; ")
}

export function clearConsoleCookie(name: string): string {
  return [
    `${name}=`,
    "Path=/",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
  ].join("; ")
}

export function validServiceCredential(
  authorization: string | undefined,
  expected: string,
): boolean {
  const supplied = authorization?.replace(/^Bearer\s+/i, "") ?? ""
  const left = Buffer.from(supplied)
  const right = Buffer.from(expected)
  return left.length === right.length && timingSafeEqual(left, right)
}
