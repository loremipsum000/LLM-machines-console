"use client"

import { TechnicalToolsPanel } from "@/components/technical-tools-panel"
import {
  updateAdminSettingsOrganizationAction,
  updateAdminSettingsTelemetryAction,
} from "@/lib/admin/actions-core"
import type { TechnicalToolLink } from "@/lib/admin/technical-tools"
import type { RetainedConsoleRole } from "@/lib/auth/role-claims"
import { cn } from "@/lib/utils"
import type {
  AdminSettingsResponse,
  AdminSettingsServiceId,
  InferenceCoreSourceStatus,
} from "@llm-machines/contracts/inference-core"
import { ChevronDown } from "lucide-react"
import { useState } from "react"
import type { ChangeEvent, ReactNode } from "react"
import { ConsoleActionToasts } from "./action-toasts"
import { AuditEvidencePanel } from "./audit-evidence-panel"
import { sourceStatusLabel } from "./source-status"

const returnTo = "/settings"
const settingsDateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeZone: "UTC",
  timeStyle: "short",
})
interface SettingsV2ExperienceProps {
  accessRole: RetainedConsoleRole
  settings: AdminSettingsResponse
  settingsAction?: string
  technicalTools?: TechnicalToolLink[]
}

export function SettingsV2Experience({
  accessRole,
  settings,
  settingsAction,
  technicalTools = [],
}: SettingsV2ExperienceProps) {
  const persistenceReady = settings.sourceStatus === "ok"
  return (
    <div className="w-full min-h-screen pb-16 pt-8 lg:pt-[73px]">
      <header>
        <h1 className="text-2xl font-semibold leading-none text-[#fdfdfd]">
          Settings
        </h1>
        <p className="mt-3 max-w-[600px] text-sm leading-5 text-[#b2b2b2]">
          Review appliance identity, maintenance posture, and privacy controls
          for the Console.
        </p>
        {accessRole === "operator" ? (
          <p className="mt-2 max-w-[600px] text-sm leading-5 text-[#8b8b8b]">
            Operator access is read-only. An Administrator manages organization,
            update, and telemetry settings.
          </p>
        ) : null}
      </header>

      <SettingsActionNotice
        settingsAction={persistenceReady ? settingsAction : undefined}
      />

      {!persistenceReady ? (
        <output className="mt-6 max-w-[640px] rounded-lg border border-[#51431c] bg-[#2b2414] p-3 text-sm leading-5 text-[#ffdb8a]">
          Settings storage is not configured. Identity and privacy values below
          are defaults or read-only source previews; persistent changes are
          disabled.
        </output>
      ) : null}

      <div className="mt-8 flex w-full flex-col gap-3 lg:w-[640px]">
        <OrganizationSettingsPanel
          accessRole={accessRole}
          persistenceReady={persistenceReady}
          settings={settings}
        />
        <SystemStatusPanel
          generatedAt={settings.generatedAt}
          services={settings.reachability}
        />
        <TechnicalToolsPanel tools={technicalTools} />
        <AuditEvidencePanel
          accessRole={accessRole}
          generatedAt={settings.generatedAt}
        />
        <UpdatesLicensePanel settings={settings} />
        <PrivacyPanel
          accessRole={accessRole}
          persistenceReady={persistenceReady}
          settings={settings}
        />
      </div>
    </div>
  )
}

function OrganizationSettingsPanel({
  accessRole,
  persistenceReady,
  settings,
}: {
  accessRole: RetainedConsoleRole
  persistenceReady: boolean
  settings: AdminSettingsResponse
}) {
  const { organization } = settings
  const [organizationUi, setOrganizationUi] = useState({
    defaultLanguage: organization.defaultLanguage,
    organizationName: organization.organizationName,
  })

  const isDirty =
    organizationUi.organizationName !== organization.organizationName ||
    organizationUi.defaultLanguage !== organization.defaultLanguage
  const isValid = organizationUi.organizationName.trim().length > 0
  const canMutate = accessRole === "admin" && persistenceReady

  function resetOrganizationForm() {
    setOrganizationUi({
      defaultLanguage: organization.defaultLanguage,
      organizationName: organization.organizationName,
    })
  }

  return (
    <section
      aria-labelledby="settings-organization-title"
      className="rounded-lg border border-[#353535] bg-[#232323] p-3"
    >
      <PanelHeading
        description={
          canMutate
            ? "Controls the customer-facing organization name and default language used by this appliance."
            : "Read-only customer-facing organization name and default language used by this appliance."
        }
        title="Organization"
      />
      {!canMutate ? (
        <div className="mt-3 grid gap-2">
          <ReadonlySettingRow
            label="Organization name"
            value={organization.organizationName}
          />
          <ReadonlySettingRow
            label="Default language"
            value={languageLabel(organization.defaultLanguage)}
          />
        </div>
      ) : (
        <form
          action={updateAdminSettingsOrganizationAction}
          className="mt-3 flex flex-col gap-3"
        >
          <input name="returnTo" type="hidden" value={returnTo} />

          <SettingsTextField
            label="Organization name"
            maxLength={120}
            name="organizationName"
            onChange={(event) =>
              setOrganizationUi((current) => ({
                ...current,
                organizationName: event.target.value,
              }))
            }
            required
            value={organizationUi.organizationName}
          />

          <SettingsSelect
            label="Default language"
            name="defaultLanguage"
            onChange={(event) =>
              setOrganizationUi((current) => ({
                ...current,
                defaultLanguage: event.target.value === "hr" ? "hr" : "en",
              }))
            }
            value={organizationUi.defaultLanguage}
          >
            <option className="bg-[#232323]" value="en">
              English
            </option>
            <option className="bg-[#232323]" value="hr">
              Croatian
            </option>
          </SettingsSelect>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              className={secondaryButtonClass}
              onClick={resetOrganizationForm}
              type="reset"
            >
              Reset changes
            </button>
            <button
              className={cn(primaryButtonClass, !isDirty && "opacity-50")}
              disabled={!isDirty || !isValid}
              type="submit"
            >
              Save changes
            </button>
          </div>
        </form>
      )}
    </section>
  )
}

function SystemStatusPanel({
  generatedAt,
  services,
}: {
  generatedAt: string
  services: AdminSettingsResponse["reachability"]
}) {
  return (
    <section
      aria-labelledby="settings-system-status-title"
      className="rounded-lg border border-[#353535] bg-[#232323] p-3"
    >
      <PanelHeading
        description="Read-only reachability summary for internal services used by the Console control plane."
        title="System Status"
      />
      <div className="mt-3 overflow-hidden rounded-lg border border-[#242424] bg-[#181818]">
        <table
          aria-label="Internal service reachability"
          className="w-full border-collapse text-left text-sm"
        >
          <thead>
            <tr className="h-11 border-b border-[#242424] text-xs text-white">
              <th className="px-2 font-medium">Service</th>
              <th className="px-2 font-medium">Status</th>
              <th className="px-2 font-medium">Owner</th>
              <th className="px-2 text-right font-medium">Checked</th>
            </tr>
          </thead>
          <tbody>
            {services.map((service) => (
              <tr
                className="h-10 border-b border-[#242424] last:border-b-0"
                key={service.id}
              >
                <td className="p-2 text-sm font-medium leading-5 text-white">
                  {service.label}
                </td>
                <td className="p-2">
                  <ServiceStatus status={service.status} />
                </td>
                <td className="p-2 text-xs leading-5 text-[#b2b2b2]">
                  {ownerLabel(service.owningSection, service.id)}
                </td>
                <td className="p-2 text-right text-xs leading-5 text-[#8b8b8b]">
                  {service.lastCheckedAt
                    ? formatDateTime(service.lastCheckedAt)
                    : "Not checked"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs leading-5 text-[#8b8b8b]">
        Generated {formatDateTime(generatedAt)}. Service addresses are not
        editable from this surface.
      </p>
    </section>
  )
}

function UpdatesLicensePanel({
  settings,
}: {
  settings: AdminSettingsResponse
}) {
  return (
    <section
      aria-labelledby="settings-updates-license-title"
      className="rounded-lg border border-[#353535] bg-[#232323] p-3"
    >
      <PanelHeading
        description="Shows local entitlement posture and platform maintenance readiness."
        title="Updates & License"
      />
      <div className="mt-3 grid gap-2">
        <ReadonlySettingRow
          label="License"
          value={licenseStateLabel(settings.license.subscriptionState)}
        />
        <ReadonlySettingRow
          label="Support"
          value={settings.license.supportState}
        />
        <ReadonlySettingRow
          label="Appliance ID"
          value={settings.license.applianceId ?? "Not configured"}
        />
        <ReadonlySettingRow
          label="Last entitlement check"
          value={
            settings.license.lastEntitlementCheckAt
              ? formatDateTime(settings.license.lastEntitlementCheckAt)
              : "Not checked"
          }
        />
        <ReadonlySettingRow
          label="System update"
          value={systemUpdateStateLabel(settings.systemUpdate.status)}
        />
        <div className="rounded-lg border border-[#353535] bg-[#181818] p-3">
          <p className="text-sm leading-5 text-[#b2b2b2]">
            {settings.systemUpdate.detail}
          </p>
          {settings.systemUpdate.affectedComponents.length > 0 ? (
            <p className="mt-2 text-xs leading-5 text-[#8b8b8b]">
              Components: {settings.systemUpdate.affectedComponents.join(", ")}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  )
}

function PrivacyPanel({
  accessRole,
  persistenceReady,
  settings,
}: {
  accessRole: RetainedConsoleRole
  persistenceReady: boolean
  settings: AdminSettingsResponse
}) {
  const [enableDialogOpen, setEnableDialogOpen] = useState(false)
  const preview = settings.privacy.telemetryPayloadPreview
  const canMutate = accessRole === "admin" && persistenceReady

  return (
    <section
      aria-labelledby="settings-privacy-title"
      className="rounded-lg border border-[#353535] bg-[#232323] p-3"
    >
      <PanelHeading
        description="Keeps telemetry explicit, default-off, and visible before any opt-in."
        title="Privacy"
      />
      <div className="mt-3 grid gap-2">
        <ReadonlySettingRow
          label="Telemetry"
          value={settings.privacy.telemetryEnabled ? "On" : "Off"}
        />
        <ReadonlySettingRow
          label="Data residency"
          value={settings.privacy.dataResidencyStatement}
        />
        <div className="rounded-lg border border-[#353535] bg-[#181818] p-3">
          <h3 className="text-sm font-semibold leading-[18px] text-white">
            Telemetry payload preview
          </h3>
          <dl className="mt-2 grid gap-2 text-xs leading-5 sm:grid-cols-[160px_1fr]">
            <PreviewTerm label="Appliance ID" value={preview.applianceId} />
            <PreviewTerm
              label="Installed version"
              value={preview.installedVersion}
            />
            <PreviewTerm
              label="Update agent"
              value={preview.updateAgentVersion}
            />
            <PreviewTerm
              label="Last update check"
              value={
                preview.lastUpdateCheck
                  ? formatDateTime(preview.lastUpdateCheck)
                  : null
              }
            />
            <PreviewTerm
              label="Last applied update"
              value={preview.lastAppliedUpdate}
            />
            <PreviewTerm
              label="Subscription state"
              value={licenseStateLabel(
                preview.subscriptionStateSeenByAppliance,
              )}
            />
          </dl>
        </div>
        <p className="text-sm leading-5 text-[#b2b2b2]">
          {settings.privacy.telemetryDescription}
        </p>
        {canMutate ? (
          <div className="flex justify-end">
            {settings.privacy.telemetryEnabled ? (
              <form action={updateAdminSettingsTelemetryAction}>
                <input name="returnTo" type="hidden" value={returnTo} />
                <button className={secondaryButtonClass} type="submit">
                  Disable telemetry
                </button>
              </form>
            ) : (
              <button
                className={primaryButtonClass}
                onClick={() => setEnableDialogOpen(true)}
                type="button"
              >
                Enable telemetry
              </button>
            )}
          </div>
        ) : (
          <p className="text-xs leading-5 text-[#8b8b8b]">
            {accessRole === "operator"
              ? "Telemetry changes require Administrator access."
              : "Telemetry changes require configured Settings storage."}
          </p>
        )}
      </div>

      {canMutate && enableDialogOpen ? (
        <EnableTelemetryDialog onCancel={() => setEnableDialogOpen(false)} />
      ) : null}
    </section>
  )
}

function EnableTelemetryDialog({ onCancel }: { onCancel: () => void }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
      <dialog
        aria-labelledby="enable-telemetry-title"
        className="w-full max-w-[380px] rounded-lg border border-[#353535] bg-[#232323] p-3 shadow-2xl"
        open
      >
        <h3
          className="text-lg font-semibold leading-[22px] text-white"
          id="enable-telemetry-title"
        >
          Enable telemetry?
        </h3>
        <p className="mt-2 text-sm leading-5 text-[#b2b2b2]">
          Only the previewed appliance and entitlement metadata will be allowed
          by this setting.
        </p>
        <form
          action={updateAdminSettingsTelemetryAction}
          className="mt-3 flex flex-col gap-3"
        >
          <input name="returnTo" type="hidden" value={returnTo} />
          <input name="enabled" type="hidden" value="on" />
          <SettingsTextField
            label="Type ENABLE TELEMETRY to confirm"
            name="confirmation"
            placeholder="ENABLE TELEMETRY"
            required
          />
          <div className="flex justify-end gap-2">
            <button
              className={secondaryButtonClass}
              onClick={onCancel}
              type="button"
            >
              Cancel
            </button>
            <button className={primaryButtonClass} type="submit">
              Enable telemetry
            </button>
          </div>
        </form>
      </dialog>
    </div>
  )
}

function SettingsActionNotice({
  settingsAction,
}: {
  settingsAction?: string
}) {
  if (!settingsAction) {
    return null
  }
  const message =
    settingsAction === "organizationSaved"
      ? { description: "Organization settings saved.", tone: "success" }
      : settingsAction === "telemetryEnabled"
        ? { description: "Telemetry enabled.", tone: "success" }
        : settingsAction === "telemetryDisabled"
          ? {
              description: "Telemetry disabled.",
              tone: "warning",
            }
          : {
              description: "Settings action failed.",
              tone: "danger",
            }

  return (
    <ConsoleActionToasts
      notifications={[
        {
          description: message.description,
          id: `settings-action-${settingsAction}`,
          title: "Settings",
          tone: message.tone as "danger" | "success" | "warning",
        },
      ]}
    />
  )
}

function PanelHeading({
  description,
  title,
}: {
  description: string
  title: string
}) {
  const slug = title
    .toLowerCase()
    .replaceAll(/[^a-z]+/g, "-")
    .replaceAll(/(^-|-$)/g, "")
  const id = `settings-${slug}-title`

  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-base font-semibold leading-[19px] text-white" id={id}>
        {title}
      </h2>
      <p className="text-sm leading-5 text-[#b2b2b2]">{description}</p>
    </div>
  )
}

function SettingsTextField({
  defaultValue,
  label,
  maxLength,
  minLength,
  name,
  onChange,
  placeholder,
  required = false,
  value,
}: {
  defaultValue?: string
  label: string
  maxLength?: number
  minLength?: number
  name: string
  onChange?: (event: ChangeEvent<HTMLInputElement>) => void
  placeholder?: string
  required?: boolean
  value?: string
}) {
  const inputClassName =
    "h-[43px] rounded-lg border border-[#353535] bg-[#232323] px-3 text-base font-medium leading-[19px] text-white placeholder:text-[#969696] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#009fff]"
  const inputId = `settings-${name}`

  return (
    <label
      className="flex flex-col gap-2 text-base font-medium leading-[19px] text-white"
      htmlFor={inputId}
    >
      <span>{label}</span>
      {onChange ? (
        <input
          className={inputClassName}
          id={inputId}
          maxLength={maxLength}
          minLength={minLength}
          name={name}
          onChange={onChange}
          placeholder={placeholder}
          required={required}
          type="text"
          value={value ?? ""}
        />
      ) : (
        <input
          className={inputClassName}
          defaultValue={defaultValue}
          id={inputId}
          maxLength={maxLength}
          minLength={minLength}
          name={name}
          placeholder={placeholder}
          required={required}
          type="text"
        />
      )}
    </label>
  )
}

function SettingsSelect({
  children,
  label,
  name,
  onChange,
  value,
}: {
  children: ReactNode
  label: string
  name: string
  onChange?: (event: ChangeEvent<HTMLSelectElement>) => void
  value?: string
}) {
  const selectClassName =
    "h-[43px] w-full appearance-none rounded-lg border border-[#353535] bg-[#232323] px-3 pr-8 text-base font-medium leading-[19px] text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#009fff]"
  const selectId = `settings-${name}`

  return (
    <label
      className="flex flex-col gap-2 text-base font-medium leading-[19px] text-white"
      htmlFor={selectId}
    >
      <span>{label}</span>
      <span className="relative">
        {onChange ? (
          <select
            className={selectClassName}
            id={selectId}
            name={name}
            onChange={onChange}
            value={value ?? ""}
          >
            {children}
          </select>
        ) : (
          <select
            className={selectClassName}
            defaultValue={value}
            id={selectId}
            name={name}
          >
            {children}
          </select>
        )}
        <ChevronDown
          aria-hidden
          className="pointer-events-none absolute right-2 top-[11px] size-5 text-white"
        />
      </span>
    </label>
  )
}

function ReadonlySettingRow({
  label,
  value,
}: {
  label: string
  value: string
}) {
  return (
    <div className="grid min-h-10 gap-1 rounded-lg border border-[#353535] bg-[#181818] p-3 sm:grid-cols-[160px_1fr] sm:items-center">
      <span className="text-sm font-semibold leading-[18px] text-white">
        {label}
      </span>
      <span className="text-sm leading-5 text-[#b2b2b2]">{value}</span>
    </div>
  )
}

function PreviewTerm({
  label,
  value,
}: { label: string; value: string | null }) {
  return (
    <>
      <dt className="font-medium text-white">{label}</dt>
      <dd className="break-all text-[#b2b2b2]">{value ?? "Not configured"}</dd>
    </>
  )
}

function languageLabel(language: "en" | "hr"): string {
  return language === "hr" ? "Croatian" : "English"
}

function ServiceStatus({ status }: { status: InferenceCoreSourceStatus }) {
  return (
    <span className="inline-flex items-center gap-2 text-xs font-medium leading-5 text-[#b2b2b2]">
      <span
        aria-hidden
        className={cn(
          "size-2.5 rounded-full",
          status === "ok" && "bg-[#78d957]",
          status === "degraded" && "bg-[#ffcc4d]",
          status === "unavailable" && "bg-[#ff6565]",
          status === "not_configured" && "bg-[#9f9f9f]",
        )}
      />
      {sourceStatusLabel(status)}
    </span>
  )
}

function ownerLabel(
  section: AdminSettingsResponse["reachability"][number]["owningSection"],
  serviceId: AdminSettingsServiceId,
): string {
  if (serviceId === "keycloak") {
    return "Team"
  }
  if (section === "applications") {
    return "Keys"
  }
  if (section === "inference") {
    return "Inference"
  }
  if (section === "hardware") {
    return "Hardware"
  }
  if (section === "team") {
    return "Team"
  }
  return "Settings"
}

function licenseStateLabel(
  state: AdminSettingsResponse["license"]["subscriptionState"],
): string {
  if (state === "active") {
    return "Active"
  }
  if (state === "soft_grace") {
    return "Grace period"
  }
  if (state === "restricted") {
    return "Restricted"
  }
  if (state === "terminated") {
    return "Terminated"
  }
  if (state === "unknown") {
    return "Unknown"
  }
  return "Not configured"
}

function systemUpdateStateLabel(
  state: AdminSettingsResponse["systemUpdate"]["status"],
): string {
  if (state === "no_updates") {
    return "No updates"
  }
  if (state === "available") {
    return "Available"
  }
  if (state === "blocked") {
    return "Blocked"
  }
  if (state === "running") {
    return "Running"
  }
  if (state === "failed") {
    return "Failed"
  }
  return "Not configured"
}

function formatDateTime(value: string): string {
  return settingsDateTimeFormatter.format(new Date(value))
}

const primaryButtonClass =
  "flex h-[30px] items-center justify-center rounded-md bg-[#2e2e2e] px-2.5 py-1.5 text-center text-sm font-medium leading-[18px] text-white transition-colors hover:bg-[#383838] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#009fff] disabled:cursor-not-allowed disabled:hover:bg-[#2e2e2e]"
const secondaryButtonClass =
  "flex h-[30px] items-center justify-center rounded-md border border-[#353535] bg-transparent px-2.5 py-1.5 text-center text-sm font-medium leading-[18px] text-white transition-colors hover:bg-[#2e2e2e] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#009fff]"
