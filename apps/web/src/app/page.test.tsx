import { ApplicationsV2Experience } from "@/components/console-v2/applications-v2-experience"
import { HardwareV2Experience } from "@/components/console-v2/hardware-v2-experience"
import { InferenceV2Experience } from "@/components/console-v2/inference-v2-experience"
import { KnowledgeV2Experience } from "@/components/console-v2/knowledge-v2-experience"
import { SettingsV2Experience } from "@/components/console-v2/settings-v2-experience"
import { TeamV2Experience } from "@/components/console-v2/team-v2-experience"
import {
  adminConnectedApps,
  adminConnectorRegistry,
  adminInference,
  adminSettings,
  adminTeamOverview,
} from "@/lib/admin/mock-data"
import * as adminServerData from "@/lib/admin/server-data"
import type {
  AdminHardwareResponse,
  AdminTeamGroupDetail,
  AdminTeamMemberDetail,
  AdminTeamOverviewResponse,
  KnowledgeCorpus,
  KnowledgeCorpusDetailResponse,
  KnowledgeSource,
} from "@llm-machines/contracts"
import type {
  AdminSettingsResponse as CoreAdminSettingsResponse,
  AdminTeamGroupDetail as CoreAdminTeamGroupDetail,
  AdminTeamMemberDetail as CoreAdminTeamMemberDetail,
  AdminTeamOverviewResponse as CoreAdminTeamOverviewResponse,
} from "@llm-machines/contracts/inference-core"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  fireEvent,
  render as rtlRender,
  screen,
  within,
} from "@testing-library/react"
import { axe } from "jest-axe"
import React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import ApplicationsConsolePage from "./applications/[[...section]]/page"
import ArtifactDetailPage from "./artifacts/[id]/page"
import ArtifactsPage from "./artifacts/page"
import SignInPage from "./auth/signin/page"
import BuilderAgentStudioPage from "./builder/agents/[id]/page"
import BuilderPage from "./builder/page"
import BuilderResourceDetailPage from "./builder/resources/[id]/page"
import BuilderSubmissionsPage from "./builder/submissions/page"
import BuilderTemplateDetailPage from "./builder/templates/[id]/page"
import BuilderTemplatesPage from "./builder/templates/page"
import ChatPage from "./chat/page"
import HardwareConsolePage from "./hardware/page"
import InferenceConsolePage from "./inference/[[...section]]/page"
import KnowledgeConsolePage from "./knowledge/page"
import HomePage from "./page"
import ProfilePage from "./profile/page"
import ResourceDetailPage from "./resources/[type]/[id]/page"
import ResourcesPage from "./resources/page"
import SettingsConsolePage from "./settings/page"
import TaskDetailPage from "./tasks/[id]/page"
import TasksPage from "./tasks/page"
import TeamConsolePage from "./team/[[...section]]/page"
import UsagePage from "./usage/page"

const navigationMocks = vi.hoisted(() => ({
  redirect: vi.fn((href: string) => {
    throw new Error(`redirect:${href}`)
  }),
  router: {
    push: vi.fn(),
  },
}))

const removedKnowledgeSearchHeading = ["Test", "search"].join(" ")
const removedKnowledgeQueryLabel = ["Retrieval", "query"].join(" ")
const removedKnowledgeResultsLabel = [
  "Console v2 cited",
  "retrieval results",
].join(" ")

interface ConsoleV2TestPageProps {
  params?: Promise<{
    section?: string[]
  }>
  searchParams?: Promise<Record<string, string>>
}

function render(ui: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })

  return rtlRender(ui, {
    wrapper: ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  })
}

function knowledgeSourceFixture(
  overrides: Partial<KnowledgeSource> = {},
): KnowledgeSource {
  return {
    canonicalUri: null,
    checksum: "sha256:test-source",
    corpusId: "abababab-abab-4aba-8bab-abababababab",
    createdAt: "2026-06-05T18:00:00.000Z",
    createdBy: "admin-1",
    errorDetail: null,
    finalUri: null,
    id: "cdcdcdcd-cdcd-4cdc-8dcd-cdcdcdcdcdcd",
    language: null,
    metadata: {},
    mimeType: "text/plain",
    originalUri: "test-source.txt",
    sourceType: "file",
    status: "pending",
    title: "Test source",
    updatedAt: "2026-06-05T18:00:00.000Z",
    ...overrides,
  }
}

async function ConsoleV2TestPage({
  params,
  searchParams,
}: ConsoleV2TestPageProps) {
  const section = params ? ((await params).section ?? []) : []
  const [topLevelSection, ...nestedSection] = section

  switch (topLevelSection) {
    case "applications":
      return ApplicationsConsolePage({
        params: Promise.resolve({ section: nestedSection }),
        searchParams,
      })
    case "inference":
      return InferenceConsolePage({
        params: Promise.resolve({ section: nestedSection }),
        searchParams,
      })
    case "hardware":
      return HardwareConsolePage({ searchParams })
    case "team":
      return TeamConsolePage({
        params: Promise.resolve({ section: nestedSection }),
        searchParams,
      })
    case "settings":
      return SettingsConsolePage({ searchParams })
    case "knowledge":
    case undefined:
      return KnowledgeConsolePage({ searchParams })
    default:
      return KnowledgeConsolePage({ searchParams })
  }
}

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
    React.createElement("a", { href: String(href), ...props }, children),
}))

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound")
  },
  redirect: navigationMocks.redirect,
  usePathname: () => "/",
  useRouter: () => navigationMocks.router,
}))

vi.mock("@/lib/admin/server-data", async () => {
  const admin = await import("@/lib/admin/mock-data")
  const fixtureStore = await import("@/lib/knowledge/fixture-store")
  const knowledge = await import("@/lib/knowledge/mock-data")
  class ConsoleBffAuthExpiredError extends Error {
    constructor(path: string) {
      super(`Console BFF authentication expired for ${path}.`)
      this.name = "ConsoleBffAuthExpiredError"
    }
  }

  return {
    ConsoleBffAuthExpiredError,
    getAdminConnectedAppDetail: vi.fn(async (appId: string) => {
      const app = admin.adminConnectedApps.apps.find(
        (item) => item.id === appId,
      )
      return app ? { app } : null
    }),
    getAdminConnectedApps: vi.fn(async () => admin.adminConnectedApps),
    getAdminConnectorRegistry: vi.fn(async () => admin.adminConnectorRegistry),
    getAdminHardware: vi.fn(async () => admin.adminHardware),
    getAdminInference: vi.fn(async (filters: { range?: string } = {}) => ({
      ...admin.adminInference,
      range:
        filters.range === "7d" ||
        filters.range === "30d" ||
        filters.range === "90d"
          ? filters.range
          : admin.adminInference.range,
    })),
    getAdminKnowledgeArchivedSources: vi.fn(async () =>
      fixtureStore.getFixtureKnowledgeArchiveSourceList(),
    ),
    getAdminKnowledgeCorpora: vi.fn(async () =>
      fixtureStore.getFixtureKnowledgeCorpusList(),
    ),
    getAdminKnowledgeCorpusDetail: vi.fn(async (corpusId: string) =>
      fixtureStore.getFixtureKnowledgeCorpusDetail(corpusId),
    ),
    getAdminKnowledgeRetrievalTest: vi.fn(
      async (_corpusId: string, query: string) => ({
        ...knowledge.knowledgeRetrievalTestResult,
        query,
      }),
    ),
    getAdminMcpServerDetail: vi.fn(async (connectorId: string) =>
      connectorId === admin.adminMcpServerDetail.id
        ? admin.adminMcpServerDetail
        : null,
    ),
    getAdminSettings: vi.fn(async () => admin.adminSettings),
    getAdminTeamBreakGlass: vi.fn(
      async () => admin.adminTeamOverview.breakGlass,
    ),
    getAdminTeamGroupDetail: vi.fn(async () => null),
    getAdminTeamMemberDetail: vi.fn(async () => null),
    getAdminTeamOverview: vi.fn(async () => admin.adminTeamOverview),
    getAdminTeamScimStatus: vi.fn(async () => admin.adminTeamOverview.scim),
    isConsoleBffAuthExpiredError: vi.fn(
      (error: unknown) => error instanceof ConsoleBffAuthExpiredError,
    ),
  }
})

vi.mock("@/lib/admin/server-data-core", async () => {
  const admin = await import("@/lib/admin/mock-data")
  const allowedServiceIds = new Set([
    "web",
    "bff",
    "postgres",
    "keycloak",
    "litellm",
    "grafana",
  ])
  const settings: CoreAdminSettingsResponse = {
    generatedAt: admin.adminSettings.generatedAt,
    license: admin.adminSettings.license,
    organization: admin.adminSettings.organization,
    privacy: admin.adminSettings.privacy,
    reachability: admin.adminSettings.reachability.flatMap((service) =>
      allowedServiceIds.has(service.id)
        ? [
            {
              ...service,
              id: service.id as
                | "bff"
                | "grafana"
                | "keycloak"
                | "litellm"
                | "postgres"
                | "web",
            },
          ]
        : [],
    ),
    sourceStatus: admin.adminSettings.sourceStatus,
    systemUpdate: admin.adminSettings.systemUpdate,
  }
  const team: CoreAdminTeamOverviewResponse = {
    generatedAt: admin.adminTeamOverview.generatedAt,
    groups: admin.adminTeamOverview.groups.map(
      ({ unlockCount: _unlockCount, ...group }) => group,
    ),
    members: [],
    scim: admin.adminTeamOverview.scim,
    serviceStatus: admin.adminTeamOverview.serviceStatus,
    sourceStatus: admin.adminTeamOverview.sourceStatus,
  }

  class ConsoleBffAuthExpiredError extends Error {
    constructor(path: string) {
      super(`Console BFF authentication expired for ${path}.`)
      this.name = "ConsoleBffAuthExpiredError"
    }
  }

  return {
    ConsoleBffAuthExpiredError,
    getAdminConnectedAppDetail: vi.fn(async (appId: string) => {
      const app = admin.adminConnectedApps.apps.find(
        (item) => item.id === appId,
      )
      return app ? { app } : null
    }),
    getAdminConnectedApps: vi.fn(async () => admin.adminConnectedApps),
    getAdminHardware: vi.fn(async () => admin.adminHardware),
    getAdminInference: vi.fn(async (filters: { range?: string } = {}) => ({
      ...admin.adminInference,
      range:
        filters.range === "7d" ||
        filters.range === "30d" ||
        filters.range === "90d"
          ? filters.range
          : admin.adminInference.range,
    })),
    getAdminSettings: vi.fn(async () => settings),
    getAdminTeamGroupDetail: vi.fn(async () => null),
    getAdminTeamMemberDetail: vi.fn(async () => null),
    getAdminTeamOverview: vi.fn(async () => team),
    isConsoleBffAuthExpiredError: vi.fn(
      (error: unknown) => error instanceof ConsoleBffAuthExpiredError,
    ),
  }
})

vi.mock("@/lib/hub/server-data", async () => {
  const hub = await import("@/lib/hub/mock-data")

  return {
    getHubArtifactById: vi.fn(async (id: string) =>
      hub.hubArtifacts.find((artifact) => artifact.id === id),
    ),
    getHubArtifacts: vi.fn(async () => hub.hubArtifacts),
    getHubHome: vi.fn(async () => hub.hubHome),
    getHubResourceById: vi.fn(async (type: string, id: string) =>
      hub.hubResources.find(
        (resource) => resource.type === type && resource.id === id,
      ),
    ),
    getHubResources: vi.fn(async () => hub.hubResources),
    getHubTaskById: vi.fn(async (id: string) =>
      hub.hubTasks.find((task) => task.id === id),
    ),
    getHubTasks: vi.fn(async () => hub.hubTasks),
    getHubUsage: vi.fn(async () => hub.hubUsage),
  }
})

vi.mock("@/lib/auth/auth", () => ({
  signIn: vi.fn(),
}))

class TestEventSource {
  addEventListener() {}
  close() {}
}

function titleCase(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`
}

const teamGroupsForPermissions: AdminTeamOverviewResponse["groups"] = [
  ...adminTeamOverview.groups,
  {
    id: "group-engineering",
    keycloakHref:
      "https://keycloak.example.test/admin/master/groups/group-engineering",
    memberCount: 2,
    name: "Engineering",
    unlockCount: 0,
    virtual: false,
  },
  {
    id: "group-operators",
    keycloakHref:
      "https://keycloak.example.test/admin/master/groups/group-operators",
    memberCount: 1,
    name: "Operators",
    unlockCount: 0,
    virtual: false,
  },
]

const coreAdminSettings: CoreAdminSettingsResponse = {
  generatedAt: adminSettings.generatedAt,
  license: adminSettings.license,
  organization: adminSettings.organization,
  privacy: adminSettings.privacy,
  reachability: (
    ["web", "bff", "postgres", "keycloak", "litellm", "grafana"] as const
  ).map((id) => {
    const service = adminSettings.reachability.find((item) => item.id === id)
    if (!service) {
      throw new Error(`Missing ${id} Settings fixture.`)
    }
    return { ...service, id }
  }),
  sourceStatus: adminSettings.sourceStatus,
  systemUpdate: adminSettings.systemUpdate,
}

describe("HomePage", () => {
  afterEach(() => {
    navigationMocks.redirect.mockClear()
    navigationMocks.router.push.mockClear()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it("redirects the root route to the retained Applications page", () => {
    expect(() => HomePage()).toThrow("redirect:/applications")
    expect(navigationMocks.redirect).toHaveBeenCalledWith("/applications")
  })

  it.each([
    [
      "sign in",
      () =>
        SignInPage({
          searchParams: Promise.resolve({
            callbackUrl: "/builder",
          }),
        }),
    ],
    [
      "knowledge",
      () =>
        KnowledgeConsolePage({
          searchParams: Promise.resolve({}),
        }),
    ],
    [
      "knowledge archive",
      () =>
        KnowledgeConsolePage({
          searchParams: Promise.resolve({ view: "archive" }),
        }),
    ],
    [
      "console shell",
      () =>
        ConsoleV2TestPage({
          params: Promise.resolve({ section: [] }),
        }),
    ],
    ["builder", () => BuilderPage()],
    ["builder templates", () => BuilderTemplatesPage()],
    [
      "builder template detail",
      () =>
        BuilderTemplateDetailPage({
          params: Promise.resolve({
            id: "template-summary-agent",
          }),
        }),
    ],
    ["builder submissions", () => BuilderSubmissionsPage()],
    [
      "builder agent studio",
      () =>
        BuilderAgentStudioPage({
          params: Promise.resolve({
            id: "66666666-6666-4666-8666-666666666666",
          }),
        }),
    ],
    [
      "builder resource detail",
      () =>
        BuilderResourceDetailPage({
          params: Promise.resolve({
            id: "66666666-6666-4666-8666-666666666666",
          }),
        }),
    ],
    ["resources", () => ResourcesPage()],
    [
      "resource detail",
      () =>
        ResourceDetailPage({
          params: Promise.resolve({
            id: "internal-docs",
            type: "mcp_connector",
          }),
        }),
    ],
    ["tasks", () => TasksPage()],
    [
      "task detail",
      () =>
        TaskDetailPage({
          params: Promise.resolve({
            id: "44444444-4444-4444-8444-444444444444",
          }),
        }),
    ],
    ["artifacts", () => ArtifactsPage()],
    [
      "artifact detail",
      () =>
        ArtifactDetailPage({
          params: Promise.resolve({
            id: "55555555-5555-4555-8555-555555555555",
          }),
        }),
    ],
    ["usage", () => UsagePage()],
    ["profile", () => ProfilePage()],
  ])(
    "has no obvious accessibility violations on %s",
    async (_name, loadPage) => {
      vi.stubGlobal("EventSource", TestEventSource)
      const page = await loadPage()
      const { container } = render(page)

      const results = await axe(container)

      expect(results.violations).toEqual([])
    },
  )

  it("redirects the internal chat route to LibreChat", async () => {
    vi.stubEnv("LIBRECHAT_PUBLIC_URL", "https://librechat.test")

    await expect(
      ChatPage({
        searchParams: Promise.resolve({
          thread: "thread-1",
        }),
      }),
    ).rejects.toThrow("redirect:https://librechat.test/c/thread-1")
    expect(navigationMocks.redirect).toHaveBeenCalledWith(
      "https://librechat.test/c/thread-1",
    )
  })

  it("renders cutover Admin Knowledge controls and audit actions", async () => {
    vi.stubGlobal("EventSource", TestEventSource)
    const page = await KnowledgeConsolePage({
      searchParams: Promise.resolve({
        corpus: "33333333-3333-4333-8333-333333333333",
        knowledgeAction: "partialSourcesAdded",
        knowledgeUpload: "uploaded-1-failed-1",
      }),
    })

    render(page)

    expect(screen.getByRole("heading", { name: "Knowledge" })).toBeTruthy()
    expect(screen.getByText("Security Runbooks")).toBeTruthy()
    expect(screen.getByRole("link", { name: "Import" })).toBeTruthy()
    const publishButton = screen.getByRole("button", { name: "Publish" })
    const publishIndicator = screen.getByTestId("publish-ready-indicator")
    expect(publishButton).toBeTruthy()
    expect(publishIndicator.nextElementSibling).toBe(publishButton)
    expect(String(publishIndicator.parentElement?.className)).toContain("gap-2")
    expect(screen.getByLabelText("Corpus permissions")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Grant" })).toBeNull()
    expect(screen.getByRole("link", { name: "View sources" })).toBeTruthy()
    expect(
      screen.getByRole("link", { name: "View snapshots" }).getAttribute("href"),
    ).toBe(
      "/knowledge?corpus=33333333-3333-4333-8333-333333333333&view=snapshots",
    )
    expect(
      screen.getByRole("link", { name: "View archive" }).getAttribute("href"),
    ).toBe("/knowledge?view=archive")
    expect(
      screen.getByText(
        "Review each staged or published ingestion snapshot for the selected corpus.",
      ),
    ).toBeTruthy()
    expect(screen.getByRole("button", { name: "Export" })).toHaveProperty(
      "disabled",
      true,
    )
    expect(
      screen.queryByRole("heading", { name: removedKnowledgeSearchHeading }),
    ).toBeNull()
    expect(screen.queryByLabelText(removedKnowledgeQueryLabel)).toBeNull()
    expect(screen.getByText("Document upload")).toBeTruthy()
    expect(screen.getByText("1 added, 1 failed.")).toBeTruthy()
    expect(
      screen.queryByRole("heading", { name: "Governed corpora" }),
    ).toBeNull()
  })

  it("centers the corpus hard-delete confirmation modal", async () => {
    vi.stubGlobal("EventSource", TestEventSource)
    const page = await KnowledgeConsolePage({
      searchParams: Promise.resolve({
        corpus: "11111111-1111-4111-8111-111111111111",
      }),
    })

    render(page)

    fireEvent.click(screen.getByRole("button", { name: "Delete" }))

    const dialog = screen.getByRole("dialog", { name: "Delete corpus?" })
    expect(dialog.className).toContain("fixed")
    expect(dialog.className).toContain("place-items-center")
    expect(dialog.firstElementChild?.className).toContain("max-w-[360px]")
    expect(screen.getByLabelText("Type DELETE to confirm")).toBeTruthy()
  })

  it("renders V2 Add Sources selected-file validation and duplicate feedback", async () => {
    vi.stubGlobal("EventSource", TestEventSource)
    const page = await KnowledgeConsolePage({
      searchParams: Promise.resolve({
        corpus: "11111111-1111-4111-8111-111111111111",
        knowledgeAction: "duplicateUrl",
        view: "add-sources",
      }),
    })

    const { container } = render(page)

    expect(
      screen.getByText("Duplicate URL already exists in this corpus."),
    ).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Upload" })).toBeNull()

    const fileInput = screen.getByLabelText("Select source files")
    fireEvent.change(fileInput, {
      target: {
        files: [
          new File(["policy"], "policy.pdf", { type: "application/pdf" }),
          new File(["not allowed"], "malware.exe", {
            type: "application/octet-stream",
          }),
        ],
      },
    })

    expect(screen.getByRole("heading", { name: "Selected files" })).toBeTruthy()
    expect(screen.getByText("policy.pdf")).toBeTruthy()
    expect(screen.getByText(".pdf")).toBeTruthy()
    expect(screen.getByText("6 B")).toBeTruthy()
    expect(screen.getByText("malware.exe")).toBeTruthy()
    expect(
      screen.getAllByText("Unsupported file type.").length,
    ).toBeGreaterThan(0)
    let uploadButton = screen.getByRole("button", { name: "Upload" })
    expect(uploadButton).toHaveProperty("disabled", true)

    fireEvent.change(fileInput, {
      target: {
        files: [new File(["a,b"], "table.csv", { type: "text/csv" })],
      },
    })

    expect(screen.getByText("table.csv")).toBeTruthy()
    expect(screen.getAllByText(".csv").length).toBeGreaterThan(0)
    expect(screen.getByText("Ready to upload")).toBeTruthy()
    uploadButton = screen.getByRole("button", { name: "Upload" })
    expect(uploadButton).toHaveProperty("disabled", false)

    fireEvent.submit(screen.getByTestId("knowledge-upload-form"))

    expect(screen.getByRole("button", { name: "Uploading" })).toHaveProperty(
      "disabled",
      true,
    )
    expect(screen.getAllByText("Uploading").length).toBeGreaterThan(0)
    expect(
      container.querySelector('[aria-label="Uploading"].animate-spin'),
    ).toBeTruthy()
  })

  it("renders the retained Console navigation without Knowledge", async () => {
    vi.stubGlobal("EventSource", TestEventSource)
    const page = await ConsoleV2TestPage({
      params: Promise.resolve({ section: [] }),
    })

    render(page)

    const navigation = screen.getByRole("navigation", {
      name: "Console v2 navigation",
    })
    const expectedLinks = [
      ["Applications", "/applications"],
      ["Inference", "/inference"],
      ["Hardware", "/hardware"],
      ["Team", "/team"],
      ["Settings", "/settings"],
    ] as const

    for (const [label, href] of expectedLinks) {
      expect(
        within(navigation)
          .getByRole("link", { name: label })
          .getAttribute("href"),
      ).toBe(href)
    }

    expect(
      within(navigation).queryByRole("link", { name: "Knowledge" }),
    ).toBeNull()
    expect(screen.getByRole("heading", { name: "Knowledge" })).toBeTruthy()
    expect(screen.getByText("HR Policies")).toBeTruthy()
    expect(screen.queryByText("Archived Legacy Policies")).toBeNull()
    expect(
      screen.getByText(
        "Exportable audit logs are tracked for the production pass.",
      ),
    ).toBeTruthy()
    expect(screen.getByRole("button", { name: "Export" })).toHaveProperty(
      "disabled",
      true,
    )
    expect(
      screen.getByRole("link", { name: "View snapshots" }).getAttribute("href"),
    ).toBe(
      "/knowledge?corpus=11111111-1111-4111-8111-111111111111&view=snapshots",
    )
    expect(
      screen.getByRole("link", { name: "View archive" }).getAttribute("href"),
    ).toBe("/knowledge?view=archive")
    expect(
      screen.queryByRole("heading", { name: "Governed corpora" }),
    ).toBeNull()
  })

  it("renders controlled Console unavailable state without admin fixture data", async () => {
    vi.stubGlobal("EventSource", TestEventSource)
    vi.mocked(adminServerData.getAdminKnowledgeCorpora).mockRejectedValueOnce(
      new Error(
        "Console BFF is not available for /api/admin/knowledge/corpora; fixture mode is disabled.",
      ),
    )

    const page = await KnowledgeConsolePage({
      searchParams: Promise.resolve({}),
    })

    render(page)

    expect(screen.getByText("Console data unavailable")).toBeTruthy()
    expect(screen.queryByText("HR Policies")).toBeNull()
  })

  it("redirects expired Console BFF authentication to Keycloak SSO", async () => {
    vi.stubGlobal("EventSource", TestEventSource)
    vi.mocked(adminServerData.getAdminKnowledgeCorpora).mockRejectedValueOnce(
      new adminServerData.ConsoleBffAuthExpiredError(
        "/api/admin/knowledge/corpora",
      ),
    )

    await expect(
      KnowledgeConsolePage({
        searchParams: Promise.resolve({}),
      }),
    ).rejects.toThrow("redirect:/auth/keycloak?redirectTo=%2Fknowledge")
    expect(navigationMocks.redirect).toHaveBeenCalledWith(
      "/auth/keycloak?redirectTo=%2Fknowledge",
    )
  })

  it("renders the redesigned Console hardware overview with seven charts", async () => {
    vi.stubGlobal("EventSource", TestEventSource)
    const page = await ConsoleV2TestPage({
      params: Promise.resolve({ section: ["hardware"] }),
      searchParams: Promise.resolve({ range: "6h" }),
    })

    render(page)

    expect(screen.getByRole("heading", { name: "Hardware" })).toBeTruthy()
    expect(
      screen.getByText(
        "Seven operational signals pulled through the Console BFF from the same Prometheus metrics used by Grafana.",
      ),
    ).toBeTruthy()
    for (const chart of [
      "CPU utilization",
      "GPU temperature",
      "GPU utilization",
      "RAM usage",
      "Filesystem usage",
      "Power draw",
      "Network throughput",
    ]) {
      expect(screen.getByRole("heading", { name: chart })).toBeTruthy()
      expect(
        screen.getByRole("figure", { name: `${chart} chart` }),
      ).toBeTruthy()
    }
    expect(screen.getByRole("link", { name: "Open Grafana" })).toBeTruthy()
    expect(screen.queryByLabelText("Host")).toBeNull()
    expect(screen.queryByRole("heading", { name: "Alerts" })).toBeNull()
    expect(screen.getAllByText("PromQL")).toHaveLength(7)
  })

  it("does not reserve filesystem chart height for rows that round to zero percent", () => {
    const filesystemHardware: AdminHardwareResponse = {
      activeAlerts: [],
      alertmanagerUrl: null,
      availableHosts: ["core-appliance"],
      charts: [
        {
          chartType: "bar",
          description: "Latest filesystem use by host and mountpoint.",
          emptyMessage: "No filesystem capacity metrics are available.",
          grafanaUrl: null,
          id: "filesystem_usage",
          promql: "up",
          series: [
            ...Array.from({ length: 20 }, (_, index) => ({
              device: `/zero-${index}`,
              direction: null,
              host: "core-appliance",
              id: `filesystem-zero-${index}`,
              label: `core-appliance / /zero-${index}`,
              metricSource: "node_exporter",
              points: [
                {
                  timestamp: "2026-06-02T11:00:00.000Z",
                  value: 0.2,
                },
              ],
            })),
            {
              device: "/",
              direction: null,
              host: "core-appliance",
              id: "filesystem-active",
              label: "core-appliance / /",
              metricSource: "node_exporter",
              points: [
                {
                  timestamp: "2026-06-02T11:00:00.000Z",
                  value: 57,
                },
              ],
            },
          ],
          sourceStatus: "ok",
          thresholds: [
            { label: "High", severity: "warning", unit: "percent", value: 85 },
            {
              label: "Critical",
              severity: "critical",
              unit: "percent",
              value: 95,
            },
          ],
          title: "Filesystem usage",
          unit: "percent",
        },
      ],
      generatedAt: "2026-06-02T11:00:00.000Z",
      grafanaUrl: null,
      range: "6h",
      selectedHost: "all",
      sourceStatus: "ok",
      step: "180s",
      summary: "Prometheus is returning filesystem metrics.",
    }

    render(<HardwareV2Experience hardware={filesystemHardware} />)

    const chart = screen.getByRole("figure", {
      name: "Filesystem usage chart",
    }) as HTMLElement
    expect(chart.style.height).toBe("224px")
  })

  it("renders Console V2 Settings with the scoped settings sections only", async () => {
    vi.stubGlobal("EventSource", TestEventSource)
    const page = await ConsoleV2TestPage({
      params: Promise.resolve({ section: ["settings"] }),
      searchParams: Promise.resolve({
        settingsAction: "organizationSaved",
      }),
    })

    const { container } = render(page)

    const navigation = screen.getByRole("navigation", {
      name: "Console v2 navigation",
    })
    expect(
      within(navigation)
        .getByRole("link", { name: "Settings" })
        .getAttribute("aria-current"),
    ).toBe("page")
    for (const heading of [
      "Settings",
      "Organization",
      "System Status",
      "Updates & License",
      "Privacy",
    ]) {
      expect(screen.getByRole("heading", { name: heading })).toBeTruthy()
    }
    expect(screen.getByText("Organization settings saved.")).toBeTruthy()
    for (const forbidden of [
      /SSO/i,
      /password/i,
      /Keycloak setup/i,
      /editable stack URL/i,
      /\bDNS\b/i,
      /model update/i,
      /core-appliance update/i,
    ]) {
      expect(screen.queryByText(forbidden)).toBeNull()
    }

    const nameInput = screen.getByLabelText("Organization name")
    const saveButton = screen.getByRole("button", { name: "Save changes" })
    expect(screen.getByLabelText("Default language")).toBeTruthy()
    expect(screen.getByLabelText("Full logo")).toBeTruthy()
    expect(screen.getByLabelText("Icon logo")).toBeTruthy()
    expect(
      screen.getByRole("button", { name: "Choose full logo" }),
    ).toBeTruthy()
    expect(
      screen.getByRole("button", { name: "Choose icon logo" }),
    ).toBeTruthy()
    expect(saveButton).toHaveProperty("disabled", true)

    fireEvent.change(nameInput, {
      target: { value: "Client Appliance" },
    })
    expect(saveButton).toHaveProperty("disabled", false)

    fireEvent.change(screen.getByLabelText("Full logo"), {
      target: {
        files: [
          new File(["not an image"], "brand.svg", { type: "image/svg+xml" }),
        ],
      },
    })
    expect(screen.getByText("Logo must be PNG or JPEG.")).toBeTruthy()
    expect(saveButton).toHaveProperty("disabled", true)

    expect(
      screen.getByRole("table", { name: "Internal service reachability" }),
    ).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Refresh check" })).toBeNull()
    expect(
      screen.getByRole("button", { name: "System update unavailable" }),
    ).toHaveProperty("disabled", true)
    expect(screen.getByText("Telemetry payload preview")).toBeTruthy()
    expect(screen.getByText("Off")).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Enable telemetry" }))
    expect(screen.getByRole("dialog", { name: "Enable telemetry?" }))
    expect(
      screen.getByLabelText("Type ENABLE TELEMETRY to confirm"),
    ).toBeTruthy()

    const results = await axe(container)
    expect(results.violations).toEqual([])
  })

  it("keeps model update ownership only on the Inference page", async () => {
    vi.stubGlobal("EventSource", TestEventSource)
    for (const section of ["applications", "settings", "team"] as const) {
      const page = await ConsoleV2TestPage({
        params: Promise.resolve({ section: [section] }),
      })
      const { unmount } = render(page)

      expect(
        screen.getByRole("heading", { name: titleCase(section) }),
      ).toBeTruthy()
      expect(screen.queryByRole("button", { name: "Apply update" })).toBeNull()
      expect(
        screen.queryByRole("region", { name: "Model update available" }),
      ).toBeNull()

      unmount()
    }
  })

  it("renders Console V2 Settings organization logos as editable assets", () => {
    const settingsWithLogos = {
      ...coreAdminSettings,
      organization: {
        ...coreAdminSettings.organization,
        fullLogo: {
          checksum:
            "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          dataUrl:
            "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p94AAAAASUVORK5CYII=",
          fileName: "brand-full.png",
          height: 320,
          mimeType: "image/png",
          sizeBytes: 42_000,
          updatedAt: "2026-05-29T12:00:00.000Z",
          width: 1200,
        },
        iconLogo: {
          checksum:
            "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          dataUrl:
            "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p94AAAAASUVORK5CYII=",
          fileName: "brand-icon.png",
          height: 512,
          mimeType: "image/png",
          sizeBytes: 12_000,
          updatedAt: "2026-05-29T12:00:00.000Z",
          width: 512,
        },
      },
    } satisfies CoreAdminSettingsResponse

    const { container } = render(
      <SettingsV2Experience settings={settingsWithLogos} />,
    )

    expect(screen.getAllByText("Current")).toHaveLength(2)
    expect(screen.getByText("brand-full.png")).toBeTruthy()
    expect(screen.getByText("1200 x 320")).toBeTruthy()
    expect(
      screen.getByRole("button", { name: "Replace full logo" }),
    ).toBeTruthy()
    expect(
      screen.getByRole("button", { name: "Remove full logo" }),
    ).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Remove full logo" }))

    expect(screen.getByText("Removal pending")).toBeTruthy()
    expect(
      screen.getByRole("button", { name: "Undo full logo removal" }),
    ).toBeTruthy()
    expect(
      container.querySelector<HTMLInputElement>('input[name="clearFullLogo"]')
        ?.checked,
    ).toBe(true)
  })

  it("renders the redesigned Console new-corpus view from query state", async () => {
    vi.stubGlobal("EventSource", TestEventSource)
    const page = await ConsoleV2TestPage({
      params: Promise.resolve({ section: [] }),
      searchParams: Promise.resolve({ view: "new" }),
    })

    render(page)

    expect(screen.getByLabelText("Name")).toBeTruthy()
    expect(screen.getByLabelText("Description")).toBeTruthy()
    expect(screen.getByLabelText("Permissions")).toBeTruthy()
    expect(
      screen.getByRole("button", { name: "Create corpora" }),
    ).toHaveProperty("disabled", false)
    expect(
      screen.getByRole("link", { name: "Cancel" }).getAttribute("href"),
    ).toBe("/knowledge?corpus=11111111-1111-4111-8111-111111111111")
  })

  it("selects the redesigned Console corpus from the corpus query param", async () => {
    vi.stubGlobal("EventSource", TestEventSource)
    const page = await ConsoleV2TestPage({
      params: Promise.resolve({ section: [] }),
      searchParams: Promise.resolve({
        corpus: "33333333-3333-4333-8333-333333333333",
      }),
    })

    render(page)

    expect(
      screen
        .getByRole("link", { name: /Security Runbooks/i })
        .getAttribute("aria-current"),
    ).toBe("page")
    const permissions = screen.getByLabelText(
      "Corpus permissions",
    ) as HTMLSelectElement
    expect(permissions.value).toBe("Everyone")
    expect(
      Array.from(permissions.options).map((option) => option.value),
    ).toEqual(["Everyone"])
  })

  it("renders redesigned Console add-sources from server-backed source detail", async () => {
    vi.stubGlobal("EventSource", TestEventSource)
    const page = await ConsoleV2TestPage({
      params: Promise.resolve({ section: [] }),
      searchParams: Promise.resolve({
        corpus: "11111111-1111-4111-8111-111111111111",
        view: "add-sources",
      }),
    })

    render(page)

    expect(screen.getByText("Drop files here")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Select files" })).toBeTruthy()
    expect(screen.getByText("Uploaded content")).toBeTruthy()
    expect(screen.getByText("Croatian employee handbook")).toBeTruthy()
    expect(screen.getByText("English safety PDF")).toBeTruthy()
    expect(screen.getByText("Signed approval image")).toBeTruthy()
    expect(
      screen.getByRole("link", { name: "Go back" }).getAttribute("href"),
    ).toBe("/knowledge?corpus=11111111-1111-4111-8111-111111111111")
    expect(screen.queryByText("Benefits policy notes")).toBeNull()
    expect(screen.queryByText("Policy portal snapshot")).toBeNull()
  })

  it("shows failed upload status details and retry controls in the source table", () => {
    const corpus: KnowledgeCorpus = {
      accessGroups: ["Everyone"],
      chunkCount: 0,
      createdAt: "2026-06-05T18:00:00.000Z",
      createdBy: "admin-1",
      description: "Retry status fixture.",
      id: "abababab-abab-4aba-8bab-abababababab",
      languageHints: ["en"],
      name: "Retry fixture",
      publishedSnapshotId: null,
      sourceCount: 1,
      status: "draft",
      updatedAt: "2026-06-05T18:00:00.000Z",
      updatedBy: "admin-1",
    }
    const detail: KnowledgeCorpusDetailResponse = {
      corpus,
      jobs: [],
      snapshots: [],
      sources: [
        {
          canonicalUri: null,
          checksum: "sha256:failed-url",
          corpusId: corpus.id,
          createdAt: "2026-06-05T18:00:00.000Z",
          createdBy: "admin-1",
          errorDetail: "URL content type application/pdf is not supported.",
          finalUri: "https://docs.example.test/failed-url",
          id: "cdcdcdcd-cdcd-4cdc-8dcd-cdcdcdcdcdcd",
          language: null,
          metadata: {
            acquisition: {
              adapter: "safe_fetch",
              status: "failed",
            },
          },
          mimeType: "text/html",
          originalUri: "https://docs.example.test/failed-url",
          sourceType: "url",
          status: "failed",
          title: "Failed URL source",
          updatedAt: "2026-06-05T18:01:00.000Z",
        },
      ],
    }

    const { container } = rtlRender(
      <KnowledgeV2Experience
        corpora={[corpus]}
        detail={detail}
        selectedCorpusId={corpus.id}
        view="add-sources"
      />,
    )

    expect(screen.getByText("Failed URL source")).toBeTruthy()
    expect(screen.getByText("Failed")).toBeTruthy()
    expect(
      screen.getByText("URL content type application/pdf is not supported."),
    ).toBeTruthy()
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy()
    expect(
      container.querySelector(
        'input[name="sourceId"][value="cdcdcdcd-cdcd-4cdc-8dcd-cdcdcdcdcdcd"]',
      ),
    ).toBeTruthy()
  })

  it("keeps staged failed sources out of the ingestion-complete state", () => {
    const corpus: KnowledgeCorpus = {
      accessGroups: ["Everyone"],
      chunkCount: 0,
      createdAt: "2026-06-05T18:00:00.000Z",
      createdBy: "admin-1",
      description: "Failed staged corpus.",
      id: "abababab-abab-4aba-8bab-abababababab",
      languageHints: ["en"],
      name: "Failed staged fixture",
      publishedSnapshotId: null,
      sourceCount: 1,
      status: "staged",
      updatedAt: "2026-06-05T18:00:00.000Z",
      updatedBy: "admin-1",
    }
    const detail: KnowledgeCorpusDetailResponse = {
      corpus,
      jobs: [],
      snapshots: [
        {
          chunkCount: 0,
          corpusId: corpus.id,
          createdAt: "2026-06-05T18:01:00.000Z",
          id: "edededed-eded-4ede-8ded-edededededed",
          metadata: {
            failedSourceCount: 1,
          },
          publishedAt: null,
          publishedBy: null,
          sourceCount: 1,
          status: "staged",
          version: 1,
        },
      ],
      sources: [
        knowledgeSourceFixture({
          checksum: "sha256:failed-pdf",
          corpusId: corpus.id,
          errorDetail: "Knowledge PDF parser extraction timed out.",
          id: "cdcdcdcd-cdcd-4cdc-8dcd-cdcdcdcdcdcd",
          mimeType: "application/pdf",
          originalUri: "file://asml-report.pdf",
          sourceType: "file",
          status: "failed",
          title: "ASML annual report",
        }),
      ],
    }

    render(
      <KnowledgeV2Experience
        corpora={[corpus]}
        detail={detail}
        knowledgeAction="ingestFailed"
        selectedCorpusId={corpus.id}
        view="add-sources"
      />,
    )

    expect(
      screen.getByText("Ingestion failed. Review failed sources below."),
    ).toBeTruthy()
    expect(
      screen.getByText("Knowledge PDF parser extraction timed out."),
    ).toBeTruthy()
    expect(screen.queryByText("Ingestion complete")).toBeNull()
    expect(
      screen.getByRole("button", { name: "Ingestion failed" }),
    ).toHaveProperty("disabled", true)
  })

  it("shows partial ingestion as a warning notification", () => {
    const corpus: KnowledgeCorpus = {
      accessGroups: ["Everyone"],
      chunkCount: 8,
      createdAt: "2026-06-05T18:00:00.000Z",
      createdBy: "admin-1",
      description: "Partial ingest corpus.",
      id: "abababab-abab-4aba-8bab-abababababab",
      languageHints: ["en"],
      name: "Partial ingest fixture",
      publishedSnapshotId: null,
      sourceCount: 2,
      status: "staged",
      updatedAt: "2026-06-05T18:00:00.000Z",
      updatedBy: "admin-1",
    }
    const detail: KnowledgeCorpusDetailResponse = {
      corpus,
      jobs: [],
      snapshots: [],
      sources: [
        knowledgeSourceFixture({
          checksum: "sha256:ready-doc",
          corpusId: corpus.id,
          id: "11111111-2222-4333-8444-555555555555",
          language: "en",
          status: "ready",
          title: "Ready source",
        }),
        knowledgeSourceFixture({
          checksum: "sha256:failed-doc",
          corpusId: corpus.id,
          errorDetail: "Parser failed.",
          id: "66666666-7777-4888-8999-aaaaaaaaaaaa",
          status: "failed",
          title: "Failed source",
        }),
      ],
    }

    render(
      <KnowledgeV2Experience
        corpora={[corpus]}
        detail={detail}
        knowledgeAction="partialIngested"
        selectedCorpusId={corpus.id}
        view="add-sources"
      />,
    )

    expect(
      screen.getByText(
        "Ingestion completed with failed sources. Review failed items below.",
      ),
    ).toBeTruthy()
  })

  it("shows pending updates and enables update ingestion for ingested corpora", () => {
    const corpus: KnowledgeCorpus = {
      accessGroups: ["Everyone"],
      chunkCount: 12,
      createdAt: "2026-06-05T18:00:00.000Z",
      createdBy: "admin-1",
      description: "Published corpus with a new source.",
      id: "abababab-abab-4aba-8bab-abababababab",
      languageHints: ["en"],
      name: "Published fixture",
      publishedSnapshotId: "edededed-eded-4ede-8ded-edededededed",
      sourceCount: 2,
      status: "published",
      updatedAt: "2026-06-05T18:00:00.000Z",
      updatedBy: "admin-1",
    }
    const detail: KnowledgeCorpusDetailResponse = {
      corpus,
      jobs: [],
      snapshots: [],
      sources: [
        knowledgeSourceFixture({
          checksum: "sha256:pending-update",
          corpusId: corpus.id,
          finalUri: "https://docs.example.test/ussd",
          id: "11111111-2222-4333-8444-555555555555",
          mimeType: "text/html",
          originalUri: "https://docs.example.test/ussd",
          sourceType: "url",
          status: "pending",
          title: "USSD",
        }),
        knowledgeSourceFixture({
          checksum: "sha256:ready-docs",
          corpusId: corpus.id,
          finalUri: "https://docs.example.test/docs",
          id: "66666666-7777-4888-8999-aaaaaaaaaaaa",
          language: "en",
          metadata: {
            extraction: {
              parser_report: {
                qualityWarnings: [],
                selectedParser: "trafilatura_html",
              },
            },
          },
          mimeType: "text/html",
          originalUri: "https://docs.example.test/docs",
          sourceType: "url",
          status: "ready",
          title: "Documentation",
        }),
      ],
    }

    const { container } = render(
      <KnowledgeV2Experience
        corpora={[corpus]}
        detail={detail}
        selectedCorpusId={corpus.id}
        view="add-sources"
      />,
    )

    expect(screen.getByText("USSD")).toBeTruthy()
    expect(screen.getByText("Pending update")).toBeTruthy()
    expect(screen.getByText("Run ingestion to stage this source")).toBeTruthy()
    expect(screen.queryByText("Waiting for ingestion")).toBeNull()
    expect(screen.queryByText("Ingestion complete")).toBeNull()
    const ingestButton = screen.getByRole("button", { name: "Ingest updates" })
    const ingestIndicator = screen.getByTestId("ingest-ready-indicator")
    expect(ingestButton).toHaveProperty("disabled", false)
    expect(ingestIndicator.nextElementSibling).toBe(ingestButton)
    expect(String(ingestIndicator.parentElement?.className)).toContain("gap-2")
    expect(screen.queryByRole("img", { name: "Ingestion warning" })).toBeNull()

    fireEvent.submit(screen.getByTestId("knowledge-ingest-form"))

    expect(screen.getByRole("button", { name: "Ingesting" })).toHaveProperty(
      "disabled",
      true,
    )
    expect(screen.getAllByText("Ingesting").length).toBeGreaterThan(0)
    expect(screen.getByText("Ingestion running")).toBeTruthy()
    expect(
      container.querySelector('[aria-label="Ingesting"].animate-spin'),
    ).toBeTruthy()
    expect(screen.queryByTestId("ingest-ready-indicator")).toBeNull()
  })

  it("lets admins select and delete uploaded content rows before ingestion", () => {
    const corpus: KnowledgeCorpus = {
      accessGroups: ["Everyone"],
      chunkCount: 0,
      createdAt: "2026-06-05T18:00:00.000Z",
      createdBy: "admin-1",
      description: "Draft corpus with an uploaded source.",
      id: "abababab-abab-4aba-8bab-abababababab",
      languageHints: ["en"],
      name: "Draft fixture",
      publishedSnapshotId: null,
      sourceCount: 1,
      status: "draft",
      updatedAt: "2026-06-05T18:00:00.000Z",
      updatedBy: "admin-1",
    }
    const sourceId = "11111111-2222-4333-8444-555555555555"
    const detail: KnowledgeCorpusDetailResponse = {
      corpus,
      jobs: [],
      snapshots: [],
      sources: [
        knowledgeSourceFixture({
          checksum: "sha256:uploaded-policy",
          corpusId: corpus.id,
          id: sourceId,
          mimeType: "application/pdf",
          originalUri: "uploaded-policy.pdf",
          sourceType: "file",
          status: "pending",
          title: "Uploaded policy PDF",
        }),
      ],
    }

    const { container } = render(
      <KnowledgeV2Experience
        corpora={[corpus]}
        detail={detail}
        selectedCorpusId={corpus.id}
        view="add-sources"
      />,
    )

    expect(screen.getByRole("button", { name: "Select" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Select" }))

    expect(screen.getByRole("button", { name: "Deselect" })).toBeTruthy()
    expect(screen.getByLabelText("Select all source rows")).toBeTruthy()

    fireEvent.click(screen.getByLabelText("Select Uploaded policy PDF"))

    expect(screen.getByRole("button", { name: "Delete" })).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Delete" }))

    expect(screen.getByText("Delete selected sources?")).toBeTruthy()
    expect(
      container.querySelector(
        'input[name="sourceAction"][value="hard_delete"]',
      ),
    ).toBeTruthy()
    expect(
      container.querySelector(`input[name="sourceIds"][value="${sourceId}"]`),
    ).toBeTruthy()
    expect(
      container.querySelector(
        'input[name="returnTo"][value="/knowledge?corpus=abababab-abab-4aba-8bab-abababababab&view=add-sources"]',
      ),
    ).toBeTruthy()
  })

  it("shows a loader while URL acquisition is running", () => {
    const corpus: KnowledgeCorpus = {
      accessGroups: ["Everyone"],
      chunkCount: 0,
      createdAt: "2026-06-05T18:00:00.000Z",
      createdBy: "admin-1",
      description: "Fetching URL fixture.",
      id: "abababab-abab-4aba-8bab-abababababab",
      languageHints: ["en"],
      name: "Fetching fixture",
      publishedSnapshotId: null,
      sourceCount: 1,
      status: "draft",
      updatedAt: "2026-06-05T18:00:00.000Z",
      updatedBy: "admin-1",
    }
    const detail: KnowledgeCorpusDetailResponse = {
      corpus,
      jobs: [],
      snapshots: [],
      sources: [
        knowledgeSourceFixture({
          checksum: "sha256:fetching-url",
          corpusId: corpus.id,
          finalUri: null,
          id: "11111111-2222-4333-8444-555555555555",
          mimeType: "text/html",
          originalUri: "https://docs.example.test/running",
          sourceType: "url",
          status: "fetching",
          title: "Running URL source",
        }),
      ],
    }

    const { container } = render(
      <KnowledgeV2Experience
        corpora={[corpus]}
        detail={detail}
        selectedCorpusId={corpus.id}
        view="add-sources"
      />,
    )

    expect(screen.getByText("Running URL source")).toBeTruthy()
    expect(screen.getByText("Uploading")).toBeTruthy()
    expect(screen.getByText("Fetching URL content")).toBeTruthy()
    expect(
      screen.getByRole("button", { name: "Upload in progress" }),
    ).toHaveProperty("disabled", true)
    expect(
      container.querySelector('[aria-label="Uploading"].animate-spin'),
    ).toBeTruthy()
    expect(screen.queryByTestId("ingest-ready-indicator")).toBeNull()
    expect(screen.queryByRole("img", { name: "Ingestion warning" })).toBeNull()
  })

  it("renders redesigned Console edit sources from published server inventory", async () => {
    vi.stubGlobal("EventSource", TestEventSource)
    const page = await ConsoleV2TestPage({
      params: Promise.resolve({ section: [] }),
      searchParams: Promise.resolve({
        corpus: "11111111-1111-4111-8111-111111111111",
        view: "edit-sources",
      }),
    })

    render(page)

    expect(screen.getByRole("heading", { name: "HR Policies" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Select" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Disable" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull()
    expect(screen.getByText("Croatian employee handbook")).toBeTruthy()
    expect(screen.getByText("English safety PDF")).toBeTruthy()
    expect(screen.getByText("Policy ownership table")).toBeTruthy()
    expect(screen.getByText("Signed approval image")).toBeTruthy()
    expect(screen.getByText("Disabled legacy procedure")).toBeTruthy()
    expect(screen.getByLabelText("Disabled")).toBeTruthy()
    expect(
      screen.queryByRole("link", { name: "Croatian employee handbook" }),
    ).toBeNull()
    expect(screen.queryByText("Benefits policy notes")).toBeNull()
    expect(screen.queryByText("Legacy safety PDF")).toBeNull()
    expect(screen.queryByText("Policy portal snapshot")).toBeNull()
  })

  it("renders redesigned Console snapshots page as a table", async () => {
    vi.stubGlobal("EventSource", TestEventSource)
    const page = await ConsoleV2TestPage({
      params: Promise.resolve({ section: [] }),
      searchParams: Promise.resolve({
        corpus: "33333333-3333-4333-8333-333333333333",
        view: "snapshots",
      }),
    })

    render(page)

    expect(
      screen.getByRole("heading", { name: "Knowledge > Snapshots" }),
    ).toBeTruthy()
    expect(screen.getByRole("heading", { name: "Snapshots" })).toBeTruthy()
    expect(screen.getByText("Corpora")).toBeTruthy()
    expect(screen.getByText("Sources")).toBeTruthy()
    expect(screen.getByText("date/time")).toBeTruthy()
    expect(screen.getByText("Security Runbooks")).toBeTruthy()
    expect(screen.getByText("3")).toBeTruthy()
    expect(screen.getByText(/May 27, 2026/)).toBeTruthy()
  })

  it("omits the redesigned Console runtime-query surface", async () => {
    vi.stubGlobal("EventSource", TestEventSource)
    const page = await ConsoleV2TestPage({
      params: Promise.resolve({ section: [] }),
      searchParams: Promise.resolve({
        corpus: "11111111-1111-4111-8111-111111111111",
      }),
    })

    render(page)

    expect(
      screen.queryByRole("heading", { name: removedKnowledgeSearchHeading }),
    ).toBeNull()
    expect(screen.queryByLabelText(removedKnowledgeQueryLabel)).toBeNull()
    expect(screen.queryByLabelText(removedKnowledgeResultsLabel)).toBeNull()
    expect(screen.queryByTestId("publish-ready-indicator")).toBeNull()
  })

  it("wires redesigned Console source selection to lifecycle forms", async () => {
    vi.stubGlobal("EventSource", TestEventSource)
    const page = await ConsoleV2TestPage({
      params: Promise.resolve({ section: [] }),
      searchParams: Promise.resolve({
        corpus: "11111111-1111-4111-8111-111111111111",
        view: "edit-sources",
      }),
    })

    const { container } = render(page)

    fireEvent.click(screen.getByRole("button", { name: "Select" }))
    expect(screen.getByLabelText("Select all source rows")).toBeTruthy()
    fireEvent.click(screen.getByLabelText("Select Croatian employee handbook"))
    expect(screen.getByRole("button", { name: "Disable" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Archive" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Delete" })).toBeTruthy()
    expect(
      container.querySelector('input[name="sourceAction"][value="disable"]'),
    ).toBeTruthy()
    expect(
      container.querySelector('input[name="sourceAction"][value="archive"]'),
    ).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Delete" }))
    expect(screen.getByText("Delete selected sources?")).toBeTruthy()
    expect(screen.getByLabelText("Type DELETE to confirm")).toBeTruthy()
    expect(
      container.querySelector(
        'input[name="sourceAction"][value="hard_delete"]',
      ),
    ).toBeTruthy()
    expect(
      container.querySelector(
        'input[name="returnTo"][value="/knowledge?corpus=11111111-1111-4111-8111-111111111111&view=edit-sources"]',
      ),
    ).toBeTruthy()
  })

  it("renders the redesigned Console archive view with restore and hard delete actions", async () => {
    vi.stubGlobal("EventSource", TestEventSource)
    const page = await ConsoleV2TestPage({
      params: Promise.resolve({ section: [] }),
      searchParams: Promise.resolve({
        view: "archive",
      }),
    })

    const { container } = render(page)

    expect(
      screen.getByRole("heading", { name: "Knowledge > Archive" }),
    ).toBeTruthy()
    expect(screen.getByText("Archive")).toBeTruthy()
    expect(
      screen.getByRole("heading", { name: "Archived sources" }),
    ).toBeTruthy()
    expect(screen.getByText("Archived onboarding handbook.pdf")).toBeTruthy()
    expect(screen.queryByLabelText("Corpora carousel")).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Select" }))
    expect(screen.getByRole("button", { name: "Unselect" })).toBeTruthy()
    expect(
      screen.getByLabelText("Select all archived source rows"),
    ).toBeTruthy()
    fireEvent.click(
      screen.getByLabelText("Select archived Archived onboarding handbook.pdf"),
    )
    expect(screen.getByRole("button", { name: /Restore/ })).toBeTruthy()
    expect(screen.getByRole("button", { name: /Delete/ })).toBeTruthy()
    expect(
      container.querySelector('input[name="sourceAction"][value="restore"]'),
    ).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: /Delete/ }))
    expect(screen.getByText("Delete archived sources?")).toBeTruthy()
    expect(screen.getByLabelText("Type DELETE to confirm")).toBeTruthy()
    expect(
      container.querySelector(
        'input[name="sourceAction"][value="hard_delete"]',
      ),
    ).toBeTruthy()
    expect(
      container.querySelector(
        'input[name="returnTo"][value="/knowledge?view=archive"]',
      ),
    ).toBeTruthy()
  })

  it("renders the redesigned Console archive view when no active corpora exist", () => {
    render(
      <KnowledgeV2Experience
        archivedSources={[
          {
            id: "abababab-abab-4aba-8bab-abababababab",
            sourceId: "cdcdcdcd-cdcd-4cdc-8dcd-cdcdcdcdcdcd",
            corpusId: "13131313-1313-4131-8131-131313131313",
            corpusName: "Archived Legacy Policies",
            sourceType: "file",
            title: "Archived-only handbook.pdf",
            originalUri: "archived-only-handbook.pdf",
            finalUri: null,
            canonicalUri: null,
            mimeType: "application/pdf",
            checksum: "sha256:archived-only",
            status: "ready",
            language: "en",
            metadata: { warnings: [] },
            errorDetail: null,
            createdBy: "admin-1",
            createdAt: "2026-05-27T07:30:00.000Z",
            updatedAt: "2026-05-27T08:45:00.000Z",
            archivedBy: "admin-1",
            archivedAt: "2026-05-27T10:45:00.000Z",
          },
        ]}
        corpora={[]}
        detail={null}
        view="archive"
      />,
    )

    expect(
      screen.getByRole("heading", { name: "Knowledge > Archive" }),
    ).toBeTruthy()
    expect(screen.getByText("Archived-only handbook.pdf")).toBeTruthy()
    expect(screen.queryByText("No active corpora exist yet.")).toBeNull()
  })

  it("renders a redesigned Console empty state when no active corpora exist", () => {
    render(<KnowledgeV2Experience corpora={[]} detail={null} view="overview" />)

    expect(screen.getByText("No active corpora exist yet.")).toBeTruthy()
    expect(screen.queryByText("Corpus name 02")).toBeNull()
  })

  it("renders the new-corpus form when no active corpora exist", () => {
    const { container } = render(
      <KnowledgeV2Experience corpora={[]} detail={null} view="new" />,
    )

    expect(
      screen.getByRole("heading", { name: "Knowledge > New corpora" }),
    ).toBeTruthy()
    expect(screen.getByLabelText("Name")).toBeTruthy()
    expect(screen.getByLabelText("Description")).toBeTruthy()
    expect(screen.getByLabelText("Permissions")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Create corpora" })).toBeTruthy()
    expect(
      container.querySelector(
        'input[name="returnTo"][value="/knowledge?view=new"]',
      ),
    ).toBeTruthy()
    expect(screen.queryByText("No active corpora exist yet.")).toBeNull()
  })

  it("uses Team groups for Knowledge and Applications permission dropdowns", () => {
    const corpus: KnowledgeCorpus = {
      accessGroups: ["Engineering"],
      chunkCount: 0,
      createdAt: "2026-05-29T12:00:00.000Z",
      createdBy: "admin-1",
      description: "Engineering runbooks.",
      id: "abababab-abab-4aba-8bab-abababababab",
      languageHints: ["en"],
      name: "Engineering Runbooks",
      publishedSnapshotId: null,
      sourceCount: 0,
      status: "draft",
      updatedAt: "2026-05-29T12:00:00.000Z",
      updatedBy: "admin-1",
    }
    const { unmount } = render(
      <KnowledgeV2Experience
        corpora={[corpus]}
        detail={null}
        teamGroups={teamGroupsForPermissions}
        view="new"
      />,
    )
    const knowledgePermissions = screen.getByLabelText(
      "Permissions",
    ) as HTMLSelectElement
    expect(
      Array.from(knowledgePermissions.options).map((option) => option.value),
    ).toEqual(["Everyone", "Engineering", "Operators"])
    expect(screen.queryByRole("option", { name: "HR" })).toBeNull()

    unmount()
    render(
      <ApplicationsV2Experience
        modelOptions={adminInference.models}
        teamGroups={teamGroupsForPermissions}
        view="new-app"
      />,
    )
    const connectedAppOwnerGroup = screen.getByLabelText(
      "Owner group",
    ) as HTMLSelectElement
    expect(
      Array.from(connectedAppOwnerGroup.options).map((option) => option.value),
    ).toEqual(["Everyone", "Engineering", "Operators"])
    expect(screen.getByLabelText("qwen3:32b")).toBeTruthy()
    expect(screen.queryByRole("option", { name: "Finance" })).toBeNull()
  })

  it("renders Console V2 Inference with loader data and current navigation", async () => {
    vi.stubGlobal("EventSource", TestEventSource)
    const page = await ConsoleV2TestPage({
      params: Promise.resolve({ section: ["inference"] }),
      searchParams: Promise.resolve({ range: "90d" }),
    })

    render(page)

    const navigation = screen.getByRole("navigation", {
      name: "Console v2 navigation",
    })

    const heading = screen.getByRole("heading", { name: "Inference" })
    const updateLink = screen.getByRole("link", { name: "Update Available" })

    expect(heading.compareDocumentPosition(updateLink)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
    expect(updateLink.getAttribute("href")).toBe("/inference/update?range=90d")
    expect(screen.queryByRole("navigation", { name: "Breadcrumb" })).toBeNull()
    expect(screen.queryByText("Weekly activity")).toBeNull()
    expect(screen.queryByText("Virtual keys Access and usage")).toBeNull()
    expect(
      screen.getByRole("link", { name: "90d" }).getAttribute("aria-current"),
    ).toBe("page")
    expect(screen.queryByRole("img", { name: "Prompts chart" })).toBeNull()
    expect(screen.queryByRole("img", { name: "Tokens chart" })).toBeNull()
    const signal = screen.getByRole("region", { name: "LiteLLM signal" })
    expect(within(signal).getByText("Prompts")).toBeTruthy()
    expect(within(signal).getByText("Tokens")).toBeTruthy()
    expect(within(signal).getAllByText("90D")).toHaveLength(2)
    expect(within(signal).getAllByText(/average/i)).toHaveLength(2)
    expect(within(signal).queryByText("May 25, 2026, 2:00 PM")).toBeNull()
    expect(
      screen.getByRole("link", { name: /Open LiteLLM/ }).getAttribute("href"),
    ).toBe("https://litellm.example.test/ui/")

    const modelUsage = screen.getByRole("region", {
      name: "Model usage sorted by usage",
    })
    const modelUsageText = modelUsage.textContent ?? ""
    expect(modelUsageText.indexOf("qwen3:32b")).toBeLessThan(
      modelUsageText.indexOf("gemma3:27b"),
    )
    expect(screen.queryByText("Agentic runtime")).toBeNull()
    const virtualKeysToggle = screen.getByRole("button", {
      name: /Virtual keys/,
    })
    expect(virtualKeysToggle.getAttribute("aria-expanded")).toBe("false")
    fireEvent.click(virtualKeysToggle)
    expect(virtualKeysToggle.getAttribute("aria-expanded")).toBe("true")
    expect(screen.getByText("Agentic runtime")).toBeTruthy()
    expect(screen.queryByText(/sk-/)).toBeNull()
    expect(screen.queryByText(/secret/i)).toBeNull()
    expect(screen.queryByText(/health/i)).toBeNull()
    expect(screen.queryByText(/incident/i)).toBeNull()
    expect(
      within(navigation)
        .getByRole("link", { name: "Inference" })
        .getAttribute("aria-current"),
    ).toBe("page")
    expect(
      within(navigation).queryByRole("link", { name: "Knowledge" }),
    ).toBeNull()
  })

  it("hides the Inference model update panel when no update exists", () => {
    render(
      <InferenceV2Experience
        dashboard={{ ...adminInference, modelUpdate: null }}
      />,
    )

    expect(
      screen.queryByRole("region", { name: "Model update available" }),
    ).toBeNull()
    expect(screen.queryByRole("link", { name: "Update Available" })).toBeNull()
    expect(screen.getByRole("heading", { name: "Inference" })).toBeTruthy()
  })

  it("shows the Inference update CTA only for available updates", () => {
    const modelUpdate = adminInference.modelUpdate
    if (!modelUpdate) {
      throw new Error("Inference model update fixture is missing.")
    }

    render(
      <InferenceV2Experience
        dashboard={{
          ...adminInference,
          modelUpdate: {
            ...modelUpdate,
            status: "running",
            updateActionEnabled: false,
          },
        }}
      />,
    )

    expect(
      screen.queryByRole("region", { name: "Model update available" }),
    ).toBeNull()
    expect(screen.queryByRole("link", { name: "Update Available" })).toBeNull()
  })

  it("renders the Inference model update detail page", async () => {
    vi.stubGlobal("EventSource", TestEventSource)
    const page = await ConsoleV2TestPage({
      params: Promise.resolve({ section: ["inference", "update"] }),
      searchParams: Promise.resolve({ range: "90d" }),
    })

    render(page)

    expect(screen.getByRole("heading", { name: "Model update" })).toBeTruthy()
    expect(
      screen.getByRole("link", { name: "Go back" }).getAttribute("href"),
    ).toBe("/inference?range=90d")
    const details = screen.getByRole("region", {
      name: "Model update details",
    })
    expect(within(details).getByText("2026.05.1")).toBeTruthy()
    expect(within(details).getByText("2026.05.3")).toBeTruthy()
    expect(within(details).getByText("qwen3:32b, gemma3:27b")).toBeTruthy()
  })

  it("opens the Inference model update confirmation modal", () => {
    render(
      <InferenceV2Experience dashboard={adminInference} view="model-update" />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Update" }))

    const dialog = screen.getByRole("dialog", { name: "Apply model update" })
    expect(dialog).toBeTruthy()
    expect(
      within(dialog)
        .getByRole("button", { name: "Update" })
        .getAttribute("type"),
    ).toBe("submit")
  })

  it("renders Console V2 Team overview with Keycloak configuration status", async () => {
    vi.stubGlobal("EventSource", TestEventSource)
    const page = await ConsoleV2TestPage({
      params: Promise.resolve({ section: ["team"] }),
    })

    render(page)

    const navigation = screen.getByRole("navigation", {
      name: "Console v2 navigation",
    })
    expect(screen.getByRole("heading", { name: "Team" })).toBeTruthy()
    expect(screen.getByRole("heading", { name: "Members" })).toBeTruthy()
    expect(
      screen.getByRole("heading", {
        name: "Keycloak admin API not configured",
      }),
    ).toBeTruthy()
    expect(
      screen.getByRole("link", { name: "Create user" }).getAttribute("href"),
    ).toBe("/team/members/new")
    expect(
      screen.getByRole("link", { name: "Manage users" }).getAttribute("href"),
    ).toBe("/team/members")
    expect(
      within(navigation)
        .getByRole("link", { name: "Team" })
        .getAttribute("aria-current"),
    ).toBe("page")
  })

  it("renders Team member rows, create form, and member details", () => {
    const overview: CoreAdminTeamOverviewResponse = {
      generatedAt: adminTeamOverview.generatedAt,
      groups: [
        {
          id: "everyone",
          keycloakHref: null,
          memberCount: 0,
          name: "Everyone",
          virtual: true,
        },
        {
          id: "group-engineering",
          keycloakHref: "/keycloak/groups/group-engineering",
          memberCount: 1,
          name: "Engineering",
          virtual: false,
        },
      ],
      members: [
        {
          createdAt: "2026-05-29T12:00:00.000Z",
          displayName: "Ada Lovelace",
          email: "ada@example.test",
          enabled: true,
          groups: ["Engineering"],
          id: "kc-user-1",
          keycloakHref: "/keycloak/users/kc-user-1",
          lastActiveAt: "2026-05-29T12:10:00.000Z",
          role: "operator",
          status: "active",
          username: "ada.lovelace",
        },
      ],
      scim: adminTeamOverview.scim,
      serviceStatus: "ok",
      sourceStatus: "ok",
    }
    const detail = {
      activity: [
        {
          action: "applications.credentials.rotate",
          createdAt: "2026-05-29T12:20:00.000Z",
          href: "#audit-log-deferred",
          id: "audit-1",
          targetId: "app-1",
          targetType: "application",
        },
      ],
      member: overview.members[0],
      usage: {
        mostUsedModel: "llama-3.1",
        prompts: 18,
        sourceStatus: "ok",
        tokens: 8100,
        window: "30d",
      },
    } satisfies CoreAdminTeamMemberDetail
    const engineeringGroup = overview.groups.find(
      (group) => group.id === "group-engineering",
    )
    if (!engineeringGroup) {
      throw new Error("Engineering group fixture is missing.")
    }
    const groupDetail = {
      group: engineeringGroup,
      members: overview.members,
    } satisfies CoreAdminTeamGroupDetail

    const { rerender } = render(
      <TeamV2Experience overview={overview} view="overview" />,
    )
    expect(screen.getByText("Ada Lovelace")).toBeTruthy()
    expect(screen.getByText("ada.lovelace")).toBeTruthy()
    expect(screen.getAllByText("Engineering")).toHaveLength(2)
    expect(
      screen.getByRole("link", { name: "Ada Lovelace" }).getAttribute("href"),
    ).toBe("/team/members/kc-user-1")
    expect(
      screen.getByRole("link", { name: "Import CSV" }).getAttribute("href"),
    ).toBe("/team/import")
    expect(
      screen
        .getByRole("link", { name: /Engineering 1 members/ })
        .getAttribute("href"),
    ).toBe("/team/groups/group-engineering")
    expect(screen.queryByText("Everyone")).toBeNull()
    expect(screen.queryByText("SCIM sync")).toBeNull()

    rerender(<TeamV2Experience overview={overview} view="import" />)
    expect(screen.getByLabelText("CSV file")).toBeTruthy()
    expect(
      screen
        .getByRole("link", { name: "Download template" })
        .getAttribute("href"),
    ).toBe("/team/import/template")
    expect(screen.getByRole("button", { name: "Preview import" })).toBeTruthy()

    rerender(<TeamV2Experience overview={overview} view="new-member" />)
    expect(screen.getByLabelText("Name")).toBeTruthy()
    expect(screen.getByLabelText("Company email")).toBeTruthy()
    expect(screen.getByLabelText("Group")).toBeTruthy()
    expect(screen.queryByLabelText("Username")).toBeNull()
    expect(screen.queryByLabelText("Status")).toBeNull()
    expect(
      within(screen.getByLabelText("Group")).queryByRole("option", {
        name: "Everyone",
      }),
    ).toBeNull()
    expect(
      screen.getByRole("checkbox", {
        name: "Generate non-temporary password",
      }),
    ).toBeTruthy()

    rerender(
      <TeamV2Experience
        detail={detail}
        overview={overview}
        teamAction="passwordResetSent"
        view="member-detail"
      />,
    )
    expect(screen.getByText("Password reset email sent.")).toBeTruthy()
    expect(screen.getByText("Usage summary")).toBeTruthy()
    expect(screen.getByText("8,100")).toBeTruthy()
    expect(screen.getByText("applications.credentials.rotate")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Invite by email" })).toBeTruthy()
    expect(
      screen.getByRole("button", { name: "Reset password email" }),
    ).toBeTruthy()
    expect(
      screen
        .getByRole("link", { name: "Open in Keycloak" })
        .getAttribute("href"),
    ).toBe("/keycloak/users/kc-user-1")
    expect(screen.getByText("Type DELETE to confirm")).toBeTruthy()

    rerender(
      <TeamV2Experience
        overview={overview}
        teamAction="disabled"
        view="manage-users"
      />,
    )
    expect(screen.getByText("Team member disabled.")).toBeTruthy()
    expect(screen.getByRole("heading", { name: "Manage users" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Disable" })).toBeTruthy()
    expect(screen.getByText("Delete")).toBeTruthy()

    rerender(<TeamV2Experience overview={overview} view="new-group" />)
    expect(screen.getByLabelText("Group name")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Create group" })).toBeTruthy()

    rerender(
      <TeamV2Experience
        groupDetail={groupDetail}
        overview={overview}
        teamAction="groupUpdated"
        view="group-detail"
      />,
    )
    expect(screen.getByText("Team group updated.")).toBeTruthy()
    expect(screen.getByText("Group basics")).toBeTruthy()
    expect(screen.getByDisplayValue("Engineering")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Assign selected" })).toBeTruthy()
    expect(
      screen
        .getByRole("link", { name: "Open in Keycloak" })
        .getAttribute("href"),
    ).toBe("/keycloak/groups/group-engineering")

    rerender(
      <TeamV2Experience
        overview={{
          ...overview,
          scim: {
            detail: "Advanced identity settings are managed in Keycloak.",
            keycloakHref: "/keycloak/admin/llm-machines",
            lastSyncAt: null,
            provider: null,
            sourceStatus: "ok",
            status: "configured",
          },
        }}
        view="overview"
      />,
    )
    expect(
      screen
        .getByRole("link", {
          name: "Advanced identity settings are managed in Keycloak",
        })
        .getAttribute("href"),
    ).toBe("/keycloak/admin/llm-machines")
  })

  it("renders Console V2 Applications as connected-app controls only", async () => {
    vi.stubGlobal("EventSource", TestEventSource)
    const page = await ConsoleV2TestPage({
      params: Promise.resolve({ section: ["applications"] }),
    })

    render(page)

    const navigation = screen.getByRole("navigation", {
      name: "Console v2 navigation",
    })
    expect(screen.getByRole("heading", { name: "Applications" })).toBeTruthy()
    expect(screen.getByRole("heading", { name: "Connected apps" })).toBeTruthy()
    expect(screen.getByText("Claims Portal")).toBeTruthy()
    expect(screen.getByText("Support Desk")).toBeTruthy()
    expect(screen.getByText("284K")).toBeTruthy()
    expect(screen.getAllByText("Requests")).toHaveLength(2)
    expect(screen.getAllByText("Tokens")).toHaveLength(2)
    expect(screen.getAllByText("Failures")).toHaveLength(2)
    expect(
      screen.getByRole("link", { name: "Add app" }).getAttribute("href"),
    ).toBe("/applications/apps/new")
    expect(
      within(navigation)
        .getByRole("link", { name: "Applications" })
        .getAttribute("aria-current"),
    ).toBe("page")
  })

  it("renders Console V2 Applications empty connected-app state", () => {
    render(<ApplicationsV2Experience connectedApps={[]} view="overview" />)

    expect(screen.getByRole("heading", { name: "Connected apps" })).toBeTruthy()
    expect(
      screen.getByText(
        "Add the first connected app to issue a dedicated credential.",
      ),
    ).toBeTruthy()
    expect(screen.getByRole("link", { name: "Add app" })).toBeTruthy()
    expect(screen.queryByRole("img")).toBeNull()
  })

  it("renders Console V2 Applications add app credential setup form", async () => {
    vi.stubGlobal("EventSource", TestEventSource)
    const page = await ConsoleV2TestPage({
      params: Promise.resolve({ section: ["applications", "apps", "new"] }),
    })

    render(page)

    expect(
      screen.getByRole("heading", { name: "Applications > Add app" }),
    ).toBeTruthy()
    expect(
      screen.getByRole("link", { name: "Go back" }).getAttribute("href"),
    ).toBe("/applications")
    expect(screen.getByLabelText("Name")).toBeTruthy()
    expect(screen.getByLabelText("Description")).toBeTruthy()
    expect(screen.getByText("Authentication")).toBeTruthy()
    expect(
      screen
        .getByRole("button", { name: "API key" })
        .getAttribute("aria-pressed"),
    ).toBe("true")
    expect(screen.getByRole("button", { name: "OAuth" })).toBeTruthy()
    expect(screen.getByLabelText("Owner group")).toBeTruthy()
    expect(screen.getByText("Allowed models")).toBeTruthy()
    expect(screen.getByLabelText("qwen3:32b")).toHaveProperty("checked", true)
    expect(screen.getByLabelText("gemma3:27b")).toBeTruthy()
    expect(screen.getByLabelText("Rate limit per minute")).toHaveProperty(
      "value",
      "",
    )
    expect(screen.getByLabelText("Rate limit per minute")).toHaveProperty(
      "placeholder",
      "Disabled",
    )
    expect(screen.getByLabelText("Seven-day token limit")).toHaveProperty(
      "value",
      "",
    )
    expect(screen.getByLabelText("Seven-day token limit")).toHaveProperty(
      "placeholder",
      "Disabled",
    )
    expect(screen.getByRole("button", { name: "Create app" })).toBeTruthy()
    expect(screen.queryByText("shown-once-secret")).toBeNull()
    expect(screen.queryByText("Client secret")).toBeNull()
  })

  it("renders connected app detail without one-time secrets", async () => {
    vi.stubGlobal("EventSource", TestEventSource)
    const page = await ConsoleV2TestPage({
      params: Promise.resolve({
        section: ["applications", "apps", "connected-app-claims-portal"],
      }),
    })

    render(page)

    expect(
      screen.getByRole("heading", { name: "Applications > Claims Portal" }),
    ).toBeTruthy()
    expect(screen.getByText("Owner group")).toBeTruthy()
    expect(screen.getByText("Allowed models")).toBeTruthy()
    expect(screen.getByText("Credential age")).toBeTruthy()
    expect(screen.getByText("Connection status")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Test connection" })).toBeTruthy()
    expect(
      screen.getByRole("button", { name: "Rotate credentials" }),
    ).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Disable app" }))
    expect(
      screen.getByRole("dialog", { name: "Disable this app?" }),
    ).toBeTruthy()
    expect(screen.getByRole("button", { name: "Disable" })).toBeTruthy()
    expect(screen.queryByText("Client secret")).toBeNull()
    expect(screen.queryByText(/secret/i)).toBeNull()
  })

  it("keeps legacy Admin Knowledge isolated from retained navigation", async () => {
    vi.stubGlobal("EventSource", TestEventSource)
    const page = await KnowledgeConsolePage({
      searchParams: Promise.resolve({}),
    })

    render(page)

    const navigation = screen.getByRole("navigation", {
      name: "Console v2 navigation",
    })
    expect(
      within(navigation).queryByRole("link", { name: "Knowledge" }),
    ).toBeNull()
    expect(screen.getByRole("heading", { name: "Knowledge" })).toBeTruthy()
    expect(screen.getAllByText("HR Policies").length).toBeGreaterThan(0)
    expect(screen.queryByText("Archived Legacy Policies")).toBeNull()
    expect(
      screen.queryByRole("heading", { name: "Governed corpora" }),
    ).toBeNull()
    expect(screen.queryByText("Runtime corpus inventory")).toBeNull()
    expect(
      screen
        .getAllByRole("link")
        .some(
          (link) => link.getAttribute("href") === "/knowledge?view=archive",
        ),
    ).toBe(true)
  })

  it("keeps Admin Knowledge source lifecycle redirects on the cutover route", async () => {
    vi.stubGlobal("EventSource", TestEventSource)
    const page = await KnowledgeConsolePage({
      searchParams: Promise.resolve({
        corpus: "11111111-1111-4111-8111-111111111111",
        view: "edit-sources",
      }),
    })

    const { container } = render(page)

    fireEvent.click(screen.getByRole("button", { name: "Select" }))
    fireEvent.click(screen.getByLabelText("Select Croatian employee handbook"))
    expect(
      container.querySelector(
        'input[name="returnTo"][value="/knowledge?corpus=11111111-1111-4111-8111-111111111111&view=edit-sources"]',
      ),
    ).toBeTruthy()
  })

  it("renders Admin knowledge archive through the redesigned archive view", async () => {
    vi.stubGlobal("EventSource", TestEventSource)
    const page = await KnowledgeConsolePage({
      searchParams: Promise.resolve({
        knowledgeAction: "archiveSourcesRestored",
        view: "archive",
      }),
    })

    render(page)

    expect(
      screen.getByRole("heading", { name: "Knowledge > Archive" }),
    ).toBeTruthy()
    expect(
      screen.getByRole("heading", { name: "Archived sources" }),
    ).toBeTruthy()
    expect(screen.getByText("Archived onboarding handbook.pdf")).toBeTruthy()
    expect(screen.queryByLabelText("Corpora carousel")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Select" }))
    expect(screen.getByRole("button", { name: "Unselect" })).toBeTruthy()
    expect(
      screen.getByLabelText("Select all archived source rows"),
    ).toBeTruthy()
    fireEvent.click(
      screen.getByLabelText("Select archived Archived onboarding handbook.pdf"),
    )
    expect(screen.getByRole("button", { name: /Restore/i })).toBeTruthy()
    expect(screen.getByRole("button", { name: /Delete/i })).toBeTruthy()
    expect(screen.getByText("Archived sources restored.")).toBeTruthy()
  })

  it("omits Admin Knowledge runtime-query controls", async () => {
    vi.stubGlobal("EventSource", TestEventSource)
    const page = await KnowledgeConsolePage({
      searchParams: Promise.resolve({
        corpus: "11111111-1111-4111-8111-111111111111",
      }),
    })

    render(page)

    expect(
      screen.queryByRole("heading", { name: removedKnowledgeSearchHeading }),
    ).toBeNull()
    expect(screen.queryByLabelText(removedKnowledgeQueryLabel)).toBeNull()
    expect(screen.queryByLabelText(removedKnowledgeResultsLabel)).toBeNull()
  })

  it("renders Builder corpus attach UI without Admin intake controls", async () => {
    vi.stubGlobal("EventSource", TestEventSource)
    const page = await BuilderAgentStudioPage({
      params: Promise.resolve({
        id: "66666666-6666-4666-8666-666666666666",
      }),
    })

    render(page)

    expect(
      screen.getByRole("heading", { name: "Approved corpora" }),
    ).toBeTruthy()
    expect(screen.getByText("HR Policies")).toBeTruthy()
    expect(screen.queryByText("Security Runbooks")).toBeNull()
    expect(screen.queryByText("Draft Finance FAQ")).toBeNull()
    expect(screen.queryByText("Add URL source")).toBeNull()
    expect(screen.queryByText("Add documents")).toBeNull()
    expect(screen.queryByText("Start ingestion")).toBeNull()
    expect(screen.queryByText("Publish snapshot")).toBeNull()
    expect(screen.queryByText("Refresh")).toBeNull()
    expect(screen.queryByText("Disable")).toBeNull()
    expect(screen.queryByText("Archive")).toBeNull()
    expect(screen.queryByText("Archive selected")).toBeNull()
    expect(screen.queryByText("Hard delete selected")).toBeNull()
  })
})
