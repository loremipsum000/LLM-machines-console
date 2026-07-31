"use client"

import {
  type ConnectedAppCreateActionState,
  type ConnectedAppCredentialActionState,
  type ConnectedAppTestActionState,
  checkAdminConnectedAppConnectionAction,
  createAdminConnectedAppAction,
  disableAdminConnectedAppAction,
  enableAdminConnectedAppAction,
  revokeAdminConnectedAppCredentialAction,
  rotateAdminConnectedAppCredentialsAction,
  softDeleteAdminConnectedAppAction,
  updateAdminConnectedAppPolicyAction,
} from "@/lib/admin/actions-core"
import type { RetainedConsoleRole } from "@/lib/auth/role-claims"
import { cn } from "@/lib/utils"
import type {
  AdminConnectedApp,
  AdminConnectedAppCredential,
  AdminConnectedAppCredentialMetadata,
  AdminInferenceModel,
} from "@llm-machines/contracts/inference-core"
import { ArrowLeft, Copy, Plus } from "lucide-react"
import Link from "next/link"
import {
  type FormEvent,
  useActionState,
  useEffect,
  useId,
  useRef,
  useState,
} from "react"
import { useFormStatus } from "react-dom"
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
  observedAt: null,
  status: "idle",
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
  view,
}: {
  accessRole: RetainedConsoleRole
  appAction?: string
  connectedAppDetail?: AdminConnectedApp | null
  connectedApps?: AdminConnectedApp[]
  modelOptions?: AdminInferenceModel[]
  view: ApplicationsView
}) {
  if (view === "new-app") {
    return <AddConnectedAppView modelOptions={modelOptions} />
  }
  if (view === "app-detail") {
    return (
      <ConnectedAppDetailView
        accessRole={accessRole}
        app={connectedAppDetail ?? null}
        appAction={appAction}
        modelOptions={modelOptions}
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
  modelOptions,
}: {
  modelOptions: AdminInferenceModel[]
}) {
  const [createState, createAction, createPending] = useActionState(
    createAdminConnectedAppAction,
    initialConnectedAppCreateState,
  )
  const [checkState, checkAction, checkPending] = useActionState(
    checkAdminConnectedAppConnectionAction,
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
            required
          />
          <ApplicationTextField
            label="Description"
            name="description"
            placeholder="What workflow will use this credential"
            required
          />
          <SegmentedControl
            label="Authentication"
            options={[
              {
                active: authMethod === "api_key",
                label: "Static API key",
                onSelect: () => setAuthMethod("api_key"),
              },
              {
                active: authMethod === "oauth_client_credentials",
                label: "OAuth client credentials",
                onSelect: () => setAuthMethod("oauth_client_credentials"),
              },
            ]}
          />
          <p className="text-xs leading-5 text-[#8b8b8b]">
            Authentication mode is permanent for this Application. OAuth is
            intended for clients that can request short-lived access tokens.
          </p>
          <ModelAliasFields modelOptions={modelOptions} />
          <div className="grid gap-3 sm:grid-cols-2">
            <OptionalLimitField
              checkboxName="rateLimitEnabled"
              inputName="rateLimitRpm"
              label="Requests per minute"
              max={10_000}
            />
            <OptionalLimitField
              checkboxName="tokenBudgetEnabled"
              inputName="tokenBudget7d"
              label="Tokens per seven days"
              max={100_000_000}
            />
          </div>
          <ConnectedAppCreateStatus state={createState} />
          <div className="flex justify-end gap-2">
            <Link className={secondaryButtonClass} href="/applications">
              Cancel
            </Link>
            <button
              className={primaryButtonClass}
              disabled={createPending || !hasModels}
              type="submit"
            >
              {createPending ? "Creating app..." : "Create app"}
            </button>
          </div>
        </form>

        {createState.status === "created" &&
        createState.app &&
        createState.credential ? (
          <ConnectedAppCredentialPanel
            app={createState.app}
            checkAction={checkAction}
            checkPending={checkPending}
            checkState={checkState}
            credential={createState.credential}
          />
        ) : null}
      </div>
    </div>
  )
}

function ConnectedAppDetailView({
  accessRole,
  app,
  appAction,
  modelOptions,
}: {
  accessRole: RetainedConsoleRole
  app: AdminConnectedApp | null
  appAction?: string
  modelOptions: AdminInferenceModel[]
}) {
  const [showDisableConfirm, setShowDisableConfirm] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showPolicyEditor, setShowPolicyEditor] = useState(false)
  const [showRotateConfirm, setShowRotateConfirm] = useState(false)
  const [credentialToRevoke, setCredentialToRevoke] =
    useState<AdminConnectedAppCredentialMetadata | null>(null)
  const [checkState, checkAction, checkPending] = useActionState(
    checkAdminConnectedAppConnectionAction,
    initialConnectedAppTestState,
  )
  const [rotateState, rotateAction, rotatePending] = useActionState(
    rotateAdminConnectedAppCredentialsAction,
    initialConnectedAppCredentialState,
  )
  const [revokeState, revokeAction, revokePending] = useActionState(
    revokeAdminConnectedAppCredentialAction,
    initialConnectedAppCredentialState,
  )
  const [latestApp, setLatestApp] = useState(app)
  const [activeOperation, setActiveOperation] = useState<
    "check" | "revoke" | "rotate" | null
  >(null)
  const [rotationReveal, setRotationReveal] =
    useState<AdminConnectedAppCredential | null>(null)
  const operationLockRef = useRef<"check" | "revoke" | "rotate" | null>(null)
  const operationPending =
    activeOperation !== null || checkPending || rotatePending || revokePending

  useEffect(() => {
    setLatestApp(app)
  }, [app])
  useEffect(() => {
    if (checkState.app) {
      setLatestApp(checkState.app)
    }
  }, [checkState.app])
  useEffect(() => {
    if (rotateState.app) {
      setLatestApp(rotateState.app)
    }
  }, [rotateState.app])
  useEffect(() => {
    if (revokeState.app) {
      setLatestApp(revokeState.app)
    }
  }, [revokeState.app])
  useEffect(() => {
    if (operationLockRef.current !== "check" || checkState.status === "idle") {
      return
    }
    operationLockRef.current = null
    setActiveOperation(null)
  }, [checkState])
  useEffect(() => {
    if (
      operationLockRef.current !== "rotate" ||
      rotateState.status === "idle"
    ) {
      return
    }
    operationLockRef.current = null
    setActiveOperation(null)
    setShowRotateConfirm(false)
    setRotationReveal(rotateState.credential)
  }, [rotateState])
  useEffect(() => {
    if (
      operationLockRef.current !== "revoke" ||
      revokeState.status === "idle"
    ) {
      return
    }
    operationLockRef.current = null
    setActiveOperation(null)
    setCredentialToRevoke(null)
  }, [revokeState])

  function beginOperation(
    event: FormEvent<HTMLFormElement>,
    operation: "check" | "revoke" | "rotate",
  ) {
    if (operationLockRef.current) {
      event.preventDefault()
      return
    }
    operationLockRef.current = operation
    setActiveOperation(operation)
    if (operation === "rotate") {
      setRotationReveal(null)
    }
  }

  if (!app) {
    return (
      <div className="w-full min-h-screen min-h-dvh pb-16 pt-8 lg:pt-[73px]">
        <SubpageHeader title="Applications > App settings" />
        <p className="mt-10 rounded-lg border border-[#353535] bg-[#232323] p-4 text-sm text-[#b2b2b2] lg:w-[640px]">
          This Application is not available.
        </p>
      </div>
    )
  }

  const currentApp = latestApp ?? app
  const isAdmin = accessRole === "admin"

  return (
    <div className="w-full min-h-screen min-h-dvh pb-16 pt-8 lg:pt-[73px]">
      <SubpageHeader title={`Applications > ${currentApp.name}`} />
      <div className="mt-10 flex w-full flex-col gap-3 lg:w-[640px]">
        <AppActionNotice appAction={appAction} />
        <section className="grid gap-3 rounded-lg border border-[#353535] bg-[#232323] p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2
                className="truncate text-lg font-semibold text-white"
                data-dialog-focus-fallback
                tabIndex={-1}
              >
                {currentApp.name}
              </h2>
              <p className="mt-1 text-sm text-[#b2b2b2]">
                {currentApp.description}
              </p>
            </div>
            <StatusPill status={currentApp.status} />
          </div>
          <DetailRow
            label="Authentication"
            value={authMethodLabel(currentApp.authMethod)}
          />
          <p className="text-xs leading-5 text-[#8b8b8b]">
            Authentication mode cannot be changed after creation.
          </p>
          <DetailRow
            label="Allowed models"
            value={currentApp.allowedModels.join(", ")}
          />
          <DetailRow
            label="Request limit"
            value={formatNullableLimit(currentApp.rateLimitRpm, " rpm")}
          />
          <DetailRow
            label="Token limit"
            value={formatNullableLimit(currentApp.tokenBudget7d, " / 7 days")}
          />
          <DetailRow
            label="Connection"
            value={connectionStatusLabel(currentApp.connectionStatus)}
          />
          <DetailRow
            label="Last connected"
            value={dateTimeLabel(currentApp.lastConnectedAt)}
          />
          <p className="rounded-lg border border-[#353535] bg-[#181818] px-3 py-2 text-xs leading-5 text-[#b2b2b2]">
            Connection passes only after a real third-party client authenticates
            and calls GET /models. Console only refreshes that recorded evidence
            and never probes with the credential.
          </p>
          <ConnectedAppTestStatus state={checkState} />
          <CredentialActionStatus state={rotateState} />
          <CredentialActionStatus state={revokeState} />
          <div className="flex flex-wrap justify-end gap-2">
            <form
              action={checkAction}
              onSubmit={(event) => beginOperation(event, "check")}
            >
              <input name="appId" type="hidden" value={currentApp.id} />
              <PendingSubmitButton
                className={primaryButtonClass}
                forcePending={activeOperation === "check" || checkPending}
                idleLabel="Check connection"
                pendingLabel="Checking..."
                unavailable={operationPending && activeOperation !== "check"}
              />
            </form>
            <button
              className={secondaryButtonClass}
              disabled={operationPending}
              onClick={() => setShowRotateConfirm(true)}
              type="button"
            >
              Rotate credentials
            </button>
            {isAdmin ? (
              <button
                className={secondaryButtonClass}
                onClick={() => setShowPolicyEditor((current) => !current)}
                type="button"
              >
                {showPolicyEditor ? "Close policy editor" : "Edit policy"}
              </button>
            ) : null}
            {currentApp.status === "enabled" ? (
              <button
                className={dangerButtonClass}
                onClick={() => setShowDisableConfirm(true)}
                type="button"
              >
                Disable app
              </button>
            ) : isAdmin ? (
              <form action={enableAdminConnectedAppAction}>
                <input name="appId" type="hidden" value={currentApp.id} />
                <input
                  name="returnTo"
                  type="hidden"
                  value={`/applications/apps/${currentApp.id}`}
                />
                <button className={secondaryButtonClass} type="submit">
                  Re-enable app
                </button>
              </form>
            ) : null}
            {isAdmin ? (
              <button
                className={dangerButtonClass}
                onClick={() => setShowDeleteConfirm(true)}
                type="button"
              >
                Delete app
              </button>
            ) : null}
          </div>
        </section>

        {showPolicyEditor ? (
          <ConnectedAppPolicyEditor
            app={currentApp}
            modelOptions={modelOptions}
          />
        ) : null}

        <CredentialMetadataList
          app={currentApp}
          disabled={operationPending}
          onRevoke={setCredentialToRevoke}
        />

        {rotationReveal ? (
          <ConnectedAppCredentialReveal
            credential={rotationReveal}
            title="Rotated credential"
          />
        ) : null}
      </div>

      {showRotateConfirm ? (
        <ConfirmationDialog
          description={rotationDescription(currentApp.authMethod)}
          dismissDisabled={operationPending}
          onCancel={() => setShowRotateConfirm(false)}
          title="Rotate Application credential?"
        >
          <form
            action={rotateAction}
            onSubmit={(event) => beginOperation(event, "rotate")}
          >
            <input name="appId" type="hidden" value={currentApp.id} />
            <PendingSubmitButton
              className={primaryButtonClass}
              forcePending={activeOperation === "rotate" || rotatePending}
              idleLabel="Rotate"
              pendingLabel="Rotating..."
              unavailable={operationPending && activeOperation !== "rotate"}
            />
          </form>
        </ConfirmationDialog>
      ) : null}

      {credentialToRevoke ? (
        <ConfirmationDialog
          description="This exact credential will stop working immediately. This action cannot be undone."
          dismissDisabled={operationPending}
          onCancel={() => setCredentialToRevoke(null)}
          title="Revoke credential now?"
        >
          <form
            action={revokeAction}
            onSubmit={(event) => beginOperation(event, "revoke")}
          >
            <input name="appId" type="hidden" value={currentApp.id} />
            <input
              name="credentialId"
              type="hidden"
              value={credentialToRevoke.id}
            />
            <PendingSubmitButton
              className={dangerButtonClass}
              forcePending={activeOperation === "revoke" || revokePending}
              idleLabel="Revoke now"
              pendingLabel="Revoking..."
              unavailable={operationPending && activeOperation !== "revoke"}
            />
          </form>
        </ConfirmationDialog>
      ) : null}

      {showDisableConfirm ? (
        <ConfirmationDialog
          description="All Application credentials will stop reaching inference until an Admin re-enables this Application."
          onCancel={() => setShowDisableConfirm(false)}
          title="Disable this app?"
        >
          <form action={disableAdminConnectedAppAction}>
            <input name="appId" type="hidden" value={currentApp.id} />
            <input
              name="returnTo"
              type="hidden"
              value={`/applications/apps/${currentApp.id}`}
            />
            <PendingSubmitButton
              className={dangerButtonClass}
              idleLabel="Disable"
              pendingLabel="Disabling..."
            />
          </form>
        </ConfirmationDialog>
      ) : null}

      {showDeleteConfirm ? (
        <ConfirmationDialog
          description="Soft deletion revokes every credential immediately. The Application identifier and audit linkage remain retained."
          onCancel={() => setShowDeleteConfirm(false)}
          title="Delete this app?"
        >
          <form action={softDeleteAdminConnectedAppAction}>
            <input name="appId" type="hidden" value={currentApp.id} />
            <input
              name="returnTo"
              type="hidden"
              value={`/applications/apps/${currentApp.id}`}
            />
            <ApplicationTextField
              label="Type DELETE APPLICATION to confirm"
              name="confirmation"
              placeholder="DELETE APPLICATION"
              required
            />
            <PendingSubmitButton
              className={cn(dangerButtonClass, "mt-3")}
              idleLabel="Delete application"
              pendingLabel="Deleting..."
            />
          </form>
        </ConfirmationDialog>
      ) : null}
    </div>
  )
}

function ConnectedAppPolicyEditor({
  app,
  modelOptions,
}: {
  app: AdminConnectedApp
  modelOptions: AdminInferenceModel[]
}) {
  return (
    <form
      action={updateAdminConnectedAppPolicyAction}
      className="grid gap-3 rounded-lg border border-[#353535] bg-[#232323] p-4"
    >
      <div>
        <h2 className="text-lg font-semibold text-white">Application policy</h2>
        <p className="mt-1 text-sm text-[#b2b2b2]">
          Admin-only configuration. Authentication remains fixed as{" "}
          {authMethodLabel(app.authMethod)}.
        </p>
      </div>
      <input name="appId" type="hidden" value={app.id} />
      <input
        name="returnTo"
        type="hidden"
        value={`/applications/apps/${app.id}`}
      />
      <ApplicationTextField
        defaultValue={app.name}
        label="Name"
        name="name"
        placeholder="Customer application"
        required
      />
      <ApplicationTextField
        defaultValue={app.description}
        label="Description"
        name="description"
        placeholder="Application purpose"
        required
      />
      <ModelAliasFields
        modelOptions={modelOptions}
        selectedAliases={app.allowedModels}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <OptionalLimitField
          checkboxName="rateLimitEnabled"
          initialValue={app.rateLimitRpm}
          inputName="rateLimitRpm"
          label="Requests per minute"
          max={10_000}
        />
        <OptionalLimitField
          checkboxName="tokenBudgetEnabled"
          initialValue={app.tokenBudget7d}
          inputName="tokenBudget7d"
          label="Tokens per seven days"
          max={100_000_000}
        />
      </div>
      <div className="flex justify-end">
        <button className={primaryButtonClass} type="submit">
          Save policy
        </button>
      </div>
    </form>
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
                  <Metric
                    label="Authentication"
                    value={authMethodLabel(app.authMethod)}
                  />
                  <Metric
                    label="Connection"
                    value={connectionStatusLabel(app.connectionStatus)}
                  />
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
  checkAction,
  checkPending,
  checkState,
  credential,
}: {
  app: AdminConnectedApp
  checkAction: (formData: FormData) => void
  checkPending: boolean
  checkState: ConnectedAppTestActionState
  credential: AdminConnectedAppCredential
}) {
  return (
    <ConnectedAppCredentialReveal
      credential={credential}
      footer={
        <>
          <p className="text-xs leading-5 text-[#b2b2b2]">
            Configure the third-party client with this credential and call GET
            /models. Check connection only refreshes recorded gateway evidence.
          </p>
          <ConnectedAppTestStatus state={checkState} />
          <div className="flex justify-end gap-2">
            <Link
              className={secondaryButtonClass}
              href={`/applications/apps/${encodeURIComponent(app.id)}`}
            >
              View application
            </Link>
            <form action={checkAction}>
              <input name="appId" type="hidden" value={app.id} />
              <PendingSubmitButton
                className={primaryButtonClass}
                forcePending={checkPending}
                idleLabel="Check connection"
                pendingLabel="Checking..."
              />
            </form>
          </div>
        </>
      }
      title="Application credential"
    />
  )
}

export function ConnectedAppCredentialReveal({
  credential,
  footer,
  title,
}: {
  credential: AdminConnectedAppCredential
  footer?: React.ReactNode
  title: string
}) {
  const headingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  return (
    <section className="grid gap-3 rounded-lg border border-[#7b5d1a] bg-[#2b2414] p-4">
      <div>
        <h2
          className="text-lg font-semibold text-white"
          ref={headingRef}
          tabIndex={-1}
        >
          {title}
        </h2>
        <p className="mt-1 text-sm text-[#ffdb8a]">
          This secret is shown once. Store it before leaving this page.
        </p>
        <p className="mt-1 text-xs leading-5 text-[#b2b2b2]">
          {credential.authMethod === "api_key"
            ? "During rotation, the previous static key remains valid for up to 24 hours unless it is revoked immediately."
            : "During rotation, the previous OAuth client secret is invalidated immediately. Already-issued access tokens only last until their short expiry."}
        </p>
      </div>
      <CopyableCredentialRow
        label="Credential ID"
        value={credential.credentialId}
      />
      {credential.authMethod === "api_key" ? (
        <CopyableCredentialRow
          label="API key"
          secret
          value={credential.apiKey}
        />
      ) : (
        <>
          <CopyableCredentialRow
            label="Client ID"
            value={credential.clientId}
          />
          <CopyableCredentialRow
            label="Client secret"
            secret
            value={credential.clientSecret}
          />
          <CopyableCredentialRow
            label="Token URL"
            value={credential.tokenUrl}
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

function CredentialMetadataList({
  app,
  disabled,
  onRevoke,
}: {
  app: AdminConnectedApp
  disabled: boolean
  onRevoke: (credential: AdminConnectedAppCredentialMetadata) => void
}) {
  return (
    <section className="grid gap-3 rounded-lg border border-[#353535] bg-[#232323] p-4">
      <div>
        <h2 className="text-lg font-semibold text-white">Credentials</h2>
        <p className="mt-1 text-sm text-[#b2b2b2]">
          Secret-free lifecycle metadata. Raw keys and client secrets are never
          available again after issuance.
        </p>
      </div>
      {app.credentials.map((credential) => (
        <article
          className="grid gap-2 rounded-lg border border-[#353535] bg-[#181818] p-3"
          key={credential.id}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-white">
                {credential.keyPrefix ?? credential.clientId ?? credential.id}
              </p>
              <p className="mt-1 break-all font-mono text-xs text-[#8b8b8b]">
                {credential.id}
              </p>
            </div>
            <CredentialStatusPill status={credential.status} />
          </div>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            <Metric
              label="Type"
              value={authMethodLabel(credential.authMethod)}
            />
            <Metric
              label="Age"
              value={formatCredentialAge(credential.issuedAt)}
            />
            <Metric
              label="Last use"
              value={dateTimeLabel(credential.lastUsedAt)}
            />
            <Metric
              label="Rotated"
              value={dateTimeLabel(credential.rotatedAt)}
            />
            <Metric
              label="Overlap ends"
              value={dateTimeLabel(credential.overlapExpiresAt)}
            />
            <Metric
              label="Revoked"
              value={dateTimeLabel(credential.revokedAt)}
            />
          </dl>
          {credential.status !== "revoked" ? (
            <div className="flex justify-end">
              <button
                className={dangerButtonClass}
                disabled={disabled}
                onClick={() => onRevoke(credential)}
                type="button"
              >
                Revoke now
              </button>
            </div>
          ) : null}
        </article>
      ))}
    </section>
  )
}

function ModelAliasFields({
  modelOptions,
  selectedAliases = [],
}: {
  modelOptions: AdminInferenceModel[]
  selectedAliases?: string[]
}) {
  const selected = new Set(selectedAliases)
  const choices = modelAliasChoices(modelOptions, selectedAliases)
  return (
    <fieldset className="grid gap-2">
      <legend className="text-sm font-medium text-white">
        Allowed model aliases
      </legend>
      {choices.length > 0 ? (
        choices.map((model, index) => (
          <label
            className="flex items-center gap-3 rounded-lg border border-[#353535] bg-[#181818] px-3 py-2 text-sm text-white"
            key={model.name}
          >
            <input
              aria-label={model.name}
              defaultChecked={
                selectedAliases.length > 0
                  ? selected.has(model.name)
                  : index === 0
              }
              name="allowedModels"
              type="checkbox"
              value={model.name}
            />
            <span className="min-w-0 flex-1 truncate">{model.name}</span>
            <span className="text-[#8b8b8b]">{model.provider}</span>
          </label>
        ))
      ) : (
        <p className="text-sm text-[#b2b2b2]">
          No served model aliases are available yet.
        </p>
      )}
    </fieldset>
  )
}

function OptionalLimitField({
  checkboxName,
  initialValue = null,
  inputName,
  label,
  max,
}: {
  checkboxName: string
  initialValue?: number | null
  inputName: string
  label: string
  max: number
}) {
  const [enabled, setEnabled] = useState(initialValue !== null)
  return (
    <div className="grid gap-2 rounded-lg border border-[#353535] bg-[#181818] p-3">
      <label className="flex items-center justify-between gap-3 text-sm font-medium text-white">
        {label}
        <input
          checked={enabled}
          name={checkboxName}
          onChange={(event) => setEnabled(event.target.checked)}
          type="checkbox"
        />
      </label>
      <input
        aria-label={`${label} value`}
        className="h-10 rounded-lg border border-[#353535] bg-[#232323] px-3 text-white outline-none disabled:cursor-not-allowed disabled:opacity-50"
        defaultValue={initialValue ?? undefined}
        disabled={!enabled}
        max={max}
        min={1}
        name={inputName}
        placeholder="Disabled"
        required={enabled}
        type="number"
      />
      <p className="text-xs text-[#8b8b8b]">
        {enabled ? "Limit enabled" : "Disabled by default"}
      </p>
    </div>
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

function PendingSubmitButton({
  className,
  forcePending = false,
  idleLabel,
  pendingLabel,
  unavailable = false,
}: {
  className: string
  forcePending?: boolean
  idleLabel: string
  pendingLabel: string
  unavailable?: boolean
}) {
  const { pending } = useFormStatus()
  const isPending = forcePending || pending
  return (
    <button
      aria-busy={isPending || undefined}
      className={className}
      disabled={isPending || unavailable}
      type="submit"
    >
      {isPending ? pendingLabel : idleLabel}
    </button>
  )
}

function ConnectedAppCreateStatus({
  state,
}: {
  state: ConnectedAppCreateActionState
}) {
  if (state.status === "idle") {
    return <output aria-live="polite" className="sr-only" />
  }
  return (
    <output
      aria-atomic="true"
      aria-live="polite"
      className={cn(
        "block rounded-lg border px-3 py-2 text-sm",
        state.status === "created"
          ? "border-[#174f31] bg-[#14231a] text-[#36c66f]"
          : "border-[#371d1f] bg-[#261719] text-[#ff6262]",
      )}
    >
      {state.status === "created"
        ? "Application created. Copy its credential now."
        : state.error}
    </output>
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
  const positive = state.status === "passed"
  const waiting = state.status === "waiting"
  return (
    <output
      aria-atomic="true"
      aria-live="polite"
      className={cn(
        "block rounded-lg border px-3 py-2 text-sm",
        positive
          ? "border-[#174f31] bg-[#14231a] text-[#36c66f]"
          : waiting
            ? "border-[#51431c] bg-[#2b2414] text-[#ffdb8a]"
            : "border-[#371d1f] bg-[#261719] text-[#ff6262]",
      )}
    >
      {state.error ?? state.detail ?? "Connection evidence is unavailable."}
      {state.observedAt ? ` Observed ${dateTimeLabel(state.observedAt)}.` : ""}
    </output>
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
    <output
      aria-atomic="true"
      aria-live="polite"
      className={cn(
        "block rounded-lg border px-3 py-2 text-sm",
        failed
          ? "border-[#371d1f] bg-[#261719] text-[#ff6262]"
          : "border-[#174f31] bg-[#14231a] text-[#36c66f]",
      )}
    >
      {failed
        ? (state.error ?? state.detail ?? "Credential action failed.")
        : (state.detail ?? "Credential action completed.")}
    </output>
  )
}

function ApplicationTextField({
  defaultValue,
  label,
  name,
  placeholder,
  required = false,
}: {
  defaultValue?: string
  label: string
  name: string
  placeholder: string
  required?: boolean
}) {
  return (
    <label className="grid gap-2 text-sm font-medium text-white">
      {label}
      <input
        className="h-11 rounded-lg border border-[#353535] bg-[#181818] px-3 text-white outline-none placeholder:text-[#8b8b8b] focus:border-[#009fff]"
        defaultValue={defaultValue}
        name={name}
        placeholder={placeholder}
        required={required}
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
    <div className="grid gap-2">
      <span className="text-sm font-medium text-white">{label}</span>
      <div className="flex rounded-lg border border-[#353535] p-0.5">
        {options.map((option) => (
          <button
            aria-pressed={option.active}
            className={cn(
              "flex-1 rounded-md px-3 py-2 text-sm text-white",
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

function ConfirmationDialog({
  children,
  description,
  dismissDisabled = false,
  onCancel,
  title,
}: {
  children: React.ReactNode
  description: string
  dismissDisabled?: boolean
  onCancel: () => void
  title: string
}) {
  const cancelButtonRef = useRef<HTMLButtonElement>(null)
  const descriptionId = useId()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) {
      return
    }
    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
    if (typeof dialog.showModal === "function") {
      dialog.showModal()
    } else {
      dialog.setAttribute("open", "")
    }
    cancelButtonRef.current?.focus()

    return () => {
      if (dialog.open && typeof dialog.close === "function") {
        dialog.close()
      }
      const focusTarget =
        previouslyFocused?.isConnected === true
          ? previouslyFocused
          : document.querySelector<HTMLElement>("[data-dialog-focus-fallback]")
      focusTarget?.focus()
    }
  }, [])

  return (
    <dialog
      aria-describedby={descriptionId}
      aria-labelledby={titleId}
      className="m-auto w-[calc(100%_-_2rem)] max-w-[420px] rounded-lg border border-[#353535] bg-[#232323] p-4 text-white backdrop:bg-black/60"
      onCancel={(event) => {
        event.preventDefault()
        if (!dismissDisabled) {
          onCancel()
        }
      }}
      ref={dialogRef}
    >
      <h2 className="text-lg font-semibold" id={titleId}>
        {title}
      </h2>
      <p className="mt-2 text-sm leading-5 text-[#b2b2b2]" id={descriptionId}>
        {description}
      </p>
      <div className="mt-4 grid gap-3">
        {children}
        <button
          className={secondaryButtonClass}
          disabled={dismissDisabled}
          onClick={onCancel}
          ref={cancelButtonRef}
          type="button"
        >
          Cancel
        </button>
      </div>
    </dialog>
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

function CredentialStatusPill({
  status,
}: {
  status: AdminConnectedAppCredentialMetadata["status"]
}) {
  return (
    <span
      className={cn(
        "rounded-full border px-2 py-1 text-xs font-semibold capitalize",
        status === "active" && "border-[#174f31] text-[#36c66f]",
        status === "retiring" && "border-[#51431c] text-[#ffdb8a]",
        status === "revoked" && "border-[#353535] text-[#8b8b8b]",
      )}
    >
      {status}
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
  const messages: Record<
    string,
    { description: string; tone: "danger" | "success" | "warning" }
  > = {
    deleted: { description: "Application deleted.", tone: "warning" },
    disabled: { description: "Application disabled.", tone: "warning" },
    failed: { description: "Application action failed.", tone: "danger" },
    invalid: {
      description: "Application action needs valid values and confirmation.",
      tone: "danger",
    },
    reenabled: { description: "Application re-enabled.", tone: "success" },
    updated: { description: "Application policy updated.", tone: "success" },
  }
  const message = messages[appAction] ?? messages.failed
  return (
    <ConsoleActionToasts
      notifications={[
        {
          description: message.description,
          id: `app-action-${appAction}`,
          title: "Applications",
          tone: message.tone,
        },
      ]}
    />
  )
}

function modelAliasChoices(
  models: AdminInferenceModel[],
  selectedAliases: string[],
): Array<{ name: string; provider: string }> {
  const choices = new Map<string, { name: string; provider: string }>()
  for (const model of models) {
    choices.set(model.name, {
      name: model.name,
      provider: model.provider ?? "Local",
    })
  }
  for (const alias of selectedAliases) {
    if (!choices.has(alias)) {
      choices.set(alias, { name: alias, provider: "Currently unavailable" })
    }
  }
  return [...choices.values()]
}

function dateTimeLabel(value: string | null | undefined): string {
  return value ? applicationsDateTimeFormatter.format(new Date(value)) : "Never"
}

function formatCredentialAge(value: string): string {
  const ageMs = Math.max(0, Date.now() - new Date(value).getTime())
  const days = Math.floor(ageMs / 86_400_000)
  return days === 0 ? "Issued today" : `${days} day${days === 1 ? "" : "s"}`
}

function authMethodLabel(authMethod: AdminConnectedApp["authMethod"]): string {
  return authMethod === "api_key"
    ? "Static API key"
    : "OAuth client credentials"
}

function connectionStatusLabel(
  status: AdminConnectedApp["connectionStatus"],
): string {
  if (status === "connected") {
    return "Connected"
  }
  if (status === "degraded") {
    return "Degraded"
  }
  return "Not connected"
}

function rotationDescription(
  authMethod: AdminConnectedApp["authMethod"],
): string {
  return authMethod === "api_key"
    ? "A new static key will be shown once. The current key enters a fixed 24-hour overlap and can be revoked sooner."
    : "A new OAuth client secret will be shown once. The old client secret becomes invalid immediately."
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
  "inline-flex h-9 items-center justify-center gap-1 rounded-md border border-[#353535] px-3 text-sm font-medium text-white transition-colors hover:bg-[#2e2e2e] disabled:cursor-not-allowed disabled:opacity-50"
const dangerButtonClass =
  "inline-flex h-9 items-center justify-center rounded-md border border-[#4a2426] px-3 text-sm font-medium text-[#ff595d] transition-colors hover:bg-[#321f20] disabled:cursor-not-allowed disabled:opacity-50"
