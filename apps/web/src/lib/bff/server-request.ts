import "server-only"

import { getBffForwardedIdentity } from "@/lib/auth/session"

export async function getBffRequest(): Promise<{
  baseUrl: string
  headers: HeadersInit
} | null> {
  const baseUrl = process.env.CONSOLE_BFF_URL?.replace(/\/+$/, "")
  const serviceKey = process.env.CONSOLE_BFF_SERVICE_API_KEY

  if (!baseUrl || !serviceKey) {
    return null
  }

  const identity = await getBffForwardedIdentity()
  if (!identity) {
    return null
  }

  return {
    baseUrl,
    headers: buildForwardedHeaders(serviceKey, identity),
  }
}

function buildForwardedHeaders(
  serviceKey: string,
  identity: Awaited<ReturnType<typeof getBffForwardedIdentity>>,
): HeadersInit {
  if (!identity) {
    return {}
  }

  return {
    Authorization: `Bearer ${serviceKey}`,
    ...(identity.accessToken
      ? { "x-llm-machines-keycloak-token": identity.accessToken }
      : {}),
    "x-llm-machines-user-sub": identity.subject,
    ...(identity.email ? { "x-llm-machines-user-email": identity.email } : {}),
    ...(identity.groups?.length
      ? { "x-llm-machines-user-groups": identity.groups.join(",") }
      : {}),
    "x-llm-machines-user-roles": identity.roles.join(","),
  }
}
