#!/usr/bin/env node

import { resolve4 } from "node:dns/promises"
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const directory = dirname(fileURLToPath(import.meta.url))

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
}

async function main(output) {
  const policy = JSON.parse(
    readFileSync(resolve(directory, "egress-allowlist.json"), "utf8"),
  )
  const resolutions = {}
  for (const host of policy.hosts) {
    resolutions[host] = [...new Set(await resolve4(host))].sort((a, b) =>
      a.localeCompare(b, "en", { numeric: true }),
    )
    if (resolutions[host].length === 0)
      throw new Error(`${host} has no IPv4 address`)
  }
  const document = {
    schema: "llm-machines.vm103-l1b-egress-resolution.v1",
    policySha256: `sha256:${await import("node:crypto").then(({ createHash }) =>
      createHash("sha256")
        .update(readFileSync(resolve(directory, "egress-allowlist.json")))
        .digest("hex"),
    )}`,
    resolutions,
  }
  writeFileSync(resolve(output), `${canonicalJson(document)}\n`, {
    flag: "wx",
    mode: 0o600,
  })
}

if (process.argv.length !== 4 || process.argv[2] !== "--output") {
  throw new Error("expected --output FILE")
}
await main(process.argv[3])
