import { Library } from "lucide-react"
import Link from "next/link"
import { productCopy } from "@llm-machines/copy"
import { AccessDeniedPanel } from "@/components/hub/access-denied-panel"
import { HubPageFrame } from "@/components/hub/hub-page-frame"
import { Badge } from "@/components/ui/badge"
import { CardTitle } from "@/components/ui/card"
import { getBuilderTemplates } from "@/lib/builder/server-data"
import { getHubHome } from "@/lib/hub/server-data"

export const dynamic = "force-dynamic"

export default async function BuilderTemplatesPage() {
  const home = await getHubHome()
  const copy = productCopy.pages.hub.builderTemplates

  if (!home.capabilities.includes("builder_status")) {
    return (
      <HubPageFrame home={home}>
        <AccessDeniedPanel
          body={productCopy.pages.hub.builderSurface.unavailableBody}
          title={productCopy.pages.hub.builderSurface.unavailableTitle}
        />
      </HubPageFrame>
    )
  }

  const templates = await getBuilderTemplates()

  return (
    <HubPageFrame home={home}>
      <div className="space-y-5">
        <section>
          <p className="text-xs font-medium uppercase text-accent">
            {copy.eyebrow}
          </p>
          <h1 className="mt-2 text-2xl font-semibold">{copy.title}</h1>
          <p className="mt-2 max-w-3xl text-sm text-fg-muted">
            {copy.description}
          </p>
        </section>

        <section className="grid gap-3 lg:grid-cols-3">
          {templates.map((template) => (
            <Link
              className="rounded-md border border-line-subtle bg-surface-1 p-4 transition-colors hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
              href={template.href}
              key={template.id}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Library aria-hidden className="size-4 text-accent" />
                  <CardTitle className="text-sm">{template.name}</CardTitle>
                </div>
                <Badge tone="info">{template.category}</Badge>
              </div>
              <p className="mt-3 text-sm text-fg-muted">
                {template.description}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {template.tags.map((tag) => (
                  <Badge key={tag}>{tag}</Badge>
                ))}
              </div>
              <span className="mt-4 inline-flex text-sm text-accent">
                {copy.openTemplate}
              </span>
            </Link>
          ))}
        </section>
      </div>
    </HubPageFrame>
  )
}
