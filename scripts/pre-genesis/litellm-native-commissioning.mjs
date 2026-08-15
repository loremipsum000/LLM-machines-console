import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const contractPath = "infra/litellm/native-user-commissioning.json"
const roles = Object.freeze({ Admin: "proxy_admin", Operator: "internal_user" })

export function loadLiteLlmNativeCommissioningContract(repositoryRoot) {
  return validateLiteLlmNativeCommissioningContract(
    JSON.parse(readFileSync(resolve(repositoryRoot, contractPath), "utf8")),
  )
}

export function validateLiteLlmNativeCommissioningContract(contract) {
  requireEqual(
    contract?.schema,
    "llm-machines.litellm-native-user-commissioning.v1",
    "schema",
  )
  requireEqual(contract?.activation, "INACTIVE_PENDING_F0_N7", "activation")
  requireEqual(contract?.identity?.immutableUserIdClaim, "sub", "user ID claim")
  requireEqual(contract?.identity?.roleClaim, "litellm_role", "role claim")
  requireEqual(
    JSON.stringify(contract?.identity?.roles),
    JSON.stringify(roles),
    "role mapping",
  )
  requireEqual(
    contract?.identity?.maximumBillableUsers,
    5,
    "billable user limit",
  )
  requireEqual(contract?.commissioning?.idempotent, true, "idempotence")
  requireEqual(
    contract?.commissioning?.automaticDeletion,
    false,
    "automatic deletion",
  )
  requireEqual(
    contract?.commissioning?.autoCreateVirtualKey,
    false,
    "automatic virtual-key creation",
  )
  requireEqual(
    contract?.commissioning?.humanCredential,
    false,
    "human credential use",
  )
  requireEqual(
    JSON.stringify(contract?.operatorUi?.enabledPages),
    JSON.stringify(["api-keys", "new_usage"]),
    "Operator UI pages",
  )
  requireEqual(contract?.operatorUi?.chatUi, false, "native chat UI")
  for (const field of [
    "masterSecretInGit",
    "masterSecretInEvidence",
    "masterSecretAsHumanCredential",
    "credentialValuesInLogs",
  ])
    requireEqual(contract?.custody?.[field], false, field)
  return Object.freeze(structuredClone(contract))
}

export function validateLiteLlmNativeUsers(users, maximum = 5) {
  if (!Array.isArray(users) || users.length < 1 || users.length > maximum)
    throw new Error(`LiteLLM native users must contain 1 to ${maximum} entries`)
  const subjects = new Set()
  const emails = new Set()
  return users.map((user) => {
    if (!isOpaqueSubject(user?.subject))
      throw new Error("LiteLLM native user subject is invalid")
    if (!isEmail(user?.email))
      throw new Error("LiteLLM native user email is invalid")
    if (!Object.hasOwn(roles, user?.productRole))
      throw new Error("LiteLLM native user Product role is invalid")
    if (subjects.has(user.subject) || emails.has(user.email.toLowerCase()))
      throw new Error("LiteLLM native users must be unique")
    subjects.add(user.subject)
    emails.add(user.email.toLowerCase())
    return Object.freeze({
      email: user.email,
      liteLlmRole: roles[user.productRole],
      productRole: user.productRole,
      subject: user.subject,
    })
  })
}

export async function commissionLiteLlmNativeUsers({
  baseUrl,
  masterKey,
  request = requestJson,
  users,
}) {
  const parsedBase = validatePrivateBaseUrl(baseUrl)
  validateMasterKey(masterKey)
  const admittedUsers = validateLiteLlmNativeUsers(users)
  let created = 0
  let unchanged = 0
  let updated = 0

  for (const user of admittedUsers) {
    const query = new URLSearchParams({
      page: "1",
      page_size: "5",
      user_ids: user.subject,
    })
    const listed = await call(request, {
      baseUrl: parsedBase,
      masterKey,
      method: "GET",
      path: `/user/list?${query}`,
    })
    const existing = listUsers(listed).find(
      ({ user_id: userId }) => userId === user.subject,
    )
    if (!existing) {
      await call(request, {
        baseUrl: parsedBase,
        body: {
          auto_create_key: false,
          send_invite_email: false,
          sso_user_id: user.subject,
          user_email: user.email,
          user_id: user.subject,
          user_role: user.liteLlmRole,
        },
        masterKey,
        method: "POST",
        path: "/user/new",
      })
      created += 1
    } else if (
      existing.user_email !== user.email ||
      existing.user_role !== user.liteLlmRole ||
      existing.sso_user_id !== user.subject
    ) {
      await call(request, {
        baseUrl: parsedBase,
        body: {
          sso_user_id: user.subject,
          user_email: user.email,
          user_id: user.subject,
          user_role: user.liteLlmRole,
        },
        masterKey,
        method: "POST",
        path: "/user/update",
      })
      updated += 1
    } else unchanged += 1
  }

  await call(request, {
    baseUrl: parsedBase,
    body: {
      enabled_ui_pages_internal_users: ["api-keys", "new_usage"],
      enable_chat_ui: false,
    },
    masterKey,
    method: "PATCH",
    path: "/update/ui_settings",
  })

  return Object.freeze({
    created,
    credentialMaterialReturned: false,
    immutableUserIdClaim: "sub",
    unchanged,
    updated,
    users: admittedUsers.length,
  })
}

async function call(request, options) {
  const response = await request(options)
  if (response?.status < 200 || response?.status >= 300)
    throw new Error(
      `LiteLLM native commissioning ${options.method} ${options.path.split("?")[0]} failed with ${response?.status ?? "unknown"}`,
    )
  return response.body
}

async function requestJson({ baseUrl, body, masterKey, method, path }) {
  const response = await fetch(new URL(path, baseUrl), {
    body: body ? JSON.stringify(body) : undefined,
    headers: {
      authorization: `Bearer ${masterKey}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    method,
  })
  let parsed = null
  try {
    parsed = await response.json()
  } catch {}
  return { body: parsed, status: response.status }
}

function listUsers(body) {
  if (Array.isArray(body?.users)) return body.users
  if (Array.isArray(body)) return body
  return []
}

function validatePrivateBaseUrl(value) {
  const parsed = new URL(value)
  if (parsed.protocol !== "http:" || parsed.username || parsed.password)
    throw new Error(
      "LiteLLM commissioning requires a credential-free private HTTP URL",
    )
  const hostname = parsed.hostname
  const privateIpv4 =
    /^10\./.test(hostname) ||
    /^192\.168\./.test(hostname) ||
    /^172\.(?:1[6-9]|2\d|3[01])\./.test(hostname) ||
    /^127\./.test(hostname)
  const privateName = hostname === "localhost" || hostname === "litellm"
  if (
    !privateIpv4 &&
    !privateName &&
    hostname !== "[::1]" &&
    hostname !== "::1"
  )
    throw new Error("LiteLLM commissioning URL must remain private")
  parsed.pathname = parsed.pathname.endsWith("/")
    ? parsed.pathname
    : `${parsed.pathname}/`
  return parsed
}

function validateMasterKey(value) {
  if (!/^sk-[A-Za-z0-9_-]{16,}$/.test(value ?? ""))
    throw new Error("LiteLLM commissioning master key is invalid")
}

function isOpaqueSubject(value) {
  return (
    typeof value === "string" &&
    value.length >= 8 &&
    value.length <= 255 &&
    !/\s/.test(value) &&
    !containsControlCharacter(value)
  )
}

function containsControlCharacter(value) {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0)
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)
  })
}

function isEmail(value) {
  return (
    typeof value === "string" &&
    value.length <= 320 &&
    /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)
  )
}

function requireEqual(actual, expected, field) {
  if (actual !== expected)
    throw new Error(`LiteLLM native commissioning ${field} is invalid`)
}
