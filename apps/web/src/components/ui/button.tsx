import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import type { ComponentPropsWithoutRef } from "react"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex h-9 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary: "bg-accent text-surface-0 hover:bg-accent/90",
        secondary:
          "border border-line-subtle bg-surface-2 text-fg-default hover:bg-surface-3",
        ghost: "text-fg-muted hover:bg-surface-2 hover:text-fg-default",
      },
    },
    defaultVariants: {
      variant: "secondary",
    },
  },
)

interface ButtonProps
  extends ComponentPropsWithoutRef<"button">,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

export function Button({ asChild, className, variant, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button"
  return (
    <Comp className={cn(buttonVariants({ variant }), className)} {...props} />
  )
}
