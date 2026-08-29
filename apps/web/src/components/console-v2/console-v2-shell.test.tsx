import { fireEvent, render, screen, within } from "@testing-library/react"
import React from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ConsoleV2Shell } from "./console-v2-shell"

const navigationMocks = vi.hoisted(() => ({
  router: {
    push: vi.fn(),
  },
}))

const expectedNavigation = [
  ["Keys", "/keys"],
  ["Inference", "/inference"],
  ["Hardware", "/hardware"],
  ["Team", "/team"],
  ["Settings", "/settings"],
] as const

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
    React.createElement("a", { href: String(href), ...props }, children),
}))

vi.mock("next/image", () => ({
  default: ({
    alt,
    src,
    ...props
  }: React.ImgHTMLAttributes<HTMLImageElement>) =>
    React.createElement("img", { alt, src: String(src), ...props }),
}))

vi.mock("next/navigation", () => ({
  useRouter: () => navigationMocks.router,
}))

describe("ConsoleV2Shell", () => {
  beforeEach(() => {
    navigationMocks.router.push.mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it("routes to numbered Console sections with Command shortcuts", () => {
    mockNavigatorPlatform("MacIntel")
    render(
      <ConsoleV2Shell accessRole="admin" activeSection="applications">
        <h1>Keys</h1>
      </ConsoleV2Shell>,
    )

    const navigation = screen.getByRole("navigation", {
      name: "Console navigation",
    })
    expect(
      within(navigation)
        .getByRole("link", { name: "Inference" })
        .getAttribute("aria-keyshortcuts"),
    ).toBe("Meta+2")

    fireEvent.keyDown(window, { key: "2", metaKey: true })

    expect(navigationMocks.router.push).toHaveBeenCalledWith("/inference")

    fireEvent.keyUp(window, { key: "Meta" })
  })

  it("shows shortcut hints while the modifier key is held", () => {
    mockNavigatorPlatform("MacIntel")
    render(
      <ConsoleV2Shell accessRole="admin" activeSection="applications">
        <h1>Keys</h1>
      </ConsoleV2Shell>,
    )

    const applicationsShortcut = screen.getByText("⌘1")
    expect(String(applicationsShortcut.className)).toContain("opacity-0")

    fireEvent.keyDown(window, { key: "Meta", metaKey: true })

    expect(String(applicationsShortcut.className)).toContain("opacity-100")

    fireEvent.keyUp(window, { key: "Meta" })

    expect(String(applicationsShortcut.className)).toContain("opacity-0")
  })

  it("keeps shortcut hints visible across shortcut navigation while Command stays held", () => {
    mockNavigatorPlatform("MacIntel")
    const { unmount } = render(
      <ConsoleV2Shell accessRole="admin" activeSection="applications">
        <h1>Keys</h1>
      </ConsoleV2Shell>,
    )

    fireEvent.keyDown(window, { key: "2", metaKey: true })
    unmount()

    render(
      <ConsoleV2Shell accessRole="admin" activeSection="inference">
        <h1>Inference</h1>
      </ConsoleV2Shell>,
    )

    const inferenceShortcut = screen.getByText("⌘2")
    expect(String(inferenceShortcut.className)).toContain("opacity-100")

    fireEvent.keyUp(window, { key: "Meta" })

    expect(String(inferenceShortcut.className)).toContain("opacity-0")
  })

  it("uses Ctrl shortcut hints outside macOS", () => {
    mockNavigatorPlatform("Win32")
    render(
      <ConsoleV2Shell accessRole="admin" activeSection="applications">
        <h1>Keys</h1>
      </ConsoleV2Shell>,
    )

    const navigation = screen.getByRole("navigation", {
      name: "Console navigation",
    })
    expect(
      within(navigation)
        .getByRole("link", { name: "Keys" })
        .getAttribute("aria-keyshortcuts"),
    ).toBe("Control+1")
    expect(screen.getByText("Ctrl 1")).toBeTruthy()

    fireEvent.keyDown(window, { ctrlKey: true, key: "5" })

    expect(navigationMocks.router.push).toHaveBeenCalledWith("/settings")

    fireEvent.keyUp(window, { key: "Control" })
  })

  it("renders only the retained Console navigation", () => {
    render(
      <ConsoleV2Shell accessRole="admin" activeSection="applications">
        <h1>Keys</h1>
      </ConsoleV2Shell>,
    )

    const navigation = screen.getByRole("navigation", {
      name: "Console navigation",
    })
    const navigationLinks = within(navigation).getAllByRole("link")
    expect(navigationLinks.map((link) => link.getAttribute("href"))).toEqual(
      expectedNavigation.map(([, href]) => href),
    )
    for (const [label, href] of expectedNavigation) {
      expect(
        within(navigation)
          .getByRole("link", { name: label })
          .getAttribute("href"),
      ).toBe(href)
    }
    const keysIcon = within(navigation)
      .getByRole("link", { name: "Keys" })
      .querySelector("svg")
    expect(keysIcon?.getAttribute("viewBox")).toBe("0 0 20 20")
    expect(keysIcon?.getAttribute("fill")).toBe("none")
    expect(keysIcon?.querySelector("path")?.getAttribute("stroke")).toBe(
      "currentColor",
    )
    expect(screen.getByText("Administrator")).toBeTruthy()
    expect(
      within(navigation).queryByRole("link", { name: "Overview" }),
    ).toBeNull()
    const signOutForm = screen
      .getByRole("button", { name: "Sign out" })
      .closest("form")
    expect(signOutForm?.getAttribute("action")).toBe(
      "/api/console/session/logout",
    )
    expect(signOutForm?.getAttribute("method")).toBe("post")
    const sidebar = screen.getByRole("complementary")
    expect(sidebar.className).toContain("lg:inset-y-2")
    expect(sidebar.className).toContain("lg:left-2")
    expect(sidebar.className).not.toContain("lg:left-0")
    expect(screen.getByRole("main").className).toContain(
      "lg:ml-[clamp(320px,calc(100vw-690px),534px)]",
    )
    expect(screen.getByRole("main").className).toContain(
      "lg:w-[min(640px,calc(100vw-352px))]",
    )
  })

  it("gives Operator the same retained navigation and shortcut indexes", () => {
    mockNavigatorPlatform("MacIntel")
    render(
      <ConsoleV2Shell accessRole="operator" activeSection="team">
        <h1>Team</h1>
      </ConsoleV2Shell>,
    )

    const navigation = screen.getByRole("navigation", {
      name: "Console navigation",
    })
    expect(
      within(navigation).getByRole("link", { name: "Settings" }),
    ).toBeTruthy()
    const navigationLinks = within(navigation).getAllByRole("link")
    expect(navigationLinks.map((link) => link.getAttribute("href"))).toEqual(
      expectedNavigation.map(([, href]) => href),
    )
    expect(
      navigationLinks.map((link) => link.getAttribute("aria-keyshortcuts")),
    ).toEqual(["Meta+1", "Meta+2", "Meta+3", "Meta+4", "Meta+5"])
    expect(
      within(navigation)
        .getByRole("link", { name: "Team" })
        .getAttribute("aria-keyshortcuts"),
    ).toBe("Meta+4")

    fireEvent.keyDown(window, { key: "4", metaKey: true })
    fireEvent.keyDown(window, { key: "5", metaKey: true })

    expect(navigationMocks.router.push).toHaveBeenNthCalledWith(1, "/team")
    expect(navigationMocks.router.push).toHaveBeenNthCalledWith(2, "/settings")
    expect(screen.getByText("Operator")).toBeTruthy()
  })

  it("leaves the removed sixth shortcut unhandled", () => {
    mockNavigatorPlatform("MacIntel")
    render(
      <ConsoleV2Shell accessRole="admin" activeSection="applications">
        <h1>Keys</h1>
      </ConsoleV2Shell>,
    )

    const event = new KeyboardEvent("keydown", {
      cancelable: true,
      key: "6",
      metaKey: true,
    })
    window.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(false)
    expect(navigationMocks.router.push).not.toHaveBeenCalled()
  })

  it("starts the coordinated logout with a same-origin JSON POST", () => {
    const request = vi.fn(() => new Promise<Response>(() => undefined))
    vi.stubGlobal("fetch", request)
    render(
      <ConsoleV2Shell accessRole="admin" activeSection="applications">
        <h1>Keys</h1>
      </ConsoleV2Shell>,
    )

    fireEvent.click(screen.getByRole("button", { name: "Sign out" }))
    expect(request).toHaveBeenCalledWith("/api/console/session/logout", {
      credentials: "same-origin",
      headers: { accept: "application/json" },
      method: "POST",
    })
  })

  it("keeps a failed coordinated logout recoverable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("unavailable")))
    render(
      <ConsoleV2Shell accessRole="admin" activeSection="applications">
        <h1>Keys</h1>
      </ConsoleV2Shell>,
    )

    fireEvent.click(screen.getByRole("button", { name: "Sign out" }))
    expect(
      await screen.findByText("Sign-out is temporarily unavailable. Retry."),
    ).toBeTruthy()
  })
})

function mockNavigatorPlatform(platform: string) {
  vi.spyOn(window.navigator, "platform", "get").mockReturnValue(platform)
}
