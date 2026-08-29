import { describe, expect, it, vi } from "vitest"
import { GET } from "./route"

describe("retired Team CSV template route", () => {
  it("fails closed without contacting the BFF", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")

    const response = await GET()

    expect(response.status).toBe(404)
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
