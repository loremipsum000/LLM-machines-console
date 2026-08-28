import { describe, expect, it } from "vitest"
import {
  assertProductionFixturesDisabled,
  assertShippedProductionRuntime,
  canUseBffFixtureData,
  isBffFixtureMode,
} from "./fixture-mode"

describe("BFF production fixture exclusion", () => {
  it("makes fixture data unavailable in production even when every fixture flag is enabled", () => {
    const env = {
      BFF_FIXTURE_MODE: "true",
      CONNECTED_APPS_KEYCLOAK_FIXTURE: "true",
      NODE_ENV: "production",
    }

    expect(isBffFixtureMode(env)).toBe(false)
    expect(canUseBffFixtureData(env)).toBe(false)
  })

  it.each(["BFF_FIXTURE_MODE", "CONNECTED_APPS_KEYCLOAK_FIXTURE"] as const)(
    "rejects %s when production starts",
    (flag) => {
      expect(() =>
        assertProductionFixturesDisabled({
          [flag]: "true",
          NODE_ENV: "production",
        }),
      ).toThrow(`Fixture configuration is forbidden in production: ${flag}.`)
    },
  )

  it("keeps fixture data available to tests", () => {
    expect(canUseBffFixtureData({ NODE_ENV: "test" })).toBe(true)
  })

  it.each([undefined, "development", "test"])(
    "rejects shipped startup with NODE_ENV=%s",
    (nodeEnv) => {
      expect(() =>
        assertShippedProductionRuntime(
          nodeEnv === undefined ? {} : { NODE_ENV: nodeEnv },
        ),
      ).toThrow("The shipped Console BFF requires NODE_ENV=production.")
    },
  )

  it("accepts the exact production runtime without fixture flags", () => {
    expect(() =>
      assertShippedProductionRuntime({ NODE_ENV: "production" }),
    ).not.toThrow()
  })
})
