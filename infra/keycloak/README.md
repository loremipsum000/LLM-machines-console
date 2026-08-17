# Inference Core Keycloak seed

This directory defines separate logical seeds and ordered commissioning
contracts for the human appliance realm and the Application realm. The human
identity contract originates in PR-05. PR-06 removes Application client
authority from it and defines that authority in a dedicated realm. PR-09 adds
the human-realm Grafana OIDC client and its role-claim boundary. These files
are not Keycloak realm exports and do not perform an import. PR-12 packaging
must translate the reviewed selectors into the pinned Keycloak release,
resolve realm resource UUIDs, and prove both live permission matrices before
customer use.

## Runtime boundary

The minimum supported release is Keycloak `26.6.0`. The server must enable
`admin-fine-grained-authz:v2`, the appliance realm must set
`adminPermissionsEnabled`, and the resulting `admin-permissions` authorization
resource server must use FGAP v2. Version 26.6.0 is the minimum because its new
Groups `manage-membership-of-members` scope supplies the group-side bridge for
the Users `manage-group-membership` scope. No custom Keycloak provider plugin
is required or permitted by this seed.

## R1-S1 Console session boundary

The FGAP seed keeps Keycloak `26.6.0` as its minimum compatible release. The
Console session package is narrower and pins Q0 qualification and product
packaging to exactly Keycloak `26.7.0`, represented by
`quay.io/keycloak/keycloak:26.7.0@sha256:0f198be292568439d700cdbfb893e69a6009bb43a94a06a945b1d3d506c76b13`.
Q0 may qualify that selected design but may
not substitute another version or create a missing authentication design.

`pr11a-console-session-policy.json` is the source-only R1-S1 contract. The
`console-web` client is confidential, uses Authorization Code with PKCE S256,
and has one runtime-bound callback at `/api/console/session/callback`. Direct
grants, implicit flow, service accounts, browser token-endpoint CORS, offline
tokens, and wildcard callbacks are disabled. The browser receives only the
Product-owned opaque Console cookie. The BFF stores encrypted refresh-token
state and receives backchannel logout at
`/api/internal/console-session/backchannel-logout` through Product ingress.

F0-N3 supersedes the earlier pre-Genesis human sign-in profile with password
authentication, an eight-hour idle session, and a 24-hour maximum session.
TOTP is not mandatory. Role and capability checks remain authoritative for
every Console mutation. Emergency recovery retains its separately controlled
out-of-band factor contract and is not a routine customer sign-in path.

The scoped native Keycloak Admin Console is a distinct Keycloak browser
session. It does not receive the Console cookie or Console tokens and remains
inactive until F0-N5 supplies the exact Product-edge route and no-bypass proof.
Its source contract is `native-admin-profile.json`.

Validate the source contract without contacting a runtime:

```text
node infra/keycloak/validate-pr11a-session-policy.mjs
node --test infra/keycloak/validate-pr11a-session-policy.test.mjs
```

## Grafana OIDC boundary

The human realm contains one credential-free logical client named `grafana`.
It uses only the authorization-code flow with PKCE S256, has no service
account or direct grant, and receives only the `admin` and `operator` realm
roles through an explicit mapper. The exact callback, web origin, and client
secret are bound outside Git during PR-12 packaging. `offline_access` is not a
default or optional scope.

Grafana evaluates `realm_access.roles` with strict role synchronization:
`admin` maps to Grafana Editor while `operator`, mixed-role, and unknown
principals are denied native login. Admin is not mapped to Grafana
organization Admin or server Admin. The Grafana source configuration is under
`infra/observability`; it remains inactive until PR-12 proves the callback,
secret-file mount, OIDC claims, and direct-access boundary.

The human realm is `llm-machines`. The `master` realm is never a customer
administration target. Its only human roles are `admin` and `operator`, mapped
by the `Admins` and `Operators` groups. Customer Admin and the Console
human-admin service account receive only the separately defined
`realm-management` roles required by their own FGAP policies. Customer Admin
receives `query-users` and `query-groups`; these expose native navigation and
search but do not bypass FGAP. The human realm contains no Application admin
client, Application service permission class, Application FGAP policy, or
Clients permission.

## FGAP v2 permissions

The active permissions use Keycloak's actual `Users` and `Groups` resource
types and their supported scopes. Logical `group:*`, `realm-role:*`, and
`service-account:*` selectors are resolved to appliance-realm UUIDs by PR-12.
There is no active `Roles` permission.

Customer Admin native policy:

- `Users`, all resources: `view`, `manage`.
- `Groups`, `Admins` and `Operators`: `view`, `view-members` only.
- No group membership mutation, role mapping, realm management, client
  management, identity-provider management, impersonation, or coarse
  `manage-users` authority.

This is the narrowest Keycloak 26.7.0 FGAP v2 profile that supports user
creation and update, password reset, and session inspection and invalidation.
Keycloak's Users `manage` scope also permits user deletion. The founder-accepted
layered design therefore keeps native ingress inactive until F0-N5 denies the
exact `DELETE /keycloak/admin/realms/llm-machines/users/{uuid}` request at the
Product edge. Keycloak continues to authorize the remaining operation and to
bind its metadata-only admin event to the authenticated Admin subject. The
native UI may still render its delete control; support copy must explain that
the Product edge denies the operation.

The `console-human-admin` service account is separate from all future
Application OAuth-client administration. Its FGAP policy receives:

- `Users`, all resources: `view`, `manage`, and `manage-group-membership`.
- `Groups`, all resources: `view`, `view-members`, `manage`, and
  `manage-membership` as the broad fallback required by retained BFF
  non-system group operations. The resource-specific `Admins` and `Operators`
  permissions intentionally omit `manage`, so FGAP v2 precedence shadows that
  broad scope for those two canonical role-bearing groups.
- `Groups`, `Admins` and `Operators`: `view`, `view-members`,
  `manage-members`, `manage-membership`, and
  `manage-membership-of-members`.
- No `Roles`, `map-role`, or `map-roles` authority. The pre-mapped `Admins` and
  `Operators` groups are the only role-assignment path; the service changes
  group membership instead of mapping roles directly.
- No `Clients`, Organizations, realm configuration, impersonation, or other
  role mapping permissions.

No Users `reset-password` permission is installed for any policy. On Keycloak
26.6, `reset-password` falls back to the effective Users `manage` decision only
when no explicit permission for that scope exists. This preserves password
reset for Admin members through `Admins/manage-members` and for the Console
service through `Users/manage`, while Operator members remain denied. Adding a
service-only `reset-password` permission would cause the customer policy to be
evaluated and denied instead of using the intended fallback.

### Accepted residual risk

FGAP v2 does not separate create from update and delete within the
resource-type-level Users `manage` scope. The Console service account therefore
has broader Keycloak user mutation authority than any individual Console
operation. Groups `manage` is similarly resource-type-wide even though the BFF
requires it for retained non-system group CRUD. PR-05 accepts these unavoidable
residuals only with all of these controls: the service credential is isolated
from customer humans, Console is
the single human-identity writer, every mutation goes through the durable
Console identity journal, and the last-enabled-Operator check runs before every
Operator mutation. PR-12 must evaluate the exact pinned runtime against the
commissioning matrix and prove this operating boundary. PR-05 defines the
logical contract only and makes no deployed-runtime qualification claim.

## Application realm

The dedicated Application realm is exactly `llm-machines-applications`. It has
no human users, groups, customer roles, browser flow, human clients, role
mapping, or authority over the human realm. Its realm access-token lifetime is
300 seconds. The only seeded client is `console-application-admin`, whose
access-token lifetime is overridden to 60 seconds. It enables only the service
account and client-credentials flow.

`console-application-admin` receives only the `query-clients`
`realm-management` role and the FGAP v2 `Clients` scopes `view` and `manage`.
It receives no coarse client or realm management role and no Users, Groups,
Roles, Organizations, role-mapping, refresh-token, or offline-token authority.
FGAP v2 `Clients/manage` is realm-wide, so the dedicated realm is the primary
containment boundary. Console must also enforce the managed client namespace
and journal every mutation.

Managed customer Application clients follow an exact contract:

- Client IDs match `llmm-app-UUID`.
- Only service accounts and the client-credentials flow are enabled.
- Default and optional client scopes are empty and `fullScopeAllowed` is
  `false`.
- The custom audience is exactly `console-bff` through
  `included.custom.audience`.
- Access tokens inherit the 300-second realm default and receive no refresh or
  offline token.

The logical seed contains no managed client instances or credentials. PR-12
creates each managed client and generated secret outside Git, then proves the
contract against the separate Application commissioning matrix.

## Offline access

The seed does not use a synthetic realm `offlineSessionsEnabled` switch because
Keycloak has no such RealmRepresentation field. Instead, `offline_access` is
absent from every retained client's optional client scopes and absent from the
`default-roles-llm-machines` realm-role composite. PR-12 must request
`scope=offline_access` against each token-capable retained client and prove
that the granted scope omits `offline_access` and no offline token is issued.

## Password sign-in and token claims

The bound `llm-machines-browser-password` flow uses the built-in
`auth-username-password-form` execution with AMR reference `pwd`. The
`llm-machines-amr` default client scope uses Keycloak's built-in
`oidc-amr-mapper` and explicitly adds `amr` to regular access tokens. The
repository-owned `llm-machines` login theme is copied into the exact Keycloak
26.7.0 runtime and selected by the appliance realm.

The built-in `basic` client scope is required and its `auth_time` mapper is
bound to the `AUTH_TIME` user-session note through
`oidc-usersessionmodel-note-mapper`. `console-web` also has a hardcoded
`oidc-audience-mapper` whose included client audience is exactly
`console-bff`. It does not rely on audience resolution from role mappings.

Emergency recovery accepts its separate recovery factor only when `amr`
contains `otp`, `hwk`, `webauthn`, or `webauthn-passwordless`, and it
separately validates recent `auth_time`; an ACR value alone is insufficient.
The routine pre-Genesis browser flow does not satisfy that special recovery
contract. Any later WebAuthn or mandatory MFA flow requires a reviewed
contract update.

## Secret-free verification

No user, password, client credential, recovery value, signing material, host,
or internal address is present. Client credentials required by the runtime are
generated outside Git during packaging or commissioning.

Run the offline verifier directly:

```text
node scripts/inference-core/pr05-keycloak-seed.mjs
node --test scripts/inference-core/pr05-keycloak-seed.test.mjs
```

The verifier reads all four logical artifacts and has no network or runtime
mutation path. It independently exact-binds each realm and commissioning
matrix, then rejects cross-realm authority leakage. It also verifies the
minimum version, feature, FGAP policies and scopes, permission-class split,
browser execution references, protocol mappers, audiences, token lifetimes,
managed Application client contract, residual controls, and negative token
tests. It rejects coarse administrative roles, wildcards, active human-realm
`Roles` or `Clients` permissions, Application-realm human identity authority,
role-mapping scopes, native Operator mutation permissions, embedded
credentials, and missing password-authentication evidence claims.

Keycloak sources used for this contract:

- <https://www.keycloak.org/docs/latest/server_admin/#_fine_grain_permissions>
- <https://www.keycloak.org/2026/04/keycloak-2660-released>
- <https://www.keycloak.org/server/features>
- <https://www.keycloak.org/admin-api/protocol-mappers>
