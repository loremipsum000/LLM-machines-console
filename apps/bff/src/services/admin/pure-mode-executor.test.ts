import { afterEach, describe, expect, it, vi } from "vitest"
import {
  createDockerPureModeExecutor,
  type DockerClient,
  type DockerContainer,
} from "./pure-mode-docker-executor"
import {
  createKubernetesPureModeExecutor,
  type KubernetesClient,
  type KubernetesWorkload,
} from "./pure-mode-kubernetes-executor"

describe("Pure Mode executor", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("stops only explicit non-T1 Docker Pure Mode targets", async () => {
    vi.stubEnv("PURE_MODE_DOCKER_STOP_TIMEOUT_SECONDS", "12")
    const stopped: Array<{ idOrName: string; timeoutSeconds: number }> = []
    const client: DockerClient = {
      async listRunningContainers() {
        return [
          dockerContainer({
            id: "t3-agent-id",
            labels: {
              "llm-machines.pure-mode-target": "true",
              "llm-machines.tier": "t3",
            },
            name: "t3-agent",
          }),
          dockerContainer({
            id: "t2-builder-id",
            labels: {
              "com.llm-machines.pure-mode-target": "true",
              "com.llm-machines.support-tier": "t2",
            },
            name: "t2-builder",
          }),
          dockerContainer({
            id: "t1-core-id",
            labels: {
              "llm-machines.pure-mode-target": "true",
              "llm-machines.tier": "t1",
            },
            name: "t1-core",
          }),
          dockerContainer({
            id: "untargeted-t3-id",
            labels: {
              "llm-machines.tier": "t3",
            },
            name: "untargeted-t3",
          }),
        ]
      },
      async startContainer() {
        throw new Error("restore was not expected")
      },
      async stopContainer(idOrName, timeoutSeconds) {
        stopped.push({ idOrName, timeoutSeconds })
      },
    }

    const result = await createDockerPureModeExecutor(client).activate()

    expect(result).toMatchObject({
      affectedComponents: ["docker:t3-agent", "docker:t2-builder"],
      executorStatus: "docker",
      metadata: {
        dockerStopTimeoutSeconds: 12,
        dockerTargetCount: 2,
        dockerTargets: ["docker:t3-agent", "docker:t2-builder"],
      },
    })
    expect(stopped).toEqual([
      { idOrName: "t3-agent-id", timeoutSeconds: 12 },
      { idOrName: "t2-builder-id", timeoutSeconds: 12 },
    ])
  })

  it("restores only persisted Docker component references", async () => {
    const started: string[] = []
    const client: DockerClient = {
      async listRunningContainers() {
        return []
      },
      async startContainer(idOrName) {
        started.push(idOrName)
      },
      async stopContainer() {
        throw new Error("activate was not expected")
      },
    }

    const result = await createDockerPureModeExecutor(client).restore([
      "docker:t3-agent",
      "t3-client-agents",
      "docker:",
      "docker:t2-builder",
    ])

    expect(result).toMatchObject({
      affectedComponents: [],
      executorStatus: "docker",
      metadata: {
        dockerRestoredCount: 2,
        dockerRestoredTargets: ["t3-agent", "t2-builder"],
      },
    })
    expect(started).toEqual(["t3-agent", "t2-builder"])
  })

  it("scales only explicit non-T1 Kubernetes Pure Mode targets", async () => {
    const scaled: Array<{
      kind: string
      name: string
      namespace: string
      replicas: number
    }> = []
    const client: KubernetesClient = {
      async listDeployments(namespace) {
        return [
          kubernetesWorkload({
            kind: "deployment",
            labels: {
              "llm-machines.pure-mode-target": "true",
              "llm-machines.tier": "t3",
            },
            name: "client-agent",
            namespace,
            replicas: 3,
          }),
          kubernetesWorkload({
            kind: "deployment",
            labels: {
              "llm-machines.pure-mode-target": "true",
              "llm-machines.tier": "t1",
            },
            name: "console-bff",
            namespace,
            replicas: 2,
          }),
        ]
      },
      async listStatefulSets(namespace) {
        return [
          kubernetesWorkload({
            kind: "statefulset",
            labels: {
              "com.llm-machines.pure-mode-target": "true",
              "com.llm-machines.support-tier": "t2",
            },
            name: "builder-worker",
            namespace,
            replicas: 1,
          }),
          kubernetesWorkload({
            kind: "statefulset",
            labels: {
              "llm-machines.tier": "t3",
            },
            name: "untargeted",
            namespace,
            replicas: 1,
          }),
          kubernetesWorkload({
            kind: "statefulset",
            labels: {
              "llm-machines.pure-mode-target": "true",
              "llm-machines.tier": "t3",
            },
            name: "already-scaled-down",
            namespace,
            replicas: 0,
          }),
        ]
      },
      async scaleWorkload(input) {
        scaled.push(input)
      },
    }

    const result = await createKubernetesPureModeExecutor(client, [
      "console",
    ]).activate()

    expect(result).toMatchObject({
      affectedComponents: [
        "k8s:deployment:console:client-agent:3",
        "k8s:statefulset:console:builder-worker:1",
      ],
      executorStatus: "kubernetes",
      metadata: {
        kubernetesNamespaces: ["console"],
        kubernetesTargetCount: 2,
        kubernetesTargets: [
          "k8s:deployment:console:client-agent:3",
          "k8s:statefulset:console:builder-worker:1",
        ],
      },
    })
    expect(scaled).toEqual([
      {
        kind: "deployment",
        name: "client-agent",
        namespace: "console",
        replicas: 0,
      },
      {
        kind: "statefulset",
        name: "builder-worker",
        namespace: "console",
        replicas: 0,
      },
    ])
  })

  it("restores only persisted Kubernetes component references", async () => {
    const scaled: Array<{
      kind: string
      name: string
      namespace: string
      replicas: number
    }> = []
    const client: KubernetesClient = {
      async listDeployments() {
        return []
      },
      async listStatefulSets() {
        return []
      },
      async scaleWorkload(input) {
        scaled.push(input)
      },
    }

    const result = await createKubernetesPureModeExecutor(client, [
      "console",
    ]).restore([
      "k8s:deployment:console:client-agent:3",
      "docker:t3-agent",
      "k8s:statefulset:console:builder-worker:1",
      "k8s:deployment:console:bad-replicas:nope",
    ])

    expect(result).toMatchObject({
      affectedComponents: [],
      executorStatus: "kubernetes",
      metadata: {
        kubernetesRestoredCount: 2,
        kubernetesRestoredTargets: [
          "deployment:console:client-agent:3",
          "statefulset:console:builder-worker:1",
        ],
      },
    })
    expect(scaled).toEqual([
      {
        kind: "deployment",
        name: "client-agent",
        namespace: "console",
        replicas: 3,
      },
      {
        kind: "statefulset",
        name: "builder-worker",
        namespace: "console",
        replicas: 1,
      },
    ])
  })
})

function dockerContainer(input: {
  id: string
  labels: Record<string, string>
  name: string
}): DockerContainer {
  return {
    Id: input.id,
    Image: "example:test",
    Labels: input.labels,
    Names: [`/${input.name}`],
    State: "running",
  }
}

function kubernetesWorkload(input: KubernetesWorkload): KubernetesWorkload {
  return input
}
