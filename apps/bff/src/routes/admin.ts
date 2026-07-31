import { createHash } from "node:crypto"
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import {
  adminAuditResponseSchema,
  adminConnectedAppCreateRequestSchema,
  adminConnectedAppCreateResponseSchema,
  adminConnectedAppDetailSchema,
  adminConnectedAppRotateCredentialResultSchema,
  adminConnectedAppsResponseSchema,
  adminConnectedAppSchema,
  adminConnectedAppTestResultSchema,
  adminConnectedAppUpdateRequestSchema,
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
  updateAdminSettingsOrganizationRequestSchema,
  updateAdminSettingsTelemetryRequestSchema,
  updateAdminTeamGroupRequestSchema,
} from "@llm-machines/contracts/inference-core"
import type { Actor } from "../auth/persona"
import { withPersona } from "../auth/persona"
import { getAdminAuditTimeline } from "../services/admin-audit"
import {
  createAdminConnectedApp,
  disableAdminConnectedApp,
  getAdminConnectedAppDetail,
  getAdminConnectedApps,
  rotateAdminConnectedAppCredentials,
  testAdminConnectedApp,
  updateAdminConnectedApp,
} from "../services/admin-connected-apps"
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
import {
  type IdempotencyReceipt,
  completeIdempotency,
  reserveIdempotency,
} from "../services/idempotency"

export function registerAdminRoutes(server: FastifyInstance): void {
  server.get("/api/admin/audit", withPersona("admin"), async (request) =>
    adminAuditResponseSchema.parse(
      await getAdminAuditTimeline(requireActor(request), getAuditQuery(request)),
    ),
  )

  server.get("/api/admin/overview", withPersona("admin"), async (request) =>
    adminOverviewResponseSchema.parse(
      await getAdminOverview(requireActor(request)),
    ),
  )

  server.get("/api/admin/settings", withPersona("admin"), async (request) =>
    adminSettingsResponseSchema.parse(
      await getAdminSettings(requireActor(request)),
    ),
  )

  server.post(
    "/api/admin/settings/organization",
    withPersona("admin"),
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
    withPersona("admin"),
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
    withPersona("admin"),
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
        async (actor) => ({
          payload: adminTeamCsvImportCommitResponseSchema.parse(
            await commitAdminTeamCsvImport(actor, body.data),
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
    withPersona("admin"),
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
        async (actor) => ({
          payload: adminTeamGroupMutationResponseSchema.parse(
            await createAdminTeamGroup(actor, body.data),
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
        async (actor) => ({
          payload: adminTeamGroupMutationResponseSchema.parse(
            await updateAdminTeamGroup(actor, id, body.data),
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
      const id = routeId(request)
      if (!id) {
        return missingId(reply, "Team group")
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
        async (actor) => ({
          payload: adminTeamGroupMutationResponseSchema.parse(
            await bulkAssignAdminTeamGroupMembers(actor, id, body.data),
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
        return invalidRequest(
          reply,
          "Team group and member ids are required",
        )
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
    withPersona("admin"),
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
        async (actor) => {
          const payload = adminTeamMemberMutationResponseSchema.parse(
            await createAdminTeamMember(actor, body.data),
          )
          return {
            idempotencyResourceId: payload.member.id,
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
      const id = routeId(request)
      if (!id) {
        return missingId(reply, "Team member")
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
            idempotencyResourceId: payload.member.id,
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
      const body = adminConnectedAppCreateRequestSchema.safeParse(
        request.body ?? {},
      )
      if (!body.success) {
        return invalidRequest(
          reply,
          "Invalid connected app request",
          "Name, description, owner group, allowed models, and optional limits are required.",
        )
      }
      return withAdminIdempotentMutation(
        request,
        reply,
        "POST /api/admin/applications/connected-apps",
        body.data,
        async (actor) => {
          const result = await createAdminConnectedApp(actor, body.data)
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
      )
    },
  )

  server.get(
    "/api/admin/applications/connected-apps/:id",
    withPersona("admin"),
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
    withPersona("admin"),
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
    withPersona("admin"),
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
            idempotencyResourceId: result.app.id,
            payload: adminConnectedAppRotateCredentialResultSchema.parse(
              result,
            ),
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
          return result.status === "not_found"
            ? connectedAppNotFound()
            : {
                payload: adminConnectedAppSchema.parse(result.app),
                statusCode: 200,
              }
        },
      ),
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

function getAuditQuery(request: FastifyRequest): {
  eventId?: string
  limit?: number
  query?: string
} {
  const query = objectQuery(request)
  return {
    eventId: stringQuery(query, "event"),
    limit: stringQuery(query, "limit")
      ? Number.parseInt(stringQuery(query, "limit") ?? "", 10)
      : undefined,
    query: stringQuery(query, "q"),
  }
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

function routeId(request: FastifyRequest): string | undefined {
  return (request.params as { id?: string }).id
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
  run: (actor: Actor, id: string) => Promise<unknown>,
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
        async (actor) => run(actor, id),
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

function invalidRequest(
  reply: FastifyReply,
  title: string,
  detail?: string,
) {
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
  run: (actor: Actor) => Promise<{
    idempotencyResourceId?: string
    payload: unknown
    receiptOutcome?: IdempotencyReceipt["outcome"]
    statusCode: number
  }>,
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

  let result: {
    idempotencyResourceId?: string
    payload: unknown
    receiptOutcome?: IdempotencyReceipt["outcome"]
    statusCode: number
  }
  try {
    result = await run(actor)
  } catch (error) {
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
      return reply.code(503).send({
        type: "about:blank",
        title: "Idempotency completion unavailable",
        status: 503,
        detail:
          "The mutation completed but its durable idempotency receipt could not be recorded. Reconcile the resource before retrying.",
      })
    }
    return reply.code(errorResult.statusCode).send(errorResult.payload)
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
    return reply.code(503).send({
      type: "about:blank",
      title: "Idempotency completion unavailable",
      status: 503,
      detail:
        "The mutation completed but its durable idempotency receipt could not be recorded. Reconcile the resource before retrying.",
    })
  }
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
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}
