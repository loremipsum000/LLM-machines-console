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
    '+def _require_llmm_proxy_admin(user_api_key_dict: UserAPIKeyAuth) -> None:',
    '+        raise HTTPException(status_code=403, detail="Proxy admin access required")',
    '-    # Append A2A agents to models list',
    '-    # Append A2A agents to model groups',
    '-import ModelSettingsModal from "@/components/model_dashboard/ModelSettingsModal/ModelSettingsModal";',
    '-import AuditLogsPanel from "./AuditLogsPanel";',
  ]) {
    if (!patch.includes(required)) {
      errors.push(`LiteLLM sidebar overlay is missing ${required}`)
    }
  }

  if (
    candidate?.sourceInventory?.fileCount !== 9019 ||
    candidate?.sourceInventory?.sha256SumsSha256 !==
      "996127beb403a87cf89f9695cad7dd104cfbfb287f62f3028c5bfad00449dc04" ||
    candidate?.sourceInventory?.inventoryDocumentSha256 !==
      "7bfd37be1892a7c5cd599ed09d6e63b7395aa7594019c32cbcd131d17a19b302"
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
    candidate?.productBoundary?.removedNavigation?.length !== 9 ||
    JSON.stringify(candidate?.productBoundary?.adminMetadataReads) !==
      JSON.stringify(["model_group_info", "model_info_v2", "spend_logs_ui"]) ||
    JSON.stringify(candidate?.productBoundary?.deniedDependencies) !==
      JSON.stringify(["config_list", "spend_log_detail", "enterprise_audit_preview"])
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
