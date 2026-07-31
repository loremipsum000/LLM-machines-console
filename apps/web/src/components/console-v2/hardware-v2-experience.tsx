import Link from "next/link"
import type {
  AdminHardwareChart,
  AdminHardwareRange,
  AdminHardwareResponse,
  InferenceCoreSourceStatus,
} from "@llm-machines/contracts/inference-core"
import { ArrowUpRight } from "lucide-react"
import { cn } from "@/lib/utils"
import { HardwareChartPrimitive } from "./hardware-chart-primitives"

const rangeOptions: Array<{ label: string; value: AdminHardwareRange }> = [
  { label: "1h", value: "1h" },
  { label: "6h", value: "6h" },
  { label: "24h", value: "24h" },
  { label: "7d", value: "7d" },
]

interface HardwareV2ExperienceProps {
  basePath?: string
  hardware: AdminHardwareResponse
}

export function HardwareV2Experience({
  basePath = "/hardware",
  hardware,
}: HardwareV2ExperienceProps) {
  return (
    <div className="w-full min-h-screen pb-16 pt-8 lg:pt-[73px]">
      <header>
        <nav
          aria-label="Breadcrumb"
          className="text-sm font-medium leading-5 text-[#b2b2b2]"
        >
          Hardware
        </nav>
        <h1 className="mt-3 text-2xl font-semibold leading-none text-[#fdfdfd]">
          Hardware
        </h1>
        <p className="mt-3 max-w-[560px] text-sm leading-5 text-[#b2b2b2]">
          Seven operational signals pulled through the Console BFF from the same
          Prometheus metrics used by Grafana.
        </p>
      </header>

      <section className="mt-8 flex flex-col gap-4 lg:w-[640px]">
        <HardwareToolbar basePath={basePath} hardware={hardware} />
        <HardwareSummary hardware={hardware} />
        <div className="flex flex-col gap-3">
          {hardware.charts.map((chart) => (
            <HardwareChartPanel chart={chart} key={chart.id} />
          ))}
        </div>
      </section>
    </div>
  )
}

function HardwareToolbar({
  basePath,
  hardware,
}: {
  basePath: string
  hardware: AdminHardwareResponse
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#353535] bg-[#232323] p-3">
      <div className="flex min-w-0 items-center gap-2">
        <span className="text-sm font-medium leading-5 text-white">Range</span>
        <div className="flex rounded-md border border-[#353535] bg-[#181818] p-1">
          {rangeOptions.map((option) => (
            <Link
              aria-current={
                hardware.range === option.value ? "page" : undefined
              }
              className={cn(
                "rounded px-2.5 py-1 text-sm font-medium leading-[18px] text-[#b2b2b2] transition-colors hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#009fff]",
                hardware.range === option.value && "bg-[#2e2e2e] text-white",
              )}
              href={hardwareHref(basePath, option.value)}
              key={option.value}
            >
              {option.label}
            </Link>
          ))}
        </div>
      </div>

      {hardware.grafanaUrl ? (
        <Link
          className="flex items-center gap-1.5 rounded-md bg-[#2e2e2e] px-3 py-2 text-sm font-medium leading-[18px] text-white transition-colors hover:bg-[#353535] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#009fff]"
          href={hardware.grafanaUrl}
        >
          Open Grafana
          <ArrowUpRight aria-hidden className="size-4" />
        </Link>
      ) : null}
    </div>
  )
}

function HardwareSummary({ hardware }: { hardware: AdminHardwareResponse }) {
  return (
    <section className="rounded-lg border border-[#353535] bg-[#232323] p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex items-center gap-2">
            <StatusDot status={hardware.sourceStatus} />
            <h2 className="text-base font-semibold leading-[19px] text-white">
              Signal status
            </h2>
          </div>
          <p className="max-w-[520px] text-sm leading-5 text-[#b2b2b2]">
            {hardware.summary}
          </p>
        </div>
        <div className="text-right text-xs font-medium leading-5 text-[#9f9f9f]">
          <p>{hardware.range}</p>
          <p>{hardware.step}</p>
        </div>
      </div>
    </section>
  )
}

function HardwareChartPanel({ chart }: { chart: AdminHardwareChart }) {
  const latest = latestReadableValue(chart)

  return (
    <section className="rounded-lg border border-[#353535] bg-[#232323] p-3">
      <div className="mb-3 flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="flex items-center gap-2">
              <StatusDot status={chart.sourceStatus} />
              <h2 className="text-base font-semibold leading-[19px] text-white">
                {chart.title}
              </h2>
            </div>
            <p className="max-w-[500px] text-sm leading-5 text-[#b2b2b2]">
              {chart.description}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            {latest ? (
              <span className="text-xl font-semibold leading-none text-white">
                {latest}
              </span>
            ) : null}
            {chart.thresholds.length > 0 ? (
              <div className="flex max-w-[220px] flex-wrap justify-end gap-1.5">
                {chart.thresholds.map((threshold) => (
                  <span
                    className={cn(
                      "rounded-full border px-2 py-1 text-xs font-medium leading-none",
                      threshold.severity === "critical"
                        ? "border-[#5e2424] bg-[#351d1d] text-[#ff6565]"
                        : "border-[#5b4a18] bg-[#302914] text-[#ffcc4d]",
                    )}
                    key={threshold.label}
                  >
                    {threshold.label}:{" "}
                    {formatChartValue(threshold.value, chart)}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </div>
        <details className="w-full text-xs leading-5 text-[#9f9f9f]">
          <summary className="cursor-pointer text-[#b2b2b2]">PromQL</summary>
          <code className="mt-2 block w-full whitespace-pre-wrap break-words rounded-lg bg-[#181818] px-4 py-3 text-[11px] leading-5 text-[#dfdfdf]">
            {chart.promql}
          </code>
        </details>
      </div>
      <HardwareChartPrimitive chart={chart} />
    </section>
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

function latestReadableValue(chart: AdminHardwareChart): string | null {
  const values = chart.series
    .map((series) =>
      [...series.points].reverse().find((point) => point.value !== null),
    )
    .filter((point): point is { timestamp: string; value: number } =>
      Boolean(point),
    )
    .map((point) => point.value)
  if (values.length === 0) {
    return null
  }
  const maxValue = Math.max(...values)
  return formatChartValue(maxValue, chart)
}

function formatChartValue(value: number, chart: AdminHardwareChart): string {
  if (chart.unit === "celsius") {
    return `${Math.round(value)} C`
  }
  if (chart.unit === "bytes_per_second") {
    return `${formatBytes(value)}/s`
  }
  if (chart.unit === "watt") {
    return `${Math.round(value)} W`
  }
  return `${Math.round(value)}%`
}

function formatBytes(value: number): string {
  const units = ["B", "KB", "MB", "GB"]
  let current = value
  let unitIndex = 0
  while (current >= 1024 && unitIndex < units.length - 1) {
    current /= 1024
    unitIndex += 1
  }
  return `${current >= 10 ? Math.round(current) : current.toFixed(1)} ${units[unitIndex]}`
}

function hardwareHref(basePath: string, range: AdminHardwareRange): string {
  const query = new URLSearchParams()
  query.set("range", range)
  const queryString = query.toString()
  return `${basePath}${queryString ? `?${queryString}` : ""}`
}
