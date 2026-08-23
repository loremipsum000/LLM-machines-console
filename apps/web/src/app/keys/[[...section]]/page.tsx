import {
  type ConsoleV2SearchParams,
  renderApplicationsConsoleRoute,
} from "@/lib/admin/console-v2-routes-core"

export const dynamic = "force-dynamic"

interface KeysPageProps {
  params?: Promise<{
    section?: string[]
  }>
  searchParams?: Promise<ConsoleV2SearchParams>
}

export default async function KeysPage({
  params,
  searchParams,
}: KeysPageProps) {
  const resolvedParams = params ? await params : undefined
  return renderApplicationsConsoleRoute({
    section: resolvedParams?.section,
    searchParams,
  })
}
