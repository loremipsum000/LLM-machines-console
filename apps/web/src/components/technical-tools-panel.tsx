import type { TechnicalToolLink } from "@/lib/admin/technical-tools"
import { ExternalLink } from "lucide-react"

export function TechnicalToolsPanel({
  tools,
}: {
  tools: TechnicalToolLink[]
}) {
  return (
    <section
      aria-labelledby="settings-technical-tools-title"
      className="rounded-lg border border-[#353535] bg-[#232323] p-3"
    >
      <h2
        className="text-base font-semibold leading-5 text-white"
        id="settings-technical-tools-title"
      >
        Technical Tools
      </h2>
      <p className="mt-1 text-sm leading-5 text-[#b2b2b2]">
        Console is the recommended, simplified way to manage Applications,
        credentials, inference, hardware, Team, Activity &amp; Audit, and
        Settings. Open a native tool only when you need its deeper technical
        controls.
      </p>
      <p className="mt-2 text-xs leading-5 text-[#8b8b8b]">
        Each tool opens in a new tab and uses your current Keycloak sign-in to
        create its own native session. Console session data and credentials are
        never forwarded.
      </p>

      <nav aria-label="Advanced technical tools" className="mt-3 grid gap-2">
        {tools.map((tool) => (
          <article
            className="rounded-lg border border-[#353535] bg-[#181818] p-3"
            data-technical-tool={tool.id}
            key={tool.id}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold leading-5 text-white">
                  {tool.label}
                </h3>
                <p className="mt-1 text-sm leading-5 text-[#b2b2b2]">
                  {tool.description}
                </p>
                <p className="mt-2 text-xs leading-5 text-[#8b8b8b]">
                  {tool.access}
                </p>
              </div>
              {tool.href ? (
                <a
                  className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded bg-[#fdfdfd] px-3 text-sm font-semibold text-[#181818] transition-colors hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#009fff]"
                  href={tool.href}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  Open
                  <ExternalLink aria-hidden className="size-4" />
                  <span className="sr-only"> {tool.label}</span>
                </a>
              ) : (
                <span className="inline-flex shrink-0 rounded-full border border-[#51431c] bg-[#2b2414] px-2 py-1 text-xs font-medium text-[#ffdb8a]">
                  Not configured
                </span>
              )}
            </div>
          </article>
        ))}
      </nav>

      <div className="mt-3 rounded-lg border border-[#3d3d3d] bg-[#202020] p-3">
        <p className="text-sm font-medium leading-5 text-white">
          Application credentials remain the default
        </p>
        <p className="mt-1 text-xs leading-5 text-[#9f9f9f]">
          Console Application credentials are the customer integration path.
          LiteLLM virtual keys are a separate advanced native capability and are
          not Console Application credentials.
        </p>
      </div>
    </section>
  )
}
