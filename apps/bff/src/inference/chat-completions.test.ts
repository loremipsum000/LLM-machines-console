import { describe, expect, it } from "vitest"
import {
  type ChatCompletionsBody,
  normalizeTextOnlyChatCompletionsBody,
  normalizedChatCompletionsBodyUtf8Bytes,
} from "./chat-completions"

describe("chat completion request normalization", () => {
  it("preserves tool transport while normalizing only message content", () => {
    const body: ChatCompletionsBody = {
      messages: [
        { role: "user", content: [{ type: "text", text: "weather" }] },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call-1",
              type: "function",
              function: { name: "weather", arguments: '{"city":"Zagreb"}' },
            },
          ],
        },
        {
          role: "tool",
          tool_call_id: "call-1",
          content: '{"condition":"sunny"}',
        },
      ],
      model: "local-chat",
      tool_choice: "auto",
      tools: [
        {
          type: "function",
          function: {
            name: "weather",
            parameters: {
              type: "object",
              properties: { city: { type: "string" } },
            },
          },
        },
      ],
    }

    const normalized = normalizeTextOnlyChatCompletionsBody(body)

    expect(normalized).toEqual({
      ...body,
      messages: [
        { ...body.messages[0], content: "weather" },
        ...body.messages.slice(1),
      ],
    })
    expect(normalized.tool_choice).toBe("auto")
    expect(normalized.tools).toEqual(body.tools)
    expect(normalized.messages[1]?.tool_calls).toEqual(
      body.messages[1]?.tool_calls,
    )
    expect(normalized.messages[2]?.tool_call_id).toBe("call-1")
  })

  it("reports exact normalized UTF-8 bytes including messages and tools", () => {
    const body: ChatCompletionsBody = {
      messages: [{ role: "user", content: "Živjo" }],
      model: "local-chat",
      tool_choice: { function: { name: "lookup_č" }, type: "function" },
      tools: [
        {
          type: "function",
          function: {
            name: "lookup_č",
            parameters: { type: "object", required: ["mesto"] },
          },
        },
      ],
    }
    const before = structuredClone(body)
    const normalized = normalizeTextOnlyChatCompletionsBody(body)

    expect(normalizedChatCompletionsBodyUtf8Bytes(body)).toBe(
      Buffer.byteLength(JSON.stringify(normalized), "utf8"),
    )
    expect(body).toEqual(before)
  })
})
