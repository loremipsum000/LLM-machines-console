import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { request as httpRequest } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import Fastify from "fastify"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { buildServer } from "../index"
import {
  type ChatCompletionsBody,
  normalizedChatCompletionsBodyUtf8Bytes,
} from "../inference/chat-completions"
import * as connectedAppService from "../services/admin-connected-apps"
import { resetConnectedAppsForTest } from "../services/admin-connected-apps"
import {
  getAuditEventsForTest,
  resetAuditEventsForTest,
} from "../services/audit"
import { resetIdempotencyForTest } from "../services/idempotency"
import { IsolationTrafficGate } from "../services/isolation-traffic-gate"
import {
  type AppGatewayIsolationTrafficGate,
  registerAppGatewayRoutes,
} from "./app-gateway"

const adminHeaders = {
  authorization: "Bearer test-service-key",
  "x-llm-machines-keycloak-token": "",
  "x-llm-machines-user-sub": "admin-1",
  "x-llm-machines-user-email": "admin@example.test",
  "x-llm-machines-user-roles": "admin",
}
const isolationEngagementContext = {
  correlationId: "gateway-finalization-race",
  transitionId: "20000000-0000-4000-8000-000000000001",
}
let createCounter = 0
let modelAdmissionDirectory: string | null = null

describe("Connected app gateway routes", () => {
  beforeEach(() => {
    configureModelAdmissionFixture()
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.useRealTimers()
    resetAuditEventsForTest()
    resetIdempotencyForTest()
    await resetConnectedAppsForTest()
    if (modelAdmissionDirectory) {
      await rm(modelAdmissionDirectory, { force: true, recursive: true })
      modelAdmissionDirectory = null
    }
  })

  it.each(["denied", "rejected"] as const)(
    "fails closed when isolation admission is %s",
    async (mode) => {
      configureGatewayEnvironment()
      const fetchMock = vi.fn<typeof fetch>()
      vi.stubGlobal("fetch", fetchMock)
      const adminServer = buildServer()
      const created = await createApp(adminServer, ["local-a"])
      const token = bearerForCredential(created.credential)
      const admit = vi.fn<AppGatewayIsolationTrafficGate["admit"]>(async () => {
        if (mode === "rejected") {
          throw new Error("private isolation store failure")
        }
        return { ok: false }
      })
      const gatewayServer = Fastify({ logger: false })
      registerAppGatewayRoutes(gatewayServer, {
        isolationGate: { admit },
      })

      const response = await gatewayServer.inject({
        headers: { authorization: `Bearer ${token}` },
        method: "POST",
        payload: {
          messages: [{ content: "private isolation prompt", role: "user" }],
          model: "local-a",
        },
        url: "/api/app-gateway/v1/chat/completions",
      })

      expect(response.statusCode).toBe(503)
      expect(response.json()).toMatchObject({
        code: "application_traffic_unavailable",
        request_id: expect.any(String),
        status: 503,
        title: "Key traffic unavailable",
      })
      expect(response.body).not.toContain("private isolation")
      expect(fetchMock).not.toHaveBeenCalled()
      expect(admit).toHaveBeenCalledWith({
        appId: created.app.id,
        correlationId: response.json().request_id,
        credentialRecordId: created.credential.credentialId,
        route: "chat_completions",
        signal: expect.any(AbortSignal),
      })
      const auditText = JSON.stringify(getAuditEventsForTest())
      expect(auditText).not.toContain("private isolation prompt")
      expect(auditText).not.toContain("private isolation store failure")
      await gatewayServer.close()
      await adminServer.close()
    },
  )

  it.each(["models", "chat_completions"] as const)(
    "aborts an in-flight %s request when isolation engages",
    async (route) => {
      configureGatewayEnvironment()
      const controller = new AbortController()
      const release = vi.fn(() => {
        throw new Error("private isolation lease release failure")
      })
      let markStarted: (() => void) | undefined
      const started = new Promise<void>((resolve) => {
        markStarted = resolve
      })
      let upstreamSignal: AbortSignal | undefined
      const fetchMock = vi.fn<typeof fetch>(
        async (_url, init) =>
          new Promise<Response>((_resolve, reject) => {
            upstreamSignal = init?.signal as AbortSignal
            markStarted?.()
            upstreamSignal.addEventListener(
              "abort",
              () => reject(upstreamSignal?.reason),
              { once: true },
            )
          }),
      )
      vi.stubGlobal("fetch", fetchMock)
      const adminServer = buildServer()
      const created = await createApp(adminServer, ["local-a"])
      if (route === "models") {
        configureAuthoritativeModelProjection(["local-a"])
      }
      const token = bearerForCredential(created.credential)
      const admit = vi.fn<AppGatewayIsolationTrafficGate["admit"]>(
        async () => ({
          lease: {
            async finalize(operation) {
              return controller.signal.aborted
                ? { ok: false }
                : { ok: true, value: await operation() }
            },
            release,
            signal: controller.signal,
          },
          ok: true,
        }),
      )
      const gatewayServer = Fastify({ logger: false })
      registerAppGatewayRoutes(gatewayServer, {
        isolationGate: { admit },
      })

      const responsePromise = gatewayServer.inject(
        route === "models"
          ? {
              headers: { authorization: `Bearer ${token}` },
              method: "GET",
              url: "/api/app-gateway/v1/models",
            }
          : {
              headers: { authorization: `Bearer ${token}` },
              method: "POST",
              payload: {
                messages: [
                  { content: "abort this private prompt", role: "user" },
                ],
                model: "local-a",
              },
              url: "/api/app-gateway/v1/chat/completions",
            },
      )
      await started
      controller.abort(new Error("isolation engaged"))
      const response = await responsePromise

      expect(response.statusCode).toBe(503)
      expect(response.json()).toMatchObject({
        code: "application_traffic_unavailable",
        status: 503,
      })
      expect(response.body).not.toContain("abort this private prompt")
      expect(upstreamSignal?.aborted).toBe(true)
      expect(release).toHaveBeenCalledOnce()
      expect(admit).toHaveBeenCalledWith(expect.objectContaining({ route }))
      const auditText = JSON.stringify(getAuditEventsForTest())
      expect(auditText).not.toContain("abort this private prompt")
      expect(auditText).not.toContain("private isolation lease release failure")
      await gatewayServer.close()
      await adminServer.close()
    },
  )

  it.each(["models", "chat_completions"] as const)(
    "records a failed %s terminal outcome when isolation wins finalization",
    async (route) => {
      configureGatewayEnvironment()
      const privateCanary = "private-isolation-winner-canary"
      vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>(async () =>
          route === "models"
            ? Response.json({
                data: [
                  {
                    id: privateCanary,
                    object: "model",
                    owned_by: "llm-machines",
                  },
                ],
                object: "list",
              })
            : Response.json({
                choices: [
                  {
                    finish_reason: "stop",
                    index: 0,
                    message: { content: privateCanary, role: "assistant" },
                  },
                ],
                object: "chat.completion",
                usage: { total_tokens: 1 },
              }),
        ),
      )
      const adminServer = buildServer()
      const created = await createApp(adminServer, [privateCanary])
      const token = bearerForCredential(created.credential)
      const finalize = vi.fn(async () => ({ ok: false as const }))
      const release = vi.fn()
      const gatewayServer = Fastify({ logger: false })
      registerAppGatewayRoutes(gatewayServer, {
        isolationGate: {
          async admit() {
            return {
              lease: {
                finalize,
                release,
                signal: new AbortController().signal,
              },
              ok: true,
            }
          },
        },
      })

      const response = await gatewayServer.inject(
        route === "models"
          ? {
              headers: { authorization: `Bearer ${token}` },
              method: "GET",
              url: "/api/app-gateway/v1/models",
            }
          : {
              headers: { authorization: `Bearer ${token}` },
              method: "POST",
              payload: {
                messages: [{ content: "private request", role: "user" }],
                model: privateCanary,
              },
              url: "/api/app-gateway/v1/chat/completions",
            },
      )

      expect(response.statusCode).toBe(503)
      expect(response.body).not.toContain(privateCanary)
      expect(finalize).toHaveBeenCalledOnce()
      expect(release).toHaveBeenCalledOnce()
      expect(
        getAuditEventsForTest().filter(
          (event) =>
            event.action === `connected_app.gateway.${route}` &&
            event.metadata.outcome === "failed",
        ),
      ).toHaveLength(1)
      await gatewayServer.close()
      await adminServer.close()
    },
  )

  it("abandons delayed isolation admission when the client disconnects", async () => {
    configureGatewayEnvironment()
    let markAuthorityRead: (() => void) | undefined
    const authorityRead = new Promise<void>((resolve) => {
      markAuthorityRead = resolve
    })
    let releaseAuthority: (() => void) | undefined
    const authorityBlocked = new Promise<void>((resolve) => {
      releaseAuthority = resolve
    })
    const isolationGate = await openIsolationGate({
      async read() {
        markAuthorityRead?.()
        await authorityBlocked
        return openIsolationAuthorityStatus()
      },
    })
    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal("fetch", fetchMock)
    const recordUsage = vi.spyOn(
      connectedAppService,
      "recordConnectedAppGatewayUsage",
    )
    const adminServer = buildServer()
    const created = await createApp(adminServer, ["local-a"])
    const token = bearerForCredential(created.credential)
    const gatewayServer = Fastify({ logger: false })
    let admissionSignal: AbortSignal | undefined
    registerAppGatewayRoutes(gatewayServer, {
      isolationGate: {
        async admit(input) {
          admissionSignal = input.signal
          return isolationGate.admit(input)
        },
      },
    })
    const address = await gatewayServer.listen({ host: "127.0.0.1", port: 0 })
    const client = httpRequest(new URL("/api/app-gateway/v1/models", address), {
      headers: { authorization: `Bearer ${token}` },
      method: "GET",
    })
    client.on("error", () => undefined)
    const clientClosed = new Promise<void>((resolve) => {
      client.once("close", resolve)
    })
    client.end()

    await authorityRead
    client.destroy()
    await clientClosed
    await vi.waitFor(() => {
      expect(admissionSignal?.aborted).toBe(true)
    })

    await vi.waitFor(() => {
      expect(
        getAuditEventsForTest().filter(
          (event) =>
            event.action === "connected_app.gateway.models" &&
            event.metadata.outcome === "failed",
        ),
      ).toHaveLength(1)
    })
    expect(recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({ appId: created.app.id }),
      expect.objectContaining({ route: "models", status: 499 }),
    )
    expect(
      getAuditEventsForTest().filter(
        (event) =>
          event.action === "connected_app.gateway.models" &&
          event.metadata.outcome === "succeeded",
      ),
    ).toHaveLength(0)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(isolationGate.stateForTest().activeLeases).toBe(0)
    releaseAuthority?.()
    await gatewayServer.close()
    await adminServer.close()
  })

  it("aborts models upstream and releases its lease when the client disconnects", async () => {
    configureGatewayEnvironment()
    const isolationGate = await openIsolationGate()
    let markUpstreamStarted: (() => void) | undefined
    const upstreamStarted = new Promise<void>((resolve) => {
      markUpstreamStarted = resolve
    })
    let upstreamSignal: AbortSignal | undefined
    const reconcileUsage = vi.spyOn(
      connectedAppService,
      "reconcileConnectedAppGatewayUsage",
    )
    const fetchMock = vi.fn<typeof fetch>(
      async (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          upstreamSignal = init?.signal as AbortSignal
          const rejectOnAbort = () => reject(upstreamSignal?.reason)
          upstreamSignal.addEventListener("abort", rejectOnAbort, {
            once: true,
          })
          markUpstreamStarted?.()
          if (upstreamSignal.aborted) {
            rejectOnAbort()
          }
        }),
    )
    vi.stubGlobal("fetch", fetchMock)
    const adminServer = buildServer()
    const created = await createApp(adminServer, ["local-a"])
    configureAuthoritativeModelProjection(["local-a"])
    const token = bearerForCredential(created.credential)
    const gatewayServer = Fastify({ logger: false })
    registerAppGatewayRoutes(gatewayServer, { isolationGate })
    const address = await gatewayServer.listen({ host: "127.0.0.1", port: 0 })
    const client = httpRequest(new URL("/api/app-gateway/v1/models", address), {
      headers: { authorization: `Bearer ${token}` },
      method: "GET",
    })
    client.on("error", () => undefined)
    const clientClosed = new Promise<void>((resolve) => {
      client.once("close", resolve)
    })
    client.end()

    await upstreamStarted
    client.destroy()
    await clientClosed

    await vi.waitFor(() => {
      expect(upstreamSignal?.aborted).toBe(true)
      expect(isolationGate.stateForTest().activeLeases).toBe(0)
      expect(
        getAuditEventsForTest().filter(
          (event) =>
            event.action === "connected_app.gateway.models" &&
            event.metadata.outcome === "failed",
        ),
      ).toHaveLength(1)
    })
    expect(reconcileUsage).toHaveBeenCalledWith(
      expect.objectContaining({ appId: created.app.id }),
      expect.objectContaining({ route: "models", status: 499 }),
      expect.any(Object),
    )
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(
      getAuditEventsForTest().filter(
        (event) =>
          event.action === "connected_app.gateway.models" &&
          event.metadata.outcome === "succeeded",
      ),
    ).toHaveLength(0)
    await gatewayServer.close()
    await adminServer.close()
  })

  it.each([
    { accounting: "reconcile", route: "models" },
    { accounting: "connection", route: "models" },
    { accounting: "reconcile", route: "chat_completions" },
  ] as const)(
    "commits a buffered $route success before engagement when finalization wins during $accounting accounting",
    async ({ accounting, route }) => {
      configureGatewayEnvironment()
      const isolationGate = await openIsolationGate()
      let markAccountingStarted: (() => void) | undefined
      const accountingStarted = new Promise<void>((resolve) => {
        markAccountingStarted = resolve
      })
      let finishAccounting: (() => void) | undefined
      const accountingBlocked = new Promise<void>((resolve) => {
        finishAccounting = resolve
      })
      if (accounting === "reconcile") {
        const reconcile = connectedAppService.reconcileConnectedAppGatewayUsage
        vi.spyOn(
          connectedAppService,
          "reconcileConnectedAppGatewayUsage",
        ).mockImplementation(async (...args) => {
          markAccountingStarted?.()
          await accountingBlocked
          return reconcile(...args)
        })
      } else {
        const recordConnection =
          connectedAppService.recordConnectedAppModelsConnection
        vi.spyOn(
          connectedAppService,
          "recordConnectedAppModelsConnection",
        ).mockImplementation(async (...args) => {
          markAccountingStarted?.()
          await accountingBlocked
          return recordConnection(...args)
        })
      }

      const privateCanary = "private-final-send-canary"
      const fetchMock = vi.fn<typeof fetch>(async () =>
        route === "models"
          ? modelInfoResponse([privateCanary])
          : Response.json({
              choices: [
                {
                  finish_reason: "stop",
                  index: 0,
                  message: { content: privateCanary, role: "assistant" },
                },
              ],
              id: "chatcmpl-final-send-race",
              object: "chat.completion",
              usage: { total_tokens: 1 },
            }),
      )
      vi.stubGlobal("fetch", fetchMock)
      const adminServer = buildServer()
      const created = await createApp(adminServer, [privateCanary])
      if (route === "models") {
        configureAuthoritativeModelProjection([privateCanary])
      }
      const token = bearerForCredential(created.credential)
      const gatewayServer = Fastify({ logger: false })
      registerAppGatewayRoutes(gatewayServer, {
        isolationGate,
      })

      const responsePromise = gatewayServer.inject(
        route === "models"
          ? {
              headers: { authorization: `Bearer ${token}` },
              method: "GET",
              url: "/api/app-gateway/v1/models",
            }
          : {
              headers: { authorization: `Bearer ${token}` },
              method: "POST",
              payload: {
                messages: [{ content: "private request", role: "user" }],
                model: privateCanary,
              },
              url: "/api/app-gateway/v1/chat/completions",
            },
      )
      await accountingStarted
      const engagement = isolationGate.engage(isolationEngagementContext)
      finishAccounting?.()
      const response = await responsePromise

      expect(response.statusCode).toBe(200)
      expect(response.body).toContain(privateCanary)
      expect(fetchMock).toHaveBeenCalledOnce()
      await expect(engagement).resolves.toEqual({ status: "engaged" })
      expect(isolationGate.stateForTest().activeLeases).toBe(0)
      expect(
        getAuditEventsForTest().filter(
          (event) =>
            event.action === `connected_app.gateway.${route}` &&
            event.metadata.outcome === "succeeded",
        ),
      ).toHaveLength(1)
      await gatewayServer.close()
      await adminServer.close()
    },
  )

  it("holds the streaming terminal frame until success accounting wins finalization", async () => {
    configureGatewayEnvironment()
    const isolationGate = await openIsolationGate()
    let markAccountingStarted: (() => void) | undefined
    const accountingStarted = new Promise<void>((resolve) => {
      markAccountingStarted = resolve
    })
    let finishAccounting: (() => void) | undefined
    const accountingBlocked = new Promise<void>((resolve) => {
      finishAccounting = resolve
    })
    const reconcile = connectedAppService.reconcileConnectedAppGatewayUsage
    vi.spyOn(
      connectedAppService,
      "reconcileConnectedAppGatewayUsage",
    ).mockImplementation(async (...args) => {
      markAccountingStarted?.()
      await accountingBlocked
      return reconcile(...args)
    })
    const falseTerminalCanary = "json [DONE] is not an SSE terminal"
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () =>
        sseResponse([
          `data: {"choices":[{"delta":{"content":"${falseTerminalCanary}"}}]}\r\n\r\n`,
          'data: {"usage":{"prompt_tokens":1,"completion_tokens":2,"total_tokens":3}}\r\n\r\ndata: [DO',
          "NE]\r\n\r\n",
        ]),
      ),
    )
    const adminServer = buildServer()
    const created = await createApp(adminServer, ["local-stream"])
    const token = bearerForCredential(created.credential)
    const gatewayServer = Fastify({ logger: false })
    registerAppGatewayRoutes(gatewayServer, { isolationGate })

    const responsePromise = gatewayServer.inject({
      headers: { authorization: `Bearer ${token}` },
      method: "POST",
      payload: {
        messages: [{ content: "private request", role: "user" }],
        model: "local-stream",
        stream: true,
      },
      url: "/api/app-gateway/v1/chat/completions",
    })
    await accountingStarted
    let engagementSettled = false
    const engagement = isolationGate
      .engage(isolationEngagementContext)
      .then((result) => {
        engagementSettled = true
        return result
      })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(engagementSettled).toBe(false)

    finishAccounting?.()
    const response = await responsePromise
    expect(response.statusCode).toBe(200)
    expect(response.body).toContain(falseTerminalCanary)
    expect(response.body).toContain("data: [DONE]\r\n\r\n")
    await expect(engagement).resolves.toEqual({ status: "engaged" })
    expect(isolationGate.stateForTest().activeLeases).toBe(0)
    expect(
      getAuditEventsForTest().filter(
        (event) =>
          event.action === "connected_app.gateway.chat_completions" &&
          event.metadata.outcome === "succeeded",
      ),
    ).toHaveLength(1)
    await gatewayServer.close()
    await adminServer.close()
  })

  it.each([
    {
      chunks: ['data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'],
      label: "EOF without DONE",
      trailing: null,
    },
    {
      chunks: [
        'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n',
        "data: [DONE]\n\n: forbidden-tail\n\n",
      ],
      label: "bytes after DONE",
      trailing: "forbidden-tail",
    },
  ])("fails an incomplete stream with $label", async ({ chunks, trailing }) => {
    configureGatewayEnvironment()
    const isolationGate = await openIsolationGate()
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => sseResponse(chunks)),
    )
    const adminServer = buildServer()
    const created = await createApp(adminServer, ["local-stream"])
    const token = bearerForCredential(created.credential)
    const gatewayServer = Fastify({ logger: false })
    registerAppGatewayRoutes(gatewayServer, { isolationGate })

    const response = await gatewayServer.inject({
      headers: { authorization: `Bearer ${token}` },
      method: "POST",
      payload: {
        messages: [{ content: "private request", role: "user" }],
        model: "local-stream",
        stream: true,
      },
      url: "/api/app-gateway/v1/chat/completions",
    })

    expect(response.body).toContain("partial")
    expect(response.body).not.toContain("data: [DONE]")
    if (trailing) {
      expect(response.body).not.toContain(trailing)
    }
    expect(
      getAuditEventsForTest().filter(
        (event) =>
          event.action === "connected_app.gateway.chat_completions" &&
          event.metadata.outcome === "failed",
      ),
    ).toHaveLength(1)
    expect(isolationGate.stateForTest().activeLeases).toBe(0)
    await gatewayServer.close()
    await adminServer.close()
  })

  it("never exposes the streaming terminal frame when isolation wins first", async () => {
    configureGatewayEnvironment()
    const isolationGate = await openIsolationGate()
    let markUpstreamStarted: (() => void) | undefined
    const upstreamStarted = new Promise<void>((resolve) => {
      markUpstreamStarted = resolve
    })
    let deliverTerminal: (() => void) | undefined
    const terminalBlocked = new Promise<void>((resolve) => {
      deliverTerminal = resolve
    })
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => {
        const encoder = new TextEncoder()
        return new Response(
          new ReadableStream({
            async start(controller) {
              controller.enqueue(
                encoder.encode(
                  'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n',
                ),
              )
              markUpstreamStarted?.()
              await terminalBlocked
              controller.enqueue(encoder.encode("data: [DONE]\n\n"))
              controller.close()
            },
          }),
          {
            headers: { "content-type": "text/event-stream" },
            status: 200,
          },
        )
      }),
    )
    const adminServer = buildServer()
    const created = await createApp(adminServer, ["local-stream"])
    const token = bearerForCredential(created.credential)
    const gatewayServer = Fastify({ logger: false })
    registerAppGatewayRoutes(gatewayServer, { isolationGate })
    const responsePromise = gatewayServer.inject({
      headers: { authorization: `Bearer ${token}` },
      method: "POST",
      payload: {
        messages: [{ content: "private request", role: "user" }],
        model: "local-stream",
        stream: true,
      },
      url: "/api/app-gateway/v1/chat/completions",
    })
    await upstreamStarted
    await new Promise((resolve) => setTimeout(resolve, 0))
    const engagement = isolationGate.engage(isolationEngagementContext)
    deliverTerminal?.()

    const response = await responsePromise
    expect(response.body).not.toContain("data: [DONE]")
    await expect(engagement).resolves.toEqual({ status: "engaged" })
    expect(
      getAuditEventsForTest().filter(
        (event) =>
          event.action === "connected_app.gateway.chat_completions" &&
          event.metadata.outcome === "failed",
      ),
    ).toHaveLength(1)
    expect(isolationGate.stateForTest().activeLeases).toBe(0)
    await gatewayServer.close()
    await adminServer.close()
  })

  it("routes connected app model and chat calls through policy and records only the model-list connection", async () => {
    configureGatewayEnvironment()
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(modelInfoResponse(["local-a", "local-b"]))
      .mockResolvedValueOnce(modelInfoResponse(["local-a", "local-b"]))
      .mockResolvedValueOnce(
        Response.json({
          id: "chatcmpl-app",
          object: "chat.completion",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: "private completion",
              },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 12, completion_tokens: 30, total_tokens: 42 },
        }),
      )
    vi.stubGlobal("fetch", fetchMock)
    const server = buildServer()
    const created = await createApp(server, ["local-a"])
    configureAuthoritativeModelProjection(["local-a", "local-b"])
    const token = bearerForCredential(created.credential)

    const modelsResponse = await server.inject({
      method: "GET",
      url: "/api/app-gateway/v1/models",
      headers: { authorization: `Bearer ${token}` },
    })
    const chatResponse = await server.inject({
      method: "POST",
      url: "/api/app-gateway/v1/chat/completions",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        model: "local-a",
        messages: [{ role: "user", content: "private prompt" }],
      },
    })
    const detailResponse = await server.inject({
      method: "GET",
      url: `/api/admin/applications/connected-apps/${created.app.id}`,
      headers: adminHeaders,
    })

    expect(modelsResponse.statusCode).toBe(200)
    expect(modelsResponse.json()).toEqual({
      object: "list",
      data: [{ id: "local-a", object: "model", owned_by: "llm-machines" }],
    })
    expect(chatResponse.statusCode).toBe(200)
    expect(chatResponse.body).toContain("private completion")
    expect(chatResponse.body).not.toContain("internal-litellm-key")
    expect(fetchMock.mock.calls[0]?.[0]?.toString()).toBe(
      "http://litellm.test/model/info",
    )
    expect(fetchMock.mock.calls[1]?.[0]?.toString()).toBe(
      "http://litellm.test/model/info",
    )
    expect(fetchMock.mock.calls[2]?.[0]).toBe(
      "http://litellm.test/v1/chat/completions",
    )
    expect(
      (fetchMock.mock.calls[2]?.[1]?.headers as Record<string, string>)
        .Authorization,
    ).toBe("Bearer internal-litellm-key")
    expect(detailResponse.json().app.usage).toMatchObject({
      requests7d: 2,
      tokens7d: 42,
    })
    expect(detailResponse.json().app).toMatchObject({
      connectionStatus: "connected",
      lastConnectedAt: expect.any(String),
    })
    const auditEvents = getAuditEventsForTest()
    const gatewayEvents = auditEvents.filter((event) =>
      event.action.startsWith("connected_app.gateway."),
    )
    const auditText = JSON.stringify(auditEvents)
    const gatewayAuditText = JSON.stringify(gatewayEvents)
    expect(auditText).toContain("connected_app.gateway.models")
    expect(auditText).toContain("connected_app.gateway.chat_completions")
    expect(gatewayEvents).toHaveLength(2)
    for (const event of gatewayEvents) {
      expect(event.actorId).toBe("system")
      expect(event.metadata).toMatchObject({
        applicationId: created.app.id,
        correlationId: expect.any(String),
        credentialRecordId: expect.stringMatching(/^cak-/),
        outcome: "succeeded",
        sourceSystem: "console",
      })
      expect(event.metadata).not.toHaveProperty("authMethod")
      expect(event.metadata).not.toHaveProperty("environment")
    }
    expect(
      auditEvents.find(
        (event) => event.action === "admin.connected_app.created",
      ),
    ).toMatchObject({
      actorId: "admin-1",
      metadata: {
        applicationId: created.app.id,
        credentialRecordId: expect.stringMatching(/^cak-/),
        keycloakSubjectId: "admin-1",
      },
    })
    expect(gatewayAuditText).not.toContain('"tokens"')
    expect(gatewayAuditText).not.toContain('"model"')
    expect(gatewayAuditText).not.toContain("local-a")
    expect(gatewayAuditText).not.toContain("local-b")
    expect(gatewayAuditText).not.toContain("owned_by")
    expect(gatewayAuditText).not.toContain("private prompt")
    expect(gatewayAuditText).not.toContain("private completion")
    expect(gatewayAuditText).not.toContain(created.credential.apiKey)
    expect(auditText).not.toContain('"environment"')
    await server.close()
  })

  it("authorizes Auto chat from the live inventory and fails closed when it is unavailable", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-08-24T08:00:00.000Z"))
    configureGatewayEnvironment()
    await writeModelAdmissions([renderedAdmission("local-a", "profile-a")])
    configureAuthoritativeModelProjection(["local-a"])
    let configuredAliases = ["local-a"]
    let projectionUnavailable = false
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(input.toString())
      if (url.pathname === "/model/info" || url.pathname === "/v1/model/info") {
        if (projectionUnavailable) throw new Error("projection unavailable")
        return modelInfoResponse(configuredAliases)
      }
      if (url.pathname === "/v1/chat/completions") {
        return Response.json({
          choices: [],
          id: "chatcmpl-auto",
          object: "chat.completion",
          usage: { completion_tokens: 0, prompt_tokens: 1, total_tokens: 1 },
        })
      }
      throw new Error("unexpected upstream route")
    })
    vi.stubGlobal("fetch", fetchMock)
    const server = buildServer()
    const created = await createApp(server, [], { modelMode: "auto" })
    const token = bearerForCredential(created.credential)

    const initialModels = await server.inject({
      method: "GET",
      url: "/api/app-gateway/v1/models",
      headers: { authorization: `Bearer ${token}` },
    })
    expect(initialModels.json().data).toHaveLength(1)

    await writeModelAdmissions([
      renderedAdmission("local-a", "profile-a"),
      renderedAdmission("newly-admitted", "profile-b"),
    ])
    configuredAliases = ["local-a", "newly-admitted"]
    const newlyAdmitted = await server.inject({
      method: "POST",
      url: "/api/app-gateway/v1/chat/completions",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        messages: [{ content: "hello", role: "user" }],
        model: "newly-admitted",
      },
    })
    expect(newlyAdmitted.statusCode).toBe(200)

    projectionUnavailable = true
    const unavailable = await server.inject({
      method: "POST",
      url: "/api/app-gateway/v1/chat/completions",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        messages: [{ content: "hello", role: "user" }],
        model: "local-a",
      },
    })
    expect(unavailable.statusCode).toBe(503)
    expect(unavailable.json()).toMatchObject({
      title: "Key model inventory unavailable",
      detail:
        "The active measured model admission projection is temporarily unavailable.",
    })

    const fetchCountBeforeStale = fetchMock.mock.calls.length
    await writeModelAdmissions([
      renderedAdmission("local-a", "profile-a", "2026-08-23T00:00:00.000Z"),
      renderedAdmission(
        "newly-admitted",
        "profile-b",
        "2026-08-23T00:00:00.000Z",
      ),
    ])
    const stale = await server.inject({
      method: "GET",
      url: "/api/app-gateway/v1/models",
      headers: { authorization: `Bearer ${token}` },
    })
    expect(stale.statusCode).toBe(503)
    expect(stale.json()).toMatchObject({
      title: "Key model inventory stale",
      detail: "The active measured model admission evidence has expired.",
    })
    expect(fetchMock).toHaveBeenCalledTimes(fetchCountBeforeStale)
    await server.close()
  })

  it("PR-07 rejects normalized chat context over the byte limit before LiteLLM and accounts the failure", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("CONNECTED_APPS_KEYCLOAK_FIXTURE", "true")
    vi.stubEnv("LITELLM_URL", "http://litellm.test")
    vi.stubEnv("LITELLM_KEY", "internal-litellm-key")
    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal("fetch", fetchMock)
    const payload = {
      messages: [
        {
          content: [
            { text: "oversized Ž context", type: "text" },
            { type: "image_url", image_url: { url: "private://omitted" } },
          ],
          role: "user",
        },
      ],
      model: "local-a",
      tools: [
        {
          function: {
            name: "lookup",
            parameters: {
              properties: { id: { type: "string" } },
              type: "object",
            },
          },
          type: "function",
        },
      ],
    } satisfies ChatCompletionsBody
    const normalizedBytes = normalizedChatCompletionsBodyUtf8Bytes(payload)
    const server = buildServer()
    const created = await createApp(server, ["local-a"], {
      maxContextBytes: normalizedBytes - 1,
    })
    const token = bearerForCredential(created.credential)

    const response = await server.inject({
      method: "POST",
      url: "/api/app-gateway/v1/chat/completions",
      headers: { authorization: `Bearer ${token}` },
      payload,
    })
    const detailResponse = await server.inject({
      method: "GET",
      url: `/api/admin/applications/connected-apps/${created.app.id}`,
      headers: adminHeaders,
    })

    expect(response.statusCode).toBe(413)
    expect(response.json()).toMatchObject({
      detail: "The request exceeds this Key's maximum context size in bytes.",
      title: "Context limit exceeded",
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(detailResponse.json().app).toMatchObject({
      connectionStatus: "not_connected",
      lastConnectedAt: null,
      maxContextBytes: normalizedBytes - 1,
      usage: {
        failures7d: 1,
        lastUsedAt: expect.any(String),
        requests7d: 1,
        tokens7d: 0,
      },
    })
    const gatewayEvents = getAuditEventsForTest().filter(
      (event) => event.action === "connected_app.gateway.chat_completions",
    )
    expect(gatewayEvents).toHaveLength(1)
    expect(gatewayEvents[0]?.metadata).toMatchObject({ outcome: "failed" })
    await server.close()
  })

  it("rejects a Manual create when any selected alias is not admitted", async () => {
    configureGatewayEnvironment()
    configureAuthoritativeModelProjection(["local-a"])
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(modelInfoResponse(["local-a"]))
    vi.stubGlobal("fetch", fetchMock)
    const server = buildServer()
    const response = await server.inject({
      method: "POST",
      url: "/api/admin/applications/connected-apps",
      headers: {
        ...adminHeaders,
        "idempotency-key": "manual-invalid-alias",
      },
      payload: {
        allowedModels: ["local-a", "local-b"],
        modelMode: "manual",
        name: "Invalid Manual Key",
      },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({
      detail:
        "Manual model access may include only aliases in the active approved LiteLLM inventory.",
      title: "Invalid Key model access",
    })
    expect(fetchMock).toHaveBeenCalledOnce()
    await server.close()
  })

  it("normalizes connected-app content blocks before proxying to LiteLLM", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("CONNECTED_APPS_KEYCLOAK_FIXTURE", "true")
    vi.stubEnv("LITELLM_URL", "http://litellm.test")
    vi.stubEnv("LITELLM_KEY", "internal-litellm-key")
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({
        id: "chatcmpl-normalized-app",
        object: "chat.completion",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "ok" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
      }),
    )
    vi.stubGlobal("fetch", fetchMock)
    const server = buildServer()
    const created = await createApp(server, ["gemma-4-12B-it-Q4_K_M"])
    const token = bearerForCredential(created.credential)

    const response = await server.inject({
      method: "POST",
      url: "/api/app-gateway/v1/chat/completions",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        model: "gemma-4-12B-it-Q4_K_M",
        messages: [
          {
            role: "user",
            content: [
              { type: "output_text", text: "Reply with exactly pong." },
              { type: "tool_call", tool_call: { name: "noop" } },
            ],
          },
        ],
      },
    })

    expect(response.statusCode).toBe(200)
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: "gemma-4-12B-it-Q4_K_M",
      messages: [
        {
          role: "user",
          content: "Reply with exactly pong.\n[tool call content omitted]",
        },
      ],
    })
    await server.close()
  })

  it("passes standard non-streaming tool definitions and tool calls through without executing them", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("CONNECTED_APPS_KEYCLOAK_FIXTURE", "true")
    vi.stubEnv("LITELLM_URL", "http://litellm.test")
    vi.stubEnv("LITELLM_KEY", "internal-litellm-key")
    const upstreamResponse = {
      choices: [
        {
          finish_reason: "tool_calls",
          index: 0,
          message: {
            content: null,
            role: "assistant",
            tool_calls: [
              {
                function: {
                  arguments: '{"city":"Zagreb"}',
                  name: "lookup_weather",
                },
                id: "call_weather_1",
                type: "function",
              },
            ],
          },
        },
      ],
      id: "chatcmpl-tool-call",
      object: "chat.completion",
      usage: { completion_tokens: 8, prompt_tokens: 12, total_tokens: 20 },
    }
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(upstreamResponse))
    vi.stubGlobal("fetch", fetchMock)
    const server = buildServer()
    const created = await createApp(server, ["local-a"])
    const token = bearerForCredential(created.credential)
    const tools = [
      {
        function: {
          description: "Look up the weather for a city.",
          name: "lookup_weather",
          parameters: {
            additionalProperties: false,
            properties: { city: { type: "string" } },
            required: ["city"],
            type: "object",
          },
          strict: true,
        },
        type: "function",
      },
    ]
    const messages = [
      { content: "What is the weather?", role: "user" },
      {
        content: null,
        role: "assistant",
        tool_calls: [
          {
            function: {
              arguments: '{"city":"Zagreb"}',
              name: "lookup_weather",
            },
            id: "call_weather_prior",
            type: "function",
          },
        ],
      },
      {
        content: '{"condition":"sunny"}',
        role: "tool",
        tool_call_id: "call_weather_prior",
      },
    ]

    const response = await server.inject({
      method: "POST",
      url: "/api/app-gateway/v1/chat/completions",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        messages,
        model: "local-a",
        parallel_tool_calls: false,
        tool_choice: "auto",
        tools,
      },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(upstreamResponse)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const upstreamBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
    expect(upstreamBody).toMatchObject({
      messages,
      parallel_tool_calls: false,
      tool_choice: "auto",
      tools,
    })
    await server.close()
  })

  it("passes streaming tool-call deltas through without executing them", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("CONNECTED_APPS_KEYCLOAK_FIXTURE", "true")
    vi.stubEnv("LITELLM_URL", "http://litellm.test")
    vi.stubEnv("LITELLM_KEY", "internal-litellm-key")
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        sseResponse([
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_weather_2","type":"function","function":{"name":"lookup_weather","arguments":"{\\"city\\":\\"Zagreb\\"}"}}]},"finish_reason":"tool_calls","index":0}]}\n\n',
          'data: {"choices":[],"usage":{"total_tokens":21}}\n\n',
          "data: [DONE]\n\n",
        ]),
      )
    vi.stubGlobal("fetch", fetchMock)
    const server = buildServer()
    const created = await createApp(server, ["local-a"])
    const token = bearerForCredential(created.credential)
    const tools = [
      {
        function: {
          name: "lookup_weather",
          parameters: {
            properties: { city: { type: "string" } },
            required: ["city"],
            type: "object",
          },
        },
        type: "function",
      },
    ]

    const response = await server.inject({
      method: "POST",
      url: "/api/app-gateway/v1/chat/completions",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        messages: [{ content: "What is the weather?", role: "user" }],
        model: "local-a",
        stream: true,
        tool_choice: "auto",
        tools,
      },
    })

    expect(response.statusCode).toBe(200)
    expect(response.body).toContain('"tool_calls"')
    expect(response.body).toContain('"lookup_weather"')
    expect(response.body).toContain("data: [DONE]")
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const upstreamBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
    expect(upstreamBody).toMatchObject({
      stream: true,
      stream_options: { include_usage: true },
      tool_choice: "auto",
      tools,
    })
    await server.close()
  })

  it("sanitizes connected-app model-list fetch exceptions", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("CONNECTED_APPS_KEYCLOAK_FIXTURE", "true")
    vi.stubEnv("LITELLM_URL", "http://litellm.example.test")
    vi.stubEnv("LITELLM_KEY", "internal-litellm-key")
    const server = buildServer()
    const created = await createApp(server, ["local-a"])
    configureAuthoritativeModelProjection(
      ["local-a"],
      "http://litellm.example.test",
    )
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error(
          "dial tcp litellm.example.test with token internal-litellm-key",
        )
      }),
    )
    const token = bearerForCredential(created.credential)

    const response = await server.inject({
      method: "GET",
      url: "/api/app-gateway/v1/models",
      headers: { authorization: `Bearer ${token}` },
    })
    const detailResponse = await server.inject({
      method: "GET",
      url: `/api/admin/applications/connected-apps/${created.app.id}`,
      headers: adminHeaders,
    })

    expect(response.statusCode).toBe(503)
    expect(response.json()).toMatchObject({
      title: "Key model inventory unavailable",
      detail:
        "The active measured model admission projection is temporarily unavailable.",
    })
    expect(response.body).not.toContain("litellm.example.test")
    expect(response.body).not.toContain("internal-litellm-key")
    expect(detailResponse.json().app).toMatchObject({
      connectionStatus: "degraded",
      lastConnectedAt: null,
    })
    const modelEvents = getAuditEventsForTest().filter(
      (event) => event.action === "connected_app.gateway.models",
    )
    expect(modelEvents).toHaveLength(1)
    expect(modelEvents[0]?.metadata).toMatchObject({ outcome: "failed" })
    expect(modelEvents[0]?.metadata).not.toHaveProperty("environment")
    await server.close()
  })

  it("accounts for authenticated invalid requests without forwarding content", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("CONNECTED_APPS_KEYCLOAK_FIXTURE", "true")
    const server = buildServer()
    const created = await createApp(server, ["local-a"])
    const token = bearerForCredential(created.credential)

    const rejected = await server.inject({
      method: "POST",
      url: "/api/app-gateway/v1/chat/completions",
      headers: { authorization: `Bearer ${token}` },
      payload: { model: "local-a" },
    })
    const detailResponse = await server.inject({
      method: "GET",
      url: `/api/admin/applications/connected-apps/${created.app.id}`,
      headers: adminHeaders,
    })

    expect(rejected.statusCode).toBe(400)
    expect(detailResponse.json().app).toMatchObject({
      connectionStatus: "not_connected",
      lastConnectedAt: null,
      usage: {
        failures7d: 1,
        lastUsedAt: expect.any(String),
        requests7d: 1,
        tokens7d: 0,
      },
    })
    expect(
      detailResponse
        .json()
        .app.credentials.find(
          (credential: { status: string }) => credential.status === "active",
        ),
    ).toMatchObject({ lastUsedAt: expect.any(String) })
    const gatewayEvents = getAuditEventsForTest().filter((event) =>
      event.action.startsWith("connected_app.gateway."),
    )
    expect(gatewayEvents).toHaveLength(1)
    expect(gatewayEvents[0]).toMatchObject({
      action: "connected_app.gateway.chat_completions",
      metadata: {
        applicationId: created.app.id,
        credentialRecordId: expect.stringMatching(/^cak-/),
        outcome: "failed",
        sourceSystem: "console",
      },
    })
    await server.close()
  })

  it("blocks disabled, unknown, and disallowed connected app runtime calls before LiteLLM", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("CONNECTED_APPS_KEYCLOAK_FIXTURE", "true")
    vi.stubEnv("LITELLM_URL", "http://litellm.test")
    vi.stubEnv("LITELLM_KEY", "internal-litellm-key")
    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal("fetch", fetchMock)
    const server = buildServer()
    const created = await createApp(server, ["local-a"])
    const token = bearerForCredential(created.credential)

    const disallowedModel = await server.inject({
      method: "POST",
      url: "/api/app-gateway/v1/chat/completions",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        model: "local-b",
        messages: [{ role: "user", content: "do not forward" }],
      },
    })
    const deniedDetail = await server.inject({
      method: "GET",
      url: `/api/admin/applications/connected-apps/${created.app.id}`,
      headers: adminHeaders,
    })
    await server.inject({
      method: "POST",
      url: `/api/admin/applications/connected-apps/${created.app.id}/disable`,
      headers: {
        ...adminHeaders,
        "idempotency-key": "disable-app-gateway-test",
      },
    })
    const disabled = await server.inject({
      method: "GET",
      url: "/api/app-gateway/v1/models",
      headers: { authorization: `Bearer ${token}` },
    })
    const unknown = await server.inject({
      method: "GET",
      url: "/api/app-gateway/v1/models",
      headers: {
        authorization: "Bearer llmm_t4_unknown_unknown-secret",
      },
    })
    const detailResponse = await server.inject({
      method: "GET",
      url: `/api/admin/applications/connected-apps/${created.app.id}`,
      headers: adminHeaders,
    })

    expect(disallowedModel.statusCode).toBe(403)
    expect(disallowedModel.json()).toMatchObject({ title: "Model not allowed" })
    expect(deniedDetail.json().app).toMatchObject({
      connectionStatus: "not_connected",
      lastConnectedAt: null,
    })
    expect(disabled.statusCode).toBe(403)
    expect(disabled.json()).toMatchObject({ title: "Key disabled" })
    expect(unknown.statusCode).toBe(401)
    expect(unknown.json()).toMatchObject({
      title: "Invalid Key token",
    })
    expect(detailResponse.json().app).toMatchObject({
      connectionStatus: "not_connected",
      lastConnectedAt: null,
    })
    expect(
      getAuditEventsForTest().filter(
        (event) =>
          event.action === "connected_app.gateway.models" &&
          event.metadata.outcome === "succeeded",
      ),
    ).toHaveLength(0)
    expect(fetchMock).not.toHaveBeenCalled()
    await server.close()
  })

  it("keeps existing OAuth connected app tokens working through the gateway", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("BFF_FALLBACK_MODELS", "local-a")
    vi.stubEnv("CONNECTED_APPS_KEYCLOAK_FIXTURE", "true")
    const server = buildServer()
    const created = await createApp(server, ["local-a"], {
      authMethod: "oauth_client_credentials",
    })

    const models = await server.inject({
      method: "GET",
      url: "/api/app-gateway/v1/models",
      headers: {
        authorization: `Bearer fixture-connected-app:${created.credential.clientId}`,
      },
    })
    const detailResponse = await server.inject({
      method: "GET",
      url: `/api/admin/applications/connected-apps/${created.app.id}`,
      headers: adminHeaders,
    })

    expect(created.credential.authMethod).toBe("oauth_client_credentials")
    expect(models.statusCode).toBe(200)
    expect(models.json()).toEqual({
      object: "list",
      data: [{ id: "local-a", object: "model", owned_by: "llm-machines" }],
    })
    expect(detailResponse.json().app).toMatchObject({
      connectionStatus: "connected",
      lastConnectedAt: expect.any(String),
    })
    const modelsEvents = getAuditEventsForTest().filter(
      (candidate) =>
        candidate.action === "connected_app.gateway.models" &&
        candidate.metadata.outcome === "succeeded",
    )
    expect(modelsEvents).toHaveLength(1)
    const event = modelsEvents[0]
    expect(event).toMatchObject({
      actorId: `fixture-subject:${created.credential.clientId}`,
      metadata: {
        applicationId: created.app.id,
        correlationId: expect.any(String),
        credentialRecordId: expect.any(String),
        keycloakSubjectId: `fixture-subject:${created.credential.clientId}`,
        outcome: "succeeded",
        sourceSystem: "console",
      },
    })
    expect(event?.metadata).not.toHaveProperty("environment")
    expect(
      getAuditEventsForTest().find(
        (candidate) => candidate.action === "admin.connected_app.created",
      ),
    ).toMatchObject({
      actorId: "admin-1",
      metadata: {
        applicationId: created.app.id,
        credentialRecordId: expect.any(String),
        keycloakSubjectId: "admin-1",
      },
    })
    expect(JSON.stringify(getAuditEventsForTest())).not.toContain(
      created.credential.clientSecret,
    )
    await server.close()
  })

  it("keeps connection testing passive before client authentication", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("BFF_FALLBACK_MODELS", "local-a")
    vi.stubEnv("CONNECTED_APPS_KEYCLOAK_FIXTURE", "true")
    const server = buildServer()
    const created = await createApp(server, ["local-a"])

    const locked = await server.inject({
      method: "GET",
      url: "/api/app-gateway/v1/models",
      headers: {
        authorization: "Bearer llmm_t4_locked_locked-secret",
      },
    })
    const tested = await server.inject({
      method: "POST",
      url: `/api/admin/applications/connected-apps/${created.app.id}/test`,
      headers: {
        ...adminHeaders,
        "idempotency-key": "connected-app-gateway-passive-test",
      },
    })
    expect(locked.statusCode).toBe(401)
    expect(locked.json()).toMatchObject({
      title: "Invalid Key token",
    })
    expect(tested.statusCode).toBe(200)
    expect(tested.json()).toMatchObject({
      app: {
        connectionStatus: "not_connected",
        lastConnectedAt: null,
      },
      connectionStatus: "not_connected",
    })
    expect(
      getAuditEventsForTest().find(
        (event) =>
          event.action === "admin.connected_app.connection_evidence_read",
      ),
    ).toMatchObject({
      actorId: "admin-1",
      metadata: {
        applicationId: created.app.id,
        credentialRecordId: expect.stringMatching(/^cak-/),
        keycloakSubjectId: "admin-1",
      },
    })
    await server.close()
  })

  it("rejects fixture connected app tokens outside test runtime even when fixture mode is enabled", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("BFF_FIXTURE_MODE", "true")
    vi.stubEnv("CONNECTED_APPS_KEYCLOAK_FIXTURE", "true")
    const server = buildServer()
    const created = await createApp(server, ["local-a"], {
      authMethod: "oauth_client_credentials",
    })
    vi.stubEnv("NODE_ENV", "production")

    const response = await server.inject({
      method: "GET",
      url: "/api/app-gateway/v1/models",
      headers: {
        authorization: `Bearer fixture-connected-app:${created.credential.clientId}`,
      },
    })
    vi.stubEnv("NODE_ENV", "test")
    const detailResponse = await server.inject({
      method: "GET",
      url: `/api/admin/applications/connected-apps/${created.app.id}`,
      headers: adminHeaders,
    })

    expect(response.statusCode).toBe(401)
    expect(response.json()).toMatchObject({
      title: "Invalid Key token",
    })
    expect(detailResponse.json().app).toMatchObject({
      connectionStatus: "not_connected",
      lastConnectedAt: null,
    })
    expect(
      getAuditEventsForTest().filter(
        (event) => event.action === "connected_app.gateway.models",
      ),
    ).toHaveLength(0)
    await server.close()
  })

  it("does not connect a revoked in-flight Key and keeps a separately created Key isolated", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-07-31T12:00:00.000Z"))
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("LITELLM_URL", "http://litellm.test")
    vi.stubEnv("LITELLM_KEY", "internal-litellm-key")
    let signalModelRequestStarted: (() => void) | undefined
    let releaseModelRequest: ((response: Response) => void) | undefined
    const modelRequestStarted = new Promise<void>((resolve) => {
      signalModelRequestStarted = resolve
    })
    const pendingModelResponse = new Promise<Response>((resolve) => {
      releaseModelRequest = resolve
    })
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(async () => {
        signalModelRequestStarted?.()
        return pendingModelResponse
      })
      .mockResolvedValueOnce(modelInfoResponse(["local-a"]))
    vi.stubGlobal("fetch", fetchMock)
    const server = buildServer()
    const revokedCandidate = await createApp(server, ["local-a"])
    const independentKey = await createApp(server, ["local-a"])
    configureAuthoritativeModelProjection(["local-a"])
    const revokedToken = bearerForCredential(revokedCandidate.credential)
    const inFlightRequest = server.inject({
      method: "GET",
      url: "/api/app-gateway/v1/models",
      headers: { authorization: `Bearer ${revokedToken}` },
    })

    await modelRequestStarted
    const revoked = await server.inject({
      method: "POST",
      url: `/api/admin/applications/connected-apps/${revokedCandidate.app.id}/credentials/${revokedCandidate.credential.credentialId}/revoke`,
      headers: {
        ...adminHeaders,
        "idempotency-key": "connected-app-stale-key-revoke",
      },
    })
    releaseModelRequest?.(modelInfoResponse(["local-a"]))
    const inFlightResponse = await inFlightRequest
    const revokedDetail = await server.inject({
      method: "GET",
      url: `/api/admin/applications/connected-apps/${revokedCandidate.app.id}`,
      headers: adminHeaders,
    })
    const revokedKeySucceededEvents = getAuditEventsForTest().filter(
      (event) =>
        event.action === "connected_app.gateway.models" &&
        event.metadata.outcome === "succeeded" &&
        event.metadata.applicationId === revokedCandidate.app.id,
    )

    const independentResponse = await server.inject({
      method: "GET",
      url: "/api/app-gateway/v1/models",
      headers: {
        authorization: `Bearer ${bearerForCredential(independentKey.credential)}`,
      },
    })
    const independentDetail = await server.inject({
      method: "GET",
      url: `/api/admin/applications/connected-apps/${independentKey.app.id}`,
      headers: adminHeaders,
    })

    expect(revoked.statusCode).toBe(200)
    expect(inFlightResponse.statusCode).toBe(200)
    expect(revokedDetail.json().app).toMatchObject({
      connectionStatus: "not_connected",
      lastConnectedAt: null,
      status: "disabled",
    })
    expect(revokedKeySucceededEvents).toHaveLength(0)
    expect(independentResponse.statusCode).toBe(200)
    expect(independentDetail.json().app).toMatchObject({
      connectionStatus: "connected",
      lastConnectedAt: expect.any(String),
    })
    const successfulModelsEvents = getAuditEventsForTest().filter(
      (event) =>
        event.action === "connected_app.gateway.models" &&
        event.metadata.outcome === "succeeded",
    )
    expect(successfulModelsEvents).toHaveLength(1)
    expect(successfulModelsEvents[0]?.metadata).toMatchObject({
      applicationId: independentKey.app.id,
      credentialRecordId: independentKey.credential.credentialId,
    })
    expect(JSON.stringify(getAuditEventsForTest())).not.toContain(revokedToken)
    expect(JSON.stringify(getAuditEventsForTest())).not.toContain(
      independentKey.credential.apiKey,
    )

    const revokedKeyResponse = await server.inject({
      method: "GET",
      url: "/api/app-gateway/v1/models",
      headers: { authorization: `Bearer ${revokedToken}` },
    })
    expect(revokedKeyResponse.statusCode).toBe(401)
    expect(
      getAuditEventsForTest().filter(
        (event) =>
          event.action === "connected_app.gateway.models" &&
          event.metadata.outcome === "succeeded",
      ),
    ).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await server.close()
  })

  it("sanitizes upstream LiteLLM chat failures before returning them to apps", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("CONNECTED_APPS_KEYCLOAK_FIXTURE", "true")
    vi.stubEnv("LITELLM_URL", "http://litellm.test")
    vi.stubEnv("LITELLM_KEY", "internal-litellm-key")
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response("upstream leaked internal-litellm-key", { status: 502 }),
      )
    vi.stubGlobal("fetch", fetchMock)
    const server = buildServer()
    const created = await createApp(server, ["local-a"])
    const token = bearerForCredential(created.credential)

    const response = await server.inject({
      method: "POST",
      url: "/api/app-gateway/v1/chat/completions",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        model: "local-a",
        messages: [{ role: "user", content: "private prompt" }],
      },
    })

    expect(response.statusCode).toBe(502)
    expect(response.json()).toMatchObject({
      title: "LiteLLM chat completion failed",
    })
    expect(response.body).not.toContain("internal-litellm-key")
    expect(response.body).not.toContain("private prompt")
    await server.close()
  })

  it("records streamed usage tokens without storing streamed prompts or completions", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("CONNECTED_APPS_KEYCLOAK_FIXTURE", "true")
    vi.stubEnv("LITELLM_URL", "http://litellm.test")
    vi.stubEnv("LITELLM_KEY", "internal-litellm-key")
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        sseResponse([
          'data: {"choices":[{"delta":{"content":"streamed private completion"}}]}\n\n',
          'data: {"choices":[],"usage":',
          '{"total_tokens":17}}\n\n',
          "data: [DONE]\n\n",
        ]),
      )
    vi.stubGlobal("fetch", fetchMock)
    const server = buildServer()
    const created = await createApp(server, ["local-a"])
    const token = bearerForCredential(created.credential)

    const response = await server.inject({
      method: "POST",
      url: "/api/app-gateway/v1/chat/completions",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        model: "local-a",
        messages: [{ role: "user", content: "streamed private prompt" }],
        stream: true,
      },
    })
    const detailResponse = await server.inject({
      method: "GET",
      url: `/api/admin/applications/connected-apps/${created.app.id}`,
      headers: adminHeaders,
    })
    const upstreamBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))

    expect(response.statusCode).toBe(200)
    expect(response.body).toContain("streamed private completion")
    expect(upstreamBody).toMatchObject({
      stream: true,
      stream_options: { include_usage: true },
    })
    expect(detailResponse.json().app.usage).toMatchObject({
      requests7d: 1,
      tokens7d: 17,
    })
    const auditText = JSON.stringify(getAuditEventsForTest())
    expect(auditText).not.toContain('"tokens"')
    expect(auditText).not.toContain('"model"')
    expect(auditText).not.toContain("streamed private prompt")
    expect(auditText).not.toContain("streamed private completion")
    await server.close()
  })

  it("enforces RPS while the seven-day token threshold remains non-blocking", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("CONNECTED_APPS_KEYCLOAK_FIXTURE", "true")
    vi.stubEnv("LITELLM_URL", "http://litellm.test")
    vi.stubEnv("LITELLM_KEY", "internal-litellm-key")
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () =>
      Response.json({
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "ok" },
            finish_reason: "stop",
          },
        ],
        usage: { total_tokens: 4 },
      }),
    )
    vi.stubGlobal("fetch", fetchMock)
    const server = buildServer()
    const rateLimitedApp = await createApp(server, ["local-a"], {
      rateLimitRps: 1,
    })
    const rateLimitedToken = bearerForCredential(rateLimitedApp.credential)

    const first = await server.inject({
      method: "POST",
      url: "/api/app-gateway/v1/chat/completions",
      headers: { authorization: `Bearer ${rateLimitedToken}` },
      payload: {
        model: "local-a",
        messages: [{ role: "user", content: "first" }],
      },
    })
    const rateLimited = await server.inject({
      method: "GET",
      url: "/api/app-gateway/v1/models",
      headers: { authorization: `Bearer ${rateLimitedToken}` },
    })
    const rateLimitedDetail = await server.inject({
      method: "GET",
      url: `/api/admin/applications/connected-apps/${rateLimitedApp.app.id}`,
      headers: adminHeaders,
    })
    const thresholdApp = await createApp(server, ["local-a"], {
      tokenAlertThreshold7d: 4,
    })
    const thresholdToken = bearerForCredential(thresholdApp.credential)
    const thresholdPrimer = await server.inject({
      method: "POST",
      url: "/api/app-gateway/v1/chat/completions",
      headers: { authorization: `Bearer ${thresholdToken}` },
      payload: {
        model: "local-a",
        max_tokens: 4,
        messages: [{ role: "user", content: "threshold primer" }],
      },
    })
    const afterThreshold = await server.inject({
      method: "POST",
      url: "/api/app-gateway/v1/chat/completions",
      headers: { authorization: `Bearer ${thresholdToken}` },
      payload: {
        model: "local-a",
        max_tokens: 4,
        messages: [{ role: "user", content: "after threshold" }],
      },
    })
    const thresholdDetail = await server.inject({
      method: "GET",
      url: `/api/admin/applications/connected-apps/${thresholdApp.app.id}`,
      headers: adminHeaders,
    })

    expect(first.statusCode).toBe(200)
    expect(rateLimited.statusCode).toBe(429)
    expect(rateLimited.json()).toMatchObject({ title: "Rate limit exceeded" })
    expect(rateLimitedDetail.json().app).toMatchObject({
      connectionStatus: "not_connected",
      lastConnectedAt: null,
    })
    expect(thresholdPrimer.statusCode).toBe(200)
    expect(afterThreshold.statusCode).toBe(200)
    expect(thresholdDetail.json().app).toMatchObject({
      tokenAlertState: "reached",
      tokenAlertThreshold7d: 4,
      usage: {
        requests7d: 2,
        tokens7d: 8,
      },
    })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    await server.close()
  })

  it("does not exceed RPS under concurrent connected-app traffic", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("CONNECTED_APPS_KEYCLOAK_FIXTURE", "true")
    vi.stubEnv("LITELLM_URL", "http://litellm.test")
    vi.stubEnv("LITELLM_KEY", "internal-litellm-key")
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(
      async () =>
        new Promise<Response>((resolve) => {
          setTimeout(() => {
            resolve(
              Response.json({
                choices: [
                  {
                    finish_reason: "stop",
                    index: 0,
                    message: { content: "ok", role: "assistant" },
                  },
                ],
                usage: { total_tokens: 1 },
              }),
            )
          }, 15)
        }),
    )
    vi.stubGlobal("fetch", fetchMock)
    const server = buildServer()
    const created = await createApp(server, ["local-a"], {
      rateLimitRps: 1,
    })
    const token = bearerForCredential(created.credential)
    const request = {
      method: "POST" as const,
      url: "/api/app-gateway/v1/chat/completions",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        model: "local-a",
        messages: [{ role: "user", content: "concurrent" }],
      },
    }

    const responses = await Promise.all([
      server.inject(request),
      server.inject(request),
    ])

    expect(responses.map((response) => response.statusCode).sort()).toEqual([
      200, 429,
    ])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await server.close()
  })

  it("does not forward traffic beyond the configured concurrency protection", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("CONNECTED_APPS_KEYCLOAK_FIXTURE", "true")
    vi.stubEnv("LITELLM_URL", "http://litellm.test")
    vi.stubEnv("LITELLM_KEY", "internal-litellm-key")
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(
      async () =>
        new Promise<Response>((resolve) => {
          setTimeout(() => {
            resolve(
              Response.json({
                choices: [
                  {
                    finish_reason: "stop",
                    index: 0,
                    message: { content: "ok", role: "assistant" },
                  },
                ],
                usage: { total_tokens: 4 },
              }),
            )
          }, 15)
        }),
    )
    vi.stubGlobal("fetch", fetchMock)
    const server = buildServer()
    const created = await createApp(server, ["local-a"], {
      maxConcurrentRequests: 1,
    })
    const token = bearerForCredential(created.credential)
    const request = {
      method: "POST" as const,
      url: "/api/app-gateway/v1/chat/completions",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        model: "local-a",
        max_tokens: 4,
        messages: [{ role: "user", content: "concurrency protection" }],
      },
    }

    const responses = await Promise.all([
      server.inject(request),
      server.inject(request),
    ])
    const detailResponse = await server.inject({
      method: "GET",
      url: `/api/admin/applications/connected-apps/${created.app.id}`,
      headers: adminHeaders,
    })

    expect(responses.map((response) => response.statusCode).sort()).toEqual([
      200, 429,
    ])
    expect(
      responses.find((response) => response.statusCode === 429)?.json(),
    ).toMatchObject({ title: "Concurrency limit exceeded" })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(detailResponse.json().app.usage).toMatchObject({
      failures7d: 1,
      requests7d: 2,
      tokens7d: 4,
    })
    await server.close()
  })

  it("preserves request counters across gateway server instances in the same process", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("BFF_FALLBACK_MODELS", "local-a")
    vi.stubEnv("CONNECTED_APPS_KEYCLOAK_FIXTURE", "true")
    const firstServer = buildServer()
    const created = await createApp(firstServer, ["local-a"], {
      rateLimitRps: 1,
    })
    const token = bearerForCredential(created.credential)

    const first = await firstServer.inject({
      method: "GET",
      url: "/api/app-gateway/v1/models",
      headers: { authorization: `Bearer ${token}` },
    })
    const secondServer = buildServer()
    const second = await secondServer.inject({
      method: "GET",
      url: "/api/app-gateway/v1/models",
      headers: { authorization: `Bearer ${token}` },
    })

    expect(first.statusCode).toBe(200)
    expect(second.statusCode).toBe(429)
    expect(second.json()).toMatchObject({ title: "Rate limit exceeded" })
    await firstServer.close()
    await secondServer.close()
  })

  it("records known usage when the token alert threshold is disabled", async () => {
    vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
    vi.stubEnv("CONNECTED_APPS_KEYCLOAK_FIXTURE", "true")
    vi.stubEnv("LITELLM_URL", "http://litellm.test")
    vi.stubEnv("LITELLM_KEY", "internal-litellm-key")
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("provider failed", { status: 500 }))
      .mockResolvedValueOnce(
        Response.json({
          choices: [
            {
              finish_reason: "stop",
              index: 0,
              message: { content: "ok", role: "assistant" },
            },
          ],
          usage: { total_tokens: 4 },
        }),
      )
    vi.stubGlobal("fetch", fetchMock)
    const server = buildServer()
    const created = await createApp(server, ["local-a"], {
      rateLimitRps: 10,
    })
    const token = bearerForCredential(created.credential)
    const payload = {
      model: "local-a",
      max_tokens: 4,
      messages: [{ role: "user", content: "budget release" }],
    }

    const failed = await server.inject({
      method: "POST",
      url: "/api/app-gateway/v1/chat/completions",
      headers: { authorization: `Bearer ${token}` },
      payload,
    })
    const retried = await server.inject({
      method: "POST",
      url: "/api/app-gateway/v1/chat/completions",
      headers: { authorization: `Bearer ${token}` },
      payload,
    })
    const detailResponse = await server.inject({
      method: "GET",
      url: `/api/admin/applications/connected-apps/${created.app.id}`,
      headers: adminHeaders,
    })

    expect(failed.statusCode).toBe(500)
    expect(failed.json()).toMatchObject({
      title: "LiteLLM chat completion failed",
    })
    expect(retried.statusCode).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(detailResponse.json().app.usage).toMatchObject({
      failures7d: 1,
      requests7d: 2,
      tokens7d: 4,
    })
    await server.close()
  })
})

async function createApp(
  server: ReturnType<typeof buildServer>,
  models: string[],
  overrides: {
    authMethod?: "api_key" | "oauth_client_credentials"
    maxConcurrentRequests?: number | null
    maxContextBytes?: number | null
    modelMode?: "auto" | "manual"
    rateLimitRps?: number | null
    tokenAlertThreshold7d?: number | null
  } = {},
) {
  const limitPayload: {
    authMethod?: "api_key" | "oauth_client_credentials"
    maxConcurrentRequests?: number | null
    maxContextBytes?: number | null
    modelMode?: "auto" | "manual"
    rateLimitRps?: number | null
    tokenAlertThreshold7d?: number | null
  } = {}
  if (overrides.authMethod !== undefined) {
    limitPayload.authMethod = overrides.authMethod
  }
  if (overrides.maxConcurrentRequests !== undefined) {
    limitPayload.maxConcurrentRequests = overrides.maxConcurrentRequests
  }
  if (overrides.maxContextBytes !== undefined) {
    limitPayload.maxContextBytes = overrides.maxContextBytes
  }
  if (overrides.modelMode !== undefined) {
    limitPayload.modelMode = overrides.modelMode
  }
  if (overrides.rateLimitRps !== undefined) {
    limitPayload.rateLimitRps = overrides.rateLimitRps
  }
  if (overrides.tokenAlertThreshold7d !== undefined) {
    limitPayload.tokenAlertThreshold7d = overrides.tokenAlertThreshold7d
  }
  const response = await server.inject({
    method: "POST",
    url: "/api/admin/applications/connected-apps",
    headers: {
      ...adminHeaders,
      "idempotency-key": `create-connected-app-${models.join("-")}-${createCounter++}`,
    },
    payload: {
      allowedModels: models,
      description: "Integration used by app gateway tests.",
      name: `Gateway Test ${models.join(" ")}`,
      ...limitPayload,
    },
  })
  expect(response.statusCode).toBe(201)
  return response.json() as {
    app: { id: string }
    credential: {
      apiKey?: string
      authMethod: "api_key" | "oauth_client_credentials"
      clientId?: string
      clientSecret?: string
      credentialId: string
      keyPrefix: string | null
    }
  }
}

function configureGatewayEnvironment(): void {
  vi.stubEnv("BFF_SERVICE_API_KEY", "test-service-key")
  vi.stubEnv("CONNECTED_APPS_KEYCLOAK_FIXTURE", "true")
  vi.stubEnv("LITELLM_URL", "http://litellm.test")
  vi.stubEnv("LITELLM_KEY", "internal-litellm-key")
}

function configureModelAdmissionFixture(): void {
  vi.stubEnv("BFF_FIXTURE_MODE", "true")
  vi.stubEnv(
    "BFF_FALLBACK_MODELS",
    [
      "gemma-4-12B-it-Q4_K_M",
      "local-a",
      "local-b",
      "local-stream",
      "private-final-send-canary",
      "private-isolation-winner-canary",
    ].join(","),
  )
}

function configureAuthoritativeModelProjection(
  aliases: string[],
  baseUrl = "http://litellm.test",
): void {
  vi.stubEnv("BFF_FIXTURE_MODE", "false")
  vi.stubEnv("BFF_FALLBACK_MODELS", aliases.join(","))
  vi.stubEnv("INFERENCE_ALLOW_INTERNAL_TEST_PROFILES", "true")
  vi.stubEnv("ADMIN_LITELLM_BASE_URL", baseUrl)
  vi.stubEnv("ADMIN_LITELLM_API_KEY", "admin-read-key")
}

function modelInfoResponse(aliases: string[]): Response {
  return Response.json({
    data: aliases.map((modelName) => ({ model_name: modelName })),
  })
}

async function writeModelAdmissions(
  profiles: Record<string, unknown>[],
): Promise<void> {
  if (!modelAdmissionDirectory) {
    modelAdmissionDirectory = await mkdtemp(
      join(tmpdir(), "llmm-gateway-model-admission."),
    )
    vi.stubEnv("INFERENCE_MODEL_ADMISSION_DIR", modelAdmissionDirectory)
  }
  for (const [index, profile] of profiles.entries()) {
    await writeFile(
      join(modelAdmissionDirectory, `profile-${index + 1}.json`),
      JSON.stringify(profile),
    )
  }
}

function renderedAdmission(
  alias: string,
  profileId: string,
  validUntil = "2026-09-01T00:00:00.000Z",
): Record<string, unknown> {
  return {
    apiVersion: "inference-core.llm-machines/v1",
    capabilityAdvertisement: {
      freshness: {
        measuredAt: "2026-08-01T00:00:00.000Z",
        validUntil,
      },
      models: [
        {
          alias,
          contextTokens: 8192,
          maxConcurrentRequests: 1,
          maxOutputTokens: 2048,
          p95LatencyMilliseconds: 10,
          queue: { maxObservedDepth: null, state: "not_configured" },
          throughputTokensPerSecond: 20,
        },
      ],
      state: "ACTIVE_MEASURED",
    },
    coreCompatibilityFingerprint:
      "sha256:9249bdc91f2dc7ac8471de88aad851644a8b8526d57c5f1501e6c63db246d1d7",
    engine: {},
    kind: "RenderedInferenceDeliveryProfile",
    model: {},
    network: {},
    probes: {},
    qualification: {
      evidenceDigest: `sha256:${"2".repeat(64)}`,
      productionCapacityClaim: false,
      qualifiedProfileDigest: `sha256:${"3".repeat(64)}`,
      scope: "INTERNAL_TEST_ONLY",
    },
    rollback: {},
    source: { profileId, revision: 1 },
  }
}

async function openIsolationGate(
  authority: { read(): Promise<unknown> } = {
    async read() {
      return openIsolationAuthorityStatus()
    },
  },
): Promise<IsolationTrafficGate> {
  const gate = new IsolationTrafficGate(authority, { drainTimeoutMs: 1_000 })
  const prepared = await gate.prepareDisengage(isolationEngagementContext)
  if (
    prepared.status !== "prepared" ||
    !prepared.deactivationCommitReservation.enterCommitting()
  ) {
    throw new Error("Expected an open isolation gate fixture.")
  }
  prepared.deactivationCommitReservation.commit()
  return gate
}

function openIsolationAuthorityStatus() {
  return {
    activatedAt: null,
    activatedBySubjectId: null,
    effectiveTrafficState: "open",
    failureCode: null,
    revision: 0,
    runtimeQualified: false,
    state: "inactive",
    updatedAt: "2026-08-02T12:00:00.000Z",
    updatedBySubjectId: null,
  }
}

function bearerForCredential(credential: {
  apiKey?: string
  authMethod: "api_key" | "oauth_client_credentials"
  clientId?: string
}): string {
  if (credential.authMethod === "api_key" && credential.apiKey) {
    return credential.apiKey
  }
  return `fixture-connected-app:${credential.clientId ?? ""}`
}

function sseResponse(chunks: string[]): Response {
  return new Response(
    new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder()
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk))
        }
        controller.close()
      },
    }),
    {
      headers: { "content-type": "text/event-stream" },
      status: 200,
    },
  )
}
