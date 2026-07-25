import { EventEmitter } from "node:events"
import { createHmac, randomUUID } from "node:crypto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { buildServer } from "./index"

const spawnMock = vi.hoisted(() => vi.fn())

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
}))

const validPayload = {
  approvalId: "00000000-0000-4000-8000-000000000001",
  approvedBy: "admin-1",
  sandboxName: "openclaw-restricted",
  profile: "openclaw-restricted",
  endpointHost: "api.github.com",
  endpointPort: 443,
  accessMode: "read_only",
  reason: "Allow GitHub read-only connector test",
}

const validRevocationPayload = {
  approvalId: validPayload.approvalId,
  revokedBy: "admin-1",
  sandboxName: "openclaw-restricted",
  profile: "openclaw-restricted",
  endpointHost: "api.github.com",
  endpointPort: 443,
  reason: "Rollback GitHub connector test",
}

describe("agentic adapter", () => {
  beforeEach(() => {
    vi.stubEnv("AGENTIC_ADAPTER_TOKEN", "adapter-token")
    vi.stubEnv("AGENTIC_APPROVAL_SIGNING_SECRET", "approval-secret")
    spawnMock.mockImplementation(() => {
      const child = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter & { setEncoding: ReturnType<typeof vi.fn> }
        stderr: EventEmitter & { setEncoding: ReturnType<typeof vi.fn> }
        kill: ReturnType<typeof vi.fn>
      }
      child.stdout = Object.assign(new EventEmitter(), { setEncoding: vi.fn() })
      child.stderr = Object.assign(new EventEmitter(), { setEncoding: vi.fn() })
      child.kill = vi.fn()
      queueMicrotask(() => child.emit("close", 0))
      return child
    })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    spawnMock.mockReset()
  })

  it("requires bearer auth for adapter routes", async () => {
    const server = buildServer()

    const response = await server.inject({
      method: "POST",
      url: "/v1/egress/approvals",
      payload: validPayload,
    })

    expect(response.statusCode).toBe(401)
    await server.close()
  })

  it("requires a signed approval envelope for egress approval routes", async () => {
    const server = buildServer()

    const response = await server.inject({
      method: "POST",
      url: "/v1/egress/approvals",
      headers: {
        authorization: "Bearer adapter-token",
      },
      payload: validPayload,
    })

    expect(response.statusCode).toBe(401)
    expect(response.json()).toMatchObject({
      title: "Invalid approval envelope",
    })
    await server.close()
  })

  it("rejects expired approval envelopes", async () => {
    const server = buildServer()

    const response = await server.inject({
      method: "POST",
      url: "/v1/egress/approvals",
      headers: validHeaders(new Date(Date.now() - 10 * 60 * 1000)),
      payload: validPayload,
    })

    expect(response.statusCode).toBe(401)
    expect(response.json()).toMatchObject({
      detail: "Approval envelope has expired.",
    })
    await server.close()
  })

  it("rejects envelope and body mismatches", async () => {
    const server = buildServer()

    const response = await server.inject({
      method: "POST",
      url: "/v1/egress/approvals",
      headers: validHeaders(),
      payload: {
        ...validPayload,
        endpointHost: "docs.github.com",
      },
    })

    expect(response.statusCode).toBe(403)
    expect(response.json()).toMatchObject({
      title: "Approval envelope mismatch",
    })
    await server.close()
  })

  it("rejects profile and sandbox mismatches", async () => {
    const payload = {
      ...validPayload,
      profile: "hermes-restricted",
    }
    const server = buildServer()

    const response = await server.inject({
      method: "POST",
      url: "/v1/egress/approvals",
      headers: validHeaders(undefined, payload),
      payload,
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({
      title: "Unsupported egress approval",
    })
    await server.close()
  })

  it("returns the actual dry-run command when apply is disabled", async () => {
    const server = buildServer()

    const response = await server.inject({
      method: "POST",
      url: "/v1/egress/approvals",
      headers: validHeaders(),
      payload: validPayload,
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      status: "dry_run",
      command: expect.arrayContaining(["--dry-run"]),
    })
    expect(response.json().command).not.toContain("--wait")
    expect(spawnMock).toHaveBeenCalledWith(
      "openshell",
      expect.arrayContaining(["-g", "openclaw-gateway", "--dry-run"]),
      expect.any(Object),
    )
    await server.close()
  })

  it("returns the actual dry-run revocation command when apply is disabled", async () => {
    const server = buildServer()

    const response = await server.inject({
      method: "POST",
      url: "/v1/egress/revocations",
      headers: validRevocationHeaders(),
      payload: validRevocationPayload,
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      status: "dry_run",
      command: expect.arrayContaining([
        "--remove-endpoint",
        "api.github.com:443",
        "--dry-run",
      ]),
    })
    expect(response.json().command).not.toContain("--wait")
    expect(spawnMock).toHaveBeenCalledWith(
      "openshell",
      expect.arrayContaining(["-g", "openclaw-gateway", "--dry-run"]),
      expect.any(Object),
    )
    await server.close()
  })

  it("revokes egress approvals with wait when apply is enabled", async () => {
    vi.stubEnv("AGENTIC_ADAPTER_APPLY", "true")
    const server = buildServer()

    const response = await server.inject({
      method: "POST",
      url: "/v1/egress/revocations",
      headers: validRevocationHeaders(),
      payload: validRevocationPayload,
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      status: "revoked",
      command: expect.arrayContaining(["--remove-endpoint", "--wait"]),
    })
    expect(response.json().command).not.toContain("--dry-run")
    await server.close()
  })

  it("targets the Hermes OpenShell gateway for Hermes profiles", async () => {
    const payload = {
      ...validPayload,
      sandboxName: "hermes-restricted",
      profile: "hermes-restricted",
    }
    const server = buildServer()

    const response = await server.inject({
      method: "POST",
      url: "/v1/egress/approvals",
      headers: validHeaders(undefined, payload),
      payload,
    })

    expect(response.statusCode).toBe(200)
    expect(spawnMock).toHaveBeenCalledWith(
      "openshell",
      expect.arrayContaining(["-g", "hermes-gateway"]),
      expect.any(Object),
    )
    await server.close()
  })

  it("keeps apply mode out of public health", async () => {
    vi.stubEnv("AGENTIC_ADAPTER_APPLY", "true")
    const server = buildServer()

    const response = await server.inject({
      method: "GET",
      url: "/healthz",
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      service: "agentic-adapter",
      status: "ok",
    })
    await server.close()
  })
})

function validHeaders(
  issuedAt = new Date(),
  payload: typeof validPayload = validPayload,
): Record<string, string> {
  return {
    authorization: "Bearer adapter-token",
    "x-llm-machines-approval-envelope": signEnvelope(payload, issuedAt),
  }
}

function signEnvelope(payload: typeof validPayload, issuedAt: Date): string {
  const envelope = {
    ...payload,
    actorSubject: payload.approvedBy,
    actorPersona: "admin",
    issuedAt: issuedAt.toISOString(),
    nonce: randomUUID(),
  }
  const encoded = Buffer.from(JSON.stringify(envelope)).toString("base64url")
  const signature = createHmac("sha256", "approval-secret")
    .update(encoded)
    .digest("base64url")
  return `${encoded}.${signature}`
}

function validRevocationHeaders(
  issuedAt = new Date(),
  payload: typeof validRevocationPayload = validRevocationPayload,
): Record<string, string> {
  return {
    authorization: "Bearer adapter-token",
    "x-llm-machines-revocation-envelope": signRevocationEnvelope(
      payload,
      issuedAt,
    ),
  }
}

function signRevocationEnvelope(
  payload: typeof validRevocationPayload,
  issuedAt: Date,
): string {
  const envelope = {
    ...payload,
    actorSubject: payload.revokedBy,
    actorPersona: "admin",
    issuedAt: issuedAt.toISOString(),
    nonce: randomUUID(),
  }
  const encoded = Buffer.from(JSON.stringify(envelope)).toString("base64url")
  const signature = createHmac("sha256", "approval-secret")
    .update(encoded)
    .digest("base64url")
  return `${encoded}.${signature}`
}
