import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import test from "node:test"

const repositoryRoot = resolve(import.meta.dirname, "../..")

async function source(path) {
  return readFile(resolve(repositoryRoot, path), "utf8")
}

test("shipped BFF images use the fail-closed production entrypoint", async () => {
  const [applicationDockerfile, vm103Dockerfile, entrypoint] =
    await Promise.all([
      source("apps/bff/Dockerfile"),
      source("infra/deployment/vm103-founder-bff.Dockerfile"),
      source("apps/bff/src/production-entrypoint.ts"),
    ])

  for (const dockerfile of [applicationDockerfile, vm103Dockerfile]) {
    assert.match(dockerfile, /ENV NODE_ENV=production/)
    assert.match(
      dockerfile,
      /apps\/bff\/src\/production-entrypoint\.ts|src\/production-entrypoint\.ts/,
    )
    assert.doesNotMatch(dockerfile, /(?:apps\/bff\/)?src\/index\.ts"\]$/m)
  }
  assert.match(entrypoint, /assertShippedProductionRuntime\(\)/)
  assert.match(entrypoint, /buildServer\(\)/)
})
