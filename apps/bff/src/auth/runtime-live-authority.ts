import type { EmergencyRecoveryResolution } from "@llm-machines/contracts/inference-core"
import type { ConsoleSessionService } from "../services/console-session-service"
import type { EmergencyRecoveryService } from "../services/emergency-recovery"
import { resolveLiveHumanAuthority } from "../services/inference-core-keycloak-admin"
import type {
  Actor,
  AuthorizationOptions,
  EmergencyRecoverySessionResolver,
  LiveHumanAuthorityResolver,
} from "./authorization"

type RecoveryAuthority = Pick<EmergencyRecoveryService, "resolve">
type ConsoleSessionAuthority = Pick<ConsoleSessionService, "resolve">

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
  consoleSessionAuthority: ConsoleSessionAuthority,
): AuthorizationOptions {
  return {
    resolveCurrentIdentity: resolveRuntimeLiveHumanAuthority,
    resolveRecoverySession: recoveryResolver(recoveryAuthority, "unavailable"),
    resolveConsoleSession: (sessionHandle) =>
      consoleSessionAuthority.resolve(sessionHandle),
  }
}

export function createTestFixtureAuthorizationOptions(
  recoveryAuthority: RecoveryAuthority | null,
  consoleSessionAuthority?: ConsoleSessionAuthority,
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
    ...(consoleSessionAuthority
      ? {
          resolveConsoleSession: (sessionHandle: string) =>
            consoleSessionAuthority.resolve(sessionHandle),
        }
      : {}),
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
