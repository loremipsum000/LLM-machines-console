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

The founder Web and BFF images are built from their dedicated Dockerfiles with
the exact protected commit and tree as OCI labels. The BFF image deliberately
retains the already-qualified pre-Genesis fixture boundary; it is not a
substitute for the later release image. Runtime secrets are copied from the
existing protected founder environment only by
`capture-vm103-founder-custody.mjs`, into root-owned mode `0600` files. The
script prints only the generated filenames and never their values.

The deployment remains side by side until all three candidate containers are
healthy. The gateway continues using the previous protected edge until an
explicit health-gated upstream change. Rollback restores that previous
upstream, stops the exact `llmm-founder-candidate` Compose project without
deleting state, and removes only the source-restricted inference route units.

Operator sequence:

1. Render and validate placement from the exact candidate commit.
2. Build Web and BFF with exact source labels and record local image digests.
3. Capture custody from the current protected BFF into a new root-only path.
4. Install and start the gateway and inference route units before SGLang.
5. Start the side-by-side VM103 candidate with `docker compose up --wait`.
6. Prove model admission, identity, native-session, no-bypass, and retention
   gates privately.
7. Switch the gateway only after every private health gate passes.

Status, restart, stop, and rollback remain exact-project operations:

```sh
systemctl status llmm-founder-candidate.service
systemctl reload llmm-founder-candidate.service
systemctl stop llmm-founder-candidate.service
docker compose --project-name llmm-founder-candidate --file <compose> stop
```

Stopping does not delete containers, images, volumes, databases, source,
snapshots, backups, or legacy definitions.
