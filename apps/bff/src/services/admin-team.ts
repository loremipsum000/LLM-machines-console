import { randomBytes } from "node:crypto"
import type {
  AdminTeamActionResponse,
  AdminTeamBulkGroupAssignmentRequest,
  AdminTeamCsvImportCommitRequest,
  AdminTeamCsvImportCommitResponse,
  AdminTeamCsvImportPreviewRequest,
  AdminTeamCsvImportPreviewResponse,
  AdminTeamCsvImportRow,
  AdminTeamGroup,
  AdminTeamGroupDetail,
  AdminTeamGroupMutationResponse,
  AdminTeamMember,
  AdminTeamMemberDetail,
  AdminTeamMemberMutationResponse,
  AdminTeamScimStatus,
  AdminTeamOverviewResponse,
  CreateAdminTeamGroupRequest,
  CreateAdminTeamMemberRequest,
  UpdateAdminTeamGroupRequest,
} from "@llm-machines/contracts/inference-core"
import type { Actor } from "../auth/persona"
import { emitAudit, getRecentAuditEvents } from "./audit"
import {
  KeycloakAdminClient,
  KeycloakAdminError,
  keycloakAdminConfigFromEnv,
  type KeycloakAdminConfig,
  type KeycloakAdminGroup,
  type KeycloakAdminUser,
} from "./inference-core-keycloak-admin"

export const TEAM_CSV_TEMPLATE =
  "name,username,email,group,role,send_invite,enabled\n"
const TEAM_CSV_HEADERS = [
  "name",
  "username",
  "email",
  "group",
  "role",
  "send_invite",
  "enabled",
] as const

export class AdminTeamError extends Error {
  constructor(
    readonly httpStatus: number,
    message: string,
  ) {
    super(message)
    this.name = "AdminTeamError"
  }
}

export function resetAdminTeamStateForTest(): void {
  cachedAuditEvents = []
}

export async function getAdminTeamOverview(
  actor: Actor,
): Promise<AdminTeamOverviewResponse> {
  const service = teamService()
  if (!service) {
    await emitTeamAudit(actor, "team.members.read", "overview", {
      serviceStatus: "not_configured",
    })
    return emptyTeamOverview("not_configured")
  }

  try {
    await refreshTeamAuditCache()
    const members = await listTeamMembers(service)
    const groups = await service.client.listGroups()
    const teamGroups = [
      everyoneGroup(members.length),
      ...(await Promise.all(
        groups.map((group) =>
          teamGroupFromKeycloak(
            group,
            members.filter((member) => memberHasGroup(member, group.name)).length,
          ),
        ),
      )),
    ]

    await emitTeamAudit(actor, "team.members.read", "overview", {
      returnedCount: members.length,
    })

    return {
      generatedAt: new Date().toISOString(),
      groups: teamGroups,
      members,
      scim: scimStatus(),
      serviceStatus: "ok",
      sourceStatus: "ok",
    }
  } catch (error) {
    return unavailableOverview(error)
  }
}

export async function getAdminTeamScimStatus(
  actor: Actor,
): Promise<AdminTeamScimStatus> {
  const scim = scimStatus()
  await emitTeamAudit(actor, "team.scim.read", "scim", {
    status: scim.status,
  })
  return scim
}

export async function getAdminTeamGroupDetail(
  actor: Actor,
  id: string,
): Promise<AdminTeamGroupDetail> {
  const service = requireTeamService()
  await refreshTeamAuditCache()
  const group = await groupById(service, id)
  const members = await membersForGroup(service, group)
  await emitTeamAudit(actor, "team.group.read", id)
  return {
    group: {
      ...group,
      memberCount: members.length,
    },
    members,
  }
}

export async function getAdminTeamMemberDetail(
  actor: Actor,
  id: string,
): Promise<AdminTeamMemberDetail> {
  const service = requireTeamService()
  await refreshTeamAuditCache()
  const member = await memberById(service, id)
  await emitTeamAudit(actor, "team.member.read", id)
  return {
    activity: recentActivityForMember(member),
    member,
    usage: usageForMember(member),
  }
}

export async function createAdminTeamMember(
  actor: Actor,
  request: CreateAdminTeamMemberRequest,
): Promise<AdminTeamMemberMutationResponse> {
  const service = requireTeamService()
  assertCorporateEmail(service.config, request.email)
  await assertClassifiedGroups(service, request.groups)
  const username =
    request.username ??
    generatedTeamUsername(
      request.displayName,
      firstClassifiedGroup(request.groups),
    )

  const userId = await service.client.createUser({
    displayName: request.displayName,
    email: request.email,
    enabled: request.enabled,
    username,
  })
  const password = request.generatePassword ? generatePassword() : null
  if (password) {
    await service.client.setPassword(userId, password)
  }
  await assignRoleAndGroups(service, userId, request.role, request.groups)
  if (request.sendInvite) {
    await service.client.executeEmailActions(userId, ["UPDATE_PASSWORD"])
  }

  const member = await memberById(service, userId)
  await emitTeamAudit(actor, "team.member.created", userId, {
    groups: request.groups,
    role: request.role,
    sendInvite: request.sendInvite,
    generatedPassword: Boolean(password),
  })
  return { generatedPassword: password, member }
}

export async function sendAdminTeamInvite(
  actor: Actor,
  id: string,
): Promise<AdminTeamActionResponse> {
  const service = requireTeamService()
  const member = await memberById(service, id)
  assertCorporateEmail(service.config, member.email)
  await service.client.executeEmailActions(id, ["UPDATE_PASSWORD"])
  await emitTeamAudit(actor, "team.member.invited", id)
  return { member, status: "sent" }
}

export async function sendAdminTeamPasswordReset(
  actor: Actor,
  id: string,
): Promise<AdminTeamActionResponse> {
  const service = requireTeamService()
  const member = await memberById(service, id)
  assertCorporateEmail(service.config, member.email)
  await service.client.executeEmailActions(id, ["UPDATE_PASSWORD"])
  await emitTeamAudit(actor, "team.member.password_reset_email_sent", id)
  return { member, status: "sent" }
}

export async function generateAdminTeamPassword(
  actor: Actor,
  id: string,
): Promise<AdminTeamMemberMutationResponse> {
  const service = requireTeamService()
  const password = generatePassword()
  await service.client.setPassword(id, password)
  const member = await memberById(service, id)
  await emitTeamAudit(actor, "team.member.password_generated", id)
  return { generatedPassword: password, member }
}

export async function disableAdminTeamMember(
  actor: Actor,
  id: string,
): Promise<AdminTeamActionResponse> {
  await assertCanMutateMember(actor, id)
  const service = requireTeamService()
  await service.client.updateUserEnabled(id, false)
  const member = await memberById(service, id)
  await emitTeamAudit(actor, "team.member.disabled", id)
  return { member, status: "disabled" }
}

export async function reactivateAdminTeamMember(
  actor: Actor,
  id: string,
): Promise<AdminTeamActionResponse> {
  const service = requireTeamService()
  await service.client.updateUserEnabled(id, true)
  const member = await memberById(service, id)
  await emitTeamAudit(actor, "team.member.reactivated", id)
  return { member, status: "reactivated" }
}

export async function deleteAdminTeamMember(
  actor: Actor,
  id: string,
): Promise<AdminTeamActionResponse> {
  await assertCanMutateMember(actor, id)
  const service = requireTeamService()
  await service.client.deleteUser(id)
  await emitTeamAudit(actor, "team.member.deleted", id)
  return { member: null, status: "deleted" }
}

export async function createAdminTeamGroup(
  actor: Actor,
  request: CreateAdminTeamGroupRequest,
): Promise<AdminTeamGroupMutationResponse> {
  const service = requireTeamService()
  assertMutableGroupName(request.name)
  await assertGroupNameAvailable(service, request.name)
  const id = await service.client.createGroup(request.name)
  const group = await groupById(service, id)
  await emitTeamAudit(actor, "team.group.created", id, { name: request.name })
  return { group, status: "created" }
}

export async function updateAdminTeamGroup(
  actor: Actor,
  id: string,
  request: UpdateAdminTeamGroupRequest,
): Promise<AdminTeamGroupMutationResponse> {
  assertMutableGroupId(id)
  const service = requireTeamService()
  const group = await groupById(service, id)
  assertMutableGroup(group)
  assertMutableGroupName(request.name)
  if (group.name.toLowerCase() !== request.name.toLowerCase()) {
    await assertGroupNameAvailable(service, request.name)
  }
  await service.client.updateGroup(id, request.name)
  const updated = await groupById(service, id)
  await emitTeamAudit(actor, "team.group.updated", id, {
    name: request.name,
    previousName: group.name,
  })
  return { group: updated, status: "updated" }
}

export async function deleteAdminTeamGroup(
  actor: Actor,
  id: string,
): Promise<AdminTeamGroupMutationResponse> {
  assertMutableGroupId(id)
  const service = requireTeamService()
  const group = await groupById(service, id)
  assertMutableGroup(group)
  await service.client.deleteGroup(id)
  await emitTeamAudit(actor, "team.group.deleted", id, { name: group.name })
  return { group: null, status: "deleted" }
}

export async function bulkAssignAdminTeamGroupMembers(
  actor: Actor,
  id: string,
  request: AdminTeamBulkGroupAssignmentRequest,
): Promise<AdminTeamGroupMutationResponse> {
  assertMutableGroupId(id)
  const service = requireTeamService()
  const group = await groupById(service, id)
  assertMutableGroup(group)
  for (const memberId of request.memberIds) {
    await service.client.joinGroup(memberId, group.id)
  }
  const updated = await groupById(service, id)
  await emitTeamAudit(actor, "team.group.member_assigned", id, {
    assignedCount: request.memberIds.length,
    memberIds: request.memberIds,
  })
  return { group: updated, status: "assigned" }
}

export async function removeAdminTeamGroupMember(
  actor: Actor,
  id: string,
  memberId: string,
): Promise<AdminTeamGroupMutationResponse> {
  assertMutableGroupId(id)
  const service = requireTeamService()
  const group = await groupById(service, id)
  assertMutableGroup(group)
  await service.client.leaveGroup(memberId, group.id)
  const updated = await groupById(service, id)
  await emitTeamAudit(actor, "team.group.member_removed", id, { memberId })
  return { group: updated, status: "removed" }
}

export async function previewAdminTeamCsvImport(
  actor: Actor,
  request: AdminTeamCsvImportPreviewRequest,
): Promise<AdminTeamCsvImportPreviewResponse> {
  const service = requireTeamService()
  const response = await buildCsvImportPreview(service, request.csv)
  await emitTeamAudit(actor, "team.csv_import.previewed", "csv-import", {
    rowCount: response.rows.length,
    valid: response.valid,
    validCount: response.rows.filter((row) => row.status === "valid").length,
  })
  return response
}

export async function commitAdminTeamCsvImport(
  actor: Actor,
  request: AdminTeamCsvImportCommitRequest,
): Promise<AdminTeamCsvImportCommitResponse> {
  const service = requireTeamService()
  const preview = await buildCsvImportPreview(service, request.csv)
  if (!preview.valid && !request.allowPartial) {
    throw new AdminTeamError(
      400,
      "CSV import preview contains invalid rows. Fix the CSV or explicitly allow partial import.",
    )
  }

  const rows: AdminTeamCsvImportRow[] = []
  for (const row of preview.rows) {
    if (row.status !== "valid") {
      rows.push({ ...row, status: "skipped" })
      continue
    }

    try {
      const userId = await service.client.createUser({
        displayName: row.name,
        email: row.email,
        enabled: row.enabled,
        username: row.username,
      })
      await assignRoleAndGroups(service, userId, row.role, [row.group])
      if (row.sendInvite) {
        await service.client.executeEmailActions(userId, ["UPDATE_PASSWORD"])
      }
      rows.push({ ...row, status: "created" })
    } catch (error) {
      rows.push({
        ...row,
        errors: [teamImportFailureMessage(error)],
        status: "failed",
      })
    }
  }

  const response = {
    createdCount: rows.filter((row) => row.status === "created").length,
    failedCount: rows.filter((row) => row.status === "failed").length,
    generatedAt: new Date().toISOString(),
    rows,
    skippedCount: rows.filter((row) => row.status === "skipped").length,
    valid: rows.every((row) => row.status === "created"),
  }
  await emitTeamAudit(actor, "team.csv_import.committed", "csv-import", {
    createdCount: response.createdCount,
    failedCount: response.failedCount,
    rowCount: rows.length,
    skippedCount: response.skippedCount,
  })
  return response
}

async function buildCsvImportPreview(
  service: TeamService,
  csv: string,
): Promise<AdminTeamCsvImportPreviewResponse> {
  const parsed = parseTeamCsv(csv)
  const groups = await service.client.listGroups()
  const existingUsers = await service.client.listUsers()
  const existingUsernames = new Set(
    existingUsers.map((user) => user.username.toLowerCase()),
  )
  const csvUsernameCounts = new Map<string, number>()
  for (const row of parsed.rows) {
    const username = row.values.username?.trim().toLowerCase()
    if (username) {
      csvUsernameCounts.set(username, (csvUsernameCounts.get(username) ?? 0) + 1)
    }
  }

  const rows = parsed.rows.map((row) =>
    csvImportRowFromValues(
      service,
      row,
      groups,
      existingUsernames,
      csvUsernameCounts,
    ),
  )
  return {
    generatedAt: new Date().toISOString(),
    rows,
    valid: rows.every((row) => row.status === "valid"),
  }
}

function csvImportRowFromValues(
  service: TeamService,
  row: ParsedCsvRow,
  groups: KeycloakAdminGroup[],
  existingUsernames: Set<string>,
  csvUsernameCounts: Map<string, number>,
): AdminTeamCsvImportRow {
  const name = row.values.name?.trim() ?? ""
  const username = row.values.username?.trim() ?? ""
  const email = row.values.email?.trim() ?? ""
  const group = row.values.group?.trim() ?? ""
  const role = parseCsvRole(row.values.role)
  const sendInvite = parseCsvBoolean(row.values.send_invite, false)
  const enabled = parseCsvBoolean(row.values.enabled, true)
  const errors = [...row.errors]

  if (!name) {
    errors.push("Name is required.")
  }
  if (!username) {
    errors.push("Username is required.")
  } else if ((csvUsernameCounts.get(username.toLowerCase()) ?? 0) > 1) {
    errors.push("Username is duplicated in the CSV.")
  } else if (existingUsernames.has(username.toLowerCase())) {
    errors.push("Username already exists in Keycloak.")
  }
  if (!email) {
    errors.push("Email is required.")
  } else if (!isEmailLike(email)) {
    errors.push("Email is malformed.")
  } else {
    const corporateError = corporateEmailError(service.config, email)
    if (corporateError) {
      errors.push(corporateError)
    }
  }
  if (!group) {
    errors.push("Group is required. Choose a Team group.")
  } else if (group.toLowerCase() === "everyone") {
    errors.push("Everyone is not a user group. Choose a Team group.")
  } else if (
    !findGroup(groups, group)
  ) {
    errors.push(`Unknown group: ${group}.`)
  }
  if (!role) {
    errors.push("Role must be admin or operator.")
  }
  if (sendInvite === null) {
    errors.push("send_invite must be true or false.")
  }
  if (enabled === null) {
    errors.push("enabled must be true or false.")
  }

  const normalizedGroup = group
  const actions: AdminTeamCsvImportRow["actions"] =
    errors.length > 0
      ? []
      : [
          "create_user",
          "assign_group",
          ...(sendInvite ? ["send_invite" as const] : []),
        ]
  return {
    actions,
    email,
    enabled: enabled ?? true,
    errors,
    group: normalizedGroup,
    line: row.line,
    name,
    role: role ?? "operator",
    sendInvite: sendInvite ?? false,
    status: errors.length > 0 ? "invalid" : "valid",
    username,
  }
}

interface ParsedCsvRow {
  errors: string[]
  line: number
  values: Partial<Record<(typeof TEAM_CSV_HEADERS)[number], string>>
}

function parseTeamCsv(csv: string): { rows: ParsedCsvRow[] } {
  const lines = csv.replace(/^\uFEFF/, "").split(/\r?\n/)
  const headerLine = lines.shift()
  if (!headerLine) {
    throw new AdminTeamError(400, "CSV import requires a header row.")
  }
  const header = parseCsvLine(headerLine)
  if (!header.ok || !sameHeaders(header.values)) {
    throw new AdminTeamError(
      400,
      `CSV headers must be: ${TEAM_CSV_HEADERS.join(",")}.`,
    )
  }

  const rows: ParsedCsvRow[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 2
    const line = lines[index]
    if (!line || line.trim().length === 0) {
      continue
    }
    const parsed = parseCsvLine(line)
    const values: ParsedCsvRow["values"] = {}
    const errors: string[] = []
    if (!parsed.ok) {
      errors.push(parsed.error)
    }
    if (parsed.ok && parsed.values.length !== TEAM_CSV_HEADERS.length) {
      errors.push(
        `Malformed row: expected ${TEAM_CSV_HEADERS.length} columns, received ${parsed.values.length}.`,
      )
    }
    for (const [columnIndex, headerName] of TEAM_CSV_HEADERS.entries()) {
      values[headerName] = parsed.ok ? (parsed.values[columnIndex] ?? "") : ""
    }
    rows.push({ errors, line: lineNumber, values })
  }
  return { rows }
}

function parseCsvLine(
  line: string,
): { ok: true; values: string[] } | { error: string; ok: false } {
  const values: string[] = []
  let current = ""
  let inQuotes = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (inQuotes) {
      if (char === '"' && line[index + 1] === '"') {
        current += '"'
        index += 1
      } else if (char === '"') {
        inQuotes = false
      } else {
        current += char
      }
      continue
    }
    if (char === ",") {
      values.push(current)
      current = ""
      continue
    }
    if (char === '"') {
      if (current.length > 0) {
        return { error: "Malformed row: quote must start a field.", ok: false }
      }
      inQuotes = true
      continue
    }
    current += char
  }
  if (inQuotes) {
    return { error: "Malformed row: unterminated quote.", ok: false }
  }
  values.push(current)
  return { ok: true, values }
}

function sameHeaders(headers: string[]): boolean {
  return (
    headers.length === TEAM_CSV_HEADERS.length &&
    TEAM_CSV_HEADERS.every(
      (expected, index) => headers[index]?.trim().toLowerCase() === expected,
    )
  )
}

function parseCsvRole(value: string | undefined): AdminTeamCsvImportRow["role"] | null {
  const role = value?.trim().toLowerCase()
  if (!role) {
    return "operator"
  }
  return role === "admin" || role === "operator" ? role : null
}

function parseCsvBoolean(value: string | undefined, fallback: boolean): boolean | null {
  const normalized = value?.trim().toLowerCase()
  if (!normalized) {
    return fallback
  }
  if (normalized === "true" || normalized === "yes" || normalized === "1") {
    return true
  }
  if (normalized === "false" || normalized === "no" || normalized === "0") {
    return false
  }
  return null
}

function isEmailLike(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function corporateEmailError(
  config: KeycloakAdminConfig,
  email: string,
): string | null {
  if (config.allowedEmailDomains.length === 0) {
    return null
  }
  const domain = email.split("@")[1]?.toLowerCase()
  return domain && config.allowedEmailDomains.includes(domain)
    ? null
    : "A corporate email address is required."
}

function teamImportFailureMessage(error: unknown): string {
  if (error instanceof AdminTeamError) {
    return error.message
  }
  if (error instanceof KeycloakAdminError) {
    return "Keycloak Admin API request failed."
  }
  return "User could not be created in Keycloak."
}

async function listTeamMembers(service: TeamService): Promise<AdminTeamMember[]> {
  const users = await service.client.listUsers()
  const members = await Promise.all(
    users.map((user) => memberFromKeycloak(service, user)),
  )
  return members.filter(
    (member): member is AdminTeamMember => member !== null,
  )
}

async function memberById(
  service: TeamService,
  id: string,
): Promise<AdminTeamMember> {
  const member = await memberFromKeycloak(
    service,
    await service.client.getUser(id),
  )
  if (!member) {
    throw new AdminTeamError(
      409,
      "Keycloak user does not have an explicit Admin or Operator role.",
    )
  }
  return member
}

async function groupById(
  service: TeamService,
  id: string,
): Promise<AdminTeamGroup> {
  if (id.toLowerCase() === "everyone") {
    return everyoneGroup((await listTeamMembers(service)).length)
  }
  const group = await service.client.getGroup(id)
  const members = await service.client
    .getGroupMembers(group.id)
    .catch(() => [])
  return {
    id: group.id,
    keycloakHref: null,
    memberCount: members.length,
    name: group.name,
    virtual: false,
  }
}

async function membersForGroup(
  service: TeamService,
  group: AdminTeamGroup,
): Promise<AdminTeamMember[]> {
  if (group.virtual) {
    return listTeamMembers(service)
  }
  const members = await service.client.getGroupMembers(group.id)
  const classified = await Promise.all(
    members.map((member) => memberFromKeycloak(service, member)),
  )
  return classified.filter(
    (member): member is AdminTeamMember => member !== null,
  )
}

function teamGroupFromKeycloak(
  group: KeycloakAdminGroup,
  memberCount: number,
): AdminTeamGroup {
  return {
    id: group.id,
    keycloakHref: null,
    memberCount,
    name: group.name,
    virtual: false,
  }
}

async function memberFromKeycloak(
  service: TeamService,
  user: KeycloakAdminUser,
): Promise<AdminTeamMember | null> {
  const [groups, roles] = await Promise.all([
    service.client.getUserGroups(user.id).catch(() => []),
    service.client.getUserRealmRoles(user.id).catch(() => []),
  ])
  const role = retainedRoleFromRealmRoles(roles.map((item) => item.name))
  if (!role) {
    return null
  }
  return {
    createdAt: user.createdAt,
    displayName: user.displayName,
    email: user.email,
    enabled: user.enabled,
    groups: groups.map((group) => group.name),
    id: user.id,
    keycloakHref: null,
    lastActiveAt: lastActiveAtFor(user),
    role,
    status: user.enabled ? "active" : "disabled",
    username: user.username,
  }
}

function retainedRoleFromRealmRoles(
  roles: string[],
): AdminTeamMember["role"] | null {
  const normalized = new Set(roles.map((role) => role.toLowerCase()))
  if (normalized.has("admin")) {
    return "admin"
  }
  return normalized.has("operator") ? "operator" : null
}

async function assignRoleAndGroups(
  service: TeamService,
  userId: string,
  role: CreateAdminTeamMemberRequest["role"],
  groups: string[],
): Promise<void> {
  const realmRole = await service.client.getRealmRole(role)
  await service.client.assignRealmRole(userId, realmRole)
  const keycloakGroups = await service.client.listGroups()
  for (const groupName of groups.filter((group) => group !== "Everyone")) {
    const group = findGroup(keycloakGroups, groupName)
    if (group) {
      await service.client.joinGroup(userId, group.id)
    }
  }
}

async function assertClassifiedGroups(
  service: TeamService,
  groups: string[],
): Promise<void> {
  const selectedGroups = groups.filter((group) => group !== "Everyone")
  if (selectedGroups.length === 0) {
    throw new AdminTeamError(
      400,
      "Select one Team group before creating a user.",
    )
  }
  const keycloakGroups = await service.client.listGroups()
  const missing = selectedGroups.filter((groupName) => {
    return !findGroup(keycloakGroups, groupName)
  })
  if (missing.length > 0) {
    throw new AdminTeamError(
      400,
      `Unknown Team group: ${missing.join(", ")}.`,
    )
  }
}

function firstClassifiedGroup(groups: string[]): string {
  return groups.find((group) => group !== "Everyone") ?? "team"
}

function generatedTeamUsername(displayName: string, groupName: string): string {
  const username = [usernameSegment(displayName), usernameSegment(groupName)]
    .filter(Boolean)
    .join(".")
  return username.slice(0, 80) || `user.${Date.now()}`
}

function usernameSegment(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{Mark}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "")
}

function findGroup(
  groups: KeycloakAdminGroup[],
  name: string,
): KeycloakAdminGroup | null {
  return (
    groups.find((group) => group.name.toLowerCase() === name.toLowerCase()) ??
    null
  )
}

function memberHasGroup(member: AdminTeamMember, groupName: string): boolean {
  const normalized = groupName.toLowerCase()
  return member.groups.some((group) => group.toLowerCase() === normalized)
}

async function assertGroupNameAvailable(
  service: TeamService,
  name: string,
): Promise<void> {
  const groups = await service.client.listGroups()
  if (findGroup(groups, name)) {
    throw new AdminTeamError(409, "A Team group with this name already exists.")
  }
}

interface TeamService {
  client: KeycloakAdminClient
  config: KeycloakAdminConfig
}

function teamService(): TeamService | null {
  const configResult = keycloakAdminConfigFromEnv()
  if (configResult.status !== "ok") {
    return null
  }
  return {
    client: new KeycloakAdminClient(configResult.config),
    config: configResult.config,
  }
}

function requireTeamService(): TeamService {
  const service = teamService()
  if (!service) {
    throw new AdminTeamError(503, "Keycloak Admin API is not configured.")
  }
  return service
}

function assertCorporateEmail(
  config: KeycloakAdminConfig,
  email: string,
): void {
  if (config.allowedEmailDomains.length === 0) {
    return
  }
  const domain = email.split("@")[1]?.toLowerCase()
  if (!domain || !config.allowedEmailDomains.includes(domain)) {
    throw new AdminTeamError(400, "A corporate email address is required.")
  }
}

async function assertCanMutateMember(actor: Actor, id: string): Promise<void> {
  if (actor.subject === id) {
    throw new AdminTeamError(409, "Users cannot disable or delete themselves.")
  }
  const service = requireTeamService()
  const members = await listTeamMembers(service)
  const target = members.find((member) => member.id === id)
  const enabledOperators = members.filter(
    (member) => member.enabled && member.role === "operator",
  )
  if (
    target?.enabled &&
    target.role === "operator" &&
    enabledOperators.length <= 1
  ) {
    throw new AdminTeamError(
      409,
      "The last enabled Operator is the automatic break-glass account and cannot be disabled or deleted.",
    )
  }
}

function assertMutableGroup(group: AdminTeamGroup): void {
  if (group.virtual || group.name.toLowerCase() === "everyone") {
    throw new AdminTeamError(
      409,
      "Everyone is virtual and cannot be edited or deleted.",
    )
  }
}

function assertMutableGroupName(name: string): void {
  if (name.toLowerCase() === "everyone") {
    throw new AdminTeamError(
      409,
      "Everyone is virtual and cannot be edited or deleted.",
    )
  }
}

function assertMutableGroupId(id: string): void {
  if (id.toLowerCase() === "everyone") {
    throw new AdminTeamError(
      409,
      "Everyone is virtual and cannot be edited or deleted.",
    )
  }
}

function emptyTeamOverview(
  serviceStatus: AdminTeamOverviewResponse["serviceStatus"],
): AdminTeamOverviewResponse {
  return {
    generatedAt: new Date().toISOString(),
    groups: [everyoneGroup(0)],
    members: [],
    scim: scimStatus(),
    serviceStatus,
    sourceStatus:
      serviceStatus === "not_configured" ? "not_configured" : "unavailable",
  }
}

function unavailableOverview(error: unknown): AdminTeamOverviewResponse {
  if (error instanceof KeycloakAdminError) {
    return emptyTeamOverview(error.status)
  }
  return emptyTeamOverview("unavailable")
}

function scimStatus(): AdminTeamOverviewResponse["scim"] {
  const provider = optionalEnv("TEAM_SCIM_PROVIDER")
  if (provider) {
    return {
      detail:
        "SCIM status is read-only in Console. Manage provisioning details in Keycloak.",
      keycloakHref: null,
      lastSyncAt: validIsoDate(optionalEnv("TEAM_SCIM_LAST_SYNC_AT")),
      provider,
      sourceStatus: "ok",
      status: "configured",
    }
  }

  return {
    detail:
      "SCIM synchronization is configured directly in Keycloak when available.",
    keycloakHref: null,
    lastSyncAt: null,
    provider: null,
    sourceStatus: "not_configured",
    status: "not_configured",
  }
}

function everyoneGroup(memberCount: number): AdminTeamGroup {
  return {
    id: "everyone",
    keycloakHref: null,
    memberCount,
    name: "Everyone",
    virtual: true,
  }
}

function recentActivityForMember(
  member: AdminTeamMember,
): AdminTeamMemberDetail["activity"] {
  return getCachedAuditEvents()
    .filter((event) => eventMatchesMember(event.actorId, member))
    .slice(0, 20)
    .map((event) => ({
      action: event.action,
      createdAt: event.createdAt,
      href: "#audit-log-deferred",
      id: event.id,
      targetId: event.targetId,
      targetType: event.targetType,
    }))
}

function usageForMember(member: AdminTeamMember): AdminTeamMemberDetail["usage"] {
  const modelCounts = new Map<string, number>()
  let prompts = 0
  let tokens = 0
  for (const event of getCachedAuditEvents()) {
    if (!eventMatchesMember(event.actorId, member)) {
      continue
    }
    prompts += numberMetadata(event.metadata.prompts)
    prompts += numberMetadata(event.metadata.promptTokens) > 0 ? 1 : 0
    tokens += numberMetadata(event.metadata.tokens)
    tokens += numberMetadata(event.metadata.totalTokens)
    const model =
      typeof event.metadata.model === "string" ? event.metadata.model : null
    if (model) {
      modelCounts.set(model, (modelCounts.get(model) ?? 0) + 1)
    }
  }

  return {
    mostUsedModel:
      [...modelCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
    prompts,
    sourceStatus: "ok",
    tokens,
    window: "30d",
  }
}

let cachedAuditEvents: Awaited<ReturnType<typeof getRecentAuditEvents>> = []

function getCachedAuditEvents(): typeof cachedAuditEvents {
  return cachedAuditEvents
}

export async function refreshTeamAuditCache(): Promise<void> {
  cachedAuditEvents = await getRecentAuditEvents(100)
}

function eventMatchesMember(actorId: string, member: AdminTeamMember): boolean {
  return actorId.toLowerCase() === member.id.toLowerCase()
}

function lastActiveAtFor(user: KeycloakAdminUser): string | null {
  return (
    getCachedAuditEvents().find((event) => eventMatchesMember(event.actorId, {
      createdAt: user.createdAt,
      displayName: user.displayName,
      email: user.email,
      enabled: user.enabled,
      groups: [],
      id: user.id,
      keycloakHref: null,
      lastActiveAt: null,
      role: "operator",
      status: user.enabled ? "active" : "disabled",
      username: user.username,
    }))?.createdAt ?? null
  )
}

function numberMetadata(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.trunc(value))
  }
  return 0
}

function generatePassword(): string {
  return `Llm-${randomBytes(12).toString("base64url")}-26`
}

async function emitTeamAudit(
  actor: Actor,
  action: string,
  targetId: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await emitAudit({
    actorId: actor.subject,
    action,
    targetId,
    targetType: "team",
    metadata: {
      authMode: actor.authMode,
      ...metadata,
    },
  })
  await refreshTeamAuditCache()
}

function optionalEnv(name: string): string | null {
  const value = process.env[name]?.trim()
  return value ? value : null
}

function validIsoDate(value: string | null): string | null {
  if (!value) {
    return null
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}
