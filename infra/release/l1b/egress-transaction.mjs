#!/usr/bin/env node

import { createHash } from "node:crypto"
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { validateEgressResolution } from "./egress-resolution.mjs"
import { renderFirewall } from "./render-proxmox-firewall.mjs"

const directory = dirname(fileURLToPath(import.meta.url))
const transactionFiles = [
  "egress-resolution.json",
  "transaction.json",
  "vm118.firewall",
]

function fail(message) {
  throw new Error(message)
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`
}

function readRegularFile(path, label) {
  if (!lstatSync(path).isFile()) fail(`${label} is not a regular file`)
  return readFileSync(path)
}

function sourceDocuments() {
  const policyBytes = readFileSync(resolve(directory, "egress-allowlist.json"))
  const profileBytes = readFileSync(resolve(directory, "builder-profile.json"))
  return {
    policyBytes,
    policy: JSON.parse(policyBytes),
    profileBytes,
    profile: JSON.parse(profileBytes),
  }
}

export function createEgressTransaction(resolutionPath, outputDirectory) {
  const outputRoot = resolve(outputDirectory)
  mkdirSync(outputRoot, { mode: 0o700 })
  const resolutionBytes = readRegularFile(
    resolve(resolutionPath),
    "egress resolution",
  )
  const resolution = JSON.parse(resolutionBytes)
  const { policyBytes, policy, profileBytes, profile } = sourceDocuments()
  validateEgressResolution(policy, policyBytes, resolution)
  const firewallBytes = Buffer.from(renderFirewall(policy, resolution, profile))
  const manifest = {
    schema: "llm-machines.vm103-l1b-egress-transaction.v1",
    vmid: 118,
    policySha256: sha256(policyBytes),
    profileSha256: sha256(profileBytes),
    resolutionSha256: sha256(resolutionBytes),
    firewallSha256: sha256(firewallBytes),
  }
  writeFileSync(
    resolve(outputRoot, "egress-resolution.json"),
    resolutionBytes,
    {
      flag: "wx",
      mode: 0o600,
    },
  )
  writeFileSync(resolve(outputRoot, "vm118.firewall"), firewallBytes, {
    flag: "wx",
    mode: 0o600,
  })
  writeFileSync(
    resolve(outputRoot, "transaction.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { flag: "wx", mode: 0o600 },
  )
  return manifest
}

export function validateEgressTransaction(
  transactionDirectory,
  installedFirewallPath,
) {
  const transactionRoot = resolve(transactionDirectory)
  if (
    JSON.stringify(readdirSync(transactionRoot).sort()) !==
    JSON.stringify(transactionFiles)
  ) {
    fail("egress transaction inventory is not exact")
  }
  const resolutionBytes = readRegularFile(
    resolve(transactionRoot, "egress-resolution.json"),
    "transaction resolution",
  )
  const firewallBytes = readRegularFile(
    resolve(transactionRoot, "vm118.firewall"),
    "transaction firewall",
  )
  const manifestBytes = readRegularFile(
    resolve(transactionRoot, "transaction.json"),
    "transaction manifest",
  )
  const manifest = JSON.parse(manifestBytes)
  if (
    JSON.stringify(Object.keys(manifest)) !==
      JSON.stringify([
        "schema",
        "vmid",
        "policySha256",
        "profileSha256",
        "resolutionSha256",
        "firewallSha256",
      ]) ||
    manifest.schema !== "llm-machines.vm103-l1b-egress-transaction.v1" ||
    manifest.vmid !== 118
  ) {
    fail("egress transaction manifest is invalid")
  }
  const resolution = JSON.parse(resolutionBytes)
  const { policyBytes, policy, profileBytes, profile } = sourceDocuments()
  validateEgressResolution(policy, policyBytes, resolution)
  const expectedFirewall = Buffer.from(
    renderFirewall(policy, resolution, profile),
  )
  if (
    manifest.policySha256 !== sha256(policyBytes) ||
    manifest.profileSha256 !== sha256(profileBytes) ||
    manifest.resolutionSha256 !== sha256(resolutionBytes) ||
    manifest.firewallSha256 !== sha256(firewallBytes) ||
    !firewallBytes.equals(expectedFirewall)
  ) {
    fail("egress transaction hash binding failed")
  }
  if (installedFirewallPath) {
    const installedFirewall = readRegularFile(
      resolve(installedFirewallPath),
      "installed firewall",
    )
    if (
      !installedFirewall.equals(firewallBytes) ||
      sha256(installedFirewall) !== manifest.firewallSha256
    ) {
      fail("installed firewall differs from the egress transaction")
    }
  }
  return { manifest, manifestSha256: sha256(manifestBytes) }
}

export function createFirewallReceipt(
  transactionDirectory,
  installedFirewallPath,
  outputPath,
) {
  const validated = validateEgressTransaction(
    transactionDirectory,
    installedFirewallPath,
  )
  const receipt = {
    schema: "llm-machines.vm103-l1b-firewall-receipt.v1",
    status: "INSTALLED_FIREWALL_VERIFIED",
    vmid: 118,
    transactionManifestSha256: validated.manifestSha256,
    installedFirewallSha256: validated.manifest.firewallSha256,
  }
  writeFileSync(resolve(outputPath), `${JSON.stringify(receipt, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  })
  return receipt
}

export function validateFirewallReceipt(transactionDirectory, receiptPath) {
  const validated = validateEgressTransaction(transactionDirectory)
  const receiptBytes = readRegularFile(
    resolve(receiptPath),
    "installed firewall receipt",
  )
  const receipt = JSON.parse(receiptBytes)
  if (
    JSON.stringify(Object.keys(receipt)) !==
      JSON.stringify([
        "schema",
        "status",
        "vmid",
        "transactionManifestSha256",
        "installedFirewallSha256",
      ]) ||
    receipt.schema !== "llm-machines.vm103-l1b-firewall-receipt.v1" ||
    receipt.status !== "INSTALLED_FIREWALL_VERIFIED" ||
    receipt.vmid !== 118 ||
    receipt.transactionManifestSha256 !== validated.manifestSha256 ||
    receipt.installedFirewallSha256 !== validated.manifest.firewallSha256
  ) {
    fail("installed firewall receipt differs from the egress transaction")
  }
  return { ...validated, receipt, receiptSha256: sha256(receiptBytes) }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const values = new Map()
  for (let index = 2; index < process.argv.length; index += 2) {
    const key = process.argv[index]
    const value = process.argv[index + 1]
    if (!key?.startsWith("--") || value === undefined || values.has(key))
      fail("egress transaction arguments are invalid")
    values.set(key, value)
  }
  if (values.has("--resolution") && values.has("--output-directory")) {
    if (values.size !== 2) fail("egress transaction create arguments differ")
    createEgressTransaction(
      values.get("--resolution"),
      values.get("--output-directory"),
    )
  } else if (
    values.has("--transaction-directory") &&
    values.has("--firewall-receipt")
  ) {
    if (values.size !== 2) fail("firewall receipt verify arguments differ")
    validateFirewallReceipt(
      values.get("--transaction-directory"),
      values.get("--firewall-receipt"),
    )
  } else if (values.has("--transaction-directory")) {
    if (values.size !== 1) {
      fail("egress transaction verify arguments differ")
    }
    validateEgressTransaction(values.get("--transaction-directory"))
  } else {
    fail("expected create or verify egress transaction arguments")
  }
}
