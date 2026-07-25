import {
  hubNotificationSchema,
  problemDetailsSchema,
} from "@llm-machines/contracts"
import { getBffRequest } from "@/lib/bff/server-request"

export const dynamic = "force-dynamic"

interface ReadNotificationRouteContext {
  params: Promise<{
    id: string
  }>
}

export async function PATCH(
  _request: Request,
  { params }: ReadNotificationRouteContext,
) {
  const [{ id }, bffRequest] = await Promise.all([params, getBffRequest()])

  if (bffRequest) {
    try {
      const upstream = await fetch(
        `${bffRequest.baseUrl}/api/hub/notifications/${encodeURIComponent(
          id,
        )}/read`,
        {
          cache: "no-store",
          headers: {
            ...bffRequest.headers,
            "Idempotency-Key": `hub-notification-read:${id}`,
          },
          method: "PATCH",
        },
      )

      if (upstream.ok) {
        return Response.json(hubNotificationSchema.parse(await upstream.json()))
      }

      if (upstream.status === 404) {
        return notificationNotFound()
      }
      return notificationReadUnavailable(upstream.status)
    } catch {
      return notificationReadUnavailable(502)
    }
  }

  return notificationReadUnavailable(503)
}

function notificationNotFound(): Response {
  return Response.json(
    problemDetailsSchema.parse({
      type: "about:blank",
      title: "Notification not found",
      status: 404,
    }),
    { status: 404 },
  )
}

function notificationReadUnavailable(status: number): Response {
  return Response.json(
    problemDetailsSchema.parse({
      type: "about:blank",
      title: "Notification update unavailable",
      status,
      detail:
        "The Hub notification update could not reach the configured BFF, and fixture mode is not active.",
    }),
    { status },
  )
}
