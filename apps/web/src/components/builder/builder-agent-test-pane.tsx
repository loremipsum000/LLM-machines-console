"use client"

import { type FormEvent, useState } from "react"
import {
  builderAgentTestStreamEventSchema,
  type BuilderAgentStudioQuota,
  type BuilderAgentTestResult,
  type BuilderAgentTestRun,
  type BuilderAgentTestStreamEvent,
} from "@llm-machines/contracts"
import { productCopy } from "@llm-machines/copy"
import { FlaskConical } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

const copy = productCopy.pages.hub.builderAgentStudio

interface BuilderAgentTestPaneProps {
  disabled: boolean
  quota: BuilderAgentStudioQuota
  recentTestRuns: BuilderAgentTestRun[]
  resourceId: string
  sampleInput: string
}

interface BuilderAgentTestPaneState {
  activeRun?: {
    runtimeTraceId: string
    testRunId: string
  }
  error?: string
  isStreaming: boolean
  quota?: BuilderAgentStudioQuota
  result?: BuilderAgentTestResult
  streamingToolCalls?: BuilderAgentTestRun["toolCalls"]
  streamingOutput: string
}

interface BuilderAgentActiveRun {
  runtimeTraceId: string
  status: string
  testRunId: string
}

interface BuilderAgentTestPaneViewModel {
  activeOutput: string
  activeRun: BuilderAgentActiveRun | null
  disabled: boolean
  error?: string
  handleSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>
  isStreaming: boolean
  quotaExhausted: boolean
  resourceId: string
  result?: BuilderAgentTestResult
  sampleInput: string
  streamingToolCalls: BuilderAgentTestRun["toolCalls"]
  visibleQuota: BuilderAgentStudioQuota
  visibleRuns: BuilderAgentTestRun[]
}

export function BuilderAgentTestPane({
  disabled,
  quota,
  recentTestRuns,
  resourceId,
  sampleInput,
}: BuilderAgentTestPaneProps) {
  const viewModel = useBuilderAgentTestPane({
    disabled,
    quota,
    recentTestRuns,
    resourceId,
    sampleInput,
  })

  return <BuilderAgentTestCard {...viewModel} />
}

function useBuilderAgentTestPane({
  disabled,
  quota,
  recentTestRuns,
  resourceId,
  sampleInput,
}: BuilderAgentTestPaneProps): BuilderAgentTestPaneViewModel {
  const [state, setState] = useState<BuilderAgentTestPaneState>({
    isStreaming: false,
    streamingOutput: "",
  })
  const visibleRuns = state.result
    ? [
        state.result,
        ...recentTestRuns.filter((run) => run.id !== state.result?.id),
      ]
    : recentTestRuns
  const visibleQuota = state.result?.quota ?? state.quota ?? quota
  const quotaExhausted = visibleQuota.status === "exhausted"
  const activeOutput = state.result?.output ?? state.streamingOutput
  const activeRun = state.result
    ? {
        runtimeTraceId: state.result.runtimeTraceId,
        status: state.result.status,
        testRunId: state.result.id,
      }
    : state.activeRun
      ? {
          runtimeTraceId: state.activeRun.runtimeTraceId,
          status: copy.streaming,
          testRunId: state.activeRun.testRunId,
        }
      : null

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (disabled || quotaExhausted || state.isStreaming) {
      return
    }

    const formData = new FormData(event.currentTarget)
    const input = formData.get("input")
    if (typeof input !== "string" || !input.trim()) {
      setState({
        error: "Test input is required.",
        isStreaming: false,
        streamingOutput: "",
      })
      return
    }

    let receivedFinalEvent = false
    setState({
      isStreaming: true,
      streamingOutput: "",
      streamingToolCalls: [],
    })

    try {
      const response = await fetch(
        `/api/builder/agents/${encodeURIComponent(resourceId)}/test/stream`,
        {
          method: "POST",
          body: JSON.stringify({ input: input.trim() }),
          headers: {
            "Content-Type": "application/json",
          },
        },
      )
      if (!response.ok) {
        throw new Error(await readBuilderProblem(response))
      }

      await readAgentTestStream(response, (streamEvent) => {
        if (streamEvent.type === "builder.agent_test.started") {
          setState((current) => ({
            ...current,
            activeRun: {
              runtimeTraceId: streamEvent.runtimeTraceId,
              testRunId: streamEvent.testRunId,
            },
            error: undefined,
            isStreaming: true,
          }))
          return
        }

        if (streamEvent.type === "builder.agent_test.delta") {
          setState((current) => ({
            ...current,
            error: undefined,
            streamingOutput: `${current.streamingOutput}${streamEvent.delta}`,
          }))
          return
        }

        if (streamEvent.type === "builder.agent_test.tool_call") {
          setState((current) => ({
            ...current,
            error: undefined,
            streamingToolCalls: [
              ...(current.streamingToolCalls ?? []),
              streamEvent.toolCall,
            ],
          }))
          return
        }

        receivedFinalEvent = true
        if (streamEvent.type === "builder.agent_test.completed") {
          setState({
            isStreaming: false,
            quota: streamEvent.result.quota,
            result: streamEvent.result,
            streamingOutput: streamEvent.result.output,
            streamingToolCalls: streamEvent.result.toolCalls,
          })
          return
        }

        setState((current) => ({
          ...current,
          error: streamEvent.detail,
          isStreaming: false,
          quota: streamEvent.quota ?? current.quota,
        }))
      })

      assertReceivedFinalEvent(receivedFinalEvent)
    } catch (error) {
      setState((current) => ({
        ...current,
        error:
          error instanceof Error ? error.message : "Agent Studio test failed.",
        isStreaming: false,
      }))
    }
  }

  return {
    activeOutput,
    activeRun,
    disabled,
    error: state.error,
    handleSubmit,
    isStreaming: state.isStreaming,
    quotaExhausted,
    resourceId,
    result: state.result,
    sampleInput,
    streamingToolCalls: state.streamingToolCalls ?? [],
    visibleQuota,
    visibleRuns,
  }
}

function BuilderAgentTestCard({
  activeOutput,
  activeRun,
  disabled,
  error,
  handleSubmit,
  isStreaming,
  quotaExhausted,
  resourceId,
  result,
  sampleInput,
  streamingToolCalls,
  visibleQuota,
  visibleRuns,
}: BuilderAgentTestPaneViewModel) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{copy.testTitle}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <QuotaMeter quota={visibleQuota} />

        <BuilderAgentTestForm
          disabled={disabled || quotaExhausted}
          handleSubmit={handleSubmit}
          isStreaming={isStreaming}
          resourceId={resourceId}
          sampleInput={sampleInput}
        />
        <BuilderAgentTestError error={error} />
        <BuilderAgentResultPanel
          activeOutput={activeOutput}
          activeRun={activeRun}
          isStreaming={isStreaming}
          result={result}
          streamingToolCalls={streamingToolCalls}
        />
        <BuilderAgentHistoryPanel visibleRuns={visibleRuns} />
      </CardContent>
    </Card>
  )
}

function BuilderAgentTestForm({
  disabled,
  handleSubmit,
  isStreaming,
  resourceId,
  sampleInput,
}: {
  disabled: boolean
  handleSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>
  isStreaming: boolean
  resourceId: string
  sampleInput: string
}) {
  return (
    <form className="space-y-3" onSubmit={handleSubmit}>
      <input name="resourceId" type="hidden" value={resourceId} />
      <label className="grid gap-2 text-sm">
        <span className="text-xs font-medium text-fg-muted">
          {copy.testInput}
        </span>
        <textarea
          className="min-h-36 resize-y rounded-md border border-line-subtle bg-surface-2 px-3 py-2 text-sm text-fg-default outline-none transition-colors placeholder:text-fg-muted focus:border-accent"
          defaultValue={sampleInput}
          disabled={disabled}
          maxLength={8000}
          name="input"
          required
        />
      </label>
      <TestSubmitButton disabled={disabled} isStreaming={isStreaming} />
    </form>
  )
}

function BuilderAgentTestError({ error }: { error?: string }) {
  if (!error) {
    return null
  }

  return (
    <div className="rounded-md border border-accent-red/30 bg-accent-red/10 p-3 text-sm text-accent-red">
      {error}
    </div>
  )
}

function BuilderAgentResultPanel({
  activeOutput,
  activeRun,
  isStreaming,
  result,
  streamingToolCalls,
}: {
  activeOutput: string
  activeRun: BuilderAgentActiveRun | null
  isStreaming: boolean
  result?: BuilderAgentTestResult
  streamingToolCalls: BuilderAgentTestRun["toolCalls"]
}) {
  return (
    <div className="rounded-md border border-line-subtle bg-surface-2 p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-xs font-medium uppercase text-fg-muted">
          {copy.result}
        </p>
        <BuilderAgentResultBadge isStreaming={isStreaming} result={result} />
      </div>
      {activeRun ? (
        <BuilderAgentActiveRunResult
          activeOutput={activeOutput}
          activeRun={activeRun}
          result={result}
          streamingToolCalls={streamingToolCalls}
        />
      ) : (
        <p className="text-sm text-fg-muted">{copy.noTestYet}</p>
      )}
    </div>
  )
}

function BuilderAgentResultBadge({
  isStreaming,
  result,
}: {
  isStreaming: boolean
  result?: BuilderAgentTestResult
}) {
  if (result) {
    return <Badge tone="good">{result.source}</Badge>
  }
  if (isStreaming) {
    return <Badge tone="info">{copy.streaming}</Badge>
  }
  return null
}

function BuilderAgentActiveRunResult({
  activeOutput,
  activeRun,
  result,
  streamingToolCalls,
}: {
  activeOutput: string
  activeRun: BuilderAgentActiveRun
  result?: BuilderAgentTestResult
  streamingToolCalls: BuilderAgentTestRun["toolCalls"]
}) {
  return (
    <div className="space-y-3">
      <BuilderAgentActiveRunMeta activeRun={activeRun} result={result} />
      <pre
        aria-live="polite"
        className="max-h-72 overflow-auto whitespace-pre-wrap text-sm leading-6 text-fg-default"
      >
        {activeOutput || copy.waitingForTokens}
      </pre>
      <ToolCallList toolCalls={result?.toolCalls ?? streamingToolCalls} />
      {result ? <TraceList trace={result.trace} /> : null}
    </div>
  )
}

function BuilderAgentActiveRunMeta({
  activeRun,
  result,
}: {
  activeRun: BuilderAgentActiveRun
  result?: BuilderAgentTestResult
}) {
  return (
    <div className="grid gap-2 text-xs text-fg-muted sm:grid-cols-3">
      <RuntimeMeta
        fullValue={activeRun.testRunId}
        label={copy.runId}
        value={formatRunId(activeRun.testRunId)}
      />
      <RuntimeMeta label={copy.status} value={activeRun.status} />
      {result ? (
        <>
          <RuntimeMeta label={copy.source} value={result.source} />
          <RuntimeMeta label={copy.duration} value={`${result.durationMs}ms`} />
        </>
      ) : null}
      <RuntimeMeta
        fullValue={activeRun.runtimeTraceId}
        label={copy.runtimeTraceId}
        value={formatRunId(activeRun.runtimeTraceId)}
      />
      {result ? (
        <>
          <RuntimeMeta
            label={copy.finishReason}
            value={result.finishReason ?? "n/a"}
          />
          <RuntimeMeta label={copy.tokens} value={formatTokenUsage(result)} />
        </>
      ) : null}
    </div>
  )
}

function BuilderAgentHistoryPanel({
  visibleRuns,
}: {
  visibleRuns: BuilderAgentTestRun[]
}) {
  return (
    <div className="rounded-md border border-line-subtle bg-surface-2 p-3">
      <p className="mb-3 text-xs font-medium uppercase text-fg-muted">
        {copy.testHistory}
      </p>
      {visibleRuns.length > 0 ? (
        <ul className="space-y-3">
          {visibleRuns.slice(0, 5).map((run) => (
            <BuilderAgentHistoryItem key={run.id} run={run} />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-fg-muted">{copy.noTestHistory}</p>
      )}
    </div>
  )
}

function BuilderAgentHistoryItem({ run }: { run: BuilderAgentTestRun }) {
  return (
    <li className="rounded-md border border-line-subtle bg-surface-1 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={run.status === "succeeded" ? "good" : "critical"}>
          {run.status}
        </Badge>
        <Badge tone="info">{run.source}</Badge>
        <span className="text-xs text-fg-muted">
          {new Date(run.createdAt).toLocaleString()}
        </span>
      </div>
      <p className="mt-2 line-clamp-2 text-sm text-fg-default">{run.input}</p>
      <BuilderAgentHistoryMeta run={run} />
      {run.status === "failed" && run.errorDetail ? (
        <p className="mt-3 rounded-md border border-accent-red/30 bg-accent-red/10 p-2 text-xs text-accent-red">
          {copy.error}: {run.errorDetail}
        </p>
      ) : null}
      <ToolCallList toolCalls={run.toolCalls} />
      <TraceList trace={run.trace} />
    </li>
  )
}

function BuilderAgentHistoryMeta({ run }: { run: BuilderAgentTestRun }) {
  return (
    <div className="mt-3 grid gap-2 text-xs text-fg-muted sm:grid-cols-3">
      <RuntimeMeta
        fullValue={run.id}
        label={copy.runId}
        value={formatRunId(run.id)}
      />
      <RuntimeMeta label={copy.model} value={run.model} />
      <RuntimeMeta label={copy.sandboxProfile} value={run.sandboxProfile} />
      <RuntimeMeta label={copy.duration} value={`${run.durationMs}ms`} />
      <RuntimeMeta
        fullValue={run.runtimeTraceId}
        label={copy.runtimeTraceId}
        value={formatRunId(run.runtimeTraceId)}
      />
      <RuntimeMeta
        label={copy.finishReason}
        value={run.finishReason ?? "n/a"}
      />
      <RuntimeMeta label={copy.tokens} value={formatTokenUsage(run)} />
    </div>
  )
}

function TraceList({
  trace,
}: {
  trace: BuilderAgentTestRun["trace"]
}) {
  if (trace.length === 0) {
    return null
  }

  return (
    <div className="mt-3 rounded-md border border-line-subtle bg-surface-1 p-3">
      <p className="mb-2 text-xs font-medium uppercase text-fg-muted">
        {copy.trace}
      </p>
      <ol className="space-y-2">
        {trace.map((step, index) => (
          <li
            className="flex min-w-0 items-start gap-2"
            key={`${step.at}:${index}`}
          >
            <Badge tone={traceTone(step.status)}>{step.status}</Badge>
            <div className="min-w-0 text-xs">
              <p className="font-medium text-fg-default">{step.label}</p>
              {step.detail ? (
                <p className="mt-1 text-fg-muted">{step.detail}</p>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}

function ToolCallList({
  toolCalls,
}: {
  toolCalls: BuilderAgentTestRun["toolCalls"]
}) {
  if (toolCalls.length === 0) {
    return null
  }

  return (
    <div className="mt-3 rounded-md border border-line-subtle bg-surface-1 p-3">
      <p className="mb-2 text-xs font-medium uppercase text-fg-muted">
        {copy.toolCalls}
      </p>
      <ol className="space-y-2">
        {toolCalls.map((toolCall, index) => (
          <li
            className="min-w-0 rounded-md border border-line-subtle bg-surface-2 p-2"
            key={`${toolCall.id ?? toolCall.name}:${toolCall.index ?? index}`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={toolCallTone(toolCall.status)}>
                {toolCall.status}
              </Badge>
              <span className="text-xs font-medium text-fg-default">
                {toolCall.name}
              </span>
            </div>
            {toolCall.argumentsPreview ? (
              <p className="mt-2 break-words text-xs text-fg-muted">
                {copy.toolArguments}: {toolCall.argumentsPreview}
              </p>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  )
}

function QuotaMeter({ quota }: { quota: BuilderAgentStudioQuota }) {
  return (
    <div className="rounded-md border border-line-subtle bg-surface-2 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase text-fg-muted">
          {copy.quotaTitle}
        </p>
        <Badge tone={quotaTone(quota.status)}>
          {copy.quotaStatus[quota.status]}
        </Badge>
      </div>
      <div className="mt-3 grid gap-2 text-xs text-fg-muted sm:grid-cols-3">
        <RuntimeMeta
          label={copy.quotaRuns}
          value={formatQuotaValue(
            quota.usedRuns,
            quota.runLimit,
            quota.remainingRuns,
          )}
        />
        <RuntimeMeta
          label={copy.quotaTokens}
          value={formatQuotaValue(
            quota.usedTokens,
            quota.tokenLimit,
            quota.remainingTokens,
          )}
        />
        <RuntimeMeta
          label={copy.quotaResets}
          value={new Date(quota.resetsAt).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        />
      </div>
    </div>
  )
}

function RuntimeMeta({
  fullValue,
  label,
  value,
}: {
  fullValue?: string
  label: string
  value: string
}) {
  return (
    <div className="min-w-0 rounded-md border border-line-subtle bg-surface-1 px-2 py-1.5">
      <p className="truncate uppercase">{label}</p>
      <p
        className="mt-1 truncate font-medium text-fg-default"
        title={fullValue}
      >
        {value}
      </p>
    </div>
  )
}

function formatRunId(id: string): string {
  return id.slice(0, 8)
}

function formatTokenUsage(run: BuilderAgentTestRun): string {
  if (run.totalTokens !== null) {
    return run.totalTokens.toLocaleString()
  }
  if (run.promptTokens !== null || run.completionTokens !== null) {
    const prompt = run.promptTokens?.toLocaleString() ?? "?"
    const completion = run.completionTokens?.toLocaleString() ?? "?"
    return `${prompt} + ${completion}`
  }
  return "n/a"
}

function formatQuotaValue(
  used: number,
  limit: number | null,
  remaining: number | null,
): string {
  if (limit === null || remaining === null) {
    return `${used.toLocaleString()} / ${copy.quotaUnlimited}`
  }
  return `${used.toLocaleString()} / ${limit.toLocaleString()}`
}

function quotaTone(
  status: BuilderAgentStudioQuota["status"],
): "neutral" | "good" | "warning" | "critical" | "info" {
  if (status === "exhausted") {
    return "critical"
  }
  if (status === "near_limit") {
    return "warning"
  }
  if (status === "ok") {
    return "good"
  }
  return "neutral"
}

function traceTone(
  status: BuilderAgentTestRun["trace"][number]["status"],
): "neutral" | "good" | "warning" | "critical" | "info" {
  if (status === "succeeded") {
    return "good"
  }
  if (status === "failed") {
    return "critical"
  }
  return "neutral"
}

function toolCallTone(
  status: BuilderAgentTestRun["toolCalls"][number]["status"],
): "neutral" | "good" | "warning" | "critical" | "info" {
  if (status === "completed") {
    return "good"
  }
  if (status === "failed") {
    return "critical"
  }
  return "info"
}

async function readAgentTestStream(
  response: Response,
  onEvent: (event: BuilderAgentTestStreamEvent) => void,
): Promise<void> {
  if (!response.body) {
    throw new Error("Agent Studio stream returned an empty response.")
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  try {
    async function readNextChunk(): Promise<void> {
      const { done, value } = await reader.read()
      if (done) {
        return
      }

      buffer += decoder.decode(value, { stream: true })
      buffer = drainAgentTestStreamFrames(buffer, onEvent)
      await readNextChunk()
    }

    await readNextChunk()
    buffer += decoder.decode()
    if (buffer.trim()) {
      drainAgentTestStreamFrames(`${buffer}\n\n`, onEvent)
    }
  } finally {
    reader.releaseLock()
  }
}

function assertReceivedFinalEvent(receivedFinalEvent: boolean): void {
  if (!receivedFinalEvent) {
    throw new Error("Agent Studio stream ended before a result arrived.")
  }
}

function drainAgentTestStreamFrames(
  input: string,
  onEvent: (event: BuilderAgentTestStreamEvent) => void,
): string {
  const frames = input.split(/\r?\n\r?\n/)
  const remainder = frames.pop() ?? ""

  for (const frame of frames) {
    const data = frame
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trimStart())
      .join("\n")
      .trim()
    if (!data) {
      continue
    }

    onEvent(builderAgentTestStreamEventSchema.parse(JSON.parse(data)))
  }

  return remainder
}

async function readBuilderProblem(response: Response): Promise<string> {
  const fallback = `Agent Studio test failed with ${response.status}.`
  const contentType = response.headers.get("content-type") ?? ""
  if (!contentType.includes("application/json")) {
    return fallback
  }

  try {
    const body = (await response.json()) as unknown
    if (!body || typeof body !== "object") {
      return fallback
    }
    const detail = (body as { detail?: unknown }).detail
    if (typeof detail === "string" && detail.trim()) {
      return detail.trim()
    }
    const title = (body as { title?: unknown }).title
    if (typeof title === "string" && title.trim()) {
      return title.trim()
    }
  } catch {
    return fallback
  }

  return fallback
}

function TestSubmitButton({
  disabled,
  isStreaming,
}: {
  disabled: boolean
  isStreaming: boolean
}) {
  return (
    <Button
      className="w-full justify-between"
      disabled={disabled || isStreaming}
      type="submit"
      variant="primary"
    >
      <span>{isStreaming ? copy.streaming : copy.runTest}</span>
      <FlaskConical aria-hidden className="size-4" />
    </Button>
  )
}
