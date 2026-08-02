export function buildContentSecurityPolicy(
  nonce: string,
  env: {
    NODE_ENV?: string
    WEB_CONNECT_SRC_ORIGINS?: string
    WEB_FRAME_SRC_ORIGINS?: string
  } = process.env,
): string {
  const isDevelopment = env.NODE_ENV === "development"
  const connectSrc = splitOrigins(env.WEB_CONNECT_SRC_ORIGINS)
  const frameSrc = splitOrigins(env.WEB_FRAME_SRC_ORIGINS)

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "form-action 'self'",
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
