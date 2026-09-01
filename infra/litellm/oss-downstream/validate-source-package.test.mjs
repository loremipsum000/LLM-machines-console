import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import path from "node:path"
import { test } from "node:test"
import {
  sha256File,
  validateSourcePackage,
} from "./validate-source-package.mjs"

const root = path.resolve(import.meta.dirname, "../../..")
const manifestPath = path.resolve(import.meta.dirname, "source-package.json")
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))

function clone(value) {
  return structuredClone(value)
}

test("checked-in LiteLLM OSS downstream source package passes", () => {
  assert.deepEqual(validateSourcePackage(manifest), [])
  assert.equal(
    sha256File(
      path.resolve(import.meta.dirname, "patches/remove-enterprise.patch"),
    ),
    manifest.downstream.patch.sha256,
  )
  assert.equal(
    sha256File(path.resolve(import.meta.dirname, "upstream-cosign.pub")),
    manifest.upstream.signature.publicKeySha256,
  )
})

test("the admitted source assembler cannot consume an unadmitted candidate", () => {
  const assembler = path.resolve(import.meta.dirname, "assemble-source.mjs")
  const source = readFileSync(assembler, "utf8")
  assert.doesNotMatch(source, /sidebar-functional-candidate|labArtifact/)

  const result = spawnSync(
    process.execPath,
    [
      assembler,
      "--archive",
      "unused.tar.gz",
      "--output",
      "unused-output",
      "--candidate",
      "unadmitted.json",
    ],
    { encoding: "utf8" },
  )
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /expected --archive PATH --output PATH/)
})

test("enterprise dependency, build copy, and runtime copy are removed", () => {
  const patch = readFileSync(
    path.resolve(import.meta.dirname, "patches/remove-enterprise.patch"),
    "utf8",
  )
  for (const removed of [
    '-    "litellm-enterprise==0.1.53",',
    "-COPY enterprise/pyproject.toml enterprise/",
    "-COPY --from=builder /app/enterprise /app/enterprise",
    '-    { name = "litellm-enterprise", marker = "extra == \'proxy\'", editable = "enterprise" },',
    "-# syntax=docker/dockerfile:1.7",
    "+# syntax=docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e",
  ]) {
    assert.match(
      patch,
      new RegExp(removed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    )
  }
  assert.doesNotMatch(
    manifest.downstream.removedPaths.join("\n"),
    /\.\.\/|^\//m,
  )
})

test("mutable, incomplete, or licensed native access metadata fails", () => {
  const mutations = [
    (candidate) => {
      candidate.upstream.image.indexDigest = "v1.96.2"
    },
    (candidate) => {
      candidate.downstream.buildInputs[0].platform = "linux/arm64"
    },
    (candidate) => {
      candidate.downstream.buildInputs[0].indexDigest = "docker/dockerfile:1.7"
    },
    (candidate) => {
      candidate.downstream.apkInputs.runtime[1] = "openssl"
    },
    (candidate) => {
      candidate.downstream.removedPaths.pop()
    },
    (candidate) => {
      candidate.authentication.licenseMaterialAllowed = true
    },
    (candidate) => {
      candidate.authentication.billableUserLimit = 6
    },
    (candidate) => {
      candidate.authentication.roles.Operator = "proxy_admin"
    },
    (candidate) => {
      candidate.downstream.artifactEvidence.license.transitiveCopyleftSourceRequired = false
    },
    (candidate) => {
      candidate.downstream.artifactEvidence.vulnerability.high = 1
    },
    (candidate) => {
      candidate.authentication.serviceSession.liteLlmFixedMaximumSeconds = 86_400
    },
    (candidate) => {
      candidate.qualification.nativeOidc = "PENDING"
    },
  ]
  for (const mutate of mutations) {
    const candidate = clone(manifest)
    mutate(candidate)
    assert.notDeepEqual(validateSourcePackage(candidate, root), [])
  }
})
