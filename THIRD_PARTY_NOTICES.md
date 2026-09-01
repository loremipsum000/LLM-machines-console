# Third-party notices and source index

The root `LICENSE` contains the PolyForm Internal Use License 1.0.0 and applies
only to original first-party LLM Machines Product source. Third-party
applications, libraries, images, fonts and upstream-derived patches retain
their existing upstream licences.

`infra/release/third-party-source-map.json` is the machine-readable index that
binds each retained third-party build or runtime component to the immutable Core
inventory, its licence and its notice or corresponding-source obligation. Final
release admission still requires digest-bound licence texts, notices, reviews
and corresponding-source packets where applicable.

| Component | Licence | Source or notice contract |
| --- | --- | --- |
| Node.js runtime base | MIT | Core image inventory and release evidence |
| Nginx Product edge | BSD-2-Clause | Core image inventory and release evidence |
| Keycloak | Apache-2.0 | Core image inventory and release evidence |
| LiteLLM OSS downstream | MIT, with transitive obligations | `infra/litellm/oss-downstream/source-package.json` |
| PostgreSQL | PostgreSQL | Core image inventory and release evidence |
| Prometheus | Apache-2.0 | Core image inventory and release evidence |
| Alertmanager | Apache-2.0 | Core image inventory and release evidence |
| Grafana OSS | AGPL-3.0-only | Corresponding-source packet required at release |
| Firecrawl reduced API and browser | AGPL-3.0-only | `infra/firecrawl/release/source-package.json` |
| SearXNG | AGPL-3.0-or-later | `infra/firecrawl/release/source-package.json` |
| Squid | GPL-2.0-or-later | `infra/firecrawl/release/source-package.json` |
| Urbanist 1.303 | OFL-1.1 | `THIRD_PARTY_LICENSES/Urbanist-OFL-1.1.txt` |

This index does not declare an image release-approved. Exact image digests,
SBOMs, vulnerability dispositions, licence reviews and recipient-accessible
source packets remain release outputs rather than Genesis source claims.
