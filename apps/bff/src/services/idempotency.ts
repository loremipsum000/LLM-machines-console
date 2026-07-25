import Redis from "ioredis"

interface IdempotencyRecord {
  requestHash: string
  status: "pending" | "completed"
  response?: unknown
  statusCode?: number
}

const ttlSeconds = 24 * 60 * 60
const memoryStore = new Map<string, IdempotencyRecord>()
let redis: Redis | null = null

function getRedis(): Redis | null {
  const redisUrl = process.env.REDIS_URL
  if (!redisUrl) {
    return null
  }

  redis ??= new Redis(redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  })
  return redis
}

export async function reserveIdempotency(input: {
  actorId: string
  route: string
  idempotencyKey: string
  requestHash: string
}): Promise<
  | { status: "reserved"; storeKey: string }
  | { status: "replay"; response: unknown; statusCode: number }
  | { status: "conflict" }
  | { status: "pending" }
> {
  const storeKey = buildStoreKey(input)
  const candidate: IdempotencyRecord = {
    requestHash: input.requestHash,
    status: "pending",
  }

  const redisClient = getRedis()
  if (redisClient) {
    await redisClient.connect().catch(() => undefined)
    const existing = await redisClient.get(storeKey)
    if (existing) {
      return parseExisting(existing, input.requestHash)
    }

    await redisClient.set(storeKey, JSON.stringify(candidate), "EX", ttlSeconds)
    return { status: "reserved", storeKey }
  }

  const existing = memoryStore.get(storeKey)
  if (existing) {
    return recordToResult(existing, input.requestHash)
  }

  memoryStore.set(storeKey, candidate)
  return { status: "reserved", storeKey }
}

export async function completeIdempotency(input: {
  storeKey: string
  requestHash: string
  statusCode: number
  response: unknown
}): Promise<void> {
  const record: IdempotencyRecord = {
    requestHash: input.requestHash,
    status: "completed",
    statusCode: input.statusCode,
    response: input.response,
  }

  const redisClient = getRedis()
  if (redisClient) {
    await redisClient.set(
      input.storeKey,
      JSON.stringify(record),
      "EX",
      ttlSeconds,
    )
    return
  }

  memoryStore.set(input.storeKey, record)
}

export function resetIdempotencyForTest(): void {
  memoryStore.clear()
}

function buildStoreKey(input: {
  actorId: string
  route: string
  idempotencyKey: string
}): string {
  return `idempotency:${input.actorId}:${input.route}:${input.idempotencyKey}`
}

function parseExisting(
  value: string,
  requestHash: string,
): ReturnType<typeof recordToResult> {
  try {
    return recordToResult(JSON.parse(value) as IdempotencyRecord, requestHash)
  } catch {
    return { status: "conflict" }
  }
}

function recordToResult(
  record: IdempotencyRecord,
  requestHash: string,
):
  | { status: "replay"; response: unknown; statusCode: number }
  | { status: "conflict" }
  | { status: "pending" } {
  if (record.requestHash !== requestHash) {
    return { status: "conflict" }
  }
  if (record.status !== "completed") {
    return { status: "pending" }
  }
  return {
    status: "replay",
    response: record.response,
    statusCode: record.statusCode ?? 200,
  }
}
