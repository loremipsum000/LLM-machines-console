"use client"

import {
  type ConnectedAppCreateActionState,
  type ConnectedAppCredentialActionState,
  type ConnectedAppFirecrawlCredentialActionState,
  type ConnectedAppFirecrawlLifecycleActionState,
  type ConnectedAppFirecrawlTestActionState,
  type ConnectedAppTestActionState,
  checkAdminConnectedAppConnectionAction,
  checkAdminConnectedAppFirecrawlConnectionAction,
  createAdminConnectedAppAction,
  disableAdminConnectedAppAction,
  disableAdminConnectedAppFirecrawlAction,
  enableAdminConnectedAppAction,
  enableAdminConnectedAppFirecrawlAction,
  revokeAdminConnectedAppCredentialAction,
  revokeAdminConnectedAppFirecrawlCredentialAction,
  rotateAdminConnectedAppCredentialsAction,
  rotateAdminConnectedAppFirecrawlCredentialAction,
  softDeleteAdminConnectedAppAction,
  updateAdminConnectedAppFirecrawlPolicyAction,
  updateAdminConnectedAppPolicyAction,
} from "@/lib/admin/actions-core"
import { usePendingConsoleSessionRecovery } from "@/lib/auth/pending-session-recovery"
import type { RetainedConsoleRole } from "@/lib/auth/role-claims"
import { cn } from "@/lib/utils"
import type {
  AdminConnectedApp,
  AdminConnectedAppCredential,
  AdminConnectedAppCredentialMetadata,
  AdminConnectedAppFirecrawlCredential,
  AdminConnectedAppFirecrawlCredentialMetadata,
  AdminInferenceModel,
  InferenceCoreSourceStatus,
} from "@llm-machines/contracts/inference-core"
import { ArrowLeft, ChevronDown, Copy, Plus } from "lucide-react"
import { useRouter } from "next/navigation"
import {
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useActionState,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
} from "react"
import { useFormStatus } from "react-dom"
import { CanonicalKeyLink as Link } from "../canonical-key-link"
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

const initialFirecrawlCredentialState: ConnectedAppFirecrawlCredentialActionState =
  {
    app: null,
    credential: null,
    detail: null,
    error: null,
    status: "idle",
  }

const initialFirecrawlLifecycleState: ConnectedAppFirecrawlLifecycleActionState =
  {
    app: null,
    detail: null,
    error: null,
    status: "idle",
  }

const initialFirecrawlTestState: ConnectedAppFirecrawlTestActionState = {
  app: null,
  detail: null,
  error: null,
  observedAt: null,
  status: "idle",
}

const interruptedActionError =
  "The action did not complete. Sign in again or retry."

const interruptedConnectedAppCreateState: ConnectedAppCreateActionState = {
  ...initialConnectedAppCreateState,
  error: interruptedActionError,
  status: "failed",
}

const interruptedConnectedAppTestState: ConnectedAppTestActionState = {
  ...initialConnectedAppTestState,
  error: interruptedActionError,
  status: "failed",
}

const interruptedConnectedAppCredentialState: ConnectedAppCredentialActionState =
  {
    ...initialConnectedAppCredentialState,
    error: interruptedActionError,
    status: "failed",
  }

const interruptedFirecrawlCredentialState: ConnectedAppFirecrawlCredentialActionState =
  {
    ...initialFirecrawlCredentialState,
    error: interruptedActionError,
    status: "failed",
  }

const interruptedFirecrawlLifecycleState: ConnectedAppFirecrawlLifecycleActionState =
  {
    ...initialFirecrawlLifecycleState,
    error: interruptedActionError,
    status: "failed",
  }

const interruptedFirecrawlTestState: ConnectedAppFirecrawlTestActionState = {
  ...initialFirecrawlTestState,
  error: interruptedActionError,
  status: "failed",
}

type ApplicationMutationOperation =
  | "application-delete"
  | "application-disable"
  | "application-enable"
  | "application-policy"
  | "firecrawl-check"
  | "firecrawl-disable"
  | "firecrawl-enable"
  | "firecrawl-policy"
  | "firecrawl-revoke"
  | "firecrawl-rotate"
  | "inference-check"
  | "inference-revoke"
  | "inference-rotate"

interface ApplicationMutationLock {
  activeOperation: ApplicationMutationOperation | null
  begin: (
    event: FormEvent<HTMLFormElement>,
    operation: ApplicationMutationOperation,
  ) => boolean
  isActive: (operation: ApplicationMutationOperation) => boolean
  pending: boolean
  release: (operation: ApplicationMutationOperation) => boolean
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
  modelInventorySourceStatus = "not_configured",
  view,
}: {
  accessRole: RetainedConsoleRole
  appAction?: string
  connectedAppDetail?: AdminConnectedApp | null
  connectedApps?: AdminConnectedApp[]
  modelOptions?: AdminInferenceModel[]
  modelInventorySourceStatus?: InferenceCoreSourceStatus
  view: ApplicationsView
}) {
  const visibleAppAction =
    accessRole === "admin" || appAction === "disabled" || appAction === "failed"
      ? appAction
      : undefined
  if (view === "new-app") {
    return (
      <AddConnectedAppView
        modelInventorySourceStatus={modelInventorySourceStatus}
        modelOptions={modelOptions}
      />
    )
  }
  if (view === "app-detail") {
    return (
      <ConnectedAppDetailView
        accessRole={accessRole}
        app={connectedAppDetail ?? null}
        appAction={visibleAppAction}
        modelOptions={modelOptions}
      />
    )
  }

  return (
    <div className="w-full min-h-screen min-h-dvh pb-16 pt-8 lg:pt-[73px]">
      <PageHeader title="Keys" />
      <AppActionNotice appAction={visibleAppAction} />
      <div className="mt-10 w-full lg:w-[640px]">
        <ConnectedAppsPanel accessRole={accessRole} apps={connectedApps} />
      </div>
    </div>
  )
}

function AddConnectedAppView({
  modelInventorySourceStatus,
  modelOptions,
}: {
  modelInventorySourceStatus: InferenceCoreSourceStatus
  modelOptions: AdminInferenceModel[]
}) {
  const router = useRouter()
  const [createState, setCreateState] = useState(initialConnectedAppCreateState)
  const [closeDestination, setCloseDestination] = useState<string | null>(null)
  const createButtonRef = useRef<HTMLButtonElement>(null)
  const [createPending, startCreateTransition] = useTransition()
  usePendingConsoleSessionRecovery(createPending, createState == null)
  const [authMethod, setAuthMethod] = useState<
    "api_key" | "oauth_client_credentials"
  >("api_key")
  const [modelMode, setModelMode] = useState<"auto" | "manual">("auto")
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const manualInventoryAvailable =
    modelInventorySourceStatus === "ok" && modelOptions.length > 0

  useEffect(() => {
    if (createState.status !== "created") return
    const clearReveal = () => setCreateState(initialConnectedAppCreateState)
    const clearRestoredReveal = (event: Event) => {
      if ("persisted" in event && event.persisted === true) clearReveal()
    }
    window.addEventListener("pagehide", clearReveal)
    window.addEventListener("pageshow", clearRestoredReveal)
    window.addEventListener("popstate", clearReveal)
    return () => {
      window.removeEventListener("pagehide", clearReveal)
      window.removeEventListener("pageshow", clearRestoredReveal)
      window.removeEventListener("popstate", clearReveal)
    }
  }, [createState.status])

  useEffect(() => {
    if (!closeDestination || createState.status === "created") return
    const destination = closeDestination
    setCloseDestination(null)
    createButtonRef.current?.focus()
    router.replace(destination)
  }, [closeDestination, createState.status, router])

  const createAction = (formData: FormData) => {
    startCreateTransition(async () => {
      const result = await createAdminConnectedAppAction(
        initialConnectedAppCreateState,
        formData,
      )
      setCreateState(result)
    })
  }

  const closeCreatedKey = () => {
    const appId = createState.app?.id
    setCreateState(initialConnectedAppCreateState)
    setCloseDestination(
      appId ? `/keys/apps/${encodeURIComponent(appId)}` : "/keys",
    )
  }

  return (
    <div className="w-full min-h-screen min-h-dvh pb-16 pt-8 lg:pt-[73px]">
      <SubpageHeader title="Keys > Create Key" />
      <div className="mt-10 flex w-full flex-col gap-3 lg:w-[640px]">
        <form
          action={createAction}
          className="flex flex-col gap-3 rounded-lg border border-[#353535] bg-[#232323] p-4"
        >
          <input name="authMethod" type="hidden" value={authMethod} />
          <input name="modelMode" type="hidden" value={modelMode} />
          <ApplicationTextField
            label="Key name"
            name="name"
            placeholder="Production integration"
            required
          />
          <ApplicationTextField
            label="Description (optional)"
            name="description"
            placeholder="What will use this Key"
          />
          <SegmentedControl
            label="Model access"
            options={[
              {
                active: modelMode === "auto",
                label: "Auto",
                onSelect: () => setModelMode("auto"),
              },
              {
                active: modelMode === "manual",
                label: "Manual",
                onSelect: () => setModelMode("manual"),
              },
            ]}
          />
          <p className="text-xs leading-5 text-[#8b8b8b]">
            Auto follows the active approved model inventory, including models
            admitted after this Key is created.
          </p>
          {modelMode === "manual" ? (
            <ModelAliasFields modelOptions={modelOptions} />
          ) : null}
          {modelMode === "manual" && !manualInventoryAvailable ? (
            <p className="text-sm text-[#ffdb8a]" role="alert">
              Manual selection is unavailable until the active approved model
              inventory can be read.
            </p>
          ) : null}
          <button
            aria-expanded={advancedOpen}
            className="flex w-full items-center justify-between rounded-lg border border-[#353535] bg-[#181818] px-3 py-2 text-left text-sm font-medium text-white"
            onClick={() => setAdvancedOpen((current) => !current)}
            type="button"
          >
            Advanced features
            <ChevronDown
              aria-hidden
              className={cn(
                "size-4 transition-transform",
                advancedOpen && "rotate-180",
              )}
            />
          </button>
          {advancedOpen ? (
            <div className="flex flex-col gap-3" data-layout="vertical">
              <SegmentedControl
                label="Authentication method"
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
                Authentication is permanent for this Key. OAuth is intended for
                clients that request short-lived access tokens.
              </p>
              <OptionalLimitField
                checkboxName="rateLimitRpsEnabled"
                inputName="rateLimitRps"
                label="Requests per second"
                max={10_000}
              />
              <OptionalLimitField
                checkboxName="maxConcurrentRequestsEnabled"
                inputName="maxConcurrentRequests"
                label="Concurrent requests"
                max={10_000}
              />
              <OptionalLimitField
                checkboxName="maxContextBytesEnabled"
                inputName="maxContextBytes"
                label="Maximum context size"
                max={Number.MAX_SAFE_INTEGER}
              />
              <OptionalLimitField
                checkboxName="tokenAlertThreshold7dEnabled"
                enabledLabel="Visibility threshold enabled"
                inputName="tokenAlertThreshold7d"
                label="Seven-day usage alert"
                max={100_000_000}
              />
              <ApplicationCapacityPolicyCopy />
            </div>
          ) : null}
          <p className="rounded-lg border border-[#353535] bg-[#181818] px-3 py-2 text-xs leading-5 text-[#b2b2b2]">
            Create Key issues inference access only. Firecrawl stays off and
            must be enabled separately from Key settings with its own credential
            and disclaimer acceptance.
          </p>
          <ConnectedAppCreateStatus state={createState} />
          <div className="flex justify-end gap-2">
            <Link className={secondaryButtonClass} href="/applications">
              Cancel
            </Link>
            <button
              className={primaryButtonClass}
              disabled={
                createPending ||
                (modelMode === "manual" && !manualInventoryAvailable)
              }
              ref={createButtonRef}
              type="submit"
            >
              {createPending ? "Creating key..." : "Create Key"}
            </button>
          </div>
        </form>

        {createState.status === "created" &&
        createState.app &&
        createState.credential ? (
          <CreatedKeyDialog
            app={createState.app}
            credential={createState.credential}
            onClose={closeCreatedKey}
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
  const detailHeadingRef = useRef<HTMLHeadingElement>(null)
  const [showDisableConfirm, setShowDisableConfirm] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showPolicyEditor, setShowPolicyEditor] = useState(false)
  const [showRotateConfirm, setShowRotateConfirm] = useState(false)
  const [credentialToRevoke, setCredentialToRevoke] =
    useState<AdminConnectedAppCredentialMetadata | null>(null)
  const [checkResult, checkAction, checkPending] = useActionState(
    checkAdminConnectedAppConnectionAction,
    initialConnectedAppTestState,
  )
  const [rotateResult, rotateAction, rotatePending] = useActionState(
    rotateAdminConnectedAppCredentialsAction,
    initialConnectedAppCredentialState,
  )
  const [revokeResult, revokeAction, revokePending] = useActionState(
    revokeAdminConnectedAppCredentialAction,
    initialConnectedAppCredentialState,
  )
  const checkState = checkResult ?? interruptedConnectedAppTestState
  const rotateState = rotateResult ?? interruptedConnectedAppCredentialState
  const revokeState = revokeResult ?? interruptedConnectedAppCredentialState
  const [latestApp, setLatestApp] = useState(app)
  const [activeOperation, setActiveOperation] =
    useState<ApplicationMutationOperation | null>(null)
  const [rotationReveal, setRotationReveal] =
    useState<AdminConnectedAppCredential | null>(null)
  const operationLockRef = useRef<ApplicationMutationOperation | null>(null)
  const mutationPending =
    activeOperation !== null || checkPending || rotatePending || revokePending
  usePendingConsoleSessionRecovery(
    mutationPending,
    checkResult == null || rotateResult == null || revokeResult == null,
  )

  const beginMutation = useCallback(
    (
      event: FormEvent<HTMLFormElement>,
      operation: ApplicationMutationOperation,
    ) => {
      if (operationLockRef.current) {
        event.preventDefault()
        return false
      }
      operationLockRef.current = operation
      setActiveOperation(operation)
      return true
    },
    [],
  )
  const isMutationActive = useCallback(
    (operation: ApplicationMutationOperation) =>
      operationLockRef.current === operation,
    [],
  )
  const releaseMutation = useCallback(
    (operation: ApplicationMutationOperation) => {
      if (operationLockRef.current !== operation) {
        return false
      }
      operationLockRef.current = null
      setActiveOperation(null)
      return true
    },
    [],
  )
  const mutationLock: ApplicationMutationLock = {
    activeOperation,
    begin: beginMutation,
    isActive: isMutationActive,
    pending: mutationPending,
    release: releaseMutation,
  }

  useEffect(() => {
    setLatestApp(app)
  }, [app])
  useEffect(() => {
    detailHeadingRef.current?.focus()
  }, [])
  useEffect(() => {
    if (checkState.status === "idle" || !isMutationActive("inference-check")) {
      return
    }
    if (checkState.app) {
      setLatestApp(checkState.app)
    }
    releaseMutation("inference-check")
  }, [checkState, isMutationActive, releaseMutation])
  useEffect(() => {
    if (
      rotateState.status === "idle" ||
      !isMutationActive("inference-rotate")
    ) {
      return
    }
    if (rotateState.app) {
      setLatestApp(rotateState.app)
    }
    setShowRotateConfirm(false)
    setRotationReveal(rotateState.credential)
    releaseMutation("inference-rotate")
  }, [isMutationActive, releaseMutation, rotateState])
  useEffect(() => {
    if (
      revokeState.status === "idle" ||
      !isMutationActive("inference-revoke")
    ) {
      return
    }
    if (revokeState.app) {
      setLatestApp(revokeState.app)
    }
    setCredentialToRevoke(null)
    releaseMutation("inference-revoke")
  }, [isMutationActive, releaseMutation, revokeState])

  if (!app) {
    return (
      <div className="w-full min-h-screen min-h-dvh pb-16 pt-8 lg:pt-[73px]">
        <SubpageHeader title="Keys > Key settings" />
        <p className="mt-10 rounded-lg border border-[#353535] bg-[#232323] p-4 text-sm text-[#b2b2b2] lg:w-[640px]">
          This Key is not available.
        </p>
      </div>
    )
  }

  const currentApp = latestApp ?? app
  const isAdmin = accessRole === "admin"

  return (
    <div className="w-full min-h-screen min-h-dvh pb-16 pt-8 lg:pt-[73px]">
      <SubpageHeader title={`Keys > ${currentApp.name}`} />
      <div className="mt-10 flex w-full flex-col gap-3 lg:w-[640px]">
        <AppActionNotice appAction={appAction} />
        <section className="grid gap-3 rounded-lg border border-[#353535] bg-[#232323] p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2
                className="truncate text-lg font-semibold text-white"
                data-dialog-focus-fallback
                ref={detailHeadingRef}
                tabIndex={-1}
              >
                {currentApp.name}
              </h2>
              <p className="mt-1 text-sm text-[#b2b2b2]">
                {currentApp.description}
              </p>
              <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-[#8b8b8b]">
                Inference API
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
            label="Model access"
            value={
              currentApp.modelMode === "auto"
                ? "Auto (active approved inventory)"
                : currentApp.allowedModels.join(", ")
            }
          />
          <DetailRow
            label="Requests per second"
            value={formatNullableLimit(currentApp.rateLimitRps, " rps")}
          />
          <DetailRow
            label="Concurrent requests"
            value={formatNullableLimit(currentApp.maxConcurrentRequests, "")}
          />
          <DetailRow
            label="Context per request"
            value={formatNullableLimit(currentApp.maxContextBytes, " bytes")}
          />
          <DetailRow
            label="Token alert threshold"
            value={formatNullableLimit(
              currentApp.tokenAlertThreshold7d,
              " / 7 days",
            )}
          />
          <DetailRow
            label="Token alert status"
            value={tokenAlertStateLabel(
              currentApp.tokenAlertState,
              currentApp.tokenAlertThreshold7d,
            )}
          />
          <ApplicationCapacityPolicyCopy />
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
          {isAdmin ? (
            <div className="flex flex-wrap justify-end gap-2">
              <form
                action={checkAction}
                onSubmit={(event) => beginMutation(event, "inference-check")}
              >
                <input name="appId" type="hidden" value={currentApp.id} />
                <PendingSubmitButton
                  className={primaryButtonClass}
                  forcePending={
                    activeOperation === "inference-check" || checkPending
                  }
                  idleLabel="Check connection"
                  pendingLabel="Checking..."
                  unavailable={
                    mutationPending && activeOperation !== "inference-check"
                  }
                />
              </form>
              <button
                className={secondaryButtonClass}
                disabled={mutationPending}
                onClick={() => setShowRotateConfirm(true)}
                type="button"
              >
                Rotate Key credentials
              </button>
              <button
                className={secondaryButtonClass}
                disabled={mutationPending}
                onClick={() => setShowPolicyEditor((current) => !current)}
                type="button"
              >
                {showPolicyEditor ? "Close policy editor" : "Edit policy"}
              </button>
              {currentApp.status === "enabled" ? (
                <button
                  className={dangerButtonClass}
                  disabled={mutationPending}
                  onClick={() => setShowDisableConfirm(true)}
                  type="button"
                >
                  Disable Key
                </button>
              ) : (
                <form
                  action={enableAdminConnectedAppAction}
                  onSubmit={(event) =>
                    beginMutation(event, "application-enable")
                  }
                >
                  <input name="appId" type="hidden" value={currentApp.id} />
                  <input
                    name="returnTo"
                    type="hidden"
                    value={`/keys/apps/${currentApp.id}`}
                  />
                  <button
                    className={secondaryButtonClass}
                    disabled={mutationPending}
                    type="submit"
                  >
                    Re-enable Key
                  </button>
                </form>
              )}
              <button
                className={dangerButtonClass}
                disabled={mutationPending}
                onClick={() => setShowDeleteConfirm(true)}
                type="button"
              >
                Delete Key
              </button>
            </div>
          ) : (
            <p className="rounded-lg border border-[#353535] bg-[#181818] px-3 py-2 text-sm text-[#b2b2b2]">
              Operator access is read-only. An Administrator manages Key
              credentials and lifecycle actions.
            </p>
          )}
        </section>

        {isAdmin && showPolicyEditor ? (
          <ConnectedAppPolicyEditor
            app={currentApp}
            modelOptions={modelOptions}
            mutationLock={mutationLock}
          />
        ) : null}

        <CredentialMetadataList
          app={currentApp}
          canMutate={isAdmin}
          disabled={mutationPending}
          onRevoke={setCredentialToRevoke}
        />

        {rotationReveal ? (
          <ConnectedAppCredentialReveal
            credential={rotationReveal}
            key={rotationReveal.credentialId}
            title="Rotated credential"
          />
        ) : null}

        <FirecrawlAccessPanel
          accessRole={accessRole}
          app={currentApp}
          mutationLock={mutationLock}
          onAppChange={setLatestApp}
        />
      </div>

      {showRotateConfirm ? (
        <ConfirmationDialog
          description={rotationDescription(currentApp.authMethod)}
          dismissDisabled={mutationPending}
          onCancel={() => setShowRotateConfirm(false)}
          title="Rotate Key credential?"
        >
          <form
            action={rotateAction}
            onSubmit={(event) => {
              if (beginMutation(event, "inference-rotate")) {
                setRotationReveal(null)
              }
            }}
          >
            <input name="appId" type="hidden" value={currentApp.id} />
            <PendingSubmitButton
              className={primaryButtonClass}
              forcePending={
                activeOperation === "inference-rotate" || rotatePending
              }
              idleLabel="Rotate"
              pendingLabel="Rotating..."
              unavailable={
                mutationPending && activeOperation !== "inference-rotate"
              }
            />
          </form>
        </ConfirmationDialog>
      ) : null}

      {credentialToRevoke ? (
        <ConfirmationDialog
          description="This exact credential will stop working immediately. This action cannot be undone."
          dismissDisabled={mutationPending}
          onCancel={() => setCredentialToRevoke(null)}
          title="Revoke credential now?"
        >
          <form
            action={revokeAction}
            onSubmit={(event) => beginMutation(event, "inference-revoke")}
          >
            <input name="appId" type="hidden" value={currentApp.id} />
            <input
              name="credentialId"
              type="hidden"
              value={credentialToRevoke.id}
            />
            <PendingSubmitButton
              className={dangerButtonClass}
              forcePending={
                activeOperation === "inference-revoke" || revokePending
              }
              idleLabel="Revoke now"
              pendingLabel="Revoking..."
              unavailable={
                mutationPending && activeOperation !== "inference-revoke"
              }
            />
          </form>
        </ConfirmationDialog>
      ) : null}

      {showDisableConfirm ? (
        <ConfirmationDialog
          description="All Key credentials will stop reaching inference until an Admin re-enables this Key."
          dismissDisabled={mutationPending}
          onCancel={() => setShowDisableConfirm(false)}
          title="Disable this Key?"
        >
          <form
            action={disableAdminConnectedAppAction}
            onSubmit={(event) => beginMutation(event, "application-disable")}
          >
            <input name="appId" type="hidden" value={currentApp.id} />
            <input
              name="returnTo"
              type="hidden"
              value={`/keys/apps/${currentApp.id}`}
            />
            <PendingSubmitButton
              className={dangerButtonClass}
              forcePending={activeOperation === "application-disable"}
              idleLabel="Disable"
              pendingLabel="Disabling..."
              unavailable={
                mutationPending && activeOperation !== "application-disable"
              }
            />
          </form>
        </ConfirmationDialog>
      ) : null}

      {isAdmin && showDeleteConfirm ? (
        <ConfirmationDialog
          description="Soft deletion revokes every credential immediately. The Key identifier and audit linkage remain retained."
          dismissDisabled={mutationPending}
          onCancel={() => setShowDeleteConfirm(false)}
          title="Delete this Key?"
        >
          <form
            action={softDeleteAdminConnectedAppAction}
            onSubmit={(event) => beginMutation(event, "application-delete")}
          >
            <input name="appId" type="hidden" value={currentApp.id} />
            <input
              name="returnTo"
              type="hidden"
              value={`/keys/apps/${currentApp.id}`}
            />
            <ApplicationTextField
              label="Type DELETE KEY to confirm"
              name="confirmation"
              placeholder="DELETE KEY"
              required
            />
            <PendingSubmitButton
              className={cn(dangerButtonClass, "mt-3")}
              forcePending={activeOperation === "application-delete"}
              idleLabel="Delete Key"
              pendingLabel="Deleting..."
              unavailable={
                mutationPending && activeOperation !== "application-delete"
              }
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
  mutationLock,
}: {
  app: AdminConnectedApp
  modelOptions: AdminInferenceModel[]
  mutationLock: ApplicationMutationLock
}) {
  const [modelMode, setModelMode] = useState<"auto" | "manual">(app.modelMode)
  return (
    <form
      action={updateAdminConnectedAppPolicyAction}
      className="grid gap-3 rounded-lg border border-[#353535] bg-[#232323] p-4"
      onSubmit={(event) => mutationLock.begin(event, "application-policy")}
    >
      <div>
        <h2 className="text-lg font-semibold text-white">Key policy</h2>
        <p className="mt-1 text-sm text-[#b2b2b2]">
          Admin-only configuration. Authentication remains fixed as{" "}
          {authMethodLabel(app.authMethod)}.
        </p>
      </div>
      <input name="appId" type="hidden" value={app.id} />
      <input name="modelMode" type="hidden" value={modelMode} />
      <input name="returnTo" type="hidden" value={`/keys/apps/${app.id}`} />
      <ApplicationTextField
        defaultValue={app.name}
        label="Key name"
        name="name"
        placeholder="Production integration"
        required
      />
      <ApplicationTextField
        defaultValue={app.description}
        label="Description (optional)"
        name="description"
        placeholder="What will use this Key"
      />
      <SegmentedControl
        label="Model access"
        options={[
          {
            active: modelMode === "auto",
            label: "Auto",
            onSelect: () => setModelMode("auto"),
          },
          {
            active: modelMode === "manual",
            label: "Manual",
            onSelect: () => setModelMode("manual"),
          },
        ]}
      />
      {modelMode === "manual" ? (
        <ModelAliasFields
          modelOptions={modelOptions}
          selectedAliases={app.allowedModels}
        />
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <OptionalLimitField
          checkboxName="rateLimitRpsEnabled"
          initialValue={app.rateLimitRps}
          inputName="rateLimitRps"
          label="Requests per second"
          max={10_000}
        />
        <OptionalLimitField
          checkboxName="maxConcurrentRequestsEnabled"
          initialValue={app.maxConcurrentRequests}
          inputName="maxConcurrentRequests"
          label="Concurrent requests"
          max={10_000}
        />
        <OptionalLimitField
          checkboxName="maxContextBytesEnabled"
          initialValue={app.maxContextBytes}
          inputName="maxContextBytes"
          label="Context bytes per request"
          max={Number.MAX_SAFE_INTEGER}
        />
        <OptionalLimitField
          checkboxName="tokenAlertThreshold7dEnabled"
          enabledLabel="Visibility threshold enabled"
          initialValue={app.tokenAlertThreshold7d}
          inputName="tokenAlertThreshold7d"
          label="Seven-day token alert threshold"
          max={100_000_000}
        />
      </div>
      <ApplicationCapacityPolicyCopy />
      <div className="flex justify-end">
        <button
          className={primaryButtonClass}
          disabled={mutationLock.pending}
          type="submit"
        >
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
        <h2 className="text-lg font-semibold text-white">Inference Keys</h2>
        {accessRole === "admin" ? (
          <Link
            className="flex items-center gap-1 text-sm font-medium text-white"
            href="/applications/apps/new"
          >
            <Plus aria-hidden className="size-5" />
            Create Key
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
                <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
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
                    label="Inference"
                    value={app.status === "enabled" ? "Enabled" : "Disabled"}
                  />
                  <Metric
                    label="Firecrawl"
                    value={
                      app.firecrawl.status === "enabled"
                        ? "Enabled"
                        : "Disabled"
                    }
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
            Create the first Key to issue a dedicated inference credential.
          </p>
        )}
      </div>
    </section>
  )
}

function CreatedKeyDialog({
  app,
  credential,
  onClose,
}: {
  app: AdminConnectedApp
  credential: AdminConnectedAppCredential
  onClose: () => void
}) {
  const descriptionId = useId()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const titleId = useId()

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (typeof dialog.showModal === "function") {
      dialog.showModal()
    } else {
      dialog.setAttribute("open", "")
    }
    headingRef.current?.focus()
    return () => {
      if (dialog.open && typeof dialog.close === "function") dialog.close()
    }
  }, [])

  return (
    <dialog
      aria-describedby={descriptionId}
      aria-labelledby={titleId}
      className="m-auto max-h-[calc(100dvh_-_2rem)] w-[calc(100%_-_2rem)] max-w-[640px] overflow-y-auto rounded-lg border border-[#7b5d1a] bg-[#232323] p-5 text-white backdrop:bg-black/70"
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onKeyDown={trapDialogFocus}
      ref={dialogRef}
    >
      <h2
        className="text-xl font-semibold"
        id={titleId}
        ref={headingRef}
        tabIndex={-1}
      >
        Key created
      </h2>
      <p className="mt-2 text-sm font-medium text-[#ffdb8a]" id={descriptionId}>
        Secret material is displayed only once. Copy it before closing.
      </p>
      <dl className="mt-4 grid gap-2 rounded-lg border border-[#353535] bg-[#181818] p-3">
        <DetailRow label="Key name" value={app.name} />
        {app.description ? (
          <DetailRow label="Description" value={app.description} />
        ) : null}
        <DetailRow
          label="Authentication"
          value={authMethodLabel(app.authMethod)}
        />
        <DetailRow
          label="Model mode"
          value={app.modelMode === "auto" ? "Auto" : "Manual"}
        />
        {app.modelMode === "manual" ? (
          <DetailRow
            label="Selected models"
            value={app.allowedModels.join(", ")}
          />
        ) : null}
        {app.rateLimitRps ? (
          <DetailRow
            label="Requests per second"
            value={String(app.rateLimitRps)}
          />
        ) : null}
        {app.maxConcurrentRequests ? (
          <DetailRow
            label="Concurrent requests"
            value={String(app.maxConcurrentRequests)}
          />
        ) : null}
        {app.maxContextBytes ? (
          <DetailRow
            label="Maximum context size"
            value={String(app.maxContextBytes)}
          />
        ) : null}
        {app.tokenAlertThreshold7d ? (
          <DetailRow
            label="Seven-day usage alert"
            value={String(app.tokenAlertThreshold7d)}
          />
        ) : null}
      </dl>
      <div className="mt-4 grid gap-3">
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
          label="API base URL"
          value={credential.openAiBaseUrl}
        />
        <CopyableCredentialRow
          label="Example request"
          multiline
          value={credential.exampleCurl}
        />
        <div className="flex justify-end gap-2">
          <Link
            className={secondaryButtonClass}
            href={`/applications/apps/${encodeURIComponent(app.id)}`}
            onClick={(event) => {
              event.preventDefault()
              onClose()
            }}
          >
            View Key
          </Link>
          <button
            className={primaryButtonClass}
            onClick={onClose}
            type="button"
          >
            Done
          </button>
        </div>
      </div>
    </dialog>
  )
}

function trapDialogFocus(event: ReactKeyboardEvent<HTMLDialogElement>) {
  if (event.key !== "Tab") return
  const focusable = [
    ...event.currentTarget.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ].filter(
    (element) =>
      element.getAttribute("aria-hidden") !== "true" &&
      !element.hasAttribute("hidden"),
  )
  if (focusable.length === 0) {
    event.preventDefault()
    return
  }
  const activeIndex = focusable.indexOf(document.activeElement as HTMLElement)
  if (event.shiftKey && activeIndex <= 0) {
    event.preventDefault()
    focusable.at(-1)?.focus()
  } else if (!event.shiftKey && activeIndex === focusable.length - 1) {
    event.preventDefault()
    focusable[0]?.focus()
  } else if (!event.shiftKey && activeIndex < 0) {
    event.preventDefault()
    focusable[0]?.focus()
  }
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
  const visible = useOneTimeRevealVisibility()

  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  if (!visible) {
    return <ExpiredCredentialRevealNotice title={title} />
  }

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
            ? "During rotation, the previous static key remains valid for an exact 24-hour overlap unless it is revoked immediately."
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
  canMutate,
  disabled,
  onRevoke,
}: {
  app: AdminConnectedApp
  canMutate: boolean
  disabled: boolean
  onRevoke: (credential: AdminConnectedAppCredentialMetadata) => void
}) {
  return (
    <section className="grid gap-3 rounded-lg border border-[#353535] bg-[#232323] p-4">
      <div>
        <h2 className="text-lg font-semibold text-white">
          Inference credentials
        </h2>
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
          {canMutate && credential.status !== "revoked" ? (
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

function FirecrawlAccessPanel({
  accessRole,
  app,
  mutationLock,
  onAppChange,
}: {
  accessRole: RetainedConsoleRole
  app: AdminConnectedApp
  mutationLock: ApplicationMutationLock
  onAppChange: (app: AdminConnectedApp) => void
}) {
  const [showDisableConfirm, setShowDisableConfirm] = useState(false)
  const [showPolicyEditor, setShowPolicyEditor] = useState(false)
  const [showRotateConfirm, setShowRotateConfirm] = useState(false)
  const [credentialToRevoke, setCredentialToRevoke] =
    useState<AdminConnectedAppFirecrawlCredentialMetadata | null>(null)
  const [enableResult, enableAction, enablePending] = useActionState(
    enableAdminConnectedAppFirecrawlAction,
    initialFirecrawlCredentialState,
  )
  const [checkResult, checkAction, checkPending] = useActionState(
    checkAdminConnectedAppFirecrawlConnectionAction,
    initialFirecrawlTestState,
  )
  const [rotateResult, rotateAction, rotatePending] = useActionState(
    rotateAdminConnectedAppFirecrawlCredentialAction,
    initialFirecrawlCredentialState,
  )
  const [revokeResult, revokeAction, revokePending] = useActionState(
    revokeAdminConnectedAppFirecrawlCredentialAction,
    initialFirecrawlLifecycleState,
  )
  const [disableResult, disableAction, disablePending] = useActionState(
    disableAdminConnectedAppFirecrawlAction,
    initialFirecrawlLifecycleState,
  )
  const enableState = enableResult ?? interruptedFirecrawlCredentialState
  const checkState = checkResult ?? interruptedFirecrawlTestState
  const rotateState = rotateResult ?? interruptedFirecrawlCredentialState
  const revokeState = revokeResult ?? interruptedFirecrawlLifecycleState
  const disableState = disableResult ?? interruptedFirecrawlLifecycleState
  const [credentialReveal, setCredentialReveal] =
    useState<AdminConnectedAppFirecrawlCredential | null>(null)
  const {
    activeOperation,
    begin: beginMutation,
    isActive: isMutationActive,
    pending: pageMutationPending,
    release: releaseMutation,
  } = mutationLock
  const operationPending =
    pageMutationPending ||
    enablePending ||
    checkPending ||
    rotatePending ||
    revokePending ||
    disablePending
  usePendingConsoleSessionRecovery(
    operationPending,
    enableResult == null ||
      checkResult == null ||
      rotateResult == null ||
      revokeResult == null ||
      disableResult == null,
  )
  const isAdmin = accessRole === "admin"
  const firecrawl = app.firecrawl

  useEffect(() => {
    if (
      enableState.status === "idle" ||
      !isMutationActive("firecrawl-enable")
    ) {
      return
    }
    if (enableState.app) {
      onAppChange(enableState.app)
    }
    if (enableState.credential) {
      setCredentialReveal(enableState.credential)
    }
    releaseMutation("firecrawl-enable")
  }, [enableState, isMutationActive, onAppChange, releaseMutation])
  useEffect(() => {
    if (checkState.status === "idle" || !isMutationActive("firecrawl-check")) {
      return
    }
    if (checkState.app) {
      onAppChange(checkState.app)
    }
    releaseMutation("firecrawl-check")
  }, [checkState, isMutationActive, onAppChange, releaseMutation])
  useEffect(() => {
    if (
      rotateState.status === "idle" ||
      !isMutationActive("firecrawl-rotate")
    ) {
      return
    }
    if (rotateState.app) {
      onAppChange(rotateState.app)
    }
    if (rotateState.credential) {
      setCredentialReveal(rotateState.credential)
    }
    setShowRotateConfirm(false)
    releaseMutation("firecrawl-rotate")
  }, [isMutationActive, onAppChange, releaseMutation, rotateState])
  useEffect(() => {
    if (
      revokeState.status === "idle" ||
      !isMutationActive("firecrawl-revoke")
    ) {
      return
    }
    if (revokeState.app) {
      onAppChange(revokeState.app)
    }
    setCredentialToRevoke(null)
    releaseMutation("firecrawl-revoke")
  }, [isMutationActive, onAppChange, releaseMutation, revokeState])
  useEffect(() => {
    if (
      disableState.status === "idle" ||
      !isMutationActive("firecrawl-disable")
    ) {
      return
    }
    if (disableState.app) {
      onAppChange(disableState.app)
    }
    setShowDisableConfirm(false)
    releaseMutation("firecrawl-disable")
  }, [disableState, isMutationActive, onAppChange, releaseMutation])

  return (
    <>
      <section className="grid gap-3 rounded-lg border border-[#353535] bg-[#232323] p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-white">
              Firecrawl web access
            </h2>
            <p className="mt-1 text-sm leading-5 text-[#b2b2b2]">
              Installed on the appliance and disabled for this Key by default.
              Firecrawl uses its own API key namespace, separate from inference
              credentials.
            </p>
          </div>
          <StatusPill status={firecrawl.status} />
        </div>

        <div className="grid gap-2 rounded-lg border border-[#353535] bg-[#181818] p-3 text-sm">
          <p className="font-medium text-white">Available capabilities</p>
          <p className="text-[#b2b2b2]">
            Web search and static single-page scrape only.
          </p>
          <p className="font-medium text-white">Unavailable capabilities</p>
          <p className="text-[#b2b2b2]">
            Crawl, map, batch scrape, structured extract, agent, and browser
            session APIs are not exposed.
          </p>
        </div>

        <DetailRow
          label="Search protection"
          value={formatNullableLimit(firecrawl.searchRateLimitRps, " rps")}
        />
        <DetailRow
          label="Static scrape protection"
          value={formatNullableLimit(firecrawl.scrapeRateLimitRps, " rps")}
        />
        <DetailRow
          label="Concurrent static scrapes"
          value={formatNullableLimit(firecrawl.maxConcurrentScrapes, "")}
        />
        <DetailRow
          label="T2 client connection"
          value={connectionStatusLabel(firecrawl.connectionStatus)}
        />
        <DetailRow
          label="Last T2 client use"
          value={dateTimeLabel(firecrawl.lastConnectedAt)}
        />
        <p className="rounded-lg border border-[#353535] bg-[#181818] px-3 py-2 text-xs leading-5 text-[#b2b2b2]">
          Connected means a third-party client authenticated with this
          Key&apos;s Firecrawl credential and called /v2/search or /v2/scrape.
          It is passive T2 connection evidence, not proof that the appliance or
          Firecrawl service is ready. Console never probes with the credential.
        </p>

        <ConnectedAppTestStatus state={checkState} />
        <FirecrawlActionStatus state={enableState} />
        <FirecrawlActionStatus state={rotateState} />
        <FirecrawlActionStatus state={revokeState} />
        <FirecrawlActionStatus state={disableState} />

        {firecrawl.status === "disabled" ? (
          isAdmin ? (
            <form
              action={enableAction}
              className="grid gap-3 rounded-lg border border-[#51431c] bg-[#2b2414] p-3"
              onSubmit={(event) => {
                if (beginMutation(event, "firecrawl-enable")) {
                  setCredentialReveal(null)
                }
              }}
            >
              <input name="appId" type="hidden" value={app.id} />
              <p className="text-sm font-medium text-white">
                {firecrawl.disclaimerAcceptedAt
                  ? "Re-enable Firecrawl"
                  : "Enable Firecrawl"}
              </p>
              <label className="flex items-start gap-3 text-sm leading-5 text-[#ffdb8a]">
                <input
                  className="mt-1"
                  name="disclaimerAccepted"
                  required
                  type="checkbox"
                />
                <span>
                  I understand that enabling Firecrawl permits outbound web
                  requests. Remote websites may log those requests. Retrieved
                  content is processed transiently with zero content retention
                  in LLM Machines-managed components.
                </span>
              </label>
              <FirecrawlProtectionFields firecrawl={firecrawl} />
              <div className="flex justify-end">
                <PendingSubmitButton
                  className={primaryButtonClass}
                  forcePending={
                    activeOperation === "firecrawl-enable" || enablePending
                  }
                  idleLabel={
                    firecrawl.disclaimerAcceptedAt
                      ? "Re-enable Firecrawl"
                      : "Enable Firecrawl"
                  }
                  pendingLabel="Enabling..."
                  unavailable={
                    operationPending && activeOperation !== "firecrawl-enable"
                  }
                />
              </div>
            </form>
          ) : (
            <p className="rounded-lg border border-[#353535] bg-[#181818] px-3 py-2 text-sm text-[#b2b2b2]">
              Only an Admin can enable or re-enable outbound Firecrawl access.
            </p>
          )
        ) : isAdmin ? (
          <div className="flex flex-wrap justify-end gap-2">
            <form
              action={checkAction}
              onSubmit={(event) => beginMutation(event, "firecrawl-check")}
            >
              <input name="appId" type="hidden" value={app.id} />
              <PendingSubmitButton
                className={primaryButtonClass}
                forcePending={
                  activeOperation === "firecrawl-check" || checkPending
                }
                idleLabel="Check Firecrawl connection"
                pendingLabel="Checking..."
                unavailable={
                  operationPending && activeOperation !== "firecrawl-check"
                }
              />
            </form>
            <button
              className={secondaryButtonClass}
              disabled={operationPending}
              onClick={() => setShowRotateConfirm(true)}
              type="button"
            >
              Rotate Firecrawl credential
            </button>
            <button
              className={secondaryButtonClass}
              disabled={operationPending}
              onClick={() => setShowPolicyEditor((current) => !current)}
              type="button"
            >
              {showPolicyEditor
                ? "Close Firecrawl policy"
                : "Edit Firecrawl policy"}
            </button>
            <button
              className={dangerButtonClass}
              disabled={operationPending}
              onClick={() => setShowDisableConfirm(true)}
              type="button"
            >
              Disable Firecrawl
            </button>
          </div>
        ) : (
          <p className="rounded-lg border border-[#353535] bg-[#181818] px-3 py-2 text-sm text-[#b2b2b2]">
            Operator access is read-only. An Administrator manages Firecrawl
            credentials and lifecycle actions.
          </p>
        )}
      </section>

      {isAdmin && showPolicyEditor && firecrawl.status === "enabled" ? (
        <form
          action={updateAdminConnectedAppFirecrawlPolicyAction}
          className="grid gap-3 rounded-lg border border-[#353535] bg-[#232323] p-4"
          onSubmit={(event) => beginMutation(event, "firecrawl-policy")}
        >
          <div>
            <h2 className="text-lg font-semibold text-white">
              Firecrawl protections
            </h2>
            <p className="mt-1 text-sm text-[#b2b2b2]">
              Optional appliance-protection limits. Disabled values do not cap
              legitimate customer use.
            </p>
          </div>
          <input name="appId" type="hidden" value={app.id} />
          <input name="returnTo" type="hidden" value={`/keys/apps/${app.id}`} />
          <FirecrawlProtectionFields firecrawl={firecrawl} />
          <div className="flex justify-end">
            <button
              className={primaryButtonClass}
              disabled={operationPending}
              type="submit"
            >
              Save Firecrawl policy
            </button>
          </div>
        </form>
      ) : null}

      <FirecrawlCredentialMetadataList
        canMutate={isAdmin}
        credentials={firecrawl.credentials}
        disabled={operationPending}
        onRevoke={setCredentialToRevoke}
      />

      {credentialReveal ? (
        <ConnectedAppFirecrawlCredentialReveal
          credential={credentialReveal}
          key={credentialReveal.credentialId}
          title={
            rotateState.status === "rotated"
              ? "Rotated Firecrawl credential"
              : "Firecrawl credential"
          }
        />
      ) : null}

      {showRotateConfirm ? (
        <ConfirmationDialog
          description="A new Firecrawl key will be shown once. The current key enters an exact 24-hour overlap and can be revoked sooner. Inference credentials are unchanged."
          dismissDisabled={operationPending}
          onCancel={() => setShowRotateConfirm(false)}
          title="Rotate Firecrawl credential?"
        >
          <form
            action={rotateAction}
            onSubmit={(event) => {
              if (beginMutation(event, "firecrawl-rotate")) {
                setCredentialReveal(null)
              }
            }}
          >
            <input name="appId" type="hidden" value={app.id} />
            <PendingSubmitButton
              className={primaryButtonClass}
              forcePending={
                activeOperation === "firecrawl-rotate" || rotatePending
              }
              idleLabel="Rotate Firecrawl key"
              pendingLabel="Rotating..."
              unavailable={
                operationPending && activeOperation !== "firecrawl-rotate"
              }
            />
          </form>
        </ConfirmationDialog>
      ) : null}

      {credentialToRevoke ? (
        <ConfirmationDialog
          description="This exact Firecrawl key stops working immediately. Inference credentials are unchanged."
          dismissDisabled={operationPending}
          onCancel={() => setCredentialToRevoke(null)}
          title="Revoke Firecrawl credential?"
        >
          <form
            action={revokeAction}
            onSubmit={(event) => beginMutation(event, "firecrawl-revoke")}
          >
            <input name="appId" type="hidden" value={app.id} />
            <input
              name="credentialId"
              type="hidden"
              value={credentialToRevoke.id}
            />
            <PendingSubmitButton
              className={dangerButtonClass}
              forcePending={
                activeOperation === "firecrawl-revoke" || revokePending
              }
              idleLabel="Revoke Firecrawl key"
              pendingLabel="Revoking..."
              unavailable={
                operationPending && activeOperation !== "firecrawl-revoke"
              }
            />
          </form>
        </ConfirmationDialog>
      ) : null}

      {showDisableConfirm ? (
        <ConfirmationDialog
          description="Firecrawl keys stop reaching web search and static scrape until an Admin re-enables access. Inference access remains unchanged."
          dismissDisabled={operationPending}
          onCancel={() => setShowDisableConfirm(false)}
          title="Disable Firecrawl?"
        >
          <form
            action={disableAction}
            onSubmit={(event) => beginMutation(event, "firecrawl-disable")}
          >
            <input name="appId" type="hidden" value={app.id} />
            <PendingSubmitButton
              className={dangerButtonClass}
              forcePending={
                activeOperation === "firecrawl-disable" || disablePending
              }
              idleLabel="Disable Firecrawl"
              pendingLabel="Disabling..."
              unavailable={
                operationPending && activeOperation !== "firecrawl-disable"
              }
            />
          </form>
        </ConfirmationDialog>
      ) : null}
    </>
  )
}

function FirecrawlProtectionFields({
  firecrawl,
}: {
  firecrawl: AdminConnectedApp["firecrawl"]
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <OptionalLimitField
        checkboxName="firecrawlSearchRateLimitRpsEnabled"
        initialValue={firecrawl.searchRateLimitRps}
        inputName="firecrawlSearchRateLimitRps"
        label="Search requests per second"
        max={1000}
      />
      <OptionalLimitField
        checkboxName="firecrawlScrapeRateLimitRpsEnabled"
        initialValue={firecrawl.scrapeRateLimitRps}
        inputName="firecrawlScrapeRateLimitRps"
        label="Static scrape requests per second"
        max={1000}
      />
      <OptionalLimitField
        checkboxName="firecrawlMaxConcurrentScrapesEnabled"
        initialValue={firecrawl.maxConcurrentScrapes}
        inputName="firecrawlMaxConcurrentScrapes"
        label="Concurrent static scrapes"
        max={100}
      />
    </div>
  )
}

function FirecrawlCredentialMetadataList({
  canMutate,
  credentials,
  disabled,
  onRevoke,
}: {
  canMutate: boolean
  credentials: AdminConnectedAppFirecrawlCredentialMetadata[]
  disabled: boolean
  onRevoke: (credential: AdminConnectedAppFirecrawlCredentialMetadata) => void
}) {
  return (
    <section className="grid gap-3 rounded-lg border border-[#353535] bg-[#232323] p-4">
      <div>
        <h2 className="text-lg font-semibold text-white">
          Firecrawl credentials
        </h2>
        <p className="mt-1 text-sm text-[#b2b2b2]">
          Separate secret-free metadata for the Firecrawl key namespace. Raw
          keys are never available again after issuance.
        </p>
      </div>
      {credentials.length === 0 ? (
        <p className="text-sm text-[#b2b2b2]">
          No Firecrawl credential has been issued for this Key.
        </p>
      ) : (
        credentials.map((credential) => (
          <article
            className="grid gap-2 rounded-lg border border-[#353535] bg-[#181818] p-3"
            key={credential.id}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-white">
                  {credential.keyPrefix}
                </p>
                <p className="mt-1 break-all font-mono text-xs text-[#8b8b8b]">
                  {credential.id}
                </p>
              </div>
              <CredentialStatusPill status={credential.status} />
            </div>
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
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
            {canMutate && credential.status !== "revoked" ? (
              <div className="flex justify-end">
                <button
                  className={dangerButtonClass}
                  disabled={disabled}
                  onClick={() => onRevoke(credential)}
                  type="button"
                >
                  Revoke Firecrawl key
                </button>
              </div>
            ) : null}
          </article>
        ))
      )}
    </section>
  )
}

export function ConnectedAppFirecrawlCredentialReveal({
  credential,
  title,
}: {
  credential: AdminConnectedAppFirecrawlCredential
  title: string
}) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  const visible = useOneTimeRevealVisibility()

  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  if (!visible) {
    return <ExpiredCredentialRevealNotice title={title} />
  }

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
          This Firecrawl key is shown once. Store it before leaving this page.
        </p>
        <p className="mt-1 text-xs leading-5 text-[#b2b2b2]">
          This key is separate from the inference credential and authorizes only
          web search and static scrape through the Firecrawl base URL.
        </p>
      </div>
      <CopyableCredentialRow
        label="Firecrawl credential ID"
        value={credential.credentialId}
      />
      <CopyableCredentialRow
        label="Firecrawl API key"
        secret
        value={credential.apiKey}
      />
      <CopyableCredentialRow
        label="Firecrawl base URL"
        value={credential.firecrawlBaseUrl}
      />
      <CopyableCredentialRow
        label="Example Firecrawl request"
        multiline
        value={credential.exampleCurl}
      />
    </section>
  )
}

function useOneTimeRevealVisibility(): boolean {
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const clearReveal = () => setVisible(false)
    const clearHiddenReveal = () => {
      if (document.visibilityState === "hidden") {
        clearReveal()
      }
    }
    window.addEventListener("pagehide", clearReveal)
    window.addEventListener("popstate", clearReveal)
    document.addEventListener("visibilitychange", clearHiddenReveal)
    return () => {
      window.removeEventListener("pagehide", clearReveal)
      window.removeEventListener("popstate", clearReveal)
      document.removeEventListener("visibilitychange", clearHiddenReveal)
    }
  }, [])

  return visible
}

function ExpiredCredentialRevealNotice({ title }: { title: string }) {
  return (
    <section className="grid gap-2 rounded-lg border border-[#353535] bg-[#232323] p-4">
      <h2 className="text-lg font-semibold text-white">{title}</h2>
      <p className="text-sm text-[#b2b2b2]">
        This one-time secret is no longer available. Rotate the credential if a
        replacement is required.
      </p>
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
  enabledLabel = "Protection enabled",
  initialValue = null,
  inputName,
  label,
  max,
}: {
  checkboxName: string
  enabledLabel?: string
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
        {enabled ? enabledLabel : "Disabled by default"}
      </p>
    </div>
  )
}

function ApplicationCapacityPolicyCopy() {
  return (
    <p className="text-xs leading-5 text-[#8b8b8b]">
      The customer owns the hardware and may use available compute. Optional
      request-rate and concurrency controls protect service health. Model access
      and context-size controls define each Key&apos;s permissions. The
      seven-day token threshold is visibility only and never blocks inference.
    </p>
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
        ? "Key created. Copy its credential now."
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

function FirecrawlActionStatus({
  state,
}: {
  state:
    | ConnectedAppFirecrawlCredentialActionState
    | ConnectedAppFirecrawlLifecycleActionState
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
        ? (state.error ?? state.detail ?? "Firecrawl action failed.")
        : (state.detail ?? "Firecrawl action completed.")}
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
    deleted: { description: "Key deleted.", tone: "warning" },
    disabled: { description: "Key disabled.", tone: "warning" },
    failed: { description: "Key action failed.", tone: "danger" },
    firecrawlFailed: {
      description: "Firecrawl policy update failed.",
      tone: "danger",
    },
    firecrawlInvalid: {
      description: "Firecrawl protections need valid values.",
      tone: "danger",
    },
    firecrawlUpdated: {
      description: "Firecrawl protections updated.",
      tone: "success",
    },
    invalid: {
      description: "Key action needs valid values and confirmation.",
      tone: "danger",
    },
    reenabled: { description: "Key re-enabled.", tone: "success" },
    updated: { description: "Key policy updated.", tone: "success" },
  }
  const message = messages[appAction] ?? messages.failed
  return (
    <ConsoleActionToasts
      notifications={[
        {
          description: message.description,
          id: `app-action-${appAction}`,
          title: "Keys",
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

function tokenAlertStateLabel(
  state: AdminConnectedApp["tokenAlertState"],
  threshold: number | null,
): string {
  if (threshold === null) {
    return "Disabled"
  }
  if (state === "reached") {
    return "Reached (non-blocking)"
  }
  if (state === "below") {
    return "Below threshold"
  }
  return "Awaiting usage data"
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
