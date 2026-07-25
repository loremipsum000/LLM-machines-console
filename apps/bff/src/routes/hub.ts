import { createHash } from "node:crypto"
import type { FastifyInstance, FastifyRequest } from "fastify"
import type { Actor } from "../auth/persona"
import {
  artifactSchema,
  hubEventSchema,
  hubHomeResponseSchema,
  hubModuleSchema,
  hubNotificationSchema,
  hubResourceSchema,
  hubSearchResultSchema,
  hubUsageSummarySchema,
  taskSessionSchema,
} from "@llm-machines/contracts"
import { withPersona } from "../auth/persona"
import {
  getHubAdminSummary,
  getHubArtifact,
  getHubArtifacts,
  getHubEvents,
  getHubHome,
  getHubNotifications,
  getHubResource,
  getHubResources,
  getHubTask,
  getHubTasks,
  getHubUsage,
  markHubNotificationRead,
  searchHub,
  subscribeHubEvents,
} from "../services/hub"
import {
  completeIdempotency,
  reserveIdempotency,
} from "../services/idempotency"

export function registerHubRoutes(server: FastifyInstance): void {
  server.get("/api/hub/home", withPersona("consumer"), async (request) =>
    hubHomeResponseSchema.parse(await getHubHome(requireActor(request))),
  )

  server.get("/api/hub/resources", withPersona("consumer"), async (request) =>
    hubResourceSchema
      .array()
      .parse(await getHubResources(requireActor(request))),
  )

  server.get(
    "/api/hub/resources/:type/:id",
    withPersona("consumer"),
    async (request, reply) => {
      const { id, type } = request.params as { id?: string; type?: string }
      if (!id || !type) {
        return reply.code(400).send({
          type: "about:blank",
          title: "Resource type and id are required",
          status: 400,
        })
      }

      const resource = await getHubResource(requireActor(request), type, id)
      if (!resource) {
        return reply.code(404).send({
          type: "about:blank",
          title: "Resource not found",
          status: 404,
        })
      }

      return hubResourceSchema.parse(resource)
    },
  )

  server.get(
    "/api/hub/notifications",
    withPersona("consumer"),
    async (request) =>
      hubNotificationSchema
        .array()
        .parse(await getHubNotifications(requireActor(request))),
  )

  server.patch(
    "/api/hub/notifications/:id/read",
    withPersona("consumer"),
    async (request, reply) => {
      const id = (request.params as { id?: string }).id
      if (!id) {
        return reply.code(400).send({
          type: "about:blank",
          title: "Notification id is required",
          status: 400,
        })
      }

      const actor = requireActor(request)
      const idempotencyKey = getHeaderValue(request, "idempotency-key")
      if (!idempotencyKey) {
        return reply.code(400).send({
          type: "about:blank",
          title: "Idempotency key is required",
          status: 400,
          detail:
            "Pass an Idempotency-Key header for notification read mutations.",
        })
      }

      const requestHash = hashJson({ id })
      const reservation = await reserveIdempotency({
        actorId: actor.subject,
        route: "PATCH /api/hub/notifications/:id/read",
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
            "This Idempotency-Key was already used with a different notification read request.",
        })
      }
      if (reservation.status === "pending") {
        return reply.code(409).send({
          type: "about:blank",
          title: "Notification read is still in progress",
          status: 409,
          detail:
            "This Idempotency-Key is already processing. Retry after the first request finishes.",
        })
      }

      const notification = await markHubNotificationRead(actor, id)
      if (!notification) {
        const responsePayload = {
          type: "about:blank",
          title: "Notification not found",
          status: 404,
        }
        await completeIdempotency({
          storeKey: reservation.storeKey,
          requestHash,
          statusCode: 404,
          response: responsePayload,
        })
        return reply.code(404).send(responsePayload)
      }

      const responsePayload = hubNotificationSchema.parse(notification)
      await completeIdempotency({
        storeKey: reservation.storeKey,
        requestHash,
        statusCode: 200,
        response: responsePayload,
      })
      return responsePayload
    },
  )

  server.get("/api/hub/search", withPersona("consumer"), async (request) => {
    const query =
      typeof request.query === "object" && request.query !== null
        ? request.query
        : {}
    const q = "q" in query && typeof query.q === "string" ? query.q : ""
    return hubSearchResultSchema
      .array()
      .parse(await searchHub(requireActor(request), q))
  })

  server.get("/api/hub/usage", withPersona("consumer"), async (request) =>
    hubUsageSummarySchema.parse(await getHubUsage(requireActor(request))),
  )

  server.get("/api/hub/tasks", withPersona("consumer"), async (request) =>
    taskSessionSchema.array().parse(await getHubTasks(requireActor(request))),
  )

  server.get(
    "/api/hub/tasks/:id",
    withPersona("consumer"),
    async (request, reply) => {
      const id = (request.params as { id?: string }).id
      if (!id) {
        return reply.code(400).send({
          type: "about:blank",
          title: "Task id is required",
          status: 400,
        })
      }

      const task = await getHubTask(requireActor(request), id)
      if (!task) {
        return reply.code(404).send({
          type: "about:blank",
          title: "Task not found",
          status: 404,
        })
      }

      return taskSessionSchema.parse(task)
    },
  )

  server.get("/api/hub/artifacts", withPersona("consumer"), async (request) =>
    artifactSchema.array().parse(await getHubArtifacts(requireActor(request))),
  )

  server.get(
    "/api/hub/artifacts/:id",
    withPersona("consumer"),
    async (request, reply) => {
      const id = (request.params as { id?: string }).id
      if (!id) {
        return reply.code(400).send({
          type: "about:blank",
          title: "Artifact id is required",
          status: 400,
        })
      }

      const artifact = await getHubArtifact(requireActor(request), id)
      if (!artifact) {
        return reply.code(404).send({
          type: "about:blank",
          title: "Artifact not found",
          status: 404,
        })
      }

      return artifactSchema.parse(artifact)
    },
  )

  server.get("/api/hub/admin-summary", withPersona("admin"), async (request) =>
    hubModuleSchema.parse(await getHubAdminSummary(requireActor(request))),
  )

  server.get(
    "/api/hub/events",
    withPersona("consumer"),
    async (request, reply) => {
      const actor = requireActor(request)
      const events = hubEventSchema.array().parse(await getHubEvents(actor))
      reply.hijack()
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
        "Content-Encoding": "identity",
      })

      for (const event of events) {
        reply.raw.write(encodeHubEvent(event))
      }

      if (isOnceRequest(request)) {
        reply.raw.end()
        return
      }

      const unsubscribe = subscribeHubEvents(actor, (event) => {
        reply.raw.write(encodeHubEvent(event))
      })
      const keepAlive = setInterval(() => {
        reply.raw.write(": keep-alive\n\n")
      }, 30000)
      request.raw.on("close", () => {
        unsubscribe()
        clearInterval(keepAlive)
        reply.raw.end()
      })
    },
  )
}

function requireActor(request: FastifyRequest): Actor {
  if (!request.actor) {
    throw new Error("Authenticated actor is required.")
  }
  return request.actor
}

function isOnceRequest(request: FastifyRequest): boolean {
  const query =
    typeof request.query === "object" && request.query !== null
      ? request.query
      : {}
  return "once" in query && query.once === "true"
}

function encodeHubEvent(event: unknown): string {
  const parsed = hubEventSchema.parse(event)
  return `event: ${parsed.type}\nid: ${parsed.id}\ndata: ${JSON.stringify(parsed)}\n\n`
}

function getHeaderValue(
  request: FastifyRequest,
  name: string,
): string | undefined {
  const value = request.headers[name]
  return Array.isArray(value) ? value[0] : value
}

function hashJson(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex")
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
}
