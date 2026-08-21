"use client"

import type { RetainedConsoleRole } from "@/lib/auth/role-claims"
import { cn } from "@/lib/utils"
import Image from "next/image"
import Link from "next/link"
import { useRouter } from "next/navigation"
import type { ComponentType, ReactNode, SVGProps } from "react"
import { useEffect, useMemo, useState } from "react"
import {
  type ConsoleV2SectionId,
  consoleV2SectionsForRole,
} from "./console-v2-sections"

export type { ConsoleV2SectionId } from "./console-v2-sections"

type ModifierSubscriber = (visible: boolean) => void

let shortcutModifierVisible = false
const modifierSubscribers = new Set<ModifierSubscriber>()

interface ConsoleV2ShellProps {
  accessRole: RetainedConsoleRole
  activeSection?: ConsoleV2SectionId
  children: ReactNode
}

export function ConsoleV2Shell({
  accessRole,
  activeSection,
  children,
}: ConsoleV2ShellProps) {
  const router = useRouter()
  const visibleSections = useMemo(
    () => consoleV2SectionsForRole(accessRole),
    [accessRole],
  )
  const [modifierVisible, setModifierVisible] = useState(
    shortcutModifierVisible,
  )
  const [shortcutModifier, setShortcutModifier] =
    useState<ShortcutModifier>("meta")

  useEffect(() => {
    setShortcutModifier(detectShortcutModifier())
    return subscribeToModifierVisibility(setModifierVisible)
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isModifierEvent(event)) {
        setShortcutModifierVisible(true)
      }

      const shortcutIndex = shortcutNumberFromEvent(event)
      if (shortcutIndex === null) {
        return
      }

      const section = visibleSections[shortcutIndex]
      if (!section) {
        return
      }

      event.preventDefault()
      router.push(section.href)
    }

    const handleKeyUp = (event: KeyboardEvent) => {
      if (!event.metaKey && !event.ctrlKey) {
        setShortcutModifierVisible(false)
      }
    }

    const hideModifier = () => {
      setShortcutModifierVisible(false)
    }

    window.addEventListener("keydown", handleKeyDown)
    window.addEventListener("keyup", handleKeyUp)
    window.addEventListener("blur", hideModifier)
    document.addEventListener("visibilitychange", hideModifier)

    return () => {
      window.removeEventListener("keydown", handleKeyDown)
      window.removeEventListener("keyup", handleKeyUp)
      window.removeEventListener("blur", hideModifier)
      document.removeEventListener("visibilitychange", hideModifier)
    }
  }, [router, visibleSections])

  return (
    <div className="min-h-screen min-h-dvh bg-[#181818] font-sans text-[#fdfdfd]">
      <div className="relative min-h-screen min-h-dvh bg-[#181818]">
        <aside className="m-2 flex min-h-[720px] w-[260px] flex-col justify-between overflow-hidden rounded-[12px] bg-[#2e2c2e] p-2 max-lg:w-[calc(100%-16px)] lg:fixed lg:inset-y-2 lg:left-0 lg:m-0 lg:h-[calc(100vh-16px)]">
          <div className="flex w-full flex-col gap-8">
            <div className="flex h-12 w-full items-center gap-2.5 p-2">
              <Image
                alt=""
                className="size-8 shrink-0"
                height={32}
                src="/console-v2/llm-mark.svg"
                width={32}
              />
              <Image
                alt="LLM Machines"
                className="h-[29.44px] w-[72.515px] shrink-0"
                height={29}
                src="/console-v2/llm-wordmark.svg"
                width={73}
              />
            </div>

            <nav
              aria-label="Console navigation"
              className="flex w-full flex-col gap-0.5"
            >
              {visibleSections.map((section, index) => (
                <ConsoleV2NavLink
                  active={section.id === activeSection}
                  href={section.href}
                  icon={section.icon}
                  key={section.id}
                  label={section.label}
                  shortcut={String(index + 1)}
                  shortcutModifier={shortcutModifier}
                  shortcutVisible={modifierVisible}
                />
              ))}
            </nav>
          </div>

          <div className="grid gap-2">
            <div
              className="rounded-lg border border-[#454345] bg-[#242324] px-3 py-2"
              data-console-role={accessRole}
            >
              <p className="text-xs font-semibold uppercase tracking-wide text-[#8f8f8f]">
                Current access
              </p>
              <p className="mt-1 text-sm font-medium text-white">
                {accessRole === "admin" ? "Administrator" : "Operator"}
              </p>
            </div>
            <form action="/api/console/session/logout" method="post">
              <button
                className="flex h-8 w-full items-center rounded px-3 text-sm font-medium text-[#bdbdbd] transition-colors hover:bg-[#3d3b3d] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#009fff]"
                type="submit"
              >
                Sign out
              </button>
            </form>
          </div>
        </aside>

        <main className="min-w-0 px-5 py-8 max-lg:pt-4 sm:px-8 lg:ml-[clamp(320px,calc(100vw-690px),534px)] lg:w-[min(640px,calc(100vw-352px))] lg:px-0 lg:py-0">
          {children}
        </main>
      </div>
    </div>
  )
}

function ConsoleV2NavLink({
  active,
  href,
  icon: Icon,
  label,
  shortcut,
  shortcutModifier,
  shortcutVisible,
}: {
  active: boolean
  href: string
  icon: ComponentType<SVGProps<SVGSVGElement>>
  label: string
  shortcut: string
  shortcutModifier: ShortcutModifier
  shortcutVisible: boolean
}) {
  const shortcutLabel = shortcutHintLabel(shortcutModifier, shortcut)

  return (
    <Link
      aria-current={active ? "page" : undefined}
      aria-keyshortcuts={shortcutAriaLabel(shortcutModifier, shortcut)}
      className={cn(
        "flex h-8 w-full items-center gap-2.5 rounded px-1.5 text-sm font-medium text-[#dfdfdf] transition-colors hover:bg-[#3d3b3d] hover:text-[#fdfdfd] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#009fff]",
        active && "bg-[#3d3b3d] text-[#fdfdfd]",
      )}
      href={href}
    >
      <Icon aria-hidden className="size-5 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span
        aria-hidden
        className={cn(
          "ml-auto inline-flex h-5 min-w-9 shrink-0 translate-x-1 items-center justify-center rounded-full bg-[#4c4a4d] px-1.5 text-[11px] font-semibold leading-none text-[#d7d7d7] opacity-0 transition duration-100",
          shortcutVisible && "translate-x-0 opacity-100",
        )}
        data-console-nav-shortcut={shortcut}
      >
        {shortcutLabel}
      </span>
    </Link>
  )
}

type ShortcutModifier = "meta" | "ctrl"

function subscribeToModifierVisibility(
  subscriber: ModifierSubscriber,
): () => void {
  subscriber(shortcutModifierVisible)
  modifierSubscribers.add(subscriber)
  return () => {
    modifierSubscribers.delete(subscriber)
  }
}

function setShortcutModifierVisible(visible: boolean) {
  if (shortcutModifierVisible === visible) {
    return
  }

  shortcutModifierVisible = visible
  for (const subscriber of modifierSubscribers) {
    subscriber(visible)
  }
}

function detectShortcutModifier(): ShortcutModifier {
  const platform = navigator.platform.toLowerCase()
  return platform.includes("mac") ||
    platform.includes("iphone") ||
    platform.includes("ipad")
    ? "meta"
    : "ctrl"
}

function isModifierEvent(event: KeyboardEvent): boolean {
  return (
    event.metaKey ||
    event.ctrlKey ||
    event.key === "Meta" ||
    event.key === "Control"
  )
}

function shortcutNumberFromEvent(event: KeyboardEvent): number | null {
  if (!event.metaKey && !event.ctrlKey) {
    return null
  }

  const shortcutIndex = Number(event.key) - 1
  if (!Number.isInteger(shortcutIndex) || shortcutIndex < 0) {
    return null
  }

  return shortcutIndex
}

function shortcutHintLabel(
  shortcutModifier: ShortcutModifier,
  shortcut: string,
): string {
  return shortcutModifier === "meta" ? `⌘${shortcut}` : `Ctrl ${shortcut}`
}

function shortcutAriaLabel(
  shortcutModifier: ShortcutModifier,
  shortcut: string,
): string {
  return shortcutModifier === "meta"
    ? `Meta+${shortcut}`
    : `Control+${shortcut}`
}
