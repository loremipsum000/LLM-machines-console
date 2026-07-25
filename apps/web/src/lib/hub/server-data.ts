import "server-only"

import {
  artifactSchema,
  hubHomeResponseSchema,
  hubResourceSchema,
  hubUsageSummarySchema,
  taskSessionSchema,
} from "@llm-machines/contracts"
import { getBffRequest } from "@/lib/bff/server-request"

export async function getHubHome() {
  return getRequiredHubData("/api/hub/home", hubHomeResponseSchema)
}

export async function getHubResources() {
  return getRequiredHubData("/api/hub/resources", hubResourceSchema.array())
}

export async function getHubResourceById(type: string, id: string) {
  return getOptionalHubData(
    `/api/hub/resources/${encodeURIComponent(type)}/${encodeURIComponent(id)}`,
    hubResourceSchema,
  )
}

export async function getHubUsage() {
  return getRequiredHubData("/api/hub/usage", hubUsageSummarySchema)
}

export async function getHubTasks() {
  return getRequiredHubData("/api/hub/tasks", taskSessionSchema.array())
}

export async function getHubTaskById(id: string) {
  return getOptionalHubData(
    `/api/hub/tasks/${encodeURIComponent(id)}`,
    taskSessionSchema,
  )
}

export async function getHubArtifacts() {
  return getRequiredHubData("/api/hub/artifacts", artifactSchema.array())
}

export async function getHubArtifactById(id: string) {
  return getOptionalHubData(
    `/api/hub/artifacts/${encodeURIComponent(id)}`,
    artifactSchema,
  )
}

async function getRequiredHubData<T>(
  path: string,
  schema: { parse: (value: unknown) => T },
): Promise<T> {
  const value = await getHubData(path, schema, false)
  if (value === undefined) {
    throw new Error(`Console BFF returned HTTP 404 for ${path}.`)
  }
  return value
}

async function getOptionalHubData<T>(
  path: string,
  schema: { parse: (value: unknown) => T },
): Promise<T | undefined> {
  return getHubData(path, schema, true)
}

async function getHubData<T>(
  path: string,
  schema: { parse: (value: unknown) => T },
  allowNotFound: boolean,
): Promise<T | undefined> {
  const bffRequest = await getBffRequest()

  if (!bffRequest) {
    throw new Error(
      `Console BFF is not available for ${path}; fixture mode is disabled.`,
    )
  }

  try {
    const response = await fetch(`${bffRequest.baseUrl}${path}`, {
      cache: "no-store",
      headers: bffRequest.headers,
    })

    if (response.status === 404 && allowNotFound) {
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
