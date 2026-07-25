import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const migration = readFileSync(
  join(process.cwd(), "../../infra/migrations/0022_admin_settings.sql"),
  "utf8",
)

describe("admin Settings schema migration", () => {
  it("defines the Console v2 Settings table set", () => {
    for (const table of [
      "admin.console_settings",
      "admin.url_policy_rules",
      "admin.license_state",
    ]) {
      expect(migration).toContain(`CREATE TABLE IF NOT EXISTS ${table}`)
    }
  })

  it("defines singleton Settings and license state read models", () => {
    expect(migration).toContain("id text PRIMARY KEY CHECK (id = 'singleton')")
    expect(migration).toContain("default_language IN ('en', 'hr')")
    expect(migration).toContain("telemetry_enabled boolean NOT NULL DEFAULT false")
    expect(migration).toContain("telemetry_payload_preview jsonb NOT NULL")
    expect(migration).toContain("break_glass_admin_id text")
    expect(migration).toContain("break_glass_updated_at timestamptz")
    expect(migration).toContain("ON CONFLICT (id) DO NOTHING")
  })

  it("defines URL policy rule lifecycle constraints", () => {
    expect(migration).toContain("rule_type IN ('trusted', 'forbidden')")
    expect(migration).toContain(
      "scope IN ('knowledge_ingestion', 'web_fetch', 'mcp_egress', 'all')",
    )
    expect(migration).toContain("status IN ('active', 'disabled')")
    expect(migration).toContain("UNIQUE (rule_type, normalized_pattern, scope)")
  })

  it("defines license state without enabling system update actions", () => {
    expect(migration).toContain(
      "subscription_state IN ('active', 'soft_grace', 'restricted', 'terminated', 'unknown', 'not_configured')",
    )
    expect(migration).toContain("License daemon not connected.")
    expect(migration).toContain("allowed_update_channels jsonb NOT NULL")
  })

  it("does not introduce secret-bearing Settings columns", () => {
    const normalized = migration.toLowerCase()

    expect(normalized).not.toContain("secret")
    expect(normalized).not.toContain("token")
    expect(normalized).not.toContain("password")
    expect(normalized).not.toContain("credential")
  })
})
