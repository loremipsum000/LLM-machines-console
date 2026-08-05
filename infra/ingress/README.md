# Product edge source reference

F0-E0 is the current source-only Product edge for the reduced inference
appliance. It succeeds the historical R1-E1 two-authority topology without
rewriting that evidence. It is not a deployment manifest and does not qualify
a running listener.

The edge has exactly four public host identities on TCP 443:

- the Console host for the primary customer UI and Console session endpoints;
- the API host for `GET /v1/models` and `POST /v1/chat/completions`;
- the Firecrawl host for governed `POST /v2/search` and `POST /v2/scrape`;
- the identity host for the minimum normal Keycloak OIDC browser and BFF
  dependencies, plus the Application realm token and JWKS endpoints.

Only fixed `console-web`, `console-bff`, and Keycloak identity upstreams occur
in the template. LiteLLM is reached only behind the BFF. Grafana, Keycloak
Admin, Prometheus, Alertmanager, Portainer, PostgreSQL, SGLang, and native
Firecrawl have no host, route, redirect, or direct upstream in F0-E0. Optional
Grafana work is a later package and cannot weaken this core edge.

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
- no native administration route or listener declaration.

The Application-realm token route alone requires a canonical HTTP Basic value
that decodes to the Product Application client namespace and a nonempty secret.
An internal BFF authorization subrequest performs that content check without
retaining or returning the credential. Form-only client authentication is
rejected.
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
