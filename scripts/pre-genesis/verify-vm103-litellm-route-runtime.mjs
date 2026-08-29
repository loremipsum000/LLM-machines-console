#!/usr/bin/env node

import { lstatSync, readFileSync, realpathSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

const digestPattern = /^sha256:[0-9a-f]{64}$/
const modelPattern = /^[a-z0-9][a-z0-9._-]{0,127}$/

export async function verifyVm103LiteLlmRouteRuntime({
  baseUrl,
  expectedUid = 0,
  fetchImpl = fetch,
  receiptPath,
  secretPath,
}) {
  const url = new URL(baseUrl)
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    !/^[1-9][0-9]{3,4}$/.test(url.port) ||
    url.pathname !== "/" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !Number.isSafeInteger(expectedUid) ||
    expectedUid < 0
  ) {
    fail()
  }
  const receipt = parseJson(readExactFile(receiptPath, 0o600, expectedUid))
  if (
    receipt?.schema !== "llm-machines.vm103-litellm-route-receipt.v1" ||
    !modelPattern.test(receipt.modelAlias) ||
    !digestPattern.test(receipt.configDigest) ||
    !digestPattern.test(receipt.runtimeBindingDigest) ||
    receipt.runtimeModelId !==
      `llmm-route-${receipt.runtimeBindingDigest.slice(7)}` ||
    typeof receipt.apiBase !== "string"
  ) {
    fail()
  }
  const secret = readExactFile(secretPath, 0o600, expectedUid, 16 * 1024)
    .toString("utf8")
    .trim()
  if (!secret || /[\r\n\0]/.test(secret)) fail()

  let response
  try {
    response = await fetchImpl(new URL("/model/info", url), {
      headers: { authorization: `Bearer ${secret}` },
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    })
  } catch {
    fail()
  }
  if (response.status !== 200) fail()
  const payload = parseJson(await readBoundedResponse(response, 1024 * 1024))
  const rows = Array.isArray(payload) ? payload : payload?.data
  if (!Array.isArray(rows) || rows.length !== 1) fail()
  const row = rows[0]
  if (
    row?.model_name !== receipt.modelAlias ||
    row?.model_info?.id !== receipt.runtimeModelId ||
    row?.litellm_params?.model !== `openai/${receipt.modelAlias}` ||
    row?.litellm_params?.api_base !== receipt.apiBase
  ) {
    fail()
  }
  return {
    configDigest: receipt.configDigest,
    modelAlias: receipt.modelAlias,
    runtimeBindingDigest: receipt.runtimeBindingDigest,
    state: "exact-litellm-route-consumed",
  }
}

async function readBoundedResponse(response, maximum) {
  const declared = response.headers.get("content-length")
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maximum))
    fail()
  if (!response.body) fail()
  const reader = response.body.getReader()
  const chunks = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > maximum) {
      await reader.cancel()
      fail()
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)))
}

function readExactFile(path, mode, uid, maximum = 1024 * 1024) {
  let stat
  let canonical
  try {
    stat = lstatSync(path)
    canonical = realpathSync(path)
  } catch {
    fail()
  }
  if (
    resolve(path) !== canonical ||
    stat.isSymbolicLink() ||
    !stat.isFile() ||
    stat.uid !== uid ||
    (stat.mode & 0o7777) !== mode ||
    stat.size < 1 ||
    stat.size > maximum
  ) {
    fail()
  }
  try {
    return readFileSync(path)
  } catch {
    fail()
  }
}

function parseJson(bytes) {
  try {
    return JSON.parse(bytes.toString("utf8"))
  } catch {
    fail()
  }
}

function fail() {
  throw new Error("VM103 LiteLLM route consumption is invalid.")
}

if (
  process.argv[1] === fileURLToPath(import.meta.url) ||
  process.argv[1] === "-"
) {
  if (process.argv.length !== 5 || process.getuid?.() !== 0) fail()
  process.stdout.write(
    `${JSON.stringify(
      await verifyVm103LiteLlmRouteRuntime({
        baseUrl: process.argv[2],
        receiptPath: process.argv[3],
        secretPath: process.argv[4],
      }),
    )}\n`,
  )
}
