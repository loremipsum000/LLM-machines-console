# VM103 pre-Genesis founder candidate

This package runs the exact protected Product source as a reversible lab
candidate. It is not a release artifact, Product acceptance, runtime
qualification, contract activation, Genesis, or production-capacity evidence.
Portainer is not admitted.

`render-vm103-founder-candidate.mjs` accepts a credential-free placement file
and renders the exact Product edge, non-secret Web/BFF configuration, VM103
Compose supervision unit, source-restricted gateway-to-edge firewall, and
source-restricted VM103-to-SGLang route units.
The renderer rejects mutable images, public network inputs, duplicate ports,
unsafe paths, incomplete authorities, and missing commit or tree bindings.

The edge firewall manager verifies the existing `inet llmm_filter/input` base
chain has the admitted input hook, priority `-10`, and default-drop policy. It
rejects any pre-existing rule that mentions the candidate port, then inserts
one comment-owned allow for the exact gateway source and removes only that
exact rule handle during rollback. It never flushes or rewrites unrelated
firewall state.

The founder Web and BFF images are built from their dedicated Dockerfiles with
`--build-arg LLMM_SOURCE_COMMIT=<commit>` and
`--build-arg LLMM_SOURCE_TREE=<tree>`. Their OCI labels and local image IDs are
verified against the rendered `image-bindings.json` before Compose can start.
The BFF runs the production
session and PostgreSQL authority while still consuming only an explicitly
admitted internal-test inference profile; it is not a substitute for the later
release image. Runtime secrets are copied into root-owned mode `0600` files by
`capture-vm103-founder-custody.mjs`. BFF, database, Console OIDC, and human
Keycloak administration material comes from the protected BFF process. The
dedicated Application-realm administration secret comes from the commissioned
Keycloak control file and is verified before candidate startup. The LiteLLM key
comes separately from the exact active LiteLLM process, so an older BFF cannot
silently supply a stale master key. Custody capture also requires the exact
`litellm-native` client ID and rejects a LiteLLM OIDC secret that differs from
the commissioned Keycloak client. The script prints only generated filenames
and never their values.

The BFF's `non-restorable-isolation/` directory is a root-owned mode `0700`
configuration-root child outside PostgreSQL and every Console component
restore set. VM rollback and host backup preserve it, but a Console restore
must never overwrite it. Missing, malformed, or unavailable marker authority
keeps inference and Firecrawl admissions sealed.

The deployment remains side by side until all three candidate containers are
healthy. The gateway continues using the previous protected edge until an
explicit health-gated upstream change. Rollback restores that previous
upstream, stops the exact `llmm-founder-candidate` Compose project without
deleting state, and removes only the source-restricted inference route units.

The retained Firecrawl package owns its native containers and private Docker
networks. Before starting the founder BFF, commissioning must provide an exact
retained bridge on `127.0.0.1:3002` to the private `firecrawl-api:3002`
listener. The BFF resolves only that service name to loopback. No Firecrawl
native port or UI becomes customer-accessible.

Hardware projections and alert summaries query the retained Prometheus and
Alertmanager services through the credential-free private VM102 NAT-side
`network.prometheus` placement address declared separately from the lab-side
inference gateway. The renderer requires their exact ports and emits
`ADMIN_PROMETHEUS_BASE_URL` plus `ADMIN_ALERTMANAGER_BASE_URL`; it never uses
the management-side `network.gateway`, and no public observability authority
or customer route is created.

Operator sequence:

1. Render and validate placement from the exact candidate commit.
2. Build Web and BFF with exact source labels and record local image digests.
3. Capture custody from the current protected BFF, exact active LiteLLM
   process, and exact commissioned Keycloak control file into a new root-only
   path.
4. Install and start the gateway and inference route units before SGLang.
5. Start the side-by-side VM103 candidate with `docker compose up --wait`.
6. Prove model admission, identity, native-session, no-bypass, and retention
   gates privately.
7. Switch the gateway only after every private health gate passes.

Status, restart, stop, and rollback remain exact-project operations:

```sh
systemctl status llmm-founder-candidate.service
systemctl restart llmm-founder-candidate.service
systemctl stop llmm-founder-candidate.service
docker compose --project-name llmm-founder-candidate --file <compose> stop
```

Stopping does not delete containers, images, volumes, databases, source,
snapshots, backups, or legacy definitions.
