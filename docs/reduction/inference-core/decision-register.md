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
| PR-12 source closure | Deterministic Core release packaging and per-delivery inference artifact contracts | `pr-12-aggregate-evidence.json`, `pr-12-source-closure.json`, and source-closure Amendments 1 through 5 | PR 33 through PR 39 remain immutable evidence. Amendment 1 remains immutable evidence. Amendment 2 remains immutable evidence. Amendment 3 remains immutable evidence. Amendment 4 remains immutable evidence. PR 53 remains protected functional history. PR 54 repaired the stale Firecrawl API build-test list, PR 55 corrected the unavailable Node API build input, and PR 57 corrected the remaining index-selected Golang, Wolfi, and Playwright linux/amd64 identities without changing Product behavior. The first actual reduced Firecrawl image then demonstrated that Koffi 2.9.0 requested an executable stack on Wolfi. PR 59 added a deterministic exact-module ELF correction and final-runtime load check without changing Product behavior or the Firecrawl boundary. PR 59 merged at `eefb9c3eb372a5b6789223458ccc319fa9784a04`, tree `884965cf79cfa77044c962614e54a8decfc2b1fd`. Amendment 5 binds that merge as the current D2A release source. The prior `4b2fc6a`, `059866d`, and `5e7761b` release sources are historical, not current. Accepted remains false; runtimeQualified remains false; contract activation remains inactive; D2A-RC and Q0 remain NOT_STARTED; Product main is unchanged |
| F0-P1 | Disposable PostgreSQL persistence and restart qualification | `f0-p1-postgres-persistence.json` | Source candidate only: actual Web/BFF and the real Product migration preserve encrypted sessions and approved Product metadata across one BFF restart; database outage and retention behavior pass locally; no exact-Core or runtime qualification claim |
| F0-O1 | Retained Console observability projection | `f0-o1-observability-projection.json` | Source candidate only: actual Web/BFF render private GET-only LiteLLM, Prometheus, and Alertmanager projections; native administration and Grafana remain absent; no real-service or runtime qualification claim |
| F0-I1 | Disposable Keycloak identity integration | `f0-i1-keycloak-identity.json` | Source candidate only: actual Web/BFF complete role-aware password and TOTP login through exact Keycloak 26.7.0 and the Product identity allowlist; native administration and identity mutations remain excluded; no exact-Core or runtime qualification claim |
| F0-I2 | Scoped Console Team identity mutation | `f0-i2-keycloak-team.json` | Source candidate only: actual Web/BFF use the isolated `console-human-admin` service account and reviewed Keycloak 26.7.0 FGAP v2 scopes for basic Team and local-password actions; native administration and broader realm/client authority remain absent; no exact-Core or runtime qualification claim |
| F0-L2 | Private LiteLLM integration | `f0-l2-private-litellm.json` | Source candidate only: actual Web/BFF route Product-issued Application credentials through exact LiteLLM v1.85.0 to deterministic inference; the Console projection remains read-only, native customer access remains absent, and zero-content-retention canaries pass locally; no SGLang, capacity, exact-Core, or runtime qualification claim |
| F0-F2R | Native-Linux Firecrawl runtime correction | `f0-f2r-firecrawl-linux-runtime.json` | Prospective owning-package successor from protected input `adde6ff484213a4dab1ae1207d8840ad14a4eb52`: explicitly normalizes the non-secret Squid allowlist to mode `0755/0644` under restrictive umasks and preserves exact API and Firecrawl Host authorities over loopback on Linux. Actual reduced Firecrawl search, static scrape, Application credentials, isolation, rotation, revocation, route denial, egress denial, retention, and cleanup pass on VM117 without a new credential, hostname, egress grant, license, or Product-boundary change. Historical F0-F2 evidence remains immutable; accepted and runtimeQualified remain false. |
| F0-C1 | Integrated reduced-Core startup | `f0-c1-integrated-reduced-core.json` | Source candidate only: one disposable command combines actual Web/BFF, PostgreSQL, Keycloak, private LiteLLM, reduced Firecrawl, retained observability, and deterministic inference; complete teardown and reduced Product boundaries pass locally; no SGLang, exact-Core, or runtime qualification claim |
| F0-SG1 | Actual SGLang internal integration smoke | `f0-sg1-internal-sglang.json` | Exact SGLang 0.5.13 built from the approved source and exact digest runs on authorized internal XPU test hardware behind private LiteLLM; completions, streaming, usage, model/context denial, outage recovery, isolation, and retention canaries pass; this is internal compatibility evidence only, with no delivery-profile, capacity, release, or runtime-qualification claim |
| F0-V1 | Pre-Genesis aggregate functional closure | `f0-v1-pre-genesis-closure.json` and `f0-v1-git-inventory.json` | Governance-only aggregate candidate: binds all protected F0 package identities, the reduced startup map, required aggregate gates, preserved branch/worktree inventory, and deferred runtime work; Product acceptance, runtime qualification, contract activation, Genesis publication, and Q0 remain false or not started; protected tree equality and separate publication approval remain mandatory |
| F0-UAT0 | Persistent founder evaluation environment | `f0-uat0-founder-environment.json` and `founder-uat-runbook.md` | Source candidate only: reuses the reduced-Core functional lane on dedicated native Linux/amd64, keeps the four customer authorities loopback-only, stores throwaway founder credentials separately with mode `0600`, and requires explicit operator stop and verified cleanup; no release, deployment, Product acceptance, runtime qualification, Genesis, or Q0 claim |
| F0-E2E2 | Exact founder customer journey | `f0-e2e2-founder-journey.json` | Source candidate awaiting protected UAT replay: adds one pinned standard OpenAI SDK child process to the existing uninterrupted actual Console, Keycloak, private LiteLLM, Firecrawl, PostgreSQL, and observability journey; the Application credential crosses only bounded stdin, the API authority remains TLS-verified and loopback-only, and no release, Genesis, Product acceptance, runtime qualification, or Q0 claim is made |
| F0-V2 | Founder handover aggregate closure | `f0-v2-founder-handover-closure.json` and `f0-v2-git-inventory.json` | Governance-only founder-handover candidate: binds protected PRs 65 through 74, the persistent linux/amd64 reduced-Core environment, uninterrupted browser and standard OpenAI SDK journey, actual reduced Firecrawl, focused UX corrections, private native-service boundary, and preserved Git inventory. Product acceptance, runtime qualification, contract activation, Genesis publication, D2A, Q0, and Product main remain false, inactive, not started, or unchanged. The real SGLang full credential-path replay remains a separate internal subgate because the preserved profile is loopback-only on another host and F0-V2 does not create a cross-host authority. |
| F0-N0 | Prospective retained native administration scope correction | `f0-n0-retained-native-administration.json` | Source-only, non-activating correction from protected input `eecbdc6099d36876b94b78689a54c914f6228eb4`: retains Grafana, scoped Keycloak Admin, Portainer, and LiteLLM native administration behind dedicated Product-edge authorities while preserving Console primacy and the removal of LibreChat, first-party chat, Knowledge, RAG, corpora, MCP, and the Product corpus pipeline. Historical records remain immutable. Service admission, route activation, runtime qualification, Genesis, and Product acceptance remain pending. |
| F0-N1 | LiteLLM OSS-only downstream and native-role characterization | `f0-n1-litellm-oss-downstream.json` and `f0-n1-litellm-native-route-characterization.json` | Exact LiteLLM v1.96.2 source is transformed by a repeatable OSS-only overlay into deterministic `v1.96.2-llmm.1`; Enterprise source, dependency, runtime, UI, hook, route, wheel, SBOM, and notice material is absent. Free Generic OIDC with two of five billable users, Admin `proxy_admin`, Operator `internal_user` own-key and own-spend authority, migration, restart, outage, inference, accounting, and zero-content-retention characterization pass. Native activation remains inactive pending F0-N5. Transitive copyleft sources are now a mandatory release packet. Product acceptance, runtime qualification, Genesis, and Q0 remain pending. |
| F0-N2 | Grafana 13.1.3 Admin-only Generic OAuth/OIDC and security admission | `f0-n2-grafana-native-access.json` and `f0-n2-grafana-native-route-characterization.json` | Exact official Grafana 13.1.3 source and linux/amd64 OCI identities are bound. Admin maps to Editor; Operator, mixed retained roles, and unknown roles are denied; Grafana server administrator is never granted. Elasticsearch, Tempo, and Zipkin datasource plugins are disabled and absent from runtime inventory, while Editor datasource creation is denied. The exact image passes source-only admission with founder-authorized nonreachability exceptions expiring 2026-09-12; expiry or a fresh unexcepted High or Critical finding fails closed. Native activation remains inactive pending F0-N5. Product acceptance, runtime qualification, Genesis, and Q0 remain pending. |
| F0-N3 | Keycloak 26.7.0 branded password login and scoped appliance-realm administration | `f0-n3-keycloak-native-access.json` and `infra/keycloak/native-admin-profile.json` | Exact Keycloak 26.7.0 browser and Admin REST characterization proves the repository-owned login theme, password-only pre-Genesis login, 8-hour idle and 24-hour maximum sessions, Admin-only user/password/session authority, metadata-only subject binding, Operator and cross-realm denial, native logout, restart, outage, and credential-free route inventory. Keycloak Users `manage` also permits deletion, so the approved layered design requires F0-N5 to deny exact user DELETE requests at the Product edge before activation. Native ingress remains inactive; Product acceptance, runtime qualification, Genesis, and Q0 remain pending. |
| F0-N3R | Console session contract correction | `f0-n3r-session-contract-correction.json` | Prospective source-security successor from protected input `0b0240c3aac9348198fd3959a5ba571ff94d57ac`: aligns the stale shared Console contract with the already-approved and implemented 8-hour idle and 24-hour maximum profile while retaining five-minute access tokens, refresh rotation, revocation, safe same-origin redirect, identity-outage recovery, concurrent refresh, and logout. Idle and maximum expiration use controlled time rather than wall-clock waits. Historical F0-N3 evidence remains byte-identical; activation remains pending F0-N7. |
| F0-N3T | Keycloak runtime-bootstrap correction | `f0-n3t-keycloak-runtime-bootstrap.json` | Prospective test-runtime successor from protected input `155a4fe5004b7a0d0e2ae880aea752e69deeafd2`: preserves host-only throwaway credential custody while making the generated import material readable to the non-root Keycloak container, aligns the disposable realm with the existing no-offline-browser-token seed, synchronizes controlled time before real identity login, and replaces the stale TOTP outcome with the approved password-only flow. Exact Keycloak 26.7.0 plus PostgreSQL 17.6 passes on isolated VM117 with metadata-only evidence and complete run-owned cleanup. Historical F0-I2, F0-N3, and F0-N3R evidence remains byte-identical; Product runtime behavior and boundaries are unchanged; activation remains pending F0-N7. |
| F0-L2R | Integrated LiteLLM OSS runtime binding | `f0-l2r-litellm-runtime-binding.json` | Prospective integrated-runtime successor from protected F0-N3T input `f8ac8d762ff2838937c46e4826c5faeeb53a0ab5`: binds the disposable reduced-Core lane to exact admitted LiteLLM OSS `v1.96.2-llmm.1`, rejects the historical 1.85 image and fallback substitution, and records a passing full-Core VM117 replay with actual Web, BFF, PostgreSQL, Keycloak, private LiteLLM, reviewed Firecrawl, retained observability, deterministic inference, restart persistence, no-bypass controls, and zero workload-content retention. Fixture-readability corrections are limited to generated credential-free container inputs; Product behavior, routes, authority, permissions, and native ingress are unchanged. Earlier local candidates remain unpushed historical evidence. Product acceptance and runtime qualification remain false, activation remains pending F0-N7, Q0 is not started, and Genesis is unpublished. |
| F0-L2S | LiteLLM immutable-subject native commissioning successor | `f0-l2s-litellm-native-commissioning.json` and `infra/litellm/native-user-commissioning.json` | Prospective runtime-startup successor from protected input `9adf82ffbf8f4617a7846e69e436acd21b9270c8`: commissions the two approved native LiteLLM users idempotently against immutable Keycloak `sub` values, maps Admin to `proxy_admin` and Operator to `internal_user`, disables automatic key creation and deletion, restricts the Operator UI to own keys and spend, and keeps the LiteLLM master secret system-only. Exact admitted OSS `v1.96.2-llmm.1` passes browser OIDC, PKCE, role, own-key, spend, cross-user denial, routing, accounting, logout, restart, outage, retention, and cleanup proof on VM117. Historical LiteLLM evidence remains unchanged; native ingress, Product acceptance, runtime qualification, Genesis, and Q0 remain pending F0-N7. |
| F0-N4 | Portainer upstream-security deferral | `f0-n4-portainer-upstream-security-deferral.json` | Prospective `DEFERRED_UPSTREAM_SECURITY` amendment: preserves the exact Portainer CE 2.39.6 reproducibility and security feasibility result as non-admission evidence, keeps Portainer outside the current Core BOM, image lock, startup, ingress, navigation, deployment, and Product claims, and permits the three-service F0-N5 through F0-N8 sequence to continue. Portainer is not permanently removed; a separately authorized F0-N4R must repeat full admission against a suitable newer upstream CE release. Product acceptance, runtime qualification, contract activation, Genesis, and Q0 remain unchanged. |
| F0-N5 | Three-service native Product-edge profiles | `f0-n5-native-edge.json` and `infra/ingress/native-admin-edge-profile.json` | Source-only exact hostname, method, path, query-key, header, cookie, redirect, Origin, CSRF, static-asset, SSE, logout, outage, and denial profiles for Grafana 13.1.3, LiteLLM OSS `v1.96.2-llmm.1`, and Keycloak 26.7.0 appliance-realm administration. Native sessions remain service-owned; Console sessions and Product credentials are rejected on native authorities. Grafana remains Admin Editor only, LiteLLM preserves Admin `proxy_admin` and Operator `internal_user` own-key/spend authority, and Keycloak user DELETE is denied with 403 at the Product edge. Portainer remains deferred and absent. Activation remains `INACTIVE_PENDING_F0_N7`; accepted and runtimeQualified remain false; Q0 and Genesis remain unstarted. |
| F0-N5R | Keycloak dual-authority edge correction | `f0-n5r-keycloak-dual-authority.json` and `infra/ingress/native-admin-edge-profile.json` | Prospective source correction from protected input `4585830069cb91cf1806a3a3308c7663860b6822`: binds Keycloak 26.7.0 frontend OIDC to the identity authority, binds administration to the dedicated authority with external `/keycloak`, and strips that prefix only inside the exact admin allowlist before reaching the root-path upstream. Exact user DELETE remains a pre-rewrite `403`; duplicate OIDC on the admin host remains denied. Historical F0-N5 evidence is unchanged. A disposable path proof passes, while complete browser and no-bypass validation remains F0-N7. Activation, Product acceptance, runtime qualification, Q0, and Genesis remain pending. |
| F0-N5S | Grafana OAuth entry query correction | `f0-n5s-grafana-oauth-entry.json` and `infra/ingress/native-admin-edge-profile.json` | Prospective source correction from protected input `dbdc1005711ea2cbfb3658a268181dbd2deef6e0`: the exact Grafana `/login/generic_oauth` route accepts an empty query only for OAuth initiation and the four characterized callback keys for completion. LiteLLM retains its separate callback policy. A disposable HTTPS browser proof passes PKCE, Admin Editor, Operator denial, dashboard mutation, unknown-query denial, and cleanup. Historical F0-N5 and F0-N5R evidence remains unchanged. Complete three-service validation remains F0-N7; activation, Product acceptance, runtime qualification, Q0, and Genesis remain pending. |
| F0-N5T | Keycloak Admin browser token Origin correction | `f0-n5t-keycloak-admin-token-origin.json` and `infra/ingress/native-admin-edge-profile.json` | Prospective security correction from protected input `ec2508c76f2b35b34407738dd2f3cdcc286e4608`: the human-realm token endpoint permits Origin-less server exchange and preserves only the exact dedicated Keycloak Admin browser Origin. Every other browser Origin receives `403` before Keycloak. Exact Keycloak 26.7.0 browser proof passes token exchange and appliance-realm Admin Console loading without changing `security-admin-console`, forwarding Console material, or broadening CORS. Historical F0-N5, F0-N5R, and F0-N5S evidence remains unchanged. Complete F0-N7 validation and activation remain pending. |
| F0-N5U | Keycloak session identifier edge correction | `f0-n5u-keycloak-session-identifier.json` and `infra/ingress/native-admin-edge-profile.json` | Prospective security correction from protected input `fbcc7d81bef80c0346942380a0361fe64c2b69fa`: exact Keycloak 26.7.0 source proves that user-session IDs are 24-character URL-safe Base64 values generated from 18 random bytes. The existing session-invalidation route admits only that exact shape and `DELETE`; malformed identifiers, queries, other methods, user deletion, Console material, and Product credentials remain denied. Focused VM117 proof invalidates real sessions and removes all owned state. Historical F0-N5 through F0-N5T evidence remains unchanged. Complete F0-N7 validation and activation remain pending. |
| F0-N5V/F0-N1 | LiteLLM native cookie security correction | `f0-n5v-litellm-cookie-security.json` and `infra/ingress/native-admin-edge-profile.json` | Prospective security correction from protected input `0317d2effb29a1a6cbaa4fc0fc8332b140a5a03f`: the Product edge forces Secure and SameSite=Lax on the exact pinned LiteLLM native cookies, and additionally forces HttpOnly on all three state cookies. The `token` cookie remains deliberately JavaScript-readable because exact LiteLLM OSS v1.96.2 requires `document.cookie`; dedicated HTTPS authority, strict route allowlisting, private direct port, and no Console-token forwarding compensate for that upstream limitation. Focused VM117 OIDC, PKCE, role, cookie, logout, and cleanup proof passes without recording values. Historical F0-N1 and F0-N5 through F0-N5U evidence remains unchanged. Complete F0-N7 qualification and activation remain pending. |

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

## F0-N6 prospective Console Technical Tools decision

- Technical Tools is a role-filtered section inside Settings, not an eighth
  primary Console surface. Console remains the recommended simplified Product
  experience and remains complete without native tools.
- Admin sees Grafana, LiteLLM, and the scoped Keycloak Admin Console. Operator
  sees LiteLLM only. Portainer remains `DEFERRED_UPSTREAM_SECURITY` and absent.
- Native links are built server-side from three credential-free commissioning
  hostname inputs and fixed source-controlled paths. Invalid or missing input
  produces a non-link state. URLs never carry credentials, tokens, query
  parameters, fragments, user information, or arbitrary paths.
- Native tools open outside Console and retain their own Keycloak-backed
  sessions. Console session material, Product credentials, and native
  credentials are never shared or forwarded.
- Console Application credentials remain the recommended customer integration
  path. LiteLLM virtual keys are a separate advanced technical path.
- This is source UI only. Native ingress, runtime, VM103, DNS, certificates,
  and gateway state remain unchanged pending F0-N7.
