import Link from "next/link"
import { notFound } from "next/navigation"
import { productCopy } from "@llm-machines/copy"
import { HubPageFrame } from "@/components/hub/hub-page-frame"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { getHubHome, getHubResourceById } from "@/lib/hub/server-data"

export const dynamic = "force-dynamic"

interface ResourceDetailPageProps {
  params: Promise<{
    id: string
    type: string
  }>
}

export default async function ResourceDetailPage({
  params,
}: ResourceDetailPageProps) {
  const copy = productCopy.pages.hub.resourceDetail
  const labels = copy.labels
  const hubHomePromise = getHubHome()
  const { id, type } = await params
  const [hubHome, resource] = await Promise.all([
    hubHomePromise,
    getHubResourceById(type, id),
  ])
  if (!resource) {
    notFound()
  }

  const connector = resource.connector

  return (
    <HubPageFrame home={hubHome}>
      <div className="mx-auto max-w-6xl space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium uppercase text-accent">
              {copy.eyebrow}
            </p>
            <h1 className="mt-1 text-2xl font-semibold">{resource.name}</h1>
            <p className="mt-2 max-w-3xl text-sm text-fg-muted">
              {resource.description}
            </p>
          </div>
          <div className="flex gap-2">
            <Badge tone={resource.state === "available" ? "good" : "warning"}>
              {resource.state.replaceAll("_", " ")}
            </Badge>
            <Badge tone="info">{resource.supportTier.toUpperCase()}</Badge>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <Card>
            <CardHeader>
              <CardTitle>{copy.runtimePosture}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Definition label={labels.type} value={resource.type} />
              <Definition
                label={labels.version}
                value={resource.version ?? copy.unversioned}
              />
              <Definition
                label={labels.owner}
                value={resource.owner ?? copy.unassigned}
              />
              <Definition
                label={labels.sourceStatus}
                value={resource.sourceStatus.replaceAll("_", " ")}
              />
              <div>
                <p className="text-xs text-fg-muted">{labels.tags}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {resource.tags.map((tag) => (
                    <Badge key={tag}>{tag}</Badge>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{copy.allowedActions}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {resource.actions.map((action) => (
                <div
                  className="rounded-md border border-line-subtle bg-surface-2 p-3"
                  key={action.id}
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium">{action.label}</p>
                    <Badge tone={action.enabled ? "good" : "warning"}>
                      {action.enabled
                        ? productCopy.pages.hub.actionStates.enabled
                        : productCopy.pages.hub.actionStates.blocked}
                    </Badge>
                  </div>
                  {action.reason ? (
                    <p className="mt-2 text-sm text-fg-muted">
                      {action.reason}
                    </p>
                  ) : null}
                  {action.enabled ? (
                    <Button asChild className="mt-3" variant="secondary">
                      <Link href={action.href}>{copy.open}</Link>
                    </Button>
                  ) : (
                    <p className="mt-3 text-xs text-fg-muted">
                      {copy.noRunAction}
                    </p>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        {connector ? (
          <Card>
            <CardHeader>
              <CardTitle>{copy.mcpConnectorVetting}</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Definition
                label={labels.vettingStatus}
                value={connector.vettingStatus.replaceAll("_", " ")}
              />
              <Definition
                label={labels.readWrite}
                value={connector.readWrite}
              />
              <Definition
                label={labels.runtimeProfile}
                value={connector.runtimeProfile}
              />
              <Definition
                label={labels.sourceRef}
                value={connector.sourceRef}
              />
              <Definition label={labels.checksum} value={connector.checksum} />
              <Definition
                label={labels.lastReviewed}
                value={connector.lastReviewedAt ?? copy.notReviewed}
              />
              <ListDefinition
                label={labels.requiredScopes}
                values={connector.requiredScopes}
              />
              <ListDefinition
                label={labels.allowedEndpoints}
                values={connector.allowedEndpoints}
              />
              <ListDefinition
                label={labels.dataClasses}
                values={connector.dataClasses}
              />
              <ListDefinition
                label={labels.auditEvents}
                values={connector.auditEvents}
              />
              <ListDefinition
                label={labels.secretsRequired}
                values={
                  connector.secretsRequired.length > 0
                    ? connector.secretsRequired
                    : [copy.none]
                }
              />
            </CardContent>
          </Card>
        ) : null}
      </div>
    </HubPageFrame>
  )
}

function Definition({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-fg-muted">{label}</p>
      <p className="mt-1 text-sm font-medium">{value}</p>
    </div>
  )
}

function ListDefinition({
  label,
  values,
}: {
  label: string
  values: string[]
}) {
  return (
    <div>
      <p className="text-xs text-fg-muted">{label}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {values.map((value) => (
          <Badge key={value}>{value}</Badge>
        ))}
      </div>
    </div>
  )
}
