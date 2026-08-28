import { normalizeConsoleReturnPath } from "@/lib/auth/safe-return"
import { redirect } from "next/navigation"

export const dynamic = "force-dynamic"

interface SignInPageProps {
  searchParams: Promise<{
    returnTo?: string
    session?: string
  }>
}

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const { returnTo } = await searchParams
  const loginUrl = `/api/console/session/login?${new URLSearchParams({
    returnTo: normalizeConsoleReturnPath(returnTo),
  })}`
  redirect(loginUrl)
}
