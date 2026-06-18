import { mkdirSync } from "node:fs";

import { createId, invariant, now } from "@/shared/lib/domain";

import { createBranch } from "./branches";
import { branchRef, checkoutCommitToWorktree, resolveRef } from "./git-storage/git-store";
import { getProjectWorktreeDir } from "./git-storage/paths";
import type { BranchIndexRow, ProjectIndexRow, WorkspaceIndexRow } from "./git-storage/types";
import {
  readProjectMetaSync,
  updateProjectMetaSync,
  writeProjectMetaSync as persistProjectMetaSync,
} from "./git-storage/project-meta-store";
import { seedEmptyWorktree } from "./git-storage/worktree-state";

export type WorkspaceRow = WorkspaceIndexRow;

function getProjectRow(projectId: string): ProjectIndexRow {
  return readProjectMetaSync(projectId).project;
}

function getBranchRow(projectId: string, branchId: string): BranchIndexRow {
  const branch = readProjectMetaSync(projectId).branches.find((item) => item.id === branchId);
  invariant(branch, "未找到分支。");
  return branch;
}

function getWorkspaceRow(projectId: string, workspaceId: string) {
  return readProjectMetaSync(projectId).workspaces.find((item) => item.id === workspaceId) ?? null;
}

export function listWorkspaces(projectId: string): WorkspaceRow[] {
  return readProjectMetaSync(projectId).workspaces;
}

export function getWorkspace(projectId: string, workspaceId: string): WorkspaceRow {
  const workspace = getWorkspaceRow(projectId, workspaceId);
  invariant(workspace, "未找到工作区。");
  return workspace;
}

export function getWorkspaceForBranchId(projectId: string, branchId: string): WorkspaceRow | null {
  return (
    readProjectMetaSync(projectId).workspaces.find(
      (workspace) => workspace.branchId === branchId,
    ) ?? null
  );
}

export function getDefaultWorkspace(projectId: string) {
  const project = getProjectRow(projectId);
  return project.defaultBranchId
    ? (getWorkspaceForBranchId(projectId, project.defaultBranchId) ?? undefined)
    : undefined;
}

export async function writeProjectMeta(projectId: string) {
  const payload = readProjectMetaSync(projectId);
  persistProjectMetaSync(payload);
}

export function writeProjectMetaSync(projectId: string) {
  persistProjectMetaSync(readProjectMetaSync(projectId));
}

export function touchWorkspaceMeta(projectId: string, workspaceId: string, timestamp = now()) {
  getWorkspace(projectId, workspaceId);
  updateProjectMetaSync(
    projectId,
    (payload) => ({
      ...payload,
      project: {
        ...payload.project,
        updatedAt: timestamp,
      },
      workspaces: payload.workspaces.map((item) =>
        item.id === workspaceId ? { ...item, updatedAt: timestamp } : item,
      ),
    }),
    "Touch workspace metadata",
  );
}

export function touchProjectMeta(projectId: string, timestamp = now()) {
  updateProjectMetaSync(
    projectId,
    (payload) => ({
      ...payload,
      project: {
        ...payload.project,
        updatedAt: timestamp,
      },
    }),
    "Touch project metadata",
  );
}

export async function createWorkspaceForBranch(projectId: string, branchId: string, name?: string) {
  const branch = getBranchRow(projectId, branchId);
  invariant(!getWorkspaceForBranchId(projectId, branch.id), "无法创建工作区：该分支已存在工作区。");

  const timestamp = now();
  const workspaceId = createId("workspace");
  const worktreePath = getProjectWorktreeDir(branch.projectId, workspaceId);

  mkdirSync(worktreePath, { recursive: true });
  seedEmptyWorktree(worktreePath);
  const headCommitId = await resolveRef(branch.projectId, branchRef(branch.id));
  if (headCommitId) {
    await checkoutCommitToWorktree({
      projectId: branch.projectId,
      workspaceId,
      commitId: headCommitId,
    });
  }

  updateProjectMetaSync(
    branch.projectId,
    (payload) => ({
      ...payload,
      project: {
        ...payload.project,
        updatedAt: timestamp,
      },
      workspaces: [
        ...payload.workspaces,
        {
          id: workspaceId,
          projectId: branch.projectId,
          branchId: branch.id,
          name: name ?? branch.name,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
    }),
    "Create workspace metadata",
  );
  return getWorkspace(projectId, workspaceId);
}

export function createDefaultWorkspace(projectId: string, name = "main") {
  const branch = createBranch({ projectId, name });
  const workspaceId = createId("workspace");
  const worktreePath = getProjectWorktreeDir(projectId, workspaceId);
  mkdirSync(worktreePath, { recursive: true });
  seedEmptyWorktree(worktreePath);
  const timestamp = now();
  updateProjectMetaSync(
    projectId,
    (payload) => ({
      ...payload,
      project: {
        ...payload.project,
        defaultBranchId: branch.id,
        updatedAt: timestamp,
      },
      workspaces: [
        ...payload.workspaces,
        {
          id: workspaceId,
          projectId,
          branchId: branch.id,
          name,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
    }),
    "Create default workspace metadata",
  );
  const workspace = getWorkspace(projectId, workspaceId);
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
  return await createWorkspaceForBranch(
    input.projectId,
    branch.id,
    input.workspaceName ?? input.name,
  );
}
