import {
  type ConsoleV2SearchParams,
  renderApplicationsConsoleRoute,
} from "@/lib/admin/console-v2-routes"

export const dynamic = "force-dynamic"

interface ApplicationsPageProps {
  params?: Promise<{
    section?: string[]
  }>
  searchParams?: Promise<ConsoleV2SearchParams>
}

export default async function ApplicationsPage({
  params,
  searchParams,
}: ApplicationsPageProps) {
  const resolvedParams = params ? await params : undefined
  return renderApplicationsConsoleRoute({
    section: resolvedParams?.section,
    searchParams,
  })
}
