"use client"

import {
  addKnowledgeUploadSourceAction,
  addKnowledgeUrlSourceAction,
  bulkKnowledgeArchiveSourceAction,
  bulkKnowledgeSourceAction,
  createKnowledgeCorpusAction,
  disableKnowledgeCorpusAction,
  hardDeleteKnowledgeCorpusAction,
  ingestKnowledgeCorpusAction,
  publishKnowledgeSnapshotAction,
  retryKnowledgeSourceAction,
  updateKnowledgeCorpusAccessAction,
} from "@/lib/admin/actions"
import {
  KNOWLEDGE_UPLOAD_ACCEPT,
  type KnowledgeUploadValidationResult,
  formatKnowledgeUploadSize,
  validateKnowledgeUploadCandidates,
} from "@/lib/knowledge/upload-policy"
import { cn } from "@/lib/utils"
import type {
  AdminTeamGroup,
  KnowledgeArchivedSource,
  KnowledgeCorpus,
  KnowledgeCorpusDetailResponse,
  KnowledgeSnapshot,
  KnowledgeSource,
} from "@llm-machines/contracts"
import {
  Archive,
  ArrowLeft,
  ArrowUpRight,
  ChevronDown,
  FileUp,
  Link2,
  Loader2,
  Plus,
  RotateCcw,
  Trash2,
  Upload,
} from "lucide-react"
import Image from "next/image"
import Link from "next/link"
import { useId, useMemo, useRef, useState } from "react"
import type { ChangeEvent, DragEvent, ReactNode, RefObject } from "react"
import { type ConsoleActionToast, ConsoleActionToasts } from "./action-toasts"

export type KnowledgeView =
  | "overview"
  | "new"
  | "archive"
  | "snapshots"
  | "add-sources"
  | "edit-sources"
type SourceStatus =
  | "blocked"
  | "disabled"
  | "extracting"
  | "failed"
  | "fetching"
  | "ingesting"
  | "pending"
  | "pending_update"
  | "success"
  | "warning"
type SourceKind = "file" | "url"

interface SourceRow {
  id: string
  corpusId: string
  language: string
  parserReport: ParserReportSummary | null
  retryable: boolean
  status: SourceStatus
  statusDetail: string | null
  statusLabel: string
  title: string
  type: string
}

interface ParserReportSummary {
  fallbackParser: string | null
  pageUnits: number | null
  qualityScore: number | null
  qualityWarningCount: number
  selectedParser: string | null
}

const SOURCE_STATUS_ICON_SRC = {
  failed: "/console-v2/status/failed.svg",
  success: "/console-v2/status/success.svg",
  warning: "/console-v2/status/warning.svg",
} as const
const EMPTY_ARCHIVED_SOURCES: KnowledgeArchivedSource[] = []
const EMPTY_TEAM_GROUPS: AdminTeamGroup[] = []
const EMPTY_SOURCE_IDS: string[] = []
const EMPTY_ARCHIVE_IDS: string[] = []

export function KnowledgeV2Experience({
  archivedSources = EMPTY_ARCHIVED_SOURCES,
  basePath = "/knowledge",
  corpora,
  detail,
  firecrawlEnabled = false,
  knowledgeAction,
  knowledgeUpload,
  selectedCorpusId,
  teamGroups = EMPTY_TEAM_GROUPS,
  view,
}: {
  archivedSources?: KnowledgeArchivedSource[]
  basePath?: "/knowledge"
  corpora: KnowledgeCorpus[]
  detail: KnowledgeCorpusDetailResponse | null
  firecrawlEnabled?: boolean
  knowledgeAction?: string
  knowledgeUpload?: string
  selectedCorpusId?: string
  teamGroups?: AdminTeamGroup[]
  view: KnowledgeView
}) {
  const groupOptions = useMemo(() => teamGroupOptions(teamGroups), [teamGroups])
  const visibleCorpora = useMemo(
    () => corpora.filter(isFrontFacingCorpus),
    [corpora],
  )
  const selectedCorpus =
    visibleCorpora.find((corpus) => corpus.id === selectedCorpusId) ??
    visibleCorpora[0] ??
    null
  const isIngested = Boolean(
    selectedCorpus &&
      (selectedCorpus.status === "staged" ||
        selectedCorpus.status === "published"),
  )
  const sourceRows = useMemo(
    () =>
      detail && selectedCorpus && detail.corpus.id === selectedCorpus.id
        ? detail.sources.map((source) =>
            sourceToRow(source, { corpusIsIngested: isIngested }),
          )
        : [],
    [detail, isIngested, selectedCorpus],
  )
  const publishedSources = useMemo(
    () =>
      selectedCorpus?.status === "published"
        ? sourceRows.filter(
            (source) =>
              source.status === "success" ||
              source.status === "warning" ||
              source.status === "disabled",
          )
        : [],
    [sourceRows, selectedCorpus?.status],
  )
  const [knowledgeUi, setKnowledgeUi] = useState({
    deleteCorpusDialogOpen: false,
    newCorpusDescription: "",
    newCorpusGroup: "Everyone",
    newCorpusName: "",
    sourceMode: "file" as SourceKind,
    urlValue: "",
  })
  const fileInputRef = useRef<HTMLInputElement>(null)
  const latestStagedSnapshot =
    detail?.snapshots.find((snapshot) => snapshot.status === "staged") ?? null
  const selectedAccessGroup = selectedCorpus?.accessGroups[0]
  const permissionGroup =
    groupOptions.find(
      (group) => group.toLowerCase() === selectedAccessGroup?.toLowerCase(),
    ) ??
    selectedAccessGroup ??
    "Everyone"

  function hrefFor(next: {
    corpusId?: string
    view?: KnowledgeView
  }) {
    const params = new URLSearchParams()
    const nextView = next.view ?? "overview"
    const corpusId =
      nextView === "archive"
        ? next.corpusId
        : (next.corpusId ?? selectedCorpus?.id)
    if (corpusId) {
      params.set("corpus", corpusId)
    }
    if (nextView !== "overview") {
      params.set("view", nextView)
    }
    const queryString = params.toString()
    return `${basePath}${queryString ? `?${queryString}` : ""}`
  }

  if (view === "archive") {
    return (
      <div className="relative w-full lg:h-[1024px]">
        <BreadcrumbHeader corpusName="" homeHref={basePath} view="archive" />

        <KnowledgeActionNotice
          knowledgeAction={knowledgeAction}
          knowledgeUpload={knowledgeUpload}
        />

        <ArchiveSourcesView
          returnTo={hrefFor({ view: "archive" })}
          sources={archivedSources}
        />
      </div>
    )
  }

  if (view === "new") {
    return (
      <div className="relative w-full lg:min-h-[1320px]">
        <BreadcrumbHeader
          corpusName=""
          homeHref={hrefFor({ view: "overview" })}
          view="new"
        />

        <KnowledgeActionNotice
          knowledgeAction={knowledgeAction}
          knowledgeUpload={knowledgeUpload}
        />

        <NewCorpusView
          description={knowledgeUi.newCorpusDescription}
          group={knowledgeUi.newCorpusGroup}
          groupOptions={groupOptions}
          name={knowledgeUi.newCorpusName}
          cancelHref={hrefFor({ view: "overview" })}
          returnTo={`${basePath}?view=new`}
          setDescription={(newCorpusDescription) =>
            setKnowledgeUi((current) => ({
              ...current,
              newCorpusDescription,
            }))
          }
          setGroup={(newCorpusGroup) =>
            setKnowledgeUi((current) => ({ ...current, newCorpusGroup }))
          }
          setName={(newCorpusName) =>
            setKnowledgeUi((current) => ({ ...current, newCorpusName }))
          }
        />
      </div>
    )
  }

  if (!selectedCorpus) {
    return (
      <div className="relative w-full lg:h-[1024px]">
        <BreadcrumbHeader
          corpusName=""
          homeHref={basePath}
          view={view === "overview" ? "overview" : view}
        />
        <section
          aria-labelledby="console-v2-corpora-title"
          className="mt-10 lg:absolute lg:top-[148px] lg:mt-0 lg:w-[640px]"
        >
          <div className="flex h-[22px] items-center justify-between">
            <h2
              className="text-lg font-semibold leading-none text-[#fdfdfd]"
              id="console-v2-corpora-title"
            >
              Copora
            </h2>
            <Link
              className="flex h-5 items-center gap-0.5 text-sm font-medium text-white transition-colors hover:text-[#d8d8d8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#009fff]"
              href={`${basePath}?view=new`}
            >
              <Plus aria-hidden className="size-5" />
              Add new
            </Link>
          </div>
          <p className="mt-4 rounded-lg border border-[#353535] bg-[#232323] p-3 text-sm leading-5 text-[#b2b2b2]">
            No active corpora exist yet.
          </p>
        </section>
      </div>
    )
  }

  return (
    <div className="relative w-full lg:min-h-[1320px]">
      <BreadcrumbHeader
        corpusName={selectedCorpus.name}
        homeHref={hrefFor({ view: "overview" })}
        view={view}
      />

      <KnowledgeActionNotice
        knowledgeAction={knowledgeAction}
        knowledgeUpload={knowledgeUpload}
      />

      {view === "overview" ? (
        <OverviewView
          addNewHref={hrefFor({ view: "new" })}
          addSourcesHref={hrefFor({ view: "add-sources" })}
          archiveHref={hrefFor({ view: "archive" })}
          snapshotsHref={hrefFor({ view: "snapshots" })}
          returnTo={hrefFor({ view: "overview" })}
          corpora={visibleCorpora}
          isIngested={isIngested}
          latestStagedSnapshot={latestStagedSnapshot}
          groupOptions={groupOptions}
          onDeleteCorpus={() =>
            setKnowledgeUi((current) => ({
              ...current,
              deleteCorpusDialogOpen: true,
            }))
          }
          permissionGroup={permissionGroup}
          corpusHref={(corpusId) => hrefFor({ corpusId, view: "overview" })}
          editSourcesHref={hrefFor({ view: "edit-sources" })}
          selectedCorpus={selectedCorpus}
        />
      ) : null}

      {view === "add-sources" ? (
        <AddSourcesView
          fileInputRef={fileInputRef}
          firecrawlEnabled={firecrawlEnabled}
          isIngested={isIngested}
          mode={knowledgeUi.sourceMode}
          returnTo={hrefFor({ view: "add-sources" })}
          corpusId={selectedCorpus.id}
          setMode={(sourceMode) =>
            setKnowledgeUi((current) => ({ ...current, sourceMode }))
          }
          setUrlValue={(urlValue) =>
            setKnowledgeUi((current) => ({ ...current, urlValue }))
          }
          sources={sourceRows}
          urlValue={knowledgeUi.urlValue}
        />
      ) : null}

      {view === "edit-sources" ? (
        <EditSourcesView
          archiveHref={hrefFor({ view: "archive" })}
          corpusId={selectedCorpus.id}
          corpusName={selectedCorpus.name}
          returnTo={hrefFor({ view: "edit-sources" })}
          sources={publishedSources}
        />
      ) : null}

      {view === "snapshots" ? (
        <SnapshotsView
          corpusName={selectedCorpus.name}
          snapshots={detail?.snapshots ?? []}
        />
      ) : null}

      {knowledgeUi.deleteCorpusDialogOpen ? (
        <ConfirmationDialog
          body="This removes the selected corpus entirely, including its source inventory. This action cannot be undone."
          corpusId={selectedCorpus.id}
          confirmLabel="Delete"
          onCancel={() =>
            setKnowledgeUi((current) => ({
              ...current,
              deleteCorpusDialogOpen: false,
            }))
          }
          returnTo={hrefFor({ view: "overview" })}
          requireDeleteConfirmation
          title="Delete corpus?"
        />
      ) : null}
    </div>
  )
}

function BreadcrumbHeader({
  corpusName,
  homeHref,
  view,
}: {
  corpusName: string
  homeHref: string
  view: KnowledgeView
}) {
  const trail =
    view === "new"
      ? ["New corpora"]
      : view === "archive"
        ? ["Archive"]
        : view === "snapshots"
          ? ["Snapshots"]
          : view === "add-sources"
            ? [corpusName, "Add sources"]
            : view === "edit-sources"
              ? ["Edit sources"]
              : []

  const showBack = view !== "overview"

  return (
    <header className="lg:absolute lg:top-[73px]">
      <h1 className="flex items-center gap-2 text-2xl font-semibold leading-none text-[#fdfdfd]">
        <Link
          className="rounded-sm text-left transition-colors hover:text-[#d9d9d9] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#009fff]"
          href={homeHref}
        >
          Knowledge
        </Link>
        {trail.map((item) => (
          <span className="flex items-center gap-2" key={item}>
            <span className="text-sm font-medium text-[#8b8b8b]">{">"}</span>
            <span className="text-sm font-medium text-[#fdfdfd]">{item}</span>
          </span>
        ))}
      </h1>
      {showBack ? (
        <Link
          className="mt-3 flex h-[18px] items-center gap-1 text-sm text-[#b2b2b2] transition-colors hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#009fff]"
          href={homeHref}
        >
          <ArrowLeft aria-hidden className="size-4" />
          Go back
        </Link>
      ) : null}
    </header>
  )
}

function KnowledgeActionNotice({
  knowledgeAction,
  knowledgeUpload,
}: {
  knowledgeAction?: string
  knowledgeUpload?: string
}) {
  const notifications: ConsoleActionToast[] = [
    ...formatKnowledgeActionStatus(knowledgeAction),
    ...formatKnowledgeUploadStatus(knowledgeUpload),
  ]

  if (notifications.length === 0) {
    return null
  }

  return <ConsoleActionToasts notifications={notifications} />
}

function formatKnowledgeActionStatus(status?: string): ConsoleActionToast[] {
  if (!status) {
    return []
  }
  const base = {
    id: `knowledge-action-${status}`,
    title: "Knowledge",
  }
  switch (status) {
    case "created":
      return [
        {
          ...base,
          description: "Corpus created.",
          tone: "success",
        },
      ]
    case "sourceAdded":
      return [
        {
          ...base,
          description: "Source added.",
          tone: "success",
        },
      ]
    case "sourcesAdded":
      return [
        {
          ...base,
          description: "Sources added.",
          tone: "success",
        },
      ]
    case "partialSourcesAdded":
      return [
        {
          ...base,
          description: "Some sources were added. Review failed items below.",
          tone: "warning",
        },
      ]
    case "sourceRetried":
      return [
        {
          ...base,
          description: "Source retry queued.",
          tone: "success",
        },
      ]
    case "duplicateUrl":
      return [
        {
          ...base,
          description: "Duplicate URL already exists in this corpus.",
          tone: "warning",
        },
      ]
    case "duplicateUpload":
      return [
        {
          ...base,
          description:
            "Duplicate document checksum already exists in this corpus.",
          tone: "warning",
        },
      ]
    case "partialDuplicateUpload":
      return [
        {
          ...base,
          description:
            "Some documents were skipped because their checksums already exist in this corpus.",
          tone: "warning",
        },
      ]
    case "failed":
      return [
        {
          ...base,
          description: "Action failed. Check the form and try again.",
          tone: "danger",
        },
      ]
    case "ingestFailed":
      return [
        {
          ...base,
          description: "Ingestion failed. Review failed sources below.",
          tone: "danger",
        },
      ]
    case "partialIngested":
      return [
        {
          ...base,
          description:
            "Ingestion completed with failed sources. Review failed items below.",
          tone: "warning",
        },
      ]
    case "ingested":
      return [
        {
          ...base,
          description: "Ingestion completed.",
          tone: "success",
        },
      ]
    case "published":
      return [
        {
          ...base,
          description: "Corpus published.",
          tone: "success",
        },
      ]
    case "permissionsUpdated":
      return [
        {
          ...base,
          description: "Permissions updated.",
          tone: "success",
        },
      ]
    case "disabled":
      return [
        {
          ...base,
          description: "Corpus disabled.",
          tone: "warning",
        },
      ]
    case "hardDeleted":
      return [
        {
          ...base,
          description: "Corpus deleted.",
          tone: "danger",
        },
      ]
    case "sourcesDisabled":
      return [
        {
          ...base,
          description: "Selected sources disabled.",
          tone: "warning",
        },
      ]
    case "sourcesArchived":
      return [
        {
          ...base,
          description: "Selected sources archived.",
          tone: "success",
        },
      ]
    case "sourcesHardDeleted":
      return [
        {
          ...base,
          description: "Selected sources deleted.",
          tone: "danger",
        },
      ]
    case "archiveSourcesRestored":
      return [
        {
          ...base,
          description: "Archived sources restored.",
          tone: "success",
        },
      ]
    case "archiveSourcesHardDeleted":
      return [
        {
          ...base,
          description: "Archived sources deleted.",
          tone: "danger",
        },
      ]
    case "discarded":
      return [
        {
          ...base,
          description: "Staged snapshot discarded.",
          tone: "warning",
        },
      ]
    default:
      return [
        {
          ...base,
          description: "Knowledge action completed.",
          tone: "success",
        },
      ]
  }
}

function formatKnowledgeUploadStatus(
  uploadStatus?: string,
): ConsoleActionToast[] {
  if (!uploadStatus) {
    return []
  }
  const match = /^uploaded-(\d+)-failed-(\d+)$/.exec(uploadStatus)
  const base = {
    id: `knowledge-upload-${uploadStatus}`,
    title: "Document upload",
  }
  if (!match) {
    return [
      {
        ...base,
        description: "Upload completed.",
        tone: "success",
      },
    ]
  }
  const addedCount = Number.parseInt(match[1] ?? "0", 10)
  const failedCount = Number.parseInt(match[2] ?? "0", 10)
  return [
    {
      ...base,
      description: `${addedCount} added, ${failedCount} failed.`,
      tone:
        failedCount > 0 ? (addedCount > 0 ? "warning" : "danger") : "success",
    },
  ]
}

function OverviewView({
  addNewHref,
  addSourcesHref,
  archiveHref,
  corpora,
  corpusHref,
  editSourcesHref,
  isIngested,
  latestStagedSnapshot,
  groupOptions,
  onDeleteCorpus,
  permissionGroup,
  returnTo,
  selectedCorpus,
  snapshotsHref,
}: {
  addNewHref: string
  addSourcesHref: string
  archiveHref: string
  corpora: KnowledgeCorpus[]
  corpusHref: (corpusId: string) => string
  editSourcesHref: string
  groupOptions: string[]
  isIngested: boolean
  latestStagedSnapshot: KnowledgeSnapshot | null
  onDeleteCorpus: () => void
  permissionGroup: string
  returnTo: string
  selectedCorpus: KnowledgeCorpus
  snapshotsHref: string
}) {
  const showPublishReadyIndicator = Boolean(
    latestStagedSnapshot &&
      selectedCorpus.status !== "disabled" &&
      selectedCorpus.status !== "published",
  )

  return (
    <>
      <section
        aria-labelledby="console-v2-corpora-title"
        className="mt-10 lg:absolute lg:top-[148px] lg:mt-0 lg:w-[640px]"
      >
        <div className="flex h-[22px] items-center justify-between">
          <h2
            className="text-lg font-semibold leading-none text-[#fdfdfd]"
            id="console-v2-corpora-title"
          >
            Copora
          </h2>
          <Link
            className="flex h-5 items-center gap-0.5 text-sm font-medium text-white transition-colors hover:text-[#d8d8d8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#009fff]"
            href={addNewHref}
          >
            <Plus aria-hidden className="size-5" />
            Add new
          </Link>
        </div>

        <div
          aria-label="Corpora carousel"
          className="scrollbar-none mt-2 flex h-[57px] w-full gap-1 overflow-x-auto overflow-y-hidden"
        >
          {corpora.map((corpus) => (
            <CorpusTile
              corpus={corpus}
              href={corpusHref(corpus.id)}
              key={corpus.id}
              selected={corpus.id === selectedCorpus.id}
            />
          ))}
        </div>
      </section>

      <div className="mt-8 flex w-full flex-col gap-3 overflow-hidden rounded-lg border border-[#353535] bg-[#232323] p-3 lg:absolute lg:top-[253px] lg:mt-0 lg:w-[640px]">
        <ActionRow
          action={
            <Link className={smallButtonClass()} href={addSourcesHref}>
              Import
            </Link>
          }
          description="Upload documents or add URLs to the selected corpus before ingestion."
          label="Add sources"
        />
        <ActionDivider />
        <ActionRow
          action={
            selectedCorpus.status === "published" ? (
              <button className={smallButtonClass()} disabled type="button">
                Published
              </button>
            ) : (
              <form
                action={publishKnowledgeSnapshotAction}
                className="inline-flex items-center gap-2"
              >
                <input
                  name="corpusId"
                  type="hidden"
                  value={selectedCorpus.id}
                />
                <input name="returnTo" type="hidden" value={returnTo} />
                <input
                  name="snapshotId"
                  type="hidden"
                  value={latestStagedSnapshot?.id ?? ""}
                />
                {showPublishReadyIndicator ? (
                  <ActionReadyIndicator testId="publish-ready-indicator" />
                ) : null}
                <button
                  className={smallButtonClass()}
                  disabled={
                    selectedCorpus.status === "disabled" ||
                    !latestStagedSnapshot ||
                    (!isIngested && selectedCorpus.sourceCount === 0)
                  }
                  type="submit"
                >
                  Publish
                </button>
              </form>
            )
          }
          description="Make the latest ingested snapshot available to approved apps and agents."
          label="Publishing"
        />
        <ActionDivider />
        <ActionRow
          action={
            <form
              action={updateKnowledgeCorpusAccessAction}
              className="flex items-center"
            >
              <input name="corpusId" type="hidden" value={selectedCorpus.id} />
              <input name="returnTo" type="hidden" value={returnTo} />
              <label className="relative flex items-center gap-1 text-sm font-medium leading-[18px] text-white">
                <select
                  aria-label="Corpus permissions"
                  className="appearance-none bg-transparent py-1.5 pr-6 text-right outline-none transition-colors hover:text-[#d8d8d8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#009fff]"
                  name="accessGroups"
                  defaultValue={permissionGroup}
                  onChange={(event) =>
                    event.currentTarget.form?.requestSubmit()
                  }
                >
                  {groupOptions.map((group) => (
                    <option className="bg-[#181818]" key={group} value={group}>
                      {group}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  aria-hidden
                  className="pointer-events-none absolute right-0 size-5"
                />
              </label>
            </form>
          }
          description="Choose which team group can discover and query this corpus."
          label="Permissions"
        />
        <ActionDivider />
        <ActionRow
          action={
            <Link
              className="flex items-center gap-1 py-1.5 text-sm font-medium leading-[18px] text-white transition-colors hover:text-[#d8d8d8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#009fff]"
              href={editSourcesHref}
            >
              View sources
              <ArrowUpRight aria-hidden className="size-5" />
            </Link>
          }
          description="Review published sources and manage item-level availability."
          label="Edit sources"
        />
        <ActionDivider />
        <ActionRow
          action={
            <form action={disableKnowledgeCorpusAction}>
              <input name="corpusId" type="hidden" value={selectedCorpus.id} />
              <input name="returnTo" type="hidden" value={returnTo} />
              <button
                className={smallButtonClass()}
                disabled={selectedCorpus.status === "disabled"}
                type="submit"
              >
                Disable
              </button>
            </form>
          }
          description="Stop this corpus from being queried without deleting its sources."
          label="Disable Corpora"
        />
        <ActionDivider />
        <ActionRow
          action={
            <button
              className={smallButtonClass("danger")}
              onClick={onDeleteCorpus}
              type="button"
            >
              Delete
            </button>
          }
          description="Permanently remove this corpus and its source inventory."
          label="Delete Corpora"
        />
      </div>

      <AuditCard archiveHref={archiveHref} snapshotsHref={snapshotsHref} />
    </>
  )
}

function AuditCard({
  archiveHref,
  snapshotsHref,
}: {
  archiveHref: string
  snapshotsHref: string
}) {
  return (
    <section
      aria-label="Knowledge audit"
      className="mt-8 flex flex-col gap-[10px] overflow-hidden rounded-lg border border-[#353535] bg-[#232323] p-3 lg:absolute lg:top-[795px] lg:mt-0 lg:w-[640px]"
    >
      <AuditCardRow
        action={
          <Link className={auditLinkClass()} href={snapshotsHref}>
            View snapshots
            <ArrowUpRight aria-hidden className="size-5" />
          </Link>
        }
        description="Review each staged or published ingestion snapshot for the selected corpus."
        title="Snapshots"
      />
      <ActionDivider />
      <AuditCardRow
        action={
          <Link className={auditLinkClass()} href={archiveHref}>
            View archive
            <ArrowUpRight aria-hidden className="size-5" />
          </Link>
        }
        description="Open archived source files that are hidden from active corpus inventory."
        title="Archive"
      />
      <ActionDivider />
      <AuditCardRow
        action={
          <button
            className="inline-flex h-[30px] items-center justify-center rounded-md bg-[#2e2e2e] px-2.5 py-1.5 text-sm font-medium leading-[18px] text-white opacity-50"
            disabled
            type="button"
          >
            Export
          </button>
        }
        description="Exportable audit logs are tracked for the production pass."
        title="Export Logs"
      />
    </section>
  )
}

function AuditCardRow({
  action,
  description,
  title,
}: {
  action: ReactNode
  description: string
  title: string
}) {
  return (
    <div className="flex items-center gap-10">
      <div className="flex min-w-0 flex-1 flex-col gap-2 font-medium">
        <p className="text-base leading-normal text-white">{title}</p>
        <p className="text-sm leading-5 text-[#b2b2b2]">{description}</p>
      </div>
      {action}
    </div>
  )
}

function auditLinkClass() {
  return "inline-flex items-center justify-center gap-1 rounded-md py-1.5 text-sm font-medium leading-[18px] text-white transition-colors hover:text-[#d8d8d8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#009fff]"
}

function SnapshotsView({
  corpusName,
  snapshots,
}: {
  corpusName: string
  snapshots: KnowledgeSnapshot[]
}) {
  return (
    <section className="mt-16 lg:absolute lg:top-[160px] lg:mt-0 lg:w-[640px]">
      <SubpageToolbar title="Snapshots" />
      <p className="mt-3 text-sm leading-5 text-[#b2b2b2]">
        Snapshot history for staged and published corpus ingestions.
      </p>
      <div className="mt-4">
        <SnapshotTable corpusName={corpusName} snapshots={snapshots} />
      </div>
    </section>
  )
}

function SnapshotTable({
  corpusName,
  snapshots,
}: {
  corpusName: string
  snapshots: KnowledgeSnapshot[]
}) {
  if (snapshots.length === 0) {
    return (
      <p className="rounded-lg border border-[#242424] bg-[#181818] p-3 text-sm leading-5 text-[#b2b2b2]">
        No staged or published snapshots for this corpus.
      </p>
    )
  }

  return (
    <div className="w-full overflow-hidden rounded-lg border border-[#242424] bg-[#181818]">
      <div className="grid h-11 grid-cols-[32px_1fr_96px_160px] items-center border-b border-[#242424] px-2 text-xs text-white">
        <span>#</span>
        <span>Corpora</span>
        <span>Sources</span>
        <span>date/time</span>
      </div>
      {snapshots.map((snapshot, index) => (
        <div
          className="grid h-10 grid-cols-[32px_1fr_96px_160px] items-center border-b border-[#242424] px-2 text-xs text-white last:border-b-0"
          key={snapshot.id}
        >
          <span>{String(index + 1).padStart(2, "0")}</span>
          <span className="truncate">{corpusName}</span>
          <span>{snapshot.sourceCount}</span>
          <span>
            {formatDateTime(snapshot.publishedAt ?? snapshot.createdAt)}
          </span>
        </div>
      ))}
    </div>
  )
}

function NewCorpusView({
  cancelHref,
  description,
  group,
  groupOptions,
  name,
  returnTo,
  setDescription,
  setGroup,
  setName,
}: {
  cancelHref: string
  description: string
  group: string
  groupOptions: string[]
  name: string
  returnTo: string
  setDescription: (value: string) => void
  setGroup: (value: string) => void
  setName: (value: string) => void
}) {
  return (
    <form
      action={createKnowledgeCorpusAction}
      aria-labelledby="new-corpus-title"
      className="mt-16 rounded-lg border border-[#353535] bg-[#232323] p-3 lg:absolute lg:top-[148px] lg:mt-0 lg:w-[640px]"
    >
      <input name="returnTo" type="hidden" value={returnTo} />
      <h2
        className="text-lg font-semibold leading-none text-[#fdfdfd]"
        id="new-corpus-title"
      >
        New corpora
      </h2>

      <div className="mt-6 grid gap-5">
        <label className="grid gap-2 text-sm font-medium text-white">
          Name
          <input
            className="h-10 rounded-md border border-[#353535] bg-[#181818] px-3 text-sm text-white outline-none transition-colors placeholder:text-[#6f6f6f] hover:border-[#464646] focus:border-[#009fff]"
            name="name"
            onChange={(event) => setName(event.target.value)}
            placeholder="Corpus name"
            required
            value={name}
          />
        </label>
        <label className="grid gap-2 text-sm font-medium text-white">
          Description
          <textarea
            className="min-h-24 resize-none rounded-md border border-[#353535] bg-[#181818] px-3 py-2 text-sm text-white outline-none transition-colors placeholder:text-[#6f6f6f] hover:border-[#464646] focus:border-[#009fff]"
            name="description"
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Summarize what this corpus contains and who should use it."
            value={description}
          />
        </label>
        <label className="grid gap-2 text-sm font-medium text-white">
          Permissions
          <select
            className="h-10 rounded-md border border-[#353535] bg-[#181818] px-3 text-sm text-white outline-none transition-colors hover:border-[#464646] focus:border-[#009fff]"
            name="accessGroups"
            onChange={(event) => setGroup(event.target.value)}
            value={group}
          >
            {groupOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-6 flex justify-end gap-2">
        <Link
          className="rounded-md px-2.5 py-1.5 text-sm text-[#b2b2b2] transition-colors hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#009fff]"
          href={cancelHref}
        >
          Cancel
        </Link>
        <button
          className="rounded-md bg-[#2e2e2e] px-2.5 py-1.5 text-sm font-medium text-white transition-colors hover:bg-[#3a3a3a] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#009fff]"
          type="submit"
        >
          Create corpora
        </button>
      </div>
    </form>
  )
}

function AddSourcesView({
  corpusId,
  fileInputRef,
  firecrawlEnabled,
  isIngested,
  mode,
  returnTo,
  setMode,
  setUrlValue,
  sources,
  urlValue,
}: {
  corpusId: string
  fileInputRef: RefObject<HTMLInputElement | null>
  firecrawlEnabled: boolean
  isIngested: boolean
  mode: SourceKind
  returnTo: string
  setMode: (mode: SourceKind) => void
  setUrlValue: (value: string) => void
  sources: SourceRow[]
  urlValue: string
}) {
  const [uploadValidation, setUploadValidation] =
    useState<KnowledgeUploadValidationResult | null>(null)
  const [isUploadSubmitting, setIsUploadSubmitting] = useState(false)
  const [isIngestSubmitting, setIsIngestSubmitting] = useState(false)
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([])
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const uploadFormId = useId()
  const ingestionAction = ingestionActionForSources(sources, isIngested)
  const canUpload = uploadValidation?.valid === true
  const selectedSourceCount = selectedSourceIds.length
  const allVisibleSelected =
    sources.length > 0 &&
    sources.every((source) => selectedSourceIds.includes(source.id))

  function updateSelectedFiles(files: FileList | File[]) {
    const nextFiles = Array.from(files)
    setIsUploadSubmitting(false)
    setUploadValidation(
      validateKnowledgeUploadCandidates(
        nextFiles.map((file) => ({
          name: file.name,
          size: file.size,
        })),
      ),
    )
  }

  function handleDrop(event: DragEvent<HTMLFormElement>) {
    event.preventDefault()
    if (event.dataTransfer.files.length > 0) {
      if (fileInputRef.current) {
        fileInputRef.current.files = event.dataTransfer.files
      }
      updateSelectedFiles(event.dataTransfer.files)
    }
  }

  function toggleSelectionMode() {
    if (selectionMode) {
      setSelectionMode(false)
      setSelectedSourceIds([])
      return
    }
    setSelectionMode(true)
  }

  function toggleSource(sourceId: string) {
    setSelectedSourceIds((current) =>
      current.includes(sourceId)
        ? current.filter((id) => id !== sourceId)
        : [...current, sourceId],
    )
  }

  function toggleAllSources() {
    if (allVisibleSelected) {
      setSelectedSourceIds([])
      return
    }
    setSelectedSourceIds(sources.map((source) => source.id))
  }

  return (
    <section className="mt-16 lg:absolute lg:top-[148px] lg:mt-0 lg:w-[640px]">
      <SubpageToolbar title="Add sources" />

      <div className="mt-4 rounded-lg border border-[#353535] bg-[#232323] p-3">
        <div className="flex w-fit gap-1 rounded-md bg-[#181818] p-1">
          <button
            className={segmentedClass(mode === "file")}
            onClick={() => setMode("file")}
            type="button"
          >
            <FileUp aria-hidden className="size-4" />
            Import
          </button>
          <button
            className={segmentedClass(mode === "url")}
            onClick={() => setMode("url")}
            type="button"
          >
            <Link2 aria-hidden className="size-4" />
            URL
          </button>
        </div>

        {mode === "file" ? (
          <form
            action={addKnowledgeUploadSourceAction}
            className="mt-4 grid min-h-[156px] place-items-center rounded-lg border border-dashed border-[#444] bg-[#181818] p-6 text-center transition-colors hover:border-[#5a5a5a]"
            data-testid="knowledge-upload-form"
            id={uploadFormId}
            onDragOver={(event) => event.preventDefault()}
            onDrop={handleDrop}
            onSubmit={(event) => {
              if (!canUpload || isUploadSubmitting) {
                event.preventDefault()
                return
              }
              setIsUploadSubmitting(true)
            }}
          >
            <input name="corpusId" type="hidden" value={corpusId} />
            <input name="returnTo" type="hidden" value={returnTo} />
            <div>
              <Upload aria-hidden className="mx-auto size-6 text-[#b2b2b2]" />
              <p className="mt-3 text-base font-medium text-white">
                Drop files here
              </p>
              <p className="mt-1 text-sm text-[#b2b2b2]">
                PDF, DOCX, PPTX, TXT, MD, HTML, CSV, TSV, XLSX, ODT, ODS, ODP,
                RTF, EML, MSG, EPUB, JSON, XML, YAML, and images
              </p>
              <input
                aria-label="Select source files"
                accept={KNOWLEDGE_UPLOAD_ACCEPT}
                className="sr-only"
                multiple
                name="files"
                onChange={(event: ChangeEvent<HTMLInputElement>) => {
                  if (event.target.files) {
                    updateSelectedFiles(event.target.files)
                  }
                }}
                ref={fileInputRef}
                type="file"
              />
              <div className="mt-4 flex justify-center gap-2">
                <button
                  className="rounded-md bg-[#2e2e2e] px-2.5 py-1.5 text-sm font-medium text-white transition-colors hover:bg-[#3a3a3a] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#009fff]"
                  disabled={isUploadSubmitting}
                  onClick={() => fileInputRef.current?.click()}
                  type="button"
                >
                  Select files
                </button>
              </div>
            </div>
          </form>
        ) : (
          <form
            action={addKnowledgeUrlSourceAction}
            className="mt-4 grid gap-3"
          >
            <input name="corpusId" type="hidden" value={corpusId} />
            <input name="acquisitionMode" type="hidden" value="single_page" />
            <input name="returnTo" type="hidden" value={returnTo} />
            {firecrawlEnabled ? null : (
              <input name="scraper" type="hidden" value="safe_fetch" />
            )}
            <div className="flex gap-2">
              <input
                aria-label="Source URL"
                className="h-10 min-w-0 flex-1 rounded-md border border-[#353535] bg-[#181818] px-3 text-sm text-white outline-none transition-colors placeholder:text-[#6f6f6f] hover:border-[#464646] focus:border-[#009fff]"
                name="url"
                onChange={(event) => setUrlValue(event.target.value)}
                placeholder="https://docs.example.com/source"
                required
                type="url"
                value={urlValue}
              />
              <button
                className="rounded-md bg-[#2e2e2e] px-2.5 py-1.5 text-sm font-medium text-white transition-colors hover:bg-[#3a3a3a] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#009fff]"
                type="submit"
              >
                Add URL
              </button>
            </div>
            <input
              aria-label="Source title"
              className="h-10 rounded-md border border-[#353535] bg-[#181818] px-3 text-sm text-white outline-none transition-colors placeholder:text-[#6f6f6f] hover:border-[#464646] focus:border-[#009fff]"
              name="title"
              placeholder="Source title"
            />
            {firecrawlEnabled ? (
              <details className="rounded-md border border-[#353535] bg-[#181818] p-2 text-sm text-white">
                <summary className="cursor-pointer text-[#b2b2b2]">
                  Advanced
                </summary>
                <label className="mt-3 grid gap-2 text-xs text-[#b2b2b2]">
                  Scraper
                  <select
                    className="h-9 rounded-md border border-[#353535] bg-[#232323] px-2 text-sm text-white outline-none focus:border-[#009fff]"
                    name="scraper"
                  >
                    <option value="safe_fetch">Safe fetch</option>
                    <option value="firecrawl">Firecrawl</option>
                  </select>
                </label>
              </details>
            ) : null}
          </form>
        )}
      </div>
      {mode === "file" ? (
        <SelectedUploadFiles
          canUpload={canUpload}
          isUploading={isUploadSubmitting}
          uploadFormId={uploadFormId}
          validation={uploadValidation}
        />
      ) : null}

      {sources.length > 0 ? (
        <div className="mt-6">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold leading-none text-[#fdfdfd]">
              Uploaded content
            </h2>
            <div className="flex items-center gap-1">
              <button
                aria-pressed={selectionMode}
                className={smallButtonClass("outline")}
                onClick={toggleSelectionMode}
                type="button"
              >
                {selectionMode ? "Deselect" : "Select"}
              </button>
              {selectedSourceCount > 0 ? (
                <button
                  className={smallButtonClass("danger")}
                  onClick={() => setDeleteDialogOpen(true)}
                  type="button"
                >
                  Delete
                </button>
              ) : null}
              <form
                action={ingestKnowledgeCorpusAction}
                className="inline-flex items-center gap-2"
                data-testid="knowledge-ingest-form"
                onSubmit={(event) => {
                  if (!ingestionAction.enabled || isIngestSubmitting) {
                    event.preventDefault()
                    return
                  }
                  setIsIngestSubmitting(true)
                }}
              >
                <input name="corpusId" type="hidden" value={corpusId} />
                <input name="returnTo" type="hidden" value={returnTo} />
                {ingestionAction.enabled && !isIngestSubmitting ? (
                  <ActionReadyIndicator testId="ingest-ready-indicator" />
                ) : null}
                <button
                  className="inline-flex items-center gap-1.5 rounded-md bg-[#2e2e2e] px-2.5 py-1.5 text-sm font-medium text-white transition-colors hover:bg-[#3a3a3a] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#009fff]"
                  disabled={!ingestionAction.enabled || isIngestSubmitting}
                  type="submit"
                >
                  {isIngestSubmitting ? (
                    <Loader2 aria-hidden className="size-3.5 animate-spin" />
                  ) : null}
                  {isIngestSubmitting ? "Ingesting" : ingestionAction.label}
                </button>
              </form>
            </div>
          </div>
          <SourceTable
            allSelected={allVisibleSelected}
            includeRetry
            isIngesting={isIngestSubmitting}
            onToggleAll={toggleAllSources}
            onToggleSource={toggleSource}
            returnTo={returnTo}
            selectable={selectionMode}
            selectedSourceIds={selectedSourceIds}
            sources={sources}
          />
        </div>
      ) : null}
      {deleteDialogOpen ? (
        <SourceHardDeleteDialog
          corpusId={corpusId}
          onCancel={() => setDeleteDialogOpen(false)}
          returnTo={returnTo}
          sourceIds={selectedSourceIds}
        />
      ) : null}
    </section>
  )
}

function SelectedUploadFiles({
  canUpload,
  isUploading,
  uploadFormId,
  validation,
}: {
  canUpload: boolean
  isUploading: boolean
  uploadFormId: string
  validation: KnowledgeUploadValidationResult | null
}) {
  if (!validation) {
    return (
      <p className="mt-3 text-sm leading-5 text-[#b2b2b2]">
        Select at least one document before upload. Maximum batch size is 5
        files and 50.0 MB per file.
      </p>
    )
  }

  return (
    <div className="mt-3 rounded-lg border border-[#353535] bg-[#181818] p-3">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-sm font-medium leading-5 text-white">
          Selected files
        </h2>
        <div className="flex items-center gap-2">
          <p className="text-xs leading-5 text-[#b2b2b2]">
            {validation.files.length} selected
          </p>
          <button
            className="inline-flex items-center gap-1.5 rounded-md border border-[#353535] px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:border-[#4a4a4a] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#009fff]"
            disabled={!canUpload || isUploading}
            form={uploadFormId}
            type="submit"
          >
            {isUploading ? (
              <Loader2 aria-hidden className="size-3.5 animate-spin" />
            ) : null}
            {isUploading ? "Uploading" : "Upload"}
          </button>
        </div>
      </div>
      {validation.errors.length > 0 ? (
        <ul
          aria-label="Upload validation errors"
          className="mt-2 list-inside list-disc text-xs leading-5 text-[#ff6b6b]"
        >
          {validation.errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      ) : null}
      <div className="mt-3 overflow-hidden rounded-md border border-[#242424]">
        {validation.files.map((file) => {
          const rowIsUploading = isUploading && !file.error
          return (
            <div
              className="grid min-h-10 grid-cols-[1fr_56px_80px_144px] items-center gap-2 border-b border-[#242424] px-2 text-xs text-white last:border-b-0"
              key={`${file.name}-${file.size}`}
            >
              <span className="truncate">{file.name}</span>
              <span>{`.${file.extension}`}</span>
              <span>{formatKnowledgeUploadSize(file.size)}</span>
              <span
                className={cn(
                  "inline-flex min-w-0 items-center gap-1.5 truncate",
                  file.error ? "text-[#ff6b6b]" : "text-[#8de99a]",
                  rowIsUploading ? "text-[#b9dcff]" : null,
                )}
              >
                {rowIsUploading ? (
                  <Loader2
                    aria-label="Uploading"
                    className="size-3.5 shrink-0 animate-spin text-[#009fff]"
                    role="img"
                  />
                ) : null}
                {rowIsUploading
                  ? "Uploading"
                  : (file.error ?? "Ready to upload")}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function EditSourcesView({
  archiveHref,
  corpusId,
  corpusName,
  returnTo,
  sources,
}: {
  archiveHref: string
  corpusId: string
  corpusName: string
  returnTo: string
  sources: SourceRow[]
}) {
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([])
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const selectedSourceCount = selectedSourceIds.length
  const allVisibleSelected =
    sources.length > 0 &&
    sources.every((source) => selectedSourceIds.includes(source.id))

  function toggleSelectionMode() {
    if (selectionMode) {
      setSelectionMode(false)
      setSelectedSourceIds([])
      return
    }
    setSelectionMode(true)
  }

  function toggleSource(sourceId: string) {
    setSelectedSourceIds((current) =>
      current.includes(sourceId)
        ? current.filter((id) => id !== sourceId)
        : [...current, sourceId],
    )
  }

  function toggleAllSources() {
    if (allVisibleSelected) {
      setSelectedSourceIds([])
      return
    }
    setSelectedSourceIds(sources.map((source) => source.id))
  }

  return (
    <section className="mt-16 lg:absolute lg:top-[160px] lg:mt-0 lg:w-[640px]">
      <div className="flex h-[30px] items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-[#fdfdfd]">{corpusName}</h2>
          <Link
            className="text-sm font-medium text-[#8b8b8b] transition-colors hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#009fff]"
            href={archiveHref}
          >
            View archive
          </Link>
        </div>
        <div className="flex gap-1">
          <button
            aria-pressed={selectionMode}
            className={smallButtonClass("outline")}
            onClick={toggleSelectionMode}
            type="button"
          >
            {selectionMode ? "Deselect" : "Select"}
          </button>
          {selectedSourceCount > 0 ? (
            <>
              <form action={bulkKnowledgeSourceAction}>
                <SourceBulkActionFields
                  action="disable"
                  corpusId={corpusId}
                  returnTo={returnTo}
                  sourceIds={selectedSourceIds}
                />
                <button className={smallButtonClass()} type="submit">
                  Disable
                </button>
              </form>
              <form action={bulkKnowledgeSourceAction}>
                <SourceBulkActionFields
                  action="archive"
                  corpusId={corpusId}
                  returnTo={returnTo}
                  sourceIds={selectedSourceIds}
                />
                <button className={smallButtonClass()} type="submit">
                  <Archive aria-hidden className="size-4" />
                  Archive
                </button>
              </form>
              <button
                className={smallButtonClass("danger")}
                onClick={() => setDeleteDialogOpen(true)}
                type="button"
              >
                Delete
              </button>
            </>
          ) : null}
        </div>
      </div>
      <div className="mt-2">
        <SourceTable
          allSelected={allVisibleSelected}
          onToggleAll={toggleAllSources}
          onToggleSource={toggleSource}
          returnTo={returnTo}
          selectable={selectionMode}
          selectedSourceIds={selectedSourceIds}
          sources={sources}
        />
      </div>
      {deleteDialogOpen ? (
        <SourceHardDeleteDialog
          corpusId={corpusId}
          onCancel={() => setDeleteDialogOpen(false)}
          returnTo={returnTo}
          sourceIds={selectedSourceIds}
        />
      ) : null}
    </section>
  )
}

function ArchiveSourcesView({
  returnTo,
  sources,
}: {
  returnTo: string
  sources: KnowledgeArchivedSource[]
}) {
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedArchiveIds, setSelectedArchiveIds] = useState<string[]>([])
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const selectedArchiveCount = selectedArchiveIds.length
  const allVisibleSelected =
    sources.length > 0 &&
    sources.every((source) => selectedArchiveIds.includes(source.id))

  function toggleSelectionMode() {
    if (selectionMode) {
      setSelectionMode(false)
      setSelectedArchiveIds([])
      return
    }
    setSelectionMode(true)
  }

  function toggleArchiveSource(archiveId: string) {
    setSelectedArchiveIds((current) =>
      current.includes(archiveId)
        ? current.filter((id) => id !== archiveId)
        : [...current, archiveId],
    )
  }

  function toggleAllArchiveSources() {
    if (allVisibleSelected) {
      setSelectedArchiveIds([])
      return
    }
    setSelectedArchiveIds(sources.map((source) => source.id))
  }

  return (
    <section className="mt-16 lg:absolute lg:top-[160px] lg:mt-0 lg:w-[640px]">
      <div className="flex h-[30px] items-center justify-between">
        <h2 className="text-lg font-semibold text-[#fdfdfd]">
          Archived sources
        </h2>
        <div className="flex gap-1">
          <button
            aria-pressed={selectionMode}
            className={smallButtonClass("outline")}
            onClick={toggleSelectionMode}
            type="button"
          >
            {selectionMode ? "Unselect" : "Select"}
          </button>
          {selectedArchiveCount > 0 ? (
            <>
              <form action={bulkKnowledgeArchiveSourceAction}>
                <ArchiveBulkActionFields
                  action="restore"
                  archivedSourceIds={selectedArchiveIds}
                  returnTo={returnTo}
                />
                <button className={smallButtonClass()} type="submit">
                  <RotateCcw aria-hidden className="size-4" />
                  Restore
                </button>
              </form>
              <button
                className={smallButtonClass("danger")}
                onClick={() => setDeleteDialogOpen(true)}
                type="button"
              >
                <Trash2 aria-hidden className="size-4" />
                Delete
              </button>
            </>
          ) : null}
        </div>
      </div>
      <div className="mt-2">
        <ArchiveSourceTable
          allSelected={allVisibleSelected}
          onToggleAll={toggleAllArchiveSources}
          onToggleSource={toggleArchiveSource}
          selectable={selectionMode}
          selectedArchiveIds={selectedArchiveIds}
          sources={sources}
        />
      </div>
      {deleteDialogOpen ? (
        <ArchiveHardDeleteDialog
          archivedSourceIds={selectedArchiveIds}
          onCancel={() => setDeleteDialogOpen(false)}
          returnTo={returnTo}
        />
      ) : null}
    </section>
  )
}

function CorpusTile({
  corpus,
  href,
  selected,
}: {
  corpus: KnowledgeCorpus
  href: string
  selected: boolean
}) {
  return (
    <Link
      aria-current={selected ? "page" : undefined}
      className={cn(
        "group flex h-[57px] w-[246px] shrink-0 items-center gap-4 overflow-hidden rounded-lg p-3 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#009fff]",
        selected
          ? "bg-[#2a2a2a]"
          : "border border-[#2a2a2a] hover:border-[#454545] hover:bg-[#202020]",
      )}
      href={href}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1 font-medium">
        <p className="truncate text-sm leading-[17px] text-white">
          {corpus.name}
        </p>
        <p className="truncate text-[10px] leading-3 text-[#b2b2b2]">
          {corpus.description || "No description set."}
        </p>
      </div>
      <span
        aria-hidden
        className={cn(
          "grid size-4 shrink-0 place-items-center rounded-full transition-colors",
          selected
            ? "bg-[#009fff]"
            : "border border-[#353535] group-hover:border-[#5a5a5a]",
        )}
      >
        {selected ? <span className="size-1.5 rounded-full bg-white" /> : null}
      </span>
    </Link>
  )
}

function ActionRow({
  action,
  description,
  label,
}: {
  action: ReactNode
  description: string
  label: string
}) {
  return (
    <div className="flex h-[55px] shrink-0 items-center gap-10">
      <div className="flex min-w-0 flex-1 flex-col gap-2 font-medium">
        <p className="text-base leading-[19px] text-white">{label}</p>
        <p className="max-h-5 overflow-hidden text-sm leading-5 text-[#b2b2b2]">
          {description}
        </p>
      </div>
      <div className="flex h-full shrink-0 items-center justify-end">
        {action}
      </div>
    </div>
  )
}

function ActionReadyIndicator({ testId }: { testId: string }) {
  return (
    <span
      aria-hidden
      className="relative flex size-2.5 shrink-0"
      data-testid={testId}
    >
      <span className="absolute inline-flex size-full animate-ping rounded-full bg-[#52e27c] opacity-70" />
      <span className="relative inline-flex size-2.5 rounded-full bg-[#52e27c]" />
    </span>
  )
}

function ActionDivider() {
  return <span aria-hidden className="h-0 border-t border-[#353535]" />
}

function sourceWithPendingIngestion(source: SourceRow): SourceRow {
  return {
    ...source,
    status: "ingesting",
    statusDetail: "Ingestion running",
    statusLabel: "Ingesting",
  }
}

function SourceTable({
  allSelected = false,
  includeRetry = false,
  isIngesting = false,
  onToggleAll,
  onToggleSource,
  returnTo,
  selectable = false,
  selectedSourceIds = EMPTY_SOURCE_IDS,
  sources,
}: {
  allSelected?: boolean
  includeRetry?: boolean
  isIngesting?: boolean
  onToggleAll?: () => void
  onToggleSource?: (sourceId: string) => void
  returnTo: string
  selectable?: boolean
  selectedSourceIds?: string[]
  sources: SourceRow[]
}) {
  return (
    <div className="w-full overflow-hidden rounded-lg border border-[#242424] bg-[#181818]">
      <div className="grid h-11 grid-cols-[32px_minmax(0,128px)_56px_64px_minmax(0,1fr)_150px] items-center gap-2 border-b border-[#242424] px-2 text-xs text-white">
        {selectable ? (
          <input
            aria-label="Select all source rows"
            checked={allSelected}
            className="size-4 accent-[#009fff]"
            onChange={onToggleAll}
            type="checkbox"
          />
        ) : (
          <span>#</span>
        )}
        <span>Title</span>
        <span className="flex items-center gap-1">
          Language <ChevronDown aria-hidden className="size-4" />
        </span>
        <span className="flex items-center gap-1">
          Type <ChevronDown aria-hidden className="size-4" />
        </span>
        <span className="flex items-center gap-1">
          Parser <ChevronDown aria-hidden className="size-4" />
        </span>
        <span className="flex items-center gap-1">
          Status <ChevronDown aria-hidden className="size-4" />
        </span>
      </div>
      {sources.map((source, index) => {
        const displayedSource =
          isIngesting &&
          (source.status === "pending" || source.status === "pending_update")
            ? sourceWithPendingIngestion(source)
            : source
        return (
          <div
            className="grid min-h-12 grid-cols-[32px_minmax(0,128px)_56px_64px_minmax(0,1fr)_150px] items-center gap-2 border-b border-[#242424] px-2 py-1 text-xs text-white transition-colors hover:bg-[#202020]"
            key={`${source.id}-${index}`}
          >
            {selectable ? (
              <input
                aria-label={`Select ${source.title}`}
                checked={selectedSourceIds.includes(source.id)}
                className="size-4 accent-[#009fff]"
                onChange={() => onToggleSource?.(source.id)}
                type="checkbox"
              />
            ) : (
              <span>{String(index + 1).padStart(2, "0")}</span>
            )}
            <span className="truncate">{source.title}</span>
            <span>{source.language}</span>
            <span>{source.type}</span>
            <ParserReportCell report={source.parserReport} />
            <SourceStatusCell
              includeRetry={includeRetry}
              returnTo={returnTo}
              source={displayedSource}
            />
          </div>
        )
      })}
    </div>
  )
}

function ParserReportCell({
  report,
}: {
  report: ParserReportSummary | null
}) {
  if (!report?.selectedParser) {
    return <span className="truncate text-[#8b8b8b]">Pending</span>
  }

  const detailParts = [
    report.fallbackParser ? `fallback ${report.fallbackParser}` : null,
    report.pageUnits != null ? `${report.pageUnits} units` : null,
    report.qualityScore != null ? `q ${report.qualityScore}` : null,
    report.qualityWarningCount > 0
      ? `${report.qualityWarningCount} warnings`
      : null,
  ].filter(Boolean)

  return (
    <span
      className="min-w-0 truncate text-[#b2b2b2]"
      title={[report.selectedParser, ...detailParts].join(" / ")}
    >
      <span className="text-white">{report.selectedParser}</span>
      {detailParts.length > 0 ? (
        <span className="text-[#8b8b8b]"> / {detailParts.join(" / ")}</span>
      ) : null}
    </span>
  )
}

function SourceBulkActionFields({
  action,
  corpusId,
  returnTo,
  sourceIds,
}: {
  action: "archive" | "disable" | "hard_delete"
  corpusId: string
  returnTo: string
  sourceIds: string[]
}) {
  return (
    <>
      <input name="corpusId" type="hidden" value={corpusId} />
      <input name="returnTo" type="hidden" value={returnTo} />
      <input name="sourceAction" type="hidden" value={action} />
      {sourceIds.map((sourceId) => (
        <input key={sourceId} name="sourceIds" type="hidden" value={sourceId} />
      ))}
    </>
  )
}

function SourceHardDeleteDialog({
  corpusId,
  onCancel,
  returnTo,
  sourceIds,
}: {
  corpusId: string
  onCancel: () => void
  returnTo: string
  sourceIds: string[]
}) {
  return (
    <dialog
      aria-labelledby="source-delete-dialog-title"
      className="fixed inset-0 z-50 m-0 grid h-screen max-h-none w-screen max-w-none place-items-center border-0 bg-black/60 p-4 text-left text-inherit"
      open
    >
      <div className="w-full max-w-[360px] rounded-lg border border-[#353535] bg-[#232323] p-3 shadow-2xl">
        <h3
          className="text-base font-semibold leading-5 text-white"
          id="source-delete-dialog-title"
        >
          Delete selected sources?
        </h3>
        <p className="mt-3 text-sm leading-5 text-[#b2b2b2]">
          This removes the selected items from the corpus entirely. This action
          cannot be undone.
        </p>
        <form action={bulkKnowledgeSourceAction} className="mt-6 grid gap-4">
          <SourceBulkActionFields
            action="hard_delete"
            corpusId={corpusId}
            returnTo={returnTo}
            sourceIds={sourceIds}
          />
          <label className="grid gap-2 text-sm font-medium text-white">
            Type DELETE to confirm
            <input
              className="h-10 rounded-md border border-[#353535] bg-[#181818] px-3 text-sm text-white outline-none transition-colors placeholder:text-[#6f6f6f] hover:border-[#464646] focus:border-[#009fff]"
              name="confirmation"
              placeholder="DELETE"
              required
            />
          </label>
          <div className="flex justify-end gap-1">
            <button
              className={smallButtonClass("outline")}
              onClick={onCancel}
              type="button"
            >
              Cancel
            </button>
            <button className={smallButtonClass("danger")} type="submit">
              Delete
            </button>
          </div>
        </form>
      </div>
    </dialog>
  )
}

function ArchiveSourceTable({
  allSelected = false,
  onToggleAll,
  onToggleSource,
  selectable = false,
  selectedArchiveIds = EMPTY_ARCHIVE_IDS,
  sources,
}: {
  allSelected?: boolean
  onToggleAll?: () => void
  onToggleSource?: (archiveId: string) => void
  selectable?: boolean
  selectedArchiveIds?: string[]
  sources: KnowledgeArchivedSource[]
}) {
  if (sources.length === 0) {
    return (
      <p className="rounded-lg border border-[#242424] bg-[#181818] p-3 text-sm leading-5 text-[#b2b2b2]">
        No archived source files.
      </p>
    )
  }

  return (
    <div className="w-full overflow-hidden rounded-lg border border-[#242424] bg-[#181818]">
      <div className="grid h-11 grid-cols-[32px_150px_120px_1fr_78px] items-center border-b border-[#242424] px-2 text-xs text-white">
        {selectable ? (
          <input
            aria-label="Select all archived source rows"
            checked={allSelected}
            className="size-4 accent-[#009fff]"
            onChange={onToggleAll}
            type="checkbox"
          />
        ) : (
          <span>#</span>
        )}
        <span>Title</span>
        <span>Corpus</span>
        <span className="flex items-center gap-1">
          Type <ChevronDown aria-hidden className="size-4" />
        </span>
        <span>Archived</span>
      </div>
      {sources.map((source, index) => (
        <div
          className="grid h-10 grid-cols-[32px_150px_120px_1fr_78px] items-center border-b border-[#242424] px-2 text-xs text-white"
          key={source.id}
        >
          {selectable ? (
            <input
              aria-label={`Select archived ${source.title}`}
              checked={selectedArchiveIds.includes(source.id)}
              className="size-4 accent-[#009fff]"
              onChange={() => onToggleSource?.(source.id)}
              type="checkbox"
            />
          ) : (
            <span>{String(index + 1).padStart(2, "0")}</span>
          )}
          <span className="truncate">{source.title}</span>
          <span className="truncate">{source.corpusName}</span>
          <span>{archivedSourceTypeLabel(source)}</span>
          <span>{formatShortDate(source.archivedAt)}</span>
        </div>
      ))}
    </div>
  )
}

function ArchiveBulkActionFields({
  action,
  archivedSourceIds,
  returnTo,
}: {
  action: "hard_delete" | "restore"
  archivedSourceIds: string[]
  returnTo: string
}) {
  return (
    <>
      <input name="returnTo" type="hidden" value={returnTo} />
      <input name="sourceAction" type="hidden" value={action} />
      {archivedSourceIds.map((sourceId) => (
        <input
          key={sourceId}
          name="archivedSourceIds"
          type="hidden"
          value={sourceId}
        />
      ))}
    </>
  )
}

function ArchiveHardDeleteDialog({
  archivedSourceIds,
  onCancel,
  returnTo,
}: {
  archivedSourceIds: string[]
  onCancel: () => void
  returnTo: string
}) {
  return (
    <dialog
      aria-labelledby="archive-delete-dialog-title"
      className="fixed inset-0 z-50 m-0 grid h-screen max-h-none w-screen max-w-none place-items-center border-0 bg-black/60 p-4 text-left text-inherit"
      open
    >
      <div className="w-full max-w-[360px] rounded-lg border border-[#353535] bg-[#232323] p-3 shadow-2xl">
        <h3
          className="text-base font-semibold leading-5 text-white"
          id="archive-delete-dialog-title"
        >
          Delete archived sources?
        </h3>
        <p className="mt-3 text-sm leading-5 text-[#b2b2b2]">
          Hard delete removes archived source records and stored source objects.
          This action cannot be undone.
        </p>
        <form
          action={bulkKnowledgeArchiveSourceAction}
          className="mt-6 grid gap-4"
        >
          <ArchiveBulkActionFields
            action="hard_delete"
            archivedSourceIds={archivedSourceIds}
            returnTo={returnTo}
          />
          <label className="grid gap-2 text-sm font-medium text-white">
            Type DELETE to confirm
            <input
              className="h-10 rounded-md border border-[#353535] bg-[#181818] px-3 text-sm text-white outline-none transition-colors placeholder:text-[#6f6f6f] hover:border-[#464646] focus:border-[#009fff]"
              name="confirmation"
              placeholder="DELETE"
              required
            />
          </label>
          <div className="flex justify-end gap-1">
            <button
              className={smallButtonClass("outline")}
              onClick={onCancel}
              type="button"
            >
              Cancel
            </button>
            <button className={smallButtonClass("danger")} type="submit">
              Delete
            </button>
          </div>
        </form>
      </div>
    </dialog>
  )
}

function SourceStatusCell({
  includeRetry,
  returnTo,
  source,
}: {
  includeRetry: boolean
  returnTo: string
  source: SourceRow
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <StatusMarker status={source.status} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium leading-4 text-white">
          {source.statusLabel}
        </p>
        {source.statusDetail ? (
          <p
            className="truncate text-[11px] leading-4 text-[#8b8b8b]"
            title={source.statusDetail}
          >
            {source.statusDetail}
          </p>
        ) : null}
      </div>
      {includeRetry && source.retryable ? (
        <form action={retryKnowledgeSourceAction}>
          <input name="corpusId" type="hidden" value={source.corpusId} />
          <input name="sourceId" type="hidden" value={source.id} />
          <input name="returnTo" type="hidden" value={returnTo} />
          <button
            className="inline-flex h-7 items-center gap-1 rounded-md border border-[#353535] px-2 text-[11px] font-medium leading-none text-white transition-colors hover:border-[#4a4a4a] hover:bg-[#242424] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#009fff]"
            type="submit"
          >
            <RotateCcw aria-hidden className="size-3" />
            Retry
          </button>
        </form>
      ) : null}
    </div>
  )
}

function StatusMarker({ status }: { status: SourceStatus }) {
  if (status === "pending" || status === "pending_update") {
    const label = status === "pending_update" ? "Pending update" : "Pending"
    return (
      <span
        aria-label={label}
        className={cn(
          "grid size-5 shrink-0 place-items-center rounded-full border",
          status === "pending_update"
            ? "border-[#009fff]/70"
            : "border-[#5a5a5a]",
        )}
        title={label}
      >
        <span
          aria-hidden
          className={cn(
            "size-1.5 rounded-full",
            status === "pending_update" ? "bg-[#009fff]" : "bg-[#b2b2b2]",
          )}
        />
      </span>
    )
  }

  if (
    status === "fetching" ||
    status === "extracting" ||
    status === "ingesting"
  ) {
    const label =
      status === "ingesting"
        ? "Ingesting"
        : status === "extracting"
          ? "Extracting"
          : "Uploading"
    return (
      <Loader2
        aria-label={label}
        className="size-5 shrink-0 animate-spin text-[#009fff]"
        role="img"
      />
    )
  }

  if (status === "success") {
    return (
      <SourceStatusImage
        label="Ingestion successful"
        src={SOURCE_STATUS_ICON_SRC.success}
      />
    )
  }

  if (status === "failed") {
    return (
      <SourceStatusImage
        label="Not ingested"
        src={SOURCE_STATUS_ICON_SRC.failed}
      />
    )
  }

  if (status === "blocked") {
    return (
      <SourceStatusImage label="Blocked" src={SOURCE_STATUS_ICON_SRC.failed} />
    )
  }

  if (status === "disabled") {
    return (
      <span
        aria-label="Disabled"
        className="grid size-5 shrink-0 place-items-center rounded-full border border-[#4a4a4a]"
        title="Disabled"
      >
        <span aria-hidden className="h-px w-2.5 rounded-full bg-[#8b8b8b]" />
      </span>
    )
  }

  if (status === "warning") {
    return (
      <SourceStatusImage
        label="Ingestion warning"
        src={SOURCE_STATUS_ICON_SRC.warning}
      />
    )
  }

  return (
    <SourceStatusImage
      label="Ingestion successful"
      src={SOURCE_STATUS_ICON_SRC.success}
    />
  )
}

function SourceStatusImage({
  ariaHidden = false,
  className,
  label,
  src,
}: {
  ariaHidden?: boolean
  className?: string
  label: string
  src: string
}) {
  return (
    <Image
      alt={ariaHidden ? "" : label}
      aria-hidden={ariaHidden}
      aria-label={ariaHidden ? undefined : label}
      className={cn("size-5", className)}
      draggable={false}
      height={20}
      src={src}
      title={ariaHidden ? undefined : label}
      width={20}
    />
  )
}

function ConfirmationDialog({
  body,
  corpusId,
  confirmLabel,
  onCancel,
  onConfirm,
  requireDeleteConfirmation = false,
  returnTo,
  title,
}: {
  body: string
  corpusId?: string
  confirmLabel: string
  onCancel: () => void
  onConfirm?: () => void
  requireDeleteConfirmation?: boolean
  returnTo?: string
  title: string
}) {
  const actions = requireDeleteConfirmation ? (
    <form action={hardDeleteKnowledgeCorpusAction} className="mt-6 grid gap-4">
      <input name="corpusId" type="hidden" value={corpusId ?? ""} />
      <input name="returnTo" type="hidden" value={returnTo ?? ""} />
      <label className="grid gap-2 text-sm font-medium text-white">
        Type DELETE to confirm
        <input
          className="h-10 rounded-md border border-[#353535] bg-[#181818] px-3 text-sm text-white outline-none transition-colors placeholder:text-[#6f6f6f] hover:border-[#464646] focus:border-[#009fff]"
          name="confirmation"
          placeholder="DELETE"
          required
        />
      </label>
      <div className="flex justify-end gap-1">
        <button
          className={smallButtonClass("outline")}
          onClick={onCancel}
          type="button"
        >
          Cancel
        </button>
        <button className={smallButtonClass("danger")} type="submit">
          {confirmLabel}
        </button>
      </div>
    </form>
  ) : (
    <div className="mt-6 flex justify-end gap-1">
      <button
        className={smallButtonClass("outline")}
        onClick={onCancel}
        type="button"
      >
        Cancel
      </button>
      <button
        className={smallButtonClass("danger")}
        onClick={onConfirm}
        type="button"
      >
        {confirmLabel}
      </button>
    </div>
  )

  return (
    <dialog
      aria-labelledby="confirmation-dialog-title"
      className="fixed inset-0 z-50 m-0 grid h-screen max-h-none w-screen max-w-none place-items-center border-0 bg-black/60 p-4 text-left text-inherit"
      open
    >
      <div className="w-full max-w-[360px] rounded-lg border border-[#353535] bg-[#232323] p-3 shadow-2xl">
        <h3
          className="text-base font-semibold leading-5 text-white"
          id="confirmation-dialog-title"
        >
          {title}
        </h3>
        <p className="mt-3 text-sm leading-5 text-[#b2b2b2]">{body}</p>
        {actions}
      </div>
    </dialog>
  )
}

function SubpageToolbar({ title }: { title: string }) {
  return (
    <div className="flex items-center justify-between">
      <h2 className="text-lg font-semibold leading-none text-[#fdfdfd]">
        {title}
      </h2>
    </div>
  )
}

function segmentedClass(active: boolean) {
  return cn(
    "flex items-center gap-1 rounded px-2.5 py-1.5 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#009fff]",
    active ? "bg-[#2e2e2e] text-white" : "text-[#b2b2b2] hover:text-white",
  )
}

function smallButtonClass(tone?: "danger" | "outline") {
  return cn(
    "inline-flex h-[30px] shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-md px-2.5 py-1.5 text-center text-sm font-medium leading-[18px] transition-colors disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#009fff]",
    tone === "outline"
      ? "border border-[#2e2e2e] text-white hover:border-[#4a4a4a]"
      : "bg-[#2e2e2e] hover:bg-[#3a3a3a]",
    tone === "danger" ? "bg-[#321f20] text-[#ff595d]" : "text-white",
  )
}

function isFrontFacingCorpus(corpus: KnowledgeCorpus) {
  return corpus.status !== "archived" && corpus.status !== "deleted"
}

function teamGroupOptions(groups: AdminTeamGroup[]): string[] {
  const options = new Map<string, string>()
  for (const group of groups) {
    const name = group.name.trim()
    if (!name || name.toLowerCase() === "everyone") {
      continue
    }
    options.set(name.toLowerCase(), name)
  }
  return ["Everyone", ...options.values()]
}

function sourceToRow(
  source: KnowledgeSource,
  { corpusIsIngested }: { corpusIsIngested: boolean },
): SourceRow {
  const rowStatus = sourceStatusToRowStatus(source, corpusIsIngested)
  return {
    corpusId: source.corpusId,
    id: source.id,
    language: source.language?.toUpperCase() ?? "N/A",
    parserReport: parserReportSummaryForSource(source),
    retryable: sourceRetryable(source),
    status: rowStatus,
    statusDetail: sourceStatusDetail(source, rowStatus),
    statusLabel: sourceStatusLabel(source, rowStatus),
    title: source.title,
    type: sourceTypeLabel(source),
  }
}

function parserReportSummaryForSource(
  source: KnowledgeSource,
): ParserReportSummary | null {
  const extraction = recordValue(source.metadata, "extraction")
  const parserReport = recordValue(extraction, "parser_report")
  if (!parserReport) {
    return null
  }

  return {
    fallbackParser: stringValue(parserReport, "fallbackParser"),
    pageUnits: numberValue(parserReport, "pageUnits"),
    qualityScore: numberValue(parserReport, "qualityScore"),
    qualityWarningCount: arrayLength(parserReport, "qualityWarnings"),
    selectedParser: stringValue(parserReport, "selectedParser"),
  }
}

function recordValue(
  value: unknown,
  key: string,
): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null
  }
  const child = (value as Record<string, unknown>)[key]
  return child && typeof child === "object" && !Array.isArray(child)
    ? (child as Record<string, unknown>)
    : null
}

function stringValue(
  value: Record<string, unknown>,
  key: string,
): string | null {
  const child = value[key]
  return typeof child === "string" && child.length > 0 ? child : null
}

function numberValue(
  value: Record<string, unknown>,
  key: string,
): number | null {
  const child = value[key]
  return typeof child === "number" && Number.isFinite(child) ? child : null
}

function arrayLength(value: Record<string, unknown>, key: string): number {
  const child = value[key]
  return Array.isArray(child) ? child.length : 0
}

function ingestionActionForSources(
  sources: SourceRow[],
  isIngested: boolean,
): { enabled: boolean; label: string } {
  const activeSource = sources.some(
    (source) => source.status === "fetching" || source.status === "extracting",
  )
  if (activeSource) {
    return { enabled: false, label: "Upload in progress" }
  }

  const pendingSource = sources.some(
    (source) =>
      source.status === "pending" || source.status === "pending_update",
  )
  if (pendingSource) {
    return {
      enabled: true,
      label: isIngested ? "Ingest updates" : "Ingest",
    }
  }

  if (sources.some((source) => source.status === "blocked")) {
    return { enabled: false, label: "Ingestion blocked" }
  }

  if (sources.some((source) => source.status === "failed")) {
    return { enabled: false, label: "Ingestion failed" }
  }

  if (isIngested) {
    return { enabled: false, label: "Ingestion complete" }
  }

  return { enabled: false, label: "Ingest" }
}

function sourceStatusToRowStatus(
  source: KnowledgeSource,
  corpusIsIngested: boolean,
): SourceStatus {
  if (source.status === "ready") {
    return sourceWarningCount(source) > 0 ? "warning" : "success"
  }
  if (source.status === "fetching") {
    return "fetching"
  }
  if (source.status === "extracting") {
    return "extracting"
  }
  if (source.status === "blocked") {
    return "blocked"
  }
  if (source.status === "failed" || source.status === "removed") {
    return "failed"
  }
  if (source.status === "disabled") {
    return "disabled"
  }
  return corpusIsIngested ? "pending_update" : "pending"
}

function sourceStatusLabel(
  source: KnowledgeSource,
  rowStatus: SourceStatus,
): string {
  if (rowStatus === "success") {
    return "Ready"
  }
  if (rowStatus === "warning") {
    return "Ready with warnings"
  }
  if (rowStatus === "fetching") {
    return source.sourceType === "url" ? "Uploading" : "Uploading"
  }
  if (rowStatus === "extracting") {
    return "Extracting"
  }
  if (rowStatus === "failed") {
    if (source.status === "removed") {
      return "Removed"
    }
    return "Failed"
  }
  if (rowStatus === "blocked") {
    return "Blocked"
  }
  if (rowStatus === "disabled") {
    return "Disabled"
  }
  if (rowStatus === "pending_update") {
    return "Pending update"
  }
  return "Pending"
}

function sourceStatusDetail(
  source: KnowledgeSource,
  rowStatus: SourceStatus,
): string | null {
  if (source.errorDetail) {
    return source.errorDetail
  }
  if (rowStatus === "warning") {
    const warningCount = sourceWarningCount(source)
    return warningCount === 1
      ? "1 parser warning"
      : `${warningCount} parser warnings`
  }
  if (rowStatus === "fetching") {
    return source.sourceType === "url"
      ? "Fetching URL content"
      : "Upload running"
  }
  if (rowStatus === "extracting") {
    return "Parser running"
  }
  if (rowStatus === "pending_update") {
    return "Run ingestion to stage this source"
  }
  if (rowStatus === "pending") {
    return "Ready for ingestion"
  }
  return null
}

function sourceWarningCount(source: KnowledgeSource): number {
  const warnings = source.metadata.warnings
  if (Array.isArray(warnings)) {
    return warnings.length
  }

  const extraction = recordValue(source.metadata, "extraction")
  const parserReport = extraction
    ? recordValue(extraction, "parser_report")
    : null
  return parserReport ? arrayLength(parserReport, "qualityWarnings") : 0
}

function sourceRetryable(source: KnowledgeSource): boolean {
  return source.status === "failed"
}

function sourceTypeLabel(source: KnowledgeSource) {
  if (source.sourceType === "url") {
    return "URL"
  }
  if (source.sourceType === "table") {
    return ".csv"
  }
  if (source.sourceType === "image") {
    return imageExtension(source)
  }
  return fileExtension(source.title || source.originalUri || source.mimeType)
}

function archivedSourceTypeLabel(source: KnowledgeArchivedSource) {
  if (source.sourceType === "url") {
    return "URL"
  }
  if (source.sourceType === "table") {
    return ".csv"
  }
  if (source.sourceType === "image") {
    return imageExtension(source)
  }
  return fileExtension(source.title || source.originalUri || source.mimeType)
}

function formatShortDate(value: string) {
  return new Date(value).toLocaleDateString("en-US", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  })
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("en-US", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  })
}

function imageExtension(source: Pick<KnowledgeSource, "mimeType">) {
  if (source.mimeType.includes("png")) {
    return ".png"
  }
  if (source.mimeType.includes("jpeg") || source.mimeType.includes("jpg")) {
    return ".jpg"
  }
  return "image"
}

function fileExtension(fileName: string) {
  const extension = fileName.includes(".")
    ? `.${fileName.split(".").pop() ?? "file"}`
    : ".file"
  return extension.toLowerCase()
}
