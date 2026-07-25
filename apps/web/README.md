# Web App

Surface for `/`, `/admin`, and `/builder`.

## Hub BFF Data

The Hub reads through `src/lib/hub/server-data.ts`, which is server-only.
Browser EventSource clients subscribe to the same-origin
`/api/hub/events` route; that route proxies BFF SSE server-side when configured.

For local Hub/Builder UI work, `CONSOLE_WEB_FIXTURE_MODE=true` can still let
non-Console server loaders and Hub browser proxy routes use typed fixtures when
no BFF request can be built. Production Console routes such as `/knowledge`,
`/applications`, `/inference`, `/hardware`, `/team`, and `/settings` ignore that
fixture fallback and fail closed unless the BFF request can be built. To call the
BFF from the server runtime, configure Auth.js with Keycloak and set:

- `AUTH_SECRET`
- `AUTH_KEYCLOAK_ID`
- `AUTH_KEYCLOAK_SECRET`
- `AUTH_KEYCLOAK_ISSUER`
- `CONSOLE_BFF_URL`
- `CONSOLE_BFF_SERVICE_API_KEY`

For the lab realm, `AUTH_KEYCLOAK_ID` should use the `console-web` client seeded
by `infra/keycloak/seed-lab-realm.sh`; its callback is
`/api/auth/callback/keycloak`.

The Hub forwards the authenticated session subject, email, realm roles, and
Keycloak access token to the BFF from server-only code. If the BFF is configured
but no Auth.js session is available, or the BFF returns an error, the page fails
closed instead of returning fixtures.

Do not expose `CONSOLE_BFF_SERVICE_API_KEY` through a `NEXT_PUBLIC_*` variable.
The browser must never call the BFF with the trusted service key.

## External Surfaces

The Hub links to LibreChat directly through `LIBRECHAT_PUBLIC_URL`; mirrored
recent chat rows point at LibreChat `/c/<conversation-id>` routes. The internal
`/chat` route is only a compatibility redirect and should not render an iframe.

Admin role handoff pages still render upstream tools through
`src/lib/auth/sso-bridge.ts`. Configure iframe sources with:

- `GRAFANA_EMBED_URL`
- `KEYCLOAK_ADMIN_EMBED_URL`
- `LITELLM_EMBED_URL`

Public external links and iframe fallback links use:

- `LIBRECHAT_PUBLIC_URL`
- `GRAFANA_PUBLIC_URL`
- `KEYCLOAK_ADMIN_PUBLIC_URL` for the admin-console drilldown, or
  `KEYCLOAK_PUBLIC_URL` as the base used to derive it
- `LITELLM_PUBLIC_URL`

If an embed URL is absent but a public route exists, the route renders a compact
external-route card. It only renders `Not configured` when neither an embed nor
fallback route is available.
