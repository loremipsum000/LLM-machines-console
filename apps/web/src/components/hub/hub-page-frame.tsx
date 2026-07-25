import type { ReactNode } from "react"
import type { HubHomeResponse } from "@llm-machines/contracts"
import { productCopy } from "@llm-machines/copy"
import { CommandPalette } from "@/components/hub/command-palette"
import { HubNavigation } from "@/components/hub/hub-navigation"
import { LiveEventsIndicator } from "@/components/hub/live-events-indicator"
import { NotificationsDrawer } from "@/components/hub/notifications-drawer"
import { ProfileMenu } from "@/components/hub/profile-menu"

interface HubPageFrameProps {
  children: ReactNode
  home: HubHomeResponse
}

export function HubPageFrame({ children, home }: HubPageFrameProps) {
  const resourceModule = home.modules.find(
    (module) => module.type === "resources",
  )
  const notificationModule = home.modules.find(
    (module) => module.type === "notifications",
  )
  const workbenchModule = home.modules.find(
    (module) => module.type === "developer_workbench",
  )
  const resources =
    resourceModule?.type === "resources" ? resourceModule.resources : []
  const notifications =
    notificationModule?.type === "notifications"
      ? notificationModule.notifications
      : []
  const tasks =
    workbenchModule?.type === "developer_workbench" ? workbenchModule.tasks : []
  const artifacts =
    workbenchModule?.type === "developer_workbench"
      ? workbenchModule.artifacts
      : []
  const initialEventCount =
    notifications.length +
    tasks.length +
    artifacts.length +
    resources.filter((resource) => resource.type === "mcp_connector").length

  return (
    <div className="min-h-screen bg-surface-0 text-fg-default">
      <div className="grid min-h-screen grid-cols-[76px_minmax(0,1fr)]">
        <aside
          aria-label={productCopy.pages.hub.landmarks.primaryNavigation}
          className="border-line-subtle border-r bg-surface-1 px-3 py-4"
        >
          <HubNavigation capabilities={home.capabilities} />
        </aside>

        <div className="flex min-w-0 flex-col">
          <header className="border-line-subtle flex h-16 items-center gap-4 border-b bg-surface-0 px-5">
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase text-accent">
                {productCopy.pages.hub.eyebrow}
              </p>
              <h1 className="truncate text-lg font-semibold">
                {productCopy.pages.hub.title}
              </h1>
            </div>
            <CommandPalette
              artifacts={artifacts}
              resources={resources}
              tasks={tasks}
            />
            <LiveEventsIndicator initialEventCount={initialEventCount} />
            <NotificationsDrawer notifications={notifications} />
            <ProfileMenu
              capabilities={home.capabilities}
              persona={home.persona}
            />
          </header>

          <main className="min-h-0 flex-1 overflow-auto p-6">{children}</main>
        </div>
      </div>
    </div>
  )
}
