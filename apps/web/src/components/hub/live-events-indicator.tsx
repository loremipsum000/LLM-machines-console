"use client"

import { Activity } from "lucide-react"
import { useEffect, useState } from "react"
import { productCopy } from "@llm-machines/copy"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

type LiveStatus = "connecting" | "live" | "offline"

interface LiveEventsIndicatorProps {
  initialEventCount?: number
}

export function LiveEventsIndicator({
  initialEventCount = 0,
}: LiveEventsIndicatorProps) {
  const [status, setStatus] = useState<LiveStatus>(
    initialEventCount > 0 ? "live" : "connecting",
  )
  const [eventCount, setEventCount] = useState(initialEventCount)

  useEffect(() => {
    let closed = false
    let pollTimer: ReturnType<typeof setTimeout> | undefined

    const markLive = (count = 1) => {
      if (closed) {
        return
      }
      setStatus("live")
      setEventCount((currentCount) => currentCount + count)
    }

    const markSnapshotLive = (count: number) => {
      if (closed) {
        return
      }
      setStatus("live")
      setEventCount((currentCount) => Math.max(currentCount, count))
    }

    const markOffline = () => {
      if (!closed) {
        setStatus("offline")
      }
    }

    const startPollingFallback = () => {
      const poll = async () => {
        const count = await fetchEventSnapshotCount()
        if (count > 0) {
          markSnapshotLive(count)
        } else {
          markOffline()
        }

        if (!closed) {
          pollTimer = setTimeout(poll, 30000)
        }
      }

      void poll()
    }

    if (typeof EventSource === "undefined") {
      pollTimer = setTimeout(startPollingFallback, 0)
      return () => {
        closed = true
        if (pollTimer) {
          clearTimeout(pollTimer)
        }
      }
    }

    const events = new EventSource("/api/hub/events")
    const markNativeLive = () => markLive()

    events.addEventListener("notification.created", markNativeLive)
    events.addEventListener("notification.read", markNativeLive)
    events.addEventListener("task.updated", markNativeLive)
    events.addEventListener("artifact.created", markNativeLive)
    events.addEventListener("resource.lifecycle", markNativeLive)
    events.onerror = () => {
      events.close()
      startPollingFallback()
    }

    return () => {
      closed = true
      events.close()
      if (pollTimer) {
        clearTimeout(pollTimer)
      }
    }
  }, [])

  return (
    <div
      aria-label={productCopy.pages.hub.liveEvents.ariaLabel(status)}
      className="hidden items-center gap-2 rounded-md border border-line-subtle bg-surface-1 px-3 py-2 text-xs text-fg-muted lg:flex"
    >
      <Activity
        aria-hidden
        className={cn(
          "size-4",
          status === "live" && "text-accent",
          status === "offline" && "text-critical",
        )}
      />
      <span className="capitalize">
        {productCopy.pages.hub.liveEvents[status]}
      </span>
      {eventCount > 0 ? <Badge tone="info">{eventCount}</Badge> : null}
    </div>
  )
}

async function fetchEventSnapshotCount(): Promise<number> {
  try {
    const response = await fetch("/api/hub/events?once=true", {
      cache: "no-store",
    })
    if (!response.ok) {
      return 0
    }

    return countEventFrames(await response.text())
  } catch {
    return 0
  }
}

function countEventFrames(streamText: string): number {
  return streamText.match(/^event: /gm)?.length ?? 0
}
