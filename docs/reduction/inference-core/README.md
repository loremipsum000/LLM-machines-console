# Inference Core reduction guardrails

This directory records the PR-01 target contract and the exact legacy
characterization that later reduction pull requests must shrink.

PR-01 does not claim that the current Product already implements the target.
The current authorization system still uses the legacy personas, retired
routes remain registered, and runtime zero-content-retention compliance is
not evaluated. The current connected-app test action records status metadata
but does not prove network reachability. A later reduction pull request must
replace it with a content-free connection probe.

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
corepack pnpm test:inference-core-guardrails
corepack pnpm test:inference-core-db
corepack pnpm build:inference-core
corepack pnpm typecheck:inference-core
corepack pnpm typecheck:inference-core-db
```

The package guardrail command compares against the immutable reviewed PR-05
integration commit `da6f0c0a2b5e477449a09527a28c7e51ef432c20`. It does not
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

Optional Application token-budget values remain persisted, but enabled
runtime enforcement fails closed until PR-07 qualification. The metadata-only
PostgreSQL idempotency ledger stores no raw key or request or response payload.
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

During implementation,
`pr-06-application-decisions.json` remains
`pending-final-staged-delta`, its six operation arrays remain empty, and the
confirmed governance values are already recorded. OAuth access tokens use an
exact 300-second lifetime, and Application administration uses the
`dedicated-application-realm` topology. The human realm is `llm-machines`; the
Application realm is `llm-machines-applications`. Application clients inherit
the 300-second realm lifetime. The `console-application-admin` service client
has an exact 60-second client override and uses credentials separate from the
human administration service, with no credential fallback between them.

PR-06 records and guards these decisions but performs no runtime OAuth
activation and does not qualify the topology. PR-07 owns OAuth access-token
validation, runtime limit enforcement, and inference data-plane qualification.
PR-12 owns deterministic packaging and commissioning of the two-realm Keycloak
configuration. Once the candidate implementation is stable, stage every
tracked candidate path with no untracked files, print the canonical operation
policy, copy its six exact arrays into the decision, review them, and change
`reviewStatus` to `reviewed` before generation:

```text
node scripts/inference-core/pr06-contract-revision.mjs --print-operation-policy
node scripts/inference-core/pr06-contract-revision.mjs --write
```

Write mode rejects a pending decision, an OAuth token lifetime other than 300
seconds, a Keycloak Application realm topology other than
`dedicated-application-realm`, or any difference between the reviewed arrays
and the staged candidate. It accepts no alternate base or output path and
atomically replaces only the PR-06 revision, forbidden allowlist, and route
baseline. Until write mode is explicitly run, `contract-revisions/PR-06.json`
must not exist and the two generated baselines remain at their reviewed PR-05
identities.
