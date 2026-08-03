import { describe, expect, it } from "vitest"
import {
  productEdgeCustomerFacingTcpPorts,
  productEdgePrivateNativeSystems,
  productEdgePublicRoutes,
  productEdgeRouteSchema,
  productEdgeRuntimeQualification,
  productEdgeRuntimeQualificationSchema,
} from "./inference-core-ingress"

describe("inference-core Product edge contract", () => {
  it("publishes only the retained inference and Firecrawl API routes", () => {
    expect(productEdgePublicRoutes.map((route) => route.id)).toEqual([
      "inference-models",
      "inference-chat-completions",
      "firecrawl-search",
      "firecrawl-scrape",
    ])
    for (const route of productEdgePublicRoutes) {
      expect(productEdgeRouteSchema.parse(route)).toEqual(route)
      expect(route.hostId).toBe("console")
      expect(route.upstreamId).toBe("console-bff")
      expect(route.queryPolicy).toBe("forbid")
    }
  })

  it("does not grant a native administration surface", () => {
    expect(productEdgePrivateNativeSystems).toEqual([
      "alertmanager",
      "firecrawl-native",
      "grafana",
      "keycloak-admin",
      "litellm",
      "portainer",
      "prometheus",
    ])
    expect(JSON.stringify(productEdgePublicRoutes)).not.toMatch(
      /grafana|keycloak-admin|litellm|portainer|prometheus/,
    )
  })

  it("keeps the customer listener and runtime evidence boundary exact", () => {
    expect(productEdgeCustomerFacingTcpPorts).toEqual([443])
    expect(
      productEdgeRuntimeQualificationSchema.parse(
        productEdgeRuntimeQualification,
      ),
    ).toEqual(productEdgeRuntimeQualification)
    expect(new Set(Object.values(productEdgeRuntimeQualification))).toEqual(
      new Set(["NOT_EVALUATED_RUNTIME"]),
    )
  })
})
