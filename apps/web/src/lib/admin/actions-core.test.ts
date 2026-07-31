import { adminConnectedApps } from "@/lib/admin/mock-data"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  createAdminConnectedAppAction,
  testAdminConnectedAppConnectionAction,
} from "./actions-core"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  getBffRequest: vi.fn(),
  redirect: vi.fn((href: string) => {
    throw new Error(`redirect:${href}`)
  }),
  revalidatePath: vi.fn(),
}))

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}))

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}))

vi.mock("@/lib/auth/auth", () => ({
  auth: mocks.auth,
}))

vi.mock("@/lib/bff/server-request", () => ({
  getBffRequest: mocks.getBffRequest,
}))

describe("inference-core Admin actions", () => {
  beforeEach(() => {
    mocks.auth.mockResolvedValue({
      user: {
        email: "operator@example.test",
        groups: ["Operators"],
        id: "operator-1",
        roles: ["operator"],
      },
    })
    mocks.getBffRequest.mockResolvedValue({
      baseUrl: "http://bff.test",
      headers: new Headers({ authorization: "Bearer operator" }),
    })
    mocks.redirect.mockClear()
    mocks.revalidatePath.mockClear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("allows an operator to test a dedicated application credential", async () => {
    const app = adminConnectedApps.apps[0]
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              app,
              detail: "Connection test passed.",
              environment: "staging",
              status: "passed",
              testedAt: "2026-07-31T08:00:00.000Z",
            }),
            {
              headers: { "Content-Type": "application/json" },
              status: 200,
            },
          ),
      ) as unknown as typeof fetch,
    )
    const formData = new FormData()
    formData.set("appId", app.id)

    await expect(
      testAdminConnectedAppConnectionAction(
        {
          app: null,
          detail: null,
          error: null,
          status: "idle",
          testedAt: null,
        },
        formData,
      ),
    ).resolves.toMatchObject({
      app: { id: app.id },
      status: "passed",
    })
    expect(fetch).toHaveBeenCalledWith(
      `http://bff.test/api/admin/applications/connected-apps/${app.id}/test`,
      expect.objectContaining({ method: "POST" }),
    )
  })

  it("denies application creation to an operator before any BFF call", async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal("fetch", fetchSpy as unknown as typeof fetch)
    const formData = new FormData()
    formData.set("name", "Operator-created app")
    formData.set("description", "Must remain blocked.")
    formData.append("allowedModels", "model-1")

    await expect(
      createAdminConnectedAppAction(
        {
          app: null,
          credential: null,
          error: null,
          status: "idle",
        },
        formData,
      ),
    ).rejects.toThrow("Authorized Console session required.")
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
