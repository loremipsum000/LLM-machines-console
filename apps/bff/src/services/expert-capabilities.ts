export const expertSystemIds = [
  "keycloak",
  "litellm",
  "grafana",
  "alertmanager",
] as const

export type ExpertSystemId = (typeof expertSystemIds)[number]

export interface NativeAuditEvent {
  action: string
  applicationId: string | null
  correlationId: string
  credentialRecordId: string | null
  keycloakSubjectId: string
  occurredAt: string
  outcome: "succeeded" | "failed" | "denied"
  sourceEventId: string
  sourceSystem: ExpertSystemId
  targetId: string
  targetType: string
}

export interface NativeAuditSource {
  readonly system: ExpertSystemId
  collect(afterCursor: string | null): Promise<{
    cursor: string | null
    events: NativeAuditEvent[]
  }>
}

export interface ExpertCapability {
  auditIngestion: "not_proven" | "proven"
  consoleProjection: "read_only"
  directAccess: "disabled" | "enabled"
  nativeMutation: "disabled" | "enabled"
}

const disabledCapability: ExpertCapability = {
  auditIngestion: "not_proven",
  consoleProjection: "read_only",
  directAccess: "disabled",
  nativeMutation: "disabled",
}

export const expertCapabilities: Readonly<
  Record<ExpertSystemId, ExpertCapability>
> = {
  alertmanager: disabledCapability,
  grafana: disabledCapability,
  keycloak: disabledCapability,
  litellm: disabledCapability,
}

export function expertCapability(system: ExpertSystemId): ExpertCapability {
  return expertCapabilities[system]
}
