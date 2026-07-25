import { createHash, randomUUID } from "node:crypto"
import type {
  AdminConnectorRegistryItem,
  Artifact,
  BuilderSubmission,
  HubAdminAttentionItem,
  HubCapability,
  HubChatThread,
  HubEvent,
  HubHomeResponse,
  HubModule,
  HubNotification,
  HubResource,
  HubSearchResult,
  HubSourceStatus,
  HubUsageSummary,
  HubUsageScope,
  TaskSession,
} from "@llm-machines/contracts"
import {
  artifactSchema,
  taskSessionSchema,
  taskContextItemSchema,
  taskDiffFileSchema,
  taskRunOutputSchema,
  personaCanAccess,
} from "@llm-machines/contracts"
import { desc, eq, sql } from "drizzle-orm"
import type { Actor } from "../auth/persona"
import { canUseBffFixtureData } from "../config/fixture-mode"
import { getDb } from "../db/client"
import {
  artifacts as artifactsTable,
  chatThreads,
  notificationReads,
  taskSessions,
} from "../db/schema"
import { emitAudit } from "./audit"
import {
  LITE_LLM_LOG_SAMPLE_SIZE,
  LiteLlmAdminClient,
  liteLlmConfig,
  liteLlmDateWindow,
} from "./admin-litellm-client"
import { getAdminConnectorRegistryReadModel } from "./admin-connector-registry"
import {
  summarizeLiteLlmActivity,
  summarizeLiteLlmUsageLogsForActor,
} from "./admin-ops-parsers"
import { getBuilderResources, getBuilderSubmissions } from "./builder"
import { publishHubEvent, resetHubEventFanoutForTest } from "./hub-events"
import { readLibreChatRecentChatTitles } from "./librechat-backfill"
import { upsertActorUser } from "./users"

const fixtureGeneratedAt = "2026-05-20T00:00:00.000Z"

const baseResources: HubResource[] = [
  {
    id: "agent-summary",
    type: "agent",
    name: "Summary Agent",
    description: "Summarizes pasted text or selected knowledge context.",
    state: "available",
    version: "1.0.0",
    owner: "LLM Machines",
    supportTier: "t1",
    sourceStatus: "ok",
    tags: ["writing", "summary"],
    actions: [
      {
        id: "run",
        label: "Run in chat",
        href: "/?invoke=@summary-agent",
        enabled: true,
        requiresConfirmation: false,
      },
    ],
  },
  {
    id: "template-standup",
    type: "template",
    name: "Standup Digest",
    description: "Starter template for team status summaries.",
    state: "available",
    version: "0.1.0",
    owner: "LLM Machines",
    supportTier: "t1",
    sourceStatus: "ok",
    tags: ["template", "team"],
    actions: [
      {
        id: "fork",
        label: "Fork in Builder",
        href: "/builder/templates/template-standup",
        enabled: true,
        requiresConfirmation: false,
      },
    ],
  },
  {
    id: "knowledge-company",
    type: "knowledge",
    name: "Company Knowledge",
    description: "Placeholder for approved internal documentation corpora.",
    state: "admin_setup_required",
    version: null,
    owner: null,
    supportTier: "t1",
    sourceStatus: "not_configured",
    tags: ["knowledge"],
    actions: [
      {
        id: "setup",
        label: "Configure in Admin",
        href: "/knowledge",
        enabled: false,
        requiresConfirmation: false,
        reason: "Knowledge runtime and data governance setup are not complete.",
      },
    ],
  },
]

const baseNotifications: HubNotification[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    severity: "info",
    title: "Summary Agent is available",
    body: "Run @summary-agent from chat or open it from the resource catalog.",
    source: "resources",
    href: "/resources/agent/agent-summary",
    readAt: null,
    createdAt: "2026-05-20T08:00:00.000Z",
  },
]

const builderNotifications: HubNotification[] = [
  {
    id: "22222222-2222-4222-8222-222222222222",
    severity: "warning",
    title: "One submission needs rework",
    body: "An admin rejected a draft and left comments in Builder.",
    source: "builder",
    href: "/builder/submissions",
    readAt: null,
    createdAt: "2026-05-20T08:10:00.000Z",
  },
]

const baseRecentChats: HubChatThread[] = [
  {
    id: "chat-agent-studio-runtime",
    title: "Builder Agent Studio runtime check",
    preview:
      "Confirmed the Studio test path through the OpenClaw-compatible runtime.",
    updatedAt: "2026-05-21T10:30:00.000Z",
    href: libreChatConversationHref("chat-agent-studio-runtime"),
    model: "qwen3-35b-local",
    resourceName: "Summary Agent",
  },
  {
    id: "chat-internal-docs",
    title: "Internal docs check",
    preview:
      "Confirmed the internal-docs connector is the only exposed MCP server.",
    updatedAt: "2026-05-21T09:35:00.000Z",
    href: libreChatConversationHref("chat-internal-docs"),
    model: "qwen3-35b-local",
    resourceName: "Internal Docs",
  },
  {
    id: "chat-release-summary",
    title: "Daily release summary",
    preview:
      "Summarized Hub lifecycle work, remaining risks, and next Builder steps.",
    updatedAt: "2026-05-20T18:15:00.000Z",
    href: libreChatConversationHref("chat-release-summary"),
    model: "qwen3-35b-local",
    resourceName: "Summary Agent",
  },
]

function libreChatConversationHref(threadId: string): string {
  const publicUrl = getLibreChatPublicUrl()
  if (!publicUrl) {
    return `/chat?thread=${encodeURIComponent(threadId)}`
  }
  return new URL(`/c/${encodeURIComponent(threadId)}`, publicUrl).toString()
}

function getLibreChatPublicUrl(): string | null {
  const configuredUrl =
    process.env.LIBRECHAT_PUBLIC_URL?.trim() ||
    process.env.LIBRECHAT_PUBLIC_ORIGIN?.trim()
  if (configuredUrl) {
    return configuredUrl.replace(/\/+$/, "")
  }
  return canUseBffFixtureData()
    ? "https://librechat.example.test"
    : null
}

const notificationReadState = new Map<string, Map<string, string>>()
const staticTasks: TaskSession[] = [
  {
    id: "44444444-4444-4444-8444-444444444444",
    title: "Review internal docs connector",
    status: "waiting",
    owner: "builder-1",
    updatedAt: "2026-05-20T08:30:00.000Z",
    href: "/tasks/44444444-4444-4444-8444-444444444444",
    context: [
      {
        label: "Scope",
        value: "Internal docs connector runtime posture",
        href: "/resources/mcp_connector/internal-docs",
        sourceStatus: "ok",
      },
      {
        label: "Admin dependency",
        value: "Published corpora and user access",
        href: "/applications",
        sourceStatus: "ok",
      },
    ],
    diffs: [
      {
        path: "apps/bff/src/catalog/mcp-catalog.ts",
        status: "modified",
        additions: 1,
        deletions: 0,
        preview: [
          '+  id: "internal-docs",',
          '+  vettingStatus: "approved_read_only",',
          '+  runtimeProfile: "managed-tool-proxy",',
        ],
      },
    ],
    testOutput: {
      command: "corepack pnpm --filter @llm-machines/bff test",
      status: "passed",
      summary:
        "Catalog and Hub route checks passed with only internal-docs exposed.",
      logs: [
        {
          timestamp: "2026-05-20T08:32:00.000Z",
          level: "info",
          message: "Parsed internal-docs MCP catalog entry.",
        },
        {
          timestamp: "2026-05-20T08:33:00.000Z",
          level: "info",
          message: "Verified consumer search excludes builder-only sessions.",
        },
      ],
    },
  },
]

const staticArtifacts: Artifact[] = [
  {
    id: "55555555-5555-4555-8555-555555555555",
    taskId: "44444444-4444-4444-8444-444444444444",
    title: "Internal docs connector notes",
    kind: "markdown",
    href: "/artifacts/55555555-5555-4555-8555-555555555555",
    createdAt: "2026-05-20T08:35:00.000Z",
    preview: [
      "# Internal docs connector notes",
      "",
      "- Only internal-docs is exposed in LibreChat.",
      "- The MCP route is served by BFF and limited to governed corpus search.",
      "- Removed connector blueprints must stay out of Hub and Admin runtime surfaces.",
    ].join("\n"),
  },
]

const memoryTaskSessions = new Map<string, TaskSession[]>()
const memoryArtifacts = new Map<string, Artifact[]>()
const memoryRecentChats = new Map<string, HubChatThread[]>()

type HubAdminAttentionModule = Extract<HubModule, { type: "admin_attention" }>

export function getHubCapabilities(actor: Actor): HubCapability[] {
  const capabilities: HubCapability[] = []
  if (personaCanAccess(actor.persona, "builder")) {
    capabilities.push(
      "developer_workbench",
      "task_sessions",
      "artifact_preview",
      "builder_status",
    )
  }
  if (personaCanAccess(actor.persona, "admin")) {
    capabilities.push("admin_summary", "org_usage", "connector_setup")
  }
  return capabilities
}

export async function getHubHome(actor: Actor): Promise<HubHomeResponse> {
  const notifications = await getHubNotifications(actor)
  const actorTasks = await getHubTasks(actor)
  const actorArtifacts = await getHubArtifacts(actor)
  const recentChats = await getHubRecentChats(actor)
  const usage = await getHubUsage(actor)
  const resources = await getHubResources(actor)
  const builderResources = personaCanAccess(actor.persona, "builder")
    ? await getBuilderResources(actor)
    : []
  const builderSubmissions = personaCanAccess(actor.persona, "builder")
    ? await getBuilderSubmissions(actor)
    : []
  const connectorRegistryItems = personaCanAccess(actor.persona, "admin")
    ? (await getAdminConnectorRegistryReadModel()).items
    : []
  const modules: HubModule[] = [
    {
      id: "chat",
      type: "chat",
      title: "Chat",
      sourceStatus: "ok",
      unavailableReason: null,
    },
    {
      id: "recent-chats",
      type: "recent_chats",
      title: "Latest chats",
      sourceStatus: "ok",
      threads: recentChats.slice(0, 3),
    },
    {
      id: "resources",
      type: "resources",
      title: "Available resources",
      sourceStatus: "ok",
      resources: resources.slice(0, 4),
    },
    {
      id: "notifications",
      type: "notifications",
      title: "Notifications",
      sourceStatus: "ok",
      notifications: notifications.slice(0, 5),
    },
    {
      id: "usage",
      type: "usage",
      title: "Usage",
      sourceStatus: usage.sourceStatus,
      summary: usage,
    },
  ]

  if (personaCanAccess(actor.persona, "builder")) {
    modules.push({
      id: "builder-status",
      type: "builder_status",
      title: "Builder status",
      sourceStatus: "ok",
      draftCount: builderResources.filter(
        (resource) => resource.state === "draft",
      ).length,
      submittedCount: builderResources.filter(
        (resource) => resource.state === "submitted",
      ).length,
      rejectedCount: builderSubmissions.filter(
        (submission) => submission.state === "rejected",
      ).length,
    })
    modules.push({
      id: "developer-workbench",
      type: "developer_workbench",
      title: "Developer workbench",
      sourceStatus: "ok",
      tasks: actorTasks,
      artifacts: actorArtifacts,
    })
  }

  if (personaCanAccess(actor.persona, "admin")) {
    modules.push(
      buildAdminAttentionModule(builderSubmissions, connectorRegistryItems),
    )
  }

  return {
    persona: actor.persona,
    capabilities: getHubCapabilities(actor),
    modules,
    generatedAt: new Date().toISOString(),
  }
}

export async function getHubRecentChats(
  actor: Actor,
): Promise<HubChatThread[]> {
  const memoryThreads = getMemoryRecentChats(actor.subject)
  const db = getDb()
  if (!db) {
    if (memoryThreads.length > 0) {
      return memoryThreads
    }
    return canUseBffFixtureData() ? baseRecentChats : []
  }

  const storageActor = await upsertActorUser(actor)
  await backfillLibreChatRecentChats(storageActor).catch(() => undefined)

  const rows = await db
    .select()
    .from(chatThreads)
    .where(eq(chatThreads.ownerId, storageActor.subject))
    .orderBy(desc(chatThreads.updatedAt))
    .limit(10)

  const storedThreads = rows.map((row) =>
    hubChatThreadFromStorage({
      id: row.threadId,
      title: row.title,
      preview: row.preview,
      updatedAt: row.updatedAt,
      model: row.model,
      resourceName: row.resourceName,
    }),
  )
  return mergeRecentChats(memoryThreads, storedThreads)
}

export function recordHubChatThread(
  actor: Actor,
  input: {
    model: string | null
    preview: string
    resourceName?: string | null
    threadId: string
    title?: string | null
  },
): HubChatThread | null {
  const threadId = input.threadId.trim()
  if (!threadId) {
    return null
  }

  const now = new Date()
  const preview = truncateText(input.preview, 180) || "New conversation"
  const title =
    truncateText(input.title ?? "", 80) ??
    truncateText(preview, 80) ??
    `Conversation ${threadId.slice(0, 8)}`
  const thread: HubChatThread = {
    id: threadId,
    title,
    preview,
    updatedAt: now.toISOString(),
    href: libreChatConversationHref(threadId),
    model: input.model?.trim() || null,
    resourceName: input.resourceName?.trim() || null,
  }

  upsertMemoryRecentChat(actor.subject, thread)
  void persistObservedHubChatThread(actor, thread, now).catch(() => undefined)
  return thread
}

export async function getHubResources(actor: Actor): Promise<HubResource[]> {
  const resources = await buildHubResources()
  if (personaCanAccess(actor.persona, "admin")) {
    return resources
  }

  if (personaCanAccess(actor.persona, "builder")) {
    return resources.filter((resource) => resource.state !== "blocked")
  }

  return resources.filter((resource) =>
    ["agent", "knowledge", "mcp_connector", "template"].includes(resource.type),
  )
}

export async function getHubResource(
  actor: Actor,
  type: string,
  id: string,
): Promise<HubResource | undefined> {
  return (await getHubResources(actor)).find(
    (resource) => resource.type === type && resource.id === id,
  )
}

export async function getHubNotifications(
  actor: Actor,
): Promise<HubNotification[]> {
  const notifications = canUseBffFixtureData() ? [...baseNotifications] : []
  if (personaCanAccess(actor.persona, "builder")) {
    if (canUseBffFixtureData()) {
      notifications.push(...builderNotifications)
    }
    notifications.push(...(await getBuilderLifecycleNotifications(actor)))
  }
  if (personaCanAccess(actor.persona, "admin")) {
    const builderSubmissions = await getBuilderSubmissions(actor)
    const connectorRegistryItems = (await getAdminConnectorRegistryReadModel())
      .items
    notifications.push(
      ...buildAdminAttentionNotifications(
        buildAdminAttentionItems(builderSubmissions, connectorRegistryItems),
      ),
    )
  }
  const readState = await getNotificationReadState(actor)
  return applyNotificationReadState(notifications, readState).sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  )
}

export async function markHubNotificationRead(
  actor: Actor,
  id: string,
): Promise<HubNotification | undefined> {
  const notification = (await getHubNotifications(actor)).find(
    (candidate) => candidate.id === id,
  )
  if (!notification) {
    return undefined
  }

  const readAt = notification.readAt ?? new Date().toISOString()
  await persistNotificationReadState(actor, id, readAt)

  await emitAudit({
    actorId: actor.subject,
    action: "hub.notification.mark_read",
    targetType: "hub.notifications",
    targetId: id,
    metadata: {
      source: notification.source,
      severity: notification.severity,
      authMode: actor.authMode,
    },
  })

  const updatedNotification = {
    ...notification,
    readAt,
  }

  await publishHubEvent(
    actor,
    notificationReadEvent(updatedNotification, readAt),
  )

  return updatedNotification
}

async function getBuilderLifecycleNotifications(
  actor: Actor,
): Promise<HubNotification[]> {
  const submissions = await getBuilderSubmissions(actor)

  return submissions
    .filter((submission) => {
      if (actor.persona === "admin") {
        return submission.state === "submitted"
      }
      return ["submitted", "published", "rejected", "withdrawn"].includes(
        submission.state,
      )
    })
    .map((submission): HubNotification => {
      const createdAt =
        submission.decidedAt ?? submission.submittedAt ?? fixtureGeneratedAt
      if (actor.persona === "admin") {
        return {
          id: stableUuidFromText(`admin-builder-review:${submission.id}`),
          severity: "warning",
          title: `${submission.resourceName} is awaiting review`,
          body: `${submission.submittedVersion} is submitted for publishing approval.`,
          source: "builder",
          href: `/builder/resources/${submission.resourceId}`,
          readAt: null,
          createdAt,
        }
      }

      if (submission.state === "rejected") {
        return {
          id: stableUuidFromText(`builder-rejected:${submission.id}`),
          severity: "warning",
          title: `${submission.resourceName} needs rework`,
          body:
            submission.adminComment ??
            "An admin returned this submission to draft.",
          source: "builder",
          href: `/builder/resources/${submission.resourceId}`,
          readAt: null,
          createdAt,
        }
      }

      if (submission.state === "published") {
        return {
          id: stableUuidFromText(`builder-published:${submission.id}`),
          severity: "info",
          title: `${submission.resourceName} is published`,
          body: `${submission.submittedVersion} was approved by an admin.`,
          source: "builder",
          href: `/builder/resources/${submission.resourceId}`,
          readAt: null,
          createdAt,
        }
      }

      if (submission.state === "withdrawn") {
        return {
          id: stableUuidFromText(`builder-withdrawn:${submission.id}`),
          severity: "info",
          title: `${submission.resourceName} returned to draft`,
          body: `${submission.submittedVersion} was withdrawn from admin review.`,
          source: "builder",
          href: `/builder/resources/${submission.resourceId}`,
          readAt: null,
          createdAt,
        }
      }

      return {
        id: stableUuidFromText(`builder-submitted:${submission.id}`),
        severity: "info",
        title: `${submission.resourceName} is awaiting review`,
        body: `${submission.submittedVersion} is locked until an admin decides.`,
        source: "builder",
        href: `/builder/resources/${submission.resourceId}`,
        readAt: null,
        createdAt,
      }
    })
}

export async function getHubUsage(actor: Actor): Promise<HubUsageSummary> {
  const scope = usageScope(actor)
  const config = liteLlmConfig()
  if (!config) {
    return emptyUsage(scope, "not_configured")
  }

  const client = new LiteLlmAdminClient(config)
  const window = liteLlmDateWindow()

  try {
    if (scope === "admin") {
      const activity = summarizeLiteLlmActivity(
        await client.getJson(
          "/user/daily/activity/aggregated",
          new URLSearchParams({
            start_date: window.startDate,
            end_date: window.endDate,
          }),
        ),
      )

      return {
        scope,
        window: "30d",
        prompts: activity.requests,
        tokens: activity.tokens,
        topModels: activity.topModel ? [activity.topModel] : [],
        topResources: [],
        sourceStatus: activity.failedRequests > 0 ? "degraded" : "ok",
      }
    }

    const usage = summarizeLiteLlmUsageLogsForActor(
      await client.getJson(
        "/spend/logs/v2",
        new URLSearchParams({
          start_date: window.startDate,
          end_date: window.endDate,
          page: "1",
          page_size: String(LITE_LLM_LOG_SAMPLE_SIZE),
          status_filter: "success",
        }),
      ),
      actorUsageIdentities(actor),
    )

    return {
      scope,
      window: "30d",
      prompts: usage.matchedRequests,
      tokens: usage.tokens,
      topModels: usage.topModels,
      topResources: [],
      sourceStatus: usage.sampledRequests > 0 ? "degraded" : "ok",
    }
  } catch {
    return emptyUsage(scope, "unavailable")
  }
}

function usageScope(actor: Actor): HubUsageScope {
  if (personaCanAccess(actor.persona, "admin")) {
    return "admin"
  }
  if (personaCanAccess(actor.persona, "builder")) {
    return "builder"
  }
  return "personal"
}

function emptyUsage(
  scope: HubUsageScope,
  sourceStatus: HubSourceStatus,
): HubUsageSummary {
  return {
    scope,
    window: "30d",
    prompts: 0,
    tokens: 0,
    topModels: [],
    topResources: [],
    sourceStatus,
  }
}

function actorUsageIdentities(actor: Actor): string[] {
  const values = [actor.subject, actor.email]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
  const identities = new Set(values)

  for (const value of values) {
    const [localPart, domain] = value.split("@")
    if (localPart && domain) {
      identities.add(localPart)
    }
  }

  return [...identities]
}

export async function getHubTasks(actor: Actor): Promise<TaskSession[]> {
  const actorTasks = await getActorTaskSessions(actor)
  if (personaCanAccess(actor.persona, "builder") && canUseBffFixtureData()) {
    return [...actorTasks, ...staticTasks].sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    )
  }

  return actorTasks
}

export async function getHubTask(
  actor: Actor,
  id: string,
): Promise<TaskSession | undefined> {
  return (await getHubTasks(actor)).find((task) => task.id === id)
}

export async function getHubArtifacts(actor: Actor): Promise<Artifact[]> {
  const actorArtifacts = await getActorArtifacts(actor)
  if (personaCanAccess(actor.persona, "builder") && canUseBffFixtureData()) {
    return [...actorArtifacts, ...staticArtifacts].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    )
  }

  return actorArtifacts
}

export async function getHubArtifact(
  actor: Actor,
  id: string,
): Promise<Artifact | undefined> {
  return (await getHubArtifacts(actor)).find((artifact) => artifact.id === id)
}

export async function getHubAdminSummary(actor: Actor): Promise<HubModule> {
  if (!personaCanAccess(actor.persona, "admin")) {
    throw new Error("Admin summary requires admin persona.")
  }

  const builderSubmissions = await getBuilderSubmissions(actor)
  const connectorRegistryItems = (await getAdminConnectorRegistryReadModel())
    .items
  return buildAdminAttentionModule(builderSubmissions, connectorRegistryItems)
}

function buildAdminAttentionModule(
  builderSubmissions: BuilderSubmission[],
  connectorRegistryItems: AdminConnectorRegistryItem[],
): HubAdminAttentionModule {
  const items = buildAdminAttentionItems(
    builderSubmissions,
    connectorRegistryItems,
  )
  return {
    id: "admin-attention",
    type: "admin_attention",
    title: "Admin attention",
    sourceStatus: "degraded",
    criticalCount: items.filter((item) => item.severity === "critical").length,
    warningCount: items.filter((item) => item.severity === "warning").length,
    href: "/knowledge",
    items,
  }
}

function buildAdminAttentionItems(
  builderSubmissions: BuilderSubmission[],
  connectorRegistryItems: AdminConnectorRegistryItem[],
): HubAdminAttentionItem[] {
  const pendingSubmissions = builderSubmissions.filter(
    (submission) => submission.state === "submitted",
  )
  const connectorsAwaitingVetting = connectorRegistryItems.filter(
    (item) =>
      item.effectiveVettingStatus === "draft" ||
      item.effectiveVettingStatus.startsWith("pending_"),
  )
  const approvedConnectorsMissingRuntime = connectorRegistryItems.filter(
    (item) =>
      isApprovedConnectorVettingStatus(item.effectiveVettingStatus) &&
      !item.runtimeSetup.runnable,
  )

  const items: HubAdminAttentionItem[] = []

  if (connectorsAwaitingVetting.length > 0) {
    items.push({
      id: "connector-vetting",
      severity: "critical",
      title: "Connector vetting required",
      body: "Connector blueprints are visible in Hub but blocked from runtime use until security, license, OAuth, and scoped egress review are complete.",
      source: "mcp_catalog",
      href: "/applications",
      count: connectorsAwaitingVetting.length,
    })
  }

  if (approvedConnectorsMissingRuntime.length > 0) {
    items.push({
      id: "connector-runtime-setup",
      severity: "warning",
      title: "Connector runtime setup required",
      body: "Approved connectors still need required appliance secrets and scoped egress before they can run.",
      source: "mcp_catalog",
      href: "/applications",
      count: approvedConnectorsMissingRuntime.length,
    })
  }

  if (pendingSubmissions.length > 0) {
    items.push({
      id: "builder-review-queue",
      severity: "warning",
      title: "Builder submissions awaiting review",
      body: "Submitted Builder resources are waiting on Admin approval before consumers can run them.",
      source: "builder",
      href: "/applications",
      count: pendingSubmissions.length,
    })
  }

  items.push({
    id: "admin-federator-gap",
    severity: "warning",
    title: "Admin summary is not fully federated",
    body: "Hub shows safe aggregation and drilldowns, but policy, audit, update, and identity federators still need dedicated Admin surfaces.",
    source: "admin",
    href: "/hardware",
    count: 4,
  })

  return items
}

function buildAdminAttentionNotifications(
  items: HubAdminAttentionItem[],
): HubNotification[] {
  const createdAt = new Date().toISOString()
  return items
    .filter((item) =>
      ["connector-vetting", "connector-runtime-setup"].includes(item.id),
    )
    .map(
      (item): HubNotification => ({
        id: stableUuidFromText(`admin-attention-notification:${item.id}`),
        severity: item.severity,
        title: item.title,
        body: item.body,
        source: item.source,
        href: item.href,
        readAt: null,
        createdAt,
      }),
    )
}

function isApprovedConnectorVettingStatus(status: string): boolean {
  return status === "approved_read_only" || status === "approved_read_write"
}

export async function searchHub(
  actor: Actor,
  query: string,
): Promise<HubSearchResult[]> {
  const normalized = query.trim().toLowerCase()
  const resources = await getHubResources(actor)
  const resourceResults = resources
    .filter((resource) =>
      [resource.name, resource.description, ...resource.tags].some((value) =>
        value.toLowerCase().includes(normalized),
      ),
    )
    .map(
      (resource, index): HubSearchResult => ({
        id: resource.id,
        type: "resource",
        title: resource.name,
        description: resource.description,
        href: `/resources/${resource.type}/${resource.id}`,
        rank: index + 1,
      }),
    )

  const taskResults = (await getHubTasks(actor))
    .filter((task) => task.title.toLowerCase().includes(normalized))
    .map(
      (task, index): HubSearchResult => ({
        id: task.id,
        type: "task",
        title: task.title,
        description: task.status,
        href: task.href,
        rank: resourceResults.length + index + 1,
      }),
    )

  const threadResults = (await getHubRecentChats(actor))
    .filter((thread) =>
      [thread.title, thread.preview, thread.model, thread.resourceName].some(
        (value) => value?.toLowerCase().includes(normalized),
      ),
    )
    .map(
      (thread, index): HubSearchResult => ({
        id: thread.id,
        type: "thread",
        title: thread.title,
        description: thread.preview,
        href: thread.href,
        rank: resourceResults.length + taskResults.length + index + 1,
      }),
    )

  if (!normalized) {
    return [...threadResults, ...resourceResults, ...taskResults].slice(0, 10)
  }

  return [...threadResults, ...resourceResults, ...taskResults].slice(0, 10)
}

export async function getHubEvents(actor: Actor): Promise<HubEvent[]> {
  const actorTasks = await getHubTasks(actor)
  const actorArtifacts = await getHubArtifacts(actor)
  const builderResources = personaCanAccess(actor.persona, "builder")
    ? await getBuilderResources(actor)
    : []
  const notificationEvents = (await getHubNotifications(actor)).flatMap(
    (notification): HubEvent[] => {
      const events: HubEvent[] = [
        {
          id: notification.id,
          type: "notification.created",
          createdAt: notification.createdAt,
          resourceId: notification.href,
          payload: notification,
        },
      ]

      if (notification.readAt) {
        events.push(notificationReadEvent(notification, notification.readAt))
      }

      return events
    },
  )
  const taskEvents = actorTasks.map(
    (task): HubEvent => ({
      id: task.id,
      type: "task.updated",
      createdAt: task.updatedAt,
      resourceId: task.id,
      payload: task,
    }),
  )
  const artifactEvents = actorArtifacts.map(
    (artifact): HubEvent => ({
      id: artifact.id,
      type: "artifact.created",
      createdAt: artifact.createdAt,
      resourceId: artifact.id,
      payload: artifact,
    }),
  )
  const resources = await getHubResources(actor)
  const resourceEvents = resources
    .filter((resource) => resource.type === "mcp_connector")
    .map(
      (resource, index): HubEvent => ({
        id: resourceLifecycleEventId(index),
        type: "resource.lifecycle",
        createdAt: new Date().toISOString(),
        resourceId: resource.id,
        payload: {
          id: resource.id,
          name: resource.name,
          state: resource.state,
          sourceStatus: resource.sourceStatus,
        },
      }),
    )

  const builderResourceEvents = builderResources.map(
    (resource): HubEvent => ({
      id: stableUuidFromText(
        `builder-resource:${resource.id}:${resource.state}:${resource.updatedAt}`,
      ),
      type: "resource.lifecycle",
      createdAt: resource.updatedAt,
      resourceId: resource.id,
      payload: {
        id: resource.id,
        name: resource.name,
        resourceType: resource.type,
        state: resource.state,
        ownerId: resource.ownerId,
        currentVersion: resource.currentVersion,
      },
    }),
  )

  return [
    ...notificationEvents,
    ...taskEvents,
    ...artifactEvents,
    ...resourceEvents,
    ...builderResourceEvents,
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export async function createAgentInvocationOutput(opts: {
  actor: Actor
  input: string
  resource: HubResource
  response: string
}): Promise<{ artifact: Artifact; task: TaskSession }> {
  const now = new Date()
  const task: TaskSession = {
    id: randomUUID(),
    title: `Run ${opts.resource.name}`,
    status: "completed",
    owner: opts.actor.subject,
    updatedAt: now.toISOString(),
    href: "",
    context: [
      {
        label: "Agent",
        value: opts.resource.name,
        href: `/resources/${opts.resource.type}/${opts.resource.id}`,
        sourceStatus: opts.resource.sourceStatus,
      },
      {
        label: "Invocation",
        value: opts.input || "No prompt text supplied",
        href: null,
        sourceStatus: "ok",
      },
    ],
    diffs: [],
    testOutput: {
      command: `@${normalizeSlug(opts.resource.name)}`,
      status: "passed",
      summary: "Agent invocation completed through Hub slash middleware.",
      logs: [
        {
          timestamp: now.toISOString(),
          level: "info",
          message: "Resolved agent and produced a local appliance response.",
        },
      ],
    },
  }
  task.href = `/tasks/${task.id}`

  const artifact: Artifact = {
    id: randomUUID(),
    taskId: task.id,
    title: `${opts.resource.name} output`,
    kind: "markdown",
    href: "",
    createdAt: now.toISOString(),
    preview: renderInvocationArtifact(opts),
  }
  artifact.href = `/artifacts/${artifact.id}`

  await persistTaskSession(opts.actor, task)
  await persistArtifact(opts.actor, artifact)

  await publishHubEvent(opts.actor, {
    id: task.id,
    type: "task.updated",
    createdAt: task.updatedAt,
    resourceId: task.id,
    payload: task,
  })
  await publishHubEvent(opts.actor, {
    id: artifact.id,
    type: "artifact.created",
    createdAt: artifact.createdAt,
    resourceId: artifact.id,
    payload: artifact,
  })

  return { artifact, task }
}

export function resetHubStateForTest(): void {
  notificationReadState.clear()
  memoryTaskSessions.clear()
  memoryArtifacts.clear()
  memoryRecentChats.clear()
  resetHubEventFanoutForTest()
}

export { subscribeHubEvents } from "./hub-events"

async function getNotificationReadState(
  actor: Actor,
): Promise<Map<string, string>> {
  const db = getDb()
  if (!db) {
    return notificationReadState.get(actor.subject) ?? new Map()
  }

  const storageActor = await upsertActorUser(actor)
  const rows = await db
    .select({
      notificationId: notificationReads.notificationId,
      readAt: notificationReads.readAt,
    })
    .from(notificationReads)
    .where(eq(notificationReads.userId, storageActor.subject))

  return new Map(
    rows.map((row) => [row.notificationId, row.readAt.toISOString()]),
  )
}

async function persistNotificationReadState(
  actor: Actor,
  notificationId: string,
  readAt: string,
): Promise<void> {
  const db = getDb()
  if (!db) {
    let actorReadState = notificationReadState.get(actor.subject)
    if (!actorReadState) {
      actorReadState = new Map<string, string>()
      notificationReadState.set(actor.subject, actorReadState)
    }
    actorReadState.set(notificationId, readAt)
    return
  }

  const readAtDate = new Date(readAt)
  const now = new Date()
  const storageActor = await upsertActorUser(actor)
  await db
    .insert(notificationReads)
    .values({
      userId: storageActor.subject,
      notificationId,
      readAt: readAtDate,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [notificationReads.userId, notificationReads.notificationId],
      set: {
        readAt: sql`excluded.read_at`,
        updatedAt: now,
      },
    })
}

function getMemoryRecentChats(actorId: string): HubChatThread[] {
  return memoryRecentChats.get(actorId) ?? []
}

function upsertMemoryRecentChat(actorId: string, thread: HubChatThread): void {
  const existing = memoryRecentChats.get(actorId) ?? []
  memoryRecentChats.set(
    actorId,
    [thread, ...existing.filter((item) => item.id !== thread.id)].slice(0, 20),
  )
}

function mergeRecentChats(
  preferred: HubChatThread[],
  stored: HubChatThread[],
): HubChatThread[] {
  const byId = new Map<string, HubChatThread>()
  for (const thread of [...stored, ...preferred]) {
    byId.set(thread.id, thread)
  }
  return [...byId.values()]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 10)
}

async function persistObservedHubChatThread(
  actor: Actor,
  thread: HubChatThread,
  observedAt: Date,
): Promise<void> {
  const db = getDb()
  if (!db) {
    return
  }

  const storageActor = await upsertActorUser(actor)
  await db
    .insert(chatThreads)
    .values({
      ownerId: storageActor.subject,
      threadId: thread.id,
      title: thread.title,
      preview: thread.preview,
      model: thread.model,
      resourceName: thread.resourceName,
      createdAt: observedAt,
      updatedAt: observedAt,
    })
    .onConflictDoUpdate({
      target: [chatThreads.ownerId, chatThreads.threadId],
      set: {
        title: sql`excluded.title`,
        preview: sql`excluded.preview`,
        model: sql`excluded.model`,
        resourceName: sql`excluded.resource_name`,
        updatedAt: observedAt,
      },
    })
}

async function backfillLibreChatRecentChats(actor: Actor): Promise<void> {
  const db = getDb()
  if (!db) {
    return
  }

  const threads = await readLibreChatRecentChatTitles(actor)
  if (threads.length === 0) {
    return
  }

  const storageActor = await upsertActorUser(actor)
  for (const thread of threads) {
    const title = truncateText(thread.title, 80) ?? "LibreChat conversation"
    const preview = truncateText(thread.title, 180) ?? title
    await db
      .insert(chatThreads)
      .values({
        ownerId: storageActor.subject,
        threadId: thread.threadId,
        title,
        preview,
        model: thread.model,
        resourceName: thread.resourceName,
        createdAt: thread.updatedAt,
        updatedAt: thread.updatedAt,
      })
      .onConflictDoUpdate({
        target: [chatThreads.ownerId, chatThreads.threadId],
        set: {
          title: sql`excluded.title`,
          preview: chatThreads.preview,
          model: sql`excluded.model`,
          resourceName: sql`excluded.resource_name`,
          updatedAt: sql`GREATEST(${chatThreads.updatedAt}, excluded.updated_at)`,
        },
      })
  }
}

function hubChatThreadFromStorage(input: {
  id: string
  model: string | null
  preview: string
  resourceName: string | null
  title: string
  updatedAt: Date
}): HubChatThread {
  return {
    id: input.id,
    title: input.title,
    preview: input.preview,
    updatedAt: input.updatedAt.toISOString(),
    href: libreChatConversationHref(input.id),
    model: input.model,
    resourceName: input.resourceName,
  }
}

async function getActorTaskSessions(actor: Actor): Promise<TaskSession[]> {
  const db = getDb()
  if (!db) {
    return memoryTaskSessions.get(actor.subject) ?? []
  }

  const storageActor = await upsertActorUser(actor)
  const rows = await db
    .select()
    .from(taskSessions)
    .where(eq(taskSessions.ownerId, storageActor.subject))

  return rows
    .map((row) =>
      taskSessionSchema.parse({
        id: row.id,
        title: row.title,
        status: row.status,
        owner: row.ownerId,
        updatedAt: row.updatedAt.toISOString(),
        href: `/tasks/${row.id}`,
        context: taskContextItemSchema.array().parse(row.context),
        diffs: taskDiffFileSchema.array().parse(row.diffs),
        testOutput: row.testOutput
          ? taskRunOutputSchema.parse(row.testOutput)
          : null,
      }),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

async function persistTaskSession(
  actor: Actor,
  task: TaskSession,
): Promise<void> {
  const db = getDb()
  if (!db) {
    const actorTasks = memoryTaskSessions.get(actor.subject) ?? []
    memoryTaskSessions.set(actor.subject, [task, ...actorTasks])
    return
  }

  const now = new Date()
  const storageActor = await upsertActorUser(actor)
  await db.insert(taskSessions).values({
    id: task.id,
    ownerId: storageActor.subject,
    title: task.title,
    status: task.status,
    context: task.context,
    diffs: task.diffs,
    testOutput: task.testOutput,
    createdAt: now,
    updatedAt: new Date(task.updatedAt),
  })
}

async function getActorArtifacts(actor: Actor): Promise<Artifact[]> {
  const db = getDb()
  if (!db) {
    return memoryArtifacts.get(actor.subject) ?? []
  }

  const storageActor = await upsertActorUser(actor)
  const rows = await db
    .select()
    .from(artifactsTable)
    .where(eq(artifactsTable.ownerId, storageActor.subject))

  return rows
    .map((row) =>
      artifactSchema.parse({
        id: row.id,
        taskId: row.taskId,
        title: row.title,
        kind: row.kind,
        href: `/artifacts/${row.id}`,
        createdAt: row.createdAt.toISOString(),
        preview: row.preview,
      }),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

async function persistArtifact(
  actor: Actor,
  artifact: Artifact,
): Promise<void> {
  const db = getDb()
  if (!db) {
    const actorArtifacts = memoryArtifacts.get(actor.subject) ?? []
    memoryArtifacts.set(actor.subject, [artifact, ...actorArtifacts])
    return
  }

  const storageActor = await upsertActorUser(actor)
  await db.insert(artifactsTable).values({
    id: artifact.id,
    ownerId: storageActor.subject,
    taskId: artifact.taskId,
    title: artifact.title,
    kind: artifact.kind,
    preview: artifact.preview,
    createdAt: new Date(artifact.createdAt),
  })
}

function applyNotificationReadState(
  notifications: HubNotification[],
  readState: Map<string, string>,
): HubNotification[] {
  if (readState.size === 0) {
    return notifications
  }

  return notifications.map((notification) => ({
    ...notification,
    readAt: readState.get(notification.id) ?? notification.readAt,
  }))
}

function renderInvocationArtifact(opts: {
  input: string
  resource: HubResource
  response: string
}): string {
  return [
    `# ${opts.resource.name} output`,
    "",
    "## Input",
    "",
    opts.input || "_No prompt text supplied._",
    "",
    "## Response",
    "",
    opts.response,
  ].join("\n")
}

async function buildHubResources(): Promise<HubResource[]> {
  const connectorRegistryItems = (await getAdminConnectorRegistryReadModel())
    .items
  return [
    ...baseResources.map(applyRuntimeStateToBaseResource),
    ...connectorRegistryItems.map(hubResourceFromConnectorRegistryItem),
  ]
}

function applyRuntimeStateToBaseResource(resource: HubResource): HubResource {
  if (
    resource.id !== "agent-summary" ||
    process.env.AGENTIC_OPENCLAW_BASE_URL?.trim() ||
    canUseBffFixtureData()
  ) {
    return resource
  }

  return {
    ...resource,
    state: "admin_setup_required",
    sourceStatus: "not_configured",
    actions: resource.actions.map((action) =>
      action.id === "run"
        ? {
            ...action,
            enabled: false,
            reason:
              "OpenClaw must be configured before this agent can run outside fixture mode.",
          }
        : action,
    ),
  }
}

function hubResourceFromConnectorRegistryItem(
  item: AdminConnectorRegistryItem,
): HubResource {
  const runnable = item.posture === "approved" && item.runtimeSetup.runnable
  return {
    id: item.id,
    type: "mcp_connector",
    name: item.displayName,
    description: item.description,
    state: hubConnectorState(item),
    version: item.version,
    owner: item.maintainer,
    supportTier: item.supportTier,
    sourceStatus: item.sourceStatus,
    tags: ["mcp", item.readWrite],
    connector: {
      allowedEndpoints: item.allowedEndpoints,
      auditEvents: item.auditEvents,
      checksum: item.checksum,
      dataClasses: item.dataClasses,
      description: item.description,
      displayName: item.displayName,
      id: item.id,
      lastReviewedAt: item.lastReviewedAt,
      license: item.license,
      maintainer: item.maintainer,
      readWrite: item.readWrite,
      requiredScopes: item.requiredScopes,
      runtimeProfile: item.runtimeProfile,
      secretsRequired: item.secretsRequired,
      sourceRef: item.sourceRef,
      supportTier: item.supportTier,
      version: item.version,
      vettingStatus: item.effectiveVettingStatus,
    },
    actions: [
      {
        id: "open",
        label: runnable ? "View connector" : connectorActionLabel(item),
        href: `/resources/mcp_connector/${item.id}`,
        enabled: runnable,
        requiresConfirmation: false,
        reason: runnable ? undefined : item.runtimeSetup.detail,
      },
    ],
  }
}

function hubConnectorState(
  item: AdminConnectorRegistryItem,
): HubResource["state"] {
  if (item.posture === "blocked") {
    return "blocked"
  }
  if (item.posture === "disabled") {
    return "disabled"
  }
  if (item.posture === "deprecated") {
    return "deprecated"
  }
  if (item.posture !== "approved") {
    return "pending_vetting"
  }
  return item.runtimeSetup.runnable ? "available" : "admin_setup_required"
}

function connectorActionLabel(item: AdminConnectorRegistryItem): string {
  if (item.posture === "review_required") {
    return "Review vetting status"
  }
  if (item.posture === "approved") {
    return "Complete runtime setup"
  }
  return "View policy decision"
}

function normalizeSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

function truncateText(value: string, maxLength: number): string | null {
  const compacted = value.replace(/\s+/g, " ").trim()
  if (!compacted) {
    return null
  }
  if (compacted.length <= maxLength) {
    return compacted
  }
  return `${compacted.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`
}

function resourceLifecycleEventId(index: number): string {
  const stableIds = [
    "88888888-8888-4888-8888-888888888888",
    "99999999-9999-4999-8999-999999999999",
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  ]
  return (
    stableIds[index] ??
    `aaaaaaaa-aaaa-4aaa-8aaa-${index.toString(16).padStart(12, "0")}`
  )
}

function stableUuidFromText(value: string): string {
  const digest = createHash("sha256").update(value).digest("hex")
  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    `4${digest.slice(13, 16)}`,
    `8${digest.slice(17, 20)}`,
    digest.slice(20, 32),
  ].join("-")
}

function notificationReadEvent(
  notification: HubNotification,
  readAt: string,
): HubEvent {
  return {
    id: randomUUID(),
    type: "notification.read",
    createdAt: readAt,
    resourceId: notification.id,
    payload: notification,
  }
}
