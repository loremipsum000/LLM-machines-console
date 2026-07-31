import type {
  ConnectedAppCreateActionState,
  ConnectedAppCredentialActionState,
  ConnectedAppTestActionState,
} from "@/lib/admin/actions-core"
import type {
  AdminConnectedApp,
  AdminConnectedAppCredential,
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
} from "./applications-v2-experience"

const actionMocks = vi.hoisted(() => ({
  check: vi.fn(),
  create: vi.fn(),
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
  createAdminConnectedAppAction: actionMocks.create,
  disableAdminConnectedAppAction: vi.fn(),
  enableAdminConnectedAppAction: vi.fn(),
  revokeAdminConnectedAppCredentialAction: actionMocks.revoke,
  rotateAdminConnectedAppCredentialsAction: actionMocks.rotate,
  softDeleteAdminConnectedAppAction: vi.fn(),
  updateAdminConnectedAppPolicyAction: vi.fn(),
}))

beforeEach(() => {
  actionMocks.check.mockReset()
  actionMocks.create.mockReset()
  actionMocks.revoke.mockReset()
  actionMocks.rotate.mockReset()
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
    expect(screen.queryByText(/Firecrawl/i)).toBeNull()
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
      screen.getByText(/previous static key remains valid for up to 24 hours/),
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
    expect(document.body.textContent).not.toMatch(/staging|production/i)
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
        accessRole="operator"
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
        accessRole="operator"
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
        accessRole="operator"
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
  auditHref: "/audit?app=app-1",
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

const staticReveal = {
  apiKey: "llmm_secret_once",
  authMethod: "api_key",
  bffBaseUrl: "https://bff.example.test",
  credentialId: "credential-new",
  exampleCurl:
    'curl -H "Authorization: Bearer llmm_secret_once" https://bff.example.test/api/app-gateway/v1/models',
  issuedAt: "2026-07-31T08:00:00.000Z",
  keyPrefix: "llmm_secret_",
  model: model.name,
  openAiBaseUrl: "https://bff.example.test/api/app-gateway/v1",
} satisfies AdminConnectedAppCredential

const secondStaticReveal = {
  ...staticReveal,
  apiKey: "llmm_second_secret_once",
  credentialId: "credential-newer",
  exampleCurl:
    'curl -H "Authorization: Bearer llmm_second_secret_once" https://bff.example.test/api/app-gateway/v1/models',
  issuedAt: "2026-07-31T09:00:00.000Z",
  keyPrefix: "llmm_second_",
} satisfies AdminConnectedAppCredential

const oauthReveal = {
  authMethod: "oauth_client_credentials",
  bffBaseUrl: "https://bff.example.test",
  clientId: "application-client",
  clientSecret: "oauth_secret_once",
  credentialId: "credential-oauth",
  exampleCurl:
    'curl -H "Authorization: Bearer <token>" https://bff.example.test/api/app-gateway/v1/models',
  issuedAt: "2026-07-31T08:00:00.000Z",
  keyPrefix: null,
  model: model.name,
  openAiBaseUrl: "https://bff.example.test/api/app-gateway/v1",
  tokenUrl:
    "https://keycloak.example.test/realms/llm/protocol/openid-connect/token",
} satisfies AdminConnectedAppCredential
