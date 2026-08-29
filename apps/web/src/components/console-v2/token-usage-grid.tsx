"use client"

import { cn } from "@/lib/utils"
import type {
  AdminOverviewTokenUsage,
  AdminOverviewTokenUsagePoint,
} from "@llm-machines/contracts/inference-core"
import { type KeyboardEvent, useMemo, useState } from "react"

const DAY_MS = 24 * 60 * 60 * 1000
const RANGE_DAYS = 90
const DAY_LABELS = ["", "Mon", "", "Wed", "", "Fri", ""]
const LEVEL_CLASSES = [
  "border-[#30363d] bg-[#1d1d1d]",
  "border-[#23465b] bg-[#17384d]",
  "border-[#1c6b91] bg-[#145b80]",
  "border-[#0c92c4] bg-[#087faf]",
  "border-[#36b7ff] bg-[#009fff]",
] as const

const tokenFormatter = new Intl.NumberFormat("en-US")
const dateFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeZone: "UTC",
})
const monthFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  timeZone: "UTC",
})

interface TokenUsageGridProps {
  generatedAt: string
  usage: AdminOverviewTokenUsage
}

interface CalendarDay {
  date: string
  dateValue: Date
  inRange: boolean
  level: number
  reported: boolean
  tokens: number | null
}

interface UsageCalendar {
  cells: CalendarDay[]
  monthLabels: Array<string | null>
  rangeDays: CalendarDay[]
  weekCount: number
}

export function TokenUsageGrid({ generatedAt, usage }: TokenUsageGridProps) {
  const calendar = useMemo(
    () => buildUsageCalendar(generatedAt, usage.points),
    [generatedAt, usage.points],
  )
  const [selectedDate, setSelectedDate] = useState<string | null>(
    calendar.rangeDays.at(-1)?.date ?? null,
  )
  const selectedDay =
    calendar.rangeDays.find(({ date }) => date === selectedDate) ??
    calendar.rangeDays.at(-1) ??
    null

  if (usage.sourceStatus !== "ok") {
    return (
      <p className="mt-4 rounded-md border border-[#353535] bg-[#1d1d1d] p-3 text-sm leading-5 text-[#b2b2b2]">
        {usage.sourceStatus === "not_configured"
          ? "Token usage is not configured for this Console."
          : "Token usage is temporarily unavailable."}
      </p>
    )
  }

  const gridColumns = `repeat(${calendar.weekCount}, minmax(0, 1fr))`
  const calendarRows = Array.from({ length: 7 }, (_, rowIndex) =>
    Array.from(
      { length: calendar.weekCount },
      (_, weekIndex) => calendar.cells[weekIndex * 7 + rowIndex],
    ),
  )
  const hasReportedUsage = calendar.rangeDays.some(({ reported }) => reported)

  function handleKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    currentDate: string,
  ) {
    const currentIndex = Math.max(
      0,
      calendar.rangeDays.findIndex(({ date }) => date === currentDate),
    )
    const offset = {
      ArrowDown: 1,
      ArrowLeft: -7,
      ArrowRight: 7,
      ArrowUp: -1,
    }[event.key]
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? calendar.rangeDays.length - 1
          : offset === undefined
            ? null
            : Math.min(
                calendar.rangeDays.length - 1,
                Math.max(0, currentIndex + offset),
              )
    if (nextIndex === null) {
      return
    }
    event.preventDefault()
    const nextDate = calendar.rangeDays[nextIndex]?.date ?? null
    setSelectedDate(nextDate)
    if (nextDate) {
      document.getElementById(`overview-token-usage-day-${nextDate}`)?.focus()
    }
  }

  return (
    <div className="mt-4">
      <div
        aria-live="polite"
        className="flex min-h-5 items-center text-xs leading-5 text-[#b2b2b2]"
        id="overview-token-usage-detail"
      >
        {selectedDay
          ? usageLabel(selectedDay)
          : "Select a day to inspect usage."}
      </div>

      <div className="mt-3 overflow-x-auto pb-2">
        <div className="min-w-[420px] max-w-[480px]">
          <div className="grid grid-cols-[2rem_1fr] gap-2">
            <span aria-hidden />
            <div
              aria-hidden
              className="grid gap-1 text-xs leading-4 text-[#8f8f8f]"
              style={{ gridTemplateColumns: gridColumns }}
            >
              {calendar.monthLabels.map((label, index) => (
                <span key={`${label ?? "empty"}-${index}`}>{label}</span>
              ))}
            </div>

            <div
              aria-hidden
              className="grid grid-rows-7 gap-1 text-[11px] leading-none text-[#8f8f8f]"
            >
              {DAY_LABELS.map((label, index) => (
                <span
                  className="flex items-center"
                  key={`${label || "blank"}-${index}`}
                >
                  {label}
                </span>
              ))}
            </div>
            <fieldset
              aria-describedby="overview-token-usage-detail"
              className="grid w-full gap-1 border-0 bg-transparent p-0"
              style={{ gridTemplateColumns: gridColumns }}
            >
              <legend className="sr-only">
                Daily token usage for the last 90 days. Use arrow keys to
                inspect dates.
              </legend>
              {calendarRows.map((row) => (
                <span
                  aria-hidden={false}
                  className="contents"
                  key={`row-${row[0]?.date ?? "missing"}`}
                >
                  {row.map((day) =>
                    day?.inRange ? (
                      <button
                        aria-label={usageLabel(day)}
                        aria-pressed={selectedDay?.date === day.date}
                        className={cn(
                          "aspect-square min-w-0 appearance-none rounded-[3px] border p-0 transition-transform hover:scale-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#009fff]",
                          LEVEL_CLASSES[day.level],
                          !day.reported && "border-dashed opacity-70",
                          selectedDay?.date === day.date &&
                            "ring-2 ring-[#009fff] ring-offset-1 ring-offset-[#232323]",
                        )}
                        data-date={day.date}
                        data-level={day.level}
                        data-reported={day.reported ? "true" : "false"}
                        id={`overview-token-usage-day-${day.date}`}
                        key={day.date}
                        onClick={() => setSelectedDate(day.date)}
                        onFocus={() => setSelectedDate(day.date)}
                        onKeyDown={(event) => handleKeyDown(event, day.date)}
                        onMouseEnter={() => setSelectedDate(day.date)}
                        tabIndex={selectedDay?.date === day.date ? 0 : -1}
                        title={usageLabel(day)}
                        type="button"
                      />
                    ) : (
                      <span aria-hidden key={day?.date ?? "missing-cell"} />
                    ),
                  )}
                </span>
              ))}
            </fieldset>
          </div>
        </div>
      </div>

      <div className="mt-1 flex flex-wrap items-center justify-between gap-3 text-xs leading-4 text-[#8f8f8f]">
        <span>
          {hasReportedUsage
            ? "Color intensity is relative to this period."
            : "No daily token usage was reported for this period."}
        </span>
        <span
          aria-label="Relative daily token usage from less to more"
          className="inline-flex items-center gap-1.5"
        >
          Less
          {LEVEL_CLASSES.map((className) => (
            <span
              aria-hidden
              className={cn("size-3 rounded-[3px] border", className)}
              key={className}
            />
          ))}
          More
        </span>
      </div>
    </div>
  )
}

export function buildUsageCalendar(
  generatedAt: string,
  points: AdminOverviewTokenUsagePoint[],
): UsageCalendar {
  const endDate = utcDateStart(generatedAt)
  const firstDate = new Date(endDate.getTime() - (RANGE_DAYS - 1) * DAY_MS)
  const calendarStart = new Date(
    firstDate.getTime() - firstDate.getUTCDay() * DAY_MS,
  )
  const calendarEnd = new Date(
    endDate.getTime() + (6 - endDate.getUTCDay()) * DAY_MS,
  )
  const firstDateKey = firstDate.toISOString().slice(0, 10)
  const admittedPoints = points.filter(({ date }) => {
    const pointDate = utcDateStart(date)
    return pointDate >= firstDate && pointDate <= endDate
  })
  const pointByDate = new Map(
    admittedPoints.map((point) => [point.date, point.tokens]),
  )
  const maxTokens = Math.max(0, ...admittedPoints.map(({ tokens }) => tokens))
  const cells: CalendarDay[] = []

  for (
    let cursor = calendarStart;
    cursor <= calendarEnd;
    cursor = new Date(cursor.getTime() + DAY_MS)
  ) {
    const date = cursor.toISOString().slice(0, 10)
    const tokens = pointByDate.get(date) ?? null
    const inRange = cursor >= firstDate && cursor <= endDate
    cells.push({
      date,
      dateValue: cursor,
      inRange,
      level: tokens === null ? 0 : usageLevel(tokens, maxTokens),
      reported: tokens !== null,
      tokens,
    })
  }

  const weekCount = cells.length / 7
  const monthLabels = Array.from({ length: weekCount }, (_, weekIndex) => {
    const week = cells.slice(weekIndex * 7, weekIndex * 7 + 7)
    const labelDay = week.find(
      ({ date, dateValue, inRange }) =>
        inRange && (date === firstDateKey || dateValue.getUTCDate() === 1),
    )
    if (!labelDay) {
      return null
    }
    return monthFormatter.format(labelDay.dateValue)
  })

  return {
    cells,
    monthLabels,
    rangeDays: cells.filter(({ inRange }) => inRange),
    weekCount,
  }
}

function usageLevel(tokens: number, maxTokens: number): number {
  if (tokens <= 0 || maxTokens <= 0) {
    return 0
  }
  return Math.max(
    1,
    Math.min(4, Math.ceil((4 * Math.log1p(tokens)) / Math.log1p(maxTokens))),
  )
}

function usageLabel(day: CalendarDay): string {
  const date = dateFormatter.format(day.dateValue)
  return day.reported
    ? `${tokenFormatter.format(day.tokens ?? 0)} tokens on ${date} UTC`
    : `No token usage reported on ${date} UTC`
}

function utcDateStart(value: string): Date {
  const parsed = new Date(value)
  return new Date(
    Date.UTC(
      parsed.getUTCFullYear(),
      parsed.getUTCMonth(),
      parsed.getUTCDate(),
    ),
  )
}
