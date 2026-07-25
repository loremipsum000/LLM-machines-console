import { afterEach, describe, expect, it, vi } from "vitest"

const lookupMock = vi.hoisted(() => vi.fn())

vi.mock("node:dns/promises", () => ({
  lookup: lookupMock,
}))

import {
  fetchPublicHttpEndpoint,
  validatePublicHttpEndpoint,
} from "./url-safety"

describe("URL egress safety", () => {
  afterEach(() => {
    lookupMock.mockReset()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it("blocks bracketed IPv6 loopback, private, and link-local literals", () => {
    const blockedUrls = [
      "http://[::1]/rpc",
      "http://[fd00::1]/rpc",
      "http://[fc00::1]/rpc",
      "http://[fe80::1]/rpc",
      "http://[::ffff:127.0.0.1]/rpc",
    ]

    for (const endpointUrl of blockedUrls) {
      expect(validatePublicHttpEndpoint(endpointUrl)).toMatchObject({
        ok: false,
      })
    }
  })

  it("blocks local and internal host suffixes", () => {
    for (const endpointUrl of [
      "https://service.local/rpc",
      "https://docs.internal/rpc",
      "https://metadata.google.internal/rpc",
    ]) {
      expect(validatePublicHttpEndpoint(endpointUrl)).toMatchObject({
        ok: false,
      })
    }
  })

  it("rejects public hostnames that resolve to private addresses before fetch", async () => {
    vi.stubEnv("BFF_EGRESS_DNS_RESOLUTION_CHECK", "true")
    lookupMock.mockResolvedValue([{ address: "10.0.0.7", family: 4 }])
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    await expect(
      fetchPublicHttpEndpoint("https://mcp.example.test/rpc"),
    ).rejects.toThrow("Private, loopback, link-local")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("returns redirect chains after validating each redirect target", async () => {
    vi.stubEnv("BFF_EGRESS_DNS_RESOLUTION_CHECK", "true")
    lookupMock.mockResolvedValue([{ address: "203.0.113.10", family: 4 }])
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(null, {
            headers: { location: "https://docs.example.test/final" },
            status: 302,
          }),
        )
        .mockResolvedValueOnce(new Response("Final body", { status: 200 })),
    )

    const result = await fetchPublicHttpEndpoint(
      "https://docs.example.test/start",
    )

    expect(result.url.toString()).toBe("https://docs.example.test/final")
    expect(result.redirectChain).toEqual(["https://docs.example.test/final"])
  })
})
