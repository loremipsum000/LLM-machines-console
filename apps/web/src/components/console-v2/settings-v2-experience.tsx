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
  AdminSettingsLogoAsset,
  AdminSettingsResponse,
  AdminSettingsServiceId,
  InferenceCoreSourceStatus,
} from "@llm-machines/contracts/inference-core"
import { ChevronDown } from "lucide-react"
import Image from "next/image"
import { useRef, useState } from "react"
import type { ChangeEvent, ReactNode } from "react"
import { ConsoleActionToasts } from "./action-toasts"
import { sourceStatusLabel } from "./source-status"

const returnTo = "/settings"
const maxLogoBytes = 1024 * 1024
const supportedLogoTypes = ["image/png", "image/jpeg"]
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

interface LogoCandidate {
  error: string | null
  fileName: string
  height: number | null
  sizeBytes: number
  warning: string | null
  width: number | null
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
    clearFullLogo: false,
    clearIconLogo: false,
    defaultLanguage: organization.defaultLanguage,
    fullLogo: null as LogoCandidate | null,
    iconLogo: null as LogoCandidate | null,
    organizationName: organization.organizationName,
  })

  const hasFullLogoError = Boolean(organizationUi.fullLogo?.error)
  const hasIconLogoError = Boolean(organizationUi.iconLogo?.error)
  const isDirty =
    organizationUi.organizationName !== organization.organizationName ||
    organizationUi.defaultLanguage !== organization.defaultLanguage ||
    Boolean(organizationUi.fullLogo) ||
    Boolean(organizationUi.iconLogo) ||
    organizationUi.clearFullLogo ||
    organizationUi.clearIconLogo
  const isValid =
    organizationUi.organizationName.trim().length > 0 &&
    !hasFullLogoError &&
    !hasIconLogoError &&
    (!organizationUi.fullLogo ||
      (organizationUi.fullLogo.width !== null &&
        organizationUi.fullLogo.height !== null)) &&
    (!organizationUi.iconLogo ||
      (organizationUi.iconLogo.width !== null &&
        organizationUi.iconLogo.height !== null))
  const canMutate = accessRole === "admin" && persistenceReady

  function resetOrganizationForm() {
    setOrganizationUi({
      clearFullLogo: false,
      clearIconLogo: false,
      defaultLanguage: organization.defaultLanguage,
      fullLogo: null,
      iconLogo: null,
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
            ? "Controls the customer-facing name and Console shell branding used by this appliance."
            : "Read-only customer-facing name and Console shell branding used by this appliance."
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
          <ReadonlySettingRow
            label="Full logo"
            value={organization.fullLogo?.fileName ?? "Not configured"}
          />
          <ReadonlySettingRow
            label="Icon logo"
            value={organization.iconLogo?.fileName ?? "Not configured"}
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

          <LogoUploadField
            asset={organization.fullLogo}
            candidate={organizationUi.fullLogo}
            clearChecked={organizationUi.clearFullLogo}
            clearName="clearFullLogo"
            label="Full logo"
            name="fullLogo"
            onCandidateChange={(fullLogo) =>
              setOrganizationUi((current) => ({ ...current, fullLogo }))
            }
            onClearChange={(clearFullLogo) =>
              setOrganizationUi((current) => ({ ...current, clearFullLogo }))
            }
          />
          <LogoUploadField
            asset={organization.iconLogo}
            candidate={organizationUi.iconLogo}
            clearChecked={organizationUi.clearIconLogo}
            clearName="clearIconLogo"
            label="Icon logo"
            mustBeSquare
            name="iconLogo"
            onCandidateChange={(iconLogo) =>
              setOrganizationUi((current) => ({ ...current, iconLogo }))
            }
            onClearChange={(clearIconLogo) =>
              setOrganizationUi((current) => ({ ...current, clearIconLogo }))
            }
          />

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

function LogoUploadField({
  asset,
  candidate,
  clearChecked,
  clearName,
  label,
  mustBeSquare = false,
  name,
  onCandidateChange,
  onClearChange,
}: {
  asset: AdminSettingsLogoAsset | null
  candidate: LogoCandidate | null
  clearChecked: boolean
  clearName: string
  label: string
  mustBeSquare?: boolean
  name: "fullLogo" | "iconLogo"
  onCandidateChange: (candidate: LogoCandidate | null) => void
  onClearChange: (checked: boolean) => void
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const inputId = `${name}-input`
  const helperId = `${name}-helper`
  const errorId = `${name}-error`

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) {
      onCandidateChange(null)
      return
    }

    const next: LogoCandidate = {
      error: validateLogoFile(file, mustBeSquare),
      fileName: file.name,
      height: null,
      sizeBytes: file.size,
      warning: logoCandidateWarning(file, mustBeSquare, null),
      width: null,
    }
    onCandidateChange(next)
    onClearChange(false)

    if (!next.error) {
      readImageDimensions(file, (dimensions) => {
        if (!dimensions) {
          onCandidateChange({
            ...next,
            error: "Could not read image dimensions.",
          })
          return
        }
        const squareError =
          mustBeSquare && dimensions.width !== dimensions.height
            ? "Icon logo must be square."
            : null
        onCandidateChange({
          ...next,
          error: squareError,
          height: dimensions.height,
          warning: logoCandidateWarning(file, mustBeSquare, dimensions),
          width: dimensions.width,
        })
      })
    }
  }

  const width = candidate?.width ?? asset?.width ?? ""
  const height = candidate?.height ?? asset?.height ?? ""
  const hasValidCandidate = Boolean(candidate && !candidate.error)
  const title = mustBeSquare ? "Icon logo" : "Full logo"
  const emptyLabel = mustBeSquare ? "Choose icon logo" : "Choose full logo"
  const replaceLabel = mustBeSquare ? "Replace icon logo" : "Replace full logo"
  const chooseAnotherLabel = mustBeSquare
    ? "Choose another icon logo"
    : "Choose another full logo"
  const removeLabel = mustBeSquare ? "Remove icon logo" : "Remove full logo"
  const undoLabel = mustBeSquare
    ? "Undo icon logo removal"
    : "Undo full logo removal"
  const chooseLabel = candidate
    ? chooseAnotherLabel
    : asset
      ? replaceLabel
      : emptyLabel

  function openFilePicker() {
    inputRef.current?.click()
  }

  function removeAsset() {
    onCandidateChange(null)
    onClearChange(true)
    if (inputRef.current) {
      inputRef.current.value = ""
    }
  }

  function undoRemoveAsset() {
    onClearChange(false)
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="sr-only" htmlFor={inputId}>
        {label}
      </label>
      <input
        aria-describedby={`${helperId}${candidate?.error ? ` ${errorId}` : ""}`}
        accept="image/png,image/jpeg"
        className="sr-only"
        id={inputId}
        name={name}
        onChange={handleFileChange}
        ref={inputRef}
        type="file"
      />
      <input name={`${name}Width`} type="hidden" value={width} />
      <input name={`${name}Height`} type="hidden" value={height} />
      {asset ? (
        <input
          aria-label={`Clear ${label}`}
          checked={clearChecked}
          className="sr-only"
          name={clearName}
          readOnly
          type="checkbox"
        />
      ) : null}

      <div className="rounded-lg border border-[#353535] bg-[#232323] p-3">
        <div className="grid gap-3 sm:grid-cols-[1fr_220px] sm:items-start">
          <LogoUploadStatus
            asset={asset}
            candidate={candidate}
            clearChecked={clearChecked}
            errorId={errorId}
            helperId={helperId}
            mustBeSquare={mustBeSquare}
            title={title}
          />
          <div className="flex min-w-0 flex-col gap-2 sm:items-end sm:text-right">
            <LogoUploadDetails
              asset={asset}
              candidate={candidate}
              clearChecked={clearChecked}
              hasValidCandidate={hasValidCandidate}
              label={label}
              mustBeSquare={mustBeSquare}
            />
            <LogoUploadActions
              asset={asset}
              chooseLabel={chooseLabel}
              clearChecked={clearChecked}
              onChoose={openFilePicker}
              onRemove={removeAsset}
              onUndoRemove={undoRemoveAsset}
              removeLabel={removeLabel}
              undoLabel={undoLabel}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

function LogoUploadStatus({
  asset,
  candidate,
  clearChecked,
  errorId,
  helperId,
  mustBeSquare,
  title,
}: {
  asset: AdminSettingsLogoAsset | null
  candidate: LogoCandidate | null
  clearChecked: boolean
  errorId: string
  helperId: string
  mustBeSquare: boolean
  title: string
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-base font-medium leading-[19px] text-white">
          {title}
        </span>
        <LogoStatusPill
          asset={asset}
          candidate={candidate}
          clearChecked={clearChecked}
        />
      </div>
      <p className="text-sm leading-5 text-[#b2b2b2]" id={helperId}>
        PNG or JPEG, max 1 MiB
        {mustBeSquare ? ", 1:1 ratio required" : ""}.
      </p>
      {candidate?.error ? (
        <p
          className="text-xs font-medium leading-5 text-[#ff595d]"
          id={errorId}
        >
          {candidate.error}
        </p>
      ) : candidate?.warning ? (
        <p className="text-xs font-medium leading-5 text-[#ffcc4d]">
          {candidate.warning}
        </p>
      ) : null}
    </div>
  )
}

function LogoStatusPill({
  asset,
  candidate,
  clearChecked,
}: {
  asset: AdminSettingsLogoAsset | null
  candidate: LogoCandidate | null
  clearChecked: boolean
}) {
  if (candidate) {
    return (
      <span
        className={cn(
          "inline-flex h-6 items-center rounded-full border px-2 text-xs font-medium leading-none",
          candidate.error
            ? "border-[#4e2527] bg-[#321f20] text-[#ff595d]"
            : "border-[#3a3422] bg-[#2e2818] text-[#ffcc4d]",
        )}
      >
        {candidate.error ? "Needs attention" : "Replacement pending"}
      </span>
    )
  }
  if (clearChecked) {
    return (
      <span className="inline-flex h-6 items-center rounded-full border border-[#3a3422] bg-[#2e2818] px-2 text-xs font-medium leading-none text-[#ffcc4d]">
        Removal pending
      </span>
    )
  }
  if (asset) {
    return (
      <span className="inline-flex h-6 items-center rounded-full border border-[#265d3b] bg-[#152c20] px-2 text-xs font-medium leading-none text-[#78d957]">
        Current
      </span>
    )
  }
  return (
    <span className="inline-flex h-6 items-center rounded-full border border-[#353535] bg-[#181818] px-2 text-xs font-medium leading-none text-[#8b8b8b]">
      Empty
    </span>
  )
}

function LogoUploadDetails({
  asset,
  candidate,
  clearChecked,
  hasValidCandidate,
  label,
  mustBeSquare,
}: {
  asset: AdminSettingsLogoAsset | null
  candidate: LogoCandidate | null
  clearChecked: boolean
  hasValidCandidate: boolean
  label: string
  mustBeSquare: boolean
}) {
  return (
    <>
      {asset ? (
        <Image
          alt={`${label} preview`}
          className={cn(
            "max-h-12 max-w-[120px] rounded border border-[#353535] object-contain",
            mustBeSquare && "size-12",
            clearChecked && "opacity-40 grayscale",
          )}
          height={48}
          unoptimized
          src={asset.dataUrl}
          width={mustBeSquare ? 48 : 120}
        />
      ) : null}
      <div className="grid w-full gap-2 text-sm leading-5">
        <LogoCurrentFileMeta asset={asset} clearChecked={clearChecked} />
        {candidate ? (
          <LogoCandidateMeta
            asset={asset}
            candidate={candidate}
            hasValidCandidate={hasValidCandidate}
          />
        ) : null}
      </div>
    </>
  )
}

function LogoCurrentFileMeta({
  asset,
  clearChecked,
}: {
  asset: AdminSettingsLogoAsset | null
  clearChecked: boolean
}) {
  if (!asset) {
    return (
      <LogoMetaRow alignRight label="Current file" value="No logo uploaded" />
    )
  }
  return (
    <>
      <LogoMetaRow
        alignRight
        label={clearChecked ? "Active until saved" : "Current file"}
        value={asset.fileName}
      />
      <LogoMetaRow
        alignRight
        label="Dimensions"
        value={formatDimensions(asset.width, asset.height)}
      />
      <LogoMetaRow
        alignRight
        label="Size"
        value={formatBytes(asset.sizeBytes)}
      />
      <LogoMetaRow
        alignRight
        label="Checksum"
        value={formatShortChecksum(asset.checksum)}
      />
      <LogoMetaRow
        alignRight
        label="Updated"
        value={formatDateTime(asset.updatedAt)}
      />
    </>
  )
}

function LogoCandidateMeta({
  asset,
  candidate,
  hasValidCandidate,
}: {
  asset: AdminSettingsLogoAsset | null
  candidate: LogoCandidate
  hasValidCandidate: boolean
}) {
  return (
    <div className="rounded-md border border-[#353535] bg-[#181818] p-2 text-left sm:text-right">
      <LogoMetaRow
        alignRight
        label={hasValidCandidate ? "Pending file" : "Rejected file"}
        value={candidate.fileName}
      />
      <LogoMetaRow
        alignRight
        label="Size"
        value={formatBytes(candidate.sizeBytes)}
      />
      {candidate.width && candidate.height ? (
        <LogoMetaRow
          alignRight
          label="Dimensions"
          value={formatDimensions(candidate.width, candidate.height)}
        />
      ) : hasValidCandidate ? (
        <LogoMetaRow
          alignRight
          label="Dimensions"
          value="Reading image dimensions"
        />
      ) : null}
      {asset && candidate.error ? (
        <p className="mt-2 text-xs leading-5 text-[#8b8b8b]">
          Existing logo remains active until a valid change is saved.
        </p>
      ) : null}
    </div>
  )
}

function LogoUploadActions({
  asset,
  chooseLabel,
  clearChecked,
  onChoose,
  onRemove,
  onUndoRemove,
  removeLabel,
  undoLabel,
}: {
  asset: AdminSettingsLogoAsset | null
  chooseLabel: string
  clearChecked: boolean
  onChoose: () => void
  onRemove: () => void
  onUndoRemove: () => void
  removeLabel: string
  undoLabel: string
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 sm:justify-end">
      <button className={secondaryButtonClass} onClick={onChoose} type="button">
        {chooseLabel}
      </button>
      {asset && !clearChecked ? (
        <button className={dangerButtonClass} onClick={onRemove} type="button">
          {removeLabel}
        </button>
      ) : null}
      {asset && clearChecked ? (
        <button
          className={secondaryButtonClass}
          onClick={onUndoRemove}
          type="button"
        >
          {undoLabel}
        </button>
      ) : null}
    </div>
  )
}

function LogoMetaRow({
  alignRight = false,
  label,
  value,
}: {
  alignRight?: boolean
  label: string
  value: string
}) {
  return (
    <div
      className={cn(
        "grid gap-1",
        alignRight
          ? "sm:grid-cols-1 sm:justify-items-end"
          : "sm:grid-cols-[116px_1fr]",
      )}
    >
      <span className="text-xs font-medium leading-5 text-[#8b8b8b]">
        {label}
      </span>
      <span className="min-w-0 break-all text-sm leading-5 text-[#dfdfdf]">
        {value}
      </span>
    </div>
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
      : settingsAction === "invalidLogo"
        ? {
            description: "Logo upload failed validation.",
            tone: "danger",
          }
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

function validateLogoFile(file: File, mustBeSquare: boolean): string | null {
  if (!supportedLogoTypes.includes(file.type)) {
    return "Logo must be PNG or JPEG."
  }
  if (file.size > maxLogoBytes) {
    return "Logo must be at or below 1 MiB."
  }
  if (mustBeSquare) {
    return null
  }
  return null
}

function logoCandidateWarning(
  file: File,
  mustBeSquare: boolean,
  dimensions: { height: number; width: number } | null,
): string | null {
  if (file.size > maxLogoBytes * 0.9) {
    return "This file is close to the 1 MiB limit."
  }
  if (!dimensions) {
    return null
  }
  if (!mustBeSquare && dimensions.width <= dimensions.height) {
    return "This logo is tall or square and may appear small in the Console header."
  }
  if (mustBeSquare && dimensions.width < 256) {
    return "This square icon is below 256 x 256 and may appear soft on high-density displays."
  }
  return null
}

function readImageDimensions(
  file: File,
  onResult: (dimensions: { height: number; width: number } | null) => void,
) {
  if (typeof window === "undefined") {
    onResult(null)
    return
  }
  const image = new window.Image()
  const url = URL.createObjectURL(file)
  image.onload = () => {
    URL.revokeObjectURL(url)
    onResult({
      height: image.naturalHeight,
      width: image.naturalWidth,
    })
  }
  image.onerror = () => {
    URL.revokeObjectURL(url)
    onResult(null)
  }
  image.src = url
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

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`
  }
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KiB`
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`
}

function formatDimensions(width: number, height: number): string {
  return `${width} x ${height}`
}

function formatShortChecksum(checksum: string): string {
  return checksum.length > 22 ? `${checksum.slice(0, 22)}...` : checksum
}

function formatDateTime(value: string): string {
  return settingsDateTimeFormatter.format(new Date(value))
}

const primaryButtonClass =
  "flex h-[30px] items-center justify-center rounded-md bg-[#2e2e2e] px-2.5 py-1.5 text-center text-sm font-medium leading-[18px] text-white transition-colors hover:bg-[#383838] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#009fff] disabled:cursor-not-allowed disabled:hover:bg-[#2e2e2e]"
const secondaryButtonClass =
  "flex h-[30px] items-center justify-center rounded-md border border-[#353535] bg-transparent px-2.5 py-1.5 text-center text-sm font-medium leading-[18px] text-white transition-colors hover:bg-[#2e2e2e] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#009fff]"
const dangerButtonClass =
  "flex h-[30px] items-center justify-center rounded-md bg-[#321f20] px-2.5 py-1.5 text-center text-sm font-medium leading-[18px] text-[#ff595d] transition-colors hover:bg-[#432527] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#009fff]"
