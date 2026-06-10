import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const timestampColumns = {
  createdAt: integer("created_at", { mode: "number" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "number" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
};

function aiSelectionSnapshotColumns() {
  return {
    snapshotConnectionName: text("snapshot_connection_name"),
    snapshotSdkPackage: text("snapshot_sdk_package"),
    snapshotBaseUrl: text("snapshot_base_url"),
    snapshotModelOrigin: text("snapshot_model_origin"),
    snapshotModelId: text("snapshot_model_id"),
    snapshotModelDisplayName: text("snapshot_model_display_name"),
    snapshotModelFamily: text("snapshot_model_family"),
    snapshotCapabilitiesJson: text("snapshot_capabilities_json"),
    snapshotPricingJson: text("snapshot_pricing_json"),
  };
}

function aiSelectionReferenceColumns() {
  return {
    connectionId: text("connection_id").references(() => aiConnections.id, {
      onDelete: "set null",
    }),
    catalogModelId: text("catalog_model_id").references(() => aiCatalogModels.id, {
      onDelete: "set null",
    }),
    customModelId: text("custom_model_id").references(() => aiConnectionCustomModels.id, {
      onDelete: "set null",
    }),
  };
}

export const globalConfigOptions = sqliteTable(
  "global_config_options",
  {
    key: text("key").primaryKey(),
    valueJson: text("value_json").notNull(),
    ...timestampColumns,
  },
  (table) => [check("global_config_options_key_nonempty", sql`length(${table.key}) > 0`)],
);

export const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    ...timestampColumns,
  },
  (table) => [
    check("projects_name_nonempty", sql`length(${table.name}) > 0`),
    index("projects_updated_at_idx").on(table.updatedAt),
  ],
);

export const workspaces = sqliteTable(
  "workspaces",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
    contentRootId: text("content_root_id"),
    auxRootId: text("aux_root_id"),
    ...timestampColumns,
  },
  (table) => [
    check("workspaces_name_nonempty", sql`length(${table.name}) > 0`),
    uniqueIndex("workspaces_project_name_idx").on(table.projectId, table.name),
    index("workspaces_project_idx").on(table.projectId),
  ],
);

export const timelinePoints = sqliteTable(
  "timeline_points",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    label: text("label").notNull(),
    description: text("description"),
    prevPointId: text("prev_point_id"),
    ...timestampColumns,
  },
  (table) => [
    check("timeline_points_key_nonempty", sql`length(${table.key}) > 0`),
    check("timeline_points_label_nonempty", sql`length(${table.label}) > 0`),
    check(
      "timeline_points_prev_not_self",
      sql`${table.prevPointId} IS NULL OR ${table.prevPointId} <> ${table.id}`,
    ),
    foreignKey({
      columns: [table.workspaceId, table.prevPointId],
      foreignColumns: [table.workspaceId, table.id],
      name: "timeline_points_prev_same_workspace_fk",
    }),
    uniqueIndex("timeline_points_workspace_key_idx").on(table.workspaceId, table.key),
    uniqueIndex("timeline_points_workspace_id_idx").on(table.workspaceId, table.id),
    uniqueIndex("timeline_points_prev_point_idx").on(table.prevPointId),
    uniqueIndex("timeline_points_single_origin_successor_per_workspace_idx")
      .on(table.workspaceId)
      .where(sql`${table.prevPointId} IS NULL`),
    index("timeline_points_workspace_idx").on(table.workspaceId),
  ],
);

export const contentNodes = sqliteTable(
  "content_nodes",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    parentId: text("parent_id").references((): any => contentNodes.id, {
      onDelete: "cascade",
    }),
    nextSiblingId: text("next_sibling_id").references((): any => contentNodes.id, {
      onDelete: "set null",
    }),
    anchorTimelinePointId: text("anchor_timeline_point_id").references(() => timelinePoints.id, {
      onDelete: "set null",
    }),
    kind: text("kind"),
    title: text("title"),
    body: text("body"),
    ...timestampColumns,
  },
  (table) => [
    check(
      "content_nodes_parent_not_self",
      sql`${table.parentId} IS NULL OR ${table.parentId} <> ${table.id}`,
    ),
    check(
      "content_nodes_next_sibling_not_self",
      sql`${table.nextSiblingId} IS NULL OR ${table.nextSiblingId} <> ${table.id}`,
    ),
    uniqueIndex("content_nodes_next_sibling_idx").on(table.nextSiblingId),
    index("content_nodes_workspace_idx").on(table.workspaceId),
    index("content_nodes_parent_idx").on(table.parentId),
    index("content_nodes_anchor_timeline_point_idx").on(table.anchorTimelinePointId),
  ],
);

export const auxNodes = sqliteTable(
  "aux_nodes",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    nodeType: text("node_type").notNull(),
    ...timestampColumns,
  },
  (table) => [
    check(
      "aux_nodes_node_type_valid",
      sql`${table.nodeType} IN ('root', 'dir', 'file', 'symlink')`,
    ),
    index("aux_nodes_workspace_idx").on(table.workspaceId),
  ],
);

export const aiCatalogProviders = sqliteTable(
  "ai_catalog_providers",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    sdkPackage: text("sdk_package"),
    apiUrl: text("api_url"),
    docsUrl: text("docs_url"),
    envKeysJson: text("env_keys_json").notNull().default("[]"),
    rawJson: text("raw_json").notNull(),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    lastSeenAt: integer("last_seen_at", { mode: "number" }).notNull(),
    ...timestampColumns,
  },
  (table) => [
    check("ai_providers_name_nonempty", sql`length(${table.name}) > 0`),
    index("ai_providers_active_idx").on(table.isActive),
  ],
);

export const aiCatalogModels = sqliteTable(
  "ai_catalog_models",
  {
    id: text("id").primaryKey(),
    providerId: text("provider_id")
      .notNull()
      .references(() => aiCatalogProviders.id, { onDelete: "cascade" }),
    modelId: text("model_id").notNull(),
    displayName: text("display_name").notNull(),
    family: text("family"),
    inputModalitiesJson: text("input_modalities_json").notNull().default("[]"),
    outputModalitiesJson: text("output_modalities_json").notNull().default("[]"),
    contextWindow: integer("context_window"),
    maxOutputTokens: integer("max_output_tokens"),
    supportsVision: integer("supports_vision", { mode: "boolean" }).notNull().default(false),
    supportsToolUse: integer("supports_tool_use", { mode: "boolean" }).notNull().default(false),
    supportsReasoning: integer("supports_reasoning", { mode: "boolean" }).notNull().default(false),
    supportsTemperature: integer("supports_temperature", { mode: "boolean" })
      .notNull()
      .default(false),
    inputPricePer1m: real("input_price_per_1m"),
    outputPricePer1m: real("output_price_per_1m"),
    costJson: text("cost_json"),
    rawJson: text("raw_json").notNull(),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    lastSeenAt: integer("last_seen_at", { mode: "number" }).notNull(),
    ...timestampColumns,
  },
  (table) => [
    check("ai_models_display_name_nonempty", sql`length(${table.displayName}) > 0`),
    check("ai_models_model_id_nonempty", sql`length(${table.modelId}) > 0`),
    uniqueIndex("ai_models_provider_model_idx").on(table.providerId, table.modelId),
    index("ai_models_provider_idx").on(table.providerId),
    index("ai_models_active_idx").on(table.isActive),
  ],
);

export const aiConnections = sqliteTable(
  "ai_connections",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    sdkPackage: text("sdk_package").notNull(),
    catalogProviderId: text("catalog_provider_id").references(() => aiCatalogProviders.id, {
      onDelete: "restrict",
    }),
    baseUrl: text("base_url"),
    apiKey: text("api_key"),
    configJson: text("config_json").notNull().default("{}"),
    isEnabled: integer("is_enabled", { mode: "boolean" }).notNull().default(true),
    ...timestampColumns,
  },
  (table) => [
    check("ai_connections_name_nonempty", sql`length(${table.name}) > 0`),
    check("ai_connections_package_nonempty", sql`length(${table.sdkPackage}) > 0`),
    check("ai_connections_kind_valid", sql`${table.kind} IN ('registry', 'custom')`),
    check(
      "ai_connections_registry_requires_provider",
      sql`${table.kind} <> 'registry' OR ${table.catalogProviderId} IS NOT NULL`,
    ),
    index("ai_connections_kind_idx").on(table.kind),
    index("ai_connections_provider_idx").on(table.catalogProviderId),
  ],
);

export const aiConnectionCatalogOverrides = sqliteTable(
  "ai_connection_catalog_overrides",
  {
    id: text("id").primaryKey(),
    connectionId: text("connection_id")
      .notNull()
      .references(() => aiConnections.id, { onDelete: "cascade" }),
    catalogModelId: text("catalog_model_id")
      .notNull()
      .references(() => aiCatalogModels.id, { onDelete: "cascade" }),
    isEnabled: integer("is_enabled", { mode: "boolean" }).notNull(),
    ...timestampColumns,
  },
  (table) => [
    uniqueIndex("ai_connection_catalog_override_idx").on(table.connectionId, table.catalogModelId),
    index("ai_connection_catalog_model_idx").on(table.catalogModelId),
  ],
);

export const aiConnectionCustomModels = sqliteTable(
  "ai_connection_custom_models",
  {
    id: text("id").primaryKey(),
    connectionId: text("connection_id")
      .notNull()
      .references(() => aiConnections.id, { onDelete: "cascade" }),
    modelId: text("model_id").notNull(),
    displayName: text("display_name").notNull(),
    contextWindow: integer("context_window"),
    maxOutputTokens: integer("max_output_tokens"),
    supportsVision: integer("supports_vision", { mode: "boolean" }).notNull().default(false),
    supportsToolUse: integer("supports_tool_use", { mode: "boolean" }).notNull().default(false),
    supportsReasoning: integer("supports_reasoning", { mode: "boolean" }).notNull().default(false),
    supportsTemperature: integer("supports_temperature", { mode: "boolean" })
      .notNull()
      .default(false),
    inputPricePer1m: real("input_price_per_1m"),
    outputPricePer1m: real("output_price_per_1m"),
    isEnabled: integer("is_enabled", { mode: "boolean" }).notNull().default(true),
    ...timestampColumns,
  },
  (table) => [
    check("ai_connection_custom_models_model_nonempty", sql`length(${table.modelId}) > 0`),
    check("ai_connection_custom_models_name_nonempty", sql`length(${table.displayName}) > 0`),
    uniqueIndex("ai_connection_custom_models_unique_idx").on(table.connectionId, table.modelId),
    index("ai_connection_custom_models_connection_idx").on(table.connectionId),
  ],
);

export const aiRegistryState = sqliteTable(
  "ai_registry_state",
  {
    id: text("id").primaryKey(),
    lastAttemptAt: integer("last_attempt_at", { mode: "number" }),
    lastSuccessAt: integer("last_success_at", { mode: "number" }),
    lastError: text("last_error"),
    contentHash: text("content_hash"),
    ...timestampColumns,
  },
  (table) => [check("ai_registry_state_id_nonempty", sql`length(${table.id}) > 0`)],
);

export const aiProjectMessages = sqliteTable(
  "ai_project_messages",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    prevMessageId: text("prev_message_id").references((): any => aiProjectMessages.id, {
      onDelete: "cascade",
    }),
    role: text("role").notNull(),
    contentJson: text("content_json").notNull(),
    summaryText: text("summary_text"),
    ...aiSelectionSnapshotColumns(),
    ...aiSelectionReferenceColumns(),
    metadataJson: text("metadata_json"),
    createdAt: integer("created_at", { mode: "number" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    check(
      "ai_project_messages_prev_not_self",
      sql`${table.prevMessageId} IS NULL OR ${table.prevMessageId} <> ${table.id}`,
    ),
    check(
      "ai_project_messages_role_valid",
      sql`${table.role} IN ('system', 'user', 'assistant', 'tool')`,
    ),
    check(
      "ai_project_messages_model_origin_valid",
      sql`${table.snapshotModelOrigin} IS NULL OR ${table.snapshotModelOrigin} IN ('catalog', 'custom')`,
    ),
    check(
      "ai_project_messages_model_reference_exclusive",
      sql`NOT (${table.catalogModelId} IS NOT NULL AND ${table.customModelId} IS NOT NULL)`,
    ),
    index("ai_project_messages_project_idx").on(table.projectId),
    index("ai_project_messages_prev_idx").on(table.prevMessageId),
    index("ai_project_messages_connection_idx").on(table.connectionId),
    index("ai_project_messages_catalog_model_idx").on(table.catalogModelId),
    index("ai_project_messages_custom_model_idx").on(table.customModelId),
  ],
);

export const aiProjectHeads = sqliteTable(
  "ai_project_heads",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    currentMessageId: text("current_message_id").references(() => aiProjectMessages.id, {
      onDelete: "set null",
    }),
    forkedFromHeadId: text("forked_from_head_id").references((): any => aiProjectHeads.id, {
      onDelete: "set null",
    }),
    forkedFromMessageId: text("forked_from_message_id").references(() => aiProjectMessages.id, {
      onDelete: "set null",
    }),
    isArchived: integer("is_archived", { mode: "boolean" }).notNull().default(false),
    ...timestampColumns,
  },
  (table) => [
    check("ai_project_heads_name_nonempty", sql`length(${table.name}) > 0`),
    index("ai_project_heads_project_idx").on(table.projectId),
    index("ai_project_heads_project_archived_idx").on(table.projectId, table.isArchived),
    index("ai_project_heads_current_message_idx").on(table.currentMessageId),
  ],
);

export const aiProjectAssistantState = sqliteTable(
  "ai_project_assistant_state",
  {
    projectId: text("project_id")
      .primaryKey()
      .references(() => projects.id, { onDelete: "cascade" }),
    activeHeadId: text("active_head_id").references(() => aiProjectHeads.id, {
      onDelete: "set null",
    }),
    ...timestampColumns,
  },
  (table) => [
    index("ai_project_assistant_state_active_head_idx").on(table.activeHeadId),
    index("ai_project_assistant_state_updated_at_idx").on(table.updatedAt),
  ],
);

export const aiProjectGenerationAttempts = sqliteTable(
  "ai_project_generation_attempts",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    headId: text("head_id").references(() => aiProjectHeads.id, {
      onDelete: "set null",
    }),
    triggerMessageId: text("trigger_message_id").references(() => aiProjectMessages.id, {
      onDelete: "set null",
    }),
    assistantMessageId: text("assistant_message_id").references(() => aiProjectMessages.id, {
      onDelete: "set null",
    }),
    status: text("status").notNull(),
    requestJson: text("request_json").notNull(),
    usageJson: text("usage_json"),
    errorJson: text("error_json"),
    ...aiSelectionSnapshotColumns(),
    ...aiSelectionReferenceColumns(),
    createdAt: integer("created_at", { mode: "number" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    completedAt: integer("completed_at", { mode: "number" }),
  },
  (table) => [
    check(
      "ai_project_generation_attempts_status_valid",
      sql`${table.status} IN ('pending', 'success', 'error')`,
    ),
    check(
      "ai_project_generation_attempts_model_origin_valid",
      sql`${table.snapshotModelOrigin} IS NULL OR ${table.snapshotModelOrigin} IN ('catalog', 'custom')`,
    ),
    check(
      "ai_project_generation_attempts_model_reference_exclusive",
      sql`NOT (${table.catalogModelId} IS NOT NULL AND ${table.customModelId} IS NOT NULL)`,
    ),
    index("ai_project_generation_attempts_project_idx").on(table.projectId),
    index("ai_project_generation_attempts_head_idx").on(table.headId),
    index("ai_project_generation_attempts_trigger_message_idx").on(table.triggerMessageId),
    index("ai_project_generation_attempts_assistant_message_idx").on(table.assistantMessageId),
    index("ai_project_generation_attempts_connection_idx").on(table.connectionId),
  ],
);

export const auxNodeLayers = sqliteTable(
  "aux_node_layers",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    timelinePointId: text("timeline_point_id").references(() => timelinePoints.id, {
      onDelete: "restrict",
    }),
    auxNodeId: text("aux_node_id")
      .notNull()
      .references(() => auxNodes.id, { onDelete: "cascade" }),
    isDeleted: integer("is_deleted", { mode: "boolean" }).notNull().default(false),
    parentAuxNodeId: text("parent_aux_node_id").references(() => auxNodes.id, {
      onDelete: "restrict",
    }),
    name: text("name"),
    content: text("content"),
    symlinkTargetAuxNodeId: text("symlink_target_aux_node_id").references(() => auxNodes.id, {
      onDelete: "restrict",
    }),
    ...timestampColumns,
  },
  (table) => [
    check(
      "aux_node_layers_not_deleted_or_has_payload",
      sql`${table.isDeleted} = 1 OR ${table.parentAuxNodeId} IS NOT NULL OR ${table.name} IS NOT NULL OR ${table.content} IS NOT NULL OR ${table.symlinkTargetAuxNodeId} IS NOT NULL`,
    ),
    uniqueIndex("aux_node_layers_origin_aux_idx")
      .on(table.workspaceId, table.auxNodeId)
      .where(sql`${table.timelinePointId} IS NULL`),
    uniqueIndex("aux_node_layers_timeline_aux_idx")
      .on(table.workspaceId, table.timelinePointId, table.auxNodeId)
      .where(sql`${table.timelinePointId} IS NOT NULL`),
    index("aux_node_layers_workspace_aux_idx").on(table.workspaceId, table.auxNodeId),
    index("aux_node_layers_timeline_point_idx").on(table.timelinePointId),
  ],
);
