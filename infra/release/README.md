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
