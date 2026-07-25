# BFF

Fastify backend-for-frontend for persona-aware routes, SSE streaming, audit emission, and orchestration between the web app, sidecar, and data plane.

## OpenAI-compatible LibreChat Gateway

LibreChat should point at the BFF as a custom OpenAI-compatible provider:

- `GET /v1/models`
- `POST /v1/chat/completions`

Auth is two-layered:

- LibreChat authenticates as a trusted caller with `Authorization: Bearer ${BFF_SERVICE_API_KEY}`.
- LibreChat forwards per-user identity with `x-llm-machines-keycloak-token: {{LIBRECHAT_OPENID_ACCESS_TOKEN}}`. The BFF validates that Keycloak token and maps `realm_access.roles` to `consumer`, `builder`, or `admin`.

During lab bootstrap, the BFF can fall back to `x-llm-machines-user-*` headers for user attribution when LibreChat OIDC is not configured yet. Production should make the forwarded Keycloak token mandatory.

## Slash-command Middleware

The `/v1/chat/completions` route intercepts Hub slash invocations before LiteLLM pass-through:

- `@summary-agent ...` resolves against the caller-visible Hub resource catalog, enforces runnable state, emits `hub.agent.invoke`, and returns an OpenAI-compatible response.
- If `AGENTIC_OPENCLAW_BASE_URL` is configured, `@summary-agent` runs through OpenClaw with `AGENTIC_OPENCLAW_TOKEN` when present. The chat-completions path defaults to `/v1/chat/completions` and can be overridden with `AGENTIC_OPENCLAW_CHAT_COMPLETIONS_PATH`; configured runtime failures fail closed with `hub.agent.invoke_failed` instead of silently falling back.
- Streaming slash invocations request OpenClaw streaming, relay OpenAI-shaped content chunks through the BFF encoder, then persist the accumulated response as Hub task/artifact output.
- If no OpenClaw runtime URL is configured, the route keeps a deterministic local response only when `BFF_FIXTURE_MODE=true` or under tests. Outside fixture mode, slash invocations fail closed instead of pretending the agent ran.
- Successful agent invocations create a completed Hub task session plus a markdown artifact for the invoking actor, then publish Hub live events for the updated task and created artifact.
- Unknown or hidden agents fail closed and emit `hub.agent.invoke_denied`.
- Workflow slash commands are reserved but return a problem-details response until the workflow runtime is selected.

Plain chat messages still pass through to LiteLLM when `LITELLM_URL` and `LITELLM_KEY` are configured.

## Hub Recent Chat Mirror

LibreChat forwards conversation metadata to the BFF with:

- `x-librechat-thread-id: {{LIBRECHAT_BODY_CONVERSATIONID}}`
- `x-librechat-message-id: {{LIBRECHAT_BODY_MESSAGEID}}`

When `DATABASE_URL` is configured, the BFF stores actor-scoped rows in `hub.chat_threads` and the Hub home/search surfaces those rows as recent chats. No-DB fixture mode falls back to deterministic sample threads only when `BFF_FIXTURE_MODE=true` or under tests.

Optional historical title backfill is enabled only when `LIBRECHAT_MONGO_URL` is configured. The BFF maps the current actor to LibreChat by Keycloak `openidId` or email, imports only the latest three titled conversations from the configured `LIBRECHAT_MONGO_DB` (default `LibreChat`), and stores only conversation ID/title metadata. It does not import LibreChat message bodies.

## MCP Catalog Bundles

The BFF uses the repo-owned catalog seed in dev/fixture mode. Production should import an appliance-local signed catalog bundle by setting both:

- `MCP_CATALOG_BUNDLE_PATH` — path to the local JSON bundle.
- `MCP_CATALOG_PUBLIC_KEY_PEM` — Ed25519 public key PEM used to verify the bundle.

Bundles are verified before use and fail closed if the signature or required policy metadata is invalid. The BFF does not fetch public marketplace catalogs at runtime.

In `NODE_ENV=production`, missing `MCP_CATALOG_BUNDLE_PATH` fails closed unless `MCP_CATALOG_ALLOW_SEED=true` or `BFF_FIXTURE_MODE=true` is set explicitly. The lab compose file sets the seed override while the signed catalog packaging path is still being finalized; customer deployments should prefer a signed bundle.

## Fixture Mode

`BFF_FIXTURE_MODE=true` enables deterministic no-database/no-runtime fallbacks for local UI work: starter Hub chats, static task/artifact rows, static model list fallback, OpenClaw local agent responses, and Agent Studio local preview. Keep it disabled for configured lab or production validation unless the purpose of the run is explicitly fixture testing.

## Hub Live Events

Hub SSE uses in-process fanout for local fixture mode. Set `REDIS_URL` in multi-process or multi-replica environments so Hub live events publish through Redis as well. `HUB_EVENT_CHANNEL` can override the default `hub:events` channel name.

Notification read state remains stored through the Hub data layer; Redis fanout is only for live delivery to active SSE subscribers.
