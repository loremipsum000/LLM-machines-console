import { request } from "node:http"
import {
  isExplicitNonT1PureModeTarget,
  type PureModeExecutor,
} from "./pure-mode-executor-common"

export interface DockerContainer {
  Id: string
  Image: string
  Labels: Record<string, string>
  Names: string[]
  State: string
}

export interface DockerClient {
  listRunningContainers(): Promise<DockerContainer[]>
  startContainer(idOrName: string): Promise<void>
  stopContainer(idOrName: string, timeoutSeconds: number): Promise<void>
}

const dockerComponentPrefix = "docker:"

export function createDockerPureModeExecutor(
  client: DockerClient = new DockerEngineClient(),
): PureModeExecutor {
  const timeoutSeconds = parseStopTimeoutSeconds()

  return {
    async activate() {
      const containers = (await client.listRunningContainers()).filter(
        isPureModeTarget,
      )
      const affectedComponents = containers.map(dockerComponentName)
      for (const container of containers) {
        await client.stopContainer(container.Id, timeoutSeconds)
      }

      return {
        affectedComponents,
        executorStatus: "docker",
        metadata: {
          dockerTargetCount: containers.length,
          dockerTargets: affectedComponents,
          dockerStopTimeoutSeconds: timeoutSeconds,
        },
      }
    },
    async restore(affectedComponents) {
      const dockerTargets = affectedComponents.flatMap(parseDockerComponentName)
      for (const component of dockerTargets) {
        await client.startContainer(component)
      }

      return {
        affectedComponents: [],
        executorStatus: "docker",
        metadata: {
          dockerRestoredCount: dockerTargets.length,
          dockerRestoredTargets: dockerTargets,
        },
      }
    },
  }
}

class DockerEngineClient implements DockerClient {
  private readonly socketPath =
    process.env.PURE_MODE_DOCKER_SOCKET ?? "/var/run/docker.sock"

  async listRunningContainers(): Promise<DockerContainer[]> {
    return this.requestJson<DockerContainer[]>("GET", "/containers/json")
  }

  async stopContainer(idOrName: string, timeoutSeconds: number): Promise<void> {
    await this.requestVoid(
      "POST",
      `/containers/${encodeURIComponent(idOrName)}/stop?t=${timeoutSeconds}`,
      [204, 304],
    )
  }

  async startContainer(idOrName: string): Promise<void> {
    await this.requestVoid(
      "POST",
      `/containers/${encodeURIComponent(idOrName)}/start`,
      [204, 304],
    )
  }

  private async requestJson<T>(method: string, path: string): Promise<T> {
    const body = await this.request(method, path, [200])
    return JSON.parse(body) as T
  }

  private async requestVoid(
    method: string,
    path: string,
    acceptedStatusCodes: number[],
  ): Promise<void> {
    await this.request(method, path, acceptedStatusCodes)
  }

  private request(
    method: string,
    path: string,
    acceptedStatusCodes: number[],
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const req = request(
        {
          method,
          path,
          socketPath: this.socketPath,
        },
        (res) => {
          let body = ""
          res.setEncoding("utf8")
          res.on("data", (chunk: string) => {
            body += chunk
          })
          res.on("end", () => {
            if (acceptedStatusCodes.includes(res.statusCode ?? 0)) {
              resolve(body)
              return
            }
            reject(
              new Error(
                `Docker Engine ${method} ${path} failed with ${res.statusCode}: ${body}`,
              ),
            )
          })
        },
      )
      req.on("error", reject)
      req.end()
    })
  }
}

function isPureModeTarget(container: DockerContainer): boolean {
  return isExplicitNonT1PureModeTarget(container.Labels)
}

function containerName(container: DockerContainer): string {
  const [name] = container.Names
  return name?.replace(/^\//, "") || container.Id
}

function dockerComponentName(container: DockerContainer): string {
  return `${dockerComponentPrefix}${containerName(container)}`
}

function parseDockerComponentName(component: string): string[] {
  if (!component.startsWith(dockerComponentPrefix)) {
    return []
  }
  const name = component.slice(dockerComponentPrefix.length).trim()
  return name ? [name] : []
}

function parseStopTimeoutSeconds(): number {
  const parsed = Number.parseInt(
    process.env.PURE_MODE_DOCKER_STOP_TIMEOUT_SECONDS ?? "10",
    10,
  )
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 10
  }
  return Math.min(parsed, 60)
}
