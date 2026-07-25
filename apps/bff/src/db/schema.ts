import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"

const vector1024 = customType<{
  data: number[]
  driverData: string
}>({
  dataType() {
    return "common.vector(1024)"
  },
})

export const common = pgSchema("common")
export const admin = pgSchema("admin")
export const builder = pgSchema("builder")
export const hub = pgSchema("hub")
export const knowledge = pgSchema("knowledge")
export const knowledgeArchive = pgSchema("knowledge_archive")

export const auditEvents = common.table("audit_events", {
  id: uuid("id").primaryKey(),
  actorId: text("actor_id").notNull(),
  action: text("action").notNull(),
  targetType: text("target_type").notNull(),
  targetId: text("target_id").notNull(),
  reason: text("reason"),
  metadata: jsonb("metadata").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
})

export const users = common.table("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  displayName: text("display_name").notNull(),
  persona: text("persona").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
})

export const embeddingsKnowledgeChunks = common.table(
  "embeddings_knowledge_chunks",
  {
    id: uuid("id").primaryKey(),
    ownerSchema: text("owner_schema").notNull(),
    ownerTable: text("owner_table").notNull(),
    ownerId: uuid("owner_id").notNull(),
    corpusId: uuid("corpus_id").notNull(),
    snapshotId: uuid("snapshot_id").notNull(),
    sourceId: uuid("source_id").notNull(),
    checksum: text("checksum").notNull(),
    model: text("model").notNull(),
    dimensions: integer("dimensions").notNull(),
    embedding: vector1024("embedding"),
    status: text("status").notNull(),
    errorDetail: text("error_detail"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("common_embeddings_knowledge_chunks_owner_model_idx").on(
      table.ownerSchema,
      table.ownerTable,
      table.ownerId,
      table.model,
    ),
    index("common_embeddings_knowledge_chunks_lookup_idx").on(
      table.corpusId,
      table.snapshotId,
      table.status,
    ),
  ],
)

export const builderResources = builder.table("resources", {
  id: uuid("id").primaryKey(),
  type: text("type").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  ownerId: text("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  state: text("state").notNull(),
  templateId: text("template_id"),
  currentVersionId: uuid("current_version_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
})

export const builderResourceVersions = builder.table("resource_versions", {
  id: uuid("id").primaryKey(),
  resourceId: uuid("resource_id")
    .notNull()
    .references(() => builderResources.id, { onDelete: "restrict" }),
  semver: text("semver").notNull(),
  createdBy: text("created_by")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
})

export const builderAgentConfigs = builder.table("agent_configs", {
  resourceId: uuid("resource_id")
    .primaryKey()
    .references(() => builderResources.id, { onDelete: "restrict" }),
  config: jsonb("config").notNull(),
  updatedBy: text("updated_by")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
})

export const builderAgentTestRuns = builder.table("agent_test_runs", {
  id: uuid("id").primaryKey(),
  resourceId: uuid("resource_id")
    .notNull()
    .references(() => builderResources.id, { onDelete: "restrict" }),
  actorId: text("actor_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  input: text("input").notNull(),
  output: text("output"),
  source: text("source").notNull(),
  status: text("status").notNull(),
  model: text("model").notNull(),
  sandboxProfile: text("sandbox_profile").notNull(),
  durationMs: integer("duration_ms").notNull(),
  runtimeTraceId: text("runtime_trace_id").notNull(),
  finishReason: text("finish_reason"),
  promptTokens: integer("prompt_tokens"),
  completionTokens: integer("completion_tokens"),
  totalTokens: integer("total_tokens"),
  errorDetail: text("error_detail"),
  trace: jsonb("trace").notNull(),
  toolCalls: jsonb("tool_calls").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
})

export const builderLifecycleEvents = builder.table("lifecycle_events", {
  id: uuid("id").primaryKey(),
  resourceId: uuid("resource_id")
    .notNull()
    .references(() => builderResources.id, { onDelete: "restrict" }),
  resourceVersionId: uuid("resource_version_id").references(
    () => builderResourceVersions.id,
    { onDelete: "restrict" },
  ),
  actorId: text("actor_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  fromState: text("from_state"),
  toState: text("to_state").notNull(),
  comment: text("comment"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
})

export const notificationReads = hub.table(
  "notification_reads",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    notificationId: uuid("notification_id").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.userId, table.notificationId],
    }),
  ],
)

export const chatThreads = hub.table(
  "chat_threads",
  {
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    threadId: text("thread_id").notNull(),
    title: text("title").notNull(),
    preview: text("preview").notNull(),
    model: text("model"),
    resourceName: text("resource_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.ownerId, table.threadId],
    }),
  ],
)

export const taskSessions = hub.table("task_sessions", {
  id: uuid("id").primaryKey(),
  ownerId: text("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  title: text("title").notNull(),
  status: text("status").notNull(),
  context: jsonb("context").notNull(),
  diffs: jsonb("diffs").notNull(),
  testOutput: jsonb("test_output"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
})

export const artifacts = hub.table("artifacts", {
  id: uuid("id").primaryKey(),
  ownerId: text("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  taskId: uuid("task_id").references(() => taskSessions.id, {
    onDelete: "restrict",
  }),
  title: text("title").notNull(),
  kind: text("kind").notNull(),
  preview: text("preview").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
})

export const egressApprovals = admin.table("egress_approvals", {
  id: uuid("id").primaryKey(),
  sandboxName: text("sandbox_name").notNull(),
  profile: text("profile").notNull(),
  endpointHost: text("endpoint_host").notNull(),
  endpointPort: integer("endpoint_port").notNull(),
  accessMode: text("access_mode").notNull(),
  reason: text("reason").notNull(),
  status: text("status").notNull(),
  approvedBy: text("approved_by").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  idempotencyKey: text("idempotency_key"),
  requestHash: text("request_hash"),
  adapterStatus: text("adapter_status"),
  executedCommand: jsonb("executed_command").notNull(),
  rollbackCommand: jsonb("rollback_command").notNull(),
  stdout: text("stdout").notNull(),
  stderr: text("stderr").notNull(),
  failureDetail: text("failure_detail"),
  rollbackMetadata: jsonb("rollback_metadata").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  appliedAt: timestamp("applied_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
})

export const agenticRuntimeSnapshots = admin.table(
  "agentic_runtime_snapshots",
  {
    id: uuid("id").primaryKey(),
    runtime: text("runtime").notNull(),
    profile: text("profile").notNull(),
    configured: boolean("configured").notNull(),
    healthy: boolean("healthy").notNull(),
    baseUrl: text("base_url"),
    detail: text("detail"),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("agentic_runtime_snapshots_runtime_captured_idx").on(
      table.runtime,
      table.capturedAt,
    ),
  ],
)

export const builderAgentStudioQuotaPolicies = admin.table(
  "builder_agent_studio_quota_policies",
  {
    id: text("id").primaryKey(),
    runLimit: integer("run_limit"),
    tokenLimit: integer("token_limit"),
    updatedBy: text("updated_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    note: text("note").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
)

export const connectorVettingDecisions = admin.table(
  "connector_vetting_decisions",
  {
    id: uuid("id").primaryKey(),
    connectorId: text("connector_id").notNull(),
    decision: text("decision").notNull(),
    checklist: jsonb("checklist").notNull(),
    note: text("note").notNull(),
    decidedBy: text("decided_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    sourceRef: text("source_ref").notNull(),
    checksum: text("checksum").notNull(),
    requiredScopes: jsonb("required_scopes").notNull(),
    allowedEndpoints: jsonb("allowed_endpoints").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("connector_vetting_decisions_connector_created_idx").on(
      table.connectorId,
      table.createdAt,
    ),
  ],
)

export const adminMcpServers = admin.table(
  "mcp_servers",
  {
    id: text("id").primaryKey(),
    displayName: text("display_name").notNull(),
    description: text("description").notNull(),
    chatCommand: text("chat_command").notNull(),
    transport: text("transport").notNull(),
    endpointUrl: text("endpoint_url"),
    stdioCommand: text("stdio_command"),
    authMode: text("auth_mode").notNull(),
    bearerTokenSecretRef: text("bearer_token_secret_ref"),
    accessGroups: jsonb("access_groups").notNull(),
    accessLevel: text("access_level").notNull(),
    status: text("status").notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    updatedBy: text("updated_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("admin_mcp_servers_command_idx").on(table.chatCommand),
    index("admin_mcp_servers_status_updated_idx").on(
      table.status,
      table.updatedAt,
    ),
  ],
)

export const connectedApps = admin.table(
  "connected_apps",
  {
    id: text("id").primaryKey(),
    displayName: text("display_name").notNull(),
    description: text("description").notNull(),
    ownerGroup: text("owner_group").notNull(),
    allowedModels: jsonb("allowed_models").notNull(),
    rateLimitRpm: integer("rate_limit_rpm"),
    tokenBudget7d: integer("token_budget_7d"),
    status: text("status").notNull(),
    environments: jsonb("environments").notNull(),
    usageSummary: jsonb("usage_summary").notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    updatedBy: text("updated_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("admin_connected_apps_status_updated_idx").on(
      table.status,
      table.updatedAt,
    ),
    index("admin_connected_apps_owner_group_idx").on(table.ownerGroup),
  ],
)

export const connectedAppApiKeys = admin.table(
  "connected_app_api_keys",
  {
    id: text("id").primaryKey(),
    appId: text("app_id")
      .notNull()
      .references(() => connectedApps.id, { onDelete: "cascade" }),
    environment: text("environment").notNull(),
    keyPrefix: text("key_prefix").notNull(),
    keyHash: text("key_hash").notNull(),
    status: text("status").notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    rotatedAt: timestamp("rotated_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("admin_connected_app_api_keys_hash_idx").on(table.keyHash),
    index("admin_connected_app_api_keys_lookup_idx").on(
      table.keyPrefix,
      table.status,
    ),
    index("admin_connected_app_api_keys_app_env_idx").on(
      table.appId,
      table.environment,
      table.status,
    ),
  ],
)

export const consoleSettings = admin.table("console_settings", {
  id: text("id").primaryKey(),
  organizationName: text("organization_name").notNull(),
  defaultLanguage: text("default_language").notNull(),
  fullLogo: jsonb("full_logo"),
  iconLogo: jsonb("icon_logo"),
  telemetryEnabled: boolean("telemetry_enabled").notNull(),
  telemetryPayloadPreview: jsonb("telemetry_payload_preview").notNull(),
  privacyPolicyHref: text("privacy_policy_href").notNull(),
  dataResidencyStatement: text("data_residency_statement").notNull(),
  breakGlassAdminId: text("break_glass_admin_id"),
  breakGlassUpdatedBy: text("break_glass_updated_by"),
  breakGlassUpdatedAt: timestamp("break_glass_updated_at", {
    withTimezone: true,
  }),
  updatedBy: text("updated_by").references(() => users.id, {
    onDelete: "restrict",
  }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
})

export const urlPolicyRules = admin.table(
  "url_policy_rules",
  {
    id: uuid("id").primaryKey(),
    ruleType: text("rule_type").notNull(),
    pattern: text("pattern").notNull(),
    normalizedPattern: text("normalized_pattern").notNull(),
    scope: text("scope").notNull(),
    reason: text("reason").notNull(),
    status: text("status").notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    updatedBy: text("updated_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("admin_url_policy_rules_unique_idx").on(
      table.ruleType,
      table.normalizedPattern,
      table.scope,
    ),
    index("admin_url_policy_rules_status_scope_idx").on(
      table.status,
      table.scope,
      table.updatedAt,
    ),
  ],
)

export const licenseState = admin.table("license_state", {
  id: text("id").primaryKey(),
  sourceStatus: text("source_status").notNull(),
  subscriptionState: text("subscription_state").notNull(),
  supportState: text("support_state").notNull(),
  applianceId: text("appliance_id"),
  certificateExpiresAt: timestamp("certificate_expires_at", {
    withTimezone: true,
  }),
  lastEntitlementCheckAt: timestamp("last_entitlement_check_at", {
    withTimezone: true,
  }),
  offlineMode: boolean("offline_mode").notNull(),
  telemetryOptIn: boolean("telemetry_opt_in").notNull(),
  allowedUpdateChannels: jsonb("allowed_update_channels").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
})

export const policies = admin.table("policies", {
  id: uuid("id").primaryKey(),
  type: text("type").notNull(),
  version: integer("version").notNull(),
  definition: jsonb("definition").notNull(),
  createdBy: text("created_by")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
})

export const policyViolations = admin.table("policy_violations", {
  id: uuid("id").primaryKey(),
  policyId: uuid("policy_id").references(() => policies.id, {
    onDelete: "restrict",
  }),
  policyType: text("policy_type").notNull(),
  severity: text("severity").notNull(),
  actionTaken: text("action_taken").notNull(),
  actorId: text("actor_id").references(() => users.id, {
    onDelete: "restrict",
  }),
  targetType: text("target_type").notNull(),
  targetId: text("target_id").notNull(),
  message: text("message").notNull(),
  metadata: jsonb("metadata").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
})

export const policyViolationRemediations = admin.table(
  "policy_violation_remediations",
  {
    id: uuid("id").primaryKey(),
    violationId: uuid("violation_id")
      .notNull()
      .references(() => policyViolations.id, { onDelete: "restrict" }),
    status: text("status").notNull(),
    note: text("note").notNull(),
    actorId: text("actor_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
)

export const pureModeState = admin.table("pure_mode_state", {
  id: text("id").primaryKey(),
  active: boolean("active").notNull(),
  reason: text("reason"),
  activatedBy: text("activated_by").references(() => users.id, {
    onDelete: "restrict",
  }),
  activatedAt: timestamp("activated_at", { withTimezone: true }),
  deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
  affectedComponents: jsonb("affected_components").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
})

export const knowledgeCorpora = knowledge.table(
  "corpora",
  {
    id: uuid("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    status: text("status").notNull(),
    languageHints: jsonb("language_hints").notNull(),
    publishedSnapshotId: uuid("published_snapshot_id"),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    updatedBy: text("updated_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("knowledge_corpora_status_updated_idx").on(
      table.status,
      table.updatedAt,
    ),
  ],
)

export const knowledgeSources = knowledge.table(
  "sources",
  {
    id: uuid("id").primaryKey(),
    corpusId: uuid("corpus_id")
      .notNull()
      .references(() => knowledgeCorpora.id, { onDelete: "restrict" }),
    sourceType: text("source_type").notNull(),
    title: text("title").notNull(),
    originalUri: text("original_uri"),
    finalUri: text("final_uri"),
    canonicalUri: text("canonical_uri"),
    mimeType: text("mime_type").notNull(),
    checksum: text("checksum").notNull(),
    status: text("status").notNull(),
    language: text("language"),
    metadata: jsonb("metadata").notNull(),
    errorDetail: text("error_detail"),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("knowledge_sources_corpus_status_idx").on(
      table.corpusId,
      table.status,
      table.updatedAt,
    ),
  ],
)

export const knowledgeSourceArtifacts = knowledge.table(
  "source_artifacts",
  {
    id: uuid("id").primaryKey(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => knowledgeSources.id, { onDelete: "restrict" }),
    artifactType: text("artifact_type").notNull(),
    objectKey: text("object_key").notNull(),
    mimeType: text("mime_type").notNull(),
    checksum: text("checksum").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    metadata: jsonb("metadata").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("knowledge_source_artifacts_source_idx").on(
      table.sourceId,
      table.artifactType,
    ),
  ],
)

export const knowledgeArchivedSources = knowledgeArchive.table(
  "sources",
  {
    id: uuid("id").primaryKey(),
    corpusId: uuid("corpus_id")
      .notNull()
      .references(() => knowledgeCorpora.id, { onDelete: "restrict" }),
    sourceId: uuid("source_id").notNull(),
    sourceType: text("source_type").notNull(),
    title: text("title").notNull(),
    originalUri: text("original_uri"),
    finalUri: text("final_uri"),
    canonicalUri: text("canonical_uri"),
    mimeType: text("mime_type").notNull(),
    checksum: text("checksum").notNull(),
    status: text("status").notNull(),
    language: text("language"),
    metadata: jsonb("metadata").notNull(),
    errorDetail: text("error_detail"),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    sourceCreatedAt: timestamp("source_created_at", {
      withTimezone: true,
    }).notNull(),
    sourceUpdatedAt: timestamp("source_updated_at", {
      withTimezone: true,
    }).notNull(),
    archivedBy: text("archived_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    archivedAt: timestamp("archived_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("knowledge_archive_sources_corpus_archived_idx").on(
      table.corpusId,
      table.archivedAt,
    ),
    index("knowledge_archive_sources_source_idx").on(
      table.corpusId,
      table.sourceId,
    ),
  ],
)

export const knowledgeIngestionJobs = knowledge.table(
  "ingestion_jobs",
  {
    id: uuid("id").primaryKey(),
    corpusId: uuid("corpus_id")
      .notNull()
      .references(() => knowledgeCorpora.id, { onDelete: "restrict" }),
    sourceId: uuid("source_id").references(() => knowledgeSources.id, {
      onDelete: "restrict",
    }),
    jobType: text("job_type").notNull(),
    status: text("status").notNull(),
    progressPercent: integer("progress_percent").notNull(),
    metrics: jsonb("metrics").notNull(),
    errorDetail: text("error_detail"),
    retryCount: integer("retry_count").notNull(),
    lockedBy: text("locked_by"),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("knowledge_ingestion_jobs_status_idx").on(
      table.status,
      table.createdAt,
    ),
  ],
)

export const knowledgeUrlAcquisitionJobs = knowledge.table(
  "url_acquisition_jobs",
  {
    id: uuid("id").primaryKey(),
    corpusId: uuid("corpus_id")
      .notNull()
      .references(() => knowledgeCorpora.id, { onDelete: "restrict" }),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => knowledgeSources.id, { onDelete: "restrict" }),
    status: text("status").notNull(),
    adapter: text("adapter").notNull(),
    requestedUrl: text("requested_url").notNull(),
    normalizedUrl: text("normalized_url").notNull(),
    finalUrl: text("final_url"),
    canonicalUrl: text("canonical_url"),
    httpStatus: integer("http_status"),
    contentType: text("content_type"),
    sizeBytes: integer("size_bytes"),
    checksum: text("checksum"),
    redirectChain: jsonb("redirect_chain").notNull(),
    policyMetadata: jsonb("policy_metadata").notNull(),
    attempts: integer("attempts").notNull(),
    errorCode: text("error_code"),
    errorDetail: text("error_detail"),
    lockedBy: text("locked_by"),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("knowledge_url_acquisition_jobs_status_idx").on(
      table.status,
      table.createdAt,
    ),
    index("knowledge_url_acquisition_jobs_source_idx").on(table.sourceId),
    index("knowledge_url_acquisition_jobs_corpus_status_idx").on(
      table.corpusId,
      table.status,
    ),
  ],
)

export const knowledgeSnapshots = knowledge.table(
  "snapshots",
  {
    id: uuid("id").primaryKey(),
    corpusId: uuid("corpus_id")
      .notNull()
      .references(() => knowledgeCorpora.id, { onDelete: "restrict" }),
    version: integer("version").notNull(),
    status: text("status").notNull(),
    sourceCount: integer("source_count").notNull(),
    chunkCount: integer("chunk_count").notNull(),
    metadata: jsonb("metadata").notNull(),
    publishedBy: text("published_by").references(() => users.id, {
      onDelete: "restrict",
    }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("knowledge_snapshots_corpus_status_idx").on(
      table.corpusId,
      table.status,
      table.createdAt,
    ),
  ],
)

export const knowledgeChunks = knowledge.table(
  "chunks",
  {
    id: uuid("id").primaryKey(),
    corpusId: uuid("corpus_id")
      .notNull()
      .references(() => knowledgeCorpora.id, { onDelete: "restrict" }),
    snapshotId: uuid("snapshot_id")
      .notNull()
      .references(() => knowledgeSnapshots.id, { onDelete: "restrict" }),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => knowledgeSources.id, { onDelete: "restrict" }),
    chunkIndex: integer("chunk_index").notNull(),
    content: text("content").notNull(),
    searchText: text("search_text").notNull(),
    language: text("language"),
    pageNumber: integer("page_number"),
    sectionPath: text("section_path"),
    rowRange: text("row_range"),
    imageRegion: text("image_region"),
    metadata: jsonb("metadata").notNull(),
    checksum: text("checksum").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("knowledge_chunks_snapshot_idx").on(
      table.snapshotId,
      table.sourceId,
      table.chunkIndex,
    ),
  ],
)

export const knowledgeCorpusAccessGroups = knowledge.table(
  "corpus_access_groups",
  {
    corpusId: uuid("corpus_id")
      .notNull()
      .references(() => knowledgeCorpora.id, { onDelete: "restrict" }),
    keycloakGroup: text("keycloak_group").notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.corpusId, table.keycloakGroup],
    }),
  ],
)

export const knowledgeAgentCorpusBindings = knowledge.table(
  "agent_corpus_bindings",
  {
    id: uuid("id").primaryKey(),
    agentResourceId: uuid("agent_resource_id").notNull(),
    corpusId: uuid("corpus_id")
      .notNull()
      .references(() => knowledgeCorpora.id, { onDelete: "restrict" }),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("knowledge_agent_corpus_bindings_agent_idx").on(
      table.agentResourceId,
    ),
  ],
)
