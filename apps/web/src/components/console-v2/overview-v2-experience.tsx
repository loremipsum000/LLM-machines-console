import { cn } from "@/lib/utils"
import type {
  AdminOverviewMetric,
  AdminOverviewResponse,
  AdminOverviewTile,
  InferenceCoreSourceStatus,
} from "@llm-machines/contracts/inference-core"
import Link from "next/link"
import { sourceStatusLabel } from "./source-status"
import { TokenUsageGrid } from "./token-usage-grid"

const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
})

interface OverviewV2ExperienceProps {
  overview: AdminOverviewResponse
}

export function OverviewV2Experience({ overview }: OverviewV2ExperienceProps) {
  return (
    <div className="w-full min-h-screen pb-16 pt-8 lg:pt-[73px]">
      <header>
        <h1 className="text-2xl font-semibold leading-none text-[#fdfdfd]">
          Overview
        </h1>
        <p className="mt-3 max-w-[560px] text-sm leading-5 text-[#b2b2b2]">
          See key access, token usage, inference availability, hardware health,
          and system status at a glance.
        </p>
        <p className="mt-2 text-xs leading-5 text-[#8f8f8f]">
          Updated {formatTimestamp(overview.generatedAt)} UTC
        </p>
      </header>

      <section
        aria-labelledby="overview-token-usage-title"
        className="mt-8 rounded-lg border border-[#353535] bg-[#232323] p-4"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2
              className="text-base font-semibold leading-5 text-white"
              id="overview-token-usage-title"
            >
              Token usage
            </h2>
            <p className="mt-1 text-sm leading-5 text-[#b2b2b2]">
              Daily aggregate token volume reported by LiteLLM. No prompts or
              responses are retained.
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <span className="text-xs leading-4 text-[#8f8f8f]">
              Last 90 days · UTC
            </span>
            <SourceStatus status={overview.tokenUsage.sourceStatus} />
          </div>
        </div>
        <TokenUsageGrid
          generatedAt={overview.generatedAt}
          usage={overview.tokenUsage}
        />
      </section>

      <section aria-label="Operational overview" className="mt-8 grid gap-3">
        {overview.tiles.map((tile) => (
          <OverviewTileCard key={tile.id} tile={tile} />
        ))}
      </section>
    </div>
  )
}

function OverviewTileCard({ tile }: { tile: OverviewTile }) {
  return (
    <article
      aria-labelledby={`overview-tile-${tile.id}`}
      className="flex w-full flex-col rounded-lg border border-[#353535] bg-[#232323] p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2
            className="text-base font-semibold leading-5 text-white"
            id={`overview-tile-${tile.id}`}
          >
            {tile.title}
          </h2>
          <p className="mt-2 text-sm leading-5 text-[#b2b2b2]">
            {tile.summary}
          </p>
        </div>
        <SourceStatus status={tile.sourceStatus} />
      </div>

      <dl className="mt-4 grid gap-2 sm:grid-cols-2">
        {tile.metrics.map((item) => (
          <MetricCard item={item} key={item.id} />
        ))}
      </dl>

      <div className="mt-auto flex items-end justify-between gap-3 pt-4">
        <time
          className="text-xs leading-4 text-[#8f8f8f]"
          dateTime={tile.updatedAt}
        >
          {formatTimestamp(tile.updatedAt)} UTC
        </time>
        <Link
          className="text-sm font-medium leading-5 text-[#73cfff] transition-colors hover:text-[#a6e1ff] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#009fff]"
          href={tile.href}
        >
          Open {tile.title}
        </Link>
      </div>
    </article>
  )
}

type OverviewTile = AdminOverviewTile

function MetricCard({ item }: { item: AdminOverviewMetric }) {
  return (
    <div className="min-w-0 rounded-md border border-[#353535] bg-[#1d1d1d] p-3">
      <dt className="text-xs font-medium leading-4 text-[#9f9f9f]">
        {item.label}
      </dt>
      <dd
        className={cn(
          "mt-1 break-words text-sm font-semibold leading-5 text-white",
          item.tone === "good" && "text-[#7ee2a8]",
          item.tone === "warning" && "text-[#ffcc4d]",
          item.tone === "critical" && "text-[#ff7b7b]",
        )}
      >
        {item.value}
      </dd>
      {item.detail ? (
        <dd className="mt-1 break-words text-xs leading-4 text-[#8f8f8f]">
          {item.detail}
        </dd>
      ) : null}
    </div>
  )
}

function SourceStatus({ status }: { status: InferenceCoreSourceStatus }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-1 text-xs font-medium leading-none",
        status === "ok" && "border-[#28563a] bg-[#1c3326] text-[#7ee2a8]",
        status === "degraded" && "border-[#5b4a18] bg-[#302914] text-[#ffcc4d]",
        status === "unavailable" &&
          "border-[#5e2424] bg-[#351d1d] text-[#ff7b7b]",
        status === "not_configured" &&
          "border-[#454545] bg-[#1d1d1d] text-[#b2b2b2]",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-1.5 rounded-full bg-current",
          status === "unavailable" && "animate-pulse",
        )}
      />
      {sourceStatusLabel(status)}
    </span>
  )
}

function formatTimestamp(value: string): string {
  return dateTimeFormatter.format(new Date(value))
}
