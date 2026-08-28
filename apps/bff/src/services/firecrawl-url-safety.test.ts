import { describe, expect, it, vi } from "vitest"
import {
  type FirecrawlDnsLookup,
  isPublicFirecrawlIpAddress,
  normalizeFirecrawlEgressAllowedHosts,
  parseFirecrawlEgressAllowedHosts,
  validateFirecrawlPublicUrl,
} from "./firecrawl-url-safety"

describe("Firecrawl system egress allowlist", () => {
  it("normalizes exact DNS hosts and fails the entire value closed", () => {
    expect(
      parseFirecrawlEgressAllowedHosts(" Example.COM. ,bücher.example "),
    ).toEqual(new Set(["example.com", "xn--bcher-kva.example"]))

    for (const configured of [
      undefined,
      "",
      "*.example.com",
      ".example.com",
      "https://example.com",
      "example.com:443",
      "user@example.com",
      "example.com/path",
      "127.0.0.1",
      "8.8.8.8",
      "api.firecrawl.dev",
      "valid.example,*.invalid.example",
    ]) {
      expect(parseFirecrawlEgressAllowedHosts(configured)).toBeNull()
    }
  })

  it("makes the hosted Firecrawl API ineligible even when injected directly", async () => {
    const result = await validateFirecrawlPublicUrl(
      "https://api.firecrawl.dev/v2/scrape",
      {
        allowedHosts: new Set(["api.firecrawl.dev"]),
        lookup: publicLookup,
      },
    )

    expect(result.ok).toBe(false)
  })

  it("caps and validates iterable policy input without customer wildcards", () => {
    expect(
      normalizeFirecrawlEgressAllowedHosts([
        "PUBLIC.EXAMPLE",
        "public.example",
      ]),
    ).toEqual(new Set(["public.example"]))
    expect(normalizeFirecrawlEgressAllowedHosts(["*.example"])).toBeNull()
    expect(normalizeFirecrawlEgressAllowedHosts(["8.8.8.8"])).toBeNull()
    expect(
      normalizeFirecrawlEgressAllowedHosts(
        Array.from({ length: 257 }, () => "public.example"),
      ),
    ).toBeNull()
    expect(
      normalizeFirecrawlEgressAllowedHosts(
        Array.from({ length: 257 }, (_, index) => `host-${index}.example`),
      ),
    ).toBeNull()
  })
})

describe("Firecrawl target URL safety", () => {
  it("checks every A and AAAA answer and returns a normalized URL", async () => {
    const lookup = vi.fn<FirecrawlDnsLookup>(async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "2606:4700:4700::1111", family: 6 },
    ])

    const result = await validateFirecrawlPublicUrl(
      "https://Public.Example/path?q=1#fragment",
      {
        allowedHosts: new Set(["public.example"]),
        lookup,
      },
    )

    expect(result).toMatchObject({
      hostname: "public.example",
      normalizedUrl: "https://public.example/path?q=1",
      ok: true,
    })
    expect(lookup).toHaveBeenCalledWith("public.example", {
      all: true,
      verbatim: true,
    })
  })

  it("rejects a mixed public and private DNS answer set", async () => {
    const result = await validateFirecrawlPublicUrl("https://public.example/", {
      allowedHosts: new Set(["public.example"]),
      lookup: async () => [
        { address: "93.184.216.34", family: 4 },
        { address: "169.254.169.254", family: 4 },
      ],
    })

    expect(result).toEqual({ ok: false, reason: "non_public_address" })
  })

  it("rejects literal IP targets even when directly injected into the allowlist", async () => {
    const lookup = vi.fn<FirecrawlDnsLookup>(publicLookup)
    const result = await validateFirecrawlPublicUrl("https://8.8.8.8/", {
      allowedHosts: new Set(["8.8.8.8"]),
      lookup,
    })

    expect(result).toEqual({ ok: false, reason: "invalid_url" })
    expect(lookup).not.toHaveBeenCalled()
  })

  it("fails closed on missing DNS, lookup failures, and unexpected families", async () => {
    const options = { allowedHosts: new Set(["public.example"]) }
    expect(
      await validateFirecrawlPublicUrl("https://public.example", {
        ...options,
        lookup: async () => [],
      }),
    ).toEqual({ ok: false, reason: "dns_unavailable" })
    expect(
      await validateFirecrawlPublicUrl("https://public.example", {
        ...options,
        lookup: async () => {
          throw new Error("resolver unavailable")
        },
      }),
    ).toEqual({ ok: false, reason: "dns_unavailable" })
    expect(
      await validateFirecrawlPublicUrl("https://public.example", {
        ...options,
        lookup: (async () => [
          { address: "93.184.216.34", family: 0 },
        ]) as unknown as FirecrawlDnsLookup,
      }),
    ).toEqual({ ok: false, reason: "non_public_address" })
  })

  it.each([
    ["ftp://public.example/file", "unsupported_scheme"],
    ["https://user@public.example/file", "userinfo_not_allowed"],
    ["https://user:secret@public.example/file", "userinfo_not_allowed"],
    ["https://public.example:443/file", "port_not_allowed"],
    ["http://public.example:80/file", "port_not_allowed"],
    ["https://sub.public.example/file", "host_not_allowed"],
    [" https://public.example/file", "invalid_url"],
    ["https:\\public.example\\file", "invalid_url"],
  ])("rejects unsafe URL form %s", async (url, reason) => {
    expect(
      await validateFirecrawlPublicUrl(url, {
        allowedHosts: new Set(["public.example"]),
        lookup: publicLookup,
      }),
    ).toEqual({ ok: false, reason })
  })

  it("honors cancellation while DNS resolution is pending", async () => {
    const controller = new AbortController()
    const lookup = vi.fn<FirecrawlDnsLookup>(
      async () => new Promise(() => undefined),
    )
    const validation = validateFirecrawlPublicUrl("https://public.example", {
      allowedHosts: new Set(["public.example"]),
      lookup,
      signal: controller.signal,
    })

    controller.abort()

    await expect(validation).resolves.toEqual({
      ok: false,
      reason: "cancelled",
    })
  })
})

describe("Firecrawl public IP classification", () => {
  it.each([
    "0.0.0.0",
    "10.1.2.3",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.0.2.1",
    "192.168.1.1",
    "198.18.0.1",
    "198.51.100.1",
    "203.0.113.1",
    "224.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "fc00::1",
    "fe80::1",
    "ff00::1",
    "2001:db8::1",
    "2002:0808:0808::1",
    "3fff::1",
    "::ffff:127.0.0.1",
    "::ffff:169.254.169.254",
  ])("rejects special address %s", (address) => {
    expect(isPublicFirecrawlIpAddress(address)).toBe(false)
  })

  it.each([
    "8.8.8.8",
    "93.184.216.34",
    "2606:4700:4700::1111",
    "2a00:1450:4001:81b::200e",
    "::ffff:8.8.8.8",
  ])("accepts public address %s", (address) => {
    expect(isPublicFirecrawlIpAddress(address)).toBe(true)
  })
})

const publicLookup: FirecrawlDnsLookup = async () => [
  { address: "93.184.216.34", family: 4 },
]
