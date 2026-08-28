# Portainer CE downstream third-party notice

This notice covers the source-built LLM Machines downstream of Portainer
Community Edition 2.39.6. It does not admit the image to the Core release by
itself. Runtime, security, reproducibility, SBOM, provenance, vulnerability,
and Product-integration gates remain separate.

| Component | Exact upstream identity | License | Downstream role |
| --- | --- | --- | --- |
| Portainer Community Edition | `2.39.6`, commit `723d1a2268f0fefe70d57f5981ce15d5d1ffc679`, tree `9a2418f78d3f2cf4047e86b0878227b5e61d55fa` | `Zlib` | Customer-owned appliance administration |

The upstream license is preserved at `LICENSE.upstream` with SHA-256
`34ce81cbe1a30cf05ecb8e106dfffaff2c3d4df918caba336026240d0f6194e9`.
That copy adds one terminal newline; the upstream text is otherwise
byte-identical and its original source SHA-256 is
`c83f08165206f8a2831009fa4a469d41e452f6e086945246fe928a94a5420722`.
Upstream attributions are preserved at `ATTRIBUTIONS.upstream.md` with
SHA-256
`e3f8444f7222a7f8ebdfc237b2edb29e01443e159267c0cb87e7cb71ae4b41e3`.

## Altered downstream source

The downstream version is `2.39.6-llmm.1` and is plainly marked as altered.
The security overlay is recorded at `patches/security-toolchain.patch` with
SHA-256
`094874794823a27ab422cd9c380345d3e27d3268a2403192894a516b221487cd`.
The image labels also identify the downstream version, upstream revision,
`Zlib` license, and altered-source state.

Exact component-level license and notice custody for the source-built backend
and shipped frontend is recorded by `evidence/artifact-license-evidence.json`
and the two manifests under `evidence/license-custody/`. Package and source
archives remain in the sealed external VM117 evidence root; only their exact
identities and the reviewed legal texts are carried in this source package.

The distributed boundary is source-built from the exact public CE source and
the reviewed overlay. The upstream `portainer/portainer-ce:2.39.6` binary image
is not used as the downstream build input and is not admitted as a substitute.
Its published OCI source-revision label is not bound to the public 2.39.6 tag.

No Portainer Business Edition source, image, module, feature payload, trial
material, commercial license key, or future purchasing obligation is included.
No paid or trial feature is required by this source package. Business Edition,
trial, and commercial-license-controlled material remain prohibited build and
distribution inputs.
