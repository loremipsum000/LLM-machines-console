import {
  type ConsoleV2SearchParams,
  renderTeamConsoleRoute,
} from "@/lib/admin/console-v2-routes-core"

export const dynamic = "force-dynamic"

interface TeamPageProps {
  params?: Promise<{
    section?: string[]
  }>
  searchParams?: Promise<ConsoleV2SearchParams>
}

export default async function TeamPage({
  params,
  searchParams,
}: TeamPageProps) {
  const resolvedParams = params ? await params : undefined
  return renderTeamConsoleRoute({
    section: resolvedParams?.section,
    searchParams,
  })
}
