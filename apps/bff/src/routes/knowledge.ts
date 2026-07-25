import { createHash } from "node:crypto"
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import {
  addKnowledgeUploadSourceRequestSchema,
  addKnowledgeUrlSourceRequestSchema,
  createKnowledgeCorpusRequestSchema,
  hardDeleteKnowledgeCorpusRequestSchema,
  knowledgeActionResponseSchema,
  knowledgeArchiveSourceBulkActionRequestSchema,
  knowledgeArchiveSourceListResponseSchema,
  knowledgeCorpusDetailResponseSchema,
  knowledgeCorpusListResponseSchema,
  knowledgeQueryRequestSchema,
  knowledgeQueryResultSchema,
  knowledgeSourceBulkActionRequestSchema,
  updateKnowledgeCorpusAccessRequestSchema,
} from "@llm-machines/contracts"
import type { Actor } from "../auth/persona"
import { withPersona } from "../auth/persona"
import {
  addKnowledgeUploadSource,
  addKnowledgeUrlSource,
  archiveKnowledgeCorpus,
  bulkApplyKnowledgeArchiveSourceAction,
  bulkApplyKnowledgeSourceAction,
  createKnowledgeCorpus,
  disableKnowledgeCorpus,
  discardKnowledgeSnapshot,
  getKnowledgeCorpusDetail,
  hardDeleteKnowledgeCorpus,
  listKnowledgeArchivedSources,
  listKnowledgeCorpora,
  publishKnowledgeSnapshot,
  refreshKnowledgeCorpus,
  retryKnowledgeSource,
  startKnowledgeIngestion,
  testKnowledgeRetrieval,
  updateKnowledgeCorpusAccess,
  type KnowledgeMutationResult,
} from "../services/knowledge/admin"
import {
  completeIdempotency,
  reserveIdempotency,
} from "../services/idempotency"

export function registerKnowledgeRoutes(server: FastifyInstance): void {
  server.get(
    "/api/admin/knowledge/corpora",
    withPersona("admin"),
    async (request) =>
      knowledgeCorpusListResponseSchema.parse(
        await listKnowledgeCorpora(requireActor(request)),
      ),
  )

  server.get(
    "/api/admin/knowledge/archive/sources",
    withPersona("admin"),
    async (request) =>
      knowledgeArchiveSourceListResponseSchema.parse(
        await listKnowledgeArchivedSources(requireActor(request)),
      ),
  )

  server.post(
    "/api/admin/knowledge/archive/sources/bulk-action",
    withPersona("admin"),
    async (request, reply) => {
      const parsed = knowledgeArchiveSourceBulkActionRequestSchema.safeParse(
        request.body ?? {},
      )
      if (!parsed.success) {
        return invalid(reply, "Invalid archive source action request")
      }
      return withMutationResult(
        request,
        reply,
        "POST /api/admin/knowledge/archive/sources/bulk-action",
        parsed.data,
        (actor) => bulkApplyKnowledgeArchiveSourceAction(actor, parsed.data),
      )
    },
  )

  server.post(
    "/api/admin/knowledge/corpora",
    withPersona("admin"),
    async (request, reply) => {
      const parsed = createKnowledgeCorpusRequestSchema.safeParse(
        request.body ?? {},
      )
      if (!parsed.success) {
        return invalid(reply, "Invalid corpus create request")
      }

      return withKnowledgeMutation(
        request,
        reply,
        "POST /api/admin/knowledge/corpora",
        parsed.data,
        async (actor) => ({
          statusCode: 201,
          payload: knowledgeActionResponseSchema.parse(
            await createKnowledgeCorpus(actor, parsed.data),
          ),
        }),
      )
    },
  )

  server.get(
    "/api/admin/knowledge/corpora/:id",
    withPersona("admin"),
    async (request, reply) => {
      const id = getParam(request, "id")
      const detail = await getKnowledgeCorpusDetail(requireActor(request), id)
      if (!detail) {
        return notFound(reply, "Corpus not found")
      }
      return knowledgeCorpusDetailResponseSchema.parse(detail)
    },
  )

  server.post(
    "/api/admin/knowledge/corpora/:id/sources/url",
    withPersona("admin"),
    async (request, reply) => {
      const id = getParam(request, "id")
      const parsed = addKnowledgeUrlSourceRequestSchema.safeParse(
        request.body ?? {},
      )
      if (!parsed.success) {
        return invalid(reply, "Invalid URL source request")
      }
      return withMutationResult(
        request,
        reply,
        "POST /api/admin/knowledge/corpora/:id/sources/url",
        { id, body: parsed.data },
        (actor) => addKnowledgeUrlSource(actor, id, parsed.data),
      )
    },
  )

  server.post(
    "/api/admin/knowledge/corpora/:id/sources/upload",
    withPersona("admin"),
    async (request, reply) => {
      const id = getParam(request, "id")
      const parsed = addKnowledgeUploadSourceRequestSchema.safeParse(
        request.body ?? {},
      )
      if (!parsed.success) {
        return invalid(reply, "Invalid upload source request")
      }
      return withMutationResult(
        request,
        reply,
        "POST /api/admin/knowledge/corpora/:id/sources/upload",
        { id, body: parsed.data },
        (actor) => addKnowledgeUploadSource(actor, id, parsed.data),
      )
    },
  )

  server.post(
    "/api/admin/knowledge/corpora/:id/ingest",
    withPersona("admin"),
    async (request, reply) => {
      const id = getParam(request, "id")
      return withMutationResult(
        request,
        reply,
        "POST /api/admin/knowledge/corpora/:id/ingest",
        { id },
        (actor) => startKnowledgeIngestion(actor, id),
      )
    },
  )

  server.post(
    "/api/admin/knowledge/corpora/:id/snapshots/:snapshotId/publish",
    withPersona("admin"),
    async (request, reply) => {
      const id = getParam(request, "id")
      const snapshotId = getParam(request, "snapshotId")
      return withMutationResult(
        request,
        reply,
        "POST /api/admin/knowledge/corpora/:id/snapshots/:snapshotId/publish",
        { id, snapshotId },
        (actor) => publishKnowledgeSnapshot(actor, id, snapshotId),
      )
    },
  )

  server.post(
    "/api/admin/knowledge/corpora/:id/snapshots/:snapshotId/discard",
    withPersona("admin"),
    async (request, reply) => {
      const id = getParam(request, "id")
      const snapshotId = getParam(request, "snapshotId")
      return withMutationResult(
        request,
        reply,
        "POST /api/admin/knowledge/corpora/:id/snapshots/:snapshotId/discard",
        { id, snapshotId },
        (actor) => discardKnowledgeSnapshot(actor, id, snapshotId),
      )
    },
  )

  server.post(
    "/api/admin/knowledge/corpora/:id/sources/:sourceId/retry",
    withPersona("admin"),
    async (request, reply) => {
      const id = getParam(request, "id")
      const sourceId = getParam(request, "sourceId")
      return withMutationResult(
        request,
        reply,
        "POST /api/admin/knowledge/corpora/:id/sources/:sourceId/retry",
        { id, sourceId },
        (actor) => retryKnowledgeSource(actor, id, sourceId),
      )
    },
  )

  server.post(
    "/api/admin/knowledge/corpora/:id/sources/bulk-action",
    withPersona("admin"),
    async (request, reply) => {
      const id = getParam(request, "id")
      const parsed = knowledgeSourceBulkActionRequestSchema.safeParse(
        request.body ?? {},
      )
      if (!parsed.success) {
        return invalid(reply, "Invalid source bulk action request")
      }
      return withMutationResult(
        request,
        reply,
        "POST /api/admin/knowledge/corpora/:id/sources/bulk-action",
        { id, body: parsed.data },
        (actor) => bulkApplyKnowledgeSourceAction(actor, id, parsed.data),
      )
    },
  )

  server.post(
    "/api/admin/knowledge/corpora/:id/access",
    withPersona("admin"),
    async (request, reply) => {
      const id = getParam(request, "id")
      const parsed = updateKnowledgeCorpusAccessRequestSchema.safeParse(
        request.body ?? {},
      )
      if (!parsed.success) {
        return invalid(reply, "Invalid corpus access update request")
      }
      return withMutationResult(
        request,
        reply,
        "POST /api/admin/knowledge/corpora/:id/access",
        { id, body: parsed.data },
        (actor) => updateKnowledgeCorpusAccess(actor, id, parsed.data),
      )
    },
  )

  server.post(
    "/api/admin/knowledge/corpora/:id/hard-delete",
    withPersona("admin"),
    async (request, reply) => {
      const id = getParam(request, "id")
      const parsed = hardDeleteKnowledgeCorpusRequestSchema.safeParse(
        request.body ?? {},
      )
      if (!parsed.success) {
        return invalid(reply, "Invalid corpus hard delete request")
      }
      return withMutationResult(
        request,
        reply,
        "POST /api/admin/knowledge/corpora/:id/hard-delete",
        { id, body: parsed.data },
        (actor) => hardDeleteKnowledgeCorpus(actor, id, parsed.data),
      )
    },
  )

  server.post(
    "/api/admin/knowledge/corpora/:id/retrieval-test",
    withPersona("admin"),
    async (request, reply) => {
      const parsed = knowledgeQueryRequestSchema.safeParse(request.body ?? {})
      if (!parsed.success) {
        return invalid(reply, "Invalid retrieval test request")
      }
      return knowledgeQueryResultSchema.parse(
        await testKnowledgeRetrieval(requireActor(request), parsed.data),
      )
    },
  )

  server.post(
    "/api/admin/knowledge/corpora/:id/refresh",
    withPersona("admin"),
    async (request, reply) => {
      const id = getParam(request, "id")
      return withMutationResult(
        request,
        reply,
        "POST /api/admin/knowledge/corpora/:id/refresh",
        { id },
        (actor) => refreshKnowledgeCorpus(actor, id),
      )
    },
  )

  server.post(
    "/api/admin/knowledge/corpora/:id/disable",
    withPersona("admin"),
    async (request, reply) => {
      const id = getParam(request, "id")
      return withMutationResult(
        request,
        reply,
        "POST /api/admin/knowledge/corpora/:id/disable",
        { id },
        (actor) => disableKnowledgeCorpus(actor, id),
      )
    },
  )

  server.post(
    "/api/admin/knowledge/corpora/:id/archive",
    withPersona("admin"),
    async (request, reply) => {
      const id = getParam(request, "id")
      return withMutationResult(
        request,
        reply,
        "POST /api/admin/knowledge/corpora/:id/archive",
        { id },
        (actor) => archiveKnowledgeCorpus(actor, id),
      )
    },
  )
}

async function withMutationResult(
  request: FastifyRequest,
  reply: FastifyReply,
  route: string,
  requestPayload: unknown,
  run: (actor: Actor) => Promise<KnowledgeMutationResult>,
) {
  return withKnowledgeMutation(
    request,
    reply,
    route,
    requestPayload,
    async (actor) => {
      const result = await run(actor)
      if (result.status === "not_found") {
        return {
          statusCode: 404,
          payload: problem(404, result.detail),
        }
      }
      if (result.status === "invalid") {
        return {
          statusCode: 409,
          payload: problem(409, result.detail),
        }
      }
      return {
        statusCode: 200,
        payload: knowledgeActionResponseSchema.parse(result.response),
      }
    },
  )
}

async function withKnowledgeMutation(
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
    return reply.code(409).send(problem(409, "Idempotency key conflict."))
  }
  if (reservation.status === "pending") {
    return reply.code(409).send(problem(409, "Mutation is still in progress."))
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

function getParam(request: FastifyRequest, name: string): string {
  const params =
    typeof request.params === "object" && request.params !== null
      ? (request.params as Record<string, unknown>)
      : {}
  const value = params[name]
  return typeof value === "string" ? value : ""
}

function invalid(reply: FastifyReply, title: string) {
  return reply.code(400).send(problem(400, title))
}

function notFound(reply: FastifyReply, title: string) {
  return reply.code(404).send(problem(404, title))
}

function problem(status: number, title: string) {
  return {
    type: "about:blank",
    title,
    status,
  }
}

function requireActor(request: FastifyRequest): Actor {
  if (!request.actor) {
    throw new Error("Authenticated route executed without an actor.")
  }
  return request.actor
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
