import {
  type ActivityFilters,
  ActivityV2Experience,
} from "@/components/console-v2/activity-v2-experience"
import {
  ApplicationsV2Experience,
  type ApplicationsView,
} from "@/components/console-v2/applications-v2-experience"
import { ConsoleUnavailablePanel } from "@/components/console-v2/console-unavailable-panel"
import { roleCanAccessConsoleSection } from "@/components/console-v2/console-v2-sections"
import {
  type ConsoleV2SectionId,
  ConsoleV2Shell,
} from "@/components/console-v2/console-v2-shell"
import { HardwareV2Experience } from "@/components/console-v2/hardware-v2-experience"
import { InferenceV2Experience } from "@/components/console-v2/inference-v2-experience"
import { OverviewV2Experience } from "@/components/console-v2/overview-v2-experience"
import { SettingsV2Experience } from "@/components/console-v2/settings-v2-experience"
import {
  TeamV2Experience,
  type TeamView,
} from "@/components/console-v2/team-v2-experience"
import {
  getAdminAudit,
  getAdminConnectedAppDetail,
  getAdminConnectedApps,
  getAdminHardware,
  getAdminInference,
  getAdminOverview,
  getAdminSettings,
  getAdminTeamGroupDetail,
  getAdminTeamMemberDetail,
  getAdminTeamOverview,
  isConsoleBffAuthExpiredError,
  isConsoleBffUnavailableError,
} from "@/lib/admin/server-data-core"
import type { RetainedConsoleRole } from "@/lib/auth/role-claims"
import { getCurrentConsoleSession } from "@/lib/auth/session"
import { notFound, redirect } from "next/navigation"
import type { ReactNode } from "react"

export interface ConsoleV2SearchParams {
  applicationId?: string
  appAction?: string
  cursor?: string
  event?: string
  eventId?: string
  limit?: string
  outcome?: string
  q?: string
  range?: string
  severity?: string
  settingsAction?: string
  source?: string
  step?: string
  teamAction?: string
}

export async function renderOverviewConsoleRoute() {
  return withConsoleAccess("overview", async () => {
    const overview = await getAdminOverview()
    return <OverviewV2Experience overview={overview} />
  })
}

export async function renderActivityConsoleRoute(
  searchParams?: Promise<ConsoleV2SearchParams>,
) {
  return withConsoleAccess("activity", async (role) => {
    const resolvedSearchParams = searchParams ? await searchParams : undefined
    const audit = await getAdminAudit({
      applicationId: resolvedSearchParams?.applicationId,
      cursor: resolvedSearchParams?.cursor,
      eventId: resolvedSearchParams?.eventId ?? resolvedSearchParams?.event,
      limit: resolvedSearchParams?.limit,
      outcome: resolvedSearchParams?.outcome,
      query: resolvedSearchParams?.q,
      severity: resolvedSearchParams?.severity,
      source: resolvedSearchParams?.source,
    })
    const filters: ActivityFilters = {
      applicationId: audit.selectedApplicationId,
      cursor: normalizedSearchParam(resolvedSearchParams?.cursor),
      eventId: audit.selectedEventId,
      limit: normalizedSearchParam(resolvedSearchParams?.limit),
      outcome: audit.selectedOutcome,
      query: audit.query,
      severity: audit.selectedSeverity,
      source: audit.selectedSource,
    }

    return (
      <ActivityV2Experience
        accessRole={role}
        activity={audit}
        filters={filters}
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
  return withConsoleAccess("applications", async (role) => {
    const resolvedSearchParams = searchParams ? await searchParams : undefined
    const applicationsView = resolveApplicationsView(section)
    if (applicationsView === "new-app" && role !== "admin") {
      return <ConsoleCapabilityDeniedPanel />
    }
    if (applicationsView === "overview") {
      const connectedApps = await getAdminConnectedApps()
      return (
        <ApplicationsV2Experience
          accessRole={role}
          appAction={applicationActionForRole(
            role,
            resolvedSearchParams?.appAction,
          )}
          connectedApps={connectedApps.apps}
          view="overview"
        />
      )
    }

    if (applicationsView === "new-app") {
      const inference = await getAdminInference({ range: "7d" })
      return (
        <ApplicationsV2Experience
          accessRole={role}
          modelOptions={inference.models}
          view="new-app"
        />
      )
    }

    const selectedConnectedAppId = section?.[1]
    if (!selectedConnectedAppId) {
      notFound()
    }
    const [connectedAppDetail, inference] = await Promise.all([
      getAdminConnectedAppDetail(selectedConnectedAppId),
      role === "admin"
        ? getAdminInference({ range: "7d" })
        : Promise.resolve(null),
    ])
    return (
      <ApplicationsV2Experience
        accessRole={role}
        appAction={applicationActionForRole(
          role,
          resolvedSearchParams?.appAction,
        )}
        connectedAppDetail={connectedAppDetail?.app ?? null}
        modelOptions={inference?.models ?? []}
        view="app-detail"
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
  if (section?.[0]) {
    notFound()
  }
  return withConsoleAccess("inference", async (role) => {
    const resolvedSearchParams = searchParams ? await searchParams : undefined
    const inference = await getAdminInference({
      range: resolvedSearchParams?.range,
    })

    return (
      <InferenceV2Experience
        accessRole={role}
        basePath="/inference"
        dashboard={inference}
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
  return withConsoleAccess("team", async (role) => {
    const resolvedSearchParams = searchParams ? await searchParams : undefined
    const teamView = resolveTeamView(section)
    if (isTeamMutationView(teamView) && role !== "admin") {
      return <ConsoleCapabilityDeniedPanel />
    }
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
        accessRole={role}
        detail={memberDetail}
        groupDetail={groupDetail}
        overview={overview}
        teamAction={
          role === "admin" ? resolvedSearchParams?.teamAction : undefined
        }
        view={teamView}
      />
    )
  })
}

export async function renderSettingsConsoleRoute(
  searchParams?: Promise<ConsoleV2SearchParams>,
) {
  return withConsoleAccess("settings", async (role) => {
    const resolvedSearchParams = searchParams ? await searchParams : undefined
    if (!roleCanAccessConsoleSection(role, "settings")) {
      return <ConsoleCapabilityDeniedPanel />
    }
    const settings = await getAdminSettings()

    return (
      <SettingsV2Experience
        accessRole={role}
        settings={settings}
        settingsAction={
          role === "admin" ? resolvedSearchParams?.settingsAction : undefined
        }
      />
    )
  })
}

async function withConsoleAccess(
  activeSection: ConsoleV2SectionId,
  render: (role: RetainedConsoleRole) => Promise<ReactNode>,
) {
  const session = await getCurrentConsoleSession()
  const returnTo = consoleSectionReturnPath(activeSection)
  if (session.state === "unavailable") {
    redirect(getConsoleUnavailableUrl(returnTo))
  }
  if (session.state !== "active") {
    redirect(getConsoleExpiredSignInUrl(returnTo))
  }
  const role = session.session.role

  let content: ReactNode
  try {
    content = await render(role)
  } catch (error) {
    if (isConsoleBffAuthExpiredError(error)) {
      redirect(getConsoleExpiredSignInUrl(returnTo))
    }
    if (isConsoleBffUnavailableError(error)) {
      redirect(getConsoleUnavailableUrl(returnTo))
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
    <ConsoleV2Shell accessRole={role} activeSection={activeSection}>
      {content}
    </ConsoleV2Shell>
  )
}

function applicationActionForRole(
  role: RetainedConsoleRole,
  action: string | undefined,
): string | undefined {
  if (role === "admin" || action === "disabled" || action === "failed") {
    return action
  }
  return undefined
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

function ConsoleCapabilityDeniedPanel() {
  return (
    <section
      aria-labelledby="console-capability-denied-title"
      className="mt-16 rounded-lg border border-[#353535] bg-[#232323] p-5"
    >
      <h1
        className="text-xl font-semibold text-white"
        id="console-capability-denied-title"
      >
        Admin access required
      </h1>
      <p className="mt-2 text-sm leading-5 text-[#b2b2b2]">
        Operators can view this section, but this change is limited to Admins.
      </p>
    </section>
  )
}

function consoleSectionReturnPath(activeSection: ConsoleV2SectionId): string {
  return activeSection === "overview" ? "/" : `/${activeSection}`
}

function getConsoleExpiredSignInUrl(returnTo: string): string {
  const query = new URLSearchParams({ session: "expired", returnTo })
  return `/auth/signin?${query.toString()}`
}

function getConsoleUnavailableUrl(returnTo: string): string {
  const query = new URLSearchParams({ returnTo })
  return `/auth/unavailable?${query.toString()}`
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

function isTeamMutationView(view: TeamView): boolean {
  return view === "import" || view === "new-group" || view === "new-member"
}

function normalizedSearchParam(value: string | undefined): string | null {
  const normalized = value?.trim()
  return normalized ? normalized : null
}
