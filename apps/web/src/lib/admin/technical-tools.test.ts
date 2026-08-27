import { describe, expect, it } from "vitest"
import { technicalToolsForRole } from "./technical-tools"

const environment = {
  PRODUCT_GRAFANA_HOST: "grafana.example.test",
  PRODUCT_KEYCLOAK_ADMIN_HOST: "keycloak.example.test",
  PRODUCT_LITELLM_HOST: "litellm.example.test",
}

describe("Console Technical Tools configuration", () => {
  it("gives Admin only the three retained native authorities", () => {
    expect(technicalToolsForRole("admin", environment)).toEqual([
      expect.objectContaining({
        href: "https://grafana.example.test/d/llmm-infra-overview/llm-machines-infrastructure-overview",
        id: "grafana",
      }),
      expect.objectContaining({
        href: "https://litellm.example.test/ui/",
        id: "litellm",
      }),
      expect.objectContaining({
        href: "https://keycloak.example.test/keycloak/admin/llm-machines/console/",
        id: "keycloak",
      }),
    ])
    expect(
      technicalToolsForRole("admin", environment).some(({ id }) =>
        id.includes("portainer"),
      ),
    ).toBe(false)
  })

  it("gives Operator only the advanced LiteLLM authority", () => {
    expect(technicalToolsForRole("operator", environment)).toEqual([
      expect.objectContaining({
        href: "https://litellm.example.test/ui/",
        id: "litellm",
      }),
    ])
  })

  it.each([
    "https://grafana.example.test",
    "grafana.example.test/path",
    "user@grafana.example.test",
    "grafana.example.test:443",
    "grafana.example.test?token=secret",
    "127.0.0.1",
    "localhost",
  ])(
    "fails closed without emitting a link for unsafe host input %s",
    (host) => {
      const [grafana] = technicalToolsForRole("admin", {
        ...environment,
        PRODUCT_GRAFANA_HOST: host,
      })

      expect(grafana).toMatchObject({ href: null, id: "grafana" })
    },
  )
})
