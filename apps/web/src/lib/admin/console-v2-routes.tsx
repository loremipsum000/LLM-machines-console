import {
  ApplicationsV2Experience,
  type ApplicationsView,
} from "@/components/console-v2/applications-v2-experience"
import {
  ConsoleV2Shell,
  type ConsoleV2SectionId,
} from "@/components/console-v2/console-v2-shell"
import { ConsoleUnavailablePanel } from "@/components/console-v2/console-unavailable-panel"
import { HardwareV2Experience } from "@/components/console-v2/hardware-v2-experience"
import {
  InferenceV2Experience,
  type InferenceV2View,
} from "@/components/console-v2/inference-v2-experience"
import {
  KnowledgeV2Experience,
  type KnowledgeView,
} from "@/components/console-v2/knowledge-v2-experience"
import { SettingsV2Experience } from "@/components/console-v2/settings-v2-experience"
import {
  TeamV2Experience,
  type TeamView,
} from "@/components/console-v2/team-v2-experience"
import { AccessDeniedPanel } from "@/components/hub/access-denied-panel"
import {
  getAdminConnectedAppDetail,
  getAdminConnectedApps,
  getAdminConnectorRegistry,
  getAdminHardware,
  getAdminInference,
  getAdminKnowledgeArchivedSources,
  getAdminKnowledgeCorpora,
  getAdminKnowledgeCorpusDetail,
  getAdminMcpServerDetail,
  getAdminSettings,
  getAdminTeamGroupDetail,
  getAdminTeamMemberDetail,
  getAdminTeamOverview,
  isConsoleBffAuthExpiredError,
} from "@/lib/admin/server-data"
import { notFound, redirect } from "next/navigation"
import type { ReactNode } from "react"

export interface ConsoleV2SearchParams {
  appAction?: string
  corpus?: string
  inferenceAction?: string
  knowledgeAction?: string
  knowledgeUpload?: string
  mcpAction?: string
  q?: string
  range?: string
  settingsAction?: string
  step?: string
  teamAction?: string
  view?: string
}

export async function renderKnowledgeConsoleRoute(
  searchParams?: Promise<ConsoleV2SearchParams>,
) {
  return withConsoleAdminAccess("knowledge", async () => {
    const resolvedSearchParams = searchParams ? await searchParams : undefined
    const [corpusList, teamOverview] = await Promise.all([
      getAdminKnowledgeCorpora(),
      getAdminTeamOverview(),
    ])
    const visibleCorpora = corpusList.corpora.filter(isFrontFacingCorpus)
    const selectedCorpus =
      visibleCorpora.find(
        (corpus) => corpus.id === resolvedSearchParams?.corpus,
      ) ??
      visibleCorpora[0] ??
      null
    const detail = selectedCorpus
      ? await getAdminKnowledgeCorpusDetail(selectedCorpus.id)
      : null
    const knowledgeView = resolveKnowledgeView(resolvedSearchParams?.view)
    const archive =
      knowledgeView === "archive"
        ? await getAdminKnowledgeArchivedSources()
        : null

    return (
      <KnowledgeV2Experience
        archivedSources={archive?.sources ?? []}
        basePath="/knowledge"
        corpora={corpusList.corpora}
        detail={detail}
        firecrawlEnabled={
          process.env.KNOWLEDGE_FIRECRAWL_ENABLED?.trim().toLowerCase() ===
          "true"
        }
        knowledgeAction={resolvedSearchParams?.knowledgeAction}
        knowledgeUpload={resolvedSearchParams?.knowledgeUpload}
        selectedCorpusId={selectedCorpus?.id}
        teamGroups={teamOverview.groups}
        view={knowledgeView}
      />
    )
  })
}

export async function renderApplicationsConsoleRoute({
  section,
  searchParams,
}: {
  section?: string[]
  searchParams?: Promise<ConsoleV2SearchParams>
}) {
  return withConsoleAdminAccess("applications", async () => {
    const resolvedSearchParams = searchParams ? await searchParams : undefined
    const applicationsView = resolveApplicationsView(section)
    const [connectedApps, registry, teamOverview, inference] =
      await Promise.all([
        getAdminConnectedApps(),
        getAdminConnectorRegistry({
          query: resolvedSearchParams?.q,
        }),
        getAdminTeamOverview(),
        applicationsView === "new-app"
          ? getAdminInference({
              range: "7d",
            })
          : Promise.resolve(null),
      ])
    const selectedMcpServerId =
      applicationsView === "configure-server" ? section?.[1] : undefined
    const selectedConnectedAppId =
      applicationsView === "app-detail" ? section?.[1] : undefined
    const mcpServerDetail = selectedMcpServerId
      ? await getAdminMcpServerDetail(selectedMcpServerId)
      : null
    const connectedAppDetail = selectedConnectedAppId
      ? await getAdminConnectedAppDetail(selectedConnectedAppId)
      : null

    if (applicationsView === "configure-server" && !selectedMcpServerId) {
      notFound()
    }
    if (applicationsView === "app-detail" && !selectedConnectedAppId) {
      notFound()
    }

    return (
      <ApplicationsV2Experience
        appAction={resolvedSearchParams?.appAction}
        connectedApps={connectedApps.apps}
        connectedAppDetail={connectedAppDetail?.app ?? null}
        modelOptions={inference?.models ?? []}
        mcpAction={resolvedSearchParams?.mcpAction}
        mcpServerDetail={mcpServerDetail}
        registryItems={registry.items}
        teamGroups={teamOverview.groups}
        view={applicationsView}
      />
    )
  })
}

export async function renderInferenceConsoleRoute({
  section,
  searchParams,
}: {
  section?: string[]
  searchParams?: Promise<ConsoleV2SearchParams>
}) {
  return withConsoleAdminAccess("inference", async () => {
    const resolvedSearchParams = searchParams ? await searchParams : undefined
    const inferenceView = resolveInferenceView(section)
    const inference = await getAdminInference({
      range: resolvedSearchParams?.range,
    })

    return (
      <InferenceV2Experience
        basePath="/inference"
        dashboard={inference}
        inferenceAction={resolvedSearchParams?.inferenceAction}
        view={inferenceView}
      />
    )
  })
}

export async function renderHardwareConsoleRoute(
  searchParams?: Promise<ConsoleV2SearchParams>,
) {
  return withConsoleAdminAccess("hardware", async () => {
    const resolvedSearchParams = searchParams ? await searchParams : undefined
    const hardware = await getAdminHardware({
      range: resolvedSearchParams?.range,
      step: resolvedSearchParams?.step,
    })

    return <HardwareV2Experience basePath="/hardware" hardware={hardware} />
  })
}

export async function renderTeamConsoleRoute({
  section,
  searchParams,
}: {
  section?: string[]
  searchParams?: Promise<ConsoleV2SearchParams>
}) {
  return withConsoleAdminAccess("team", async () => {
    const resolvedSearchParams = searchParams ? await searchParams : undefined
    const teamView = resolveTeamView(section)
    const selectedMemberId =
      teamView === "member-detail" ? section?.[1] : undefined
    const selectedGroupId =
      teamView === "group-detail" ? section?.[1] : undefined
    const [overview, memberDetail] = await Promise.all([
      getAdminTeamOverview(),
      selectedMemberId ? getAdminTeamMemberDetail(selectedMemberId) : null,
    ])
    const groupDetail = selectedGroupId
      ? await getAdminTeamGroupDetail(selectedGroupId)
      : null

    if (teamView === "member-detail" && !selectedMemberId) {
      notFound()
    }
    if (teamView === "group-detail" && !selectedGroupId) {
      notFound()
    }

    return (
      <TeamV2Experience
        detail={memberDetail}
        groupDetail={groupDetail}
        overview={overview}
        teamAction={resolvedSearchParams?.teamAction}
        view={teamView}
      />
    )
  })
}

export async function renderSettingsConsoleRoute(
  searchParams?: Promise<ConsoleV2SearchParams>,
) {
  return withConsoleAdminAccess("settings", async () => {
    const resolvedSearchParams = searchParams ? await searchParams : undefined
    const settings = await getAdminSettings()

    return (
      <SettingsV2Experience
        settings={settings}
        settingsAction={resolvedSearchParams?.settingsAction}
      />
    )
  })
}

async function withConsoleAdminAccess(
  activeSection: ConsoleV2SectionId,
  render: () => Promise<ReactNode>,
) {
  let content: ReactNode
  try {
    content = await render()
  } catch (error) {
    if (isConsoleBffAuthExpiredError(error)) {
      redirect(getConsoleReauthUrl(activeSection))
    } else if (isConsoleAccessDeniedError(error)) {
      content = (
        <AccessDeniedPanel
          body="The Console is available only to Console Admins."
          title="Admin access required"
        />
      )
    } else if (isConsoleDataUnavailableError(error)) {
      content = <ConsoleUnavailablePanel />
    } else {
      throw error
    }
  }

  return (
    <ConsoleV2Shell activeSection={activeSection}>{content}</ConsoleV2Shell>
  )
}

function getConsoleReauthUrl(activeSection: ConsoleV2SectionId): string {
  const url = new URLSearchParams({
    redirectTo: `/${activeSection}`,
  })
  return `/auth/keycloak?${url.toString()}`
}

function isConsoleAccessDeniedError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.startsWith("Console BFF returned HTTP 403")
  )
}

function isConsoleDataUnavailableError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message.startsWith("Console BFF is not available") ||
      error.message.startsWith("Console BFF returned HTTP") ||
      error.message.startsWith("Console BFF request failed"))
  )
}

function resolveKnowledgeView(view?: string): KnowledgeView {
  if (
    view === "new" ||
    view === "archive" ||
    view === "snapshots" ||
    view === "add-sources" ||
    view === "edit-sources"
  ) {
    return view
  }
  return "overview"
}

function resolveApplicationsView(section?: string[]): ApplicationsView {
  if (section?.[0] === "add-server") {
    return "add-server"
  }
  if (section?.[0] === "apps" && section?.[1] === "new") {
    return "new-app"
  }
  if (section?.[0] === "apps" && section?.[1]) {
    return "app-detail"
  }
  if (section?.[0] === "mcp" && section?.[2] === "settings") {
    return "configure-server"
  }
  return "overview"
}

function resolveInferenceView(section?: string[]): InferenceV2View {
  if (!section?.[0]) {
    return "overview"
  }
  if (section[0] === "update") {
    return "model-update"
  }
  notFound()
}

function resolveTeamView(section?: string[]): TeamView {
  if (section?.[0] === "scim" || section?.[0] === "break-glass") {
    redirect("/team")
  }
  if (section?.[0] === "import") {
    return "import"
  }
  if (section?.[0] === "groups" && section?.[1] === "new") {
    return "new-group"
  }
  if (section?.[0] === "groups" && section?.[1]) {
    return "group-detail"
  }
  if (section?.[0] === "groups") {
    redirect("/team")
  }
  if (section?.[0] === "members" && section?.[1] === "new") {
    return "new-member"
  }
  if (section?.[0] === "members" && section?.[1]) {
    return "member-detail"
  }
  if (section?.[0] === "members") {
    return "manage-users"
  }
  return "overview"
}

function isFrontFacingCorpus(corpus: { status: string }) {
  return corpus.status !== "archived" && corpus.status !== "deleted"
}
