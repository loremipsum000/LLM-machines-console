import { describe, expect, it, vi } from "vitest"

const { renderMock } = vi.hoisted(() => ({
  renderMock: vi.fn(() => "keys-page"),
}))

vi.mock("@/lib/admin/console-v2-routes-core", () => ({
  renderApplicationsConsoleRoute: renderMock,
}))

import ApplicationsPage from "./page"

describe("retained Application domain page", () => {
  it("renders detail and creation sections through the shared Keys experience", async () => {
    const searchParams = Promise.resolve({ appAction: "created" })
    await expect(
      ApplicationsPage({
        params: Promise.resolve({ section: ["apps", "key id"] }),
        searchParams,
      }),
    ).resolves.toBe("keys-page")
    expect(renderMock).toHaveBeenCalledWith({
      section: ["apps", "key id"],
      searchParams,
    })
  })
})
