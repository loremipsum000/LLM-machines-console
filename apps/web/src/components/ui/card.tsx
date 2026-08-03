import { cn } from "@/lib/utils"
import type { ComponentPropsWithoutRef } from "react"

export function Card({ className, ...props }: ComponentPropsWithoutRef<"div">) {
  return (
    <div
      className={cn(
        "rounded-lg border border-line-subtle bg-surface-1 shadow-sm",
        className,
      )}
      {...props}
    />
  )
}

export function CardHeader({
  className,
  ...props
}: ComponentPropsWithoutRef<"div">) {
  return <div className={cn("space-y-1 p-4", className)} {...props} />
}

export function CardTitle({
  children,
  className,
  ...props
}: ComponentPropsWithoutRef<"h2">) {
  if (!children) {
    return null
  }

  return (
    <h2
      className={cn("text-sm font-semibold text-fg-default", className)}
      {...props}
    >
      {children}
    </h2>
  )
}

export function CardContent({
  className,
  ...props
}: ComponentPropsWithoutRef<"div">) {
  return <div className={cn("p-4 pt-0", className)} {...props} />
}
