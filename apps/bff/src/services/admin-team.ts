import { randomBytes } from "node:crypto"
import type {
  AdminTeamActionResponse,
  AdminTeamBreakGlass,
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
  UpdateAdminTeamBreakGlassRequest,
  UpdateAdminTeamGroupRequest,
} from "@llm-machines/contracts"
import { eq } from "drizzle-orm"
import type { Actor } from "../auth/persona"
import { getDb } from "../db/client"
import { consoleSettings } from "../db/schema"
import { emitAudit, getRecentAuditEvents } from "./audit"
import {
  adminMcpServerUnlocksForAccessGroup,
  renameAdminMcpServerAccessGroup,
} from "./admin-connector-registry"
import {
  knowledgeUnlocksForAccessGroup,
  renameKnowledgeAccessGroup,
} from "./knowledge/admin"
import {
  KeycloakAdminClient,
  KeycloakAdminError,
  keycloakAdminConfigFromEnv,
  roleFromRealmRoles,
  type KeycloakAdminConfig,
  type KeycloakAdminGroup,
  type KeycloakAdminUser,
} from "./team-keycloak-admin"
import { upsertActorUser } from "./users"

export const TEAM_CSV_TEMPLATE =
  "name,username,email,group,role,send_invite,enabled\n"
const singletonSettingsId = "singleton"
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

let breakGlassAdminId: string | null = null
let breakGlassUpdatedAt: string | null = null
let breakGlassUpdatedBy: string | null = null

interface BreakGlassState {
  selectedAdminId: string | null
  updatedAt: string | null
  updatedBy: string | null
}

export function resetAdminTeamStateForTest(): void {
  breakGlassAdminId = null
  breakGlassUpdatedAt = null
  breakGlassUpdatedBy = null
  cachedAuditEvents = []
}

export function setBreakGlassAdminForTest(id: string | null): void {
  breakGlassAdminId = id
  breakGlassUpdatedAt = id ? new Date().toISOString() : null
  breakGlassUpdatedBy = id ? "test" : null
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

    const breakGlassState = await readBreakGlassState()
    return {
      breakGlass: breakGlass(members, breakGlassState),
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

export async function getAdminTeamBreakGlass(
  actor: Actor,
): Promise<AdminTeamBreakGlass> {
  const service = requireTeamService()
  const members = await listTeamMembers(service)
  const result = breakGlass(members, await readBreakGlassState())
  await emitTeamAudit(actor, "team.break_glass.read", "break-glass", {
    selectedAdminId: result.selectedAdminId,
  })
  return result
}

export async function updateAdminTeamBreakGlass(
  actor: Actor,
  request: UpdateAdminTeamBreakGlassRequest,
): Promise<AdminTeamBreakGlass> {
  const service = requireTeamService()
  const members = await listTeamMembers(service)
  const eligibleAdmins = members.filter(
    (member) => member.enabled && member.role === "admin",
  )
  const selected = eligibleAdmins.find(
    (member) => member.id === request.selectedAdminId,
  )
  if (!selected) {
    throw new AdminTeamError(
      400,
      "Break-glass Admin must be an enabled Admin user.",
    )
  }

  const state = await writeBreakGlassState(actor, selected.id)
  const result = breakGlass(members, state)
  await emitTeamAudit(actor, "team.break_glass.updated", selected.id, {
    selectedAdminId: selected.id,
  })
  return result
}

export async function getAdminTeamGroupDetail(
  actor: Actor,
  id: string,
): Promise<AdminTeamGroupDetail> {
  const service = requireTeamService()
  await refreshTeamAuditCache()
  const group = await groupById(service, id)
  const [members, unlocks] = await Promise.all([
    membersForGroup(service, group),
    groupUnlocks(group.name),
  ])
  await emitTeamAudit(actor, "team.group.read", id)
  return {
    group: {
      ...group,
      memberCount: members.length,
      unlockCount: unlocks.length,
    },
    members,
    unlocks,
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
  const [knowledgeChangedCount, mcpChangedCount] = await Promise.all([
    renameKnowledgeAccessGroup(actor, group.name, request.name),
    renameAdminMcpServerAccessGroup(actor, group.name, request.name),
  ])
  const updated = await groupById(service, id)
  await emitTeamAudit(actor, "team.group.updated", id, {
    knowledgeChangedCount,
    mcpChangedCount,
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
  const unlocks = await groupUnlocks(group.name)
  if (unlocks.length > 0) {
    throw new AdminTeamError(
      409,
      `Group is still referenced by: ${unlocks
        .map((unlock) => unlock.name)
        .join(", ")}.`,
    )
  }
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
    usernames: rows.map((row) => row.username).filter(Boolean),
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
    errors.push("Role must be consumer, builder, or admin.")
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
    role: role ?? "consumer",
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
    return "consumer"
  }
  return role === "admin" || role === "builder" || role === "consumer"
    ? role
    : null
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
  return Promise.all(users.map((user) => memberFromKeycloak(service, user)))
}

async function memberById(
  service: TeamService,
  id: string,
): Promise<AdminTeamMember> {
  return memberFromKeycloak(service, await service.client.getUser(id))
}

async function groupById(
  service: TeamService,
  id: string,
): Promise<AdminTeamGroup> {
  if (id.toLowerCase() === "everyone") {
    return everyoneGroup((await listTeamMembers(service)).length)
  }
  const group = await service.client.getGroup(id)
  const [members, unlocks] = await Promise.all([
    service.client.getGroupMembers(group.id).catch(() => []),
    groupUnlocks(group.name),
  ])
  return {
    id: group.id,
    keycloakHref: keycloakGroupHref(group.id),
    memberCount: members.length,
    name: group.name,
    unlockCount: unlocks.length,
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
  return Promise.all(members.map((member) => memberFromKeycloak(service, member)))
}

async function teamGroupFromKeycloak(
  group: KeycloakAdminGroup,
  memberCount: number,
): Promise<AdminTeamGroup> {
  return {
    id: group.id,
    keycloakHref: keycloakGroupHref(group.id),
    memberCount,
    name: group.name,
    unlockCount: (await groupUnlocks(group.name)).length,
    virtual: false,
  }
}

async function groupUnlocks(
  groupName: string,
): Promise<AdminTeamGroupDetail["unlocks"]> {
  const [corpora, mcpServers] = await Promise.all([
    knowledgeUnlocksForAccessGroup(groupName),
    adminMcpServerUnlocksForAccessGroup(groupName),
  ])
  return [...corpora, ...mcpServers]
}

async function memberFromKeycloak(
  service: TeamService,
  user: KeycloakAdminUser,
): Promise<AdminTeamMember> {
  const [groups, roles] = await Promise.all([
    service.client.getUserGroups(user.id).catch(() => []),
    service.client.getUserRealmRoles(user.id).catch(() => []),
  ])
  return {
    createdAt: user.createdAt,
    displayName: user.displayName,
    email: user.email,
    enabled: user.enabled,
    groups: groups.map((group) => group.name),
    id: user.id,
    keycloakHref: keycloakUserHref(user.id),
    lastActiveAt: lastActiveAtFor(user),
    role: roleFromRealmRoles(roles.map((role) => role.name)),
    status: user.enabled ? "active" : "disabled",
    username: user.username,
  }
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
    throw new AdminTeamError(409, "Admins cannot disable or delete themselves.")
  }
  const breakGlassState = await readBreakGlassState()
  if (breakGlassState.selectedAdminId === id) {
    throw new AdminTeamError(
      409,
      "The selected break-glass Admin cannot be disabled or deleted.",
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
    breakGlass: breakGlass([], memoryBreakGlassState()),
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

function breakGlass(
  members: AdminTeamMember[],
  state: BreakGlassState,
): AdminTeamBreakGlass {
  const eligibleAdmins = members.filter(
    (member) => member.enabled && member.role === "admin",
  )
  const selectedAdminId = eligibleAdmins.some(
    (member) => member.id === state.selectedAdminId,
  )
    ? state.selectedAdminId
    : null
  return {
    eligibleAdmins,
    selectedAdminId,
    updatedAt: selectedAdminId ? state.updatedAt : null,
    updatedBy: selectedAdminId ? state.updatedBy : null,
  }
}

function memoryBreakGlassState(): BreakGlassState {
  return {
    selectedAdminId: breakGlassAdminId,
    updatedAt: breakGlassUpdatedAt,
    updatedBy: breakGlassUpdatedBy,
  }
}

function setMemoryBreakGlassState(state: BreakGlassState): BreakGlassState {
  breakGlassAdminId = state.selectedAdminId
  breakGlassUpdatedAt = state.updatedAt
  breakGlassUpdatedBy = state.updatedBy
  return state
}

async function readBreakGlassState(): Promise<BreakGlassState> {
  const db = getDb()
  if (!db) {
    return memoryBreakGlassState()
  }

  const [row] = await db
    .select({
      selectedAdminId: consoleSettings.breakGlassAdminId,
      updatedAt: consoleSettings.breakGlassUpdatedAt,
      updatedBy: consoleSettings.breakGlassUpdatedBy,
    })
    .from(consoleSettings)
    .where(eq(consoleSettings.id, singletonSettingsId))
    .limit(1)

  if (!row) {
    return setMemoryBreakGlassState({
      selectedAdminId: null,
      updatedAt: null,
      updatedBy: null,
    })
  }

  return setMemoryBreakGlassState({
    selectedAdminId: row.selectedAdminId,
    updatedAt: row.updatedAt?.toISOString() ?? null,
    updatedBy: row.updatedBy,
  })
}

async function writeBreakGlassState(
  actor: Actor,
  selectedAdminId: string,
): Promise<BreakGlassState> {
  const now = new Date()
  const state = setMemoryBreakGlassState({
    selectedAdminId,
    updatedAt: now.toISOString(),
    updatedBy: actor.subject,
  })
  const db = getDb()
  if (!db) {
    return state
  }

  const persistedActor = await upsertActorUser(actor)
  await db
    .insert(consoleSettings)
    .values({
      id: singletonSettingsId,
      organizationName: "LLM Machines",
      defaultLanguage: "en",
      telemetryEnabled: false,
      telemetryPayloadPreview: {},
      privacyPolicyHref: "/privacy",
      dataResidencyStatement:
        "Customer data stays on the deployed appliance by default.",
      breakGlassAdminId: selectedAdminId,
      breakGlassUpdatedAt: now,
      breakGlassUpdatedBy: persistedActor.subject,
      updatedBy: persistedActor.subject,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: consoleSettings.id,
      set: {
        breakGlassAdminId: selectedAdminId,
        breakGlassUpdatedAt: now,
        breakGlassUpdatedBy: persistedActor.subject,
        updatedBy: persistedActor.subject,
        updatedAt: now,
      },
    })

  return setMemoryBreakGlassState({
    selectedAdminId,
    updatedAt: now.toISOString(),
    updatedBy: persistedActor.subject,
  })
}

function scimStatus(): AdminTeamOverviewResponse["scim"] {
  const provider = optionalEnv("TEAM_SCIM_PROVIDER")
  if (provider) {
    return {
      detail:
        "SCIM status is read-only in Console. Manage provisioning details in Keycloak.",
      keycloakHref: keycloakAdminHref(),
      lastSyncAt: validIsoDate(optionalEnv("TEAM_SCIM_LAST_SYNC_AT")),
      provider,
      sourceStatus: "ok",
      status: "configured",
    }
  }

  return {
    detail:
      "SCIM synchronization is configured directly in Keycloak when available.",
    keycloakHref: keycloakAdminHref(),
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
    unlockCount: 0,
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
  let mcpCalls = 0
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
    if (event.action === "connector.mcp.forwarded") {
      mcpCalls += 1
    }
  }

  return {
    mcpCalls,
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
  const identities = new Set([
    member.id.toLowerCase(),
    member.username.toLowerCase(),
    member.email.toLowerCase(),
    member.email.split("@")[0]?.toLowerCase() ?? "",
  ])
  return identities.has(actorId.toLowerCase())
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
      role: "consumer",
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

function keycloakAdminHref(): string | null {
  const explicit = optionalEnv("KEYCLOAK_ADMIN_PUBLIC_URL")
  if (explicit) {
    return trimTrailingSlash(explicit)
  }
  const configResult = keycloakAdminConfigFromEnv()
  if (configResult.status !== "ok") {
    return null
  }
  return `${configResult.config.baseUrl}/admin/${encodeURIComponent(
    configResult.config.realm,
  )}/console/#/${encodeURIComponent(configResult.config.realm)}`
}

function keycloakUserHref(id: string): string | null {
  const base = keycloakAdminHref()
  return base ? `${base}/users/${encodeURIComponent(id)}` : null
}

function keycloakGroupHref(id: string): string | null {
  const base = keycloakAdminHref()
  return base ? `${base}/groups/${encodeURIComponent(id)}` : null
}

function optionalEnv(name: string): string | null {
  const value = process.env[name]?.trim()
  return value ? value : null
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "")
}

function validIsoDate(value: string | null): string | null {
  if (!value) {
    return null
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}
