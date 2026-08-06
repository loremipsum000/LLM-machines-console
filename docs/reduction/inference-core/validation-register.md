# Inference Core validation register

The contract revisions under `contract-revisions/` bind accepted package
trees to their generated route and repository baselines. This register tracks
the human-readable gate state without replacing those machine-verifiable
artifacts.

| Package | Scope | Validation state |
| --- | --- | --- |
| PR-02 through PR-07 | Accepted integration history | Bound by reviewed per-package decisions and contract revisions |
| PR-08 | Firecrawl search and static scrape | Passed on the reviewed PR-08 candidate; PR-12 runtime gates retained |
| PR-09 | Activity, audit, and observability | Passed on the reviewed PR-09 candidate; runtime delivery remains PR-12 |
| PR-10 | Lifecycle snapshot and restore foundation | Passed on the reviewed PR-10 candidate; configured adapters and runtime qualification remain PR-12 |
| PR-10C | Emergency isolation | Passed on the reviewed PR-10C source candidate; live topology and runtime qualification remain PR-12 |
| PR-11 | Retained Console information architecture | Passed on the reviewed PR-11 source candidate; deployment and runtime qualification remain PR-12 |
| PR-11A R1-C0 | Product authority and governance correction | Source validation passed and merged through PR 13; aggregate R1-V1 review remains pending; PR-11A is unaccepted and not revision-bound |
| PR-11A R1-S1 | Opaque Console session hardening | Full source and fresh-clone validation plus independent review passed at reviewed head `28655df1a919757329a1493bea5811f064d143d0`; merged through PR 14 at integration commit `39057332207cca6193495453b7336eda07608255`; aggregate R1-V1 and Q0 runtime qualification remain pending; PR-11A is unaccepted and not revision-bound |
| PR-11A R1-E1 | Mandatory core Product edge | Local and clean detached fresh-clone full source validation plus independent review passed at `c60280c11318aa21d230e7002cb7d703625a7168`; merged through PR 15 at integration commit `1743cb746f87c7497a34f4de7e3bfc0db3ff0be2`; aggregate R1-V1 and Q0 runtime qualification remain pending; PR-11A is unaccepted and not revision-bound |
| PR-11A R1-K1 | Signing custody and public trust | Local and clean detached fresh-clone full source validation plus independent review passed at `cd1f7c43bd7c2abe32a2423d1ce77506ecde84cc`; merged through PR 16 at integration commit `ffc49eb6e97169ced202efbaa6363c85bfdd40dc`; aggregate R1-V1 and Q0 runtime qualification remain pending; PR-11A is unaccepted and not revision-bound |
| PR-11A R1-D1 | Storage, backup, retention, and recovery | Local and clean detached fresh-clone full source validation plus independent review passed at `46295906c3d733b0e56abe94d9732d8eb0549c29`; merged through PR 17 at `cc08cf8e9afce12def143f2f395d30bfbe04f515`; the D1-owned hygiene successor passed clean detached source validation and merged through PR 18 at `949d1f2fd05a8329e7676ad2423bf55d0eab29ba`; aggregate R1-V1 and Q0 runtime qualification remain pending; PR-11A is unaccepted and not revision-bound |
| PR-11A R1-H1 | Repository-wide Biome hygiene successor | Exact 32-path hygiene delta and source-only successor contract passed local and clean detached full source validation plus independent review at `49ad418408aab32f30e7f6008aa71ad66ba5e708`; PR-11A is unaccepted, not revision-bound, and not runtime-qualified |
| PR-11A R1-V1 successor | Aggregate source evidence, inactive contract revision, and source-closure binding | Exact post-H1 input `0e794ccd6e0f2593f2e6ab34b8fc1d521835b6fd`; full local and clean detached validation plus independent review passed for candidate `fb5ac5be13012a3de5e2da733bdc83c7d82efed3`; PR 20 merged it at `837c3c3e139fd6b82db650d20a4f0fcf902e2fda`; the merge tree equals the validated candidate tree and the diff is empty; PR-11A is source-closed and revision-bound to that integration commit; accepted remains false; runtimeQualified remains false; contract activation remains inactive; Q0 remains NOT_STARTED; Grafana qualification remains NOT_STARTED; PR-12 subsequently entered its separately governed source workflow |
| PR-12 source closure | Aggregate deterministic packaging evidence and amended exact release-source binding | PR 33 through PR 36 records and Amendment 1 remain immutable evidence. The registry-neutral Core lock successor passed complete local and detached validation plus independent review, then merged through PR 38 at `cd2060833e3c3b157c4a67515df64f0977b852ba` with identical candidate tree `403be5c5efe24fa942687fcf16670c3af5fe9514`. The first-release rollback successor preserved each review-blocked candidate, passed the same gates and final independent review, then merged through PR 39 at `4b2fc6a3278dfad2857b5caed4fb0d6cbdafee8f` with identical candidate tree `1f9eea21ccf21d9b6fbc118f37a0d9fcb5c80d36`. Amendment 2 binds that PR 39 merge as the sole D2A release-source input. The first-install observer, appliance binding, separate backup target, and clean restore remain Q0 trust inputs without a PR-12 signing or custody authority. Accepted remains false; runtimeQualified remains false; contract activation remains inactive; D2A-RC and Q0 remain NOT_STARTED; no deployment or Product main transition occurred. |

## PR-08 required evidence

- Exact private source checkpoint and Product base identities remain bound.
- Every reconstructed unit maps through `pr-08-firecrawl-source-manifest.json`
  and one target-file-level row in `source-map.jsonl`; excluded pilot content,
  pilot ancestry, and migration `0027` remain absent.
- Dedicated Firecrawl keys cannot authenticate to inference, and inference,
  OAuth, human, or LiteLLM credentials cannot authenticate to Firecrawl.
- Default-off, disclaimer, Admin-only mutation, Operator read-only, no-expiry,
  86,400-second overlap, immediate revoke, parent-Application disable, and
  passive connection-evidence tests pass. F0-U2 supersedes the earlier current
  role split without rewriting the historical PR-08 evidence.
- Exactly public T2 `POST /v2/search` and `POST /v2/scrape` are admitted while
  the two public inference routes remain unchanged. The six authenticated
  Application admin routes remain control-plane-only. Unsupported methods,
  routes, capability fields, unsafe URLs, redirects, DNS answers, native
  Firecrawl surfaces, direct cloud Firecrawl access, and unapproved egress
  fail closed.
- Request and response bounds, cancellation, timeout, atomic optional rate and
  concurrency protection, failure accounting, and upstream error tests pass.
- Source-level BFF retention canaries remain absent across success, rejection,
  cancellation, timeout, upstream failure, crash, and restart fixtures. Native
  Firecrawl logger and span isolation plus runtime canaries remain PR-12 gates.
- Query-free request logging is bound at the BFF entrypoint. It retains no raw
  request target, query, header, hostname, body, or Firecrawl workload content.
  Unsupported `/v2` pathnames are logged only as `/v2/[unsupported]`.
- Settings accepts only the governed internal upstream
  `http://firecrawl-api:3002`; hosted, HTTPS, alternate-host, and
  alternate-port values fail closed.
- The generic installation profile is present and default off; native service
  ports and state remain private and transient.
- Source provenance, notices, license boundaries, source-level SBOM inputs,
  secrets, credentials, internal topology, CI assumptions, and public
  information scans pass.
- Full typecheck, unit, database, guardrail, formatting, diff, and clean-clone
  verification pass before review.
- No Web production file changes in PR-08; only three exact contract fixture
  tests may change, and the combined Application UI remains PR-11.

Runtime deployment, image and source qualification, signing, the offline
packet, SBOM, corresponding-source delivery, and final release qualification
are PR-12 evidence, not PR-08 evidence.

## PR-11 required evidence

- The exact accepted base is commit
  `6efab17a6f5f6a474a1dfe1444dcdd63e4973dd7`, tree
  `44d6fb34db5f3d35e8b2f9bd2259756aec63b8a8`.
- Every PR-02 through PR-10C revision and evidence file remains immutable. The
  two live register transitions retain their original PR-08 fingerprints from
  the accepted base through an explicit successor-historical binding.
- Global navigation contains exactly the seven accepted surfaces in the fixed
  order, and `/` renders a source-backed Overview rather than redirecting.
- Applications presents inference and Firecrawl together without merging their
  credential namespaces or changing Firecrawl's default-off policy.
- Grafana, LiteLLM, and Keycloak remain reduced previews. No live native href,
  native URL, or expert-session activation is present before PR-12. The exact
  production href manifest, internal-only Overview href schemas, BFF Overview
  response parsing, and null-only expert URL fields fail closed against
  literal, aliased, or BFF-supplied external links.
- `.env.example` differs from the accepted base only by deletion of the exact
  retired `INFERENCE_MODEL_UPDATE_*` block. It has no added lines, retained
  value changes, or unrelated removals, and no other environment path enters
  the package.
- Settings persistence, receipt, and audit tests prove that production
  mutations require PostgreSQL and commit the settings row, idempotency
  receipt, and success audit in one transaction. Missing persistence,
  transaction, or receipt coordination returns unavailable without a false
  success audit; memory state remains fixture-only. Fresh-database telemetry
  preview defaults pass the strict production schema with no fallback data.
- Content security policy tests and production browser gates prove that a
  per-request script nonce reaches Next.js and the response policy unchanged,
  while production `script-src` contains neither `unsafe-inline` nor
  `unsafe-eval`. The route resolver fingerprint transition is exact and
  limited to `apps/web/next.config.ts`, from
  `58f841f6ee4170e90c110e33727d85dabe6a2c096784b05940319d770a958f8b` to
  `79a28582d628e566baa4231d4a718173cf4e9dde14242bc40e214d502262dbb3`.
- Portainer, Agentic, Chat, Knowledge, MCP, Builder, Hub, retired loaders,
  redirects, links, mocks, fixtures, and bundle imports remain outside the
  retained product surface.
- The BFF inventory removes exactly the simulated
  `POST /api/admin/inference/model-updates/apply` route. The resulting 104
  routes include 92 `current-console-seam` routes; no route is added or
  reclassified, and every other classification count and Fastify registrar
  remains unchanged. Public inference, Firecrawl, isolation, authorization,
  and zero-content-retention boundaries remain unchanged.
- The reviewed staged operation policy is exact, source-only, contains no
  deletion, secret, key, runtime, deployment, signing, or vendor-maintenance
  path, and matches the generated source and repository closure deltas.
- The reviewed operation policy binds 2 added and 27 changed source-closure
  paths, 11 added and 54 changed repository paths, no deleted path, and exact
  hashes for 56 changed product-source and test files.
- Full guardrail, Web, BFF, Contracts, database, build, typecheck, formatting,
  security, and clean-clone checks pass before publication.
