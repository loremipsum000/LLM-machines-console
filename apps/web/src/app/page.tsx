import { renderOverviewConsoleRoute } from "@/lib/admin/console-v2-routes-core"

export const dynamic = "force-dynamic"

export default async function HomePage() {
  return renderOverviewConsoleRoute()
}
