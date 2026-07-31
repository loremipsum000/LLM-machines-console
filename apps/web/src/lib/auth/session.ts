import "server-only"

import {
  primaryRetainedConsoleRole,
  retainedConsoleRoles,
  type RetainedConsoleRole,
} from "./role-claims"

export interface BffForwardedIdentity {
  accessToken: string
  subject: string
  email?: string
  groups?: string[]
  roles: RetainedConsoleRole[]
}

export async function getBffForwardedIdentity(): Promise<BffForwardedIdentity | null> {
  const { auth } = await import("@/lib/auth/auth")
  const session = await auth()
  const roles = retainedConsoleRoles(session?.user.roles)
  if (!session?.user.id || !session.accessToken || roles.length === 0) {
    return null
  }

  return {
    subject: session.user.id,
    email: session.user.email ?? undefined,
    groups: session.user.groups,
    roles,
    accessToken: session.accessToken,
  }
}

export async function getCurrentConsoleRole(): Promise<RetainedConsoleRole | null> {
  const { auth } = await import("@/lib/auth/auth")
  const session = await auth()
  if (!session?.user.id || !session.accessToken) {
    return null
  }
  return primaryRetainedConsoleRole(session.user.roles)
}
