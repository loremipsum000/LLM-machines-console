# Inference Core Keycloak seed

This directory defines the PR-05 logical appliance-realm seed and its ordered
commissioning contract. It is not a Keycloak realm export and does not perform
an import. PR-12 packaging must translate the reviewed selectors into the
pinned Keycloak release, resolve realm resource UUIDs, and prove the live
permission matrix before customer use.

## Runtime boundary

The minimum supported release is Keycloak `26.6.0`. The server must enable
`admin-fine-grained-authz:v2`, the appliance realm must set
`adminPermissionsEnabled`, and the resulting `admin-permissions` authorization
resource server must use FGAP v2. Version 26.6.0 is the minimum because its new
Groups `manage-membership-of-members` scope supplies the group-side bridge for
the Users `manage-group-membership` scope. No custom Keycloak provider plugin
is required or permitted by this seed.

The seed has one realm, `llm-machines`. The `master` realm is never a customer
administration target. Its only human roles are `admin` and `operator`, mapped
by the `Admins` and `Operators` groups. The only `realm-management` roles for
customer Admins and the Console human-admin service account are `query-users`
and `query-groups`; these expose navigation and search but do not bypass FGAP.

## FGAP v2 permissions

The active permissions use Keycloak's actual `Users` and `Groups` resource
types and their supported scopes. Logical `group:*`, `realm-role:*`, and
`service-account:*` selectors are resolved to appliance-realm UUIDs by PR-12.
There is no active `Roles` permission.

Customer Admin policy:

- `Users`, all resources: `view`.
- `Groups`, `Admins`: `view`, `view-members`, `manage-members`.
- `Groups`, `Operators`: `view`, `view-members` only.
- No `manage-group-membership`, `manage-membership`, role mapping, realm
  management, client management, or coarse `manage-users` authority.

Consequently, a customer Admin can view every identity and manage existing
Admin member accounts. The Admin cannot add or remove group members, map
roles, or mutate Operator member accounts through native Keycloak.
`query-groups` supplies Admin Console navigation and search only. Each retained
group also needs its explicit FGAP `view` scope to be a viewable resource.

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

## Offline access

The seed does not use a synthetic realm `offlineSessionsEnabled` switch because
Keycloak has no such RealmRepresentation field. Instead, `offline_access` is
absent from every retained client's optional client scopes and absent from the
`default-roles-llm-machines` realm-role composite. PR-12 must request
`scope=offline_access` against each token-capable retained client and prove
that the granted scope omits `offline_access` and no offline token is issued.

## MFA and token claims

The bound `llm-machines-browser-mfa` flow uses the built-in
`auth-username-password-form` execution with AMR reference `pwd`, followed by a
required built-in `auth-otp-form` execution with AMR reference `otp`. The
`llm-machines-amr` default client scope uses Keycloak's built-in
`oidc-amr-mapper` and explicitly adds `amr` to regular access tokens.

The built-in `basic` client scope is required and its `auth_time` mapper is
bound to the `AUTH_TIME` user-session note through
`oidc-usersessionmodel-note-mapper`. `console-web` also has a hardcoded
`oidc-audience-mapper` whose included client audience is exactly
`console-bff`. It does not rely on audience resolution from role mappings.

Emergency recovery accepts MFA only when `amr` contains `otp`, `hwk`,
`webauthn`, or `webauthn-passwordless`, and it separately validates recent
`auth_time`; an ACR value alone is insufficient. The current seeded browser
flow produces `otp`. Any later WebAuthn flow must bind its exact execution AMR
reference and pass a reviewed contract update before its evidence is accepted.

## Secret-free verification

No user, password, client credential, recovery value, signing material, host,
or internal address is present. Client credentials required by the runtime are
generated outside Git during packaging or commissioning.

Run the offline verifier directly:

```text
node scripts/inference-core/pr05-keycloak-seed.mjs
node --test scripts/inference-core/pr05-keycloak-seed.test.mjs
```

The verifier has no network or runtime mutation path. It exact-binds the
minimum version, feature, FGAP policies and scopes, permission-class split,
browser execution references, protocol mappers, audience, residual controls,
and commissioning evaluation matrix. It rejects coarse administrative roles,
wildcards, active `Roles` permissions, role-mapping scopes, client or realm
management, native Operator mutation permissions, embedded credentials, and
missing MFA evidence claims.

Keycloak sources used for this contract:

- <https://www.keycloak.org/docs/latest/server_admin/#_fine_grain_permissions>
- <https://www.keycloak.org/2026/04/keycloak-2660-released>
- <https://www.keycloak.org/server/features>
- <https://www.keycloak.org/admin-api/protocol-mappers>
