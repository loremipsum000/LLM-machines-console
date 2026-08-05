import {
  createHash,
  createSign,
  generateKeyPairSync,
  randomBytes,
} from "node:crypto"

const MAXIMUM_BODY_BYTES = 64 * 1024

export function createOidcFixture(options) {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  })
  const keyId = `f0-s1-${randomBytes(8).toString("hex")}`
  const publicJwk = {
    ...publicKey.export({ format: "jwk" }),
    alg: "RS256",
    kid: keyId,
    use: "sig",
  }
  const authorizations = new Map()
  const codes = new Map()
  const refreshTokens = new Map()
  let available = true
  let lastGrantFailure = null
  let refreshCount = 0

  return {
    get refreshCount() {
      return refreshCount
    },
    get lastGrantFailure() {
      return lastGrantFailure
    },
    async handle(request, response, url) {
      if (!url.pathname.startsWith(new URL(options.issuer).pathname)) {
        sendJson(response, 404, { error: "identity_route_denied" })
        return
      }
      if (!available) {
        sendJson(response, 503, { error: "identity_unavailable" })
        return
      }
      const oidcPath = `${new URL(options.issuer).pathname}/protocol/openid-connect`
      if (request.method === "GET" && url.pathname === `${oidcPath}/certs`) {
        sendJson(response, 200, { keys: [publicJwk] })
        return
      }
      if (url.pathname === `${oidcPath}/auth`) {
        await handleAuthorization(request, response, url)
        return
      }
      if (request.method === "POST" && url.pathname === `${oidcPath}/token`) {
        await handleToken(request, response)
        return
      }
      if (request.method === "POST" && url.pathname === `${oidcPath}/revoke`) {
        await handleRevocation(request, response)
        return
      }
      sendJson(response, 404, { error: "identity_route_denied" })
    },
    setAvailable(value) {
      available = Boolean(value)
    },
  }

  async function handleAuthorization(request, response, url) {
    if (request.method === "GET") {
      const input = authorizationInput(url.searchParams)
      if (!input) {
        sendHtml(response, 400, "<h1>Invalid authorization request</h1>")
        return
      }
      const transaction = opaqueValue()
      authorizations.set(transaction, input)
      sendHtml(response, 200, loginForm(transaction))
      return
    }
    if (request.method !== "POST") {
      response.writeHead(405, { allow: "GET, POST" })
      response.end()
      return
    }
    const body = await readForm(request)
    const transaction = body.get("transaction")
    const username = body.get("username")
    const password = body.get("password")
    const input = transaction ? authorizations.get(transaction) : undefined
    if (transaction) {
      authorizations.delete(transaction)
    }
    const user = Object.values(options.users).find(
      (candidate) =>
        candidate.username === username && candidate.password === password,
    )
    if (!input || !user) {
      sendHtml(response, 401, "<h1>Invalid throwaway credentials</h1>")
      return
    }
    const code = opaqueValue()
    const sessionId = opaqueValue()
    codes.set(code, { ...input, sessionId, user })
    const callback = new URL(input.redirectUri)
    callback.searchParams.set("code", code)
    callback.searchParams.set("iss", options.issuer)
    callback.searchParams.set("session_state", sessionId)
    callback.searchParams.set("state", input.state)
    response.writeHead(303, {
      "cache-control": "no-store",
      location: callback.toString(),
    })
    response.end()
  }

  async function handleToken(request, response) {
    const body = await readForm(request)
    if (
      body.get("client_id") !== options.clientId ||
      body.get("client_secret") !== options.clientSecret
    ) {
      lastGrantFailure =
        body.get("client_id") !== options.clientId
          ? "client_id_mismatch"
          : "client_secret_mismatch"
      sendJson(response, 401, { error: "invalid_client" })
      return
    }
    if (body.get("grant_type") === "authorization_code") {
      const code = body.get("code")
      const authorization = code ? codes.get(code) : undefined
      if (code) {
        codes.delete(code)
      }
      const verifier = body.get("code_verifier") ?? ""
      lastGrantFailure = !authorization
        ? "authorization_code_missing"
        : body.get("redirect_uri") !== authorization.redirectUri
          ? "redirect_uri_mismatch"
          : sha256Base64Url(verifier) !== authorization.codeChallenge
            ? "pkce_mismatch"
            : null
      if (lastGrantFailure) {
        sendJson(response, 400, { error: "invalid_grant" })
        return
      }
      sendJson(response, 200, issueTokens(authorization, true))
      return
    }
    if (body.get("grant_type") === "refresh_token") {
      const presented = body.get("refresh_token")
      const record = presented ? refreshTokens.get(presented) : undefined
      if (!presented || !record || record.used || record.revoked) {
        sendJson(response, 400, {
          error: "invalid_grant",
          error_description: "refresh token revoked or reused",
        })
        return
      }
      record.used = true
      refreshCount += 1
      sendJson(response, 200, issueTokens(record.authorization, false))
      return
    }
    sendJson(response, 400, { error: "unsupported_grant_type" })
  }

  async function handleRevocation(request, response) {
    const body = await readForm(request)
    if (
      body.get("client_id") !== options.clientId ||
      body.get("client_secret") !== options.clientSecret
    ) {
      sendJson(response, 401, { error: "invalid_client" })
      return
    }
    const record = refreshTokens.get(body.get("token"))
    if (record) {
      record.revoked = true
    }
    response.writeHead(204, { "cache-control": "no-store" })
    response.end()
  }

  function issueTokens(authorization, includeIdToken) {
    const nowSeconds = Math.floor(options.now().getTime() / 1000)
    const expiresAt = nowSeconds + 5 * 60
    const refreshToken = opaqueValue() + opaqueValue()
    refreshTokens.set(refreshToken, {
      authorization,
      revoked: false,
      used: false,
    })
    const shared = {
      auth_time: nowSeconds,
      email: `${authorization.user.username}@fixture.invalid`,
      exp: expiresAt,
      iat: nowSeconds,
      iss: options.issuer,
      sid: authorization.sessionId,
      sub: authorization.user.subject,
    }
    const accessToken = signJwt({
      ...shared,
      amr: authorization.user.role === "admin" ? ["pwd", "otp"] : ["pwd"],
      aud: options.audience,
      azp: options.clientId,
      groups: [authorization.user.role === "admin" ? "Admins" : "Operators"],
      realm_access: { roles: [authorization.user.role] },
      scope: "openid profile email",
      typ: "Bearer",
    })
    return {
      access_token: accessToken,
      expires_in: 300,
      ...(includeIdToken
        ? {
            id_token: signJwt({
              ...shared,
              aud: options.clientId,
              azp: options.clientId,
              nonce: authorization.nonce,
            }),
          }
        : {}),
      refresh_token: refreshToken,
      refresh_expires_in: 8 * 60 * 60,
      token_type: "Bearer",
    }
  }

  function signJwt(payload) {
    const header = base64UrlJson({ alg: "RS256", kid: keyId, typ: "JWT" })
    const body = base64UrlJson(payload)
    const signedContent = `${header}.${body}`
    const signer = createSign("RSA-SHA256")
    signer.update(signedContent)
    signer.end()
    return `${signedContent}.${signer.sign(privateKey).toString("base64url")}`
  }

  function loginForm(transaction) {
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Fixture identity</title></head>
<body><main><h1>Fixture identity sign in</h1>
<form method="post">
<input name="transaction" type="hidden" value="${escapeHtml(transaction)}">
<label>Username <input autocomplete="username" name="username"></label>
<label>Password <input autocomplete="current-password" name="password" type="password"></label>
<button type="submit">Sign in</button>
</form></main></body></html>`
  }

  function authorizationInput(parameters) {
    const allowed = new Set([
      "acr_values",
      "client_id",
      "code_challenge",
      "code_challenge_method",
      "max_age",
      "nonce",
      "prompt",
      "redirect_uri",
      "response_type",
      "scope",
      "state",
    ])
    if ([...parameters.keys()].some((key) => !allowed.has(key))) {
      return null
    }
    const redirectUri = parameters.get("redirect_uri")
    const redirect = redirectUri ? new URL(redirectUri) : null
    if (
      parameters.get("client_id") !== options.clientId ||
      parameters.get("response_type") !== "code" ||
      parameters.get("code_challenge_method") !== "S256" ||
      parameters.get("scope") !== "openid profile email" ||
      !bounded(parameters.get("state"), 128) ||
      !bounded(parameters.get("nonce"), 128) ||
      !bounded(parameters.get("code_challenge"), 128) ||
      !redirect ||
      redirect.toString() !== options.redirectUri
    ) {
      return null
    }
    return {
      codeChallenge: parameters.get("code_challenge"),
      nonce: parameters.get("nonce"),
      redirectUri,
      state: parameters.get("state"),
    }
  }
}

async function readForm(request) {
  const chunks = []
  let total = 0
  for await (const chunk of request) {
    total += chunk.length
    if (total > MAXIMUM_BODY_BYTES) {
      throw new Error("OIDC fixture request body exceeded its limit.")
    }
    chunks.push(chunk)
  }
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"))
}

function sendJson(response, status, value) {
  const body = JSON.stringify(value)
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
    "content-type": "application/json",
  })
  response.end(body)
}

function sendHtml(response, status, body) {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
    "content-type": "text/html; charset=utf-8",
  })
  response.end(body)
}

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url")
}

function sha256Base64Url(value) {
  return createHash("sha256").update(value, "utf8").digest("base64url")
}

function opaqueValue() {
  return randomBytes(32).toString("base64url")
}

function bounded(value, maximum) {
  return (
    typeof value === "string" && value.length > 0 && value.length <= maximum
  )
}

function escapeHtml(value) {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;")
}
