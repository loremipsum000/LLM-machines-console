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

Console uses separate Keycloak service credentials for human identity
administration and Application OAuth client administration. The human service
client is `console-human-admin` in the `llm-machines` human realm. The
Application service client is `console-application-admin` in the
`llm-machines-applications` Application realm, configured through
`KEYCLOAK_APPLICATION_ADMIN_CLIENT_ID` and
`KEYCLOAK_APPLICATION_ADMIN_CLIENT_SECRET`. The two services use separate
credentials with no fallback between them. Application clients inherit the
Application realm's 300-second access-token lifetime. The
`console-application-admin` service client has an exact 60-second client
override.

Application-gateway requests use static credentials issued per connected
application. PR-06 also provides OAuth client creation, rotation, revocation,
and reconciliation. OAuth access-token validation, runtime limit enforcement,
and inference data-plane qualification remain PR-07 work. Deterministic
packaging and commissioning of the two-realm Keycloak configuration remain
PR-12 work. PR-06 records the governance choice but performs no runtime OAuth
activation and does not qualify the topology.

The Admin Inference projection reads LiteLLM with the separate
`ADMIN_LITELLM_BASE_URL` and `ADMIN_LITELLM_API_KEY` configuration. It does not
reuse or fall back to the `LITELLM_KEY` data-plane credential.

## Retention boundary

The BFF does not retain prompts, responses, chat history, or tool arguments.
Audit records retain only the metadata needed to attribute and operate
application requests.

PostgreSQL coordinates metadata-only idempotency and usage accounting across
BFF instances. Application limit values remain optional and disabled by
default. PR-06 does not qualify their runtime enforcement. A non-null seven-day
token limit currently fails closed with HTTP 503; total-token admission,
streaming reconciliation, and runtime-limit qualification remain PR-07 work.
With the token limit disabled, the BFF records only known upstream usage totals.
