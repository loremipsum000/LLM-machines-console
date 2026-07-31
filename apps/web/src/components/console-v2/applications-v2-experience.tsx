"use client"

import {
  type ConnectedAppCreateActionState,
  type ConnectedAppCredentialActionState,
  type ConnectedAppTestActionState,
  createAdminConnectedAppAction,
  disableAdminConnectedAppAction,
  rotateAdminConnectedAppCredentialsAction,
  testAdminConnectedAppConnectionAction,
} from "@/lib/admin/actions-core"
import { cn } from "@/lib/utils"
import type {
  AdminConnectedApp,
  AdminConnectedAppCredential,
  AdminInferenceModel,
  AdminTeamGroup,
} from "@llm-machines/contracts/inference-core"
import type { RetainedConsoleRole } from "@/lib/auth/role-claims"
import { ArrowLeft, ChevronDown, Copy, Plus } from "lucide-react"
import Link from "next/link"
import { useActionState, useState } from "react"
import { ConsoleActionToasts } from "./action-toasts"

export type ApplicationsView = "app-detail" | "new-app" | "overview"

const initialConnectedAppCreateState: ConnectedAppCreateActionState = {
  app: null,
  credential: null,
  error: null,
  status: "idle",
}

const initialConnectedAppTestState: ConnectedAppTestActionState = {
  app: null,
  detail: null,
  error: null,
  status: "idle",
  testedAt: null,
}

const initialConnectedAppCredentialState: ConnectedAppCredentialActionState = {
  app: null,
  credential: null,
  detail: null,
  error: null,
  status: "idle",
}

const EMPTY_CONNECTED_APPS: AdminConnectedApp[] = []
const EMPTY_MODEL_OPTIONS: AdminInferenceModel[] = []
const EMPTY_TEAM_GROUPS: AdminTeamGroup[] = []
const applicationsDateTimeFormatter = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
})
const applicationsCompactNumberFormatter = new Intl.NumberFormat("en", {
  maximumFractionDigits: 1,
  notation: "compact",
})

export function ApplicationsV2Experience({
  accessRole,
  appAction,
  connectedAppDetail,
  connectedApps = EMPTY_CONNECTED_APPS,
  modelOptions = EMPTY_MODEL_OPTIONS,
  teamGroups = EMPTY_TEAM_GROUPS,
  view,
}: {
  accessRole: RetainedConsoleRole
  appAction?: string
  connectedAppDetail?: AdminConnectedApp | null
  connectedApps?: AdminConnectedApp[]
  modelOptions?: AdminInferenceModel[]
  teamGroups?: AdminTeamGroup[]
  view: ApplicationsView
}) {
  if (view === "new-app") {
    return (
      <AddConnectedAppView
        groupOptions={teamGroupOptions(teamGroups)}
        modelOptions={modelOptions}
      />
    )
  }
  if (view === "app-detail") {
    return (
      <ConnectedAppDetailView
        app={connectedAppDetail ?? null}
        appAction={appAction}
      />
    )
  }

  return (
    <div className="w-full min-h-screen min-h-dvh pb-16 pt-8 lg:pt-[73px]">
      <PageHeader title="Applications" />
      <AppActionNotice appAction={appAction} />
      <div className="mt-10 w-full lg:w-[640px]">
        <ConnectedAppsPanel accessRole={accessRole} apps={connectedApps} />
      </div>
    </div>
  )
}

function AddConnectedAppView({
  groupOptions,
  modelOptions,
}: {
  groupOptions: string[]
  modelOptions: AdminInferenceModel[]
}) {
  const [createState, createAction] = useActionState(
    createAdminConnectedAppAction,
    initialConnectedAppCreateState,
  )
  const [testState, testAction] = useActionState(
    testAdminConnectedAppConnectionAction,
    initialConnectedAppTestState,
  )
  const [authMethod, setAuthMethod] = useState<
    "api_key" | "oauth_client_credentials"
  >("api_key")
  const hasModels = modelOptions.length > 0

  return (
    <div className="w-full min-h-screen min-h-dvh pb-16 pt-8 lg:pt-[73px]">
      <SubpageHeader title="Applications > Add app" />
      <div className="mt-10 flex w-full flex-col gap-3 lg:w-[640px]">
        <form
          action={createAction}
          className="flex flex-col gap-3 rounded-lg border border-[#353535] bg-[#232323] p-4"
        >
          <input name="authMethod" type="hidden" value={authMethod} />
          <ApplicationTextField
            label="Name"
            name="name"
            placeholder="Customer application"
          />
          <ApplicationTextField
            label="Description"
            name="description"
            placeholder="What workflow will use this credential"
          />
          <SegmentedControl
            label="Authentication"
            options={[
              {
                active: authMethod === "api_key",
                label: "API key",
                onSelect: () => setAuthMethod("api_key"),
              },
              {
                active: authMethod === "oauth_client_credentials",
                label: "OAuth",
                onSelect: () => setAuthMethod("oauth_client_credentials"),
              },
            ]}
          />
          <label className="grid gap-2 text-sm font-medium text-white">
            Owner group
            <span className="relative">
              <select
                className="h-11 w-full appearance-none rounded-lg border border-[#353535] bg-[#181818] px-3 pr-9 text-white outline-none focus:border-[#009fff]"
                defaultValue="Everyone"
                name="ownerGroup"
              >
                {groupOptions.map((group) => (
                  <option key={group} value={group}>
                    {group}
                  </option>
                ))}
              </select>
              <ChevronDown
                aria-hidden
                className="pointer-events-none absolute right-3 top-3 size-5"
              />
            </span>
          </label>
          <fieldset className="grid gap-2">
            <legend className="text-sm font-medium text-white">
              Allowed models
            </legend>
            {hasModels ? (
              modelOptions.map((model, index) => (
                <label
                  className="flex items-center gap-3 rounded-lg border border-[#353535] bg-[#181818] px-3 py-2 text-sm text-white"
                  key={model.id}
                >
                  <input
                    aria-label={model.name}
                    defaultChecked={index === 0}
                    name="allowedModels"
                    type="checkbox"
                    value={model.id}
                  />
                  <span className="min-w-0 flex-1 truncate">{model.name}</span>
                  <span className="text-[#8b8b8b]">
                    {model.provider ?? "Local"}
                  </span>
                </label>
              ))
            ) : (
              <p className="text-sm text-[#b2b2b2]">
                No served models are available yet.
              </p>
            )}
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-2">
            <ApplicationTextField
              label="Rate limit per minute"
              name="rateLimitRpm"
              placeholder="Disabled"
            />
            <ApplicationTextField
              label="Seven-day token limit"
              name="tokenBudget7d"
              placeholder="Disabled"
            />
          </div>
          <ConnectedAppCreateStatus state={createState} />
          <div className="flex justify-end gap-2">
            <Link className={secondaryButtonClass} href="/applications">
              Cancel
            </Link>
            <button
              className={primaryButtonClass}
              disabled={!hasModels}
              type="submit"
            >
              Create app
            </button>
          </div>
        </form>

        {createState.status === "created" &&
        createState.app &&
        createState.credential ? (
          <ConnectedAppCredentialPanel
            app={createState.app}
            credential={createState.credential}
            testAction={testAction}
            testState={testState}
          />
        ) : null}
      </div>
    </div>
  )
}

function ConnectedAppDetailView({
  app,
  appAction,
}: {
  app: AdminConnectedApp | null
  appAction?: string
}) {
  const [showDisableConfirm, setShowDisableConfirm] = useState(false)
  const [testState, testAction] = useActionState(
    testAdminConnectedAppConnectionAction,
    initialConnectedAppTestState,
  )
  const [rotateState, rotateAction] = useActionState(
    rotateAdminConnectedAppCredentialsAction,
    initialConnectedAppCredentialState,
  )

  if (!app) {
    return (
      <div className="w-full min-h-screen min-h-dvh pb-16 pt-8 lg:pt-[73px]">
        <SubpageHeader title="Applications > App settings" />
        <p className="mt-10 rounded-lg border border-[#353535] bg-[#232323] p-4 text-sm text-[#b2b2b2] lg:w-[640px]">
          This connected app is not available.
        </p>
      </div>
    )
  }

  const currentApp = rotateState.app ?? testState.app ?? app
  const credentialState = currentApp.environments[0] ?? null

  return (
    <div className="w-full min-h-screen min-h-dvh pb-16 pt-8 lg:pt-[73px]">
      <SubpageHeader title={`Applications > ${currentApp.name}`} />
      <div className="mt-10 flex w-full flex-col gap-3 lg:w-[640px]">
        <AppActionNotice appAction={appAction} />
        <section className="grid gap-3 rounded-lg border border-[#353535] bg-[#232323] p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="truncate text-lg font-semibold text-white">
                {currentApp.name}
              </h2>
              <p className="mt-1 text-sm text-[#b2b2b2]">
                {currentApp.description}
              </p>
            </div>
            <StatusPill status={currentApp.status} />
          </div>
          <DetailRow label="Owner group" value={currentApp.ownerGroup} />
          <DetailRow
            label="Allowed models"
            value={currentApp.allowedModels.join(", ")}
          />
          <DetailRow
            label="Rate limit"
            value={formatNullableLimit(currentApp.rateLimitRpm, " rpm")}
          />
          <DetailRow
            label="Token limit"
            value={formatNullableLimit(currentApp.tokenBudget7d, " / 7 days")}
          />
          <DetailRow
            label="Credential age"
            value={formatCredentialAge(credentialState?.credentialIssuedAt)}
          />
          <DetailRow
            label="Last use"
            value={dateTimeLabel(
              credentialState?.lastUsedAt ?? currentApp.usage.lastUsedAt,
            )}
          />
          <DetailRow
            label="Connection status"
            value={connectionStatusLabel(credentialState?.testStatus)}
          />
          <ConnectedAppTestStatus state={testState} />
          <CredentialActionStatus state={rotateState} />
          <div className="flex flex-wrap justify-end gap-2">
            <form action={testAction}>
              <input name="appId" type="hidden" value={currentApp.id} />
              <button className={primaryButtonClass} type="submit">
                Test connection
              </button>
            </form>
            <form action={rotateAction}>
              <input name="appId" type="hidden" value={currentApp.id} />
              <button className={secondaryButtonClass} type="submit">
                Rotate credentials
              </button>
            </form>
            <button
              className={dangerButtonClass}
              onClick={() => setShowDisableConfirm(true)}
              type="button"
            >
              Disable app
            </button>
          </div>
        </section>

        {rotateState.credential ? (
          <ConnectedAppCredentialDetails
            credential={rotateState.credential}
            title="Rotated credential"
          />
        ) : null}
      </div>

      {showDisableConfirm ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
          <dialog
            aria-labelledby="disable-connected-app-title"
            className="w-full max-w-[360px] rounded-lg border border-[#353535] bg-[#232323] p-4 text-white"
            open
          >
            <h2
              className="text-lg font-semibold"
              id="disable-connected-app-title"
            >
              Disable this app?
            </h2>
            <p className="mt-2 text-sm text-[#b2b2b2]">
              Existing credentials will stop reaching inference.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                className={secondaryButtonClass}
                onClick={() => setShowDisableConfirm(false)}
                type="button"
              >
                Cancel
              </button>
              <form action={disableAdminConnectedAppAction}>
                <input name="appId" type="hidden" value={currentApp.id} />
                <input
                  name="returnTo"
                  type="hidden"
                  value={`/applications/apps/${currentApp.id}`}
                />
                <button className={dangerButtonClass} type="submit">
                  Disable
                </button>
              </form>
            </div>
          </dialog>
        </div>
      ) : null}
    </div>
  )
}

function ConnectedAppsPanel({
  accessRole,
  apps,
}: {
  accessRole: RetainedConsoleRole
  apps: AdminConnectedApp[]
}) {
  return (
    <section className="grid gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">Connected apps</h2>
        {accessRole === "admin" ? (
          <Link
            className="flex items-center gap-1 text-sm font-medium text-white"
            href="/applications/apps/new"
          >
            <Plus aria-hidden className="size-5" />
            Add app
          </Link>
        ) : null}
      </div>
      <div className="overflow-hidden rounded-lg border border-[#353535] bg-[#232323]">
        {apps.length > 0 ? (
          apps.map((app, index) => (
            <div className="contents" key={app.id}>
              <article className="grid gap-3 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h3 className="truncate font-medium text-white">
                      {app.name}
                    </h3>
                    <p className="mt-1 text-sm text-[#b2b2b2]">
                      {app.description}
                    </p>
                  </div>
                  <Link
                    className={secondaryButtonClass}
                    href={`/applications/apps/${encodeURIComponent(app.id)}`}
                  >
                    Settings
                  </Link>
                </div>
                <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                  <Metric label="Owner" value={app.ownerGroup} />
                  <Metric
                    label="Last used"
                    value={dateTimeLabel(app.usage.lastUsedAt)}
                  />
                  <Metric
                    label="Requests"
                    value={app.usage.requests7d.toLocaleString()}
                  />
                  <Metric
                    label="Tokens"
                    value={compactNumber(app.usage.tokens7d)}
                  />
                  <Metric
                    label="Failures"
                    value={app.usage.failures7d.toLocaleString()}
                  />
                  <Metric
                    label="Status"
                    value={app.status === "enabled" ? "Enabled" : "Disabled"}
                  />
                </dl>
              </article>
              {index < apps.length - 1 ? (
                <span aria-hidden className="block h-px bg-[#353535]" />
              ) : null}
            </div>
          ))
        ) : (
          <p className="p-4 text-sm text-[#b2b2b2]">
            Add the first connected app to issue a dedicated credential.
          </p>
        )}
      </div>
    </section>
  )
}

function ConnectedAppCredentialPanel({
  app,
  credential,
  testAction,
  testState,
}: {
  app: AdminConnectedApp
  credential: AdminConnectedAppCredential
  testAction: (formData: FormData) => void
  testState: ConnectedAppTestActionState
}) {
  return (
    <ConnectedAppCredentialDetails
      credential={credential}
      footer={
        <>
          <ConnectedAppTestStatus state={testState} />
          <form action={testAction} className="flex justify-end">
            <input name="appId" type="hidden" value={app.id} />
            <button className={primaryButtonClass} type="submit">
              Test connection
            </button>
          </form>
        </>
      }
      title="Application credential"
    />
  )
}

function ConnectedAppCredentialDetails({
  credential,
  footer,
  title,
}: {
  credential: AdminConnectedAppCredential
  footer?: React.ReactNode
  title: string
}) {
  return (
    <section className="grid gap-3 rounded-lg border border-[#353535] bg-[#232323] p-4">
      <div>
        <h2 className="text-lg font-semibold text-white">{title}</h2>
        <p className="mt-1 text-sm text-[#b2b2b2]">
          This credential is shown once. Store it before leaving this page.
        </p>
      </div>
      {credential.authMethod === "api_key" ? (
        <CopyableCredentialRow
          label="API key"
          secret
          value={credential.apiKey ?? ""}
        />
      ) : (
        <>
          <CopyableCredentialRow
            label="Client ID"
            value={credential.clientId ?? ""}
          />
          <CopyableCredentialRow
            label="Client secret"
            secret
            value={credential.clientSecret ?? ""}
          />
          <CopyableCredentialRow
            label="Token URL"
            value={credential.tokenUrl ?? ""}
          />
        </>
      )}
      <CopyableCredentialRow
        label="OpenAI base URL"
        value={credential.openAiBaseUrl}
      />
      {credential.model ? (
        <CopyableCredentialRow label="Model" value={credential.model} />
      ) : null}
      <CopyableCredentialRow
        label="Example request"
        multiline
        value={credential.exampleCurl}
      />
      {footer}
    </section>
  )
}

function CopyableCredentialRow({
  label,
  multiline = false,
  secret = false,
  value,
}: {
  label: string
  multiline?: boolean
  secret?: boolean
  value: string
}) {
  const [copied, setCopied] = useState(false)

  async function copyValue() {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    }
  }

  return (
    <div className="flex items-start gap-3 rounded-lg border border-[#353535] bg-[#181818] p-3">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold uppercase text-[#8b8b8b]">
          {label}
        </p>
        {multiline ? (
          <pre className="mt-2 whitespace-pre-wrap break-words text-sm text-white">
            {value}
          </pre>
        ) : (
          <p
            className={cn(
              "mt-2 break-all font-mono text-sm text-white",
              secret && "text-[#ffdb8a]",
            )}
          >
            {value}
          </p>
        )}
      </div>
      <button
        aria-label={`Copy ${label}`}
        className={secondaryButtonClass}
        onClick={copyValue}
        type="button"
      >
        <Copy aria-hidden className="size-4" />
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  )
}

function ConnectedAppCreateStatus({
  state,
}: {
  state: ConnectedAppCreateActionState
}) {
  if (state.status === "idle") {
    return null
  }
  return (
    <p
      className={cn(
        "rounded-lg border px-3 py-2 text-sm",
        state.status === "created"
          ? "border-[#174f31] bg-[#14231a] text-[#36c66f]"
          : "border-[#371d1f] bg-[#261719] text-[#ff6262]",
      )}
    >
      {state.status === "created"
        ? "Application created. Copy its credential now."
        : state.error}
    </p>
  )
}

function ConnectedAppTestStatus({
  state,
}: {
  state: ConnectedAppTestActionState
}) {
  if (state.status === "idle") {
    return null
  }
  const passed = state.status === "passed"
  return (
    <p
      className={cn(
        "rounded-lg border px-3 py-2 text-sm",
        passed
          ? "border-[#174f31] bg-[#14231a] text-[#36c66f]"
          : "border-[#371d1f] bg-[#261719] text-[#ff6262]",
      )}
    >
      {passed
        ? (state.detail ?? "Connection test passed.")
        : (state.error ?? state.detail ?? "Connection test failed.")}
    </p>
  )
}

function CredentialActionStatus({
  state,
}: {
  state: ConnectedAppCredentialActionState
}) {
  if (state.status === "idle") {
    return null
  }
  const failed = state.status === "failed" || state.status === "blocked"
  return (
    <p
      className={cn(
        "rounded-lg border px-3 py-2 text-sm",
        failed
          ? "border-[#371d1f] bg-[#261719] text-[#ff6262]"
          : "border-[#174f31] bg-[#14231a] text-[#36c66f]",
      )}
    >
      {failed
        ? (state.error ?? state.detail ?? "Credential rotation failed.")
        : (state.detail ?? "Credential rotated.")}
    </p>
  )
}

function ApplicationTextField({
  label,
  name,
  placeholder,
}: {
  label: string
  name: string
  placeholder: string
}) {
  return (
    <label className="grid gap-2 text-sm font-medium text-white">
      {label}
      <input
        className="h-11 rounded-lg border border-[#353535] bg-[#181818] px-3 text-white outline-none placeholder:text-[#8b8b8b] focus:border-[#009fff]"
        name={name}
        placeholder={placeholder}
      />
    </label>
  )
}

function SegmentedControl({
  label,
  options,
}: {
  label: string
  options: Array<{
    active: boolean
    label: string
    onSelect: () => void
  }>
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm font-medium text-white">{label}</span>
      <div className="flex rounded-lg border border-[#353535] p-0.5">
        {options.map((option) => (
          <button
            aria-pressed={option.active}
            className={cn(
              "rounded-md px-3 py-2 text-sm text-white",
              option.active ? "bg-[#383838]" : "hover:bg-[#2e2e2e]",
            )}
            key={option.label}
            onClick={option.onSelect}
            type="button"
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-t border-[#353535] pt-3 text-sm">
      <span className="font-medium text-white">{label}</span>
      <span className="max-w-[60%] text-right text-[#b2b2b2]">{value}</span>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase text-[#8b8b8b]">
        {label}
      </dt>
      <dd className="mt-1 truncate text-white">{value}</dd>
    </div>
  )
}

function StatusPill({ status }: { status: AdminConnectedApp["status"] }) {
  return (
    <span
      className={cn(
        "rounded-full border px-2 py-1 text-xs font-semibold",
        status === "enabled"
          ? "border-[#174f31] text-[#36c66f]"
          : "border-[#353535] text-[#b2b2b2]",
      )}
    >
      {status === "enabled" ? "Enabled" : "Disabled"}
    </span>
  )
}

function PageHeader({ title }: { title: string }) {
  return (
    <header>
      <h1 className="text-2xl font-semibold text-white">{title}</h1>
    </header>
  )
}

function SubpageHeader({ title }: { title: string }) {
  return (
    <header>
      <h1 className="text-2xl font-semibold text-white">{title}</h1>
      <Link
        className="mt-3 flex w-fit items-center gap-1 text-sm font-medium text-white"
        href="/applications"
      >
        <ArrowLeft aria-hidden className="size-4" />
        Go back
      </Link>
    </header>
  )
}

function AppActionNotice({ appAction }: { appAction?: string }) {
  if (!appAction) {
    return null
  }
  const disabled = appAction === "disabled"
  return (
    <ConsoleActionToasts
      notifications={[
        {
          description: disabled
            ? "Connected app disabled."
            : "Connected app action failed.",
          id: `app-action-${appAction}`,
          title: "Applications",
          tone: disabled ? "warning" : "danger",
        },
      ]}
    />
  )
}

function teamGroupOptions(groups: AdminTeamGroup[]): string[] {
  const options = new Map<string, string>()
  for (const group of groups) {
    const name = group.name.trim()
    if (!name || name.toLowerCase() === "everyone") {
      continue
    }
    options.set(name.toLowerCase(), name)
  }
  return ["Everyone", ...options.values()]
}

function dateTimeLabel(value: string | null | undefined): string {
  return value ? applicationsDateTimeFormatter.format(new Date(value)) : "Never"
}

function formatCredentialAge(value: string | null | undefined): string {
  if (!value) {
    return "Not issued"
  }
  const ageMs = Math.max(0, Date.now() - new Date(value).getTime())
  const days = Math.floor(ageMs / 86_400_000)
  return days === 0 ? "Issued today" : `${days} day${days === 1 ? "" : "s"}`
}

function connectionStatusLabel(
  status: AdminConnectedApp["environments"][number]["testStatus"] | undefined,
): string {
  if (status === "passed") {
    return "Passed"
  }
  if (status === "failed") {
    return "Failed"
  }
  if (status === "stale") {
    return "Retest required"
  }
  return "Not tested"
}

function compactNumber(value: number): string {
  return applicationsCompactNumberFormatter.format(value)
}

function formatNullableLimit(value: number | null, suffix: string): string {
  return value === null ? "Disabled" : `${compactNumber(value)}${suffix}`
}

const primaryButtonClass =
  "inline-flex h-9 items-center justify-center gap-1 rounded-md bg-[#2e2e2e] px-3 text-sm font-medium text-white transition-colors hover:bg-[#383838] disabled:cursor-not-allowed disabled:opacity-50"
const secondaryButtonClass =
  "inline-flex h-9 items-center justify-center gap-1 rounded-md border border-[#353535] px-3 text-sm font-medium text-white transition-colors hover:bg-[#2e2e2e]"
const dangerButtonClass =
  "inline-flex h-9 items-center justify-center rounded-md border border-[#4a2426] px-3 text-sm font-medium text-[#ff595d] transition-colors hover:bg-[#321f20]"
