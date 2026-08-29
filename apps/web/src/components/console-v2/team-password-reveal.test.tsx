import type {
  AdminTeamMember,
  AdminTeamOverviewResponse,
} from "@llm-machines/contracts/inference-core"
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { TeamV2Experience } from "./team-v2-experience"

const GENERATED_SECRET = "K9v_7Nm!f4Wq2Lx8Zp6R"

const actionMocks = vi.hoisted(() => ({
  createMember: vi.fn(),
  generatePassword: vi.fn(),
}))

vi.mock("@/lib/admin/actions-core", () => ({
  bulkAssignAdminTeamGroupMembersAction: vi.fn(),
  commitAdminTeamCsvImportAction: vi.fn(),
  createAdminTeamGroupAction: vi.fn(),
  createAdminTeamMemberAction: actionMocks.createMember,
  deleteAdminTeamGroupAction: vi.fn(),
  deleteAdminTeamMemberAction: vi.fn(),
  disableAdminTeamMemberAction: vi.fn(),
  generateAdminTeamPasswordAction: actionMocks.generatePassword,
  previewAdminTeamCsvImportAction: vi.fn(),
  reactivateAdminTeamMemberAction: vi.fn(),
  removeAdminTeamGroupMemberAction: vi.fn(),
  sendAdminTeamInviteAction: vi.fn(),
  sendAdminTeamPasswordResetAction: vi.fn(),
  updateAdminTeamGroupAction: vi.fn(),
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
const originalVisibilityState = Object.getOwnPropertyDescriptor(
  document,
  "visibilityState",
)

beforeEach(() => {
  actionMocks.createMember.mockReset()
  actionMocks.generatePassword.mockReset()
  actionMocks.createMember.mockResolvedValue({
    error: null,
    generatedPassword: GENERATED_SECRET,
    memberId: teamMember.id,
    status: "created",
  })
  actionMocks.generatePassword.mockResolvedValue({
    error: null,
    generatedPassword: GENERATED_SECRET,
    memberId: teamMember.id,
    status: "generated",
  })
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
  restoreProperty(
    HTMLDialogElement.prototype,
    "showModal",
    originalDialogShowModal,
  )
  restoreProperty(HTMLDialogElement.prototype, "close", originalDialogClose)
  restoreProperty(document, "visibilityState", originalVisibilityState)
})

describe("Team one-time password reveal", () => {
  it("clears a newly created user's secret and complete mutation state when dismissed", async () => {
    renderNewMember()
    submitNewMember()

    const dialog = await screen.findByRole("dialog", { name: "User created." })
    expect(dialogShowModal).toHaveBeenCalledTimes(1)
    expect(
      (screen.getByLabelText("Generated password") as HTMLInputElement).value,
    ).toBe(GENERATED_SECRET)
    expect(document.body.innerHTML).toContain(GENERATED_SECRET)
    for (const liveRegion of document.querySelectorAll("[aria-live]")) {
      expect(liveRegion.textContent).not.toContain(GENERATED_SECRET)
    }

    fireEvent.click(screen.getByRole("button", { name: "Done" }))

    await assertSecretAndMutationStateCleared()
  })

  it("clears a rotated password when the native dialog is cancelled", async () => {
    render(
      <TeamV2Experience
        accessRole="admin"
        detail={{ activity: [], member: teamMember }}
        overview={teamOverview}
        view="member-detail"
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: "Generate password" }))

    const dialog = await screen.findByRole("dialog", {
      name: "Password generated.",
    })
    expect(
      (screen.getByLabelText("Generated password") as HTMLInputElement).value,
    ).toBe(GENERATED_SECRET)
    fireEvent(dialog, new Event("cancel", { cancelable: true }))

    await assertSecretAndMutationStateCleared()
  })

  it.each([
    ["history navigation", () => window.dispatchEvent(new Event("popstate"))],
    ["reload or navigation", () => window.dispatchEvent(new Event("pagehide"))],
    [
      "back-forward cache restoration",
      () =>
        window.dispatchEvent(
          Object.assign(new Event("pageshow"), { persisted: true }),
        ),
    ],
    [
      "hidden-document transition",
      () => {
        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          value: "hidden",
        })
        document.dispatchEvent(new Event("visibilitychange"))
      },
    ],
  ])(
    "clears the secret and complete action state on %s",
    async (_label, clear) => {
      renderNewMember()
      submitNewMember()
      expect(
        await screen.findByRole("dialog", { name: "User created." }),
      ).toBeTruthy()

      act(() => clear())

      await assertSecretAndMutationStateCleared()
    },
  )

  it.each([
    ["page hide", () => window.dispatchEvent(new Event("pagehide"))],
    ["history navigation", () => window.dispatchEvent(new Event("popstate"))],
    [
      "hidden-document transition",
      () => {
        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          value: "hidden",
        })
        document.dispatchEvent(new Event("visibilitychange"))
      },
    ],
  ])(
    "invalidates a pending secret response on %s",
    async (_label, invalidate) => {
      let resolveAction:
        | ((state: {
            error: null
            generatedPassword: string
            memberId: string
            status: "created"
          }) => void)
        | undefined
      actionMocks.createMember.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveAction = resolve
          }),
      )
      renderNewMember()
      submitNewMember()

      act(() => invalidate())
      await act(async () => {
        resolveAction?.({
          error: null,
          generatedPassword: GENERATED_SECRET,
          memberId: teamMember.id,
          status: "created",
        })
      })

      await assertSecretAndMutationStateCleared()
      expect(screen.queryByRole("dialog", { name: "User created." })).toBeNull()
    },
  )
})

function renderNewMember() {
  render(
    <TeamV2Experience
      accessRole="admin"
      overview={teamOverview}
      view="new-member"
    />,
  )
}

function submitNewMember() {
  fireEvent.change(screen.getByLabelText("Name"), {
    target: { value: "Ada Lovelace" },
  })
  fireEvent.change(screen.getByLabelText("Company email"), {
    target: { value: "ada@example.test" },
  })
  fireEvent.click(screen.getByRole("button", { name: "Create user" }))
}

async function assertSecretAndMutationStateCleared() {
  await waitFor(() => {
    expect(screen.queryByLabelText("Generated password")).toBeNull()
    expect(document.body.innerHTML).not.toContain(GENERATED_SECRET)
    expect(
      screen.queryByRole("link", { name: "Open member detail" }),
    ).toBeNull()
    expect(screen.queryByText("User created.")).toBeNull()
    expect(screen.queryByText("Password generated.")).toBeNull()
  })
}

function restoreProperty(
  target: object,
  property: string,
  descriptor: PropertyDescriptor | undefined,
) {
  if (descriptor) {
    Object.defineProperty(target, property, descriptor)
  } else {
    Reflect.deleteProperty(target, property)
  }
}

const teamMember: AdminTeamMember = {
  createdAt: "2026-07-31T08:00:00.000Z",
  displayName: "Ada Lovelace",
  email: "ada@example.test",
  enabled: true,
  groups: ["Operations"],
  id: "operator-1",
  lastActiveAt: null,
  role: "operator",
  status: "active",
  username: "ada.operations",
}

const teamOverview: AdminTeamOverviewResponse = {
  generatedAt: "2026-07-31T08:00:00.000Z",
  groups: [
    {
      id: "operations",
      memberCount: 1,
      name: "Operations",
      virtual: false,
    },
  ],
  members: [teamMember],
  scim: {
    detail: "Keycloak identity is available.",
    lastSyncAt: null,
    provider: "Keycloak",
    sourceStatus: "ok",
    status: "configured",
  },
  serviceStatus: "ok",
  sourceStatus: "ok",
}
