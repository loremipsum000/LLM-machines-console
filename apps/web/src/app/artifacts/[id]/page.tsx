import Link from "next/link"
import { notFound } from "next/navigation"
import { productCopy } from "@llm-machines/copy"
import { HubPageFrame } from "@/components/hub/hub-page-frame"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  getHubArtifactById,
  getHubHome,
  getHubTaskById,
} from "@/lib/hub/server-data"

export const dynamic = "force-dynamic"

interface ArtifactDetailPageProps {
  params: Promise<{
    id: string
  }>
}

export default async function ArtifactDetailPage({
  params,
}: ArtifactDetailPageProps) {
  const copy = productCopy.pages.hub.artifactDetail
  const metricLabels = productCopy.pages.hub.metricLabels
  const hubHomePromise = getHubHome()
  const { id } = await params
  const [hubHome, artifact] = await Promise.all([
    hubHomePromise,
    getHubArtifactById(id),
  ])
  if (!artifact) {
    notFound()
  }

  const task = artifact.taskId
    ? await getHubTaskById(artifact.taskId)
    : undefined

  return (
    <HubPageFrame home={hubHome}>
      <div className="mx-auto max-w-5xl space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium uppercase text-accent">
              {copy.eyebrow}
            </p>
            <h1 className="mt-1 text-2xl font-semibold">{artifact.title}</h1>
            <p className="mt-2 text-sm text-fg-muted">{copy.description}</p>
          </div>
          <Badge tone="info">{artifact.kind}</Badge>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Metric
            label={metricLabels.created}
            value={new Date(artifact.createdAt).toLocaleString("en-US")}
          />
          <Metric label={metricLabels.kind} value={artifact.kind} />
          <Metric
            label={metricLabels.task}
            value={task?.title ?? copy.detached}
          />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{copy.preview}</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="overflow-auto rounded-md border border-line-subtle bg-surface-2 p-4 text-sm text-fg-muted">
              {artifact.preview}
            </pre>
            {task ? (
              <Button asChild className="mt-4">
                <Link href={task.href}>{copy.openSourceTask}</Link>
              </Button>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </HubPageFrame>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm font-medium">{value}</p>
      </CardContent>
    </Card>
  )
}
