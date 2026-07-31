import { eq } from "drizzle-orm"
import type { Actor } from "../auth/persona"
import { getInferenceCoreDb } from "../db/inference-core-client"
import {
  humanIdentities,
  humanIdentityRoles,
} from "../db/inference-core-schema"

export async function upsertActorUser(actor: Actor): Promise<Actor> {
  const db = getInferenceCoreDb()
  if (!db) {
    return actor
  }

  const now = new Date()
  const projectedRoles = [
    ...new Set(
      actor.roles
        .map((role) => role.trim().toLowerCase())
        .filter((role) => role === "admin" || role === "operator"),
    ),
  ].sort()

  await db.transaction(async (transaction) => {
    await transaction
      .insert(humanIdentities)
      .values({
        subjectId: actor.subject,
        firstSeenAt: now,
        lastSeenAt: now,
      })
      .onConflictDoUpdate({
        target: humanIdentities.subjectId,
        set: {
          lastSeenAt: now,
        },
      })

    await transaction
      .delete(humanIdentityRoles)
      .where(eq(humanIdentityRoles.subjectId, actor.subject))

    if (projectedRoles.length > 0) {
      await transaction.insert(humanIdentityRoles).values(
        projectedRoles.map((role) => ({
          subjectId: actor.subject,
          role,
          observedAt: now,
        })),
      )
    }
  })

  return actor
}
