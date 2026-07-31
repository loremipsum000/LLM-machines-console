"use client"

import { applyAdminInferenceModelUpdateAction } from "@/lib/admin/actions-core"
import type { RetainedConsoleRole } from "@/lib/auth/role-claims"
import { cn } from "@/lib/utils"
import type {
  AdminInferenceDashboard,
  AdminInferenceModel,
  AdminInferenceModelUpdate,
  AdminInferenceModelUsage,
  AdminInferenceRange,
  AdminInferenceUsagePoint,
  AdminInferenceVirtualKey,
  InferenceCoreSourceStatus,
} from "@llm-machines/contracts/inference-core"
import { ArrowUpRight, ChevronDown } from "lucide-react"
import Link from "next/link"
import { useMemo, useState } from "react"
import { ConsoleActionToasts } from "./action-toasts"

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
const percentFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
  signDisplay: "always",
  style: "percent",
})
const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeZone: "UTC",
  timeStyle: "short",
})
const inferenceActionNoticeMessages: Record<
  string,
  { description: string; tone: "danger" | "success" | "warning" }
> = {
  blocked: {
    description: "Model update was blocked by BFF policy.",
    tone: "warning",
  },
  completed: {
    description: "Model update completed.",
    tone: "success",
  },
  failed: {
    description: "Model update failed. Check LiteLLM or appliance logs.",
    tone: "danger",
  },
  started: {
    description: "Model update started.",
    tone: "success",
  },
}

interface InferenceV2ExperienceProps {
  accessRole: RetainedConsoleRole
  basePath?: string
  dashboard: AdminInferenceDashboard
  inferenceAction?: string
  view?: InferenceV2View
}

export type InferenceV2View = "overview" | "model-update"

export function InferenceV2Experience({
  accessRole,
  basePath = "/inference",
  dashboard,
  inferenceAction,
  view = "overview",
}: InferenceV2ExperienceProps) {
  const sortedUsage = useMemo(
    () =>
      dashboard.modelUsage.toSorted(
        (left, right) =>
          right.requests - left.requests || right.tokens - left.tokens,
      ),
    [dashboard.modelUsage],
  )
  const returnTo =
    view === "model-update"
      ? inferenceUpdateHref(basePath, dashboard.range)
      : inferenceHref(basePath, dashboard.range)

  if (view === "model-update") {
    return (
      <div className="w-full min-h-screen pb-16 pt-8 lg:pt-[73px]">
        <InferenceHeader
          basePath={basePath}
          dashboard={dashboard}
          view={view}
        />

        <section className="mt-8 flex flex-col gap-3 lg:w-[640px]">
          {inferenceAction ? (
            <InferenceActionNotice action={inferenceAction} />
          ) : null}
          <ModelUpdateDetails
            canApplyUpdates={accessRole === "admin"}
            modelUpdate={dashboard.modelUpdate}
            returnTo={returnTo}
          />
        </section>
      </div>
    )
  }

  return (
    <div className="w-full min-h-screen pb-16 pt-8 lg:pt-[73px]">
      <InferenceHeader basePath={basePath} dashboard={dashboard} view={view} />

      <section className="mt-8 flex flex-col gap-3 lg:w-[640px]">
        {inferenceAction ? (
          <InferenceActionNotice action={inferenceAction} />
        ) : null}
        <ModelUpdateCta basePath={basePath} dashboard={dashboard} />
        <InferenceToolbar
          basePath={basePath}
          canOpenLiteLlm={accessRole === "admin"}
          dashboard={dashboard}
        />
        <InferenceSummary dashboard={dashboard} />
        <ModelUsageSection modelUsage={sortedUsage} />
        <AvailableModelsSection models={dashboard.models} usage={sortedUsage} />
        <VirtualKeysSection virtualKeys={dashboard.virtualKeys} />
      </section>
    </div>
  )
}

function InferenceHeader({
  basePath,
  dashboard,
  view,
}: {
  basePath: string
  dashboard: AdminInferenceDashboard
  view: InferenceV2View
}) {
  const isModelUpdateView = view === "model-update"

  return (
    <header>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold leading-none text-[#fdfdfd]">
            {isModelUpdateView ? "Model update" : "Inference"}
          </h1>
          <p className="mt-3 max-w-[560px] text-sm leading-5 text-[#b2b2b2]">
            {isModelUpdateView
              ? "Review the governed model bundle update before starting the appliance-side workflow."
              : "Console preview of inference usage, model inventory, virtual-key metadata, and governed model updates."}
          </p>
          {isModelUpdateView ? (
            <Link
              className="mt-3 inline-flex h-9 items-center justify-center rounded-md border border-[#353535] bg-transparent px-3 text-sm font-medium leading-[18px] text-white transition-colors hover:bg-[#2e2e2e] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#009fff]"
              href={inferenceHref(basePath, dashboard.range)}
            >
              Go back
            </Link>
          ) : null}
        </div>
      </div>
    </header>
  )
}

function ModelUpdateCta({
  basePath,
  dashboard,
}: {
  basePath: string
  dashboard: AdminInferenceDashboard
}) {
  const modelUpdate = dashboard.modelUpdate
  if (!modelUpdate || modelUpdate.status !== "available") {
    return null
  }

  return (
    <section
      aria-label="Model update available"
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#353535] bg-[#232323] p-3"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <StatusDot status="degraded" />
          <h2 className="text-base font-semibold leading-[19px] text-white">
            Model update available
          </h2>
        </div>
        <p className="mt-2 max-w-[480px] text-sm leading-5 text-[#b2b2b2]">
          {modelUpdate.detail}
        </p>
      </div>
      <Link
        className="inline-flex h-9 shrink-0 items-center justify-center rounded-md bg-[#009fff] px-3 text-sm font-semibold leading-[18px] text-[#06131d] transition-colors hover:bg-[#26adff] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#009fff]"
        href={inferenceUpdateHref(basePath, dashboard.range)}
      >
        Update Available
      </Link>
    </section>
  )
}

function ModelUpdateDetails({
  canApplyUpdates,
  modelUpdate,
  returnTo,
}: {
  canApplyUpdates: boolean
  modelUpdate: AdminInferenceModelUpdate | null
  returnTo: string
}) {
  const [open, setOpen] = useState(false)
  if (!modelUpdate) {
    return (
      <section
        aria-label="Model update status"
        className="rounded-lg border border-[#353535] bg-[#232323] p-3"
      >
        <h2 className="text-base font-semibold leading-[19px] text-white">
          No update available
        </h2>
        <p className="mt-2 text-sm leading-5 text-[#b2b2b2]">
          LiteLLM did not return an actionable appliance model update.
        </p>
      </section>
    )
  }

  const canApply =
    canApplyUpdates &&
    modelUpdate.status === "available" &&
    modelUpdate.updateActionEnabled

  return (
    <section
      aria-label="Model update details"
      className="rounded-lg border border-[#353535] bg-[#232323] p-3"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <StatusDot status="degraded" />
            <h2 className="text-base font-semibold leading-[19px] text-white">
              Update details
            </h2>
          </div>
          <p className="mt-2 max-w-[520px] text-sm leading-5 text-[#dfdfdf]">
            {modelUpdate.detail}
          </p>
          <dl className="mt-3 grid gap-2 text-sm leading-5 text-[#b2b2b2] sm:grid-cols-2">
            <div>
              <dt className="text-xs font-medium uppercase text-[#9f9f9f]">
                Current
              </dt>
              <dd className="text-white">{modelUpdate.currentVersion}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase text-[#9f9f9f]">
                Available
              </dt>
              <dd className="text-white">{modelUpdate.availableVersion}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase text-[#9f9f9f]">
                Impact
              </dt>
              <dd>{modelUpdate.estimatedDowntime ?? "LiteLLM reload only."}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase text-[#9f9f9f]">
                Models
              </dt>
              <dd>{modelUpdate.affectedModels.join(", ")}</dd>
            </div>
          </dl>
          {modelUpdate.releaseNotes ? (
            <p className="mt-3 text-sm leading-5 text-[#b2b2b2]">
              {modelUpdate.releaseNotes}
            </p>
          ) : null}
        </div>

        <button
          className={cn(
            "flex h-9 items-center justify-center rounded-md px-3 text-sm font-medium leading-[18px] text-white transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#009fff]",
            canApply
              ? "bg-[#009fff] text-[#06131d] hover:bg-[#26adff]"
              : "cursor-not-allowed bg-[#232323] text-[#9f9f9f]",
          )}
          disabled={!canApply}
          onClick={() => setOpen(true)}
          type="button"
        >
          {canApplyUpdates ? "Update" : "Admin approval required"}
        </button>
      </div>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-5">
          <dialog
            aria-labelledby="model-update-confirm-title"
            className="w-full max-w-[420px] rounded-lg border border-[#353535] bg-[#232323] p-4 shadow-2xl"
            open
          >
            <h3
              className="text-lg font-semibold leading-6 text-white"
              id="model-update-confirm-title"
            >
              Apply model update
            </h3>
            <p className="mt-2 text-sm leading-5 text-[#b2b2b2]">
              Console will ask the BFF to start the governed model-update
              workflow. LiteLLM will reload while the adapter applies the
              update.
            </p>
            <form
              action={applyAdminInferenceModelUpdateAction}
              className="mt-4"
            >
              <input name="returnTo" type="hidden" value={returnTo} />
              <input name="confirmation" type="hidden" value="UPDATE MODEL" />
              <div className="flex justify-end gap-2">
                <button
                  className="flex h-9 items-center justify-center rounded-md border border-[#353535] px-3 text-sm font-medium leading-[18px] text-white transition-colors hover:bg-[#2e2e2e] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#009fff]"
                  onClick={() => setOpen(false)}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="flex h-9 items-center justify-center rounded-md bg-[#009fff] px-3 text-sm font-semibold leading-[18px] text-[#06131d] transition-colors hover:bg-[#26adff] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#009fff]"
                  type="submit"
                >
                  Update
                </button>
              </div>
            </form>
          </dialog>
        </div>
      ) : null}
    </section>
  )
}

function InferenceToolbar({
  basePath,
  canOpenLiteLlm,
  dashboard,
}: {
  basePath: string
  canOpenLiteLlm: boolean
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

      {canOpenLiteLlm && dashboard.liteLlmUrl ? (
        <Link
          className="flex items-center gap-1.5 rounded-md bg-[#2e2e2e] px-3 py-2 text-sm font-medium leading-[18px] text-white transition-colors hover:bg-[#353535] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#009fff]"
          href={dashboard.liteLlmUrl}
        >
          Open LiteLLM
          <ArrowUpRight aria-hidden className="size-4" />
        </Link>
      ) : null}
    </div>
  )
}

function InferenceSummary({
  dashboard,
}: {
  dashboard: AdminInferenceDashboard
}) {
  const rangeLabel = dashboard.range.toUpperCase()
  const promptSignal = usageSignal(dashboard.usagePoints, "requests")
  const tokenSignal = usageSignal(dashboard.usagePoints, "tokens")

  return (
    <section
      aria-label="LiteLLM signal"
      className="rounded-lg border border-[#353535] bg-[#232323] p-3"
    >
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <StatusDot status={dashboard.sourceStatus} />
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
          deltaPercent={promptSignal.deltaPercent}
          label="Prompts"
          rangeLabel={rangeLabel}
          value={formatNumber(promptSignal.average)}
        />
        <SummaryMetric
          deltaPercent={tokenSignal.deltaPercent}
          label="Tokens"
          rangeLabel={rangeLabel}
          value={formatNumber(tokenSignal.average)}
        />
      </div>
    </section>
  )
}

function SummaryMetric({
  deltaPercent,
  label,
  rangeLabel,
  value,
}: {
  deltaPercent: number
  label: string
  rangeLabel: string
  value: string
}) {
  return (
    <div className="rounded-md border border-[#353535] bg-[#181818] p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium uppercase leading-4 text-[#9f9f9f]">
          {label}
        </p>
        <p className="flex shrink-0 items-center gap-1 text-xs font-medium leading-4">
          <span className="text-[#9f9f9f]">{rangeLabel}</span>
          <span
            className={deltaPercent >= 0 ? "text-[#78d957]" : "text-[#ff6565]"}
          >
            {formatPercent(deltaPercent)}
          </span>
        </p>
      </div>
      <p className="mt-2 text-xl font-semibold leading-none text-white">
        {value}
      </p>
      <p className="mt-2 text-xs leading-4 text-[#9f9f9f]">
        {rangeLabel} average
      </p>
    </div>
  )
}

function ModelUsageSection({
  modelUsage,
}: {
  modelUsage: AdminInferenceModelUsage[]
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
        {modelUsage.length > 0 ? (
          modelUsage.map((item) => (
            <ModelUsageRow
              item={item}
              key={item.model}
              maxRequests={maxRequests}
            />
          ))
        ) : (
          <EmptyPanel message="No model usage has been returned for this range." />
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
          <p>{formatNumber(item.requests)} prompts</p>
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
  usage,
}: {
  models: AdminInferenceModel[]
  usage: AdminInferenceModelUsage[]
}) {
  const usageByModel = new Map(usage.map((item) => [item.model, item]))
  const sortedModels = models.toSorted(
    (left, right) =>
      (usageByModel.get(right.name)?.requests ?? 0) -
      (usageByModel.get(left.name)?.requests ?? 0),
  )

  return (
    <section>
      <h2 className="text-base font-semibold leading-[19px] text-white">
        Available models
      </h2>
      <p className="mt-2 text-sm leading-5 text-[#b2b2b2]">
        Concise model inventory from LiteLLM. Advanced routing stays in LiteLLM.
      </p>
      <div className="mt-4 w-full overflow-hidden rounded-lg border border-[#242424] bg-[#181818]">
        {sortedModels.length > 0 ? (
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
          <EmptyPanel message="No models were returned by LiteLLM." />
        )}
      </div>
    </section>
  )
}

function VirtualKeysSection({
  virtualKeys,
}: {
  virtualKeys: AdminInferenceVirtualKey[]
}) {
  const [open, setOpen] = useState(false)

  return (
    <section>
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
            Redacted key metadata. Expand only when operator context is needed.
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
          {virtualKeys.length > 0 ? (
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
            <EmptyPanel message="No virtual-key metadata was returned." />
          )}
        </div>
      ) : null}
    </section>
  )
}

function InferenceActionNotice({ action }: { action: string }) {
  const message = inferenceActionNoticeMessages[action] ?? null
  if (!message) {
    return null
  }

  return (
    <ConsoleActionToasts
      notifications={[
        {
          description: message.description,
          id: `inference-action-${action}`,
          title: "Inference",
          tone: message.tone,
        },
      ]}
    />
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

function inferenceUpdateHref(
  basePath: string,
  range: AdminInferenceRange,
): string {
  const query = new URLSearchParams()
  query.set("range", range)
  return `${basePath}/update?${query.toString()}`
}

function usageSignal(
  points: AdminInferenceUsagePoint[],
  metric: "requests" | "tokens",
): { average: number; deltaPercent: number } {
  const average = averageMetric(points, metric)
  const midpoint = Math.max(1, Math.floor(points.length / 2))
  const previousPoints = points.slice(0, midpoint)
  const currentPoints = points.slice(midpoint)
  const previousAverage = averageMetric(previousPoints, metric)
  const currentAverage = averageMetric(
    currentPoints.length > 0 ? currentPoints : points,
    metric,
  )

  if (previousAverage === 0) {
    return {
      average,
      deltaPercent: currentAverage > 0 ? 100 : 0,
    }
  }

  return {
    average,
    deltaPercent: ((currentAverage - previousAverage) / previousAverage) * 100,
  }
}

function averageMetric(
  points: AdminInferenceUsagePoint[],
  metric: "requests" | "tokens",
): number {
  if (points.length === 0) {
    return 0
  }

  const total = points.reduce((sum, point) => sum + point[metric], 0)
  return Math.round(total / points.length)
}

function formatNumber(value: number): string {
  return (
    value >= 1000 ? compactNumberFormatter : standardNumberFormatter
  ).format(value)
}

function formatPercent(value: number): string {
  return percentFormatter.format(value / 100)
}

function formatDateTime(value: string): string {
  return dateTimeFormatter.format(new Date(value))
}
