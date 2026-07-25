import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { hubNotifications } from "@/lib/hub/mock-data"
import { NotificationsDrawer } from "./notifications-drawer"

describe("NotificationsDrawer", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("marks a notification read through the same-origin Hub route", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        ...hubNotifications[0],
        readAt: "2026-05-20T12:00:00.000Z",
      }),
    )

    render(<NotificationsDrawer notifications={hubNotifications} />)

    fireEvent.click(screen.getByLabelText("Notifications"))
    expect(screen.getByText("2 unread")).toBeTruthy()

    fireEvent.click(screen.getAllByText("Mark read")[0])

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        `/api/hub/notifications/${hubNotifications[0]?.id}/read`,
        expect.objectContaining({
          cache: "no-store",
          method: "PATCH",
        }),
      )
    })
    await waitFor(() => {
      expect(screen.getByText("1 unread")).toBeTruthy()
    })
    expect(screen.getByText("Read")).toBeTruthy()
  })

  it("keeps unread state and shows a retryable error when marking read fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json(
        {
          type: "about:blank",
          title: "Notification read failed",
          status: 500,
        },
        { status: 500 },
      ),
    )

    render(<NotificationsDrawer notifications={hubNotifications} />)

    fireEvent.click(screen.getByLabelText("Notifications"))
    fireEvent.click(screen.getAllByText("Mark read")[0])

    await waitFor(() => {
      expect(screen.getByText("Could not mark read. Try again.")).toBeTruthy()
    })
    expect(screen.getByText("2 unread")).toBeTruthy()
    expect(screen.getAllByText("Mark read")).toHaveLength(2)
  })
})
