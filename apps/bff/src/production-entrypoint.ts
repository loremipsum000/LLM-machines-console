import { assertShippedProductionRuntime } from "./config/fixture-mode"
import { buildServer } from "./index"

assertShippedProductionRuntime()

const server = buildServer()
const port = Number.parseInt(process.env.PORT ?? "4001", 10)
const host = process.env.HOST ?? "0.0.0.0"

await server.listen({ host, port })
