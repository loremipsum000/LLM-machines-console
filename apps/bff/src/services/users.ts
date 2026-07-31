import { eq, sql } from "drizzle-orm"
import type { Actor } from "../auth/persona"
import { getInferenceCoreDb } from "../db/inference-core-client"
import { users } from "../db/inference-core-schema"

export async function upsertActorUser(actor: Actor): Promise<Actor> {
  const db = getInferenceCoreDb()
  if (!db) {
    return actor
  }

  const now = new Date()
  const email = actor.email ?? `${actor.subject}@local.invalid`
  const displayName = actor.email ?? actor.subject

  if (actor.email) {
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, actor.email))
      .limit(1)

    if (existing[0] && existing[0].id !== actor.subject) {
      await db
        .update(users)
        .set({
          displayName,
          persona: actor.persona,
          updatedAt: now,
        })
        .where(eq(users.id, existing[0].id))

      await db
        .insert(users)
        .values({
          id: actor.subject,
          email: `${actor.subject}@local.invalid`,
          displayName,
          persona: actor.persona,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: users.id,
          set: {
            displayName,
            persona: actor.persona,
            updatedAt: now,
          },
        })

      return {
        ...actor,
        subject: existing[0].id,
      }
    }
  }

  await db
    .insert(users)
    .values({
      id: actor.subject,
      email,
      displayName,
      persona: actor.persona,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: users.id,
      set: {
        email: sql`excluded.email`,
        displayName: sql`excluded.display_name`,
        persona: sql`excluded.persona`,
        updatedAt: now,
      },
    })

  return actor
}
