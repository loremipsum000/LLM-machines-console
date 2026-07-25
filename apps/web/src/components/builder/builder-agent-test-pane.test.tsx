import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { BuilderAgentTestPane } from "./builder-agent-test-pane"

describe("BuilderAgentTestPane", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("renders persisted runtime trace ids in test history", () => {
    render(
      <BuilderAgentTestPane
        disabled={false}
        quota={{
          period: "daily",
          timezone: "UTC",
          status: "unlimited",
          enforced: false,
          usedRuns: 1,
          runLimit: null,
          remainingRuns: null,
          usedTokens: 251,
          tokenLimit: null,
          remainingTokens: null,
          resetsAt: "2026-05-22T00:00:00.000Z",
        }}
        recentTestRuns={[
          {
            id: "cbe3c3ee-8619-4ec1-9837-48b45c8d0e76",
            resourceId: "66666666-6666-4666-8666-666666666666",
            input: "Say runtime trace validation passed.",
            output: "Runtime trace validation passed.",
            source: "agentic_runtime",
            status: "succeeded",
            model: "qwen3-35b-local",
            sandboxProfile: "openclaw-restricted",
            durationMs: 7802,
            runtimeTraceId: "eb7191c0-9a66-4afb-82dd-2be7b325d9fe",
            finishReason: "stop",
            promptTokens: 201,
            completionTokens: 50,
            totalTokens: 251,
            errorDetail: null,
            trace: [
              {
                at: "2026-05-21T20:18:00.000Z",
                label: "Runtime dispatch",
                status: "succeeded",
                detail: "Runtime completed.",
              },
            ],
            toolCalls: [],
            createdAt: "2026-05-21T20:18:00.000Z",
          },
        ]}
        resourceId="66666666-6666-4666-8666-666666666666"
        sampleInput="Say runtime trace validation passed."
      />,
    )

    expect(screen.getByText("Runtime trace")).toBeTruthy()
    expect(screen.getByText("eb7191c0")).toBeTruthy()
    expect(
      screen.getByTitle("eb7191c0-9a66-4afb-82dd-2be7b325d9fe"),
    ).toBeTruthy()
  })

  it("renders streamed test output from the Builder API route", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              const encoder = new TextEncoder()
              controller.enqueue(
                encoder.encode(
                  [
                    'data: {"type":"builder.agent_test.started","testRunId":"99999999-9999-4999-8999-999999999999","runtimeTraceId":"trace-stream-1"}',
                    "",
                    'data: {"type":"builder.agent_test.delta","testRunId":"99999999-9999-4999-8999-999999999999","runtimeTraceId":"trace-stream-1","delta":"Hello "}',
                    "",
                    'data: {"type":"builder.agent_test.delta","testRunId":"99999999-9999-4999-8999-999999999999","runtimeTraceId":"trace-stream-1","delta":"builder."}',
                    "",
                    `data: ${JSON.stringify({
                      type: "builder.agent_test.completed",
                      result: {
                        id: "99999999-9999-4999-8999-999999999999",
                        resourceId: "66666666-6666-4666-8666-666666666666",
                        input: "Say hello.",
                        output: "Hello builder.",
                        source: "agentic_runtime",
                        status: "succeeded",
                        model: "qwen3-35b-local",
                        sandboxProfile: "openclaw-restricted",
                        durationMs: 101,
                        runtimeTraceId: "trace-stream-1",
                        finishReason: "stop",
                        promptTokens: 4,
                        completionTokens: 2,
                        totalTokens: 6,
                        errorDetail: null,
                        trace: [],
                        toolCalls: [
                          {
                            at: "2026-05-21T20:18:01.000Z",
                            id: "call_1",
                            index: 0,
                            name: "hub.search",
                            status: "requested",
                            argumentsPreview: "query=hello",
                          },
                        ],
                        createdAt: "2026-05-21T20:18:00.000Z",
                        quota: {
                          period: "daily",
                          timezone: "UTC",
                          status: "unlimited",
                          enforced: false,
                          usedRuns: 1,
                          runLimit: null,
                          remainingRuns: null,
                          usedTokens: 6,
                          tokenLimit: null,
                          remainingTokens: null,
                          resetsAt: "2026-05-22T00:00:00.000Z",
                        },
                      },
                    })}`,
                    "",
                  ].join("\n"),
                ),
              )
              controller.close()
            },
          }),
          {
            headers: { "content-type": "text/event-stream" },
            status: 200,
          },
        ),
    )
    vi.stubGlobal("fetch", fetchMock)

    render(
      <BuilderAgentTestPane
        disabled={false}
        quota={{
          period: "daily",
          timezone: "UTC",
          status: "unlimited",
          enforced: false,
          usedRuns: 0,
          runLimit: null,
          remainingRuns: null,
          usedTokens: 0,
          tokenLimit: null,
          remainingTokens: null,
          resetsAt: "2026-05-22T00:00:00.000Z",
        }}
        recentTestRuns={[]}
        resourceId="66666666-6666-4666-8666-666666666666"
        sampleInput="Say hello."
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: /run test/i }))

    await waitFor(() => {
      expect(screen.getByText("Hello builder.")).toBeTruthy()
    })
    expect(screen.getAllByText("Tool calls").length).toBeGreaterThan(0)
    expect(screen.getAllByText("hub.search").length).toBeGreaterThan(0)
    expect(screen.getAllByTitle("trace-stream-1").length).toBeGreaterThan(0)
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/builder/agents/66666666-6666-4666-8666-666666666666/test/stream",
      expect.objectContaining({
        body: JSON.stringify({ input: "Say hello." }),
        method: "POST",
      }),
    )
  })
})
