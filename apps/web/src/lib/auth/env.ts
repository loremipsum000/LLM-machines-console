const EMPTY_ENV_VALUES = new Set(["", "null", "undefined"])

interface AuthUrlEnv {
  AUTH_URL?: string
  NEXTAUTH_URL?: string
}

export function cleanOptionalEnvValue(
  value: string | undefined,
): string | undefined {
  const trimmed = value?.trim()
  if (!trimmed || EMPTY_ENV_VALUES.has(trimmed.toLowerCase())) {
    return undefined
  }
  return trimmed
}

export function ensureAuthUrlEnv(
  fallbackUrl?: string,
  env: AuthUrlEnv = process.env as AuthUrlEnv,
): string | undefined {
  const authUrl =
    cleanOptionalEnvValue(env.AUTH_URL) ??
    cleanOptionalEnvValue(env.NEXTAUTH_URL) ??
    cleanOptionalEnvValue(fallbackUrl)

  if (!authUrl) {
    env.AUTH_URL = undefined
    env.NEXTAUTH_URL = undefined
    return undefined
  }

  env.AUTH_URL = authUrl
  env.NEXTAUTH_URL = authUrl
  return authUrl
}
