import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import * as adminActions from "./actions"
import {
  addKnowledgeUrlSourceAction,
  addKnowledgeUploadSourceAction,
  applyAdminInferenceModelUpdateAction,
  bulkKnowledgeArchiveSourceAction,
  bulkKnowledgeSourceAction,
  bulkAssignAdminTeamGroupMembersAction,
  commitAdminTeamCsvImportAction,
  createAdminTeamMemberAction,
  createAdminTeamGroupAction,
  createAdminConnectedAppAction,
  createKnowledgeCorpusAction,
  deleteAdminTeamGroupAction,
  deleteAdminTeamMemberAction,
  createAdminSettingsUrlPolicyRuleAction,
  deleteAdminSettingsUrlPolicyRuleAction,
  disableAdminConnectedAppAction,
  disableKnowledgeCorpusAction,
  disableAdminSettingsUrlPolicyRuleAction,
  generateAdminTeamPasswordAction,
  hardDeleteKnowledgeCorpusAction,
  ingestKnowledgeCorpusAction,
  publishKnowledgeSnapshotAction,
  previewAdminTeamCsvImportAction,
  promoteAdminConnectedAppProductionAction,
  removeAdminTeamGroupMemberAction,
  rotateAdminConnectedAppCredentialsAction,
  saveAdminMcpServerAction,
  testAdminConnectedAppConnectionAction,
  testAdminMcpServerConnectionAction,
  updateAdminSettingsOrganizationAction,
  updateAdminSettingsTelemetryAction,
  updateAdminSettingsUrlPolicyRuleAction,
  updateAdminMcpServerAction,
  updateAdminTeamBreakGlassAction,
  updateAdminTeamGroupAction,
  updateKnowledgeCorpusAccessAction,
} from "./actions"
import { adminConnectedApps, adminSettings } from "@/lib/admin/mock-data"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  getBffRequest: vi.fn(),
  redirect: vi.fn((href: string) => {
    throw new Error(`redirect:${href}`)
  }),
  revalidatePath: vi.fn(),
}))

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}))

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}))

vi.mock("@/lib/auth/auth", () => ({
  auth: mocks.auth,
}))

vi.mock("@/lib/bff/server-request", () => ({
  getBffRequest: mocks.getBffRequest,
}))

const corpusId = "33333333-3333-4333-8333-333333333333"
const createdAt = "2026-05-27T00:00:00.000Z"

describe("admin knowledge upload actions", () => {
  beforeEach(() => {
    mocks.auth.mockResolvedValue({
      user: {
        email: "admin@example.test",
        groups: ["Admins"],
        id: "admin",
        roles: ["admin"],
      },
    })
    mocks.getBffRequest.mockResolvedValue({
      baseUrl: "http://bff.test",
      headers: new Headers({ authorization: "Bearer admin" }),
    })
    mocks.redirect.mockClear()
    mocks.revalidatePath.mockClear()
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify(knowledgeActionResponse()), {
            headers: { "Content-Type": "application/json" },
            status: 200,
          }),
      ) as unknown as typeof fetch,
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("posts one BFF upload request per valid selected document including markdown", async () => {
    const formData = new FormData()
    formData.set("corpusId", corpusId)
    formData.append(
      "files",
      uploadFile("policy.pdf", "policy", "application/pdf"),
    )
    formData.append(
      "files",
      uploadFile("runbook.md", "# Runbook", "text/markdown"),
    )
    formData.append(
      "files",
      uploadFile("table.csv", "ime,vrijednost", "text/csv"),
    )
    formData.append("files", uploadFile("one.txt", "one", "text/plain"))
    formData.append("files", uploadFile("two.html", "<p>two</p>", "text/html"))

    await expect(addKnowledgeUploadSourceAction(formData)).rejects.toThrow(
      `redirect:/knowledge?corpus=${corpusId}&knowledgeAction=sourcesAdded&knowledgeUpload=uploaded-5-failed-0`,
    )

    expect(fetch).toHaveBeenCalledTimes(5)
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      `http://bff.test/api/admin/knowledge/corpora/${corpusId}/sources/upload`,
      expect.objectContaining({
        method: "POST",
      }),
    )
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      `http://bff.test/api/admin/knowledge/corpora/${corpusId}/sources/upload`,
      expect.objectContaining({
        method: "POST",
      }),
    )
    expect(
      JSON.parse(String(vi.mocked(fetch).mock.calls[1]?.[1]?.body)),
    ).toMatchObject({
      fileName: "runbook.md",
      mimeType: "text/markdown",
    })
  })

  it("rejects invalid document selections before calling the BFF", async () => {
    const formData = new FormData()
    formData.set("corpusId", corpusId)
    formData.append(
      "files",
      uploadFile("malware.exe", "not allowed", "application/octet-stream"),
    )

    await expect(addKnowledgeUploadSourceAction(formData)).rejects.toThrow(
      `redirect:/knowledge?corpus=${corpusId}&knowledgeAction=failed&knowledgeUpload=uploaded-0-failed-1`,
    )
    expect(fetch).not.toHaveBeenCalled()
  })

  it("rejects more than five documents before calling the BFF", async () => {
    const formData = new FormData()
    formData.set("corpusId", corpusId)
    formData.set("returnTo", `/knowledge?corpus=${corpusId}&view=add-sources`)
    for (const fileName of [
      "one.txt",
      "two.txt",
      "three.txt",
      "four.txt",
      "five.txt",
      "six.txt",
    ]) {
      formData.append("files", uploadFile(fileName, "content", "text/plain"))
    }

    await expect(addKnowledgeUploadSourceAction(formData)).rejects.toThrow(
      `redirect:/knowledge?corpus=${corpusId}&view=add-sources&knowledgeAction=failed&knowledgeUpload=uploaded-0-failed-6`,
    )
    expect(fetch).not.toHaveBeenCalled()
  })

  it("redirects V2 create corpus actions to the created corpus", async () => {
    const formData = new FormData()
    formData.set("returnTo", "/knowledge?view=new")
    formData.set("name", "Benefits Corpus")
    formData.set("description", "Benefits documents.")
    formData.set("accessGroups", "Security")

    await expect(createKnowledgeCorpusAction(formData)).rejects.toThrow(
      `redirect:/knowledge?corpus=${corpusId}&knowledgeAction=created`,
    )
    expect(fetch).toHaveBeenLastCalledWith(
      "http://bff.test/api/admin/knowledge/corpora",
      expect.objectContaining({
        body: JSON.stringify({
          accessGroups: ["Security"],
          description: "Benefits documents.",
          languageHints: [],
          name: "Benefits Corpus",
        }),
        method: "POST",
      }),
    )
  })

  it("maps virtual Everyone access to unrestricted corpus access when creating corpora", async () => {
    const formData = new FormData()
    formData.set("returnTo", "/knowledge?view=new")
    formData.set("name", "Open Corpus")
    formData.set("description", "Open to all authenticated users.")
    formData.set("accessGroups", "Everyone")

    await expect(createKnowledgeCorpusAction(formData)).rejects.toThrow(
      `redirect:/knowledge?corpus=${corpusId}&knowledgeAction=created`,
    )
    expect(fetch).toHaveBeenLastCalledWith(
      "http://bff.test/api/admin/knowledge/corpora",
      expect.objectContaining({
        body: JSON.stringify({
          accessGroups: [],
          description: "Open to all authenticated users.",
          languageHints: [],
          name: "Open Corpus",
        }),
        method: "POST",
      }),
    )
  })

  it("redirects cutover create corpus actions to the created corpus overview", async () => {
    const formData = new FormData()
    formData.set("returnTo", "/knowledge?view=new")
    formData.set("name", "Benefits Corpus")

    await expect(createKnowledgeCorpusAction(formData)).rejects.toThrow(
      `redirect:/knowledge?corpus=${corpusId}&knowledgeAction=created`,
    )
  })

  it("fails create corpus actions when the BFF is not configured", async () => {
    mocks.getBffRequest.mockResolvedValue(null)
    vi.stubEnv("CONSOLE_WEB_FIXTURE_MODE", "true")
    vi.stubEnv("CONSOLE_BFF_URL", "")
    vi.stubEnv("CONSOLE_BFF_SERVICE_API_KEY", "")

    const formData = new FormData()
    formData.set("returnTo", "/knowledge?view=new")
    formData.set("name", "Fixture Corpus")
    formData.set("description", "Created without a configured BFF.")
    formData.set("accessGroups", "Security")

    await expect(createKnowledgeCorpusAction(formData)).rejects.toThrow(
      "redirect:/knowledge?view=new&knowledgeAction=failed",
    )
    expect(fetch).not.toHaveBeenCalled()
  })

  it("creates Team members through the BFF and returns the one-time generated password in action state", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(teamMemberMutationResponse()), {
        headers: { "Content-Type": "application/json" },
        status: 201,
      }),
    )
    const formData = new FormData()
    formData.set("displayName", "Ada Lovelace")
    formData.set("email", "ada@example.test")
    formData.set("role", "builder")
    formData.set("groups", "Engineering")
    formData.set("generatePassword", "on")

    await expect(
      createAdminTeamMemberAction(teamActionIdleState(), formData),
    ).resolves.toMatchObject({
      generatedPassword: "Llm-generated-password-26",
      memberId: "kc-user-1",
      status: "created",
    })
    expect(fetch).toHaveBeenLastCalledWith(
      "http://bff.test/api/admin/team/members",
      expect.objectContaining({
        body: JSON.stringify({
          displayName: "Ada Lovelace",
          email: "ada@example.test",
          enabled: true,
          generatePassword: true,
          groups: ["Engineering"],
          role: "builder",
          sendInvite: false,
          username: "ada.lovelace.engineering",
        }),
        method: "POST",
      }),
    )
    expect(mocks.redirect).not.toHaveBeenCalled()
  })

  it("requires a real Team group before creating a Team member", async () => {
    const formData = new FormData()
    formData.set("displayName", "Ada Lovelace")
    formData.set("email", "ada@example.test")
    formData.set("role", "builder")

    await expect(
      createAdminTeamMemberAction(teamActionIdleState(), formData),
    ).resolves.toMatchObject({
      error: "Select a Team group before creating the user.",
      status: "failed",
    })
    expect(fetch).not.toHaveBeenCalled()
  })

  it("generates Team member passwords without redirecting the one-time password through the URL", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(teamMemberMutationResponse()), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      }),
    )
    const formData = new FormData()
    formData.set("memberId", "kc-user-1")

    await expect(
      generateAdminTeamPasswordAction(teamActionIdleState(), formData),
    ).resolves.toMatchObject({
      generatedPassword: "Llm-generated-password-26",
      memberId: "kc-user-1",
      status: "generated",
    })
    expect(fetch).toHaveBeenLastCalledWith(
      "http://bff.test/api/admin/team/members/kc-user-1/generate-password",
      expect.objectContaining({ method: "POST" }),
    )
    expect(mocks.redirect).not.toHaveBeenCalled()
  })

  it("requires explicit DELETE confirmation before deleting a Team member", async () => {
    const formData = new FormData()
    formData.set("memberId", "kc-user-1")
    formData.set("returnTo", "/team/members/kc-user-1")
    formData.set("confirmation", "delete")

    await expect(deleteAdminTeamMemberAction(formData)).rejects.toThrow(
      "redirect:/team/members/kc-user-1?teamAction=deleteConfirmation",
    )
    expect(fetch).not.toHaveBeenCalled()
  })

  it("passes explicit DELETE confirmation to the Team member delete BFF route", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          member: null,
          status: "deleted",
        }),
        {
          headers: { "Content-Type": "application/json" },
          status: 200,
        },
      ),
    )
    const formData = new FormData()
    formData.set("memberId", "kc-user-1")
    formData.set("returnTo", "/team/members/kc-user-1")
    formData.set("confirmation", "DELETE")

    await expect(deleteAdminTeamMemberAction(formData)).rejects.toThrow(
      "redirect:/team?teamAction=deleted",
    )
    expect(fetch).toHaveBeenCalledWith(
      "http://bff.test/api/admin/team/members/kc-user-1/delete",
      expect.objectContaining({
        body: JSON.stringify({ confirmation: "DELETE" }),
        method: "POST",
      }),
    )
  })

  it("updates the break-glass Admin through the BFF", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(teamBreakGlassResponse()), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      }),
    )
    const formData = new FormData()
    formData.set("selectedAdminId", "kc-admin-1")
    formData.set("returnTo", "/team")

    await expect(updateAdminTeamBreakGlassAction(formData)).rejects.toThrow(
      "redirect:/team?teamAction=breakGlassUpdated",
    )
    expect(fetch).toHaveBeenLastCalledWith(
      "http://bff.test/api/admin/team/break-glass",
      expect.objectContaining({
        body: JSON.stringify({ selectedAdminId: "kc-admin-1" }),
        method: "POST",
      }),
    )
  })

  it("applies governed model updates through the BFF and preserves the Inference range", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          detail: "Model update completed.",
          generatedAt: "2026-05-30T12:00:00.000Z",
          modelUpdate: null,
          status: "completed",
        }),
        {
          headers: { "Content-Type": "application/json" },
          status: 200,
        },
      ),
    )
    const formData = new FormData()
    formData.set("returnTo", "/inference/update?range=90d")
    formData.set("confirmation", "UPDATE MODEL")

    await expect(
      applyAdminInferenceModelUpdateAction(formData),
    ).rejects.toThrow(
      "redirect:/inference/update?range=90d&inferenceAction=completed",
    )
    expect(fetch).toHaveBeenLastCalledWith(
      "http://bff.test/api/admin/inference/model-updates/apply",
      expect.objectContaining({
        body: JSON.stringify({ confirmation: "UPDATE MODEL" }),
        method: "POST",
      }),
    )
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/inference")
  })

  it("creates, updates, bulk assigns, and removes Team group members through the BFF", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify(teamGroupMutationResponse("created")), {
          headers: { "Content-Type": "application/json" },
          status: 201,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(teamGroupMutationResponse("updated")), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(teamGroupMutationResponse("assigned")), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(teamGroupMutationResponse("removed")), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        }),
      )

    const createForm = new FormData()
    createForm.set("name", "Engineering")
    await expect(createAdminTeamGroupAction(createForm)).rejects.toThrow(
      "redirect:/team/groups/group-engineering?teamAction=groupCreated",
    )

    const updateForm = new FormData()
    updateForm.set("groupId", "group-engineering")
    updateForm.set("returnTo", "/team/groups/group-engineering")
    updateForm.set("name", "Operations")
    await expect(updateAdminTeamGroupAction(updateForm)).rejects.toThrow(
      "redirect:/team/groups/group-engineering?teamAction=groupUpdated",
    )

    const assignForm = new FormData()
    assignForm.set("groupId", "group-engineering")
    assignForm.set("returnTo", "/team/groups/group-engineering")
    assignForm.append("memberIds", "kc-user-1")
    assignForm.append("memberIds", "kc-user-2")
    await expect(
      bulkAssignAdminTeamGroupMembersAction(assignForm),
    ).rejects.toThrow(
      "redirect:/team/groups/group-engineering?teamAction=groupMembersAssigned",
    )

    const removeForm = new FormData()
    removeForm.set("groupId", "group-engineering")
    removeForm.set("memberId", "kc-user-1")
    removeForm.set("returnTo", "/team/groups/group-engineering")
    await expect(removeAdminTeamGroupMemberAction(removeForm)).rejects.toThrow(
      "redirect:/team/groups/group-engineering?teamAction=groupMemberRemoved",
    )

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "http://bff.test/api/admin/team/groups",
      expect.objectContaining({
        body: JSON.stringify({ name: "Engineering" }),
        method: "POST",
      }),
    )
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "http://bff.test/api/admin/team/groups/group-engineering/update",
      expect.objectContaining({
        body: JSON.stringify({ name: "Operations" }),
        method: "POST",
      }),
    )
    expect(fetch).toHaveBeenNthCalledWith(
      3,
      "http://bff.test/api/admin/team/groups/group-engineering/members/bulk-assign",
      expect.objectContaining({
        body: JSON.stringify({ memberIds: ["kc-user-1", "kc-user-2"] }),
        method: "POST",
      }),
    )
    expect(fetch).toHaveBeenNthCalledWith(
      4,
      "http://bff.test/api/admin/team/groups/group-engineering/members/kc-user-1/remove",
      expect.objectContaining({
        method: "POST",
      }),
    )
  })

  it("requires explicit DELETE confirmation before deleting a Team group", async () => {
    const formData = new FormData()
    formData.set("groupId", "group-engineering")
    formData.set("returnTo", "/team/groups/group-engineering")
    formData.set("confirmation", "delete")

    await expect(deleteAdminTeamGroupAction(formData)).rejects.toThrow(
      "redirect:/team/groups/group-engineering?teamAction=groupDeleteConfirmation",
    )
    expect(fetch).not.toHaveBeenCalled()
  })

  it("previews and commits Team CSV imports through the BFF", async () => {
    const csv = [
      "name,username,email,group,role,send_invite,enabled",
      "Bo Builder,bo,bo@example.com,Engineering,builder,true,true",
    ].join("\n")
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify(teamCsvImportPreviewResponse()), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(teamCsvImportCommitResponse()), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        }),
      )

    const previewForm = new FormData()
    previewForm.set(
      "csvFile",
      new File([csv], "users.csv", { type: "text/csv" }),
    )
    previewForm.set("csv", csv)
    const previewState = await previewAdminTeamCsvImportAction(
      emptyCsvImportState(),
      previewForm,
    )
    const commitForm = new FormData()
    commitForm.set("csv", previewState.csv)
    const commitState = await commitAdminTeamCsvImportAction(
      emptyCsvImportState(),
      commitForm,
    )

    expect(previewState).toMatchObject({
      csv,
      status: "previewed",
      preview: expect.objectContaining({ valid: true }),
    })
    expect(commitState).toMatchObject({
      status: "committed",
      commit: expect.objectContaining({ createdCount: 1 }),
    })
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "http://bff.test/api/admin/team/import/preview",
      expect.objectContaining({
        body: JSON.stringify({ csv }),
        method: "POST",
      }),
    )
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "http://bff.test/api/admin/team/import/commit",
      expect.objectContaining({
        body: JSON.stringify({ allowPartial: false, csv }),
        method: "POST",
      }),
    )
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/team")
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/team/groups")
  })

  it("redirects V2 URL source actions back to Add sources", async () => {
    const formData = new FormData()
    formData.set("corpusId", corpusId)
    formData.set("returnTo", `/knowledge?corpus=${corpusId}&view=add-sources`)
    formData.set("url", "https://docs.example.test/hr-policy")

    await expect(addKnowledgeUrlSourceAction(formData)).rejects.toThrow(
      `redirect:/knowledge?corpus=${corpusId}&view=add-sources&knowledgeAction=sourceAdded`,
    )
    expect(fetch).toHaveBeenLastCalledWith(
      `http://bff.test/api/admin/knowledge/corpora/${corpusId}/sources/url`,
      expect.objectContaining({
        body: JSON.stringify({
          acquisitionMode: "single_page",
          scraper: "safe_fetch",
          url: "https://docs.example.test/hr-policy",
        }),
        method: "POST",
      }),
    )
  })

  it("posts Admin-created MCP servers to the BFF and redirects to Applications", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify(connectorRegistryItemResponse()), {
            headers: { "Content-Type": "application/json" },
            status: 200,
          }),
      ) as unknown as typeof fetch,
    )
    const formData = new FormData()
    formData.set("returnTo", "/applications/add-server")
    formData.set("name", "Docs MCP")
    formData.set("description", "Documentation MCP server.")
    formData.set("chatCommand", "@docs-mcp")
    formData.set("transport", "url")
    formData.set("endpointUrl", "https://mcp.example.test/rpc")
    formData.set("authMode", "none")
    formData.set("accessGroups", "Everyone")
    formData.set("accessLevel", "read_only")

    await expect(saveAdminMcpServerAction(formData)).rejects.toThrow(
      "redirect:/applications?mcpAction=saved",
    )
    expect(fetch).toHaveBeenLastCalledWith(
      "http://bff.test/api/admin/mcp-servers",
      expect.objectContaining({
        body: JSON.stringify({
          accessGroups: [],
          accessLevel: "read_only",
          authMode: "none",
          chatCommand: "@docs-mcp",
          description: "Documentation MCP server.",
          endpointUrl: "https://mcp.example.test/rpc",
          name: "Docs MCP",
          saveMode: "enabled",
          transport: "url",
        }),
        method: "POST",
      }),
    )
  })

  it("redirects duplicate Admin-created MCP server responses with a dedicated status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ title: "Duplicate MCP server" }), {
            headers: { "Content-Type": "application/json" },
            status: 409,
          }),
      ) as unknown as typeof fetch,
    )
    const formData = new FormData()
    formData.set("returnTo", "/applications/add-server")
    formData.set("name", "Docs MCP")
    formData.set("description", "Documentation MCP server.")
    formData.set("chatCommand", "@docs-mcp")
    formData.set("transport", "url")
    formData.set("endpointUrl", "https://mcp.example.test/rpc")
    formData.set("authMode", "none")
    formData.set("accessLevel", "read_only")

    await expect(saveAdminMcpServerAction(formData)).rejects.toThrow(
      "redirect:/applications/add-server?mcpAction=duplicate",
    )
  })

  it("tests Admin-created MCP server connections through the BFF", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              detail: "MCP endpoint responded with 1 tool(s).",
              discoveredTools: ["search_docs"],
              status: "passed",
            }),
            {
              headers: { "Content-Type": "application/json" },
              status: 200,
            },
          ),
      ) as unknown as typeof fetch,
    )
    const formData = new FormData()
    formData.set("returnTo", "/applications/add-server")
    formData.set("name", "Docs MCP")
    formData.set("description", "Documentation MCP server.")
    formData.set("chatCommand", "@docs-mcp")
    formData.set("transport", "url")
    formData.set("endpointUrl", "https://mcp.example.test/rpc")
    formData.set("authMode", "none")
    formData.set("accessLevel", "read_only")

    await expect(testAdminMcpServerConnectionAction(formData)).rejects.toThrow(
      "redirect:/applications/add-server?mcpAction=tested",
    )
    expect(fetch).toHaveBeenLastCalledWith(
      "http://bff.test/api/admin/mcp-servers/test-connection",
      expect.objectContaining({
        method: "POST",
      }),
    )
  })

  it("updates Admin-created MCP server settings through the BFF", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify(connectorRegistryItemResponse()), {
            headers: { "Content-Type": "application/json" },
            status: 200,
          }),
      ) as unknown as typeof fetch,
    )
    const formData = new FormData()
    formData.set("connectorId", "docs-mcp")
    formData.set("returnTo", "/applications/mcp/docs-mcp/settings")
    formData.set("name", "Docs MCP Updated")
    formData.set("description", "Updated documentation MCP server.")
    formData.set("transport", "url")
    formData.set("endpointUrl", "https://mcp.example.test/updated-rpc")
    formData.set("authMode", "none")
    formData.set("accessGroups", "Finance")
    formData.set("accessLevel", "read_write")
    formData.set("status", "disabled")

    await expect(updateAdminMcpServerAction(formData)).rejects.toThrow(
      "redirect:/applications/mcp/docs-mcp/settings?mcpAction=updated",
    )
    expect(fetch).toHaveBeenLastCalledWith(
      "http://bff.test/api/admin/mcp-servers/docs-mcp/update",
      expect.objectContaining({
        body: JSON.stringify({
          accessGroups: ["Finance"],
          accessLevel: "read_write",
          authMode: "none",
          description: "Updated documentation MCP server.",
          endpointUrl: "https://mcp.example.test/updated-rpc",
          name: "Docs MCP Updated",
          status: "disabled",
          transport: "url",
        }),
        method: "POST",
      }),
    )
  })

  it("creates a staging connected app and returns one-time credentials in action state", async () => {
    const credential = {
      apiKey: "fixture",
      authMethod: "api_key",
      bffBaseUrl: "https://console.example.test",
      environment: "staging",
      exampleCurl:
        'curl -H "Authorization: Bearer fixture" https://console.example.test/api/app-gateway/v1/models',
      keyPrefix: "llmm_t4_claims",
      model: "qwen3:32b",
      openAiBaseUrl: "https://console.example.test/api/app-gateway/v1",
    }
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              app: adminConnectedApps.apps[0],
              credential,
              status: "created",
            }),
            {
              headers: { "Content-Type": "application/json" },
              status: 201,
            },
          ),
      ) as unknown as typeof fetch,
    )
    const formData = new FormData()
    formData.set("name", "Claims Portal")
    formData.set("description", "Claims intake workflow.")
    formData.set("ownerGroup", "Everyone")
    formData.append("allowedModels", "qwen3:32b")
    formData.append("allowedModels", "gemma3:27b")

    const state = await createAdminConnectedAppAction(
      {
        app: null,
        credential: null,
        error: null,
        status: "idle",
      },
      formData,
    )

    expect(state).toMatchObject({
      app: expect.objectContaining({ id: adminConnectedApps.apps[0].id }),
      credential: expect.objectContaining({
        apiKey: "fixture",
        authMethod: "api_key",
      }),
      status: "created",
    })
    expect(fetch).toHaveBeenLastCalledWith(
      "http://bff.test/api/admin/applications/connected-apps",
      expect.objectContaining({
        body: JSON.stringify({
          allowedModels: ["qwen3:32b", "gemma3:27b"],
          authMethod: "api_key",
          description: "Claims intake workflow.",
          name: "Claims Portal",
          ownerGroup: "Everyone",
          rateLimitRpm: null,
          tokenBudget7d: null,
        }),
        method: "POST",
      }),
    )
  })

  it("tests connected app staging credentials through the BFF", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              app: {
                ...adminConnectedApps.apps[0],
                environments: [
                  {
                    ...adminConnectedApps.apps[0].environments[0],
                    productionReady: true,
                    testStatus: "passed",
                  },
                ],
              },
              detail: "Staging credentials can reach the BFF app gateway.",
              environment: "staging",
              status: "passed",
              testedAt: "2026-05-31T10:10:00.000Z",
            }),
            {
              headers: { "Content-Type": "application/json" },
              status: 200,
            },
          ),
      ) as unknown as typeof fetch,
    )
    const formData = new FormData()
    formData.set("appId", adminConnectedApps.apps[0].id)

    const state = await testAdminConnectedAppConnectionAction(
      {
        app: null,
        detail: null,
        error: null,
        status: "idle",
        testedAt: null,
      },
      formData,
    )

    expect(state).toMatchObject({
      detail: "Staging credentials can reach the BFF app gateway.",
      status: "passed",
      testedAt: "2026-05-31T10:10:00.000Z",
    })
    expect(fetch).toHaveBeenLastCalledWith(
      `http://bff.test/api/admin/applications/connected-apps/${adminConnectedApps.apps[0].id}/test`,
      expect.objectContaining({
        body: undefined,
        method: "POST",
      }),
    )
  })

  it("promotes connected app production credentials through the BFF", async () => {
    const credential = {
      apiKey: "fixture",
      authMethod: "api_key",
      bffBaseUrl: "https://console.example.test",
      environment: "production",
      exampleCurl:
        'curl -H "Authorization: Bearer fixture" https://console.example.test/api/app-gateway/v1/models',
      keyPrefix: "llmm_t4_claims",
      model: "qwen3:32b",
      openAiBaseUrl: "https://console.example.test/api/app-gateway/v1",
    }
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              app: adminConnectedApps.apps[1],
              credential,
              detail: "Production credentials created.",
              status: "promoted",
            }),
            {
              headers: { "Content-Type": "application/json" },
              status: 200,
            },
          ),
      ) as unknown as typeof fetch,
    )
    const formData = new FormData()
    formData.set("appId", adminConnectedApps.apps[1].id)

    const state = await promoteAdminConnectedAppProductionAction(
      {
        app: null,
        credential: null,
        detail: null,
        error: null,
        status: "idle",
      },
      formData,
    )

    expect(state).toMatchObject({
      credential: expect.objectContaining({
        apiKey: "fixture",
        authMethod: "api_key",
        environment: "production",
      }),
      status: "promoted",
    })
    expect(fetch).toHaveBeenLastCalledWith(
      `http://bff.test/api/admin/applications/connected-apps/${adminConnectedApps.apps[1].id}/promote-production`,
      expect.objectContaining({
        body: undefined,
        method: "POST",
      }),
    )
  })

  it("rotates connected app credentials through the BFF", async () => {
    const credential = {
      apiKey: "fixture",
      authMethod: "api_key",
      bffBaseUrl: "https://console.example.test",
      environment: "staging",
      exampleCurl:
        'curl -H "Authorization: Bearer fixture" https://console.example.test/api/app-gateway/v1/models',
      keyPrefix: "llmm_t4_claims",
      model: "qwen3:32b",
      openAiBaseUrl: "https://console.example.test/api/app-gateway/v1",
    }
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              app: adminConnectedApps.apps[0],
              credential,
              detail: "Staging credentials rotated.",
              status: "rotated",
            }),
            {
              headers: { "Content-Type": "application/json" },
              status: 200,
            },
          ),
      ) as unknown as typeof fetch,
    )
    const formData = new FormData()
    formData.set("appId", adminConnectedApps.apps[0].id)

    const state = await rotateAdminConnectedAppCredentialsAction(
      {
        app: null,
        credential: null,
        detail: null,
        error: null,
        status: "idle",
      },
      formData,
    )

    expect(state).toMatchObject({
      credential: expect.objectContaining({
        apiKey: "fixture",
        authMethod: "api_key",
        environment: "staging",
      }),
      status: "rotated",
    })
    expect(fetch).toHaveBeenLastCalledWith(
      `http://bff.test/api/admin/applications/connected-apps/${adminConnectedApps.apps[0].id}/rotate-credentials`,
      expect.objectContaining({
        body: undefined,
        method: "POST",
      }),
    )
  })

  it("disables connected apps through the BFF and redirects back to detail", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              ...adminConnectedApps.apps[0],
              status: "disabled",
            }),
            {
              headers: { "Content-Type": "application/json" },
              status: 200,
            },
          ),
      ) as unknown as typeof fetch,
    )
    const formData = new FormData()
    formData.set("appId", adminConnectedApps.apps[0].id)
    formData.set(
      "returnTo",
      `/applications/apps/${adminConnectedApps.apps[0].id}`,
    )

    await expect(disableAdminConnectedAppAction(formData)).rejects.toThrow(
      `redirect:/applications/apps/${adminConnectedApps.apps[0].id}?appAction=disabled`,
    )
    expect(fetch).toHaveBeenLastCalledWith(
      `http://bff.test/api/admin/applications/connected-apps/${adminConnectedApps.apps[0].id}/disable`,
      expect.objectContaining({
        body: undefined,
        method: "POST",
      }),
    )
  })

  it("redirects duplicate URL source responses with a dedicated status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ title: "Duplicate URL source." }), {
            headers: { "Content-Type": "application/json" },
            status: 409,
          }),
      ) as unknown as typeof fetch,
    )
    const formData = new FormData()
    formData.set("corpusId", corpusId)
    formData.set("returnTo", `/knowledge?corpus=${corpusId}&view=add-sources`)
    formData.set("url", "https://docs.example.test/hr-policy")

    await expect(addKnowledgeUrlSourceAction(formData)).rejects.toThrow(
      `redirect:/knowledge?corpus=${corpusId}&view=add-sources&knowledgeAction=duplicateUrl`,
    )
  })

  it("redirects duplicate upload responses with a dedicated status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ title: "Duplicate upload source." }), {
            headers: { "Content-Type": "application/json" },
            status: 409,
          }),
      ) as unknown as typeof fetch,
    )
    const formData = new FormData()
    formData.set("corpusId", corpusId)
    formData.set("returnTo", `/knowledge?corpus=${corpusId}&view=add-sources`)
    formData.append(
      "files",
      uploadFile("policy.pdf", "policy", "application/pdf"),
    )

    await expect(addKnowledgeUploadSourceAction(formData)).rejects.toThrow(
      `redirect:/knowledge?corpus=${corpusId}&view=add-sources&knowledgeAction=duplicateUpload&knowledgeUpload=uploaded-0-failed-1`,
    )
  })

  it("posts V2 ingestion, publish, permission, disable, and hard-delete corpus actions", async () => {
    const returnTo = `/knowledge?corpus=${corpusId}`
    const ingestFormData = new FormData()
    ingestFormData.set("corpusId", corpusId)
    ingestFormData.set("returnTo", returnTo)

    await expect(ingestKnowledgeCorpusAction(ingestFormData)).rejects.toThrow(
      `redirect:/knowledge?corpus=${corpusId}&knowledgeAction=ingested`,
    )
    expect(fetch).toHaveBeenLastCalledWith(
      `http://bff.test/api/admin/knowledge/corpora/${corpusId}/ingest`,
      expect.objectContaining({ method: "POST" }),
    )

    vi.mocked(fetch).mockClear()
    const publishFormData = new FormData()
    publishFormData.set("corpusId", corpusId)
    publishFormData.set("snapshotId", "22222222-2222-4222-8222-222222222222")
    publishFormData.set("returnTo", returnTo)

    await expect(
      publishKnowledgeSnapshotAction(publishFormData),
    ).rejects.toThrow(
      `redirect:/knowledge?corpus=${corpusId}&knowledgeAction=published`,
    )
    expect(fetch).toHaveBeenLastCalledWith(
      `http://bff.test/api/admin/knowledge/corpora/${corpusId}/snapshots/22222222-2222-4222-8222-222222222222/publish`,
      expect.objectContaining({ method: "POST" }),
    )

    vi.mocked(fetch).mockClear()
    const permissionsFormData = new FormData()
    permissionsFormData.set("corpusId", corpusId)
    permissionsFormData.set("accessGroups", "Everyone")
    permissionsFormData.set("returnTo", returnTo)

    await expect(
      updateKnowledgeCorpusAccessAction(permissionsFormData),
    ).rejects.toThrow(
      `redirect:/knowledge?corpus=${corpusId}&knowledgeAction=permissionsUpdated`,
    )
    expect(fetch).toHaveBeenLastCalledWith(
      `http://bff.test/api/admin/knowledge/corpora/${corpusId}/access`,
      expect.objectContaining({
        body: JSON.stringify({ accessGroups: [] }),
        method: "POST",
      }),
    )

    vi.mocked(fetch).mockClear()
    const disableFormData = new FormData()
    disableFormData.set("corpusId", corpusId)
    disableFormData.set("returnTo", returnTo)

    await expect(disableKnowledgeCorpusAction(disableFormData)).rejects.toThrow(
      `redirect:/knowledge?corpus=${corpusId}&knowledgeAction=disabled`,
    )
    expect(fetch).toHaveBeenLastCalledWith(
      `http://bff.test/api/admin/knowledge/corpora/${corpusId}/disable`,
      expect.objectContaining({ method: "POST" }),
    )

    vi.mocked(fetch).mockClear()
    const hardDeleteFormData = new FormData()
    hardDeleteFormData.set("corpusId", corpusId)
    hardDeleteFormData.set("confirmation", "DELETE")
    hardDeleteFormData.set("returnTo", returnTo)

    await expect(
      hardDeleteKnowledgeCorpusAction(hardDeleteFormData),
    ).rejects.toThrow("redirect:/knowledge?knowledgeAction=hardDeleted")
    expect(fetch).toHaveBeenLastCalledWith(
      `http://bff.test/api/admin/knowledge/corpora/${corpusId}/hard-delete`,
      expect.objectContaining({
        body: JSON.stringify({ confirmation: "DELETE" }),
        method: "POST",
      }),
    )
  })

  it("redirects V2 corpus hard delete failures without removing query context", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 400 }))
    const formData = new FormData()
    formData.set("corpusId", corpusId)
    formData.set("confirmation", "WRONG")
    formData.set("returnTo", `/knowledge?corpus=${corpusId}`)

    await expect(hardDeleteKnowledgeCorpusAction(formData)).rejects.toThrow(
      `redirect:/knowledge?corpus=${corpusId}&knowledgeAction=failed`,
    )
  })

  it("redirects all-failed ingestion responses with a failed status", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify(
          knowledgeIngestActionResponse({
            chunkCount: 0,
            failedSourceCount: 1,
            sourceCount: 1,
          }),
        ),
        {
          headers: { "Content-Type": "application/json" },
          status: 200,
        },
      ),
    )
    const formData = new FormData()
    formData.set("corpusId", corpusId)
    formData.set("returnTo", `/knowledge?corpus=${corpusId}`)

    await expect(ingestKnowledgeCorpusAction(formData)).rejects.toThrow(
      `redirect:/knowledge?corpus=${corpusId}&knowledgeAction=ingestFailed`,
    )
  })

  it("redirects partially failed ingestion responses with a warning status", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify(
          knowledgeIngestActionResponse({
            chunkCount: 8,
            failedSourceCount: 1,
            sourceCount: 2,
          }),
        ),
        {
          headers: { "Content-Type": "application/json" },
          status: 200,
        },
      ),
    )
    const formData = new FormData()
    formData.set("corpusId", corpusId)
    formData.set("returnTo", `/knowledge?corpus=${corpusId}`)

    await expect(ingestKnowledgeCorpusAction(formData)).rejects.toThrow(
      `redirect:/knowledge?corpus=${corpusId}&knowledgeAction=partialIngested`,
    )
  })

  it("posts selected source disable, archive, and hard-delete actions to the BFF", async () => {
    const disableFormData = new FormData()
    disableFormData.set("corpusId", corpusId)
    disableFormData.set(
      "returnTo",
      `/knowledge?corpus=${corpusId}&view=edit-sources`,
    )
    disableFormData.set("sourceAction", "disable")
    disableFormData.append("sourceIds", "11111111-1111-4111-8111-111111111111")

    await expect(bulkKnowledgeSourceAction(disableFormData)).rejects.toThrow(
      `redirect:/knowledge?corpus=${corpusId}&view=edit-sources&knowledgeAction=sourcesDisabled`,
    )
    expect(fetch).toHaveBeenLastCalledWith(
      `http://bff.test/api/admin/knowledge/corpora/${corpusId}/sources/bulk-action`,
      expect.objectContaining({
        body: JSON.stringify({
          action: "disable",
          sourceIds: ["11111111-1111-4111-8111-111111111111"],
        }),
        method: "POST",
      }),
    )

    vi.mocked(fetch).mockClear()
    const archiveFormData = new FormData()
    archiveFormData.set("corpusId", corpusId)
    archiveFormData.set("sourceAction", "archive")
    archiveFormData.append("sourceIds", "11111111-1111-4111-8111-111111111111")

    await expect(bulkKnowledgeSourceAction(archiveFormData)).rejects.toThrow(
      `redirect:/knowledge?corpus=${corpusId}&knowledgeAction=sourcesArchived`,
    )
    expect(fetch).toHaveBeenLastCalledWith(
      `http://bff.test/api/admin/knowledge/corpora/${corpusId}/sources/bulk-action`,
      expect.objectContaining({
        body: JSON.stringify({
          action: "archive",
          sourceIds: ["11111111-1111-4111-8111-111111111111"],
        }),
        method: "POST",
      }),
    )

    vi.mocked(fetch).mockClear()
    const hardDeleteFormData = new FormData()
    hardDeleteFormData.set("corpusId", corpusId)
    hardDeleteFormData.set("sourceAction", "hard_delete")
    hardDeleteFormData.set("confirmation", "DELETE")
    hardDeleteFormData.append(
      "sourceIds",
      "22222222-2222-4222-8222-222222222222",
    )

    await expect(bulkKnowledgeSourceAction(hardDeleteFormData)).rejects.toThrow(
      `redirect:/knowledge?corpus=${corpusId}&knowledgeAction=sourcesHardDeleted`,
    )
    expect(fetch).toHaveBeenLastCalledWith(
      `http://bff.test/api/admin/knowledge/corpora/${corpusId}/sources/bulk-action`,
      expect.objectContaining({
        body: JSON.stringify({
          action: "hard_delete",
          confirmation: "DELETE",
          sourceIds: ["22222222-2222-4222-8222-222222222222"],
        }),
        method: "POST",
      }),
    )
  })

  it("posts archive restore and archive hard-delete actions to the BFF", async () => {
    const archiveId = "99999999-9999-4999-8999-999999999999"
    const restoreFormData = new FormData()
    restoreFormData.set("returnTo", "/knowledge?view=archive")
    restoreFormData.set("sourceAction", "restore")
    restoreFormData.append("archivedSourceIds", archiveId)

    await expect(
      bulkKnowledgeArchiveSourceAction(restoreFormData),
    ).rejects.toThrow(
      "redirect:/knowledge?view=archive&knowledgeAction=archiveSourcesRestored",
    )
    expect(fetch).toHaveBeenLastCalledWith(
      "http://bff.test/api/admin/knowledge/archive/sources/bulk-action",
      expect.objectContaining({
        body: JSON.stringify({
          action: "restore",
          archivedSourceIds: [archiveId],
        }),
        method: "POST",
      }),
    )

    vi.mocked(fetch).mockClear()
    const hardDeleteFormData = new FormData()
    hardDeleteFormData.set("returnTo", "/knowledge?view=archive")
    hardDeleteFormData.set("sourceAction", "hard_delete")
    hardDeleteFormData.set("confirmation", "DELETE")
    hardDeleteFormData.append("archivedSourceIds", archiveId)

    await expect(
      bulkKnowledgeArchiveSourceAction(hardDeleteFormData),
    ).rejects.toThrow(
      "redirect:/knowledge?view=archive&knowledgeAction=archiveSourcesHardDeleted",
    )
    expect(fetch).toHaveBeenLastCalledWith(
      "http://bff.test/api/admin/knowledge/archive/sources/bulk-action",
      expect.objectContaining({
        body: JSON.stringify({
          action: "hard_delete",
          archivedSourceIds: [archiveId],
          confirmation: "DELETE",
        }),
        method: "POST",
      }),
    )
  })

  it("posts organization settings updates with logo metadata and returns to Settings", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(adminSettings), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      }),
    )
    const formData = new FormData()
    formData.set("returnTo", "/settings")
    formData.set("organizationName", "Sovereign Console")
    formData.set("defaultLanguage", "hr")
    formData.append("fullLogo", uploadFile("logo.png", "logo", "image/png"))
    formData.set("fullLogoWidth", "400")
    formData.set("fullLogoHeight", "120")
    formData.append("iconLogo", uploadFile("icon.jpg", "icon", "image/jpeg"))
    formData.set("iconLogoWidth", "96")
    formData.set("iconLogoHeight", "96")

    await expect(
      updateAdminSettingsOrganizationAction(formData),
    ).rejects.toThrow("redirect:/settings?settingsAction=organizationSaved")

    expect(fetch).toHaveBeenCalledWith(
      "http://bff.test/api/admin/settings/organization",
      expect.objectContaining({
        method: "POST",
      }),
    )
    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body))
    expect(body).toMatchObject({
      defaultLanguage: "hr",
      fullLogo: expect.objectContaining({
        dataUrl: expect.stringMatching(/^data:image\/png;base64,/),
        fileName: "logo.png",
        height: 120,
        mimeType: "image/png",
        width: 400,
      }),
      iconLogo: expect.objectContaining({
        dataUrl: expect.stringMatching(/^data:image\/jpeg;base64,/),
        fileName: "icon.jpg",
        height: 96,
        mimeType: "image/jpeg",
        width: 96,
      }),
      organizationName: "Sovereign Console",
    })
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings")
  })

  it("rejects invalid organization logo uploads before calling the BFF", async () => {
    const formData = new FormData()
    formData.set("returnTo", "/settings")
    formData.set("organizationName", "Sovereign Console")
    formData.set("defaultLanguage", "en")
    formData.append("iconLogo", uploadFile("icon.png", "icon", "image/png"))
    formData.set("iconLogoWidth", "128")
    formData.set("iconLogoHeight", "64")

    await expect(
      updateAdminSettingsOrganizationAction(formData),
    ).rejects.toThrow("redirect:/settings?settingsAction=invalidLogo")
    expect(fetch).not.toHaveBeenCalled()
  })

  it("posts URL governance rule create, update, disable, and delete actions", async () => {
    vi.mocked(fetch).mockImplementation(
      async () =>
        new Response(JSON.stringify(adminSettings), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        }),
    )
    const ruleId = "11111111-1111-4111-8111-111111111111"
    const createForm = new FormData()
    createForm.set("returnTo", "/settings")
    createForm.set("type", "forbidden")
    createForm.set("pattern", "blocked.example.test")
    createForm.set("scope", "knowledge_ingestion")
    createForm.set("reason", "Blocked by admin policy.")

    await expect(
      createAdminSettingsUrlPolicyRuleAction(createForm),
    ).rejects.toThrow("redirect:/settings?settingsAction=urlRuleCreated")
    expect(fetch).toHaveBeenLastCalledWith(
      "http://bff.test/api/admin/settings/url-policy/rules",
      expect.objectContaining({
        body: JSON.stringify({
          pattern: "blocked.example.test",
          reason: "Blocked by admin policy.",
          scope: "knowledge_ingestion",
          type: "forbidden",
        }),
        method: "POST",
      }),
    )

    const updateForm = new FormData()
    updateForm.set("returnTo", "/settings")
    updateForm.set("ruleId", ruleId)
    updateForm.set("type", "trusted")
    updateForm.set("pattern", "docs.example.test")
    updateForm.set("scope", "all")
    updateForm.set("status", "active")
    updateForm.set("reason", "Approved docs source.")
    await expect(
      updateAdminSettingsUrlPolicyRuleAction(updateForm),
    ).rejects.toThrow("redirect:/settings?settingsAction=urlRuleUpdated")
    expect(fetch).toHaveBeenLastCalledWith(
      `http://bff.test/api/admin/settings/url-policy/rules/${ruleId}/update`,
      expect.objectContaining({
        body: JSON.stringify({
          pattern: "docs.example.test",
          reason: "Approved docs source.",
          scope: "all",
          status: "active",
          type: "trusted",
        }),
        method: "POST",
      }),
    )

    const disableForm = new FormData()
    disableForm.set("returnTo", "/settings")
    disableForm.set("ruleId", ruleId)
    await expect(
      disableAdminSettingsUrlPolicyRuleAction(disableForm),
    ).rejects.toThrow("redirect:/settings?settingsAction=urlRuleDisabled")
    expect(fetch).toHaveBeenLastCalledWith(
      `http://bff.test/api/admin/settings/url-policy/rules/${ruleId}/disable`,
      expect.objectContaining({ method: "POST" }),
    )

    const deleteForm = new FormData()
    deleteForm.set("returnTo", "/settings")
    deleteForm.set("ruleId", ruleId)
    await expect(
      deleteAdminSettingsUrlPolicyRuleAction(deleteForm),
    ).rejects.toThrow("redirect:/settings?settingsAction=urlRuleDeleted")
    expect(fetch).toHaveBeenLastCalledWith(
      `http://bff.test/api/admin/settings/url-policy/rules/${ruleId}/delete`,
      expect.objectContaining({ method: "POST" }),
    )
  })

  it("posts telemetry toggle actions and requires no system update action", async () => {
    expect("runAdminSettingsSystemUpdateAction" in adminActions).toBe(false)
    vi.mocked(fetch).mockImplementation(
      async () =>
        new Response(JSON.stringify(adminSettings), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        }),
    )
    const enableForm = new FormData()
    enableForm.set("returnTo", "/settings")
    enableForm.set("enabled", "on")
    enableForm.set("confirmation", "ENABLE TELEMETRY")

    await expect(
      updateAdminSettingsTelemetryAction(enableForm),
    ).rejects.toThrow("redirect:/settings?settingsAction=telemetryEnabled")
    expect(fetch).toHaveBeenLastCalledWith(
      "http://bff.test/api/admin/settings/telemetry",
      expect.objectContaining({
        body: JSON.stringify({
          confirmation: "ENABLE TELEMETRY",
          enabled: true,
        }),
        method: "POST",
      }),
    )

    const disableForm = new FormData()
    disableForm.set("returnTo", "/settings")
    await expect(
      updateAdminSettingsTelemetryAction(disableForm),
    ).rejects.toThrow("redirect:/settings?settingsAction=telemetryDisabled")
    expect(fetch).toHaveBeenLastCalledWith(
      "http://bff.test/api/admin/settings/telemetry",
      expect.objectContaining({
        body: JSON.stringify({
          enabled: false,
        }),
        method: "POST",
      }),
    )
  })
})

function uploadFile(name: string, content: string, type: string): File {
  const bytes = new TextEncoder().encode(content)
  const file = new File([bytes], name, { type })
  Object.defineProperty(file, "arrayBuffer", {
    value: async () => bytes.buffer,
  })
  return file
}

function knowledgeActionResponse() {
  return {
    corpus: {
      accessGroups: [],
      chunkCount: 0,
      createdAt,
      createdBy: "admin",
      description: "Corpus",
      id: corpusId,
      languageHints: ["hr", "en"],
      name: "HR corpus",
      publishedSnapshotId: null,
      sourceCount: 1,
      status: "draft",
      updatedAt: createdAt,
      updatedBy: "admin",
    },
    job: null,
    snapshot: null,
    source: {
      canonicalUri: null,
      checksum: "sha256:test",
      corpusId,
      createdAt,
      createdBy: "admin",
      errorDetail: null,
      finalUri: null,
      id: "44444444-4444-4444-8444-444444444444",
      language: null,
      metadata: {},
      mimeType: "application/pdf",
      originalUri: "file://policy.pdf",
      sourceType: "file",
      status: "pending",
      title: "policy.pdf",
      updatedAt: createdAt,
    },
  }
}

function knowledgeIngestActionResponse({
  chunkCount,
  failedSourceCount,
  sourceCount,
}: {
  chunkCount: number
  failedSourceCount: number
  sourceCount: number
}) {
  return {
    ...knowledgeActionResponse(),
    corpus: {
      ...knowledgeActionResponse().corpus,
      chunkCount,
      sourceCount,
      status: "staged",
    },
    job: {
      corpusId,
      createdAt,
      createdBy: "admin",
      errorDetail: null,
      id: "55555555-5555-4555-8555-555555555555",
      jobType: "ingest",
      metrics: {
        chunkCount,
        failedSourceCount,
        sourceCount,
      },
      progressPercent: 100,
      retryCount: 0,
      sourceId: null,
      status: "succeeded",
      updatedAt: createdAt,
    },
    snapshot: {
      chunkCount,
      corpusId,
      createdAt,
      id: "66666666-6666-4666-8666-666666666666",
      metadata: {
        failedSourceCount,
      },
      publishedAt: null,
      publishedBy: null,
      sourceCount,
      status: "staged",
      version: 1,
    },
  }
}

function teamActionIdleState() {
  return {
    error: null,
    generatedPassword: null,
    memberId: null,
    status: "idle" as const,
  }
}

function teamMemberMutationResponse() {
  return {
    generatedPassword: "Llm-generated-password-26",
    member: {
      createdAt,
      displayName: "Ada Lovelace",
      email: "ada@example.test",
      enabled: true,
      groups: ["Engineering"],
      id: "kc-user-1",
      keycloakHref:
        "https://keycloak.example.test/admin/master/users/kc-user-1",
      lastActiveAt: createdAt,
      role: "builder",
      status: "active",
      username: "ada.lovelace",
    },
  }
}

function teamGroupMutationResponse(
  status: "assigned" | "created" | "removed" | "updated",
) {
  return {
    group: {
      id: "group-engineering",
      keycloakHref:
        "https://keycloak.example.test/admin/master/groups/group-engineering",
      memberCount: status === "assigned" ? 2 : status === "removed" ? 1 : 0,
      name: status === "updated" ? "Operations" : "Engineering",
      unlockCount: 0,
      virtual: false,
    },
    status,
  }
}

function teamBreakGlassResponse() {
  return {
    eligibleAdmins: [
      {
        ...teamMemberMutationResponse().member,
        displayName: "Ana Admin",
        id: "kc-admin-1",
        role: "admin",
        username: "ana.admin",
      },
    ],
    selectedAdminId: "kc-admin-1",
    updatedAt: createdAt,
    updatedBy: "admin-1",
  }
}

function emptyCsvImportState() {
  return {
    commit: null,
    csv: "",
    error: null,
    preview: null,
    status: "idle" as const,
  }
}

function teamCsvImportPreviewResponse() {
  return {
    generatedAt: createdAt,
    rows: [
      {
        actions: ["create_user", "assign_group", "send_invite"],
        email: "bo@example.com",
        enabled: true,
        errors: [],
        group: "Engineering",
        line: 2,
        name: "Bo Builder",
        role: "builder",
        sendInvite: true,
        status: "valid",
        username: "bo",
      },
    ],
    valid: true,
  }
}

function teamCsvImportCommitResponse() {
  return {
    ...teamCsvImportPreviewResponse(),
    createdCount: 1,
    failedCount: 0,
    rows: [
      {
        ...teamCsvImportPreviewResponse().rows[0],
        status: "created",
      },
    ],
    skippedCount: 0,
  }
}

function connectorRegistryItemResponse() {
  return {
    allowedEndpoints: ["mcp.example.test:443"],
    auditHref: "#audit-log-deferred",
    auditEvents: ["connector.docs-mcp.invoke"],
    checksum: "sha256:docs-mcp",
    dataClasses: ["admin-configured"],
    description: "Documentation MCP server.",
    displayName: "Docs MCP",
    effectiveVettingStatus: "approved_read_only",
    id: "docs-mcp",
    lastReviewedAt: createdAt,
    license: "Local admin configuration",
    localDecision: null,
    maintainer: "Console Admin",
    posture: "approved",
    readWrite: "read_only",
    requiredScopes: ["@docs-mcp"],
    runtimeProfile: "admin-url-mcp",
    runtimeSetup: {
      activeEgress: ["mcp.example.test:443"],
      detail:
        "Admin-created URL MCP server is approved and routed through the BFF gateway.",
      missingEgress: [],
      missingSecrets: [],
      runnable: true,
      setupHref: "/applications",
      status: "ready",
    },
    reviewHref: "/resources/mcp_connector/docs-mcp",
    secretsRequired: [],
    sourceRef: "admin/mcp-servers/docs-mcp",
    sourceStatus: "ok",
    supportTier: "t3",
    version: "0.1.0",
    vettingStatus: "approved_read_only",
  }
}
