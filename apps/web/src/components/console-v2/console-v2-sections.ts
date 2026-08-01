import type { RetainedConsoleRole } from "@/lib/auth/role-claims"
import type { ComponentType, SVGProps } from "react"
import {
  ApplicationsIcon,
  HardwareIcon,
  InferenceIcon,
  SettingsIcon,
  TeamIcon,
} from "./console-v2-icons"

export type ConsoleV2SectionId =
  | "activity"
  | "applications"
  | "inference"
  | "hardware"
  | "team"
  | "settings"

export interface ConsoleV2Section {
  id: ConsoleV2SectionId
  href: string
  icon: ComponentType<SVGProps<SVGSVGElement>>
  label: string
}

export const consoleV2Sections: ConsoleV2Section[] = [
  {
    id: "applications",
    href: "/applications",
    icon: ApplicationsIcon,
    label: "Applications",
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
  section: ConsoleV2SectionId,
): boolean {
  return role === "admin" || section !== "settings"
}
