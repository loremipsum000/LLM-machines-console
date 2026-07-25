import { existsSync, readFileSync } from "node:fs"
import {
  isExplicitNonT1PureModeTarget,
  type PureModeExecutor,
} from "./pure-mode-executor-common"
import { KubernetesApiClient } from "./pure-mode-kubernetes-client"
import type {
  KubernetesClient,
  KubernetesWorkload,
  KubernetesWorkloadKind,
} from "./pure-mode-kubernetes-types"

export type { KubernetesClient, KubernetesWorkload, KubernetesWorkloadKind }

interface KubernetesWorkloadRef {
  kind: KubernetesWorkloadKind
  name: string
  namespace: string
  replicas: number
}

const kubernetesComponentPrefix = "k8s"

export function createKubernetesPureModeExecutor(
  client: KubernetesClient = new KubernetesApiClient(),
  namespaces = parseKubernetesNamespaces(),
): PureModeExecutor {
  return {
    async activate() {
      const workloads = (await listWorkloads(client, namespaces))
        .filter((workload) => isExplicitNonT1PureModeTarget(workload.labels))
        .filter((workload) => workload.replicas > 0)
      const affectedComponents = workloads.map(kubernetesComponentName)

      for (const workload of workloads) {
        await client.scaleWorkload({
          kind: workload.kind,
          name: workload.name,
          namespace: workload.namespace,
          replicas: 0,
        })
      }

      return {
        affectedComponents,
        executorStatus: "kubernetes",
        metadata: {
          kubernetesNamespaces: namespaces,
          kubernetesTargetCount: workloads.length,
          kubernetesTargets: affectedComponents,
        },
      }
    },
    async restore(affectedComponents) {
      const targets = affectedComponents.flatMap(parseKubernetesComponentName)
      for (const target of targets) {
        await client.scaleWorkload(target)
      }

      return {
        affectedComponents: [],
        executorStatus: "kubernetes",
        metadata: {
          kubernetesRestoredCount: targets.length,
          kubernetesRestoredTargets: targets.map(kubernetesRestoreTarget),
        },
      }
    },
  }
}

async function listWorkloads(
  client: KubernetesClient,
  namespaces: string[],
): Promise<KubernetesWorkload[]> {
  const workloads: KubernetesWorkload[] = []
  for (const namespace of namespaces) {
    const [deployments, statefulSets] = await Promise.all([
      client.listDeployments(namespace),
      client.listStatefulSets(namespace),
    ])
    workloads.push(...deployments, ...statefulSets)
  }
  return workloads
}

function kubernetesComponentName(workload: KubernetesWorkload): string {
  return [
    kubernetesComponentPrefix,
    workload.kind,
    workload.namespace,
    workload.name,
    workload.replicas.toString(),
  ].join(":")
}

function parseKubernetesComponentName(
  component: string,
): KubernetesWorkloadRef[] {
  const [prefix, kind, namespace, name, replicas] = component.split(":")
  if (prefix !== "k8s" || !isKubernetesKind(kind) || !namespace || !name) {
    return []
  }
  const parsedReplicas = Number.parseInt(replicas ?? "", 10)
  if (!Number.isInteger(parsedReplicas) || parsedReplicas < 0) {
    return []
  }
  return [
    {
      kind,
      name,
      namespace,
      replicas: parsedReplicas,
    },
  ]
}

function kubernetesRestoreTarget(target: KubernetesWorkloadRef): string {
  return [
    target.kind,
    target.namespace,
    target.name,
    target.replicas.toString(),
  ].join(":")
}

function isKubernetesKind(value: string): value is KubernetesWorkloadKind {
  return value === "deployment" || value === "statefulset"
}

function parseKubernetesNamespaces(): string[] {
  const configured =
    process.env.PURE_MODE_KUBERNETES_NAMESPACES ??
    process.env.PURE_MODE_KUBERNETES_NAMESPACE
  const namespaces = configured
    ? configured
        .split(",")
        .map((namespace) => namespace.trim())
        .filter(Boolean)
    : [readServiceAccountNamespace()]
  return [...new Set(namespaces)]
}

function readServiceAccountNamespace(): string {
  const namespacePath =
    process.env.PURE_MODE_KUBERNETES_NAMESPACE_PATH ??
    "/var/run/secrets/kubernetes.io/serviceaccount/namespace"
  if (!existsSync(namespacePath)) {
    return "console"
  }
  return readFileSync(namespacePath, "utf8").trim() || "console"
}
