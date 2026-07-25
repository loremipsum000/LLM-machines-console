import Link from "next/link"
import { productCopy } from "@llm-machines/copy"
import { HubPageFrame } from "@/components/hub/hub-page-frame"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { getHubHome, getHubTasks } from "@/lib/hub/server-data"

export const dynamic = "force-dynamic"

export default async function TasksPage() {
  const copy = productCopy.pages.hub.tasksPage
  const [hubHome, hubTasks] = await Promise.all([
    getHubHome(),
    getHubTasks(),
  ])
  return (
    <HubPageFrame home={hubHome}>
      <div className="mx-auto max-w-5xl space-y-4">
        <div>
          <p className="text-sm font-medium uppercase text-accent">
            {copy.eyebrow}
          </p>
          <h1 className="mt-1 text-2xl font-semibold">{copy.title}</h1>
          <p className="mt-2 text-sm text-fg-muted">{copy.description}</p>
        </div>
        {hubTasks.map((task) => (
          <Card key={task.id}>
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <CardTitle>
                  <Link className="hover:text-accent" href={task.href}>
                    {task.title}
                  </Link>
                </CardTitle>
                <Badge tone="warning">{task.status}</Badge>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-fg-muted">
                {productCopy.pages.hub.metricLabels.owner}: {task.owner}
              </p>
              <Link
                className="mt-4 inline-flex text-sm font-medium text-accent hover:text-accent/80"
                href={task.href}
              >
                {copy.openSession}
              </Link>
            </CardContent>
          </Card>
        ))}
      </div>
    </HubPageFrame>
  )
}
