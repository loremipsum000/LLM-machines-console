import { buildServer } from "../../apps/bff/src/index"

if (
  process.env.NODE_ENV !== "test" ||
  process.env.BFF_FIXTURE_MODE !== "true"
) {
  throw new Error("The reduced-Core BFF fixture requires test fixture mode.")
}

const upstreamBaseUrl = process.env.PRE_GENESIS_FIRECRAWL_UPSTREAM_BASE_URL
const firecrawlFixtureEnabled = upstreamBaseUrl !== undefined
const firecrawlHost = "allowed.example.test"
const firecrawlAddress = "93.184.216.34"
const fixtureUpstream = upstreamBaseUrl ? new URL(upstreamBaseUrl) : null

if (
  fixtureUpstream &&
  (fixtureUpstream.protocol !== "http:" ||
    fixtureUpstream.hostname !== "127.0.0.1" ||
    fixtureUpstream.port === "" ||
    fixtureUpstream.pathname !== "/" ||
    fixtureUpstream.search ||
    fixtureUpstream.hash ||
    fixtureUpstream.username ||
    fixtureUpstream.password)
) {
  throw new Error("The Firecrawl fixture upstream must be local and temporary.")
}

const server = buildServer({
  ...(firecrawlFixtureEnabled
    ? {
        testFirecrawlGateway: {
          dnsLookup: async (hostname: string) => {
            if (hostname !== firecrawlHost) {
              throw new Error("The Firecrawl fixture denied an unknown host.")
            }
            return [{ address: firecrawlAddress, family: 4 as const }]
          },
          fetchImpl: async (input, init) => {
            const requested = new URL(input.toString())
            if (
              requested.origin !== "http://firecrawl-api:3002" ||
              (requested.pathname !== "/v2/search" &&
                requested.pathname !== "/v2/scrape") ||
              requested.search ||
              !fixtureUpstream
            ) {
              throw new Error("The Firecrawl fixture denied an upstream route.")
            }
            return fetch(new URL(requested.pathname, fixtureUpstream), init)
          },
          upstreamBaseUrl: "http://firecrawl-api:3002",
        },
      }
    : {}),
})

const port = Number.parseInt(process.env.PORT ?? "4001", 10)
const host = process.env.HOST ?? "127.0.0.1"

await server.listen({ host, port })
