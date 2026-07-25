import type {
  BuilderResource,
  BuilderTemplate,
  Persona,
} from "@llm-machines/contracts"
import { productCopy } from "@llm-machines/copy"
import {
  CheckCircle2,
  Clock3,
  GitFork,
  RotateCcw,
  Scissors,
  Send,
  XCircle,
} from "lucide-react"
import {
  approveBuilderResourceAction,
  createBuilderResourceVersionAction,
  forkBuilderTemplateAction,
  rejectBuilderResourceAction,
  submitBuilderResourceAction,
  withdrawBuilderResourceAction,
} from "@/lib/builder/actions"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

const copy = productCopy.pages.hub.builderResourceDetail

export function TemplateForkForm({
  template,
}: {
  template: BuilderTemplate
}) {
  return (
    <form action={forkBuilderTemplateAction} className="space-y-3">
      <input name="templateId" type="hidden" value={template.id} />
      <label className="grid gap-2 text-sm">
        <span className="text-xs font-medium text-fg-muted">
          {productCopy.pages.hub.builderTemplates.forkName}
        </span>
        <input
          className="h-10 rounded-md border border-line-subtle bg-surface-2 px-3 text-sm text-fg-default outline-none transition-colors placeholder:text-fg-muted focus:border-accent"
          defaultValue={template.name}
          maxLength={96}
          name="name"
          required
        />
      </label>
      <Button
        className="w-full justify-between"
        type="submit"
        variant="primary"
      >
        <span>{productCopy.pages.hub.builderTemplates.fork}</span>
        <GitFork aria-hidden className="size-4" />
      </Button>
    </form>
  )
}

export function BuilderLifecycleActions({
  persona,
  resource,
}: {
  persona: Persona
  resource: BuilderResource
}) {
  const canAdminDecide = persona === "admin" && resource.state === "submitted"

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3">
        <CardTitle>{copy.lifecycleActions}</CardTitle>
        <Badge tone={stateTone(resource.state)}>{resource.state}</Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        {resource.state === "draft" ? (
          <>
            <VersionForm resource={resource} />
            <SubmitForm resource={resource} />
          </>
        ) : null}

        {resource.state === "submitted" && !canAdminDecide ? (
          <div className="space-y-3">
            <div className="rounded-md border border-line-subtle bg-surface-2 p-3">
              <div className="flex items-center gap-2">
                <Clock3 aria-hidden className="size-4 text-accent-blue" />
                <p className="text-sm font-medium">{copy.awaitingReview}</p>
              </div>
              <p className="mt-2 text-sm text-fg-muted">
                {resource.currentVersion?.semver ?? "Unversioned"}
              </p>
            </div>
            <WithdrawForm resource={resource} />
          </div>
        ) : null}

        {canAdminDecide ? <AdminDecisionForms resource={resource} /> : null}

        {resource.state === "published" ? (
          <div className="rounded-md border border-line-subtle bg-surface-2 p-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 aria-hidden className="size-4 text-accent" />
              <p className="text-sm font-medium">{copy.published}</p>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

function VersionForm({ resource }: { resource: BuilderResource }) {
  return (
    <form action={createBuilderResourceVersionAction} className="space-y-3">
      <input name="resourceId" type="hidden" value={resource.id} />
      <label className="grid gap-2 text-sm">
        <span className="text-xs font-medium text-fg-muted">{copy.semver}</span>
        <input
          className="h-10 rounded-md border border-line-subtle bg-surface-2 px-3 text-sm text-fg-default outline-none transition-colors placeholder:text-fg-muted focus:border-accent"
          defaultValue={nextVersion(resource.currentVersion?.semver)}
          maxLength={32}
          name="semver"
          pattern="^v?[0-9]+(\\.[0-9]+){0,2}([-.][A-Za-z0-9.]+)?$"
          required
        />
      </label>
      <Button className="w-full justify-between" type="submit">
        <span>{copy.cutVersion}</span>
        <Scissors aria-hidden className="size-4" />
      </Button>
    </form>
  )
}

function SubmitForm({ resource }: { resource: BuilderResource }) {
  const disabled = !resource.currentVersion
  return (
    <form action={submitBuilderResourceAction} className="space-y-2">
      <input name="resourceId" type="hidden" value={resource.id} />
      <Button
        className="w-full justify-between"
        disabled={disabled}
        type="submit"
        variant="primary"
      >
        <span>{copy.submit}</span>
        <Send aria-hidden className="size-4" />
      </Button>
      {disabled ? (
        <p className="text-xs text-fg-muted">{copy.unversionedHelp}</p>
      ) : null}
    </form>
  )
}

function WithdrawForm({ resource }: { resource: BuilderResource }) {
  return (
    <form action={withdrawBuilderResourceAction} className="space-y-2">
      <input name="resourceId" type="hidden" value={resource.id} />
      <Button className="w-full justify-between" type="submit">
        <span>{copy.withdraw}</span>
        <RotateCcw aria-hidden className="size-4" />
      </Button>
      <p className="text-xs text-fg-muted">{copy.withdrawHelp}</p>
    </form>
  )
}

function AdminDecisionForms({ resource }: { resource: BuilderResource }) {
  return (
    <div className="space-y-4">
      <form action={approveBuilderResourceAction}>
        <input name="resourceId" type="hidden" value={resource.id} />
        <Button
          className="w-full justify-between"
          type="submit"
          variant="primary"
        >
          <span>{copy.approve}</span>
          <CheckCircle2 aria-hidden className="size-4" />
        </Button>
      </form>

      <form action={rejectBuilderResourceAction} className="space-y-3">
        <input name="resourceId" type="hidden" value={resource.id} />
        <label className="grid gap-2 text-sm">
          <span className="text-xs font-medium text-fg-muted">
            {copy.rejectionComment}
          </span>
          <textarea
            className="min-h-24 resize-y rounded-md border border-line-subtle bg-surface-2 px-3 py-2 text-sm text-fg-default outline-none transition-colors placeholder:text-fg-muted focus:border-accent"
            maxLength={500}
            name="comment"
            required
          />
        </label>
        <Button className="w-full justify-between" type="submit">
          <span>{copy.reject}</span>
          <XCircle aria-hidden className="size-4" />
        </Button>
      </form>
    </div>
  )
}

function stateTone(state: BuilderResource["state"]) {
  if (state === "published") {
    return "good"
  }
  if (state === "submitted") {
    return "info"
  }
  return "warning"
}

function nextVersion(current?: string): string {
  if (!current) {
    return "v0.1"
  }

  const match = current.match(/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/)
  if (!match) {
    return current
  }

  const major = Number(match[1])
  const minor = Number(match[2] ?? 0) + 1
  return `v${major}.${minor}`
}
