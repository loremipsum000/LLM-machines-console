import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const source = readFileSync(
  new URL("inference-core-retention.ts", import.meta.url),
  "utf8",
)

describe("Inference Core Firecrawl retention boundary", () => {
  it("settles and accounts expired Firecrawl leases inside the bounded transaction", () => {
    expect(source).toContain(
      "UPDATE admin.application_firecrawl_request_ledger",
    )
    expect(source).toContain(
      "INSERT INTO admin.application_firecrawl_usage_daily",
    )
    expect(source).toContain(
      "UPDATE admin.application_firecrawl_credentials AS credential",
    )
    expect(source).toContain("database.transaction(async (transaction)")
    expect(source).toContain("SET LOCAL lock_timeout = '2s'")
    expect(source).toContain("SET LOCAL statement_timeout = '15s'")
  })

  it("prunes the exact Firecrawl metadata relations at inference-equivalent boundaries", () => {
    for (const relation of [
      "admin.application_firecrawl_rate_limit_windows",
      "admin.application_firecrawl_request_ledger",
      "admin.application_firecrawl_usage_daily",
    ]) {
      expect(source).toContain(`DELETE FROM ${relation}`)
    }

    expect(source.match(/\$\{usageCutoff\}::date/g)).toHaveLength(4)
    expect(source).toContain("WHERE expires_at <= clock_timestamp()")
    expect(source).toContain("WHERE state = 'settled'")
    expect(source).toContain("WHERE bucket_date < ${usageCutoff}::date")
  })

  it("keeps Firecrawl retention metadata-only and Redis-free", () => {
    const firecrawlSql = source.slice(
      source.indexOf("firecrawl_expired_requests AS"),
      source.indexOf("const abandonedRow"),
    )
    expect(firecrawlSql).not.toMatch(
      /\b(?:query|url|page|body|content|prompt|request_body|response_body|result_payload|secret)\b/i,
    )
    expect(source).not.toMatch(/\bredis\b/i)
  })

  it("retains audit events for 365 rolling days without deleting source cursors", () => {
    expect(source).toContain("DELETE FROM common.audit_events")
    expect(source).toContain("WHERE occurred_at < ${auditCutoff}::timestamptz")
    expect(source).toContain("365 * 24 * 60 * 60 * 1000")
    expect(source).not.toContain("DELETE FROM common.audit_source_cursors")
  })

  it("prunes expired Console session authority under the global retention lock", () => {
    for (const [relation, expiry] of [
      ["common.console_login_transactions", "expires_at"],
      ["common.console_sessions", "idle_expires_at"],
      ["common.console_logout_token_replays", "retain_until"],
    ] as const) {
      expect(source).toContain(`DELETE FROM ${relation}`)
      expect(source).toContain(`${expiry} <= \${transientCutoff}::timestamptz`)
    }
    expect(source.indexOf("const acquired = await")).toBeLessThan(
      source.indexOf("DELETE FROM common.console_login_transactions"),
    )
    expect(source).not.toMatch(/expert_ingress|litellm.*session/i)
  })
})
