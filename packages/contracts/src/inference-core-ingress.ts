import { z } from "zod"

export const productEdgeSurfaceSchema = z.enum([
  "console",
  "identity",
  "inference",
  "firecrawl",
])
export type ProductEdgeSurface = z.infer<typeof productEdgeSurfaceSchema>

export const productEdgeHostIdSchema = z.enum([
  "api",
  "console",
  "firecrawl",
  "identity",
])
export type ProductEdgeHostId = z.infer<typeof productEdgeHostIdSchema>

export const productEdgeHeaderProfileSchema = z.enum([
  "console-browser",
  "customer-api",
  "identity-browser",
  "identity-application-token",
  "identity-server-form",
  "identity-server-jwks",
  "identity-backchannel",
])
export type ProductEdgeHeaderProfile = z.infer<
  typeof productEdgeHeaderProfileSchema
>

export const productEdgePathMatchSchema = z
  .object({
    kind: z.enum(["exact", "prefix", "regex"]),
    value: z.string().min(1).max(512),
  })
  .strict()
export type ProductEdgePathMatch = z.infer<typeof productEdgePathMatchSchema>

export const productEdgeRouteSchema = z
  .object({
    headerProfile: productEdgeHeaderProfileSchema,
    hostId: productEdgeHostIdSchema,
    id: z.string().regex(/^[a-z][a-z0-9-]{2,63}$/),
    methods: z
      .array(z.enum(["GET", "HEAD", "POST"]))
      .min(1)
      .refine((methods) => new Set(methods).size === methods.length),
    path: productEdgePathMatchSchema,
    queryPolicy: z.enum(["forbid", "console-navigation", "oidc-browser"]),
    surface: productEdgeSurfaceSchema,
    upstreamId: z.enum(["console-web", "console-bff", "keycloak-identity"]),
    upstreamPath: z.string().min(1).max(512),
  })
  .strict()
export type ProductEdgeRoute = z.infer<typeof productEdgeRouteSchema>

export const productEdgeRuntimeQualificationSchema = z
  .object({
    directNetworkNoBypass: z.literal("NOT_EVALUATED_RUNTIME"),
    dnsAndCertificateBinding: z.literal("NOT_EVALUATED_RUNTIME"),
    nativeListenerIsolation: z.literal("NOT_EVALUATED_RUNTIME"),
    packagedNginxBehavior: z.literal("NOT_EVALUATED_RUNTIME"),
  })
  .strict()
export type ProductEdgeRuntimeQualification = z.infer<
  typeof productEdgeRuntimeQualificationSchema
>

export const productEdgePublicRoutes = Object.freeze([
  {
    headerProfile: "customer-api",
    hostId: "api",
    id: "inference-models",
    methods: ["GET", "HEAD"],
    path: { kind: "exact", value: "/v1/models" },
    queryPolicy: "forbid",
    surface: "inference",
    upstreamId: "console-bff",
    upstreamPath: "/api/app-gateway/v1/models",
  },
  {
    headerProfile: "customer-api",
    hostId: "api",
    id: "inference-chat-completions",
    methods: ["POST"],
    path: { kind: "exact", value: "/v1/chat/completions" },
    queryPolicy: "forbid",
    surface: "inference",
    upstreamId: "console-bff",
    upstreamPath: "/api/app-gateway/v1/chat/completions",
  },
  {
    headerProfile: "customer-api",
    hostId: "firecrawl",
    id: "firecrawl-search",
    methods: ["POST"],
    path: { kind: "exact", value: "/v2/search" },
    queryPolicy: "forbid",
    surface: "firecrawl",
    upstreamId: "console-bff",
    upstreamPath: "/v2/search",
  },
  {
    headerProfile: "customer-api",
    hostId: "firecrawl",
    id: "firecrawl-scrape",
    methods: ["POST"],
    path: { kind: "exact", value: "/v2/scrape" },
    queryPolicy: "forbid",
    surface: "firecrawl",
    upstreamId: "console-bff",
    upstreamPath: "/v2/scrape",
  },
] as const satisfies readonly ProductEdgeRoute[])

export const productEdgePrivateNativeSystems = Object.freeze([
  "alertmanager",
  "firecrawl-native",
  "grafana",
  "keycloak-admin",
  "litellm",
  "portainer",
  "postgresql",
  "prometheus",
  "sglang",
] as const)

export const productEdgeCustomerFacingTcpPorts = Object.freeze([443] as const)

export const productEdgeRuntimeQualification = Object.freeze({
  directNetworkNoBypass: "NOT_EVALUATED_RUNTIME",
  dnsAndCertificateBinding: "NOT_EVALUATED_RUNTIME",
  nativeListenerIsolation: "NOT_EVALUATED_RUNTIME",
  packagedNginxBehavior: "NOT_EVALUATED_RUNTIME",
} as const satisfies ProductEdgeRuntimeQualification)
