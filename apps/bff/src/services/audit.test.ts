import { afterEach, describe, expect, it, vi } from "vitest"
import {
  emitAudit,
  getAuditEventPage,
  getAuditEventsForTest,
  parseAuditEventInput,
  resetAuditEventsForTest,
} from "./audit"

describe("strict audit persistence boundary", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    resetAuditEventsForTest()
  })

  it("retains only canonical metadata and generates correlation when absent", async () => {
    const explicit = await emitAudit({
      action: "connected_app.gateway.models",
      applicationId: "app-1",
      correlationId: "req-1",
      credentialRecordId: "cak-1",
      keycloakSubjectId: "subject-1",
      outcome: "succeeded",
      sourceSystem: "console",
    })
    const generated = await emitAudit({
      action: "admin.settings.read",
      keycloakSubjectId: "subject-1",
      outcome: "succeeded",
      sourceSystem: "console",
    })

    expect(explicit).toMatchObject({
      action: "connected_app.gateway.models",
      applicationId: "app-1",
      correlationId: "req-1",
      credentialRecordId: "cak-1",
      credentialPrefix: null,
      keycloakSubjectId: "subject-1",
      metadata: {
        applicationId: "app-1",
        correlationId: "req-1",
        credentialRecordId: "cak-1",
        keycloakSubjectId: "subject-1",
        outcome: "succeeded",
        sourceSystem: "console",
      },
      outcome: "succeeded",
      recoveryReasonCode: null,
      sourceSystem: "console",
    })
    expect(generated.correlationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
    expect(JSON.stringify(getAuditEventsForTest())).not.toMatch(
      /actor_id|target_type|target_id|rawKey|keyHash|prompt|response|sourceIp/,
    )
  })

  it("persists through a supplied transaction executor", async () => {
    vi.stubEnv("NODE_ENV", "production")
    const values = vi.fn().mockResolvedValue(undefined)
    const insert = vi.fn(() => ({ values }))
    const transaction = { insert }

    await expect(
      emitAudit(baseEvent(), transaction as never),
    ).resolves.toMatchObject({
      action: "admin.audit.tested",
      correlationId: "req-test",
    })
    expect(insert).toHaveBeenCalledOnce()
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "admin.audit.tested",
        correlationId: "req-test",
      }),
    )
    expect(getAuditEventsForTest()).toEqual([])
  })

  it.each([
    "actorId",
    "sourceEventId",
    "targetType",
    "targetId",
    "reason",
    "metadata",
    "username",
    "email",
    "sourceIp",
    "rawKey",
    "keyHash",
    "prompt",
    "response",
    "requestBody",
    "responseBody",
    "searchTerm",
    "url",
    "page",
    "toolArguments",
    "toolResults",
  ])("rejects unsupported field %s instead of sanitizing it", async (field) => {
    await expectRejected({
      ...baseEvent(),
      [field]: "private-value",
    })
    expect(getAuditEventsForTest()).toEqual([])
  })

  it.each([
    ["action", "contains spaces"],
    ["outcome", "blocked"],
    ["sourceSystem", "unknown"],
    ["correlationId", "192.0.2.3"],
    ["keycloakSubjectId", "person@example.test"],
    ["applicationId", "a".repeat(64)],
    ["credentialRecordId", "llmm_t4_prefix_secret"],
    ["credentialPrefix", "x".repeat(33)],
    ["recoveryReasonCode", "free text reason"],
    ["recoveryReasonCode", "fe80::1"],
    ["recoveryReasonCode", "a".repeat(64)],
    ["recoveryReasonCode", "llmm_t4_secret"],
  ])("rejects invalid %s values", async (field, value) => {
    await expectRejected({
      ...baseEvent(),
      [field]: value,
    })
    expect(getAuditEventsForTest()).toEqual([])
  })

  it("rejects simultaneous credential record and prefix identifiers", async () => {
    await expectRejected({
      ...baseEvent(),
      credentialPrefix: "llmm_t4_0123456789abcdef01",
      credentialRecordId: "cak-1",
    })
  })

  it("searches only the canonical permitted metadata fields in fixture mode", async () => {
    const event = await emitAudit({
      action: "admin.audit.tested",
      applicationId: "app-search",
      correlationId: "request-search",
      credentialRecordId: "credential-search",
      keycloakSubjectId: "subject-search",
      outcome: "succeeded",
      recoveryReasonCode: "policy_checked",
      sourceSystem: "console",
    })
    const canonicalQueries = [
      event.id,
      "audit.tested",
      "request-search",
      "subject-search",
      "app-search",
      "credential-search",
      "policy_checked",
    ]
    for (const query of canonicalQueries) {
      await expect(getAuditEventPage({ query })).resolves.toMatchObject({
        events: [expect.objectContaining({ id: event.id })],
      })
    }
    for (const query of ["console", "succeeded"] as const) {
      await expect(getAuditEventPage({ query })).resolves.toMatchObject({
        events: [],
      })
    }
  })

  it.each([
    ["correlationId", "correlation-not-a-uuid"],
    ["keycloakSubjectId", "admin.internal"],
    ["keycloakSubjectId", "token_secret-value"],
    ["applicationId", "app.internal"],
    ["credentialRecordId", "llmm_private-token"],
    ["credentialRecordId", ["sk", "live", "syntheticvalue"].join("-")],
    ["applicationId", ["github", "pat", "syntheticvalue0000"].join("_")],
    ["keycloakSubjectId", ["ghp", "syntheticvalue0000"].join("_")],
    ["applicationId", ["xoxb", "syntheticvalue0000"].join("-")],
    [
      "keycloakSubjectId",
      ["eyJsynthetic", "payloadvalue", "signaturevalue"].join("."),
    ],
    ["credentialRecordId", `AKIA${"0".repeat(16)}`],
    ["credentialRecordId", `AIza${"A".repeat(24)}`],
  ])("rejects unsafe native %s values", async (field, value) => {
    expect(() =>
      parseAuditEventInput({
        ...nativeEvent(),
        [field]: value,
      }),
    ).toThrow(new RegExp(field))
  })

  it.each([
    ["applicationId", "app-customer-1"],
    ["credentialRecordId", "cak-1"],
    ["keycloakSubjectId", "20000000-0000-4000-8000-000000000001"],
  ] as const)("accepts legitimate native %s values", (field, value) => {
    const parsed = parseAuditEventInput({
      ...nativeEvent(),
      [field]: value,
    })

    expect(parsed[field]).toBe(value)
  })

  it("fails closed without PostgreSQL outside fixture or test mode", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("BFF_FIXTURE_MODE", "true")
    vi.stubEnv("DATABASE_URL", "")

    await expect(emitAudit(baseEvent())).rejects.toThrow(
      /requires PostgreSQL outside fixture or test mode/,
    )
    expect(getAuditEventsForTest()).toEqual([])
  })
})

function baseEvent() {
  return {
    action: "admin.audit.tested",
    correlationId: "req-test",
    outcome: "succeeded",
    sourceSystem: "console",
  } as const
}

function nativeEvent() {
  return {
    action: "grafana.dashboard.updated",
    correlationId: "00000000-0000-4000-8000-000000000001",
    keycloakSubjectId: "admin-1",
    outcome: "succeeded",
    sourceSystem: "grafana",
  } as const
}

async function expectRejected(input: Record<string, unknown>): Promise<void> {
  await expect(
    emitAudit(input as unknown as Parameters<typeof emitAudit>[0]),
  ).rejects.toThrow()
}
