"use server"

import { randomUUID } from "node:crypto"
import {
  agentCorpusBindingSchema,
  builderAgentStudioSchema,
  builderAgentTestResultSchema,
  builderResourceSchema,
  builderSubmissionSchema,
  type BuilderAgentStudio,
  type BuilderAgentTestResult,
} from "@llm-machines/contracts"
import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"
import { auth } from "@/lib/auth/auth"
import { getBffRequest } from "@/lib/bff/server-request"

export interface BuilderAgentTestActionState {
  error?: string
  result?: BuilderAgentTestResult
}

export async function forkBuilderTemplateAction(
  formData: FormData,
): Promise<void> {
  await requireAuth()
  const templateId = requiredFormValue(formData, "templateId")
  const name = optionalFormValue(formData, "name")
  const fallback = `/builder/templates/${encodeURIComponent(templateId)}`
  const resource = await mutateBuilderOrRedirect(
    `/api/builder/templates/${encodeURIComponent(templateId)}/fork`,
    name ? { name } : {},
    builderResourceSchema,
    fallback,
  )

  revalidateBuilderPaths(resource.id)
  redirectTo(withActionStatus(resource.href, "forked"))
}

export async function createBuilderResourceVersionAction(
  formData: FormData,
): Promise<void> {
  await requireAuth()
  const resourceId = requiredFormValue(formData, "resourceId")
  const semver = requiredFormValue(formData, "semver")
  const fallback = `/builder/resources/${encodeURIComponent(resourceId)}`
  const resource = await mutateBuilderOrRedirect(
    `/api/builder/resources/${encodeURIComponent(resourceId)}/versions`,
    { semver },
    builderResourceSchema,
    fallback,
  )

  revalidateBuilderPaths(resource.id)
  redirectTo(withActionStatus(resource.href, "versioned"))
}

export async function submitBuilderResourceAction(
  formData: FormData,
): Promise<void> {
  await requireAuth()
  const resourceId = requiredFormValue(formData, "resourceId")
  const fallback = `/builder/resources/${encodeURIComponent(resourceId)}`
  const submission = await mutateBuilderOrRedirect(
    `/api/builder/resources/${encodeURIComponent(resourceId)}/submit`,
    undefined,
    builderSubmissionSchema,
    fallback,
  )

  revalidateBuilderPaths(resourceId)
  redirectTo(
    withActionStatus(
      `/builder/resources/${submission.resourceId}`,
      "submitted",
    ),
  )
}

export async function withdrawBuilderResourceAction(
  formData: FormData,
): Promise<void> {
  await requireAuth()
  const resourceId = requiredFormValue(formData, "resourceId")
  const fallback = `/builder/resources/${encodeURIComponent(resourceId)}`
  const submission = await mutateBuilderOrRedirect(
    `/api/builder/resources/${encodeURIComponent(resourceId)}/withdraw`,
    undefined,
    builderSubmissionSchema,
    fallback,
  )

  revalidateBuilderPaths(resourceId)
  redirectTo(
    withActionStatus(
      `/builder/resources/${submission.resourceId}`,
      "withdrawn",
    ),
  )
}

export async function saveBuilderAgentStudioAction(
  formData: FormData,
): Promise<void> {
  await requireAuth()
  const resourceId = requiredFormValue(formData, "resourceId")
  const fallback = `/builder/agents/${encodeURIComponent(resourceId)}`
  const studio = await mutateBuilderOrRedirect(
    `/api/builder/agents/${encodeURIComponent(resourceId)}/studio`,
    {
      name: requiredFormValue(formData, "name"),
      description: requiredFormValue(formData, "description"),
      model: requiredFormValue(formData, "model"),
      sandboxProfile: requiredFormValue(formData, "sandboxProfile"),
      systemPrompt: requiredFormValue(formData, "systemPrompt"),
      instructions: requiredFormValue(formData, "instructions"),
      temperature: requiredNumberFormValue(formData, "temperature"),
      maxOutputTokens: requiredIntegerFormValue(formData, "maxOutputTokens"),
      tools: parseToolList(optionalFormValue(formData, "tools")),
      sampleInput: requiredFormValue(formData, "sampleInput"),
    },
    builderAgentStudioSchema,
    fallback,
  )

  revalidateBuilderPaths(studio.resource.id)
  redirectTo(withActionStatus(fallback, "studioSaved"))
}

export async function resetBuilderAgentStudioDraftAction(
  formData: FormData,
): Promise<void> {
  await requireAuth()
  const resourceId = requiredFormValue(formData, "resourceId")
  const fallback = `/builder/agents/${encodeURIComponent(resourceId)}`
  const confirmation = requiredFormValue(formData, "confirmation")
  let studio: BuilderAgentStudio

  try {
    studio = await postBuilderMutation(
      `/api/builder/agents/${encodeURIComponent(resourceId)}/studio/reset`,
      { confirmation },
      builderAgentStudioSchema,
    )
  } catch {
    redirectTo(withActionStatus(fallback, "failed"))
  }

  revalidateBuilderPaths(studio.resource.id)
  redirectTo(withActionStatus(fallback, "studioReset"))
}

export async function clearBuilderAgentStudioTestRunsAction(
  formData: FormData,
): Promise<void> {
  await requireAuth()
  const resourceId = requiredFormValue(formData, "resourceId")
  const fallback = `/builder/agents/${encodeURIComponent(resourceId)}`
  const confirmation = requiredFormValue(formData, "confirmation")
  let studio: BuilderAgentStudio

  try {
    studio = await postBuilderMutation(
      `/api/builder/agents/${encodeURIComponent(resourceId)}/test-runs/clear`,
      { confirmation },
      builderAgentStudioSchema,
    )
  } catch {
    redirectTo(withActionStatus(fallback, "failed"))
  }

  revalidateBuilderPaths(studio.resource.id)
  redirectTo(withActionStatus(fallback, "testRunsCleared"))
}

export async function testBuilderAgentStudioAction(
  _previousState: BuilderAgentTestActionState,
  formData: FormData,
): Promise<BuilderAgentTestActionState> {
  await requireAuth()
  try {
    const resourceId = requiredFormValue(formData, "resourceId")
    const result = await postBuilderMutation(
      `/api/builder/agents/${encodeURIComponent(resourceId)}/test`,
      {
        input: requiredFormValue(formData, "input"),
      },
      builderAgentTestResultSchema,
    )

    revalidateBuilderPaths(resourceId)
    return { result }
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Agent test failed. Check the draft state, your Builder role, and runtime configuration.",
    }
  }
}

export async function attachBuilderKnowledgeCorpusAction(
  formData: FormData,
): Promise<void> {
  await requireAuth()
  const resourceId = requiredFormValue(formData, "resourceId")
  const corpusId = requiredFormValue(formData, "corpusId")
  const fallback = `/builder/agents/${encodeURIComponent(resourceId)}`

  try {
    await postBuilderMutation(
      `/api/builder/agents/${encodeURIComponent(
        resourceId,
      )}/corpora/${encodeURIComponent(corpusId)}`,
      undefined,
      agentCorpusBindingSchema,
    )
  } catch {
    redirectTo(withActionStatus(fallback, "failed"))
  }

  revalidateBuilderPaths(resourceId)
  redirectTo(withActionStatus(fallback, "corpusAttached"))
}

export async function approveBuilderResourceAction(
  formData: FormData,
): Promise<void> {
  await requireAuth()
  const resourceId = requiredFormValue(formData, "resourceId")
  const fallback = `/builder/resources/${encodeURIComponent(resourceId)}`
  const submission = await mutateBuilderOrRedirect(
    `/api/admin/resources/${encodeURIComponent(resourceId)}/approve`,
    undefined,
    builderSubmissionSchema,
    fallback,
  )

  revalidateBuilderPaths(resourceId)
  redirectTo(
    withActionStatus(`/builder/resources/${submission.resourceId}`, "approved"),
  )
}

export async function rejectBuilderResourceAction(
  formData: FormData,
): Promise<void> {
  await requireAuth()
  const resourceId = requiredFormValue(formData, "resourceId")
  const fallback = `/builder/resources/${encodeURIComponent(resourceId)}`
  const comment = optionalFormValue(formData, "comment")
  if (!comment) {
    redirectTo(withActionStatus(fallback, "failed"))
  }

  const submission = await mutateBuilderOrRedirect(
    `/api/admin/resources/${encodeURIComponent(resourceId)}/reject`,
    { comment },
    builderSubmissionSchema,
    fallback,
  )

  revalidateBuilderPaths(resourceId)
  redirectTo(
    withActionStatus(`/builder/resources/${submission.resourceId}`, "rejected"),
  )
}

async function mutateBuilderOrRedirect<T>(
  path: string,
  body: Record<string, unknown> | undefined,
  schema: { parse: (value: unknown) => T },
  fallbackHref: string,
): Promise<T> {
  try {
    return await postBuilderMutation(path, body, schema)
  } catch {
    redirectTo(withActionStatus(fallbackHref, "failed"))
  }
}

async function requireAuth() {
  const session = await auth()
  if (
    !session?.user.roles.includes("admin") &&
    !session?.user.roles.includes("builder")
  ) {
    throw new Error("Builder session required.")
  }
  return session
}

function redirectTo(href: string): never {
  redirect(href)
}

async function postBuilderMutation<T>(
  path: string,
  body: Record<string, unknown> | undefined,
  schema: { parse: (value: unknown) => T },
): Promise<T> {
  const bffRequest = await getBffRequest()
  if (!bffRequest) {
    throw new Error("Builder BFF is not configured.")
  }

  const headers = new Headers(bffRequest.headers)
  headers.set("Idempotency-Key", randomUUID())
  if (body) {
    headers.set("Content-Type", "application/json")
  }

  const response = await fetch(`${bffRequest.baseUrl}${path}`, {
    method: "POST",
    cache: "no-store",
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!response.ok) {
    throw new Error(await readBuilderProblem(response))
  }

  return schema.parse(await response.json())
}

async function readBuilderProblem(response: Response): Promise<string> {
  const fallback = `Builder mutation failed with ${response.status}.`
  const contentType = response.headers.get("content-type") ?? ""
  if (!contentType.includes("application/json")) {
    return fallback
  }

  try {
    const body = (await response.json()) as unknown
    if (!body || typeof body !== "object") {
      return fallback
    }
    const detail = (body as { detail?: unknown }).detail
    if (typeof detail === "string" && detail.trim()) {
      return detail.trim()
    }
    const title = (body as { title?: unknown }).title
    if (typeof title === "string" && title.trim()) {
      return title.trim()
    }
  } catch {
    return fallback
  }

  return fallback
}

function requiredFormValue(formData: FormData, name: string): string {
  const value = optionalFormValue(formData, name)
  if (!value) {
    throw new Error(`${name} is required.`)
  }
  return value
}

function optionalFormValue(formData: FormData, name: string): string | null {
  const value = formData.get(name)
  if (typeof value !== "string") {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function requiredNumberFormValue(formData: FormData, name: string): number {
  const value = Number(requiredFormValue(formData, name))
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be a number.`)
  }
  return value
}

function requiredIntegerFormValue(formData: FormData, name: string): number {
  const value = requiredNumberFormValue(formData, name)
  if (!Number.isInteger(value)) {
    throw new Error(`${name} must be an integer.`)
  }
  return value
}

function parseToolList(value: string | null): string[] {
  if (!value) {
    return []
  }
  return value.split(/[\n,]+/).flatMap((tool) => {
    const trimmed = tool.trim()
    return trimmed ? [trimmed] : []
  })
}

function revalidateBuilderPaths(resourceId: string): void {
  revalidatePath("/builder")
  revalidatePath("/builder/templates")
  revalidatePath("/builder/submissions")
  revalidatePath(`/builder/resources/${resourceId}`)
  revalidatePath(`/builder/agents/${resourceId}`)
}

function withActionStatus(href: string, status: string): string {
  const [path, query = ""] = href.split("?")
  const params = new URLSearchParams(query)
  params.set("builderAction", status)
  return `${path}?${params.toString()}`
}
