import { createHash } from "node:crypto"
import {
  type EmergencyRecoveryActivationResult,
  type EmergencyRecoveryCommissionResult,
  type EmergencyRecoveryReasonCode,
  adminAlertEgressResponseSchema,
  adminAuditExportFormatSchema,
  adminAuditResponseSchema,
  adminAuditVerificationKeysResponseSchema,
  adminConnectedAppCreateRequestSchema,
  adminConnectedAppCreateResponseSchema,
  adminConnectedAppDeleteRequestSchema,
  adminConnectedAppDetailSchema,
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
  adminConnectedAppsResponseSchema,
  adminHardwareResponseSchema,
  adminInferenceDashboardSchema,
  adminInferenceModelUpdateActionResponseSchema,
  adminOverviewResponseSchema,
  adminSettingsResponseSchema,
  adminTeamActionResponseSchema,
  adminTeamBulkGroupAssignmentRequestSchema,
  adminTeamCsvImportCommitRequestSchema,
  adminTeamCsvImportCommitResponseSchema,
  adminTeamCsvImportPreviewRequestSchema,
  adminTeamCsvImportPreviewResponseSchema,
  adminTeamGroupDetailSchema,
  adminTeamGroupMutationResponseSchema,
  adminTeamMemberDetailSchema,
  adminTeamMemberMutationResponseSchema,
  adminTeamOverviewResponseSchema,
  adminTeamScimStatusSchema,
  applyAdminInferenceModelUpdateRequestSchema,
  createAdminTeamGroupRequestSchema,
  createAdminTeamMemberRequestSchema,
  deleteAdminTeamMemberRequestSchema,
  emergencyRecoveryActivationResultSchema,
  emergencyRecoveryCommissionResultSchema,
  emergencyRecoveryReasonCodeSchema,
  emergencyRecoveryRevocationResultSchema,
  emergencyRecoveryStatusResultSchema,
  updateAdminAlertEgressRequestSchema,
  updateAdminSettingsOrganizationRequestSchema,
  updateAdminSettingsTelemetryRequestSchema,
  updateAdminTeamGroupRequestSchema,
} from "@llm-machines/contracts/inference-core"
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import type { Actor } from "../auth/authorization"
import { withAdminOnly, withCapability } from "../auth/authorization"
import { getInferenceCoreDb } from "../db/inference-core-client"
import {
  AdminAlertEgressConflictError,
  AdminAlertEgressUnavailableError,
  getAdminAlertEgress,
  updateAdminAlertEgress,
} from "../services/admin-alert-egress"
import {
  AdminAuditFilterError,
  getAdminAuditTimeline,
  normalizeAdminAuditFilters,
} from "../services/admin-audit"
import {
  createAdminConnectedApp,
  deleteAdminConnectedApp,
  disableAdminConnectedApp,
  enableAdminConnectedApp,
  getAdminConnectedAppDetail,
  getAdminConnectedAppProjection,
  getAdminConnectedApps,
  preflightAdminConnectedAppCredentialRotation,
  preflightConnectedAppCredentialReveal,
  revokeAdminConnectedAppCredential,
  rotateAdminConnectedAppCredentials,
  testAdminConnectedApp,
  updateAdminConnectedApp,
} from "../services/admin-connected-apps"
import {
  AdminConnectedAppFirecrawlCredentialCommitRaceError,
  disableAdminConnectedAppFirecrawl,
  enableAdminConnectedAppFirecrawl,
  preflightAdminConnectedAppFirecrawlReadiness,
  revokeAdminConnectedAppFirecrawlCredential,
  rotateAdminConnectedAppFirecrawlCredential,
  testAdminConnectedAppFirecrawl,
  updateAdminConnectedAppFirecrawlPolicy,
} from "../services/admin-connected-apps-firecrawl"
import { getAdminHardware } from "../services/admin-hardware"
import {
  applyAdminInferenceModelUpdate,
  getAdminInference,
} from "../services/admin-inference"
import { getAdminOverview } from "../services/admin-overview"
import {
  getAdminSettings,
  updateAdminSettingsOrganization,
  updateAdminSettingsTelemetry,
} from "../services/admin-settings-core"
import {
  AdminTeamError,
  type AdminTeamMutationContext,
  TEAM_CSV_TEMPLATE,
  bulkAssignAdminTeamGroupMembers,
  commitAdminTeamCsvImport,
  createAdminTeamGroup,
  createAdminTeamMember,
  deleteAdminTeamGroup,
  deleteAdminTeamMember,
  disableAdminTeamMember,
  generateAdminTeamPassword,
  getAdminTeamGroupDetail,
  getAdminTeamMemberDetail,
  getAdminTeamOverview,
  getAdminTeamScimStatus,
  previewAdminTeamCsvImport,
  reactivateAdminTeamMember,
  removeAdminTeamGroupMember,
  sendAdminTeamInvite,
  sendAdminTeamPasswordReset,
  updateAdminTeamGroup,
} from "../services/admin-team"
import { InvalidAuditCursorError } from "../services/audit"
import {
  AuditExportLimitError,
  AuditExportRangeError,
  createSignedAuditExport,
  getAuditExportVerificationKeys,
} from "../services/audit-export"
import { AuditExportSigningUnavailableError } from "../services/audit-export-signing"
import type { EmergencyRecoveryService } from "../services/emergency-recovery"
import {
  IdempotencyCompletionError,
  type IdempotencyReceipt,
  completeIdempotency,
  reserveIdempotency,
} from "../services/idempotency"
import {
  IdentityMutationExecutionError,
  IdentityMutationReconciliationRequiredError,
} from "../services/identity-mutation-journal"

export const adminOnlyAdminRoutePolicyKeys = [
  "GET /api/admin/recovery/status",
  "POST /api/admin/recovery/factor/commission",
  "POST /api/admin/observability/alert-egress",
  "POST /api/admin/settings/organization",
  "POST /api/admin/settings/telemetry",
] as const

const teamCsvImportBodyLimitBytes = 256 * 1024

type AdminOnlyAdminRoutePolicyKey =
  (typeof adminOnlyAdminRoutePolicyKeys)[number]

export type AdminEmergencyRecoveryService = Pick<
  EmergencyRecoveryService,
  "activate" | "commission" | "resolve" | "revoke" | "status"
>

export interface AdminRouteOptions {
  emergencyRecoveryService: AdminEmergencyRecoveryService | null
}

export function registerAdminRoutes(
  server: FastifyInstance,
  options: AdminRouteOptions = { emergencyRecoveryService: null },
): void {
  server.post(
    "/api/admin/recovery/factor/commission",
    reviewedAdminOnly("POST /api/admin/recovery/factor/commission"),
    async (request, reply) => {
      if (!isStrictEmptyBody(request.body)) {
        return invalidRequest(
          reply,
          "Invalid emergency recovery commission request",
          "The commission request body must be empty.",
        )
      }
      const service = options.emergencyRecoveryService
      if (!service) {
        return recoveryUnavailable(reply)
      }
      const actor = requireActor(request)
      const result = emergencyRecoveryCommissionResultSchema.safeParse(
        await service.commission({
          authentication: recoveryAuthentication(actor),
          correlationId: request.id,
          liveIdentity: recoveryLiveIdentity(actor),
        }),
      )
      return result.success
        ? recoveryCommissionResult(reply, result.data)
        : recoveryUnavailable(reply)
    },
  )

  server.post(
    "/api/admin/recovery/sessions",
    withCapability("console.operational.view"),
    async (request, reply) => {
      const body = recoveryActivationBody(request.body)
      if (!body) {
        return invalidRequest(
          reply,
          "Invalid emergency recovery activation request",
          "A recovery factor and approved reason code are required.",
        )
      }
      const actor = requireActor(request)
      if (actor.role !== "operator") {
        return recoveryDenied(
          reply,
          "Only an enabled Operator can activate emergency recovery.",
        )
      }
      const service = options.emergencyRecoveryService
      if (!service) {
        return recoveryUnavailable(reply)
      }
      const result = emergencyRecoveryActivationResultSchema.safeParse(
        await service.activate({
          authentication: recoveryAuthentication(actor),
          correlationId: request.id,
          factor: body.factor,
          liveIdentity: recoveryLiveIdentity(actor),
          reasonCode: body.reasonCode,
        }),
      )
      return result.success
        ? recoveryActivationResult(reply, result.data)
        : recoveryUnavailable(reply)
    },
  )

  server.get(
    "/api/admin/recovery/status",
    reviewedAdminOnly("GET /api/admin/recovery/status"),
    async (_request, reply) => {
      const service = options.emergencyRecoveryService
      if (!service) {
        return recoveryUnavailable(reply)
      }
      const result = emergencyRecoveryStatusResultSchema.safeParse(
        await service.status(),
      )
      return result.success && result.data.status === "ok"
        ? reply.send(result.data)
        : recoveryUnavailable(reply)
    },
  )

  server.post(
    "/api/admin/recovery/sessions/:id/revoke",
    withCapability("console.operational.view"),
    async (request, reply) => {
      if (!isStrictEmptyBody(request.body)) {
        return invalidRequest(
          reply,
          "Invalid emergency recovery revocation request",
          "The revocation request body must be empty.",
        )
      }
      const id = routeId(request)
      if (!id) {
        return missingId(reply, "Emergency recovery session")
      }
      const service = options.emergencyRecoveryService
      if (!service) {
        return recoveryUnavailable(reply)
      }
      const actor = requireActor(request)
      const result = emergencyRecoveryRevocationResultSchema.safeParse(
        await service.revoke({
          allowAny: actor.role === "admin",
          correlationId: request.id,
          requesterSubjectId: actor.subject,
          sessionId: id,
        }),
      )
      if (!result.success) {
        return recoveryUnavailable(reply)
      }
      if (result.data.status === "revoked") {
        return reply.send(result.data)
      }
      if (result.data.status === "not_found") {
        return reply.code(404).send({
          type: "about:blank",
          title: "Emergency recovery session not found",
          status: 404,
        })
      }
      return recoveryUnavailable(reply)
    },
  )

  server.get(
    "/api/admin/audit",
    withCapability("console.operational.view"),
    async (request, reply) => {
      try {
        return adminAuditResponseSchema.parse(
          await getAdminAuditTimeline(
            requireActor(request),
            getAuditQuery(request),
          ),
        )
      } catch (error) {
        if (
          error instanceof AdminAuditFilterError ||
          error instanceof InvalidAuditCursorError
        ) {
          return invalidRequest(
            reply,
            "Invalid audit filters",
            "Use bounded audit filters and an unmodified page cursor.",
          )
        }
        throw error
      }
    },
  )

  server.get(
    "/api/admin/audit/export/verification-keys",
    withCapability("activity_audit.export"),
    async (_request, reply) => {
      try {
        const keys = adminAuditVerificationKeysResponseSchema.parse(
          await getAuditExportVerificationKeys(requireActor(_request)),
        )
        return reply.type("application/jwk-set+json").send(keys)
      } catch (error) {
        if (error instanceof AuditExportSigningUnavailableError) {
          return auditExportUnavailable(reply)
        }
        throw error
      }
    },
  )

  server.get(
    "/api/admin/audit/export",
    withCapability("activity_audit.export"),
    async (request, reply) => {
      const rawFormat = stringQuery(objectQuery(request), "format")
      const format = adminAuditExportFormatSchema.safeParse(rawFormat)
      if (!format.success) {
        return invalidRequest(
          reply,
          "Invalid audit export format",
          "Audit export format must be json or csv.",
        )
      }
      try {
        const normalized = normalizeAdminAuditFilters(getAuditQuery(request))
        const exportWindow = getAuditExportWindow(request)
        if (!exportWindow) {
          return invalidRequest(
            reply,
            "Invalid audit export filters",
            "Canonical UTC from and to timestamps are required, with a maximum 365-day range.",
          )
        }
        const requestStartedAt = new Date()
        const result = await createSignedAuditExport(
          requireActor(request),
          format.data,
          {
            applicationId: normalized.applicationId,
            eventId: normalized.eventId,
            outcome: normalized.outcome,
            query: normalized.query,
            severity: normalized.severity,
            sourceSystem: normalized.sourceSystem,
          },
          {
            cursor: normalized.cursor,
            from: exportWindow.from,
            limit: exportWindow.limit,
            to: exportWindow.to,
          },
          { now: requestStartedAt },
        )
        const response = reply
          .type("application/jose")
          .header(
            "content-disposition",
            `attachment; filename="${result.filename}"`,
          )
          .header("x-llm-machines-audit-content-type", result.contentType)
          .header("x-llm-machines-audit-event-count", result.eventCount)
          .header("x-llm-machines-audit-format", result.format)
          .header("x-llm-machines-audit-payload-bytes", result.payloadBytes)
        if (result.nextCursor) {
          response.header("x-llm-machines-audit-next-cursor", result.nextCursor)
        }
        return response.send(result.compactJws)
      } catch (error) {
        if (
          error instanceof AdminAuditFilterError ||
          error instanceof InvalidAuditCursorError ||
          error instanceof AuditExportRangeError
        ) {
          return invalidRequest(
            reply,
            "Invalid audit export filters",
            "Use bounded metadata-only audit filters.",
          )
        }
        if (error instanceof AuditExportLimitError) {
          return reply.code(413).send({
            type: "about:blank",
            title: "Audit export is too large",
            status: 413,
            detail:
              "Narrow the audit filters to at most 5000 events and 8 MiB.",
          })
        }
        if (error instanceof AuditExportSigningUnavailableError) {
          return auditExportUnavailable(reply)
        }
        throw error
      }
    },
  )

  server.get(
    "/api/admin/overview",
    withCapability("console.operational.view"),
    async (request) =>
      adminOverviewResponseSchema.parse(
        await getAdminOverview(requireActor(request)),
      ),
  )

  server.get(
    "/api/admin/settings",
    withCapability("console.operational.view"),
    async (request) =>
      adminSettingsResponseSchema.parse(
        await getAdminSettings(requireActor(request)),
      ),
  )

  server.get(
    "/api/admin/observability/alert-egress",
    withCapability("console.operational.view"),
    async (_request, reply) => {
      try {
        return adminAlertEgressResponseSchema.parse(await getAdminAlertEgress())
      } catch (error) {
        if (error instanceof AdminAlertEgressUnavailableError) {
          return alertEgressUnavailable(reply)
        }
        throw error
      }
    },
  )

  server.post(
    "/api/admin/observability/alert-egress",
    reviewedAdminOnly("POST /api/admin/observability/alert-egress"),
    async (request, reply) => {
      const body = updateAdminAlertEgressRequestSchema.safeParse(
        request.body ?? {},
      )
      if (!body.success) {
        return invalidRequest(
          reply,
          "Invalid alert egress request",
          "Only disabled, SMTP, or webhook intent is accepted; outbound delivery requires the exact current warning acknowledgement.",
        )
      }
      return withAdminIdempotentMutation(
        request,
        reply,
        "POST /api/admin/observability/alert-egress",
        body.data,
        async (actor, identityContext) => ({
          idempotencyResourceId: "singleton",
          payload: adminAlertEgressResponseSchema.parse(
            await updateAdminAlertEgress(
              actor,
              request.id,
              body.data,
              identityContext.commitWithReceipt,
            ),
          ),
          statusCode: 200,
        }),
      )
    },
  )

  server.post(
    "/api/admin/settings/organization",
    reviewedAdminOnly("POST /api/admin/settings/organization"),
    async (request, reply) => {
      const body = updateAdminSettingsOrganizationRequestSchema.safeParse(
        request.body ?? {},
      )
      if (!body.success) {
        return invalidRequest(
          reply,
          "Invalid organization settings request",
          "Organization name, default language, and valid PNG/JPEG logo metadata are required.",
        )
      }
      return withAdminIdempotentMutation(
        request,
        reply,
        "POST /api/admin/settings/organization",
        body.data,
        async (actor) =>
          settingsMutationResponse(
            await updateAdminSettingsOrganization(actor, body.data),
            "Organization settings rejected",
          ),
      )
    },
  )

  server.post(
    "/api/admin/settings/telemetry",
    reviewedAdminOnly("POST /api/admin/settings/telemetry"),
    async (request, reply) => {
      const body = updateAdminSettingsTelemetryRequestSchema.safeParse(
        request.body ?? {},
      )
      if (!body.success) {
        return invalidRequest(
          reply,
          "Invalid telemetry settings request",
          "Telemetry can only be enabled with exact ENABLE TELEMETRY confirmation.",
        )
      }
      return withAdminIdempotentMutation(
        request,
        reply,
        "POST /api/admin/settings/telemetry",
        body.data,
        async (actor) =>
          settingsMutationResponse(
            await updateAdminSettingsTelemetry(actor, body.data),
            "Telemetry settings rejected",
          ),
      )
    },
  )

  server.get(
    "/api/admin/team",
    withCapability("team.identity.view"),
    async (request) =>
      adminTeamOverviewResponseSchema.parse(
        await getAdminTeamOverview(requireActor(request)),
      ),
  )

  server.get(
    "/api/admin/team/scim",
    withCapability("team.identity.view"),
    async (request) =>
      adminTeamScimStatusSchema.parse(
        await getAdminTeamScimStatus(requireActor(request)),
      ),
  )

  server.get(
    "/api/admin/team/csv-template",
    withCapability("team.identity.view"),
    async (_request, reply) =>
      reply
        .header("content-type", "text/csv; charset=utf-8")
        .header(
          "content-disposition",
          'attachment; filename="team-users-template.csv"',
        )
        .send(TEAM_CSV_TEMPLATE),
  )

  server.post(
    "/api/admin/team/import/preview",
    {
      bodyLimit: teamCsvImportBodyLimitBytes,
      config: {
        authorization: {
          capability: "team.identity.view",
          kind: "capability",
        },
      },
    },
    async (request, reply) => {
      const body = adminTeamCsvImportPreviewRequestSchema.safeParse(
        request.body ?? {},
      )
      if (!body.success) {
        return invalidRequest(
          reply,
          "Invalid Team CSV import preview request",
          "CSV text is required.",
        )
      }
      return teamRouteResult(reply, async () =>
        adminTeamCsvImportPreviewResponseSchema.parse(
          await previewAdminTeamCsvImport(requireActor(request), body.data),
        ),
      )
    },
  )

  server.post(
    "/api/admin/team/import/commit",
    {
      bodyLimit: teamCsvImportBodyLimitBytes,
      config: {
        authorization: {
          capability: "team.users_roles.manage",
          kind: "capability",
        },
      },
    },
    async (request, reply) => {
      const body = adminTeamCsvImportCommitRequestSchema.safeParse(
        request.body ?? {},
      )
      if (!body.success) {
        return invalidRequest(
          reply,
          "Invalid Team CSV import commit request",
          "CSV text is required.",
        )
      }
      return withAdminIdempotentMutation(
        request,
        reply,
        "POST /api/admin/team/import/commit",
        body.data,
        async (actor, identityContext) => ({
          payload: adminTeamCsvImportCommitResponseSchema.parse(
            await commitAdminTeamCsvImport(actor, body.data, identityContext),
          ),
          statusCode: 200,
        }),
        200,
      )
    },
  )

  server.get(
    "/api/admin/team/groups/:id",
    withCapability("team.identity.view"),
    async (request, reply) => {
      const id = routeId(request)
      if (!id) {
        return missingId(reply, "Team group")
      }
      return teamRouteResult(reply, async () =>
        adminTeamGroupDetailSchema.parse(
          await getAdminTeamGroupDetail(requireActor(request), id),
        ),
      )
    },
  )

  server.post(
    "/api/admin/team/groups",
    withCapability("team.users_roles.manage"),
    async (request, reply) => {
      const body = createAdminTeamGroupRequestSchema.safeParse(
        request.body ?? {},
      )
      if (!body.success) {
        return invalidRequest(
          reply,
          "Invalid Team group request",
          "A group name is required.",
        )
      }
      return withAdminIdempotentMutation(
        request,
        reply,
        "POST /api/admin/team/groups",
        body.data,
        async (actor, identityContext) => ({
          payload: adminTeamGroupMutationResponseSchema.parse(
            await createAdminTeamGroup(actor, body.data, identityContext),
          ),
          statusCode: 201,
        }),
        201,
      )
    },
  )

  server.post(
    "/api/admin/team/groups/:id/update",
    withCapability("team.users_roles.manage"),
    async (request, reply) => {
      const id = routeId(request)
      const body = updateAdminTeamGroupRequestSchema.safeParse(
        request.body ?? {},
      )
      if (!id) {
        return missingId(reply, "Team group")
      }
      if (!body.success) {
        return invalidRequest(
          reply,
          "Invalid Team group request",
          "A group name is required.",
        )
      }
      return withAdminIdempotentMutation(
        request,
        reply,
        "POST /api/admin/team/groups/:id/update",
        { id, ...body.data },
        async (actor, identityContext) => ({
          payload: adminTeamGroupMutationResponseSchema.parse(
            await updateAdminTeamGroup(actor, id, body.data, identityContext),
          ),
          statusCode: 200,
        }),
        200,
      )
    },
  )

  server.post(
    "/api/admin/team/groups/:id/delete",
    withCapability("team.users_roles.manage"),
    async (request, reply) => {
      const id = routeId(request)
      if (!id) {
        return missingId(reply, "Team group")
      }
      return withAdminIdempotentMutation(
        request,
        reply,
        "POST /api/admin/team/groups/:id/delete",
        { id },
        async (actor, identityContext) => ({
          payload: adminTeamGroupMutationResponseSchema.parse(
            await deleteAdminTeamGroup(actor, id, identityContext),
          ),
          statusCode: 200,
        }),
        200,
      )
    },
  )

  server.post(
    "/api/admin/team/groups/:id/members/bulk-assign",
    withCapability("team.users_roles.manage"),
    async (request, reply) => {
      const id = routeId(request)
      const body = adminTeamBulkGroupAssignmentRequestSchema.safeParse(
        request.body ?? {},
      )
      if (!id) {
        return missingId(reply, "Team group")
      }
      if (!body.success) {
        return invalidRequest(
          reply,
          "Invalid Team group assignment request",
          "At least one member id is required.",
        )
      }
      return withAdminIdempotentMutation(
        request,
        reply,
        "POST /api/admin/team/groups/:id/members/bulk-assign",
        { id, ...body.data },
        async (actor, identityContext) => ({
          payload: adminTeamGroupMutationResponseSchema.parse(
            await bulkAssignAdminTeamGroupMembers(
              actor,
              id,
              body.data,
              identityContext,
            ),
          ),
          statusCode: 200,
        }),
        200,
      )
    },
  )

  server.post(
    "/api/admin/team/groups/:id/members/:memberId/remove",
    withCapability("team.users_roles.manage"),
    async (request, reply) => {
      const { id, memberId } = request.params as {
        id?: string
        memberId?: string
      }
      if (!id || !memberId) {
        return invalidRequest(reply, "Team group and member ids are required")
      }
      return withAdminIdempotentMutation(
        request,
        reply,
        "POST /api/admin/team/groups/:id/members/:memberId/remove",
        { id, memberId },
        async (actor, identityContext) => ({
          payload: adminTeamGroupMutationResponseSchema.parse(
            await removeAdminTeamGroupMember(
              actor,
              id,
              memberId,
              identityContext,
            ),
          ),
          statusCode: 200,
        }),
        200,
      )
    },
  )

  server.get(
    "/api/admin/team/members/:id",
    withCapability("team.identity.view"),
    async (request, reply) => {
      const id = routeId(request)
      if (!id) {
        return missingId(reply, "Team member")
      }
      return teamRouteResult(reply, async () =>
        adminTeamMemberDetailSchema.parse(
          await getAdminTeamMemberDetail(requireActor(request), id),
        ),
      )
    },
  )

  server.post(
    "/api/admin/team/members",
    withCapability("team.users_roles.manage"),
    async (request, reply) => {
      const body = createAdminTeamMemberRequestSchema.safeParse(
        request.body ?? {},
      )
      if (!body.success) {
        return invalidRequest(
          reply,
          "Invalid Team member request",
          "A name, work email, Admin or Operator role, and valid group list are required.",
        )
      }
      return withAdminIdempotentMutation(
        request,
        reply,
        "POST /api/admin/team/members",
        body.data,
        async (actor, identityContext) => {
          const payload = adminTeamMemberMutationResponseSchema.parse(
            await createAdminTeamMember(actor, body.data, identityContext),
          )
          return {
            idempotencyResourceId: payload.member.id,
            payload,
            statusCode: 201,
          }
        },
        201,
      )
    },
  )

  server.post(
    "/api/admin/team/members/:id/invite",
    withCapability("team.users_roles.manage"),
    async (request, reply) =>
      teamMemberAction(request, reply, "invite", sendAdminTeamInvite),
  )
  server.post(
    "/api/admin/team/members/:id/reset-password-email",
    withCapability("team.local_password.manage"),
    async (request, reply) =>
      teamMemberAction(
        request,
        reply,
        "reset-password-email",
        sendAdminTeamPasswordReset,
      ),
  )
  server.post(
    "/api/admin/team/members/:id/generate-password",
    withCapability("team.local_password.manage"),
    async (request, reply) => {
      const id = routeId(request)
      if (!id) {
        return missingId(reply, "Team member")
      }
      return withAdminIdempotentMutation(
        request,
        reply,
        "POST /api/admin/team/members/:id/generate-password",
        { id },
        async (actor, identityContext) => {
          const payload = adminTeamMemberMutationResponseSchema.parse(
            await generateAdminTeamPassword(actor, id, identityContext),
          )
          return {
            idempotencyResourceId: payload.member.id,
            payload,
            statusCode: 200,
          }
        },
        200,
      )
    },
  )
  server.post(
    "/api/admin/team/members/:id/disable",
    withCapability("team.users_roles.manage"),
    async (request, reply) =>
      teamMemberAction(request, reply, "disable", disableAdminTeamMember),
  )
  server.post(
    "/api/admin/team/members/:id/reactivate",
    withCapability("team.users_roles.manage"),
    async (request, reply) =>
      teamMemberAction(request, reply, "reactivate", reactivateAdminTeamMember),
  )
  server.post(
    "/api/admin/team/members/:id/delete",
    withCapability("team.users_roles.manage"),
    async (request, reply) => {
      const body = deleteAdminTeamMemberRequestSchema.safeParse(
        request.body ?? {},
      )
      if (!body.success) {
        return invalidRequest(
          reply,
          "Invalid Team member delete request",
          "Deleting a Team member requires exact DELETE confirmation.",
        )
      }
      return teamMemberAction(
        request,
        reply,
        "delete",
        deleteAdminTeamMember,
        body.data,
      )
    },
  )

  server.get(
    "/api/admin/applications/connected-apps",
    withCapability("console.operational.view"),
    async (request) =>
      adminConnectedAppsResponseSchema.parse(
        await getAdminConnectedApps(requireActor(request)),
      ),
  )

  server.post(
    "/api/admin/applications/connected-apps",
    withCapability("applications.create_delete"),
    async (request, reply) => {
      reply.header("cache-control", "no-store")
      const body = adminConnectedAppCreateRequestSchema.safeParse(
        request.body ?? {},
      )
      if (!body.success) {
        return invalidRequest(
          reply,
          "Invalid connected app request",
          "Name, description, allowed models, and optional limits are required.",
        )
      }
      return withAdminIdempotentMutation(
        request,
        reply,
        "POST /api/admin/applications/connected-apps",
        body.data,
        async (actor, identityContext) => {
          const revealPreflight = preflightConnectedAppCredentialReveal(
            body.data.authMethod,
          )
          if (revealPreflight.status === "blocked") {
            return serviceUnavailable(
              "Connected app endpoint configuration unavailable",
              revealPreflight.detail,
            )
          }
          const result = await createAdminConnectedApp(
            actor,
            body.data,
            identityContext,
            revealPreflight.endpoints,
          )
          if (result.status === "blocked") {
            return serviceUnavailable(
              "Connected app identity unavailable",
              result.detail,
            )
          }
          return {
            idempotencyResourceId: result.app.id,
            payload: adminConnectedAppCreateResponseSchema.parse(result),
            statusCode: 201,
          }
        },
        201,
      )
    },
  )

  server.get(
    "/api/admin/applications/connected-apps/:id",
    withCapability("console.operational.view"),
    async (request, reply) => {
      const id = routeId(request)
      if (!id) {
        return missingId(reply, "Connected app")
      }
      const detail = await getAdminConnectedAppDetail(requireActor(request), id)
      return detail
        ? reply.send(adminConnectedAppDetailSchema.parse(detail))
        : reply.code(404).send(notFoundPayload("Connected app"))
    },
  )

  server.patch(
    "/api/admin/applications/connected-apps/:id",
    withCapability("applications.policy.change"),
    async (request, reply) => {
      const id = routeId(request)
      const body = adminConnectedAppUpdateRequestSchema.safeParse(
        request.body ?? {},
      )
      if (!id) {
        return missingId(reply, "Connected app")
      }
      if (!body.success) {
        return invalidRequest(
          reply,
          "Invalid connected app update",
          "A valid connected app configuration is required.",
        )
      }
      return withAdminIdempotentMutation(
        request,
        reply,
        "PATCH /api/admin/applications/connected-apps/:id",
        { id, body: body.data },
        async (actor) => {
          const result = await updateAdminConnectedApp(actor, id, body.data)
          return result.status === "not_found"
            ? connectedAppNotFound()
            : {
                payload: adminConnectedAppSchema.parse(result.app),
                statusCode: 200,
              }
        },
      )
    },
  )

  server.post(
    "/api/admin/applications/connected-apps/:id/test",
    withCapability("applications.credentials.test_rotate_revoke"),
    async (request, reply) =>
      connectedAppActionResult(
        request,
        reply,
        "POST /api/admin/applications/connected-apps/:id/test",
        async (actor, id) => {
          const result = await testAdminConnectedApp(actor, id)
          return result.status === "not_found"
            ? connectedAppNotFound()
            : {
                payload: adminConnectedAppTestResultSchema.parse(result),
                statusCode: 200,
              }
        },
      ),
  )

  server.post(
    "/api/admin/applications/connected-apps/:id/rotate-credentials",
    withCapability("applications.credentials.test_rotate_revoke"),
    async (request, reply) => {
      reply.header("cache-control", "no-store")
      const id = routeId(request)
      if (!id) {
        return missingId(reply, "Connected app")
      }
      return withAdminIdempotentMutation(
        request,
        reply,
        "POST /api/admin/applications/connected-apps/:id/rotate-credentials",
        { id },
        async (actor, identityContext) => {
          const revealPreflight =
            await preflightAdminConnectedAppCredentialRotation(id)
          if (revealPreflight.status === "not_found") {
            return connectedAppNotFound()
          }
          if (revealPreflight.status === "blocked") {
            return serviceUnavailable(
              "Connected app endpoint configuration unavailable",
              revealPreflight.detail,
            )
          }
          const result = await rotateAdminConnectedAppCredentials(
            actor,
            id,
            identityContext,
            revealPreflight.endpoints,
          )
          if (result.status === "not_found") {
            return connectedAppNotFound()
          }
          if (result.status === "blocked") {
            return connectedAppBlocked(result.detail)
          }
          return {
            idempotencyResourceId: result.app.id,
            payload:
              adminConnectedAppRotateCredentialResultSchema.parse(result),
            statusCode: 200,
          }
        },
      )
    },
  )

  server.post(
    "/api/admin/applications/connected-apps/:id/disable",
    withCapability("applications.disable"),
    async (request, reply) =>
      connectedAppActionResult(
        request,
        reply,
        "POST /api/admin/applications/connected-apps/:id/disable",
        async (actor, id) => {
          const result = await disableAdminConnectedApp(actor, id)
          if (result.status === "not_found") {
            return connectedAppNotFound()
          }
          if (result.status === "blocked") {
            return connectedAppBlocked(result.detail)
          }
          return {
            payload: adminConnectedAppLifecycleResultSchema.parse(result),
            statusCode: 200,
          }
        },
      ),
  )

  server.post(
    "/api/admin/applications/connected-apps/:id/enable",
    withCapability("applications.reenable"),
    async (request, reply) =>
      connectedAppActionResult(
        request,
        reply,
        "POST /api/admin/applications/connected-apps/:id/enable",
        async (actor, id) => {
          const result = await enableAdminConnectedApp(actor, id)
          if (result.status === "not_found") {
            return connectedAppNotFound()
          }
          if (result.status === "blocked") {
            return connectedAppBlocked(result.detail)
          }
          return {
            payload: adminConnectedAppLifecycleResultSchema.parse(result),
            statusCode: 200,
          }
        },
      ),
  )

  server.post(
    "/api/admin/applications/connected-apps/:id/credentials/:credentialId/revoke",
    withCapability("applications.credentials.test_rotate_revoke"),
    async (request, reply) => {
      const id = routeId(request)
      const credentialId = routeCredentialId(request)
      if (!id || !credentialId) {
        return missingId(reply, "Connected app credential")
      }
      return withAdminIdempotentMutation(
        request,
        reply,
        "POST /api/admin/applications/connected-apps/:id/credentials/:credentialId/revoke",
        { credentialId, id },
        async (actor, identityContext) => {
          const result = await revokeAdminConnectedAppCredential(
            actor,
            id,
            credentialId,
            identityContext,
          )
          if (result.status === "not_found") {
            return connectedAppNotFound()
          }
          if (result.status === "blocked") {
            return connectedAppBlocked(result.detail)
          }
          return {
            idempotencyResourceId: result.app.id,
            payload: adminConnectedAppSchema.parse(result.app),
            statusCode: 200,
          }
        },
      )
    },
  )

  server.post(
    "/api/admin/applications/connected-apps/:id/firecrawl/enable",
    withCapability("firecrawl.enable_reenable"),
    async (request, reply) => {
      reply.header("cache-control", "no-store")
      const id = routeId(request)
      const body = adminConnectedAppFirecrawlEnableRequestSchema.safeParse(
        request.body ?? {},
      )
      if (!id) {
        return missingId(reply, "Connected app")
      }
      if (!body.success) {
        return invalidRequest(
          reply,
          "Invalid Firecrawl enable request",
          "Current outbound web processing acceptance is required.",
        )
      }
      return withAdminIdempotentMutation(
        request,
        reply,
        "POST /api/admin/applications/connected-apps/:id/firecrawl/enable",
        { body: body.data, id },
        async (actor, identityContext) => {
          const readiness = preflightAdminConnectedAppFirecrawlReadiness()
          if (readiness.status === "blocked") {
            return serviceUnavailable(
              "Firecrawl is unavailable",
              readiness.detail,
            )
          }
          const result = await enableAdminConnectedAppFirecrawl(
            actor,
            id,
            body.data,
            identityContext,
            async (mutation, transaction) => {
              const app = await getAdminConnectedAppProjection(id, transaction)
              if (!app) {
                throw new Error("Updated Application could not be read back.")
              }
              return {
                idempotencyResourceId: app.id,
                payload: adminConnectedAppFirecrawlCredentialResultSchema.parse(
                  {
                    app,
                    credential: mutation.credential,
                    detail: mutation.detail,
                    status: mutation.status,
                  },
                ),
                statusCode: 200,
              }
            },
          )
          if ("statusCode" in result) {
            return result
          }
          if (result.status === "not_found") {
            return connectedAppNotFound()
          }
          if (result.status === "blocked") {
            return connectedAppBlocked(result.detail)
          }
          const app = await connectedAppAfterFirecrawlMutation(actor, id)
          return {
            idempotencyResourceId: app.id,
            payload: adminConnectedAppFirecrawlCredentialResultSchema.parse({
              app,
              credential: result.credential,
              detail: result.detail,
              status: result.status,
            }),
            statusCode: 200,
          }
        },
      )
    },
  )

  server.patch(
    "/api/admin/applications/connected-apps/:id/firecrawl",
    withCapability("applications.policy.change"),
    async (request, reply) => {
      const id = routeId(request)
      const body = adminConnectedAppFirecrawlPolicyRequestSchema.safeParse(
        request.body ?? {},
      )
      if (!id) {
        return missingId(reply, "Connected app")
      }
      if (!body.success) {
        return invalidRequest(
          reply,
          "Invalid Firecrawl policy",
          "Optional Firecrawl protection limits must be positive values or null.",
        )
      }
      return withAdminIdempotentMutation(
        request,
        reply,
        "PATCH /api/admin/applications/connected-apps/:id/firecrawl",
        { body: body.data, id },
        async (actor) => {
          const result = await updateAdminConnectedAppFirecrawlPolicy(
            actor,
            id,
            body.data,
          )
          if (result.status === "not_found") {
            return connectedAppNotFound()
          }
          if (result.status === "blocked") {
            return connectedAppBlocked(result.detail)
          }
          return {
            payload: adminConnectedAppFirecrawlLifecycleResultSchema.parse({
              app: await connectedAppAfterFirecrawlMutation(actor, id),
              detail: result.detail,
              status: result.status,
            }),
            statusCode: 200,
          }
        },
      )
    },
  )

  server.post(
    "/api/admin/applications/connected-apps/:id/firecrawl/test",
    withCapability("applications.credentials.test_rotate_revoke"),
    async (request, reply) =>
      connectedAppActionResult(
        request,
        reply,
        "POST /api/admin/applications/connected-apps/:id/firecrawl/test",
        async (actor, id) => {
          const result = await testAdminConnectedAppFirecrawl(actor, id)
          if (result.status === "not_found") {
            return connectedAppNotFound()
          }
          return {
            payload: adminConnectedAppFirecrawlTestResultSchema.parse({
              app: await connectedAppAfterFirecrawlMutation(actor, id),
              connectionStatus: result.connectionStatus,
              detail: result.detail,
              observedAt: result.observedAt,
              status: result.status,
            }),
            statusCode: 200,
          }
        },
      ),
  )

  server.post(
    "/api/admin/applications/connected-apps/:id/firecrawl/rotate-credentials",
    withCapability("applications.credentials.test_rotate_revoke"),
    async (request, reply) => {
      reply.header("cache-control", "no-store")
      const id = routeId(request)
      if (!id) {
        return missingId(reply, "Connected app")
      }
      return withAdminIdempotentMutation(
        request,
        reply,
        "POST /api/admin/applications/connected-apps/:id/firecrawl/rotate-credentials",
        { id },
        async (actor, identityContext) => {
          const result = await rotateAdminConnectedAppFirecrawlCredential(
            actor,
            id,
            identityContext,
            async (mutation, transaction) => {
              const app = await getAdminConnectedAppProjection(id, transaction)
              if (!app) {
                throw new Error("Updated Application could not be read back.")
              }
              return {
                idempotencyResourceId: app.id,
                payload: adminConnectedAppFirecrawlCredentialResultSchema.parse(
                  {
                    app,
                    credential: mutation.credential,
                    detail: mutation.detail,
                    status: mutation.status,
                  },
                ),
                statusCode: 200,
              }
            },
          )
          if ("statusCode" in result) {
            return result
          }
          if (result.status === "not_found") {
            return connectedAppNotFound()
          }
          if (result.status === "blocked") {
            return connectedAppBlocked(result.detail)
          }
          const app = await connectedAppAfterFirecrawlMutation(actor, id)
          return {
            idempotencyResourceId: app.id,
            payload: adminConnectedAppFirecrawlCredentialResultSchema.parse({
              app,
              credential: result.credential,
              detail: result.detail,
              status: result.status,
            }),
            statusCode: 200,
          }
        },
      )
    },
  )

  server.post(
    "/api/admin/applications/connected-apps/:id/firecrawl/disable",
    withCapability("applications.disable"),
    async (request, reply) =>
      connectedAppActionResult(
        request,
        reply,
        "POST /api/admin/applications/connected-apps/:id/firecrawl/disable",
        async (actor, id) => {
          const result = await disableAdminConnectedAppFirecrawl(actor, id)
          if (result.status === "not_found") {
            return connectedAppNotFound()
          }
          if (result.status === "blocked") {
            return connectedAppBlocked(result.detail)
          }
          return {
            payload: adminConnectedAppFirecrawlLifecycleResultSchema.parse({
              app: await connectedAppAfterFirecrawlMutation(actor, id),
              detail: result.detail,
              status: result.status,
            }),
            statusCode: 200,
          }
        },
      ),
  )

  server.post(
    "/api/admin/applications/connected-apps/:id/firecrawl/credentials/:credentialId/revoke",
    withCapability("applications.credentials.test_rotate_revoke"),
    async (request, reply) => {
      const id = routeId(request)
      const credentialId = routeCredentialId(request)
      if (!id || !credentialId) {
        return missingId(reply, "Firecrawl credential")
      }
      return withAdminIdempotentMutation(
        request,
        reply,
        "POST /api/admin/applications/connected-apps/:id/firecrawl/credentials/:credentialId/revoke",
        { credentialId, id },
        async (actor) => {
          const result = await revokeAdminConnectedAppFirecrawlCredential(
            actor,
            id,
            credentialId,
          )
          if (result.status === "not_found") {
            return connectedAppNotFound()
          }
          if (result.status === "blocked") {
            return connectedAppBlocked(result.detail)
          }
          return {
            payload: adminConnectedAppFirecrawlLifecycleResultSchema.parse({
              app: await connectedAppAfterFirecrawlMutation(actor, id),
              detail: result.detail,
              status: result.status,
            }),
            statusCode: 200,
          }
        },
      )
    },
  )

  server.delete(
    "/api/admin/applications/connected-apps/:id",
    withCapability("applications.create_delete"),
    async (request, reply) => {
      const id = routeId(request)
      if (!id) {
        return missingId(reply, "Connected app")
      }
      const body = adminConnectedAppDeleteRequestSchema.safeParse(
        request.body ?? {},
      )
      if (!body.success) {
        return invalidRequest(
          reply,
          "Invalid connected app delete request",
          "Deleting an Application requires exact DELETE APPLICATION confirmation.",
        )
      }
      return withAdminIdempotentMutation(
        request,
        reply,
        "DELETE /api/admin/applications/connected-apps/:id",
        { body: body.data, id },
        async (actor, identityContext) => {
          const result = await deleteAdminConnectedApp(
            actor,
            id,
            identityContext,
          )
          if (result.status === "not_found") {
            return connectedAppNotFound()
          }
          if (result.status === "blocked") {
            return connectedAppBlocked(result.detail)
          }
          return {
            idempotencyResourceId: result.applicationId,
            payload: adminConnectedAppLifecycleResultSchema.parse(result),
            statusCode: 200,
          }
        },
      )
    },
  )

  server.get(
    "/api/admin/hardware",
    withCapability("console.operational.view"),
    async (request) =>
      adminHardwareResponseSchema.parse(
        await getAdminHardware(getHardwareQuery(request)),
      ),
  )

  server.get(
    "/api/admin/inference",
    withCapability("console.operational.view"),
    async (request) =>
      adminInferenceDashboardSchema.parse(
        await getAdminInference(
          requireActor(request),
          getInferenceQuery(request),
        ),
      ),
  )

  server.post(
    "/api/admin/inference/model-updates/apply",
    withCapability("updates.apply"),
    async (request, reply) => {
      const body = applyAdminInferenceModelUpdateRequestSchema.safeParse(
        request.body ?? {},
      )
      if (!body.success) {
        return invalidRequest(
          reply,
          "Invalid model update request",
          "Applying a model update requires exact UPDATE MODEL confirmation.",
        )
      }
      return withAdminIdempotentMutation(
        request,
        reply,
        "POST /api/admin/inference/model-updates/apply",
        body.data,
        async (actor) => {
          const payload = adminInferenceModelUpdateActionResponseSchema.parse(
            await applyAdminInferenceModelUpdate(actor, body.data),
          )
          return {
            payload,
            receiptOutcome:
              payload.status === "blocked"
                ? "denied"
                : payload.status === "failed"
                  ? "failed"
                  : "succeeded",
            statusCode: 200,
          }
        },
      )
    },
  )
}

function recoveryAuthentication(actor: Actor): {
  acr?: string
  amr: string[]
  authTime: number
  keycloakSubjectId: string
} {
  return {
    ...(actor.acr ? { acr: actor.acr } : {}),
    amr: actor.amr ?? [],
    authTime: actor.authTime ?? 0,
    keycloakSubjectId: actor.subject,
  }
}

function recoveryLiveIdentity(actor: Actor): {
  enabled: true
  keycloakSubjectId: string
  role: Actor["role"]
} {
  return {
    enabled: true,
    keycloakSubjectId: actor.subject,
    role: actor.role,
  }
}

function recoveryActivationBody(
  value: unknown,
): { factor: string; reasonCode: EmergencyRecoveryReasonCode } | null {
  if (!isRecord(value)) {
    return null
  }
  const keys = Object.keys(value).sort()
  if (keys.length !== 2 || keys[0] !== "factor" || keys[1] !== "reasonCode") {
    return null
  }
  const reasonCode = emergencyRecoveryReasonCodeSchema.safeParse(
    value.reasonCode,
  )
  return typeof value.factor === "string" &&
    /^llmr1_[A-Za-z0-9_-]{43}$/.test(value.factor) &&
    reasonCode.success
    ? { factor: value.factor, reasonCode: reasonCode.data }
    : null
}

function isStrictEmptyBody(value: unknown): boolean {
  return (
    value === undefined || (isRecord(value) && Object.keys(value).length === 0)
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function recoveryCommissionResult(
  reply: FastifyReply,
  result: EmergencyRecoveryCommissionResult,
) {
  if (result.status === "commissioned") {
    return reply.code(201).send(result)
  }
  if (result.status === "already_commissioned") {
    return reply.code(409).send({
      type: "about:blank",
      title: "Emergency recovery factor already commissioned",
      status: 409,
    })
  }
  if (result.status === "denied") {
    return recoveryDenied(
      reply,
      "Emergency recovery factor commissioning was denied.",
      result.reason,
    )
  }
  return recoveryUnavailable(reply)
}

function recoveryActivationResult(
  reply: FastifyReply,
  result: EmergencyRecoveryActivationResult,
) {
  if (result.status === "activated") {
    return reply.code(201).send(result)
  }
  if (result.status === "denied") {
    return recoveryDenied(
      reply,
      "Emergency recovery activation was denied.",
      result.reason,
    )
  }
  if (result.status === "not_commissioned") {
    return reply.code(409).send({
      type: "about:blank",
      title: "Emergency recovery factor is not commissioned",
      status: 409,
    })
  }
  if (result.status === "active_session_exists") {
    return reply.code(409).send({
      type: "about:blank",
      title: "Emergency recovery session already active",
      status: 409,
    })
  }
  if (result.status === "rate_limited") {
    return reply
      .header("retry-after", String(result.retryAfterSeconds))
      .code(429)
      .send({
        type: "about:blank",
        title: "Emergency recovery activation rate limited",
        status: 429,
        detail: "Retry the activation request after the indicated interval.",
      })
  }
  return recoveryUnavailable(reply)
}

function recoveryDenied(
  reply: FastifyReply,
  detail: string,
  reasonCode?: string,
) {
  return reply.code(403).send({
    type: "about:blank",
    title: "Emergency recovery denied",
    status: 403,
    detail,
    ...(reasonCode ? { reasonCode } : {}),
  })
}

function recoveryUnavailable(reply: FastifyReply) {
  return reply.code(503).send({
    type: "about:blank",
    title: "Emergency recovery unavailable",
    status: 503,
    detail: "Durable emergency recovery state is unavailable.",
  })
}

function getAuditQuery(request: FastifyRequest): {
  applicationId?: string
  cursor?: string
  eventId?: string
  limit?: number
  outcome?: string
  query?: string
  severity?: string
  sourceSystem?: string
} {
  const query = objectQuery(request)
  return {
    applicationId: stringQuery(query, "applicationId"),
    cursor: stringQuery(query, "cursor"),
    eventId: stringQuery(query, "eventId") ?? stringQuery(query, "event"),
    limit: stringQuery(query, "limit")
      ? Number.parseInt(stringQuery(query, "limit") ?? "", 10)
      : undefined,
    outcome: stringQuery(query, "outcome"),
    query: stringQuery(query, "q"),
    severity: stringQuery(query, "severity"),
    sourceSystem: stringQuery(query, "source"),
  }
}

function getAuditExportWindow(request: FastifyRequest): {
  from: Date
  limit?: number
  to: Date
} | null {
  const query = objectQuery(request)
  const from = canonicalUtcTimestamp(stringQuery(query, "from"))
  const to = canonicalUtcTimestamp(stringQuery(query, "to"))
  const rawLimit = stringQuery(query, "limit")
  const limit = rawLimit ? Number(rawLimit) : undefined
  if (!from || !to || (limit !== undefined && !Number.isSafeInteger(limit))) {
    return null
  }
  return { from, limit, to }
}

function canonicalUtcTimestamp(value: string | undefined): Date | null {
  if (!value) {
    return null
  }
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value
    ? parsed
    : null
}

function auditExportUnavailable(reply: FastifyReply) {
  return reply.code(503).send({
    type: "about:blank",
    title: "Audit export signing unavailable",
    status: 503,
    detail:
      "Mounted Ed25519 signing material and its public verification key set are unavailable or inconsistent.",
  })
}

function alertEgressUnavailable(reply: FastifyReply) {
  return reply.code(503).send({
    type: "about:blank",
    title: "Alert egress state unavailable",
    status: 503,
    detail:
      "The redacted alert-delivery intent cannot be read. Outbound delivery remains disabled.",
  })
}

function getHardwareQuery(request: FastifyRequest): {
  host?: string
  range?: string
  step?: string
} {
  const query = objectQuery(request)
  return {
    host: stringQuery(query, "host"),
    range: stringQuery(query, "range"),
    step: stringQuery(query, "step"),
  }
}

function getInferenceQuery(request: FastifyRequest): { range?: string } {
  return { range: stringQuery(objectQuery(request), "range") }
}

function objectQuery(request: FastifyRequest): Record<string, unknown> {
  return typeof request.query === "object" && request.query !== null
    ? (request.query as Record<string, unknown>)
    : {}
}

function stringQuery(
  query: Record<string, unknown>,
  name: string,
): string | undefined {
  return typeof query[name] === "string" ? query[name] : undefined
}

function requireActor(request: FastifyRequest): Actor {
  if (!request.actor) {
    throw new Error("Authenticated route executed without an actor.")
  }
  return request.actor
}

function reviewedAdminOnly(_route: AdminOnlyAdminRoutePolicyKey) {
  return withAdminOnly()
}

function routeId(request: FastifyRequest): string | undefined {
  return (request.params as { id?: string }).id
}

function routeCredentialId(request: FastifyRequest): string | undefined {
  return (request.params as { credentialId?: string }).credentialId
}

function settingsMutationResponse(
  result:
    | { settings: unknown; status: "ok" }
    | { detail: string; status: "invalid" },
  title: string,
): { statusCode: number; payload: unknown } {
  return result.status === "ok"
    ? {
        statusCode: 200,
        payload: adminSettingsResponseSchema.parse(result.settings),
      }
    : {
        statusCode: 400,
        payload: {
          type: "about:blank",
          title,
          status: 400,
          detail: result.detail,
        },
      }
}

async function teamMemberAction(
  request: FastifyRequest,
  reply: FastifyReply,
  action: string,
  run: (
    actor: Actor,
    id: string,
    context: AdminTeamMutationContext,
  ) => Promise<unknown>,
  body: unknown = {},
) {
  const id = routeId(request)
  if (!id) {
    return missingId(reply, "Team member")
  }
  return withAdminIdempotentMutation(
    request,
    reply,
    `POST /api/admin/team/members/:id/${action}`,
    { body, id },
    async (actor, identityContext) => ({
      payload: adminTeamActionResponseSchema.parse(
        await run(actor, id, identityContext),
      ),
      statusCode: 200,
    }),
    200,
  )
}

async function teamRouteResult(
  reply: FastifyReply,
  run: () => Promise<unknown>,
) {
  try {
    return reply.send(await run())
  } catch (error) {
    return teamError(reply, error)
  }
}

function teamError(reply: FastifyReply, error: unknown) {
  const result = teamErrorResult(error)
  if (!result) {
    throw error
  }
  return reply.code(result.statusCode).send(result.payload)
}

function teamErrorResult(
  error: unknown,
): { payload: unknown; statusCode: number } | null {
  if (error instanceof AdminTeamError) {
    return {
      payload: {
        type: "about:blank",
        title: "Team request failed",
        status: error.httpStatus,
        detail: error.message,
      },
      statusCode: error.httpStatus,
    }
  }
  if (isTeamServiceStatusError(error)) {
    const status = teamServiceHttpStatus(error.status)
    return {
      payload: {
        type: "about:blank",
        title: "Team request failed",
        status,
        detail: "Keycloak Admin API request failed.",
      },
      statusCode: status,
    }
  }
  return null
}

function isTeamServiceStatusError(error: unknown): error is { status: string } {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof (error as { status?: unknown }).status === "string"
  )
}

function teamServiceHttpStatus(status: string): number {
  if (status === "unauthorized") {
    return 502
  }
  if (status === "not_configured" || status === "unavailable") {
    return 503
  }
  return 400
}

async function connectedAppActionResult(
  request: FastifyRequest,
  reply: FastifyReply,
  route: string,
  run: (
    actor: Actor,
    id: string,
    identityContext: AdminTeamMutationContext,
  ) => Promise<{
    idempotencyResourceId?: string
    payload: unknown
    statusCode: number
  }>,
) {
  const id = routeId(request)
  return id
    ? withAdminIdempotentMutation(
        request,
        reply,
        route,
        { id },
        async (actor, identityContext) => run(actor, id, identityContext),
      )
    : missingId(reply, "Connected app")
}

function connectedAppNotFound(): {
  payload: unknown
  statusCode: number
} {
  return { payload: notFoundPayload("Connected app"), statusCode: 404 }
}

function connectedAppBlocked(detail: string): {
  payload: unknown
  statusCode: number
} {
  return {
    payload: {
      type: "about:blank",
      title: "Connected app action blocked",
      status: 409,
      detail,
    },
    statusCode: 409,
  }
}

async function connectedAppAfterFirecrawlMutation(actor: Actor, id: string) {
  const detail = await getAdminConnectedAppDetail(actor, id)
  if (!detail) {
    throw new Error("Updated Application could not be read back.")
  }
  return detail.app
}

function serviceUnavailable(
  title: string,
  detail: string,
): { payload: unknown; statusCode: number } {
  return {
    payload: { type: "about:blank", title, status: 503, detail },
    statusCode: 503,
  }
}

function notFoundPayload(subject: string): Record<string, unknown> {
  return {
    type: "about:blank",
    title: `${subject} not found`,
    status: 404,
  }
}

function invalidRequest(reply: FastifyReply, title: string, detail?: string) {
  return reply.code(400).send({
    type: "about:blank",
    title,
    status: 400,
    ...(detail ? { detail } : {}),
  })
}

function missingId(reply: FastifyReply, subject: string) {
  return invalidRequest(reply, `${subject} id is required`)
}

async function withAdminIdempotentMutation(
  request: FastifyRequest,
  reply: FastifyReply,
  route: string,
  requestPayload: unknown,
  run: (
    actor: Actor,
    identityContext: AdminTeamMutationContext,
  ) => Promise<{
    idempotencyResourceId?: string
    payload: unknown
    receiptOutcome?: IdempotencyReceipt["outcome"]
    statusCode: number
  }>,
  identityMutationSuccessStatusCode = 200,
) {
  const actor = requireActor(request)
  const idempotencyKey = getHeaderValue(request, "idempotency-key")
  if (!idempotencyKey) {
    return invalidRequest(
      reply,
      "Idempotency key is required",
      `Pass an Idempotency-Key header for ${route}.`,
    )
  }

  const requestHash = hashJson(requestPayload)
  const reservation = await reserveIdempotency({
    actorId: actor.subject,
    correlationId: request.id,
    route,
    idempotencyKey,
    requestHash,
  })
  if (reservation.status === "replay") {
    return reply.code(reservation.receipt.statusCode).send({
      correlationId: reservation.receipt.correlationId,
      outcome: reservation.receipt.outcome,
      resourceId: reservation.receipt.resourceId,
      status: "already_completed",
    })
  }
  if (reservation.status === "conflict") {
    return reply.code(409).send({
      type: "about:blank",
      title: "Idempotency key conflict",
      status: 409,
      detail:
        "This Idempotency-Key was already used with a different admin mutation request.",
    })
  }
  if (reservation.status === "pending") {
    return reply.code(409).send({
      type: "about:blank",
      title: "Admin mutation is still in progress",
      status: 409,
      detail:
        "This Idempotency-Key is already processing. Retry after the first request finishes.",
    })
  }
  if (reservation.status === "reconciliation_required") {
    return reply.code(409).send({
      type: "about:blank",
      title: "Admin mutation requires reconciliation",
      status: 409,
      detail:
        "The previous mutation did not record a durable outcome before its lease expired. Reconcile the target resource before using a new Idempotency-Key.",
    })
  }
  if (reservation.status === "unavailable") {
    return reply.code(503).send({
      type: "about:blank",
      title: "Idempotency backend unavailable",
      status: 503,
      detail:
        "The admin mutation could not reserve durable idempotency state. Retry later.",
    })
  }

  let identityReceiptFinalized = false
  const identityContext: AdminTeamMutationContext = {
    commitWithReceipt: async ({ resourceId, run }) => {
      const db = getInferenceCoreDb()
      const commit = async (transaction: Parameters<typeof run>[0]) => {
        const value = await run(transaction)
        const completed = await completeIdempotency(
          {
            outcome: "succeeded",
            resourceId,
            storeKey: reservation.storeKey,
            requestHash,
            statusCode: identityMutationSuccessStatusCode,
          },
          transaction,
        )
        if (!completed) {
          throw new IdempotencyCompletionError()
        }
        return value
      }
      const value = db
        ? await db.transaction((transaction) => commit(transaction))
        : // Fixture mode has no durable store and is excluded from receipt-failure
          // rollback qualification. PostgreSQL is the production atomic boundary.
          await commit(null)
      identityReceiptFinalized = true
      return value
    },
    finalizeReceipt: async ({ resourceId }) => {
      const completed = await completeIdempotency({
        outcome: "succeeded",
        resourceId: resourceId ?? undefined,
        storeKey: reservation.storeKey,
        requestHash,
        statusCode: identityMutationSuccessStatusCode,
      })
      if (!completed) {
        throw new Error("Durable idempotency receipt finalization failed.")
      }
      identityReceiptFinalized = true
    },
    idempotencyLedgerId: reservation.storeKey,
    operationCode: route,
    requestFingerprint: requestHash,
  }

  let result: {
    idempotencyResourceId?: string
    payload: unknown
    receiptOutcome?: IdempotencyReceipt["outcome"]
    statusCode: number
  }
  try {
    result = await run(actor, identityContext)
  } catch (error) {
    const mutationError = adminMutationErrorResult(error)
    if (mutationError) {
      if (
        !identityReceiptFinalized &&
        shouldCompleteFailedAdminMutationReceipt(error)
      ) {
        const completed = await completeIdempotency({
          outcome: "failed",
          storeKey: reservation.storeKey,
          requestHash,
          statusCode: mutationError.statusCode,
        })
        if (!completed) {
          return idempotencyCompletionUnavailable(reply)
        }
      }
      return reply.code(mutationError.statusCode).send(mutationError.payload)
    }
    if (error instanceof IdempotencyCompletionError) {
      return idempotencyCompletionUnavailable(reply)
    }
    const errorResult = teamErrorResult(error)
    if (!errorResult) {
      throw error
    }
    const completed = await completeIdempotency({
      outcome: "failed",
      storeKey: reservation.storeKey,
      requestHash,
      statusCode: errorResult.statusCode,
    })
    if (!completed) {
      return idempotencyCompletionUnavailable(reply)
    }
    return reply.code(errorResult.statusCode).send(errorResult.payload)
  }
  if (identityReceiptFinalized) {
    return reply.code(result.statusCode).send(result.payload)
  }
  const completed = await completeIdempotency({
    outcome:
      result.receiptOutcome ??
      (result.statusCode >= 200 && result.statusCode < 400
        ? "succeeded"
        : result.statusCode === 401 || result.statusCode === 403
          ? "denied"
          : "failed"),
    resourceId: result.idempotencyResourceId,
    storeKey: reservation.storeKey,
    requestHash,
    statusCode: result.statusCode,
  })
  if (!completed) {
    return idempotencyCompletionUnavailable(reply)
  }
  return reply.code(result.statusCode).send(result.payload)
}

function adminMutationErrorResult(error: unknown): {
  payload: unknown
  statusCode: 404 | 409 | 503
} | null {
  if (error instanceof AdminAlertEgressConflictError) {
    return {
      payload: {
        type: "about:blank",
        title: "Alert egress state changed",
        status: 409,
        detail:
          "Refresh the redacted alert-egress state before retrying this mutation.",
      },
      statusCode: 409,
    }
  }
  if (error instanceof AdminAlertEgressUnavailableError) {
    return {
      payload: {
        type: "about:blank",
        title: "Alert egress state unavailable",
        status: 503,
        detail:
          "Outbound delivery remains disabled because its intent state is unavailable.",
      },
      statusCode: 503,
    }
  }
  if (error instanceof AdminConnectedAppFirecrawlCredentialCommitRaceError) {
    return error.failure.status === "not_found"
      ? { payload: notFoundPayload("Connected app"), statusCode: 404 }
      : {
          payload: connectedAppBlocked(error.failure.detail).payload,
          statusCode: 409,
        }
  }
  if (error instanceof IdentityMutationReconciliationRequiredError) {
    return {
      payload: {
        type: "about:blank",
        title: "Identity mutation requires reconciliation",
        status: 409,
        detail:
          "The identity mutation has an ambiguous durable outcome. Reconcile the target before retrying.",
      },
      statusCode: 409,
    }
  }
  if (!(error instanceof IdentityMutationExecutionError)) {
    return null
  }
  const statusCode = error.status === "unavailable" ? 503 : 409
  return {
    payload: {
      type: "about:blank",
      title:
        statusCode === 503
          ? "Identity mutation unavailable"
          : "Identity mutation blocked",
      status: statusCode,
      detail:
        statusCode === 503
          ? "Durable identity mutation state is unavailable."
          : "The identity mutation is blocked by its durable state. Reconcile before retrying.",
    },
    statusCode,
  }
}

function shouldCompleteFailedAdminMutationReceipt(error: unknown): boolean {
  return (
    error instanceof AdminAlertEgressConflictError ||
    error instanceof AdminAlertEgressUnavailableError ||
    error instanceof AdminConnectedAppFirecrawlCredentialCommitRaceError ||
    (error instanceof IdentityMutationExecutionError &&
      error.status !== "reconciliation_required")
  )
}

function idempotencyCompletionUnavailable(reply: FastifyReply) {
  return reply.code(503).send({
    type: "about:blank",
    title: "Idempotency completion unavailable",
    status: 503,
    detail:
      "The mutation did not produce a durable idempotency receipt. Reconcile the resource or pending request before retrying.",
  })
}

function getHeaderValue(
  request: FastifyRequest,
  name: string,
): string | undefined {
  const value = request.headers[name.toLowerCase()]
  return Array.isArray(value) ? value[0] : value
}

function hashJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}
