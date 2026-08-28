import {
  type ConsoleV2SearchParams,
  renderInferenceConsoleRoute,
} from "@/lib/admin/console-v2-routes-core"

export const dynamic = "force-dynamic"

interface InferencePageProps {
  params?: Promise<{
    section?: string[]
  }>
  searchParams?: Promise<ConsoleV2SearchParams>
}

export default async function InferencePage({
  params,
  searchParams,
}: InferencePageProps) {
  const resolvedParams = params ? await params : undefined
  return renderInferenceConsoleRoute({
    section: resolvedParams?.section,
    searchParams,
  })
}
