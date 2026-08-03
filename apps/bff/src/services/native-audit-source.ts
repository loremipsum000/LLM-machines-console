import type { NativeAuditSourceSystem } from "./audit"

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
  sourceSystem: NativeAuditSourceSystem
}

export interface NativeAuditSource {
  readonly system: NativeAuditSourceSystem
  collect(afterCursor: string | null): Promise<{
    cursor: string | null
    events: NativeAuditEvent[]
  }>
}
