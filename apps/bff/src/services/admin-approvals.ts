import type {
  AdminApprovalQueueItem,
  AdminApprovalQueueResponse,
} from "@llm-machines/contracts"
import { personaCanAccess } from "@llm-machines/contracts"
import type { Actor } from "../auth/persona"
import { emitAudit } from "./audit"
import { getBuilderResources, getBuilderSubmissions } from "./builder"

export async function getAdminApprovalQueue(
  actor: Actor,
  filters: { query?: string } = {},
): Promise<AdminApprovalQueueResponse> {
  if (!personaCanAccess(actor.persona, "admin")) {
    throw new Error("Admin approval queue requires admin persona.")
  }

  const generatedAt = new Date().toISOString()
  const query = filters.query?.trim() || null
  const resources = await getBuilderResources(actor)
  const resourcesById = new Map(
    resources.map((resource) => [resource.id, resource]),
  )
  const pendingItems = (await getBuilderSubmissions(actor))
    .filter((submission) => submission.state === "submitted")
    .map((submission) => {
      const resource = resourcesById.get(submission.resourceId)
      if (!resource) {
        return null
      }
      return {
        id: submission.id,
        resourceId: resource.id,
        resourceName: resource.name,
        resourceType: resource.type,
        description: resource.description,
        ownerId: resource.ownerId,
        ownerName: resource.ownerName,
        submittedVersion: submission.submittedVersion,
        submittedAt: submission.submittedAt,
        updatedAt: resource.updatedAt,
        reviewHref: resource.href,
        auditHref: "#audit-log-deferred",
      } satisfies AdminApprovalQueueItem
    })
    .filter((item): item is AdminApprovalQueueItem => Boolean(item))
    .filter((item) => matchesApprovalQuery(item, query))
    .sort((left, right) => right.submittedAt.localeCompare(left.submittedAt))

  await emitAudit({
    actorId: actor.subject,
    action: "admin.approvals.read",
    targetType: "builder.submissions",
    targetId: "queue",
    metadata: {
      query,
      pendingCount: pendingItems.length,
    },
  })

  return {
    generatedAt,
    query,
    sourceStatus: "ok",
    pendingCount: pendingItems.length,
    items: pendingItems,
  }
}

function matchesApprovalQuery(
  item: AdminApprovalQueueItem,
  query: string | null,
): boolean {
  if (!query) {
    return true
  }
  const haystack = [
    item.resourceName,
    item.resourceType,
    item.description,
    item.ownerId,
    item.ownerName,
    item.submittedVersion,
  ]
    .join(" ")
    .toLowerCase()
  return haystack.includes(query.toLowerCase())
}
