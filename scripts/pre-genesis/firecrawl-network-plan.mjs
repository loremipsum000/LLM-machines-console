import { createHash } from "node:crypto"

const networkOrder = [
  "browser",
  "control",
  "egress",
  "proxy",
  "search",
  "bridge-access",
]

export function firecrawlNetworkPlan(runId) {
  if (!/^[a-f0-9]{16}$/.test(runId)) {
    throw new Error(
      "Firecrawl network planning requires a 16-character run ID.",
    )
  }

  const block =
    createHash("sha256").update(runId).digest().readUInt16BE(0) & 0x3fff
  const secondOctet = 64 + (block >> 8)
  const thirdOctet = block & 0xff

  return Object.fromEntries(
    networkOrder.map((name, index) => {
      const fourthOctet = index * 16
      return [
        name,
        {
          gateway: `100.${secondOctet}.${thirdOctet}.${fourthOctet + 1}`,
          subnet: `100.${secondOctet}.${thirdOctet}.${fourthOctet}/28`,
        },
      ]
    }),
  )
}
