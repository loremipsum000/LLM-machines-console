import assert from "node:assert/strict"
import {
  chmod,
  mkdtemp,
  realpath,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { verifyVm103LiteLlmRouteRuntime } from "./verify-vm103-litellm-route-runtime.mjs"

const expectedUid = process.getuid()
const secret = "never-return-this-secret"

async function fixture() {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "llmm-litellm-route-runtime-")),
  )
  const receiptPath = join(root, "receipt.json")
  const secretPath = join(root, "litellm-key")
  const runtimeBindingDigest = `sha256:${"a".repeat(64)}`
  const receipt = {
    apiBase: "http://10.33.74.166:30005/v1",
    configDigest: `sha256:${"b".repeat(64)}`,
    modelAlias: "measured-model",
    runtimeBindingDigest,
    runtimeModelId: `llmm-route-${runtimeBindingDigest.slice(7)}`,
    schema: "llm-machines.vm103-litellm-route-receipt.v1",
  }
  await writeFile(receiptPath, `${JSON.stringify(receipt)}\n`, { mode: 0o600 })
  await writeFile(secretPath, `${secret}\n`, { mode: 0o600 })
  return { receipt, receiptPath, root, secretPath }
}

function responseFor(receipt, overrides = {}) {
  return new Response(
    JSON.stringify({
      data: [
        {
          litellm_params: {
            api_base: receipt.apiBase,
            model: `openai/${receipt.modelAlias}`,
          },
          model_info: { id: receipt.runtimeModelId },
          model_name: receipt.modelAlias,
          ...overrides,
        },
      ],
    }),
    { headers: { "content-type": "application/json" }, status: 200 },
  )
}

test("proves the exact manifest-bound route is consumed without returning its key", async () => {
  const value = await fixture()
  try {
    const result = await verifyVm103LiteLlmRouteRuntime({
      baseUrl: "http://127.0.0.1:39218",
      expectedUid,
      fetchImpl: async (url, options) => {
        assert.equal(url.href, "http://127.0.0.1:39218/model/info")
        assert.equal(options.method, "GET")
        assert.equal(options.redirect, "error")
        assert.equal(options.headers.authorization, `Bearer ${secret}`)
        return responseFor(value.receipt)
      },
      receiptPath: value.receiptPath,
      secretPath: value.secretPath,
    })
    assert.equal(result.state, "exact-litellm-route-consumed")
    assert.doesNotMatch(JSON.stringify(result), new RegExp(secret))
  } finally {
    await rm(value.root, { force: true, recursive: true })
  }
})

test("rejects route drift, substitutions, and unsuccessful or oversized responses", async () => {
  for (const responseFactory of [
    (receipt) => responseFor(receipt, { model_name: "other" }),
    () => new Response("denied", { status: 401 }),
    () =>
      new Response("x", {
        headers: { "content-length": String(1024 * 1024 + 1) },
        status: 200,
      }),
  ]) {
    const value = await fixture()
    try {
      await assert.rejects(
        verifyVm103LiteLlmRouteRuntime({
          baseUrl: "http://127.0.0.1:39218",
          expectedUid,
          fetchImpl: async () => responseFactory(value.receipt),
          receiptPath: value.receiptPath,
          secretPath: value.secretPath,
        }),
        /route consumption is invalid/,
      )
    } finally {
      await rm(value.root, { force: true, recursive: true })
    }
  }
})

test("rejects non-loopback targets, loose modes, and symlinked custody", async () => {
  const value = await fixture()
  try {
    await assert.rejects(
      verifyVm103LiteLlmRouteRuntime({
        baseUrl: "http://10.33.74.166:39218",
        expectedUid,
        receiptPath: value.receiptPath,
        secretPath: value.secretPath,
      }),
      /route consumption is invalid/,
    )
    await chmod(value.secretPath, 0o640)
    await assert.rejects(
      verifyVm103LiteLlmRouteRuntime({
        baseUrl: "http://127.0.0.1:39218",
        expectedUid,
        receiptPath: value.receiptPath,
        secretPath: value.secretPath,
      }),
      /route consumption is invalid/,
    )
    await chmod(value.secretPath, 0o4600)
    await assert.rejects(
      verifyVm103LiteLlmRouteRuntime({
        baseUrl: "http://127.0.0.1:39218",
        expectedUid,
        receiptPath: value.receiptPath,
        secretPath: value.secretPath,
      }),
      /route consumption is invalid/,
    )
    await chmod(value.secretPath, 0o600)
    await unlink(value.secretPath)
    await symlink(value.receiptPath, value.secretPath)
    await assert.rejects(
      verifyVm103LiteLlmRouteRuntime({
        baseUrl: "http://127.0.0.1:39218",
        expectedUid,
        receiptPath: value.receiptPath,
        secretPath: value.secretPath,
      }),
      /route consumption is invalid/,
    )
  } finally {
    await rm(value.root, { force: true, recursive: true })
  }
})
