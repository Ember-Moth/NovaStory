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
