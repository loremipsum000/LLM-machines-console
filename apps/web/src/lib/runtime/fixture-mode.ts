export function isWebFixtureMode(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.CONSOLE_WEB_FIXTURE_MODE === "true"
}

export function canUseWebFixtureData(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isWebFixtureMode(env) || env.NODE_ENV === "test"
}

export function isConsoleBffConfigured(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return Boolean(env.CONSOLE_BFF_URL?.trim() && env.CONSOLE_BFF_SERVICE_API_KEY)
}
