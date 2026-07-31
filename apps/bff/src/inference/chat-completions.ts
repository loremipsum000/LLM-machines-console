export interface OpenAIContentPart {
  text?: string
  type?: string
  [key: string]: unknown
}

export interface OpenAIFunctionCall {
  arguments: string
  name: string
}

export interface OpenAIToolCall {
  function: OpenAIFunctionCall
  id: string
  type: "function"
  [key: string]: unknown
}

export interface OpenAIChatMessage {
  content: string | OpenAIContentPart[] | null
  name?: string
  role: "system" | "user" | "assistant" | "tool"
  tool_call_id?: string
  tool_calls?: OpenAIToolCall[]
  [key: string]: unknown
}

export interface OpenAIFunctionTool {
  function: {
    description?: string
    name: string
    parameters?: Record<string, unknown>
    strict?: boolean
  }
  type: "function"
  [key: string]: unknown
}

export interface ChatCompletionsBody {
  messages: OpenAIChatMessage[]
  model: string
  parallel_tool_calls?: boolean
  stream?: boolean
  tool_choice?: unknown
  tools?: OpenAIFunctionTool[]
  [key: string]: unknown
}

export function isChatCompletionsBody(
  value: unknown,
): value is ChatCompletionsBody {
  if (!isRecord(value)) {
    return false
  }

  return (
    typeof value.model === "string" &&
    Array.isArray(value.messages) &&
    value.messages.every(isOpenAIChatMessage)
  )
}

export function extractTextContent(
  content: OpenAIChatMessage["content"] | undefined,
): string {
  if (typeof content === "string") {
    return content.trim()
  }

  if (Array.isArray(content)) {
    return content
      .map(textFromContentPart)
      .filter((text): text is string => typeof text === "string")
      .join("\n")
      .trim()
  }

  return ""
}

export function normalizeTextOnlyChatCompletionsBody(
  body: ChatCompletionsBody,
): ChatCompletionsBody {
  return {
    ...body,
    messages: body.messages.map((message) => ({
      ...message,
      content: normalizeTextOnlyContent(message.content),
    })),
  }
}

function isOpenAIChatMessage(value: unknown): value is OpenAIChatMessage {
  if (!isRecord(value)) {
    return false
  }

  return (
    typeof value.role === "string" &&
    ["system", "user", "assistant", "tool"].includes(value.role)
  )
}

function normalizeTextOnlyContent(
  content: OpenAIChatMessage["content"],
): OpenAIChatMessage["content"] {
  if (!Array.isArray(content)) {
    return content
  }

  return content
    .map(textOnlyContentPart)
    .filter((text): text is string => typeof text === "string")
    .join("\n")
    .trim()
}

function textFromContentPart(part: OpenAIContentPart): string | null {
  if (
    ["text", "input_text", "output_text"].includes(part.type ?? "") &&
    typeof part.text === "string"
  ) {
    return part.text
  }

  return null
}

function textOnlyContentPart(part: OpenAIContentPart): string | null {
  const text = textFromContentPart(part)
  if (text !== null) {
    return text
  }

  if (part.type === "error") {
    return typeof part.error === "string"
      ? `Previous model error: ${part.error}`
      : "[previous model error omitted]"
  }

  if (part.type === "image_url") {
    return "[image input omitted: this model path is text-only]"
  }

  if (part.type === "file") {
    return "[file input omitted: this model path is text-only]"
  }

  if (part.type === "tool_call") {
    return "[tool call content omitted]"
  }

  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
