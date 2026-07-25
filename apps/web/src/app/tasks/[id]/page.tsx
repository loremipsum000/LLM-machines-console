import Link from "next/link"
import { notFound } from "next/navigation"
import type { TaskSession } from "@llm-machines/contracts"
import { productCopy } from "@llm-machines/copy"
import { HubPageFrame } from "@/components/hub/hub-page-frame"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  getHubArtifacts,
  getHubHome,
  getHubTaskById,
} from "@/lib/hub/server-data"

export const dynamic = "force-dynamic"

interface TaskDetailPageProps {
  params: Promise<{
    id: string
  }>
}

export default async function TaskDetailPage({ params }: TaskDetailPageProps) {
  const copy = productCopy.pages.hub.taskDetail
  const metricLabels = productCopy.pages.hub.metricLabels
  const hubHomePromise = getHubHome()
  const { id } = await params
  const [hubHome, task] = await Promise.all([
    hubHomePromise,
    getHubTaskById(id),
  ])
  if (!task) {
    notFound()
  }

  const artifacts = (await getHubArtifacts()).filter(
    (artifact) => artifact.taskId === task.id,
  )

  return (
    <HubPageFrame home={hubHome}>
      <div className="mx-auto max-w-5xl space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium uppercase text-accent">
              {copy.eyebrow}
            </p>
            <h1 className="mt-1 text-2xl font-semibold">{task.title}</h1>
            <p className="mt-2 text-sm text-fg-muted">{copy.description}</p>
          </div>
          <Badge tone="warning">{task.status}</Badge>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Metric label={metricLabels.owner} value={task.owner} />
          <Metric
            label={metricLabels.updated}
            value={new Date(task.updatedAt).toLocaleString("en-US")}
          />
          <Metric
            label={metricLabels.artifacts}
            value={artifacts.length.toLocaleString()}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-4">
            <RunOutput task={task} />
            <DiffPreview task={task} />
            <Card>
              <CardHeader>
                <CardTitle>{copy.sessionOutputs}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {artifacts.length > 0 ? (
                  artifacts.map((artifact) => (
                    <div
                      className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line-subtle bg-surface-2 p-3"
                      key={artifact.id}
                    >
                      <div>
                        <p className="text-sm font-medium">{artifact.title}</p>
                        <p className="mt-1 text-sm text-fg-muted">
                          {artifact.kind}
                        </p>
                      </div>
                      <Button asChild>
                        <Link href={artifact.href}>{copy.openArtifact}</Link>
                      </Button>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-fg-muted">{copy.noArtifacts}</p>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>{copy.context}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {task.context.map((item) => (
                <div
                  className="rounded-md border border-line-subtle bg-surface-2 p-3"
                  key={`${item.label}-${item.value}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs text-fg-muted">{item.label}</p>
                    <Badge
                      tone={item.sourceStatus === "ok" ? "good" : "warning"}
                    >
                      {item.sourceStatus.replaceAll("_", " ")}
                    </Badge>
                  </div>
                  <p className="mt-2 text-sm font-medium">{item.value}</p>
                  {item.href ? (
                    <Button asChild className="mt-3" variant="secondary">
                      <Link href={item.href}>{copy.openSource}</Link>
                    </Button>
                  ) : null}
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
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

function RunOutput({ task }: { task: TaskSession }) {
  if (!task.testOutput) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            {productCopy.pages.hub.taskDetail.controlledRunOutput}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-fg-muted">
            {productCopy.pages.hub.taskDetail.noRunOutput}
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <CardTitle>
            {productCopy.pages.hub.taskDetail.controlledRunOutput}
          </CardTitle>
          <Badge
            tone={task.testOutput.status === "passed" ? "good" : "warning"}
          >
            {task.testOutput.status}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <p className="text-xs text-fg-muted">
            {productCopy.pages.hub.metricLabels.command}
          </p>
          <code className="mt-1 block rounded-md border border-line-subtle bg-surface-2 p-3 text-sm">
            {task.testOutput.command}
          </code>
        </div>
        <p className="text-sm text-fg-muted">{task.testOutput.summary}</p>
        <div className="space-y-2">
          {task.testOutput.logs.map((log) => (
            <div
              className="grid grid-cols-[92px_72px_minmax(0,1fr)] gap-2 rounded-md border border-line-subtle bg-surface-2 p-2 text-sm"
              key={`${log.timestamp}-${log.message}`}
            >
              <span className="text-fg-muted">
                {new Date(log.timestamp).toLocaleTimeString("en-US")}
              </span>
              <Badge tone={log.level === "error" ? "critical" : "neutral"}>
                {log.level}
              </Badge>
              <span>{log.message}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function DiffPreview({ task }: { task: TaskSession }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{productCopy.pages.hub.taskDetail.diffPreview}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {task.diffs.length > 0 ? (
          task.diffs.map((diff) => (
            <div
              className="rounded-md border border-line-subtle bg-surface-2 p-3"
              key={diff.path}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="break-all text-sm font-medium">{diff.path}</p>
                <div className="flex gap-2">
                  <Badge>{diff.status}</Badge>
                  <Badge tone="good">+{diff.additions}</Badge>
                  <Badge tone="critical">-{diff.deletions}</Badge>
                </div>
              </div>
              <pre className="mt-3 overflow-auto rounded-md border border-line-subtle bg-surface-0 p-3 text-sm text-fg-muted">
                {diff.preview.join("\n")}
              </pre>
            </div>
          ))
        ) : (
          <p className="text-sm text-fg-muted">
            {productCopy.pages.hub.taskDetail.noDiffPreview}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
