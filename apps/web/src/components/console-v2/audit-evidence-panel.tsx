import type { RetainedConsoleRole } from "@/lib/auth/role-claims"
import { Download } from "lucide-react"
import Link from "next/link"

export function AuditEvidencePanel({
  accessRole,
  generatedAt,
}: {
  accessRole: RetainedConsoleRole
  generatedAt: string
}) {
  if (accessRole !== "admin") {
    return (
      <section
        aria-labelledby="audit-evidence-title"
        className="rounded-lg border border-[#353535] bg-[#232323] p-3"
      >
        <h2
          className="text-sm font-semibold leading-5 text-white"
          id="audit-evidence-title"
        >
          Audit evidence
        </h2>
        <p className="mt-1 text-xs leading-5 text-[#b2b2b2]">
          Signed audit exports and verification keys require Admin access.
        </p>
      </section>
    )
  }

  const exportWindow = defaultExportWindow(generatedAt)

  return (
    <section
      aria-labelledby="audit-evidence-title"
      className="rounded-lg border border-[#353535] bg-[#232323] p-3"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2
            className="text-sm font-semibold leading-5 text-white"
            id="audit-evidence-title"
          >
            Audit evidence
          </h2>
          <p className="mt-1 max-w-[440px] text-xs leading-5 text-[#b2b2b2]">
            Download a signed metadata-only audit export for an inclusive UTC
            range of up to 365 days.
          </p>
        </div>
        <Link
          className="inline-flex h-9 shrink-0 items-center justify-center rounded-md border border-[#353535] bg-[#2e2e2e] px-3 text-xs font-medium text-white transition-colors hover:bg-[#353535] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#009fff]"
          href="/api/admin/audit/export/verification-keys"
          prefetch={false}
        >
          Verification keys
        </Link>
      </div>

      <form
        action="/api/admin/audit/export"
        className="mt-3 grid gap-3"
        method="get"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1.5 text-xs font-medium text-[#b2b2b2]">
            From (UTC)
            <input
              className="h-9 rounded-md border border-[#353535] bg-[#181818] px-3 text-sm text-white outline-none focus:border-[#009fff]"
              defaultValue={exportWindow.from}
              name="from"
              required
              type="datetime-local"
            />
          </label>
          <label className="grid gap-1.5 text-xs font-medium text-[#b2b2b2]">
            To (UTC)
            <input
              className="h-9 rounded-md border border-[#353535] bg-[#181818] px-3 text-sm text-white outline-none focus:border-[#009fff]"
              defaultValue={exportWindow.to}
              name="to"
              required
              type="datetime-local"
            />
          </label>
          <label className="grid gap-1.5 text-xs font-medium text-[#b2b2b2]">
            Export rows
            <input
              className="h-9 rounded-md border border-[#353535] bg-[#181818] px-3 text-sm text-white outline-none focus:border-[#009fff]"
              defaultValue="5000"
              max="5000"
              min="1"
              name="limit"
              required
              type="number"
            />
          </label>
          <label className="grid gap-1.5 text-xs font-medium text-[#b2b2b2]">
            Export cursor (optional)
            <input
              className="h-9 rounded-md border border-[#353535] bg-[#181818] px-3 text-sm text-white outline-none placeholder:text-[#777777] focus:border-[#009fff]"
              name="cursor"
              placeholder="Continue a signed export page"
              type="text"
            />
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <ExportSubmitButton format="json" />
          <ExportSubmitButton format="csv" />
        </div>
      </form>
    </section>
  )
}

function ExportSubmitButton({ format }: { format: "csv" | "json" }) {
  return (
    <button
      className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-[#353535] bg-[#2e2e2e] px-3 text-sm font-medium text-white transition-colors hover:bg-[#353535] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#009fff]"
      name="format"
      type="submit"
      value={format}
    >
      <Download aria-hidden className="size-4" />
      Export {format.toUpperCase()}
    </button>
  )
}

function defaultExportWindow(generatedAt: string): {
  from: string
  to: string
} {
  const to = new Date(generatedAt)
  const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000)
  return {
    from: toUtcDateTimeLocal(from),
    to: toUtcDateTimeLocal(to),
  }
}

function toUtcDateTimeLocal(value: Date): string {
  return value.toISOString().slice(0, 16)
}
