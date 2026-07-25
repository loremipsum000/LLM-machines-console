const encoder = new TextEncoder()

export function encodeContentChunk(opts: {
  id: string
  model: string
  content: string
  created?: number
}): Uint8Array {
  const payload = {
    id: opts.id,
    object: "chat.completion.chunk",
    created: opts.created ?? currentUnixSeconds(),
    model: opts.model,
    choices: [
      {
        index: 0,
        delta: { content: opts.content },
        finish_reason: null,
      },
    ],
  }

  return encodeSsePayload(payload)
}

export function encodeFinishChunk(opts: {
  id: string
  model: string
  reason: "stop" | "length" | "content_filter" | "tool_calls"
  created?: number
}): Uint8Array {
  const payload = {
    id: opts.id,
    object: "chat.completion.chunk",
    created: opts.created ?? currentUnixSeconds(),
    model: opts.model,
    choices: [
      {
        index: 0,
        delta: {},
        finish_reason: opts.reason,
      },
    ],
  }

  return encodeSsePayload(payload)
}

export function encodeErrorChunk(opts: {
  id: string
  model: string
  message: string
}): Uint8Array {
  return encodeContentChunk({
    id: opts.id,
    model: opts.model,
    content: `[error] ${opts.message}`,
  })
}

export const doneChunk = encoder.encode("data: [DONE]\n\n")

function encodeSsePayload(payload: object): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(payload)}\n\n`)
}

function currentUnixSeconds(): number {
  return Math.floor(Date.now() / 1000)
}
