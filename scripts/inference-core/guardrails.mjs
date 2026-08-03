import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"
import {
  requiredSourceArtifactClasses,
  requiredSourceScenarios,
  requiredTerminalStates,
} from "./retention-canary.mjs"

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
export const repositoryRoot = resolve(scriptDirectory, "../..")

export const allowlistPath =
  "docs/reduction/inference-core/forbidden-surface-allowlist.yaml"
export const routeBaselinePath =
  "docs/reduction/inference-core/route-baseline.json"
export const retentionCharacterizationPath =
  "docs/reduction/inference-core/retention-characterization.json"
export const pr02ContractRevisionPath =
  "docs/reduction/inference-core/contract-revisions/PR-02.json"
export const pr03ContractRevisionPath =
  "docs/reduction/inference-core/contract-revisions/PR-03.json"
export const pr03DecisionPath =
  "docs/reduction/inference-core/pr-03-removal-decisions.json"
export const pr04ContractRevisionPath =
  "docs/reduction/inference-core/contract-revisions/PR-04.json"
export const pr04DecisionPath =
  "docs/reduction/inference-core/pr-04-data-decisions.json"
export const pr05ContractRevisionPath =
  "docs/reduction/inference-core/contract-revisions/PR-05.json"
export const pr05DecisionPath =
  "docs/reduction/inference-core/pr-05-identity-decisions.json"
export const pr06ContractRevisionPath =
  "docs/reduction/inference-core/contract-revisions/PR-06.json"
export const pr06DecisionPath =
  "docs/reduction/inference-core/pr-06-application-decisions.json"
export const pr07ContractRevisionPath =
  "docs/reduction/inference-core/contract-revisions/PR-07.json"
export const pr07DecisionPath =
  "docs/reduction/inference-core/pr-07-data-plane-decisions.json"
export const pr08ContractRevisionPath =
  "docs/reduction/inference-core/contract-revisions/PR-08.json"
export const pr08DecisionPath =
  "docs/reduction/inference-core/pr-08-firecrawl-decisions.json"
export const pr08SourceManifestPath =
  "docs/reduction/inference-core/pr-08-firecrawl-source-manifest.json"
export const pr08SourceMapPath =
  "docs/reduction/inference-core/source-map.jsonl"
export const pr09ContractRevisionPath =
  "docs/reduction/inference-core/contract-revisions/PR-09.json"
export const pr09DecisionPath =
  "docs/reduction/inference-core/pr-09-activity-audit-observability-decisions.json"
export const pr10ContractRevisionPath =
  "docs/reduction/inference-core/contract-revisions/PR-10.json"
export const pr10DecisionPath =
  "docs/reduction/inference-core/pr-10-lifecycle-foundation-decisions.json"
export const pr10cContractRevisionPath =
  "docs/reduction/inference-core/contract-revisions/PR-10C.json"
export const pr10cDecisionPath =
  "docs/reduction/inference-core/pr-10c-emergency-isolation-decisions.json"
export const pr11ContractRevisionPath =
  "docs/reduction/inference-core/contract-revisions/PR-11.json"
export const pr11DecisionPath =
  "docs/reduction/inference-core/pr-11-console-information-architecture-decisions.json"
export const pr11aR1C0DecisionPath =
  "docs/reduction/inference-core/pr-11a-identity-ingress-hardening-decisions.json"
export const pr11aR1C0GovernanceCheckpointPaths = [
  "docs/reduction/inference-core/README.md",
  "docs/reduction/inference-core/decision-register.md",
  pr11aR1C0DecisionPath,
  "docs/reduction/inference-core/validation-register.md",
  "scripts/inference-core/guardrails.mjs",
  "scripts/inference-core/pr11a-r1-c0-boundaries.test.mjs",
]
export const pr11aR1C0AdmittedBehaviorSourcePaths = [
  "apps/bff/src/auth/authorization.ts",
  "apps/bff/src/commands/audit-ingestion.ts",
  "apps/bff/src/services/admin-team.ts",
  "apps/bff/src/services/audit-ingestion.ts",
  "apps/bff/src/services/emergency-recovery.ts",
  "apps/bff/src/services/expert-capabilities.ts",
  "apps/bff/src/services/native-audit-source.ts",
  "apps/web/src/components/console-v2/hardware-v2-experience.tsx",
  "apps/web/src/components/console-v2/inference-v2-experience.tsx",
  "apps/web/src/components/console-v2/team-v2-experience.tsx",
  "packages/contracts/src/inference-core-authorization.ts",
  "packages/contracts/src/inference-core-recovery.ts",
  "packages/contracts/src/inference-core.ts",
]
export const pr11aR1C0SourceCandidatePaths = [
  "apps/bff/src/auth/authorization-security.test.ts",
  "apps/bff/src/auth/authorization.ts",
  "apps/bff/src/commands/audit-ingestion.ts",
  "apps/bff/src/routes/admin-hardware.test.ts",
  "apps/bff/src/routes/admin-inference.test.ts",
  "apps/bff/src/routes/admin-isolation.test.ts",
  "apps/bff/src/routes/admin-recovery.test.ts",
  "apps/bff/src/services/admin-team.ts",
  "apps/bff/src/services/audit-ingestion.test.ts",
  "apps/bff/src/services/audit-ingestion.ts",
  "apps/bff/src/services/emergency-recovery.test.ts",
  "apps/bff/src/services/emergency-recovery.ts",
  "apps/bff/src/services/expert-capabilities.test.ts",
  "apps/bff/src/services/expert-capabilities.ts",
  "apps/bff/src/services/native-audit-source.test.ts",
  "apps/bff/src/services/native-audit-source.ts",
  "apps/web/src/components/console-v2/hardware-v2-experience.test.tsx",
  "apps/web/src/components/console-v2/hardware-v2-experience.tsx",
  "apps/web/src/components/console-v2/inference-v2-experience.tsx",
  "apps/web/src/components/console-v2/role-aware-presentation.test.tsx",
  "apps/web/src/components/console-v2/team-v2-experience.tsx",
  "docs/reduction/inference-core/README.md",
  "docs/reduction/inference-core/decision-register.md",
  pr11aR1C0DecisionPath,
  "docs/reduction/inference-core/validation-register.md",
  "packages/contracts/src/inference-core-authorization.test.ts",
  "packages/contracts/src/inference-core-authorization.ts",
  "packages/contracts/src/inference-core-recovery.test.ts",
  "packages/contracts/src/inference-core-recovery.ts",
  "packages/contracts/src/inference-core.test.ts",
  "packages/contracts/src/inference-core.ts",
  "scripts/inference-core/guardrails.mjs",
  "scripts/inference-core/pr02-boundaries.test.mjs",
  "scripts/inference-core/pr11a-r1-c0-boundaries.test.mjs",
]
const pr01BootstrapBase = "0faf8a7da0a77ffb6bf45cb6c01dbc17c51f855a"
const pr02IntegrationBase = "bb60cb0dfe46a39189e2a80fe1839e8288201492"
export const pr03ContractBase = "964ff087f39111862c90f72ec57ab33bb937f5d2"
export const pr03LaneAnchor = "43c11ace1b80d5241cf2a6a06670fe01f49e3e10"
export const pr04ContractBase = "fb36b9de38396af79c82056963ae3f4833a12fef"
export const pr04LaneAnchor = "fb36b9de38396af79c82056963ae3f4833a12fef"
export const pr05ContractBase = "9c502a6d4d79435f469288aa66001db7c4be4aa5"
export const pr05LaneAnchor = "9c502a6d4d79435f469288aa66001db7c4be4aa5"
export const pr06ContractBase = "da6f0c0a2b5e477449a09527a28c7e51ef432c20"
export const pr06LaneAnchor = "da6f0c0a2b5e477449a09527a28c7e51ef432c20"
export const pr07ContractBase = "cd5a389cde949d07aa64ef7a0513cb585bb8bb7a"
export const pr07LaneAnchor = "cd5a389cde949d07aa64ef7a0513cb585bb8bb7a"
export const pr08ContractBase = "c47ffd38661ce9a7561f967aecbb9bae15cdadf5"
export const pr08LaneAnchor = "c47ffd38661ce9a7561f967aecbb9bae15cdadf5"
export const pr08ContractBaseTree = "6071f1aa62690c509346cf1af7017a4cc669d28b"
export const pr09ContractBase = "c07d651b1f7d16f777839c3c15783a61271239c3"
export const pr09LaneAnchor = pr09ContractBase
export const pr09ContractBaseTree = "0b2e55ce2f4c9be726dde4443a9f0bee91556b69"
export const pr10ContractBase = "e9f2516585dccec69317fd0426ac4fcf6fa0d9b1"
export const pr10LaneAnchor = pr10ContractBase
export const pr10ContractBaseTree = "e0046213fa9641f606a575c3dd85407806ba2874"
export const pr10cContractBase = "f29ea2a0c69871973ea553d3edf83b783d6c9879"
export const pr10cLaneAnchor = pr10cContractBase
export const pr10cContractBaseTree = "991109ad85e0c454af62ed42c4a5a69068b301e0"
export const pr11ContractBase = "6efab17a6f5f6a474a1dfe1444dcdd63e4973dd7"
export const pr11LaneAnchor = pr11ContractBase
export const pr11ContractBaseTree = "44d6fb34db5f3d35e8b2f9bd2259756aec63b8a8"
export const pr11aR1C0ContractBase = "9d8f1a6144cb280104cdce0a21ab7dafa72087ec"
export const pr11aR1C0ContractBaseTree =
  "a7cb76ff95ec4ffc12cbd589b0514564602c35da"
export const pr11aR1S1IntegrationBase =
  "0f29c7939fa885c11c191e8b672f09e16635ddcb"
export const pr10cSuccessorEvidenceCommit =
  "9c5dedc2242b7a6b061a043334b1f06fa621c939"
export const pr10cSuccessorEvidenceTree = pr11ContractBaseTree
export const pr08PrivateCheckpoint = {
  baseCommit: "eeab335ab3e46add36e4efcfb4dad2b3b47a8202",
  baseTree: "c38ca6e7ea85e454f7c191441ade7679b7ee4c41",
  commit: "ff74f3c94c563627929af31c46d48dda8e7d6192",
  tree: "8a978eb0f6d0ef04a896ec29f138a84a7cf14d79",
}
export const pr08PrivatePreservationBinding = {
  privateHoldRef: "refs/heads/hold/firecrawl-hermes-pilot",
  selectedManifestV2Sha256:
    "889c8c50f1debc1b8f5c6cf2bc096135e7dbcde23a2af9567ceacc39ecf5c604",
  exclusionLedgerV2Sha256:
    "058ef3baff0939b20abea31f5d4b7674aa8b2fb735eb0c97da11c392490e1337",
  combinedBindingV2Sha256:
    "1e067a3be0d3309d6fee6e5c5d63680621b2da9883100d5931ab5bf86d81e520",
}
export const pr08SourceArtifacts = [
  {
    path: "infra/librechat/web-search/hermes-firecrawl/docker-compose.yml",
    blob: "6766a13139ebec3cfd6d17934ecaccfd3714d2a5",
    bytes: 16447,
    sha256: "760561f9c9204cd7d83181f13a404cf5ee718ca82d53e3f68319b5d8b1e49cdd",
  },
  {
    path: "infra/librechat/web-search/hermes-firecrawl/searxng/settings.yml",
    blob: "646fb8b16fe19956911f9986cf181740c02eaad0",
    bytes: 1024,
    sha256: "e78c0b13422ff413e09357161d795e1e05ff4eef92c1dc0bd93f189f80d456da",
  },
  {
    path: "infra/librechat/web-search/hermes-firecrawl/egress-proxy/squid.conf",
    blob: "10031f476cde1dbed5b2c172bbc8983962e1ea36",
    bytes: 2250,
    sha256: "abb846b8355aad7f9e0df7c47a719c0e8ba39be2842c62a5e345fb5e2df7a2b9",
  },
  {
    path: "infra/librechat/web-search/hermes-firecrawl/supply-chain/source-lock.env",
    blob: "8dfb98ef212dd53ccf6844947929c94d045305e5",
    bytes: 2593,
    sha256: "018eed1e85812fbaff922bf4b07d343ae91eb02490e616dddd8874f39c90732f",
  },
  {
    path: "infra/librechat/web-search/hermes-firecrawl/supply-chain/image-lock.env",
    blob: "2c7c1b680c58068d18d9de5d149bccccbb95a6d7",
    bytes: 3387,
    sha256: "e8c687045f9b07692c6b63cf6e2dd0338f601a35f677c9bfde52557753871a38",
  },
  {
    path: "infra/librechat/web-search/hermes-firecrawl/supply-chain/third-party-source-ledger.json",
    blob: "ff8494a2df1df5234f4bef9008981712cd410b60",
    bytes: 6718,
    sha256: "3b81614a6c05b4f106785d29088edc1217addd3969432a3cd0057425995900e1",
  },
  {
    path: "infra/librechat/web-search/hermes-firecrawl/supply-chain/patches/runtime-policy.patch",
    blob: "aa2281e4d98e5ee0c6010b3e5f54bf8c70e10d8a",
    bytes: 26547,
    sha256: "eb110989c841107d1c55ba50ef4ae3e3710bb27b27fde3dc8881f34b7e3dabdd",
  },
]
export const pr08SourceManifestBinding = {
  path: pr08SourceManifestPath,
  productBase: {
    commit: pr08ContractBase,
    tree: pr08ContractBaseTree,
  },
  privateCheckpoint: pr08PrivateCheckpoint,
  method: "reviewed-semantic-unit-reconstruction",
  pilotAncestryAllowed: false,
}
const pr02RevisionEvidencePaths = [
  "docs/reduction/inference-core/pr-02-boundary-decisions.json",
  "scripts/inference-core/pr02-boundaries.test.mjs",
  "scripts/inference-core/pr02-contract-revision.mjs",
]
export const pr03RevisionEvidencePaths = [
  pr03DecisionPath,
  "scripts/inference-core/pr03-boundaries.test.mjs",
  "scripts/inference-core/pr03-contract-revision.mjs",
]
export const pr04RevisionEvidencePaths = [
  pr04DecisionPath,
  "scripts/inference-core/pr04-boundaries.test.mjs",
  "scripts/inference-core/pr04-contract-revision.mjs",
]
export const pr05RevisionEvidencePaths = [
  pr05DecisionPath,
  "scripts/inference-core/pr05-boundaries.test.mjs",
  "scripts/inference-core/pr05-contract-revision.mjs",
]
export const pr06RevisionEvidencePaths = [
  pr06DecisionPath,
  "scripts/inference-core/pr06-boundaries.test.mjs",
  "scripts/inference-core/pr06-contract-revision.mjs",
]
export const pr07RevisionEvidencePaths = [
  pr07DecisionPath,
  "scripts/inference-core/pr07-boundaries.test.mjs",
  "scripts/inference-core/pr07-contract-revision.mjs",
]
export const pr08RevisionEvidencePaths = [
  pr08DecisionPath,
  pr08SourceManifestPath,
  pr08SourceMapPath,
  "docs/reduction/inference-core/decision-register.md",
  "docs/reduction/inference-core/validation-register.md",
  "scripts/inference-core/pr08-boundaries.test.mjs",
  "scripts/inference-core/pr08-contract-revision.mjs",
]
export const pr09SuccessorAwareHistoricalTestPaths = [
  "scripts/inference-core/pr02-boundaries.test.mjs",
  "scripts/inference-core/pr05-boundaries.test.mjs",
]
const pr09HistoricalTestEvidenceCommitByPath = new Map([
  [pr09SuccessorAwareHistoricalTestPaths[0], pr03ContractBase],
  [pr09SuccessorAwareHistoricalTestPaths[1], pr06ContractBase],
])
const inheritedHistoricalTestEvidenceCommitByPath = new Map([
  ...pr09HistoricalTestEvidenceCommitByPath,
  ["scripts/inference-core/pr06-boundaries.test.mjs", pr07ContractBase],
])
export const pr09RevisionEvidencePaths = [
  pr09DecisionPath,
  ...pr09SuccessorAwareHistoricalTestPaths,
  "scripts/inference-core/pr09-boundaries.test.mjs",
  "scripts/inference-core/pr09-contract-revision.mjs",
]
export const pr10RevisionEvidencePaths = [
  pr10DecisionPath,
  "scripts/inference-core/pr10-boundaries.test.mjs",
  "scripts/inference-core/pr10-contract-revision.mjs",
]
export const pr10cRevisionEvidencePaths = [
  pr10cDecisionPath,
  "scripts/inference-core/pr10c-boundaries.test.mjs",
  "scripts/inference-core/pr10c-contract-revision.mjs",
]
export const pr11RevisionEvidencePaths = [
  pr11DecisionPath,
  "docs/reduction/inference-core/decision-register.md",
  "docs/reduction/inference-core/validation-register.md",
  "scripts/inference-core/pr11-boundaries.test.mjs",
  "scripts/inference-core/pr11-contract-revision.mjs",
]
export const pr11SuccessorHistoricalEvidenceBindings = [
  {
    retainedRevision: "PR-08",
    path: "docs/reduction/inference-core/decision-register.md",
    evidenceCommit: pr11ContractBase,
  },
  {
    retainedRevision: "PR-08",
    path: "docs/reduction/inference-core/validation-register.md",
    evidenceCommit: pr11ContractBase,
  },
]
export const pr11SuccessorHistoricalEvidencePaths = [
  ...new Set(pr11SuccessorHistoricalEvidenceBindings.map(({ path }) => path)),
].sort()
const pr11HistoricalEvidenceCommitByRevisionAndPath = new Map(
  pr11SuccessorHistoricalEvidenceBindings.map(
    ({ retainedRevision, path, evidenceCommit }) => [
      `${retainedRevision}\0${path}`,
      evidenceCommit,
    ],
  ),
)
export const pr10cSuccessorAwareHistoricalTestBindings = [
  {
    retainedRevision: "PR-05",
    path: "scripts/inference-core/pr05-boundaries.test.mjs",
    evidenceCommit: pr06ContractBase,
  },
  {
    retainedRevision: "PR-06",
    path: "scripts/inference-core/pr06-boundaries.test.mjs",
    evidenceCommit: pr07ContractBase,
  },
  {
    retainedRevision: "PR-09",
    path: "scripts/inference-core/pr05-boundaries.test.mjs",
    evidenceCommit: pr10ContractBase,
  },
  {
    retainedRevision: "PR-10",
    path: "scripts/inference-core/pr10-boundaries.test.mjs",
    evidenceCommit: pr10cContractBase,
  },
]
export const pr10cSuccessorAwareHistoricalTestPaths = [
  ...new Set(pr10cSuccessorAwareHistoricalTestBindings.map(({ path }) => path)),
].sort()
const pr10cHistoricalTestEvidenceCommitByRevisionAndPath = new Map(
  pr10cSuccessorAwareHistoricalTestBindings.map(
    ({ retainedRevision, path, evidenceCommit }) => [
      `${retainedRevision}\0${path}`,
      evidenceCommit,
    ],
  ),
)
export const pr10cSuccessorHistoricalEvidenceBindings = [
  {
    path: "scripts/inference-core/pr02-boundaries.test.mjs",
    evidenceCommit: pr10cSuccessorEvidenceCommit,
  },
]
const pr10cSuccessorHistoricalEvidenceCommitByPath = new Map(
  pr10cSuccessorHistoricalEvidenceBindings.map(({ path, evidenceCommit }) => [
    path,
    evidenceCommit,
  ]),
)
const pr04ImmutablePriorEvidencePaths = [
  pr02ContractRevisionPath,
  ...pr02RevisionEvidencePaths,
  pr03ContractRevisionPath,
  ...pr03RevisionEvidencePaths,
]
const pr05ImmutablePriorEvidencePaths = [
  pr02ContractRevisionPath,
  ...pr02RevisionEvidencePaths,
  pr03ContractRevisionPath,
  ...pr03RevisionEvidencePaths,
  pr04ContractRevisionPath,
  ...pr04RevisionEvidencePaths,
]
const pr06ImmutablePriorEvidencePaths = [
  ...pr05ImmutablePriorEvidencePaths,
  pr05ContractRevisionPath,
  ...pr05RevisionEvidencePaths,
]
const pr07ImmutablePriorEvidencePaths = [
  ...pr06ImmutablePriorEvidencePaths,
  pr06ContractRevisionPath,
  ...pr06RevisionEvidencePaths,
]
const pr08ImmutablePriorEvidencePaths = [
  ...pr07ImmutablePriorEvidencePaths,
  pr07ContractRevisionPath,
  ...pr07RevisionEvidencePaths,
]
const pr09ImmutablePriorEvidencePaths = [
  ...pr08ImmutablePriorEvidencePaths,
  pr08ContractRevisionPath,
  ...pr08RevisionEvidencePaths,
]
const pr10ImmutablePriorEvidencePaths = [
  ...pr09ImmutablePriorEvidencePaths,
  pr09ContractRevisionPath,
  ...pr09RevisionEvidencePaths,
]
const pr10cImmutablePriorEvidencePaths = [
  ...pr10ImmutablePriorEvidencePaths,
  pr10ContractRevisionPath,
  ...pr10RevisionEvidencePaths,
]
const pr11ImmutablePriorEvidencePaths = [
  ...pr10cImmutablePriorEvidencePaths,
  pr10cContractRevisionPath,
  ...pr10cRevisionEvidencePaths,
]
const generatedContractPaths = new Set([
  allowlistPath,
  routeBaselinePath,
  pr02ContractRevisionPath,
  pr03ContractRevisionPath,
  pr04ContractRevisionPath,
  pr05ContractRevisionPath,
  pr06ContractRevisionPath,
  pr07ContractRevisionPath,
  pr08ContractRevisionPath,
  pr09ContractRevisionPath,
  pr10ContractRevisionPath,
  pr10cContractRevisionPath,
  pr11ContractRevisionPath,
])
export const pr02OperationPolicy = {
  changedSourcePaths: [
    "apps/bff/src/auth/persona.ts",
    "apps/bff/src/index.ts",
    "apps/bff/src/openai/types.ts",
    "apps/bff/src/routes/admin.ts",
    "apps/bff/src/routes/app-gateway.ts",
    "apps/bff/src/services/admin-audit.ts",
    "apps/bff/src/services/admin-connected-apps.ts",
    "apps/bff/src/services/admin-hardware.ts",
    "apps/bff/src/services/admin-health.ts",
    "apps/bff/src/services/admin-inference.ts",
    "apps/bff/src/services/admin-ops.ts",
    "apps/bff/src/services/admin-overview.ts",
    "apps/bff/src/services/admin-settings-validation.ts",
    "apps/bff/src/services/admin-team.ts",
    "apps/bff/src/services/audit.ts",
    "apps/bff/src/services/users.ts",
    "apps/web/src/app/applications/[[...section]]/page.tsx",
    "apps/web/src/app/hardware/page.tsx",
    "apps/web/src/app/inference/[[...section]]/page.tsx",
    "apps/web/src/app/page.tsx",
    "apps/web/src/app/settings/page.tsx",
    "apps/web/src/app/team/[[...section]]/page.tsx",
    "apps/web/src/components/console-v2/action-toasts.tsx",
    "apps/web/src/components/console-v2/applications-v2-experience.tsx",
    "apps/web/src/components/console-v2/console-v2-icons.tsx",
    "apps/web/src/components/console-v2/console-v2-sections.ts",
    "apps/web/src/components/console-v2/console-v2-shell.tsx",
    "apps/web/src/components/console-v2/hardware-chart-primitives.tsx",
    "apps/web/src/components/console-v2/hardware-v2-experience.tsx",
    "apps/web/src/components/console-v2/inference-v2-experience.tsx",
    "apps/web/src/components/console-v2/settings-v2-experience.tsx",
    "apps/web/src/components/console-v2/team-v2-experience.tsx",
    "apps/web/src/lib/admin/console-v2-routes.tsx",
    "apps/web/src/lib/auth/sso-bridge.ts",
    "packages/contracts/package.json",
  ],
  addedSourcePaths: [
    "apps/bff/src/auth/keycloak-jwt.ts",
    "apps/bff/src/db/inference-core-client.ts",
    "apps/bff/src/db/inference-core-schema.ts",
    "apps/bff/src/inference/chat-completions.ts",
    "apps/bff/src/services/admin-settings-core.ts",
    "apps/bff/src/services/application-gateway-policy.ts",
    "apps/bff/src/services/expert-capabilities.ts",
    "apps/bff/src/services/inference-core-keycloak-admin.ts",
    "apps/bff/src/services/litellm-chat-transport.ts",
    "apps/web/src/lib/admin/actions-core.ts",
    "apps/web/src/lib/admin/console-v2-routes-core.tsx",
    "apps/web/src/lib/admin/server-data-core.ts",
    "packages/contracts/src/inference-core.ts",
  ],
  deletedSourcePaths: [],
  changedRepositoryPaths: [
    ".env.example",
    "apps/bff/src/auth/persona-security.test.ts",
    "apps/bff/src/auth/persona.ts",
    "apps/bff/src/index.ts",
    "apps/bff/src/openai/types.ts",
    "apps/bff/src/routes/admin-hardware.test.ts",
    "apps/bff/src/routes/admin-inference.test.ts",
    "apps/bff/src/routes/admin-overview-health.test.ts",
    "apps/bff/src/routes/admin-overview-ops.test.ts",
    "apps/bff/src/routes/admin.test.ts",
    "apps/bff/src/routes/admin.ts",
    "apps/bff/src/routes/app-gateway.test.ts",
    "apps/bff/src/routes/app-gateway.ts",
    "apps/bff/src/routes/inference-core-characterization.test.ts",
    "apps/bff/src/services/admin-audit.ts",
    "apps/bff/src/services/admin-connected-apps-accounting.test.ts",
    "apps/bff/src/services/admin-connected-apps.ts",
    "apps/bff/src/services/admin-hardware.ts",
    "apps/bff/src/services/admin-health.ts",
    "apps/bff/src/services/admin-inference.ts",
    "apps/bff/src/services/admin-ops.ts",
    "apps/bff/src/services/admin-overview.ts",
    "apps/bff/src/services/admin-settings-validation.ts",
    "apps/bff/src/services/admin-team.ts",
    "apps/bff/src/services/audit.ts",
    "apps/bff/src/services/users.test.ts",
    "apps/bff/src/services/users.ts",
    "apps/web/src/app/applications/[[...section]]/page.tsx",
    "apps/web/src/app/hardware/page.tsx",
    "apps/web/src/app/inference/[[...section]]/page.tsx",
    "apps/web/src/app/page.test.tsx",
    "apps/web/src/app/page.tsx",
    "apps/web/src/app/settings/page.tsx",
    "apps/web/src/app/team/[[...section]]/page.tsx",
    "apps/web/src/components/console-v2/action-toasts.test.tsx",
    "apps/web/src/components/console-v2/action-toasts.tsx",
    "apps/web/src/components/console-v2/applications-v2-experience.tsx",
    "apps/web/src/components/console-v2/console-v2-icons.tsx",
    "apps/web/src/components/console-v2/console-v2-sections.ts",
    "apps/web/src/components/console-v2/console-v2-shell.test.tsx",
    "apps/web/src/components/console-v2/console-v2-shell.tsx",
    "apps/web/src/components/console-v2/hardware-chart-primitives.tsx",
    "apps/web/src/components/console-v2/hardware-v2-experience.tsx",
    "apps/web/src/components/console-v2/inference-v2-experience.tsx",
    "apps/web/src/components/console-v2/settings-v2-experience.tsx",
    "apps/web/src/components/console-v2/team-v2-experience.tsx",
    "apps/web/src/lib/admin/console-v2-routes.tsx",
    "apps/web/src/lib/auth/sso-bridge.test.ts",
    "apps/web/src/lib/auth/sso-bridge.ts",
    "docs/reduction/inference-core/README.md",
    "packages/contracts/package.json",
    "scripts/inference-core/guardrails.mjs",
    "scripts/inference-core/guardrails.test.mjs",
  ],
  addedRepositoryPaths: [
    "apps/bff/src/auth/keycloak-jwt.ts",
    "apps/bff/src/db/inference-core-client.ts",
    "apps/bff/src/db/inference-core-schema.test.ts",
    "apps/bff/src/db/inference-core-schema.ts",
    "apps/bff/src/inference/chat-completions.ts",
    "apps/bff/src/routes/app-gateway-boundary.test.ts",
    "apps/bff/src/services/admin-settings-core.ts",
    "apps/bff/src/services/application-gateway-policy.ts",
    "apps/bff/src/services/expert-capabilities.test.ts",
    "apps/bff/src/services/expert-capabilities.ts",
    "apps/bff/src/services/inference-core-keycloak-admin.test.ts",
    "apps/bff/src/services/inference-core-keycloak-admin.ts",
    "apps/bff/src/services/litellm-chat-transport.ts",
    "apps/web/src/lib/admin/actions-core.test.ts",
    "apps/web/src/lib/admin/actions-core.ts",
    "apps/web/src/lib/admin/console-v2-routes-core.tsx",
    "apps/web/src/lib/admin/retained-core-boundaries.test.ts",
    "apps/web/src/lib/admin/server-data-core.test.ts",
    "apps/web/src/lib/admin/server-data-core.ts",
    "docs/reduction/inference-core/pr-02-boundary-decisions.json",
    "packages/contracts/src/inference-core.test.ts",
    "packages/contracts/src/inference-core.ts",
    "scripts/inference-core/pr02-boundaries.test.mjs",
    "scripts/inference-core/pr02-contract-revision.mjs",
  ],
  deletedRepositoryPaths: [
    "apps/bff/src/routes/admin-governance-detail.test.ts",
    "apps/bff/src/routes/admin-overview-governance.test.ts",
    "apps/bff/src/routes/agentic-runtime.test.ts",
    "apps/bff/src/routes/builder.test.ts",
    "apps/bff/src/routes/hub.test.ts",
    "apps/bff/src/routes/knowledge-pdf-parser.e2e.test.ts",
    "apps/bff/src/routes/knowledge.test.ts",
    "apps/bff/src/routes/mcp-gateway.test.ts",
    "apps/bff/src/routes/openai-compatible.test.ts",
  ],
  mutableEscapeHatchPaths: ["apps/bff/src/auth/persona.ts"],
}

const guardrailExclusions = new Set([
  "apps/bff/src/db/inference-core-schema.test.ts",
  "apps/bff/src/routes/app-gateway-boundary.test.ts",
  "apps/bff/src/routes/inference-core-characterization.test.ts",
  "apps/bff/src/services/inference-core-keycloak-admin.test.ts",
  "apps/web/src/lib/admin/retained-core-boundaries.test.ts",
  "packages/contracts/src/inference-core-authorization.test.ts",
  "packages/contracts/src/inference-core.test.ts",
  "docs/reduction/inference-core/README.md",
  "docs/reduction/inference-core/forbidden-surface-allowlist.yaml",
  "docs/reduction/inference-core/contract-revisions/PR-02.json",
  "docs/reduction/inference-core/contract-revisions/PR-03.json",
  "docs/reduction/inference-core/contract-revisions/PR-04.json",
  "docs/reduction/inference-core/contract-revisions/PR-05.json",
  "docs/reduction/inference-core/contract-revisions/PR-06.json",
  "docs/reduction/inference-core/contract-revisions/PR-07.json",
  "docs/reduction/inference-core/contract-revisions/PR-08.json",
  "docs/reduction/inference-core/contract-revisions/PR-09.json",
  "docs/reduction/inference-core/contract-revisions/PR-10.json",
  "docs/reduction/inference-core/contract-revisions/PR-10C.json",
  "docs/reduction/inference-core/contract-revisions/PR-11.json",
  "docs/reduction/inference-core/pr-02-boundary-decisions.json",
  "docs/reduction/inference-core/pr-03-removal-decisions.json",
  "docs/reduction/inference-core/pr-04-data-decisions.json",
  "docs/reduction/inference-core/pr-05-identity-decisions.json",
  "docs/reduction/inference-core/pr-06-application-decisions.json",
  "docs/reduction/inference-core/pr-07-data-plane-decisions.json",
  "docs/reduction/inference-core/pr-08-firecrawl-decisions.json",
  "docs/reduction/inference-core/pr-08-firecrawl-source-manifest.json",
  "docs/reduction/inference-core/pr-09-activity-audit-observability-decisions.json",
  "docs/reduction/inference-core/pr-10-lifecycle-foundation-decisions.json",
  "docs/reduction/inference-core/pr-10c-emergency-isolation-decisions.json",
  "docs/reduction/inference-core/pr-11-console-information-architecture-decisions.json",
  "docs/reduction/inference-core/decision-register.md",
  "docs/reduction/inference-core/source-map.jsonl",
  "docs/reduction/inference-core/validation-register.md",
  "docs/reduction/inference-core/retention-characterization.json",
  "docs/reduction/inference-core/route-baseline.json",
  "scripts/inference-core/guardrails.mjs",
  "scripts/inference-core/guardrails.test.mjs",
  "scripts/inference-core/pr02-contract-revision.mjs",
  "scripts/inference-core/pr02-boundaries.test.mjs",
  "scripts/inference-core/pr03-contract-revision.mjs",
  "scripts/inference-core/pr03-boundaries.test.mjs",
  "scripts/inference-core/pr04-contract-revision.mjs",
  "scripts/inference-core/pr04-boundaries.test.mjs",
  "scripts/inference-core/pr05-contract-revision.mjs",
  "scripts/inference-core/pr05-boundaries.test.mjs",
  "scripts/inference-core/pr06-contract-revision.mjs",
  "scripts/inference-core/pr06-boundaries.test.mjs",
  "scripts/inference-core/pr07-contract-revision.mjs",
  "scripts/inference-core/pr07-boundaries.test.mjs",
  "scripts/inference-core/pr08-contract-revision.mjs",
  "scripts/inference-core/pr08-boundaries.test.mjs",
  "scripts/inference-core/pr09-contract-revision.mjs",
  "scripts/inference-core/pr09-boundaries.test.mjs",
  "scripts/inference-core/pr10-contract-revision.mjs",
  "scripts/inference-core/pr10-boundaries.test.mjs",
  "scripts/inference-core/pr10c-contract-revision.mjs",
  "scripts/inference-core/pr10c-boundaries.test.mjs",
  "scripts/inference-core/pr11-contract-revision.mjs",
  "scripts/inference-core/pr11-boundaries.test.mjs",
  "scripts/inference-core/retention-canary.mjs",
  "scripts/inference-core/retention-canary.test.mjs",
  "scripts/inference-core/run-core-command.mjs",
  "scripts/inference-core/run-core-command.test.mjs",
])
const protectedGuardrailPaths = [
  "apps/bff/tsconfig.json",
  "apps/bff/vitest.config.ts",
  "apps/bff/src/db/inference-core-schema.test.ts",
  "apps/bff/src/routes/app-gateway-boundary.test.ts",
  "apps/bff/src/routes/inference-core-characterization.test.ts",
  "apps/bff/src/services/inference-core-keycloak-admin.test.ts",
  "apps/web/tsconfig.json",
  "apps/web/vitest.config.ts",
  "apps/web/src/lib/admin/retained-core-boundaries.test.ts",
  "apps/web/src/middleware.test.ts",
  "apps/web/src/middleware.ts",
  "docs/reduction/inference-core/pr-02-boundary-decisions.json",
  "docs/reduction/inference-core/pr-03-removal-decisions.json",
  "docs/reduction/inference-core/pr-04-data-decisions.json",
  "docs/reduction/inference-core/pr-05-identity-decisions.json",
  "docs/reduction/inference-core/pr-06-application-decisions.json",
  "docs/reduction/inference-core/pr-07-data-plane-decisions.json",
  "docs/reduction/inference-core/pr-08-firecrawl-decisions.json",
  "docs/reduction/inference-core/pr-08-firecrawl-source-manifest.json",
  "docs/reduction/inference-core/pr-09-activity-audit-observability-decisions.json",
  "docs/reduction/inference-core/pr-10-lifecycle-foundation-decisions.json",
  "docs/reduction/inference-core/pr-10c-emergency-isolation-decisions.json",
  "docs/reduction/inference-core/pr-11-console-information-architecture-decisions.json",
  "docs/reduction/inference-core/decision-register.md",
  "docs/reduction/inference-core/source-map.jsonl",
  "docs/reduction/inference-core/validation-register.md",
  "packages/contracts/src/inference-core-authorization.test.ts",
  "packages/contracts/src/inference-core-authorization.ts",
  "packages/contracts/src/inference-core.test.ts",
  "packages/contracts/tsconfig.build.json",
  "packages/contracts/tsconfig.json",
  "packages/copy/tsconfig.build.json",
  "packages/copy/tsconfig.json",
  "pnpm-workspace.yaml",
  "scripts/inference-core/guardrails.mjs",
  "scripts/inference-core/guardrails.test.mjs",
  "scripts/inference-core/pr02-boundaries.test.mjs",
  "scripts/inference-core/pr02-contract-revision.mjs",
  "scripts/inference-core/pr03-boundaries.test.mjs",
  "scripts/inference-core/pr03-contract-revision.mjs",
  "scripts/inference-core/pr04-boundaries.test.mjs",
  "scripts/inference-core/pr04-contract-revision.mjs",
  "scripts/inference-core/pr05-boundaries.test.mjs",
  "scripts/inference-core/pr05-contract-revision.mjs",
  "scripts/inference-core/pr06-boundaries.test.mjs",
  "scripts/inference-core/pr06-contract-revision.mjs",
  "scripts/inference-core/pr07-boundaries.test.mjs",
  "scripts/inference-core/pr07-contract-revision.mjs",
  "scripts/inference-core/pr08-boundaries.test.mjs",
  "scripts/inference-core/pr08-contract-revision.mjs",
  "scripts/inference-core/pr09-boundaries.test.mjs",
  "scripts/inference-core/pr09-contract-revision.mjs",
  "scripts/inference-core/pr10-boundaries.test.mjs",
  "scripts/inference-core/pr10-contract-revision.mjs",
  "scripts/inference-core/pr10c-boundaries.test.mjs",
  "scripts/inference-core/pr10c-contract-revision.mjs",
  "scripts/inference-core/pr11-boundaries.test.mjs",
  "scripts/inference-core/pr11-contract-revision.mjs",
  "scripts/inference-core/retention-canary.mjs",
  "scripts/inference-core/retention-canary.test.mjs",
  "scripts/inference-core/run-core-command.mjs",
  "scripts/inference-core/run-core-command.test.mjs",
  "tsconfig.base.json",
]

const pathRules = [
  {
    id: "FS001_RETIRED_BFF_MODULE",
    pattern:
      /^apps\/bff\/src\/(?:routes\/(?:agentic-runtime|builder|hub|knowledge|mcp-gateway|openai-compatible)(?:\.(?:test|spec))?\.(?:cjs|cts|js|jsx|mjs|mts|ts|tsx)|routes\/knowledge-pdf-parser\.e2e\.(?:test|spec)\.(?:cjs|cts|js|jsx|mjs|mts|ts|tsx)|catalog\/(?:mcp-catalog|signed-catalog(?:\.(?:test|spec))?)\.(?:cjs|cts|js|jsx|mjs|mts|ts|tsx)|services\/(?:admin-approvals|admin-connector-registry|approval-envelope|builder|egress-approvals|hub|hub-events(?:\.(?:test|spec))?|internal-docs-mcp-posture|librechat-backfill(?:\.(?:test|spec))?|librechat-native-agents|mcp-gateway|slash-middleware|agentic-runtime-client|agentic-runtime-history)\.(?:cjs|cts|js|jsx|mjs|mts|ts|tsx)|services\/knowledge\/|scripts\/backfill-knowledge-embeddings\.(?:cjs|cts|js|jsx|mjs|mts|ts|tsx)|workers\/knowledge-url-acquisition\.(?:cjs|cts|js|jsx|mjs|mts|ts|tsx))/,
    removeBy: "PR-03",
  },
  {
    id: "FS002_RETIRED_WEB_MODULE",
    pattern:
      /^apps\/web\/src\/(?:app\/api\/(?:builder|hub)\/|app\/(?:artifacts|builder|chat|knowledge|profile|resources|tasks|usage)(?:\/|$)|components\/(?:builder|hub)(?:\/|$)|components\/console-v2\/knowledge-v2-experience\.tsx$|lib\/(?:builder|hub|knowledge)(?:\/|$))/,
    removeBy: "PR-03",
  },
  {
    id: "FS003_RETIRED_CONTRACT_MODULE",
    pattern:
      /^packages\/contracts\/src\/(?:builder|hub|knowledge)(?:\.(?:test|spec))?\.(?:cjs|cts|js|jsx|mjs|mts|ts|tsx)$/,
    removeBy: "PR-03",
  },
  {
    id: "FS004_RETIRED_PACKAGE",
    pattern: /^apps\/(?:agentic-adapter|pdf-parser|reranker-api|sidecar)\//,
    removeBy: "PR-03",
  },
  {
    id: "FS005_RETIRED_KNOWLEDGE_FIXTURE",
    pattern: /^test-fixtures\/knowledge\//,
    removeBy: "PR-03",
  },
  {
    id: "FS006_RETIRED_MIGRATION",
    pattern:
      /^infra\/migrations\/(?:0001_agentic_|0002_align_egress_|0009_builder_|0011_agentic_|0015_admin_builder_|0016_admin_connector_vetting_|0017_connector_vetting_)/,
    removeBy: "PR-04",
  },
]

const fs103LowerIdentifierTerms =
  "(?:knowledge|corpus|corpora|ragflow|rag|embeddings?)"
const fs103TitleIdentifierTerms =
  "(?:Knowledge|Corpus|Corpora|RAGFlow|RagFlow|Ragflow|Rag|Embeddings?)"
const fs103UpperIdentifierTerms =
  "(?:KNOWLEDGE|CORPUS|CORPORA|RAGFLOW|RAG|EMBEDDINGS?)"
const fs103IdentifierAwarePattern = [
  `(?<![A-Za-z0-9])(?:${fs103LowerIdentifierTerms}|${fs103TitleIdentifierTerms}|${fs103UpperIdentifierTerms})(?![A-Za-z0-9])`,
  `(?<![A-Za-z0-9])${fs103LowerIdentifierTerms}(?=[A-Z])`,
  `${fs103TitleIdentifierTerms}(?=$|[^a-z0-9])`,
].join("|")

const contentRules = [
  {
    id: "FS101_AGENTIC_RUNTIME",
    pattern: "agentic|openclaw|hermes|nemoclaw|openshell",
    flags: "giu",
    removeBy: "PR-04",
  },
  {
    id: "FS102_MCP",
    pattern: "mcp",
    flags: "giu",
    removeBy: "PR-03",
  },
  {
    id: "FS103_KNOWLEDGE_RAG",
    pattern: fs103IdentifierAwarePattern,
    flags: "gu",
    removeBy: "PR-04",
  },
  {
    id: "FS104_LIBRECHAT",
    pattern: "librechat",
    flags: "giu",
    removeBy: "PR-03",
  },
  {
    id: "FS105_BUILDER_HUB",
    pattern:
      "\\b[Bb][Uu][Ii][Ll][Dd][Ee][Rr](?=\\b|[A-Z_])|Builder(?=$|[^a-z]|[A-Z])|\\bbuilder(?=[A-Z_])|\\b[Hh][Uu][Bb](?=\\b|[A-Z_])|(?<![Gg]it)Hub(?=$|[^a-z]|[A-Z])|\\bhub(?=[A-Z_])",
    flags: "gu",
    removeBy: "PR-03",
  },
  {
    id: "FS106_RETIRED_PROCESSING",
    pattern: "pdf[-_ ]parser|rerank|\\bocr\\b|\\bsidecar\\b",
    flags: "giu",
    removeBy: "PR-03",
  },
  {
    id: "FS107_RETIRED_DATA_DEPENDENCY",
    pattern: "\\b(?:mongodb|minio|ioredis|redis|temporal|pgvector)\\b",
    flags: "giu",
    removeBy: "PR-04",
  },
  {
    id: "FS108_RETIRED_GOVERNANCE",
    pattern:
      "url[-_ ]?policy|urlPolicy|pure[-_ ]?mode|pureMode|promote[-_ ]production|break[-_ ]glass|breakGlass",
    flags: "giu",
    removeBy: "PR-06",
  },
  {
    id: "FS109_LEGACY_PERSONA",
    pattern:
      "\\bconsumer\\b|withPersona|personaCanAccess|personaSchema|personaRank",
    flags: "giu",
    removeBy: "PR-05",
  },
  {
    id: "FS110_COMFYUI",
    pattern: "comfyui",
    flags: "giu",
    removeBy: "PR-03",
  },
  {
    id: "FS111_CONNECTOR_GOVERNANCE",
    pattern:
      "connector[-_ ]?registry|connectorRegistry|ConnectorRegistry|connector[-_ ]?vetting|connectorVetting|ConnectorVetting|vettingStatus|VettingStatus|pending_vetting",
    flags: "giu",
    removeBy: "PR-03",
  },
]

const findingDispositionOverrides = [
  {
    ruleId: "FS102_MCP",
    path: "infra/migrations/0021_admin_mcp_servers.sql",
    from: "PR-03",
    removeBy: "PR-04",
    reason:
      "Historical MCP migration evidence remains immutable until the PR-04 migration retirement.",
  },
  {
    ruleId: "FS102_MCP",
    path: "infra/migrations/0022_admin_settings.sql",
    from: "PR-03",
    removeBy: "PR-04",
    reason:
      "Historical MCP migration evidence remains immutable until the PR-04 migration retirement.",
  },
  {
    ruleId: "FS105_BUILDER_HUB",
    path: "apps/bff/src/auth/persona.ts",
    from: "PR-03",
    removeBy: "PR-05",
    reason: "Retained legacy Persona seam scheduled for replacement in PR-05.",
  },
  {
    ruleId: "FS105_BUILDER_HUB",
    path: "apps/web/src/middleware.test.ts",
    from: "PR-03",
    removeBy: "PR-12",
    reason:
      "Negative retired-route tombstone proving /builder reaches the Next.js 404 boundary is retained through PR-12 final product qualification.",
  },
  {
    ruleId: "FS105_BUILDER_HUB",
    path: "infra/migrations/0000_init_schemas.sql",
    from: "PR-03",
    removeBy: "PR-04",
    reason:
      "Historical Builder and Hub migration evidence remains immutable until the PR-04 migration retirement.",
  },
  {
    ruleId: "FS105_BUILDER_HUB",
    path: "infra/migrations/0003_builder_lifecycle_tables.sql",
    from: "PR-03",
    removeBy: "PR-04",
    reason:
      "Historical Builder and Hub migration evidence remains immutable until the PR-04 migration retirement.",
  },
  {
    ruleId: "FS105_BUILDER_HUB",
    path: "infra/migrations/0004_builder_withdrawn_lifecycle_state.sql",
    from: "PR-03",
    removeBy: "PR-04",
    reason:
      "Historical Builder and Hub migration evidence remains immutable until the PR-04 migration retirement.",
  },
  {
    ruleId: "FS105_BUILDER_HUB",
    path: "infra/migrations/0005_builder_agent_configs.sql",
    from: "PR-03",
    removeBy: "PR-04",
    reason:
      "Historical Builder and Hub migration evidence remains immutable until the PR-04 migration retirement.",
  },
  {
    ruleId: "FS105_BUILDER_HUB",
    path: "infra/migrations/0006_hub_chat_threads.sql",
    from: "PR-03",
    removeBy: "PR-04",
    reason:
      "Historical Builder and Hub migration evidence remains immutable until the PR-04 migration retirement.",
  },
  {
    ruleId: "FS105_BUILDER_HUB",
    path: "infra/migrations/0010_builder_agent_test_run_accounting.sql",
    from: "PR-03",
    removeBy: "PR-04",
    reason:
      "Historical Builder and Hub migration evidence remains immutable until the PR-04 migration retirement.",
  },
  {
    ruleId: "FS105_BUILDER_HUB",
    path: "infra/migrations/0012_builder_agent_test_run_trace.sql",
    from: "PR-03",
    removeBy: "PR-04",
    reason:
      "Historical Builder and Hub migration evidence remains immutable until the PR-04 migration retirement.",
  },
  {
    ruleId: "FS105_BUILDER_HUB",
    path: "infra/migrations/0013_builder_agent_test_runtime_trace_id.sql",
    from: "PR-03",
    removeBy: "PR-04",
    reason:
      "Historical Builder and Hub migration evidence remains immutable until the PR-04 migration retirement.",
  },
  {
    ruleId: "FS105_BUILDER_HUB",
    path: "infra/migrations/0014_builder_agent_test_tool_calls.sql",
    from: "PR-03",
    removeBy: "PR-04",
    reason:
      "Historical Builder and Hub migration evidence remains immutable until the PR-04 migration retirement.",
  },
  {
    ruleId: "FS105_BUILDER_HUB",
    path: "packages/contracts/src/common.ts",
    from: "PR-03",
    removeBy: "PR-05",
    reason:
      "Retained legacy Persona schema scheduled for replacement in PR-05.",
  },
]

const ignoredFindingFingerprints = [
  {
    ruleId: "FS102_MCP",
    path: "pnpm-lock.yaml",
    fingerprint:
      "67bb7fa84a2daa8084c7f0585782ce5bb70fc65cfb137fb36ea4dd66c9367186",
    reason:
      "Random case-insensitive mcP substring inside the pinned lightningcss-win32-arm64-msvc integrity digest; no MCP package or configuration.",
  },
]

const pr08IgnoredFindingFingerprints = [
  {
    ruleId: "FS106_RETIRED_PROCESSING",
    path: "infra/firecrawl/README.md",
    fingerprint:
      "f1ec2b758aca1637ab1223eed5ebee9cdfc02458b56b2d9bd8ddae1998793252",
    reason: "Negative reduced-profile dependency exclusion.",
  },
  {
    ruleId: "FS106_RETIRED_PROCESSING",
    path: "infra/firecrawl/provenance/source-lock.json",
    fingerprint:
      "a238ba4555d968c8189cf515f550eba4658e26fe576685a4ed44922e846adde4",
    reason: "Bound negative dependency inventory in source provenance.",
  },
  {
    ruleId: "FS106_RETIRED_PROCESSING",
    path: "infra/firecrawl/validate-profile.mjs",
    fingerprint:
      "a238ba4555d968c8189cf515f550eba4658e26fe576685a4ed44922e846adde4",
    reason: "Static validator rejects the named excluded dependency.",
  },
  {
    ruleId: "FS106_RETIRED_PROCESSING",
    path: "infra/firecrawl/validate-profile.mjs",
    fingerprint:
      "b70ac085e76d8b7336faac62693cc162f4da176dcbdec0be7ae7b8e783d3f1f7",
    reason: "Static validator rejects retired processing variables.",
  },
  {
    ruleId: "FS107_RETIRED_DATA_DEPENDENCY",
    path: "apps/bff/src/services/inference-core-retention.test.ts",
    fingerprint:
      "e48dc57e4197ffd82b68af5bbaf0651b9db5d85d050a715ff1b92aa80288a05c",
    reason: "Negative test proves the retired dependency is absent.",
  },
  {
    ruleId: "FS107_RETIRED_DATA_DEPENDENCY",
    path: "infra/firecrawl/README.md",
    fingerprint:
      "8474cb09d1e9562a0472ea2d8c22474523602366941145552eebd0cb15f060ec",
    reason: "Negative reduced-profile dependency exclusion.",
  },
  {
    ruleId: "FS107_RETIRED_DATA_DEPENDENCY",
    path: "infra/firecrawl/provenance/source-lock.json",
    fingerprint:
      "86a8ebc333d58e1633448e579f64d6a9223c5291ef994c695dd3ef2bb4cf7630",
    reason: "Bound negative dependency inventory in source provenance.",
  },
  {
    ruleId: "FS107_RETIRED_DATA_DEPENDENCY",
    path: "infra/firecrawl/validate-profile.mjs",
    fingerprint:
      "00c71abd7195245ed5b3ce94d115879fe4ce3ff313d93bcf1776b8ecf876122c",
    reason: "Static validator rejects retired data-service variables.",
  },
  {
    ruleId: "FS107_RETIRED_DATA_DEPENDENCY",
    path: "infra/firecrawl/validate-profile.mjs",
    fingerprint:
      "13cfef723dab099301a34d58a99a5e2596cc0276e5337f5eb37d78bc28e21ff7",
    reason: "Static validator rejects a retired service name.",
  },
  {
    ruleId: "FS107_RETIRED_DATA_DEPENDENCY",
    path: "infra/firecrawl/validate-profile.mjs",
    fingerprint:
      "64a4f42a926f362f46b3470d25d66ce5ecfeca5ed63d7ff6281e9d70d2f33615",
    reason: "Static validator rejects embedded retired cache settings.",
  },
  {
    ruleId: "FS107_RETIRED_DATA_DEPENDENCY",
    path: "infra/firecrawl/validate-profile.mjs",
    fingerprint:
      "d6efbbd4eabc6ebe79839e90f1b4adedc11813bc17a1c5653efafeedb1c84bfa",
    reason: "Static validator binds the negative dependency inventory.",
  },
  {
    ruleId: "FS107_RETIRED_DATA_DEPENDENCY",
    path: "infra/firecrawl/validate-profile.test.mjs",
    fingerprint:
      "235c8890986b013c2504bcad040d590910d45fcb3b83f97a62f08fcd23da1aac",
    reason: "Negative fixture proves retired cache settings fail closed.",
  },
]

export const pr04RetiredDependencyBoundary = {
  path: "pnpm-lock.yaml",
  package: "drizzle-orm@0.44.2",
  dependency: "@upstash/redis",
  peerRange: ">=1.34.7",
  classification: "optional-peer-metadata-only",
  requiredOccurrences: 2,
}

export const pr04NestedTestRetiredDependencyBoundary = {
  path: "test-support/inference-core-db-tests/pnpm-lock.yaml",
  package: "drizzle-orm@0.44.2",
  dependency: "@upstash/redis",
  peerRange: ">=1.34.7",
  classification: "optional-peer-metadata-only-test-lock",
  requiredOccurrences: 2,
}

export const pr04RetiredDependencyBoundaries = [
  pr04RetiredDependencyBoundary,
  pr04NestedTestRetiredDependencyBoundary,
]

export const pr04StandaloneDbTestBoundary = {
  path: "test-support/inference-core-db-tests",
  classification: "standalone-test-only-workspace",
  allowedPaths: [
    "test-support/inference-core-db-tests/package.json",
    "test-support/inference-core-db-tests/pnpm-lock.yaml",
    "test-support/inference-core-db-tests/pnpm-workspace.yaml",
    "test-support/inference-core-db-tests/src/admin-connected-apps-storage.test.ts",
    "test-support/inference-core-db-tests/src/idempotency.test.ts",
    "test-support/inference-core-db-tests/src/inference-core-migration.test.ts",
    "test-support/inference-core-db-tests/src/inference-core-retention.test.ts",
    "test-support/inference-core-db-tests/tsconfig.json",
  ],
  packageManifest: {
    path: "test-support/inference-core-db-tests/package.json",
    sha256: "ff725f8972d4a0e4ed349daa1ffbfb4aa10ab40a4c76be60f739125781c85470",
    name: "@llm-machines/inference-core-db-tests",
    packageManager: "pnpm@10.0.0",
    scripts: {
      test: "vitest run",
      typecheck: "tsc --project tsconfig.json",
    },
    devDependencies: {
      "@electric-sql/pglite": "0.5.4",
      "@types/node": "22.15.18",
      "drizzle-orm": "0.44.2",
      typescript: "5.8.3",
      vitest: "3.1.4",
    },
  },
  lockfile: {
    path: "test-support/inference-core-db-tests/pnpm-lock.yaml",
    sha256: "a7318f062798050494d0651ba28ca8ae50ab01b1db085bb1bdd884f3e79d5c61",
  },
  workspaceManifest: {
    path: "test-support/inference-core-db-tests/pnpm-workspace.yaml",
    sha256: "44b627aa58902d12f2b7469e46784fd611bac456409c630d7636c0e7059c14aa",
  },
  tsconfig: {
    path: "test-support/inference-core-db-tests/tsconfig.json",
    sha256: "28282abe534bce160861ed5c0798292c960cb61c7dfa5636d552a245c7223d09",
  },
  rootIsolation: {
    workspaceManifestPath: "pnpm-workspace.yaml",
    rootLockfilePath: "pnpm-lock.yaml",
    productionManifestPath: "apps/bff/package.json",
    pglitePackage: "@electric-sql/pglite",
    drizzlePackage: "drizzle-orm@0.44.2",
    pglitePeerRange: ">=0.2.0",
    allowedRootMetadataOccurrences: 2,
  },
  rootScripts: {
    "test:inference-core-db":
      "corepack pnpm --dir test-support/inference-core-db-tests install --frozen-lockfile --ignore-scripts && corepack pnpm --dir test-support/inference-core-db-tests test",
    "typecheck:inference-core-db":
      "corepack pnpm --dir test-support/inference-core-db-tests install --frozen-lockfile --ignore-scripts && corepack pnpm --dir test-support/inference-core-db-tests typecheck",
  },
}

export const pr05StandaloneDbTestBoundary = {
  ...pr04StandaloneDbTestBoundary,
  allowedPaths: [
    ...pr04StandaloneDbTestBoundary.allowedPaths,
    "test-support/inference-core-db-tests/src/pr05-emergency-recovery.test.ts",
    "test-support/inference-core-db-tests/src/pr05-identity-mutation-journal.test.ts",
  ].sort(),
}

export const pr06StandaloneDbTestBoundary = {
  ...pr05StandaloneDbTestBoundary,
  allowedPaths: [
    ...pr05StandaloneDbTestBoundary.allowedPaths,
    "test-support/inference-core-db-tests/src/pr06-application-credential-reconciliation.test.ts",
  ].sort(),
}

export const pr07StandaloneDbTestBoundary = {
  ...pr06StandaloneDbTestBoundary,
  allowedPaths: [
    ...pr06StandaloneDbTestBoundary.allowedPaths,
    "test-support/inference-core-db-tests/src/pr07-inference-data-plane.test.ts",
  ].sort(),
}

export const pr08StandaloneDbTestBoundary = {
  ...pr07StandaloneDbTestBoundary,
  allowedPaths: [
    ...pr07StandaloneDbTestBoundary.allowedPaths,
    "test-support/inference-core-db-tests/src/pr08-firecrawl-schema.test.ts",
  ].sort(),
}

export const pr09StandaloneDbTestBoundary = {
  ...pr08StandaloneDbTestBoundary,
  allowedPaths: [
    ...pr08StandaloneDbTestBoundary.allowedPaths,
    "test-support/inference-core-db-tests/src/pr09-alert-egress.test.ts",
    "test-support/inference-core-db-tests/src/pr09-audit-ingestion.test.ts",
  ].sort(),
}

export const pr04ReviewedDispositions = {
  applicationTokenBudgets: {
    persistence: "optional-values-retained",
    runtimeEnforcement: "fail-closed-until-PR-07-qualification",
  },
  idempotencyAtomicity: {
    idempotencyLedger: "postgresql-metadata-only",
    rawKeysOrPayloadsStored: false,
    expiredPendingDisposition:
      "reconciliation-required-no-automatic-reexecution",
    receiptFinalizationFailure: "fail-closed-reconciliation-required",
    crossSystemTransaction: false,
    keycloakDurableReconciliation: "deferred-to-PR-06",
  },
  auditProducerAtomicity: {
    pr04Outbox: false,
    followOnWorkPackages: ["PR-05", "PR-06", "PR-07", "PR-09", "PR-10"],
  },
}

export const pr05ReviewedDispositions = {
  humanAuthorization: {
    roles: ["admin", "operator"],
    rankedPersonasRetained: false,
    serverAuthorization: "explicit-capability-default-deny",
    liveRoleResolution: {
      source: "keycloak-current-user-and-realm-role-state",
      cache: "none",
      keycloakUnavailable: "fail-closed",
    },
    webRoleRefresh: "replace-from-current-token-never-merge-stale-authority",
  },
  delegatedKeycloakAdministration: {
    customerAdminClass: "delegated-realm-administrator",
    allowedBuiltInNavigationRoles: ["query-users", "query-groups"],
    forbiddenBypassRoles: [
      "admin",
      "realm-admin",
      "manage-realm",
      "manage-users",
      "manage-clients",
    ],
    nativeOperatorVisibility: "read-only",
    nativeOperatorMutations: "denied",
    operatorMutations: "console-only",
    masterRealmAuthority: false,
    humanAndApplicationClientAdministrationSeparated: true,
  },
  emergencyRecovery: {
    purpose:
      "admin-lockout-recovery-while-keycloak-and-control-plane-are-healthy",
    factorScope: "one-per-appliance",
    factorHolder: "customer-offline",
    plaintextPersistence: false,
    oneTimeDisplay: true,
    eligibleActors: "enabled-operators-with-current-live-operator-role",
    reauthenticationMaximumAgeSeconds: 300,
    mfaProofRequired: true,
    reasonCodes: ["admin_lockout", "admin_role_repair", "admin_mfa_repair"],
    activationAbuseControl: {
      concurrentVerifierCapacity: 1,
      admittedAttemptsPerSubject: 5,
      windowSeconds: 60,
      subjectStateCapacity: 1024,
      implementation: "process-local",
      qualification: {
        workPackage: "PR-12",
        exactBffProcessCount: 1,
        multiReplicaRequires: "postgresql-backed-atomic-counter-and-lease",
      },
    },
    sessionTtlSeconds: 900,
    renewalAllowed: false,
    maximumConcurrentSessions: 1,
    restartSafeExpiry: true,
    explicitRevocation: true,
    automaticExpiry: true,
    grantedAuthority: "console-admin-capabilities",
    persistentKeycloakAdminRole: false,
    nativeExpertAccess: false,
  },
  lastOperatorProtection: {
    console: "deny-disable-delete-or-role-removal-of-last-enabled-operator",
    nativeKeycloak:
      "operators-and-operators-group-not-mutable-by-customer-admin",
    customKeycloakExtension: false,
  },
  auditAndReconciliation: {
    metadataOnly: true,
    freeTextRecoveryReason: false,
    durableIntentBeforeExternalIdentityMutation: true,
    ambiguousCompletion: "reconciliation-required-no-automatic-reexecution",
  },
  identityMutationBounds: {
    maximumUnresolvedMutations: 1,
    cooperativeDeadlineMs: 30_000,
    queueAcquireTimeoutMs: 2_000,
    teamBatchMaxItems: 100,
    csvContractMaxBytes: 240 * 1024,
    csvRouteBodyMaxBytes: 256 * 1024,
  },
  packageBoundaries: {
    pr05: [
      "human-authorization",
      "delegated-keycloak-logical-seed",
      "bootstrap-admin-and-first-operator-commissioning",
      "emergency-recovery",
      "identity-mutation-audit-producer",
    ],
    pr06: [
      "application-oauth-client-lifecycle",
      "application-credential-reconciliation",
    ],
    pr09: ["cross-system-audit-ingestion", "signed-audit-export"],
    pr12: ["deterministic-runtime-packaging-of-keycloak-seed"],
  },
}

export const pr06ReviewedDispositions = {
  applicationLifecycle: {
    states: ["enabled", "disabled", "deleted"],
    authenticationMode: "immutable-after-create",
    environmentQualifiedCredentials: false,
    softDelete: {
      credentialsRevokedImmediately: true,
      identifiersAndAuditLinkageRetained: true,
    },
  },
  credentialLifecycle: {
    supportedInferenceModes: ["api_key", "oauth_client_credentials"],
    defaultInferenceMode: "api_key",
    oneApplicationCredentialNamespacePerApplication: true,
    plaintextPersistence: false,
    oneTimeSecretDisplay: true,
    staticKeyAutomaticExpiry: false,
    oauthClientSecretAutomaticExpiry: false,
    oauthAccessTokenLifetimeSeconds: 300,
  },
  applicationPolicy: {
    stableModelAliasAllowlistRequired: true,
    silentModelSubstitution: false,
    missingOrUnhealthyAlias: "degraded-and-fail-closed",
    requestLimit: "optional-disabled-by-default",
    tokenLimit: "optional-disabled-by-default",
  },
  rotation: {
    staticKeyOverlapSeconds: 86_400,
    retiringStaticKeyImmediateRevoke: true,
    oauthOldClientSecretInvalidation: "immediate",
    issuedOauthAccessTokens: "valid-only-until-short-expiry",
  },
  connectionEvidence: {
    source: "authenticated-real-client-get-models",
    activeProbe: false,
    metadataOnly: true,
    applianceReadinessIsClientConnectionProof: false,
  },
  credentialIsolation: {
    inferenceAndFirecrawlInterchangeable: false,
    inferenceAndLiteLlmNativeKeysInterchangeable: false,
    firecrawlAndLiteLlmNativeKeysInterchangeable: false,
    liteLlmProjection: "redacted-read-only",
  },
  oauthReconciliation: {
    journal: "admin.identity_mutation_journal",
    targetType: "oauth_client",
    durableIntentBeforeKeycloakMutation: true,
    ambiguousCompletion: "reconciliation-required-no-automatic-reexecution",
    parallelApplicationJournal: false,
  },
  authority: {
    adminOnly: ["create", "policy-change", "re-enable", "soft-delete"],
    adminOrOperator: ["disable", "test", "rotate", "revoke"],
  },
  keycloakApplicationAdministration: {
    allowedRealmTopologies: ["dedicated-application-realm"],
    realmTopology: "dedicated-application-realm",
  },
  packageBoundaries: {
    pr06: [
      "application-lifecycle-and-policy",
      "application-oauth-client-lifecycle",
      "application-credential-reconciliation",
    ],
    pr07: [
      "oauth-access-token-validation",
      "runtime-limit-enforcement",
      "inference-data-plane-qualification",
    ],
    pr08: ["firecrawl-credential-lifecycle"],
    pr09: ["cross-system-audit-ingestion", "signed-audit-export"],
  },
}

export const pr07ReviewedDispositions = {
  publicInferenceApi: {
    routes: [
      { method: "GET", path: "/api/app-gateway/v1/models" },
      { method: "POST", path: "/api/app-gateway/v1/chat/completions" },
    ],
    additionalPublicRoutes: false,
    chatCompletionModes: ["non-stream", "stream"],
    toolCalls: "transport-only-never-executed",
  },
  applicationAuthentication: {
    supportedModes: ["api_key", "oauth_client_credentials"],
    realmTopology: "dedicated-application-realm",
    applicationRealm: "llm-machines-applications",
    humanRealmTokensAccepted: false,
    oauthAccessTokenMaximumLifetimeSeconds: 300,
  },
  modelAliasPolicy: {
    stableAliasAllowlistRequired: true,
    missingOrUnhealthyAlias: "degraded-and-fail-closed",
    silentSubstitution: false,
  },
  customerOwnedHardwarePolicy: {
    priorityOrder: [
      "usage-accounting",
      "rate-protection",
      "application-permissions",
      "operational-alerts",
    ],
    usageOrTokenThreshold: "metadata-signal-non-blocking",
    usageAccountingSignals: [
      "requests",
      "failures",
      "input-output-total-tokens",
      "latency",
      "exact-allowed-model-alias",
    ],
    optionalRateProtectionControls: ["requests-per-second", "concurrency"],
    applicationPermissions: ["model-alias-allowlist", "max-context-size"],
    operationalAlertSignals: ["gpu-saturation", "queue-depth", "failures"],
    rateProtectionPurpose:
      "protect-appliance-without-arbitrary-usage-rationing",
    disabledControlBehavior: "no-block",
    firecrawlPermissionOwner: "PR-08",
    metadataSignalOwner: "PR-07",
    alertPresentationAndDeliveryOwner: "PR-09",
  },
  retention: {
    workloadContentPersistence: false,
    promptsPersisted: false,
    completionsPersisted: false,
    streamedChunksPersisted: false,
    toolArgumentsPersisted: false,
    metadataOnly: true,
    runtimeQualificationOwner: "PR-12",
  },
  scopeBoundaries: {
    firecrawl: "excluded-PR-08",
    alertPresentationAndDelivery: "excluded-PR-09",
    runtimeDeploymentAndQualification: "excluded-PR-12",
  },
}

export const pr08ReviewedDispositions = {
  publicCapability: {
    classification: "public-t2-generic-third-party-application",
    routes: [
      { method: "POST", path: "/v2/search" },
      { method: "POST", path: "/v2/scrape" },
    ],
    additionalRoutesOrMethods: false,
    scopes: ["firecrawl.search", "firecrawl.scrape"],
    searchMode: "bounded-search",
    scrapeMode: "bounded-static-scrape",
    inferenceRoutes: "unchanged",
    hermesDependency: false,
  },
  installationAndActivation: {
    applianceProfile: "always-installed",
    perApplicationDefault: "disabled",
    noEnabledApplicationBehavior: "cold-and-egress-sealed",
    uiVisibilityOwner: "PR-11",
    uiVisibleInPr08: false,
  },
  credentialLifecycle: {
    authentication: "dedicated-per-application-static-bearer",
    namespaces: [
      "inference-static-key",
      "application-oauth-client",
      "firecrawl-static-key",
      "litellm-native-key",
    ],
    namespacesInterchangeable: false,
    automaticExpiry: false,
    retiringOverlapSeconds: 86400,
    rotationIndependent: true,
    revocationIndependent: true,
    lastUseMetadataIndependent: true,
  },
  authority: {
    disclaimer: "versioned-outbound-web-processing-acceptance-required",
    adminOnly: ["enable", "re-enable", "accept-disclaimer"],
    adminOrOperator: ["view", "passive-test", "rotate", "revoke", "disable"],
    operatorForbidden: [
      "enable",
      "re-enable",
      "accept-disclaimer",
      "change-litellm-routes",
      "enable-outbound-web",
    ],
    connectionEvidence: "passive-authenticated-real-client-request",
    activeProbe: false,
  },
  egressAndUrlSafety: {
    ownership: "system-managed",
    destinationPolicy:
      "exact-host-egress-allowlist-plus-public-address-validation",
    customerUrlGovernance: false,
    directCloudFirecrawl: false,
    governedPrivateUpstream: "http://firecrawl-api:3002",
    nativePortsPublic: false,
    directWorkloadEgress: false,
    controlledProxyOnly: true,
  },
  retention: {
    workloadContentPersistence: false,
    prohibitedContentClasses: [
      "query-terms",
      "target-urls",
      "final-urls",
      "pages",
      "request-bodies",
      "response-bodies",
      "results",
      "tool-arguments",
      "cookies",
      "screenshots",
      "history",
    ],
    retainedMetadataClasses: [
      "subject",
      "application",
      "credential",
      "action",
      "status",
      "time",
      "rate",
      "concurrency",
      "latency",
      "count",
    ],
    runtimeQualificationOwner: "PR-12",
  },
  sourceProvenance: {
    method: "reviewed-semantic-unit-reconstruction",
    privateCheckpoint: pr08PrivateCheckpoint,
    wholesaleMerge: false,
    wholesaleCherryPick: false,
    pilotAncestryAllowed: false,
    migration0027Allowed: false,
  },
  scopeBoundaries: {
    sourceOnly: true,
    intermediateDeployment: false,
    finalCombinedApplicationUiOwner: "PR-11",
    finalImagesSigningOfflinePacketSbomAndCorrespondingSourceOwner: "PR-12",
    runtimeDeploymentAndQualificationOwner: "PR-12",
  },
}

export const pr09ReviewedDispositions = {
  activityAudit: {
    sources: [
      "console",
      "keycloak",
      "litellm",
      "grafana",
      "alertmanager",
      "firecrawl",
      "lifecycle",
    ],
    nativeIngressSources: ["keycloak", "litellm", "grafana", "alertmanager"],
    ingressMechanism: "product_owned_audited_ingress",
    ingressState: "implemented_pending_runtime_qualification",
    nativeEventIdentity: {
      suppliedBy: "product-owned-native-adapter",
      adapterContract: "source-namespaced-deterministic-uuidv5",
      pr09Validation: "canonical-uuidv5-shape-only",
      namespaceDerivationProvenInPr09: false,
      configuredNativeAdaptersInPr09: 0,
      persistedAs: "audit_events.id",
      idempotencyBoundary: "audit_events-primary-key",
      replay: "idempotent-only-for-identical-canonical-metadata",
      collision: "reject-different-canonical-metadata",
      rawSourceEventIdRetained: false,
      rawSourceEventIdExported: false,
      deduplicateByCorrelationId: false,
    },
    nativeCursor: {
      format: "v1-canonical-utc-watermark-uuidv5-tie-breaker",
      storage: ["cursor_version", "cursor_watermark", "cursor_tie_breaker"],
      order: ["watermark_asc", "tie_breaker_asc"],
      monotonic: true,
      establishedCursorMayClear: false,
      concurrency: "row-lock-compare-and-set",
      attemptOrdering: "older-attempt-cannot-overwrite-newer-attempt",
      batchCursor: "must-match-final-event-watermark-and-id",
    },
    activityAndExportPageCursor: {
      encoding: "base64url-json",
      fields: ["id", "occurredAt"],
      pagination: "deterministic-live-keyset",
      crossPageSnapshot: false,
    },
    timelineOrder: ["occurred_at_desc", "id_desc"],
    exportOrder: ["occurred_at_asc", "id_asc"],
    maxNativeEventsPerRun: 1000,
    nativeIdentifiers: {
      correlationId: "required-canonical-uuid",
      keycloakSubjectId: "nullable-for-system-originated-events",
      opaqueIdentifierPattern: "^[A-Za-z0-9][A-Za-z0-9_:-]*$",
      prohibitedIdentifierPrefixes: [
        "llmm_",
        "bearer",
        "token",
        "secret",
        "password",
        "api-key",
      ],
      providerTokenWholeValuePolicy: {
        disposition: "reject",
        matching: "anchored-whole-value",
        appliesTo: ["keycloakSubjectId", "applicationId", "credentialRecordId"],
        families: "reviewed-provider-token-shape-set",
        valuesRecordedInGovernance: false,
      },
      credentialPrefixPatterns: [
        "^llmm_t4_[0-9a-f]{18}$",
        "^llmm_fc_[0-9a-f]{16}$",
      ],
      credentialIdentifierCardinality: "record-id-or-prefix-never-both",
    },
    nativeActions: {
      keycloak: [
        "keycloak.authentication.failed",
        "keycloak.authentication.succeeded",
        "keycloak.credential.updated",
        "keycloak.role.assigned",
        "keycloak.role.revoked",
        "keycloak.user.created",
        "keycloak.user.deleted",
        "keycloak.user.updated",
      ],
      litellm: [
        "litellm.request.denied",
        "litellm.request.failed",
        "litellm.request.succeeded",
        "litellm.route.created",
        "litellm.route.deleted",
        "litellm.route.updated",
        "litellm.virtual_key.created",
        "litellm.virtual_key.revoked",
        "litellm.virtual_key.rotated",
        "litellm.virtual_key.updated",
      ],
      grafana: [
        "grafana.alert_rule.created",
        "grafana.alert_rule.deleted",
        "grafana.alert_rule.updated",
        "grafana.dashboard.created",
        "grafana.dashboard.deleted",
        "grafana.dashboard.updated",
        "grafana.datasource.updated",
        "grafana.folder.created",
        "grafana.folder.deleted",
        "grafana.folder.updated",
      ],
      alertmanager: [
        "alertmanager.configuration.reloaded",
        "alertmanager.notification.failed",
        "alertmanager.notification.succeeded",
        "alertmanager.silence.created",
        "alertmanager.silence.deleted",
        "alertmanager.silence.expired",
      ],
    },
    nativeRecoveryReasonCodes: {
      keycloak: [
        "account_disabled",
        "authentication_failed",
        "authorization_denied",
        "invalid_credentials",
        "policy_rejected",
      ],
      litellm: [
        "model_denied",
        "rate_limited",
        "request_failed",
        "route_unavailable",
      ],
      grafana: ["operation_failed", "permission_denied", "validation_failed"],
      alertmanager: [
        "delivery_failed",
        "receiver_unavailable",
        "silence_rejected",
      ],
    },
    allowedMetadataFields: [
      "id",
      "occurredAt",
      "ingestedAt",
      "action",
      "outcome",
      "sourceSystem",
      "correlationId",
      "keycloakSubjectId",
      "applicationId",
      "credentialRecordId",
      "credentialPrefix",
      "recoveryReasonCode",
    ],
    compatibilityTargetProjection: {
      persistence: false,
      export: false,
      mode: "derived-read-only",
      fields: ["targetType", "targetId"],
      derivedOnlyFrom: [
        "keycloakSubjectId",
        "applicationId",
        "credentialRecordId",
        "credentialPrefix",
        "correlationId",
      ],
    },
    prohibitedContentFields: [
      "prompt",
      "response",
      "completion",
      "requestBody",
      "responseBody",
      "headers",
      "toolArguments",
      "toolResults",
      "searchTerms",
      "url",
      "pageContent",
    ],
    authorization: {
      admin: ["view", "filter", "signed-export"],
      operator: ["view", "filter"],
      operatorExport: false,
    },
    retentionDays: 365,
  },
  auditExport: {
    formats: ["json", "csv"],
    envelope: "compact-jws",
    algorithm: "Ed25519",
    deterministicPayloadBytes: true,
    maximumEventsPerPage: 5000,
    maximumPayloadBytes: 8388608,
    maximumRangeDays: 365,
    pagination: "deterministic-live-keyset",
    cursorEncoding: "base64url-json-id-occurredAt",
    crossPageSnapshot: false,
    privateKeySource: "mounted-file-only",
    publicVerificationKeySource: "mounted-jwks-file",
    privateKeyInGit: false,
    privateKeyInEnvironment: false,
    missingOrInvalidMaterial: "signed-export-surface-only-http-503",
    unaffectedSurfaces: ["inference", "audit-ingestion", "audit-view"],
  },
  expertAccess: {
    systems: ["keycloak", "litellm", "grafana", "alertmanager"],
    auditIngestion: "implemented_pending_runtime_qualification",
    mechanism: "product_owned_audited_ingress",
    consoleProjection: "read_only",
    directAccess: "disabled",
    nativeMutation: "disabled",
    enablementOwner: "PR-12",
    noBypassProofRequired: true,
  },
  grafanaOss: {
    adminRole: "Editor",
    operatorRole: "Viewer",
    retainedRoleCardinality: "exactly-one",
    ambiguousRetainedRoles: "deny",
    baseline: "provisioned-locked",
    customerFolder: "unprovisioned-customer-editable",
    customerFolderAdminPermission: "Edit",
    customerFolderOperatorPermission: "View",
    strictFolderConfinementClaim: false,
    runtimeActivationOwner: "PR-12",
  },
  observability: {
    metricsEndpoint: {
      method: "GET",
      path: "/internal/observability/metrics",
      exposure: "private-authenticated",
      authentication: "mounted-private-file-bearer",
      queryAllowed: false,
      additionalExporterService: false,
    },
    prometheusQueryApi: {
      authentication: "mounted-private-file-bearer",
      runtimeEnvironmentCredentialAllowed: false,
    },
    accountingMetrics: [
      "llm_machines_inference_requests_5m",
      "llm_machines_inference_failures_5m",
      "llm_machines_inference_server_failures_5m",
      "llm_machines_inference_in_flight_requests",
      "llm_machines_inference_retained_requests",
      "llm_machines_inference_retained_failures",
      "llm_machines_inference_retained_input_tokens",
      "llm_machines_inference_retained_output_tokens",
      "llm_machines_inference_retained_total_tokens",
      "llm_machines_inference_retained_latency_milliseconds_sum",
      "llm_machines_inference_retained_latency_milliseconds_max",
    ],
    queueDepth: {
      stateMetric:
        'llm_machines_inference_queue_depth_source_info{status="not_configured"}',
      valueMetric: "llm_machines_inference_queue_depth",
      valueEmittedInPr09: false,
      concurrencyOrInFlightIsSubstitute: false,
      genuineSignalOwner: "PR-12",
    },
    alerts: [
      "LLMMGpuSaturation",
      "LLMMInferenceFailureRatioHigh",
      "LLMMInferenceQueueDepthPersisting",
      "LLMMInferenceQueueDepthSignalMissing",
    ],
    localDefaultReceiver: "local-null",
    llmMachinesCloudRelay: false,
  },
  alertEgress: {
    pr09Scope: "redacted-transport-intent-and-warning-acknowledgement-only",
    transports: ["disabled", "smtp", "webhook"],
    warningVersion: "alert-egress-v1",
    mutationAuthority: "admin-only-no-breakglass-operator",
    operatorRead: true,
    deliveryStates: ["disabled", "prepared_pending_runtime_qualification"],
    persistedDestination: false,
    persistedEmailOrUrl: false,
    persistedSecret: false,
    runtimeDelivery: false,
    defaultState: "disabled",
    dedicatedUpdaterFields: [
      "alert_egress_revision",
      "alert_egress_updated_at",
      "alert_egress_updated_by",
      "alert_egress_acknowledged_at",
      "alert_egress_acknowledged_by",
      "alert_egress_warning_version",
    ],
    stateAuditReceiptAtomicity: "single-postgresql-transaction",
    receiptFinalization: "same-transaction",
    receiptFailureRollsBackStateAndAudit: true,
    customerDestinationAndSecretInjectionOwner: "PR-12",
    nativeReloadDeliveryAndNoBypassQualificationOwner: "PR-12",
  },
  retention: {
    workloadContentDays: 0,
    auditMetadataDays: 365,
    applicationAndUsageMetadataDays: 90,
    metricsAndAlertStateDays: 30,
    alertmanagerNotificationAndSilenceHours: 720,
    runtimeQualificationOwner: "PR-12",
  },
  scopeBoundaries: {
    sourceOnly: true,
    intermediateDeployment: false,
    finalNavigationOwner: "PR-11",
    nativeLinksMountedSecretsRuntimeAndNoBypassOwner: "PR-12",
  },
}

export const pr10LifecycleComponents = [
  "console_database",
  "keycloak",
  "litellm",
  "grafana",
]

export const pr10LifecycleOperationStates = [
  "prepared",
  "quiescing",
  "capturing",
  "validating",
  "restoring",
  "verifying",
  "resuming",
  "rolling_back",
  "succeeded",
  "rolled_back",
  "failed",
  "recovery_required",
]

export const pr10LifecycleFailureCodes = [
  "adapter_unavailable",
  "quiesce_failed",
  "capture_failed",
  "manifest_invalid",
  "consistency_mismatch",
  "restore_failed",
  "verification_failed",
  "rollback_failed",
  "resume_failed",
  "journal_failed",
]

export const pr10Pr06FixtureRepair = {
  path: "test-support/inference-core-db-tests/src/pr06-application-credential-reconciliation.test.ts",
  classification: "test-only-fixed-expiry-repair",
  baseSha256:
    "22dc477125f09de476d1da13126c1868b31117c0ef87687ebd7000892e2dc09e",
  removedFragment: "'pr06-correlation',\n        '2026-08-01T12:00:00Z'",
  replacementFragment: "'pr06-correlation',\n        now() + interval '1 day'",
  productBehaviorChanged: false,
}

export const pr10ReviewedDispositions = {
  lifecycleFoundation: {
    components: pr10LifecycleComponents,
    componentOrdinals: {
      console_database: 0,
      keycloak: 1,
      litellm: 2,
      grafana: 3,
    },
    consistencyModel: "coordinated-quiescence-not-cross-service-acid",
    operationKinds: ["snapshot", "restore"],
    operationStates: pr10LifecycleOperationStates,
    failureCodes: pr10LifecycleFailureCodes,
    oneUnresolvedOperation: true,
    recoveryRequiredBlocksNewWork: true,
    orderedJournalEvents: true,
    rawErrorTextPersisted: false,
  },
  snapshotManifest: {
    schemaVersion: 1,
    canonicalEncoding: "deterministic-json",
    fixedComponentOrder: pr10LifecycleComponents,
    componentFields: ["component", "ordinal", "revision", "artifactSha256"],
    manifestFields: [
      "schemaVersion",
      "snapshotId",
      "operationId",
      "capturedAt",
      "contentFree",
      "workloadContentIncluded",
      "plaintextSecretsIncluded",
      "emergencySessionsIncluded",
      "components",
      "manifestSha256",
    ],
    contentFree: true,
    workloadContentIncluded: false,
    plaintextSecretsIncluded: false,
    emergencySessionsIncluded: false,
    artifactBytesPersistedByFoundation: false,
    runtimeArtifactComplianceProven: false,
  },
  restoreSafety: {
    validateManifestBeforeOperationAdmission: true,
    prepareEveryComponentBeforeActiveRestore: true,
    preparationMutatesActiveState: false,
    rollbackCapabilityRequiredBeforeActiveRestore: true,
    restoreOrder: pr10LifecycleComponents,
    rollbackOrder: [...pr10LifecycleComponents].reverse(),
    preparationDiscardOrder: "reverse",
    uncertainResumeAttemptState: "possibly-live",
    reQuiescePossiblyLiveComponentsBeforeRollback: true,
    activationFence: {
      acquisition: "before-first-active-restore",
      hold: "through-active-restore-verification-and-safe-resume-or-compensation",
      close: "only-after-safe-resume-or-compensation",
      reopenBeforeRollbackAfterClose: true,
      resetImmediatelyAfterReopen: true,
      reopenOrResetFailure: "recovery_required-with-fence-held-when-acquired",
    },
    zeroEmergencySessionsBeforeActiveRestore: true,
    zeroEmergencySessionsAfterRestoreOrCompensation: true,
    inconsistentCredentialState: "fail-closed-and-rollback",
    rollingBackAdmissionFailure:
      "recovery_required-preserve-quiescence-and-held-fence",
    rollbackFailureState: "recovery_required",
  },
  zeroContentRetention: {
    workloadContentDays: 0,
    allowedPersistentClasses: [
      "operation-identifiers",
      "actor-subject-identifier",
      "correlation-identifier",
      "bounded-operation-state",
      "bounded-phase-outcome",
      "bounded-failure-code",
      "timestamps",
      "component-identifier",
      "opaque-component-revision",
      "sha256-digests",
    ],
    prohibitedPersistentClasses: [
      "prompt",
      "response",
      "completion",
      "request-body",
      "response-body",
      "headers",
      "tool-arguments",
      "tool-results",
      "search-terms",
      "url",
      "page-content",
      "artifact-bytes",
      "raw-error",
      "stack-trace",
      "plaintext-secret",
      "emergency-session",
    ],
    runtimeQualificationOwner: "PR-12",
  },
  deferredBindings: {
    configuredRuntimeAdapters: 0,
    componentEndpointsConfigured: false,
    componentCredentialsConfigured: false,
    componentPathsConfigured: false,
    backupDestinationConfigured: false,
    backupEncryptionKeyConfigured: false,
    signingKeyConfigured: false,
    schedulerConfigured: false,
    lifecycleRoutesRegistered: 0,
    signingTrustAndCustodyOwner: "PR-10A",
    backupDestinationEncryptionRetentionAndRecoveryOwner: "PR-10B",
    productionBindingsDeploymentAndQualificationOwner: "PR-12",
  },
  historicalTestRepair: pr10Pr06FixtureRepair,
  scopeBoundaries: {
    sourceOnly: true,
    intermediateDeployment: false,
    runtimeQualified: false,
    configuredRuntimeAdapters: 0,
    lifecycleRoutes: 0,
  },
}

export const pr10StandaloneDbTestBoundary = {
  ...pr09StandaloneDbTestBoundary,
  allowedPaths: [
    ...pr09StandaloneDbTestBoundary.allowedPaths,
    "test-support/inference-core-db-tests/src/pr10-lifecycle-foundation.test.ts",
    "test-support/inference-core-db-tests/src/pr10-lifecycle-journal.test.ts",
  ].sort(),
}

export const pr10LifecycleCodePaths = [
  "apps/bff/src/db/inference-core-client.test.ts",
  "apps/bff/src/db/inference-core-client.ts",
  "apps/bff/src/db/inference-core-schema.test.ts",
  "apps/bff/src/db/inference-core-schema.ts",
  "apps/bff/src/services/lifecycle-component-adapters.test.ts",
  "apps/bff/src/services/lifecycle-component-adapters.ts",
  "apps/bff/src/services/lifecycle-operation-journal.test.ts",
  "apps/bff/src/services/lifecycle-operation-journal.ts",
  "apps/bff/src/services/lifecycle-orchestration.test.ts",
  "apps/bff/src/services/lifecycle-orchestration.ts",
  "apps/bff/src/services/lifecycle-snapshot-manifest.test.ts",
  "apps/bff/src/services/lifecycle-snapshot-manifest.ts",
  "infra/migrations/0000_inference_core.sql",
  "packages/contracts/src/index.ts",
  "packages/contracts/src/inference-core-lifecycle.test.ts",
  "packages/contracts/src/inference-core-lifecycle.ts",
  "test-support/inference-core-db-tests/src/inference-core-migration.test.ts",
  pr10Pr06FixtureRepair.path,
  "test-support/inference-core-db-tests/src/pr10-lifecycle-foundation.test.ts",
  "test-support/inference-core-db-tests/src/pr10-lifecycle-journal.test.ts",
].sort()

export const pr10GovernancePaths = [
  pr10DecisionPath,
  "package.json",
  "scripts/inference-core/guardrails.mjs",
  "scripts/inference-core/guardrails.test.mjs",
  "scripts/inference-core/pr10-boundaries.test.mjs",
  "scripts/inference-core/pr10-contract-revision.mjs",
].sort()

export const pr10AllowedRepositoryPaths = [
  ...pr10LifecycleCodePaths,
  ...pr10GovernancePaths,
].sort()

export const pr10RequiredFrozenRepositoryPaths = [...pr10AllowedRepositoryPaths]

export const pr10ExpectedOperationPolicy = {
  addedSourcePaths: [
    "apps/bff/src/services/lifecycle-component-adapters.ts",
    "apps/bff/src/services/lifecycle-operation-journal.ts",
    "apps/bff/src/services/lifecycle-orchestration.ts",
    "apps/bff/src/services/lifecycle-snapshot-manifest.ts",
    "packages/contracts/src/inference-core-lifecycle.ts",
  ].sort(),
  changedSourcePaths: [
    "apps/bff/src/db/inference-core-client.ts",
    "apps/bff/src/db/inference-core-schema.ts",
    "package.json",
    "packages/contracts/src/index.ts",
  ].sort(),
  deletedSourcePaths: [],
  addedRepositoryPaths: [
    "apps/bff/src/services/lifecycle-component-adapters.test.ts",
    "apps/bff/src/services/lifecycle-component-adapters.ts",
    "apps/bff/src/services/lifecycle-operation-journal.test.ts",
    "apps/bff/src/services/lifecycle-operation-journal.ts",
    "apps/bff/src/services/lifecycle-orchestration.test.ts",
    "apps/bff/src/services/lifecycle-orchestration.ts",
    "apps/bff/src/services/lifecycle-snapshot-manifest.test.ts",
    "apps/bff/src/services/lifecycle-snapshot-manifest.ts",
    pr10DecisionPath,
    "packages/contracts/src/inference-core-lifecycle.test.ts",
    "packages/contracts/src/inference-core-lifecycle.ts",
    "scripts/inference-core/pr10-boundaries.test.mjs",
    "scripts/inference-core/pr10-contract-revision.mjs",
    "test-support/inference-core-db-tests/src/pr10-lifecycle-foundation.test.ts",
    "test-support/inference-core-db-tests/src/pr10-lifecycle-journal.test.ts",
  ].sort(),
  changedRepositoryPaths: [
    "apps/bff/src/db/inference-core-client.test.ts",
    "apps/bff/src/db/inference-core-client.ts",
    "apps/bff/src/db/inference-core-schema.test.ts",
    "apps/bff/src/db/inference-core-schema.ts",
    "infra/migrations/0000_inference_core.sql",
    "package.json",
    "packages/contracts/src/index.ts",
    "scripts/inference-core/guardrails.mjs",
    "scripts/inference-core/guardrails.test.mjs",
    "test-support/inference-core-db-tests/src/inference-core-migration.test.ts",
    pr10Pr06FixtureRepair.path,
  ].sort(),
  deletedRepositoryPaths: [],
}

export const pr10ProductionSourcePaths = [
  ...pr10ExpectedOperationPolicy.addedSourcePaths,
  ...pr10ExpectedOperationPolicy.changedSourcePaths,
].sort()

export const pr10GeneratedDestinationPaths = [
  allowlistPath,
  routeBaselinePath,
  pr10ContractRevisionPath,
].sort()

export const pr10SourceEvidencePaths = [
  "apps/bff/src/services/lifecycle-component-adapters.ts",
  "apps/bff/src/services/lifecycle-operation-journal.ts",
  "apps/bff/src/services/lifecycle-orchestration.ts",
  "apps/bff/src/services/lifecycle-snapshot-manifest.ts",
  "packages/contracts/src/inference-core-lifecycle.ts",
]

export const pr10cIsolationStates = [
  "inactive",
  "engaging",
  "active",
  "disengaging",
  "recovery_required",
]

export const pr10cIsolationFailureCodes = [
  "state_invalid",
  "admission_fence_failed",
  "inflight_abort_failed",
  "enforcement_failed",
  "verification_failed",
  "restore_reassertion_failed",
  "journal_failed",
]

export const pr10cAddedRouteContract = [
  {
    surface: "bff",
    method: "GET",
    path: "/api/admin/isolation",
    source: "apps/bff/src/routes/admin.ts",
    classification: "current-console-seam",
  },
  {
    surface: "bff",
    method: "POST",
    path: "/api/admin/isolation/activate",
    source: "apps/bff/src/routes/admin.ts",
    classification: "current-console-seam",
  },
  {
    surface: "bff",
    method: "POST",
    path: "/api/admin/isolation/deactivate",
    source: "apps/bff/src/routes/admin.ts",
    classification: "current-console-seam",
  },
]

export const pr10cRouteFingerprintTransitions = [
  {
    path: "apps/bff/src/index.ts",
    symbol: "<file>",
    beforeSha256:
      "34861ad68b99b3ff2eb927daa76b8b9157a62e5841365e456c4335a168c34293",
    afterSha256:
      "32509b161073d225b6aef9e3993c778d997773073a14be5318b6d33e78ed093d",
  },
]

export const pr10cMutationAdminOnlyRoutePolicyKeys = [
  "POST /api/admin/isolation/activate",
  "POST /api/admin/isolation/deactivate",
]

export const pr10cAdminOnlyRoutePolicyKeys = [
  ...pr10cMutationAdminOnlyRoutePolicyKeys,
  "GET /api/admin/recovery/status",
  "POST /api/admin/observability/alert-egress",
  "POST /api/admin/recovery/factor/commission",
  "POST /api/admin/settings/organization",
  "POST /api/admin/settings/telemetry",
].sort()

export const pr10cReviewedDispositions = {
  historicalTestRepairs: {
    paths: pr10cSuccessorAwareHistoricalTestPaths,
    retainedRevisionBindings: pr10cSuccessorAwareHistoricalTestBindings,
  },
  isolationState: {
    scope: "global-singleton",
    states: pr10cIsolationStates,
    effectiveTrafficStates: ["open", "sealed"],
    failureCodes: pr10cIsolationFailureCodes,
    nonInactiveStateFailsClosed: true,
    optimisticRevisionRequired: true,
    activationConfirmation: "ACTIVATE EMERGENCY ISOLATION",
    deactivationConfirmation: "DEACTIVATE EMERGENCY ISOLATION",
    stateAuditAndIdempotencyAtomicity: "single-postgresql-transaction",
    rawErrorTextPersisted: false,
  },
  routeAuthorization: {
    status: {
      method: "GET",
      path: "/api/admin/isolation",
      capability: "console.operational.view",
      allowedRoles: ["Admin", "Operator"],
    },
    mutations: [
      {
        method: "POST",
        path: "/api/admin/isolation/activate",
        standingRole: "Admin",
        emergencyElevatedOperatorAllowed: false,
      },
      {
        method: "POST",
        path: "/api/admin/isolation/deactivate",
        standingRole: "Admin",
        emergencyElevatedOperatorAllowed: false,
      },
    ],
    mutationReauthentication: {
      maxAuthenticationAgeSeconds: 300,
      acceptedMfaMethods: ["otp", "hwk", "webauthn", "webauthn-passwordless"],
    },
  },
  trafficEnforcement: {
    publicInferenceRoutesUnchanged: true,
    publicFirecrawlRoutesUnchanged: true,
    blocksNewInferenceAdmissions: true,
    blocksNewFirecrawlAdmissions: true,
    inProcessAbortSignalPropagation: true,
    activationWaitsForInflightAbortAndZeroLocalLeases: true,
    terminalFinalizationReservation: true,
    successAccountingAndResponseShareFinalizationLane: true,
    engagementWaitsForFinalizingResponseRelease: true,
    isolationFirstSettlesFailureExactlyOnce: true,
    deactivationCommitReservation: true,
    admissionsCannotInvalidatePreparedDeactivation: true,
    localOpenOccursOnlyAfterDurableInactiveCommit: true,
    adminHealthAndMetricsRemainReachable: true,
    bulkApplicationDisableUsed: false,
    liveTopologyFirewallAndNoBypassQualificationOwner: "PR-12",
    liveInflightDrainAndAbortQualificationOwner: "PR-12",
  },
  restoreSafety: {
    restoreMayClearIsolation: false,
    isolationFenceHeldAcrossRestoreAndCompensation: true,
    fenceAcquisitionPersistsAndReadsBackRecoveryRequiredBeforeAnyActiveRestore: true,
    nonRestorableAuthorityRequired: true,
    unboundOrUnavailableAuthorityFailsClosed: true,
    operationScopedMarkerCompareAndSet: true,
    startupReconcilesMarkerBeforeInactiveCanOpen: true,
    markerAcquisitionFailureAttemptsConsoleRecoveryBeforeReject: true,
    mutationsBlockedUntilMarkerClearLinearization: true,
    markerClearRequiresConsoleRecoveryReadback: true,
    unfencedJournalAdmissionSealsUntilReconciled: true,
    preparedUnfencedRestoreCasToRecoveryRequiredBeforeValidation: true,
    survivingMarkerClearRequiresMatchingTerminalRestore: true,
    unresolvedOrUnknownMarkerOwnerNeverClearedAtBootstrap: true,
    lifecycleReconciliationLockedAndIdempotent: true,
    postAdmissionOrdering: [
      "journal.begin-created",
      "durable-recovery-required-fence-acquired-and-read-back",
      "prepareRestore-validation",
      "quiesce",
    ],
    fenceOrderingExemption: "pre-admission-manifest-rejection-only",
    durableIsolationReassertedBeforeAdmissionReopens: true,
    reassertionFailureState: "recovery_required",
    everyAdmittedRestoreEndsDurableRecoveryRequired: true,
    recoveryRequiredReassertedAfterEveryAppliedOrPartialRestoreFailureBeforeReturnOrResume: true,
  },
  zeroContentRetention: {
    workloadContentDays: 0,
    requestOrResponseContentPersisted: false,
    rawErrorTextPersisted: false,
    runtimeQualificationOwner: "PR-12",
  },
  deferredWork: {
    liveTopologyQualificationOwner: "PR-12",
    firewallEnforcementQualificationOwner: "PR-12",
    inflightDrainAndAbortQualificationOwner: "PR-12",
    nonRestorableAuthorityBackendAndQualificationOwner: "PR-12",
    productionDeploymentOwner: "PR-12",
    vendorMaintenanceAccessOwner: "PR-10D",
  },
  scopeBoundaries: {
    sourceOnly: true,
    intermediateDeployment: false,
    runtimeQualified: false,
    isolationRoutes: 3,
    productionFirewallBindings: 0,
  },
}

export const pr10cGovernancePaths = [
  pr10cDecisionPath,
  "docs/reduction/inference-core/README.md",
  "package.json",
  ...pr10cSuccessorAwareHistoricalTestPaths,
  "scripts/inference-core/guardrails.mjs",
  "scripts/inference-core/guardrails.test.mjs",
  "scripts/inference-core/pr10c-boundaries.test.mjs",
  "scripts/inference-core/pr10c-contract-revision.mjs",
].sort()

export const pr10cRequiredFrozenRepositoryPaths = [...pr10cGovernancePaths]

export const pr10cAllowedRepositoryPathPatterns = [
  /^apps\/bff\/src\/auth\/authorization(?:-security|\.test)?\.ts$/,
  /^apps\/bff\/src\/db\/inference-core-(?:client|schema)(?:\.test)?\.ts$/,
  /^apps\/bff\/src\/index(?:\.test)?\.ts$/,
  /^apps\/bff\/src\/routes\/(?:admin|app-gateway|firecrawl-gateway)(?:-[a-z0-9-]+)?(?:\.test)?\.ts$/,
  /^apps\/bff\/src\/routes\/inference-core-characterization\.test\.ts$/,
  /^apps\/bff\/src\/services\/(?:admin-connected-apps|admin-connected-apps-firecrawl|emergency-isolation|idempotency|identity-mutation-journal|isolation-traffic-gate|lifecycle-operation-journal|lifecycle-orchestration|litellm-chat-transport)(?:\.test)?\.ts$/,
  /^docs\/reduction\/inference-core\/(?:README\.md|pr-10c-emergency-isolation-decisions\.json)$/,
  /^infra\/migrations\/0000_inference_core\.sql$/,
  /^package\.json$/,
  /^packages\/contracts\/src\/(?:index|inference-core|inference-core-authorization|inference-core-isolation)(?:\.test)?\.ts$/,
  /^scripts\/inference-core\/(?:pr05|pr06|pr10)-boundaries\.test\.mjs$/,
  /^scripts\/inference-core\/(?:guardrails(?:\.test)?|pr10c-(?:boundaries\.test|contract-revision))\.mjs$/,
  /^test-support\/inference-core-db-tests\/src\/(?:inference-core-migration|inference-core-retention|pr10-lifecycle-journal|pr10c-emergency-isolation)(?:\.test)?\.ts$/,
]

export const pr10cGeneratedDestinationPaths = [
  allowlistPath,
  routeBaselinePath,
  pr10cContractRevisionPath,
].sort()

export const pr10cSourceEvidencePaths = [
  "apps/bff/src/db/inference-core-client.ts",
  "apps/bff/src/db/inference-core-schema.ts",
  "apps/bff/src/index.ts",
  "apps/bff/src/routes/admin.ts",
  "apps/bff/src/routes/app-gateway.ts",
  "apps/bff/src/routes/firecrawl-gateway.ts",
  "apps/bff/src/services/admin-connected-apps-firecrawl.ts",
  "apps/bff/src/services/admin-connected-apps.ts",
  "apps/bff/src/services/emergency-isolation.ts",
  "apps/bff/src/services/identity-mutation-journal.ts",
  "apps/bff/src/services/isolation-traffic-gate.ts",
  "apps/bff/src/services/lifecycle-operation-journal.ts",
  "apps/bff/src/services/lifecycle-orchestration.ts",
  "apps/bff/src/services/litellm-chat-transport.ts",
  "infra/migrations/0000_inference_core.sql",
  "packages/contracts/src/index.ts",
  "packages/contracts/src/inference-core.ts",
  "packages/contracts/src/inference-core-isolation.ts",
  ...pr10cSuccessorAwareHistoricalTestPaths,
]

export const pr11LogicalSurfaceContract = [
  { id: "overview", label: "Overview", href: "/" },
  { id: "applications", label: "Applications", href: "/applications" },
  { id: "inference", label: "Inference", href: "/inference" },
  { id: "hardware", label: "Hardware", href: "/hardware" },
  { id: "team", label: "Team", href: "/team" },
  {
    id: "activity-audit",
    label: "Activity & Audit",
    href: "/activity",
  },
  { id: "settings", label: "Settings", href: "/settings" },
]

export const pr11RemovedRouteContract = [
  {
    surface: "bff",
    method: "POST",
    path: "/api/admin/inference/model-updates/apply",
    source: "apps/bff/src/routes/admin.ts",
    classification: "current-console-seam",
  },
]

export const pr11RouteFingerprintTransitions = [
  {
    path: "apps/web/next.config.ts",
    symbol: "<file>",
    beforeSha256:
      "58f841f6ee4170e90c110e33727d85dabe6a2c096784b05940319d770a958f8b",
    afterSha256:
      "79a28582d628e566baa4231d4a718173cf4e9dde14242bc40e214d502262dbb3",
  },
]

export const pr11ExpertPreviewContract = [
  {
    service: "grafana",
    consoleMode: "reduced-preview",
    nativeAccessAffordance: "disabled",
    liveUrlAvailable: false,
  },
  {
    service: "litellm",
    consoleMode: "reduced-preview",
    nativeAccessAffordance: "disabled",
    liveUrlAvailable: false,
  },
  {
    service: "keycloak",
    consoleMode: "reduced-preview",
    nativeAccessAffordance: "disabled",
    liveUrlAvailable: false,
  },
]

export const pr11ConsoleHrefManifest = [
  {
    path: "apps/web/src/components/console-v2/activity-v2-experience.tsx",
    expression:
      "expression:activityHref(basePath, filters, { cursor: activity.nextCursor, eventId: null, })",
  },
  {
    path: "apps/web/src/components/console-v2/activity-v2-experience.tsx",
    expression:
      "expression:activityHref(basePath, filters, { cursor: null, eventId: event.id, })",
  },
  {
    path: "apps/web/src/components/console-v2/activity-v2-experience.tsx",
    expression: "expression:activityHref(basePath, filters, { eventId: null })",
  },
  {
    path: "apps/web/src/components/console-v2/activity-v2-experience.tsx",
    expression: "expression:basePath",
  },
  {
    path: "apps/web/src/components/console-v2/activity-v2-experience.tsx",
    expression: "literal:/api/admin/audit/export/verification-keys",
  },
  {
    path: "apps/web/src/components/console-v2/applications-v2-experience.tsx",
    expression: "expression:`/applications/apps/${encodeURIComponent(app.id)}`",
  },
  {
    path: "apps/web/src/components/console-v2/applications-v2-experience.tsx",
    expression: "expression:`/applications/apps/${encodeURIComponent(app.id)}`",
  },
  {
    path: "apps/web/src/components/console-v2/applications-v2-experience.tsx",
    expression: "literal:/applications",
  },
  {
    path: "apps/web/src/components/console-v2/applications-v2-experience.tsx",
    expression: "literal:/applications",
  },
  {
    path: "apps/web/src/components/console-v2/applications-v2-experience.tsx",
    expression: "literal:/applications/apps/new",
  },
  {
    path: "apps/web/src/components/console-v2/console-v2-shell.tsx",
    expression: "expression:href",
  },
  {
    path: "apps/web/src/components/console-v2/console-v2-shell.tsx",
    expression: "expression:section.href",
  },
  {
    path: "apps/web/src/components/console-v2/hardware-v2-experience.tsx",
    expression: "expression:hardwareHref(basePath, option.value)",
  },
  {
    path: "apps/web/src/components/console-v2/inference-v2-experience.tsx",
    expression: "expression:inferenceHref(basePath, option.value)",
  },
  {
    path: "apps/web/src/components/console-v2/overview-v2-experience.tsx",
    expression: "expression:event.href",
  },
  {
    path: "apps/web/src/components/console-v2/overview-v2-experience.tsx",
    expression: "expression:tile.href",
  },
  {
    path: "apps/web/src/components/console-v2/overview-v2-experience.tsx",
    expression: "literal:/activity",
  },
  {
    path: "apps/web/src/components/console-v2/team-v2-experience.tsx",
    expression: "expression:`/team/groups/${group.id}`",
  },
  {
    path: "apps/web/src/components/console-v2/team-v2-experience.tsx",
    expression: "expression:`/team/members/${member.id}`",
  },
  {
    path: "apps/web/src/components/console-v2/team-v2-experience.tsx",
    expression: "expression:`/team/members/${member.id}`",
  },
  {
    path: "apps/web/src/components/console-v2/team-v2-experience.tsx",
    expression: "expression:`/team/members/${state.memberId}`",
  },
  {
    path: "apps/web/src/components/console-v2/team-v2-experience.tsx",
    expression: "expression:href",
  },
  {
    path: "apps/web/src/components/console-v2/team-v2-experience.tsx",
    expression: "literal:/team",
  },
  {
    path: "apps/web/src/components/console-v2/team-v2-experience.tsx",
    expression: "literal:/team/groups/new",
  },
  {
    path: "apps/web/src/components/console-v2/team-v2-experience.tsx",
    expression: "literal:/team/import",
  },
  {
    path: "apps/web/src/components/console-v2/team-v2-experience.tsx",
    expression: "literal:/team/import/template",
  },
  {
    path: "apps/web/src/components/console-v2/team-v2-experience.tsx",
    expression: "literal:/team/members",
  },
  {
    path: "apps/web/src/components/console-v2/team-v2-experience.tsx",
    expression: "literal:/team/members/new",
  },
  {
    path: "apps/web/src/components/console-v2/team-v2-experience.tsx",
    expression: "literal:/team/members/new",
  },
]

export const pr11RetiredEnvExampleBlock = [
  "",
  "# Signed model-update metadata",
  "INFERENCE_MODEL_UPDATE_STATUS=not_configured",
  "INFERENCE_MODEL_UPDATE_CURRENT_VERSION=",
  "INFERENCE_MODEL_UPDATE_AVAILABLE_VERSION=",
  "INFERENCE_MODEL_UPDATE_DETAIL=",
  "INFERENCE_MODEL_UPDATE_ESTIMATED_DOWNTIME=",
  "INFERENCE_MODEL_UPDATE_RELEASE_NOTES=",
  "INFERENCE_MODEL_UPDATE_AFFECTED_MODELS=",
  "INFERENCE_MODEL_UPDATE_ACTION_ENABLED=false",
  "INFERENCE_MODEL_UPDATE_APPLY_RESULT=",
  "",
].join("\n")

export const pr11ReviewedDispositions = {
  historicalRegisterTransitions: {
    paths: pr11SuccessorHistoricalEvidencePaths,
    retainedRevisionBindings: pr11SuccessorHistoricalEvidenceBindings,
  },
  environmentTemplateCleanup: {
    path: ".env.example",
    allowedTransition: "delete-exact-retired-model-update-block-only",
    addedLines: 0,
    otherEnvironmentPaths: 0,
  },
  informationArchitecture: {
    logicalSurfaces: pr11LogicalSurfaceContract,
    rootPath: "/",
    rootSurface: "overview",
    activityAuditPath: "/activity",
    exactOrderRequired: true,
    additionalProductNavigationEntries: 0,
  },
  applications: {
    combinedConsoleSurface: true,
    capabilities: ["inference", "firecrawl"],
    credentialNamespaces: ["inference", "firecrawl"],
    credentialsRemainSeparate: true,
    firecrawlDefaultEnabled: false,
  },
  routeTransition: {
    removedRoutes: pr11RemovedRouteContract,
    addedRoutes: [],
    reclassifiedRoutes: [],
    fastifyRegistrarChanges: 0,
    resolverFingerprintTransitions: pr11RouteFingerprintTransitions,
  },
  settingsMutations: {
    productionPersistence: "postgresql-required",
    fixtureMemoryOnly: true,
    atomicSettingsReceiptAudit: true,
    sharedTransactionAuditWriter: true,
    unavailableWithoutPersistence: true,
    freshDatabaseTelemetryPreviewDefault: "schema-valid",
    productionTelemetryPreviewParsing: "strict-no-fallback",
  },
  webContentSecurityPolicy: {
    perRequestScriptNonce: true,
    requestResponsePolicyMatch: true,
    productionUnsafeInlineScript: false,
    productionUnsafeEval: false,
  },
  expertServices: {
    previews: pr11ExpertPreviewContract,
    nativeLinksEnabled: false,
    nativeUrlsEmbeddedInProductNavigation: false,
    noBypassQualificationOwner: "PR-12",
  },
  retiredProductSurfaces: {
    chatInterfacePresent: false,
    knowledgePresent: false,
    mcpPresent: false,
    agenticPresent: false,
    portainerPresent: false,
    retiredLoaderPresent: false,
    retiredRedirectPresent: false,
    retiredLinkPresent: false,
    retiredBundleChunkPresent: false,
  },
  scopeBoundaries: {
    sourceOnly: true,
    intermediateDeployment: false,
    runtimeQualified: false,
    nativeExpertSessionActivation: false,
    signingKeyMutation: false,
    vendorMaintenanceAccessMutation: false,
  },
}

export const pr11GovernancePaths = [
  pr11DecisionPath,
  "docs/reduction/inference-core/README.md",
  "docs/reduction/inference-core/decision-register.md",
  "docs/reduction/inference-core/validation-register.md",
  "package.json",
  "scripts/inference-core/guardrails.mjs",
  "scripts/inference-core/guardrails.test.mjs",
  "scripts/inference-core/pr11-boundaries.test.mjs",
  "scripts/inference-core/pr11-contract-revision.mjs",
].sort()

export const pr11GeneratedDestinationPaths = [
  allowlistPath,
  routeBaselinePath,
  pr11ContractRevisionPath,
].sort()

export const pr11SourceEvidencePaths = [
  ".env.example",
  "apps/bff/src/db/inference-core-schema.ts",
  "apps/bff/src/routes/admin-authorization.test.ts",
  "apps/bff/src/routes/admin-inference.test.ts",
  "apps/bff/src/routes/admin-overview-ops.test.ts",
  "apps/bff/src/routes/admin-settings-persistence.test.ts",
  "apps/bff/src/routes/admin.test.ts",
  "apps/bff/src/routes/admin.ts",
  "apps/bff/src/routes/inference-core-characterization.test.ts",
  "apps/bff/src/services/admin-connected-apps-firecrawl.test.ts",
  "apps/bff/src/services/admin-connected-apps-firecrawl.ts",
  "apps/bff/src/services/admin-connected-apps.ts",
  "apps/bff/src/services/admin-hardware.ts",
  "apps/bff/src/services/admin-inference.test.ts",
  "apps/bff/src/services/admin-inference.ts",
  "apps/bff/src/services/admin-overview.test.ts",
  "apps/bff/src/services/admin-overview.ts",
  "apps/bff/src/services/admin-settings-core.test.ts",
  "apps/bff/src/services/admin-settings-core.ts",
  "apps/bff/src/services/admin-team-live-authority.test.ts",
  "apps/bff/src/services/admin-team.ts",
  "apps/bff/src/services/audit.test.ts",
  "apps/bff/src/services/audit.ts",
  "apps/web/next-config-security.test.ts",
  "apps/web/next.config.ts",
  "apps/web/src/app/page.test.tsx",
  "apps/web/src/app/page.tsx",
  "apps/web/src/components/console-v2/applications-v2-experience.test.tsx",
  "apps/web/src/components/console-v2/applications-v2-experience.tsx",
  "apps/web/src/components/console-v2/console-v2-icons.tsx",
  "apps/web/src/components/console-v2/console-v2-sections.ts",
  "apps/web/src/components/console-v2/console-v2-shell.test.tsx",
  "apps/web/src/components/console-v2/console-v2-shell.tsx",
  "apps/web/src/components/console-v2/hardware-v2-experience.test.tsx",
  "apps/web/src/components/console-v2/hardware-v2-experience.tsx",
  "apps/web/src/components/console-v2/inference-v2-experience.tsx",
  "apps/web/src/components/console-v2/overview-v2-experience.test.tsx",
  "apps/web/src/components/console-v2/overview-v2-experience.tsx",
  "apps/web/src/components/console-v2/role-aware-presentation.test.tsx",
  "apps/web/src/components/console-v2/settings-v2-experience.tsx",
  "apps/web/src/components/console-v2/team-v2-experience.tsx",
  "apps/web/src/lib/admin/actions-core.test.ts",
  "apps/web/src/lib/admin/actions-core.ts",
  "apps/web/src/lib/admin/console-v2-routes-core.test.tsx",
  "apps/web/src/lib/admin/console-v2-routes-core.tsx",
  "apps/web/src/lib/admin/retained-core-boundaries.test.ts",
  "apps/web/src/lib/admin/server-data-core.test.ts",
  "apps/web/src/lib/admin/server-data-core.ts",
  "apps/web/src/lib/security/content-security-policy.ts",
  "apps/web/src/middleware.test.ts",
  "apps/web/src/middleware.ts",
  "infra/migrations/0000_inference_core.sql",
  "packages/contracts/src/inference-core.test.ts",
  "packages/contracts/src/inference-core.ts",
  "packages/copy/src/index.ts",
  "test-support/inference-core-db-tests/src/pr11-settings-atomicity.test.ts",
].sort()

export const pr11AllowedRepositoryPaths = [
  ...pr11SourceEvidencePaths,
  ...pr11GovernancePaths,
].sort()

export const pr11AllowedRepositoryPathPatterns = pr11AllowedRepositoryPaths.map(
  (path) => new RegExp(`^${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`),
)

export const pr11RequiredFrozenRepositoryPaths = [...pr11AllowedRepositoryPaths]

export const pr11Pr09HistoricalNativeEvidenceBindings = [
  {
    path: "apps/bff/src/services/audit.test.ts",
    evidenceCommit: pr11ContractBase,
  },
  {
    path: "apps/bff/src/services/audit.ts",
    evidenceCommit: pr11ContractBase,
  },
]
const pr11Pr09HistoricalNativeEvidenceCommitByPath = new Map(
  pr11Pr09HistoricalNativeEvidenceBindings.map(({ path, evidenceCommit }) => [
    path,
    evidenceCommit,
  ]),
)

export const pr11Pr09HistoricalWebAuthenticationEvidenceBindings = [
  {
    path: "apps/web/src/middleware.test.ts",
    evidenceCommit: pr11ContractBase,
  },
  {
    path: "apps/web/src/middleware.ts",
    evidenceCommit: pr11ContractBase,
  },
]
const pr11Pr09HistoricalWebAuthenticationEvidenceCommitByPath = new Map(
  pr11Pr09HistoricalWebAuthenticationEvidenceBindings.map(
    ({ path, evidenceCommit }) => [path, evidenceCommit],
  ),
)

export const pr11Pr09HistoricalSourceBoundaryBindings = [
  {
    path: "apps/web/src/components/console-v2/console-v2-sections.ts",
    evidenceCommit: pr11ContractBase,
  },
]
const pr11Pr09HistoricalSourceBoundaryCommitByPath = new Map(
  pr11Pr09HistoricalSourceBoundaryBindings.map(({ path, evidenceCommit }) => [
    path,
    evidenceCommit,
  ]),
)

const pr10Pr09HistoricalNativeEvidencePaths = new Set([
  "apps/bff/src/db/inference-core-schema.ts",
  "infra/migrations/0000_inference_core.sql",
])

export const pr05AdminOnlyRoutePolicyKeys = [
  "GET /api/admin/recovery/status",
  "POST /api/admin/recovery/factor/commission",
  "POST /api/admin/settings/organization",
  "POST /api/admin/settings/telemetry",
]

export const pr05AllowedRepositoryPathPatterns = [
  /^\.env\.example$/,
  /^apps\/bff\/src\/auth\/(?:authorization(?:-security\.test)?|keycloak-jwt(?:-token-type\.test)?|runtime-live-authority(?:\.test)?|persona(?:-security\.test)?)\.ts$/,
  /^apps\/bff\/src\/db\/inference-core-(?:client|schema)(?:\.test)?\.ts$/,
  /^apps\/bff\/src\/index(?:\.test)?\.ts$/,
  /^apps\/bff\/src\/routes\/app-gateway-boundary\.test\.ts$/,
  /^apps\/bff\/src\/routes\/inference-core-characterization\.test\.ts$/,
  /^apps\/bff\/src\/routes\/admin(?:-[a-z0-9-]+)?(?:\.test)?\.ts$/,
  /^apps\/bff\/src\/services\/(?:admin-audit|admin-connected-apps(?:-atomicity)?|admin-inference|admin-overview|admin-settings-core|admin-team(?:-[a-z0-9-]+)?|expert-capabilities|idempotency|identity-mutation-journal|inference-core-keycloak-admin|inference-core-retention|users|[a-z0-9-]*recovery[a-z0-9-]*)(?:\.test)?\.ts$/,
  /^apps\/web\/src\/components\/console-v2\/(?:applications-v2-experience|console-v2-sections|console-v2-shell|inference-v2-experience|role-aware-presentation|settings-v2-experience|team-v2-experience)(?:\.test)?\.tsx?$/,
  /^apps\/web\/src\/lib\/admin\/console-v2-routes-core\.tsx$/,
  /^apps\/web\/src\/lib\/auth\/(?:auth|role-claims|session|token-refresh)(?:\.test)?\.ts$/,
  /^apps\/web\/src\/middleware(?:\.test)?\.ts$/,
  /^docs\/reduction\/inference-core\/(?:README\.md|pr-05-identity-decisions\.json)$/,
  /^infra\/keycloak\/(?:README\.md|[a-z0-9-]+\.json)$/,
  /^infra\/migrations\/(?:0000_inference_core|\d+_[a-z0-9_]*(?:identity|recovery|operator)[a-z0-9_]*)\.sql$/,
  /^package\.json$/,
  /^packages\/contracts\/src\/(?:common|index|inference-core(?:\.test)?|inference-core-recovery(?:\.test)?)\.ts$/,
  /^scripts\/inference-core\/(?:guardrails(?:\.test)?|pr05-(?:boundaries\.test|contract-revision|keycloak-seed(?:\.test)?))\.mjs$/,
  /^test-support\/inference-core-db-tests\/src\/(?:admin-connected-apps-storage|idempotency|inference-core-migration|inference-core-retention|pr05-[a-z0-9-]+)\.test\.ts$/,
]

export const pr06AllowedRepositoryPathPatterns = [
  /^\.env\.example$/,
  /^apps\/bff\/README\.md$/,
  /^apps\/bff\/src\/config\/fixture-mode(?:\.test)?\.ts$/,
  /^apps\/bff\/src\/db\/inference-core-(?:client|schema)(?:\.test)?\.ts$/,
  /^apps\/bff\/src\/index(?:\.test)?\.ts$/,
  /^apps\/bff\/src\/routes\/(?:admin(?:-[a-z0-9-]+)?|app-gateway(?:-[a-z0-9-]+)?|inference-core-characterization)(?:\.test)?\.ts$/,
  /^apps\/bff\/src\/services\/(?:admin-audit|admin-connected-apps(?:-[a-z0-9-]+)?|admin-inference|admin-litellm-client|application-gateway-policy|audit|idempotency|identity-mutation-journal|inference-core-keycloak-admin|inference-core-retention)(?:\.test)?\.ts$/,
  /^apps\/bff\/src\/services\/(?:admin-team-live-authority|expert-capabilities|litellm-chat-transport)\.test\.ts$/,
  /^apps\/bff\/src\/services\/users\.ts$/,
  /^apps\/web\/src\/components\/console-v2\/(?:action-toasts|applications-v2-experience|inference-v2-experience|role-aware-presentation)(?:\.test)?\.tsx?$/,
  /^apps\/web\/src\/lib\/admin\/(?:actions-core|console-v2-routes-core|server-data-core)(?:\.test)?\.tsx?$/,
  /^docs\/reduction\/inference-core\/(?:README\.md|pr-06-application-decisions\.json)$/,
  /^infra\/keycloak\/(?:README\.md|[a-z0-9-]+\.json)$/,
  /^infra\/migrations\/(?:0000_inference_core|\d+_[a-z0-9_]*(?:application|credential|oauth|reconciliation)[a-z0-9_]*)\.sql$/,
  /^package\.json$/,
  /^packages\/contracts\/src\/(?:index|inference-core(?:\.test)?)\.ts$/,
  /^scripts\/inference-core\/(?:guardrails(?:\.test)?|pr05-keycloak-seed(?:\.test)?|pr06-(?:boundaries\.test|contract-revision))\.mjs$/,
  /^test-support\/inference-core-db-tests\/src\/(?:admin-connected-apps-storage|inference-core-migration|pr05-identity-mutation-journal|pr06-application-credential-reconciliation)\.test\.ts$/,
]

export const pr07AllowedRepositoryPathPatterns = [
  /^\.env\.example$/,
  /^apps\/bff\/README\.md$/,
  /^apps\/bff\/src\/auth\/(?:application-access-token(?:\.test)?|keycloak-jwt(?:-token-type)?(?:\.test)?)\.ts$/,
  /^apps\/bff\/src\/commands\/inference-core-retention(?:\.test)?\.ts$/,
  /^apps\/bff\/src\/db\/inference-core-(?:client|schema)(?:\.test)?\.ts$/,
  /^apps\/bff\/src\/inference\/chat-completions(?:\.test)?\.ts$/,
  /^apps\/bff\/src\/routes\/(?:app-gateway|app-gateway(?:-accounting-errors|-boundary|-oauth-access-token)?\.test|inference-core-characterization\.test)\.ts$/,
  /^apps\/bff\/src\/services\/(?:admin-connected-apps(?:-(?:accounting|atomicity))?|application-gateway-(?:policy|runtime-limits)|inference-core-retention|litellm-chat-transport)(?:\.test)?\.ts$/,
  /^apps\/web\/src\/components\/console-v2\/applications-v2-experience(?:\.test)?\.tsx$/,
  /^apps\/web\/src\/components\/console-v2\/role-aware-presentation\.test\.tsx$/,
  /^apps\/web\/src\/lib\/admin\/actions-core(?:\.test)?\.ts$/,
  /^docs\/reduction\/inference-core\/(?:README\.md|pr-07-data-plane-decisions\.json|retention-characterization\.json)$/,
  /^infra\/migrations\/0000_inference_core\.sql$/,
  /^package\.json$/,
  /^packages\/contracts\/src\/(?:index|inference-core(?:\.test)?)\.ts$/,
  /^scripts\/inference-core\/(?:guardrails(?:\.test)?|pr07-(?:boundaries\.test|contract-revision))\.mjs$/,
  /^test-support\/inference-core-db-tests\/src\/(?:admin-connected-apps-storage|inference-core-migration|inference-core-retention|pr05-identity-mutation-journal|pr06-application-credential-reconciliation|pr07-inference-data-plane)\.test\.ts$/,
]

export const pr08AllowedRepositoryPathPatterns = [
  /^\.env\.example$/,
  /^apps\/bff\/src\/db\/inference-core-(?:client|schema)(?:\.test)?\.ts$/,
  /^apps\/bff\/src\/index(?:-firecrawl-(?:credential-isolation|logging)\.test|\.test)?\.ts$/,
  /^apps\/bff\/src\/routes\/(?:admin(?:-[a-z0-9-]+)?|firecrawl-gateway|inference-core-characterization)(?:\.test)?\.ts$/,
  /^apps\/bff\/src\/services\/(?:admin-connected-apps(?:-[a-z0-9-]+)?|admin-settings-core|admin-settings-firecrawl-readiness|application-gateway-policy|firecrawl-gateway-runtime|firecrawl-url-safety|inference-core-retention)(?:\.test)?\.ts$/,
  /^apps\/web\/src\/components\/console-v2\/(?:applications-v2-experience|role-aware-presentation)\.test\.tsx$/,
  /^apps\/web\/src\/lib\/admin\/actions-core\.test\.ts$/,
  /^docs\/reduction\/inference-core\/(?:README\.md|decision-register\.md|pr-08-firecrawl-(?:decisions\.json|source-manifest\.json)|source-map\.jsonl|validation-register\.md)$/,
  /^infra\/firecrawl\/(?:README\.md|THIRD_PARTY_NOTICES\.md|compose\.yaml|validate-profile(?:\.test)?\.mjs|egress\/(?:squid\.conf|allowlists\/default\/allowed-hosts\.txt)|provenance\/source-lock\.json|searxng\/settings\.yml)$/,
  /^infra\/migrations\/0000_inference_core\.sql$/,
  /^package\.json$/,
  /^packages\/contracts\/src\/inference-core(?:-firecrawl\.test)?\.ts$/,
  /^scripts\/inference-core\/(?:guardrails(?:\.test)?|pr08-(?:boundaries\.test|contract-revision))\.mjs$/,
  /^test-support\/inference-core-db-tests\/src\/(?:admin-connected-apps-storage|inference-core-migration|pr07-inference-data-plane|pr08-firecrawl-schema)\.test\.ts$/,
]

export const pr09ObservabilityProfilePaths = [
  "infra/observability/README.md",
  "infra/observability/alertmanager/alertmanager.yml",
  "infra/observability/grafana/customer-folder-contract.json",
  "infra/observability/grafana/dashboards/baseline/inference-core-overview.json",
  "infra/observability/grafana/grafana.ini",
  "infra/observability/grafana/provisioning/dashboards/baseline.yml",
  "infra/observability/grafana/provisioning/datasources/prometheus.yml",
  "infra/observability/prometheus/file-sd/inference-core.json",
  "infra/observability/prometheus/prometheus.yml",
  "infra/observability/prometheus/rules/alert-rules.yml",
  "infra/observability/prometheus/rules/recording-rules.yml",
  "infra/observability/runtime-contract.json",
  "infra/observability/validate-profile.mjs",
  "infra/observability/validate-profile.test.mjs",
].sort()

export const pr09WebActivityPaths = [
  "apps/web/src/app/activity/page.tsx",
  "apps/web/src/app/api/admin/audit/export/route.test.ts",
  "apps/web/src/app/api/admin/audit/export/route.ts",
  "apps/web/src/app/api/admin/audit/export/verification-keys/route.test.ts",
  "apps/web/src/app/api/admin/audit/export/verification-keys/route.ts",
  "apps/web/src/app/page.test.tsx",
  "apps/web/src/components/console-v2/activity-v2-experience.test.tsx",
  "apps/web/src/components/console-v2/activity-v2-experience.tsx",
  "apps/web/src/components/console-v2/console-v2-sections.ts",
  "apps/web/src/components/console-v2/hardware-v2-experience.test.tsx",
  "apps/web/src/components/console-v2/hardware-v2-experience.tsx",
  "apps/web/src/lib/admin/console-v2-routes-core.tsx",
  "apps/web/src/lib/admin/retained-core-boundaries.test.ts",
  "apps/web/src/lib/admin/server-data-core.test.ts",
  "apps/web/src/lib/admin/server-data-core.ts",
  "apps/web/src/middleware.test.ts",
  "apps/web/src/middleware.ts",
].sort()

export const pr09BffObservabilityPaths = [
  "apps/bff/src/routes/admin-hardware.test.ts",
  "apps/bff/src/routes/admin-overview-health.test.ts",
  "apps/bff/src/routes/observability-metrics.test.ts",
  "apps/bff/src/routes/observability-metrics.ts",
  "apps/bff/src/services/admin-alertmanager.test.ts",
  "apps/bff/src/services/admin-alertmanager.ts",
  "apps/bff/src/services/admin-hardware.ts",
  "apps/bff/src/services/admin-health.ts",
  "apps/bff/src/services/admin-observability-metrics.test.ts",
  "apps/bff/src/services/admin-observability-metrics.ts",
  "apps/bff/src/services/admin-overview.ts",
  "apps/bff/src/services/admin-prometheus.test.ts",
  "apps/bff/src/services/admin-prometheus.ts",
  "apps/bff/src/services/expert-capabilities.test.ts",
  "apps/bff/src/services/expert-capabilities.ts",
].sort()

export const pr09AuditPaths = [
  "apps/bff/src/commands/audit-ingestion.test.ts",
  "apps/bff/src/commands/audit-ingestion.ts",
  "apps/bff/src/db/inference-core-client.test.ts",
  "apps/bff/src/db/inference-core-client.ts",
  "apps/bff/src/db/inference-core-schema.test.ts",
  "apps/bff/src/db/inference-core-schema.ts",
  "apps/bff/src/routes/admin-audit-export.test.ts",
  "apps/bff/src/routes/admin-authorization.test.ts",
  "apps/bff/src/routes/admin.ts",
  "apps/bff/src/services/admin-audit.test.ts",
  "apps/bff/src/services/admin-audit.ts",
  "apps/bff/src/services/audit-export-signing.test.ts",
  "apps/bff/src/services/audit-export-signing.ts",
  "apps/bff/src/services/audit-export.test.ts",
  "apps/bff/src/services/audit-export.ts",
  "apps/bff/src/services/audit-ingestion.test.ts",
  "apps/bff/src/services/audit-ingestion.ts",
  "apps/bff/src/services/audit.test.ts",
  "apps/bff/src/services/audit.ts",
  "apps/bff/src/services/inference-core-retention.test.ts",
  "apps/bff/src/services/inference-core-retention.ts",
  "infra/migrations/0000_inference_core.sql",
  "packages/contracts/src/inference-core.test.ts",
  "packages/contracts/src/inference-core.ts",
  "test-support/inference-core-db-tests/src/inference-core-migration.test.ts",
  "test-support/inference-core-db-tests/src/inference-core-retention.test.ts",
  "test-support/inference-core-db-tests/src/pr09-audit-ingestion.test.ts",
].sort()

export const pr09RootIntegrationPaths = [
  ".env.example",
  "apps/bff/package.json",
  "apps/bff/src/index.ts",
  "infra/keycloak/README.md",
  "infra/keycloak/inference-core-commissioning.json",
  "infra/keycloak/inference-core-realm-seed.json",
  "package.json",
  "scripts/inference-core/pr05-keycloak-seed.mjs",
  "scripts/inference-core/pr05-keycloak-seed.test.mjs",
].sort()

export const pr09RequiredFrozenRepositoryPaths = [
  ...pr09ObservabilityProfilePaths,
  ...pr09WebActivityPaths,
  ...pr09BffObservabilityPaths,
  ...pr09AuditPaths,
  ...pr09RootIntegrationPaths,
  "apps/bff/src/services/admin-alert-egress.test.ts",
  "apps/bff/src/services/admin-alert-egress.ts",
  "apps/bff/src/routes/admin-alert-egress.test.ts",
  "apps/bff/src/routes/inference-core-characterization.test.ts",
  "apps/bff/src/services/admin-inference.test.ts",
  pr09DecisionPath,
  "scripts/inference-core/guardrails.mjs",
  "scripts/inference-core/guardrails.test.mjs",
  ...pr09SuccessorAwareHistoricalTestPaths,
  "scripts/inference-core/pr09-boundaries.test.mjs",
  "scripts/inference-core/pr09-contract-revision.mjs",
  "test-support/inference-core-db-tests/src/pr09-alert-egress.test.ts",
].sort()

export const pr09AllowedRepositoryPathPatterns = [
  /^\.env\.example$/,
  /^apps\/bff\/package\.json$/,
  /^apps\/bff\/src\/commands\/audit-ingestion(?:\.test)?\.ts$/,
  /^apps\/bff\/src\/db\/inference-core-(?:client|schema)(?:\.test)?\.ts$/,
  /^apps\/bff\/src\/index\.ts$/,
  /^apps\/bff\/src\/routes\/(?:admin(?:-[a-z0-9-]+)?|inference-core-characterization|observability-metrics)(?:\.test)?\.ts$/,
  /^apps\/bff\/src\/services\/(?:admin-alert-egress|admin-alertmanager|admin-audit|admin-hardware|admin-health|admin-inference|admin-observability-metrics|admin-overview|admin-prometheus|audit|audit-export|audit-export-signing|audit-ingestion|expert-capabilities|inference-core-retention)(?:\.test)?\.ts$/,
  /^apps\/web\/src\/app\/(?:activity\/page|api\/admin\/audit\/export\/(?:route|verification-keys\/route)(?:\.test)?|page\.test)\.tsx?$/,
  /^apps\/web\/src\/components\/console-v2\/(?:activity-v2-experience|console-v2-sections|hardware-v2-experience)(?:\.test)?\.tsx?$/,
  /^apps\/web\/src\/lib\/admin\/(?:console-v2-routes-core|retained-core-boundaries|server-data-core)(?:\.test)?\.tsx?$/,
  /^apps\/web\/src\/middleware(?:\.test)?\.ts$/,
  /^docs\/reduction\/inference-core\/pr-09-activity-audit-observability-decisions\.json$/,
  /^infra\/migrations\/0000_inference_core\.sql$/,
  /^infra\/keycloak\/(?:README\.md|inference-core-(?:commissioning|realm-seed)\.json)$/,
  /^infra\/observability\/(?:README\.md|runtime-contract\.json|validate-profile(?:\.test)?\.mjs|alertmanager\/alertmanager\.yml|grafana\/(?:grafana\.ini|customer-folder-contract\.json|dashboards\/baseline\/inference-core-overview\.json|provisioning\/(?:dashboards\/baseline\.yml|datasources\/prometheus\.yml))|prometheus\/(?:prometheus\.yml|file-sd\/inference-core\.json|rules\/(?:alert-rules|recording-rules)\.yml))$/,
  /^package\.json$/,
  /^packages\/contracts\/src\/inference-core(?:-authorization)?(?:\.test)?\.ts$/,
  /^scripts\/inference-core\/(?:guardrails(?:\.test)?|pr02-boundaries\.test|pr05-(?:boundaries\.test|keycloak-seed(?:\.test)?)|pr09-(?:boundaries\.test|contract-revision))\.mjs$/,
  /^test-support\/inference-core-db-tests\/src\/(?:admin-connected-apps-storage|inference-core-migration|inference-core-retention|pr07-inference-data-plane|pr08-firecrawl-schema|pr09-alert-egress|pr09-audit-ingestion)\.test\.ts$/,
]

export const pr08WebContractCompatibilityTestPaths = [
  "apps/web/src/components/console-v2/applications-v2-experience.test.tsx",
  "apps/web/src/components/console-v2/role-aware-presentation.test.tsx",
  "apps/web/src/lib/admin/actions-core.test.ts",
]

export const pr08ExpectedMappedTargetPaths = [
  ".env.example",
  "apps/bff/src/db/inference-core-client.test.ts",
  "apps/bff/src/db/inference-core-client.ts",
  "apps/bff/src/db/inference-core-schema.test.ts",
  "apps/bff/src/db/inference-core-schema.ts",
  "apps/bff/src/index-firecrawl-credential-isolation.test.ts",
  "apps/bff/src/index.ts",
  "apps/bff/src/index-firecrawl-logging.test.ts",
  "apps/bff/src/routes/admin-authorization.test.ts",
  "apps/bff/src/routes/admin-firecrawl-lifecycle.test.ts",
  "apps/bff/src/routes/admin.ts",
  "apps/bff/src/routes/firecrawl-gateway.test.ts",
  "apps/bff/src/routes/firecrawl-gateway.ts",
  "apps/bff/src/routes/inference-core-characterization.test.ts",
  "apps/bff/src/services/admin-connected-apps-firecrawl.test.ts",
  "apps/bff/src/services/admin-connected-apps-firecrawl-settlement.test.ts",
  "apps/bff/src/services/admin-connected-apps-firecrawl.ts",
  "apps/bff/src/services/admin-connected-apps.ts",
  "apps/bff/src/services/admin-settings-core.ts",
  "apps/bff/src/services/admin-settings-firecrawl-readiness.test.ts",
  "apps/bff/src/services/firecrawl-gateway-runtime.test.ts",
  "apps/bff/src/services/firecrawl-gateway-runtime.ts",
  "apps/bff/src/services/firecrawl-url-safety.test.ts",
  "apps/bff/src/services/firecrawl-url-safety.ts",
  "apps/bff/src/services/inference-core-retention.test.ts",
  "apps/bff/src/services/inference-core-retention.ts",
  ...pr08WebContractCompatibilityTestPaths,
  "infra/firecrawl/README.md",
  "infra/firecrawl/THIRD_PARTY_NOTICES.md",
  "infra/firecrawl/compose.yaml",
  "infra/firecrawl/egress/allowlists/default/allowed-hosts.txt",
  "infra/firecrawl/egress/squid.conf",
  "infra/firecrawl/provenance/source-lock.json",
  "infra/firecrawl/searxng/settings.yml",
  "infra/firecrawl/validate-profile.mjs",
  "infra/firecrawl/validate-profile.test.mjs",
  "infra/migrations/0000_inference_core.sql",
  "package.json",
  "packages/contracts/src/inference-core-firecrawl.test.ts",
  "packages/contracts/src/inference-core.ts",
  "test-support/inference-core-db-tests/src/admin-connected-apps-storage.test.ts",
  "test-support/inference-core-db-tests/src/inference-core-migration.test.ts",
  "test-support/inference-core-db-tests/src/pr07-inference-data-plane.test.ts",
  "test-support/inference-core-db-tests/src/pr08-firecrawl-schema.test.ts",
].sort()

export const pr08ReviewedSourceMapSemanticBindings = {
  ".env.example":
    "da90b370884b92411898eac77d5dcb481d9823ea1f9cd8d62a23fefecee14d18",
  "apps/bff/src/db/inference-core-client.test.ts":
    "604ff9e608626f66bdf4fc32ba12a24db28fd4104e05f9a2020ed84d2822a8de",
  "apps/bff/src/db/inference-core-client.ts":
    "604ff9e608626f66bdf4fc32ba12a24db28fd4104e05f9a2020ed84d2822a8de",
  "apps/bff/src/db/inference-core-schema.test.ts":
    "604ff9e608626f66bdf4fc32ba12a24db28fd4104e05f9a2020ed84d2822a8de",
  "apps/bff/src/db/inference-core-schema.ts":
    "604ff9e608626f66bdf4fc32ba12a24db28fd4104e05f9a2020ed84d2822a8de",
  "apps/bff/src/index-firecrawl-credential-isolation.test.ts":
    "9c1b5a179831a9d5bad3d501c12d6ab582673a129bff24d6830d0bca5f6b4ca3",
  "apps/bff/src/index-firecrawl-logging.test.ts":
    "ce245d990f8ed08162000a5f6d5c6345421c9c6d31df2d85c63a72f72e3d97f4",
  "apps/bff/src/index.ts":
    "5c5358f9bb19763318686c3a0874ebee843054352c3ef803a2515068be948441",
  "apps/bff/src/routes/admin-authorization.test.ts":
    "b95aba0412ec7fd83ff00164cb9ef873f392ce450afb5c64da2240f040143b1a",
  "apps/bff/src/routes/admin-firecrawl-lifecycle.test.ts":
    "25f0061406bded9e84411e3e8149b161e867c66accfb0d62d9a0412fcb387a14",
  "apps/bff/src/routes/admin.ts":
    "e60293e81ebfa00db052a7196ee107caf53bb1ecddfd34f107e24b563128c2f9",
  "apps/bff/src/routes/firecrawl-gateway.test.ts":
    "edb2f8d7bafd7f26271af97097a523c92d74cd78bf8677a0cc79766867a25891",
  "apps/bff/src/routes/firecrawl-gateway.ts":
    "edb2f8d7bafd7f26271af97097a523c92d74cd78bf8677a0cc79766867a25891",
  "apps/bff/src/routes/inference-core-characterization.test.ts":
    "c478e3ecec22d0513e177a9bfe09a21f04fc7f483344496ec47e72c402a82bf7",
  "apps/bff/src/services/admin-connected-apps-firecrawl.test.ts":
    "659edd9fd2bfe16750e54613ed1fc3b6da9ecfd96da09b3200da569f9391ec10",
  "apps/bff/src/services/admin-connected-apps-firecrawl-settlement.test.ts":
    "b11245341bfd38dea44da52d5b06135edf3fcc8a1a152753307ff1ba3df11b2e",
  "apps/bff/src/services/admin-connected-apps-firecrawl.ts":
    "c6bb2c90a4d80de3807680a7ad0ed67983e7313e406143fa83b5ce4b0e8a464b",
  "apps/bff/src/services/admin-connected-apps.ts":
    "ffdbbd9b7d3e5d6e0f31c8fef58fb37b05081405d2d634f51637ce8bfd5c2689",
  "apps/bff/src/services/admin-settings-core.ts":
    "835194c2559293885bb9186f3786f05d86f0e63f72abfe2023c4092a2fe34efc",
  "apps/bff/src/services/admin-settings-firecrawl-readiness.test.ts":
    "d3477f9d6548df5149d1321603316fe83ec8502af2d79b2238be9549e96c2766",
  "apps/bff/src/services/firecrawl-gateway-runtime.test.ts":
    "2d507ced7ac9d7223d84233bb63fc24ac9844ea70e9af4d17e5614563e78c3cd",
  "apps/bff/src/services/firecrawl-gateway-runtime.ts":
    "31b8b436de463b698ad00287e92846830a2361f9dd19eeae99af55fd98757cb1",
  "apps/bff/src/services/firecrawl-url-safety.test.ts":
    "e7df0bf1b103fa1ee97b4cfbcd748e945205b8c7d5858210ec88b3e867e15bd5",
  "apps/bff/src/services/firecrawl-url-safety.ts":
    "e7df0bf1b103fa1ee97b4cfbcd748e945205b8c7d5858210ec88b3e867e15bd5",
  "apps/bff/src/services/inference-core-retention.test.ts":
    "e369645d5fa03a0a1790adfc43ea2b2e73a305129f304febca035b2ca5d99706",
  "apps/bff/src/services/inference-core-retention.ts":
    "e369645d5fa03a0a1790adfc43ea2b2e73a305129f304febca035b2ca5d99706",
  "apps/web/src/components/console-v2/applications-v2-experience.test.tsx":
    "7a0aa95f6f4dbb5533949181ccf31b0b23f61385571e4f5e78af25055b23fb3a",
  "apps/web/src/components/console-v2/role-aware-presentation.test.tsx":
    "7a0aa95f6f4dbb5533949181ccf31b0b23f61385571e4f5e78af25055b23fb3a",
  "apps/web/src/lib/admin/actions-core.test.ts":
    "7a0aa95f6f4dbb5533949181ccf31b0b23f61385571e4f5e78af25055b23fb3a",
  "infra/firecrawl/README.md":
    "d6f6eac03192398c49e144a4326a5edbbe5c9da00db5feba871581b3a7e2c088",
  "infra/firecrawl/THIRD_PARTY_NOTICES.md":
    "290548225fd5fd8c161461221b836847828e4f2762607dbe9456002e242a2a03",
  "infra/firecrawl/compose.yaml":
    "e1a85bca04035f08fffd741cd4f6b2fcef9a62f4f030a907e0bf3d8d479eb269",
  "infra/firecrawl/egress/allowlists/default/allowed-hosts.txt":
    "a3d0c36b3ec9c75e6e59ecf97fda0a76e4c63ee064eed491549ed0088a404267",
  "infra/firecrawl/egress/squid.conf":
    "d09d98be555f250981924f3c60304a18a285094dea6af7deff8f2faf0900b436",
  "infra/firecrawl/provenance/source-lock.json":
    "0f317a70a6fc024c98436c9b9020b1894caa4b8493f149106c18641609dd58dd",
  "infra/firecrawl/searxng/settings.yml":
    "39b627455014a047a9b86d6a87c6e065e43bedf2f1645de7d1ce03026da40205",
  "infra/firecrawl/validate-profile.mjs":
    "163c5dfb422de24835c6b2b9dbff601d4c86a06881a3187d4edc89d28807453b",
  "infra/firecrawl/validate-profile.test.mjs":
    "163c5dfb422de24835c6b2b9dbff601d4c86a06881a3187d4edc89d28807453b",
  "infra/migrations/0000_inference_core.sql":
    "e8e46e27af1fced20206c778e01af6db79bcee8123bb75f513f30478444f6ccc",
  "package.json":
    "28c55ac1cacbf7c0a0aed19ee0635db933f33a6938bfc4f36a405fc33ed6fb50",
  "packages/contracts/src/inference-core-firecrawl.test.ts":
    "49ad56b6430206e6d47c0f0db09d7c56c0c21e02d7132c17d975fbe8abd5a0af",
  "packages/contracts/src/inference-core.ts":
    "49ad56b6430206e6d47c0f0db09d7c56c0c21e02d7132c17d975fbe8abd5a0af",
  "test-support/inference-core-db-tests/src/admin-connected-apps-storage.test.ts":
    "ed8dadc8ff8452595e193573f3a4350026f6717143a1f42912d9ccc4c01960f6",
  "test-support/inference-core-db-tests/src/inference-core-migration.test.ts":
    "2248e1258e89bed88b500ab816493378fe93a55fc68ea64673ed602a72dddb74",
  "test-support/inference-core-db-tests/src/pr07-inference-data-plane.test.ts":
    "7182deb3bc1c9c2145c2f2c31b7d75c9e76fdb7f3a0dd2457ed4dccb58c5f0a4",
  "test-support/inference-core-db-tests/src/pr08-firecrawl-schema.test.ts":
    "2248e1258e89bed88b500ab816493378fe93a55fc68ea64673ed602a72dddb74",
}

export const pr08SourceMapBinding = {
  path: pr08SourceMapPath,
  method: "reviewed-semantic-unit-reconstruction",
  targetBaseCommit: pr08ContractBase,
  targetPaths: pr08ExpectedMappedTargetPaths,
}

export const pr07RetainedFirecrawlBoundaryPaths = [
  ".env.example",
  "apps/bff/README.md",
  "package.json",
  "packages/contracts/src/inference-core.ts",
]

export const pr06AddedApplicationRouteContract = [
  {
    surface: "bff",
    method: "DELETE",
    path: "/api/admin/applications/connected-apps/:id",
    source: "apps/bff/src/routes/admin.ts",
    classification: "current-console-seam",
  },
  {
    surface: "bff",
    method: "POST",
    path: "/api/admin/applications/connected-apps/:id/credentials/:credentialId/revoke",
    source: "apps/bff/src/routes/admin.ts",
    classification: "current-console-seam",
  },
  {
    surface: "bff",
    method: "POST",
    path: "/api/admin/applications/connected-apps/:id/enable",
    source: "apps/bff/src/routes/admin.ts",
    classification: "current-console-seam",
  },
]

export const pr06RetiredApplicationIdentifiers = [
  "AdminConnectedAppEnvironment",
  "AdminConnectedAppEnvironmentState",
  "AdminConnectedAppPromotionResult",
  "AdminConnectedAppTestStatus",
  "ConnectedAppEnvironmentRecord",
  "adminConnectedAppEnvironmentSchema",
  "adminConnectedAppEnvironmentStateSchema",
  "adminConnectedAppTestStatusSchema",
  "authMethods",
  "credentialIssuedAt",
  "credential_issued_at",
  "environment",
  "environments",
  "lastTestedAt",
  "last_tested_at",
  "ownerGroup",
  "owner_group",
  "primaryAuthMethod",
  "primary_auth_method",
  "productionReady",
  "production_ready",
  "promote-production",
  "promote_production",
  "promoteAdminConnectedAppToProduction",
  "testStatus",
  "test_status",
  "testedAt",
]

export const pr06RetiredApplicationBoundaryPaths = [
  ".env.example",
  "apps/bff/src/db/inference-core-schema.ts",
  "apps/bff/src/routes/admin.ts",
  "apps/bff/src/routes/app-gateway.ts",
  "apps/bff/src/services/admin-connected-apps.ts",
  "apps/bff/src/services/application-gateway-policy.ts",
  "apps/bff/src/services/inference-core-keycloak-admin.ts",
  "apps/web/src/app/applications/[[...section]]/page.tsx",
  "apps/web/src/components/console-v2/applications-v2-experience.tsx",
  "apps/web/src/lib/admin/actions-core.ts",
  "apps/web/src/lib/admin/console-v2-routes-core.tsx",
  "apps/web/src/lib/admin/server-data-core.ts",
  "infra/migrations/0000_inference_core.sql",
  "packages/contracts/src/index.ts",
  "packages/contracts/src/inference-core.ts",
]

export const pr06TargetContract = {
  findingEntriesDueByPr06: 0,
  remainingFindingEntries: 1,
  fs105BuilderHubTombstones: [
    {
      path: "apps/web/src/middleware.test.ts",
      removeBy: "PR-12",
    },
  ],
  legacyRoutes: 0,
  routes: 86,
  routeClassifications: {
    "current-console-seam": 77,
    "operational-auth": 4,
    "private-operational": 3,
    "required-now": 2,
  },
  addedApplicationRoutes: pr06AddedApplicationRouteContract,
  adminOnlyRoutePolicyKeys: pr05AdminOnlyRoutePolicyKeys,
  fastifyRegistrars: [
    {
      exportName: "registerAdminRoutes",
      importSource: "./routes/admin",
      sourcePath: "apps/bff/src/routes/admin.ts",
    },
    {
      exportName: "registerAppGatewayRoutes",
      importSource: "./routes/app-gateway",
      sourcePath: "apps/bff/src/routes/app-gateway.ts",
    },
    {
      exportName: "registerAuthorization",
      importSource: "./auth/authorization",
      sourcePath: "apps/bff/src/auth/authorization.ts",
    },
  ],
  webInferenceConsumers: 0,
  escapeHatchPaths: [],
}

export const pr07PublicInferenceRouteContract = [
  {
    surface: "bff",
    method: "GET",
    path: "/api/app-gateway/v1/models",
    source: "apps/bff/src/routes/app-gateway.ts",
    classification: "required-now",
  },
  {
    surface: "bff",
    method: "POST",
    path: "/api/app-gateway/v1/chat/completions",
    source: "apps/bff/src/routes/app-gateway.ts",
    classification: "required-now",
  },
]

export const pr07TargetContract = {
  findingEntriesDueByPr07: 0,
  remainingFindingEntries: 1,
  fs105BuilderHubTombstones: [
    {
      path: "apps/web/src/middleware.test.ts",
      removeBy: "PR-12",
    },
  ],
  legacyRoutes: 0,
  routes: 86,
  routeClassifications: {
    "current-console-seam": 77,
    "operational-auth": 4,
    "private-operational": 3,
    "required-now": 2,
  },
  publicInferenceRoutes: pr07PublicInferenceRouteContract,
  adminOnlyRoutePolicyKeys: pr05AdminOnlyRoutePolicyKeys,
  fastifyRegistrars: pr06TargetContract.fastifyRegistrars,
  webInferenceConsumers: 0,
  escapeHatchPaths: [],
}

export const pr08FirecrawlRouteContract = [
  {
    surface: "bff",
    method: "POST",
    path: "/v2/scrape",
    source: "apps/bff/src/routes/firecrawl-gateway.ts",
    classification: "public-t2",
  },
  {
    surface: "bff",
    method: "POST",
    path: "/v2/search",
    source: "apps/bff/src/routes/firecrawl-gateway.ts",
    classification: "public-t2",
  },
]

export const pr08FirecrawlAdminRouteContract = [
  {
    surface: "bff",
    method: "POST",
    path: "/api/admin/applications/connected-apps/:id/firecrawl/enable",
    source: "apps/bff/src/routes/admin.ts",
    classification: "current-console-seam",
  },
  {
    surface: "bff",
    method: "PATCH",
    path: "/api/admin/applications/connected-apps/:id/firecrawl",
    source: "apps/bff/src/routes/admin.ts",
    classification: "current-console-seam",
  },
  {
    surface: "bff",
    method: "POST",
    path: "/api/admin/applications/connected-apps/:id/firecrawl/test",
    source: "apps/bff/src/routes/admin.ts",
    classification: "current-console-seam",
  },
  {
    surface: "bff",
    method: "POST",
    path: "/api/admin/applications/connected-apps/:id/firecrawl/rotate-credentials",
    source: "apps/bff/src/routes/admin.ts",
    classification: "current-console-seam",
  },
  {
    surface: "bff",
    method: "POST",
    path: "/api/admin/applications/connected-apps/:id/firecrawl/disable",
    source: "apps/bff/src/routes/admin.ts",
    classification: "current-console-seam",
  },
  {
    surface: "bff",
    method: "POST",
    path: "/api/admin/applications/connected-apps/:id/firecrawl/credentials/:credentialId/revoke",
    source: "apps/bff/src/routes/admin.ts",
    classification: "current-console-seam",
  },
]

export const pr08TargetContract = {
  findingEntriesDueByPr08: 0,
  remainingFindingEntries: 1,
  fs105BuilderHubTombstones: [
    {
      path: "apps/web/src/middleware.test.ts",
      removeBy: "PR-12",
    },
  ],
  legacyRoutes: 0,
  routes: 94,
  routeClassifications: {
    "current-console-seam": 83,
    "operational-auth": 4,
    "private-operational": 3,
    "public-t2": 2,
    "required-now": 2,
  },
  publicInferenceRoutes: pr07PublicInferenceRouteContract,
  publicFirecrawlRoutes: pr08FirecrawlRouteContract,
  firecrawlAdminRoutes: pr08FirecrawlAdminRouteContract,
  adminOnlyRoutePolicyKeys: pr05AdminOnlyRoutePolicyKeys,
  fastifyRegistrars: [
    ...pr07TargetContract.fastifyRegistrars,
    {
      exportName: "registerFirecrawlGatewayRoutes",
      importSource: "./routes/firecrawl-gateway",
      sourcePath: "apps/bff/src/routes/firecrawl-gateway.ts",
    },
  ].sort((left, right) => left.exportName.localeCompare(right.exportName)),
  webInferenceConsumers: 0,
  escapeHatchPaths: [],
  webUiVisible: false,
  webContractCompatibilityTestPaths: pr08WebContractCompatibilityTestPaths,
  sourceOnly: true,
  runtimeQualified: false,
}

export const pr09AdminOnlyRoutePolicyKeys = [
  "GET /api/admin/recovery/status",
  "POST /api/admin/recovery/factor/commission",
  "POST /api/admin/observability/alert-egress",
  "POST /api/admin/settings/organization",
  "POST /api/admin/settings/telemetry",
]

export const pr09AddedRouteContract = [
  {
    surface: "bff",
    method: "GET",
    path: "/api/admin/audit/export",
    source: "apps/bff/src/routes/admin.ts",
    classification: "current-console-seam",
  },
  {
    surface: "bff",
    method: "GET",
    path: "/api/admin/audit/export/verification-keys",
    source: "apps/bff/src/routes/admin.ts",
    classification: "current-console-seam",
  },
  {
    surface: "bff",
    method: "GET",
    path: "/api/admin/observability/alert-egress",
    source: "apps/bff/src/routes/admin.ts",
    classification: "current-console-seam",
  },
  {
    surface: "bff",
    method: "GET",
    path: "/internal/observability/metrics",
    source: "apps/bff/src/routes/observability-metrics.ts",
    classification: "private-operational",
  },
  {
    surface: "bff",
    method: "POST",
    path: "/api/admin/observability/alert-egress",
    source: "apps/bff/src/routes/admin.ts",
    classification: "current-console-seam",
  },
  {
    surface: "web-handler",
    method: "GET",
    path: "/api/admin/audit/export",
    source: "apps/web/src/app/api/admin/audit/export/route.ts",
    classification: "current-console-seam",
  },
  {
    surface: "web-handler",
    method: "GET",
    path: "/api/admin/audit/export/verification-keys",
    source:
      "apps/web/src/app/api/admin/audit/export/verification-keys/route.ts",
    classification: "current-console-seam",
  },
  {
    surface: "web-page",
    method: "PAGE",
    path: "/activity",
    source: "apps/web/src/app/activity/page.tsx",
    classification: "current-console-seam",
  },
].sort(compareRoutes)

export const pr09TargetContract = {
  findingEntriesDueByPr09: 0,
  remainingFindingEntries: 1,
  fs105BuilderHubTombstones: [
    {
      path: "apps/web/src/middleware.test.ts",
      removeBy: "PR-12",
    },
  ],
  legacyRoutes: 0,
  routes: 102,
  routeClassifications: {
    "current-console-seam": 90,
    "operational-auth": 4,
    "private-operational": 4,
    "public-t2": 2,
    "required-now": 2,
  },
  publicInferenceRoutes: pr07PublicInferenceRouteContract,
  publicFirecrawlRoutes: pr08FirecrawlRouteContract,
  firecrawlAdminRoutes: pr08FirecrawlAdminRouteContract,
  addedRoutes: pr09AddedRouteContract,
  activityAuditPath: "/activity",
  adminOnlyRoutePolicyKeys: pr09AdminOnlyRoutePolicyKeys,
  fastifyRegistrars: [
    ...pr08TargetContract.fastifyRegistrars,
    {
      exportName: "registerObservabilityMetricsRoutes",
      importSource: "./routes/observability-metrics",
      sourcePath: "apps/bff/src/routes/observability-metrics.ts",
    },
  ].sort((left, right) => left.exportName.localeCompare(right.exportName)),
  webInferenceConsumers: 0,
  escapeHatchPaths: [],
  activityPageAvailable: true,
  globalNavigationOwner: "PR-11",
  nativeExpertLinksEnabled: false,
  sourceOnly: true,
  runtimeQualified: false,
}

export const pr10TargetContract = {
  findingEntriesDueByPr10: 0,
  remainingFindingEntries: pr09TargetContract.remainingFindingEntries,
  fs105BuilderHubTombstones: pr09TargetContract.fs105BuilderHubTombstones,
  legacyRoutes: 0,
  routes: pr09TargetContract.routes,
  routeClassifications: pr09TargetContract.routeClassifications,
  publicInferenceRoutes: pr09TargetContract.publicInferenceRoutes,
  publicFirecrawlRoutes: pr09TargetContract.publicFirecrawlRoutes,
  firecrawlAdminRoutes: pr09TargetContract.firecrawlAdminRoutes,
  addedRoutes: [],
  activityAuditPath: pr09TargetContract.activityAuditPath,
  adminOnlyRoutePolicyKeys: pr09TargetContract.adminOnlyRoutePolicyKeys,
  fastifyRegistrars: pr09TargetContract.fastifyRegistrars,
  webInferenceConsumers: 0,
  escapeHatchPaths: [],
  activityPageAvailable: true,
  globalNavigationOwner: "PR-11",
  nativeExpertLinksEnabled: false,
  sourceOnly: true,
  runtimeQualified: false,
  configuredRuntimeAdapters: 0,
  lifecycleRoutes: 0,
}

export const pr10cTargetContract = {
  findingEntriesDueByPr10c: 0,
  remainingFindingEntries: pr10TargetContract.remainingFindingEntries,
  fs105BuilderHubTombstones: pr10TargetContract.fs105BuilderHubTombstones,
  legacyRoutes: 0,
  routes: pr10TargetContract.routes + pr10cAddedRouteContract.length,
  routeClassifications: {
    ...pr10TargetContract.routeClassifications,
    "current-console-seam":
      pr10TargetContract.routeClassifications["current-console-seam"] +
      pr10cAddedRouteContract.length,
  },
  publicInferenceRoutes: pr10TargetContract.publicInferenceRoutes,
  publicFirecrawlRoutes: pr10TargetContract.publicFirecrawlRoutes,
  addedRoutes: pr10cAddedRouteContract,
  adminOnlyRoutePolicyKeys: pr10cAdminOnlyRoutePolicyKeys,
  fastifyRegistrars: pr10TargetContract.fastifyRegistrars,
  routeFingerprintTransitions: pr10cRouteFingerprintTransitions,
  webInferenceConsumers: 0,
  escapeHatchPaths: [],
  sourceOnly: true,
  runtimeQualified: false,
  isolationRoutes: 3,
  productionFirewallBindings: 0,
  liveQualificationOwner: "PR-12",
  vendorMaintenanceAccessOwner: "PR-10D",
}

export const pr11TargetContract = {
  ...pr10cTargetContract,
  findingEntriesDueByPr11: 0,
  environmentTemplateCleanup: {
    path: ".env.example",
    allowedTransition: "delete-exact-retired-model-update-block-only",
    addedLines: 0,
    otherEnvironmentPaths: 0,
  },
  routes: pr10cTargetContract.routes - pr11RemovedRouteContract.length,
  routeClassifications: {
    ...pr10cTargetContract.routeClassifications,
    "current-console-seam":
      pr10cTargetContract.routeClassifications["current-console-seam"] -
      pr11RemovedRouteContract.length,
  },
  routeFingerprintTransitions: [
    ...pr10cTargetContract.routeFingerprintTransitions,
    ...pr11RouteFingerprintTransitions,
  ],
  removedRoutesByPr11: pr11RemovedRouteContract,
  logicalSurfaces: pr11LogicalSurfaceContract,
  settingsMutationPersistence: {
    productionPersistence: "postgresql-required",
    fixtureMemoryOnly: true,
    atomicSettingsReceiptAudit: true,
    sharedTransactionAuditWriter: true,
    unavailableWithoutPersistence: true,
    freshDatabaseTelemetryPreviewDefault: "schema-valid",
    productionTelemetryPreviewParsing: "strict-no-fallback",
  },
  webContentSecurityPolicy: {
    perRequestScriptNonce: true,
    requestResponsePolicyMatch: true,
    productionUnsafeInlineScript: false,
    productionUnsafeEval: false,
  },
  rootSurface: "overview",
  activityAuditPath: "/activity",
  combinedApplicationCapabilities: ["inference", "firecrawl"],
  applicationCredentialNamespaces: ["inference", "firecrawl"],
  expertPreviews: pr11ExpertPreviewContract,
  nativeExpertLinksEnabled: false,
  portainerInProductNavigation: false,
  agenticProductSurface: false,
  sourceOnly: true,
  runtimeQualified: false,
}

export const pr08QueryFreeLoggingFingerprints = [
  {
    symbol: "logQueryFreeIncomingRequest",
    sha256: "87795b8fbca2642a692bd2e18840a6782c1be51bca3c5dca2ccf886901bd556e",
  },
  {
    symbol: "logQueryFreeCompletedRequest",
    sha256: "299ecf5e9e910a8be07cb3befcb76f789022a559da58553716defe89fd4b1967",
  },
  {
    symbol: "queryFreeRequestLogSerializer",
    sha256: "57fefc44f7e1f28fc627704a8e1678cd6170dab822250a2bd8a065809e57a5e4",
  },
  {
    symbol: "requestPathname",
    sha256: "ed6f6ab093136d99df160312ebfa95bf3c0e726339e1602c18330bfbe4ae5f9c",
  },
]

const routeMethods = [
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "options",
  "head",
]
const unsupportedFastifyMethods = new Set([
  "addHttpMethod",
  "all",
  "register",
  "setErrorHandler",
  "setNotFoundHandler",
])
const controlledFastifyMethods = new Set([
  "addContentTypeParser",
  "addHook",
  "hasContentTypeParser",
])
const reviewedAdminRouteCapabilities = new Set([
  "activity_audit.export",
  "applications.create_delete",
  "applications.credentials.test_rotate_revoke",
  "applications.disable",
  "applications.policy.change",
  "applications.reenable",
  "console.operational.view",
  "firecrawl.enable_reenable",
  "team.identity.view",
  "team.local_password.manage",
  "team.users_roles.manage",
  "updates.apply",
])
const routeReceiverNamePattern = /^(?:api|app|fastify|router|server)$/i
const bffProductionSourcePattern =
  /^(?:apps\/bff|packages\/(?:contracts|copy)\/src)\/.*\.(?:cjs|cts|js|jsx|mjs|mts|ts|tsx)$/
const productionSurfaceTestPathPattern =
  /(?:^|\/)(?:__tests__|test-fixtures)(?:\/|$)|\.(?:e2e\.)?(?:test|spec)\.[^/]+$|\.d\.(?:cts|mts|ts)$/
const reviewedFastifyRegistrarSpecs = [
  {
    exportName: "registerAuthorization",
    importSource: "./auth/authorization",
    optionsInitializer: null,
    optionsParameterType: "AuthorizationOptions",
    sourcePath: "apps/bff/src/auth/authorization.ts",
  },
  {
    exportName: "registerOpenAICompatibleRoutes",
    importSource: "./routes/openai-compatible",
    sourcePath: "apps/bff/src/routes/openai-compatible.ts",
  },
  {
    exportName: "registerAppGatewayRoutes",
    importSource: "./routes/app-gateway",
    optionsInitializer: "{}",
    optionsParameterType: "AppGatewayRouteOptions",
    sourcePath: "apps/bff/src/routes/app-gateway.ts",
  },
  {
    exportName: "registerFirecrawlGatewayRoutes",
    importSource: "./routes/firecrawl-gateway",
    optionsInitializer: "{}",
    optionsParameterType: "FirecrawlGatewayRouteOptions",
    sourcePath: "apps/bff/src/routes/firecrawl-gateway.ts",
  },
  {
    exportName: "registerObservabilityMetricsRoutes",
    importSource: "./routes/observability-metrics",
    optionsInitializer: "{}",
    optionsParameterType: "ObservabilityMetricsRouteOptions",
    sourcePath: "apps/bff/src/routes/observability-metrics.ts",
  },
  {
    exportName: "registerConsoleSessionRoutes",
    importSource: "./routes/console-session",
    optionsInitializer: null,
    optionsParameterType: "ConsoleSessionRouteOptions",
    sourcePath: "apps/bff/src/routes/console-session.ts",
  },
  {
    exportName: "registerAdminRoutes",
    importSource: "./routes/admin",
    optionsInitializer:
      "{emergencyIsolationService:null,emergencyRecoveryService:null,}",
    optionsParameterType: "AdminRouteOptions",
    sourcePath: "apps/bff/src/routes/admin.ts",
  },
  {
    exportName: "registerKnowledgeRoutes",
    importSource: "./routes/knowledge",
    sourcePath: "apps/bff/src/routes/knowledge.ts",
  },
  {
    exportName: "registerAgenticRuntimeRoutes",
    importSource: "./routes/agentic-runtime",
    sourcePath: "apps/bff/src/routes/agentic-runtime.ts",
  },
  {
    exportName: "registerMcpGatewayRoutes",
    importSource: "./routes/mcp-gateway",
    sourcePath: "apps/bff/src/routes/mcp-gateway.ts",
  },
  {
    exportName: "registerHubRoutes",
    importSource: "./routes/hub",
    sourcePath: "apps/bff/src/routes/hub.ts",
  },
  {
    exportName: "registerBuilderRoutes",
    importSource: "./routes/builder",
    sourcePath: "apps/bff/src/routes/builder.ts",
  },
]
const reviewedFastifySourcePaths = new Set([
  "apps/bff/src/index.ts",
  ...reviewedFastifyRegistrarSpecs.map(({ sourcePath }) => sourcePath),
])
const webInferenceEndpointPattern =
  /\/(?:v1\/)?(?:chat\/completions|responses)(?:$|[/?#])/i
const ambiguousStaticStringCandidates = Symbol(
  "ambiguousStaticStringCandidates",
)
const strictUtf8Decoder = new TextDecoder("utf-8", { fatal: true })
const binaryPathPattern =
  /\.(?:avif|bmp|eot|gif|gz|ico|jpe?g|otf|pdf|png|tar|tgz|ttf|webp|woff2?|zip)$/i

export const targetRouteContract = {
  requiredPublicInference: [
    {
      method: "GET",
      path: "/api/app-gateway/v1/models",
    },
    {
      method: "POST",
      path: "/api/app-gateway/v1/chat/completions",
    },
  ],
  requiredPrivateOperational: [
    { method: "GET", path: "/livez" },
    { method: "GET", path: "/healthz" },
    { method: "GET", path: "/readyz" },
    { method: "GET", path: "/internal/observability/metrics" },
  ],
  futureFirecrawl: [
    {
      method: "POST",
      path: "/v2/search",
    },
    {
      method: "POST",
      path: "/v2/scrape",
    },
  ],
  consoleLogicalSurfaces: [
    "overview",
    "applications",
    "inference",
    "hardware",
    "team",
    "activity-audit",
    "settings",
  ],
  activityAuditPath: "/activity",
}

const resolverFingerprintSpecs = [
  {
    enabledWhenPath: "apps/bff/src/auth/runtime-live-authority.ts",
    path: "apps/bff/src/auth/authorization.ts",
    symbol: "<file>",
  },
  {
    enabledWhenPath: "apps/bff/src/auth/runtime-live-authority.ts",
    path: "apps/bff/src/auth/runtime-live-authority.ts",
    symbol: "<file>",
  },
  {
    enabledWhenPath: "apps/bff/src/auth/runtime-live-authority.ts",
    path: "apps/bff/src/index.ts",
    symbol: "<file>",
  },
  {
    path: "apps/web/next.config.ts",
    symbol: "<file>",
  },
  {
    enabledWhenPath: "apps/web/src/lib/auth/auth.ts",
    path: "apps/web/src/lib/auth/auth.ts",
    symbol: "<file>",
  },
  {
    enabledWhenPath: "apps/web/src/lib/auth/session-client.ts",
    path: "apps/web/src/lib/auth/session-client.ts",
    symbol: "<file>",
  },
  {
    enabledWhenPath: "apps/web/src/lib/auth/session.ts",
    path: "apps/web/src/lib/auth/session.ts",
    symbol: "<file>",
  },
]

const reviewedPr03ResolverFingerprints = [
  {
    path: "apps/web/next.config.ts",
    symbol: "<file>",
    sha256: "58f841f6ee4170e90c110e33727d85dabe6a2c096784b05940319d770a958f8b",
  },
  {
    path: "apps/web/src/lib/auth/auth.ts",
    symbol: "<file>",
    sha256: "563d3d5cb84e563e20fcad08dc88eac00e71136d25fc5df3c043fc0eb26016c7",
  },
]

const reviewedPr03WebAuthenticationEvidence = [
  {
    path: "apps/web/src/middleware.test.ts",
    sha256: "8fdc4be4e1ef7d286eaa7985a924c5490a3377c3d555dbab9047a1fed38341f7",
  },
  {
    path: "apps/web/src/middleware.ts",
    sha256: "c1e5c03f612872ad05ed6ddc14b52bc61e3c0dd2864b3f58235c3478872fa661",
  },
]

export const reviewedPr04WebAuthenticationEvidence = [
  {
    path: "apps/web/src/middleware.test.ts",
    sha256: "a5071e50a05af74d69455c99a776acad2c55ee8c5b1d907d71f0bc18e3ff7b91",
  },
  {
    path: "apps/web/src/middleware.ts",
    sha256: "c1e5c03f612872ad05ed6ddc14b52bc61e3c0dd2864b3f58235c3478872fa661",
  },
]

export const reviewedPr05ResolverFingerprints = [
  {
    path: "apps/bff/src/auth/authorization.ts",
    symbol: "<file>",
    sha256: "003776367928a1bebcc77b2f181393eb63eb6651dcaa4085135a3da11b557470",
  },
  {
    path: "apps/bff/src/auth/runtime-live-authority.ts",
    symbol: "<file>",
    sha256: "0ca02d54900a9f645b0abad5269164fbdf97affd2d3f67126d7c5fa158169799",
  },
  {
    path: "apps/bff/src/index.ts",
    symbol: "<file>",
    sha256: "cc35892e495e0701a4b55bd4c77a009762f8d7b92068a1e3741adf100e95a4e4",
  },
  {
    path: "apps/web/next.config.ts",
    symbol: "<file>",
    sha256: "58f841f6ee4170e90c110e33727d85dabe6a2c096784b05940319d770a958f8b",
  },
  {
    path: "apps/web/src/lib/auth/auth.ts",
    symbol: "<file>",
    sha256: "142c783a7ab90c05a56bad8c2283f8cb4b900cc9eb7b32624697bc71f4ff8b66",
  },
]

export const reviewedPr06ResolverFingerprints =
  reviewedPr05ResolverFingerprints.map((fingerprint) => ({
    ...fingerprint,
    sha256:
      fingerprint.path === "apps/bff/src/index.ts"
        ? "86e9f1722a5fef97f64aadd09b61eb51cc4f028a54c91595e6d633bc5273c475"
        : fingerprint.sha256,
  }))

export const reviewedPr09ResolverFingerprints =
  reviewedPr06ResolverFingerprints.map((fingerprint) => ({
    ...fingerprint,
    sha256:
      fingerprint.path === "apps/bff/src/index.ts"
        ? "34861ad68b99b3ff2eb927daa76b8b9157a62e5841365e456c4335a168c34293"
        : fingerprint.sha256,
  }))

export const reviewedPr09SourceFingerprints = [
  [
    "apps/bff/src/services/audit.ts",
    "nativeAuditActions",
    "6c0bb9bc896cdd685532e9d73d8bddda67d57c2b844d42255d0efcbfd07d9981",
  ],
  [
    "apps/bff/src/services/audit.ts",
    "nativeAuditRecoveryReasonCodes",
    "b35b0e11671e71fff66f90d0808a7853a8565a66cf57b7e607f07e402d7c35c3",
  ],
  [
    "apps/bff/src/services/audit.ts",
    "parseAuditEventInput",
    "5d423079e238e3fc00bdf4d487023da33f3db04722aa56c768d912e35d4a3595",
  ],
  [
    "apps/bff/src/services/audit.ts",
    "auditEventValues",
    "7ed6cd673e2a195d6fdff463afb9bf3133a10a7e0b4298880f7e75636789da78",
  ],
  [
    "apps/bff/src/services/audit.ts",
    "toAuditEventRecord",
    "feb629ba383c7cb8ebf2af4fbe1b09d297fc1abc0007c0902a578f7cfc05bf87",
  ],
  [
    "apps/bff/src/services/audit.ts",
    "auditEventInputKeys",
    "0c4dfa73fdd8f1385e6c1c64fb72ff6190c0dbc4c650c165dad443bba9aeb351",
  ],
  [
    "apps/bff/src/services/audit.ts",
    "NATIVE_PROVIDER_TOKEN_SHAPED_IDENTIFIER_PATTERN",
    "b5a3d5775c58f4dafb111406097037938fa48b868506184b3b17fceea810cfb2",
  ],
  [
    "apps/bff/src/services/audit.ts",
    "assertNativeIdentifier",
    "20c960d730ae046cf42fea581487134d5c77f1ba99c76f1a25d24c0d8c8059ab",
  ],
  [
    "apps/bff/src/services/audit.ts",
    "getDatabaseAuditEvents",
    "1b0a535a3c3ad3ce5d3085f42fab690949538c265c55b7f166bca10d20b0299a",
  ],
  [
    "apps/bff/src/services/audit.ts",
    "getDatabaseAuditEventsAscending",
    "6c7ef6768f7b77080d93ab4ddec52432000f6bd868634dc392cc78d5f0a0d08d",
  ],
  [
    "apps/bff/src/services/audit.ts",
    "databaseAuditConditions",
    "b99221a5d32c0b9d4327fa2de1070e9651c7c86c5e5759e2e8598ea181541763",
  ],
  [
    "apps/bff/src/services/audit.ts",
    "encodeAuditCursor",
    "d2e10caab5375187322b9169e32874befe4f4eb0b0cb6625767a5157ebc069f9",
  ],
  [
    "apps/bff/src/services/audit.ts",
    "decodeAuditCursor",
    "03e1c5c1c704ee628107721f0afd0e9b6c3cb62d05460d03527084dadd9d6e86",
  ],
  [
    "apps/bff/src/services/audit-ingestion.ts",
    "ingestOneSource",
    "60a4d795803f69db74ed1f662199d883eefc218566f8535ea3aed2f03641bf4c",
  ],
  [
    "apps/bff/src/services/audit-ingestion.ts",
    "recordSourceFailure",
    "bcbeb418be3b57abd166a6a97c80a541bd2810cc7b2f89487b77071236de6cd4",
  ],
  [
    "apps/bff/src/services/audit-ingestion.ts",
    "validateNativeAuditSourceBatch",
    "f2518c2a350122ea67a4a3a8fb1bdde1ab0952d173aef0cbc7e1306fac8063b1",
  ],
  [
    "apps/bff/src/services/audit-ingestion.ts",
    "canonicalNativeEventId",
    "142a8ad38d914bb1726bb19bf985219dda306c4a9044fa8a814bc490816b3fe1",
  ],
  [
    "apps/bff/src/services/audit-ingestion.ts",
    "sameStoredNativeAuditEvent",
    "28dbc64af9caec02bdfea706c61140d0de24bdc3719b52177e3522c052e5249b",
  ],
  [
    "apps/bff/src/services/audit-ingestion.ts",
    "storedCursor",
    "8e95fa7f5819fc09a11361ae94dd37cb8bb3be2d0d67ea193d84f1eb61f444a3",
  ],
  [
    "apps/bff/src/services/audit-ingestion.ts",
    "compareCanonicalCursors",
    "9baa751d128a371fc84861ce45306a0b5b18817dbed91b27c50d18fc4e4ceb6d",
  ],
  [
    "apps/bff/src/services/audit-export.ts",
    "canonicalExportEvent",
    "3584a43adf5cfc009134c298551eb3a880970798477565d58ee153b6cab22514",
  ],
  [
    "apps/bff/src/services/audit-export.ts",
    "csvExport",
    "9de905ddc40c0f6015360e30b9292d94cde4b3b1a5cdc12101fd97fd6ef9a6f5",
  ],
  [
    "apps/bff/src/services/admin-alert-egress.ts",
    "updateAdminAlertEgress",
    "4da64ffd2a555f05a481e3cf21571ccfd3e4d961d8c68e53e38bc52249a4cb82",
  ],
  [
    "apps/bff/src/routes/admin.ts",
    "withAdminIdempotentMutation",
    "7c9339373a79d23afe641ca694b28e9c0bf8ba1f7f9873e254012d0c33b2c6e7",
  ],
  [
    "apps/bff/src/services/idempotency.ts",
    "completeIdempotency",
    "594f42252426ffd8a9b26fbb1520976bc99c7be9820096caf39e1c96ed198dc3",
  ],
  [
    "apps/bff/src/db/inference-core-schema.ts",
    "auditEvents",
    "4c8924f39a8bf86bdb7c6335ad4475cff48fc5b7550b80c15509f955b2246c52",
  ],
].map(([path, symbol, sha256]) => ({ path, symbol, sha256 }))

export const reviewedPr09NativeIdentifierEvidence = [
  {
    path: "apps/bff/src/services/audit.ts",
    sha256: "a4b06232244c09d0e6db38faab162cfc56d45e83466fbd6107a9233b4612aefc",
  },
  {
    path: "apps/bff/src/db/inference-core-schema.ts",
    sha256: "16fc48c5bff4fb2f63dd816de44365b70bab6d42fbedd5e9d090c6a4089c2995",
  },
  {
    path: "infra/migrations/0000_inference_core.sql",
    sha256: "b71b11531d671d26130c55f533f33e802aa2555d5f913fd56a26cc1cfb6448ff",
  },
  {
    path: "apps/bff/src/services/audit.test.ts",
    sha256: "21d0cc54565cbdd2469842eca493a3165833bd225a294afd249a0a88a5091c4d",
  },
  {
    path: "test-support/inference-core-db-tests/src/pr09-audit-ingestion.test.ts",
    sha256: "209db6339f4cee48e25a01849e5fad1ffcf48df3e8269d7cdc1de963c220af85",
  },
]

export const reviewedPr05WebAuthenticationEvidence = [
  {
    path: "apps/web/src/middleware.test.ts",
    sha256: "40e62e44aaddcbc2a3a6f5f2602751405e3c5dc23244ee218fb9cedaa257aec5",
  },
  {
    path: "apps/web/src/middleware.ts",
    sha256: "c31e5f8b645586166ad3e1a829adb4384a96e80cd218b26be61574b61117fc84",
  },
]

export const reviewedPr09WebAuthenticationEvidence = [
  {
    path: "apps/web/src/middleware.test.ts",
    sha256: "635f7c7c3ec01318170ec785546b4e05db0cb7e0f63e452e327e84ede1c51867",
  },
  {
    path: "apps/web/src/middleware.ts",
    sha256: "c3ffb281c0dd538123fb476bc36c682c50693f9c06f637fc92627ec56fa9b0a9",
  },
]

const reviewedPr03WebMiddlewareMatcher =
  "/((?!api|_next/static|_next/image|apple-touch-icon.png|favicon.ico|favicon-16x16.png|favicon-32x32.png|favicon-48x48.png|icon.svg).*)"

const legacyEscapeHatchSpecs = []

export function listCandidatePaths(root = repositoryRoot) {
  const cachedEntries = listCachedEntries(root)
  for (const entry of cachedEntries) {
    if (!["100644", "100755"].includes(entry.mode)) {
      const kind = entry.mode === "160000" ? "gitlink" : "cached Git mode"
      throw new Error(`Unsupported ${kind} ${entry.mode} at ${entry.path}`)
    }
    const absolutePath = resolve(root, entry.path)
    if (!existsSync(absolutePath) || !lstatSync(absolutePath).isFile()) {
      throw new Error(
        `Cached path is missing or not a regular file ${entry.path}; stage its deletion before verification`,
      )
    }
  }
  assertCachedEntryIntegrity(root, cachedEntries)

  const untrackedOutput = execFileSync(
    "git",
    ["ls-files", "-z", "--others", "--exclude-standard"],
    {
      cwd: root,
      encoding: "buffer",
    },
  )
  const paths = [
    ...cachedEntries.map(({ path }) => path),
    ...untrackedOutput.toString("utf8").split("\0").filter(Boolean),
  ]

  return [...new Set(paths)].sort()
}

function listCachedEntries(root) {
  const output = execFileSync("git", ["ls-files", "--stage", "-z"], {
    cwd: root,
    encoding: "buffer",
  })
  return output
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map((record) => {
      const separator = record.indexOf("\t")
      if (separator < 0) {
        throw new Error("Malformed cached Git entry")
      }
      const [mode, objectId, stage] = record.slice(0, separator).split(" ")
      const path = record.slice(separator + 1)
      if (
        !mode ||
        !/^[0-9a-f]{40,64}$/.test(objectId ?? "") ||
        stage !== "0" ||
        path.length === 0
      ) {
        throw new Error(`Unsupported cached Git entry ${path || "<unknown>"}`)
      }
      return { mode, objectId, path }
    })
}

function assertCachedEntryIntegrity(root, entries) {
  if (entries.length === 0) {
    return
  }
  const objectChecks = execFileSync(
    "git",
    ["cat-file", "--batch-check=%(objectname) %(objecttype)"],
    {
      cwd: root,
      encoding: "utf8",
      input: `${entries.map(({ objectId }) => objectId).join("\n")}\n`,
    },
  )
    .trimEnd()
    .split("\n")
  if (objectChecks.length !== entries.length) {
    throw new Error("Cached Git object verification returned an invalid result")
  }
  if (entries.some(({ path }) => /[\r\n]/.test(path))) {
    throw new Error(
      "Cached Git paths containing line breaks are unsupported by integrity verification",
    )
  }
  const worktreeObjectIds = execFileSync(
    "git",
    ["hash-object", "--no-filters", "--stdin-paths"],
    {
      cwd: root,
      encoding: "utf8",
      input: `${entries.map(({ path }) => path).join("\n")}\n`,
    },
  )
    .trimEnd()
    .split("\n")
  if (worktreeObjectIds.length !== entries.length) {
    throw new Error(
      "Worktree Git object verification returned an invalid result",
    )
  }

  for (const [index, entry] of entries.entries()) {
    const [objectId, objectType] = objectChecks[index]?.split(" ") ?? []
    if (objectId !== entry.objectId || objectType !== "blob") {
      throw new Error(
        `Cached Git object is missing or not a blob ${entry.objectId} at ${entry.path}`,
      )
    }
    const absolutePath = resolve(root, entry.path)
    const worktreeMode =
      statSync(absolutePath).mode & 0o111 ? "100755" : "100644"
    if (
      worktreeObjectIds[index] !== entry.objectId ||
      worktreeMode !== entry.mode
    ) {
      throw new Error(
        `Cached content differs from the worktree at ${entry.path}; stage the current worktree before verification`,
      )
    }
  }
}

export function scanForbiddenSurfaces({
  root = repositoryRoot,
  paths = listCandidatePaths(root),
} = {}) {
  const findings = []
  const frozenPaths = new Set()

  for (const rule of pathRules) {
    for (const path of paths) {
      if (isGuardrailPath(path) || !rule.pattern.test(path)) {
        continue
      }
      const absolutePath = resolve(root, path)
      if (!isRegularFile(absolutePath)) {
        continue
      }
      frozenPaths.add(path)
      findings.push({
        ruleId: rule.id,
        path,
        count: 1,
        fingerprints: { [sha256(readFileSync(absolutePath))]: 1 },
        removeBy: rule.removeBy,
      })
    }
  }

  for (const rule of contentRules) {
    for (const path of paths) {
      if (frozenPaths.has(path) || !isContentScanPath(path)) {
        continue
      }
      const absolutePath = resolve(root, path)
      if (!isRegularFile(absolutePath)) {
        continue
      }
      const bytes = readFileSync(absolutePath)
      let source
      try {
        source = strictUtf8Decoder.decode(bytes)
      } catch {
        if (binaryPathPattern.test(path)) {
          continue
        }
        throw new Error(`Invalid UTF-8 in tracked content candidate ${path}`)
      }
      const fingerprints = filterIgnoredFindingFingerprints(
        rule,
        path,
        source,
        matchFingerprints(rule, source),
      )
      if (Object.keys(fingerprints).length === 0) {
        continue
      }
      findings.push({
        ruleId: rule.id,
        path,
        count: Object.values(fingerprints).reduce(
          (total, count) => total + count,
          0,
        ),
        fingerprints,
        removeBy: findingDisposition(rule, path),
      })
    }
  }

  return findings.sort(compareFindingKeys)
}

function findingDisposition(rule, path) {
  return (
    findingDispositionOverrides.find(
      (override) => override.ruleId === rule.id && override.path === path,
    )?.removeBy ?? rule.removeBy
  )
}

function filterIgnoredFindingFingerprints(rule, path, source, fingerprints) {
  const ignored = new Set(
    [...ignoredFindingFingerprints, ...pr08IgnoredFindingFingerprints]
      .filter((entry) => entry.ruleId === rule.id && entry.path === path)
      .map(({ fingerprint }) => fingerprint),
  )
  const retiredDependencyBoundary = pr04RetiredDependencyBoundaries.find(
    (boundary) => boundary.path === path,
  )
  if (
    rule.id === "FS107_RETIRED_DATA_DEPENDENCY" &&
    retiredDependencyBoundary
  ) {
    for (const fingerprint of structurallyAllowedPnpmLockFingerprints(
      rule,
      source,
      retiredDependencyBoundary,
    )) {
      ignored.add(fingerprint)
    }
  }
  return Object.fromEntries(
    Object.entries(fingerprints).filter(
      ([fingerprint]) => !ignored.has(fingerprint),
    ),
  )
}

function structurallyAllowedPnpmLockFingerprints(rule, source, boundary) {
  const analysis = analyzePnpmLockRedisBoundary(source, boundary)
  if (analysis.errors.length > 0) {
    return []
  }
  const fingerprints = new Set()
  for (const entry of analysis.allowedEntries) {
    for (const fingerprint of Object.keys(matchFingerprints(rule, entry.raw))) {
      fingerprints.add(fingerprint)
    }
  }
  return fingerprints
}

export function verifyRetiredDataDependencyBoundary(
  root = repositoryRoot,
  paths = listCandidatePaths(root),
) {
  const errors = []
  const lockfilePath = pr04RetiredDependencyBoundary.path
  const absoluteLockfilePath = resolve(root, lockfilePath)
  if (!paths.includes(lockfilePath) || !isRegularFile(absoluteLockfilePath)) {
    errors.push(`missing reviewed dependency lockfile ${lockfilePath}`)
  } else {
    errors.push(
      ...analyzePnpmLockRedisBoundary(
        readFileSync(absoluteLockfilePath, "utf8"),
      ).errors,
    )
  }

  for (const path of paths.filter(
    (candidate) =>
      /^(?:package\.json|(?:apps|packages)\/[^/]+\/package\.json)$/.test(
        candidate,
      ) && isRegularFile(resolve(root, candidate)),
  )) {
    const manifest = readJson(resolve(root, path))
    for (const field of [
      "dependencies",
      "devDependencies",
      "optionalDependencies",
      "peerDependencies",
    ]) {
      for (const dependency of Object.keys(manifest[field] ?? {})) {
        if (isRetiredDataDependencyPackage(dependency)) {
          errors.push(
            `retired active dependency ${dependency} in ${path} ${field}`,
          )
        }
      }
    }
  }

  return errors.sort()
}

function analyzePnpmLockRedisBoundary(
  source,
  boundary = pr04RetiredDependencyBoundary,
) {
  const entries = parsePnpmLockMappingEntries(source)
  const redisEntries = entries.filter((entry) => /redis/i.test(entry.key))
  const expectedPeerPath = [
    "packages",
    boundary.package,
    "peerDependencies",
    boundary.dependency,
  ]
  const expectedMetaPath = [
    "packages",
    boundary.package,
    "peerDependenciesMeta",
    boundary.dependency,
  ]
  const expectedOptionalPath = [...expectedMetaPath, "optional"]
  const peerEntry = entries.find((entry) =>
    sameStringArray(entry.path, expectedPeerPath),
  )
  const metaEntry = entries.find((entry) =>
    sameStringArray(entry.path, expectedMetaPath),
  )
  const optionalEntry = entries.find((entry) =>
    sameStringArray(entry.path, expectedOptionalPath),
  )
  const errors = []

  if (redisEntries.length !== boundary.requiredOccurrences) {
    errors.push(
      `invalid ${boundary.dependency} lockfile occurrence count expected=${boundary.requiredOccurrences} actual=${redisEntries.length}`,
    )
  }
  if (!peerEntry || unquoteYamlScalar(peerEntry.value) !== boundary.peerRange) {
    errors.push(`missing reviewed optional peer range ${boundary.dependency}`)
  }
  if (!metaEntry || metaEntry.value !== "") {
    errors.push(
      `missing reviewed optional peer metadata ${boundary.dependency}`,
    )
  }
  if (optionalEntry?.value !== "true") {
    errors.push(`optional peer metadata is not true ${boundary.dependency}`)
  }
  const expectedRedisPaths = new Set([
    JSON.stringify(expectedPeerPath),
    JSON.stringify(expectedMetaPath),
  ])
  for (const entry of redisEntries) {
    if (!expectedRedisPaths.has(JSON.stringify(entry.path))) {
      errors.push(
        `active or unreviewed Redis lockfile edge ${entry.path.join(" > ")}`,
      )
    }
  }

  return {
    allowedEntries:
      errors.length === 0 && peerEntry && metaEntry
        ? [peerEntry, metaEntry]
        : [],
    errors: [...new Set(errors)].sort(),
  }
}

export function analyzeRootPgliteBoundary(source) {
  const { rootIsolation } = pr04StandaloneDbTestBoundary
  const entries = parsePnpmLockMappingEntries(source)
  const pgliteEntries = entries.filter((entry) =>
    entry.raw.toLowerCase().includes(rootIsolation.pglitePackage),
  )
  const expectedPeerPath = [
    "packages",
    rootIsolation.drizzlePackage,
    "peerDependencies",
    rootIsolation.pglitePackage,
  ]
  const expectedMetaPath = [
    "packages",
    rootIsolation.drizzlePackage,
    "peerDependenciesMeta",
    rootIsolation.pglitePackage,
  ]
  const expectedOptionalPath = [...expectedMetaPath, "optional"]
  const peerEntry = entries.find((entry) =>
    sameStringArray(entry.path, expectedPeerPath),
  )
  const metaEntry = entries.find((entry) =>
    sameStringArray(entry.path, expectedMetaPath),
  )
  const optionalEntry = entries.find((entry) =>
    sameStringArray(entry.path, expectedOptionalPath),
  )
  const errors = []

  if (pgliteEntries.length !== rootIsolation.allowedRootMetadataOccurrences) {
    errors.push(
      `invalid ${rootIsolation.pglitePackage} root lock occurrence count expected=${rootIsolation.allowedRootMetadataOccurrences} actual=${pgliteEntries.length}`,
    )
  }
  if (
    !peerEntry ||
    unquoteYamlScalar(peerEntry.value) !== rootIsolation.pglitePeerRange
  ) {
    errors.push(
      `missing reviewed optional peer range ${rootIsolation.pglitePackage} in root lock`,
    )
  }
  if (!metaEntry || metaEntry.value !== "") {
    errors.push(
      `missing reviewed optional peer metadata ${rootIsolation.pglitePackage} in root lock`,
    )
  }
  if (optionalEntry?.value !== "true") {
    errors.push(
      `optional peer metadata is not true ${rootIsolation.pglitePackage} in root lock`,
    )
  }
  const expectedPglitePaths = new Set([
    JSON.stringify(expectedPeerPath),
    JSON.stringify(expectedMetaPath),
  ])
  for (const entry of pgliteEntries) {
    if (!expectedPglitePaths.has(JSON.stringify(entry.path))) {
      errors.push(
        `active or resolved PGlite root lock edge ${entry.path.join(" > ")}`,
      )
    }
  }

  return [...new Set(errors)].sort()
}

export function verifyStandaloneDbTestBoundary(
  root = repositoryRoot,
  paths = listCandidatePaths(root),
  boundary = pr04StandaloneDbTestBoundary,
) {
  const errors = []
  const actualPaths = paths
    .filter(
      (path) => path === boundary.path || path.startsWith(`${boundary.path}/`),
    )
    .sort()
  const expectedPaths = [...boundary.allowedPaths].sort()
  if (JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)) {
    errors.push(
      `standalone DB test workspace paths changed expected=${expectedPaths.join(",")} actual=${actualPaths.join(",")}`,
    )
  }

  for (const evidence of [
    boundary.packageManifest,
    boundary.lockfile,
    boundary.workspaceManifest,
    boundary.tsconfig,
  ]) {
    const absolutePath = resolve(root, evidence.path)
    if (!paths.includes(evidence.path) || !isRegularFile(absolutePath)) {
      errors.push(`missing standalone DB test boundary file ${evidence.path}`)
      continue
    }
    const actualSha256 = sha256(readFileSync(absolutePath))
    if (actualSha256 !== evidence.sha256) {
      errors.push(
        `standalone DB test boundary changed ${evidence.path} expected=${evidence.sha256} actual=${actualSha256}`,
      )
    }
  }

  const manifestPath = boundary.packageManifest.path
  if (isRegularFile(resolve(root, manifestPath))) {
    const expectedManifest = {
      name: boundary.packageManifest.name,
      private: true,
      version: "0.0.0",
      type: "module",
      packageManager: boundary.packageManifest.packageManager,
      scripts: boundary.packageManifest.scripts,
      devDependencies: boundary.packageManifest.devDependencies,
    }
    const manifest = readJson(resolve(root, manifestPath))
    if (JSON.stringify(manifest) !== JSON.stringify(expectedManifest)) {
      errors.push("invalid standalone DB test package manifest")
    }
  }

  const nestedLockPath = boundary.lockfile.path
  if (isRegularFile(resolve(root, nestedLockPath))) {
    errors.push(
      ...analyzePnpmLockRedisBoundary(
        readFileSync(resolve(root, nestedLockPath), "utf8"),
        pr04NestedTestRetiredDependencyBoundary,
      ).errors.map((error) => `nested test lock: ${error}`),
    )
  }

  const rootWorkspacePath = boundary.rootIsolation.workspaceManifestPath
  if (isRegularFile(resolve(root, rootWorkspacePath))) {
    const source = readFileSync(
      resolve(root, rootWorkspacePath),
      "utf8",
    ).replaceAll("\r\n", "\n")
    if (source !== "packages:\n  - apps/*\n  - packages/*\n") {
      errors.push("standalone DB tests entered the root pnpm workspace")
    }
  } else {
    errors.push(`missing root workspace manifest ${rootWorkspacePath}`)
  }

  const rootLockPath = boundary.rootIsolation.rootLockfilePath
  if (
    !paths.includes(rootLockPath) ||
    !isRegularFile(resolve(root, rootLockPath))
  ) {
    errors.push(`missing root dependency lockfile ${rootLockPath}`)
  } else {
    errors.push(
      ...analyzeRootPgliteBoundary(
        readFileSync(resolve(root, rootLockPath), "utf8"),
      ),
    )
  }

  const productionManifestPath = boundary.rootIsolation.productionManifestPath
  if (
    !paths.includes(productionManifestPath) ||
    !isRegularFile(resolve(root, productionManifestPath))
  ) {
    errors.push(`missing production manifest ${productionManifestPath}`)
  } else {
    const manifest = readJson(resolve(root, productionManifestPath))
    for (const field of [
      "dependencies",
      "devDependencies",
      "optionalDependencies",
      "peerDependencies",
    ]) {
      for (const [dependency, specifier] of Object.entries(
        manifest[field] ?? {},
      )) {
        if (
          dependency.toLowerCase() === boundary.rootIsolation.pglitePackage ||
          String(specifier)
            .toLowerCase()
            .includes(boundary.rootIsolation.pglitePackage)
        ) {
          errors.push(
            `PGlite dependency is not allowed in ${productionManifestPath} ${field}`,
          )
        }
      }
    }
  }

  return [...new Set(errors)].sort()
}

function parsePnpmLockMappingEntries(source) {
  const entries = []
  const stack = []
  for (const [index, raw] of source
    .replaceAll("\r\n", "\n")
    .split("\n")
    .entries()) {
    if (raw.trim().length === 0 || raw.trimStart().startsWith("#")) {
      continue
    }
    const indent = raw.length - raw.trimStart().length
    const trimmed = raw.trim()
    const separator = trimmed.indexOf(":")
    if (separator <= 0) {
      continue
    }
    const key = unquoteYamlScalar(trimmed.slice(0, separator).trim())
    const value = trimmed.slice(separator + 1).trim()
    while (stack.at(-1)?.indent >= indent) {
      stack.pop()
    }
    const path = [...stack.map((entry) => entry.key), key]
    const entry = { indent, key, line: index + 1, path, raw, value }
    entries.push(entry)
    if (value === "") {
      stack.push(entry)
    }
  }
  return entries
}

function unquoteYamlScalar(value) {
  if (
    value.length >= 2 &&
    ((value.startsWith("'") && value.endsWith("'")) ||
      (value.startsWith('"') && value.endsWith('"')))
  ) {
    return value.slice(1, -1)
  }
  return value
}

function sameStringArray(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function isRetiredDataDependencyPackage(name) {
  return (
    /^(?:ioredis|redis|mongodb|minio|pgvector)$/i.test(name) ||
    /^@upstash\/redis$/i.test(name) ||
    /^@temporalio(?:\/|$)/i.test(name)
  )
}

export function buildForbiddenAllowlist({
  root = repositoryRoot,
  paths = listCandidatePaths(root),
  baseCommit = currentHead(root),
} = {}) {
  return {
    schemaVersion: 1,
    baseCommit,
    policyDigest: forbiddenPolicyDigest(),
    protectedFiles: buildProtectedGuardrailFingerprints(root),
    entries: scanForbiddenSurfaces({ root, paths }),
  }
}

export function buildRouteBaseline({
  root = repositoryRoot,
  paths = listCandidatePaths(root),
  baseCommit = currentHead(root),
} = {}) {
  return {
    schemaVersion: 3,
    baseCommit,
    policyDigest: routePolicyDigest(root),
    target: targetRouteContract,
    routes: [
      ...extractBffRoutes({ root, paths }),
      ...extractWebRoutes({ root, paths }),
    ].sort(compareRoutes),
    fastifyRegistrars: extractFastifyRegistrarManifest({ root, paths }),
    webInferenceConsumers: extractWebInferenceConsumers({ root, paths }),
    sourceClosure: buildProductionSourceClosure({ root, paths }),
    repositoryClosure: buildRepositoryClosure({ root, paths }),
    fingerprints: buildResolverFingerprints(root),
    escapeHatches: buildLegacyEscapeHatches(root, paths),
    reviewedRevisions: buildReviewedRevisionFingerprints(root),
  }
}

export function buildRepositoryClosure({
  root = repositoryRoot,
  paths = listCandidatePaths(root),
} = {}) {
  const cachedByPath = new Map(
    listCachedEntries(root).map((entry) => [entry.path, entry]),
  )
  return paths
    .filter((path) => !generatedContractPaths.has(path))
    .map((path) => {
      const cached = cachedByPath.get(path)
      if (cached) {
        return {
          path,
          mode: cached.mode,
          objectId: cached.objectId,
        }
      }
      const absolutePath = resolve(root, path)
      if (!existsSync(absolutePath) || !lstatSync(absolutePath).isFile()) {
        throw new Error(`Untracked candidate is not a regular file ${path}`)
      }
      return {
        path,
        mode: statSync(absolutePath).mode & 0o111 ? "100755" : "100644",
        objectId: hashWorktreeBlob(root, absolutePath),
      }
    })
    .sort((left, right) => left.path.localeCompare(right.path))
}

export function buildRepositoryClosureFromCommit(root, commit) {
  if (!/^[0-9a-f]{40,64}$/.test(commit)) {
    throw new Error(`Invalid repository-closure commit ${commit}`)
  }
  const output = execFileSync(
    "git",
    ["ls-tree", "-r", "-z", "--full-tree", "--end-of-options", commit],
    {
      cwd: root,
      encoding: "buffer",
    },
  )
  return output
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map((record) => {
      const separator = record.indexOf("\t")
      if (separator < 0) {
        throw new Error("Malformed repository-closure tree entry")
      }
      const [mode, type, objectId] = record.slice(0, separator).split(" ")
      const path = record.slice(separator + 1)
      if (
        !["100644", "100755"].includes(mode ?? "") ||
        type !== "blob" ||
        !/^[0-9a-f]{40,64}$/.test(objectId ?? "") ||
        path.length === 0
      ) {
        throw new Error(`Unsupported repository-closure tree entry ${path}`)
      }
      return { path, mode, objectId }
    })
    .filter(({ path }) => !generatedContractPaths.has(path))
    .sort((left, right) => left.path.localeCompare(right.path))
}

function hashWorktreeBlob(root, absolutePath) {
  const objectId = execFileSync(
    "git",
    ["hash-object", "--no-filters", "--stdin"],
    {
      cwd: root,
      encoding: "utf8",
      input: readFileSync(absolutePath),
    },
  ).trim()
  if (!/^[0-9a-f]{40,64}$/.test(objectId)) {
    throw new Error(`Git returned an invalid worktree object ID ${objectId}`)
  }
  return objectId
}

function buildProductionSourceClosure({ root, paths }) {
  return paths
    .filter(
      (path) =>
        isProductionSurfacePath(path) &&
        !productionSurfaceTestPathPattern.test(path) &&
        isRegularFile(resolve(root, path)),
    )
    .map((path) => ({
      path,
      sha256: sha256(readFileSync(resolve(root, path))),
    }))
    .sort((left, right) => left.path.localeCompare(right.path))
}

function isProductionSurfacePath(path) {
  return (
    /^(?:apps\/(?:bff|web)\/src|apps\/web\/app|apps\/web\/public|packages\/(?:contracts|copy)\/src)\//.test(
      path,
    ) ||
    /^(?:apps\/(?:bff|web)|packages\/(?:contracts|copy))\/[^/]+$/.test(path) ||
    [
      ".dockerignore",
      "package.json",
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
    ].includes(path)
  )
}

export function compareExactFindings(expected, actual) {
  const errors = []
  const expectedByKey = new Map(
    expected.map((entry) => [findingKey(entry), entry]),
  )
  const actualByKey = new Map(actual.map((entry) => [findingKey(entry), entry]))

  for (const [key, entry] of actualByKey) {
    const accepted = expectedByKey.get(key)
    if (!accepted) {
      errors.push(`new finding ${key} count=${entry.count}`)
      continue
    }
    if (JSON.stringify(accepted) !== JSON.stringify(entry)) {
      errors.push(
        `changed finding ${key} expected=${accepted.count} actual=${entry.count}`,
      )
    }
  }

  for (const [key] of expectedByKey) {
    if (!actualByKey.has(key)) {
      errors.push(`stale allowlist entry ${key}`)
    }
  }

  return errors.sort()
}

export function compareForbiddenBaselineMetadata(expected, actual) {
  const errors = []
  const expectedKeys = [
    "baseCommit",
    "entries",
    "policyDigest",
    "protectedFiles",
    "schemaVersion",
  ]
  if (
    JSON.stringify(Object.keys(expected).sort()) !==
      JSON.stringify(expectedKeys) ||
    expected.schemaVersion !== 1 ||
    expected.baseCommit !== pr01BootstrapBase
  ) {
    errors.push("forbidden-surface baseline metadata changed")
  }
  if (expected.policyDigest !== actual.policyDigest) {
    errors.push("forbidden-surface policy digest changed")
  }
  if (
    JSON.stringify(expected.protectedFiles) !==
    JSON.stringify(actual.protectedFiles)
  ) {
    errors.push("protected guardrail files changed")
  }
  return errors
}

export function compareExactRouteBaseline(expected, actual) {
  return JSON.stringify(expected) === JSON.stringify(actual)
    ? []
    : ["route baseline changed"]
}

function readPr11aR1C0ReviewStatus(root) {
  const path = resolve(root, pr11aR1C0DecisionPath)
  if (!isRegularFile(path)) {
    return null
  }
  try {
    const status = readJson(path).reviewStatus
    return [
      "proposed-governance-first",
      "source-candidate-awaiting-independent-review",
      "r1-c0-merged-source-package",
    ].includes(status)
      ? status
      : null
  } catch {
    return null
  }
}

const pr11aR1C0HistoricalPr09SourcePaths = new Set([
  "apps/bff/src/services/expert-capabilities.ts",
])
const pr11aR1C0HistoricalPriorEvidencePaths = new Set([
  "scripts/inference-core/pr02-boundaries.test.mjs",
])

export function readPr09SourceBoundaryText(path, root = repositoryRoot) {
  if (
    [
      "source-candidate-awaiting-independent-review",
      "r1-c0-merged-source-package",
    ].includes(readPr11aR1C0ReviewStatus(root)) &&
    pr11aR1C0HistoricalPr09SourcePaths.has(path)
  ) {
    return readRepositoryPathAtCommit(
      root,
      pr11aR1C0ContractBase,
      path,
    ).toString("utf8")
  }
  const absolutePath = resolve(root, path)
  return isRegularFile(absolutePath) ? readFileSync(absolutePath, "utf8") : null
}

function readPr11aR1C0HistoricalPriorEvidence(root, path) {
  return [
    "source-candidate-awaiting-independent-review",
    "r1-c0-merged-source-package",
  ].includes(readPr11aR1C0ReviewStatus(root)) &&
    pr11aR1C0HistoricalPriorEvidencePaths.has(path)
    ? readRepositoryPathAtCommit(root, pr11aR1C0ContractBase, path)
    : null
}

function listPr11aR1C0SourcePackageChanges(root) {
  const output = execFileSync(
    "git",
    [
      "diff",
      "--name-status",
      "--no-ext-diff",
      "--no-renames",
      "--end-of-options",
      pr11aR1C0ContractBase,
      "--",
    ],
    { cwd: root, encoding: "utf8" },
  ).trim()
  return output === ""
    ? []
    : output
        .split("\n")
        .map((line) => {
          const separator = line.indexOf("\t")
          if (separator < 1) {
            return { path: "", status: "INVALID" }
          }
          return {
            path: line.slice(separator + 1),
            status: line.slice(0, separator),
          }
        })
        .sort((left, right) =>
          left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
        )
}

function comparePr11aR1C0RepositoryClosure(expected, actual, allowedPaths) {
  const errors = []
  const allowed = new Set(allowedPaths)
  const expectedByPath = new Map(expected.map((entry) => [entry.path, entry]))
  const actualByPath = new Map(actual.map((entry) => [entry.path, entry]))
  const allPaths = [
    ...new Set([...expectedByPath.keys(), ...actualByPath.keys()]),
  ]

  for (const path of allPaths.sort()) {
    const before = expectedByPath.get(path)
    const after = actualByPath.get(path)
    if (allowed.has(path)) {
      if (JSON.stringify(before) === JSON.stringify(after)) {
        errors.push(`PR-11A R1-C0 source closure did not change ${path}`)
      }
      continue
    }
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      errors.push(`PR-11A R1-C0 source closure escaped ${path}`)
    }
  }
  return errors
}

function comparePr11aR1C0ProtectedFiles(expected, actual, allowedPaths) {
  const errors = []
  const allowed = new Set(allowedPaths)
  const expectedByPath = new Map(expected.map((entry) => [entry.path, entry]))
  const actualByPath = new Map(actual.map((entry) => [entry.path, entry]))
  const allPaths = [
    ...new Set([...expectedByPath.keys(), ...actualByPath.keys()]),
  ]

  for (const path of allPaths.sort()) {
    const before = expectedByPath.get(path)
    const after = actualByPath.get(path)
    if (allowed.has(path)) {
      if (JSON.stringify(before) === JSON.stringify(after)) {
        errors.push(`PR-11A R1-C0 protected fingerprint did not change ${path}`)
      }
      continue
    }
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      errors.push(`PR-11A R1-C0 protected file escaped ${path}`)
    }
  }
  return errors
}

export function verifyPr11aR1C0SourcePackage({
  root,
  reviewStatus,
  expectedAllowlist,
  actualAllowlist,
  expectedRoutes,
  actualRoutes,
}) {
  const errors = []
  const governanceCheckpoint = reviewStatus === "proposed-governance-first"
  const allowedPaths = governanceCheckpoint
    ? pr11aR1C0GovernanceCheckpointPaths
    : pr11aR1C0SourceCandidatePaths
  const changes = listPr11aR1C0SourcePackageChanges(root)
  const addedPaths = new Set(
    governanceCheckpoint
      ? [
          pr11aR1C0DecisionPath,
          "scripts/inference-core/pr11a-r1-c0-boundaries.test.mjs",
        ]
      : [
          pr11aR1C0DecisionPath,
          "apps/bff/src/services/native-audit-source.test.ts",
          "apps/bff/src/services/native-audit-source.ts",
          "scripts/inference-core/pr11a-r1-c0-boundaries.test.mjs",
        ],
  )
  const deletedPaths = new Set(
    governanceCheckpoint
      ? []
      : [
          "apps/bff/src/services/expert-capabilities.test.ts",
          "apps/bff/src/services/expert-capabilities.ts",
        ],
  )
  const expectedChanges = allowedPaths
    .map((path) => ({
      path,
      status: addedPaths.has(path) ? "A" : deletedPaths.has(path) ? "D" : "M",
    }))
    .sort((left, right) =>
      left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
    )
  if (JSON.stringify(changes) !== JSON.stringify(expectedChanges)) {
    errors.push("PR-11A R1-C0 source package path set changed")
  }

  let decision
  try {
    decision = readJson(resolve(root, pr11aR1C0DecisionPath))
  } catch {
    errors.push("invalid PR-11A R1-C0 source decision document")
  }
  const expectedInventory = {
    admittedBehaviorSourcePaths: governanceCheckpoint
      ? []
      : pr11aR1C0AdmittedBehaviorSourcePaths,
    routesAdded: [],
    routesChanged: [],
    routesRemoved: [],
    runtimeBindings: [],
    realSecretBindings: [],
    productMainMutation: false,
  }
  if (
    !decision ||
    decision.contractBaseCommit !== pr11aR1C0ContractBase ||
    decision.contractBaseTree !== pr11aR1C0ContractBaseTree ||
    decision.exactBranch !== "codex/inference-core-pr-11a-r1-c0" ||
    decision.reviewStatus !== reviewStatus ||
    decision.accepted !== false ||
    decision.revisionBound !== false ||
    JSON.stringify(decision.preBehaviorInventory) !==
      JSON.stringify(expectedInventory)
  ) {
    errors.push("invalid PR-11A R1-C0 source package identity")
  }
  if (
    !governanceCheckpoint &&
    JSON.stringify(decision?.bindingDecisions?.removedAuthority) !==
      JSON.stringify({
        capabilities: [
          "litellm.routes_keys.edit",
          "grafana.dashboards_alerting.edit",
          "grafana.view",
        ],
        nativeTargetMatrix: true,
        keycloakNativeHrefFields: true,
        recoveryNativeAccessField: true,
        privateServiceCapabilityRegistry: true,
      })
  ) {
    errors.push("invalid PR-11A R1-C0 removed-authority decision")
  }

  if (
    actualAllowlist.schemaVersion !== expectedAllowlist.schemaVersion ||
    actualAllowlist.baseCommit !== expectedAllowlist.baseCommit ||
    JSON.stringify(actualAllowlist.entries) !==
      JSON.stringify(expectedAllowlist.entries)
  ) {
    errors.push("PR-11A R1-C0 forbidden-surface state changed")
  }
  errors.push(
    ...comparePr11aR1C0ProtectedFiles(
      expectedAllowlist.protectedFiles,
      actualAllowlist.protectedFiles,
      allowedPaths,
    ),
  )

  for (const key of Object.keys(expectedRoutes).sort()) {
    if (
      [
        "fingerprints",
        "policyDigest",
        "repositoryClosure",
        "sourceClosure",
      ].includes(key)
    ) {
      continue
    }
    if (
      JSON.stringify(expectedRoutes[key]) !== JSON.stringify(actualRoutes[key])
    ) {
      errors.push(`PR-11A R1-C0 route state changed ${key}`)
    }
  }
  if (!/^[0-9a-f]{64}$/.test(actualRoutes.policyDigest)) {
    errors.push("PR-11A R1-C0 route policy digest is invalid")
  }
  errors.push(
    ...comparePr11aR1C0RepositoryClosure(
      expectedRoutes.fingerprints,
      actualRoutes.fingerprints,
      allowedPaths,
    ),
    ...comparePr11aR1C0RepositoryClosure(
      expectedRoutes.sourceClosure,
      actualRoutes.sourceClosure,
      allowedPaths,
    ),
    ...comparePr11aR1C0RepositoryClosure(
      expectedRoutes.repositoryClosure,
      actualRoutes.repositoryClosure,
      allowedPaths,
    ),
  )
  return [...new Set(errors)].sort()
}

export function verifyShrinkOnly(baseEntries, currentEntries) {
  const errors = []
  const baseByKey = new Map(
    baseEntries.map((entry) => [findingKey(entry), entry]),
  )

  for (const entry of currentEntries) {
    const baseEntry = baseByKey.get(findingKey(entry))
    if (!baseEntry) {
      errors.push(`new legacy finding ${findingKey(entry)}`)
      continue
    }
    if (entry.removeBy !== baseEntry.removeBy) {
      errors.push(`legacy disposition changed ${findingKey(entry)}`)
    }
    if (!isFingerprintSubset(entry.fingerprints, baseEntry.fingerprints)) {
      errors.push(`legacy finding changed or grew ${findingKey(entry)}`)
    }
  }

  return errors.sort()
}

export function verifyPr11aR1S1SourcePackage({
  root,
  expectedAllowlist,
  actualAllowlist,
  expectedRoutes,
  actualRoutes,
}) {
  const errors = []
  const expectedFindings = new Map(
    expectedAllowlist.entries.map((entry) => [findingKey(entry), entry]),
  )
  for (const entry of actualAllowlist.entries) {
    const baseline = expectedFindings.get(findingKey(entry))
    if (
      !baseline ||
      entry.count > baseline.count ||
      !isFingerprintSubset(
        entry.fingerprints ?? {},
        baseline.fingerprints ?? {},
      )
    ) {
      errors.push(
        `R1-S1 added or expanded forbidden finding ${findingKey(entry)}`,
      )
    }
  }

  for (const key of [
    "schemaVersion",
    "baseCommit",
    "target",
    "webInferenceConsumers",
    "escapeHatches",
    "reviewedRevisions",
  ]) {
    if (
      JSON.stringify(actualRoutes[key]) !== JSON.stringify(expectedRoutes[key])
    ) {
      errors.push(`R1-S1 changed retained route baseline field ${key}`)
    }
  }

  const expectedRouteKeys = new Set(expectedRoutes.routes.map(routeKey))
  const actualRouteKeys = new Set(actualRoutes.routes.map(routeKey))
  const addedRoutes = [...actualRouteKeys]
    .filter((key) => !expectedRouteKeys.has(key))
    .sort()
  const removedRoutes = [...expectedRouteKeys]
    .filter((key) => !actualRouteKeys.has(key))
    .sort()
  const allowedAddedRoutes = [
    "bff\0GET\0/api/console/session/callback\0apps/bff/src/routes/console-session.ts",
    "bff\0GET\0/api/console/session/login\0apps/bff/src/routes/console-session.ts",
    "bff\0GET\0/api/internal/console-session/resolve\0apps/bff/src/routes/console-session.ts",
    "bff\0POST\0/api/console/session/elevate\0apps/bff/src/routes/console-session.ts",
    "bff\0POST\0/api/console/session/logout\0apps/bff/src/routes/console-session.ts",
    "bff\0POST\0/api/internal/console-session/backchannel-logout\0apps/bff/src/routes/console-session.ts",
    "web-page\0PAGE\0/auth/elevate\0apps/web/src/app/auth/elevate/page.tsx",
    "web-page\0PAGE\0/auth/unavailable\0apps/web/src/app/auth/unavailable/page.tsx",
  ].sort()
  const allowedRemovedRoutes = [
    "web-handler\0GET\0/api/auth/[...nextauth]\0apps/web/src/app/api/auth/[...nextauth]/route.ts",
    "web-handler\0GET\0/auth/keycloak\0apps/web/src/app/auth/keycloak/route.ts",
    "web-handler\0POST\0/api/auth/[...nextauth]\0apps/web/src/app/api/auth/[...nextauth]/route.ts",
  ].sort()
  if (JSON.stringify(addedRoutes) !== JSON.stringify(allowedAddedRoutes)) {
    errors.push(
      "R1-S1 route additions differ from the Console session boundary",
    )
  }
  if (JSON.stringify(removedRoutes) !== JSON.stringify(allowedRemovedRoutes)) {
    errors.push(
      "R1-S1 route removals differ from the Auth.js retirement boundary",
    )
  }

  const expectedRegistrars = new Set(
    expectedRoutes.fastifyRegistrars.map(({ exportName }) => exportName),
  )
  const actualRegistrars = new Set(
    actualRoutes.fastifyRegistrars.map(({ exportName }) => exportName),
  )
  const addedRegistrars = [...actualRegistrars]
    .filter((name) => !expectedRegistrars.has(name))
    .sort()
  const removedRegistrars = [...expectedRegistrars]
    .filter((name) => !actualRegistrars.has(name))
    .sort()
  if (
    JSON.stringify(addedRegistrars) !==
      JSON.stringify(["registerConsoleSessionRoutes"]) ||
    removedRegistrars.length !== 0
  ) {
    errors.push("R1-S1 Fastify registrar transition changed")
  }

  if (
    !isRegularFile(
      resolve(root, "infra/keycloak/pr11a-console-session-policy.json"),
    ) ||
    !isRegularFile(
      resolve(root, "infra/keycloak/validate-pr11a-session-policy.mjs"),
    )
  ) {
    errors.push("R1-S1 Keycloak source policy is missing")
  }
  if (
    isRegularFile(
      resolve(
        root,
        "docs/reduction/inference-core/contract-revisions/PR-11A.json",
      ),
    )
  ) {
    errors.push("R1-S1 must not generate the aggregate PR-11A revision")
  }
  return errors.sort()
}

export function verifyReviewedFindingReduction(baseEntries, currentEntries) {
  const errors = []
  const baseByKey = new Map(
    baseEntries.map((entry) => [findingKey(entry), entry]),
  )

  for (const entry of currentEntries) {
    const baseEntry = baseByKey.get(findingKey(entry))
    if (!baseEntry) {
      errors.push(`new reviewed legacy finding ${findingKey(entry)}`)
      continue
    }
    if (entry.removeBy !== baseEntry.removeBy) {
      errors.push(`reviewed legacy disposition changed ${findingKey(entry)}`)
    }
    if (entry.count > baseEntry.count) {
      errors.push(`reviewed legacy finding count grew ${findingKey(entry)}`)
    }
  }

  return errors.sort()
}

export function verifyActiveReviewedRevisionId(revisionId) {
  if (
    revisionId === undefined ||
    revisionId === null ||
    [
      "PR-02",
      "PR-03",
      "PR-04",
      "PR-05",
      "PR-06",
      "PR-07",
      "PR-08",
      "PR-09",
      "PR-10",
      "PR-10C",
      "PR-11",
    ].includes(revisionId)
  ) {
    return []
  }
  return [`unsupported active reviewed revision ${String(revisionId)}`]
}

export function verifyRepository({ root = repositoryRoot, baseRef } = {}) {
  const paths = listCandidatePaths(root)
  const expectedAllowlist = readJson(resolve(root, allowlistPath))
  const expectedRoutes = readJson(resolve(root, routeBaselinePath))
  const actualAllowlist = buildForbiddenAllowlist({
    root,
    paths,
    baseCommit: expectedAllowlist.baseCommit,
  })
  const actualRoutes = buildRouteBaseline({
    root,
    paths,
    baseCommit: expectedRoutes.baseCommit,
  })
  const activeReviewedRevision = expectedRoutes.reviewedRevisions?.at(-1)?.id
  const pr11aR1C0ReviewStatus = readPr11aR1C0ReviewStatus(root)
  const pr11aR1S1SourcePackage =
    activeReviewedRevision === "PR-11" &&
    isRegularFile(
      resolve(root, "infra/keycloak/pr11a-console-session-policy.json"),
    )
  const pr11aR1C0SourcePackage =
    !pr11aR1S1SourcePackage && pr11aR1C0ReviewStatus !== null

  const errors = [
    ...(pr11aR1S1SourcePackage
      ? verifyPr11aR1S1SourcePackage({
          root,
          expectedAllowlist,
          actualAllowlist,
          expectedRoutes,
          actualRoutes,
        })
      : pr11aR1C0SourcePackage
        ? verifyPr11aR1C0SourcePackage({
            root,
            reviewStatus: pr11aR1C0ReviewStatus,
            expectedAllowlist,
            actualAllowlist,
            expectedRoutes,
            actualRoutes,
          })
        : [
            ...compareForbiddenBaselineMetadata(
              expectedAllowlist,
              actualAllowlist,
            ),
            ...compareExactFindings(
              expectedAllowlist.entries,
              actualAllowlist.entries,
            ),
            ...compareExactRouteBaseline(expectedRoutes, actualRoutes),
          ]),
    ...verifyRouteBaselineMetadata(expectedRoutes),
    ...verifyRequiredRoutes(actualRoutes),
    ...verifyCorePackageClosure(root, paths),
    ...verifyRetentionCharacterization(root),
    ...(pr11aR1C0SourcePackage || pr11aR1S1SourcePackage
      ? []
      : activeReviewedRevision === "PR-11"
        ? verifyPr11TargetState({
            root,
            currentAllowlist: expectedAllowlist,
            currentRoutes: expectedRoutes,
            paths,
          })
        : activeReviewedRevision === "PR-10C"
          ? verifyPr10cTargetState({
              root,
              currentAllowlist: expectedAllowlist,
              currentRoutes: expectedRoutes,
              paths,
            })
          : activeReviewedRevision === "PR-10"
            ? verifyPr10TargetState({
                root,
                currentAllowlist: expectedAllowlist,
                currentRoutes: expectedRoutes,
                paths,
              })
            : activeReviewedRevision === "PR-09"
              ? verifyPr09TargetState({
                  root,
                  currentAllowlist: expectedAllowlist,
                  currentRoutes: expectedRoutes,
                  paths,
                })
              : activeReviewedRevision === "PR-08"
                ? verifyPr08TargetState({
                    root,
                    currentAllowlist: expectedAllowlist,
                    currentRoutes: expectedRoutes,
                    paths,
                  })
                : activeReviewedRevision === "PR-07"
                  ? verifyPr07TargetState({
                      root,
                      currentAllowlist: expectedAllowlist,
                      currentRoutes: expectedRoutes,
                      paths,
                    })
                  : activeReviewedRevision === "PR-06"
                    ? verifyPr06TargetState({
                        root,
                        currentAllowlist: expectedAllowlist,
                        currentRoutes: expectedRoutes,
                        paths,
                      })
                    : activeReviewedRevision === "PR-05"
                      ? verifyPr05TargetState({
                          root,
                          currentAllowlist: expectedAllowlist,
                          currentRoutes: expectedRoutes,
                          paths,
                        })
                      : activeReviewedRevision === "PR-04"
                        ? verifyPr04TargetState({
                            root,
                            currentAllowlist: expectedAllowlist,
                            currentRoutes: expectedRoutes,
                            paths,
                          })
                        : activeReviewedRevision === "PR-03"
                          ? verifyPr03TargetState({
                              root,
                              currentAllowlist: expectedAllowlist,
                              currentRoutes: expectedRoutes,
                            })
                          : verifyActiveReviewedRevisionId(
                              activeReviewedRevision,
                            )),
  ]

  let baseStatus = "not-requested"
  if (baseRef?.startsWith("-")) {
    baseStatus = "unavailable"
    errors.push(`base ref is unavailable ${baseRef}`)
  } else if (pr11aR1S1SourcePackage) {
    baseStatus = "checked"
    if (
      resolveCommit(root, pr11aR1S1IntegrationBase) !==
        pr11aR1S1IntegrationBase ||
      resolveCommit(root, `${pr11aR1S1IntegrationBase}^1`) !==
        pr11aR1C0ContractBase
    ) {
      errors.push("R1-S1 protected integration base identity changed")
    }
    try {
      execFileSync(
        "git",
        ["merge-base", "--is-ancestor", pr11aR1S1IntegrationBase, "HEAD"],
        { cwd: root, stdio: "ignore" },
      )
    } catch {
      errors.push(
        "R1-S1 no longer descends from the protected integration base",
      )
    }
  } else if (pr11aR1C0SourcePackage) {
    const checkpointBaseCommit = resolveCommit(root, pr11aR1C0ContractBase)
    baseStatus = "checked"
    if (
      checkpointBaseCommit !== pr11aR1C0ContractBase ||
      resolveTree(root, checkpointBaseCommit) !== pr11aR1C0ContractBaseTree
    ) {
      errors.push("PR-11A R1-C0 governance base identity changed")
    }
  } else if (baseRef) {
    const baseCommit = resolveCommit(root, baseRef)
    const baseAllowlist = baseCommit
      ? readJsonFromCommit(root, baseCommit, allowlistPath)
      : null
    const baseRoutes = baseCommit
      ? readJsonFromCommit(root, baseCommit, routeBaselinePath)
      : null
    if (!baseCommit) {
      baseStatus = "unavailable"
      errors.push(`base ref is unavailable ${baseRef}`)
    } else if (!baseAllowlist || !baseRoutes) {
      errors.push(...verifyBaseCommitLineage(root, baseCommit))
      baseStatus = "bootstrap"
      if (baseCommit !== pr01BootstrapBase) {
        errors.push(
          `base guardrail files missing after bootstrap ${baseCommit}`,
        )
      }
    } else {
      errors.push(...verifyBaseCommitLineage(root, baseCommit))
      baseStatus = "checked"
      const reviewedRevision = verifyReviewedContractRevision({
        root,
        baseCommit,
        baseAllowlist,
        currentAllowlist: expectedAllowlist,
        baseRoutes,
        currentRoutes: expectedRoutes,
      })
      errors.push(...reviewedRevision.errors)
      if (reviewedRevision.present) {
        if (
          !new Set([
            "PR-03",
            "PR-04",
            "PR-05",
            "PR-06",
            "PR-07",
            "PR-08",
            "PR-09",
            "PR-10",
            "PR-10C",
            "PR-11",
          ]).has(reviewedRevision.id)
        ) {
          errors.push(
            ...verifyReviewedFindingReduction(
              baseAllowlist.entries,
              expectedAllowlist.entries,
            ),
          )
        }
      } else {
        errors.push(
          ...verifyPolicyStability(
            baseAllowlist,
            expectedAllowlist,
            "forbidden-surface",
          ),
        )
        errors.push(
          ...verifyProtectedGuardrailStability(
            baseAllowlist,
            expectedAllowlist,
          ),
        )
        errors.push(
          ...verifyShrinkOnly(baseAllowlist.entries, expectedAllowlist.entries),
        )
        errors.push(...verifyLegacyRouteShrink(baseRoutes, expectedRoutes))
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors: errors.sort(),
    baseStatus,
    findingCount: expectedAllowlist.entries.reduce(
      (total, entry) => total + entry.count,
      0,
    ),
    findingPathCount: expectedAllowlist.entries.length,
    routeCount: (pr11aR1S1SourcePackage ? actualRoutes : expectedRoutes).routes
      .length,
    legacyRouteCount: (pr11aR1S1SourcePackage
      ? actualRoutes
      : expectedRoutes
    ).routes.filter((route) => route.classification === "legacy-retired")
      .length,
  }
}

export function verifyReviewedContractRevision({
  root,
  baseCommit,
  baseAllowlist,
  currentAllowlist,
  baseRoutes,
  currentRoutes,
  operationPolicy = pr02OperationPolicy,
}) {
  const baseRevisions = baseRoutes.reviewedRevisions ?? []
  const currentRevisions = currentRoutes.reviewedRevisions ?? []
  const basePr02Revision = baseRevisions.find(({ id }) => id === "PR-02")
  const currentPr02Revision = currentRevisions.find(({ id }) => id === "PR-02")
  const basePr03Revision = baseRevisions.find(({ id }) => id === "PR-03")
  const currentPr03Revision = currentRevisions.find(({ id }) => id === "PR-03")
  const basePr04Revision = baseRevisions.find(({ id }) => id === "PR-04")
  const currentPr04Revision = currentRevisions.find(({ id }) => id === "PR-04")
  const basePr05Revision = baseRevisions.find(({ id }) => id === "PR-05")
  const currentPr05Revision = currentRevisions.find(({ id }) => id === "PR-05")
  const basePr06Revision = baseRevisions.find(({ id }) => id === "PR-06")
  const currentPr06Revision = currentRevisions.find(({ id }) => id === "PR-06")
  const basePr07Revision = baseRevisions.find(({ id }) => id === "PR-07")
  const currentPr07Revision = currentRevisions.find(({ id }) => id === "PR-07")
  const basePr08Revision = baseRevisions.find(({ id }) => id === "PR-08")
  const currentPr08Revision = currentRevisions.find(({ id }) => id === "PR-08")
  const basePr09Revision = baseRevisions.find(({ id }) => id === "PR-09")
  const currentPr09Revision = currentRevisions.find(({ id }) => id === "PR-09")
  const basePr10Revision = baseRevisions.find(({ id }) => id === "PR-10")
  const currentPr10Revision = currentRevisions.find(({ id }) => id === "PR-10")
  const basePr10cRevision = baseRevisions.find(({ id }) => id === "PR-10C")
  const currentPr10cRevision = currentRevisions.find(
    ({ id }) => id === "PR-10C",
  )
  const basePr11Revision = baseRevisions.find(({ id }) => id === "PR-11")
  const currentPr11Revision = currentRevisions.find(({ id }) => id === "PR-11")
  const errors = []
  if (
    (!currentPr02Revision || !basePr02Revision) &&
    baseCommit !== pr02IntegrationBase
  ) {
    errors.push(
      `PR-02 contract revision base changed expected=${pr02IntegrationBase} actual=${baseCommit}`,
    )
  }
  if (JSON.stringify(baseRevisions) === JSON.stringify(currentRevisions)) {
    if (basePr02Revision && currentPr02Revision) {
      errors.push(
        ...verifyRetainedPr02RevisionEvidence(root, currentPr02Revision),
      )
    }
    if (basePr03Revision && currentPr03Revision) {
      errors.push(
        ...verifyRetainedPr03RevisionEvidence(root, currentPr03Revision),
      )
    }
    if (basePr04Revision && currentPr04Revision) {
      errors.push(
        ...verifyRetainedPr04RevisionEvidence(root, currentPr04Revision),
      )
    }
    if (basePr05Revision && currentPr05Revision) {
      errors.push(
        ...verifyRetainedPr05RevisionEvidence(root, currentPr05Revision),
      )
    }
    if (basePr06Revision && currentPr06Revision) {
      errors.push(
        ...verifyRetainedPr06RevisionEvidence(root, currentPr06Revision),
      )
    }
    if (basePr07Revision && currentPr07Revision) {
      errors.push(
        ...verifyRetainedPr07RevisionEvidence(root, currentPr07Revision),
      )
    }
    if (basePr08Revision && currentPr08Revision) {
      errors.push(
        ...verifyRetainedPr08RevisionEvidence(root, currentPr08Revision),
      )
    }
    if (basePr09Revision && currentPr09Revision) {
      errors.push(
        ...verifyRetainedPr09RevisionEvidence(root, currentPr09Revision),
      )
    }
    if (basePr10Revision && currentPr10Revision) {
      errors.push(
        ...verifyRetainedPr10RevisionEvidence(root, currentPr10Revision),
      )
    }
    if (basePr10cRevision && currentPr10cRevision) {
      errors.push(
        ...verifyRetainedPr10cRevisionEvidence(root, currentPr10cRevision),
      )
    }
    if (basePr11Revision && currentPr11Revision) {
      errors.push(
        ...verifyRetainedPr11RevisionEvidence(root, currentPr11Revision),
      )
    }
    return { present: false, id: null, errors: errors.sort() }
  }

  if (
    isExactRevisionAppend(
      baseRevisions,
      currentRevisions,
      "PR-11",
      pr11ContractRevisionPath,
    )
  ) {
    return verifyIntroducedPr11Revision({
      root,
      baseCommit,
      baseAllowlist,
      currentAllowlist,
      baseRoutes,
      currentRoutes,
    })
  }

  if (
    isExactRevisionAppend(
      baseRevisions,
      currentRevisions,
      "PR-10C",
      pr10cContractRevisionPath,
    )
  ) {
    return verifyIntroducedPr10cRevision({
      root,
      baseCommit,
      baseAllowlist,
      currentAllowlist,
      baseRoutes,
      currentRoutes,
    })
  }

  if (
    isExactRevisionAppend(
      baseRevisions,
      currentRevisions,
      "PR-10",
      pr10ContractRevisionPath,
    )
  ) {
    return verifyIntroducedPr10Revision({
      root,
      baseCommit,
      baseAllowlist,
      currentAllowlist,
      baseRoutes,
      currentRoutes,
    })
  }

  if (
    isExactRevisionAppend(
      baseRevisions,
      currentRevisions,
      "PR-09",
      pr09ContractRevisionPath,
    )
  ) {
    return verifyIntroducedPr09Revision({
      root,
      baseCommit,
      baseAllowlist,
      currentAllowlist,
      baseRoutes,
      currentRoutes,
    })
  }

  if (
    isExactRevisionAppend(
      baseRevisions,
      currentRevisions,
      "PR-08",
      pr08ContractRevisionPath,
    )
  ) {
    return verifyIntroducedPr08Revision({
      root,
      baseCommit,
      baseAllowlist,
      currentAllowlist,
      baseRoutes,
      currentRoutes,
    })
  }

  if (
    isExactRevisionAppend(
      baseRevisions,
      currentRevisions,
      "PR-07",
      pr07ContractRevisionPath,
    )
  ) {
    return verifyIntroducedPr07Revision({
      root,
      baseCommit,
      baseAllowlist,
      currentAllowlist,
      baseRoutes,
      currentRoutes,
    })
  }

  if (
    isExactRevisionAppend(
      baseRevisions,
      currentRevisions,
      "PR-06",
      pr06ContractRevisionPath,
    )
  ) {
    return verifyIntroducedPr06Revision({
      root,
      baseCommit,
      baseAllowlist,
      currentAllowlist,
      baseRoutes,
      currentRoutes,
    })
  }

  if (
    isExactRevisionAppend(
      baseRevisions,
      currentRevisions,
      "PR-05",
      pr05ContractRevisionPath,
    )
  ) {
    return verifyIntroducedPr05Revision({
      root,
      baseCommit,
      baseAllowlist,
      currentAllowlist,
      baseRoutes,
      currentRoutes,
    })
  }

  if (
    isExactRevisionAppend(
      baseRevisions,
      currentRevisions,
      "PR-04",
      pr04ContractRevisionPath,
    )
  ) {
    return verifyIntroducedPr04Revision({
      root,
      baseCommit,
      baseAllowlist,
      currentAllowlist,
      baseRoutes,
      currentRoutes,
    })
  }

  if (
    isExactRevisionAppend(
      baseRevisions,
      currentRevisions,
      "PR-03",
      pr03ContractRevisionPath,
    )
  ) {
    return verifyIntroducedPr03Revision({
      root,
      baseCommit,
      baseAllowlist,
      currentAllowlist,
      baseRoutes,
      currentRoutes,
    })
  }

  if (basePr02Revision || !currentPr02Revision) {
    errors.push("unsupported reviewed contract revision history transition")
  }
  if (!isRegularFile(resolve(root, pr02ContractRevisionPath))) {
    return {
      present: true,
      id: "PR-02",
      errors: [
        ...errors,
        `missing reviewed contract revision ${pr02ContractRevisionPath}`,
      ].sort(),
    }
  }

  const reviewedBaseRoutes = {
    ...baseRoutes,
    repositoryClosure:
      baseRoutes.repositoryClosure ??
      buildRepositoryClosureFromCommit(root, baseCommit),
  }
  const evidenceFiles = buildRevisionEvidenceFingerprints(root)
  const expected = buildContractRevisionDocument({
    baseCommit,
    baseTree: resolveTree(root, baseCommit),
    baseAllowlist,
    currentAllowlist,
    baseRoutes: reviewedBaseRoutes,
    currentRoutes,
    evidenceFiles,
  })
  const actual = readJson(resolve(root, pr02ContractRevisionPath))
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    errors.push("PR-02 reviewed contract revision does not match exact changes")
  }

  const expectedRevisionHistory = [
    ...baseRevisions,
    {
      id: "PR-02",
      path: pr02ContractRevisionPath,
      sha256: sha256(readFileSync(resolve(root, pr02ContractRevisionPath))),
    },
  ]
  if (
    JSON.stringify(currentRevisions) !== JSON.stringify(expectedRevisionHistory)
  ) {
    errors.push("reviewed contract revision history changed")
  }
  if (
    JSON.stringify(baseRoutes.target) !== JSON.stringify(currentRoutes.target)
  ) {
    errors.push("route target contract changed outside PR-02 scope")
  }
  if (
    JSON.stringify(baseRoutes.fingerprints) !==
    JSON.stringify(currentRoutes.fingerprints)
  ) {
    errors.push("route resolver fingerprints changed outside PR-02 scope")
  }
  errors.push(...verifyRequiredRoutes(currentRoutes))
  errors.push(
    ...verifyPr02OperationMatrix(
      reviewedBaseRoutes,
      currentRoutes,
      operationPolicy,
    ),
  )

  return { present: true, id: "PR-02", errors: errors.sort() }
}

function isExactRevisionAppend(base, current, id, path) {
  return Boolean(
    current.length === base.length + 1 &&
      JSON.stringify(current.slice(0, -1)) === JSON.stringify(base) &&
      current.at(-1)?.id === id &&
      current.at(-1)?.path === path &&
      /^[0-9a-f]{64}$/.test(current.at(-1)?.sha256 ?? ""),
  )
}

function verifyIntroducedPr03Revision({
  root,
  baseCommit,
  baseAllowlist,
  currentAllowlist,
  baseRoutes,
  currentRoutes,
}) {
  const errors = []
  if (baseCommit !== pr03ContractBase) {
    errors.push(
      `PR-03 contract revision base changed expected=${pr03ContractBase} actual=${baseCommit}`,
    )
  }
  errors.push(...verifyPr03LaneLineage(root))
  const baseRevisionHistory = baseRoutes.reviewedRevisions ?? []
  if (
    baseRevisionHistory.length !== 1 ||
    baseRevisionHistory[0]?.id !== "PR-02"
  ) {
    errors.push("PR-03 requires the exact retained PR-02 revision history")
  } else {
    errors.push(
      ...verifyRetainedPr02RevisionEvidence(root, baseRevisionHistory[0]),
    )
  }
  if (!isRegularFile(resolve(root, pr03ContractRevisionPath))) {
    return {
      present: true,
      id: "PR-03",
      errors: [
        ...errors,
        `missing reviewed contract revision ${pr03ContractRevisionPath}`,
      ].sort(),
    }
  }

  const decision = readPr03DecisionDocument(root)
  errors.push(
    ...verifyPr03DecisionDocument(decision, {
      requireReady: true,
    }),
  )
  const evidenceFiles = buildRevisionEvidenceFingerprints(
    root,
    pr03RevisionEvidencePaths,
    "PR-03",
  )
  const expected = buildContractRevisionDocument({
    revisionId: "PR-03",
    scope: "legacy-source-removal",
    baseCommit,
    baseTree: resolveTree(root, baseCommit),
    baseAllowlist,
    currentAllowlist,
    baseRoutes,
    currentRoutes: {
      ...currentRoutes,
      reviewedRevisions: structuredClone(baseRoutes.reviewedRevisions ?? []),
    },
    evidenceFiles,
  })
  const actual = readJson(resolve(root, pr03ContractRevisionPath))
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    errors.push("PR-03 reviewed contract revision does not match exact changes")
  }

  const expectedRevisionHistory = [
    ...(baseRoutes.reviewedRevisions ?? []),
    {
      id: "PR-03",
      path: pr03ContractRevisionPath,
      sha256: sha256(readFileSync(resolve(root, pr03ContractRevisionPath))),
    },
  ]
  if (
    JSON.stringify(currentRoutes.reviewedRevisions ?? []) !==
    JSON.stringify(expectedRevisionHistory)
  ) {
    errors.push("reviewed contract revision history changed")
  }
  if (
    JSON.stringify(baseRoutes.target) !== JSON.stringify(currentRoutes.target)
  ) {
    errors.push("route target contract changed outside PR-03 scope")
  }
  if (
    JSON.stringify(currentRoutes.fingerprints) !==
    JSON.stringify(reviewedPr03ResolverFingerprints)
  ) {
    errors.push("PR-03 resolver fingerprints changed")
  }
  errors.push(...verifyRequiredRoutes(currentRoutes))
  errors.push(
    ...verifyPr03CandidateContract({
      root,
      baseAllowlist,
      currentAllowlist,
      baseRoutes,
      currentRoutes,
      operationPolicy: decision.operationPolicy,
    }),
  )

  return { present: true, id: "PR-03", errors: errors.sort() }
}

function verifyPr03LaneLineage(root) {
  const anchor = resolveCommit(root, pr03LaneAnchor)
  if (anchor !== pr03LaneAnchor) {
    return [`PR-03 lane anchor is unavailable ${pr03LaneAnchor}`]
  }
  const head = currentHead(root)
  if (head === pr03LaneAnchor) {
    return []
  }
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", pr03LaneAnchor, head], {
      cwd: root,
      stdio: "ignore",
    })
    return []
  } catch {
    return [`PR-03 lane anchor is not an ancestor ${pr03LaneAnchor}`]
  }
}

function verifyIntroducedPr04Revision({
  root,
  baseCommit,
  baseAllowlist,
  currentAllowlist,
  baseRoutes,
  currentRoutes,
}) {
  const errors = []
  if (baseCommit !== pr04ContractBase) {
    errors.push(
      `PR-04 contract revision base changed expected=${pr04ContractBase} actual=${baseCommit}`,
    )
  }
  errors.push(...verifyPr04LaneLineage(root))
  errors.push(...verifyPr04BaseEvidence(root))
  const baseRevisionHistory = baseRoutes.reviewedRevisions ?? []
  if (
    baseRevisionHistory.length !== 2 ||
    baseRevisionHistory[0]?.id !== "PR-02" ||
    baseRevisionHistory[1]?.id !== "PR-03"
  ) {
    errors.push(
      "PR-04 requires the exact retained PR-02 and PR-03 revision history",
    )
  } else {
    errors.push(
      ...verifyRetainedPr02RevisionEvidence(root, baseRevisionHistory[0]),
      ...verifyRetainedPr03RevisionEvidence(root, baseRevisionHistory[1]),
    )
  }
  if (!isRegularFile(resolve(root, pr04ContractRevisionPath))) {
    return {
      present: true,
      id: "PR-04",
      errors: [
        ...errors,
        `missing reviewed contract revision ${pr04ContractRevisionPath}`,
      ].sort(),
    }
  }

  const decision = readPr04DecisionDocument(root)
  errors.push(
    ...verifyPr04DecisionDocument(decision, {
      requireReady: true,
    }),
  )
  const evidenceFiles = buildRevisionEvidenceFingerprints(
    root,
    pr04RevisionEvidencePaths,
    "PR-04",
  )
  const expected = buildContractRevisionDocument({
    revisionId: "PR-04",
    scope: "data-retention-foundation",
    baseCommit,
    baseTree: resolveTree(root, baseCommit),
    baseAllowlist,
    currentAllowlist,
    baseRoutes,
    currentRoutes: {
      ...currentRoutes,
      reviewedRevisions: structuredClone(baseRoutes.reviewedRevisions ?? []),
    },
    evidenceFiles,
  })
  const actual = readJson(resolve(root, pr04ContractRevisionPath))
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    errors.push("PR-04 reviewed contract revision does not match exact changes")
  }

  const expectedRevisionHistory = [
    ...(baseRoutes.reviewedRevisions ?? []),
    {
      id: "PR-04",
      path: pr04ContractRevisionPath,
      sha256: sha256(readFileSync(resolve(root, pr04ContractRevisionPath))),
    },
  ]
  if (
    JSON.stringify(currentRoutes.reviewedRevisions ?? []) !==
    JSON.stringify(expectedRevisionHistory)
  ) {
    errors.push("reviewed contract revision history changed")
  }
  errors.push(...verifyRequiredRoutes(currentRoutes))
  errors.push(
    ...verifyPr04CandidateContract({
      root,
      baseAllowlist,
      currentAllowlist,
      baseRoutes,
      currentRoutes,
      operationPolicy: decision.operationPolicy,
    }),
  )

  return { present: true, id: "PR-04", errors: errors.sort() }
}

function verifyPr04LaneLineage(root) {
  const anchor = resolveCommit(root, pr04LaneAnchor)
  if (anchor !== pr04LaneAnchor) {
    return [`PR-04 lane anchor is unavailable ${pr04LaneAnchor}`]
  }
  const head = currentHead(root)
  if (head === pr04LaneAnchor) {
    return []
  }
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", pr04LaneAnchor, head], {
      cwd: root,
      stdio: "ignore",
    })
    return []
  } catch {
    return [`PR-04 lane anchor is not an ancestor ${pr04LaneAnchor}`]
  }
}

function verifyIntroducedPr05Revision({
  root,
  baseCommit,
  baseAllowlist,
  currentAllowlist,
  baseRoutes,
  currentRoutes,
}) {
  const errors = []
  if (baseCommit !== pr05ContractBase) {
    errors.push(
      `PR-05 contract revision base changed expected=${pr05ContractBase} actual=${baseCommit}`,
    )
  }
  errors.push(...verifyPr05LaneLineage(root))
  errors.push(...verifyPr05BaseEvidence(root))
  const baseRevisionHistory = baseRoutes.reviewedRevisions ?? []
  if (
    baseRevisionHistory.length !== 3 ||
    baseRevisionHistory[0]?.id !== "PR-02" ||
    baseRevisionHistory[1]?.id !== "PR-03" ||
    baseRevisionHistory[2]?.id !== "PR-04"
  ) {
    errors.push(
      "PR-05 requires the exact retained PR-02, PR-03, and PR-04 revision history",
    )
  } else {
    errors.push(
      ...verifyRetainedPr02RevisionEvidence(root, baseRevisionHistory[0]),
      ...verifyRetainedPr03RevisionEvidence(root, baseRevisionHistory[1]),
      ...verifyRetainedPr04RevisionEvidence(root, baseRevisionHistory[2]),
    )
  }
  if (!isRegularFile(resolve(root, pr05ContractRevisionPath))) {
    return {
      present: true,
      id: "PR-05",
      errors: [
        ...errors,
        `missing reviewed contract revision ${pr05ContractRevisionPath}`,
      ].sort(),
    }
  }

  const decision = readPr05DecisionDocument(root)
  errors.push(
    ...verifyPr05DecisionDocument(decision, {
      requireReady: true,
    }),
  )
  const evidenceFiles = buildRevisionEvidenceFingerprints(
    root,
    pr05RevisionEvidencePaths,
    "PR-05",
  )
  const expected = buildContractRevisionDocument({
    revisionId: "PR-05",
    scope: "identity-authorization-emergency-recovery",
    baseCommit,
    baseTree: resolveTree(root, baseCommit),
    baseAllowlist,
    currentAllowlist,
    baseRoutes,
    currentRoutes: {
      ...currentRoutes,
      reviewedRevisions: structuredClone(baseRoutes.reviewedRevisions ?? []),
    },
    evidenceFiles,
  })
  const actual = readJson(resolve(root, pr05ContractRevisionPath))
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    errors.push("PR-05 reviewed contract revision does not match exact changes")
  }

  const expectedRevisionHistory = [
    ...(baseRoutes.reviewedRevisions ?? []),
    {
      id: "PR-05",
      path: pr05ContractRevisionPath,
      sha256: sha256(readFileSync(resolve(root, pr05ContractRevisionPath))),
    },
  ]
  if (
    JSON.stringify(currentRoutes.reviewedRevisions ?? []) !==
    JSON.stringify(expectedRevisionHistory)
  ) {
    errors.push("reviewed contract revision history changed")
  }
  errors.push(...verifyRequiredRoutes(currentRoutes))
  errors.push(
    ...verifyPr05CandidateContract({
      root,
      baseAllowlist,
      currentAllowlist,
      baseRoutes,
      currentRoutes,
      operationPolicy: decision.operationPolicy,
    }),
  )

  return { present: true, id: "PR-05", errors: errors.sort() }
}

function verifyPr05LaneLineage(root) {
  const anchor = resolveCommit(root, pr05LaneAnchor)
  if (anchor !== pr05LaneAnchor) {
    return [`PR-05 lane anchor is unavailable ${pr05LaneAnchor}`]
  }
  const head = currentHead(root)
  if (head === pr05LaneAnchor) {
    return []
  }
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", pr05LaneAnchor, head], {
      cwd: root,
      stdio: "ignore",
    })
    return []
  } catch {
    return [`PR-05 lane anchor is not an ancestor ${pr05LaneAnchor}`]
  }
}

function verifyIntroducedPr11Revision({
  root,
  baseCommit,
  baseAllowlist,
  currentAllowlist,
  baseRoutes,
  currentRoutes,
}) {
  const errors = []
  if (baseCommit !== pr11ContractBase) {
    errors.push(
      `PR-11 contract revision base changed expected=${pr11ContractBase} actual=${baseCommit}`,
    )
  }
  if (resolveTree(root, baseCommit) !== pr11ContractBaseTree) {
    errors.push("PR-11 contract base tree changed")
  }
  errors.push(...verifyPr11LaneLineage(root))
  errors.push(...verifyPr11BaseEvidence(root))
  const baseRevisionHistory = baseRoutes.reviewedRevisions ?? []
  const expectedPriorIds = [
    "PR-02",
    "PR-03",
    "PR-04",
    "PR-05",
    "PR-06",
    "PR-07",
    "PR-08",
    "PR-09",
    "PR-10",
    "PR-10C",
  ]
  if (
    baseRevisionHistory.length !== expectedPriorIds.length ||
    expectedPriorIds.some((id, index) => baseRevisionHistory[index]?.id !== id)
  ) {
    errors.push(
      "PR-11 requires the exact retained PR-02 through PR-10C revision history",
    )
  } else {
    errors.push(
      ...verifyRetainedPr02RevisionEvidence(root, baseRevisionHistory[0]),
      ...verifyRetainedPr03RevisionEvidence(root, baseRevisionHistory[1]),
      ...verifyRetainedPr04RevisionEvidence(root, baseRevisionHistory[2]),
      ...verifyRetainedPr05RevisionEvidence(root, baseRevisionHistory[3]),
      ...verifyRetainedPr06RevisionEvidence(root, baseRevisionHistory[4]),
      ...verifyRetainedPr07RevisionEvidence(root, baseRevisionHistory[5]),
      ...verifyRetainedPr08RevisionEvidence(root, baseRevisionHistory[6]),
      ...verifyRetainedPr09RevisionEvidence(root, baseRevisionHistory[7]),
      ...verifyRetainedPr10RevisionEvidence(root, baseRevisionHistory[8]),
      ...verifyRetainedPr10cRevisionEvidence(root, baseRevisionHistory[9]),
    )
  }
  if (!isRegularFile(resolve(root, pr11ContractRevisionPath))) {
    return {
      present: true,
      id: "PR-11",
      errors: [
        ...errors,
        `missing reviewed contract revision ${pr11ContractRevisionPath}`,
      ].sort(),
    }
  }

  const decision = readPr11DecisionDocument(root)
  errors.push(
    ...verifyPr11DecisionDocument(decision, { requireReady: true, root }),
  )
  const evidenceFiles = buildRevisionEvidenceFingerprints(
    root,
    pr11RevisionEvidencePaths,
    "PR-11",
  )
  const expected = buildContractRevisionDocument({
    revisionId: "PR-11",
    scope: "retained-console-information-architecture-source-only",
    baseCommit,
    baseTree: resolveTree(root, baseCommit),
    baseAllowlist,
    currentAllowlist,
    baseRoutes,
    currentRoutes: {
      ...currentRoutes,
      reviewedRevisions: structuredClone(baseRoutes.reviewedRevisions ?? []),
    },
    evidenceFiles,
  })
  const actual = readJson(resolve(root, pr11ContractRevisionPath))
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    errors.push("PR-11 reviewed contract revision does not match exact changes")
  }

  const expectedRevisionHistory = [
    ...(baseRoutes.reviewedRevisions ?? []),
    {
      id: "PR-11",
      path: pr11ContractRevisionPath,
      sha256: sha256(readFileSync(resolve(root, pr11ContractRevisionPath))),
    },
  ]
  if (
    JSON.stringify(currentRoutes.reviewedRevisions ?? []) !==
    JSON.stringify(expectedRevisionHistory)
  ) {
    errors.push("reviewed contract revision history changed")
  }
  errors.push(...verifyRequiredRoutes(currentRoutes))
  errors.push(
    ...verifyPr11CandidateContract({
      root,
      baseAllowlist,
      currentAllowlist,
      baseRoutes,
      currentRoutes,
      operationPolicy: decision.operationPolicy,
    }),
  )
  return { present: true, id: "PR-11", errors: errors.sort() }
}

function verifyPr11LaneLineage(root) {
  const anchor = resolveCommit(root, pr11LaneAnchor)
  if (anchor !== pr11LaneAnchor) {
    return [`PR-11 lane anchor is unavailable ${pr11LaneAnchor}`]
  }
  const head = currentHead(root)
  if (head === pr11LaneAnchor) {
    return []
  }
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", pr11LaneAnchor, head], {
      cwd: root,
      stdio: "ignore",
    })
    return []
  } catch {
    return [`PR-11 lane anchor is not an ancestor ${pr11LaneAnchor}`]
  }
}

function verifyReviewedPr11SuccessorContext(root) {
  const decisionPath = resolve(root, pr11DecisionPath)
  if (!isRegularFile(decisionPath)) {
    return [`missing reviewed PR-11 successor decision ${pr11DecisionPath}`]
  }
  let decision
  try {
    decision = readJson(decisionPath)
  } catch {
    return ["invalid PR-11 successor decision document"]
  }
  const errors = [
    ...verifyPr11DecisionDocument(decision, { requireReady: true, root }),
    ...verifyPr11LaneLineage(root),
  ]
  if (resolveCommit(root, pr11ContractBase) !== pr11ContractBase) {
    errors.push(`PR-11 contract base is unavailable ${pr11ContractBase}`)
  }
  if (resolveTree(root, pr11ContractBase) !== pr11ContractBaseTree) {
    errors.push("PR-11 contract base tree changed")
  }
  return [...new Set(errors)].sort()
}

function verifyReviewedPr11SuccessorTarget({
  root,
  currentAllowlist,
  currentRoutes,
  paths,
}) {
  return [
    ...new Set([
      ...verifyReviewedPr11SuccessorContext(root),
      ...verifyPr11TargetState({
        root,
        currentAllowlist,
        currentRoutes,
        paths,
      }),
    ]),
  ].sort()
}

function verifyIntroducedPr10cRevision({
  root,
  baseCommit,
  baseAllowlist,
  currentAllowlist,
  baseRoutes,
  currentRoutes,
}) {
  const errors = []
  if (baseCommit !== pr10cContractBase) {
    errors.push(
      `PR-10C contract revision base changed expected=${pr10cContractBase} actual=${baseCommit}`,
    )
  }
  if (resolveTree(root, baseCommit) !== pr10cContractBaseTree) {
    errors.push("PR-10C contract base tree changed")
  }
  errors.push(...verifyPr10cLaneLineage(root))
  errors.push(...verifyPr10cBaseEvidence(root))
  const baseRevisionHistory = baseRoutes.reviewedRevisions ?? []
  const expectedPriorIds = [
    "PR-02",
    "PR-03",
    "PR-04",
    "PR-05",
    "PR-06",
    "PR-07",
    "PR-08",
    "PR-09",
    "PR-10",
  ]
  if (
    baseRevisionHistory.length !== expectedPriorIds.length ||
    expectedPriorIds.some((id, index) => baseRevisionHistory[index]?.id !== id)
  ) {
    errors.push(
      "PR-10C requires the exact retained PR-02 through PR-10 revision history",
    )
  } else {
    errors.push(
      ...verifyRetainedPr02RevisionEvidence(root, baseRevisionHistory[0]),
      ...verifyRetainedPr03RevisionEvidence(root, baseRevisionHistory[1]),
      ...verifyRetainedPr04RevisionEvidence(root, baseRevisionHistory[2]),
      ...verifyRetainedPr05RevisionEvidence(root, baseRevisionHistory[3]),
      ...verifyRetainedPr06RevisionEvidence(root, baseRevisionHistory[4]),
      ...verifyRetainedPr07RevisionEvidence(root, baseRevisionHistory[5]),
      ...verifyRetainedPr08RevisionEvidence(root, baseRevisionHistory[6]),
      ...verifyRetainedPr09RevisionEvidence(root, baseRevisionHistory[7]),
      ...verifyRetainedPr10RevisionEvidence(root, baseRevisionHistory[8]),
    )
  }
  if (!isRegularFile(resolve(root, pr10cContractRevisionPath))) {
    return {
      present: true,
      id: "PR-10C",
      errors: [
        ...errors,
        `missing reviewed contract revision ${pr10cContractRevisionPath}`,
      ].sort(),
    }
  }

  const decision = readPr10cDecisionDocument(root)
  errors.push(
    ...verifyPr10cDecisionDocument(decision, { requireReady: true, root }),
  )
  const evidenceFiles = buildRevisionEvidenceFingerprints(
    root,
    pr10cRevisionEvidencePaths,
    "PR-10C",
  )
  const expected = buildContractRevisionDocument({
    revisionId: "PR-10C",
    scope: "emergency-isolation-source-only",
    baseCommit,
    baseTree: resolveTree(root, baseCommit),
    baseAllowlist,
    currentAllowlist,
    baseRoutes,
    currentRoutes: {
      ...currentRoutes,
      reviewedRevisions: structuredClone(baseRoutes.reviewedRevisions ?? []),
    },
    evidenceFiles,
  })
  const actual = readJson(resolve(root, pr10cContractRevisionPath))
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    errors.push(
      "PR-10C reviewed contract revision does not match exact changes",
    )
  }

  const expectedRevisionHistory = [
    ...(baseRoutes.reviewedRevisions ?? []),
    {
      id: "PR-10C",
      path: pr10cContractRevisionPath,
      sha256: sha256(readFileSync(resolve(root, pr10cContractRevisionPath))),
    },
  ]
  if (
    JSON.stringify(currentRoutes.reviewedRevisions ?? []) !==
    JSON.stringify(expectedRevisionHistory)
  ) {
    errors.push("reviewed contract revision history changed")
  }
  errors.push(...verifyRequiredRoutes(currentRoutes))
  errors.push(
    ...verifyPr10cCandidateContract({
      root,
      baseAllowlist,
      currentAllowlist,
      baseRoutes,
      currentRoutes,
      operationPolicy: decision.operationPolicy,
    }),
  )

  return { present: true, id: "PR-10C", errors: errors.sort() }
}

function verifyPr10cLaneLineage(root) {
  const anchor = resolveCommit(root, pr10cLaneAnchor)
  if (anchor !== pr10cLaneAnchor) {
    return [`PR-10C lane anchor is unavailable ${pr10cLaneAnchor}`]
  }
  const head = currentHead(root)
  if (head === pr10cLaneAnchor) {
    return []
  }
  try {
    execFileSync(
      "git",
      ["merge-base", "--is-ancestor", pr10cLaneAnchor, head],
      {
        cwd: root,
        stdio: "ignore",
      },
    )
    return []
  } catch {
    return [`PR-10C lane anchor is not an ancestor ${pr10cLaneAnchor}`]
  }
}

function verifyReviewedPr10cSuccessorContext(root) {
  const decisionPath = resolve(root, pr10cDecisionPath)
  if (!isRegularFile(decisionPath)) {
    return [`missing reviewed PR-10C successor decision ${pr10cDecisionPath}`]
  }

  let decision
  try {
    const evidenceBytes = readRepositoryPathAtCommit(
      root,
      pr10cSuccessorEvidenceCommit,
      pr10cDecisionPath,
    )
    if (!readFileSync(decisionPath).equals(evidenceBytes)) {
      return ["reviewed PR-10C successor decision changed"]
    }
    decision = JSON.parse(evidenceBytes.toString("utf8"))
  } catch {
    return ["invalid PR-10C successor decision document"]
  }

  const errors = [
    ...verifyPr10cDecisionDocument(decision, {
      requireReady: true,
      root,
      sourceEvidenceCommit: pr10cSuccessorEvidenceCommit,
    }),
    ...verifyPr10cLaneLineage(root),
  ]
  if (
    resolveCommit(root, pr10cSuccessorEvidenceCommit) !==
    pr10cSuccessorEvidenceCommit
  ) {
    errors.push(
      `PR-10C successor evidence commit is unavailable ${pr10cSuccessorEvidenceCommit}`,
    )
  }
  if (
    resolveTree(root, pr10cSuccessorEvidenceCommit) !==
    pr10cSuccessorEvidenceTree
  ) {
    errors.push("PR-10C successor evidence tree changed")
  }
  if (resolveCommit(root, pr10cContractBase) !== pr10cContractBase) {
    errors.push(`PR-10C contract base is unavailable ${pr10cContractBase}`)
  }
  if (resolveTree(root, pr10cContractBase) !== pr10cContractBaseTree) {
    errors.push("PR-10C contract base tree changed")
  }
  return [...new Set(errors)].sort()
}

function verifyReviewedPr10cSuccessorTarget({
  root,
  currentAllowlist,
  currentRoutes,
  paths,
}) {
  return [
    ...new Set([
      ...verifyReviewedPr10cSuccessorContext(root),
      ...verifyPr10cTargetState({
        root,
        currentAllowlist,
        currentRoutes,
        paths,
      }),
    ]),
  ].sort()
}

function verifyIntroducedPr10Revision({
  root,
  baseCommit,
  baseAllowlist,
  currentAllowlist,
  baseRoutes,
  currentRoutes,
}) {
  const errors = []
  if (baseCommit !== pr10ContractBase) {
    errors.push(
      `PR-10 contract revision base changed expected=${pr10ContractBase} actual=${baseCommit}`,
    )
  }
  if (resolveTree(root, baseCommit) !== pr10ContractBaseTree) {
    errors.push("PR-10 contract base tree changed")
  }
  errors.push(...verifyPr10LaneLineage(root))
  errors.push(...verifyPr10BaseEvidence(root))
  const baseRevisionHistory = baseRoutes.reviewedRevisions ?? []
  const expectedPriorIds = [
    "PR-02",
    "PR-03",
    "PR-04",
    "PR-05",
    "PR-06",
    "PR-07",
    "PR-08",
    "PR-09",
  ]
  if (
    baseRevisionHistory.length !== expectedPriorIds.length ||
    expectedPriorIds.some((id, index) => baseRevisionHistory[index]?.id !== id)
  ) {
    errors.push(
      "PR-10 requires the exact retained PR-02 through PR-09 revision history",
    )
  } else {
    errors.push(
      ...verifyRetainedPr02RevisionEvidence(root, baseRevisionHistory[0]),
      ...verifyRetainedPr03RevisionEvidence(root, baseRevisionHistory[1]),
      ...verifyRetainedPr04RevisionEvidence(root, baseRevisionHistory[2]),
      ...verifyRetainedPr05RevisionEvidence(root, baseRevisionHistory[3]),
      ...verifyRetainedPr06RevisionEvidence(root, baseRevisionHistory[4]),
      ...verifyRetainedPr07RevisionEvidence(root, baseRevisionHistory[5]),
      ...verifyRetainedPr08RevisionEvidence(root, baseRevisionHistory[6]),
      ...verifyRetainedPr09RevisionEvidence(root, baseRevisionHistory[7]),
    )
  }
  if (!isRegularFile(resolve(root, pr10ContractRevisionPath))) {
    return {
      present: true,
      id: "PR-10",
      errors: [
        ...errors,
        `missing reviewed contract revision ${pr10ContractRevisionPath}`,
      ].sort(),
    }
  }

  const decision = readPr10DecisionDocument(root)
  errors.push(
    ...verifyPr10DecisionDocument(decision, { requireReady: true, root }),
  )
  const evidenceFiles = buildRevisionEvidenceFingerprints(
    root,
    pr10RevisionEvidencePaths,
    "PR-10",
  )
  const expected = buildContractRevisionDocument({
    revisionId: "PR-10",
    scope: "lifecycle-snapshot-restore-foundation-source-only",
    baseCommit,
    baseTree: resolveTree(root, baseCommit),
    baseAllowlist,
    currentAllowlist,
    baseRoutes,
    currentRoutes: {
      ...currentRoutes,
      reviewedRevisions: structuredClone(baseRoutes.reviewedRevisions ?? []),
    },
    evidenceFiles,
  })
  const actual = readJson(resolve(root, pr10ContractRevisionPath))
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    errors.push("PR-10 reviewed contract revision does not match exact changes")
  }

  const expectedRevisionHistory = [
    ...(baseRoutes.reviewedRevisions ?? []),
    {
      id: "PR-10",
      path: pr10ContractRevisionPath,
      sha256: sha256(readFileSync(resolve(root, pr10ContractRevisionPath))),
    },
  ]
  if (
    JSON.stringify(currentRoutes.reviewedRevisions ?? []) !==
    JSON.stringify(expectedRevisionHistory)
  ) {
    errors.push("reviewed contract revision history changed")
  }
  errors.push(...verifyRequiredRoutes(currentRoutes))
  errors.push(
    ...verifyPr10CandidateContract({
      root,
      baseAllowlist,
      currentAllowlist,
      baseRoutes,
      currentRoutes,
      operationPolicy: decision.operationPolicy,
    }),
  )

  return { present: true, id: "PR-10", errors: errors.sort() }
}

function verifyPr10LaneLineage(root) {
  const anchor = resolveCommit(root, pr10LaneAnchor)
  if (anchor !== pr10LaneAnchor) {
    return [`PR-10 lane anchor is unavailable ${pr10LaneAnchor}`]
  }
  const head = currentHead(root)
  if (head === pr10LaneAnchor) {
    return []
  }
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", pr10LaneAnchor, head], {
      cwd: root,
      stdio: "ignore",
    })
    return []
  } catch {
    return [`PR-10 lane anchor is not an ancestor ${pr10LaneAnchor}`]
  }
}

function verifyIntroducedPr09Revision({
  root,
  baseCommit,
  baseAllowlist,
  currentAllowlist,
  baseRoutes,
  currentRoutes,
}) {
  const errors = []
  if (baseCommit !== pr09ContractBase) {
    errors.push(
      `PR-09 contract revision base changed expected=${pr09ContractBase} actual=${baseCommit}`,
    )
  }
  if (resolveTree(root, baseCommit) !== pr09ContractBaseTree) {
    errors.push("PR-09 contract base tree changed")
  }
  errors.push(...verifyPr09LaneLineage(root))
  errors.push(...verifyPr09BaseEvidence(root))
  const baseRevisionHistory = baseRoutes.reviewedRevisions ?? []
  const expectedPriorIds = [
    "PR-02",
    "PR-03",
    "PR-04",
    "PR-05",
    "PR-06",
    "PR-07",
    "PR-08",
  ]
  if (
    baseRevisionHistory.length !== expectedPriorIds.length ||
    expectedPriorIds.some((id, index) => baseRevisionHistory[index]?.id !== id)
  ) {
    errors.push(
      "PR-09 requires the exact retained PR-02 through PR-08 revision history",
    )
  } else {
    errors.push(
      ...verifyRetainedPr02RevisionEvidence(root, baseRevisionHistory[0]),
      ...verifyRetainedPr03RevisionEvidence(root, baseRevisionHistory[1]),
      ...verifyRetainedPr04RevisionEvidence(root, baseRevisionHistory[2]),
      ...verifyRetainedPr05RevisionEvidence(root, baseRevisionHistory[3]),
      ...verifyRetainedPr06RevisionEvidence(root, baseRevisionHistory[4]),
      ...verifyRetainedPr07RevisionEvidence(root, baseRevisionHistory[5]),
      ...verifyRetainedPr08RevisionEvidence(root, baseRevisionHistory[6]),
    )
  }
  if (!isRegularFile(resolve(root, pr09ContractRevisionPath))) {
    return {
      present: true,
      id: "PR-09",
      errors: [
        ...errors,
        `missing reviewed contract revision ${pr09ContractRevisionPath}`,
      ].sort(),
    }
  }

  const decision = readPr09DecisionDocument(root)
  errors.push(...verifyPr09DecisionDocument(decision, { requireReady: true }))
  const evidenceFiles = buildRevisionEvidenceFingerprints(
    root,
    pr09RevisionEvidencePaths,
    "PR-09",
  )
  const expected = buildContractRevisionDocument({
    revisionId: "PR-09",
    scope: "activity-audit-observability-source-only",
    baseCommit,
    baseTree: resolveTree(root, baseCommit),
    baseAllowlist,
    currentAllowlist,
    baseRoutes,
    currentRoutes: {
      ...currentRoutes,
      reviewedRevisions: structuredClone(baseRoutes.reviewedRevisions ?? []),
    },
    evidenceFiles,
  })
  const actual = readJson(resolve(root, pr09ContractRevisionPath))
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    errors.push("PR-09 reviewed contract revision does not match exact changes")
  }

  const expectedRevisionHistory = [
    ...(baseRoutes.reviewedRevisions ?? []),
    {
      id: "PR-09",
      path: pr09ContractRevisionPath,
      sha256: sha256(readFileSync(resolve(root, pr09ContractRevisionPath))),
    },
  ]
  if (
    JSON.stringify(currentRoutes.reviewedRevisions ?? []) !==
    JSON.stringify(expectedRevisionHistory)
  ) {
    errors.push("reviewed contract revision history changed")
  }
  errors.push(...verifyRequiredRoutes(currentRoutes))
  errors.push(
    ...verifyPr09CandidateContract({
      root,
      baseAllowlist,
      currentAllowlist,
      baseRoutes,
      currentRoutes,
      operationPolicy: decision.operationPolicy,
    }),
  )

  return { present: true, id: "PR-09", errors: errors.sort() }
}

function verifyPr09LaneLineage(root) {
  const anchor = resolveCommit(root, pr09LaneAnchor)
  if (anchor !== pr09LaneAnchor) {
    return [`PR-09 lane anchor is unavailable ${pr09LaneAnchor}`]
  }
  const head = currentHead(root)
  if (head === pr09LaneAnchor) {
    return []
  }
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", pr09LaneAnchor, head], {
      cwd: root,
      stdio: "ignore",
    })
    return []
  } catch {
    return [`PR-09 lane anchor is not an ancestor ${pr09LaneAnchor}`]
  }
}

function verifyIntroducedPr08Revision({
  root,
  baseCommit,
  baseAllowlist,
  currentAllowlist,
  baseRoutes,
  currentRoutes,
}) {
  const errors = []
  if (baseCommit !== pr08ContractBase) {
    errors.push(
      `PR-08 contract revision base changed expected=${pr08ContractBase} actual=${baseCommit}`,
    )
  }
  if (resolveTree(root, baseCommit) !== pr08ContractBaseTree) {
    errors.push("PR-08 contract base tree changed")
  }
  errors.push(...verifyPr08LaneLineage(root))
  errors.push(...verifyPr08BaseEvidence(root))
  errors.push(...verifyPr08PilotAncestry(root))
  const baseRevisionHistory = baseRoutes.reviewedRevisions ?? []
  const expectedPriorIds = [
    "PR-02",
    "PR-03",
    "PR-04",
    "PR-05",
    "PR-06",
    "PR-07",
  ]
  if (
    baseRevisionHistory.length !== expectedPriorIds.length ||
    expectedPriorIds.some((id, index) => baseRevisionHistory[index]?.id !== id)
  ) {
    errors.push(
      "PR-08 requires the exact retained PR-02 through PR-07 revision history",
    )
  } else {
    errors.push(
      ...verifyRetainedPr02RevisionEvidence(root, baseRevisionHistory[0]),
      ...verifyRetainedPr03RevisionEvidence(root, baseRevisionHistory[1]),
      ...verifyRetainedPr04RevisionEvidence(root, baseRevisionHistory[2]),
      ...verifyRetainedPr05RevisionEvidence(root, baseRevisionHistory[3]),
      ...verifyRetainedPr06RevisionEvidence(root, baseRevisionHistory[4]),
      ...verifyRetainedPr07RevisionEvidence(root, baseRevisionHistory[5]),
    )
  }
  if (!isRegularFile(resolve(root, pr08ContractRevisionPath))) {
    return {
      present: true,
      id: "PR-08",
      errors: [
        ...errors,
        `missing reviewed contract revision ${pr08ContractRevisionPath}`,
      ].sort(),
    }
  }

  const decision = readPr08DecisionDocument(root)
  errors.push(...verifyPr08DecisionDocument(decision, { requireReady: true }))
  errors.push(
    ...verifyPr08SourceManifestDocument(readPr08SourceManifestDocument(root)),
  )
  errors.push(
    ...verifyPr08SourceMapDocument(
      readFileSync(resolve(root, pr08SourceMapPath), "utf8"),
    ),
  )
  const evidenceFiles = buildRevisionEvidenceFingerprints(
    root,
    pr08RevisionEvidencePaths,
    "PR-08",
  )
  const expected = buildContractRevisionDocument({
    revisionId: "PR-08",
    scope: "firecrawl-search-static-scrape-source-only",
    baseCommit,
    baseTree: resolveTree(root, baseCommit),
    baseAllowlist,
    currentAllowlist,
    baseRoutes,
    currentRoutes: {
      ...currentRoutes,
      reviewedRevisions: structuredClone(baseRoutes.reviewedRevisions ?? []),
    },
    evidenceFiles,
  })
  const actual = readJson(resolve(root, pr08ContractRevisionPath))
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    errors.push("PR-08 reviewed contract revision does not match exact changes")
  }

  const expectedRevisionHistory = [
    ...(baseRoutes.reviewedRevisions ?? []),
    {
      id: "PR-08",
      path: pr08ContractRevisionPath,
      sha256: sha256(readFileSync(resolve(root, pr08ContractRevisionPath))),
    },
  ]
  if (
    JSON.stringify(currentRoutes.reviewedRevisions ?? []) !==
    JSON.stringify(expectedRevisionHistory)
  ) {
    errors.push("reviewed contract revision history changed")
  }
  errors.push(...verifyRequiredRoutes(currentRoutes))
  errors.push(
    ...verifyPr08CandidateContract({
      root,
      baseAllowlist,
      currentAllowlist,
      baseRoutes,
      currentRoutes,
      operationPolicy: decision.operationPolicy,
    }),
  )

  return { present: true, id: "PR-08", errors: errors.sort() }
}

function verifyPr08LaneLineage(root) {
  const anchor = resolveCommit(root, pr08LaneAnchor)
  if (anchor !== pr08LaneAnchor) {
    return [`PR-08 lane anchor is unavailable ${pr08LaneAnchor}`]
  }
  const head = currentHead(root)
  if (head === pr08LaneAnchor) {
    return []
  }
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", pr08LaneAnchor, head], {
      cwd: root,
      stdio: "ignore",
    })
    return []
  } catch {
    return [`PR-08 lane anchor is not an ancestor ${pr08LaneAnchor}`]
  }
}

function verifyIntroducedPr07Revision({
  root,
  baseCommit,
  baseAllowlist,
  currentAllowlist,
  baseRoutes,
  currentRoutes,
}) {
  const errors = []
  if (baseCommit !== pr07ContractBase) {
    errors.push(
      `PR-07 contract revision base changed expected=${pr07ContractBase} actual=${baseCommit}`,
    )
  }
  errors.push(...verifyPr07LaneLineage(root))
  errors.push(...verifyPr07BaseEvidence(root))
  const baseRevisionHistory = baseRoutes.reviewedRevisions ?? []
  if (
    baseRevisionHistory.length !== 5 ||
    baseRevisionHistory[0]?.id !== "PR-02" ||
    baseRevisionHistory[1]?.id !== "PR-03" ||
    baseRevisionHistory[2]?.id !== "PR-04" ||
    baseRevisionHistory[3]?.id !== "PR-05" ||
    baseRevisionHistory[4]?.id !== "PR-06"
  ) {
    errors.push(
      "PR-07 requires the exact retained PR-02 through PR-06 revision history",
    )
  } else {
    errors.push(
      ...verifyRetainedPr02RevisionEvidence(root, baseRevisionHistory[0]),
      ...verifyRetainedPr03RevisionEvidence(root, baseRevisionHistory[1]),
      ...verifyRetainedPr04RevisionEvidence(root, baseRevisionHistory[2]),
      ...verifyRetainedPr05RevisionEvidence(root, baseRevisionHistory[3]),
      ...verifyRetainedPr06RevisionEvidence(root, baseRevisionHistory[4]),
    )
  }
  if (!isRegularFile(resolve(root, pr07ContractRevisionPath))) {
    return {
      present: true,
      id: "PR-07",
      errors: [
        ...errors,
        `missing reviewed contract revision ${pr07ContractRevisionPath}`,
      ].sort(),
    }
  }

  const decision = readPr07DecisionDocument(root)
  errors.push(
    ...verifyPr07DecisionDocument(decision, {
      requireReady: true,
    }),
  )
  const evidenceFiles = buildRevisionEvidenceFingerprints(
    root,
    pr07RevisionEvidencePaths,
    "PR-07",
  )
  const expected = buildContractRevisionDocument({
    revisionId: "PR-07",
    scope: "inference-data-plane",
    baseCommit,
    baseTree: resolveTree(root, baseCommit),
    baseAllowlist,
    currentAllowlist,
    baseRoutes,
    currentRoutes: {
      ...currentRoutes,
      reviewedRevisions: structuredClone(baseRoutes.reviewedRevisions ?? []),
    },
    evidenceFiles,
  })
  const actual = readJson(resolve(root, pr07ContractRevisionPath))
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    errors.push("PR-07 reviewed contract revision does not match exact changes")
  }

  const expectedRevisionHistory = [
    ...(baseRoutes.reviewedRevisions ?? []),
    {
      id: "PR-07",
      path: pr07ContractRevisionPath,
      sha256: sha256(readFileSync(resolve(root, pr07ContractRevisionPath))),
    },
  ]
  if (
    JSON.stringify(currentRoutes.reviewedRevisions ?? []) !==
    JSON.stringify(expectedRevisionHistory)
  ) {
    errors.push("reviewed contract revision history changed")
  }
  errors.push(...verifyRequiredRoutes(currentRoutes))
  errors.push(
    ...verifyPr07CandidateContract({
      root,
      baseAllowlist,
      currentAllowlist,
      baseRoutes,
      currentRoutes,
      operationPolicy: decision.operationPolicy,
    }),
  )

  return { present: true, id: "PR-07", errors: errors.sort() }
}

function verifyPr07LaneLineage(root) {
  const anchor = resolveCommit(root, pr07LaneAnchor)
  if (anchor !== pr07LaneAnchor) {
    return [`PR-07 lane anchor is unavailable ${pr07LaneAnchor}`]
  }
  const head = currentHead(root)
  if (head === pr07LaneAnchor) {
    return []
  }
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", pr07LaneAnchor, head], {
      cwd: root,
      stdio: "ignore",
    })
    return []
  } catch {
    return [`PR-07 lane anchor is not an ancestor ${pr07LaneAnchor}`]
  }
}

function verifyIntroducedPr06Revision({
  root,
  baseCommit,
  baseAllowlist,
  currentAllowlist,
  baseRoutes,
  currentRoutes,
}) {
  const errors = []
  if (baseCommit !== pr06ContractBase) {
    errors.push(
      `PR-06 contract revision base changed expected=${pr06ContractBase} actual=${baseCommit}`,
    )
  }
  errors.push(...verifyPr06LaneLineage(root))
  errors.push(...verifyPr06BaseEvidence(root))
  const baseRevisionHistory = baseRoutes.reviewedRevisions ?? []
  if (
    baseRevisionHistory.length !== 4 ||
    baseRevisionHistory[0]?.id !== "PR-02" ||
    baseRevisionHistory[1]?.id !== "PR-03" ||
    baseRevisionHistory[2]?.id !== "PR-04" ||
    baseRevisionHistory[3]?.id !== "PR-05"
  ) {
    errors.push(
      "PR-06 requires the exact retained PR-02, PR-03, PR-04, and PR-05 revision history",
    )
  } else {
    errors.push(
      ...verifyRetainedPr02RevisionEvidence(root, baseRevisionHistory[0]),
      ...verifyRetainedPr03RevisionEvidence(root, baseRevisionHistory[1]),
      ...verifyRetainedPr04RevisionEvidence(root, baseRevisionHistory[2]),
      ...verifyRetainedPr05RevisionEvidence(root, baseRevisionHistory[3]),
    )
  }
  if (!isRegularFile(resolve(root, pr06ContractRevisionPath))) {
    return {
      present: true,
      id: "PR-06",
      errors: [
        ...errors,
        `missing reviewed contract revision ${pr06ContractRevisionPath}`,
      ].sort(),
    }
  }

  const decision = readPr06DecisionDocument(root)
  errors.push(
    ...verifyPr06DecisionDocument(decision, {
      requireReady: true,
    }),
  )
  const evidenceFiles = buildRevisionEvidenceFingerprints(
    root,
    pr06RevisionEvidencePaths,
    "PR-06",
  )
  const expected = buildContractRevisionDocument({
    revisionId: "PR-06",
    scope: "application-control-plane",
    baseCommit,
    baseTree: resolveTree(root, baseCommit),
    baseAllowlist,
    currentAllowlist,
    baseRoutes,
    currentRoutes: {
      ...currentRoutes,
      reviewedRevisions: structuredClone(baseRoutes.reviewedRevisions ?? []),
    },
    evidenceFiles,
  })
  const actual = readJson(resolve(root, pr06ContractRevisionPath))
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    errors.push("PR-06 reviewed contract revision does not match exact changes")
  }

  const expectedRevisionHistory = [
    ...(baseRoutes.reviewedRevisions ?? []),
    {
      id: "PR-06",
      path: pr06ContractRevisionPath,
      sha256: sha256(readFileSync(resolve(root, pr06ContractRevisionPath))),
    },
  ]
  if (
    JSON.stringify(currentRoutes.reviewedRevisions ?? []) !==
    JSON.stringify(expectedRevisionHistory)
  ) {
    errors.push("reviewed contract revision history changed")
  }
  errors.push(...verifyRequiredRoutes(currentRoutes))
  errors.push(
    ...verifyPr06CandidateContract({
      root,
      baseAllowlist,
      currentAllowlist,
      baseRoutes,
      currentRoutes,
      operationPolicy: decision.operationPolicy,
    }),
  )

  return { present: true, id: "PR-06", errors: errors.sort() }
}

function verifyPr06LaneLineage(root) {
  const anchor = resolveCommit(root, pr06LaneAnchor)
  if (anchor !== pr06LaneAnchor) {
    return [`PR-06 lane anchor is unavailable ${pr06LaneAnchor}`]
  }
  const head = currentHead(root)
  if (head === pr06LaneAnchor) {
    return []
  }
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", pr06LaneAnchor, head], {
      cwd: root,
      stdio: "ignore",
    })
    return []
  } catch {
    return [`PR-06 lane anchor is not an ancestor ${pr06LaneAnchor}`]
  }
}

function verifyRetainedPr02RevisionEvidence(root, revision) {
  const errors = []
  if (
    revision.id !== "PR-02" ||
    revision.path !== pr02ContractRevisionPath ||
    !/^[0-9a-f]{64}$/.test(revision.sha256 ?? "")
  ) {
    return ["invalid retained PR-02 revision identity"]
  }
  const absolutePath = resolve(root, pr02ContractRevisionPath)
  if (!isRegularFile(absolutePath)) {
    return [`missing reviewed contract revision ${pr02ContractRevisionPath}`]
  }
  if (sha256(readFileSync(absolutePath)) !== revision.sha256) {
    errors.push("retained PR-02 revision fingerprint changed")
  }
  const document = readJson(absolutePath)
  if (
    document.id !== "PR-02" ||
    document.baseCommit !== pr02IntegrationBase ||
    document.baseTree !== resolveTree(root, pr02IntegrationBase)
  ) {
    errors.push("retained PR-02 revision base identity changed")
  }
  if (
    JSON.stringify(document.evidenceFiles) !==
    JSON.stringify(
      buildRevisionEvidenceFingerprints(
        root,
        pr02RevisionEvidencePaths,
        "PR-02",
        {
          useHistoricalSuccessorTests: isRegularFile(
            resolve(root, pr09DecisionPath),
          ),
        },
      ),
    )
  ) {
    errors.push("retained PR-02 revision evidence changed")
  }
  return errors.sort()
}

function verifyRetainedPr03RevisionEvidence(root, revision) {
  const errors = []
  if (
    revision.id !== "PR-03" ||
    revision.path !== pr03ContractRevisionPath ||
    !/^[0-9a-f]{64}$/.test(revision.sha256 ?? "")
  ) {
    return ["invalid retained PR-03 revision identity"]
  }
  const absolutePath = resolve(root, pr03ContractRevisionPath)
  if (!isRegularFile(absolutePath)) {
    return [`missing reviewed contract revision ${pr03ContractRevisionPath}`]
  }
  if (sha256(readFileSync(absolutePath)) !== revision.sha256) {
    errors.push("retained PR-03 revision fingerprint changed")
  }
  const document = readJson(absolutePath)
  if (
    document.id !== "PR-03" ||
    document.scope !== "legacy-source-removal" ||
    document.baseCommit !== pr03ContractBase ||
    document.baseTree !== resolveTree(root, pr03ContractBase)
  ) {
    errors.push("retained PR-03 revision base identity changed")
  }
  if (
    JSON.stringify(document.evidenceFiles) !==
    JSON.stringify(
      buildRevisionEvidenceFingerprints(
        root,
        pr03RevisionEvidencePaths,
        "PR-03",
      ),
    )
  ) {
    errors.push("retained PR-03 revision evidence changed")
  }
  return errors.sort()
}

function verifyRetainedPr04RevisionEvidence(root, revision) {
  const errors = []
  if (
    revision.id !== "PR-04" ||
    revision.path !== pr04ContractRevisionPath ||
    !/^[0-9a-f]{64}$/.test(revision.sha256 ?? "")
  ) {
    return ["invalid retained PR-04 revision identity"]
  }
  const absolutePath = resolve(root, pr04ContractRevisionPath)
  if (!isRegularFile(absolutePath)) {
    return [`missing reviewed contract revision ${pr04ContractRevisionPath}`]
  }
  if (sha256(readFileSync(absolutePath)) !== revision.sha256) {
    errors.push("retained PR-04 revision fingerprint changed")
  }
  const document = readJson(absolutePath)
  if (
    document.id !== "PR-04" ||
    document.scope !== "data-retention-foundation" ||
    document.baseCommit !== pr04ContractBase ||
    document.baseTree !== resolveTree(root, pr04ContractBase)
  ) {
    errors.push("retained PR-04 revision base identity changed")
  }
  if (
    JSON.stringify(document.evidenceFiles) !==
    JSON.stringify(
      buildRevisionEvidenceFingerprints(
        root,
        pr04RevisionEvidencePaths,
        "PR-04",
      ),
    )
  ) {
    errors.push("retained PR-04 revision evidence changed")
  }
  errors.push(...verifyPr04BaseEvidence(root))
  return errors.sort()
}

function verifyRetainedPr05RevisionEvidence(root, revision) {
  const errors = []
  if (
    revision.id !== "PR-05" ||
    revision.path !== pr05ContractRevisionPath ||
    !/^[0-9a-f]{64}$/.test(revision.sha256 ?? "")
  ) {
    return ["invalid retained PR-05 revision identity"]
  }
  const absolutePath = resolve(root, pr05ContractRevisionPath)
  if (!isRegularFile(absolutePath)) {
    return [`missing reviewed contract revision ${pr05ContractRevisionPath}`]
  }
  if (sha256(readFileSync(absolutePath)) !== revision.sha256) {
    errors.push("retained PR-05 revision fingerprint changed")
  }
  const document = readJson(absolutePath)
  if (
    document.id !== "PR-05" ||
    document.scope !== "identity-authorization-emergency-recovery" ||
    document.baseCommit !== pr05ContractBase ||
    document.baseTree !== resolveTree(root, pr05ContractBase)
  ) {
    errors.push("retained PR-05 revision base identity changed")
  }
  if (
    JSON.stringify(document.evidenceFiles) !==
    JSON.stringify(
      buildRevisionEvidenceFingerprints(
        root,
        pr05RevisionEvidencePaths,
        "PR-05",
        {
          useHistoricalSuccessorTests: isRegularFile(
            resolve(root, pr09DecisionPath),
          ),
        },
      ),
    )
  ) {
    errors.push("retained PR-05 revision evidence changed")
  }
  errors.push(...verifyPr05BaseEvidence(root))
  return errors.sort()
}

function verifyRetainedPr06RevisionEvidence(root, revision) {
  const errors = []
  if (
    revision.id !== "PR-06" ||
    revision.path !== pr06ContractRevisionPath ||
    !/^[0-9a-f]{64}$/.test(revision.sha256 ?? "")
  ) {
    return ["invalid retained PR-06 revision identity"]
  }
  const absolutePath = resolve(root, pr06ContractRevisionPath)
  if (!isRegularFile(absolutePath)) {
    return [`missing reviewed contract revision ${pr06ContractRevisionPath}`]
  }
  if (sha256(readFileSync(absolutePath)) !== revision.sha256) {
    errors.push("retained PR-06 revision fingerprint changed")
  }
  const document = readJson(absolutePath)
  if (
    document.id !== "PR-06" ||
    document.scope !== "application-control-plane" ||
    document.baseCommit !== pr06ContractBase ||
    document.baseTree !== resolveTree(root, pr06ContractBase)
  ) {
    errors.push("retained PR-06 revision base identity changed")
  }
  if (
    JSON.stringify(document.evidenceFiles) !==
    JSON.stringify(
      buildRevisionEvidenceFingerprints(
        root,
        pr06RevisionEvidencePaths,
        "PR-06",
      ),
    )
  ) {
    errors.push("retained PR-06 revision evidence changed")
  }
  errors.push(...verifyPr06BaseEvidence(root))
  return errors.sort()
}

function verifyRetainedPr07RevisionEvidence(root, revision) {
  const errors = []
  if (
    revision.id !== "PR-07" ||
    revision.path !== pr07ContractRevisionPath ||
    !/^[0-9a-f]{64}$/.test(revision.sha256 ?? "")
  ) {
    return ["invalid retained PR-07 revision identity"]
  }
  const absolutePath = resolve(root, pr07ContractRevisionPath)
  if (!isRegularFile(absolutePath)) {
    return [`missing reviewed contract revision ${pr07ContractRevisionPath}`]
  }
  if (sha256(readFileSync(absolutePath)) !== revision.sha256) {
    errors.push("retained PR-07 revision fingerprint changed")
  }
  const document = readJson(absolutePath)
  if (
    document.id !== "PR-07" ||
    document.scope !== "inference-data-plane" ||
    document.baseCommit !== pr07ContractBase ||
    document.baseTree !== resolveTree(root, pr07ContractBase)
  ) {
    errors.push("retained PR-07 revision base identity changed")
  }
  if (
    JSON.stringify(document.evidenceFiles) !==
    JSON.stringify(
      buildRevisionEvidenceFingerprints(
        root,
        pr07RevisionEvidencePaths,
        "PR-07",
      ),
    )
  ) {
    errors.push("retained PR-07 revision evidence changed")
  }
  errors.push(...verifyPr07BaseEvidence(root))
  return errors.sort()
}

function verifyRetainedPr08RevisionEvidence(root, revision) {
  const errors = []
  if (
    revision.id !== "PR-08" ||
    revision.path !== pr08ContractRevisionPath ||
    !/^[0-9a-f]{64}$/.test(revision.sha256 ?? "")
  ) {
    return ["invalid retained PR-08 revision identity"]
  }
  const absolutePath = resolve(root, pr08ContractRevisionPath)
  if (!isRegularFile(absolutePath)) {
    return [`missing reviewed contract revision ${pr08ContractRevisionPath}`]
  }
  if (sha256(readFileSync(absolutePath)) !== revision.sha256) {
    errors.push("retained PR-08 revision fingerprint changed")
  }
  const document = readJson(absolutePath)
  if (
    document.id !== "PR-08" ||
    document.scope !== "firecrawl-search-static-scrape-source-only" ||
    document.baseCommit !== pr08ContractBase ||
    document.baseTree !== pr08ContractBaseTree
  ) {
    errors.push("retained PR-08 revision base identity changed")
  }
  if (
    JSON.stringify(document.evidenceFiles) !==
    JSON.stringify(
      buildRevisionEvidenceFingerprints(
        root,
        pr08RevisionEvidencePaths,
        "PR-08",
      ),
    )
  ) {
    errors.push("retained PR-08 revision evidence changed")
  }
  errors.push(...verifyPr08BaseEvidence(root))
  return errors.sort()
}

function verifyRetainedPr09RevisionEvidence(root, revision) {
  const errors = []
  if (
    revision.id !== "PR-09" ||
    revision.path !== pr09ContractRevisionPath ||
    !/^[0-9a-f]{64}$/.test(revision.sha256 ?? "")
  ) {
    return ["invalid retained PR-09 revision identity"]
  }
  const absolutePath = resolve(root, pr09ContractRevisionPath)
  if (!isRegularFile(absolutePath)) {
    return [`missing reviewed contract revision ${pr09ContractRevisionPath}`]
  }
  if (sha256(readFileSync(absolutePath)) !== revision.sha256) {
    errors.push("retained PR-09 revision fingerprint changed")
  }
  const document = readJson(absolutePath)
  if (
    document.id !== "PR-09" ||
    document.scope !== "activity-audit-observability-source-only" ||
    document.baseCommit !== pr09ContractBase ||
    document.baseTree !== pr09ContractBaseTree
  ) {
    errors.push("retained PR-09 revision base identity changed")
  }
  if (
    JSON.stringify(document.evidenceFiles) !==
    JSON.stringify(
      buildRevisionEvidenceFingerprints(
        root,
        pr09RevisionEvidencePaths,
        "PR-09",
      ),
    )
  ) {
    errors.push("retained PR-09 revision evidence changed")
  }
  errors.push(...verifyPr09BaseEvidence(root))
  return errors.sort()
}

function verifyRetainedPr10RevisionEvidence(root, revision) {
  const errors = []
  if (
    revision.id !== "PR-10" ||
    revision.path !== pr10ContractRevisionPath ||
    !/^[0-9a-f]{64}$/.test(revision.sha256 ?? "")
  ) {
    return ["invalid retained PR-10 revision identity"]
  }
  const absolutePath = resolve(root, pr10ContractRevisionPath)
  if (!isRegularFile(absolutePath)) {
    return [`missing reviewed contract revision ${pr10ContractRevisionPath}`]
  }
  if (sha256(readFileSync(absolutePath)) !== revision.sha256) {
    errors.push("retained PR-10 revision fingerprint changed")
  }
  const document = readJson(absolutePath)
  if (
    document.id !== "PR-10" ||
    document.scope !== "lifecycle-snapshot-restore-foundation-source-only" ||
    document.baseCommit !== pr10ContractBase ||
    document.baseTree !== pr10ContractBaseTree
  ) {
    errors.push("retained PR-10 revision base identity changed")
  }
  if (
    JSON.stringify(document.evidenceFiles) !==
    JSON.stringify(
      buildRevisionEvidenceFingerprints(
        root,
        pr10RevisionEvidencePaths,
        "PR-10",
      ),
    )
  ) {
    errors.push("retained PR-10 revision evidence changed")
  }
  errors.push(...verifyPr10BaseEvidence(root))
  return errors.sort()
}

function verifyRetainedPr10cRevisionEvidence(root, revision) {
  const errors = []
  if (
    revision.id !== "PR-10C" ||
    revision.path !== pr10cContractRevisionPath ||
    !/^[0-9a-f]{64}$/.test(revision.sha256 ?? "")
  ) {
    return ["invalid retained PR-10C revision identity"]
  }
  const absolutePath = resolve(root, pr10cContractRevisionPath)
  if (!isRegularFile(absolutePath)) {
    return [`missing reviewed contract revision ${pr10cContractRevisionPath}`]
  }
  if (sha256(readFileSync(absolutePath)) !== revision.sha256) {
    errors.push("retained PR-10C revision fingerprint changed")
  }
  const document = readJson(absolutePath)
  if (
    document.id !== "PR-10C" ||
    document.scope !== "emergency-isolation-source-only" ||
    document.baseCommit !== pr10cContractBase ||
    document.baseTree !== pr10cContractBaseTree
  ) {
    errors.push("retained PR-10C revision base identity changed")
  }
  if (
    JSON.stringify(document.evidenceFiles) !==
    JSON.stringify(
      buildRevisionEvidenceFingerprints(
        root,
        pr10cRevisionEvidencePaths,
        "PR-10C",
      ),
    )
  ) {
    errors.push("retained PR-10C revision evidence changed")
  }
  errors.push(...verifyPr10cBaseEvidence(root))
  return errors.sort()
}

function verifyRetainedPr11RevisionEvidence(root, revision) {
  const errors = []
  if (
    revision.id !== "PR-11" ||
    revision.path !== pr11ContractRevisionPath ||
    !/^[0-9a-f]{64}$/.test(revision.sha256 ?? "")
  ) {
    return ["invalid retained PR-11 revision identity"]
  }
  const absolutePath = resolve(root, pr11ContractRevisionPath)
  if (!isRegularFile(absolutePath)) {
    return [`missing reviewed contract revision ${pr11ContractRevisionPath}`]
  }
  if (sha256(readFileSync(absolutePath)) !== revision.sha256) {
    errors.push("retained PR-11 revision fingerprint changed")
  }
  const document = readJson(absolutePath)
  if (
    document.id !== "PR-11" ||
    document.scope !==
      "retained-console-information-architecture-source-only" ||
    document.baseCommit !== pr11ContractBase ||
    document.baseTree !== pr11ContractBaseTree
  ) {
    errors.push("retained PR-11 revision base identity changed")
  }
  if (
    JSON.stringify(document.evidenceFiles) !==
    JSON.stringify(
      buildRevisionEvidenceFingerprints(
        root,
        pr11RevisionEvidencePaths,
        "PR-11",
      ),
    )
  ) {
    errors.push("retained PR-11 revision evidence changed")
  }
  errors.push(...verifyPr11BaseEvidence(root))
  return errors.sort()
}

export function verifyPr10cBaseEvidence(root = repositoryRoot) {
  const errors = []
  for (const path of pr10cImmutablePriorEvidencePaths) {
    let expected
    try {
      expected = readRepositoryPathAtCommit(root, pr10cContractBase, path)
    } catch {
      errors.push(`PR-10C immutable base evidence is unavailable ${path}`)
      continue
    }
    const absolutePath = resolve(root, path)
    if (!isRegularFile(absolutePath)) {
      errors.push(`PR-10C retained prior evidence is missing ${path}`)
      continue
    }
    if (pr10cSuccessorAwareHistoricalTestPaths.includes(path)) {
      continue
    }
    let retainedBytes
    try {
      const successorHistoricalCommit =
        pr10cSuccessorHistoricalEvidenceCommitByPath.get(path)
      retainedBytes = successorHistoricalCommit
        ? readRepositoryPathAtCommit(root, successorHistoricalCommit, path)
        : readRetainedEvidenceBytes(root, path, absolutePath)
    } catch {
      errors.push(`PR-10C retained prior evidence is unavailable ${path}`)
      continue
    }
    if (!retainedBytes.equals(expected)) {
      errors.push(`PR-10C retained prior evidence changed ${path}`)
    }
  }
  return errors.sort()
}

export function verifyPr10BaseEvidence(root = repositoryRoot) {
  const errors = []
  for (const path of pr10ImmutablePriorEvidencePaths) {
    let expected
    try {
      expected = execFileSync(
        "git",
        [
          "show",
          "--no-ext-diff",
          "--no-textconv",
          "--end-of-options",
          `${pr10ContractBase}:${path}`,
        ],
        {
          cwd: root,
          encoding: null,
          stdio: ["ignore", "pipe", "pipe"],
        },
      )
    } catch {
      errors.push(`PR-10 immutable base evidence is unavailable ${path}`)
      continue
    }
    const absolutePath = resolve(root, path)
    if (!isRegularFile(absolutePath)) {
      errors.push(`PR-10 retained prior evidence is missing ${path}`)
      continue
    }
    const retainedBytes =
      readPr11aR1C0HistoricalPriorEvidence(root, path) ??
      (pr11SuccessorHistoricalEvidencePaths.includes(path)
        ? readRetainedEvidenceBytes(root, path, absolutePath)
        : pr10cSuccessorAwareHistoricalTestPaths.includes(path)
          ? readRepositoryPathAtCommit(root, pr10cContractBase, path)
          : readFileSync(absolutePath))
    if (!retainedBytes.equals(expected)) {
      errors.push(`PR-10 retained prior evidence changed ${path}`)
    }
  }
  return errors.sort()
}

export function verifyPr09BaseEvidence(root = repositoryRoot) {
  const errors = []
  for (const path of pr09ImmutablePriorEvidencePaths) {
    let expected
    try {
      expected = execFileSync(
        "git",
        [
          "show",
          "--no-ext-diff",
          "--no-textconv",
          "--end-of-options",
          `${pr09ContractBase}:${path}`,
        ],
        {
          cwd: root,
          encoding: null,
          stdio: ["ignore", "pipe", "pipe"],
        },
      )
    } catch {
      errors.push(`PR-09 immutable base evidence is unavailable ${path}`)
      continue
    }
    const absolutePath = resolve(root, path)
    if (!isRegularFile(absolutePath)) {
      errors.push(`PR-09 retained prior evidence is missing ${path}`)
      continue
    }
    if (!readRetainedEvidenceBytes(root, path, absolutePath).equals(expected)) {
      errors.push(`PR-09 retained prior evidence changed ${path}`)
    }
  }
  return errors.sort()
}

export function verifyPr08BaseEvidence(root = repositoryRoot) {
  const errors = []
  for (const path of pr08ImmutablePriorEvidencePaths) {
    let expected
    try {
      expected = execFileSync(
        "git",
        [
          "show",
          "--no-ext-diff",
          "--no-textconv",
          "--end-of-options",
          `${pr08ContractBase}:${path}`,
        ],
        {
          cwd: root,
          encoding: null,
          stdio: ["ignore", "pipe", "pipe"],
        },
      )
    } catch {
      errors.push(`PR-08 immutable base evidence is unavailable ${path}`)
      continue
    }
    const absolutePath = resolve(root, path)
    if (!isRegularFile(absolutePath)) {
      errors.push(`PR-08 retained prior evidence is missing ${path}`)
      continue
    }
    if (!readRetainedEvidenceBytes(root, path, absolutePath).equals(expected)) {
      errors.push(`PR-08 retained prior evidence changed ${path}`)
    }
  }
  return errors.sort()
}

export function verifyPr07BaseEvidence(root = repositoryRoot) {
  const errors = []
  for (const path of pr07ImmutablePriorEvidencePaths) {
    let expected
    try {
      expected = execFileSync(
        "git",
        [
          "show",
          "--no-ext-diff",
          "--no-textconv",
          "--end-of-options",
          `${pr07ContractBase}:${path}`,
        ],
        {
          cwd: root,
          encoding: null,
          stdio: ["ignore", "pipe", "pipe"],
        },
      )
    } catch {
      errors.push(`PR-07 immutable base evidence is unavailable ${path}`)
      continue
    }
    const absolutePath = resolve(root, path)
    if (!isRegularFile(absolutePath)) {
      errors.push(`PR-07 retained prior evidence is missing ${path}`)
      continue
    }
    if (!readRetainedEvidenceBytes(root, path, absolutePath).equals(expected)) {
      errors.push(`PR-07 retained prior evidence changed ${path}`)
    }
  }
  return errors.sort()
}

export function verifyPr06BaseEvidence(root = repositoryRoot) {
  const errors = []
  for (const path of pr06ImmutablePriorEvidencePaths) {
    let expected
    try {
      expected = execFileSync(
        "git",
        [
          "show",
          "--no-ext-diff",
          "--no-textconv",
          "--end-of-options",
          `${pr06ContractBase}:${path}`,
        ],
        {
          cwd: root,
          encoding: null,
          stdio: ["ignore", "pipe", "pipe"],
        },
      )
    } catch {
      errors.push(`PR-06 immutable base evidence is unavailable ${path}`)
      continue
    }
    const absolutePath = resolve(root, path)
    if (!isRegularFile(absolutePath)) {
      errors.push(`PR-06 retained prior evidence is missing ${path}`)
      continue
    }
    if (!readRetainedEvidenceBytes(root, path, absolutePath).equals(expected)) {
      errors.push(`PR-06 retained prior evidence changed ${path}`)
    }
  }
  return errors.sort()
}

export function verifyPr05BaseEvidence(root = repositoryRoot) {
  const errors = []
  for (const path of pr05ImmutablePriorEvidencePaths) {
    let expected
    try {
      expected = execFileSync(
        "git",
        [
          "show",
          "--no-ext-diff",
          "--no-textconv",
          "--end-of-options",
          `${pr05ContractBase}:${path}`,
        ],
        {
          cwd: root,
          encoding: null,
          stdio: ["ignore", "pipe", "pipe"],
        },
      )
    } catch {
      errors.push(`PR-05 immutable base evidence is unavailable ${path}`)
      continue
    }
    const absolutePath = resolve(root, path)
    if (!isRegularFile(absolutePath)) {
      errors.push(`PR-05 retained prior evidence is missing ${path}`)
      continue
    }
    if (!readRetainedEvidenceBytes(root, path, absolutePath).equals(expected)) {
      errors.push(`PR-05 retained prior evidence changed ${path}`)
    }
  }
  return errors.sort()
}

export function verifyPr04BaseEvidence(root = repositoryRoot) {
  const errors = []
  for (const path of pr04ImmutablePriorEvidencePaths) {
    let expected
    try {
      expected = execFileSync(
        "git",
        [
          "show",
          "--no-ext-diff",
          "--no-textconv",
          "--end-of-options",
          `${pr04ContractBase}:${path}`,
        ],
        {
          cwd: root,
          encoding: null,
          stdio: ["ignore", "pipe", "pipe"],
        },
      )
    } catch {
      errors.push(`PR-04 immutable base evidence is unavailable ${path}`)
      continue
    }
    const absolutePath = resolve(root, path)
    if (!isRegularFile(absolutePath)) {
      errors.push(`PR-04 retained prior evidence is missing ${path}`)
      continue
    }
    if (!readRetainedEvidenceBytes(root, path, absolutePath).equals(expected)) {
      errors.push(`PR-04 retained prior evidence changed ${path}`)
    }
  }
  return errors.sort()
}

export function verifyPr03BaseEvidence(root = repositoryRoot) {
  const errors = []
  for (const path of [pr02ContractRevisionPath, ...pr02RevisionEvidencePaths]) {
    let expected
    try {
      expected = execFileSync(
        "git",
        [
          "show",
          "--no-ext-diff",
          "--no-textconv",
          "--end-of-options",
          `${pr03ContractBase}:${path}`,
        ],
        {
          cwd: root,
          encoding: null,
          stdio: ["ignore", "pipe", "pipe"],
        },
      )
    } catch {
      errors.push(`PR-03 immutable base evidence is unavailable ${path}`)
      continue
    }
    const absolutePath = resolve(root, path)
    if (!isRegularFile(absolutePath)) {
      errors.push(`PR-03 retained PR-02 evidence is missing ${path}`)
      continue
    }
    if (!readRetainedEvidenceBytes(root, path, absolutePath).equals(expected)) {
      errors.push(`PR-03 retained PR-02 evidence changed ${path}`)
    }
  }
  return errors.sort()
}

export function verifyPr02OperationMatrix(
  base,
  current,
  policy = pr02OperationPolicy,
) {
  const errors = [
    ...verifyExactMultisetSubset(
      base.routes ?? [],
      current.routes ?? [],
      "PR-02 route added or changed",
    ),
    ...verifyExactMultisetSubset(
      base.fastifyRegistrars ?? [],
      current.fastifyRegistrars ?? [],
      "PR-02 Fastify registrar added or changed",
    ),
    ...verifyExactMultisetSubset(
      base.webInferenceConsumers ?? [],
      current.webInferenceConsumers ?? [],
      "PR-02 Web inference consumer added or changed",
    ),
    ...verifyRequiredWebAuthBoundary(base, current),
  ]

  errors.push(
    ...verifyPr02EscapeHatches(
      base.escapeHatches ?? [],
      current.escapeHatches ?? [],
      policy.mutableEscapeHatchPaths ?? [],
    ),
  )
  errors.push(
    ...verifyPr02SourceChanges(
      base.sourceClosure ?? [],
      current.sourceClosure ?? [],
      policy,
    ),
  )
  errors.push(
    ...verifyPr02RepositoryChanges(
      base.repositoryClosure ?? [],
      current.repositoryClosure ?? [],
      policy,
    ),
  )

  return errors.sort()
}

function verifyExactMultisetSubset(base, current, errorPrefix) {
  const available = new Map()
  for (const entry of base) {
    const serialized = JSON.stringify(entry)
    available.set(serialized, (available.get(serialized) ?? 0) + 1)
  }
  const errors = []
  for (const entry of current) {
    const serialized = JSON.stringify(entry)
    const count = available.get(serialized) ?? 0
    if (count === 0) {
      errors.push(`${errorPrefix} ${serialized}`)
    } else {
      available.set(serialized, count - 1)
    }
  }
  return errors.sort()
}

function verifyPr02EscapeHatches(base, current, mutablePaths) {
  const policyErrors = verifyExactPathPolicy(
    {
      mutableEscapeHatchPaths: mutablePaths,
    },
    ["mutableEscapeHatchPaths"],
  )
  const mutable = new Set(mutablePaths)
  const baseByPath = uniqueEntriesByPath(
    base,
    "base escape hatch",
    policyErrors,
  )
  const currentByPath = uniqueEntriesByPath(
    current,
    "current escape hatch",
    policyErrors,
  )
  const changed = []
  for (const path of [
    ...new Set([...baseByPath.keys(), ...currentByPath.keys()]),
  ]) {
    const before = baseByPath.get(path)
    const after = currentByPath.get(path)
    if (JSON.stringify(before) === JSON.stringify(after)) {
      continue
    }
    changed.push(path)
    if (!mutable.has(path) || !before || !after) {
      policyErrors.push(`PR-02 escape hatch changed outside policy ${path}`)
    }
  }
  if (JSON.stringify(changed.sort()) !== JSON.stringify([...mutable].sort())) {
    policyErrors.push(
      `PR-02 escape hatch change set differs expected=${[...mutable]
        .sort()
        .join(",")} actual=${changed.sort().join(",")}`,
    )
  }
  return policyErrors.sort()
}

function verifyPr02SourceChanges(base, current, policy) {
  return verifyPr02ClosureChanges(base, current, policy, {
    addedKey: "addedSourcePaths",
    changedKey: "changedSourcePaths",
    deletedKey: "deletedSourcePaths",
    label: "source closure",
  })
}

function verifyPr02RepositoryChanges(base, current, policy) {
  return verifyPr02ClosureChanges(base, current, policy, {
    addedKey: "addedRepositoryPaths",
    changedKey: "changedRepositoryPaths",
    deletedKey: "deletedRepositoryPaths",
    label: "repository closure",
  })
}

function verifyPr02ClosureChanges(
  base,
  current,
  policy,
  { addedKey, changedKey, deletedKey, label },
) {
  const errors = verifyExactPathPolicy(policy, [
    addedKey,
    changedKey,
    deletedKey,
  ])
  const baseByPath = uniqueEntriesByPath(base, `base ${label}`, errors)
  const currentByPath = uniqueEntriesByPath(current, `current ${label}`, errors)
  const actual = {
    [addedKey]: [],
    [changedKey]: [],
    [deletedKey]: [],
  }
  for (const path of [
    ...new Set([...baseByPath.keys(), ...currentByPath.keys()]),
  ]) {
    const before = baseByPath.get(path)
    const after = currentByPath.get(path)
    if (!before) {
      actual[addedKey].push(path)
    } else if (!after) {
      actual[deletedKey].push(path)
    } else if (JSON.stringify(before) !== JSON.stringify(after)) {
      actual[changedKey].push(path)
    }
  }
  for (const key of Object.keys(actual)) {
    const expectedPaths = [...(policy[key] ?? [])].sort()
    const actualPaths = actual[key].sort()
    if (JSON.stringify(expectedPaths) !== JSON.stringify(actualPaths)) {
      errors.push(
        `PR-02 ${key} differ expected=${expectedPaths.join(",")} actual=${actualPaths.join(",")}`,
      )
    }
  }
  return errors.sort()
}

function verifyExactPathPolicy(policy, keys, workPackage = "PR-02") {
  const errors = []
  const allPaths = []
  for (const key of keys) {
    const paths = policy[key] ?? []
    if (
      !Array.isArray(paths) ||
      paths.some((path) => typeof path !== "string" || path.length === 0) ||
      JSON.stringify(paths) !== JSON.stringify([...paths].sort()) ||
      new Set(paths).size !== paths.length
    ) {
      errors.push(`invalid ${workPackage} operation policy ${key}`)
    }
    allPaths.push(...paths.map((path) => `${key}\0${path}`))
  }
  const pathsWithoutCategory = allPaths.map((entry) => entry.split("\0")[1])
  if (new Set(pathsWithoutCategory).size !== pathsWithoutCategory.length) {
    errors.push(
      `${workPackage} operation policy path appears in multiple categories`,
    )
  }
  return errors
}

function uniqueEntriesByPath(entries, label, errors) {
  const byPath = new Map()
  for (const entry of entries) {
    if (typeof entry?.path !== "string" || byPath.has(entry.path)) {
      errors.push(`invalid ${label} ${String(entry?.path)}`)
      continue
    }
    byPath.set(entry.path, entry)
  }
  return byPath
}

export function readPr03DecisionDocument(root = repositoryRoot) {
  return readJson(resolve(root, pr03DecisionPath))
}

export function verifyPr03DecisionDocument(
  decision,
  { requireReady = false } = {},
) {
  const errors = []
  const expectedKeys = [
    "contractBaseCommit",
    "findingDispositionOverrides",
    "ignoredFalsePositives",
    "laneAnchorCommit",
    "operationPolicy",
    "resolverFingerprints",
    "reviewStatus",
    "schemaVersion",
    "scope",
    "target",
    "webAuthenticationEvidence",
    "workPackage",
  ]
  const expectedOverrides = findingDispositionOverrides.map(
    ({ ruleId, path, from, removeBy, reason }) => ({
      ruleId,
      path,
      from,
      to: removeBy,
      reason,
    }),
  )
  const expectedIgnoredFalsePositives = ignoredFindingFingerprints.map(
    ({ ruleId, path, fingerprint, reason }) => ({
      ruleId,
      path,
      fingerprint,
      reason,
    }),
  )
  const expectedTarget = {
    findingEntriesDueByPr03: 0,
    legacyRoutes: 0,
    routes: 79,
    fastifyRegistrars: 3,
    webInferenceConsumers: 0,
    escapeHatchPaths: ["apps/bff/src/auth/persona.ts"],
  }
  if (
    !decision ||
    JSON.stringify(Object.keys(decision).sort()) !==
      JSON.stringify(expectedKeys) ||
    decision.schemaVersion !== 1 ||
    decision.workPackage !== "PR-03" ||
    decision.scope !== "legacy-source-removal" ||
    decision.contractBaseCommit !== pr03ContractBase ||
    decision.laneAnchorCommit !== pr03LaneAnchor
  ) {
    errors.push("invalid PR-03 decision identity")
  }
  if (
    JSON.stringify(decision?.findingDispositionOverrides) !==
    JSON.stringify(expectedOverrides)
  ) {
    errors.push("invalid PR-03 finding disposition overrides")
  }
  if (
    JSON.stringify(decision?.ignoredFalsePositives) !==
    JSON.stringify(expectedIgnoredFalsePositives)
  ) {
    errors.push("invalid PR-03 ignored false positives")
  }
  if (JSON.stringify(decision?.target) !== JSON.stringify(expectedTarget)) {
    errors.push("invalid PR-03 target")
  }
  if (
    JSON.stringify(decision?.resolverFingerprints) !==
    JSON.stringify(reviewedPr03ResolverFingerprints)
  ) {
    errors.push("invalid PR-03 resolver fingerprints")
  }
  if (
    JSON.stringify(decision?.webAuthenticationEvidence) !==
    JSON.stringify(reviewedPr03WebAuthenticationEvidence)
  ) {
    errors.push("invalid PR-03 Web authentication evidence")
  }
  if (
    !["pending-final-staged-delta", "reviewed"].includes(decision?.reviewStatus)
  ) {
    errors.push("invalid PR-03 review status")
  } else if (requireReady && decision.reviewStatus !== "reviewed") {
    errors.push("PR-03 operation policy is not reviewed")
  }
  errors.push(
    ...verifyExactPathPolicy(
      decision?.operationPolicy ?? {},
      ["addedSourcePaths", "changedSourcePaths", "deletedSourcePaths"],
      "PR-03",
    ),
    ...verifyExactPathPolicy(
      decision?.operationPolicy ?? {},
      [
        "addedRepositoryPaths",
        "changedRepositoryPaths",
        "deletedRepositoryPaths",
      ],
      "PR-03",
    ),
  )
  return errors.sort()
}

export function readPr04DecisionDocument(root = repositoryRoot) {
  return readJson(resolve(root, pr04DecisionPath))
}

export function verifyPr04DecisionDocument(
  decision,
  { requireReady = false } = {},
) {
  const errors = []
  const expectedKeys = [
    "contractBaseCommit",
    "laneAnchorCommit",
    "operationPolicy",
    "reviewStatus",
    "reviewedDispositions",
    "schemaVersion",
    "scope",
    "standaloneDbTestBoundary",
    "structuralExceptions",
    "target",
    "webAuthenticationEvidence",
    "workPackage",
  ]
  const expectedTarget = {
    findingEntriesDueByPr04: 0,
    legacyRoutes: 0,
    routes: 79,
    fastifyRegistrars: 3,
    webInferenceConsumers: 0,
    escapeHatchPaths: ["apps/bff/src/auth/persona.ts"],
  }
  if (
    !decision ||
    JSON.stringify(Object.keys(decision).sort()) !==
      JSON.stringify(expectedKeys) ||
    decision.schemaVersion !== 1 ||
    decision.workPackage !== "PR-04" ||
    decision.scope !== "data-retention-foundation" ||
    decision.contractBaseCommit !== pr04ContractBase ||
    decision.laneAnchorCommit !== pr04LaneAnchor
  ) {
    errors.push("invalid PR-04 decision identity")
  }
  if (
    JSON.stringify(decision?.reviewedDispositions) !==
    JSON.stringify(pr04ReviewedDispositions)
  ) {
    errors.push("invalid PR-04 reviewed dispositions")
  }
  if (
    JSON.stringify(decision?.structuralExceptions) !==
    JSON.stringify(pr04RetiredDependencyBoundaries)
  ) {
    errors.push("invalid PR-04 structural exceptions")
  }
  if (
    JSON.stringify(decision?.standaloneDbTestBoundary) !==
    JSON.stringify(pr04StandaloneDbTestBoundary)
  ) {
    errors.push("invalid PR-04 standalone DB test boundary")
  }
  if (
    JSON.stringify(decision?.webAuthenticationEvidence) !==
    JSON.stringify(reviewedPr04WebAuthenticationEvidence)
  ) {
    errors.push("invalid PR-04 Web authentication evidence")
  }
  if (JSON.stringify(decision?.target) !== JSON.stringify(expectedTarget)) {
    errors.push("invalid PR-04 target")
  }
  if (
    !["pending-final-staged-delta", "reviewed"].includes(decision?.reviewStatus)
  ) {
    errors.push("invalid PR-04 review status")
  } else if (requireReady && decision.reviewStatus !== "reviewed") {
    errors.push("PR-04 operation policy is not reviewed")
  }
  errors.push(
    ...verifyExactPathPolicy(
      decision?.operationPolicy ?? {},
      ["addedSourcePaths", "changedSourcePaths", "deletedSourcePaths"],
      "PR-04",
    ),
    ...verifyExactPathPolicy(
      decision?.operationPolicy ?? {},
      [
        "addedRepositoryPaths",
        "changedRepositoryPaths",
        "deletedRepositoryPaths",
      ],
      "PR-04",
    ),
  )
  return errors.sort()
}

export const pr05RecoveryRouteContract = [
  {
    surface: "bff",
    method: "POST",
    path: "/api/admin/recovery/factor/commission",
    source: "apps/bff/src/routes/admin.ts",
    classification: "current-console-seam",
  },
  {
    surface: "bff",
    method: "POST",
    path: "/api/admin/recovery/sessions",
    source: "apps/bff/src/routes/admin.ts",
    classification: "current-console-seam",
  },
  {
    surface: "bff",
    method: "POST",
    path: "/api/admin/recovery/sessions/:id/revoke",
    source: "apps/bff/src/routes/admin.ts",
    classification: "current-console-seam",
  },
  {
    surface: "bff",
    method: "GET",
    path: "/api/admin/recovery/status",
    source: "apps/bff/src/routes/admin.ts",
    classification: "current-console-seam",
  },
]

export const pr05TargetContract = {
  findingEntriesDueByPr05: 0,
  fs109LegacyPersonaFindingEntries: 0,
  fs105BuilderHubTombstones: [
    {
      path: "apps/web/src/middleware.test.ts",
      removeBy: "PR-12",
    },
  ],
  legacyRoutes: 0,
  routes: 83,
  routeClassifications: {
    "current-console-seam": 74,
    "operational-auth": 4,
    "private-operational": 3,
    "required-now": 2,
  },
  recoveryRoutes: pr05RecoveryRouteContract,
  adminOnlyRoutePolicyKeys: pr05AdminOnlyRoutePolicyKeys,
  fastifyRegistrars: [
    {
      exportName: "registerAdminRoutes",
      importSource: "./routes/admin",
      sourcePath: "apps/bff/src/routes/admin.ts",
    },
    {
      exportName: "registerAppGatewayRoutes",
      importSource: "./routes/app-gateway",
      sourcePath: "apps/bff/src/routes/app-gateway.ts",
    },
    {
      exportName: "registerAuthorization",
      importSource: "./auth/authorization",
      sourcePath: "apps/bff/src/auth/authorization.ts",
    },
  ],
  webInferenceConsumers: 0,
  escapeHatchPaths: [],
}

export function readPr05DecisionDocument(root = repositoryRoot) {
  return readJson(resolve(root, pr05DecisionPath))
}

export function verifyPr05DecisionDocument(
  decision,
  { requireReady = false } = {},
) {
  const errors = []
  const expectedKeys = [
    "contractBaseCommit",
    "laneAnchorCommit",
    "operationPolicy",
    "resolverFingerprints",
    "reviewStatus",
    "reviewedDispositions",
    "schemaVersion",
    "scope",
    "target",
    "webAuthenticationEvidence",
    "workPackage",
  ]
  if (
    !decision ||
    JSON.stringify(Object.keys(decision).sort()) !==
      JSON.stringify(expectedKeys) ||
    decision.schemaVersion !== 1 ||
    decision.workPackage !== "PR-05" ||
    decision.scope !== "identity-authorization-emergency-recovery" ||
    decision.contractBaseCommit !== pr05ContractBase ||
    decision.laneAnchorCommit !== pr05LaneAnchor
  ) {
    errors.push("invalid PR-05 decision identity")
  }
  if (
    JSON.stringify(decision?.reviewedDispositions) !==
    JSON.stringify(pr05ReviewedDispositions)
  ) {
    errors.push("invalid PR-05 reviewed dispositions")
  }
  if (
    JSON.stringify(decision?.resolverFingerprints) !==
    JSON.stringify(reviewedPr05ResolverFingerprints)
  ) {
    errors.push("invalid PR-05 resolver fingerprints")
  }
  if (
    JSON.stringify(decision?.webAuthenticationEvidence) !==
    JSON.stringify(reviewedPr05WebAuthenticationEvidence)
  ) {
    errors.push("invalid PR-05 Web authentication evidence")
  }
  if (JSON.stringify(decision?.target) !== JSON.stringify(pr05TargetContract)) {
    errors.push("invalid PR-05 target")
  }
  if (
    !["pending-final-staged-delta", "reviewed"].includes(decision?.reviewStatus)
  ) {
    errors.push("invalid PR-05 review status")
  } else if (requireReady && decision.reviewStatus !== "reviewed") {
    errors.push("PR-05 operation policy is not reviewed")
  }
  errors.push(...verifyPr05OperationBoundary(decision?.operationPolicy ?? {}))
  return errors.sort()
}

export function verifyPr05OperationBoundary(operationPolicy) {
  const sourceKeys = [
    "addedSourcePaths",
    "changedSourcePaths",
    "deletedSourcePaths",
  ]
  const repositoryKeys = [
    "addedRepositoryPaths",
    "changedRepositoryPaths",
    "deletedRepositoryPaths",
  ]
  const expectedKeys = [...sourceKeys, ...repositoryKeys].sort()
  const errors = [
    ...verifyExactPathPolicy(operationPolicy, sourceKeys, "PR-05"),
    ...verifyExactPathPolicy(operationPolicy, repositoryKeys, "PR-05"),
  ]
  if (
    JSON.stringify(Object.keys(operationPolicy).sort()) !==
    JSON.stringify(expectedKeys)
  ) {
    errors.push("invalid PR-05 operation policy keys")
  }

  const repositoryPathByOperation = new Map()
  for (const key of repositoryKeys) {
    for (const path of operationPolicy[key] ?? []) {
      repositoryPathByOperation.set(path, key.replace("Repository", "Source"))
      if (
        !pr05AllowedRepositoryPathPatterns.some((pattern) => pattern.test(path))
      ) {
        errors.push(`PR-05 repository path is outside package boundary ${path}`)
      }
      if (pr05ImmutablePriorEvidencePaths.includes(path)) {
        errors.push(
          `PR-05 immutable prior evidence appears in operation policy ${path}`,
        )
      }
    }
  }
  for (const key of sourceKeys) {
    for (const path of operationPolicy[key] ?? []) {
      if (repositoryPathByOperation.get(path) !== key) {
        errors.push(
          `PR-05 source operation lacks matching repository operation ${key} ${path}`,
        )
      }
    }
  }
  return [...new Set(errors)].sort()
}

export function readPr06DecisionDocument(root = repositoryRoot) {
  return readJson(resolve(root, pr06DecisionPath))
}

export function verifyPr06DecisionDocument(
  decision,
  { requireReady = false } = {},
) {
  const errors = []
  const expectedKeys = [
    "contractBaseCommit",
    "laneAnchorCommit",
    "operationPolicy",
    "resolverFingerprints",
    "reviewStatus",
    "reviewedDispositions",
    "schemaVersion",
    "scope",
    "standaloneDbTestBoundary",
    "target",
    "webAuthenticationEvidence",
    "workPackage",
  ]
  if (
    !decision ||
    JSON.stringify(Object.keys(decision).sort()) !==
      JSON.stringify(expectedKeys) ||
    decision.schemaVersion !== 1 ||
    decision.workPackage !== "PR-06" ||
    decision.scope !== "application-control-plane" ||
    decision.contractBaseCommit !== pr06ContractBase ||
    decision.laneAnchorCommit !== pr06LaneAnchor
  ) {
    errors.push("invalid PR-06 decision identity")
  }
  if (
    JSON.stringify(decision?.reviewedDispositions) !==
    JSON.stringify(pr06ReviewedDispositions)
  ) {
    errors.push("invalid PR-06 reviewed dispositions")
  }
  const keycloakApplicationRealmTopology =
    decision?.reviewedDispositions?.keycloakApplicationAdministration
      ?.realmTopology
  if (
    keycloakApplicationRealmTopology !==
    pr06ReviewedDispositions.keycloakApplicationAdministration.realmTopology
  ) {
    errors.push("invalid PR-06 Keycloak Application realm topology")
  }
  if (
    JSON.stringify(decision?.standaloneDbTestBoundary) !==
    JSON.stringify(pr06StandaloneDbTestBoundary)
  ) {
    errors.push("invalid PR-06 standalone DB test boundary")
  }
  if (
    JSON.stringify(decision?.resolverFingerprints) !==
    JSON.stringify(reviewedPr06ResolverFingerprints)
  ) {
    errors.push("invalid PR-06 resolver fingerprints")
  }
  if (
    JSON.stringify(decision?.webAuthenticationEvidence) !==
    JSON.stringify(reviewedPr05WebAuthenticationEvidence)
  ) {
    errors.push("invalid PR-06 Web authentication evidence")
  }
  if (JSON.stringify(decision?.target) !== JSON.stringify(pr06TargetContract)) {
    errors.push("invalid PR-06 target")
  }
  if (
    !["pending-final-staged-delta", "reviewed"].includes(decision?.reviewStatus)
  ) {
    errors.push("invalid PR-06 review status")
  } else if (requireReady && decision.reviewStatus !== "reviewed") {
    errors.push("PR-06 operation policy is not reviewed")
  }
  if (requireReady) {
    const oauthAccessTokenLifetimeSeconds =
      decision?.reviewedDispositions?.credentialLifecycle
        ?.oauthAccessTokenLifetimeSeconds
    if (
      oauthAccessTokenLifetimeSeconds !==
      pr06ReviewedDispositions.credentialLifecycle
        .oauthAccessTokenLifetimeSeconds
    ) {
      errors.push("PR-06 OAuth access-token lifetime must equal 300 seconds")
    }
    if (
      keycloakApplicationRealmTopology !==
      pr06ReviewedDispositions.keycloakApplicationAdministration.realmTopology
    ) {
      errors.push(
        "PR-06 Keycloak Application realm topology must equal dedicated-application-realm",
      )
    }
  }
  errors.push(...verifyPr06OperationBoundary(decision?.operationPolicy ?? {}))
  return errors.sort()
}

export function verifyPr06OperationBoundary(operationPolicy) {
  const sourceKeys = [
    "addedSourcePaths",
    "changedSourcePaths",
    "deletedSourcePaths",
  ]
  const repositoryKeys = [
    "addedRepositoryPaths",
    "changedRepositoryPaths",
    "deletedRepositoryPaths",
  ]
  const expectedKeys = [...sourceKeys, ...repositoryKeys].sort()
  const errors = [
    ...verifyExactPathPolicy(operationPolicy, sourceKeys, "PR-06"),
    ...verifyExactPathPolicy(operationPolicy, repositoryKeys, "PR-06"),
  ]
  if (
    JSON.stringify(Object.keys(operationPolicy).sort()) !==
    JSON.stringify(expectedKeys)
  ) {
    errors.push("invalid PR-06 operation policy keys")
  }

  const repositoryPathByOperation = new Map()
  for (const key of repositoryKeys) {
    for (const path of operationPolicy[key] ?? []) {
      repositoryPathByOperation.set(path, key.replace("Repository", "Source"))
      if (
        !pr06AllowedRepositoryPathPatterns.some((pattern) => pattern.test(path))
      ) {
        errors.push(`PR-06 repository path is outside package boundary ${path}`)
      }
      if (pr06ImmutablePriorEvidencePaths.includes(path)) {
        errors.push(
          `PR-06 immutable prior evidence appears in operation policy ${path}`,
        )
      }
    }
  }
  for (const key of sourceKeys) {
    for (const path of operationPolicy[key] ?? []) {
      if (repositoryPathByOperation.get(path) !== key) {
        errors.push(
          `PR-06 source operation lacks matching repository operation ${key} ${path}`,
        )
      }
    }
  }
  return [...new Set(errors)].sort()
}

export function readPr07DecisionDocument(root = repositoryRoot) {
  return readJson(resolve(root, pr07DecisionPath))
}

export function verifyPr07DecisionDocument(
  decision,
  { requireReady = false } = {},
) {
  const errors = []
  const expectedKeys = [
    "contractBaseCommit",
    "laneAnchorCommit",
    "operationPolicy",
    "resolverFingerprints",
    "reviewStatus",
    "reviewedDispositions",
    "schemaVersion",
    "scope",
    "standaloneDbTestBoundary",
    "target",
    "webAuthenticationEvidence",
    "workPackage",
  ]
  if (
    !decision ||
    JSON.stringify(Object.keys(decision).sort()) !==
      JSON.stringify(expectedKeys) ||
    decision.schemaVersion !== 1 ||
    decision.workPackage !== "PR-07" ||
    decision.scope !== "inference-data-plane" ||
    decision.contractBaseCommit !== pr07ContractBase ||
    decision.laneAnchorCommit !== pr07LaneAnchor
  ) {
    errors.push("invalid PR-07 decision identity")
  }
  if (
    JSON.stringify(decision?.reviewedDispositions) !==
    JSON.stringify(pr07ReviewedDispositions)
  ) {
    errors.push("invalid PR-07 reviewed dispositions")
  }
  if (
    JSON.stringify(decision?.standaloneDbTestBoundary) !==
    JSON.stringify(pr07StandaloneDbTestBoundary)
  ) {
    errors.push("invalid PR-07 standalone DB test boundary")
  }
  if (
    JSON.stringify(decision?.resolverFingerprints) !==
    JSON.stringify(reviewedPr06ResolverFingerprints)
  ) {
    errors.push("invalid PR-07 resolver fingerprints")
  }
  if (
    JSON.stringify(decision?.webAuthenticationEvidence) !==
    JSON.stringify(reviewedPr05WebAuthenticationEvidence)
  ) {
    errors.push("invalid PR-07 Web authentication evidence")
  }
  if (JSON.stringify(decision?.target) !== JSON.stringify(pr07TargetContract)) {
    errors.push("invalid PR-07 target")
  }
  if (
    !["pending-final-staged-delta", "reviewed"].includes(decision?.reviewStatus)
  ) {
    errors.push("invalid PR-07 review status")
  } else if (requireReady && decision.reviewStatus !== "reviewed") {
    errors.push("PR-07 operation policy is not reviewed")
  }

  const dispositions = decision?.reviewedDispositions
  if (
    dispositions?.applicationAuthentication
      ?.oauthAccessTokenMaximumLifetimeSeconds !== 300
  ) {
    errors.push("PR-07 OAuth access-token lifetime must not exceed 300 seconds")
  }
  if (
    dispositions?.applicationAuthentication?.realmTopology !==
    "dedicated-application-realm"
  ) {
    errors.push(
      "PR-07 Application authentication must use the dedicated Application realm",
    )
  }
  if (
    JSON.stringify(dispositions?.publicInferenceApi?.routes) !==
      JSON.stringify(pr07ReviewedDispositions.publicInferenceApi.routes) ||
    dispositions?.publicInferenceApi?.additionalPublicRoutes !== false
  ) {
    errors.push("PR-07 must expose exactly two public inference routes")
  }
  if (
    dispositions?.publicInferenceApi?.toolCalls !==
    "transport-only-never-executed"
  ) {
    errors.push("PR-07 must not execute transported tool calls")
  }
  if (
    dispositions?.modelAliasPolicy?.silentSubstitution !== false ||
    dispositions?.modelAliasPolicy?.missingOrUnhealthyAlias !==
      "degraded-and-fail-closed"
  ) {
    errors.push("PR-07 must not substitute model aliases")
  }
  if (
    JSON.stringify(dispositions?.customerOwnedHardwarePolicy) !==
    JSON.stringify(pr07ReviewedDispositions.customerOwnedHardwarePolicy)
  ) {
    errors.push("PR-07 customer-owned-hardware signal boundary changed")
  }
  if (
    dispositions?.retention?.workloadContentPersistence !== false ||
    dispositions?.retention?.promptsPersisted !== false ||
    dispositions?.retention?.completionsPersisted !== false ||
    dispositions?.retention?.streamedChunksPersisted !== false ||
    dispositions?.retention?.toolArgumentsPersisted !== false
  ) {
    errors.push("PR-07 workload content retention must remain disabled")
  }
  if (
    dispositions?.scopeBoundaries?.firecrawl !== "excluded-PR-08" ||
    dispositions?.scopeBoundaries?.runtimeDeploymentAndQualification !==
      "excluded-PR-12"
  ) {
    errors.push("PR-07 excluded scope boundary changed")
  }
  errors.push(...verifyPr07OperationBoundary(decision?.operationPolicy ?? {}))
  return errors.sort()
}

export function verifyPr07OperationBoundary(operationPolicy) {
  const sourceKeys = [
    "addedSourcePaths",
    "changedSourcePaths",
    "deletedSourcePaths",
  ]
  const repositoryKeys = [
    "addedRepositoryPaths",
    "changedRepositoryPaths",
    "deletedRepositoryPaths",
  ]
  const expectedKeys = [...sourceKeys, ...repositoryKeys].sort()
  const errors = [
    ...verifyExactPathPolicy(operationPolicy, sourceKeys, "PR-07"),
    ...verifyExactPathPolicy(operationPolicy, repositoryKeys, "PR-07"),
  ]
  if (
    JSON.stringify(Object.keys(operationPolicy).sort()) !==
    JSON.stringify(expectedKeys)
  ) {
    errors.push("invalid PR-07 operation policy keys")
  }

  const repositoryPathByOperation = new Map()
  for (const key of repositoryKeys) {
    for (const path of operationPolicy[key] ?? []) {
      repositoryPathByOperation.set(path, key.replace("Repository", "Source"))
      if (
        !pr07AllowedRepositoryPathPatterns.some((pattern) => pattern.test(path))
      ) {
        errors.push(`PR-07 repository path is outside package boundary ${path}`)
      }
      if (pr07ImmutablePriorEvidencePaths.includes(path)) {
        errors.push(
          `PR-07 immutable prior evidence appears in operation policy ${path}`,
        )
      }
    }
  }
  for (const key of sourceKeys) {
    for (const path of operationPolicy[key] ?? []) {
      if (repositoryPathByOperation.get(path) !== key) {
        errors.push(
          `PR-07 source operation lacks matching repository operation ${key} ${path}`,
        )
      }
    }
  }
  return [...new Set(errors)].sort()
}

export function readPr08DecisionDocument(root = repositoryRoot) {
  return readJson(resolve(root, pr08DecisionPath))
}

export function readPr08SourceManifestDocument(root = repositoryRoot) {
  return readJson(resolve(root, pr08SourceManifestPath))
}

export function verifyPr08SourceManifestDocument(manifest) {
  const errors = []
  const expectedKeys = [
    "hardExclusions",
    "privateCheckpoint",
    "productBase",
    "reviewStatus",
    "schemaVersion",
    "scope",
    "semanticSelections",
    "sourceArtifacts",
    "sourceCommits",
    "targetContract",
    "workPackage",
  ]
  if (
    !manifest ||
    JSON.stringify(Object.keys(manifest).sort()) !==
      JSON.stringify(expectedKeys) ||
    manifest.schemaVersion !== 1 ||
    manifest.workPackage !== "PR-08" ||
    manifest.scope !== "firecrawl-search-static-scrape-source-only" ||
    manifest.reviewStatus !== "reviewed-for-reconstruction"
  ) {
    errors.push("invalid PR-08 source manifest identity")
  }
  if (
    manifest?.productBase?.commit !== pr08ContractBase ||
    manifest?.productBase?.tree !== pr08ContractBaseTree
  ) {
    errors.push("invalid PR-08 Product base identity")
  }
  const checkpoint = manifest?.privateCheckpoint
  if (
    checkpoint?.base !== pr08PrivateCheckpoint.baseCommit ||
    checkpoint?.baseTree !== pr08PrivateCheckpoint.baseTree ||
    checkpoint?.commit !== pr08PrivateCheckpoint.commit ||
    checkpoint?.tree !== pr08PrivateCheckpoint.tree ||
    checkpoint?.privateHoldRef !==
      pr08PrivatePreservationBinding.privateHoldRef ||
    checkpoint?.selectedManifestV2Sha256 !==
      pr08PrivatePreservationBinding.selectedManifestV2Sha256 ||
    checkpoint?.exclusionLedgerV2Sha256 !==
      pr08PrivatePreservationBinding.exclusionLedgerV2Sha256 ||
    checkpoint?.combinedBindingV2Sha256 !==
      pr08PrivatePreservationBinding.combinedBindingV2Sha256 ||
    checkpoint?.readOnly !== true ||
    checkpoint?.wholesaleMergeAllowed !== false ||
    checkpoint?.wholesaleCherryPickAllowed !== false
  ) {
    errors.push("invalid PR-08 private checkpoint binding")
  }
  const sourceCommits = (manifest?.sourceCommits ?? []).map(
    ({ commit }) => commit,
  )
  if (
    JSON.stringify(sourceCommits) !==
    JSON.stringify([
      "842e8ebdc16c0dbb33b4288ca5887170d38e0198",
      "97777cc96d44ca9bf086e656a517e9706698e766",
      "fdd7dc06c92486a94e9e42a22b98615f8159f381",
      "cf41824a55148be12fcfd67dc62722040e0c8573",
      "ff74f3c94c563627929af31c46d48dda8e7d6192",
    ])
  ) {
    errors.push("invalid PR-08 reviewed source commit sequence")
  }
  if (
    JSON.stringify(manifest?.sourceArtifacts) !==
    JSON.stringify(pr08SourceArtifacts)
  ) {
    errors.push("invalid PR-08 source artifact provenance")
  }
  const hardExclusions = new Set(manifest?.hardExclusions ?? [])
  for (const exclusion of [
    "infra/migrations/0027_admin_firecrawl_gateway_clients.sql",
    "credential-expiry",
    "librechat-hub-builder-knowledge-rag-mcp-coupling",
    "native-and-excluded-firecrawl-public-routes",
    "request-or-response-content-in-databases-audit-usage-logs-metrics-queues-caches-crash-output-or-backups",
    "pilot-branch-ancestry",
    "pr-08-web-ui",
    "pr-08-runtime-deployment-and-qualification",
  ]) {
    if (!hardExclusions.has(exclusion)) {
      errors.push(`missing PR-08 hard exclusion ${exclusion}`)
    }
  }
  const target = manifest?.targetContract
  if (
    JSON.stringify(target?.publicRoutes) !==
      JSON.stringify(pr08ReviewedDispositions.publicCapability.routes) ||
    target?.surfaceClassification !== "public-t2" ||
    target?.inferenceRoutes !== "unchanged" ||
    target?.defaultOffPerApplication !== true ||
    target?.credentialAutomaticExpiry !== false ||
    target?.credentialOverlapSeconds !== 86400 ||
    target?.testConnection !== "passive-real-client-authentication-evidence" ||
    target?.governedPrivateUpstream !== "http://firecrawl-api:3002" ||
    target?.customerUrlGovernance !== false ||
    target?.workloadContentRetention !== false ||
    target?.uiVisibility !== "hidden-until-PR-11" ||
    target?.runtimeAndFinalQualification !== "PR-12"
  ) {
    errors.push("invalid PR-08 source manifest target")
  }
  return errors.sort()
}

export function verifyPr08SourceMapDocument(source) {
  const errors = []
  const lines = String(source)
    .split("\n")
    .filter((line) => line.length > 0)
  let rows = []
  try {
    rows = lines.map((line) => JSON.parse(line))
  } catch {
    return ["invalid PR-08 source map JSONL"]
  }
  const binding = rows[0]
  if (
    binding?.kind !== "binding" ||
    binding?.schemaVersion !== 1 ||
    binding?.workPackage !== "PR-08" ||
    binding?.method !== "reviewed-semantic-unit-reconstruction" ||
    binding?.source?.commit !== pr08PrivateCheckpoint.commit ||
    binding?.source?.tree !== pr08PrivateCheckpoint.tree ||
    binding?.source?.baseCommit !== pr08PrivateCheckpoint.baseCommit ||
    binding?.source?.baseTree !== pr08PrivateCheckpoint.baseTree ||
    binding?.target?.baseCommit !== pr08ContractBase ||
    binding?.target?.baseTree !== pr08ContractBaseTree ||
    binding?.wholesaleMerge !== false ||
    binding?.wholesaleCherryPick !== false ||
    binding?.pilotAncestryAllowed !== false
  ) {
    errors.push("invalid PR-08 source map binding")
  }
  const mappings = rows.slice(1)
  const targetPaths = mappings.map((row) => row?.targetPath)
  if (
    JSON.stringify(targetPaths) !==
    JSON.stringify([...pr08ExpectedMappedTargetPaths].sort())
  ) {
    errors.push("invalid PR-08 source map target path closure")
  }
  for (const row of mappings) {
    const semanticBinding = sha256(
      JSON.stringify({
        sourcePaths: row?.sourcePaths,
        semanticUnits: row?.semanticUnits,
      }),
    )
    if (
      row?.kind !== "semantic-mapping" ||
      row?.schemaVersion !== 1 ||
      row?.workPackage !== "PR-08" ||
      row?.method !== "reviewed-semantic-unit-reconstruction" ||
      !Array.isArray(row?.sourcePaths) ||
      row.sourcePaths.length === 0 ||
      row.sourcePaths.some(
        (path) =>
          typeof path !== "string" ||
          path === "infra/migrations/0027_admin_firecrawl_gateway_clients.sql",
      ) ||
      !Array.isArray(row?.semanticUnits) ||
      row.semanticUnits.length === 0 ||
      semanticBinding !==
        pr08ReviewedSourceMapSemanticBindings[row?.targetPath] ||
      row?.pilotContentImported !== false
    ) {
      errors.push(`invalid PR-08 source map row ${String(row?.targetPath)}`)
    }
  }
  return [...new Set(errors)].sort()
}

export function verifyPr08DecisionDocument(
  decision,
  { requireReady = false } = {},
) {
  const errors = []
  const expectedKeys = [
    "contractBaseCommit",
    "contractBaseTree",
    "laneAnchorCommit",
    "operationPolicy",
    "reviewStatus",
    "reviewedDispositions",
    "schemaVersion",
    "scope",
    "sourceManifest",
    "sourceMap",
    "standaloneDbTestBoundary",
    "target",
    "webAuthenticationEvidence",
    "workPackage",
  ]
  if (
    !decision ||
    JSON.stringify(Object.keys(decision).sort()) !==
      JSON.stringify(expectedKeys) ||
    decision.schemaVersion !== 1 ||
    decision.workPackage !== "PR-08" ||
    decision.scope !== "firecrawl-search-static-scrape-source-only" ||
    decision.contractBaseCommit !== pr08ContractBase ||
    decision.contractBaseTree !== pr08ContractBaseTree ||
    decision.laneAnchorCommit !== pr08LaneAnchor
  ) {
    errors.push("invalid PR-08 decision identity")
  }
  if (
    JSON.stringify(decision?.reviewedDispositions) !==
    JSON.stringify(pr08ReviewedDispositions)
  ) {
    errors.push("invalid PR-08 reviewed dispositions")
  }
  if (
    JSON.stringify(decision?.sourceManifest) !==
    JSON.stringify(pr08SourceManifestBinding)
  ) {
    errors.push("invalid PR-08 source manifest binding")
  }
  if (
    JSON.stringify(decision?.sourceMap) !== JSON.stringify(pr08SourceMapBinding)
  ) {
    errors.push("invalid PR-08 source map binding")
  }
  if (
    JSON.stringify(decision?.standaloneDbTestBoundary) !==
    JSON.stringify(pr08StandaloneDbTestBoundary)
  ) {
    errors.push("invalid PR-08 standalone DB test boundary")
  }
  if (
    JSON.stringify(decision?.webAuthenticationEvidence) !==
    JSON.stringify(reviewedPr05WebAuthenticationEvidence)
  ) {
    errors.push("invalid PR-08 Web authentication evidence")
  }
  if (JSON.stringify(decision?.target) !== JSON.stringify(pr08TargetContract)) {
    errors.push("invalid PR-08 target")
  }
  if (
    !["pending-final-staged-delta", "reviewed"].includes(decision?.reviewStatus)
  ) {
    errors.push("invalid PR-08 review status")
  } else if (requireReady && decision.reviewStatus !== "reviewed") {
    errors.push("PR-08 operation policy is not reviewed")
  }
  errors.push(...verifyPr08OperationBoundary(decision?.operationPolicy ?? {}))
  return errors.sort()
}

export function verifyPr08OperationBoundary(operationPolicy) {
  const sourceKeys = [
    "addedSourcePaths",
    "changedSourcePaths",
    "deletedSourcePaths",
  ]
  const repositoryKeys = [
    "addedRepositoryPaths",
    "changedRepositoryPaths",
    "deletedRepositoryPaths",
  ]
  const expectedKeys = [...sourceKeys, ...repositoryKeys].sort()
  const errors = [
    ...verifyExactPathPolicy(operationPolicy, sourceKeys, "PR-08"),
    ...verifyExactPathPolicy(operationPolicy, repositoryKeys, "PR-08"),
  ]
  if (
    JSON.stringify(Object.keys(operationPolicy).sort()) !==
    JSON.stringify(expectedKeys)
  ) {
    errors.push("invalid PR-08 operation policy keys")
  }
  if (
    (operationPolicy.deletedSourcePaths ?? []).length > 0 ||
    (operationPolicy.deletedRepositoryPaths ?? []).length > 0
  ) {
    errors.push(
      "PR-08 source-only reconstruction must not delete Product paths",
    )
  }

  const repositoryPathByOperation = new Map()
  for (const key of repositoryKeys) {
    for (const path of operationPolicy[key] ?? []) {
      repositoryPathByOperation.set(path, key.replace("Repository", "Source"))
      if (
        !pr08AllowedRepositoryPathPatterns.some((pattern) => pattern.test(path))
      ) {
        errors.push(`PR-08 repository path is outside package boundary ${path}`)
      }
      if (pr08ImmutablePriorEvidencePaths.includes(path)) {
        errors.push(
          `PR-08 immutable prior evidence appears in operation policy ${path}`,
        )
      }
      if (
        path.startsWith("apps/web/") &&
        !pr08WebContractCompatibilityTestPaths.includes(path)
      ) {
        errors.push(
          `PR-08 Web production path is forbidden until PR-11 ${path}`,
        )
      }
      if (
        path === "infra/migrations/0027_admin_firecrawl_gateway_clients.sql" ||
        /(?:^|\/)(?:hermes|librechat|rag|knowledge|mcp)(?:\/|[-_.])/i.test(path)
      ) {
        errors.push(`PR-08 excluded pilot path is forbidden ${path}`)
      }
    }
  }
  for (const key of sourceKeys) {
    for (const path of operationPolicy[key] ?? []) {
      if (repositoryPathByOperation.get(path) !== key) {
        errors.push(
          `PR-08 source operation lacks matching repository operation ${key} ${path}`,
        )
      }
    }
  }
  return [...new Set(errors)].sort()
}

export function verifyPr08PilotAncestry(root = repositoryRoot) {
  let commits
  try {
    commits = execFileSync("git", ["rev-list", "HEAD"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    })
      .trim()
      .split("\n")
  } catch {
    return ["PR-08 candidate ancestry is unavailable"]
  }
  return commits.includes(pr08PrivateCheckpoint.commit)
    ? [
        `PR-08 candidate contains pilot ancestry ${pr08PrivateCheckpoint.commit}`,
      ]
    : []
}

export function readPr09DecisionDocument(root = repositoryRoot) {
  return readJson(resolve(root, pr09DecisionPath))
}

export function verifyPr09DecisionDocument(
  decision,
  { requireReady = false } = {},
) {
  const errors = []
  const expectedKeys = [
    "contractBaseCommit",
    "contractBaseTree",
    "laneAnchorCommit",
    "nativeIdentifierEvidence",
    "operationPolicy",
    "resolverFingerprints",
    "reviewStatus",
    "reviewedDispositions",
    "schemaVersion",
    "scope",
    "sourceFingerprints",
    "standaloneDbTestBoundary",
    "target",
    "webAuthenticationEvidence",
    "workPackage",
  ]
  if (
    !decision ||
    JSON.stringify(Object.keys(decision).sort()) !==
      JSON.stringify(expectedKeys) ||
    decision.schemaVersion !== 1 ||
    decision.workPackage !== "PR-09" ||
    decision.scope !== "activity-audit-observability-source-only" ||
    decision.contractBaseCommit !== pr09ContractBase ||
    decision.contractBaseTree !== pr09ContractBaseTree ||
    decision.laneAnchorCommit !== pr09LaneAnchor
  ) {
    errors.push("invalid PR-09 decision identity")
  }
  if (
    JSON.stringify(decision?.reviewedDispositions) !==
    JSON.stringify(pr09ReviewedDispositions)
  ) {
    errors.push("invalid PR-09 reviewed dispositions")
  }
  if (
    JSON.stringify(decision?.standaloneDbTestBoundary) !==
    JSON.stringify(pr09StandaloneDbTestBoundary)
  ) {
    errors.push("invalid PR-09 standalone DB test boundary")
  }
  if (
    JSON.stringify(decision?.webAuthenticationEvidence) !==
    JSON.stringify(reviewedPr09WebAuthenticationEvidence)
  ) {
    errors.push("invalid PR-09 Web authentication evidence")
  }
  if (
    JSON.stringify(decision?.resolverFingerprints) !==
    JSON.stringify(reviewedPr09ResolverFingerprints)
  ) {
    errors.push("invalid PR-09 resolver fingerprints")
  }
  if (
    JSON.stringify(decision?.sourceFingerprints) !==
    JSON.stringify(reviewedPr09SourceFingerprints)
  ) {
    errors.push("invalid PR-09 source fingerprints")
  }
  if (
    JSON.stringify(decision?.nativeIdentifierEvidence) !==
    JSON.stringify(reviewedPr09NativeIdentifierEvidence)
  ) {
    errors.push("invalid PR-09 native identifier evidence")
  }
  if (JSON.stringify(decision?.target) !== JSON.stringify(pr09TargetContract)) {
    errors.push("invalid PR-09 target")
  }
  if (
    !["pending-final-staged-delta", "reviewed"].includes(decision?.reviewStatus)
  ) {
    errors.push("invalid PR-09 review status")
  } else if (requireReady && decision.reviewStatus !== "reviewed") {
    errors.push("PR-09 operation policy is not reviewed")
  }

  const dispositions = decision?.reviewedDispositions
  if (
    dispositions?.activityAudit?.ingressMechanism !==
      "product_owned_audited_ingress" ||
    dispositions?.activityAudit?.ingressState !==
      "implemented_pending_runtime_qualification" ||
    dispositions?.activityAudit?.retentionDays !== 365 ||
    dispositions?.activityAudit?.nativeEventIdentity?.adapterContract !==
      "source-namespaced-deterministic-uuidv5" ||
    dispositions?.activityAudit?.nativeEventIdentity?.suppliedBy !==
      "product-owned-native-adapter" ||
    dispositions?.activityAudit?.nativeEventIdentity?.pr09Validation !==
      "canonical-uuidv5-shape-only" ||
    dispositions?.activityAudit?.nativeEventIdentity
      ?.namespaceDerivationProvenInPr09 !== false ||
    dispositions?.activityAudit?.nativeEventIdentity
      ?.configuredNativeAdaptersInPr09 !== 0 ||
    dispositions?.activityAudit?.nativeEventIdentity?.persistedAs !==
      "audit_events.id" ||
    dispositions?.activityAudit?.nativeEventIdentity?.idempotencyBoundary !==
      "audit_events-primary-key" ||
    dispositions?.activityAudit?.nativeEventIdentity?.replay !==
      "idempotent-only-for-identical-canonical-metadata" ||
    dispositions?.activityAudit?.nativeEventIdentity?.collision !==
      "reject-different-canonical-metadata" ||
    dispositions?.activityAudit?.nativeEventIdentity
      ?.rawSourceEventIdRetained !== false ||
    dispositions?.activityAudit?.nativeEventIdentity
      ?.rawSourceEventIdExported !== false ||
    dispositions?.activityAudit?.nativeEventIdentity
      ?.deduplicateByCorrelationId !== false ||
    dispositions?.activityAudit?.nativeCursor?.format !==
      "v1-canonical-utc-watermark-uuidv5-tie-breaker" ||
    JSON.stringify(dispositions?.activityAudit?.nativeCursor?.storage) !==
      JSON.stringify([
        "cursor_version",
        "cursor_watermark",
        "cursor_tie_breaker",
      ]) ||
    JSON.stringify(dispositions?.activityAudit?.nativeCursor?.order) !==
      JSON.stringify(["watermark_asc", "tie_breaker_asc"]) ||
    dispositions?.activityAudit?.nativeCursor?.monotonic !== true ||
    dispositions?.activityAudit?.nativeCursor?.establishedCursorMayClear !==
      false ||
    dispositions?.activityAudit?.nativeCursor?.concurrency !==
      "row-lock-compare-and-set" ||
    dispositions?.activityAudit?.nativeCursor?.attemptOrdering !==
      "older-attempt-cannot-overwrite-newer-attempt" ||
    dispositions?.activityAudit?.nativeCursor?.batchCursor !==
      "must-match-final-event-watermark-and-id" ||
    dispositions?.activityAudit?.activityAndExportPageCursor?.encoding !==
      "base64url-json" ||
    JSON.stringify(
      dispositions?.activityAudit?.activityAndExportPageCursor?.fields,
    ) !== JSON.stringify(["id", "occurredAt"]) ||
    dispositions?.activityAudit?.activityAndExportPageCursor?.pagination !==
      "deterministic-live-keyset" ||
    dispositions?.activityAudit?.activityAndExportPageCursor
      ?.crossPageSnapshot !== false ||
    dispositions?.activityAudit?.nativeIdentifiers?.correlationId !==
      "required-canonical-uuid" ||
    dispositions?.activityAudit?.nativeIdentifiers?.keycloakSubjectId !==
      "nullable-for-system-originated-events" ||
    dispositions?.activityAudit?.nativeIdentifiers?.opaqueIdentifierPattern !==
      "^[A-Za-z0-9][A-Za-z0-9_:-]*$" ||
    JSON.stringify(
      dispositions?.activityAudit?.nativeIdentifiers
        ?.prohibitedIdentifierPrefixes,
    ) !==
      JSON.stringify([
        "llmm_",
        "bearer",
        "token",
        "secret",
        "password",
        "api-key",
      ]) ||
    dispositions?.activityAudit?.nativeIdentifiers
      ?.providerTokenWholeValuePolicy?.disposition !== "reject" ||
    dispositions?.activityAudit?.nativeIdentifiers
      ?.providerTokenWholeValuePolicy?.matching !== "anchored-whole-value" ||
    JSON.stringify(
      dispositions?.activityAudit?.nativeIdentifiers
        ?.providerTokenWholeValuePolicy?.appliesTo,
    ) !==
      JSON.stringify([
        "keycloakSubjectId",
        "applicationId",
        "credentialRecordId",
      ]) ||
    dispositions?.activityAudit?.nativeIdentifiers
      ?.providerTokenWholeValuePolicy?.families !==
      "reviewed-provider-token-shape-set" ||
    dispositions?.activityAudit?.nativeIdentifiers
      ?.providerTokenWholeValuePolicy?.valuesRecordedInGovernance !== false ||
    JSON.stringify(
      dispositions?.activityAudit?.nativeIdentifiers?.credentialPrefixPatterns,
    ) !==
      JSON.stringify(["^llmm_t4_[0-9a-f]{18}$", "^llmm_fc_[0-9a-f]{16}$"]) ||
    dispositions?.activityAudit?.nativeIdentifiers
      ?.credentialIdentifierCardinality !== "record-id-or-prefix-never-both" ||
    dispositions?.activityAudit?.compatibilityTargetProjection?.persistence !==
      false ||
    dispositions?.activityAudit?.compatibilityTargetProjection?.export !==
      false ||
    dispositions?.activityAudit?.compatibilityTargetProjection?.mode !==
      "derived-read-only" ||
    JSON.stringify(
      dispositions?.activityAudit?.compatibilityTargetProjection?.fields,
    ) !== JSON.stringify(["targetType", "targetId"]) ||
    JSON.stringify(
      dispositions?.activityAudit?.compatibilityTargetProjection
        ?.derivedOnlyFrom,
    ) !==
      JSON.stringify([
        "keycloakSubjectId",
        "applicationId",
        "credentialRecordId",
        "credentialPrefix",
        "correlationId",
      ]) ||
    Object.hasOwn(dispositions?.activityAudit ?? {}, "idempotencyKey") ||
    dispositions?.activityAudit?.allowedMetadataFields?.includes(
      "sourceEventId",
    ) ||
    dispositions?.activityAudit?.allowedMetadataFields?.includes(
      "targetType",
    ) ||
    dispositions?.activityAudit?.allowedMetadataFields?.includes("targetId")
  ) {
    errors.push("PR-09 activity and audit boundary changed")
  }
  if (
    dispositions?.auditExport?.algorithm !== "Ed25519" ||
    dispositions?.auditExport?.envelope !== "compact-jws" ||
    dispositions?.auditExport?.privateKeySource !== "mounted-file-only" ||
    dispositions?.auditExport?.privateKeyInGit !== false ||
    dispositions?.auditExport?.privateKeyInEnvironment !== false ||
    dispositions?.auditExport?.pagination !== "deterministic-live-keyset" ||
    dispositions?.auditExport?.cursorEncoding !==
      "base64url-json-id-occurredAt" ||
    dispositions?.auditExport?.crossPageSnapshot !== false ||
    dispositions?.auditExport?.missingOrInvalidMaterial !==
      "signed-export-surface-only-http-503"
  ) {
    errors.push("PR-09 signed audit export boundary changed")
  }
  if (
    dispositions?.expertAccess?.directAccess !== "disabled" ||
    dispositions?.expertAccess?.nativeMutation !== "disabled" ||
    dispositions?.expertAccess?.enablementOwner !== "PR-12"
  ) {
    errors.push("PR-09 native expert access boundary changed")
  }
  if (
    dispositions?.grafanaOss?.adminRole !== "Editor" ||
    dispositions?.grafanaOss?.operatorRole !== "Viewer" ||
    dispositions?.grafanaOss?.retainedRoleCardinality !== "exactly-one" ||
    dispositions?.grafanaOss?.ambiguousRetainedRoles !== "deny" ||
    dispositions?.grafanaOss?.strictFolderConfinementClaim !== false
  ) {
    errors.push("PR-09 Grafana OSS boundary changed")
  }
  if (
    dispositions?.observability?.metricsEndpoint?.exposure !==
      "private-authenticated" ||
    dispositions?.observability?.metricsEndpoint?.authentication !==
      "mounted-private-file-bearer" ||
    dispositions?.observability?.metricsEndpoint?.additionalExporterService !==
      false ||
    dispositions?.observability?.prometheusQueryApi?.authentication !==
      "mounted-private-file-bearer" ||
    dispositions?.observability?.prometheusQueryApi
      ?.runtimeEnvironmentCredentialAllowed !== false ||
    dispositions?.observability?.queueDepth?.valueEmittedInPr09 !== false ||
    dispositions?.observability?.queueDepth
      ?.concurrencyOrInFlightIsSubstitute !== false
  ) {
    errors.push("PR-09 metrics and queue-depth boundary changed")
  }
  if (
    dispositions?.alertEgress?.pr09Scope !==
      "redacted-transport-intent-and-warning-acknowledgement-only" ||
    dispositions?.alertEgress?.persistedDestination !== false ||
    dispositions?.alertEgress?.persistedEmailOrUrl !== false ||
    dispositions?.alertEgress?.persistedSecret !== false ||
    dispositions?.alertEgress?.runtimeDelivery !== false ||
    dispositions?.alertEgress?.defaultState !== "disabled" ||
    JSON.stringify(dispositions?.alertEgress?.dedicatedUpdaterFields) !==
      JSON.stringify([
        "alert_egress_revision",
        "alert_egress_updated_at",
        "alert_egress_updated_by",
        "alert_egress_acknowledged_at",
        "alert_egress_acknowledged_by",
        "alert_egress_warning_version",
      ]) ||
    dispositions?.alertEgress?.stateAuditReceiptAtomicity !==
      "single-postgresql-transaction" ||
    dispositions?.alertEgress?.receiptFinalization !== "same-transaction" ||
    dispositions?.alertEgress?.receiptFailureRollsBackStateAndAudit !== true
  ) {
    errors.push("PR-09 alert egress preparation boundary changed")
  }
  if (
    dispositions?.retention?.workloadContentDays !== 0 ||
    dispositions?.retention?.auditMetadataDays !== 365 ||
    dispositions?.retention?.applicationAndUsageMetadataDays !== 90 ||
    dispositions?.retention?.metricsAndAlertStateDays !== 30
  ) {
    errors.push("PR-09 retention boundary changed")
  }
  if (
    dispositions?.scopeBoundaries?.sourceOnly !== true ||
    dispositions?.scopeBoundaries?.intermediateDeployment !== false ||
    dispositions?.scopeBoundaries?.finalNavigationOwner !== "PR-11" ||
    dispositions?.scopeBoundaries
      ?.nativeLinksMountedSecretsRuntimeAndNoBypassOwner !== "PR-12"
  ) {
    errors.push("PR-09 source-only scope boundary changed")
  }
  errors.push(...verifyPr09OperationBoundary(decision?.operationPolicy ?? {}))
  return errors.sort()
}

export function verifyPr09OperationBoundary(operationPolicy) {
  const sourceKeys = [
    "addedSourcePaths",
    "changedSourcePaths",
    "deletedSourcePaths",
  ]
  const repositoryKeys = [
    "addedRepositoryPaths",
    "changedRepositoryPaths",
    "deletedRepositoryPaths",
  ]
  const expectedKeys = [...sourceKeys, ...repositoryKeys].sort()
  const errors = [
    ...verifyExactPathPolicy(operationPolicy, sourceKeys, "PR-09"),
    ...verifyExactPathPolicy(operationPolicy, repositoryKeys, "PR-09"),
  ]
  if (
    JSON.stringify(Object.keys(operationPolicy).sort()) !==
    JSON.stringify(expectedKeys)
  ) {
    errors.push("invalid PR-09 operation policy keys")
  }
  if (
    (operationPolicy.deletedSourcePaths ?? []).length > 0 ||
    (operationPolicy.deletedRepositoryPaths ?? []).length > 0
  ) {
    errors.push("PR-09 source-only package must not delete Product paths")
  }

  const repositoryPathByOperation = new Map()
  const repositoryPaths = new Set()
  for (const key of repositoryKeys) {
    for (const path of operationPolicy[key] ?? []) {
      repositoryPaths.add(path)
      repositoryPathByOperation.set(path, key.replace("Repository", "Source"))
      if (
        !pr09AllowedRepositoryPathPatterns.some((pattern) => pattern.test(path))
      ) {
        errors.push(`PR-09 repository path is outside package boundary ${path}`)
      }
      if (
        pr09ImmutablePriorEvidencePaths.includes(path) &&
        !pr09SuccessorAwareHistoricalTestPaths.includes(path)
      ) {
        errors.push(
          `PR-09 immutable prior evidence appears in operation policy ${path}`,
        )
      }
      if (
        /(?:^|\/)(?:librechat|rag|corpora|knowledge|mcp|agentic)(?:\/|[-_.])/i.test(
          path,
        )
      ) {
        errors.push(
          `PR-09 retired or deferred product path is forbidden ${path}`,
        )
      }
      if (
        path !== ".env.example" &&
        /(?:^|\/)(?:\.env(?:\.|$)|[^/]+\.(?:key|pem|p12|pfx|jwk|jwks))$/i.test(
          path,
        )
      ) {
        errors.push(`PR-09 secret or key material path is forbidden ${path}`)
      }
    }
  }
  for (const requiredPath of pr09RequiredFrozenRepositoryPaths) {
    if (!repositoryPaths.has(requiredPath)) {
      errors.push(`PR-09 frozen repository path is missing ${requiredPath}`)
    }
  }
  for (const key of sourceKeys) {
    for (const path of operationPolicy[key] ?? []) {
      if (repositoryPathByOperation.get(path) !== key) {
        errors.push(
          `PR-09 source operation lacks matching repository operation ${key} ${path}`,
        )
      }
    }
  }
  return [...new Set(errors)].sort()
}

export function readPr10cDecisionDocument(root = repositoryRoot) {
  return readJson(resolve(root, pr10cDecisionPath))
}

export function buildPr10cSourceEvidence(
  root = repositoryRoot,
  { evidenceCommit = null } = {},
) {
  return pr10cSourceEvidencePaths.map((path) => {
    const absolutePath = resolve(root, path)
    if (!evidenceCommit && !isRegularFile(absolutePath)) {
      throw new Error(`Missing PR-10C source evidence file ${path}`)
    }
    const evidenceBytes = evidenceCommit
      ? readRepositoryPathAtCommit(root, evidenceCommit, path)
      : readFileSync(absolutePath)
    return { path, sha256: sha256(evidenceBytes) }
  })
}

export function verifyPr10cDecisionDocument(
  decision,
  {
    requireReady = false,
    root = repositoryRoot,
    sourceEvidenceCommit = null,
  } = {},
) {
  const errors = []
  const expectedKeys = [
    "contractBaseCommit",
    "contractBaseTree",
    "laneAnchorCommit",
    "operationPolicy",
    "reviewStatus",
    "reviewedDispositions",
    "schemaVersion",
    "scope",
    "sourceEvidence",
    "target",
    "workPackage",
  ]
  if (
    !decision ||
    JSON.stringify(Object.keys(decision).sort()) !==
      JSON.stringify(expectedKeys) ||
    decision.schemaVersion !== 1 ||
    decision.workPackage !== "PR-10C" ||
    decision.scope !== "emergency-isolation-source-only" ||
    decision.contractBaseCommit !== pr10cContractBase ||
    decision.contractBaseTree !== pr10cContractBaseTree ||
    decision.laneAnchorCommit !== pr10cLaneAnchor
  ) {
    errors.push("invalid PR-10C decision identity")
  }
  if (
    JSON.stringify(decision?.reviewedDispositions) !==
    JSON.stringify(pr10cReviewedDispositions)
  ) {
    errors.push("invalid PR-10C reviewed dispositions")
  }
  if (
    JSON.stringify(decision?.target) !== JSON.stringify(pr10cTargetContract)
  ) {
    errors.push("invalid PR-10C target")
  }
  if (
    !["pending-final-staged-delta", "reviewed"].includes(decision?.reviewStatus)
  ) {
    errors.push("invalid PR-10C review status")
  } else if (requireReady && decision.reviewStatus !== "reviewed") {
    errors.push("PR-10C operation policy is not reviewed")
  }

  let expectedSourceEvidence = []
  let effectiveSourceEvidenceCommit = sourceEvidenceCommit
  let sourceEvidenceAvailable = true
  if (decision?.reviewStatus === "reviewed") {
    if (
      !effectiveSourceEvidenceCommit &&
      isRegularFile(resolve(root, pr11DecisionPath))
    ) {
      const successorErrors = verifyReviewedPr11SuccessorContext(root)
      if (successorErrors.length > 0) {
        sourceEvidenceAvailable = false
        errors.push(
          ...successorErrors.map(
            (error) =>
              `PR-10C successor-historical source is unavailable: ${error}`,
          ),
        )
      } else {
        effectiveSourceEvidenceCommit = pr10cSuccessorEvidenceCommit
      }
    }
    try {
      if (sourceEvidenceAvailable) {
        expectedSourceEvidence = buildPr10cSourceEvidence(root, {
          evidenceCommit: effectiveSourceEvidenceCommit,
        })
      }
    } catch (error) {
      errors.push(String(error instanceof Error ? error.message : error))
    }
  }
  if (
    JSON.stringify(decision?.sourceEvidence) !==
    JSON.stringify(expectedSourceEvidence)
  ) {
    errors.push("invalid PR-10C source evidence")
  }

  const dispositions = decision?.reviewedDispositions
  if (
    JSON.stringify(dispositions?.historicalTestRepairs) !==
    JSON.stringify({
      paths: pr10cSuccessorAwareHistoricalTestPaths,
      retainedRevisionBindings: pr10cSuccessorAwareHistoricalTestBindings,
    })
  ) {
    errors.push("PR-10C historical test repair boundary changed")
  }
  if (
    dispositions?.isolationState?.scope !== "global-singleton" ||
    JSON.stringify(dispositions?.isolationState?.states) !==
      JSON.stringify(pr10cIsolationStates) ||
    JSON.stringify(dispositions?.isolationState?.failureCodes) !==
      JSON.stringify(pr10cIsolationFailureCodes) ||
    dispositions?.isolationState?.nonInactiveStateFailsClosed !== true ||
    dispositions?.isolationState?.optimisticRevisionRequired !== true ||
    dispositions?.isolationState?.stateAuditAndIdempotencyAtomicity !==
      "single-postgresql-transaction"
  ) {
    errors.push("PR-10C isolation state boundary changed")
  }
  if (
    dispositions?.routeAuthorization?.status?.capability !==
      "console.operational.view" ||
    JSON.stringify(dispositions?.routeAuthorization?.status?.allowedRoles) !==
      JSON.stringify(["Admin", "Operator"]) ||
    dispositions?.routeAuthorization?.mutations?.length !== 2 ||
    dispositions.routeAuthorization.mutations.some(
      (mutation) =>
        mutation.standingRole !== "Admin" ||
        mutation.emergencyElevatedOperatorAllowed !== false,
    ) ||
    dispositions?.routeAuthorization?.mutationReauthentication
      ?.maxAuthenticationAgeSeconds !== 300 ||
    JSON.stringify(
      dispositions?.routeAuthorization?.mutationReauthentication
        ?.acceptedMfaMethods,
    ) !== JSON.stringify(["otp", "hwk", "webauthn", "webauthn-passwordless"])
  ) {
    errors.push("PR-10C standing-Admin mutation boundary changed")
  }
  if (
    dispositions?.trafficEnforcement?.publicInferenceRoutesUnchanged !== true ||
    dispositions?.trafficEnforcement?.publicFirecrawlRoutesUnchanged !== true ||
    dispositions?.trafficEnforcement?.blocksNewInferenceAdmissions !== true ||
    dispositions?.trafficEnforcement?.blocksNewFirecrawlAdmissions !== true ||
    dispositions?.trafficEnforcement
      ?.activationWaitsForInflightAbortAndZeroLocalLeases !== true ||
    dispositions?.trafficEnforcement?.terminalFinalizationReservation !==
      true ||
    dispositions?.trafficEnforcement
      ?.successAccountingAndResponseShareFinalizationLane !== true ||
    dispositions?.trafficEnforcement
      ?.engagementWaitsForFinalizingResponseRelease !== true ||
    dispositions?.trafficEnforcement
      ?.isolationFirstSettlesFailureExactlyOnce !== true ||
    dispositions?.trafficEnforcement?.deactivationCommitReservation !== true ||
    dispositions?.trafficEnforcement
      ?.admissionsCannotInvalidatePreparedDeactivation !== true ||
    dispositions?.trafficEnforcement
      ?.localOpenOccursOnlyAfterDurableInactiveCommit !== true ||
    dispositions?.trafficEnforcement?.bulkApplicationDisableUsed !== false ||
    dispositions?.trafficEnforcement
      ?.liveTopologyFirewallAndNoBypassQualificationOwner !== "PR-12" ||
    dispositions?.trafficEnforcement
      ?.liveInflightDrainAndAbortQualificationOwner !== "PR-12"
  ) {
    errors.push("PR-10C traffic enforcement boundary changed")
  }
  if (
    dispositions?.restoreSafety?.restoreMayClearIsolation !== false ||
    dispositions?.restoreSafety
      ?.isolationFenceHeldAcrossRestoreAndCompensation !== true ||
    dispositions?.restoreSafety
      ?.fenceAcquisitionPersistsAndReadsBackRecoveryRequiredBeforeAnyActiveRestore !==
      true ||
    dispositions?.restoreSafety?.nonRestorableAuthorityRequired !== true ||
    dispositions?.restoreSafety?.unboundOrUnavailableAuthorityFailsClosed !==
      true ||
    dispositions?.restoreSafety?.operationScopedMarkerCompareAndSet !== true ||
    dispositions?.restoreSafety
      ?.startupReconcilesMarkerBeforeInactiveCanOpen !== true ||
    dispositions?.restoreSafety
      ?.markerAcquisitionFailureAttemptsConsoleRecoveryBeforeReject !== true ||
    dispositions?.restoreSafety
      ?.mutationsBlockedUntilMarkerClearLinearization !== true ||
    dispositions?.restoreSafety?.markerClearRequiresConsoleRecoveryReadback !==
      true ||
    dispositions?.restoreSafety
      ?.unfencedJournalAdmissionSealsUntilReconciled !== true ||
    dispositions?.restoreSafety
      ?.preparedUnfencedRestoreCasToRecoveryRequiredBeforeValidation !== true ||
    dispositions?.restoreSafety
      ?.survivingMarkerClearRequiresMatchingTerminalRestore !== true ||
    dispositions?.restoreSafety
      ?.unresolvedOrUnknownMarkerOwnerNeverClearedAtBootstrap !== true ||
    dispositions?.restoreSafety?.lifecycleReconciliationLockedAndIdempotent !==
      true ||
    JSON.stringify(dispositions?.restoreSafety?.postAdmissionOrdering) !==
      JSON.stringify([
        "journal.begin-created",
        "durable-recovery-required-fence-acquired-and-read-back",
        "prepareRestore-validation",
        "quiesce",
      ]) ||
    dispositions?.restoreSafety?.fenceOrderingExemption !==
      "pre-admission-manifest-rejection-only" ||
    dispositions?.restoreSafety
      ?.durableIsolationReassertedBeforeAdmissionReopens !== true ||
    dispositions?.restoreSafety?.reassertionFailureState !==
      "recovery_required" ||
    dispositions?.restoreSafety
      ?.everyAdmittedRestoreEndsDurableRecoveryRequired !== true ||
    dispositions?.restoreSafety
      ?.recoveryRequiredReassertedAfterEveryAppliedOrPartialRestoreFailureBeforeReturnOrResume !==
      true
  ) {
    errors.push("PR-10C restore safety boundary changed")
  }
  if (
    dispositions?.deferredWork?.liveTopologyQualificationOwner !== "PR-12" ||
    dispositions?.deferredWork?.firewallEnforcementQualificationOwner !==
      "PR-12" ||
    dispositions?.deferredWork?.inflightDrainAndAbortQualificationOwner !==
      "PR-12" ||
    dispositions?.deferredWork
      ?.nonRestorableAuthorityBackendAndQualificationOwner !== "PR-12" ||
    dispositions?.deferredWork?.productionDeploymentOwner !== "PR-12" ||
    dispositions?.deferredWork?.vendorMaintenanceAccessOwner !== "PR-10D"
  ) {
    errors.push("PR-10C deferred ownership boundary changed")
  }
  if (
    dispositions?.scopeBoundaries?.sourceOnly !== true ||
    dispositions?.scopeBoundaries?.intermediateDeployment !== false ||
    dispositions?.scopeBoundaries?.runtimeQualified !== false ||
    dispositions?.scopeBoundaries?.isolationRoutes !== 3 ||
    dispositions?.scopeBoundaries?.productionFirewallBindings !== 0
  ) {
    errors.push("PR-10C source-only scope boundary changed")
  }
  errors.push(
    ...verifyPr10cOperationBoundary(decision?.operationPolicy ?? {}, {
      requireComplete: requireReady,
    }),
  )
  return [...new Set(errors)].sort()
}

export function verifyPr10cOperationBoundary(
  operationPolicy,
  { requireComplete = true } = {},
) {
  const sourceKeys = [
    "addedSourcePaths",
    "changedSourcePaths",
    "deletedSourcePaths",
  ]
  const repositoryKeys = [
    "addedRepositoryPaths",
    "changedRepositoryPaths",
    "deletedRepositoryPaths",
  ]
  const expectedKeys = [...sourceKeys, ...repositoryKeys].sort()
  const errors = [
    ...verifyExactPathPolicy(operationPolicy, sourceKeys, "PR-10C"),
    ...verifyExactPathPolicy(operationPolicy, repositoryKeys, "PR-10C"),
  ]
  if (
    JSON.stringify(Object.keys(operationPolicy).sort()) !==
    JSON.stringify(expectedKeys)
  ) {
    errors.push("invalid PR-10C operation policy keys")
  }
  if (
    (operationPolicy.deletedSourcePaths ?? []).length > 0 ||
    (operationPolicy.deletedRepositoryPaths ?? []).length > 0
  ) {
    errors.push("PR-10C source-only package must not delete Product paths")
  }

  const repositoryPathByOperation = new Map()
  const repositoryPaths = new Set()
  for (const key of repositoryKeys) {
    for (const path of operationPolicy[key] ?? []) {
      repositoryPaths.add(path)
      repositoryPathByOperation.set(path, key.replace("Repository", "Source"))
      if (
        !pr10cAllowedRepositoryPathPatterns.some((pattern) =>
          pattern.test(path),
        )
      ) {
        errors.push(
          `PR-10C repository path is outside package boundary ${path}`,
        )
      }
      if (
        pr10cImmutablePriorEvidencePaths.includes(path) &&
        !pr10cSuccessorAwareHistoricalTestPaths.includes(path)
      ) {
        errors.push(
          `PR-10C immutable prior evidence appears in operation policy ${path}`,
        )
      }
      if (
        /(?:^|\/)(?:librechat|rag|corpora|knowledge|mcp|agentic)(?:\/|[-_.])/i.test(
          path,
        )
      ) {
        errors.push(
          `PR-10C retired or deferred product path is forbidden ${path}`,
        )
      }
      if (
        /(?:^|\/)(?:\.env(?:\.|$)|[^/]+\.(?:key|pem|p12|pfx|jwk|jwks))$/i.test(
          path,
        )
      ) {
        errors.push(`PR-10C secret or key material path is forbidden ${path}`)
      }
    }
  }
  if (requireComplete) {
    for (const requiredPath of pr10cRequiredFrozenRepositoryPaths) {
      if (!repositoryPaths.has(requiredPath)) {
        errors.push(`PR-10C frozen repository path is missing ${requiredPath}`)
      }
    }
  }
  for (const key of sourceKeys) {
    for (const path of operationPolicy[key] ?? []) {
      if (repositoryPathByOperation.get(path) !== key) {
        errors.push(
          `PR-10C source operation lacks matching repository operation ${key} ${path}`,
        )
      }
    }
  }
  return [...new Set(errors)].sort()
}

export function verifyPr10cGeneratedDestinationBoundary(stagedPaths) {
  const stagedPathSet = new Set(stagedPaths)
  return pr10cGeneratedDestinationPaths
    .filter((path) => stagedPathSet.has(path))
    .map(
      (path) =>
        `PR-10C generated destination must not be staged before generation ${path}`,
    )
}

export function readPr11DecisionDocument(root = repositoryRoot) {
  return readJson(resolve(root, pr11DecisionPath))
}

export function buildPr11SourceEvidence(root = repositoryRoot) {
  const sourceEvidenceCommit = [
    "source-candidate-awaiting-independent-review",
    "r1-c0-merged-source-package",
  ].includes(readPr11aR1C0ReviewStatus(root))
    ? pr11aR1C0ContractBase
    : null
  return pr11SourceEvidencePaths.map((path) => {
    const absolutePath = resolve(root, path)
    if (!sourceEvidenceCommit && !isRegularFile(absolutePath)) {
      throw new Error(`Missing PR-11 source evidence file ${path}`)
    }
    const bytes = sourceEvidenceCommit
      ? readRepositoryPathAtCommit(root, sourceEvidenceCommit, path)
      : readFileSync(absolutePath)
    return { path, sha256: sha256(bytes) }
  })
}

export function verifyPr11DecisionDocument(
  decision,
  { requireReady = false, root = repositoryRoot } = {},
) {
  const errors = []
  const expectedKeys = [
    "contractBaseCommit",
    "contractBaseTree",
    "laneAnchorCommit",
    "operationPolicy",
    "reviewStatus",
    "reviewedDispositions",
    "schemaVersion",
    "scope",
    "sourceEvidence",
    "target",
    "workPackage",
  ]
  if (
    !decision ||
    JSON.stringify(Object.keys(decision).sort()) !==
      JSON.stringify(expectedKeys) ||
    decision.schemaVersion !== 1 ||
    decision.workPackage !== "PR-11" ||
    decision.scope !==
      "retained-console-information-architecture-source-only" ||
    decision.contractBaseCommit !== pr11ContractBase ||
    decision.contractBaseTree !== pr11ContractBaseTree ||
    decision.laneAnchorCommit !== pr11LaneAnchor
  ) {
    errors.push("invalid PR-11 decision identity")
  }
  if (
    JSON.stringify(decision?.reviewedDispositions) !==
    JSON.stringify(pr11ReviewedDispositions)
  ) {
    errors.push("invalid PR-11 reviewed dispositions")
  }
  if (JSON.stringify(decision?.target) !== JSON.stringify(pr11TargetContract)) {
    errors.push("invalid PR-11 target")
  }
  if (
    !["pending-final-staged-delta", "reviewed"].includes(decision?.reviewStatus)
  ) {
    errors.push("invalid PR-11 review status")
  } else if (requireReady && decision.reviewStatus !== "reviewed") {
    errors.push("PR-11 operation policy is not reviewed")
  }

  let expectedSourceEvidence = []
  if (decision?.reviewStatus === "reviewed") {
    try {
      expectedSourceEvidence = buildPr11SourceEvidence(root)
    } catch (error) {
      errors.push(String(error instanceof Error ? error.message : error))
    }
  }
  if (
    JSON.stringify(decision?.sourceEvidence) !==
    JSON.stringify(expectedSourceEvidence)
  ) {
    errors.push("invalid PR-11 source evidence")
  }

  const dispositions = decision?.reviewedDispositions
  if (
    JSON.stringify(dispositions?.informationArchitecture?.logicalSurfaces) !==
      JSON.stringify(pr11LogicalSurfaceContract) ||
    dispositions?.informationArchitecture?.rootPath !== "/" ||
    dispositions?.informationArchitecture?.rootSurface !== "overview" ||
    dispositions?.informationArchitecture?.activityAuditPath !== "/activity" ||
    dispositions?.informationArchitecture?.exactOrderRequired !== true ||
    dispositions?.informationArchitecture
      ?.additionalProductNavigationEntries !== 0
  ) {
    errors.push("PR-11 information architecture boundary changed")
  }
  if (
    dispositions?.applications?.combinedConsoleSurface !== true ||
    JSON.stringify(dispositions?.applications?.capabilities) !==
      JSON.stringify(["inference", "firecrawl"]) ||
    JSON.stringify(dispositions?.applications?.credentialNamespaces) !==
      JSON.stringify(["inference", "firecrawl"]) ||
    dispositions?.applications?.credentialsRemainSeparate !== true ||
    dispositions?.applications?.firecrawlDefaultEnabled !== false
  ) {
    errors.push("PR-11 combined Applications boundary changed")
  }
  if (
    JSON.stringify(dispositions?.routeTransition?.removedRoutes) !==
      JSON.stringify(pr11RemovedRouteContract) ||
    JSON.stringify(dispositions?.routeTransition?.addedRoutes) !== "[]" ||
    JSON.stringify(dispositions?.routeTransition?.reclassifiedRoutes) !==
      "[]" ||
    dispositions?.routeTransition?.fastifyRegistrarChanges !== 0 ||
    JSON.stringify(
      dispositions?.routeTransition?.resolverFingerprintTransitions,
    ) !== JSON.stringify(pr11RouteFingerprintTransitions)
  ) {
    errors.push("PR-11 route transition boundary changed")
  }
  if (
    dispositions?.settingsMutations?.productionPersistence !==
      "postgresql-required" ||
    dispositions?.settingsMutations?.fixtureMemoryOnly !== true ||
    dispositions?.settingsMutations?.atomicSettingsReceiptAudit !== true ||
    dispositions?.settingsMutations?.sharedTransactionAuditWriter !== true ||
    dispositions?.settingsMutations?.unavailableWithoutPersistence !== true ||
    dispositions?.settingsMutations?.freshDatabaseTelemetryPreviewDefault !==
      "schema-valid" ||
    dispositions?.settingsMutations?.productionTelemetryPreviewParsing !==
      "strict-no-fallback"
  ) {
    errors.push("PR-11 Settings persistence boundary changed")
  }
  if (
    dispositions?.webContentSecurityPolicy?.perRequestScriptNonce !== true ||
    dispositions?.webContentSecurityPolicy?.requestResponsePolicyMatch !==
      true ||
    dispositions?.webContentSecurityPolicy?.productionUnsafeInlineScript !==
      false ||
    dispositions?.webContentSecurityPolicy?.productionUnsafeEval !== false
  ) {
    errors.push("PR-11 Web content security policy boundary changed")
  }
  if (
    JSON.stringify(dispositions?.expertServices?.previews) !==
      JSON.stringify(pr11ExpertPreviewContract) ||
    dispositions?.expertServices?.nativeLinksEnabled !== false ||
    dispositions?.expertServices?.nativeUrlsEmbeddedInProductNavigation !==
      false ||
    dispositions?.expertServices?.noBypassQualificationOwner !== "PR-12"
  ) {
    errors.push("PR-11 expert preview boundary changed")
  }
  if (
    Object.values(dispositions?.retiredProductSurfaces ?? {}).some(
      (value) => value !== false,
    ) ||
    Object.keys(dispositions?.retiredProductSurfaces ?? {}).length !== 9
  ) {
    errors.push("PR-11 retired product surface boundary changed")
  }
  if (
    dispositions?.scopeBoundaries?.sourceOnly !== true ||
    dispositions?.scopeBoundaries?.intermediateDeployment !== false ||
    dispositions?.scopeBoundaries?.runtimeQualified !== false ||
    dispositions?.scopeBoundaries?.nativeExpertSessionActivation !== false ||
    dispositions?.scopeBoundaries?.signingKeyMutation !== false ||
    dispositions?.scopeBoundaries?.vendorMaintenanceAccessMutation !== false
  ) {
    errors.push("PR-11 source-only scope boundary changed")
  }
  errors.push(
    ...verifyPr11OperationBoundary(decision?.operationPolicy ?? {}, {
      requireComplete: requireReady,
    }),
  )
  return [...new Set(errors)].sort()
}

export function verifyPr11OperationBoundary(
  operationPolicy,
  { requireComplete = true } = {},
) {
  const sourceKeys = [
    "addedSourcePaths",
    "changedSourcePaths",
    "deletedSourcePaths",
  ]
  const repositoryKeys = [
    "addedRepositoryPaths",
    "changedRepositoryPaths",
    "deletedRepositoryPaths",
  ]
  const expectedKeys = [...sourceKeys, ...repositoryKeys].sort()
  const errors = [
    ...verifyExactPathPolicy(operationPolicy, sourceKeys, "PR-11"),
    ...verifyExactPathPolicy(operationPolicy, repositoryKeys, "PR-11"),
  ]
  if (
    JSON.stringify(Object.keys(operationPolicy).sort()) !==
    JSON.stringify(expectedKeys)
  ) {
    errors.push("invalid PR-11 operation policy keys")
  }
  if (
    (operationPolicy.deletedSourcePaths ?? []).length > 0 ||
    (operationPolicy.deletedRepositoryPaths ?? []).length > 0
  ) {
    errors.push("PR-11 source-only package must not delete Product paths")
  }

  const repositoryPathByOperation = new Map()
  const repositoryPaths = new Set()
  for (const key of repositoryKeys) {
    for (const path of operationPolicy[key] ?? []) {
      repositoryPaths.add(path)
      repositoryPathByOperation.set(path, key.replace("Repository", "Source"))
      if (!pr11AllowedRepositoryPaths.includes(path)) {
        errors.push(`PR-11 repository path is outside package boundary ${path}`)
      }
      if (
        pr11ImmutablePriorEvidencePaths.includes(path) &&
        !pr11SuccessorHistoricalEvidencePaths.includes(path)
      ) {
        errors.push(
          `PR-11 immutable prior evidence appears in operation policy ${path}`,
        )
      }
      if (
        /(?:^|\/)(?:librechat|rag|corpora|knowledge|mcp|agentic|portainer)(?:\/|[-_.])/i.test(
          path,
        )
      ) {
        errors.push(
          `PR-11 retired or deferred product path is forbidden ${path}`,
        )
      }
      if (
        path !== ".env.example" &&
        /(?:^|\/)(?:\.env(?:\.[^/]+)?|[^/]+\.(?:key|pem|p12|pfx|jwk|jwks))$/i.test(
          path,
        )
      ) {
        errors.push(`PR-11 secret or key material path is forbidden ${path}`)
      }
    }
  }
  if (requireComplete) {
    for (const requiredPath of pr11RequiredFrozenRepositoryPaths) {
      if (!repositoryPaths.has(requiredPath)) {
        errors.push(`PR-11 frozen repository path is missing ${requiredPath}`)
      }
    }
  }
  for (const key of sourceKeys) {
    for (const path of operationPolicy[key] ?? []) {
      if (repositoryPathByOperation.get(path) !== key) {
        errors.push(
          `PR-11 source operation lacks matching repository operation ${key} ${path}`,
        )
      }
    }
  }
  return [...new Set(errors)].sort()
}

export function verifyPr11GeneratedDestinationBoundary(stagedPaths) {
  const stagedPathSet = new Set(stagedPaths)
  return pr11GeneratedDestinationPaths
    .filter((path) => stagedPathSet.has(path))
    .map(
      (path) =>
        `PR-11 generated destination must not be staged before generation ${path}`,
    )
}

export function verifyPr11BaseEvidence(root = repositoryRoot) {
  const errors = []
  for (const path of pr11ImmutablePriorEvidencePaths) {
    let expected
    try {
      expected = readRepositoryPathAtCommit(root, pr11ContractBase, path)
    } catch {
      errors.push(`PR-11 immutable base evidence is unavailable ${path}`)
      continue
    }
    const absolutePath = resolve(root, path)
    if (!isRegularFile(absolutePath)) {
      errors.push(`PR-11 retained prior evidence is missing ${path}`)
      continue
    }
    if (pr11SuccessorHistoricalEvidencePaths.includes(path)) {
      continue
    }
    const retainedBytes =
      readPr11aR1C0HistoricalPriorEvidence(root, path) ??
      readFileSync(absolutePath)
    if (!retainedBytes.equals(expected)) {
      errors.push(`PR-11 retained prior evidence changed ${path}`)
    }
  }
  return errors.sort()
}

export function verifyPr11RetainedRouteContract(base, current) {
  const errors = []
  for (const key of [
    "baseCommit",
    "target",
    "fastifyRegistrars",
    "webInferenceConsumers",
    "escapeHatches",
  ]) {
    if (JSON.stringify(current?.[key]) !== JSON.stringify(base?.[key])) {
      errors.push(`PR-11 retained route boundary changed ${key}`)
    }
  }
  const expectedFingerprints = structuredClone(base?.fingerprints ?? [])
  for (const transition of pr11RouteFingerprintTransitions) {
    const matches = expectedFingerprints.filter(
      (fingerprint) =>
        fingerprint.path === transition.path &&
        fingerprint.symbol === transition.symbol,
    )
    if (matches.length !== 1 || matches[0].sha256 !== transition.beforeSha256) {
      errors.push(
        `PR-11 route fingerprint base changed ${transition.path}#${transition.symbol}`,
      )
      continue
    }
    matches[0].sha256 = transition.afterSha256
  }
  if (
    JSON.stringify(current?.fingerprints ?? []) !==
    JSON.stringify(expectedFingerprints)
  ) {
    errors.push("PR-11 route fingerprint transition changed")
  }
  const removedBaseRoutes = (base?.routes ?? []).filter((route) =>
    pr11RemovedRouteContract.some(
      (removedRoute) => JSON.stringify(route) === JSON.stringify(removedRoute),
    ),
  )
  if (
    JSON.stringify(removedBaseRoutes) !==
    JSON.stringify(pr11RemovedRouteContract)
  ) {
    errors.push("PR-11 reviewed route removal is absent from the base")
  }
  const expectedRoutes = (base?.routes ?? []).filter(
    (route) =>
      !pr11RemovedRouteContract.some(
        (removedRoute) =>
          JSON.stringify(route) === JSON.stringify(removedRoute),
      ),
  )
  if (JSON.stringify(current?.routes) !== JSON.stringify(expectedRoutes)) {
    errors.push("PR-11 retained route boundary changed routes")
  }
  return errors.sort()
}

export function extractPr11ConsoleHrefManifest(path, source) {
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  const manifest = []
  const visit = (node) => {
    if (ts.isJsxAttribute(node) && node.name.getText(sourceFile) === "href") {
      let expression = "boolean:true"
      if (ts.isStringLiteral(node.initializer)) {
        expression = `literal:${node.initializer.text}`
      } else if (ts.isJsxExpression(node.initializer)) {
        expression = `expression:${normalizePr11SourceExpression(
          node.initializer.expression?.getText(sourceFile) ?? "",
        )}`
      } else if (node.initializer) {
        expression = `other:${normalizePr11SourceExpression(
          node.initializer.getText(sourceFile),
        )}`
      }
      manifest.push({ path, expression })
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return manifest.sort(comparePr11HrefEntries)
}

export function buildPr11ConsoleHrefManifest(
  root = repositoryRoot,
  paths = listCandidatePaths(root),
) {
  return paths
    .filter(isPr11ConsoleProductionSourcePath)
    .flatMap((path) => {
      const absolutePath = resolve(root, path)
      return isRegularFile(absolutePath)
        ? extractPr11ConsoleHrefManifest(
            path,
            readFileSync(absolutePath, "utf8"),
          )
        : []
    })
    .sort(comparePr11HrefEntries)
}

export function verifyPr11ConsoleHrefManifest(manifest) {
  return JSON.stringify(manifest) === JSON.stringify(pr11ConsoleHrefManifest)
    ? []
    : ["PR-11 Console href manifest changed"]
}

export function verifyPr11ConsoleSourceLinkBoundary(path, source) {
  if (!isPr11ConsoleProductionSourcePath(path)) {
    return []
  }
  const withoutSvgNamespace = source.replaceAll(
    "http://www.w3.org/2000/svg",
    "",
  )
  return /https?:\/\//i.test(withoutSvgNamespace)
    ? [`PR-11 external URL literal remains ${path}`]
    : []
}

export function verifyPr11ExpertPayloadSourceBoundary(path, source) {
  if (
    !/^(?:apps\/(?:bff|web)\/src|packages\/contracts\/src)\//.test(path) ||
    /(?:\.test|\.spec)\.[cm]?[jt]sx?$/.test(path)
  ) {
    return []
  }
  const fieldPattern =
    /\b(?:grafanaUrl|alertmanagerUrl|liteLlmUrl|keycloakHref)\b/
  const nullOnlyPropertyPattern =
    /^\s*(?:grafanaUrl|alertmanagerUrl|liteLlmUrl|keycloakHref):\s*(?:null|z\.null\(\)),?\s*$/
  return source
    .split("\n")
    .flatMap((line, index) =>
      fieldPattern.test(line) && !nullOnlyPropertyPattern.test(line)
        ? [
            `PR-11 native expert payload field is not null-only ${path}:${index + 1}`,
          ]
        : [],
    )
}

export function verifyPr11OverviewHrefContractSource(source) {
  const sourceFile = ts.createSourceFile(
    "packages/contracts/src/inference-core.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )
  const errors = []
  const tileHref = pr11SchemaPropertyInitializer(
    sourceFile,
    "adminOverviewTileSchema",
    "href",
  )
  if (
    JSON.stringify(pr11ZodStringEnumValues(tileHref)) !==
    JSON.stringify(["/applications", "/inference", "/hardware", "/activity"])
  ) {
    errors.push("PR-11 Overview tile href contract is not internal-only")
  }
  const eventHref = pr11SchemaPropertyInitializer(
    sourceFile,
    "adminActivityEventSchema",
    "href",
  )
  const expectedEventHref = String.raw`z.string().regex(/^\/activity\?eventId=[A-Za-z0-9_.!~*'()%\-]+$/)`
  if (
    normalizePr11CompactSource(eventHref?.getText(sourceFile)) !==
    expectedEventHref
  ) {
    errors.push("PR-11 Overview activity href contract is not internal-only")
  }
  return errors.sort()
}

export function verifyPr11OverviewRouteParseBoundary(source) {
  return /adminOverviewResponseSchema\.parse\(\s*await\s+getAdminOverview\(\s*requireActor\(request\)\s*\)\s*,?\s*\)/.test(
    source,
  )
    ? []
    : ["PR-11 BFF Overview response is not contract-parsed"]
}

export function verifyPr11EnvExampleTransition(baseSource, currentSource) {
  if (!baseSource.endsWith(pr11RetiredEnvExampleBlock)) {
    return ["PR-11 base .env.example retired block changed"]
  }
  const expected = baseSource.slice(0, -pr11RetiredEnvExampleBlock.length)
  return currentSource === expected
    ? []
    : [
        "PR-11 .env.example may only delete the exact retired model-update block",
      ]
}

export function verifyPr11EnvExampleWorktree(root = repositoryRoot) {
  const path = ".env.example"
  const absolutePath = resolve(root, path)
  if (!isRegularFile(absolutePath)) {
    return ["PR-11 .env.example is missing"]
  }
  let baseSource
  try {
    baseSource = readRepositoryPathAtCommit(
      root,
      pr11ContractBase,
      path,
    ).toString("utf8")
  } catch {
    return ["PR-11 base .env.example is unavailable"]
  }
  return verifyPr11EnvExampleTransition(
    baseSource,
    readFileSync(absolutePath, "utf8"),
  )
}

function isPr11ConsoleProductionSourcePath(path) {
  return (
    /^apps\/web\/src\/components\/console-v2\/.*\.[cm]?[jt]sx?$/.test(path) &&
    !/(?:\.test|\.spec)\.[cm]?[jt]sx?$/.test(path)
  )
}

function comparePr11HrefEntries(left, right) {
  if (left.path !== right.path) {
    return left.path < right.path ? -1 : 1
  }
  if (left.expression !== right.expression) {
    return left.expression < right.expression ? -1 : 1
  }
  return 0
}

function normalizePr11SourceExpression(source) {
  return source.replace(/\s+/g, " ").trim()
}

function normalizePr11CompactSource(source) {
  return typeof source === "string" ? source.replace(/\s+/g, "") : ""
}

function pr11SchemaPropertyInitializer(sourceFile, schemaName, propertyName) {
  let schemaDeclaration
  const findSchema = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === schemaName
    ) {
      schemaDeclaration = node
      return
    }
    ts.forEachChild(node, findSchema)
  }
  findSchema(sourceFile)
  if (!schemaDeclaration?.initializer) {
    return undefined
  }

  let initializer
  const findProperty = (node) => {
    if (initializer) {
      return
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "object" &&
      ts.isObjectLiteralExpression(node.arguments[0])
    ) {
      const property = node.arguments[0].properties.find(
        (candidate) =>
          ts.isPropertyAssignment(candidate) &&
          candidate.name.getText(sourceFile) === propertyName,
      )
      if (property && ts.isPropertyAssignment(property)) {
        initializer = property.initializer
        return
      }
    }
    ts.forEachChild(node, findProperty)
  }
  findProperty(schemaDeclaration.initializer)
  return initializer
}

function pr11ZodStringEnumValues(initializer) {
  if (
    !initializer ||
    !ts.isCallExpression(initializer) ||
    !ts.isPropertyAccessExpression(initializer.expression) ||
    initializer.expression.expression.getText() !== "z" ||
    initializer.expression.name.text !== "enum" ||
    !ts.isArrayLiteralExpression(initializer.arguments[0]) ||
    initializer.arguments[0].elements.some(
      (element) => !ts.isStringLiteral(element),
    )
  ) {
    return undefined
  }
  return initializer.arguments[0].elements.map((element) => element.text)
}

export function verifyPr11SourceBoundary(
  root = repositoryRoot,
  paths = listCandidatePaths(root),
) {
  const errors = []
  const candidatePaths = new Set(paths)
  const read = (path) => {
    const absolutePath = resolve(root, path)
    if (!candidatePaths.has(path) || !isRegularFile(absolutePath)) {
      errors.push(`PR-11 source boundary path is missing ${path}`)
      return ""
    }
    return readFileSync(absolutePath, "utf8")
  }

  const sectionsPath =
    "apps/web/src/components/console-v2/console-v2-sections.ts"
  const sectionsSource = read(sectionsPath)
  const navigationEntries = [
    ...sectionsSource.matchAll(/\{\s*id:\s*"([^"]+)"[\s\S]*?\n\s*\},/g),
  ].map((match) => ({
    id: match[1],
    href: match[0].match(/\bhref:\s*"([^"]+)"/)?.[1],
    label: match[0].match(/\blabel:\s*"([^"]+)"/)?.[1],
  }))
  const expectedNavigationEntries = pr11LogicalSurfaceContract.map(
    ({ id, href, label }) => ({
      id: id === "activity-audit" ? "activity" : id,
      href,
      label,
    }),
  )
  if (
    JSON.stringify(navigationEntries) !==
    JSON.stringify(expectedNavigationEntries)
  ) {
    errors.push("PR-11 navigation inventory or order changed")
  }
  if (
    /label:\s*"(?:Chat|Knowledge|MCP|Agentic|Portainer|Builder|Hub)"/i.test(
      sectionsSource,
    )
  ) {
    errors.push("PR-11 retired or deferred navigation entry is present")
  }

  const rootPage = read("apps/web/src/app/page.tsx")
  if (
    /\bredirect\s*\(/.test(rootPage) ||
    rootPage.includes('"/applications"') ||
    !/renderOverviewConsoleRoute|OverviewV2Experience/.test(rootPage)
  ) {
    errors.push("PR-11 root path does not render Overview directly")
  }
  const routeCore = read("apps/web/src/lib/admin/console-v2-routes-core.tsx")
  if (!routeCore.includes("renderOverviewConsoleRoute")) {
    errors.push("PR-11 Overview route renderer is missing")
  }
  const serverData = read("apps/web/src/lib/admin/server-data-core.ts")
  if (!serverData.includes("getAdminOverview")) {
    errors.push("PR-11 source-backed Overview loader is missing")
  }
  read("apps/web/src/components/console-v2/overview-v2-experience.tsx")

  const applicationsSource = read(
    "apps/web/src/components/console-v2/applications-v2-experience.tsx",
  )
  if (
    !/inference/i.test(applicationsSource) ||
    !/firecrawl/i.test(applicationsSource)
  ) {
    errors.push("PR-11 Applications does not combine inference and Firecrawl")
  }

  const contractsSource = read("packages/contracts/src/inference-core.ts")
  errors.push(...verifyPr11OverviewHrefContractSource(contractsSource))
  const adminRouteSource = read("apps/bff/src/routes/admin.ts")
  errors.push(...verifyPr11OverviewRouteParseBoundary(adminRouteSource))
  errors.push(
    ...verifyPr11ConsoleHrefManifest(buildPr11ConsoleHrefManifest(root, paths)),
  )
  errors.push(...verifyPr11EnvExampleWorktree(root))

  const nativeExpertAffordancePattern =
    /\b(?:Open(?: in)? (?:Grafana|LiteLLM|Keycloak)|Advanced identity settings are managed in Keycloak)\b/g
  const retiredImportPattern =
    /(?:from\s+|import\s*\()["'][^"']*(?:\/(?:chat|knowledge|mcp|agentic|builder|hub|portainer)(?:\/|[."']))/gi
  const mockImportPattern =
    /(?:from\s+|import\s*\()["'][^"']*\/(?:mocks?|fixtures?)(?:\/|["'])/gi
  for (const path of paths) {
    if (
      /(?:\.test|\.spec)\.[cm]?[jt]sx?$/.test(path) ||
      !isRegularFile(resolve(root, path))
    ) {
      continue
    }
    const source = readFileSync(resolve(root, path), "utf8")
    errors.push(...verifyPr11ExpertPayloadSourceBoundary(path, source))
    errors.push(...verifyPr11ConsoleSourceLinkBoundary(path, source))
    if (!path.startsWith("apps/web/src/")) {
      continue
    }
    if (nativeExpertAffordancePattern.test(source)) {
      errors.push(`PR-11 native expert access affordance remains ${path}`)
    }
    nativeExpertAffordancePattern.lastIndex = 0
    if (retiredImportPattern.test(source)) {
      errors.push(`PR-11 retired loader or bundle import remains ${path}`)
    }
    retiredImportPattern.lastIndex = 0
    if (
      pr11SourceEvidencePaths.includes(path) &&
      mockImportPattern.test(source)
    ) {
      errors.push(`PR-11 mock or fixture import remains ${path}`)
    }
    mockImportPattern.lastIndex = 0
  }
  return [...new Set(errors)].sort()
}

export function verifyPr11TargetState({
  root = repositoryRoot,
  currentAllowlist,
  currentRoutes,
  paths = listCandidatePaths(root),
}) {
  const errors = []
  const activeRevision = currentRoutes.reviewedRevisions?.at(-1)?.id
  if (!["PR-10C", "PR-11"].includes(activeRevision)) {
    errors.push(
      `PR-11 target has invalid active predecessor ${String(activeRevision)}`,
    )
  }
  if ((currentRoutes.routes ?? []).length !== pr11TargetContract.routes) {
    errors.push(
      `PR-11 total route count changed expected=${pr11TargetContract.routes} actual=${(currentRoutes.routes ?? []).length}`,
    )
  }
  const classificationCounts = Object.fromEntries(
    [...routeCountsByClassification(currentRoutes.routes ?? [])].sort(),
  )
  if (
    JSON.stringify(classificationCounts) !==
    JSON.stringify(pr11TargetContract.routeClassifications)
  ) {
    errors.push("PR-11 route classification counts changed")
  }
  if (
    JSON.stringify(currentRoutes.fastifyRegistrars ?? []) !==
    JSON.stringify(pr11TargetContract.fastifyRegistrars)
  ) {
    errors.push("PR-11 Fastify registrar target changed")
  }
  if ((currentRoutes.webInferenceConsumers ?? []).length !== 0) {
    errors.push("PR-11 Web inference consumer count is not zero")
  }
  if ((currentRoutes.escapeHatches ?? []).length !== 0) {
    errors.push("PR-11 mutable legacy escape hatch remains")
  }
  if (
    JSON.stringify(currentRoutes.target) !== JSON.stringify(targetRouteContract)
  ) {
    errors.push("PR-11 route target contract changed")
  }
  const currentEntries = currentAllowlist.entries ?? []
  if (
    currentEntries.length !== 1 ||
    currentEntries[0]?.ruleId !== "FS105_BUILDER_HUB" ||
    currentEntries[0]?.path !== "apps/web/src/middleware.test.ts" ||
    currentEntries[0]?.removeBy !== "PR-12"
  ) {
    errors.push("PR-11 remaining finding boundary changed")
  }
  for (const path of pr11RequiredFrozenRepositoryPaths) {
    if (!isRegularFile(resolve(root, path))) {
      errors.push(`PR-11 frozen repository path is missing ${path}`)
    }
  }
  errors.push(...verifyPr11BaseEvidence(root))
  errors.push(...verifyPr11SourceBoundary(root, paths))
  return [...new Set(errors)].sort()
}

export function verifyPr11CandidateContract({
  root = repositoryRoot,
  baseAllowlist,
  currentAllowlist,
  baseRoutes,
  currentRoutes,
  operationPolicy,
}) {
  const errors = [
    ...verifyPr11RetainedRouteContract(baseRoutes, currentRoutes),
    ...verifyPr11OperationBoundary(operationPolicy ?? {}, {
      requireComplete: true,
    }),
    ...verifyExactClosureChanges(
      baseRoutes.sourceClosure ?? [],
      currentRoutes.sourceClosure ?? [],
      operationPolicy,
      {
        addedKey: "addedSourcePaths",
        changedKey: "changedSourcePaths",
        deletedKey: "deletedSourcePaths",
        label: "source closure",
      },
      "PR-11",
    ),
    ...verifyExactClosureChanges(
      baseRoutes.repositoryClosure ?? [],
      currentRoutes.repositoryClosure ?? [],
      operationPolicy,
      {
        addedKey: "addedRepositoryPaths",
        changedKey: "changedRepositoryPaths",
        deletedKey: "deletedRepositoryPaths",
        label: "repository closure",
      },
      "PR-11",
    ),
    ...verifyPr11TargetState({
      root,
      currentAllowlist,
      currentRoutes,
      paths: (currentRoutes.repositoryClosure ?? []).map(({ path }) => path),
    }),
  ]
  if (
    JSON.stringify(baseAllowlist.entries ?? []) !==
    JSON.stringify(currentAllowlist.entries ?? [])
  ) {
    errors.push("PR-11 forbidden finding inventory changed")
  }
  return [...new Set(errors)].sort()
}

export function readPr10DecisionDocument(root = repositoryRoot) {
  return readJson(resolve(root, pr10DecisionPath))
}

export function buildPr10SourceEvidence(root = repositoryRoot) {
  return pr10SourceEvidencePaths.map((path) => {
    const absolutePath = resolve(root, path)
    if (!isRegularFile(absolutePath)) {
      throw new Error(`Missing PR-10 source evidence file ${path}`)
    }
    return { path, sha256: sha256(readFileSync(absolutePath)) }
  })
}

export function verifyPr10DecisionDocument(
  decision,
  { requireReady = false, root = repositoryRoot } = {},
) {
  const errors = []
  const expectedKeys = [
    "contractBaseCommit",
    "contractBaseTree",
    "laneAnchorCommit",
    "operationPolicy",
    "reviewStatus",
    "reviewedDispositions",
    "schemaVersion",
    "scope",
    "sourceEvidence",
    "standaloneDbTestBoundary",
    "target",
    "workPackage",
  ]
  if (
    !decision ||
    JSON.stringify(Object.keys(decision).sort()) !==
      JSON.stringify(expectedKeys) ||
    decision.schemaVersion !== 1 ||
    decision.workPackage !== "PR-10" ||
    decision.scope !== "lifecycle-snapshot-restore-foundation-source-only" ||
    decision.contractBaseCommit !== pr10ContractBase ||
    decision.contractBaseTree !== pr10ContractBaseTree ||
    decision.laneAnchorCommit !== pr10LaneAnchor
  ) {
    errors.push("invalid PR-10 decision identity")
  }
  if (
    JSON.stringify(decision?.reviewedDispositions) !==
    JSON.stringify(pr10ReviewedDispositions)
  ) {
    errors.push("invalid PR-10 reviewed dispositions")
  }
  if (
    JSON.stringify(decision?.standaloneDbTestBoundary) !==
    JSON.stringify(pr10StandaloneDbTestBoundary)
  ) {
    errors.push("invalid PR-10 standalone DB test boundary")
  }
  let expectedSourceEvidence = []
  try {
    expectedSourceEvidence = buildPr10SourceEvidence(root)
  } catch (error) {
    errors.push(String(error instanceof Error ? error.message : error))
  }
  if (
    JSON.stringify(decision?.sourceEvidence) !==
    JSON.stringify(expectedSourceEvidence)
  ) {
    errors.push("invalid PR-10 source evidence")
  }
  if (JSON.stringify(decision?.target) !== JSON.stringify(pr10TargetContract)) {
    errors.push("invalid PR-10 target")
  }
  if (
    !["pending-final-staged-delta", "reviewed"].includes(decision?.reviewStatus)
  ) {
    errors.push("invalid PR-10 review status")
  } else if (requireReady && decision.reviewStatus !== "reviewed") {
    errors.push("PR-10 operation policy is not reviewed")
  }

  const dispositions = decision?.reviewedDispositions
  if (
    JSON.stringify(dispositions?.lifecycleFoundation?.components) !==
      JSON.stringify(pr10LifecycleComponents) ||
    dispositions?.lifecycleFoundation?.consistencyModel !==
      "coordinated-quiescence-not-cross-service-acid" ||
    dispositions?.lifecycleFoundation?.oneUnresolvedOperation !== true ||
    dispositions?.lifecycleFoundation?.recoveryRequiredBlocksNewWork !== true ||
    dispositions?.lifecycleFoundation?.rawErrorTextPersisted !== false
  ) {
    errors.push("PR-10 lifecycle foundation boundary changed")
  }
  if (
    dispositions?.snapshotManifest?.contentFree !== true ||
    dispositions?.snapshotManifest?.workloadContentIncluded !== false ||
    dispositions?.snapshotManifest?.plaintextSecretsIncluded !== false ||
    dispositions?.snapshotManifest?.emergencySessionsIncluded !== false ||
    dispositions?.snapshotManifest?.artifactBytesPersistedByFoundation !==
      false ||
    dispositions?.snapshotManifest?.runtimeArtifactComplianceProven !== false
  ) {
    errors.push("PR-10 content-free manifest boundary changed")
  }
  if (
    dispositions?.restoreSafety?.prepareEveryComponentBeforeActiveRestore !==
      true ||
    dispositions?.restoreSafety?.preparationMutatesActiveState !== false ||
    dispositions?.restoreSafety
      ?.rollbackCapabilityRequiredBeforeActiveRestore !== true ||
    dispositions?.restoreSafety?.preparationDiscardOrder !== "reverse" ||
    dispositions?.restoreSafety?.uncertainResumeAttemptState !==
      "possibly-live" ||
    dispositions?.restoreSafety
      ?.reQuiescePossiblyLiveComponentsBeforeRollback !== true ||
    dispositions?.restoreSafety?.activationFence?.acquisition !==
      "before-first-active-restore" ||
    dispositions?.restoreSafety?.activationFence?.hold !==
      "through-active-restore-verification-and-safe-resume-or-compensation" ||
    dispositions?.restoreSafety?.activationFence?.close !==
      "only-after-safe-resume-or-compensation" ||
    dispositions?.restoreSafety?.activationFence
      ?.reopenBeforeRollbackAfterClose !== true ||
    dispositions?.restoreSafety?.activationFence
      ?.resetImmediatelyAfterReopen !== true ||
    dispositions?.restoreSafety?.activationFence?.reopenOrResetFailure !==
      "recovery_required-with-fence-held-when-acquired" ||
    dispositions?.restoreSafety?.zeroEmergencySessionsBeforeActiveRestore !==
      true ||
    dispositions?.restoreSafety
      ?.zeroEmergencySessionsAfterRestoreOrCompensation !== true ||
    dispositions?.restoreSafety?.inconsistentCredentialState !==
      "fail-closed-and-rollback" ||
    dispositions?.restoreSafety?.rollingBackAdmissionFailure !==
      "recovery_required-preserve-quiescence-and-held-fence" ||
    dispositions?.restoreSafety?.rollbackFailureState !== "recovery_required"
  ) {
    errors.push("PR-10 restore safety boundary changed")
  }
  if (
    dispositions?.zeroContentRetention?.workloadContentDays !== 0 ||
    dispositions?.zeroContentRetention?.runtimeQualificationOwner !== "PR-12"
  ) {
    errors.push("PR-10 zero-content retention boundary changed")
  }
  if (
    dispositions?.deferredBindings?.configuredRuntimeAdapters !== 0 ||
    dispositions?.deferredBindings?.componentEndpointsConfigured !== false ||
    dispositions?.deferredBindings?.componentCredentialsConfigured !== false ||
    dispositions?.deferredBindings?.componentPathsConfigured !== false ||
    dispositions?.deferredBindings?.backupDestinationConfigured !== false ||
    dispositions?.deferredBindings?.backupEncryptionKeyConfigured !== false ||
    dispositions?.deferredBindings?.signingKeyConfigured !== false ||
    dispositions?.deferredBindings?.schedulerConfigured !== false ||
    dispositions?.deferredBindings?.lifecycleRoutesRegistered !== 0 ||
    dispositions?.deferredBindings?.signingTrustAndCustodyOwner !== "PR-10A" ||
    dispositions?.deferredBindings
      ?.backupDestinationEncryptionRetentionAndRecoveryOwner !== "PR-10B" ||
    dispositions?.deferredBindings
      ?.productionBindingsDeploymentAndQualificationOwner !== "PR-12"
  ) {
    errors.push("PR-10 deferred runtime binding boundary changed")
  }
  if (
    JSON.stringify(dispositions?.historicalTestRepair) !==
    JSON.stringify(pr10Pr06FixtureRepair)
  ) {
    errors.push("PR-10 historical test-only repair boundary changed")
  }
  if (
    dispositions?.scopeBoundaries?.sourceOnly !== true ||
    dispositions?.scopeBoundaries?.intermediateDeployment !== false ||
    dispositions?.scopeBoundaries?.runtimeQualified !== false ||
    dispositions?.scopeBoundaries?.configuredRuntimeAdapters !== 0 ||
    dispositions?.scopeBoundaries?.lifecycleRoutes !== 0
  ) {
    errors.push("PR-10 source-only scope boundary changed")
  }
  errors.push(
    ...verifyPr10OperationBoundary(decision?.operationPolicy ?? {}, {
      requireComplete: requireReady,
    }),
  )
  return [...new Set(errors)].sort()
}

export function verifyPr10OperationBoundary(
  operationPolicy,
  { requireComplete = true } = {},
) {
  const sourceKeys = [
    "addedSourcePaths",
    "changedSourcePaths",
    "deletedSourcePaths",
  ]
  const repositoryKeys = [
    "addedRepositoryPaths",
    "changedRepositoryPaths",
    "deletedRepositoryPaths",
  ]
  const expectedKeys = [...sourceKeys, ...repositoryKeys].sort()
  const errors = [
    ...verifyExactPathPolicy(operationPolicy, sourceKeys, "PR-10"),
    ...verifyExactPathPolicy(operationPolicy, repositoryKeys, "PR-10"),
  ]
  if (
    JSON.stringify(Object.keys(operationPolicy).sort()) !==
    JSON.stringify(expectedKeys)
  ) {
    errors.push("invalid PR-10 operation policy keys")
  }
  if (
    (operationPolicy.deletedSourcePaths ?? []).length > 0 ||
    (operationPolicy.deletedRepositoryPaths ?? []).length > 0
  ) {
    errors.push("PR-10 source-only foundation must not delete Product paths")
  }

  const allowedPaths = new Set(pr10AllowedRepositoryPaths)
  const repositoryPathByOperation = new Map()
  const repositoryPaths = new Set()
  for (const key of repositoryKeys) {
    for (const path of operationPolicy[key] ?? []) {
      repositoryPaths.add(path)
      repositoryPathByOperation.set(path, key.replace("Repository", "Source"))
      if (!allowedPaths.has(path)) {
        errors.push(`PR-10 repository path is outside package boundary ${path}`)
      }
      if (pr10ImmutablePriorEvidencePaths.includes(path)) {
        errors.push(
          `PR-10 immutable prior evidence appears in operation policy ${path}`,
        )
      }
    }
  }
  if (requireComplete) {
    for (const key of expectedKeys) {
      if (
        JSON.stringify(operationPolicy[key] ?? []) !==
        JSON.stringify(pr10ExpectedOperationPolicy[key])
      ) {
        errors.push(`PR-10 exact operation policy changed ${key}`)
      }
    }
    for (const requiredPath of pr10RequiredFrozenRepositoryPaths) {
      if (!repositoryPaths.has(requiredPath)) {
        errors.push(`PR-10 frozen repository path is missing ${requiredPath}`)
      }
    }
  }
  for (const key of sourceKeys) {
    for (const path of operationPolicy[key] ?? []) {
      if (repositoryPathByOperation.get(path) !== key) {
        errors.push(
          `PR-10 source operation lacks matching repository operation ${key} ${path}`,
        )
      }
    }
  }
  return [...new Set(errors)].sort()
}

export function verifyPr10GeneratedDestinationBoundary(stagedPaths) {
  const stagedPathSet = new Set(stagedPaths)
  return pr10GeneratedDestinationPaths
    .filter((path) => stagedPathSet.has(path))
    .map(
      (path) =>
        `PR-10 generated destination must not be staged before generation ${path}`,
    )
}

export function verifyPr10HistoricalFixtureRepair(root = repositoryRoot) {
  const errors = []
  let baseSource
  try {
    baseSource = readRepositoryPathAtCommit(
      root,
      pr10ContractBase,
      pr10Pr06FixtureRepair.path,
    ).toString("utf8")
  } catch {
    return ["PR-10 historical PR-06 fixture base is unavailable"]
  }
  const absolutePath = resolve(root, pr10Pr06FixtureRepair.path)
  if (!isRegularFile(absolutePath)) {
    return [
      `PR-10 historical fixture repair is missing ${pr10Pr06FixtureRepair.path}`,
    ]
  }
  const currentSource = readFileSync(absolutePath, "utf8")
  if (sha256(baseSource) !== pr10Pr06FixtureRepair.baseSha256) {
    errors.push("PR-10 historical PR-06 fixture base fingerprint changed")
  }
  const occurrences =
    baseSource.split(pr10Pr06FixtureRepair.removedFragment).length - 1
  if (occurrences !== 1) {
    errors.push("PR-10 historical PR-06 expiry repair hunk is not unique")
  } else if (
    baseSource.replace(
      pr10Pr06FixtureRepair.removedFragment,
      pr10Pr06FixtureRepair.replacementFragment,
    ) !== currentSource
  ) {
    errors.push(
      "PR-10 PR-06 fixture repair differs from the exact reviewed replacement",
    )
  }
  return errors.sort()
}

export function buildExactClosureOperationPolicy(baseRoutes, currentRoutes) {
  return {
    ...buildClosurePathOperations(
      baseRoutes.sourceClosure ?? [],
      currentRoutes.sourceClosure ?? [],
      {
        addedKey: "addedSourcePaths",
        changedKey: "changedSourcePaths",
        deletedKey: "deletedSourcePaths",
      },
    ),
    ...buildClosurePathOperations(
      baseRoutes.repositoryClosure ?? [],
      currentRoutes.repositoryClosure ?? [],
      {
        addedKey: "addedRepositoryPaths",
        changedKey: "changedRepositoryPaths",
        deletedKey: "deletedRepositoryPaths",
      },
    ),
  }
}

function buildClosurePathOperations(
  base,
  current,
  { addedKey, changedKey, deletedKey },
) {
  const baseByPath = new Map(base.map((entry) => [entry.path, entry]))
  const currentByPath = new Map(current.map((entry) => [entry.path, entry]))
  const result = {
    [addedKey]: [],
    [changedKey]: [],
    [deletedKey]: [],
  }
  for (const path of [
    ...new Set([...baseByPath.keys(), ...currentByPath.keys()]),
  ]) {
    const before = baseByPath.get(path)
    const after = currentByPath.get(path)
    if (!before) {
      result[addedKey].push(path)
    } else if (!after) {
      result[deletedKey].push(path)
    } else if (JSON.stringify(before) !== JSON.stringify(after)) {
      result[changedKey].push(path)
    }
  }
  for (const paths of Object.values(result)) {
    paths.sort()
  }
  return result
}

export function verifyPr03FindingTransition(baseEntries, currentEntries) {
  const errors = []
  const baseByKey = new Map(
    baseEntries.map((entry) => [findingKey(entry), entry]),
  )
  const allowedOverrides = new Map(
    findingDispositionOverrides.map(({ ruleId, path, from, removeBy }) => [
      `${ruleId}\0${path}`,
      { from, to: removeBy },
    ]),
  )

  for (const entry of currentEntries) {
    const key = findingKey(entry)
    const baseEntry = baseByKey.get(key)
    if (!baseEntry) {
      errors.push(`new PR-03 reviewed legacy finding ${key}`)
      continue
    }
    if (entry.count > baseEntry.count) {
      errors.push(`PR-03 reviewed legacy finding count grew ${key}`)
    }
    if (entry.removeBy !== baseEntry.removeBy) {
      const override = allowedOverrides.get(key)
      if (
        !override ||
        baseEntry.removeBy !== override.from ||
        entry.removeBy !== override.to
      ) {
        errors.push(`PR-03 legacy disposition changed outside policy ${key}`)
      }
    }
  }

  const dueEntries = currentEntries.filter(
    (entry) => entry.removeBy === "PR-03",
  )
  if (dueEntries.length > 0) {
    errors.push(
      `PR-03 findings remain ${dueEntries.map(findingKey).sort().join(",")}`,
    )
  }
  const deferredBuilderHubEntries = currentEntries.filter(
    (entry) =>
      entry.ruleId === "FS105_BUILDER_HUB" && entry.removeBy === "PR-05",
  )
  for (const entry of deferredBuilderHubEntries) {
    if (!allowedOverrides.has(findingKey(entry))) {
      errors.push(`unreviewed PR-03 Builder/Hub deferral ${findingKey(entry)}`)
    }
  }
  return errors.sort()
}

export function verifyPr03CandidateContract({
  root = repositoryRoot,
  baseAllowlist,
  currentAllowlist,
  baseRoutes,
  currentRoutes,
  operationPolicy,
}) {
  const errors = [
    ...verifyPr03FindingTransition(
      baseAllowlist.entries ?? [],
      currentAllowlist.entries ?? [],
    ),
    ...verifyPr03RetainedRouteContract(baseRoutes, currentRoutes),
    ...verifyPr03ClosureChanges(
      baseRoutes.sourceClosure ?? [],
      currentRoutes.sourceClosure ?? [],
      operationPolicy,
      {
        addedKey: "addedSourcePaths",
        changedKey: "changedSourcePaths",
        deletedKey: "deletedSourcePaths",
        label: "source closure",
      },
    ),
    ...verifyPr03ClosureChanges(
      baseRoutes.repositoryClosure ?? [],
      currentRoutes.repositoryClosure ?? [],
      operationPolicy,
      {
        addedKey: "addedRepositoryPaths",
        changedKey: "changedRepositoryPaths",
        deletedKey: "deletedRepositoryPaths",
        label: "repository closure",
      },
    ),
    ...verifyPr03TargetState({
      root,
      currentAllowlist,
      currentRoutes,
    }),
  ]
  return errors.sort()
}

function verifyPr03RetainedRouteContract(base, current) {
  const expectedRoutes = (base.routes ?? []).filter(
    (route) => route.classification !== "legacy-retired",
  )
  const errors = []
  if (JSON.stringify(current.routes ?? []) !== JSON.stringify(expectedRoutes)) {
    errors.push("PR-03 retained route inventory changed")
  }
  if (
    JSON.stringify(current.fastifyRegistrars ?? []) !==
    JSON.stringify(base.fastifyRegistrars ?? [])
  ) {
    errors.push("PR-03 Fastify registrar inventory changed")
  }
  if ((current.webInferenceConsumers ?? []).length !== 0) {
    errors.push("PR-03 Web inference consumers remain")
  }
  return errors
}

function verifyPr03ClosureChanges(
  base,
  current,
  policy,
  { addedKey, changedKey, deletedKey, label },
) {
  const errors = verifyExactPathPolicy(
    policy ?? {},
    [addedKey, changedKey, deletedKey],
    "PR-03",
  )
  const baseByPath = uniqueEntriesByPath(base, `base ${label}`, errors)
  const currentByPath = uniqueEntriesByPath(current, `current ${label}`, errors)
  const actual = {
    [addedKey]: [],
    [changedKey]: [],
    [deletedKey]: [],
  }
  for (const path of [
    ...new Set([...baseByPath.keys(), ...currentByPath.keys()]),
  ]) {
    const before = baseByPath.get(path)
    const after = currentByPath.get(path)
    if (!before) {
      actual[addedKey].push(path)
    } else if (!after) {
      actual[deletedKey].push(path)
    } else if (JSON.stringify(before) !== JSON.stringify(after)) {
      actual[changedKey].push(path)
    }
  }
  for (const key of Object.keys(actual)) {
    const expectedPaths = [...(policy?.[key] ?? [])].sort()
    const actualPaths = actual[key].sort()
    if (JSON.stringify(expectedPaths) !== JSON.stringify(actualPaths)) {
      errors.push(
        `PR-03 ${key} differ expected=${expectedPaths.join(",")} actual=${actualPaths.join(",")}`,
      )
    }
  }
  return errors.sort()
}

export function verifyPr04FindingTransition(baseEntries, currentEntries) {
  const errors = []
  const baseByKey = new Map(
    baseEntries.map((entry) => [findingKey(entry), entry]),
  )
  for (const entry of currentEntries) {
    const key = findingKey(entry)
    const baseEntry = baseByKey.get(key)
    if (!baseEntry) {
      errors.push(`new PR-04 reviewed legacy finding ${key}`)
      continue
    }
    if (entry.count > baseEntry.count) {
      errors.push(`PR-04 reviewed legacy finding count grew ${key}`)
    }
    if (entry.removeBy !== baseEntry.removeBy) {
      errors.push(`PR-04 legacy disposition changed outside policy ${key}`)
    }
  }
  const dueEntries = currentEntries.filter(
    (entry) => entry.removeBy === "PR-04",
  )
  if (dueEntries.length > 0) {
    errors.push(
      `PR-04 findings remain ${dueEntries.map(findingKey).sort().join(",")}`,
    )
  }
  return errors.sort()
}

export function verifyPr04CandidateContract({
  root = repositoryRoot,
  baseAllowlist,
  currentAllowlist,
  baseRoutes,
  currentRoutes,
  operationPolicy,
}) {
  const errors = [
    ...verifyPr04FindingTransition(
      baseAllowlist.entries ?? [],
      currentAllowlist.entries ?? [],
    ),
    ...verifyPr04RetainedRouteContract(baseRoutes, currentRoutes),
    ...verifyExactClosureChanges(
      baseRoutes.sourceClosure ?? [],
      currentRoutes.sourceClosure ?? [],
      operationPolicy,
      {
        addedKey: "addedSourcePaths",
        changedKey: "changedSourcePaths",
        deletedKey: "deletedSourcePaths",
        label: "source closure",
      },
      "PR-04",
    ),
    ...verifyExactClosureChanges(
      baseRoutes.repositoryClosure ?? [],
      currentRoutes.repositoryClosure ?? [],
      operationPolicy,
      {
        addedKey: "addedRepositoryPaths",
        changedKey: "changedRepositoryPaths",
        deletedKey: "deletedRepositoryPaths",
        label: "repository closure",
      },
      "PR-04",
    ),
    ...verifyPr04TargetState({
      root,
      currentAllowlist,
      currentRoutes,
      paths: (currentRoutes.repositoryClosure ?? []).map(({ path }) => path),
    }),
  ]
  return errors.sort()
}

function verifyPr04RetainedRouteContract(base, current) {
  const errors = []
  for (const key of [
    "target",
    "routes",
    "fastifyRegistrars",
    "webInferenceConsumers",
    "fingerprints",
  ]) {
    if (
      JSON.stringify(current[key] ?? null) !== JSON.stringify(base[key] ?? null)
    ) {
      errors.push(`PR-04 retained route contract changed ${key}`)
    }
  }
  return errors
}

function verifyExactClosureChanges(
  base,
  current,
  policy,
  { addedKey, changedKey, deletedKey, label },
  workPackage,
) {
  const errors = verifyExactPathPolicy(
    policy ?? {},
    [addedKey, changedKey, deletedKey],
    workPackage,
  )
  const actual = buildClosurePathOperations(base, current, {
    addedKey,
    changedKey,
    deletedKey,
  })
  for (const key of Object.keys(actual)) {
    const expectedPaths = [...(policy?.[key] ?? [])].sort()
    const actualPaths = actual[key]
    if (JSON.stringify(expectedPaths) !== JSON.stringify(actualPaths)) {
      errors.push(
        `${workPackage} ${key} differ expected=${expectedPaths.join(",")} actual=${actualPaths.join(",")}`,
      )
    }
  }
  return errors.sort()
}

export function verifyPr03TargetState({
  root = repositoryRoot,
  currentAllowlist,
  currentRoutes,
}) {
  if (currentRoutes.reviewedRevisions?.at(-1)?.id === "PR-11") {
    return verifyReviewedPr11SuccessorTarget({
      root,
      currentAllowlist,
      currentRoutes,
      paths: listCandidatePaths(root),
    })
  }
  if (currentRoutes.reviewedRevisions?.at(-1)?.id === "PR-10C") {
    return verifyReviewedPr10cSuccessorTarget({
      root,
      currentAllowlist,
      currentRoutes,
      paths: listCandidatePaths(root),
    })
  }
  if (
    ["PR-04", "PR-05", "PR-06", "PR-07", "PR-08", "PR-09", "PR-10"].includes(
      currentRoutes.reviewedRevisions?.at(-1)?.id,
    )
  ) {
    return []
  }
  const errors = []
  const classificationCounts = new Map()
  for (const route of currentRoutes.routes ?? []) {
    classificationCounts.set(
      route.classification,
      (classificationCounts.get(route.classification) ?? 0) + 1,
    )
  }
  const expectedClassificationCounts = {
    "current-console-seam": 70,
    "legacy-retired": 0,
    "operational-auth": 4,
    "private-operational": 3,
    "required-now": 2,
  }
  for (const [classification, expected] of Object.entries(
    expectedClassificationCounts,
  )) {
    const actual = classificationCounts.get(classification) ?? 0
    if (actual !== expected) {
      errors.push(
        `PR-03 route count changed ${classification} expected=${expected} actual=${actual}`,
      )
    }
  }
  if ((currentRoutes.routes ?? []).length !== 79) {
    errors.push(
      `PR-03 total route count changed expected=79 actual=${(currentRoutes.routes ?? []).length}`,
    )
  }
  const expectedRegistrarNames = [
    "registerAdminRoutes",
    "registerAppGatewayRoutes",
    "registerPersonaAuth",
  ]
  const registrarNames = (currentRoutes.fastifyRegistrars ?? [])
    .map(({ exportName }) => exportName)
    .sort()
  if (
    JSON.stringify(registrarNames) !== JSON.stringify(expectedRegistrarNames)
  ) {
    errors.push("PR-03 retained Fastify registrars changed")
  }
  if ((currentRoutes.webInferenceConsumers ?? []).length !== 0) {
    errors.push("PR-03 Web inference consumer count is not zero")
  }
  if (
    JSON.stringify(currentRoutes.fingerprints ?? []) !==
    JSON.stringify(reviewedPr03ResolverFingerprints)
  ) {
    errors.push("PR-03 resolver fingerprints changed")
  }
  const escapeHatches = currentRoutes.escapeHatches ?? []
  if (
    escapeHatches.length !== 1 ||
    escapeHatches[0]?.path !== "apps/bff/src/auth/persona.ts" ||
    escapeHatches[0]?.removeBy !== "PR-05" ||
    !/^[0-9a-f]{64}$/.test(escapeHatches[0]?.sha256 ?? "")
  ) {
    errors.push("PR-03 escape hatch target changed")
  }
  if (
    (currentAllowlist.entries ?? []).some((entry) => entry.removeBy === "PR-03")
  ) {
    errors.push("PR-03 due findings remain")
  }
  errors.push(...verifyReviewedWebAuthenticationEvidence(root))
  errors.push(...verifyWebAuthenticationBoundary(root))
  return errors.sort()
}

export function verifyPr04TargetState({
  root = repositoryRoot,
  currentAllowlist,
  currentRoutes,
  paths = listCandidatePaths(root),
}) {
  if (currentRoutes.reviewedRevisions?.at(-1)?.id === "PR-11") {
    return verifyReviewedPr11SuccessorTarget({
      root,
      currentAllowlist,
      currentRoutes,
      paths,
    })
  }
  if (currentRoutes.reviewedRevisions?.at(-1)?.id === "PR-10C") {
    return verifyReviewedPr10cSuccessorTarget({
      root,
      currentAllowlist,
      currentRoutes,
      paths,
    })
  }
  if (
    ["PR-05", "PR-06", "PR-07", "PR-08", "PR-09", "PR-10"].includes(
      currentRoutes.reviewedRevisions?.at(-1)?.id,
    )
  ) {
    return []
  }
  const errors = []
  const classificationCounts = new Map()
  for (const route of currentRoutes.routes ?? []) {
    classificationCounts.set(
      route.classification,
      (classificationCounts.get(route.classification) ?? 0) + 1,
    )
  }
  const expectedClassificationCounts = {
    "current-console-seam": 70,
    "legacy-retired": 0,
    "operational-auth": 4,
    "private-operational": 3,
    "required-now": 2,
  }
  for (const [classification, expected] of Object.entries(
    expectedClassificationCounts,
  )) {
    const actual = classificationCounts.get(classification) ?? 0
    if (actual !== expected) {
      errors.push(
        `PR-04 route count changed ${classification} expected=${expected} actual=${actual}`,
      )
    }
  }
  if ((currentRoutes.routes ?? []).length !== 79) {
    errors.push(
      `PR-04 total route count changed expected=79 actual=${(currentRoutes.routes ?? []).length}`,
    )
  }
  const expectedRegistrarNames = [
    "registerAdminRoutes",
    "registerAppGatewayRoutes",
    "registerPersonaAuth",
  ]
  const registrarNames = (currentRoutes.fastifyRegistrars ?? [])
    .map(({ exportName }) => exportName)
    .sort()
  if (
    JSON.stringify(registrarNames) !== JSON.stringify(expectedRegistrarNames)
  ) {
    errors.push("PR-04 retained Fastify registrars changed")
  }
  if ((currentRoutes.webInferenceConsumers ?? []).length !== 0) {
    errors.push("PR-04 Web inference consumer count is not zero")
  }
  if (
    JSON.stringify(currentRoutes.fingerprints ?? []) !==
    JSON.stringify(reviewedPr03ResolverFingerprints)
  ) {
    errors.push("PR-04 resolver fingerprints changed")
  }
  const escapeHatches = currentRoutes.escapeHatches ?? []
  if (
    escapeHatches.length !== 1 ||
    escapeHatches[0]?.path !== "apps/bff/src/auth/persona.ts" ||
    escapeHatches[0]?.removeBy !== "PR-05" ||
    !/^[0-9a-f]{64}$/.test(escapeHatches[0]?.sha256 ?? "")
  ) {
    errors.push("PR-04 escape hatch target changed")
  }
  if (
    (currentAllowlist.entries ?? []).some((entry) => entry.removeBy === "PR-04")
  ) {
    errors.push("PR-04 due findings remain")
  }
  errors.push(...verifyRetiredDataDependencyBoundary(root, paths))
  errors.push(...verifyStandaloneDbTestBoundary(root, paths))
  errors.push(...verifyReviewedPr04WebAuthenticationEvidence(root))
  errors.push(...verifyWebAuthenticationBoundary(root))
  return errors.sort()
}

export function verifyPr05FindingTransition(baseEntries, currentEntries) {
  const errors = []
  const baseByKey = new Map(
    baseEntries.map((entry) => [findingKey(entry), entry]),
  )
  for (const entry of currentEntries) {
    const key = findingKey(entry)
    const baseEntry = baseByKey.get(key)
    if (!baseEntry) {
      errors.push(`new PR-05 reviewed legacy finding ${key}`)
      continue
    }
    if (entry.count > baseEntry.count) {
      errors.push(`PR-05 reviewed legacy finding count grew ${key}`)
    }
    if (entry.removeBy !== baseEntry.removeBy) {
      errors.push(`PR-05 legacy disposition changed outside policy ${key}`)
    }
  }
  const dueEntries = currentEntries.filter(
    (entry) => entry.removeBy === "PR-05",
  )
  if (dueEntries.length > 0) {
    errors.push(
      `PR-05 findings remain ${dueEntries.map(findingKey).sort().join(",")}`,
    )
  }
  const builderHubEntries = currentEntries.filter(
    (entry) => entry.ruleId === "FS105_BUILDER_HUB",
  )
  if (
    builderHubEntries.length !== 1 ||
    builderHubEntries[0]?.path !== "apps/web/src/middleware.test.ts" ||
    builderHubEntries[0]?.removeBy !== "PR-12"
  ) {
    errors.push("PR-05 Builder/Hub tombstone boundary changed")
  }
  if (currentEntries.some((entry) => entry.ruleId === "FS109_LEGACY_PERSONA")) {
    errors.push("PR-05 legacy Persona findings remain")
  }
  return errors.sort()
}

export function verifyPr05CandidateContract({
  root = repositoryRoot,
  baseAllowlist,
  currentAllowlist,
  baseRoutes,
  currentRoutes,
  operationPolicy,
}) {
  const errors = [
    ...verifyPr05FindingTransition(
      baseAllowlist.entries ?? [],
      currentAllowlist.entries ?? [],
    ),
    ...verifyPr05RetainedRouteContract(baseRoutes, currentRoutes),
    ...verifyPr05OperationBoundary(operationPolicy ?? {}),
    ...verifyExactClosureChanges(
      baseRoutes.sourceClosure ?? [],
      currentRoutes.sourceClosure ?? [],
      operationPolicy,
      {
        addedKey: "addedSourcePaths",
        changedKey: "changedSourcePaths",
        deletedKey: "deletedSourcePaths",
        label: "source closure",
      },
      "PR-05",
    ),
    ...verifyExactClosureChanges(
      baseRoutes.repositoryClosure ?? [],
      currentRoutes.repositoryClosure ?? [],
      operationPolicy,
      {
        addedKey: "addedRepositoryPaths",
        changedKey: "changedRepositoryPaths",
        deletedKey: "deletedRepositoryPaths",
        label: "repository closure",
      },
      "PR-05",
    ),
    ...verifyPr05TargetState({
      root,
      currentAllowlist,
      currentRoutes,
      paths: (currentRoutes.repositoryClosure ?? []).map(({ path }) => path),
    }),
  ]
  return errors.sort()
}

function verifyPr05RetainedRouteContract(base, current) {
  const errors = []
  for (const key of ["target", "webInferenceConsumers"]) {
    if (
      JSON.stringify(current[key] ?? null) !== JSON.stringify(base[key] ?? null)
    ) {
      errors.push(`PR-05 retained route contract changed ${key}`)
    }
  }

  const availableCurrentRoutes = new Map()
  for (const route of current.routes ?? []) {
    const serialized = JSON.stringify(route)
    availableCurrentRoutes.set(
      serialized,
      (availableCurrentRoutes.get(serialized) ?? 0) + 1,
    )
  }
  for (const route of base.routes ?? []) {
    const serialized = JSON.stringify(route)
    const count = availableCurrentRoutes.get(serialized) ?? 0
    if (count === 0) {
      errors.push(
        `PR-05 retained route disappeared ${route.method} ${route.path} ${route.source}`,
      )
      continue
    }
    availableCurrentRoutes.set(serialized, count - 1)
  }
  const addedRoutes = []
  for (const [serialized, count] of availableCurrentRoutes) {
    for (let index = 0; index < count; index += 1) {
      addedRoutes.push(JSON.parse(serialized))
    }
  }
  addedRoutes.sort((left, right) =>
    JSON.stringify(left).localeCompare(JSON.stringify(right)),
  )
  const expectedAddedRoutes = structuredClone(pr05RecoveryRouteContract).sort(
    (left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)),
  )
  if (JSON.stringify(addedRoutes) !== JSON.stringify(expectedAddedRoutes)) {
    errors.push("PR-05 recovery route inventory differs from reviewed target")
  }
  return errors.sort()
}

export function verifyPr05TargetState({
  root = repositoryRoot,
  currentAllowlist,
  currentRoutes,
  paths = listCandidatePaths(root),
}) {
  if (currentRoutes.reviewedRevisions?.at(-1)?.id === "PR-11") {
    return verifyReviewedPr11SuccessorTarget({
      root,
      currentAllowlist,
      currentRoutes,
      paths,
    })
  }
  if (currentRoutes.reviewedRevisions?.at(-1)?.id === "PR-10C") {
    return verifyReviewedPr10cSuccessorTarget({
      root,
      currentAllowlist,
      currentRoutes,
      paths,
    })
  }
  if (
    ["PR-06", "PR-07", "PR-08", "PR-09", "PR-10"].includes(
      currentRoutes.reviewedRevisions?.at(-1)?.id,
    )
  ) {
    return []
  }
  const errors = []
  if (
    (currentRoutes.routes ?? []).some(
      (route) => route.classification === "legacy-retired",
    )
  ) {
    errors.push("PR-05 legacy routes remain")
  }
  if ((currentRoutes.routes ?? []).length !== pr05TargetContract.routes) {
    errors.push(
      `PR-05 total route count changed expected=${pr05TargetContract.routes} actual=${(currentRoutes.routes ?? []).length}`,
    )
  }
  const classificationCounts = new Map()
  for (const route of currentRoutes.routes ?? []) {
    classificationCounts.set(
      route.classification,
      (classificationCounts.get(route.classification) ?? 0) + 1,
    )
  }
  for (const [classification, expected] of Object.entries(
    pr05TargetContract.routeClassifications,
  )) {
    const actual = classificationCounts.get(classification) ?? 0
    if (actual !== expected) {
      errors.push(
        `PR-05 route count changed ${classification} expected=${expected} actual=${actual}`,
      )
    }
  }
  if (
    JSON.stringify(currentRoutes.fastifyRegistrars ?? []) !==
    JSON.stringify(pr05TargetContract.fastifyRegistrars)
  ) {
    errors.push("PR-05 retained Fastify registrars changed")
  }
  if ((currentRoutes.webInferenceConsumers ?? []).length !== 0) {
    errors.push("PR-05 Web inference consumer count is not zero")
  }
  if (
    JSON.stringify(currentRoutes.fingerprints ?? []) !==
    JSON.stringify(reviewedPr05ResolverFingerprints)
  ) {
    errors.push("PR-05 resolver fingerprints changed")
  }
  if ((currentRoutes.escapeHatches ?? []).length !== 0) {
    errors.push("PR-05 mutable legacy escape hatch remains")
  }
  const recoveryRoutes = (currentRoutes.routes ?? [])
    .filter((route) => route.path.startsWith("/api/admin/recovery"))
    .sort((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right)),
    )
  const expectedRecoveryRoutes = structuredClone(
    pr05RecoveryRouteContract,
  ).sort((left, right) =>
    JSON.stringify(left).localeCompare(JSON.stringify(right)),
  )
  if (
    JSON.stringify(recoveryRoutes) !== JSON.stringify(expectedRecoveryRoutes)
  ) {
    errors.push("PR-05 recovery route target changed")
  }
  const dueEntries = (currentAllowlist.entries ?? []).filter(
    (entry) => entry.removeBy === "PR-05",
  )
  if (dueEntries.length > 0) {
    errors.push("PR-05 due findings remain")
  }
  const builderHubEntries = (currentAllowlist.entries ?? []).filter(
    (entry) => entry.ruleId === "FS105_BUILDER_HUB",
  )
  if (
    builderHubEntries.length !== 1 ||
    builderHubEntries[0]?.path !== "apps/web/src/middleware.test.ts" ||
    builderHubEntries[0]?.removeBy !== "PR-12"
  ) {
    errors.push("PR-05 Builder/Hub tombstone boundary changed")
  }
  if (
    (currentAllowlist.entries ?? []).some(
      (entry) => entry.ruleId === "FS109_LEGACY_PERSONA",
    )
  ) {
    errors.push("PR-05 legacy Persona findings remain")
  }
  errors.push(...verifyRetiredDataDependencyBoundary(root, paths))
  errors.push(
    ...verifyStandaloneDbTestBoundary(
      root,
      paths,
      pr05StandaloneDbTestBoundary,
    ),
  )
  errors.push(...verifyReviewedPr05WebAuthenticationEvidence(root))
  errors.push(...verifyWebAuthenticationBoundary(root))
  return [...new Set(errors)].sort()
}

export function verifyPr06FindingTransition(baseEntries, currentEntries) {
  const errors = []
  const baseByKey = new Map(
    baseEntries.map((entry) => [findingKey(entry), entry]),
  )
  for (const entry of currentEntries) {
    const key = findingKey(entry)
    const baseEntry = baseByKey.get(key)
    if (!baseEntry) {
      errors.push(`new PR-06 reviewed legacy finding ${key}`)
      continue
    }
    if (entry.count > baseEntry.count) {
      errors.push(`PR-06 reviewed legacy finding count grew ${key}`)
    }
    if (entry.removeBy !== baseEntry.removeBy) {
      errors.push(`PR-06 legacy disposition changed outside policy ${key}`)
    }
  }
  const dueEntries = currentEntries.filter(
    (entry) => entry.removeBy === "PR-06",
  )
  if (dueEntries.length > 0) {
    errors.push(
      `PR-06 findings remain ${dueEntries.map(findingKey).sort().join(",")}`,
    )
  }
  if (
    currentEntries.length !== 1 ||
    currentEntries[0]?.ruleId !== "FS105_BUILDER_HUB" ||
    currentEntries[0]?.path !== "apps/web/src/middleware.test.ts" ||
    currentEntries[0]?.removeBy !== "PR-12"
  ) {
    errors.push("PR-06 remaining finding boundary changed")
  }
  return errors.sort()
}

export function verifyPr06CandidateContract({
  root = repositoryRoot,
  baseAllowlist,
  currentAllowlist,
  baseRoutes,
  currentRoutes,
  operationPolicy,
}) {
  const errors = [
    ...verifyPr06FindingTransition(
      baseAllowlist.entries ?? [],
      currentAllowlist.entries ?? [],
    ),
    ...verifyPr06RetainedRouteContract(baseRoutes, currentRoutes),
    ...verifyPr06OperationBoundary(operationPolicy ?? {}),
    ...verifyExactClosureChanges(
      baseRoutes.sourceClosure ?? [],
      currentRoutes.sourceClosure ?? [],
      operationPolicy,
      {
        addedKey: "addedSourcePaths",
        changedKey: "changedSourcePaths",
        deletedKey: "deletedSourcePaths",
        label: "source closure",
      },
      "PR-06",
    ),
    ...verifyExactClosureChanges(
      baseRoutes.repositoryClosure ?? [],
      currentRoutes.repositoryClosure ?? [],
      operationPolicy,
      {
        addedKey: "addedRepositoryPaths",
        changedKey: "changedRepositoryPaths",
        deletedKey: "deletedRepositoryPaths",
        label: "repository closure",
      },
      "PR-06",
    ),
    ...verifyPr06TargetState({
      root,
      currentAllowlist,
      currentRoutes,
      paths: (currentRoutes.repositoryClosure ?? []).map(({ path }) => path),
    }),
  ]
  return errors.sort()
}

function verifyPr06RetainedRouteContract(base, current) {
  const errors = []
  for (const key of ["target", "webInferenceConsumers"]) {
    if (
      JSON.stringify(current[key] ?? null) !== JSON.stringify(base[key] ?? null)
    ) {
      errors.push(`PR-06 retained route contract changed ${key}`)
    }
  }

  const availableCurrentRoutes = new Map()
  for (const route of current.routes ?? []) {
    const serialized = JSON.stringify(route)
    availableCurrentRoutes.set(
      serialized,
      (availableCurrentRoutes.get(serialized) ?? 0) + 1,
    )
  }
  for (const route of base.routes ?? []) {
    const serialized = JSON.stringify(route)
    const count = availableCurrentRoutes.get(serialized) ?? 0
    if (count === 0) {
      errors.push(
        `PR-06 retained route disappeared ${route.method} ${route.path} ${route.source}`,
      )
      continue
    }
    availableCurrentRoutes.set(serialized, count - 1)
  }
  const addedRoutes = []
  for (const [serialized, count] of availableCurrentRoutes) {
    for (let index = 0; index < count; index += 1) {
      addedRoutes.push(JSON.parse(serialized))
    }
  }
  addedRoutes.sort((left, right) =>
    JSON.stringify(left).localeCompare(JSON.stringify(right)),
  )
  const expectedAddedRoutes = structuredClone(
    pr06AddedApplicationRouteContract,
  ).sort((left, right) =>
    JSON.stringify(left).localeCompare(JSON.stringify(right)),
  )
  if (JSON.stringify(addedRoutes) !== JSON.stringify(expectedAddedRoutes)) {
    errors.push("PR-06 added route inventory differs from reviewed target")
  }
  return errors.sort()
}

export function verifyPr06TargetState({
  root = repositoryRoot,
  currentAllowlist,
  currentRoutes,
  paths = listCandidatePaths(root),
}) {
  if (currentRoutes.reviewedRevisions?.at(-1)?.id === "PR-11") {
    return verifyReviewedPr11SuccessorTarget({
      root,
      currentAllowlist,
      currentRoutes,
      paths,
    })
  }
  if (currentRoutes.reviewedRevisions?.at(-1)?.id === "PR-10C") {
    return verifyReviewedPr10cSuccessorTarget({
      root,
      currentAllowlist,
      currentRoutes,
      paths,
    })
  }
  if (
    ["PR-07", "PR-08", "PR-09", "PR-10"].includes(
      currentRoutes.reviewedRevisions?.at(-1)?.id,
    )
  ) {
    return []
  }
  const errors = []
  if (
    (currentRoutes.routes ?? []).some(
      (route) => route.classification === "legacy-retired",
    )
  ) {
    errors.push("PR-06 legacy routes remain")
  }
  if ((currentRoutes.routes ?? []).length !== pr06TargetContract.routes) {
    errors.push(
      `PR-06 total route count changed expected=${pr06TargetContract.routes} actual=${(currentRoutes.routes ?? []).length}`,
    )
  }
  const classificationCounts = new Map()
  for (const route of currentRoutes.routes ?? []) {
    classificationCounts.set(
      route.classification,
      (classificationCounts.get(route.classification) ?? 0) + 1,
    )
  }
  for (const [classification, expected] of Object.entries(
    pr06TargetContract.routeClassifications,
  )) {
    const actual = classificationCounts.get(classification) ?? 0
    if (actual !== expected) {
      errors.push(
        `PR-06 route count changed ${classification} expected=${expected} actual=${actual}`,
      )
    }
  }
  if (
    JSON.stringify(currentRoutes.fastifyRegistrars ?? []) !==
    JSON.stringify(pr06TargetContract.fastifyRegistrars)
  ) {
    errors.push("PR-06 retained Fastify registrars changed")
  }
  if ((currentRoutes.webInferenceConsumers ?? []).length !== 0) {
    errors.push("PR-06 Web inference consumer count is not zero")
  }
  if (
    JSON.stringify(currentRoutes.fingerprints ?? []) !==
    JSON.stringify(reviewedPr06ResolverFingerprints)
  ) {
    errors.push("PR-06 resolver fingerprints changed")
  }
  if ((currentRoutes.escapeHatches ?? []).length !== 0) {
    errors.push("PR-06 mutable legacy escape hatch remains")
  }
  const applicationRoutes = (currentRoutes.routes ?? [])
    .filter((route) =>
      pr06AddedApplicationRouteContract.some(
        (expected) => JSON.stringify(expected) === JSON.stringify(route),
      ),
    )
    .sort((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right)),
    )
  const expectedApplicationRoutes = structuredClone(
    pr06AddedApplicationRouteContract,
  ).sort((left, right) =>
    JSON.stringify(left).localeCompare(JSON.stringify(right)),
  )
  if (
    JSON.stringify(applicationRoutes) !==
    JSON.stringify(expectedApplicationRoutes)
  ) {
    errors.push("PR-06 Application route target changed")
  }
  if (
    (currentAllowlist.entries ?? []).some((entry) => entry.removeBy === "PR-06")
  ) {
    errors.push("PR-06 due findings remain")
  }
  if (
    (currentAllowlist.entries ?? []).length !== 1 ||
    currentAllowlist.entries[0]?.ruleId !== "FS105_BUILDER_HUB" ||
    currentAllowlist.entries[0]?.path !== "apps/web/src/middleware.test.ts" ||
    currentAllowlist.entries[0]?.removeBy !== "PR-12"
  ) {
    errors.push("PR-06 remaining finding boundary changed")
  }
  errors.push(...verifyPr06RetiredApplicationBoundary(root))
  errors.push(...verifyRetiredDataDependencyBoundary(root, paths))
  errors.push(
    ...verifyStandaloneDbTestBoundary(
      root,
      paths,
      pr06StandaloneDbTestBoundary,
    ),
  )
  errors.push(...verifyReviewedPr05WebAuthenticationEvidence(root))
  errors.push(...verifyWebAuthenticationBoundary(root))
  return [...new Set(errors)].sort()
}

export function verifyPr06RetiredApplicationBoundary(root = repositoryRoot) {
  const errors = []
  for (const path of pr06RetiredApplicationBoundaryPaths) {
    const absolutePath = resolve(root, path)
    if (!isRegularFile(absolutePath)) {
      errors.push(`missing PR-06 Application boundary ${path}`)
      continue
    }
    const source = readFileSync(absolutePath, "utf8")
    for (const identifier of pr06RetiredApplicationIdentifiers) {
      if (source.includes(identifier)) {
        errors.push(
          `PR-06 retired Application identifier remains ${identifier} ${path}`,
        )
      }
    }
  }
  return errors.sort()
}

export function verifyPr07FindingTransition(baseEntries, currentEntries) {
  const errors = []
  const baseByKey = new Map(
    baseEntries.map((entry) => [findingKey(entry), entry]),
  )
  for (const entry of currentEntries) {
    const key = findingKey(entry)
    const baseEntry = baseByKey.get(key)
    if (!baseEntry) {
      errors.push(`new PR-07 reviewed legacy finding ${key}`)
      continue
    }
    if (entry.count > baseEntry.count) {
      errors.push(`PR-07 reviewed legacy finding count grew ${key}`)
    }
    if (entry.removeBy !== baseEntry.removeBy) {
      errors.push(`PR-07 legacy disposition changed outside policy ${key}`)
    }
  }
  const dueEntries = currentEntries.filter(
    (entry) => entry.removeBy === "PR-07",
  )
  if (dueEntries.length > 0) {
    errors.push(
      `PR-07 findings remain ${dueEntries.map(findingKey).sort().join(",")}`,
    )
  }
  if (
    currentEntries.length !== 1 ||
    currentEntries[0]?.ruleId !== "FS105_BUILDER_HUB" ||
    currentEntries[0]?.path !== "apps/web/src/middleware.test.ts" ||
    currentEntries[0]?.removeBy !== "PR-12"
  ) {
    errors.push("PR-07 remaining finding boundary changed")
  }
  return errors.sort()
}

export function verifyPr07CandidateContract({
  root = repositoryRoot,
  baseAllowlist,
  currentAllowlist,
  baseRoutes,
  currentRoutes,
  operationPolicy,
}) {
  const errors = [
    ...verifyPr07FindingTransition(
      baseAllowlist.entries ?? [],
      currentAllowlist.entries ?? [],
    ),
    ...verifyPr07RetainedRouteContract(baseRoutes, currentRoutes),
    ...verifyPr07OperationBoundary(operationPolicy ?? {}),
    ...verifyExactClosureChanges(
      baseRoutes.sourceClosure ?? [],
      currentRoutes.sourceClosure ?? [],
      operationPolicy,
      {
        addedKey: "addedSourcePaths",
        changedKey: "changedSourcePaths",
        deletedKey: "deletedSourcePaths",
        label: "source closure",
      },
      "PR-07",
    ),
    ...verifyExactClosureChanges(
      baseRoutes.repositoryClosure ?? [],
      currentRoutes.repositoryClosure ?? [],
      operationPolicy,
      {
        addedKey: "addedRepositoryPaths",
        changedKey: "changedRepositoryPaths",
        deletedKey: "deletedRepositoryPaths",
        label: "repository closure",
      },
      "PR-07",
    ),
    ...verifyPr07TargetState({
      root,
      currentAllowlist,
      currentRoutes,
      paths: (currentRoutes.repositoryClosure ?? []).map(({ path }) => path),
    }),
  ]
  return errors.sort()
}

function verifyPr07RetainedRouteContract(base, current) {
  const errors = []
  for (const key of [
    "target",
    "routes",
    "fastifyRegistrars",
    "webInferenceConsumers",
  ]) {
    if (
      JSON.stringify(current[key] ?? null) !== JSON.stringify(base[key] ?? null)
    ) {
      errors.push(`PR-07 retained route contract changed ${key}`)
    }
  }
  return errors.sort()
}

export function verifyPr07TargetState({
  root = repositoryRoot,
  currentAllowlist,
  currentRoutes,
  paths = listCandidatePaths(root),
}) {
  if (currentRoutes.reviewedRevisions?.at(-1)?.id === "PR-11") {
    return verifyReviewedPr11SuccessorTarget({
      root,
      currentAllowlist,
      currentRoutes,
      paths,
    })
  }
  if (currentRoutes.reviewedRevisions?.at(-1)?.id === "PR-10C") {
    return verifyReviewedPr10cSuccessorTarget({
      root,
      currentAllowlist,
      currentRoutes,
      paths,
    })
  }
  if (
    ["PR-08", "PR-09", "PR-10"].includes(
      currentRoutes.reviewedRevisions?.at(-1)?.id,
    )
  ) {
    return []
  }
  const errors = []
  if (
    (currentRoutes.routes ?? []).some(
      (route) => route.classification === "legacy-retired",
    )
  ) {
    errors.push("PR-07 legacy routes remain")
  }
  if ((currentRoutes.routes ?? []).length !== pr07TargetContract.routes) {
    errors.push(
      `PR-07 total route count changed expected=${pr07TargetContract.routes} actual=${(currentRoutes.routes ?? []).length}`,
    )
  }
  const classificationCounts = new Map()
  for (const route of currentRoutes.routes ?? []) {
    classificationCounts.set(
      route.classification,
      (classificationCounts.get(route.classification) ?? 0) + 1,
    )
  }
  for (const [classification, expected] of Object.entries(
    pr07TargetContract.routeClassifications,
  )) {
    const actual = classificationCounts.get(classification) ?? 0
    if (actual !== expected) {
      errors.push(
        `PR-07 route count changed ${classification} expected=${expected} actual=${actual}`,
      )
    }
  }
  if (
    JSON.stringify(currentRoutes.fastifyRegistrars ?? []) !==
    JSON.stringify(pr07TargetContract.fastifyRegistrars)
  ) {
    errors.push("PR-07 retained Fastify registrars changed")
  }
  if ((currentRoutes.webInferenceConsumers ?? []).length !== 0) {
    errors.push("PR-07 Web inference consumer count is not zero")
  }
  if (
    JSON.stringify(currentRoutes.fingerprints ?? []) !==
    JSON.stringify(reviewedPr06ResolverFingerprints)
  ) {
    errors.push("PR-07 resolver fingerprints changed")
  }
  if ((currentRoutes.escapeHatches ?? []).length !== 0) {
    errors.push("PR-07 mutable legacy escape hatch remains")
  }
  const publicInferenceRoutes = (currentRoutes.routes ?? [])
    .filter((route) => route.classification === "required-now")
    .sort((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right)),
    )
  const expectedPublicInferenceRoutes = structuredClone(
    pr07PublicInferenceRouteContract,
  ).sort((left, right) =>
    JSON.stringify(left).localeCompare(JSON.stringify(right)),
  )
  if (
    JSON.stringify(publicInferenceRoutes) !==
    JSON.stringify(expectedPublicInferenceRoutes)
  ) {
    errors.push("PR-07 must expose exactly two public inference routes")
  }
  if (
    (currentRoutes.routes ?? []).some((route) =>
      ["/v2/search", "/v2/scrape"].includes(route.path),
    )
  ) {
    errors.push("PR-07 must not introduce Firecrawl routes")
  }
  if (
    (currentAllowlist.entries ?? []).some((entry) => entry.removeBy === "PR-07")
  ) {
    errors.push("PR-07 due findings remain")
  }
  if (
    (currentAllowlist.entries ?? []).length !== 1 ||
    currentAllowlist.entries[0]?.ruleId !== "FS105_BUILDER_HUB" ||
    currentAllowlist.entries[0]?.path !== "apps/web/src/middleware.test.ts" ||
    currentAllowlist.entries[0]?.removeBy !== "PR-12"
  ) {
    errors.push("PR-07 remaining finding boundary changed")
  }
  errors.push(...verifyPr06RetiredApplicationBoundary(root))
  errors.push(...verifyPr07RetainedFirecrawlBoundary(root))
  errors.push(...verifyRetiredDataDependencyBoundary(root, paths))
  errors.push(
    ...verifyStandaloneDbTestBoundary(
      root,
      paths,
      pr07StandaloneDbTestBoundary,
    ),
  )
  errors.push(...verifyReviewedPr05WebAuthenticationEvidence(root))
  errors.push(...verifyWebAuthenticationBoundary(root))
  return [...new Set(errors)].sort()
}

export function verifyPr07RetainedFirecrawlBoundary(root = repositoryRoot) {
  const hasPr08Successor = hasExactPr08FirecrawlSourceSuccessor(root)
  const errors = []
  for (const path of pr07RetainedFirecrawlBoundaryPaths) {
    if (hasPr08Successor && pr08ExpectedMappedTargetPaths.includes(path)) {
      continue
    }
    let baseSource
    try {
      baseSource = execFileSync(
        "git",
        [
          "show",
          "--no-ext-diff",
          "--no-textconv",
          "--end-of-options",
          `${pr07ContractBase}:${path}`,
        ],
        {
          cwd: root,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        },
      )
    } catch {
      errors.push(`PR-07 Firecrawl base boundary is unavailable ${path}`)
      continue
    }
    const absolutePath = resolve(root, path)
    if (!isRegularFile(absolutePath)) {
      errors.push(`PR-07 Firecrawl boundary is missing ${path}`)
      continue
    }
    const currentSource = readFileSync(absolutePath, "utf8")
    const baseLines = baseSource
      .split("\n")
      .filter((line) => /firecrawl/i.test(line))
    const currentLines = currentSource
      .split("\n")
      .filter((line) => /firecrawl/i.test(line))
    if (JSON.stringify(currentLines) !== JSON.stringify(baseLines)) {
      errors.push(`PR-07 Firecrawl boundary changed ${path}`)
    }
  }
  return errors.sort()
}

function hasExactPr08FirecrawlSourceSuccessor(root) {
  try {
    if (
      verifyPr08DecisionDocument(readPr08DecisionDocument(root)).length > 0 ||
      verifyPr08SourceManifestDocument(readPr08SourceManifestDocument(root))
        .length > 0 ||
      verifyPr08SourceMapDocument(
        readFileSync(resolve(root, pr08SourceMapPath), "utf8"),
      ).length > 0
    ) {
      return false
    }
    return true
  } catch {
    return false
  }
}

export function verifyPr08FindingTransition(baseEntries, currentEntries) {
  const errors = []
  const baseByKey = new Map(
    baseEntries.map((entry) => [findingKey(entry), entry]),
  )
  for (const entry of currentEntries) {
    const key = findingKey(entry)
    const baseEntry = baseByKey.get(key)
    if (!baseEntry) {
      errors.push(`new PR-08 reviewed legacy finding ${key}`)
      continue
    }
    if (entry.count > baseEntry.count) {
      errors.push(`PR-08 reviewed legacy finding count grew ${key}`)
    }
    if (entry.removeBy !== baseEntry.removeBy) {
      errors.push(`PR-08 legacy disposition changed outside policy ${key}`)
    }
  }
  const dueEntries = currentEntries.filter(
    (entry) => entry.removeBy === "PR-08",
  )
  if (dueEntries.length > 0) {
    errors.push(
      `PR-08 findings remain ${dueEntries.map(findingKey).sort().join(",")}`,
    )
  }
  if (
    currentEntries.length !== 1 ||
    currentEntries[0]?.ruleId !== "FS105_BUILDER_HUB" ||
    currentEntries[0]?.path !== "apps/web/src/middleware.test.ts" ||
    currentEntries[0]?.removeBy !== "PR-12"
  ) {
    errors.push("PR-08 remaining finding boundary changed")
  }
  return errors.sort()
}

export function verifyPr08CandidateContract({
  root = repositoryRoot,
  baseAllowlist,
  currentAllowlist,
  baseRoutes,
  currentRoutes,
  operationPolicy,
}) {
  const errors = [
    ...verifyPr08FindingTransition(
      baseAllowlist.entries ?? [],
      currentAllowlist.entries ?? [],
    ),
    ...verifyPr08RetainedRouteContract(baseRoutes, currentRoutes),
    ...verifyPr08OperationBoundary(operationPolicy ?? {}),
    ...verifyExactClosureChanges(
      baseRoutes.sourceClosure ?? [],
      currentRoutes.sourceClosure ?? [],
      operationPolicy,
      {
        addedKey: "addedSourcePaths",
        changedKey: "changedSourcePaths",
        deletedKey: "deletedSourcePaths",
        label: "source closure",
      },
      "PR-08",
    ),
    ...verifyExactClosureChanges(
      baseRoutes.repositoryClosure ?? [],
      currentRoutes.repositoryClosure ?? [],
      operationPolicy,
      {
        addedKey: "addedRepositoryPaths",
        changedKey: "changedRepositoryPaths",
        deletedKey: "deletedRepositoryPaths",
        label: "repository closure",
      },
      "PR-08",
    ),
    ...verifyPr08TargetState({
      root,
      currentAllowlist,
      currentRoutes,
      paths: (currentRoutes.repositoryClosure ?? []).map(({ path }) => path),
    }),
  ]
  return errors.sort()
}

function verifyPr08RetainedRouteContract(base, current) {
  const errors = []
  if (JSON.stringify(current.target ?? null) !== JSON.stringify(base.target)) {
    errors.push("PR-08 retained route target changed")
  }
  if (
    JSON.stringify(current.webInferenceConsumers ?? []) !==
    JSON.stringify(base.webInferenceConsumers ?? [])
  ) {
    errors.push("PR-08 Web inference consumer boundary changed")
  }
  const baseCounts = routeCounts(base.routes ?? [])
  const currentCounts = routeCounts(current.routes ?? [])
  const currentByKey = new Map(
    (current.routes ?? []).map((route) => [routeKey(route), route]),
  )
  for (const [key, count] of baseCounts) {
    if (currentCounts.get(key) !== count) {
      errors.push(`PR-08 retained route changed ${key}`)
    }
    const baseRoute = (base.routes ?? []).find(
      (route) => routeKey(route) === key,
    )
    if (JSON.stringify(currentByKey.get(key)) !== JSON.stringify(baseRoute)) {
      errors.push(`PR-08 retained route reclassified ${key}`)
    }
  }
  const addedRoutes = []
  for (const route of current.routes ?? []) {
    const key = routeKey(route)
    const remaining = baseCounts.get(key) ?? 0
    if (remaining > 0) {
      baseCounts.set(key, remaining - 1)
    } else {
      addedRoutes.push(route)
    }
  }
  const expectedAddedRoutes = structuredClone([
    ...pr08FirecrawlAdminRouteContract,
    ...pr08FirecrawlRouteContract,
  ]).sort((left, right) =>
    JSON.stringify(left).localeCompare(JSON.stringify(right)),
  )
  addedRoutes.sort((left, right) =>
    JSON.stringify(left).localeCompare(JSON.stringify(right)),
  )
  if (JSON.stringify(addedRoutes) !== JSON.stringify(expectedAddedRoutes)) {
    errors.push("PR-08 added route inventory differs from reviewed target")
  }
  const baseRegistrars = new Map(
    (base.fastifyRegistrars ?? []).map((entry) => [entry.exportName, entry]),
  )
  const addedRegistrars = (current.fastifyRegistrars ?? []).filter(
    (entry) => !baseRegistrars.has(entry.exportName),
  )
  for (const entry of base.fastifyRegistrars ?? []) {
    const currentEntry = (current.fastifyRegistrars ?? []).find(
      (candidate) => candidate.exportName === entry.exportName,
    )
    if (JSON.stringify(currentEntry) !== JSON.stringify(entry)) {
      errors.push(
        `PR-08 retained Fastify registrar changed ${entry.exportName}`,
      )
    }
  }
  if (
    JSON.stringify(addedRegistrars) !==
    JSON.stringify([
      {
        exportName: "registerFirecrawlGatewayRoutes",
        importSource: "./routes/firecrawl-gateway",
        sourcePath: "apps/bff/src/routes/firecrawl-gateway.ts",
      },
    ])
  ) {
    errors.push("PR-08 Firecrawl registrar differs from reviewed target")
  }
  return errors.sort()
}

export function verifyPr08TargetState({
  root = repositoryRoot,
  currentAllowlist,
  currentRoutes,
  paths = listCandidatePaths(root),
}) {
  if (currentRoutes.reviewedRevisions?.at(-1)?.id === "PR-11") {
    return verifyReviewedPr11SuccessorTarget({
      root,
      currentAllowlist,
      currentRoutes,
      paths,
    })
  }
  if (currentRoutes.reviewedRevisions?.at(-1)?.id === "PR-10C") {
    return verifyReviewedPr10cSuccessorTarget({
      root,
      currentAllowlist,
      currentRoutes,
      paths,
    })
  }
  if (
    ["PR-09", "PR-10"].includes(currentRoutes.reviewedRevisions?.at(-1)?.id)
  ) {
    return []
  }
  const errors = []
  if (
    (currentRoutes.routes ?? []).some(
      (route) => route.classification === "legacy-retired",
    )
  ) {
    errors.push("PR-08 legacy routes remain")
  }
  if ((currentRoutes.routes ?? []).length !== pr08TargetContract.routes) {
    errors.push(
      `PR-08 total route count changed expected=${pr08TargetContract.routes} actual=${(currentRoutes.routes ?? []).length}`,
    )
  }
  const classificationCounts = Object.fromEntries(
    [...routeCountsByClassification(currentRoutes.routes ?? [])].sort(),
  )
  if (
    JSON.stringify(classificationCounts) !==
    JSON.stringify(pr08TargetContract.routeClassifications)
  ) {
    errors.push("PR-08 route classification counts changed")
  }
  if (
    JSON.stringify(currentRoutes.fastifyRegistrars ?? []) !==
    JSON.stringify(pr08TargetContract.fastifyRegistrars)
  ) {
    errors.push("PR-08 Fastify registrar target changed")
  }
  if ((currentRoutes.webInferenceConsumers ?? []).length !== 0) {
    errors.push("PR-08 Web inference consumer count is not zero")
  }
  if ((currentRoutes.escapeHatches ?? []).length !== 0) {
    errors.push("PR-08 mutable legacy escape hatch remains")
  }
  const publicInferenceRoutes = (currentRoutes.routes ?? [])
    .filter((route) => route.classification === "required-now")
    .sort((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right)),
    )
  const expectedPublicInferenceRoutes = structuredClone(
    pr07PublicInferenceRouteContract,
  ).sort((left, right) =>
    JSON.stringify(left).localeCompare(JSON.stringify(right)),
  )
  if (
    JSON.stringify(publicInferenceRoutes) !==
    JSON.stringify(expectedPublicInferenceRoutes)
  ) {
    errors.push("PR-08 changed the public inference route contract")
  }
  const publicFirecrawlRoutes = (currentRoutes.routes ?? [])
    .filter((route) => route.classification === "public-t2")
    .sort((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right)),
    )
  const expectedPublicFirecrawlRoutes = structuredClone(
    pr08FirecrawlRouteContract,
  ).sort((left, right) =>
    JSON.stringify(left).localeCompare(JSON.stringify(right)),
  )
  if (
    JSON.stringify(publicFirecrawlRoutes) !==
    JSON.stringify(expectedPublicFirecrawlRoutes)
  ) {
    errors.push("PR-08 must expose exactly two public T2 Firecrawl routes")
  }
  const firecrawlAdminRoutes = (currentRoutes.routes ?? [])
    .filter(
      (route) =>
        route.source === "apps/bff/src/routes/admin.ts" &&
        route.path.includes("/firecrawl"),
    )
    .sort((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right)),
    )
  const expectedFirecrawlAdminRoutes = structuredClone(
    pr08FirecrawlAdminRouteContract,
  ).sort((left, right) =>
    JSON.stringify(left).localeCompare(JSON.stringify(right)),
  )
  if (
    JSON.stringify(firecrawlAdminRoutes) !==
    JSON.stringify(expectedFirecrawlAdminRoutes)
  ) {
    errors.push("PR-08 Firecrawl admin route inventory changed")
  }
  if (
    (currentRoutes.routes ?? []).some(
      (route) =>
        route.path.startsWith("/v2/") &&
        !pr08FirecrawlRouteContract.some(
          (allowed) =>
            route.surface === allowed.surface &&
            route.method === allowed.method &&
            route.path === allowed.path &&
            route.source === allowed.source,
        ),
    )
  ) {
    errors.push("PR-08 native or excluded Firecrawl route is public")
  }
  const priorFingerprints = new Map(
    reviewedPr06ResolverFingerprints.map((entry) => [entry.path, entry]),
  )
  for (const entry of currentRoutes.fingerprints ?? []) {
    if (entry.path === "apps/bff/src/index.ts") {
      if (!/^[0-9a-f]{64}$/.test(entry.sha256 ?? "")) {
        errors.push("PR-08 index resolver fingerprint is invalid")
      }
      continue
    }
    if (
      JSON.stringify(entry) !==
      JSON.stringify(priorFingerprints.get(entry.path))
    ) {
      errors.push(`PR-08 retained resolver fingerprint changed ${entry.path}`)
    }
  }
  if ((currentRoutes.fingerprints ?? []).length !== priorFingerprints.size) {
    errors.push("PR-08 resolver fingerprint closure changed")
  }
  if (
    (currentAllowlist.entries ?? []).some((entry) => entry.removeBy === "PR-08")
  ) {
    errors.push("PR-08 due findings remain")
  }
  if (
    (currentAllowlist.entries ?? []).length !== 1 ||
    currentAllowlist.entries[0]?.ruleId !== "FS105_BUILDER_HUB" ||
    currentAllowlist.entries[0]?.path !== "apps/web/src/middleware.test.ts" ||
    currentAllowlist.entries[0]?.removeBy !== "PR-12"
  ) {
    errors.push("PR-08 remaining finding boundary changed")
  }
  for (const path of pr08ExpectedMappedTargetPaths) {
    if (!isRegularFile(resolve(root, path))) {
      errors.push(`PR-08 mapped target path is missing ${path}`)
    }
  }
  try {
    errors.push(
      ...verifyPr08SourceManifestDocument(readPr08SourceManifestDocument(root)),
    )
  } catch {
    errors.push(`missing PR-08 source manifest ${pr08SourceManifestPath}`)
  }
  try {
    errors.push(
      ...verifyPr08SourceMapDocument(
        readFileSync(resolve(root, pr08SourceMapPath), "utf8"),
      ),
    )
  } catch {
    errors.push(`missing PR-08 source map ${pr08SourceMapPath}`)
  }
  errors.push(...verifyPr08QueryFreeLoggingBoundary(root))
  errors.push(...verifyPr08PilotAncestry(root))
  errors.push(...verifyPr06RetiredApplicationBoundary(root))
  errors.push(...verifyRetiredDataDependencyBoundary(root, paths))
  errors.push(
    ...verifyStandaloneDbTestBoundary(
      root,
      paths,
      pr08StandaloneDbTestBoundary,
    ),
  )
  errors.push(...verifyReviewedPr05WebAuthenticationEvidence(root))
  errors.push(...verifyWebAuthenticationBoundary(root))
  return [...new Set(errors)].sort()
}

export function verifyPr09FindingTransition(baseEntries, currentEntries) {
  const errors = []
  const baseByKey = new Map(
    baseEntries.map((entry) => [findingKey(entry), entry]),
  )
  for (const entry of currentEntries) {
    const key = findingKey(entry)
    const baseEntry = baseByKey.get(key)
    if (!baseEntry) {
      errors.push(`new PR-09 reviewed legacy finding ${key}`)
      continue
    }
    if (entry.count > baseEntry.count) {
      errors.push(`PR-09 reviewed legacy finding count grew ${key}`)
    }
    if (entry.removeBy !== baseEntry.removeBy) {
      errors.push(`PR-09 legacy disposition changed outside policy ${key}`)
    }
  }
  const dueEntries = currentEntries.filter(
    (entry) => entry.removeBy === "PR-09",
  )
  if (dueEntries.length > 0) {
    errors.push(
      `PR-09 findings remain ${dueEntries.map(findingKey).sort().join(",")}`,
    )
  }
  if (
    currentEntries.length !== 1 ||
    currentEntries[0]?.ruleId !== "FS105_BUILDER_HUB" ||
    currentEntries[0]?.path !== "apps/web/src/middleware.test.ts" ||
    currentEntries[0]?.removeBy !== "PR-12"
  ) {
    errors.push("PR-09 remaining finding boundary changed")
  }
  return errors.sort()
}

export function verifyPr10cCandidateContract({
  root = repositoryRoot,
  baseAllowlist,
  currentAllowlist,
  baseRoutes,
  currentRoutes,
  operationPolicy,
}) {
  const errors = [
    ...verifyPr10cRetainedRouteContract(baseRoutes, currentRoutes),
    ...verifyPr10cOperationBoundary(operationPolicy ?? {}, {
      requireComplete: true,
    }),
    ...verifyExactClosureChanges(
      baseRoutes.sourceClosure ?? [],
      currentRoutes.sourceClosure ?? [],
      operationPolicy,
      {
        addedKey: "addedSourcePaths",
        changedKey: "changedSourcePaths",
        deletedKey: "deletedSourcePaths",
        label: "source closure",
      },
      "PR-10C",
    ),
    ...verifyExactClosureChanges(
      baseRoutes.repositoryClosure ?? [],
      currentRoutes.repositoryClosure ?? [],
      operationPolicy,
      {
        addedKey: "addedRepositoryPaths",
        changedKey: "changedRepositoryPaths",
        deletedKey: "deletedRepositoryPaths",
        label: "repository closure",
      },
      "PR-10C",
    ),
    ...verifyPr10cTargetState({
      root,
      currentAllowlist,
      currentRoutes,
      paths: (currentRoutes.repositoryClosure ?? []).map(({ path }) => path),
    }),
  ]
  if (
    JSON.stringify(baseAllowlist.entries ?? []) !==
    JSON.stringify(currentAllowlist.entries ?? [])
  ) {
    errors.push("PR-10C forbidden finding inventory changed")
  }
  return [...new Set(errors)].sort()
}

export function verifyPr10cRetainedRouteContract(base, current) {
  const errors = []
  for (const key of [
    "baseCommit",
    "target",
    "fastifyRegistrars",
    "webInferenceConsumers",
    "escapeHatches",
  ]) {
    if (JSON.stringify(current?.[key]) !== JSON.stringify(base?.[key])) {
      errors.push(`PR-10C retained route boundary changed ${key}`)
    }
  }

  const expectedFingerprints = structuredClone(base.fingerprints ?? [])
  for (const transition of pr10cRouteFingerprintTransitions) {
    const matches = expectedFingerprints.filter(
      (fingerprint) =>
        fingerprint.path === transition.path &&
        fingerprint.symbol === transition.symbol,
    )
    if (matches.length !== 1 || matches[0].sha256 !== transition.beforeSha256) {
      errors.push(
        `PR-10C route fingerprint base changed ${transition.path}#${transition.symbol}`,
      )
      continue
    }
    matches[0].sha256 = transition.afterSha256
  }
  if (
    JSON.stringify(current.fingerprints ?? []) !==
    JSON.stringify(expectedFingerprints)
  ) {
    errors.push("PR-10C route fingerprint transition changed")
  }

  const remainingBaseRoutes = new Map()
  for (const route of base.routes ?? []) {
    const serialized = JSON.stringify(route)
    remainingBaseRoutes.set(
      serialized,
      (remainingBaseRoutes.get(serialized) ?? 0) + 1,
    )
  }
  const addedRoutes = []
  for (const route of current.routes ?? []) {
    const serialized = JSON.stringify(route)
    const remaining = remainingBaseRoutes.get(serialized) ?? 0
    if (remaining > 0) {
      remainingBaseRoutes.set(serialized, remaining - 1)
    } else {
      addedRoutes.push(route)
    }
  }
  if ([...remainingBaseRoutes.values()].some((count) => count !== 0)) {
    errors.push("PR-10C retained route inventory changed")
  }
  addedRoutes.sort(compareRoutes)
  const expectedAddedRoutes = structuredClone(pr10cAddedRouteContract).sort(
    compareRoutes,
  )
  if (JSON.stringify(addedRoutes) !== JSON.stringify(expectedAddedRoutes)) {
    errors.push("PR-10C added route inventory differs from reviewed target")
  }
  return errors.sort()
}

export function verifyPr10cTargetState({
  root = repositoryRoot,
  currentAllowlist,
  currentRoutes,
  paths = listCandidatePaths(root),
}) {
  if (currentRoutes.reviewedRevisions?.at(-1)?.id === "PR-11") {
    return verifyReviewedPr11SuccessorTarget({
      root,
      currentAllowlist,
      currentRoutes,
      paths,
    })
  }
  const errors = []
  const activeRevision = currentRoutes.reviewedRevisions?.at(-1)?.id
  if (!["PR-10", "PR-10C"].includes(activeRevision)) {
    errors.push(
      `PR-10C target has invalid active predecessor ${String(activeRevision)}`,
    )
  }
  if ((currentRoutes.routes ?? []).length !== pr10cTargetContract.routes) {
    errors.push(
      `PR-10C total route count changed expected=${pr10cTargetContract.routes} actual=${(currentRoutes.routes ?? []).length}`,
    )
  }
  const classificationCounts = Object.fromEntries(
    [...routeCountsByClassification(currentRoutes.routes ?? [])].sort(),
  )
  if (
    JSON.stringify(classificationCounts) !==
    JSON.stringify(pr10cTargetContract.routeClassifications)
  ) {
    errors.push("PR-10C route classification counts changed")
  }
  if (
    JSON.stringify(currentRoutes.fastifyRegistrars ?? []) !==
    JSON.stringify(pr10cTargetContract.fastifyRegistrars)
  ) {
    errors.push("PR-10C Fastify registrar target changed")
  }
  if ((currentRoutes.webInferenceConsumers ?? []).length !== 0) {
    errors.push("PR-10C Web inference consumer count is not zero")
  }
  if ((currentRoutes.escapeHatches ?? []).length !== 0) {
    errors.push("PR-10C mutable legacy escape hatch remains")
  }
  if (
    JSON.stringify(currentRoutes.target) !== JSON.stringify(targetRouteContract)
  ) {
    errors.push("PR-10C route target contract changed")
  }
  for (const [actual, expected, label] of [
    [
      (currentRoutes.routes ?? []).filter(
        (route) => route.classification === "required-now",
      ),
      pr10cTargetContract.publicInferenceRoutes,
      "public inference",
    ],
    [
      (currentRoutes.routes ?? []).filter(
        (route) => route.classification === "public-t2",
      ),
      pr10cTargetContract.publicFirecrawlRoutes,
      "public Firecrawl",
    ],
  ]) {
    actual.sort(compareRoutes)
    const sortedExpected = structuredClone(expected).sort(compareRoutes)
    if (JSON.stringify(actual) !== JSON.stringify(sortedExpected)) {
      errors.push(`PR-10C ${label} route inventory changed`)
    }
  }
  const isolationRoutes = (currentRoutes.routes ?? [])
    .filter((route) => route.path.startsWith("/api/admin/isolation"))
    .sort(compareRoutes)
  if (
    JSON.stringify(isolationRoutes) !==
    JSON.stringify(structuredClone(pr10cAddedRouteContract).sort(compareRoutes))
  ) {
    errors.push("PR-10C isolation route inventory changed")
  }
  const currentEntries = currentAllowlist.entries ?? []
  if (
    currentEntries.length !== 1 ||
    currentEntries[0]?.ruleId !== "FS105_BUILDER_HUB" ||
    currentEntries[0]?.path !== "apps/web/src/middleware.test.ts" ||
    currentEntries[0]?.removeBy !== "PR-12"
  ) {
    errors.push("PR-10C remaining finding boundary changed")
  }
  for (const path of pr10cRequiredFrozenRepositoryPaths) {
    if (!isRegularFile(resolve(root, path))) {
      errors.push(`PR-10C frozen repository path is missing ${path}`)
    }
  }
  errors.push(...verifyPr10cBaseEvidence(root))
  errors.push(...verifyPr10cSourceBoundary(root, paths))
  return [...new Set(errors)].sort()
}

export function verifyPr10cSourceBoundary(
  root = repositoryRoot,
  paths = listCandidatePaths(root),
) {
  const errors = []
  const candidatePaths = new Set(paths)
  const read = (path) => {
    const absolutePath = resolve(root, path)
    if (!candidatePaths.has(path) || !isRegularFile(absolutePath)) {
      errors.push(`PR-10C source boundary path is missing ${path}`)
      return ""
    }
    return readFileSync(absolutePath, "utf8")
  }
  const contractSource = read(
    "packages/contracts/src/inference-core-isolation.ts",
  )
  for (const fingerprint of [
    '"ACTIVATE EMERGENCY ISOLATION"',
    '"DEACTIVATE EMERGENCY ISOLATION"',
    "runtimeQualified: z.literal(false)",
    ...pr10cIsolationFailureCodes.map((code) => `"${code}"`),
  ]) {
    if (!contractSource.includes(fingerprint)) {
      errors.push(`PR-10C isolation contract is missing ${fingerprint}`)
    }
  }

  const adminSource = read("apps/bff/src/routes/admin.ts")
  for (const fingerprint of [
    '"/api/admin/isolation"',
    'withCapability("console.operational.view")',
    'reviewedAdminOnly("POST /api/admin/isolation/activate")',
    'reviewedAdminOnly("POST /api/admin/isolation/deactivate")',
    "hasRecentKeycloakMfa",
  ]) {
    if (!adminSource.includes(fingerprint)) {
      errors.push(`PR-10C Admin isolation route is missing ${fingerprint}`)
    }
  }
  if (!/(?:300|5\s*\*\s*60)/.test(adminSource)) {
    errors.push("PR-10C mutation authentication age boundary is missing")
  }

  const recoveryContractSource = read(
    "packages/contracts/src/inference-core-recovery.ts",
  )
  for (const method of ["otp", "hwk", "webauthn", "webauthn-passwordless"]) {
    if (!recoveryContractSource.includes(`"${method}"`)) {
      errors.push(`PR-10C mutation MFA boundary is missing ${method}`)
    }
  }

  const serviceSource = read("apps/bff/src/services/emergency-isolation.ts")
  for (const fingerprint of [
    "FOR UPDATE",
    "recovery_required",
    "expectedRevision",
    "runtimeQualified: false",
    'liveIdentity.role !== "admin"',
    "recentAuthenticationWindowSeconds = 300",
    "emergencyRecoveryApprovedMfaMethods",
    "EmergencyIsolationNonRestorableAuthority",
    "LifecycleRestoreIsolationRecoveryAuthority",
    "clearRecoveryRequiredAndConfirm",
    "durableAdmissionStatus",
    "requireNoRestoreIsolationRecovery",
    "reconcileSurvivingRecoveryMarker",
    "reconcileUnfencedRestore",
    "requireTerminalLifecycleRestore",
    "verifyRecoveryAfterRestore",
  ]) {
    if (!serviceSource.includes(fingerprint)) {
      errors.push(`PR-10C isolation service is missing ${fingerprint}`)
    }
  }
  const deactivationStart = serviceSource.indexOf("  async deactivate(")
  const deactivationEnd = serviceSource.indexOf(
    "\n  async bootstrap(",
    deactivationStart,
  )
  const deactivationSource =
    deactivationStart >= 0 && deactivationEnd > deactivationStart
      ? serviceSource.slice(deactivationStart, deactivationEnd)
      : ""
  const deactivationOrderingMarkers = [
    "const prepared = await this.safePrepareDisengage(context)",
    "const completed = await this.completeWithOptionalReceipt(",
    "beforeCommit: () =>",
    "this.safeEnterDeactivationCommit(",
    'if (!completed || completed.state !== "inactive")',
    "prepared.deactivationCommitReservation.commit()",
  ]
  const deactivationOrderingIndexes = deactivationOrderingMarkers.map(
    (marker) => deactivationSource.indexOf(marker),
  )
  if (
    deactivationOrderingIndexes.some((index) => index < 0) ||
    deactivationOrderingIndexes.some(
      (index, position) =>
        position > 0 && index <= deactivationOrderingIndexes[position - 1],
    ) ||
    serviceSource.split("input.beforeCommit() !== true").length - 1 < 2
  ) {
    errors.push(
      "PR-10C deactivation must reserve sealed traffic, enter committing inside durable terminalization, and open locally only after the inactive commit resolves",
    )
  }

  const survivingMarkerStart = serviceSource.indexOf(
    "  private async reconcileSurvivingRecoveryMarker(",
  )
  const survivingMarkerEnd = serviceSource.indexOf(
    "\n  private async reconcileUnfencedRestore(",
    survivingMarkerStart,
  )
  const survivingMarkerSource =
    survivingMarkerStart >= 0 && survivingMarkerEnd > survivingMarkerStart
      ? serviceSource.slice(survivingMarkerStart, survivingMarkerEnd)
      : ""
  const markerClearOrderingMarkers = [
    "await this.readRestoreOperation(marker.operationId)",
    "await this.readUnfencedRestore()",
    "await this.requireRecoveryAfterRestore(marker.operationId)",
    ".recordIsolationReconciled(marker.operationId, this.now())",
    "await this.readUnfencedRestore()",
    "await requireTerminalLifecycleRestore(",
    "await safeClearRecoveryMarker(",
  ]
  const markerClearOrderingIndexes = []
  let markerClearSearchFrom = 0
  for (const marker of markerClearOrderingMarkers) {
    const index = survivingMarkerSource.indexOf(marker, markerClearSearchFrom)
    markerClearOrderingIndexes.push(index)
    markerClearSearchFrom = index < 0 ? markerClearSearchFrom : index + 1
  }
  if (
    markerClearOrderingIndexes.some((index) => index < 0) ||
    markerClearOrderingIndexes.some(
      (index, position) =>
        position > 0 && index <= markerClearOrderingIndexes[position - 1],
    )
  ) {
    errors.push(
      "PR-10C surviving restore marker clear must follow matching reconciliation, Console recovery readback, no-unfenced proof, and terminal lifecycle revalidation",
    )
  }

  const mutationJournalSource = read(
    "apps/bff/src/services/identity-mutation-journal.ts",
  )
  for (const fingerprint of [
    "commitWithReceipt?<T>",
    'outcome?: "denied" | "failed" | "succeeded"',
    "statusCode?: number",
  ]) {
    if (!mutationJournalSource.includes(fingerprint)) {
      errors.push(`PR-10C atomic receipt seam is missing ${fingerprint}`)
    }
  }

  const lifecycleSource = read(
    "apps/bff/src/services/lifecycle-orchestration.ts",
  )
  for (const fingerprint of [
    "emergency_isolation_fence",
    "emergency_isolation_reassertion",
    "recovery_required",
  ]) {
    if (!lifecycleSource.includes(fingerprint)) {
      errors.push(`PR-10C restore isolation seam is missing ${fingerprint}`)
    }
  }

  const lifecycleJournalSource = read(
    "apps/bff/src/services/lifecycle-operation-journal.ts",
  )
  for (const fingerprint of [
    "LifecycleRestoreIsolationRecoveryAuthority",
    "readRestoreOperation",
    "readUnfencedRestore",
    "terminalizeUnfencedRestore",
    "recordIsolationReconciled",
    "operation.state IN ('prepared', 'recovery_required')",
    "NOT EXISTS (",
    "lockedOperation(transaction, operationId)",
    'eq(lifecycleOperations.state, "prepared")',
    "LIMIT 2",
  ]) {
    if (!lifecycleJournalSource.includes(fingerprint)) {
      errors.push(
        `PR-10C lifecycle restore recovery authority is missing ${fingerprint}`,
      )
    }
  }
  const restoreStart = lifecycleSource.indexOf("  async restore(")
  const restoreEnd = lifecycleSource.indexOf(
    "\n  private allocateIdentifiers",
    restoreStart,
  )
  const restoreSource =
    restoreStart >= 0 && restoreEnd > restoreStart
      ? lifecycleSource.slice(restoreStart, restoreEnd)
      : ""
  const restoreOrderingMarkers = [
    "if (!verifyLifecycleSnapshotManifestDigest(request.manifest))",
    "admission = await this.journal.begin({",
    'if (admission === "busy")',
    "isolationFenceAcquisitionAttempted = true",
    "await this.openIsolationFenceImmediatelyAfterAdmission(",
    'this.transition(operationId, state, "validating")',
    'throw new LifecycleStepFailure("manifest_invalid")',
    "adapter.prepareRestore(capture, context)",
    "adapter.quiesce(context)",
  ]
  const restoreOrderingIndexes = restoreOrderingMarkers.map((marker) =>
    restoreSource.indexOf(marker),
  )
  const immediateFenceStart = lifecycleSource.indexOf(
    "  private async openIsolationFenceImmediatelyAfterAdmission(",
  )
  const immediateFenceEnd = lifecycleSource.indexOf(
    "\n  private async transition(",
    immediateFenceStart,
  )
  const immediateFenceSource =
    immediateFenceStart >= 0 && immediateFenceEnd > immediateFenceStart
      ? lifecycleSource.slice(immediateFenceStart, immediateFenceEnd)
      : ""
  const immediateFenceMarkers = [
    "const opening = this.openIsolationRestoreFence(context).then(",
    'phase: "emergency_isolation_fence"',
    "const result = await opening",
    "onOpened(result.fence)",
    "if (journalFailed)",
    "if (!result.succeeded)",
  ]
  const immediateFenceIndexes = immediateFenceMarkers.map((marker) =>
    immediateFenceSource.indexOf(marker),
  )
  if (
    restoreOrderingIndexes.some((index) => index < 0) ||
    restoreOrderingIndexes.some(
      (index, position) =>
        position > 0 && index <= restoreOrderingIndexes[position - 1],
    ) ||
    immediateFenceIndexes.some((index) => index < 0) ||
    immediateFenceIndexes.some(
      (index, position) =>
        position > 0 && index <= immediateFenceIndexes[position - 1],
    )
  ) {
    errors.push(
      "PR-10C restore ordering must be journal.begin created -> durable recovery_required isolation fence -> prepareRestore validation -> quiesce, with only pre-admission manifest rejection exempt",
    )
  }

  const trafficGateSource = read(
    "apps/bff/src/services/isolation-traffic-gate.ts",
  )
  for (const fingerprint of [
    "private seal()",
    "private async drain()",
    "this.active.size === 0",
    "EmergencyIsolationAbortError",
    '"chat_completions"',
    '"firecrawl_scrape"',
    '"firecrawl_search"',
    '"models"',
    "DeactivationCommitReservationState",
    "enterCommittingDeactivationReservation",
    "commitDeactivationCommitReservation",
    'phase: "committing" | "reserved"',
    "await reservation.resolved",
    "active.finalizing = true",
    "!active?.finalizing",
    "!lease.finalizing",
    "finalizing",
  ]) {
    if (!trafficGateSource.includes(fingerprint)) {
      errors.push(`PR-10C traffic gate is missing ${fingerprint}`)
    }
  }

  const schemaSource = read("apps/bff/src/db/inference-core-schema.ts")
  const migrationSource = read("infra/migrations/0000_inference_core.sql")
  if (!schemaSource.includes('"emergency_isolation_state"')) {
    errors.push("PR-10C emergency isolation schema is missing")
  }
  if (
    !/phase\} = 'emergency_isolation_reassertion'[\s\S]{0,500}'recovery_required'/.test(
      schemaSource,
    ) ||
    !/phase = 'emergency_isolation_reassertion'[\s\S]{0,500}'recovery_required'/.test(
      migrationSource,
    )
  ) {
    errors.push(
      "PR-10C lifecycle schema must admit successful isolation reassertion in recovery_required",
    )
  }
  if (
    !migrationSource.includes("CREATE TABLE admin.emergency_isolation_state") ||
    !migrationSource.includes(
      "INSERT INTO admin.emergency_isolation_state (id) VALUES ('appliance')",
    )
  ) {
    errors.push("PR-10C emergency isolation singleton migration is missing")
  }

  const indexSource = read("apps/bff/src/index.ts")
  for (const fingerprint of [
    "EmergencyIsolationService",
    "IsolationTrafficGate",
    "emergencyIsolationService",
    "isolationGate",
    "durableAdmissionStatus",
    "nonRestorableAuthority",
    "createDrizzleLifecycleRestoreIsolationRecoveryAuthority",
    "lifecycleRestoreIsolationRecoveryAuthority",
  ]) {
    if (!indexSource.includes(fingerprint)) {
      errors.push(`PR-10C index composition is missing ${fingerprint}`)
    }
  }

  for (const [path, fingerprints] of [
    [
      "apps/bff/src/routes/app-gateway.ts",
      [
        "isolationGate",
        "AbortSignal",
        "finalizeIsolationTraffic",
        "bindIsolationLeaseRelease",
        "OpenAiSseTerminalHoldback",
        "isOpenAiDoneSseFrame",
        "terminalFrame",
        "safelyWriteStreamingTerminalAndEnd",
        "closeHijackedStreamWithoutTerminal",
        "bindAppGatewayCallerAbort",
        "signal: callerAbort.signal",
      ],
    ],
    [
      "apps/bff/src/routes/firecrawl-gateway.ts",
      [
        "isolationGate",
        "AbortSignal",
        "finalizeFirecrawlIsolationTraffic",
        "bindFirecrawlIsolationLeaseRelease",
        "lease.finalize(operation)",
        'reply.raw.once("finish", release)',
        'reply.raw.once("close", release)',
      ],
    ],
    [
      "apps/bff/src/services/admin-connected-apps.ts",
      ["emergency_isolation", "FOR UPDATE"],
    ],
    [
      "apps/bff/src/services/admin-connected-apps-firecrawl.ts",
      ["emergency_isolation", "FOR UPDATE"],
    ],
  ]) {
    const source = read(path)
    for (const fingerprint of fingerprints) {
      if (!source.includes(fingerprint)) {
        errors.push(
          `PR-10C admission boundary is missing ${path} ${fingerprint}`,
        )
      }
    }
  }
  return [...new Set(errors)].sort()
}

export function verifyPr10CandidateContract({
  root = repositoryRoot,
  baseAllowlist,
  currentAllowlist,
  baseRoutes,
  currentRoutes,
  operationPolicy,
}) {
  const errors = [
    ...verifyPr10RetainedRouteContract(baseRoutes, currentRoutes),
    ...verifyPr10OperationBoundary(operationPolicy ?? {}, {
      requireComplete: true,
    }),
    ...verifyExactClosureChanges(
      baseRoutes.sourceClosure ?? [],
      currentRoutes.sourceClosure ?? [],
      operationPolicy,
      {
        addedKey: "addedSourcePaths",
        changedKey: "changedSourcePaths",
        deletedKey: "deletedSourcePaths",
        label: "source closure",
      },
      "PR-10",
    ),
    ...verifyExactClosureChanges(
      baseRoutes.repositoryClosure ?? [],
      currentRoutes.repositoryClosure ?? [],
      operationPolicy,
      {
        addedKey: "addedRepositoryPaths",
        changedKey: "changedRepositoryPaths",
        deletedKey: "deletedRepositoryPaths",
        label: "repository closure",
      },
      "PR-10",
    ),
    ...verifyPr10TargetState({
      root,
      currentAllowlist,
      currentRoutes,
      paths: (currentRoutes.repositoryClosure ?? []).map(({ path }) => path),
    }),
  ]
  if (
    JSON.stringify(baseAllowlist.entries ?? []) !==
    JSON.stringify(currentAllowlist.entries ?? [])
  ) {
    errors.push("PR-10 forbidden finding inventory changed")
  }
  return [...new Set(errors)].sort()
}

export function verifyPr10RetainedRouteContract(base, current) {
  const errors = []
  for (const key of [
    "baseCommit",
    "target",
    "routes",
    "fastifyRegistrars",
    "fingerprints",
    "webInferenceConsumers",
    "escapeHatches",
  ]) {
    if (JSON.stringify(current?.[key]) !== JSON.stringify(base?.[key])) {
      errors.push(`PR-10 retained route boundary changed ${key}`)
    }
  }
  return errors.sort()
}

export function verifyPr10TargetState({
  root = repositoryRoot,
  currentAllowlist,
  currentRoutes,
  paths = listCandidatePaths(root),
}) {
  if (currentRoutes.reviewedRevisions?.at(-1)?.id === "PR-11") {
    return verifyReviewedPr11SuccessorTarget({
      root,
      currentAllowlist,
      currentRoutes,
      paths,
    })
  }
  if (currentRoutes.reviewedRevisions?.at(-1)?.id === "PR-10C") {
    return verifyReviewedPr10cSuccessorTarget({
      root,
      currentAllowlist,
      currentRoutes,
      paths,
    })
  }
  const errors = []
  const activeRevision = currentRoutes.reviewedRevisions?.at(-1)?.id
  if (!["PR-09", "PR-10"].includes(activeRevision)) {
    errors.push(
      `PR-10 target has invalid active predecessor ${String(activeRevision)}`,
    )
  }
  if ((currentRoutes.routes ?? []).length !== pr10TargetContract.routes) {
    errors.push(
      `PR-10 total route count changed expected=${pr10TargetContract.routes} actual=${(currentRoutes.routes ?? []).length}`,
    )
  }
  const classificationCounts = Object.fromEntries(
    [...routeCountsByClassification(currentRoutes.routes ?? [])].sort(),
  )
  if (
    JSON.stringify(classificationCounts) !==
    JSON.stringify(pr10TargetContract.routeClassifications)
  ) {
    errors.push("PR-10 route classification counts changed")
  }
  if (
    JSON.stringify(currentRoutes.fastifyRegistrars ?? []) !==
    JSON.stringify(pr10TargetContract.fastifyRegistrars)
  ) {
    errors.push("PR-10 Fastify registrar target changed")
  }
  if ((currentRoutes.webInferenceConsumers ?? []).length !== 0) {
    errors.push("PR-10 Web inference consumer count is not zero")
  }
  if ((currentRoutes.escapeHatches ?? []).length !== 0) {
    errors.push("PR-10 mutable legacy escape hatch remains")
  }
  if (
    JSON.stringify(currentRoutes.target) !== JSON.stringify(targetRouteContract)
  ) {
    errors.push("PR-10 route target contract changed")
  }
  for (const [actual, expected, label] of [
    [
      (currentRoutes.routes ?? []).filter(
        (route) => route.classification === "required-now",
      ),
      pr10TargetContract.publicInferenceRoutes,
      "public inference",
    ],
    [
      (currentRoutes.routes ?? []).filter(
        (route) => route.classification === "public-t2",
      ),
      pr10TargetContract.publicFirecrawlRoutes,
      "public Firecrawl",
    ],
  ]) {
    actual.sort(compareRoutes)
    const sortedExpected = structuredClone(expected).sort(compareRoutes)
    if (JSON.stringify(actual) !== JSON.stringify(sortedExpected)) {
      errors.push(`PR-10 ${label} route inventory changed`)
    }
  }
  const currentEntries = currentAllowlist.entries ?? []
  if (
    currentEntries.length !== 1 ||
    currentEntries[0]?.ruleId !== "FS105_BUILDER_HUB" ||
    currentEntries[0]?.path !== "apps/web/src/middleware.test.ts" ||
    currentEntries[0]?.removeBy !== "PR-12"
  ) {
    errors.push("PR-10 remaining finding boundary changed")
  }
  for (const path of pr10RequiredFrozenRepositoryPaths) {
    if (!isRegularFile(resolve(root, path))) {
      errors.push(`PR-10 frozen repository path is missing ${path}`)
    }
  }
  errors.push(...verifyPr10BaseEvidence(root))
  errors.push(...verifyPr10HistoricalFixtureRepair(root))
  errors.push(...verifyPr10SourceBoundary(root, paths))
  errors.push(
    ...verifyStandaloneDbTestBoundary(
      root,
      paths,
      pr10StandaloneDbTestBoundary,
    ),
  )
  return [...new Set(errors)].sort()
}

export function verifyPr10SourceBoundary(
  root = repositoryRoot,
  paths = listCandidatePaths(root),
) {
  const errors = []
  const read = (path) => {
    const absolutePath = resolve(root, path)
    if (!isRegularFile(absolutePath)) {
      errors.push(`PR-10 source boundary path is missing ${path}`)
      return ""
    }
    return readFileSync(absolutePath, "utf8")
  }
  const lifecycleTables = [
    {
      schemaSymbol: "lifecycleOperations",
      tableName: "lifecycle_operations",
      schemaColumns: [
        "id",
        "kind",
        "state",
        "actorSubjectId",
        "correlationId",
        "snapshotId",
        "failureCode",
        "createdAt",
        "updatedAt",
        "completedAt",
      ],
      migrationColumns: [
        "id",
        "kind",
        "state",
        "actor_subject_id",
        "correlation_id",
        "snapshot_id",
        "failure_code",
        "created_at",
        "updated_at",
        "completed_at",
      ],
    },
    {
      schemaSymbol: "lifecycleOperationEvents",
      tableName: "lifecycle_operation_events",
      schemaColumns: [
        "operationId",
        "sequence",
        "operationState",
        "phase",
        "component",
        "outcome",
        "occurredAt",
        "failureCode",
      ],
      migrationColumns: [
        "operation_id",
        "sequence",
        "operation_state",
        "phase",
        "component",
        "outcome",
        "occurred_at",
        "failure_code",
      ],
    },
    {
      schemaSymbol: "lifecycleSnapshotManifests",
      tableName: "lifecycle_snapshot_manifests",
      schemaColumns: [
        "snapshotId",
        "operationId",
        "schemaVersion",
        "manifestSha256",
        "capturedAt",
        "contentFree",
        "workloadContentIncluded",
        "plaintextSecretsIncluded",
        "emergencySessionsIncluded",
        "componentCount",
      ],
      migrationColumns: [
        "snapshot_id",
        "operation_id",
        "schema_version",
        "manifest_sha256",
        "captured_at",
        "content_free",
        "workload_content_included",
        "plaintext_secrets_included",
        "emergency_sessions_included",
        "component_count",
      ],
    },
    {
      schemaSymbol: "lifecycleSnapshotComponents",
      tableName: "lifecycle_snapshot_components",
      schemaColumns: [
        "snapshotId",
        "component",
        "ordinal",
        "revision",
        "artifactSha256",
      ],
      migrationColumns: [
        "snapshot_id",
        "component",
        "ordinal",
        "revision",
        "artifact_sha256",
      ],
    },
  ]
  const schemaColumns = (source, schemaSymbol, tableName) => {
    const sourceFile = ts.createSourceFile(
      "inference-core-schema.ts",
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    )
    const declarations = []
    for (const statement of sourceFile.statements) {
      if (!ts.isVariableStatement(statement)) {
        continue
      }
      for (const declaration of statement.declarationList.declarations) {
        if (
          ts.isIdentifier(declaration.name) &&
          declaration.name.text === schemaSymbol
        ) {
          declarations.push(declaration)
        }
      }
    }
    if (declarations.length !== 1) {
      errors.push(
        `PR-10 lifecycle schema symbol is missing or ambiguous ${schemaSymbol}`,
      )
      return []
    }
    const initializer = declarations[0].initializer
    if (
      !initializer ||
      !ts.isCallExpression(initializer) ||
      !ts.isStringLiteral(initializer.arguments[0]) ||
      initializer.arguments[0].text !== tableName ||
      !ts.isObjectLiteralExpression(initializer.arguments[1])
    ) {
      errors.push(
        `PR-10 lifecycle schema table binding changed ${schemaSymbol}`,
      )
      return []
    }
    const columns = []
    for (const property of initializer.arguments[1].properties) {
      if (
        !ts.isPropertyAssignment(property) ||
        (!ts.isIdentifier(property.name) && !ts.isStringLiteral(property.name))
      ) {
        errors.push(
          `PR-10 lifecycle schema column shape changed ${schemaSymbol}`,
        )
        return []
      }
      columns.push(property.name.text)
    }
    return columns
  }
  const sqlTableColumns = (source, tableName) => {
    const marker = `CREATE TABLE admin.${tableName} (`
    const markerOccurrences = source.split(marker).length - 1
    if (markerOccurrences !== 1) {
      errors.push(
        `PR-10 lifecycle migration table occurrence changed ${tableName}`,
      )
    }
    const markerIndex = source.indexOf(marker)
    if (markerIndex < 0) {
      errors.push(`PR-10 lifecycle migration table is missing ${tableName}`)
      return { body: "", columns: [] }
    }
    const bodyStart = markerIndex + marker.length
    let depth = 1
    let quoted = false
    let bodyEnd = -1
    for (let index = bodyStart; index < source.length; index += 1) {
      const character = source[index]
      if (character === "'") {
        if (quoted && source[index + 1] === "'") {
          index += 1
        } else {
          quoted = !quoted
        }
        continue
      }
      if (quoted) {
        continue
      }
      if (character === "(") {
        depth += 1
      } else if (character === ")") {
        depth -= 1
        if (depth === 0) {
          bodyEnd = index
          break
        }
      }
    }
    if (bodyEnd < 0) {
      errors.push(
        `PR-10 lifecycle migration table is unterminated ${tableName}`,
      )
      return { body: "", columns: [] }
    }
    const body = source.slice(bodyStart, bodyEnd)
    const entries = []
    let entryStart = 0
    let nestedDepth = 0
    quoted = false
    for (let index = 0; index <= body.length; index += 1) {
      const character = body[index]
      if (character === "'") {
        if (quoted && body[index + 1] === "'") {
          index += 1
        } else {
          quoted = !quoted
        }
      } else if (!quoted && character === "(") {
        nestedDepth += 1
      } else if (!quoted && character === ")") {
        nestedDepth -= 1
      } else if (
        index === body.length ||
        (!quoted && nestedDepth === 0 && character === ",")
      ) {
        entries.push(body.slice(entryStart, index).trim())
        entryStart = index + 1
      }
    }
    const columns = []
    for (const entry of entries) {
      if (
        !entry ||
        /^(?:CONSTRAINT|PRIMARY|UNIQUE|FOREIGN|CHECK)\b/i.test(entry)
      ) {
        continue
      }
      const match =
        /^(?:"([A-Za-z_][A-Za-z0-9_]*)"|([A-Za-z_][A-Za-z0-9_]*))(?:\s|$)/.exec(
          entry,
        )
      if (!match) {
        errors.push(
          `PR-10 lifecycle migration column shape changed ${tableName}`,
        )
        return { body, columns: [] }
      }
      columns.push(match[1] ?? match[2])
    }
    return { body, columns }
  }
  const stripSqlComments = (source) => {
    let stripped = source
    let previous
    do {
      previous = stripped
      stripped = stripped.replace(/\/\*(?:(?!\/\*|\*\/)[\s\S])*?\*\//g, " ")
    } while (stripped !== previous)
    return stripped.replace(/--[^\r\n]*(?:\r?\n|$)/g, "\n")
  }

  const contractSource = read(
    "packages/contracts/src/inference-core-lifecycle.ts",
  )
  const clientSource = read("apps/bff/src/db/inference-core-client.ts")
  const adapterSource = read(
    "apps/bff/src/services/lifecycle-component-adapters.ts",
  )
  const journalSource = read(
    "apps/bff/src/services/lifecycle-operation-journal.ts",
  )
  const orchestrationSource = read(
    "apps/bff/src/services/lifecycle-orchestration.ts",
  )
  const manifestSource = read(
    "apps/bff/src/services/lifecycle-snapshot-manifest.ts",
  )
  const schemaSource = read("apps/bff/src/db/inference-core-schema.ts")
  const migrationSource = read("infra/migrations/0000_inference_core.sql")
  const packageSource = read("package.json")
  const contractIndexSource = read("packages/contracts/src/index.ts")
  const orchestrationTest = read(
    "apps/bff/src/services/lifecycle-orchestration.test.ts",
  )

  const expectedLifecycleTableNames = lifecycleTables.map(
    ({ tableName }) => tableName,
  )
  const schemaLifecycleTableNames = [
    ...schemaSource.matchAll(/\badmin\.table\(\s*"(lifecycle_[A-Za-z0-9_]*)"/g),
  ].map((match) => match[1])
  if (
    JSON.stringify(schemaLifecycleTableNames) !==
    JSON.stringify(expectedLifecycleTableNames)
  ) {
    errors.push("PR-10 lifecycle schema table inventory changed")
  }
  const migrationLifecycleTableNames = [
    ...migrationSource.matchAll(
      /\bCREATE\s+TABLE\s+admin\.(lifecycle_[A-Za-z0-9_]*)\s*\(/gi,
    ),
  ].map((match) => match[1])
  if (
    JSON.stringify(migrationLifecycleTableNames) !==
    JSON.stringify(expectedLifecycleTableNames)
  ) {
    errors.push("PR-10 lifecycle migration table inventory changed")
  }
  if (/\bALTER\s+TABLE\s+admin\.lifecycle_/i.test(migrationSource)) {
    errors.push("PR-10 lifecycle migration alteration is forbidden")
  }

  const lifecyclePersistenceSections = []
  for (const table of lifecycleTables) {
    const actualSchemaColumns = schemaColumns(
      schemaSource,
      table.schemaSymbol,
      table.tableName,
    )
    if (
      JSON.stringify(actualSchemaColumns) !==
      JSON.stringify(table.schemaColumns)
    ) {
      errors.push(`PR-10 lifecycle schema columns changed ${table.tableName}`)
    }
    const migrationTable = sqlTableColumns(migrationSource, table.tableName)
    lifecyclePersistenceSections.push(migrationTable.body)
    if (
      JSON.stringify(migrationTable.columns) !==
      JSON.stringify(table.migrationColumns)
    ) {
      errors.push(
        `PR-10 lifecycle migration columns changed ${table.tableName}`,
      )
    }
  }

  for (const component of pr10LifecycleComponents) {
    for (const [label, source] of [
      ["contract", contractSource],
      ["schema", schemaSource],
      ["migration", migrationSource],
      ["adapter", adapterSource],
    ]) {
      if (!source.includes(component)) {
        errors.push(`PR-10 ${label} component boundary is missing ${component}`)
      }
    }
  }
  for (const fingerprint of [
    "contentFree: z.literal(true)",
    "workloadContentIncluded: z.literal(false)",
    "plaintextSecretsIncluded: z.literal(false)",
    "emergencySessionsIncluded: z.literal(false)",
    "lifecycleSnapshotComponentsSchema = z.tuple",
  ]) {
    if (!contractSource.includes(fingerprint)) {
      errors.push(`PR-10 lifecycle contract is missing ${fingerprint}`)
    }
  }
  for (const table of [
    "lifecycle_operations",
    "lifecycle_operation_events",
    "lifecycle_snapshot_manifests",
    "lifecycle_snapshot_components",
  ]) {
    if (
      !schemaSource.includes(`\"${table}\"`) ||
      !migrationSource.includes(table)
    ) {
      errors.push(`PR-10 lifecycle persistence is missing ${table}`)
    }
  }
  for (const fingerprint of [
    "contentFree: true",
    "workloadContentIncluded: false",
    "plaintextSecretsIncluded: false",
    "emergencySessionsIncluded: false",
    "timingSafeEqual",
    "JSON.stringify(canonical)",
  ]) {
    if (!manifestSource.includes(fingerprint)) {
      errors.push(
        `PR-10 deterministic manifest boundary is missing ${fingerprint}`,
      )
    }
  }
  for (const fingerprint of [
    "activeStateMutated: false",
    'rollbackCapability: "established"',
    "drivers: LifecycleComponentDriverMap",
    "deployment configuration stay outside this source boundary",
  ]) {
    if (!adapterSource.includes(fingerprint)) {
      errors.push(`PR-10 deferred adapter boundary is missing ${fingerprint}`)
    }
  }
  for (const fingerprint of [
    "Live cross-service atomicity",
    "is deliberately not claimed",
    "prepareRestore(capture, context)",
    "openEmergencySessionActivationFence(context)",
    "resetEmergencySessions(context)",
    "verifyCredentialConsistency",
    "rollbackRestore(preparation, context)",
    "for (const adapter of [...this.adapters].reverse())",
    "const resumedSet = new Set(resumed)",
    "() => adapter.resume(context)",
    "onAttempted?.()",
    "Compensation was not durably admitted",
    "The reopened fence stays held until explicit recovery clears the gap.",
  ]) {
    if (!orchestrationSource.includes(fingerprint)) {
      errors.push(`PR-10 orchestration boundary is missing ${fingerprint}`)
    }
  }
  for (const fingerprint of [
    "recovery_required",
    "FOR UPDATE",
    "onConflictDoNothing",
    "nextEventSequence",
    "verifyLifecycleSnapshotManifestDigest",
  ]) {
    if (!journalSource.includes(fingerprint)) {
      errors.push(`PR-10 operation journal boundary is missing ${fingerprint}`)
    }
  }
  for (const fingerprint of [
    "prepare_restore:${component}",
    "reset_emergency_sessions",
    "rollback_restore:litellm",
    "credentials:inconsistent",
    'status: "recovery_required"',
    "discards earlier staged preparations in reverse when a later preparation fails",
    "re-quiesces resumed components before compensating a failed success journal transition",
    "keeps quiescence and the activation fence when rollback admission fails",
  ]) {
    if (!orchestrationTest.includes(fingerprint)) {
      errors.push(`PR-10 orchestration evidence is missing ${fingerprint}`)
    }
  }

  const schemaLifecycleStart = schemaSource.indexOf(
    "export const lifecycleOperations",
  )
  if (schemaLifecycleStart < 0) {
    errors.push("PR-10 lifecycle schema section marker is missing")
  }
  const migrationLifecycleStart = migrationSource.indexOf(
    "CREATE TABLE admin.lifecycle_operations",
  )
  const migrationLifecycleEnd = migrationSource.indexOf(
    "INSERT INTO admin.console_settings",
    migrationLifecycleStart,
  )
  if (
    migrationLifecycleStart < 0 ||
    migrationLifecycleEnd <= migrationLifecycleStart
  ) {
    errors.push("PR-10 lifecycle migration section markers changed")
  } else {
    const migrationLifecycleSection = migrationSource.slice(
      migrationLifecycleStart,
      migrationLifecycleEnd,
    )
    if (
      (migrationLifecycleSection.match(/\bCREATE\s+TABLE\b/gi) ?? []).length !==
      lifecycleTables.length
    ) {
      errors.push("PR-10 lifecycle migration statement inventory changed")
    }
    if (
      /\bALTER\s+TABLE\b/i.test(stripSqlComments(migrationLifecycleSection))
    ) {
      errors.push("PR-10 lifecycle migration alteration is forbidden")
    }
  }
  if (schemaLifecycleStart >= 0) {
    const schemaFile = ts.createSourceFile(
      "inference-core-schema.ts",
      schemaSource,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    )
    const appendedStatements = schemaFile.statements.filter(
      (statement) => statement.getStart(schemaFile) >= schemaLifecycleStart,
    )
    const appendedSymbols = appendedStatements.flatMap((statement) =>
      ts.isVariableStatement(statement)
        ? statement.declarationList.declarations
            .map((declaration) =>
              ts.isIdentifier(declaration.name) ? declaration.name.text : null,
            )
            .filter(Boolean)
        : [],
    )
    if (
      appendedStatements.length !== lifecycleTables.length ||
      JSON.stringify(appendedSymbols) !==
        JSON.stringify(lifecycleTables.map(({ schemaSymbol }) => schemaSymbol))
    ) {
      errors.push("PR-10 lifecycle schema statement inventory changed")
    }
  }
  try {
    const baseSchemaSource = readRepositoryPathAtCommit(
      root,
      pr10ContractBase,
      "apps/bff/src/db/inference-core-schema.ts",
    ).toString("utf8")
    if (
      schemaLifecycleStart >= 0 &&
      schemaSource.slice(0, schemaLifecycleStart) !== `${baseSchemaSource}\n`
    ) {
      errors.push(
        "PR-10 predecessor schema bytes changed outside the lifecycle append",
      )
    }

    const baseMigrationSource = readRepositoryPathAtCommit(
      root,
      pr10ContractBase,
      "infra/migrations/0000_inference_core.sql",
    ).toString("utf8")
    if (
      migrationLifecycleStart >= 0 &&
      migrationLifecycleEnd > migrationLifecycleStart &&
      `${migrationSource.slice(0, migrationLifecycleStart)}${migrationSource.slice(
        migrationLifecycleEnd,
      )}` !== baseMigrationSource
    ) {
      errors.push(
        "PR-10 predecessor migration bytes changed outside the lifecycle append",
      )
    }
  } catch {
    errors.push("PR-10 predecessor persistence base is unavailable")
  }
  const lifecyclePersistence = `${
    schemaLifecycleStart < 0 ? "" : schemaSource.slice(schemaLifecycleStart)
  }\n${
    migrationLifecycleStart < 0 ||
    migrationLifecycleEnd <= migrationLifecycleStart
      ? lifecyclePersistenceSections.join("\n")
      : migrationSource.slice(migrationLifecycleStart, migrationLifecycleEnd)
  }`
  if (
    /(?:prompt|completion|request[_-]?body|response[_-]?body|request[_-]?headers?|response[_-]?headers?|tool[_-]?arguments?|tool[_-]?results?|search[_-]?terms?|\burls?\b|page[_-]?content|artifact[_-]?bytes|raw[_-]?errors?|stack[_-]?traces?|endpoint|hostname|destination)/i.test(
      lifecyclePersistence,
    )
  ) {
    errors.push("PR-10 lifecycle persistence contains forbidden content fields")
  }

  const productionSources = new Map([
    ["apps/bff/src/db/inference-core-client.ts", clientSource],
    ["apps/bff/src/db/inference-core-schema.ts", schemaSource],
    ["apps/bff/src/services/lifecycle-component-adapters.ts", adapterSource],
    ["apps/bff/src/services/lifecycle-operation-journal.ts", journalSource],
    ["apps/bff/src/services/lifecycle-orchestration.ts", orchestrationSource],
    ["apps/bff/src/services/lifecycle-snapshot-manifest.ts", manifestSource],
    ["package.json", packageSource],
    ["packages/contracts/src/index.ts", contractIndexSource],
    ["packages/contracts/src/inference-core-lifecycle.ts", contractSource],
  ])
  if (
    JSON.stringify([...productionSources.keys()].sort()) !==
    JSON.stringify(pr10ProductionSourcePaths)
  ) {
    errors.push("PR-10 production source inventory changed")
  }

  const forbiddenRuntimeBinding =
    /process\s*(?:\.\s*env|\[\s*["']env["']\s*\])|Bun\s*\.\s*env|Deno\s*\.\s*env|https?:\/\/|\bfetch\s*\(|\baxios\b|\bundici\b|\bFunction\s*\(|\beval\s*\(|\bimport\s*\(|\brequire\s*\(|node:(?:child_process|net|tls|http|https|fs)(?:\/|["'])|from\s+["'](?:child_process|net|tls|http|https|fs)(?:\/[^"']*)?["']/i
  const runtimeBindingLines = (source) =>
    source
      .replaceAll("\r\n", "\n")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => forbiddenRuntimeBinding.test(line))
      .sort()
  const runtimeGlobalIdentifiers = new Set([
    "Bun",
    "Deno",
    "EventSource",
    "Function",
    "WebSocket",
    "XMLHttpRequest",
    "axios",
    "eval",
    "fetch",
    "globalThis",
    "process",
    "require",
    "undici",
  ])
  const runtimeModulePattern =
    /^(?:node:)?(?:child_process|net|tls|http|https|fs)(?:\/|$)/
  const astRuntimeBindings = (path, source) => {
    if (!path.endsWith(".ts")) {
      return []
    }
    const sourceFile = ts.createSourceFile(
      path,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    )
    const findings = []
    const visit = (node) => {
      if (ts.isIdentifier(node) && runtimeGlobalIdentifiers.has(node.text)) {
        findings.push(`identifier:${node.text}`)
      } else if (
        (ts.isStringLiteral(node) ||
          ts.isNoSubstitutionTemplateLiteral(node)) &&
        (/^https?:\/\//i.test(node.text) ||
          runtimeModulePattern.test(node.text))
      ) {
        findings.push(`string:${node.text}`)
      } else if (node.kind === ts.SyntaxKind.ImportKeyword) {
        findings.push("dynamic-import")
      }
      ts.forEachChild(node, visit)
    }
    visit(sourceFile)
    return findings.sort()
  }
  const importSignatures = (path, source) => {
    const sourceFile = ts.createSourceFile(
      path,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    )
    return sourceFile.statements
      .filter(
        (statement) =>
          ts.isImportDeclaration(statement) &&
          ts.isStringLiteral(statement.moduleSpecifier),
      )
      .map((statement) => {
        const clause = statement.importClause
        const namedBindings = clause?.namedBindings
        return {
          source: statement.moduleSpecifier.text,
          typeOnly: clause?.isTypeOnly ?? false,
          default: clause?.name?.text ?? null,
          namespace:
            namedBindings && ts.isNamespaceImport(namedBindings)
              ? namedBindings.name.text
              : null,
          named:
            namedBindings && ts.isNamedImports(namedBindings)
              ? namedBindings.elements.map((specifier) => ({
                  imported: specifier.propertyName?.text ?? specifier.name.text,
                  local: specifier.name.text,
                  typeOnly: specifier.isTypeOnly,
                }))
              : [],
        }
      })
  }
  const expectedAddedImportDigests = new Map([
    [
      "apps/bff/src/services/lifecycle-component-adapters.ts",
      "93e9dbfcd48be175d38760561ea3e2b23a805d55b22d4f629252c607ef68bde7",
    ],
    [
      "apps/bff/src/services/lifecycle-operation-journal.ts",
      "e8688bbb9fbafd79a67940eb887e43720cceddf9228e4503a0cf304eae42a876",
    ],
    [
      "apps/bff/src/services/lifecycle-orchestration.ts",
      "14c0ba5ea3448399d48aef2cbd63e8937f0f01c6d83331e28989dffd12ecfd0f",
    ],
    [
      "apps/bff/src/services/lifecycle-snapshot-manifest.ts",
      "739aca8b9ea8aed3855a12dbc3f388022ce610d9edf5ae986fc23bc24c5df1e4",
    ],
    [
      "packages/contracts/src/inference-core-lifecycle.ts",
      "5ca59deca81e0ad823647126c727a8f4fbb3607fd213e0fbe783dd1ea5e52152",
    ],
  ])
  const changedProductionPaths = new Set(
    pr10ExpectedOperationPolicy.changedSourcePaths,
  )
  const baseProductionSources = new Map()
  for (const [path, source] of productionSources) {
    let baseSource = ""
    if (changedProductionPaths.has(path)) {
      try {
        baseSource = readRepositoryPathAtCommit(
          root,
          pr10ContractBase,
          path,
        ).toString("utf8")
      } catch {
        errors.push(`PR-10 runtime binding base is unavailable ${path}`)
        continue
      }
      baseProductionSources.set(path, baseSource)
    }
    if (
      JSON.stringify({
        ast: astRuntimeBindings(path, source),
        lines: runtimeBindingLines(source),
      }) !==
      JSON.stringify({
        ast: astRuntimeBindings(path, baseSource),
        lines: runtimeBindingLines(baseSource),
      })
    ) {
      errors.push(
        `PR-10 lifecycle foundation contains a concrete runtime binding change ${path}`,
      )
    }
  }

  for (const [path, source] of productionSources) {
    if (!path.endsWith(".ts")) {
      continue
    }
    const actualImportDigest = sha256(
      JSON.stringify(importSignatures(path, source)),
    )
    const expectedImportDigest = changedProductionPaths.has(path)
      ? sha256(
          JSON.stringify(
            importSignatures(path, baseProductionSources.get(path) ?? ""),
          ),
        )
      : expectedAddedImportDigests.get(path)
    if (!expectedImportDigest || actualImportDigest !== expectedImportDigest) {
      errors.push(`PR-10 lifecycle import binding boundary changed ${path}`)
    }
  }

  const productionCallSites = paths.filter(
    (path) =>
      path.startsWith("apps/bff/src/") &&
      path.endsWith(".ts") &&
      !path.endsWith(".test.ts") &&
      path !== "apps/bff/src/services/lifecycle-component-adapters.ts",
  )
  for (const path of productionCallSites) {
    const source = read(path)
    const sourceFile = ts.createSourceFile(
      path,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    )
    const valueAdapterImport = sourceFile.statements.some(
      (statement) =>
        ts.isImportDeclaration(statement) &&
        ts.isStringLiteral(statement.moduleSpecifier) &&
        statement.moduleSpecifier.text.endsWith(
          "/lifecycle-component-adapters",
        ) &&
        statement.importClause?.isTypeOnly !== true,
    )
    if (valueAdapterImport) {
      errors.push(`PR-10 runtime adapter value import is forbidden ${path}`)
    }
    if (/\bcreateLifecycleComponentAdapters\s*\(/.test(source)) {
      errors.push(`PR-10 runtime adapter configured outside tests ${path}`)
    }
  }
  const routeLifecyclePaths = (paths ?? []).filter(
    (path) =>
      /(?:^|\/)routes\//.test(path) &&
      /lifecycle|snapshot|restore/.test(path) &&
      !path.endsWith(".test.ts"),
  )
  if (routeLifecyclePaths.length > 0) {
    errors.push(
      `PR-10 lifecycle route path is forbidden ${routeLifecyclePaths.join(",")}`,
    )
  }

  errors.push(...verifyPr09SourceBoundary(root))
  return [...new Set(errors)].sort()
}

export function verifyPr09CandidateContract({
  root = repositoryRoot,
  baseAllowlist,
  currentAllowlist,
  baseRoutes,
  currentRoutes,
  operationPolicy,
}) {
  const errors = [
    ...verifyPr09FindingTransition(
      baseAllowlist.entries ?? [],
      currentAllowlist.entries ?? [],
    ),
    ...verifyPr09RetainedRouteContract(baseRoutes, currentRoutes),
    ...verifyPr09OperationBoundary(operationPolicy ?? {}),
    ...verifyExactClosureChanges(
      baseRoutes.sourceClosure ?? [],
      currentRoutes.sourceClosure ?? [],
      operationPolicy,
      {
        addedKey: "addedSourcePaths",
        changedKey: "changedSourcePaths",
        deletedKey: "deletedSourcePaths",
        label: "source closure",
      },
      "PR-09",
    ),
    ...verifyExactClosureChanges(
      baseRoutes.repositoryClosure ?? [],
      currentRoutes.repositoryClosure ?? [],
      operationPolicy,
      {
        addedKey: "addedRepositoryPaths",
        changedKey: "changedRepositoryPaths",
        deletedKey: "deletedRepositoryPaths",
        label: "repository closure",
      },
      "PR-09",
    ),
    ...verifyPr09TargetState({
      root,
      currentAllowlist,
      currentRoutes,
      paths: (currentRoutes.repositoryClosure ?? []).map(({ path }) => path),
    }),
  ]
  return errors.sort()
}

export function verifyPr09RetainedRouteContract(base, current) {
  const errors = []
  const expectedTarget = structuredClone(current.target ?? null)
  if (expectedTarget) {
    expectedTarget.activityAuditPath = null
    expectedTarget.requiredPrivateOperational = (
      expectedTarget.requiredPrivateOperational ?? []
    ).filter(
      ({ method, path }) =>
        method !== "GET" || path !== "/internal/observability/metrics",
    )
  }
  if (JSON.stringify(expectedTarget) !== JSON.stringify(base.target ?? null)) {
    errors.push("PR-09 route target changed outside reviewed deltas")
  }
  if (JSON.stringify(current.target) !== JSON.stringify(targetRouteContract)) {
    errors.push("PR-09 route target differs from reviewed target")
  }
  if (
    JSON.stringify(current.webInferenceConsumers ?? []) !==
    JSON.stringify(base.webInferenceConsumers ?? [])
  ) {
    errors.push("PR-09 Web inference consumer boundary changed")
  }

  const baseCounts = routeCounts(base.routes ?? [])
  const currentCounts = routeCounts(current.routes ?? [])
  const currentByKey = new Map(
    (current.routes ?? []).map((route) => [routeKey(route), route]),
  )
  for (const [key, count] of baseCounts) {
    if (currentCounts.get(key) !== count) {
      errors.push(`PR-09 retained route changed ${key}`)
    }
    const baseRoute = (base.routes ?? []).find(
      (route) => routeKey(route) === key,
    )
    if (JSON.stringify(currentByKey.get(key)) !== JSON.stringify(baseRoute)) {
      errors.push(`PR-09 retained route reclassified ${key}`)
    }
  }
  const addedRoutes = []
  for (const route of current.routes ?? []) {
    const key = routeKey(route)
    const remaining = baseCounts.get(key) ?? 0
    if (remaining > 0) {
      baseCounts.set(key, remaining - 1)
    } else {
      addedRoutes.push(route)
    }
  }
  addedRoutes.sort(compareRoutes)
  if (JSON.stringify(addedRoutes) !== JSON.stringify(pr09AddedRouteContract)) {
    errors.push("PR-09 added route inventory differs from reviewed target")
  }

  const baseRegistrars = new Map(
    (base.fastifyRegistrars ?? []).map((entry) => [entry.exportName, entry]),
  )
  for (const entry of base.fastifyRegistrars ?? []) {
    const currentEntry = (current.fastifyRegistrars ?? []).find(
      (candidate) => candidate.exportName === entry.exportName,
    )
    if (JSON.stringify(currentEntry) !== JSON.stringify(entry)) {
      errors.push(
        `PR-09 retained Fastify registrar changed ${entry.exportName}`,
      )
    }
  }
  const addedRegistrars = (current.fastifyRegistrars ?? []).filter(
    (entry) => !baseRegistrars.has(entry.exportName),
  )
  if (
    JSON.stringify(addedRegistrars) !==
    JSON.stringify([
      {
        exportName: "registerObservabilityMetricsRoutes",
        importSource: "./routes/observability-metrics",
        sourcePath: "apps/bff/src/routes/observability-metrics.ts",
      },
    ])
  ) {
    errors.push("PR-09 observability registrar differs from reviewed target")
  }
  return errors.sort()
}

export function verifyPr09TargetState({
  root = repositoryRoot,
  currentAllowlist,
  currentRoutes,
  paths,
}) {
  const activeRevision = currentRoutes.reviewedRevisions?.at(-1)?.id
  if (activeRevision === "PR-11") {
    return verifyReviewedPr11SuccessorTarget({
      root,
      currentAllowlist,
      currentRoutes,
      paths: paths ?? listCandidatePaths(root),
    })
  }
  if (activeRevision === "PR-10C") {
    return verifyReviewedPr10cSuccessorTarget({
      root,
      currentAllowlist,
      currentRoutes,
      paths: paths ?? listCandidatePaths(root),
    })
  }
  if (activeRevision === "PR-10") {
    return []
  }
  paths ??= listCandidatePaths(root)
  const errors = []
  if (
    (currentRoutes.routes ?? []).some(
      (route) => route.classification === "legacy-retired",
    )
  ) {
    errors.push("PR-09 legacy routes remain")
  }
  if ((currentRoutes.routes ?? []).length !== pr09TargetContract.routes) {
    errors.push(
      `PR-09 total route count changed expected=${pr09TargetContract.routes} actual=${(currentRoutes.routes ?? []).length}`,
    )
  }
  const classificationCounts = Object.fromEntries(
    [...routeCountsByClassification(currentRoutes.routes ?? [])].sort(),
  )
  if (
    JSON.stringify(classificationCounts) !==
    JSON.stringify(pr09TargetContract.routeClassifications)
  ) {
    errors.push("PR-09 route classification counts changed")
  }
  if (
    JSON.stringify(currentRoutes.fastifyRegistrars ?? []) !==
    JSON.stringify(pr09TargetContract.fastifyRegistrars)
  ) {
    errors.push("PR-09 Fastify registrar target changed")
  }
  if ((currentRoutes.webInferenceConsumers ?? []).length !== 0) {
    errors.push("PR-09 Web inference consumer count is not zero")
  }
  if (
    JSON.stringify(currentRoutes.fingerprints ?? []) !==
    JSON.stringify(reviewedPr09ResolverFingerprints)
  ) {
    errors.push("PR-09 resolver fingerprints changed")
  }
  if ((currentRoutes.escapeHatches ?? []).length !== 0) {
    errors.push("PR-09 mutable legacy escape hatch remains")
  }
  if (
    JSON.stringify(currentRoutes.target) !== JSON.stringify(targetRouteContract)
  ) {
    errors.push("PR-09 route target contract changed")
  }

  const exactSubsets = [
    [
      (currentRoutes.routes ?? []).filter(
        (route) => route.classification === "required-now",
      ),
      pr07PublicInferenceRouteContract,
      "public inference",
    ],
    [
      (currentRoutes.routes ?? []).filter(
        (route) => route.classification === "public-t2",
      ),
      pr08FirecrawlRouteContract,
      "public Firecrawl",
    ],
    [
      (currentRoutes.routes ?? []).filter((route) =>
        pr09AddedRouteContract.some(
          (expected) => routeKey(route) === routeKey(expected),
        ),
      ),
      pr09AddedRouteContract,
      "PR-09 added",
    ],
  ]
  for (const [actual, expected, label] of exactSubsets) {
    actual.sort(compareRoutes)
    const sortedExpected = structuredClone(expected).sort(compareRoutes)
    if (JSON.stringify(actual) !== JSON.stringify(sortedExpected)) {
      errors.push(`PR-09 ${label} route inventory changed`)
    }
  }
  if (
    (currentAllowlist.entries ?? []).some((entry) => entry.removeBy === "PR-09")
  ) {
    errors.push("PR-09 due findings remain")
  }
  if (
    (currentAllowlist.entries ?? []).length !== 1 ||
    currentAllowlist.entries[0]?.ruleId !== "FS105_BUILDER_HUB" ||
    currentAllowlist.entries[0]?.path !== "apps/web/src/middleware.test.ts" ||
    currentAllowlist.entries[0]?.removeBy !== "PR-12"
  ) {
    errors.push("PR-09 remaining finding boundary changed")
  }
  for (const path of new Set(pr09RequiredFrozenRepositoryPaths)) {
    if (!isRegularFile(resolve(root, path))) {
      errors.push(`PR-09 frozen repository path is missing ${path}`)
    }
  }
  errors.push(...verifyPr09BaseEvidence(root))
  errors.push(...verifyPr09SourceBoundary(root))
  errors.push(...verifyPr08QueryFreeLoggingBoundary(root))
  errors.push(...verifyPr06RetiredApplicationBoundary(root))
  errors.push(...verifyRetiredDataDependencyBoundary(root, paths))
  errors.push(
    ...verifyStandaloneDbTestBoundary(
      root,
      paths,
      pr09StandaloneDbTestBoundary,
    ),
  )
  errors.push(...verifyReviewedPr09WebAuthenticationEvidence(root))
  errors.push(...verifyWebAuthenticationBoundary(root))
  return [...new Set(errors)].sort()
}

export function verifyPr09SourceBoundary(root = repositoryRoot) {
  const errors = []
  const read = (path) => {
    const source = readPr09SourceBoundaryText(path, root)
    if (source === null) {
      errors.push(`PR-09 source boundary path is missing ${path}`)
      return ""
    }
    return source
  }
  const section = (source, start, end, label) => {
    const startIndex = source.indexOf(start)
    const endIndex = source.indexOf(end, startIndex + start.length)
    if (startIndex < 0 || endIndex < 0) {
      errors.push(`PR-09 source boundary section is missing ${label}`)
      return ""
    }
    return source.slice(startIndex, endIndex)
  }

  errors.push(...verifyReviewedPr09SourceFingerprints(root))
  errors.push(...verifyReviewedPr09NativeIdentifierEvidence(root))

  const expertSource = read("apps/bff/src/services/expert-capabilities.ts")
  for (const fingerprint of [
    'auditIngestion: "implemented_pending_runtime_qualification"',
    'consoleProjection: "read_only"',
    'directAccess: "disabled"',
    'mechanism: "product_owned_audited_ingress"',
    'nativeMutation: "disabled"',
  ]) {
    if (!expertSource.includes(fingerprint)) {
      errors.push(`PR-09 expert ingress boundary is missing ${fingerprint}`)
    }
  }
  if (
    !expertSource.includes("eventId: string") ||
    !expertSource.includes("keycloakSubjectId: string | null") ||
    /sourceEventId|source_event_id/.test(expertSource)
  ) {
    errors.push("PR-09 native event interface changed")
  }

  const auditSource = read("apps/bff/src/services/audit.ts")
  const ingestionSource = read("apps/bff/src/services/audit-ingestion.ts")
  const exportSource = read("apps/bff/src/services/audit-export.ts")
  const schemaSource = read("apps/bff/src/db/inference-core-schema.ts")
  const migrationSource = read("infra/migrations/0000_inference_core.sql")
  const auditSchema = section(
    schemaSource,
    "export const auditEvents = common.table(",
    "export const auditSourceCursors = common.table(",
    "audit event schema",
  )
  const auditMigration = section(
    migrationSource,
    "CREATE TABLE common.audit_events (",
    "CREATE TABLE common.audit_source_cursors (",
    "audit event migration",
  )
  const cursorSchema = section(
    schemaSource,
    "export const auditSourceCursors = common.table(",
    "export const applications = admin.table(",
    "audit cursor schema",
  )
  const cursorMigration = section(
    migrationSource,
    "CREATE TABLE common.audit_source_cursors (",
    "CREATE TABLE admin.applications (",
    "audit cursor migration",
  )
  if (
    !auditSchema.includes('id: uuid("id").primaryKey()') ||
    !auditMigration.includes("id uuid PRIMARY KEY") ||
    /sourceEventId|source_event_id|targetType|targetId|target_type|target_id/.test(
      `${auditSchema}\n${auditMigration}`,
    ) ||
    /uniqueIndex\([^)]*correlation|CREATE UNIQUE INDEX[^;]*correlation/is.test(
      `${auditSchema}\n${auditMigration}`,
    )
  ) {
    errors.push("PR-09 audit persistence identity boundary changed")
  }
  if (
    /sourceEventId|source_event_id/.test(
      `${auditSource}\n${ingestionSource}\n${exportSource}`,
    ) ||
    /\btarget(?:Type|Id)\b|target_(?:type|id)\b/.test(exportSource)
  ) {
    errors.push(
      "PR-09 raw source or generic target metadata is persisted or exported",
    )
  }
  for (const fingerprint of [
    "eventId: canonicalNativeEventId(event.eventId)",
    "id: eventId",
    ".onConflictDoNothing()",
    "sameStoredNativeAuditEvent",
    "Native audit event ID collided with different canonical metadata.",
    "Native audit eventId must be a canonical deterministic UUID.",
  ]) {
    if (!ingestionSource.includes(fingerprint)) {
      errors.push(
        `PR-09 native event identity boundary is missing ${fingerprint}`,
      )
    }
  }
  for (const fingerprint of [
    "NATIVE_AUDIT_CURSOR_PATTERN",
    'super("Audit source state changed during collection.")',
    '.for("update")',
    "storedCursor(current) !== beforeCursor",
    "current.lastAttemptAt && current.lastAttemptAt > now",
    "events.length === 0 && nextCursor !== beforeCursor",
    "Native audit cursor must match the final event watermark.",
  ]) {
    if (!ingestionSource.includes(fingerprint)) {
      errors.push(`PR-09 native cursor boundary is missing ${fingerprint}`)
    }
  }
  if (
    (ingestionSource.match(/\.for\("update"\)/g) ?? []).length !== 2 ||
    (
      ingestionSource.match(
        /current\.lastAttemptAt\s*&&\s*current\.lastAttemptAt\s*>\s*now/g,
      ) ?? []
    ).length !== 2 ||
    !cursorSchema.includes('cursorVersion: integer("cursor_version")') ||
    !cursorSchema.includes('cursorWatermark: timestamp("cursor_watermark"') ||
    !cursorSchema.includes('cursorTieBreaker: uuid("cursor_tie_breaker")') ||
    !cursorMigration.includes(
      "num_nonnulls(cursor_version, cursor_watermark, cursor_tie_breaker)",
    )
  ) {
    errors.push("PR-09 native cursor concurrency or storage boundary changed")
  }
  if (
    !auditSource.includes(
      'throw new TypeError("Native audit events require a correlation ID.")',
    ) ||
    !auditSource.includes(
      'throw new TypeError("Native audit correlationId must be a canonical UUID.")',
    ) ||
    !auditSource.includes("assertNativeCredentialPrefix(credentialPrefix)") ||
    !auditSource.includes("if (credentialRecordId && credentialPrefix)")
  ) {
    errors.push("PR-09 native identifier boundary changed")
  }
  if (
    !auditSource.includes(
      "NATIVE_PROVIDER_TOKEN_SHAPED_IDENTIFIER_PATTERN.test(value)",
    ) ||
    (auditSchema.match(/!~ '\^\(sk\[-_\]/g) ?? []).length !== 3 ||
    (auditMigration.match(/!~ '\^\(sk\[-_\]/g) ?? []).length !== 3
  ) {
    errors.push(
      "PR-09 provider-token-shaped native identifier boundary changed",
    )
  }

  const signingSource = read("apps/bff/src/services/audit-export-signing.ts")
  for (const fingerprint of [
    "AUDIT_EXPORT_SIGNING_PRIVATE_KEY_FILE",
    "AUDIT_EXPORT_SIGNING_PUBLIC_JWKS_FILE",
    'asymmetricKeyType !== "ed25519"',
    'alg: "EdDSA"',
    "constants.O_NOFOLLOW",
  ]) {
    if (!signingSource.includes(fingerprint)) {
      errors.push(`PR-09 audit signing boundary is missing ${fingerprint}`)
    }
  }
  if (
    /process\.env\.AUDIT_EXPORT_SIGNING_PRIVATE_KEY(?!_FILE)/.test(
      signingSource,
    ) ||
    /(?:BEGIN (?:EC |RSA )?PRIVATE KEY|PRIVATE_KEY\s*=)/.test(signingSource)
  ) {
    errors.push(
      "PR-09 audit private key material may not come from source or env",
    )
  }
  if (
    /\bsourceEventId\b|\bsource_event_id\b|\btargetType\b|\btargetId\b|\btarget_type\b|\btarget_id\b/.test(
      exportSource,
    )
  ) {
    errors.push("PR-09 signed audit export contains forbidden raw metadata")
  }

  const metricsRoute = read("apps/bff/src/routes/observability-metrics.ts")
  for (const fingerprint of [
    'const METRICS_PATH = "/internal/observability/metrics"',
    "BFF_OBSERVABILITY_METRICS_TOKEN_FILE",
    "constants.O_NOFOLLOW",
    "timingSafeEqual",
    "hasQueryString(request)",
  ]) {
    if (!metricsRoute.includes(fingerprint)) {
      errors.push(`PR-09 private metrics boundary is missing ${fingerprint}`)
    }
  }
  const prometheusSource = read("apps/bff/src/services/admin-prometheus.ts")
  const environmentExample = read(".env.example")
  if (
    !prometheusSource.includes("ADMIN_PROMETHEUS_BEARER_TOKEN_FILE") ||
    !prometheusSource.includes("constants.O_NOFOLLOW") ||
    /process\.env\.ADMIN_PROMETHEUS_BEARER_TOKEN(?!_FILE)/.test(
      prometheusSource,
    ) ||
    !environmentExample.includes(
      "ADMIN_PROMETHEUS_BEARER_TOKEN_FILE=/run/secrets/llmm_prometheus_query_bearer",
    ) ||
    !environmentExample.includes(
      "BFF_OBSERVABILITY_METRICS_TOKEN_FILE=/run/secrets/llmm_prometheus_scrape_bearer",
    ) ||
    /^ADMIN_PROMETHEUS_BEARER_TOKEN=/m.test(environmentExample) ||
    /^BFF_OBSERVABILITY_METRICS_TOKEN=/m.test(environmentExample)
  ) {
    errors.push("PR-09 Prometheus credential mount boundary changed")
  }
  const metricsSource = read(
    "apps/bff/src/services/admin-observability-metrics.ts",
  )
  for (const metric of [
    ...pr09ReviewedDispositions.observability.accountingMetrics,
    "llm_machines_inference_queue_depth_source_info",
  ]) {
    if (!metricsSource.includes(metric)) {
      errors.push(`PR-09 accounting metric is missing ${metric}`)
    }
  }
  if (
    metricsSource.includes("llmm_inference_") ||
    metricsSource.includes("`llm_machines_inference_queue_depth ${") ||
    !metricsSource.includes(
      'llm_machines_inference_queue_depth_source_info{status="not_configured"} 1',
    )
  ) {
    errors.push("PR-09 queue-depth emitter boundary changed")
  }

  const alertmanagerSource = read("apps/bff/src/services/admin-alertmanager.ts")
  const expectedAlerts = pr09ReviewedDispositions.observability.alerts
  const actualAlertNames = [
    ...new Set(alertmanagerSource.match(/LLMM[A-Za-z]+/g) ?? []),
  ].sort()
  if (
    JSON.stringify(actualAlertNames) !==
    JSON.stringify([...expectedAlerts].sort())
  ) {
    errors.push("PR-09 Alertmanager alert-name allowlist changed")
  }

  let runtimeContract = null
  try {
    runtimeContract = JSON.parse(
      read("infra/observability/runtime-contract.json"),
    )
  } catch {
    errors.push("PR-09 observability runtime contract is invalid JSON")
  }
  const normalizedMetrics = runtimeContract?.prometheus?.normalizedMetrics ?? []
  const runtimeMetricNames = normalizedMetrics.map(({ name }) => name)
  for (const metric of [
    ...pr09ReviewedDispositions.observability.accountingMetrics,
    "llm_machines_inference_queue_depth_source_info",
    "llm_machines_inference_queue_depth",
    "llm_machines_gpu_utilization_ratio",
  ]) {
    if (!runtimeMetricNames.includes(metric)) {
      errors.push(`PR-09 observability contract metric is missing ${metric}`)
    }
  }
  if (
    runtimeContract?.metadata?.activation !== "PR-12" ||
    runtimeContract?.metadata?.sourceOnly !== true ||
    runtimeContract?.metadata?.containsCredentials !== false ||
    runtimeContract?.prometheus?.retention !== "30d" ||
    runtimeContract?.prometheus?.scrapeTimeout !== "20s" ||
    runtimeContract?.prometheus?.scrapeAuthentication?.credentialSource !==
      "mounted-file" ||
    runtimeContract?.prometheus?.scrapeDiscovery?.seedTargetCount !== 0 ||
    runtimeContract?.prometheus?.queueDepthFallback !== "none" ||
    runtimeContract?.alertmanager?.defaultReceiver !== "local-null" ||
    runtimeContract?.alertmanager?.externalReceiverState !== "disabled" ||
    runtimeContract?.grafana?.oidc?.adminRole !== "Editor" ||
    runtimeContract?.grafana?.oidc?.operatorRole !== "Viewer" ||
    runtimeContract?.grafana?.oidc?.ambiguousRetainedRoles !== "deny" ||
    runtimeContract?.grafana?.oidc?.unknownRole !== "deny" ||
    runtimeContract?.grafana?.customerFolder?.adminPermission !== "Edit" ||
    runtimeContract?.grafana?.customerFolder?.operatorPermission !== "View"
  ) {
    errors.push("PR-09 observability runtime contract changed")
  }
  const queueMetric = normalizedMetrics.find(
    ({ name }) => name === "llm_machines_inference_queue_depth",
  )
  if (queueMetric?.availability !== "pr12-qualified-adapter") {
    errors.push("PR-09 genuine queue-depth metric is not deferred to PR-12")
  }

  const grafanaSource = read("infra/observability/grafana/grafana.ini")
  const observabilityValidator = read(
    "infra/observability/validate-profile.mjs",
  )
  const exactGrafanaRoleExpression =
    "contains(realm_access.roles[*], 'admin') && !contains(realm_access.roles[*], 'operator') && 'Editor' || contains(realm_access.roles[*], 'operator') && !contains(realm_access.roles[*], 'admin') && 'Viewer'"
  if (
    !grafanaSource.includes(
      `role_attribute_path = ${exactGrafanaRoleExpression}`,
    ) ||
    !observabilityValidator.includes("if (admin === operator) return null") ||
    !observabilityValidator.includes(exactGrafanaRoleExpression)
  ) {
    errors.push("PR-09 exact-one retained Grafana role boundary changed")
  }

  const alertmanagerConfig = read(
    "infra/observability/alertmanager/alertmanager.yml",
  )
  const prometheusTargets = read(
    "infra/observability/prometheus/file-sd/inference-core.json",
  )
  if (
    !alertmanagerConfig.includes("receiver: local-null") ||
    !alertmanagerConfig.includes("- name: local-null") ||
    /(?:email_configs|webhook_configs|smtp_smarthost|slack_configs):/.test(
      alertmanagerConfig,
    ) ||
    prometheusTargets.trim() !== "[]"
  ) {
    errors.push("PR-09 local-null default-off observability boundary changed")
  }

  const alertRules = read(
    "infra/observability/prometheus/rules/alert-rules.yml",
  )
  for (const alertName of expectedAlerts) {
    if (!alertRules.includes(`alert: ${alertName}`)) {
      errors.push(`PR-09 provisioned alert rule is missing ${alertName}`)
    }
  }
  if (
    !alertRules.includes("absent(llm_machines_inference_queue_depth) == 1") ||
    alertRules.includes("queue_depth_source_info") ||
    /queue.*in_flight|in_flight.*queue/i.test(alertRules)
  ) {
    errors.push("PR-09 queue-depth alert uses an unqualified substitute")
  }

  const egressContracts = read("packages/contracts/src/inference-core.ts")
  const egressService = read("apps/bff/src/services/admin-alert-egress.ts")
  const adminRoutes = read("apps/bff/src/routes/admin.ts")
  for (const fingerprint of [
    'z.literal("alert-egress-v1")',
    'z.literal("disabled")',
    'z.enum(["smtp", "webhook"])',
    'z.literal("not_stored")',
    "outboundDeliveryEnabled: z.literal(false)",
    "runtimeQualified: z.literal(false)",
  ]) {
    if (!egressContracts.includes(fingerprint)) {
      errors.push(
        `PR-09 redacted alert-egress contract is missing ${fingerprint}`,
      )
    }
  }
  for (const fingerprint of [
    'destinationState: "not_stored"',
    "outboundDeliveryEnabled: false",
    "runtimeQualified: false",
    'secretState: "not_stored"',
    'action: "admin.observability.alert_egress.updated"',
  ]) {
    if (!egressService.includes(fingerprint)) {
      errors.push(`PR-09 alert-egress service is missing ${fingerprint}`)
    }
  }
  if (
    !adminRoutes.includes('withCapability("console.operational.view")') ||
    !adminRoutes.includes(
      'reviewedAdminOnly("POST /api/admin/observability/alert-egress")',
    )
  ) {
    errors.push("PR-09 alert-egress route authorization changed")
  }
  const schemaAndMigration = `${read(
    "apps/bff/src/db/inference-core-schema.ts",
  )}\n${read("infra/migrations/0000_inference_core.sql")}`
  if (
    /alert_(?:delivery|egress)_(?:destination|email|url|host|port|recipient|password|secret|token)/i.test(
      schemaAndMigration,
    )
  ) {
    errors.push(
      "PR-09 alert-egress persistence contains destination or secret fields",
    )
  }
  for (const field of pr09ReviewedDispositions.alertEgress
    .dedicatedUpdaterFields) {
    if (!schemaAndMigration.includes(field)) {
      errors.push(`PR-09 alert-egress updater field is missing ${field}`)
    }
  }
  if (
    !egressService.includes("return commitWithReceipt({") ||
    !egressService.includes("await transaction.insert(auditEvents).values({") ||
    !adminRoutes.includes(
      "await db.transaction((transaction) => commit(transaction))",
    ) ||
    !adminRoutes.includes("await completeIdempotency(")
  ) {
    errors.push(
      "PR-09 alert-egress state, audit, and receipt atomicity changed",
    )
  }

  const retentionSource = read(
    "apps/bff/src/services/inference-core-retention.ts",
  )
  if (
    !retentionSource.includes("365 * 24 * 60 * 60 * 1000") ||
    !retentionSource.includes("cutoff.setUTCDate(cutoff.getUTCDate() - 89)")
  ) {
    errors.push("PR-09 audit or usage retention boundary changed")
  }
  const navigationPath =
    "apps/web/src/components/console-v2/console-v2-sections.ts"
  let navigationSource = read(navigationPath)
  const navigationEvidenceCommit = isRegularFile(
    resolve(root, pr11DecisionPath),
  )
    ? pr11Pr09HistoricalSourceBoundaryCommitByPath.get(navigationPath)
    : null
  if (navigationEvidenceCommit) {
    const successorErrors = verifyReviewedPr11SuccessorContext(root)
    if (successorErrors.length > 0) {
      errors.push(
        ...successorErrors.map(
          (error) =>
            `PR-09 successor-historical source is unavailable: ${error}`,
        ),
      )
    } else {
      try {
        navigationSource = readRepositoryPathAtCommit(
          root,
          navigationEvidenceCommit,
          navigationPath,
        ).toString("utf8")
      } catch {
        errors.push(
          `PR-09 successor-historical source is unavailable ${navigationPath}`,
        )
      }
    }
  }
  if (navigationSource.includes('href: "/activity"')) {
    errors.push("PR-09 added Activity to global navigation before PR-11")
  }

  return [...new Set(errors)].sort()
}

export function verifyReviewedPr09SourceFingerprints(root = repositoryRoot) {
  const errors = []
  const parsedFiles = new Map()
  let historicalCommit = null
  if (isRegularFile(resolve(root, pr10cDecisionPath))) {
    const successorErrors = verifyReviewedPr10cSuccessorContext(root)
    if (successorErrors.length > 0) {
      return successorErrors.map(
        (error) => `PR-09 successor-historical source is unavailable: ${error}`,
      )
    }
    historicalCommit = pr10ContractBase
  }

  for (const expected of reviewedPr09SourceFingerprints) {
    let sourceFile = parsedFiles.get(expected.path)
    if (!sourceFile) {
      const absolutePath = resolve(root, expected.path)
      if (!historicalCommit && !isRegularFile(absolutePath)) {
        errors.push(`PR-09 reviewed source is missing ${expected.path}`)
        continue
      }
      let source
      try {
        source = historicalCommit
          ? readRepositoryPathAtCommit(
              root,
              historicalCommit,
              expected.path,
            ).toString("utf8")
          : readFileSync(absolutePath, "utf8")
      } catch {
        errors.push(`PR-09 reviewed source is missing ${expected.path}`)
        continue
      }
      sourceFile = ts.createSourceFile(
        expected.path,
        source,
        ts.ScriptTarget.Latest,
        true,
        scriptKindForPath(expected.path),
      )
      if (sourceFile.parseDiagnostics.length > 0) {
        errors.push(`PR-09 reviewed source is invalid ${expected.path}`)
        continue
      }
      parsedFiles.set(expected.path, sourceFile)
    }

    const matches = []
    for (const statement of sourceFile.statements) {
      if (
        ts.isFunctionDeclaration(statement) &&
        statement.name?.text === expected.symbol
      ) {
        matches.push(statement)
      }
      if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (
            ts.isIdentifier(declaration.name) &&
            declaration.name.text === expected.symbol
          ) {
            matches.push(declaration)
          }
        }
      }
    }
    if (matches.length !== 1) {
      errors.push(
        `PR-09 reviewed source symbol is missing or ambiguous ${expected.path}#${expected.symbol}`,
      )
      continue
    }
    const normalized = matches[0].getText(sourceFile).replace(/\s+/g, " ")
    const actualSha256 = sha256(normalized)
    if (actualSha256 !== expected.sha256) {
      errors.push(
        `PR-09 reviewed source symbol changed ${expected.path}#${expected.symbol} expected=${expected.sha256} actual=${actualSha256}`,
      )
    }
  }

  return errors.sort()
}

export function verifyReviewedPr09NativeIdentifierEvidence(
  root = repositoryRoot,
) {
  const errors = []
  const hasPr11Successor = isRegularFile(resolve(root, pr11DecisionPath))
  if (hasPr11Successor) {
    const successorErrors = verifyReviewedPr11SuccessorContext(root)
    if (successorErrors.length > 0) {
      return successorErrors
        .map(
          (error) =>
            `PR-09 successor-historical native identifier evidence is unavailable: ${error}`,
        )
        .sort()
    }
  }
  for (const expected of reviewedPr09NativeIdentifierEvidence) {
    const absolutePath = resolve(root, expected.path)
    if (!isRegularFile(absolutePath)) {
      errors.push(
        `PR-09 native identifier evidence is missing ${expected.path}`,
      )
      continue
    }
    let evidenceBytes
    try {
      const pr11HistoricalCommit = hasPr11Successor
        ? pr11Pr09HistoricalNativeEvidenceCommitByPath.get(expected.path)
        : null
      evidenceBytes = pr11HistoricalCommit
        ? readRepositoryPathAtCommit(root, pr11HistoricalCommit, expected.path)
        : isRegularFile(resolve(root, pr10DecisionPath)) &&
            pr10Pr09HistoricalNativeEvidencePaths.has(expected.path)
          ? readRepositoryPathAtCommit(root, pr10ContractBase, expected.path)
          : readFileSync(absolutePath)
    } catch {
      errors.push(
        `PR-09 successor-historical evidence is unavailable ${expected.path}`,
      )
      continue
    }
    const actualSha256 = sha256(evidenceBytes)
    if (actualSha256 !== expected.sha256) {
      errors.push(
        `PR-09 native identifier evidence changed ${expected.path} expected=${expected.sha256} actual=${actualSha256}`,
      )
    }
  }
  return errors.sort()
}

function routeCountsByClassification(routes) {
  const counts = new Map()
  for (const route of routes) {
    counts.set(
      route.classification,
      (counts.get(route.classification) ?? 0) + 1,
    )
  }
  return counts
}

export function verifyPr08QueryFreeLoggingBoundary(root = repositoryRoot) {
  const path = "apps/bff/src/index.ts"
  const absolutePath = resolve(root, path)
  if (!isRegularFile(absolutePath)) {
    return [`PR-08 query-free request logging entrypoint is missing ${path}`]
  }
  const source = readFileSync(absolutePath, "utf8")
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )
  const errors = []
  for (const expected of pr08QueryFreeLoggingFingerprints) {
    const matches = sourceFile.statements.filter(
      (statement) =>
        ts.isFunctionDeclaration(statement) &&
        statement.name?.text === expected.symbol,
    )
    if (matches.length !== 1) {
      errors.push(
        `PR-08 query-free logging symbol is missing ${expected.symbol}`,
      )
      continue
    }
    const normalized = matches[0].getText(sourceFile).replace(/\s+/g, " ")
    if (sha256(normalized) !== expected.sha256) {
      errors.push(`PR-08 query-free logging symbol changed ${expected.symbol}`)
    }
  }
  if ((source.match(/request\.log\./g) ?? []).length !== 2) {
    errors.push("PR-08 index request-log call boundary changed")
  }
  const gatewayPath = "apps/bff/src/routes/firecrawl-gateway.ts"
  const gatewaySource = isRegularFile(resolve(root, gatewayPath))
    ? readFileSync(resolve(root, gatewayPath), "utf8")
    : ""
  if (
    /request\.log\.|console\.(?:debug|error|info|log|warn)\s*\(/.test(
      gatewaySource,
    )
  ) {
    errors.push("PR-08 Firecrawl gateway contains unreviewed request logging")
  }
  return errors.sort()
}

export function verifyReviewedWebAuthenticationEvidence(root = repositoryRoot) {
  const errors = []
  for (const {
    path,
    sha256: expectedSha256,
  } of reviewedPr03WebAuthenticationEvidence) {
    const absolutePath = resolve(root, path)
    if (!isRegularFile(absolutePath)) {
      errors.push(`missing reviewed Web authentication evidence ${path}`)
      continue
    }
    const actualSha256 = sha256(readFileSync(absolutePath))
    if (actualSha256 !== expectedSha256) {
      errors.push(
        `reviewed Web authentication evidence changed ${path} expected=${expectedSha256} actual=${actualSha256}`,
      )
    }
  }
  return errors.sort()
}

export function verifyReviewedPr04WebAuthenticationEvidence(
  root = repositoryRoot,
) {
  const errors = []
  for (const {
    path,
    sha256: expectedSha256,
  } of reviewedPr04WebAuthenticationEvidence) {
    const absolutePath = resolve(root, path)
    let evidence
    if (root === repositoryRoot) {
      try {
        evidence = execFileSync(
          "git",
          [
            "show",
            "--no-ext-diff",
            "--no-textconv",
            "--end-of-options",
            `${pr05ContractBase}:${path}`,
          ],
          { cwd: root, encoding: null, stdio: ["ignore", "pipe", "pipe"] },
        )
      } catch {
        errors.push(`missing PR-04 Web authentication evidence ${path}`)
        continue
      }
    } else if (!isRegularFile(absolutePath)) {
      errors.push(`missing PR-04 Web authentication evidence ${path}`)
      continue
    } else {
      evidence = readFileSync(absolutePath)
    }
    const actualSha256 = sha256(evidence)
    if (actualSha256 !== expectedSha256) {
      errors.push(
        `PR-04 Web authentication evidence changed ${path} expected=${expectedSha256} actual=${actualSha256}`,
      )
    }
  }
  return errors.sort()
}

export function verifyReviewedPr05WebAuthenticationEvidence(
  root = repositoryRoot,
) {
  const errors = []
  for (const {
    path,
    sha256: expectedSha256,
  } of reviewedPr05WebAuthenticationEvidence) {
    const absolutePath = resolve(root, path)
    if (!isRegularFile(absolutePath)) {
      errors.push(`missing PR-05 Web authentication evidence ${path}`)
      continue
    }
    const actualSha256 = sha256(readFileSync(absolutePath))
    if (actualSha256 !== expectedSha256) {
      errors.push(
        `PR-05 Web authentication evidence changed ${path} expected=${expectedSha256} actual=${actualSha256}`,
      )
    }
  }
  return errors.sort()
}

export function verifyReviewedPr09WebAuthenticationEvidence(
  root = repositoryRoot,
) {
  const errors = []
  const hasPr11Successor = isRegularFile(resolve(root, pr11DecisionPath))
  if (hasPr11Successor) {
    const successorErrors = verifyReviewedPr11SuccessorContext(root)
    if (successorErrors.length > 0) {
      return successorErrors
        .map(
          (error) =>
            `PR-09 successor-historical Web authentication evidence is unavailable: ${error}`,
        )
        .sort()
    }
  }
  for (const {
    path,
    sha256: expectedSha256,
  } of reviewedPr09WebAuthenticationEvidence) {
    const absolutePath = resolve(root, path)
    if (!isRegularFile(absolutePath)) {
      errors.push(`missing PR-09 Web authentication evidence ${path}`)
      continue
    }
    let evidenceBytes
    try {
      const historicalCommit = hasPr11Successor
        ? pr11Pr09HistoricalWebAuthenticationEvidenceCommitByPath.get(path)
        : null
      evidenceBytes = historicalCommit
        ? readRepositoryPathAtCommit(root, historicalCommit, path)
        : readFileSync(absolutePath)
    } catch {
      errors.push(
        `PR-09 successor-historical Web authentication evidence is unavailable ${path}`,
      )
      continue
    }
    const actualSha256 = sha256(evidenceBytes)
    if (actualSha256 !== expectedSha256) {
      errors.push(
        `PR-09 Web authentication evidence changed ${path} expected=${expectedSha256} actual=${actualSha256}`,
      )
    }
  }
  return errors.sort()
}

export function verifyWebAuthenticationBoundary(root = repositoryRoot) {
  const path = "apps/web/src/middleware.ts"
  const absolutePath = resolve(root, path)
  if (!isRegularFile(absolutePath)) {
    return [`missing reviewed Web authentication boundary ${path}`]
  }
  const source = readFileSync(absolutePath, "utf8")
  const requiredPatterns = [
    [/from\s+["']@\/lib\/auth\/auth["']/, "Auth.js import"],
    [/export\s+default\s+function\s+middleware\b/, "default middleware export"],
    [/\bisProtectedConsolePath\s*\(/, "retained-route protection"],
    [/\brequest\.nextUrl\.pathname\b/, "request path inspection"],
    [/\brequest\.auth\b/, "authenticated-session check"],
    [/\bNextResponse\.redirect\s*\(/, "unauthenticated redirect"],
    [/["']\/auth\/signin["']/, "sign-in destination"],
    [/\bcallbackUrl\b/, "callback URL preservation"],
    [/export\s+const\s+config\s*=/, "middleware configuration"],
    [/\bmatcher\s*:/, "middleware matcher"],
    [/["']\/["']/, "Console root protection"],
    [/["']\/applications["']/, "Applications protection"],
    [/["']\/hardware["']/, "Hardware protection"],
    [/["']\/inference["']/, "Inference protection"],
    [/["']\/settings["']/, "Settings protection"],
    [/["']\/team["']/, "Team protection"],
    [/["']\/activity["']/, "Activity protection"],
  ]
  const errors = []
  for (const [pattern, label] of requiredPatterns) {
    if (!pattern.test(source)) {
      errors.push(`Web authentication boundary missing ${label}`)
    }
  }
  if (!source.includes(JSON.stringify(reviewedPr03WebMiddlewareMatcher))) {
    errors.push(
      "Web authentication boundary missing reviewed middleware matcher",
    )
  }
  for (const [pattern, label] of [
    [/middleware-policy/, "retired middleware policy"],
    [/\bisHubAuthRequired\b/, "legacy Hub auth switch"],
    [/\bCONSOLE_REQUIRE_AUTH\b/, "fail-open auth override"],
    [/\bCONSOLE_BFF_URL\b/, "deployment-dependent auth switch"],
    [/\bprocess\.env\b/, "runtime auth override"],
  ]) {
    if (pattern.test(source)) {
      errors.push(`Web authentication boundary retains ${label}`)
    }
  }
  return errors.sort()
}

export function buildContractRevisionDocument({
  revisionId = "PR-02",
  scope = "retained-seam-extraction",
  baseCommit,
  baseTree,
  baseAllowlist,
  currentAllowlist,
  baseRoutes,
  currentRoutes,
  evidenceFiles,
}) {
  return {
    schemaVersion: 1,
    id: revisionId,
    scope,
    baseCommit,
    baseTree,
    changes: {
      forbiddenPolicy: {
        before: baseAllowlist.policyDigest,
        after: currentAllowlist.policyDigest,
      },
      forbiddenEntries: buildEntryChanges(
        baseAllowlist.entries ?? [],
        currentAllowlist.entries ?? [],
        (entry) => `${entry.ruleId} ${entry.path}`,
      ),
      protectedFiles: buildEntryChanges(
        baseAllowlist.protectedFiles ?? [],
        currentAllowlist.protectedFiles ?? [],
        (entry) => entry.path,
      ),
      routePolicy: {
        before: baseRoutes.policyDigest,
        after: currentRoutes.policyDigest,
      },
      routes: buildEntryChanges(
        baseRoutes.routes ?? [],
        currentRoutes.routes ?? [],
        routeManifestKey,
      ),
      fastifyRegistrars: buildEntryChanges(
        baseRoutes.fastifyRegistrars ?? [],
        currentRoutes.fastifyRegistrars ?? [],
        (entry) => entry.exportName,
      ),
      webInferenceConsumers: buildEntryChanges(
        baseRoutes.webInferenceConsumers ?? [],
        currentRoutes.webInferenceConsumers ?? [],
        (entry) => entry.path,
      ),
      sourceClosure: buildEntryChanges(
        baseRoutes.sourceClosure ?? [],
        currentRoutes.sourceClosure ?? [],
        (entry) => entry.path,
      ),
      repositoryClosure: buildEntryChanges(
        baseRoutes.repositoryClosure ?? [],
        currentRoutes.repositoryClosure ?? [],
        (entry) => entry.path,
      ),
      escapeHatches: buildEntryChanges(
        baseRoutes.escapeHatches ?? [],
        currentRoutes.escapeHatches ?? [],
        (entry) => entry.path,
      ),
    },
    evidenceFiles,
  }
}

export function buildEntryChanges(base, current, keyFor) {
  const baseGroups = groupEntries(base, keyFor)
  const currentGroups = groupEntries(current, keyFor)
  const keys = [
    ...new Set([...baseGroups.keys(), ...currentGroups.keys()]),
  ].sort()
  const changes = []
  for (const key of keys) {
    const before = baseGroups.get(key) ?? []
    const after = currentGroups.get(key) ?? []
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      changes.push({ key, before, after })
    }
  }
  return changes
}

function groupEntries(entries, keyFor) {
  const groups = new Map()
  for (const entry of entries) {
    const key = keyFor(entry)
    const group = groups.get(key) ?? []
    group.push(entry)
    groups.set(key, group)
  }
  for (const group of groups.values()) {
    group.sort((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right)),
    )
  }
  return groups
}

function routeManifestKey(route) {
  return [route.surface, route.method, route.path, route.source].join(" ")
}

function buildReviewedRevisionFingerprints(root) {
  const revisions = []
  let missingRevision = null
  for (const { id, path } of [
    { id: "PR-02", path: pr02ContractRevisionPath },
    { id: "PR-03", path: pr03ContractRevisionPath },
    { id: "PR-04", path: pr04ContractRevisionPath },
    { id: "PR-05", path: pr05ContractRevisionPath },
    { id: "PR-06", path: pr06ContractRevisionPath },
    { id: "PR-07", path: pr07ContractRevisionPath },
    { id: "PR-08", path: pr08ContractRevisionPath },
    { id: "PR-09", path: pr09ContractRevisionPath },
    { id: "PR-10", path: pr10ContractRevisionPath },
    { id: "PR-10C", path: pr10cContractRevisionPath },
    { id: "PR-11", path: pr11ContractRevisionPath },
  ]) {
    if (!isRegularFile(resolve(root, path))) {
      missingRevision ??= id
      continue
    }
    if (missingRevision) {
      throw new Error(
        `${id} contract revision cannot exist without ${missingRevision}`,
      )
    }
    revisions.push({
      id,
      path,
      sha256: sha256(readFileSync(resolve(root, path))),
    })
  }
  return revisions
}

export function buildRevisionEvidenceFingerprints(
  root,
  paths = pr02RevisionEvidencePaths,
  revisionId = "PR-02",
  { useHistoricalSuccessorTests = false } = {},
) {
  return paths.map((path) => {
    const pr11HistoricalCommit =
      pr11HistoricalEvidenceCommitByRevisionAndPath.get(
        `${revisionId}\0${path}`,
      )
    const pr10cHistoricalCommit =
      pr10cHistoricalTestEvidenceCommitByRevisionAndPath.get(
        `${revisionId}\0${path}`,
      )
    let historicalCommit
    if (
      pr11HistoricalCommit &&
      isRegularFile(resolve(root, pr11DecisionPath))
    ) {
      const successorErrors = verifyReviewedPr11SuccessorContext(root)
      if (successorErrors.length > 0) {
        throw new Error(
          `PR-11 successor-historical evidence is unavailable: ${successorErrors.join("; ")}`,
        )
      }
      historicalCommit = pr11HistoricalCommit
    } else if (
      pr10cHistoricalCommit &&
      isRegularFile(resolve(root, pr10cDecisionPath))
    ) {
      const successorErrors = verifyReviewedPr10cSuccessorContext(root)
      if (successorErrors.length > 0) {
        throw new Error(
          `PR-10C successor-historical evidence is unavailable: ${successorErrors.join("; ")}`,
        )
      }
      historicalCommit = pr10cHistoricalCommit
    } else if (useHistoricalSuccessorTests) {
      historicalCommit = pr09HistoricalTestEvidenceCommitByPath.get(path)
    }
    if (historicalCommit) {
      return {
        path,
        sha256: sha256(
          readRepositoryPathAtCommit(root, historicalCommit, path),
        ),
      }
    }
    const absolutePath = resolve(root, path)
    if (!isRegularFile(absolutePath)) {
      throw new Error(`Missing ${revisionId} revision evidence file ${path}`)
    }
    return { path, sha256: sha256(readFileSync(absolutePath)) }
  })
}

function readRetainedEvidenceBytes(root, path, absolutePath) {
  if (
    pr11SuccessorHistoricalEvidencePaths.includes(path) &&
    isRegularFile(resolve(root, pr11DecisionPath))
  ) {
    const successorErrors = verifyReviewedPr11SuccessorContext(root)
    if (successorErrors.length > 0) {
      throw new Error(
        `PR-11 successor-historical evidence is unavailable: ${successorErrors.join("; ")}`,
      )
    }
    return readRepositoryPathAtCommit(root, pr11ContractBase, path)
  }
  const historicalCommit = inheritedHistoricalTestEvidenceCommitByPath.get(path)
  return historicalCommit
    ? readRepositoryPathAtCommit(root, historicalCommit, path)
    : readFileSync(absolutePath)
}

function readRepositoryPathAtCommit(root, commit, path) {
  return execFileSync(
    "git",
    [
      "show",
      "--no-ext-diff",
      "--no-textconv",
      "--end-of-options",
      `${commit}:${path}`,
    ],
    {
      cwd: root,
      encoding: null,
      stdio: ["ignore", "pipe", "pipe"],
    },
  )
}

export function verifyCorePackageClosure(
  root = repositoryRoot,
  paths = listCandidatePaths(root),
) {
  const errors = []
  const packagePaths = paths.filter(
    (path) =>
      /^(?:apps|packages)\/[^/]+\/package\.json$/.test(path) &&
      isRegularFile(resolve(root, path)),
  )
  const packages = new Map(
    packagePaths.map((path) => {
      const manifest = readJson(resolve(root, path))
      return [manifest.name, { manifest, path }]
    }),
  )
  const queue = ["@llm-machines/bff", "@llm-machines/web"]
  const closure = new Set()

  while (queue.length > 0) {
    const name = queue.shift()
    if (!name || closure.has(name)) {
      continue
    }
    const pkg = packages.get(name)
    if (!pkg) {
      errors.push(`missing Core package ${name}`)
      continue
    }
    closure.add(name)
    const dependencies = {
      ...pkg.manifest.dependencies,
      ...pkg.manifest.devDependencies,
      ...pkg.manifest.optionalDependencies,
      ...pkg.manifest.peerDependencies,
    }
    for (const dependency of Object.keys(dependencies)) {
      if (packages.has(dependency)) {
        queue.push(dependency)
      }
    }
  }

  const expected = [
    "@llm-machines/bff",
    "@llm-machines/contracts",
    "@llm-machines/copy",
    "@llm-machines/web",
  ]
  const actual = [...closure].sort()
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    errors.push(
      `Core package closure changed expected=${expected.join(",")} actual=${actual.join(",")}`,
    )
  }
  if (closure.has("@llm-machines/agentic-adapter")) {
    errors.push("Core package closure includes the Agentic adapter")
  }

  const rootManifest = readJson(resolve(root, "package.json"))
  const exactCoreScripts = {
    "build:inference-core":
      "node scripts/inference-core/run-core-command.mjs build",
    "check:inference-core":
      "node infra/firecrawl/validate-profile.mjs && node infra/observability/validate-profile.mjs && node scripts/inference-core/guardrails.mjs",
    "check:inference-core:base": `node infra/firecrawl/validate-profile.mjs && node infra/observability/validate-profile.mjs && node scripts/inference-core/guardrails.mjs --base-ref ${pr11ContractBase}`,
    "contract:inference-core:pr07:policy":
      "node scripts/inference-core/pr07-contract-revision.mjs --print-operation-policy",
    "contract:inference-core:pr07:write":
      "node scripts/inference-core/pr07-contract-revision.mjs --write",
    "contract:inference-core:pr09:policy":
      "node scripts/inference-core/pr09-contract-revision.mjs --print-operation-policy",
    "contract:inference-core:pr09:write":
      "node scripts/inference-core/pr09-contract-revision.mjs --write",
    "contract:inference-core:pr10:policy":
      "node scripts/inference-core/pr10-contract-revision.mjs --print-operation-policy",
    "contract:inference-core:pr10:write":
      "node scripts/inference-core/pr10-contract-revision.mjs --write",
    "contract:inference-core:pr10c:policy":
      "node scripts/inference-core/pr10c-contract-revision.mjs --print-operation-policy",
    "contract:inference-core:pr10c:write":
      "node scripts/inference-core/pr10c-contract-revision.mjs --write",
    "contract:inference-core:pr11:policy":
      "node scripts/inference-core/pr11-contract-revision.mjs --print-operation-policy",
    "contract:inference-core:pr11:write":
      "node scripts/inference-core/pr11-contract-revision.mjs --write",
    "test:inference-core-authorization":
      "corepack pnpm --filter @llm-machines/contracts --fail-if-no-match exec vitest run src/inference-core-authorization.test.ts",
    "test:inference-core-characterization":
      "corepack pnpm --filter @llm-machines/bff --fail-if-no-match exec vitest run src/routes/inference-core-characterization.test.ts",
    "test:inference-core-db":
      "corepack pnpm --dir test-support/inference-core-db-tests install --frozen-lockfile --ignore-scripts && corepack pnpm --dir test-support/inference-core-db-tests test --minWorkers=1 --maxWorkers=4 --testTimeout=15000 --hookTimeout=15000",
    "test:inference-core-guardrails":
      "node --test scripts/inference-core/*.test.mjs infra/firecrawl/validate-profile.test.mjs infra/observability/validate-profile.test.mjs",
    test: "corepack pnpm run check:inference-core:base && corepack pnpm run test:inference-core-guardrails && corepack pnpm --filter @llm-machines/contracts --fail-if-no-match build && corepack pnpm --filter @llm-machines/copy --fail-if-no-match build && corepack pnpm run test:inference-core-authorization && corepack pnpm run test:inference-core-characterization && corepack pnpm run test:inference-core-db && corepack pnpm -r --fail-if-no-match test",
    typecheck:
      "corepack pnpm -r build && corepack pnpm -r typecheck && corepack pnpm run typecheck:inference-core-db",
    "typecheck:inference-core-db":
      pr04StandaloneDbTestBoundary.rootScripts["typecheck:inference-core-db"],
    "typecheck:inference-core":
      "node scripts/inference-core/run-core-command.mjs typecheck",
  }
  for (const [scriptName, expected] of Object.entries(exactCoreScripts)) {
    if (rootManifest.scripts?.[scriptName] !== expected) {
      errors.push(`invalid Core-only script ${scriptName}`)
    }
    for (const prefix of ["pre", "post"]) {
      const lifecycleName = `${prefix}${scriptName}`
      if (rootManifest.scripts?.[lifecycleName] !== undefined) {
        errors.push(`forbidden root lifecycle script ${lifecycleName}`)
      }
    }
  }

  const exactPackageScripts = {
    "@llm-machines/bff": {
      "audit:ingest": "tsx src/commands/audit-ingestion.ts",
      build:
        "corepack pnpm --filter @llm-machines/contracts build && tsc --project tsconfig.json",
      "retention:prune": "tsx src/commands/inference-core-retention.ts",
      test: "corepack pnpm --filter @llm-machines/contracts build && vitest run",
      typecheck: "tsc --project tsconfig.json",
    },
    "@llm-machines/web": {
      build:
        "corepack pnpm --filter @llm-machines/contracts build && corepack pnpm --filter @llm-machines/copy build && next build",
      test: "corepack pnpm --filter @llm-machines/contracts build && corepack pnpm --filter @llm-machines/copy build && vitest run",
      typecheck: "tsc --noEmit --project tsconfig.json",
    },
    "@llm-machines/contracts": {
      build: "tsc --project tsconfig.build.json",
      test: "vitest run && tsc --project tsconfig.json",
      typecheck: "tsc --project tsconfig.json",
    },
    "@llm-machines/copy": {
      build: "tsc --project tsconfig.build.json",
      test: "tsc --project tsconfig.json",
      typecheck: "tsc --project tsconfig.json",
    },
  }
  for (const [packageName, scripts] of Object.entries(exactPackageScripts)) {
    const manifest = packages.get(packageName)?.manifest
    for (const [scriptName, expected] of Object.entries(scripts)) {
      if (manifest?.scripts?.[scriptName] !== expected) {
        errors.push(`invalid ${packageName} script ${scriptName}`)
      }
      for (const prefix of ["pre", "post"]) {
        const lifecycleName = `${prefix}${scriptName}`
        if (manifest?.scripts?.[lifecycleName] !== undefined) {
          errors.push(
            `forbidden ${packageName} lifecycle script ${lifecycleName}`,
          )
        }
      }
    }
  }

  const workspaceManifest = readFileSync(
    resolve(root, "pnpm-workspace.yaml"),
    "utf8",
  ).replaceAll("\r\n", "\n")
  if (workspaceManifest !== "packages:\n  - apps/*\n  - packages/*\n") {
    errors.push("Core workspace membership changed")
  }
  const expectedTestConfigs = [
    "apps/bff/vitest.config.ts",
    "apps/web/vitest.config.ts",
  ]
  const actualTestConfigs = paths
    .filter((path) =>
      /^(?:(?:apps\/(?:bff|web)|packages\/(?:contracts|copy))\/)?(?:vite|vitest)\.config\.(?:cjs|cts|js|mjs|mts|ts)$/.test(
        path,
      ),
    )
    .sort()
  if (
    JSON.stringify(actualTestConfigs) !== JSON.stringify(expectedTestConfigs)
  ) {
    errors.push("Core test configuration surface changed")
  }

  return errors.sort()
}

export function verifyRetentionCharacterization(root = repositoryRoot) {
  const register = readJson(resolve(root, retentionCharacterizationPath))
  const errors = []
  const expectedRegisterKeys = [
    "d2aRcRetentionEvidence",
    "legacyGaps",
    "overallVerdict",
    "requiredArtifactClasses",
    "requiredSourceScenarios",
    "requiredTerminalStates",
    "runtimeZeroRetentionCompliance",
    "schemaVersion",
    "scope",
    "sourceCoverage",
    "sourceRetentionContract",
  ]
  const expectedSourceCoverage = [
    {
      scenario: "non-stream-success",
      status: "EXISTING_AUDIT_AND_USAGE_ASSERTIONS",
    },
    {
      scenario: "stream-success",
      status: "EXISTING_AUDIT_AND_USAGE_ASSERTIONS",
    },
    { scenario: "rejection", status: "PARTIAL_SOURCE_CHARACTERIZATION" },
    { scenario: "cancellation", status: "NOT_EVALUATED_RUNTIME" },
    { scenario: "timeout", status: "SOURCE_CONTROL_ABSENT" },
    {
      scenario: "upstream-failure",
      status: "PARTIAL_SOURCE_CHARACTERIZATION",
    },
    { scenario: "crash", status: "NOT_EVALUATED_RUNTIME" },
    { scenario: "restart", status: "NOT_EVALUATED_RUNTIME" },
    { scenario: "backup", status: "NOT_EVALUATED_RUNTIME" },
    { scenario: "restore", status: "NOT_EVALUATED_RUNTIME" },
  ]
  const expectedLegacyGaps = [
    {
      id: "ZR-LEGACY-002",
      summary: "Audit reason and metadata accept unrestricted content.",
      retireBy: "PR-04",
    },
    {
      id: "ZR-LEGACY-003",
      summary: "Retired schemas and stores contain workload content.",
      retireBy: "PR-04",
    },
    {
      id: "ZR-LEGACY-004",
      summary:
        "Generic idempotency storage can retain arbitrary mutation responses.",
      retireBy: "PR-04",
    },
    {
      id: "ZR-COVERAGE-001",
      summary:
        "PostgreSQL and Redis persistence are not exercised by the source harness.",
      retireBy: "PR-12",
    },
    {
      id: "ZR-COVERAGE-002",
      summary:
        "Cancellation, timeout, crash, restart, backup, and restore are not fully exercised.",
      retireBy: "PR-12",
    },
    {
      id: "ZR-COVERAGE-003",
      summary:
        "LiteLLM, inference, Firecrawl, proxy, observability, and appliance stores require candidate-runtime evidence.",
      retireBy: "PR-12",
    },
  ]

  if (
    JSON.stringify(Object.keys(register).sort()) !==
      JSON.stringify(expectedRegisterKeys) ||
    register.schemaVersion !== 1 ||
    register.scope !== "pr01-source-characterization" ||
    register.overallVerdict !== "PR01_SOURCE_CHARACTERIZATION_INCOMPLETE" ||
    register.runtimeZeroRetentionCompliance !== "NOT_EVALUATED" ||
    register.d2aRcRetentionEvidence !== "NOT_DUE" ||
    JSON.stringify(register.sourceRetentionContract) !==
      JSON.stringify({
        scope: "public-inference-data-plane",
        workloadContentPersistence: false,
        metadataOnly: true,
        runtimeQualificationOwner: "PR-12",
      })
  ) {
    errors.push("retention characterization overstates PR-01 evidence")
  }
  if (
    JSON.stringify(register.requiredTerminalStates) !==
      JSON.stringify(requiredTerminalStates) ||
    JSON.stringify(register.requiredSourceScenarios) !==
      JSON.stringify(requiredSourceScenarios) ||
    JSON.stringify(register.requiredArtifactClasses) !==
      JSON.stringify(requiredSourceArtifactClasses)
  ) {
    errors.push("retention scenario or artifact contract changed")
  }
  if (
    JSON.stringify(register.sourceCoverage) !==
    JSON.stringify(expectedSourceCoverage)
  ) {
    errors.push("retention source-coverage register changed")
  }
  if (
    JSON.stringify(register.legacyGaps) !== JSON.stringify(expectedLegacyGaps)
  ) {
    errors.push("retention legacy-gap register changed")
  }
  const serialized = JSON.stringify(register).toLocaleUpperCase("en-US")
  for (const prohibitedClaim of [
    "ZERO_RETENTION_PASS",
    "CERTIFIED",
    '"COMPLIANT"',
  ]) {
    if (serialized.includes(prohibitedClaim)) {
      errors.push(`prohibited retention claim ${prohibitedClaim}`)
    }
  }

  return errors.sort()
}

export function extractBffRoutes({ root, paths }) {
  const routeFiles = paths.filter(
    (path) =>
      bffProductionSourcePattern.test(path) &&
      !/\.(?:test|spec)\.(?:cjs|cts|js|jsx|mjs|mts|ts|tsx)$/.test(path) &&
      !/\.d\.(?:cts|mts|ts)$/.test(path) &&
      isRegularFile(resolve(root, path)),
  )
  const routes = []

  for (const path of routeFiles) {
    const source = readFileSync(resolve(root, path), "utf8")
    const sourceFile = ts.createSourceFile(
      path,
      source,
      ts.ScriptTarget.Latest,
      true,
      scriptKindForPath(path),
    )
    if (sourceFile.parseDiagnostics.length > 0) {
      throw routeAnalysisError(
        path,
        sourceFile,
        sourceFile.parseDiagnostics[0]?.start ?? 0,
        "TypeScript syntax error",
      )
    }

    assertNoDynamicCodeLoading(path, sourceFile)
    assertReviewedFastifyImports(path, sourceFile)
    assertReviewedFastifyFactoryUse(path, sourceFile)
    assertReviewedBuildServerDefinition(path, sourceFile)
    assertReviewedFastifyRegistrarDefinition(path, sourceFile)
    const receiverNames = collectFastifyReceiverNames(sourceFile)
    const importedBindings = collectNamedImportBindings(sourceFile)
    const staticStrings = collectStaticStringConstants(sourceFile)
    assertNoRouteMethodAliases(
      path,
      sourceFile,
      receiverNames,
      importedBindings,
    )

    const visit = (node) => {
      if (ts.isCallExpression(node)) {
        const registrations = parseRouteCall({
          path,
          sourceFile,
          call: node,
          receiverNames,
          staticStrings,
        })
        for (const registration of registrations) {
          routes.push({
            surface: "bff",
            method: registration.method,
            path: registration.path,
            source: path,
            classification: classifyBffRoute(path, registration.path),
          })
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sourceFile)
  }

  return routes
}

function assertNoDynamicCodeLoading(path, sourceFile) {
  const visit = (node) => {
    const callTarget = ts.isCallExpression(node)
      ? unwrapExpression(node.expression)
      : null
    const constructorTarget = ts.isNewExpression(node)
      ? unwrapExpression(node.expression)
      : null
    if (
      (callTarget &&
        ((ts.isIdentifier(callTarget) &&
          ["eval", "require"].includes(callTarget.text)) ||
          callTarget.kind === ts.SyntaxKind.ImportKeyword)) ||
      (constructorTarget &&
        ts.isIdentifier(constructorTarget) &&
        constructorTarget.text === "Function")
    ) {
      throw routeAnalysisError(
        path,
        sourceFile,
        node,
        "Dynamic code loading is not allowed in the BFF production closure",
      )
    }
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      ["module", "node:module"].includes(node.moduleSpecifier.text) &&
      node.importClause?.namedBindings &&
      ts.isNamedImports(node.importClause.namedBindings) &&
      node.importClause.namedBindings.elements.some(
        (specifier) =>
          (specifier.propertyName?.text ?? specifier.name.text) ===
          "createRequire",
      )
    ) {
      throw routeAnalysisError(
        path,
        sourceFile,
        node,
        "Dynamic CommonJS loader creation is not allowed in the BFF production closure",
      )
    }
    if (
      ts.isCallExpression(node) &&
      (node.arguments ?? []).some((argument) => {
        const value = staticString(argument)
        return value === "fastify" || value?.startsWith("fastify/")
      })
    ) {
      throw routeAnalysisError(
        path,
        sourceFile,
        node,
        "Dynamic Fastify loading is not allowed in the BFF production closure",
      )
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
}

function assertReviewedFastifyImports(path, sourceFile) {
  for (const statement of sourceFile.statements) {
    if (
      (ts.isExportDeclaration(statement) &&
        statement.moduleSpecifier &&
        ts.isStringLiteral(statement.moduleSpecifier) &&
        (statement.moduleSpecifier.text === "fastify" ||
          statement.moduleSpecifier.text.startsWith("fastify/"))) ||
      (ts.isImportEqualsDeclaration(statement) &&
        ts.isExternalModuleReference(statement.moduleReference) &&
        statement.moduleReference.expression &&
        ts.isStringLiteral(statement.moduleReference.expression) &&
        (statement.moduleReference.expression.text === "fastify" ||
          statement.moduleReference.expression.text.startsWith("fastify/")))
    ) {
      throw routeAnalysisError(
        path,
        sourceFile,
        statement,
        "Unreviewed Fastify re-export or import-equals",
      )
    }
  }
  const fastifyImports = sourceFile.statements.filter(
    (statement) =>
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      (statement.moduleSpecifier.text === "fastify" ||
        statement.moduleSpecifier.text.startsWith("fastify/")),
  )
  if (fastifyImports.length === 0) {
    return
  }
  const deepImport = fastifyImports.find(
    (statement) => statement.moduleSpecifier.text !== "fastify",
  )
  if (deepImport) {
    throw routeAnalysisError(
      path,
      sourceFile,
      deepImport,
      "Unreviewed Fastify subpath import",
    )
  }
  if (!reviewedFastifySourcePaths.has(path) || fastifyImports.length !== 1) {
    throw routeAnalysisError(
      path,
      sourceFile,
      fastifyImports[0],
      "Unreviewed Fastify import",
    )
  }

  const importDeclaration = fastifyImports[0]
  const importClause = importDeclaration.importClause
  if (!importClause) {
    throw routeAnalysisError(
      path,
      sourceFile,
      importDeclaration,
      "Unreviewed Fastify side-effect import",
    )
  }
  if (path === "apps/bff/src/index.ts") {
    const namedBindings = importClause.namedBindings
    const namedImports =
      namedBindings && ts.isNamedImports(namedBindings)
        ? namedBindings.elements
        : []
    const namedImportNames = namedImports.map(({ name }) => name.text)
    const reviewedNamedImportSets = [
      ["FastifyInstance"],
      [
        "FastifyInstance",
        "FastifyReply",
        "FastifyRequest",
        "HookHandlerDoneFunction",
      ],
    ]
    if (
      importClause.isTypeOnly ||
      importClause.name?.text !== "Fastify" ||
      !reviewedNamedImportSets.some(
        (expected) =>
          JSON.stringify(namedImportNames) === JSON.stringify(expected),
      ) ||
      namedImports.some(
        (specifier) => !specifier.isTypeOnly || specifier.propertyName,
      )
    ) {
      throw routeAnalysisError(
        path,
        sourceFile,
        importDeclaration,
        "Fastify runtime import changed",
      )
    }
    return
  }
  const namedBindings = importClause.namedBindings
  const specifierTypeOnly =
    namedBindings &&
    ts.isNamedImports(namedBindings) &&
    namedBindings.elements.length > 0 &&
    namedBindings.elements.every((specifier) => specifier.isTypeOnly)
  if (importClause.name || (!importClause.isTypeOnly && !specifierTypeOnly)) {
    throw routeAnalysisError(
      path,
      sourceFile,
      importDeclaration,
      "Fastify may only be type-imported outside the BFF entrypoint",
    )
  }
}

function assertReviewedFastifyFactoryUse(path, sourceFile) {
  if (path !== "apps/bff/src/index.ts") {
    return
  }
  let reviewedCalls = 0
  const visit = (node) => {
    if (
      ts.isIdentifier(node) &&
      node.text === "Fastify" &&
      isValueIdentifier(node)
    ) {
      const call = node.parent
      const declaration = call?.parent
      const declarationList = declaration?.parent
      const statement = declarationList?.parent
      const block = statement?.parent
      const buildServer = block?.parent
      const reviewed =
        call &&
        ts.isCallExpression(call) &&
        unwrapExpression(call.expression) === node &&
        call.arguments.length === 1 &&
        declaration &&
        ts.isVariableDeclaration(declaration) &&
        declaration.initializer === call &&
        ts.isIdentifier(declaration.name) &&
        declaration.name.text === "server" &&
        isConstVariableDeclaration(declaration) &&
        statement &&
        ts.isVariableStatement(statement) &&
        block &&
        ts.isBlock(block) &&
        buildServer &&
        ts.isFunctionDeclaration(buildServer) &&
        buildServer.name?.text === "buildServer" &&
        isReviewedFastifyFactoryOptions(call.arguments[0], sourceFile)
      if (!reviewed) {
        throw routeAnalysisError(
          path,
          sourceFile,
          node,
          "Fastify factory may only create the reviewed buildServer instance",
        )
      }
      reviewedCalls += 1
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  if (reviewedCalls !== 1) {
    throw new Error("Reviewed Fastify factory must be called exactly once")
  }
}

function isReviewedFastifyFactoryOptions(node, sourceFile) {
  const options = unwrapExpression(node)
  if (
    !options ||
    !ts.isObjectLiteralExpression(options) ||
    options.properties.some((property) => ts.isSpreadAssignment(property))
  ) {
    return false
  }
  const properties = new Map()
  for (const property of options.properties) {
    if (!ts.isPropertyAssignment(property)) {
      return false
    }
    const name = staticPropertyName(property.name)
    if (!name || properties.has(name)) {
      return false
    }
    properties.set(name, unwrapExpression(property.initializer))
  }
  const bodyLimit = properties.get("bodyLimit")
  const disableRequestLogging = properties.get("disableRequestLogging")
  const logger = properties.get("logger")
  const reviewedBodyLimit = Boolean(
    bodyLimit &&
      ts.isCallExpression(bodyLimit) &&
      ts.isIdentifier(unwrapExpression(bodyLimit.expression)) &&
      unwrapExpression(bodyLimit.expression).text === "bffBodyLimitBytes" &&
      bodyLimit.arguments.length === 0,
  )
  return Boolean(
    (properties.size === 2 &&
      reviewedBodyLimit &&
      logger?.kind === ts.SyntaxKind.TrueKeyword) ||
      (properties.size === 3 &&
        reviewedBodyLimit &&
        disableRequestLogging?.kind === ts.SyntaxKind.TrueKeyword &&
        logger &&
        normalizedNodeText(logger, sourceFile) ===
          "{serializers:{req:queryFreeRequestLogSerializer},...(testRuntime&&options.testLoggerStream?{stream:options.testLoggerStream}:{}),}"),
  )
}

function assertReviewedBuildServerDefinition(path, sourceFile) {
  if (path !== "apps/bff/src/index.ts") {
    return
  }
  const definitions = sourceFile.statements.filter(
    (statement) =>
      ts.isFunctionDeclaration(statement) &&
      statement.name?.text === "buildServer" &&
      statement.modifiers?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
      ),
  )
  const definition = definitions[0]
  const optionsParameter = definition?.parameters[0]
  const hasReviewedOptionsParameter =
    definition?.parameters.length === 0 ||
    Boolean(
      definition?.parameters.length === 1 &&
        optionsParameter &&
        ts.isIdentifier(optionsParameter.name) &&
        optionsParameter.name.text === "options" &&
        optionsParameter.type &&
        ts.isTypeReferenceNode(optionsParameter.type) &&
        ts.isIdentifier(optionsParameter.type.typeName) &&
        optionsParameter.type.typeName.text === "BuildServerOptions" &&
        optionsParameter.initializer &&
        ts.isObjectLiteralExpression(optionsParameter.initializer) &&
        optionsParameter.initializer.properties.length === 0,
    )
  if (
    definitions.length !== 1 ||
    !definition?.body ||
    !hasReviewedOptionsParameter
  ) {
    throw routeAnalysisError(
      path,
      sourceFile,
      definition ?? sourceFile,
      "Reviewed buildServer definition changed",
    )
  }
  const importedNames = new Set([
    ...reviewedFastifyRegistrarSpecs.map(({ exportName }) => exportName),
    "observabilityMetricsRouteOptionsFromRuntime",
  ])
  const visit = (node) => {
    if (
      ts.isIdentifier(node) &&
      importedNames.has(node.text) &&
      isShadowingBindingIdentifier(node)
    ) {
      throw routeAnalysisError(
        path,
        sourceFile,
        node,
        `Reviewed Fastify registrar binding may not be shadowed ${node.text}`,
      )
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
}

function assertReviewedFastifyRegistrarDefinition(path, sourceFile) {
  const spec = reviewedFastifyRegistrarSpecs.find(
    ({ sourcePath }) => sourcePath === path,
  )
  if (!spec) {
    return
  }
  const definitions = sourceFile.statements.filter(
    (statement) =>
      ts.isFunctionDeclaration(statement) &&
      statement.name?.text === spec.exportName &&
      statement.modifiers?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
      ),
  )
  const definition = definitions[0]
  const parameter = definition?.parameters[0]
  const optionsParameter = definition?.parameters[1]
  const routeHostTypes = collectRouteHostTypeNames(sourceFile)
  const hasReviewedOptionsParameter = spec.optionsParameterType
    ? Boolean(
        optionsParameter &&
          ts.isIdentifier(optionsParameter.name) &&
          optionsParameter.name.text === "options" &&
          optionsParameter.type &&
          ts.isTypeReferenceNode(optionsParameter.type) &&
          ts.isIdentifier(optionsParameter.type.typeName) &&
          optionsParameter.type.typeName.text === spec.optionsParameterType &&
          (spec.optionsInitializer === null
            ? !optionsParameter.initializer
            : normalizedNodeText(optionsParameter.initializer, sourceFile) ===
              spec.optionsInitializer),
      )
    : !optionsParameter
  if (
    definitions.length !== 1 ||
    !definition?.body ||
    definition.parameters.length !== (spec.optionsParameterType ? 2 : 1) ||
    !parameter ||
    !ts.isIdentifier(parameter.name) ||
    !isRouteHostType(parameter.type, sourceFile, routeHostTypes) ||
    !hasReviewedOptionsParameter
  ) {
    throw routeAnalysisError(
      path,
      sourceFile,
      definition ?? sourceFile,
      `Reviewed Fastify registrar definition changed for ${spec.exportName}`,
    )
  }
}

function collectNamedImportBindings(sourceFile) {
  const bindings = new Map()
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !statement.importClause?.namedBindings ||
      !ts.isNamedImports(statement.importClause.namedBindings)
    ) {
      continue
    }
    for (const specifier of statement.importClause.namedBindings.elements) {
      bindings.set(specifier.name.text, {
        importSource: statement.moduleSpecifier.text,
        importedName: specifier.propertyName?.text ?? specifier.name.text,
      })
    }
  }
  return bindings
}

export function extractFastifyRegistrarManifest({ root, paths }) {
  const indexPath = "apps/bff/src/index.ts"
  if (!paths.includes(indexPath) || !isRegularFile(resolve(root, indexPath))) {
    throw new Error(`Missing reviewed BFF entrypoint ${indexPath}`)
  }
  const sourceFile = ts.createSourceFile(
    indexPath,
    readFileSync(resolve(root, indexPath), "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )
  if (sourceFile.parseDiagnostics.length > 0) {
    throw routeAnalysisError(
      indexPath,
      sourceFile,
      sourceFile.parseDiagnostics[0]?.start ?? 0,
      "TypeScript syntax error",
    )
  }
  assertNoDynamicCodeLoading(indexPath, sourceFile)
  assertReviewedFastifyImports(indexPath, sourceFile)
  assertReviewedFastifyFactoryUse(indexPath, sourceFile)
  assertReviewedBuildServerDefinition(indexPath, sourceFile)
  const receiverNames = collectFastifyReceiverNames(sourceFile)
  const importedBindings = collectNamedImportBindings(sourceFile)
  assertReviewedPr05RuntimeAuthorityWiring(
    indexPath,
    sourceFile,
    importedBindings,
  )
  const candidates = new Set(paths)
  const entries = []
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const callee = unwrapExpression(node.expression)
      const localName = ts.isIdentifier(callee) ? callee.text : null
      const binding = localName ? importedBindings.get(localName) : null
      const spec = reviewedFastifyRegistrarSpecs.find(
        ({ exportName, importSource }) =>
          exportName === binding?.importedName &&
          importSource === binding?.importSource &&
          localName === exportName,
      )
      if (
        spec &&
        isReviewedFastifyRegistrarCall({
          path: indexPath,
          sourceFile,
          call: node,
          receiverNames,
          importedBindings,
        })
      ) {
        if (!candidates.has(spec.sourcePath)) {
          // Partial historical fixtures intentionally supply only their reviewed
          // candidate paths. Live target verification compares the resulting
          // manifest against the exact current registrar contract.
          return
        }
        entries.push({
          exportName: spec.exportName,
          importSource: spec.importSource,
          sourcePath: spec.sourcePath,
        })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)

  const counts = new Map()
  for (const entry of entries) {
    counts.set(entry.exportName, (counts.get(entry.exportName) ?? 0) + 1)
  }
  for (const [exportName, count] of counts) {
    if (count !== 1) {
      throw new Error(
        `Reviewed Fastify registrar must be called exactly once ${exportName}`,
      )
    }
  }
  return entries.sort((left, right) =>
    left.exportName.localeCompare(right.exportName),
  )
}

function assertReviewedPr05RuntimeAuthorityWiring(
  path,
  sourceFile,
  importedBindings,
) {
  const authorizationBinding = importedBindings.get("registerAuthorization")
  if (
    authorizationBinding?.importedName !== "registerAuthorization" ||
    authorizationBinding.importSource !== "./auth/authorization"
  ) {
    return
  }

  const requiredImports = [
    ["createRuntimeAuthorizationOptions", "./auth/runtime-live-authority"],
    ["createTestFixtureAuthorizationOptions", "./auth/runtime-live-authority"],
    ["emergencyRecoveryServiceFromRuntime", "./services/emergency-recovery"],
  ]
  const consoleSessionRegistrar = importedBindings.get(
    "registerConsoleSessionRoutes",
  )
  const usesConsoleSessionAuthority = Boolean(
    consoleSessionRegistrar?.importedName === "registerConsoleSessionRoutes" &&
      consoleSessionRegistrar.importSource === "./routes/console-session",
  )
  if (usesConsoleSessionAuthority) {
    requiredImports.push(
      ["getInferenceCoreDb", "./db/inference-core-client"],
      [
        "createConsoleSessionRuntimeFromEnv",
        "./services/console-session-runtime",
      ],
    )
  }
  for (const [name, importSource] of requiredImports) {
    const binding = importedBindings.get(name)
    if (
      binding?.importedName !== name ||
      binding.importSource !== importSource
    ) {
      throw routeAnalysisError(
        path,
        sourceFile,
        sourceFile,
        `PR-05 runtime authority import changed for ${name}`,
      )
    }
  }

  const buildServer = sourceFile.statements.find(
    (statement) =>
      ts.isFunctionDeclaration(statement) &&
      statement.name?.text === "buildServer",
  )
  const expectedInitializers = new Map([
    ["testRuntime", 'process.env.NODE_ENV==="test"'],
    [
      "emergencyRecoveryService",
      "testRuntime&&options.testEmergencyRecoveryService!==undefined?options.testEmergencyRecoveryService:emergencyRecoveryServiceFromRuntime()",
    ],
    [
      "authorizationOptions",
      usesConsoleSessionAuthority
        ? "testRuntime?(options.testAuthorization??createTestFixtureAuthorizationOptions(emergencyRecoveryService,consoleSessionRouteOptions?.service,)):createRuntimeAuthorizationOptions(emergencyRecoveryService,requiredConsoleSessionRuntime(consoleSessionRuntime).service,)"
        : "testRuntime?(options.testAuthorization??createTestFixtureAuthorizationOptions(emergencyRecoveryService)):createRuntimeAuthorizationOptions(emergencyRecoveryService)",
    ],
  ])
  if (usesConsoleSessionAuthority) {
    expectedInitializers.set(
      "consoleSessionRuntime",
      "testRuntime?null:createConsoleSessionRuntimeFromEnv({database:getInferenceCoreDb(),})",
    )
    expectedInitializers.set(
      "consoleSessionRouteOptions",
      "testRuntime?options.testConsoleSessionRouteOptions:consoleSessionRuntime?.routeOptions",
    )
    const requiredRuntime = sourceFile.statements.find(
      (statement) =>
        ts.isFunctionDeclaration(statement) &&
        statement.name?.text === "requiredConsoleSessionRuntime",
    )
    if (
      !requiredRuntime ||
      normalizedNodeText(requiredRuntime, sourceFile) !==
        'functionrequiredConsoleSessionRuntime(runtime:ConsoleSessionRuntime|null,):ConsoleSessionRuntime{if(!runtime){thrownewError("DurableConsolesessionruntimeisunavailable.")}returnruntime}'
    ) {
      throw routeAnalysisError(
        path,
        sourceFile,
        requiredRuntime ?? sourceFile,
        "R1-S1 required Console session runtime binding changed",
      )
    }
  }
  for (const [name, initializer] of expectedInitializers) {
    const declarations = []
    const visit = (node) => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === name
      ) {
        declarations.push(node)
      }
      ts.forEachChild(node, visit)
    }
    if (buildServer?.body) {
      visit(buildServer.body)
    }
    const declaration = declarations[0]
    const directStatement = declaration?.parent?.parent
    if (
      declarations.length !== 1 ||
      !declaration?.initializer ||
      !isConstVariableDeclaration(declaration) ||
      !directStatement ||
      !ts.isVariableStatement(directStatement) ||
      directStatement.parent !== buildServer?.body ||
      normalizedNodeText(declaration.initializer, sourceFile) !== initializer
    ) {
      throw routeAnalysisError(
        path,
        sourceFile,
        declaration ?? buildServer ?? sourceFile,
        `PR-05 runtime authority binding changed for ${name}`,
      )
    }
  }

  const protectedBindings = new Set([
    "createRuntimeAuthorizationOptions",
    "createTestFixtureAuthorizationOptions",
    "emergencyRecoveryServiceFromRuntime",
    ...(usesConsoleSessionAuthority
      ? ["createConsoleSessionRuntimeFromEnv", "getInferenceCoreDb"]
      : []),
    "process",
  ])
  const visit = (node) => {
    if (
      ts.isIdentifier(node) &&
      protectedBindings.has(node.text) &&
      isShadowingBindingIdentifier(node)
    ) {
      throw routeAnalysisError(
        path,
        sourceFile,
        node,
        `PR-05 runtime authority binding may not be shadowed ${node.text}`,
      )
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
}

function collectFastifyReceiverNames(sourceFile) {
  const names = new Set()
  const aliases = []
  const locallyDeclaredRouteHostTypes = collectRouteHostTypeNames(sourceFile)

  const visit = (node) => {
    if (
      ts.isParameter(node) &&
      ts.isIdentifier(node.name) &&
      isRouteHostType(node.type, sourceFile, locallyDeclaredRouteHostTypes)
    ) {
      names.add(node.name.text)
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      if (isFastifyFactoryCall(node.initializer)) {
        names.add(node.name.text)
      } else if (node.initializer && ts.isIdentifier(node.initializer)) {
        aliases.push([node.name.text, node.initializer.text])
      }
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(node.left) &&
      ts.isIdentifier(node.right)
    ) {
      aliases.push([node.left.text, node.right.text])
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)

  let changed = true
  while (changed) {
    changed = false
    for (const [alias, subject] of aliases) {
      if (names.has(subject) && !names.has(alias)) {
        names.add(alias)
        changed = true
      }
    }
  }
  return names
}

function collectRouteHostTypeNames(sourceFile) {
  const names = new Set()
  const visit = (node) => {
    if (
      (ts.isInterfaceDeclaration(node) ||
        ts.isClassDeclaration(node) ||
        ts.isTypeAliasDeclaration(node)) &&
      node.name &&
      containsRouteHostMember(node)
    ) {
      names.add(node.name.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return names
}

function containsRouteHostMember(node) {
  const members = ts.isTypeAliasDeclaration(node)
    ? ts.isTypeLiteralNode(node.type)
      ? node.type.members
      : []
    : node.members
  return members.some((member) => {
    const name = member.name ? staticPropertyName(member.name) : null
    return Boolean(
      name &&
        isCallableRouteHostMember(member) &&
        (routeMethods.includes(name) ||
          name === "route" ||
          unsupportedFastifyMethods.has(name) ||
          controlledFastifyMethods.has(name)),
    )
  })
}

function isCallableRouteHostMember(member) {
  return (
    ts.isMethodSignature(member) ||
    ts.isMethodDeclaration(member) ||
    ((ts.isPropertySignature(member) || ts.isPropertyDeclaration(member)) &&
      Boolean(member.type && ts.isFunctionTypeNode(member.type)))
  )
}

function isRouteHostType(node, sourceFile, locallyDeclaredRouteHostTypes) {
  const text = node?.getText(sourceFile) ?? ""
  return (
    /(?:FastifyInstance|RouteHost|Router|(?:Endpoint|Http|Route)\w*(?:Host|Router|Server))/.test(
      text,
    ) ||
    [...locallyDeclaredRouteHostTypes].some((name) =>
      new RegExp(`\\b${name}\\b`).test(text),
    ) ||
    (node && ts.isTypeLiteralNode(node) && containsRouteHostMember(node))
  )
}

function assertNoRouteMethodAliases(
  path,
  sourceFile,
  receiverNames,
  importedBindings,
) {
  const visit = (node) => {
    if (
      ts.isIdentifier(node) &&
      receiverNames.has(node.text) &&
      isValueIdentifier(node) &&
      !isReviewedFastifyReceiverUse({
        path,
        sourceFile,
        node,
        receiverNames,
        importedBindings,
      })
    ) {
      throw routeAnalysisError(
        path,
        sourceFile,
        node,
        "Unreviewed Fastify instance value use",
      )
    }
    if (ts.isCallExpression(node)) {
      const receiverArguments = node.arguments.filter((argument) =>
        containsKnownFastifyReceiver(argument, receiverNames),
      )
      if (
        receiverArguments.length > 0 &&
        !isReviewedFastifyRegistrarCall({
          path,
          sourceFile,
          call: node,
          receiverNames,
          importedBindings,
        }) &&
        !isReviewedEmergencyIsolationOnReadyHook(
          path,
          sourceFile,
          node,
          receiverNames,
        )
      ) {
        throw routeAnalysisError(
          path,
          sourceFile,
          receiverArguments[0],
          "Fastify instance may not escape to an unreviewed call",
        )
      }

      const member = staticMemberCall(unwrapExpression(node.expression))
      if (
        member &&
        isTrackedFastifyReceiver(member.receiver, receiverNames) &&
        !routeMethods.includes(member.name) &&
        member.name !== "route" &&
        !unsupportedFastifyMethods.has(member.name) &&
        !controlledFastifyMethods.has(member.name) &&
        !isReviewedFastifyListenCall(path, node, member)
      ) {
        throw routeAnalysisError(
          path,
          sourceFile,
          node,
          `Unreviewed Fastify instance method ${member.name}`,
        )
      }
    }
    if (
      ts.isNewExpression(node) &&
      (node.arguments ?? []).some((argument) =>
        containsKnownFastifyReceiver(argument, receiverNames),
      )
    ) {
      throw routeAnalysisError(
        path,
        sourceFile,
        node,
        "Fastify instance may not escape to a constructor",
      )
    }
    if (
      ts.isTaggedTemplateExpression(node) &&
      containsKnownFastifyReceiver(node.template, receiverNames)
    ) {
      throw routeAnalysisError(
        path,
        sourceFile,
        node,
        "Fastify instance may not escape through a tagged template",
      )
    }
    if (
      ts.isReturnStatement(node) &&
      node.expression &&
      containsKnownFastifyReceiver(node.expression, receiverNames) &&
      !isReviewedBuildServerReturn(path, node, receiverNames)
    ) {
      throw routeAnalysisError(
        path,
        sourceFile,
        node,
        "Fastify instance may only be returned from buildServer",
      )
    }
    if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      containsKnownFastifyReceiver(node.initializer, receiverNames) &&
      !isReviewedFastifyAlias(path, node, receiverNames)
    ) {
      throw routeAnalysisError(
        path,
        sourceFile,
        node,
        "Fastify instance may not be captured",
      )
    }
    if (
      ts.isBinaryExpression(node) &&
      ts.isAssignmentOperator(node.operatorToken.kind) &&
      containsKnownFastifyReceiver(node.right, receiverNames)
    ) {
      throw routeAnalysisError(
        path,
        sourceFile,
        node,
        "Fastify instance may not be assigned to an external target",
      )
    }
    if (
      ((ts.isExportAssignment(node) &&
        containsKnownFastifyReceiver(node.expression, receiverNames)) ||
        (ts.isYieldExpression(node) &&
          node.expression &&
          containsKnownFastifyReceiver(node.expression, receiverNames)) ||
        (ts.isExportSpecifier(node) &&
          receiverNames.has((node.propertyName ?? node.name).text))) &&
      !ts.isReturnStatement(node)
    ) {
      throw routeAnalysisError(
        path,
        sourceFile,
        node,
        "Fastify instance may not be exported or yielded",
      )
    }
    if (
      ts.isElementAccessExpression(node) &&
      isKnownFastifyReceiver(node.expression, receiverNames) &&
      staticString(node.argumentExpression) === null
    ) {
      throw routeAnalysisError(
        path,
        sourceFile,
        node,
        "Dynamic Fastify property access is not allowed",
      )
    }
    const rawServer = staticMemberCall(node)
    if (
      rawServer?.name === "server" &&
      isKnownFastifyReceiver(rawServer.receiver, receiverNames)
    ) {
      throw routeAnalysisError(
        path,
        sourceFile,
        node,
        "Fastify raw server access is not allowed",
      )
    }
    if (
      isRouteMethodReference(node, receiverNames) &&
      !(
        ts.isCallExpression(node.parent) &&
        unwrapExpression(node.parent.expression) === node
      )
    ) {
      throw routeAnalysisError(
        path,
        sourceFile,
        node,
        "Fastify route methods may only be used as direct registration callees",
      )
    }
    if (
      ts.isCallExpression(node) &&
      isIndirectRouteMethodInvocation(node.expression, receiverNames)
    ) {
      throw routeAnalysisError(
        path,
        sourceFile,
        node,
        "Fastify route methods may not use call, apply, or bind",
      )
    }
    if (ts.isVariableDeclaration(node) && node.initializer) {
      if (
        ts.isIdentifier(node.name) &&
        isRouteMethodReference(node.initializer, receiverNames)
      ) {
        throw routeAnalysisError(
          path,
          sourceFile,
          node,
          "Fastify route methods may not be extracted or bound",
        )
      }
      if (
        ts.isObjectBindingPattern(node.name) &&
        isKnownFastifyReceiver(node.initializer, receiverNames)
      ) {
        for (const element of node.name.elements) {
          const propertyName = element.propertyName ?? element.name
          const method = staticPropertyName(propertyName)
          if (
            method &&
            (routeMethods.includes(method) ||
              method === "route" ||
              method === "server" ||
              unsupportedFastifyMethods.has(method) ||
              controlledFastifyMethods.has(method))
          ) {
            throw routeAnalysisError(
              path,
              sourceFile,
              element,
              "Fastify route methods may not be destructured",
            )
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
}

function isReviewedFastifyReceiverUse({
  path,
  sourceFile,
  node,
  receiverNames,
  importedBindings,
}) {
  if (isReviewedEmergencyIsolationBootstrapLogUse(path, sourceFile, node)) {
    return true
  }
  const parent = node.parent
  if (
    ts.isVariableDeclaration(parent) &&
    parent.initializer === node &&
    isReviewedFastifyAlias(path, parent, receiverNames)
  ) {
    return true
  }
  if (
    ts.isReturnStatement(parent) &&
    parent.expression === node &&
    isReviewedBuildServerReturn(path, parent, receiverNames)
  ) {
    return true
  }
  if (
    ts.isCallExpression(parent) &&
    parent.arguments.some((argument) => argument === node) &&
    isReviewedFastifyRegistrarCall({
      path,
      sourceFile,
      call: parent,
      receiverNames,
      importedBindings,
    })
  ) {
    return true
  }

  let expression = node
  while (
    expression.parent &&
    isExpressionWrapper(expression.parent) &&
    expression.parent.expression === expression
  ) {
    expression = expression.parent
  }
  const member = expression.parent
  if (
    member &&
    (ts.isPropertyAccessExpression(member) ||
      ts.isElementAccessExpression(member)) &&
    member.expression === expression &&
    ts.isCallExpression(member.parent) &&
    unwrapExpression(member.parent.expression) === member
  ) {
    return true
  }
  return false
}

function isReviewedEmergencyIsolationBootstrapLogUse(path, sourceFile, node) {
  if (path !== "apps/bff/src/index.ts") {
    return false
  }
  const logMember = node.parent
  const warnMember = logMember?.parent
  const logCall = warnMember?.parent
  if (
    !logMember ||
    !ts.isPropertyAccessExpression(logMember) ||
    logMember.expression !== node ||
    logMember.name.text !== "log" ||
    !warnMember ||
    !ts.isPropertyAccessExpression(warnMember) ||
    warnMember.expression !== logMember ||
    warnMember.name.text !== "warn" ||
    !logCall ||
    !ts.isCallExpression(logCall) ||
    unwrapExpression(logCall.expression) !== warnMember ||
    normalizedNodeText(logCall, sourceFile) !==
      'server.log.warn({failureClass:"emergency_isolation_bootstrap_failed"},"Emergencyisolationremainssealed",)'
  ) {
    return false
  }
  let ancestor = logCall.parent
  while (ancestor && !ts.isArrowFunction(ancestor)) {
    ancestor = ancestor.parent
  }
  const hookCall = ancestor?.parent
  return Boolean(
    ancestor &&
      hookCall &&
      ts.isCallExpression(hookCall) &&
      isReviewedEmergencyIsolationOnReadyHook(
        path,
        sourceFile,
        hookCall,
        new Set([node.text]),
      ),
  )
}

function isReviewedEmergencyIsolationOnReadyHook(
  path,
  sourceFile,
  call,
  receiverNames,
) {
  const member = staticMemberCall(unwrapExpression(call.expression))
  const handler = unwrapExpression(call.arguments[1])
  return Boolean(
    path === "apps/bff/src/index.ts" &&
      member?.name === "addHook" &&
      isTrackedFastifyReceiver(member.receiver, receiverNames) &&
      staticString(call.arguments[0]) === "onReady" &&
      call.arguments.length === 2 &&
      handler &&
      ts.isArrowFunction(handler) &&
      handler.parameters.length === 0 &&
      handler.modifiers?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword,
      ) &&
      normalizedNodeText(handler, sourceFile).includes(
        "awaitruntimeIsolation.service?.bootstrap()",
      ) &&
      normalizedNodeText(handler, sourceFile).includes(
        'failureClass:"emergency_isolation_bootstrap_failed"',
      ),
  )
}

function isExpressionWrapper(node) {
  return (
    ts.isAsExpression(node) ||
    ts.isParenthesizedExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isTypeAssertionExpression(node)
  )
}

function containsKnownFastifyReceiver(node, receiverNames) {
  let found = false
  const visit = (candidate) => {
    if (found) {
      return
    }
    const subject = unwrapExpression(candidate)
    if (
      ts.isIdentifier(subject) &&
      isValueIdentifier(subject) &&
      isTrackedFastifyReceiver(subject, receiverNames)
    ) {
      found = true
      return
    }
    ts.forEachChild(candidate, visit)
  }
  visit(node)
  return found
}

function isValueIdentifier(node) {
  const parent = node.parent
  if (
    (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
    ((ts.isPropertyAssignment(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isMethodSignature(parent) ||
      ts.isPropertyDeclaration(parent) ||
      ts.isPropertySignature(parent)) &&
      parent.name === node) ||
    (ts.isVariableDeclaration(parent) && parent.name === node) ||
    (ts.isParameter(parent) && parent.name === node) ||
    ts.isImportSpecifier(parent) ||
    ts.isImportClause(parent) ||
    ts.isTypeReferenceNode(parent)
  ) {
    return false
  }
  return true
}

function isReviewedFastifyRegistrarCall({
  path,
  sourceFile,
  call,
  receiverNames,
  importedBindings,
}) {
  const callee = unwrapExpression(call.expression)
  const receiver = unwrapExpression(call.arguments[0])
  if (
    path !== "apps/bff/src/index.ts" ||
    !ts.isIdentifier(callee) ||
    !receiver ||
    !ts.isIdentifier(receiver) ||
    !isTrackedFastifyReceiver(receiver, receiverNames)
  ) {
    return false
  }
  const binding = importedBindings.get(callee.text)
  const spec = reviewedFastifyRegistrarSpecs.find(
    ({ exportName, importSource }) =>
      exportName === binding?.importedName &&
      importSource === binding?.importSource &&
      callee.text === exportName,
  )
  if (!spec) {
    return false
  }
  if (
    !hasReviewedFastifyRegistrarArguments(
      spec,
      call,
      sourceFile,
      importedBindings,
    )
  ) {
    throw routeAnalysisError(
      path,
      sourceFile,
      call,
      `Reviewed Fastify registrar arguments changed for ${spec.exportName}`,
    )
  }
  if (!isReviewedFastifyRegistrarPlacement(spec, call)) {
    throw routeAnalysisError(
      path,
      sourceFile,
      call,
      `Reviewed Fastify registrar placement changed for ${spec.exportName}`,
    )
  }
  return true
}

function hasReviewedFastifyRegistrarArguments(
  spec,
  call,
  sourceFile,
  importedBindings = collectNamedImportBindings(sourceFile),
) {
  if (spec.exportName === "registerAuthorization") {
    const options = unwrapExpression(call.arguments[1])
    return Boolean(
      call.arguments.length === 2 &&
        options &&
        ts.isIdentifier(options) &&
        options.text === "authorizationOptions",
    )
  }
  if (spec.exportName === "registerAdminRoutes") {
    return Boolean(
      call.arguments.length === 2 &&
        normalizedNodeText(call.arguments[1], sourceFile) ===
          "{emergencyIsolationService,emergencyRecoveryService,}",
    )
  }
  if (spec.exportName === "registerAppGatewayRoutes") {
    return Boolean(
      call.arguments.length === 2 &&
        normalizedNodeText(call.arguments[1], sourceFile) ===
          "{isolationGate:isolationTrafficGate}",
    )
  }
  if (spec.exportName === "registerFirecrawlGatewayRoutes") {
    return hasReviewedFirecrawlGatewayRegistrarArguments(call, sourceFile)
  }
  if (spec.exportName === "registerObservabilityMetricsRoutes") {
    const optionsCall = unwrapExpression(call.arguments[1])
    const optionsFactory = optionsCall
      ? unwrapExpression(optionsCall.expression)
      : null
    const binding =
      optionsFactory && ts.isIdentifier(optionsFactory)
        ? importedBindings.get(optionsFactory.text)
        : null
    return Boolean(
      call.arguments.length === 2 &&
        optionsCall &&
        ts.isCallExpression(optionsCall) &&
        optionsCall.arguments.length === 0 &&
        optionsFactory &&
        ts.isIdentifier(optionsFactory) &&
        optionsFactory.text === "observabilityMetricsRouteOptionsFromRuntime" &&
        binding?.importedName ===
          "observabilityMetricsRouteOptionsFromRuntime" &&
        binding.importSource === "./routes/observability-metrics",
    )
  }
  if (spec.exportName === "registerConsoleSessionRoutes") {
    const options = unwrapExpression(call.arguments[1])
    return Boolean(
      call.arguments.length === 2 &&
        options &&
        ts.isIdentifier(options) &&
        options.text === "consoleSessionRouteOptions",
    )
  }
  return call.arguments.length === 1
}

function hasReviewedFirecrawlGatewayRegistrarArguments(call, sourceFile) {
  if (
    call.arguments.length !== 2 ||
    normalizedNodeText(call.arguments[1], sourceFile) !==
      "testRuntime&&options.testFirecrawlGateway?{...firecrawlGateway,...options.testFirecrawlGateway,isolationGate:isolationTrafficGate,}:{...firecrawlGateway,isolationGate:isolationTrafficGate}"
  ) {
    return false
  }
  const statement = call.parent
  const body = statement?.parent
  if (
    !statement ||
    !ts.isExpressionStatement(statement) ||
    !body ||
    !ts.isBlock(body)
  ) {
    return false
  }
  const statementIndex = body.statements.indexOf(statement)
  const declarationStatement = body.statements[statementIndex - 1]
  if (
    !declarationStatement ||
    !ts.isVariableStatement(declarationStatement) ||
    declarationStatement.declarationList.declarations.length !== 1
  ) {
    return false
  }
  const declaration = declarationStatement.declarationList.declarations[0]
  const initializer = unwrapExpression(declaration?.initializer)
  const binding = collectNamedImportBindings(sourceFile).get(
    "firecrawlGatewayOptionsFromRuntime",
  )
  return Boolean(
    declaration &&
      ts.isIdentifier(declaration.name) &&
      declaration.name.text === "firecrawlGateway" &&
      isConstVariableDeclaration(declaration) &&
      initializer &&
      ts.isCallExpression(initializer) &&
      ts.isIdentifier(unwrapExpression(initializer.expression)) &&
      unwrapExpression(initializer.expression).text ===
        "firecrawlGatewayOptionsFromRuntime" &&
      initializer.arguments.length === 0 &&
      binding?.importedName === "firecrawlGatewayOptionsFromRuntime" &&
      binding.importSource === "./services/firecrawl-gateway-runtime",
  )
}

function isDirectBuildServerStatement(call) {
  const statement = call.parent
  const body = statement?.parent
  const declaration = body?.parent
  return Boolean(
    statement &&
      ts.isExpressionStatement(statement) &&
      body &&
      ts.isBlock(body) &&
      declaration &&
      ts.isFunctionDeclaration(declaration) &&
      declaration.name?.text === "buildServer",
  )
}

function isReviewedFastifyRegistrarPlacement(spec, call) {
  if (spec.exportName !== "registerConsoleSessionRoutes") {
    return isDirectBuildServerStatement(call)
  }
  const statement = call.parent
  const guardedBlock = statement?.parent
  const ifStatement = guardedBlock?.parent
  const buildServerBody = ifStatement?.parent
  const declaration = buildServerBody?.parent
  const condition = ifStatement
    ? unwrapExpression(ifStatement.expression)
    : undefined
  return Boolean(
    statement &&
      ts.isExpressionStatement(statement) &&
      guardedBlock &&
      ts.isBlock(guardedBlock) &&
      guardedBlock.statements.length === 1 &&
      ifStatement &&
      ts.isIfStatement(ifStatement) &&
      ifStatement.thenStatement === guardedBlock &&
      ifStatement.elseStatement === undefined &&
      condition &&
      ts.isIdentifier(condition) &&
      condition.text === "consoleSessionRouteOptions" &&
      buildServerBody &&
      ts.isBlock(buildServerBody) &&
      declaration &&
      ts.isFunctionDeclaration(declaration) &&
      declaration.name?.text === "buildServer",
  )
}

function isReviewedFastifyAlias(path, node, receiverNames) {
  const initializer = node.initializer
  if (
    path === "apps/bff/src/index.ts" &&
    ts.isIdentifier(node.name) &&
    node.name.text === "server" &&
    isFastifyFactoryCall(initializer)
  ) {
    return true
  }
  if (
    !ts.isIdentifier(node.name) ||
    !initializer ||
    !ts.isIdentifier(initializer) ||
    !isTrackedFastifyReceiver(initializer, receiverNames) ||
    !isConstVariableDeclaration(node)
  ) {
    return false
  }
  const variableStatement = node.parent?.parent
  return !(
    variableStatement &&
    ts.isVariableStatement(variableStatement) &&
    variableStatement.modifiers?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
    )
  )
}

function isReviewedBuildServerReturn(path, node, receiverNames) {
  const expression = node.expression
  const body = node.parent
  const declaration = body?.parent
  return Boolean(
    path === "apps/bff/src/index.ts" &&
      expression &&
      ts.isIdentifier(expression) &&
      isTrackedFastifyReceiver(expression, receiverNames) &&
      body &&
      ts.isBlock(body) &&
      declaration &&
      ts.isFunctionDeclaration(declaration) &&
      declaration.name?.text === "buildServer",
  )
}

function isReviewedFastifyListenCall(path, call, member) {
  if (
    path !== "apps/bff/src/index.ts" ||
    member.name !== "listen" ||
    call.arguments.length !== 1
  ) {
    return false
  }
  const options = unwrapExpression(call.arguments[0])
  if (!options || !ts.isObjectLiteralExpression(options)) {
    return false
  }
  const keys = options.properties
    .map((property) =>
      property.name ? staticPropertyName(property.name) : null,
    )
    .filter(Boolean)
    .sort()
  return JSON.stringify(keys) === JSON.stringify(["host", "port"])
}

function isIndirectRouteMethodInvocation(node, receiverNames) {
  const member = staticMemberCall(unwrapExpression(node))
  return Boolean(
    member &&
      ["apply", "bind", "call"].includes(member.name) &&
      isRouteMethodReference(member.receiver, receiverNames),
  )
}

function parseRouteCall({
  path,
  sourceFile,
  call,
  receiverNames,
  staticStrings,
}) {
  const member = staticMemberCall(call.expression)
  if (!member) {
    if (
      ts.isElementAccessExpression(call.expression) &&
      isKnownFastifyReceiver(call.expression.expression, receiverNames)
    ) {
      throw routeAnalysisError(
        path,
        sourceFile,
        call.expression,
        "Dynamic Fastify route method is not allowed",
      )
    }
    return []
  }

  const firstArgument = call.arguments[0]
  const literalRoutePath = staticStringWithConstants(
    firstArgument,
    staticStrings,
  )
  const routeOptionsPath =
    member.name === "route"
      ? staticRouteOptionsUrl(firstArgument, staticStrings)
      : null
  const knownReceiver = isKnownFastifyReceiver(member.receiver, receiverNames)
  const unconditionalRouteControl =
    controlledFastifyMethods.has(member.name) ||
    [
      "addHttpMethod",
      "register",
      "setErrorHandler",
      "setNotFoundHandler",
    ].includes(member.name)
  const conservativeRouteModule =
    path === "apps/bff/src/index.ts" || path.startsWith("apps/bff/src/routes/")
  const routeShaped =
    literalRoutePath?.startsWith("/") || routeOptionsPath?.startsWith("/")

  if (
    !knownReceiver &&
    !routeShaped &&
    !unconditionalRouteControl &&
    !(
      conservativeRouteModule &&
      (routeMethods.includes(member.name) || member.name === "route") &&
      firstArgument &&
      staticStringWithConstants(firstArgument, staticStrings) === null
    )
  ) {
    return []
  }
  if (unsupportedFastifyMethods.has(member.name)) {
    throw routeAnalysisError(
      path,
      sourceFile,
      call,
      `Unsupported Fastify route API ${member.name}`,
    )
  }
  if (controlledFastifyMethods.has(member.name)) {
    assertReviewedFastifyControlCall(path, sourceFile, call, member.name)
    return []
  }
  if (routeMethods.includes(member.name)) {
    return [
      parseShorthandRoute(
        path,
        sourceFile,
        call,
        member.name.toUpperCase(),
        staticStrings,
      ),
    ]
  }
  if (member.name === "route") {
    return parseRouteOptions(path, sourceFile, call, staticStrings)
  }
  return []
}

function parseShorthandRoute(path, sourceFile, call, method, staticStrings) {
  const routePath = staticStringWithConstants(call.arguments[0], staticStrings)
  if (!routePath?.startsWith("/")) {
    throw routeAnalysisError(
      path,
      sourceFile,
      call,
      "Fastify shorthand route path must be a static absolute literal",
    )
  }
  assertReviewedShorthandRouteOptions(path, sourceFile, call, method, routePath)
  return { method, path: routePath }
}

function assertReviewedShorthandRouteOptions(
  path,
  sourceFile,
  call,
  method,
  routePath,
) {
  if (call.arguments.length === 2) {
    if (
      path === "apps/bff/src/routes/admin.ts" &&
      routePath.startsWith("/api/admin")
    ) {
      throw routeAnalysisError(
        path,
        sourceFile,
        call,
        "Protected Admin route requires a reviewed authorization policy",
      )
    }
    return
  }
  if (call.arguments.length !== 3) {
    throw routeAnalysisError(
      path,
      sourceFile,
      call,
      "Fastify shorthand route overload changed",
    )
  }
  const options = unwrapExpression(call.arguments[1])
  if (
    path === "apps/bff/src/routes/admin.ts" &&
    options &&
    ts.isCallExpression(options) &&
    ts.isIdentifier(unwrapExpression(options.expression))
  ) {
    const factory = unwrapExpression(options.expression).text
    const argument = staticString(options.arguments[0])
    if (
      factory === "withCapability" &&
      options.arguments.length === 1 &&
      argument &&
      reviewedAdminRouteCapabilities.has(argument)
    ) {
      return
    }
    if (
      factory === "reviewedAdminOnly" &&
      options.arguments.length === 1 &&
      argument === `${method} ${routePath}` &&
      pr10cAdminOnlyRoutePolicyKeys.includes(argument)
    ) {
      return
    }
  }
  if (
    path === "apps/bff/src/routes/firecrawl-gateway.ts" &&
    method === "POST" &&
    ["/v2/search", "/v2/scrape"].includes(routePath) &&
    options &&
    ts.isIdentifier(options) &&
    options.text === "routeOptions" &&
    hasReviewedFirecrawlRouteOptions(sourceFile)
  ) {
    return
  }
  if (
    !options ||
    !ts.isObjectLiteralExpression(options) ||
    options.properties.some((property) => ts.isSpreadAssignment(property))
  ) {
    throw routeAnalysisError(
      path,
      sourceFile,
      call.arguments[1],
      "Fastify shorthand route options must be reviewed inline options",
    )
  }
  assertNoFastifyRouteConstraints(path, sourceFile, options)
}

function hasReviewedFirecrawlRouteOptions(sourceFile) {
  const declarations = []
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "routeOptions" &&
      node.initializer
    ) {
      declarations.push(node)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return Boolean(
    declarations.length === 1 &&
      isConstVariableDeclaration(declarations[0]) &&
      normalizedNodeText(declarations[0].initializer, sourceFile) ===
        '{bodyLimit:FIRECRAWL_REQUEST_BODY_LIMIT_BYTES,errorHandler:firecrawlRouteErrorHandler,logLevel:"silent"asconst,}',
  )
}

function parseRouteOptions(path, sourceFile, call, staticStrings) {
  const options = call.arguments[0]
  if (!options || !ts.isObjectLiteralExpression(options)) {
    throw routeAnalysisError(
      path,
      sourceFile,
      call,
      "Fastify route options must be an inline object literal",
    )
  }
  if (options.properties.some((property) => ts.isSpreadAssignment(property))) {
    throw routeAnalysisError(
      path,
      sourceFile,
      options,
      "Fastify route options may not contain spreads",
    )
  }
  assertNoFastifyRouteConstraints(path, sourceFile, options)

  const methodProperties = namedProperties(options, "method")
  const urlProperties = namedProperties(options, "url")
  if (methodProperties.length !== 1 || urlProperties.length !== 1) {
    throw routeAnalysisError(
      path,
      sourceFile,
      options,
      "Fastify route options require one static method and one static url",
    )
  }
  const methods = staticHttpMethods(
    methodProperties[0]?.initializer,
    staticStrings,
  )
  const routePath = staticStringWithConstants(
    urlProperties[0]?.initializer,
    staticStrings,
  )
  if (methods.length === 0 || !routePath?.startsWith("/")) {
    throw routeAnalysisError(
      path,
      sourceFile,
      options,
      "Fastify route method and url must be static literals",
    )
  }
  return methods.map((method) => ({ method, path: routePath }))
}

function assertReviewedFastifyControlCall(path, sourceFile, call, method) {
  if (
    path === "apps/bff/src/routes/console-session.ts" &&
    method === "hasContentTypeParser" &&
    call.arguments.length === 1 &&
    staticString(call.arguments[0]) === "application/x-www-form-urlencoded"
  ) {
    return
  }
  if (
    path === "apps/bff/src/routes/console-session.ts" &&
    method === "addContentTypeParser" &&
    normalizedNodeText(call, sourceFile) ===
      'server.addContentTypeParser("application/x-www-form-urlencoded",{parseAs:"string"},(_request,body,done)=>done(null,body),)'
  ) {
    return
  }
  const hook = staticString(call.arguments[0])
  const handler = unwrapExpression(call.arguments[1])
  if (
    method === "addHook" &&
    path === "apps/bff/src/auth/authorization.ts" &&
    hook === "preHandler" &&
    call.arguments.length === 2 &&
    handler &&
    ts.isCallExpression(handler) &&
    ts.isIdentifier(handler.expression) &&
    handler.expression.text === "authorizationHook" &&
    handler.arguments.length === 1
  ) {
    return
  }
  if (
    method === "addHook" &&
    path === "apps/bff/src/routes/firecrawl-gateway.ts" &&
    hook === "onSend" &&
    call.arguments.length === 2 &&
    handler &&
    ts.isIdentifier(handler) &&
    handler.text === "applyFirecrawlNoStoreHeader"
  ) {
    return
  }
  if (
    method === "addHook" &&
    path === "apps/bff/src/index.ts" &&
    hook === "onReady" &&
    call.arguments.length === 2 &&
    handler &&
    ts.isArrowFunction(handler) &&
    handler.modifiers?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword,
    ) &&
    normalizedNodeText(handler, sourceFile).includes(
      "awaitruntimeIsolation.service?.bootstrap()",
    ) &&
    normalizedNodeText(handler, sourceFile).includes(
      'failureClass:"emergency_isolation_bootstrap_failed"',
    )
  ) {
    return
  }
  if (
    method === "addHook" &&
    path === "apps/bff/src/index.ts" &&
    [
      ["onRequest", "logQueryFreeIncomingRequest"],
      ["onResponse", "logQueryFreeCompletedRequest"],
    ].some(
      ([reviewedHook, reviewedHandler]) =>
        hook === reviewedHook &&
        call.arguments.length === 2 &&
        handler &&
        ts.isIdentifier(handler) &&
        handler.text === reviewedHandler,
    )
  ) {
    return
  }
  if (
    method === "addHook" &&
    path === "apps/bff/src/index.ts" &&
    hook === "onClose" &&
    call.arguments.length === 2 &&
    handler &&
    ts.isIdentifier(handler) &&
    handler.text === "closeInferenceCoreDb"
  ) {
    return
  }
  if (isReviewedConsoleSessionOnCloseHook(path, sourceFile, call, method)) {
    return
  }
  throw routeAnalysisError(
    path,
    sourceFile,
    call,
    `Unreviewed Fastify route-control API ${method}`,
  )
}

function isReviewedConsoleSessionOnCloseHook(path, sourceFile, call, method) {
  const statement = call.parent
  const buildServerBody = statement?.parent
  const buildServer = buildServerBody?.parent
  const handler = unwrapExpression(call.arguments[1])
  return Boolean(
    path === "apps/bff/src/index.ts" &&
      method === "addHook" &&
      call.arguments.length === 2 &&
      staticString(call.arguments[0]) === "onClose" &&
      handler &&
      ts.isArrowFunction(handler) &&
      handler.parameters.length === 0 &&
      handler.modifiers?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword,
      ) &&
      statement &&
      ts.isExpressionStatement(statement) &&
      buildServerBody &&
      ts.isBlock(buildServerBody) &&
      buildServer &&
      ts.isFunctionDeclaration(buildServer) &&
      buildServer.name?.text === "buildServer" &&
      normalizedNodeText(call, sourceFile) ===
        'server.addHook("onClose",async()=>{consoleSessionRuntime?.close()awaitcloseInferenceCoreDb()})',
  )
}

function assertNoFastifyRouteConstraints(path, sourceFile, options) {
  if (!options || !ts.isObjectLiteralExpression(options)) {
    return
  }
  if (options.properties.some((property) => ts.isSpreadAssignment(property))) {
    throw routeAnalysisError(
      path,
      sourceFile,
      options,
      "Fastify route options may not contain spreads",
    )
  }
  const constrained = options.properties.some((property) => {
    const name = property.name ? staticPropertyName(property.name) : null
    return name === "constraints" || name === "version"
  })
  if (constrained) {
    throw routeAnalysisError(
      path,
      sourceFile,
      options,
      "Fastify route constraints and versions are not allowed",
    )
  }
}

function namedProperties(objectLiteral, name) {
  return objectLiteral.properties.filter(
    (property) =>
      ts.isPropertyAssignment(property) &&
      staticPropertyName(property.name) === name,
  )
}

function staticHttpMethods(node, staticStrings) {
  const nodes =
    node && ts.isArrayLiteralExpression(node) ? node.elements : [node]
  const methods = []
  for (const candidate of nodes) {
    const method = staticStringWithConstants(
      candidate,
      staticStrings,
    )?.toUpperCase()
    if (!method || !routeMethods.includes(method.toLowerCase())) {
      return []
    }
    methods.push(method)
  }
  return [...new Set(methods)].sort()
}

function staticRouteOptionsUrl(node, staticStrings) {
  if (!node || !ts.isObjectLiteralExpression(node)) {
    return null
  }
  const urlProperties = namedProperties(node, "url")
  return urlProperties.length === 1
    ? staticStringWithConstants(urlProperties[0]?.initializer, staticStrings)
    : null
}

function staticMemberCall(expression) {
  if (ts.isPropertyAccessExpression(expression)) {
    return { receiver: expression.expression, name: expression.name.text }
  }
  if (ts.isElementAccessExpression(expression)) {
    const name = staticString(expression.argumentExpression)
    return name ? { receiver: expression.expression, name } : null
  }
  return null
}

function staticPropertyName(node) {
  if (ts.isIdentifier(node)) {
    return node.text
  }
  return staticString(node)
}

function staticString(node) {
  const subject = unwrapExpression(node)
  if (
    subject &&
    (ts.isStringLiteral(subject) || ts.isNoSubstitutionTemplateLiteral(subject))
  ) {
    return subject.text
  }
  if (
    subject &&
    ts.isBinaryExpression(subject) &&
    subject.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    const left = staticString(subject.left)
    const right = staticString(subject.right)
    return left !== null && right !== null ? `${left}${right}` : null
  }
  if (subject && ts.isTemplateExpression(subject)) {
    let value = subject.head.text
    for (const span of subject.templateSpans) {
      const expression = staticString(span.expression)
      if (expression === null) {
        return null
      }
      value += expression
      value += span.literal.text
    }
    return value
  }
  return null
}

function scriptKindForPath(path) {
  if (path.endsWith(".tsx")) {
    return ts.ScriptKind.TSX
  }
  if (path.endsWith(".jsx")) {
    return ts.ScriptKind.JSX
  }
  if (path.endsWith(".js") || path.endsWith(".mjs") || path.endsWith(".cjs")) {
    return ts.ScriptKind.JS
  }
  return ts.ScriptKind.TS
}

function isKnownFastifyReceiver(node, receiverNames) {
  const subject = unwrapExpression(node)
  return (
    (ts.isIdentifier(subject) &&
      (receiverNames.has(subject.text) ||
        routeReceiverNamePattern.test(subject.text))) ||
    isFastifyFactoryCall(subject)
  )
}

function isTrackedFastifyReceiver(node, receiverNames) {
  const subject = unwrapExpression(node)
  return (
    (ts.isIdentifier(subject) && receiverNames.has(subject.text)) ||
    isFastifyFactoryCall(subject)
  )
}

function isFastifyFactoryCall(node) {
  if (!node || !ts.isCallExpression(node)) {
    return false
  }
  const expression = unwrapExpression(node.expression)
  return (
    ts.isIdentifier(expression) && /^(?:fastify|Fastify)$/.test(expression.text)
  )
}

function isRouteMethodReference(node, receiverNames) {
  const subject = unwrapExpression(node)
  if (
    ts.isCallExpression(subject) &&
    staticMemberCall(subject.expression)?.name === "bind"
  ) {
    return isRouteMethodReference(
      staticMemberCall(subject.expression)?.receiver,
      receiverNames,
    )
  }
  const member = staticMemberCall(subject)
  return Boolean(
    member &&
      isKnownFastifyReceiver(member.receiver, receiverNames) &&
      (routeMethods.includes(member.name) ||
        member.name === "route" ||
        unsupportedFastifyMethods.has(member.name) ||
        controlledFastifyMethods.has(member.name)),
  )
}

function unwrapExpression(node) {
  let subject = node
  while (
    subject &&
    (ts.isAsExpression(subject) ||
      ts.isParenthesizedExpression(subject) ||
      ts.isNonNullExpression(subject) ||
      ts.isSatisfiesExpression(subject) ||
      ts.isTypeAssertionExpression(subject))
  ) {
    subject = subject.expression
  }
  return subject
}

function routeAnalysisError(path, sourceFile, location, reason) {
  const start = typeof location === "number" ? location : location.getStart()
  const line =
    sourceFile.getLineAndCharacterOfPosition(Math.max(0, start)).line + 1
  return new Error(`${reason} in ${path}:${line}`)
}

export function extractWebInferenceConsumers({ root, paths }) {
  const consumers = []
  for (const path of paths) {
    if (
      !/^apps\/web\/.*\.(?:cjs|cts|js|jsx|mjs|mts|ts|tsx)$/.test(path) ||
      /\.(?:test|spec)\.(?:cjs|cts|js|jsx|mjs|mts|ts|tsx)$/.test(path) ||
      /\.d\.(?:cts|mts|ts)$/.test(path) ||
      !isRegularFile(resolve(root, path))
    ) {
      continue
    }
    const source = readFileSync(resolve(root, path), "utf8")
    const sourceFile = ts.createSourceFile(
      path,
      source,
      ts.ScriptTarget.Latest,
      true,
      scriptKindForPath(path),
    )
    if (sourceFile.parseDiagnostics.length > 0) {
      throw routeAnalysisError(
        path,
        sourceFile,
        sourceFile.parseDiagnostics[0]?.start ?? 0,
        "TypeScript syntax error",
      )
    }
    const constants = collectStaticStringConstants(sourceFile)
    let invocationCount = 0
    const visit = (node) => {
      if (
        (ts.isCallExpression(node) || ts.isNewExpression(node)) &&
        (node.arguments ?? []).some((argument) =>
          expressionIncludesWebInferenceEndpoint(argument, constants),
        )
      ) {
        invocationCount += 1
      }
      ts.forEachChild(node, visit)
    }
    visit(sourceFile)
    if (invocationCount > 0) {
      consumers.push({
        path,
        invocationCount,
        sha256: sha256(readFileSync(resolve(root, path))),
        removeBy: "PR-03",
      })
    }
  }
  return consumers.sort((left, right) => left.path.localeCompare(right.path))
}

function collectStaticStringConstants(sourceFile) {
  const declarationsByName = new Map()
  const constants = new Map()
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      isConstVariableDeclaration(node)
    ) {
      const declarations = declarationsByName.get(node.name.text) ?? []
      declarations.push(node)
      declarationsByName.set(node.name.text, declarations)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)

  let changed = true
  while (changed) {
    changed = false
    for (const declarations of declarationsByName.values()) {
      if (declarations.length !== 1) {
        continue
      }
      const declaration = declarations[0]
      if (constants.has(declaration.name.text)) {
        continue
      }
      const value = staticStringWithConstants(
        declaration.initializer,
        constants,
      )
      if (value !== null) {
        constants.set(declaration.name.text, value)
        changed = true
      }
    }
  }
  const ambiguous = new Map()
  for (const [name, declarations] of declarationsByName) {
    if (declarations.length < 2) {
      continue
    }
    const candidates = declarations
      .map((declaration) =>
        staticStringWithConstants(declaration.initializer, constants),
      )
      .filter((value) => value !== null)
    if (candidates.length > 0) {
      ambiguous.set(name, candidates)
    }
  }
  Object.defineProperty(constants, ambiguousStaticStringCandidates, {
    value: ambiguous,
  })
  return constants
}

function staticStringWithConstants(node, constants) {
  const subject = unwrapExpression(node)
  if (subject && ts.isIdentifier(subject)) {
    return constants.get(subject.text) ?? null
  }
  if (
    subject &&
    (ts.isStringLiteral(subject) || ts.isNoSubstitutionTemplateLiteral(subject))
  ) {
    return subject.text
  }
  if (
    subject &&
    ts.isBinaryExpression(subject) &&
    subject.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    const left = staticStringWithConstants(subject.left, constants)
    const right = staticStringWithConstants(subject.right, constants)
    return left !== null && right !== null ? `${left}${right}` : null
  }
  if (subject && ts.isTemplateExpression(subject)) {
    let value = subject.head.text
    for (const span of subject.templateSpans) {
      const expression = staticStringWithConstants(span.expression, constants)
      if (expression === null) {
        return null
      }
      value += expression
      value += span.literal.text
    }
    return value
  }
  return null
}

function expressionIncludesWebInferenceEndpoint(node, constants) {
  const value = staticStringWithConstants(node, constants)
  if (value !== null && webInferenceEndpointPattern.test(value)) {
    return true
  }
  const ambiguous = constants[ambiguousStaticStringCandidates] ?? new Map()
  const subject = unwrapExpression(node)
  if (
    subject &&
    ts.isIdentifier(subject) &&
    (ambiguous.get(subject.text) ?? []).some((candidate) =>
      webInferenceEndpointPattern.test(candidate),
    )
  ) {
    return true
  }
  const fragments = []
  const visit = (candidate) => {
    const subject = unwrapExpression(candidate)
    if (
      subject &&
      (ts.isStringLiteral(subject) ||
        ts.isNoSubstitutionTemplateLiteral(subject))
    ) {
      fragments.push(subject.text)
      return
    }
    if (subject && ts.isTemplateExpression(subject)) {
      fragments.push(subject.head.text)
      for (const span of subject.templateSpans) {
        visit(span.expression)
        fragments.push(span.literal.text)
      }
      return
    }
    ts.forEachChild(candidate, visit)
  }
  visit(node)
  return (
    fragments.some((fragment) => webInferenceEndpointPattern.test(fragment)) ||
    webInferenceEndpointPattern.test(fragments.join(""))
  )
}

export function extractWebRoutes({ root, paths }) {
  const routes = []
  for (const path of paths) {
    const publicAsset = path.match(/^apps\/web\/public\/(.+)$/)
    if (publicAsset && isRegularFile(resolve(root, path))) {
      routes.push({
        surface: "web-static",
        method: "STATIC",
        path: `/${publicAsset[1]}`,
        source: path,
        classification: "current-console-seam",
      })
      continue
    }
    if (
      /^apps\/web\/.*\.(?:cjs|cts|js|jsx|mjs|mts|ts|tsx)$/.test(path) &&
      !/\.(?:test|spec)\.(?:cjs|cts|js|jsx|mjs|mts|ts|tsx)$/.test(path) &&
      isRegularFile(resolve(root, path))
    ) {
      assertNoNextRewriteRegistration(root, path)
      if (path === "apps/web/src/middleware.ts") {
        assertReviewedNextMiddleware(root, path)
      }
    }
    if (
      /^apps\/web\/(?:src\/)?pages(?:\/|$)/.test(path) &&
      !/\.(?:test|spec)\.(?:js|jsx|ts|tsx)$/.test(path)
    ) {
      throw new Error(`Next Pages Router is not allowed in ${path}`)
    }
    if (
      /^apps\/web\/(?:src\/)?middleware\.(?:cjs|cts|js|jsx|mjs|mts|ts|tsx)$/.test(
        path,
      ) &&
      path !== "apps/web/src/middleware.ts"
    ) {
      throw new Error(`Unreviewed Next middleware entrypoint ${path}`)
    }
    if (
      /^apps\/web\/(?:src\/)?proxy\.(?:cjs|cts|js|jsx|mjs|mts|ts|tsx)$/.test(
        path,
      )
    ) {
      throw new Error(`Unreviewed Next proxy entrypoint ${path}`)
    }
    if (
      /^apps\/web\/(?:src\/)?app\/(?:.*\/)?(?:global-)?not-found\.(?:js|jsx|ts|tsx)$/.test(
        path,
      )
    ) {
      throw new Error(`Unreviewed Next fallback surface ${path}`)
    }
    if (
      /^apps\/web\/next\.config\.(?:cjs|cts|js|mjs|mts|ts)$/.test(path) &&
      path !== "apps/web/next.config.ts"
    ) {
      throw new Error(`Unreviewed Next configuration entrypoint ${path}`)
    }
    const pageMatch = path.match(
      /^apps\/web\/(?:src\/)?app\/(.*\/)?page\.(?:js|jsx|ts|tsx)$/,
    )
    if (pageMatch) {
      const routePath = nextRoutePath(pageMatch[1] ?? "")
      routes.push({
        surface: "web-page",
        method: "PAGE",
        path: routePath,
        source: path,
        classification: classifyWebRoute(routePath),
      })
      continue
    }

    const metadataRoute = nextMetadataRoute(path)
    if (metadataRoute) {
      routes.push({
        surface: "web-metadata",
        method: "METADATA",
        path: metadataRoute,
        source: path,
        classification: "current-console-seam",
      })
      continue
    }

    const handlerMatch = path.match(
      /^apps\/web\/(?:src\/)?app\/(.*\/)?route\.(?:js|jsx|ts|tsx)$/,
    )
    if (!handlerMatch) {
      continue
    }
    const routePath = nextRoutePath(handlerMatch[1] ?? "")
    const source = readFileSync(resolve(root, path), "utf8")
    const methods = extractNextHandlerMethods(source)
    if (methods.length === 0) {
      throw new Error(`No exported HTTP method found in ${path}`)
    }
    for (const method of methods) {
      routes.push({
        surface: "web-handler",
        method,
        path: routePath,
        source: path,
        classification: classifyWebRoute(routePath),
      })
    }
  }
  return routes
}

function nextMetadataRoute(path) {
  const match = path.match(
    /^apps\/web\/(?:src\/)?app\/(.*\/)?((?:favicon|icon\d*|apple-icon\d*|opengraph-image\d*|twitter-image\d*)\.(?:gif|ico|jpe?g|js|jsx|png|svg|ts|tsx)|robots\.(?:txt|js|ts)|sitemap\.(?:xml|js|ts)|manifest\.(?:json|webmanifest|js|ts))$/,
  )
  if (!match) {
    return null
  }
  const directory = nextRoutePath(match[1] ?? "")
  const filename = match[2]
    .replace(
      /^((?:favicon|icon\d*|apple-icon\d*|opengraph-image\d*|twitter-image\d*))\.(?:js|jsx|ts|tsx)$/,
      "$1",
    )
    .replace(/^robots\.(?:js|ts)$/, "robots.txt")
    .replace(/^sitemap\.(?:js|ts)$/, "sitemap.xml")
    .replace(/^manifest\.(?:js|ts|json)$/, "manifest.webmanifest")
  return directory === "/" ? `/${filename}` : `${directory}/${filename}`
}

function assertNoNextRewriteRegistration(root, path) {
  const source = readFileSync(resolve(root, path), "utf8")
  if (
    path === "apps/web/src/middleware.ts" &&
    isReviewedConsoleSessionMiddlewareSource(source)
  ) {
    return
  }
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindForPath(path),
  )
  if (sourceFile.parseDiagnostics.length > 0) {
    throw routeAnalysisError(
      path,
      sourceFile,
      sourceFile.parseDiagnostics[0]?.start ?? 0,
      "TypeScript syntax error",
    )
  }
  const visit = (node) => {
    const member = staticMemberCall(node)
    if (
      (ts.isIdentifier(node) && node.text === "rewrite") ||
      member?.name === "rewrite"
    ) {
      throw routeAnalysisError(
        path,
        sourceFile,
        node,
        "Next middleware rewrite registration is not allowed",
      )
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
}

function assertReviewedNextMiddleware(root, path) {
  const source = readFileSync(resolve(root, path), "utf8")
  if (isReviewedConsoleSessionMiddlewareSource(source)) {
    return
  }
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindForPath(path),
  )
  const reviewedImports = new Set()
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !statement.importClause?.namedBindings ||
      !ts.isNamedImports(statement.importClause.namedBindings)
    ) {
      continue
    }
    for (const specifier of statement.importClause.namedBindings.elements) {
      const imported = specifier.propertyName?.text ?? specifier.name.text
      reviewedImports.add(
        `${statement.moduleSpecifier.text}\0${imported}\0${specifier.name.text}`,
      )
    }
  }
  for (const requiredImport of [
    "next/server\0NextResponse\0NextResponse",
    "@/lib/auth/auth\0auth\0auth",
  ]) {
    if (!reviewedImports.has(requiredImport)) {
      throw new Error(`Missing reviewed Next middleware import in ${path}`)
    }
  }
  const allowedReturnCall = (expression) => {
    const call = unwrapExpression(expression)
    if (!call || !ts.isCallExpression(call)) {
      return false
    }
    const callee = unwrapExpression(call.expression)
    if (
      ts.isIdentifier(callee) &&
      callee.text === "requireAuthenticatedSession" &&
      call.arguments.length === 2
    ) {
      return true
    }
    const member = staticMemberCall(callee)
    if (
      member &&
      ts.isIdentifier(unwrapExpression(member.receiver)) &&
      unwrapExpression(member.receiver).text === "contentSecurityPolicy"
    ) {
      if (member.name === "next") {
        return call.arguments.length === 0
      }
      if (member.name !== "redirect" || call.arguments.length !== 1) {
        return false
      }
      const redirect = unwrapExpression(call.arguments[0])
      return Boolean(
        redirect &&
          ts.isCallExpression(redirect) &&
          ts.isIdentifier(unwrapExpression(redirect.expression)) &&
          unwrapExpression(redirect.expression).text === "getSignInRedirectUrl",
      )
    }
    if (
      !member ||
      !ts.isIdentifier(unwrapExpression(member.receiver)) ||
      unwrapExpression(member.receiver).text !== "NextResponse"
    ) {
      return false
    }
    if (member.name === "next") {
      return call.arguments.length === 0
    }
    if (member.name !== "redirect" || call.arguments.length !== 1) {
      return false
    }
    const redirect = unwrapExpression(call.arguments[0])
    return Boolean(
      redirect &&
        ts.isCallExpression(redirect) &&
        ts.isIdentifier(unwrapExpression(redirect.expression)) &&
        unwrapExpression(redirect.expression).text === "getSignInRedirectUrl",
    )
  }
  const nearestFunctionLike = (node) => {
    for (let current = node.parent; current; current = current.parent) {
      if (ts.isFunctionLike(current)) {
        return current
      }
    }
    return null
  }
  const isAuthenticatedSessionCallback = (node) => {
    const parent = node.parent
    if (!ts.isCallExpression(parent) || parent.arguments[0] !== node) {
      return false
    }
    const callee = unwrapExpression(parent.expression)
    return ts.isIdentifier(callee) && callee.text === "createAuthMiddleware"
  }
  const isDefaultMiddlewareFunction = (node) =>
    Boolean(
      ts.isFunctionDeclaration(node) &&
        node.name?.text === "middleware" &&
        node.modifiers?.some(
          (modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword,
        ) &&
        node.modifiers?.some(
          (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
        ),
    )
  const isReviewedResponseScope = (node) => {
    const scope = nearestFunctionLike(node)
    return Boolean(
      isDefaultMiddlewareFunction(scope) ||
        ((ts.isArrowFunction(scope) || ts.isFunctionExpression(scope)) &&
          isAuthenticatedSessionCallback(scope)),
    )
  }
  let authFactoryDeclarations = 0
  let authenticatedSessionChecks = 0
  let contentSecurityPolicyDeclarations = 0
  let contentSecurityPolicyNextCalls = 0
  let contentSecurityPolicyRedirectCalls = 0
  let middlewareDeclarations = 0
  let sessionWrapperDeclarations = 0
  const visit = (node) => {
    if (
      ts.isIdentifier(node) &&
      ["NextResponse", "auth"].includes(node.text) &&
      isShadowingBindingIdentifier(node)
    ) {
      throw routeAnalysisError(
        path,
        sourceFile,
        node,
        `Next middleware binding ${node.text} may not be shadowed`,
      )
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "createAuthMiddleware"
    ) {
      authFactoryDeclarations += 1
      const initializer = unwrapExpression(node.initializer)
      if (
        !isConstVariableDeclaration(node) ||
        !initializer ||
        !ts.isIdentifier(initializer) ||
        initializer.text !== "auth"
      ) {
        throw routeAnalysisError(
          path,
          sourceFile,
          node,
          "Next middleware auth factory changed",
        )
      }
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "contentSecurityPolicy"
    ) {
      contentSecurityPolicyDeclarations += 1
      const initializer = unwrapExpression(node.initializer)
      const callee =
        initializer && ts.isCallExpression(initializer)
          ? unwrapExpression(initializer.expression)
          : undefined
      const argument =
        initializer && ts.isCallExpression(initializer)
          ? unwrapExpression(initializer.arguments[0])
          : undefined
      if (
        !isConstVariableDeclaration(node) ||
        !isDefaultMiddlewareFunction(nearestFunctionLike(node)) ||
        !initializer ||
        !ts.isCallExpression(initializer) ||
        !callee ||
        !ts.isIdentifier(callee) ||
        callee.text !== "createContentSecurityPolicy" ||
        initializer.arguments.length !== 1 ||
        !argument ||
        !ts.isIdentifier(argument) ||
        argument.text !== "request"
      ) {
        throw routeAnalysisError(
          path,
          sourceFile,
          node,
          "Next middleware content security policy binding changed",
        )
      }
    }
    if (
      ts.isFunctionDeclaration(node) &&
      node.name?.text === "middleware" &&
      node.modifiers?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword,
      ) &&
      node.modifiers?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
      )
    ) {
      middlewareDeclarations += 1
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "requireAuthenticatedSession"
    ) {
      sessionWrapperDeclarations += 1
      const initializer = unwrapExpression(node.initializer)
      const callback =
        initializer && ts.isCallExpression(initializer)
          ? initializer.arguments[0]
          : undefined
      if (
        !isConstVariableDeclaration(node) ||
        !initializer ||
        !ts.isCallExpression(initializer) ||
        !ts.isIdentifier(unwrapExpression(initializer.expression)) ||
        unwrapExpression(initializer.expression).text !==
          "createAuthMiddleware" ||
        initializer.arguments.length !== 1 ||
        !callback ||
        !(ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))
      ) {
        throw routeAnalysisError(
          path,
          sourceFile,
          node,
          "Next middleware authenticated-session wrapper changed",
        )
      }
    }
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(unwrapExpression(node.expression)) &&
      unwrapExpression(node.expression).text === "request" &&
      node.name.text === "auth" &&
      isAuthenticatedSessionCallback(nearestFunctionLike(node))
    ) {
      authenticatedSessionChecks += 1
    }
    if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(unwrapExpression(node.expression)) &&
      ["NextResponse", "Response"].includes(
        unwrapExpression(node.expression).text,
      )
    ) {
      throw routeAnalysisError(
        path,
        sourceFile,
        node,
        "Next middleware may not construct response bodies",
      )
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(unwrapExpression(node.expression)) &&
      unwrapExpression(node.expression).text === "fetch"
    ) {
      throw routeAnalysisError(
        path,
        sourceFile,
        node,
        "Next middleware may not fetch response bodies",
      )
    }
    if (ts.isCallExpression(node)) {
      const member = staticMemberCall(unwrapExpression(node.expression))
      const receiver = member ? unwrapExpression(member.receiver) : undefined
      if (
        member &&
        receiver &&
        ts.isIdentifier(receiver) &&
        receiver.text === "contentSecurityPolicy"
      ) {
        if (member.name === "next" && node.arguments.length === 0) {
          contentSecurityPolicyNextCalls += 1
        } else if (
          member.name === "redirect" &&
          node.arguments.length === 1 &&
          ts.isCallExpression(unwrapExpression(node.arguments[0])) &&
          ts.isIdentifier(
            unwrapExpression(unwrapExpression(node.arguments[0]).expression),
          ) &&
          unwrapExpression(unwrapExpression(node.arguments[0]).expression)
            .text === "getSignInRedirectUrl"
        ) {
          contentSecurityPolicyRedirectCalls += 1
        } else {
          throw routeAnalysisError(
            path,
            sourceFile,
            node,
            "Next middleware content security policy call changed",
          )
        }
      }
    }
    if (
      ts.isReturnStatement(node) &&
      node.expression &&
      isReviewedResponseScope(node) &&
      !allowedReturnCall(node.expression)
    ) {
      throw routeAnalysisError(
        path,
        sourceFile,
        node,
        "Unreviewed Next middleware return form",
      )
    }
    if (
      ts.isArrowFunction(node) &&
      !ts.isBlock(node.body) &&
      isAuthenticatedSessionCallback(node) &&
      !allowedReturnCall(node.body)
    ) {
      throw routeAnalysisError(
        path,
        sourceFile,
        node,
        "Unreviewed Next middleware expression return",
      )
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  const usesContentSecurityPolicyWrapper =
    contentSecurityPolicyDeclarations > 0 ||
    contentSecurityPolicyNextCalls > 0 ||
    contentSecurityPolicyRedirectCalls > 0
  if (
    usesContentSecurityPolicyWrapper &&
    (contentSecurityPolicyDeclarations !== 1 ||
      contentSecurityPolicyNextCalls !== 2 ||
      contentSecurityPolicyRedirectCalls !== 1 ||
      !reviewedImports.has(
        "@/lib/security/content-security-policy\0buildContentSecurityPolicy\0buildContentSecurityPolicy",
      ))
  ) {
    throw new Error(
      `Next middleware content security policy wrapper changed in ${path}`,
    )
  }
  if (
    authFactoryDeclarations !== 1 ||
    authenticatedSessionChecks !== 1 ||
    middlewareDeclarations !== 1 ||
    sessionWrapperDeclarations !== 1
  ) {
    throw new Error(`Next middleware wrapper declarations changed in ${path}`)
  }
}

function isReviewedConsoleSessionMiddlewareSource(source) {
  const rewriteCalls = source.match(/\bNextResponse\.rewrite\s*\(/g) ?? []
  return Boolean(
    rewriteCalls.length === 1 &&
      /resolution\.state\s*===\s*["']unavailable["']/.test(source) &&
      /contentSecurityPolicy\.rewrite\(\s*getUnavailableUrl\(request\.nextUrl,\s*returnTo\),\s*503,?\s*\)/s.test(
        source,
      ) &&
      /new URL\(["']\/auth\/unavailable["'],\s*requestUrl\.origin\)/.test(
        source,
      ) &&
      /headers\.set\(["']Cache-Control["'],\s*["']no-store, max-age=0["']\)/.test(
        source,
      ) &&
      /const contentSecurityPolicy = createContentSecurityPolicy\(request\)/.test(
        source,
      ) &&
      (source.match(/\bcontentSecurityPolicy\.next\(\)/g) ?? []).length === 2 &&
      (source.match(/\bcontentSecurityPolicy\.redirect\(/g) ?? []).length ===
        2 &&
      /export default async function middleware\(request: NextRequest\)/.test(
        source,
      ) &&
      /await resolveConsoleSession\(cookieHeader\)/.test(source) &&
      /resolution\.state === "active"/.test(source) &&
      /setSlidingSessionCookie\(response, sessionHandle\)/.test(source) &&
      /getSignInRedirectUrl\(request\.nextUrl, returnTo, true\)/.test(source) &&
      /clearSessionCookie\(response\)/.test(source) &&
      /httpOnly:\s*true/.test(source) &&
      /sameSite:\s*"lax"/.test(source) &&
      /secure:\s*true/.test(source) &&
      /normalizeConsoleReturnPath/.test(source) &&
      /buildContentSecurityPolicy/.test(source) &&
      !/next-auth|\baccessToken\b|\brefresh_token\b/.test(source) &&
      !/https?:\/\/(?!request\.invalid)/.test(source),
  )
}

function isConstVariableDeclaration(node) {
  return Boolean(
    ts.isVariableDeclarationList(node.parent) &&
      (node.parent.flags & ts.NodeFlags.Const) !== 0,
  )
}

function normalizedNodeText(node, sourceFile) {
  return node.getText(sourceFile).replace(/\s+/g, "")
}

function isShadowingBindingIdentifier(node) {
  const parent = node.parent
  return Boolean(
    (ts.isParameter(parent) ||
      ts.isVariableDeclaration(parent) ||
      ts.isFunctionDeclaration(parent) ||
      ts.isFunctionExpression(parent) ||
      ts.isClassDeclaration(parent) ||
      ts.isClassExpression(parent) ||
      ts.isBindingElement(parent)) &&
      parent.name === node,
  )
}

function extractNextHandlerMethods(source) {
  const methods = new Set()
  for (const match of source.matchAll(
    /export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b/g,
  )) {
    methods.add(match[1])
  }
  for (const match of source.matchAll(
    /export\s+(?:const|let|var)\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b/g,
  )) {
    methods.add(match[1])
  }
  for (const match of source.matchAll(
    /\bas\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b/g,
  )) {
    methods.add(match[1])
  }
  for (const match of source.matchAll(/export\s+const\s*\{([^}]+)\}\s*=/g)) {
    for (const candidate of match[1].split(",")) {
      const method = candidate.trim()
      if (/^(?:GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)$/.test(method)) {
        methods.add(method)
      }
    }
  }
  return [...methods].sort()
}

function buildResolverFingerprints(root) {
  return resolverFingerprintSpecs
    .filter(
      ({ enabledWhenPath }) =>
        !enabledWhenPath || isRegularFile(resolve(root, enabledWhenPath)),
    )
    .map(({ path, symbol }) => {
      const source = readFileSync(resolve(root, path), "utf8").replaceAll(
        "\r\n",
        "\n",
      )
      const subject =
        symbol === "<file>"
          ? source.trim()
          : extractFunctionBlock(source, symbol)
      return {
        path,
        symbol,
        sha256: sha256(subject),
      }
    })
    .sort((left, right) =>
      `${left.path}\0${left.symbol}`.localeCompare(
        `${right.path}\0${right.symbol}`,
      ),
    )
}

function buildLegacyEscapeHatches(root, paths) {
  const candidates = new Set(paths)
  return legacyEscapeHatchSpecs
    .filter(
      ({ path }) => candidates.has(path) && isRegularFile(resolve(root, path)),
    )
    .map(({ path, removeBy }) => ({
      path,
      sha256: sha256(readFileSync(resolve(root, path))),
      removeBy,
    }))
    .sort((left, right) => left.path.localeCompare(right.path))
}

function extractFunctionBlock(source, symbol) {
  const marker = `function ${symbol}`
  const start = source.indexOf(marker)
  if (start < 0) {
    throw new Error(`Missing route resolver ${symbol}`)
  }
  const next = source.indexOf("\nfunction ", start + marker.length)
  return source.slice(start, next < 0 ? source.length : next).trim()
}

function classifyBffRoute(source, path) {
  if (
    source === "apps/bff/src/index.ts" &&
    ["/livez", "/healthz", "/readyz"].includes(path)
  ) {
    return "private-operational"
  }
  if (
    source === "apps/bff/src/routes/observability-metrics.ts" &&
    path === "/internal/observability/metrics"
  ) {
    return "private-operational"
  }
  if (
    source === "apps/bff/src/routes/app-gateway.ts" &&
    [
      "/api/app-gateway/v1/models",
      "/api/app-gateway/v1/chat/completions",
    ].includes(path)
  ) {
    return "required-now"
  }
  if (
    source === "apps/bff/src/routes/firecrawl-gateway.ts" &&
    ["/v2/search", "/v2/scrape"].includes(path)
  ) {
    return "public-t2"
  }
  if (source === "apps/bff/src/routes/admin.ts") {
    if (
      /^\/api\/admin\/(?:approvals|agents\/registry|connectors\/registry|librechat\/|internal-docs\/mcp\/|mcp-servers(?:\/|$)|builder(?:\/|$)|resources(?:\/|$)|settings\/url-policy(?:\/|$)|team\/break-glass$)/.test(
        path,
      ) ||
      path.includes("/promote-production") ||
      path.includes("/vetting")
    ) {
      return "legacy-retired"
    }
    if (
      path.startsWith("/api/admin/policies/violations") ||
      path.startsWith("/api/admin/sandbox/pure-mode")
    ) {
      return "rewrite-required"
    }
    return "current-console-seam"
  }
  return "legacy-retired"
}

function classifyWebRoute(path) {
  if (
    path.startsWith("/api/auth/") ||
    path === "/auth/keycloak" ||
    path === "/auth/signin"
  ) {
    return "operational-auth"
  }
  if (
    path === "/" ||
    path.startsWith("/applications") ||
    path.startsWith("/hardware") ||
    path.startsWith("/inference") ||
    path.startsWith("/settings") ||
    path.startsWith("/team") ||
    path === "/activity" ||
    path === "/api/admin/audit/export" ||
    path === "/api/admin/audit/export/verification-keys"
  ) {
    return "current-console-seam"
  }
  return "legacy-retired"
}

export function verifyLegacyRouteShrink(base, current) {
  const errors = []
  const baseByKey = new Map(
    base.routes.map((route) => [routeKey(route), route]),
  )
  const baseCounts = routeCounts(base.routes)
  const currentCounts = routeCounts(current.routes)

  for (const route of current.routes) {
    const baseRoute = baseByKey.get(routeKey(route))
    if (!baseRoute) {
      errors.push(
        `new route requires a reviewed contract revision ${route.method} ${route.path} ${route.source}`,
      )
    } else if (baseRoute.classification !== route.classification) {
      errors.push(
        `route reclassified ${route.method} ${route.path} ${route.source}`,
      )
    }
  }
  for (const [key, count] of currentCounts) {
    if (count > (baseCounts.get(key) ?? 0)) {
      const route = current.routes.find(
        (candidate) => routeKey(candidate) === key,
      )
      if (route && baseByKey.has(key)) {
        errors.push(
          `route multiplicity increased ${route.method} ${route.path} ${route.source}`,
        )
      }
    }
  }

  errors.push(...verifyPolicyStability(base, current, "route"))
  errors.push(...verifyRequiredRoutes(current))
  if (JSON.stringify(base.target) !== JSON.stringify(current.target)) {
    errors.push("route target contract changed")
  }
  if (
    JSON.stringify(base.fingerprints) !== JSON.stringify(current.fingerprints)
  ) {
    errors.push("route resolver fingerprints changed")
  }
  errors.push(
    ...verifyLegacyEscapeHatchShrink(
      base.escapeHatches ?? [],
      current.escapeHatches ?? [],
    ),
  )
  errors.push(
    ...verifyExactEntryShrink(
      base.fastifyRegistrars ?? [],
      current.fastifyRegistrars ?? [],
      (entry) => entry.exportName,
      "Fastify registrar changed",
    ),
  )
  errors.push(
    ...verifyExactEntryShrink(
      base.webInferenceConsumers ?? [],
      current.webInferenceConsumers ?? [],
      (entry) => entry.path,
      "Web inference consumer changed",
    ),
  )
  errors.push(
    ...verifyExactEntryShrink(
      base.sourceClosure ?? [],
      current.sourceClosure ?? [],
      (entry) => entry.path,
      "production source closure changed",
    ),
  )
  errors.push(
    ...verifyExactEntryShrink(
      base.repositoryClosure ?? [],
      current.repositoryClosure ?? [],
      (entry) => entry.path,
      "repository closure changed",
    ),
  )
  if (
    JSON.stringify(base.reviewedRevisions ?? []) !==
    JSON.stringify(current.reviewedRevisions ?? [])
  ) {
    errors.push("reviewed contract revision history changed")
  }
  errors.push(...verifyRequiredWebAuthBoundary(base, current))

  return errors.sort()
}

function routeCounts(routes) {
  const counts = new Map()
  for (const route of routes) {
    const key = routeKey(route)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

function verifyLegacyEscapeHatchShrink(base, current) {
  return verifyExactEntryShrink(
    base,
    current,
    (entry) => entry.path,
    "legacy route escape hatch changed",
  )
}

function verifyRequiredWebAuthBoundary(base, current) {
  const middlewarePath = "apps/web/src/middleware.ts"
  const baseBoundary = (base.sourceClosure ?? []).find(
    (entry) => entry.path === middlewarePath,
  )
  if (!baseBoundary) {
    return []
  }
  const currentBoundary = (current.sourceClosure ?? []).find(
    (entry) => entry.path === middlewarePath,
  )
  return JSON.stringify(currentBoundary) === JSON.stringify(baseBoundary)
    ? []
    : [
        `reviewed Web authentication boundary changed or disappeared ${middlewarePath}`,
      ]
}

function verifyExactEntryShrink(base, current, keyFor, errorPrefix) {
  const baseByKey = new Map(base.map((entry) => [keyFor(entry), entry]))
  const errors = []
  for (const entry of current) {
    const key = keyFor(entry)
    if (JSON.stringify(baseByKey.get(key)) !== JSON.stringify(entry)) {
      errors.push(`${errorPrefix} ${key}`)
    }
  }
  return errors.sort()
}

export function verifyRouteBaselineMetadata(baseline) {
  const expectedKeys = [
    "baseCommit",
    "escapeHatches",
    "fastifyRegistrars",
    "fingerprints",
    "policyDigest",
    "repositoryClosure",
    "reviewedRevisions",
    "routes",
    "schemaVersion",
    "sourceClosure",
    "target",
    "webInferenceConsumers",
  ]
  return JSON.stringify(Object.keys(baseline).sort()) ===
    JSON.stringify(expectedKeys) &&
    baseline.schemaVersion === 3 &&
    baseline.baseCommit === pr01BootstrapBase
    ? []
    : ["route baseline metadata changed"]
}

function verifyRequiredRoutes(baseline) {
  const errors = []
  const requiredSets = [
    {
      routes: baseline.target?.requiredPublicInference ?? [],
      classification: "required-now",
    },
    {
      routes: baseline.target?.requiredPrivateOperational ?? [],
      classification: "private-operational",
    },
  ]
  for (const requiredSet of requiredSets) {
    for (const required of requiredSet.routes) {
      const matches = baseline.routes.filter(
        (route) =>
          route.surface === "bff" &&
          route.method === required.method &&
          route.path === required.path &&
          route.classification === requiredSet.classification,
      )
      if (matches.length !== 1) {
        errors.push(
          `required route missing or ambiguous ${required.method} ${required.path}`,
        )
      }
    }
  }
  return errors
}

export function verifyPolicyStability(base, current, subject) {
  return base.policyDigest === current.policyDigest
    ? []
    : [`${subject} policy changed; reviewed contract revision required`]
}

export function verifyProtectedGuardrailStability(base, current) {
  return JSON.stringify(base.protectedFiles) ===
    JSON.stringify(current.protectedFiles)
    ? []
    : ["protected guardrail files changed; reviewed contract revision required"]
}

function buildProtectedGuardrailFingerprints(root) {
  return protectedGuardrailPaths.map((path) => {
    const absolutePath = resolve(root, path)
    if (!isRegularFile(absolutePath)) {
      throw new Error(`Missing protected guardrail file ${path}`)
    }
    return { path, sha256: sha256(readFileSync(absolutePath)) }
  })
}

function forbiddenPolicyDigest() {
  return sha256(
    JSON.stringify({
      revision: "PR01_FORBIDDEN_SURFACE_POLICY_V1",
      exclusions: [...guardrailExclusions].sort(),
      binaryPathPattern: {
        pattern: binaryPathPattern.source,
        flags: binaryPathPattern.flags,
      },
      protectedGuardrailPaths,
      pathRules: pathRules.map((rule) => ({
        id: rule.id,
        pattern: rule.pattern.source,
        flags: rule.pattern.flags,
        removeBy: rule.removeBy,
      })),
      contentRules,
      findingDispositionOverrides,
      ignoredFindingFingerprints,
      pr08IgnoredFindingFingerprints,
      pr04RetiredDependencyBoundaries,
      pr04StandaloneDbTestBoundary,
      implementation: [
        listCandidatePaths,
        listCachedEntries,
        assertCachedEntryIntegrity,
        scanForbiddenSurfaces,
        findingDisposition,
        filterIgnoredFindingFingerprints,
        structurallyAllowedPnpmLockFingerprints,
        verifyRetiredDataDependencyBoundary,
        analyzePnpmLockRedisBoundary,
        analyzeRootPgliteBoundary,
        verifyStandaloneDbTestBoundary,
        parsePnpmLockMappingEntries,
        unquoteYamlScalar,
        sameStringArray,
        isRetiredDataDependencyPackage,
        matchFingerprints,
        isContentScanPath,
        isGuardrailPath,
        verifyShrinkOnly,
        verifyReviewedFindingReduction,
        verifyCorePackageClosure,
        assertNoUnexpectedEnvironmentFiles,
      ].map(normalizedFunctionSource),
    }),
  )
}

function routePolicyDigest(root = repositoryRoot) {
  return sha256(
    JSON.stringify({
      revision: "PR01_ROUTE_POLICY_V1",
      methods: routeMethods,
      unsupportedFastifyMethods: [...unsupportedFastifyMethods].sort(),
      controlledFastifyMethods: [...controlledFastifyMethods].sort(),
      receiverNamePattern: routeReceiverNamePattern.source,
      bffProductionSourcePattern: bffProductionSourcePattern.source,
      productionSurfaceTestPathPattern: productionSurfaceTestPathPattern.source,
      reviewedFastifyRegistrarSpecs,
      reviewedAdminRouteCapabilities: [
        ...reviewedAdminRouteCapabilities,
      ].sort(),
      reviewedFastifySourcePaths: [...reviewedFastifySourcePaths].sort(),
      webInferenceEndpointPattern: webInferenceEndpointPattern.source,
      repositoryClosureExcludedPaths: [...generatedContractPaths].sort(),
      target: targetRouteContract,
      resolverFingerprintSpecs,
      legacyEscapeHatchSpecs,
      reviewedContractRevisions: [
        {
          id: "PR-02",
          integrationBase: pr02IntegrationBase,
          path: pr02ContractRevisionPath,
          evidencePaths: pr02RevisionEvidencePaths,
          operationPolicy: pr02OperationPolicy,
        },
        {
          id: "PR-03",
          contractBase: pr03ContractBase,
          laneAnchor: pr03LaneAnchor,
          path: pr03ContractRevisionPath,
          evidencePaths: pr03RevisionEvidencePaths,
          resolverFingerprints: reviewedPr03ResolverFingerprints,
          webAuthenticationEvidence: reviewedPr03WebAuthenticationEvidence,
          webMiddlewareMatcher: reviewedPr03WebMiddlewareMatcher,
          operationPolicy: readPr03DecisionDocument(root).operationPolicy,
        },
        {
          id: "PR-04",
          contractBase: pr04ContractBase,
          laneAnchor: pr04LaneAnchor,
          path: pr04ContractRevisionPath,
          evidencePaths: pr04RevisionEvidencePaths,
          retiredDependencyBoundaries: pr04RetiredDependencyBoundaries,
          standaloneDbTestBoundary: pr04StandaloneDbTestBoundary,
          webAuthenticationEvidence: reviewedPr04WebAuthenticationEvidence,
          reviewedDispositions: pr04ReviewedDispositions,
          operationPolicy: readPr04DecisionDocument(root).operationPolicy,
        },
        {
          id: "PR-05",
          contractBase: pr05ContractBase,
          laneAnchor: pr05LaneAnchor,
          path: pr05ContractRevisionPath,
          evidencePaths: pr05RevisionEvidencePaths,
          reviewedDispositions: pr05ReviewedDispositions,
          target: pr05TargetContract,
          standaloneDbTestBoundary: pr05StandaloneDbTestBoundary,
          allowedRepositoryPathPatterns: pr05AllowedRepositoryPathPatterns.map(
            ({ source, flags }) => ({ source, flags }),
          ),
          resolverFingerprints: reviewedPr05ResolverFingerprints,
          webAuthenticationEvidence: reviewedPr05WebAuthenticationEvidence,
          operationPolicy: readPr05DecisionDocument(root).operationPolicy,
        },
        {
          id: "PR-06",
          contractBase: pr06ContractBase,
          laneAnchor: pr06LaneAnchor,
          path: pr06ContractRevisionPath,
          evidencePaths: pr06RevisionEvidencePaths,
          reviewedDispositions: pr06ReviewedDispositions,
          target: pr06TargetContract,
          standaloneDbTestBoundary: pr06StandaloneDbTestBoundary,
          allowedRepositoryPathPatterns: pr06AllowedRepositoryPathPatterns.map(
            ({ source, flags }) => ({ source, flags }),
          ),
          retiredApplicationBoundaryPaths: pr06RetiredApplicationBoundaryPaths,
          retiredApplicationIdentifiers: pr06RetiredApplicationIdentifiers,
          resolverFingerprints: reviewedPr06ResolverFingerprints,
          webAuthenticationEvidence: reviewedPr05WebAuthenticationEvidence,
          operationPolicy: readPr06DecisionDocument(root).operationPolicy,
        },
        {
          id: "PR-07",
          contractBase: pr07ContractBase,
          laneAnchor: pr07LaneAnchor,
          path: pr07ContractRevisionPath,
          evidencePaths: pr07RevisionEvidencePaths,
          reviewedDispositions: pr07ReviewedDispositions,
          target: pr07TargetContract,
          standaloneDbTestBoundary: pr07StandaloneDbTestBoundary,
          allowedRepositoryPathPatterns: pr07AllowedRepositoryPathPatterns.map(
            ({ source, flags }) => ({ source, flags }),
          ),
          retainedFirecrawlBoundaryPaths: pr07RetainedFirecrawlBoundaryPaths,
          resolverFingerprints: reviewedPr06ResolverFingerprints,
          webAuthenticationEvidence: reviewedPr05WebAuthenticationEvidence,
          operationPolicy: readPr07DecisionDocument(root).operationPolicy,
        },
        {
          id: "PR-08",
          contractBase: pr08ContractBase,
          contractBaseTree: pr08ContractBaseTree,
          laneAnchor: pr08LaneAnchor,
          path: pr08ContractRevisionPath,
          evidencePaths: pr08RevisionEvidencePaths,
          reviewedDispositions: pr08ReviewedDispositions,
          sourceManifest: pr08SourceManifestBinding,
          sourceArtifacts: pr08SourceArtifacts,
          sourceMap: pr08SourceMapBinding,
          queryFreeLoggingFingerprints: pr08QueryFreeLoggingFingerprints,
          target: pr08TargetContract,
          standaloneDbTestBoundary: pr08StandaloneDbTestBoundary,
          allowedRepositoryPathPatterns: pr08AllowedRepositoryPathPatterns.map(
            ({ source, flags }) => ({ source, flags }),
          ),
          webAuthenticationEvidence: reviewedPr05WebAuthenticationEvidence,
          operationPolicy: readPr08DecisionDocument(root).operationPolicy,
        },
        {
          id: "PR-09",
          contractBase: pr09ContractBase,
          contractBaseTree: pr09ContractBaseTree,
          laneAnchor: pr09LaneAnchor,
          path: pr09ContractRevisionPath,
          evidencePaths: pr09RevisionEvidencePaths,
          reviewedDispositions: pr09ReviewedDispositions,
          target: pr09TargetContract,
          standaloneDbTestBoundary: pr09StandaloneDbTestBoundary,
          allowedRepositoryPathPatterns: pr09AllowedRepositoryPathPatterns.map(
            ({ source, flags }) => ({ source, flags }),
          ),
          resolverFingerprints: reviewedPr09ResolverFingerprints,
          sourceFingerprints: reviewedPr09SourceFingerprints,
          nativeIdentifierEvidence: reviewedPr09NativeIdentifierEvidence,
          webAuthenticationEvidence: reviewedPr09WebAuthenticationEvidence,
          operationPolicy: readPr09DecisionDocument(root).operationPolicy,
        },
        {
          id: "PR-10",
          contractBase: pr10ContractBase,
          contractBaseTree: pr10ContractBaseTree,
          laneAnchor: pr10LaneAnchor,
          path: pr10ContractRevisionPath,
          evidencePaths: pr10RevisionEvidencePaths,
          reviewedDispositions: pr10ReviewedDispositions,
          target: pr10TargetContract,
          standaloneDbTestBoundary: pr10StandaloneDbTestBoundary,
          allowedRepositoryPaths: pr10AllowedRepositoryPaths,
          expectedOperationPolicy: pr10ExpectedOperationPolicy,
          productionSourcePaths: pr10ProductionSourcePaths,
          generatedDestinationPaths: pr10GeneratedDestinationPaths,
          sourceEvidence: buildPr10SourceEvidence(root),
          operationPolicy: readPr10DecisionDocument(root).operationPolicy,
        },
        {
          id: "PR-10C",
          contractBase: pr10cContractBase,
          contractBaseTree: pr10cContractBaseTree,
          laneAnchor: pr10cLaneAnchor,
          path: pr10cContractRevisionPath,
          evidencePaths: pr10cRevisionEvidencePaths,
          reviewedDispositions: pr10cReviewedDispositions,
          target: pr10cTargetContract,
          allowedRepositoryPathPatterns: pr10cAllowedRepositoryPathPatterns.map(
            ({ source, flags }) => ({
              source,
              flags,
            }),
          ),
          requiredFrozenRepositoryPaths: pr10cRequiredFrozenRepositoryPaths,
          generatedDestinationPaths: pr10cGeneratedDestinationPaths,
          sourceEvidencePaths: pr10cSourceEvidencePaths,
          sourceEvidence: readPr10cDecisionDocument(root).sourceEvidence,
          operationPolicy: readPr10cDecisionDocument(root).operationPolicy,
        },
        {
          id: "PR-11",
          contractBase: pr11ContractBase,
          contractBaseTree: pr11ContractBaseTree,
          laneAnchor: pr11LaneAnchor,
          path: pr11ContractRevisionPath,
          evidencePaths: pr11RevisionEvidencePaths,
          successorHistoricalEvidenceBindings:
            pr11SuccessorHistoricalEvidenceBindings,
          pr10cSuccessorHistoricalEvidenceBindings,
          reviewedDispositions: pr11ReviewedDispositions,
          target: pr11TargetContract,
          removedRouteContract: pr11RemovedRouteContract,
          consoleHrefManifest: pr11ConsoleHrefManifest,
          retiredEnvExampleBlock: pr11RetiredEnvExampleBlock,
          allowedRepositoryPaths: pr11AllowedRepositoryPaths,
          allowedRepositoryPathPatterns: pr11AllowedRepositoryPathPatterns.map(
            ({ source, flags }) => ({ source, flags }),
          ),
          requiredFrozenRepositoryPaths: pr11RequiredFrozenRepositoryPaths,
          generatedDestinationPaths: pr11GeneratedDestinationPaths,
          sourceEvidencePaths: pr11SourceEvidencePaths,
          sourceEvidence: readPr11DecisionDocument(root).sourceEvidence,
          operationPolicy: readPr11DecisionDocument(root).operationPolicy,
        },
      ],
      implementation: [
        listCandidatePaths,
        listCachedEntries,
        assertCachedEntryIntegrity,
        verifyActiveReviewedRevisionId,
        verifyRepository,
        verifyShrinkOnly,
        verifyReviewedFindingReduction,
        extractBffRoutes,
        assertNoDynamicCodeLoading,
        assertReviewedFastifyImports,
        assertReviewedFastifyFactoryUse,
        isReviewedFastifyFactoryOptions,
        assertReviewedBuildServerDefinition,
        assertReviewedFastifyRegistrarDefinition,
        collectNamedImportBindings,
        extractFastifyRegistrarManifest,
        assertReviewedPr05RuntimeAuthorityWiring,
        collectFastifyReceiverNames,
        collectRouteHostTypeNames,
        containsRouteHostMember,
        isCallableRouteHostMember,
        isRouteHostType,
        assertNoRouteMethodAliases,
        isReviewedFastifyReceiverUse,
        isReviewedEmergencyIsolationBootstrapLogUse,
        isReviewedEmergencyIsolationOnReadyHook,
        isExpressionWrapper,
        containsKnownFastifyReceiver,
        isValueIdentifier,
        isReviewedFastifyRegistrarCall,
        hasReviewedFastifyRegistrarArguments,
        hasReviewedFirecrawlGatewayRegistrarArguments,
        isDirectBuildServerStatement,
        isReviewedFastifyAlias,
        isReviewedBuildServerReturn,
        isReviewedFastifyListenCall,
        isIndirectRouteMethodInvocation,
        parseRouteCall,
        parseShorthandRoute,
        assertReviewedShorthandRouteOptions,
        hasReviewedFirecrawlRouteOptions,
        parseRouteOptions,
        assertReviewedFastifyControlCall,
        assertNoFastifyRouteConstraints,
        staticHttpMethods,
        staticString,
        isTrackedFastifyReceiver,
        extractWebInferenceConsumers,
        buildProductionSourceClosure,
        buildRepositoryClosure,
        buildRepositoryClosureFromCommit,
        hashWorktreeBlob,
        isProductionSurfacePath,
        collectStaticStringConstants,
        staticStringWithConstants,
        expressionIncludesWebInferenceEndpoint,
        extractWebRoutes,
        nextMetadataRoute,
        assertNoNextRewriteRegistration,
        assertReviewedNextMiddleware,
        isConstVariableDeclaration,
        isShadowingBindingIdentifier,
        extractNextHandlerMethods,
        classifyBffRoute,
        classifyWebRoute,
        buildLegacyEscapeHatches,
        verifyLegacyEscapeHatchShrink,
        verifyRequiredWebAuthBoundary,
        verifyExactEntryShrink,
        verifyLegacyRouteShrink,
        routeCounts,
        verifyReviewedContractRevision,
        isExactRevisionAppend,
        verifyIntroducedPr03Revision,
        verifyPr03LaneLineage,
        verifyPr03BaseEvidence,
        verifyIntroducedPr04Revision,
        verifyPr04LaneLineage,
        verifyPr04BaseEvidence,
        verifyIntroducedPr05Revision,
        verifyPr05LaneLineage,
        verifyPr05BaseEvidence,
        verifyIntroducedPr06Revision,
        verifyPr06LaneLineage,
        verifyPr06BaseEvidence,
        verifyIntroducedPr07Revision,
        verifyPr07LaneLineage,
        verifyPr07BaseEvidence,
        verifyIntroducedPr08Revision,
        verifyPr08LaneLineage,
        verifyPr08BaseEvidence,
        verifyIntroducedPr09Revision,
        verifyPr09LaneLineage,
        verifyPr09BaseEvidence,
        verifyIntroducedPr10Revision,
        verifyPr10LaneLineage,
        verifyPr10BaseEvidence,
        verifyIntroducedPr10cRevision,
        verifyPr10cLaneLineage,
        verifyPr10cBaseEvidence,
        verifyIntroducedPr11Revision,
        verifyPr11LaneLineage,
        verifyPr11BaseEvidence,
        verifyRetainedPr02RevisionEvidence,
        verifyRetainedPr03RevisionEvidence,
        verifyRetainedPr04RevisionEvidence,
        verifyRetainedPr05RevisionEvidence,
        verifyRetainedPr06RevisionEvidence,
        verifyRetainedPr07RevisionEvidence,
        verifyRetainedPr08RevisionEvidence,
        verifyRetainedPr09RevisionEvidence,
        verifyRetainedPr10RevisionEvidence,
        verifyRetainedPr10cRevisionEvidence,
        verifyRetainedPr11RevisionEvidence,
        verifyPr02OperationMatrix,
        verifyExactMultisetSubset,
        verifyPr02EscapeHatches,
        verifyPr02SourceChanges,
        verifyPr02RepositoryChanges,
        verifyPr02ClosureChanges,
        readPr03DecisionDocument,
        verifyPr03DecisionDocument,
        readPr04DecisionDocument,
        verifyPr04DecisionDocument,
        readPr05DecisionDocument,
        verifyPr05DecisionDocument,
        verifyPr05OperationBoundary,
        readPr06DecisionDocument,
        verifyPr06DecisionDocument,
        verifyPr06OperationBoundary,
        readPr07DecisionDocument,
        verifyPr07DecisionDocument,
        verifyPr07OperationBoundary,
        readPr08DecisionDocument,
        readPr08SourceManifestDocument,
        verifyPr08SourceManifestDocument,
        verifyPr08SourceMapDocument,
        verifyPr08DecisionDocument,
        verifyPr08OperationBoundary,
        verifyPr08PilotAncestry,
        verifyPr08QueryFreeLoggingBoundary,
        readPr09DecisionDocument,
        verifyPr09DecisionDocument,
        verifyPr09OperationBoundary,
        readPr10DecisionDocument,
        buildPr10SourceEvidence,
        verifyPr10DecisionDocument,
        verifyPr10OperationBoundary,
        verifyPr10GeneratedDestinationBoundary,
        verifyPr10HistoricalFixtureRepair,
        readPr10cDecisionDocument,
        buildPr10cSourceEvidence,
        verifyPr10cDecisionDocument,
        verifyPr10cOperationBoundary,
        verifyPr10cGeneratedDestinationBoundary,
        readPr11DecisionDocument,
        buildPr11SourceEvidence,
        verifyPr11DecisionDocument,
        verifyPr11OperationBoundary,
        verifyPr11GeneratedDestinationBoundary,
        buildExactClosureOperationPolicy,
        buildClosurePathOperations,
        verifyPr03FindingTransition,
        verifyPr03CandidateContract,
        verifyPr03RetainedRouteContract,
        verifyPr03ClosureChanges,
        verifyPr03TargetState,
        verifyPr04FindingTransition,
        verifyPr04CandidateContract,
        verifyPr04RetainedRouteContract,
        verifyExactClosureChanges,
        verifyPr04TargetState,
        verifyPr05FindingTransition,
        verifyPr05CandidateContract,
        verifyPr05RetainedRouteContract,
        verifyPr05TargetState,
        verifyPr06FindingTransition,
        verifyPr06CandidateContract,
        verifyPr06RetainedRouteContract,
        verifyPr06TargetState,
        verifyPr06RetiredApplicationBoundary,
        verifyPr07FindingTransition,
        verifyPr07CandidateContract,
        verifyPr07RetainedRouteContract,
        verifyPr07TargetState,
        verifyPr07RetainedFirecrawlBoundary,
        verifyPr08FindingTransition,
        verifyPr08CandidateContract,
        verifyPr08RetainedRouteContract,
        verifyPr08TargetState,
        verifyPr09FindingTransition,
        verifyPr09CandidateContract,
        verifyPr09RetainedRouteContract,
        verifyPr09TargetState,
        verifyPr09SourceBoundary,
        verifyReviewedPr09SourceFingerprints,
        verifyReviewedPr09NativeIdentifierEvidence,
        verifyPr10CandidateContract,
        verifyPr10RetainedRouteContract,
        verifyPr10TargetState,
        verifyPr10SourceBoundary,
        verifyPr10cCandidateContract,
        verifyPr10cRetainedRouteContract,
        verifyPr10cTargetState,
        verifyPr10cSourceBoundary,
        verifyPr11CandidateContract,
        verifyPr11RetainedRouteContract,
        verifyPr11TargetState,
        verifyPr11SourceBoundary,
        extractPr11ConsoleHrefManifest,
        buildPr11ConsoleHrefManifest,
        verifyPr11ConsoleHrefManifest,
        verifyPr11ConsoleSourceLinkBoundary,
        verifyPr11ExpertPayloadSourceBoundary,
        verifyPr11OverviewHrefContractSource,
        verifyPr11OverviewRouteParseBoundary,
        verifyPr11EnvExampleTransition,
        verifyPr11EnvExampleWorktree,
        isPr11ConsoleProductionSourcePath,
        comparePr11HrefEntries,
        normalizePr11SourceExpression,
        normalizePr11CompactSource,
        pr11SchemaPropertyInitializer,
        pr11ZodStringEnumValues,
        routeCountsByClassification,
        verifyReviewedWebAuthenticationEvidence,
        verifyReviewedPr04WebAuthenticationEvidence,
        verifyReviewedPr05WebAuthenticationEvidence,
        verifyWebAuthenticationBoundary,
        verifyExactPathPolicy,
        uniqueEntriesByPath,
        verifyBaseCommitLineage,
        buildContractRevisionDocument,
        buildEntryChanges,
        groupEntries,
        routeManifestKey,
        buildReviewedRevisionFingerprints,
        buildRevisionEvidenceFingerprints,
      ].map(normalizedFunctionSource),
    }),
  )
}

function normalizedFunctionSource(subject) {
  return subject.toString().replaceAll("\r\n", "\n")
}

function matchFingerprints(rule, source) {
  const fingerprintCounts = new Map()
  for (const rawLine of source.replaceAll("\r\n", "\n").split("\n")) {
    const line = rawLine.trim().replace(/\s+/g, " ")
    const expression = new RegExp(rule.pattern, rule.flags)
    for (const match of line.matchAll(expression)) {
      const fingerprint = sha256(
        `${rule.id}\0${line}\0${String(match[0]).toLocaleLowerCase("en-US")}`,
      )
      fingerprintCounts.set(
        fingerprint,
        (fingerprintCounts.get(fingerprint) ?? 0) + 1,
      )
    }
  }
  return Object.fromEntries(
    [...fingerprintCounts].sort(([left], [right]) => left.localeCompare(right)),
  )
}

function isContentScanPath(path) {
  if (isGuardrailPath(path)) {
    return false
  }
  return true
}

function isGuardrailPath(path) {
  return guardrailExclusions.has(path)
}

function nextRoutePath(prefix) {
  const trimmed = prefix.replace(/\/$/, "")
  return trimmed ? `/${trimmed}` : "/"
}

function isRegularFile(path) {
  return existsSync(path) && statSync(path).isFile()
}

function currentHead(root) {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim()
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"))
}

function readJsonFromCommit(root, commit, path) {
  if (!/^[0-9a-f]{40,64}$/.test(commit)) {
    return null
  }
  try {
    return JSON.parse(
      execFileSync(
        "git",
        [
          "show",
          "--no-ext-diff",
          "--no-textconv",
          "--end-of-options",
          `${commit}:${path}`,
        ],
        {
          cwd: root,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        },
      ),
    )
  } catch {
    return null
  }
}

function resolveCommit(root, ref) {
  if (typeof ref !== "string" || ref.length === 0) {
    return null
  }
  try {
    const commit = execFileSync(
      "git",
      ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`],
      {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    ).trim()
    return /^[0-9a-f]{40,64}$/.test(commit) ? commit : null
  } catch {
    return null
  }
}

export function verifyBaseCommitLineage(
  root,
  baseCommit,
  dirtySameHeadBase = [
    pr02IntegrationBase,
    pr04ContractBase,
    pr05ContractBase,
    pr06ContractBase,
    pr07ContractBase,
    pr08ContractBase,
    pr09ContractBase,
    pr10ContractBase,
    pr10cContractBase,
    pr11ContractBase,
  ],
) {
  const head = currentHead(root)
  if (baseCommit === head) {
    const allowedDirtyBases = Array.isArray(dirtySameHeadBase)
      ? dirtySameHeadBase
      : [dirtySameHeadBase]
    if (!allowedDirtyBases.includes(baseCommit)) {
      return [
        `base ref must be a proper ancestor outside the fixed precommit bases ${baseCommit}`,
      ]
    }
    const candidateChanges = execFileSync(
      "git",
      ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
      {
        cwd: root,
        encoding: "buffer",
      },
    )
    if (candidateChanges.length > 0) {
      return []
    }
    return [
      `base ref must be a proper ancestor of clean candidate HEAD ${baseCommit}`,
    ]
  }
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", baseCommit, head], {
      cwd: root,
      stdio: "ignore",
    })
    return []
  } catch {
    return [`base ref is not an ancestor of candidate HEAD ${baseCommit}`]
  }
}

function resolveTree(root, commit) {
  if (!/^[0-9a-f]{40,64}$/.test(commit)) {
    return null
  }
  try {
    const tree = execFileSync(
      "git",
      ["rev-parse", "--verify", "--end-of-options", `${commit}^{tree}`],
      {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    ).trim()
    return /^[0-9a-f]{40,64}$/.test(tree) ? tree : null
  } catch {
    return null
  }
}

function isFingerprintSubset(subject, superset) {
  for (const [fingerprint, count] of Object.entries(subject)) {
    if ((superset[fingerprint] ?? 0) < count) {
      return false
    }
  }
  return true
}

function findingKey(entry) {
  return `${entry.ruleId}\0${entry.path}`
}

function routeKey(route) {
  return `${route.surface}\0${route.method}\0${route.path}\0${route.source}`
}

function compareFindingKeys(left, right) {
  return findingKey(left).localeCompare(findingKey(right))
}

function compareRoutes(left, right) {
  return routeKey(left).localeCompare(routeKey(right))
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

function assertNoUnexpectedEnvironmentFiles(root) {
  const excludedDirectories = new Set([
    ".git",
    ".next",
    ".pnpm-store",
    ".turbo",
    ".venv",
    "coverage",
    "dist",
    "node_modules",
    "playwright-report",
    "test-results",
  ])
  const unexpected = []
  const pending = [root]
  while (pending.length > 0) {
    const directory = pending.pop()
    if (!directory) {
      continue
    }
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = join(directory, entry.name)
      if (entry.isSymbolicLink()) {
        unexpected.push(relative(root, absolutePath))
        continue
      }
      if (entry.isDirectory()) {
        if (!excludedDirectories.has(entry.name)) {
          pending.push(absolutePath)
        }
        continue
      }
      if (entry.name.startsWith(".env") && entry.name !== ".env.example") {
        unexpected.push(relative(root, absolutePath))
      }
    }
  }
  unexpected.sort()
  if (unexpected.length > 0) {
    throw new Error(
      `Unexpected environment file blocks the sanitized Core lane: ${unexpected.join(", ")}`,
    )
  }
}

export { assertNoUnexpectedEnvironmentFiles }

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : ""
if (invokedPath === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  assertNoUnexpectedEnvironmentFiles(repositoryRoot)
  if (args.includes("--print-forbidden-allowlist")) {
    printJson(buildForbiddenAllowlist())
  } else if (args.includes("--print-route-baseline")) {
    printJson(buildRouteBaseline())
  } else {
    const baseIndex = args.indexOf("--base-ref")
    const baseRef = baseIndex >= 0 ? args[baseIndex + 1] : undefined
    if (baseIndex >= 0 && !baseRef) {
      throw new Error("--base-ref requires a ref")
    }
    const result = verifyRepository({ baseRef })
    if (!result.ok) {
      for (const error of result.errors) {
        process.stderr.write(`inference-core guardrail: ${error}\n`)
      }
      process.exitCode = 1
    } else {
      process.stdout.write(
        `INFERENCE_CORE_GUARDRAILS=PASS findings=${result.findingCount} entries=${result.findingPathCount} routes=${result.routeCount} legacy_routes=${result.legacyRouteCount} base=${result.baseStatus}\n`,
      )
    }
  }
}
