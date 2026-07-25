import { afterEach, describe, expect, it, vi } from "vitest"
import type { Actor } from "../auth/persona"
import {
  publishHubEvent,
  resetHubEventFanoutForTest,
  subscribeHubEvents,
} from "./hub-events"

const redisMock = vi.hoisted(() => {
  const instances: Array<{
    channels: string[]
    handlers: Record<string, (channel: string, message: string) => void>
    publish: ReturnType<typeof vi.fn>
    emitMessage: (channel: string, message: string) => void
  }> = []

  class RedisMock {
    status = "wait"
    channels: string[] = []
    handlers: Record<string, (channel: string, message: string) => void> = {}
    connect = vi.fn(async () => {
      this.status = "ready"
    })
    publish = vi.fn(async () => 1)
    subscribe = vi.fn(async (...channels: string[]) => {
      this.status = "ready"
      this.channels = channels
      return channels.length
    })
    disconnect = vi.fn(() => {
      this.status = "end"
    })
    on = vi.fn(
      (event: string, handler: (channel: string, message: string) => void) => {
        this.handlers[event] = handler
        return this
      },
    )

    constructor() {
      instances.push(this)
    }

    emitMessage(channel: string, message: string): void {
      this.handlers.message?.(channel, message)
    }
  }

  return { instances, RedisMock }
})

vi.mock("ioredis", () => ({
  default: redisMock.RedisMock,
}))

const actor: Actor = {
  authMode: "service-forwarded",
  email: "user@example.test",
  persona: "consumer",
  roles: ["consumer"],
  subject: "user-1",
}

const event = {
  createdAt: "2026-05-20T12:00:00.000Z",
  id: "11111111-1111-4111-8111-111111111111",
  payload: {
    notificationId: "11111111-1111-4111-8111-111111111111",
  },
  resourceId: "11111111-1111-4111-8111-111111111111",
  type: "notification.read",
} as const

describe("Hub event fanout", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    resetHubEventFanoutForTest()
    redisMock.instances.length = 0
  })

  it("publishes live events to the configured Redis channel", async () => {
    vi.stubEnv("REDIS_URL", "redis://localhost:6379")
    vi.stubEnv("HUB_EVENT_CHANNEL", "hub:test")

    await publishHubEvent(actor, event)

    expect(redisMock.instances).toHaveLength(1)
    expect(redisMock.instances[0]?.publish).toHaveBeenCalledTimes(1)
    expect(redisMock.instances[0]?.publish).toHaveBeenCalledWith(
      "hub:test",
      expect.any(String),
    )
    expect(
      JSON.parse(redisMock.instances[0]?.publish.mock.calls[0]?.[1] as string),
    ).toMatchObject({
      event,
      listenerKey: "user-1",
    })
  })

  it("delivers valid cross-process Redis messages to same-actor subscribers", () => {
    vi.stubEnv("REDIS_URL", "redis://localhost:6379")
    vi.stubEnv("HUB_EVENT_CHANNEL", "hub:test")
    const receivedEvents: string[] = []

    const unsubscribe = subscribeHubEvents(actor, (receivedEvent) => {
      receivedEvents.push(receivedEvent.type)
    })

    redisMock.instances[0]?.emitMessage(
      "hub:test",
      JSON.stringify({
        event,
        listenerKey: "user-1",
        originId: "another-bff-process",
      }),
    )

    expect(receivedEvents).toEqual(["notification.read"])
    unsubscribe()
  })
})
