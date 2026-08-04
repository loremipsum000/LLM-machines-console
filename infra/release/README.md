# Release image identities

This directory separates the fixed Core Appliance image set from the variable
inference delivery profile.

`core-image-inventory.json` is the authoritative source inventory. It fixes the
retained image-bearing Core components, the `linux/amd64` VM103 planning
baseline, exact third-party source image identities, licenses, and the required
private mirror destinations. Product Web and BFF images and the four reduced
Firecrawl images are deterministic release-build outputs. Their digests cannot
be guessed or copied from a historical lab. Release assembly must build them,
verify them, and bind them in a `LOCKED` artifact that conforms to
`core-image-lock.schema.json`.

The Core lock is invalid if a retained component is absent, a tag is mutable,
a platform is missing, a mirrored third-party digest differs from its approved
source digest, or SBOM, provenance, license, and required corresponding-source
evidence are missing. The private registry authority is supplied during release
assembly and is never a credential.

`inference-artifact-lock.schema.json` is a separate delivery artifact. It binds
one delivery profile to SGLang `0.5.13`, one exact engine image, one exact model
revision and weight set, the compatible Core image lock, and one exact rollback
identity. Changing accelerator hardware or model capacity creates a new signed
profile and inference lock. It never changes the Product source or Core image
lock.

These files are source and packaging contracts only. They do not build, mirror,
sign, deploy, activate, or runtime-qualify an image.

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

`generate-release-manifest.mjs` consumes a credential-free declaration and an
artifact directory, then derives every size and SHA-256 from the actual files.
It rejects missing, undeclared, duplicate, mutable, symbolic-link, hard-link,
or unsafe artifacts; requires every evidence ID in `release-plan.json`; and
validates the actual Core image lock. It performs no build, registry, signing,
network, or runtime action. Run the source-policy checks with:

```sh
node infra/release/validate-release-plan.mjs
node --test infra/release/validate-release-plan.test.mjs
```
