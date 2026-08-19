import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import {
  assertIdentityAuthorityBinding,
  identityJwksFingerprint,
  sanitizedIdentityUrl,
  validateKeycloakCommissioning,
} from "../pre-genesis/keycloak-commissioning-readiness.mjs"
import {
  inspectLiteLlmOssRuntimeImage,
  loadCoreImageInventoryAtHead,
  loadLiteLlmOssRuntimeContract,
} from "../pre-genesis/litellm-oss-runtime-contract.mjs"

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)))
const read = (path) => readFileSync(resolve(root, path), "utf8")

test("VM103 startup retries only empty successful Docker image reads", () => {
  const runtime = loadLiteLlmOssRuntimeContract(root)
  const valid = JSON.stringify([
    {
      Architecture: "amd64",
      Config: {
        Labels: {
          "org.opencontainers.image.licenses": "MIT",
          "org.opencontainers.image.revision": runtime.sourceRevision,
          "org.opencontainers.image.title": "LiteLLM OSS Downstream",
          "org.opencontainers.image.version": runtime.version,
        },
      },
      Id: runtime.image,
      Os: "linux",
    },
  ])
  const outputs = ["", "  ", valid]
  let calls = 0
  const inspection = inspectLiteLlmOssRuntimeImage(() => {
    calls += 1
    return { status: 0, stdout: outputs.shift() }
  }, runtime.image)
  assert.equal(inspection.Id, runtime.image)
  assert.equal(calls, 3)

  assert.throws(
    () =>
      inspectLiteLlmOssRuntimeImage(
        () => ({ status: 1, stdout: valid }),
        runtime.image,
      ),
    /inspection failed/,
  )
  assert.throws(
    () =>
      inspectLiteLlmOssRuntimeImage(
        () => ({ status: 0, stdout: "{" }),
        runtime.image,
      ),
    /malformed JSON/,
  )
  assert.throws(
    () =>
      inspectLiteLlmOssRuntimeImage(
        () => ({ status: 0, stdout: "[]" }),
        runtime.image,
      ),
    /must return one image/,
  )
})

test("VM103 startup reads the Core inventory with exact Git trust and shape", () => {
  const calls = []
  const inventoryText = JSON.stringify({ components: [{ id: "litellm" }] })
  const inventory = loadCoreImageInventoryAtHead((arguments_, options) => {
    calls.push({ arguments_, options })
    return { status: 0, stdout: calls.length < 3 ? "" : inventoryText }
  }, root)
  assert.deepEqual(inventory, { components: [{ id: "litellm" }] })
  assert.deepEqual(calls[0].arguments_, [
    "-c",
    `safe.directory=${root}`,
    "show",
    "HEAD:infra/release/core-image-inventory.json",
  ])
  assert.equal(calls[0].options.cwd, root)

  assert.throws(
    () =>
      loadCoreImageInventoryAtHead(
        () => ({ status: 128, stdout: inventoryText }),
        root,
      ),
    /Git read failed/,
  )
  assert.throws(
    () =>
      loadCoreImageInventoryAtHead(() => ({ status: 0, stdout: "{}" }), root),
    /invalid inventory/,
  )

  const actual = loadCoreImageInventoryAtHead(
    (arguments_, options) => spawnSync("git", arguments_, options),
    root,
  )
  assert.ok(actual.components.some(({ id }) => id === "litellm"))
})

test("VM103 identity readiness validates commissioning without secrets", () => {
  const commissioning = {
    browserProof: "AUTHORIZATION_CODE_PKCE_PENDING",
    status: "COMMISSIONED",
    users: {
      admin: commissionedUser("Admins", "admin"),
      operator: commissionedUser("Operators", "operator"),
    },
  }
  assert.equal(validateKeycloakCommissioning(commissioning), commissioning)

  assert.throws(
    () =>
      validateKeycloakCommissioning({
        ...commissioning,
        users: {
          ...commissioning.users,
          admin: { ...commissioning.users.admin, requiredActions: 1 },
        },
      }),
    /admin commissioning metadata is invalid/,
  )
})

test("VM103 identity readiness rejects a legacy public authority before login", () => {
  const candidate = { keys: [{ kid: "candidate", kty: "RSA", n: "a" }] }
  const sameCandidate = {
    keys: [{ n: "a", kty: "RSA", kid: "candidate" }],
  }
  const legacy = { keys: [{ kid: "legacy", kty: "RSA", n: "b" }] }
  assert.equal(
    identityJwksFingerprint(candidate),
    identityJwksFingerprint(sameCandidate),
  )
  assert.equal(
    assertIdentityAuthorityBinding({
      candidateJwks: candidate,
      publicJwks: sameCandidate,
    }).status,
    "MATCHED_BEFORE_BROWSER_CREDENTIALS",
  )
  assert.throws(
    () =>
      assertIdentityAuthorityBinding({
        candidateJwks: candidate,
        publicJwks: legacy,
      }),
    /public identity authority is not routed/,
  )
})

test("VM103 identity failure evidence redacts every query value", () => {
  const sensitiveValues = ["code-value", "execution-value", "session-value"]
  const sanitized = sanitizedIdentityUrl(
    `https://identity.example/callback?code=${sensitiveValues[0]}&execution=${sensitiveValues[1]}&session_code=${sensitiveValues[2]}`,
  )
  for (const value of sensitiveValues)
    assert.equal(sanitized.includes(value), false)
  assert.equal(new URL(sanitized).searchParams.get("code"), "[redacted]")
  assert.equal(new URL(sanitized).searchParams.get("execution"), "[redacted]")
  assert.equal(
    new URL(sanitized).searchParams.get("session_code"),
    "[redacted]",
  )
})

test("VM103 placed startup binds identity before browser credentials", () => {
  const browser = read("scripts/pre-genesis/reduced-core-browser-session.mjs")
  const keycloak = read(
    "scripts/pre-genesis/reduced-core-keycloak-identity.mjs",
  )
  const runbook = read("docs/reduction/inference-core/founder-uat-runbook.md")

  const binding = browser.indexOf(
    "const identityAuthorityBinding = await proveIdentityAuthorityBinding",
  )
  const launch = browser.indexOf("browser = await chromium.launch")
  assert.ok(binding >= 0)
  assert.ok(launch > binding)
  assert.match(browser, /candidateIdentityEvents=/)
  assert.match(browser, /sanitizedIdentityUrl\(page\.url\(\)\)/)
  assert.match(browser, /identityCommissioning: keycloakControl\.commissioning/)
  assert.match(keycloak, /startupStage = "COMMISSIONING_IDENTITIES"/)
  assert.match(keycloak, /credentials\.admin\.username/)
  assert.match(keycloak, /credentials\.operator\.username/)
  assert.match(runbook, /fails before submitting a browser credential/)
})

function commissionedUser(group, realmRole) {
  return {
    emailVerified: true,
    enabled: true,
    group,
    passwordCredentialPresent: true,
    realmRole,
    requiredActions: 0,
  }
}
