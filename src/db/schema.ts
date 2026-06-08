import { sql } from "drizzle-orm";
import {
  check,
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
    prevPointId: text("prev_point_id").references((): any => timelinePoints.id, {
      onDelete: "set null",
    }),
    ...timestampColumns,
  },
  (table) => [
    check("timeline_points_key_nonempty", sql`length(${table.key}) > 0`),
    check("timeline_points_label_nonempty", sql`length(${table.label}) > 0`),
    check(
      "timeline_points_prev_not_self",
      sql`${table.prevPointId} IS NULL OR ${table.prevPointId} <> ${table.id}`,
    ),
    uniqueIndex("timeline_points_workspace_key_idx").on(table.workspaceId, table.key),
    uniqueIndex("timeline_points_prev_point_idx").on(table.prevPointId),
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
    uniqueIndex("aux_node_layers_workspace_timeline_aux_idx").on(
      table.workspaceId,
      sql`coalesce(${table.timelinePointId}, '__origin__')`,
      table.auxNodeId,
    ),
    index("aux_node_layers_workspace_aux_idx").on(table.workspaceId, table.auxNodeId),
    index("aux_node_layers_timeline_point_idx").on(table.timelinePointId),
  ],
);
