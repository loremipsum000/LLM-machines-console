import { createHash } from "node:crypto"
import { readFileSync, readdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const moduleDirectory = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(moduleDirectory, "../..")
const expectedFiles = [
  "README.md",
  "edge-policy.json",
  "native-admin-edge-profile.json",
  "no-bypass-policy.json",
  "product-edge.nginx.conf.template",
  "proxy-common.inc",
  "request-headers-console-browser.inc",
  "request-headers-customer-api.inc",
  "request-headers-identity-browser.inc",
  "request-headers-grafana-browser.inc",
  "request-headers-keycloak-admin-browser.inc",
  "request-headers-litellm-browser.inc",
  "request-safety.inc",
  "source-no-bypass.mjs",
  "source-no-bypass.test.mjs",
  "test-product-edge-routing.mjs",
  "validate-ingress.mjs",
  "validate-ingress.test.mjs",
]
const expectedUpstreams = [
  { id: "console-web", authority: "console-web:3000" },
  { id: "console-bff", authority: "console-bff:4001" },
  { id: "keycloak-identity", authority: "keycloak:8080" },
]
const expectedNginxUpstreams = [
  "console_web",
  "console_bff",
  "keycloak_identity",
  "grafana_native",
  "litellm_native",
]
const expectedPrivateSystems = [
  "alertmanager",
  "firecrawl-native",
  "grafana",
  "keycloak-admin",
  "litellm",
  "portainer",
  "postgresql",
  "prometheus",
  "sglang",
]
const expectedNegativeCases = [
  "direct-native-ports",
  "alternate-hostnames",
  "native-paths",
  "forwarded-header-spoofing",
  "path-traversal",
  "direct-network-access",
]
const expectedRouteIds = [
  "inference-models",
  "inference-chat-completions",
  "firecrawl-search",
  "firecrawl-scrape",
  "console-session-login",
  "console-session-callback",
  "console-session-logout",
  "console-session-elevate",
  "identity-backchannel-logout",
  "console-audit-export",
  "console-audit-verification-keys",
  "console-root",
  "console-read-only-pages",
  "console-next-action-pages",
  "console-team-import-template",
  "console-auth-pages",
  "console-next-assets",
  "console-product-assets",
  "identity-authorization",
  "identity-logout",
  "identity-logout-confirm",
  "identity-token",
  "identity-revocation",
  "identity-jwks",
  "identity-application-token",
  "identity-application-jwks",
  "identity-login-actions",
  "identity-resources",
]
const expectedCoreApiRoutes = [
  ["inference-models", "api", "GET,HEAD", "/v1/models", "console-bff"],
  [
    "inference-chat-completions",
    "api",
    "POST",
    "/v1/chat/completions",
    "console-bff",
  ],
  ["firecrawl-search", "firecrawl", "POST", "/v2/search", "console-bff"],
  ["firecrawl-scrape", "firecrawl", "POST", "/v2/scrape", "console-bff"],
]
const expectedNginxLocations = {
  api: ["= /v1/models", "= /v1/chat/completions", "/"],
  console: [
    "= /api/console/session/login",
    "= /api/console/session/callback",
    "= /api/console/session/logout",
    "= /api/console/session/elevate",
    "= /__llmm_identity_unavailable",
    "= /api/internal/console-session/backchannel-logout",
    "= /api/admin/audit/export",
    "= /api/admin/audit/export/verification-keys",
    "= /",
    '~ "^/(?:activity|hardware|inference|keys|applications|team)$"',
    '~ "^/(?:(?:keys|applications)/apps/(?:new|[A-Za-z0-9._-]{1,128})|settings|team/(?:import|groups/new|groups/[A-Za-z0-9._-]{1,128}|members|members/new|members/[A-Za-z0-9._-]{1,128}))$"',
    "= /team/import/template",
    "~ ^/auth/(?:signin|elevate|unavailable)$",
    "^~ /_next/",
    "^~ /console-v2/",
    "^~ /fonts/",
    "~ ^/(?:apple-touch-icon\\.png|favicon(?:-16x16|-32x32|-48x48)?\\.png|favicon\\.ico|icon\\.svg)$",
    "~* ^/(?:api/(?:app-gateway|internal|expert-ingress|live)|realms|admin|ui|public|key|model|router|metrics|graph|-|v0|v2/(?:crawl|map|batch|extract))(?:/|$)",
    "/",
  ],
  firecrawl: ["= /v2/search", "= /v2/scrape", "/"],
  identity: [
    "= /__llmm/global-logout",
    "= /realms/llm-machines/protocol/openid-connect/auth",
    "= /realms/llm-machines/protocol/openid-connect/logout",
    "= /realms/llm-machines/protocol/openid-connect/logout/logout-confirm",
    "= /realms/llm-machines/protocol/openid-connect/token",
    "= /realms/llm-machines/protocol/openid-connect/revoke",
    "= /realms/llm-machines/protocol/openid-connect/certs",
    "= /realms/llm-machines/protocol/openid-connect/userinfo",
    "~ ^/realms/llm-machines/protocol/openid-connect/3p-cookies/step[12]\\.html$",
    "= /realms/llm-machines/protocol/openid-connect/login-status-iframe.html",
    "= /realms/llm-machines/protocol/openid-connect/login-status-iframe.html/init",
    "= /realms/llm-machines-applications/protocol/openid-connect/token",
    "= /realms/llm-machines-applications/protocol/openid-connect/certs",
    "^~ /realms/llm-machines/login-actions/",
    "^~ /resources/",
    "= /__llmm_identity_unavailable",
    "~* ^/(?:admin|realms/(?:master|[^/]+)/admin|metrics|health)(?:/|$)",
    "/",
  ],
  grafana: [
    "= /",
    "= /login",
    "= /login/generic_oauth",
    "= /logout",
    "@grafana_global_logout_fallback",
    "~ ^/api/plugins/(?:elasticsearch|tempo|zipkin)/settings$",
    "~ ^/api/(?:dashboards/home|login/ping|plugins|user|user/orgs|user/preferences|user/stars)$",
    '~ "^/api/plugins/[a-z0-9_-]{1,128}/settings$"',
    "= /api/dashboards/db",
    '~ "^/api/dashboards/uid/[A-Za-z0-9_-]{1,128}$"',
    "= /api/frontend-metrics",
    "= /apis/dashboard.grafana.app/",
    "= /apis/dashboard.grafana.app/v0alpha1/namespaces/default/search",
    "= /apis/features.grafana.app/v0alpha1/namespaces/default/ofrep/v1/evaluate/flags",
    '~ "^/avatar/[A-Za-z0-9_-]{1,256}$"',
    "~ ^/(?:public/(?:build|fonts|img|plugins)/|resources/).+$",
    "= /__llmm_native_unavailable",
    "/",
  ],
  litellm: [
    "= /ui/",
    "~ ^/ui/(?:access-groups|admin-panel|api-keys|api-reference|budgets|caching|cost-optimization|cost-tracking|guardrails|guardrails-monitor|logging-and-alerts|logs|models-and-endpoints|old-usage|organizations|playground|policies|projects|prompts|router-settings|tag-management|teams|transform-request|ui-theme|usage|users)/?$",
    "~ ^/ui/login/?$",
    "~ ^/(?:litellm-asset-prefix/_next/static/|ui/__next\\.|litellm/\\.well-known/litellm-ui-config).*$",
    "= /sso/key/generate",
    "= /__llmm/global-logout",
    "= /sso/callback",
    "= /key/generate",
    "= /key/list",
    "= /key/info",
    "= /key/delete",
    "= /v2/key/info",
    "= /user/info",
    "= /models",
    "= /v2/team/list",
    "= /team/list",
    "~ ^/(?:api/plugins|organization/list|policies/list|project/list|prompts/list|user/available_roles|user/available_users|v2/guardrails/list|v2/user/info)$",
    "~ ^/(?:model/new|team/new|organization/new|user/new|config/update)$",
    "= /v1/models",
    "= /v1/chat/completions",
    "~* ^/(?:public/litellm_blog_posts|v1/agents)(?:/|$)",
    "= /__llmm_native_unavailable",
    "/",
  ],
  keycloakAdmin: [
    "= /keycloak/admin/llm-machines/console/whoami",
    "^~ /keycloak/admin/llm-machines/console/",
    "= /keycloak/admin/realms/llm-machines",
    "= /keycloak/admin/serverinfo",
    "= /keycloak/admin/realms/llm-machines/users",
    '~ "^/keycloak/admin/realms/llm-machines/users/[0-9a-f-]{36}$"',
    '~ "^/keycloak/admin/realms/llm-machines/users/[0-9a-f-]{36}/reset-password$"',
    '~ "^/keycloak/admin/realms/llm-machines/users/[0-9a-f-]{36}/sessions$"',
    '~ "^/keycloak/admin/realms/llm-machines/sessions/[A-Za-z0-9_-]{24}$"',
    '~ "^/keycloak/admin/realms/llm-machines/groups(?:/[0-9a-f-]{36}(?:/members)?)?$"',
    "^~ /keycloak/resources/",
    "= /__llmm_native_unavailable",
    "~* ^/keycloak/(?:admin/(?:master|realms/(?:master|(?!(?:llm-machines)(?:/|$))[^/]+))|realms/(?:master|(?!(?:llm-machines)(?:/|$))[^/]+))(?:/|$)",
    "/",
  ],
}
const expectedRuntimeSourceHashes = {
  "product-edge.nginx.conf.template":
    "033633047e33af4356edddc2126c2b33fbefe82bceb1d9b5e59c9081befe9e63",
  "native-admin-edge-profile.json":
    "73e6a93e87cd24166c42cf873a581be95e3c4795c7752c1abc03638caf9e3666",
  "proxy-common.inc":
    "cf8199a159a6ff4e5842d26b00277d7b7ddab8ab5169258c8b4d14f1cce7d3f2",
  "request-headers-console-browser.inc":
    "437d4dba7b95277260d7c0f8aa13db35d1f0747fcfbf49fc60f31182c3bc037e",
  "request-headers-customer-api.inc":
    "b7702c4b933206105278c1ee8f7f03ae863a2d1b0896046351514e5d279a8428",
  "request-headers-identity-browser.inc":
    "8dc46e0f6d875e042814d06613a520928153fe585fe45ed65ba4065c9be79dc2",
  "request-headers-grafana-browser.inc":
    "86b48ede17e1d05b8e16f286598dc7df63da083bde49f8f885440a37ccf2a5f9",
  "request-headers-keycloak-admin-browser.inc":
    "9990f36d83640ee2c2c87505a87394e0e15d810c61964f3c144c957a9c215f62",
  "request-headers-litellm-browser.inc":
    "1cd73c5689efa144908db278ed8a01d941c2d7f327bd6b6a76f9cf9faf0fd8fd",
  "request-safety.inc":
    "148baeded4c09367b0745a80e275ac684435a5c4e18a6ceaad5b25702e284756",
}

export function validateIngressSources(sources) {
  const errors = []
  const policy = parseJson(
    sources["edge-policy.json"],
    "edge-policy.json",
    errors,
  )
  const noBypass = parseJson(
    sources["no-bypass-policy.json"],
    "no-bypass-policy.json",
    errors,
  )
  const nativeAdmin = parseJson(
    sources["native-admin-edge-profile.json"],
    "native-admin-edge-profile.json",
    errors,
  )
  if (!policy || !noBypass || !nativeAdmin) {
    return errors
  }
  validatePolicy(policy, errors)
  validateNoBypass(noBypass, errors)
  validateNativeAdmin(nativeAdmin, errors)
  validateRuntimeSourceFingerprints(sources, errors)
  validateNginx(sources, errors)
  validateHeaders(sources, errors)
  validateCredentialSafety(sources, errors)
  return errors
}

function validateNativeAdmin(profile, errors) {
  add(
    errors,
    profile.schema === "llm-machines.f0-n5s-native-admin-edge.v1" &&
      profile.workPackage === "F0-N5S",
    "native-admin profile identity changed",
  )
  add(
    errors,
    profile.status === "SOURCE_PROFILE_CORRECTED_NOT_DEPLOYED_F0_N7_PENDING" &&
      profile.accepted === false &&
      profile.runtimeQualified === false &&
      profile.activation === "INACTIVE_PENDING_F0_N7",
    "native-admin profile overstates activation or qualification",
  )
  add(
    errors,
    profile.protectedInput?.commit ===
      "dbdc1005711ea2cbfb3658a268181dbd2deef6e0" &&
      profile.protectedInput?.tree ===
        "ca9ea9debf1d78f9bd95d75f4c34d1f1cfecfd1e",
    "native-admin protected input changed",
  )
  add(
    errors,
    sameJson(Object.keys(profile.services ?? {}), [
      "grafana",
      "litellm",
      "keycloakAdmin",
    ]),
    "native-admin service set changed",
  )
  const grafana = profile.services?.grafana
  add(
    errors,
    grafana?.version === "13.1.3" &&
      grafana?.hostTemplate === "@@PRODUCT_GRAFANA_HOST@@" &&
      grafana?.upstream === "grafana:3000" &&
      sameJson(grafana?.roles, {
        Admin: "Editor",
        Operator: "DENY",
        other: "DENY",
        serverAdministrator: false,
      }) &&
      grafana?.webSocketRequired === false &&
      grafana?.sseRequired === false,
    "Grafana native role or transport contract changed",
  )
  const litellm = profile.services?.litellm
  add(
    errors,
    litellm?.version === "v1.96.2-llmm.1" &&
      litellm?.hostTemplate === "@@PRODUCT_LITELLM_HOST@@" &&
      litellm?.upstream === "litellm:4000" &&
      litellm?.roles?.Admin === "proxy_admin" &&
      litellm?.roles?.Operator === "internal_user" &&
      litellm?.billableUserLimit === 5 &&
      litellm?.webSocketRequired === false &&
      litellm?.sseSupportedForNativeInference === true,
    "LiteLLM native role or transport contract changed",
  )
  add(
    errors,
    sameJson(litellm?.operatorAuthority?.allow, [
      "own virtual keys",
      "own spend",
    ]) &&
      sameJson(litellm?.operatorAuthority?.deny, [
        "routes",
        "models",
        "teams",
        "organizations",
        "other users",
        "shared keys",
        "global budgets",
        "system configuration",
      ]),
    "LiteLLM Operator authority broadened",
  )
  add(
    errors,
    sameJson(litellm?.nativeCookies, [
      "litellm_cp_return_to",
      "litellm_oauth_state",
      "sso_state",
      "token",
    ]) &&
      sameJson(litellm?.cookieSecurity, {
        edgeEnforcement: "NGINX_PROXY_COOKIE_FLAGS",
        stateCookies: {
          names: ["litellm_cp_return_to", "litellm_oauth_state", "sso_state"],
          secure: true,
          httpOnly: true,
          sameSite: "Lax",
        },
        nativeUiToken: {
          name: "token",
          secure: true,
          httpOnly: false,
          sameSite: "Lax",
          javascriptReadableRequiredByPinnedUi: true,
          dedicatedAuthorityOnly: true,
          consoleMaterialForwarded: false,
        },
        unexpectedCookie: "FAIL_F0_N7_BROWSER_VALIDATION",
      }),
    "LiteLLM native cookie security contract changed",
  )
  const keycloak = profile.services?.keycloakAdmin
  add(
    errors,
    keycloak?.version === "26.7.0" &&
      keycloak?.hostTemplate === "@@PRODUCT_KEYCLOAK_ADMIN_HOST@@" &&
      keycloak?.upstream === "keycloak:8080" &&
      keycloak?.frontendHostTemplate === "@@PRODUCT_IDENTITY_HOST@@" &&
      keycloak?.frontendContextPath === "/" &&
      keycloak?.adminContextPath === "/keycloak" &&
      keycloak?.upstreamContextPath === "/" &&
      sameJson(keycloak?.hostnameContract, {
        hostname: "https://@@PRODUCT_IDENTITY_HOST@@",
        hostnameAdmin: "https://@@PRODUCT_KEYCLOAK_ADMIN_HOST@@/keycloak",
        proxyHeaders: "xforwarded",
        hostnameStrict: true,
      }) &&
      keycloak?.pathNormalization?.scope ===
        "ALLOWLISTED_KEYCLOAK_ADMIN_LOCATIONS_ONLY" &&
      keycloak?.pathNormalization?.externalPrefix === "/keycloak/" &&
      keycloak?.pathNormalization?.upstreamPrefix === "/" &&
      keycloak?.pathNormalization?.traversalRejectedBeforeRewrite === true &&
      keycloak?.pathNormalization?.unlistedPathCannotReachRewrite === true &&
      keycloak?.roles?.Admin === "SCOPED_APPLIANCE_REALM_ADMIN" &&
      keycloak?.roles?.Operator === "DENY" &&
      keycloak?.roles?.other === "DENY" &&
      sameJson(keycloak?.tokenEndpointOriginPolicy, {
        noOrigin: "ALLOW_SERVER_SIDE_EXCHANGE",
        allowedBrowserOrigin: "https://@@PRODUCT_KEYCLOAK_ADMIN_HOST@@",
        otherBrowserOrigins: "DENY_403_BEFORE_UPSTREAM",
        forwardedValue: "EXACT_ALLOWED_BROWSER_ORIGIN_ONLY",
      }) &&
      sameJson(keycloak?.sessionIdentifierContract, {
        upstreamVersion: "26.7.0",
        upstreamSourceCommit: "6c73e3027811d9c7b22683edd825e839272e9547",
        generator: "SecretGenerator.SECURE_ID_GENERATOR",
        entropyBytes: 18,
        encoding: "BASE64URL_PADDED_ENCODER_WITH_NO_PADDING_FOR_18_BYTE_INPUT",
        length: 24,
        alphabet: "A-Za-z0-9_-",
        edgePathPattern:
          "^/keycloak/admin/realms/llm-machines/sessions/[A-Za-z0-9_-]{24}$",
        sourceSha256: {
          "common/src/main/java/org/keycloak/common/util/SecretGenerator.java":
            "03ff7216edd3bf3f7bd896b8d59155dcfcbdea536352f73483a232e8e0aec892",
          "model/infinispan/src/main/java/org/keycloak/models/sessions/infinispan/InfinispanUserSessionProvider.java":
            "ff82c2db4e18bc50168670147626b0bbb483210f88407def5a2c7338595f50b3",
          "model/infinispan/src/main/java/org/keycloak/models/sessions/infinispan/InfinispanUserSessionProviderFactory.java":
            "ceee33bd59432dc9002b3a5bd201eaecaa5c2cbc37a6584994c3fc0818c88bd7",
        },
      }) &&
      keycloak?.explicitDenials?.includes("/keycloak/admin/master") &&
      keycloak?.explicitDenials?.includes(
        "/keycloak/admin/realms/{unrelated-realm}",
      ) &&
      keycloak?.explicitDenials?.includes("/keycloak/realms/*"),
    "Keycloak native role or realm contract changed",
  )
  add(
    errors,
    keycloak?.explicitDenials?.includes(
      "DELETE /keycloak/admin/realms/llm-machines/users/{uuid}",
    ),
    "Keycloak user-delete denial is missing",
  )
  add(
    errors,
    profile.edge?.customerFacingTcpPorts?.length === 1 &&
      profile.edge.customerFacingTcpPorts[0] === 443 &&
      profile.edge?.dedicatedHostnamesOnly === true &&
      profile.edge?.directNativePortsRemainPrivate === true &&
      profile.edge?.consoleSessionForwarded === false &&
      profile.edge?.consoleTokenForwarded === false &&
      profile.edge?.reverseProxyImpersonation === false &&
      profile.edge?.webSocketForwarding === false &&
      sameJson(profile.edge?.globalLogout, {
        start: "https://@@PRODUCT_GRAFANA_HOST@@/logout",
        sequence: ["grafana", "litellm", "identity", "console"],
        consoleMaterialForwarded: false,
        tokensInUrls: false,
        serviceAvailabilityRequired: false,
      }),
    "native-admin edge boundary changed",
  )
  add(
    errors,
    profile.globalDenials?.keycloakUserDelete === 403 &&
      profile.globalDenials?.portainerAuthority === "ABSENT" &&
      profile.globalDenials?.portainerUpstream === "ABSENT" &&
      profile.globalDenials?.portainerRoute === "ABSENT",
    "native-admin explicit denial set changed",
  )
  const grafanaOauth = profile.services?.grafana?.routes?.find(
    ({ id }) => id === "oauth-entry-or-callback",
  )
  add(
    errors,
    sameJson(profile.queryPolicies?.["grafana-oauth-entry-or-callback"], [
      "code",
      "iss",
      "redirectTo",
      "session_state",
      "state",
    ]) &&
      grafanaOauth?.path?.kind === "exact" &&
      grafanaOauth?.path?.value === "/login/generic_oauth" &&
      sameJson(grafanaOauth?.methods, ["GET", "HEAD"]) &&
      grafanaOauth?.queryPolicy === "grafana-oauth-entry-or-callback" &&
      grafanaOauth?.emptyQueryAllowed === true,
    "Grafana OAuth entry-or-callback policy changed",
  )
  const grafanaStatic = profile.services?.grafana?.routes?.find(
    ({ id }) => id === "static-assets",
  )
  const liteLlmModels = profile.services?.litellm?.routes?.find(
    ({ id }) => id === "models",
  )
  const liteLlmTeamList = profile.services?.litellm?.routes?.find(
    ({ id }) => id === "team-list",
  )
  const liteLlmTeamListV1 = profile.services?.litellm?.routes?.find(
    ({ id }) => id === "team-list-v1",
  )
  const liteLlmKeyList = profile.services?.litellm?.routes?.find(
    ({ id }) => id === "key-list",
  )
  const liteLlmUiPages = profile.services?.litellm?.routes?.find(
    ({ id }) => id === "ui-pages",
  )
  add(
    errors,
    sameJson(profile.queryPolicies?.["grafana-static-cache"], ["_cache"]) &&
      grafanaStatic?.queryPolicy === "grafana-static-cache" &&
      sameJson(profile.queryPolicies?.["litellm-models"], [
        "include_model_access_groups",
        "return_wildcard_routes",
      ]) &&
      liteLlmModels?.path?.value === "/models" &&
      liteLlmModels?.queryPolicy === "litellm-models" &&
      sameJson(profile.queryPolicies?.["litellm-team-list"], [
        "page",
        "page_size",
        "user_id",
      ]) &&
      liteLlmTeamList?.path?.value === "/v2/team/list" &&
      liteLlmTeamList?.queryPolicy === "litellm-team-list" &&
      sameJson(profile.queryPolicies?.["litellm-team-list-v1"], ["user_id"]) &&
      liteLlmTeamListV1?.path?.value === "/team/list" &&
      liteLlmTeamListV1?.queryPolicy === "litellm-team-list-v1" &&
      liteLlmUiPages?.path?.kind === "regex" &&
      liteLlmUiPages?.path?.value ===
        "^/ui/(?:access-groups|admin-panel|api-keys|api-reference|budgets|caching|cost-optimization|cost-tracking|guardrails|guardrails-monitor|logging-and-alerts|logs|models-and-endpoints|old-usage|organizations|playground|policies|projects|prompts|router-settings|tag-management|teams|transform-request|ui-theme|usage|users)/?$" &&
      sameJson(liteLlmUiPages?.methods, ["GET", "HEAD"]) &&
      liteLlmUiPages?.queryPolicy === "litellm-ui" &&
      sameJson(profile.queryPolicies?.["litellm-key-list"], [
        "expand",
        "include_created_by_keys",
        "include_team_keys",
        "page",
        "return_full_object",
        "size",
        "sort_by",
        "sort_order",
        "substring_matching",
        "user_id",
      ]) &&
      liteLlmKeyList?.queryPolicy === "litellm-key-list",
    "observed native UI query policy changed",
  )
  const grafanaLogout = profile.services?.grafana?.routes?.find(
    ({ id }) => id === "logout",
  )
  const liteLlmSso = profile.services?.litellm?.routes?.find(
    ({ id }) => id === "login",
  )
  const liteLlmLoginRedirect = profile.services?.litellm?.routes?.find(
    ({ id }) => id === "login-redirect",
  )
  const liteLlmGlobalLogout = profile.services?.litellm?.routes?.find(
    ({ id }) => id === "global-logout",
  )
  add(
    errors,
    profile.services?.grafana?.ssoEntry ===
      "AUTOMATIC_GENERIC_OAUTH_USING_EXISTING_KEYCLOAK_SESSION" &&
      grafanaLogout?.path?.value === "/logout" &&
      profile.services?.grafana?.failureBehavior?.logoutDuringServiceOutage ===
        "EDGE_EXPIRES_GRAFANA_COOKIES_THEN_CONTINUES_FIXED_GLOBAL_CHAIN" &&
      profile.services?.litellm?.ssoEntry ===
        "AUTOMATIC_GENERIC_OIDC_USING_EXISTING_KEYCLOAK_SESSION" &&
      profile.services?.litellm?.passwordLoginCustomerPath === "ABSENT" &&
      liteLlmSso?.queryPolicy === "litellm-sso-entry" &&
      liteLlmSso?.allowedReturnTo === "https://@@PRODUCT_LITELLM_HOST@@/ui/" &&
      liteLlmLoginRedirect?.behavior === "EDGE_303_TO_SAFE_SSO_ENTRY" &&
      liteLlmGlobalLogout?.path?.value === "/__llmm/global-logout" &&
      sameJson(profile.queryPolicies?.["litellm-rsc"], ["_rsc"]) &&
      sameJson(profile.queryPolicies?.["litellm-sso-entry"], ["return_to"]),
    "automatic native SSO or global logout contract changed",
  )
  add(
    errors,
    profile.authorityProvisioning?.productionDomainOwner === "customer" &&
      profile.authorityProvisioning
        ?.customerSpecificAuthoritiesAreCommissioningInputs === true &&
      profile.authorityProvisioning?.connectedTls ===
        "PROVIDER_NEUTRAL_SCOPED_DNS_01_OR_DELEGATED_CHALLENGE_ZONE" &&
      profile.authorityProvisioning?.porkbunDependency === false &&
      profile.authorityProvisioning?.disconnectedTls ===
        "CUSTOMER_OWNED_PRIVATE_CA" &&
      profile.authorityProvisioning?.registryOrDnsCredentialInProductSource ===
        false,
    "native-admin authority custody contract changed",
  )
  add(
    errors,
    Object.entries(profile.runtimeGates ?? {})
      .filter(([key]) => key !== "f0N7RequiredBeforeActivation")
      .every(([, value]) => value === "NOT_STARTED") &&
      profile.runtimeGates?.f0N7RequiredBeforeActivation === true,
    "native-admin runtime evidence was claimed before F0-N7",
  )
}

function validateRuntimeSourceFingerprints(sources, errors) {
  for (const [path, expected] of Object.entries(expectedRuntimeSourceHashes)) {
    const source = sources[path]
    add(
      errors,
      typeof source === "string" && sha256(source) === expected,
      `runtime source fingerprint changed for ${path}`,
    )
  }
}

function validatePolicy(policy, errors) {
  add(errors, policy.schemaVersion === 1, "edge policy schema version changed")
  add(errors, policy.workPackage === "F0-E0", "edge policy package changed")
  add(
    errors,
    policy.status === "source-only-not-runtime-qualified",
    "edge policy overstates runtime qualification",
  )
  add(
    errors,
    sameJson(policy.edge?.customerFacingTcpPorts, [443]),
    "customer listener ports changed",
  )
  add(
    errors,
    sameJson(policy.edge?.hostTemplates, {
      api: "@@PRODUCT_API_HOST@@",
      console: "@@PRODUCT_CONSOLE_HOST@@",
      firecrawl: "@@PRODUCT_FIRECRAWL_HOST@@",
      identity: "@@PRODUCT_IDENTITY_HOST@@",
    }),
    "public host templates changed",
  )
  for (const field of [
    "clientSniMustEqualSelectedHost",
    "hostHeaderMustExactlyEqualClientSni",
    "rejectingDefaultTlsServer",
  ]) {
    add(errors, policy.edge?.[field] === true, `edge ${field} must remain true`)
  }
  add(
    errors,
    sameJson(policy.upstreams, expectedUpstreams),
    "fixed edge upstreams changed",
  )
  add(
    errors,
    sameJson(
      policy.routes?.map((route) => route.id),
      expectedRouteIds,
    ),
    "edge route IDs or order changed",
  )
  const uniqueRoutes = new Set(
    policy.routes?.map(
      (route) =>
        `${route.hostId}:${route.methods.join(",")}:${route.path.kind}:${route.path.value}`,
    ),
  )
  add(
    errors,
    uniqueRoutes.size === expectedRouteIds.length,
    "edge routes are missing or duplicated",
  )
  const coreRoutes = policy.routes
    ?.filter((route) => ["inference", "firecrawl"].includes(route.surface))
    .map((route) => [
      route.id,
      route.hostId,
      route.methods.join(","),
      route.path.value,
      route.upstreamId,
    ])
  add(
    errors,
    sameJson(coreRoutes, expectedCoreApiRoutes),
    "public inference or Firecrawl route changed",
  )
  for (const route of policy.routes ?? []) {
    add(
      errors,
      ["api", "console", "firecrawl", "identity"].includes(route.hostId),
      `route ${route.id} uses an unknown public host`,
    )
    add(
      errors,
      ["console-web", "console-bff", "keycloak-identity"].includes(
        route.upstreamId,
      ),
      `route ${route.id} uses an unapproved upstream`,
    )
    add(
      errors,
      !/grafana|litellm|portainer|prometheus|alertmanager|keycloak-admin/i.test(
        JSON.stringify(route),
      ),
      `route ${route.id} introduces native administration`,
    )
  }
  const applicationTokenRoute = policy.routes?.find(
    (route) => route.id === "identity-application-token",
  )
  add(
    errors,
    applicationTokenRoute?.headerProfile === "identity-application-token",
    "Application token header profile changed",
  )
  add(
    errors,
    sameJson(policy.privateNativeSystems, expectedPrivateSystems),
    "private native-system list changed",
  )
  add(
    errors,
    policy.headerPolicy?.requestHeaderForwarding === "drop-all-then-explicit",
    "request headers are no longer default-drop",
  )
  for (const field of [
    "browserBearerForwarding",
    "consoleSessionForwardedToIdentity",
    "clientForwardedOrIdentityHeadersTrusted",
    "websocketUpgradeForwarded",
  ]) {
    add(
      errors,
      policy.headerPolicy?.[field] === false,
      `header policy ${field} must remain false`,
    )
  }
  add(
    errors,
    policy.headerPolicy?.applicationTokenClientSecretBasicForwarding === true &&
      policy.headerPolicy?.applicationTokenClientSecretPostAllowed === false,
    "Application token Basic authentication forwarding changed",
  )
  add(
    errors,
    sameJson(policy.headerPolicy?.allowlists?.["identity-application-token"], [
      "Accept",
      "Authorization",
      "Content-Length",
      "Content-Type",
    ]),
    "Application token header allowlist changed",
  )
  add(
    errors,
    policy.responsePolicy?.consoleAndIdentitySetCookieAllowed === true &&
      policy.responsePolicy?.consoleAndIdentityLocationAllowed === true,
    "retained browser cookies or redirects were suppressed",
  )
  add(
    errors,
    policy.responsePolicy?.internalAuthorityDisclosureAllowed === false &&
      policy.responsePolicy?.nativeAdministrationRedirectAllowed === false,
    "native or internal response disclosure was enabled",
  )
  for (const field of [
    "requestBuffering",
    "responseBuffering",
    "cache",
    "requestOrResponseBodiesLogged",
    "requestTargetOrQueryLogged",
    "arbitraryHeadersLogged",
  ]) {
    add(
      errors,
      policy.contentHandling?.[field] === false,
      `content policy ${field} must remain false`,
    )
  }
  add(
    errors,
    Object.values(policy.runtimeQualification ?? {}).length === 4 &&
      Object.values(policy.runtimeQualification).every(
        (value) => value === "NOT_EVALUATED_RUNTIME",
      ),
    "source policy overstates runtime qualification",
  )
}

function validateNoBypass(policy, errors) {
  add(errors, policy.schemaVersion === 1, "no-bypass schema version changed")
  add(errors, policy.workPackage === "F0-E0", "no-bypass package changed")
  add(
    errors,
    policy.status === "source-policy-only",
    "no-bypass policy overstates runtime evidence",
  )
  add(
    errors,
    sameJson(policy.customerNetwork?.allowedTcpPorts, [443]),
    "no-bypass allowed ports changed",
  )
  add(
    errors,
    sameJson(
      policy.customerNetwork?.deniedNativeTcpPorts,
      [3000, 3002, 3128, 4000, 4001, 5432, 8080, 9090, 9093, 9443],
    ),
    "native-port denial set changed",
  )
  add(
    errors,
    policy.customerNetwork?.deniedInferenceProfileTcpPorts ===
      "every-instantiated-private-listener",
    "inference-profile listener denial changed",
  )
  add(
    errors,
    sameJson(
      policy.negativeCases?.map((entry) => entry.id),
      expectedNegativeCases,
    ),
    "no-bypass negative cases changed",
  )
  for (const entry of policy.negativeCases ?? []) {
    add(
      errors,
      entry.runtimeState === "NOT_EVALUATED_RUNTIME",
      `no-bypass case ${entry.id} overstates runtime proof`,
    )
  }
}

function validateNginx(sources, errors) {
  const nginx = sources["product-edge.nginx.conf.template"] ?? ""
  const proxyCommon = sources["proxy-common.inc"] ?? ""
  const safety = sources["request-safety.inc"] ?? ""
  add(
    errors,
    sameJson(
      [...nginx.matchAll(/\bupstream\s+([a-z0-9_]+)\s*\{/g)].map(
        (match) => match[1],
      ),
      expectedNginxUpstreams,
    ),
    "Nginx upstream declarations changed",
  )
  add(
    errors,
    !/upstream\s+(?:prometheus|alertmanager|portainer)/i.test(nginx),
    "Nginx declares an unapproved native administration upstream",
  )
  const listens = [...nginx.matchAll(/^\s*listen\s+([^;]+);/gm)].map(
    (match) => match[1],
  )
  add(
    errors,
    listens.length === 8 &&
      listens.every((value) => value.startsWith("443 ssl")),
    "Nginx customer listeners changed",
  )
  add(
    errors,
    nginx.includes("listen 443 ssl default_server;") &&
      nginx.includes("ssl_reject_handshake on;"),
    "rejecting default TLS server is missing",
  )
  add(
    errors,
    count(nginx, "server_name @@PRODUCT_API_HOST@@;") === 1 &&
      count(nginx, "server_name @@PRODUCT_CONSOLE_HOST@@;") === 1 &&
      count(nginx, "server_name @@PRODUCT_FIRECRAWL_HOST@@;") === 1 &&
      count(nginx, "server_name @@PRODUCT_IDENTITY_HOST@@;") === 1 &&
      count(nginx, "server_name @@PRODUCT_GRAFANA_HOST@@;") === 1 &&
      count(nginx, "server_name @@PRODUCT_LITELLM_HOST@@;") === 1 &&
      count(nginx, "server_name @@PRODUCT_KEYCLOAK_ADMIN_HOST@@;") === 1,
    "public Nginx hosts changed",
  )
  const consoleServer = hostServerSection(
    nginx,
    "@@PRODUCT_CONSOLE_HOST@@",
    "@@PRODUCT_API_HOST@@",
  )
  const apiServer = hostServerSection(
    nginx,
    "@@PRODUCT_API_HOST@@",
    "@@PRODUCT_FIRECRAWL_HOST@@",
  )
  const firecrawlServer = hostServerSection(
    nginx,
    "@@PRODUCT_FIRECRAWL_HOST@@",
    "@@PRODUCT_IDENTITY_HOST@@",
  )
  const identityServer = hostServerSection(
    nginx,
    "@@PRODUCT_IDENTITY_HOST@@",
    "@@PRODUCT_GRAFANA_HOST@@",
  )
  const grafanaServer = hostServerSection(
    nginx,
    "@@PRODUCT_GRAFANA_HOST@@",
    "@@PRODUCT_LITELLM_HOST@@",
  )
  const litellmServer = hostServerSection(
    nginx,
    "@@PRODUCT_LITELLM_HOST@@",
    "@@PRODUCT_KEYCLOAK_ADMIN_HOST@@",
  )
  const keycloakAdminServer = hostServerSection(
    nginx,
    "@@PRODUCT_KEYCLOAK_ADMIN_HOST@@",
  )
  for (const [hostId, server] of Object.entries({
    api: apiServer,
    console: consoleServer,
    firecrawl: firecrawlServer,
    identity: identityServer,
    grafana: grafanaServer,
    litellm: litellmServer,
    keycloakAdmin: keycloakAdminServer,
  })) {
    add(
      errors,
      sameJson(locationDeclarations(server), expectedNginxLocations[hostId]),
      `Nginx ${hostId} location inventory changed`,
    )
  }
  add(
    errors,
    !/location = \/v[12]\//.test(consoleServer),
    "Console host contains a customer API route",
  )
  add(
    errors,
    apiServer.includes("location = /v1/models") &&
      apiServer.includes("location = /v1/chat/completions") &&
      !apiServer.includes("location = /v2/") &&
      !apiServer.includes("/realms/"),
    "API host route boundary changed",
  )
  add(
    errors,
    firecrawlServer.includes("location = /v2/search") &&
      firecrawlServer.includes("location = /v2/scrape") &&
      !firecrawlServer.includes("location = /v1/") &&
      !firecrawlServer.includes("/realms/"),
    "Firecrawl host route boundary changed",
  )
  add(
    errors,
    identityServer.includes(
      "location = /realms/llm-machines/protocol/openid-connect/auth",
    ) &&
      identityServer.includes(
        "location = /realms/llm-machines/protocol/openid-connect/userinfo",
      ) &&
      identityServer.includes(
        "location = /realms/llm-machines/protocol/openid-connect/login-status-iframe.html/init",
      ) &&
      identityServer.includes(
        "location = /realms/llm-machines-applications/protocol/openid-connect/token",
      ) &&
      identityServer.includes(
        "location = /realms/llm-machines-applications/protocol/openid-connect/certs",
      ) &&
      !/location = \/v[12]\//.test(identityServer),
    "identity host route boundary changed",
  )
  add(
    errors,
    grafanaServer.includes("proxy_pass http://grafana_native;") &&
      grafanaServer.includes("location = /logout") &&
      grafanaServer.includes("location @grafana_global_logout_fallback") &&
      grafanaServer.includes(
        "return 303 https://@@PRODUCT_LITELLM_HOST@@/__llmm/global-logout;",
      ) &&
      grafanaServer.includes("location = /login/generic_oauth") &&
      grafanaServer.includes("location = /api/dashboards/db") &&
      grafanaServer.includes(
        "location ~ ^/api/plugins/(?:elasticsearch|tempo|zipkin)/settings$",
      ) &&
      !/proxy_set_header\s+Authorization\s+\$http_authorization/.test(
        grafanaServer,
      ),
    "Grafana native route or browser-authorization boundary changed",
  )
  add(
    errors,
    litellmServer.includes("proxy_pass http://litellm_native;") &&
      litellmServer.includes(
        "location ~ ^/ui/(?:access-groups|admin-panel|api-keys|api-reference|budgets|caching|cost-optimization|cost-tracking|guardrails|guardrails-monitor|logging-and-alerts|logs|models-and-endpoints|old-usage|organizations|playground|policies|projects|prompts|router-settings|tag-management|teams|transform-request|ui-theme|usage|users)/?$",
      ) &&
      litellmServer.includes("location ~ ^/ui/login/?$") &&
      litellmServer.includes(
        "return 303 https://@@PRODUCT_LITELLM_HOST@@/sso/key/generate?return_to=https%3A%2F%2F@@PRODUCT_LITELLM_HOST@@%2Fui%2F;",
      ) &&
      litellmServer.includes("location = /__llmm/global-logout") &&
      litellmServer.includes(
        "return 303 https://@@PRODUCT_IDENTITY_HOST@@/__llmm/global-logout;",
      ) &&
      litellmServer.includes("location = /key/generate") &&
      litellmServer.includes("location = /key/delete") &&
      litellmServer.includes("location = /v1/chat/completions") &&
      litellmServer.includes(
        "location ~* ^/(?:public/litellm_blog_posts|v1/agents)(?:/|$)",
      ) &&
      !litellmServer.includes("location ~ ^/ui/.*") &&
      !/location[^\n]*\/ui\/(?:mcp-servers|agents|memory|skills|search-tools|tool-policies|vector-stores|workflows)/.test(
        litellmServer,
      ) &&
      !/location[^\n]*\^?\/(?:router|budget)/i.test(litellmServer),
    "LiteLLM native route boundary changed",
  )
  add(
    errors,
    identityServer.includes("location = /__llmm/global-logout") &&
      identityServer.includes(
        'add_header Set-Cookie "KEYCLOAK_IDENTITY=; Path=/realms/llm-machines/; Max-Age=0; HttpOnly; Secure; SameSite=None" always;',
      ) &&
      identityServer.includes(
        "return 303 https://@@PRODUCT_CONSOLE_HOST@@/auth/signin;",
      ),
    "global identity logout boundary changed",
  )
  add(
    errors,
    litellmServer.includes(
      "proxy_cookie_flags ~^(?:litellm_cp_return_to|litellm_oauth_state|sso_state)$ secure httponly samesite=lax;",
    ) &&
      litellmServer.includes("proxy_cookie_flags token secure samesite=lax;") &&
      !litellmServer.includes(
        "proxy_cookie_flags token secure httponly samesite=lax;",
      ) &&
      count(litellmServer, "proxy_cookie_flags ") === 2,
    "LiteLLM native cookie transport boundary changed",
  )
  add(
    errors,
    keycloakAdminServer.includes(
      "location ^~ /keycloak/admin/llm-machines/console/",
    ) &&
      keycloakAdminServer.includes(
        "location ~* ^/keycloak/(?:admin/(?:master|realms/",
      ) &&
      !keycloakAdminServer.includes("/keycloak/realms/llm-machines/") &&
      !keycloakAdminServer.includes("/keycloak/admin/master/console/") &&
      !keycloakAdminServer.includes("location = /keycloak/admin/realms {"),
    "Keycloak appliance-realm route boundary changed",
  )
  add(
    errors,
    count(keycloakAdminServer, "rewrite ^/keycloak/(.*)$ /$1 break;") === 11 &&
      keycloakAdminServer.includes(
        "include /etc/nginx/llm-machines/request-headers-keycloak-admin-browser.inc;",
      ),
    "Keycloak external admin prefix normalization changed",
  )
  const keycloakUser = exactLocationSection(
    keycloakAdminServer,
    '~ "^/keycloak/admin/realms/llm-machines/users/[0-9a-f-]{36}$"',
  )
  add(
    errors,
    keycloakUser.includes("if ($request_method = DELETE) { return 403; }") &&
      keycloakUser.includes("limit_except GET HEAD PUT { deny all; }"),
    "Keycloak user deletion is not denied at the Product edge",
  )
  const keycloakSession = exactLocationSection(
    keycloakAdminServer,
    '~ "^/keycloak/admin/realms/llm-machines/sessions/[A-Za-z0-9_-]{24}$"',
  )
  add(
    errors,
    keycloakSession.includes("limit_except DELETE { deny all; }") &&
      keycloakSession.includes("if ($llmm_query_none = 0) { return 400; }") &&
      keycloakSession.includes(
        "include /etc/nginx/llm-machines/request-headers-keycloak-admin-browser.inc;",
      ),
    "Keycloak session invalidation identifier or method contract changed",
  )
  add(
    errors,
    nginx.includes("map $http_authorization $llmm_native_product_credential") &&
      nginx.includes('"~*^Bearer[ ]+llmm_(?:t4|fc)_" 1;') &&
      count(
        nginx,
        "if ($llmm_native_product_credential = 1) { return 400; }",
      ) === 3,
    "Console Application credentials are not rejected on every native host",
  )
  add(
    errors,
    count(
      nginx,
      'if ($http_cookie ~* "(?:^|;\\\\s*)__Host-llm-machines-(?:session|login)=") { return 400; }',
    ) === 4,
    "Console session cookies are not rejected on identity and native hosts",
  )
  for (const [label, server] of [
    ["Grafana", grafanaServer],
    ["LiteLLM", litellmServer],
    ["Keycloak Admin", keycloakAdminServer],
  ]) {
    add(
      errors,
      server.includes("location = /__llmm_native_unavailable") &&
        server.includes("internal;") &&
        server.includes("return 503") &&
        server.includes("error_page 502 503 504 =503"),
      `${label} controlled outage response changed`,
    )
  }
  const identityUnavailable = exactLocationSection(
    identityServer,
    "= /__llmm_identity_unavailable",
  )
  add(
    errors,
    count(
      identityServer,
      "error_page 502 503 504 =303 /__llmm_identity_unavailable?;",
    ) === 2 &&
      identityUnavailable.includes("internal;") &&
      identityUnavailable.includes(
        "return 303 https://@@PRODUCT_CONSOLE_HOST@@/auth/unavailable?returnTo=%2Fauth%2Fsignin;",
      ) &&
      !/\$(?:args|http_|request_uri|uri)\b/.test(identityUnavailable),
    "identity browser outage recovery changed",
  )
  add(
    errors,
    nginx.includes(
      '"~^[Bb][Aa][Ss][Ii][Cc][ ]+bGxtbS1hcHAt[A-Za-z0-9+/]{48}(?:O[g-v][AEIMQUYcgkosw048]=|O[g-v][A-Za-z0-9+/]{2}(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/][AQgw]==|[A-Za-z0-9+/]{2}[AEIMQUYcgkosw048]=)?)$" $http_authorization;',
    ) &&
      count(
        nginx,
        "proxy_set_header Authorization $llmm_application_client_authorization;",
      ) === 1 &&
      exactLocationSection(
        identityServer,
        "= /realms/llm-machines-applications/protocol/openid-connect/token",
      ).includes(
        "proxy_set_header Authorization $llmm_application_client_authorization;",
      ) &&
      exactLocationSection(
        identityServer,
        "= /realms/llm-machines-applications/protocol/openid-connect/token",
      ).includes(
        'if ($llmm_application_client_authorization = "") { return 401; }',
      ),
    "Application token Basic authentication forwarding changed",
  )
  for (const declaration of [
    "= /realms/llm-machines/protocol/openid-connect/token",
    "= /realms/llm-machines/protocol/openid-connect/revoke",
    "= /realms/llm-machines/protocol/openid-connect/certs",
    "= /realms/llm-machines-applications/protocol/openid-connect/certs",
  ]) {
    add(
      errors,
      exactLocationSection(identityServer, declaration).includes(
        'proxy_set_header Authorization "";',
      ),
      `unexpected Authorization forwarding on ${declaration}`,
    )
  }
  const identityToken = exactLocationSection(
    identityServer,
    "= /realms/llm-machines/protocol/openid-connect/token",
  )
  add(
    errors,
    nginx.includes("map $http_origin $llmm_identity_token_origin_allowed {") &&
      nginx.includes('"https://@@PRODUCT_KEYCLOAK_ADMIN_HOST@@" 1;') &&
      nginx.includes("map $http_origin $llmm_identity_token_origin {") &&
      nginx.includes(
        '"https://@@PRODUCT_KEYCLOAK_ADMIN_HOST@@" $http_origin;',
      ) &&
      identityToken.includes(
        "if ($llmm_identity_token_origin_allowed = 0) { return 403; }",
      ) &&
      identityToken.includes(
        "proxy_set_header Origin $llmm_identity_token_origin;",
      ) &&
      !identityToken.includes("proxy_set_header Origin $http_origin;"),
    "Keycloak Admin token Origin allowlist changed",
  )
  add(
    errors,
    count(nginx, 'if ($ssl_server_name = "") { return 421; }') === 7 &&
      count(nginx, "if ($http_host != $ssl_server_name) { return 421; }") === 7,
    "Host and SNI equality checks changed",
  )
  add(
    errors,
    count(nginx, "include /etc/nginx/llm-machines/request-safety.inc;") === 7,
    "raw-path safety is not applied to every public host",
  )
  for (const fixedProxy of [
    "http://console_bff/api/app-gateway/v1/models",
    "http://console_bff/api/app-gateway/v1/chat/completions",
    "http://console_bff/v2/search",
    "http://console_bff/v2/scrape",
    "http://keycloak_identity/realms/llm-machines/protocol/openid-connect/auth",
    "http://keycloak_identity/realms/llm-machines-applications/protocol/openid-connect/token",
    "http://keycloak_identity/realms/llm-machines-applications/protocol/openid-connect/certs",
  ]) {
    add(
      errors,
      nginx.includes(`proxy_pass ${fixedProxy};`),
      `missing ${fixedProxy}`,
    )
  }
  for (const proxyPass of nginx.matchAll(/proxy_pass\s+([^;]+);/g)) {
    add(
      errors,
      /^http:\/\/(?:console_web|console_bff|keycloak_identity|grafana_native|litellm_native)(?:\/[^$\s]*)?$/.test(
        proxyPass[1],
      ),
      `variable or unapproved proxy target ${proxyPass[1]}`,
    )
  }
  add(
    errors,
    !/server_name[^;]*(?:portainer|prometheus|alertmanager)/i.test(nginx),
    "unapproved native administration public hostname added",
  )
  add(
    errors,
    !/auth_request\s|proxy_set_header\s+Upgrade\s+\$|proxy_set_header\s+Connection\s+\$http_connection/i.test(
      nginx,
    ),
    "native impersonation or WebSocket forwarding added",
  )
  add(
    errors,
    nginx.includes(
      'if ($http_cookie ~* "(?:^|;\\\\s*)__Host-llm-machines-(?:session|login)=") { return 400; }',
    ),
    "identity host no longer rejects Console session cookies",
  )
  add(
    errors,
    proxyCommon.includes("proxy_pass_request_headers off;") &&
      proxyCommon.includes("proxy_request_buffering off;") &&
      proxyCommon.includes("proxy_buffering off;") &&
      proxyCommon.includes("proxy_cache off;") &&
      proxyCommon.includes("proxy_max_temp_file_size 0;") &&
      proxyCommon.includes("proxy_redirect off;"),
    "proxy content or redirect controls changed",
  )
  add(
    errors,
    !/proxy_hide_header\s+(?:Set-Cookie|Location)/i.test(
      `${nginx}\n${proxyCommon}`,
    ),
    "retained native cookie or redirect responses are suppressed",
  )
  const logFormat = nginx.match(
    /log_format\s+llmm_ingress_metadata[\s\S]*?;\n\s*access_log/,
  )?.[0]
  add(errors, Boolean(logFormat), "metadata log format is missing")
  add(
    errors,
    !/\$(?:request_uri|uri|args|query_string|request_body|http_|upstream_http_)/.test(
      logFormat ?? "",
    ),
    "ingress log contains target query body or arbitrary headers",
  )
  add(
    errors,
    nginx.includes("error_log /dev/null emerg;"),
    "request-context error logging was enabled",
  )
  add(
    errors,
    safety.includes('if ($request ~ "^[A-Z]+[ ]+https?://")') &&
      safety.includes("%2e|%2f|%3f|%23|%5c|%25") &&
      safety.includes("\\.\\.?") &&
      safety.includes("//|;"),
    "raw-path rejection set changed",
  )
}

function validateHeaders(sources, errors) {
  const common = sources["proxy-common.inc"] ?? ""
  const customer = sources["request-headers-customer-api.inc"] ?? ""
  const consoleBrowser = sources["request-headers-console-browser.inc"] ?? ""
  const identityBrowser = sources["request-headers-identity-browser.inc"] ?? ""
  const grafanaBrowser = sources["request-headers-grafana-browser.inc"] ?? ""
  const litellmBrowser = sources["request-headers-litellm-browser.inc"] ?? ""
  const keycloakAdminBrowser =
    sources["request-headers-keycloak-admin-browser.inc"] ?? ""
  for (const name of [
    "Forwarded",
    "X-Forwarded-Host",
    "X-Original-URL",
    "X-Rewrite-URL",
    "X-HTTP-Method-Override",
    "X-LLM-Machines-User-Sub",
    "X-LLM-Machines-Console-Session",
    "Upgrade",
  ]) {
    add(
      errors,
      common.includes(`proxy_set_header ${name} `),
      `missing ${name} reset`,
    )
  }
  add(
    errors,
    common.includes('proxy_set_header Upgrade "";') &&
      common.includes('proxy_set_header Connection "";'),
    "WebSocket Upgrade reset changed",
  )
  add(
    errors,
    customer.includes("proxy_set_header Authorization $http_authorization;") &&
      customer.includes('proxy_set_header Cookie "";') &&
      customer.includes('proxy_set_header Origin "";'),
    "customer API header profile changed",
  )
  add(
    errors,
    consoleBrowser.includes("proxy_set_header Cookie $http_cookie;") &&
      consoleBrowser.includes('proxy_set_header Authorization "";'),
    "Console browser header profile changed",
  )
  add(
    errors,
    identityBrowser.includes("proxy_set_header Cookie $http_cookie;") &&
      identityBrowser.includes('proxy_set_header Authorization "";') &&
      identityBrowser.includes(
        'proxy_set_header X-LLM-Machines-Console-Session "";',
      ),
    "identity browser header profile changed",
  )
  add(
    errors,
    grafanaBrowser.includes("proxy_set_header Cookie $http_cookie;") &&
      grafanaBrowser.includes('proxy_set_header Authorization "";') &&
      grafanaBrowser.includes("proxy_set_header Origin $http_origin;") &&
      grafanaBrowser.includes("proxy_set_header Referer $http_referer;") &&
      grafanaBrowser.includes(
        'proxy_set_header X-LLM-Machines-Console-Session "";',
      ),
    "Grafana browser header profile changed",
  )
  for (const [label, browser] of [
    ["LiteLLM", litellmBrowser],
    ["Keycloak Admin", keycloakAdminBrowser],
  ]) {
    add(
      errors,
      browser.includes("proxy_set_header Cookie $http_cookie;") &&
        browser.includes(
          "proxy_set_header Authorization $http_authorization;",
        ) &&
        browser.includes("proxy_set_header Origin $http_origin;") &&
        browser.includes("proxy_set_header Referer $http_referer;") &&
        browser.includes('proxy_set_header X-LLM-Machines-Console-Session "";'),
      `${label} browser header profile changed`,
    )
  }
  add(
    errors,
    keycloakAdminBrowser.includes(
      "proxy_set_header X-Forwarded-Prefix /keycloak;",
    ) && !identityBrowser.includes("X-Forwarded-Prefix /keycloak"),
    "Keycloak external admin prefix header changed",
  )
}

function validateCredentialSafety(sources, errors) {
  const combined = Object.entries(sources)
    .map(([name, value]) => `FILE ${name}\n${value}`)
    .join("\n")
  for (const [pattern, label] of [
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "private key"],
    [/\bAKIA[0-9A-Z]{16}\b/, "AWS access key"],
    [/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/, "GitHub credential"],
    [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/, "GitHub credential"],
    [
      /\b(?:password|secret|token)\s*[:=]\s*["'][^@\n"']{12,}["']/i,
      "inline credential",
    ],
  ]) {
    add(errors, !pattern.test(combined), `ingress package contains ${label}`)
  }
}

export function validateIngressPackage(root = repositoryRoot) {
  const ingressDirectory = resolve(root, "infra/ingress")
  const actualFiles = readdirSync(ingressDirectory)
    .filter((name) => !name.startsWith("."))
    .sort()
  const errors = []
  add(
    errors,
    sameJson(actualFiles, [...expectedFiles].sort()),
    "ingress package file set changed",
  )
  const sources = Object.fromEntries(
    expectedFiles.map((name) => [
      name,
      readFileSync(resolve(ingressDirectory, name), "utf8"),
    ]),
  )
  errors.push(...validateIngressSources(sources))
  const firecrawlCompose = readFileSync(
    resolve(root, "infra/firecrawl/compose.yaml"),
    "utf8",
  )
  add(
    errors,
    !/^ {4}(?:ports|network_mode):/m.test(firecrawlCompose),
    "Firecrawl exposes a host port or host network",
  )
  return errors
}

function parseJson(source, label, errors) {
  try {
    return JSON.parse(source)
  } catch {
    errors.push(`${label} is not valid JSON`)
    return null
  }
}

function add(errors, condition, message) {
  if (!condition) {
    errors.push(message)
  }
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function count(source, value) {
  return source.split(value).length - 1
}

function sha256(source) {
  return createHash("sha256").update(source).digest("hex")
}

function hostServerSection(source, host, nextHost) {
  const start = source.indexOf(`server_name ${host};`)
  if (start < 0) {
    return ""
  }
  const end = nextHost
    ? source.indexOf(`server_name ${nextHost};`, start + host.length)
    : source.length
  return source.slice(start, end < 0 ? source.length : end)
}

function locationDeclarations(server) {
  return [...server.matchAll(/^\s*location\s+(.+)\s+\{/gm)].map(
    (match) => match[1],
  )
}

function exactLocationSection(server, declaration) {
  const start = server.indexOf(`location ${declaration} {`)
  if (start < 0) {
    return ""
  }
  const next = server.indexOf("\n    location ", start + declaration.length)
  return server.slice(start, next < 0 ? server.length : next)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const errors = validateIngressPackage()
  if (errors.length > 0) {
    for (const error of errors) {
      process.stderr.write(`${error}\n`)
    }
    process.exitCode = 1
  } else {
    process.stdout.write("Product edge source policy passed\n")
  }
}
