import type { AdminTeamServiceStatus, Persona } from "@llm-machines/contracts"

export interface KeycloakAdminConfig {
  allowedEmailDomains: string[]
  audience?: string
  baseUrl: string
  clientId: string
  clientSecret: string
  realm: string
}

export type KeycloakAdminConfigResult =
  | {
      config: KeycloakAdminConfig
      missing: []
      status: "ok"
    }
  | {
      config: null
      missing: string[]
      status: "not_configured"
    }

export interface KeycloakAdminUser {
  createdAt: string | null
  displayName: string
  email: string
  enabled: boolean
  firstName: string | null
  id: string
  lastName: string | null
  username: string
}

export interface KeycloakAdminGroup {
  id: string
  name: string
  path: string
}

export interface KeycloakAdminRole {
  id: string
  name: string
}

export interface CreateKeycloakClientInput {
  clientId: string
  description: string
  name: string
}

export interface KeycloakConfidentialClientCredential {
  clientId: string
  clientSecret: string
  id: string
  tokenUrl: string
}

export interface CreateKeycloakUserInput {
  displayName: string
  email: string
  enabled: boolean
  username: string
}

export class KeycloakAdminError extends Error {
  constructor(
    readonly status: Exclude<AdminTeamServiceStatus, "ok">,
    message: string,
  ) {
    super(message)
    this.name = "KeycloakAdminError"
  }
}

interface TokenCache {
  accessToken: string
  expiresAt: number
}

type FetchLike = typeof fetch

export class KeycloakAdminClient {
  private tokenCache: TokenCache | null = null

  constructor(
    private readonly config: KeycloakAdminConfig,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async listUsers(): Promise<KeycloakAdminUser[]> {
    const rows = await this.requestJson<unknown[]>("/users?max=500", {
      method: "GET",
    })
    return rows.filter(isRecord).map(userFromKeycloak)
  }

  async getUser(id: string): Promise<KeycloakAdminUser> {
    return userFromKeycloak(
      await this.requestJson(`/users/${encodeURIComponent(id)}`, {
        method: "GET",
      }),
    )
  }

  async createUser(input: CreateKeycloakUserInput): Promise<string> {
    const response = await this.request("/users", {
      body: JSON.stringify({
        email: input.email,
        emailVerified: true,
        enabled: input.enabled,
        firstName: firstName(input.displayName),
        lastName: lastName(input.displayName),
        requiredActions: [],
        username: input.username,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
    const location = response.headers.get("location") ?? ""
    return location.split("/").filter(Boolean).at(-1) ?? input.username
  }

  async updateUserEnabled(id: string, enabled: boolean): Promise<void> {
    await this.request(`/users/${encodeURIComponent(id)}`, {
      body: JSON.stringify({ enabled }),
      headers: { "content-type": "application/json" },
      method: "PUT",
    })
  }

  async deleteUser(id: string): Promise<void> {
    await this.request(`/users/${encodeURIComponent(id)}`, {
      method: "DELETE",
    })
  }

  async setPassword(id: string, password: string): Promise<void> {
    await this.request(`/users/${encodeURIComponent(id)}/reset-password`, {
      body: JSON.stringify({
        temporary: false,
        type: "password",
        value: password,
      }),
      headers: { "content-type": "application/json" },
      method: "PUT",
    })
  }

  async executeEmailActions(id: string, actions: string[]): Promise<void> {
    await this.request(
      `/users/${encodeURIComponent(id)}/execute-actions-email`,
      {
        body: JSON.stringify(actions),
        headers: { "content-type": "application/json" },
        method: "PUT",
      },
    )
  }

  async listGroups(): Promise<KeycloakAdminGroup[]> {
    const rows = await this.requestJson<unknown[]>("/groups?max=500", {
      method: "GET",
    })
    return rows.filter(isRecord).map(groupFromKeycloak)
  }

  async getGroup(id: string): Promise<KeycloakAdminGroup> {
    return groupFromKeycloak(
      await this.requestJson(`/groups/${encodeURIComponent(id)}`, {
        method: "GET",
      }),
    )
  }

  async createGroup(name: string): Promise<string> {
    const response = await this.request("/groups", {
      body: JSON.stringify({ name }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
    const location = response.headers.get("location") ?? ""
    return location.split("/").filter(Boolean).at(-1) ?? name
  }

  async updateGroup(id: string, name: string): Promise<void> {
    await this.request(`/groups/${encodeURIComponent(id)}`, {
      body: JSON.stringify({ name }),
      headers: { "content-type": "application/json" },
      method: "PUT",
    })
  }

  async deleteGroup(id: string): Promise<void> {
    await this.request(`/groups/${encodeURIComponent(id)}`, {
      method: "DELETE",
    })
  }

  async getGroupMembers(id: string): Promise<KeycloakAdminUser[]> {
    const rows = await this.requestJson<unknown[]>(
      `/groups/${encodeURIComponent(id)}/members?max=500`,
      { method: "GET" },
    )
    return rows.filter(isRecord).map(userFromKeycloak)
  }

  async getUserGroups(id: string): Promise<KeycloakAdminGroup[]> {
    const rows = await this.requestJson<unknown[]>(
      `/users/${encodeURIComponent(id)}/groups`,
      { method: "GET" },
    )
    return rows.filter(isRecord).map(groupFromKeycloak)
  }

  async getUserRealmRoles(id: string): Promise<KeycloakAdminRole[]> {
    const rows = await this.requestJson<unknown[]>(
      `/users/${encodeURIComponent(id)}/role-mappings/realm`,
      { method: "GET" },
    )
    return rows.filter(isRecord).map(roleFromKeycloak)
  }

  async getRealmRole(name: Persona): Promise<KeycloakAdminRole> {
    return roleFromKeycloak(
      await this.requestJson(
        `/roles/${encodeURIComponent(name)}`,
        { method: "GET" },
      ),
    )
  }

  async assignRealmRole(userId: string, role: KeycloakAdminRole): Promise<void> {
    await this.request(
      `/users/${encodeURIComponent(userId)}/role-mappings/realm`,
      {
        body: JSON.stringify([{ id: role.id, name: role.name }]),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    )
  }

  async joinGroup(userId: string, groupId: string): Promise<void> {
    await this.request(
      `/users/${encodeURIComponent(userId)}/groups/${encodeURIComponent(groupId)}`,
      { method: "PUT" },
    )
  }

  async leaveGroup(userId: string, groupId: string): Promise<void> {
    await this.request(
      `/users/${encodeURIComponent(userId)}/groups/${encodeURIComponent(groupId)}`,
      { method: "DELETE" },
    )
  }

  async createConfidentialClient(
    input: CreateKeycloakClientInput,
  ): Promise<KeycloakConfidentialClientCredential> {
    const response = await this.request("/clients", {
      body: JSON.stringify({
        clientId: input.clientId,
        description: input.description,
        directAccessGrantsEnabled: false,
        enabled: true,
        name: input.name,
        protocol: "openid-connect",
        publicClient: false,
        serviceAccountsEnabled: true,
        standardFlowEnabled: false,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
    const location = response.headers.get("location") ?? ""
    const id = location.split("/").filter(Boolean).at(-1) ?? input.clientId
    await this.addAudienceMapper(id)
    const clientSecret = await this.getClientSecret(id)
    return {
      clientId: input.clientId,
      clientSecret,
      id,
      tokenUrl: tokenUrl(this.config),
    }
  }

  async rotateConfidentialClientSecret(
    id: string,
    clientId: string,
  ): Promise<KeycloakConfidentialClientCredential> {
    const payload = await this.requestJson<Record<string, unknown>>(
      `/clients/${encodeURIComponent(id)}/client-secret`,
      {
        method: "POST",
      },
    )
    const clientSecret = stringField(payload, "value")
    if (!clientSecret) {
      throw new KeycloakAdminError(
        "invalid",
        "Invalid Keycloak client secret response.",
      )
    }
    return {
      clientId,
      clientSecret,
      id,
      tokenUrl: tokenUrl(this.config),
    }
  }

  private async addAudienceMapper(id: string): Promise<void> {
    if (!this.config.audience) {
      return
    }
    await this.request(
      `/clients/${encodeURIComponent(id)}/protocol-mappers/models`,
      {
        body: JSON.stringify({
          config: {
            "access.token.claim": "true",
            "id.token.claim": "false",
            "included.client.audience": this.config.audience,
          },
          name: `${this.config.audience}-audience`,
          protocol: "openid-connect",
          protocolMapper: "oidc-audience-mapper",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    )
  }

  private async getClientSecret(id: string): Promise<string> {
    const payload = await this.requestJson<Record<string, unknown>>(
      `/clients/${encodeURIComponent(id)}/client-secret`,
      { method: "GET" },
    )
    const clientSecret = stringField(payload, "value")
    if (!clientSecret) {
      throw new KeycloakAdminError(
        "invalid",
        "Invalid Keycloak client secret response.",
      )
    }
    return clientSecret
  }

  private async requestJson<T>(
    path: string,
    init: RequestInit,
  ): Promise<T> {
    const response = await this.request(path, init)
    if (response.status === 204) {
      return null as T
    }
    return (await response.json()) as T
  }

  private async request(
    path: string,
    init: RequestInit,
  ): Promise<Response> {
    const token = await this.adminToken()
    const response = await this.fetchImpl(
      `${adminBaseUrl(this.config)}${path}`,
      {
        ...init,
        headers: {
          ...(init.headers ?? {}),
          authorization: `Bearer ${token}`,
        },
      },
    )
    if (!response.ok) {
      throw statusError(response.status)
    }
    return response
  }

  private async adminToken(): Promise<string> {
    if (this.tokenCache && this.tokenCache.expiresAt > this.now() + 10_000) {
      return this.tokenCache.accessToken
    }

    const response = await this.fetchImpl(tokenUrl(this.config), {
      body: new URLSearchParams({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        grant_type: "client_credentials",
      }),
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      method: "POST",
    })
    if (!response.ok) {
      throw statusError(response.status)
    }
    const payload = await response.json()
    if (!isRecord(payload) || typeof payload.access_token !== "string") {
      throw new KeycloakAdminError("invalid", "Invalid Keycloak token response.")
    }
    const expiresIn =
      typeof payload.expires_in === "number" ? payload.expires_in : 60
    this.tokenCache = {
      accessToken: payload.access_token,
      expiresAt: this.now() + expiresIn * 1000,
    }
    return payload.access_token
  }
}

export function keycloakAdminConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): KeycloakAdminConfigResult {
  const required = {
    KEYCLOAK_ADMIN_BASE_URL: env.KEYCLOAK_ADMIN_BASE_URL,
    KEYCLOAK_ADMIN_CLIENT_ID: env.KEYCLOAK_ADMIN_CLIENT_ID,
    KEYCLOAK_ADMIN_CLIENT_SECRET: env.KEYCLOAK_ADMIN_CLIENT_SECRET,
    KEYCLOAK_ADMIN_REALM: env.KEYCLOAK_ADMIN_REALM,
  }
  const missing = Object.entries(required)
    .filter(([, value]) => !value?.trim())
    .map(([key]) => key)
  if (missing.length > 0) {
    return { config: null, missing, status: "not_configured" }
  }

  return {
    config: {
      allowedEmailDomains: commaList(env.TEAM_ALLOWED_EMAIL_DOMAINS),
      audience: env.KEYCLOAK_AUDIENCE?.trim() || undefined,
      baseUrl: trimTrailingSlash(required.KEYCLOAK_ADMIN_BASE_URL ?? ""),
      clientId: required.KEYCLOAK_ADMIN_CLIENT_ID ?? "",
      clientSecret: required.KEYCLOAK_ADMIN_CLIENT_SECRET ?? "",
      realm: required.KEYCLOAK_ADMIN_REALM ?? "",
    },
    missing: [],
    status: "ok",
  }
}

export function keycloakAdminClientFromEnv():
  | { client: KeycloakAdminClient; status: "ok" }
  | { client: null; status: "not_configured" } {
  const result = keycloakAdminConfigFromEnv()
  if (result.status !== "ok") {
    return { client: null, status: "not_configured" }
  }
  return { client: new KeycloakAdminClient(result.config), status: "ok" }
}

export function roleFromRealmRoles(roles: string[]): Persona {
  const normalized = new Set(roles.map((role) => role.toLowerCase()))
  if (normalized.has("admin")) {
    return "admin"
  }
  if (normalized.has("builder")) {
    return "builder"
  }
  return "consumer"
}

function userFromKeycloak(row: Record<string, unknown>): KeycloakAdminUser {
  const first = stringField(row, "firstName")
  const last = stringField(row, "lastName")
  return {
    createdAt: createdAtFromKeycloak(row.createdTimestamp),
    displayName:
      [first, last].filter(Boolean).join(" ").trim() ||
      stringField(row, "username") ||
      "Unknown user",
    email: stringField(row, "email") ?? "unknown@local.invalid",
    enabled: row.enabled !== false,
    firstName: first,
    id: stringField(row, "id") ?? stringField(row, "username") ?? "unknown",
    lastName: last,
    username: stringField(row, "username") ?? "unknown",
  }
}

function groupFromKeycloak(row: Record<string, unknown>): KeycloakAdminGroup {
  const name = stringField(row, "name") ?? "unknown"
  return {
    id: stringField(row, "id") ?? name,
    name,
    path: stringField(row, "path") ?? `/${name}`,
  }
}

function roleFromKeycloak(row: Record<string, unknown>): KeycloakAdminRole {
  const name = stringField(row, "name") ?? "consumer"
  return {
    id: stringField(row, "id") ?? name,
    name,
  }
}

function statusError(status: number): KeycloakAdminError {
  if (status === 401 || status === 403) {
    return new KeycloakAdminError(
      "unauthorized",
      "Keycloak Admin API rejected Console credentials.",
    )
  }
  if (status >= 500) {
    return new KeycloakAdminError(
      "unavailable",
      "Keycloak Admin API is unavailable.",
    )
  }
  return new KeycloakAdminError("invalid", "Keycloak Admin API request failed.")
}

function adminBaseUrl(config: KeycloakAdminConfig): string {
  return `${config.baseUrl}/admin/realms/${encodeURIComponent(config.realm)}`
}

function tokenUrl(config: KeycloakAdminConfig): string {
  return `${config.baseUrl}/realms/${encodeURIComponent(config.realm)}/protocol/openid-connect/token`
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "")
}

function commaList(value: string | undefined): string[] {
  if (!value) {
    return []
  }
  return value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
}

function firstName(displayName: string): string {
  return displayName.trim().split(/\s+/)[0] ?? displayName.trim()
}

function lastName(displayName: string): string {
  const parts = displayName.trim().split(/\s+/)
  return parts.slice(1).join(" ")
}

function createdAtFromKeycloak(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null
  }
  return new Date(value).toISOString()
}

function stringField(
  record: Record<string, unknown>,
  field: string,
): string | null {
  const value = record[field]
  if (typeof value !== "string") {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
