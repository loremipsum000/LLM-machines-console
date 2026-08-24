#!/usr/bin/env node

import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const directory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(directory, "../../..")
const digestPattern = /^[a-f0-9]{64}$/
const ociDigestPattern = /^sha256:[a-f0-9]{64}$/

function sha256File(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex")
}

export function validateSidebarFunctionalCandidate(
  candidate,
  sourcePackage,
  root = repositoryRoot,
) {
  const errors = []
  if (
    candidate?.schema !== "llm-machines.litellm-oss-functional-candidate.v1" ||
    candidate?.status !== "VM103_FUNCTIONAL_CANDIDATE_RELEASE_UNADMITTED"
  ) {
    errors.push("LiteLLM sidebar candidate identity differs")
  }
  if (
    candidate?.containsCredentials !== false ||
    candidate?.runtimeQualified !== false ||
    candidate?.releaseAdmitted !== false
  ) {
    errors.push("LiteLLM sidebar candidate overstates admission")
  }
  if (
    candidate?.baseSourcePackage !==
      "infra/litellm/oss-downstream/source-package.json" ||
    candidate?.baseVersion !== sourcePackage?.downstream?.version ||
    candidate?.version !== "v1.96.2-llmm.2" ||
    candidate?.platform !== sourcePackage?.downstream?.platform ||
    candidate?.sourceRevision !== sourcePackage?.upstream?.revision
  ) {
    errors.push("LiteLLM sidebar candidate does not bind its admitted base")
  }

  const overlay = candidate?.overlay
  const overlayPath = path.resolve(root, overlay?.path ?? "")
  if (
    overlay?.path !==
      "infra/litellm/oss-downstream/patches/sidebar-functional-candidate.patch" ||
    !digestPattern.test(overlay?.sha256 ?? "") ||
    !overlayPath.startsWith(`${root}${path.sep}`) ||
    sha256File(overlayPath) !== overlay.sha256
  ) {
    errors.push("LiteLLM sidebar overlay differs")
  }
  const patch = readFileSync(overlayPath, "utf8")
  for (const required of [
    '+      org.opencontainers.image.version="v1.96.2-llmm.2"',
    '+  generateBuildId: async () => "litellm-1-96-2-llmm-2",',
    '-      { key: "mcp-servers",',
    '-      { key: "skills",',
    '-      { key: "model-hub-table",',
    '-        label: "Agentic",',
    '-        label: "Tools",',
  ]) {
    if (!patch.includes(required)) {
      errors.push(`LiteLLM sidebar overlay is missing ${required}`)
    }
  }

  if (
    candidate?.sourceInventory?.fileCount !== 9019 ||
    candidate?.sourceInventory?.sha256SumsSha256 !==
      "f1cf7c6ad38d3c02db2d81ac9c2a5333b019f5c7dd6a406b7913f60013fbdd77" ||
    candidate?.sourceInventory?.inventoryDocumentSha256 !==
      "4bfa49baf3072b569d2996900139b4aeadf58e7e28c30fb2bf9c326640db8963"
  ) {
    errors.push("LiteLLM sidebar candidate source inventory differs")
  }

  const artifact = candidate?.labArtifact
  if (
    artifact?.evidenceStatus !==
      "SINGLE_VM103_FUNCTIONAL_BUILD_NOT_RELEASE_EVIDENCE" ||
    artifact?.buildCount !== 1 ||
    !ociDigestPattern.test(artifact?.configDigest ?? "") ||
    artifact?.imageBytes !== 1144537365 ||
    artifact?.os !== "linux" ||
    artifact?.architecture !== "amd64" ||
    artifact?.enterpriseMaterial !== false ||
    artifact?.deterministicRebuildCompared !== false ||
    artifact?.completeReleaseEvidence !== false
  ) {
    errors.push("LiteLLM sidebar lab artifact evidence differs")
  }

  if (
    JSON.stringify(candidate?.productBoundary?.operatorPages) !==
      JSON.stringify(["api-keys", "new_usage"]) ||
    candidate?.productBoundary?.consoleSessionForwarding !== false ||
    candidate?.productBoundary?.nativeOidcPreserved !== true ||
    candidate?.productBoundary?.removedNavigation?.length !== 9
  ) {
    errors.push("LiteLLM sidebar Product boundary differs")
  }

  return errors
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const candidate = JSON.parse(
    readFileSync(path.resolve(directory, "sidebar-functional-candidate.json")),
  )
  const sourcePackage = JSON.parse(
    readFileSync(path.resolve(directory, "source-package.json")),
  )
  const errors = validateSidebarFunctionalCandidate(candidate, sourcePackage)
  if (errors.length > 0) {
    console.error(errors.join("\n"))
    process.exit(1)
  }
  console.log("LiteLLM sidebar functional candidate is valid")
}
