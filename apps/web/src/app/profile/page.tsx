import { productCopy } from "@llm-machines/copy"
import { HubPageFrame } from "@/components/hub/hub-page-frame"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { getHubHome } from "@/lib/hub/server-data"

export const dynamic = "force-dynamic"

export default async function ProfilePage() {
  const copy = productCopy.pages.hub.profilePage
  const hubHome = await getHubHome()
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
        <Card>
          <CardHeader>
            <CardTitle>{copy.effectiveAccess}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-sm text-fg-muted">
                {productCopy.pages.hub.metricLabels.persona}
              </span>
              <Badge tone="good">{hubHome.persona}</Badge>
            </div>
            <div className="flex flex-wrap gap-2">
              {hubHome.capabilities.map((capability) => (
                <Badge key={capability} tone="info">
                  {capability.replaceAll("_", " ")}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </HubPageFrame>
  )
}
