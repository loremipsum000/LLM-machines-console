# Firecrawl application profile

This directory defines the reduced Firecrawl application boundary for the LLM
Machines appliance. It is an installed, default-off Compose profile for only
synchronous web search and static scrape requests. It is not a general
Firecrawl administration surface.

## Fixed product boundary

- The Console controls whether the `firecrawl` profile is enabled. Installation
  alone starts no service.
- A separately issued Firecrawl application credential is required at the BFF.
  Firecrawl's native API is private and has no host-published port.
- The BFF may expose only the governed search and scrape routes. Every other
  upstream route is outside the product boundary.
- PostgreSQL, NuQ, RabbitMQ, reranking, asynchronous jobs, persistent caches,
  and BFF coordination Redis are deliberately absent.
- The release target prohibits request and response bodies from files,
  container logs, proxy logs, queues, databases, and persistent volumes.
  This source profile supplies only tmpfs writable paths, but native
  application-sink verification remains a PR-12 qualification gate below.
- Compose CPU, memory, and concurrency values are tunable appliance-protection
  defaults, not commercial usage quotas. The hardware owner may raise them while
  preserving control-plane headroom. Customer policy limits remain optional and
  are managed elsewhere.

All runtime images must be preloaded from the appliance's private Harbor and
referenced by an exact `sha256` digest. `pull_policy: never` prevents runtime
fallback to a public registry. No secret or credential value belongs in this
directory.

## Network and egress boundary

The API, browser, and search containers have only internal Docker networks.
The egress proxy is the sole container attached to the non-internal `egress`
network. Its policy:

1. allows only ports 80 and 443;
2. denies private, loopback, link-local, documentation, multicast, reserved,
   and all IPv6 destinations after DNS resolution;
3. explicitly denies the hosted Firecrawl API;
4. permits only exact hostnames from a system-managed allowlist; and
5. disables request logs and caching.

The checked-in allowlist is a deny-all sentinel. The control plane must render
a separate `allowed-hosts.txt` inside a volatile directory below
`/run/llm-machines/firecrawl/` from the system-owned configured host set. It
must validate every exact hostname, resolve all A and AAAA answers as public,
replace the file atomically inside the mounted directory, and reload the proxy
on configuration changes. The rendered file contains configured permissions,
never request-derived history, and is bounded to 256 entries. Wildcards, domain
suffixes, URL strings, ports, IP literals, and private names are invalid. Each
requested or redirected host must already have its own exact admission.

Network attachment is part of the security boundary. Only the four services in
`compose.yaml` and the governed BFF connection may join these networks.

## Qualification gates

This source profile is intentionally not runtime-qualified. Release admission
stops until all of the following are evidenced:

- The reviewed Firecrawl v2.11.0 source patches build and the reduced entrypoint
  boots and serves synchronous search and scrape without the omitted queue and
  database services. A build or startup failure must lead to a Firecrawl-owned
  successor, not silent dependency growth.
- Tests prove the BFF exposes only search and scrape, enforces the dedicated
  application credential, and performs no transparent hosted-service fallback.
- The system allowlist controller passes public-address and DNS-rebinding tests,
  including configured-set/rendered-file parity, atomic reload, redirects, and
  mixed public/private DNS answers.
- Retention canaries prove that request bodies and scraped content do not enter
  files, volumes, logs, caches, traces, metrics, or queues. The reviewed patch
  forces self-hosted zero-data-retention, removes search-query logger metadata
  and the controller-level scrape URL span attribute, and the reduced entrypoint
  does not initialize a telemetry exporter. Source inspection is not runtime
  evidence, so Q0 must still prove every active sink remains content-free.
- Resource, concurrency, timeout, cancellation, failure, and disable/re-enable
  tests pass on the supported appliance floor. The candidate defaults are only
  starting values; release tests must qualify an admin-tunable range that can
  use customer-owned compute without starving the control plane.
- PR-12 admits exact signed private-registry images, SBOMs, vulnerability review,
  license texts, notices, and the complete corresponding source for every
  distributed modified AGPL component.

`validate-profile.mjs` is a source-policy check. It does not close any runtime
or release-admission gate.

## Release source package

`release/source-package.json` binds the exact upstream sources, ordered reduced
patches, byte locks, build inputs, licenses, and required release outputs. It is
credential-free and remains runtime-unqualified. It deliberately excludes all
historical queue and persistence patches.

The corresponding-source assembler performs no network access. Supply the four
archives under the exact filenames declared in the manifest, then run:

```sh
node infra/firecrawl/release/assemble-source-packet.mjs \
  --source-dir /controlled/source-inputs \
  --output-dir /controlled/firecrawl-corresponding-source
```

The output contains the original archives, the fully patched Firecrawl source,
the ordered patches, build locks, Product profile, notices, and sorted SHA-256
inventory. Image build, scanning, provenance, signing, and runtime qualification
remain separate release gates.

## Static validation

Run the validator directly with Node:

```sh
node infra/firecrawl/validate-profile.mjs
node --test infra/firecrawl/validate-profile.test.mjs
node infra/firecrawl/release/validate-source-package.mjs
node --test infra/firecrawl/release/validate-source-package.test.mjs
```

To review a generated runtime allowlist, pass `--allowlist PATH --require-hosts`.
To review an installer-generated environment file without printing its values,
pass `--env PATH --registry HARBOR_DNS_AUTHORITY`. The trusted registry
authority must be an exact DNS hostname, optionally with one numeric port, and
must contain the exact `firecrawl/api`, `firecrawl/browser`,
`firecrawl/search`, and `firecrawl/egress` repositories with SHA-256-only image
references. Schemes, paths, credentials, IP literals, wildcards, and trailing
separators are invalid.
