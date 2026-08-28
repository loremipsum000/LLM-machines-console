import Link from "next/link"
import type { ComponentProps } from "react"

type CanonicalKeyLinkProps = ComponentProps<typeof Link>

export function CanonicalKeyLink({ href, ...props }: CanonicalKeyLinkProps) {
  return <Link {...props} href={canonicalKeyHref(href)} />
}

function canonicalKeyHref(href: CanonicalKeyLinkProps["href"]) {
  if (typeof href !== "string") return href
  if (href === "/applications") return "/keys"
  if (href.startsWith("/applications/apps/")) {
    return `/keys/apps/${href.slice("/applications/apps/".length)}`
  }
  return href
}
