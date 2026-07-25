import {
  type ConsoleV2SearchParams,
  renderHardwareConsoleRoute,
} from "@/lib/admin/console-v2-routes"

export const dynamic = "force-dynamic"

interface HardwarePageProps {
  searchParams?: Promise<ConsoleV2SearchParams>
}

export default async function HardwarePage({ searchParams }: HardwarePageProps) {
  return renderHardwareConsoleRoute(searchParams)
}
