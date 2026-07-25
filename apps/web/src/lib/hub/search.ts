import type {
  Artifact,
  HubResource,
  HubSearchResult,
  TaskSession,
} from "@llm-machines/contracts"

export interface HubSearchInput {
  artifacts: Artifact[]
  query: string
  resources: HubResource[]
  tasks: TaskSession[]
}

export function searchLocalHub({
  artifacts,
  query,
  resources,
  tasks,
}: HubSearchInput): HubSearchResult[] {
  const normalized = query.trim().toLowerCase()
  const candidates: HubSearchResult[] = [
    ...resources.map((resource, index) => ({
      id: resource.id,
      type: "resource" as const,
      title: resource.name,
      description: resource.description,
      href: `/resources/${resource.type}/${resource.id}`,
      rank: index + 1,
    })),
    ...tasks.map((task, index) => ({
      id: task.id,
      type: "task" as const,
      title: task.title,
      description: task.status,
      href: task.href,
      rank: resources.length + index + 1,
    })),
    ...artifacts.map((artifact, index) => ({
      id: artifact.id,
      type: "artifact" as const,
      title: artifact.title,
      description: artifact.kind,
      href: artifact.href,
      rank: resources.length + tasks.length + index + 1,
    })),
  ]

  if (!normalized) {
    return candidates.slice(0, 8)
  }

  return candidates
    .filter((candidate) =>
      [candidate.title, candidate.description ?? ""].some((value) =>
        value.toLowerCase().includes(normalized),
      ),
    )
    .slice(0, 8)
}
