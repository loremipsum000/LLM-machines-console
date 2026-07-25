"use client"

import { useEffect } from "react"
import { cn } from "@/lib/utils"

export type ConsoleActionToastTone =
  | "danger"
  | "neutral"
  | "success"
  | "warning"

export interface ConsoleActionToast {
  description?: string
  id: string
  title: string
  tone?: ConsoleActionToastTone
}

interface ConsoleActionToastsProps {
  autoDismissMs?: number
  notifications: ConsoleActionToast[]
}

const ONE_TIME_ACTION_QUERY_PARAMS = [
  "appAction",
  "inferenceAction",
  "knowledgeAction",
  "knowledgeUpload",
  "mcpAction",
  "settingsAction",
  "teamAction",
]

export function ConsoleActionToasts({
  autoDismissMs = 5000,
  notifications,
}: ConsoleActionToastsProps) {
  useEffect(() => {
    if (notifications.length === 0) {
      return
    }

    const url = new URL(window.location.href)
    let clearedActionState = false

    for (const param of ONE_TIME_ACTION_QUERY_PARAMS) {
      if (url.searchParams.has(param)) {
        url.searchParams.delete(param)
        clearedActionState = true
      }
    }

    if (clearedActionState) {
      window.history.replaceState(
        window.history.state,
        "",
        `${url.pathname}${url.search}${url.hash}`,
      )
    }
  }, [notifications.length])

  if (notifications.length === 0) {
    return null
  }

  return (
    <aside
      aria-label="Action notifications"
      className="pointer-events-none fixed right-4 top-4 z-[80] flex w-[min(360px,calc(100vw-32px))] flex-col gap-2"
    >
      {notifications.map((notification, index) => (
        <ConsoleActionToastCard
          autoDismissMs={autoDismissMs}
          index={index}
          key={notification.id}
          notification={notification}
        />
      ))}
    </aside>
  )
}

function ConsoleActionToastCard({
  autoDismissMs,
  index,
  notification,
}: {
  autoDismissMs: number
  index: number
  notification: ConsoleActionToast
}) {
  const tone = notification.tone ?? "neutral"

  return (
    <div
      aria-live={tone === "danger" ? "assertive" : "polite"}
      className={cn(
        "pointer-events-auto flex min-h-[72px] items-start gap-3 rounded-[12px] border border-[#353535] bg-[rgba(35,35,35,0.96)] px-4 py-3 text-[#fdfdfd] shadow-[0_18px_42px_rgba(0,0,0,0.42)] backdrop-blur motion-reduce:animate-none",
      )}
      role={tone === "danger" ? "alert" : "status"}
      style={{
        animationDelay: `${index * 80}ms`,
        animationDuration: `${autoDismissMs + 320}ms`,
        animationFillMode: "forwards",
        animationName: "console-action-toast-lifecycle",
        animationTimingFunction: "ease-out",
      }}
    >
      <span
        aria-hidden
        className={cn(
          "mt-1.5 size-2.5 shrink-0 rounded-full",
          tone === "success" && "bg-[#36c66f]",
          tone === "warning" && "bg-[#f59e0b]",
          tone === "danger" && "bg-[#ff595d]",
          tone === "neutral" && "bg-[#009fff]",
        )}
      />
      <span className="min-w-0">
        <span className="block text-sm font-semibold leading-[18px]">
          {notification.title}
        </span>
        {notification.description ? (
          <span className="mt-1 block text-sm font-medium leading-5 text-[#b2b2b2]">
            {notification.description}
          </span>
        ) : null}
      </span>
    </div>
  )
}
