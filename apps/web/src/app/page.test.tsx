import { afterEach, describe, expect, it, vi } from "vitest"
import ActivityPage, { dynamic as activityDynamic } from "./activity/page"
import ApplicationsPage, {
  dynamic as applicationsDynamic,
} from "./applications/[[...section]]/page"
import HardwarePage, { dynamic as hardwareDynamic } from "./hardware/page"
import InferencePage, {
  dynamic as inferenceDynamic,
} from "./inference/[[...section]]/page"
import HomePage, { dynamic as homeDynamic } from "./page"
import SettingsPage, { dynamic as settingsDynamic } from "./settings/page"
import TeamPage, { dynamic as teamDynamic } from "./team/[[...section]]/page"

const navigationMocks = vi.hoisted(() => ({
  redirect: vi.fn((href: string) => {
    throw new Error(`redirect:${href}`)
  }),
}))

const routeMocks = vi.hoisted(() => ({
  renderActivityConsoleRoute: vi.fn(async () => null),
  renderApplicationsConsoleRoute: vi.fn(async () => null),
  renderHardwareConsoleRoute: vi.fn(async () => null),
  renderInferenceConsoleRoute: vi.fn(async () => null),
  renderOverviewConsoleRoute: vi.fn(async () => null),
  renderSettingsConsoleRoute: vi.fn(async () => null),
  renderTeamConsoleRoute: vi.fn(async () => null),
}))

vi.mock("next/navigation", () => ({
  redirect: navigationMocks.redirect,
}))

vi.mock("@/lib/admin/console-v2-routes-core", () => routeMocks)

describe("retained Console routes", () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it("renders Overview directly at the root route", async () => {
    await HomePage()

    expect(routeMocks.renderOverviewConsoleRoute).toHaveBeenCalledOnce()
    expect(navigationMocks.redirect).not.toHaveBeenCalled()
  })

  it("keeps every retained page dynamic", () => {
    expect([
      applicationsDynamic,
      activityDynamic,
      homeDynamic,
      hardwareDynamic,
      inferenceDynamic,
      settingsDynamic,
      teamDynamic,
    ]).toEqual(Array(7).fill("force-dynamic"))
  })

  it("routes Activity through the retained core owner", async () => {
    const searchParams = Promise.resolve({ eventId: "event-1" })

    await ActivityPage({ searchParams })

    expect(routeMocks.renderActivityConsoleRoute).toHaveBeenCalledWith(
      searchParams,
    )
  })

  it("routes Applications through the retained core owner", async () => {
    const searchParams = Promise.resolve({ appAction: "created" })

    await ApplicationsPage({
      params: Promise.resolve({ section: ["apps", "app-1"] }),
      searchParams,
    })

    expect(routeMocks.renderApplicationsConsoleRoute).toHaveBeenCalledWith({
      section: ["apps", "app-1"],
      searchParams,
    })
  })

  it("routes Hardware through the retained core owner", async () => {
    const searchParams = Promise.resolve({ range: "24h" })

    await HardwarePage({ searchParams })

    expect(routeMocks.renderHardwareConsoleRoute).toHaveBeenCalledWith(
      searchParams,
    )
  })

  it("routes Inference through the retained core owner", async () => {
    const searchParams = Promise.resolve({ range: "7d" })

    await InferencePage({
      params: Promise.resolve({}),
      searchParams,
    })

    expect(routeMocks.renderInferenceConsoleRoute).toHaveBeenCalledWith({
      section: undefined,
      searchParams,
    })
  })

  it("routes Settings through the retained core owner", async () => {
    const searchParams = Promise.resolve({ settingsAction: "saved" })

    await SettingsPage({ searchParams })

    expect(routeMocks.renderSettingsConsoleRoute).toHaveBeenCalledWith(
      searchParams,
    )
  })

  it("routes Team through the retained core owner", async () => {
    const searchParams = Promise.resolve({ teamAction: "saved" })

    await TeamPage({
      params: Promise.resolve({ section: ["members", "operator-1"] }),
      searchParams,
    })

    expect(routeMocks.renderTeamConsoleRoute).toHaveBeenCalledWith({
      section: ["members", "operator-1"],
      searchParams,
    })
  })
})
