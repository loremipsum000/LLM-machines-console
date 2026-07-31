import type { EmergencyRecoveryResolution } from "@llm-machines/contracts/inference-core"
import type { EmergencyRecoveryService } from "../services/emergency-recovery"
import { resolveLiveHumanAuthority } from "../services/inference-core-keycloak-admin"
import type {
  Actor,
  AuthorizationOptions,
  EmergencyRecoverySessionResolver,
  LiveHumanAuthorityResolver,
} from "./authorization"

type RecoveryAuthority = Pick<EmergencyRecoveryService, "resolve">

export const resolveRuntimeLiveHumanAuthority: LiveHumanAuthorityResolver =
  async (actor) => {
    const result = await resolveLiveHumanAuthority(actor.subject)
    if (result.status === "ok") {
      return result.authority.subject === actor.subject
        ? result.authority
        : null
    }
    if (result.status === "denied") {
      return null
    }
    throw new Error("Live human authority is unavailable.")
  }

export function createRuntimeAuthorizationOptions(
  recoveryAuthority: RecoveryAuthority | null,
): AuthorizationOptions {
  return {
    resolveCurrentIdentity: resolveRuntimeLiveHumanAuthority,
    resolveRecoverySession: recoveryResolver(recoveryAuthority, "unavailable"),
  }
}

export function createTestFixtureAuthorizationOptions(
  recoveryAuthority: RecoveryAuthority | null,
): AuthorizationOptions {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("Test fixture authority is available only in tests.")
  }
  return {
    resolveCurrentIdentity: async (actor: Actor) => ({
      enabled: true,
      role: actor.role,
      subject: actor.subject,
    }),
    resolveRecoverySession: recoveryResolver(recoveryAuthority, "inactive"),
  }
}

function recoveryResolver(
  recoveryAuthority: RecoveryAuthority | null,
  missingStatus: "inactive" | "unavailable",
): EmergencyRecoverySessionResolver {
  return async (sessionId, keycloakSubjectId) =>
    recoveryAuthority
      ? recoveryAuthority.resolve(sessionId, keycloakSubjectId)
      : missingRecoveryResolution(missingStatus)
}

function missingRecoveryResolution(
  status: EmergencyRecoveryResolution["status"],
): EmergencyRecoveryResolution {
  return status === "unavailable"
    ? { status: "unavailable" }
    : { status: "inactive" }
}
