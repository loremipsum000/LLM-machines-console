"use client"

import dynamic from "next/dynamic"
import type {
  AdminInferenceUnit,
  AdminInferenceUsagePoint,
} from "@llm-machines/contracts/inference-core"

const CHART_WIDTH = 614
const CHART_HEIGHT = 196
const Area = dynamic(() => import("recharts").then((module) => module.Area), {
  ssr: false,
})
const AreaChart = dynamic(
  () => import("recharts").then((module) => module.AreaChart),
  { ssr: false },
)
const CartesianGrid = dynamic(
  () => import("recharts").then((module) => module.CartesianGrid),
  { ssr: false },
)
const Tooltip = dynamic(
  () => import("recharts").then((module) => module.Tooltip),
  { ssr: false },
)
const XAxis = dynamic(() => import("recharts").then((module) => module.XAxis), {
  ssr: false,
})
const YAxis = dynamic(() => import("recharts").then((module) => module.YAxis), {
  ssr: false,
})
const compactNumberFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
  notation: "compact",
})
const standardNumberFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
  notation: "standard",
})
const chartDayFormatter = new Intl.DateTimeFormat("en-US", {
  day: "2-digit",
  month: "short",
  timeZone: "UTC",
})
const chartDateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeZone: "UTC",
  timeStyle: "short",
})

interface InferenceUsageChartPrimitiveProps {
  label: string
  metric: "requests" | "tokens"
  points: AdminInferenceUsagePoint[]
  unit: AdminInferenceUnit
}

export function InferenceUsageChartPrimitive({
  label,
  metric,
  points,
  unit,
}: InferenceUsageChartPrimitiveProps) {
  const hasData = points.some((point) => point[metric] > 0)

  return (
    <figure
      aria-label={`${label} chart`}
      className="w-full overflow-x-auto overflow-y-hidden"
      style={{ height: CHART_HEIGHT }}
    >
      {hasData ? (
        <AreaChart
          data={points}
          height={CHART_HEIGHT}
          margin={{ bottom: 0, left: -8, right: 0, top: 8 }}
          width={CHART_WIDTH}
        >
          <CartesianGrid
            stroke="#353535"
            strokeDasharray="3 6"
            vertical={false}
          />
          <XAxis
            dataKey="timestamp"
            tick={{ fill: "#9f9f9f", fontSize: 11 }}
            tickFormatter={formatTime}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: "#9f9f9f", fontSize: 11 }}
            tickFormatter={(value) => formatMetricValue(Number(value), unit)}
            tickLine={false}
            width={58}
          />
          <Tooltip
            contentStyle={{
              background: "#181818",
              border: "1px solid #353535",
              borderRadius: 8,
              color: "#fdfdfd",
            }}
            itemStyle={{ color: "#fdfdfd" }}
            labelStyle={{ color: "#fdfdfd" }}
            formatter={(value) => [
              formatMetricValue(Number(value), unit),
              label,
            ]}
            labelFormatter={(value) => formatDateTime(String(value))}
          />
          <Area
            activeDot={{ r: 4 }}
            dataKey={metric}
            fill={metric === "tokens" ? "#78d957" : "#009fff"}
            fillOpacity={0.18}
            name={label}
            stroke={metric === "tokens" ? "#78d957" : "#009fff"}
            strokeWidth={2}
            type="monotone"
          />
        </AreaChart>
      ) : (
        <div className="flex h-full w-full items-center justify-center rounded-md border border-dashed border-[#353535] text-center text-sm leading-5 text-[#b2b2b2]">
          No {label.toLowerCase()} samples are available for this range.
        </div>
      )}
    </figure>
  )
}

function formatMetricValue(value: number, unit: AdminInferenceUnit): string {
  if (!Number.isFinite(value)) {
    return "No data"
  }
  if (unit === "usd") {
    return `$${value.toFixed(2)}`
  }
  return formatCompactNumber(value)
}

function formatCompactNumber(value: number): string {
  return (
    value >= 1000 ? compactNumberFormatter : standardNumberFormatter
  ).format(value)
}

function formatTime(value: string): string {
  return chartDayFormatter.format(new Date(value))
}

function formatDateTime(value: string): string {
  return chartDateTimeFormatter.format(new Date(value))
}
