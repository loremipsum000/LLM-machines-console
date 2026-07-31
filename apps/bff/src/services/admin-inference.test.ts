import { afterEach, describe, expect, it, vi } from "vitest"
import type { Actor } from "../auth/authorization"
import { getAdminInference } from "./admin-inference"
import { expertCapabilities } from "./expert-capabilities"

const actor: Actor = {
  authMode: "service-forwarded",
  role: "admin",
  subject: "admin-1",
}

describe("Admin Inference LiteLLM virtual-key projection", () => {
  afterEach(() => {
    expertCapabilities.litellm.directAccess = "disabled"
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.useRealTimers()
  })

  it("exposes only validated native links to Admins when direct access is enabled", async () => {
    expertCapabilities.litellm.directAccess = "enabled"
    vi.stubEnv("LITELLM_PUBLIC_URL", "javascript:alert(1)")

    await expect(getAdminInference(actor)).resolves.toMatchObject({
      liteLlmUrl: null,
    })

    vi.stubEnv(
      "LITELLM_PUBLIC_URL",
      "https://embedded:credential@litellm.example",
    )
    await expect(getAdminInference(actor)).resolves.toMatchObject({
      liteLlmUrl: null,
    })

    vi.stubEnv(
      "LITELLM_PUBLIC_URL",
      "https://litellm.example/ui/?token=sk-secret",
    )
    await expect(getAdminInference(actor)).resolves.toMatchObject({
      liteLlmUrl: null,
    })

    vi.stubEnv(
      "LITELLM_PUBLIC_URL",
      "https://litellm.example/ui/#access_token=hidden",
    )
    await expect(getAdminInference(actor)).resolves.toMatchObject({
      liteLlmUrl: null,
    })

    for (const publicUrl of [
      "https://litellm.example/ui/?",
      "https://litellm.example/ui/#",
    ]) {
      vi.stubEnv("LITELLM_PUBLIC_URL", publicUrl)
      await expect(getAdminInference(actor)).resolves.toMatchObject({
        liteLlmUrl: null,
      })
    }

    vi.stubEnv("LITELLM_PUBLIC_URL", "https://litellm.example")
    await expect(
      getAdminInference({ ...actor, role: "operator", subject: "operator-1" }),
    ).resolves.toMatchObject({ liteLlmUrl: null })
    await expect(getAdminInference(actor)).resolves.toMatchObject({
      liteLlmUrl: "https://litellm.example/ui/",
    })
  })

  it("projects opaque stable IDs, bounded labels, authoritative last use, and native states", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-05-30T12:00:00.000Z"))
    configureAdminLiteLlm()
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = new URL(input.toString())
      if (url.pathname !== "/key/list") {
        return Promise.resolve(baseLiteLlmResponse(url.pathname))
      }
      return Promise.resolve(
        jsonResponse({
          current_page: 1,
          keys: [
            {
              blocked: false,
              expires: "2026-06-30T00:00:00.000Z",
              key_alias: `  Design\u0000 station ${"x".repeat(180)}  `,
              last_active: "2026-05-29T10:00:00.000Z",
              max_budget: 0,
              models: [" qwen\nlocal ", "qwen\nlocal"],
              spend: 0,
              team_alias: " Team\nOne ",
              token: "upstream-key-hash-active",
              updated_at: "2026-05-30T11:00:00.000Z",
              user_email: " owner\u0007@example.test ",
              user_id: "upstream-user-id",
            },
            {
              blocked: true,
              expires: "2026-06-30T00:00:00.000Z",
              key_alias: "token=must-not-display",
              last_active: null,
              models: [],
              team_id: "upstream-team-id",
              token: "upstream-key-hash-blocked",
              user_id: "another-upstream-user-id",
            },
            {
              blocked: true,
              expires: "2026-05-01T00:00:00.000Z",
              key_alias: "expired-key",
              last_active: null,
              models: [],
              token: "upstream-key-hash-expired",
            },
          ],
          total_count: 3,
          total_pages: 1,
        }),
      )
    })

    const first = await getAdminInference(actor)
    const second = await getAdminInference(actor)

    expect(first.sourceStatus).toBe("ok")
    expect(first.virtualKeys).toHaveLength(3)
    expect(first.virtualKeys[0]).toMatchObject({
      alias: expect.stringMatching(/^Design station /),
      budgetUsd: 0,
      id: expect.stringMatching(/^litellm-vk-[0-9a-f]{64}$/),
      lastUsedAt: "2026-05-29T10:00:00.000Z",
      models: ["qwen local"],
      owner: "owner @example.test",
      spendUsd: 0,
      status: "active",
      team: "Team One",
    })
    expect(first.virtualKeys[0]?.alias).toHaveLength(160)
    expect(first.virtualKeys[1]).toMatchObject({
      alias: "Unnamed virtual key",
      lastUsedAt: null,
      owner: null,
      status: "blocked",
      team: null,
    })
    expect(first.virtualKeys[2]).toMatchObject({ status: "expired" })
    expect(second.virtualKeys.map((key) => key.id)).toEqual(
      first.virtualKeys.map((key) => key.id),
    )

    const serialized = JSON.stringify(first.virtualKeys)
    expect(serialized).not.toContain("upstream-key-hash")
    expect(serialized).not.toContain("upstream-user-id")
    expect(serialized).not.toContain("upstream-team-id")
    expect(serialized).not.toContain("updated_at")
    expect(serialized).not.toContain("2026-05-30T11:00:00.000Z")
    expect(serialized).not.toContain("token=must-not-display")
  })

  it("degrades the key projection instead of returning incomplete pagination", async () => {
    configureAdminLiteLlm()
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = new URL(input.toString())
      if (url.pathname !== "/key/list") {
        return Promise.resolve(baseLiteLlmResponse(url.pathname))
      }
      return Promise.resolve(
        jsonResponse({
          current_page: 1,
          keys: [validVirtualKey("only-returned-key")],
          total_count: 2,
          total_pages: 1,
        }),
      )
    })

    const dashboard = await getAdminInference(actor)

    expect(dashboard.sourceStatus).toBe("degraded")
    expect(dashboard.virtualKeys).toEqual([])
  })

  it("bounds aggregate bytes across virtual-key pages", async () => {
    configureAdminLiteLlm()
    let requestedKeyPages = 0
    const padding = "x".repeat(1_750_000)
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = new URL(input.toString())
      if (url.pathname !== "/key/list") {
        return Promise.resolve(baseLiteLlmResponse(url.pathname))
      }
      requestedKeyPages += 1
      return Promise.resolve(
        jsonResponse({
          current_page: requestedKeyPages,
          keys: [],
          padding,
          total_count: 401,
          total_pages: 5,
        }),
      )
    })

    const dashboard = await getAdminInference(actor)

    expect(requestedKeyPages).toBe(5)
    expect(dashboard.sourceStatus).toBe("degraded")
    expect(dashboard.virtualKeys).toEqual([])
  })

  it("stops stalled virtual-key pagination at the aggregate deadline", async () => {
    configureAdminLiteLlm()
    const deadline = new AbortController()
    const requestTimeout = new AbortController()
    const timeoutSpy = vi
      .spyOn(AbortSignal, "timeout")
      .mockImplementation((milliseconds) =>
        milliseconds === 10_000 ? deadline.signal : requestTimeout.signal,
      )
    let keyRequestStarted = false
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((input, init) => {
        const url = new URL(input.toString())
        if (url.pathname !== "/key/list") {
          return Promise.resolve(baseLiteLlmResponse(url.pathname))
        }
        keyRequestStarted = true
        const keyRequestSignal = init?.signal
        return new Promise<Response>((_resolve, reject) => {
          if (!keyRequestSignal) {
            reject(new Error("Missing virtual-key request abort signal."))
            return
          }
          keyRequestSignal.addEventListener(
            "abort",
            () => reject(keyRequestSignal.reason),
            { once: true },
          )
        })
      })

    const pendingDashboard = getAdminInference(actor)
    await vi.waitFor(() => expect(keyRequestStarted).toBe(true))
    deadline.abort(
      new DOMException("Aggregate deadline elapsed.", "TimeoutError"),
    )
    const dashboard = await pendingDashboard

    const keyRequestSignal = fetchSpy.mock.calls.find(
      ([input]) => new URL(input.toString()).pathname === "/key/list",
    )?.[1]?.signal
    expect(timeoutSpy).toHaveBeenCalledWith(10_000)
    expect(keyRequestSignal?.aborted).toBe(true)
    expect(dashboard.sourceStatus).toBe("degraded")
    expect(dashboard.virtualKeys).toEqual([])
  })

  it("degrades the key projection when a full-object row lacks native identity metadata", async () => {
    configureAdminLiteLlm()
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = new URL(input.toString())
      if (url.pathname !== "/key/list") {
        return Promise.resolve(baseLiteLlmResponse(url.pathname))
      }
      return Promise.resolve(
        jsonResponse({
          current_page: 1,
          keys: [
            {
              blocked: false,
              key_alias: "missing-token",
              models: [],
            },
          ],
          total_count: 1,
          total_pages: 1,
        }),
      )
    })

    const dashboard = await getAdminInference(actor)

    expect(dashboard.sourceStatus).toBe("degraded")
    expect(dashboard.virtualKeys).toEqual([])
  })

  it("accepts nullable blocked state and removes credential material from every display field", async () => {
    configureAdminLiteLlm()
    const rawHash = "a".repeat(64)
    const unsafeAliases = [
      rawHash,
      `${"a".repeat(32)}\u200B${"a".repeat(32)}`,
      `${"a".repeat(32)}\u034F${"a".repeat(32)}`,
      "password=hunter2",
      "pass\u200Bword=hunter2",
      "pass\u034Fword=hunter2",
      "secret: hidden-value",
      "Authorization: Bearer hidden-value",
      "prefix sk-embedded-secret-value suffix",
      "prefix sk-\u200Bembedded-secret-value suffix",
      "apiKey=hidden-value",
      "client_secret: hidden-value",
    ]
    const keys: Record<string, unknown>[] = unsafeAliases.map(
      (keyAlias, index) => ({
        blocked: null,
        key_alias: keyAlias,
        models: [],
        token: `upstream-identity-${index}`,
      }),
    )
    keys.push({
      blocked: null,
      key_alias: "Architecture tools",
      models: [],
      team_alias: "secret=hidden-team-value",
      token: "upstream-identity-safe-display",
      user_email: rawHash,
    })
    keys.push({
      blocked: null,
      key_alias: "Operations key",
      models: [],
      team_alias: "Operations Team",
      token: "upstream-identity-legitimate-display",
      user_email: "owner@example.test",
    })
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = new URL(input.toString())
      if (url.pathname !== "/key/list") {
        return Promise.resolve(baseLiteLlmResponse(url.pathname))
      }
      return Promise.resolve(
        jsonResponse({
          current_page: 1,
          keys,
          total_count: keys.length,
          total_pages: 1,
        }),
      )
    })

    const dashboard = await getAdminInference(actor)

    expect(dashboard.sourceStatus).toBe("ok")
    expect(dashboard.virtualKeys.slice(0, unsafeAliases.length)).toEqual(
      expect.arrayContaining(
        unsafeAliases.map(() =>
          expect.objectContaining({
            alias: "Unnamed virtual key",
            status: "active",
          }),
        ),
      ),
    )
    expect(dashboard.virtualKeys.at(-2)).toMatchObject({
      alias: "Architecture tools",
      owner: null,
      status: "active",
      team: null,
    })
    expect(dashboard.virtualKeys.at(-1)).toMatchObject({
      alias: "Operations key",
      owner: "owner@example.test",
      status: "active",
      team: "Operations Team",
    })
    const serialized = JSON.stringify(dashboard.virtualKeys)
    for (const value of unsafeAliases) {
      expect(serialized).not.toContain(value)
    }
    expect(serialized).not.toContain("hidden-team-value")
  })

  it("degrades when blocked state has a non-null non-boolean shape", async () => {
    configureAdminLiteLlm()
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = new URL(input.toString())
      if (url.pathname !== "/key/list") {
        return Promise.resolve(baseLiteLlmResponse(url.pathname))
      }
      return Promise.resolve(
        jsonResponse({
          current_page: 1,
          keys: [
            {
              blocked: "false",
              key_alias: "malformed-state",
              models: [],
              token: "upstream-identity-malformed-state",
            },
          ],
          total_count: 1,
          total_pages: 1,
        }),
      )
    })

    const dashboard = await getAdminInference(actor)

    expect(dashboard.sourceStatus).toBe("degraded")
    expect(dashboard.virtualKeys).toEqual([])
  })
})

function configureAdminLiteLlm(): void {
  vi.stubEnv("ADMIN_LITELLM_BASE_URL", "http://litellm.test")
  vi.stubEnv("ADMIN_LITELLM_API_KEY", "admin-read-key")
}

function baseLiteLlmResponse(pathname: string): Response {
  if (pathname === "/user/daily/activity/aggregated") {
    return jsonResponse({ metadata: {}, results: [] })
  }
  if (pathname === "/spend/logs/v2") {
    return jsonResponse({ data: [] })
  }
  if (pathname === "/model/info") {
    return jsonResponse({ data: [] })
  }
  return jsonResponse({ error: "unexpected" }, 500)
}

function validVirtualKey(token: string): Record<string, unknown> {
  return {
    blocked: false,
    key_alias: "valid-key",
    models: [],
    token,
  }
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    headers: { "content-type": "application/json" },
    status,
  })
}
