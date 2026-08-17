# VM103 source-only deployment contract

`vm103-deployment-contract.json` was authored from protected Product input
`e994a738aff6f1d85afc82a2dc5566c62dca9fd8`, tree
`71208853d15a26b28e028ec8a3c88a54c6d00807`. That identity is the source
package base only and is explicitly not a deployable release identity. A
future release manifest must derive its commit and tree from the exact
checked-out protected integration used for assembly. It is a source contract,
not a deployment record. Product acceptance and runtime qualification remain
false, contract activation remains inactive, and Q0 and Genesis remain
unstarted.

The contract reuses the existing release inventory, release placement,
storage, backup, ingress, clean-room installation, and rollback formats. It
does not introduce a second release lock or store a customer registry
authority. Product-built Web and BFF, the admitted LiteLLM downstream, and the
four reduced Firecrawl outputs remain blocked on exact final Core-lock digests.
They must never fall back to a tag or a historical lab image.

The native-ingress profile's embedded candidate-era status remains historical
because its admitted fingerprint is immutable; F0-N8 is the current protected
source-closure record.

## Outputs not present in this package

This package does not contain a final Core image lock, VM103 Compose payload,
non-secret placement environment, commissioning placement record, release
manifest, release signature, public trust material, verified Core payload,
credential-free mirror exports, or commissioned secret files. The exact
expected output identifiers are recorded under
`releaseBinding.requiredArtifactsNotPresent`. Deployment remains forbidden
while any one is missing. The next source package must generate and validate
them without substituting `e994a738...` for its eventual protected integration
commit and tree.

## Placement

The future Compose project is `llmm-core`. Its immutable release payload lives
below `/opt/llm-machines/core/releases`, current-release selection uses
`/opt/llm-machines/core/current`, configuration and root-only secret files live
below `/etc/llm-machines/core`, and runtime-only files live below
`/run/llm-machines/core`.

The five Docker network names are fixed. Their non-overlapping CIDRs remain
commissioning inputs because a universal source package cannot safely guess a
customer or lab address plan. VM103 publishes only the Product edge on its
private address at TCP 18443. PostgreSQL, Keycloak, LiteLLM, Grafana,
Prometheus, Alertmanager, Firecrawl internals, and SGLang publish no host port.
An occupied path, project name, network name, CIDR, or edge port blocks
installation. Side-by-side listener activation is not allowed.

The system gateway sends the seven retained lab authorities to that single
edge upstream while preserving the exact Host and upstream SNI. The Product
edge owns the route allowlists and service-specific native-session behavior.
The gateway must not route directly to a native container. Closing VPN-side
access to host node exporter TCP 9100 is a separate live security change with
its own gateway or VM102 preimage.

## State, backup, and secrets

The deployment uses the existing ZFS dataset contract. PostgreSQL, approved
Grafana state, and approved Alertmanager state are within the allowlisted
backup boundary. Prometheus time-series data is operational metadata under the
non-backed-up logs dataset. Firecrawl runtime state is ephemeral. The separate
customer-owned restic target is mandatory; a local ZFS snapshot is not a
backup. Bulk model weights and the backup repository do not belong on VM103's
100 GiB local disk.

Every generated value is commissioned into a named root-owned file. The
secret directory is mode `0700`, files are mode `0600`, and container mounts
are read-only. No secret value may enter Git, a normal log, a command line, a
checked-in environment file, or this contract. The one-time Keycloak bootstrap
file is removed after commissioning. Customer recovery material remains
outside the appliance.

## Command contract

The exact command strings are recorded under `lifecycle`. They intentionally
cannot be used until the signed Core lock, credential-free placement record,
VM102 and VM103 rollback points, fresh PBS backups, isolated clean restore,
gateway 9100 correction, commissioned secret files, collision evidence, and
one exact SGLang 0.5.13 internal-test profile all pass.

Installation first verifies and extracts the signed bundle with
`infra/release/clean-room-install.mjs`, then verifies the private-registry
placement with `infra/release/validate-deployment-placement.mjs`, and only then
runs the fixed `llmm-core` Compose project. `status` and `stop` address that
exact project without deleting data. First-cutover rollback stops the new
project and restores the separately approved VM102 and VM103 preimage and PBS
record. It never fabricates a prior Product release or deletes unidentified
volumes.

Validate this package without contacting VM103 or another live service:

```sh
node infra/deployment/validate-vm103-deployment-contract.mjs
node --test scripts/inference-core/vm103-deployment-contract.test.mjs
```

## Deliberately separate work

- Gateway security: preserve the gateway configuration or VM102 preimage,
  close VPN-side node exporter TCP 9100, verify Prometheus-only reachability,
  and keep the change separately reversible.
- Rollback establishment: create VM102 and VM103 rollback points, take fresh
  PBS backups, preserve PostgreSQL, founder state, current source,
  unidentified volumes, and both VM disks, then prove an isolated restore.
- Inference preparation: admit one exact SGLang 0.5.13 internal-test delivery
  profile. Existing inference images and models may not be deleted, and the
  profile makes no production-capacity claim.

None of these gates is started or satisfied by this source package.
