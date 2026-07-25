import { describe, expect, it } from "vitest"
import { cleanOptionalEnvValue, ensureAuthUrlEnv } from "./env"

describe("auth env helpers", () => {
  it.each(["", " ", "null", "NULL", "undefined"])(
    "treats %j as unset",
    (value) => {
      expect(cleanOptionalEnvValue(value)).toBeUndefined()
    },
  )

  it("normalizes Auth.js URL env aliases", () => {
    const env = {
      AUTH_URL: "null",
      NEXTAUTH_URL: " https://console.example.test ",
    }

    expect(ensureAuthUrlEnv(undefined, env)).toBe(
      "https://console.example.test",
    )
    expect(env.AUTH_URL).toBe("https://console.example.test")
    expect(env.NEXTAUTH_URL).toBe("https://console.example.test")
  })

  it("falls back to the request origin when no auth URL is configured", () => {
    const env = {
      AUTH_URL: "undefined",
      NEXTAUTH_URL: "",
    }

    expect(ensureAuthUrlEnv("https://console.test", env)).toBe(
      "https://console.test",
    )
    expect(env.AUTH_URL).toBe("https://console.test")
    expect(env.NEXTAUTH_URL).toBe("https://console.test")
  })
})
