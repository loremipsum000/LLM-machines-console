import { chmod, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import Fastify from "fastify"
import { afterEach, describe, expect, it, vi } from "vitest"
import { registerObservabilityMetricsRoutes } from "./observability-metrics"

const temporaryDirectories: string[] = []
const scrapeToken = "metrics-private-token-".padEnd(48, "x")

describe("private observability metrics route", () => {
  afterEach(async () => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((directory) => rm(directory, { force: true, recursive: true })),
    )
  })

  it("serves query-free OpenMetrics only with the dedicated mounted token", async () => {
    const tokenFilePath = await privateTokenFile(scrapeToken)
    const server = Fastify()
    const getMetrics = vi.fn().mockResolvedValue({
      body: "# TYPE test_metric gauge\ntest_metric 1\n# EOF\n",
      status: "ok",
    })
    registerObservabilityMetricsRoutes(server, { getMetrics, tokenFilePath })

    const response = await server.inject({
      headers: { authorization: `Bearer ${scrapeToken}` },
      method: "GET",
      url: "/internal/observability/metrics",
    })

    expect(response.statusCode).toBe(200)
    expect(response.headers["cache-control"]).toBe("no-store")
    expect(response.headers["content-type"]).toContain(
      "application/openmetrics-text",
    )
    expect(response.body).toContain("test_metric 1")
    expect(getMetrics).toHaveBeenCalledTimes(1)
    await server.close()
  })

  it("rejects missing, wrong, and query-bearing scrape requests", async () => {
    const tokenFilePath = await privateTokenFile(scrapeToken)
    const server = Fastify()
    const getMetrics = vi
      .fn()
      .mockResolvedValue({ body: "# EOF\n", status: "ok" })
    registerObservabilityMetricsRoutes(server, { getMetrics, tokenFilePath })

    const missing = await server.inject({
      method: "GET",
      url: "/internal/observability/metrics",
    })
    const wrong = await server.inject({
      headers: { authorization: `Bearer ${"y".repeat(48)}` },
      method: "GET",
      url: "/internal/observability/metrics",
    })
    const query = await server.inject({
      headers: { authorization: `Bearer ${scrapeToken}` },
      method: "GET",
      url: "/internal/observability/metrics?debug=true",
    })

    expect(missing.statusCode).toBe(401)
    expect(wrong.statusCode).toBe(401)
    expect(query.statusCode).toBe(400)
    expect(getMetrics).not.toHaveBeenCalled()
    await server.close()
  })

  it.each(["missing", "symlink", "permissive"])(
    "fails closed for a %s token file",
    async (kind) => {
      const directory = await temporaryDirectory()
      const tokenFilePath = join(directory, "metrics-token")
      if (kind === "symlink") {
        const target = join(directory, "target-token")
        await writeFile(target, scrapeToken, { mode: 0o600 })
        await symlink(target, tokenFilePath)
      } else if (kind === "permissive") {
        await writeFile(tokenFilePath, scrapeToken, { mode: 0o644 })
        await chmod(tokenFilePath, 0o644)
      }
      const server = Fastify()
      const getMetrics = vi.fn().mockResolvedValue({
        body: "# EOF\n",
        status: "ok",
      })
      registerObservabilityMetricsRoutes(server, {
        getMetrics,
        tokenFilePath,
      })

      const response = await server.inject({
        headers: { authorization: `Bearer ${scrapeToken}` },
        method: "GET",
        url: "/internal/observability/metrics",
      })

      expect(response.statusCode).toBe(503)
      expect(getMetrics).not.toHaveBeenCalled()
      await server.close()
    },
  )

  it("returns 503 when the aggregate database read is unavailable", async () => {
    const tokenFilePath = await privateTokenFile(scrapeToken)
    const server = Fastify()
    registerObservabilityMetricsRoutes(server, {
      getMetrics: vi.fn().mockResolvedValue({ status: "unavailable" }),
      tokenFilePath,
    })

    const response = await server.inject({
      headers: { authorization: `Bearer ${scrapeToken}` },
      method: "GET",
      url: "/internal/observability/metrics",
    })

    expect(response.statusCode).toBe(503)
    expect(response.body).toBe("")
    await server.close()
  })
})

async function privateTokenFile(token: string): Promise<string> {
  const directory = await temporaryDirectory()
  const path = join(directory, "metrics-token")
  await writeFile(path, `${token}\n`, { mode: 0o600 })
  await chmod(path, 0o600)
  return path
}

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "llmm-metrics-test-"))
  temporaryDirectories.push(directory)
  return directory
}
