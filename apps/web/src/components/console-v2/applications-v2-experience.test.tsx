import type {
  ConnectedAppCreateActionState,
  ConnectedAppCredentialActionState,
  ConnectedAppFirecrawlCredentialActionState,
  ConnectedAppFirecrawlLifecycleActionState,
  ConnectedAppFirecrawlTestActionState,
  ConnectedAppTestActionState,
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
} from "@testing-library/react"
import { axe } from "jest-axe"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  ApplicationsV2Experience,
  ConnectedAppCredentialReveal,
  ConnectedAppFirecrawlCredentialReveal,
} from "./applications-v2-experience"

const actionMocks = vi.hoisted(() => ({
  appDelete: vi.fn(),
  appDisable: vi.fn(),
  appEnable: vi.fn(),
  appPolicy: vi.fn(),
  check: vi.fn(),
  create: vi.fn(),
  firecrawlCheck: vi.fn(),
  firecrawlDisable: vi.fn(),
  firecrawlEnable: vi.fn(),
  firecrawlPolicy: vi.fn(),
  firecrawlRevoke: vi.fn(),
  firecrawlRotate: vi.fn(),
  revoke: vi.fn(),
  rotate: vi.fn(),
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
  checkAdminConnectedAppConnectionAction: actionMocks.check,
  checkAdminConnectedAppFirecrawlConnectionAction: actionMocks.firecrawlCheck,
  createAdminConnectedAppAction: actionMocks.create,
  disableAdminConnectedAppAction: actionMocks.appDisable,
  disableAdminConnectedAppFirecrawlAction: actionMocks.firecrawlDisable,
  enableAdminConnectedAppFirecrawlAction: actionMocks.firecrawlEnable,
  enableAdminConnectedAppAction: actionMocks.appEnable,
  revokeAdminConnectedAppCredentialAction: actionMocks.revoke,
  revokeAdminConnectedAppFirecrawlCredentialAction: actionMocks.firecrawlRevoke,
  rotateAdminConnectedAppFirecrawlCredentialAction: actionMocks.firecrawlRotate,
  rotateAdminConnectedAppCredentialsAction: actionMocks.rotate,
  softDeleteAdminConnectedAppAction: actionMocks.appDelete,
  updateAdminConnectedAppFirecrawlPolicyAction: actionMocks.firecrawlPolicy,
  updateAdminConnectedAppPolicyAction: actionMocks.appPolicy,
}))

beforeEach(() => {
  for (const actionMock of Object.values(actionMocks)) {
    actionMock.mockReset()
  }
  actionMocks.check.mockImplementation(
    async (state: ConnectedAppTestActionState) => state,
  )
  actionMocks.create.mockImplementation(
    async (state: ConnectedAppCreateActionState) => state,
  )
  actionMocks.revoke.mockImplementation(
    async (state: ConnectedAppCredentialActionState) => state,
  )
  actionMocks.rotate.mockImplementation(
    async (state: ConnectedAppCredentialActionState) => state,
  )
  actionMocks.firecrawlCheck.mockImplementation(
    async (state: ConnectedAppFirecrawlTestActionState) => state,
  )
  actionMocks.firecrawlEnable.mockImplementation(
    async (state: ConnectedAppFirecrawlCredentialActionState) => state,
  )
  actionMocks.firecrawlRotate.mockImplementation(
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
  actionMocks.appPolicy.mockResolvedValue(undefined)
  actionMocks.firecrawlPolicy.mockResolvedValue(undefined)
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

describe("PR-07 Applications experience", () => {
  it("submits stable aliases and keeps optional protections disabled by default", () => {
    render(
      <ApplicationsV2Experience
        accessRole="admin"
        modelOptions={[model]}
        view="new-app"
      />,
    )

    const modelCheckbox = screen.getByRole("checkbox", {
      name: "stable-chat-alias",
    }) as HTMLInputElement
    expect(modelCheckbox.value).toBe("stable-chat-alias")
    expect(modelCheckbox.value).not.toBe(model.id)
    expect(modelCheckbox.checked).toBe(true)

    for (const label of [
      "Requests per second",
      "Concurrent requests",
      "Context bytes per request",
      "Seven-day token alert threshold",
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
        /model access and context-size controls define each Application's permissions/i,
      ),
    ).toBeTruthy()
    expect(
      screen.getByText(
        /token threshold is visibility only and never blocks inference/i,
      ),
    ).toBeTruthy()
    expect(
      screen.getByText(
        /Firecrawl is installed on the appliance but stays off/i,
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

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Desktop client" },
    })
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "Third-party harness" },
    })
    const createButton = screen.getByRole("button", {
      name: "Create app",
    }) as HTMLButtonElement
    fireEvent.click(createButton)
    fireEvent.click(createButton)

    await waitFor(() => {
      expect(actionMocks.create).toHaveBeenCalledTimes(1)
      expect(createButton.disabled).toBe(true)
      expect(createButton.textContent).toBe("Creating app...")
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
      expect(createButton.textContent).toBe("Create app")
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

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Desktop client" },
    })
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "Third-party harness" },
    })
    const liveIssuanceStatus = screen.getByRole("status")
    expect(liveIssuanceStatus.textContent).toBe("")
    fireEvent.click(screen.getByRole("button", { name: "Create app" }))

    const revealHeading = await screen.findByRole("heading", {
      name: "Application credential",
    })
    await waitFor(() => {
      expect(document.activeElement).toBe(revealHeading)
    })
    const issuanceStatus = screen.getByRole("status")
    expect(issuanceStatus).toBe(liveIssuanceStatus)
    expect(issuanceStatus.textContent).toContain(
      "Application created. Copy its credential now.",
    )
    expect(issuanceStatus.textContent).not.toContain(staticReveal.apiKey)
    expect(issuanceStatus.contains(screen.getByText(staticReveal.apiKey))).toBe(
      false,
    )
    expect((await axe(container)).violations).toEqual([])
  })

  it("shows static and OAuth secrets only in the mutation reveal panel", () => {
    const { rerender } = render(
      <ConnectedAppCredentialReveal
        credential={staticReveal}
        title="Rotated credential"
      />,
    )

    expect(screen.getByText(staticReveal.apiKey)).toBeTruthy()
    expect(
      screen.getByText(
        /previous static key remains valid for an exact 24-hour overlap/,
      ),
    ).toBeTruthy()
    expect(screen.getByText(/shown once/)).toBeTruthy()

    rerender(
      <ConnectedAppCredentialReveal
        credential={oauthReveal}
        title="Rotated credential"
      />,
    )
    expect(screen.getByText(oauthReveal.clientSecret)).toBeTruthy()
    expect(
      screen.getByText(
        /previous OAuth client secret is invalidated immediately/,
      ),
    ).toBeTruthy()
    fireEvent(window, new Event("pagehide"))
    expect(screen.queryByText(oauthReveal.clientSecret)).toBeNull()
    expect(
      screen.getByText(/This one-time secret is no longer available/),
    ).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/staging|production/i)
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

    expect(
      screen.getByText("Web search and static single-page scrape only."),
    ).toBeTruthy()
    expect(
      screen.getByText(
        /crawl, map, batch scrape, structured extract, agent, and browser session APIs are not exposed/i,
      ),
    ).toBeTruthy()
    expect(
      screen.getByText(/passive T2 connection evidence, not proof/i),
    ).toBeTruthy()
    expect(
      screen.getByRole("heading", { name: "Firecrawl credentials" }),
    ).toBeTruthy()

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

    expect(
      screen.getByText(
        /Only an Admin can enable or re-enable outbound Firecrawl access/i,
      ),
    ).toBeTruthy()
    expect(
      screen.queryByRole("button", { name: "Enable Firecrawl" }),
    ).toBeNull()

    rerender(
      <ApplicationsV2Experience
        accessRole="operator"
        connectedAppDetail={firecrawlEnabledApplication}
        view="app-detail"
      />,
    )
    for (const name of [
      "Check connection",
      "Rotate credentials",
      "Revoke now",
      "Disable app",
      "Check Firecrawl connection",
      "Rotate Firecrawl credential",
      "Revoke Firecrawl key",
      "Disable Firecrawl",
      "Edit Firecrawl policy",
    ]) {
      expect(screen.queryByRole("button", { name })).toBeNull()
    }
    expect(
      screen.getAllByText("Operator access is read-only.", { exact: false }),
    ).toHaveLength(2)
  })

  it("hides open Admin-only mutation surfaces after an Operator role transition", () => {
    const { rerender } = render(
      <ApplicationsV2Experience
        accessRole="admin"
        connectedAppDetail={firecrawlEnabledApplication}
        modelOptions={[model]}
        view="app-detail"
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Edit policy" }))
    fireEvent.click(
      screen.getByRole("button", { name: "Edit Firecrawl policy" }),
    )
    fireEvent.click(screen.getByRole("button", { name: "Delete app" }))

    expect(
      screen.getByRole("heading", { name: "Application policy" }),
    ).toBeTruthy()
    expect(
      screen.getByRole("heading", { name: "Firecrawl protections" }),
    ).toBeTruthy()
    expect(
      screen.getByRole("dialog", { name: "Delete this app?" }),
    ).toBeTruthy()

    rerender(
      <ApplicationsV2Experience
        accessRole="operator"
        connectedAppDetail={firecrawlEnabledApplication}
        modelOptions={[model]}
        view="app-detail"
      />,
    )

    expect(
      screen.queryByRole("heading", { name: "Application policy" }),
    ).toBeNull()
    expect(
      screen.queryByRole("heading", { name: "Firecrawl protections" }),
    ).toBeNull()
    expect(
      screen.queryByRole("dialog", { name: "Delete this app?" }),
    ).toBeNull()
  })

  it("serializes Firecrawl rotation and blocks rapid duplicate submissions", async () => {
    let resolveRotation:
      | ((state: ConnectedAppFirecrawlCredentialActionState) => void)
      | undefined
    actionMocks.firecrawlRotate.mockImplementationOnce(
      async () =>
        new Promise<ConnectedAppFirecrawlCredentialActionState>((resolve) => {
          resolveRotation = resolve
        }),
    )
    render(
      <ApplicationsV2Experience
        accessRole="admin"
        connectedAppDetail={firecrawlEnabledApplication}
        view="app-detail"
      />,
    )

    fireEvent.click(
      screen.getByRole("button", { name: "Rotate Firecrawl credential" }),
    )
    const rotateSubmit = screen.getByRole("button", {
      name: "Rotate Firecrawl key",
    })
    fireEvent.click(rotateSubmit)
    fireEvent.click(rotateSubmit)

    await waitFor(() => {
      expect(actionMocks.firecrawlRotate).toHaveBeenCalledTimes(1)
      expect(screen.getByRole("button", { name: "Rotating..." })).toBeTruthy()
    })

    await act(async () => {
      resolveRotation?.({
        app: firecrawlEnabledApplication,
        credential: firecrawlReveal,
        detail: "Firecrawl credential rotated.",
        error: null,
        status: "rotated",
      })
    })

    expect(await screen.findByText(firecrawlReveal.apiKey)).toBeTruthy()
    expect(actionMocks.firecrawlRotate).toHaveBeenCalledTimes(1)
    expect(
      (
        screen.getByRole("button", {
          name: "Rotate Firecrawl credential",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false)
  })

  it("blocks Firecrawl and policy mutations behind deferred inference work without discarding its reveal", async () => {
    let resolveInferenceRotation:
      | ((state: ConnectedAppCredentialActionState) => void)
      | undefined
    actionMocks.firecrawlRotate.mockResolvedValueOnce({
      app: firecrawlEnabledApplication,
      credential: firecrawlReveal,
      detail: "Firecrawl credential rotated.",
      error: null,
      status: "rotated",
    })
    actionMocks.rotate.mockImplementationOnce(
      async () =>
        new Promise<ConnectedAppCredentialActionState>((resolve) => {
          resolveInferenceRotation = resolve
        }),
    )
    render(
      <ApplicationsV2Experience
        accessRole="admin"
        connectedAppDetail={firecrawlEnabledApplication}
        modelOptions={[model]}
        view="app-detail"
      />,
    )

    fireEvent.click(
      screen.getByRole("button", { name: "Rotate Firecrawl credential" }),
    )
    fireEvent.click(
      screen.getByRole("button", { name: "Rotate Firecrawl key" }),
    )
    expect(await screen.findByText(firecrawlReveal.apiKey)).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Edit policy" }))
    fireEvent.click(
      screen.getByRole("button", { name: "Edit Firecrawl policy" }),
    )
    fireEvent.click(screen.getByRole("button", { name: "Rotate credentials" }))
    fireEvent.click(
      screen.getByRole("button", { name: "Rotate Firecrawl credential" }),
    )

    const inferenceRotationForm = requiredParentForm(
      screen.getByRole("button", { name: "Rotate" }),
    )
    const firecrawlRotationForm = requiredParentForm(
      screen.getByRole("button", { name: "Rotate Firecrawl key" }),
    )
    const applicationPolicyForm = requiredParentForm(
      screen.getByRole("button", { name: "Save policy" }),
    )
    const firecrawlPolicyForm = requiredParentForm(
      screen.getByRole("button", { name: "Save Firecrawl policy" }),
    )

    act(() => {
      dispatchSubmit(inferenceRotationForm)
      dispatchSubmit(firecrawlRotationForm)
      dispatchSubmit(applicationPolicyForm)
      dispatchSubmit(firecrawlPolicyForm)
    })

    await waitFor(() => {
      expect(actionMocks.rotate).toHaveBeenCalledTimes(1)
      expect(
        screen.getAllByRole("button", { name: "Rotating..." }).length,
      ).toBeGreaterThan(0)
    })
    expect(actionMocks.firecrawlRotate).toHaveBeenCalledTimes(1)
    expect(actionMocks.appPolicy).not.toHaveBeenCalled()
    expect(actionMocks.firecrawlPolicy).not.toHaveBeenCalled()
    expect(screen.getByText(firecrawlReveal.apiKey)).toBeTruthy()
    for (const name of [
      "Save policy",
      "Save Firecrawl policy",
      "Disable app",
      "Delete app",
      "Check Firecrawl connection",
    ]) {
      expect(
        (
          screen.getByRole("button", {
            hidden: true,
            name,
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(true)
    }

    await act(async () => {
      resolveInferenceRotation?.({
        app: firecrawlEnabledApplication,
        credential: staticReveal,
        detail: "Inference credential rotated.",
        error: null,
        status: "rotated",
      })
    })
    expect(await screen.findByText(staticReveal.apiKey)).toBeTruthy()
    expect(screen.getByText(firecrawlReveal.apiKey)).toBeTruthy()
    await waitFor(() => {
      expect(
        (
          screen.getByRole("button", {
            hidden: true,
            name: "Rotate Firecrawl credential",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false)
    })
  })

  it("blocks inference and application lifecycle mutations behind deferred Firecrawl work without discarding its reveal", async () => {
    let resolveFirecrawlRotation:
      | ((state: ConnectedAppFirecrawlCredentialActionState) => void)
      | undefined
    actionMocks.rotate.mockResolvedValueOnce({
      app: firecrawlEnabledApplication,
      credential: staticReveal,
      detail: "Inference credential rotated.",
      error: null,
      status: "rotated",
    })
    actionMocks.firecrawlRotate.mockImplementationOnce(
      async () =>
        new Promise<ConnectedAppFirecrawlCredentialActionState>((resolve) => {
          resolveFirecrawlRotation = resolve
        }),
    )
    render(
      <ApplicationsV2Experience
        accessRole="admin"
        connectedAppDetail={firecrawlEnabledApplication}
        modelOptions={[model]}
        view="app-detail"
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Rotate credentials" }))
    fireEvent.click(screen.getByRole("button", { name: "Rotate" }))
    expect(await screen.findByText(staticReveal.apiKey)).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Edit policy" }))
    fireEvent.click(screen.getByRole("button", { name: "Disable app" }))
    fireEvent.click(screen.getByRole("button", { name: "Rotate credentials" }))
    fireEvent.click(
      screen.getByRole("button", { name: "Rotate Firecrawl credential" }),
    )

    const firecrawlRotationForm = requiredParentForm(
      screen.getByRole("button", { name: "Rotate Firecrawl key" }),
    )
    const inferenceRotationForm = requiredParentForm(
      screen.getByRole("button", { name: "Rotate" }),
    )
    const disableApplicationForm = requiredParentForm(
      screen.getByRole("button", { name: "Disable" }),
    )
    const applicationPolicyForm = requiredParentForm(
      screen.getByRole("button", { name: "Save policy" }),
    )

    act(() => {
      dispatchSubmit(firecrawlRotationForm)
      dispatchSubmit(inferenceRotationForm)
      dispatchSubmit(disableApplicationForm)
      dispatchSubmit(applicationPolicyForm)
    })

    await waitFor(() => {
      expect(actionMocks.firecrawlRotate).toHaveBeenCalledTimes(1)
      expect(
        screen.getAllByRole("button", { name: "Rotating..." }).length,
      ).toBeTruthy()
    })
    expect(actionMocks.rotate).toHaveBeenCalledTimes(1)
    expect(actionMocks.appDisable).not.toHaveBeenCalled()
    expect(actionMocks.appPolicy).not.toHaveBeenCalled()
    expect(screen.getByText(staticReveal.apiKey)).toBeTruthy()

    await act(async () => {
      resolveFirecrawlRotation?.({
        app: firecrawlEnabledApplication,
        credential: firecrawlReveal,
        detail: "Firecrawl credential rotated.",
        error: null,
        status: "rotated",
      })
    })
    expect(await screen.findByText(firecrawlReveal.apiKey)).toBeTruthy()
    expect(screen.getByText(staticReveal.apiKey)).toBeTruthy()
    await waitFor(() => {
      expect(
        (
          screen.getByRole("button", {
            hidden: true,
            name: "Rotate credentials",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false)
    })
  })

  it("shows inference and Firecrawl status together in the Applications overview", () => {
    render(
      <ApplicationsV2Experience
        accessRole="admin"
        connectedApps={[firecrawlEnabledApplication]}
        view="overview"
      />,
    )

    expect(screen.getByText("Inference").parentElement?.textContent).toContain(
      "Enabled",
    )
    expect(screen.getByText("Firecrawl").parentElement?.textContent).toContain(
      "Enabled",
    )
  })

  it("keeps a one-time Firecrawl secret outside live announcements", () => {
    render(
      <ConnectedAppFirecrawlCredentialReveal
        credential={firecrawlReveal}
        title="Rotated Firecrawl credential"
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

  it("gives an Admin policy and lifecycle controls for a disabled app", () => {
    render(
      <ApplicationsV2Experience
        accessRole="admin"
        connectedAppDetail={{ ...application, status: "disabled" }}
        modelOptions={[model]}
        view="app-detail"
      />,
    )

    expect(screen.getAllByText("Static API key")).toHaveLength(3)
    expect(screen.getByText(/cannot be changed after creation/)).toBeTruthy()
    expect(screen.getByText("credential-active")).toBeTruthy()
    expect(screen.getByText("llmm_live_")).toBeTruthy()
    expect(
      screen.getByRole("button", { name: "Check connection" }),
    ).toBeTruthy()
    expect(
      screen.getByRole("button", { name: "Rotate credentials" }),
    ).toBeTruthy()
    expect(screen.getByRole("button", { name: "Edit policy" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Re-enable app" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Delete app" })).toBeTruthy()
    expect(screen.getAllByRole("button", { name: "Revoke now" })).toHaveLength(
      2,
    )
    expect(screen.getByText("retiring")).toBeTruthy()
    expect(screen.getByText("llmm_old_")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Disable app" })).toBeNull()
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

    expect(screen.getByText("Token alert status")).toBeTruthy()
    expect(screen.getByText("Reached (non-blocking)")).toBeTruthy()
  })

  it("uses the rotation snapshot after an earlier revoke", async () => {
    const revokedApp = applicationSnapshot("Snapshot after revoke")
    const rotatedApp = applicationSnapshot("Snapshot after rotate")
    actionMocks.revoke.mockResolvedValueOnce({
      app: revokedApp,
      credential: null,
      detail: "Credential revoked immediately.",
      error: null,
      status: "revoked",
    })
    actionMocks.rotate.mockResolvedValueOnce({
      app: rotatedApp,
      credential: staticReveal,
      detail: "Credential rotated.",
      error: null,
      status: "rotated",
    })
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
    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: revokedApp.name }),
      ).toBeTruthy()
    })

    fireEvent.click(screen.getByRole("button", { name: "Rotate credentials" }))
    fireEvent.click(screen.getByRole("button", { name: "Rotate" }))
    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: rotatedApp.name }),
      ).toBeTruthy()
      expect(
        screen.queryByRole("heading", { name: revokedApp.name }),
      ).toBeNull()
    })
  })

  it("serializes a delayed rotation, blocks duplicates, and clears the prior reveal", async () => {
    const firstRotatedApp = applicationSnapshot("First rotation")
    const secondRotatedApp = applicationSnapshot("Second rotation")
    let resolveSecondRotation:
      | ((state: ConnectedAppCredentialActionState) => void)
      | undefined
    actionMocks.rotate
      .mockResolvedValueOnce({
        app: firstRotatedApp,
        credential: staticReveal,
        detail: "Credential rotated.",
        error: null,
        status: "rotated",
      })
      .mockImplementationOnce(
        async () =>
          new Promise<ConnectedAppCredentialActionState>((resolve) => {
            resolveSecondRotation = resolve
          }),
      )
    render(
      <ApplicationsV2Experience
        accessRole="admin"
        connectedAppDetail={application}
        view="app-detail"
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Rotate credentials" }))
    fireEvent.click(screen.getByRole("button", { name: "Rotate" }))
    expect(await screen.findByText(staticReveal.apiKey)).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Rotate credentials" }))
    const rotateSubmit = screen.getByRole("button", { name: "Rotate" })
    fireEvent.click(rotateSubmit)
    fireEvent.click(rotateSubmit)

    await waitFor(() => {
      expect(actionMocks.rotate).toHaveBeenCalledTimes(2)
      expect(screen.getByRole("button", { name: "Rotating..." })).toBeTruthy()
      expect(screen.queryByText(staticReveal.apiKey)).toBeNull()
    })
    expect(
      (
        screen.getByRole("button", {
          name: "Rotate credentials",
          hidden: true,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true)
    expect(
      (
        screen.getByRole("button", {
          name: "Check connection",
          hidden: true,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true)
    for (const revokeButton of screen.getAllByRole("button", {
      name: "Revoke now",
      hidden: true,
    })) {
      expect((revokeButton as HTMLButtonElement).disabled).toBe(true)
    }

    await act(async () => {
      resolveSecondRotation?.({
        app: secondRotatedApp,
        credential: secondStaticReveal,
        detail: "Credential rotated again.",
        error: null,
        status: "rotated",
      })
    })
    expect(await screen.findByText(secondStaticReveal.apiKey)).toBeTruthy()
    expect(screen.queryByText(staticReveal.apiKey)).toBeNull()
    expect(
      (
        screen.getByRole("button", {
          name: "Rotate credentials",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false)
  })

  it("blocks rotation and revocation while a passive check is pending", async () => {
    let resolveCheck: ((state: ConnectedAppTestActionState) => void) | undefined
    actionMocks.check.mockImplementationOnce(
      async () =>
        new Promise<ConnectedAppTestActionState>((resolve) => {
          resolveCheck = resolve
        }),
    )
    render(
      <ApplicationsV2Experience
        accessRole="admin"
        connectedAppDetail={application}
        view="app-detail"
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Check connection" }))
    await waitFor(() => {
      expect(actionMocks.check).toHaveBeenCalledTimes(1)
      expect(screen.getByRole("button", { name: "Checking..." })).toBeTruthy()
    })
    const rotateTrigger = screen.getByRole("button", {
      name: "Rotate credentials",
    }) as HTMLButtonElement
    expect(rotateTrigger.disabled).toBe(true)
    fireEvent.click(rotateTrigger)
    expect(
      screen.queryByRole("dialog", {
        name: "Rotate Application credential?",
      }),
    ).toBeNull()
    for (const revokeButton of screen.getAllByRole("button", {
      name: "Revoke now",
    })) {
      expect((revokeButton as HTMLButtonElement).disabled).toBe(true)
      fireEvent.click(revokeButton)
    }
    expect(actionMocks.rotate).not.toHaveBeenCalled()
    expect(actionMocks.revoke).not.toHaveBeenCalled()

    await act(async () => {
      resolveCheck?.({
        app: applicationSnapshot("Checked snapshot"),
        detail: "Waiting for a real client GET /models request.",
        error: null,
        observedAt: null,
        status: "waiting",
      })
    })
    await waitFor(() => {
      expect(
        (
          screen.getByRole("button", {
            name: "Rotate credentials",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false)
    })
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
    const deleteTrigger = screen.getByRole("button", { name: "Delete app" })
    deleteTrigger.focus()
    fireEvent.click(deleteTrigger)

    const dialog = screen.getByRole("dialog", { name: "Delete this app?" })
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
        screen.queryByRole("dialog", { name: "Delete this app?" }),
      ).toBeNull()
      expect(document.activeElement).toBe(deleteTrigger)
    })
  })

  it("uses the passive-check snapshot after an earlier rotation", async () => {
    const rotatedApp = applicationSnapshot("Snapshot after rotate")
    const checkedApp = {
      ...applicationSnapshot("Snapshot after check"),
      connectionStatus: "connected",
      lastConnectedAt: "2026-07-31T09:00:00.000Z",
    } satisfies AdminConnectedApp
    actionMocks.rotate.mockResolvedValueOnce({
      app: rotatedApp,
      credential: staticReveal,
      detail: "Credential rotated.",
      error: null,
      status: "rotated",
    })
    actionMocks.check.mockResolvedValueOnce({
      app: checkedApp,
      detail: "Observed a real client GET /models request.",
      error: null,
      observedAt: "2026-07-31T09:00:00.000Z",
      status: "passed",
    })
    render(
      <ApplicationsV2Experience
        accessRole="admin"
        connectedAppDetail={application}
        view="app-detail"
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Rotate credentials" }))
    fireEvent.click(screen.getByRole("button", { name: "Rotate" }))
    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: rotatedApp.name }),
      ).toBeTruthy()
    })

    fireEvent.click(screen.getByRole("button", { name: "Check connection" }))
    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: checkedApp.name }),
      ).toBeTruthy()
      expect(screen.getByText("Connected")).toBeTruthy()
      expect(
        screen.queryByRole("heading", { name: rotatedApp.name }),
      ).toBeNull()
    })
  })
})

function applicationSnapshot(name: string): AdminConnectedApp {
  return {
    ...application,
    name,
    updatedAt: "2026-07-31T09:00:00.000Z",
  }
}

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
  auditHref: "/activity?app=app-1",
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
  detailHref: "/applications/apps/app-1",
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

const secondStaticReveal = {
  ...staticReveal,
  apiKey: "llmm_second_secret_once",
  credentialId: "credential-newer",
  exampleCurl:
    'curl -H "Authorization: Bearer llmm_second_secret_once" https://api.example.test/v1/models',
  issuedAt: "2026-07-31T09:00:00.000Z",
  keyPrefix: "llmm_second_",
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
