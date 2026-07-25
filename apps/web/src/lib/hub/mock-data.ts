import type {
  Artifact,
  HubChatThread,
  HubHomeResponse,
  HubNotification,
  HubResource,
  HubUsageSummary,
  TaskSession,
} from "@llm-machines/contracts"
import { getLibreChatConversationUrl } from "@/lib/auth/sso-bridge"

function fixtureLibreChatHref(threadId: string): string {
  return (
    getLibreChatConversationUrl(threadId) ??
    `/chat?thread=${encodeURIComponent(threadId)}`
  )
}

export const hubResources: HubResource[] = [
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
    id: "internal-docs",
    type: "mcp_connector",
    name: "Internal Docs",
    description:
      "Read-only connector for appliance-local documentation search.",
    state: "available",
    version: "0.1.0",
    owner: "LLM Machines",
    supportTier: "t2",
    sourceStatus: "ok",
    tags: ["mcp", "read_only"],
    actions: [
      {
        id: "open",
        label: "View connector",
        href: "/resources/mcp_connector/internal-docs",
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
]

export const hubNotifications: HubNotification[] = [
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
  {
    id: "11111111-1111-4111-8111-111111111111",
    severity: "info",
    title: "Summary Agent is available",
    body: "Run @summary-agent from chat or open it from the catalog.",
    source: "resources",
    href: "/resources/agent/agent-summary",
    readAt: null,
    createdAt: "2026-05-20T08:00:00.000Z",
  },
]

export const hubRecentChats: HubChatThread[] = [
  {
    id: "chat-agent-studio-runtime",
    title: "Builder Agent Studio runtime check",
    preview:
      "Confirmed the Studio test path through the OpenClaw-compatible runtime.",
    updatedAt: "2026-05-21T10:30:00.000Z",
    href: fixtureLibreChatHref("chat-agent-studio-runtime"),
    model: "qwen3-35b-local",
    resourceName: "Summary Agent",
  },
  {
    id: "chat-internal-docs",
    title: "Internal docs check",
    preview:
      "Confirmed the internal-docs connector is the only exposed MCP server.",
    updatedAt: "2026-05-21T09:35:00.000Z",
    href: fixtureLibreChatHref("chat-internal-docs"),
    model: "qwen3-35b-local",
    resourceName: "Internal Docs",
  },
  {
    id: "chat-release-summary",
    title: "Daily release summary",
    preview:
      "Summarized Hub lifecycle work, remaining risks, and next Builder steps.",
    updatedAt: "2026-05-20T18:15:00.000Z",
    href: fixtureLibreChatHref("chat-release-summary"),
    model: "qwen3-35b-local",
    resourceName: "Summary Agent",
  },
]

export const hubUsage: HubUsageSummary = {
  scope: "admin",
  window: "30d",
  prompts: 0,
  tokens: 0,
  topModels: [],
  topResources: [],
  sourceStatus: "not_configured",
}

export const hubTasks: TaskSession[] = [
  {
    id: "44444444-4444-4444-8444-444444444444",
    title: "Review MCP catalog seed",
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

export const hubArtifacts: Artifact[] = [
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

export const hubHome: HubHomeResponse = {
  persona: "admin",
  capabilities: [
    "developer_workbench",
    "task_sessions",
    "artifact_preview",
    "builder_status",
    "admin_summary",
    "org_usage",
    "connector_setup",
  ],
  generatedAt: "2026-05-20T00:00:00.000Z",
  modules: [
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
      threads: hubRecentChats,
    },
    {
      id: "resources",
      type: "resources",
      title: "Available resources",
      sourceStatus: "ok",
      resources: hubResources,
    },
    {
      id: "notifications",
      type: "notifications",
      title: "Notifications",
      sourceStatus: "ok",
      notifications: hubNotifications,
    },
    {
      id: "usage",
      type: "usage",
      title: "Usage",
      sourceStatus: hubUsage.sourceStatus,
      summary: hubUsage,
    },
    {
      id: "builder-status",
      type: "builder_status",
      title: "Builder status",
      sourceStatus: "ok",
      draftCount: 2,
      submittedCount: 1,
      rejectedCount: 1,
    },
    {
      id: "developer-workbench",
      type: "developer_workbench",
      title: "Developer workbench",
      sourceStatus: "ok",
      tasks: hubTasks,
      artifacts: hubArtifacts,
    },
    {
      id: "admin-attention",
      type: "admin_attention",
      title: "Admin attention",
      sourceStatus: "degraded",
      criticalCount: 0,
      warningCount: 2,
      href: "/knowledge",
      items: [
        {
          id: "builder-review-queue",
          severity: "warning",
          title: "Builder submissions awaiting review",
          body: "Submitted Builder resources are waiting on Admin approval before consumers can run them.",
          source: "builder",
          href: "/applications",
          count: 1,
        },
        {
          id: "admin-federator-gap",
          severity: "warning",
          title: "Admin summary is not fully federated",
          body: "Hub shows safe aggregation and drilldowns, but policy, audit, update, and identity federators still need dedicated Admin surfaces.",
          source: "admin",
          href: "/hardware",
          count: 4,
        },
      ],
    },
  ],
}
