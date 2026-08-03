import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import {
  validateProfile,
  validateSourceSafety,
  validateStorageContract,
  validateStorageSchema,
  validateZeroContentCanaryEvidence,
  zeroContentCanaryMarkers,
  zeroContentCanarySurfaces,
} from "./validate-profile.mjs"

const root = path.dirname(fileURLToPath(import.meta.url))
const profile = readFileSync(path.join(root, "profile.json"), "utf8")
const schema = readFileSync(path.join(root, "profile.schema.json"), "utf8")

function mutateProfile(mutate) {
  const value = JSON.parse(profile)
  mutate(value)
  return JSON.stringify(value)
}

function emptyCanaryEvidence() {
  return Object.fromEntries(
    zeroContentCanarySurfaces.map((surface) => [surface, []]),
  )
}

test("the checked-in source-only storage profile passes", () => {
  assert.deepEqual(validateProfile(), [])
})

test("qualification status cannot claim runtime evidence", () => {
  const changed = mutateProfile((value) => {
    value.metadata.runtimeQualificationStatus = "QUALIFIED"
  })
  assert.match(validateStorageContract(changed).join("\n"), /source-only/)
})

test("all five ZFS datasets and mountpoints are required and distinct", () => {
  const missing = mutateProfile((value) => {
    value.localStorage.datasets.pop()
  })
  assert.match(validateStorageContract(missing).join("\n"), /five reviewed/)

  const shared = mutateProfile((value) => {
    value.localStorage.datasets[1].mountpoint =
      value.localStorage.datasets[0].mountpoint
  })
  assert.match(validateStorageContract(shared).join("\n"), /distinct/)
})

test("local snapshots cannot become backups", () => {
  const changed = mutateProfile((value) => {
    value.localStorage.localSnapshots.countsAsBackup = true
    value.backup.localSnapshotsCountAsBackup = true
  })
  assert.match(validateStorageContract(changed).join("\n"), /never count/)
})

test("restic secrets are file-mounted and never inline or environment values", () => {
  const environmentValue = mutateProfile((value) => {
    value.backup.repository.environmentVariablesAllowed = true
  })
  assert.match(
    validateStorageContract(environmentValue).join("\n"),
    /file-mounted/,
  )

  const inlineValue = mutateProfile((value) => {
    value.backup.repository.repositoryPassword = "forbidden"
  })
  assert.match(validateStorageContract(inlineValue).join("\n"), /file-mounted/)
})

test("the exact backup allowlist, exclusions, and clean restore gate are fixed", () => {
  const modelsIncluded = mutateProfile((value) => {
    value.backup.inputAllowlist.push("models")
  })
  assert.match(validateStorageContract(modelsIncluded).join("\n"), /allowlist/)

  const noRestore = mutateProfile((value) => {
    value.backup.cleanRestoreQualification.required = false
  })
  assert.match(validateStorageContract(noRestore).join("\n"), /clean restore/)
})

test("deterministic canaries reject workload content on every reviewed surface", () => {
  assert.deepEqual(validateZeroContentCanaryEvidence(emptyCanaryEvidence()), [])
  for (const surface of zeroContentCanarySurfaces) {
    for (const marker of zeroContentCanaryMarkers) {
      const evidence = emptyCanaryEvidence()
      evidence[surface] = [`metadata-before:${marker}:metadata-after`]
      assert.deepEqual(validateZeroContentCanaryEvidence(evidence), [
        `${surface} contains forbidden workload-content canary`,
      ])
    }
  }
})

test("canary evidence cannot omit or invent a surface", () => {
  const missing = emptyCanaryEvidence()
  delete missing.cache
  assert.match(
    validateZeroContentCanaryEvidence(missing).join("\n"),
    /exactly the reviewed surfaces/,
  )

  const extra = { ...emptyCanaryEvidence(), unknown: [] }
  assert.match(
    validateZeroContentCanaryEvidence(extra).join("\n"),
    /exactly the reviewed surfaces/,
  )
})

test("generic object storage and unused adapters remain absent", () => {
  const changed = mutateProfile((value) => {
    value.objectStore.genericS3ServiceInBom = true
    value.objectStore.unusedAdapterAllowed = true
    value.objectStore.currentRetainedCallers.push("unproven-component")
  })
  assert.match(validateStorageContract(changed).join("\n"), /object storage/)
})

test("the schema freezes source-only, custody, and canary boundaries", () => {
  assert.deepEqual(validateStorageSchema(schema), [])
  const changed = JSON.parse(schema)
  changed.properties.backup.properties.repository.properties.environmentVariablesAllowed.const = true
  assert.match(
    validateStorageSchema(JSON.stringify(changed)).join("\n"),
    /custody/,
  )
})

test("credentials, topology, endpoints, and inline repository values are rejected", () => {
  for (const source of [
    ["token: gh", "o_0123456789abcdefghijklmnop"].join(""),
    ["target: 192", ".168.4.10"].join(""),
    ["target: service", ".internal"].join(""),
    ["endpoint: https://backup", ".example"].join(""),
    ["path: /", "Users/operator/backup"].join(""),
    ["RESTIC_", "PASSWORD=forbidden"].join(""),
    ["repository", "Locator=/mnt/customer"].join(""),
  ]) {
    assert.ok(validateSourceSafety({ changed: source }).length > 0, source)
  }
})

test("the validator CLI reads source only and passes", () => {
  const result = spawnSync(
    process.execPath,
    [path.join(root, "validate-profile.mjs")],
    {
      cwd: path.resolve(root, "../.."),
      encoding: "utf8",
    },
  )
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  assert.match(result.stdout, /validation passed/)
})
