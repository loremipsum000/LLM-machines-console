import {
  type ConsoleV2SearchParams,
  renderSettingsConsoleRoute,
} from "@/lib/admin/console-v2-routes-core"

export const dynamic = "force-dynamic"

interface SettingsPageProps {
  searchParams?: Promise<ConsoleV2SearchParams>
}

export default async function SettingsPage({
  searchParams,
}: SettingsPageProps) {
  return renderSettingsConsoleRoute(searchParams)
}
