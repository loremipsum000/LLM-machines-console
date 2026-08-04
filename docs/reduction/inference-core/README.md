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
outbound-processing disclaimer to enable or re-enable. Admin and Operator may
view, passively test, rotate, revoke, or disable existing access; Operator
cannot enable it or change LiteLLM routing.

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

This is source closure only. Accepted remains false, runtimeQualified remains
false, contract activation remains inactive, and D2A-RC and Q0 remain
NOT_STARTED. Grafana customer access remains deferred from v1. No deployment,
runtime activation, real secret binding, private signing material, hardware
qualification, or Product main transition is part of PR-12 source closure.
