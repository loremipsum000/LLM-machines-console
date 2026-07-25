import "server-only"

export interface BffForwardedIdentity {
  subject: string
  email?: string
  groups?: string[]
  roles: string[]
  accessToken?: string
}

export async function getBffForwardedIdentity(): Promise<BffForwardedIdentity | null> {
  const { auth } = await import("@/lib/auth/auth")
  const session = await auth()
  if (!session?.user.id || session.user.roles.length === 0) {
    return null
  }

  return {
    subject: session.user.id,
    email: session.user.email ?? undefined,
    groups: session.user.groups,
    roles: session.user.roles,
    accessToken: session.accessToken,
  }
}
