import "server-only"

import {
  builderAgentStudioSchema,
  builderResourceSchema,
  builderSubmissionSchema,
  builderTemplateSchema,
  agentCorpusBindingSchema,
  knowledgeCorpusListResponseSchema,
} from "@llm-machines/contracts"
import { getBffRequest } from "@/lib/bff/server-request"
import {
  builderAgentStudios,
  builderResources,
  builderSubmissions,
  builderTemplates,
} from "./mock-data"
import {
  builderAgentCorpusBindings,
  builderKnowledgeCorpusList,
} from "@/lib/knowledge/mock-data"
import {
  canUseWebFixtureData,
  isConsoleBffConfigured,
} from "@/lib/runtime/fixture-mode"

export async function getBuilderTemplates() {
  return getBuilderData(
    "/api/builder/templates",
    builderTemplateSchema.array(),
    builderTemplates,
  )
}

export async function getBuilderTemplateById(id: string) {
  return getBuilderData(
    `/api/builder/templates/${encodeURIComponent(id)}`,
    builderTemplateSchema,
    builderTemplates.find((template) => template.id === id),
  )
}

export async function getBuilderResources() {
  return getBuilderData(
    "/api/builder/resources",
    builderResourceSchema.array(),
    builderResources,
  )
}

export async function getBuilderResourceById(id: string) {
  return getBuilderData(
    `/api/builder/resources/${encodeURIComponent(id)}`,
    builderResourceSchema,
    builderResources.find((resource) => resource.id === id),
  )
}

export async function getBuilderAgentStudioById(id: string) {
  return getBuilderData(
    `/api/builder/agents/${encodeURIComponent(id)}/studio`,
    builderAgentStudioSchema,
    builderAgentStudios.find((studio) => studio.resource.id === id),
  )
}

export async function getBuilderKnowledgeCorpora() {
  return getBuilderData(
    "/api/builder/knowledge/corpora",
    knowledgeCorpusListResponseSchema,
    builderKnowledgeCorpusList,
  )
}

export async function getBuilderAgentCorpusBindings(agentId: string) {
  return getBuilderData(
    `/api/builder/agents/${encodeURIComponent(agentId)}/corpora`,
    agentCorpusBindingSchema.array(),
    builderAgentCorpusBindings.filter(
      (binding) => binding.agentResourceId === agentId,
    ),
  )
}

export async function getBuilderSubmissions() {
  return getBuilderData(
    "/api/builder/submissions",
    builderSubmissionSchema.array(),
    builderSubmissions,
  )
}

function getBuilderData<T>(
  path: string,
  schema: { parse: (value: unknown) => T },
  fallback: T,
): Promise<T>
function getBuilderData<T>(
  path: string,
  schema: { parse: (value: unknown) => T },
  fallback: T | undefined,
): Promise<T | undefined>
async function getBuilderData<T>(
  path: string,
  schema: { parse: (value: unknown) => T },
  fallback: T | undefined,
): Promise<T | undefined> {
  const bffRequest = await getBffRequest()

  if (!bffRequest) {
    if (canUseWebFixtureData() && !isConsoleBffConfigured()) {
      return fallback
    }
    throw new Error(
      `Console BFF is not available for ${path}; fixture mode is disabled.`,
    )
  }

  try {
    const response = await fetch(`${bffRequest.baseUrl}${path}`, {
      cache: "no-store",
      headers: bffRequest.headers,
    })

    if (response.status === 404) {
      return undefined
    }

    if (!response.ok) {
      throw new Error(
        `Console BFF returned HTTP ${response.status} for ${path}.`,
      )
    }

    return schema.parse(await response.json())
  } catch (error) {
    if (error instanceof Error) {
      throw error
    }
    throw new Error(`Console BFF request failed for ${path}.`)
  }
}
