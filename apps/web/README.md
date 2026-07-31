# Web App

The customer Console is a focused control-plane UI with five retained surfaces:

- `/applications`
- `/inference`
- `/hardware`
- `/team`
- `/settings`

The root route redirects to `/applications`. Routes outside this retained set
bypass authentication middleware so Next.js can return its normal `404`
response.

## BFF and authentication

All appliance data requests are made server-side through
`src/lib/bff/server-request.ts`. Configure Auth.js with Keycloak and the Console
BFF:

- `AUTH_SECRET`
- `AUTH_KEYCLOAK_ID`
- `AUTH_KEYCLOAK_SECRET`
- `AUTH_KEYCLOAK_ISSUER`
- `CONSOLE_BFF_URL`
- `CONSOLE_BFF_SERVICE_API_KEY`

The Keycloak client callback is `/api/auth/callback/keycloak`.

`CONSOLE_BFF_SERVICE_API_KEY` is a server-only credential. Never expose it
through a `NEXT_PUBLIC_*` variable or send it to the browser.

Every retained Console route requires an Auth.js session. Requests fail closed
when the authenticated session or BFF request cannot be established.
