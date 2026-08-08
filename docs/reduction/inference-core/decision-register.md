# Inference Core decision register

This register indexes the reviewed product-boundary decisions that govern the
reduction work packages. Detailed executable evidence remains in the matching
per-package JSON file and contract revision.

| Package | Decision boundary | Evidence | Status |
| --- | --- | --- | --- |
| PR-02 | Product and runtime boundary | `pr-02-boundary-decisions.json` | Accepted |
| PR-03 | Retired surface removal | `pr-03-removal-decisions.json` | Accepted |
| PR-04 | Clean data foundation | `pr-04-data-decisions.json` | Accepted |
| PR-05 | Human identity and recovery | `pr-05-identity-decisions.json` | Accepted |
| PR-06 | Unified Application control plane | `pr-06-application-decisions.json` | Accepted |
| PR-07 | Inference data plane and customer-owned compute policy | `pr-07-data-plane-decisions.json` | Accepted |
| PR-08 | Firecrawl search and static scrape source package | `pr-08-firecrawl-decisions.json` and `pr-08-firecrawl-source-manifest.json` | Accepted and bound by the PR-08 contract revision |
| PR-09 | Activity, audit, and observability source package | `pr-09-activity-audit-observability-decisions.json` | Accepted and bound by the PR-09 contract revision |
| PR-10 | Lifecycle snapshot and restore foundation | `pr-10-lifecycle-foundation-decisions.json` | Accepted and bound by the PR-10 contract revision |
| PR-10C | Emergency isolation source package | `pr-10c-emergency-isolation-decisions.json` | Accepted and bound by the PR-10C contract revision |
| PR-11 | Retained Console information architecture | `pr-11-console-information-architecture-decisions.json` | Accepted and bound by the PR-11 contract revision |
| PR-11A R1-C0 | Product authority and governance correction | `pr-11a-identity-ingress-hardening-decisions.json` | Merged through PR 13 at integration commit `0f29c7939fa885c11c191e8b672f09e16635ddcb`; PR-11A remains incomplete, unaccepted, and not revision-bound |
| PR-11A R1-S1 | Opaque Console session hardening | `pr-11a-r1-s1-console-session-decisions.json` | Independently reviewed source package merged through PR 14 at integration commit `39057332207cca6193495453b7336eda07608255`; PR-11A remains incomplete, unaccepted, and not revision-bound |
| PR-11A R1-E1 | Mandatory core Product edge | `pr-11a-r1-e1-product-edge-decisions.json` | Independently reviewed source package merged through PR 15 at integration commit `1743cb746f87c7497a34f4de7e3bfc0db3ff0be2`; PR-11A remains incomplete, unaccepted, not revision-bound, and not runtime-qualified |
| PR-11A R1-K1 | Signing custody and public trust | `pr-11a-r1-k1-signing-custody-decisions.json` | Independently reviewed source package merged through PR 16 at integration commit `ffc49eb6e97169ced202efbaa6363c85bfdd40dc`; PR-11A remains incomplete, unaccepted, not revision-bound, and not runtime-qualified |
| PR-11A R1-D1 | Storage, backup, retention, and recovery | `pr-11a-r1-d1-storage-recovery-decisions.json` | Independently reviewed source candidate at `46295906c3d733b0e56abe94d9732d8eb0549c29`; source package merged through PR 17 at integration commit `cc08cf8e9afce12def143f2f395d30bfbe04f515`; the D1-owned hygiene successor merged through PR 18 at `949d1f2fd05a8329e7676ad2423bf55d0eab29ba`; PR-11A remains unaccepted, not revision-bound, and not runtime-qualified |
| PR-11A R1-H1 | Repository-wide Biome hygiene successor | `pr-11a-r1-h1-hygiene-decisions.json` | Independently reviewed source candidate at `49ad418408aab32f30e7f6008aa71ad66ba5e708`; full detached source validation passed; no product or runtime behavior change; PR-11A remains unaccepted, not revision-bound, and not runtime-qualified |
| PR-11A R1-V1 successor | Aggregate source closure from exact post-H1 integration input | `pr-11a-r1-v1-aggregate-evidence.json`, inactive `contract-revisions/PR-11A.json`, and `pr-11a-r1-v1-source-closure.json` | Exact candidate `fb5ac5be13012a3de5e2da733bdc83c7d82efed3` passed full source validation and independent review, then merged through PR 20 at `837c3c3e139fd6b82db650d20a4f0fcf902e2fda` with identical tree `acc4f5540ebc863bd53e76aae8af3bcdd40136bb`; PR-11A is source-closed and revision-bound to that integration commit; accepted remains false; runtimeQualified remains false; contract activation remains inactive; Q0 remains NOT_STARTED; Grafana qualification remains NOT_STARTED; PR-12 subsequently entered its separately governed source workflow |
| PR-12 source closure | Deterministic Core release packaging and per-delivery inference artifact contracts | `pr-12-aggregate-evidence.json`, `pr-12-source-closure.json`, `pr-12-source-closure-amendment-1.json`, and `pr-12-source-closure-amendment-2.json` | PR 33 through PR 36 records and Amendment 1 remain immutable evidence. PR 38 admitted the registry-neutral Core lock and credential-free deployment-placement successor. PR 39 admitted explicit first-release no-predecessor semantics and strict independently verified predecessor proof for every later rollback at protected integration commit `4b2fc6a3278dfad2857b5caed4fb0d6cbdafee8f`, tree `1f9eea21ccf21d9b6fbc118f37a0d9fcb5c80d36`. Amendment 2 supersedes only the D2A release-source input with that exact commit and tree. The first-install commissioning observer, appliance binding, separate backup target, and clean restore remain Q0 trust inputs without a PR-12 signing or custody authority; accepted remains false; runtimeQualified remains false; contract activation remains inactive; D2A-RC and Q0 remain NOT_STARTED; Product main is unchanged |
| F0-P1 | Disposable PostgreSQL persistence and restart qualification | `f0-p1-postgres-persistence.json` | Source candidate only: actual Web/BFF and the real Product migration preserve encrypted sessions and approved Product metadata across one BFF restart; database outage and retention behavior pass locally; no exact-Core or runtime qualification claim |
| F0-O1 | Retained Console observability projection | `f0-o1-observability-projection.json` | Source candidate only: actual Web/BFF render private GET-only LiteLLM, Prometheus, and Alertmanager projections; native administration and Grafana remain absent; no real-service or runtime qualification claim |
| F0-I1 | Disposable Keycloak identity integration | `f0-i1-keycloak-identity.json` | Source candidate only: actual Web/BFF complete role-aware password and TOTP login through exact Keycloak 26.7.0 and the Product identity allowlist; native administration and identity mutations remain excluded; no exact-Core or runtime qualification claim |
| F0-I2 | Scoped Console Team identity mutation | `f0-i2-keycloak-team.json` | Source candidate only: actual Web/BFF use the isolated `console-human-admin` service account and reviewed Keycloak 26.7.0 FGAP v2 scopes for basic Team and local-password actions; native administration and broader realm/client authority remain absent; no exact-Core or runtime qualification claim |

## PR-08 fixed decisions

- The public T2 Firecrawl surface is exactly authenticated `POST /v2/search`
  and `POST /v2/scrape`. Public inference routes remain unchanged. Native
  Firecrawl routes and every other `/v2` route or method remain absent.
- Six authenticated Application admin routes cover enable, policy update,
  passive test, credential rotation, disable, and credential revoke. They are
  control-plane routes and do not expand public T2.
- Firecrawl is installed but disabled for every Application by default.
  When no Application has Firecrawl enabled, the capability remains cold and
  its egress remains sealed.
- Firecrawl uses a separate per-Application static credential namespace with
  no automatic expiry and an exact 86,400-second rotation overlap.
- Admin enables or re-enables after accepting the current outbound-processing
  disclaimer. Admin may passively test, rotate, revoke, disable, enable, and
  change policy. Operator access is read-only. F0-U2 supersedes the earlier
  role split for current Product behavior without rewriting the historical
  PR-08 record.
- The Application permission is a Firecrawl on/off permission. Appliance
  egress uses a system-managed exact-host allowlist and public-address
  controls. Customer URL Governance is not reintroduced. Only the controlled
  proxy may reach non-internal destinations. The BFF upstream is exactly
  `http://firecrawl-api:3002`; hosted, HTTPS, alternate-host, and
  alternate-port upstreams are rejected.
- Search terms, target and final URLs, pages, request and response bodies,
  results, tool arguments, cookies, screenshots, and history are transient.
  Request logging is query-free. Only subject, Application, credential,
  action, status, time, rate, concurrency, latency, and count metadata may be
  retained. This is the fixed source contract, not runtime proof; PR-12 must
  remove or isolate native content-bearing logger and span sinks and pass
  retention canaries before release.
- The private pilot is provenance input only. It is never merged or
  cherry-picked wholesale, its ancestry is absent, and its executable
  migration `0027` is excluded.
- PR-08 changes source, backend, and control-plane mechanics only. Its UI
  remains hidden until PR-11. Three exact Web test fixtures may carry only the
  disabled Firecrawl contract projection needed for compatibility; Web
  production paths remain forbidden. Runtime deployment, final images,
  signing, offline packet, SBOM, corresponding-source delivery, and runtime
  qualification remain PR-12 gates. No intermediate pull request is deployed.

## PR-11 fixed decisions

- The customer Console has exactly seven ordered logical surfaces: Overview,
  Applications, Inference, Hardware, Team, Activity & Audit, and Settings.
  `/` renders Overview directly and `/activity` remains the Activity & Audit
  path.
- Applications is one combined Console surface for inference and Firecrawl,
  while inference and Firecrawl credentials remain separate namespaces.
  Firecrawl remains installed and disabled by default.
- Grafana, LiteLLM, and Keycloak appear only as reduced Console previews.
  Native access affordances and live expert-service URLs remain disabled until
  PR-12 proves the no-bypass boundary. An exact Console href manifest,
  internal-only Overview href contracts, BFF response parsing, and null-only
  expert URL payloads enforce the source boundary.
- Portainer and Agentic are absent from product navigation. Chat, Knowledge,
  MCP, Builder, Hub, and their retired loaders, redirects, links, and bundle
  chunks remain absent.
- PR-11 is source-only. It does not deploy runtime changes, activate native
  expert sessions, modify signing keys, or change vendor maintenance access.
- `.env.example` may only delete the exact retired
  `INFERENCE_MODEL_UPDATE_*` block. Added lines, retained-value changes,
  unrelated removals, and every other environment path remain forbidden.
- Settings mutations require PostgreSQL outside explicit fixture mode. The
  settings state, mutation receipt, and success audit share one transaction;
  absent persistence or receipt coordination returns unavailable without a
  success audit. Fresh databases seed a schema-valid telemetry preview, while
  production parsing remains strict with no fallback data.
- Production Web responses use a per-request script nonce. The request and
  response carry the same content security policy, and production
  `script-src` allows neither `unsafe-inline` nor `unsafe-eval`.
- PR-11 removes exactly `POST /api/admin/inference/model-updates/apply`, the
  simulated model-update mutation. It adds and reclassifies no route, leaving
  104 total routes and 92 `current-console-seam` routes. Every other
  classification count and the Fastify registrar inventory remain unchanged.
- This register and the validation register are live indexes. Their original
  PR-08 bytes remain bound through the reviewed PR-11 successor-historical
  evidence mapping; earlier contract revisions and fingerprints are not
  rewritten.
