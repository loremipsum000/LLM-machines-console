import { describe, expect, it } from "vitest"
import { buildServer } from "./index"

describe("Firecrawl rejection-path request logging", () => {
  it("logs only the method and pathname for an unsupported Firecrawl route", async () => {
    const lines: string[] = []
    const canary = "retention-canary-firecrawl-content"
    const server = buildServer({
      testLoggerStream: {
        write(message) {
          lines.push(message)
        },
      },
    })

    try {
      const response = await server.inject({
        method: "GET",
        url: `/v2/crawl/${canary}?query=${canary}&url=https%3A%2F%2Fpublic.example%2F${canary}`,
      })

      expect(response.statusCode).toBe(404)
    } finally {
      await server.close()
    }

    const output = lines.join("")
    expect(output).toContain('"method":"GET"')
    expect(output).toContain('"url":"/v2/[unsupported]"')
    expect(output).not.toContain(canary)
    expect(output).not.toContain("public.example")
    expect(output).not.toContain("?query=")
  })
})
