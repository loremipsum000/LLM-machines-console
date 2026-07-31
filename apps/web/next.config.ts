import type { NextConfig } from "next"

const frameSrc = splitOrigins(process.env.WEB_FRAME_SRC_ORIGINS)
const connectSrc = splitOrigins(process.env.WEB_CONNECT_SRC_ORIGINS)

const nextConfig: NextConfig = {
  poweredByHeader: false,
  images: {
    remotePatterns: [],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value: buildContentSecurityPolicy(),
          },
          {
            key: "Referrer-Policy",
            value: "no-referrer",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
        ],
      },
    ]
  },
}

export function buildContentSecurityPolicy(
  env: { NODE_ENV?: string } = process.env,
): string {
  const isDevelopment = env.NODE_ENV === "development"
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "form-action 'self'",
    "frame-ancestors 'self'",
    `script-src 'self'${isDevelopment ? " 'unsafe-eval'" : ""}`,
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

export default nextConfig
