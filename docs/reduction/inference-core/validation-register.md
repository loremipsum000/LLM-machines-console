# Inference Core validation register

The contract revisions under `contract-revisions/` bind accepted package
trees to their generated route and repository baselines. This register tracks
the human-readable gate state without replacing those machine-verifiable
artifacts.

| Package | Scope | Validation state |
| --- | --- | --- |
| PR-02 through PR-07 | Accepted integration history | Bound by reviewed per-package decisions and contract revisions |
| PR-08 | Firecrawl search and static scrape | Passed on the reviewed PR-08 candidate; PR-12 runtime gates retained |

## PR-08 required evidence

- Exact private source checkpoint and Product base identities remain bound.
- Every reconstructed unit maps through `pr-08-firecrawl-source-manifest.json`
  and one target-file-level row in `source-map.jsonl`; excluded pilot content,
  pilot ancestry, and migration `0027` remain absent.
- Dedicated Firecrawl keys cannot authenticate to inference, and inference,
  OAuth, human, or LiteLLM credentials cannot authenticate to Firecrawl.
- Default-off, disclaimer, Admin and Operator role, no-expiry, 86,400-second
  overlap, immediate revoke, parent-Application disable, and passive
  connection-evidence tests pass.
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
