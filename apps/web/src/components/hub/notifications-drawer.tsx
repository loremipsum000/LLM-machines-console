"use client"

import { Bell } from "lucide-react"
import { useState } from "react"
import { hubNotificationSchema } from "@llm-machines/contracts"
import type { HubNotification } from "@llm-machines/contracts"
import { productCopy } from "@llm-machines/copy"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

interface NotificationsDrawerProps {
  notifications: HubNotification[]
}

export function NotificationsDrawer({
  notifications,
}: NotificationsDrawerProps) {
  const copy = productCopy.pages.hub.notificationsDrawer
  const [open, setOpen] = useState(false)
  const [pendingReadId, setPendingReadId] = useState<string | null>(null)
  const [readErrors, setReadErrors] = useState<Record<string, string>>({})
  const [notificationOverrides, setNotificationOverrides] = useState<
    Record<string, HubNotification>
  >({})
  const visibleNotifications = notifications.map(
    (notification) => notificationOverrides[notification.id] ?? notification,
  )
  const unreadNotifications = visibleNotifications.filter(
    (notification) => !notification.readAt,
  )
  const criticalCount = unreadNotifications.filter(
    (notification) => notification.severity === "critical",
  ).length

  return (
    <div className="relative">
      <Button
        aria-expanded={open}
        aria-label={copy.triggerLabel}
        onClick={() => setOpen((value) => !value)}
        variant="ghost"
      >
        <Bell aria-hidden className="size-4" />
        {criticalCount > 0 ? (
          <Badge tone="critical">{criticalCount}</Badge>
        ) : null}
      </Button>
      {open ? (
        <div className="absolute right-0 top-12 z-20 w-96 max-w-[calc(100vw-2rem)] rounded-lg border border-line-subtle bg-surface-1 p-3 shadow-xl">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">{copy.title}</h2>
            <Badge tone="neutral">
              {copy.unreadBadge(unreadNotifications.length)}
            </Badge>
          </div>
          <div className="space-y-2">
            {visibleNotifications.map((notification) => (
              <div
                className="rounded-md border border-line-subtle bg-surface-2 p-3"
                key={notification.id}
              >
                <div className="flex items-start justify-between gap-3">
                  <a
                    className="min-w-0 hover:text-accent"
                    href={notification.href ?? "/"}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <SeverityBadge severity={notification.severity} />
                      {!notification.readAt ? (
                        <Badge>{copy.unread}</Badge>
                      ) : null}
                      <p className="text-sm font-medium">
                        {notification.title}
                      </p>
                    </div>
                    <p className="mt-2 text-sm text-fg-muted">
                      {notification.body}
                    </p>
                  </a>
                  <Button
                    disabled={
                      Boolean(notification.readAt) ||
                      pendingReadId === notification.id
                    }
                    onClick={() => {
                      void markRead({
                        id: notification.id,
                        setNotificationOverrides,
                        setPendingReadId,
                        setReadErrors,
                      })
                    }}
                    variant="ghost"
                  >
                    {notification.readAt
                      ? copy.read
                      : pendingReadId === notification.id
                        ? copy.reading
                        : copy.markRead}
                  </Button>
                </div>
                {readErrors[notification.id] ? (
                  <p className="mt-2 text-sm text-critical" role="alert">
                    {readErrors[notification.id]}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function SeverityBadge({
  severity,
}: {
  severity: "info" | "warning" | "critical"
}) {
  const severityCopy = productCopy.pages.hub.severities
  if (severity === "critical") {
    return <Badge tone="critical">{severityCopy.critical}</Badge>
  }
  if (severity === "warning") {
    return <Badge tone="warning">{severityCopy.warning}</Badge>
  }
  return <Badge tone="info">{severityCopy.info}</Badge>
}

async function markRead({
  id,
  setNotificationOverrides,
  setPendingReadId,
  setReadErrors,
}: {
  id: string
  setNotificationOverrides: (
    update: (
      notifications: Record<string, HubNotification>,
    ) => Record<string, HubNotification>,
  ) => void
  setPendingReadId: (id: string | null) => void
  setReadErrors: (
    update: (errors: Record<string, string>) => Record<string, string>,
  ) => void
}) {
  setPendingReadId(id)
  setReadErrors((current) => {
    const next = { ...current }
    delete next[id]
    return next
  })

  try {
    const response = await fetch(
      `/api/hub/notifications/${encodeURIComponent(id)}/read`,
      {
        cache: "no-store",
        method: "PATCH",
      },
    )

    if (!response.ok) {
      throw new Error("Notification read request failed.")
    }

    const updatedNotification = hubNotificationSchema.parse(
      await response.json(),
    )
    setNotificationOverrides((current) => ({
      ...current,
      [updatedNotification.id]: updatedNotification,
    }))
  } catch {
    setReadErrors((current) => ({
      ...current,
      [id]: productCopy.pages.hub.notificationsDrawer.readFailure,
    }))
  } finally {
    setPendingReadId(null)
  }
}
