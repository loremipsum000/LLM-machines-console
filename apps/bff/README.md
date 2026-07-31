# BFF

Fastify backend-for-frontend for the LLM Machines inference-core Console.

## Retained surfaces

- Health endpoints for service and dependency checks.
- Admin control-plane routes under `/api/admin`.
- Connected-application inference gateway:
  - `GET /api/app-gateway/v1/models`
  - `POST /api/app-gateway/v1/chat/completions`

The application gateway passes streaming and non-streaming Chat Completions to
LiteLLM. Tool definitions and tool-call messages are transported as protocol
data; the BFF does not execute tools.

## Authentication

Admin routes validate Keycloak bearer tokens or trusted service-forwarded
tokens. Header-only service identity is retained for local and test
compatibility and is disabled by default outside tests.

Application-gateway requests use credentials issued per connected application.
Static credentials and short-lived OAuth access tokens share the same
application policy, rate-limit, model-allowlist, and audit boundary.

## Retention boundary

The BFF does not retain prompts, responses, chat history, or tool arguments.
Audit records retain only the metadata needed to attribute and operate
application requests.

Redis remains a compatibility dependency for idempotency and rate limiting.
