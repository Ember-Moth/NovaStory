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
    worktreePath: text("worktree_path"),
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

export const branches = sqliteTable(
  "branches",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    ref: text("ref"),
    headCommitId: text("head_commit_id"),
    forkedFromCommitId: text("forked_from_commit_id"),
    ...timestampColumns,
  },
  (table) => [
    check("branches_name_nonempty", sql`length(${table.name}) > 0`),
    uniqueIndex("branches_project_name_idx").on(table.projectId, table.name),
    index("branches_project_idx").on(table.projectId),
    index("branches_head_commit_idx").on(table.headCommitId),
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
    activeTipNodeId: text("active_tip_node_id"),
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
    parentRunId: text("parent_run_id"),
    parentEventId: text("parent_event_id"),
    triggerNodeId: text("trigger_node_id"),
    baseTipNodeId: text("base_tip_node_id"),
    runMode: text("run_mode").notNull(),
    status: text("status").notNull(),
    agentProfile: text("agent_profile").notNull(),
    errorArtifactId: text("error_artifact_id"),
    startedAt: integer("started_at", { mode: "number" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    completedAt: integer("completed_at", { mode: "number" }),
    ...timestampColumns,
  },
  (table) => [
    check(
      "agent_runs_mode_valid",
      sql`${table.runMode} IN ('send', 'retry', 'regenerate', 'edit_regenerate', 'continue', 'subagent')`,
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
    createdByRunId: text("created_by_run_id"),
    sourceStepId: text("source_step_id"),
    sourceKind: text("source_kind").notNull(),
    summaryText: text("summary_text"),
    partsJson: text("parts_json").notNull().default("[]"),
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
