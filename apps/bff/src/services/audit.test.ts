import { afterEach, describe, expect, it, vi } from "vitest"
import {
  emitAudit,
  getAuditEventsForTest,
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

  it.each([
    "actorId",
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
    ["correlationId", "10.0.0.3"],
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

async function expectRejected(input: Record<string, unknown>): Promise<void> {
  await expect(
    emitAudit(input as unknown as Parameters<typeof emitAudit>[0]),
  ).rejects.toThrow()
}
