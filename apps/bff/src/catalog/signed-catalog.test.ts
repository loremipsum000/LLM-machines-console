import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { generateKeyPairSync, sign } from "node:crypto"
import type {
  McpCatalogBundlePayload,
  McpCatalogEntry,
} from "@llm-machines/contracts"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  canonicalizeCatalogPayload,
  getMcpCatalogEntries,
  loadMcpCatalogEntriesFromSignedBundle,
} from "./signed-catalog"

const signedEntry: McpCatalogEntry = {
  id: "mcp-signed-docs",
  displayName: "Signed Docs",
  description: "Signed read-only connector bundle entry.",
  version: "1.0.0",
  sourceRef: "llm-machines/catalog/signed-docs@1.0.0",
  checksum: "sha256:5d41402abc4b2a76b9719d911017c592",
  license: "LLM Machines",
  supportTier: "t1",
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

describe("signed MCP catalog", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("loads entries from a verified signed catalog bundle", () => {
    const { bundleText, publicKeyPem } = createSignedBundle([signedEntry])

    const entries = loadMcpCatalogEntriesFromSignedBundle({
      bundleText,
      publicKeyPem,
    })

    expect(entries).toEqual([signedEntry])
  })

  it("rejects catalog bundles with invalid signatures", () => {
    const { bundleText, publicKeyPem } = createSignedBundle([signedEntry])
    const tamperedBundleText = bundleText.replace("Signed Docs", "Tampered")

    expect(() =>
      loadMcpCatalogEntriesFromSignedBundle({
        bundleText: tamperedBundleText,
        publicKeyPem,
      }),
    ).toThrow("MCP catalog signature verification failed.")
  })

  it("rejects approved catalog entries missing policy metadata", () => {
    const { bundleText, publicKeyPem } = createSignedBundle([
      {
        ...signedEntry,
        auditEvents: [],
      },
    ])

    expect(() =>
      loadMcpCatalogEntriesFromSignedBundle({
        bundleText,
        publicKeyPem,
      }),
    ).toThrow("missing audit events")
  })

  it("uses an env-configured signed bundle instead of the repo seed", () => {
    const { bundleText, publicKeyPem } = createSignedBundle([signedEntry])
    const tempDir = mkdtempSync(join(tmpdir(), "mcp-catalog-"))
    const bundlePath = join(tempDir, "catalog.bundle.json")
    writeFileSync(bundlePath, bundleText)
    vi.stubEnv("MCP_CATALOG_BUNDLE_PATH", bundlePath)
    vi.stubEnv("MCP_CATALOG_PUBLIC_KEY_PEM", publicKeyPem)

    try {
      expect(getMcpCatalogEntries().map((entry) => entry.id)).toEqual([
        "mcp-signed-docs",
      ])
    } finally {
      rmSync(tempDir, { force: true, recursive: true })
    }
  })

  it("requires an explicit seed override in production", () => {
    vi.stubEnv("NODE_ENV", "production")

    expect(() => getMcpCatalogEntries()).toThrow(
      "MCP_CATALOG_BUNDLE_PATH is required in production",
    )

    vi.stubEnv("MCP_CATALOG_ALLOW_SEED", "true")
    expect(getMcpCatalogEntries().map((entry) => entry.id)).toContain(
      "internal-docs",
    )
  })
})

function createSignedBundle(entries: McpCatalogEntry[]): {
  bundleText: string
  publicKeyPem: string
} {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519")
  const payload: McpCatalogBundlePayload = {
    version: "2026.05.20",
    generatedAt: "2026-05-20T00:00:00.000Z",
    entries,
  }
  const signature = sign(
    null,
    Buffer.from(canonicalizeCatalogPayload(payload)),
    privateKey,
  )

  return {
    bundleText: JSON.stringify({
      payload,
      signature: {
        alg: "ed25519",
        keyId: "test-key",
        value: signature.toString("base64"),
      },
    }),
    publicKeyPem: publicKey.export({ format: "pem", type: "spki" }).toString(),
  }
}
