import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  poweredByHeader: false,
  images: {
    remotePatterns: [],
  },
  async redirects() {
    return [
      {
        source: "/applications/:path*",
        destination: "/keys/:path*",
        permanent: false,
      },
    ]
  },
  async rewrites() {
    return [
      {
        source: "/keys/:path*",
        destination: "/applications/:path*",
      },
    ]
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
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

export default nextConfig
