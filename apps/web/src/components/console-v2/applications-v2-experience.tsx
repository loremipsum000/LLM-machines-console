"use client"

import Link from "next/link"
import { ArrowLeft, ChevronDown, Copy, Plus, Settings } from "lucide-react"
import { useActionState, useState } from "react"
import type { ReactNode } from "react"
import type {
  AdminConnectedApp,
  AdminConnectedAppCredential,
  AdminConnectorRegistryItem,
  AdminInferenceModel,
  AdminMcpServerDetail,
  AdminTeamGroup,
} from "@llm-machines/contracts"
import {
  createAdminConnectedAppAction,
  disableAdminConnectedAppAction,
  promoteAdminConnectedAppProductionAction,
  rotateAdminConnectedAppCredentialsAction,
  saveAdminMcpServerAction,
  testAdminConnectedAppConnectionAction,
  testAdminMcpServerConnectionAction,
  updateAdminMcpServerAction,
  type ConnectedAppCreateActionState,
  type ConnectedAppCredentialActionState,
  type ConnectedAppTestActionState,
} from "@/lib/admin/actions"
import { cn } from "@/lib/utils"
import { ConsoleActionToasts } from "./action-toasts"

export type ApplicationsView =
  | "add-server"
  | "app-detail"
  | "configure-server"
  | "new-app"
  | "overview"

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
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  month: "short",
  timeZone: "UTC",
})
const applicationsCompactNumberFormatter = new Intl.NumberFormat("en", {
  maximumFractionDigits: 1,
  notation: "compact",
})

export function ApplicationsV2Experience({
  connectedApps = EMPTY_CONNECTED_APPS,
  connectedAppDetail,
  appAction,
  modelOptions = EMPTY_MODEL_OPTIONS,
  mcpAction,
  mcpServerDetail,
  registryItems,
  teamGroups = EMPTY_TEAM_GROUPS,
  view,
}: {
  connectedApps?: AdminConnectedApp[]
  connectedAppDetail?: AdminConnectedApp | null
  appAction?: string
  modelOptions?: AdminInferenceModel[]
  mcpAction?: string
  mcpServerDetail?: AdminMcpServerDetail | null
  registryItems: AdminConnectorRegistryItem[]
  teamGroups?: AdminTeamGroup[]
  view: ApplicationsView
}) {
  const groupOptions = teamGroupOptions(teamGroups)
  if (view === "add-server") {
    return (
      <AddMcpServerView groupOptions={groupOptions} mcpAction={mcpAction} />
    )
  }
  if (view === "new-app") {
    return (
      <AddConnectedAppView
        groupOptions={groupOptions}
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
  if (view === "configure-server") {
    return (
      <ConfigureMcpServerView
        groupOptions={groupOptions}
        mcpAction={mcpAction}
        server={mcpServerDetail ?? null}
      />
    )
  }

  return (
    <div className="w-full min-h-screen min-h-dvh pb-16 pt-8 lg:pt-[73px]">
      <PageHeader title="Applications" />
      <McpActionNotice mcpAction={mcpAction} />
      <div className="mt-10 flex w-full flex-col gap-3 lg:w-[640px]">
        <ConnectedAppsPanel apps={connectedApps} />
        <McpServersPanel items={registryItems} />
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
      <header>
        <h1 className="text-2xl font-semibold leading-none text-[#fdfdfd]">
          Applications &gt; Add app
        </h1>
        <BackToApplicationsLink />
      </header>

      <div className="mt-10 flex w-full flex-col gap-3 lg:w-[640px]">
        <form
          action={createAction}
          className="flex w-full flex-col gap-2.5 overflow-hidden rounded-lg border border-[#353535] bg-[#232323] p-3"
        >
          <input name="authMethod" type="hidden" value={authMethod} />
          <McpTextField
            label="Name"
            name="name"
            placeholder="Customer app name"
          />
          <McpTextField
            label="Description"
            name="description"
            placeholder="What workflow will use the BFF gateway..."
          />

          <ReadOnlyRow label="Environment" value="Staging" />

          <SegmentedRow label="Auth">
            <SegmentButton
              active={authMethod === "api_key"}
              label="API key"
              name="connected-app-auth"
              onSelect={() => setAuthMethod("api_key")}
            />
            <SegmentButton
              active={authMethod === "oauth_client_credentials"}
              label="OAuth Advanced"
              name="connected-app-auth"
              onSelect={() => setAuthMethod("oauth_client_credentials")}
            />
          </SegmentedRow>

          <label className="flex min-h-[35px] w-full items-center gap-10">
            <span className="flex min-w-0 flex-1 text-base font-medium leading-[19px] text-white">
              Owner group
            </span>
            <span className="relative shrink-0">
              <select
                aria-label="Owner group"
                className="appearance-none bg-transparent py-1.5 pl-0 pr-6 text-sm font-medium leading-[18px] text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#009fff]"
                defaultValue="Everyone"
                name="ownerGroup"
              >
                {groupOptions.map((group) => (
                  <option className="bg-[#232323]" key={group} value={group}>
                    {group}
                  </option>
                ))}
              </select>
              <ChevronDown
                aria-hidden
                className="pointer-events-none absolute right-0 top-1 size-5 text-white"
              />
            </span>
          </label>

          <fieldset className="flex w-full flex-col gap-2">
            <legend className="text-base font-medium leading-[19px] text-white">
              Allowed models
            </legend>
            {hasModels ? (
              <div className="grid gap-2">
                {modelOptions.map((model, index) => (
                  <label
                    className="flex min-h-[35px] items-center gap-3 rounded-md border border-[#353535] bg-[#1f1f1f] px-3 text-sm font-medium leading-[18px] text-white"
                    key={model.id}
                  >
                    <input
                      aria-label={model.name}
                      className="size-4 accent-[#009fff]"
                      defaultChecked={index === 0}
                      name="allowedModels"
                      type="checkbox"
                      value={model.id}
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {model.name}
                    </span>
                    <span className="shrink-0 text-[#8b8b8b]">
                      {model.provider}
                    </span>
                  </label>
                ))}
              </div>
            ) : (
              <p className="rounded-md border border-[#353535] bg-[#181818] px-3 py-2 text-sm font-medium leading-5 text-[#b2b2b2]">
                No models are available from Inference yet.
              </p>
            )}
          </fieldset>

          <div className="grid gap-2 sm:grid-cols-2">
            <McpTextField
              label="Rate limit"
              name="rateLimitRpm"
              placeholder="Unlimited"
            />
            <McpTextField
              label="Token budget"
              name="tokenBudget7d"
              placeholder="Unlimited"
            />
          </div>

          <ConnectedAppCreateStatus state={createState} />

          <div className="flex justify-end gap-2 pt-1">
            <Link
              className="flex h-[34px] min-w-[70px] items-center justify-center rounded-lg border border-[#353535] px-3 text-center text-sm font-medium text-white transition-colors hover:bg-[#2e2e2e] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#009fff]"
              href="/applications"
            >
              Cancel
            </Link>
            <button
              className="flex h-[34px] min-w-[94px] items-center justify-center rounded-lg bg-[#2e2e2e] px-3 text-center text-sm font-medium text-white transition-colors hover:bg-[#383838] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-[#2e2e2e] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#009fff]"
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
  const [selectedEnvironment, setSelectedEnvironment] = useState<
    "production" | "staging"
  >("staging")
  const [showDisableConfirm, setShowDisableConfirm] = useState(false)
  const [testState, testAction] = useActionState(
    testAdminConnectedAppConnectionAction,
    initialConnectedAppTestState,
  )
  const [promoteState, promoteAction] = useActionState(
    promoteAdminConnectedAppProductionAction,
    initialConnectedAppCredentialState,
  )
  const [rotateState, rotateAction] = useActionState(
    rotateAdminConnectedAppCredentialsAction,
    initialConnectedAppCredentialState,
  )

  if (!app) {
    return (
      <div className="w-full min-h-screen min-h-dvh pb-16 pt-8 lg:pt-[73px]">
        <header>
          <h1 className="text-2xl font-semibold leading-none text-[#fdfdfd]">
            Applications &gt; App settings
          </h1>
          <BackToApplicationsLink />
        </header>
        <p className="mt-10 rounded-lg border border-[#353535] bg-[#232323] p-3 text-sm leading-5 text-[#b2b2b2] lg:w-[640px]">
          This connected app is not available.
        </p>
      </div>
    )
  }

  const currentApp = rotateState.app ?? promoteState.app ?? testState.app ?? app
  const production = currentApp.environments.find(
    (environment) => environment.environment === "production",
  )
  const staging = currentApp.environments.find(
    (environment) => environment.environment === "staging",
  )
  const activeEnvironment =
    selectedEnvironment === "production" ? production : staging
  const productionLocked = !staging?.productionReady || !production
  const oneTimeCredential = promoteState.credential ?? rotateState.credential
  const oneTimeCredentialTitle =
    promoteState.credential !== null
      ? "Production credentials"
      : "Rotated staging credentials"

  return (
    <div className="w-full min-h-screen min-h-dvh pb-16 pt-8 lg:pt-[73px]">
      <header>
        <h1 className="text-2xl font-semibold leading-none text-[#fdfdfd]">
          Applications &gt; {currentApp.name}
        </h1>
        <BackToApplicationsLink />
      </header>

      <div className="mt-10 flex w-full flex-col gap-3 lg:w-[640px]">
        <AppActionNotice appAction={appAction} />

        <section className="flex w-full flex-col gap-3 rounded-lg border border-[#353535] bg-[#232323] p-3">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="truncate text-lg font-semibold leading-none text-[#fdfdfd]">
                {currentApp.name}
              </h2>
              <p className="mt-2 text-sm font-medium leading-5 text-[#b2b2b2]">
                {currentApp.description}
              </p>
            </div>
            <ConnectedAppStatusPill status={currentApp.status} />
          </div>

          <span aria-hidden className="h-px w-full bg-[#353535]" />

          <ReadOnlyRow label="Owner group" value={currentApp.ownerGroup} />
          <ReadOnlyRow
            label="Allowed models"
            value={currentApp.allowedModels.join(", ")}
          />
          <ReadOnlyRow
            label="Rate limit"
            value={formatNullableLimit(currentApp.rateLimitRpm, " rpm")}
          />
          <ReadOnlyRow
            label="Token budget"
            value={formatNullableLimit(currentApp.tokenBudget7d, " / 7D")}
          />

          <span aria-hidden className="h-px w-full bg-[#353535]" />

          <SegmentedRow label="Environment">
            <SegmentButton
              active={selectedEnvironment === "staging"}
              label="Staging"
              name="connected-app-environment"
              onSelect={() => setSelectedEnvironment("staging")}
            />
            <SegmentButton
              active={selectedEnvironment === "production"}
              disabled={productionLocked}
              label="Production"
              name="connected-app-environment"
              onSelect={() => setSelectedEnvironment("production")}
            />
          </SegmentedRow>

          <div className="grid gap-2">
            {activeEnvironment ? (
              <EnvironmentSummary
                environment={activeEnvironment}
                label={
                  activeEnvironment.environment === "production"
                    ? "Production"
                    : "Staging"
                }
              />
            ) : selectedEnvironment === "production" ? (
              <div className="flex min-h-[43px] items-center justify-between gap-4 rounded-lg border border-[#353535] bg-[#1f1f1f] px-3">
                <div>
                  <p className="text-sm font-medium leading-[18px] text-white">
                    Production
                  </p>
                  <p className="mt-1 text-sm font-medium leading-5 text-[#b2b2b2]">
                    Run a passing staging test before production credentials are
                    created.
                  </p>
                </div>
                <button
                  className="flex h-[30px] cursor-not-allowed items-center justify-center rounded-md border border-[#353535] px-2.5 py-1.5 text-center text-sm font-medium leading-[18px] text-[#8b8b8b]"
                  disabled
                  type="button"
                >
                  Locked
                </button>
              </div>
            ) : null}
          </div>

          <ConnectedAppTestStatus state={testState} />
          <CredentialActionStatus state={promoteState} />
          <CredentialActionStatus state={rotateState} />

          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <form action={testAction}>
              <input name="appId" type="hidden" value={currentApp.id} />
              <button
                className="flex h-[30px] items-center justify-center rounded-md bg-[#2e2e2e] px-2.5 py-1.5 text-center text-sm font-medium leading-[18px] text-white transition-colors hover:bg-[#383838] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#009fff]"
                type="submit"
              >
                Test connection
              </button>
            </form>
            <form action={promoteAction}>
              <input name="appId" type="hidden" value={currentApp.id} />
              <button
                className="flex h-[30px] items-center justify-center rounded-md bg-[#2e2e2e] px-2.5 py-1.5 text-center text-sm font-medium leading-[18px] text-white transition-colors hover:bg-[#383838] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-[#2e2e2e] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#009fff]"
                disabled={Boolean(production) || !staging?.productionReady}
                type="submit"
              >
                {production ? "Promoted" : "Promote"}
              </button>
            </form>
            <form action={rotateAction}>
              <input name="appId" type="hidden" value={currentApp.id} />
              <button
                className="flex h-[30px] items-center justify-center rounded-md border border-[#353535] px-2.5 py-1.5 text-center text-sm font-medium leading-[18px] text-white transition-colors hover:bg-[#2e2e2e] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#009fff]"
                type="submit"
              >
                Rotate credentials
              </button>
            </form>
            <button
              className="flex h-[30px] items-center justify-center rounded-md border border-[#4a2426] px-2.5 py-1.5 text-center text-sm font-medium leading-[18px] text-[#ff595d] transition-colors hover:bg-[#321f20] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#009fff]"
              onClick={() => setShowDisableConfirm(true)}
              type="button"
            >
              Disable app
            </button>
          </div>
        </section>

        {oneTimeCredential ? (
          <ConnectedAppOneTimeCredentialPanel
            credential={oneTimeCredential}
            title={oneTimeCredentialTitle}
          />
        ) : null}
      </div>

      {showDisableConfirm ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
          <dialog
            className="w-full max-w-[360px] rounded-lg border border-[#353535] bg-[#232323] p-4"
            aria-labelledby="connected-app-disable-title"
            open
          >
            <h2
              className="text-lg font-semibold leading-none text-[#fdfdfd]"
              id="connected-app-disable-title"
            >
              Disable app?
            </h2>
            <p className="mt-3 text-sm font-medium leading-5 text-[#b2b2b2]">
              Runtime calls from this connected app will be rejected until it is
              re-enabled in a later workflow.
            </p>
            <form
              action={disableAdminConnectedAppAction}
              className="mt-4 flex justify-end gap-2"
            >
              <input name="appId" type="hidden" value={currentApp.id} />
              <input
                name="returnTo"
                type="hidden"
                value={`/applications/apps/${currentApp.id}`}
              />
              <button
                className="flex h-[30px] items-center justify-center rounded-md border border-[#353535] px-2.5 py-1.5 text-center text-sm font-medium leading-[18px] text-white transition-colors hover:bg-[#2e2e2e] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#009fff]"
                onClick={() => setShowDisableConfirm(false)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="flex h-[30px] items-center justify-center rounded-md bg-[#321f20] px-2.5 py-1.5 text-center text-sm font-medium leading-[18px] text-[#ff595d] transition-colors hover:bg-[#402426] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#009fff]"
                type="submit"
              >
                Disable
              </button>
            </form>
          </dialog>
        </div>
      ) : null}
    </div>
  )
}

function EnvironmentSummary({
  environment,
  label,
}: {
  environment: AdminConnectedApp["environments"][number]
  label: string
}) {
  return (
    <div className="flex min-h-[43px] items-center justify-between gap-4 rounded-lg border border-[#353535] bg-[#1f1f1f] px-3">
      <div className="min-w-0">
        <p className="text-sm font-medium leading-[18px] text-white">{label}</p>
        <p className="mt-1 truncate text-sm font-medium leading-5 text-[#b2b2b2]">
          {environment.primaryAuthMethod === "api_key"
            ? `API key: ${environment.keyPrefix ?? "Not issued"}`
            : `Client ID: ${environment.clientId ?? "Not issued"}`}
        </p>
      </div>
      <EnvironmentPill
        environment={environment.environment}
        ready={environment.productionReady}
        testStatus={environment.testStatus}
      />
    </div>
  )
}

function AddMcpServerView({
  groupOptions,
  mcpAction,
}: {
  groupOptions: string[]
  mcpAction?: string
}) {
  const [transport, setTransport] = useState<"stdio" | "url">("url")
  const [authMode, setAuthMode] = useState<"bearer" | "none">("bearer")
  const [accessLevel, setAccessLevel] = useState<"read_only" | "read_write">(
    "read_only",
  )

  return (
    <div className="w-full min-h-screen min-h-dvh pb-16 pt-8 lg:pt-[73px]">
      <header>
        <h1 className="text-2xl font-semibold leading-none text-[#fdfdfd]">
          Applications &gt; Add MCP server
        </h1>
        <Link
          className="mt-3 flex h-5 w-fit items-center gap-1 text-sm font-medium text-white transition-colors hover:text-[#d8d8d8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#009fff]"
          href="/applications"
        >
          <ArrowLeft aria-hidden className="size-4" />
          Go back
        </Link>
      </header>

      <McpActionNotice mcpAction={mcpAction} />

      <form
        action={saveAdminMcpServerAction}
        className="mt-10 flex w-full flex-col gap-2.5 overflow-hidden rounded-lg border border-[#353535] bg-[#232323] p-3 lg:w-[640px]"
      >
        <input name="returnTo" type="hidden" value="/applications/add-server" />
        <input name="transport" type="hidden" value={transport} />
        <input name="authMode" type="hidden" value={authMode} />
        <input name="accessLevel" type="hidden" value={accessLevel} />

        <McpTextField label="Name" name="name" placeholder="MCP server name" />
        <McpTextField
          label="Description"
          name="description"
          placeholder="What is this MCP used for..."
        />
        <McpTextField
          label="Chat Command"
          name="chatCommand"
          placeholder="@documentation"
        />

        <SegmentedRow label="Type">
          <SegmentButton
            active={transport === "url"}
            label="URL"
            name="transport-segment"
            onSelect={() => setTransport("url")}
          />
          <SegmentButton
            active={transport === "stdio"}
            label="STDIO"
            name="transport-segment"
            onSelect={() => {
              setTransport("stdio")
              setAuthMode("none")
            }}
          />
        </SegmentedRow>

        {transport === "url" ? (
          <McpTextField
            label="URL endpoint"
            name="endpointUrl"
            placeholder="https://"
            visuallyHideLabel
          />
        ) : (
          <McpTextField
            label="STDIO command"
            name="stdioCommand"
            placeholder="npx -y @modelcontextprotocol/server..."
            visuallyHideLabel
          />
        )}

        <SegmentedRow label="Auth mode">
          <SegmentButton
            active={authMode === "bearer"}
            disabled={transport === "stdio"}
            label="Bearer"
            name="auth-segment"
            onSelect={() => setAuthMode("bearer")}
          />
          <SegmentButton
            active={authMode === "none"}
            label="No Auth"
            name="auth-segment"
            onSelect={() => setAuthMode("none")}
          />
        </SegmentedRow>

        {authMode === "bearer" ? (
          <McpTextField
            label="Bearer secret reference"
            name="bearerTokenSecretRef"
            placeholder="MCP_BEARER_TOKEN"
            visuallyHideLabel
          />
        ) : null}

        <label className="flex min-h-[35px] w-full items-center gap-10">
          <span className="flex min-w-0 flex-1 text-base font-medium leading-[19px] text-white">
            Permissions
          </span>
          <span className="relative shrink-0">
            <select
              className="appearance-none bg-transparent py-1.5 pl-0 pr-6 text-sm font-medium leading-[18px] text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#009fff]"
              defaultValue="Everyone"
              name="accessGroups"
            >
              {groupOptions.map((group) => (
                <option className="bg-[#232323]" key={group} value={group}>
                  {group}
                </option>
              ))}
            </select>
            <ChevronDown
              aria-hidden
              className="pointer-events-none absolute right-0 top-1 size-5 text-white"
            />
          </span>
        </label>

        <span aria-hidden className="h-px w-full bg-[#353535]" />

        <SegmentedRow label="Access level">
          <SegmentButton
            active={accessLevel === "read_only"}
            label="Read-only"
            name="access-level-segment"
            onSelect={() => setAccessLevel("read_only")}
          />
          <SegmentButton
            active={accessLevel === "read_write"}
            label="Read/Write"
            name="access-level-segment"
            onSelect={() => setAccessLevel("read_write")}
          />
        </SegmentedRow>

        <span aria-hidden className="h-px w-full bg-[#353535]" />

        <div className="flex min-h-[35px] w-full items-center gap-10">
          <span className="flex min-w-0 flex-1 text-base font-medium leading-[19px] text-white">
            Test connection
          </span>
          <button
            className="flex h-[30px] items-center justify-center rounded-md bg-[#2e2e2e] px-2.5 py-1.5 text-center text-sm font-medium leading-[18px] text-white transition-colors hover:bg-[#383838] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#009fff]"
            formAction={testAdminMcpServerConnectionAction}
            type="submit"
          >
            Test
          </button>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button
            className="flex h-[34px] min-w-[70px] items-center justify-center rounded-lg border border-[#353535] px-3 text-center text-sm font-medium text-white transition-colors hover:bg-[#2e2e2e] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#009fff]"
            name="saveMode"
            type="submit"
            value="draft"
          >
            Draft
          </button>
          <button
            className="flex h-[34px] min-w-[70px] items-center justify-center rounded-lg bg-[#2e2e2e] px-3 text-center text-sm font-medium text-white transition-colors hover:bg-[#383838] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#009fff]"
            name="saveMode"
            type="submit"
            value="enabled"
          >
            Save
          </button>
        </div>
      </form>
    </div>
  )
}

function ConfigureMcpServerView({
  groupOptions,
  mcpAction,
  server,
}: {
  groupOptions: string[]
  mcpAction?: string
  server: AdminMcpServerDetail | null
}) {
  const [authMode, setAuthMode] = useState<"bearer" | "none">(
    server?.authMode ?? "none",
  )
  const [accessLevel, setAccessLevel] = useState<"read_only" | "read_write">(
    server?.accessLevel ?? "read_only",
  )
  const [status, setStatus] = useState<"draft" | "enabled" | "disabled">(
    server?.status ?? "draft",
  )

  if (!server) {
    return (
      <div className="w-full min-h-screen min-h-dvh pb-16 pt-8 lg:pt-[73px]">
        <header>
          <h1 className="text-2xl font-semibold leading-none text-[#fdfdfd]">
            Applications &gt; MCP settings
          </h1>
          <BackToApplicationsLink />
        </header>
        <p className="mt-10 rounded-lg border border-[#353535] bg-[#232323] p-3 text-sm leading-5 text-[#b2b2b2] lg:w-[640px]">
          This MCP server is not editable from the Console.
        </p>
      </div>
    )
  }

  return (
    <div className="w-full min-h-screen min-h-dvh pb-16 pt-8 lg:pt-[73px]">
      <header>
        <h1 className="text-2xl font-semibold leading-none text-[#fdfdfd]">
          Applications &gt; {server.name} &gt; Settings
        </h1>
        <BackToApplicationsLink />
      </header>

      <McpActionNotice mcpAction={mcpAction} />

      <form
        action={updateAdminMcpServerAction}
        className="mt-10 flex w-full flex-col gap-2.5 overflow-hidden rounded-lg border border-[#353535] bg-[#232323] p-3 lg:w-[640px]"
      >
        <input name="connectorId" type="hidden" value={server.id} />
        <input
          name="returnTo"
          type="hidden"
          value={`/applications/mcp/${server.id}/settings`}
        />
        <input name="transport" type="hidden" value={server.transport} />
        <input name="authMode" type="hidden" value={authMode} />
        <input name="accessLevel" type="hidden" value={accessLevel} />
        <input name="status" type="hidden" value={status} />
        <input name="chatCommand" type="hidden" value={server.chatCommand} />

        <McpTextField
          defaultValue={server.name}
          label="Name"
          name="name"
          placeholder="MCP server name"
        />
        <McpTextField
          defaultValue={server.description}
          label="Description"
          name="description"
          placeholder="What is this MCP used for..."
        />
        <McpTextField
          defaultValue={server.chatCommand}
          disabled
          label="Chat Command"
          name="chatCommandDisplay"
          placeholder="@documentation"
        />

        <ReadOnlyRow label="Type" value={server.transport.toUpperCase()} />

        {server.transport === "url" ? (
          <McpTextField
            defaultValue={server.endpointUrl ?? ""}
            label="URL endpoint"
            name="endpointUrl"
            placeholder="https://"
            visuallyHideLabel
          />
        ) : (
          <McpTextField
            defaultValue={server.stdioCommand ?? ""}
            label="STDIO command"
            name="stdioCommand"
            placeholder="npx -y @modelcontextprotocol/server..."
            visuallyHideLabel
          />
        )}

        <SegmentedRow label="Auth mode">
          <SegmentButton
            active={authMode === "bearer"}
            disabled={server.transport === "stdio"}
            label="Bearer"
            name="auth-segment"
            onSelect={() => setAuthMode("bearer")}
          />
          <SegmentButton
            active={authMode === "none"}
            label="No Auth"
            name="auth-segment"
            onSelect={() => setAuthMode("none")}
          />
        </SegmentedRow>

        {authMode === "bearer" ? (
          <McpTextField
            defaultValue={server.bearerTokenSecretRef ?? ""}
            label="Bearer secret reference"
            name="bearerTokenSecretRef"
            placeholder="MCP_BEARER_TOKEN"
            visuallyHideLabel
          />
        ) : null}

        <label className="flex min-h-[35px] w-full items-center gap-10">
          <span className="flex min-w-0 flex-1 text-base font-medium leading-[19px] text-white">
            Permissions
          </span>
          <span className="relative shrink-0">
            <select
              className="appearance-none bg-transparent py-1.5 pl-0 pr-6 text-sm font-medium leading-[18px] text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#009fff]"
              defaultValue={server.accessGroups[0] ?? "Everyone"}
              name="accessGroups"
            >
              {groupOptions.map((group) => (
                <option className="bg-[#232323]" key={group} value={group}>
                  {group}
                </option>
              ))}
            </select>
            <ChevronDown
              aria-hidden
              className="pointer-events-none absolute right-0 top-1 size-5 text-white"
            />
          </span>
        </label>

        <span aria-hidden className="h-px w-full bg-[#353535]" />

        <SegmentedRow label="Access level">
          <SegmentButton
            active={accessLevel === "read_only"}
            label="Read-only"
            name="access-level-segment"
            onSelect={() => setAccessLevel("read_only")}
          />
          <SegmentButton
            active={accessLevel === "read_write"}
            label="Read/Write"
            name="access-level-segment"
            onSelect={() => setAccessLevel("read_write")}
          />
        </SegmentedRow>

        <SegmentedRow label="Availability">
          <SegmentButton
            active={status === "enabled"}
            disabled={server.transport === "stdio"}
            label="Enabled"
            name="status-segment"
            onSelect={() => setStatus("enabled")}
          />
          <SegmentButton
            active={status === "draft"}
            label="Draft"
            name="status-segment"
            onSelect={() => setStatus("draft")}
          />
          <SegmentButton
            active={status === "disabled"}
            label="Disabled"
            name="status-segment"
            onSelect={() => setStatus("disabled")}
          />
        </SegmentedRow>

        <span aria-hidden className="h-px w-full bg-[#353535]" />

        <div className="flex min-h-[35px] w-full items-center gap-10">
          <span className="flex min-w-0 flex-1 text-base font-medium leading-[19px] text-white">
            Test connection
          </span>
          <button
            className="flex h-[30px] items-center justify-center rounded-md bg-[#2e2e2e] px-2.5 py-1.5 text-center text-sm font-medium leading-[18px] text-white transition-colors hover:bg-[#383838] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#009fff]"
            formAction={testAdminMcpServerConnectionAction}
            type="submit"
          >
            Test
          </button>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button
            className="flex h-[34px] min-w-[70px] items-center justify-center rounded-lg bg-[#2e2e2e] px-3 text-center text-sm font-medium text-white transition-colors hover:bg-[#383838] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#009fff]"
            type="submit"
          >
            Save
          </button>
        </div>
      </form>
    </div>
  )
}

function McpServersPanel({ items }: { items: AdminConnectorRegistryItem[] }) {
  return (
    <section
      aria-labelledby="console-v2-mcp-servers-title"
      className="flex w-full flex-col gap-2.5"
    >
      <div className="flex w-full items-center justify-between">
        <h2
          className="text-lg font-semibold leading-none text-[#fdfdfd]"
          id="console-v2-mcp-servers-title"
        >
          MCP servers
        </h2>
        <Link
          className="flex h-5 items-center gap-0.5 text-sm font-medium text-white transition-colors hover:text-[#d8d8d8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#009fff]"
          href="/applications/add-server"
        >
          <Plus aria-hidden className="size-5" />
          Add server
        </Link>
      </div>
      <div className="flex w-full flex-col gap-2.5 overflow-hidden rounded-lg border border-[#353535] bg-[#232323] p-3">
        {items.length > 0 ? (
          items.map((item, index) => (
            <div className="contents" key={item.id}>
              <div className="flex min-h-8 w-full items-center gap-10">
                <p className="min-w-0 flex-1 truncate text-base font-medium leading-[19px] text-white">
                  {item.displayName}
                </p>
                <div className="flex shrink-0 items-center justify-center gap-2">
                  {isAdminCreatedMcp(item) ? (
                    <Link
                      aria-label={`Configure ${item.displayName}`}
                      className="text-[#b2b2b2] transition-colors hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#009fff]"
                      href={`/applications/mcp/${encodeURIComponent(
                        item.id,
                      )}/settings`}
                    >
                      <Settings aria-hidden className="size-4" />
                    </Link>
                  ) : null}
                  <SupportTierPill tier={displaySupportTier(item)} />
                  <output
                    aria-label={`${item.displayName} ${
                      item.runtimeSetup.runnable ? "enabled" : "not enabled"
                    }`}
                    className={cn(
                      "flex h-5 w-9 items-center rounded-full p-0.5",
                      item.runtimeSetup.runnable
                        ? "justify-end bg-[#009fff]"
                        : "justify-start bg-[#353535]",
                    )}
                  >
                    <span className="size-4 rounded-full bg-white" />
                  </output>
                </div>
              </div>
              {index < items.length - 1 ? (
                <span aria-hidden className="h-px w-full bg-[#353535]" />
              ) : null}
            </div>
          ))
        ) : (
          <p className="text-sm leading-5 text-[#b2b2b2]">
            No MCP servers are available yet.
          </p>
        )}
      </div>
    </section>
  )
}

function ConnectedAppsPanel({ apps }: { apps: AdminConnectedApp[] }) {
  return (
    <section
      aria-labelledby="console-v2-connected-apps-title"
      className="flex w-full flex-col gap-2.5"
    >
      <div className="flex w-full items-center justify-between">
        <h2
          className="text-lg font-semibold leading-none text-[#fdfdfd]"
          id="console-v2-connected-apps-title"
        >
          Connected apps
        </h2>
        <Link
          className="flex h-5 items-center gap-0.5 text-sm font-medium text-white transition-colors hover:text-[#d8d8d8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#009fff]"
          href="/applications/apps/new"
        >
          <Plus aria-hidden className="size-5" />
          Add app
        </Link>
      </div>
      <div className="flex w-full flex-col overflow-hidden rounded-lg border border-[#353535] bg-[#232323] p-3">
        {apps.length > 0 ? (
          apps.map((app, index) => (
            <div className="contents" key={app.id}>
              <ConnectedAppRow app={app} />
              {index < apps.length - 1 ? (
                <span aria-hidden className="my-3 h-px w-full bg-[#353535]" />
              ) : null}
            </div>
          ))
        ) : (
          <p className="text-sm font-medium leading-5 text-[#b2b2b2]">
            Add the first connected app to issue staging credentials and route
            customer-owned workflows through the BFF gateway.
          </p>
        )}
      </div>
    </section>
  )
}

function ConnectedAppRow({ app }: { app: AdminConnectedApp }) {
  const disabled = app.status === "disabled"

  return (
    <article
      aria-label={`${app.name} connected app`}
      className={cn("flex w-full flex-col gap-2", disabled && "opacity-60")}
    >
      <div className="flex min-h-8 w-full items-start gap-4">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-medium leading-[19px] text-white">
            {app.name}
          </h3>
          <p className="mt-1 line-clamp-2 text-sm font-medium leading-5 text-[#b2b2b2]">
            {app.description}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <ConnectedAppStatusPill status={app.status} />
          <Link
            aria-label={`Open ${app.name} settings`}
            className="flex h-[30px] items-center justify-center rounded-md border border-[#353535] px-2.5 text-sm font-medium leading-[18px] text-white transition-colors hover:bg-[#2e2e2e] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#009fff]"
            href={`/applications/apps/${encodeURIComponent(app.id)}`}
          >
            Settings
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {app.environments.map((environment) => (
          <EnvironmentPill
            environment={environment.environment}
            key={environment.environment}
            ready={environment.productionReady}
            testStatus={environment.testStatus}
          />
        ))}
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm font-medium leading-[18px] text-[#b2b2b2] sm:grid-cols-3">
        <MetricTerm label="Owner" value={app.ownerGroup} />
        <MetricTerm label="Last test" value={latestTestLabel(app)} />
        <MetricTerm
          label="Last used"
          value={dateTimeLabel(app.usage.lastUsedAt)}
        />
        <MetricTerm
          label="7D requests"
          value={app.usage.requests7d.toLocaleString()}
        />
        <MetricTerm
          label="7D tokens"
          value={compactNumber(app.usage.tokens7d)}
        />
        <MetricTerm
          label="Failures"
          value={app.usage.failures7d.toLocaleString()}
        />
      </dl>
    </article>
  )
}

function ConnectedAppStatusPill({
  status,
}: {
  status: AdminConnectedApp["status"]
}) {
  return (
    <span
      className={cn(
        "flex h-5 items-center rounded-full border px-2 text-xs font-semibold leading-none",
        status === "enabled"
          ? "border-[#174f31] text-[#36c66f]"
          : "border-[#353535] text-[#b2b2b2]",
      )}
    >
      {status === "enabled" ? "Enabled" : "Disabled"}
    </span>
  )
}

function EnvironmentPill({
  environment,
  ready,
  testStatus,
}: {
  environment: AdminConnectedApp["environments"][number]["environment"]
  ready: boolean
  testStatus: AdminConnectedApp["environments"][number]["testStatus"]
}) {
  const label = environment === "production" ? "Production" : "Staging"
  const detail =
    testStatus === "passed"
      ? ready || environment === "staging"
        ? "tested"
        : "tested, locked"
      : testStatus === "failed"
        ? "failed"
        : testStatus === "stale"
          ? "needs test"
          : "not tested"

  return (
    <span className="flex min-h-5 items-center rounded-full border border-[#353535] px-2 text-xs font-semibold leading-none text-[#fdfdfd]">
      {label}
      <span className="ml-1 text-[#8b8b8b]">{detail}</span>
    </span>
  )
}

function MetricTerm({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold uppercase leading-none text-[#8b8b8b]">
        {label}
      </dt>
      <dd className="mt-1 truncate text-sm font-medium leading-[18px] text-[#fdfdfd]">
        {value}
      </dd>
    </div>
  )
}

function latestTestLabel(app: AdminConnectedApp): string {
  const testedAt = app.environments
    .map((environment) => environment.lastTestedAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1)
  return dateTimeLabel(testedAt ?? null)
}

function dateTimeLabel(value: string | null): string {
  if (!value) {
    return "Never"
  }
  return applicationsDateTimeFormatter.format(new Date(value))
}

function compactNumber(value: number): string {
  return applicationsCompactNumberFormatter.format(value)
}

function formatNullableLimit(value: number | null, suffix: string): string {
  return value === null ? "Unlimited" : `${compactNumber(value)}${suffix}`
}

function ConnectedAppCreateStatus({
  state,
}: {
  state: ConnectedAppCreateActionState
}) {
  if (state.status === "idle") {
    return null
  }
  if (state.status === "failed") {
    return (
      <p className="rounded-md border border-[#371d1f] bg-[#261719] px-3 py-2 text-sm font-medium leading-5 text-[#ff6262]">
        {state.error}
      </p>
    )
  }
  return (
    <p className="rounded-md border border-[#174f31] bg-[#14231a] px-3 py-2 text-sm font-medium leading-5 text-[#36c66f]">
      Staging app created. Copy the credentials before leaving this page.
    </p>
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
    <section
      aria-labelledby="connected-app-credentials-title"
      className="rounded-lg border border-[#353535] bg-[#232323] p-3"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2
            className="text-lg font-semibold leading-none text-[#fdfdfd]"
            id="connected-app-credentials-title"
          >
            Staging credentials
          </h2>
          <p className="mt-2 text-sm font-medium leading-5 text-[#b2b2b2]">
            This credential is shown once. Store it before opening another page.
          </p>
        </div>
        <EnvironmentPill
          environment={credential.environment}
          ready={false}
          testStatus="not_tested"
        />
      </div>

      <div className="mt-3 flex flex-col gap-2">
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
          label="BFF base URL"
          value={credential.bffBaseUrl}
        />
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
      </div>

      <ConnectedAppTestStatus state={testState} />

      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <form action={testAction}>
          <input name="appId" type="hidden" value={app.id} />
          <button
            className="flex h-[30px] items-center justify-center rounded-md bg-[#2e2e2e] px-2.5 py-1.5 text-center text-sm font-medium leading-[18px] text-white transition-colors hover:bg-[#383838] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#009fff]"
            type="submit"
          >
            Test connection
          </button>
        </form>
        <button
          className="flex h-[30px] cursor-not-allowed items-center justify-center rounded-md border border-[#353535] px-2.5 py-1.5 text-center text-sm font-medium leading-[18px] text-[#8b8b8b]"
          disabled
          type="button"
        >
          Production locked
        </button>
      </div>
    </section>
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
  if (state.status === "passed") {
    return (
      <p className="mt-3 rounded-md border border-[#174f31] bg-[#14231a] px-3 py-2 text-sm font-medium leading-5 text-[#36c66f]">
        {state.detail ?? "Connection test passed."}
      </p>
    )
  }
  return (
    <p className="mt-3 rounded-md border border-[#371d1f] bg-[#261719] px-3 py-2 text-sm font-medium leading-5 text-[#ff6262]">
      {state.error ?? state.detail ?? "Connection test failed."}
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
  if (state.status === "failed" || state.status === "blocked") {
    return (
      <p className="rounded-md border border-[#371d1f] bg-[#261719] px-3 py-2 text-sm font-medium leading-5 text-[#ff6262]">
        {state.error ?? state.detail ?? "Credential action failed."}
      </p>
    )
  }
  return (
    <p className="rounded-md border border-[#174f31] bg-[#14231a] px-3 py-2 text-sm font-medium leading-5 text-[#36c66f]">
      {state.detail ?? "Credential action completed."}
    </p>
  )
}

function ConnectedAppOneTimeCredentialPanel({
  credential,
  title,
}: {
  credential: AdminConnectedAppCredential
  title: string
}) {
  return (
    <section
      aria-labelledby="connected-app-one-time-credentials-title"
      className="rounded-lg border border-[#353535] bg-[#232323] p-3"
    >
      <h2
        className="text-lg font-semibold leading-none text-[#fdfdfd]"
        id="connected-app-one-time-credentials-title"
      >
        {title}
      </h2>
      <p className="mt-2 text-sm font-medium leading-5 text-[#b2b2b2]">
        This credential is shown once. Store it before leaving this page.
      </p>
      <div className="mt-3 flex flex-col gap-2">
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
          label="BFF base URL"
          value={credential.bffBaseUrl}
        />
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
      </div>
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
  return (
    <div className="flex min-h-[43px] w-full items-start gap-4 rounded-lg border border-[#353535] bg-[#1f1f1f] p-3">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold uppercase leading-none text-[#8b8b8b]">
          {label}
        </p>
        {multiline ? (
          <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-sm leading-5 text-[#fdfdfd]">
            {value}
          </pre>
        ) : (
          <p
            className={cn(
              "mt-2 break-all font-mono text-sm leading-5 text-[#fdfdfd]",
              secret && "text-[#ffdb8a]",
            )}
          >
            {value}
          </p>
        )}
      </div>
      <CopyCredentialButton label={label} value={value} />
    </div>
  )
}

function CopyCredentialButton({
  label,
  value,
}: {
  label: string
  value: string
}) {
  const [copied, setCopied] = useState(false)

  async function copyValue() {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    }
  }

  return (
    <button
      aria-label={`Copy ${label}`}
      className="flex h-[30px] shrink-0 items-center gap-1 rounded-md border border-[#353535] px-2.5 text-sm font-medium leading-[18px] text-white transition-colors hover:bg-[#2e2e2e] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#009fff]"
      onClick={copyValue}
      type="button"
    >
      <Copy aria-hidden className="size-4" />
      {copied ? "Copied" : "Copy"}
    </button>
  )
}

function McpTextField({
  defaultValue,
  disabled = false,
  label,
  name,
  placeholder,
  visuallyHideLabel = false,
}: {
  defaultValue?: string
  disabled?: boolean
  label: string
  name: string
  placeholder: string
  visuallyHideLabel?: boolean
}) {
  return (
    <label className="flex w-full flex-col gap-2">
      <span
        className={cn(
          "text-base font-medium leading-[19px] text-white",
          visuallyHideLabel && "sr-only",
        )}
      >
        {label}
      </span>
      <input
        className="h-[43px] w-full rounded-lg border border-[#353535] bg-[#232323] px-3 text-base font-medium text-white outline-none placeholder:text-[#969696] focus:border-[#009fff] disabled:text-[#b2b2b2]"
        defaultValue={defaultValue}
        disabled={disabled}
        name={name}
        placeholder={placeholder}
      />
    </label>
  )
}

function BackToApplicationsLink() {
  return (
    <Link
      className="mt-3 flex h-5 w-fit items-center gap-1 text-sm font-medium text-white transition-colors hover:text-[#d8d8d8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#009fff]"
      href="/applications"
    >
      <ArrowLeft aria-hidden className="size-4" />
      Go back
    </Link>
  )
}

function ReadOnlyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-h-[35px] w-full items-center gap-10">
      <span className="flex min-w-0 flex-1 text-base font-medium leading-[19px] text-white">
        {label}
      </span>
      <span className="text-sm font-medium leading-[18px] text-[#b2b2b2]">
        {value}
      </span>
    </div>
  )
}

function SupportTierPill({ tier }: { tier: "T2" | "T3" }) {
  return (
    <span className="flex h-5 min-w-8 items-center justify-center rounded-full border border-[#353535] px-2 text-xs font-semibold leading-none text-[#fdfdfd]">
      {tier}
    </span>
  )
}

function displaySupportTier(item: AdminConnectorRegistryItem): "T2" | "T3" {
  return item.id === "internal-docs" ? "T2" : "T3"
}

function isAdminCreatedMcp(item: AdminConnectorRegistryItem): boolean {
  return item.sourceRef.startsWith("admin/mcp-servers/")
}

function SegmentedRow({
  children,
  label,
}: {
  children: ReactNode
  label: string
}) {
  return (
    <div className="flex min-h-[35px] w-full items-center gap-10">
      <span className="flex min-w-0 flex-1 text-base font-medium leading-[19px] text-white">
        {label}
      </span>
      <div className="flex shrink-0 items-center justify-center gap-2.5 overflow-hidden rounded-lg border border-[#353535] py-0.5 pl-0.5 pr-2.5">
        {children}
      </div>
    </div>
  )
}

function SegmentButton({
  active,
  disabled = false,
  label,
  name,
  onSelect,
}: {
  active: boolean
  disabled?: boolean
  label: string
  name: string
  onSelect: () => void
}) {
  return (
    <button
      aria-pressed={active}
      className={cn(
        "flex h-[30px] items-center justify-center rounded-md px-2.5 py-1.5 text-sm font-medium leading-[18px] text-white transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#009fff]",
        active ? "bg-[#383838]" : "bg-transparent hover:bg-[#2e2e2e]",
        disabled && "cursor-not-allowed opacity-50 hover:bg-transparent",
      )}
      disabled={disabled}
      name={name}
      onClick={onSelect}
      type="button"
    >
      {label}
    </button>
  )
}

function PageHeader({ title }: { title: string }) {
  return (
    <header>
      <h1 className="text-2xl font-semibold leading-none text-[#fdfdfd]">
        {title}
      </h1>
    </header>
  )
}

function McpActionNotice({ mcpAction }: { mcpAction?: string }) {
  if (!mcpAction) {
    return null
  }
  const message =
    mcpAction === "saved"
      ? { description: "MCP server saved.", tone: "success" }
      : mcpAction === "tested"
        ? { description: "MCP connection test passed.", tone: "success" }
        : mcpAction === "updated"
          ? {
              description: "MCP server settings updated.",
              tone: "success",
            }
          : mcpAction === "unsupported"
            ? {
                description:
                  "STDIO connection testing is waiting for the runtime launcher.",
                tone: "warning",
              }
            : mcpAction === "duplicate"
              ? {
                  description:
                    "An MCP server with this chat command already exists.",
                  tone: "warning",
                }
              : { description: "MCP server action failed.", tone: "danger" }

  return (
    <ConsoleActionToasts
      notifications={[
        {
          description: message.description,
          id: `mcp-action-${mcpAction}`,
          title: "Applications",
          tone: message.tone as "danger" | "success" | "warning",
        },
      ]}
    />
  )
}

function AppActionNotice({ appAction }: { appAction?: string }) {
  if (!appAction) {
    return null
  }
  const message =
    appAction === "disabled"
      ? { description: "Connected app disabled.", tone: "warning" }
      : { description: "Connected app action failed.", tone: "danger" }

  return (
    <ConsoleActionToasts
      notifications={[
        {
          description: message.description,
          id: `app-action-${appAction}`,
          title: "Applications",
          tone: message.tone as "danger" | "warning",
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
