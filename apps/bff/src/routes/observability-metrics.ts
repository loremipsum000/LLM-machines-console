import { createHash, timingSafeEqual } from "node:crypto"
import { constants } from "node:fs"
import { open } from "node:fs/promises"
import { isAbsolute } from "node:path"
import type { FastifyInstance, FastifyRequest } from "fastify"
import {
  type ObservabilityMetricsResult,
  getObservabilityMetrics,
} from "../services/admin-observability-metrics"

export interface ObservabilityMetricsRouteOptions {
  getMetrics?: () => Promise<ObservabilityMetricsResult>
  tokenFilePath?: string
}

const METRICS_PATH = "/internal/observability/metrics"
const MAX_TOKEN_FILE_BYTES = 4096
const OPENMETRICS_CONTENT_TYPE =
  "application/openmetrics-text; version=1.0.0; charset=utf-8"

export function observabilityMetricsRouteOptionsFromRuntime(): ObservabilityMetricsRouteOptions {
  return {
    tokenFilePath:
      process.env.BFF_OBSERVABILITY_METRICS_TOKEN_FILE?.trim() || undefined,
  }
}

export function registerObservabilityMetricsRoutes(
  server: FastifyInstance,
  options: ObservabilityMetricsRouteOptions = {},
): void {
  const getMetrics = options.getMetrics ?? getObservabilityMetrics
  server.get(METRICS_PATH, async (request, reply) => {
    const presentedToken = bearerToken(request)
    if (!presentedToken) {
      reply.header("www-authenticate", 'Bearer realm="observability"')
      return reply.code(401).send()
    }

    const expectedToken = await readMountedToken(options.tokenFilePath)
    if (!expectedToken) {
      return reply.code(503).send()
    }
    if (!tokensEqual(presentedToken, expectedToken)) {
      reply.header("www-authenticate", 'Bearer realm="observability"')
      return reply.code(401).send()
    }
    if (hasQueryString(request)) {
      return reply.code(400).send()
    }

    let result: ObservabilityMetricsResult
    try {
      result = await getMetrics()
    } catch {
      return reply.code(503).send()
    }
    if (result.status !== "ok") {
      return reply.code(503).send()
    }
    reply.header("cache-control", "no-store")
    reply.header("content-type", OPENMETRICS_CONTENT_TYPE)
    return reply.code(200).send(result.body)
  })
}

function hasQueryString(request: FastifyRequest): boolean {
  return (request.raw.url ?? "").includes("?")
}

function bearerToken(request: FastifyRequest): string | null {
  const authorization = request.headers.authorization
  if (!authorization) {
    return null
  }
  const match = /^Bearer ([!-~]{32,4096})$/.exec(authorization)
  return match?.[1] ?? null
}

async function readMountedToken(
  configuredPath: string | undefined,
): Promise<string | null> {
  if (!configuredPath || !isAbsolute(configuredPath)) {
    return null
  }

  let file: Awaited<ReturnType<typeof open>> | null = null
  try {
    file = await open(configuredPath, constants.O_RDONLY | constants.O_NOFOLLOW)
    const metadata = await file.stat()
    if (
      !metadata.isFile() ||
      metadata.size === 0 ||
      metadata.size > MAX_TOKEN_FILE_BYTES ||
      (metadata.mode & 0o077) !== 0
    ) {
      return null
    }
    const raw = await file.readFile({ encoding: "utf8" })
    const token = raw.endsWith("\r\n")
      ? raw.slice(0, -2)
      : raw.endsWith("\n")
        ? raw.slice(0, -1)
        : raw
    return /^[!-~]{32,4096}$/.test(token) ? token : null
  } catch {
    return null
  } finally {
    await file?.close().catch(() => undefined)
  }
}

function tokensEqual(presented: string, expected: string): boolean {
  const presentedDigest = createHash("sha256").update(presented).digest()
  const expectedDigest = createHash("sha256").update(expected).digest()
  return timingSafeEqual(presentedDigest, expectedDigest)
}
