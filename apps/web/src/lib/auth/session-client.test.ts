import { describe, expect, it, vi } from "vitest"
import {
  CONSOLE_SESSION_COOKIE,
  CONSOLE_SESSION_HEADER,
  opaqueConsoleSessionHandle,
  resolveConsoleSession,
} from "./session-client"

const sessionHandle = "A".repeat(43)
const cookieHeader = `${CONSOLE_SESSION_COOKIE}=${sessionHandle}`

describe("opaque Console session resolver", () => {
  it("resolves an active session with only service auth and the opaque handle", async () => {
    const fetchSpy = vi.fn<typeof fetch>(async (_input, _init) =>
      Response.json({
        session: {
          email: "operator@example.test",
          groups: ["Operators"],
          mfaVerifiedAt: null,
          role: "operator",
          subject: "operator-1",
        },
        state: "active",
      }),
    )

    await expect(
      resolveConsoleSession(cookieHeader, {
        baseUrl: "http://console-bff:4001/",
        fetch: fetchSpy as typeof fetch,
        serviceCredential: "service-credential",
      }),
    ).resolves.toEqual({
      session: {
        email: "operator@example.test",
        groups: ["Operators"],
        mfaVerifiedAt: null,
        role: "operator",
        subject: "operator-1",
      },
      state: "active",
    })

    expect(fetchSpy).toHaveBeenCalledOnce()
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe(
      "http://console-bff:4001/api/internal/console-session/resolve",
    )
    expect(init).toMatchObject({
      cache: "no-store",
      headers: {
        authorization: "Bearer service-credential",
        [CONSOLE_SESSION_HEADER]: sessionHandle,
      },
      method: "GET",
      redirect: "error",
    })
    expect(Object.keys(init?.headers ?? {}).sort()).toEqual([
      "authorization",
      CONSOLE_SESSION_HEADER,
    ])
  })

  it("preserves the BFF terminal and retryable outcomes", async () => {
    const terminal = await resolveConsoleSession(cookieHeader, {
      baseUrl: "http://console-bff:4001",
      fetch: vi.fn(async () =>
        Response.json(
          { reason: "expired", state: "terminal" },
          { status: 401 },
        ),
      ) as typeof fetch,
      serviceCredential: "service-credential",
    })
    const unavailable = await resolveConsoleSession(cookieHeader, {
      baseUrl: "http://console-bff:4001",
      fetch: vi.fn(async () =>
        Response.json(
          {
            reason: "identity_unavailable",
            retryable: true,
            state: "unavailable",
          },
          { status: 503 },
        ),
      ) as typeof fetch,
      serviceCredential: "service-credential",
    })

    expect(terminal).toEqual({ reason: "expired", state: "terminal" })
    expect(unavailable).toEqual({
      reason: "identity_unavailable",
      retryable: true,
      state: "unavailable",
    })
  })

  it("maps network failures to a retryable outage", async () => {
    await expect(
      resolveConsoleSession(cookieHeader, {
        baseUrl: "http://console-bff:4001",
        fetch: vi.fn(async () => {
          throw new Error("connection refused")
        }) as typeof fetch,
        serviceCredential: "service-credential",
      }),
    ).resolves.toEqual({
      reason: "identity_unavailable",
      retryable: true,
      state: "unavailable",
    })
    await expect(
      resolveConsoleSession(cookieHeader, {
        baseUrl: "",
        serviceCredential: "",
      }),
    ).resolves.toEqual({
      reason: "identity_unavailable",
      retryable: true,
      state: "unavailable",
    })
  })

  it("fails closed on status/body mismatches and oversized responses", async () => {
    const mismatched = await resolveConsoleSession(cookieHeader, {
      baseUrl: "http://console-bff:4001",
      fetch: vi.fn(async () =>
        Response.json({ reason: "expired", state: "terminal" }),
      ) as typeof fetch,
      serviceCredential: "service-credential",
    })
    const oversized = await resolveConsoleSession(cookieHeader, {
      baseUrl: "http://console-bff:4001",
      fetch: vi.fn(
        async () =>
          new Response("{}", {
            headers: { "content-length": String(64 * 1024 + 1) },
          }),
      ) as typeof fetch,
      serviceCredential: "service-credential",
    })

    expect(mismatched).toEqual({ reason: "invalid", state: "terminal" })
    expect(oversized).toEqual({ reason: "invalid", state: "terminal" })
  })

  it("rejects malformed and duplicate browser cookies without a BFF call", async () => {
    const fetchSpy = vi.fn()
    const duplicate = `${cookieHeader}; ${CONSOLE_SESSION_COOKIE}=${"B".repeat(43)}`

    expect(opaqueConsoleSessionHandle(cookieHeader)).toBe(sessionHandle)
    expect(opaqueConsoleSessionHandle(duplicate)).toBeNull()
    expect(
      opaqueConsoleSessionHandle(`${CONSOLE_SESSION_COOKIE}=not-opaque`),
    ).toBeNull()
    await expect(
      resolveConsoleSession(duplicate, {
        baseUrl: "http://console-bff:4001",
        fetch: fetchSpy as typeof fetch,
        serviceCredential: "service-credential",
      }),
    ).resolves.toEqual({ reason: "absent", state: "terminal" })
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
