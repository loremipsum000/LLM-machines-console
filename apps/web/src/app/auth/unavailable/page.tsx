import { Card, CardContent } from "@/components/ui/card"
import { normalizeConsoleReturnPath } from "@/lib/auth/safe-return"

export const dynamic = "force-dynamic"

export default async function IdentityUnavailablePage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string }>
}) {
  const returnTo = normalizeConsoleReturnPath((await searchParams).returnTo)
  return (
    <main className="grid min-h-screen place-items-center bg-surface-0 px-4 py-10">
      <Card className="w-full max-w-[520px] border-line-subtle bg-surface-1/95 shadow-2xl">
        <CardContent className="p-8">
          <h1 className="text-2xl font-semibold">
            Identity service temporarily unavailable
          </h1>
          <p className="mt-4 text-sm text-fg-muted">
            Your local Console session was preserved. Retry when the appliance
            identity service is available.
          </p>
          <a
            className="mt-6 inline-flex rounded-md border border-line-subtle px-4 py-2 text-sm"
            href={returnTo}
          >
            Retry
          </a>
        </CardContent>
      </Card>
    </main>
  )
}
