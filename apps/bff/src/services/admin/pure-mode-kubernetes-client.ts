import { existsSync, readFileSync } from "node:fs"
import { request } from "node:https"
import type {
  KubernetesClient,
  KubernetesWorkload,
  KubernetesWorkloadKind,
} from "./pure-mode-kubernetes-types"

interface KubernetesListResponse {
  items?: KubernetesApiWorkload[]
}

interface KubernetesApiWorkload {
  metadata?: {
    labels?: Record<string, string>
    name?: string
    namespace?: string
  }
  spec?: {
    replicas?: number
  }
}

export class KubernetesApiClient implements KubernetesClient {
  private readonly apiServer =
    process.env.PURE_MODE_KUBERNETES_API_SERVER ?? inClusterApiServer()
  private readonly caPath =
    process.env.PURE_MODE_KUBERNETES_CA_PATH ??
    "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt"
  private readonly tokenPath =
    process.env.PURE_MODE_KUBERNETES_TOKEN_PATH ??
    "/var/run/secrets/kubernetes.io/serviceaccount/token"

  async listDeployments(namespace: string): Promise<KubernetesWorkload[]> {
    const response = await this.requestJson<KubernetesListResponse>(
      "GET",
      `/apis/apps/v1/namespaces/${encodeURIComponent(namespace)}/deployments`,
    )
    return mapKubernetesWorkloads("deployment", namespace, response)
  }

  async listStatefulSets(namespace: string): Promise<KubernetesWorkload[]> {
    const response = await this.requestJson<KubernetesListResponse>(
      "GET",
      `/apis/apps/v1/namespaces/${encodeURIComponent(namespace)}/statefulsets`,
    )
    return mapKubernetesWorkloads("statefulset", namespace, response)
  }

  async scaleWorkload(input: {
    kind: KubernetesWorkloadKind
    name: string
    namespace: string
    replicas: number
  }): Promise<void> {
    await this.requestJson(
      "PATCH",
      `/apis/apps/v1/namespaces/${encodeURIComponent(input.namespace)}/${workloadPlural(input.kind)}/${encodeURIComponent(input.name)}/scale`,
      {
        spec: {
          replicas: input.replicas,
        },
      },
    )
  }

  private async requestJson<T>(
    method: string,
    path: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    const response = await this.request(method, path, body)
    return JSON.parse(response) as T
  }

  private request(
    method: string,
    path: string,
    body?: Record<string, unknown>,
  ): Promise<string> {
    const payload = body ? JSON.stringify(body) : undefined
    const url = new URL(path, normalizedApiServer(this.apiServer))
    const token = readFileSync(this.tokenPath, "utf8").trim()
    const ca = existsSync(this.caPath) ? readFileSync(this.caPath) : undefined

    return new Promise((resolve, reject) => {
      const req = request(
        url,
        {
          ca,
          headers: {
            accept: "application/json",
            authorization: `Bearer ${token}`,
            ...(payload
              ? {
                  "content-length": Buffer.byteLength(payload).toString(),
                  "content-type": "application/merge-patch+json",
                }
              : {}),
          },
          method,
        },
        (res) => {
          let responseBody = ""
          res.setEncoding("utf8")
          res.on("data", (chunk: string) => {
            responseBody += chunk
          })
          res.on("end", () => {
            if ((res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300) {
              resolve(responseBody)
              return
            }
            reject(
              new Error(
                `Kubernetes API ${method} ${path} failed with ${res.statusCode}: ${responseBody}`,
              ),
            )
          })
        },
      )
      req.on("error", reject)
      if (payload) {
        req.write(payload)
      }
      req.end()
    })
  }
}

function mapKubernetesWorkloads(
  kind: KubernetesWorkloadKind,
  namespace: string,
  response: KubernetesListResponse,
): KubernetesWorkload[] {
  return (response.items ?? []).flatMap((item) => {
    const name = item.metadata?.name
    if (!name) {
      return []
    }
    return [
      {
        kind,
        labels: item.metadata?.labels ?? {},
        name,
        namespace: item.metadata?.namespace ?? namespace,
        replicas: item.spec?.replicas ?? 1,
      },
    ]
  })
}

function workloadPlural(kind: KubernetesWorkloadKind): string {
  return kind === "deployment" ? "deployments" : "statefulsets"
}

function inClusterApiServer(): string {
  const host = process.env.KUBERNETES_SERVICE_HOST
  const port =
    process.env.KUBERNETES_SERVICE_PORT_HTTPS ??
    process.env.KUBERNETES_SERVICE_PORT ??
    "443"
  return host ? `https://${host}:${port}` : "https://kubernetes.default.svc"
}

function normalizedApiServer(apiServer: string): string {
  return apiServer.endsWith("/") ? apiServer : `${apiServer}/`
}
