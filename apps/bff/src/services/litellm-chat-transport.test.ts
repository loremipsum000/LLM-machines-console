import { EventEmitter } from "node:events"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { ChatCompletionsBody } from "../inference/chat-completions"
import {
  LITELLM_CHAT_DEADLINE_MAX_MS,
  LiteLlmTransportError,
  configuredLiteLlmChatDeadlineMs,
  createLiteLlmChatTransport,
  createOpenAIStreamingUsageParser,
  getLiteLlmTransportErrorReason,
  parseOpenAIUsage,
  readLiteLlmNonStreamingResponse,
  waitForWritableDrainOrAbort,
} from "./litellm-chat-transport"

describe("LiteLLM transport", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it("uses only the fixed chat POST and preserves OpenAI tool transport", async () => {
    stubLiteLlmConfig()
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          'data: {"usage":{"prompt_tokens":1,"completion_tokens":2,"total_tokens":3}}\n\ndata: [DONE]\n\n',
          { headers: { "content-type": "text/event-stream" } },
        ),
      )
    vi.stubGlobal("fetch", fetchMock)
    const requestBody: ChatCompletionsBody = {
      messages: [
        { role: "user", content: [{ text: "weather", type: "text" }] },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              function: {
                arguments: '{"city":"Zagreb"}',
                name: "weather",
              },
              id: "call-1",
              type: "function",
            },
          ],
        },
        {
          content: '{"condition":"sunny"}',
          role: "tool",
          tool_call_id: "call-1",
        },
      ],
      model: "local-a",
      stream: true,
      tool_choice: "auto",
      tools: [
        {
          function: {
            name: "weather",
            parameters: { type: "object" },
          },
          type: "function",
        },
      ],
    }

    const result = await createLiteLlmChatTransport()?.createChatCompletion(
      requestBody,
      new AbortController().signal,
    )

    expect(result?.ok).toBe(true)
    if (!result?.ok) {
      throw new Error("Expected a successful transport response.")
    }
    await expect(result.response.text()).resolves.toContain("total_tokens")
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "http://litellm.test/v1/chat/completions",
    )
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      redirect: "error",
    })
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      ...requestBody,
      messages: [
        { role: "user", content: "weather" },
        ...requestBody.messages.slice(1),
      ],
      stream_options: { include_usage: true },
    })
  })

  it("returns a bounded non-stream body with structured usage", async () => {
    stubLiteLlmConfig()
    const upstreamBody = JSON.stringify({
      choices: [{ message: { content: "hello", role: "assistant" } }],
      usage: { completion_tokens: 0, prompt_tokens: 2, total_tokens: 2 },
    })
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(upstreamBody, {
        headers: { "content-type": "application/json" },
      }),
    )
    vi.stubGlobal("fetch", fetchMock)
    const result = await createLiteLlmChatTransport()?.createChatCompletion(
      basicRequest(),
      new AbortController().signal,
    )
    if (!result?.ok) {
      throw new Error("Expected a successful transport response.")
    }

    await expect(
      readLiteLlmNonStreamingResponse(result.response),
    ).resolves.toEqual({
      body: upstreamBody,
      ok: true,
      usage: { inputTokens: 2, outputTokens: 0, totalTokens: 2 },
    })
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: expect.objectContaining({ Accept: "application/json" }),
      method: "POST",
      redirect: "error",
    })
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual(
      basicRequest(),
    )
  })

  it("preserves reported zero usage and distinguishes missing fields", () => {
    expect(
      parseOpenAIUsage(
        '{"usage":{"prompt_tokens":0,"completion_tokens":0,"total_tokens":0}}',
      ),
    ).toEqual({ inputTokens: 0, outputTokens: 0, totalTokens: 0 })
    expect(parseOpenAIUsage('{"usage":{"total_tokens":7}}')).toEqual({
      inputTokens: null,
      outputTokens: null,
      totalTokens: 7,
    })
    expect(parseOpenAIUsage('{"choices":[]}')).toBeNull()
  })

  it("parses split streaming usage while retaining only a bounded event", () => {
    const parser = createOpenAIStreamingUsageParser({ maxEventBytes: 256 })
    const encoder = new TextEncoder()

    expect(parser.push(encoder.encode('data: {"usage":{"prompt_'))).toBeNull()
    expect(
      parser.push(
        encoder.encode(
          'tokens":0,"completion_tokens":4,"total_tokens":4}}\n\n',
        ),
      ),
    ).toEqual({ inputTokens: 0, outputTokens: 4, totalTokens: 4 })
    expect(parser.finish()).toEqual({
      inputTokens: 0,
      outputTokens: 4,
      totalTokens: 4,
    })
  })

  it("fails a streaming event that exceeds its byte bound", () => {
    const parser = createOpenAIStreamingUsageParser({ maxEventBytes: 16 })

    expect(() =>
      parser.push(new TextEncoder().encode("data: 12345678901")),
    ).toThrowError(LiteLlmTransportError)
    try {
      parser.finish()
    } catch (error) {
      expect(getLiteLlmTransportErrorReason(error)).toBe(
        "stream_event_too_large",
      )
    }
  })

  it("rejects a non-stream response above the configured read bound", async () => {
    const response = new Response("12345", {
      headers: { "content-length": "5" },
    })

    await expect(
      readLiteLlmNonStreamingResponse(response, { maxBytes: 4 }),
    ).resolves.toEqual({ ok: false, reason: "response_too_large" })
  })

  it("surfaces caller cancellation separately from a deadline", async () => {
    stubLiteLlmConfig()
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    const cancelled = new AbortController()
    cancelled.abort()

    await expect(
      createLiteLlmChatTransport()?.createChatCompletion(
        basicRequest(),
        cancelled.signal,
      ),
    ).resolves.toEqual({ ok: false, reason: "cancelled" })
    expect(fetchMock).not.toHaveBeenCalled()

    vi.stubEnv("LITELLM_CHAT_DEADLINE_MS", "5")
    fetchMock.mockImplementation(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(init.signal?.reason),
            { once: true },
          )
        }),
    )
    await expect(
      createLiteLlmChatTransport()?.createChatCompletion(
        basicRequest(),
        new AbortController().signal,
      ),
    ).resolves.toEqual({ ok: false, reason: "deadline_exceeded" })
  })

  it("surfaces cancellation while a streaming response body is open", async () => {
    stubLiteLlmConfig()
    const upstream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("data: {}\n\n"))
      },
    })
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(upstream, {
          headers: { "content-type": "text/event-stream" },
        }),
      ),
    )
    const caller = new AbortController()
    const result = await createLiteLlmChatTransport()?.createChatCompletion(
      { ...basicRequest(), stream: true },
      caller.signal,
    )
    if (!result?.ok) {
      throw new Error("Expected a successful transport response.")
    }

    const pendingBody = result.response.text()
    caller.abort()
    await expect(pendingBody).rejects.toSatisfy(
      (error: unknown) => getLiteLlmTransportErrorReason(error) === "cancelled",
    )
  })

  it("keeps the deadline active while a response body is open", async () => {
    stubLiteLlmConfig()
    vi.stubEnv("LITELLM_CHAT_DEADLINE_MS", "5")
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(new ReadableStream<Uint8Array>(), {
          headers: { "content-type": "text/event-stream" },
        }),
      ),
    )
    const result = await createLiteLlmChatTransport()?.createChatCompletion(
      { ...basicRequest(), stream: true },
      new AbortController().signal,
    )
    if (!result?.ok) {
      throw new Error("Expected a successful transport response.")
    }

    await expect(result.response.text()).rejects.toSatisfy(
      (error: unknown) =>
        getLiteLlmTransportErrorReason(error) === "deadline_exceeded",
    )
  })

  it("ends a writable backpressure wait when the transport deadline aborts", async () => {
    const writable = new EventEmitter()
    const boundary = new AbortController()
    const deadline = new LiteLlmTransportError("deadline_exceeded")
    const pending = waitForWritableDrainOrAbort(writable, boundary.signal)

    boundary.abort(deadline)

    await expect(pending).rejects.toBe(deadline)
    expect(writable.listenerCount("close")).toBe(0)
    expect(writable.listenerCount("drain")).toBe(0)
  })

  it("caps the chat deadline below the 15-minute concurrency lease", () => {
    vi.stubEnv("LITELLM_CHAT_DEADLINE_MS", String(Number.MAX_SAFE_INTEGER))

    expect(configuredLiteLlmChatDeadlineMs()).toBe(LITELLM_CHAT_DEADLINE_MAX_MS)
    expect(LITELLM_CHAT_DEADLINE_MAX_MS).toBeLessThan(15 * 60 * 1000)
  })

  it("rejects non-origin and credential-bearing LiteLLM URLs", () => {
    vi.stubEnv("LITELLM_KEY", "private-key")

    for (const url of [
      "file:///tmp/litellm",
      "https://embedded:secret@litellm.test",
      "https://litellm.test/prefix",
      "https://litellm.test?target=elsewhere",
      "https://litellm.test#fragment",
    ]) {
      vi.stubEnv("LITELLM_URL", url)
      expect(createLiteLlmChatTransport()).toBeUndefined()
    }
  })
})

function stubLiteLlmConfig(): void {
  vi.stubEnv("LITELLM_URL", "http://litellm.test")
  vi.stubEnv("LITELLM_KEY", "private-key")
}

function basicRequest(): ChatCompletionsBody {
  return {
    messages: [{ content: "hello", role: "user" }],
    model: "local-a",
  }
}
