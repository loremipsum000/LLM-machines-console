import { eq } from "drizzle-orm"
import type { Actor } from "../auth/authorization"
import {
  type InferenceCoreTransaction,
  getInferenceCoreDb,
} from "../db/inference-core-client"
import {
  humanIdentities,
  humanIdentityRoles,
} from "../db/inference-core-schema"

export async function upsertActorUser(
  actor: Actor,
  transaction?: InferenceCoreTransaction,
): Promise<Actor> {
  const db = getInferenceCoreDb()
  if (!transaction && !db) {
    return actor
  }

  const now = new Date()
  const projectedRoles = [actor.role]

  const upsert = async (executor: InferenceCoreTransaction) => {
    await executor
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

    await executor
      .delete(humanIdentityRoles)
      .where(eq(humanIdentityRoles.subjectId, actor.subject))

    if (projectedRoles.length > 0) {
      await executor.insert(humanIdentityRoles).values(
        projectedRoles.map((role) => ({
          subjectId: actor.subject,
          role,
          observedAt: now,
        })),
      )
    }
  }

  if (transaction) {
    await upsert(transaction)
  } else if (db) {
    await db.transaction(upsert)
  }

  return actor
}
