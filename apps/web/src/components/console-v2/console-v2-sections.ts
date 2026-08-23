import type { RetainedConsoleRole } from "@/lib/auth/role-claims"
import type { ComponentType, SVGProps } from "react"
import {
  ActivityIcon,
  HardwareIcon,
  InferenceIcon,
  KeysIcon,
  OverviewIcon,
  SettingsIcon,
  TeamIcon,
} from "./console-v2-icons"

export type ConsoleV2SectionId =
  | "overview"
  | "applications"
  | "inference"
  | "hardware"
  | "team"
  | "activity"
  | "settings"

export interface ConsoleV2Section {
  id: ConsoleV2SectionId
  href: string
  icon: ComponentType<SVGProps<SVGSVGElement>>
  label: string
}

export const consoleV2Sections: ConsoleV2Section[] = [
  {
    id: "overview",
    href: "/",
    icon: OverviewIcon,
    label: "Overview",
  },
  {
    id: "applications",
    href: "/keys",
    icon: KeysIcon,
    label: "Keys",
  },
  {
    id: "inference",
    href: "/inference",
    icon: InferenceIcon,
    label: "Inference",
  },
  {
    id: "hardware",
    href: "/hardware",
    icon: HardwareIcon,
    label: "Hardware",
  },
  {
    id: "team",
    href: "/team",
    icon: TeamIcon,
    label: "Team",
  },
  {
    id: "activity",
    href: "/activity",
    icon: ActivityIcon,
    label: "Activity & Audit",
  },
  {
    id: "settings",
    href: "/settings",
    icon: SettingsIcon,
    label: "Settings",
  },
]

export function consoleV2SectionsForRole(
  role: RetainedConsoleRole,
): ConsoleV2Section[] {
  return consoleV2Sections.filter((section) =>
    roleCanAccessConsoleSection(role, section.id),
  )
}

export function roleCanAccessConsoleSection(
  role: RetainedConsoleRole,
  _section: ConsoleV2SectionId,
): boolean {
  return role === "admin" || role === "operator"
}
