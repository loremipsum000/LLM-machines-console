import Fastify from "fastify"
import { describe, expect, it } from "vitest"
import type { HumanRouteAuthorizationPolicy } from "../auth/authorization"
import { adminOnlyAdminRoutePolicyKeys, registerAdminRoutes } from "./admin"

const expectedAdminRoutePolicies = {
  "POST /api/admin/recovery/factor/commission": adminOnly(),
  "POST /api/admin/recovery/sessions": capability("console.operational.view"),
  "GET /api/admin/recovery/status": adminOnly(),
  "POST /api/admin/recovery/sessions/:id/revoke": capability(
    "console.operational.view",
  ),
  "GET /api/admin/isolation": capability("console.operational.view"),
  "POST /api/admin/isolation/activate": adminOnly(),
  "POST /api/admin/isolation/deactivate": adminOnly(),
  "GET /api/admin/audit": capability("console.operational.view"),
  "GET /api/admin/audit/export": capability("activity_audit.export"),
  "GET /api/admin/audit/export/verification-keys": capability(
    "activity_audit.export",
  ),
  "GET /api/admin/observability/alert-egress": capability(
    "console.operational.view",
  ),
  "POST /api/admin/observability/alert-egress": adminOnly(),
  "GET /api/admin/settings": capability("console.operational.view"),
  "POST /api/admin/settings/organization": adminOnly(),
  "POST /api/admin/settings/telemetry": adminOnly(),
  "GET /api/admin/team": capability("team.identity.view"),
  "GET /api/admin/team/scim": capability("team.identity.view"),
  "GET /api/admin/team/members/:id": capability("team.identity.view"),
  "POST /api/admin/team/members": capability("team.users_roles.manage"),
  "POST /api/admin/team/members/:id/generate-password": capability(
    "team.local_password.manage",
  ),
  "POST /api/admin/team/members/:id/disable": capability(
    "team.users_roles.manage",
  ),
  "POST /api/admin/team/members/:id/reactivate": capability(
    "team.users_roles.manage",
  ),
  "POST /api/admin/team/members/:id/delete": capability(
    "team.users_roles.manage",
  ),
  "GET /api/admin/applications/connected-apps": capability(
    "console.operational.view",
  ),
  "POST /api/admin/applications/connected-apps": capability(
    "applications.create_delete",
  ),
  "GET /api/admin/applications/connected-apps/:id": capability(
    "console.operational.view",
  ),
  "PATCH /api/admin/applications/connected-apps/:id": capability(
    "applications.policy.change",
  ),
  "POST /api/admin/applications/connected-apps/:id/test": capability(
    "applications.credentials.test_rotate_revoke",
  ),
  "POST /api/admin/applications/connected-apps/:id/rotate-credentials":
    capability("applications.credentials.test_rotate_revoke"),
  "POST /api/admin/applications/connected-apps/:id/disable": capability(
    "applications.disable",
  ),
  "POST /api/admin/applications/connected-apps/:id/enable": capability(
    "applications.reenable",
  ),
  "POST /api/admin/applications/connected-apps/:id/credentials/:credentialId/revoke":
    capability("applications.credentials.test_rotate_revoke"),
  "POST /api/admin/applications/connected-apps/:id/firecrawl/enable":
    capability("firecrawl.enable_reenable"),
  "PATCH /api/admin/applications/connected-apps/:id/firecrawl": capability(
    "applications.policy.change",
  ),
  "POST /api/admin/applications/connected-apps/:id/firecrawl/test": capability(
    "applications.credentials.test_rotate_revoke",
  ),
  "POST /api/admin/applications/connected-apps/:id/firecrawl/rotate-credentials":
    capability("applications.credentials.test_rotate_revoke"),
  "POST /api/admin/applications/connected-apps/:id/firecrawl/disable":
    capability("applications.disable"),
  "POST /api/admin/applications/connected-apps/:id/firecrawl/credentials/:credentialId/revoke":
    capability("applications.credentials.test_rotate_revoke"),
  "DELETE /api/admin/applications/connected-apps/:id": capability(
    "applications.create_delete",
  ),
  "GET /api/admin/hardware": capability("console.operational.view"),
  "GET /api/admin/inference": capability("console.operational.view"),
} as const

describe("Admin route authorization contract", () => {
  it("assigns every retained Admin route one reviewed policy", async () => {
    const actualPolicies: Record<string, HumanRouteAuthorizationPolicy> = {}
    const server = Fastify({ logger: false })
    server.addHook("onRoute", (route) => {
      const method = Array.isArray(route.method)
        ? route.method[0]
        : route.method
      if (method === "HEAD" || !route.url.startsWith("/api/admin/")) {
        return
      }
      const policy = route.config?.authorization
      if (policy) {
        actualPolicies[`${method} ${route.url}`] = policy
      }
    })

    registerAdminRoutes(server)

    expect(actualPolicies).toEqual(expectedAdminRoutePolicies)
    await server.close()
  })

  it("locks the exact reviewed Admin-only exception list", () => {
    expect(adminOnlyAdminRoutePolicyKeys).toEqual([
      "GET /api/admin/recovery/status",
      "POST /api/admin/recovery/factor/commission",
      "POST /api/admin/isolation/activate",
      "POST /api/admin/isolation/deactivate",
      "POST /api/admin/observability/alert-egress",
      "POST /api/admin/settings/organization",
      "POST /api/admin/settings/telemetry",
    ])
  })
})

function capability(
  capabilityName: Extract<
    HumanRouteAuthorizationPolicy,
    { kind: "capability" }
  >["capability"],
) {
  return { capability: capabilityName, kind: "capability" } as const
}

function adminOnly() {
  return { kind: "admin-only" } as const
}
