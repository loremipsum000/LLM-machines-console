"use client"

import {
  Activity,
  Boxes,
  Code2,
  Hammer,
  Home,
  MessageSquare,
  Shield,
  UserRound,
} from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import type { ReactNode } from "react"
import type { HubCapability } from "@llm-machines/contracts"
import { productCopy } from "@llm-machines/copy"
import { cn } from "@/lib/utils"

interface HubNavigationProps {
  capabilities: HubCapability[]
}

export function HubNavigation({ capabilities }: HubNavigationProps) {
  const pathname = usePathname()
  const items = getNavigationItems(capabilities)

  return (
    <nav
      aria-label={productCopy.pages.hub.navigation.ariaLabel}
      className="flex flex-col gap-2"
    >
      {items.map((item) => (
        <RailLink
          active={
            item.href === "/"
              ? pathname === "/"
              : pathname === item.href || pathname.startsWith(`${item.href}/`)
          }
          href={item.href}
          icon={item.icon}
          key={item.href}
          label={item.label}
        />
      ))}
    </nav>
  )
}

function getNavigationItems(capabilities: HubCapability[]) {
  const navigationCopy = productCopy.pages.hub.navigation
  const canUseWorkbench =
    capabilities.includes("developer_workbench") ||
    capabilities.includes("task_sessions")
  const canUseBuilder = capabilities.includes("builder_status")
  const canUseAdmin = capabilities.includes("admin_summary")

  return [
    { href: "/", label: navigationCopy.home, icon: <Home aria-hidden /> },
    {
      href: "/chat",
      label: navigationCopy.chat,
      icon: <MessageSquare aria-hidden />,
    },
    {
      href: "/resources",
      label: navigationCopy.resources,
      icon: <Boxes aria-hidden />,
    },
    ...(canUseWorkbench
      ? [
          {
            href: "/tasks",
            label: navigationCopy.tasks,
            icon: <Code2 aria-hidden />,
          },
        ]
      : []),
    {
      href: "/usage",
      label: navigationCopy.usage,
      icon: <Activity aria-hidden />,
    },
    {
      href: "/profile",
      label: navigationCopy.profile,
      icon: <UserRound aria-hidden />,
    },
    ...(canUseBuilder
      ? [
          {
            href: "/builder",
            label: navigationCopy.builder,
            icon: <Hammer aria-hidden />,
          },
        ]
      : []),
    ...(canUseAdmin
      ? [
          {
            href: "/knowledge",
            label: navigationCopy.admin,
            icon: <Shield aria-hidden />,
          },
        ]
      : []),
  ]
}

function RailLink({
  active,
  href,
  icon,
  label,
}: {
  active: boolean
  href: string
  icon: ReactNode
  label: string
}) {
  return (
    <Link
      aria-current={active ? "page" : undefined}
      aria-label={label}
      className={cn(
        "flex size-11 items-center justify-center rounded-md border border-transparent text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg-default focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
        active && "border-line-subtle bg-surface-2 text-accent",
      )}
      href={href}
      title={label}
    >
      {icon}
    </Link>
  )
}
