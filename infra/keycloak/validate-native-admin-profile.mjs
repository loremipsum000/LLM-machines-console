import { createHash } from "node:crypto"
import { readFileSync, readdirSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const directory = dirname(fileURLToPath(import.meta.url))
const exactImage =
  "quay.io/keycloak/keycloak:26.7.0@sha256:0f198be292568439d700cdbfb893e69a6009bb43a94a06a945b1d3d506c76b13"
const exactPlatformManifest =
  "sha256:26939e1318d6f008fc2ee6e10cec1cf8f1ba8a21846c1bc81b91ed0506bc2a7a"
const forbiddenRoles = new Set([
  "create-client",
  "impersonation",
  "manage-clients",
  "manage-identity-providers",
  "manage-realm",
  "manage-users",
  "query-clients",
  "query-realms",
  "realm-admin",
  "view-clients",
  "view-identity-providers",
  "view-realm",
  "view-users",
])

export function readNativeAdminProfile(root = directory) {
  return JSON.parse(
    readFileSync(resolve(root, "native-admin-profile.json"), "utf8"),
  )
}

export function readNativeAdminRealmSeed(root = directory) {
  return JSON.parse(
    readFileSync(resolve(root, "inference-core-realm-seed.json"), "utf8"),
  )
}

export function validateNativeAdminProfile(profile, seed) {
  const errors = []
  if (profile?.runtime?.version !== "26.7.0") {
    errors.push("native Keycloak version must be 26.7.0")
  }
  if (profile?.runtime?.image !== exactImage) {
    errors.push("native Keycloak image must use the exact admitted index")
  }
  if (profile?.runtime?.platformManifest !== exactPlatformManifest) {
    errors.push("native Keycloak linux/amd64 manifest is not exact")
  }
  if (
    profile?.status !== "SOURCE_CHARACTERIZATION_ONLY" ||
    profile?.activation !== "INACTIVE_PENDING_F0_N5" ||
    profile?.runtimeQualified !== false
  ) {
    errors.push("native Keycloak access must remain inactive and unqualified")
  }
  if (
    profile?.authority?.adminConsolePath !==
      "/keycloak/admin/llm-machines/console/" ||
    profile?.authority?.realm !== "llm-machines" ||
    profile?.authority?.masterRealm !== false ||
    profile?.authority?.directPortCustomerExposure !== false
  ) {
    errors.push("native Keycloak authority or realm boundary is invalid")
  }
  const authentication = profile?.authentication ?? {}
  if (
    authentication.loginTheme !== "llm-machines" ||
    authentication.passwordOnlyPreGenesis !== true ||
    authentication.mandatoryTotp !== false ||
    authentication.authorizationCode !== true ||
    authentication.pkce !== "S256" ||
    authentication.consoleSessionForwarded !== false ||
    authentication.sharedHumanAccounts !== false ||
    authentication.reverseProxyImpersonation !== false ||
    authentication.nativeSessionRequired !== true ||
    authentication.idleSeconds !== 28_800 ||
    authentication.maximumSeconds !== 86_400 ||
    authentication.refreshTokenRotation !== true ||
    authentication.refreshTokenMaxReuse !== 0
  ) {
    errors.push("native Keycloak authentication or session profile is invalid")
  }
  const theme = profile?.theme ?? {}
  const themeInventory = themeInventoryHash(
    resolve(directory, "themes/llm-machines"),
  )
  if (
    theme.name !== "llm-machines" ||
    theme.sourcePath !== "infra/keycloak/themes/llm-machines" ||
    theme.fileCount !== themeInventory.fileCount ||
    theme.inventorySha256 !== themeInventory.sha256 ||
    theme.credentialMaterial !== false
  ) {
    errors.push("LLM Machines Keycloak theme inventory is not exact")
  }
  if (
    profile?.customerRoles?.Admin !== "SCOPED_APPLIANCE_REALM_ADMIN" ||
    profile?.customerRoles?.Operator !== "DENY" ||
    profile?.customerRoles?.other !== "DENY"
  ) {
    errors.push("native Keycloak role boundary is invalid")
  }
  const adminRoles = profile?.realmManagementRoles?.Admin ?? []
  if (
    JSON.stringify([...adminRoles].sort()) !==
    JSON.stringify(["query-groups", "query-users"])
  ) {
    errors.push("Admin realm-management roles are not least privilege")
  }
  for (const role of adminRoles) {
    if (forbiddenRoles.has(role)) {
      errors.push(`forbidden realm-management role is active: ${role}`)
    }
  }
  if ((profile?.realmManagementRoles?.Operator ?? []).length !== 0) {
    errors.push("Operator must have no native Keycloak administration role")
  }
  const permissions = profile?.fineGrainedAdminPermissionsV2?.permissions ?? []
  const users = permissions.find(({ resourceType }) => resourceType === "Users")
  const groups = permissions.find(
    ({ resourceType }) => resourceType === "Groups",
  )
  if (
    JSON.stringify([...(users?.scopes ?? [])].sort()) !==
      JSON.stringify(["manage", "view"]) ||
    users?.resources !== "ALL_APPLIANCE_REALM_USERS"
  ) {
    errors.push("Users FGAP permission is not the exact supported minimum")
  }
  if (
    JSON.stringify([...(groups?.scopes ?? [])].sort()) !==
      JSON.stringify(["view", "view-members"]) ||
    JSON.stringify([...(groups?.resources ?? [])].sort()) !==
      JSON.stringify(["group:Admins", "group:Operators"])
  ) {
    errors.push("Groups FGAP permission exceeds canonical read-only access")
  }
  const deleteControl = profile?.layeredDeleteControl ?? {}
  if (
    deleteControl.effectiveOnlyBehindProductEdge !== true ||
    deleteControl.activationFailClosed !== true ||
    deleteControl.requiredF0N5Denial?.method !== "DELETE" ||
    deleteControl.requiredF0N5Denial?.pathPattern !==
      "^/keycloak/admin/realms/llm-machines/users/[0-9a-f-]{36}$" ||
    deleteControl.requiredF0N5Denial?.expectedStatus !== 403
  ) {
    errors.push("Keycloak Users/manage deletion residual is not fail-closed")
  }
  const seedRoles = seed?.roles?.find(({ name }) => name === "admin")
    ?.clientRoleMappings?.["realm-management"]
  if (
    JSON.stringify([...(seedRoles ?? [])].sort()) !==
    JSON.stringify(["query-groups", "query-users"])
  ) {
    errors.push("realm seed Admin roles differ from the native profile")
  }
  if (
    seed?.realm?.name !== "llm-machines" ||
    seed?.realm?.masterRealm !== false ||
    seed?.realm?.loginTheme !== "llm-machines" ||
    seed?.realm?.ssoSessionIdleSeconds !== 28_800 ||
    seed?.realm?.ssoSessionMaxSeconds !== 86_400
  ) {
    errors.push("realm seed differs from the native identity profile")
  }
  return errors.sort()
}

function themeInventoryHash(root) {
  const files = []
  const pending = [root]
  while (pending.length > 0) {
    const current = pending.pop()
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const candidate = join(current, entry.name)
      if (entry.isDirectory()) pending.push(candidate)
      else if (entry.isFile()) files.push(candidate)
    }
  }
  const inventory = files
    .map((file) => {
      const fileHash = createHash("sha256")
        .update(readFileSync(file))
        .digest("hex")
      return `${relative(root, file)}\0${fileHash}\n`
    })
    .sort()
    .join("")
  return {
    fileCount: files.length,
    sha256: createHash("sha256").update(inventory).digest("hex"),
  }
}

export function verifyCheckedInNativeAdminProfile(root = directory) {
  return validateNativeAdminProfile(
    readNativeAdminProfile(root),
    readNativeAdminRealmSeed(root),
  )
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const errors = verifyCheckedInNativeAdminProfile()
  if (errors.length > 0) {
    process.stderr.write(`${errors.join("\n")}\n`)
    process.exitCode = 1
  } else {
    process.stdout.write(
      "F0-N3 Keycloak native-admin profile valid; ingress remains inactive.\n",
    )
  }
}
