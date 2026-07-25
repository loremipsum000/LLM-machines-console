import { ArrowLeft, Library } from "lucide-react"
import Link from "next/link"
import { notFound } from "next/navigation"
import { productCopy } from "@llm-machines/copy"
import { BuilderActionNotice } from "@/components/builder/builder-action-notice"
import { TemplateForkForm } from "@/components/builder/builder-lifecycle-actions"
import { AccessDeniedPanel } from "@/components/hub/access-denied-panel"
import { HubPageFrame } from "@/components/hub/hub-page-frame"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { getBuilderTemplateById } from "@/lib/builder/server-data"
import { getHubHome } from "@/lib/hub/server-data"

export const dynamic = "force-dynamic"

interface BuilderTemplateDetailPageProps {
  params: Promise<{
    id: string
  }>
  searchParams?: Promise<{
    builderAction?: string
  }>
}

export default async function BuilderTemplateDetailPage({
  params,
  searchParams,
}: BuilderTemplateDetailPageProps) {
  const home = await getHubHome()
  const copy = productCopy.pages.hub.builderTemplates
  const detailCopy = productCopy.pages.hub.builderResourceDetail

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

  const { id } = await params
  const template = await getBuilderTemplateById(id)
  if (!template) {
    notFound()
  }
  const actionStatus = (await searchParams)?.builderAction

  return (
    <HubPageFrame home={home}>
      <div className="mx-auto max-w-5xl space-y-5">
        <BuilderActionNotice status={actionStatus} />

        <Button asChild variant="ghost">
          <Link href="/builder/templates">
            <ArrowLeft aria-hidden className="size-4" />
            {copy.title}
          </Link>
        </Button>

        <section>
          <p className="text-xs font-medium uppercase text-accent">
            {copy.eyebrow}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold">{template.name}</h1>
            <Badge tone="info">{template.category}</Badge>
            <Badge>{template.version}</Badge>
          </div>
          <p className="mt-3 max-w-3xl text-sm text-fg-muted">
            {template.description}
          </p>
        </section>

        <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <Card>
            <CardHeader>
              <CardTitle>{copy.samplePrompts}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              {template.samplePrompts.map((prompt) => (
                <div
                  className="rounded-md border border-line-subtle bg-surface-2 p-3 text-sm text-fg-muted"
                  key={prompt}
                >
                  {prompt}
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{detailCopy.currentVersion}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-2">
                <Library aria-hidden className="size-4 text-accent" />
                <span className="text-sm text-fg-muted">
                  {template.type.replaceAll("_", " ")}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {template.tags.map((tag) => (
                  <Badge key={tag}>{tag}</Badge>
                ))}
              </div>
              <TemplateForkForm template={template} />
            </CardContent>
          </Card>
        </section>
      </div>
    </HubPageFrame>
  )
}
