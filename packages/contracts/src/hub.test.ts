import { describe, expect, it } from "vitest"
import {
  artifactSchema,
  hubChatThreadSchema,
  hubEventSchema,
  hubHomeResponseSchema,
  hubModuleSchema,
  hubResourceSchema,
  mcpCatalogBundleSchema,
  taskSessionSchema,
} from "./hub"

const connector = {
  id: "internal-docs",
  displayName: "Internal Docs",
  description: "Read-only connector for appliance-local documentation search.",
  version: "0.1.0",
  sourceRef: "llm-machines/catalog/internal-docs@0.1.0",
  checksum: "sha256:internal-docs-placeholder",
  license: "LLM Machines",
  supportTier: "t2",
  maintainer: "LLM Machines",
  vettingStatus: "approved_read_only",
  requiredScopes: ["docs:read"],
  allowedEndpoints: ["docs.example.test:443"],
  readWrite: "read_only",
  dataClasses: ["documentation"],
  auditEvents: ["connector.docs.search"],
  runtimeProfile: "managed-tool-proxy",
  secretsRequired: [],
  lastReviewedAt: "2026-05-20T00:00:00.000Z",
}

describe("Hub contracts", () => {
  it("parses a Hub home response with discriminated modules", () => {
    const response = hubHomeResponseSchema.parse({
      persona: "admin",
      capabilities: ["admin_summary", "org_usage"],
      generatedAt: "2026-05-20T00:00:00.000Z",
      modules: [
        {
          id: "chat",
          type: "chat",
          title: "Chat",
          sourceStatus: "ok",
          unavailableReason: null,
        },
        {
          id: "recent-chats",
          type: "recent_chats",
          title: "Latest chats",
          sourceStatus: "ok",
          threads: [
            {
              id: "chat-ops-1",
              title: "Ops handoff",
              preview: "Summarize the last release blockers.",
              updatedAt: "2026-05-21T08:45:00.000Z",
              href: "https://librechat.example.test/c/chat-ops-1",
              model: "qwen3-35b-local",
              resourceName: "Summary Agent",
            },
          ],
        },
        {
          id: "admin-attention",
          type: "admin_attention",
          title: "Admin attention",
          sourceStatus: "degraded",
          criticalCount: 1,
          warningCount: 3,
          href: "/knowledge",
          items: [
            {
              id: "connector-vetting",
              severity: "critical",
              title: "Connector vetting required",
              body: "Two connector blueprints are visible but blocked.",
              source: "mcp_catalog",
              href: "/applications",
              count: 2,
            },
          ],
        },
      ],
    })

    expect(response.modules.map((module) => module.type)).toEqual([
      "chat",
      "recent_chats",
      "admin_attention",
    ])
  })

  it("parses mirrored recent chat threads", () => {
    expect(
      hubChatThreadSchema.parse({
        id: "chat-builder-agent-studio",
        title: "Builder Agent Studio test",
        preview: "Confirm the agent runtime path before publishing.",
        updatedAt: "2026-05-21T09:00:00.000Z",
        href: "https://librechat.example.test/c/chat-builder-agent-studio",
        model: "qwen3-35b-local",
        resourceName: "Summary Agent",
      }),
    ).toMatchObject({
      href: "https://librechat.example.test/c/chat-builder-agent-studio",
      model: "qwen3-35b-local",
    })
  })

  it("rejects modules that do not match their discriminator", () => {
    const result = hubModuleSchema.safeParse({
      id: "admin-attention",
      type: "admin_attention",
      title: "Admin attention",
      sourceStatus: "ok",
      criticalCount: 1,
      warningCount: 0,
    })

    expect(result.success).toBe(false)
  })

  it("parses MCP connector resources with vetting metadata", () => {
    const resource = hubResourceSchema.parse({
      id: "internal-docs",
      type: "mcp_connector",
      name: "Internal Docs",
      description:
        "Read-only connector for appliance-local documentation search.",
      state: "available",
      version: "0.1.0",
      owner: "LLM Machines",
      supportTier: "t2",
      sourceStatus: "ok",
      tags: ["mcp", "read_only"],
      connector,
      actions: [
        {
          id: "open",
          label: "View connector",
          href: "/resources/mcp_connector/internal-docs",
          enabled: true,
          requiresConfirmation: false,
        },
      ],
    })

    expect(resource.connector?.vettingStatus).toBe("approved_read_only")
  })

  it("parses signed MCP catalog bundle metadata", () => {
    const bundle = mcpCatalogBundleSchema.parse({
      payload: {
        version: "2026.05.20",
        generatedAt: "2026-05-20T00:00:00.000Z",
        entries: [connector],
      },
      signature: {
        alg: "ed25519",
        keyId: "llm-machines-dev",
        value: "base64-signature-placeholder",
      },
    })

    expect(bundle.payload.entries[0]?.id).toBe("internal-docs")
  })

  it("parses allowed Hub event types and rejects unknown events", () => {
    expect(
      hubEventSchema.parse({
        id: "11111111-1111-4111-8111-111111111111",
        type: "notification.created",
        createdAt: "2026-05-20T00:00:00.000Z",
        resourceId: "/knowledge",
        payload: { title: "Connector vetting required" },
      }).type,
    ).toBe("notification.created")
    expect(
      hubEventSchema.parse({
        id: "22222222-2222-4222-8222-222222222222",
        type: "notification.read",
        createdAt: "2026-05-20T00:01:00.000Z",
        resourceId: "11111111-1111-4111-8111-111111111111",
        payload: { readAt: "2026-05-20T00:01:00.000Z" },
      }).type,
    ).toBe("notification.read")

    expect(
      hubEventSchema.safeParse({
        id: "11111111-1111-4111-8111-111111111111",
        type: "admin.apply_update",
        createdAt: "2026-05-20T00:00:00.000Z",
        resourceId: null,
        payload: {},
      }).success,
    ).toBe(false)
  })

  it("parses read-only task workbench details and artifact previews", () => {
    const task = taskSessionSchema.parse({
      id: "44444444-4444-4444-8444-444444444444",
      title: "Review MCP catalog seed",
      status: "waiting",
      owner: "builder-1",
      updatedAt: "2026-05-20T08:30:00.000Z",
      href: "/tasks/44444444-4444-4444-8444-444444444444",
      context: [
        {
          label: "Scope",
          value: "Connector catalog seed and vetting posture",
          href: "/resources/mcp_connector/internal-docs",
          sourceStatus: "ok",
        },
      ],
      diffs: [
        {
          path: "apps/bff/src/catalog/mcp-catalog.ts",
          status: "modified",
          additions: 42,
          deletions: 0,
          preview: ['+  vettingStatus: "pending_security_review",'],
        },
      ],
      testOutput: {
        command: "corepack pnpm --filter @llm-machines/bff test",
        status: "passed",
        summary: "Catalog checks passed.",
        logs: [
          {
            timestamp: "2026-05-20T08:32:00.000Z",
            level: "info",
            message: "Parsed MCP catalog seed entries.",
          },
        ],
      },
    })
    const artifact = artifactSchema.parse({
      id: "55555555-5555-4555-8555-555555555555",
      taskId: task.id,
      title: "Connector vetting notes",
      kind: "markdown",
      href: "/artifacts/55555555-5555-4555-8555-555555555555",
      createdAt: "2026-05-20T08:35:00.000Z",
      preview: "# Connector vetting notes",
    })

    expect(task.diffs[0]?.additions).toBe(42)
    expect(artifact.preview).toContain("Connector")
  })
})
