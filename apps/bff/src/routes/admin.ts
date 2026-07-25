import { createHash } from "node:crypto"
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import {
  adminApprovalQueueResponseSchema,
  adminAuditResponseSchema,
  adminBuilderAgentStudioQuotaPolicySchema,
  adminConnectorRegistryItemSchema,
  adminConnectorRegistryResponseSchema,
  adminConnectorVettingDecisionRequestSchema,
  adminConnectedAppCreateRequestSchema,
  adminConnectedAppCreateResponseSchema,
  adminConnectedAppDetailSchema,
  adminConnectedAppPromotionResultSchema,
  adminConnectedAppRotateCredentialResultSchema,
  adminConnectedAppsResponseSchema,
  adminConnectedAppTestResultSchema,
  adminConnectedAppUpdateRequestSchema,
  adminConnectedAppSchema,
  adminHardwareResponseSchema,
  adminInferenceDashboardSchema,
  adminInferenceModelUpdateActionResponseSchema,
  adminInternalDocsMcpPostureSchema,
  adminLibreChatAgentPostureSchema,
  adminMcpServerDetailSchema,
  adminMcpServerConnectionTestRequestSchema,
  adminMcpServerConnectionTestResponseSchema,
  adminOverviewResponseSchema,
  adminPolicyViolationRemediationRequestSchema,
  adminPolicyViolationSchema,
  adminPolicyViolationsResponseSchema,
  adminPureModeResponseSchema,
  adminSettingsResponseSchema,
  adminTeamBulkGroupAssignmentRequestSchema,
  adminTeamActionResponseSchema,
  adminTeamBreakGlassSchema,
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
  deleteAdminTeamMemberRequestSchema,
  adminPureModeTransitionRequestSchema,
  createAdminMcpServerRequestSchema,
  createAdminTeamGroupRequestSchema,
  createAdminTeamMemberRequestSchema,
  createAdminUrlPolicyRuleRequestSchema,
  updateAdminMcpServerRequestSchema,
  updateAdminBuilderAgentStudioQuotaPolicyRequestSchema,
  updateAdminTeamBreakGlassRequestSchema,
  updateAdminTeamGroupRequestSchema,
  updateAdminSettingsOrganizationRequestSchema,
  updateAdminSettingsTelemetryRequestSchema,
  updateAdminUrlPolicyRuleRequestSchema,
  applyAdminInferenceModelUpdateRequestSchema,
} from "@llm-machines/contracts"
import type { Actor } from "../auth/persona"
import { withPersona } from "../auth/persona"
import { getAdminApprovalQueue } from "../services/admin-approvals"
import { getAdminAuditTimeline } from "../services/admin-audit"
import {
  createAdminMcpServer,
  decideAdminConnectorVetting,
  getAdminConnectorRegistry,
  getAdminMcpServerDetail,
  testAdminMcpServerConnection,
  updateAdminMcpServer,
} from "../services/admin-connector-registry"
import {
  createAdminConnectedApp,
  disableAdminConnectedApp,
  getAdminConnectedAppDetail,
  getAdminConnectedApps,
  promoteAdminConnectedAppToProduction,
  rotateAdminConnectedAppCredentials,
  testAdminConnectedApp,
  updateAdminConnectedApp,
} from "../services/admin-connected-apps"
import { transitionAdminPureMode } from "../services/admin/pure-mode"
import {
  getAdminPolicyViolations,
  getAdminPureMode,
  remediateAdminPolicyViolation,
} from "../services/admin-governance-detail"
import { getAdminHardware } from "../services/admin-hardware"
import {
  applyAdminInferenceModelUpdate,
  getAdminInference,
} from "../services/admin-inference"
import { getAdminOverview } from "../services/admin-overview"
import {
  createAdminUrlPolicyRule,
  deleteAdminUrlPolicyRule,
  disableAdminUrlPolicyRule,
  getAdminSettings,
  updateAdminSettingsOrganization,
  updateAdminSettingsTelemetry,
  updateAdminUrlPolicyRule,
} from "../services/admin-settings"
import {
  AdminTeamError,
  TEAM_CSV_TEMPLATE,
  bulkAssignAdminTeamGroupMembers,
  commitAdminTeamCsvImport,
  createAdminTeamGroup,
  deleteAdminTeamGroup,
  createAdminTeamMember,
  deleteAdminTeamMember,
  disableAdminTeamMember,
  generateAdminTeamPassword,
  getAdminTeamGroupDetail,
  getAdminTeamBreakGlass,
  getAdminTeamMemberDetail,
  getAdminTeamOverview,
  getAdminTeamScimStatus,
  previewAdminTeamCsvImport,
  reactivateAdminTeamMember,
  removeAdminTeamGroupMember,
  sendAdminTeamInvite,
  sendAdminTeamPasswordReset,
  updateAdminTeamBreakGlass,
  updateAdminTeamGroup,
} from "../services/admin-team"
import {
  getBuilderAgentStudioQuotaPolicy,
  updateBuilderAgentStudioQuotaPolicy,
} from "../services/builder"
import {
  completeIdempotency,
  reserveIdempotency,
} from "../services/idempotency"
import { getLibreChatAgentPosture } from "../services/librechat-native-agents"
import { getInternalDocsMcpPosture } from "../services/internal-docs-mcp-posture"

export function registerAdminRoutes(server: FastifyInstance): void {
  server.get("/api/admin/audit", withPersona("admin"), async (request) =>
    adminAuditResponseSchema.parse(
      await getAdminAuditTimeline(
        requireActor(request),
        getAuditQuery(request),
      ),
    ),
  )

  server.get("/api/admin/overview", withPersona("admin"), async (request) =>
    adminOverviewResponseSchema.parse(
      await getAdminOverview(requireActor(request)),
    ),
  )

  server.get("/api/admin/settings", withPersona("admin"), async (request) =>
    adminSettingsResponseSchema.parse(await getAdminSettings(requireActor(request))),
  )

  server.get("/api/admin/team", withPersona("admin"), async (request) =>
    adminTeamOverviewResponseSchema.parse(
      await getAdminTeamOverview(requireActor(request)),
    ),
  )

  server.get("/api/admin/team/scim", withPersona("admin"), async (request) =>
    adminTeamScimStatusSchema.parse(
      await getAdminTeamScimStatus(requireActor(request)),
    ),
  )

  server.get(
    "/api/admin/team/break-glass",
    withPersona("admin"),
    async (request, reply) =>
      teamRouteResult(reply, async () =>
        adminTeamBreakGlassSchema.parse(
          await getAdminTeamBreakGlass(requireActor(request)),
        ),
      ),
  )

  server.post(
    "/api/admin/team/break-glass",
    withPersona("admin"),
    async (request, reply) => {
      const parsedBody = updateAdminTeamBreakGlassRequestSchema.safeParse(
        request.body ?? {},
      )
      if (!parsedBody.success) {
        return reply.code(400).send({
          type: "about:blank",
          title: "Invalid break-glass Admin request",
          status: 400,
          detail: "Select an enabled Admin user.",
        })
      }
      return withAdminIdempotentMutation(
        request,
        reply,
        "POST /api/admin/team/break-glass",
        parsedBody.data,
        async (actor) => ({
          payload: adminTeamBreakGlassSchema.parse(
            await updateAdminTeamBreakGlass(actor, parsedBody.data),
          ),
          statusCode: 200,
        }),
      )
    },
  )

  server.get(
    "/api/admin/team/csv-template",
    withPersona("admin"),
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
    withPersona("admin"),
    async (request, reply) => {
      const parsedBody = adminTeamCsvImportPreviewRequestSchema.safeParse(
        request.body ?? {},
      )
      if (!parsedBody.success) {
        return reply.code(400).send({
          type: "about:blank",
          title: "Invalid Team CSV import preview request",
          status: 400,
          detail: "CSV text is required.",
        })
      }
      return teamRouteResult(reply, async () =>
        adminTeamCsvImportPreviewResponseSchema.parse(
          await previewAdminTeamCsvImport(requireActor(request), parsedBody.data),
        ),
      )
    },
  )

  server.post(
    "/api/admin/team/import/commit",
    withPersona("admin"),
    async (request, reply) => {
      const parsedBody = adminTeamCsvImportCommitRequestSchema.safeParse(
        request.body ?? {},
      )
      if (!parsedBody.success) {
        return reply.code(400).send({
          type: "about:blank",
          title: "Invalid Team CSV import commit request",
          status: 400,
          detail: "CSV text is required.",
        })
      }
      return withAdminIdempotentMutation(
        request,
        reply,
        "POST /api/admin/team/import/commit",
        parsedBody.data,
        async (actor) => ({
          payload: adminTeamCsvImportCommitResponseSchema.parse(
            await commitAdminTeamCsvImport(actor, parsedBody.data),
          ),
          statusCode: 200,
        }),
      )
    },
  )

  server.get(
    "/api/admin/team/groups/:id",
    withPersona("admin"),
    async (request, reply) => {
      const id = (request.params as { id?: string }).id
      if (!id) {
        return reply.code(400).send({
          type: "about:blank",
          title: "Team group id is required",
          status: 400,
        })
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
    withPersona("admin"),
    async (request, reply) => {
      const parsedBody = createAdminTeamGroupRequestSchema.safeParse(
        request.body ?? {},
      )
      if (!parsedBody.success) {
        return reply.code(400).send({
          type: "about:blank",
          title: "Invalid Team group request",
          status: 400,
          detail: "A group name is required.",
        })
      }
      return withAdminIdempotentMutation(
        request,
        reply,
        "POST /api/admin/team/groups",
        parsedBody.data,
        async (actor) => ({
          payload: adminTeamGroupMutationResponseSchema.parse(
            await createAdminTeamGroup(actor, parsedBody.data),
          ),
          statusCode: 201,
        }),
      )
    },
  )

  server.post(
    "/api/admin/team/groups/:id/update",
    withPersona("admin"),
    async (request, reply) => {
      const id = (request.params as { id?: string }).id
      const parsedBody = updateAdminTeamGroupRequestSchema.safeParse(
        request.body ?? {},
      )
      if (!id) {
        return reply.code(400).send({
          type: "about:blank",
          title: "Team group id is required",
          status: 400,
        })
      }
      if (!parsedBody.success) {
        return reply.code(400).send({
          type: "about:blank",
          title: "Invalid Team group request",
          status: 400,
          detail: "A group name is required.",
        })
      }
      return withAdminIdempotentMutation(
        request,
        reply,
        "POST /api/admin/team/groups/:id/update",
        { id, ...parsedBody.data },
        async (actor) => ({
          payload: adminTeamGroupMutationResponseSchema.parse(
            await updateAdminTeamGroup(actor, id, parsedBody.data),
          ),
          statusCode: 200,
        }),
      )
    },
  )

  server.post(
    "/api/admin/team/groups/:id/delete",
    withPersona("admin"),
    async (request, reply) => {
      const id = (request.params as { id?: string }).id
      if (!id) {
        return reply.code(400).send({
          type: "about:blank",
          title: "Team group id is required",
          status: 400,
        })
      }
      return withAdminIdempotentMutation(
        request,
        reply,
        "POST /api/admin/team/groups/:id/delete",
        { id },
        async (actor) => ({
          payload: adminTeamGroupMutationResponseSchema.parse(
            await deleteAdminTeamGroup(actor, id),
          ),
          statusCode: 200,
        }),
      )
    },
  )

  server.post(
    "/api/admin/team/groups/:id/members/bulk-assign",
    withPersona("admin"),
    async (request, reply) => {
      const id = (request.params as { id?: string }).id
      const parsedBody = adminTeamBulkGroupAssignmentRequestSchema.safeParse(
        request.body ?? {},
      )
      if (!id) {
        return reply.code(400).send({
          type: "about:blank",
          title: "Team group id is required",
          status: 400,
        })
      }
      if (!parsedBody.success) {
        return reply.code(400).send({
          type: "about:blank",
          title: "Invalid Team group assignment request",
          status: 400,
          detail: "At least one member id is required.",
        })
      }
      return withAdminIdempotentMutation(
        request,
        reply,
        "POST /api/admin/team/groups/:id/members/bulk-assign",
        { id, ...parsedBody.data },
        async (actor) => ({
          payload: adminTeamGroupMutationResponseSchema.parse(
            await bulkAssignAdminTeamGroupMembers(actor, id, parsedBody.data),
          ),
          statusCode: 200,
        }),
      )
    },
  )

  server.post(
    "/api/admin/team/groups/:id/members/:memberId/remove",
    withPersona("admin"),
    async (request, reply) => {
      const { id, memberId } = request.params as {
        id?: string
        memberId?: string
      }
      if (!id || !memberId) {
        return reply.code(400).send({
          type: "about:blank",
          title: "Team group and member ids are required",
          status: 400,
        })
      }
      return withAdminIdempotentMutation(
        request,
        reply,
        "POST /api/admin/team/groups/:id/members/:memberId/remove",
        { id, memberId },
        async (actor) => ({
          payload: adminTeamGroupMutationResponseSchema.parse(
            await removeAdminTeamGroupMember(actor, id, memberId),
          ),
          statusCode: 200,
        }),
      )
    },
  )

  server.get(
    "/api/admin/team/members/:id",
    withPersona("admin"),
    async (request, reply) => {
      const id = (request.params as { id?: string }).id
      if (!id) {
        return reply.code(400).send({
          type: "about:blank",
          title: "Team member id is required",
          status: 400,
        })
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
    withPersona("admin"),
    async (request, reply) => {
      const parsedBody = createAdminTeamMemberRequestSchema.safeParse(
        request.body ?? {},
      )
      if (!parsedBody.success) {
        return reply.code(400).send({
          type: "about:blank",
          title: "Invalid Team member request",
          status: 400,
          detail:
            "A name, corporate email, role, and valid group list are required.",
        })
      }
      return withAdminIdempotentMutation(
        request,
        reply,
        "POST /api/admin/team/members",
        parsedBody.data,
        async (actor) => {
          const payload = adminTeamMemberMutationResponseSchema.parse(
            await createAdminTeamMember(actor, parsedBody.data),
          )
          return {
            idempotencyPayload: { ...payload, generatedPassword: null },
            payload,
            statusCode: 201,
          }
        },
      )
    },
  )

  server.post(
    "/api/admin/team/members/:id/invite",
    withPersona("admin"),
    async (request, reply) =>
      teamMemberAction(request, reply, "invite", sendAdminTeamInvite),
  )

  server.post(
    "/api/admin/team/members/:id/reset-password-email",
    withPersona("admin"),
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
    withPersona("admin"),
    async (request, reply) => {
      const id = (request.params as { id?: string }).id
      if (!id) {
        return reply.code(400).send({
          type: "about:blank",
          title: "Team member id is required",
          status: 400,
        })
      }
      return withAdminIdempotentMutation(
        request,
        reply,
        "POST /api/admin/team/members/:id/generate-password",
        { id },
        async (actor) => {
          const payload = adminTeamMemberMutationResponseSchema.parse(
            await generateAdminTeamPassword(actor, id),
          )
          return {
            idempotencyPayload: { ...payload, generatedPassword: null },
            payload,
            statusCode: 200,
          }
        },
      )
    },
  )

  server.post(
    "/api/admin/team/members/:id/disable",
    withPersona("admin"),
    async (request, reply) =>
      teamMemberAction(request, reply, "disable", disableAdminTeamMember),
  )

  server.post(
    "/api/admin/team/members/:id/reactivate",
    withPersona("admin"),
    async (request, reply) =>
      teamMemberAction(request, reply, "reactivate", reactivateAdminTeamMember),
  )

  server.post(
    "/api/admin/team/members/:id/delete",
    withPersona("admin"),
    async (request, reply) => {
      const parsedBody = deleteAdminTeamMemberRequestSchema.safeParse(
        request.body ?? {},
      )
      if (!parsedBody.success) {
        return reply.code(400).send({
          type: "about:blank",
          title: "Invalid Team member delete request",
          status: 400,
          detail: "Deleting a Team member requires exact DELETE confirmation.",
        })
      }
      return teamMemberAction(
        request,
        reply,
        "delete",
        deleteAdminTeamMember,
        parsedBody.data,
      )
    },
  )

  server.post(
    "/api/admin/settings/organization",
    withPersona("admin"),
    async (request, reply) => {
      const parsedBody = updateAdminSettingsOrganizationRequestSchema.safeParse(
        request.body ?? {},
      )
      if (!parsedBody.success) {
        return reply.code(400).send({
          type: "about:blank",
          title: "Invalid organization settings request",
          status: 400,
          detail:
            "Organization name, default language, and valid PNG/JPEG logo metadata are required.",
        })
      }

      return withAdminIdempotentMutation(
        request,
        reply,
        "POST /api/admin/settings/organization",
        parsedBody.data,
        async (actor) => {
          const result = await updateAdminSettingsOrganization(
            actor,
            parsedBody.data,
          )
          return settingsMutationResponse(
            result,
            "Organization settings rejected",
          )
        },
      )
    },
  )

  server.post(
    "/api/admin/settings/url-policy/rules",
    withPersona("admin"),
    async (request, reply) => {
      const parsedBody = createAdminUrlPolicyRuleRequestSchema.safeParse(
        request.body ?? {},
      )
      if (!parsedBody.success) {
        return reply.code(400).send({
          type: "about:blank",
          title: "Invalid URL policy rule request",
          status: 400,
          detail:
            "A trusted or forbidden HTTP(S) URL/domain rule and reason are required.",
        })
      }

      return withAdminIdempotentMutation(
        request,
        reply,
        "POST /api/admin/settings/url-policy/rules",
        parsedBody.data,
        async (actor) => {
          const result = await createAdminUrlPolicyRule(actor, parsedBody.data)
          return settingsMutationResponse(result, "URL policy rule rejected")
        },
      )
    },
  )

  server.post(
    "/api/admin/settings/url-policy/rules/:id/update",
    withPersona("admin"),
    async (request, reply) => {
      const id = (request.params as { id?: string }).id
      if (!id || !isUuid(id)) {
        return reply.code(400).send({
          type: "about:blank",
          title: "URL policy rule id is required",
          status: 400,
        })
      }
      const parsedBody = updateAdminUrlPolicyRuleRequestSchema.safeParse(
        request.body ?? {},
      )
      if (!parsedBody.success) {
        return reply.code(400).send({
          type: "about:blank",
          title: "Invalid URL policy rule update",
          status: 400,
          detail:
            "A trusted or forbidden HTTP(S) URL/domain rule, status, and reason are required.",
        })
      }

      return withAdminIdempotentMutation(
        request,
        reply,
        "POST /api/admin/settings/url-policy/rules/:id/update",
        { id, body: parsedBody.data },
        async (actor) => {
          const result = await updateAdminUrlPolicyRule(
            actor,
            id,
            parsedBody.data,
          )
          return settingsMutationResponse(result, "URL policy rule rejected")
        },
      )
    },
  )

  server.post(
    "/api/admin/settings/url-policy/rules/:id/disable",
    withPersona("admin"),
    async (request, reply) => {
      const id = (request.params as { id?: string }).id
      if (!id || !isUuid(id)) {
        return reply.code(400).send({
          type: "about:blank",
          title: "URL policy rule id is required",
          status: 400,
        })
      }

      return withAdminIdempotentMutation(
        request,
        reply,
        "POST /api/admin/settings/url-policy/rules/:id/disable",
        { id },
        async (actor) => {
          const result = await disableAdminUrlPolicyRule(actor, id)
          return settingsMutationResponse(result, "URL policy rule rejected")
        },
      )
    },
  )

  server.post(
    "/api/admin/settings/url-policy/rules/:id/delete",
    withPersona("admin"),
    async (request, reply) => {
      const id = (request.params as { id?: string }).id
      if (!id || !isUuid(id)) {
        return reply.code(400).send({
          type: "about:blank",
          title: "URL policy rule id is required",
          status: 400,
        })
      }

      return withAdminIdempotentMutation(
        request,
        reply,
        "POST /api/admin/settings/url-policy/rules/:id/delete",
        { id },
        async (actor) => {
          const result = await deleteAdminUrlPolicyRule(actor, id)
          return settingsMutationResponse(result, "URL policy rule rejected")
        },
      )
    },
  )

  server.post(
    "/api/admin/settings/telemetry",
    withPersona("admin"),
    async (request, reply) => {
      const parsedBody = updateAdminSettingsTelemetryRequestSchema.safeParse(
        request.body ?? {},
      )
      if (!parsedBody.success) {
        return reply.code(400).send({
          type: "about:blank",
          title: "Invalid telemetry settings request",
          status: 400,
          detail:
            "Telemetry can only be enabled with exact ENABLE TELEMETRY confirmation.",
        })
      }

      return withAdminIdempotentMutation(
        request,
        reply,
        "POST /api/admin/settings/telemetry",
        parsedBody.data,
        async (actor) => {
          const result = await updateAdminSettingsTelemetry(
            actor,
            parsedBody.data,
          )
          return settingsMutationResponse(result, "Telemetry settings rejected")
        },
      )
    },
  )

  server.get("/api/admin/hardware", withPersona("admin"), async (request) =>
    adminHardwareResponseSchema.parse(
      await getAdminHardware(getHardwareQuery(request)),
    ),
  )

  server.get("/api/admin/inference", withPersona("admin"), async (request) =>
    adminInferenceDashboardSchema.parse(
      await getAdminInference(requireActor(request), getInferenceQuery(request)),
    ),
  )

  server.post(
    "/api/admin/inference/model-updates/apply",
    withPersona("admin"),
    async (request, reply) => {
      const parsedBody = applyAdminInferenceModelUpdateRequestSchema.safeParse(
        request.body ?? {},
      )
      if (!parsedBody.success) {
        return reply.code(400).send({
          type: "about:blank",
          title: "Invalid model update request",
          status: 400,
          detail: "Applying a model update requires exact UPDATE MODEL confirmation.",
        })
      }
      return withAdminIdempotentMutation(
        request,
        reply,
        "POST /api/admin/inference/model-updates/apply",
        parsedBody.data,
        async (actor) => ({
          payload: adminInferenceModelUpdateActionResponseSchema.parse(
            await applyAdminInferenceModelUpdate(actor, parsedBody.data),
          ),
          statusCode: 200,
        }),
      )
    },
  )

  server.get("/api/admin/approvals", withPersona("admin"), async (request) =>
    adminApprovalQueueResponseSchema.parse(
      await getAdminApprovalQueue(
        requireActor(request),
        getSearchQuery(request),
      ),
    ),
  )

  server.get(
    "/api/admin/agents/registry",
    withPersona("admin"),
    async (request) =>
      adminConnectorRegistryResponseSchema.parse(
        await getAdminConnectorRegistry(
          requireActor(request),
          getSearchQuery(request),
        ),
      ),
  )

  server.get(
    "/api/admin/connectors/registry",
    withPersona("admin"),
    async (request) =>
      adminConnectorRegistryResponseSchema.parse(
        await getAdminConnectorRegistry(
          requireActor(request),
          getSearchQuery(request),
        ),
      ),
  )

  server.get(
    "/api/admin/applications/connected-apps",
    withPersona("admin"),
    async (request) =>
      adminConnectedAppsResponseSchema.parse(
        await getAdminConnectedApps(requireActor(request)),
      ),
  )

  server.post(
    "/api/admin/applications/connected-apps",
    withPersona("admin"),
    async (request, reply) => {
      const parsedBody = adminConnectedAppCreateRequestSchema.safeParse(
        request.body ?? {},
      )
      if (!parsedBody.success) {
        return reply.code(400).send({
          type: "about:blank",
          title: "Invalid connected app request",
          status: 400,
          detail:
            "Name, description, owner group, allowed models, rate limit, and token budget are required.",
        })
      }

      return withAdminIdempotentMutation(
        request,
        reply,
        "POST /api/admin/applications/connected-apps",
        parsedBody.data,
        async (actor) => {
          const result = await createAdminConnectedApp(actor, parsedBody.data)
          if (result.status === "blocked") {
            return {
              statusCode: 503,
              payload: {
                type: "about:blank",
                title: "Connected app identity unavailable",
                status: 503,
                detail: result.detail,
              },
            }
          }
          return {
            idempotencyPayload: {
              app: result.app,
              status: result.status,
            },
            payload: adminConnectedAppCreateResponseSchema.parse(result),
            statusCode: 201,
          }
        },
      )
    },
  )

  server.get(
    "/api/admin/applications/connected-apps/:id",
    withPersona("admin"),
    async (request, reply) => {
      const id = (request.params as { id?: string }).id
      if (!id) {
        return reply.code(400).send({
          type: "about:blank",
          title: "Connected app id is required",
          status: 400,
        })
      }
      const detail = await getAdminConnectedAppDetail(requireActor(request), id)
      if (!detail) {
        return reply.code(404).send({
          type: "about:blank",
          title: "Connected app not found",
          status: 404,
        })
      }
      return reply.send(adminConnectedAppDetailSchema.parse(detail))
    },
  )

  server.patch(
    "/api/admin/applications/connected-apps/:id",
    withPersona("admin"),
    async (request, reply) => {
      const id = (request.params as { id?: string }).id
      const parsedBody = adminConnectedAppUpdateRequestSchema.safeParse(
        request.body ?? {},
      )
      if (!id) {
        return reply.code(400).send({
          type: "about:blank",
          title: "Connected app id is required",
          status: 400,
        })
      }
      if (!parsedBody.success) {
        return reply.code(400).send({
          type: "about:blank",
          title: "Invalid connected app update",
          status: 400,
          detail: "A valid connected app configuration is required.",
        })
      }
      return withAdminIdempotentMutation(
        request,
        reply,
        "PATCH /api/admin/applications/connected-apps/:id",
        { id, body: parsedBody.data },
        async (actor) => {
          const result = await updateAdminConnectedApp(actor, id, parsedBody.data)
          if (result.status === "not_found") {
            return {
              statusCode: 404,
              payload: {
                type: "about:blank",
                title: "Connected app not found",
                status: 404,
              },
            }
          }
          return {
            payload: adminConnectedAppSchema.parse(result.app),
            statusCode: 200,
          }
        },
      )
    },
  )

  server.post(
    "/api/admin/applications/connected-apps/:id/test",
    withPersona("admin"),
    async (request, reply) =>
      connectedAppActionResult(
        request,
        reply,
        "POST /api/admin/applications/connected-apps/:id/test",
        async (actor, id) => {
          const result = await testAdminConnectedApp(actor, id)
          if (result.status === "not_found") {
            return connectedAppNotFound()
          }
          return {
            payload: adminConnectedAppTestResultSchema.parse(result),
            statusCode: 200,
          }
        },
      ),
  )

  server.post(
    "/api/admin/applications/connected-apps/:id/promote-production",
    withPersona("admin"),
    async (request, reply) =>
      connectedAppActionResult(
        request,
        reply,
        "POST /api/admin/applications/connected-apps/:id/promote-production",
        async (actor, id) => {
          const result = await promoteAdminConnectedAppToProduction(actor, id)
          if (result.status === "not_found") {
            return connectedAppNotFound()
          }
          if (result.status === "blocked" && !("app" in result)) {
            return connectedAppBlocked(result.detail)
          }
          return {
            idempotencyPayload:
              result.status === "promoted"
                ? { app: result.app, detail: result.detail, status: result.status }
                : undefined,
            payload: adminConnectedAppPromotionResultSchema.parse(result),
            statusCode: result.status === "blocked" ? 409 : 200,
          }
        },
      ),
  )

  server.post(
    "/api/admin/applications/connected-apps/:id/rotate-credentials",
    withPersona("admin"),
    async (request, reply) =>
      connectedAppActionResult(
        request,
        reply,
        "POST /api/admin/applications/connected-apps/:id/rotate-credentials",
        async (actor, id) => {
          const result = await rotateAdminConnectedAppCredentials(actor, id)
          if (result.status === "not_found") {
            return connectedAppNotFound()
          }
          if (result.status === "blocked") {
            return connectedAppBlocked(result.detail)
          }
          return {
            idempotencyPayload: {
              app: result.app,
              detail: result.detail,
              status: result.status,
            },
            payload: adminConnectedAppRotateCredentialResultSchema.parse(result),
            statusCode: 200,
          }
        },
      ),
  )

  server.post(
    "/api/admin/applications/connected-apps/:id/disable",
    withPersona("admin"),
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
          return {
            payload: adminConnectedAppSchema.parse(result.app),
            statusCode: 200,
          }
        },
      ),
  )

  server.get(
    "/api/admin/librechat/agents/posture",
    withPersona("admin"),
    async (request) =>
      adminLibreChatAgentPostureSchema.parse(
        await getLibreChatAgentPosture(requireActor(request)),
      ),
  )

  server.get(
    "/api/admin/internal-docs/mcp/posture",
    withPersona("admin"),
    async (request) =>
      adminInternalDocsMcpPostureSchema.parse(
        await getInternalDocsMcpPosture(requireActor(request)),
      ),
  )

  server.post(
    "/api/admin/connectors/:id/vetting",
    withPersona("admin"),
    async (request, reply) => {
      const id = (request.params as { id?: string }).id
      const parsedBody = adminConnectorVettingDecisionRequestSchema.safeParse(
        request.body ?? {},
      )
      if (!parsedBody.success) {
        return reply.code(400).send({
          type: "about:blank",
          title: "Invalid connector vetting request",
          status: 400,
          detail: "A decision and admin note are required.",
        })
      }
      const body = parsedBody.data
      if (!id) {
        return reply.code(400).send({
          type: "about:blank",
          title: "Connector id is required",
          status: 400,
        })
      }

      return withAdminIdempotentMutation(
        request,
        reply,
        "POST /api/admin/connectors/:id/vetting",
        { id, body },
        async (actor) => {
          const result = await decideAdminConnectorVetting(actor, id, body)
          if (result.status === "not_found") {
            return {
              statusCode: 404,
              payload: {
                type: "about:blank",
                title: "Connector not found",
                status: 404,
              },
            }
          }
          if (result.status === "catalog_unavailable") {
            return {
              statusCode: 503,
              payload: {
                type: "about:blank",
                title: "MCP catalog unavailable",
                status: 503,
                detail: result.detail,
              },
            }
          }
          if (result.status === "invalid") {
            return {
              statusCode: 409,
              payload: {
                type: "about:blank",
                title: "Connector decision rejected",
                status: 409,
                detail: result.detail,
              },
            }
          }

          return {
            statusCode: 200,
            payload: adminConnectorRegistryItemSchema.parse(result.item),
          }
        },
      )
    },
  )

  server.post(
    "/api/admin/mcp-servers/test-connection",
    withPersona("admin"),
    async (request, reply) => {
      const parsedBody = adminMcpServerConnectionTestRequestSchema.safeParse(
        request.body ?? {},
      )
      if (!parsedBody.success) {
        return reply.code(400).send({
          type: "about:blank",
          title: "Invalid MCP server connection test request",
          status: 400,
          detail: "A valid MCP server endpoint configuration is required.",
        })
      }

      const result = await testAdminMcpServerConnection(
        requireActor(request),
        parsedBody.data,
      )

      return reply.send(adminMcpServerConnectionTestResponseSchema.parse(result))
    },
  )

  server.get(
    "/api/admin/mcp-servers/:id",
    withPersona("admin"),
    async (request, reply) => {
      const id = (request.params as { id?: string }).id
      if (!id) {
        return reply.code(400).send({
          type: "about:blank",
          title: "MCP server id is required",
          status: 400,
        })
      }

      const result = await getAdminMcpServerDetail(requireActor(request), id)
      if (result.status === "managed") {
        return reply.code(403).send({
          type: "about:blank",
          title: "Managed MCP server",
          status: 403,
          detail:
            "This MCP server is managed by LLM Machines support-tier components and cannot be edited from Console.",
        })
      }
      if (result.status === "not_found") {
        return reply.code(404).send({
          type: "about:blank",
          title: "MCP server not found",
          status: 404,
        })
      }

      return reply.send(adminMcpServerDetailSchema.parse(result.detail))
    },
  )

  server.post(
    "/api/admin/mcp-servers",
    withPersona("admin"),
    async (request, reply) => {
      const parsedBody = createAdminMcpServerRequestSchema.safeParse(
        request.body ?? {},
      )
      if (!parsedBody.success) {
        return reply.code(400).send({
          type: "about:blank",
          title: "Invalid MCP server request",
          status: 400,
          detail: "A name, chat command, transport, endpoint, auth mode, and access level are required.",
        })
      }

      return withAdminIdempotentMutation(
        request,
        reply,
        "POST /api/admin/mcp-servers",
        parsedBody.data,
        async (actor) => {
          const result = await createAdminMcpServer(actor, parsedBody.data)
          if (result.status === "catalog_unavailable") {
            return {
              statusCode: 503,
              payload: {
                type: "about:blank",
                title: "MCP catalog unavailable",
                status: 503,
                detail: result.detail,
              },
            }
          }
          if (result.status === "duplicate") {
            return {
              statusCode: 409,
              payload: {
                type: "about:blank",
                title: "Duplicate MCP server",
                status: 409,
                detail: result.detail,
              },
            }
          }
          if (result.status === "invalid") {
            return {
              statusCode: 400,
              payload: {
                type: "about:blank",
                title: "Invalid MCP server",
                status: 400,
                detail: result.detail,
              },
            }
          }

          return {
            statusCode: 200,
            payload: adminConnectorRegistryItemSchema.parse(result.item),
          }
        },
      )
    },
  )

  server.post(
    "/api/admin/mcp-servers/:id/update",
    withPersona("admin"),
    async (request, reply) => {
      const id = (request.params as { id?: string }).id
      const parsedBody = updateAdminMcpServerRequestSchema.safeParse(
        request.body ?? {},
      )
      if (!id) {
        return reply.code(400).send({
          type: "about:blank",
          title: "MCP server id is required",
          status: 400,
        })
      }
      if (!parsedBody.success) {
        return reply.code(400).send({
          type: "about:blank",
          title: "Invalid MCP server update request",
          status: 400,
          detail: "A valid MCP server configuration is required.",
        })
      }

      return withAdminIdempotentMutation(
        request,
        reply,
        "POST /api/admin/mcp-servers/:id/update",
        { id, body: parsedBody.data },
        async (actor) => {
          const result = await updateAdminMcpServer(actor, id, parsedBody.data)
          if (result.status === "managed") {
            return {
              statusCode: 403,
              payload: {
                type: "about:blank",
                title: "Managed MCP server",
                status: 403,
                detail:
                  "This MCP server is managed by LLM Machines support-tier components and cannot be edited from Console.",
              },
            }
          }
          if (result.status === "not_found") {
            return {
              statusCode: 404,
              payload: {
                type: "about:blank",
                title: "MCP server not found",
                status: 404,
              },
            }
          }
          if (result.status === "invalid") {
            return {
              statusCode: 400,
              payload: {
                type: "about:blank",
                title: "Invalid MCP server update",
                status: 400,
                detail: result.detail,
              },
            }
          }

          return {
            statusCode: 200,
            payload: adminConnectorRegistryItemSchema.parse(result.item),
          }
        },
      )
    },
  )

  server.get(
    "/api/admin/policies/violations",
    withPersona("admin"),
    async (request) =>
      adminPolicyViolationsResponseSchema.parse(
        await getAdminPolicyViolations(
          requireActor(request),
          getSearchQuery(request),
        ),
      ),
  )

  server.post(
    "/api/admin/policies/violations/:id/remediation",
    withPersona("admin"),
    async (request, reply) => {
      const id = (request.params as { id?: string }).id
      const parsedBody = adminPolicyViolationRemediationRequestSchema.safeParse(
        request.body ?? {},
      )
      if (!parsedBody.success) {
        return reply.code(400).send({
          type: "about:blank",
          title: "Invalid policy remediation request",
          status: 400,
          detail: "A remediation status and note are required.",
        })
      }
      const body = parsedBody.data
      if (!id) {
        return reply.code(400).send({
          type: "about:blank",
          title: "Policy violation id is required",
          status: 400,
        })
      }

      return withAdminIdempotentMutation(
        request,
        reply,
        "POST /api/admin/policies/violations/:id/remediation",
        { id, body },
        async (actor) => {
          const violation = await remediateAdminPolicyViolation(actor, id, body)
          if (!violation) {
            return {
              statusCode: 404,
              payload: {
                type: "about:blank",
                title: "Policy violation not found",
                status: 404,
              },
            }
          }

          return {
            statusCode: 200,
            payload: adminPolicyViolationSchema.parse(violation),
          }
        },
      )
    },
  )

  server.get(
    "/api/admin/sandbox/pure-mode",
    withPersona("admin"),
    async (request) =>
      adminPureModeResponseSchema.parse(
        await getAdminPureMode(requireActor(request)),
      ),
  )

  server.post(
    "/api/admin/sandbox/pure-mode/toggle",
    withPersona("admin"),
    async (request, reply) => {
      const parsedBody = adminPureModeTransitionRequestSchema.safeParse(
        request.body ?? {},
      )
      if (!parsedBody.success) {
        return reply.code(400).send({
          type: "about:blank",
          title: "Invalid Pure Mode transition request",
          status: 400,
          detail:
            "An action, reason, and exact PURE confirmation are required.",
        })
      }
      const body = parsedBody.data

      return withAdminIdempotentMutation(
        request,
        reply,
        "POST /api/admin/sandbox/pure-mode/toggle",
        { body },
        async (actor) => {
          const result = await transitionAdminPureMode(actor, body)
          if (result.status !== "updated") {
            const statusCode = result.status === "unavailable" ? 503 : 409
            return {
              statusCode,
              payload: {
                type: "about:blank",
                title: result.title,
                status: statusCode,
                detail: result.detail,
              },
            }
          }

          return {
            statusCode: 200,
            payload: adminPureModeResponseSchema.parse(
              await getAdminPureMode(actor),
            ),
          }
        },
      )
    },
  )

  server.get(
    "/api/admin/builder/agent-studio/quota-policy",
    withPersona("admin"),
    async (request) =>
      adminBuilderAgentStudioQuotaPolicySchema.parse(
        await getBuilderAgentStudioQuotaPolicy(requireActor(request)),
      ),
  )

  server.post(
    "/api/admin/builder/agent-studio/quota-policy",
    withPersona("admin"),
    async (request, reply) => {
      const parsedBody =
        updateAdminBuilderAgentStudioQuotaPolicyRequestSchema.safeParse(
          request.body ?? {},
        )
      if (!parsedBody.success) {
        return reply.code(400).send({
          type: "about:blank",
          title: "Invalid Agent Studio quota policy request",
          status: 400,
          detail: "Run limit, token limit, and an admin note are required.",
        })
      }
      const body = parsedBody.data

      return withAdminIdempotentMutation(
        request,
        reply,
        "POST /api/admin/builder/agent-studio/quota-policy",
        { body },
        async (actor) => ({
          statusCode: 200,
          payload: adminBuilderAgentStudioQuotaPolicySchema.parse(
            await updateBuilderAgentStudioQuotaPolicy(actor, body),
          ),
        }),
      )
    },
  )
}

function getAuditQuery(request: FastifyRequest): {
  eventId?: string
  limit?: number
  query?: string
} {
  const query =
    typeof request.query === "object" && request.query !== null
      ? request.query
      : {}
  return {
    eventId:
      "event" in query && typeof query.event === "string"
        ? query.event
        : undefined,
    limit:
      "limit" in query && typeof query.limit === "string"
        ? Number.parseInt(query.limit, 10)
        : undefined,
    query: "q" in query && typeof query.q === "string" ? query.q : undefined,
  }
}

function getSearchQuery(request: FastifyRequest): { query?: string } {
  const query =
    typeof request.query === "object" && request.query !== null
      ? request.query
      : {}
  return {
    query: "q" in query && typeof query.q === "string" ? query.q : undefined,
  }
}

function getHardwareQuery(request: FastifyRequest): {
  host?: string
  range?: string
  step?: string
} {
  const query =
    typeof request.query === "object" && request.query !== null
      ? request.query
      : {}
  return {
    host:
      "host" in query && typeof query.host === "string"
        ? query.host
        : undefined,
    range:
      "range" in query && typeof query.range === "string"
        ? query.range
        : undefined,
    step:
      "step" in query && typeof query.step === "string"
        ? query.step
        : undefined,
  }
}

function getInferenceQuery(request: FastifyRequest): {
  range?: string
} {
  const query =
    typeof request.query === "object" && request.query !== null
      ? request.query
      : {}
  return {
    range:
      "range" in query && typeof query.range === "string"
        ? query.range
        : undefined,
  }
}

function requireActor(request: FastifyRequest): Actor {
  if (!request.actor) {
    throw new Error("Authenticated route executed without an actor.")
  }
  return request.actor
}

function settingsMutationResponse(
  result:
    | { settings: unknown; status: "ok" }
    | { detail: string; status: "invalid" | "duplicate" | "not_found" },
  title: string,
): { statusCode: number; payload: unknown } {
  if (result.status === "ok") {
    return {
      statusCode: 200,
      payload: adminSettingsResponseSchema.parse(result.settings),
    }
  }
  if (result.status === "not_found") {
    return {
      statusCode: 404,
      payload: {
        type: "about:blank",
        title: "URL policy rule not found",
        status: 404,
        detail: result.detail,
      },
    }
  }
  if (result.status === "duplicate") {
    return {
      statusCode: 409,
      payload: {
        type: "about:blank",
        title: "Duplicate URL policy rule",
        status: 409,
        detail: result.detail,
      },
    }
  }
  return {
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
  run: (actor: Actor, id: string) => Promise<unknown>,
  body: unknown = {},
) {
  const id = (request.params as { id?: string }).id
  if (!id) {
    return reply.code(400).send({
      type: "about:blank",
      title: "Team member id is required",
      status: 400,
    })
  }

  return withAdminIdempotentMutation(
    request,
    reply,
    `POST /api/admin/team/members/:id/${action}`,
    { body, id },
    async (actor) => ({
      payload: adminTeamActionResponseSchema.parse(await run(actor, id)),
      statusCode: 200,
    }),
  )
}

async function teamRouteResult(
  reply: FastifyReply,
  run: () => Promise<unknown>,
) {
  try {
    return reply.send(await run())
  } catch (error) {
    if (error instanceof AdminTeamError) {
      return reply.code(error.httpStatus).send({
        type: "about:blank",
        title: "Team request failed",
        status: error.httpStatus,
        detail: error.message,
      })
    }
    if (isTeamServiceStatusError(error)) {
      return reply.code(teamServiceHttpStatus(error.status)).send({
        type: "about:blank",
        title: "Team request failed",
        status: teamServiceHttpStatus(error.status),
        detail: "Keycloak Admin API request failed.",
      })
    }
    throw error
  }
}

function isTeamServiceStatusError(
  error: unknown,
): error is { status: string } {
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

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  )
}

async function connectedAppActionResult(
  request: FastifyRequest,
  reply: FastifyReply,
  route: string,
  run: (
    actor: Actor,
    id: string,
  ) => Promise<{
    idempotencyPayload?: unknown
    payload: unknown
    statusCode: number
  }>,
) {
  const id = (request.params as { id?: string }).id
  if (!id) {
    return reply.code(400).send({
      type: "about:blank",
      title: "Connected app id is required",
      status: 400,
    })
  }
  return withAdminIdempotentMutation(
    request,
    reply,
    route,
    { id },
    async (actor) => run(actor, id),
  )
}

function connectedAppNotFound(): {
  payload: unknown
  statusCode: number
} {
  return {
    payload: {
      type: "about:blank",
      title: "Connected app not found",
      status: 404,
    },
    statusCode: 404,
  }
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

async function withAdminIdempotentMutation(
  request: FastifyRequest,
  reply: FastifyReply,
  route: string,
  requestPayload: unknown,
  run: (actor: Actor) => Promise<{
    idempotencyPayload?: unknown
    payload: unknown
    statusCode: number
  }>,
) {
  const actor = requireActor(request)
  const idempotencyKey = getHeaderValue(request, "idempotency-key")
  if (!idempotencyKey) {
    return reply.code(400).send({
      type: "about:blank",
      title: "Idempotency key is required",
      status: 400,
      detail: `Pass an Idempotency-Key header for ${route}.`,
    })
  }

  const requestHash = hashJson(requestPayload)
  const reservation = await reserveIdempotency({
    actorId: actor.subject,
    route,
    idempotencyKey,
    requestHash,
  })
  if (reservation.status === "replay") {
    return reply.code(reservation.statusCode).send(reservation.response)
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

  let result: {
    idempotencyPayload?: unknown
    payload: unknown
    statusCode: number
  }
  try {
    result = await run(actor)
  } catch (error) {
    if (error instanceof AdminTeamError) {
      return reply.code(error.httpStatus).send({
        type: "about:blank",
        title: "Team request failed",
        status: error.httpStatus,
        detail: error.message,
      })
    }
    if (isTeamServiceStatusError(error)) {
      return reply.code(teamServiceHttpStatus(error.status)).send({
        type: "about:blank",
        title: "Team request failed",
        status: teamServiceHttpStatus(error.status),
        detail: "Keycloak Admin API request failed.",
      })
    }
    throw error
  }
  await completeIdempotency({
    storeKey: reservation.storeKey,
    requestHash,
    statusCode: result.statusCode,
    response: result.idempotencyPayload ?? result.payload,
  })
  return reply.code(result.statusCode).send(result.payload)
}

function getHeaderValue(
  request: FastifyRequest,
  name: string,
): string | undefined {
  const value = request.headers[name.toLowerCase()]
  return Array.isArray(value) ? value[0] : value
}

function hashJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("base64url")
}
