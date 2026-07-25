import {
  type McpCatalogEntry,
  mcpCatalogEntrySchema,
} from "@llm-machines/contracts"

export const mcpCatalogEntries: McpCatalogEntry[] = mcpCatalogEntrySchema
  .array()
  .parse([
    {
      id: "internal-docs",
      displayName: "Internal Docs",
      description:
        "Read-only connector for appliance-local documentation search.",
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
      auditEvents: ["connector.docs.search", "connector.docs.read"],
      runtimeProfile: "managed-tool-proxy",
      secretsRequired: [],
      lastReviewedAt: "2026-05-20T00:00:00.000Z",
    },
  ])
