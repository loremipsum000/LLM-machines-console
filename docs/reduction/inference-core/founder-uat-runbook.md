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

## Reversible founder workstation access

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
