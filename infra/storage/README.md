# Storage and backup source contract

This directory defines the source-only R1-D1 storage, backup, retention, and
recovery boundary. Its runtime status is `NOT_EVALUATED_RUNTIME`.

The supported appliance requires ZFS-backed local storage with five distinct
dataset roles and mountpoints: `product_state`, `databases`, `models`, `logs`,
and `staging`. Local snapshots may support short operational rollback, but
they never count as backups.

The v1 backup engine is restic. It writes encrypted, versioned snapshots once
per day by default, retains them for 30 days, and targets a separate
customer-owned mounted filesystem. The repository locator and password are
provided through separate root-only mounted files. They are never inline,
stored in this contract, or accepted from environment variables. The customer
holds the recovery material.

Backup input is an explicit safe-state allowlist. Models remain excluded until
a separate model-recovery decision exists. Logs, staging, caches, temporary
files, crash artifacts, one-time plaintext credentials, every private signing
key, and the audit recovery envelope are excluded. A successful restore into
a clean appliance remains a Q0 release gate.

The deterministic canary function is source evidence only. It rejects
synthetic workload-content markers in the restic input manifest, cache,
temporary files, staging, backup logs, and restored tree. Q0 must repeat the
canary check against the packaged runtime and retain metadata-only results.

No generic S3 service, MinIO service, SeaweedFS service, or unused
object-store adapter belongs in the Inference Core bill of materials. A future
retained caller must first prove a concrete need and use an S3-compatible
interface before SeaweedFS can be benchmarked.

The validator only reads files in this directory. It does not invoke ZFS or
restic, create or alter a pool, dataset, mount, repository, backup, or restore,
access a network, or bind a secret.

```sh
node infra/storage/validate-profile.mjs
node --test infra/storage/validate-profile.test.mjs
```
