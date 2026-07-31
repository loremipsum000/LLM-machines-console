import type { AdminConnectedApp } from "@llm-machines/contracts/inference-core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  createAdminConnectedAppAction,
  testAdminConnectedAppConnectionAction,
} from "./actions-core"

const connectedApp: AdminConnectedApp = {
  allowedModels: ["local-model"],
  auditHref: "#audit",
  createdAt: "2026-07-31T08:00:00.000Z",
  description: "Retained connected application test fixture.",
  detailHref: "/applications/apps/app-1",
  environments: [
    {
      authMethods: ["api_key"],
      clientId: "app-1-client",
      credentialIssuedAt: "2026-07-31T08:00:00.000Z",
      environment: "staging",
      keyPrefix: "llmm_t4_test",
      lastTestedAt: null,
      lastUsedAt: null,
      primaryAuthMethod: "api_key",
      productionReady: false,
      testStatus: "not_tested",
    },
  ],
  id: "app-1",
  name: "Retained App",
  ownerGroup: "Everyone",
  rateLimitRpm: null,
  status: "enabled",
  tokenBudget7d: null,
  updatedAt: "2026-07-31T08:00:00.000Z",
  usage: {
    failures7d: 0,
    lastUsedAt: null,
    requests7d: 0,
    tokens7d: 0,
  },
}

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
    const app = connectedApp
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
