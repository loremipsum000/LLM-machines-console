import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"
import * as schema from "./schema"

let client: ReturnType<typeof postgres> | null = null
let database: ReturnType<typeof drizzle<typeof schema>> | null = null

export function getDb(): ReturnType<typeof drizzle<typeof schema>> | null {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    return null
  }

  if (!client) {
    client = postgres(databaseUrl, { max: 5 })
    database = drizzle(client, { schema })
  }

  return database
}

export async function closeDb(): Promise<void> {
  if (client) {
    await client.end({ timeout: 1 })
    client = null
    database = null
  }
}
