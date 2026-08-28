import { describe, expect, it } from "vitest"
import nextConfig from "../next.config"

describe("Keys routing", () => {
  it("redirects legacy Applications URLs and canonically serves Keys", async () => {
    await expect(nextConfig.redirects?.()).resolves.toEqual([
      {
        source: "/applications/:path*",
        destination: "/keys/:path*",
        permanent: false,
      },
    ])
    await expect(nextConfig.rewrites?.()).resolves.toEqual([
      {
        source: "/keys/:path*",
        destination: "/applications/:path*",
      },
    ])
  })
})
