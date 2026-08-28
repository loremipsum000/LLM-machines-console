export type InferenceCoreRole = "admin" | "operator"

export type KeycloakAdminServiceStatus =
  | "invalid"
  | "not_configured"
  | "unauthorized"
  | "unavailable"

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
  | {
      config: null
      missing: []
      status: "invalid"
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

export interface KeycloakLiveHumanAuthority {
  enabled: boolean
  role: InferenceCoreRole
  subject: string
}

export type LiveHumanAuthorityResult =
  | {
      authority: KeycloakLiveHumanAuthority
      status: "ok"
    }
  | {
      authority: null
      reason:
        | "ambiguous_role"
        | "invalid_role_case"
        | "invalid_subject"
        | "unclassified_role"
      status: "denied"
    }
  | {
      authority: null
      reason: "authority_unavailable"
      status: KeycloakAdminServiceStatus
    }

export type RetainedRoleClassification =
  | { role: InferenceCoreRole; status: "classified" }
  | { role: null; status: "ambiguous" }
  | { role: null; status: "invalid_case" }
  | { role: null; status: "unclassified" }

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

export interface KeycloakConfidentialClient {
  clientId: string
  id: string
}

export interface CreateKeycloakUserInput {
  displayName: string
  email: string
  enabled: boolean
  username: string
}

export class KeycloakAdminError extends Error {
  constructor(
    readonly status: Exclude<KeycloakAdminServiceStatus, "not_configured">,
    message: string,
    readonly mutationOutcome?: "rejected" | "unknown",
  ) {
    super(message)
    this.name = "KeycloakAdminError"
  }
}

class KeycloakHumanAuthorityError extends KeycloakAdminError {
  constructor(
    readonly reason:
      | "ambiguous_role"
      | "invalid_role_case"
      | "unclassified_role",
    message: string,
  ) {
    super("invalid", message)
    this.name = "KeycloakHumanAuthorityError"
  }
}

interface TokenCache {
  accessToken: string
  expiresAt: number
}

interface PendingKeycloakResponse {
  dispose(): void
  response: Response
  signal: AbortSignal
}

type FetchLike = typeof fetch

const KEYCLOAK_ADMIN_RESPONSE_MAX_BYTES = 2 * 1024 * 1024
const KEYCLOAK_APPLICATION_CLIENT_ID_PATTERN =
  /^llmm-app-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const KEYCLOAK_USER_GROUP_PAGE_SIZE = 100
const KEYCLOAK_USER_GROUP_LIMIT = 1_000
const KEYCLOAK_HUMAN_ADMIN_REALM = "llm-machines"
const KEYCLOAK_APPLICATION_ADMIN_REALM = "llm-machines-applications"
const KEYCLOAK_APPLICATION_AUDIENCE = "console-bff"
export const KEYCLOAK_HUMAN_ADMIN_CLIENT_ID = "console-human-admin"
export const KEYCLOAK_APPLICATION_ADMIN_CLIENT_ID = "console-application-admin"

abstract class KeycloakAdminApiClient {
  private tokenCache: TokenCache | null = null

  protected constructor(
    protected readonly config: KeycloakAdminConfig,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly now: () => number = () => Date.now(),
    private readonly operationSignal?: AbortSignal,
  ) {}

  protected async requestJson<T>(path: string, init: RequestInit): Promise<T> {
    const pending = await this.requestResponse(path, init)
    try {
      if (pending.response.status === 204) {
        return null as T
      }
      return (await boundedResponseJson(pending.response, pending.signal)) as T
    } catch {
      const isMutation = init.method !== "GET" && init.method !== "HEAD"
      if (pending.signal.aborted) {
        throw new KeycloakAdminError(
          "unavailable",
          isMutation
            ? "Keycloak mutation outcome could not be confirmed."
            : "Keycloak Admin API is unavailable.",
          isMutation ? "unknown" : undefined,
        )
      }
      throw new KeycloakAdminError(
        "invalid",
        "Keycloak Admin API returned an invalid JSON response.",
        isMutation ? "unknown" : undefined,
      )
    } finally {
      pending.dispose()
    }
  }

  protected async request(path: string, init: RequestInit): Promise<Response> {
    const pending = await this.requestResponse(path, init)
    void pending.response.body?.cancel().catch(() => undefined)
    pending.dispose()
    return pending.response
  }

  private async requestResponse(
    path: string,
    init: RequestInit,
  ): Promise<PendingKeycloakResponse> {
    const isMutation = init.method !== "GET" && init.method !== "HEAD"
    let token: string
    try {
      token = await this.adminToken()
    } catch (error) {
      if (isMutation) {
        throw new KeycloakAdminError(
          error instanceof KeycloakAdminError ? error.status : "unavailable",
          "Keycloak mutation was rejected before it was sent.",
          "rejected",
        )
      }
      if (error instanceof KeycloakAdminError) {
        throw error
      }
      throw new KeycloakAdminError(
        "unavailable",
        "Keycloak Admin API authentication is unavailable.",
      )
    }

    let response: Response
    const abort = keycloakRequestAbort(init.signal, this.operationSignal)
    try {
      response = await this.fetchImpl(`${adminBaseUrl(this.config)}${path}`, {
        ...init,
        headers: {
          ...(init.headers ?? {}),
          authorization: `Bearer ${token}`,
        },
        redirect: "error",
        signal: abort.signal,
      })
    } catch {
      abort.dispose()
      throw new KeycloakAdminError(
        "unavailable",
        isMutation
          ? "Keycloak mutation outcome could not be confirmed."
          : "Keycloak Admin API is unavailable.",
        isMutation ? "unknown" : undefined,
      )
    }
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined)
      abort.dispose()
      throw statusError(response.status, isMutation)
    }
    return {
      dispose: abort.dispose,
      response,
      signal: abort.signal,
    }
  }

  private async adminToken(): Promise<string> {
    if (this.tokenCache && this.tokenCache.expiresAt > this.now() + 10_000) {
      return this.tokenCache.accessToken
    }

    const abort = keycloakRequestAbort(this.operationSignal)
    let response: Response
    try {
      response = await this.fetchImpl(tokenUrl(this.config), {
        body: new URLSearchParams({
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
          grant_type: "client_credentials",
        }),
        headers: {
          "content-type": "application/x-www-form-urlencoded",
        },
        method: "POST",
        redirect: "error",
        signal: abort.signal,
      })
    } catch {
      abort.dispose()
      throw new KeycloakAdminError(
        "unavailable",
        "Keycloak Admin API authentication is unavailable.",
      )
    }
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined)
      abort.dispose()
      throw statusError(response.status)
    }
    let payload: unknown
    try {
      payload = await boundedResponseJson(response, abort.signal)
    } catch {
      if (abort.signal.aborted) {
        throw new KeycloakAdminError(
          "unavailable",
          "Keycloak Admin API authentication is unavailable.",
        )
      }
      throw new KeycloakAdminError(
        "invalid",
        "Invalid Keycloak token response.",
      )
    } finally {
      abort.dispose()
    }
    if (!isRecord(payload) || typeof payload.access_token !== "string") {
      throw new KeycloakAdminError(
        "invalid",
        "Invalid Keycloak token response.",
      )
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

export class KeycloakAdminClient extends KeycloakAdminApiClient {
  constructor(
    config: KeycloakAdminConfig,
    fetchImpl: FetchLike = fetch,
    now: () => number = () => Date.now(),
    operationSignal?: AbortSignal,
  ) {
    super(config, fetchImpl, now, operationSignal)
  }

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
    const groups: KeycloakAdminGroup[] = []
    const path = `/users/${encodeURIComponent(id)}/groups`
    for (
      let first = 0;
      first < KEYCLOAK_USER_GROUP_LIMIT;
      first += KEYCLOAK_USER_GROUP_PAGE_SIZE
    ) {
      const rows = await this.requestJson<unknown[]>(
        `${path}?first=${first}&max=${KEYCLOAK_USER_GROUP_PAGE_SIZE}`,
        { method: "GET" },
      )
      groups.push(...rows.filter(isRecord).map(groupFromKeycloak))
      if (rows.length < KEYCLOAK_USER_GROUP_PAGE_SIZE) {
        return groups
      }
    }

    const overflow = await this.requestJson<unknown[]>(
      `${path}?first=${KEYCLOAK_USER_GROUP_LIMIT}&max=1`,
      { method: "GET" },
    )
    if (overflow.length > 0) {
      throw new KeycloakAdminError(
        "unavailable",
        "Keycloak user group membership exceeds the bounded verification limit.",
      )
    }
    return groups
  }

  async getUserEffectiveRealmRoles(id: string): Promise<KeycloakAdminRole[]> {
    const rows = await this.requestJson<unknown[]>(
      `/users/${encodeURIComponent(id)}/role-mappings/realm/composite`,
      { method: "GET" },
    )
    return rows.filter(isRecord).map(roleFromKeycloak)
  }

  async getLiveHumanAuthority(id: string): Promise<KeycloakLiveHumanAuthority> {
    const user = await this.getUser(id)
    const roles = await this.getUserEffectiveRealmRoles(id)
    return liveHumanAuthority(user, roles)
  }

  async listLiveHumanAuthorities(): Promise<KeycloakLiveHumanAuthority[]> {
    const users = await this.listUsers()
    const authorities = await Promise.all(
      users.map(async (user) => {
        const roles = await this.getUserEffectiveRealmRoles(user.id)
        const classification = classifyRetainedRealmRoles(
          roles.map((role) => role.name),
        )
        if (
          classification.status === "ambiguous" ||
          classification.status === "invalid_case"
        ) {
          throw retainedRoleClassificationError(user.id, classification.status)
        }
        return classification.status === "classified"
          ? {
              enabled: user.enabled,
              role: classification.role,
              subject: user.id,
            }
          : null
      }),
    )
    return authorities.filter(
      (authority): authority is KeycloakLiveHumanAuthority =>
        authority !== null,
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
}

export class KeycloakApplicationAdminClient extends KeycloakAdminApiClient {
  constructor(
    config: KeycloakAdminConfig,
    fetchImpl: FetchLike = fetch,
    now: () => number = () => Date.now(),
    operationSignal?: AbortSignal,
  ) {
    super(config, fetchImpl, now, operationSignal)
    if (
      config.realm !== KEYCLOAK_APPLICATION_ADMIN_REALM ||
      config.audience !== KEYCLOAK_APPLICATION_AUDIENCE
    ) {
      throw new KeycloakAdminError(
        "invalid",
        "Keycloak Application administration configuration is invalid.",
      )
    }
  }

  async findConfidentialClient(
    clientId: string,
  ): Promise<KeycloakConfidentialClient | null> {
    const exactClientId = applicationClientId(clientId)
    const rows = await this.requestJson<unknown>(
      `/clients?clientId=${encodeURIComponent(exactClientId)}&exact=true&max=2`,
      { method: "GET" },
    )
    if (!Array.isArray(rows)) {
      throw new KeycloakAdminError(
        "invalid",
        "Keycloak client lookup returned an invalid response.",
      )
    }
    const clients = rows.map(confidentialClientFromKeycloak)
    if (
      clients.length > 1 ||
      clients.some((client) => client.clientId !== exactClientId)
    ) {
      throw new KeycloakAdminError(
        "invalid",
        `Keycloak client lookup was not exact for ${exactClientId}.`,
      )
    }
    return clients[0] ?? null
  }

  async createConfidentialClient(
    input: CreateKeycloakClientInput,
  ): Promise<KeycloakConfidentialClientCredential> {
    const existing = await this.preflightClientMutation(
      null,
      input.clientId,
      "creation",
    )
    if (existing) {
      throw new KeycloakAdminError(
        "invalid",
        `Keycloak client ${input.clientId} already exists.`,
        "rejected",
      )
    }

    let response: Response
    try {
      response = await this.request("/clients", {
        body: JSON.stringify({
          authorizationServicesEnabled: false,
          clientId: input.clientId,
          defaultClientScopes: [],
          description: input.description,
          directAccessGrantsEnabled: false,
          enabled: true,
          fullScopeAllowed: false,
          implicitFlowEnabled: false,
          name: input.name,
          optionalClientScopes: [],
          protocol: "openid-connect",
          publicClient: false,
          serviceAccountsEnabled: true,
          standardFlowEnabled: false,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      })
    } catch (error) {
      if (
        error instanceof KeycloakAdminError &&
        error.mutationOutcome === "rejected"
      ) {
        throw error
      }
      throw unknownClientMutation("creation", input.clientId)
    }

    const locationResourceId = locationId(
      response.headers.get("location") ?? "",
    )
    let confirmedClient: KeycloakConfidentialClient | null
    try {
      confirmedClient = await this.findConfidentialClient(input.clientId)
    } catch {
      throw unknownClientMutation("creation", input.clientId)
    }
    if (
      !locationResourceId ||
      !confirmedClient ||
      confirmedClient.id !== locationResourceId
    ) {
      throw unknownClientMutation("creation", input.clientId)
    }
    const id = confirmedClient.id

    try {
      await this.addAudienceMapper(id)
      const clientSecret = await this.getClientSecret(id)
      return {
        clientId: input.clientId,
        clientSecret,
        id,
        tokenUrl: tokenUrl(this.config),
      }
    } catch (error) {
      try {
        await this.request(`/clients/${encodeURIComponent(id)}`, {
          method: "DELETE",
        })
      } catch {
        throw unknownClientMutation("provisioning", input.clientId)
      }
      throw new KeycloakAdminError(
        error instanceof KeycloakAdminError ? error.status : "unavailable",
        `Keycloak client ${input.clientId} provisioning was rolled back before completion.`,
        "rejected",
      )
    }
  }

  async deleteConfidentialClient(id: string, clientId: string): Promise<void> {
    await this.preflightClientMutation(id, clientId, "deletion")
    await this.request(`/clients/${encodeURIComponent(id)}`, {
      method: "DELETE",
    })
  }

  private async preflightClientMutation(
    expectedId: string | null,
    clientId: string,
    operation: string,
  ): Promise<KeycloakConfidentialClient | null> {
    let client: KeycloakConfidentialClient | null
    try {
      client = await this.findConfidentialClient(clientId)
    } catch (error) {
      throw new KeycloakAdminError(
        error instanceof KeycloakAdminError ? error.status : "unavailable",
        `Keycloak client ${operation} was rejected before it was sent because exact lookup failed.`,
        "rejected",
      )
    }
    if (expectedId !== null && (!client || client.id !== expectedId)) {
      throw new KeycloakAdminError(
        "invalid",
        `Keycloak client ${operation} was rejected because the exact client ID and internal ID did not match.`,
        "rejected",
      )
    }
    return client
  }

  private async addAudienceMapper(id: string): Promise<void> {
    await this.request(
      `/clients/${encodeURIComponent(id)}/protocol-mappers/models`,
      {
        body: JSON.stringify({
          config: {
            "access.token.claim": "true",
            "id.token.claim": "false",
            "included.custom.audience": KEYCLOAK_APPLICATION_AUDIENCE,
            "introspection.token.claim": "true",
            "lightweight.claim": "false",
          },
          name: `${KEYCLOAK_APPLICATION_AUDIENCE}-audience`,
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
  const realm = required.KEYCLOAK_ADMIN_REALM?.trim() ?? ""
  const clientId = required.KEYCLOAK_ADMIN_CLIENT_ID?.trim() ?? ""
  const baseUrl = normalizeKeycloakAdminBaseUrl(
    required.KEYCLOAK_ADMIN_BASE_URL?.trim() ?? "",
  )
  if (
    baseUrl === null ||
    realm !== KEYCLOAK_HUMAN_ADMIN_REALM ||
    clientId !== KEYCLOAK_HUMAN_ADMIN_CLIENT_ID
  ) {
    return { config: null, missing: [], status: "invalid" }
  }

  return {
    config: {
      allowedEmailDomains: commaList(env.TEAM_ALLOWED_EMAIL_DOMAINS),
      audience: env.KEYCLOAK_AUDIENCE?.trim() || undefined,
      baseUrl,
      clientId,
      clientSecret: required.KEYCLOAK_ADMIN_CLIENT_SECRET?.trim() ?? "",
      realm,
    },
    missing: [],
    status: "ok",
  }
}

export function keycloakAdminClientFromEnv(
  env: NodeJS.ProcessEnv = process.env,
):
  | { client: KeycloakAdminClient; status: "ok" }
  | { client: null; status: "invalid" | "not_configured" } {
  const result = keycloakAdminConfigFromEnv(env)
  if (result.status !== "ok") {
    return { client: null, status: result.status }
  }
  return { client: new KeycloakAdminClient(result.config), status: "ok" }
}

export function keycloakApplicationAdminConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): KeycloakAdminConfigResult {
  const required = {
    KEYCLOAK_ADMIN_BASE_URL: env.KEYCLOAK_ADMIN_BASE_URL,
    KEYCLOAK_APPLICATION_ADMIN_REALM: env.KEYCLOAK_APPLICATION_ADMIN_REALM,
    KEYCLOAK_APPLICATION_ADMIN_CLIENT_ID:
      env.KEYCLOAK_APPLICATION_ADMIN_CLIENT_ID,
    KEYCLOAK_APPLICATION_ADMIN_CLIENT_SECRET:
      env.KEYCLOAK_APPLICATION_ADMIN_CLIENT_SECRET,
    KEYCLOAK_AUDIENCE: env.KEYCLOAK_AUDIENCE,
  }
  const missing = Object.entries(required)
    .filter(([, value]) => !value?.trim())
    .map(([key]) => key)
  if (missing.length > 0) {
    return { config: null, missing, status: "not_configured" }
  }

  const clientId = required.KEYCLOAK_APPLICATION_ADMIN_CLIENT_ID?.trim() ?? ""
  const realm = required.KEYCLOAK_APPLICATION_ADMIN_REALM?.trim() ?? ""
  const audience = required.KEYCLOAK_AUDIENCE?.trim() ?? ""
  const baseUrl = normalizeKeycloakAdminBaseUrl(
    required.KEYCLOAK_ADMIN_BASE_URL?.trim() ?? "",
  )
  if (
    baseUrl === null ||
    realm !== KEYCLOAK_APPLICATION_ADMIN_REALM ||
    audience !== KEYCLOAK_APPLICATION_AUDIENCE ||
    clientId !== KEYCLOAK_APPLICATION_ADMIN_CLIENT_ID
  ) {
    return { config: null, missing: [], status: "invalid" }
  }

  return {
    config: {
      allowedEmailDomains: [],
      audience,
      baseUrl,
      clientId,
      clientSecret:
        required.KEYCLOAK_APPLICATION_ADMIN_CLIENT_SECRET?.trim() ?? "",
      realm,
    },
    missing: [],
    status: "ok",
  }
}

export function keycloakApplicationAdminClientFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  operationSignal?: AbortSignal,
):
  | { client: KeycloakApplicationAdminClient; status: "ok" }
  | { client: null; status: "invalid" | "not_configured" } {
  const result = keycloakApplicationAdminConfigFromEnv(env)
  if (result.status !== "ok") {
    return { client: null, status: result.status }
  }
  return {
    client: new KeycloakApplicationAdminClient(
      result.config,
      undefined,
      undefined,
      operationSignal,
    ),
    status: "ok",
  }
}

export async function resolveLiveHumanAuthority(
  subject: string,
  options: {
    env?: NodeJS.ProcessEnv
    fetchImpl?: FetchLike
  } = {},
): Promise<LiveHumanAuthorityResult> {
  if (!subject.trim()) {
    return { authority: null, reason: "invalid_subject", status: "denied" }
  }
  const configResult = keycloakAdminConfigFromEnv(options.env)
  if (configResult.status !== "ok") {
    return {
      authority: null,
      reason: "authority_unavailable",
      status: configResult.status,
    }
  }

  try {
    return {
      authority: await new KeycloakAdminClient(
        configResult.config,
        options.fetchImpl,
      ).getLiveHumanAuthority(subject),
      status: "ok",
    }
  } catch (error) {
    if (error instanceof KeycloakHumanAuthorityError) {
      return { authority: null, reason: error.reason, status: "denied" }
    }
    return {
      authority: null,
      reason: "authority_unavailable",
      status:
        error instanceof KeycloakAdminError ? error.status : "unavailable",
    }
  }
}

export function classifyRetainedRealmRoles(
  roles: string[],
): RetainedRoleClassification {
  if (
    roles.some((role) => {
      const normalized = role.toLowerCase()
      return (
        (normalized === "admin" || normalized === "operator") &&
        role !== normalized
      )
    })
  ) {
    return { role: null, status: "invalid_case" }
  }
  const normalized = new Set(roles)
  const retained = (["admin", "operator"] as const).filter((role) =>
    normalized.has(role),
  )
  if (retained.length === 0) {
    return { role: null, status: "unclassified" }
  }
  if (retained.length > 1) {
    return { role: null, status: "ambiguous" }
  }
  return { role: retained[0] ?? "operator", status: "classified" }
}

export function roleFromRealmRoles(roles: string[]): InferenceCoreRole | null {
  const classification = classifyRetainedRealmRoles(roles)
  return classification.status === "classified" ? classification.role : null
}

function liveHumanAuthority(
  user: KeycloakAdminUser,
  roles: KeycloakAdminRole[],
): KeycloakLiveHumanAuthority {
  const classification = classifyRetainedRealmRoles(
    roles.map((role) => role.name),
  )
  if (
    classification.status === "ambiguous" ||
    classification.status === "invalid_case"
  ) {
    throw retainedRoleClassificationError(user.id, classification.status)
  }
  if (classification.status === "unclassified") {
    throw new KeycloakHumanAuthorityError(
      "unclassified_role",
      `Keycloak user ${user.id} does not have exactly one retained appliance role.`,
    )
  }
  return {
    enabled: user.enabled,
    role: classification.role,
    subject: user.id,
  }
}

function retainedRoleClassificationError(
  subject: string,
  classification: "ambiguous" | "invalid_case",
): KeycloakAdminError {
  return new KeycloakHumanAuthorityError(
    classification === "ambiguous" ? "ambiguous_role" : "invalid_role_case",
    classification === "ambiguous"
      ? `Keycloak user ${subject} has ambiguous retained appliance roles.`
      : `Keycloak user ${subject} has a retained appliance role with invalid casing.`,
  )
}

function userFromKeycloak(row: Record<string, unknown>): KeycloakAdminUser {
  const id = stringField(row, "id")
  if (!id || typeof row.enabled !== "boolean") {
    throw new KeycloakAdminError(
      "invalid",
      "Keycloak Admin API returned an invalid user authority response.",
    )
  }
  const first = stringField(row, "firstName")
  const last = stringField(row, "lastName")
  return {
    createdAt: createdAtFromKeycloak(row.createdTimestamp),
    displayName:
      [first, last].filter(Boolean).join(" ").trim() ||
      stringField(row, "username") ||
      "Unknown user",
    email: stringField(row, "email") ?? "unknown@local.invalid",
    enabled: row.enabled,
    firstName: first,
    id,
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

function confidentialClientFromKeycloak(
  value: unknown,
): KeycloakConfidentialClient {
  if (!isRecord(value)) {
    throw new KeycloakAdminError(
      "invalid",
      "Keycloak client lookup returned a malformed client.",
    )
  }
  const clientId = stringField(value, "clientId")
  const id = stringField(value, "id")
  if (!clientId || !id) {
    throw new KeycloakAdminError(
      "invalid",
      "Keycloak client lookup returned a malformed client.",
    )
  }
  return { clientId, id }
}

function locationId(location: string): string | null {
  const encoded = location.split("/").filter(Boolean).at(-1)
  if (!encoded) {
    return null
  }
  try {
    return decodeURIComponent(encoded)
  } catch {
    return null
  }
}

function unknownClientMutation(
  operation: string,
  clientId: string,
): KeycloakAdminError {
  return new KeycloakAdminError(
    "unavailable",
    `Keycloak client ${operation} could not be confirmed. Reconcile client ${clientId} before retrying with the same idempotency key.`,
    "unknown",
  )
}

function roleFromKeycloak(row: Record<string, unknown>): KeycloakAdminRole {
  const name = stringField(row, "name")
  if (!name) {
    throw new KeycloakAdminError(
      "invalid",
      "Keycloak Admin API returned a malformed realm role.",
    )
  }
  return {
    id: stringField(row, "id") ?? name,
    name,
  }
}

function statusError(status: number, isMutation = false): KeycloakAdminError {
  const mutationOutcome = isMutation
    ? status >= 500
      ? "unknown"
      : "rejected"
    : undefined
  if (status === 401 || status === 403) {
    return new KeycloakAdminError(
      "unauthorized",
      "Keycloak Admin API rejected Console credentials.",
      mutationOutcome,
    )
  }
  if (status >= 500) {
    return new KeycloakAdminError(
      "unavailable",
      "Keycloak Admin API is unavailable.",
      mutationOutcome,
    )
  }
  return new KeycloakAdminError(
    "invalid",
    "Keycloak Admin API request failed.",
    mutationOutcome,
  )
}

function adminBaseUrl(config: KeycloakAdminConfig): string {
  return `${config.baseUrl}/admin/realms/${encodeURIComponent(config.realm)}`
}

function tokenUrl(config: KeycloakAdminConfig): string {
  return `${config.baseUrl}/realms/${encodeURIComponent(config.realm)}/protocol/openid-connect/token`
}

function keycloakRequestAbort(
  ...signals: Array<AbortSignal | null | undefined>
): { dispose(): void; signal: AbortSignal } {
  const controller = new AbortController()
  const sources = signals.filter(
    (signal): signal is AbortSignal => signal !== null && signal !== undefined,
  )
  const listeners = sources.map((source) => {
    const listener = () => controller.abort(source.reason)
    source.addEventListener("abort", listener, { once: true })
    if (source.aborted) {
      listener()
    }
    return { listener, source }
  })
  const timer = setTimeout(() => {
    controller.abort(new Error("Keycloak Admin API request timed out."))
  }, 5_000)
  return {
    dispose: () => {
      clearTimeout(timer)
      for (const { listener, source } of listeners) {
        source.removeEventListener("abort", listener)
      }
    },
    signal: controller.signal,
  }
}

async function boundedResponseJson(
  response: Response,
  signal: AbortSignal,
): Promise<unknown> {
  const contentLength = response.headers.get("content-length")
  if (contentLength !== null) {
    const declaredBytes = Number(contentLength)
    if (
      !Number.isSafeInteger(declaredBytes) ||
      declaredBytes < 0 ||
      declaredBytes > KEYCLOAK_ADMIN_RESPONSE_MAX_BYTES
    ) {
      void response.body?.cancel().catch(() => undefined)
      throw new Error("Keycloak response size is invalid.")
    }
  }

  if (!response.body) {
    return JSON.parse("")
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  try {
    while (true) {
      const chunk = await readResponseChunk(reader, signal)
      if (chunk.done) {
        break
      }
      totalBytes += chunk.value.byteLength
      if (totalBytes > KEYCLOAK_ADMIN_RESPONSE_MAX_BYTES) {
        throw new Error("Keycloak response exceeded its byte limit.")
      }
      chunks.push(chunk.value)
    }
  } catch (error) {
    void reader.cancel().catch(() => undefined)
    throw error
  } finally {
    reader.releaseLock()
  }

  const body = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return JSON.parse(new TextDecoder().decode(body))
}

function readResponseChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
): Promise<
  { done: false; value: Uint8Array } | { done: true; value?: Uint8Array }
> {
  if (signal.aborted) {
    return Promise.reject(signal.reason)
  }
  return new Promise((resolve, reject) => {
    const aborted = () => reject(signal.reason)
    signal.addEventListener("abort", aborted, { once: true })
    reader
      .read()
      .then(resolve, reject)
      .finally(() => {
        signal.removeEventListener("abort", aborted)
      })
  })
}

function applicationClientId(clientId: string): string {
  if (!KEYCLOAK_APPLICATION_CLIENT_ID_PATTERN.test(clientId)) {
    throw new KeycloakAdminError(
      "invalid",
      "Keycloak Application client ID is outside the llmm-app-UUID namespace.",
    )
  }
  return clientId
}

function normalizeKeycloakAdminBaseUrl(value: string): string | null {
  const candidate = value.trim()
  if (!candidate || candidate.includes("?") || candidate.includes("#")) {
    return null
  }

  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    return null
  }

  const authority = candidate.slice(candidate.indexOf("://") + 3).split("/")[0]
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    !url.hostname ||
    url.username !== "" ||
    url.password !== "" ||
    authority?.includes("@") ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    return null
  }

  return url.toString().replace(/\/+$/, "")
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
