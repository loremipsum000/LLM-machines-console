# VM103-L1B P12 runtime failure evidence

This directory is the credential-free export captured before VM118 disk
restoration. The complete copy is also preserved outside the disposable guest
at:

`/Users/dardanberisha/Temp/LLM-machines/product-evidence/vm103-l1b-p12-runtime-20260818`

The complete external inventory manifest is `SHA256SUMS.relative`, with SHA-256
`cc9bce70880dfc7a510efb07c9fcbf043cc6297daab1bca6b2ce954bf7cca4ab`.
Transient empty Docker and BuildKit databases remain only in that complete
external copy. They are not Product source inputs.

The complete raw bootstrap and Docker logs also remain only in the external
copy so terminal control characters and volatile package progress output do
not enter Product history. Their exact SHA-256 values are:

- bootstrap: `c70859c9fe507ec4ff7d2019d080c1b15fbc44d376cfcaf0113f36eba9cb3d1a`
- Docker: `7eb33999ce85fe7d44ac5baa080644399c9b0b17b9e3fd172fd4cabafccd9c8f`

The raw Proxmox snapshot dump remains in the same external bundle with SHA-256
`3172ae079cccd133836ed4355abc515885e1f1ad1258974f499ad14851884edf`.
The source contract records the exact snapshot and three disk GUIDs without
introducing unrelated live-host description text into the Product-shape scan.

The source-controlled `SHA256SUMS` binds every retained text artifact.
`runtime-root-inventory.txt` records special files that cannot
be reproduced on the macOS evidence host.

P12 did not capture separate pre-start or active firewall snapshots. It
captured the post-cleanup state that caused the native lifecycle gate to fail.
That gap is preserved rather than reconstructed. The retained Docker log proves
that Docker 29.5.3 reached readiness and initialized BuildKit. The post-cleanup
iptables and nftables captures prove that Docker-created tables, chains, jumps,
forwarding policy, and the Assembly A masquerade rule remained after the
daemon, process, socket, PID, bridge, route, and namespace cleanup completed.

Assembly A image construction did not start. The produced release-image count
is zero of the expected thirteen, and Assembly B was not attempted.
