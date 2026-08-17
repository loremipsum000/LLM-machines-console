# VM103-L1B executable builder toolchain

This package turns the VM103-L1A source contract into reviewed, executable
release-build machinery. It does not provision VM118, build release images,
create a Core lock, push a registry, sign, deploy, activate, or qualify runtime.

The builder profile fixes VMID 118, Debian 13.4 amd64, 6 vCPU, 24 GiB RAM, and
three independently owned disks of 40, 80, and 80 GiB. The two assembly disks
must contain independent checkouts, Docker data roots, BuildKit instances,
caches, temporary files, outputs, and evidence. `run-independent-assembly.sh`
serializes the runs and starts one assembly-owned Docker daemon at a time.

`toolchain-lock.json` content-addresses the Debian installer, Node and Docker
packages, BuildKit, Skopeo, Syft, and Trivy. `egress-allowlist.json` is the
complete outbound hostname policy. `resolve-egress-hosts.py` uses the
provisioning host's `/usr/bin/dig` to create a bounded point-in-time DNS
observation through the policy's exact deployment-network resolver and records
that resolver in the observation. This avoids installing Node.js on Proxmox.
The renderer rejects an observation from any other DNS authority before
converting it into a VM-specific default-deny firewall. The rendered firewall
is reviewed before it is installed as `/etc/pve/firewall/118.fw`; DNS
resolution is not performed implicitly by the firewall renderer.

The official Debian checksum manifest and signature must be verified before
`render-preseed.mjs` and `build-preseed-boot-files.sh` add the operator public
key to a deterministic installer initrd. VM118 boots the kernel and derived
initrd extracted from the verified ISO with QEMU direct-kernel boot. The boot
files are VM118 provisioning evidence, not official Debian media and not a
Product release artifact. The source preseed uses HTTPS because VM118 permits
no outbound cleartext package transport.

The verified Debian ISO remains attached on `ide2` as a read-only CD-ROM for
the complete installation. Direct-kernel boot selects the reviewed kernel,
initrd, and preseed, while the installer reads its required packages from the
same verified media. The CD-ROM is removed only after installation completes
and before the normal disk boot.

The preseed binds Debian's protocol-specific `mirror/https/*` questions to
`deb.debian.org`, `/debian`, and the `trixie` suite. The stale
`mirror/http/*` namespace is rejected because it does not answer the exact
questions selected by the HTTPS protocol and would leave installation
interactive.

Installation is a single-disk phase. `manage-vm118-installer-disks.sh isolate`
snapshots and detaches the two exact assembly volumes while VM118 is stopped,
leaving only `scsi0` available to Debian. This prevents `/dev/sd*` enumeration
from selecting an assembly disk. The preseed binds both partitioning and GRUB
installation to that sole `/dev/sda` device. After the installed system has
booted and is stopped again, `restore` resets only the two snapshotted assembly
volumes and reattaches their exact Proxmox identities. The snapshots preserve
the observed pre-reset state.

Each assembly fetches and verifies its own locked source archives, assembles
the reviewed LiteLLM and Firecrawl source, imports third-party images by exact
platform digest, builds Product and downstream outputs with an exact BuildKit
image, normalizes every OCI layout, and emits raw Syft and Trivy evidence.
`compare-assemblies.mjs` admits only 13-image, byte-identical canonical
inventories. License review, vulnerability disposition, complete
corresponding-source evidence, and final Core-lock generation remain fail-closed
post-assembly gates. `generate-core-image-lock.mjs` consumes the same reviewed
SBOM, provenance, vulnerability, license, notice, and corresponding-source
input layout enforced by `generate-release-evidence.mjs`; it does not synthesize
human review or vulnerability exceptions. No script in this directory accepts
credentials or a registry-push, signing, deployment, or runtime-activation
option.
