# Product edge source reference

R1-E1 defines the mandatory source-only Product edge for the reduced
inference appliance. It is not a deployment manifest and does not qualify a
running listener.

The edge has exactly two public host identities on TCP 443:

- the Console host for the primary customer UI, Console session endpoints,
  `GET /v1/models`, `POST /v1/chat/completions`, `POST /v2/search`, and
  `POST /v2/scrape`;
- the identity host for the minimum normal Keycloak OIDC browser and BFF
  dependencies.

Only fixed `console-web`, `console-bff`, and Keycloak identity upstreams occur
in the template. LiteLLM is reached only behind the BFF. Grafana, Keycloak
Admin, Prometheus, Alertmanager, Portainer, and native Firecrawl have no host,
route, redirect, or direct upstream in R1-E1. Optional Grafana work is a later
package and cannot weaken this core edge.

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
