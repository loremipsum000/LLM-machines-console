import type { FastifyInstance, FastifyServerOptions } from "fastify"
import { afterEach, describe, expect, it, vi } from "vitest"

type RuntimeRoute = { method: string; url: string }
type RuntimeControl = { method: string; subject: string }

const runtimeRoutes = vi.hoisted(() => [] as RuntimeRoute[])
const runtimeControls = vi.hoisted(() => [] as RuntimeControl[])

vi.mock("fastify", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fastify")>()
  const fastify = actual.default
  return {
    ...actual,
    default: (options?: FastifyServerOptions) => {
      const server = fastify(options)
      const addHook = server.addHook.bind(server) as FastifyInstance["addHook"]
      addHook("onRoute", (options) => {
        if (
          Object.keys(options.constraints ?? {}).length > 0 ||
          "version" in options
        ) {
          throw new Error(
            "Fastify route constraints and versions are not allowed",
          )
        }
        const methods = Array.isArray(options.method)
          ? options.method
          : [options.method]
        for (const method of methods) {
          runtimeRoutes.push({ method, url: options.url })
        }
      })
      Object.defineProperty(server, "addHook", {
        configurable: true,
        value: ((hook: string, ...args: unknown[]) => {
          runtimeControls.push({ method: "addHook", subject: hook })
          if (hook !== "preHandler" && hook !== "onClose") {
            throw new Error(`Unreviewed Fastify runtime hook ${hook}`)
          }
          return Reflect.apply(addHook, server, [hook, ...args])
        }) as FastifyInstance["addHook"],
      })
      for (const method of [
        "register",
        "setErrorHandler",
        "setNotFoundHandler",
      ] as const) {
        Object.defineProperty(server, method, {
          configurable: true,
          value: (() => {
            runtimeControls.push({ method, subject: method })
            throw new Error(`Unreviewed Fastify runtime control ${method}`)
          }) as FastifyInstance[typeof method],
        })
      }
      return server
    },
  }
})

describe("Inference Core route characterization", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it("keeps Core available without Agentic configuration and matches the reviewed runtime route inventory", async () => {
    const removedEnvironment = removeAgenticEnvironment()
    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal("fetch", fetchMock)
    let server: Awaited<ReturnType<typeof createServer>> | undefined

    try {
      vi.resetModules()
      server = await createServer()
      await server.ready()

      expect(normalizeRoutes(runtimeRoutes)).toEqual(reviewedBffRoutes())
      expect(runtimeControls).toEqual([
        { method: "addHook", subject: "onClose" },
        { method: "addHook", subject: "preHandler" },
      ])

      for (const url of ["/livez", "/healthz", "/readyz"]) {
        const response = await server.inject({ method: "GET", url })
        expect(response.statusCode).toBe(200)
      }

      const models = await server.inject({
        method: "GET",
        url: "/api/app-gateway/v1/models",
      })
      const completion = await server.inject({
        method: "POST",
        url: "/api/app-gateway/v1/chat/completions",
        payload: {
          model: "example-model",
          messages: [{ role: "user", content: "transient request" }],
        },
      })

      expect(models.statusCode).toBe(401)
      expect(completion.statusCode).toBe(401)
      expect(fetchMock).not.toHaveBeenCalled()
    } finally {
      try {
        if (server) {
          await server.close()
        }
      } finally {
        restoreEnvironment(removedEnvironment)
      }
    }
  })

  it("matches the reviewed route and control inventories under production registration", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("DATABASE_URL", "postgresql://unused.invalid/characterization")
    let server: Awaited<ReturnType<typeof createServer>> | undefined
    try {
      vi.resetModules()
      server = await createServer()
      await server.ready()
      expect(normalizeRoutes(runtimeRoutes)).toEqual(reviewedBffRoutes())
      expect(runtimeControls).toEqual([
        { method: "addHook", subject: "onClose" },
        { method: "addHook", subject: "preHandler" },
      ])
    } finally {
      if (server) {
        await server.close()
      }
    }
  })

  it("keeps unapproved public API routes absent", async () => {
    const server = await createServer()
    try {
      for (const route of [
        { method: "POST", url: "/v1/responses" },
        { method: "POST", url: "/v1/embeddings" },
        { method: "POST", url: "/v1/assistants" },
        { method: "POST", url: "/v1/files" },
        { method: "POST", url: "/v1/batches" },
        { method: "POST", url: "/v2/search" },
        { method: "POST", url: "/v2/scrape" },
        { method: "POST", url: "/v2/crawl" },
      ] as const) {
        const response = await server.inject(route)
        expect(response.statusCode).toBe(404)
      }
    } finally {
      await server.close()
    }
  })

  it("rejects constrained route variants", async () => {
    const { default: fastify } = await import("fastify")
    const server = fastify()
    try {
      expect(() =>
        server.get(
          "/constrained",
          { constraints: { version: "1.0.0" } },
          async () => ({ ok: true }),
        ),
      ).toThrow("Fastify route constraints and versions are not allowed")
    } finally {
      await server.close()
    }
  })

  it("rejects unreviewed runtime hooks, plugins, and catch-all handlers", async () => {
    const { default: fastify } = await import("fastify")
    const controls = [
      (server: FastifyInstance) =>
        server.addHook("onRequest", async () => undefined),
      (server: FastifyInstance) =>
        server.setErrorHandler(async () => undefined),
      (server: FastifyInstance) =>
        server.setNotFoundHandler(async () => undefined),
      (server: FastifyInstance) => server.register(async () => undefined),
    ]
    for (const invoke of controls) {
      const server = fastify()
      try {
        expect(() => invoke(server)).toThrow(/Unreviewed Fastify runtime/)
      } finally {
        await server.close()
      }
    }
  })
})

async function createServer() {
  runtimeRoutes.length = 0
  runtimeControls.length = 0
  const { buildServer } = await import("../index")
  return buildServer()
}

function reviewedBffRoutes(): RuntimeRoute[] {
  const routes: RuntimeRoute[] = [
    { method: "GET", url: "/livez" },
    { method: "GET", url: "/healthz" },
    { method: "GET", url: "/readyz" },
    { method: "GET", url: "/api/admin/audit" },
    { method: "GET", url: "/api/admin/overview" },
    { method: "GET", url: "/api/admin/settings" },
    { method: "GET", url: "/api/admin/team" },
    { method: "GET", url: "/api/admin/team/scim" },
    { method: "GET", url: "/api/admin/team/csv-template" },
    { method: "GET", url: "/api/admin/team/groups/:id" },
    { method: "GET", url: "/api/admin/team/members/:id" },
    { method: "GET", url: "/api/admin/applications/connected-apps" },
    { method: "GET", url: "/api/admin/applications/connected-apps/:id" },
    { method: "GET", url: "/api/admin/hardware" },
    { method: "GET", url: "/api/admin/inference" },
    { method: "GET", url: "/api/app-gateway/v1/models" },
    { method: "POST", url: "/api/admin/settings/organization" },
    { method: "POST", url: "/api/admin/settings/telemetry" },
    { method: "POST", url: "/api/admin/team/import/preview" },
    { method: "POST", url: "/api/admin/team/import/commit" },
    { method: "POST", url: "/api/admin/team/groups" },
    { method: "POST", url: "/api/admin/team/groups/:id/update" },
    { method: "POST", url: "/api/admin/team/groups/:id/delete" },
    {
      method: "POST",
      url: "/api/admin/team/groups/:id/members/bulk-assign",
    },
    {
      method: "POST",
      url: "/api/admin/team/groups/:id/members/:memberId/remove",
    },
    { method: "POST", url: "/api/admin/team/members" },
    { method: "POST", url: "/api/admin/team/members/:id/invite" },
    {
      method: "POST",
      url: "/api/admin/team/members/:id/reset-password-email",
    },
    {
      method: "POST",
      url: "/api/admin/team/members/:id/generate-password",
    },
    { method: "POST", url: "/api/admin/team/members/:id/disable" },
    { method: "POST", url: "/api/admin/team/members/:id/reactivate" },
    { method: "POST", url: "/api/admin/team/members/:id/delete" },
    { method: "POST", url: "/api/admin/applications/connected-apps" },
    {
      method: "POST",
      url: "/api/admin/applications/connected-apps/:id/test",
    },
    {
      method: "POST",
      url: "/api/admin/applications/connected-apps/:id/rotate-credentials",
    },
    {
      method: "POST",
      url: "/api/admin/applications/connected-apps/:id/disable",
    },
    {
      method: "POST",
      url: "/api/admin/inference/model-updates/apply",
    },
    {
      method: "POST",
      url: "/api/app-gateway/v1/chat/completions",
    },
    {
      method: "PATCH",
      url: "/api/admin/applications/connected-apps/:id",
    },
  ]
  return normalizeRoutes(
    routes.flatMap(({ method, url }) =>
      method === "GET"
        ? [
            { method, url },
            { method: "HEAD", url },
          ]
        : [{ method, url }],
    ),
  )
}

function normalizeRoutes(routes: RuntimeRoute[]): RuntimeRoute[] {
  return [...routes].sort((left, right) =>
    `${left.method}\0${left.url}`.localeCompare(
      `${right.method}\0${right.url}`,
    ),
  )
}

function removeAgenticEnvironment(): Record<string, string> {
  const removed: Record<string, string> = {}
  for (const [name, value] of Object.entries(process.env)) {
    if (
      value !== undefined &&
      /(?:^|_)(?:AGENTIC|OPENCLAW|HERMES|NEMOCLAW|OPENSHELL)(?:_|$)/.test(name)
    ) {
      removed[name] = value
      delete process.env[name]
    }
  }
  return removed
}

function restoreEnvironment(environment: Record<string, string>): void {
  Object.assign(process.env, environment)
}
