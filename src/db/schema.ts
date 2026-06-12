import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  primaryKey,
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
    defaultBranchId: text("default_branch_id").references((): any => branches.id, {
      onDelete: "set null",
    }),
    ...timestampColumns,
  },
  (table) => [
    check("projects_name_nonempty", sql`length(${table.name}) > 0`),
    index("projects_updated_at_idx").on(table.updatedAt),
    index("projects_default_branch_idx").on(table.defaultBranchId),
  ],
);

export const workspaces = sqliteTable(
  "workspaces",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    branchId: text("branch_id")
      .notNull()
      .references((): any => branches.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    contentRootId: text("content_root_id"),
    auxRootId: text("aux_root_id"),
    ...timestampColumns,
  },
  (table) => [
    check("workspaces_name_nonempty", sql`length(${table.name}) > 0`),
    uniqueIndex("workspaces_project_name_idx").on(table.projectId, table.name),
    uniqueIndex("workspaces_branch_idx").on(table.branchId),
    index("workspaces_project_idx").on(table.projectId),
  ],
);

export const blobs = sqliteTable("blobs", {
  id: text("id").primaryKey(),
  content: text("content").notNull(),
  createdAt: integer("created_at", { mode: "number" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export const treeObjects = sqliteTable(
  "tree_objects",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    payloadJson: text("payload_json").notNull(),
    createdAt: integer("created_at", { mode: "number" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    check("tree_objects_kind_valid", sql`${table.kind} IN ('root', 'content', 'aux', 'timeline')`),
    index("tree_objects_project_idx").on(table.projectId),
  ],
);

export const commits = sqliteTable(
  "commits",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    treeId: text("tree_id")
      .notNull()
      .references(() => treeObjects.id, { onDelete: "restrict" }),
    message: text("message").notNull(),
    author: text("author"),
    committedAt: integer("committed_at", { mode: "number" }).notNull(),
    createdAt: integer("created_at", { mode: "number" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    index("commits_project_idx").on(table.projectId),
    index("commits_tree_idx").on(table.treeId),
  ],
);

export const commitParents = sqliteTable(
  "commit_parents",
  {
    commitId: text("commit_id")
      .notNull()
      .references(() => commits.id, { onDelete: "cascade" }),
    parentId: text("parent_id")
      .notNull()
      .references(() => commits.id, { onDelete: "restrict" }),
    parentIndex: integer("parent_index").notNull(),
    mergeRole: text("merge_role").notNull().default("normal"),
    createdAt: integer("created_at", { mode: "number" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    check(
      "commit_parents_merge_role_valid",
      sql`${table.mergeRole} IN ('normal', 'mainline', 'merged')`,
    ),
    check("commit_parents_not_self", sql`${table.commitId} <> ${table.parentId}`),
    primaryKey({ columns: [table.commitId, table.parentId] }),
    uniqueIndex("commit_parents_commit_index_idx").on(table.commitId, table.parentIndex),
    index("commit_parents_parent_idx").on(table.parentId),
  ],
);

export const branches = sqliteTable(
  "branches",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    headCommitId: text("head_commit_id").references((): any => commits.id, {
      onDelete: "set null",
    }),
    forkedFromCommitId: text("forked_from_commit_id").references((): any => commits.id, {
      onDelete: "set null",
    }),
    ...timestampColumns,
  },
  (table) => [
    check("branches_name_nonempty", sql`length(${table.name}) > 0`),
    uniqueIndex("branches_project_name_idx").on(table.projectId, table.name),
    index("branches_project_idx").on(table.projectId),
    index("branches_head_commit_idx").on(table.headCommitId),
  ],
);

export const timelinePoints = sqliteTable(
  "timeline_points",
  {
    id: text("id").notNull(),
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
    primaryKey({ columns: [table.workspaceId, table.id] }),
    foreignKey({
      columns: [table.workspaceId, table.prevPointId],
      foreignColumns: [table.workspaceId, table.id],
      name: "timeline_points_prev_same_workspace_fk",
    }),
    uniqueIndex("timeline_points_workspace_key_idx").on(table.workspaceId, table.key),
    uniqueIndex("timeline_points_prev_point_idx").on(table.workspaceId, table.prevPointId),
    uniqueIndex("timeline_points_single_origin_successor_per_workspace_idx")
      .on(table.workspaceId)
      .where(sql`${table.prevPointId} IS NULL`),
    index("timeline_points_workspace_idx").on(table.workspaceId),
  ],
);

export const contentNodes = sqliteTable(
  "content_nodes",
  {
    id: text("id").notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    parentId: text("parent_id"),
    nextSiblingId: text("next_sibling_id"),
    anchorTimelinePointId: text("anchor_timeline_point_id"),
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
    primaryKey({ columns: [table.workspaceId, table.id] }),
    foreignKey({
      columns: [table.workspaceId, table.parentId],
      foreignColumns: [table.workspaceId, table.id],
      name: "content_nodes_parent_same_workspace_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.workspaceId, table.nextSiblingId],
      foreignColumns: [table.workspaceId, table.id],
      name: "content_nodes_next_sibling_same_workspace_fk",
    }).onDelete("set null"),
    foreignKey({
      columns: [table.workspaceId, table.anchorTimelinePointId],
      foreignColumns: [timelinePoints.workspaceId, timelinePoints.id],
      name: "content_nodes_anchor_same_workspace_fk",
    }).onDelete("set null"),
    uniqueIndex("content_nodes_next_sibling_idx").on(table.workspaceId, table.nextSiblingId),
    index("content_nodes_workspace_idx").on(table.workspaceId),
    index("content_nodes_parent_idx").on(table.workspaceId, table.parentId),
    index("content_nodes_anchor_timeline_point_idx").on(
      table.workspaceId,
      table.anchorTimelinePointId,
    ),
  ],
);

export const auxNodes = sqliteTable(
  "aux_nodes",
  {
    id: text("id").notNull(),
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
    primaryKey({ columns: [table.workspaceId, table.id] }),
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

export const agentThreads = sqliteTable(
  "agent_threads",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    agentProfile: text("agent_profile").notNull(),
    title: text("title").notNull(),
    activeTipNodeId: text("active_tip_node_id").references((): any => agentThreadNodes.id, {
      onDelete: "set null",
    }),
    archivedAt: integer("archived_at", { mode: "number" }),
    ...timestampColumns,
  },
  (table) => [
    check("agent_threads_profile_nonempty", sql`length(${table.agentProfile}) > 0`),
    check("agent_threads_title_nonempty", sql`length(${table.title}) > 0`),
    index("agent_threads_project_idx").on(table.projectId),
    index("agent_threads_project_profile_idx").on(table.projectId, table.agentProfile),
    index("agent_threads_project_archived_idx").on(table.projectId, table.archivedAt),
    index("agent_threads_active_tip_idx").on(table.activeTipNodeId),
  ],
);

export const agentProjectState = sqliteTable(
  "agent_project_state",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    agentProfile: text("agent_profile").notNull(),
    activeThreadId: text("active_thread_id").references(() => agentThreads.id, {
      onDelete: "set null",
    }),
    ...timestampColumns,
  },
  (table) => [
    check("agent_project_state_profile_nonempty", sql`length(${table.agentProfile}) > 0`),
    uniqueIndex("agent_project_state_unique_idx").on(table.projectId, table.agentProfile),
    index("agent_project_state_active_thread_idx").on(table.activeThreadId),
  ],
);

export const agentRuns = sqliteTable(
  "agent_runs",
  {
    id: text("id").primaryKey(),
    threadId: text("thread_id")
      .notNull()
      .references(() => agentThreads.id, { onDelete: "cascade" }),
    parentRunId: text("parent_run_id").references((): any => agentRuns.id, {
      onDelete: "set null",
    }),
    parentEventId: text("parent_event_id").references((): any => agentRunEvents.id, {
      onDelete: "set null",
    }),
    triggerNodeId: text("trigger_node_id").references((): any => agentThreadNodes.id, {
      onDelete: "set null",
    }),
    baseTipNodeId: text("base_tip_node_id").references((): any => agentThreadNodes.id, {
      onDelete: "set null",
    }),
    runMode: text("run_mode").notNull(),
    status: text("status").notNull(),
    agentProfile: text("agent_profile").notNull(),
    selectionSnapshotJson: text("selection_snapshot_json").notNull().default("{}"),
    contextSnapshotJson: text("context_snapshot_json"),
    errorArtifactId: text("error_artifact_id").references((): any => agentArtifacts.id, {
      onDelete: "set null",
    }),
    startedAt: integer("started_at", { mode: "number" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    completedAt: integer("completed_at", { mode: "number" }),
    ...timestampColumns,
  },
  (table) => [
    check(
      "agent_runs_mode_valid",
      sql`${table.runMode} IN ('send', 'retry', 'regenerate', 'edit_regenerate', 'subagent')`,
    ),
    check(
      "agent_runs_status_valid",
      sql`${table.status} IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')`,
    ),
    check("agent_runs_profile_nonempty", sql`length(${table.agentProfile}) > 0`),
    index("agent_runs_thread_idx").on(table.threadId),
    index("agent_runs_parent_run_idx").on(table.parentRunId),
    index("agent_runs_trigger_node_idx").on(table.triggerNodeId),
    index("agent_runs_thread_status_idx").on(table.threadId, table.status),
  ],
);

export const agentArtifacts = sqliteTable(
  "agent_artifacts",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").references(() => agentRuns.id, {
      onDelete: "cascade",
    }),
    stepId: text("step_id").references((): any => agentRunSteps.id, {
      onDelete: "set null",
    }),
    artifactKind: text("artifact_kind").notNull(),
    visibility: text("visibility").notNull(),
    mimeType: text("mime_type"),
    contentJson: text("content_json").notNull(),
    summaryText: text("summary_text"),
    createdAt: integer("created_at", { mode: "number" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    check(
      "agent_artifacts_kind_valid",
      sql`${table.artifactKind} IN ('prepared-model-messages', 'response-messages', 'request-body', 'response-body', 'provider-metadata', 'tool-input', 'tool-output', 'reasoning-raw', 'ui-projection', 'error')`,
    ),
    check(
      "agent_artifacts_visibility_valid",
      sql`${table.visibility} IN ('public', 'hidden', 'internal')`,
    ),
    index("agent_artifacts_run_idx").on(table.runId),
    index("agent_artifacts_step_idx").on(table.stepId),
    index("agent_artifacts_kind_idx").on(table.artifactKind),
  ],
);

export const agentRunSteps = sqliteTable(
  "agent_run_steps",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "cascade" }),
    stepIndex: integer("step_index").notNull(),
    provider: text("provider").notNull(),
    modelId: text("model_id").notNull(),
    finishReason: text("finish_reason"),
    rawFinishReason: text("raw_finish_reason"),
    systemJson: text("system_json"),
    preparedMessagesArtifactId: text("prepared_messages_artifact_id").references(
      () => agentArtifacts.id,
      { onDelete: "set null" },
    ),
    responseMessagesArtifactId: text("response_messages_artifact_id").references(
      () => agentArtifacts.id,
      { onDelete: "set null" },
    ),
    requestBodyArtifactId: text("request_body_artifact_id").references(() => agentArtifacts.id, {
      onDelete: "set null",
    }),
    responseBodyArtifactId: text("response_body_artifact_id").references(() => agentArtifacts.id, {
      onDelete: "set null",
    }),
    providerMetadataArtifactId: text("provider_metadata_artifact_id").references(
      () => agentArtifacts.id,
      { onDelete: "set null" },
    ),
    usageJson: text("usage_json"),
    startedAt: integer("started_at", { mode: "number" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    completedAt: integer("completed_at", { mode: "number" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    createdAt: integer("created_at", { mode: "number" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    check("agent_run_steps_provider_nonempty", sql`length(${table.provider}) > 0`),
    check("agent_run_steps_model_nonempty", sql`length(${table.modelId}) > 0`),
    uniqueIndex("agent_run_steps_run_step_idx").on(table.runId, table.stepIndex),
    index("agent_run_steps_run_idx").on(table.runId),
  ],
);

export const agentThreadNodes = sqliteTable(
  "agent_thread_nodes",
  {
    id: text("id").primaryKey(),
    threadId: text("thread_id")
      .notNull()
      .references(() => agentThreads.id, { onDelete: "cascade" }),
    parentNodeId: text("parent_node_id").references((): any => agentThreadNodes.id, {
      onDelete: "cascade",
    }),
    role: text("role").notNull(),
    createdByRunId: text("created_by_run_id").references(() => agentRuns.id, {
      onDelete: "set null",
    }),
    sourceStepId: text("source_step_id").references(() => agentRunSteps.id, {
      onDelete: "set null",
    }),
    sourceKind: text("source_kind").notNull(),
    summaryText: text("summary_text"),
    messageJson: text("message_json").notNull(),
    createdAt: integer("created_at", { mode: "number" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    check(
      "agent_thread_nodes_parent_not_self",
      sql`${table.parentNodeId} IS NULL OR ${table.parentNodeId} <> ${table.id}`,
    ),
    check(
      "agent_thread_nodes_role_valid",
      sql`${table.role} IN ('system', 'user', 'assistant', 'tool')`,
    ),
    check(
      "agent_thread_nodes_source_kind_valid",
      sql`${table.sourceKind} IN ('user_input', 'model_response', 'tool_result', 'system_seed', 'edit_rewrite')`,
    ),
    index("agent_thread_nodes_thread_idx").on(table.threadId),
    index("agent_thread_nodes_parent_idx").on(table.parentNodeId),
    index("agent_thread_nodes_run_idx").on(table.createdByRunId),
    index("agent_thread_nodes_step_idx").on(table.sourceStepId),
  ],
);

export const agentThreadNodeParts = sqliteTable(
  "agent_thread_node_parts",
  {
    id: text("id").primaryKey(),
    nodeId: text("node_id")
      .notNull()
      .references(() => agentThreadNodes.id, { onDelete: "cascade" }),
    partIndex: integer("part_index").notNull(),
    partKind: text("part_kind").notNull(),
    visibility: text("visibility").notNull().default("public"),
    state: text("state").notNull().default("done"),
    providerOptionsJson: text("provider_options_json"),
    providerMetadataJson: text("provider_metadata_json"),
    payloadJson: text("payload_json").notNull(),
    createdAt: integer("created_at", { mode: "number" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    check(
      "agent_thread_node_parts_kind_valid",
      sql`${table.partKind} IN ('text', 'reasoning', 'tool-call', 'tool-result', 'tool-error', 'file', 'source-url', 'source-document', 'data', 'step-start')`,
    ),
    check(
      "agent_thread_node_parts_visibility_valid",
      sql`${table.visibility} IN ('public', 'hidden', 'internal')`,
    ),
    check("agent_thread_node_parts_state_valid", sql`${table.state} IN ('streaming', 'done')`),
    uniqueIndex("agent_thread_node_parts_node_idx").on(table.nodeId, table.partIndex),
    index("agent_thread_node_parts_kind_idx").on(table.partKind),
  ],
);

export const agentRunEvents = sqliteTable(
  "agent_run_events",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "cascade" }),
    stepId: text("step_id").references(() => agentRunSteps.id, {
      onDelete: "set null",
    }),
    seq: integer("seq").notNull(),
    eventKind: text("event_kind").notNull(),
    nodeId: text("node_id").references(() => agentThreadNodes.id, {
      onDelete: "set null",
    }),
    relatedToolCallId: text("related_tool_call_id"),
    relatedRunId: text("related_run_id").references(() => agentRuns.id, {
      onDelete: "set null",
    }),
    summaryText: text("summary_text"),
    payloadArtifactId: text("payload_artifact_id").references(() => agentArtifacts.id, {
      onDelete: "set null",
    }),
    createdAt: integer("created_at", { mode: "number" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    check(
      "agent_run_events_kind_valid",
      sql`${table.eventKind} IN ('run-started', 'step-started', 'provider-requested', 'provider-responded', 'tool-call-started', 'tool-call-finished', 'tool-call-failed', 'node-materialized', 'active-tip-moved', 'child-run-started', 'run-failed', 'run-succeeded')`,
    ),
    uniqueIndex("agent_run_events_run_seq_idx").on(table.runId, table.seq),
    index("agent_run_events_step_idx").on(table.stepId),
    index("agent_run_events_node_idx").on(table.nodeId),
    index("agent_run_events_related_run_idx").on(table.relatedRunId),
  ],
);

export const auxNodeLayers = sqliteTable(
  "aux_node_layers",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    timelinePointId: text("timeline_point_id"),
    auxNodeId: text("aux_node_id").notNull(),
    isDeleted: integer("is_deleted", { mode: "boolean" }).notNull().default(false),
    parentAuxNodeId: text("parent_aux_node_id"),
    name: text("name"),
    content: text("content"),
    symlinkTargetAuxNodeId: text("symlink_target_aux_node_id"),
    ...timestampColumns,
  },
  (table) => [
    check(
      "aux_node_layers_not_deleted_or_has_payload",
      sql`${table.isDeleted} = 1 OR ${table.parentAuxNodeId} IS NOT NULL OR ${table.name} IS NOT NULL OR ${table.content} IS NOT NULL OR ${table.symlinkTargetAuxNodeId} IS NOT NULL`,
    ),
    foreignKey({
      columns: [table.workspaceId, table.timelinePointId],
      foreignColumns: [timelinePoints.workspaceId, timelinePoints.id],
      name: "aux_node_layers_timeline_point_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.workspaceId, table.auxNodeId],
      foreignColumns: [auxNodes.workspaceId, auxNodes.id],
      name: "aux_node_layers_aux_node_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.workspaceId, table.parentAuxNodeId],
      foreignColumns: [auxNodes.workspaceId, auxNodes.id],
      name: "aux_node_layers_parent_aux_node_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.workspaceId, table.symlinkTargetAuxNodeId],
      foreignColumns: [auxNodes.workspaceId, auxNodes.id],
      name: "aux_node_layers_symlink_target_fk",
    }).onDelete("restrict"),
    uniqueIndex("aux_node_layers_origin_aux_idx")
      .on(table.workspaceId, table.auxNodeId)
      .where(sql`${table.timelinePointId} IS NULL`),
    uniqueIndex("aux_node_layers_timeline_aux_idx")
      .on(table.workspaceId, table.timelinePointId, table.auxNodeId)
      .where(sql`${table.timelinePointId} IS NOT NULL`),
    index("aux_node_layers_workspace_aux_idx").on(table.workspaceId, table.auxNodeId),
    index("aux_node_layers_timeline_point_idx").on(table.workspaceId, table.timelinePointId),
  ],
);
