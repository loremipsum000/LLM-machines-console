export interface PrometheusVectorSample {
  metric: Record<string, string>
  value: [number, string]
}

export interface PrometheusMatrixSample {
  metric: Record<string, string>
  values: Array<[number, string]>
}

const DEFAULT_TIMEOUT_MS = 2000

export class PrometheusClient {
  constructor(private readonly baseUrl: string) {}

  async query(query: string): Promise<PrometheusVectorSample[]> {
    const url = new URL("/api/v1/query", this.baseUrl)
    url.searchParams.set("query", query)
    const response = await fetch(url, {
      signal: AbortSignal.timeout(prometheusTimeoutMs()),
    })
    if (!response.ok) {
      throw new Error(`Prometheus query failed with ${response.status}.`)
    }

    return parsePrometheusVector(await response.json())
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
    const url = new URL("/api/v1/query_range", this.baseUrl)
    url.searchParams.set("query", query)
    url.searchParams.set("start", unixSeconds(start).toString())
    url.searchParams.set("end", unixSeconds(end).toString())
    url.searchParams.set("step", step)
    const response = await fetch(url, {
      signal: AbortSignal.timeout(prometheusTimeoutMs()),
    })
    if (!response.ok) {
      throw new Error(`Prometheus range query failed with ${response.status}.`)
    }

    return parsePrometheusMatrix(await response.json())
  }
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
    typeof sample.metric !== "object" ||
    sample.metric === null ||
    !Array.isArray(sample.value) ||
    sample.value.length < 2 ||
    typeof sample.value[0] !== "number" ||
    typeof sample.value[1] !== "string"
  ) {
    return null
  }

  return {
    metric: sample.metric as Record<string, string>,
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
    typeof sample.metric !== "object" ||
    sample.metric === null ||
    !Array.isArray(sample.values)
  ) {
    return null
  }

  const values = sample.values.filter(isPrometheusValue)
  return {
    metric: sample.metric as Record<string, string>,
    values,
  }
}

function isPrometheusValue(value: unknown): value is [number, string] {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === "number" &&
    typeof value[1] === "string"
  )
}

function unixSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000)
}

function prometheusTimeoutMs(): number {
  const parsed = Number.parseInt(
    process.env.ADMIN_PROMETHEUS_TIMEOUT_MS ?? "",
    10,
  )
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed
  }
  return DEFAULT_TIMEOUT_MS
}
