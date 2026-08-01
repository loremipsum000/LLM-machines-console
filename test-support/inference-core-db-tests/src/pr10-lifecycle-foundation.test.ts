import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { PGlite } from "@electric-sql/pglite"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

const migration = readFileSync(
  fileURLToPath(
    new URL(
      "../../../infra/migrations/0000_inference_core.sql",
      import.meta.url,
    ),
  ),
  "utf8",
)

const shaA = "a".repeat(64)
const shaB = "b".repeat(64)
const shaC = "c".repeat(64)
const shaD = "d".repeat(64)
const shaE = "e".repeat(64)

describe("PR-10 lifecycle persistence foundation", () => {
  let database: PGlite

  beforeEach(async () => {
    database = await PGlite.create()
    await database.exec(migration)
    await database.exec(`
      INSERT INTO common.human_identities (subject_id)
      VALUES ('pr10-admin')
    `)
  })

  afterEach(async () => {
    await database.close()
  })

  it("stores one content-free manifest with the exact component order", async () => {
    await insertPreparedOperation(
      database,
      "10000000-0000-4000-8000-000000000001",
      "20000000-0000-4000-8000-000000000001",
    )
    await insertManifest(
      database,
      "10000000-0000-4000-8000-000000000001",
      "20000000-0000-4000-8000-000000000001",
    )
    await database.exec(`
      INSERT INTO admin.lifecycle_snapshot_components (
        snapshot_id,
        component,
        ordinal,
        revision,
        artifact_sha256
      )
      VALUES
        (
          '20000000-0000-4000-8000-000000000001',
          'console_database',
          0,
          'postgres-16.4:rev_1',
          '${shaB}'
        ),
        (
          '20000000-0000-4000-8000-000000000001',
          'keycloak',
          1,
          'keycloak-26.0.7',
          '${shaC}'
        ),
        (
          '20000000-0000-4000-8000-000000000001',
          'litellm',
          2,
          'litellm:v1.74.7',
          '${shaD}'
        ),
        (
          '20000000-0000-4000-8000-000000000001',
          'grafana',
          3,
          'grafana_12.0.2',
          '${shaE}'
        )
    `)

    const manifest = await database.query<{
      component_count: number
      content_free: boolean
      emergency_sessions_included: boolean
      plaintext_secrets_included: boolean
      schema_version: number
      workload_content_included: boolean
    }>(`
      SELECT
        schema_version,
        content_free,
        workload_content_included,
        plaintext_secrets_included,
        emergency_sessions_included,
        component_count
      FROM admin.lifecycle_snapshot_manifests
    `)
    expect(manifest.rows).toEqual([
      {
        component_count: 4,
        content_free: true,
        emergency_sessions_included: false,
        plaintext_secrets_included: false,
        schema_version: 1,
        workload_content_included: false,
      },
    ])

    const components = await database.query<{
      component: string
      ordinal: number
      revision: string
    }>(`
      SELECT component, ordinal, revision
      FROM admin.lifecycle_snapshot_components
      ORDER BY ordinal
    `)
    expect(components.rows).toEqual([
      {
        component: "console_database",
        ordinal: 0,
        revision: "postgres-16.4:rev_1",
      },
      { component: "keycloak", ordinal: 1, revision: "keycloak-26.0.7" },
      { component: "litellm", ordinal: 2, revision: "litellm:v1.74.7" },
      { component: "grafana", ordinal: 3, revision: "grafana_12.0.2" },
    ])
  })

  it("keeps unsafe or recovery-required work from overlapping", async () => {
    await insertPreparedOperation(
      database,
      "11000000-0000-4000-8000-000000000001",
      "21000000-0000-4000-8000-000000000001",
    )

    await expect(
      insertPreparedOperation(
        database,
        "11000000-0000-4000-8000-000000000002",
        "21000000-0000-4000-8000-000000000002",
      ),
    ).rejects.toThrow()

    await database.exec(`
      UPDATE admin.lifecycle_operations
      SET
        state = 'recovery_required',
        failure_code = 'rollback_failed',
        completed_at = TIMESTAMPTZ '2099-01-01T00:00:00Z',
        updated_at = TIMESTAMPTZ '2099-01-01T00:00:00Z'
      WHERE id = '11000000-0000-4000-8000-000000000001'
    `)
    await expect(
      insertPreparedOperation(
        database,
        "11000000-0000-4000-8000-000000000002",
        "21000000-0000-4000-8000-000000000002",
      ),
    ).rejects.toThrow()

    await database.exec(`
      UPDATE admin.lifecycle_operations
      SET state = 'failed'
      WHERE id = '11000000-0000-4000-8000-000000000001'
    `)
    await insertPreparedOperation(
      database,
      "11000000-0000-4000-8000-000000000002",
      "21000000-0000-4000-8000-000000000002",
    )
  })

  it("enforces the operation kind-state and terminal metadata matrices", async () => {
    for (const state of [
      "restoring",
      "verifying",
      "rolling_back",
      "rolled_back",
    ]) {
      await expect(
        insertOperation(database, {
          completedAt: state === "rolled_back" ? "2099-01-01T00:00:00Z" : null,
          failureCode:
            state === "rolling_back" || state === "rolled_back"
              ? "restore_failed"
              : null,
          id: operationIdFor(state),
          kind: "snapshot",
          snapshotId: snapshotIdFor(state),
          state,
          updatedAt: "2099-01-01T00:00:00Z",
        }),
      ).rejects.toThrow()
    }

    await expect(
      insertOperation(database, {
        id: "12000000-0000-4000-8000-000000000001",
        kind: "restore",
        snapshotId: "22000000-0000-4000-8000-000000000001",
        state: "capturing",
      }),
    ).rejects.toThrow()
    await expect(
      insertOperation(database, {
        completedAt: "2099-01-01T00:00:00Z",
        id: "12000000-0000-4000-8000-000000000002",
        kind: "restore",
        snapshotId: "22000000-0000-4000-8000-000000000002",
        state: "failed",
        updatedAt: "2099-01-01T00:00:00Z",
      }),
    ).rejects.toThrow()
    await expect(
      insertOperation(database, {
        failureCode: "restore_failed",
        id: "12000000-0000-4000-8000-000000000003",
        kind: "restore",
        snapshotId: "22000000-0000-4000-8000-000000000003",
        state: "failed",
      }),
    ).rejects.toThrow()
    await expect(
      insertOperation(database, {
        completedAt: "2099-01-01T00:00:00Z",
        failureCode: "restore_failed",
        id: "12000000-0000-4000-8000-000000000004",
        kind: "restore",
        snapshotId: "22000000-0000-4000-8000-000000000004",
        state: "succeeded",
        updatedAt: "2099-01-01T00:00:00Z",
      }),
    ).rejects.toThrow()
    await expect(
      insertOperation(database, {
        completedAt: "2099-01-01T00:00:01Z",
        id: "12000000-0000-4000-8000-000000000006",
        kind: "restore",
        snapshotId: "22000000-0000-4000-8000-000000000006",
        state: "succeeded",
        updatedAt: "2099-01-01T00:00:00Z",
      }),
    ).rejects.toThrow()

    await insertOperation(database, {
      completedAt: "2099-01-01T00:00:00Z",
      id: "12000000-0000-4000-8000-000000000007",
      kind: "restore",
      snapshotId: "22000000-0000-4000-8000-000000000007",
      state: "succeeded",
      updatedAt: "2099-01-01T00:00:00Z",
    })
  })

  it("binds each manifest to the operation snapshot and fixed safe literals", async () => {
    await insertOperation(database, {
      completedAt: "2099-01-01T00:00:00Z",
      id: "13000000-0000-4000-8000-000000000001",
      kind: "snapshot",
      snapshotId: "23000000-0000-4000-8000-000000000001",
      state: "succeeded",
      updatedAt: "2099-01-01T00:00:00Z",
    })

    await expect(
      insertManifest(
        database,
        "13000000-0000-4000-8000-000000000001",
        "23000000-0000-4000-8000-000000000099",
      ),
    ).rejects.toThrow()
    await insertManifest(
      database,
      "13000000-0000-4000-8000-000000000001",
      "23000000-0000-4000-8000-000000000001",
    )

    for (const mutation of [
      "schema_version = 2",
      "manifest_sha256 = upper(manifest_sha256)",
      "content_free = false",
      "workload_content_included = true",
      "plaintext_secrets_included = true",
      "emergency_sessions_included = true",
      "component_count = 3",
    ]) {
      await expect(
        database.exec(`
          UPDATE admin.lifecycle_snapshot_manifests
          SET ${mutation}
          WHERE snapshot_id = '23000000-0000-4000-8000-000000000001'
        `),
      ).rejects.toThrow()
    }
  })

  it("rejects unsafe component order, revision, and artifact hashes", async () => {
    await insertPreparedOperation(
      database,
      "14000000-0000-4000-8000-000000000001",
      "24000000-0000-4000-8000-000000000001",
    )
    await insertManifest(
      database,
      "14000000-0000-4000-8000-000000000001",
      "24000000-0000-4000-8000-000000000001",
    )

    for (const values of [
      ["keycloak", 0, "keycloak-26.0.7", shaB],
      ["console_database", 0, "../postgres", shaB],
      ["console_database", 0, "postgres-16", shaB.toUpperCase()],
      ["unknown", 0, "unknown-1", shaB],
    ] as const) {
      await expect(
        insertComponent(database, {
          artifactSha256: values[3],
          component: values[0],
          ordinal: values[1],
          revision: values[2],
          snapshotId: "24000000-0000-4000-8000-000000000001",
        }),
      ).rejects.toThrow()
    }
  })

  it("enforces event sequencing, phase-component pairing, and failure codes", async () => {
    await insertPreparedOperation(
      database,
      "15000000-0000-4000-8000-000000000001",
      "25000000-0000-4000-8000-000000000001",
    )
    await database.exec(`
      INSERT INTO admin.lifecycle_operation_events (
        operation_id,
        sequence,
        operation_state,
        phase,
        outcome
      )
      VALUES (
        '15000000-0000-4000-8000-000000000001',
        0,
        'prepared',
        'operation',
        'started'
      )
    `)

    for (const values of [
      [-1, "prepared", "operation", null, "started", null],
      [1, "capturing", "capture", null, "started", null],
      [1, "prepared", "operation", "console_database", "started", null],
      [1, "unknown", "operation", null, "started", null],
      [1, "prepared", "operation", null, "failed", null],
      [1, "prepared", "operation", null, "succeeded", "journal_failed"],
      [10, "validating", "capture", "console_database", "started", null],
      [11, "restoring", "emergency_session_fence", null, "started", null],
      [12, "verifying", "emergency_session_reset", null, "started", null],
      [13, "validating", "credential_consistency", null, "started", null],
      [
        14,
        "quiescing",
        "discard_preparation",
        "console_database",
        "started",
        null,
      ],
      [15, "succeeded", "resume", "console_database", "succeeded", null],
    ] as const) {
      await expect(
        insertEvent(database, {
          component: values[3],
          failureCode: values[5],
          operationId: "15000000-0000-4000-8000-000000000001",
          operationState: values[1],
          outcome: values[4],
          phase: values[2],
          sequence: values[0],
        }),
      ).rejects.toThrow()
    }

    for (const event of [
      {
        component: null,
        operationState: "quiescing",
        phase: "emergency_session_fence",
        sequence: 1,
      },
      {
        component: "console_database",
        operationState: "validating",
        phase: "discard_preparation",
        sequence: 2,
      },
      {
        component: null,
        operationState: "resuming",
        phase: "emergency_session_reset",
        sequence: 3,
      },
      {
        component: "console_database",
        operationState: "capturing",
        phase: "capture",
        sequence: 4,
      },
      {
        component: null,
        operationState: "succeeded",
        phase: "operation",
        sequence: 5,
      },
    ] as const) {
      await insertEvent(database, {
        ...event,
        failureCode: null,
        operationId: "15000000-0000-4000-8000-000000000001",
        outcome: "succeeded",
      })
    }
    await insertEvent(database, {
      component: "console_database",
      failureCode: null,
      operationId: "15000000-0000-4000-8000-000000000001",
      operationState: "rolling_back",
      outcome: "succeeded",
      phase: "quiesce",
      sequence: 6,
    })
    await database.exec(`
      DELETE FROM admin.lifecycle_operations
      WHERE id = '15000000-0000-4000-8000-000000000001'
    `)
    const events = await database.query<{ count: number }>(`
      SELECT count(*)::int AS count
      FROM admin.lifecycle_operation_events
    `)
    expect(events.rows).toEqual([{ count: 0 }])
  })
})

async function insertPreparedOperation(
  database: PGlite,
  id: string,
  snapshotId: string,
): Promise<void> {
  await insertOperation(database, {
    id,
    kind: "snapshot",
    snapshotId,
    state: "prepared",
  })
}

async function insertOperation(
  database: PGlite,
  operation: {
    completedAt?: string | null
    failureCode?: string | null
    id: string
    kind: string
    snapshotId: string
    state: string
    updatedAt?: string | null
  },
): Promise<void> {
  await database.query(
    `
      INSERT INTO admin.lifecycle_operations (
        id,
        kind,
        state,
        actor_subject_id,
        correlation_id,
        snapshot_id,
        failure_code,
        updated_at,
        completed_at
      )
      VALUES ($1, $2, $3, 'pr10-admin', $4, $5, $6, COALESCE($7, now()), $8)
    `,
    [
      operation.id,
      operation.kind,
      operation.state,
      `correlation-${operation.id}`,
      operation.snapshotId,
      operation.failureCode ?? null,
      operation.updatedAt ?? null,
      operation.completedAt ?? null,
    ],
  )
}

async function insertManifest(
  database: PGlite,
  operationId: string,
  snapshotId: string,
): Promise<void> {
  await database.query(
    `
      INSERT INTO admin.lifecycle_snapshot_manifests (
        snapshot_id,
        operation_id,
        manifest_sha256,
        captured_at
      )
      VALUES ($1, $2, $3, TIMESTAMPTZ '2099-01-01T00:00:00Z')
    `,
    [snapshotId, operationId, shaA],
  )
}

async function insertComponent(
  database: PGlite,
  component: {
    artifactSha256: string
    component: string
    ordinal: number
    revision: string
    snapshotId: string
  },
): Promise<void> {
  await database.query(
    `
      INSERT INTO admin.lifecycle_snapshot_components (
        snapshot_id,
        component,
        ordinal,
        revision,
        artifact_sha256
      )
      VALUES ($1, $2, $3, $4, $5)
    `,
    [
      component.snapshotId,
      component.component,
      component.ordinal,
      component.revision,
      component.artifactSha256,
    ],
  )
}

async function insertEvent(
  database: PGlite,
  event: {
    component: string | null
    failureCode: string | null
    operationId: string
    operationState: string
    outcome: string
    phase: string
    sequence: number
  },
): Promise<void> {
  await database.query(
    `
      INSERT INTO admin.lifecycle_operation_events (
        operation_id,
        sequence,
        operation_state,
        phase,
        component,
        outcome,
        failure_code
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `,
    [
      event.operationId,
      event.sequence,
      event.operationState,
      event.phase,
      event.component,
      event.outcome,
      event.failureCode,
    ],
  )
}

function operationIdFor(state: string): string {
  const suffix = state.length.toString().padStart(12, "0")
  return `16000000-0000-4000-8000-${suffix}`
}

function snapshotIdFor(state: string): string {
  const suffix = (state.length + 100).toString().padStart(12, "0")
  return `26000000-0000-4000-8000-${suffix}`
}
