import { ShieldAlert } from "lucide-react"

interface AccessDeniedPanelProps {
  body: string
  title: string
}

export function AccessDeniedPanel({ body, title }: AccessDeniedPanelProps) {
  return (
    <section className="flex min-h-[420px] items-center justify-center">
      <div className="max-w-xl rounded-lg border border-line-subtle bg-surface-1 p-8 text-center">
        <ShieldAlert aria-hidden className="mx-auto size-8 text-accent-amber" />
        <h1 className="mt-4 text-xl font-semibold">{title}</h1>
        <p className="mt-3 text-sm text-fg-muted">{body}</p>
      </div>
    </section>
  )
}
