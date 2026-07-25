# Agentic Adapter

Small authenticated service intended to run on the dedicated agentic VM.

The BFF calls this service instead of SSHing into the VM. The adapter owns local
OpenShell/NemoClaw command execution and returns explicit rollback metadata.

Endpoints:

- `GET /healthz` / `GET /livez`
- `GET /v1/diagnostics`
- `POST /v1/egress/approvals`
- `POST /v1/egress/revocations`

By default it runs in preview mode. Set `AGENTIC_ADAPTER_APPLY=true` only on the
agentic VM after operator review.

Required env:

```bash
HOST=192.0.2.143
PORT=4010
AGENTIC_ADAPTER_TOKEN=<shared BFF-to-adapter bearer token>
AGENTIC_APPROVAL_SIGNING_SECRET=<shared HMAC secret for BFF-signed approval envelopes>
AGENTIC_ADAPTER_APPLY=false
AGENTIC_OPENCLAW_OPENSHELL_GATEWAY=openclaw-gateway
AGENTIC_HERMES_OPENSHELL_GATEWAY=hermes-gateway
```

The adapter selects the OpenShell gateway from the requested profile. Preview
mode executes `openshell ... policy update ... --dry-run` without `--wait`,
because OpenShell rejects `--wait` when no policy is applied.

Approval requests require `X-LLM-Machines-Approval-Envelope`. Revocation
requests require `X-LLM-Machines-Revocation-Envelope`. Both envelopes are
signed by the BFF with `AGENTIC_APPROVAL_SIGNING_SECRET`.
