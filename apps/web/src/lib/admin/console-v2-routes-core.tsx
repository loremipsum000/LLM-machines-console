import {
  ApplicationsV2Experience,
  type ApplicationsView,
} from "@/components/console-v2/applications-v2-experience"
import { ConsoleUnavailablePanel } from "@/components/console-v2/console-unavailable-panel"
import {
  type ConsoleV2SectionId,
  ConsoleV2Shell,
} from "@/components/console-v2/console-v2-shell"
import { HardwareV2Experience } from "@/components/console-v2/hardware-v2-experience"
import {
  InferenceV2Experience,
  type InferenceV2View,
} from "@/components/console-v2/inference-v2-experience"
import { SettingsV2Experience } from "@/components/console-v2/settings-v2-experience"
import {
  TeamV2Experience,
  type TeamView,
} from "@/components/console-v2/team-v2-experience"
import {
  getAdminConnectedAppDetail,
  getAdminConnectedApps,
  getAdminHardware,
  getAdminInference,
  getAdminSettings,
  getAdminTeamGroupDetail,
  getAdminTeamMemberDetail,
  getAdminTeamOverview,
  isConsoleBffAuthExpiredError,
} from "@/lib/admin/server-data-core"
import { notFound, redirect } from "next/navigation"
import type { ReactNode } from "react"

export interface ConsoleV2SearchParams {
  appAction?: string
  inferenceAction?: string
  range?: string
  settingsAction?: string
  step?: string
  teamAction?: string
}

export async function renderApplicationsConsoleRoute({
  section,
  searchParams,
}: {
  section?: string[]
  searchParams?: Promise<ConsoleV2SearchParams>
}) {
  return withConsoleAccess("applications", async () => {
    const resolvedSearchParams = searchParams ? await searchParams : undefined
    const applicationsView = resolveApplicationsView(section)
    const [connectedApps, teamOverview, inference] = await Promise.all([
      getAdminConnectedApps(),
      getAdminTeamOverview(),
      applicationsView === "new-app"
        ? getAdminInference({ range: "7d" })
        : Promise.resolve(null),
    ])
    const selectedConnectedAppId =
      applicationsView === "app-detail" ? section?.[1] : undefined
    const connectedAppDetail = selectedConnectedAppId
      ? await getAdminConnectedAppDetail(selectedConnectedAppId)
      : null

    if (applicationsView === "app-detail" && !selectedConnectedAppId) {
      notFound()
    }

    return (
      <ApplicationsV2Experience
        appAction={resolvedSearchParams?.appAction}
        connectedAppDetail={connectedAppDetail?.app ?? null}
        connectedApps={connectedApps.apps}
        modelOptions={inference?.models ?? []}
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
  return withConsoleAccess("inference", async () => {
    const resolvedSearchParams = searchParams ? await searchParams : undefined
    const inference = await getAdminInference({
      range: resolvedSearchParams?.range,
    })

    return (
      <InferenceV2Experience
        basePath="/inference"
        dashboard={inference}
        inferenceAction={resolvedSearchParams?.inferenceAction}
        view={resolveInferenceView(section)}
      />
    )
  })
}

export async function renderHardwareConsoleRoute(
  searchParams?: Promise<ConsoleV2SearchParams>,
) {
  return withConsoleAccess("hardware", async () => {
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
  return withConsoleAccess("team", async () => {
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
  return withConsoleAccess("settings", async () => {
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

async function withConsoleAccess(
  activeSection: ConsoleV2SectionId,
  render: () => Promise<ReactNode>,
) {
  let content: ReactNode
  try {
    content = await render()
  } catch (error) {
    if (isConsoleBffAuthExpiredError(error)) {
      redirect(getConsoleReauthUrl(activeSection))
    }
    if (isConsoleAccessDeniedError(error)) {
      content = <ConsoleAccessDeniedPanel />
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

function ConsoleAccessDeniedPanel() {
  return (
    <section
      aria-labelledby="console-access-denied-title"
      className="mt-16 rounded-lg border border-[#353535] bg-[#232323] p-5"
    >
      <h1
        className="text-xl font-semibold text-white"
        id="console-access-denied-title"
      >
        Console access required
      </h1>
      <p className="mt-2 text-sm leading-5 text-[#b2b2b2]">
        This surface is available only to authorized appliance administrators
        and operators.
      </p>
    </section>
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

function resolveApplicationsView(section?: string[]): ApplicationsView {
  if (!section?.[0]) {
    return "overview"
  }
  if (section[0] === "apps" && section[1] === "new") {
    return "new-app"
  }
  if (section[0] === "apps" && section[1]) {
    return "app-detail"
  }
  notFound()
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
  if (!section?.[0]) {
    return "overview"
  }
  if (section[0] === "import") {
    return "import"
  }
  if (section[0] === "groups" && section[1] === "new") {
    return "new-group"
  }
  if (section[0] === "groups" && section[1]) {
    return "group-detail"
  }
  if (section[0] === "members" && section[1] === "new") {
    return "new-member"
  }
  if (section[0] === "members" && section[1]) {
    return "member-detail"
  }
  if (section[0] === "members") {
    return "manage-users"
  }
  notFound()
}
