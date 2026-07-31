import { ConsoleUnavailablePanel } from "@/components/console-v2/console-unavailable-panel"
import { ConsoleV2Shell } from "@/components/console-v2/console-v2-shell"
import {
  KnowledgeV2Experience,
  type KnowledgeView,
} from "@/components/console-v2/knowledge-v2-experience"
import { AccessDeniedPanel } from "@/components/hub/access-denied-panel"
import {
  getAdminKnowledgeArchivedSources,
  getAdminKnowledgeCorpora,
  getAdminKnowledgeCorpusDetail,
  getAdminTeamOverview,
  isConsoleBffAuthExpiredError,
} from "@/lib/admin/server-data"
import { redirect } from "next/navigation"
import type { ReactNode } from "react"

export interface ConsoleV2SearchParams {
  corpus?: string
  knowledgeAction?: string
  knowledgeUpload?: string
  view?: string
}

export async function renderKnowledgeConsoleRoute(
  searchParams?: Promise<ConsoleV2SearchParams>,
) {
  return withConsoleAdminAccess(async () => {
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

async function withConsoleAdminAccess(render: () => Promise<ReactNode>) {
  let content: ReactNode
  try {
    content = await render()
  } catch (error) {
    if (isConsoleBffAuthExpiredError(error)) {
      redirect(getConsoleReauthUrl())
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

  return <ConsoleV2Shell>{content}</ConsoleV2Shell>
}

function getConsoleReauthUrl(): string {
  const url = new URLSearchParams({
    redirectTo: "/knowledge",
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

function isFrontFacingCorpus(corpus: { status: string }) {
  return corpus.status !== "archived" && corpus.status !== "deleted"
}
