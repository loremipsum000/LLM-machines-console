import type { SQL } from "drizzle-orm"
import { PgDialect } from "drizzle-orm/pg-core"
import { describe, expect, it, vi } from "vitest"
import {
  type ObservabilityMetricsExecutor,
  getObservabilityMetrics,
} from "./admin-observability-metrics"

describe("private observability metrics projection", () => {
  it("exports only unlabelled aggregate accounting and explicit source state", async () => {
    const execute = vi.fn<ObservabilityMetricsExecutor["execute"]>(
      async (_statement) => [
        {
          failures_5m: "3",
          in_flight_requests: "4",
          requests_5m: "20",
          retained_failures: "8",
          retained_input_tokens: "1200",
          retained_latency_ms_max: "900",
          retained_latency_ms_sum: "4500",
          retained_output_tokens: "600",
          retained_requests: "80",
          retained_total_tokens: "1800",
          server_failures_5m: "1",
        },
      ],
    )
    const executor = { execute } as unknown as ObservabilityMetricsExecutor

    const result = await getObservabilityMetrics(executor)

    expect(result.status).toBe("ok")
    if (result.status !== "ok") {
      throw new Error("Expected metrics body.")
    }
    expect(result.body).toContain("llm_machines_inference_requests_5m 20")
    expect(result.body).toContain("llm_machines_inference_failures_5m 3")
    expect(result.body).toContain("llm_machines_inference_server_failures_5m 1")
    expect(result.body).toContain("llm_machines_inference_in_flight_requests 4")
    expect(result.body).toContain(
      'llm_machines_inference_queue_depth_source_info{status="not_configured"} 1',
    )
    expect(result.body).not.toMatch(/llm_machines_inference_queue_depth\s/)
    expect(result.body).not.toMatch(/\{(?:app|application|model|user)[_=]/)
    expect(result.body.endsWith("# EOF\n")).toBe(true)

    const statement = execute.mock.calls[0]?.[0]
    if (!statement) {
      throw new Error("Expected aggregate SQL statement.")
    }
    const query = new PgDialect().sqlToQuery(statement as SQL).sql
    expect(query).toContain("FROM admin.application_usage_daily")
    expect(query).toContain("FROM admin.application_request_ledger")
    expect(query).toContain("count(*) AS requests_5m")
    expect(query).toContain("state = 'active'")
    expect(query).toContain("lease_expires_at > clock_timestamp()")
    expect(query).not.toMatch(/GROUP BY\s+(?:app|application|model|user)/i)
  })

  it("returns unavailable when PostgreSQL is absent or rejects the aggregate", async () => {
    await expect(getObservabilityMetrics(null)).resolves.toEqual({
      status: "unavailable",
    })
    await expect(
      getObservabilityMetrics({
        execute: vi.fn().mockRejectedValue(new Error("database offline")),
      }),
    ).resolves.toEqual({ status: "unavailable" })
  })

  it("fails closed for malformed or negative aggregate values", async () => {
    const incomplete = {
      execute: vi.fn().mockResolvedValue([{ retained_requests: "-1" }]),
    }
    await expect(getObservabilityMetrics(incomplete)).resolves.toEqual({
      status: "unavailable",
    })
  })
})
