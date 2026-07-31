import {
  type ChatCompletionsBody,
  extractTextContent,
} from "../inference/chat-completions"

export * from "../inference/chat-completions"

export interface SlashCommand {
  kind: "agent" | "workflow"
  name: string
  input: string
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
