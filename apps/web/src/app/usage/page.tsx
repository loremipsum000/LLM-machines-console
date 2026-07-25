import { productCopy } from "@llm-machines/copy"
import { HubPageFrame } from "@/components/hub/hub-page-frame"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { getHubHome, getHubUsage } from "@/lib/hub/server-data"

export const dynamic = "force-dynamic"

export default async function UsagePage() {
  const copy = productCopy.pages.hub.usagePage
  const metricLabels = productCopy.pages.hub.metricLabels
  const usageSummary = productCopy.pages.hub.usageSummary
  const sourceStatus = productCopy.pages.hub.adminSurface.sourceStatus
  const [hubHome, hubUsage] = await Promise.all([
    getHubHome(),
    getHubUsage(),
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
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <UsageCard label={metricLabels.scope} value={hubUsage.scope} />
          <UsageCard
            label={metricLabels.prompts}
            value={hubUsage.prompts.toLocaleString()}
          />
          <UsageCard
            label={metricLabels.tokens}
            value={hubUsage.tokens.toLocaleString()}
          />
        </div>
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle>{usageSummary.sourceStatusLabel}</CardTitle>
              <Badge tone={sourceStatusTone(hubUsage.sourceStatus)}>
                {sourceStatus[hubUsage.sourceStatus]}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-fg-muted">
              {usageSummary.topModelLabel}:{" "}
              {hubUsage.topModels[0] ?? usageSummary.noTopModel}
            </p>
          </CardContent>
        </Card>
      </div>
    </HubPageFrame>
  )
}

function UsageCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold">{value}</p>
      </CardContent>
    </Card>
  )
}

function sourceStatusTone(
  status: "ok" | "degraded" | "unavailable" | "not_configured",
) {
  if (status === "ok") {
    return "good"
  }
  if (status === "degraded") {
    return "warning"
  }
  if (status === "unavailable") {
    return "critical"
  }
  return "neutral"
}
