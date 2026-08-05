export function buildContentSecurityPolicy(
  nonce: string,
  env: {
    NODE_ENV?: string
    WEB_CONNECT_SRC_ORIGINS?: string
    WEB_FRAME_SRC_ORIGINS?: string
    WEB_IDENTITY_ORIGIN?: string
  } = process.env,
): string {
  const isDevelopment = env.NODE_ENV === "development"
  const connectSrc = splitOrigins(env.WEB_CONNECT_SRC_ORIGINS)
  const frameSrc = splitOrigins(env.WEB_FRAME_SRC_ORIGINS)
  const identityOrigin = exactOrigin(env.WEB_IDENTITY_ORIGIN, isDevelopment)

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    `form-action 'self'${formatSources(
      identityOrigin ? [identityOrigin] : [],
    )}`,
    "frame-ancestors 'self'",
    `script-src 'self' 'nonce-${nonce}'${isDevelopment ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self'${formatSources(connectSrc)}${formatSources(
      isDevelopment ? ["ws://127.0.0.1:3000", "ws://localhost:3000"] : [],
    )}`,
    `frame-src 'self'${formatSources(frameSrc)}`,
  ].join("; ")
}

function exactOrigin(
  value: string | undefined,
  allowHttp: boolean,
): string | null {
  const candidate = value?.trim()
  if (!candidate) {
    return null
  }
  try {
    const origin = new URL(candidate)
    if (
      (origin.protocol !== "https:" &&
        !(allowHttp && origin.protocol === "http:")) ||
      origin.username ||
      origin.password ||
      origin.pathname !== "/" ||
      origin.search ||
      origin.hash ||
      candidate !== origin.origin
    ) {
      return null
    }
    return origin.origin
  } catch {
    return null
  }
}

function splitOrigins(value: string | undefined): string[] {
  return value
    ? value
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean)
    : []
}

function formatSources(origins: string[]): string {
  return origins.length > 0 ? ` ${origins.join(" ")}` : ""
}
