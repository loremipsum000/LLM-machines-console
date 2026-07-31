import type { InferenceCoreHumanRole } from "@llm-machines/contracts/inference-core"

export function extractRealmRoles(profile: unknown): string[] {
  if (!profile || typeof profile !== "object") {
    return []
  }

  const realmAccess = (profile as { realm_access?: unknown }).realm_access
  if (!realmAccess || typeof realmAccess !== "object") {
    return []
  }

  const roles = (realmAccess as { roles?: unknown }).roles
  return stringArrayValue(roles)
}

export function extractRealmRolesFromAccessToken(
  accessToken: unknown,
): string[] {
  if (typeof accessToken !== "string" || accessToken.length === 0) {
    return []
  }

  const [, payload] = accessToken.split(".")
  if (!payload) {
    return []
  }

  try {
    return extractRealmRoles(JSON.parse(decodeBase64Url(payload)) as unknown)
  } catch {
    return []
  }
}

export function extractGroups(profile: unknown): string[] {
  if (!profile || typeof profile !== "object") {
    return []
  }
  return stringArrayValue((profile as { groups?: unknown }).groups).map(
    normalizeGroupName,
  )
}

export function extractGroupsFromAccessToken(accessToken: unknown): string[] {
  if (typeof accessToken !== "string" || accessToken.length === 0) {
    return []
  }

  const [, payload] = accessToken.split(".")
  if (!payload) {
    return []
  }

  try {
    return extractGroups(JSON.parse(decodeBase64Url(payload)) as unknown)
  } catch {
    return []
  }
}

export function mergeRoles(...roleSets: string[][]): string[] {
  const roles = new Set<string>()
  for (const roleSet of roleSets) {
    for (const role of roleSet) {
      roles.add(role)
    }
  }
  return [...roles]
}

export type RetainedConsoleRole = InferenceCoreHumanRole

export function retainedConsoleRoles(value: unknown): RetainedConsoleRole[] {
  const roles = mergeRoles(stringArrayValue(value))
  if (
    roles.some((role) => {
      const lowercase = role.toLowerCase()
      return (
        (lowercase === "admin" || lowercase === "operator") &&
        role !== lowercase
      )
    })
  ) {
    return []
  }
  const retained = roles.filter(
    (role): role is RetainedConsoleRole =>
      role === "admin" || role === "operator",
  )
  return retained.length === 1 ? retained : []
}

export function primaryRetainedConsoleRole(
  value: unknown,
): RetainedConsoleRole | null {
  const roles = retainedConsoleRoles(value)
  return roles[0] ?? null
}

export function stringArrayValue(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : []
}

export function mergeGroups(...groupSets: string[][]): string[] {
  const groups = new Set<string>()
  for (const groupSet of groupSets) {
    for (const rawGroup of groupSet) {
      const group = normalizeGroupName(rawGroup)
      if (group) {
        groups.add(group)
      }
    }
  }
  return [...groups]
}

function normalizeGroupName(group: string): string {
  return group.replace(/^\/+/, "").split("/").filter(Boolean).at(-1) ?? ""
}

function decodeBase64Url(payload: string): string {
  const base64 = payload.replace(/-/g, "+").replace(/_/g, "/")
  const padding = "=".repeat((4 - (base64.length % 4)) % 4)
  return Buffer.from(`${base64}${padding}`, "base64").toString("utf8")
}
