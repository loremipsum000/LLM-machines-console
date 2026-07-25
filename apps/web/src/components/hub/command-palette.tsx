"use client"

import { Command, Search } from "lucide-react"
import { useQuery } from "@tanstack/react-query"
import { useEffect, useMemo, useRef, useState } from "react"
import type {
  Artifact,
  HubResource,
  HubSearchResult,
  TaskSession,
} from "@llm-machines/contracts"
import { hubSearchResultSchema } from "@llm-machines/contracts"
import { productCopy } from "@llm-machines/copy"
import { searchLocalHub } from "@/lib/hub/search"

interface CommandPaletteProps {
  resources: HubResource[]
  tasks: TaskSession[]
  artifacts: Artifact[]
}

export function CommandPalette({
  artifacts,
  resources,
  tasks,
}: CommandPaletteProps) {
  const copy = productCopy.pages.hub.commandPalette
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState(false)
  const { data: serverResults } = useQuery({
    enabled: open,
    queryFn: () => fetchHubSearchResults(query),
    queryKey: ["hub-search", query],
    retry: false,
  })
  const fallbackResults = useMemo(
    () => searchLocalHub({ artifacts, query, resources, tasks }),
    [artifacts, query, resources, tasks],
  )
  const results = serverResults ?? fallbackResults

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() !== "k" ||
        (!event.metaKey && !event.ctrlKey)
      ) {
        return
      }

      event.preventDefault()
      setOpen(true)
      inputRef.current?.focus()
      inputRef.current?.select()
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => {
      window.removeEventListener("keydown", handleKeyDown)
    }
  }, [])

  return (
    <div className="relative ml-auto hidden w-full max-w-xl md:block">
      <Search
        aria-hidden
        className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-muted"
      />
      <input
        aria-label={copy.label}
        className="h-10 w-full rounded-md border border-line-subtle bg-surface-1 pl-9 pr-24 text-sm text-fg-default outline-none transition-colors placeholder:text-fg-muted focus:border-accent"
        onBlur={() => {
          globalThis.setTimeout(() => setOpen(false), 120)
        }}
        onChange={(event) => {
          setQuery(event.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        placeholder={productCopy.pages.hub.commandPlaceholder}
        ref={inputRef}
        value={query}
      />
      <span className="absolute right-2 top-1/2 inline-flex -translate-y-1/2 items-center gap-1 rounded border border-line-subtle bg-surface-2 px-2 py-1 text-xs text-fg-muted">
        <Command aria-hidden className="size-3" /> {copy.shortcut}
      </span>
      {open ? (
        <div className="absolute left-0 right-0 top-12 z-20 overflow-hidden rounded-lg border border-line-subtle bg-surface-1 shadow-xl">
          {results.length > 0 ? (
            <ul className="max-h-80 overflow-auto p-2">
              {results.map((result) => (
                <li key={`${result.type}:${result.id}`}>
                  <a
                    className="block rounded-md px-3 py-2 hover:bg-surface-2"
                    href={result.href}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-medium">
                        {result.title}
                      </span>
                      <span className="text-xs uppercase text-fg-muted">
                        {result.type}
                      </span>
                    </div>
                    {result.description ? (
                      <p className="mt-1 line-clamp-1 text-sm text-fg-muted">
                        {result.description}
                      </p>
                    ) : null}
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="p-4 text-sm text-fg-muted">{copy.empty}</p>
          )}
        </div>
      ) : null}
    </div>
  )
}

async function fetchHubSearchResults(
  query: string,
): Promise<HubSearchResult[] | null> {
  const response = await fetch(`/api/hub/search?q=${encodeURIComponent(query)}`, {
    cache: "no-store",
  })
  if (!response.ok) {
    return null
  }

  return hubSearchResultSchema.array().parse(await response.json())
}
