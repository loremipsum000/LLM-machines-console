import type {
  AdminConnectedAppsResponse,
  AdminInferenceDashboard,
} from "@llm-machines/contracts/inference-core"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { Actor } from "../auth/authorization"
import { getAdminConnectedAppsProjection } from "./admin-connected-apps"
import { getAdminHealthSummary } from "./admin-health"
import { getAdminInference } from "./admin-inference"
import { getAdminOverview } from "./admin-overview"

vi.mock("./admin-connected-apps", () => ({
  getAdminConnectedAppsProjection: vi.fn(),
}))

vi.mock("./admin-health", () => ({
  getAdminHealthSummary: vi.fn(),
}))

vi.mock("./admin-inference", () => ({
  getAdminInference: vi.fn(),
}))

const operator: Actor = {
  authMode: "service-forwarded",
  role: "operator",
  subject: "operator-overview",
}

describe("Admin Overview aggregation", () => {
  afterEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  it("projects authentic application, inference, health, and token-usage state", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-08-02T09:30:00.000Z"))
    vi.mocked(getAdminConnectedAppsProjection).mockResolvedValue(
      connectedAppsFixture(),
    )
    vi.mocked(getAdminInference).mockResolvedValue(inferenceFixture())
    vi.mocked(getAdminHealthSummary).mockResolvedValue({
      metrics: [
        metric("gpu", "GPU utilization", "82%", "Peak observed GPU", "good"),
        metric(
          "alerts",
          "Alerts",
          "1",
          "Alertmanager active alerts",
          "warning",
        ),
        metric("uptime", "Targets up", "7/8", "1 down", "warning"),
        metric("storage", "Max disk used", "71%", "Node filesystems", "good"),
      ],
      sourceStatus: "degraded",
      summary:
        "Prometheus reports 7/8 monitored targets up. Alertmanager reports one active alert.",
    })
    const overview = await getAdminOverview(operator)

    expect(getAdminConnectedAppsProjection).toHaveBeenCalledWith()
    expect(getAdminInference).toHaveBeenCalledWith(operator, { range: "90d" })
    expect(overview.generatedAt).toBe("2026-08-02T09:30:00.000Z")
    expect(overview.tiles.map((tile) => tile.id)).toEqual([
      "applications",
      "inference",
      "hardware",
      "system",
    ])
    expect(overview.tiles[0]).toMatchObject({
      href: "/keys",
      metrics: [
        { label: "Keys", value: "2" },
        { label: "Connected", value: "1" },
        { label: "Firecrawl enabled", value: "1" },
      ],
      sourceStatus: "ok",
    })
    expect(overview.tiles[1]).toMatchObject({
      metrics: [
        { label: "Requests", value: "1,250" },
        { label: "Tokens", value: "75,000" },
        { label: "Models served", value: "2" },
        { label: "Top model", value: "qwen-local" },
      ],
      sourceStatus: "ok",
    })
    expect(overview.tiles[2]).toMatchObject({ sourceStatus: "degraded" })
    expect(overview.tiles[3]).toMatchObject({
      metrics: expect.arrayContaining([
        expect.objectContaining({
          label: "System status",
          value: "Needs attention",
        }),
        expect.objectContaining({
          label: "Update status",
          value: "Unavailable",
        }),
      ]),
      sourceStatus: "degraded",
    })
    expect(overview.tokenUsage).toEqual({
      points: [
        { date: "2026-07-31", tokens: 250 },
        { date: "2026-08-01", tokens: 12_500 },
      ],
      range: "90d",
      sourceStatus: "ok",
    })
  })

  it("returns bounded unavailable tiles instead of fabricated source values", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-08-02T10:00:00.000Z"))
    vi.mocked(getAdminConnectedAppsProjection).mockRejectedValue(
      new Error("database"),
    )
    vi.mocked(getAdminInference).mockRejectedValue(new Error("litellm"))
    vi.mocked(getAdminHealthSummary).mockRejectedValue(new Error("prometheus"))

    const overview = await getAdminOverview(operator)

    expect(overview.tokenUsage).toEqual({
      points: [],
      range: "90d",
      sourceStatus: "unavailable",
    })
    expect(
      overview.tiles.every((tile) => tile.sourceStatus === "unavailable"),
    ).toBe(true)
    expect(
      overview.tiles
        .flatMap((tile) => tile.metrics)
        .filter((item) => item.label !== "System status")
        .every((item) => item.value === "Unavailable"),
    ).toBe(true)
    expect(overview.tiles[3]?.metrics[0]).toMatchObject({
      label: "System status",
      value: "Unavailable",
    })
  })

  it("keeps aggregate usage and served-model inventory availability independent", async () => {
    mockSupportingOverviewSources()
    vi.mocked(getAdminInference).mockResolvedValue({
      ...inferenceFixture(),
      aggregateUsageSourceStatus: "unavailable",
      modelUsage: [],
      sourceStatus: "degraded",
      summary: "LiteLLM aggregate inference usage is unavailable.",
      totals: null,
      usagePoints: [],
    })

    const usageUnavailable = await getAdminOverview(operator)

    expect(usageUnavailable.tiles[1]?.metrics).toMatchObject([
      { label: "Requests", value: "Unavailable" },
      { label: "Tokens", value: "Unavailable" },
      { label: "Models served", value: "2" },
      { label: "Top model", value: "Unavailable" },
    ])
    expect(usageUnavailable.tokenUsage).toEqual({
      points: [],
      range: "90d",
      sourceStatus: "unavailable",
    })

    vi.mocked(getAdminInference).mockResolvedValue({
      ...inferenceFixture(),
      modelInventorySourceStatus: "unavailable",
      models: [],
      sourceStatus: "degraded",
    })

    const inventoryUnavailable = await getAdminOverview(operator)

    expect(inventoryUnavailable.tiles[1]?.metrics).toMatchObject([
      { label: "Requests", value: "1,250" },
      { label: "Tokens", value: "75,000" },
      { label: "Models served", value: "Unavailable" },
      { label: "Top model", value: "qwen-local" },
    ])
  })

  it("reports zero served models only for an authentic empty inventory", async () => {
    mockSupportingOverviewSources()
    vi.mocked(getAdminInference).mockResolvedValue({
      ...inferenceFixture(),
      modelInventorySourceStatus: "ok",
      models: [],
    })

    const overview = await getAdminOverview(operator)

    expect(overview.tiles[1]?.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "Models served",
          value: "0",
        }),
      ]),
    )
  })

  it("does not select an inventory entry as a top usage model", async () => {
    mockSupportingOverviewSources()
    vi.mocked(getAdminInference).mockResolvedValue({
      ...inferenceFixture(),
      modelUsage: [],
    })

    const overview = await getAdminOverview(operator)

    expect(overview.tiles[1]?.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "Top model",
          value: "None reported",
        }),
      ]),
    )
  })
})

function mockSupportingOverviewSources(): void {
  vi.mocked(getAdminConnectedAppsProjection).mockResolvedValue(
    connectedAppsFixture(),
  )
  vi.mocked(getAdminHealthSummary).mockResolvedValue({
    metrics: [],
    sourceStatus: "ok",
    summary: "Hardware sources are available.",
  })
}

function connectedAppsFixture(): AdminConnectedAppsResponse {
  return {
    apps: [
      {
        connectionStatus: "connected",
        firecrawl: { status: "enabled" },
        status: "enabled",
      },
      {
        connectionStatus: "degraded",
        firecrawl: { status: "disabled" },
        status: "enabled",
      },
    ],
    generatedAt: "2026-08-02T09:29:45.000Z",
    sourceStatus: "ok",
  } as AdminConnectedAppsResponse
}

function inferenceFixture(): AdminInferenceDashboard {
  return {
    aggregateUsageSourceStatus: "ok",
    generatedAt: "2026-08-02T09:29:50.000Z",
    liteLlmUrl: null,
    modelInventorySourceStatus: "ok",
    modelUsage: [
      {
        lastUsedAt: "2026-08-02T09:00:00.000Z",
        model: "qwen-local",
        requests: 1_000,
        spendUsd: null,
        tokens: 60_000,
      },
    ],
    models: [
      modelFixture("model-1", "qwen-local"),
      modelFixture("model-2", "completion-local"),
    ],
    range: "90d",
    sourceStatus: "ok",
    summary:
      "LiteLLM reports 1,250 requests and 75,000 tokens in the last 90d.",
    totals: { requests: 1_250, tokens: 75_000 },
    usagePoints: [
      {
        requests: 1,
        timestamp: "2026-05-04T12:00:00.000Z",
        tokens: 99_999,
      },
      {
        requests: 1,
        timestamp: "2026-07-31T08:00:00.000Z",
        tokens: 100,
      },
      {
        requests: 1,
        timestamp: "2026-07-31T18:00:00.000Z",
        tokens: 150,
      },
      {
        requests: 1,
        timestamp: "2026-08-01T12:00:00.000Z",
        tokens: 12_500,
      },
    ],
    virtualKeys: [],
    virtualKeysSourceStatus: "ok",
  }
}

function modelFixture(id: string, name: string) {
  return {
    contextWindow: null,
    id,
    mode: null,
    name,
    outputCostPerMillionTokens: null,
    provider: "local",
    sourceStatus: "ok" as const,
  }
}

function metric(
  id: string,
  label: string,
  value: string,
  detail: string,
  tone: "good" | "warning",
) {
  return { detail, id, label, tone, value }
}
