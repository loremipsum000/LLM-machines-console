"use client"

import { Check, ChevronDown, UserRound } from "lucide-react"
import Link from "next/link"
import { useState } from "react"
import type { HubCapability, Persona } from "@llm-machines/contracts"
import { productCopy } from "@llm-machines/copy"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface ProfileMenuProps {
  capabilities: HubCapability[]
  persona: Persona
}

export function ProfileMenu({ capabilities, persona }: ProfileMenuProps) {
  const [open, setOpen] = useState(false)
  const capabilityLabels =
    capabilities.length > 0
      ? capabilities.map(formatCapability)
      : [productCopy.pages.hub.noElevatedCapabilities]

  return (
    <div className="relative">
      <Button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={productCopy.pages.hub.profileMenu.triggerLabel}
        onClick={() => setOpen((current) => !current)}
        variant="secondary"
      >
        <UserRound aria-hidden className="size-4" />
        <span className="hidden sm:inline">
          {productCopy.personas[persona]}
        </span>
        <ChevronDown
          aria-hidden
          className={cn("size-4 transition-transform", open && "rotate-180")}
        />
      </Button>

      {open ? (
        <div
          className="absolute right-0 top-12 z-30 w-80 rounded-lg border border-line-subtle bg-surface-1 p-3 shadow-xl"
          role="menu"
        >
          <div className="border-line-subtle border-b pb-3">
            <p className="text-xs font-medium uppercase text-fg-muted">
              {productCopy.pages.hub.activePersona}
            </p>
            <div className="mt-2 flex items-center justify-between gap-3">
              <p className="font-medium">{productCopy.personas[persona]}</p>
              <Badge tone="good">{persona}</Badge>
            </div>
          </div>

          <div className="py-3">
            <p className="text-xs font-medium uppercase text-fg-muted">
              {productCopy.pages.hub.capabilities}
            </p>
            <ul className="mt-2 space-y-2">
              {capabilityLabels.map((capability) => (
                <li className="flex items-start gap-2 text-sm" key={capability}>
                  <Check
                    aria-hidden
                    className="mt-0.5 size-4 shrink-0 text-accent"
                  />
                  <span>{capability}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="grid grid-cols-1 gap-2 border-line-subtle border-t pt-3">
            <MenuLink href="/profile" label={productCopy.pages.hub.profile} />
            {capabilities.includes("developer_workbench") ? (
              <MenuLink href="/tasks" label={productCopy.pages.hub.tasks} />
            ) : null}
            {capabilities.includes("builder_status") ? (
              <MenuLink href="/builder" label={productCopy.surfaces.builder} />
            ) : null}
            {capabilities.includes("admin_summary") ? (
              <MenuLink href="/knowledge" label={productCopy.surfaces.admin} />
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function MenuLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      className="rounded-md px-3 py-2 text-sm text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg-default focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
      href={href}
      role="menuitem"
    >
      {label}
    </Link>
  )
}

function formatCapability(capability: HubCapability): string {
  return capability
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase())
}
