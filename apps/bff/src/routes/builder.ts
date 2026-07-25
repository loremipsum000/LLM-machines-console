import { createHash } from "node:crypto"
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import {
  agentCorpusBindingSchema,
  builderAgentStudioSchema,
  builderAgentTestResultSchema,
  builderAgentTestStreamEventSchema,
  builderResourceSchema,
  builderSubmissionSchema,
  builderTemplateSchema,
  clearBuilderAgentTestRunsRequestSchema,
  createBuilderResourceVersionRequestSchema,
  forkBuilderTemplateRequestSchema,
  knowledgeCorpusListResponseSchema,
  rejectBuilderResourceRequestSchema,
  resetBuilderAgentStudioDraftRequestSchema,
  testBuilderAgentRequestSchema,
  updateBuilderAgentStudioRequestSchema,
} from "@llm-machines/contracts"
import type { BuilderAgentTestStreamEvent } from "@llm-machines/contracts"
import type { Actor } from "../auth/persona"
import { withPersona } from "../auth/persona"
import {
  completeIdempotency,
  reserveIdempotency,
} from "../services/idempotency"
import {
  approveBuilderResource,
  clearBuilderAgentStudioTestRuns,
  createBuilderResourceVersion,
  forkBuilderTemplate,
  getBuilderAgentStudio,
  getBuilderResource,
  getBuilderResources,
  getBuilderSubmissions,
  getBuilderTemplate,
  getBuilderTemplates,
  rejectBuilderResource,
  resetBuilderAgentStudioDraft,
  streamBuilderAgentStudioTest,
  submitBuilderResource,
  testBuilderAgentStudio,
  updateBuilderAgentStudio,
  withdrawBuilderResource,
} from "../services/builder"
import {
  bindKnowledgeCorpusToAgent,
  listKnowledgeAgentBindingsForBuilder,
  listPublishedKnowledgeCorporaForBuilder,
} from "../services/knowledge/admin"

export function registerBuilderRoutes(server: FastifyInstance): void {
  server.get("/api/builder/templates", withPersona("builder"), async () =>
    builderTemplateSchema.array().parse(getBuilderTemplates()),
  )

  server.get(
    "/api/builder/templates/:id",
    withPersona("builder"),
    async (request, reply) => {
      const id = (request.params as { id?: string }).id
      if (!id) {
        return reply.code(400).send({
          type: "about:blank",
          title: "Template id is required",
          status: 400,
        })
      }

      const template = getBuilderTemplate(id)
      if (!template) {
        return reply.code(404).send({
          type: "about:blank",
          title: "Template not found",
          status: 404,
        })
      }

      return builderTemplateSchema.parse(template)
    },
  )

  server.post(
    "/api/builder/templates/:id/fork",
    withPersona("builder"),
    async (request, reply) => {
      const id = (request.params as { id?: string }).id
      const parsedBody = forkBuilderTemplateRequestSchema.safeParse(
        request.body ?? {},
      )
      if (!parsedBody.success) {
        return reply.code(400).send({
          type: "about:blank",
          title: "Invalid template fork request",
          status: 400,
        })
      }
      const body = parsedBody.data
      if (!id) {
        return reply.code(400).send({
          type: "about:blank",
          title: "Template id is required",
          status: 400,
        })
      }

      return withIdempotentMutation(
        request,
        reply,
        "POST /api/builder/templates/:id/fork",
        { id, body },
        async (actor) => {
          const resource = await forkBuilderTemplate(actor, id, body)
          if (!resource) {
            return {
              statusCode: 404,
              payload: {
                type: "about:blank",
                title: "Template not found",
                status: 404,
              },
            }
          }
          return {
            statusCode: 201,
            payload: builderResourceSchema.parse(resource),
          }
        },
      )
    },
  )

  server.get(
    "/api/builder/resources",
    withPersona("builder"),
    async (request) =>
      builderResourceSchema
        .array()
        .parse(await getBuilderResources(requireActor(request))),
  )

  server.get(
    "/api/builder/resources/:id",
    withPersona("builder"),
    async (request, reply) => {
      const id = (request.params as { id?: string }).id
      if (!id) {
        return reply.code(400).send({
          type: "about:blank",
          title: "Resource id is required",
          status: 400,
        })
      }

      const resource = await getBuilderResource(requireActor(request), id)
      if (!resource) {
        return reply.code(404).send({
          type: "about:blank",
          title: "Resource not found",
          status: 404,
        })
      }

      return builderResourceSchema.parse(resource)
    },
  )

  server.post(
    "/api/builder/resources/:id/versions",
    withPersona("builder"),
    async (request, reply) => {
      const id = (request.params as { id?: string }).id
      const parsedBody = createBuilderResourceVersionRequestSchema.safeParse(
        request.body ?? {},
      )
      if (!parsedBody.success) {
        return reply.code(400).send({
          type: "about:blank",
          title: "Invalid version request",
          status: 400,
        })
      }
      const body = parsedBody.data
      if (!id) {
        return reply.code(400).send({
          type: "about:blank",
          title: "Resource id is required",
          status: 400,
        })
      }

      return withIdempotentMutation(
        request,
        reply,
        "POST /api/builder/resources/:id/versions",
        { id, body },
        async (actor) => {
          const resource = await createBuilderResourceVersion(
            actor,
            id,
            body.semver,
          )
          if (!resource) {
            return lifecycleConflict("Resource is not editable as a draft.")
          }
          return {
            statusCode: 201,
            payload: builderResourceSchema.parse(resource),
          }
        },
      )
    },
  )

  server.post(
    "/api/builder/resources/:id/submit",
    withPersona("builder"),
    async (request, reply) => {
      const id = (request.params as { id?: string }).id
      if (!id) {
        return reply.code(400).send({
          type: "about:blank",
          title: "Resource id is required",
          status: 400,
        })
      }

      return withIdempotentMutation(
        request,
        reply,
        "POST /api/builder/resources/:id/submit",
        { id },
        async (actor) => {
          const submission = await submitBuilderResource(actor, id)
          if (!submission) {
            return lifecycleConflict(
              "Resource needs a draft state and current version before submit.",
            )
          }
          return {
            statusCode: 201,
            payload: builderSubmissionSchema.parse(submission),
          }
        },
      )
    },
  )

  server.post(
    "/api/builder/resources/:id/withdraw",
    withPersona("builder"),
    async (request, reply) => {
      const id = (request.params as { id?: string }).id
      if (!id) {
        return reply.code(400).send({
          type: "about:blank",
          title: "Resource id is required",
          status: 400,
        })
      }

      return withIdempotentMutation(
        request,
        reply,
        "POST /api/builder/resources/:id/withdraw",
        { id },
        async (actor) => {
          const submission = await withdrawBuilderResource(actor, id)
          if (!submission) {
            return lifecycleConflict(
              "Resource is not pending withdrawal by this Builder.",
            )
          }
          return {
            statusCode: 200,
            payload: builderSubmissionSchema.parse(submission),
          }
        },
      )
    },
  )

  server.get(
    "/api/builder/agents/:id/studio",
    withPersona("builder"),
    async (request, reply) => {
      const id = (request.params as { id?: string }).id
      if (!id) {
        return reply.code(400).send({
          type: "about:blank",
          title: "Resource id is required",
          status: 400,
        })
      }

      const studio = await getBuilderAgentStudio(requireActor(request), id)
      if (!studio) {
        return reply.code(404).send({
          type: "about:blank",
          title: "Agent Studio not found",
          status: 404,
        })
      }

      return builderAgentStudioSchema.parse(studio)
    },
  )

  server.get(
    "/api/builder/knowledge/corpora",
    withPersona("builder"),
    async (request) =>
      knowledgeCorpusListResponseSchema.parse(
        await listPublishedKnowledgeCorporaForBuilder(requireActor(request)),
      ),
  )

  server.get(
    "/api/builder/agents/:id/corpora",
    withPersona("builder"),
    async (request, reply) => {
      const id = (request.params as { id?: string }).id
      if (!id) {
        return reply.code(400).send({
          type: "about:blank",
          title: "Resource id is required",
          status: 400,
        })
      }

      return agentCorpusBindingSchema
        .array()
        .parse(
          await listKnowledgeAgentBindingsForBuilder(requireActor(request), id),
        )
    },
  )

  server.post(
    "/api/builder/agents/:id/corpora/:corpusId",
    withPersona("builder"),
    async (request, reply) => {
      const id = (request.params as { id?: string }).id
      const corpusId = (request.params as { corpusId?: string }).corpusId
      if (!id || !corpusId) {
        return reply.code(400).send({
          type: "about:blank",
          title: "Resource and corpus ids are required",
          status: 400,
        })
      }

      return withIdempotentMutation(
        request,
        reply,
        "POST /api/builder/agents/:id/corpora/:corpusId",
        { id, corpusId },
        async (actor) => {
          const result = await bindKnowledgeCorpusToAgent(actor, id, corpusId)
          if (result.status !== "ok") {
            return {
              statusCode: result.status === "not_found" ? 404 : 409,
              payload: {
                type: "about:blank",
                title: result.detail,
                status: result.status === "not_found" ? 404 : 409,
              },
            }
          }
          return {
            statusCode: 200,
            payload: agentCorpusBindingSchema.parse(result.binding),
          }
        },
      )
    },
  )

  server.post(
    "/api/builder/agents/:id/studio",
    withPersona("builder"),
    async (request, reply) => {
      const id = (request.params as { id?: string }).id
      const parsedBody = updateBuilderAgentStudioRequestSchema.safeParse(
        request.body ?? {},
      )
      if (!parsedBody.success) {
        return reply.code(400).send({
          type: "about:blank",
          title: "Invalid Agent Studio request",
          status: 400,
        })
      }
      const body = parsedBody.data
      if (!id) {
        return reply.code(400).send({
          type: "about:blank",
          title: "Resource id is required",
          status: 400,
        })
      }

      return withIdempotentMutation(
        request,
        reply,
        "POST /api/builder/agents/:id/studio",
        { id, body },
        async (actor) => {
          const studio = await updateBuilderAgentStudio(actor, id, body)
          if (!studio) {
            return lifecycleConflict(
              "Agent Studio is only editable by the owning Builder while the agent is a draft.",
            )
          }
          return {
            statusCode: 200,
            payload: builderAgentStudioSchema.parse(studio),
          }
        },
      )
    },
  )

  server.post(
    "/api/builder/agents/:id/studio/reset",
    withPersona("builder"),
    async (request, reply) => {
      const id = (request.params as { id?: string }).id
      const parsedBody = resetBuilderAgentStudioDraftRequestSchema.safeParse(
        request.body ?? {},
      )
      if (!parsedBody.success) {
        return reply.code(400).send({
          type: "about:blank",
          title: "Invalid Agent Studio reset request",
          status: 400,
          detail: "Type RESET to reset the draft Studio config.",
        })
      }
      const body = parsedBody.data
      if (!id) {
        return reply.code(400).send({
          type: "about:blank",
          title: "Resource id is required",
          status: 400,
        })
      }

      return withIdempotentMutation(
        request,
        reply,
        "POST /api/builder/agents/:id/studio/reset",
        { id, body },
        async (actor) => {
          const studio = await resetBuilderAgentStudioDraft(actor, id)
          if (!studio) {
            return lifecycleConflict(
              "Agent Studio drafts can only be reset by the owning Builder while the agent is a draft.",
            )
          }
          return {
            statusCode: 200,
            payload: builderAgentStudioSchema.parse(studio),
          }
        },
      )
    },
  )

  server.post(
    "/api/builder/agents/:id/test-runs/clear",
    withPersona("builder"),
    async (request, reply) => {
      const id = (request.params as { id?: string }).id
      const parsedBody = clearBuilderAgentTestRunsRequestSchema.safeParse(
        request.body ?? {},
      )
      if (!parsedBody.success) {
        return reply.code(400).send({
          type: "about:blank",
          title: "Invalid Agent Studio test-run cleanup request",
          status: 400,
          detail: "Type CLEAR to remove recorded Studio test runs.",
        })
      }
      const body = parsedBody.data
      if (!id) {
        return reply.code(400).send({
          type: "about:blank",
          title: "Resource id is required",
          status: 400,
        })
      }

      return withIdempotentMutation(
        request,
        reply,
        "POST /api/builder/agents/:id/test-runs/clear",
        { id, body },
        async (actor) => {
          const studio = await clearBuilderAgentStudioTestRuns(actor, id)
          if (!studio) {
            return lifecycleConflict(
              "Agent Studio test runs can only be cleared by the owning Builder while the agent is a draft.",
            )
          }
          return {
            statusCode: 200,
            payload: builderAgentStudioSchema.parse(studio),
          }
        },
      )
    },
  )

  server.post(
    "/api/builder/agents/:id/test",
    withPersona("builder"),
    async (request, reply) => {
      const id = (request.params as { id?: string }).id
      const parsedBody = testBuilderAgentRequestSchema.safeParse(
        request.body ?? {},
      )
      if (!parsedBody.success) {
        return reply.code(400).send({
          type: "about:blank",
          title: "Invalid Agent Studio test request",
          status: 400,
        })
      }
      const body = parsedBody.data
      if (!id) {
        return reply.code(400).send({
          type: "about:blank",
          title: "Resource id is required",
          status: 400,
        })
      }

      return withIdempotentMutation(
        request,
        reply,
        "POST /api/builder/agents/:id/test",
        { id, body },
        async (actor) => {
          const testRun = await testBuilderAgentStudio(actor, id, body.input)
          if (!testRun) {
            return lifecycleConflict(
              "Agent Studio tests are only available to the owning Builder while the agent is a draft.",
            )
          }
          if (!testRun.ok) {
            return {
              statusCode: testRun.status,
              payload: {
                type: "about:blank",
                title: testRun.title,
                status: testRun.status,
                detail: testRun.detail,
                ...(testRun.testRunId ? { testRunId: testRun.testRunId } : {}),
                ...(testRun.runtimeTraceId
                  ? { runtimeTraceId: testRun.runtimeTraceId }
                  : {}),
                ...(testRun.quota ? { quota: testRun.quota } : {}),
              },
            }
          }
          return {
            statusCode: 200,
            payload: builderAgentTestResultSchema.parse(testRun.result),
          }
        },
      )
    },
  )

  server.post(
    "/api/builder/agents/:id/test/stream",
    withPersona("builder"),
    async (request, reply) => {
      const id = (request.params as { id?: string }).id
      const parsedBody = testBuilderAgentRequestSchema.safeParse(
        request.body ?? {},
      )
      if (!parsedBody.success) {
        return reply.code(400).send({
          type: "about:blank",
          title: "Invalid Agent Studio test request",
          status: 400,
        })
      }
      const body = parsedBody.data
      if (!id) {
        return reply.code(400).send({
          type: "about:blank",
          title: "Resource id is required",
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
          detail: "Pass an Idempotency-Key header for Agent Studio tests.",
        })
      }

      const route = "POST /api/builder/agents/:id/test/stream"
      const requestHash = hashJson({ id, body })
      const reservation = await reserveIdempotency({
        actorId: actor.subject,
        route,
        idempotencyKey,
        requestHash,
      })
      if (reservation.status === "replay") {
        const event = builderAgentTestStreamEventSchema.safeParse(
          reservation.response,
        )
        if (event.success) {
          reply.hijack()
          writeSseHeaders(reply)
          await writeBuilderSseEvent(reply, event.data)
          reply.raw.end()
          return
        }
        return reply.code(reservation.statusCode).send(reservation.response)
      }
      if (reservation.status === "conflict") {
        return reply.code(409).send({
          type: "about:blank",
          title: "Idempotency key conflict",
          status: 409,
          detail:
            "This Idempotency-Key was already used with a different Agent Studio test request.",
        })
      }
      if (reservation.status === "pending") {
        return reply.code(409).send({
          type: "about:blank",
          title: "Agent Studio test is still in progress",
          status: 409,
          detail:
            "This Idempotency-Key is already processing. Retry after the first request finishes.",
        })
      }

      const controller = new AbortController()
      request.raw.on("aborted", () => controller.abort())
      let streamStarted = false
      let finalEvent: BuilderAgentTestStreamEvent | null = null

      const emit = async (event: BuilderAgentTestStreamEvent) => {
        const parsed = builderAgentTestStreamEventSchema.parse(event)
        if (
          parsed.type === "builder.agent_test.completed" ||
          parsed.type === "builder.agent_test.failed"
        ) {
          finalEvent = parsed
        }
        if (!streamStarted) {
          reply.hijack()
          writeSseHeaders(reply)
          streamStarted = true
        }
        await writeBuilderSseEvent(reply, parsed)
      }

      try {
        const streamed = await streamBuilderAgentStudioTest(
          actor,
          id,
          body.input,
          emit,
          controller.signal,
        )
        if (!streamed) {
          const responsePayload = lifecycleConflict(
            "Agent Studio tests are only available to the owning Builder while the agent is a draft.",
          )
          await completeIdempotency({
            storeKey: reservation.storeKey,
            requestHash,
            statusCode: responsePayload.statusCode,
            response: responsePayload.payload,
          })
          return reply
            .code(responsePayload.statusCode)
            .send(responsePayload.payload)
        }

        const storedEvent =
          finalEvent ??
          builderAgentTestStreamEventSchema.parse({
            type: "builder.agent_test.failed",
            status: 503,
            title: "Agent Studio test failed",
            detail: "Agent Studio stream ended before a terminal event.",
          })
        await completeIdempotency({
          storeKey: reservation.storeKey,
          requestHash,
          statusCode: 200,
          response: storedEvent,
        })
        if (streamStarted) {
          reply.raw.end()
          return
        }
        return reply.code(503).send(storedEvent)
      } catch (error) {
        const failure = builderAgentTestStreamEventSchema.parse({
          type: "builder.agent_test.failed",
          status: 503,
          title: "Agent Studio test failed",
          detail:
            error instanceof Error
              ? error.message
              : "Agent Studio stream failed.",
        })
        await completeIdempotency({
          storeKey: reservation.storeKey,
          requestHash,
          statusCode: streamStarted ? 200 : 503,
          response: failure,
        })
        if (streamStarted) {
          await writeBuilderSseEvent(reply, failure)
          reply.raw.end()
          return
        }
        return reply.code(503).send(failure)
      }
    },
  )

  server.get(
    "/api/builder/submissions",
    withPersona("builder"),
    async (request) =>
      builderSubmissionSchema
        .array()
        .parse(await getBuilderSubmissions(requireActor(request))),
  )

  server.post(
    "/api/admin/resources/:id/approve",
    withPersona("admin"),
    async (request, reply) => {
      const id = (request.params as { id?: string }).id
      if (!id) {
        return reply.code(400).send({
          type: "about:blank",
          title: "Resource id is required",
          status: 400,
        })
      }

      return withIdempotentMutation(
        request,
        reply,
        "POST /api/admin/resources/:id/approve",
        { id },
        async (actor) => {
          const submission = await approveBuilderResource(actor, id)
          if (!submission) {
            return lifecycleConflict("Resource is not pending approval.")
          }
          return {
            statusCode: 200,
            payload: builderSubmissionSchema.parse(submission),
          }
        },
      )
    },
  )

  server.post(
    "/api/admin/resources/:id/reject",
    withPersona("admin"),
    async (request, reply) => {
      const id = (request.params as { id?: string }).id
      const parsedBody = rejectBuilderResourceRequestSchema.safeParse(
        request.body ?? {},
      )
      if (!parsedBody.success) {
        return reply.code(400).send({
          type: "about:blank",
          title: "Invalid rejection request",
          status: 400,
          detail: "A rejection comment is required.",
        })
      }
      const body = parsedBody.data
      if (!id) {
        return reply.code(400).send({
          type: "about:blank",
          title: "Resource id is required",
          status: 400,
        })
      }

      return withIdempotentMutation(
        request,
        reply,
        "POST /api/admin/resources/:id/reject",
        { id, body },
        async (actor) => {
          const submission = await rejectBuilderResource(
            actor,
            id,
            body.comment,
          )
          if (!submission) {
            return lifecycleConflict("Resource is not pending rejection.")
          }
          return {
            statusCode: 200,
            payload: builderSubmissionSchema.parse(submission),
          }
        },
      )
    },
  )
}

function requireActor(request: FastifyRequest): Actor {
  if (!request.actor) {
    throw new Error("Authenticated actor is required.")
  }
  return request.actor
}

async function withIdempotentMutation(
  request: FastifyRequest,
  reply: FastifyReply,
  route: string,
  requestPayload: unknown,
  run: (actor: Actor) => Promise<{ statusCode: number; payload: unknown }>,
) {
  const actor = requireActor(request)
  const idempotencyKey = getHeaderValue(request, "idempotency-key")
  if (!idempotencyKey) {
    return reply.code(400).send({
      type: "about:blank",
      title: "Idempotency key is required",
      status: 400,
      detail: "Pass an Idempotency-Key header for lifecycle mutations.",
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
        "This Idempotency-Key was already used with a different lifecycle request.",
    })
  }
  if (reservation.status === "pending") {
    return reply.code(409).send({
      type: "about:blank",
      title: "Lifecycle mutation is still in progress",
      status: 409,
      detail:
        "This Idempotency-Key is already processing. Retry after the first request finishes.",
    })
  }

  const result = await run(actor)
  await completeIdempotency({
    storeKey: reservation.storeKey,
    requestHash,
    statusCode: result.statusCode,
    response: result.payload,
  })
  return reply.code(result.statusCode).send(result.payload)
}

function lifecycleConflict(detail: string) {
  return {
    statusCode: 409,
    payload: {
      type: "about:blank",
      title: "Lifecycle transition unavailable",
      status: 409,
      detail,
    },
  }
}

function writeSseHeaders(reply: FastifyReply): void {
  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    "Content-Encoding": "identity",
  })
}

async function writeBuilderSseEvent(
  reply: FastifyReply,
  event: BuilderAgentTestStreamEvent,
): Promise<void> {
  await writeWithBackpressure(
    reply,
    `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
  )
}

async function writeWithBackpressure(
  reply: FastifyReply,
  payload: string,
): Promise<void> {
  if (reply.raw.destroyed) {
    return
  }
  if (reply.raw.write(payload)) {
    return
  }

  await new Promise<void>((resolve, reject) => {
    reply.raw.once("drain", resolve)
    reply.raw.once("error", reject)
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
  return createHash("sha256").update(JSON.stringify(value)).digest("base64url")
}
