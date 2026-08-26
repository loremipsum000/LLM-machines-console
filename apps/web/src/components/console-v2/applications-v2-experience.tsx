"use client"

import {
  type ConnectedAppCreateActionState,
  type ConnectedAppCredentialActionState,
  type ConnectedAppFirecrawlCredentialActionState,
  type ConnectedAppFirecrawlLifecycleActionState,
  createAdminConnectedAppAction,
  disableAdminConnectedAppAction,
  disableAdminConnectedAppFirecrawlAction,
  enableAdminConnectedAppAction,
  enableAdminConnectedAppFirecrawlAction,
  revokeAdminConnectedAppCredentialAction,
  revokeAdminConnectedAppFirecrawlCredentialAction,
  softDeleteAdminConnectedAppAction,
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
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Plus,
  RefreshCw,
  Settings,
  Trash2,
} from "lucide-react"
import { useRouter } from "next/navigation"
import {
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useActionState,
  useCallback,
  useEffect,
  useId,
  useMemo,
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

const interruptedActionError =
  "The action did not complete. Sign in again or retry."

const interruptedConnectedAppCreateState: ConnectedAppCreateActionState = {
  ...initialConnectedAppCreateState,
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

type ApplicationMutationOperation =
  | "application-delete"
  | "application-disable"
  | "application-enable"
  | "firecrawl-disable"
  | "firecrawl-enable"
  | "firecrawl-revoke"
  | "inference-revoke"

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
const applicationsDateFormatter = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
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
      />
    )
  }

  return (
    <div className="w-full min-h-screen min-h-dvh pb-16 pt-8 lg:pt-[73px]">
      <PageHeader title="Keys" />
      <AppActionNotice appAction={visibleAppAction} />
      <div className="mt-8 w-full max-w-5xl">
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
      <SubpageHeader title="Create Key" />
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
            <Link className={secondaryButtonClass} href="/keys">
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
}: {
  accessRole: RetainedConsoleRole
  app: AdminConnectedApp | null
  appAction?: string
}) {
  const detailHeadingRef = useRef<HTMLHeadingElement>(null)
  const [showDisableConfirm, setShowDisableConfirm] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [credentialToRevoke, setCredentialToRevoke] =
    useState<AdminConnectedAppCredentialMetadata | null>(null)
  const [revokeResult, revokeAction, revokePending] = useActionState(
    revokeAdminConnectedAppCredentialAction,
    initialConnectedAppCredentialState,
  )
  const revokeState = revokeResult ?? interruptedConnectedAppCredentialState
  const [latestApp, setLatestApp] = useState(app)
  const [activeOperation, setActiveOperation] =
    useState<ApplicationMutationOperation | null>(null)
  const router = useRouter()
  const [statusRefreshPending, startStatusRefresh] = useTransition()
  const operationLockRef = useRef<ApplicationMutationOperation | null>(null)
  const mutationPending = activeOperation !== null || revokePending
  usePendingConsoleSessionRecovery(mutationPending, revokeResult == null)

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
        <SubpageHeader title="Key settings" />
        <div className="mt-8 grid max-w-4xl gap-3 rounded-xl border border-[#353535] bg-[#232323] p-4 text-sm text-[#b2b2b2]">
          <p>This Key is unavailable or has been deleted.</p>
          <Link
            className="w-fit font-medium text-[#73cfff] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#009fff]"
            href="/keys"
          >
            Back to Keys
          </Link>
        </div>
      </div>
    )
  }

  const currentApp = latestApp ?? app
  const isAdmin = accessRole === "admin"
  const hasActiveInferenceCredential = currentApp.credentials.some(
    (credential) =>
      credential.status === "active" && credential.revokedAt === null,
  )

  return (
    <div className="w-full min-h-screen min-h-dvh pb-16 pt-8 lg:pt-[73px]">
      <SubpageHeader
        breadcrumbLabel={currentApp.name}
        description={currentApp.description || undefined}
        focusFallback
        headingRef={detailHeadingRef}
        title="Key settings"
      />
      <div className="mt-8 flex w-full max-w-4xl flex-col gap-4">
        <AppActionNotice appAction={appAction} />
        {!isAdmin ? (
          <p className="rounded-lg border border-[#353535] bg-[#232323] px-4 py-3 text-sm text-[#b2b2b2]">
            Operator access is read-only. Key lifecycle changes require an
            Administrator.
          </p>
        ) : null}

        <section
          aria-labelledby="key-status-heading"
          className="grid gap-4 rounded-xl border border-[#353535] bg-[#232323] p-4 sm:p-5"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2
                className="text-base font-semibold text-white"
                id="key-status-heading"
              >
                Inference access
              </h2>
              <p className="mt-1 text-sm text-[#b2b2b2]">
                Primary API access and recent inference usage.
              </p>
            </div>
            {isAdmin ? (
              <button
                aria-label="Refresh access status"
                className={quietActionClass}
                disabled={mutationPending || statusRefreshPending}
                onClick={() =>
                  startStatusRefresh(() => {
                    router.refresh()
                  })
                }
                type="button"
              >
                <RefreshCw
                  aria-hidden
                  className={cn(
                    "size-4 motion-reduce:animate-none",
                    statusRefreshPending && "animate-spin",
                  )}
                />
                {statusRefreshPending ? "Refreshing..." : "Refresh status"}
              </button>
            ) : null}
          </div>

          <div className="divide-y divide-[#353535] rounded-lg bg-[#1d1d1d] px-3">
            <AccessSummaryRow
              connectionStatus={currentApp.connectionStatus}
              lastConnectedAt={currentApp.lastConnectedAt}
              status={currentApp.status === "enabled" ? "Active" : "Disabled"}
              title="Inference API"
              tone={currentApp.status === "enabled" ? "positive" : "neutral"}
            />
            {currentApp.firecrawl.status === "enabled" ? (
              <AccessSummaryRow
                connectionStatus={currentApp.firecrawl.connectionStatus}
                lastConnectedAt={currentApp.firecrawl.lastConnectedAt}
                status={
                  currentApp.status === "enabled" ? "Enabled" : "Suspended"
                }
                title="Firecrawl"
                tone={currentApp.status === "enabled" ? "info" : "neutral"}
              />
            ) : null}
          </div>
          <CredentialActionStatus state={revokeState} />

          <dl
            aria-label="Inference usage, last 7 days"
            className="grid grid-cols-2 gap-4 border-t border-[#353535] pt-4 sm:grid-cols-3"
          >
            <Metric
              label="Last used"
              value={lastUsedLabel(currentApp.usage.lastUsedAt)}
            />
            <Metric
              label="Requests, 7 days"
              value={currentApp.usage.requests7d.toLocaleString()}
            />
            <Metric
              label="Tokens, 7 days"
              value={compactNumber(currentApp.usage.tokens7d)}
            />
          </dl>

          {isAdmin &&
          currentApp.status === "disabled" &&
          hasActiveInferenceCredential ? (
            <div className="flex justify-end">
              <form
                action={enableAdminConnectedAppAction}
                onSubmit={(event) => beginMutation(event, "application-enable")}
              >
                <input name="appId" type="hidden" value={currentApp.id} />
                <input
                  name="returnTo"
                  type="hidden"
                  value={`/keys/apps/${currentApp.id}`}
                />
                <button
                  className={quietActionClass}
                  disabled={mutationPending}
                  type="submit"
                >
                  Re-enable Key
                </button>
              </form>
            </div>
          ) : null}
        </section>

        <CredentialMetadataList
          app={currentApp}
          canMutate={isAdmin}
          disabled={mutationPending}
          onRevoke={setCredentialToRevoke}
        />

        <FirecrawlAccessPanel
          accessRole={accessRole}
          app={currentApp}
          mutationLock={mutationLock}
          onAppChange={setLatestApp}
        />

        {isAdmin ? (
          <section
            aria-labelledby="key-lifecycle-heading"
            className="rounded-xl border border-[#4a2426] bg-[#21191a] p-4 sm:p-5"
          >
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2
                  className="text-base font-semibold text-white"
                  id="key-lifecycle-heading"
                >
                  Key lifecycle
                </h2>
                <p className="mt-1 text-sm text-[#b2b2b2]">
                  Disable access temporarily or permanently delete this Key.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {currentApp.status === "enabled" ? (
                  <button
                    className={disableButtonClass}
                    disabled={mutationPending}
                    onClick={() => setShowDisableConfirm(true)}
                    type="button"
                  >
                    Disable Key
                  </button>
                ) : null}
                <button
                  className={deleteButtonClass}
                  disabled={mutationPending}
                  onClick={() => setShowDeleteConfirm(true)}
                  type="button"
                >
                  Delete Key
                </button>
              </div>
            </div>
          </section>
        ) : null}
      </div>

      {isAdmin && credentialToRevoke ? (
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

      {isAdmin && showDisableConfirm ? (
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

function ConnectedAppsPanel({
  accessRole,
  apps,
}: {
  accessRole: RetainedConsoleRole
  apps: AdminConnectedApp[]
}) {
  const [deleteTarget, setDeleteTarget] = useState<AdminConnectedApp | null>(
    null,
  )
  const [sort, setSort] = useState<KeySort>({
    direction: "desc",
    key: "created",
  })
  const sortedApps = useMemo(
    () => [...apps].sort((left, right) => compareKeys(left, right, sort)),
    [apps, sort],
  )

  const changeSort = (key: KeySortKey) => {
    setSort((current) => ({
      direction:
        current.key === key
          ? current.direction === "asc"
            ? "desc"
            : "asc"
          : key === "name"
            ? "asc"
            : "desc",
      key,
    }))
  }

  return (
    <section className="grid gap-4" aria-labelledby="keys-table-heading">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="sr-only" id="keys-table-heading">
            Key management
          </h2>
          <p className="text-sm text-[#b2b2b2]">
            Manage inference access and its separately enabled Firecrawl access.
          </p>
        </div>
        {accessRole === "admin" ? (
          <Link
            className={cn(primaryButtonClass, "h-10 px-4")}
            href="/keys/apps/new"
          >
            <Plus aria-hidden className="size-4" />
            Create Key
          </Link>
        ) : null}
      </div>
      {sortedApps.length > 0 ? (
        <>
          <div className="hidden overflow-visible rounded-xl border border-[#353535] bg-[#232323] md:block">
            <table className="w-full table-fixed border-collapse text-left text-sm">
              <thead className="border-b border-[#454545] text-xs font-semibold uppercase tracking-[0.08em] text-[#9b9b9b]">
                <tr>
                  <SortableKeyHeader
                    activeSort={sort}
                    className="w-[36%]"
                    label="Key Name"
                    onSort={changeSort}
                    sortKey="name"
                  />
                  <SortableKeyHeader
                    activeSort={sort}
                    className="w-[20%] whitespace-nowrap"
                    label="Date Created"
                    onSort={changeSort}
                    sortKey="created"
                  />
                  <SortableKeyHeader
                    activeSort={sort}
                    className="w-[14%]"
                    label="Status"
                    onSort={changeSort}
                    sortKey="status"
                  />
                  <th className="w-[14%] px-4 py-3" scope="col">
                    Firecrawl
                  </th>
                  <th className="w-[16%] px-4 py-3 text-right" scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#353535]">
                {sortedApps.map((app) => (
                  <tr
                    className="group h-16 transition-colors hover:bg-[#282828]"
                    key={app.id}
                  >
                    <td className="px-4 py-3 align-middle">
                      <Link
                        className="block w-fit max-w-full truncate font-semibold text-white transition-colors hover:text-[#73cfff] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#009fff]"
                        href={`/keys/apps/${encodeURIComponent(app.id)}`}
                      >
                        {app.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-[#d7d7d7]">
                      {dateOnlyLabel(app.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      <KeyLifecyclePill status={app.status} />
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-white">
                        {firecrawlStatusLabel(app.firecrawl.status)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <TooltipIconLink
                          href={`/keys/apps/${encodeURIComponent(app.id)}`}
                          label={`Settings for ${app.name}`}
                        >
                          <Settings aria-hidden className="size-[18px]" />
                        </TooltipIconLink>
                        {accessRole === "admin" ? (
                          <TooltipIconButton
                            destructive
                            label={`Delete ${app.name}`}
                            onClick={() => setDeleteTarget(app)}
                          >
                            <Trash2 aria-hidden className="size-[18px]" />
                          </TooltipIconButton>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="grid gap-2 md:hidden">
            {sortedApps.map((app) => (
              <li
                className="rounded-xl border border-[#353535] bg-[#232323] p-4"
                key={app.id}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      className="block truncate font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#009fff]"
                      href={`/keys/apps/${encodeURIComponent(app.id)}`}
                    >
                      {app.name}
                    </Link>
                  </div>
                  <KeyLifecyclePill status={app.status} />
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <Metric
                    label="Date created"
                    value={dateOnlyLabel(app.createdAt)}
                  />
                  <Metric
                    label="Firecrawl"
                    value={firecrawlStatusLabel(app.firecrawl.status)}
                  />
                </dl>
                <div className="mt-4 flex justify-end gap-2 border-t border-[#353535] pt-3">
                  <Link
                    aria-label={`Settings for ${app.name}`}
                    className={quietActionClass}
                    href={`/keys/apps/${encodeURIComponent(app.id)}`}
                  >
                    <Settings aria-hidden className="size-4" />
                    Settings
                  </Link>
                  {accessRole === "admin" ? (
                    <button
                      aria-label={`Delete ${app.name}`}
                      className={cn(quietActionClass, "text-[#ff7377]")}
                      onClick={() => setDeleteTarget(app)}
                      type="button"
                    >
                      Delete
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <div className="rounded-xl border border-dashed border-[#454545] bg-[#232323] px-5 py-10 text-center">
          <p className="font-semibold text-white">No Keys yet</p>
          <p className="mt-1 text-sm text-[#b2b2b2]">
            {accessRole === "admin"
              ? "Create a Key to issue dedicated inference access."
              : "An Administrator has not created any Keys yet."}
          </p>
        </div>
      )}

      {accessRole === "admin" && deleteTarget ? (
        <ConfirmationDialog
          description={`Soft deletion revokes every credential for ${deleteTarget.name} immediately. The Key identifier and audit linkage remain retained.`}
          onCancel={() => setDeleteTarget(null)}
          title={`Delete ${deleteTarget.name}?`}
        >
          <form action={softDeleteAdminConnectedAppAction}>
            <input name="appId" type="hidden" value={deleteTarget.id} />
            <input name="returnTo" type="hidden" value="/keys" />
            <ApplicationTextField
              label="Type DELETE KEY to confirm"
              name="confirmation"
              placeholder="DELETE KEY"
              required
            />
            <PendingSubmitButton
              className={cn(deleteButtonClass, "mt-3 w-full")}
              idleLabel="Delete Key"
              pendingLabel="Deleting..."
            />
          </form>
        </ConfirmationDialog>
      ) : null}
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
            href={`/keys/apps/${encodeURIComponent(app.id)}`}
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
  const currentCredentials = app.credentials.filter(
    (credential) => credential.status !== "revoked",
  )
  const revokedCredentials = app.credentials.filter(
    (credential) => credential.status === "revoked",
  )

  return (
    <section
      aria-labelledby="inference-credentials-heading"
      className="grid gap-4 rounded-xl border border-[#353535] bg-[#232323] p-4 sm:p-5"
    >
      <div>
        <h2
          className="text-base font-semibold text-white"
          id="inference-credentials-heading"
        >
          Inference credential
        </h2>
        <p className="mt-1 text-sm text-[#b2b2b2]">
          Primary credential for inference API access. Secret values are
          available only when issued.
        </p>
      </div>

      <div className="divide-y divide-[#353535] rounded-lg bg-[#1d1d1d] px-3">
        {currentCredentials.length > 0 ? (
          currentCredentials.map((credential) => (
            <CredentialMetadataRow
              canMutate={canMutate}
              credential={credential}
              disabled={disabled}
              key={credential.id}
              onRevoke={onRevoke}
            />
          ))
        ) : (
          <div className="grid gap-2 py-4 text-sm text-[#b2b2b2]">
            <p>No active inference credential remains for this Key.</p>
            {canMutate ? (
              <Link
                className="w-fit font-medium text-[#73cfff] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#009fff]"
                href="/keys/apps/new"
              >
                Create a new Key
              </Link>
            ) : null}
          </div>
        )}
      </div>

      {revokedCredentials.length > 0 ? (
        <details className="group rounded-lg border border-[#353535]">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 text-sm font-medium text-[#d7d7d7] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#009fff]">
            Credential history ({revokedCredentials.length})
            <ChevronDown
              aria-hidden
              className="size-4 transition-transform group-open:rotate-180 motion-reduce:transition-none"
            />
          </summary>
          <div className="divide-y divide-[#353535] border-t border-[#353535] px-3">
            {revokedCredentials.map((credential) => (
              <CredentialMetadataRow
                canMutate={false}
                credential={credential}
                disabled
                key={credential.id}
                onRevoke={onRevoke}
              />
            ))}
          </div>
        </details>
      ) : null}

      <dl className="grid gap-0">
        <ConfigurationRow
          label="Authentication"
          value={authMethodLabel(app.authMethod)}
        />
        <ConfigurationRow label="Model access" value={modelAccessLabel(app)} />
        {app.rateLimitRps !== null ? (
          <ConfigurationRow
            label="Requests per second"
            value={`${compactNumber(app.rateLimitRps)} rps`}
          />
        ) : null}
        {app.maxConcurrentRequests !== null ? (
          <ConfigurationRow
            label="Concurrent requests"
            value={compactNumber(app.maxConcurrentRequests)}
          />
        ) : null}
        {app.maxContextBytes !== null ? (
          <ConfigurationRow
            label="Maximum context"
            value={formatBytes(app.maxContextBytes)}
          />
        ) : null}
        {app.tokenAlertThreshold7d !== null ? (
          <ConfigurationRow
            label="Seven-day usage alert"
            value={`${compactNumber(app.tokenAlertThreshold7d)} tokens · ${tokenAlertStateLabel(
              app.tokenAlertState,
              app.tokenAlertThreshold7d,
            )}`}
          />
        ) : null}
      </dl>
    </section>
  )
}

function CredentialMetadataRow({
  canMutate,
  credential,
  disabled,
  onRevoke,
}: {
  canMutate: boolean
  credential: AdminConnectedAppCredentialMetadata
  disabled: boolean
  onRevoke: (credential: AdminConnectedAppCredentialMetadata) => void
}) {
  return (
    <article className="flex flex-col gap-3 py-3.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-mono text-sm font-medium text-white">
            {maskedCredentialMetadataIdentifier(credential)}
          </p>
          <CredentialStatusPill status={credential.status} />
        </div>
        <p className="mt-1 text-xs leading-5 text-[#9b9b9b]">
          {authMethodLabel(credential.authMethod)} ·{" "}
          <span aria-label={`Issued ${dateOnlyLabel(credential.issuedAt)}`}>
            {formatCredentialAge(credential.issuedAt)}
          </span>{" "}
          · Last used {lastUsedLabel(credential.lastUsedAt)}
        </p>
        {credential.status === "retiring" && credential.overlapExpiresAt ? (
          <p className="mt-1 text-xs font-medium text-[#ffdb8a]">
            Overlap ends {dateTimeLabel(credential.overlapExpiresAt)}
          </p>
        ) : null}
        {credential.status === "revoked" && credential.revokedAt ? (
          <p className="mt-1 text-xs text-[#9b9b9b]">
            Revoked {dateTimeLabel(credential.revokedAt)}
          </p>
        ) : null}
      </div>
      {canMutate && credential.status !== "revoked" ? (
        <button
          className={quietDestructiveActionClass}
          disabled={disabled}
          onClick={() => onRevoke(credential)}
          type="button"
        >
          Revoke now
        </button>
      ) : null}
    </article>
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
  const [showEnableForm, setShowEnableForm] = useState(false)
  const [showReenableConfirm, setShowReenableConfirm] = useState(false)
  const [showDisableConfirm, setShowDisableConfirm] = useState(false)
  const [credentialToRevoke, setCredentialToRevoke] =
    useState<AdminConnectedAppFirecrawlCredentialMetadata | null>(null)
  const [enableResult, enableAction, enablePending] = useActionState(
    enableAdminConnectedAppFirecrawlAction,
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
    pageMutationPending || enablePending || revokePending || disablePending
  usePendingConsoleSessionRecovery(
    operationPending,
    enableResult == null || revokeResult == null || disableResult == null,
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
    if (enableState.status === "enabled") {
      setShowEnableForm(false)
      setShowReenableConfirm(false)
    }
    releaseMutation("firecrawl-enable")
  }, [enableState, isMutationActive, onAppChange, releaseMutation])
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
    setCredentialReveal(null)
    setShowDisableConfirm(false)
    releaseMutation("firecrawl-disable")
  }, [disableState, isMutationActive, onAppChange, releaseMutation])

  if (firecrawl.status !== "enabled") {
    const wasEnabled = firecrawl.disclaimerAcceptedAt !== null
    const hasActiveCredential = firecrawl.credentials.some(
      (credential) => credential.status === "active",
    )
    const canConfigureInitialEnable = !wasEnabled
    const canReenable = wasEnabled && hasActiveCredential
    const credentialWasRevoked = wasEnabled && !hasActiveCredential
    const parentDisabled = app.status === "disabled"

    return (
      <>
        <section
          aria-labelledby="firecrawl-access-heading"
          className="overflow-hidden rounded-xl border border-[#353535] bg-[#232323] p-4 sm:p-5"
        >
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2
                className="text-base font-semibold text-white"
                id="firecrawl-access-heading"
              >
                Firecrawl
              </h2>
              <p className="mt-1 text-sm leading-5 text-[#b2b2b2]">
                Optional web search and static scrape access.
              </p>
            </div>
            <AccessSwitch
              checked={false}
              controls={
                canConfigureInitialEnable ? "firecrawl-enable-panel" : undefined
              }
              disabled={
                !isAdmin ||
                operationPending ||
                parentDisabled ||
                credentialWasRevoked
              }
              expanded={canConfigureInitialEnable ? showEnableForm : undefined}
              label="Firecrawl"
              onToggle={() => {
                if (canConfigureInitialEnable) {
                  setShowEnableForm((current) => !current)
                } else if (canReenable) {
                  setShowReenableConfirm(true)
                }
              }}
            />
          </div>

          {parentDisabled ? (
            <p className="mt-4 border-t border-[#353535] pt-4 text-sm text-[#9b9b9b]">
              Firecrawl controls are unavailable while this Key is disabled.
            </p>
          ) : credentialWasRevoked ? (
            <div className="mt-4 grid gap-2 border-t border-[#353535] pt-4 text-sm text-[#b2b2b2]">
              <p>
                The Firecrawl credential was revoked. This Key cannot issue a
                replacement.
              </p>
              {isAdmin ? (
                <Link
                  className="w-fit font-medium text-[#73cfff] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#009fff]"
                  href="/keys/apps/new"
                >
                  Create a new Key
                </Link>
              ) : null}
            </div>
          ) : canReenable ? (
            <div className="mt-4 border-t border-[#353535] pt-4">
              <p className="text-sm text-[#b2b2b2]">
                Re-enable Firecrawl with its original credential and fixed
                access limits.
              </p>
              <FirecrawlActionStatus state={enableState} />
            </div>
          ) : null}

          {canConfigureInitialEnable ? (
            <div
              aria-hidden={!showEnableForm}
              className={cn(
                "grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none",
                showEnableForm
                  ? "grid-rows-[1fr] opacity-100"
                  : "grid-rows-[0fr] opacity-0",
              )}
              id="firecrawl-enable-panel"
            >
              <div className="min-h-0 overflow-hidden">
                <div className="mt-4 grid gap-4 border-t border-[#353535] pt-4">
                  <p className="text-sm text-[#b2b2b2]">
                    Firecrawl remains off until enablement completes. Its
                    credential and access limits are then fixed for this Key.
                  </p>
                  <FirecrawlActionStatus state={enableState} />
                  <form
                    action={enableAction}
                    onSubmit={(event) => {
                      if (beginMutation(event, "firecrawl-enable")) {
                        setCredentialReveal(null)
                      }
                    }}
                  >
                    <fieldset
                      className="grid gap-4"
                      disabled={!showEnableForm || operationPending}
                    >
                      <input name="appId" type="hidden" value={app.id} />
                      <label className="flex items-start gap-3 text-sm leading-5 text-[#ffdb8a]">
                        <input
                          className="mt-1"
                          name="disclaimerAccepted"
                          required
                          type="checkbox"
                        />
                        <span>
                          I understand that enabling Firecrawl permits outbound
                          web requests. Remote websites may log those requests.
                          Retrieved content is processed transiently with zero
                          content retention in LLM Machines-managed components.
                        </span>
                      </label>
                      <FirecrawlProtectionFields firecrawl={firecrawl} />
                      <div className="flex justify-end">
                        <PendingSubmitButton
                          className={primaryButtonClass}
                          forcePending={
                            activeOperation === "firecrawl-enable" ||
                            enablePending
                          }
                          idleLabel="Enable Firecrawl"
                          pendingLabel="Enabling..."
                          unavailable={
                            operationPending &&
                            activeOperation !== "firecrawl-enable"
                          }
                        />
                      </div>
                    </fieldset>
                  </form>
                </div>
              </div>
            </div>
          ) : null}
        </section>

        {isAdmin && showReenableConfirm ? (
          <ConfirmationDialog
            description="Firecrawl will use the original credential and fixed access limits created for this Key."
            dismissDisabled={operationPending}
            onCancel={() => setShowReenableConfirm(false)}
            title="Re-enable Firecrawl?"
          >
            <form
              action={enableAction}
              onSubmit={(event) => beginMutation(event, "firecrawl-enable")}
            >
              <input name="appId" type="hidden" value={app.id} />
              <input name="disclaimerAccepted" type="hidden" value="on" />
              <PendingSubmitButton
                className={primaryButtonClass}
                forcePending={
                  activeOperation === "firecrawl-enable" || enablePending
                }
                idleLabel="Re-enable Firecrawl"
                pendingLabel="Re-enabling..."
                unavailable={
                  operationPending && activeOperation !== "firecrawl-enable"
                }
              />
            </form>
          </ConfirmationDialog>
        ) : null}
      </>
    )
  }

  return (
    <>
      <section
        aria-labelledby="firecrawl-access-heading"
        className="grid gap-4 rounded-xl border border-[#353535] bg-[#232323] p-4 sm:p-5"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2
              className="text-base font-semibold text-white"
              id="firecrawl-access-heading"
            >
              Firecrawl
            </h2>
            <p className="mt-1 text-sm leading-5 text-[#b2b2b2]">
              Optional web search and static scrape access.
            </p>
          </div>
          <AccessSwitch
            checked
            disabled={!isAdmin || operationPending || app.status === "disabled"}
            label="Firecrawl"
            onToggle={() => setShowDisableConfirm(true)}
          />
        </div>

        {app.status === "disabled" ? (
          <p className="border-t border-[#353535] pt-4 text-sm text-[#9b9b9b]">
            Firecrawl is suspended while this Key is disabled.
          </p>
        ) : null}

        <FirecrawlActionStatus state={enableState} />
        <FirecrawlActionStatus state={revokeState} />
        <FirecrawlActionStatus state={disableState} />

        <div className="border-t border-[#353535] pt-4">
          <h3 className="text-sm font-semibold text-white">
            Firecrawl configuration
          </h3>
          <p className="mt-1 text-sm text-[#9b9b9b]">
            Fixed when Firecrawl was enabled for this Key.
          </p>
        </div>

        <dl className="grid gap-0">
          <ConfigurationRow
            label="Capabilities"
            value="Web search and static single-page scrape"
          />
          {firecrawl.searchRateLimitRps !== null ? (
            <ConfigurationRow
              label="Search protection"
              value={`${compactNumber(firecrawl.searchRateLimitRps)} rps`}
            />
          ) : null}
          {firecrawl.scrapeRateLimitRps !== null ? (
            <ConfigurationRow
              label="Static scrape protection"
              value={`${compactNumber(firecrawl.scrapeRateLimitRps)} rps`}
            />
          ) : null}
          {firecrawl.maxConcurrentScrapes !== null ? (
            <ConfigurationRow
              label="Concurrent static scrapes"
              value={compactNumber(firecrawl.maxConcurrentScrapes)}
            />
          ) : null}
        </dl>

        {firecrawl.credentials.length > 0 ? (
          <FirecrawlCredentialMetadataList
            canMutate={isAdmin}
            credentials={firecrawl.credentials}
            disabled={operationPending}
            onRevoke={setCredentialToRevoke}
          />
        ) : null}
      </section>

      {isAdmin && credentialReveal ? (
        <ConnectedAppFirecrawlCredentialReveal
          credential={credentialReveal}
          key={credentialReveal.credentialId}
          title="Firecrawl credential"
        />
      ) : null}

      {isAdmin && credentialToRevoke ? (
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

      {isAdmin && showDisableConfirm ? (
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
  const currentCredentials = credentials.filter(
    (credential) => credential.status !== "revoked",
  )
  const revokedCredentials = credentials.filter(
    (credential) => credential.status === "revoked",
  )

  return (
    <div className="grid gap-3 border-t border-[#353535] pt-4">
      <div>
        <h3 className="text-sm font-semibold text-white">
          Firecrawl credentials
        </h3>
        <p className="mt-1 text-sm text-[#b2b2b2]">
          Separate from inference. Secret values are available only when issued.
        </p>
      </div>
      <div className="divide-y divide-[#353535] rounded-lg bg-[#1d1d1d] px-3">
        {currentCredentials.map((credential) => (
          <FirecrawlCredentialMetadataRow
            canMutate={canMutate}
            credential={credential}
            disabled={disabled}
            key={credential.id}
            onRevoke={onRevoke}
          />
        ))}
      </div>
      {revokedCredentials.length > 0 ? (
        <details className="group rounded-lg border border-[#353535]">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 text-sm font-medium text-[#d7d7d7] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#009fff]">
            Firecrawl credential history ({revokedCredentials.length})
            <ChevronDown
              aria-hidden
              className="size-4 transition-transform group-open:rotate-180 motion-reduce:transition-none"
            />
          </summary>
          <div className="divide-y divide-[#353535] border-t border-[#353535] px-3">
            {revokedCredentials.map((credential) => (
              <FirecrawlCredentialMetadataRow
                canMutate={false}
                credential={credential}
                disabled
                key={credential.id}
                onRevoke={onRevoke}
              />
            ))}
          </div>
        </details>
      ) : null}
    </div>
  )
}

function FirecrawlCredentialMetadataRow({
  canMutate,
  credential,
  disabled,
  onRevoke,
}: {
  canMutate: boolean
  credential: AdminConnectedAppFirecrawlCredentialMetadata
  disabled: boolean
  onRevoke: (credential: AdminConnectedAppFirecrawlCredentialMetadata) => void
}) {
  return (
    <article className="flex flex-col gap-3 py-3.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-mono text-sm font-medium text-white">
            {maskedIdentifier(credential.keyPrefix)}
          </p>
          <CredentialStatusPill status={credential.status} />
        </div>
        <p className="mt-1 text-xs leading-5 text-[#9b9b9b]">
          <span aria-label={`Issued ${dateOnlyLabel(credential.issuedAt)}`}>
            {formatCredentialAge(credential.issuedAt)}
          </span>{" "}
          · Last used {lastUsedLabel(credential.lastUsedAt)}
        </p>
        {credential.status === "retiring" && credential.overlapExpiresAt ? (
          <p className="mt-1 text-xs font-medium text-[#ffdb8a]">
            Overlap ends {dateTimeLabel(credential.overlapExpiresAt)}
          </p>
        ) : null}
        {credential.status === "revoked" && credential.revokedAt ? (
          <p className="mt-1 text-xs text-[#9b9b9b]">
            Revoked {dateTimeLabel(credential.revokedAt)}
          </p>
        ) : null}
      </div>
      {canMutate && credential.status !== "revoked" ? (
        <button
          className={quietDestructiveActionClass}
          disabled={disabled}
          onClick={() => onRevoke(credential)}
          type="button"
        >
          Revoke Firecrawl key
        </button>
      ) : null}
    </article>
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

function ConfigurationRow({
  label,
  value,
}: {
  label: React.ReactNode
  value: string
}) {
  return (
    <div className="grid gap-1 border-t border-[#353535] py-3 first:border-t-0 first:pt-0 last:pb-0 sm:grid-cols-[minmax(160px,0.8fr)_minmax(0,1.2fr)] sm:items-start sm:gap-5">
      <dt className="text-sm font-medium text-white">{label}</dt>
      <dd className="break-words text-sm leading-5 text-[#b2b2b2] sm:text-right">
        {value}
      </dd>
    </div>
  )
}

type KeySortKey = "created" | "name" | "status"
type KeySort = { direction: "asc" | "desc"; key: KeySortKey }

function SortableKeyHeader({
  activeSort,
  className,
  label,
  onSort,
  sortKey,
}: {
  activeSort: KeySort
  className?: string
  label: string
  onSort: (key: KeySortKey) => void
  sortKey: KeySortKey
}) {
  const active = activeSort.key === sortKey
  return (
    <th
      aria-sort={
        active
          ? activeSort.direction === "asc"
            ? "ascending"
            : "descending"
          : "none"
      }
      className={cn("px-4 py-3", className)}
      scope="col"
    >
      <button
        className="inline-flex items-center gap-1 rounded-sm text-left transition-colors hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#009fff]"
        onClick={() => onSort(sortKey)}
        type="button"
      >
        {label}
        <ChevronDown
          aria-hidden
          className={cn(
            "size-3.5 transition-all motion-reduce:transition-none",
            active ? "opacity-100" : "opacity-0",
            active && activeSort.direction === "asc" && "rotate-180",
          )}
        />
      </button>
    </th>
  )
}

function TooltipIconLink({
  children,
  href,
  label,
}: {
  children: React.ReactNode
  href: string
  label: string
}) {
  const tooltipId = useId()
  return (
    <span className="group relative inline-flex">
      <Link
        aria-describedby={tooltipId}
        aria-label={label}
        className={iconActionClass}
        href={href}
      >
        {children}
      </Link>
      <span className={tooltipClass} id={tooltipId} role="tooltip">
        {label}
      </span>
    </span>
  )
}

function TooltipIconButton({
  children,
  destructive = false,
  label,
  onClick,
}: {
  children: React.ReactNode
  destructive?: boolean
  label: string
  onClick: () => void
}) {
  const tooltipId = useId()
  return (
    <span className="group relative inline-flex">
      <button
        aria-describedby={tooltipId}
        aria-label={label}
        className={cn(
          iconActionClass,
          destructive &&
            "text-[#ff7377] hover:bg-[#321f20] hover:text-[#ff8a8d]",
        )}
        onClick={onClick}
        type="button"
      >
        {children}
      </button>
      <span className={tooltipClass} id={tooltipId} role="tooltip">
        {label}
      </span>
    </span>
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

type AccessStateTone = "info" | "neutral" | "positive" | "warning"

function AccessSwitch({
  checked,
  controls,
  disabled,
  expanded,
  label,
  onToggle,
}: {
  checked: boolean
  controls?: string
  disabled: boolean
  expanded?: boolean
  label: string
  onToggle: () => void
}) {
  return (
    <button
      aria-checked={checked}
      aria-controls={controls}
      aria-expanded={controls ? expanded : undefined}
      aria-label={`${checked ? "Disable" : "Enable"} ${label}`}
      className="inline-flex shrink-0 items-center gap-2 rounded-md px-1 py-1 text-xs font-medium text-[#b2b2b2] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#009fff] disabled:cursor-not-allowed disabled:opacity-50"
      disabled={disabled}
      onClick={onToggle}
      role="switch"
      type="button"
    >
      <span>{checked ? "On" : "Off"}</span>
      <span
        aria-hidden
        className={cn(
          "relative h-6 w-11 rounded-full border transition-colors duration-200 motion-reduce:transition-none",
          checked
            ? "border-[#2988b8] bg-[#1677a8]"
            : "border-[#505050] bg-[#303030]",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 left-0.5 size-[18px] rounded-full bg-white shadow-sm transition-transform duration-200 motion-reduce:transition-none",
            checked && "translate-x-5",
          )}
        />
      </span>
    </button>
  )
}

function AccessStateLabel({
  label,
  tone,
}: {
  label: string
  tone: AccessStateTone
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs font-semibold",
        tone === "positive" && "text-[#56d888]",
        tone === "info" && "text-[#73cfff]",
        tone === "warning" && "text-[#ffdb8a]",
        tone === "neutral" && "text-[#b2b2b2]",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-1.5 rounded-full",
          tone === "positive" && "bg-[#56d888]",
          tone === "info" && "bg-[#73cfff]",
          tone === "warning" && "bg-[#ffdb8a]",
          tone === "neutral" && "bg-[#777]",
        )}
      />
      {label}
    </span>
  )
}

function AccessSummaryRow({
  connectionStatus,
  lastConnectedAt,
  status,
  title,
  tone,
}: {
  connectionStatus: AdminConnectedApp["connectionStatus"]
  lastConnectedAt: string | null
  status: string
  title: string
  tone: AccessStateTone
}) {
  return (
    <div className="grid gap-1 py-3.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] sm:items-center sm:gap-6">
      <div className="flex min-w-0 items-center justify-between gap-3 sm:justify-start">
        <p className="text-sm font-medium text-white">{title}</p>
        <AccessStateLabel label={status} tone={tone} />
      </div>
      <p className="text-sm text-[#b2b2b2] sm:text-right">
        <span className="text-[#8b8b8b]">Client activity:</span>{" "}
        {connectionStatusLabel(connectionStatus)}
        {lastConnectedAt
          ? ` · Last observed ${dateTimeLabel(lastConnectedAt)}`
          : " · No authenticated client observed yet"}
      </p>
    </div>
  )
}

function KeyLifecyclePill({
  status,
}: {
  status: AdminConnectedApp["status"]
}) {
  return (
    <AccessStateLabel
      label={status === "enabled" ? "Active" : "Disabled"}
      tone={status === "enabled" ? "positive" : "neutral"}
    />
  )
}

function CredentialStatusPill({
  status,
}: {
  status: AdminConnectedAppCredentialMetadata["status"]
}) {
  return (
    <AccessStateLabel
      label={status.charAt(0).toUpperCase() + status.slice(1)}
      tone={
        status === "active"
          ? "positive"
          : status === "retiring"
            ? "warning"
            : "neutral"
      }
    />
  )
}

function PageHeader({ title }: { title: string }) {
  return (
    <header>
      <h1 className="text-2xl font-semibold text-white">{title}</h1>
    </header>
  )
}

function SubpageHeader({
  breadcrumbLabel,
  description,
  focusFallback = false,
  headingRef,
  title,
}: {
  breadcrumbLabel?: string
  description?: string
  focusFallback?: boolean
  headingRef?: React.Ref<HTMLHeadingElement>
  title: string
}) {
  return (
    <header>
      <nav aria-label="Breadcrumb">
        <ol className="flex items-center gap-1 text-sm text-[#9b9b9b]">
          <li>
            <Link
              className="rounded-sm transition-colors hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#009fff]"
              href="/keys"
            >
              Keys
            </Link>
          </li>
          <li aria-hidden>
            <ChevronRight className="size-4" />
          </li>
          <li aria-current="page" className="min-w-0 truncate text-[#d7d7d7]">
            {breadcrumbLabel ?? title}
          </li>
        </ol>
      </nav>
      <h1
        className="mt-3 text-2xl font-semibold text-white"
        data-dialog-focus-fallback={focusFallback || undefined}
        ref={headingRef}
        tabIndex={focusFallback ? -1 : undefined}
      >
        {title}
      </h1>
      {description ? (
        <p className="mt-2 max-w-2xl text-sm leading-5 text-[#b2b2b2]">
          {description}
        </p>
      ) : null}
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
    invalid: {
      description: "Key action needs valid values and confirmation.",
      tone: "danger",
    },
    reenabled: { description: "Key re-enabled.", tone: "success" },
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

function dateOnlyLabel(value: string): string {
  return applicationsDateFormatter.format(new Date(value))
}

function lastUsedLabel(value: string | null | undefined): string {
  return value ? dateOnlyLabel(value) : "Never used"
}

function formatCredentialAge(value: string): string {
  const days = Math.max(
    0,
    Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000),
  )
  return days === 0 ? "Issued today" : `${days} day${days === 1 ? "" : "s"}`
}

function maskedIdentifier(value: string): string {
  return `Credential •••• ${value.slice(-4)}`
}

function maskedCredentialMetadataIdentifier(
  credential: AdminConnectedAppCredentialMetadata,
): string {
  return maskedIdentifier(
    credential.keyPrefix ?? credential.clientId ?? credential.id,
  )
}

function compareKeys(
  left: AdminConnectedApp,
  right: AdminConnectedApp,
  sort: KeySort,
): number {
  let comparison = 0
  if (sort.key === "name") {
    comparison = left.name.localeCompare(right.name)
  } else if (sort.key === "status") {
    comparison =
      Number(left.status === "enabled") - Number(right.status === "enabled")
  } else {
    comparison = Date.parse(left.createdAt) - Date.parse(right.createdAt)
  }
  if (comparison !== 0) {
    return sort.direction === "asc" ? comparison : -comparison
  }
  return Date.parse(right.createdAt) - Date.parse(left.createdAt)
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
  return "Not observed"
}

function firecrawlStatusLabel(
  status: AdminConnectedApp["firecrawl"]["status"],
): string {
  return status === "enabled" ? "Enabled" : "Not enabled"
}

function modelAccessLabel(app: AdminConnectedApp): string {
  return app.modelMode === "auto"
    ? "Auto"
    : `Manual · ${app.allowedModels.join(", ")}`
}

function formatBytes(value: number): string {
  if (value >= 1024 * 1024) {
    return `${applicationsCompactNumberFormatter.format(value / (1024 * 1024))} MiB`
  }
  if (value >= 1024) {
    return `${applicationsCompactNumberFormatter.format(value / 1024)} KiB`
  }
  return `${value.toLocaleString()} bytes`
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

function compactNumber(value: number): string {
  return applicationsCompactNumberFormatter.format(value)
}

const primaryButtonClass =
  "inline-flex h-9 items-center justify-center gap-1 rounded-md bg-[#2e2e2e] px-3 text-sm font-medium text-white transition-colors hover:bg-[#383838] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#009fff] disabled:cursor-not-allowed disabled:opacity-50"
const secondaryButtonClass =
  "inline-flex h-9 items-center justify-center gap-1 rounded-md border border-[#454545] px-3 text-sm font-medium text-white transition-colors hover:bg-[#2e2e2e] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#009fff] disabled:cursor-not-allowed disabled:opacity-50"
const dangerButtonClass =
  "inline-flex h-9 items-center justify-center rounded-md border border-[#6b3033] px-3 text-sm font-medium text-[#ff7377] transition-colors hover:bg-[#321f20] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#009fff] disabled:cursor-not-allowed disabled:opacity-50"
const quietActionClass =
  "inline-flex h-10 items-center justify-center gap-2 rounded-md px-2.5 text-sm font-medium text-[#d7d7d7] transition-colors hover:bg-[#2e2e2e] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#009fff] disabled:cursor-not-allowed disabled:opacity-50"
const quietDestructiveActionClass =
  "inline-flex h-10 shrink-0 items-center justify-center rounded-md px-2.5 text-sm font-medium text-[#ff7377] transition-colors hover:bg-[#321f20] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#009fff] disabled:cursor-not-allowed disabled:opacity-50"
const disableButtonClass =
  "inline-flex h-10 items-center justify-center rounded-md border border-[#6b3033] px-3 text-sm font-medium text-[#ff8a8d] transition-colors hover:bg-[#2b2021] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#009fff] disabled:cursor-not-allowed disabled:opacity-50"
const deleteButtonClass =
  "inline-flex h-10 items-center justify-center rounded-md bg-[#3a2022] px-3 text-sm font-semibold text-[#ff7377] transition-colors hover:bg-[#4a2528] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#009fff] disabled:cursor-not-allowed disabled:opacity-50"
const iconActionClass =
  "inline-flex size-[26px] items-center justify-center rounded-md text-[#b2b2b2] transition-colors hover:bg-[#303030] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#009fff] disabled:cursor-not-allowed disabled:opacity-50"
const tooltipClass =
  "pointer-events-none absolute bottom-full right-0 z-30 mb-2 whitespace-nowrap rounded-md border border-[#454545] bg-[#121212] px-2 py-1.5 text-xs font-medium normal-case tracking-normal text-[#d7d7d7] opacity-0 shadow-xl transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 motion-reduce:transition-none"
