import { z } from "zod"

export const inferenceCoreHumanRoleSchema = z.enum(["admin", "operator"])
export type InferenceCoreHumanRole = z.infer<
  typeof inferenceCoreHumanRoleSchema
>

export const inferenceCoreCapabilitySchema = z.enum([
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
export type InferenceCoreCapability = z.infer<
  typeof inferenceCoreCapabilitySchema
>

type CapabilityDecision = Readonly<Record<InferenceCoreHumanRole, boolean>>

export const inferenceCoreCapabilityMatrix = {
  "console.operational.view": { admin: true, operator: true },
  "applications.create_delete": { admin: true, operator: false },
  "applications.policy.change": { admin: true, operator: false },
  "firecrawl.enable_reenable": { admin: true, operator: false },
  "applications.reenable": { admin: true, operator: false },
  "applications.credentials.test_rotate_revoke": {
    admin: true,
    operator: false,
  },
  "applications.disable": { admin: true, operator: false },
  "team.users_roles.manage": { admin: true, operator: false },
  "team.local_password.manage": { admin: true, operator: false },
  "team.identity.view": { admin: true, operator: true },
  "updates.apply": { admin: true, operator: false },
  "activity_audit.export": { admin: true, operator: false },
  "isolation.activate": { admin: true, operator: false },
} as const satisfies Record<InferenceCoreCapability, CapabilityDecision>

export function roleHasInferenceCoreCapability(
  role: unknown,
  capability: unknown,
): boolean {
  const parsedRole = inferenceCoreHumanRoleSchema.safeParse(role)
  const parsedCapability = inferenceCoreCapabilitySchema.safeParse(capability)
  if (!parsedRole.success || !parsedCapability.success) {
    return false
  }

  return inferenceCoreCapabilityMatrix[parsedCapability.data][parsedRole.data]
}
