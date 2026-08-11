# LLM Machines Console

Administration and operations console for the LLM Machines on-prem inference
appliance.

## Structure

- `apps/web` - reduced Next.js administration interface
- `apps/bff` - Fastify control plane and Application gateway
- `packages/contracts` - retained inference and administration contracts
- `packages/copy` - retained product and authentication copy

The product source contains the API-first inference control plane. Customer
chat and agent interfaces are third-party applications and are not included
in this repository.

The repository is undergoing an inference-core product reduction. This
clean-root publication is a source checkpoint, not a production release.

## Disposable reduced-Core development lane

After `corepack pnpm install --frozen-lockfile` and `corepack pnpm build`, run
`node scripts/pre-genesis/reduced-core-dev.mjs` to start Console Web, the BFF, a
strict four-authority local router, and an OpenAI-compatible deterministic
inference double. The runtime command creates throwaway credentials, logs, and
the Next development output under one operating-system temporary directory. It
prints no credential values and removes only that created directory when
stopped with Ctrl-C.

The four local HTTP authorities are printed at startup. This lane supports
control-plane and Application-flow development on arm64. It is not evidence for
Product Nginx or TLS, Keycloak login, exact Core images, SGLang, persistence,
runtime no-bypass, or production capacity. The Identity authority deliberately
returns a controlled unavailable response until a separate browser and session
functional package supplies a qualified identity fixture. Application
credential, gateway-accounting, rotation, revocation, and isolation are not
proved by the bootstrap check alone.

Run `node scripts/pre-genesis/reduced-core-dev.mjs --check` for a bounded
startup and cleanup check.

Run `node scripts/pre-genesis/reduced-core-dev.mjs --vertical-slice` for the
bounded F0-L1 Application-to-inference flow. It creates two temporary
Applications through the Console BFF control surface, uses a generated
Application credential through the API authority for non-streaming and
streaming Chat Completions, verifies usage and last-use metadata, rotates and
revokes the credential, proves the exact 24-hour rotation overlap and controlled
expiry, proves cross-Application policy and credential-record isolation, and
removes the temporary runtime. Its JSON result contains only status and
accounting metadata. It verifies that non-reveal responses and disposable
runtime logs contain no credentials or parent-process secret sentinels, and
that control-plane responses and runtime logs contain no prompts or completion
content.

Run `node scripts/pre-genesis/reduced-core-dev.mjs --firecrawl-slice` for the
bounded F0-W1 per-Application Firecrawl flow. It proves default-off state,
explicit disclaimer-bound enablement, separate inference and Firecrawl
credentials, governed search and static scrape, exact-host scrape allowlisting,
unsupported-route denial, Application isolation, last-use metadata, rotation,
revocation, zero-retention request flags, and cleanup. The local Firecrawl and
DNS doubles do not contact the web and are not runtime qualification evidence.

Run `corepack pnpm run test:pre-genesis:browser` for the bounded F0-S1 browser
session and role flow. It uses actual Console Web and BFF code, real Chrome or
Chromium, generated throwaway credentials, a generated local CA, and a
deterministic Keycloak-compatible OIDC fixture. The proof covers login,
same-origin return handling, expiry, revocation, retryable identity outage,
serialized refresh across browser tabs, logout, retained navigation, and the
Admin/Operator boundary. Reserved `*.llmm.test` fixture authorities are mapped
only to loopback. This is not evidence for real Keycloak, PostgreSQL session
persistence, appliance TLS, Product Nginx, release packaging, or Q0.

Run `corepack pnpm run test:pre-genesis:browser-credential-lifecycle` for the
bounded F0-U2 browser proof. It uses actual Console Web and BFF code to rotate
and revoke separate inference and Firecrawl credentials, prove the exact
24-hour static-key overlap, deny cross-Application mutation, preserve a second
Application, display safe age and last-use metadata, and prove that one-time
secrets do not survive in later DOM, browser history, copied Console state,
errors, logs, screenshots, or teardown artifacts. Application credential
testing, rotation, revocation, and disabling are Admin-only; Operator access is
read-only. F0-P1 supersedes the in-memory persistence limitation without
rewriting the F0-U2 evidence.

Run
`PRE_GENESIS_DOCKER_CONTEXT=<isolated-context> corepack pnpm run test:pre-genesis:postgres-persistence`
for the bounded F0-P1 persistence proof. It creates a labeled disposable
PostgreSQL 17.6 container and volume with generated throwaway credentials,
applies the real Product migration, starts actual Console Web and BFF, and
replays the browser credential lifecycle across a controlled BFF restart. It
also proves encrypted opaque-session persistence, bounded degraded readiness
during a database outage, recovery without state corruption, metadata-only
audit storage, retention-canary absence, and exact cleanup. The Docker context
must be isolated from existing workloads. This is not exact-Core, VM103,
backup/restore, real Keycloak, real SGLang, release, or Q0 evidence.

Run `corepack pnpm run test:pre-genesis:observability` for the bounded F0-O1
browser proof. Actual Console Web and BFF read private deterministic LiteLLM,
Prometheus, and Alertmanager doubles through exact GET-only allowlists. The
proof covers the retained Inference and Hardware projections, safe metadata,
source outage and recovery, role parity, and the absence of Grafana and native
LiteLLM or Keycloak administration. It is not real-service, exact-Core, or Q0
evidence.

## Persistent founder UAT lane

On a dedicated native Linux/amd64 evaluation VM, run
`node scripts/pre-genesis/reduced-core-uat.mjs start` to start the actual
reduced-Core services and keep them running after the integrated browser proof
passes. Use the same command with `status` for credential-free connection and
inventory metadata, and with `stop` for the only normal cleanup path. The
generated Admin and Operator credentials remain in a
mode-`0600` operator file and are never printed by these commands.

The environment is loopback-only and requires an authenticated SSH tunnel plus
the temporary four-authority hostname and CA procedure documented in
`docs/reduction/inference-core/founder-uat-runbook.md`. It is founder functional
evidence only, not a release, production deployment, SGLang capacity result, or
Q0 runtime qualification.

## Security

Internal deployment topology, operational runbooks, environment credentials,
and customer-specific configuration are intentionally excluded. The example
environment file contains no credential values. Generate all secrets outside
Git and inject them at runtime.

Do not report security vulnerabilities through a public issue.
