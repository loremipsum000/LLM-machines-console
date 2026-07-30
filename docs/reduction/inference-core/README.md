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
corepack pnpm build:inference-core
corepack pnpm typecheck:inference-core
```

The package guardrail command always compares against
`origin/codex/inference-core-stack-reduction`. The guardrail CLI accepts an
explicit `--base-ref` for a separately reviewed manual comparison. The
comparison is a bootstrap result in PR-01 because the integration base
predates these files. From PR-02 onward, an entry or route may disappear, but
a new or changed production source file, new route, new fingerprint, increased
multiplicity, reclassification, resolver change, guard-policy change, or
protected-guard file change fails. Planned edits, route additions, and moves
require a visible, reviewed contract revision before their implementation is
admitted.

The root `test` command runs the base comparison before any workspace tests.
Core workspace membership and each Core package build, typecheck, and test
script are exact-locked. Their pre- and post-lifecycle companions are
prohibited, so a filtered command cannot succeed without running only the
intended package command.

The filtered Core build contains Contracts, Copy, BFF, and Web. It removes
Agentic-related environment variables from the child process and excludes
the separate legacy Agentic adapter and reranker workspaces. Eight legacy
Agentic BFF routes still exist and remain frozen for removal in the next
packages, so this is dependency-lane evidence rather than final Core
independence.

The Core build and typecheck runner forwards only basic process paths and
locale values. Product credentials, cloud tokens, service configuration, and
other ambient environment values are not passed to the build.

Baseline generation runs the same environment-file and symlink preflight as
normal verification. Final candidate validation must run from a clean checkout
of the exact commit so the tested bytes and published Git tree are identical.
