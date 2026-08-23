import { describe, expect, it, vi } from "vitest"

const { renderMock } = vi.hoisted(() => ({
  renderMock: vi.fn(() => "keys-page"),
}))

vi.mock("@/lib/admin/console-v2-routes-core", () => ({
  renderApplicationsConsoleRoute: renderMock,
}))

import KeysPage from "./page"

describe("canonical Keys route", () => {
  it("renders the retained Application domain through the Keys route", async () => {
    const searchParams = Promise.resolve({ appAction: "created" })
    await expect(
      KeysPage({
        params: Promise.resolve({ section: ["apps", "app-1"] }),
        searchParams,
      }),
    ).resolves.toBe("keys-page")
    expect(renderMock).toHaveBeenCalledWith({
      section: ["apps", "app-1"],
      searchParams,
    })
  })
})
