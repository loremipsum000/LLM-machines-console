import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { getAuthoritativeModelInventory } from "./model-admission-inventory"

let admissionDirectory: string | null = null

describe("authoritative model admission inventory", () => {
  afterEach(async () => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    if (admissionDirectory) {
      await rm(admissionDirectory, { force: true, recursive: true })
      admissionDirectory = null
    }
  })

  it("intersects exact active measured profiles with LiteLLM model info", async () => {
    await writeAdmissions([
      profile("local-a", "profile-a"),
      profile("local-b", "profile-b"),
    ])
    stubLiteLlm([
      { model_name: "local-a" },
      { model_name: "local-b" },
      { model_name: "unapproved-extra" },
    ])

    await expect(
      getAuthoritativeModelInventory({
        now: new Date("2026-08-24T08:00:00.000Z"),
      }),
    ).resolves.toMatchObject({
      aliases: ["local-a", "local-b"],
      observedAt: "2026-08-24T08:00:00.000Z",
      ok: true,
      validUntil: "2026-09-01T00:00:00.000Z",
    })
  })

  it("requires an explicit lab opt-in for internal-test measured profiles", async () => {
    await writeAdmissions([
      profile("local-a", "profile-a", {
        productionCapacityClaim: false,
        scope: "INTERNAL_TEST_ONLY",
      }),
    ])
    stubLiteLlm([{ model_name: "local-a" }])

    await expect(getAuthoritativeModelInventory()).resolves.toMatchObject({
      ok: false,
      reason: "inconsistent",
    })

    vi.stubEnv("INFERENCE_ALLOW_INTERNAL_TEST_PROFILES", "true")
    await expect(getAuthoritativeModelInventory()).resolves.toMatchObject({
      aliases: ["local-a"],
      ok: true,
    })
  })

  it("dynamically includes a newly admitted profile without a Key snapshot", async () => {
    await writeAdmissions([profile("local-a", "profile-a")])
    const fetchMock = stubLiteLlm([{ model_name: "local-a" }])
    await expect(getAuthoritativeModelInventory()).resolves.toMatchObject({
      aliases: ["local-a"],
      ok: true,
    })

    await writeFile(
      join(admissionDirectory as string, "profile-b.json"),
      JSON.stringify(profile("local-b", "profile-b")),
    )
    fetchMock.mockResolvedValueOnce(
      Response.json([{ model_name: "local-a" }, { model_name: "local-b" }]),
    )
    await expect(getAuthoritativeModelInventory()).resolves.toMatchObject({
      aliases: ["local-a", "local-b"],
      ok: true,
    })
  })

  it("distinguishes expired evidence from an unavailable projection", async () => {
    await writeAdmissions([profile("local-a", "profile-a")])
    const fetchMock = stubLiteLlm([{ model_name: "local-a" }])
    await expect(
      getAuthoritativeModelInventory({
        now: new Date("2026-09-01T00:00:00.000Z"),
      }),
    ).resolves.toMatchObject({ ok: false, reason: "stale" })
    expect(fetchMock).not.toHaveBeenCalled()

    fetchMock.mockRejectedValueOnce(new Error("unavailable"))
    fetchMock.mockRejectedValueOnce(new Error("unavailable"))
    await expect(
      getAuthoritativeModelInventory({
        now: new Date("2026-08-24T08:00:00.000Z"),
      }),
    ).resolves.toMatchObject({ ok: false, reason: "unavailable" })
  })

  it("fails closed for inactive, unmeasured, duplicate, or unconfigured aliases", async () => {
    for (const invalid of [
      profile("local-a", "profile-a", { state: "UNAVAILABLE_UNMEASURED" }),
      profile("local-a", "profile-a", { evidenceDigest: null }),
      profile("local-a", "profile-a", {
        coreCompatibilityFingerprint: `sha256:${"4".repeat(64)}`,
      }),
    ]) {
      await writeAdmissions([invalid])
      stubLiteLlm([{ model_name: "local-a" }])
      await expect(getAuthoritativeModelInventory()).resolves.toMatchObject({
        ok: false,
        reason: "inconsistent",
      })
      await resetDirectory()
      vi.unstubAllGlobals()
    }

    await writeAdmissions([
      profile("local-a", "profile-a"),
      profile("local-a", "profile-b"),
    ])
    stubLiteLlm([{ model_name: "local-a" }])
    await expect(getAuthoritativeModelInventory()).resolves.toMatchObject({
      ok: false,
      reason: "inconsistent",
    })

    await resetDirectory()
    await writeAdmissions([profile("local-a", "profile-a")])
    stubLiteLlm([{ model_name: "different-model" }])
    await expect(getAuthoritativeModelInventory()).resolves.toMatchObject({
      ok: false,
      reason: "inconsistent",
    })

    await resetDirectory()
    await writeAdmissions([profile("local-a", "profile-a")])
    stubLiteLlm([{ model_info: { base_model: "local-a" } }])
    await expect(getAuthoritativeModelInventory()).resolves.toMatchObject({
      ok: false,
      reason: "inconsistent",
    })
  })

  it("cannot use fixture aliases in production", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("BFF_FIXTURE_MODE", "true")
    vi.stubEnv("BFF_FALLBACK_MODELS", "synthetic-production-model")
    vi.stubEnv("INFERENCE_MODEL_ADMISSION_DIR", "")

    await expect(getAuthoritativeModelInventory()).resolves.toMatchObject({
      ok: false,
      reason: "not_configured",
    })
  })
})

async function writeAdmissions(profiles: Record<string, unknown>[]) {
  if (!admissionDirectory) {
    admissionDirectory = await mkdtemp(join(tmpdir(), "llmm-model-admission."))
    vi.stubEnv("INFERENCE_MODEL_ADMISSION_DIR", admissionDirectory)
  }
  for (const [index, value] of profiles.entries()) {
    await writeFile(
      join(admissionDirectory, `profile-${index + 1}.json`),
      JSON.stringify(value),
    )
  }
}

async function resetDirectory() {
  if (admissionDirectory) {
    await rm(admissionDirectory, { force: true, recursive: true })
    admissionDirectory = null
  }
}

function stubLiteLlm(rows: unknown[]) {
  vi.stubEnv("ADMIN_LITELLM_API_KEY", "internal-test-key")
  vi.stubEnv("ADMIN_LITELLM_BASE_URL", "http://litellm.test")
  const fetchMock = vi.fn().mockResolvedValue(Response.json(rows))
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

function profile(
  alias: string,
  profileId: string,
  overrides: {
    coreCompatibilityFingerprint?: string
    evidenceDigest?: string | null
    productionCapacityClaim?: boolean
    scope?: string
    state?: string
  } = {},
): Record<string, unknown> {
  return {
    apiVersion: "inference-core.llm-machines/v1",
    kind: "RenderedInferenceDeliveryProfile",
    source: { profileId, revision: 1 },
    coreCompatibilityFingerprint:
      overrides.coreCompatibilityFingerprint ??
      "sha256:3454120acc4928334bfbff130618f005f446c216034aec3db8de6e2127f77e40",
    engine: {},
    model: {},
    network: {},
    probes: {},
    capabilityAdvertisement: {
      freshness: {
        measuredAt: "2026-08-01T00:00:00.000Z",
        validUntil: "2026-09-01T00:00:00.000Z",
      },
      models: [
        {
          alias,
          contextTokens: 8192,
          maxConcurrentRequests: 1,
          maxOutputTokens: 2048,
          p95LatencyMilliseconds: 10,
          queue: { maxObservedDepth: null, state: "not_configured" },
          throughputTokensPerSecond: 20,
        },
      ],
      state: overrides.state ?? "ACTIVE_MEASURED",
    },
    qualification: {
      evidenceDigest:
        overrides.evidenceDigest === undefined
          ? `sha256:${"2".repeat(64)}`
          : overrides.evidenceDigest,
      qualifiedProfileDigest: `sha256:${"3".repeat(64)}`,
      productionCapacityClaim: overrides.productionCapacityClaim ?? true,
      scope: overrides.scope ?? "PRODUCTION_DELIVERY",
    },
    rollback: {},
  }
}
