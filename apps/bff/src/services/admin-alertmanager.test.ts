import { chmod, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { getAdminAlertmanagerSummary } from "./admin-alertmanager"

const temporaryDirectories: string[] = []

describe("Alertmanager active-alert projection", () => {
  afterEach(async () => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((directory) => rm(directory, { force: true, recursive: true })),
    )
  })

  it("projects only safe rule metadata without degrading on active alerts", async () => {
    vi.stubEnv("ADMIN_ALERTMANAGER_BASE_URL", "https://alerts.example/private")
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json([
        {
          annotations: {
            description: "raw annotation must not leave the BFF",
            summary: "raw summary must not leave the BFF",
          },
          labels: {
            alertname: "LLMMInferenceFailureRatioHigh",
            application_id: "app_opaque_42",
            component: "inference",
            host: "192.0.2.129",
            instance: "private-hostname:9090",
            model_alias: "stable-qwen",
            rule_id: "inference-failure-ratio",
            severity: "critical",
          },
          startsAt: "2026-08-01T08:00:00.000Z",
          status: { state: "active" },
        },
      ]),
    )
    vi.stubGlobal("fetch", fetchMock)

    const result = await getAdminAlertmanagerSummary()

    expect(result.sourceStatus).toBe("ok")
    expect(result.alerts).toEqual([
      expect.objectContaining({
        alertName: "LLMMInferenceFailureRatioHigh",
        alertmanagerUrl: null,
        description: null,
        device: null,
        grafanaUrl: null,
        host: null,
        severity: "critical",
        summary: "Alert LLMMInferenceFailureRatioHigh is firing.",
      }),
    ])
    expect(result.alerts[0]?.labels).toEqual({
      alertname: "LLMMInferenceFailureRatioHigh",
      component: "inference",
      severity: "critical",
    })
    expect(JSON.stringify(result)).not.toContain("192.0.2.129")
    expect(JSON.stringify(result)).not.toContain("private-hostname")
    expect(JSON.stringify(result)).not.toContain("raw annotation")
    const [input, init] = fetchMock.mock.calls[0] ?? []
    const url = new URL(input?.toString() ?? "")
    expect(url.pathname).toBe("/private/api/v2/alerts")
    expect(url.searchParams.get("active")).toBe("true")
    expect(init?.redirect).toBe("error")
  })

  it("rejects unreviewed alert names before they can disclose native metadata", async () => {
    vi.stubEnv("ADMIN_ALERTMANAGER_BASE_URL", "https://alerts.example")
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json([
          {
            labels: {
              alertname: "InternalHost192.0.2.129",
              component: "inference",
              severity: "warning",
            },
            startsAt: "2026-08-01T08:00:00.000Z",
            status: { state: "active" },
          },
        ]),
      ),
    )

    const result = await getAdminAlertmanagerSummary()

    expect(result.sourceStatus).toBe("degraded")
    expect(result.alerts).toEqual([])
    expect(JSON.stringify(result)).not.toContain("InternalHost")
    expect(JSON.stringify(result)).not.toContain("192.0.2.129")
  })

  it("marks a successful response degraded only when malformed alerts are omitted", async () => {
    vi.stubEnv("ADMIN_ALERTMANAGER_BASE_URL", "https://alerts.example")
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          Response.json([{ labels: { severity: "warning" } }]),
        ),
    )

    await expect(getAdminAlertmanagerSummary()).resolves.toMatchObject({
      alerts: [],
      sourceStatus: "degraded",
      summary: expect.stringContaining("1 malformed alert was omitted"),
    })
  })

  it("loads optional bearer auth from a private non-symlink token file", async () => {
    const token = "a".repeat(48)
    const tokenFile = await privateTokenFile(token)
    vi.stubEnv("ADMIN_ALERTMANAGER_BASE_URL", "https://alerts.example")
    vi.stubEnv("ADMIN_ALERTMANAGER_BEARER_TOKEN_FILE", tokenFile)
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json([]))
    vi.stubGlobal("fetch", fetchMock)

    await expect(getAdminAlertmanagerSummary()).resolves.toMatchObject({
      sourceStatus: "ok",
    })

    const init = fetchMock.mock.calls[0]?.[1]
    expect(new Headers(init?.headers).get("authorization")).toBe(
      `Bearer ${token}`,
    )
  })

  it.each(["symlink", "permissive"])(
    "fails closed for a %s bearer-token file",
    async (kind) => {
      const directory = await temporaryDirectory()
      const target = join(directory, "target-token")
      await writeFile(target, "b".repeat(48), { mode: 0o600 })
      const configuredPath = join(directory, "configured-token")
      if (kind === "symlink") {
        await symlink(target, configuredPath)
      } else {
        await writeFile(configuredPath, "b".repeat(48), { mode: 0o644 })
        await chmod(configuredPath, 0o644)
      }
      vi.stubEnv("ADMIN_ALERTMANAGER_BASE_URL", "https://alerts.example")
      vi.stubEnv("ADMIN_ALERTMANAGER_BEARER_TOKEN_FILE", configuredPath)
      const fetchMock = vi.fn<typeof fetch>()
      vi.stubGlobal("fetch", fetchMock)

      await expect(getAdminAlertmanagerSummary()).resolves.toMatchObject({
        alerts: [],
        sourceStatus: "unavailable",
      })
      expect(fetchMock).not.toHaveBeenCalled()
    },
  )

  it("returns unavailable for an unsafe configured base URL", async () => {
    vi.stubEnv(
      "ADMIN_ALERTMANAGER_BASE_URL",
      "https://user:password@alerts.example",
    )
    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal("fetch", fetchMock)

    await expect(getAdminAlertmanagerSummary()).resolves.toMatchObject({
      sourceStatus: "unavailable",
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

async function privateTokenFile(token: string): Promise<string> {
  const directory = await temporaryDirectory()
  const path = join(directory, "token")
  await writeFile(path, `${token}\n`, { mode: 0o600 })
  await chmod(path, 0o600)
  return path
}

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "llmm-alertmanager-test-"))
  temporaryDirectories.push(directory)
  return directory
}
