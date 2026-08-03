export interface ConsoleOidcTokenSet {
  accessToken: string
  idToken?: string
  refreshToken: string
}

export type ConsoleOidcTokenResult =
  | { state: "ok"; tokens: ConsoleOidcTokenSet }
  | {
      reason: "identity_restart" | "identity_timeout" | "identity_unavailable"
      state: "unavailable"
    }
  | {
      reason:
        | "invalid_grant"
        | "malformed_response"
        | "refresh_expired"
        | "reuse_detected"
        | "revoked"
      state: "terminal"
    }

export interface ConsoleOidcClient {
  authorizationUrl(input: {
    codeChallenge: string
    elevation: boolean
    nonce: string
    state: string
  }): string
  exchangeCode(
    code: string,
    codeVerifier: string,
  ): Promise<ConsoleOidcTokenResult>
  refresh(refreshToken: string): Promise<ConsoleOidcTokenResult>
  revoke(refreshToken: string): Promise<void>
}

export interface ConsoleOidcClientConfig {
  authorizationEndpoint: string
  clientId: string
  clientSecret: string
  elevationAcrValues?: string
  redirectUri: string
  revocationEndpoint: string
  timeoutMs?: number
  tokenEndpoint: string
}

export function createConsoleOidcClient(
  config: ConsoleOidcClientConfig,
  request: typeof fetch = fetch,
): ConsoleOidcClient {
  assertConfig(config)
  const tokenRequest = async (
    body: URLSearchParams,
  ): Promise<ConsoleOidcTokenResult> => {
    const controller = new AbortController()
    const timeout = setTimeout(
      () => controller.abort(),
      config.timeoutMs ?? 3000,
    )
    try {
      const response = await request(config.tokenEndpoint, {
        body,
        headers: {
          accept: "application/json",
          "content-type": "application/x-www-form-urlencoded",
        },
        method: "POST",
        redirect: "error",
        signal: controller.signal,
      })
      const payload = await boundedJson(response)
      if (response.status >= 500) {
        return {
          reason:
            response.status === 503
              ? "identity_restart"
              : "identity_unavailable",
          state: "unavailable",
        }
      }
      if (!response.ok) {
        return terminalTokenError(payload)
      }
      return parseTokenSet(payload)
    } catch (error) {
      return {
        reason:
          error instanceof Error && error.name === "AbortError"
            ? "identity_timeout"
            : "identity_unavailable",
        state: "unavailable",
      }
    } finally {
      clearTimeout(timeout)
    }
  }

  return {
    authorizationUrl({ codeChallenge, elevation, nonce, state }) {
      const url = new URL(config.authorizationEndpoint)
      const parameters = new URLSearchParams({
        client_id: config.clientId,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
        nonce,
        redirect_uri: config.redirectUri,
        response_type: "code",
        scope: "openid profile email",
        state,
      })
      if (elevation) {
        parameters.set("max_age", "0")
        parameters.set("prompt", "login")
        if (config.elevationAcrValues) {
          parameters.set("acr_values", config.elevationAcrValues)
        }
      }
      url.search = parameters.toString()
      return url.toString()
    },
    exchangeCode(code, codeVerifier) {
      return tokenRequest(
        new URLSearchParams({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          code,
          code_verifier: codeVerifier,
          grant_type: "authorization_code",
          redirect_uri: config.redirectUri,
        }),
      )
    },
    refresh(refreshToken) {
      return tokenRequest(
        new URLSearchParams({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          grant_type: "refresh_token",
          refresh_token: refreshToken,
        }),
      )
    },
    async revoke(refreshToken) {
      const controller = new AbortController()
      const timeout = setTimeout(
        () => controller.abort(),
        config.timeoutMs ?? 3000,
      )
      try {
        const response = await request(config.revocationEndpoint, {
          body: new URLSearchParams({
            client_id: config.clientId,
            client_secret: config.clientSecret,
            token: refreshToken,
            token_type_hint: "refresh_token",
          }),
          headers: { "content-type": "application/x-www-form-urlencoded" },
          method: "POST",
          redirect: "error",
          signal: controller.signal,
        })
        await response.body?.cancel().catch(() => undefined)
      } catch {
        // Local revocation is authoritative; remote revocation is best effort.
      } finally {
        clearTimeout(timeout)
      }
    },
  }
}

function parseTokenSet(payload: unknown): ConsoleOidcTokenResult {
  if (!isRecord(payload)) {
    return { reason: "malformed_response", state: "terminal" }
  }
  const accessToken = stringValue(payload.access_token)
  const refreshToken = stringValue(payload.refresh_token)
  if (!accessToken || !refreshToken) {
    return { reason: "malformed_response", state: "terminal" }
  }
  return {
    state: "ok",
    tokens: {
      accessToken,
      idToken: stringValue(payload.id_token),
      refreshToken,
    },
  }
}

function terminalTokenError(payload: unknown): ConsoleOidcTokenResult {
  const description = isRecord(payload)
    ? `${stringValue(payload.error) ?? ""} ${stringValue(payload.error_description) ?? ""}`.toLowerCase()
    : ""
  const reason = description.includes("reuse")
    ? "reuse_detected"
    : description.includes("expired")
      ? "refresh_expired"
      : description.includes("revoked")
        ? "revoked"
        : "invalid_grant"
  return { reason, state: "terminal" }
}

async function boundedJson(response: Response): Promise<unknown> {
  const declaredLength = Number(response.headers.get("content-length"))
  if (Number.isFinite(declaredLength) && declaredLength > 64 * 1024) {
    await response.body?.cancel().catch(() => undefined)
    return null
  }
  const reader = response.body?.getReader()
  if (!reader) {
    return null
  }
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }
    total += value.byteLength
    if (total > 64 * 1024) {
      await reader.cancel().catch(() => undefined)
      return null
    }
    chunks.push(value)
  }
  const body = Buffer.alloc(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(body.toString("utf8")) as unknown
  } catch {
    return null
  } finally {
    body.fill(0)
  }
}

function assertConfig(config: ConsoleOidcClientConfig): void {
  for (const value of [
    config.authorizationEndpoint,
    config.redirectUri,
    config.revocationEndpoint,
    config.tokenEndpoint,
  ]) {
    if (new URL(value).protocol !== "https:") {
      throw new Error("Console OIDC endpoints must use HTTPS.")
    }
  }
  if (!config.clientId || !config.clientSecret) {
    throw new Error("Console OIDC client configuration is incomplete.")
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}
