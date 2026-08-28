import { constants } from "node:fs"
import { open } from "node:fs/promises"
import { isAbsolute } from "node:path"

export interface PrometheusVectorSample {
  metric: Record<string, string>
  value: [number, string]
}

export interface PrometheusMatrixSample {
  metric: Record<string, string>
  values: Array<[number, string]>
}

export interface BoundedJsonRequestOptions {
  bearerToken?: string
  maxResponseBytes: number
  timeoutMs: number
}

export interface PrometheusClientOptions {
  bearerToken?: string
  bearerTokenFile?: string
  maxResponseBytes?: number
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 2000
const DEFAULT_MAX_RESPONSE_BYTES = 1024 * 1024
const MIN_TIMEOUT_MS = 100
const MAX_TIMEOUT_MS = 30_000
const MIN_RESPONSE_BYTES = 1024
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024
const MAX_METRIC_LABELS = 64
const MAX_METRIC_LABEL_NAME_LENGTH = 128
const MAX_METRIC_LABEL_VALUE_LENGTH = 1024
const MAX_TOKEN_FILE_BYTES = 4096

export class PrometheusClient {
  private readonly baseUrl: URL
  private readonly options: BoundedJsonRequestOptions
  private readonly bearerTokenFile: string | undefined

  constructor(baseUrl: string, options: PrometheusClientOptions = {}) {
    this.baseUrl = validatedHttpBaseUrl(baseUrl, "Prometheus")
    this.options = {
      bearerToken: optionalBearerToken(options.bearerToken),
      maxResponseBytes:
        options.maxResponseBytes ?? prometheusMaxResponseBytes(),
      timeoutMs: options.timeoutMs ?? prometheusTimeoutMs(),
    }
    this.bearerTokenFile =
      options.bearerTokenFile ??
      process.env.ADMIN_PROMETHEUS_BEARER_TOKEN_FILE?.trim() ??
      undefined
  }

  async query(query: string): Promise<PrometheusVectorSample[]> {
    const url = serviceApiUrl(this.baseUrl, "/api/v1/query")
    url.searchParams.set("query", query)
    const response = await fetchBoundedJson(url, await this.requestOptions())
    return parsePrometheusVector(response)
  }

  async queryRange({
    end,
    query,
    start,
    step,
  }: {
    end: Date
    query: string
    start: Date
    step: string
  }): Promise<PrometheusMatrixSample[]> {
    const url = serviceApiUrl(this.baseUrl, "/api/v1/query_range")
    url.searchParams.set("query", query)
    url.searchParams.set("start", unixSeconds(start).toString())
    url.searchParams.set("end", unixSeconds(end).toString())
    url.searchParams.set("step", step)
    const response = await fetchBoundedJson(url, await this.requestOptions())
    return parsePrometheusMatrix(response)
  }

  private async requestOptions(): Promise<BoundedJsonRequestOptions> {
    return {
      ...this.options,
      bearerToken:
        this.options.bearerToken ??
        (await readMountedBearerToken(this.bearerTokenFile)),
    }
  }
}

export async function fetchBoundedJson(
  url: URL,
  options: BoundedJsonRequestOptions,
): Promise<unknown> {
  const headers = new Headers({ accept: "application/json" })
  if (options.bearerToken) {
    headers.set("authorization", `Bearer ${options.bearerToken}`)
  }

  const response = await fetch(url, {
    headers,
    redirect: "error",
    signal: AbortSignal.timeout(
      boundedInteger(
        options.timeoutMs,
        MIN_TIMEOUT_MS,
        MAX_TIMEOUT_MS,
        DEFAULT_TIMEOUT_MS,
      ),
    ),
  })
  if (!response.ok) {
    throw new Error(`Bounded JSON request failed with ${response.status}.`)
  }

  const maxResponseBytes = boundedInteger(
    options.maxResponseBytes,
    MIN_RESPONSE_BYTES,
    MAX_RESPONSE_BYTES,
    DEFAULT_MAX_RESPONSE_BYTES,
  )
  const contentLength = response.headers.get("content-length")
  if (
    contentLength &&
    Number.isFinite(Number(contentLength)) &&
    Number(contentLength) > maxResponseBytes
  ) {
    throw new Error("Bounded JSON response exceeded the read limit.")
  }

  const body = response.body
  if (!body) {
    throw new Error("Bounded JSON response had no body.")
  }
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let bytesRead = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      bytesRead += value.byteLength
      if (bytesRead > maxResponseBytes) {
        await reader.cancel()
        throw new Error("Bounded JSON response exceeded the read limit.")
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const bytes = new Uint8Array(bytesRead)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
  } catch {
    throw new Error("Bounded JSON response was not valid UTF-8 JSON.")
  }
}

export function validatedHttpBaseUrl(value: string, label: string): URL {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error(`${label} base URL is invalid.`)
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    value.includes("?") ||
    value.includes("#")
  ) {
    throw new Error(
      `${label} base URL must use HTTP or HTTPS without userinfo, query, or fragment.`,
    )
  }
  return parsed
}

export function serviceApiUrl(baseUrl: URL, apiPath: string): URL {
  const url = new URL(baseUrl)
  const basePath = url.pathname.replace(/\/$/, "")
  url.pathname = `${basePath}${apiPath}`.replace(/\/{2,}/g, "/")
  url.search = ""
  url.hash = ""
  return url
}

export function firstFiniteValue(
  samples: PrometheusVectorSample[],
): number | null {
  for (const sample of samples) {
    const parsed = Number.parseFloat(sample.value[1])
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  return null
}

function parsePrometheusVector(payload: unknown): PrometheusVectorSample[] {
  const result = parsePrometheusResult(payload, "vector")
  return result
    .map((sample) => parsePrometheusVectorSample(sample))
    .filter((sample) => sample !== null)
}

function parsePrometheusMatrix(payload: unknown): PrometheusMatrixSample[] {
  const result = parsePrometheusResult(payload, "matrix")
  return result
    .map((sample) => parsePrometheusMatrixSample(sample))
    .filter((sample) => sample !== null)
}

function parsePrometheusResult(
  payload: unknown,
  resultType: "matrix" | "vector",
): unknown[] {
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("status" in payload) ||
    payload.status !== "success" ||
    !("data" in payload) ||
    typeof payload.data !== "object" ||
    payload.data === null ||
    !("resultType" in payload.data) ||
    payload.data.resultType !== resultType ||
    !("result" in payload.data) ||
    !Array.isArray(payload.data.result)
  ) {
    throw new Error("Invalid Prometheus response.")
  }

  return payload.data.result
}

function parsePrometheusVectorSample(
  sample: unknown,
): PrometheusVectorSample | null {
  if (
    typeof sample !== "object" ||
    sample === null ||
    !("metric" in sample) ||
    !("value" in sample) ||
    !Array.isArray(sample.value) ||
    sample.value.length < 2 ||
    typeof sample.value[0] !== "number" ||
    !Number.isFinite(sample.value[0]) ||
    typeof sample.value[1] !== "string"
  ) {
    return null
  }
  const metric = parseMetricLabels(sample.metric)
  if (!metric) {
    return null
  }

  return {
    metric,
    value: [sample.value[0], sample.value[1]],
  }
}

function parsePrometheusMatrixSample(
  sample: unknown,
): PrometheusMatrixSample | null {
  if (
    typeof sample !== "object" ||
    sample === null ||
    !("metric" in sample) ||
    !("values" in sample) ||
    !Array.isArray(sample.values)
  ) {
    return null
  }
  const metric = parseMetricLabels(sample.metric)
  if (!metric) {
    return null
  }

  const values = sample.values.filter(isPrometheusValue)
  return { metric, values }
}

function parseMetricLabels(value: unknown): Record<string, string> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null
  }
  const entries = Object.entries(value)
  if (entries.length > MAX_METRIC_LABELS) {
    return null
  }
  const labels: Record<string, string> = {}
  for (const [key, labelValue] of entries) {
    if (
      key.length === 0 ||
      key.length > MAX_METRIC_LABEL_NAME_LENGTH ||
      typeof labelValue !== "string" ||
      labelValue.length > MAX_METRIC_LABEL_VALUE_LENGTH
    ) {
      return null
    }
    labels[key] = labelValue
  }
  return labels
}

function isPrometheusValue(value: unknown): value is [number, string] {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === "number" &&
    Number.isFinite(value[0]) &&
    typeof value[1] === "string"
  )
}

function unixSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000)
}

function prometheusTimeoutMs(): number {
  return boundedEnvInteger(
    "ADMIN_PROMETHEUS_TIMEOUT_MS",
    MIN_TIMEOUT_MS,
    MAX_TIMEOUT_MS,
    DEFAULT_TIMEOUT_MS,
  )
}

function prometheusMaxResponseBytes(): number {
  return boundedEnvInteger(
    "ADMIN_PROMETHEUS_MAX_RESPONSE_BYTES",
    MIN_RESPONSE_BYTES,
    MAX_RESPONSE_BYTES,
    DEFAULT_MAX_RESPONSE_BYTES,
  )
}

function boundedEnvInteger(
  envName: string,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  const parsed = Number.parseInt(process.env[envName] ?? "", 10)
  return boundedInteger(parsed, minimum, maximum, fallback)
}

function boundedInteger(
  value: number,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  return Number.isInteger(value) && value >= minimum && value <= maximum
    ? value
    : fallback
}

function optionalBearerToken(value: string | undefined): string | undefined {
  if (!value) {
    return undefined
  }
  if (value !== value.trim() || value.length > 4096) {
    throw new Error("Prometheus bearer token configuration is invalid.")
  }
  return value
}

async function readMountedBearerToken(
  configuredPath: string | undefined,
): Promise<string | undefined> {
  if (!configuredPath) {
    return undefined
  }
  if (!isAbsolute(configuredPath)) {
    throw new Error("Prometheus bearer token file path is invalid.")
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
      throw new Error("Prometheus bearer token file is not private.")
    }
    const raw = await file.readFile({ encoding: "utf8" })
    const token = raw.endsWith("\r\n")
      ? raw.slice(0, -2)
      : raw.endsWith("\n")
        ? raw.slice(0, -1)
        : raw
    if (!/^[!-~]{32,4096}$/.test(token)) {
      throw new Error("Prometheus bearer token file is invalid.")
    }
    return token
  } catch {
    throw new Error("Prometheus bearer token file is unavailable or unsafe.")
  } finally {
    await file?.close().catch(() => undefined)
  }
}
