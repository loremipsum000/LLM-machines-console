import { createHash, timingSafeEqual } from "node:crypto"
import {
  type LifecycleComponent,
  type LifecycleSnapshotComponent,
  type LifecycleSnapshotComponents,
  type LifecycleSnapshotManifest,
  type LifecycleSnapshotManifestAuthority,
  lifecycleComponents,
  lifecycleSnapshotComponentSchema,
  lifecycleSnapshotManifestAuthoritySchema,
  lifecycleSnapshotManifestSchema,
} from "@llm-machines/contracts"

export type LifecycleSnapshotManifestErrorCode =
  | "duplicate_component"
  | "invalid_authority"
  | "invalid_capture"
  | "invalid_manifest"
  | "missing_component"

export class LifecycleSnapshotManifestError extends Error {
  constructor(readonly code: LifecycleSnapshotManifestErrorCode) {
    super(`Lifecycle snapshot manifest rejected: ${code}.`)
    this.name = "LifecycleSnapshotManifestError"
  }
}

export interface CreateLifecycleSnapshotManifestInput {
  capturedAt: unknown
  captures: readonly unknown[]
  operationId: unknown
  snapshotId: unknown
}

/**
 * Creates the content-free authority for a coordinated consistency point.
 * This is intentionally not described as a transaction across components.
 */
export function createLifecycleSnapshotManifest(
  input: CreateLifecycleSnapshotManifestInput,
): LifecycleSnapshotManifest {
  const components = orderedComponents(input.captures)
  const authority = canonicalAuthority({
    capturedAt: input.capturedAt,
    components,
    operationId: input.operationId,
    snapshotId: input.snapshotId,
  })
  if (!lifecycleSnapshotManifestAuthoritySchema.safeParse(authority).success) {
    throw new LifecycleSnapshotManifestError("invalid_authority")
  }

  const manifest: LifecycleSnapshotManifest = {
    ...authority,
    manifestSha256: sha256(canonicalLifecycleSnapshotAuthority(authority)),
  }
  if (!lifecycleSnapshotManifestSchema.safeParse(manifest).success) {
    throw new LifecycleSnapshotManifestError("invalid_manifest")
  }
  return manifest
}

export function canonicalLifecycleSnapshotAuthority(
  authority: LifecycleSnapshotManifestAuthority,
): string {
  const canonical = canonicalAuthority({
    capturedAt: authority.capturedAt,
    components: orderedComponents(authority.components),
    operationId: authority.operationId,
    snapshotId: authority.snapshotId,
  })
  if (!lifecycleSnapshotManifestAuthoritySchema.safeParse(canonical).success) {
    throw new LifecycleSnapshotManifestError("invalid_authority")
  }
  return JSON.stringify(canonical)
}

export function verifyLifecycleSnapshotManifestDigest(
  candidate: unknown,
): candidate is LifecycleSnapshotManifest {
  const parsed = lifecycleSnapshotManifestSchema.safeParse(candidate)
  if (!parsed.success) {
    return false
  }

  try {
    const expected = Buffer.from(
      sha256(canonicalLifecycleSnapshotAuthority(parsed.data)),
      "hex",
    )
    const actual = Buffer.from(parsed.data.manifestSha256, "hex")
    return (
      expected.length === actual.length && timingSafeEqual(expected, actual)
    )
  } catch {
    return false
  }
}

function orderedComponents(
  captures: readonly unknown[],
): LifecycleSnapshotComponents {
  if (!Array.isArray(captures)) {
    throw new LifecycleSnapshotManifestError("invalid_capture")
  }

  const byComponent = new Map<LifecycleComponent, LifecycleSnapshotComponent>()
  for (const candidate of captures) {
    const parsed = lifecycleSnapshotComponentSchema.safeParse(candidate)
    if (!parsed.success) {
      throw new LifecycleSnapshotManifestError("invalid_capture")
    }
    if (byComponent.has(parsed.data.component)) {
      throw new LifecycleSnapshotManifestError("duplicate_component")
    }
    byComponent.set(parsed.data.component, parsed.data)
  }

  const missing = lifecycleComponents.some(
    (component) => !byComponent.has(component),
  )
  if (missing || byComponent.size !== lifecycleComponents.length) {
    throw new LifecycleSnapshotManifestError("missing_component")
  }

  return [
    canonicalComponent(byComponent.get("console_database"), "console_database"),
    canonicalComponent(byComponent.get("keycloak"), "keycloak"),
    canonicalComponent(byComponent.get("litellm"), "litellm"),
    canonicalComponent(byComponent.get("grafana"), "grafana"),
  ]
}

type ComponentCapture<Component extends LifecycleComponent> = Extract<
  LifecycleSnapshotComponent,
  { component: Component }
>

function canonicalComponent<Component extends LifecycleComponent>(
  capture: LifecycleSnapshotComponent | undefined,
  expectedComponent: Component,
): ComponentCapture<Component> {
  if (!capture || capture.component !== expectedComponent) {
    throw new LifecycleSnapshotManifestError("missing_component")
  }
  return {
    component: capture.component,
    ordinal: capture.ordinal,
    revision: capture.revision,
    artifactSha256: capture.artifactSha256,
  } as ComponentCapture<Component>
}

function canonicalAuthority(input: {
  capturedAt: unknown
  components: LifecycleSnapshotComponents
  operationId: unknown
  snapshotId: unknown
}): LifecycleSnapshotManifestAuthority {
  return {
    schemaVersion: 1,
    snapshotId: input.snapshotId,
    operationId: input.operationId,
    capturedAt: input.capturedAt,
    contentFree: true,
    workloadContentIncluded: false,
    plaintextSecretsIncluded: false,
    emergencySessionsIncluded: false,
    components: input.components,
  } as LifecycleSnapshotManifestAuthority
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex")
}
