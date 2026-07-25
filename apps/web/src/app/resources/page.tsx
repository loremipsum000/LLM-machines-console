import Link from "next/link"
import { productCopy } from "@llm-machines/copy"
import { HubPageFrame } from "@/components/hub/hub-page-frame"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { getHubHome, getHubResources } from "@/lib/hub/server-data"

export const dynamic = "force-dynamic"

export default async function ResourcesPage() {
  const copy = productCopy.pages.hub.resourceCatalog
  const [hubHome, hubResources] = await Promise.all([
    getHubHome(),
    getHubResources(),
  ])
  return (
    <HubPageFrame home={hubHome}>
      <div className="mx-auto max-w-6xl space-y-4">
        <div>
          <p className="text-sm font-medium uppercase text-accent">
            {copy.eyebrow}
          </p>
          <h1 className="mt-1 text-2xl font-semibold">{copy.title}</h1>
          <p className="mt-2 max-w-3xl text-sm text-fg-muted">
            {copy.description}
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {hubResources.map((resource) => (
            <Card key={resource.id}>
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <CardTitle>
                    <Link
                      className="hover:text-accent"
                      href={`/resources/${resource.type}/${resource.id}`}
                    >
                      {resource.name}
                    </Link>
                  </CardTitle>
                  <Badge
                    tone={resource.state === "available" ? "good" : "warning"}
                  >
                    {resource.state.replaceAll("_", " ")}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-fg-muted">{resource.description}</p>
                <div className="mt-3 flex gap-2">
                  <Badge>{resource.type}</Badge>
                  <Badge tone="info">
                    {resource.supportTier.toUpperCase()}
                  </Badge>
                </div>
                <Link
                  className="mt-4 inline-flex text-sm font-medium text-accent hover:text-accent/80"
                  href={`/resources/${resource.type}/${resource.id}`}
                >
                  {copy.openDetails}
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </HubPageFrame>
  )
}
