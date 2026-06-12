import { eq } from "drizzle-orm";

import { type DatabaseExecutor, db, schema } from "@/db";

import { createBranchWithExecutor, checkoutBranchIntoWorkspace } from "./branches";
import {
  getBranchOrThrow,
  getProjectOrThrow,
  getWorkspaceForBranch,
  getWorkspaceOrThrow,
  touchProject,
} from "./internal/access";
import { createId, invariant, now } from "@/shared/lib/domain";

function seedWorkspaceRoots(executor: DatabaseExecutor, workspaceId: string, timestamp: number) {
  const contentRootId = createId("content");
  const auxRootId = createId("aux");

  executor
    .insert(schema.contentNodes)
    .values({
      id: contentRootId,
      workspaceId,
      parentId: null,
      nextSiblingId: null,
      anchorTimelinePointId: null,
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

  executor
    .update(schema.workspaces)
    .set({ contentRootId, auxRootId, updatedAt: timestamp })
    .where(eq(schema.workspaces.id, workspaceId))
    .run();
}

export function createWorkspaceForBranchWithExecutor(
  executor: DatabaseExecutor,
  branchId: string,
  name?: string,
) {
  const branch = getBranchOrThrow(executor, branchId);
  invariant(!getWorkspaceForBranch(executor, branch.id), "无法创建工作区：该分支已存在工作区。");

  const workspaceId = createId("workspace");
  const timestamp = now();

  executor
    .insert(schema.workspaces)
    .values({
      id: workspaceId,
      projectId: branch.projectId,
      branchId: branch.id,
      name: name ?? branch.name,
      contentRootId: null,
      auxRootId: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run();

  if (branch.headCommitId) {
    checkoutBranchIntoWorkspace(executor, workspaceId, branch.id);
  } else {
    seedWorkspaceRoots(executor, workspaceId, timestamp);
  }

  touchProject(executor, branch.projectId);
  return getWorkspaceOrThrow(executor, workspaceId);
}

export function createWorkspaceForBranch(branchId: string, name?: string) {
  return db.transaction((tx) => createWorkspaceForBranchWithExecutor(tx, branchId, name));
}

export function createDefaultWorkspaceWithExecutor(
  executor: DatabaseExecutor,
  projectId: string,
  name = "main",
) {
  const project = getProjectOrThrow(executor, projectId);
  const branch = createBranchWithExecutor(executor, { projectId: project.id, name });
  executor
    .update(schema.projects)
    .set({ defaultBranchId: branch.id, updatedAt: now() })
    .where(eq(schema.projects.id, project.id))
    .run();
  return createWorkspaceForBranchWithExecutor(executor, branch.id, name);
}

export function createDefaultWorkspace(projectId: string, name = "main") {
  return db.transaction((tx) => createDefaultWorkspaceWithExecutor(tx, projectId, name));
}

export function createBranchWorkspace(input: {
  projectId: string;
  name: string;
  fromCommitId?: string | null;
  workspaceName?: string;
}) {
  return db.transaction((tx) => {
    const branch = createBranchWithExecutor(tx, {
      projectId: input.projectId,
      name: input.name,
      fromCommitId: input.fromCommitId,
    });
    return createWorkspaceForBranchWithExecutor(tx, branch.id, input.workspaceName ?? input.name);
  });
}

export function getDefaultWorkspace(projectId: string) {
  const project = getProjectOrThrow(db, projectId);
  if (!project.defaultBranchId) {
    return undefined;
  }
  return getWorkspaceForBranch(db, project.defaultBranchId);
}

export function getWorkspace(workspaceId: string) {
  return getWorkspaceOrThrow(db, workspaceId);
}

export function listWorkspaces(projectId: string) {
  getProjectOrThrow(db, projectId);
  return db
    .select()
    .from(schema.workspaces)
    .where(eq(schema.workspaces.projectId, projectId))
    .all();
}
