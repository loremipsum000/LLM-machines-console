import { KeyRound, ShieldCheck } from "lucide-react"
import { headers } from "next/headers"
import { productCopy } from "@llm-machines/copy"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"

export const dynamic = "force-dynamic"

interface SignInPageProps {
  searchParams: Promise<{
    callbackUrl?: string
  }>
}

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const copy = productCopy.pages.hub.signIn
  const { callbackUrl } = await searchParams
  const redirectTo = await normalizeCallbackUrl(callbackUrl)
  const keycloakStartUrl = `/auth/keycloak?${new URLSearchParams({
    redirectTo,
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

          <Button
            asChild
            className="h-12 w-full justify-between px-4 text-base"
            variant="secondary"
          >
            <a href={keycloakStartUrl}>
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

async function normalizeCallbackUrl(
  callbackUrl: string | undefined,
): Promise<string> {
  if (!callbackUrl || callbackUrl.startsWith("/")) {
    return normalizeCallbackUrlWithHeaders(callbackUrl, new Headers())
  }

  const requestHeaders = await headers()
  return normalizeCallbackUrlWithHeaders(callbackUrl, requestHeaders)
}

function normalizeCallbackUrlWithHeaders(
  callbackUrl: string | undefined,
  requestHeaders: Headers,
): string {
  if (!callbackUrl || !callbackUrl.startsWith("/")) {
    if (!callbackUrl) {
      return "/"
    }

    const currentOrigin = getRequestOrigin(requestHeaders)
    if (!currentOrigin) {
      return "/"
    }

    try {
      const url = new URL(callbackUrl)
      return url.origin === currentOrigin ? `${url.pathname}${url.search}` : "/"
    } catch {
      return "/"
    }
  }
  if (callbackUrl.startsWith("//")) {
    return "/"
  }
  return callbackUrl
}

function getRequestOrigin(requestHeaders: Headers): string | undefined {
  const host = cleanHeaderValue(
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host"),
  )
  if (!host) {
    return undefined
  }

  const protocol =
    cleanHeaderValue(requestHeaders.get("x-forwarded-proto"))?.replace(
      /:$/,
      "",
    ) ?? "https"
  return `${protocol}://${host}`
}

function cleanHeaderValue(value: string | null): string | undefined {
  const trimmed = value?.trim()
  if (!trimmed || trimmed.toLowerCase() === "null") {
    return undefined
  }
  return trimmed
}
