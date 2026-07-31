# Firecrawl profile third-party notice

This file records source identity and declared licenses for the source candidate.
It is not the complete client-distribution notice or corresponding-source packet.

## Firecrawl

- Project: <https://github.com/firecrawl/firecrawl>
- Version: `v2.11.0`
- Commit: `ef12eb36b2f3382838dfe0a0c1a5add3d5df7fe5`
- Declared license: `AGPL-3.0-only`

The LLM Machines boundary changes orchestration, network isolation, resource
limits, logging and retention policy, self-hosted search routing, browser
hardening, and the exposed route set. The historical patch hashes are retained
in `provenance/source-lock.json`, but those patches are not admitted to this
reduced profile because they target a wider queued runtime.

Before customer distribution, PR-12 must preserve the exact upstream source,
the complete reviewed modification set, build instructions and locks, the full
AGPL license text, and recipient-accessible corresponding source matching every
distributed Firecrawl image.

## Direct runtime components

The preserved source checkpoint also identified these direct components:

| Component | Preserved revision | Declared license |
| --- | --- | --- |
| SearXNG | `2026.7.28-c01178d03` | `AGPL-3.0-or-later` |
| Playwright | `1.62.0` | `Apache-2.0` |
| Squid | `SQUID_6_14` | `GPL-2.0-or-later` |

PR-12 owns the final dependency inventory, complete license texts, notices,
SBOMs, signed image provenance, and corresponding-source admission. No runtime
image is release-approved merely because it appears in this notice.
