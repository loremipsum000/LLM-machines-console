"use client"

import type { RetainedConsoleRole } from "@/lib/auth/role-claims"
import { cn } from "@/lib/utils"
import type {
  AdminInferenceDashboard,
  AdminInferenceModel,
  AdminInferenceModelUsage,
  AdminInferenceRange,
  AdminInferenceVirtualKey,
  InferenceCoreSourceStatus,
} from "@llm-machines/contracts/inference-core"
import { ChevronDown } from "lucide-react"
import Link from "next/link"
import { useMemo, useState } from "react"

const rangeOptions: Array<{ label: string; value: AdminInferenceRange }> = [
  { label: "7d", value: "7d" },
  { label: "30d", value: "30d" },
  { label: "90d", value: "90d" },
]
const compactNumberFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
  notation: "compact",
})
const standardNumberFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
  notation: "standard",
})
const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeZone: "UTC",
  timeStyle: "short",
})

interface InferenceV2ExperienceProps {
  accessRole: RetainedConsoleRole
  basePath?: string
  dashboard: AdminInferenceDashboard
}

export function InferenceV2Experience({
  basePath = "/inference",
  dashboard,
}: InferenceV2ExperienceProps) {
  const sortedUsage = useMemo(
    () =>
      dashboard.modelUsage.toSorted(
        (left, right) =>
          right.requests - left.requests || right.tokens - left.tokens,
      ),
    [dashboard.modelUsage],
  )

  return (
    <div className="w-full min-h-screen pb-16 pt-8 lg:pt-[73px]">
      <InferenceHeader />

      <section className="mt-8 flex flex-col gap-3 lg:w-[640px]">
        <InferenceToolbar basePath={basePath} dashboard={dashboard} />
        <InferenceSummary dashboard={dashboard} />
        <ModelUsageSection
          modelUsage={sortedUsage}
          sourceStatus={dashboard.aggregateUsageSourceStatus}
        />
        <AvailableModelsSection
          models={dashboard.models}
          sourceStatus={dashboard.modelInventorySourceStatus}
          usage={sortedUsage}
        />
        <VirtualKeysSection
          sourceStatus={dashboard.virtualKeysSourceStatus}
          virtualKeys={dashboard.virtualKeys}
        />
      </section>
    </div>
  )
}

function InferenceHeader() {
  return (
    <header>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold leading-none text-[#fdfdfd]">
            Inference
          </h1>
          <p className="mt-3 max-w-[560px] text-sm leading-5 text-[#b2b2b2]">
            Console preview of inference usage, model inventory, and redacted
            LiteLLM virtual-key metadata.
          </p>
        </div>
      </div>
    </header>
  )
}

function InferenceToolbar({
  basePath,
  dashboard,
}: {
  basePath: string
  dashboard: AdminInferenceDashboard
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#353535] bg-[#232323] p-3">
      <div className="flex min-w-0 items-center gap-2">
        <span className="text-sm font-medium leading-5 text-white">Range</span>
        <div className="flex rounded-md border border-[#353535] bg-[#181818] p-1">
          {rangeOptions.map((option) => (
            <Link
              aria-current={
                dashboard.range === option.value ? "page" : undefined
              }
              className={cn(
                "rounded px-2.5 py-1 text-sm font-medium leading-[18px] text-[#b2b2b2] transition-colors hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#009fff]",
                dashboard.range === option.value && "bg-[#2e2e2e] text-white",
              )}
              href={inferenceHref(basePath, option.value)}
              key={option.value}
            >
              {option.label}
            </Link>
          ))}
        </div>
      </div>

      <span
        aria-disabled="true"
        className="rounded-md border border-[#353535] px-3 py-2 text-sm font-medium leading-[18px] text-[#777]"
      >
        Direct LiteLLM access is pending qualification
      </span>
    </div>
  )
}

function InferenceSummary({
  dashboard,
}: {
  dashboard: AdminInferenceDashboard
}) {
  const rangeLabel = dashboard.range.toUpperCase()
  const requests = dashboard.totals?.requests ?? null
  const tokens = dashboard.totals?.tokens ?? null

  return (
    <section
      aria-label="LiteLLM signal"
      className="rounded-lg border border-[#353535] bg-[#232323] p-3"
    >
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <StatusDot status={dashboard.aggregateUsageSourceStatus} />
            <h2 className="text-base font-semibold leading-[19px] text-white">
              LiteLLM signal
            </h2>
          </div>
          <p className="mt-2 max-w-[520px] text-sm leading-5 text-[#b2b2b2]">
            {dashboard.summary}
          </p>
        </div>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <SummaryMetric
          label="Requests"
          rangeLabel={rangeLabel}
          sourceStatus={dashboard.aggregateUsageSourceStatus}
          value={requests}
        />
        <SummaryMetric
          label="Tokens"
          rangeLabel={rangeLabel}
          sourceStatus={dashboard.aggregateUsageSourceStatus}
          value={tokens}
        />
      </div>
    </section>
  )
}

function SummaryMetric({
  label,
  rangeLabel,
  sourceStatus,
  value,
}: {
  label: string
  rangeLabel: string
  sourceStatus: InferenceCoreSourceStatus
  value: number | null
}) {
  return (
    <div className="rounded-md border border-[#353535] bg-[#181818] p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium uppercase leading-4 text-[#9f9f9f]">
          {label}
        </p>
        <p className="shrink-0 text-xs font-medium leading-4 text-[#9f9f9f]">
          {rangeLabel}
        </p>
      </div>
      <p className="mt-2 text-xl font-semibold leading-none text-white">
        {sourceMetricValue(sourceStatus, value)}
      </p>
      <p className="mt-2 text-xs leading-4 text-[#9f9f9f]">
        {sourceStatus === "ok"
          ? `${rangeLabel} total`
          : "Aggregate usage source"}
      </p>
    </div>
  )
}

function ModelUsageSection({
  modelUsage,
  sourceStatus,
}: {
  modelUsage: AdminInferenceModelUsage[]
  sourceStatus: InferenceCoreSourceStatus
}) {
  const maxRequests = Math.max(...modelUsage.map((item) => item.requests), 1)

  return (
    <section
      aria-label="Model usage sorted by usage"
      className="rounded-lg border border-[#353535] bg-[#232323] p-3"
    >
      <h2 className="text-base font-semibold leading-[19px] text-white">
        Model usage
      </h2>
      <p className="mt-2 text-sm leading-5 text-[#b2b2b2]">
        Models sorted by request volume for the selected range.
      </p>
      <div className="mt-4 grid gap-3">
        {sourceStatus === "ok" && modelUsage.length > 0 ? (
          modelUsage.map((item) => (
            <ModelUsageRow
              item={item}
              key={item.model}
              maxRequests={maxRequests}
            />
          ))
        ) : (
          <EmptyPanel
            message={sourceEmptyMessage(
              sourceStatus,
              "Aggregate model usage is unavailable from LiteLLM.",
              "LiteLLM aggregate usage is not configured.",
              "No model usage was reported for this range.",
            )}
          />
        )}
      </div>
    </section>
  )
}

function ModelUsageRow({
  item,
  maxRequests,
}: {
  item: AdminInferenceModelUsage
  maxRequests: number
}) {
  const width = `${Math.max(4, Math.round((item.requests / maxRequests) * 100))}%`

  return (
    <div className="grid gap-2 rounded-md border border-[#353535] bg-[#181818] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium leading-5 text-white">
            {item.model}
          </p>
          <p className="text-xs leading-5 text-[#9f9f9f]">
            Last used{" "}
            {item.lastUsedAt ? formatDateTime(item.lastUsedAt) : "unknown"}
          </p>
        </div>
        <div className="text-right text-sm leading-5 text-[#b2b2b2]">
          <p>{formatNumber(item.requests)} requests</p>
          <p>{formatNumber(item.tokens)} tokens</p>
        </div>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-[#2e2e2e]">
        <div className="h-full rounded-full bg-[#009fff]" style={{ width }} />
      </div>
    </div>
  )
}

function AvailableModelsSection({
  models,
  sourceStatus,
  usage,
}: {
  models: AdminInferenceModel[]
  sourceStatus: InferenceCoreSourceStatus
  usage: AdminInferenceModelUsage[]
}) {
  const usageByModel = new Map(usage.map((item) => [item.model, item]))
  const sortedModels = models.toSorted(
    (left, right) =>
      (usageByModel.get(right.name)?.requests ?? 0) -
      (usageByModel.get(left.name)?.requests ?? 0),
  )

  return (
    <section aria-label="Available models">
      <h2 className="text-base font-semibold leading-[19px] text-white">
        Available models
      </h2>
      <p className="mt-2 text-sm leading-5 text-[#b2b2b2]">
        Concise model inventory from LiteLLM. Advanced routing stays in LiteLLM.
      </p>
      <div className="mt-4 w-full overflow-hidden rounded-lg border border-[#242424] bg-[#181818]">
        {sourceStatus === "ok" && sortedModels.length > 0 ? (
          <table className="w-full table-fixed text-left text-xs text-white">
            <colgroup>
              <col className="w-8" />
              <col className="w-[140px]" />
              <col />
              <col className="w-[88px]" />
            </colgroup>
            <thead>
              <tr className="h-11 border-b border-[#242424]">
                <th className="px-2 font-normal">#</th>
                <th className="px-2 font-normal">Model</th>
                <th className="px-2 font-normal">
                  <span className="flex items-center gap-1">
                    Provider <ChevronDown aria-hidden className="size-4" />
                  </span>
                </th>
                <th className="px-2 font-normal">
                  <span className="flex items-center gap-1">
                    Context <ChevronDown aria-hidden className="size-4" />
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedModels.map((model, index) => (
                <tr
                  className="h-10 border-b border-[#242424] transition-colors hover:bg-[#202020]"
                  key={model.id}
                >
                  <td className="px-2">{String(index + 1).padStart(2, "0")}</td>
                  <td className="truncate px-2">{model.name}</td>
                  <td className="truncate px-2">
                    {model.provider ?? "Unknown"}
                  </td>
                  <td className="px-2">
                    {model.contextWindow
                      ? formatNumber(model.contextWindow)
                      : "Unknown"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyPanel
            message={sourceEmptyMessage(
              sourceStatus,
              "Model inventory is unavailable from LiteLLM.",
              "LiteLLM model inventory is not configured.",
              "No models are currently served by LiteLLM.",
            )}
          />
        )}
      </div>
    </section>
  )
}

function VirtualKeysSection({
  sourceStatus,
  virtualKeys,
}: {
  sourceStatus: InferenceCoreSourceStatus
  virtualKeys: AdminInferenceVirtualKey[]
}) {
  const [open, setOpen] = useState(false)

  return (
    <section aria-label="Virtual keys">
      <button
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#009fff]"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span>
          <span className="block text-base font-semibold leading-[19px] text-white">
            Virtual keys
          </span>
          <span className="mt-2 block text-sm leading-5 text-[#b2b2b2]">
            Redacted LiteLLM-native metadata. These keys remain separate from
            Console Application credentials and are managed in LiteLLM.
          </span>
        </span>
        <span className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-[#353535] px-3 text-sm font-medium leading-[18px] text-white transition-colors hover:bg-[#2e2e2e]">
          {open ? "Hide" : "Expand"}
          <ChevronDown
            aria-hidden
            className={cn("size-4 transition-transform", open && "rotate-180")}
          />
        </span>
      </button>

      {open ? (
        <div className="mt-4 w-full overflow-hidden rounded-lg border border-[#242424] bg-[#181818]">
          {sourceStatus === "ok" && virtualKeys.length > 0 ? (
            <table className="w-full table-fixed text-left text-xs text-white">
              <colgroup>
                <col className="w-8" />
                <col className="w-[140px]" />
                <col />
                <col />
                <col className="w-[68px]" />
              </colgroup>
              <thead>
                <tr className="h-11 border-b border-[#242424]">
                  <th className="px-2 font-normal">#</th>
                  <th className="px-2 font-normal">Alias</th>
                  <th className="px-2 font-normal">
                    <span className="flex items-center gap-1">
                      Owner <ChevronDown aria-hidden className="size-4" />
                    </span>
                  </th>
                  <th className="px-2 font-normal">
                    <span className="flex items-center gap-1">
                      Models <ChevronDown aria-hidden className="size-4" />
                    </span>
                  </th>
                  <th className="px-2 font-normal">
                    <span className="flex items-center gap-1">
                      Status <ChevronDown aria-hidden className="size-4" />
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {virtualKeys.map((virtualKey, index) => (
                  <tr
                    className="h-10 border-b border-[#242424] transition-colors hover:bg-[#202020]"
                    key={virtualKey.id}
                  >
                    <td className="px-2">
                      {String(index + 1).padStart(2, "0")}
                    </td>
                    <td className="truncate px-2">{virtualKey.alias}</td>
                    <td className="truncate px-2">
                      {virtualKey.owner ?? virtualKey.team ?? "Unassigned"}
                    </td>
                    <td className="truncate px-2">
                      {virtualKey.models.length > 0
                        ? virtualKey.models.join(", ")
                        : "All allowed"}
                    </td>
                    <td className="px-2 capitalize">{virtualKey.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <EmptyPanel
              message={sourceEmptyMessage(
                sourceStatus,
                "Virtual-key metadata is unavailable from LiteLLM.",
                "LiteLLM virtual-key metadata is not configured.",
                "No LiteLLM virtual keys are configured.",
              )}
            />
          )}
        </div>
      ) : null}
    </section>
  )
}

function EmptyPanel({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-dashed border-[#353535] bg-[#181818] p-4 text-center text-sm leading-5 text-[#b2b2b2]">
      {message}
    </div>
  )
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

function inferenceHref(basePath: string, range: AdminInferenceRange): string {
  const query = new URLSearchParams()
  query.set("range", range)
  return `${basePath}?${query.toString()}`
}

function formatNumber(value: number): string {
  return (
    value >= 1000 ? compactNumberFormatter : standardNumberFormatter
  ).format(value)
}

function formatDateTime(value: string): string {
  return dateTimeFormatter.format(new Date(value))
}

function sourceMetricValue(
  status: InferenceCoreSourceStatus,
  value: number | null,
): string {
  if (status === "not_configured") {
    return "Not configured"
  }
  if (status !== "ok" || value === null) {
    return "Unavailable"
  }
  return formatNumber(value)
}

function sourceEmptyMessage(
  status: InferenceCoreSourceStatus,
  unavailableMessage: string,
  notConfiguredMessage: string,
  emptyMessage: string,
): string {
  if (status === "not_configured") {
    return notConfiguredMessage
  }
  if (status !== "ok") {
    return unavailableMessage
  }
  return emptyMessage
}
