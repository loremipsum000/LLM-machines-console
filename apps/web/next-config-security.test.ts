import { describe, expect, it } from "vitest"
import { buildContentSecurityPolicy } from "./src/lib/security/content-security-policy"

describe("Next security headers", () => {
  it("does not allow inline scripts in production CSP", () => {
    const csp = buildContentSecurityPolicy("test-nonce", {
      NODE_ENV: "production",
    })

    expect(cspDirective(csp, "script-src")).toEqual([
      "'self'",
      "'nonce-test-nonce'",
    ])
    expect(cspDirective(csp, "script-src")).not.toContain("'unsafe-inline'")
    expect(cspDirective(csp, "script-src")).not.toContain("'unsafe-eval'")
  })

  it("keeps development eval isolated from production script policy", () => {
    const csp = buildContentSecurityPolicy("test-nonce", {
      NODE_ENV: "development",
    })

    expect(cspDirective(csp, "script-src")).toEqual([
      "'self'",
      "'nonce-test-nonce'",
      "'unsafe-eval'",
    ])
    expect(cspDirective(csp, "script-src")).not.toContain("'unsafe-inline'")
  })

  it("allows inline styles without also allowing inline scripts", () => {
    const csp = buildContentSecurityPolicy("test-nonce", {
      NODE_ENV: "production",
    })

    expect(cspDirective(csp, "style-src")).toContain("'unsafe-inline'")
    expect(cspDirective(csp, "script-src")).not.toContain("'unsafe-inline'")
  })
})

function cspDirective(csp: string, name: string): string[] {
  const directive = csp
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name} `))
  if (!directive) {
    return []
  }
  return directive.split(/\s+/).slice(1)
}
