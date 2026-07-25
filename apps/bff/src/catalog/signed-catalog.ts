import { readFileSync } from "node:fs"
import { createPublicKey, verify } from "node:crypto"
import {
  type McpCatalogBundlePayload,
  type McpCatalogEntry,
  mcpCatalogBundleSchema,
} from "@llm-machines/contracts"
import {
  canUseBffFixtureData,
  isProductionRuntime,
} from "../config/fixture-mode"
import { mcpCatalogEntries } from "./mcp-catalog"

const approvedStatuses = new Set(["approved_read_only", "approved_read_write"])

export function getMcpCatalogEntries(): McpCatalogEntry[] {
  const bundlePath = process.env.MCP_CATALOG_BUNDLE_PATH
  if (!bundlePath) {
    if (
      isProductionRuntime() &&
      !canUseBffFixtureData() &&
      process.env.MCP_CATALOG_ALLOW_SEED !== "true"
    ) {
      throw new Error(
        "MCP_CATALOG_BUNDLE_PATH is required in production unless MCP_CATALOG_ALLOW_SEED=true or BFF_FIXTURE_MODE=true.",
      )
    }
    return mcpCatalogEntries
  }

  const publicKeyPem = process.env.MCP_CATALOG_PUBLIC_KEY_PEM
  if (!publicKeyPem) {
    throw new Error(
      "MCP_CATALOG_PUBLIC_KEY_PEM is required when MCP_CATALOG_BUNDLE_PATH is configured.",
    )
  }

  return loadMcpCatalogEntriesFromSignedBundle({
    bundleText: readFileSync(bundlePath, "utf8"),
    publicKeyPem,
  })
}

export function loadMcpCatalogEntriesFromSignedBundle({
  bundleText,
  publicKeyPem,
}: {
  bundleText: string
  publicKeyPem: string
}): McpCatalogEntry[] {
  const bundle = mcpCatalogBundleSchema.parse(JSON.parse(bundleText))
  const payloadText = canonicalizeCatalogPayload(bundle.payload)
  const verified = verify(
    null,
    Buffer.from(payloadText),
    createPublicKey(publicKeyPem),
    Buffer.from(bundle.signature.value, "base64"),
  )

  if (!verified) {
    throw new Error("MCP catalog signature verification failed.")
  }

  assertCatalogPolicy(bundle.payload.entries)
  return bundle.payload.entries
}

export function canonicalizeCatalogPayload(
  payload: McpCatalogBundlePayload,
): string {
  return JSON.stringify(sortJsonValue(payload))
}

function assertCatalogPolicy(entries: McpCatalogEntry[]): void {
  for (const entry of entries) {
    if (!entry.checksum.startsWith("sha256:")) {
      throw new Error(
        `MCP catalog entry ${entry.id} is missing sha256 checksum.`,
      )
    }
    if (entry.allowedEndpoints.length === 0) {
      throw new Error(
        `MCP catalog entry ${entry.id} is missing endpoint allowlist.`,
      )
    }
    if (entry.auditEvents.length === 0) {
      throw new Error(`MCP catalog entry ${entry.id} is missing audit events.`)
    }
    if (
      entry.vettingStatus === "approved_read_only" &&
      entry.readWrite !== "read_only"
    ) {
      throw new Error(
        `MCP catalog entry ${entry.id} has read-write access under read-only approval.`,
      )
    }
    if (approvedStatuses.has(entry.vettingStatus)) {
      if (!entry.lastReviewedAt) {
        throw new Error(
          `MCP catalog entry ${entry.id} is approved without review timestamp.`,
        )
      }
      if (entry.license === "Pending review") {
        throw new Error(
          `MCP catalog entry ${entry.id} is approved with pending license review.`,
        )
      }
    }
  }
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue)
  }
  if (!value || typeof value !== "object") {
    return value
  }

  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nestedValue]) => [key, sortJsonValue(nestedValue)]),
  )
}
