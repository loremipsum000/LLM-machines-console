import {
  ArrowLeft,
  Bot,
  Database,
  RotateCcw,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
} from "lucide-react"
import Link from "next/link"
import { notFound } from "next/navigation"
import { productCopy } from "@llm-machines/copy"
import { BuilderActionNotice } from "@/components/builder/builder-action-notice"
import { BuilderAgentTestPane } from "@/components/builder/builder-agent-test-pane"
import { AccessDeniedPanel } from "@/components/hub/access-denied-panel"
import { HubPageFrame } from "@/components/hub/hub-page-frame"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  attachBuilderKnowledgeCorpusAction,
  clearBuilderAgentStudioTestRunsAction,
  resetBuilderAgentStudioDraftAction,
  saveBuilderAgentStudioAction,
} from "@/lib/builder/actions"
import {
  getBuilderAgentCorpusBindings,
  getBuilderAgentStudioById,
  getBuilderKnowledgeCorpora,
} from "@/lib/builder/server-data"
import { getHubHome } from "@/lib/hub/server-data"

export const dynamic = "force-dynamic"

const sandboxProfiles = [
  "openclaw-restricted",
  "openclaw-tools",
  "hermes-restricted",
  "hermes-tools",
]

type BuilderAgentStudio = NonNullable<
  Awaited<ReturnType<typeof getBuilderAgentStudioById>>
>
type BuilderKnowledgeCorpora = Awaited<
  ReturnType<typeof getBuilderKnowledgeCorpora>
>
type BuilderAgentCorpusBindings = Awaited<
  ReturnType<typeof getBuilderAgentCorpusBindings>
>

interface BuilderAgentStudioPageProps {
  params: Promise<{
    id: string
  }>
  searchParams?: Promise<{
    builderAction?: string
  }>
}

export default async function BuilderAgentStudioPage({
  params,
  searchParams,
}: BuilderAgentStudioPageProps) {
  const home = await getHubHome()

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

  const { id } = await params
  const studio = await getBuilderAgentStudioById(id)
  if (!studio) {
    notFound()
  }
  const [knowledgeCorpora, corpusBindings] = await Promise.all([
    getBuilderKnowledgeCorpora(),
    getBuilderAgentCorpusBindings(id),
  ])
  const actionStatus = (await searchParams)?.builderAction
  const toolValue = studio.config.tools.join("\n")

  return (
    <HubPageFrame home={home}>
      <BuilderAgentStudioContent
        actionStatus={actionStatus}
        corpusBindings={corpusBindings}
        knowledgeCorpora={knowledgeCorpora}
        studio={studio}
        toolValue={toolValue}
      />
    </HubPageFrame>
  )
}

function BuilderAgentStudioContent({
  actionStatus,
  corpusBindings,
  knowledgeCorpora,
  studio,
  toolValue,
}: {
  actionStatus?: string
  corpusBindings: BuilderAgentCorpusBindings
  knowledgeCorpora: BuilderKnowledgeCorpora
  studio: BuilderAgentStudio
  toolValue: string
}) {
  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <BuilderActionNotice status={actionStatus} />
      <BuilderAgentBackLink studio={studio} />
      <BuilderAgentStudioHeader studio={studio} />
      <BuilderAgentEditableNotice editable={studio.editable} />
      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <BuilderAgentStudioForm studio={studio} toolValue={toolValue} />
        <BuilderAgentStudioSidebar
          corpusBindings={corpusBindings}
          knowledgeCorpora={knowledgeCorpora}
          studio={studio}
        />
      </section>
    </div>
  )
}

function BuilderAgentBackLink({ studio }: { studio: BuilderAgentStudio }) {
  return (
    <Button asChild variant="ghost">
      <Link href={studio.resource.href}>
        <ArrowLeft aria-hidden className="size-4" />
        {studio.resource.name}
      </Link>
    </Button>
  )
}

function BuilderAgentStudioHeader({ studio }: { studio: BuilderAgentStudio }) {
  const copy = productCopy.pages.hub.builderAgentStudio

  return (
    <section>
      <p className="text-xs font-medium uppercase text-accent">
        {copy.eyebrow}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{studio.resource.name}</h1>
        <Badge tone={studio.editable ? "warning" : "info"}>
          {studio.resource.state}
        </Badge>
        <Badge>{studio.config.sandboxProfile}</Badge>
      </div>
      <p className="mt-3 max-w-3xl text-sm text-fg-muted">
        {copy.description}
      </p>
    </section>
  )
}

function BuilderAgentEditableNotice({ editable }: { editable: boolean }) {
  if (editable) {
    return null
  }

  return (
    <div className="rounded-md border border-line-subtle bg-surface-1 p-3 text-sm text-fg-muted">
      {productCopy.pages.hub.builderAgentStudio.editableLocked}
    </div>
  )
}

function BuilderAgentStudioForm({
  studio,
  toolValue,
}: {
  studio: BuilderAgentStudio
  toolValue: string
}) {
  return (
    <form action={saveBuilderAgentStudioAction} className="space-y-4">
      <input name="resourceId" type="hidden" value={studio.resource.id} />
      <fieldset className="space-y-4" disabled={!studio.editable}>
        <BuilderAgentDefinitionCard studio={studio} />
        <BuilderAgentRuntimeCard studio={studio} toolValue={toolValue} />
        <BuilderAgentSaveButton />
      </fieldset>
    </form>
  )
}

function BuilderAgentDefinitionCard({ studio }: { studio: BuilderAgentStudio }) {
  const copy = productCopy.pages.hub.builderAgentStudio

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3">
        <CardTitle>{copy.definition}</CardTitle>
        <Bot aria-hidden className="size-4 text-accent" />
      </CardHeader>
      <CardContent className="grid gap-4">
        <StudioTextField
          defaultValue={studio.resource.name}
          label="Name"
          maxLength={96}
          name="name"
          required
        />
        <StudioTextarea
          defaultValue={studio.resource.description}
          label="Description"
          maxLength={500}
          minHeightClass="min-h-24"
          name="description"
          required
        />
        <StudioTextarea
          defaultValue={studio.config.systemPrompt}
          label={copy.systemPrompt}
          maxLength={4000}
          minHeightClass="min-h-36"
          name="systemPrompt"
          required
        />
        <StudioTextarea
          defaultValue={studio.config.instructions}
          label={copy.instructions}
          maxLength={4000}
          minHeightClass="min-h-40"
          name="instructions"
          required
        />
      </CardContent>
    </Card>
  )
}

function BuilderAgentRuntimeCard({
  studio,
  toolValue,
}: {
  studio: BuilderAgentStudio
  toolValue: string
}) {
  const copy = productCopy.pages.hub.builderAgentStudio

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3">
        <CardTitle>{copy.runtime}</CardTitle>
        <ShieldCheck aria-hidden className="size-4 text-accent" />
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        <StudioTextField
          defaultValue={studio.config.model}
          label={copy.model}
          maxLength={120}
          name="model"
          required
        />
        <StudioSandboxSelect value={studio.config.sandboxProfile} />
        <StudioNumberField
          defaultValue={studio.config.temperature}
          label={copy.temperature}
          max={2}
          min={0}
          name="temperature"
          step={0.1}
        />
        <StudioNumberField
          defaultValue={studio.config.maxOutputTokens}
          label={copy.maxOutputTokens}
          max={8192}
          min={64}
          name="maxOutputTokens"
          step={64}
        />
        <StudioTextarea
          defaultValue={toolValue}
          help={copy.toolsHelp}
          label={copy.tools}
          maxLength={1800}
          minHeightClass="min-h-24"
          name="tools"
          placeholder={copy.toolsHelp}
          wrapperClassName="md:col-span-2"
        />
        <StudioTextarea
          defaultValue={studio.config.sampleInput}
          label={copy.sampleInput}
          maxLength={4000}
          minHeightClass="min-h-28"
          name="sampleInput"
          required
          wrapperClassName="md:col-span-2"
        />
      </CardContent>
    </Card>
  )
}

function BuilderAgentSaveButton() {
  return (
    <Button className="w-full justify-between" type="submit" variant="primary">
      <span>{productCopy.pages.hub.builderAgentStudio.save}</span>
      <Save aria-hidden className="size-4" />
    </Button>
  )
}

function BuilderAgentStudioSidebar({
  corpusBindings,
  knowledgeCorpora,
  studio,
}: {
  corpusBindings: BuilderAgentCorpusBindings
  knowledgeCorpora: BuilderKnowledgeCorpora
  studio: BuilderAgentStudio
}) {
  return (
    <div className="space-y-4">
      <BuilderAgentRuntimeSummary studio={studio} />
      <BuilderAgentTestPane
        disabled={!studio.testable}
        quota={studio.quota}
        recentTestRuns={studio.recentTestRuns}
        resourceId={studio.resource.id}
        sampleInput={studio.config.sampleInput}
      />
      <BuilderKnowledgePanel
        bindings={corpusBindings}
        corpora={knowledgeCorpora.corpora}
        editable={studio.editable}
        resourceId={studio.resource.id}
      />
      <BuilderAgentCleanupCard studio={studio} />
    </div>
  )
}

function BuilderAgentRuntimeSummary({ studio }: { studio: BuilderAgentStudio }) {
  const copy = productCopy.pages.hub.builderAgentStudio

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3">
        <CardTitle>{copy.runtime}</CardTitle>
        <SlidersHorizontal aria-hidden className="size-4 text-accent-blue" />
      </CardHeader>
      <CardContent className="grid gap-3">
        <StudioMeta label={copy.model} value={studio.config.model} />
        <StudioMeta
          label={copy.sandboxProfile}
          value={studio.config.sandboxProfile}
        />
        <StudioMeta
          label={copy.updatedAt}
          value={new Date(studio.config.updatedAt).toLocaleString()}
        />
      </CardContent>
    </Card>
  )
}

function BuilderAgentCleanupCard({ studio }: { studio: BuilderAgentStudio }) {
  const copy = productCopy.pages.hub.builderAgentStudio

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3">
        <CardTitle>{copy.cleanupTitle}</CardTitle>
        <Trash2 aria-hidden className="size-4 text-fg-muted" />
      </CardHeader>
      <CardContent className="grid gap-4">
        <p className="text-sm text-fg-muted">{copy.cleanupHelp}</p>
        <BuilderAgentCleanupForm
          action={resetBuilderAgentStudioDraftAction}
          buttonIcon="reset"
          buttonText={copy.resetDraft}
          confirmation={copy.resetConfirmation}
          editable={studio.editable}
          resourceId={studio.resource.id}
        />
        <BuilderAgentCleanupForm
          action={clearBuilderAgentStudioTestRunsAction}
          buttonIcon="delete"
          buttonText={copy.clearTestRuns}
          className="border-t border-line-subtle pt-4"
          confirmation={copy.clearConfirmation}
          editable={studio.editable}
          resourceId={studio.resource.id}
        />
      </CardContent>
    </Card>
  )
}

function BuilderAgentCleanupForm({
  action,
  buttonIcon,
  buttonText,
  className,
  confirmation,
  editable,
  resourceId,
}: {
  action: (formData: FormData) => void | Promise<void>
  buttonIcon: "delete" | "reset"
  buttonText: string
  className?: string
  confirmation: string
  editable: boolean
  resourceId: string
}) {
  return (
    <form action={action} className={`grid gap-3 ${className ?? ""}`.trim()}>
      <input name="resourceId" type="hidden" value={resourceId} />
      <fieldset className="grid gap-3" disabled={!editable}>
        <label className="grid gap-2 text-sm">
          <span className="text-xs font-medium text-fg-muted">
            {productCopy.pages.hub.builderAgentStudio.confirmationLabel}
          </span>
          <input
            autoCapitalize="characters"
            autoComplete="off"
            className="h-10 rounded-md border border-line-subtle bg-surface-2 px-3 text-sm text-fg-default outline-none transition-colors placeholder:text-fg-muted focus:border-accent"
            name="confirmation"
            placeholder={confirmation}
            required
          />
        </label>
        <Button className="w-full justify-between" type="submit">
          <span>{buttonText}</span>
          {buttonIcon === "reset" ? (
            <RotateCcw aria-hidden className="size-4" />
          ) : (
            <Trash2 aria-hidden className="size-4" />
          )}
        </Button>
      </fieldset>
    </form>
  )
}

function StudioTextField({
  defaultValue,
  label,
  maxLength,
  name,
  required,
}: {
  defaultValue: string
  label: string
  maxLength: number
  name: string
  required?: boolean
}) {
  return (
    <label className="grid gap-2 text-sm">
      <span className="text-xs font-medium text-fg-muted">{label}</span>
      <input
        className="h-10 rounded-md border border-line-subtle bg-surface-2 px-3 text-sm text-fg-default outline-none transition-colors placeholder:text-fg-muted focus:border-accent"
        defaultValue={defaultValue}
        maxLength={maxLength}
        name={name}
        required={required}
      />
    </label>
  )
}

function StudioNumberField({
  defaultValue,
  label,
  max,
  min,
  name,
  step,
}: {
  defaultValue: number
  label: string
  max: number
  min: number
  name: string
  step: number
}) {
  return (
    <label className="grid gap-2 text-sm">
      <span className="text-xs font-medium text-fg-muted">{label}</span>
      <input
        className="h-10 rounded-md border border-line-subtle bg-surface-2 px-3 text-sm text-fg-default outline-none transition-colors placeholder:text-fg-muted focus:border-accent"
        defaultValue={defaultValue}
        max={max}
        min={min}
        name={name}
        required
        step={step}
        type="number"
      />
    </label>
  )
}

function StudioTextarea({
  defaultValue,
  help,
  label,
  maxLength,
  minHeightClass,
  name,
  placeholder,
  required,
  wrapperClassName,
}: {
  defaultValue: string
  help?: string
  label: string
  maxLength: number
  minHeightClass: string
  name: string
  placeholder?: string
  required?: boolean
  wrapperClassName?: string
}) {
  return (
    <label className={`grid gap-2 text-sm ${wrapperClassName ?? ""}`.trim()}>
      <span className="text-xs font-medium text-fg-muted">{label}</span>
      <textarea
        className={`${minHeightClass} resize-y rounded-md border border-line-subtle bg-surface-2 px-3 py-2 text-sm text-fg-default outline-none transition-colors placeholder:text-fg-muted focus:border-accent`}
        defaultValue={defaultValue}
        maxLength={maxLength}
        name={name}
        placeholder={placeholder}
        required={required}
      />
      {help ? <span className="text-xs text-fg-muted">{help}</span> : null}
    </label>
  )
}

function StudioSandboxSelect({ value }: { value: string }) {
  const copy = productCopy.pages.hub.builderAgentStudio

  return (
    <label className="grid gap-2 text-sm">
      <span className="text-xs font-medium text-fg-muted">
        {copy.sandboxProfile}
      </span>
      <select
        className="h-10 rounded-md border border-line-subtle bg-surface-2 px-3 text-sm text-fg-default outline-none transition-colors focus:border-accent"
        defaultValue={value}
        name="sandboxProfile"
      >
        {sandboxProfiles.map((profile) => (
          <option key={profile} value={profile}>
            {profile}
          </option>
        ))}
      </select>
    </label>
  )
}

function BuilderKnowledgePanel({
  bindings,
  corpora,
  editable,
  resourceId,
}: {
  bindings: Array<{ corpusId: string }>
  corpora: Array<{
    chunkCount: number
    id: string
    name: string
    sourceCount: number
    status: string
  }>
  editable: boolean
  resourceId: string
}) {
  const attachedCorpusIds = new Set(bindings.map((binding) => binding.corpusId))

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3">
        <CardTitle>Approved corpora</CardTitle>
        <Database aria-hidden className="size-4 text-accent" />
      </CardHeader>
      <CardContent className="grid gap-3">
        {corpora.length > 0 ? (
          corpora.map((corpus) => {
            const attached = attachedCorpusIds.has(corpus.id)
            return (
              <div
                className="rounded-md border border-line-subtle bg-surface-2 p-3"
                key={corpus.id}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">{corpus.name}</p>
                    <p className="mt-1 text-xs text-fg-muted">
                      {corpus.sourceCount} sources / {corpus.chunkCount} chunks
                    </p>
                  </div>
                  <Badge tone="good">{corpus.status}</Badge>
                </div>
                <form
                  action={attachBuilderKnowledgeCorpusAction}
                  className="mt-3"
                >
                  <input name="resourceId" type="hidden" value={resourceId} />
                  <input name="corpusId" type="hidden" value={corpus.id} />
                  <Button
                    className="w-full justify-between"
                    disabled={!editable || attached}
                    type="submit"
                  >
                    <span>{attached ? "Attached" : "Attach corpus"}</span>
                    <Database aria-hidden className="size-4" />
                  </Button>
                </form>
              </div>
            )
          })
        ) : (
          <p className="rounded-md border border-line-subtle bg-surface-2 p-3 text-sm text-fg-muted">
            No published corpora are available to this Builder.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function StudioMeta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-line-subtle bg-surface-2 p-3">
      <p className="text-xs text-fg-muted">{label}</p>
      <p className="mt-1 break-words text-sm font-medium">{value}</p>
    </div>
  )
}
