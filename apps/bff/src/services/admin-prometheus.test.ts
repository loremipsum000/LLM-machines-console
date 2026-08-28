import { chmod, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { PrometheusClient } from "./admin-prometheus"

const temporaryDirectories: string[] = []

describe("Prometheus client bounds", () => {
  afterEach(async () => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((directory) => rm(directory, { force: true, recursive: true })),
    )
  })

  it.each([
    "ftp://prometheus.example",
    "https://user:secret@prometheus.example",
    "https://prometheus.example?target=internal",
    "https://prometheus.example#fragment",
  ])("rejects unsafe base URL %s", (baseUrl) => {
    expect(() => new PrometheusClient(baseUrl)).toThrow(/base URL/)
  })

  it("preserves a configured path, rejects redirects, and adds optional bearer auth", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(prometheusResponse([]))
    vi.stubGlobal("fetch", fetchMock)

    await new PrometheusClient("https://prometheus.example/internal", {
      bearerToken: "prometheus-test-token",
      timeoutMs: 500,
    }).query("up")

    const [input, init] = fetchMock.mock.calls[0] ?? []
    const url = new URL(input?.toString() ?? "")
    expect(url.pathname).toBe("/internal/api/v1/query")
    expect(url.searchParams.get("query")).toBe("up")
    expect(init?.redirect).toBe("error")
    expect(new Headers(init?.headers).get("authorization")).toBe(
      "Bearer prometheus-test-token",
    )
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })

  it("loads runtime bearer auth from a private non-symlink token file", async () => {
    const token = "p".repeat(48)
    const tokenFile = await privateTokenFile(token)
    vi.stubEnv("ADMIN_PROMETHEUS_BEARER_TOKEN_FILE", tokenFile)
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(prometheusResponse([]))
    vi.stubGlobal("fetch", fetchMock)

    await new PrometheusClient("https://prometheus.example").query("up")

    const init = fetchMock.mock.calls[0]?.[1]
    expect(new Headers(init?.headers).get("authorization")).toBe(
      `Bearer ${token}`,
    )
  })

  it.each(["symlink", "permissive"])(
    "fails closed for a %s runtime bearer-token file",
    async (kind) => {
      const directory = await temporaryDirectory()
      const target = join(directory, "target-token")
      await writeFile(target, "p".repeat(48), { mode: 0o600 })
      const configuredPath = join(directory, "configured-token")
      if (kind === "symlink") {
        await symlink(target, configuredPath)
      } else {
        await writeFile(configuredPath, "p".repeat(48), { mode: 0o644 })
        await chmod(configuredPath, 0o644)
      }
      vi.stubEnv("ADMIN_PROMETHEUS_BEARER_TOKEN_FILE", configuredPath)
      const fetchMock = vi.fn<typeof fetch>()
      vi.stubGlobal("fetch", fetchMock)

      await expect(
        new PrometheusClient("https://prometheus.example").query("up"),
      ).rejects.toThrow(/bearer token/)
      expect(fetchMock).not.toHaveBeenCalled()
    },
  )

  it("rejects an oversized response before parsing it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response("x".repeat(1025), {
          headers: { "content-length": "1025" },
        }),
      ),
    )

    await expect(
      new PrometheusClient("https://prometheus.example", {
        maxResponseBytes: 1024,
      }).query("up"),
    ).rejects.toThrow("exceeded the read limit")
  })

  it("bounds a streamed response when content length is absent", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(new Response("x".repeat(1025))),
    )

    await expect(
      new PrometheusClient("https://prometheus.example", {
        maxResponseBytes: 1024,
      }).query("up"),
    ).rejects.toThrow("exceeded the read limit")
  })

  it("drops samples with malformed label maps", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        prometheusResponse([
          { metric: { host: 123 }, value: [1_780_000_000, "1"] },
          { metric: { host: "core-appliance" }, value: [1_780_000_000, "1"] },
        ]),
      ),
    )

    await expect(
      new PrometheusClient("https://prometheus.example").query("up"),
    ).resolves.toEqual([
      {
        metric: { host: "core-appliance" },
        value: [1_780_000_000, "1"],
      },
    ])
  })
})

function prometheusResponse(result: unknown[]): Response {
  return Response.json({
    data: { result, resultType: "vector" },
    status: "success",
  })
}

async function privateTokenFile(token: string): Promise<string> {
  const directory = await temporaryDirectory()
  const path = join(directory, "token")
  await writeFile(path, `${token}\n`, { mode: 0o600 })
  await chmod(path, 0o600)
  return path
}

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "llmm-prometheus-test-"))
  temporaryDirectories.push(directory)
  return directory
}
