import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { isIP } from "node:net"
import OpenAI from "openai"
import { Agent, buildConnector, fetch as undiciFetch } from "undici"

const config = await readConfig()
const baseUrl = new URL(config.baseUrl)

assert.equal(baseUrl.protocol, "https:")
assert.equal(baseUrl.hostname, approvedApiAuthority(config.apiAuthority))
assert.equal(baseUrl.pathname, "/v1")
assert.equal(baseUrl.username, "")
assert.equal(baseUrl.password, "")
assert.equal(baseUrl.search, "")
assert.equal(baseUrl.hash, "")
const connectAddress = approvedPrivateAddress(config.connectAddress)
const connectPort = approvedPort(config.connectPort)
if (!/^llmm_t4_[0-9a-f]{18}_[A-Za-z0-9_-]{43}$/.test(config.apiKey)) {
  throw new Error("The external client credential format was invalid.")
}
assert.equal(config.model, "fixture-model")
assert.equal(typeof config.caFile, "string")
assert.equal(typeof config.prompt, "string")
assert.ok(config.prompt.length > 0 && config.prompt.length <= 1_024)

const tlsConnector = buildConnector({ ca: await readFile(config.caFile) })
const dispatcher = new Agent({
  connect(options, callback) {
    if (
      options.hostname !== config.apiAuthority ||
      options.protocol !== "https:"
    ) {
      callback(new Error("The external client attempted an unapproved host."))
      return
    }
    tlsConnector(
      {
        ...options,
        hostname: connectAddress,
        port: String(connectPort),
        servername: config.apiAuthority,
      },
      callback,
    )
  },
})

try {
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
    fetch: undiciFetch,
    fetchOptions: { dispatcher, redirect: "manual" },
    maxRetries: 0,
    timeout: 30_000,
  })

  const models = await client.models.list()
  assert.ok(models.data.some((model) => model.id === config.model))

  const completion = await client.chat.completions.create({
    messages: [{ content: config.prompt, role: "user" }],
    model: config.model,
  })
  assert.equal(completion.model, config.model)
  assert.ok((completion.choices[0]?.message?.content ?? "").length > 0)
  assert.ok((completion.usage?.total_tokens ?? 0) > 0)

  const stream = await client.chat.completions.create({
    messages: [{ content: config.prompt, role: "user" }],
    model: config.model,
    stream: true,
    stream_options: { include_usage: true },
  })
  let streamChunkCount = 0
  let streamContentObserved = false
  let streamUsage = null
  for await (const chunk of stream) {
    streamChunkCount += 1
    if ((chunk.choices[0]?.delta?.content ?? "").length > 0) {
      streamContentObserved = true
    }
    if (chunk.usage) streamUsage = chunk.usage
  }
  assert.ok(streamChunkCount > 0)
  assert.equal(streamContentObserved, true)
  assert.ok((streamUsage?.total_tokens ?? 0) > 0)

  process.stdout.write(
    `${JSON.stringify({
      client: "openai-node",
      clientVersion: "7.4.0",
      modelDiscovery: "passed",
      nonStreaming: {
        totalTokens: completion.usage.total_tokens,
        status: "passed",
      },
      processBoundary: "child",
      streaming: {
        chunks: streamChunkCount,
        status: "passed",
        totalTokens: streamUsage.total_tokens,
      },
    })}\n`,
  )
} finally {
  await dispatcher.close()
}

async function readConfig() {
  const chunks = []
  let length = 0
  for await (const chunk of process.stdin) {
    length += chunk.length
    if (length > 16_384) {
      throw new Error("The external client input exceeded its bounded size.")
    }
    chunks.push(chunk)
  }
  const raw = Buffer.concat(chunks).toString("utf8")
  if (!raw) throw new Error("The external client input was empty.")
  const value = JSON.parse(raw)
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The external client input was invalid.")
  }
  return value
}

function approvedApiAuthority(value) {
  if (
    typeof value !== "string" ||
    value !== value.trim().toLowerCase() ||
    !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(value)
  ) {
    throw new Error("The external client API authority was invalid.")
  }
  return value
}

function approvedPrivateAddress(value) {
  if (typeof value !== "string" || isIP(value) !== 4) {
    throw new Error("The external client edge address was invalid.")
  }
  const [first, second] = value.split(".").map(Number)
  if (
    value !== "127.0.0.1" &&
    first !== 10 &&
    !(first === 172 && second >= 16 && second <= 31) &&
    !(first === 192 && second === 168)
  ) {
    throw new Error("The external client edge address was invalid.")
  }
  return value
}

function approvedPort(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 65_535) {
    throw new Error("The external client edge port was invalid.")
  }
  return value
}
