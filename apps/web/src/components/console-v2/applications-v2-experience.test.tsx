import type {
  ConnectedAppCreateActionState,
  ConnectedAppCredentialActionState,
  ConnectedAppFirecrawlCredentialActionState,
  ConnectedAppFirecrawlLifecycleActionState,
} from "@/lib/admin/actions-core"
import type {
  AdminConnectedApp,
  AdminConnectedAppCredential,
  AdminConnectedAppFirecrawlCredential,
  AdminInferenceModel,
} from "@llm-machines/contracts/inference-core"
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import { axe } from "jest-axe"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  ApplicationsV2Experience,
  ConnectedAppFirecrawlCredentialReveal,
} from "./applications-v2-experience"

const actionMocks = vi.hoisted(() => ({
  appDelete: vi.fn(),
  appDisable: vi.fn(),
  appEnable: vi.fn(),
  create: vi.fn(),
  firecrawlDisable: vi.fn(),
  firecrawlEnable: vi.fn(),
  firecrawlRevoke: vi.fn(),
  revoke: vi.fn(),
}))
const routerMocks = vi.hoisted(() => ({ refresh: vi.fn(), replace: vi.fn() }))

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: routerMocks.refresh,
    replace: routerMocks.replace,
  }),
}))

let dialogShowModal: ReturnType<typeof vi.fn>
const originalDialogClose = Object.getOwnPropertyDescriptor(
  HTMLDialogElement.prototype,
  "close",
)
const originalDialogShowModal = Object.getOwnPropertyDescriptor(
  HTMLDialogElement.prototype,
  "showModal",
)

vi.mock("@/lib/admin/actions-core", () => ({
  createAdminConnectedAppAction: actionMocks.create,
  disableAdminConnectedAppAction: actionMocks.appDisable,
  disableAdminConnectedAppFirecrawlAction: actionMocks.firecrawlDisable,
  enableAdminConnectedAppFirecrawlAction: actionMocks.firecrawlEnable,
  enableAdminConnectedAppAction: actionMocks.appEnable,
  revokeAdminConnectedAppCredentialAction: actionMocks.revoke,
  revokeAdminConnectedAppFirecrawlCredentialAction: actionMocks.firecrawlRevoke,
  softDeleteAdminConnectedAppAction: actionMocks.appDelete,
}))

beforeEach(() => {
  for (const actionMock of Object.values(actionMocks)) {
    actionMock.mockReset()
  }
  routerMocks.refresh.mockReset()
  routerMocks.replace.mockReset()
  actionMocks.create.mockImplementation(
    async (state: ConnectedAppCreateActionState) => state,
  )
  actionMocks.revoke.mockImplementation(
    async (state: ConnectedAppCredentialActionState) => state,
  )
  actionMocks.firecrawlEnable.mockImplementation(
    async (state: ConnectedAppFirecrawlCredentialActionState) => state,
  )
  actionMocks.firecrawlRevoke.mockImplementation(
    async (state: ConnectedAppFirecrawlLifecycleActionState) => state,
  )
  actionMocks.firecrawlDisable.mockImplementation(
    async (state: ConnectedAppFirecrawlLifecycleActionState) => state,
  )
  actionMocks.appDelete.mockResolvedValue(undefined)
  actionMocks.appDisable.mockResolvedValue(undefined)
  actionMocks.appEnable.mockResolvedValue(undefined)
  dialogShowModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "")
  })
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: dialogShowModal,
  })
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.removeAttribute("open")
    },
  })
})

afterEach(() => {
  cleanup()
  restorePrototypeProperty(
    HTMLDialogElement.prototype,
    "showModal",
    originalDialogShowModal,
  )
  restorePrototypeProperty(
    HTMLDialogElement.prototype,
    "close",
    originalDialogClose,
  )
})

describe("Keys experience", () => {
  it("renders canonical Key links without a compatibility redirect", () => {
    const { rerender } = render(
      <ApplicationsV2Experience
        accessRole="admin"
        connectedApps={[application]}
        modelOptions={[model]}
        view="overview"
      />,
    )

    expect(
      screen.getByRole("link", { name: "Create Key" }).getAttribute("href"),
    ).toBe("/keys/apps/new")
    expect(
      screen
        .getAllByRole("link", { name: `Settings for ${application.name}` })[0]
        .getAttribute("href"),
    ).toBe(`/keys/apps/${application.id}`)

    rerender(
      <ApplicationsV2Experience
        accessRole="admin"
        modelOptions={[model]}
        view="new-app"
      />,
    )
    expect(
      screen.getByRole("link", { name: "Cancel" }).getAttribute("href"),
    ).toBe("/keys")
    expect(
      screen.getByRole("link", { name: "Keys" }).getAttribute("href"),
    ).toBe("/keys")
  })

  it("renders a compact sortable table with safe row actions", async () => {
    const recentlyUsed = {
      ...application,
      createdAt: "2026-08-01T08:00:00.000Z",
      credentials: application.credentials.map((credential) => ({
        ...credential,
        id: `${credential.id}-recent`,
      })),
      detailHref: "/keys/apps/app-2",
      id: "app-2",
      name: "Analytics service",
      usage: {
        ...application.usage,
        lastUsedAt: "2026-08-02T08:00:00.000Z",
      },
    } satisfies AdminConnectedApp
    const { container, rerender } = render(
      <ApplicationsV2Experience
        accessRole="admin"
        connectedApps={[application, recentlyUsed]}
        view="overview"
      />,
    )

    expect(screen.getByRole("table")).toBeTruthy()
    expect(
      screen
        .getByRole("columnheader", { name: "Date Created" })
        .getAttribute("aria-sort"),
    ).toBe("descending")
    expect(
      screen.getByRole("columnheader", { name: "Date Created" }).className,
    ).toContain("whitespace-nowrap")
    expect(
      screen.getByRole("columnheader", { name: "Firecrawl" }).className,
    ).toContain("whitespace-nowrap")
    expect(screen.getByRole("columnheader", { name: "Key Name" })).toBeTruthy()
    expect(screen.queryByText(/Credential ••••/)).toBeNull()
    expect(screen.queryByText(/Created Jul/i)).toBeNull()
    expect(screen.queryByText("llmm_live_")).toBeNull()
    expect(
      screen.getByRole("tooltip", { name: `Settings for ${application.name}` }),
    ).toBeTruthy()
    expect(
      screen.getByRole("tooltip", { name: `Delete ${application.name}` }),
    ).toBeTruthy()
    const deleteAction = screen.getAllByRole("button", {
      name: `Delete ${application.name}`,
    })[0]
    expect(deleteAction?.parentElement?.parentElement?.className).toContain(
      "gap-2",
    )
    expect(deleteAction?.className).toContain("size-[26px]")

    let rows = screen.getAllByRole("row").slice(1)
    expect(rows[0]?.textContent).toContain(recentlyUsed.name)
    expect(rows[0]?.textContent).toContain("Not enabled")
    expect(rows[0]?.querySelector("td:nth-child(4)")?.className).toContain(
      "whitespace-nowrap",
    )
    expect(rows[0]?.querySelector("td:nth-child(4) .rounded-full")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Key Name" }))
    rows = screen.getAllByRole("row").slice(1)
    expect(rows[0]?.textContent).toContain(recentlyUsed.name)
    expect(rows[1]?.textContent).toContain(application.name)
    fireEvent.click(screen.getByRole("button", { name: "Key Name" }))
    rows = screen.getAllByRole("row").slice(1)
    expect(rows[0]?.textContent).toContain(application.name)

    fireEvent.click(
      screen.getAllByRole("button", { name: `Delete ${application.name}` })[0],
    )
    expect(
      screen.getByRole("dialog", { name: `Delete ${application.name}?` }),
    ).toBeTruthy()
    expect(
      screen.getByRole("textbox", { name: "Type DELETE KEY to confirm" }),
    ).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))

    const accessibilityResult = await act(async () => axe(container))
    expect(accessibilityResult.violations).toEqual([])

    rerender(
      <ApplicationsV2Experience
        accessRole="operator"
        connectedApps={[application]}
        view="overview"
      />,
    )
    expect(
      screen.queryByRole("button", { name: `Delete ${application.name}` }),
    ).toBeNull()
  })

  it("shows concise immutable metadata and revoked history only when present", () => {
    const revokedCredential = {
      ...application.credentials[1],
      overlapExpiresAt: "2026-08-01T08:00:00.000Z",
      revokedAt: "2026-07-31T10:00:00.000Z",
      status: "revoked" as const,
    }
    const { rerender } = render(
      <ApplicationsV2Experience
        accessRole="admin"
        connectedAppDetail={application}
        view="app-detail"
      />,
    )

    expect(
      screen.getByRole("heading", { level: 1, name: "Key settings" }),
    ).toBeTruthy()
    expect(screen.getByText(application.name)).toBeTruthy()
    expect(screen.queryByText("Key configuration")).toBeNull()
    expect(screen.queryByText(/Fixed when this Key was created/)).toBeNull()
    expect(screen.getByText("Authentication")).toBeTruthy()
    expect(screen.getByText("Model access")).toBeTruthy()
    expect(screen.queryByText(/Credential history/)).toBeNull()

    rerender(
      <ApplicationsV2Experience
        accessRole="admin"
        connectedAppDetail={{
          ...application,
          credentials: [application.credentials[0], revokedCredential],
        }}
        view="app-detail"
      />,
    )
    const credentialHistory = screen
      .getByText("Credential history (1)")
      .closest("details")
    expect(credentialHistory?.open).toBe(false)
    fireEvent.click(screen.getByText("Credential history (1)"))
    expect(credentialHistory?.open).toBe(true)
    expect(screen.getByText("Revoked Jul 31, 2026, 10:00 AM")).toBeTruthy()
  })

  it("defaults to dynamic Auto and keeps Advanced features collapsed", () => {
    render(
      <ApplicationsV2Experience
        accessRole="admin"
        modelInventorySourceStatus="ok"
        modelOptions={[model]}
        view="new-app"
      />,
    )

    expect(
      screen.getByRole("button", { name: "Auto" }).getAttribute("aria-pressed"),
    ).toBe("true")
    expect(
      screen.queryByRole("checkbox", { name: "stable-chat-alias" }),
    ).toBeNull()
    const advanced = screen.getByRole("button", { name: "Advanced features" })
    expect(advanced.getAttribute("aria-expanded")).toBe("false")
    expect(screen.queryByText("Authentication method")).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Manual" }))
    const modelCheckbox = screen.getByRole("checkbox", {
      name: "stable-chat-alias",
    }) as HTMLInputElement
    expect(modelCheckbox.value).toBe("stable-chat-alias")
    expect(modelCheckbox.value).not.toBe(model.id)
    expect(modelCheckbox.checked).toBe(true)

    fireEvent.click(advanced)
    expect(advanced.getAttribute("aria-expanded")).toBe("true")
    expect(screen.getByText("Authentication method")).toBeTruthy()
    expect(
      screen
        .getByRole("button", { name: "Static API key" })
        .getAttribute("aria-pressed"),
    ).toBe("true")

    for (const label of [
      "Requests per second",
      "Concurrent requests",
      "Maximum context size",
      "Seven-day usage alert",
    ]) {
      expect(
        (screen.getByRole("checkbox", { name: label }) as HTMLInputElement)
          .checked,
      ).toBe(false)
      expect(
        (
          screen.getByRole("spinbutton", {
            name: `${label} value`,
          }) as HTMLInputElement
        ).disabled,
      ).toBe(true)
    }
    expect(
      screen.getByText(
        /customer owns the hardware and may use available compute/i,
      ),
    ).toBeTruthy()
    expect(
      screen.getByText(
        /request-rate and concurrency controls protect service health/i,
      ),
    ).toBeTruthy()
    expect(
      screen.getByText(
        /model access and context-size controls define each Key's permissions/i,
      ),
    ).toBeTruthy()
    expect(
      screen.getByText(
        /token threshold is visibility only and never blocks inference/i,
      ),
    ).toBeTruthy()
    expect(
      screen.getByText(
        /Create Key issues inference access only. Firecrawl stays off/i,
      ),
    ).toBeTruthy()
    expect(screen.queryByText(/alert delivery/i)).toBeNull()
    expect(screen.queryByText("Owner group")).toBeNull()
  })

  it("admits only one create while the one-time credential mutation is pending", async () => {
    let resolveCreate:
      | ((state: ConnectedAppCreateActionState) => void)
      | undefined
    actionMocks.create.mockImplementationOnce(
      async () =>
        new Promise<ConnectedAppCreateActionState>((resolve) => {
          resolveCreate = resolve
        }),
    )
    render(
      <ApplicationsV2Experience
        accessRole="admin"
        modelOptions={[model]}
        view="new-app"
      />,
    )

    fireEvent.change(screen.getByLabelText("Key name"), {
      target: { value: "Desktop client" },
    })
    fireEvent.change(screen.getByLabelText("Description (optional)"), {
      target: { value: "Third-party harness" },
    })
    const createButton = screen.getByRole("button", {
      name: "Create Key",
    }) as HTMLButtonElement
    fireEvent.click(createButton)
    fireEvent.click(createButton)

    await waitFor(() => {
      expect(actionMocks.create).toHaveBeenCalledTimes(1)
      expect(createButton.disabled).toBe(true)
      expect(createButton.textContent).toBe("Creating key...")
    })

    await act(async () => {
      resolveCreate?.({
        app: null,
        credential: null,
        error: "Delayed test mutation released.",
        status: "failed",
      })
    })
    await waitFor(() => {
      expect(createButton.disabled).toBe(false)
      expect(createButton.textContent).toBe("Create Key")
    })
  })

  it("announces credential issuance without putting the secret in a live region", async () => {
    actionMocks.create.mockResolvedValueOnce({
      app: application,
      credential: staticReveal,
      error: null,
      status: "created",
    })
    const { container } = render(
      <ApplicationsV2Experience
        accessRole="admin"
        modelOptions={[model]}
        view="new-app"
      />,
    )

    fireEvent.change(screen.getByLabelText("Key name"), {
      target: { value: "Desktop client" },
    })
    fireEvent.change(screen.getByLabelText("Description (optional)"), {
      target: { value: "Third-party harness" },
    })
    const createButton = screen.getByRole("button", { name: "Create Key" })
    const liveIssuanceStatus = screen.getByRole("status")
    expect(liveIssuanceStatus.textContent).toBe("")
    fireEvent.click(createButton)

    const revealHeading = await screen.findByRole("heading", {
      name: "Key created",
    })
    await waitFor(() => {
      expect(document.activeElement).toBe(revealHeading)
    })
    const issuanceStatus = screen.getByRole("status")
    expect(issuanceStatus).toBe(liveIssuanceStatus)
    expect(issuanceStatus.textContent).toContain(
      "Key created. Copy its credential now.",
    )
    expect(issuanceStatus.textContent).not.toContain(staticReveal.apiKey)
    expect(issuanceStatus.contains(screen.getByText(staticReveal.apiKey))).toBe(
      false,
    )
    expect((await axe(container)).violations).toEqual([])

    const dialog = screen.getByRole("dialog", { name: "Key created" })
    expect(
      screen.getByRole("link", { name: "View Key" }).getAttribute("href"),
    ).toBe(`/keys/apps/${application.id}`)
    const firstDialogControl = screen.getByRole("button", {
      name: "Copy Credential ID",
    })
    const lastDialogControl = screen.getByRole("button", { name: "Done" })
    lastDialogControl.focus()
    fireEvent.keyDown(dialog, { key: "Tab" })
    expect(document.activeElement).toBe(firstDialogControl)
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true })
    expect(document.activeElement).toBe(lastDialogControl)

    routerMocks.replace.mockImplementationOnce((destination) => {
      expect(screen.queryByText(staticReveal.apiKey)).toBeNull()
      expect(document.activeElement).toBe(createButton)
      expect(String(destination)).not.toContain(staticReveal.apiKey)
    })
    await act(async () => {
      fireEvent(
        dialog,
        new Event("cancel", { bubbles: false, cancelable: true }),
      )
    })
    await waitFor(() => {
      expect(screen.queryByText(staticReveal.apiKey)).toBeNull()
      expect(screen.queryByRole("dialog", { name: "Key created" })).toBeNull()
    })
    expect(routerMocks.replace).toHaveBeenCalledWith(application.detailHref)
    expect(JSON.stringify(routerMocks.replace.mock.calls)).not.toContain(
      staticReveal.apiKey,
    )
  })

  it("creates OAuth inference material from Advanced features without a description or Firecrawl secret", async () => {
    actionMocks.create.mockImplementationOnce(async (_state, formData) => {
      expect(formData.get("authMethod")).toBe("oauth_client_credentials")
      expect(formData.get("description")).toBe("")
      expect(formData.get("modelMode")).toBe("auto")
      return {
        app: oauthApplication,
        credential: oauthReveal,
        error: null,
        status: "created",
      }
    })
    render(
      <ApplicationsV2Experience
        accessRole="admin"
        modelInventorySourceStatus="ok"
        modelOptions={[model]}
        view="new-app"
      />,
    )

    fireEvent.change(screen.getByLabelText("Key name"), {
      target: { value: "OAuth client" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Advanced features" }))
    fireEvent.click(
      screen.getByRole("button", { name: "OAuth client credentials" }),
    )
    fireEvent.click(screen.getByRole("button", { name: "Create Key" }))

    const revealDialog = await screen.findByRole("dialog", {
      name: "Key created",
    })
    expect(
      within(revealDialog).getByText(oauthReveal.clientSecret),
    ).toBeTruthy()
    expect(within(revealDialog).getByText(oauthReveal.clientId)).toBeTruthy()
    expect(
      screen.queryByRole("button", { name: "Copy Firecrawl API key" }),
    ).toBeNull()
    fireEvent.click(within(revealDialog).getByRole("button", { name: "Done" }))
    await waitFor(() => {
      expect(screen.queryByText(oauthReveal.clientSecret)).toBeNull()
    })
  })

  it.each([
    ["history navigation", () => new Event("popstate")],
    ["reload or navigation", () => new Event("pagehide")],
    [
      "back-forward cache restoration",
      () => Object.assign(new Event("pageshow"), { persisted: true }),
    ],
  ])("clears the creation secret before %s", async (_label, event) => {
    actionMocks.create.mockResolvedValueOnce({
      app: application,
      credential: staticReveal,
      error: null,
      status: "created",
    })
    render(
      <ApplicationsV2Experience
        accessRole="admin"
        modelOptions={[model]}
        view="new-app"
      />,
    )
    fireEvent.change(screen.getByLabelText("Key name"), {
      target: { value: "History-safe Key" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Create Key" }))
    expect(await screen.findByText(staticReveal.apiKey)).toBeTruthy()

    fireEvent(window, event())
    await waitFor(() => {
      expect(screen.queryByText(staticReveal.apiKey)).toBeNull()
      expect(screen.queryByRole("dialog", { name: "Key created" })).toBeNull()
    })
  })

  it("keeps Firecrawl off by default and lets an Admin enable bounded web access", async () => {
    actionMocks.firecrawlEnable.mockResolvedValueOnce({
      app: firecrawlEnabledApplication,
      credential: firecrawlReveal,
      detail: "Firecrawl enabled with a separate credential.",
      error: null,
      status: "enabled",
    })
    render(
      <ApplicationsV2Experience
        accessRole="admin"
        connectedAppDetail={application}
        modelOptions={[model]}
        view="app-detail"
      />,
    )

    expect(screen.getByRole("heading", { name: "Firecrawl" })).toBeTruthy()
    expect(screen.queryByText("Capabilities")).toBeNull()
    expect(screen.queryByText("Firecrawl client activity")).toBeNull()
    expect(screen.queryByText("Firecrawl credentials")).toBeNull()

    const enableDisclosure = screen.getByRole("switch", {
      name: "Enable Firecrawl",
    })
    expect(enableDisclosure.getAttribute("aria-checked")).toBe("false")
    expect(enableDisclosure.getAttribute("aria-expanded")).toBe("false")
    fireEvent.click(enableDisclosure)
    expect(enableDisclosure.getAttribute("aria-checked")).toBe("false")
    expect(enableDisclosure.getAttribute("aria-expanded")).toBe("true")
    expect(
      document.getElementById("firecrawl-enable-panel")?.className,
    ).toContain("grid-rows-[1fr]")

    for (const label of [
      "Search requests per second",
      "Static scrape requests per second",
      "Concurrent static scrapes",
    ]) {
      expect(
        (screen.getByRole("checkbox", { name: label }) as HTMLInputElement)
          .checked,
      ).toBe(false)
      expect(
        (
          screen.getByRole("spinbutton", {
            name: `${label} value`,
          }) as HTMLInputElement
        ).disabled,
      ).toBe(true)
    }

    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /I understand that enabling Firecrawl permits outbound web requests/i,
      }),
    )
    fireEvent.click(screen.getByRole("button", { name: "Enable Firecrawl" }))

    expect(await screen.findByText(firecrawlReveal.apiKey)).toBeTruthy()
    expect(actionMocks.firecrawlEnable).toHaveBeenCalledTimes(1)
    expect(screen.getByText("Capabilities")).toBeTruthy()
    expect(
      screen.getByRole("switch", { name: "Disable Firecrawl" }),
    ).toBeTruthy()
    expect(
      screen
        .getByRole("switch", { name: "Disable Firecrawl" })
        .getAttribute("aria-checked"),
    ).toBe("true")
    expect(
      screen.getByRole("heading", { name: "Firecrawl credential" }),
    ).toBeTruthy()
    for (const liveRegion of document.querySelectorAll("[aria-live]")) {
      expect(liveRegion.textContent).not.toContain(firecrawlReveal.apiKey)
    }
  })

  it("keeps all Application and Firecrawl lifecycle controls Admin-only", () => {
    const { rerender } = render(
      <ApplicationsV2Experience
        accessRole="operator"
        connectedAppDetail={application}
        view="app-detail"
      />,
    )

    expect(screen.getByText(/Operator access is read-only/i)).toBeTruthy()
    expect(
      (
        screen.getByRole("switch", {
          name: "Enable Firecrawl",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true)

    rerender(
      <ApplicationsV2Experience
        accessRole="operator"
        connectedAppDetail={firecrawlEnabledApplication}
        view="app-detail"
      />,
    )
    for (const name of [
      "Refresh access status",
      "Rotate credentials",
      "Revoke now",
      "Disable Key",
      "Revoke Firecrawl key",
      "Edit Firecrawl policy",
    ]) {
      expect(screen.queryByRole("button", { name })).toBeNull()
    }
    expect(
      (
        screen.getByRole("switch", {
          name: "Disable Firecrawl",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true)
    expect(
      screen.getAllByText("Operator access is read-only.", { exact: false }),
    ).toHaveLength(1)
  })

  it("keeps inference and enabled Firecrawl immutable and uses the access switch for lifecycle changes", () => {
    render(
      <ApplicationsV2Experience
        accessRole="admin"
        connectedAppDetail={firecrawlEnabledApplication}
        view="app-detail"
      />,
    )

    for (const name of [
      "Rotate credentials",
      "Edit policy",
      "Rotate Firecrawl credential",
      "Edit Firecrawl policy",
    ]) {
      expect(screen.queryByRole("button", { name })).toBeNull()
    }
    expect(screen.queryByText("Key configuration")).toBeNull()
    expect(screen.queryByText(/Fixed when this Key was created/)).toBeNull()
    expect(screen.getByText(/Fixed when Firecrawl was enabled/)).toBeTruthy()
    const accessSwitch = screen.getByRole("switch", {
      name: "Disable Firecrawl",
    })
    expect(accessSwitch.getAttribute("aria-checked")).toBe("true")

    fireEvent.click(accessSwitch)
    expect(
      screen.getByRole("dialog", { name: "Disable Firecrawl?" }),
    ).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))

    expect(
      screen.queryByRole("dialog", { name: "Disable Firecrawl?" }),
    ).toBeNull()
    expect(accessSwitch.getAttribute("aria-checked")).toBe("true")
    expect(actionMocks.firecrawlDisable).not.toHaveBeenCalled()
  })

  it("re-enables Firecrawl only with its original credential and fixed configuration", () => {
    render(
      <ApplicationsV2Experience
        accessRole="admin"
        connectedAppDetail={{
          ...firecrawlEnabledApplication,
          firecrawl: {
            ...firecrawlEnabledApplication.firecrawl,
            status: "disabled",
          },
        }}
        view="app-detail"
      />,
    )

    const accessSwitch = screen.getByRole("switch", {
      name: "Enable Firecrawl",
    })
    expect(accessSwitch.getAttribute("aria-checked")).toBe("false")
    expect(screen.queryByText(/outbound web access disclaimer/i)).toBeNull()
    expect(
      screen.getByText(/original credential and fixed access limits/i),
    ).toBeTruthy()

    fireEvent.click(accessSwitch)
    expect(
      screen.getByRole("dialog", { name: "Re-enable Firecrawl?" }),
    ).toBeTruthy()
    expect(
      screen.getByText(
        /original credential and fixed access limits created for this Key/i,
      ),
    ).toBeTruthy()
  })

  it("does not reissue Firecrawl after its one-time credential is revoked", () => {
    render(
      <ApplicationsV2Experience
        accessRole="admin"
        connectedAppDetail={{
          ...firecrawlEnabledApplication,
          firecrawl: {
            ...firecrawlEnabledApplication.firecrawl,
            credentials: firecrawlEnabledApplication.firecrawl.credentials.map(
              (credential) => ({
                ...credential,
                revokedAt: "2026-08-01T08:00:00.000Z",
                status: "revoked" as const,
              }),
            ),
            status: "disabled",
          },
        }}
        view="app-detail"
      />,
    )

    expect(screen.getByText(/cannot issue a replacement/i)).toBeTruthy()
    expect(
      (
        screen.getByRole("switch", {
          name: "Enable Firecrawl",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true)
    expect(
      screen
        .getByRole("link", { name: "Create a new Key" })
        .getAttribute("href"),
    ).toBe("/keys/apps/new")
  })

  it("suspends enabled Firecrawl when its parent Key is disabled", () => {
    render(
      <ApplicationsV2Experience
        accessRole="admin"
        connectedAppDetail={{
          ...firecrawlEnabledApplication,
          status: "disabled",
        }}
        view="app-detail"
      />,
    )

    expect(
      screen.getByText(/Firecrawl is suspended while this Key is disabled/i),
    ).toBeTruthy()
    const accessSwitch = screen.getByRole("switch", {
      name: "Disable Firecrawl",
    }) as HTMLButtonElement
    expect(accessSwitch.getAttribute("aria-checked")).toBe("true")
    expect(accessSwitch.disabled).toBe(true)
  })

  it("directs an Admin to create a new Key when no inference credential remains", () => {
    render(
      <ApplicationsV2Experience
        accessRole="admin"
        connectedAppDetail={{
          ...application,
          credentials: application.credentials.map((credential) => ({
            ...credential,
            revokedAt: credential.revokedAt ?? "2026-08-01T08:00:00.000Z",
            status: "revoked" as const,
          })),
          status: "disabled",
        }}
        view="app-detail"
      />,
    )

    expect(
      screen.getByText(/No active inference credential remains for this Key/i),
    ).toBeTruthy()
    expect(screen.queryByRole("button", { name: /Rotate/ })).toBeNull()
    expect(screen.queryByRole("button", { name: "Re-enable Key" })).toBeNull()
    expect(
      screen
        .getByRole("link", { name: "Create a new Key" })
        .getAttribute("href"),
    ).toBe("/keys/apps/new")
  })

  it("shows inference and Firecrawl status together in the Keys overview", () => {
    render(
      <ApplicationsV2Experience
        accessRole="admin"
        connectedApps={[firecrawlEnabledApplication]}
        view="overview"
      />,
    )

    expect(screen.getByRole("table").textContent).toContain("Active")
    expect(screen.getByRole("table").textContent).toContain("Enabled")
  })

  it("keeps a one-time Firecrawl secret outside live announcements", () => {
    render(
      <ConnectedAppFirecrawlCredentialReveal
        credential={firecrawlReveal}
        title="Firecrawl credential"
      />,
    )

    expect(screen.getByText(firecrawlReveal.apiKey)).toBeTruthy()
    expect(screen.getByText(/shown once/i)).toBeTruthy()
    expect(
      screen.getByText(/separate from the inference credential/i),
    ).toBeTruthy()
    for (const liveRegion of document.querySelectorAll("[aria-live]")) {
      expect(liveRegion.textContent).not.toContain(firecrawlReveal.apiKey)
    }
  })

  it("shows immutable configuration and suspended optional access for a disabled Key", () => {
    render(
      <ApplicationsV2Experience
        accessRole="admin"
        connectedAppDetail={{ ...application, status: "disabled" }}
        modelOptions={[model]}
        view="app-detail"
      />,
    )

    expect(screen.getAllByText("Static API key")).toHaveLength(1)
    expect(screen.queryByText("Key configuration")).toBeNull()
    expect(screen.queryByText(/Fixed when this Key was created/)).toBeNull()
    expect(screen.queryByText("credential-active")).toBeNull()
    expect(screen.getByText("Credential •••• ive_")).toBeTruthy()
    expect(
      screen.getByRole("button", {
        name: "Refresh access status",
      }),
    ).toBeTruthy()
    expect(
      screen.queryByRole("button", { name: "Rotate credentials" }),
    ).toBeNull()
    expect(screen.queryByRole("button", { name: "Edit policy" })).toBeNull()
    expect(screen.getByText(/Firecrawl controls are unavailable/)).toBeTruthy()
    expect(
      (
        screen.getByRole("switch", {
          name: "Enable Firecrawl",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true)
    const usageSummary = screen.getByLabelText("Inference usage, last 7 days")
    expect(usageSummary.textContent).toContain("Last used")
    expect(usageSummary.textContent).toContain("Requests, 7 days")
    expect(usageSummary.textContent).toContain("Tokens, 7 days")
    expect(screen.getByRole("button", { name: "Re-enable Key" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Delete Key" })).toBeTruthy()
    expect(screen.getAllByRole("button", { name: "Revoke now" })).toHaveLength(
      2,
    )
    expect(screen.getByText("Retiring")).toBeTruthy()
    expect(screen.getByText("Credential •••• old_")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Disable Key" })).toBeNull()
  })

  it("shows a reached token threshold as non-blocking visibility", () => {
    render(
      <ApplicationsV2Experience
        accessRole="admin"
        connectedAppDetail={{
          ...application,
          tokenAlertState: "reached",
          tokenAlertThreshold7d: 1_000_000,
        }}
        modelOptions={[model]}
        view="app-detail"
      />,
    )

    expect(screen.getByText("Seven-day usage alert")).toBeTruthy()
    expect(screen.getByText(/Reached \(non-blocking\)/)).toBeTruthy()
  })

  it("recovers when an interrupted credential action returns no state", async () => {
    const sessionProbe = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }))
    actionMocks.revoke.mockResolvedValueOnce(undefined)
    render(
      <ApplicationsV2Experience
        accessRole="admin"
        connectedAppDetail={application}
        modelOptions={[model]}
        view="app-detail"
      />,
    )

    fireEvent.click(screen.getAllByRole("button", { name: "Revoke now" })[0])
    const revokeConfirmation = screen
      .getAllByRole("button", { name: "Revoke now" })
      .at(-1)
    if (!revokeConfirmation) {
      throw new Error("Expected revoke confirmation button.")
    }
    fireEvent.click(revokeConfirmation)

    expect(
      await screen.findByText(
        "The action did not complete. Sign in again or retry.",
      ),
    ).toBeTruthy()
    expect(
      screen.queryByRole("dialog", { name: "Revoke credential now?" }),
    ).toBeNull()
    expect(
      (screen.getByRole("button", { name: "Delete Key" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false)
    await waitFor(
      () =>
        expect(sessionProbe).toHaveBeenCalledWith(
          "/",
          expect.objectContaining({
            cache: "no-store",
            credentials: "same-origin",
            method: "HEAD",
          }),
        ),
      { timeout: 2_000 },
    )
    sessionProbe.mockRestore()
  })

  it("uses one global refresh for inference and enabled Firecrawl status", () => {
    render(
      <ApplicationsV2Experience
        accessRole="admin"
        connectedAppDetail={firecrawlEnabledApplication}
        view="app-detail"
      />,
    )

    expect(
      screen.getAllByRole("button", { name: "Refresh access status" }),
    ).toHaveLength(1)
    expect(screen.getByText("Inference API")).toBeTruthy()
    expect(screen.getAllByText("Firecrawl", { exact: true })).toHaveLength(2)
    expect(screen.getAllByText("Client activity:")).toHaveLength(2)
    expect(
      screen.queryByRole("button", {
        name: "Refresh Firecrawl connection evidence",
      }),
    ).toBeNull()

    fireEvent.click(
      screen.getByRole("button", { name: "Refresh access status" }),
    )
    expect(routerMocks.refresh).toHaveBeenCalledTimes(1)
  })

  it("uses a native modal, handles Escape, and restores trigger focus", async () => {
    const { container } = render(
      <ApplicationsV2Experience
        accessRole="admin"
        connectedAppDetail={application}
        modelOptions={[model]}
        view="app-detail"
      />,
    )
    const deleteTrigger = screen.getByRole("button", { name: "Delete Key" })
    deleteTrigger.focus()
    fireEvent.click(deleteTrigger)

    const dialog = screen.getByRole("dialog", { name: "Delete this Key?" })
    expect(dialogShowModal).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Cancel" }),
    )
    const accessibilityResult = await act(async () => axe(container))
    expect(accessibilityResult.violations).toEqual([])

    await act(async () => {
      fireEvent(
        dialog,
        new Event("cancel", {
          bubbles: false,
          cancelable: true,
        }),
      )
    })
    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "Delete this Key?" }),
      ).toBeNull()
      expect(document.activeElement).toBe(deleteTrigger)
    })
  })

  it("shows concise Auto model access without repeating inventory copy", () => {
    render(
      <ApplicationsV2Experience
        accessRole="admin"
        connectedAppDetail={{
          ...application,
          allowedModels: [],
          modelMode: "auto",
        }}
        view="app-detail"
      />,
    )

    const modelAccess = screen.getByText("Model access").closest("div")
    expect(modelAccess?.textContent).toBe("Model accessAuto")
    expect(
      screen.queryByText(/follows the active approved inventory/i),
    ).toBeNull()
  })
})

function restorePrototypeProperty(
  target: object,
  name: string,
  descriptor: PropertyDescriptor | undefined,
) {
  if (descriptor) {
    Object.defineProperty(target, name, descriptor)
    return
  }
  Reflect.deleteProperty(target, name)
}

function requiredParentForm(element: HTMLElement): HTMLFormElement {
  const form = element.closest("form")
  if (!form) {
    throw new Error("Expected the mutation control to belong to a form.")
  }
  return form
}

function dispatchSubmit(form: HTMLFormElement): void {
  form.dispatchEvent(
    new Event("submit", {
      bubbles: true,
      cancelable: true,
    }),
  )
}

const model: AdminInferenceModel = {
  contextWindow: 32_768,
  id: "litellm-internal-model-id",
  mode: "chat",
  name: "stable-chat-alias",
  outputCostPerMillionTokens: null,
  provider: "Local",
  sourceStatus: "ok",
}

const application: AdminConnectedApp = {
  allowedModels: [model.name],
  authMethod: "api_key",
  connectionStatus: "not_connected",
  createdAt: "2026-07-31T08:00:00.000Z",
  credentials: [
    {
      authMethod: "api_key",
      clientId: null,
      id: "credential-active",
      issuedAt: "2026-07-31T08:00:00.000Z",
      keyPrefix: "llmm_live_",
      lastUsedAt: null,
      overlapExpiresAt: null,
      revokedAt: null,
      rotatedAt: null,
      status: "active",
    },
    {
      authMethod: "api_key",
      clientId: null,
      id: "credential-retiring",
      issuedAt: "2026-07-30T08:00:00.000Z",
      keyPrefix: "llmm_old_",
      lastUsedAt: "2026-07-31T07:00:00.000Z",
      overlapExpiresAt: "2026-08-01T08:00:00.000Z",
      revokedAt: null,
      rotatedAt: "2026-07-31T08:00:00.000Z",
      status: "retiring",
    },
  ],
  description: "Third-party desktop client",
  detailHref: "/keys/apps/app-1",
  firecrawl: {
    connectionStatus: "not_connected",
    credentials: [],
    disclaimerAcceptedAt: null,
    disclaimerVersion: null,
    lastConnectedAt: null,
    maxConcurrentScrapes: null,
    scrapeRateLimitRps: null,
    searchRateLimitRps: null,
    status: "disabled",
  },
  id: "app-1",
  lastConnectedAt: null,
  maxConcurrentRequests: null,
  maxContextBytes: null,
  modelMode: "manual",
  name: "Desktop client",
  rateLimitRps: null,
  status: "enabled",
  tokenAlertState: null,
  tokenAlertThreshold7d: null,
  updatedAt: "2026-07-31T08:00:00.000Z",
  usage: {
    failures7d: 0,
    lastUsedAt: null,
    requests7d: 0,
    tokens7d: 0,
  },
}

const oauthApplication = {
  ...application,
  authMethod: "oauth_client_credentials",
  credentials: [
    {
      authMethod: "oauth_client_credentials",
      clientId: "application-client",
      id: "credential-oauth",
      issuedAt: "2026-07-31T08:00:00.000Z",
      keyPrefix: null,
      lastUsedAt: null,
      overlapExpiresAt: null,
      revokedAt: null,
      rotatedAt: null,
      status: "active",
    },
  ],
  description: "",
  name: "OAuth client",
} satisfies AdminConnectedApp

const firecrawlEnabledApplication = {
  ...application,
  firecrawl: {
    connectionStatus: "not_connected",
    credentials: [
      {
        id: "firecrawl-credential-active",
        issuedAt: "2026-07-31T08:00:00.000Z",
        keyPrefix: "llmm_fc_0123456789abcdef",
        lastUsedAt: null,
        overlapExpiresAt: null,
        revokedAt: null,
        rotatedAt: null,
        status: "active",
      },
    ],
    disclaimerAcceptedAt: "2026-07-31T08:00:00.000Z",
    disclaimerVersion: "2026-07-31",
    lastConnectedAt: null,
    maxConcurrentScrapes: null,
    scrapeRateLimitRps: null,
    searchRateLimitRps: null,
    status: "enabled",
  },
} satisfies AdminConnectedApp

const firecrawlReveal = {
  apiKey:
    "llmm_fc_0123456789abcdef_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ",
  credentialId: "firecrawl-credential-active",
  exampleCurl:
    'curl -H "Authorization: Bearer llmm_fc_0123456789abcdef_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ" https://firecrawl.example.test/v2/search',
  firecrawlBaseUrl: "https://firecrawl.example.test",
  issuedAt: "2026-07-31T08:00:00.000Z",
  keyPrefix: "llmm_fc_0123456789abcdef",
} satisfies AdminConnectedAppFirecrawlCredential

const staticReveal = {
  apiKey: "llmm_secret_once",
  authMethod: "api_key",
  bffBaseUrl: "https://api.example.test",
  credentialId: "credential-new",
  exampleCurl:
    'curl -H "Authorization: Bearer llmm_secret_once" https://api.example.test/v1/models',
  issuedAt: "2026-07-31T08:00:00.000Z",
  keyPrefix: "llmm_secret_",
  model: model.name,
  openAiBaseUrl: "https://api.example.test/v1",
} satisfies AdminConnectedAppCredential

const oauthReveal = {
  authMethod: "oauth_client_credentials",
  bffBaseUrl: "https://api.example.test",
  clientId: "application-client",
  clientSecret: "oauth_secret_once",
  credentialId: "credential-oauth",
  exampleCurl:
    'curl -H "Authorization: Bearer <token>" https://api.example.test/v1/models',
  issuedAt: "2026-07-31T08:00:00.000Z",
  keyPrefix: null,
  model: model.name,
  openAiBaseUrl: "https://api.example.test/v1",
  tokenUrl:
    "https://identity.example.test/realms/llm-machines-applications/protocol/openid-connect/token",
} satisfies AdminConnectedAppCredential
