import { getBffRequest } from "@/lib/bff/server-request"

export const dynamic = "force-dynamic"

const DEFAULT_MODEL = "qwen3-35b-local"

export async function POST(request: Request) {
  const input = await promptInput(request)
  if (!input) {
    return Response.json(
      {
        type: "about:blank",
        title: "Prompt is required",
        status: 400,
      },
      { status: 400 },
    )
  }

  const bffRequest = await getBffRequest()
  if (!bffRequest) {
    return Response.json(
      {
        type: "about:blank",
        title: "Hub prompt unavailable",
        status: 503,
        detail:
          "The Hub prompt route is not connected to the BFF, and fixture mode is not active.",
      },
      { status: 503 },
    )
  }

  try {
    const upstream = await fetch(`${bffRequest.baseUrl}/v1/chat/completions`, {
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        messages: [
          {
            role: "user",
            content: input,
          },
        ],
        stream: false,
      }),
      cache: "no-store",
      headers: {
        ...bffRequest.headers,
        "Content-Type": "application/json",
      },
      method: "POST",
    })

    if (!upstream.ok) {
      return Response.json(
        {
          type: "about:blank",
          title: "Hub prompt failed",
          status: upstream.status,
        },
        { status: upstream.status },
      )
    }

    return Response.json({
      output: extractCompletionText(await upstream.json()),
      source: "bff",
    })
  } catch {
    return Response.json(
      {
        type: "about:blank",
        title: "Hub prompt failed",
        status: 502,
      },
      { status: 502 },
    )
  }
}

async function promptInput(request: Request): Promise<string | null> {
  try {
    const body = (await request.json()) as unknown
    if (typeof body !== "object" || body === null || !("input" in body)) {
      return null
    }
    const input = body.input
    if (typeof input !== "string") {
      return null
    }
    const trimmed = input.trim()
    return trimmed.length > 0 ? trimmed : null
  } catch {
    return null
  }
}

function extractCompletionText(value: unknown): string {
  if (typeof value !== "object" || value === null || !("choices" in value)) {
    throw new Error("Invalid chat completion response.")
  }
  const choices = value.choices
  if (!Array.isArray(choices)) {
    throw new Error("Invalid chat completion choices.")
  }
  const content = choices
    .flatMap((choice) => {
      if (
        typeof choice !== "object" ||
        choice === null ||
        !("message" in choice) ||
        typeof choice.message !== "object" ||
        choice.message === null ||
        !("content" in choice.message) ||
        typeof choice.message.content !== "string"
      ) {
        return []
      }
      return choice.message.content ? [choice.message.content] : []
    })
    .join("\n\n")
    .trim()

  if (!content) {
    throw new Error("Empty chat completion response.")
  }
  return content
}
