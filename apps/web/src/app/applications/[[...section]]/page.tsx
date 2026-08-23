import type { ConsoleV2SearchParams } from "@/lib/admin/console-v2-routes-core"
import { redirect } from "next/navigation"

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
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(resolvedSearchParams ?? {})) {
    if (value) query.set(key, value)
  }
  const suffix = resolvedParams?.section?.length
    ? `/${resolvedParams.section.map(encodeURIComponent).join("/")}`
    : ""
  const serialized = query.toString()
  redirect(`/keys${suffix}${serialized ? `?${serialized}` : ""}`)
}
