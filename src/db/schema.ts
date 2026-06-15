import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const timestampColumns = {
  createdAt: integer("created_at", { mode: "number" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "number" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
};

// === Projects & Workspaces ===

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
    ref: text("ref").notNull(),
    headCommitId: text("head_commit_id"),
    forkedFromCommitId: text("forked_from_commit_id"),
    ...timestampColumns,
  },
  (table) => [
    check("branches_name_nonempty", sql`length(${table.name}) > 0`),
    uniqueIndex("branches_project_name_idx").on(table.projectId, table.name),
    uniqueIndex("branches_project_ref_idx").on(table.projectId, table.ref),
    index("branches_project_idx").on(table.projectId),
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
    worktreePath: text("worktree_path").notNull(),
    ...timestampColumns,
  },
  (table) => [
    check("workspaces_name_nonempty", sql`length(${table.name}) > 0`),
    uniqueIndex("workspaces_project_name_idx").on(table.projectId, table.name),
    uniqueIndex("workspaces_branch_idx").on(table.branchId),
    index("workspaces_project_idx").on(table.projectId),
  ],
);

// === Simplified Cache State (only OID tracking) ===

export const cacheState = sqliteTable(
  "cache_state",
  {
    id: text("id").primaryKey(), // format: "projects:<projectId>" or "ai-runs:<projectId>"
    sourceOid: text("source_oid"), // Git OID of the cached ref
    ...timestampColumns,
  },
  (table) => [index("cache_state_oid_idx").on(table.sourceOid)],
);

// === AI Catalog ===
// The AI catalog is persisted as JSON files under <dataDir>/catalog/.
// See `src/modules/ai/domain/catalog-file-store.ts` for the file layout and
// `src/modules/ai/domain/catalog.ts` for the read/write API. There is no
// `ai_catalog_providers` / `ai_catalog_models` / `ai_registry_state` table
// anymore; legacy data will be dropped by the `0003_drop_ai_catalog_tables`
// migration and re-fetched from models.dev on next refresh.

// === AI Threads & Runs (keep core indexes for performance) ===

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
    selectionSnapshotJson: text("selection_snapshot_json").notNull().default("{}"),
    contextSnapshotJson: text("context_snapshot_json"),
    inputRefsSnapshotJson: text("input_refs_snapshot_json"),
    activeToolsJson: text("active_tools_json"),
    stepCount: integer("step_count").notNull().default(0),
    totalTokens: integer("total_tokens"),
    lastFinishReason: text("last_finish_reason"),
    errorSummary: text("error_summary"),
    traceUpdatedAt: integer("trace_updated_at", { mode: "number" }),
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
      sql`${table.status} IN ('queued', 'running', 'waiting_for_input', 'succeeded', 'failed', 'cancelled')`,
    ),
    check("agent_runs_profile_nonempty", sql`length(${table.agentProfile}) > 0`),
    index("agent_runs_thread_idx").on(table.threadId),
    index("agent_runs_parent_run_idx").on(table.parentRunId),
    index("agent_runs_thread_status_idx").on(table.threadId, table.status),
    index("agent_runs_thread_created_idx").on(table.threadId, table.createdAt),
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
    index("agent_thread_nodes_thread_parent_created_idx").on(
      table.threadId,
      table.parentNodeId,
      table.createdAt,
    ),
    index("agent_thread_nodes_run_idx").on(table.createdByRunId),
  ],
);
