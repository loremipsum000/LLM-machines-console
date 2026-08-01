import type { RetainedConsoleRole } from "@/lib/auth/role-claims"
import { cn } from "@/lib/utils"
import type {
  AdminAuditEvent,
  AdminAuditMetadataEntry,
  AdminAuditResponse,
  AdminAuditSource,
  InferenceCoreAuditOutcome,
  InferenceCoreAuditSourceSystem,
  InferenceCoreSeverity,
  InferenceCoreSourceStatus,
} from "@llm-machines/contracts/inference-core"
import { Download, X } from "lucide-react"
import Link from "next/link"

export interface ActivityFilters {
  applicationId: string | null
  cursor: string | null
  eventId: string | null
  limit: string | null
  outcome: InferenceCoreAuditOutcome | null
  query: string | null
  severity: InferenceCoreSeverity | null
  source: InferenceCoreAuditSourceSystem | null
}

export type ActivityAuditMetadataEntry = AdminAuditMetadataEntry
export type ActivityAuditEvent = AdminAuditEvent
export type ActivityAuditSource = AdminAuditSource
export type ActivityViewModel = Pick<
  AdminAuditResponse,
  "events" | "generatedAt" | "nextCursor" | "sources" | "sourceStatus"
>

interface ActivityV2ExperienceProps {
  accessRole: RetainedConsoleRole
  activity: ActivityViewModel
  basePath?: string
  filters: ActivityFilters
}

export function ActivityV2Experience({
  accessRole,
  activity,
  basePath = "/activity",
  filters,
}: ActivityV2ExperienceProps) {
  const selectedEvent = filters.eventId
    ? (activity.events.find((event) => event.id === filters.eventId) ?? null)
    : null

  return (
    <div className="w-full min-h-screen pb-16 pt-8 lg:pt-[73px]">
      <header>
        <h1 className="text-2xl font-semibold leading-none text-[#fdfdfd]">
          Activity &amp; Audit
        </h1>
        <p className="mt-3 max-w-[600px] text-sm leading-5 text-[#b2b2b2]">
          Metadata-only appliance control-plane events. Workload prompts,
          responses, search terms, URLs, and retrieved content are not included.
        </p>
      </header>

      <section className="mt-8 flex flex-col gap-4 lg:w-[640px]">
        <ActivitySourceHealth activity={activity} />
        <ActivityFiltersPanel
          activity={activity}
          basePath={basePath}
          filters={filters}
        />
        {accessRole === "admin" ? (
          <ActivityExportControls
            filters={filters}
            generatedAt={activity.generatedAt}
          />
        ) : (
          <OperatorExportBoundary />
        )}
        {filters.eventId ? (
          <ActivityEventDetail
            basePath={basePath}
            event={selectedEvent}
            filters={filters}
          />
        ) : null}
        <ActivityTimeline
          activity={activity}
          basePath={basePath}
          filters={filters}
        />
      </section>
    </div>
  )
}

function ActivitySourceHealth({ activity }: { activity: ActivityViewModel }) {
  return (
    <section
      aria-labelledby="activity-source-health-title"
      className="rounded-lg border border-[#353535] bg-[#232323] p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <StatusDot status={activity.sourceStatus} />
          <h2
            className="text-base font-semibold leading-[19px] text-white"
            id="activity-source-health-title"
          >
            Audit source health
          </h2>
        </div>
        <span className="rounded-full border border-[#454545] bg-[#181818] px-2 py-1 text-xs font-medium leading-none text-[#b2b2b2]">
          {sourceStatusLabel(activity.sourceStatus)}
        </span>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {activity.sources.map((source) => (
          <div
            className="flex items-start justify-between gap-3 rounded-md border border-[#353535] bg-[#1d1d1d] px-3 py-2"
            key={source.id}
          >
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-[#dfdfdf]">
                {source.label}
              </span>
              <span className="mt-1 block text-xs leading-4 text-[#9f9f9f]">
                {auditSourceDetail(source)}
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-1.5 text-xs text-[#b2b2b2]">
              <StatusDot status={source.sourceStatus} />
              {sourceStatusLabel(source.sourceStatus)}
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}

function ActivityFiltersPanel({
  activity,
  basePath,
  filters,
}: {
  activity: ActivityViewModel
  basePath: string
  filters: ActivityFilters
}) {
  const hasFilters = activeFilterCount(filters) > 0

  return (
    <section
      aria-labelledby="activity-filters-title"
      className="rounded-lg border border-[#353535] bg-[#232323] p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2
          className="text-base font-semibold leading-[19px] text-white"
          id="activity-filters-title"
        >
          Filters
        </h2>
        {hasFilters ? (
          <Link
            className="inline-flex items-center gap-1.5 text-xs font-medium text-[#b2b2b2] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#009fff]"
            href={basePath}
          >
            <X aria-hidden className="size-3.5" />
            Clear filters
          </Link>
        ) : null}
      </div>

      {filters.applicationId ? (
        <p className="mt-3 rounded-md border border-[#244b5e] bg-[#1d3038] px-3 py-2 text-xs leading-5 text-[#9fdfff]">
          Application identifier: {filters.applicationId}
        </p>
      ) : null}

      <form action={basePath} className="mt-3 grid gap-3" method="get">
        {filters.applicationId ? (
          <input
            name="applicationId"
            type="hidden"
            value={filters.applicationId}
          />
        ) : null}
        <label className="grid gap-1.5 text-xs font-medium text-[#b2b2b2]">
          Search metadata
          <input
            className="h-9 rounded-md border border-[#353535] bg-[#181818] px-3 text-sm text-white outline-none placeholder:text-[#777777] focus:border-[#009fff]"
            defaultValue={filters.query ?? ""}
            name="q"
            placeholder="Event, action, subject, application, credential, or reason"
            type="search"
          />
        </label>
        <div className="grid gap-3 sm:grid-cols-3">
          <FilterSelect
            defaultValue={filters.source}
            label="Source"
            name="source"
            options={activity.sources.map((source) => ({
              label: source.label,
              value: source.id,
            }))}
          />
          <FilterSelect
            defaultValue={filters.outcome}
            label="Outcome"
            name="outcome"
            options={[
              { label: "Succeeded", value: "succeeded" },
              { label: "Failed", value: "failed" },
              { label: "Denied", value: "denied" },
            ]}
          />
          <FilterSelect
            defaultValue={filters.severity}
            label="Severity"
            name="severity"
            options={[
              { label: "Info", value: "info" },
              { label: "Warning", value: "warning" },
              { label: "Critical", value: "critical" },
            ]}
          />
        </div>
        <div>
          <button
            className="inline-flex h-9 items-center justify-center rounded-md bg-[#009fff] px-3 text-sm font-semibold text-[#06131d] transition-colors hover:bg-[#26adff] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#009fff]"
            type="submit"
          >
            Apply filters
          </button>
        </div>
      </form>
    </section>
  )
}

function FilterSelect({
  defaultValue,
  label,
  name,
  options,
}: {
  defaultValue: string | null
  label: string
  name: string
  options: Array<{ label: string; value: string }>
}) {
  return (
    <label className="grid gap-1.5 text-xs font-medium text-[#b2b2b2]">
      {label}
      <select
        className="h-9 rounded-md border border-[#353535] bg-[#181818] px-2 text-sm text-white outline-none focus:border-[#009fff]"
        defaultValue={defaultValue ?? ""}
        name={name}
      >
        <option value="">All</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function ActivityExportControls({
  filters,
  generatedAt,
}: {
  filters: ActivityFilters
  generatedAt: string
}) {
  const exportWindow = defaultExportWindow(generatedAt)

  return (
    <section
      aria-labelledby="activity-export-title"
      className="rounded-lg border border-[#353535] bg-[#232323] p-3"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2
            className="text-sm font-semibold leading-5 text-white"
            id="activity-export-title"
          >
            Signed audit export
          </h2>
          <p className="mt-1 max-w-[440px] text-xs leading-5 text-[#b2b2b2]">
            Admin-only compact JWS using the active filters. Choose an inclusive
            UTC range of up to 365 days.
          </p>
        </div>
        <Link
          className="inline-flex h-9 shrink-0 items-center justify-center rounded-md border border-[#353535] bg-[#2e2e2e] px-3 text-xs font-medium text-white transition-colors hover:bg-[#353535] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#009fff]"
          href="/api/admin/audit/export/verification-keys"
        >
          Verification keys
        </Link>
      </div>

      <form
        action="/api/admin/audit/export"
        className="mt-3 grid gap-3"
        method="get"
      >
        <ExportFilterInputs filters={filters} />
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1.5 text-xs font-medium text-[#b2b2b2]">
            From (UTC)
            <input
              className="h-9 rounded-md border border-[#353535] bg-[#181818] px-3 text-sm text-white outline-none focus:border-[#009fff]"
              defaultValue={exportWindow.from}
              name="from"
              required
              type="datetime-local"
            />
          </label>
          <label className="grid gap-1.5 text-xs font-medium text-[#b2b2b2]">
            To (UTC)
            <input
              className="h-9 rounded-md border border-[#353535] bg-[#181818] px-3 text-sm text-white outline-none focus:border-[#009fff]"
              defaultValue={exportWindow.to}
              name="to"
              required
              type="datetime-local"
            />
          </label>
          <label className="grid gap-1.5 text-xs font-medium text-[#b2b2b2]">
            Export rows
            <input
              className="h-9 rounded-md border border-[#353535] bg-[#181818] px-3 text-sm text-white outline-none focus:border-[#009fff]"
              defaultValue="5000"
              max="5000"
              min="1"
              name="limit"
              required
              type="number"
            />
          </label>
          <label className="grid gap-1.5 text-xs font-medium text-[#b2b2b2]">
            Export cursor (optional)
            <input
              className="h-9 rounded-md border border-[#353535] bg-[#181818] px-3 text-sm text-white outline-none placeholder:text-[#777777] focus:border-[#009fff]"
              name="cursor"
              placeholder="Continue a signed export page"
              type="text"
            />
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <ExportSubmitButton format="json" />
          <ExportSubmitButton format="csv" />
        </div>
      </form>
    </section>
  )
}

function ExportFilterInputs({ filters }: { filters: ActivityFilters }) {
  const entries = [
    ["q", filters.query],
    ["applicationId", filters.applicationId],
    ["eventId", filters.eventId],
    ["source", filters.source],
    ["outcome", filters.outcome],
    ["severity", filters.severity],
  ] as const

  return entries.map(([name, value]) =>
    value ? <input key={name} name={name} type="hidden" value={value} /> : null,
  )
}

function ExportSubmitButton({ format }: { format: "csv" | "json" }) {
  return (
    <button
      className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-[#353535] bg-[#2e2e2e] px-3 text-sm font-medium text-white transition-colors hover:bg-[#353535] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#009fff]"
      name="format"
      type="submit"
      value={format}
    >
      <Download aria-hidden className="size-4" />
      Export {format.toUpperCase()}
    </button>
  )
}

function OperatorExportBoundary() {
  return (
    <section
      aria-label="Audit export access"
      className="rounded-lg border border-[#353535] bg-[#232323] p-3 text-xs leading-5 text-[#b2b2b2]"
    >
      Operators can view and filter audit metadata. Signed exports require Admin
      access.
    </section>
  )
}

function ActivityEventDetail({
  basePath,
  event,
  filters,
}: {
  basePath: string
  event: ActivityAuditEvent | null
  filters: ActivityFilters
}) {
  return (
    <section
      aria-labelledby="activity-event-detail-title"
      className="rounded-lg border border-[#454545] bg-[#232323] p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2
          className="text-base font-semibold leading-[19px] text-white"
          id="activity-event-detail-title"
        >
          Event detail
        </h2>
        <Link
          className="text-xs font-medium text-[#b2b2b2] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#009fff]"
          href={activityHref(basePath, filters, { eventId: null })}
        >
          Close detail
        </Link>
      </div>
      {event ? (
        <div className="mt-3">
          <EventFacts event={event} />
          {event.reason ? (
            <p className="mt-3 rounded-md border border-[#5b4a18] bg-[#302914] px-3 py-2 text-xs leading-5 text-[#ffdc7a]">
              Reason: {event.reason}
            </p>
          ) : null}
          {event.metadata.length > 0 ? (
            <MetadataList entries={event.metadata} />
          ) : null}
        </div>
      ) : (
        <p className="mt-3 text-sm leading-5 text-[#b2b2b2]">
          The selected event was not returned by the bounded audit query.
        </p>
      )}
    </section>
  )
}

function ActivityTimeline({
  activity,
  basePath,
  filters,
}: {
  activity: ActivityViewModel
  basePath: string
  filters: ActivityFilters
}) {
  return (
    <section aria-labelledby="activity-timeline-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2
            className="text-base font-semibold leading-[19px] text-white"
            id="activity-timeline-title"
          >
            Audit timeline
          </h2>
          <p className="mt-1 text-xs leading-5 text-[#9f9f9f]">
            Generated {formatTimestamp(activity.generatedAt)}
          </p>
        </div>
        <span className="text-xs font-medium text-[#b2b2b2]">
          {activity.events.length} event
          {activity.events.length === 1 ? "" : "s"}
        </span>
      </div>

      {activity.events.length === 0 ? (
        <div className="mt-3 rounded-lg border border-dashed border-[#353535] bg-[#232323] p-5 text-sm leading-5 text-[#b2b2b2]">
          No audit events match the current filters.
        </div>
      ) : (
        <ol className="mt-3 flex flex-col gap-2">
          {activity.events.map((event) => (
            <li key={event.id}>
              <ActivityEventRow
                basePath={basePath}
                event={event}
                filters={filters}
                selected={event.id === filters.eventId}
              />
            </li>
          ))}
        </ol>
      )}

      {activity.nextCursor ? (
        <Link
          className="mt-3 inline-flex h-9 items-center justify-center rounded-md border border-[#353535] bg-[#232323] px-3 text-sm font-medium text-white transition-colors hover:bg-[#2e2e2e] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#009fff]"
          href={activityHref(basePath, filters, {
            cursor: activity.nextCursor,
            eventId: null,
          })}
        >
          Load older events
        </Link>
      ) : null}
    </section>
  )
}

function ActivityEventRow({
  basePath,
  event,
  filters,
  selected,
}: {
  basePath: string
  event: ActivityAuditEvent
  filters: ActivityFilters
  selected: boolean
}) {
  return (
    <article
      className={cn(
        "rounded-lg border bg-[#232323] p-3",
        selected ? "border-[#009fff]" : "border-[#353535]",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <SeverityPill severity={event.severity} />
            <OutcomePill outcome={event.outcome} />
            <span className="text-xs font-medium text-[#9f9f9f]">
              {event.sourceSystem}
            </span>
          </div>
          <h3 className="mt-2 break-words text-sm font-semibold leading-5 text-white">
            {event.action}
          </h3>
          <p className="mt-1 break-words text-xs leading-5 text-[#b2b2b2]">
            {event.targetType}: {event.targetId}
          </p>
        </div>
        <div className="shrink-0 text-right text-xs leading-5 text-[#9f9f9f]">
          <time dateTime={event.createdAt}>
            {formatTimestamp(event.createdAt)}
          </time>
          <p className="max-w-[180px] truncate" title={event.actorId}>
            Subject {event.actorId}
          </p>
        </div>
      </div>
      <Link
        aria-current={selected ? "page" : undefined}
        className="mt-3 inline-flex text-xs font-medium text-[#7dd8ff] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#009fff]"
        href={activityHref(basePath, filters, {
          cursor: null,
          eventId: event.id,
        })}
      >
        View event metadata
      </Link>
    </article>
  )
}

function EventFacts({ event }: { event: ActivityAuditEvent }) {
  const facts = [
    ["Event ID", event.id],
    ["Source", event.sourceSystem],
    ["Outcome", event.outcome],
    ["Subject ID", event.actorId],
    ["Action", event.action],
    ["Target", `${event.targetType}: ${event.targetId}`],
    ["Occurred", formatTimestamp(event.createdAt)],
  ]

  return (
    <dl className="grid gap-2 sm:grid-cols-2">
      {facts.map(([label, value]) => (
        <div
          className="rounded-md border border-[#353535] bg-[#1d1d1d] px-3 py-2"
          key={label}
        >
          <dt className="text-xs font-medium text-[#9f9f9f]">{label}</dt>
          <dd className="mt-1 break-words text-sm text-[#dfdfdf]">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

function MetadataList({
  entries,
}: {
  entries: ActivityAuditMetadataEntry[]
}) {
  return (
    <div className="mt-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-[#9f9f9f]">
        Normalized metadata
      </h3>
      <dl className="mt-2 grid gap-2 sm:grid-cols-2">
        {entries.map((entry) => (
          <div
            className="rounded-md border border-[#353535] bg-[#1d1d1d] px-3 py-2"
            key={entry.label}
          >
            <dt className="text-xs font-medium text-[#9f9f9f]">
              {entry.label}
            </dt>
            <dd className="mt-1 break-words text-sm text-[#dfdfdf]">
              {entry.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

function SeverityPill({ severity }: { severity: InferenceCoreSeverity }) {
  return (
    <span
      className={cn(
        "rounded-full border px-2 py-1 text-xs font-medium leading-none",
        severity === "critical" &&
          "border-[#5e2424] bg-[#351d1d] text-[#ff6565]",
        severity === "warning" &&
          "border-[#5b4a18] bg-[#302914] text-[#ffcc4d]",
        severity === "info" && "border-[#244b5e] bg-[#1d3038] text-[#7dd8ff]",
      )}
    >
      {severity}
    </span>
  )
}

function OutcomePill({
  outcome,
}: {
  outcome: InferenceCoreAuditOutcome
}) {
  return (
    <span
      className={cn(
        "rounded-full border px-2 py-1 text-xs font-medium leading-none",
        outcome === "succeeded" &&
          "border-[#315426] bg-[#22341d] text-[#9ae27f]",
        outcome !== "succeeded" &&
          "border-[#5b4a18] bg-[#302914] text-[#ffcc4d]",
      )}
    >
      {outcome}
    </span>
  )
}

function auditSourceDetail(source: ActivityAuditSource): string {
  if (source.ingressReadiness === "not_applicable") {
    return source.lastEventAt
      ? `Local source · last event ${formatTimestamp(source.lastEventAt)}`
      : "Local source · no event recorded"
  }
  if (source.cursorHealth === "healthy") {
    return source.lastSuccessAt
      ? `Ingress cursor healthy · last success ${formatTimestamp(source.lastSuccessAt)} · runtime qualification pending`
      : "Ingress implemented · runtime qualification pending"
  }
  if (source.cursorHealth === "degraded") {
    return source.lastErrorCode
      ? `Ingress cursor degraded · ${source.lastErrorCode} · runtime qualification pending`
      : "Ingress cursor degraded · runtime qualification pending"
  }
  return "Ingress implemented · runtime qualification pending"
}

function StatusDot({ status }: { status: InferenceCoreSourceStatus }) {
  return (
    <>
      <span className="sr-only">Status: {status}</span>
      <span
        aria-hidden
        className={cn(
          "size-2.5 rounded-full",
          status === "ok" && "bg-[#78d957]",
          status === "degraded" && "bg-[#ffcc4d]",
          status === "unavailable" && "bg-[#ff6565]",
          status === "not_configured" && "bg-[#9f9f9f]",
        )}
      />
    </>
  )
}

function sourceStatusLabel(status: InferenceCoreSourceStatus): string {
  if (status === "not_configured") {
    return "Not configured"
  }
  if (status === "unavailable") {
    return "Unavailable"
  }
  if (status === "degraded") {
    return "Degraded"
  }
  return "Healthy"
}

function activeFilterCount(filters: ActivityFilters): number {
  return [
    filters.applicationId,
    filters.eventId,
    filters.outcome,
    filters.query,
    filters.severity,
    filters.source,
  ].filter(Boolean).length
}

function activityHref(
  basePath: string,
  filters: ActivityFilters,
  overrides: Partial<Record<keyof ActivityFilters, string | null>> = {},
): string {
  const values = { ...filters, ...overrides }
  const params = new URLSearchParams()
  appendQueryParam(params, "q", values.query)
  appendQueryParam(params, "applicationId", values.applicationId)
  appendQueryParam(params, "eventId", values.eventId)
  appendQueryParam(params, "source", values.source)
  appendQueryParam(params, "outcome", values.outcome)
  appendQueryParam(params, "severity", values.severity)
  appendQueryParam(params, "limit", values.limit)
  appendQueryParam(params, "cursor", values.cursor)
  const query = params.toString()
  return `${basePath}${query ? `?${query}` : ""}`
}

function appendQueryParam(
  params: URLSearchParams,
  name: string,
  value: string | null,
) {
  if (value) {
    params.set(name, value)
  }
}

function defaultExportWindow(generatedAt: string): {
  from: string
  to: string
} {
  const to = new Date(generatedAt)
  const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000)
  return {
    from: toUtcDateTimeLocal(from),
    to: toUtcDateTimeLocal(to),
  }
}

function toUtcDateTimeLocal(value: Date): string {
  return value.toISOString().slice(0, 16)
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value))
}
