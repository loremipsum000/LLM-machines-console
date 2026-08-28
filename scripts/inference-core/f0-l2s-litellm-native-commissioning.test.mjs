import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"
import {
  commissionLiteLlmNativeUsers,
  loadLiteLlmNativeCommissioningContract,
  validateLiteLlmNativeCommissioningContract,
  validateLiteLlmNativeUsers,
} from "../pre-genesis/litellm-native-commissioning.mjs"

const root = resolve(import.meta.dirname, "../..")
const masterKey = `sk-${"a".repeat(32)}`
const users = [
  {
    email: "admin@example.com",
    productRole: "Admin",
    subject: "11111111-1111-4111-8111-111111111111",
  },
  {
    email: "operator@example.com",
    productRole: "Operator",
    subject: "22222222-2222-4222-8222-222222222222",
  },
]

test("F0-L2S binds native users to Keycloak subjects and admitted roles", () => {
  const contract = loadLiteLlmNativeCommissioningContract(root)
  assert.equal(contract.identity.immutableUserIdClaim, "sub")
  assert.deepEqual(contract.identity.roles, {
    Admin: "proxy_admin",
    Operator: "internal_user",
  })
  assert.equal(contract.identity.maximumBillableUsers, 5)
  assert.equal(contract.commissioning.humanCredential, false)
  assert.equal(contract.commissioning.autoCreateVirtualKey, false)
  assert.equal(contract.commissioning.automaticDeletion, false)
  assert.equal(contract.activation, "INACTIVE_PENDING_F0_N7")

  const runtime = readFileSync(
    resolve(root, "scripts/pre-genesis/litellm-oss-characterization.mjs"),
    "utf8",
  )
  const browser = readFileSync(
    resolve(
      root,
      "scripts/pre-genesis/litellm-oss-browser-characterization.mjs",
    ),
    "utf8",
  )
  assert.match(runtime, /GENERIC_USER_ID_ATTRIBUTE=sub/)
  assert.match(runtime, /id: subject/)
  assert.match(runtime, /commissionLiteLlmNativeUsers/)
  assert.match(runtime, /validateLiteLlmOssRuntimeInspection/)
  assert.match(runtime, /sudo", \["-n", "chown", "1000:0"/)
  assert.match(runtime, /sudo", \["-n", "chmod", "0400"/)
  assert.match(browser, /claims\.user_id, state\.identities\.admin/)
  assert.match(browser, /\/usr\/bin\/chromium/)
  assert.doesNotMatch(runtime, /user_id: userId/)
})

test("F0-L2S commissions users idempotently without returning credentials", async () => {
  const rows = new Map()
  const calls = []
  const request = async ({ body, masterKey: observedKey, method, path }) => {
    assert.equal(observedKey, masterKey)
    calls.push({ body, method, path })
    if (path.startsWith("/user/list?")) {
      const userId = new URL(`http://litellm${path}`).searchParams.get(
        "user_ids",
      )
      return {
        body: { users: rows.has(userId) ? [rows.get(userId)] : [] },
        status: 200,
      }
    }
    if (path === "/user/new") {
      assert.equal(body.auto_create_key, false)
      rows.set(body.user_id, { ...body })
      return { body: { user_id: body.user_id }, status: 200 }
    }
    if (path === "/user/update") {
      rows.set(body.user_id, { ...rows.get(body.user_id), ...body })
      return { body: { user_id: body.user_id }, status: 200 }
    }
    if (path === "/update/ui_settings")
      return { body: { status: "success" }, status: 200 }
    throw new Error(`unexpected request ${method} ${path}`)
  }

  const first = await commissionLiteLlmNativeUsers({
    baseUrl: "http://litellm:4000",
    masterKey,
    request,
    users,
  })
  const second = await commissionLiteLlmNativeUsers({
    baseUrl: "http://litellm:4000",
    masterKey,
    request,
    users,
  })

  assert.deepEqual(first, {
    created: 2,
    credentialMaterialReturned: false,
    immutableUserIdClaim: "sub",
    unchanged: 0,
    updated: 0,
    users: 2,
  })
  assert.deepEqual(second, {
    created: 0,
    credentialMaterialReturned: false,
    immutableUserIdClaim: "sub",
    unchanged: 2,
    updated: 0,
    users: 2,
  })
  assert.equal(calls.filter(({ path }) => path === "/user/new").length, 2)
  assert.equal(calls.filter(({ path }) => path === "/user/update").length, 0)
  assert.equal(
    calls.filter(({ path }) => path === "/update/ui_settings").length,
    2,
  )
})

test("F0-L2S reconciles role drift without deleting users", async () => {
  const row = {
    sso_user_id: users[1].subject,
    user_email: users[1].email,
    user_id: users[1].subject,
    user_role: "proxy_admin",
  }
  const calls = []
  const request = async ({ body, method, path }) => {
    calls.push({ body, method, path })
    if (path.startsWith("/user/list?"))
      return { body: { users: [row] }, status: 200 }
    return { body: {}, status: 200 }
  }
  const result = await commissionLiteLlmNativeUsers({
    baseUrl: "http://127.0.0.1:4000",
    masterKey,
    request,
    users: [users[1]],
  })
  assert.equal(result.updated, 1)
  assert.deepEqual(calls.find(({ path }) => path === "/user/update")?.body, {
    sso_user_id: users[1].subject,
    user_email: users[1].email,
    user_id: users[1].subject,
    user_role: "internal_user",
  })
  assert.equal(
    calls.some(({ path }) => /delete/i.test(path)),
    false,
  )
})

test("F0-L2S rejects invalid users, public URLs, and drifted contracts", async () => {
  assert.throws(() => validateLiteLlmNativeUsers([...users, ...users]))
  assert.throws(() =>
    validateLiteLlmNativeUsers([{ ...users[0], productRole: "Owner" }]),
  )
  assert.throws(() =>
    validateLiteLlmNativeUsers([{ ...users[0], subject: "short" }]),
  )
  await assert.rejects(() =>
    commissionLiteLlmNativeUsers({
      baseUrl: "https://litellm.example.com",
      masterKey,
      request: async () => ({ body: {}, status: 200 }),
      users,
    }),
  )
  await assert.rejects(() =>
    commissionLiteLlmNativeUsers({
      baseUrl: "http://unreviewed-service:4000",
      masterKey,
      request: async () => ({ body: {}, status: 200 }),
      users,
    }),
  )
  const contract = loadLiteLlmNativeCommissioningContract(root)
  for (const mutate of [
    (candidate) => {
      candidate.identity.immutableUserIdClaim = "preferred_username"
    },
    (candidate) => {
      candidate.identity.roles.Operator = "proxy_admin"
    },
    (candidate) => {
      candidate.commissioning.humanCredential = true
    },
    (candidate) => {
      candidate.commissioning.automaticDeletion = true
    },
    (candidate) => {
      candidate.operatorUi.chatUi = true
    },
  ]) {
    const candidate = structuredClone(contract)
    mutate(candidate)
    assert.throws(() => validateLiteLlmNativeCommissioningContract(candidate))
  }
})
