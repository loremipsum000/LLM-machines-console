#!/usr/bin/env node

import { createHash } from "node:crypto"
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
} from "node:fs"
import { basename, dirname, resolve } from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { fileURLToPath } from "node:url"

const directory = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(directory, "../../..")

function fail(message) {
  throw new Error(message)
}

async function sha256File(path) {
  const hash = createHash("sha256")
  await pipeline(createReadStream(path), hash)
  return hash.digest("hex")
}

function manifest(path) {
  return JSON.parse(readFileSync(path, "utf8"))
}

function lockedDownloads(root) {
  const toolchain = manifest(
    resolve(root, "infra/release/l1b/toolchain-lock.json"),
  )
  const firecrawl = manifest(
    resolve(root, "infra/firecrawl/release/source-package.json"),
  )
  const litellm = manifest(
    resolve(root, "infra/litellm/oss-downstream/source-package.json"),
  )
  return [
    ...toolchain.hostTools
      .filter(({ url }) => url)
      .map(({ id, url, sha256 }) => ({ id, url, sha256, file: basename(url) })),
    ...toolchain.dockerPackages.map(({ id, url, sha256 }) => ({
      id,
      url,
      sha256,
      file: basename(url),
    })),
    {
      id: "litellm-source",
      url: litellm.upstream.archiveUrl,
      sha256: litellm.upstream.archiveSha256,
      file: litellm.upstream.archiveFile,
    },
    ...firecrawl.upstreamComponents.map((entry) => ({
      id: `${entry.id}-source`,
      url: entry.archiveUrl,
      sha256: entry.archiveSha256,
      file: entry.archiveFile,
    })),
    ...firecrawl.externalByteInputs.map((entry) => ({
      id: entry.id,
      url: entry.url,
      sha256: entry.sha256,
      file: basename(new URL(entry.url).pathname),
    })),
  ]
}

async function download(entry, output, allowedHosts) {
  let url = new URL(entry.url)
  for (let redirects = 0; redirects <= 8; redirects += 1) {
    if (!allowedHosts.has(url.hostname)) {
      fail(`${entry.id} download host is not allowlisted: ${url.hostname}`)
    }
    const response = await fetch(url, {
      redirect: "manual",
      headers: { "user-agent": "llm-machines-l1b/1" },
    })
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location")
      if (!location) fail(`${entry.id} redirect has no location`)
      url = new URL(location, url)
      continue
    }
    if (!response.ok || !response.body) {
      fail(`${entry.id} download failed with HTTP ${response.status}`)
    }
    await pipeline(
      Readable.fromWeb(response.body),
      createWriteStream(output, { mode: 0o600, flags: "wx" }),
    )
    const actual = await sha256File(output)
    if (actual !== entry.sha256) {
      fail(`${entry.id} SHA-256 differs: ${actual}`)
    }
    return { ...entry, finalUrl: url.toString(), sha256: actual }
  }
  fail(`${entry.id} exceeded the redirect limit`)
}

export async function fetchLockedInputs({ root = repositoryRoot, outputRoot }) {
  const egress = manifest(
    resolve(root, "infra/release/l1b/egress-allowlist.json"),
  )
  const allowedHosts = new Set(egress.hosts)
  const output = resolve(outputRoot)
  if (existsSync(output)) fail("input output root already exists")
  mkdirSync(output, { recursive: true, mode: 0o700 })
  const results = []
  for (const entry of lockedDownloads(root)) {
    results.push(
      await download(entry, resolve(output, entry.file), allowedHosts),
    )
  }
  return results
}

function parseArguments(argv) {
  if (argv.length !== 2 || argv[0] !== "--output-root") {
    fail("expected --output-root DIR")
  }
  return { outputRoot: argv[1] }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  fetchLockedInputs(parseArguments(process.argv.slice(2)))
    .then((result) =>
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`),
    )
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error))
      process.exitCode = 1
    })
}
