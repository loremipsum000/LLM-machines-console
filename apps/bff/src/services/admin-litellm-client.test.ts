import { afterEach, describe, expect, it, vi } from "vitest"
import { LiteLlmAdminClient, liteLlmConfig } from "./admin-litellm-client"

describe("LiteLLM Admin client", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it("requires the separate Admin API credential without data-plane fallback", () => {
    vi.stubEnv("LITELLM_URL", "http://data-plane.test")
    vi.stubEnv("LITELLM_KEY", "data-plane-key")

    expect(liteLlmConfig()).toBeNull()

    vi.stubEnv("ADMIN_LITELLM_BASE_URL", "http://admin-plane.test/")
    vi.stubEnv("ADMIN_LITELLM_API_KEY", "admin-read-key")
    expect(liteLlmConfig()).toEqual({
      apiKey: "admin-read-key",
      baseUrl: "http://admin-plane.test",
    })
  })

  it("rejects invalid or credential-bearing Admin API origins", () => {
    vi.stubEnv("ADMIN_LITELLM_API_KEY", "admin-read-key")
    for (const baseUrl of [
      "file:///tmp/litellm",
      "https://embedded:credential@litellm.test",
      "https://litellm.test/admin",
      "https://litellm.test?token=hidden",
      "https://litellm.test?",
      "https://litellm.test#hidden",
      "https://litellm.test#",
    ]) {
      vi.stubEnv("ADMIN_LITELLM_BASE_URL", baseUrl)
      expect(liteLlmConfig()).toBeNull()
    }
  })

  it("performs GET-only reads and rejects redirects", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        headers: { "content-type": "application/json" },
      }),
    )
    const client = new LiteLlmAdminClient({
      apiKey: "admin-read-key",
      baseUrl: "https://litellm.test",
    })

    await expect(client.getJson("/key/list")).resolves.toEqual({ ok: true })
    expect(fetchSpy).toHaveBeenCalledOnce()
    expect(fetchSpy.mock.calls[0]?.[1]).toMatchObject({
      headers: {
        Accept: "application/json",
        Authorization: "Bearer admin-read-key",
      },
      method: "GET",
      redirect: "error",
    })
  })

  it("combines a caller deadline and reports response bytes", async () => {
    const caller = new AbortController()
    const onBytesRead = vi.fn()
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        headers: { "content-type": "application/json" },
      }),
    )
    const client = new LiteLlmAdminClient({
      apiKey: "admin-read-key",
      baseUrl: "https://litellm.test",
    })

    await expect(
      client.getJson("/key/list", new URLSearchParams(), {
        onBytesRead,
        signal: caller.signal,
      }),
    ).resolves.toEqual({ ok: true })
    const requestSignal = fetchSpy.mock.calls[0]?.[1]?.signal
    expect(requestSignal).toBeInstanceOf(AbortSignal)
    expect(requestSignal).not.toBe(caller.signal)
    expect(onBytesRead).toHaveBeenCalledWith(11)
  })

  it("propagates a caller abort to an in-flight read", async () => {
    const caller = new AbortController()
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((_input, init) => {
        const requestSignal = init?.signal
        return new Promise<Response>((_resolve, reject) => {
          if (!requestSignal) {
            reject(new Error("Missing request abort signal."))
            return
          }
          requestSignal.addEventListener(
            "abort",
            () => reject(requestSignal.reason),
            { once: true },
          )
        })
      })
    const client = new LiteLlmAdminClient({
      apiKey: "admin-read-key",
      baseUrl: "https://litellm.test",
    })

    const pendingRead = client.getJson("/key/list", new URLSearchParams(), {
      signal: caller.signal,
    })
    caller.abort()

    await expect(pendingRead).rejects.toMatchObject({ name: "AbortError" })
    const requestSignal = fetchSpy.mock.calls[0]?.[1]?.signal
    expect(requestSignal?.aborted).toBe(true)
  })

  it("rejects declared and streamed responses above the read bound", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response("{}", {
          headers: { "content-length": String(2 * 1024 * 1024 + 1) },
        }),
      )
      .mockResolvedValueOnce(new Response(new Uint8Array(2 * 1024 * 1024 + 1)))
    const client = new LiteLlmAdminClient({
      apiKey: "admin-read-key",
      baseUrl: "https://litellm.test",
    })

    await expect(client.getJson("/model/info")).rejects.toThrow(
      "response exceeded the read limit",
    )
    await expect(client.getJson("/model/info")).rejects.toThrow(
      "response exceeded the read limit",
    )
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })
})
