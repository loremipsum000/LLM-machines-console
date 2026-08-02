import { adminTeamCsvMaxBytes } from "@llm-machines/contracts/inference-core"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { Actor } from "../auth/authorization"
import {
  TEAM_CSV_MAX_ROWS,
  bulkAssignAdminTeamGroupMembers,
  commitAdminTeamCsvImport,
  createAdminTeamMember,
  deleteAdminTeamGroup,
  disableAdminTeamMember,
  getAdminTeamMemberDetail,
  previewAdminTeamCsvImport,
  reactivateAdminTeamMember,
  removeAdminTeamGroupMember,
  resetAdminTeamStateForTest,
  sendAdminTeamInvite,
  updateAdminTeamGroup,
} from "./admin-team"
import { emitAudit, resetAuditEventsForTest } from "./audit"
import { resetIdentityMutationJournalForTest } from "./identity-mutation-journal"

describe("Admin Team live authority protection", () => {
  afterEach(() => {
    resetAdminTeamStateForTest()
    resetAuditEventsForTest()
    resetIdentityMutationJournalForTest()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it("returns identity and audit metadata without synthetic member usage", async () => {
    stubKeycloakAdminEnv()
    const activity = await emitAudit({
      action: "team.member.activity",
      keycloakSubjectId: "operator-1",
      outcome: "succeeded",
      sourceSystem: "console",
    })
    const fetchMock = vi.fn<typeof fetch>(async (request) => {
      const url = new URL(request.toString())
      if (url.pathname.endsWith("/protocol/openid-connect/token")) {
        return jsonResponse({ access_token: "unit-test-token", expires_in: 60 })
      }
      if (url.pathname.endsWith("/users/operator-1")) {
        return jsonResponse(keycloakUser("operator-1", true))
      }
      if (url.pathname.endsWith("/users/operator-1/groups")) {
        return jsonResponse([])
      }
      if (url.pathname.endsWith("/role-mappings/realm/composite")) {
        return jsonResponse([{ id: "role-operator", name: "operator" }])
      }
      return new Response(null, { status: 404 })
    })
    vi.stubGlobal("fetch", fetchMock)

    const detail = await getAdminTeamMemberDetail(adminActor, "operator-1")

    expect(Object.keys(detail).sort()).toEqual(["activity", "member"])
    expect(detail.member).toMatchObject({
      id: "operator-1",
      lastActiveAt: activity.createdAt,
      role: "operator",
    })
    expect(detail.activity).toEqual([
      {
        action: activity.action,
        createdAt: activity.createdAt,
        id: activity.id,
        targetId: activity.targetId,
        targetType: activity.targetType,
      },
    ])
  })

  it("counts only enabled live Operators as recovery-ready", async () => {
    stubKeycloakAdminEnv()
    const fetchMock = keycloakFetch({
      users: [
        keycloakUser("operator-1", true),
        keycloakUser("operator-2", false),
      ],
    })
    vi.stubGlobal("fetch", fetchMock)

    await expect(
      disableAdminTeamMember(
        adminActor,
        "operator-1",
        mutationContext("last-operator"),
      ),
    ).rejects.toMatchObject({
      httpStatus: 409,
      message:
        "The last enabled Operator is the appliance's recovery-ready Operator and cannot be disabled or deleted.",
    })
    expect(
      fetchMock.mock.calls.some(([, init]) => init?.method === "PUT"),
    ).toBe(false)
  })

  it("fails closed when a retained role assignment is ambiguous", async () => {
    stubKeycloakAdminEnv()
    const fetchMock = keycloakFetch({
      roles: ["admin", "operator"],
      users: [keycloakUser("operator-1", true)],
    })
    vi.stubGlobal("fetch", fetchMock)

    await expect(
      disableAdminTeamMember(
        adminActor,
        "operator-1",
        mutationContext("ambiguous-role"),
      ),
    ).rejects.toMatchObject({ status: "invalid" })
    expect(
      fetchMock.mock.calls.some(([, init]) => init?.method === "PUT"),
    ).toBe(false)
  })

  it("fails closed when live Operator roles cannot be queried", async () => {
    stubKeycloakAdminEnv()
    const fetchMock = keycloakFetch({
      roleStatus: 503,
      users: [keycloakUser("operator-1", true)],
    })
    vi.stubGlobal("fetch", fetchMock)

    await expect(
      disableAdminTeamMember(
        adminActor,
        "operator-1",
        mutationContext("role-unavailable"),
      ),
    ).rejects.toMatchObject({ status: "unavailable" })
    expect(
      fetchMock.mock.calls.some(([, init]) => init?.method === "PUT"),
    ).toBe(false)
  })

  it("validates exact live authority before reactivating a member", async () => {
    stubKeycloakAdminEnv()
    const fetchMock = vi.fn<typeof fetch>(async (request, init) => {
      const url = new URL(request.toString())
      if (url.pathname.endsWith("/protocol/openid-connect/token")) {
        return jsonResponse({ access_token: "unit-test-token", expires_in: 60 })
      }
      if (url.pathname.endsWith("/users/user-1")) {
        return jsonResponse(keycloakUser("user-1", false))
      }
      if (url.pathname.endsWith("/users/user-1/groups")) {
        return jsonResponse([])
      }
      if (url.pathname.endsWith("/role-mappings/realm/composite")) {
        return jsonResponse([{ id: "role-auditor", name: "auditor" }])
      }
      return new Response(null, { status: init?.method === "PUT" ? 204 : 404 })
    })
    vi.stubGlobal("fetch", fetchMock)

    await expect(
      reactivateAdminTeamMember(
        adminActor,
        "user-1",
        mutationContext("unclassified-reactivate"),
      ),
    ).rejects.toMatchObject({ httpStatus: 409 })
    expect(
      fetchMock.mock.calls.some(([, init]) => init?.method === "PUT"),
    ).toBe(false)
  })

  it.each([
    ["disable", true, disableAdminTeamMember],
    ["reactivate", false, reactivateAdminTeamMember],
  ])(
    "requires the exact enabled-state postcondition after %s",
    async (operation, unchangedEnabled, mutate) => {
      stubKeycloakAdminEnv()
      const fetchMock = vi.fn<typeof fetch>(async (request, init) => {
        const url = new URL(request.toString())
        if (url.pathname.endsWith("/protocol/openid-connect/token")) {
          return jsonResponse({
            access_token: "unit-test-token",
            expires_in: 60,
          })
        }
        if (url.pathname.endsWith("/users") && url.searchParams.has("max")) {
          return jsonResponse([keycloakUser("user-1", unchangedEnabled)])
        }
        if (url.pathname.endsWith("/users/user-1/groups")) {
          return jsonResponse([
            { id: "admins-group", name: "Admins", path: "/Admins" },
          ])
        }
        if (url.pathname.endsWith("/role-mappings/realm/composite")) {
          return jsonResponse([{ id: "role-admin", name: "admin" }])
        }
        if (url.pathname.endsWith("/users/user-1") && init?.method === "PUT") {
          return new Response(null, { status: 204 })
        }
        if (url.pathname.endsWith("/users/user-1")) {
          return jsonResponse(keycloakUser("user-1", unchangedEnabled))
        }
        return new Response(null, { status: 404 })
      })
      vi.stubGlobal("fetch", fetchMock)

      await expect(
        mutate(
          adminActor,
          "user-1",
          mutationContext(`${operation}-postcondition`),
        ),
      ).rejects.toMatchObject({ status: "reconciliation_required" })
      expect(
        fetchMock.mock.calls.some(
          ([request, init]) =>
            new URL(request.toString()).pathname.endsWith("/users/user-1") &&
            init?.method === "PUT",
        ),
      ).toBe(true)
    },
  )

  it("creates a new member disabled until role and group setup completes", async () => {
    stubKeycloakAdminEnv()
    let createBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn<typeof fetch>(async (request, init) => {
      const url = new URL(request.toString())
      if (url.pathname.endsWith("/protocol/openid-connect/token")) {
        return jsonResponse({ access_token: "unit-test-token", expires_in: 60 })
      }
      if (isRealmGroupsCollection(url) && url.searchParams.has("max")) {
        return jsonResponse([
          { id: "group-1", name: "Operators", path: "/Operators" },
        ])
      }
      if (url.pathname.endsWith("/users") && init?.method === "POST") {
        createBody = JSON.parse(String(init.body)) as Record<string, unknown>
        return new Response(null, {
          headers: {
            location:
              "https://keycloak.example/admin/realms/llm-machines/users/user-1",
          },
          status: 201,
        })
      }
      return new Response(null, { status: 404 })
    })
    vi.stubGlobal("fetch", fetchMock)

    await expect(
      createAdminTeamMember(
        adminActor,
        {
          displayName: "Operator One",
          email: "operator.one@example.test",
          enabled: true,
          generatePassword: false,
          groups: ["Operators"],
          role: "operator",
          sendInvite: false,
          username: "operator.one",
        },
        mutationContext("partial-create"),
      ),
    ).rejects.toMatchObject({ status: "reconciliation_required" })
    expect(createBody).toMatchObject({ enabled: false })
    expect(
      fetchMock.mock.calls.some(
        ([request, init]) =>
          new URL(request.toString()).pathname.endsWith("/users/user-1") &&
          init?.method === "PUT",
      ),
    ).toBe(false)
  })

  it.each([
    ["admin" as const, "Admins", "Platform"],
    ["operator" as const, "Operators", "Support"],
  ])(
    "inherits %s authority through its canonical group plus a custom group",
    async (role, canonicalGroup, customGroup) => {
      stubKeycloakAdminEnv()
      let enabled = false
      const joinedGroupIds: string[] = []
      const groups = [
        {
          id: `${canonicalGroup.toLowerCase()}-group`,
          name: canonicalGroup,
          path: `/${canonicalGroup}`,
        },
        {
          id: `${customGroup.toLowerCase()}-group`,
          name: customGroup,
          path: `/${customGroup}`,
        },
      ]
      const fetchMock = vi.fn<typeof fetch>(async (request, init) => {
        const url = new URL(request.toString())
        if (url.pathname.endsWith("/protocol/openid-connect/token")) {
          return jsonResponse({
            access_token: "unit-test-token",
            expires_in: 60,
          })
        }
        if (isRealmGroupsCollection(url) && url.searchParams.has("max")) {
          return jsonResponse(groups)
        }
        if (url.pathname.endsWith("/users") && init?.method === "POST") {
          return new Response(null, {
            headers: {
              location:
                "https://keycloak.example/admin/realms/llm-machines/users/user-1",
            },
            status: 201,
          })
        }
        if (
          url.pathname.includes("/users/user-1/groups/") &&
          init?.method === "PUT"
        ) {
          joinedGroupIds.push(url.pathname.split("/").at(-1) ?? "")
          return new Response(null, { status: 204 })
        }
        if (url.pathname.endsWith("/users/user-1/groups")) {
          return jsonResponse(
            groups.filter((group) => joinedGroupIds.includes(group.id)),
          )
        }
        if (url.pathname.endsWith("/role-mappings/realm/composite")) {
          return jsonResponse([{ id: `role-${role}`, name: role }])
        }
        if (url.pathname.endsWith("/users/user-1") && init?.method === "PUT") {
          enabled = true
          return new Response(null, { status: 204 })
        }
        if (url.pathname.endsWith("/users/user-1")) {
          return jsonResponse(keycloakUser("user-1", enabled))
        }
        return new Response(null, { status: 404 })
      })
      vi.stubGlobal("fetch", fetchMock)

      await expect(
        createAdminTeamMember(
          adminActor,
          {
            displayName: `${canonicalGroup} One`,
            email: `${role}.one@example.test`,
            enabled: true,
            generatePassword: false,
            groups: [customGroup],
            role,
            sendInvite: false,
            username: `${role}.one`,
          },
          mutationContext(`canonical-${role}`),
        ),
      ).resolves.toMatchObject({
        member: {
          enabled: true,
          groups: [canonicalGroup, customGroup],
          role,
        },
      })
      expect(joinedGroupIds).toEqual([
        `${canonicalGroup.toLowerCase()}-group`,
        `${customGroup.toLowerCase()}-group`,
      ])
      expect(
        fetchMock.mock.calls.some(([request, init]) => {
          const pathname = new URL(request.toString()).pathname
          return (
            pathname.includes("/roles/") ||
            (pathname.includes("/role-mappings/") && init?.method !== "GET")
          )
        }),
      ).toBe(false)
    },
  )

  it("requires the requested enabled state after member creation", async () => {
    stubKeycloakAdminEnv()
    const joinedGroupIds = new Set<string>()
    const fetchMock = vi.fn<typeof fetch>(async (request, init) => {
      const url = new URL(request.toString())
      if (url.pathname.endsWith("/protocol/openid-connect/token")) {
        return jsonResponse({ access_token: "unit-test-token", expires_in: 60 })
      }
      if (isRealmGroupsCollection(url) && url.searchParams.has("max")) {
        return jsonResponse([
          { id: "operators-group", name: "Operators", path: "/Operators" },
        ])
      }
      if (url.pathname.endsWith("/users") && init?.method === "POST") {
        return new Response(null, {
          headers: {
            location:
              "https://keycloak.example/admin/realms/llm-machines/users/user-1",
          },
          status: 201,
        })
      }
      if (
        url.pathname.endsWith("/users/user-1/groups/operators-group") &&
        init?.method === "PUT"
      ) {
        joinedGroupIds.add("operators-group")
        return new Response(null, { status: 204 })
      }
      if (url.pathname.endsWith("/users/user-1/groups")) {
        return jsonResponse(
          joinedGroupIds.has("operators-group")
            ? [
                {
                  id: "operators-group",
                  name: "Operators",
                  path: "/Operators",
                },
              ]
            : [],
        )
      }
      if (url.pathname.endsWith("/role-mappings/realm/composite")) {
        return jsonResponse([{ id: "role-operator", name: "operator" }])
      }
      if (url.pathname.endsWith("/users/user-1") && init?.method === "PUT") {
        return new Response(null, { status: 204 })
      }
      if (url.pathname.endsWith("/users/user-1")) {
        return jsonResponse(keycloakUser("user-1", false))
      }
      return new Response(null, { status: 404 })
    })
    vi.stubGlobal("fetch", fetchMock)

    await expect(
      createAdminTeamMember(
        adminActor,
        {
          displayName: "Operator One",
          email: "operator.one@example.test",
          enabled: true,
          generatePassword: false,
          groups: [],
          role: "operator",
          sendInvite: false,
          username: "operator.one",
        },
        mutationContext("enabled-postcondition"),
      ),
    ).rejects.toMatchObject({ status: "reconciliation_required" })
    expect(
      fetchMock.mock.calls.some(
        ([request, init]) =>
          new URL(request.toString()).pathname.endsWith("/users/user-1") &&
          init?.method === "PUT",
      ),
    ).toBe(true)
  })

  it("derives canonical Admin and Operator groups for CSV users with custom groups", async () => {
    stubKeycloakAdminEnv()
    const groups = [
      { id: "admins-group", name: "Admins", path: "/Admins" },
      { id: "operators-group", name: "Operators", path: "/Operators" },
      { id: "platform-group", name: "Platform", path: "/Platform" },
      { id: "support-group", name: "Support", path: "/Support" },
    ]
    const roleByUser = new Map([
      ["user-1", "admin"],
      ["user-2", "operator"],
    ])
    const enabledUsers = new Set<string>()
    const joinedGroups = new Map<string, string[]>()
    let createdUsers = 0
    const fetchMock = vi.fn<typeof fetch>(async (request, init) => {
      const url = new URL(request.toString())
      if (url.pathname.endsWith("/protocol/openid-connect/token")) {
        return jsonResponse({ access_token: "unit-test-token", expires_in: 60 })
      }
      if (isRealmGroupsCollection(url) && url.searchParams.has("max")) {
        return jsonResponse(groups)
      }
      if (
        url.pathname.endsWith("/users") &&
        url.searchParams.has("max") &&
        init?.method === "GET"
      ) {
        return jsonResponse([])
      }
      if (url.pathname.endsWith("/users") && init?.method === "POST") {
        createdUsers += 1
        return new Response(null, {
          headers: {
            location: `https://keycloak.example/admin/realms/llm-machines/users/user-${createdUsers}`,
          },
          status: 201,
        })
      }
      const userMatch = url.pathname.match(/\/users\/(user-[12])(?:\/|$)/)
      const userId = userMatch?.[1]
      if (
        userId &&
        url.pathname.includes("/groups/") &&
        init?.method === "PUT"
      ) {
        const groupId = url.pathname.split("/").at(-1) ?? ""
        joinedGroups.set(userId, [...(joinedGroups.get(userId) ?? []), groupId])
        return new Response(null, { status: 204 })
      }
      if (userId && url.pathname.endsWith(`/${userId}/groups`)) {
        return jsonResponse(
          groups.filter((group) =>
            (joinedGroups.get(userId) ?? []).includes(group.id),
          ),
        )
      }
      if (userId && url.pathname.endsWith("/role-mappings/realm/composite")) {
        const role = roleByUser.get(userId)
        return jsonResponse([{ id: `role-${role}`, name: role }])
      }
      if (
        userId &&
        url.pathname.endsWith(`/${userId}`) &&
        init?.method === "PUT"
      ) {
        enabledUsers.add(userId)
        return new Response(null, { status: 204 })
      }
      if (userId && url.pathname.endsWith(`/${userId}`)) {
        return jsonResponse(keycloakUser(userId, enabledUsers.has(userId)))
      }
      return new Response(null, { status: 404 })
    })
    vi.stubGlobal("fetch", fetchMock)

    await expect(
      commitAdminTeamCsvImport(
        adminActor,
        {
          allowPartial: false,
          csv: [
            "name,username,email,group,role,send_invite,enabled",
            "Admin One,admin.one,admin.one@example.test,Platform,admin,false,true",
            "Operator One,operator.one,operator.one@example.test,Support,operator,false,true",
          ].join("\n"),
        },
        mutationContext("csv-canonical"),
      ),
    ).resolves.toMatchObject({ createdCount: 2, valid: true })
    expect(joinedGroups).toEqual(
      new Map([
        ["user-1", ["admins-group", "platform-group"]],
        ["user-2", ["operators-group", "support-group"]],
      ]),
    )
    expect(
      fetchMock.mock.calls.some(([request, init]) => {
        const pathname = new URL(request.toString()).pathname
        return (
          pathname.includes("/roles/") ||
          (pathname.includes("/role-mappings/") && init?.method !== "GET")
        )
      }),
    ).toBe(false)
  })

  it("keeps a CSV child unresolved when its requested custom group is missing", async () => {
    stubKeycloakAdminEnv()
    const groups = [
      { id: "operators-group", name: "Operators", path: "/Operators" },
      { id: "platform-group", name: "Platform", path: "/Platform" },
    ]
    const fetchMock = vi.fn<typeof fetch>(async (request, init) => {
      const url = new URL(request.toString())
      if (url.pathname.endsWith("/protocol/openid-connect/token")) {
        return jsonResponse({ access_token: "unit-test-token", expires_in: 60 })
      }
      if (isRealmGroupsCollection(url) && url.searchParams.has("max")) {
        return jsonResponse(groups)
      }
      if (
        url.pathname.endsWith("/users") &&
        url.searchParams.has("max") &&
        init?.method === "GET"
      ) {
        return jsonResponse([])
      }
      if (url.pathname.endsWith("/users") && init?.method === "POST") {
        return new Response(null, {
          headers: {
            location:
              "https://keycloak.example/admin/realms/llm-machines/users/user-1",
          },
          status: 201,
        })
      }
      if (
        url.pathname.includes("/users/user-1/groups/") &&
        init?.method === "PUT"
      ) {
        return new Response(null, { status: 204 })
      }
      if (url.pathname.endsWith("/users/user-1/groups")) {
        return jsonResponse([groups[0]])
      }
      if (url.pathname.endsWith("/role-mappings/realm/composite")) {
        return jsonResponse([{ id: "role-operator", name: "operator" }])
      }
      if (url.pathname.endsWith("/users/user-1")) {
        return jsonResponse(keycloakUser("user-1", false))
      }
      return new Response(null, { status: 404 })
    })
    vi.stubGlobal("fetch", fetchMock)

    await expect(
      commitAdminTeamCsvImport(
        adminActor,
        {
          allowPartial: false,
          csv: [
            "name,username,email,group,role,send_invite,enabled",
            "Operator One,operator.one,operator.one@example.test,Platform,operator,false,false",
          ].join("\n"),
        },
        mutationContext("csv-custom-group-postcondition"),
      ),
    ).rejects.toMatchObject({ status: "reconciliation_required" })
  })

  it("rejects oversized CSV and bulk requests before Team service access", async () => {
    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal("fetch", fetchMock)
    const header = "name,username,email,group,role,send_invite,enabled"
    const tooManyRows = [
      header,
      ...Array.from(
        { length: TEAM_CSV_MAX_ROWS + 1 },
        (_, index) =>
          `User ${index},user.${index},user.${index}@example.test,,operator,false,true`,
      ),
    ].join("\n")
    const oversizedUtf8 = `${header}\n${"é".repeat(
      Math.floor(adminTeamCsvMaxBytes / 2) + 1,
    )}`

    await expect(
      previewAdminTeamCsvImport(adminActor, { csv: tooManyRows }),
    ).rejects.toMatchObject({ httpStatus: 400 })
    await expect(
      commitAdminTeamCsvImport(
        adminActor,
        { allowPartial: false, csv: tooManyRows },
        mutationContext("csv-too-many"),
      ),
    ).rejects.toMatchObject({ httpStatus: 400 })
    await expect(
      previewAdminTeamCsvImport(adminActor, { csv: oversizedUtf8 }),
    ).rejects.toMatchObject({ httpStatus: 400 })
    await expect(
      bulkAssignAdminTeamGroupMembers(
        adminActor,
        "platform-group",
        {
          memberIds: Array.from(
            { length: 101 },
            (_, index) => `member-${index}`,
          ),
        },
        mutationContext("bulk-too-many"),
      ),
    ).rejects.toMatchObject({ httpStatus: 400 })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("includes password update and MFA enrollment in a Team invitation", async () => {
    stubKeycloakAdminEnv()
    let emailActions: unknown = null
    const fetchMock = vi.fn<typeof fetch>(async (request, init) => {
      const url = new URL(request.toString())
      if (url.pathname.endsWith("/protocol/openid-connect/token")) {
        return jsonResponse({ access_token: "unit-test-token", expires_in: 60 })
      }
      if (url.pathname.endsWith("/users/user-1")) {
        return jsonResponse(keycloakUser("user-1", true))
      }
      if (url.pathname.endsWith("/users/user-1/groups")) {
        return jsonResponse([])
      }
      if (url.pathname.endsWith("/role-mappings/realm/composite")) {
        return jsonResponse([{ id: "role-operator", name: "operator" }])
      }
      if (url.pathname.endsWith("/execute-actions-email")) {
        emailActions = JSON.parse(String(init?.body)) as unknown
        return new Response(null, { status: 204 })
      }
      return new Response(null, { status: 404 })
    })
    vi.stubGlobal("fetch", fetchMock)

    await expect(
      sendAdminTeamInvite(adminActor, "user-1", mutationContext("invite-mfa")),
    ).resolves.toMatchObject({ status: "sent" })
    expect(emailActions).toEqual(["UPDATE_PASSWORD", "CONFIGURE_TOTP"])
  })

  it("rejects deleting or renaming the reserved Operators group", async () => {
    stubKeycloakAdminEnv()
    const fetchMock = reservedGroupFetch("Operators", [
      keycloakUser("operator-1", true),
    ])
    vi.stubGlobal("fetch", fetchMock)

    await expect(
      deleteAdminTeamGroup(
        adminActor,
        "operators-group",
        mutationContext("delete-operators"),
      ),
    ).rejects.toMatchObject({
      httpStatus: 409,
      message:
        "Operators is a reserved role group and cannot be renamed, deleted, or changed through generic group membership actions.",
    })
    await expect(
      updateAdminTeamGroup(
        adminActor,
        "operators-group",
        { name: "Support" },
        mutationContext("rename-operators"),
      ),
    ).rejects.toMatchObject({ httpStatus: 409 })
    expect(
      fetchMock.mock.calls.some(
        ([request, init]) =>
          new URL(request.toString()).pathname.endsWith("/operators-group") &&
          (init?.method === "DELETE" || init?.method === "PUT"),
      ),
    ).toBe(false)
  })

  it("rejects removing the last enabled Operator through generic group membership", async () => {
    stubKeycloakAdminEnv()
    const fetchMock = reservedGroupFetch("Operators", [
      keycloakUser("operator-1", true),
    ])
    vi.stubGlobal("fetch", fetchMock)

    await expect(
      removeAdminTeamGroupMember(
        adminActor,
        "operators-group",
        "operator-1",
        mutationContext("remove-last-operator"),
      ),
    ).rejects.toMatchObject({ httpStatus: 409 })
    expect(
      fetchMock.mock.calls.some(
        ([request, init]) =>
          new URL(request.toString()).pathname.endsWith(
            "/users/operator-1/groups/operators-group",
          ) && init?.method === "DELETE",
      ),
    ).toBe(false)
  })

  it("finds a removed member beyond the first membership page", async () => {
    stubKeycloakAdminEnv()
    const firstGroupPage = Array.from({ length: 500 }, (_, index) =>
      keycloakUser(`unrelated-${index}`, true),
    )
    const fetchMock = vi.fn<typeof fetch>(async (request, init) => {
      const url = new URL(request.toString())
      if (url.pathname.endsWith("/protocol/openid-connect/token")) {
        return jsonResponse({ access_token: "unit-test-token", expires_in: 60 })
      }
      if (url.pathname.endsWith("/groups/platform-group")) {
        return jsonResponse({
          id: "platform-group",
          name: "Platform",
          path: "/Platform",
        })
      }
      if (url.pathname.endsWith("/groups/platform-group/members")) {
        return jsonResponse(firstGroupPage)
      }
      if (url.pathname.endsWith("/users/user-1/groups")) {
        if (url.searchParams.get("first") === "0") {
          return jsonResponse(
            Array.from({ length: 100 }, (_, index) => ({
              id: `unrelated-group-${index}`,
              name: `Unrelated ${index}`,
              path: `/Unrelated ${index}`,
            })),
          )
        }
        if (url.searchParams.get("first") === "100") {
          return jsonResponse([
            {
              id: "platform-group",
              name: "Platform",
              path: "/Platform",
            },
          ])
        }
        return jsonResponse([])
      }
      if (
        url.pathname.endsWith("/users/user-1/groups/platform-group") &&
        init?.method === "DELETE"
      ) {
        return new Response(null, { status: 204 })
      }
      return new Response(null, { status: 404 })
    })
    vi.stubGlobal("fetch", fetchMock)

    await expect(
      removeAdminTeamGroupMember(
        adminActor,
        "platform-group",
        "user-1",
        mutationContext("remove-member-postcondition"),
      ),
    ).rejects.toMatchObject({ status: "reconciliation_required" })
    expect(
      fetchMock.mock.calls.some(
        ([request, init]) =>
          new URL(request.toString()).pathname.endsWith(
            "/users/user-1/groups/platform-group",
          ) && init?.method === "DELETE",
      ),
    ).toBe(true)
  })

  it("rejects adding an Operator to Admins through generic membership", async () => {
    stubKeycloakAdminEnv()
    const fetchMock = reservedGroupFetch("Admins", [])
    vi.stubGlobal("fetch", fetchMock)

    await expect(
      bulkAssignAdminTeamGroupMembers(
        adminActor,
        "admins-group",
        { memberIds: ["operator-1"] },
        mutationContext("operator-to-admins"),
      ),
    ).rejects.toMatchObject({ httpStatus: 409 })
    expect(
      fetchMock.mock.calls.some(
        ([request, init]) =>
          new URL(request.toString()).pathname.endsWith(
            "/users/operator-1/groups/admins-group",
          ) && init?.method === "PUT",
      ),
    ).toBe(false)
  })

  it("rejects create and CSV inputs whose reserved role group contradicts the role", async () => {
    stubKeycloakAdminEnv()
    const fetchMock = vi.fn<typeof fetch>(async (request) => {
      const url = new URL(request.toString())
      if (url.pathname.endsWith("/protocol/openid-connect/token")) {
        return jsonResponse({ access_token: "unit-test-token", expires_in: 60 })
      }
      if (isRealmGroupsCollection(url)) {
        return jsonResponse([
          { id: "admins-group", name: "Admins", path: "/Admins" },
          { id: "operators-group", name: "Operators", path: "/Operators" },
        ])
      }
      if (url.pathname.endsWith("/users")) {
        return jsonResponse([])
      }
      return new Response(null, { status: 404 })
    })
    vi.stubGlobal("fetch", fetchMock)

    await expect(
      createAdminTeamMember(
        adminActor,
        {
          displayName: "Admin One",
          email: "admin.one@example.test",
          enabled: true,
          generatePassword: false,
          groups: ["Operators"],
          role: "admin",
          sendInvite: false,
          username: "admin.one",
        },
        mutationContext("create-role-mismatch"),
      ),
    ).rejects.toMatchObject({ httpStatus: 400 })

    await expect(
      previewAdminTeamCsvImport(adminActor, {
        csv: [
          "name,username,email,group,role,send_invite,enabled",
          "Admin One,admin.one,admin.one@example.test,Operators,admin,false,true",
        ].join("\n"),
      }),
    ).resolves.toMatchObject({
      rows: [
        {
          errors: [
            "Operators is a reserved Operator role group and cannot be combined with the selected Admin role.",
          ],
          status: "invalid",
        },
      ],
      valid: false,
    })
    expect(
      fetchMock.mock.calls.some(([, init]) => init?.method === "POST"),
    ).toBe(true)
    expect(
      fetchMock.mock.calls.some(
        ([request, init]) =>
          new URL(request.toString()).pathname.endsWith("/users") &&
          init?.method === "POST",
      ),
    ).toBe(false)
  })
})

const adminActor: Actor = {
  authMode: "keycloak",
  role: "admin",
  subject: "admin-1",
}

function stubKeycloakAdminEnv(): void {
  vi.stubEnv("KEYCLOAK_ADMIN_BASE_URL", "https://keycloak.example/keycloak")
  vi.stubEnv("KEYCLOAK_ADMIN_CLIENT_ID", "console-human-admin")
  vi.stubEnv("KEYCLOAK_ADMIN_CLIENT_SECRET", "unit-test-credential")
  vi.stubEnv("KEYCLOAK_ADMIN_REALM", "llm-machines")
}

function keycloakFetch(input: {
  roles?: string[]
  roleStatus?: number
  users: Array<Record<string, unknown>>
}) {
  return vi.fn<typeof fetch>(async (request) => {
    const url = new URL(request.toString())
    if (url.pathname.endsWith("/protocol/openid-connect/token")) {
      return jsonResponse({ access_token: "unit-test-token", expires_in: 60 })
    }
    if (url.pathname.endsWith("/users") && url.searchParams.has("max")) {
      return jsonResponse(input.users)
    }
    if (url.pathname.endsWith("/role-mappings/realm/composite")) {
      if (input.roleStatus) {
        return new Response(null, { status: input.roleStatus })
      }
      return jsonResponse(
        (input.roles ?? ["operator"]).map((role) => ({
          id: `role-${role}`,
          name: role,
        })),
      )
    }
    return new Response(null, { status: 404 })
  })
}

function reservedGroupFetch(
  name: "Admins" | "Operators",
  members: Array<Record<string, unknown>>,
) {
  return vi.fn<typeof fetch>(async (request) => {
    const url = new URL(request.toString())
    if (url.pathname.endsWith("/protocol/openid-connect/token")) {
      return jsonResponse({ access_token: "unit-test-token", expires_in: 60 })
    }
    if (url.pathname.endsWith("/members")) {
      return jsonResponse(members)
    }
    if (url.pathname.endsWith("/groups/operators-group")) {
      return jsonResponse({
        id: "operators-group",
        name,
        path: `/${name}`,
      })
    }
    if (url.pathname.endsWith("/groups/admins-group")) {
      return jsonResponse({ id: "admins-group", name, path: `/${name}` })
    }
    return new Response(null, { status: 404 })
  })
}

function keycloakUser(id: string, enabled: boolean) {
  return {
    email: `${id}@example.test`,
    enabled,
    id,
    username: id,
  }
}

function isRealmGroupsCollection(url: URL): boolean {
  return url.pathname.endsWith("/groups") && !url.pathname.includes("/users/")
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status: 200,
  })
}

function mutationContext(id: string) {
  return {
    finalizeReceipt: vi.fn(async () => undefined),
    idempotencyLedgerId: `00000000-0000-4000-8000-${id.padEnd(12, "0").slice(0, 12)}`,
    operationCode: `test:${id}`,
    requestFingerprint: "a".repeat(64),
  }
}
