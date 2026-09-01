import "server-only"

import { getBffRequest } from "@/lib/bff/server-request"
import {
  type AdminConnectedAppDetail,
  adminConnectedAppDetailSchema,
  adminConnectedAppsResponseSchema,
  adminHardwareResponseSchema,
  adminInferenceDashboardSchema,
  adminSettingsResponseSchema,
  adminTeamMemberDetailSchema,
  adminTeamOverviewResponseSchema,
} from "@llm-machines/contracts/inference-core"

export class ConsoleBffAuthExpiredError extends Error {
  constructor(path: string) {
    super(`Console BFF authentication expired for ${path}.`)
    this.name = "ConsoleBffAuthExpiredError"
  }
}

export class ConsoleBffUnavailableError extends Error {
  constructor(path: string) {
    super(`Console BFF is not available for ${path}.`)
    this.name = "ConsoleBffUnavailableError"
  }
}

export function isConsoleBffAuthExpiredError(
  error: unknown,
): error is ConsoleBffAuthExpiredError {
  return error instanceof ConsoleBffAuthExpiredError
}

export function isConsoleBffUnavailableError(
  error: unknown,
): error is ConsoleBffUnavailableError {
  return error instanceof ConsoleBffUnavailableError
}

export async function getAdminHardware(
  filters: {
    range?: string
    step?: string
  } = {},
) {
  const params = new URLSearchParams()
  if (filters.range) {
    params.set("range", filters.range)
  }
  if (filters.step) {
    params.set("step", filters.step)
  }
  const queryString = params.toString()
  return getAdminData(
    `/api/admin/hardware${queryString ? `?${queryString}` : ""}`,
    adminHardwareResponseSchema,
  )
}

export async function getAdminInference(
  filters: {
    range?: string
  } = {},
) {
  const params = new URLSearchParams()
  if (filters.range) {
    params.set("range", filters.range)
  }
  const queryString = params.toString()
  return getAdminData(
    `/api/admin/inference${queryString ? `?${queryString}` : ""}`,
    adminInferenceDashboardSchema,
  )
}

export async function getAdminConnectedApps() {
  return getAdminData(
    "/api/admin/applications/connected-apps",
    adminConnectedAppsResponseSchema,
  )
}

export async function getAdminConnectedAppDetail(
  appId: string,
): Promise<AdminConnectedAppDetail | null> {
  return getNullableAdminData(
    `/api/admin/applications/connected-apps/${encodeURIComponent(appId)}`,
    adminConnectedAppDetailSchema,
  )
}

export async function getAdminSettings() {
  return getAdminData("/api/admin/settings", adminSettingsResponseSchema)
}

export async function getAdminTeamOverview() {
  return getAdminData("/api/admin/team", adminTeamOverviewResponseSchema)
}

export async function getAdminTeamMemberDetail(memberId: string) {
  return getNullableAdminData(
    `/api/admin/team/members/${encodeURIComponent(memberId)}`,
    adminTeamMemberDetailSchema,
  )
}

async function getAdminData<T>(
  path: string,
  schema: { parse: (value: unknown) => T },
) {
  const bffRequest = await getBffRequest()
  if (bffRequest.state === "terminal") {
    throw new ConsoleBffAuthExpiredError(path)
  }
  if (bffRequest.state === "unavailable") {
    throw new ConsoleBffUnavailableError(path)
  }

  try {
    const response = await fetch(`${bffRequest.baseUrl}${path}`, {
      cache: "no-store",
      headers: bffRequest.headers,
    })

    if (!response.ok) {
      if (response.status === 401) {
        throw new ConsoleBffAuthExpiredError(path)
      }
      if (response.status === 503) {
        throw new ConsoleBffUnavailableError(path)
      }
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

async function getNullableAdminData<T>(
  path: string,
  schema: { parse: (value: unknown) => T },
) {
  const bffRequest = await getBffRequest()
  if (bffRequest.state === "terminal") {
    throw new ConsoleBffAuthExpiredError(path)
  }
  if (bffRequest.state === "unavailable") {
    throw new ConsoleBffUnavailableError(path)
  }

  try {
    const response = await fetch(`${bffRequest.baseUrl}${path}`, {
      cache: "no-store",
      headers: bffRequest.headers,
    })

    if (response.status === 401) {
      throw new ConsoleBffAuthExpiredError(path)
    }
    if (response.status === 503) {
      throw new ConsoleBffUnavailableError(path)
    }
    if (response.status === 403 || response.status === 404) {
      return null
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
