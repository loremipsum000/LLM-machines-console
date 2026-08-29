import type { RetainedConsoleRole } from "@/lib/auth/role-claims"
import { Download } from "lucide-react"

export function AuditEvidencePanel({
  accessRole,
  generatedAt,
}: {
  accessRole: RetainedConsoleRole
  generatedAt: string
}) {
  if (accessRole !== "admin") {
    return null
  }

  const exportWindow = defaultExportWindow(generatedAt)

  return (
    <section
      aria-labelledby="audit-evidence-title"
      className="rounded-lg border border-[#353535] bg-[#232323] p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2
            className="text-sm font-semibold leading-5 text-white"
            id="audit-evidence-title"
          >
            Audit export
          </h2>
          <p className="mt-1 max-w-[440px] text-xs leading-5 text-[#b2b2b2]">
            Download a signed metadata-only JSON export for the last 30 days.
          </p>
        </div>
        <form action="/api/admin/audit/export" method="get">
          <input name="format" type="hidden" value="json" />
          <input name="from" type="hidden" value={exportWindow.from} />
          <input name="to" type="hidden" value={exportWindow.to} />
          <button
            className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-md border border-[#36b7ff] bg-[#009fff] px-3 text-sm font-semibold text-[#07131a] transition-colors hover:bg-[#36b7ff] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#009fff]"
            type="submit"
          >
            <Download aria-hidden className="size-4" />
            Export last 30 days
          </button>
        </form>
      </div>
    </section>
  )
}

function defaultExportWindow(generatedAt: string): {
  from: string
  to: string
} {
  const to = new Date(generatedAt)
  const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000)
  return {
    from: from.toISOString(),
    to: to.toISOString(),
  }
}
