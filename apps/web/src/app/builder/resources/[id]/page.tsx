import { ArrowLeft, Boxes } from "lucide-react"
import Link from "next/link"
import { notFound } from "next/navigation"
import { productCopy } from "@llm-machines/copy"
import { BuilderActionNotice } from "@/components/builder/builder-action-notice"
import { BuilderLifecycleActions } from "@/components/builder/builder-lifecycle-actions"
import { AccessDeniedPanel } from "@/components/hub/access-denied-panel"
import { HubPageFrame } from "@/components/hub/hub-page-frame"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { getBuilderResourceById } from "@/lib/builder/server-data"
import { getHubHome } from "@/lib/hub/server-data"

export const dynamic = "force-dynamic"

interface BuilderResourceDetailPageProps {
  params: Promise<{
    id: string
  }>
  searchParams?: Promise<{
    builderAction?: string
  }>
}

export default async function BuilderResourceDetailPage({
  params,
  searchParams,
}: BuilderResourceDetailPageProps) {
  const home = await getHubHome()
  const copy = productCopy.pages.hub.builderResourceDetail

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
  const resource = await getBuilderResourceById(id)
  if (!resource) {
    notFound()
  }
  const actionStatus = (await searchParams)?.builderAction

  return (
    <HubPageFrame home={home}>
      <div className="mx-auto max-w-5xl space-y-5">
        <BuilderActionNotice status={actionStatus} />

        <Button asChild variant="ghost">
          <Link href="/builder">
            <ArrowLeft aria-hidden className="size-4" />
            {productCopy.pages.hub.builderSurface.title}
          </Link>
        </Button>

        <section>
          <p className="text-xs font-medium uppercase text-accent">
            {copy.eyebrow}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold">{resource.name}</h1>
            <Badge tone={resource.state === "published" ? "good" : "warning"}>
              {resource.state}
            </Badge>
          </div>
          <p className="mt-3 max-w-3xl text-sm text-fg-muted">
            {copy.description}
          </p>
        </section>

        <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <Card>
            <CardHeader>
              <CardTitle>{resource.description}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2">
              <ResourceMeta
                label={productCopy.pages.hub.metricLabels.owner}
                value={resource.ownerName}
              />
              <ResourceMeta
                label={productCopy.pages.hub.resourceDetail.labels.type}
                value={resource.type.replaceAll("_", " ")}
              />
              <ResourceMeta
                label={productCopy.pages.hub.metricLabels.updated}
                value={new Date(resource.updatedAt).toLocaleString()}
              />
              <ResourceMeta
                label={copy.fromTemplate}
                value={resource.templateId ?? "None"}
              />
            </CardContent>
          </Card>

          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>{copy.currentVersion}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-2">
                  <Boxes aria-hidden className="size-4 text-accent" />
                  <span className="text-sm text-fg-muted">
                    {resource.currentVersion?.semver ?? "Unversioned"}
                  </span>
                </div>
                {resource.type === "agent" ? (
                  <Button asChild className="w-full justify-between">
                    <Link href={resource.editorHref}>
                      <span>{copy.openAgentStudio}</span>
                      <Boxes aria-hidden className="size-4" />
                    </Link>
                  </Button>
                ) : (
                  <Button disabled type="button" variant="secondary">
                    {copy.editorUnavailable}
                  </Button>
                )}
              </CardContent>
            </Card>

            <BuilderLifecycleActions
              persona={home.persona}
              resource={resource}
            />
          </div>
        </section>
      </div>
    </HubPageFrame>
  )
}

function ResourceMeta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-line-subtle bg-surface-2 p-3">
      <p className="text-xs text-fg-muted">{label}</p>
      <p className="mt-1 text-sm font-medium">{value}</p>
    </div>
  )
}
