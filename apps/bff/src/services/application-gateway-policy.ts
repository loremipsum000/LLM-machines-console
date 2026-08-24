export interface ApplicationGatewayPolicyIdentity {
  allowedModels: readonly string[]
  modelMode: "auto" | "manual"
  status: "disabled" | "enabled"
}

export type ApplicationGatewayPolicyResult =
  | { ok: true }
  | { detail: string; ok: false; status: 403; title: string }

export function evaluateApplicationGatewayPolicy(
  application: ApplicationGatewayPolicyIdentity,
  requestedModel: string | null,
): ApplicationGatewayPolicyResult {
  if (application.status !== "enabled") {
    return {
      detail: "The Key is disabled.",
      ok: false,
      status: 403,
      title: "Key disabled",
    }
  }
  if (
    application.modelMode === "manual" &&
    requestedModel &&
    !application.allowedModels.includes(requestedModel)
  ) {
    return {
      detail: "The Key is not allowed to use the requested model.",
      ok: false,
      status: 403,
      title: "Model not allowed",
    }
  }
  return { ok: true }
}
