import { and, eq } from "drizzle-orm";

import { type DatabaseExecutor, schema } from "@/db";

import { invariant, now } from "@/shared/lib/domain";

export function getWorkspaceOrThrow(executor: DatabaseExecutor, workspaceId: string) {
  const workspace = executor
    .select()
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId))
    .get();
  invariant(workspace, "未找到工作区。");
  return workspace;
}

export function getProjectOrThrow(executor: DatabaseExecutor, projectId: string) {
  const project = executor
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .get();
  invariant(project, "未找到项目。");
  return project;
}

export function getTimelinePointOrThrow(
  executor: DatabaseExecutor,
  workspaceId: string,
  pointId: string,
) {
  const point = executor
    .select()
    .from(schema.timelinePoints)
    .where(
      and(
        eq(schema.timelinePoints.id, pointId),
        eq(schema.timelinePoints.workspaceId, workspaceId),
      ),
    )
    .get();
  invariant(point, "未找到时间点。");
  return point;
}

export function getContentNodeOrThrow(
  executor: DatabaseExecutor,
  workspaceId: string,
  nodeId: string,
) {
  const node = executor
    .select()
    .from(schema.contentNodes)
    .where(
      and(eq(schema.contentNodes.id, nodeId), eq(schema.contentNodes.workspaceId, workspaceId)),
    )
    .get();
  invariant(node, "未找到正文节点。");
  return node;
}

export function getAuxNodeOrThrow(executor: DatabaseExecutor, workspaceId: string, nodeId: string) {
  const node = executor
    .select()
    .from(schema.auxNodes)
    .where(and(eq(schema.auxNodes.id, nodeId), eq(schema.auxNodes.workspaceId, workspaceId)))
    .get();
  invariant(node, "未找到辅助信息节点。");
  return node;
}

export function touchWorkspace(executor: DatabaseExecutor, workspaceId: string) {
  executor
    .update(schema.workspaces)
    .set({ updatedAt: now() })
    .where(eq(schema.workspaces.id, workspaceId))
    .run();
}

export function touchProject(executor: DatabaseExecutor, projectId: string) {
  executor
    .update(schema.projects)
    .set({ updatedAt: now() })
    .where(eq(schema.projects.id, projectId))
    .run();
}

export function assertContentRoot(workspace: { id: string; contentRootId: string | null }) {
  invariant(workspace.contentRootId, `Workspace ${workspace.id} has no content root`);
  return workspace.contentRootId;
}

export function assertAuxRoot(workspace: { id: string; auxRootId: string | null }) {
  invariant(workspace.auxRootId, `Workspace ${workspace.id} has no aux root`);
  return workspace.auxRootId;
}
