export function isBffFixtureMode(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.BFF_FIXTURE_MODE === "true"
}

export function canUseBffFixtureData(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isBffFixtureMode(env) || env.NODE_ENV === "test"
}

export function isProductionRuntime(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.NODE_ENV === "production"
}
