import { ExternalLink } from "lucide-react"
import { productCopy } from "@llm-machines/copy"
import type { EmbeddedSurface } from "@/lib/auth/sso-bridge"

interface EmbeddedSurfaceFrameProps {
  minHeight?: string
  surface: EmbeddedSurface
}

export function EmbeddedSurfaceFrame({
  minHeight = "560px",
  surface,
}: EmbeddedSurfaceFrameProps) {
  const copy = productCopy.pages.hub.embeddedSurface

  if (!surface.configured || !surface.url) {
    const hasExternalRoute = Boolean(surface.fallbackUrl)
    return (
      <div
        className="flex flex-col justify-between rounded-lg border border-dashed border-line-subtle bg-surface-2 p-5"
        style={{ minHeight: "180px" }}
      >
        <div>
          <p className="text-xs font-medium uppercase text-accent">
            {hasExternalRoute ? copy.externalRoute : copy.notConfigured}
          </p>
          <h2 className="mt-3 text-lg font-semibold">{surface.title}</h2>
          <p className="mt-2 max-w-2xl text-sm text-fg-muted">
            {surface.description}
          </p>
        </div>
        {surface.fallbackUrl ? (
          <a
            className="mt-6 inline-flex w-fit items-center gap-2 rounded-md border border-line-subtle px-3 py-2 text-sm text-fg-default transition-colors hover:bg-surface-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            href={surface.fallbackUrl}
          >
            <ExternalLink aria-hidden className="size-4" />
            {copy.openSurface(surface.title)}
          </a>
        ) : null}
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-lg border border-line-subtle bg-surface-1">
      <div className="flex items-center justify-between gap-3 border-line-subtle border-b px-4 py-3">
        <div>
          <p className="text-xs font-medium uppercase text-accent">
            {copy.secureFrame}
          </p>
          <h2 className="mt-1 text-base font-semibold">{surface.title}</h2>
        </div>
        {surface.fallbackUrl ? (
          <a
            className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg-default focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            href={surface.fallbackUrl}
          >
            <ExternalLink aria-hidden className="size-4" />
            {copy.openSurface(surface.title)}
          </a>
        ) : null}
      </div>
      <iframe
        className="w-full border-0 bg-surface-0"
        referrerPolicy="strict-origin-when-cross-origin"
        sandbox={surface.sandbox}
        src={surface.url}
        style={{ minHeight }}
        title={surface.title}
      />
    </div>
  )
}
