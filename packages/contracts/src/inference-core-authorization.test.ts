import { describe, expect, it } from "vitest"
import {
  inferenceCoreCapabilityMatrix,
  inferenceCoreCapabilitySchema,
  inferenceCoreHumanRoleSchema,
  roleHasInferenceCoreCapability,
} from "./index"

const operatorCapabilities = [
  "console.operational.view",
  "applications.credentials.test_rotate_revoke",
  "applications.disable",
  "team.identity.view",
] as const

describe("Inference Core authorization target", () => {
  it("locks the two human roles and the complete 13-capability matrix", () => {
    expect(inferenceCoreHumanRoleSchema.options).toEqual(["admin", "operator"])
    expect(inferenceCoreCapabilitySchema.options).toEqual([
      "console.operational.view",
      "applications.create_delete",
      "applications.policy.change",
      "firecrawl.enable_reenable",
      "applications.reenable",
      "applications.credentials.test_rotate_revoke",
      "applications.disable",
      "team.users_roles.manage",
      "team.local_password.manage",
      "team.identity.view",
      "updates.apply",
      "activity_audit.export",
      "isolation.activate",
    ])
    expect(Object.keys(inferenceCoreCapabilityMatrix)).toEqual(
      inferenceCoreCapabilitySchema.options,
    )
  })

  it("allows Admin every retained capability and Operator exactly four", () => {
    const allowedForOperator = inferenceCoreCapabilitySchema.options.filter(
      (capability) => roleHasInferenceCoreCapability("operator", capability),
    )

    expect(
      inferenceCoreCapabilitySchema.options.every((capability) =>
        roleHasInferenceCoreCapability("admin", capability),
      ),
    ).toBe(true)
    expect(allowedForOperator).toEqual(operatorCapabilities)
  })

  it("fails closed for retired roles, unknown roles, and unknown capabilities", () => {
    expect(
      roleHasInferenceCoreCapability("consumer", "console.operational.view"),
    ).toBe(false)
    expect(
      roleHasInferenceCoreCapability("builder", "console.operational.view"),
    ).toBe(false)
    expect(
      roleHasInferenceCoreCapability("owner", "console.operational.view"),
    ).toBe(false)
    expect(roleHasInferenceCoreCapability("admin", "unknown.capability")).toBe(
      false,
    )
    for (const retiredCapability of [
      "litellm.routes_keys.edit",
      "grafana.dashboards_alerting.edit",
      "grafana.view",
    ]) {
      expect(
        roleHasInferenceCoreCapability("admin", retiredCapability),
      ).toBe(false)
    }
  })
})
