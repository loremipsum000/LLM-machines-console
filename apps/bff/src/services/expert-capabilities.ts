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
  credentialPrefix: string | null
  credentialRecordId: string | null
  eventId: string
  keycloakSubjectId: string | null
  occurredAt: string
  outcome: "succeeded" | "failed" | "denied"
  recoveryReasonCode: string | null
  sourceSystem: ExpertSystemId
}

export interface NativeAuditSource {
  readonly system: ExpertSystemId
  collect(afterCursor: string | null): Promise<{
    cursor: string | null
    events: NativeAuditEvent[]
  }>
}

export interface ExpertCapability {
  auditIngestion:
    | "not_proven"
    | "implemented_pending_runtime_qualification"
    | "proven"
  consoleProjection: "read_only"
  directAccess: "disabled" | "enabled"
  mechanism: "product_owned_audited_ingress" | null
  nativeMutation: "disabled" | "enabled"
}

const pendingRuntimeCapability = Object.freeze<ExpertCapability>({
  auditIngestion: "implemented_pending_runtime_qualification",
  consoleProjection: "read_only",
  directAccess: "disabled",
  mechanism: "product_owned_audited_ingress",
  nativeMutation: "disabled",
})

export const expertCapabilities: Readonly<
  Record<ExpertSystemId, ExpertCapability>
> = Object.freeze({
  alertmanager: pendingRuntimeCapability,
  grafana: pendingRuntimeCapability,
  keycloak: pendingRuntimeCapability,
  litellm: pendingRuntimeCapability,
})

export function expertCapability(system: ExpertSystemId): ExpertCapability {
  return expertCapabilities[system]
}
