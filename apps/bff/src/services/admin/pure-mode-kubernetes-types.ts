export type KubernetesWorkloadKind = "deployment" | "statefulset"

export interface KubernetesWorkload {
  kind: KubernetesWorkloadKind
  labels: Record<string, string>
  name: string
  namespace: string
  replicas: number
}

export interface KubernetesClient {
  listDeployments(namespace: string): Promise<KubernetesWorkload[]>
  listStatefulSets(namespace: string): Promise<KubernetesWorkload[]>
  scaleWorkload(input: {
    kind: KubernetesWorkloadKind
    name: string
    namespace: string
    replicas: number
  }): Promise<void>
}
