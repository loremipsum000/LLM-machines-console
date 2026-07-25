import {
  type ConsoleV2SearchParams,
  renderKnowledgeConsoleRoute,
} from "@/lib/admin/console-v2-routes"

export const dynamic = "force-dynamic"

interface KnowledgePageProps {
  searchParams?: Promise<ConsoleV2SearchParams>
}

export default async function KnowledgePage({
  searchParams,
}: KnowledgePageProps) {
  return renderKnowledgeConsoleRoute(searchParams)
}
