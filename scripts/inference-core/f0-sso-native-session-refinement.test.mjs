import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import test from "node:test"

const root = resolve(import.meta.dirname, "../..")

test("retained native tools enter their own sessions through existing Keycloak SSO", async () => {
  const [grafana, integratedRuntime, liteLlm, nativeRuntime] =
    await Promise.all([
      read("infra/observability/grafana/grafana.ini"),
      read("scripts/pre-genesis/reduced-core-integrated.mjs"),
      read("scripts/pre-genesis/reduced-core-litellm-integration.mjs"),
      read("scripts/pre-genesis/f0-n7-native-runtime.mjs"),
    ])

  assert.match(grafana, /^disable_login_form = true$/m)
  assert.match(grafana, /^auto_login = true$/m)
  assert.match(liteLlm, /"AUTO_REDIRECT_UI_LOGIN_TO_SSO=true"/)
  assert.doesNotMatch(liteLlm, /"AUTO_REDIRECT_UI_LOGIN_TO_SSO=false"/)
  assert.match(nativeRuntime, /"AUTO_REDIRECT_UI_LOGIN_TO_SSO=true"/)
  assert.match(
    nativeRuntime,
    /LLMM_GRAFANA_SIGNOUT_REDIRECT_URL=\$\{origins\.litellm}\/__llmm\/global-logout/,
  )
  assert.match(
    integratedRuntime,
    /LLMM_GRAFANA_SIGNOUT_REDIRECT_URL=\$\{authorityOrigin\(founderUatPlacement, "litellm", edgePort\)}\/__llmm\/global-logout/,
  )
})

test("LiteLLM customer ingress has no password-login surface and accepts only its safe SSO return", async () => {
  const edge = await read("infra/ingress/product-edge.nginx.conf.template")

  assert.match(edge, /location ~ \^\/ui\/login\/\?\$/)
  assert.match(
    edge,
    /return 303 https:\/\/@@PRODUCT_LITELLM_HOST@@\/sso\/key\/generate\?return_to=https%3A%2F%2F@@PRODUCT_LITELLM_HOST@@%2Fui%2F;/,
  )
  assert.match(
    edge,
    /"return_to=https%3A%2F%2F@@PRODUCT_LITELLM_HOST@@%2Fui%2F" 1;/,
  )
  assert.match(
    edge,
    /"return_to=https%3A%2F%2F@@PRODUCT_LITELLM_HOST@@%2Fui%2Flogin%2F" 1;/,
  )
  assert.match(edge, /~\^_rsc=\[A-Za-z0-9_-\]\{1,128\}\$ 1;/)
  assert.doesNotMatch(edge, /~\*\^return_to=/)
})

test("Console sign-out uses a fixed credential-free native logout chain", async () => {
  const [edge, fixture, route, runtime, service, shell] = await Promise.all([
    read("infra/ingress/product-edge.nginx.conf.template"),
    read("scripts/pre-genesis/reduced-core-session-bff-fixture.mts"),
    read("apps/bff/src/routes/console-session.ts"),
    read("apps/bff/src/services/console-session-runtime.ts"),
    read("apps/bff/src/services/console-session-service.ts"),
    read("apps/web/src/components/console-v2/console-v2-shell.tsx"),
  ])

  assert.match(route, /await options\.service\.globalLogout\(sessionHandle\)/)
  assert.match(route, /return reply\.redirect\(nativeLogoutStartUrl, 303\)/)
  assert.match(service, /await this\.oidc\.endSession\(refreshToken\)/)
  assert.match(fixture, /logoutEndpoint: `\$\{oidcBase}\/logout`/)
  assert.match(fixture, /endSession: rawOidc\.endSession/)
  assert.match(fixture, /nativeLogoutStartUrl: `\$\{grafanaOrigin}\/logout`/)
  assert.match(
    await read("scripts/pre-genesis/reduced-core-browser-session.mjs"),
    /F0_S1_GRAFANA_ORIGIN: publicOrigin\("grafana", edgePort\)/,
  )
  assert.match(shell, /fetch\("\/api\/console\/session\/logout"/)
  assert.match(shell, /headers: \{ accept: "application\/json" \}/)
  assert.match(shell, /action="\/api\/console\/session\/logout"/)

  assert.match(
    runtime,
    /nativeLogoutStartUrl: `https:\/\/\$\{grafanaHost}\/logout`/,
  )
  for (const hop of [
    "https://@@PRODUCT_LITELLM_HOST@@/__llmm/global-logout",
    "https://@@PRODUCT_IDENTITY_HOST@@/__llmm/global-logout",
    "https://@@PRODUCT_CONSOLE_HOST@@/auth/signin",
  ]) {
    assert.match(edge, new RegExp(escapeRegExp(`return 303 ${hop};`)))
  }
  assert.match(
    edge,
    /location = \/logout[\s\S]*?proxy_pass http:\/\/grafana_native;/,
  )
  assert.match(
    edge,
    /location @grafana_global_logout_fallback[\s\S]*?return 303 https:\/\/@@PRODUCT_LITELLM_HOST@@\/__llmm\/global-logout;/,
  )
  assert.doesNotMatch(
    edge
      .match(/location = \/__llmm\/global-logout[\s\S]*?\n {4}}/g)
      ?.join("\n") ?? "",
    /\$(?:http_authorization|http_cookie)|id_token_hint|access_token|refresh_token/,
  )
})

async function read(path) {
  return readFile(resolve(root, path), "utf8")
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
