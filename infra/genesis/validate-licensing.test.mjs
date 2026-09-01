import assert from "node:assert/strict"
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { after, before, test } from "node:test"
import { fileURLToPath } from "node:url"
import { validateLicensing } from "./validate-licensing.mjs"

const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)))
const fixtureRoot = mkdtempSync(join(tmpdir(), "llmm-genesis-licensing-"))
const paths = [
  "LICENSE",
  "COPYRIGHT",
  "THIRD_PARTY_NOTICES.md",
  "THIRD_PARTY_LICENSES/Urbanist-OFL-1.1.txt",
  "package.json",
  "apps/bff/package.json",
  "apps/web/package.json",
  "apps/web/public/fonts/urbanist",
  "infra/genesis/snapshot-root-package.json",
  "infra/genesis/source-transforms.json",
  "packages/contracts/package.json",
  "packages/copy/package.json",
  "test-support/f0-e2e2-openai-client/package.json",
  "test-support/inference-core-db-tests/package.json",
  "infra/release/core-image-inventory.json",
  "infra/release/license-disposition.json",
  "infra/release/third-party-source-map.json",
  "infra/release/release-evidence-policy.json",
  "infra/firecrawl/release/source-package.json",
  "infra/litellm/oss-downstream/source-package.json",
  "infra/keycloak/themes/llm-machines/login/resources/fonts/urbanist",
]

before(() => {
  for (const path of paths) {
    cpSync(resolve(repositoryRoot, path), resolve(fixtureRoot, path), {
      recursive: true,
    })
  }
})

after(() => rmSync(fixtureRoot, { force: true, recursive: true }))

function mutateJson(path, mutate) {
  const absolutePath = resolve(fixtureRoot, path)
  const original = readFileSync(absolutePath, "utf8")
  const value = JSON.parse(original)
  mutate(value)
  writeFileSync(absolutePath, `${JSON.stringify(value, null, 2)}\n`)
  return () => writeFileSync(absolutePath, original)
}

test("the Product licensing and upstream-source index are complete", () => {
  assert.deepEqual(validateLicensing(repositoryRoot), {
    componentCount: 13,
    packageCount: 8,
    thirdPartyComponentCount: 12,
  })
  assert.deepEqual(validateLicensing(fixtureRoot), {
    componentCount: 13,
    packageCount: 8,
    thirdPartyComponentCount: 12,
  })
})

test("a changed canonical licence is rejected", () => {
  const path = resolve(fixtureRoot, "LICENSE")
  const original = readFileSync(path)
  writeFileSync(path, Buffer.concat([original, Buffer.from("\n")]))
  assert.throws(() => validateLicensing(fixtureRoot), /byte-exact PolyForm/)
  writeFileSync(path, original)
})

test("publication-enabled first-party packages are rejected", () => {
  const restore = mutateJson("apps/bff/package.json", (manifest) => {
    manifest.private = false
  })
  assert.throws(() => validateLicensing(fixtureRoot), /must remain private/)
  restore()
})

test("third-party inventory drift is rejected", () => {
  const restore = mutateJson(
    "infra/release/third-party-source-map.json",
    (sourceMap) => {
      sourceMap.components[0].license = "Apache-2.0"
    },
  )
  assert.throws(() => validateLicensing(fixtureRoot), /obligations drifted/)
  restore()
})

test("the third-party source-map envelope is exact", () => {
  const restore = mutateJson(
    "infra/release/third-party-source-map.json",
    (sourceMap) => {
      sourceMap.status = "UNREVIEWED"
    },
  )
  assert.throws(() => validateLicensing(fixtureRoot), /envelope drifted/)
  restore()
})

test("source obligations and packet identities cannot be weakened", () => {
  const restore = mutateJson(
    "infra/release/third-party-source-map.json",
    (sourceMap) => {
      const grafana = sourceMap.components.find(
        (component) => component.id === "grafana-private",
      )
      grafana.obligation = "license-and-notices"
      grafana.correspondingSource.status = "UNREVIEWED"
      grafana.correspondingSource.packetId = "other"
    },
  )
  assert.throws(() => validateLicensing(fixtureRoot), /obligations drifted/)
  restore()
})

test("upstream material prefixes cannot be redirected", () => {
  const restore = mutateJson(
    "infra/release/third-party-source-map.json",
    (sourceMap) => {
      sourceMap.trackedUpstreamMaterial[0].pathPrefixes = [
        "apps/web/",
        "infra/keycloak/",
      ]
    },
  )
  assert.throws(() => validateLicensing(fixtureRoot), /material index drifted/)
  restore()
})

test("the authoritative source test chain cannot be weakened", () => {
  const restore = mutateJson("package.json", (manifest) => {
    manifest.scripts["check:inference-core"] =
      "node infra/ingress/validate-ingress.mjs"
  })
  assert.throws(() => validateLicensing(fixtureRoot), /protected test chain/)
  restore()
})

test("the snapshot transform cannot change non-script package metadata", () => {
  const restore = mutateJson(
    "infra/genesis/snapshot-root-package.json",
    (manifest) => {
      manifest.private = false
    },
  )
  assert.throws(() => validateLicensing(fixtureRoot), /must remain private/)
  restore()
})
