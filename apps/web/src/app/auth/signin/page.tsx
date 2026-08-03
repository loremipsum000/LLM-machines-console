import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { normalizeConsoleReturnPath } from "@/lib/auth/safe-return"
import { productCopy } from "@llm-machines/copy"
import { KeyRound, ShieldCheck } from "lucide-react"

export const dynamic = "force-dynamic"

interface SignInPageProps {
  searchParams: Promise<{
    returnTo?: string
    session?: string
  }>
}

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const copy = productCopy.pages.signIn
  const { returnTo, session } = await searchParams
  const loginUrl = `/api/console/session/login?${new URLSearchParams({
    returnTo: normalizeConsoleReturnPath(returnTo),
  })}`

  return (
    <main className="grid min-h-screen place-items-center bg-surface-0 px-4 py-10">
      <Card className="w-full max-w-[520px] border-line-subtle bg-surface-1/95 shadow-2xl">
        <CardContent className="p-8">
          <div className="mb-7 flex items-center gap-3">
            <div className="flex size-11 items-center justify-center rounded-md border border-accent/30 bg-accent/10 text-accent">
              <ShieldCheck aria-hidden className="size-5" />
            </div>
            <div>
              <p className="text-xs font-medium uppercase text-accent">
                {copy.eyebrow}
              </p>
              <h1 className="mt-1 text-2xl font-semibold">{copy.title}</h1>
            </div>
          </div>

          <p className="mb-6 text-sm text-fg-muted">{copy.description}</p>

          {session === "expired" ? (
            <output className="mb-5 rounded-md border border-line-subtle bg-surface-0 px-4 py-3 text-sm text-fg-muted">
              Your Console session expired. Sign in again to continue.
            </output>
          ) : null}

          <Button
            asChild
            className="h-12 w-full justify-between px-4 text-base"
            variant="secondary"
          >
            <a href={loginUrl}>
              <span>{copy.keycloak}</span>
              <KeyRound aria-hidden className="size-5 text-accent" />
            </a>
          </Button>

          <p className="mt-5 text-sm text-fg-muted">{copy.footnote}</p>
        </CardContent>
      </Card>
    </main>
  )
}
