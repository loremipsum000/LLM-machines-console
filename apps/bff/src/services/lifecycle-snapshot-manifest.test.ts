import { createHash } from "node:crypto"
import type { LifecycleSnapshotComponent } from "@llm-machines/contracts"
import { describe, expect, it } from "vitest"
import {
  LifecycleSnapshotManifestError,
  canonicalLifecycleSnapshotAuthority,
  createLifecycleSnapshotManifest,
  verifyLifecycleSnapshotManifestDigest,
} from "./lifecycle-snapshot-manifest"

const snapshotId = "11111111-1111-4111-8111-111111111111"
const operationId = "22222222-2222-4222-8222-222222222222"
const capturedAt = "2026-08-01T12:00:00.000+00:00"

describe("lifecycle snapshot manifest", () => {
  it("orders captures and hashes one fixed-key canonical authority", () => {
    const manifest = createLifecycleSnapshotManifest({
      capturedAt,
      captures: [captures[3], captures[1], captures[0], captures[2]],
      operationId,
      snapshotId,
    })

    expect(manifest.components.map(({ component }) => component)).toEqual([
      "console_database",
      "keycloak",
      "litellm",
      "grafana",
    ])
    const canonical = canonicalLifecycleSnapshotAuthority(manifest)
    expect(canonical).toBe(
      JSON.stringify({
        schemaVersion: 1,
        snapshotId,
        operationId,
        capturedAt,
        contentFree: true,
        workloadContentIncluded: false,
        plaintextSecretsIncluded: false,
        emergencySessionsIncluded: false,
        components: captures,
      }),
    )
    expect(manifest.manifestSha256).toBe(
      createHash("sha256").update(canonical, "utf8").digest("hex"),
    )
    expect(verifyLifecycleSnapshotManifestDigest(manifest)).toBe(true)
  })

  it("rejects duplicate, missing, and unsafe captures", () => {
    expect(() =>
      createLifecycleSnapshotManifest({
        capturedAt,
        captures: [captures[0], captures[0], captures[1], captures[2]],
        operationId,
        snapshotId,
      }),
    ).toThrowError(errorWithCode("duplicate_component"))

    expect(() =>
      createLifecycleSnapshotManifest({
        capturedAt,
        captures: captures.slice(0, 3),
        operationId,
        snapshotId,
      }),
    ).toThrowError(errorWithCode("missing_component"))

    expect(() =>
      createLifecycleSnapshotManifest({
        capturedAt,
        captures: [
          { ...captures[0], unexpectedField: "not-allowed" },
          ...captures.slice(1),
        ],
        operationId,
        snapshotId,
      }),
    ).toThrowError(errorWithCode("invalid_capture"))
  })

  it("rejects unsafe authority values and detects manifest tampering", () => {
    expect(() =>
      createLifecycleSnapshotManifest({
        capturedAt: "not-a-time",
        captures,
        operationId,
        snapshotId,
      }),
    ).toThrowError(errorWithCode("invalid_authority"))

    const manifest = createLifecycleSnapshotManifest({
      capturedAt,
      captures,
      operationId,
      snapshotId,
    })
    expect(
      verifyLifecycleSnapshotManifestDigest({
        ...manifest,
        components: manifest.components.map((component) =>
          component.component === "grafana"
            ? { ...component, revision: "changed" }
            : component,
        ),
      }),
    ).toBe(false)
    expect(
      verifyLifecycleSnapshotManifestDigest({
        ...manifest,
        manifestSha256: "A".repeat(64),
      }),
    ).toBe(false)
  })
})

function errorWithCode(code: string): LifecycleSnapshotManifestError {
  const error = new LifecycleSnapshotManifestError(
    code as LifecycleSnapshotManifestError["code"],
  )
  return error
}

const captures = [
  {
    component: "console_database",
    ordinal: 0,
    revision: "db-42",
    artifactSha256: "0".repeat(64),
  },
  {
    component: "keycloak",
    ordinal: 1,
    revision: "kc-17",
    artifactSha256: "1".repeat(64),
  },
  {
    component: "litellm",
    ordinal: 2,
    revision: "llm-8",
    artifactSha256: "2".repeat(64),
  },
  {
    component: "grafana",
    ordinal: 3,
    revision: "grafana-9",
    artifactSha256: "3".repeat(64),
  },
] as const satisfies readonly LifecycleSnapshotComponent[]
