import { and, eq } from "drizzle-orm";

import { type DatabaseExecutor, db, schema } from "@/db";

import { getProjectOrThrow, getWorkspaceOrThrow, touchProject } from "../internal/access";
import { createId, now } from "../internal/ids";

export function createDefaultWorkspaceWithExecutor(
  executor: DatabaseExecutor,
  projectId: string,
  name = "main",
) {
  const project = getProjectOrThrow(executor, projectId);
  const workspaceId = createId("workspace");
  const contentRootId = createId("content");
  const auxRootId = createId("aux");
  const timestamp = now();

  executor
    .insert(schema.workspaces)
    .values({
      id: workspaceId,
      projectId,
      name,
      isDefault: true,
      contentRootId,
      auxRootId,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run();

  executor
    .insert(schema.contentNodes)
    .values({
      id: contentRootId,
      workspaceId,
      parentId: null,
      nextSiblingId: null,
      anchorTimelinePointId: null,
      kind: "_root",
      title: null,
      body: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run();

  executor
    .insert(schema.auxNodes)
    .values({
      id: auxRootId,
      workspaceId,
      nodeType: "root",
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run();

  touchProject(executor, project.id);
  return getWorkspaceOrThrow(executor, workspaceId);
}

export function createDefaultWorkspace(projectId: string, name = "main") {
  return db.transaction((tx) => createDefaultWorkspaceWithExecutor(tx, projectId, name));
}

export function getDefaultWorkspace(projectId: string) {
  return db
    .select()
    .from(schema.workspaces)
    .where(and(eq(schema.workspaces.projectId, projectId), eq(schema.workspaces.isDefault, true)))
    .get();
}

export function listWorkspaces(projectId: string) {
  getProjectOrThrow(db, projectId);
  return db
    .select()
    .from(schema.workspaces)
    .where(eq(schema.workspaces.projectId, projectId))
    .all();
}
