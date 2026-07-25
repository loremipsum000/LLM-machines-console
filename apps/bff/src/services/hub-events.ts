import { randomUUID } from "node:crypto"
import Redis from "ioredis"
import type { HubEvent } from "@llm-machines/contracts"
import { hubEventSchema } from "@llm-machines/contracts"
import type { Actor } from "../auth/persona"

interface HubEventEnvelope {
  event: HubEvent
  listenerKey: string
  originId: string
}

const processFanoutId = randomUUID()
const hubEventListeners = new Map<string, Set<(event: HubEvent) => void>>()
let redisPublisher: Redis | null = null
let redisSubscriber: Redis | null = null
let redisSubscriberChannel: string | null = null

export function subscribeHubEvents(
  actor: Actor,
  listener: (event: HubEvent) => void,
): () => void {
  const key = hubEventListenerKey(actor)
  let listeners = hubEventListeners.get(key)
  if (!listeners) {
    listeners = new Set()
    hubEventListeners.set(key, listeners)
  }

  listeners.add(listener)
  ensureRedisSubscriber()

  return () => {
    listeners?.delete(listener)
    if (listeners?.size === 0) {
      hubEventListeners.delete(key)
    }
  }
}

export async function publishHubEvent(
  actor: Actor,
  event: HubEvent,
): Promise<void> {
  const listenerKey = hubEventListenerKey(actor)
  deliverLocalEvent(listenerKey, event)

  const publisher = getRedisPublisher()
  if (!publisher) {
    return
  }

  try {
    await connectRedis(publisher)
    await publisher.publish(
      getHubEventChannel(),
      JSON.stringify({
        event,
        listenerKey,
        originId: processFanoutId,
      } satisfies HubEventEnvelope),
    )
  } catch {
    // Local delivery and snapshot recovery are still valid if live Redis fanout is unavailable.
  }
}

export function resetHubEventFanoutForTest(): void {
  hubEventListeners.clear()
  redisPublisher?.disconnect()
  redisSubscriber?.disconnect()
  redisPublisher = null
  redisSubscriber = null
  redisSubscriberChannel = null
}

function deliverLocalEvent(listenerKey: string, event: HubEvent): void {
  const listeners = hubEventListeners.get(listenerKey)
  if (!listeners) {
    return
  }

  for (const listener of listeners) {
    listener(event)
  }
}

function ensureRedisSubscriber(): void {
  const redisUrl = process.env.REDIS_URL
  if (!redisUrl) {
    return
  }

  const channel = getHubEventChannel()
  if (redisSubscriber && redisSubscriberChannel === channel) {
    return
  }

  redisSubscriber?.disconnect()
  redisSubscriber = new Redis(redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  })
  redisSubscriberChannel = channel
  redisSubscriber.on("message", (receivedChannel, message) => {
    if (receivedChannel !== channel) {
      return
    }
    const envelope = parseHubEventEnvelope(message)
    if (!envelope || envelope.originId === processFanoutId) {
      return
    }
    deliverLocalEvent(envelope.listenerKey, envelope.event)
  })
  void redisSubscriber.subscribe(channel).catch(() => undefined)
}

function getRedisPublisher(): Redis | null {
  const redisUrl = process.env.REDIS_URL
  if (!redisUrl) {
    return null
  }

  redisPublisher ??= new Redis(redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  })
  return redisPublisher
}

async function connectRedis(client: Redis): Promise<void> {
  if (client.status === "wait") {
    await client.connect()
  }
}

function parseHubEventEnvelope(message: string): HubEventEnvelope | null {
  try {
    const parsed = JSON.parse(message) as Partial<HubEventEnvelope>
    if (
      typeof parsed.listenerKey !== "string" ||
      typeof parsed.originId !== "string"
    ) {
      return null
    }

    return {
      event: hubEventSchema.parse(parsed.event),
      listenerKey: parsed.listenerKey,
      originId: parsed.originId,
    }
  } catch {
    return null
  }
}

function getHubEventChannel(): string {
  return process.env.HUB_EVENT_CHANNEL ?? "hub:events"
}

function hubEventListenerKey(actor: Actor): string {
  return actor.subject
}
