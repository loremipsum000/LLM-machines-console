import type { ComponentPropsWithoutRef } from "react"
import { cn } from "@/lib/utils"

type BadgeTone = "neutral" | "good" | "warning" | "critical" | "info"

const toneClassName: Record<BadgeTone, string> = {
  neutral: "border-line-subtle bg-surface-2 text-fg-muted",
  good: "border-accent/35 bg-accent/10 text-accent",
  warning: "border-accent-amber/35 bg-accent-amber/10 text-accent-amber",
  critical: "border-accent-red/35 bg-accent-red/10 text-accent-red",
  info: "border-accent-blue/35 bg-accent-blue/10 text-accent-blue",
}

interface BadgeProps extends ComponentPropsWithoutRef<"span"> {
  tone?: BadgeTone
}

export function Badge({ className, tone = "neutral", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center rounded-md border px-2 text-xs font-medium",
        toneClassName[tone],
        className,
      )}
      {...props}
    />
  )
}
