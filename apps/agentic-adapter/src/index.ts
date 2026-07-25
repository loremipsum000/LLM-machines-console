import { spawn } from "node:child_process"
import { createHmac, timingSafeEqual } from "node:crypto"
import { realpathSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify"
import {
  agenticApprovalEnvelopeSchema,
  agenticAdapterApplyEgressRequestSchema,
  agenticAdapterEgressResponseSchema,
  agenticAdapterRevokeEgressRequestSchema,
  agenticAdapterRevokeEgressResponseSchema,
  agenticRevocationEnvelopeSchema,
  type AgenticAdapterApplyEgressRequest,
  type AgenticAdapterRevokeEgressRequest,
  type AgenticApprovalEnvelope,
  type AgenticRevocationEnvelope,
  type EgressAccessMode,
} from "@llm-machines/contracts"

const profileSandbox: Record<string, string> = {
  "openclaw-restricted": "openclaw-restricted",
  "openclaw-tools": "openclaw-restricted",
  "hermes-restricted": "hermes-restricted",
  "hermes-tools": "hermes-restricted",
}

const profileGateway: Record<string, "openclaw" | "hermes"> = {
  "openclaw-restricted": "openclaw",
  "openclaw-tools": "openclaw",
  "hermes-restricted": "hermes",
  "hermes-tools": "hermes",
}

export function buildServer(): FastifyInstance {
  const server = Fastify({
    logger: true,
  })

  server.addHook("preHandler", authenticateAdapterRequest)

  const liveness = async () => ({
    service: "agentic-adapter",
    status: "ok",
  })

  server.get("/livez", liveness)
  server.get("/healthz", liveness)

  server.get("/v1/diagnostics", async () => ({
    service: "agentic-adapter",
    status: "ok",
    applyEnabled: isApplyEnabled(),
  }))

  server.post("/v1/egress/approvals", async (request, reply) => {
    const parsed = agenticAdapterApplyEgressRequestSchema.safeParse(
      request.body,
    )
    if (!parsed.success) {
      return reply.code(400).send({
        type: "about:blank",
        title: "Invalid egress approval",
        status: 400,
        detail: parsed.error.issues.map((issue) => issue.message).join("; "),
      })
    }

    const envelope = parseApprovalEnvelope(request)
    if (!envelope.ok) {
      return reply.code(401).send({
        type: "about:blank",
        title: "Invalid approval envelope",
        status: 401,
        detail: envelope.detail,
      })
    }

    const envelopeError = validateEnvelopeMatchesRequest(
      envelope.value,
      parsed.data,
    )
    if (envelopeError) {
      return reply.code(403).send({
        type: "about:blank",
        title: "Approval envelope mismatch",
        status: 403,
        detail: envelopeError,
      })
    }

    const validationError = validateApproval(parsed.data)
    if (validationError) {
      return reply.code(400).send({
        type: "about:blank",
        title: "Unsupported egress approval",
        status: 400,
        detail: validationError,
      })
    }

    const endpoint = formatEndpoint(parsed.data)
    const sandboxName = parsed.data.sandboxName
    const gateway = gatewayForProfile(parsed.data.profile)
    const policyUpdateCommand = [
      "openshell",
      "-g",
      gateway,
      "policy",
      "update",
      sandboxName,
      "--add-endpoint",
      endpoint,
    ]
    const command = [...policyUpdateCommand, "--wait"]
    const rollbackCommand = [
      "openshell",
      "-g",
      gateway,
      "policy",
      "update",
      sandboxName,
      "--remove-endpoint",
      `${parsed.data.endpointHost}:${parsed.data.endpointPort}`,
      "--wait",
    ]

    const applyEnabled = isApplyEnabled()
    const executedCommand = applyEnabled
      ? command
      : [...policyUpdateCommand, "--dry-run"]
    const result = await runCommand(executedCommand)
    if (result.exitCode !== 0) {
      return reply.code(502).send({
        type: "about:blank",
        title: "OpenShell policy update failed",
        status: 502,
        detail: result.stderr || result.stdout || "Command failed.",
      })
    }

    return agenticAdapterEgressResponseSchema.parse({
      approvalId: parsed.data.approvalId,
      sandboxName,
      endpoint,
      status: applyEnabled ? "applied" : "dry_run",
      command: executedCommand,
      rollbackCommand,
      stdout: result.stdout,
      stderr: result.stderr,
    })
  })

  server.post("/v1/egress/revocations", async (request, reply) => {
    const parsed = agenticAdapterRevokeEgressRequestSchema.safeParse(
      request.body,
    )
    if (!parsed.success) {
      return reply.code(400).send({
        type: "about:blank",
        title: "Invalid egress revocation",
        status: 400,
        detail: parsed.error.issues.map((issue) => issue.message).join("; "),
      })
    }

    const envelope = parseRevocationEnvelope(request)
    if (!envelope.ok) {
      return reply.code(401).send({
        type: "about:blank",
        title: "Invalid revocation envelope",
        status: 401,
        detail: envelope.detail,
      })
    }

    const envelopeError = validateRevocationEnvelopeMatchesRequest(
      envelope.value,
      parsed.data,
    )
    if (envelopeError) {
      return reply.code(403).send({
        type: "about:blank",
        title: "Revocation envelope mismatch",
        status: 403,
        detail: envelopeError,
      })
    }

    const validationError = validateRevocation(parsed.data)
    if (validationError) {
      return reply.code(400).send({
        type: "about:blank",
        title: "Unsupported egress revocation",
        status: 400,
        detail: validationError,
      })
    }

    const sandboxName = parsed.data.sandboxName
    const gateway = gatewayForProfile(parsed.data.profile)
    const policyUpdateCommand = [
      "openshell",
      "-g",
      gateway,
      "policy",
      "update",
      sandboxName,
      "--remove-endpoint",
      `${parsed.data.endpointHost}:${parsed.data.endpointPort}`,
    ]

    const applyEnabled = isApplyEnabled()
    const executedCommand = applyEnabled
      ? [...policyUpdateCommand, "--wait"]
      : [...policyUpdateCommand, "--dry-run"]
    const result = await runCommand(executedCommand)
    if (result.exitCode !== 0) {
      return reply.code(502).send({
        type: "about:blank",
        title: "OpenShell policy revocation failed",
        status: 502,
        detail: result.stderr || result.stdout || "Command failed.",
      })
    }

    return agenticAdapterRevokeEgressResponseSchema.parse({
      approvalId: parsed.data.approvalId,
      sandboxName,
      endpoint: `${parsed.data.endpointHost}:${parsed.data.endpointPort}`,
      status: applyEnabled ? "revoked" : "dry_run",
      command: executedCommand,
      stdout: result.stdout,
      stderr: result.stderr,
    })
  })

  return server
}

async function authenticateAdapterRequest(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (request.url === "/healthz" || request.url === "/livez") {
    return
  }

  const expectedToken = process.env.AGENTIC_ADAPTER_TOKEN
  const suppliedToken =
    request.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1]

  if (
    !expectedToken ||
    !suppliedToken ||
    !constantTimeEqual(suppliedToken, expectedToken)
  ) {
    return reply.code(401).send({
      type: "about:blank",
      title: "Unauthenticated",
      status: 401,
      detail: "A valid adapter bearer token is required.",
    })
  }
}

function parseApprovalEnvelope(
  request: FastifyRequest,
):
  | { ok: true; value: AgenticApprovalEnvelope }
  | { ok: false; detail: string } {
  const header = request.headers["x-llm-machines-approval-envelope"]
  const value = Array.isArray(header) ? header[0] : header
  if (!value) {
    return { ok: false, detail: "Signed approval envelope is required." }
  }

  const secret = process.env.AGENTIC_APPROVAL_SIGNING_SECRET
  if (!secret) {
    return {
      ok: false,
      detail: "Adapter approval signing secret is not configured.",
    }
  }

  const [payload, signature] = value.split(".")
  if (!payload || !signature) {
    return { ok: false, detail: "Approval envelope format is invalid." }
  }

  const expected = createHmac("sha256", secret)
    .update(payload)
    .digest("base64url")
  if (!constantTimeEqual(signature, expected)) {
    return { ok: false, detail: "Approval envelope signature is invalid." }
  }

  let decoded: unknown
  try {
    decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"))
  } catch {
    return { ok: false, detail: "Approval envelope payload is not JSON." }
  }

  const parsed = agenticApprovalEnvelopeSchema.safeParse(decoded)
  if (!parsed.success) {
    return { ok: false, detail: "Approval envelope payload is invalid." }
  }

  const issuedAt = Date.parse(parsed.data.issuedAt)
  const now = Date.now()
  const ttlMs = Number.parseInt(
    process.env.AGENTIC_APPROVAL_ENVELOPE_TTL_MS ?? "300000",
    10,
  )
  if (!Number.isFinite(issuedAt) || issuedAt > now + 60_000) {
    return { ok: false, detail: "Approval envelope issued-at is invalid." }
  }
  if (now - issuedAt > ttlMs) {
    return { ok: false, detail: "Approval envelope has expired." }
  }

  return { ok: true, value: parsed.data }
}

function parseRevocationEnvelope(
  request: FastifyRequest,
):
  | { ok: true; value: AgenticRevocationEnvelope }
  | { ok: false; detail: string } {
  const header = request.headers["x-llm-machines-revocation-envelope"]
  const value = Array.isArray(header) ? header[0] : header
  if (!value) {
    return { ok: false, detail: "Signed revocation envelope is required." }
  }

  const secret = process.env.AGENTIC_APPROVAL_SIGNING_SECRET
  if (!secret) {
    return { ok: false, detail: "Approval signing secret is not configured." }
  }

  const [payload, signature] = value.split(".")
  if (!payload || !signature) {
    return { ok: false, detail: "Revocation envelope format is invalid." }
  }

  const expected = createHmac("sha256", secret)
    .update(payload)
    .digest("base64url")
  if (!constantTimeEqual(signature, expected)) {
    return { ok: false, detail: "Revocation envelope signature is invalid." }
  }

  let decoded: unknown
  try {
    decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"))
  } catch {
    return { ok: false, detail: "Revocation envelope payload is not JSON." }
  }

  const parsed = agenticRevocationEnvelopeSchema.safeParse(decoded)
  if (!parsed.success) {
    return { ok: false, detail: "Revocation envelope payload is invalid." }
  }

  const issuedAt = Date.parse(parsed.data.issuedAt)
  const now = Date.now()
  const ttlMs = Number.parseInt(
    process.env.AGENTIC_APPROVAL_ENVELOPE_TTL_MS ?? "300000",
    10,
  )
  if (!Number.isFinite(issuedAt) || issuedAt > now + 60_000) {
    return { ok: false, detail: "Revocation envelope issued-at is invalid." }
  }
  if (now - issuedAt > ttlMs) {
    return { ok: false, detail: "Revocation envelope has expired." }
  }

  return { ok: true, value: parsed.data }
}

function validateEnvelopeMatchesRequest(
  envelope: AgenticApprovalEnvelope,
  request: AgenticAdapterApplyEgressRequest,
): string | null {
  const fields: Array<keyof AgenticAdapterApplyEgressRequest> = [
    "approvalId",
    "approvedBy",
    "sandboxName",
    "profile",
    "endpointHost",
    "endpointPort",
    "accessMode",
    "reason",
  ]
  for (const field of fields) {
    if (envelope[field] !== request[field]) {
      return `Envelope field ${field} does not match the request body.`
    }
  }
  if ((envelope.expiresAt ?? null) !== (request.expiresAt ?? null)) {
    return "Envelope field expiresAt does not match the request body."
  }
  if (envelope.actorPersona !== "admin") {
    return "Approval envelope actor must be an admin."
  }
  if (envelope.actorSubject !== request.approvedBy) {
    return "Approval envelope actor must match approvedBy."
  }
  return null
}

function validateRevocationEnvelopeMatchesRequest(
  envelope: AgenticRevocationEnvelope,
  request: AgenticAdapterRevokeEgressRequest,
): string | null {
  const fields: Array<keyof AgenticAdapterRevokeEgressRequest> = [
    "approvalId",
    "revokedBy",
    "sandboxName",
    "profile",
    "endpointHost",
    "endpointPort",
    "reason",
  ]
  for (const field of fields) {
    if (envelope[field] !== request[field]) {
      return `Envelope field ${field} does not match the request body.`
    }
  }
  if (envelope.actorPersona !== "admin") {
    return "Revocation envelope actor must be an admin."
  }
  if (envelope.actorSubject !== request.revokedBy) {
    return "Revocation envelope actor must match revokedBy."
  }
  return null
}

function validateApproval(
  approval: AgenticAdapterApplyEgressRequest,
): string | null {
  const expectedSandbox = profileSandbox[approval.profile]
  if (!expectedSandbox || approval.sandboxName !== expectedSandbox) {
    return `Profile ${approval.profile} must target sandbox ${expectedSandbox}.`
  }

  if (!/^[A-Za-z0-9.-]+$/.test(approval.endpointHost)) {
    return "Endpoint host must be a hostname or IPv4 address without scheme, path, or port."
  }

  if (approval.endpointHost.startsWith("-")) {
    return "Endpoint host must not start with a dash."
  }

  return null
}

function validateRevocation(
  revocation: AgenticAdapterRevokeEgressRequest,
): string | null {
  const expectedSandbox = profileSandbox[revocation.profile]
  if (!expectedSandbox || revocation.sandboxName !== expectedSandbox) {
    return `Profile ${revocation.profile} must target sandbox ${expectedSandbox}.`
  }

  if (!/^[A-Za-z0-9.-]+$/.test(revocation.endpointHost)) {
    return "Endpoint host must be a hostname or IPv4 address without scheme, path, or port."
  }

  if (revocation.endpointHost.startsWith("-")) {
    return "Endpoint host must not start with a dash."
  }

  return null
}

function gatewayForProfile(profile: string): string {
  const gateway = profileGateway[profile]
  if (gateway === "hermes") {
    return (
      process.env.AGENTIC_HERMES_OPENSHELL_GATEWAY?.trim() || "hermes-gateway"
    )
  }
  return (
    process.env.AGENTIC_OPENCLAW_OPENSHELL_GATEWAY?.trim() || "openclaw-gateway"
  )
}

function formatEndpoint(approval: AgenticAdapterApplyEgressRequest): string {
  const access = formatAccessMode(approval.accessMode)
  return `${approval.endpointHost}:${approval.endpointPort}:${access}:rest:enforce`
}

function formatAccessMode(accessMode: EgressAccessMode): string {
  return accessMode === "read_only" ? "read-only" : "read-write"
}

function isApplyEnabled(): boolean {
  return process.env.AGENTIC_ADAPTER_APPLY === "true"
}

async function runCommand(args: string[]): Promise<{
  exitCode: number
  stdout: string
  stderr: string
}> {
  return new Promise((resolve) => {
    let settled = false
    const child = spawn(args[0] ?? "", args.slice(1), {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    const timeout = setTimeout(() => {
      child.kill("SIGTERM")
      setTimeout(() => {
        if (!settled) {
          child.kill("SIGKILL")
          settled = true
          resolve({
            exitCode: 124,
            stdout,
            stderr: stderr || "Command timed out.",
          })
        }
      }, 5_000)
    }, 65_000)

    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdout.on("data", (chunk) => {
      stdout += chunk
    })
    child.stderr.on("data", (chunk) => {
      stderr += chunk
    })
    child.on("close", (code) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timeout)
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr,
      })
    })
    child.on("error", (error) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timeout)
      resolve({
        exitCode: 1,
        stdout,
        stderr: error.message,
      })
    })
  })
}

function constantTimeEqual(supplied: string, expected: string): boolean {
  const suppliedBuffer = Buffer.from(supplied)
  const expectedBuffer = Buffer.from(expected)
  return (
    suppliedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(suppliedBuffer, expectedBuffer)
  )
}

const isEntrypoint =
  Boolean(process.argv[1]) &&
  realpathOrResolved(process.argv[1] ?? "") ===
    realpathOrResolved(fileURLToPath(import.meta.url))

function realpathOrResolved(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}

if (isEntrypoint) {
  const server = buildServer()
  const port = Number.parseInt(process.env.PORT ?? "4010", 10)
  const host = process.env.HOST ?? "127.0.0.1"

  await server.listen({ host, port })
}
