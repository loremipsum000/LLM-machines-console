import {
  type ConsoleV2SearchParams,
  renderActivityConsoleRoute,
} from "@/lib/admin/console-v2-routes-core"

export const dynamic = "force-dynamic"

interface ActivityPageProps {
  searchParams?: Promise<ConsoleV2SearchParams>
}

export default async function ActivityPage({
  searchParams,
}: ActivityPageProps) {
  return renderActivityConsoleRoute(searchParams)
}
