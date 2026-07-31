import { fireEvent, render, screen, within } from "@testing-library/react"
import React from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ConsoleV2Shell } from "./console-v2-shell"

const navigationMocks = vi.hoisted(() => ({
  router: {
    push: vi.fn(),
  },
}))

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
  })

  it("routes to numbered Console sections with Command shortcuts", () => {
    mockNavigatorPlatform("MacIntel")
    render(
      <ConsoleV2Shell activeSection="applications">
        <h1>Applications</h1>
      </ConsoleV2Shell>,
    )

    const navigation = screen.getByRole("navigation", {
      name: "Console v2 navigation",
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
      <ConsoleV2Shell activeSection="applications">
        <h1>Applications</h1>
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
      <ConsoleV2Shell activeSection="applications">
        <h1>Applications</h1>
      </ConsoleV2Shell>,
    )

    fireEvent.keyDown(window, { key: "2", metaKey: true })
    unmount()

    render(
      <ConsoleV2Shell activeSection="inference">
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
      <ConsoleV2Shell activeSection="applications">
        <h1>Applications</h1>
      </ConsoleV2Shell>,
    )

    const navigation = screen.getByRole("navigation", {
      name: "Console v2 navigation",
    })
    expect(
      within(navigation)
        .getByRole("link", { name: "Applications" })
        .getAttribute("aria-keyshortcuts"),
    ).toBe("Control+1")
    expect(screen.getByText("Ctrl 1")).toBeTruthy()

    fireEvent.keyDown(window, { ctrlKey: true, key: "5" })

    expect(navigationMocks.router.push).toHaveBeenCalledWith("/settings")

    fireEvent.keyUp(window, { key: "Control" })
  })

  it("omits retired product navigation and footer links", () => {
    render(
      <ConsoleV2Shell activeSection="applications">
        <h1>Applications</h1>
      </ConsoleV2Shell>,
    )

    expect(screen.queryByRole("link", { name: "Knowledge" })).toBeNull()
    expect(screen.queryByRole("link", { name: "Help" })).toBeNull()
    expect(screen.queryByRole("link", { name: "Documentation" })).toBeNull()
  })
})

function mockNavigatorPlatform(platform: string) {
  vi.spyOn(window.navigator, "platform", "get").mockReturnValue(platform)
}
