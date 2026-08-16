# Inference Core reduction guardrails

This directory records the PR-01 target contract and the exact legacy
characterization that later reduction pull requests must shrink.

PR-01 was the bootstrap characterization, not a claim that the Product already
implemented the target. The accepted PR-07 baseline now retains only the two
human roles, has no legacy registered route, and records connection evidence
only from an authenticated real client request to
`GET /api/app-gateway/v1/models`. Runtime
zero-content-retention compliance remains unevaluated. PR-07 binds the source
no-content-retention contract without claiming deployed-runtime qualification.

The enforceable boundaries are:

- `packages/contracts/src/inference-core-authorization.ts` locks the two
  human roles and the explicit capability matrix. It is prospective and is
  not wired into legacy authorization yet.
- `route-baseline.json` records every current BFF and Next application route,
  public asset, and metadata surface plus fingerprints for the stable Next
  configuration and authentication route boundary. BFF route discovery parses
  JavaScript, TypeScript, CommonJS, and ECMAScript module source files. The BFF
  characterization cross-checks the runtime Fastify method, path, and
  multiplicity inventory against this baseline. Route constraints, indirect
  method references, plugins, catch-all handlers, and unreviewed global hooks
  fail closed. The Fastify factory call, factory options, `buildServer`
  definition, runtime import, registrar imports, route overloads, and server
  value uses are constrained to their reviewed forms. Passing the server to
  another helper, using dynamic code loading, or installing route controls
  from a Core workspace package fails closed.
- The baseline also freezes the complete BFF, Web, Contracts, and Copy
  production source closure, package manifests, workspace manifest, and
  lockfile by path and full-file hash. The shipped BFF and Web Docker build
  entrypoints, root Docker ignore policy, and non-test package-root build
  configuration are included. A new production file or an in-place change
  fails the base comparison. A deletion may shrink the closure, except for the
  required Web authentication boundary. Later implementation pull requests
  must update this contract visibly when a surgical removal also requires an
  edit to retained wiring.
- Alternate Next Pages Router, middleware, and configuration entrypoints fail
  closed. Non-test Web source cannot introduce middleware rewrites. The
  endpoint-string characterization records one current invocation site, the
  legacy Hub route scheduled for PR-03 removal. It is not presented as proof
  of network behavior. The full production-source closure is the enforcement
  boundary that prevents a new Console inference request without a reviewed
  contract revision.
- The route baseline freezes three current route-capable legacy escape hatches
  by full-file hash, including the complete middleware. Legacy server-side
  escape hatches may disappear on schedule but cannot change in place without
  a reviewed contract revision. The middleware cannot disappear under generic
  shrink-only rules. It must be replaced by a reviewed authentication boundary
  through an explicit guard contract revision.
- `forbidden-surface-allowlist.yaml` is JSON syntax valid under YAML 1.2. It
  records exact paths, counts, and one-way fingerprints. It has no wildcard
  exceptions. Every tracked UTF-8 text format, including the workspace
  lockfile, is scanned, while retired binary fixtures are frozen by exact file
  hash.
- `retention-characterization.json` records source-level coverage and gaps.
  The canary utility requires the complete source-scenario and artifact-class
  contract before it can report source-clear. Structured and binary artifact
  containers are scanned without JSON serialization gaps. It cannot report
  deployed-runtime compliance, and this register remains incomplete.
- `scripts/inference-core/retention-canary.mjs` generates runtime-only
  canaries and reports only safe fingerprints.

Run:

```text
corepack pnpm check:inference-core
corepack pnpm check:inference-core:base
node scripts/inference-core/pr08-contract-revision.mjs --print-operation-policy
node scripts/inference-core/pr08-contract-revision.mjs --write
corepack pnpm test:inference-core-guardrails
corepack pnpm test:inference-core-db
corepack pnpm build:inference-core
corepack pnpm typecheck:inference-core
corepack pnpm typecheck:inference-core-db
```

The package guardrail command compares against the immutable accepted PR-07
integration commit `c47ffd38661ce9a7561f967aecbb9bae15cdadf5`. It does not
follow a moving branch ref. The guardrail CLI accepts an explicit `--base-ref`
for a separately reviewed manual comparison. The comparison is a bootstrap
result in PR-01 because the integration base predates these files. From PR-02
onward, an entry or route may disappear, but a new or changed production source
file, new route, new fingerprint, increased multiplicity, reclassification,
resolver change, guard-policy change, or protected-guard file change fails.
Planned edits, route additions, and moves require a visible, reviewed contract
revision before their implementation is admitted.

PR-02 uses one fixed revision at
`contract-revisions/PR-02.json`. The revision binds the exact integration-base
commit and tree, policy digests, forbidden-finding reductions,
protected-file changes, route inventory, registrar inventory, Web inference
consumers, production source closure, the repository-wide Git path/blob delta,
legacy escape hatches, and the hashes of the PR-02 decision and boundary-test
evidence. Regenerate it only after the implementation is stable and every
tracked candidate change has been staged:

```text
node scripts/inference-core/pr02-contract-revision.mjs --write
```

The generator accepts no alternate base, revision ID, output path, or evidence
list, and it runs only while `HEAD` is the exact PR-02 integration base. It
precomputes all three outputs and replaces each file atomically with rollback
on a failed transaction. Verification rejects missing cached blobs and any
tracked index/worktree mismatch, recomputes the document from the integration
base and candidate tree, requires the revision history fingerprint to match,
and keeps the public inference target, resolver fingerprints, and reviewed Web
authentication boundary unchanged. PR-02 can only remove routes, registrars,
and Web inference consumers; its production-source and repository-wide edits
are constrained to explicit path matrices in the guard. Reviewed PR-02
evidence is protected and rehashed on later comparisons. The ordinary
shrink-only comparison applies again when no new reviewed revision is present.

PR-03 appends one fixed revision at `contract-revisions/PR-03.json`. Its
content base is the immutable PR-02 commit above, and its lane anchor is the
tree-identical PR-02 merge commit
`43c11ace1b80d5241cf2a6a06670fe01f49e3e10`. The generator runs only from that
lane anchor with every candidate change staged and no untracked path:

```text
node scripts/inference-core/pr03-contract-revision.mjs --write
```

Before generation, `pr-03-removal-decisions.json` must contain the reviewed
exact source and repository path matrices and have `reviewStatus` set to
`reviewed`. The generator retains the PR-01 metadata base in both generated
baselines, precomputes all three outputs, appends PR-03 after PR-02, and
replaces the revision, allowlist, and route baseline as one rollback-safe
transaction. It first proves that the PR-02 revision and its three evidence
files are byte-identical to the immutable PR-02 commit. PR-03 requires every
finding still due in PR-03 and every legacy route to be absent. Exact
disposition changes retain historical migration evidence until PR-04, the
legacy Persona seam until PR-05, and the negative `/builder` route tombstone
until PR-12 final product qualification. One exact lockfile fingerprint is
suppressed because it is a random `mcP` substring inside a pinned
`lightningcss` integrity digest; any other MCP fingerprint still fails. The
retained 79 routes, three Fastify registrars, public inference and health
routes, revised Next configuration fingerprint, and refactored Web
authentication boundary remain exact. The middleware implementation and its
behavioral test are bound by full-file SHA-256. The retired Web inference
consumer count is zero.

PR-04 appends `contract-revisions/PR-04.json` from the exact content base and
lane anchor `fb36b9de38396af79c82056963ae3f4833a12fef`. All four PR-02 artifacts and
all four PR-03 artifacts must remain byte-identical to that commit. The PR-04
generator has a read-only policy-proposal mode and a reviewed write mode:

```text
node scripts/inference-core/pr04-contract-revision.mjs --print-operation-policy
node scripts/inference-core/pr04-contract-revision.mjs --write
```

Both modes require every tracked candidate change to be staged, no untracked
path, and exact lane-anchor `HEAD`. Put the first command's canonical six path
arrays into `pr-04-data-decisions.json`, review them, and set `reviewStatus` to
`reviewed` before running `--write`. The write mode rejects any staged-path
drift and atomically replaces only the PR-04 revision, forbidden allowlist,
and route baseline.

The PR-03 middleware implementation and behavioral-test hashes remain
immutable historical evidence. PR-04 adds a successor Web-authentication
evidence pair for the current middleware and test after the retired
`/knowledge` test case is removed. PR-04 decision validation, route-policy
revision, target verification, and candidate verification bind those exact
current bytes. Changing either file requires a later reviewed contract
revision; this transition does not rewrite the PR-03 evidence or history.

PR-04 requires every finding due by PR-04 to be absent. Drizzle 0.44.2's two
optional `@upstash/redis` peer-metadata records are retained in each of two
reviewed lock contexts: the root lock and the standalone database-test lock.
They are accepted structurally only at those exact lock paths while they
remain an optional peer with the reviewed range and have no importer,
installed package, dependency, or snapshot edge. Source imports, runtime
references, environment variables, and active manifest dependencies still
fail.

PGlite 0.5.4 is confined to
`test-support/inference-core-db-tests`, which has its own workspace manifest
and lockfile and is excluded from the root pnpm workspace. Its exact manifest,
scripts, configuration files, lockfile hash, and allowed path set are guarded.
The production BFF manifest cannot depend on PGlite. The root lock may retain
only Drizzle's two optional PGlite peer-metadata records; a root importer,
resolved package, dependency, or snapshot edge fails.

PR-04 persisted the earlier optional Application threshold field without
qualifying data-plane enforcement. PR-07 replaces its former token-budget
meaning with a non-blocking alert threshold and separately qualifies optional
service-protection controls. The metadata-only PostgreSQL idempotency ledger
stores no raw key or request or response payload.
An expired pending mutation and a failed receipt finalization require
reconciliation without automatic re-execution. PR-04 does not claim a
cross-system transaction, and durable Keycloak reconciliation remains deferred
to PR-06. Audit-producer atomicity remains follow-on work in PR-05, PR-06,
PR-07, PR-09, and PR-10; PR-04 does not introduce an outbox.

The root `test` command runs the base comparison before the standalone
database tests and workspace tests. Root test and typecheck commands install
the nested test workspace from its frozen lock with lifecycle scripts disabled
before running it. Core workspace membership and each Core package build,
typecheck, and test script are exact-locked. Their pre- and post-lifecycle
companions are prohibited, so a filtered command cannot succeed without
running only the intended package command.

The filtered Core build contains Contracts, Copy, BFF, and Web. It removes
Agentic-related environment variables from the child process as a
defense-in-depth boundary. PR-03 removes the legacy Agentic adapter, reranker,
and unregistered Agentic BFF route implementations from the product source and
workspace closure.

The Core build and typecheck runner forwards only basic process paths and
locale values. Product credentials, cloud tokens, service configuration, and
other ambient environment values are not passed to the build.

Baseline generation runs the same environment-file and symlink preflight as
normal verification. Final candidate validation must run from a clean checkout
of the exact commit so the tested bytes and published Git tree are identical.

PR-05 replaces the legacy Persona seam with the two retained human roles,
`admin` and `operator`. Every registered `/api/admin/**` route has an explicit
capability or reviewed standing-Admin policy. A registered protected route
without one fails closed. Unregistered paths continue to return the normal 404
tombstone. Outside tests, every protected request resolves the subject's
current enabled state and exact effective retained role from Keycloak without
caching the identity decision. An unavailable identity authority returns 503.
Web refresh replaces role and group claims from the current access token and
does not merge stale authority.

PR-05 also introduces appliance emergency recovery. One customer-held factor
is displayed only when commissioned; only its scrypt verifier is persisted.
An enabled Operator with a current live Operator role, MFA evidence, and an
authentication age of at most 300 seconds may activate one fixed 15-minute
session for an approved reason code. The session grants Console Admin
capabilities only. It does not grant a standing Admin identity or native
Grafana, LiteLLM, or Keycloak access. Expiry and revocation are durable across
restart, and the feature has no Web UI.

Recovery-factor activation uses a process-local, non-queued verifier gate with
capacity one and a fixed limit of five admitted attempts per Operator subject
per 60 seconds. PR-12 runtime qualification supports exactly one BFF process.
Enabling multiple BFF replicas is blocked until the activation gate and attempt
window are replaced by a PostgreSQL-backed atomic counter and lease.

All Console Team mutations now reserve durable identity intent before the
live preflight and first Keycloak write. One committed unresolved journal row
is the cross-process mutex; a two-second FIFO process queue bounds local load,
and the cooperative mutation deadline is 30 seconds. Confirmed pre-write
rejection is recorded as failed. An unknown or partially applied outcome
becomes reconciliation-required and is never automatically re-executed. CSV
commit and multi-member assignment also persist an allowlisted child manifest
before any write. Each child starts unattempted, becomes conservatively unknown
before its possible write, and reaches applied only after its complete
postcondition; confirmed no-write rejection becomes failed. Parent completion
atomically requires every applicable child to be applied. Admins and Operators
are reserved role-bearing groups, and generic group operations cannot rename,
delete, or change their membership. The last enabled Operator cannot be
disabled, deleted, or changed out of the Operator role.

`infra/keycloak/inference-core-realm-seed.json` is a credential-free logical
seed for Keycloak 26.6 or later with fine-grained admin permissions v2. It
separates customer-human administration from the Console human-identity
service account, requires MFA and the `console-bff` audience, and excludes
offline access. The broad Users and non-system Groups operations that Keycloak
cannot subdivide further are recorded as accepted, service-credential-only
residuals protected by the Console single-writer and journal boundaries.
PR-12 must translate the seed into deterministic runtime packaging and pass the
exact live commissioning matrix before deployment qualification. PR-05 makes
no runtime qualification claim. Application OAuth lifecycle remains PR-06.

PR-05 appends `contract-revisions/PR-05.json` from the immutable content base
and lane anchor `9c502a6d4d79435f469288aa66001db7c4be4aa5`. Once the implementation is
stable, stage every tracked candidate path with no untracked files, print the
canonical operation policy, copy its six exact arrays into
`pr-05-identity-decisions.json`, review them, set `reviewStatus` to `reviewed`,
and generate the revision:

```text
node scripts/inference-core/pr05-contract-revision.mjs --print-operation-policy
node scripts/inference-core/pr05-contract-revision.mjs --write
```

The generator accepts no alternate base or output path. It preserves all prior
reviewed evidence byte-for-byte and atomically replaces only the PR-05
revision, forbidden allowlist, and route baseline.

PR-06 reduces Applications to one immutable inference-authentication mode per
Application, removes environment-qualified credentials, and completes static
key and OAuth client-secret lifecycle and reconciliation. The exact content
base and lane anchor are the PR-05 integration commit
`da6f0c0a2b5e477449a09527a28c7e51ef432c20`. PR-06 retains every PR-02 through
PR-05 revision and evidence file byte-for-byte.

The reviewed `pr-06-application-decisions.json` records its exact six operation
arrays and confirmed governance values. OAuth access tokens use an exact
300-second lifetime, and Application administration uses the
`dedicated-application-realm` topology. The human realm is `llm-machines`; the
Application realm is `llm-machines-applications`. Application clients inherit
the 300-second realm lifetime. The `console-application-admin` service client
has an exact 60-second client override and uses credentials separate from the
human administration service, with no credential fallback between them.

PR-06 records and guards these decisions but performs no runtime OAuth
activation and does not qualify the topology. PR-07 owns OAuth access-token
validation, runtime limit enforcement, and inference data-plane qualification.
PR-12 owns deterministic packaging and commissioning of the two-realm Keycloak
configuration. Its revision was generated only after every tracked candidate
path was staged, no untracked file remained, and the canonical operation policy
matched the reviewed six arrays:

```text
node scripts/inference-core/pr06-contract-revision.mjs --print-operation-policy
node scripts/inference-core/pr06-contract-revision.mjs --write
```

Write mode rejects a pending decision, an OAuth token lifetime other than 300
seconds, a Keycloak Application realm topology other than
`dedicated-application-realm`, or any difference between the reviewed arrays
and the staged candidate. It accepts no alternate base or output path and
atomically replaces only the PR-06 revision, forbidden allowlist, and route
baseline. The accepted PR-06 merge and all of its revision evidence are the
immutable base for PR-07.

PR-07 is scoped to qualify the public inference data plane from the exact
accepted PR-06 commit and lane anchor
`cd5a389cde949d07aa64ef7a0513cb585bb8bb7a`. It retains
every PR-02 through PR-06 revision and evidence file byte-for-byte. The public
surface remains exactly `GET /api/app-gateway/v1/models` and
`POST /api/app-gateway/v1/chat/completions`. Both static Application keys and
OAuth client-credentials tokens are accepted. OAuth validation is bound to
the dedicated `llm-machines-applications` realm and an access-token lifetime
of at most 300 seconds; human-realm tokens are not accepted for Applications.

Stable model aliases fail closed when missing or unhealthy and are never
silently substituted. Chat completions support streaming and non-streaming
transport. Tool calls are protocol payloads only and are never executed by
the appliance. Prompts, completions, streamed chunks, and tool arguments are
not retained. Only content-free accounting, health-control, and audit metadata
may persist. The source contract does not claim deployed-runtime zero-retention
qualification; that evidence remains PR-12 work.

PR-07's PostgreSQL lease and counter state is cross-process-capable by design;
independent-process and live PostgreSQL qualification remains PR-12.

Because the appliance runs on customer-owned hardware, a usage or token
threshold is a non-blocking metadata signal. Optional requests-per-second and
concurrency controls may reject work only to protect service health. Model
allowlists and context-size limits enforce per-Application permissions, and a
missing allowed alias fails closed without substitution. PR-07 produces the
metadata signals. PR-09 owns their alert presentation and delivery. PR-07 adds
no Firecrawl route, performs no Firecrawl work, and performs no runtime
deployment or qualification.

During implementation, `pr-07-data-plane-decisions.json` remains
`pending-final-staged-delta` with six empty operation arrays. After the complete
candidate is stable, stage every tracked path and leave no untracked file. Then
print the exact operation policy, copy its six arrays into the decision, review
them, set `reviewStatus` to `reviewed`, and run write mode:

```text
corepack pnpm contract:inference-core:pr07:policy
corepack pnpm contract:inference-core:pr07:write
```

Both commands require exact lane-anchor `HEAD`. Write mode rejects pending or
drifted decisions and atomically replaces only the PR-07 revision, forbidden
allowlist, and route baseline. The generated revision and baselines must not be
created from a partial or unstaged candidate.

PR-08 reconstructs only reviewed semantic units from private Firecrawl
checkpoint `ff74f3c94c563627929af31c46d48dda8e7d6192`, tree
`8a978eb0f6d0ef04a896ec29f138a84a7cf14d79`, over private base
`eeab335ab3e46add36e4efcfb4dad2b3b47a8202`, tree
`c38ca6e7ea85e454f7c191441ade7679b7ee4c41`. The Product content base and lane
anchor are the accepted PR-07 integration commit
`c47ffd38661ce9a7561f967aecbb9bae15cdadf5`, tree
`6071f1aa62690c509346cf1af7017a4cc669d28b`. Pilot commits are not merged or
cherry-picked, pilot ancestry is forbidden, and migration `0027` is excluded.
The source manifest binds exact reviewed commits and source artifacts. The
JSONL source map binds each reconstructed target file to its reviewed semantic
units.

The public T2 surface adds exactly authenticated `POST /v2/search` and
`POST /v2/scrape`; every other Firecrawl route and method remains absent. The
public inference routes do not change. Six authenticated Application admin
routes cover enable, policy update, passive test, credential rotation,
disable, and credential revoke. They remain control-plane routes and do not
expand public T2. Firecrawl is installed but disabled per Application by
default and uses its own static credential namespace with no automatic expiry
and an exact 86,400-second retiring overlap. Admin accepts a versioned
outbound-processing disclaimer to enable or re-enable. Admin may passively
test, rotate, revoke, disable, enable, and change policy. Operator access is
read-only. F0-U2 supersedes the earlier role split for current Product behavior
without rewriting the historical PR-08 record.

F0-P1 binds the local reduced-Core functional lane to the real Product
migration and a disposable PostgreSQL 17.6 instance. Actual Console Web and
BFF preserve encrypted opaque sessions, Applications, safe credential and
usage metadata, audit metadata, and per-Application Firecrawl state across one
controlled BFF restart. A configured but unavailable database degrades
readiness within a bounded interval and recovers without state corruption.
Workload and secret canaries remain absent from PostgreSQL, logs, temporary
files, and teardown artifacts. This is local functional evidence only, not
exact-Core, backup/restore, real-service, release, or Q0 qualification.

F0-O1 proves the retained Console observability projection through actual Web
and BFF code with private deterministic LiteLLM, Prometheus, and Alertmanager
doubles. Admin and Operator receive the same read-only view of safe LiteLLM
health, models, usage, route, and credential metadata plus curated hardware
signals and metadata-only alerts. Source failure is controlled and recoverable.
Grafana, native LiteLLM, and Keycloak Admin access remain absent. Queue depth
remains explicitly unconfigured rather than synthesized. This is local browser
evidence only, not real-service, exact-Core, or Q0 qualification.

F0-I1 replaces only the deterministic identity dependency for a bounded local
browser lane with the exact pinned Keycloak 26.7.0 image. It proves password
and TOTP login, retained role mapping, native identity-route handling, native
administration denial, logout, and separation between Keycloak cookies and
opaque Console session material through the existing Product identity
allowlist. The container, realm, and credentials are disposable. Refresh
expiry, reuse, concurrency, clock skew, and outage behavior remain deterministic
F0-S1 evidence until synchronized-clock runtime qualification. Production realm
commissioning, scoped identity mutations, exact-Core behavior, and Q0 remain
separate gates.

F0-I2 adds the bounded Console identity-mutation proof that F0-I1 deliberately
left open. Actual Web and BFF use exact Keycloak 26.7.0 and disposable
PostgreSQL while an isolated `console-human-admin` service account receives the
reviewed FGAP v2 Users and Groups permissions. Admin creates an Operator through
the Team UI, rotates the one-time local password, and disables and reactivates
the account. Operator stays read-only. Realm administration, client
administration, direct role mapping, impersonation, and native Keycloak Admin
access remain denied. The durable identity journal and audit store retain only
approved metadata, and generated passwords do not survive in Product state or
teardown files. This remains local functional evidence, not commissioning,
exact-Core, backup/restore, Product acceptance, or Q0 qualification.

F0-L2 replaces only the inference gateway double in a bounded local lane with
the exact pinned LiteLLM v1.85.0 image and disposable PostgreSQL metadata
storage. Product-issued Application credentials still terminate at the API
authority; a separate throwaway routing key is private to the BFF and LiteLLM.
Actual non-streaming and streaming Chat Completions reach deterministic
inference, while the Console reads health, served models, usage, route summary,
and safe credential metadata without route or virtual-key mutation. Native
LiteLLM paths remain absent from Product ingress, outage and recovery fail
closed, and prompt and response canaries remain absent from LiteLLM storage,
logs, browser state, and teardown artifacts. This is local functional evidence,
not SGLang, production capacity, exact-Core, Product acceptance, or Q0
qualification.

F0-F2R is the prospective owning-package correction discovered while replaying
F0-L2R on native Linux/amd64. It makes the generated non-secret egress
allowlist explicitly readable by the non-root Squid process even under a
restrictive host umask, and makes the local deterministic client connect to
loopback while preserving the exact API and Firecrawl Host authorities. The
same exact allowlist, source-built reduced Firecrawl, SearXNG, and Squid images
then pass default-off, enablement, credential isolation, actual search, static
scrape, rotation, revocation, unsupported-route denial, retention, and cleanup
on VM117. No provider credential, hostname, egress grant, license, Product
route, or customer boundary changes. Historical F0-F2 evidence remains
unchanged, and this is not Product acceptance or runtime qualification.

F0-C1 combines the already proven functional lanes under one disposable
command. Actual Console Web and BFF authenticate through exact Keycloak 26.7.0,
use the real Product migration in PostgreSQL, route Application inference
through private LiteLLM v1.85.0 to deterministic inference, and expose actual
reduced Firecrawl only after per-Application enablement. Actual Prometheus,
Alertmanager, and private Grafana start as retained observability components,
but no native customer route or link is created. The four customer authorities,
credential lifecycle, one controlled BFF restart, metadata-only persistence,
zero-content canaries, and complete teardown are exercised together. Native
service bindings are loopback-only test controls, so this is integrated local
functional evidence rather than exact Product Nginx, VM103, SGLang, release,
or Q0 qualification.

F0-SG1 binds an authorized internal compatibility smoke to exact SGLang 0.5.13
source, a digest-bound linux/amd64 Intel XPU image, an exact public model
revision and artifact digest, and exact private LiteLLM v1.85.0. Direct and
private-gateway streaming and non-streaming Chat Completions, token accounting,
model and context denial, controlled outage and same-image recovery, LAN
isolation, and zero-content canaries pass. Existing internal workloads and data
were preserved before being stopped. The accelerator remains internal
demonstration evidence only: capacity is unmeasured, no delivery profile is
admitted, and no production hardware, release, Product acceptance, or Q0 claim
is made. F0-V1 is the final pre-Genesis package.

F0-V1 is the governance-only aggregate closure for the protected functional
sequence. It binds the exact candidate and integration identities for F0-E0
through F0-SG1, preserves the intervening PR-12 Firecrawl history, fixes the
reduced startup map, and requires the complete repository and disposable
integrated browser/API lanes to pass again from a clean detached clone. Its
presence in source does not accept the Product, qualify runtime, activate a
contract, publish a Genesis snapshot, or start Q0. Only a protected integration
merge whose tree equals the independently reviewed candidate tree can be named
as the pre-Genesis source candidate, and publication still requires separate
approval.

F0-V2 is the governance-only founder-handover closure after F0-V1. It binds
protected PRs 65 through 74: the operator-controlled linux/amd64 UAT lane, its
five narrowly owned startup corrections, the standard OpenAI SDK customer
journey, the headed Console review, the Team and Activity correction, and the
actual Firecrawl readiness projection. The environment contains actual Console
Web and BFF, PostgreSQL migrations, Keycloak 26.7.0, private LiteLLM 1.85.0,
reduced Firecrawl 2.11.0 with SearXNG and exact egress control, retained private
observability, and deterministic inference. It remains private and running only
for founder evaluation under explicit operator lifecycle control.

The preserved F0-SG1 profile remains exact internal Intel-XPU compatibility
evidence. It is loopback-only on a separate internal host. F0-V2 does not
silently add a cross-host tunnel or network authority to replay the full
Product-issued credential path, so that composite remains a separate internal
subgate and makes no production-capacity claim. F0-V2 does not accept or
runtime-qualify the Product, activate a contract, publish Genesis, resume D2A,
start Q0, or change Product main. Only a later explicitly approved Genesis
publication may use the protected integration merge whose tree equals the
fully reviewed F0-V2 candidate tree.

System-managed exact-host egress allowlisting and public-address validation do
not introduce customer URL Governance. The governed internal upstream is
exactly `http://firecrawl-api:3002`; hosted, HTTPS, alternate-host, and
alternate-port upstreams fail closed. Query terms, target and final URLs,
pages, bodies, results, tool arguments, cookies, screenshots, and history are
prohibited from retained Product state. BFF source-level request logging is
query-free and collapses every unsupported `/v2` pathname to
`/v2/[unsupported]`. PR-08 does not claim that the native Firecrawl runtime has
proven zero retention: removal or isolation of its content-bearing logger and
span sinks, followed by runtime canaries, remains a PR-12 release gate. PR-08
is source-only and never deploys an intermediate candidate. The combined
Application UI remains hidden until PR-11. Three exact Web test fixtures may
add the disabled Firecrawl contract projection for compatibility, but every
Web production path remains forbidden. Final images, signing, offline packet,
SBOM, corresponding-source delivery, runtime deployment, and runtime
qualification remain PR-12.

The reviewed PR-08 decision binds the six exact operation arrays generated
from the final staged delta. Contract generation is staged-only and
deterministic. From exact lane-anchor `HEAD`, stage every tracked candidate
path, leave no untracked path, verify that the printed policy matches the
reviewed decision, and run write mode:

```text
node scripts/inference-core/pr08-contract-revision.mjs --print-operation-policy
node scripts/inference-core/pr08-contract-revision.mjs --write
```

Write mode verifies immutable PR-02 through PR-07 evidence, source manifest
and source map bindings, no pilot ancestry, the exact route and registrar
surface, the source-only package boundary, and the reviewed operation policy.
It atomically writes only `contract-revisions/PR-08.json`, the forbidden
allowlist, and the route baseline. Do not run it for a partial candidate.

PR-10C is the source-only emergency-isolation successor to accepted PR-10
commit `f29ea2a0c69871973ea553d3edf83b783d6c9879`, tree
`991109ad85e0c454af62ed42c4a5a69068b301e0`. It preserves every PR-02 through
PR-10 revision and evidence file byte-for-byte. The only added HTTP surface is
exactly `GET /api/admin/isolation`, `POST /api/admin/isolation/activate`, and
`POST /api/admin/isolation/deactivate`, all classified as current Console
seams. Status uses `console.operational.view` for Admin and Operator. Both
mutations require a standing Admin, reject an emergency-elevated Operator, and
require Keycloak authentication no older than 300 seconds with at least one
approved method present in `amr`: `otp`, `hwk`, `webauthn`, or
`webauthn-passwordless`.

The global singleton state fails closed whenever it is not inactive. State,
audit, and idempotency finalization share one PostgreSQL transaction.
Activation fences new inference and Firecrawl admissions, signals in-process
work to abort, and reaches active only after local leases reach zero. Restore
persists and reads back `recovery_required` immediately after `journal.begin`
returns `created`, before any `prepareRestore` validation or quiesce. Only
manifest rejection before journal admission is exempt. The restore then holds
and reasserts the isolation fence. Every admitted restore ends durable
`recovery_required`, unconditionally. After every applied or partial restore
failure settlement, `recovery_required` is reasserted before any return or
resume. The two existing inference routes and two existing Firecrawl routes do
not change.

Deactivation reserves a sealed, zero-lease generation while its durable
transaction commits. Admissions during that reservation are denied without
invalidating it. The local gate opens synchronously only after the transaction
has durably committed `inactive`; a concurrent later activation waits for that
commit boundary and then seals traffic again.

Restore safety also requires an operation-scoped marker authority outside the
Console restore set. A missing, malformed, unavailable, or unbound authority
keeps admissions sealed and makes Admin status unavailable. The process hold
is acquired synchronously, the marker is persisted and read back before the
Console recovery row, and startup reconciles any retained marker before it can
trust a restored inactive row. Activation and deactivation cannot cross the
marker boundary. Close verifies current Console `recovery_required`, releases
the process hold while the durable marker still blocks traffic, then uses an
exact-operation compare-clear that confirms durable absence. PR-12 owns the
concrete non-restorable backend and its live qualification.

Startup also treats an admitted restore without a completed fence event as a
durable recovery obligation. A prepared, unfenced restore is locked,
revalidated, and compare-and-set to `recovery_required` before any validation
or adapter write; reconciliation is recorded idempotently only after Console
recovery is forced and read back. A surviving marker is cleared only for its
matching terminal restore. Missing, unresolved, invalid, or unavailable
lifecycle ownership retains the marker and keeps traffic sealed.

PR-10C remains `runtimeQualified: false`. PR-12 owns live topology, firewall
and no-bypass enforcement, live in-flight drain and abort qualification,
deployment, and production qualification. PR-10D owns vendor maintenance
access. No intermediate deployment or generated contract artifact is allowed.

During implementation the decision remains `pending-final-staged-delta` with
six empty operation arrays and no source hashes. After every product and
governance path is final, stage the exact candidate, leave no untracked path,
print the operation policy, copy its six arrays and current source hashes into
the decision, review it, and only then run write mode:

```text
corepack pnpm contract:inference-core:pr10c:policy
corepack pnpm contract:inference-core:pr10c:write
```

Policy mode derives the exact staged closure. Write mode rejects a pending or
drifted decision and atomically writes only `contract-revisions/PR-10C.json`,
the forbidden allowlist, and the route baseline. Do not stage those generated
destinations before generation, and do not run write mode from a partial
candidate.

PR-11 is the source-only retained Console information-architecture successor
to accepted PR-10C integration commit
`6efab17a6f5f6a474a1dfe1444dcdd63e4973dd7`, tree
`44d6fb34db5f3d35e8b2f9bd2259756aec63b8a8`. It preserves every prior
revision and evidence fingerprint. The decision and validation registers are
live indexes, so their original PR-08 bytes remain resolved from the accepted
base through two explicit successor-historical bindings when PR-11 appends its
updates. No prior revision document is rewritten.

The Console navigation contains exactly these ordered logical surfaces:
Overview, Applications, Inference, Hardware, Team, Activity & Audit, and
Settings. `/` renders the source-backed Overview directly. Applications
combines inference and Firecrawl controls while retaining distinct inference
and Firecrawl credential namespaces and Firecrawl's default-off state.

Grafana, LiteLLM, and Keycloak remain reduced previews. PR-11 removes native
access affordances and does not embed live expert-service URLs in product
navigation. PR-12 owns native no-bypass qualification. Portainer, Agentic,
Chat, Knowledge, MCP, Builder, Hub, and their retired loaders, redirects,
links, and bundle imports remain absent from the product surface.

This native-access boundary is fail-closed. The exact production Console href
manifest is reviewed, Overview tile and activity hrefs accept only internal
paths, the BFF contract-parses the Overview response, and expert-service URL
payload fields are null-only. Literal URLs, renamed href expressions, broad
Overview href schemas, and non-null expert URL producers fail validation.

PR-11A R1-C0 corrects the Product authority model before any session, edge,
signing, storage, or optional Grafana package begins. LiteLLM remains private
and Console projects only health, served models, usage, route summary, and safe
credential metadata. Console has no LiteLLM route or virtual-key mutation
authority. Keycloak remains the private identity provider; approved basic
identity actions continue through Console, while customer roles receive no
native Keycloak Admin Console. Grafana remains absent and unqualified.

The R1-C0 decision and validation register entries are deliberately marked
unaccepted and not revision-bound. The package does not generate a final
PR-11A contract revision, claim completion, deploy, bind runtime configuration,
or admit any later R1 package.

PR-11A R1-S1 replaces browser-held access and refresh tokens with one opaque
`__Host-llm-machines-session` handle. The BFF retains encrypted token custody
in PostgreSQL, serializes rotation under a database row lock, and exposes only
the minimum Admin or Operator identity projection to the Web tier. The source
contract fixes a 5-minute access token, 30-minute idle session, 8-hour maximum
session, one-time rotating refresh tokens, Authorization Code with PKCE S256,
no offline browser tokens, one refresh and one request replay, and fresh MFA
for the exact retained high-risk actions.

Terminal session states clear local browser custody and redirect once to the
sign-in page with an explicit expired state and one normalized same-origin
return path. Identity or session-storage outages preserve the opaque cookie
and render a controlled retryable unavailable page instead of logging the user
out or creating a redirect loop. Explicit logout clears browser custody before
best-effort server and identity revocation. Refresh-failure telemetry contains
only a reason and a short non-secret session reference.

R1-S1 remains source-only and unaccepted. Keycloak 26.7.0 behavior, refresh
reuse detection, back-channel logout, MFA, restart, outage, and clock-skew
behavior require Q0 runtime qualification. R1-E1, R1-K1, R1-D1, optional
R1-G1, aggregate R1-V1 acceptance, and PR-12 remain disabled. The accepted
PR-11 route baseline and contract revision are not rewritten, and no
`PR-11A.json` is generated by this package.

PR-11A R1-E1 owns only the mandatory source reference for one Product edge.
The edge has two exact public host identities: the Console/API host and the
normal Keycloak identity host. It routes retained Console pages and sessions,
the two inference endpoints, the two Firecrawl endpoints, and the minimum OIDC
browser and server dependencies to fixed internal upstreams. LiteLLM remains
behind the BFF, and Grafana, the Keycloak Admin Console, Prometheus,
Alertmanager, and native Firecrawl have no customer hostname or edge route.

The reference policy drops client headers before rebuilding an explicit
per-surface set, rejects unsafe raw paths and unknown routes, disables request
and response buffering and proxy caching, and writes metadata-only access
records without the target, query, headers, cookies, authorization, or body.
Its deterministic harness is source evidence only. Direct network, firewall,
TLS, DNS, and native-listener no-bypass remain `NOT_EVALUATED_RUNTIME` until
Q0 qualifies the packaged appliance. R1-E1 does not activate the edge, expose
Grafana, change live infrastructure, bind a credential, generate
`PR-11A.json`, or begin R1-K1, R1-D1, R1-V1, or PR-12.

F0-E0 is the current pre-Genesis successor to the historical R1-E1 public-host
topology. It assigns Console, API, identity, and Firecrawl to four distinct
public authorities on TCP 443. It preserves normal Console and Keycloak login,
keeps every native administration and service listener private, and rejects
every Nginx location not present in the exact source inventory. The Application
realm token endpoint alone accepts HTTP Basic client authentication. Customer
credential metadata names an origin-only API authority, never a path-prefixed
gateway. The original R1-E1 decision, source identities, and closeout tests
remain immutable evidence rather than being rewritten to describe F0-E0.

PR-11A R1-K1 is admitted as the separate signing-custody and public-trust
source package. It preserves the offline hardware-backed vendor release root,
separate release-artifact, update-bundle, and offline-entitlement purposes,
and the customer-owned per-appliance Ed25519 audit-export purpose. Vendor
private signing material is forbidden on the appliance, in Git, in CI
environment variables, and in cloud signing dependencies. The vendor
algorithm, hardware device, custodians, issuer and `kid` namespaces, and real
validity and revocation distribution remain PR-12 and Q0 inputs.

The audit-export private key remains a root-only mounted secret, encrypted at
rest and TPM-sealed where available, with a customer-held recovery envelope.
R1-K1 may add strict public trust parsing, purpose and lifecycle verification,
and synthetic tests, but it may not create or bind real keys, mounts, TPM
state, recovery material, deployment, or runtime configuration. Missing or
invalid audit signing material remains an export-only `503`; inference, audit
ingestion, and audit view continue. R1-K1 remains unaccepted and does not
generate `PR-11A.json`.

PR-11A R1-D1 is admitted as the separate source-only storage, backup,
retention, and recovery package. ZFS-backed appliance storage remains a
Product requirement with distinct `product_state`, `databases`, `models`,
`logs`, and `staging` datasets. Local snapshots never count as backups.
Encrypted, versioned restic backups use a separate customer-owned mounted
filesystem, a daily default, 30-day retention, and root-only mounted files for
the repository locator and password. Neither value may be inline or carried
through environment variables.

The restic input is an explicit allowlist of Product configuration, identity
mappings, credential verifier state and safe metadata, retained service
configuration exports, audit records, and entitlement and update state.
Models remain excluded pending a separate model-recovery decision. Logs,
staging, caches, temporary and crash artifacts, one-time plaintext
credentials, every private signing key, and the audit recovery envelope are
also excluded. Deterministic zero-content canaries cover the input manifest,
cache, temporary, staging, backup-log, and restored-tree boundaries.

R1-D1 defines and validates source contracts only. It does not invoke ZFS or
restic, create a pool, dataset, mount, repository, backup target, snapshot, or
restore, bind a secret, or claim runtime evidence. A clean restore from the
separate target remains a Q0 release gate. MinIO, SeaweedFS, generic S3, and
unused object-store adapters remain absent. R1-D1 is unaccepted and does not
generate `PR-11A.json`. Its source candidate passed local and clean detached
fresh-clone full validation plus independent review at
`46295906c3d733b0e56abe94d9732d8eb0549c29`, but remains unaccepted, not
revision-bound, and not runtime-qualified pending R1-V1 and Q0.

The fresh R1-V1 successor closes aggregate source evidence from exact protected
integration input `0e794ccd6e0f2593f2e6ab34b8fc1d521835b6fd`, tree
`0c94b6164a81dd4da9884afa7ff2b37bd1c03079`. It binds the exact PR 13 through
PR 19 merge identities for R1-C0, R1-S1, R1-E1, R1-K1, R1-D1, the D1 hygiene
successor, and R1-H1. The blocked attempt rooted at
`cc08cf8e9afce12def143f2f395d30bfbe04f515` remains read-only historical
evidence and is not the successor base.

This successor adds only aggregate governance, deterministic evidence, and the
unaccepted `PR-11A.json` candidate. It leaves the active route baseline at
PR-11 and changes no Product behavior or runtime surface. LiteLLM remains
private with its approved Console read-only projection, and Keycloak remains a
private identity provider with basic identity mutations through Console only.
Grafana is optional and inactive, with no customer grant, hostname, route,
link, or qualification. The Console remains fully useful without it.

The immutable R1-S1 record names its pre-review source head while PR 14 merged
the governance-bound reviewed successor. The immutable R1-D1 record names the
reviewed source head while a governance-only package head preceded PR 17 and a
separate D1 hygiene successor preceded R1-H1. The aggregate evidence binds all
of those identities without rewriting either historical record.

R1-V1 successor local integrated and clean detached fresh-clone source gates
passed, followed by independent read-only review of exact candidate
`fb5ac5be13012a3de5e2da733bdc83c7d82efed3`, tree
`acc4f5540ebc863bd53e76aae8af3bcdd40136bb`. PR 20 admitted that candidate at
protected integration commit `837c3c3e139fd6b82db650d20a4f0fcf902e2fda`
with the identical tree and an empty candidate-to-merge diff. The separate
`pr-11a-r1-v1-source-closure.json` record therefore marks PR-11A source-closed
and revision-bound to that integration commit. Product and runtime acceptance
is not asserted: accepted remains false, runtimeQualified
remains false, contract activation remains inactive, and Q0 remains
NOT_STARTED. Grafana qualification and PR-12 remain NOT_STARTED. No runtime,
deployment, Product main transition, or later package is authorized by source
closure.

PR-11 permits one environment-template transition: `.env.example` deletes the
exact retired `INFERENCE_MODEL_UPDATE_*` block from the accepted base. It may
not add a line, change a retained value, remove unrelated content, or admit any
other environment path.

Settings mutations require PostgreSQL outside explicit fixture mode. The
settings write, idempotency receipt, and success audit commit in one database
transaction through the shared audit writer. Missing persistence or receipt
coordination returns unavailable and cannot emit a false success audit. Fresh
databases seed a schema-valid telemetry preview, and production parsing remains
strict with no fallback data.

Production Web responses use a per-request script nonce. Middleware forwards
the same nonce-bearing content security policy to Next.js and returns it on the
response, while production `script-src` permits neither `unsafe-inline` nor
`unsafe-eval`. The reviewed resolver transition changes only
`apps/web/next.config.ts` from SHA-256
`58f841f6ee4170e90c110e33727d85dabe6a2c096784b05940319d770a958f8b` to
`79a28582d628e566baa4231d4a718173cf4e9dde14242bc40e214d502262dbb3`.

PR-11 removes exactly one simulated route,
`POST /api/admin/inference/model-updates/apply`, with no replacement or
reclassification. The resulting inventory is 104 routes, including 92
`current-console-seam` routes; all other classification counts and Fastify
registrars remain unchanged. PR-11 does not change public inference,
Firecrawl, isolation, authorization, retention, runtime, deployment,
signing-key, or vendor-maintenance boundaries. The reviewed decision binds 2
added and 27 changed source-closure paths, 11 added and 54 changed repository
paths, no deleted path, and exact hashes for all 56 changed product-source and
test files. The reproducible generator commands are:

```text
corepack pnpm contract:inference-core:pr11:policy
corepack pnpm contract:inference-core:pr11:write
```

Policy mode derives the exact source and repository closure transition from
the frozen candidate. Write mode rejects a pending or drifted decision and
atomically writes only `contract-revisions/PR-11.json`, the forbidden
allowlist, and the route baseline. The reviewed PR-11 output was generated only
after the exact policy, source hashes, route reduction, and predecessor
evidence passed.

## PR-12 source closure

PR-12 freezes deterministic release-packaging source at protected integration
commit `80ecb127ecda73f3711903957e7e883aa19bad63`, tree
`1c5134fbe75a49148a8db2dcb7872448368f326e`. The aggregate evidence records the
exact PR 22 through PR 32 package chain, package and merge trees, changed paths,
selected source fingerprints, SGLang 0.5.13 contract, Core image inventory,
Firecrawl reproducibility packet, supply-chain evidence, clean seeds, public
verification, clean-room installer, and prepare-only rollback tooling.

Reviewed aggregate candidate `d156216054e15e7f970ad909743aa1712f8347c9`,
tree `1c2d55575bfc1a40586ffecc6cc63147f2e3773d`, passed local and clean detached
source validation plus independent review. PR 33 admitted it at protected
integration commit `5d199ee3a4fe1585a984711180605b570652ee83` with the
identical tree and no candidate-to-merge difference. PR 34 then admitted the
separate governance-only source-closeout candidate at protected integration
commit `6f7f92a2cd3f8406f73b622155dc3ad25fa8cd9e`, tree
`ba732496afc48015e0875d7cd9bf2098b710de50`.

The D2A readiness preflight found two source-closure gaps after that record.
PR 35 made every release implementation suite mandatory in the normal Product
test gate. PR 36 strengthened release admission to verify semantic CycloneDX,
SLSA provenance, vulnerability, license, and corresponding-source evidence.
The original record remains immutable evidence, but
`pr-12-source-closure-amendment-1.json` supersedes its D2A release-source input
with protected integration commit
`5d0ecf7d8a4935ebd70d6d861f919cdd551554b3`, tree
`2f2191d3326bd8777fef1cc21f41ea3fe4e335aa`.

The first D2A construction attempt then found two packaging-contract defects.
PR 38 removed customer-specific registry authority from the signed Core lock
and added a separate credential-free deployment-placement contract. PR 39
added explicit first-release no-predecessor semantics and made every later
rollback require one exact independently verified predecessor through the
public verifier and release consumers. Review-blocked rollback candidates
remain historical evidence. `pr-12-source-closure-amendment-2.json` supersedes
only the D2A release-source input with protected integration commit
`4b2fc6a3278dfad2857b5caed4fb0d6cbdafee8f`, tree
`1f9eea21ccf21d9b6fbc118f37a0d9fcb5c80d36`.

The subsequent Firecrawl build-input audit first produced PR 54, which repaired
the stale API build-test list without resolving the unavailable Node identity.
PR 55 retained Node 22.23.2-bookworm and its source revision while replacing
only the unavailable index and linux/amd64 manifest with retrievable official
immutable OCI digests. It also regenerated the corresponding-source
fingerprints from two disposable assemblies. Amendment 3 preserves PR 53,
PR 54, and every earlier protected record, supersedes only the current D2A
release-source input, and binds protected integration commit
`059866dc07dbc2af95df84ee834fca598a9a64a9`, tree
`f14535be105e8073668c922e306a317bed55b993`. The prior `4b2fc6a` release
source is historical and is not the current build input.

The remaining platform-identity audit found that the locked Golang, Wolfi,
and Playwright linux/amd64 manifests did not match the manifests selected by
their immutable indexes, and that the Golang source revision was malformed.
PR 57 corrected only those identities, bound the complete ordered build-input
set, and regenerated the corresponding-source evidence from two assemblies.
Amendment 4 preserves Amendments 1 through 3 and binds protected integration
commit `5e7761b178e7a21a7679f6b9ede834caada994b0`, tree
`38cdb571cadc19b63b13e6644efa5466c8946eef`, as the current D2A release
source. The prior `059866d` release source is historical, not current.

The first actual reduced Firecrawl image then failed to load Koffi 2.9.0 on
the admitted Wolfi runtime because its linux/x64 native module requested an
executable stack. PR 59 added a deterministic ELF program-header correction
that clears only the executable stack flag and verifies the native module
loads in the final runtime image. Amendment 5 preserves Amendments 1 through
4 and binds protected integration commit
`eefb9c3eb372a5b6789223458ccc319fa9784a04`, tree
`884965cf79cfa77044c962614e54a8decfc2b1fd`, as the current D2A release
source. The prior `5e7761b` release source is historical, not current.

The first-install commissioning observation remains a Q0 trust input. Q0 must
prove its trusted observer, appliance binding, separate customer backup target,
and clean restore. PR-12 does not select or imply its signing authority or
custody.

This is source closure only. Accepted remains false, runtimeQualified remains
false, contract activation remains inactive, and D2A-RC and Q0 remain
NOT_STARTED. Grafana customer access remains deferred from v1. No deployment,
runtime activation, real secret binding, private signing material, hardware
qualification, or Product main transition is part of PR-12 source closure.

## Prospective retained native administration correction

F0-N0 records a prospective correction to the reduction target from protected
integration commit `eecbdc6099d36876b94b78689a54c914f6228eb4`, tree
`c5d9b5e8282418441e9c3c55fe85e858caa70d1e`. The reduction removes
LibreChat, first-party chat and conversations, Knowledge, RAG, corpora, MCP,
and the Product corpus pipeline. It retains Grafana, scoped Keycloak Admin,
Portainer, and LiteLLM native administration as deeper technical appliance
surfaces behind dedicated Product-edge authorities. Console remains the
primary simplified surface and remains complete without those tools.

This correction is prospective. Earlier decision and closure artifacts remain
immutable evidence of the narrower boundary at their original commits. The
new scope contract inventories each current source, validator, test, release,
startup, and governance surface that must be superseded by the ordered F0-N1
through F0-N8 packages. F0-N0 changes no Product behavior, route, image lock,
runtime, customer permission, or live infrastructure. All native routes remain
inactive and direct native ports remain denied until their exact upstream
authentication, session, role, route, retention, restart, and no-bypass gates
pass.

Unified login means Keycloak SSO with an independent native session for each
tool. Console cookies or tokens are never forwarded to native services. Shared
human accounts, anonymous administration, and reverse-proxy impersonation
remain forbidden. The pre-Genesis target is password-only login with an
8-hour idle session and a 24-hour maximum session, while refresh rotation,
revocation, safe redirect, outage recovery, role enforcement, and logout remain
mandatory.

The read-only gateway capture on 2026-08-13 found the retained native
hostnames still fail closed. That capture's certificate was subsequently
renewed outside this source package. The carried operator-verified certificate
evidence now expires at 2026-11-12 08:25:59 UTC with SHA-256 fingerprint
`EA:D3:7B:FB:0B:5F:08:64:6A:8A:D9:1A:FE:EF:6D:BC:73:C8:4C:5F:23:60:17:B6:C2:14:6C:7E:E3:CC:66:41`.
F0-N5 changes no live certificate, DNS, or external credential. Accepted
remains false, runtimeQualified remains false, contract activation remains
inactive, Q0 remains NOT_STARTED, and Genesis remains unpublished.

## LiteLLM OSS-only downstream characterization

F0-N1 replaces the distributable LiteLLM input with a deterministic
`v1.96.2-llmm.1` image built from exact upstream source. The repeatable overlay
removes the `litellm-enterprise` workspace and dependency, the Enterprise
source trees, runtime copies, import bridges, hooks, routes, tests, and build
assets. The reviewed upstream image remains signature evidence only and is not
distributed unchanged.

Two clean linux/amd64 builds produced the same OCI archive, manifest, and
configuration. Source, installed-package, OCI, runtime-import, CycloneDX, and
license scans found no Enterprise material. A fresh Trivy scan found no known
vulnerabilities. The SBOM identified ordinary copyleft dependencies in the
runtime stack, so the release gate now requires a separate
`litellm-oss-transitive-sources` packet before a distributable artifact can be
assembled. This package does not construct, sign, or publish that release
artifact.

Disposable browser characterization against Keycloak 26.7.0 proves Generic
OIDC Authorization Code with PKCE without license or trial material. Admin maps
to `proxy_admin`; Operator maps to `internal_user` and can create, view, and
delete only their own virtual keys and view their own spend. Cross-user key
access plus model, team, organization, user, system, MCP, and cross-user key
mutations are denied. Migration from v1.85.0, restart, identity outage,
streaming and non-streaming routing, accounting, native logout, and zero
prompt/response retention pass in the isolated characterization lane.

The free SSO boundary remains five billable users. Keycloak retains the target
8-hour idle and 24-hour maximum session. LiteLLM OSS v1.96.2 offers a fixed
native UI JWT lifetime rather than a sliding idle timeout, so the supported
safe profile caps the separate LiteLLM session at eight hours. F0-N1 does not
activate customer ingress: direct access remained loopback-only, and the exact
route allowlist plus denial of MCP, agent, external blog-feed, and unauthorized
native routes remains F0-N5 work. Accepted remains false, runtimeQualified
remains false, contract activation remains inactive, Q0 remains NOT_STARTED,
and Genesis remains unpublished.

## Grafana 13.1.3 Admin-only native characterization

F0-N2 replaces the former Grafana 13.1.0 lock with exact official Grafana
13.1.3. The annotated source tag peels to commit
`45a27d64b64a82d666b06aa5c5bb3521587edb0d`; the exact linux/amd64 image
reports that same version and commit. The Core inventory binds OCI index
`sha256:ab5cb380e3ff3172d6c8bd2e7cfd31cce977d2881b260e1f5bc089bf0b759b43`
and platform manifest
`sha256:e27e68cfd5795c1bea54950766078a02e84dfa3bafe0a4d0e5382f713dfd8e4e`.

Disposable browser characterization against Keycloak 26.7.0 proves Grafana
Generic OAuth Authorization Code with PKCE. Admin maps to Editor. Operator,
mixed Admin and Operator, and unknown roles receive no Grafana native session.
The Admin is not a Grafana server administrator, can create and delete a
dashboard, and receives `403` when attempting datasource creation. Basic and
anonymous authentication remain disabled. Native session state survives a
Grafana restart, logout clears the Grafana session and enters Keycloak logout,
identity outage leaves Grafana healthy while native login is unavailable, and
an explicit cross-origin mutation is denied.

The policy-fresh Trivy 0.73.0 scan has zero Critical findings and 15 High
occurrences across 12 unique advisories. Two occur in the embedded Tempo
datasource backend; the remainder occur only in the bundled Elasticsearch and
Zipkin datasource executables. The Product profile disables all three plugins,
runtime proof shows each absent from plugin inventory and returning `404`, no
such datasource is provisioned, and Editor cannot create one. F0-N2 therefore
admits the exact image for pre-Genesis source use under a founder-authorized,
30-day nonreachability disposition expiring 2026-09-12. Expiry fails closed.
A future release must run a fresh exact-image scan and satisfy the release
evidence policy at construction time.

F0-N2 does not activate customer ingress. The local HTTP characterization
overrides `cookie_secure` only for loopback execution; the checked-in Product
profile requires Secure, SameSite=Lax Grafana cookies. The exact dedicated
authority, redirects, native Cookie and Set-Cookie, Location, query keys,
Origin and Referer handling, static assets, and no-bypass policy must be
replayed through HTTPS in F0-N5. Accepted remains false, runtimeQualified
remains false, contract activation remains inactive, Q0 remains NOT_STARTED,
and Genesis remains unpublished.

## Keycloak 26.7.0 scoped appliance-realm administration

F0-N3 restores the repository-owned `llm-machines` login theme and binds the
pre-Genesis human login profile to password authentication, an eight-hour idle
session, and a 24-hour maximum session. Console and every retained native tool
use Keycloak SSO but keep separate native sessions. Console cookies and tokens
are never forwarded to the Keycloak Admin Console.

The customer Admin receives only `query-users` and `query-groups` plus FGAP v2
Users `view` and `manage` and read-only view of the canonical Admin and Operator
groups. Disposable Keycloak 26.7.0 browser and Admin REST characterization
proves user list, create, update, password reset, and session inspection, while
Operator, master realm, realm creation, unrelated realm, client,
identity-provider, role, group mutation, impersonation, role mapping, and realm
mutation access fail closed. Metadata-only Keycloak admin events bind the
tested mutations to the exact authenticated Admin subject.

Keycloak Users `manage` also authorizes user deletion. The approved layered
design therefore blocks native activation until F0-N5 denies exact user DELETE
requests at the Product edge. The native Admin Console remains
`INACTIVE_PENDING_F0_N5`, direct characterization is loopback-only, and the
exact browser route, cookie, redirect, PKCE, Origin, CORS, CSRF, logout,
restart, and outage inventory is source-controlled without token or cookie
values. Product acceptance, runtime qualification, Genesis, Q0, and Product
main remain unchanged.

## F0-N3R Console session contract correction

F0-N3R prospectively aligns the stale shared Console session contract with the
already-approved and implemented Keycloak and Console profile: five-minute
access tokens, an eight-hour idle session, and a 24-hour maximum session. It
replaces the stale 31-minute browser-expiry assertion with controlled-time
proof at the eight-hour idle boundary and independently proves the 24-hour
maximum using controlled session timestamps. No eight-hour wall-clock wait is
part of the test gate.

Refresh rotation, revocation, safe same-origin redirect, identity-outage
recovery, concurrent refresh, and logout remain unchanged. The F0-N3 evidence
is preserved byte-for-byte; F0-N3R is a prospective source-security correction,
not a rewrite of historical characterization or a runtime-activation claim.
The F0-N6 path-inventory test now compares its exact admitted candidate rather
than the moving current worktree, so later independently reviewed successors do
not invalidate the historical F0-N6 package boundary.

## F0-N3T Keycloak runtime-bootstrap correction

F0-N3T corrects only the disposable Keycloak Team proof exposed by the first
native-Linux F0-L2R replay. Under a restrictive `umask`, the generated import
directory and realm file were unreadable to Keycloak's non-root container user.
The helper now keeps the host state root at `0700` while explicitly making the
container import directory `0755` and its generated throwaway realm file `0644`.

The disposable realm also now implements the existing no-offline-browser-token
contract: the global `offline_access` role and client scope exist, but the empty
appliance default role does not inherit them and Console clients cannot request
them as optional scopes. Controlled BFF time is resynchronized before real
Keycloak login attempts, and the browser proof expects the approved
password-only flow instead of historical TOTP enrollment. Callback failure
diagnostics retain only host, path, status, and cookie-name metadata.

The exact Keycloak 26.7.0 and PostgreSQL 17.6 VM117 replay passes user creation,
password rotation, disable/reactivate, Operator denial, metadata-only audit and
session storage, credential-retention checks, and complete run-owned cleanup.
Historical F0-I2, F0-N3, and F0-N3R evidence remains byte-identical. This is a
test-runtime successor, not Product acceptance, runtime qualification, native
route activation, or Q0 evidence.

## F0-L2R integrated LiteLLM OSS runtime binding

F0-L2R binds the disposable integrated reduced-Core lane to exact admitted
LiteLLM OSS `v1.96.2-llmm.1`. Before execution, the harness verifies its exact
image ID, linux/amd64 manifest, source revision, downstream version, and
OSS-only labels. Historical LiteLLM 1.85, mutable upstream images, and fallback
substitution fail closed.

The exact candidate passes a native-linux VM117 replay with actual Console Web
and BFF, PostgreSQL migrations, Keycloak 26.7.0, the admitted private LiteLLM
image, reviewed reduced Firecrawl, retained observability, and deterministic
inference. Application creation, model discovery, streaming and non-streaming
Chat Completions, accounting, last-use metadata, credential rotation and
revocation, Firecrawl search and static scrape, identity-outage recovery, BFF
restart, no-bypass controls, run-owned cleanup, and zero workload-content
canaries pass.

The restrictive-umask corrections make only generated credential-free service
fixtures readable to their non-root containers. Credential-bearing host roots
remain restrictive. Product behavior, customer authority, routes, permissions,
and native ingress do not change. Earlier local F0-L2R candidates remain
unpushed historical evidence. Product acceptance and runtime qualification
remain false, native activation remains pending F0-N7, Q0 is not started, and
Genesis is unpublished.

## Portainer upstream-security deferral

F0-N4 records Portainer as `DEFERRED_UPSTREAM_SECURITY`. The bounded Portainer
CE 2.39.6 feasibility pass produced a byte-reproducible downstream image, but
fresh scanning found reachable vulnerabilities in appliance-administration
paths that a narrow build-only overlay cannot safely resolve. The exact source,
reproducibility, SBOM, Trivy, and govulncheck identities are preserved in the
deferral artifact as historical non-admission evidence.

Portainer is not admitted, packaged, deployed, exposed, linked, advertised, or
included in the current Core BOM or immutable image lock. No broad downstream
fork, vulnerability workaround, alternative administration bridge, shared
account, or proxy impersonation layer is authorized. Existing defense-only
Portainer denial references may remain, but there is no Portainer authority,
upstream, startup definition, or Console navigation entry.

This is a deferral, not permanent removal. A separately authorized F0-N4R may
reconsider Portainer after a suitable newer upstream CE release is available,
but it must repeat complete supply-chain, vulnerability, licensing, SSO,
administrator-mapping, recovery, backup, restart, route, and no-bypass
qualification. The remaining pre-Genesis sequence continues with three-service
F0-N5, F0-N6, F0-N7, and F0-N8. Product acceptance and runtime qualification
remain false, contract activation remains inactive, Q0 remains NOT_STARTED,
and Genesis remains unpublished.

## Three-service native Product-edge profiles

F0-N5 adds exact source-only Product-edge profiles for Grafana 13.1.3,
LiteLLM OSS `v1.96.2-llmm.1`, and Keycloak 26.7.0 appliance-realm
administration. It preserves the four-authority Console, API, identity, and
Firecrawl core without rewriting the historical F0-E0 contract. The three
native tools use dedicated hostnames, fixed private upstreams, exact method,
path and query-key inventories, and their own supported Keycloak OIDC sessions.
Console sessions and tokens are never forwarded. Product Application
credentials are rejected on native authorities.

Grafana admits Admin as Editor; Operator and every other role are denied and
server-administrator authority remains disabled. LiteLLM admits Admin as
`proxy_admin` and Operator as `internal_user`; the native application remains
responsible for limiting Operator to the Operator's own virtual keys and spend.
Keycloak admits Admin only to the `llm-machines` appliance realm. The Product
edge returns `403` for
`DELETE /keycloak/admin/realms/llm-machines/users/{uuid}` before Keycloak,
closing the F0-N3 upstream Users `manage` residual. Master and unrelated realms,
unlisted routes, alternate hosts, Host/SNI mismatch, unsafe paths, spoofed
forwarding headers, WebSocket upgrades, and direct native ports fail closed.

Native cookies, redirects, Origin, Referer, CSRF, PKCE callbacks, static assets,
logout, and required REST calls are preserved only on the characterized
profiles. LiteLLM's advanced native inference route may use SSE; no retained
native surface requires WebSockets. Ingress audit remains metadata-only and
records no target, query, arbitrary header, cookie, or body.

Production authorities are customer-domain commissioning inputs under customer
DNS custody. Connected deployments use provider-neutral, narrowly scoped
DNS-01 or a delegated challenge zone; disconnected deployments use a
customer-owned private CA. No Porkbun dependency or DNS credential enters the
Product source.

F0-N5 does not activate or deploy the profiles. HTTPS browser role replay,
native logout and invalidation, service and identity outage, restart,
zero-retention, direct-port, and alternate-host proof remain
`NOT_STARTED_F0_N7`. Portainer remains `DEFERRED_UPSTREAM_SECURITY` with no
authority, upstream, route, image, startup definition, or navigation entry.
Accepted remains false, runtimeQualified remains false, contract activation is
`INACTIVE_PENDING_F0_N7`, Q0 remains NOT_STARTED, and Genesis remains
unpublished.

## Keycloak dual-authority edge correction

F0-N5R prospectively corrects the Keycloak part of F0-N5 without rewriting its
historical evidence. Exact Keycloak 26.7.0 serves root paths internally. Its
frontend hostname is the identity authority, while its admin hostname is the
dedicated Keycloak authority with the external `/keycloak` context. The edge
strips that prefix only after an exact admin-route allowlist match. Normal OIDC,
login-action, cookie, and logout traffic remains on the identity authority.

A disposable VM117 proof using the exact Keycloak and Nginx images confirmed
the external admin path, root internal path, duplicate-admin-host OIDC denial,
and the required pre-upstream user-delete `403`. The proof removed all owned
containers, listeners, credentials, and temporary files. It does not activate
native ingress or replace the complete F0-N7 browser, role, outage, restart,
retention, and no-bypass gate. Product acceptance and runtime qualification
remain false, activation remains inactive, Q0 remains NOT_STARTED, and Genesis
remains unpublished.

## Grafana OAuth entry query correction

F0-N5S prospectively corrects the Grafana query discriminator without
rewriting F0-N5 or F0-N5R evidence. Grafana uses
`GET /login/generic_oauth` both to initiate Generic OAuth without a query and
to receive the authorization callback with `code`, `iss`, `session_state`, and
`state`. The edge now uses a Grafana-specific policy for those two exact cases.
LiteLLM keeps its separate callback-only policy, and unapproved Grafana query
keys still return `400`.

A disposable VM117 HTTPS browser proof confirmed PKCE S256, Admin Editor,
Operator denial without a native session, no Grafana server administrator,
dashboard mutation, datasource denial, and complete cleanup. The correction
does not activate native ingress or replace the complete F0-N7 three-service
browser, outage, restart, retention, and no-bypass gate. Product acceptance and
runtime qualification remain false, activation remains inactive, Q0 remains
NOT_STARTED, and Genesis remains unpublished.

## Keycloak Admin browser token Origin correction

F0-N5T corrects one dual-authority browser dependency without broadening the
native surface. The human-realm token endpoint continues to admit an absent
Origin for confidential server-side exchange. It preserves the Origin header
only when it exactly equals the commissioned Keycloak Admin authority and
returns `403` for every other browser Origin before contacting Keycloak.
Authorization, Cookie, and Console session material remain stripped.

Exact Keycloak 26.7.0 browser proof on isolated VM117 completed the native
Admin Console token exchange and appliance-realm API load without changing the
`security-admin-console` client. All owned runtime state was removed and the
founder environment was preserved. Native ingress remains inactive pending the
complete F0-N7 replay.

## Keycloak session identifier edge correction

F0-N5U corrects the session-invalidation path without broadening Keycloak
administration. Exact Keycloak 26.7.0 source generates user-session identifiers
from 18 random bytes with URL-safe Base64, yielding exactly 24 characters in
`A-Za-z0-9_-`. The Product edge now admits only that source-proven identifier
shape on the existing exact `DELETE` route. Queries, other methods, malformed
identifiers, Console material, and Product credentials remain denied.

A focused disposable VM117 browser proof invalidated two real sessions, denied
five malformed identifier cases, denied a wrong method, and preserved the
existing user-delete `403`. No identifier value, cookie, credential, or
workload content enters evidence. All run-owned resources were removed and the
founder environment was preserved. Complete logout, outage, restart, retention,
and three-service no-bypass proof remains F0-N7.

## Console Technical Tools

F0-N6 adds a role-filtered Technical Tools section inside Settings while
preserving the seven primary Console surfaces. This keeps Console as the
recommended simplified experience instead of turning native administration
into a replacement product surface. Admin sees Grafana, LiteLLM, and the
scoped Keycloak Admin Console. Operator sees LiteLLM only. Portainer remains
deferred and absent.

The server derives each external HTTPS link from a credential-free,
commissioning-supplied DNS hostname and one fixed source-controlled path.
Schemes, ports, paths, queries, fragments, user information, IP addresses, and
malformed hostnames supplied as host inputs fail closed to a non-link state.
Links open in a new tab with `noopener noreferrer`; the Console session,
tokens, and Application credentials are not forwarded.

The page states that Console Application credentials remain the recommended
customer integration path and that LiteLLM virtual keys are a separate,
advanced native capability. F0-N6 does not activate ingress or change runtime,
VM103, DNS, certificates, or the gateway. Exact HTTPS navigation, role replay,
native-session separation, and browser-artifact scanning remain F0-N7 gates.

## LiteLLM immutable-subject native commissioning

F0-L2S closes the integrated startup gap found during the first F0-N7 attempt.
The system commissioner now binds each approved native LiteLLM user to the
immutable Keycloak `sub` claim, with Admin mapped to `proxy_admin` and Operator
mapped to `internal_user`. It reads before creating or reconciling a user, does
not delete users, does not create a virtual key, and returns no credential
material. The LiteLLM master secret remains a system commissioning credential,
never a human browser credential.

Exact LiteLLM OSS `v1.96.2-llmm.1` passed create-then-no-op commissioning,
post-restart persistence, Authorization Code plus PKCE, role and own-key
isolation, routing, accounting, logout, controlled identity outage, and
zero-content-retention proof on isolated VM117. The native listener remained
loopback-only and all run-owned resources were removed. This successor does
not activate native ingress or accept or qualify the Product. Complete
three-service browser and no-bypass validation remains F0-N7.

## F0-N8 retained native-access closure

F0-N8 binds the exact protected PR 90 through PR 107 first-parent history and
the byte-exact evidence for every retained native-access package. The passing
F0-N7 VM117 matrix proves Grafana Admin Editor access, LiteLLM Admin
`proxy_admin` and Operator `internal_user` own-key access, and Admin-only
appliance-realm Keycloak administration with user deletion denied at the
Product edge. Native sessions remain service-owned and direct ports remain
private. Console remains the primary complete customer experience.

Portainer remains `DEFERRED_UPSTREAM_SECURITY`, is not currently admitted, and
requires a separately authorized F0-N4R against a suitable upstream CE
release. LibreChat, first-party chat, conversations, Knowledge, RAG, corpora,
MCP, and the Product corpus pipeline remain absent.

This closure is governance-only. Product acceptance and runtime qualification
remain false, contract activation remains inactive, Q0 is not started,
Genesis is unpublished, and Product main is unchanged. VM103 inspection,
deployment, durable founder qualification, and Genesis publication each
require a separate approval.
