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
  disclaimer. Admin and Operator may view, passively test, rotate, revoke, or
  disable existing access. Operator cannot enable outbound access, accept the
  disclaimer, or change LiteLLM routes.
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
