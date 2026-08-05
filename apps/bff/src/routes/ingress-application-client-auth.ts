import type { FastifyInstance, FastifyRequest } from "fastify"

const APPLICATION_CLIENT_ID_PATTERN =
  /^llmm-app-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const BASIC_PAYLOAD_PATTERN =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/
const VALIDATION_HEADER = "x-llmm-application-authorization"

export function registerIngressApplicationClientAuthRoute(
  server: FastifyInstance,
): void {
  server.get(
    "/internal/ingress/application-client-authorization",
    async (request, reply) => {
      const authorization = singleHeader(request, VALIDATION_HEADER)
      return validApplicationClientAuthorization(authorization)
        ? reply.code(204).send()
        : reply.code(401).send()
    },
  )
}

export function validApplicationClientAuthorization(
  authorization: string | null,
): boolean {
  if (!authorization) {
    return false
  }
  const match = /^Basic +(.+)$/i.exec(authorization)
  const payload = match?.[1]
  if (
    !payload ||
    payload.length % 4 !== 0 ||
    !BASIC_PAYLOAD_PATTERN.test(payload)
  ) {
    return false
  }

  const decoded = Buffer.from(payload, "base64")
  if (decoded.toString("base64") !== payload) {
    return false
  }
  const credentials = decoded.toString("utf8")
  if (!Buffer.from(credentials, "utf8").equals(decoded)) {
    return false
  }
  const separator = credentials.indexOf(":")
  return (
    separator > 0 &&
    separator < credentials.length - 1 &&
    APPLICATION_CLIENT_ID_PATTERN.test(credentials.slice(0, separator))
  )
}

function singleHeader(
  request: FastifyRequest,
  name: typeof VALIDATION_HEADER,
): string | null {
  const value = request.headers[name]
  return typeof value === "string" ? value : null
}
