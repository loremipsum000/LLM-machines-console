import { productCopy } from "@llm-machines/copy"
import { Badge } from "@/components/ui/badge"

interface BuilderActionNoticeProps {
  status?: string
}

const actionMessages =
  productCopy.pages.hub.builderResourceDetail.actionMessages

export function BuilderActionNotice({ status }: BuilderActionNoticeProps) {
  if (!status || !(status in actionMessages)) {
    return null
  }

  const tone =
    status === "failed" ? "critical" : status === "withdrawn" ? "info" : "good"
  return (
    <div className="flex items-start justify-between gap-3 rounded-md border border-line-subtle bg-surface-1 p-3">
      <p className="text-sm text-fg-muted">
        {actionMessages[status as keyof typeof actionMessages]}
      </p>
      <Badge tone={tone}>{status}</Badge>
    </div>
  )
}
