import { describe, expect, it, vi } from "vitest"
import {
  type FirecrawlGatewayRuntimeServices,
  firecrawlGatewayOptionsFromRuntime,
} from "./firecrawl-gateway-runtime"

const identity = {
  applicationId: "app-1",
  credentialRecordId: "fck-1",
  scopes: ["firecrawl.search", "firecrawl.scrape"] as const,
}

describe("Firecrawl gateway runtime adapters", () => {
  it("fails route registration dependencies closed when readiness is blocked", () => {
    const options = firecrawlGatewayOptionsFromRuntime(
      services({
        preflight: () => ({ detail: "not ready", status: "blocked" }),
      }),
    )

    expect(options.egressAllowedHosts).toBeNull()
    expect(options.upstreamBaseUrl).toBeNull()
  })

  it("settles an admission that finishes after request cancellation", async () => {
    const controller = new AbortController()
    const settle = vi.fn(async () => true)
    const options = firecrawlGatewayOptionsFromRuntime(
      services({
        admit: async () => {
          controller.abort(new Error("cancelled"))
          return { admissionId: "admission-1", ok: true }
        },
        settle,
      }),
    )
    if (!options.admission) {
      throw new Error("Admission adapter is missing.")
    }

    await expect(
      options.admission.admit({
        correlationId: "request-1",
        identity,
        operation: "search",
        signal: controller.signal,
      }),
    ).resolves.toEqual({ ok: false, reason: "unavailable" })
    expect(settle).toHaveBeenCalledWith(
      expect.objectContaining({
        admissionId: "admission-1",
        applicationId: "app-1",
        credentialRecordId: "fck-1",
        outcome: "cancelled",
        status: 499,
      }),
    )
  })

  it("retries transient post-admission cancellation settlement failures", async () => {
    vi.useFakeTimers()
    try {
      const controller = new AbortController()
      const settle = vi
        .fn<FirecrawlGatewayRuntimeServices["settle"]>()
        .mockResolvedValueOnce(false)
        .mockRejectedValueOnce(new Error("database unavailable"))
        .mockResolvedValueOnce(true)
      const options = firecrawlGatewayOptionsFromRuntime(
        services({
          admit: async () => {
            controller.abort(new Error("cancelled"))
            return { admissionId: "admission-retry", ok: true }
          },
          settle,
        }),
      )
      if (!options.admission) {
        throw new Error("Admission adapter is missing.")
      }

      const admission = options.admission.admit({
        correlationId: "request-retry",
        identity,
        operation: "scrape",
        signal: controller.signal,
      })
      await vi.runAllTimersAsync()

      await expect(admission).resolves.toEqual({
        ok: false,
        reason: "unavailable",
      })
      expect(settle).toHaveBeenCalledTimes(3)
      expect(settle).toHaveBeenLastCalledWith(
        expect.objectContaining({
          admissionId: "admission-retry",
          outcome: "cancelled",
          status: 499,
        }),
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it("does not overlap retries with a timed-out cancellation settlement", async () => {
    vi.useFakeTimers()
    try {
      const controller = new AbortController()
      const settle = vi.fn(() => new Promise<boolean>(() => undefined))
      const options = firecrawlGatewayOptionsFromRuntime(
        services({
          admit: async () => {
            controller.abort(new Error("cancelled"))
            return { admissionId: "admission-unrecoverable", ok: true }
          },
          settle,
        }),
      )
      if (!options.admission) {
        throw new Error("Admission adapter is missing.")
      }

      const startedAt = Date.now()
      const admission = options.admission.admit({
        correlationId: "request-unrecoverable",
        identity,
        operation: "scrape",
        signal: controller.signal,
      })
      await vi.runAllTimersAsync()

      await expect(admission).resolves.toEqual({
        ok: false,
        reason: "unavailable",
      })
      expect(settle).toHaveBeenCalledTimes(1)
      expect(Date.now() - startedAt).toBe(250)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it("does not retry after a timed-out cancellation settlement succeeds late", async () => {
    vi.useFakeTimers()
    try {
      const controller = new AbortController()
      const settle = vi.fn(
        () =>
          new Promise<boolean>((resolve) => {
            setTimeout(() => resolve(true), 300)
          }),
      )
      const options = firecrawlGatewayOptionsFromRuntime(
        services({
          admit: async () => {
            controller.abort(new Error("cancelled"))
            return { admissionId: "admission-late-success", ok: true }
          },
          settle,
        }),
      )
      if (!options.admission) {
        throw new Error("Admission adapter is missing.")
      }

      const admission = options.admission.admit({
        correlationId: "request-late-success",
        identity,
        operation: "search",
        signal: controller.signal,
      })
      await vi.advanceTimersByTimeAsync(250)

      await expect(admission).resolves.toEqual({
        ok: false,
        reason: "unavailable",
      })
      expect(settle).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(50)
      expect(settle).toHaveBeenCalledTimes(1)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it("turns rejected settlement and connection persistence into adapter errors", async () => {
    const options = firecrawlGatewayOptionsFromRuntime(
      services({
        recordConnection: async () => false,
        settle: async () => false,
      }),
    )
    if (!options.admission || !options.connectionEvidence) {
      throw new Error("Runtime adapters are missing.")
    }

    await expect(
      options.admission.settle({
        admissionId: "admission-1",
        applicationId: "app-1",
        correlationId: "request-1",
        credentialRecordId: "fck-1",
        latencyMs: 1,
        operation: "search",
        outcome: "failed",
        requestBytes: 0,
        responseBytes: 0,
        resultCount: 0,
        status: 503,
      }),
    ).rejects.toThrow("settlement")
    await expect(
      options.connectionEvidence.record({
        connectedAt: "2026-07-31T20:00:00.000Z",
        correlationId: "request-1",
        identity,
        operation: "search",
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow("connection evidence")
  })

  it("records gateway audit metadata without an admission id", async () => {
    const recordMetadata = vi.fn(async () => undefined)
    const options = firecrawlGatewayOptionsFromRuntime(
      services({ recordMetadata }),
    )
    if (!options.metadata) {
      throw new Error("Metadata adapter is missing.")
    }

    await options.metadata.record({
      applicationId: "app-1",
      correlationId: "request-1",
      credentialRecordId: "fck-1",
      latencyMs: 1,
      operation: "search",
      outcome: "attempted",
      requestBytes: 8,
      responseBytes: 0,
      resultCount: 0,
      status: 202,
    })

    expect(recordMetadata).toHaveBeenCalledWith(
      expect.objectContaining({ admissionId: null }),
    )
  })
})

function services(
  overrides: Partial<FirecrawlGatewayRuntimeServices> = {},
): FirecrawlGatewayRuntimeServices {
  return {
    admit: async () => ({ admissionId: "admission-1", ok: true }),
    preflight: () => ({
      egressAllowedHosts: new Set(["public.example"]),
      publicBaseUrl: "https://bff.example.test",
      status: "ready",
      upstreamBaseUrl: "http://firecrawl-api:3002",
    }),
    recordConnection: async () => true,
    recordMetadata: async () => undefined,
    resolve: async () => ({ identity, ok: true }),
    settle: async () => true,
    ...overrides,
  }
}
