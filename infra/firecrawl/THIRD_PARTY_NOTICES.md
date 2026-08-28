# Firecrawl profile third-party notice

This source notice records the direct modified or distributed components in the
reduced Firecrawl profile. Exact archives, license fingerprints, build inputs,
ordered patches, and packet assembly are bound by
`release/source-package.json`. Image SBOMs and final vulnerability dispositions
must add transitive package evidence before release admission.

| Component | Exact source identity | Declared license | Product role |
| --- | --- | --- | --- |
| Firecrawl | `v2.11.0`, `ef12eb36b2f3382838dfe0a0c1a5add3d5df7fe5` | `AGPL-3.0-only` | Reduced API and browser source |
| SearXNG | `2026.7.28-c01178d03`, `c01178d03129d861582adf84a692e699f2f7ec05` | `AGPL-3.0-or-later` | Private search service |
| Squid | `SQUID_6_14`, `a8c54a8f23f0dc41025097caab73ec445f49b78f` | `GPL-2.0-or-later` | Fail-closed egress proxy |
| Playwright | `v1.62.0`, `e3950d9c140d007bd52853b45813c6274b24e36f` | `Apache-2.0` | Browser runtime and Chromium binding |

The Firecrawl modification set is limited to deterministic and hardened build
inputs, dependency remediation, a non-root runtime, the search-and-static-scrape
entrypoint, and self-hosted zero-content-retention controls. The corresponding
source packet contains the pristine sources and the complete ordered patch set,
as well as a fully patched Firecrawl tree.

No distributed image is release-approved merely because it appears in this
notice. PR-12 must still bind exact private-registry image digests, CycloneDX
SBOMs, SLSA provenance, vulnerability dispositions, public verification
material, and the recipient-accessible corresponding-source packet to the Core
release lock. Q0 must then qualify disabled and one-Application-enabled runtime
states on the fixed Core baseline.
