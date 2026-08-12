import { isIP } from "node:net"

export function resolveIdentityBackchannelTarget({
  issuer,
  targetHost,
  targetPort,
}) {
  const issuerUrl = new URL(issuer)
  if (targetHost === undefined && targetPort === undefined) {
    return {
      host: "127.0.0.1",
      port: issuerUrl.port ? Number.parseInt(issuerUrl.port, 10) : 443,
    }
  }
  if (
    typeof targetHost !== "string" ||
    !isPrivateIpv4(targetHost) ||
    typeof targetPort !== "string" ||
    !/^\d+$/.test(targetPort)
  ) {
    throw new Error("The F0-S1 identity backchannel target is invalid.")
  }
  const port = Number.parseInt(targetPort, 10)
  if (port < 1 || port > 65_535) {
    throw new Error("The F0-S1 identity backchannel target is invalid.")
  }
  return { host: targetHost, port }
}

function isPrivateIpv4(value) {
  if (isIP(value) !== 4) return false
  const [first, second] = value.split(".").map(Number)
  return (
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  )
}
