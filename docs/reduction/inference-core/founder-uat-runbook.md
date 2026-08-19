# Founder UAT environment

F0-UAT0 reuses the F0-C1 reduced-Core machinery on one dedicated native
Linux/amd64 VM. It is a private evaluation lane, not a release, deployment, or
runtime-qualification procedure.

## Operator commands

From a clean Product checkout with the frozen dependencies installed and the
workspace built:

```sh
node scripts/pre-genesis/reduced-core-uat.mjs start
node scripts/pre-genesis/reduced-core-uat.mjs status
node scripts/pre-genesis/reduced-core-uat.mjs stop
```

`start` creates generated state below
`~/.local/state/llm-machines/founder-uat`, performs the integrated startup and
browser proof, and returns only after the environment reports `READY`. The
supervisor and all Product services then remain running. `stop` is the only
normal cleanup action. It waits for orderly teardown and fails if owned
containers remain. It never targets an unrelated container or directory.

The status response gives the loopback edge port, source commit and tree,
credential-file location, generated CA path, and a credential-free inventory.
The credential file is mode `0600`; no credential is printed by start or
status. Read it over the authenticated SSH session with a pager when founder
access is required. Do not copy it into chat, shell history, screenshots, or
test evidence.

## Private appliance placement

The default remains the loopback-only `.llmm.test` founder lane. A durable
private lab placement may set `F0_UAT0_PLACEMENT_FILE` to an absolute,
credential-free JSON document before `start`:

```json
{
  "schemaVersion": 1,
  "authorities": {
    "console": "https://console.example.invalid",
    "api": "https://api.example.invalid",
    "identity": "https://identity.example.invalid",
    "firecrawl": "https://firecrawl.example.invalid"
  },
  "edgeBindAddress": "<private-core-ipv4>",
  "edgePort": 18443,
  "tls": {
    "caFile": "/run/llm-machines/edge/ca.crt",
    "certificateFile": "/run/llm-machines/edge/edge.crt",
    "privateKeyFile": "/run/llm-machines/edge/edge.key"
  }
}
```

All four authorities must be distinct canonical HTTPS DNS origins on port 443.
The edge bind must be one explicit non-loopback RFC1918 address. The Product
continues to bind every native service to loopback; only the Product edge also
listens on the declared private address. The fixed edge port lets the upstream
gateway be configured before startup without a broad port rule. The gateway
must route every canonical authority to this exact candidate edge before
`start` is run. Startup compares the public identity JWKS with the disposable
candidate Keycloak and fails before submitting a browser credential if the
gateway still targets an older environment.

The edge certificate must cover all four authority hostnames, chain to the
declared CA, match the declared private key, and be currently valid. The key
must be owner-readable with no group or other permission; the CA and
certificate must not be group- or world-writable. These runtime files are
generated and held outside Git. Install only the CA certificate on the
upstream gateway and require upstream certificate verification. Never copy the
edge private key to the gateway.

In placed mode the integrated browser proof uses normal DNS and the upstream
gateway on port 443. It does not add host-resolver overrides or ignore TLS
errors. The placement is rejected outside keep-running founder mode.

## Reversible loopback-only founder workstation access

This tunnel procedure applies only when no placement document is supplied. A
placed Core uses its approved upstream gateway and canonical authorities; it
must not use an SSH tunnel as Product topology.

Use the private VM address and edge port reported out of band. Keep the SSH
tunnel in its own terminal:

```sh
ssh -N -L <edge-port>:127.0.0.1:<edge-port> dberisha@<uat-vm-private-address>
```

Temporarily add these four entries to the workstation hosts file, each mapped
to `127.0.0.1`:

```text
console.llmm.test
api.llmm.test
identity.llmm.test
firecrawl.llmm.test
```

Copy the generated CA certificate path reported by `status` over authenticated
SSH. On macOS, add it only to the current user's login keychain, record its
SHA-256 fingerprint, and remove that exact certificate after founder UAT:

```sh
security add-trusted-cert -r trustRoot -k "$HOME/Library/Keychains/login.keychain-db" <temporary-ca-file>
security find-certificate -a -Z -c "LLM Machines F0-S1 Local CA" "$HOME/Library/Keychains/login.keychain-db"
security delete-certificate -Z <recorded-sha1-fingerprint> "$HOME/Library/Keychains/login.keychain-db"
```

Remove only the four temporary hosts-file entries and the copied CA file after
testing. The Product source never contains a customer domain, registry, VM
address, or credential.

## Failure boundary

If startup fails before `READY`, inspect the restricted supervisor error log
named by the fixed state root. Do not run broad Docker cleanup. If `stop` cannot
prove complete package-owned teardown, preserve the state for diagnosis.
Restarting the VM is not an automatic recovery path for this pre-Genesis lane;
the operator must use the status and stop commands before starting a new run.
