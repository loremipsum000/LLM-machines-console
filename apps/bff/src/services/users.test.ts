import { afterEach, describe, expect, it, vi } from "vitest"
import type { Actor } from "../auth/persona"
import { getInferenceCoreDb } from "../db/inference-core-client"
import { upsertActorUser } from "./users"

vi.mock("../db/inference-core-client", () => ({
  getInferenceCoreDb: vi.fn(),
}))

const actor: Actor = {
  authMode: "keycloak",
  email: "demo-admin@identity.example.test",
  persona: "admin",
  roles: ["admin"],
  subject: "keycloak-uuid",
}

describe("upsertActorUser", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("uses the existing storage id when the actor email is already present", async () => {
    const db = buildDbMock([{ id: "demo-admin" }])
    vi.mocked(getInferenceCoreDb).mockReturnValue(db.instance)

    const storedActor = await upsertActorUser(actor)

    expect(storedActor).toEqual({
      ...actor,
      subject: "demo-admin",
    })
    expect(db.update).toHaveBeenCalledOnce()
    expect(db.insert).toHaveBeenCalledOnce()
    expect(db.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        displayName: actor.email,
        email: `${actor.subject}@local.invalid`,
        id: actor.subject,
      }),
    )
    expect(db.insertOnConflictDoUpdate).toHaveBeenCalledOnce()
  })

  it("inserts by actor subject when there is no existing email row", async () => {
    const db = buildDbMock([])
    vi.mocked(getInferenceCoreDb).mockReturnValue(db.instance)

    const storedActor = await upsertActorUser(actor)

    expect(storedActor).toBe(actor)
    expect(db.insert).toHaveBeenCalledOnce()
    expect(db.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        email: actor.email,
        id: actor.subject,
      }),
    )
    expect(db.insertOnConflictDoUpdate).toHaveBeenCalledOnce()
  })
})

function buildDbMock(existingUsers: Array<{ id: string }>) {
  const selectLimit = vi.fn(async () => existingUsers)
  const selectWhere = vi.fn(() => ({ limit: selectLimit }))
  const selectFrom = vi.fn(() => ({ where: selectWhere }))
  const select = vi.fn(() => ({ from: selectFrom }))

  const updateWhere = vi.fn(async () => undefined)
  const updateSet = vi.fn(() => ({ where: updateWhere }))
  const update = vi.fn(() => ({ set: updateSet }))

  const insertOnConflictDoUpdate = vi.fn(async () => undefined)
  const insertValues = vi.fn(() => ({
    onConflictDoUpdate: insertOnConflictDoUpdate,
  }))
  const insert = vi.fn(() => ({ values: insertValues }))

  return {
    insert,
    insertOnConflictDoUpdate,
    insertValues,
    instance: {
      insert,
      select,
      update,
    } as unknown as ReturnType<typeof getInferenceCoreDb>,
    update,
  }
}
