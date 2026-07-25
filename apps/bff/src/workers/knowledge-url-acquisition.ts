import { closeDb } from "../db/client"
import { runKnowledgeUrlAcquisitionWorkerBatch } from "../services/knowledge/admin"

const workerId =
  process.env.KNOWLEDGE_URL_WORKER_ID ?? `knowledge-url-${process.pid}`
const pollIntervalMs = positiveInt(
  Number.parseInt(process.env.KNOWLEDGE_URL_WORKER_POLL_INTERVAL_MS ?? "", 10),
  5_000,
)
const batchSize = positiveInt(
  Number.parseInt(process.env.KNOWLEDGE_URL_WORKER_BATCH_SIZE ?? "", 10),
  5,
)

let shuttingDown = false

process.once("SIGINT", () => {
  shuttingDown = true
})
process.once("SIGTERM", () => {
  shuttingDown = true
})

while (!shuttingDown) {
  const processed = await runKnowledgeUrlAcquisitionWorkerBatch({
    limit: batchSize,
    workerId,
  })
  if (processed === 0) {
    await sleep(pollIntervalMs)
  }
}

await closeDb()

function positiveInt(value: number, fallback: number): number {
  return Number.isInteger(value) && value > 0 ? value : fallback
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
