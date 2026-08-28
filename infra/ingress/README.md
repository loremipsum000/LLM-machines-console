# Product edge source reference

F0-E0 is the immutable four-authority core of the source-only Product edge for
the reduced inference appliance. It succeeds the historical R1-E1
two-authority topology without rewriting that evidence. F0-N5 adds a separate,
prospective three-service native-administration profile. Neither package is a
deployment manifest or qualifies a running listener.

The Core edge has four primary Product host identities on TCP 443:

- the Console host for the primary customer UI and Console session endpoints;
- the API host for `GET /v1/models` and `POST /v1/chat/completions`;
- the Firecrawl host for governed `POST /v2/search` and `POST /v2/scrape`;
- the identity host for the minimum normal Keycloak OIDC browser and BFF
  dependencies, plus the Application realm token and JWKS endpoints.

The F0-E0 base uses only fixed `console-web`, `console-bff`, and Keycloak
identity upstreams. F0-N5 adds fixed `grafana_native` and `litellm_native`
upstreams plus a distinct Keycloak Admin authority. Prometheus, Alertmanager,
Portainer, PostgreSQL, SGLang, and native Firecrawl still have no customer
authority or upstream. The F0-E0 Console, API, identity, and Firecrawl routes
remain unchanged.

`product-edge.nginx.conf.template` is rendered by deterministic release
packaging later. The hostname placeholders are configuration, and the TLS
paths are root-only mounted files. No certificate, private key, client secret,
session key, application credential, or environment value belongs in this
directory.

The checked-in validators prove only deterministic source properties:

- rejecting default TLS and exact Host/SNI policy;
- exact route, method, query-presence, and fixed-upstream selection;
- raw-path rejection before routing;
- default-drop request headers with explicit surface profiles;
- no WebSocket upgrade, request or response buffering, proxy cache, target or
  query logging, or workload-content logging;
- no route, hostname, query-key, or upstream outside the exact F0-E0 and F0-N5
  inventories.

The Application-realm token route alone requires a canonical HTTP Basic envelope
with the case-sensitive encoded `llmm-app-` namespace and expected identifier
length, followed by a colon separator and nonempty secret. This is an edge
routing filter, not credential authentication: Keycloak remains solely
responsible for validating the exact client ID and secret. Form-only client
authentication is rejected.
Human-realm token routes and browser identity routes continue to strip
Authorization. The normal Keycloak logout route and its exact
`logout/logout-confirm` child retain cookies, redirects, query parameters, and
form submission while every other logout child remains denied. Every Nginx
location on every public authority is exact-allowlisted, so an additional
location fails source validation even when it points to an otherwise retained
upstream.

The Console session and Keycloak identity flows keep their own cookies,
redirects, CSRF and Origin checks. The edge does not suppress `Set-Cookie` or
`Location` on those retained flows, does not forward the Console browser
session to Keycloak, and does not turn an edge cookie into a native service
credential.

`no-bypass-policy.json` and the source harness retain direct network,
firewall, DNS, certificate, and packaged Nginx behavior as
`NOT_EVALUATED_RUNTIME`. Q0 must prove those properties from every customer
network before a release may claim no bypass. Source tests never substitute
for that runtime evidence.

## F0-N5R native-administration overlay

`native-admin-edge-profile.json` and the three native browser-header includes
prospectively correct the F0-N5 source-only profiles for Grafana 13.1.3, the LiteLLM OSS-only
`v1.96.2-llmm.1` downstream, and Keycloak 26.7.0 appliance-realm
administration. Each service uses a dedicated hostname and its own supported
Keycloak OIDC session. Console session cookies and tokens are rejected rather
than forwarded. Product Application credentials are also rejected on every
native authority.

Grafana admits Admin as Editor only; Operator and other roles are denied by
Grafana and server-administrator authority is disabled. LiteLLM admits Admin as
`proxy_admin` and Operator as `internal_user`; its characterized native policy
limits Operator to the Operator's virtual keys and spend. Keycloak admits Admin
only under the `llm-machines` realm. Keycloak 26.7.0 runs at root internally
with `hostname` bound to the identity authority and `hostname-admin` bound to
the dedicated admin authority plus `/keycloak`. Only the exact allowlisted
admin locations strip that external prefix before proxying; normal OIDC,
login-action, cookie, and logout traffic stays on the identity authority. The
Product edge returns `403` for exact
user DELETE requests before they reach Keycloak, compensating for the narrowest
supported upstream Users `manage` authority. Master and unrelated realms,
unlisted routes, alternate hosts, mismatched Host/SNI, unsafe paths, spoofed
forwarding headers, WebSocket upgrades, and direct native ports fail closed.

Native `Cookie`, `Set-Cookie`, `Location`, `Origin`, `Referer`, PKCE callback,
CSRF, static-asset, logout, and required REST behavior is preserved only on the
reviewed route and query-key inventory. LiteLLM's advanced native inference
path may stream using SSE; no native surface requires WebSocket forwarding.
Metadata-only ingress logging does not record paths, queries, headers, cookies,
or bodies.

The pinned LiteLLM UI reads its service-local `token` cookie from JavaScript.
The Product edge therefore cannot add `HttpOnly` without breaking the supported
native UI. It forces that cookie to `Secure` and `SameSite=Lax` on the dedicated
LiteLLM authority. The `litellm_cp_return_to`, `litellm_oauth_state`, and
`sso_state` cookies are forced to `Secure`, `HttpOnly`, and `SameSite=Lax`.
This limitation does not permit Console material, Product credentials, shared
human credentials, or the LiteLLM master secret to become browser credentials.
An unexpected LiteLLM cookie blocks F0-N7 rather than being admitted implicitly.

The profile remains `INACTIVE_PENDING_F0_N7`. F0-N5R is a prospective source
correction and bounded disposable path proof only;
F0-N7 must replay HTTPS browser roles, logout, outage, restart, retention, and
no-bypass behavior before activation. Portainer remains
`DEFERRED_UPSTREAM_SECURITY` and has no authority, upstream, route, image,
startup definition, or navigation entry.

Production service authorities use a customer-owned domain. Connected
commissioning uses provider-neutral, narrowly scoped DNS-01 or a delegated
challenge zone; disconnected commissioning uses a customer-owned private CA.
DNS providers, customer authorities, and credentials remain commissioning
inputs and are never Product source constants. The current lab wildcard
certificate evidence carried from F0-N3 expires on 2026-11-12 and replaces the
stale pre-renewal status without changing live DNS or TLS in F0-N5.
