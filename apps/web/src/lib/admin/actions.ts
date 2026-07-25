"use server"

import { Buffer } from "node:buffer"
import { createHash, randomUUID } from "node:crypto"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import {
  adminConnectedAppSchema,
  adminConnectedAppCreateRequestSchema,
  adminConnectedAppCreateResponseSchema,
  adminConnectedAppPromotionResultSchema,
  adminConnectedAppRotateCredentialResultSchema,
  adminConnectedAppTestResultSchema,
  adminConnectorRegistryItemSchema,
  adminInferenceModelUpdateActionResponseSchema,
  adminMcpServerConnectionTestResponseSchema,
  adminSettingsResponseSchema,
  adminTeamActionResponseSchema,
  adminTeamBreakGlassSchema,
  adminTeamBulkGroupAssignmentRequestSchema,
  adminTeamCsvImportCommitResponseSchema,
  adminTeamCsvImportPreviewResponseSchema,
  adminTeamGroupMutationResponseSchema,
  adminTeamMemberMutationResponseSchema,
  deleteAdminTeamMemberRequestSchema,
  createAdminTeamGroupRequestSchema,
  createAdminTeamMemberRequestSchema,
  updateAdminTeamBreakGlassRequestSchema,
  updateAdminTeamGroupRequestSchema,
  knowledgeActionResponseSchema,
  type CreateKnowledgeCorpusRequest,
  type CreateAdminMcpServerRequest,
  type AdminConnectedApp,
  type AdminConnectedAppCredential,
  type KnowledgeActionResponse,
  type UpdateAdminMcpServerRequest,
  type AdminSettingsLanguage,
  type AdminSettingsLogoAsset,
  type AdminTeamCsvImportCommitResponse,
  type AdminTeamCsvImportPreviewResponse,
  type AdminUrlPolicyRuleScope,
  type AdminUrlPolicyRuleStatus,
  type AdminUrlPolicyRuleType,
  type Persona,
} from "@llm-machines/contracts"
import { auth } from "@/lib/auth/auth"
import { getBffRequest } from "@/lib/bff/server-request"
import { validateKnowledgeUploadCandidates } from "@/lib/knowledge/upload-policy"

export async function updateAdminSettingsOrganizationAction(
  formData: FormData,
): Promise<void> {
  await requireAuth()
  const fallback = settingsReturnHref(formData)
  const organizationName = requiredFormValue(formData, "organizationName")
  const defaultLanguage = parseAdminSettingsLanguage(
    requiredFormValue(formData, "defaultLanguage"),
  )
  let fullLogo: AdminSettingsLogoAsset | null | undefined
  let iconLogo: AdminSettingsLogoAsset | null | undefined

  try {
    fullLogo = await settingsLogoAssetFromForm(formData, "fullLogo")
    iconLogo = await settingsLogoAssetFromForm(formData, "iconLogo")
  } catch {
    redirectTo(withActionStatus(fallback, "settingsAction", "invalidLogo"))
  }

  try {
    await postAdminSettingsMutation("/api/admin/settings/organization", {
      defaultLanguage,
      fullLogo,
      iconLogo,
      organizationName,
    })
  } catch {
    redirectTo(withActionStatus(fallback, "settingsAction", "failed"))
  }

  revalidatePath("/settings")
  redirectTo(withActionStatus(fallback, "settingsAction", "organizationSaved"))
}

export async function createAdminSettingsUrlPolicyRuleAction(
  formData: FormData,
): Promise<void> {
  await requireAuth()
  const fallback = settingsReturnHref(formData)

  try {
    await postAdminSettingsMutation("/api/admin/settings/url-policy/rules", {
      pattern: requiredFormValue(formData, "pattern"),
      reason: requiredFormValue(formData, "reason"),
      scope: parseAdminUrlPolicyRuleScope(optionalFormValue(formData, "scope")),
      type: parseAdminUrlPolicyRuleType(requiredFormValue(formData, "type")),
    })
  } catch (error) {
    redirectTo(
      withActionStatus(
        fallback,
        "settingsAction",
        isDuplicateMutationError(error) ? "duplicateUrlRule" : "failed",
      ),
    )
  }

  revalidatePath("/settings")
  redirectTo(withActionStatus(fallback, "settingsAction", "urlRuleCreated"))
}

export async function updateAdminSettingsUrlPolicyRuleAction(
  formData: FormData,
): Promise<void> {
  await requireAuth()
  const fallback = settingsReturnHref(formData)
  const ruleId = requiredFormValue(formData, "ruleId")

  try {
    await postAdminSettingsMutation(
      `/api/admin/settings/url-policy/rules/${encodeURIComponent(
        ruleId,
      )}/update`,
      {
        pattern: requiredFormValue(formData, "pattern"),
        reason: requiredFormValue(formData, "reason"),
        scope: parseAdminUrlPolicyRuleScope(
          optionalFormValue(formData, "scope"),
        ),
        status: parseAdminUrlPolicyRuleStatus(
          optionalFormValue(formData, "status"),
        ),
        type: parseAdminUrlPolicyRuleType(requiredFormValue(formData, "type")),
      },
    )
  } catch (error) {
    redirectTo(
      withActionStatus(
        fallback,
        "settingsAction",
        isDuplicateMutationError(error) ? "duplicateUrlRule" : "failed",
      ),
    )
  }

  revalidatePath("/settings")
  redirectTo(withActionStatus(fallback, "settingsAction", "urlRuleUpdated"))
}

export async function disableAdminSettingsUrlPolicyRuleAction(
  formData: FormData,
): Promise<void> {
  await requireAuth()
  const fallback = settingsReturnHref(formData)
  const ruleId = requiredFormValue(formData, "ruleId")

  try {
    await postAdminSettingsMutation(
      `/api/admin/settings/url-policy/rules/${encodeURIComponent(
        ruleId,
      )}/disable`,
      undefined,
    )
  } catch {
    redirectTo(withActionStatus(fallback, "settingsAction", "failed"))
  }

  revalidatePath("/settings")
  redirectTo(withActionStatus(fallback, "settingsAction", "urlRuleDisabled"))
}

export async function deleteAdminSettingsUrlPolicyRuleAction(
  formData: FormData,
): Promise<void> {
  await requireAuth()
  const fallback = settingsReturnHref(formData)
  const ruleId = requiredFormValue(formData, "ruleId")

  try {
    await postAdminSettingsMutation(
      `/api/admin/settings/url-policy/rules/${encodeURIComponent(
        ruleId,
      )}/delete`,
      undefined,
    )
  } catch {
    redirectTo(withActionStatus(fallback, "settingsAction", "failed"))
  }

  revalidatePath("/settings")
  redirectTo(withActionStatus(fallback, "settingsAction", "urlRuleDeleted"))
}

export async function updateAdminSettingsTelemetryAction(
  formData: FormData,
): Promise<void> {
  await requireAuth()
  const fallback = settingsReturnHref(formData)
  const enabled = checkboxFormValue(formData, "enabled")

  try {
    await postAdminSettingsMutation("/api/admin/settings/telemetry", {
      confirmation: optionalFormValue(formData, "confirmation") ?? undefined,
      enabled,
    })
  } catch {
    redirectTo(withActionStatus(fallback, "settingsAction", "failed"))
  }

  revalidatePath("/settings")
  redirectTo(
    withActionStatus(
      fallback,
      "settingsAction",
      enabled ? "telemetryEnabled" : "telemetryDisabled",
    ),
  )
}

export async function applyAdminInferenceModelUpdateAction(
  formData: FormData,
): Promise<void> {
  await requireAuth()
  const fallback = inferenceReturnHref(formData)
  const confirmation = requiredFormValue(formData, "confirmation")
  let result: Awaited<ReturnType<typeof postAdminInferenceMutation>>

  try {
    result = await postAdminInferenceMutation(
      "/api/admin/inference/model-updates/apply",
      { confirmation },
    )
  } catch {
    redirectTo(withActionStatus(fallback, "inferenceAction", "failed"))
  }

  revalidatePath("/inference")
  redirectTo(withActionStatus(fallback, "inferenceAction", result.status))
}

export interface TeamMemberActionState {
  error: string | null
  generatedPassword: string | null
  memberId: string | null
  status:
    | "idle"
    | "created"
    | "generated"
    | "sent"
    | "disabled"
    | "reactivated"
    | "deleted"
    | "failed"
}

export interface TeamCsvImportActionState {
  commit: AdminTeamCsvImportCommitResponse | null
  csv: string
  error: string | null
  preview: AdminTeamCsvImportPreviewResponse | null
  status: "committed" | "failed" | "idle" | "invalid" | "previewed"
}

export async function createAdminTeamMemberAction(
  _previousState: TeamMemberActionState,
  formData: FormData,
): Promise<TeamMemberActionState> {
  await requireAuth()
  let request: ReturnType<typeof createAdminTeamMemberRequestSchema.parse>
  try {
    const displayName = requiredFormValue(formData, "displayName")
    const groups = teamGroupsFromForm(formData)
    if (groups.length === 0) {
      return {
        error: "Select a Team group before creating the user.",
        generatedPassword: null,
        memberId: null,
        status: "failed",
      }
    }

    request = createAdminTeamMemberRequestSchema.parse({
      displayName,
      email: requiredFormValue(formData, "email"),
      enabled: true,
      generatePassword: checkboxFormValue(formData, "generatePassword"),
      groups,
      role: parsePersona(requiredFormValue(formData, "role")),
      sendInvite: checkboxFormValue(formData, "sendInvite"),
      username: generatedTeamUsername(displayName, groups[0]),
    })
  } catch {
    return {
      error: "Name, corporate email, role, and group are required.",
      generatedPassword: null,
      memberId: null,
      status: "failed",
    }
  }

  try {
    const result = await postAdminTeamMemberMutation(
      "/api/admin/team/members",
      request,
    )
    revalidatePath("/team")
    revalidatePath(`/team/members/${result.member.id}`)
    return {
      error: null,
      generatedPassword: result.generatedPassword,
      memberId: result.member.id,
      status: "created",
    }
  } catch (error) {
    return {
      error: adminMutationErrorDetail(
        error,
        "Team member could not be created.",
      ),
      generatedPassword: null,
      memberId: null,
      status: "failed",
    }
  }
}

export async function sendAdminTeamInviteAction(
  formData: FormData,
): Promise<void> {
  await requireAuth()
  const memberId = requiredFormValue(formData, "memberId")
  const fallback = teamReturnHref(formData, `/team/members/${memberId}`)

  try {
    await postAdminTeamActionMutation(
      `/api/admin/team/members/${encodeURIComponent(memberId)}/invite`,
      undefined,
    )
  } catch {
    redirectTo(withActionStatus(fallback, "teamAction", "failed"))
  }

  revalidatePath("/team")
  redirectTo(withActionStatus(fallback, "teamAction", "inviteSent"))
}

export async function sendAdminTeamPasswordResetAction(
  formData: FormData,
): Promise<void> {
  await requireAuth()
  const memberId = requiredFormValue(formData, "memberId")
  const fallback = teamReturnHref(formData, `/team/members/${memberId}`)

  try {
    await postAdminTeamActionMutation(
      `/api/admin/team/members/${encodeURIComponent(
        memberId,
      )}/reset-password-email`,
      undefined,
    )
  } catch {
    redirectTo(withActionStatus(fallback, "teamAction", "failed"))
  }

  revalidatePath("/team")
  redirectTo(withActionStatus(fallback, "teamAction", "passwordResetSent"))
}

export async function generateAdminTeamPasswordAction(
  _previousState: TeamMemberActionState,
  formData: FormData,
): Promise<TeamMemberActionState> {
  await requireAuth()
  const memberId = requiredFormValue(formData, "memberId")

  try {
    const result = await postAdminTeamMemberMutation(
      `/api/admin/team/members/${encodeURIComponent(
        memberId,
      )}/generate-password`,
      undefined,
    )
    revalidatePath("/team")
    revalidatePath(`/team/members/${memberId}`)
    return {
      error: null,
      generatedPassword: result.generatedPassword,
      memberId: result.member.id,
      status: "generated",
    }
  } catch {
    return {
      error: "Password could not be generated.",
      generatedPassword: null,
      memberId,
      status: "failed",
    }
  }
}

export async function disableAdminTeamMemberAction(
  formData: FormData,
): Promise<void> {
  await requireAuth()
  const memberId = requiredFormValue(formData, "memberId")
  const fallback = teamReturnHref(formData, `/team/members/${memberId}`)

  try {
    await postAdminTeamActionMutation(
      `/api/admin/team/members/${encodeURIComponent(memberId)}/disable`,
      undefined,
    )
  } catch {
    redirectTo(withActionStatus(fallback, "teamAction", "failed"))
  }

  revalidatePath("/team")
  redirectTo(withActionStatus(fallback, "teamAction", "disabled"))
}

export async function reactivateAdminTeamMemberAction(
  formData: FormData,
): Promise<void> {
  await requireAuth()
  const memberId = requiredFormValue(formData, "memberId")
  const fallback = teamReturnHref(formData, `/team/members/${memberId}`)

  try {
    await postAdminTeamActionMutation(
      `/api/admin/team/members/${encodeURIComponent(memberId)}/reactivate`,
      undefined,
    )
  } catch {
    redirectTo(withActionStatus(fallback, "teamAction", "failed"))
  }

  revalidatePath("/team")
  redirectTo(withActionStatus(fallback, "teamAction", "reactivated"))
}

export async function deleteAdminTeamMemberAction(
  formData: FormData,
): Promise<void> {
  await requireAuth()
  const memberId = requiredFormValue(formData, "memberId")
  const fallback = teamReturnHref(formData, `/team/members/${memberId}`)
  const confirmation = requiredFormValue(formData, "confirmation")

  if (confirmation !== "DELETE") {
    redirectTo(withActionStatus(fallback, "teamAction", "deleteConfirmation"))
  }
  const request = deleteAdminTeamMemberRequestSchema.parse({ confirmation })

  try {
    await postAdminTeamActionMutation(
      `/api/admin/team/members/${encodeURIComponent(memberId)}/delete`,
      request,
    )
  } catch {
    redirectTo(withActionStatus(fallback, "teamAction", "failed"))
  }

  revalidatePath("/team")
  redirectTo(
    withActionStatus(
      fallback === `/team/members/${memberId}` ? "/team" : fallback,
      "teamAction",
      "deleted",
    ),
  )
}

export async function createAdminTeamGroupAction(
  formData: FormData,
): Promise<void> {
  await requireAuth()
  const request = createAdminTeamGroupRequestSchema.parse({
    name: requiredFormValue(formData, "name"),
  })
  const fallback = teamReturnHref(formData, "/team/groups/new")
  let groupId: string | null = null

  try {
    const result = await postAdminTeamGroupMutation(
      "/api/admin/team/groups",
      request,
    )
    if (!result.group) {
      throw new Error("Team group create response did not include a group.")
    }
    groupId = result.group.id
    revalidatePath("/team")
    revalidatePath("/team/groups")
  } catch {
    redirectTo(withActionStatus(fallback, "teamAction", "failed"))
  }
  redirectTo(
    withActionStatus(
      `/team/groups/${encodeURIComponent(groupId ?? "")}`,
      "teamAction",
      "groupCreated",
    ),
  )
}

export async function updateAdminTeamGroupAction(
  formData: FormData,
): Promise<void> {
  await requireAuth()
  const groupId = requiredFormValue(formData, "groupId")
  const fallback = teamReturnHref(formData, `/team/groups/${groupId}`)
  const request = updateAdminTeamGroupRequestSchema.parse({
    name: requiredFormValue(formData, "name"),
  })

  try {
    await postAdminTeamGroupMutation(
      `/api/admin/team/groups/${encodeURIComponent(groupId)}/update`,
      request,
    )
  } catch {
    redirectTo(withActionStatus(fallback, "teamAction", "failed"))
  }

  revalidatePath("/team")
  revalidatePath(`/team/groups/${groupId}`)
  redirectTo(withActionStatus(fallback, "teamAction", "groupUpdated"))
}

export async function deleteAdminTeamGroupAction(
  formData: FormData,
): Promise<void> {
  await requireAuth()
  const groupId = requiredFormValue(formData, "groupId")
  const fallback = teamReturnHref(formData, `/team/groups/${groupId}`)
  const confirmation = requiredFormValue(formData, "confirmation")

  if (confirmation !== "DELETE") {
    redirectTo(
      withActionStatus(fallback, "teamAction", "groupDeleteConfirmation"),
    )
  }

  try {
    await postAdminTeamGroupMutation(
      `/api/admin/team/groups/${encodeURIComponent(groupId)}/delete`,
      undefined,
    )
  } catch {
    redirectTo(withActionStatus(fallback, "teamAction", "failed"))
  }

  revalidatePath("/team")
  revalidatePath("/team/groups")
  redirectTo(withActionStatus("/team", "teamAction", "groupDeleted"))
}

export async function bulkAssignAdminTeamGroupMembersAction(
  formData: FormData,
): Promise<void> {
  await requireAuth()
  const groupId = requiredFormValue(formData, "groupId")
  const fallback = teamReturnHref(formData, `/team/groups/${groupId}`)
  const request = adminTeamBulkGroupAssignmentRequestSchema.safeParse({
    memberIds: formData.getAll("memberIds").flatMap((value) => {
      const memberId = String(value)
      return memberId ? [memberId] : []
    }),
  })
  if (!request.success) {
    redirectTo(withActionStatus(fallback, "teamAction", "missingSelection"))
  }

  try {
    await postAdminTeamGroupMutation(
      `/api/admin/team/groups/${encodeURIComponent(
        groupId,
      )}/members/bulk-assign`,
      request.data,
    )
  } catch {
    redirectTo(withActionStatus(fallback, "teamAction", "failed"))
  }

  revalidatePath("/team")
  revalidatePath(`/team/groups/${groupId}`)
  redirectTo(withActionStatus(fallback, "teamAction", "groupMembersAssigned"))
}

export async function removeAdminTeamGroupMemberAction(
  formData: FormData,
): Promise<void> {
  await requireAuth()
  const groupId = requiredFormValue(formData, "groupId")
  const memberId = requiredFormValue(formData, "memberId")
  const fallback = teamReturnHref(formData, `/team/groups/${groupId}`)

  try {
    await postAdminTeamGroupMutation(
      `/api/admin/team/groups/${encodeURIComponent(
        groupId,
      )}/members/${encodeURIComponent(memberId)}/remove`,
      undefined,
    )
  } catch {
    redirectTo(withActionStatus(fallback, "teamAction", "failed"))
  }

  revalidatePath("/team")
  revalidatePath(`/team/groups/${groupId}`)
  redirectTo(withActionStatus(fallback, "teamAction", "groupMemberRemoved"))
}

export async function updateAdminTeamBreakGlassAction(
  formData: FormData,
): Promise<void> {
  await requireAuth()
  const fallback = teamReturnHref(formData, "/team")
  const request = updateAdminTeamBreakGlassRequestSchema.parse({
    selectedAdminId: requiredFormValue(formData, "selectedAdminId"),
  })

  try {
    await postAdminTeamBreakGlassMutation(
      "/api/admin/team/break-glass",
      request,
    )
  } catch {
    redirectTo(withActionStatus(fallback, "teamAction", "failed"))
  }

  revalidatePath("/team")
  redirectTo(withActionStatus(fallback, "teamAction", "breakGlassUpdated"))
}

export async function previewAdminTeamCsvImportAction(
  _previousState: TeamCsvImportActionState,
  formData: FormData,
): Promise<TeamCsvImportActionState> {
  await requireAuth()
  const csv = await csvTextFromForm(formData)
  if (!csv) {
    return emptyCsvImportState("CSV file is required.")
  }

  try {
    const preview = await postAdminTeamCsvImportPreviewMutation(
      "/api/admin/team/import/preview",
      { csv },
    )
    return {
      commit: null,
      csv,
      error: null,
      preview,
      status: preview.valid ? "previewed" : "invalid",
    }
  } catch {
    return emptyCsvImportState("CSV import preview failed.")
  }
}

export async function commitAdminTeamCsvImportAction(
  _previousState: TeamCsvImportActionState,
  formData: FormData,
): Promise<TeamCsvImportActionState> {
  await requireAuth()
  const csv = requiredFormValue(formData, "csv")
  const allowPartial = checkboxFormValue(formData, "allowPartial")

  try {
    const commit = await postAdminTeamCsvImportCommitMutation(
      "/api/admin/team/import/commit",
      { allowPartial, csv },
    )
    revalidatePath("/team")
    revalidatePath("/team/groups")
    return {
      commit,
      csv,
      error: null,
      preview: commit,
      status: "committed",
    }
  } catch {
    return {
      commit: null,
      csv,
      error:
        "CSV import commit failed. Fix invalid rows or explicitly allow partial import.",
      preview: null,
      status: "failed",
    }
  }
}

export async function saveAdminMcpServerAction(
  formData: FormData,
): Promise<void> {
  await requireAuth()
  const fallback = mcpServerReturnHref(formData)
  const request = parseAdminMcpServerForm(formData)

  try {
    await postAdminMcpServerMutation("/api/admin/mcp-servers", request)
  } catch (error) {
    redirectTo(
      withActionStatus(
        fallback,
        "mcpAction",
        isDuplicateMutationError(error) ? "duplicate" : "failed",
      ),
    )
  }

  revalidatePath("/applications")
  redirectTo(withActionStatus("/applications", "mcpAction", "saved"))
}

export async function testAdminMcpServerConnectionAction(
  formData: FormData,
): Promise<void> {
  await requireAuth()
  const fallback = mcpServerReturnHref(formData)
  const request = parseAdminMcpServerForm(formData)
  let actionStatus = "failed"

  try {
    const result = await postAdminMcpServerConnectionTestMutation(
      "/api/admin/mcp-servers/test-connection",
      request,
    )
    actionStatus = result.status === "passed" ? "tested" : result.status
  } catch {
    redirectTo(withActionStatus(fallback, "mcpAction", "failed"))
  }

  redirectTo(withActionStatus(fallback, "mcpAction", actionStatus))
}

export async function updateAdminMcpServerAction(
  formData: FormData,
): Promise<void> {
  await requireAuth()
  const connectorId = requiredFormValue(formData, "connectorId")
  const fallback = mcpServerReturnHref(formData)
  const request = parseUpdateAdminMcpServerForm(formData)

  try {
    await postAdminMcpServerMutation(
      `/api/admin/mcp-servers/${encodeURIComponent(connectorId)}/update`,
      request,
    )
  } catch {
    redirectTo(withActionStatus(fallback, "mcpAction", "failed"))
  }

  revalidatePath("/applications")
  redirectTo(withActionStatus(fallback, "mcpAction", "updated"))
}

export interface ConnectedAppCreateActionState {
  app: AdminConnectedApp | null
  credential: AdminConnectedAppCredential | null
  error: string | null
  status: "created" | "failed" | "idle"
}

export interface ConnectedAppTestActionState {
  app: AdminConnectedApp | null
  detail: string | null
  error: string | null
  status: "blocked" | "failed" | "idle" | "passed"
  testedAt: string | null
}

export interface ConnectedAppCredentialActionState {
  app: AdminConnectedApp | null
  credential: AdminConnectedAppCredential | null
  detail: string | null
  error: string | null
  status: "blocked" | "failed" | "idle" | "promoted" | "rotated"
}

export async function createAdminConnectedAppAction(
  _previousState: ConnectedAppCreateActionState,
  formData: FormData,
): Promise<ConnectedAppCreateActionState> {
  await requireAuth()
  const parsed = adminConnectedAppCreateRequestSchema.safeParse({
    allowedModels: formData.getAll("allowedModels").flatMap((value) => {
      if (typeof value !== "string") {
        return []
      }
      const model = value.trim()
      return model ? [model] : []
    }),
    authMethod: optionalFormValue(formData, "authMethod") ?? "api_key",
    description: optionalFormValue(formData, "description") ?? "",
    name: optionalFormValue(formData, "name") ?? "",
    ownerGroup: optionalFormValue(formData, "ownerGroup") ?? "Everyone",
    rateLimitRpm: parseOptionalPositiveInt(
      optionalFormValue(formData, "rateLimitRpm"),
    ),
    tokenBudget7d: parseOptionalPositiveInt(
      optionalFormValue(formData, "tokenBudget7d"),
    ),
  })

  if (!parsed.success) {
    return {
      app: null,
      credential: null,
      error: "Complete the app name, description, and model access.",
      status: "failed",
    }
  }

  try {
    const result = await postAdminConnectedAppCreateMutation(
      "/api/admin/applications/connected-apps",
      parsed.data,
    )
    revalidatePath("/applications")
    revalidatePath(`/applications/apps/${result.app.id}`)
    return {
      app: result.app,
      credential: result.credential,
      error: null,
      status: "created",
    }
  } catch {
    return {
      app: null,
      credential: null,
      error:
        "Connected app could not be created. Check Keycloak app credentials and retry.",
      status: "failed",
    }
  }
}

export async function testAdminConnectedAppConnectionAction(
  _previousState: ConnectedAppTestActionState,
  formData: FormData,
): Promise<ConnectedAppTestActionState> {
  await requireAuth()
  const appId = requiredFormValue(formData, "appId")

  try {
    const result = await postAdminConnectedAppTestMutation(
      `/api/admin/applications/connected-apps/${encodeURIComponent(appId)}/test`,
    )
    revalidatePath("/applications")
    revalidatePath(`/applications/apps/${result.app.id}`)
    return {
      app: result.app,
      detail: result.detail,
      error: null,
      status: result.status,
      testedAt: result.testedAt,
    }
  } catch {
    return {
      app: null,
      detail: null,
      error:
        "Connection test failed before the app reached production readiness.",
      status: "failed",
      testedAt: null,
    }
  }
}

export async function promoteAdminConnectedAppProductionAction(
  _previousState: ConnectedAppCredentialActionState,
  formData: FormData,
): Promise<ConnectedAppCredentialActionState> {
  await requireAuth()
  const appId = requiredFormValue(formData, "appId")

  try {
    const result = await postAdminConnectedAppPromotionMutation(
      `/api/admin/applications/connected-apps/${encodeURIComponent(
        appId,
      )}/promote-production`,
    )
    revalidatePath("/applications")
    revalidatePath(`/applications/apps/${result.app.id}`)
    return {
      app: result.app,
      credential: result.credential ?? null,
      detail: result.detail,
      error: null,
      status: result.status,
    }
  } catch {
    return {
      app: null,
      credential: null,
      detail: null,
      error:
        "Production promotion is blocked until staging has a passing test.",
      status: "failed",
    }
  }
}

export async function rotateAdminConnectedAppCredentialsAction(
  _previousState: ConnectedAppCredentialActionState,
  formData: FormData,
): Promise<ConnectedAppCredentialActionState> {
  await requireAuth()
  const appId = requiredFormValue(formData, "appId")

  try {
    const result = await postAdminConnectedAppRotateMutation(
      `/api/admin/applications/connected-apps/${encodeURIComponent(
        appId,
      )}/rotate-credentials`,
    )
    revalidatePath("/applications")
    revalidatePath(`/applications/apps/${result.app.id}`)
    return {
      app: result.app,
      credential: result.credential,
      detail: result.detail,
      error: null,
      status: result.status,
    }
  } catch {
    return {
      app: null,
      credential: null,
      detail: null,
      error: "Credential rotation failed.",
      status: "failed",
    }
  }
}

export async function disableAdminConnectedAppAction(
  formData: FormData,
): Promise<void> {
  await requireAuth()
  const appId = requiredFormValue(formData, "appId")
  const fallback = connectedAppReturnHref(formData, appId)

  try {
    await postAdminConnectedAppDisableMutation(
      `/api/admin/applications/connected-apps/${encodeURIComponent(
        appId,
      )}/disable`,
    )
  } catch {
    redirectTo(withActionStatus(fallback, "appAction", "failed"))
  }

  revalidatePath("/applications")
  revalidatePath(`/applications/apps/${appId}`)
  redirectTo(withActionStatus(fallback, "appAction", "disabled"))
}

export async function createKnowledgeCorpusAction(
  formData: FormData,
): Promise<void> {
  await requireAuth()
  const fallback = knowledgeBaseHref(formData)
  let result: Awaited<ReturnType<typeof postAdminKnowledgeMutation>>
  const request: CreateKnowledgeCorpusRequest = {
    accessGroups: parseAccessGroups(
      optionalFormValue(formData, "accessGroups"),
    ),
    description: optionalFormValue(formData, "description") ?? "",
    languageHints: parseCommaList(optionalFormValue(formData, "languageHints")),
    name: requiredFormValue(formData, "name"),
  }

  try {
    result = await postAdminKnowledgeMutation(
      "/api/admin/knowledge/corpora",
      request,
    )
  } catch {
    redirectTo(withActionStatus(fallback, "knowledgeAction", "failed"))
  }

  revalidatePath("/knowledge")
  redirectTo(
    withActionStatus(
      knowledgeHref(result.corpus.id, fallback, "overview"),
      "knowledgeAction",
      "created",
    ),
  )
}

export async function addKnowledgeUrlSourceAction(
  formData: FormData,
): Promise<void> {
  await requireAuth()
  const corpusId = requiredFormValue(formData, "corpusId")
  const fallback = knowledgeHrefFromForm(formData, corpusId)

  try {
    await postAdminKnowledgeMutation(
      `/api/admin/knowledge/corpora/${encodeURIComponent(corpusId)}/sources/url`,
      {
        acquisitionMode:
          optionalFormValue(formData, "acquisitionMode") ?? "single_page",
        scraper: optionalFormValue(formData, "scraper") ?? "safe_fetch",
        title: optionalFormValue(formData, "title") ?? undefined,
        url: requiredFormValue(formData, "url"),
      },
    )
  } catch (error) {
    redirectTo(
      withActionStatus(
        fallback,
        "knowledgeAction",
        isDuplicateMutationError(error) ? "duplicateUrl" : "failed",
      ),
    )
  }

  revalidatePath("/knowledge")
  redirectTo(withActionStatus(fallback, "knowledgeAction", "sourceAdded"))
}

export async function addKnowledgeUploadSourceAction(
  formData: FormData,
): Promise<void> {
  await requireAuth()
  const corpusId = requiredFormValue(formData, "corpusId")
  const fallback = knowledgeHrefFromForm(formData, corpusId)
  let files: File[] = []
  let added = 0
  let failed = 0
  let actionStatus = "sourcesAdded"
  let validationRejected = false
  let duplicateRejected = false

  try {
    files = requiredFiles(formData)
    const validation = validateKnowledgeUploadCandidates(
      files.map((file) => ({
        name: file.name,
        size: file.size,
      })),
    )
    if (!validation.valid) {
      validationRejected = true
      actionStatus = "failed"
      failed = files.length
      throw new Error(validation.errors.join(" "))
    }

    const uploadResults = await Promise.all(
      files.map(async (file) => {
        try {
          await postAdminKnowledgeMutation(
            `/api/admin/knowledge/corpora/${encodeURIComponent(
              corpusId,
            )}/sources/upload`,
            {
              contentBase64: Buffer.from(await file.arrayBuffer()).toString(
                "base64",
              ),
              fileName: file.name,
              mimeType: file.type || "application/octet-stream",
              title: optionalFormValue(formData, "title") ?? undefined,
            },
          )
          return { duplicate: false, success: true }
        } catch (error) {
          return {
            duplicate: isDuplicateMutationError(error),
            success: false,
          }
        }
      }),
    )
    added = uploadResults.filter((result) => result.success).length
    failed = uploadResults.length - added
    duplicateRejected = uploadResults.some((result) => result.duplicate)

    if (added === 0) {
      actionStatus = duplicateRejected ? "duplicateUpload" : "failed"
    } else if (failed > 0) {
      actionStatus = duplicateRejected
        ? "partialDuplicateUpload"
        : "partialSourcesAdded"
    }
  } catch {
    if (!validationRejected) {
      actionStatus = "failed"
      failed = Math.max(failed, files.length, 1)
    }
  }

  revalidatePath("/knowledge")
  redirectTo(
    withKnowledgeUploadStatus(
      withActionStatus(fallback, "knowledgeAction", actionStatus),
      added,
      failed,
    ),
  )
}

export async function ingestKnowledgeCorpusAction(
  formData: FormData,
): Promise<void> {
  await requireAuth()
  const corpusId = requiredFormValue(formData, "corpusId")
  const fallback = knowledgeHrefFromForm(formData, corpusId)
  let actionStatus: string

  try {
    const response = await postAdminKnowledgeMutation(
      `/api/admin/knowledge/corpora/${encodeURIComponent(corpusId)}/ingest`,
      undefined,
    )
    actionStatus = knowledgeIngestActionStatus(response)
  } catch {
    redirectTo(withActionStatus(fallback, "knowledgeAction", "failed"))
  }

  revalidatePath("/knowledge")
  redirectTo(withActionStatus(fallback, "knowledgeAction", actionStatus))
}

export async function refreshKnowledgeCorpusAction(
  formData: FormData,
): Promise<void> {
  await requireAuth()
  const corpusId = requiredFormValue(formData, "corpusId")
  const fallback = knowledgeHrefFromForm(formData, corpusId)
  await runKnowledgeCorpusAction(corpusId, "refresh", fallback, "refreshed")
}

export async function disableKnowledgeCorpusAction(
  formData: FormData,
): Promise<void> {
  await requireAuth()
  const corpusId = requiredFormValue(formData, "corpusId")
  const fallback = knowledgeHrefFromForm(formData, corpusId)
  await runKnowledgeCorpusAction(corpusId, "disable", fallback, "disabled")
}

export async function archiveKnowledgeCorpusAction(
  formData: FormData,
): Promise<void> {
  await requireAuth()
  const corpusId = requiredFormValue(formData, "corpusId")
  const fallback = knowledgeHrefFromForm(formData, corpusId)
  await runKnowledgeCorpusAction(corpusId, "archive", fallback, "archived")
}

export async function updateKnowledgeCorpusAccessAction(
  formData: FormData,
): Promise<void> {
  await requireAuth()
  const corpusId = requiredFormValue(formData, "corpusId")
  const fallback = knowledgeHrefFromForm(formData, corpusId)
  const accessGroups = parseAccessGroups(
    optionalFormValue(formData, "accessGroups"),
  )

  try {
    await postAdminKnowledgeMutation(
      `/api/admin/knowledge/corpora/${encodeURIComponent(corpusId)}/access`,
      { accessGroups },
    )
  } catch {
    redirectTo(withActionStatus(fallback, "knowledgeAction", "failed"))
  }

  revalidatePath("/knowledge")
  redirectTo(
    withActionStatus(fallback, "knowledgeAction", "permissionsUpdated"),
  )
}

export async function hardDeleteKnowledgeCorpusAction(
  formData: FormData,
): Promise<void> {
  await requireAuth()
  const corpusId = requiredFormValue(formData, "corpusId")
  const fallback = knowledgeHrefFromForm(formData, corpusId)
  const successHref = knowledgeBaseHrefWithoutCorpus(formData)

  try {
    await postAdminKnowledgeMutation(
      `/api/admin/knowledge/corpora/${encodeURIComponent(corpusId)}/hard-delete`,
      {
        confirmation: requiredFormValue(formData, "confirmation"),
      },
    )
  } catch {
    redirectTo(withActionStatus(fallback, "knowledgeAction", "failed"))
  }

  revalidatePath("/knowledge")
  redirectTo(withActionStatus(successHref, "knowledgeAction", "hardDeleted"))
}

export async function bulkKnowledgeSourceAction(
  formData: FormData,
): Promise<void> {
  await requireAuth()
  const corpusId = requiredFormValue(formData, "corpusId")
  const fallback = knowledgeHrefFromForm(formData, corpusId)
  const sourceAction = requiredFormValue(formData, "sourceAction")
  const sourceIds = formData
    .getAll("sourceIds")
    .flatMap((value) =>
      typeof value === "string" && value.length > 0 ? [value] : [],
    )

  try {
    if (
      sourceAction !== "archive" &&
      sourceAction !== "disable" &&
      sourceAction !== "hard_delete"
    ) {
      throw new Error("Unsupported source action.")
    }
    if (sourceIds.length === 0) {
      throw new Error("Select at least one source.")
    }
    await postAdminKnowledgeMutation(
      `/api/admin/knowledge/corpora/${encodeURIComponent(
        corpusId,
      )}/sources/bulk-action`,
      {
        action: sourceAction,
        confirmation:
          sourceAction === "hard_delete"
            ? (optionalFormValue(formData, "confirmation") ?? "")
            : undefined,
        sourceIds,
      },
    )
  } catch {
    redirectTo(withActionStatus(fallback, "knowledgeAction", "failed"))
  }

  revalidatePath("/knowledge")
  redirectTo(
    withActionStatus(
      fallback,
      "knowledgeAction",
      sourceAction === "archive"
        ? "sourcesArchived"
        : sourceAction === "disable"
          ? "sourcesDisabled"
          : "sourcesHardDeleted",
    ),
  )
}

export async function retryKnowledgeSourceAction(
  formData: FormData,
): Promise<void> {
  await requireAuth()
  const corpusId = requiredFormValue(formData, "corpusId")
  const sourceId = requiredFormValue(formData, "sourceId")
  const fallback = knowledgeHrefFromForm(formData, corpusId)

  try {
    await postAdminKnowledgeMutation(
      `/api/admin/knowledge/corpora/${encodeURIComponent(
        corpusId,
      )}/sources/${encodeURIComponent(sourceId)}/retry`,
      undefined,
    )
  } catch {
    redirectTo(withActionStatus(fallback, "knowledgeAction", "failed"))
  }

  revalidatePath("/knowledge")
  redirectTo(withActionStatus(fallback, "knowledgeAction", "sourceRetried"))
}

export async function bulkKnowledgeArchiveSourceAction(
  formData: FormData,
): Promise<void> {
  await requireAuth()
  const fallback = knowledgeBaseHref(formData, "/knowledge?view=archive")
  const sourceAction = requiredFormValue(formData, "sourceAction")
  const archivedSourceIds = formData
    .getAll("archivedSourceIds")
    .flatMap((value) =>
      typeof value === "string" && value.length > 0 ? [value] : [],
    )

  try {
    if (sourceAction !== "restore" && sourceAction !== "hard_delete") {
      throw new Error("Unsupported archive source action.")
    }
    if (archivedSourceIds.length === 0) {
      throw new Error("Select at least one archived source.")
    }
    await postAdminKnowledgeMutation(
      "/api/admin/knowledge/archive/sources/bulk-action",
      {
        action: sourceAction,
        archivedSourceIds,
        confirmation:
          sourceAction === "hard_delete"
            ? (optionalFormValue(formData, "confirmation") ?? "")
            : undefined,
      },
    )
  } catch {
    redirectTo(withActionStatus(fallback, "knowledgeAction", "failed"))
  }

  revalidatePath("/knowledge?view=archive")
  revalidatePath("/knowledge")
  redirectTo(
    withActionStatus(
      fallback,
      "knowledgeAction",
      sourceAction === "restore"
        ? "archiveSourcesRestored"
        : "archiveSourcesHardDeleted",
    ),
  )
}

export async function publishKnowledgeSnapshotAction(
  formData: FormData,
): Promise<void> {
  await requireAuth()
  const corpusId = requiredFormValue(formData, "corpusId")
  const snapshotId = requiredFormValue(formData, "snapshotId")
  const fallback = knowledgeHrefFromForm(formData, corpusId)

  try {
    await postAdminKnowledgeMutation(
      `/api/admin/knowledge/corpora/${encodeURIComponent(
        corpusId,
      )}/snapshots/${encodeURIComponent(snapshotId)}/publish`,
      undefined,
    )
  } catch {
    redirectTo(withActionStatus(fallback, "knowledgeAction", "failed"))
  }

  revalidatePath("/knowledge")
  redirectTo(withActionStatus(fallback, "knowledgeAction", "published"))
}

export async function discardKnowledgeSnapshotAction(
  formData: FormData,
): Promise<void> {
  await requireAuth()
  const corpusId = requiredFormValue(formData, "corpusId")
  const snapshotId = requiredFormValue(formData, "snapshotId")
  const fallback = knowledgeHrefFromForm(formData, corpusId)

  try {
    await postAdminKnowledgeMutation(
      `/api/admin/knowledge/corpora/${encodeURIComponent(
        corpusId,
      )}/snapshots/${encodeURIComponent(snapshotId)}/discard`,
      undefined,
    )
  } catch {
    redirectTo(withActionStatus(fallback, "knowledgeAction", "failed"))
  }

  revalidatePath("/knowledge")
  redirectTo(withActionStatus(fallback, "knowledgeAction", "discarded"))
}

async function requireAuth() {
  const session = await auth()
  if (!session?.user.roles.includes("admin")) {
    throw new Error("Admin session required.")
  }
  return session
}

function redirectTo(href: string): never {
  redirect(href)
}

async function postAdminMcpServerMutation(
  path: string,
  body: Record<string, unknown>,
) {
  return adminConnectorRegistryItemSchema.parse(
    await postAdminMutation(path, body, "MCP server"),
  )
}

async function postAdminMcpServerConnectionTestMutation(
  path: string,
  body: Record<string, unknown>,
) {
  return adminMcpServerConnectionTestResponseSchema.parse(
    await postAdminMutation(path, body, "MCP server connection test"),
  )
}

async function postAdminConnectedAppCreateMutation(
  path: string,
  body: Record<string, unknown>,
) {
  return adminConnectedAppCreateResponseSchema.parse(
    await postAdminMutation(path, body, "connected app"),
  )
}

async function postAdminConnectedAppTestMutation(path: string) {
  return adminConnectedAppTestResultSchema.parse(
    await postAdminMutation(path, undefined, "connected app test"),
  )
}

async function postAdminConnectedAppPromotionMutation(path: string) {
  return adminConnectedAppPromotionResultSchema.parse(
    await postAdminMutation(
      path,
      undefined,
      "connected app production promotion",
    ),
  )
}

async function postAdminConnectedAppRotateMutation(path: string) {
  return adminConnectedAppRotateCredentialResultSchema.parse(
    await postAdminMutation(
      path,
      undefined,
      "connected app credential rotation",
    ),
  )
}

async function postAdminConnectedAppDisableMutation(path: string) {
  return adminConnectedAppSchema.parse(
    await postAdminMutation(path, undefined, "connected app disable"),
  )
}

async function postAdminKnowledgeMutation(
  path: string,
  body: Record<string, unknown> | undefined,
) {
  return knowledgeActionResponseSchema.parse(
    await postAdminMutation(path, body, "knowledge"),
  )
}

async function postAdminInferenceMutation(
  path: string,
  body: Record<string, unknown>,
) {
  return adminInferenceModelUpdateActionResponseSchema.parse(
    await postAdminMutation(path, body, "inference"),
  )
}

async function postAdminSettingsMutation(
  path: string,
  body: Record<string, unknown> | undefined,
) {
  return adminSettingsResponseSchema.parse(
    await postAdminMutation(path, body, "settings"),
  )
}

async function postAdminTeamMemberMutation(
  path: string,
  body: Record<string, unknown> | undefined,
) {
  return adminTeamMemberMutationResponseSchema.parse(
    await postAdminMutation(path, body, "Team member"),
  )
}

async function postAdminTeamActionMutation(
  path: string,
  body: Record<string, unknown> | undefined,
) {
  return adminTeamActionResponseSchema.parse(
    await postAdminMutation(path, body, "Team member action"),
  )
}

async function postAdminTeamGroupMutation(
  path: string,
  body: Record<string, unknown> | undefined,
) {
  return adminTeamGroupMutationResponseSchema.parse(
    await postAdminMutation(path, body, "Team group"),
  )
}

async function postAdminTeamBreakGlassMutation(
  path: string,
  body: Record<string, unknown>,
) {
  return adminTeamBreakGlassSchema.parse(
    await postAdminMutation(path, body, "Team break-glass Admin"),
  )
}

async function postAdminTeamCsvImportPreviewMutation(
  path: string,
  body: Record<string, unknown>,
) {
  return adminTeamCsvImportPreviewResponseSchema.parse(
    await postAdminMutation(path, body, "Team CSV import preview"),
  )
}

async function postAdminTeamCsvImportCommitMutation(
  path: string,
  body: Record<string, unknown>,
) {
  return adminTeamCsvImportCommitResponseSchema.parse(
    await postAdminMutation(path, body, "Team CSV import commit"),
  )
}

async function postAdminMutation(
  path: string,
  body: Record<string, unknown> | undefined,
  label: string,
): Promise<unknown> {
  const bffRequest = await getBffRequest()
  if (!bffRequest) {
    throw new Error("Admin BFF is not configured.")
  }

  const headers = new Headers(bffRequest.headers)
  headers.set("Idempotency-Key", randomUUID())
  if (body) {
    headers.set("Content-Type", "application/json")
  }

  const response = await fetch(`${bffRequest.baseUrl}${path}`, {
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
    headers,
    method: "POST",
  })
  if (!response.ok) {
    const detail = await adminProblemDetail(response)
    throw new AdminMutationError(
      detail ?? `Admin ${label} mutation failed with ${response.status}.`,
      response.status,
      detail,
    )
  }

  return response.json() as Promise<unknown>
}

class AdminMutationError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail: string | null = null,
  ) {
    super(message)
    this.name = "AdminMutationError"
  }
}

async function adminProblemDetail(response: Response): Promise<string | null> {
  try {
    const payload = await response.clone().json()
    if (
      payload &&
      typeof payload === "object" &&
      "detail" in payload &&
      typeof payload.detail === "string"
    ) {
      return payload.detail
    }
  } catch {
    return null
  }
  return null
}

function adminMutationErrorDetail(error: unknown, fallback: string): string {
  if (error instanceof AdminMutationError && error.detail) {
    return error.detail
  }
  return fallback
}

function isDuplicateMutationError(error: unknown): boolean {
  return error instanceof AdminMutationError && error.status === 409
}

function requiredFormValue(formData: FormData, name: string): string {
  const value = optionalFormValue(formData, name)
  if (!value) {
    throw new Error(`${name} is required.`)
  }
  return value
}

function optionalFormValue(formData: FormData, name: string): string | null {
  const value = formData.get(name)
  if (typeof value !== "string") {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function checkboxFormValue(formData: FormData, name: string): boolean {
  return formData.get(name) === "on"
}

async function csvTextFromForm(formData: FormData): Promise<string> {
  const file = formData.get("csvFile")
  if (file instanceof File && file.size > 0) {
    if (typeof file.text === "function") {
      return (await file.text()).trim()
    }
    if (typeof file.arrayBuffer === "function") {
      return new TextDecoder().decode(await file.arrayBuffer()).trim()
    }
  }
  return optionalFormValue(formData, "csv") ?? ""
}

function emptyCsvImportState(error: string): TeamCsvImportActionState {
  return {
    commit: null,
    csv: "",
    error,
    preview: null,
    status: "failed",
  }
}

function teamGroupsFromForm(formData: FormData): string[] {
  return formData.getAll("groups").flatMap((value) => {
    if (typeof value !== "string") {
      return []
    }
    const group = value.trim()
    return group.length > 0 && group !== "Everyone" ? [group] : []
  })
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

function parsePersona(value: string): Persona {
  if (value === "admin" || value === "builder" || value === "consumer") {
    return value
  }
  throw new Error("role must be consumer, builder, or admin.")
}

async function settingsLogoAssetFromForm(
  formData: FormData,
  name: "fullLogo" | "iconLogo",
): Promise<AdminSettingsLogoAsset | null | undefined> {
  if (checkboxFormValue(formData, `clear${capitalize(name)}`)) {
    return null
  }

  const value = formData.get(name)
  if (!(value instanceof File) || value.size === 0) {
    return undefined
  }
  if (value.type !== "image/png" && value.type !== "image/jpeg") {
    throw new Error("Logo must be a PNG or JPEG.")
  }
  if (value.size > 1024 * 1024) {
    throw new Error("Logo must be at or below 1 MiB.")
  }

  const width = parsePositiveInteger(
    requiredFormValue(formData, `${name}Width`),
  )
  const height = parsePositiveInteger(
    requiredFormValue(formData, `${name}Height`),
  )
  if (name === "iconLogo" && width !== height) {
    throw new Error("Icon logo must use a 1:1 aspect ratio.")
  }

  const buffer = Buffer.from(await value.arrayBuffer())
  const mimeType = value.type as AdminSettingsLogoAsset["mimeType"]
  return {
    checksum: `sha256:${createHash("sha256").update(buffer).digest("hex")}`,
    dataUrl: `data:${mimeType};base64,${buffer.toString("base64")}`,
    fileName: value.name,
    height,
    mimeType,
    sizeBytes: value.size,
    updatedAt: new Date().toISOString(),
    width,
  }
}

function requiredFiles(formData: FormData): File[] {
  const values = [
    ...formData.getAll("files"),
    ...formData.getAll("file"),
  ].filter((value): value is File => value instanceof File && value.size > 0)

  if (values.length === 0) {
    throw new Error("At least one document is required.")
  }

  return values
}

function parsePositiveInteger(value: string): number {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error("Expected a positive integer.")
  }
  return parsed
}

function parseCommaList(value: string | null): string[] {
  if (!value) {
    return []
  }
  return value.split(",").flatMap((item) => {
    const trimmed = item.trim()
    return trimmed ? [trimmed] : []
  })
}

function parseAccessGroups(value: string | null): string[] {
  return Array.from(
    new Set(
      parseCommaList(value).filter(
        (group) => group.toLowerCase() !== "everyone",
      ),
    ),
  )
}

function parseAdminSettingsLanguage(value: string): AdminSettingsLanguage {
  if (value === "hr") {
    return "hr"
  }
  return "en"
}

function parseAdminUrlPolicyRuleScope(
  value: string | null,
): AdminUrlPolicyRuleScope {
  if (
    value === "knowledge_ingestion" ||
    value === "web_fetch" ||
    value === "mcp_egress" ||
    value === "all"
  ) {
    return value
  }
  return "all"
}

function parseAdminUrlPolicyRuleStatus(
  value: string | null,
): AdminUrlPolicyRuleStatus {
  return value === "disabled" ? "disabled" : "active"
}

function parseAdminUrlPolicyRuleType(value: string): AdminUrlPolicyRuleType {
  return value === "forbidden" ? "forbidden" : "trusted"
}

function capitalize(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`
}

function parseAdminMcpServerForm(
  formData: FormData,
): CreateAdminMcpServerRequest {
  const transport = requiredFormValue(formData, "transport")
  const authMode = requiredFormValue(formData, "authMode")
  return {
    accessGroups: parseAccessGroups(
      optionalFormValue(formData, "accessGroups"),
    ),
    accessLevel:
      requiredFormValue(formData, "accessLevel") === "read_write"
        ? "read_write"
        : "read_only",
    authMode: authMode === "bearer" ? "bearer" : "none",
    bearerTokenSecretRef:
      authMode === "bearer"
        ? requiredFormValue(formData, "bearerTokenSecretRef")
        : undefined,
    chatCommand: requiredFormValue(formData, "chatCommand"),
    description: requiredFormValue(formData, "description"),
    endpointUrl:
      transport === "url"
        ? requiredFormValue(formData, "endpointUrl")
        : undefined,
    name: requiredFormValue(formData, "name"),
    saveMode:
      optionalFormValue(formData, "saveMode") === "draft" ? "draft" : "enabled",
    stdioCommand:
      transport === "stdio"
        ? requiredFormValue(formData, "stdioCommand")
        : undefined,
    transport: transport === "stdio" ? "stdio" : "url",
  }
}

function parseUpdateAdminMcpServerForm(
  formData: FormData,
): UpdateAdminMcpServerRequest {
  const transport = requiredFormValue(formData, "transport")
  const authMode = requiredFormValue(formData, "authMode")
  return {
    accessGroups: parseAccessGroups(
      optionalFormValue(formData, "accessGroups"),
    ),
    accessLevel:
      requiredFormValue(formData, "accessLevel") === "read_write"
        ? "read_write"
        : "read_only",
    authMode: authMode === "bearer" ? "bearer" : "none",
    bearerTokenSecretRef:
      authMode === "bearer"
        ? requiredFormValue(formData, "bearerTokenSecretRef")
        : undefined,
    description: requiredFormValue(formData, "description"),
    endpointUrl:
      transport === "url"
        ? requiredFormValue(formData, "endpointUrl")
        : undefined,
    name: requiredFormValue(formData, "name"),
    status: adminMcpServerStatusFromForm(formData),
    stdioCommand:
      transport === "stdio"
        ? requiredFormValue(formData, "stdioCommand")
        : undefined,
    transport: transport === "stdio" ? "stdio" : "url",
  }
}

function adminMcpServerStatusFromForm(
  formData: FormData,
): UpdateAdminMcpServerRequest["status"] {
  const value = requiredFormValue(formData, "status")
  if (value === "draft" || value === "disabled") {
    return value
  }
  return "enabled"
}

function parsePositiveInt(value: string | null, fallback: number): number {
  if (!value) {
    return fallback
  }
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function parseOptionalPositiveInt(value: string | null): number | null {
  const trimmed = value?.trim()
  if (!trimmed) {
    return null
  }
  const parsed = Number(trimmed)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : Number.NaN
}

function mcpServerReturnHref(formData: FormData): string {
  return sanitizeApplicationsReturnTo(
    optionalFormValue(formData, "returnTo"),
    "/applications/add-server",
  )
}

function connectedAppReturnHref(formData: FormData, appId: string): string {
  return sanitizeApplicationsReturnTo(
    optionalFormValue(formData, "returnTo"),
    `/applications/apps/${appId}`,
  )
}

function settingsReturnHref(formData: FormData): string {
  return sanitizeSettingsReturnTo(optionalFormValue(formData, "returnTo"))
}

function inferenceReturnHref(formData: FormData): string {
  return sanitizeInferenceReturnTo(optionalFormValue(formData, "returnTo"))
}

function sanitizeInferenceReturnTo(value: string | null): string {
  if (!value) {
    return "/inference"
  }
  const [path, query = ""] = value.split("?")
  if (path !== "/inference" && path !== "/inference/update") {
    return "/inference"
  }
  const allowed = new URLSearchParams()
  const params = new URLSearchParams(query)
  for (const key of ["range", "inferenceAction"]) {
    const current = params.get(key)
    if (current) {
      allowed.set(key, current)
    }
  }
  const queryString = allowed.toString()
  return `${path}${queryString ? `?${queryString}` : ""}`
}

function sanitizeSettingsReturnTo(value: string | null): string {
  if (!value) {
    return "/settings"
  }
  const [path, query = ""] = value.split("?")
  if (path !== "/settings") {
    return "/settings"
  }
  const allowed = new URLSearchParams()
  const params = new URLSearchParams(query)
  for (const key of ["settingsAction"]) {
    const current = params.get(key)
    if (current) {
      allowed.set(key, current)
    }
  }
  const queryString = allowed.toString()
  return `${path}${queryString ? `?${queryString}` : ""}`
}

async function runKnowledgeCorpusAction(
  corpusId: string,
  action: "archive" | "disable" | "ingest" | "refresh",
  fallback: string,
  status: string,
): Promise<void> {
  try {
    await postAdminKnowledgeMutation(
      `/api/admin/knowledge/corpora/${encodeURIComponent(corpusId)}/${action}`,
      undefined,
    )
  } catch {
    redirectTo(withActionStatus(fallback, "knowledgeAction", "failed"))
  }

  revalidatePath("/knowledge")
  redirectTo(withActionStatus(fallback, "knowledgeAction", status))
}

function knowledgeIngestActionStatus(
  response: KnowledgeActionResponse,
): "ingested" | "partialIngested" | "ingestFailed" {
  const failedSourceCount =
    metricNumber(response.snapshot?.metadata, "failedSourceCount") ??
    metricNumber(response.job?.metrics, "failedSourceCount") ??
    0
  if (failedSourceCount <= 0) {
    return "ingested"
  }

  const sourceCount =
    response.snapshot?.sourceCount ??
    metricNumber(response.job?.metrics, "sourceCount") ??
    response.corpus.sourceCount
  const chunkCount =
    response.snapshot?.chunkCount ??
    metricNumber(response.job?.metrics, "chunkCount") ??
    response.corpus.chunkCount

  if (
    (sourceCount > 0 && failedSourceCount >= sourceCount) ||
    chunkCount === 0
  ) {
    return "ingestFailed"
  }

  return "partialIngested"
}

function metricNumber(
  metrics: Record<string, unknown> | null | undefined,
  key: string,
): number | null {
  const value = metrics?.[key]
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function knowledgeHrefFromForm(formData: FormData, corpusId: string): string {
  return knowledgeHref(
    corpusId,
    knowledgeBaseHref(formData),
    optionalFormValue(formData, "view"),
  )
}

function knowledgeBaseHref(
  formData: FormData,
  fallback = "/knowledge",
): string {
  return sanitizeKnowledgeReturnTo(
    optionalFormValue(formData, "returnTo"),
    fallback,
  )
}

function knowledgeBaseHrefWithoutCorpus(formData: FormData): string {
  const [path, query = ""] = knowledgeBaseHref(formData).split("?")
  const params = new URLSearchParams(query)
  params.delete("corpus")
  params.delete("view")
  const queryString = params.toString()
  return `${path}${queryString ? `?${queryString}` : ""}`
}

function teamReturnHref(formData: FormData, fallback = "/team"): string {
  return sanitizeTeamReturnTo(optionalFormValue(formData, "returnTo"), fallback)
}

function knowledgeHref(
  corpusId: string,
  returnTo = "/knowledge",
  view: string | null = null,
): string {
  const [path, query = ""] = returnTo.split("?")
  const params = new URLSearchParams(query)
  params.set("corpus", corpusId)
  if (path === "/knowledge") {
    if (view && view !== "overview") {
      params.set("view", view)
    } else if (view === "overview") {
      params.delete("view")
    }
  }
  return `${path}?${params.toString()}`
}

function sanitizeKnowledgeReturnTo(
  value: string | null,
  fallback = "/knowledge",
): string {
  const safeFallback = isAllowedKnowledgeReturnPath(fallback.split("?")[0])
    ? fallback
    : "/knowledge"
  if (!value) {
    return safeFallback
  }
  const [path, query = ""] = value.split("?")
  if (!isAllowedKnowledgeReturnPath(path)) {
    return safeFallback
  }
  const allowed = new URLSearchParams()
  const params = new URLSearchParams(query)
  for (const key of [
    "corpus",
    "view",
    "q",
    "knowledgeAction",
    "knowledgeUpload",
  ]) {
    const current = params.get(key)
    if (current) {
      allowed.set(key, current)
    }
  }
  const queryString = allowed.toString()
  return `${path}${queryString ? `?${queryString}` : ""}`
}

function sanitizeApplicationsReturnTo(
  value: string | null,
  fallback: string,
): string {
  const safeFallback = fallback.startsWith("/applications")
    ? fallback
    : "/applications"
  if (!value) {
    return safeFallback
  }
  const [path, query = ""] = value.split("?")
  if (!path.startsWith("/applications")) {
    return safeFallback
  }
  const allowed = new URLSearchParams()
  const params = new URLSearchParams(query)
  for (const key of ["mcpAction", "q"]) {
    const current = params.get(key)
    if (current) {
      allowed.set(key, current)
    }
  }
  const queryString = allowed.toString()
  return `${path}${queryString ? `?${queryString}` : ""}`
}

function sanitizeTeamReturnTo(value: string | null, fallback: string): string {
  const safeFallback = fallback.startsWith("/team") ? fallback : "/team"
  if (!value) {
    return safeFallback
  }
  const [path, query = ""] = value.split("?")
  if (!path.startsWith("/team")) {
    return safeFallback
  }
  const allowed = new URLSearchParams()
  const params = new URLSearchParams(query)
  for (const key of ["teamAction"]) {
    const current = params.get(key)
    if (current) {
      allowed.set(key, current)
    }
  }
  const queryString = allowed.toString()
  return `${path}${queryString ? `?${queryString}` : ""}`
}

function isAllowedKnowledgeReturnPath(path: string): boolean {
  return path === "/knowledge"
}

function withActionStatus(
  href: string,
  keyOrStatus: string,
  maybeStatus?: string,
): string {
  const key = maybeStatus ? keyOrStatus : "adminAction"
  const status = maybeStatus ?? keyOrStatus
  const [path, query = ""] = href.split("?")
  const params = new URLSearchParams(query)
  params.set(key, status)
  return `${path}?${params.toString()}`
}

function withKnowledgeUploadStatus(
  href: string,
  added: number,
  failed: number,
): string {
  const [path, query = ""] = href.split("?")
  const params = new URLSearchParams(query)
  params.set("knowledgeUpload", `uploaded-${added}-failed-${failed}`)
  return `${path}?${params.toString()}`
}
