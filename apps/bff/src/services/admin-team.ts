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
  AdminTeamOverviewResponse,
  AdminTeamScimStatus,
  CreateAdminTeamGroupRequest,
  CreateAdminTeamMemberRequest,
  UpdateAdminTeamGroupRequest,
} from "@llm-machines/contracts/inference-core"
import {
  adminTeamBatchLimit,
  adminTeamCsvMaxBytes,
} from "@llm-machines/contracts/inference-core"
import type { Actor } from "../auth/authorization"
import { emitAudit, getRecentAuditEvents } from "./audit"
import {
  type IdentityMutationRouteContext,
  type IdentityMutationTargetInput,
  type IdentityMutationTargetType,
  type IdentityMutationTargetsPhase,
  type KeycloakMutationPhase,
  executeJournaledIdentityMutation,
} from "./identity-mutation-journal"
import {
  KeycloakAdminClient,
  type KeycloakAdminConfig,
  KeycloakAdminError,
  type KeycloakAdminGroup,
  type KeycloakAdminUser,
  classifyRetainedRealmRoles,
  keycloakAdminConfigFromEnv,
} from "./inference-core-keycloak-admin"

export type AdminTeamMutationContext = IdentityMutationRouteContext

export const TEAM_CSV_TEMPLATE =
  "name,username,email,group,role,send_invite,enabled\n"
export const TEAM_CSV_MAX_ROWS = adminTeamBatchLimit
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
    await emitTeamAudit(actor, "team.members.read", "failed")
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
            members.filter((member) => memberHasGroup(member, group.name))
              .length,
          ),
        ),
      )),
    ]

    await emitTeamAudit(actor, "team.members.read")

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
  await emitTeamAudit(actor, "team.scim.read")
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
  await emitTeamAudit(actor, "team.group.read")
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
  await emitTeamAudit(actor, "team.member.read")
  return {
    activity: recentActivityForMember(member),
    member,
  }
}

export async function createAdminTeamMember(
  actor: Actor,
  request: CreateAdminTeamMemberRequest,
  context: AdminTeamMutationContext,
): Promise<AdminTeamMemberMutationResponse> {
  return executeTeamIdentityMutation<
    CreateMemberMutationPreflight,
    AdminTeamMemberMutationResponse
  >(actor, context, {
    action: "team.member.created",
    apply: async (prepared, keycloak) => {
      const userId = await keycloak.firstWrite(
        () =>
          prepared.service.client.createUser({
            displayName: request.displayName,
            email: request.email,
            enabled: false,
            username: prepared.username,
          }),
        (createdId) => createdId,
      )
      if (prepared.password) {
        await keycloak.writeAfterFirst(() =>
          prepared.service.client.setPassword(userId, prepared.password ?? ""),
        )
      }
      await keycloak.writeAfterFirst(() =>
        assignCanonicalRoleAndGroups(
          prepared.service,
          userId,
          request.role,
          request.groups,
        ),
      )
      await keycloak.readAfterWrite(() =>
        memberWithExpectedAuthority(
          prepared.service,
          userId,
          request.role,
          false,
          request.groups,
        ),
      )
      if (request.sendInvite) {
        await keycloak.writeAfterFirst(() =>
          prepared.service.client.executeEmailActions(userId, [
            "UPDATE_PASSWORD",
          ]),
        )
      }
      if (request.enabled) {
        await keycloak.writeAfterFirst(() =>
          prepared.service.client.updateUserEnabled(userId, true),
        )
      }
      const member = await keycloak.readAfterWrite(() =>
        memberWithExpectedAuthority(
          prepared.service,
          userId,
          request.role,
          request.enabled,
          request.groups,
        ),
      )
      return { generatedPassword: prepared.password, member }
    },
    preflight: async (signal) => {
      const service = requireTeamService(signal)
      assertWorkEmail(service.config, request.email)
      assertRoleGroupSelection(request.role, request.groups)
      await assertAssignableGroups(service, request.role, request.groups)
      return {
        password: request.generatePassword ? generatePassword() : null,
        service,
        username:
          request.username ??
          generatedTeamUsername(
            request.displayName,
            firstClassifiedGroup(request.groups, request.role),
          ),
      }
    },
    targetIdentifier: request.email.trim().toLowerCase(),
    targetType: "user",
  })
}

export async function sendAdminTeamInvite(
  actor: Actor,
  id: string,
  context: AdminTeamMutationContext,
): Promise<AdminTeamActionResponse> {
  return executeTeamIdentityMutation<
    MemberEmailMutationPreflight,
    AdminTeamActionResponse
  >(actor, context, {
    action: "team.member.invited",
    apply: async (prepared, keycloak) => {
      await keycloak.firstWrite(
        () =>
          prepared.service.client.executeEmailActions(id, ["UPDATE_PASSWORD"]),
        id,
      )
      return { member: prepared.member, status: "sent" }
    },
    preflight: (signal) => prepareMemberEmailAction(id, signal),
    targetIdentifier: id,
    targetType: "user",
  })
}

export async function sendAdminTeamPasswordReset(
  actor: Actor,
  id: string,
  context: AdminTeamMutationContext,
): Promise<AdminTeamActionResponse> {
  return executeTeamIdentityMutation<
    MemberEmailMutationPreflight,
    AdminTeamActionResponse
  >(actor, context, {
    action: "team.member.password_reset_email_sent",
    apply: async (prepared, keycloak) => {
      await keycloak.firstWrite(
        () =>
          prepared.service.client.executeEmailActions(id, ["UPDATE_PASSWORD"]),
        id,
      )
      return { member: prepared.member, status: "sent" }
    },
    preflight: (signal) => prepareMemberEmailAction(id, signal),
    targetIdentifier: id,
    targetType: "user",
  })
}

export async function generateAdminTeamPassword(
  actor: Actor,
  id: string,
  context: AdminTeamMutationContext,
): Promise<AdminTeamMemberMutationResponse> {
  return executeTeamIdentityMutation<
    PasswordMutationPreflight,
    AdminTeamMemberMutationResponse
  >(actor, context, {
    action: "team.member.password_generated",
    apply: async (prepared, keycloak) => {
      await keycloak.firstWrite(
        () => prepared.service.client.setPassword(id, prepared.password),
        id,
      )
      const member = await keycloak.readAfterWrite(() =>
        memberById(prepared.service, id),
      )
      return { generatedPassword: prepared.password, member }
    },
    preflight: async (signal) => {
      const service = requireTeamService(signal)
      await memberById(service, id)
      return { password: generatePassword(), service }
    },
    targetIdentifier: id,
    targetType: "user",
  })
}

export async function disableAdminTeamMember(
  actor: Actor,
  id: string,
  context: AdminTeamMutationContext,
): Promise<AdminTeamActionResponse> {
  return executeTeamIdentityMutation<TeamService, AdminTeamActionResponse>(
    actor,
    context,
    {
      action: "team.member.disabled",
      apply: async (service, keycloak) => {
        await keycloak.firstWrite(
          () => service.client.updateUserEnabled(id, false),
          id,
        )
        const member = await keycloak.readAfterWrite(() =>
          memberWithExpectedEnabledState(service, id, false),
        )
        return { member, status: "disabled" }
      },
      preflight: async (signal) => {
        const service = requireTeamService(signal)
        await assertCanMutateMember(actor, id, service)
        return service
      },
      targetIdentifier: id,
      targetType: "user",
    },
  )
}

export async function reactivateAdminTeamMember(
  actor: Actor,
  id: string,
  context: AdminTeamMutationContext,
): Promise<AdminTeamActionResponse> {
  return executeTeamIdentityMutation<TeamService, AdminTeamActionResponse>(
    actor,
    context,
    {
      action: "team.member.reactivated",
      apply: async (service, keycloak) => {
        await keycloak.firstWrite(
          () => service.client.updateUserEnabled(id, true),
          id,
        )
        const member = await keycloak.readAfterWrite(() =>
          memberWithExpectedEnabledState(service, id, true),
        )
        return { member, status: "reactivated" }
      },
      preflight: async (signal) => {
        const service = requireTeamService(signal)
        await memberById(service, id)
        return service
      },
      targetIdentifier: id,
      targetType: "user",
    },
  )
}

export async function deleteAdminTeamMember(
  actor: Actor,
  id: string,
  context: AdminTeamMutationContext,
): Promise<AdminTeamActionResponse> {
  return executeTeamIdentityMutation<TeamService, AdminTeamActionResponse>(
    actor,
    context,
    {
      action: "team.member.deleted",
      apply: async (service, keycloak) => {
        await keycloak.firstWrite(() => service.client.deleteUser(id), id)
        return { member: null, status: "deleted" }
      },
      preflight: async (signal) => {
        const service = requireTeamService(signal)
        await assertCanMutateMember(actor, id, service)
        return service
      },
      targetIdentifier: id,
      targetType: "user",
    },
  )
}

export async function createAdminTeamGroup(
  actor: Actor,
  request: CreateAdminTeamGroupRequest,
  context: AdminTeamMutationContext,
): Promise<AdminTeamGroupMutationResponse> {
  return executeTeamIdentityMutation<
    TeamService,
    AdminTeamGroupMutationResponse
  >(actor, context, {
    action: "team.group.created",
    apply: async (service, keycloak) => {
      const id = await keycloak.firstWrite(
        () => service.client.createGroup(request.name),
        (createdId) => createdId,
      )
      const group = await keycloak.readAfterWrite(() => groupById(service, id))
      return { group, status: "created" }
    },
    preflight: async (signal) => {
      const service = requireTeamService(signal)
      assertMutableGroupName(request.name)
      await assertGroupNameAvailable(service, request.name)
      return service
    },
    targetIdentifier: request.name.trim().toLowerCase(),
    targetType: "group",
  })
}

export async function updateAdminTeamGroup(
  actor: Actor,
  id: string,
  request: UpdateAdminTeamGroupRequest,
  context: AdminTeamMutationContext,
): Promise<AdminTeamGroupMutationResponse> {
  return executeTeamIdentityMutation<
    TeamService,
    AdminTeamGroupMutationResponse
  >(actor, context, {
    action: "team.group.updated",
    apply: async (service, keycloak) => {
      await keycloak.firstWrite(
        () => service.client.updateGroup(id, request.name),
        id,
      )
      const updated = await keycloak.readAfterWrite(() =>
        groupById(service, id),
      )
      return { group: updated, status: "updated" }
    },
    preflight: async (signal) => {
      assertMutableGroupId(id)
      const service = requireTeamService(signal)
      const group = await groupById(service, id)
      assertMutableGroup(group)
      assertMutableGroupName(request.name)
      if (group.name.toLowerCase() !== request.name.toLowerCase()) {
        await assertGroupNameAvailable(service, request.name)
      }
      return service
    },
    targetIdentifier: id,
    targetType: "group",
  })
}

export async function deleteAdminTeamGroup(
  actor: Actor,
  id: string,
  context: AdminTeamMutationContext,
): Promise<AdminTeamGroupMutationResponse> {
  return executeTeamIdentityMutation<
    TeamService,
    AdminTeamGroupMutationResponse
  >(actor, context, {
    action: "team.group.deleted",
    apply: async (service, keycloak) => {
      await keycloak.firstWrite(() => service.client.deleteGroup(id), id)
      return { group: null, status: "deleted" }
    },
    preflight: async (signal) => {
      assertMutableGroupId(id)
      const service = requireTeamService(signal)
      const group = await groupById(service, id)
      assertMutableGroup(group)
      return service
    },
    targetIdentifier: id,
    targetType: "group",
  })
}

export async function bulkAssignAdminTeamGroupMembers(
  actor: Actor,
  id: string,
  request: AdminTeamBulkGroupAssignmentRequest,
  context: AdminTeamMutationContext,
): Promise<AdminTeamGroupMutationResponse> {
  assertBatchSize(request.memberIds.length, "Team group assignment")
  assertUniqueMemberIds(request.memberIds)
  return executeTeamIdentityMutation<
    GroupMembershipMutationPreflight,
    AdminTeamGroupMutationResponse
  >(actor, context, {
    action: "team.group.member_assigned",
    apply: async (prepared, keycloak, targets) => {
      for (const [ordinal, memberId] of request.memberIds.entries()) {
        try {
          await targets.start(ordinal)
          const assign = () =>
            prepared.service.client.joinGroup(memberId, prepared.group.id)
          if (ordinal === 0) {
            await keycloak.firstWrite(assign, prepared.group.id)
          } else {
            await keycloak.writeAfterFirst(assign)
          }
          await keycloak.readAfterWrite(() =>
            assertGroupContainsMember(
              prepared.service,
              prepared.group.id,
              memberId,
            ),
          )
          await targets.applied(ordinal)
        } catch (error) {
          await targets.settleFailure(ordinal, error)
          throw error
        }
      }
      const updated = await keycloak.readAfterWrite(() =>
        groupById(prepared.service, id),
      )
      return { group: updated, status: "assigned" }
    },
    preflight: async (signal) => {
      assertMutableGroupId(id)
      const service = requireTeamService(signal)
      const group = await groupById(service, id)
      assertMutableGroup(group)
      return { group, service }
    },
    targetIdentifier: id,
    targets: (prepared) =>
      request.memberIds.map((memberId) => ({
        intent: {
          groupId: prepared.group.id,
          kind: "group_membership" as const,
          memberId,
        },
        targetIdentifier: membershipTargetIdentifier(
          prepared.group.id,
          memberId,
        ),
        targetType: "group_membership" as const,
      })),
    targetType: "group",
  })
}

export async function removeAdminTeamGroupMember(
  actor: Actor,
  id: string,
  memberId: string,
  context: AdminTeamMutationContext,
): Promise<AdminTeamGroupMutationResponse> {
  return executeTeamIdentityMutation<
    GroupMembershipMutationPreflight,
    AdminTeamGroupMutationResponse
  >(actor, context, {
    action: "team.group.member_removed",
    apply: async (prepared, keycloak) => {
      await keycloak.firstWrite(
        () => prepared.service.client.leaveGroup(memberId, prepared.group.id),
        prepared.group.id,
      )
      await keycloak.readAfterWrite(() =>
        assertGroupExcludesMember(
          prepared.service,
          prepared.group.id,
          memberId,
        ),
      )
      const updated = await keycloak.readAfterWrite(() =>
        groupById(prepared.service, id),
      )
      return { group: updated, status: "removed" }
    },
    preflight: async (signal) => {
      assertMutableGroupId(id)
      const service = requireTeamService(signal)
      const group = await groupById(service, id)
      assertMutableGroup(group)
      return { group, service }
    },
    targetIdentifier: membershipTargetIdentifier(id, memberId),
    targetType: "group",
  })
}

export async function previewAdminTeamCsvImport(
  actor: Actor,
  request: AdminTeamCsvImportPreviewRequest,
): Promise<AdminTeamCsvImportPreviewResponse> {
  assertCsvRowLimit(request.csv)
  const service = requireTeamService()
  const response = await buildCsvImportPreview(service, request.csv)
  await emitTeamAudit(actor, "team.csv_import.previewed")
  return response
}

export async function commitAdminTeamCsvImport(
  actor: Actor,
  request: AdminTeamCsvImportCommitRequest,
  context: AdminTeamMutationContext,
): Promise<AdminTeamCsvImportCommitResponse> {
  assertCsvRowLimit(request.csv)
  return executeTeamIdentityMutation<
    CsvImportMutationPreflight,
    AdminTeamCsvImportCommitResponse
  >(actor, context, {
    action: "team.csv_import.committed",
    apply: async (prepared, keycloak, targets) => {
      const rows: AdminTeamCsvImportRow[] = []
      let firstWrite = true
      let targetOrdinal = 0
      for (const row of prepared.preview.rows) {
        if (row.status !== "valid") {
          rows.push({ ...row, status: "skipped" })
          continue
        }
        const ordinal = targetOrdinal
        targetOrdinal += 1
        const targetIntent = csvUserTargetIntent(row)
        try {
          await targets.start(ordinal)
          const create = async () => {
            const createdId = await prepared.service.client.createUser({
              displayName: row.name,
              email: row.email,
              enabled: false,
              username: row.username,
            })
            await targets.recordResourceId(ordinal, createdId)
            return createdId
          }
          const userId = firstWrite
            ? await keycloak.firstWrite(create, (createdId) => createdId)
            : await keycloak.writeAfterFirst(create)
          firstWrite = false
          await keycloak.writeAfterFirst(() =>
            assignCanonicalRoleAndGroups(
              prepared.service,
              userId,
              row.role,
              row.group ? [row.group] : [],
            ),
          )
          await keycloak.readAfterWrite(() =>
            memberWithExpectedAuthority(
              prepared.service,
              userId,
              row.role,
              false,
              targetIntent.group ? [targetIntent.group] : [],
            ),
          )
          if (row.sendInvite) {
            await keycloak.writeAfterFirst(() =>
              prepared.service.client.executeEmailActions(userId, [
                "UPDATE_PASSWORD",
              ]),
            )
          }
          if (row.enabled) {
            await keycloak.writeAfterFirst(() =>
              prepared.service.client.updateUserEnabled(userId, true),
            )
          }
          await keycloak.readAfterWrite(() =>
            memberWithExpectedAuthority(
              prepared.service,
              userId,
              row.role,
              row.enabled,
              targetIntent.group ? [targetIntent.group] : [],
            ),
          )
          await targets.applied(ordinal)
          rows.push({ ...row, status: "created" })
        } catch (error) {
          await targets.settleFailure(ordinal, error)
          throw error
        }
      }
      return csvCommitResponse(rows)
    },
    preflight: async (signal) => {
      const service = requireTeamService(signal)
      const preview = await buildCsvImportPreview(service, request.csv)
      if (!preview.valid && !request.allowPartial) {
        throw new AdminTeamError(
          400,
          "CSV import preview contains invalid rows. Fix the CSV or explicitly allow partial import.",
        )
      }
      if (!preview.rows.some((row) => row.status === "valid")) {
        throw new AdminTeamError(
          400,
          "CSV import contains no valid users to create.",
        )
      }
      return { preview, service }
    },
    targetIdentifier: "csv-import",
    targets: (prepared) =>
      prepared.preview.rows
        .filter((row) => row.status === "valid")
        .map((row) => ({
          intent: csvUserTargetIntent(row),
          targetIdentifier: row.email.trim().toLowerCase(),
          targetType: "user" as const,
        })),
    targetType: "user",
  })
}

function csvCommitResponse(
  rows: AdminTeamCsvImportRow[],
): AdminTeamCsvImportCommitResponse {
  return {
    createdCount: rows.filter((row) => row.status === "created").length,
    failedCount: rows.filter((row) => row.status === "failed").length,
    generatedAt: new Date().toISOString(),
    rows,
    skippedCount: rows.filter((row) => row.status === "skipped").length,
    valid: rows.every((row) => row.status === "created"),
  }
}

function csvUserTargetIntent(row: AdminTeamCsvImportRow) {
  return {
    displayName: row.name.trim(),
    email: row.email.trim().toLowerCase(),
    enabled: row.enabled,
    group: row.group,
    kind: "csv_user" as const,
    line: row.line,
    role: row.role,
    sendInvite: row.sendInvite,
    username: row.username.trim().toLowerCase(),
  }
}

function assertCsvRowLimit(csv: string): void {
  if (Buffer.byteLength(csv, "utf8") > adminTeamCsvMaxBytes) {
    throw new AdminTeamError(
      400,
      `CSV import must not exceed ${adminTeamCsvMaxBytes} UTF-8 bytes.`,
    )
  }

  let dataRows = 0
  let lineIndex = 0
  let lineStart = 0
  for (let index = 0; index <= csv.length; index += 1) {
    if (index < csv.length && csv[index] !== "\n") {
      continue
    }
    const lineEnd =
      index > lineStart && csv[index - 1] === "\r" ? index - 1 : index
    if (lineIndex > 0 && csv.slice(lineStart, lineEnd).trim().length > 0) {
      dataRows += 1
      if (dataRows > TEAM_CSV_MAX_ROWS) {
        throw new AdminTeamError(
          400,
          `CSV import is limited to ${TEAM_CSV_MAX_ROWS} data rows per request.`,
        )
      }
    }
    lineIndex += 1
    lineStart = index + 1
  }
}

function assertBatchSize(count: number, subject: string): void {
  if (count < 1) {
    throw new AdminTeamError(400, "Select at least one Team member.")
  }
  if (count > adminTeamBatchLimit) {
    throw new AdminTeamError(
      400,
      `${subject} is limited to ${adminTeamBatchLimit} members per request.`,
    )
  }
}

function assertUniqueMemberIds(memberIds: string[]): void {
  if (new Set(memberIds).size !== memberIds.length) {
    throw new AdminTeamError(
      400,
      "Team group assignment cannot contain duplicate members.",
    )
  }
}

function membershipTargetIdentifier(groupId: string, memberId: string): string {
  const identifier = `group:${groupId.length}:${groupId}|member:${memberId.length}:${memberId}`
  if (identifier.length > 255) {
    throw new AdminTeamError(
      400,
      "Team group membership identifiers exceed the supported length.",
    )
  }
  return identifier
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
  const csvEmailCounts = new Map<string, number>()
  for (const row of parsed.rows) {
    const username = row.values.username?.trim().toLowerCase()
    if (username) {
      csvUsernameCounts.set(
        username,
        (csvUsernameCounts.get(username) ?? 0) + 1,
      )
    }
    const email = row.values.email?.trim().toLowerCase()
    if (email) {
      csvEmailCounts.set(email, (csvEmailCounts.get(email) ?? 0) + 1)
    }
  }

  const rows = parsed.rows.map((row) =>
    csvImportRowFromValues(
      service,
      row,
      groups,
      existingUsernames,
      csvUsernameCounts,
      csvEmailCounts,
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
  csvEmailCounts: Map<string, number>,
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
  } else if ((csvEmailCounts.get(email.toLowerCase()) ?? 0) > 1) {
    errors.push("Email is duplicated in the CSV.")
  } else {
    const emailError = workEmailError(service.config, email)
    if (emailError) {
      errors.push(emailError)
    }
  }
  if (group.toLowerCase() === "everyone") {
    errors.push("Everyone is not a user group. Choose a Team group.")
  } else if (group && !findGroup(groups, group)) {
    errors.push(`Unknown group: ${group}.`)
  }
  if (!role) {
    errors.push("Role must be admin or operator.")
  } else {
    if (!findCanonicalRoleGroup(groups, role)) {
      errors.push(
        `Canonical ${canonicalRoleGroupName(role)} role group is unavailable.`,
      )
    }
    const roleGroupError = roleGroupSelectionError(role, [group])
    if (roleGroupError) {
      errors.push(roleGroupError)
    }
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

function parseCsvRole(
  value: string | undefined,
): AdminTeamCsvImportRow["role"] | null {
  const role = value?.trim().toLowerCase()
  if (!role) {
    return "operator"
  }
  return role === "admin" || role === "operator" ? role : null
}

function parseCsvBoolean(
  value: string | undefined,
  fallback: boolean,
): boolean | null {
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

function workEmailError(
  config: KeycloakAdminConfig,
  email: string,
): string | null {
  if (config.allowedEmailDomains.length === 0) {
    return null
  }
  const domain = email.split("@")[1]?.toLowerCase()
  return domain && config.allowedEmailDomains.includes(domain)
    ? null
    : "A work email address is required."
}

async function listTeamMembers(
  service: TeamService,
): Promise<AdminTeamMember[]> {
  const users = await service.client.listUsers()
  const members = await Promise.all(
    users.map((user) => memberFromKeycloak(service, user)),
  )
  return members.filter((member): member is AdminTeamMember => member !== null)
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
  const members = await service.client.getGroupMembers(group.id).catch(() => [])
  return {
    id: group.id,
    memberCount: members.length,
    name: group.name,
    virtual: false,
  }
}

async function assertGroupContainsMember(
  service: TeamService,
  groupId: string,
  memberId: string,
): Promise<void> {
  const members = await service.client.getGroupMembers(groupId)
  if (!members.some((member) => member.id === memberId)) {
    throw new KeycloakAdminError(
      "invalid",
      `Keycloak group ${groupId} is missing the expected member postcondition.`,
    )
  }
}

async function assertGroupExcludesMember(
  service: TeamService,
  groupId: string,
  memberId: string,
): Promise<void> {
  const groups = await service.client.getUserGroups(memberId)
  if (groups.some((group) => group.id === groupId)) {
    throw new KeycloakAdminError(
      "invalid",
      `Keycloak group ${groupId} still contains the removed member postcondition.`,
    )
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
    service.client.getUserEffectiveRealmRoles(user.id),
  ])
  const classification = classifyRetainedRealmRoles(
    roles.map((item) => item.name),
  )
  if (
    classification.status === "ambiguous" ||
    classification.status === "invalid_case"
  ) {
    throw new KeycloakAdminError(
      "invalid",
      `Keycloak user ${user.id} does not have one exact retained appliance role.`,
    )
  }
  if (classification.status === "unclassified") {
    return null
  }
  return {
    createdAt: user.createdAt,
    displayName: user.displayName,
    email: user.email,
    enabled: user.enabled,
    groups: groups.map((group) => group.name),
    id: user.id,
    lastActiveAt: lastActiveAtFor(user),
    role: classification.role,
    status: user.enabled ? "active" : "disabled",
    username: user.username,
  }
}

async function assignCanonicalRoleAndGroups(
  service: TeamService,
  userId: string,
  role: CreateAdminTeamMemberRequest["role"],
  groups: string[],
): Promise<void> {
  const keycloakGroups = await service.client.listGroups()
  const canonicalGroup = findCanonicalRoleGroup(keycloakGroups, role)
  if (!canonicalGroup) {
    throw new KeycloakAdminError(
      "invalid",
      `Canonical ${canonicalRoleGroupName(role)} role group is unavailable.`,
    )
  }
  const selectedNames = [
    canonicalGroup.name,
    ...groups.filter(
      (group) =>
        group.toLowerCase() !== "everyone" &&
        group.toLowerCase() !== canonicalGroup.name.toLowerCase(),
    ),
  ]
  const assigned = new Set<string>()
  for (const groupName of selectedNames) {
    const group =
      groupName === canonicalGroup.name
        ? canonicalGroup
        : findGroup(keycloakGroups, groupName)
    if (!group) {
      throw new KeycloakAdminError(
        "invalid",
        `Keycloak Team group ${groupName} disappeared during assignment.`,
      )
    }
    if (assigned.has(group.id)) {
      continue
    }
    await service.client.joinGroup(userId, group.id)
    assigned.add(group.id)
  }
}

async function memberWithExpectedAuthority(
  service: TeamService,
  userId: string,
  role: CreateAdminTeamMemberRequest["role"],
  enabled: boolean,
  requiredGroups: string[] = [],
): Promise<AdminTeamMember> {
  const member = await memberById(service, userId)
  const canonicalGroup = canonicalRoleGroupName(role)
  const hasCanonicalGroup = member.groups.includes(canonicalGroup)
  const effectiveGroups = new Set(
    member.groups.map((group) => group.trim().toLowerCase()),
  )
  const hasRequiredGroups = requiredGroups.every((group) =>
    effectiveGroups.has(group.trim().toLowerCase()),
  )
  const hasContradictoryRoleGroup = member.groups.some((group) => {
    const retainedRole = retainedRoleForGroupName(group)
    return retainedRole !== null && retainedRole !== role
  })
  if (
    member.role !== role ||
    member.enabled !== enabled ||
    !hasCanonicalGroup ||
    !hasRequiredGroups ||
    hasContradictoryRoleGroup
  ) {
    throw new KeycloakAdminError(
      "invalid",
      `Keycloak user ${userId} failed canonical ${canonicalGroup} authority verification.`,
    )
  }
  return member
}

async function memberWithExpectedEnabledState(
  service: TeamService,
  userId: string,
  enabled: boolean,
): Promise<AdminTeamMember> {
  const member = await memberById(service, userId)
  if (member.enabled !== enabled) {
    throw new KeycloakAdminError(
      "invalid",
      `Keycloak user ${userId} failed the requested enabled-state postcondition.`,
    )
  }
  return member
}

function assertRoleGroupSelection(
  role: CreateAdminTeamMemberRequest["role"],
  groups: string[],
): void {
  const error = roleGroupSelectionError(role, groups)
  if (error) {
    throw new AdminTeamError(400, error)
  }
}

function roleGroupSelectionError(
  role: CreateAdminTeamMemberRequest["role"],
  groups: string[],
): string | null {
  const mismatched = groups.find((group) => {
    const retainedRole = retainedRoleForGroupName(group)
    return retainedRole !== null && retainedRole !== role
  })
  return mismatched
    ? `${mismatched} is a reserved ${capitalizeRole(retainedRoleForGroupName(mismatched) ?? role)} role group and cannot be combined with the selected ${capitalizeRole(role)} role.`
    : null
}

function retainedRoleForGroupName(
  name: string,
): CreateAdminTeamMemberRequest["role"] | null {
  const normalized = name.trim().toLowerCase()
  if (normalized === "admins") {
    return "admin"
  }
  if (normalized === "operators") {
    return "operator"
  }
  return null
}

function canonicalRoleGroupName(
  role: CreateAdminTeamMemberRequest["role"],
): "Admins" | "Operators" {
  return role === "admin" ? "Admins" : "Operators"
}

function findCanonicalRoleGroup(
  groups: KeycloakAdminGroup[],
  role: CreateAdminTeamMemberRequest["role"],
): KeycloakAdminGroup | null {
  const name = canonicalRoleGroupName(role)
  return groups.find((group) => group.name === name) ?? null
}

function capitalizeRole(
  role: CreateAdminTeamMemberRequest["role"],
): "Admin" | "Operator" {
  return role === "admin" ? "Admin" : "Operator"
}

async function assertAssignableGroups(
  service: TeamService,
  role: CreateAdminTeamMemberRequest["role"],
  groups: string[],
): Promise<void> {
  if (groups.some((group) => group.toLowerCase() === "everyone")) {
    throw new AdminTeamError(
      400,
      "Everyone is virtual and cannot be assigned to a Keycloak user.",
    )
  }
  const keycloakGroups = await service.client.listGroups()
  if (!findCanonicalRoleGroup(keycloakGroups, role)) {
    throw new AdminTeamError(
      503,
      `Canonical ${canonicalRoleGroupName(role)} role group is unavailable.`,
    )
  }
  const missing = groups.filter((groupName) => {
    return !findGroup(keycloakGroups, groupName)
  })
  if (missing.length > 0) {
    throw new AdminTeamError(400, `Unknown Team group: ${missing.join(", ")}.`)
  }
}

function firstClassifiedGroup(
  groups: string[],
  role: CreateAdminTeamMemberRequest["role"],
): string {
  return (
    groups.find((group) => retainedRoleForGroupName(group) === null) ??
    canonicalRoleGroupName(role)
  )
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

interface CreateMemberMutationPreflight {
  password: string | null
  service: TeamService
  username: string
}

interface MemberEmailMutationPreflight {
  member: AdminTeamMember
  service: TeamService
}

interface PasswordMutationPreflight {
  password: string
  service: TeamService
}

interface GroupMembershipMutationPreflight {
  group: AdminTeamGroup
  service: TeamService
}

interface CsvImportMutationPreflight {
  preview: AdminTeamCsvImportPreviewResponse
  service: TeamService
}

interface TeamIdentityMutationPlan<Preflight, Result> {
  action: string
  apply(
    preflight: Preflight,
    keycloak: KeycloakMutationPhase,
    targets: IdentityMutationTargetsPhase,
  ): Promise<Result>
  preflight(signal: AbortSignal): Promise<Preflight>
  targetIdentifier: string
  targets?(preflight: Preflight): IdentityMutationTargetInput[]
  targetType: IdentityMutationTargetType
}

async function executeTeamIdentityMutation<Preflight, Result>(
  actor: Actor,
  context: AdminTeamMutationContext,
  plan: TeamIdentityMutationPlan<Preflight, Result>,
): Promise<Result> {
  return executeJournaledIdentityMutation({
    apply: plan.apply,
    context,
    finalize: async () => emitTeamAudit(actor, plan.action),
    keycloakSubjectId: actor.subject,
    preflight: plan.preflight,
    targetIdentifier: plan.targetIdentifier,
    ...(plan.targets ? { targets: plan.targets } : {}),
    targetType: plan.targetType,
  })
}

async function prepareMemberEmailAction(
  id: string,
  signal: AbortSignal,
): Promise<{
  member: AdminTeamMember
  service: TeamService
}> {
  const service = requireTeamService(signal)
  const member = await memberById(service, id)
  assertWorkEmail(service.config, member.email)
  return { member, service }
}

function teamService(signal?: AbortSignal): TeamService | null {
  const configResult = keycloakAdminConfigFromEnv()
  if (configResult.status !== "ok") {
    return null
  }
  return {
    client: new KeycloakAdminClient(
      configResult.config,
      undefined,
      undefined,
      signal,
    ),
    config: configResult.config,
  }
}

function requireTeamService(signal?: AbortSignal): TeamService {
  const service = teamService(signal)
  if (!service) {
    throw new AdminTeamError(503, "Keycloak Admin API is not configured.")
  }
  return service
}

function assertWorkEmail(config: KeycloakAdminConfig, email: string): void {
  if (config.allowedEmailDomains.length === 0) {
    return
  }
  const domain = email.split("@")[1]?.toLowerCase()
  if (!domain || !config.allowedEmailDomains.includes(domain)) {
    throw new AdminTeamError(400, "A work email address is required.")
  }
}

async function assertCanMutateMember(
  actor: Actor,
  id: string,
  service: TeamService,
): Promise<void> {
  if (actor.subject === id) {
    throw new AdminTeamError(409, "Users cannot disable or delete themselves.")
  }
  const authorities = await service.client.listLiveHumanAuthorities()
  const target = authorities.find((authority) => authority.subject === id)
  if (!target) {
    throw new AdminTeamError(
      409,
      "Keycloak user does not have exactly one retained Admin or Operator role.",
    )
  }
  const enabledOperators = authorities.filter(
    (authority) => authority.enabled && authority.role === "operator",
  )
  if (
    target.enabled &&
    target.role === "operator" &&
    enabledOperators.length <= 1
  ) {
    throw new AdminTeamError(
      409,
      "The last enabled Operator is the appliance's recovery-ready Operator and cannot be disabled or deleted.",
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
  // PR-12 commissioning enforces that only these canonical named groups can
  // carry retained human roles; the BFF therefore guards that seeded invariant.
  if (retainedRoleForGroupName(group.name)) {
    throw new AdminTeamError(
      409,
      `${group.name} is a reserved role group and cannot be renamed, deleted, or changed through generic group membership actions.`,
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
  if (retainedRoleForGroupName(name)) {
    throw new AdminTeamError(
      409,
      "Admins and Operators are reserved role groups and cannot be created or used as generic Team group names.",
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
        "SCIM status is read-only in Console. Provisioning configuration remains private to the appliance identity service.",
      lastSyncAt: validIsoDate(optionalEnv("TEAM_SCIM_LAST_SYNC_AT")),
      provider,
      sourceStatus: "ok",
      status: "configured",
    }
  }

  return {
    detail: "SCIM synchronization is not configured for this appliance.",
    lastSyncAt: null,
    provider: null,
    sourceStatus: "not_configured",
    status: "not_configured",
  }
}

function everyoneGroup(memberCount: number): AdminTeamGroup {
  return {
    id: "everyone",
    memberCount,
    name: "Everyone",
    virtual: true,
  }
}

function recentActivityForMember(
  member: AdminTeamMember,
): AdminTeamMemberDetail["activity"] {
  return getCachedAuditEvents()
    .filter((event) =>
      event.keycloakSubjectId
        ? eventMatchesMember(event.keycloakSubjectId, member)
        : false,
    )
    .slice(0, 20)
    .map((event) => ({
      action: event.action,
      createdAt: event.createdAt,
      id: event.id,
      targetId: event.targetId,
      targetType: event.targetType,
    }))
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
    getCachedAuditEvents().find((event) =>
      event.keycloakSubjectId
        ? eventMatchesMember(event.keycloakSubjectId, {
            createdAt: user.createdAt,
            displayName: user.displayName,
            email: user.email,
            enabled: user.enabled,
            groups: [],
            id: user.id,
            lastActiveAt: null,
            role: "operator",
            status: user.enabled ? "active" : "disabled",
            username: user.username,
          })
        : false,
    )?.createdAt ?? null
  )
}

function generatePassword(): string {
  return `Llm-${randomBytes(12).toString("base64url")}-26`
}

async function emitTeamAudit(
  actor: Actor,
  action: string,
  outcome: "succeeded" | "failed" | "denied" = "succeeded",
): Promise<void> {
  await emitAudit({
    action,
    keycloakSubjectId: actor.subject,
    outcome,
    sourceSystem: "console",
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
