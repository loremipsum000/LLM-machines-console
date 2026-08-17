# Release image identities

This directory separates the fixed Core Appliance image set from the variable
inference delivery profile.

`core-image-inventory.json` is the authoritative source inventory. It fixes the
retained image-bearing Core components, the `linux/amd64` VM103 planning
baseline, exact third-party source image identities, licenses, and the required
registry-neutral mirror repository paths. Product Web and BFF images and the
four reduced
Firecrawl images are deterministic release-build outputs. Their digests cannot
be guessed or copied from a historical lab. Release assembly must build them,
verify them, and bind them in a `LOCKED` artifact that conforms to
`core-image-lock.schema.json`.

The Core lock is invalid if a retained component is absent, a tag is mutable,
a platform is missing, a mirrored third-party digest differs from its approved
source digest, or SBOM, provenance, vulnerability, license, notice, license
review, and required corresponding-source evidence are missing. Each entry also
binds the exact OCI archive path and archive, OCI index, and `linux/amd64`
platform-manifest digests. The universal signed lock contains no registry
authority.

`deployment-placement.schema.json` and
`validate-deployment-placement.mjs` define the separate commissioning-only
placement record. A customer-supplied registry authority must be present in the
commissioning allowlist, must not be a public registry, and combines only with
the signed mirror repository paths and digests. The credential-free record
binds the exact release-manifest and Core-lock hashes, verifies the imported OCI
archive plus mirrored index and platform manifests, and records the effective
digest-only references in commissioning and metadata-only audit evidence.
Registry credentials are neither accepted nor stored. Customer registry
authorities remain outside Product source and the universal release artifact.

`inference-artifact-lock.schema.json` is a separate delivery artifact. It binds
one delivery profile to SGLang `0.5.13`, one exact engine image, one exact model
revision and weight set, the compatible Core image lock, and one exact rollback
identity. Changing accelerator hardware or model capacity creates a new signed
profile and inference lock. It never changes the Product source or Core image
lock.

These files are source and packaging contracts only. They do not build, mirror,
sign, deploy, activate, or runtime-qualify an image.

`core-image-build-contract.json` fixes the source-to-OCI build modes for all 13
retained Core images. Third-party images are imported from their exact approved
linux/amd64 platform manifests. Console Web and BFF are built from the checked
out protected integration source. LiteLLM and the Firecrawl API and browser are
built only from their reviewed downstream source assemblies. The Firecrawl
search and egress images are imported from the exact source-package platform
digests. The contract does not contain output digests and cannot generate a
Core lock by itself. Output admission requires an isolated native linux/amd64
build environment, an exact source-controlled toolchain lock, a Trivy database no older
than 72 hours, enough capacity for two independent complete assemblies, and
byte-identical results. Emulated builds do not qualify for output admission.
The build contract permits no credentials, registry mutation, signing, or
deployment.

## Deterministic release manifest

`release-plan.json` fixes the source-only PR-12 packaging envelope. The Core
package is one deterministic `linux/amd64` appliance artifact for the 8 vCPU,
32 GiB RAM, and 100 GiB local-disk baseline. Inference remains a separately
signed delivery-profile revision and is never selected by the Core build.

The final release manifest conforms to `release-manifest.schema.json`. Its
artifact inventory is path-sorted, content-addressed from regular files, bound
to the checked-out Git commit, tree, and commit epoch, and explicitly remains
`PACKAGED_UNQUALIFIED`. CycloneDX 1.6 JSON is the SBOM format. SLSA provenance
v1 in an in-toto statement is the provenance format. Release signatures use a
scoped vendor `release-artifact` Ed25519 key during a separate offline ceremony.
Only public trust material may enter the package.

`release-evidence-policy.json` fixes the semantic evidence gate. Every retained
image requires a CycloneDX component inventory and dependency graph with tool
metadata, exact SLSA build inputs and approved build-actor identity, a
digest-bound
Trivy report with a database no older than 72 hours, reviewed zero-critical and
zero-high disposition or a bounded unexpired exception, and a reviewed license
text plus notice bound to the exact component and source revision.

`generate-release-evidence.mjs` converts one validated Core image lock and the
actual per-image CycloneDX, SLSA provenance, vulnerability report and
disposition, license text, notice, license review, and corresponding-source
inputs into deterministic release evidence. It rejects inputs whose hashes,
identities, recipes, build actor, timestamps, scan policy, or review bindings
differ from the Core lock and evidence policy. The checked-in
`license-disposition.json` is a source policy, not a substitute for the license
texts, notices, reviews, and corresponding source delivered with a release.

`generate-clean-seeds.mjs` packages the PostgreSQL schema plus its six exact
empty-appliance lifecycle rows and
the two validated, credential-free Keycloak logical realms and commissioning
plans. It never generates one-time values. Those remain a witnessed
commissioning action outside Git and outside PR-12 source packaging.

`generate-release-manifest.mjs` consumes a credential-free declaration and an
artifact directory, then derives every size and SHA-256 from the actual files.
It rejects missing, undeclared, duplicate, mutable, symbolic-link, hard-link,
or unsafe artifacts; requires every evidence ID in `release-plan.json`; and
validates the actual Core image lock. It performs no build, registry, signing,
network, or runtime action. Run the source-policy checks with:

`assemble-core-package.mjs` creates the normalized USTAR plus zstd Core package
from the five exact payload roots: configuration, images, lifecycle tooling,
clean seeds, and public verification material. Assembly requires the Core lock,
rejects extra or missing OCI archives, and derives each archive digest from the
actual payload. It also parses each normalized OCI layout and verifies the
actual index, linux/amd64 platform manifest, and every referenced blob against
the lock before packaging. Third-party entries separately bind the approved
upstream multi-platform index and platform-manifest digests. The archived
platform manifest must remain byte-identical to that approved source; the
normalized single-platform OCI layout index has its own derived digest. Blob
hashing is streamed and retained metadata is bounded, so image layers are not
loaded wholesale into memory.
`verify-release-bundle.mjs`
verifies the canonical manifest, its offline Ed25519 signature, the
root-certified scoped release key, every artifact, and the actual Core lock.
It requires an independently provisioned SHA-256 fingerprint for the offline
release root and proves that the trust document used for verification is the
exact `public-release-trust` artifact declared by the signed manifest. The
fingerprint is an out-of-band trust anchor, not caller-selected package data.
`clean-room-install.mjs` extracts a verified package only into a new target and
records `INSTALLED_UNQUALIFIED`; it never activates services. Rollback tooling
produces and validates `PREPARE_ONLY` metadata only after independently
verifying both complete releases, with non-null manifest and Core-package
bindings for both the current and rollback target.
For the first Product release only, the separately schema-bound initial-install
descriptor records `INITIAL_INSTALL_NO_PREDECESSOR` and
`NO_RELEASE_ROLLBACK`. Manifest construction and public bundle verification
parse this evidence instead of treating it as opaque bytes. Its commissioning
verifier requires credential-free, appliance-bound empty-state evidence whose
canonical digest is supplied through a separate trusted Q0 channel. PR-12 does
not select that observer's signing, custody, or customer-approval authority;
those remain Q0 trust inputs. It remains runtime-unqualified, inactive, and
blocked on
`Q0_PREINSTALL_BACKUP_AND_CLEAN_RESTORE`. Any later release continues to bind a
different, completely signed and independently verified predecessor release;
the first-release descriptor cannot be reused.
The later-release v2 descriptor avoids a manifest self-reference: its current
side binds the source identity and actual Core package, while its target binds
the predecessor manifest and Core package. The current manifest validates and
signs that descriptor. Rollback execution independently verifies both complete
signed bundles before accepting either binding. Public verification of a
`SIGNED_PREDECESSOR` release fails unless the exact independently trusted target
bundle is supplied and matches every target binding.
Private signing material is neither accepted nor generated by these tools.

The Core image lock, release evidence index, and release manifest use their v2
schemas. Their v1 forms were source-only pre-release drafts and were never
signed, distributed, or accepted as a D2A release artifact. The v2 formats are
the first admissible offline release formats.

Deployment placement is generated only after public bundle verification. The
commissioning tool derives the manifest hash from the signed manifest, reads
the packaged Core lock, and inspects both the imported OCI archives and
credential-free exports of the exact mirrored digest references. The external
commissioning allowlist is the authority for classifying a customer registry
as private. Registry credentials are process inputs to the customer-owned
export operation and must never enter the placement document.

The signature and trust files conform to `release-signature.schema.json` and
`release-public-trust.schema.json`. The release root remains offline and
hardware-backed. A root-certified scoped `release-artifact` key signs the exact
canonical manifest during a separate offline ceremony. Key revocation and the
bounded predecessor dual-trust window fail closed in the public verifier.

```sh
node infra/release/validate-release-plan.mjs
node infra/release/validate-deployment-placement.mjs --manifest <release-manifest.json> --signature <release-signature.json> --trust <public-release-trust.json> --artifact-root <artifacts> --trusted-root-sha256 <out-of-band-root-sha256> --import-root <verified-core-payload> --registry-export-root <credential-free-mirror-exports> --registry-authority <customer-registry-authority> --approved-registry <customer-registry-authority> --commissioning-evidence-id <id> --audit-evidence-id <id> --output <commissioning-placement.json>
node --test infra/release/validate-release-plan.test.mjs
node --test infra/release/offline-lifecycle.test.mjs
```
