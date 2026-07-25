export interface OpenAIChatMessage {
  role: "system" | "user" | "assistant" | "tool"
  content:
    | string
    | Array<{
        type?: string
        text?: string
        [key: string]: unknown
      }>
    | null
  [key: string]: unknown
}

export interface ChatCompletionsBody {
  model: string
  messages: OpenAIChatMessage[]
  stream?: boolean
  [key: string]: unknown
}

export interface SlashCommand {
  kind: "agent" | "workflow"
  name: string
  input: string
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

export function parseSlashCommand(
  body: ChatCompletionsBody,
): SlashCommand | null {
  const lastUserMessage = [...body.messages]
    .reverse()
    .find((message) => message.role === "user")
  const content = extractTextContent(lastUserMessage?.content)
  if (!content) {
    return null
  }

  const match = content.match(/^(?:@([\w-]+)|\/([\w-]+))(?:\s+([\s\S]*))?$/)
  if (!match) {
    return null
  }

  return {
    kind: match[1] ? "agent" : "workflow",
    name: match[1] ?? match[2],
    input: match[3]?.trim() ?? "",
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

function textFromContentPart(part: {
  type?: string
  text?: string
  [key: string]: unknown
}): string | null {
  if (
    ["text", "input_text", "output_text"].includes(part.type ?? "") &&
    typeof part.text === "string"
  ) {
    return part.text
  }

  return null
}

function textOnlyContentPart(part: {
  type?: string
  text?: string
  [key: string]: unknown
}): string | null {
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
