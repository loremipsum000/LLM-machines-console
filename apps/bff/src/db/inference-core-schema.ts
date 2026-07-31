import {
  boolean,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"

export const common = pgSchema("common")
export const admin = pgSchema("admin")

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
  updatedBy: text("updated_by").references(() => users.id, {
    onDelete: "restrict",
  }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
})

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
