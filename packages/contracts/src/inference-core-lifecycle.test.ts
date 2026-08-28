import { describe, expect, it } from "vitest"
import {
  lifecycleComponents,
  lifecycleFailureCodeSchema,
  lifecycleOperationKindSchema,
  lifecycleOperationStateSchema,
  lifecycleSnapshotManifestAuthoritySchema,
  lifecycleSnapshotManifestSchema,
} from "./index"

const validAuthority = {
  capturedAt: "2026-08-01T19:45:00.000+02:00",
  components: [
    {
      artifactSha256: "a".repeat(64),
      component: "console_database",
      ordinal: 0,
      revision: "postgres:42.1-build_7",
    },
    {
      artifactSha256: "b".repeat(64),
      component: "keycloak",
      ordinal: 1,
      revision: "realm_8.0",
    },
    {
      artifactSha256: "c".repeat(64),
      component: "litellm",
      ordinal: 2,
      revision: "routes:17",
    },
    {
      artifactSha256: "d".repeat(64),
      component: "grafana",
      ordinal: 3,
      revision: "provisioning-12",
    },
  ],
  contentFree: true,
  emergencySessionsIncluded: false,
  operationId: "123e4567-e89b-42d3-a456-426614174001",
  plaintextSecretsIncluded: false,
  schemaVersion: 1,
  snapshotId: "123e4567-e89b-42d3-a456-426614174000",
  workloadContentIncluded: false,
}

describe("Inference Core lifecycle contracts", () => {
  it("locks retained components, operation kinds, states, and failure codes", () => {
    expect(lifecycleComponents).toEqual([
      "console_database",
      "keycloak",
      "litellm",
      "grafana",
    ])
    expect(lifecycleOperationKindSchema.options).toEqual([
      "snapshot",
      "restore",
    ])
    expect(lifecycleOperationStateSchema.options).toEqual([
      "prepared",
      "quiescing",
      "capturing",
      "validating",
      "restoring",
      "verifying",
      "resuming",
      "rolling_back",
      "succeeded",
      "rolled_back",
      "failed",
      "recovery_required",
    ])
    expect(lifecycleFailureCodeSchema.options).toEqual([
      "adapter_unavailable",
      "quiesce_failed",
      "capture_failed",
      "manifest_invalid",
      "consistency_mismatch",
      "restore_failed",
      "verification_failed",
      "rollback_failed",
      "resume_failed",
      "journal_failed",
    ])
  })

  it("accepts only the exact ordered component tuple", () => {
    const parsed =
      lifecycleSnapshotManifestAuthoritySchema.parse(validAuthority)

    expect(parsed.components.map(({ component }) => component)).toEqual([
      "console_database",
      "keycloak",
      "litellm",
      "grafana",
    ])
    expect(parsed.components.map(({ ordinal }) => ordinal)).toEqual([
      0, 1, 2, 3,
    ])

    const reversed = {
      ...validAuthority,
      components: [...validAuthority.components].reverse(),
    }
    expect(
      lifecycleSnapshotManifestAuthoritySchema.safeParse(reversed).success,
    ).toBe(false)
    expect(
      lifecycleSnapshotManifestAuthoritySchema.safeParse({
        ...validAuthority,
        components: validAuthority.components.slice(0, 3),
      }).success,
    ).toBe(false)
    expect(
      lifecycleSnapshotManifestAuthoritySchema.safeParse({
        ...validAuthority,
        components: [
          ...validAuthority.components,
          {
            artifactSha256: "e".repeat(64),
            component: "grafana",
            ordinal: 3,
            revision: "duplicate",
          },
        ],
      }).success,
    ).toBe(false)
  })

  it("requires the zero-content and zero-secret authority flags", () => {
    for (const [field, value] of [
      ["contentFree", false],
      ["workloadContentIncluded", true],
      ["plaintextSecretsIncluded", true],
      ["emergencySessionsIncluded", true],
    ] as const) {
      expect(
        lifecycleSnapshotManifestAuthoritySchema.safeParse({
          ...validAuthority,
          [field]: value,
        }).success,
      ).toBe(false)
    }
  })

  it("accepts only bounded opaque revisions", () => {
    const parseRevision = (revision: string) =>
      lifecycleSnapshotManifestAuthoritySchema.safeParse({
        ...validAuthority,
        components: [
          { ...validAuthority.components[0], revision },
          ...validAuthority.components.slice(1),
        ],
      }).success

    expect(parseRevision("a")).toBe(true)
    expect(parseRevision("postgres:42.1-build_7")).toBe(true)
    expect(parseRevision("a".repeat(255))).toBe(true)

    for (const revision of [
      "",
      ".leading-punctuation",
      "contains space",
      "/var/lib/product",
      "https://service.internal",
      "a".repeat(256),
    ]) {
      expect(parseRevision(revision)).toBe(false)
    }
  })

  it("requires lowercase 64-character SHA-256 values", () => {
    const parseHash = (artifactSha256: string) =>
      lifecycleSnapshotManifestAuthoritySchema.safeParse({
        ...validAuthority,
        components: [
          { ...validAuthority.components[0], artifactSha256 },
          ...validAuthority.components.slice(1),
        ],
      }).success

    expect(parseHash("a".repeat(64))).toBe(true)
    expect(parseHash("A".repeat(64))).toBe(false)
    expect(parseHash("a".repeat(63))).toBe(false)
    expect(
      lifecycleSnapshotManifestSchema.safeParse({
        ...validAuthority,
        manifestSha256: "F".repeat(64),
      }).success,
    ).toBe(false)
  })

  it("keeps authority and manifest objects strict and metadata-only", () => {
    expect(
      lifecycleSnapshotManifestSchema.parse({
        ...validAuthority,
        manifestSha256: "e".repeat(64),
      }),
    ).toMatchObject({ schemaVersion: 1 })

    for (const forbiddenField of [
      "metadata",
      "content",
      "path",
      "endpoint",
      "secret",
      "credential",
    ]) {
      expect(
        lifecycleSnapshotManifestAuthoritySchema.safeParse({
          ...validAuthority,
          [forbiddenField]: "forbidden",
        }).success,
      ).toBe(false)
    }

    expect(
      lifecycleSnapshotManifestAuthoritySchema.safeParse({
        ...validAuthority,
        components: [
          {
            ...validAuthority.components[0],
            path: "/var/lib/product",
          },
          ...validAuthority.components.slice(1),
        ],
      }).success,
    ).toBe(false)
    expect(
      lifecycleSnapshotManifestSchema.safeParse(validAuthority).success,
    ).toBe(false)
  })

  it("requires UUID identities and an offset-aware capture time", () => {
    expect(
      lifecycleSnapshotManifestAuthoritySchema.safeParse({
        ...validAuthority,
        capturedAt: "2026-08-01T19:45:00",
      }).success,
    ).toBe(false)
    expect(
      lifecycleSnapshotManifestAuthoritySchema.safeParse({
        ...validAuthority,
        snapshotId: "snapshot-1",
      }).success,
    ).toBe(false)
  })
})
