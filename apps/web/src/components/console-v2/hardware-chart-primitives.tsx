"use client"

import type {
  AdminHardwareChart,
  AdminHardwareUnit,
} from "@llm-machines/contracts/inference-core"
import dynamic from "next/dynamic"

const chartColors = [
  "#009fff",
  "#78d957",
  "#ffcc4d",
  "#f86b6b",
  "#b68cff",
  "#55d8d2",
]
const CHART_WIDTH = 614
const DEFAULT_CHART_HEIGHT = 224
const Area = dynamic(() => import("recharts").then((module) => module.Area), {
  ssr: false,
})
const AreaChart = dynamic(
  () => import("recharts").then((module) => module.AreaChart),
  { ssr: false },
)
const Bar = dynamic(() => import("recharts").then((module) => module.Bar), {
  ssr: false,
})
const BarChart = dynamic(
  () => import("recharts").then((module) => module.BarChart),
  { ssr: false },
)
const CartesianGrid = dynamic(
  () => import("recharts").then((module) => module.CartesianGrid),
  { ssr: false },
)
const Cell = dynamic(() => import("recharts").then((module) => module.Cell), {
  ssr: false,
})
const LabelList = dynamic(
  () => import("recharts").then((module) => module.LabelList),
  { ssr: false },
)
const Line = dynamic(() => import("recharts").then((module) => module.Line), {
  ssr: false,
})
const LineChart = dynamic(
  () => import("recharts").then((module) => module.LineChart),
  { ssr: false },
)
const ReferenceLine = dynamic(
  () => import("recharts").then((module) => module.ReferenceLine),
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
const chartTimeFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
})
const chartDateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeZone: "UTC",
  timeStyle: "short",
})

interface HardwareChartPrimitiveProps {
  chart: AdminHardwareChart
}

export function HardwareChartPrimitive({ chart }: HardwareChartPrimitiveProps) {
  const hasData = chartHasRenderableData(chart)
  const height = chartHeight(chart)

  return (
    <figure
      aria-label={`${chart.title} chart`}
      className="w-full overflow-x-auto overflow-y-hidden"
      style={{ height }}
    >
      {hasData ? (
        <ChartRenderer chart={chart} height={height} />
      ) : (
        <EmptyChart chart={chart} height={height} />
      )}
    </figure>
  )
}

function ChartRenderer({
  chart,
  height,
}: { chart: AdminHardwareChart; height: number }) {
  if (chart.chartType === "bar") {
    return <HardwareBarChart chart={chart} height={height} />
  }
  if (chart.chartType === "line") {
    return <HardwareLineChart chart={chart} height={height} />
  }
  return <HardwareAreaChart chart={chart} height={height} />
}

function HardwareAreaChart({
  chart,
  height,
}: { chart: AdminHardwareChart; height: number }) {
  const { data, keys } = timeSeriesData(chart)
  return (
    <AreaChart
      data={data}
      height={height}
      margin={{ bottom: 0, left: -8, right: 0, top: 8 }}
      width={CHART_WIDTH}
    >
      <CartesianGrid stroke="#353535" strokeDasharray="3 6" vertical={false} />
      <XAxis
        dataKey="timestamp"
        tick={{ fill: "#9f9f9f", fontSize: 11 }}
        tickFormatter={formatTime}
        tickLine={false}
      />
      <YAxis
        domain={chart.unit === "percent" ? [0, 100] : ["auto", "auto"]}
        tick={{ fill: "#9f9f9f", fontSize: 11 }}
        tickFormatter={(value) => formatAxisValue(Number(value), chart.unit)}
        tickLine={false}
        width={46}
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
        formatter={(value, name) => [
          formatMetricValue(Number(value), chart.unit),
          name,
        ]}
        labelFormatter={(value) => formatDateTime(String(value))}
      />
      {chart.thresholds.map((threshold) => (
        <ReferenceLine
          ifOverflow="extendDomain"
          key={threshold.label}
          stroke={threshold.severity === "critical" ? "#ff6565" : "#ffcc4d"}
          strokeDasharray="6 4"
          y={threshold.value}
        />
      ))}
      {keys.map((key, index) => (
        <Area
          activeDot={{ r: 4 }}
          dataKey={key.key}
          fill={chartColors[index % chartColors.length]}
          fillOpacity={0.18}
          key={key.key}
          name={key.label}
          stroke={chartColors[index % chartColors.length]}
          strokeWidth={2}
          type="monotone"
        />
      ))}
    </AreaChart>
  )
}

function HardwareLineChart({
  chart,
  height,
}: { chart: AdminHardwareChart; height: number }) {
  const { data, keys } = timeSeriesData(chart)
  return (
    <LineChart
      data={data}
      height={height}
      margin={{ bottom: 0, left: -8, right: 0, top: 8 }}
      width={CHART_WIDTH}
    >
      <CartesianGrid stroke="#353535" strokeDasharray="3 6" vertical={false} />
      <XAxis
        dataKey="timestamp"
        tick={{ fill: "#9f9f9f", fontSize: 11 }}
        tickFormatter={formatTime}
        tickLine={false}
      />
      <YAxis
        tick={{ fill: "#9f9f9f", fontSize: 11 }}
        tickFormatter={(value) => formatAxisValue(Number(value), chart.unit)}
        tickLine={false}
        width={52}
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
        formatter={(value, name) => [
          formatMetricValue(Number(value), chart.unit),
          name,
        ]}
        labelFormatter={(value) => formatDateTime(String(value))}
      />
      {chart.thresholds.map((threshold) => (
        <ReferenceLine
          ifOverflow="extendDomain"
          key={threshold.label}
          stroke={threshold.severity === "critical" ? "#ff6565" : "#ffcc4d"}
          strokeDasharray="6 4"
          y={threshold.value}
        />
      ))}
      {keys.map((key, index) => (
        <Line
          activeDot={{ r: 4 }}
          dataKey={key.key}
          dot={false}
          key={key.key}
          name={key.label}
          stroke={chartColors[index % chartColors.length]}
          strokeWidth={2}
          type="monotone"
        />
      ))}
    </LineChart>
  )
}

function HardwareBarChart({
  chart,
  height,
}: { chart: AdminHardwareChart; height: number }) {
  const data = chart.series
    .map((series) => ({
      label: series.label,
      value: latestValue(series.points),
    }))
    .filter(
      (item): item is { label: string; value: number } =>
        item.value !== null && isVisibleBarValue(item.value, chart.unit),
    )

  return (
    <BarChart
      data={data}
      height={height}
      layout="vertical"
      margin={{ bottom: 0, left: 10, right: 0, top: 8 }}
      width={CHART_WIDTH}
    >
      <CartesianGrid
        stroke="#353535"
        strokeDasharray="3 6"
        horizontal={false}
      />
      <XAxis
        domain={[0, 100]}
        tick={{ fill: "#9f9f9f", fontSize: 11 }}
        tickFormatter={(value) => formatAxisValue(Number(value), chart.unit)}
        type="number"
      />
      <YAxis
        dataKey="label"
        axisLine={false}
        tick={false}
        tickLine={false}
        type="category"
        width={0}
      />
      <Tooltip
        contentStyle={{
          background: "#181818",
          border: "1px solid #353535",
          borderRadius: 8,
          color: "#fdfdfd",
        }}
        cursor={{ fill: "transparent" }}
        itemStyle={{ color: "#fdfdfd" }}
        labelStyle={{ color: "#fdfdfd" }}
        formatter={(value) => [
          formatMetricValue(Number(value), chart.unit),
          "Used",
        ]}
      />
      {chart.thresholds.map((threshold) => (
        <ReferenceLine
          ifOverflow="extendDomain"
          key={threshold.label}
          stroke={threshold.severity === "critical" ? "#ff6565" : "#ffcc4d"}
          strokeDasharray="6 4"
          x={threshold.value}
        />
      ))}
      <Bar dataKey="value" radius={[0, 6, 6, 0]}>
        <LabelList
          dataKey="label"
          fill="#fdfdfd"
          formatter={(value: unknown) => truncateLabel(String(value), 30)}
          offset={12}
          position="insideLeft"
          style={{ fontSize: 12, fontWeight: 500 }}
        />
        {data.map((item) => (
          <Cell fill={barColor(item.value)} key={item.label} />
        ))}
      </Bar>
    </BarChart>
  )
}

function EmptyChart({
  chart,
  height,
}: { chart: AdminHardwareChart; height: number }) {
  return (
    <div
      className="flex w-full items-center justify-center rounded-md border border-dashed border-[#353535] text-center text-sm leading-5 text-[#b2b2b2]"
      style={{ height }}
    >
      {chart.emptyMessage}
    </div>
  )
}

function chartHeight(chart: AdminHardwareChart): number {
  if (chart.chartType !== "bar") {
    return DEFAULT_CHART_HEIGHT
  }
  const rowCount = chart.series.filter((series) => {
    const value = latestValue(series.points)
    return value !== null && isVisibleBarValue(value, chart.unit)
  }).length
  return Math.max(DEFAULT_CHART_HEIGHT, rowCount * 34)
}

function chartHasRenderableData(chart: AdminHardwareChart): boolean {
  if (chart.chartType !== "bar") {
    return chart.series.some((series) => series.points.length > 0)
  }
  return chart.series.some((series) => {
    const value = latestValue(series.points)
    return value !== null && isVisibleBarValue(value, chart.unit)
  })
}

function isVisibleBarValue(value: number, unit: AdminHardwareUnit): boolean {
  if (unit === "percent") {
    return Math.round(value) > 0
  }
  return value > 0
}

function timeSeriesData(chart: AdminHardwareChart): {
  data: Array<Record<string, number | string | null>>
  keys: Array<{ key: string; label: string }>
} {
  const rows = new Map<string, Record<string, number | string | null>>()
  const keys = chart.series.map((series, index) => ({
    key: `series_${index}`,
    label: series.label,
  }))

  for (const [index, series] of chart.series.entries()) {
    const key = keys[index]?.key
    if (!key) {
      continue
    }
    for (const point of series.points) {
      const row = rows.get(point.timestamp) ?? { timestamp: point.timestamp }
      row[key] = point.value
      rows.set(point.timestamp, row)
    }
  }

  return {
    data: Array.from(rows.values()).sort((a, b) =>
      String(a.timestamp).localeCompare(String(b.timestamp)),
    ),
    keys,
  }
}

function latestValue(
  points: Array<{ timestamp: string; value: number | null }>,
): number | null {
  for (const point of [...points].reverse()) {
    if (point.value !== null) {
      return point.value
    }
  }
  return null
}

function barColor(value: number): string {
  if (value >= 95) {
    return "#ff6565"
  }
  if (value >= 85) {
    return "#ffcc4d"
  }
  return "#009fff"
}

function formatAxisValue(value: number, unit: AdminHardwareUnit): string {
  if (unit === "celsius") {
    return `${Math.round(value)}C`
  }
  if (unit === "bytes_per_second") {
    return formatBytes(value)
  }
  if (unit === "watt") {
    return `${Math.round(value)} W`
  }
  return `${Math.round(value)}%`
}

function formatMetricValue(value: number, unit: AdminHardwareUnit): string {
  if (!Number.isFinite(value)) {
    return "No data"
  }
  if (unit === "celsius") {
    return `${Math.round(value)} C`
  }
  if (unit === "bytes_per_second") {
    return `${formatBytes(value)}/s`
  }
  if (unit === "watt") {
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

function formatTime(value: string): string {
  return chartTimeFormatter.format(new Date(value))
}

function formatDateTime(value: string): string {
  return chartDateTimeFormatter.format(new Date(value))
}

function truncateLabel(value: string, maxLength = 18): string {
  return value.length > maxLength
    ? `${value.slice(0, Math.max(maxLength - 3, 0))}...`
    : value
}
