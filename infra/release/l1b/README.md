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
packages, the exact Debian `iproute2` package used for bridge management,
BuildKit, Skopeo, Syft, and Trivy. `egress-allowlist.json` is the
complete outbound hostname policy. `resolve-egress-hosts.py` uses the
provisioning host's `/usr/bin/dig` to create a bounded point-in-time DNS
observation through the policy's exact deployment-network resolver and records
that resolver in the observation. This avoids installing Node.js on Proxmox.
The renderer rejects an observation from any other DNS authority before
converting it into a VM-specific default-deny firewall. The rendered firewall
is reviewed before it is installed as `/etc/pve/firewall/118.fw`; DNS
resolution is not performed implicitly by the firewall renderer.

`egress-transaction.mjs` creates one exact three-file transaction containing
the reviewed resolution, the firewall rendered from it, and hashes binding
both files to the source-controlled policy and builder profile. Only the
transaction firewall may be installed, and its read-back bytes must pass
the Proxmox-side `create-firewall-receipt` command, which is hard-bound to
`/etc/pve/firewall/118.fw`, to create a VMID-118 receipt. The complete
transaction and its matching receipt are mandatory bootstrap inputs. Bootstrap
revalidates both before and after its private copy, then renders a files-first host binding
before any network fetch and copies the exact transaction onto both assembly
volumes. Each assembly starts a private,
non-forwarding dnsmasq instance from that copy and assigns it to its isolated
Docker bridge. BuildKit, image import, source fetch, and scan containers do not
use host networking. Substituting a second, individually valid DNS observation
therefore fails the transaction hash before bootstrap or assembly starts.

`docker-bridge-profiles.json` is the single A/B network authority. Assembly A
uses `llmml1ba0` and `172.30.118.0/24`; Assembly B uses `llmml1bb0` and
`172.31.118.0/24`. `docker-lifecycle.sh` requires root, rejects any prior
runner-owned path, process, bridge, address, route, namespace, or firewall
state, creates the exact named bridge before Docker, and passes only
`--bridge` to Docker 29.5.3. The same lifecycle starts, verifies, monitors, and
cleans both assemblies and the separate privileged native gate. Complete
Docker logs remain permission-restricted evidence; only a bounded log with
credential-like lines removed may reach normal command output. Cleanup keeps
the workload's original failure status, deletes only the bridge whose ifindex
and alias still match the runner's ownership record, and proves that no
runner-owned runtime or network state remains. A successful cleanup failure
therefore converts an otherwise successful run into a failure.

The lifecycle captures credential-free iptables v4, iptables v6, nftables, and
relevant sysctl state before Docker starts, while Docker is active, after its
graceful stop, and after cleanup. `firewall-lifecycle.mjs` derives the exact
Docker-created delta. It accepts only rules, chains, tables, policies, and
sysctl changes attributable to the admitted bridge profile. Graceful shutdown
is attempted first. Any remaining Docker-owned rule is removed by exact rule
index or exact Docker-created table identity. The runner never flushes a
firewall, invokes `iptables-restore`, or replaces an unrelated policy. The
final normalized state must equal the pre-start state, with volatile counters
ignored. Runtime roots are deleted only after mount and residue checks pass;
complete logs and firewall evidence remain outside those roots.

`run-native-docker-lifecycle-gate.sh` is mandatory after bootstrap and before
Assembly A. It exercises Docker 29.5.3 startup, socket and root binding, bridge
and CIDR verification, and complete cleanup without building or importing an
image. Its runtime roots are deleted only after a passing residue check; its
complete Docker log and credential-free receipt remain in the supplied
evidence directory. A failed gate preserves its runtime root for inspection.

The allowlist, resolver output, JavaScript transaction validator, and Python
guest binding validator share the explicit `IPV4_NUMERIC_ASCENDING` address
order contract. A resolution using lexical ordering or a different declared
rule fails before firewall installation or guest bootstrap.

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
Bootstrap installs Docker packages behind a temporary, fail-closed Debian
service-start policy. Docker, its socket, and containerd must remain inactive
and disabled under the same canonical runtime-unit rule, and both global data
roots must remain absent or empty, before
either assembly disk is formatted. The policy is removed only after those
checks pass; a pre-existing policy is never overwritten.
`compare-assemblies.mjs` admits only 13-image, byte-identical canonical
inventories. License review, vulnerability disposition, complete
corresponding-source evidence, and final Core-lock generation remain fail-closed
post-assembly gates. `generate-core-image-lock.mjs` consumes the same reviewed
SBOM, provenance, vulnerability, license, notice, and corresponding-source
input layout enforced by `generate-release-evidence.mjs`; it does not synthesize
human review or vulnerability exceptions. No script in this directory accepts
credentials or a registry-push, signing, deployment, or runtime-activation
option.
