import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { normalizeConsoleReturnPath } from "@/lib/auth/safe-return"
import { consoleHighRiskActionSchema } from "@llm-machines/contracts/inference-core"
import { ShieldCheck } from "lucide-react"
import type { Metadata } from "next"
import { notFound } from "next/navigation"

export const dynamic = "force-dynamic"
export const metadata: Metadata = { referrer: "same-origin" }

interface ElevationPageProps {
  searchParams: Promise<{
    action?: string
    returnTo?: string
  }>
}

export default async function ElevationPage({
  searchParams,
}: ElevationPageProps) {
  const parameters = await searchParams
  const action = consoleHighRiskActionSchema.safeParse(parameters.action)
  if (!action.success) {
    notFound()
  }
  const returnTo = normalizeConsoleReturnPath(parameters.returnTo)

  return (
    <main className="grid min-h-screen place-items-center bg-surface-0 px-4 py-10">
      <Card className="w-full max-w-[520px] border-line-subtle bg-surface-1/95 shadow-2xl">
        <CardContent className="p-8">
          <div className="mb-6 flex items-center gap-3">
            <div className="flex size-11 items-center justify-center rounded-md border border-accent/30 bg-accent/10 text-accent">
              <ShieldCheck aria-hidden className="size-5" />
            </div>
            <div>
              <p className="text-xs font-medium uppercase text-accent">
                High-risk action
              </p>
              <h1 className="mt-1 text-2xl font-semibold">
                Verify your identity
              </h1>
            </div>
          </div>

          <p className="mb-6 text-sm text-fg-muted">
            Continue to the appliance identity service to confirm this
            administrator action. Your current Console session remains local to
            the appliance.
          </p>

          <form action="/api/console/session/elevate" method="post">
            <input name="action" type="hidden" value={action.data} />
            <input name="returnTo" type="hidden" value={returnTo} />
            <Button className="h-12 w-full text-base" type="submit">
              Continue to verification
            </Button>
          </form>

          <a
            className="mt-4 inline-flex text-sm text-fg-muted underline-offset-4 hover:underline"
            href={returnTo}
          >
            Cancel
          </a>
        </CardContent>
      </Card>
    </main>
  )
}
