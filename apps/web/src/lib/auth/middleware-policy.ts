export function isHubAuthRequired(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (env.CONSOLE_REQUIRE_AUTH === "true") {
    return true
  }
  if (env.CONSOLE_REQUIRE_AUTH === "false") {
    return false
  }

  return env.NODE_ENV === "production" && Boolean(env.CONSOLE_BFF_URL)
}

export function getSignInRedirectUrl(requestUrl: string): URL {
  const signInUrl = new URL("/auth/signin", requestUrl)
  signInUrl.searchParams.set("callbackUrl", requestUrl)
  return signInUrl
}
