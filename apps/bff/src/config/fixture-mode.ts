const productionFixtureFlags = [
  "BFF_FIXTURE_MODE",
  "CONNECTED_APPS_KEYCLOAK_FIXTURE",
] as const

export function isBffFixtureMode(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return !isProductionRuntime(env) && env.BFF_FIXTURE_MODE === "true"
}

export function canUseBffFixtureData(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    !isProductionRuntime(env) &&
    (isBffFixtureMode(env) || env.NODE_ENV === "test")
  )
}

export function isProductionRuntime(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.NODE_ENV === "production"
}

export function assertProductionFixturesDisabled(
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (!isProductionRuntime(env)) {
    return
  }

  const enabledFlags = productionFixtureFlags.filter(
    (flag) => env[flag] === "true",
  )
  if (enabledFlags.length > 0) {
    throw new Error(
      `Fixture configuration is forbidden in production: ${enabledFlags.join(", ")}.`,
    )
  }
}

export function assertShippedProductionRuntime(
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (!isProductionRuntime(env)) {
    throw new Error("The shipped Console BFF requires NODE_ENV=production.")
  }
  assertProductionFixturesDisabled(env)
}
