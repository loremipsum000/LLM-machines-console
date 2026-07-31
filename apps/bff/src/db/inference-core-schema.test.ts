import { readFileSync } from "node:fs"
import { getTableColumns, getTableName } from "drizzle-orm"
import { describe, expect, it } from "vitest"
import {
  auditEvents,
  connectedAppApiKeys,
  connectedApps,
  consoleSettings,
  licenseState,
  users,
} from "./inference-core-schema"

describe("inference-core persistence boundary", () => {
  it("exports only the retained Product PostgreSQL tables", () => {
    expect(
      [
        auditEvents,
        users,
        connectedApps,
        connectedAppApiKeys,
        consoleSettings,
        licenseState,
      ].map(getTableName),
    ).toEqual([
      "audit_events",
      "users",
      "connected_apps",
      "connected_app_api_keys",
      "console_settings",
      "license_state",
    ])
  })

  it("keeps the compatibility columns but excludes manual break-glass state", () => {
    expect(Object.keys(getTableColumns(users))).toContain("persona")
    expect(Object.keys(getTableColumns(connectedApps))).toContain(
      "environments",
    )
    expect(Object.keys(getTableColumns(connectedAppApiKeys))).toContain(
      "environment",
    )
    expect(Object.keys(getTableColumns(consoleSettings))).not.toEqual(
      expect.arrayContaining([
        "breakGlassAdminId",
        "breakGlassUpdatedBy",
        "breakGlassUpdatedAt",
      ]),
    )
  })

  it("has no retired storage schema, vector type, or legacy client imports", () => {
    const schemaSource = source("inference-core-schema.ts")
    const clientSource = source("inference-core-client.ts")

    expect(schemaSource).not.toMatch(
      /\b(?:builder|hub|knowledge|knowledge_archive)\b/,
    )
    expect(schemaSource).not.toMatch(
      /\b(?:customType|vector|pgvector|urlPolicyRules)\b/i,
    )
    expect(clientSource).toContain('from "./inference-core-schema"')
    expect(clientSource).not.toContain('from "./schema"')
  })
})

function source(fileName: string): string {
  return readFileSync(new URL(fileName, import.meta.url), "utf8")
}
