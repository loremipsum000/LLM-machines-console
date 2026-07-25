import { Send } from "lucide-react"
import Link from "next/link"
import { productCopy } from "@llm-machines/copy"
import { AccessDeniedPanel } from "@/components/hub/access-denied-panel"
import { HubPageFrame } from "@/components/hub/hub-page-frame"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { getBuilderSubmissions } from "@/lib/builder/server-data"
import { getHubHome } from "@/lib/hub/server-data"

export const dynamic = "force-dynamic"

export default async function BuilderSubmissionsPage() {
  const home = await getHubHome()
  const copy = productCopy.pages.hub.builderSubmissions

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

  const submissions = await getBuilderSubmissions()

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

        <section className="grid gap-3">
          {submissions.length > 0 ? (
            submissions.map((submission) => (
              <Link
                className="block rounded-md border border-line-subtle bg-surface-1 p-4 transition-colors hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                href={`/builder/resources/${submission.resourceId}`}
                key={submission.id}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <Send aria-hidden className="size-4 text-accent-blue" />
                      <h2 className="text-sm font-semibold">
                        {submission.resourceName}
                      </h2>
                    </div>
                    <p className="mt-2 text-sm text-fg-muted">
                      {submission.resourceType.replaceAll("_", " ")} /{" "}
                      {submission.submittedVersion}
                    </p>
                  </div>
                  <Badge tone={submissionTone(submission.state)}>
                    {submission.state}
                  </Badge>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <SubmissionMeta
                    label={copy.submittedAt}
                    value={new Date(submission.submittedAt).toLocaleString()}
                  />
                  <SubmissionMeta
                    label={copy.decidedAt}
                    value={
                      submission.decidedAt
                        ? new Date(submission.decidedAt).toLocaleString()
                        : "Pending"
                    }
                  />
                </div>
                {submission.adminComment ? (
                  <Card className="mt-4">
                    <CardContent className="p-3">
                      <p className="text-xs font-medium uppercase text-accent-amber">
                        {copy.adminComment}
                      </p>
                      <p className="mt-2 text-sm text-fg-muted">
                        {submission.adminComment}
                      </p>
                    </CardContent>
                  </Card>
                ) : null}
              </Link>
            ))
          ) : (
            <Card>
              <CardContent>
                <p className="text-sm text-fg-muted">{copy.empty}</p>
              </CardContent>
            </Card>
          )}
        </section>
      </div>
    </HubPageFrame>
  )
}

function submissionTone(state: string) {
  if (state === "published") {
    return "good"
  }
  if (state === "rejected" || state === "withdrawn") {
    return "warning"
  }
  return "info"
}

function SubmissionMeta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-line-subtle bg-surface-2 p-3">
      <p className="text-xs text-fg-muted">{label}</p>
      <p className="mt-1 text-sm font-medium">{value}</p>
    </div>
  )
}
