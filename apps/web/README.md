# Web App

The customer Console is a focused control-plane UI with these retained surfaces:

- `/` (Overview)
- `/activity`
- `/applications`
- `/inference`
- `/hardware`
- `/team`
- `/settings`

Routes outside this retained set bypass authentication middleware so Next.js
can return its normal `404` response.

## BFF and authentication

The browser holds only the host-only `__Host-llm-machines-session` opaque
session cookie. It is `Secure`, `HttpOnly`, `SameSite=Lax`, scoped to `/`, and
has no `Domain`. Middleware validates the handle through the private BFF
`/api/internal/console-session/resolve` route before serving a retained Console
page and slides the browser cookie for 1,800 seconds after an active result. The
BFF continues to enforce the session's idle and absolute limits.

All appliance data requests are made server-side through
`src/lib/bff/server-request.ts`. The Web service requires only:

- `CONSOLE_BFF_URL`
- `CONSOLE_BFF_SERVICE_API_KEY`
- `WEB_IDENTITY_ORIGIN` as the exact HTTPS Identity authority allowed for the
  native high-risk elevation form redirect

`CONSOLE_BFF_SERVICE_API_KEY` is a server-only credential. Never expose it
through a `NEXT_PUBLIC_*` variable or send it to the browser. Web-to-BFF
requests carry service authentication and the opaque session handle only. They
must not forward Keycloak access or refresh tokens, user identity headers, or
roles supplied by the browser.

The product edge owns the browser session routes:

- `GET /api/console/session/login?returnTo=<path-only>`
- `GET /api/console/session/callback`
- `POST /api/console/session/logout`
- `POST /api/console/session/elevate` with a bound high-risk `action` and a
  path-only `returnTo`

Terminal session results clear the exact opaque cookie and redirect once to
`/auth/signin?session=expired&returnTo=<path-only>`. Retryable identity outages
preserve the cookie and render `/auth/unavailable` with HTTP 503 so a temporary
Keycloak or BFF failure cannot create a sign-in loop. Auth.js and browser-owned
JWT refresh state are not part of the Console session boundary.
