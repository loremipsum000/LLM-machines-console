import { act, render, screen, waitFor } from "@testing-library/react"
import React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { LiveEventsIndicator } from "@/components/hub/live-events-indicator"

describe("LiveEventsIndicator", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it("uses a finite fetch snapshot when EventSource is unavailable", async () => {
    vi.stubGlobal("EventSource", undefined)
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("event: notification.created\n\nevent: task.updated\n\n", {
        status: 200,
      }),
    )

    render(<LiveEventsIndicator />)

    await waitFor(() => {
      expect(screen.getByLabelText("Hub events live")).toBeTruthy()
    })
    expect(fetchSpy).toHaveBeenCalledWith("/api/hub/events?once=true", {
      cache: "no-store",
    })
    expect(screen.getByText("2")).toBeTruthy()
  })

  it("renders live from the initial server snapshot", () => {
    class TestEventSource {
      addEventListener() {}
      close() {}
    }
    vi.stubGlobal("EventSource", TestEventSource)

    render(<LiveEventsIndicator initialEventCount={7} />)

    expect(screen.getByLabelText("Hub events live")).toBeTruthy()
    expect(screen.getByText("7")).toBeTruthy()
  })

  it("counts notification read events from native EventSource", async () => {
    const listeners = new Map<string, () => void>()
    class TestEventSource {
      addEventListener(type: string, listener: () => void) {
        listeners.set(type, listener)
      }
      close() {}
    }
    vi.stubGlobal("EventSource", TestEventSource)

    render(<LiveEventsIndicator />)
    act(() => {
      listeners.get("notification.read")?.()
    })

    await waitFor(() => {
      expect(screen.getByLabelText("Hub events live")).toBeTruthy()
    })
    expect(screen.getByText("1")).toBeTruthy()
  })

  it("falls back to finite fetch polling when native EventSource errors", async () => {
    let onerror: (() => void) | undefined
    class TestEventSource {
      onerror: (() => void) | undefined
      constructor() {
        onerror = () => this.onerror?.()
      }
      addEventListener() {}
      close() {}
    }
    vi.stubGlobal("EventSource", TestEventSource)
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("event: resource.lifecycle\n\n", { status: 200 }),
    )

    render(<LiveEventsIndicator />)
    onerror?.()

    await waitFor(() => {
      expect(screen.getByLabelText("Hub events live")).toBeTruthy()
    })
    expect(screen.getByText("1")).toBeTruthy()
  })
})
