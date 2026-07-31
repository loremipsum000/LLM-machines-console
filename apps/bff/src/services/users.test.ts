import { afterEach, describe, expect, it, vi } from "vitest"
import type { Actor } from "../auth/authorization"
import { getInferenceCoreDb } from "../db/inference-core-client"
import {
  humanIdentities,
  humanIdentityRoles,
} from "../db/inference-core-schema"
import { upsertActorUser } from "./users"

vi.mock("../db/inference-core-client", () => ({
  getInferenceCoreDb: vi.fn(),
}))

const actor: Actor = {
  authMode: "keycloak",
  email: "demo-admin@identity.example.test",
  role: "admin",
  subject: "keycloak-uuid",
}

describe("upsertActorUser", () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it("returns the actor unchanged when persistence is not configured", async () => {
    vi.mocked(getInferenceCoreDb).mockReturnValue(null)

    await expect(upsertActorUser(actor)).resolves.toBe(actor)
  })

  it("preserves the Keycloak subject and projects only admin/operator roles", async () => {
    const db = buildDbMock()
    vi.mocked(getInferenceCoreDb).mockReturnValue(db.instance)

    const storedActor = await upsertActorUser(actor)

    expect(storedActor).toBe(actor)
    expect(storedActor.subject).toBe("keycloak-uuid")
    expect(db.transaction).toHaveBeenCalledOnce()
    expect(db.insert).toHaveBeenNthCalledWith(1, humanIdentities)
    expect(db.identityValues).toHaveBeenCalledWith({
      subjectId: actor.subject,
      firstSeenAt: expect.any(Date),
      lastSeenAt: expect.any(Date),
    })
    expect(db.identityOnConflictDoUpdate).toHaveBeenCalledWith({
      target: humanIdentities.subjectId,
      set: {
        lastSeenAt: expect.any(Date),
      },
    })
    expect(Object.keys(db.identityValues.mock.calls[0][0])).toEqual([
      "subjectId",
      "firstSeenAt",
      "lastSeenAt",
    ])
    expect(db.deleteTable).toHaveBeenCalledWith(humanIdentityRoles)
    expect(db.deleteWhere).toHaveBeenCalledOnce()
    expect(db.insert).toHaveBeenNthCalledWith(2, humanIdentityRoles)
    expect(db.roleValues).toHaveBeenCalledWith([
      {
        subjectId: actor.subject,
        role: "admin",
        observedAt: expect.any(Date),
      },
    ])
  })

  it("projects the current resolved role", async () => {
    const db = buildDbMock()
    vi.mocked(getInferenceCoreDb).mockReturnValue(db.instance)

    const currentOperator: Actor = {
      ...actor,
      role: "operator",
    }

    await expect(upsertActorUser(currentOperator)).resolves.toBe(currentOperator)
    expect(db.deleteWhere).toHaveBeenCalledOnce()
    expect(db.roleValues).toHaveBeenCalledWith([
      {
        subjectId: actor.subject,
        role: "operator",
        observedAt: expect.any(Date),
      },
    ])
    expect(db.insert).toHaveBeenCalledTimes(2)
  })
})

function buildDbMock() {
  const identityOnConflictDoUpdate = vi.fn(async () => undefined)
  const identityValues = vi.fn(
    (_values: {
      subjectId: string
      firstSeenAt: Date
      lastSeenAt: Date
    }) => ({
      onConflictDoUpdate: identityOnConflictDoUpdate,
    }),
  )
  const roleValues = vi.fn(
    async (
      _values: Array<{
        subjectId: string
        role: string
        observedAt: Date
      }>,
    ) => undefined,
  )
  const insert = vi.fn((table) => {
    if (table === humanIdentities) {
      return { values: identityValues }
    }
    return { values: roleValues }
  })

  const deleteWhere = vi.fn(async () => undefined)
  const deleteTable = vi.fn(() => ({ where: deleteWhere }))
  const transactionClient = {
    delete: deleteTable,
    insert,
  }
  const transaction = vi.fn(
    async (callback: (client: typeof transactionClient) => Promise<unknown>) =>
      callback(transactionClient),
  )

  return {
    deleteTable,
    deleteWhere,
    identityOnConflictDoUpdate,
    identityValues,
    insert,
    instance: {
      transaction,
    } as unknown as ReturnType<typeof getInferenceCoreDb>,
    roleValues,
    transaction,
  }
}
