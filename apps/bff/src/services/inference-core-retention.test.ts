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
})
