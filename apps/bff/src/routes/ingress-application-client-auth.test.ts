import { Buffer } from "node:buffer"
import { afterEach, describe, expect, it, vi } from "vitest"
import { buildServer } from "../index"
import { validApplicationClientAuthorization } from "./ingress-application-client-auth"

const CLIENT_ID = "llmm-app-11111111-1111-4111-8111-111111111111"

describe("Application client authorization ingress check", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it.each(["Basic", "basic", "bAsIc"])(
    "accepts a canonical %s credential with the Product client namespace",
    (scheme) => {
      expect(
        validApplicationClientAuthorization(
          `${scheme} ${Buffer.from(`${CLIENT_ID}:secret`).toString("base64")}`,
        ),
      ).toBe(true)
    },
  )

  it.each([
    null,
    "",
    "Bearer application-token",
    "Basic a",
    "Basic abcde",
    "Basic invalid*base64",
    `Basic ${Buffer.from(":secret").toString("base64")}`,
    `Basic ${Buffer.from(`${CLIENT_ID}:`).toString("base64")}`,
    `Basic ${Buffer.from("other-client:secret").toString("base64")}`,
    `Basic ${Buffer.from(`${CLIENT_ID}:secret`).toString("base64").replace(/=$/, "")}`,
  ])("rejects malformed or out-of-namespace authorization %s", (value) => {
    expect(validApplicationClientAuthorization(value)).toBe(false)
  })

  it("exposes only a metadata-free 204 or 401 result", async () => {
    vi.stubEnv("NODE_ENV", "test")
    vi.stubEnv("BFF_ENABLE_FIXTURES", "true")
    const server = buildServer()

    const accepted = await server.inject({
      headers: {
        "x-llmm-application-authorization": `Basic ${Buffer.from(`${CLIENT_ID}:secret`).toString("base64")}`,
      },
      method: "GET",
      url: "/internal/ingress/application-client-authorization",
    })
    expect(accepted.statusCode).toBe(204)
    expect(accepted.body).toBe("")

    const rejected = await server.inject({
      headers: { "x-llmm-application-authorization": "Basic a" },
      method: "GET",
      url: "/internal/ingress/application-client-authorization",
    })
    expect(rejected.statusCode).toBe(401)
    expect(rejected.body).toBe("")
    await server.close()
  })
})
