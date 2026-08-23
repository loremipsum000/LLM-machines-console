import { beforeEach, describe, expect, it, vi } from "vitest"

const { redirectMock } = vi.hoisted(() => ({ redirectMock: vi.fn() }))

vi.mock("next/navigation", () => ({ redirect: redirectMock }))

import ApplicationsPage from "./page"

describe("legacy Applications route", () => {
  beforeEach(() => redirectMock.mockReset())

  it("redirects the root route to canonical Keys", async () => {
    await ApplicationsPage({})
    expect(redirectMock).toHaveBeenCalledWith("/keys")
  })

  it("preserves creation, detail, and safe return parameters", async () => {
    await ApplicationsPage({
      params: Promise.resolve({ section: ["apps", "key id"] }),
      searchParams: Promise.resolve({ appAction: "created", range: "7d" }),
    })
    expect(redirectMock).toHaveBeenCalledWith(
      "/keys/apps/key%20id?appAction=created&range=7d",
    )

    redirectMock.mockReset()
    await ApplicationsPage({
      params: Promise.resolve({ section: ["apps", "new"] }),
    })
    expect(redirectMock).toHaveBeenCalledWith("/keys/apps/new")
  })
})
