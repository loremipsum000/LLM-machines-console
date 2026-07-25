import { Boxes, Code2, FileText, Hammer, Library, Send } from "lucide-react"
import Link from "next/link"
import { productCopy } from "@llm-machines/copy"
import { AccessDeniedPanel } from "@/components/hub/access-denied-panel"
import { HubPageFrame } from "@/components/hub/hub-page-frame"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  getBuilderResources,
  getBuilderSubmissions,
  getBuilderTemplates,
} from "@/lib/builder/server-data"
import { getHubHome } from "@/lib/hub/server-data"

export const dynamic = "force-dynamic"

export default async function BuilderPage() {
  const home = await getHubHome()
  const copy = productCopy.pages.hub.builderSurface

  if (!home.capabilities.includes("builder_status")) {
    return (
      <HubPageFrame home={home}>
        <AccessDeniedPanel
          body={copy.unavailableBody}
          title={copy.unavailableTitle}
        />
      </HubPageFrame>
    )
  }

  const [builderResources, builderSubmissions, builderTemplates] =
    await Promise.all([
      getBuilderResources(),
      getBuilderSubmissions(),
      getBuilderTemplates(),
    ])
  const workbenchModule = home.modules.find(
    (module) => module.type === "developer_workbench",
  )
  const draftCount = builderResources.filter(
    (resource) => resource.state === "draft",
  ).length
  const submittedCount = builderResources.filter(
    (resource) => resource.state === "submitted",
  ).length
  const rejectedCount = builderSubmissions.filter(
    (submission) => submission.state === "rejected",
  ).length

  const recentTemplates = builderTemplates.slice(0, 3)
  const recentSubmissions = builderSubmissions.slice(0, 3)

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

        <section className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
          <Card>
            <CardHeader>
              <CardTitle>{copy.statusTitle}</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-3 gap-2">
              <Metric
                label={productCopy.pages.hub.metricLabels.drafts}
                value={draftCount}
              />
              <Metric
                label={productCopy.pages.hub.metricLabels.submitted}
                value={submittedCount}
              />
              <Metric
                label={productCopy.pages.hub.metricLabels.rejected}
                value={rejectedCount}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{copy.workbenchTitle}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 lg:grid-cols-2">
              {workbenchModule?.type === "developer_workbench"
                ? workbenchModule.tasks.map((task) => (
                    <Link
                      className="rounded-md border border-line-subtle bg-surface-2 p-3 transition-colors hover:bg-surface-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                      href={task.href}
                      key={task.id}
                    >
                      <div className="flex items-center gap-2">
                        <Code2 aria-hidden className="size-4 text-accent" />
                        <p className="text-sm font-medium">{task.title}</p>
                      </div>
                      <p className="mt-2 text-sm text-fg-muted">
                        {productCopy.pages.hub.metricLabels.status}:{" "}
                        {task.status}
                      </p>
                      <span className="mt-3 inline-flex text-sm text-accent">
                        {copy.openTask}
                      </span>
                    </Link>
                  ))
                : null}
              {workbenchModule?.type === "developer_workbench"
                ? workbenchModule.artifacts.map((artifact) => (
                    <Link
                      className="rounded-md border border-line-subtle bg-surface-2 p-3 transition-colors hover:bg-surface-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                      href={artifact.href}
                      key={artifact.id}
                    >
                      <div className="flex items-center gap-2">
                        <FileText
                          aria-hidden
                          className="size-4 text-accent-blue"
                        />
                        <p className="text-sm font-medium">{artifact.title}</p>
                      </div>
                      <p className="mt-2 text-sm text-fg-muted">
                        {productCopy.pages.hub.metricLabels.kind}:{" "}
                        {artifact.kind}
                      </p>
                      <span className="mt-3 inline-flex text-sm text-accent">
                        {copy.openArtifact}
                      </span>
                    </Link>
                  ))
                : null}
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader className="flex-row items-center justify-between gap-3">
              <CardTitle>{copy.templatesTitle}</CardTitle>
              <Button asChild variant="ghost">
                <Link href="/builder/templates">{copy.openTemplates}</Link>
              </Button>
            </CardHeader>
            <CardContent className="grid gap-3">
              {recentTemplates.map((template) => (
                <Link
                  className="rounded-md border border-line-subtle bg-surface-2 p-3 transition-colors hover:bg-surface-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                  href={template.href}
                  key={template.id}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Library aria-hidden className="size-4 text-accent" />
                      <p className="text-sm font-medium">{template.name}</p>
                    </div>
                    <Badge tone="info">{template.category}</Badge>
                  </div>
                  <p className="mt-2 text-sm text-fg-muted">
                    {template.description}
                  </p>
                </Link>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between gap-3">
              <CardTitle>{copy.submissionsTitle}</CardTitle>
              <Button asChild variant="ghost">
                <Link href="/builder/submissions">{copy.openSubmissions}</Link>
              </Button>
            </CardHeader>
            <CardContent className="grid gap-3">
              {recentSubmissions.map((submission) => (
                <Link
                  className="rounded-md border border-line-subtle bg-surface-2 p-3 transition-colors hover:bg-surface-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                  href={`/builder/resources/${submission.resourceId}`}
                  key={submission.id}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Send aria-hidden className="size-4 text-accent-blue" />
                      <p className="text-sm font-medium">
                        {submission.resourceName}
                      </p>
                    </div>
                    <Badge
                      tone={
                        submission.state === "rejected" ? "warning" : "info"
                      }
                    >
                      {submission.state}
                    </Badge>
                  </div>
                  <p className="mt-2 text-sm text-fg-muted">
                    {submission.submittedVersion}
                  </p>
                </Link>
              ))}
            </CardContent>
          </Card>
        </section>

        <section>
          <div className="mb-3 flex items-center gap-2">
            <Hammer aria-hidden className="size-4 text-accent" />
            <h2 className="font-semibold">{copy.resourcesTitle}</h2>
          </div>
          <div className="grid gap-3 lg:grid-cols-3">
            {builderResources.map((resource) => (
              <Link
                className="rounded-md border border-line-subtle bg-surface-1 p-4 transition-colors hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                href={resource.href}
                key={resource.id}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <Boxes aria-hidden className="size-4 text-accent" />
                      <h3 className="text-sm font-semibold">{resource.name}</h3>
                    </div>
                    <p className="mt-2 text-sm text-fg-muted">
                      {resource.description}
                    </p>
                  </div>
                  <Badge
                    tone={resource.state === "published" ? "good" : "warning"}
                  >
                    {resource.state}
                  </Badge>
                </div>
                <span className="mt-4 inline-flex text-sm text-accent">
                  {copy.openResource}
                </span>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </HubPageFrame>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-line-subtle bg-surface-2 p-3">
      <p className="text-xs text-fg-muted">{label}</p>
      <p className="mt-2 text-2xl font-semibold">{value.toLocaleString()}</p>
    </div>
  )
}
