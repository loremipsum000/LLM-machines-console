"use server"

import { Buffer } from "node:buffer"
import { createHash, randomUUID } from "node:crypto"
import {
  consoleMfaElevationHref,
  hasFreshConsoleMfa,
} from "@/lib/auth/mfa-elevation"
import { normalizeConsoleReturnPath } from "@/lib/auth/safe-return"
import { getCurrentConsoleSession } from "@/lib/auth/session"
import { getBffRequest } from "@/lib/bff/server-request"
import {
  type AdminConnectedApp,
  type AdminConnectedAppCredential,
  type AdminConnectedAppFirecrawlCredential,
  type AdminSettingsLanguage,
  type AdminSettingsLogoAsset,
  type AdminTeamCsvImportCommitResponse,
  type AdminTeamCsvImportPreviewResponse,
  type InferenceCoreCapability,
  type InferenceCoreHumanRole,
  adminConnectedAppCreateRequestSchema,
  adminConnectedAppCreateResponseSchema,
  adminConnectedAppDeleteRequestSchema,
  adminConnectedAppFirecrawlCredentialResultSchema,
  adminConnectedAppFirecrawlEnableRequestSchema,
  adminConnectedAppFirecrawlLifecycleResultSchema,
  adminConnectedAppFirecrawlPolicyRequestSchema,
  adminConnectedAppFirecrawlTestResultSchema,
  adminConnectedAppLifecycleResultSchema,
  adminConnectedAppRotateCredentialResultSchema,
  adminConnectedAppSchema,
  adminConnectedAppTestResultSchema,
  adminConnectedAppUpdateRequestSchema,
  adminSettingsResponseSchema,
  adminTeamActionResponseSchema,
  adminTeamBulkGroupAssignmentRequestSchema,
  adminTeamCsvImportCommitResponseSchema,
  adminTeamCsvImportPreviewResponseSchema,
  adminTeamGroupMutationResponseSchema,
  adminTeamMemberMutationResponseSchema,
  consoleHighRiskActionSchema,
  createAdminTeamGroupRequestSchema,
  createAdminTeamMemberRequestSchema,
  deleteAdminTeamMemberRequestSchema,
  roleHasInferenceCoreCapability,
  updateAdminTeamGroupRequestSchema,
} from "@llm-machines/contracts/inference-core"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"

export async function updateAdminSettingsOrganizationAction(
  formData: FormData,
): Promise<void> {
  await requireAdmin()
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
  } catch (error) {
    rethrowTerminalConsoleSession(error)
    redirectTo(withActionStatus(fallback, "settingsAction", "failed"))
  }

  revalidatePath("/settings")
  redirectTo(withActionStatus(fallback, "settingsAction", "organizationSaved"))
}

export async function updateAdminSettingsTelemetryAction(
  formData: FormData,
): Promise<void> {
  await requireAdmin()
  const fallback = settingsReturnHref(formData)
  const enabled = checkboxFormValue(formData, "enabled")

  try {
    await postAdminSettingsMutation("/api/admin/settings/telemetry", {
      confirmation: optionalFormValue(formData, "confirmation") ?? undefined,
      enabled,
    })
  } catch (error) {
    rethrowTerminalConsoleSession(error)
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
  await requireCapability("team.users_roles.manage")
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
      role: parseHumanRole(requiredFormValue(formData, "role")),
      sendInvite: checkboxFormValue(formData, "sendInvite"),
      username: generatedTeamUsername(displayName, groups[0]),
    })
  } catch {
    return {
      error: "Name, company email, role, and group are required.",
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
  await requireCapability("team.users_roles.manage")
  const memberId = requiredFormValue(formData, "memberId")
  const fallback = teamReturnHref(formData, `/team/members/${memberId}`)

  try {
    await postAdminTeamActionMutation(
      `/api/admin/team/members/${encodeURIComponent(memberId)}/invite`,
      undefined,
    )
  } catch (error) {
    rethrowTerminalConsoleSession(error)
    redirectTo(withActionStatus(fallback, "teamAction", "failed"))
  }

  revalidatePath("/team")
  redirectTo(withActionStatus(fallback, "teamAction", "inviteSent"))
}

export async function sendAdminTeamPasswordResetAction(
  formData: FormData,
): Promise<void> {
  await requireCapability("team.local_password.manage")
  const memberId = requiredFormValue(formData, "memberId")
  const fallback = teamReturnHref(formData, `/team/members/${memberId}`)

  try {
    await postAdminTeamActionMutation(
      `/api/admin/team/members/${encodeURIComponent(
        memberId,
      )}/reset-password-email`,
      undefined,
    )
  } catch (error) {
    rethrowTerminalConsoleSession(error)
    redirectTo(withActionStatus(fallback, "teamAction", "failed"))
  }

  revalidatePath("/team")
  redirectTo(withActionStatus(fallback, "teamAction", "passwordResetSent"))
}

export async function generateAdminTeamPasswordAction(
  _previousState: TeamMemberActionState,
  formData: FormData,
): Promise<TeamMemberActionState> {
  await requireCapability("team.local_password.manage")
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
  } catch (error) {
    rethrowTerminalConsoleSession(error)
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
  await requireCapability("team.users_roles.manage")
  const memberId = requiredFormValue(formData, "memberId")
  const fallback = teamReturnHref(formData, `/team/members/${memberId}`)

  try {
    await postAdminTeamActionMutation(
      `/api/admin/team/members/${encodeURIComponent(memberId)}/disable`,
      undefined,
    )
  } catch (error) {
    rethrowTerminalConsoleSession(error)
    redirectTo(withActionStatus(fallback, "teamAction", "failed"))
  }

  revalidatePath("/team")
  redirectTo(withActionStatus(fallback, "teamAction", "disabled"))
}

export async function reactivateAdminTeamMemberAction(
  formData: FormData,
): Promise<void> {
  await requireCapability("team.users_roles.manage")
  const memberId = requiredFormValue(formData, "memberId")
  const fallback = teamReturnHref(formData, `/team/members/${memberId}`)

  try {
    await postAdminTeamActionMutation(
      `/api/admin/team/members/${encodeURIComponent(memberId)}/reactivate`,
      undefined,
    )
  } catch (error) {
    rethrowTerminalConsoleSession(error)
    redirectTo(withActionStatus(fallback, "teamAction", "failed"))
  }

  revalidatePath("/team")
  redirectTo(withActionStatus(fallback, "teamAction", "reactivated"))
}

export async function deleteAdminTeamMemberAction(
  formData: FormData,
): Promise<void> {
  await requireCapability("team.users_roles.manage")
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
  } catch (error) {
    rethrowTerminalConsoleSession(error)
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
  await requireCapability("team.users_roles.manage")
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
  } catch (error) {
    rethrowTerminalConsoleSession(error)
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
  await requireCapability("team.users_roles.manage")
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
  } catch (error) {
    rethrowTerminalConsoleSession(error)
    redirectTo(withActionStatus(fallback, "teamAction", "failed"))
  }

  revalidatePath("/team")
  revalidatePath(`/team/groups/${groupId}`)
  redirectTo(withActionStatus(fallback, "teamAction", "groupUpdated"))
}

export async function deleteAdminTeamGroupAction(
  formData: FormData,
): Promise<void> {
  await requireCapability("team.users_roles.manage")
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
  } catch (error) {
    rethrowTerminalConsoleSession(error)
    redirectTo(withActionStatus(fallback, "teamAction", "failed"))
  }

  revalidatePath("/team")
  revalidatePath("/team/groups")
  redirectTo(withActionStatus("/team", "teamAction", "groupDeleted"))
}

export async function bulkAssignAdminTeamGroupMembersAction(
  formData: FormData,
): Promise<void> {
  await requireCapability("team.users_roles.manage")
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
  } catch (error) {
    rethrowTerminalConsoleSession(error)
    redirectTo(withActionStatus(fallback, "teamAction", "failed"))
  }

  revalidatePath("/team")
  revalidatePath(`/team/groups/${groupId}`)
  redirectTo(withActionStatus(fallback, "teamAction", "groupMembersAssigned"))
}

export async function removeAdminTeamGroupMemberAction(
  formData: FormData,
): Promise<void> {
  await requireCapability("team.users_roles.manage")
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
  } catch (error) {
    rethrowTerminalConsoleSession(error)
    redirectTo(withActionStatus(fallback, "teamAction", "failed"))
  }

  revalidatePath("/team")
  revalidatePath(`/team/groups/${groupId}`)
  redirectTo(withActionStatus(fallback, "teamAction", "groupMemberRemoved"))
}

export async function previewAdminTeamCsvImportAction(
  _previousState: TeamCsvImportActionState,
  formData: FormData,
): Promise<TeamCsvImportActionState> {
  await requireCapability("team.users_roles.manage")
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
  } catch (error) {
    rethrowTerminalConsoleSession(error)
    return emptyCsvImportState("CSV import preview failed.")
  }
}

export async function commitAdminTeamCsvImportAction(
  _previousState: TeamCsvImportActionState,
  formData: FormData,
): Promise<TeamCsvImportActionState> {
  await requireCapability("team.users_roles.manage")
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
  } catch (error) {
    rethrowTerminalConsoleSession(error)
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
  observedAt: string | null
  status: "degraded" | "failed" | "idle" | "passed" | "waiting"
}

export interface ConnectedAppCredentialActionState {
  app: AdminConnectedApp | null
  credential: AdminConnectedAppCredential | null
  detail: string | null
  error: string | null
  status: "blocked" | "failed" | "idle" | "revoked" | "rotated"
}

export interface ConnectedAppFirecrawlCredentialActionState {
  app: AdminConnectedApp | null
  credential: AdminConnectedAppFirecrawlCredential | null
  detail: string | null
  error: string | null
  status: "blocked" | "enabled" | "failed" | "idle" | "rotated"
}

export interface ConnectedAppFirecrawlLifecycleActionState {
  app: AdminConnectedApp | null
  detail: string | null
  error: string | null
  status: "blocked" | "disabled" | "failed" | "idle" | "revoked"
}

export type ConnectedAppFirecrawlTestActionState = ConnectedAppTestActionState

export async function createAdminConnectedAppAction(
  _previousState: ConnectedAppCreateActionState,
  formData: FormData,
): Promise<ConnectedAppCreateActionState> {
  await requireCapability("applications.create_delete")
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
    maxConcurrentRequests: checkboxFormValue(
      formData,
      "maxConcurrentRequestsEnabled",
    )
      ? parseOptionalPositiveInt(
          optionalFormValue(formData, "maxConcurrentRequests"),
        )
      : null,
    maxContextBytes: checkboxFormValue(formData, "maxContextBytesEnabled")
      ? parseOptionalPositiveInt(optionalFormValue(formData, "maxContextBytes"))
      : null,
    name: optionalFormValue(formData, "name") ?? "",
    rateLimitRps: checkboxFormValue(formData, "rateLimitRpsEnabled")
      ? parseOptionalPositiveInt(optionalFormValue(formData, "rateLimitRps"))
      : null,
    tokenAlertThreshold7d: checkboxFormValue(
      formData,
      "tokenAlertThreshold7dEnabled",
    )
      ? parseOptionalPositiveInt(
          optionalFormValue(formData, "tokenAlertThreshold7d"),
        )
      : null,
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
  } catch (error) {
    return {
      app: null,
      credential: null,
      error: adminMutationErrorDetail(
        error,
        "Connected app could not be created. Check the identity configuration and retry.",
      ),
      status: "failed",
    }
  }
}

export async function checkAdminConnectedAppConnectionAction(
  _previousState: ConnectedAppTestActionState,
  formData: FormData,
): Promise<ConnectedAppTestActionState> {
  await requireCapability("applications.credentials.test_rotate_revoke")
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
      observedAt: result.observedAt,
      status: result.status,
    }
  } catch (error) {
    return {
      app: null,
      detail: null,
      error: adminMutationErrorDetail(
        error,
        "Connection evidence could not be refreshed.",
      ),
      observedAt: null,
      status: "failed",
    }
  }
}

export async function rotateAdminConnectedAppCredentialsAction(
  _previousState: ConnectedAppCredentialActionState,
  formData: FormData,
): Promise<ConnectedAppCredentialActionState> {
  await requireCapability("applications.credentials.test_rotate_revoke")
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
  } catch (error) {
    return {
      app: null,
      credential: null,
      detail: null,
      error: adminMutationErrorDetail(error, "Credential rotation failed."),
      status: error instanceof AdminMutationError ? "blocked" : "failed",
    }
  }
}

export async function revokeAdminConnectedAppCredentialAction(
  _previousState: ConnectedAppCredentialActionState,
  formData: FormData,
): Promise<ConnectedAppCredentialActionState> {
  await requireCapability("applications.credentials.test_rotate_revoke")
  const appId = requiredFormValue(formData, "appId")
  const credentialId = requiredFormValue(formData, "credentialId")

  try {
    const app = await postAdminConnectedAppRevokeMutation(
      `/api/admin/applications/connected-apps/${encodeURIComponent(
        appId,
      )}/credentials/${encodeURIComponent(credentialId)}/revoke`,
    )
    revalidatePath("/applications")
    revalidatePath(`/applications/apps/${app.id}`)
    return {
      app,
      credential: null,
      detail: "Credential revoked immediately.",
      error: null,
      status: "revoked",
    }
  } catch (error) {
    return {
      app: null,
      credential: null,
      detail: null,
      error: adminMutationErrorDetail(error, "Credential revocation failed."),
      status: error instanceof AdminMutationError ? "blocked" : "failed",
    }
  }
}

export async function enableAdminConnectedAppFirecrawlAction(
  _previousState: ConnectedAppFirecrawlCredentialActionState,
  formData: FormData,
): Promise<ConnectedAppFirecrawlCredentialActionState> {
  await requireCapability("firecrawl.enable_reenable")
  const appId = requiredFormValue(formData, "appId")
  const parsed = adminConnectedAppFirecrawlEnableRequestSchema.safeParse({
    disclaimerAccepted: checkboxFormValue(formData, "disclaimerAccepted"),
    maxConcurrentScrapes: checkboxFormValue(
      formData,
      "firecrawlMaxConcurrentScrapesEnabled",
    )
      ? parseOptionalPositiveInt(
          optionalFormValue(formData, "firecrawlMaxConcurrentScrapes"),
        )
      : null,
    scrapeRateLimitRps: checkboxFormValue(
      formData,
      "firecrawlScrapeRateLimitRpsEnabled",
    )
      ? parseOptionalPositiveInt(
          optionalFormValue(formData, "firecrawlScrapeRateLimitRps"),
        )
      : null,
    searchRateLimitRps: checkboxFormValue(
      formData,
      "firecrawlSearchRateLimitRpsEnabled",
    )
      ? parseOptionalPositiveInt(
          optionalFormValue(formData, "firecrawlSearchRateLimitRps"),
        )
      : null,
  })
  if (!parsed.success) {
    return {
      app: null,
      credential: null,
      detail: null,
      error:
        "Accept the outbound web access disclaimer and check each enabled protection.",
      status: "failed",
    }
  }

  try {
    const result = await postAdminConnectedAppFirecrawlCredentialMutation(
      `/api/admin/applications/connected-apps/${encodeURIComponent(
        appId,
      )}/firecrawl/enable`,
      parsed.data,
    )
    revalidateConnectedApp(appId)
    return {
      app: result.app,
      credential: result.credential,
      detail: result.detail,
      error: null,
      status: result.status,
    }
  } catch (error) {
    return {
      app: null,
      credential: null,
      detail: null,
      error: adminMutationErrorDetail(error, "Firecrawl could not be enabled."),
      status: error instanceof AdminMutationError ? "blocked" : "failed",
    }
  }
}

export async function checkAdminConnectedAppFirecrawlConnectionAction(
  _previousState: ConnectedAppFirecrawlTestActionState,
  formData: FormData,
): Promise<ConnectedAppFirecrawlTestActionState> {
  await requireCapability("applications.credentials.test_rotate_revoke")
  const appId = requiredFormValue(formData, "appId")

  try {
    const result = await postAdminConnectedAppFirecrawlTestMutation(
      `/api/admin/applications/connected-apps/${encodeURIComponent(
        appId,
      )}/firecrawl/test`,
    )
    revalidateConnectedApp(appId)
    return {
      app: result.app,
      detail: result.detail,
      error: null,
      observedAt: result.observedAt,
      status: result.status,
    }
  } catch (error) {
    return {
      app: null,
      detail: null,
      error: adminMutationErrorDetail(
        error,
        "Firecrawl connection evidence could not be refreshed.",
      ),
      observedAt: null,
      status: "failed",
    }
  }
}

export async function rotateAdminConnectedAppFirecrawlCredentialAction(
  _previousState: ConnectedAppFirecrawlCredentialActionState,
  formData: FormData,
): Promise<ConnectedAppFirecrawlCredentialActionState> {
  await requireCapability("applications.credentials.test_rotate_revoke")
  const appId = requiredFormValue(formData, "appId")

  try {
    const result = await postAdminConnectedAppFirecrawlCredentialMutation(
      `/api/admin/applications/connected-apps/${encodeURIComponent(
        appId,
      )}/firecrawl/rotate-credentials`,
    )
    revalidateConnectedApp(appId)
    return {
      app: result.app,
      credential: result.credential,
      detail: result.detail,
      error: null,
      status: result.status,
    }
  } catch (error) {
    return {
      app: null,
      credential: null,
      detail: null,
      error: adminMutationErrorDetail(
        error,
        "Firecrawl credential rotation failed.",
      ),
      status: error instanceof AdminMutationError ? "blocked" : "failed",
    }
  }
}

export async function revokeAdminConnectedAppFirecrawlCredentialAction(
  _previousState: ConnectedAppFirecrawlLifecycleActionState,
  formData: FormData,
): Promise<ConnectedAppFirecrawlLifecycleActionState> {
  await requireCapability("applications.credentials.test_rotate_revoke")
  const appId = requiredFormValue(formData, "appId")
  const credentialId = requiredFormValue(formData, "credentialId")

  try {
    const result = await postAdminConnectedAppFirecrawlLifecycleMutation(
      `/api/admin/applications/connected-apps/${encodeURIComponent(
        appId,
      )}/firecrawl/credentials/${encodeURIComponent(credentialId)}/revoke`,
    )
    revalidateConnectedApp(appId)
    return {
      app: result.app,
      detail: result.detail,
      error: null,
      status: "revoked",
    }
  } catch (error) {
    return {
      app: null,
      detail: null,
      error: adminMutationErrorDetail(
        error,
        "Firecrawl credential revocation failed.",
      ),
      status: error instanceof AdminMutationError ? "blocked" : "failed",
    }
  }
}

export async function disableAdminConnectedAppFirecrawlAction(
  _previousState: ConnectedAppFirecrawlLifecycleActionState,
  formData: FormData,
): Promise<ConnectedAppFirecrawlLifecycleActionState> {
  await requireCapability("applications.disable")
  const appId = requiredFormValue(formData, "appId")

  try {
    const result = await postAdminConnectedAppFirecrawlLifecycleMutation(
      `/api/admin/applications/connected-apps/${encodeURIComponent(
        appId,
      )}/firecrawl/disable`,
    )
    revalidateConnectedApp(appId)
    return {
      app: result.app,
      detail: result.detail,
      error: null,
      status: "disabled",
    }
  } catch (error) {
    return {
      app: null,
      detail: null,
      error: adminMutationErrorDetail(
        error,
        "Firecrawl could not be disabled.",
      ),
      status: error instanceof AdminMutationError ? "blocked" : "failed",
    }
  }
}

export async function updateAdminConnectedAppFirecrawlPolicyAction(
  formData: FormData,
): Promise<void> {
  await requireCapability("applications.policy.change")
  const appId = requiredFormValue(formData, "appId")
  const fallback = connectedAppReturnHref(formData, appId)
  const parsed = adminConnectedAppFirecrawlPolicyRequestSchema.safeParse({
    maxConcurrentScrapes: checkboxFormValue(
      formData,
      "firecrawlMaxConcurrentScrapesEnabled",
    )
      ? parseOptionalPositiveInt(
          optionalFormValue(formData, "firecrawlMaxConcurrentScrapes"),
        )
      : null,
    scrapeRateLimitRps: checkboxFormValue(
      formData,
      "firecrawlScrapeRateLimitRpsEnabled",
    )
      ? parseOptionalPositiveInt(
          optionalFormValue(formData, "firecrawlScrapeRateLimitRps"),
        )
      : null,
    searchRateLimitRps: checkboxFormValue(
      formData,
      "firecrawlSearchRateLimitRpsEnabled",
    )
      ? parseOptionalPositiveInt(
          optionalFormValue(formData, "firecrawlSearchRateLimitRps"),
        )
      : null,
  })
  if (!parsed.success) {
    redirectTo(withActionStatus(fallback, "appAction", "firecrawlInvalid"))
  }

  try {
    await patchAdminConnectedAppFirecrawlMutation(
      `/api/admin/applications/connected-apps/${encodeURIComponent(
        appId,
      )}/firecrawl`,
      parsed.data,
    )
  } catch (error) {
    rethrowTerminalConsoleSession(error)
    redirectTo(withActionStatus(fallback, "appAction", "firecrawlFailed"))
  }

  revalidateConnectedApp(appId)
  redirectTo(withActionStatus(fallback, "appAction", "firecrawlUpdated"))
}

export async function updateAdminConnectedAppPolicyAction(
  formData: FormData,
): Promise<void> {
  await requireCapability("applications.policy.change")
  const appId = requiredFormValue(formData, "appId")
  const fallback = connectedAppReturnHref(formData, appId)
  const parsed = adminConnectedAppUpdateRequestSchema.safeParse({
    allowedModels: formData.getAll("allowedModels").flatMap((value) => {
      if (typeof value !== "string") {
        return []
      }
      const model = value.trim()
      return model ? [model] : []
    }),
    description: optionalFormValue(formData, "description") ?? "",
    maxConcurrentRequests: checkboxFormValue(
      formData,
      "maxConcurrentRequestsEnabled",
    )
      ? parseOptionalPositiveInt(
          optionalFormValue(formData, "maxConcurrentRequests"),
        )
      : null,
    maxContextBytes: checkboxFormValue(formData, "maxContextBytesEnabled")
      ? parseOptionalPositiveInt(optionalFormValue(formData, "maxContextBytes"))
      : null,
    name: optionalFormValue(formData, "name") ?? "",
    rateLimitRps: checkboxFormValue(formData, "rateLimitRpsEnabled")
      ? parseOptionalPositiveInt(optionalFormValue(formData, "rateLimitRps"))
      : null,
    tokenAlertThreshold7d: checkboxFormValue(
      formData,
      "tokenAlertThreshold7dEnabled",
    )
      ? parseOptionalPositiveInt(
          optionalFormValue(formData, "tokenAlertThreshold7d"),
        )
      : null,
  })

  if (!parsed.success) {
    redirectTo(withActionStatus(fallback, "appAction", "invalid"))
  }

  try {
    await patchAdminConnectedAppMutation(
      `/api/admin/applications/connected-apps/${encodeURIComponent(appId)}`,
      parsed.data,
    )
  } catch (error) {
    rethrowTerminalConsoleSession(error)
    redirectTo(withActionStatus(fallback, "appAction", "failed"))
  }

  revalidatePath("/applications")
  revalidatePath(`/applications/apps/${appId}`)
  redirectTo(withActionStatus(fallback, "appAction", "updated"))
}

export async function disableAdminConnectedAppAction(
  formData: FormData,
): Promise<void> {
  await requireCapability("applications.disable")
  const appId = requiredFormValue(formData, "appId")
  const fallback = connectedAppReturnHref(formData, appId)

  try {
    await postAdminConnectedAppLifecycleMutation(
      `/api/admin/applications/connected-apps/${encodeURIComponent(
        appId,
      )}/disable`,
    )
  } catch (error) {
    rethrowTerminalConsoleSession(error)
    redirectTo(withActionStatus(fallback, "appAction", "failed"))
  }

  revalidatePath("/applications")
  revalidatePath(`/applications/apps/${appId}`)
  redirectTo(withActionStatus(fallback, "appAction", "disabled"))
}

export async function enableAdminConnectedAppAction(
  formData: FormData,
): Promise<void> {
  await requireCapability("applications.reenable")
  const appId = requiredFormValue(formData, "appId")
  const fallback = connectedAppReturnHref(formData, appId)

  try {
    await postAdminConnectedAppLifecycleMutation(
      `/api/admin/applications/connected-apps/${encodeURIComponent(
        appId,
      )}/enable`,
    )
  } catch (error) {
    rethrowTerminalConsoleSession(error)
    redirectTo(withActionStatus(fallback, "appAction", "failed"))
  }

  revalidatePath("/applications")
  revalidatePath(`/applications/apps/${appId}`)
  redirectTo(withActionStatus(fallback, "appAction", "reenabled"))
}

export async function softDeleteAdminConnectedAppAction(
  formData: FormData,
): Promise<void> {
  await requireCapability("applications.create_delete")
  const appId = requiredFormValue(formData, "appId")
  const fallback = "/applications"
  const parsed = adminConnectedAppDeleteRequestSchema.safeParse({
    confirmation: optionalFormValue(formData, "confirmation"),
  })
  if (!parsed.success) {
    redirectTo(
      withActionStatus(
        connectedAppReturnHref(formData, appId),
        "appAction",
        "invalid",
      ),
    )
  }

  try {
    await deleteAdminConnectedAppMutation(
      `/api/admin/applications/connected-apps/${encodeURIComponent(appId)}`,
      parsed.data,
    )
  } catch (error) {
    rethrowTerminalConsoleSession(error)
    redirectTo(
      withActionStatus(
        connectedAppReturnHref(formData, appId),
        "appAction",
        "failed",
      ),
    )
  }

  revalidatePath("/applications")
  revalidatePath(`/applications/apps/${appId}`)
  redirectTo(withActionStatus(fallback, "appAction", "deleted"))
}

async function requireAdmin() {
  return requireCapability("team.users_roles.manage")
}

async function requireCapability(capability: InferenceCoreCapability) {
  const resolution = await getCurrentConsoleSession()
  const returnTo = consoleElevationReturnPath(capability)
  if (resolution.state === "terminal") {
    redirectTo(consoleExpiredSessionHref(returnTo))
  }
  if (resolution.state === "unavailable") {
    redirectTo(consoleUnavailableSessionHref(returnTo))
  }
  if (!roleHasInferenceCoreCapability(resolution.session.role, capability)) {
    throw new Error("Authorized Console session required.")
  }
  const highRiskAction = consoleHighRiskActionSchema.safeParse(capability)
  if (
    highRiskAction.success &&
    !hasFreshConsoleMfa(resolution.session.mfaVerifiedAt)
  ) {
    redirectTo(consoleMfaElevationHref(highRiskAction.data, returnTo))
  }
  return resolution.session
}

function consoleElevationReturnPath(
  capability: InferenceCoreCapability,
): string {
  if (
    capability.startsWith("applications.") ||
    capability.startsWith("firecrawl.")
  ) {
    return "/applications"
  }
  if (capability.startsWith("team.")) {
    return "/team"
  }
  if (capability.startsWith("activity_audit.")) {
    return "/activity"
  }
  if (
    capability.startsWith("updates.") ||
    capability.startsWith("isolation.")
  ) {
    return "/settings"
  }
  return "/"
}

function redirectTo(href: string): never {
  redirect(href)
}

async function postAdminConnectedAppCreateMutation(
  path: string,
  body: unknown,
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

async function postAdminConnectedAppRotateMutation(path: string) {
  return adminConnectedAppRotateCredentialResultSchema.parse(
    await postAdminMutation(
      path,
      undefined,
      "connected app credential rotation",
    ),
  )
}

async function postAdminConnectedAppRevokeMutation(path: string) {
  return adminConnectedAppSchema.parse(
    await postAdminMutation(path, undefined, "connected app credential revoke"),
  )
}

async function postAdminConnectedAppFirecrawlCredentialMutation(
  path: string,
  body?: unknown,
) {
  return adminConnectedAppFirecrawlCredentialResultSchema.parse(
    await postAdminMutation(path, body, "connected app Firecrawl credential"),
  )
}

async function postAdminConnectedAppFirecrawlTestMutation(path: string) {
  return adminConnectedAppFirecrawlTestResultSchema.parse(
    await postAdminMutation(path, undefined, "connected app Firecrawl test"),
  )
}

async function postAdminConnectedAppFirecrawlLifecycleMutation(path: string) {
  return adminConnectedAppFirecrawlLifecycleResultSchema.parse(
    await postAdminMutation(path, undefined, "connected app Firecrawl"),
  )
}

async function patchAdminConnectedAppFirecrawlMutation(
  path: string,
  body: unknown,
) {
  return adminConnectedAppFirecrawlLifecycleResultSchema.parse(
    await adminMutation(path, body, "connected app Firecrawl policy", "PATCH"),
  )
}

function revalidateConnectedApp(appId: string): void {
  revalidatePath("/applications")
  revalidatePath(`/applications/apps/${appId}`)
}

async function patchAdminConnectedAppMutation(path: string, body: unknown) {
  return adminConnectedAppSchema.parse(
    await adminMutation(path, body, "connected app policy update", "PATCH"),
  )
}

async function postAdminConnectedAppLifecycleMutation(path: string) {
  return adminConnectedAppLifecycleResultSchema.parse(
    await postAdminMutation(path, undefined, "connected app lifecycle"),
  )
}

async function deleteAdminConnectedAppMutation(path: string, body: unknown) {
  return adminConnectedAppLifecycleResultSchema.parse(
    await adminMutation(path, body, "connected app soft delete", "DELETE"),
  )
}

async function postAdminSettingsMutation(
  path: string,
  body: unknown | undefined,
) {
  return adminSettingsResponseSchema.parse(
    await postAdminMutation(path, body, "settings"),
  )
}

async function postAdminTeamMemberMutation(
  path: string,
  body: unknown | undefined,
) {
  return adminTeamMemberMutationResponseSchema.parse(
    await postAdminMutation(path, body, "Team member"),
  )
}

async function postAdminTeamActionMutation(
  path: string,
  body: unknown | undefined,
) {
  return adminTeamActionResponseSchema.parse(
    await postAdminMutation(path, body, "Team member action"),
  )
}

async function postAdminTeamGroupMutation(
  path: string,
  body: unknown | undefined,
) {
  return adminTeamGroupMutationResponseSchema.parse(
    await postAdminMutation(path, body, "Team group"),
  )
}

async function postAdminTeamCsvImportPreviewMutation(
  path: string,
  body: unknown,
) {
  return adminTeamCsvImportPreviewResponseSchema.parse(
    await postAdminMutation(path, body, "Team CSV import preview"),
  )
}

async function postAdminTeamCsvImportCommitMutation(
  path: string,
  body: unknown,
) {
  return adminTeamCsvImportCommitResponseSchema.parse(
    await postAdminMutation(path, body, "Team CSV import commit"),
  )
}

async function postAdminMutation(
  path: string,
  body: unknown | undefined,
  label: string,
): Promise<unknown> {
  return adminMutation(path, body, label, "POST")
}

async function adminMutation(
  path: string,
  body: unknown | undefined,
  label: string,
  method: "DELETE" | "PATCH" | "POST",
): Promise<unknown> {
  const bffRequest = await getBffRequest()
  if (bffRequest.state === "terminal") {
    throw new ConsoleSessionTerminalMutationError(
      consoleMutationReturnPath(path),
    )
  }
  if (bffRequest.state === "unavailable") {
    throw new AdminMutationError(
      "Console session is temporarily unavailable.",
      503,
    )
  }

  const headers = new Headers(bffRequest.headers)
  headers.set("Idempotency-Key", randomUUID())
  if (body !== undefined) {
    headers.set("Content-Type", "application/json")
  }

  const response = await fetch(`${bffRequest.baseUrl}${path}`, {
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
    headers,
    method,
  })
  if (response.status === 401) {
    await response.body?.cancel().catch(() => undefined)
    throw new ConsoleSessionTerminalMutationError(
      consoleMutationReturnPath(path),
    )
  }
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

class ConsoleSessionTerminalMutationError extends AdminMutationError {
  constructor(readonly returnTo: string) {
    super("Console session expired.", 401)
    this.name = "ConsoleSessionTerminalMutationError"
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
  rethrowTerminalConsoleSession(error)
  if (error instanceof AdminMutationError && error.detail) {
    return error.detail
  }
  return fallback
}

function rethrowTerminalConsoleSession(error: unknown): void {
  if (!(error instanceof ConsoleSessionTerminalMutationError)) {
    return
  }
  redirectTo(consoleExpiredSessionHref(error.returnTo))
}

function consoleExpiredSessionHref(returnTo: string): string {
  const query = new URLSearchParams({
    session: "expired",
    returnTo: normalizeConsoleReturnPath(returnTo),
  })
  return `/auth/signin?${query.toString()}`
}

function consoleUnavailableSessionHref(returnTo: string): string {
  const query = new URLSearchParams({
    returnTo: normalizeConsoleReturnPath(returnTo),
  })
  return `/auth/unavailable?${query.toString()}`
}

function consoleMutationReturnPath(path: string): string {
  if (path.startsWith("/api/admin/applications/")) {
    return "/applications"
  }
  if (path.startsWith("/api/admin/team/")) {
    return "/team"
  }
  if (path.startsWith("/api/admin/settings/")) {
    return "/settings"
  }
  return "/"
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

function parseHumanRole(value: string): InferenceCoreHumanRole {
  if (value === "admin" || value === "operator") {
    return value
  }
  throw new Error("role must be operator or admin.")
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

function parsePositiveInteger(value: string): number {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error("Expected a positive integer.")
  }
  return parsed
}

function parseAdminSettingsLanguage(value: string): AdminSettingsLanguage {
  return value === "hr" ? "hr" : "en"
}

function parseOptionalPositiveInt(value: string | null): number | null {
  const trimmed = value?.trim()
  if (!trimmed) {
    return null
  }
  const parsed = Number(trimmed)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : Number.NaN
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
  const status = params.get("settingsAction")
  if (status) {
    allowed.set("settingsAction", status)
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
  const status = params.get("appAction")
  if (status) {
    allowed.set("appAction", status)
  }
  const queryString = allowed.toString()
  return `${path}${queryString ? `?${queryString}` : ""}`
}

function teamReturnHref(formData: FormData, fallback = "/team"): string {
  return sanitizeTeamReturnTo(optionalFormValue(formData, "returnTo"), fallback)
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
  const status = params.get("teamAction")
  if (status) {
    allowed.set("teamAction", status)
  }
  const queryString = allowed.toString()
  return `${path}${queryString ? `?${queryString}` : ""}`
}

function withActionStatus(href: string, key: string, value: string): string {
  const [path, query = ""] = href.split("?")
  const params = new URLSearchParams(query)
  params.set(key, value)
  return `${path}?${params.toString()}`
}

function capitalize(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`
}
