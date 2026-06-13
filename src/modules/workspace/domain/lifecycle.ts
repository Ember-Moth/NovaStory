import { mkdirSync } from "node:fs";

import { eq } from "drizzle-orm";

import { db, schema } from "@/db";
import { createId, invariant, now } from "@/shared/lib/domain";

import { createBranch } from "./branches";
import {
  checkoutCommitToWorktree,
  commitCustomRef,
  commitCustomRefSync,
  metaRef,
} from "./git-storage/git-store";
import { stringifyJsonl } from "./git-storage/jsonl";
import { getProjectWorktreeDir } from "./git-storage/paths";
import type {
  BranchIndexRow,
  ProjectIndexRow,
  ProjectMetaPayload,
  WorkspaceIndexRow,
} from "./git-storage/types";
import { readWorktreeState, seedEmptyWorktree } from "./git-storage/worktree-state";

export type WorkspaceRow = WorkspaceIndexRow;

function getProjectRow(projectId: string): ProjectIndexRow {
  const project = db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).get();
  invariant(project, "未找到项目。");
  return project as ProjectIndexRow;
}

function getBranchRow(branchId: string): BranchIndexRow {
  const branch = db.select().from(schema.branches).where(eq(schema.branches.id, branchId)).get();
  invariant(branch, "未找到分支。");
  return branch as BranchIndexRow;
}

export function listWorkspaces(projectId: string): WorkspaceRow[] {
  getProjectRow(projectId);
  return db
    .select()
    .from(schema.workspaces)
    .where(eq(schema.workspaces.projectId, projectId))
    .all() as WorkspaceRow[];
}

export function getWorkspace(workspaceId: string): WorkspaceRow {
  const workspace = db
    .select()
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId))
    .get();
  invariant(workspace, "未找到工作区。");
  return workspace as WorkspaceRow;
}

export function getWorkspaceForBranchId(branchId: string): WorkspaceRow | null {
  return (
    (db.select().from(schema.workspaces).where(eq(schema.workspaces.branchId, branchId)).get() as
      | WorkspaceRow
      | undefined) ?? null
  );
}

export function getDefaultWorkspace(projectId: string) {
  const project = getProjectRow(projectId);
  return project.defaultBranchId
    ? (getWorkspaceForBranchId(project.defaultBranchId) ?? undefined)
    : undefined;
}

export async function writeProjectMeta(projectId: string) {
  const project = getProjectRow(projectId);
  const branches = db
    .select()
    .from(schema.branches)
    .where(eq(schema.branches.projectId, projectId))
    .all() as BranchIndexRow[];
  const workspaces = listWorkspaces(projectId) as WorkspaceIndexRow[];
  const payload: ProjectMetaPayload = { project, branches, workspaces };
  await commitCustomRef({
    projectId,
    ref: metaRef(projectId),
    message: "Update project metadata",
    files: {
      "project.json": `${JSON.stringify(payload.project, null, 2)}\n`,
      "branches.jsonl": stringifyJsonl(payload.branches),
      "workspaces.jsonl": stringifyJsonl(payload.workspaces),
    },
  });
}

export function writeProjectMetaSync(projectId: string) {
  const project = getProjectRow(projectId);
  const branches = db
    .select()
    .from(schema.branches)
    .where(eq(schema.branches.projectId, projectId))
    .all() as BranchIndexRow[];
  const workspaces = listWorkspaces(projectId) as WorkspaceIndexRow[];
  const payload: ProjectMetaPayload = { project, branches, workspaces };
  commitCustomRefSync({
    projectId,
    ref: metaRef(projectId),
    message: "Update project metadata",
    files: {
      "project.json": `${JSON.stringify(payload.project, null, 2)}\n`,
      "branches.jsonl": stringifyJsonl(payload.branches),
      "workspaces.jsonl": stringifyJsonl(payload.workspaces),
    },
  });
}

export async function createWorkspaceForBranch(branchId: string, name?: string) {
  const branch = getBranchRow(branchId);
  invariant(!getWorkspaceForBranchId(branch.id), "无法创建工作区：该分支已存在工作区。");

  const timestamp = now();
  const workspaceId = createId("workspace");
  let contentRootId = createId("content");
  let auxRootId = createId("aux");
  const worktreePath = getProjectWorktreeDir(branch.projectId, workspaceId);

  mkdirSync(worktreePath, { recursive: true });
  seedEmptyWorktree(worktreePath, { contentRootId, auxRootId });
  if (branch.headCommitId) {
    await checkoutCommitToWorktree({
      projectId: branch.projectId,
      workspaceId,
      commitId: branch.headCommitId,
    });
    const restored = readWorktreeState(worktreePath);
    contentRootId = restored.content.find((node) => node.parentId === null)?.id ?? contentRootId;
    auxRootId =
      restored.auxLayers.find(
        (layer) => layer.nodeType === "root" && layer.timelinePointId === null,
      )?.auxNodeId ?? auxRootId;
  }

  db.insert(schema.workspaces)
    .values({
      id: workspaceId,
      projectId: branch.projectId,
      branchId: branch.id,
      name: name ?? branch.name,
      worktreePath,
      contentRootId,
      auxRootId,
      createdAt: timestamp,
      updatedAt: timestamp,
    } as typeof schema.workspaces.$inferInsert)
    .run();
  await writeProjectMeta(branch.projectId);
  return getWorkspace(workspaceId);
}

export function createDefaultWorkspace(projectId: string, name = "main") {
  const branch = createBranch({ projectId, name });
  db.update(schema.projects)
    .set({ defaultBranchId: branch.id, updatedAt: now() })
    .where(eq(schema.projects.id, projectId))
    .run();
  const workspaceId = createId("workspace");
  const contentRootId = createId("content");
  const auxRootId = createId("aux");
  const worktreePath = getProjectWorktreeDir(projectId, workspaceId);
  mkdirSync(worktreePath, { recursive: true });
  seedEmptyWorktree(worktreePath, { contentRootId, auxRootId });
  const timestamp = now();
  db.insert(schema.workspaces)
    .values({
      id: workspaceId,
      projectId,
      branchId: branch.id,
      name,
      worktreePath,
      contentRootId,
      auxRootId,
      createdAt: timestamp,
      updatedAt: timestamp,
    } as typeof schema.workspaces.$inferInsert)
    .run();
  const workspace = getWorkspace(workspaceId);
  writeProjectMetaSync(projectId);
  return workspace;
}

export async function createBranchWorkspace(input: {
  projectId: string;
  name: string;
  fromCommitId?: string | null;
  workspaceName?: string;
}) {
  const branch = createBranch({
    projectId: input.projectId,
    name: input.name,
    fromCommitId: input.fromCommitId,
  });
  return await createWorkspaceForBranch(branch.id, input.workspaceName ?? input.name);
}
